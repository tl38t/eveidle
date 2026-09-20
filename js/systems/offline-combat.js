/* ================================================================
   Batch S · 统计等效离线战斗结算
   ----------------------------------------------------------------
   设计红线（来自 Batch S 指令）：
   - 禁止循环调用 combatTick / advanceCombatRound / 每秒模拟。
   - 复用 combat.js（已冻结）的**真实单轮战斗数学**：calcCombatDamage /
     applyLayeredCombatDamage / applyCapitalShieldMitigation / 各 state
     选择器 / computeVolleyFuel / nextCombatRandom。伤害用期望值
     （rng=()=>0.5 ⇒ 方差恒为 1.0，命中系数即命中概率），掉落用 Batch R
     确定性 RNG（nextCombatRandom）批量计算。
   - 资源：会话级 collector 跨段累计，flush 时每种 resourceId 一次性
     ResourceRegistry.add/spend（resource:changed ≤ 不同资源 ID 数）。
   - 事件：settle() 仅累积，flush() 发**一次**聚合事件
     offline:combatSettled（早于 offline:settlementCompleted）；
     不重发逐敌/逐波/damageDealt/deathspaceCleared 等在线事件，防双计。
   - 维修：战败 repairUntil = 虚拟战败时刻 + 180000；虚拟时间只在离散
     事件点跳（波清/战败/连刷续入/增强剂到期）。
   - 允许文件：本文件为 Batch S 新增文件（js/systems/offline-combat.js）。
   ================================================================ */
