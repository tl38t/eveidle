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
  function grantXp(state, skillId, amount) {
    const fn = G("addStationModifiedCombatXp");
    if (typeof fn === "function" && amount) fn(state, skillId, amount, "combat");
  }

  // ---- 单波等效模拟（期望伤害，不重放 RNG）----
  // enemies: 本波敌人数组（结构 {hp:{shield,armor,structure}, hit, dodge, baseDamage, kind, iskDrop, xpDrop, deathspaceLeader?, deathspaceWave?, id}）—— hit 必填，敌方反击 calcCombatDamage(attacker.hit,...) 依赖它
  // 返回 {outcome:'cleared'|'defeated', rounds, kills:[]}
  function simulateWave(state, enemies, zone, isDeathspace, site, s, nowRef) {
    const inputs = readInputs(state, nowRef);
    const c = state.combat;
    const expectedRng = expectedCombatRng(state);
    const actualRng = actualCombatRng(state);
    c.maxHp = inputs.maxHp;
    // 钳制当前 HP 不超 maxHp
    if (c.hp.shield > c.maxHp.shield) c.hp.shield = c.maxHp.shield;
    if (c.hp.armor > c.maxHp.armor) c.hp.armor = c.maxHp.armor;
    if (c.hp.structure > c.maxHp.structure) c.hp.structure = c.maxHp.structure;

    const living = () => enemies.filter(e => e && e.hp && e.hp.structure > 0);
    let current = living()[0] || null;
    let rounds = 0;
    const kills = [];

    while (true) {
      if (rounds >= MAX_WAVE_ROUNDS) { return { outcome: "cleared", rounds, kills }; }
      // 与在线 advanceCombatRound 同口径：刷新/切页后若战斗舰已是 0 结构，
      // 不能再让离线模拟先执行一轮玩家/NPC 开火，再把敌方血量继续扣掉。
      if (c.hp && Number(c.hp.structure) <= 0) {
        return { outcome: "defeated", rounds, kills };
      }
      const dcReduction = computeDcReduction(state, zone, s);
      // D2=A（2026-09-11 用户拍板）：泰坦主武器（舰体自带）与 tt_high 释放高槽的常规副武器分账结算——
      // 两条 gate 独立求值（副武器 gate 先算，主武器最后落定 s.ammoTier），任一开火即视为本轮开火；
      // 副武器缺油缺弹只哑火自己，不影响主武器。常规舰下 convFire === 原单 gate，行为等价。
      const convFire = canFireVirtual(inputs, zone, s, state);
      const titanMainFire = inputs.isTitan ? canFireTitanVirtual(state, inputs, zone, s) : false;
      const fire = inputs.isTitan ? (titanMainFire || convFire) : convFire;
      if (fire) {
        let roundDealt = 0;
        if (inputs.isTitan && titanMainFire) {
          // 泰坦管线：主武器单发 + 四类附带打击（期望值口径）
          roundDealt = fireTitanVolleyVirtual(state, inputs, current, enemies, zone, s, rounds + 1, expectedRng);
        }
        if (convFire) {
          for (const m of inputs.weapons) {
            const cb = m.equipment.combat;
            const weapon = WEAPON_CONFIG[cb.weaponType];
            if (!weapon) continue;
            if (!current) break;
            const ammoProps = getAmmoTierProps(s.ammoTier[cb.weaponType] || "T1");
            const playerHit = G("calcPlayerHit")(cb.weaponType, m.equipment, state) * ammoProps.hitMult;
            const dmgMult = G("calcPlayerDmgMult")(cb.weaponType, state);
            let counterMult = 1.0;
            if (weapon.counterType === "shield" && current.hp.shield > 0) counterMult = 1.25;
            else if (weapon.counterType === "armor" && current.hp.shield <= 0 && current.hp.armor > 0) counterMult = 1.25;
            else if (weapon.counterType === "structure" && current.hp.shield <= 0 && current.hp.armor <= 0 && current.hp.structure > 0) counterMult = 1.25;
            const traitMult = G("getCapitalWeaponTraitMultiplier")(inputs.ship, cb.weaponType, c.hp, c.maxHp);
            const wbm = (inputs.boosterDmg && inputs.boosterDmg[cb.weaponType]) ? inputs.boosterDmg[cb.weaponType] : 1;
            // 2026-09-12：联盟加成并入乘区（与在线 combat.js:1524-1526 逐项同构）。
            const adm = inputs.allianceDamageMult || 1;
            let dmg = G("calcCombatDamage")(playerHit, current.dodge, cb.baseDamage * (m.multiplier || 1) * wbm, counterMult * dmgMult * traitMult * ammoProps.dmgMult * adm, expectedRng);
            // 脑突触加速剂独立乘区（与在线 combat.js 同步）
            const adbm = inputs.adBuffMult || 1;
            if (adbm && adbm !== 1) dmg = Math.round(dmg * adbm);
            const dealt = G("applyLayeredCombatDamage")(current.hp, dmg);
            const total = dealt.shield + dealt.armor + dealt.structure;
            roundDealt += total;
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
          const volleyFuel = consumeVolleyVirtual(inputs, zone, s);
          grantXp(state, "capacitorManagement", volleyFuel * 0.3);
        }
      }
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
            shieldHitsUsed: shieldHitsUsed, dcReduction: dcReduction
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
      // 泰坦挂钩维修（与在线 combat.js 泰坦段同口径）：基础量 × calcRepairMult 通用乘区。
      // calcRepairMult 已含舰体 bonuses[armorRepair/structureRepair] 与紧急维修(<70% 结构 +100%)，不重复应用。
      if (inputs.isTitan && inputs.titanTrait) {
        const titanRepairRatio = c.maxHp.structure > 0 ? c.hp.structure / c.maxHp.structure : 1;
        if (inputs.titanTrait.id === "titan_deflection_shield" && titanDeflectionTriggers > 0 && c.hp.shield < c.maxHp.shield) {
          const base = G("getTitanSteadyRechargeRepair")(inputs.titanTrait, titanDeflectionTriggers, c.maxHp.shield);
          const restored = Math.min(base * G("calcRepairMult")("shield", state, titanRepairRatio), c.maxHp.shield - c.hp.shield);
          if (restored > 0) c.hp.shield += restored;
        }
        if (inputs.titanTrait.id === "titan_reactive_armor" && armorDamageTaken > 0 && c.hp.armor < c.maxHp.armor) {
          // 应激 min 内不含乘区（consumesRepairMultiplier）：基础 min 先算，乘区在 min 之后显式应用
          const base = G("getTitanReactiveArmorRepair")(inputs.titanTrait, armorDamageTaken, c.maxHp.armor);
          const restored = Math.min(base * G("calcRepairMult")("armor", state, titanRepairRatio), c.maxHp.armor - c.hp.armor);
          if (restored > 0) c.hp.armor += restored;
        }
        if (inputs.titanTrait.id === "titan_structure_overdrive" && structureDamageTaken > 0 && c.hp.structure < c.maxHp.structure) {
          const layers = Math.min(inputs.titanTrait.maxLayers, Math.floor(((1 - titanRepairRatio) + 1e-9) / (inputs.titanTrait.thresholdPct || 0.10)));
          const base = G("getTitanOverdriveSealRepair")(inputs.titanTrait, structureDamageTaken, layers);
          const restored = Math.min(base * G("calcRepairMult")("structure", state, titanRepairRatio), c.maxHp.structure - c.hp.structure);
          if (restored > 0) c.hp.structure += restored;
        }
      }
      // 维修（仅读真实维修装备；满血层不扣维修燃料，与在线一致）
      const boosterRep = inputs.boosterRep;
      for (const m of inputs.repairers) {
        const cb = m.equipment.combat;
        const repFuel = Math.max(1, Math.round((cb.fuelCost || 1) * G("calcFuelMult")(zone, state)));
        if (s.fuel < repFuel) continue;
        if (c.hp[cb.target] < c.maxHp[cb.target]) {
          const repMult = (boosterRep && boosterRep[cb.target]) ? boosterRep[cb.target] : 1;
          const heal = Math.round(cb.amount * (m.multiplier || 1) * G("calcRepairMult")(cb.target, state, c.hp.structure / c.maxHp.structure) * repMult);
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
        return { outcome: "cleared", rounds: rounds + 1, kills };
      }
      // 推进回合与虚拟时间
      rounds++;
      nowRef.t += ROUND_SECONDS * 1000;
      advanceBoosterTime(state, ROUND_SECONDS * 1000, nowRef.t);
      // 重新读取（技能可能升级、HP 变化、增强剂/ad-buff 时间推进）
      const ni = readInputs(state, nowRef);
      inputs.maxHp = ni.maxHp; inputs.playerDodge = ni.playerDodge;
      inputs.boosterDmg = ni.boosterDmg; inputs.boosterRep = ni.boosterRep;
      inputs.adBuffMult = ni.adBuffMult;
      current = living()[0] || null;
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

  // ---- 记录击杀（掉落累计 + 计数）----
  function recordKill(state, s, enemy, zone, isDeathspace, site) {
    s.kills++;
    // 打捞臂燃料消耗（装备即生效，每击毁一艘扣基准燃料；开主动×3）：
    // 与在线 combat.js（击杀处理末尾）**逐杀**同口径 —— 乘战斗燃料倍率 fuelMult 并 max(1, round())，
    // 且从会话虚拟燃料池 s.fuel 逐杀扣除（而非 flush 按总击杀数一次性扣），
    // 使「击杀瞬间扣油 → 影响后续能否开火」的语义与在线一致。
    // ⚠️ 修复前：flush 里按 s.kills 总额扣且**漏乘 fuelMult**（还未 round）⇒ 高电容管理技能下
    //    离线打捞臂油耗 = 在线的 1/fuelMult 倍（玩家实测报 3 倍，对应 fuelMult≈0.333）。
    // 余额不足时不扣，与 ResourceRegistry.spend 的「不足则返回 false 不扣」语义一致。
    const _salvageFuelPKFn = G("getSquadSalvageFuelPerKill");
    const salvageFuelPK = (typeof _salvageFuelPKFn === "function") ? _salvageFuelPKFn(state) : 0;
    if (salvageFuelPK > 0) {
      const salvageBase = (state.combat && state.combat.salvageArmActive) ? salvageFuelPK * 3 : salvageFuelPK;
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
      const pcfg = G("getDeathspaceProbeDropConfig")(site);
      if (pcfg) {
        const pv = (da.probe[site.id] = da.probe[site.id] || {
          resourceId: pcfg.resourceId, qty: pcfg.qty,
          normalChance: pcfg.normalChance, bossChance: pcfg.bossChance, normal: 0, boss: 0
        });
        pv[enemy.deathspaceLeader ? "boss" : "normal"]++;
      }
    } else if (zone) {
      if (enemy.kind === "elite" || enemy.kind === "boss") {
        (da.factionData[zone.id] = da.factionData[zone.id] || { elite: 0, boss: 0 });
        da.factionData[zone.id][enemy.kind]++;
        const tcfg = G("getDeathspaceTicketDropConfig")(zone);
        if (tcfg) {
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
    if (!isDeathspace && state.combat.salvageArmActive && (typeof getSquadSalvageEfficiency === "function" ? getSquadSalvageEfficiency(state) : 0) > 0) {
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
      const res = simulateWave(state, enemies, zone, false, null, s, nowRef);
      // 扣除本波耗时
      const waveMs = res.rounds * ROUND_SECONDS * 1000;
      budgetMs -= waveMs;
      s.simulatedSeconds += res.rounds * ROUND_SECONDS;
      s.roundsEstimated += res.rounds;
      for (const k of res.kills) recordKill(state, s, k, zone, false, null);
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
        // 校验（等级/武器/维修/密钥）
        if (G("getCombatLevelFromState")(state) < site.requiredCL) { c.deathspaceChainPending = false; c.deathspaceChainRemaining = 0; s.stopReason = "level-locked"; break; }
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
        const res = simulateWave(state, enemies, zone, true, site, s, nowRef);
        budgetMs -= res.rounds * ROUND_SECONDS * 1000;
        s.simulatedSeconds += res.rounds * ROUND_SECONDS;
        s.roundsEstimated += res.rounds;
        for (const k of res.kills) recordKill(state, s, k, zone, true, site);
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
      const segStart = nowRef.t;
      // 按当前模式模拟；left = 段内未被战斗消耗的剩余秒数，交回时间轴给生产结算
      let left = 0;
      if (state.combat.mode === "deathspace" || state.combat.deathspaceChainPending) {
        left = simulateDeathspace(state, segSec, s, nowRef);
      } else if (state.combat.active) {
        left = simulateBelt(state, segSec, s, nowRef);
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
      context = context || {};
      const runId = context.runId || ("offline_" + (context.now || 0).toString(36));
      const s = _sessions[runId];
      if (!s) return null;
      _stateRef = state;
      // 若离线前无有效战斗，跳过（不发空事件）
      if (!s.activeAtStart) { delete _sessions[runId]; return null; }

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
      emitOffline("offline:combatSettled", payload, {
        timestamp: s.endedAt,
        source: "offline-combat",
        runId: runId,
        offline: true
      });
      // gains.combat 累加击杀数（供离线摘要）
      if (context.gains) context.gains.combat = (context.gains.combat || 0) + s.kills;
      delete _sessions[runId];
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
    }
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
          const salvageBonus = (typeof getSquadSalvageEfficiency === "function") ? getSquadSalvageEfficiency(state) : 0;
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
    const salvageBonus2 = (typeof getSquadSalvageEfficiency === "function") ? getSquadSalvageEfficiency(state) : 0;
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
    // 1.82) 激光定向打捞单元（MTU）独立产出舰船组件（确定性重滚；不消耗同位素；flush 时仍按当前 getSalvageEfficiency 含 MTU 2.10 放大）
    const mb = s.mtuSalvageByTier;
    if (mb) {
      const mtuSalvageBonus = (typeof getSquadSalvageEfficiency === "function") ? getSquadSalvageEfficiency(state) : 0;
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
      const tcfg = G("getDeathspaceTicketDropConfig")(zone);
      if (!tcfg) continue;
      const tk = da.ticket[zoneId];
      if (tk.elite) { const n = batchCount(tk.elite, tcfg.eliteChance, rng); if (n > 0) { RR.add(state, "special:" + tcfg.material, n); addResource(s, "special:" + tcfg.material, n); } }
      if (tk.boss) { const n = batchCount(tk.boss, tcfg.bossChance, rng); if (n > 0) { RR.add(state, "special:" + tcfg.material, n); addResource(s, "special:" + tcfg.material, n); } }
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