(function () {
  "use strict";

  // ---- 全局解析（生产环境 index.html 在 combat.js/selectors/actions 之后加载；
  //       verify 沙箱里均为 sandbox 全局）----
  function G(name) {
    if (typeof globalThis !== "undefined" && globalThis[name] !== undefined) return globalThis[name];
    if (typeof window !== "undefined" && window[name] !== undefined) return window[name];
    return undefined;
  }
  function emitOffline(type, payload, meta) {
    const fn = G("emitOfflineGameEvent");
    if (typeof fn === "function") fn(type, payload, meta);
  }
  // 离线战斗队列终结（fail-closed）：找不到 finalizeCombatQueueItem 时不得伪报 queue-target-reached，
  // 必须上报错误并保留当前队列/战斗进度/剩余离线时间，返回 false；成功返回 true。
  function finishOfflineCombatQueueItem(state, nowRef) {
    const ts = (nowRef && typeof nowRef.t === "number") ? nowRef.t : (typeof Date !== "undefined" ? Date.now() : 0);
    const fin = G("finalizeCombatQueueItem");
    if (typeof fin !== "function") {
      const msg = "离线战斗队列终结函数 finalizeCombatQueueItem 未导出，队列项无法推进（已保留当前队列与战斗进度，等待登录后处理）";
      const rg = G("RuntimeGuard");
      if (rg && typeof rg.report === "function") rg.report(new Error(msg), { source: "offline-combat", fatal: false, kind: "queue-finalize" });
      else if (typeof console !== "undefined") console.error("[offline-combat] " + msg);
      return false;
    }
    fin(state, ts);
    return true;
  }
  // 期望值 RNG：calcCombatDamageVariance 在 r=0.5 时 = 0.90+(0.5+0.5)*0.10 = 1.0
  function EXPECT() { return 0.5; }
  // 离线伤害仍取期望值，但命中判定必须消耗一次战斗 RNG，保持后续目标选择序列与在线一致。
  function expectedCombatRng(state) {
    return function () {
      const next = G("nextCombatRandom");
      if (next && state && state.combat) next(state.combat);
      return 0.5;
    };
  }
  // 离线敌方伤害补偿（2026-09-09「离线打不过 90 图」修复 B）：
  // 离线无法像在线那样续脑突触广告（×1.3 伤害）与战斗增强剂，临界配装下击杀速度
  // 略降即翻入死亡螺旋（实测：满 buff 清 9-21 波 vs 按导出 buff 清 4-6 波，且仍死 3-4 次）。
  // 设计性补偿：离线敌方伤害 ×0.9。维修/DCU/回合节奏/敌方面板均已与在线逐行对齐，
  // 本系数是离线与在线之间唯一刻意保留的数值差。
  const OFFLINE_ENEMY_DAMAGE_COMP = 0.9;
  function actualCombatRng(state) {
    return function () {
      const next = G("nextCombatRandom");
      return next && state && state.combat ? next(state.combat) : 0.5;
    };
  }
  // 确定性掉落 RNG（Batch R 的 combat.randomState）
  function detRng(combat) {
    return function () { return G("nextCombatRandom")(combat); };
  }

  const ROUND_SECONDS = 1;        // 每轮等效 1 秒（与在线 tick 同尺度）
  const REPAIR_MS = 180000;       // 战败维修 180 秒
  const MAX_WAVE_ROUNDS = 6000;   // 单波防呆上限
  // ⭐ 单波停摆短路（2026-09-19 性能修复）：
  // 若「连续 N 轮敌方总血量都没有任何下降」⇒ 本波不可推进（清波的唯一途径就是打掉敌方血量）。
  // 离线模拟是期望值模型（无随机、按轮结算）：玩家打不动 + 敌方也打不死玩家时，双方状态逐轮重复，
  // 唯一结局就是一路空转到 MAX_WAVE_ROUNDS。真机实测：单波 6000 轮 × ~1.4ms ≈ 8.3s CPU，
  // 表现为登录 / 切回前台「卡死数秒」（[离线诊断] 时间轴 8320ms，其中 combat=8302.5ms）。
  // 触发后立即停止离线战斗模拟，把剩余离线时间交还生产结算 —— 与波间 canContinue 检查同口径。
  const NO_PROGRESS_LIMIT = 3;

  // ================================================================
  // M0（2026-09-19）离线战斗快通道：开关 + 只读诊断
  //   方案见 docs/OFFLINE_COMBAT_FASTPATH_PLAN_v0.2.md
  //   · 开关 `globalThis.__OFFLINE_COMBAT_FASTPATH` **默认关闭**；
  //     **开启也不改变任何行为** —— 本阶段只做分类统计（评估守卫通过率），
  //     真正的快通道实现属 L1a / L1b，尚未落地。
  //   · 诊断计数一律**不得进入 flush payload**：否则 A/B 对拍会把「开关改了输出」
  //     误判为行为差异，丧失「零侵入」证据。
  //   · 统计对象挂 OfflineCombatSystem.fastpathStats，供仓外探针直接读取。
  //   · 全部记账以 fpEnabled() 早退门控 ⇒ 开关关闭时零开销、零行为差异。
  // ================================================================
  const FP_STATS = {
    enabled: false,
    waves: 0,            // 已分类的波数
    waveAccepted: 0,     // 守卫初判「可快通道」的波数（仅预估，不等于已实现）
    waveRejected: {},    // 拒绝原因直方图
    roundRuns: 0,        // 实际逐轮模拟的轮数
    roundSkipped: 0,     // 跳过的轮数（M0 恒为 0；L1b 落地后 > 0）
    guardEvalMs: 0,      // 守卫求值耗时（含自身开销，只用于发现异常量级）
    // M3（L1a 递推内核）计数：命中波数 / 回退原因 / 内核构建耗时
    kernelWaves: 0,      // 成功建立递推内核的波数
    kernelRejected: {},  // 回退原路径的原因直方图（titan / squad）
    kernelReadyMs: 0     // 内核构建（含波级缓存）耗时
  };
  function fpEnabled() {
    try {
      return typeof globalThis !== "undefined" && Boolean(globalThis.__OFFLINE_COMBAT_FASTPATH);
    } catch (_) { return false; }
  }

  // 近似离线快通道：仅供长离线实验，默认关闭。玩家/敌方主战斗仍逐轮执行。
  function fpNow() {
    try {
      return (typeof performance !== "undefined" && performance && typeof performance.now === "function")
        ? performance.now()
        : ((typeof Date !== "undefined" && Date.now) ? Date.now() : 0);
    } catch (_) { return 0; }
  }
  // 守卫初判（只读，不改变任何状态）。返回 "" = 初判可跳；否则返回拒绝原因。
  // ⚠️ 这是 L1b §5.3 / §6 守卫的**低价近似**（不含「连续 M 轮无状态变化」与完整 wave signature
  //    —— 那两项需要轮内指纹，属 L1b 实现期）。M0 只用来量出守卫通过率的上界。
  function fpClassifyWave(state, enemies, s) {
    const c = state.combat;
    if (c && c.squad && c.squad.enabled === true) return "squad";
    const ships = (typeof G("getActiveShip") === "function") ? G("getActiveShip")(state) : null;
    if (ships && typeof G("isTitanCombatShip") === "function" && G("isTitanCombatShip")(ships)) return "titan";
    for (const e of enemies) {
      if (!e) continue;
      if (e.kind === "boss" || (e.bossHealPct || 0) > 0 || (e.repairSuppr || 0) > 0
          || (e.enrageMul || 0) > 0 || (e.auraDamage || 0) > 0) return "boss-or-aura";
    }
    if (state.settings && state.settings.salvageArmActive
        && typeof hasSalvageArmEquipped === "function" && hasSalvageArmEquipped(state)) return "salvage-arm";
    if (typeof getMtuModifiers === "function") {
      const m = getMtuModifiers(state);
      if (m && m.active) return "mtu";
    }
    if (c && c.maxHp && c.hp
        && (c.hp.shield !== c.maxHp.shield || c.hp.armor !== c.maxHp.armor || c.hp.structure !== c.maxHp.structure)) {
      return "hp-not-full";
    }
    return "";
  }
  function fpAccountWave(state, enemies, s) {
    const t0 = fpNow();
    FP_STATS.waves++;
    const reason = fpClassifyWave(state, enemies, s);
    if (reason) FP_STATS.waveRejected[reason] = (FP_STATS.waveRejected[reason] || 0) + 1;
    else FP_STATS.waveAccepted++;
    FP_STATS.guardEvalMs += fpNow() - t0;
  }

  // ================================================================
  // M6a（2026-09-19）离线战斗 L3 事件账本：**只记录、零行为改动**
  //   方案见 docs/OFFLINE_COMBAT_FASTPATH_PLAN_v0.4.md §11.6
  //   · 开关 `globalThis.__OFFLINE_M6A_RECORD` **默认关闭**，且与 L1a 快通道开关
  //     `__OFFLINE_COMBAT_FASTPATH` **完全解耦** —— 快通道关着也能单独开账本，
  //     这正是「只记录、零行为改动」的验证形态（账本开/关必须逐字节同状态）。
  //   · 账本只在显式开启时写入；关闭时 `m6aEnabled()` 早退 ⇒ 零开销、零行为差异。
  //   · `recordKill` 的**原有调用、执行顺序、返回值完全不变**：账本只在其末尾
  //     **追加只读快照**，不改写 `s` / `state` 的任何既有字段。
  //   · 账本**绝不进入 flush payload、绝不写 state** ⇒ 对 A/B 逐字节对拍零影响。
  //   · 有序账目（`zoneSpecial` / 死亡空间 `leader`）按**原消费顺序**逐条记录，
  //     不排序、不归并、不归一化 —— 顺序本身就是被保真的对象（评审 Q5 硬约束）。
  //   · 打捞臂燃耗 / 同位素主动打捞（余额门控、与齐射燃料交错）**只记录「本次实际扣了多少」，
  //     绝不接管扣减**（Q1 已裁定：不接受批量等价，也不事后补发）。
  // ================================================================
  const M6A_LEDGER = [];        // 账本条目数组；仅在 m6aEnabled() 时增长
  let _m6aSeq = 0;              // 单调序号（reset 归零）⇒ 供「保序 + 无空洞」断言
  let _m6aNowRef = null;        // settle() 注入的权威虚拟时钟引用（nowRef.t 按波推进）
  const M6A_MAX_ENTRIES = 200000; // 上限：8h 离线实测约 5 万击杀，200k 留足余量并防内存失控
  const M6A_STATS = {
    enabled: false,
    entries: 0,        // 已记录条目数**含**资源条目（应 == killEntries + ΣbyRes）
    killEntries: 0,    // 击杀条目数（应 == killsSeen == 会话 kills —— 防空结论断言）
    resSeen: 0,        // m6aRecordRes 调用次数
    sessEntries: 0,    // 会话级账目点（ev:"sess"）条目数 —— M6b 补记
    killsSeen: 0,      // recordKill 被调用次数（超上限时仍计数）
    byKind: {}, byFaction: {}, byZone: {},
    byRes: {},         // 资源账目点计数（key = resKind）
    resAmount: {},     // 资源账目点金额合计（key = resKind）
    orderedZs: 0,      // zoneSpecial 有序条目数
    orderedLeader: 0,  // leader 有序条目数
    truncated: false,  // 超上限后停止追加
    errors: 0          // 记录过程异常（非零即说明账本不完整 ⇒ 验收必须 FAIL）
  };
  function m6aEnabled() {
    try {
      return typeof globalThis !== "undefined" && Boolean(globalThis.__OFFLINE_M6A_RECORD);
    } catch (_) { return false; }
  }
  // M6a：声望账目点的**只读**快照（三势力 weightedKills 的裸值；不调 ensureState，避免任何写入）。
  function m6aRepSnapshot(state) {
    const r = state && state.reputation && state.reputation.weightedKills;
    if (!r || typeof r !== "object") return null;
    return { angel: Number(r.angel) || 0, blood: Number(r.blood) || 0, sansha: Number(r.sansha) || 0 };
  }
  // M6a：记录**非逐杀**的资源账目点（清波 LP / 队列「部分清波」LP）。
  // ⚠️ 为什么必须记（2026-09-19 实测）：`s.lpDelta` 有两个**不在 recordKill 内**的写入点 ——
  //   `simulateBelt` 的清波 `+= clearLp×mtuLp`（:1548 附近）与队列中途达标的
  //   `+= clearLp×(restWaves/maxWave)×mtuQ`（:1575 附近）。只记逐杀时「账本 vs 基线」会出现
  //   无法归因的差额（实测 lpΣ=49 vs 基线 74，差 25 = 恰好一次清波），而 M6 的批量重放会因此算错 LP。
  //   这两处**只追加只读条目**，不接管扣减、不改任何既有值。
  function m6aRecordRes(state, s, resKind, amount, detail) {
    if (!m6aEnabled()) return;
    M6A_STATS.resSeen++;
    if (M6A_LEDGER.length >= M6A_MAX_ENTRIES) { M6A_STATS.truncated = true; return; }
    try {
      const c = state.combat || {};
      const d = detail || {};
      const _ent = {
        seq: ++_m6aSeq,
        t: (_m6aNowRef && typeof _m6aNowRef.t === "number") ? _m6aNowRef.t : null,
        tAcc: Number(s.simulatedSeconds) || 0,
        ev: "res",
        res: resKind, amount: Number(amount) || 0,
        zoneId: d.zoneId != null ? d.zoneId : null,
        wave: d.wave != null ? d.wave : (c.wave != null ? c.wave : null),
        restWaves: d.restWaves != null ? d.restWaves : null,
        maxWave: d.maxWave != null ? d.maxWave : null
      };
      M6A_LEDGER.push(_ent);
      M6A_STATS.entries++;
      M6A_STATS.byRes[resKind] = (M6A_STATS.byRes[resKind] || 0) + 1;
      M6A_STATS.resAmount[resKind] = (M6A_STATS.resAmount[resKind] || 0) + _ent.amount;
    } catch (_e) { M6A_STATS.errors++; }
  }
  // M6a：记录**会话级**账目点（ev:"sess"）。
  // ⚠️ 为什么必须记（2026-09-19 M6b 侦察实测）：`s.salvageSquadTotal` 是 flush 的**输入**，
  //   但它是「会话内 getSquadSalvageEfficiency 按编制签名取最大值」的结果 —— 依赖段内编制变化与
  //   members 生命周期，**不可能**由逐杀账本重建（重放时 state 是 settle 前的档，实时求值拿到的是
  //   段前值）。故在 applyBatchedDrops **开头**（任何 flush 副作用之前）原样记一次。
  //   ⚠️ 且必须记「flush 时真正会被读到的那个值」，包括「没有快照 ⇒ 回退实时求值」的情形。
  function m6aRecordSess(state, s, extra) {
    if (!m6aEnabled()) return;
    if (M6A_LEDGER.length >= M6A_MAX_ENTRIES) { M6A_STATS.truncated = true; return; }
    try {
      const x = extra || {};
      const _ent = {
        seq: ++_m6aSeq,
        t: (_m6aNowRef && typeof _m6aNowRef.t === "number") ? _m6aNowRef.t : null,
        tAcc: Number(s.simulatedSeconds) || 0,
        ev: "sess",
        // flush 实读值的权威快照（含回退路径）
        salvageSquadTotal: (typeof s.salvageSquadTotal === "number") ? s.salvageSquadTotal : null,
        salvageSquadTotalSource: (typeof s.salvageSquadTotal === "number") ? "session-max" : "live-fallback",
        salvageSquadTotalLive: (x.live != null) ? x.live : null,
        kills: s.kills || 0
      };
      M6A_LEDGER.push(_ent);
      M6A_STATS.entries++;
      M6A_STATS.sessEntries = (M6A_STATS.sessEntries || 0) + 1;
    } catch (_e) { M6A_STATS.errors++; }
  }

  // ================================================================
  // M6b（2026-09-19）影子重放：**只读账本 → 隔离副本 → 生产 flush**
  //   · 开关 `globalThis.__OFFLINE_M6B_REPLAY` **默认关闭**，与 M6a / 快通道**零交集**；
  //   · **生产结算路径零调用**：没有任何生产分支引用 m6bReplay，它只由仓外验收探针调用；
  //   · 重放**不得依赖 flush 后才可见的临时状态**（用户硬约束）：
  //     输入只有 `(baselineState, ledger, pre-flush rngState)`；
  //     `rngState` 取「settle 结束、flush 之前」的 `state.combat.randomState`，属 pre-flush 可见量。
  //   · 本阶段**不替换**生产结算路径，仅做「账本是否足以复现击杀流全部账目」的影子证明，
  //     为 M6c（按 enemyClass 多重集批量声望）与未来 L3 批量击杀提供充分性依据。
  // ================================================================
  function m6bEnabled() {
    try {
      return typeof globalThis !== "undefined" && Boolean(globalThis.__OFFLINE_M6B_REPLAY);
    } catch (_) { return false; }
  }
  let _m6bSuppressEmit = false;    // 仅 m6bReplay 在自己的同步 flush 调用期间置位（生产恒 false）
  let _m6bSeq = 0;
  const M6B_STATS = {
    enabled: false,
    replays: 0, appliedKill: 0, appliedRes: 0, appliedSess: 0,
    skippedUnknownEv: {}, errors: 0, lastError: null
  };

  // ================================================================
  // ---- M6c：声望结算的**波级**批量（2026-09-19，§11.10）----
  // 范围（用户硬约束）：
  //   · **只**批量化 `applyReputationKill`；按 enemyClass（+ faction + zoneId）多重集计数；
  //   · **不动**逐轮事实 / 燃料 / 弹药 / 同位素 / 掉落；
  //   · **不调用** m6bReplay、**不调用**生产 flush；
  //   · 默认关闭；先做**影子结果比对**（shadow 模式零风险积累证据）。
  //
  // 🔴 折叠粒度必须是「**波**」而不是「段」—— 四臂实证（`_probe_m6c_rep_coupling.mjs`，
  //    零源码改动、纯 hook 全局函数）：
  //    离线 belt 的**每一波编队**由
  //      combat.js:514 buildCombatWave → :516 getCombatFormation
  //      → :307 getFactionEliteChanceBonus(zone.faction, window.gameState)  ← **读声望**
  //    决定 ⇒ `weightedKills` 是**段内输入**，不只是段末输出。
  //    实测（angel_outer_reach，900s，初始加权置于「杀 10 只即跨 neutral→alert」）：
  //      · 读点埋点：57 次 buildCombatWave 中 **56 次**读到 eliteBonus = 0.05；
  //      · **段级**折叠 ⇒ 全量状态哈希 d16f71ae ≠ 基线 a69fab7a；编队序列在第 13 次
  //        buildCombatWave（wave 14）分叉（3 敌 vs 2 敌）；波数 66 vs 60；击杀数 193 vs 184；
  //      · **波级**折叠 ⇒ 哈希 / flush payload / 编队 60 波 / 最终 weightedKills **全部逐字节相同**。
  //    （死亡空间波由 combat.js:471 buildDeathspaceWave 生成，**不读声望** ⇒ 该路径折叠恒等价，
  //      但仍按同一粒度折叠，保持单一实现。）
  //
  // 折叠技法 = **幂等基准 + 差额补偿**：每个不同的 (faction, zoneId, enemyClass) 组合
  //   **只调一次**原 `applyReputationKill`（由它权威算点，并执行全部副作用：ensureState 规整、
  //   `_dirty`、技能总览刷新检查），再按其前后差补 `(n − 1) × points`。
  //   ⇒ **不在本文件复制 SHIP_POINTS 公式**（避免「抄错公式」变成假绿），且自动继承
  //   `FACTIONS[faction]` 非法早退语义（非法 ⇒ 前后差为 0 ⇒ 不补、不计数）。
  // ================================================================
  const M6C_REP_FACTIONS = ["angel", "blood", "sansha"];
  function m6cMode() {   // 0 = off；1 = shadow（照旧逐杀 + 旁路收集，仅对拍）；2 = batch（真折叠）
    try {
      if (typeof globalThis === "undefined") return 0;
      if (globalThis.__OFFLINE_M6C_REP_BATCH) return 2;
      if (globalThis.__OFFLINE_M6C_REP_SHADOW) return 1;
      return 0;
    } catch (_) { return 0; }
  }
  // 本波收集器（只在 m6cBegin/m6cEnd 之间活跃；两者之外的调用一律直通原函数）
  const _repBatch = { active: false, mode: 0, multi: {}, kills: 0, before: {} };
  const M6C_STATS = {
    enabled: false, mode: 0,
    batches: 0, wavesWithKills: 0,
    killsCollected: 0,          // 被收集的击杀次数（应 == 逐杀调用次数）
    foldedCalls: 0,             // 实际调用原函数的次数（折叠后）
    saves: 0,                   // 折叠掉的调用数（== killsCollected − foldedCalls 的上界）
    shadowWaves: 0, mismatch: 0, lastMismatch: null,
    unmapped: 0,                // enemyClass 缺失 ⇒ 无法用导出点数表对拍的次数
    byClass: {}, byFaction: {}, // 用户点名口径：按 enemyClass 多重集计数
    errors: 0, lastError: null
  };
  // 纯读快照（**不调 ensureState** ⇒ 零副作用）；非法值按 ensureState 的同一规则规整为 0，
  // 这样「本波增量」在「初始含脏值」的极端边界下也仍然算得对。
  function m6cRepRead(state, faction) {
    const r = state && state.reputation && state.reputation.weightedKills;
    const v = r ? Number(r[faction]) : 0;
    return (Number.isFinite(v) && v >= 0) ? v : 0;
  }
  function m6cBegin(state) {
    const mode = m6cMode();
    if (mode === 0) return;
    _repBatch.active = true; _repBatch.mode = mode;
    _repBatch.multi = {}; _repBatch.kills = 0; _repBatch.before = {};
    _repBatch.before.angel = m6cRepRead(state, "angel");
    _repBatch.before.blood = m6cRepRead(state, "blood");
    _repBatch.before.sansha = m6cRepRead(state, "sansha");
  }
  // recordKill 里的**唯一**声望写入点经由此转发：mode 0 时逐字转发 ⇒ 行为与调用序完全不变
  function m6cApply(state, faction, zoneId, enemyClass) {
    const mode = m6cMode();
    if (mode === 0 || !_repBatch.active) return applyReputationKill(state, faction, zoneId, enemyClass);
    try {
      const FAC = G("REPUTATION_FACTIONS");
      if (FAC && FAC[faction]) {   // 与逐杀路径同一份 FACTIONS 校验 ⇒ 非法 faction 不参与收集
        const key = faction + "\u0001" + (zoneId == null ? "" : zoneId) + "\u0001" + (enemyClass == null ? "" : enemyClass);
        _repBatch.multi[key] = (_repBatch.multi[key] || 0) + 1;
        _repBatch.kills++;
        M6C_STATS.killsCollected++;
        bump(M6C_STATS.byClass, enemyClass || "?", 1);
        bump(M6C_STATS.byFaction, faction, 1);
      }
    } catch (err) { M6C_STATS.errors++; M6C_STATS.lastError = String((err && err.message) || err); }
    if (mode === 1) return applyReputationKill(state, faction, zoneId, enemyClass);  // shadow：权威照旧
    return undefined;                                                                 // batch：波末统一写
  }
  function m6cEnd(state) {
    const mode = m6cMode();
    if (mode === 0 || !_repBatch.active) return;
    _repBatch.active = false;
    try {
      M6C_STATS.batches++;
      if (_repBatch.kills === 0) return;
      M6C_STATS.wavesWithKills++;
      if (mode === 1) { m6cShadowCheck(state); return; }
      m6cFlushBatch(state);
    } catch (err) {
      M6C_STATS.errors++; M6C_STATS.lastError = String((err && err.message) || err);
    }
  }
  // shadow：把「逐杀实际增量」与「多重集按导出点数表算出的期望值」逐势力对拍。
  //   注意：shadow **不复制点数公式** —— 直接用导出的 `REPUTATION_SHIP_POINTS`（同一张表）。
  function m6cShadowCheck(state) {
    const PT = G("REPUTATION_SHIP_POINTS");
    if (!PT) { M6C_STATS.errors++; M6C_STATS.lastError = "REPUTATION_SHIP_POINTS 不可用"; return; }
    const exp = { angel: 0, blood: 0, sansha: 0 };
    let unmapped = 0;
    for (const key of Object.keys(_repBatch.multi)) {
      const p = key.split("\u0001");
      const faction = p[0], cls = p[2] || "";
      if (!cls) { unmapped++; continue; }
      const pts = Number(PT[cls]) ? Number(PT[cls]) : Number(PT.frigate) || 1;
      exp[faction] += pts * _repBatch.multi[key];
    }
    M6C_STATS.unmapped += unmapped;
    const bad = [];
    for (const f of M6C_REP_FACTIONS) {
      const actual = m6cRepRead(state, f) - (Number(_repBatch.before[f]) || 0);
      if (actual !== exp[f]) bad.push(f + "：逐杀+" + actual + " vs 多重集+" + exp[f]);
    }
    M6C_STATS.shadowWaves++;
    if (bad.length) {
      M6C_STATS.mismatch++;
      M6C_STATS.lastMismatch = bad.join("；") + (unmapped ? "（unmapped=" + unmapped + "）" : "");
    }
  }
  // batch：每个 (faction, zoneId, class) 组合只调一次原函数，再补差额 —— 副作用链与逐杀**同源**
  function m6cFlushBatch(state) {
    const real = (typeof applyReputationKill === "function") ? applyReputationKill : null;
    if (!real) { M6C_STATS.errors++; M6C_STATS.lastError = "applyReputationKill 不可用"; return; }
    const ensure = G("ensureReputationState");
    if (typeof ensure === "function") ensure(state);   // 先规整一次 ⇒ 后续前后差读数干净
    const keys = Object.keys(_repBatch.multi);
    for (const key of keys) {
      const p = key.split("\u0001");
      const faction = p[0], zoneId = p[1] || null, enemyClass = p[2] || null;
      const n = _repBatch.multi[key];
      const before = m6cRepRead(state, faction);
      real(state, faction, zoneId, enemyClass);        // 权威算点 + ensureState/_dirty/刷新检查
      const after = m6cRepRead(state, faction);
      const pts = after - before;
      M6C_STATS.foldedCalls++;
      if (pts > 0 && n > 1) {
        const wk = state && state.reputation && state.reputation.weightedKills;
        if (wk) { wk[faction] = before + pts * n; M6C_STATS.saves += (n - 1); }
      }
    }
  }

  // ---- M6b 重放器：把一条账本条目**按其原语义**写回会话 ----
  // 严格镜像 recordKill 的账目形态（逐字同源，含分桶键与有序 push 位置）。
  // ⚠️ 只重建「击杀级」账目；不重建任何逐轮战斗量（fuel/iso/ammo 逐轮消耗、轮数、波次…）——
  //    那些不是击杀流的事实，属 M6b 显式排除面（见 §11.9(4) 排除清单）。
  function m6bApplyKill(state, s, e) {
    s.kills++;
    // 声望：applyReputationKill 的写入形态（weightedKills[faction] += SHIP_POINTS[class]）
    if (e.repFaction && e.repPoints != null) {
      const rk = (state.reputation = state.reputation || {});
      const wk = (rk.weightedKills = rk.weightedKills || {});
      wk[e.repFaction] = (Number(wk[e.repFaction]) || 0) + Number(e.repPoints);
    }
    if (e.kind) bump(s.killsByKind, e.kind, 1);
    if (e.zoneId) {
      bump(s.killsByZone, e.zoneId, 1);
      if (e.faction) {
        bump(s.killsByFaction, e.faction, 1);
        const fk = (s.killsByFactionKind[e.faction] = s.killsByFactionKind[e.faction] || { normal: 0, elite: 0, boss: 0 });
        bump(fk, e.kind, 1);
      }
    }
    s.iskDelta += Number(e.isk) || 0;
    s.lpDelta += Number(e.lp) || 0;
    const da = s.dropAccum;
    if (e.isDeathspace && e.siteId) {
      // 4) 首领战利品条目（有序；与 recordKill 的 `da.leader[site.id].push` 同形态）
      if (e.dsLeader && e.leaderCfg) {
        (da.leader[e.siteId] = da.leader[e.siteId] || []).push({
          wave: e.leaderCfg.wave, isFinal: e.leaderCfg.isFinal, core: true, proto: e.leaderCfg.proto
        });
      }
      // 1.75) 探针：**桶用 dsLeader**（不是 leaderCfg），条目键按账本的 probeKeys 逐配置建；
      //   resourceId/qty/两个 chance 是站点静态配置 ⇒ 用与 recordKill 同一个纯查询重建。
      if (Array.isArray(e.probeKeys) && e.probeKeys.length) {
        const _pFn = G("getDeathspaceProbeDropConfigs");
        const _siteFn = G("getDeathspaceById");
        const site = (typeof _siteFn === "function") ? _siteFn(e.siteId) : null;
        const pcfgs = (typeof _pFn === "function" && site) ? (_pFn(site) || []) : [];
        for (const key of e.probeKeys) {
          const cfg = pcfgs.find((p) => (e.siteId + "::" + p.resourceId) === key) || null;
          const pv = (da.probe[key] = da.probe[key] || {
            resourceId: cfg ? cfg.resourceId : String(key).slice(String(e.siteId).length + 2),
            qty: cfg ? cfg.qty : 0,
            normalChance: cfg ? cfg.normalChance : 0,
            bossChance: cfg ? cfg.bossChance : 0,
            normal: 0, boss: 0
          });
          pv[e.dsLeader ? "boss" : "normal"]++;
        }
      }
    } else if (e.zoneId) {
      if (e.kind === "elite" || e.kind === "boss") {
        const fd = (da.factionData[e.zoneId] = da.factionData[e.zoneId] || { elite: 0, boss: 0 });
        fd[e.kind]++;
        if (e.ticketKind) {
          const tk = (da.ticket[e.zoneId] = da.ticket[e.zoneId] || { elite: 0, boss: 0 });
          tk[e.kind]++;
        }
      }
      // 2) 区域特殊掉落：账本的 zsCfgs 已是「按配置展开」的有序序列 ⇒ 逐条 push（顺序即保真对象）
      if (Array.isArray(e.zsCfgs)) {
        for (const cfg of e.zsCfgs) {
          (da.zoneSpecial[e.zoneId] = da.zoneSpecial[e.zoneId] || []).push({
            resourceId: cfg.resourceId, qty: cfg.qty, kind: e.kind
          });
        }
      }
      if (e.stationCoreKind) {
        const sc = (da.stationCore[e.zoneId] = da.stationCore[e.zoneId] || { elite: 0, boss: 0 });
        sc[e.stationCoreKind]++;
      }
      if (e.cargoCls) {
        const cz = (da.cargo[e.zoneId] = da.cargo[e.zoneId] || {});
        const cm = (cz[e.cargoCls] = cz[e.cargoCls] || { normal: 0, elite: 0, boss: 0 });
        cm[e.kind]++;
      }
    }
    // 1.8 / 1.82：打捞臂 / MTU 计数（用**显式事实位**，不靠 isoSpent 反推）
    if (e.isoRec && e.salvageTier) {
      const sk = (s.salvageByTier = s.salvageByTier || {});
      const tk = (sk[e.salvageTier] = sk[e.salvageTier] || { normal: 0, elite: 0, boss: 0 });
      tk[e.kind] = (tk[e.kind] || 0) + 1;
    }
    if (e.mtuRec && e.mtuTier) {
      const mk = (s.mtuSalvageByTier = s.mtuSalvageByTier || {});
      const tk = (mk[e.mtuTier] = mk[e.mtuTier] || { normal: 0, elite: 0, boss: 0 });
      tk[e.kind] = (tk[e.kind] || 0) + 1;
    }
    // 5) 战术材料按 kind 累计 N
    if (e.kind === "elite") da.tactical.elite++;
    else if (e.kind === "boss") da.tactical.boss++;
    else da.tactical.normal++;
  }
  // 非逐杀资源账目点（清波 LP / 队列「部分清波」LP）：唯一效果是累加 s.lpDelta
  function m6bApplyRes(s, e) {
    s.lpDelta += Number(e.amount) || 0;
  }
  // 会话级账目点：flush 实读值的权威快照（含「无快照 ⇒ 回退实时求值」路径的实际取值）
  function m6bApplySess(s, e) {
    if (e.salvageSquadTotal != null) s.salvageSquadTotal = Number(e.salvageSquadTotal);
    else if (e.salvageSquadTotalLive != null) s.salvageSquadTotal = Number(e.salvageSquadTotalLive);
  }

  // ================================================================
  // M4-1（2026-09-19）L1b「稳态 O(1) 跳轮」守卫**命中率度量**（只读、零行为改动）
  //   方案依据：docs/OFFLINE_COMBAT_FASTPATH_PLAN_v0.4.md §5（L1b 阶跃边界）/ §6（双条件守卫）/ §9.3（新增指标）。
  //   **为什么必须先度量**：§11.7(2) 已证「真实玩家的带小队形态 ⇒ L1a 内核命中率 0」，
  //     而 L1b 的真实收益 = **守卫命中率 × 单位成本**（§9.3 原文）。没有命中率数字，
  //     任何 M4 投入判断都是猜 —— 这正是 §11.6(6) 警告的「优化了不痛的地方」。
  //   **设计约束（用户 2026-09-19 指令，逐条落地）**：
  //     · 开关 `globalThis.__OFFLINE_M4_L1B_STATS` **默认关闭**，与 M6a / M6b / M6c / 快通道**零交集**
  //       （本块不读 fpEnabled()、不读 m6cMode()、不写 M6*_STATS）；
  //     · **只读采样**：每轮把指纹压成一个 32 位滚动哈希、每波把签名压成一个哈希，
  //       **不写任何 state / s / c 字段**，不调用任何会改状态的函数；
  //     · 关闭时零开销：每处挂点首行 `if (!m4Enabled()) return;`；
  //     · 生产路径零调用（`m4Stats()/m4Reset()` 只由仓外验收探针调用）。
  //   ⚠️ **诚实声明（口径上界）**：指纹含 §6 条件 B 的可廉价读取子集 ——
  //     三层 HP / 燃料 / 弹药全类型 / 同位素 / 波内敌方总血量下降量 / 累计击杀数 / 存活攻击者数 /
  //     技能等级和 / 两战斗增强剂槽（itemId + remainingMs 分桶到秒）/ `adBuffMult` / `boosterDmg`。
  //     **不含**「开火集合与每门武器 roundDealt」（该实现只累计整轮 `roundDealt`，逐门值不在作用域）。
  //     漏掉的因子只会让稳定性被**高估** ⇒ 本度量给出的是**可跳轮数上界**，不是可实现值。
  // ================================================================
  const M4_M = 3;                  // §6 条件 B 的「连续 M 轮无状态变化」（起点值，非结论）
  const M4_STATS = {
    enabled: false,
    waves: 0,                      // 观测波数
    rounds: 0,                     // 观测总轮数（= L1b 的优化分母）
    pairs: 0,                      // 相邻轮配对数（漂移归因的分母）
    drift: {},                     // 逐分量漂移归因：分量 -> 「相对上一轮变化」的次数
    // ① §6 字面口径（含 c.hp 三层）
    ledgers: 0,                    // 波内建立「轮不变量账本」的波数（条件 B 命中）
    skippableRounds: 0,            // 可跳过轮数（**上界**；= 稳定点之后的轮数）
    // ② 仅我方侧口径（剔除 c.hp）
    ledgersPlayer: 0,
    skippableRoundsPlayer: 0,
    // ③ 差分（周期）口径：逐轮**差分**恒定（用户原始「跳相同周期」思路的可判定形式）
    ledgersDelta: 0,
    skippableRoundsDelta: 0,
    sigRepeatWaves: 0,             // 条件 A：本波签名 == 前一波签名
    sigFirstWaves: 0,              // 条件 A：签名首次出现
    maxStableRun: 0,               // ① 口径下观测到的最大连续稳定轮数
    maxStableRunPlayer: 0,         // ② 口径下
    maxStableRunDelta: 0,          // ③ 口径下
    runHistFull: {},               // ① 每波 maxStableRun 的直方图（桶：0..7 / 8+）
    runHistPlayer: {},             // ②
    runHistDelta: {},              // ③
    reject: {},                    // ① 未建立账本的原因直方图
    rejectPlayer: {},              // ②
    rejectDelta: {},               // ③
    byKind: {},                    // 波型分桶（scene + n + boss + squad）
    squadOnWaves: 0,               // 小队形态波数（该形态 L1a 本就被设计性拒绝）
    orphanRounds: 0,               // 无波归属的轮（试炼预判等非生产波循环路径）
    errors: 0
  };
  function m4Enabled() {
    try { return typeof globalThis !== "undefined" && Boolean(globalThis.__OFFLINE_M4_L1B_STATS); }
    catch (_) { return false; }
  }
  let _m4W = null;                 // 当前波采样状态
  let _m4PrevSig = -1;             // 上一波签名（条件 A 的对照）
  // 32 位滚动哈希（FNV-1a 变体）：零分配，只吃 number / string
  function m4Mix(h, x) { h ^= (x | 0); return Math.imul(h, 16777619) >>> 0; }
  function m4MixStr(h, str) {
    for (let i = 0; i < str.length; i++) h = m4Mix(h, str.charCodeAt(i));
    return h >>> 0;
  }
  // §6 条件 A：wave signature（n / 按序 kind+type / 各敌三层 maxHp / boss 逐轮机制位 / 光环 /
  //   弹药档位 / volleyFuel / 场景）
  function m4WaveSig(enemies, s, isDeathspace) {
    let h = 5381;
    h = m4Mix(h, enemies.length);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e) { h = m4Mix(h, -1); continue; }
      h = m4MixStr(h, String(e.kind || "?") + "|" + String(e.type || "?"));
      const mx = e.maxHp || { shield: 0, armor: 0, structure: 0 };
      h = m4Mix(h, Number(mx.shield) || 0);
      h = m4Mix(h, Number(mx.armor) || 0);
      h = m4Mix(h, Number(mx.structure) || 0);
      h = m4Mix(h, e.bossHealPct ? 1 : 0);
      h = m4Mix(h, Number(e.bossHealEvery) || 0);
      h = m4Mix(h, Number(e.repairSuppr) || 0);
      h = m4Mix(h, Number(e.enrageAt) || 0);
      h = m4Mix(h, Number(e.enrageMul) || 0);
      h = m4Mix(h, Number(e.auraDamage) || 0);
    }
    const tier = s.ammoTier || {};
    for (const k in tier) h = m4MixStr(h, k + "=" + String(tier[k]));
    h = m4Mix(h, Math.round(Number(s.volleyFuel) || 0));
    h = m4Mix(h, isDeathspace ? 1 : 0);
    return h >>> 0;
  }
  // §6 条件 B：逐轮指纹。**同时算两个**，因为这正是 M4 的第一个待答问题：
  //   ① `full`   = §6 字面口径（**含** `c.hp` 三层）
  //   ② `player` = 仅**我方侧**（剔除 `c.hp`）—— 对应 §4.1「是轮不变量」的那一列
  //      （玩家齐射伤害 expectedRng 恒 0.5 ⇒ variance 恒 1.0、弹药/燃料扣减、`volleyFuel`、技能 XP）。
  //   ⇒ 两者之差直接量化「防御侧真随机（actualRng×variance×Math.round）吃掉多少可跳轮数」。
  //   ⚠️ 同时给出**逐分量漂移归因**（`drift`）：只报「不稳定」是没用的，必须报「**哪个分量**在变」。
  function m4RoundComponents(state, c, s, inputs, hpDelta, killsTotal, livingN) {
    const comp = {};
    comp.hp = m4Mix(m4Mix(m4Mix(2166136261, Number(c.hp ? c.hp.shield : 0)),
      Number(c.hp ? c.hp.armor : 0)), Number(c.hp ? c.hp.structure : 0));
    comp.fuel = Math.round(Number(s.fuel) || 0);
    comp.iso = Math.round(Number(s.iso) || 0);
    let ah = 5381;
    const ammo = s.ammo || {};
    for (const k in ammo) ah = m4MixStr(ah, k + "=" + Math.round(Number(ammo[k]) || 0));
    comp.ammo = ah;
    comp.hpDelta = Math.round(hpDelta) || 0;
    comp.kills = killsTotal | 0;
    comp.living = livingN | 0;
    let sk = 0;
    const skl = state.skills || {};
    for (const k in skl) sk += Number(skl[k] && skl[k].lvl) || 0;
    comp.skills = sk | 0;
    let bh = 2166136261;
    const act = (state.boosters && state.boosters.active) || {};
    for (let i = 0; i < 2; i++) {
      const slot = i === 0 ? "combatWeapon" : "combatRepair";
      const e = act[slot];
      bh = m4MixStr(bh, slot + ":" + (e && e.itemId ? e.itemId : "-") + ":" +
        (e && e.itemId ? Math.round((Number(e.remainingMs) || 0) / 1000) : 0));
    }
    comp.boosters = bh;
    let dh = 2166136261;
    if (inputs) {
      dh = m4Mix(dh, Math.round((Number(inputs.adBuffMult) || 1) * 1000));
      const bd = inputs.boosterDmg || {};
      for (const k in bd) dh = m4MixStr(dh, k + "=" + Math.round((Number(bd[k]) || 1) * 10000));
      dh = m4Mix(dh, Math.round((Number(inputs.boosterRep) || 1) * 10000));
    }
    comp.adbuff = dh;
    return comp;
  }
  const M4_COMP_KEYS = ["hp", "fuel", "iso", "ammo", "hpDelta", "kills", "living", "skills", "boosters", "adbuff"];
  function m4FpFrom(comp, includeHp) {
    let h = 2166136261;
    for (let i = 0; i < M4_COMP_KEYS.length; i++) {
      const k = M4_COMP_KEYS[i];
      if (!includeHp && k === "hp") continue;
      h = m4MixStr(h, k + "=" + comp[k]);
    }
    return h >>> 0;
  }
  function m4WaveBegin(state, enemies, s, isDeathspace) {
    if (!m4Enabled()) return;
    try {
      M4_STATS.enabled = true;
      let n = 0, boss = 0;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e) continue;
        n++;
        if (e.bossHealPct > 0 || e.enrageMul > 0 || e.kind === "boss") boss++;
      }
      const squadOn = !!(state.combat && state.combat.squad && state.combat.squad.enabled === true);
      if (squadOn) M4_STATS.squadOnWaves++;
      _m4W = {
        sig: m4WaveSig(enemies, s, isDeathspace),
        scene: isDeathspace ? "ds" : "belt",
        n: n, boss: boss, squadOn: squadOn,
        rounds: 0,
        lastComp: null, prevNum: null,
        runFull: 0, runPlayer: 0, runDelta: 0,
        stableAtFull: -1, stableAtPlayer: -1, stableAtDelta: -1,
        maxRunFull: 0, maxRunPlayer: 0, maxRunDelta: 0
      };
      M4_STATS.waves++;
    } catch (_e) { M4_STATS.errors++; }
  }
  // ③ 「周期」口径（= 用户原始设计里的「精确模拟一个周期 → 批量跳 N 个相同周期」）：
  //   不要求**状态值不变**（那在含单调递减量时构造上不可能），而要求**逐轮差分恒定**。
  //   ⇒ 这才是「轮不变量」的可判定形式。数值取证：见 M4 报告 §(3)（fuel/ammo/booster 每轮 100% 变化）。
  function m4Numerics(state, c, s, inputs, hpDelta, killsTotal, livingN) {
    const ammo = s.ammo || {};
    const am = {};
    for (const k in ammo) am[k] = Math.round(Number(ammo[k]) || 0);
    const act = (state.boosters && state.boosters.active) || {};
    const bMs = [];
    for (let i = 0; i < 2; i++) {
      const e = act[i === 0 ? "combatWeapon" : "combatRepair"];
      bMs.push(e && e.itemId ? Math.round(Number(e.remainingMs) || 0) : 0);
    }
    let sk = 0;
    const skl = state.skills || {};
    for (const k in skl) sk += Number(skl[k] && skl[k].lvl) || 0;
    return {
      hpS: Math.round(Number(c.hp ? c.hp.shield : 0)),
      hpA: Math.round(Number(c.hp ? c.hp.armor : 0)),
      hpT: Math.round(Number(c.hp ? c.hp.structure : 0)),
      fuel: Math.round(Number(s.fuel) || 0),
      iso: Math.round(Number(s.iso) || 0),
      ammo: am, bMs: bMs, sk: sk | 0,
      eDrop: Math.round(hpDelta) || 0, kills: killsTotal | 0, living: livingN | 0
    };
  }
  function m4Fp3(cur, prev) {
    let h = 2166136261;
    if (!prev) return h >>> 0;   // 首轮无对照 ⇒ 记 0（必然与任何已存指纹不同 ⇒ 不构成稳定链）
    h = m4MixStr(h, "dHp=" + (cur.hpS - prev.hpS) + "," + (cur.hpA - prev.hpA) + "," + (cur.hpT - prev.hpT));
    h = m4MixStr(h, "dFuel=" + (cur.fuel - prev.fuel));
    h = m4MixStr(h, "dIso=" + (cur.iso - prev.iso));
    let dh = 5381;
    for (const k in cur.ammo) dh = m4MixStr(dh, k + "=" + (cur.ammo[k] - (prev.ammo[k] || 0)));
    h = m4MixStr(h, "dAmmo=" + dh);
    h = m4MixStr(h, "dB=" + (cur.bMs[0] - prev.bMs[0]) + "," + (cur.bMs[1] - prev.bMs[1]));
    h = m4MixStr(h, "eDrop=" + cur.eDrop + ",kills=" + cur.kills + ",living=" + cur.living + ",sk=" + cur.sk);
    return h >>> 0;
  }
  // 轮末采样（在 `prevEnemyHp = _eNow` **之前**调用；只读）
  function m4RoundTick(state, c, s, inputs, hpDelta, killsTotal, livingN) {
    if (!m4Enabled()) return;
    const w = _m4W;
    if (!w) { M4_STATS.orphanRounds++; return; }   // 试炼预判等路径：无波归属，显式登记而非静默
    try {
      const comp = m4RoundComponents(state, c, s, inputs, hpDelta, killsTotal, livingN);
      const fpF = m4FpFrom(comp, true), fpP = m4FpFrom(comp, false);
      const num = m4Numerics(state, c, s, inputs, hpDelta, killsTotal, livingN);
      const fp3 = m4Fp3(num, w.prevNum);
      w.rounds++;
      M4_STATS.rounds++;
      // ---- 逐分量漂移归因（相对上一轮）----
      if (w.lastComp) {
        for (let i = 0; i < M4_COMP_KEYS.length; i++) {
          const k = M4_COMP_KEYS[i];
          if (w.lastComp[k] !== comp[k]) M4_STATS.drift[k] = (M4_STATS.drift[k] || 0) + 1;
        }
        M4_STATS.pairs++;
      }
      w.lastComp = comp;
      w.prevNum = num;
      // ---- 三条连续稳定链 ----
      const prevF = w._fpF, prevP = w._fpP, prev3 = w._fp3;
      w._fpF = fpF; w._fpP = fpP; w._fp3 = fp3;
      if (prevF === fpF) w.runFull++; else w.runFull = 1;
      if (prevP === fpP) w.runPlayer++; else w.runPlayer = 1;
      if (prev3 === fp3) w.runDelta++; else w.runDelta = 1;
      if (w.stableAtFull < 0 && w.runFull >= M4_M) w.stableAtFull = w.rounds;
      if (w.stableAtPlayer < 0 && w.runPlayer >= M4_M) w.stableAtPlayer = w.rounds;
      if (w.stableAtDelta < 0 && w.runDelta >= M4_M) w.stableAtDelta = w.rounds;
      if (w.runFull > w.maxRunFull) w.maxRunFull = w.runFull;
      if (w.runPlayer > w.maxRunPlayer) w.maxRunPlayer = w.runPlayer;
      if (w.runDelta > w.maxRunDelta) w.maxRunDelta = w.runDelta;
      if (w.runFull > M4_STATS.maxStableRun) M4_STATS.maxStableRun = w.runFull;
      if (w.runPlayer > M4_STATS.maxStableRunPlayer) M4_STATS.maxStableRunPlayer = w.runPlayer;
      if (w.runDelta > M4_STATS.maxStableRunDelta) M4_STATS.maxStableRunDelta = w.runDelta;
    } catch (_e) { M4_STATS.errors++; }
  }
  // 波末汇总（紧跟 simulateWave 返回之后调用）
  function m4WaveEnd() {
    if (!m4Enabled()) return;
    const w = _m4W;
    _m4W = null;
    if (!w) return;
    try {
      // 条件 A：与前一波签名比较
      if (_m4PrevSig < 0) M4_STATS.sigFirstWaves++;
      else if (w.sig === _m4PrevSig) M4_STATS.sigRepeatWaves++;
      else M4_STATS.sigFirstWaves++;
      _m4PrevSig = w.sig;
      const key = w.scene + ":n" + w.n + (w.boss ? "+boss" : "") + (w.squadOn ? "+squad" : "");
      let bk = M4_STATS.byKind[key];
      if (!bk) bk = M4_STATS.byKind[key] = {
        waves: 0, rounds: 0, ledgers: 0, skippableRounds: 0,
        ledgersPlayer: 0, skippableRoundsPlayer: 0,
        ledgersDelta: 0, skippableRoundsDelta: 0,
        maxRunFull: 0, maxRunPlayer: 0, maxRunDelta: 0
      };
      bk.waves++; bk.rounds += w.rounds;
      if (w.maxRunFull > bk.maxRunFull) bk.maxRunFull = w.maxRunFull;
      if (w.maxRunPlayer > bk.maxRunPlayer) bk.maxRunPlayer = w.maxRunPlayer;
      if (w.maxRunDelta > bk.maxRunDelta) bk.maxRunDelta = w.maxRunDelta;
      M4_STATS.runHistFull[w.maxRunFull >= 8 ? "8+" : String(w.maxRunFull)] =
        (M4_STATS.runHistFull[w.maxRunFull >= 8 ? "8+" : String(w.maxRunFull)] || 0) + 1;
      M4_STATS.runHistPlayer[w.maxRunPlayer >= 8 ? "8+" : String(w.maxRunPlayer)] =
        (M4_STATS.runHistPlayer[w.maxRunPlayer >= 8 ? "8+" : String(w.maxRunPlayer)] || 0) + 1;
      M4_STATS.runHistDelta[w.maxRunDelta >= 8 ? "8+" : String(w.maxRunDelta)] =
        (M4_STATS.runHistDelta[w.maxRunDelta >= 8 ? "8+" : String(w.maxRunDelta)] || 0) + 1;
      // ---- ① §6 字面口径（含 HP）：Boss 逐轮机制（§5.3 必须回退）优先 ----
      let rF = null;
      if (w.boss > 0) rF = "boss-mechanic";
      else if (w.rounds <= M4_M) rF = "rounds<=M" + M4_M;
      else if (w.stableAtFull < 0) rF = "never-stable";
      if (!rF) {
        const skip = w.rounds - w.stableAtFull;
        M4_STATS.ledgers++;
        M4_STATS.skippableRounds += skip;
        bk.ledgers++; bk.skippableRounds += skip;
      } else {
        M4_STATS.reject[rF] = (M4_STATS.reject[rF] || 0) + 1;
      }
      // ---- ② 仅我方侧口径（剔除 HP）----
      let rP = null;
      if (w.boss > 0) rP = "boss-mechanic";
      else if (w.rounds <= M4_M) rP = "rounds<=M" + M4_M;
      else if (w.stableAtPlayer < 0) rP = "never-stable";
      if (!rP) {
        const skipP = w.rounds - w.stableAtPlayer;
        M4_STATS.ledgersPlayer++;
        M4_STATS.skippableRoundsPlayer += skipP;
        bk.ledgersPlayer++; bk.skippableRoundsPlayer += skipP;
      } else {
        M4_STATS.rejectPlayer[rP] = (M4_STATS.rejectPlayer[rP] || 0) + 1;
      }
      // ---- ③ 差分（周期）口径 ----
      let r3 = null;
      if (w.boss > 0) r3 = "boss-mechanic";
      else if (w.rounds <= M4_M) r3 = "rounds<=M" + M4_M;
      else if (w.stableAtDelta < 0) r3 = "never-stable";
      if (!r3) {
        const skip3 = w.rounds - w.stableAtDelta;
        M4_STATS.ledgersDelta++;
        M4_STATS.skippableRoundsDelta += skip3;
        bk.ledgersDelta++; bk.skippableRoundsDelta += skip3;
      } else {
        M4_STATS.rejectDelta[r3] = (M4_STATS.rejectDelta[r3] || 0) + 1;
      }
    } catch (_e) { M4_STATS.errors++; }
  }

  // 会话聚合器：key = offline runId（applyOfflineGains 每次离线结算唯一）
  const _sessions = {};
  let _predSeq = 0;               // 虫洞试炼预判的临时会话序号

  function ensureSession(runId) {
    if (!_sessions[runId]) {
      _sessions[runId] = {
        runId: runId,
        startedAt: null, endedAt: null, simulatedSeconds: 0,
        mode: null, roundsEstimated: 0, kills: 0,
        killsByFaction: {}, killsByZone: {}, killsByKind: {},
        killsByFactionKind: {},
        wavesByZone: {}, zoneClearsByZone: {},
        deathspaceEntriesById: {}, deathspaceWavesById: {}, deathspaceClearsById: {},
        chainContinuations: 0, ticketsConsumed: 0, defeats: 0, repairsCompleted: 0,
        totalDamageDealt: 0, totalDamageTaken: 0, maxSingleHit: 0, noDamageClears: 0,
        maxWaveReached: 0,
        iskDelta: 0, lpDelta: 0,
        resourceNet: {},
        lootGained: {}, // v2：仅累计战斗自身产生的正向掉落（负耗不进），供战斗日志使用
        runs: 0, runsDetail: [],
        firstCrossings: {
          firstKill: null, firstWaveClear: null, firstZoneClear: null,
          firstDeathspaceEntry: null, firstDeathspaceClear: null,
          firstChainContinuation: null, firstDefeat: null, firstRepairComplete: null
        },
        stopReason: null,
        // 会话级虚拟弹药/燃料（跨段累计，flush 一次性 apply）
        ammo: {}, fuel: 0, ammoInit: {}, fuelInit: 0,
        ammoRead: false,
        // 掉落累计（按 category 累计 N 与精英/Boss 细分）
        dropAccum: {
          factionData: {},  // key: zoneId -> {elite, boss}
          zoneSpecial: {}, // key: zoneId -> [{resourceId, qty, elite, boss}]
          ticket: {},      // key: zoneId -> {elite, boss}
          leader: {},      // key: siteId -> [{wave, isFinal, core, proto}]
          stationCore: {}, // key: zoneId -> {elite, boss}（Tier3 四核心，唯一产出）
          cargo: {},       // key: zoneId -> { class -> {normal, elite, boss} }（货柜，按船级+kind 计数）
          probe: {},       // key: siteId -> {resourceId, qty, normal, boss}（死亡空间势力探针本体）
          tactical: { normal: 0, elite: 0, boss: 0 }
        },
        activeAtStart: false
      };
    }
    return _sessions[runId];
  }

  // 性能优化（2026-09-20）：离线仿真期间的会话级只读装备缓存槽。
  // 装备在离线会话内恒定（offline-combat / offline / legion-combat-squad / combat
  // 对 equipment.instances 与 enhancementLevel 的写操作均为 0 处，已证）⇒ 可安全记忆化。
  // 槽默认 null（在线零影响）；只包住仿真段，finally 复位（保存/恢复，支持嵌套与异常路径）。
  // ⚠️ 禁跨会话复用（玩家可能在两次离线之间强化 / 更换装备）。
  // ⚠️ `wraps` = 槽**包装**次数（beginOfflinePerfCache/endOfflinePerfCache 成对执行一次即 +1），
  //     **不等于**「缓存生效」—— 反向对照臂（setter 置 no-op）下 wraps 仍会 +1 而命中数恒为 0。
  //     判断「优化是否真生效」必须看 refHit/modHit，不能看 wraps。
  const PERF_CACHE_STATS = { refHit: 0, refMiss: 0, modHit: 0, modMiss: 0, wraps: 0 };
  function beginOfflinePerfCache() {
    if (typeof getOfflinePerfCache !== "function" || typeof setOfflinePerfCache !== "function") return null;
    const prev = getOfflinePerfCache();
    const cache = { modules: Object.create(null), refs: new WeakMap(), refHit: 0, refMiss: 0, modHit: 0, modMiss: 0 };
    setOfflinePerfCache(cache);
    return { prev: prev, cache: cache };
  }
  function endOfflinePerfCache(handle) {
    if (!handle) return;
    setOfflinePerfCache(handle.prev);
    const c = handle.cache;
    PERF_CACHE_STATS.refHit += c.refHit; PERF_CACHE_STATS.refMiss += c.refMiss;
    PERF_CACHE_STATS.modHit += c.modHit; PERF_CACHE_STATS.modMiss += c.modMiss;
    PERF_CACHE_STATS.wraps++;
  }

  function recordFirst(s, key, now) {
    if (s.firstCrossings[key] === null && typeof now === "number" && Number.isFinite(now)) {
      s.firstCrossings[key] = now;
    }
  }
  function bump(obj, key, n) { obj[key] = (obj[key] || 0) + (n || 1); }

  // ---- 读取战斗输入（每波开始从真实状态重读，符合指令三）----
  function readInputs(state, nowRef) {
    const combat = state.combat;
    const ship = G("getActiveShip")(state);
    const shipInstance = G("getActiveCombatShipInstance")(state);
    const zone = G("getCombatEncounterZone")(combat);
    const faction = zone ? zone.faction : null;
    const weapons = G("getInstalledCombatWeapons")(state).filter(m => m.equipment && m.equipment.combat && m.equipment.combat.kind === "weapon");
    const repairers = G("getInstalledCombatRepairers")(state); // 已按 combat.kind==="repair" 过滤（与在线 advanceCombatRound:825 同来源，勿再二次过滤）
    const maxHp = G("calcCombatMaxHp")(undefined, undefined, state);
    const playerDodge = G("calcPlayerDodge")(undefined, state);
    const booster = (typeof G("getBoosterEffectState") === "function") ? G("getBoosterEffectState")(state) : null;
    const boosterDmg = booster ? booster.weaponDamageMultiplier : null;
    const boosterRep = booster ? booster.repairMultiplier : null;
    // 脑突触加速剂（广告激励增益）：独立乘区 ×1.3，离线战斗按虚拟时间 nowRef.t 判断是否生效，
    // 避免 getAdBuffMultiplier 默认取 Date.now() 导致过去/未来时段判断错误。
    const adBuffRef = (nowRef && typeof nowRef.t === "number") ? nowRef.t : undefined;
    const adBuffMult = (typeof G("getAdBuffMultiplier") === "function") ? G("getAdBuffMultiplier")(state, adBuffRef) : 1;
    // 2026-09-12（离线数值口径修复）：联盟「前线作战指挥部」战斗伤害加成。
    // 在线 combat.js:1524-1525 已并入玩家齐射乘区；离线此前**完全没有接线**（本文件零
    // alliance 引用）⇒ 离线玩家伤害恒低 2%~10%（按指挥部等级），与「离线开炮次数多但
    // 击杀少」的现象一致。此处读一次，常规齐射与泰坦管线共用。
    const allianceDamageMult = (typeof AllianceBuildingConfig !== "undefined" && state.alliance && state.alliance.buildings)
      ? 1 + AllianceBuildingConfig.effects(state.alliance.buildings).combatDamageBonus : 1;
    // 泰坦离线接线（阶段 3 步骤 5）：type "titan" 时主武器/核心走泰坦管线。
    // D2=A（2026-09-11 用户拍板）后 tt_high 释放的高槽可挂常规副武器，inputs.weapons 不再恒为空，
    // 主武器与副武器分账结算（见 simulateWave 内 convFire / titanMainFire 双 gate）。
    // 公式真值全部来自 titans.js / capital-combat.js 纯函数，此处只做期望值接线：
    //   暴击 → rollTitanCritMultiplier(crit, null) 期望乘数 1 + chance×(multiplier−1)；
    //   破片回响 → 期望 chance×damage 预缩放后经 resolver 解析目标（不经概率掷骰）。
    const isTitan = (typeof G("isTitanCombatShip") === "function") && G("isTitanCombatShip")(ship);
    const titanWeapon = isTitan ? (ship.weapon || null) : null;
    const titanCore = isTitan ? (ship.core || null) : null;
    const titanTrait = isTitan ? ((typeof G("getTitanCombatTrait") === "function") ? G("getTitanCombatTrait")(ship) : null) : null;
    // ②-a（2026-09-10 用户拍板）：光环源改为小队聚合（玩家出战舰 + 小队内 NPC 绑定泰坦，stacking=max），
    // 与在线 combat.js 同口径；LEGION_COMBAT_SQUAD 缺失时回退为原「只读玩家自身核心」。
    const titanAuraApi = (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && typeof LEGION_COMBAT_SQUAD.getTitanSquadAura === "function") ? LEGION_COMBAT_SQUAD : null;
    const titanAura = titanAuraApi ? titanAuraApi.getTitanSquadAura(state)
      : ((titanCore && typeof G("getTitanCoreAura") === "function") ? G("getTitanCoreAura")(titanCore) : null);
    return { ship, shipInstance, zone, faction, weapons, repairers, maxHp, playerDodge, boosterDmg, boosterRep, adBuffMult, allianceDamageMult, isTitan, titanWeapon, titanCore, titanTrait, titanAura };
  }

  // ---- 虚拟弹药/燃料（会话级，跨段累计）----
  function ensureVirtualAmmoFuel(state, s) {
    if (s.ammoRead) return;
    s.ammoRead = true;
    const RR = G("ResourceRegistry");
    const weapons = G("getInstalledCombatWeapons")(state);
    const ammoMap = {};
    for (const m of weapons) {
      const cb = m.equipment && m.equipment.combat;
      if (cb && cb.weaponType) ammoMap[cb.weaponType] = (ammoMap[cb.weaponType] || 0) + (cb.ammoCost || 1);
    }
    s.ammo = {}; s.ammoInit = {}; s.ammoTier = {};
    for (const type in ammoMap) {
      const cur = getSelectedCount(state, type);
      s.ammo[type] = cur; s.ammoInit[type] = cur;
    }
    // M4：军团 NPC 战斗小队——虚拟弹药池必须并集播种「玩家武器类型 ∪ 小队 NPC 武器类型」，
    // 否则玩家用激光、NPC 用导弹时 s.ammo["missile"] 不存在 → NPC 恒判 0 弹药静默停火。
    // flush 遍历 ammoInit 键统一 apply，扩种后自动纳入净消耗，不会重复扣费。
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD &&
        state.combat.squad && state.combat.squad.enabled === true &&
        typeof LEGION_COMBAT_SQUAD.getSquadAmmoRequirements === "function") {
      const squadAmmo = LEGION_COMBAT_SQUAD.getSquadAmmoRequirements(state, { zone: G("getCombatEncounterZone")(state.combat) });
      for (const type in squadAmmo) {
        if (!(type in s.ammoInit)) {
          const cur = getSelectedCount(state, type);
          s.ammo[type] = cur; s.ammoInit[type] = cur;
        }
      }
    }
    // 泰坦主武器弹药（阶段 3 步骤 5）：主武器为舰体自带、不在 fitting 表内，
    // getInstalledCombatWeapons 不会包含它，弹药池必须补种主武器同池类型（laser/missile/cannon），
    // 否则泰坦恒判 0 弹药静默停火。（D2=A 后高槽副武器走常规 weapons 通道，已由上一步播种。）
    const _titanShip = G("getActiveShip")(state);
    if (_titanShip && typeof G("isTitanCombatShip") === "function" && G("isTitanCombatShip")(_titanShip)
        && _titanShip.weapon && (_titanShip.weapon.ammoCost || 0) > 0) {
      const tType = _titanShip.weapon.weaponType;
      if (!(tType in s.ammoInit)) {
        const curT = getSelectedCount(state, tType);
        s.ammo[tType] = curT; s.ammoInit[tType] = curT;
      }
    }
    s.fuel = RR.get(state, "consumable:fuel");
    s.fuelInit = s.fuel;
    // 同位素标记打捞臂：主动打捞同位素消耗（会话级虚拟余额，跨段累计，flush 一次性 apply；与燃料同机制）
    s.iso = RR.get(state, "planetary:同位素");
    s.isoInit = s.iso;
  }
  function canFireVirtual(inputs, zone, s, state) {
    if (!inputs.weapons || inputs.weapons.length === 0) return false;
    if (s.fuel <= 0) { s.blockedBy = "fuel"; return false; }
    // 与 combat.js 同算法：每种武器类型累计 ammoCost，全部满足才开火；优先高级预存档位
    const need = {};
    for (const m of inputs.weapons) {
      const cb = m.equipment.combat;
      need[cb.weaponType] = (need[cb.weaponType] || 0) + (cb.ammoCost || 1);
    }
    s.ammoTier = {};
    for (const type in need) {
      const stacks = getSelectedStacks(state, type);
      s.ammoTier[type] = stacks.length ? stacks[0].tier : "T1";
      if ((s.ammo[type] || 0) < need[type]) { s.blockedBy = "ammo"; return false; }
    }
    return true;
  }
  function consumeVolleyVirtual(inputs, zone, s) {
    const RR = G("ResourceRegistry");
    const need = {};
    for (const m of inputs.weapons) {
      const cb = m.equipment.combat;
      need[cb.weaponType] = (need[cb.weaponType] || 0) + (cb.ammoCost || 1);
    }
    for (const type in need) s.ammo[type] = (s.ammo[type] || 0) - need[type];
    const volleyFuel = G("computeVolleyFuel")(_stateRef, zone);
    s.fuel = Math.max(0, s.fuel - volleyFuel);
    return volleyFuel;
  }
  // computeVolleyFuel 需要 state；用模块级 _stateRef 捕获当前 state
  let _stateRef = null;

  // ================================================================
  // 泰坦离线接线（阶段 3 步骤 5）：虚拟资源池 + 期望值开火管线
  //   · 资源与常规武器同机制：会话级 s.fuel / s.ammo 虚拟池，flush 一次性 apply；
  //   · 伤害统计等效：暴击用期望乘数（rollTitanCritMultiplier 传非函数 rng），
  //     破片回响按期望 chance×damage 预缩放；sweep 每发吃暴击期望（appliesToSweep）；
  //   · 回合号口径：与离线 boss 治疗一致用波内轮号 rounds+1（在线为 c.roundSeq，
  //     everyRounds 周期触发按期望等频，相位差 ±1 轮不改变统计等效性）。
  // ================================================================
  const TITAN_ZERO_RNG = function () { return 0; }; // 预缩放后经 resolver：概率门恒通过、randomOther 取首个存活（伤害总量等期望）

  function titanVolatileFuel(state, inputs, zone) {
    const fuelMult = G("calcFuelMult")(zone, state);
    const weapon = inputs.titanWeapon;
    const volleyFuel = Math.max(1, Math.round((weapon.fuelCost || 0) * fuelMult));
    let sustainFuel = 0;
    const core = inputs.titanCore;
    if (core && core.consumption && core.consumption.mode === "sustain") {
      const base = Math.round((weapon.fuelCost || 0) * (core.consumption.fuelPctOfVolley || 0));
      if (base > 0) sustainFuel = Math.max(1, Math.round(base * fuelMult));
    }
    return { volleyFuel: volleyFuel, sustainFuel: sustainFuel };
  }

  // 泰坦开火前置检查（对照常规 canFireVirtual）：武器存在 + 虚拟燃料够 + 虚拟弹药够
  function canFireTitanVirtual(state, inputs, zone, s) {
    if (!inputs.titanWeapon) { s.blockedBy = "no-titan-weapon"; return false; }
    const fuel = titanVolatileFuel(state, inputs, zone);
    if (s.fuel < fuel.volleyFuel + fuel.sustainFuel) { s.blockedBy = "fuel"; return false; }
    const ammoCost = inputs.titanWeapon.ammoCost || 0;
    if (ammoCost > 0) {
      const stacks = getSelectedStacks(state, inputs.titanWeapon.weaponType);
      s.ammoTier[inputs.titanWeapon.weaponType] = stacks.length ? stacks[0].tier : "T1";
      if ((s.ammo[inputs.titanWeapon.weaponType] || 0) < ammoCost) { s.blockedBy = "ammo"; return false; }
    }
    return true;
  }

  // 泰坦虚拟齐射：乘区链与在线 fireTitanVolley（combat.js:1388）逐行对齐，伤害用期望值口径
  function fireTitanVolleyVirtual(state, inputs, target, enemies, zone, s, titanRound, expectedRng) {
    const weapon = inputs.titanWeapon;
    const core = inputs.titanCore;
    const titanTrait = inputs.titanTrait;
    const titanAura = inputs.titanAura;
    const c = state.combat;
    const fuel = titanVolatileFuel(state, inputs, zone);
    const titanFuelNeeded = fuel.volleyFuel + fuel.sustainFuel;
    // 虚拟池扣减（flush 一次性 apply）
    s.fuel = Math.max(0, s.fuel - titanFuelNeeded);
    let ammoProps = getAmmoTierProps("T1");
    const ammoCost = weapon.ammoCost || 0;
    if (ammoCost > 0) {
      const stacks = getSelectedStacks(state, weapon.weaponType);
      s.ammoTier[weapon.weaponType] = stacks.length ? stacks[0].tier : "T1";
      s.ammo[weapon.weaponType] = Math.max(0, (s.ammo[weapon.weaponType] || 0) - ammoCost);
      ammoProps = getAmmoTierProps(s.ammoTier[weapon.weaponType] || "T1");
    }
    grantXp(state, "capacitorManagement", titanFuelNeeded * 0.3);
    // 主目标血量比例（与在线同口径）
    const targetTotal = target.hp.shield + target.hp.armor + target.hp.structure;
    const targetMaxHp = target.maxHp ? (target.maxHp.shield + target.maxHp.armor + target.maxHp.structure) : targetTotal;
    const targetHpRatio = targetMaxHp > 0 ? targetTotal / targetMaxHp : 1;
    const rd = G("getTitanWeaponRoundDamage")(weapon, { round: titanRound, targetHpRatio: targetHpRatio });
    const vulnMult = G("getTitanDamageTakenMultiplier")(target, titanRound);
    // 乘区：克制 × 结构过载(B案) × 光环(含泰坦自身) × 易伤 × 弹药档 × 武器强化剂 × 脑突触 × 暴击期望
    // 武器强化剂（2026-09-10 用户拍板 3a）：与在线 fireTitanVolley 同口径，主命中与扫掠/贯穿打击同享。
    const counterMult = G("calcWeaponCounterMultiplier")(weapon.weaponType, target.hp);
    const overdriveMult = G("getTitanStructureOverdriveMultiplier")(titanTrait, c.hp, c.maxHp);
    const selfAuraDmg = titanAura ? (1 + (titanAura.squadDamageBonus || 0)) : 1;
    const adbm = inputs.adBuffMult || 1;
    const wbm = (inputs.boosterDmg && inputs.boosterDmg[weapon.weaponType]) ? inputs.boosterDmg[weapon.weaponType] : 1;
    // 2026-09-12：联盟战斗伤害加成（与在线 fireTitanVolley 同口径补齐）。
    const adm = inputs.allianceDamageMult || 1;
    const critExp = G("rollTitanCritMultiplier")(weapon.crit, null); // 非函数 rng → 期望乘数
    // 全补（2026-09-10 用户拍板）：泰坦三层同吃 getCombatDamageMultiplierFromState（与在线同口径）
    const titanDmgMult = (typeof G("getCombatDamageMultiplierFromState") === "function")
      ? G("getCombatDamageMultiplierFromState")(state, weapon.weaponType) : 1;
    let mult = counterMult * overdriveMult * selfAuraDmg * vulnMult * ammoProps.dmgMult * wbm * critExp * titanDmgMult * adm;
    if (adbm && adbm !== 1) mult *= adbm;
    // A1（2026-09-10 用户拍板）：命中走与常规武器同一条管线，基数用泰坦自带 baseHit
    //   （100/130/80 差异化保留），再叠 武器技能×4 + 目标锁定×3 + 船体 hitBonus + 光环 squadHitBonus。
    const titanHitBase = (typeof G("getCombatWeaponHitFromState") === "function")
      ? G("getCombatWeaponHitFromState")(state, weapon.weaponType, { baseHit: weapon.baseHit })
      : (Number(weapon.baseHit) || 100);
    const titanAuraHitBonus = (titanAura && Number(titanAura.squadHitBonus)) ? Number(titanAura.squadHitBonus) : 0;
    const titanHit = (titanHitBase + titanAuraHitBonus) * ammoProps.hitMult;
    const damage = G("calcCombatDamage")(titanHit, target.dodge, rd.mainDamage, mult, expectedRng);
    const mainDealt = G("applyLayeredCombatDamage")(target.hp, damage);
    let roundDealt = mainDealt.shield + mainDealt.armor + mainDealt.structure;
    // 附带打击：retriggerSweep 按期望 chance×damage 预缩放后经 resolver 解析目标（概率门恒通过）
    const extraRaw = G("getTitanExtraAttacks")(weapon, { round: titanRound, targetHpRatio: targetHpRatio });
    const scaled = (Array.isArray(extraRaw) ? extraRaw : []).map(st => (st && st.kind === "retriggerSweep")
      ? Object.assign({}, st, { damage: Math.round((st.damage || 0) * (Number(st.chance) || 0)) })
      : st);
    const strikes = G("resolveTitanWeaponStrikes")(scaled, weapon, enemies, target, TITAN_ZERO_RNG);
    const sweepCritExp = (weapon.crit && weapon.crit.appliesToSweep) ? critExp : 1;
    for (const strike of strikes) {
      let strikeDmg = strike.damage * vulnMult * wbm * sweepCritExp * titanDmgMult * adm;
      if (adbm && adbm !== 1) strikeDmg *= adbm;
      strikeDmg = Math.max(1, Math.round(strikeDmg));
      if (strike.kind === "layerPierce") {
        // 透层：主命中最深层确定起始层，从下一层起吸收（命中结构不触发）
        const pd = G("applyTitanLayerPierceDamage")(target.hp, mainDealt, strikeDmg);
        roundDealt += pd.shield + pd.armor + pd.structure;
      } else {
        const d = G("applyLayeredCombatDamage")(strike.enemy.hp, strikeDmg);
        roundDealt += d.shield + d.armor + d.structure;
      }
    }
    // 武器 XP（与在线同口径：泰坦武器技能 10 + 瞄准 1；普通武器见 fireNormalVolley 为 2）
    const weaponCfg = WEAPON_CONFIG[weapon.weaponType];
    if (weaponCfg) grantXp(state, weaponCfg.skillKey, 10);
    grantXp(state, "targeting", 1);
    return roundDealt;
  }

  // ---- 损伤控制单元（DCU）减伤：与在线 combat.js:1075-1084,1201 严格一致 ----
  // 每个 DCU 按 fuelCost*calcFuelMult 消耗虚拟燃料（会话级 s.fuel，flush 一次性 apply），
  // 求和 globalDamageReduction 后封顶 50%；返回该轮玩家承伤的减伤系数。
  function computeDcReduction(state, zone, s) {
    const dcs = G("getInstalledCombatDamageControls")(state);
    if (!dcs || dcs.length === 0) return 0;
    let dc = 0;
    for (const m of dcs) {
      const cb = m.equipment && m.equipment.combat;
      if (!cb) continue;
      const fuelCost = Math.max(1, Math.round((cb.fuelCost || 1) * G("calcFuelMult")(zone, state)));
      if (s.fuel < fuelCost) continue; // 燃料不足则该 DCU 本轮不生效（与在线一致）
      s.fuel = Math.max(0, s.fuel - fuelCost);
      // 2026-09-10 修复：DCU 减伤补乘强化系数（与在线 combat.js 同步，全局百分比加成口径）
      dc += ((m.equipment.bonuses && m.equipment.bonuses.globalDamageReduction) || 0) * (Number(m.multiplier) || 1);
    }
    return Math.min(0.5, dc);
  }

  function addResource(s, id, delta) {
    if (!delta) return;
    s.resourceNet[id] = (s.resourceNet[id] || 0) + delta;
    // v2：正向掉落累计进 lootGained（燃料/弹药/同位素等负消耗 delta<0，自然不进）。
    if (delta > 0 && id) s.lootGained[id] = (s.lootGained[id] || 0) + delta;
  }

  // ---- XP（直接调 state-aware 函数，无事件；每波后重读技能）----
  // M3（2026-09-19）：额外做一次「该技能等级是否真的变化」的检测，供 L1a 递推内核失效缓存
  // （_skillEpoch）。关闭快通道时它只是一个计数器自增，不改变任何行为 —— 也只多两次属性读。
  let _skillEpoch = 0;
  function grantXp(state, skillId, amount) {
    const fn = G("addStationModifiedCombatXp");
    if (typeof fn === "function" && amount) {
      const before = (state.skills && state.skills[skillId] && Number(state.skills[skillId].lvl)) || 0;
      fn(state, skillId, amount, "combat");
      const after = (state.skills && state.skills[skillId] && Number(state.skills[skillId].lvl)) || 0;
      if (after !== before) _skillEpoch++;
    }
  }

  // ================================================================
  // M3（2026-09-19）L1a「精确递推内核」
  //   方案：docs/OFFLINE_COMBAT_FASTPATH_PLAN_v0.4.md §4.3 路线 B / §11.3（M3 实测）/ §13 M3。
  //   **设计约束（用户 2026-09-19 指令，逐条落地）**：
  //     · 只做「把波内 / 段内不变量提到会话级算一次」的**等价重写** ⇒ 同序同公式 ⇒ 逐位精确，零近似；
  //     · **不改资源扣减粒度**（Q1 结论：拒绝对 resource:changed 做批量等价，也不事后补发事件）；
  //     · 开关 `globalThis.__OFFLINE_COMBAT_FASTPATH` **默认关闭** ⇒ K=null ⇒ 每处分支都落回原实现，
  //       关闭时逐字节不变（M0 零侵入性质保持）。
  //   **缓存的变化源（依赖分析结论，2026-09-19 修正后）**——原判断「唯一变化源 = 技能等级 + 增强剂」
  //     已被两轮实测**逐步证伪**，现列全四类（任何一类被漏掉都会静默产生分歧）：
  //     ① **技能等级变化**（skills[].lvl）→ `_skillEpoch`（见 grantXp 内前后值比较）。
  //        ⚠️ 重算点必须与原实现的调用点重合（见 K.syncDerived 上方注释：技能可在轮内升级，
  //        只在轮末刷新会差 1 —— 实测 SKILL=lvl1 时第 78 轮燃料 −1）。
  //     ② **声望驱动的有效技能 +1**（getCombatSkillLevelFromState 对「对应势力 score > 0」level+1），
  //        而 getScores 是**相对分**（total − 3·raw）⇒ 击杀任一势力会同时改另两方符号。
  //        此时 skills[].lvl 一字未动 ⇒ 只认 ① 会静默失效 → `repBandKey`（三势力符号位）。
  //        实测（angel_outer_reach）：第 5 轮起 hit 2220→2224、dmgMult 8.75→8.9375、RNG 少抽 63 次。
  //     ③ **跨段变化**：会话（含 s._l1a）按 runId **跨段复用**，而段间另有子系统会改 ①/② 的输入 ——
  //        研究完成、军团 NPC tick（军团贡献乘区）、空间站 / 队列。它们**既不进 _skillEpoch 也不改声望**
  //        ⇒ 只能由 `settle()` **段首强制失效**覆盖。承重性已由 `_verify_offline_seg_settle.mjs`
  //        A5/A8a/A8b 实测证明（摘掉该行即分歧；且它是该段唯一的刷新来源）。
  //     ④ **增强剂 / 脑突触**：与技能无关 ⇒ 按轮刷新 boosterDmg / boosterRep / adBuffMult
  //        （与 readInputs 同源同值），不进本缓存。
  //   **不回退原路径（K 仍可建）**：星带 / 死亡空间 / Boss 波 / 残血承接 / 打捞臂 / 低燃低弹 / 停摆。
  //   **必须回退原路径（K=null）**：泰坦（另一套 gate，且 fireTitanVolleyVirtual 自行写 s.ammoTier）、
  //     小队（NPC 独立弹药池 + ammoTierFor 读 s.ammoTier 的**部分写**语义）。
  // ================================================================
  function fpKernelReject(state, inputs) {
    const ships = inputs.ship;
    if (ships && typeof G("isTitanCombatShip") === "function" && G("isTitanCombatShip")(ships)) return "titan";
    if (state.combat && state.combat.squad && state.combat.squad.enabled === true) return "squad";
    return "";
  }
  // 逐轮指纹轨迹（**仅验收用**）：__OFFLINE_COMBAT_FASTPATH_TRACE 未设置时零成本。
  let _fpTrace = null;
  function fpTraceEnabled() {
    try { return typeof globalThis !== "undefined" && Boolean(globalThis.__OFFLINE_COMBAT_FASTPATH_TRACE); }
    catch (_) { return false; }
  }
  function fpTracePush(state, c, s, enemyHp) {
    if (!fpTraceEnabled()) return;
    if (_fpTrace === null) _fpTrace = [];
    const rs = (c && c.randomState) || {};
    // 技能等级总和（廉价聚合）：任何一门技能升级都会改变它 ⇒ 可定位「技能阶跃发生在第几轮」
    let sk = 0;
    const skl = (state && state.skills) || {};
    for (const k in skl) sk += Number(skl[k] && skl[k].lvl) || 0;
    _fpTrace.push({
      hp: [c && c.hp ? c.hp.shield : 0, c && c.hp ? c.hp.armor : 0, c && c.hp ? c.hp.structure : 0],
      fuel: s.fuel, ammo: Object.assign({}, s.ammo || {}), iso: s.iso,
      enemyHp: enemyHp, sk: sk, lo: rs.counterLo, hi: rs.counterHi
    });
  }
  // 内核缓存签名：整段离线内「配装 / 出战舰 / 区域」不变 ⇒ 会话级复用，省钱的是
  // 每次波级重建的模块解析（实测波均 2.54 轮，波级固定成本会吃掉大半收益）。
  function fpKernelSig(zone, inputs) {
    const inst = inputs.shipInstance;
    const sid = inst ? (inst.instanceId != null ? inst.instanceId : inst.id) : "";
    const wt = [];
    for (const m of inputs.weapons) wt.push(m.equipment && m.equipment.id ? m.equipment.id : "?");
    const rt = [];
    for (const m of inputs.repairers) rt.push(m.equipment && m.equipment.id ? m.equipment.id : "?");
    return String(zone && zone.id) + "|" + String(sid == null ? "" : sid) + "|" + wt.join(",") + "|" + rt.join(",");
  }
  // ⭐ 内核派生缓存的**第二把失效钥匙**（2026-09-19 修复，真实存档 + V2 保序样本实测暴露）：
  // getCombatSkillLevelFromState() 会因「对应势力声望 score > 0」给战斗技能**白送 +1 级**，
  // 而声望是**相对分**（reputation.js getScores：score[f] = total − 3·raw[f]），
  // 击杀**任一**势力都会同时改变另两方的分 —— 于是「打苍穹 → 赤誓声望转正 → laserOps +1」，
  // 有效技能等级在结算**中途**变化，但 state.skills[].lvl 一字未动 ⇒ 只认 _skillEpoch 的缓存永不失效。
  // 实测后果（angel_outer_reach / L80，5×大型激光）：第 5 轮起 hit 2220→2224、dmgMult 8.75→8.9375，
  // 伤害每轮漂 75，全会话 RNG 计数少抽 63 次，逐轮轨迹从第 5 轮起全长分歧。
  // ⇒ 必须把三条声望分的**符号位**并入失效判据（不能只看被杀势力：相对分决定符号）。
  // 成本：每轮一次 getFactionReputationScores（单次 ensureState + 3 次算术），约 1µs/轮。
  function repBandKey(state) {
    const gs = G("getFactionReputationScores");
    if (typeof gs !== "function") return "";
    let sc = null;
    try { sc = gs(state); } catch (_) { return ""; }
    if (!sc) return "";
    return (Number(sc.angel) > 0 ? "1" : "0") + (Number(sc.blood) > 0 ? "1" : "0") + (Number(sc.sansha) > 0 ? "1" : "0");
  }
  function makeWaveKernel(state, zone, s, nowRef, inputs) {
    const sig = fpKernelSig(zone, inputs);
    let c = s._l1a;
    if (!c || c.sig !== sig) {
      // ---- 弹种需求 / 换档档位（真实库存只在 flush 变化 ⇒ 会话内恒定）----
      const need = {};
      for (const m of inputs.weapons) {
        const cb = m.equipment.combat;
        need[cb.weaponType] = (need[cb.weaponType] || 0) + (cb.ammoCost || 1);
      }
      const tier = {};
      for (const type in need) {
        const stacks = getSelectedStacks(state, type);
        tier[type] = stacks.length ? stacks[0].tier : "T1";
      }
      c = s._l1a = {
        sig: sig, epoch: -1, repKey: null, need: need, tier: tier,
        hit: [], dmgMult: [], dcu: [], repairFuel: [],
        volleyFuel: 0, volleyReady: false
      };
    }
    const need = c.need, tier = c.tier;
    // ---- 每件武器的「廉价静态量」：每波重建（无模块解析，只有查表 + 算术）----
    const wlist = [];
    for (const m of inputs.weapons) {
      const cb = m.equipment.combat;
      const weapon = WEAPON_CONFIG[cb.weaponType];
      if (!weapon) { wlist.push(null); continue; }
      const ammoProps = getAmmoTierProps(tier[cb.weaponType] || "T1");
      wlist.push({
        cb: cb, equip: m.equipment, weapon: weapon, ammoProps: ammoProps,
        baseX: cb.baseDamage * (m.multiplier || 1),
        hitMult: ammoProps.hitMult, ammoDmgMult: ammoProps.dmgMult,
        hit: 0, dmgMult: 1
      });
    }
    const bind = function () {
      for (let i = 0; i < wlist.length; i++) {
        const w = wlist[i];
        if (!w) continue;
        w.hit = c.hit[i] || 0;
        w.dmgMult = Number.isFinite(c.dmgMult[i]) ? c.dmgMult[i] : 1;
      }
    };
    const K = {
      inputs: inputs,
      weapons: wlist,
      need: need,
      tier: tier,
      dcu: c.dcu,
      repairFuel: c.repairFuel,
      cache: c
    };
    // ---- 技能相关缓存重算（会话级；由 _skillEpoch ∪ 声望符号位 两把钥匙共同判定）----
    //   ⚠️ 原判断「变化源只有技能等级」**已被实测证伪**（2026-09-19）：声望给战斗技能 +1 级时
    //   state.skills[].lvl 不变，缓存会静默失效。现依赖源为：
    //     ① state.skills[].lvl（grantXp 内比较前后值 → _skillEpoch）
    //     ② 三势力声望分的符号位（repBandKey，getCombatSkillLevelFromState 的 +1 依据）
    //     ③ 跨段变化（研究完成 / 军团 NPC tick / 空间站 / 队列）→ 由 settle() 段首强制失效覆盖
    //   船体/装备/强化/rig/脑插/联盟快照在一次离线结算内不变。
    K.syncDerived = function () {
      // 两把钥匙：技能等级（_skillEpoch，grantXp 内检测 lvl 变化）+ 声望符号位（repBandKey，见上方注释）
      const _rk = repBandKey(state);
      if (c.epoch === _skillEpoch && c.repKey === _rk) return;
      c.epoch = _skillEpoch;
      c.repKey = _rk;
      for (let i = 0; i < wlist.length; i++) {
        const w = wlist[i];
        if (!w) continue;
        // 与 readInputs 同序同参：calcPlayerHit(type, m.equipment, state) * ammoProps.hitMult
        c.hit[i] = G("calcPlayerHit")(w.cb.weaponType, w.equip, state) * w.hitMult;
        c.dmgMult[i] = G("calcPlayerDmgMult")(w.cb.weaponType, state);
      }
      const fuelMult = G("calcFuelMult")(zone, state);
      c.dcu.length = 0;   // 原地清空 ⇒ 引用不变（K.dcu 始终有效）
      const dcs = G("getInstalledCombatDamageControls")(state);
      if (dcs && dcs.length) {
        for (const m of dcs) {
          const cb = m.equipment && m.equipment.combat;
          if (!cb) continue;
          c.dcu.push({
            cost: Math.max(1, Math.round((cb.fuelCost || 1) * fuelMult)),
            gain: ((m.equipment.bonuses && m.equipment.bonuses.globalDamageReduction) || 0) * (Number(m.multiplier) || 1)
          });
        }
      }
      c.repairFuel.length = 0;
      for (const m of inputs.repairers) {
        c.repairFuel.push(Math.max(1, Math.round((((m.equipment.combat || {}).fuelCost) || 1) * fuelMult)));
      }
      c.volleyReady = false;   // 懒重算（首次真正开火时才算，省掉不开火波的模块解析）
      bind();
    };
    // ---- ⚠️ 关键：技能等级可能在**轮内**升级（武器技能 XP 在齐射段发放），而原实现是在
    //      使用点**即时**调用 calcPlayerHit / calcPlayerDmgMult / calcFuelMult / computeVolleyFuel。
    //      故内核的重算必须落在与原实现**同样的使用点**上，不能只在轮末刷新一次 ——
    //      否则「升级当轮」的燃料/命中/伤害口径会差 1（实测：SKILL=lvl1 时第 78 轮燃料 −1）。
    //      下列 syncDerived() 是幂等的（epoch 未变即早退），调用点 = 原实现的重算点。----
    // ---- 与原 canFireVirtual 逐句同构（含 s.ammoTier 的**部分写**语义：先建对象再逐类型落值，
    //      缺弹即带部分值返回 false —— 小队 ammoTierFor 依赖该语义，故此处不做「一次性整表赋值」）----
    K.canFire = function () {
      if (!inputs.weapons || inputs.weapons.length === 0) return false;
      if (s.fuel <= 0) { s.blockedBy = "fuel"; return false; }
      const st = {};
      for (const type in need) {
        st[type] = tier[type];
        if ((s.ammo[type] || 0) < need[type]) { s.ammoTier = st; s.blockedBy = "ammo"; return false; }
      }
      s.ammoTier = st;
      return true;
    };
    // ---- 与原 consumeVolleyVirtual 同构；volleyFuel 由会话级缓存提供（纯函数，同值）----
    K.consumeVolley = function () {
      K.syncDerived();   // 原实现此处即时调 computeVolleyFuel ⇒ 同点重算
      if (!c.volleyReady) { c.volleyFuel = G("computeVolleyFuel")(state, zone); c.volleyReady = true; }
      for (const type in need) s.ammo[type] = (s.ammo[type] || 0) - need[type];
      s.fuel = Math.max(0, s.fuel - c.volleyFuel);
      return c.volleyFuel;
    };
    // ---- 与原 computeDcReduction 同构（DCU 列表与燃料成本会话级缓存；s.fuel 扣减仍逐轮）----
    K.computeDc = function () {
      K.syncDerived();   // 原实现此处即时调 calcFuelMult ⇒ 同点重算
      if (c.dcu.length === 0) return 0;
      let dc = 0;
      for (let i = 0; i < c.dcu.length; i++) {
        const e = c.dcu[i];
        if (s.fuel < e.cost) continue;
        s.fuel = Math.max(0, s.fuel - e.cost);
        dc += e.gain;
      }
      return Math.min(0.5, dc);
    };
    // ---- 轮末刷新（替代「整份 readInputs + 拷 5 个字段」）----
    //   · 派生缓存 ⇒ 交给 syncDerived（**无条件调用**，见下方注释）
    //   · 增强剂 / 脑突触与技能无关 ⇒ 每轮同源同值刷新
    //   · inputs.maxHp / inputs.playerDodge 在原实现里被重新赋值却**从未被读取**
    //     （c.maxHp 只在波首落定；敌方反击用的是下方即时调用的 calcPlayerDodge）
    //     ⇒ 此处不重算，行为等价（方案 §11.2 已记录该结论与取证方式）。
    //   ⚠️ 此处**不得**再写 `if (c.epoch !== _skillEpoch) K.syncDerived();`（2026-09-19 修正）：
    //   本函数对应原实现在该位置**无条件**执行的 `readInputs(state, nowRef)`（即无条件重算），
    //   而只认 _skillEpoch 的单键守卫会把「重算点必须与原实现重合」这条不变量悄悄破坏 ——
    //   声望符号位变化时它不刷新（虽然当前所有读点前面都另有一次无条件 syncDerived ⇒ 尚无可观测后果，
    //   但那是**非局部**的安全性论证，正是本轮 bug 的同类隐患）。syncDerived 自身按两把钥匙幂等早退，
    //   无条件调用只多一次约 1µs 的声望分读取。
    K.refreshRound = function () {
      K.syncDerived();
      const booster = (typeof G("getBoosterEffectState") === "function") ? G("getBoosterEffectState")(state) : null;
      inputs.boosterDmg = booster ? booster.weaponDamageMultiplier : null;
      inputs.boosterRep = booster ? booster.repairMultiplier : null;
      const adBuffRef = (nowRef && typeof nowRef.t === "number") ? nowRef.t : undefined;
      inputs.adBuffMult = (typeof G("getAdBuffMultiplier") === "function") ? G("getAdBuffMultiplier")(state, adBuffRef) : 1;
    };
    K.syncDerived();
    bind();
    return K;
  }

  // ---- 单波等效模拟（期望伤害，不重放 RNG）----
  // enemies: 本波敌人数组（结构 {hp:{shield,armor,structure}, hit, dodge, baseDamage, kind, iskDrop, xpDrop, deathspaceLeader?, deathspaceWave?, id}）—— hit 必填，敌方反击 calcCombatDamage(attacker.hit,...) 依赖它
  // 返回 {outcome:'cleared'|'defeated', rounds, kills:[]}
  function simulateWave(state, enemies, zone, isDeathspace, site, s, nowRef) {
    const inputs = readInputs(state, nowRef);
    const c = state.combat;
    const expectedRng = expectedCombatRng(state);
    const actualRng = actualCombatRng(state);
    // M3：L1a 精确递推内核。K=null ⇒ 下面每处分支走原实现（关闭开关时逐字节不变）。
    let K = null;
    if (fpEnabled()) {
      const _rej = fpKernelReject(state, inputs);
      if (_rej) {
        FP_STATS.kernelRejected[_rej] = (FP_STATS.kernelRejected[_rej] || 0) + 1;
      } else {
        const _kt0 = fpNow();
        K = makeWaveKernel(state, zone, s, nowRef, inputs);
        FP_STATS.kernelWaves++;
        FP_STATS.kernelReadyMs += fpNow() - _kt0;
      }
    }
    c.maxHp = inputs.maxHp;
    // 钳制当前 HP 不超 maxHp
    if (c.hp.shield > c.maxHp.shield) c.hp.shield = c.maxHp.shield;
    if (c.hp.armor > c.maxHp.armor) c.hp.armor = c.maxHp.armor;
    if (c.hp.structure > c.maxHp.structure) c.hp.structure = c.maxHp.structure;

    const living = () => enemies.filter(e => e && e.hp && e.hp.structure > 0);
    let current = living()[0] || null;
    let rounds = 0;
    const kills = [];
    // ---- 停摆短路状态（见 NO_PROGRESS_LIMIT 注释）：每轮末比较敌我总血量是否有任何下降 ----
    const enemyHpTotal = () => {
      let sum = 0;
      for (const e of enemies) {
        if (e && e.hp) sum += (Number(e.hp.shield) || 0) + (Number(e.hp.armor) || 0) + (Number(e.hp.structure) || 0);
      }
      return sum;
    };
    let prevEnemyHp = enemyHpTotal();
    let noProgressStreak = 0;

    while (true) {
      if (rounds >= MAX_WAVE_ROUNDS) { return { outcome: "cleared", rounds, kills }; }
      // 与在线 advanceCombatRound 同口径：刷新/切页后若战斗舰已是 0 结构，
      // 不能再让离线模拟先执行一轮玩家/NPC 开火，再把敌方血量继续扣掉。
      if (c.hp && Number(c.hp.structure) <= 0) {
        return { outcome: "defeated", rounds, kills };
      }
      const effectDamage = G("tickDeathspaceWeaponEffects")(enemies);
      if (effectDamage > 0) c.runDamageDealt = (Number(c.runDamageDealt) || 0) + effectDamage;
      const dcReduction = K ? K.computeDc() : computeDcReduction(state, zone, s);
      // D2=A（2026-09-11 用户拍板）：泰坦主武器（舰体自带）与 tt_high 释放高槽的常规副武器分账结算——
      // 两条 gate 独立求值（副武器 gate 先算，主武器最后落定 s.ammoTier），任一开火即视为本轮开火；
      // 副武器缺油缺弹只哑火自己，不影响主武器。常规舰下 convFire === 原单 gate，行为等价。
      const convFire = K ? K.canFire() : canFireVirtual(inputs, zone, s, state);
      const titanMainFire = inputs.isTitan ? canFireTitanVirtual(state, inputs, zone, s) : false;
      const fire = inputs.isTitan ? (titanMainFire || convFire) : convFire;
      if (fire) {
        let roundDealt = 0;
        if (inputs.isTitan && titanMainFire) {
          // 泰坦管线：主武器单发 + 四类附带打击（期望值口径）
          roundDealt = fireTitanVolleyVirtual(state, inputs, current, enemies, zone, s, rounds + 1, expectedRng);
        }
        if (convFire) {
          for (let wi = 0; wi < inputs.weapons.length; wi++) {
            const m = inputs.weapons[wi];
            const cb = m.equipment.combat;
            const weapon = WEAPON_CONFIG[cb.weaponType];
            if (!weapon) continue;
            if (!current) break;
            if (K) K.syncDerived();   // 每门武器前：原实现此处即时调 calcPlayerHit/DmgMult ⇒ 同点重算
            const kw = K ? K.weapons[wi] : null;
            const ammoProps = kw ? kw.ammoProps : getAmmoTierProps(s.ammoTier[cb.weaponType] || "T1");
            const playerHit = kw ? kw.hit : G("calcPlayerHit")(cb.weaponType, m.equipment, state) * ammoProps.hitMult;
            const dmgMult = kw ? kw.dmgMult : G("calcPlayerDmgMult")(cb.weaponType, state);
            let counterMult = 1.0;
            if (weapon.counterType === "shield" && current.hp.shield > 0) counterMult = 1.25;
            else if (weapon.counterType === "armor" && current.hp.shield <= 0 && current.hp.armor > 0) counterMult = 1.25;
            else if (weapon.counterType === "structure" && current.hp.shield <= 0 && current.hp.armor <= 0 && current.hp.structure > 0) counterMult = 1.25;
            const traitMult = G("getCapitalWeaponTraitMultiplier")(inputs.ship, cb.weaponType, c.hp, c.maxHp);
            const wbm = (inputs.boosterDmg && inputs.boosterDmg[cb.weaponType]) ? inputs.boosterDmg[cb.weaponType] : 1;
            // 2026-09-12：联盟加成并入乘区（与在线 combat.js:1524-1526 逐项同构）。
            const adm = inputs.allianceDamageMult || 1;
            const vulnMult = G("getDeathspaceWeaponDamageTakenMultiplier")(current);
            const baseDmg = kw ? kw.baseX : cb.baseDamage * (m.multiplier || 1);
            let dmg = G("calcCombatDamage")(playerHit, current.dodge, baseDmg * wbm, counterMult * dmgMult * traitMult * ammoProps.dmgMult * adm * vulnMult, expectedRng);
            // 脑突触加速剂独立乘区（与在线 combat.js 同步）
            const adbm = inputs.adBuffMult || 1;
            if (adbm && adbm !== 1) dmg = Math.round(dmg * adbm);
            const dealt = G("applyLayeredCombatDamage")(current.hp, dmg);
            const total = dealt.shield + dealt.armor + dealt.structure;
            roundDealt += total;
            const xRepair = G("applyDeathspaceWeaponEffect")(current, cb, total);
            if (xRepair > 0 && c.hp.armor < c.maxHp.armor) c.hp.armor = Math.min(c.maxHp.armor, c.hp.armor + xRepair);
            // AOE
            const targets = G("getCapitalAreaDamageTargets")(enemies, current, weapon.aoe);
            for (const t of targets) {
              const ad = Math.max(1, Math.round(dmg * t.multiplier));
              const ad2 = G("applyLayeredCombatDamage")(t.enemy.hp, ad);
              roundDealt += ad2.shield + ad2.armor + ad2.structure;
            }
            // 武器技能 XP
            const wskill = state.skills[weapon.skillKey];
            if (wskill) grantXp(state, weapon.skillKey, 2);
            grantXp(state, "targeting", 1);
          }
        }
        s.totalDamageDealt += roundDealt;
        if (roundDealt > s.maxSingleHit) s.maxSingleHit = roundDealt;
        // 副武器（或常规舰全部武器）燃料/弹药走虚拟池扣减；
        // 泰坦主武器的燃料/弹药已在 fireTitanVolleyVirtual 内自行扣减，不在此重复。
        if (convFire) {
          const volleyFuel = K ? K.consumeVolley() : consumeVolleyVirtual(inputs, zone, s);
          grantXp(state, "capacitorManagement", volleyFuel * 0.3);
        }
      }
      G("decayDeathspaceWeaponVulnerability")(enemies);
      // M6 Phase 2：离线也按攻击者顺序换目标。
      // 玩家是一名攻击者（整轮齐射），随后每名 NPC 各自开火；只有当前目标被击杀才推进。
      // 这里不调用 processLegionNpcAttack，因为该兼容接口的契约仍是“全体 NPC 打 currentEnemy”。
      if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && state.combat.squad && state.combat.squad.enabled === true) {
        const squad = state.combat.squad;
        const nextLiving = (fromEnemy) => {
          const start = fromEnemy ? enemies.indexOf(fromEnemy) + 1 : 0;
          for (let i = Math.max(0, start); i < enemies.length; i++) {
            const candidate = enemies[i];
            if (candidate && candidate.hp && candidate.hp.structure > 0 && !candidate.defeated) return candidate;
          }
          return null;
        };
        const advanceTarget = () => {
          if (current && current.hp && current.hp.structure <= 0) current = nextLiving(current);
          else if (!current || current.defeated) current = nextLiving(current);
          if (squad) squad.targetId = current && current.id != null ? current.id : null;
        };
        const npcPerRound = [];
        let npcAttacked = 0;
        let npcDamage = 0;
        advanceTarget();
        const members = typeof LEGION_COMBAT_SQUAD.getEligibleSquadFireMembers === "function"
          ? LEGION_COMBAT_SQUAD.getEligibleSquadFireMembers(state, nowRef.t)
          : [];
        for (const member of members) {
          if (!current) break;
          squad.targetId = current.id != null ? current.id : null;
          const entry = LEGION_COMBAT_SQUAD.fireSingleNpcMember(state, {
            now: nowRef.t, offline: true, zone: zone, virtual: s, randomFn: expectedRng, round: rounds + 1, // 易伤回合号（3b）：与泰坦齐射同用波内轮号
            enemies: enemies // C3 泰坦 NPC 输出：副目标解析源，与在线 c.enemies 同口径
          }, member, current, npcPerRound, expectedRng);
          if (entry && !entry.skipped) {
            npcAttacked += 1;
            npcDamage += entry.damage || 0;
          }
          advanceTarget();
        }
        s.npcDamageDealt = (s.npcDamageDealt || 0) + npcDamage;
        state.combat.runSquadDamageDealt = (typeof state.combat.runSquadDamageDealt === "number" ? state.combat.runSquadDamageDealt : 0) + npcDamage;
        squad.lastRound = {
          attacked: npcAttacked,
          totalDamage: npcDamage,
          perNpc: npcPerRound,
          targetId: squad.targetId,
          now: nowRef.t
        };
        LEGION_COMBAT_SQUAD.tickLegionSquadRepairs(state, nowRef.t);
      }
      // —— 泰坦核心触发（末日武器）离线接线：每 everyRounds 轮一次；断供跳过本次，不阻塞主武器 ——
      // 与在线 combat.js 核心段同口径；眩晕 roll 走 detRng 确定性流（与掉落同机制：长程频率正确且可复现），
      // 易伤标记（titanVuln）/点名（selectTitanDoomTarget）为确定性纯函数直接复用。
      if (inputs.isTitan && inputs.titanCore && inputs.titanCore.kind !== "aura" && typeof G("getTitanCoreStrikes") === "function") {
        const coreRaw = G("getTitanCoreStrikes")(inputs.titanCore, inputs.titanWeapon, { round: rounds + 1 });
        if (coreRaw.length > 0) {
          const ccost = inputs.titanCore.consumption || {};
          const coreFuel = (ccost.fuelPctOfVolley > 0 && inputs.titanWeapon)
            ? Math.max(1, Math.round((inputs.titanWeapon.fuelCost || 0) * ccost.fuelPctOfVolley * G("calcFuelMult")(zone, state))) : 0;
          const coreAmmo = ccost.ammoPerTrigger || 0;
          const coreAmmoAvailable = (inputs.titanWeapon && coreAmmo > 0) ? (s.ammo[inputs.titanWeapon.weaponType] || 0) : 0;
          if (G("hasTitanCoreSupply")({ fuel: coreFuel, ammo: coreAmmo }, s.fuel, coreAmmoAvailable)
              && (coreAmmo <= 0 || coreAmmoAvailable >= coreAmmo)) {
            if (coreFuel > 0) s.fuel = Math.max(0, s.fuel - coreFuel);
            if (coreAmmo > 0) s.ammo[inputs.titanWeapon.weaponType] = Math.max(0, (s.ammo[inputs.titanWeapon.weaponType] || 0) - coreAmmo);
            if (!c.titanStunCounts || typeof c.titanStunCounts !== "object") c.titanStunCounts = {};
            const corePrimary = (current && current.hp && current.hp.structure > 0) ? current : (living()[0] || null);
            const resolved = G("resolveTitanCoreStrikes")(coreRaw, inputs.titanCore, enemies, corePrimary, c.titanStunCounts, rounds + 1, detRng(c));
            let coreDealt = 0;
            const coreAdbm = inputs.adBuffMult || 1; // 脑突触（3c）：与在线核心段同口径
            // 全补（2026-09-10 用户拍板）：末日核心同吃 dmgMult（与在线 combat.js 同口径）
            const coreDmgMult = (typeof G("getCombatDamageMultiplierFromState") === "function")
              ? G("getCombatDamageMultiplierFromState")(state, inputs.titanWeapon.weaponType) : 1;
            for (const strike of resolved.strikes) {
              const vm = G("getTitanDamageTakenMultiplier")(strike.enemy, rounds + 1); // 侵蚀本轮命中即生效
              const dmg = Math.max(1, Math.round(strike.damage * vm * coreAdbm * coreDmgMult));
              const d2 = G("applyLayeredCombatDamage")(strike.enemy.hp, dmg);
              coreDealt += d2.shield + d2.armor + d2.structure;
              if (strike.stunned && (inputs.titanCore.stunRounds || 0) > 0) {
                strike.enemy.titanStunRounds = (strike.enemy.titanStunRounds || 0) + inputs.titanCore.stunRounds;
              }
            }
            s.totalDamageDealt += coreDealt;
          }
        }
      }
      // 结算本波被击毁的敌人（玩家先手 + AOE）
      for (const e of enemies) {
        if (e && e.hp && e.hp.structure <= 0 && !e._rewarded) {
          e._rewarded = true;
          kills.push(e);
        }
      }
      // 敌人反击
      const playerDodge = G("calcPlayerDodge")(undefined, state);
      const ship = inputs.ship;
      let shieldHitsUsed = 0;
      let roundTaken = 0;
      let armorDamageTaken = 0;
      let structureDamageTaken = 0;
      let titanDeflectionTriggers = 0;
      const livingAttackers = living();
      // 指挥舰光环：指挥舰在场时，其余敌舰伤害 ×auraDamage（与在线 combat.js 同口径，指挥舰自身不加成）。
      const enemyAuraMult = livingAttackers.reduce((maxAura, e) => Math.max(maxAura, e.auraDamage || 1), 1);
      const enemyEnrageMult = (e) => {
        if (!e || !e.enrageMul || !e.maxHp || !e.hp) return 1;
        const ratio = (e.hp.shield + e.hp.armor + e.hp.structure) / Math.max(1, e.maxHp.shield + e.maxHp.armor + e.maxHp.structure);
        return ratio < (Number(e.enrageAt) || 0.3) ? e.enrageMul : 1;
      };
      for (const attacker of livingAttackers) {
        // 天罚裁决眩晕（离线接线）：被晕敌跳过本次攻击并递减（与在线 combat.js 敌方循环同口径）
        if (attacker.titanStunRounds > 0) {
          attacker.titanStunRounds -= 1;
          continue;
        }
        // M4 小队模式：D1 期望分摊——每个有效目标用自身防御/闪避/减伤算期望伤害后取 1/N。
        // 玩家与 NPC 的护盾/装甲/结构与减伤（含 NPC 自身 DCU 与资本舰特质）逐个独立计算，
        // 绝不用「统一伤害 ÷ N」。非小队模式完全走原路径（行为不变）。
        if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && state.combat.squad && state.combat.squad.enabled === true) {
          if (!(Number(attacker.baseDamage) > 0)) continue;
          const atkMultSquad = (attacker.auraDamage ? 1 : enemyAuraMult) * enemyEnrageMult(attacker) * OFFLINE_ENEMY_DAMAGE_COMP;
          const rawEnemyDamage = G("calcCombatDamage")(attacker.hit, playerDodge, (attacker.baseDamage || 1) * atkMultSquad, 1.0, actualRng);
          // 泰坦偏导走泰坦版（返回 triggered 供稳态回充计数）；超旗舰船走原路径，行为不变
          const mitigation = inputs.isTitan
            ? G("applyTitanShieldMitigation")(inputs.titanTrait, rawEnemyDamage, shieldHitsUsed, c.hp.shield)
            : G("applyCapitalShieldMitigation")(ship, rawEnemyDamage, shieldHitsUsed, c.hp.shield);
          if (inputs.isTitan) {
            if (c.hp.shield > 0) shieldHitsUsed++; // 盾上命中一律消耗次数（含第 4 次起不触发减伤的命中）
            if (mitigation.triggered) titanDeflectionTriggers++;
          } else if (mitigation.shieldHitUsed) {
            shieldHitsUsed++;
          }
          const enemyDmg = Math.max(0, Math.round(mitigation.damage));
          const reducedDmg = dcReduction > 0 ? Math.max(0, Math.round(enemyDmg * (1 - dcReduction))) : enemyDmg;
          const res = LEGION_COMBAT_SQUAD.processLegionEnemyAttack(state, {
            damage: reducedDmg, offlineExact: true, now: nowRef.t, zone: zone, virtual: s, rng: actualRng,
            attacker: attacker, playerDodge: playerDodge, playerShipConfig: ship,
            shieldHitsUsed: shieldHitsUsed, dcReduction: dcReduction, roundSeq: rounds + 1
          });
          const playerHit = (res.hits || []).find(h => h.kind === "player");
          const actual = (res.hits || []).reduce((sum, h) => sum + (h.dealt
            ? h.dealt.shield + h.dealt.armor + h.dealt.structure : 0), 0);
          const pdmg = playerHit && playerHit.dealt ? playerHit.dealt : { shield: 0, armor: 0, structure: 0 };
          roundTaken += actual;
          armorDamageTaken += pdmg.armor;
          structureDamageTaken += pdmg.structure;
          // 防御经验只来自玩家实际承受的伤害（NPC 承受的不发放，与在线一致）
          if (pdmg.shield > 0) grantXp(state, "shieldOperation", 1);
          if (pdmg.armor > 0) grantXp(state, "armorReinforcement", 1);
          if (pdmg.structure > 0) grantXp(state, "hullEngineering", 1);
          if (actual > 0) grantXp(state, "piloting", 1);
          if (c.hp.structure <= 0) {
            s.totalDamageTaken += roundTaken;
            return { outcome: "defeated", rounds: rounds + 1, kills };
          }
          continue;
        }
        // 2026-09-09 RNG 口径对齐（修复 A）：独狼分支敌方反击改用 actualRng，
        // 与小队分支（上）及在线 combat.js:1510 保持一致；此前用 expectedRng 与在线不同口径。
        const atkMultSolo = (attacker.auraDamage ? 1 : enemyAuraMult) * enemyEnrageMult(attacker) * OFFLINE_ENEMY_DAMAGE_COMP;
        const raw = G("calcCombatDamage")(attacker.hit, playerDodge, (attacker.baseDamage || 1) * atkMultSolo, 1.0, actualRng);
        // 泰坦偏导走泰坦版（返回 triggered 供稳态回充计数）；超旗舰船走原路径，行为不变
        const mit = inputs.isTitan
          ? G("applyTitanShieldMitigation")(inputs.titanTrait, raw, shieldHitsUsed, c.hp.shield)
          : G("applyCapitalShieldMitigation")(ship, raw, shieldHitsUsed, c.hp.shield);
        if (inputs.isTitan) {
          if (c.hp.shield > 0) shieldHitsUsed++; // 盾上命中一律消耗次数（含第 4 次起不触发减伤的命中）
          if (mit.triggered) titanDeflectionTriggers++;
        } else if (mit.shieldHitUsed) {
          shieldHitsUsed++;
        }
        let enemyDmg = Math.max(0, Math.round(mit.damage));
        if (dcReduction > 0) enemyDmg = Math.max(0, Math.round(enemyDmg * (1 - dcReduction)));
        const dmg = G("applyLayeredCombatDamage")(c.hp, enemyDmg);
        const actual = dmg.shield + dmg.armor + dmg.structure;
        roundTaken += actual;
        armorDamageTaken += dmg.armor;
        structureDamageTaken += dmg.structure;
        if (dmg.shield > 0) grantXp(state, "shieldOperation", 1);
        if (dmg.armor > 0) grantXp(state, "armorReinforcement", 1);
        if (dmg.structure > 0) grantXp(state, "hullEngineering", 1);
        if (actual > 0) grantXp(state, "piloting", 1);
        if (c.hp.structure <= 0) {
          s.totalDamageTaken += roundTaken;
          return { outcome: "defeated", rounds: rounds + 1, kills };
        }
      }
      s.totalDamageTaken += roundTaken;
      // 反应装甲回修（资本舰 reactive_armor 特质；与在线 combat.js:1226-1231 一致）
      const reactiveArmorRepair = G("getCapitalReactiveArmorRepair")(ship, armorDamageTaken, c.maxHp.armor);
      if (reactiveArmorRepair > 0 && c.hp.armor < c.maxHp.armor) {
        const restored = Math.min(reactiveArmorRepair, c.maxHp.armor - c.hp.armor);
        c.hp.armor += restored;
      }
      // 泰坦挂钩维修（与在线 combat.js 同口径）：只吃泰坦舰体固有维修加成。
      if (inputs.isTitan && inputs.titanTrait) {
        const titanRepairRatio = c.maxHp.structure > 0 ? c.hp.structure / c.maxHp.structure : 1;
        if (inputs.titanTrait.id === "titan_deflection_shield" && titanDeflectionTriggers > 0 && c.hp.shield < c.maxHp.shield) {
          const base = G("getTitanSteadyRechargeRepair")(inputs.titanTrait, titanDeflectionTriggers, c.maxHp.shield);
          const restored = Math.min(base * G("getTitanTraitRepairMultiplierFromState")(state, "shield", titanRepairRatio), c.maxHp.shield - c.hp.shield);
          if (restored > 0) c.hp.shield += restored;
        }
        if (inputs.titanTrait.id === "titan_reactive_armor" && armorDamageTaken > 0 && c.hp.armor < c.maxHp.armor) {
          // 应激 min 内不含乘区（consumesRepairMultiplier）：基础 min 先算，乘区在 min 之后显式应用
          const base = G("getTitanReactiveArmorRepair")(inputs.titanTrait, armorDamageTaken, c.maxHp.armor);
          const restored = Math.min(base * G("getTitanTraitRepairMultiplierFromState")(state, "armor", titanRepairRatio), c.maxHp.armor - c.hp.armor);
          if (restored > 0) c.hp.armor += restored;
        }
        if (inputs.titanTrait.id === "titan_structure_overdrive" && structureDamageTaken > 0 && c.hp.structure < c.maxHp.structure) {
          const layers = Math.min(inputs.titanTrait.maxLayers, Math.floor(((1 - titanRepairRatio) + 1e-9) / (inputs.titanTrait.thresholdPct || 0.10)));
          const base = G("getTitanOverdriveSealRepair")(inputs.titanTrait, structureDamageTaken, layers);
          const restored = Math.min(base * G("getTitanTraitRepairMultiplierFromState")(state, "structure", titanRepairRatio), c.maxHp.structure - c.hp.structure);
          if (restored > 0) c.hp.structure += restored;
        }
      }
      // 军团 NPC 绑定泰坦舰体固有维修（偏导回盾 / 强化应激装甲 / 泰坦结构过载密封），与玩家出战泰坦同口径。
      // 离线逐轮落定（每轮承伤累计的触发/损管量在此一次性结算并清零，下一轮重计）。
      if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD) {
        LEGION_COMBAT_SQUAD.repairLegionNpcTitanTraits(state, nowRef.t);
      }
      // 维修（仅读真实维修装备；满血层不扣维修燃料，与在线一致）
      const boosterRep = inputs.boosterRep;
      if (K) K.syncDerived();   // 原实现此处即时调 calcFuelMult（每个维修件）⇒ 同点重算
      for (let ri = 0; ri < inputs.repairers.length; ri++) {
        const m = inputs.repairers[ri];
        const cb = m.equipment.combat;
        const repFuel = K ? K.repairFuel[ri] : Math.max(1, Math.round((cb.fuelCost || 1) * G("calcFuelMult")(zone, state)));
        if (s.fuel < repFuel) continue;
        if (c.hp[cb.target] < c.maxHp[cb.target]) {
          const repMult = (boosterRep && boosterRep[cb.target]) ? boosterRep[cb.target] : 1;
          const repairOpts = { _offlineModuleCache: s._offlineSquadModuleCache || (s._offlineSquadModuleCache = {}) };
          const heal = Math.round(cb.amount * (m.multiplier || 1) * G("calcRepairMult")(cb.target, state, c.hp.structure / c.maxHp.structure, repairOpts) * repMult);
          c.hp[cb.target] = Math.min(c.maxHp[cb.target], c.hp[cb.target] + heal);
          s.fuel = Math.max(0, s.fuel - repFuel);
          grantXp(state, "defense", 1);
        }
      }
      // M5 修复：NPC 绑定舰维修件在离线战斗中同样生效（与在线、与玩家对称）。
      // 复用离线会话燃料池 s（与玩家维修、NPC 攻击共用同一 s.fuel；下一个离线 tick 才 flush 到库存）。
      // NPC 维修函数属于小队命名空间，不是全局函数；离线此前通过 G() 查找始终为空，
      // 导致 NPC 只承伤不维修，最终在短时间内爆船。与在线路径统一走导出原语。
      const npcRepFn = (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD)
        ? LEGION_COMBAT_SQUAD.repairLegionSquadNpcs : null;
      if (npcRepFn) npcRepFn(state, { now: nowRef.t, zone: zone, offline: true, virtual: s });
      // 清波判定移至维修之后（2026-08-28 修复）：在线 advanceCombatRound 的顺序是
      // 玩家攻击→击杀结算→敌人反击→反应装甲→维修→清波生成新波，清波轮照常维修；
      // 离线旧逻辑在维修前提前 return，导致每波漏一轮维修，临界配装离线系统性更易爆船。
      // 相位重构（与在线 combat.js 同口径）：每 bossHealEvery 轮回复 bossHealPct 最大总血。
      for (const e of enemies) {
        if (!e || e.kind !== "boss" || !e.bossHealPct || !e.hp || e.hp.structure <= 0) continue;
        const every = Math.max(1, Number(e.bossHealEvery) || 5);
        if ((rounds + 1) % every !== 0) continue;
        if (!e.maxHp) continue;
        const maxTotal = e.maxHp.shield + e.maxHp.armor + e.maxHp.structure;
        let rem = maxTotal * e.bossHealPct;
        const addL = (k) => { const cap = e.maxHp[k] - e.hp[k]; const add = Math.max(0, Math.min(cap, rem)); e.hp[k] += add; rem -= add; };
        addL("shield"); addL("armor"); addL("structure");
      }
      if (living().length === 0) {
        // M3 验收轨迹：清波轮也要入账。否则「一击破波」的配装（泰坦等）每轮都走本早退，
        // 整段离线零轨迹 ⇒ 逐轮对拍门禁**空洞通过**（2026-09-19 真实存档实测发现：
        // 泰坦 600s 打出 1537 杀、轨迹 0 轮，门禁却报 PASS）。
        fpTracePush(state, c, s, enemyHpTotal());
        return { outcome: "cleared", rounds: rounds + 1, kills };
      }
      // ⭐ 停摆短路（见 NO_PROGRESS_LIMIT 注释）：判定口径只看**敌方总血量是否下降**——
      // 清波的唯一途径就是打掉敌人血量；玩家自己掉血（敌方反击）不构成对「能否清波」的进展。
      // 注意：敌方 baseDamage 为 0 时 combat 内部按 `(attacker.baseDamage || 1)` 取 1，
      // 故「敌方零输出」实际表现为每轮 1 点蹭伤 ⇒ 玩家会在 6000 轮里被慢慢磨、却永远清不掉波，
      // 正是真机实测（击杀 0 / 被击败 0 / 单波跑满 6000 轮 ≈ 8.3s）的形态。
      const _eNow = enemyHpTotal();
      if (_eNow < prevEnemyHp) {
        noProgressStreak = 0;
      } else if (++noProgressStreak >= NO_PROGRESS_LIMIT) {
        fpTracePush(state, c, s, _eNow); // M3 验收轨迹：停摆轮同样入账（同上，防门禁空洞）
        return { outcome: "stalemate", rounds, kills };
      }
      // M4-1：轮末只读采样。必须在 `prevEnemyHp = _eNow` **之前**取差值（该差值 = 本波敌方总血量
      // 因我方输出而下降的量）。默认关闭 ⇒ 立即 return，零开销、零行为影响。
      m4RoundTick(state, c, s, inputs, prevEnemyHp - _eNow, kills.length, living().length);
      prevEnemyHp = _eNow;
      // 推进回合与虚拟时间
      rounds++;
      nowRef.t += ROUND_SECONDS * 1000;
      advanceBoosterTime(state, ROUND_SECONDS * 1000, nowRef.t);
      // 重新读取（技能可能升级、HP 变化、增强剂/ad-buff 时间推进）
      if (K) {
        K.refreshRound();
      } else {
        const ni = readInputs(state, nowRef);
        inputs.maxHp = ni.maxHp; inputs.playerDodge = ni.playerDodge;
        inputs.boosterDmg = ni.boosterDmg; inputs.boosterRep = ni.boosterRep;
        inputs.adBuffMult = ni.adBuffMult;
      }
      current = living()[0] || null;
      fpTracePush(state, c, s, _eNow); // M3 验收轨迹（未开 TRACE 时零成本）
    }
  }

  // ---- 增强剂离线时间推进（打破"战斗增强剂离线冻结"；不得双扣）----
  // 复用与在线 tickBoosterTimers 完全相同的纯计算函数 applyBoosterTimeConsumption，
  // 仅推进战斗相关两槽（combatWeapon / combatRepair），与在线战斗分支严格一致：
  // 正确消费库存并在耗尽时自动续装；不再 delete 槽位、不再漏扣库存、不再波及非战斗槽。
  function advanceBoosterTime(state, ms, now) {
    if (!state || !state.boosters || !state.boosters.active) return;
    if (!(ms > 0)) return;
    const t = (typeof now === "number" && Number.isFinite(now)) ? now : Date.now();
    const combatSlots = ["combatWeapon", "combatRepair"];
    for (const slot of combatSlots) {
      const entry = state.boosters.active[slot];
      if (entry && entry.itemId) {
        applyBoosterTimeConsumption(state, slot, ms, t, { offline:true });
      }
    }
  }

  // ---- 小队打捞效率快照的「是否需要重算」签名（性能返修 2026-09-18）----
  // 修复前：recordKill 逐击杀调用 getSquadSalvageEfficiency(state)（0.9.6 引入），
  // 而该函数每次都要遍历出战舰 high/mid/low/rig 四槽位的全部装备引用（resolveEquipmentReference）、
  // 对 NPC 绑定舰各再算一遍、并取一次 getMtuModifiers。8h 离线实测 50,760 次击杀
  // ⇒ 50,760 次全量重算 —— 是「离线战斗后登录仍卡 ~1.7s」的主体（逐击杀整页重渲染已于同日归零）。
  // 该值在一次结算会话内**只可能因小队编制变化而上升**：
  //   - 出战舰与配装在离线期间不变（无 UI、无换装路径）；
  //   - MTU 断料只会让 salvage 项归 0（下降），而调用方取 max ⇒ 对取值无影响。
  // 故用「队员数 + 各队员 npcId + 已部署物 id」这一廉价签名判定是否需要重算：
  // 签名未变即复用上次结果，签名变化（续段、新一次小队出击、战斗结束清空队员）一定重算
  // ⇒ 与逐击杀重算**语义完全一致**，单次结算内调用数从「每击杀 1 次」降到「每次编制变化 1 次」。
  function salvageSnapshotSignature(state) {
    const squad = state && state.combat ? state.combat.squad : null;
    let sig = "";
    const members = (squad && Array.isArray(squad.members)) ? squad.members : null;
    sig += members ? members.length : 0;
    if (members) {
      for (let i = 0; i < members.length; i++) sig += "|" + ((members[i] && members[i].npcId) || "");
    }
    const deploys = (squad && Array.isArray(squad.deployables)) ? squad.deployables : null;
    sig += "#" + (deploys ? deploys.length : 0);
    if (deploys) {
      for (let i = 0; i < deploys.length; i++) sig += "|" + ((deploys[i] && deploys[i].deployableId) || "");
    }
    return sig;
  }

  // ---- 记录击杀（掉落累计 + 计数）----
  function recordKill(state, s, enemy, zone, isDeathspace, site) {
    // ---- M6a 入口只读快照（开关关闭时恒为 null ⇒ 零开销）----
    // 仅拷贝三个数字，用于在函数末尾反推「本次击杀**实际**扣了多少燃料 / 同位素 / 功勋」。
    // 这是纯读、不写任何状态，也不改变 recordKill 的调用序与返回值。
    const _m6a0 = m6aEnabled() ? { fuel: s.fuel || 0, iso: s.iso || 0, lp: s.lpDelta || 0, rep: m6aRepSnapshot(state) } : null;
    s.kills++;
    // 离线战斗不逐艘发出 combat:enemyDefeated，因此在统一的击杀记录点结算连续声望。
    if (typeof applyReputationKill === "function" && zone && zone.faction) {
      // M6c：唯一写入点经转发器 —— `m6cMode() === 0` 时**逐字转发**原函数，
      // 调用序 / 返回值 / 行为完全不变（由 M6a 的 B1a–B1e 零行为门禁守护）。
      m6cApply(state, zone.faction, zone.id, typeof getReputationShipClass === "function" ? getReputationShipClass(zone) : null);
    }
    // ⚠️ 离线打捞时序修复（2026-09-17）：flush（applyBatchedDrops）在全部战斗段结束后才跑一次，
    // 而战斗结束 endLegionSquadBattle 会清空 state.combat.squad.members（legion-combat-squad.js:511）。
    // 若 flush 时 members 已空，getSquadSalvageEfficiency(state) 的 npc 项为 0 ⇒ 离线打捞只算玩家量
    // （与「在线正常、离线不行」现象吻合：在线逐杀实时算、members 恒满）。
    // 故在此（战斗进行中、members 满时）捕获快照，并取全会话最大值以覆盖多段战斗 / 续波。
    // ⚠️ 性能返修（2026-09-18）：快照改按编制签名缓存（见 salvageSnapshotSignature），
    // 签名未变不再重算 —— 取值与逐击杀重算完全一致，调用数从「每击杀 1 次」降到「每次编制变化 1 次」。
    if (typeof getSquadSalvageEfficiency === "function") {
      const _sig = salvageSnapshotSignature(state);
      if (s.salvageSquadSig !== _sig) {
        const _eff = getSquadSalvageEfficiency(state);
        s.salvageSquadSig = _sig;
        s.salvageSquadTotal = Math.max(typeof s.salvageSquadTotal === "number" ? s.salvageSquadTotal : 0, _eff);
      }
    }
    // 打捞臂燃料消耗（装备即生效，每击毁一艘扣基准燃料；开主动×3）：
    // 与在线 combat.js（击杀处理末尾）**逐杀**同口径 —— 乘战斗燃料倍率 fuelMult 并 max(1, round())，
    // 且从会话虚拟燃料池 s.fuel 逐杀扣除（而非 flush 按总击杀数一次性扣），
    // 使「击杀瞬间扣油 → 影响后续能否开火」的语义与在线一致。
    // ⚠️ 修复前：flush 里按 s.kills 总额扣且**漏乘 fuelMult**（还未 round）⇒ 高电容管理技能下
    //    离线打捞臂油耗 = 在线的 1/fuelMult 倍（玩家实测报 3 倍，对应 fuelMult≈0.333）。
    // 余额不足时不扣，与 ResourceRegistry.spend 的「不足则返回 false 不扣」语义一致。
    const _salvageFuelPKFn = G("getSquadSalvageFuelPerKill");
    const salvageFuelPK = (typeof _salvageFuelPKFn === "function") ? _salvageFuelPKFn(state) : 0;
    // ⚠️ 死亡空间免除（2026-09-15）：与在线 combat.js 同口径 —— 死亡空间无任何打捞臂收益
    //   （本文件 862 / 874 行的同位素主动打捞与 MTU 组件产出同样带 !isDeathspace 门禁），
    //   故此处不再从会话虚拟燃料池 s.fuel 扣打捞臂燃耗。MTU 燃耗在 flush 处（独立块）不在此列。
    if (!isDeathspace && salvageFuelPK > 0) {
      const salvageBase = state.settings.salvageArmActive ? salvageFuelPK * 3 : salvageFuelPK;
      const _fuelMultFn = G("getCombatFuelMultiplierFromState");
      const fuelMultiplier = (typeof _fuelMultFn === "function") ? _fuelMultFn(state, zone) : 1;
      const salvageFuelAmt = Math.max(1, Math.round(salvageBase * fuelMultiplier));
      if (s.fuel >= salvageFuelAmt) s.fuel = Math.max(0, s.fuel - salvageFuelAmt);
    }
    bump(s.killsByKind, enemy.kind, 1);
    if (zone) {
      bump(s.killsByZone, zone.id, 1);
      bump(s.killsByFaction, zone.faction, 1);
      const fk = s.killsByFactionKind[zone.faction] = s.killsByFactionKind[zone.faction] || { normal: 0, elite: 0, boss: 0 };
      bump(fk, enemy.kind, 1);
    }
    // ISK（确定性：iskDrop*iskMulti）；MTU +10%（断料不放大，iskBonus 已为 0）
    const mtuMod = (typeof getMtuModifiers === "function") ? getMtuModifiers(state) : null;
    const iskMult = (mtuMod && mtuMod.active && mtuMod.iskBonus > 0) ? (1 + mtuMod.iskBonus) : 1;
    const isk = Math.round((enemy.iskDrop || 0) * (zone ? zone.iskMulti : 1) * iskMult);
    s.iskDelta += isk;
    // LP（若有）；MTU +10%（断料不放大）
    if (typeof enemy.lpDrop === "number") {
      const lpMult = (mtuMod && mtuMod.active && mtuMod.lpBonus > 0) ? (1 + mtuMod.lpBonus) : 1;
      s.lpDelta += Math.round(enemy.lpDrop * (zone ? (zone.lpMulti || 1) : 1) * lpMult);
    }
    // 功勋(lp)逐杀：精英/Boss 也发放（与在线 combat.js:resolveCombatEnemyDefeat 一致，2026-09-14 修复）。
    // 比例锚 zone.clearLp，带下限保证低安全级星带精英也有可见功勋；MTU 功勋 +10% 同口径。
    if ((enemy.kind === "elite" || enemy.kind === "boss") && zone && Number(zone.clearLp) > 0) {
      const clearLp = Number(zone.clearLp);
      const lpMult = (mtuMod && mtuMod.active && mtuMod.lpBonus > 0) ? (1 + mtuMod.lpBonus) : 1;
      const ratio = enemy.kind === "boss" ? 0.5 : 0.1;
      const floor = enemy.kind === "boss" ? 2 : 1;
      s.lpDelta += Math.max(floor, Math.round(clearLp * ratio * lpMult));
    }
    // 掉落累计（按 category 记录 N 与精英/Boss 细分）
    const da = s.dropAccum;
    if (isDeathspace && site) {
      if (enemy.deathspaceLeader) {
        const cfgs = G("getDeathspaceLeaderLootConfigs")(site);
        const wc = cfgs[Math.max(0, (enemy.deathspaceWave || 1) - 1)];
        if (wc) {
          (da.leader[site.id] = da.leader[site.id] || []).push({ wave: wc.wave, isFinal: wc.isFinal, core: true, proto: wc.isFinal });
        }
      }
      // 死亡空间无 faction data / ticket / zone special（与 roll* 一致）
      // 势力考古探针本体（死亡空间专属；小怪也掉，概率 = 首领 × 1/4，flush 时确定性重滚）
      const pcfgs = typeof G("getDeathspaceProbeDropConfigs") === "function"
        ? G("getDeathspaceProbeDropConfigs")(site)
        : (G("getDeathspaceProbeDropConfig")(site) ? [G("getDeathspaceProbeDropConfig")(site)] : []);
      for (const pcfg of pcfgs) {
        const key = site.id + "::" + pcfg.resourceId;
        const pv = (da.probe[key] = da.probe[key] || {
          resourceId: pcfg.resourceId, qty: pcfg.qty,
          normalChance: pcfg.normalChance, bossChance: pcfg.bossChance, normal: 0, boss: 0
        });
        pv[enemy.deathspaceLeader ? "boss" : "normal"]++;
      }
    } else if (zone) {
      if (enemy.kind === "elite" || enemy.kind === "boss") {
        (da.factionData[zone.id] = da.factionData[zone.id] || { elite: 0, boss: 0 });
        da.factionData[zone.id][enemy.kind]++;
        const tcfgs = typeof G("getDeathspaceTicketDropConfigs") === "function"
          ? G("getDeathspaceTicketDropConfigs")(zone)
          : (G("getDeathspaceTicketDropConfig")(zone) ? [G("getDeathspaceTicketDropConfig")(zone)] : []);
        if (tcfgs.length) {
          (da.ticket[zone.id] = da.ticket[zone.id] || { elite: 0, boss: 0 });
          da.ticket[zone.id][enemy.kind]++;
        }
      }
      const sc = G("getCombatZoneSpecialDropConfigs")(zone);
      for (const cfg of sc) {
        (da.zoneSpecial[zone.id] = da.zoneSpecial[zone.id] || []).push({ resourceId: cfg.resourceId, qty: cfg.qty, kind: enemy.kind });
      }
      const coreCfgs = G("getStationCoreDropConfigs")(zone);
      if (coreCfgs.length && (enemy.kind === "elite" || enemy.kind === "boss")) {
        (da.stationCore[zone.id] = da.stationCore[zone.id] || { elite: 0, boss: 0 });
        da.stationCore[zone.id][enemy.kind]++;
      }
      // 货柜（按敌方船级+kind 记录计数，flush 时确定性重滚；死亡空间不计入）
      const cargoCls = (typeof getEnemyCargoClass === "function") ? getEnemyCargoClass(zone.faction, enemy.type) : "frigate";
      const cargoZoneMap = (da.cargo[zone.id] = da.cargo[zone.id] || {});
      const cargoClsMap = (cargoZoneMap[cargoCls] = cargoZoneMap[cargoCls] || { normal: 0, elite: 0, boss: 0 });
      cargoClsMap[enemy.kind]++;
    }
    // 同位素标记打捞臂：主动打捞（开关开启 + 已装备打捞臂 + 有同位素才记录；死亡空间不触发，与货柜一致）
    // 2026-09-18：门禁统一走 hasSalvageArmEquipped（= 只看真实装备的打捞臂，排除 MTU）。
    //   旧写在线的 combat.js 用 hasSalvageArmEquipped、离线这里却内联 getSquadSalvageEfficiency > 0（含 MTU 2.10）
    //   ⇒ 口径不一致：无臂玩家离线开开关会白扣同位素，且离线/在线行为分叉。
    if (!isDeathspace && state.settings.salvageArmActive && (typeof hasSalvageArmEquipped === "function") && hasSalvageArmEquipped(state)) {
      const isoCost = (typeof getSalvageComponentQty === "function") ? getSalvageComponentQty(enemy.kind) : 1; // 1/2/3
      if ((s.iso || 0) >= isoCost) {
        s.iso -= isoCost;
        const tier = (typeof getSalvageComponentTier === "function") ? getSalvageComponentTier(enemy.level) : "";
        const sk = (s.salvageByTier = s.salvageByTier || {});
        const tk = (sk[tier] = sk[tier] || { normal: 0, elite: 0, boss: 0 });
        tk[enemy.kind] = (tk[enemy.kind] || 0) + 1;
      }
    }
    // 激光定向打捞单元（MTU）：部署即独立产出舰船组件（不依赖打捞臂/同位素/主动开关）；断料不记录。
    // 仅记录按档位+kind 的尝试计数，flush 时与打捞臂同公式确定性重滚（getSalvageEfficiency 已含 MTU 的 2.10）。
    if (!isDeathspace && mtuMod && mtuMod.active && mtuMod.count > 0) {
      const tier = (typeof getSalvageComponentTier === "function") ? getSalvageComponentTier(enemy.level) : "";
      const mk = (s.mtuSalvageByTier = s.mtuSalvageByTier || {});
      const tk = (mk[tier] = mk[tier] || { normal: 0, elite: 0, boss: 0 });
      tk[enemy.kind] = (tk[enemy.kind] || 0) + 1;
    }
    // 战术材料（按 kind 累计 N；期望数量在 flush 计算）
    if (enemy.kind === "elite") da.tactical.elite++;
    else if (enemy.kind === "boss") da.tactical.boss++;
    else da.tactical.normal++;
    // ---- M6a 事件账本（只记录，零行为改动；关闭时此块不执行）----
    // 位置：本条全部既有账目之后 ⇒ 记录的是「本次击杀的最终事实」，
    // 不参与任何计算、不写任何状态，因此对 A/B 逐字节对拍零影响。
    if (m6aEnabled()) {
      m6aRecordKill(state, s, enemy, zone, isDeathspace, site, _m6a0, isk, mtuMod, iskMult, salvageFuelPK);
    }
  }

  // ---- M6a：把一次击杀打成结构化账本条目（**纯读取**）----
  // 契约：不写 state、不改 s 的任何既有字段、不调用任何有副作用的函数。
  //   · 复用 recordKill 已算好的顶层常量（isk / mtuMod / iskMult / salvageFuelPK），**不重算**；
  //   · 仅对「块作用域里拿不到」的量做纯函数重算（getSalvageComponentTier / getEnemyCargoClass /
  //     getCombatZoneSpecialDropConfigs / getDeathspaceLeaderLootConfigs），这些都是无状态查询。
  //   · 有序数组（zoneSpecial / leader）逐条按原顺序记录。
  function m6aRecordKill(state, s, enemy, zone, isDeathspace, site, snap, isk, mtuMod, iskMult, salvageFuelPK) {
    M6A_STATS.killsSeen++;
    if (M6A_LEDGER.length >= M6A_MAX_ENTRIES) { M6A_STATS.truncated = true; return; }
    try {
      const c = state.combat || {};
      const k = enemy || {};
      const snap0 = snap || { fuel: s.fuel || 0, iso: s.iso || 0, lp: s.lpDelta || 0, rep: null };
      const enemyClass0 = (zone && typeof getReputationShipClass === "function") ? getReputationShipClass(zone) : null;
      // 声望账目点（applyReputationKill 的写入形态：weightedKills[faction] += SHIP_POINTS[class]）
      const _spFn = G("REPUTATION_SHIP_POINTS");
      const repPoints = (_spFn && enemyClass0 && Number(_spFn[enemyClass0])) ? Number(_spFn[enemyClass0]) : null;
      const repAfter = m6aRepSnapshot(state);
      // ⭐ 有序：zoneSpecial 的「按配置展开」序列 —— 与 recordKill 中 `for (const cfg of sc)` 同源同序。
      let zsCfgs = null;
      if (!isDeathspace && zone) {
        const _zsFn = G("getCombatZoneSpecialDropConfigs");
        if (typeof _zsFn === "function") {
          const sc = _zsFn(zone) || [];
          zsCfgs = sc.map((cfg) => ({ resourceId: cfg.resourceId, qty: cfg.qty }));
        }
      }
      // ⭐ 有序：死亡空间首领的追加位次（与 recordKill 中 `cfgs[wave-1]` 同源）。
      let leaderCfg = null;
      if (isDeathspace && site && k.deathspaceLeader) {
        const _ldFn = G("getDeathspaceLeaderLootConfigs");
        if (typeof _ldFn === "function") {
          const cfgs = _ldFn(site) || [];
          const wc = cfgs[Math.max(0, (k.deathspaceWave || 1) - 1)];
          if (wc) leaderCfg = { wave: wc.wave, isFinal: Boolean(wc.isFinal), core: true, proto: Boolean(wc.isFinal) };
        }
      }
      const _tierFn = G("getSalvageComponentTier");
      const tier = (typeof _tierFn === "function") ? _tierFn(k.level) : "";
      const _cargoClsFn = G("getEnemyCargoClass");
      const cargoCls = (zone && typeof _cargoClsFn === "function") ? _cargoClsFn(zone.faction, k.type) : null;
      // ⭐ M6b 补记一：打捞臂 / MTU 计数**是否真的记了**（与 recordKill 内两处门禁逐字同口径），
      //   取代「靠 isoSpent > 0 / mtuActive 反推」的脆弱判据。
      //   · 打捞臂门禁第三项 `(s.iso||0) >= isoCost` 用击杀前快照 snap0.iso 判定 ——
      //     该分支是 s.iso 的**唯一**减点（其余 iso 变化都不是逐杀），故与实读等价。
      let isoRec = false;
      if (!isDeathspace && state && state.settings && state.settings.salvageArmActive
        && (typeof hasSalvageArmEquipped === "function") && hasSalvageArmEquipped(state)) {
        const _qFn0 = G("getSalvageComponentQty");
        const isoCost0 = (typeof _qFn0 === "function") ? _qFn0(k.kind) : 1;
        isoRec = (snap0.iso || 0) >= isoCost0;
      }
      const mtuRec = Boolean(!isDeathspace && mtuMod && mtuMod.active && mtuMod.count > 0);
      const fuelSpent = Math.max(0, snap0.fuel - (s.fuel || 0));
      const isoSpent = Math.max(0, snap0.iso - (s.iso || 0));
      const _ent = {
        seq: ++_m6aSeq,                                  // 单调序号 ⇒ 保序 + 无空洞
        ev: "kill",                                      // 条目标签：击杀
        t: (_m6aNowRef && typeof _m6aNowRef.t === "number") ? _m6aNowRef.t : null, // 权威虚拟时刻（按波推进）
        tAcc: Number(s.simulatedSeconds) || 0,           // 会话累计模拟秒（settle 内累加口径，仅作交叉核对）
        killIndex: s.kills,                              // 与 s.kills 同口径的累计序
        kind: k.kind || null, level: (k.level != null ? k.level : null), type: k.type || null,
        zoneId: zone ? zone.id : null, faction: zone ? zone.faction : null,
        enemyClass: enemyClass0,
        // ⭐ 声望账目点（recordKill 里 applyReputationKill 的输入与结果，用于逐杀对账）
        repFaction: zone ? zone.faction : null, repPoints: repPoints,
        repBefore: snap0.rep, repAfter: repAfter,
        isDeathspace: Boolean(isDeathspace), siteId: site ? site.id : null,
        wave: (c.wave != null ? c.wave : null),
        deathspaceWave: k.deathspaceWave || 0,
        zsCfgs: zsCfgs,                                  // ⭐ 有序（可能为 null）
        leaderCfg: leaderCfg,                            // ⭐ 有序（可能为 null）
        isk: isk, lp: Math.max(0, (s.lpDelta || 0) - snap0.lp),
        iskMult: iskMult,
        mtuActive: Boolean(mtuMod && mtuMod.active), mtuCount: (mtuMod && mtuMod.count) || 0,
        // 打捞/MTU 计数锚（**不是**扣减量；flush 时才按公式重滚）
        salvageTier: tier, mtuTier: tier,
        cargoCls: cargoCls,
        probeKeys: null, ticketKind: null, stationCoreKind: null,
        // ⭐ M6b 补记二：死亡空间首领判据 —— 探针 normal/boss 分桶的**唯一权威**依据。
        //   不能靠 `leaderCfg != null` 间接推断：leader 在 cfgs[wave-1] 缺失时 leaderCfg 为 null，
        //   但 recordKill 仍按 enemy.deathspaceLeader 记 boss 桶 ⇒ 反推会漏。
        dsLeader: Boolean(k.deathspaceLeader),
        // ⭐ M6b 补记一：是否真的记了打捞臂 / MTU 计数（见上方 isoRec / mtuRec 计算）
        isoRec: isoRec, mtuRec: mtuRec,
        // ⚠️ 余额门控事实（只记录本次**实际**扣了多少，不接管扣减）
        fuelSpent: fuelSpent, fuelBefore: snap0.fuel, fuelAfter: (s.fuel || 0),
        isoSpent: isoSpent, isoBefore: snap0.iso, isoAfter: (s.iso || 0),
        salvageFuelPerKill: salvageFuelPK
      };
      // 死亡空间专属：势力考古探针本体（小怪也掉 ⇒ 逐配置记 key，保序）
      if (isDeathspace && site) {
        const _pFn = G("getDeathspaceProbeDropConfigs");
        const _p1 = G("getDeathspaceProbeDropConfig");
        const pcfgs = (typeof _pFn === "function") ? (_pFn(site) || [])
          : ((typeof _p1 === "function" && _p1(site)) ? [_p1(site)] : []);
        _ent.probeKeys = pcfgs.map((p) => site.id + "::" + p.resourceId);
      } else if (zone) {
        if (k.kind === "elite" || k.kind === "boss") {
          const _tkFn = G("getDeathspaceTicketDropConfigs");
          const _tk1 = G("getDeathspaceTicketDropConfig");
          const tcfgs = (typeof _tkFn === "function") ? (_tkFn(zone) || [])
            : ((typeof _tk1 === "function" && _tk1(zone)) ? [_tk1(zone)] : []);
          if (tcfgs.length) _ent.ticketKind = k.kind;
        }
        const _scFn = G("getStationCoreDropConfigs");
        if (typeof _scFn === "function") {
          const coreCfgs = _scFn(zone) || [];
          if (coreCfgs.length && (k.kind === "elite" || k.kind === "boss")) _ent.stationCoreKind = k.kind;
        }
      }
      M6A_LEDGER.push(_ent);
      M6A_STATS.entries++;
      M6A_STATS.killEntries++;
      bump(M6A_STATS.byKind, k.kind || "?", 1);
      if (zone) { bump(M6A_STATS.byFaction, zone.faction, 1); bump(M6A_STATS.byZone, zone.id, 1); }
      if (zsCfgs) M6A_STATS.orderedZs += zsCfgs.length;
      if (leaderCfg) M6A_STATS.orderedLeader++;
    } catch (_e) {
      M6A_STATS.errors++;   // 非零 ⇒ 账本不完整 ⇒ 验收必须 FAIL（不得静默）
    }
  }

  // ---- 普通星带结算 ----
  function simulateBelt(state, segSec, s, nowRef) {
    const c = state.combat;
    s.mode = "belt";
    if (!c.active) { s.stopReason = "inactive"; return 0; }
    let budgetMs = segSec * 1000;

    while (budgetMs > 0 && c.active) {
      // zone/waveNum 在循环内重算以支持队列下一项续战（combat→combat 打到正确星带）
      const zone = G("getCombatEncounterZone")(c);
      if (!zone) { s.stopReason = "no-zone"; return budgetMs / 1000; }
      let waveNum = c.wave && c.wave >= 1 ? c.wave : 1;
      const maxWave = zone.maxWave || 99;
      // 每波重新读状态 + 生成波次（确定性 RNG）
      const rng = detRng(c);
      const built = G("buildCombatWave")(zone, waveNum, rng, c);
      const enemies = built.enemies.map(e => ({
        id: e.id, type: e.type, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
        dodge: e.dodge, baseDamage: e.baseDamage, auraDamage: e.auraDamage || 0, kind: e.kind,
        bossHealPct: e.bossHealPct || 0, bossHealEvery: e.bossHealEvery || 5, enrageMul: e.enrageMul || 0, enrageAt: e.enrageAt || 0.3,
        maxHp: e.maxHp ? { shield: e.maxHp.shield, armor: e.maxHp.armor, structure: e.maxHp.structure } : null, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
        level: e.level,
        deathspaceLeader: false, deathspaceWave: 0, _rewarded: false
      }));
      if (fpEnabled()) fpAccountWave(state, enemies, s); // M0：只分类统计，不改变行为
      m4WaveBegin(state, enemies, s, false); // M4-1：波首只读采样（默认关闭 ⇒ 立即 return，零开销）
      const res = simulateWave(state, enemies, zone, false, null, s, nowRef);
      m4WaveEnd(); // M4-1：波末汇总（默认关闭 ⇒ 立即 return）
      // 扣除本波耗时
      const waveMs = res.rounds * ROUND_SECONDS * 1000;
      budgetMs -= waveMs;
      s.simulatedSeconds += res.rounds * ROUND_SECONDS;
      s.roundsEstimated += res.rounds;
      if (fpEnabled()) FP_STATS.roundRuns += res.rounds; // M0：实际逐轮模拟的轮数
      // ⭐ 停摆短路（2026-09-19 性能修复）：本波不可推进（敌我都不掉血）⇒ 立即停止离线战斗模拟，
      // 剩余离线时间交还时间轴给生产结算。修复前该情形会空转到 MAX_WAVE_ROUNDS
      //（6000 轮 ≈ 8.3s CPU，玩家感知为「登录/切回前台卡死数秒」，且会白记一次清波）。
      // 停止原因复用已有文案（弹药耗尽 / 资源不足），与下方波间 canContinue 检查完全同口径。
      if (res.outcome === "stalemate") {
        s.stopReason = (s.blockedBy === "ammo") ? "ammo" : "resources";
        return budgetMs / 1000;
      }
      // M6c：**波级**折叠边界（波首编队已由 buildCombatWave 定下，波内无声望读点）
      m6cBegin(state);
      for (const k of res.kills) recordKill(state, s, k, zone, false, null);
      m6cEnd(state);
      if (res.kills.length > 0) recordFirst(s, "firstKill", nowRef.t);

      if (res.outcome === "defeated") {
        handleDefeat(state, s, nowRef, zone, "belt");
        s.stopReason = (c.active ? "belt-continue-after-repair" : "repairing");
        if (!c.active) return; // 剩余离线不足，保存维修中（维修延续到登录后，不计入本段离线战斗时间）
        // 维修完成 → 扣除 180s 真实维修时间（与在线每战败耗 180s 一致），再回该星带第 1 波继续
        budgetMs -= REPAIR_MS;
        waveNum = 1;
        continue;
      }
      // 清波
      bump(s.wavesByZone, zone.id, 1);
      if (waveNum > s.maxWaveReached) s.maxWaveReached = waveNum;
      if (s.currentRunToken !== null) {
        const rd = s.runsDetail.find(r => r.token === s.currentRunToken);
        if (rd) rd.wavesCleared++;
      }
      recordFirst(s, "firstWaveClear", nowRef.t);
      if (waveNum < maxWave) {
        waveNum++;
      } else {
        bump(s.zoneClearsByZone, zone.id, 1);
        // 对齐在线 resolveCombatWaveVictory 的清区 LP（belt 敌无 lpDrop，离线 LP 仅此来源）；MTU +10%
        const mtuLpMod = (typeof getMtuModifiers === "function") ? getMtuModifiers(state) : null;
        const mtuLpMult = (mtuLpMod && mtuLpMod.active && mtuLpMod.lpBonus > 0) ? (1 + mtuLpMod.lpBonus) : 1;
        s.lpDelta += Math.round((zone.clearLp || 0) * mtuLpMult);
        // M6a：记非逐杀的清波 LP（只追加只读条目；不改任何值）
        if (m6aEnabled()) m6aRecordRes(state, s, "lp-zone-clear", Math.round((zone.clearLp || 0) * mtuLpMult), { zoneId: zone.id, wave: maxWave, maxWave: maxWave });
        // 队列会话内记一次「整轮肃清已折算波数」：与在线 resolveCombatWaveVictory 同口径，
        // 供队列达标时扣除，避免同一批波次在离线侧发两次功勋。
        if (c.queueItemId && c.queueWavesTarget > 0) {
          c.queueLpSettledWaves = (c.queueLpSettledWaves || 0) + maxWave;
        }
        recordFirst(s, "firstZoneClear", nowRef.t);
        waveNum = 1; // 从第 1 波继续（不自动换区）
      }
      // 队列感知：普通星带每清一波累计 queueWavesDone（与在线 resolveCombatWaveVictory 一致）；
      // 达标则停止离线模拟并终结队列项（受时间/资源约束，离线最多清到目标即停）。
      if (c.queueItemId && c.queueWavesTarget > 0) {
        c.queueWavesDone = (c.queueWavesDone || 0) + 1;
        // 2026-09-05：同步扣减耐久队列项计数（与在线 resolveCombatWaveVictory 一致），
        // 保证离线刷掉的波次在停止 / 插队后重启仍然保留，而不是回到入队原值。
        const consumeWaves = G("consumeCombatQueueItemCount");
        if (typeof consumeWaves === "function") consumeWaves(state, 1);
        if (state.resumeAfterRepair && state.resumeAfterRepair.type === "combat" && state.resumeAfterRepair.queueItemId === c.queueItemId) {
          state.resumeAfterRepair.queueWavesDone = c.queueWavesDone;
        }
        if (c.queueWavesDone >= c.queueWavesTarget) {
          // 与在线 grantQueueWaveLp 同口径：按「未完成整轮肃清的余波 ÷ 满波数」折算 clearLp，
          // 使离线挂机的队列战斗同样拿到功勋（此前离线队列达标也是零功勋）。
          const restWaves = (c.queueWavesDone || 0) - (c.queueLpSettledWaves || 0);
          if ((zone.clearLp || 0) > 0 && restWaves > 0) {
            const mtuModQ = (typeof getMtuModifiers === "function") ? getMtuModifiers(state) : null;
            const mtuMultQ = (mtuModQ && mtuModQ.active && mtuModQ.lpBonus > 0) ? (1 + mtuModQ.lpBonus) : 1;
            s.lpDelta += Math.round((zone.clearLp || 0) * (restWaves / maxWave) * mtuMultQ);
            // M6a：记非逐杀的「队列部分清波」LP（只追加只读条目；不改任何值）
            if (m6aEnabled()) m6aRecordRes(state, s, "lp-queue-partial-clear", Math.round((zone.clearLp || 0) * (restWaves / maxWave) * mtuMultQ), { zoneId: zone.id, wave: maxWave, restWaves: restWaves, maxWave: maxWave });
          }
          const ok = finishOfflineCombatQueueItem(state, nowRef);
          if (!ok) { s.stopReason = s.stopReason || "queue-finalize-error"; return budgetMs / 1000; }
          s.stopReason = "queue-target-reached";
          // 下一项若为战斗（c.active 仍为 true）则本循环续清；否则 c.active 已 false，
          // 循环退出后由离线时间轴交接给生产结算，继续消耗剩余离线时间。
          continue;
        }
      }
      c.wave = waveNum;
      // 资源不足 → 停止进攻（敌人仍会造成伤害已在 simulateWave 内处理；此处判定无法继续开火）
      if (budgetMs <= 0) { s.stopReason = "time"; return; }
      const inputs = readInputs(state, nowRef);
      ensureVirtualAmmoFuel(state, s);
      // D2=A：与 simulateWave 内每轮 gate 同口径——主武器或常规副武器任一可开火即可继续。
      const _convOk = canFireVirtual(inputs, zone, s, state);
      const canContinue = inputs.isTitan ? (canFireTitanVirtual(state, inputs, zone, s) || _convOk) : _convOk;
      if (!canContinue) { s.stopReason = (s.blockedBy === "ammo") ? "ammo" : "resources"; return; }
    }
    if (!c.active) s.stopReason = s.stopReason || "resolved";
    else s.stopReason = s.stopReason || "time";
    return budgetMs / 1000;
  }

  // ---- 死亡空间连刷结算 ----
  function simulateDeathspace(state, segSec, s, nowRef) {
    const c = state.combat;
    s.mode = "deathspace";
    let budgetMs = segSec * 1000;
    const site = G("getDeathspaceById")(c.deathspaceId);
    if (!site) { s.stopReason = "no-site"; c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0; return; }
    const zone = G("getCombatEncounterZone")(c) || COMBAT_ZONES.find(z => z.id === site.sourceZoneId);

    while (budgetMs > 0 && (c.active || c.deathspaceChainPending)) {
      if (!c.active && c.deathspaceChainPending) {
        // 连刷续入：消耗 1 秒虚拟时间
        nowRef.t += ROUND_SECONDS * 1000; advanceBoosterTime(state, ROUND_SECONDS * 1000, nowRef.t); budgetMs -= ROUND_SECONDS * 1000;
        s.simulatedSeconds += ROUND_SECONDS;
        if (c.deathspaceChainRemaining <= 0) { c.deathspaceChainPending = false; break; }
        // 校验（武器/密钥）—— 等级门槛已在 combat.js:2007 在线端移除，离线续入需与在线同口径，故此处不再查 requiredCL
        // 泰坦主武器为舰体自带（不在 fitting 表内）：以「泰坦主武器存在」等价放行（与常规舰武器校验同语义）
        const _chainShip = G("getActiveShip")(state);
        const _chainTitanOk = _chainShip && typeof G("isTitanCombatShip") === "function" && G("isTitanCombatShip")(_chainShip) && Boolean(_chainShip.weapon);
        if (!_chainTitanOk && G("getInstalledCombatWeapons")(state).length === 0) { c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0; s.stopReason = "no-weapons"; break; }
        const RR = G("ResourceRegistry");
        if (RR.get(state, "special:" + site.ticketMaterial) < 1) {
          // 密钥不足：不扣、不进入、remaining/pending 清零、连刷结束
          c.deathspaceChainRemaining = 0; c.deathspaceChainPending = false;
          s.stopReason = "no-keys"; break;
        }
        // 成功续入：同 runToken（continuation），扣 1 密钥，remaining--
        const rng = detRng(c);
        const built = G("buildDeathspaceWave")(site, 1, rng, c);
        const enemies = built.enemies.map(e => ({
          id: e.id, type: e.type, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
          dodge: e.dodge, baseDamage: e.baseDamage, auraDamage: e.auraDamage || 0, kind: e.kind,
        bossHealPct: e.bossHealPct || 0, bossHealEvery: e.bossHealEvery || 5, enrageMul: e.enrageMul || 0, enrageAt: e.enrageAt || 0.3,
        maxHp: e.maxHp ? { shield: e.maxHp.shield, armor: e.maxHp.armor, structure: e.maxHp.structure } : null, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
          deathspaceLeader: Boolean(e.deathspaceLeader), deathspaceWave: e.deathspaceWave || 1, _rewarded: false
        }));
        RR.spend(state, "special:" + site.ticketMaterial, 1);
        s.ticketsConsumed++;
        c.deathspaceChainRemaining--;
        c.deathspaceChainPending = false;
        c.active = true; c.mode = "deathspace"; c.enemies = enemies; c.currentEnemy = enemies[0] || null;
        c.wave = 1; c.totalKills = 0; c.runEliteKills = 0;
        c.lastStatus = "通行密钥已消耗";
        s.chainContinuations++;
        recordFirst(s, "firstChainContinuation", nowRef.t);
        bump(s.deathspaceEntriesById, site.id, 1);
        bump(s.deathspaceWavesById, site.id, 1);
        if (s.currentRunToken !== null) {
          const rd = s.runsDetail.find(r => r.token === s.currentRunToken);
          if (rd) rd.wavesCleared++;
        }
      }
      // 模拟当前死亡空间波（可能多 wave 的 site：逐 wave 推进）
      let waveIdx = c.wave && c.wave >= 1 ? c.wave : 1;
      const siteWaves = Array.isArray(site.waves) ? site.waves.length : 1;
      while (waveIdx <= siteWaves && budgetMs > 0 && c.active) {
        const rng = detRng(c);
        const built = G("buildDeathspaceWave")(site, waveIdx, rng, c);
        const enemies = built.enemies.map(e => ({
          id: e.id, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
          dodge: e.dodge, baseDamage: e.baseDamage, auraDamage: e.auraDamage || 0, kind: e.kind,
        bossHealPct: e.bossHealPct || 0, bossHealEvery: e.bossHealEvery || 5, enrageMul: e.enrageMul || 0, enrageAt: e.enrageAt || 0.3,
        maxHp: e.maxHp ? { shield: e.maxHp.shield, armor: e.maxHp.armor, structure: e.maxHp.structure } : null, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
          deathspaceLeader: Boolean(e.deathspaceLeader), deathspaceWave: waveIdx, _rewarded: false
        }));
        if (fpEnabled()) fpAccountWave(state, enemies, s); // M0：只分类统计，不改变行为
        m4WaveBegin(state, enemies, s, true); // M4-1：波首只读采样（默认关闭 ⇒ 立即 return，零开销）
        const res = simulateWave(state, enemies, zone, true, site, s, nowRef);
        m4WaveEnd(); // M4-1：波末汇总（默认关闭 ⇒ 立即 return）
        budgetMs -= res.rounds * ROUND_SECONDS * 1000;
        s.simulatedSeconds += res.rounds * ROUND_SECONDS;
        s.roundsEstimated += res.rounds;
        if (fpEnabled()) FP_STATS.roundRuns += res.rounds; // M0：实际逐轮模拟的轮数
        // ⭐ 停摆短路（与 simulateBelt 同口径）：本波不可推进 ⇒ 停止离线战斗并交还剩余时间给生产。
        if (res.outcome === "stalemate") {
          s.stopReason = (s.blockedBy === "ammo") ? "ammo" : "resources";
          return budgetMs / 1000;
        }
        // M6c：死亡空间同粒度折叠（该路径的波由 buildDeathspaceWave 生成、不读声望）
        m6cBegin(state);
        for (const k of res.kills) recordKill(state, s, k, zone, true, site);
        m6cEnd(state);
        if (res.kills.length > 0) {
          bump(s.deathspaceWavesById, site.id, 1);
          recordFirst(s, "firstKill", nowRef.t);
        }
        if (res.outcome === "defeated") {
          // 战败：当前密钥不退；remaining/pending 清零；进入 180 秒维修；修好只回来源普通星带
          c.deathspaceChainRemaining = 0; c.deathspaceChainPending = false;
          handleDefeat(state, s, nowRef, zone, "deathspace");
          s.stopReason = (c.active ? "ds-continue-after-repair" : "repairing");
          if (!c.active) return;
          budgetMs -= REPAIR_MS; // 维修完成：扣除 180s 真实维修时间（与在线一致）
          return; // 回来源普通星带由调用方决定；此处结束死亡空间模拟
        }
        if (waveIdx < siteWaves) { waveIdx++; c.wave = waveIdx; }
        else break;
      }
      if (!c.active) break;
      // 整条死亡空间通关
      bump(s.deathspaceClearsById, site.id, 1);
      recordFirst(s, "firstDeathspaceClear", nowRef.t);
      // 离线死亡空间清场同样掉落舰船制造脑插（与在线同概率 5%；用离线确定性 RNG 掷骰，避免重发 combat:deathspaceCleared 事件导致 LP/清场双计）
      const _rollDsImplant = G("rollDeathspaceImplantDrop");
      if (typeof _rollDsImplant === "function") _rollDsImplant(state, site.id, detRng(c));
      // 队列感知：死亡空间每全通一次计 1 入场（与在线 resolveDeathspaceWaveVictory 一致）；
      // 达标则停止离线模拟并终结队列项；未达标则手动重入下一入场（消耗密钥），由 queueEntries 接管连刷计数。
      if (c.queueItemId && c.queueEntriesTarget > 0) {
        c.queueEntriesDone = (c.queueEntriesDone || 0) + 1;
        // 2026-09-05：同步扣减耐久队列项计数（与在线死亡空间入场一致）。
        const consumeEntries = G("consumeCombatQueueItemCount");
        if (typeof consumeEntries === "function") consumeEntries(state, 1);
        if (state.resumeAfterRepair && state.resumeAfterRepair.type === "combat" && state.resumeAfterRepair.queueItemId === c.queueItemId) {
          state.resumeAfterRepair.queueEntriesDone = c.queueEntriesDone;
        }
        if (c.queueEntriesDone >= c.queueEntriesTarget) {
          const ok = finishOfflineCombatQueueItem(state, nowRef);
          if (!ok) { s.stopReason = s.stopReason || "queue-finalize-error"; return budgetMs / 1000; }
          s.stopReason = "queue-target-reached";
          return budgetMs / 1000;
        }
        // 未达标：手动重入下一入场（消耗密钥），绕过既有链 break 以便继续清场
        const RRd = G("ResourceRegistry");
        if (!RRd || RRd.get(state, "special:" + site.ticketMaterial) < 1) {
          const ok = finishOfflineCombatQueueItem(state, nowRef);
          if (!ok) { s.stopReason = "queue-finalize-error"; return budgetMs / 1000; }
          s.stopReason = "no-keys";
          return budgetMs / 1000;
        }
        const nw = G("buildDeathspaceWave")(site, 1, detRng(c), c);
        const nen = nw.enemies.map(e => ({ id:e.id, hit:e.hit, hp:{shield:e.hp.shield,armor:e.hp.armor,structure:e.hp.structure}, dodge:e.dodge, baseDamage:e.baseDamage, kind:e.kind, iskDrop:e.iskDrop, xpDrop:e.xpDrop, deathspaceLeader:Boolean(e.deathspaceLeader), deathspaceWave:1, _rewarded:false }));
        RRd.spend(state, "special:" + site.ticketMaterial, 1);
        s.ticketsConsumed++;
        c.active = true; c.mode = "deathspace"; c.enemies = nen; c.currentEnemy = nen[0] || null;
        c.wave = 1; c.totalKills = 0; c.runEliteKills = 0;
        c.deathspaceChainRemaining = 1; // 仅用于绕过下方 506 的 break；连刷计数由 queueEntries 接管
        c.deathspaceChainPending = false;
        c.lastStatus = "通行密钥已消耗";
        bump(s.deathspaceEntriesById, site.id, 1);
        bump(s.deathspaceWavesById, site.id, 1);
        if (typeof G("setCombatQueueResume") === "function") G("setCombatQueueResume")(state);
        continue; // 外层 while：以新入场重新清场
      }
      if (c.deathspaceChainRemaining > 0) {
        // 写 pending，下一秒虚拟时间续入（循环顶部处理）
        c.deathspaceChainPending = true;
        // 离线时间恰好截止于通关时：保留 pending=true，不提前扣下一枚密钥
        if (budgetMs <= 0) { s.stopReason = "time-pending"; break; }
      } else {
        c.deathspaceChainPending = false;
        s.stopReason = "chain-complete";
        break; // 连刷正常完成，不自动转普通星带
      }
    }
    return budgetMs / 1000;
  }

  function handleDefeat(state, s, nowRef, zone, fromMode) {
    const c = state.combat;
    // 战败：repairUntil = 虚拟战败时刻 + 180000
    const defeatNow = nowRef.t;
    // M4：玩家舰船被击毁 → 清理小队临时状态并释放占用；
    // NPC 的 destroyed / repairUntil / combatHp 保留在 state.legion.npcs[]（不删除 NPC、不动绑定舰）
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && c.squad && c.squad.enabled) {
      LEGION_COMBAT_SQUAD.tickLegionSquadRepairs(state, defeatNow);
      LEGION_COMBAT_SQUAD.endLegionSquadBattle(state);
    }
    // 剩余离线时间 = 整段离线虚拟结束点 - 战败时刻（offlineEnd 由 offline.js 注入；
    // 未注入时退化为 0，安全保留维修中状态，不误判完成）
    const remainMs = (typeof s.offlineEnd === "number") ? Math.max(0, s.offlineEnd - defeatNow) : 0;
    s.defeats++;
    recordFirst(s, "firstDefeat", defeatNow);
    const inst = c.activeShip || (G("getActiveCombatShipInstance")(state) && G("getActiveCombatShipInstance")(state).instanceId) || null;
    c.repairs = c.repairs || {};
    c.repairs[inst] = defeatNow + REPAIR_MS;
    c.active = false;
    c.mode = (fromMode === "deathspace") ? "deathspace" : "belt";
    // 维修是否能在剩余离线时间内完成
    if (remainMs >= REPAIR_MS) {
      // 完成维修
      delete c.repairs[inst];
      c.hp = { shield: c.maxHp.shield, armor: c.maxHp.armor, structure: c.maxHp.structure };
      s.repairsCompleted++;
      recordFirst(s, "firstRepairComplete", defeatNow + REPAIR_MS);
      // 回来源（belt: 该星带第1波；deathspace: 来源普通星带第1波）——由调用方设置 c.zone/c.wave
      if (fromMode === "deathspace") {
        const site = G("getDeathspaceById")(c.deathspaceId);
        const srcZone = site ? site.sourceZoneId : (zone ? zone.id : null);
        if (srcZone) { c.zone = srcZone; c.mode = "belt"; c.wave = 1; c.active = true; }
        c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0;
      } else {
        c.wave = 1; c.active = true;
      }
    }
    // 否则保持维修中（active=false），登录后继续剩余维修
  }

  // =================== 公共入口 ===================
  const OfflineCombatSystem = {
    // 每段由 settleOfflineTimeline 调用；仅累积，不发射事件
    settle: function (state, segSec, context) {
      context = context || {};
      const runId = context.runId || ("offline_" + (context.now || 0).toString(36));
      const s = ensureSession(runId);
      FP_STATS.enabled = fpEnabled(); // M0：仅反映开关状态，不改变行为
      // ⭐ 段首强制失效 L1a 派生缓存（2026-09-19）：会话（含 s._l1a）按 runId **跨段复用**
      // （offline.js 整场离线共用一个 runId，settleOfflineTimeline 逐段调用本函数），
      // 而段与段之间其它离线子系统会改变 hit/dmgMult 的输入 —— 研究完成（离线研究推进）、
      // 军团 NPC tick（贡献快照乘区）、空间站/队列 —— 这些**不经过 _skillEpoch 也不改声望**。
      // 一次 settle 内这些量不会变化，故每段刷新一次即可，成本可忽略。
      if (s._l1a) s._l1a.epoch = -1;
      _stateRef = state;
      if (s.startedAt === null) {
        s.startedAt = (typeof context.now === "number") ? context.now : (G("Date") ? G("Date").now() : 0);
        s.endedAtRef = { t: s.startedAt };
        if (typeof context.offlineEnd === "number") s.offlineEnd = context.offlineEnd;
        ensureVirtualAmmoFuel(state, s);
        const c = state.combat;
        // 修复（2026-09-03）：与在线 tick（tick.js:89-96）同口径 —— 在线仅当
        // currentAction.skill === "combat"（或死亡空间连刷待续）才驱动 combatTick。
        // 旧实现只看 combat.active，导致「先开战斗再切考古」（currentAction 已切走、
        // combat.active 残留 true）时，离线会把同一段时间同时结算给考古和战斗 = 双倍收益。
        const actKey = (state.currentAction && state.currentAction.skill) || null;
        const actActive = Boolean(state.currentAction && state.currentAction.active);
        const dsPendingOffline = actKey === "combat" && Boolean(c.deathspaceChainPending);
        const actionDrivesCombat = (actKey === "combat" && actActive) || dsPendingOffline;
        s.activeAtStart = (Boolean(c.active) || Boolean(c.deathspaceChainPending)) && actionDrivesCombat;
        s.mode = c.mode || (c.deathspaceChainPending ? "deathspace" : "belt");
        if (c.active || c.deathspaceChainPending) {
          // 把同一权威教程 sortie token（activeCombatRunToken）与来源星带 zoneId / 战斗模式 带入离线快照：
          // 在线/离线共用同一 token；仅普通星带（mode==="belt"）且三个一级普通星带之一可完成 C6，
          // 死亡空间（mode==="deathspace"）或高级星带 sortieToken/zone/mode 任一不符 → 不得误完成。
          // token(combat.runToken) 保留供离线内部续波链接使用，不改动。
          const tutToken = (state.tutorial && typeof state.tutorial.activeCombatRunToken === "string") ? state.tutorial.activeCombatRunToken : null;
          s.runs++; s.currentRunToken = c.runToken;
          s.runsDetail.push({ token: c.runToken, sortieToken: tutToken, zoneId: c.zone, mode: c.mode, wavesCleared: 0, defeated: false, zoneClears: 0 });
        }
      }
      if (!s.activeAtStart) { s.stopReason = "inactive"; return 0; } // 离线前无有效战斗，跳过；段内时间已由生产结算接管
      const nowRef = s.endedAtRef;
      // M6a：注入权威虚拟时钟引用（`nowRef.t` 在模拟中按波推进）。纯引用赋值，不改任何状态。
      if (m6aEnabled()) _m6aNowRef = nowRef;
      const segStart = nowRef.t;
      // 按当前模式模拟；left = 段内未被战斗消耗的剩余秒数，交回时间轴给生产结算
      let left = 0;
      const _prof = (typeof globalThis !== "undefined" && globalThis.__OFFLINE_COMBAT_PROFILE === true) ? {
        t0: (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(),
        mode: state.combat.mode === "deathspace" || state.combat.deathspaceChainPending ? "deathspace" : "belt",
        beforeRounds: Number(s.roundsEstimated) || 0, beforeKills: Number(s.kills) || 0
      } : null;
      // 性能优化（2026-09-20）：只包住仿真段挂载装备只读缓存槽；finally 复位（异常安全，支持嵌套）。
      const _perfHandle = beginOfflinePerfCache();
      try {
        if (state.combat.mode === "deathspace" || state.combat.deathspaceChainPending) {
          left = simulateDeathspace(state, segSec, s, nowRef);
        } else if (state.combat.active) {
          left = simulateBelt(state, segSec, s, nowRef);
        }
      } finally {
        endOfflinePerfCache(_perfHandle);
      }
      if (_prof) {
        const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        const rec = { mode:_prof.mode, ms:t1-_prof.t0, rounds:(Number(s.roundsEstimated)||0)-_prof.beforeRounds, kills:(Number(s.kills)||0)-_prof.beforeKills, stopReason:s.stopReason, left:left };
        globalThis.__OFFLINE_COMBAT_PROFILE_LAST = rec;
        if (!Array.isArray(globalThis.__OFFLINE_COMBAT_PROFILE_LOG)) globalThis.__OFFLINE_COMBAT_PROFILE_LOG = [];
        globalThis.__OFFLINE_COMBAT_PROFILE_LOG.push(rec);
        console.warn("[offline-profile]", rec);
      }
      s.endedAt = nowRef.t;
      s.simulatedSeconds = Math.round((nowRef.t - s.startedAt) / 1000);
      if (s.stopReason === null) s.stopReason = "time";
      // M4：段末按虚拟时间推进 NPC 修复（到期才恢复，幂等；时间倒退不提前修复），
      // 并在本段战斗已终止（清波/战败/队列达标，且无连刷待续）时清理小队临时状态。
      if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD) {
        LEGION_COMBAT_SQUAD.tickLegionSquadRepairs(state, nowRef.t);
        const c2 = state.combat;
        if (c2.squad && c2.squad.enabled && !c2.active && !c2.deathspaceChainPending) {
          LEGION_COMBAT_SQUAD.endLegionSquadBattle(state);
        }
      }
      return left;
    },

    // 离线结算结束（applyOfflineGains 内、offline:settlementCompleted 之前）调用一次
    flush: function (state, context) {
      try { if (window.__PERF) window.__PERF.begin("offline:combatFlush"); } catch (_) {}
      context = context || {};
      const runId = context.runId || ("offline_" + (context.now || 0).toString(36));
      const s = _sessions[runId];
      if (!s) { try { if (window.__PERF) window.__PERF.end("offline:combatFlush"); } catch (_) {} return null; }
      _stateRef = state;
      // 若离线前无有效战斗，跳过（不发空事件）
      if (!s.activeAtStart) { delete _sessions[runId]; try { if (window.__PERF) window.__PERF.end("offline:combatFlush"); } catch (_) {} return null; }

      // ---- 资源一次性 apply（每种 resourceId 至多一次）----
      const RR = G("ResourceRegistry");
      // 2026-09-12（离线记账口径修复）：本段是「离线结算临界区」。
      // 期间屏蔽 combat-log 的 fuel/ammo hook（isCombatLogContext 读 __combatLogOfflineFlush），
      // 使离线扣费**只**由 combatLogMergeOffline 依据 payload 记一次 —— 否则燃料会被记两次
      // （hook 一次 + merge 从 resourceNet 反推一次，实测 91000 vs 真实 45500）。
      // try/finally 保证异常时也复位，避免标志泄漏污染后续在线记账。
      const ammoSpent = {};
      const _setOfflineFlush = (v) => { if (typeof globalThis !== "undefined") globalThis.__combatLogOfflineFlush = v; };
      _setOfflineFlush(true);
      try {
        // 弹药/燃料：初始 - 当前虚拟 = 净消耗；弹药净消耗同时存入 payload.ammoSpent
        // （弹药不走 ResourceRegistry，无法从 resourceNet 反推，只能显式带出）。
        for (const type in s.ammoInit) {
          const used = s.ammoInit[type] - (s.ammo[type] || 0);
          if (used > 0) { ammoSpent[type] = used; applyAmmoDelta(state, type, used); }
        }
        const fuelUsed = s.fuelInit - s.fuel;
        if (fuelUsed > 0) { RR.spend(state, "consumable:fuel", fuelUsed); addResource(s, "consumable:fuel", -fuelUsed); }

        // 主动打捞同位素消耗（每击毁扣，开状态才记；flush 一次性 apply，与燃料同机制）
        const isoUsed = (s.isoInit || 0) - (s.iso || 0);
        if (isoUsed > 0) {
          RR.spend(state, "planetary:同位素", isoUsed);
          addResource(s, "planetary:同位素", -isoUsed);
        }
        // 打捞臂燃料消耗已改为 recordKill 内**逐杀**从虚拟燃料池 s.fuel 扣除（与在线 combat.js 同口径：
        // × 战斗燃料倍率 + max(1, round())），此处不再按总击杀数一次性补扣，
        // 否则会漏乘 fuelMult 造成离线油耗虚高（= 在线的 1/fuelMult 倍）。
        // 激光定向打捞单元（MTU）燃料消耗：每击毁一艘扣一次（= Σ fuelPerKill × 战斗燃料倍率），按总击毁数 flush；
        // 仅 active（flush 时燃料充足）才扣，与在线战斗一致。
        const mtuFuelMod = (typeof getMtuModifiers === "function") ? getMtuModifiers(state) : null;
        if (mtuFuelMod && mtuFuelMod.active && mtuFuelMod.fuelPerKill > 0 && (s.kills || 0) > 0) {
          const mtuFuelAmt = Math.max(1, Math.round(mtuFuelMod.fuelPerKill)) * s.kills;
          if (mtuFuelAmt > 0) { RR.spend(state, "consumable:fuel", mtuFuelAmt); addResource(s, "consumable:fuel", -mtuFuelAmt); }
        }

        // ---- 掉落批量（确定性 RNG）----
        applyBatchedDrops(state, s);
      } finally {
        _setOfflineFlush(false);
      }

      // ISK / LP 入账
      if (s.iskDelta) { RR.add(state, "currency:isk", s.iskDelta); addResource(s, "currency:isk", s.iskDelta); }
      if (s.lpDelta) { RR.add(state, "currency:lp", s.lpDelta); addResource(s, "currency:lp", s.lpDelta); }

      // ---- 聚合事件 payload ----
      const payload = {
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        simulatedSeconds: s.simulatedSeconds,
        mode: s.mode,
        roundsEstimated: s.roundsEstimated,
        kills: s.kills,
        killsByFaction: s.killsByFaction,
        killsByZone: s.killsByZone,
        killsByKind: s.killsByKind,
        killsByFactionKind: s.killsByFactionKind,
        wavesByZone: s.wavesByZone,
        zoneClearsByZone: s.zoneClearsByZone,
        deathspaceEntriesById: s.deathspaceEntriesById,
        deathspaceWavesById: s.deathspaceWavesById,
        deathspaceClearsById: s.deathspaceClearsById,
        chainContinuations: s.chainContinuations,
        ticketsConsumed: s.ticketsConsumed,
        defeats: s.defeats,
        repairsCompleted: s.repairsCompleted,
        totalDamageDealt: s.totalDamageDealt,
        totalDamageTaken: s.totalDamageTaken,
        maxSingleHit: s.maxSingleHit,
        noDamageClears: s.noDamageClears,
        maxWaveReached: s.maxWaveReached,
        iskDelta: s.iskDelta,
        lpDelta: s.lpDelta,
        resourceNet: s.resourceNet,
        // 2026-09-12：弹药净消耗按武器类型分账随 payload 带出，供战斗日志记账
        // （弹药无 ResourceRegistry 出口，resourceNet 里没有它，不显式带出则离线恒记 0/0/0）。
        ammoSpent: ammoSpent,
        lootGained: s.lootGained,
        runs: s.runs,
        runsDetail: s.runsDetail,
        firstCrossings: s.firstCrossings,
        stopReason: s.stopReason
      };
      // M6b：影子重放时抑制本次 emit（`_m6bSuppressEmit` 只由 m6bReplay 在自己的同步 flush
      // 调用期间置位 ⇒ 生产路径恒为 false，行为逐字节不变；重放的 payload 仍原样返回供对拍）。
      if (!_m6bSuppressEmit) {
        emitOffline("offline:combatSettled", payload, {
          timestamp: s.endedAt,
          source: "offline-combat",
          runId: runId,
          offline: true
        });
      }
      // gains.combat 累加击杀数（供离线摘要）
      if (context.gains) context.gains.combat = (context.gains.combat || 0) + s.kills;
      delete _sessions[runId];
      try { if (window.__PERF) window.__PERF.end("offline:combatFlush"); } catch (_) {}
      return payload;
    },

    // ---- 虫洞战斗试炼离线预判（2026-09-10，方案 A）----
    // 背景：虫洞出发占用行动槽（currentAction.active=false），离线共享战斗内核冻结
    // （settle 的 actionDrivesCombat 门不通过）→ 战斗试炼只会烧满时限判「超出试炼时限」
    // （必败 + 慢：8 败节点离线 ≈ 9 × 180s）。本接口用与离线结算完全同口径的 simulateWave
    // 对试炼开战时固化的敌编队（combat.enemies）做单场预判，供虫洞系统把试炼时长定为
    // 真实战斗时长、到点按预判结算。只在深克隆上运行（RNG 流/经验/掉落/资源全部隔离），
    // 绝不污染真实 state。返回 { win, seconds, rounds, kills }；win=false 含战败与超时限。
    predictTrialWave: function (state, opts) {
      const predRunId = "whpred_" + (++_predSeq).toString(36);
      opts = opts || {};
      try {
        const c = state && state.combat;
        if (!c || !c.active) return null;
        const zoneFn = G("getCombatEncounterZone");
        const zone = (typeof zoneFn === "function") ? zoneFn(c) : null;
        if (!zone || !Array.isArray(c.enemies) || c.enemies.length === 0) return null;
        const maxSeconds = Math.max(1, Number(opts.maxSeconds) || 180);
        // 深克隆：state 为纯数据（云存档上传同口径 JSON 序列化已验证安全）
        const snapshot = JSON.parse(JSON.stringify(state));
        const cc = snapshot.combat;
        if (!cc || !cc.active) return null;
        const cloneZone = (typeof zoneFn === "function") ? zoneFn(cc) : zone;
        // 敌编队映射（与 simulateBelt 的波次映射逐字同口径；_rewarded 复位）
        const enemies = (cc.enemies || []).map(e => ({
          id: e.id, type: e.type, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
          dodge: e.dodge, baseDamage: e.baseDamage, auraDamage: e.auraDamage || 0, kind: e.kind,
          bossHealPct: e.bossHealPct || 0, bossHealEvery: e.bossHealEvery || 5, enrageMul: e.enrageMul || 0, enrageAt: e.enrageAt || 0.3,
          maxHp: e.maxHp ? { shield: e.maxHp.shield, armor: e.maxHp.armor, structure: e.maxHp.structure } : null, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
          level: e.level,
          deathspaceLeader: false, deathspaceWave: 0, _rewarded: false
        }));
        if (!enemies.length) return null;
        const prevRef = _stateRef;
        _stateRef = snapshot;
        const s = ensureSession(predRunId);
        const startT = (Number(opts.now) || Date.now());
        s.startedAt = startT;
        s.endedAtRef = { t: startT };
        ensureVirtualAmmoFuel(snapshot, s);
        const res = simulateWave(snapshot, enemies, cloneZone, false, null, s, s.endedAtRef);
        delete _sessions[predRunId];
        _stateRef = prevRef;
        const seconds = Math.max(1, Math.round((Number(res.rounds) || 0) * ROUND_SECONDS));
        const allDead = enemies.every(e => e && e.hp && e.hp.structure <= 0);
        // 与在线试炼同口径：清完全部试炼敌人即成功；simulateWave 的轮数上限「伪 cleared」
        //（仍有存活敌）或超出时限（seconds > maxSeconds）一律按失败（与在线烧满时限判负一致）
        const win = res.outcome === "cleared" && allDead && seconds <= maxSeconds;
        return { win: win, seconds: Math.min(seconds, maxSeconds), rounds: Number(res.rounds) || 0, kills: (res.kills || []).length };
      } catch (e) {
        try { delete _sessions[predRunId]; } catch (_) {}
        return null;
      }
    },

    // ---- M0 快通道诊断（只读；**不进入 flush payload**）----
    // 用途：量出「守卫初判通过率」与「逐轮/跳过轮数」；
    // 开关 globalThis.__OFFLINE_COMBAT_FASTPATH 默认关闭，开启也不改变行为。
    fastpathStats: FP_STATS,
    fastpathReset: function () {
      FP_STATS.enabled = fpEnabled();
      FP_STATS.waves = 0; FP_STATS.waveAccepted = 0; FP_STATS.waveRejected = {};
      FP_STATS.roundRuns = 0; FP_STATS.roundSkipped = 0; FP_STATS.guardEvalMs = 0;
      FP_STATS.kernelWaves = 0; FP_STATS.kernelRejected = {}; FP_STATS.kernelReadyMs = 0;
      _fpTrace = null;
      return FP_STATS;
    },
    // M3 验收专用逐轮指纹轨迹：仅在 globalThis.__OFFLINE_COMBAT_FASTPATH_TRACE 置位时有内容，
    // 否则恒为空数组（生产路径 set 都不会设它 ⇒ 零成本、零暴露）。
    fastpathTrace: function () { return _fpTrace || []; },
    // 诊断专用只读会话访问器（Q5/V1 逐字节对拍需要直接观察 dropAccum 等会话内部）。
    // 门禁：仅在快通道开关开启时可用 ⇒ 生产路径（开关默认关闭）永远拿不到会话对象，
    //       不可能被业务代码依赖。返回的是会话**引用**，仅供仓外探针读取/构造对照实验。
    fastpathSession: function (runId) {
      if (!fpEnabled()) return null;
      return _sessions[runId] || null;
    },

    // ---- M6a 事件账本（2026-09-19，§11.6）----
    // 只读访问器：**开关关闭时恒返回空数组** ⇒ 生产路径（默认关闭）永远拿不到账本内容，
    // 业务代码不可能依赖它。开启时返回的是账本**引用**，仅供仓外探针读取/比对。
    // ⚠️ 账本与 M6A_STATS **一律不进入 flush payload**（同 FP_STATS 的零侵入纪律）。
    m6aLedger: function () { return m6aEnabled() ? M6A_LEDGER : []; },
    m6aStats: M6A_STATS,
    m6aReset: function () {
      M6A_STATS.enabled = m6aEnabled();
      M6A_LEDGER.length = 0;
      _m6aSeq = 0; _m6aNowRef = null;
      M6A_STATS.entries = 0; M6A_STATS.killEntries = 0; M6A_STATS.resSeen = 0; M6A_STATS.killsSeen = 0;
      M6A_STATS.sessEntries = 0;
      M6A_STATS.byKind = {}; M6A_STATS.byFaction = {}; M6A_STATS.byZone = {};
      M6A_STATS.byRes = {}; M6A_STATS.resAmount = {};
      M6A_STATS.orderedZs = 0; M6A_STATS.orderedLeader = 0;
      M6A_STATS.truncated = false; M6A_STATS.errors = 0;
      return M6A_STATS;
    },

    // ---- M6b 影子重放（2026-09-19，§11.9）----
    // 契约（用户硬约束「replay 不得依赖 flush 后才可见的临时状态」）：
    //   输入**只有** `(baselineState, ledger, opts)`：
    //     · baselineState = settle **之前**的档（内部深克隆，绝不写真实 state）；
    //     · ledger        = M6a 账本快照（逐条 ev:kill / res / sess）；
    //     · opts.rngState = **pre-flush** 可见量（settle 结束、flush 之前的 combat.randomState）。
    //   过程：重建会话账目 → **flush 前快照 session** → 调**生产 flush**（同一 applyBatchedDrops）。
    //   返回 `{ session, payload, state, applied }`；session 是 flush 前的快照，
    //   因此对它的比较**不含**任何 flush 副作用（这正是用户要求的口径）。
    //   ⚠️ 生产结算路径**零调用**本函数；它在重放期间的同步 flush 内抑制 emit（`_m6bSuppressEmit`）。
    m6bReplay: function (baselineState, ledger, opts) {
      if (!m6bEnabled()) return null;
      opts = opts || {};
      M6B_STATS.enabled = true;
      M6B_STATS.replays++;
      try {
        const clone = JSON.parse(JSON.stringify(baselineState));
        if (opts.rngState != null && clone && clone.combat) {
          clone.combat.randomState = JSON.parse(JSON.stringify(opts.rngState));
        }
        const rid = "m6b_" + (++_m6bSeq).toString(36);
        const s = ensureSession(rid);
        ensureVirtualAmmoFuel(clone, s);
        s.activeAtStart = true;
        if (opts.startedAt != null) s.startedAt = opts.startedAt;
        if (opts.endedAt != null) s.endedAt = opts.endedAt;
        s.endedAtRef = { t: (opts.endedAt != null ? opts.endedAt : (opts.now || 0)) };
        const prevRef = _stateRef;
        _stateRef = clone;
        let applied = 0;
        for (const e of (ledger || [])) {
          if (!e || typeof e !== "object") continue;
          if (e.ev === "kill") { m6bApplyKill(clone, s, e); M6B_STATS.appliedKill++; }
          else if (e.ev === "res") { m6bApplyRes(s, e); M6B_STATS.appliedRes++; }
          else if (e.ev === "sess") { m6bApplySess(s, e); M6B_STATS.appliedSess++; }
          else bump(M6B_STATS.skippedUnknownEv, String(e.ev), 1);
          applied++;
        }
        const session = JSON.parse(JSON.stringify(s));   // ⭐ flush **之前**的快照
        let payload = null;
        _m6bSuppressEmit = true;
        try {
          payload = OfflineCombatSystem.flush(clone, {
            runId: rid, gains: {}, now: opts.now, offlineEnd: opts.offlineEnd
          });
        } finally { _m6bSuppressEmit = false; }
        _stateRef = prevRef;
        M6B_STATS.lastApplied = applied;
        return { session: session, payload: payload, state: clone, applied: applied };
      } catch (err) {
        M6B_STATS.errors++;
        M6B_STATS.lastError = String((err && err.message) || err);
        return { error: M6B_STATS.lastError };
      }
    },
    m6bStats: M6B_STATS,
    m6bReset: function () {
      M6B_STATS.enabled = m6bEnabled();
      M6B_STATS.replays = 0; M6B_STATS.appliedKill = 0; M6B_STATS.appliedRes = 0;
      M6B_STATS.appliedSess = 0; M6B_STATS.skippedUnknownEv = {};
      M6B_STATS.errors = 0; M6B_STATS.lastError = null;
      return M6B_STATS;
    },

    // ---- M6c 声望波级批量（2026-09-19，§11.10）----
    // ⚠️ 与 M6a / M6b / 快通道**零交集**；生产路径默认关闭（mode 0 ⇒ 逐字转发原函数）。
    //    `shadow` 模式只做对拍、不改任何写入；`batch` 模式才真正折叠。
    m6cMode: m6cMode,
    m6cStats: M6C_STATS,
    m6cReset: function () {
      M6C_STATS.enabled = (m6cMode() !== 0);
      M6C_STATS.mode = m6cMode();
      M6C_STATS.batches = 0; M6C_STATS.wavesWithKills = 0;
      M6C_STATS.killsCollected = 0; M6C_STATS.foldedCalls = 0; M6C_STATS.saves = 0;
      M6C_STATS.shadowWaves = 0; M6C_STATS.mismatch = 0; M6C_STATS.lastMismatch = null;
      M6C_STATS.unmapped = 0;
      M6C_STATS.byClass = {}; M6C_STATS.byFaction = {};
      M6C_STATS.errors = 0; M6C_STATS.lastError = null;
      _repBatch.active = false; _repBatch.mode = 0; _repBatch.multi = {}; _repBatch.kills = 0; _repBatch.before = {};
      return M6C_STATS;
    },

    // ---- M4-1 L1b「稳态 O(1) 跳轮」守卫**命中率度量**（2026-09-19，§11.11）----
    // 只读访问器：`m4Stats` 返回统计**引用**，仅供仓外验收探针读取（生产路径零调用）。
    // ⚠️ 与 M6a / M6b / M6c / 快通道**零交集**；不进入任何 flush payload（同 FP_STATS / M6*_STATS 纪律）。
    m4Stats: M4_STATS,
    m4Reset: function () {
      M4_STATS.enabled = m4Enabled();
      M4_STATS.waves = 0; M4_STATS.rounds = 0; M4_STATS.pairs = 0; M4_STATS.drift = {};
      M4_STATS.ledgers = 0; M4_STATS.skippableRounds = 0;
      M4_STATS.ledgersPlayer = 0; M4_STATS.skippableRoundsPlayer = 0;
      M4_STATS.ledgersDelta = 0; M4_STATS.skippableRoundsDelta = 0;
      M4_STATS.sigRepeatWaves = 0; M4_STATS.sigFirstWaves = 0;
      M4_STATS.maxStableRun = 0; M4_STATS.maxStableRunPlayer = 0; M4_STATS.maxStableRunDelta = 0;
      M4_STATS.runHistFull = {}; M4_STATS.runHistPlayer = {}; M4_STATS.runHistDelta = {};
      M4_STATS.reject = {}; M4_STATS.rejectPlayer = {}; M4_STATS.rejectDelta = {};
      M4_STATS.byKind = {}; M4_STATS.squadOnWaves = 0; M4_STATS.orphanRounds = 0; M4_STATS.errors = 0;
      _m4W = null; _m4PrevSig = -1;
      return M4_STATS;
    },

    // ---- 离线仿真装备只读缓存（性能优化·2026-09-20）----
    // 只读访问器：`perfCacheStats` 返回统计**引用**，仅供仓外验收探针读取（生产路径零调用）。
    // ⚠️ 不进入任何 flush payload（同 FP_STATS / M6*_STATS / M4_STATS 纪律）。
    perfCacheStats: PERF_CACHE_STATS,
    perfCacheReset: function () {
      PERF_CACHE_STATS.refHit = 0; PERF_CACHE_STATS.refMiss = 0;
      PERF_CACHE_STATS.modHit = 0; PERF_CACHE_STATS.modMiss = 0; PERF_CACHE_STATS.wraps = 0;
      return PERF_CACHE_STATS;
    },

  };

  // ---- 掉落批量（确定性 RNG；不逐敌 Math.random；不超过实际击杀上限）----
  function batchCount(n, p, rng) {
    if (!(n > 0) || !(p > 0)) return 0;
    const expected = n * p;
    const base = Math.floor(expected);
    const frac = expected - base;
    return base + (rng() < frac ? 1 : 0);
  }
  function applyBatchedDrops(state, s) {
    const RR = G("ResourceRegistry");
    const c = state.combat;
    const rng = detRng(c);
    const da = s.dropAccum;
    // ⚠️ 离线打捞时序修复（2026-09-17）：优先用战斗进行中捕获的快照 s.salvageSquadTotal
    // （members 满、含 NPC+MTU 贡献），避免 flush 时 members 已被 endLegionSquadBattle 清空导致 npc 漏算。
    // 无快照时回退实时 getSquadSalvageEfficiency（兜底，兼容旧档 / 非战斗态）。
    const squadSalvageEff = (typeof s.salvageSquadTotal === "number") ? s.salvageSquadTotal
      : ((typeof getSquadSalvageEfficiency === "function") ? getSquadSalvageEfficiency(state) : 0);
    // ---- M6a：会话级账目点（M6b 补记；**任何 flush 副作用之前**，纯读 + push）----
    // 位置必须在 squadSalvageEff 之后：要连「无快照 ⇒ 回退实时求值」这条路径的实际取值一起记下来。
    if (m6aEnabled()) m6aRecordSess(state, s, { live: squadSalvageEff });
    // 军团 NPC 稀有掉落加成（与在线 roll* 系列同一倍率，只放大精英/Boss 稀有掉落）：
    // 离线结算同样生效，在线/离线口径一致。概率封顶 1 —— 在线每击毁 1 敌最多掉 1 份，
    // 离线批量重滚不得算出多于击杀数的份数（倍率 > 1 时 batchCount 会溢出）。
    const legionDropFn = G("getLegionCombatDropMult");
    const legionMult = (typeof legionDropFn === "function") ? legionDropFn(state) : 1;
    const legionChance = p => Math.min((Number(p) || 0) * legionMult, 1);
    // 1) 势力加密数据
    for (const zoneId in da.factionData) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const cfg = G("getEncryptedDataDropConfig")(zone);
      if (!cfg) continue;
      const fd = da.factionData[zoneId];
      if (fd.elite) { const n = batchCount(fd.elite, legionChance(cfg.eliteChance), rng); if (n > 0) { RR.add(state, "special:" + cfg.material, cfg.qty * n); addResource(s, "special:" + cfg.material, cfg.qty * n); } }
      if (fd.boss) { const n = batchCount(fd.boss, legionChance(cfg.bossChance), rng); if (n > 0) { RR.add(state, "special:" + cfg.material, cfg.qty * n); addResource(s, "special:" + cfg.material, cfg.qty * n); } }
    }
    // 1.5) 装备专用料（Tier2，zone-bound；死亡空间不计入，复用 elite/boss 计数）
    for (const zoneId in da.factionData) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const gearConfigs = G("getGearDropConfigs")(zone);
      if (!gearConfigs.length) continue;
      const fd = da.factionData[zoneId];
      for (const cfg of gearConfigs) {
        if (fd.elite) { const n = batchCount(fd.elite, legionChance(cfg.eliteChance), rng); if (n > 0) { RR.add(state, cfg.resourceId, cfg.qty * n); addResource(s, cfg.resourceId, cfg.qty * n); } }
        if (fd.boss) { const n = batchCount(fd.boss, legionChance(cfg.bossChance), rng); if (n > 0) { RR.add(state, cfg.resourceId, cfg.qty * n); addResource(s, cfg.resourceId, cfg.qty * n); } }
      }
    }
    // 1.6) 空间站四核心（Tier3，唯一产出；死亡空间不计入，复用 elite/boss 计数）
    // 隐藏保底：与在线同口径，出率随星带肃清次数爬升，PITY_MAX 次肃清时必出
    const obtainedCores = state.stationCoresObtained = state.stationCoresObtained || {};
    const _pityFn = (typeof G === "function") ? G("getStationCorePityChance") : null;
    for (const zoneId in da.stationCore) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const coreConfigs = G("getStationCoreDropConfigs")(zone);
      if (!coreConfigs.length) continue;
      const cc = da.stationCore[zoneId];
      for (const cfg of coreConfigs) {
        // 双判断：obtained 标记为真但实物库存为 0（历史死锁）时也允许继续掉落，防止永久锁死
        const held = (typeof ResourceRegistry !== "undefined" && ResourceRegistry.get)
          ? (ResourceRegistry.get(state, cfg.resourceId) || 0) : 0;
        if (obtainedCores[cfg.coreId] && held >= 1) continue;
        const pElite = _pityFn ? _pityFn(zone, legionChance(cfg.eliteChance), state) : legionChance(cfg.eliteChance);
        const pBoss = _pityFn ? _pityFn(zone, legionChance(cfg.bossChance), state) : legionChance(cfg.bossChance);
        const n = (cc.elite ? batchCount(cc.elite, pElite, rng) : 0) + (cc.boss ? batchCount(cc.boss, pBoss, rng) : 0);
        if (n > 0) { RR.add(state, cfg.resourceId, cfg.qty); addResource(s, cfg.resourceId, cfg.qty); obtainedCores[cfg.coreId] = true; break; }
      }
    }
    // 1.7) 货柜（按船级+kind 计数，flush 时确定性重滚）
    for (const zoneId in da.cargo) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const cz = da.cargo[zoneId];
      for (const cls in cz) {
        const spec = (typeof CARGO_CLASS_SIZES !== "undefined" && CARGO_CLASS_SIZES[cls]) || null;
        if (!spec) continue;
        const kindCounts = cz[cls];
        for (const kind of ["normal", "elite", "boss"]) {
          const n = kindCounts[kind] || 0;
          if (!n) continue;
          // 同位素标记打捞臂：被动提升货柜掉率（与在线 rollCargoDrop 同公式 min(base*(1+b),0.5)）
          const salvageBonus = squadSalvageEff;
          const baseChance = (typeof CARGO_DROP_CHANCE !== "undefined" && CARGO_DROP_CHANCE[kind]) || 0;
          const chance = Math.min(baseChance * (1 + salvageBonus), 0.5);
          const drops = batchCount(n, chance, rng);
          for (let d = 0; d < drops; d++) {
            const size = cargoWeightedPick(spec.sizes.map((sz, i) => ({ id: sz, weight: spec.weights[i] })), rng).id;
            const itemId = cargoItemId(size);
            RR.add(state, itemId, 1);
            addResource(s, itemId, 1);
          }
        }
      }
    }
    // 1.75) 死亡空间势力考古探针本体（小怪 / 首领各自概率，确定性重滚）
    for (const siteId in da.probe) {
      const pv = da.probe[siteId];
      if (!pv) continue;
      const n = (pv.normal ? batchCount(pv.normal, legionChance(pv.normalChance), rng) : 0)
              + (pv.boss ? batchCount(pv.boss, legionChance(pv.bossChance), rng) : 0);
      if (n > 0) { RR.add(state, pv.resourceId, pv.qty * n); addResource(s, pv.resourceId, pv.qty * n); }
    }
    // 1.8) 同位素标记打捞臂：主动打捞舰船组件（按敌舰等级档位，确定性重滚；同位素消耗已在 recordKill 按会话虚拟余额门控）
    const salvageBonus2 = squadSalvageEff;
    const sb = s.salvageByTier;
    if (sb) {
      for (const tier in sb) {
        const ids = (typeof SALVAGE_COMPONENT_IDS !== "undefined" && SALVAGE_COMPONENT_IDS[tier]) || null;
        if (!ids) continue;
        const tk = sb[tier];
        for (const kind of ["normal", "elite", "boss"]) {
          const n = tk[kind] || 0;
          if (!n) continue;
          const baseChance = (typeof CARGO_DROP_CHANCE !== "undefined" && CARGO_DROP_CHANCE[kind]) || 0;
          const chance = Math.min(baseChance * (1 + salvageBonus2), 0.5);
          const drops = batchCount(n, chance, rng);
          const qty = (typeof getSalvageComponentQty === "function") ? getSalvageComponentQty(kind) : 1;
          for (let d = 0; d < drops; d++) {
            const compId = ids[Math.floor(rng() * ids.length)];
            RR.add(state, "component:" + compId, qty);
            addResource(s, "component:" + compId, qty);
          }
        }
      }
    }
    // 1.82) 激光定向打捞单元（MTU）独立产出舰船组件（确定性重滚；不消耗同位素；flush 时仍按快照 squadSalvageEff 含 MTU 2.10 放大）
    const mb = s.mtuSalvageByTier;
    if (mb) {
      const mtuSalvageBonus = squadSalvageEff;
      for (const tier in mb) {
        const ids = (typeof SALVAGE_COMPONENT_IDS !== "undefined" && SALVAGE_COMPONENT_IDS[tier]) || null;
        if (!ids) continue;
        const tk = mb[tier];
        for (const kind of ["normal", "elite", "boss"]) {
          const n = tk[kind] || 0;
          if (!n) continue;
          const baseChance = (typeof CARGO_DROP_CHANCE !== "undefined" && CARGO_DROP_CHANCE[kind]) || 0;
          const chance = Math.min(baseChance * (1 + mtuSalvageBonus), 0.5);
          const drops = batchCount(n, chance, rng);
          const qty = (typeof getSalvageComponentQty === "function") ? getSalvageComponentQty(kind) : 1;
          for (let d = 0; d < drops; d++) {
            const compId = ids[Math.floor(rng() * ids.length)];
            RR.add(state, "component:" + compId, qty);
            addResource(s, "component:" + compId, qty);
          }
        }
      }
    }
    // 2) 区域特殊掉落
    for (const zoneId in da.zoneSpecial) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const configs = G("getCombatZoneSpecialDropConfigs")(zone);
      const entries = da.zoneSpecial[zoneId];
      // 按 config 聚合每种 material 的精英/Boss 击杀数
      // 2026-09-08 修复：聚合键由 resourceId 改为 resourceId|kind 分桶。
      // 原 bug：chance 只取每种 material 第一条入选记录的——若先来的是精英（5%），
      // 后续 boss（100% 必掉）整批也按 5% 重滚，离线 boss 特殊掉落被大量吞掉
      // （波及暗质晶核 / 深层舰船数据等 bossChance=1.0 的区域特殊掉落）。
      // 现与 factionData/ticket 的 elite/boss 分桶口径一致。
      const byRes = {};
      for (const e of entries) {
        const cfg = configs.find(cc => cc.resourceId === e.resourceId);
        if (!cfg) continue;
        const chance = e.kind === "boss" ? legionChance(cfg.bossChance) : (e.kind === "elite" ? legionChance(cfg.eliteChance) : 0);
        if (!chance) continue;
        const key = e.resourceId + "|" + e.kind;
        byRes[key] = byRes[key] || { resourceId: e.resourceId, qty: cfg.qty, n: 0, chance };
        byRes[key].n++;
      }
      for (const key in byRes) {
        const b = byRes[key];
        const n = batchCount(b.n, b.chance, rng);
        if (n > 0) { RR.add(state, b.resourceId, b.qty * n); addResource(s, b.resourceId, b.qty * n); }
      }
    }
    // 3) 通行密钥
    for (const zoneId in da.ticket) {
      const zone = COMBAT_ZONES.find(z => z.id === zoneId);
      if (!zone) continue;
      const tk = da.ticket[zoneId];
      const tcfgs = typeof G("getDeathspaceTicketDropConfigs") === "function"
        ? G("getDeathspaceTicketDropConfigs")(zone)
        : (G("getDeathspaceTicketDropConfig")(zone) ? [G("getDeathspaceTicketDropConfig")(zone)] : []);
      for (const tcfg of tcfgs) {
        if (tk.elite) { const n = batchCount(tk.elite, tcfg.eliteChance, rng); if (n > 0) { RR.add(state, "special:" + tcfg.material, n); addResource(s, "special:" + tcfg.material, n); } }
        if (tk.boss) { const n = batchCount(tk.boss, tcfg.bossChance, rng); if (n > 0) { RR.add(state, "special:" + tcfg.material, n); addResource(s, "special:" + tcfg.material, n); } }
      }
    }
    // 4) 死亡空间首领战利品
    const dsCovered = {};
    for (const siteId in da.leader) {
      const site = G("getDeathspaceById")(siteId);
      if (!site) continue;
      const cfgs = G("getDeathspaceLeaderLootConfigs")(site);
      for (const entry of da.leader[siteId]) {
        const wc = cfgs[Math.max(0, entry.wave - 1)];
        if (!wc) continue;
        if (entry.core) { const n = batchCount(1, wc.coreChance, rng); if (n > 0) { RR.add(state, "special:" + site.coreMaterial, n); addResource(s, "special:" + site.coreMaterial, n); } }
        if (entry.proto && wc.isFinal) { const n = batchCount(1, wc.protocolChance, rng); if (n > 0) { RR.add(state, "special:" + site.protocolMaterial, n); addResource(s, "special:" + site.protocolMaterial, n); } }
      }
      dsCovered[siteId] = true;
    }
    // 5) 战术材料（按 kind 期望数量一次抽取）
    const tc = da.tactical;
    if (tc.normal + tc.elite + tc.boss > 0) {
      const zone = s._tacticalZone || (state.combat.mode === "deathspace" ? G("getDeathspaceById")(state.combat.deathspaceId) : null);
      const anyZone = (s.killsByZone && Object.keys(s.killsByZone)[0]) ? COMBAT_ZONES.find(z => z.id === Object.keys(s.killsByZone)[0]) : null;
      const tzc = anyZone ? G("getTacticalMaterialDropConfig")(anyZone) : null;
      if (tzc) {
        // 期望数量：普通 0.7×1，精英 2.5，Boss 8（与 rollTacticalMaterialDrop 同口径）
        let expectedQty = tc.normal * 0.7 * 1 + tc.elite * 1 * 2.5 + tc.boss * 1 * 8;
        const base = Math.floor(expectedQty);
        const frac = expectedQty - base;
        const n = base + (rng() < frac ? 1 : 0);
        if (n > 0) { RR.add(state, "special:" + tzc.materialId, n); addResource(s, "special:" + tzc.materialId, n); }
      }
    }
  }

  // 导出
  if (typeof globalThis !== "undefined") globalThis.OfflineCombatSystem = OfflineCombatSystem;
  if (typeof window !== "undefined") window.OfflineCombatSystem = OfflineCombatSystem;
  if (typeof module !== "undefined" && module.exports) module.exports = OfflineCombatSystem;
})();
