/* ================================================================
   虫洞系统 —— 核心逻辑（纯逻辑，无 DOM）
   ----------------------------------------------------------------
   - 规格真值：docs/WORMHOLE_DESIGN_SPEC_v0.1.md
   - 状态：gameState.wormhole（顶层，spec §7；normalizeWormholeState 幂等补齐）
   - 推进：时间戳链式事件（run.phase + run.nextEventAt），在线 tick 与
     离线分段循环共用同一 tickWormhole(state, t)，幂等可重复调用
   - 结算：run.grantedKeys 幂等键（runId+nodeId+attempt），不重复发奖
   - 行动槽：出发时快照 prevAction，run 结束恢复（spec §5.4/§5.5）
   - 已知 v1 简化（不阻塞，均记录于规格）：
     a) 战斗节点用公式判定（战斗等级差胜率），不接实时/离线战斗模拟
     b) 词条"弹药翻倍"在 v1 战斗公式下暂无消耗面，随战斗模拟接入生效
     c) 主线通关判据 final 节点 id 以常量声明（当前星图布局末位 200），
        星图节点数变更时须与 legion-starmap-pure.html buildNodes 同步
   ================================================================ */
(() => {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CFG = root.WORMHOLE_CONFIG;
  const REW = root.WORMHOLE_REWARDS;
  const AFFIXES = root.WORMHOLE_AFFIXES;
  const SHOP = root.WORMHOLE_SHOP;

  const DAY_MS = 86400000;

  /* ---------------- 小工具 ---------------- */
  function nowMs(t) { const n = Number(t); return Number.isFinite(n) && n > 0 ? n : Date.now(); }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function dayKey(now) {
    const d = new Date(now + CFG.REFRESH_OFFSET_MS);   // 平移 8h 后按 UTC 取日期 = 北京日期
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function nextRefreshAt(now) {
    const shifted = now + CFG.REFRESH_OFFSET_MS;
    return Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS - CFG.REFRESH_OFFSET_MS;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function fn(name) { return typeof root[name] === "function" ? root[name] : null; }
  function registryAdd(state, id, qty) {
    const reg = root.ResourceRegistry;
    if (reg && typeof reg.add === "function") {
      try { reg.add(state, id, qty); return true; } catch (_) { /* 回退 */ }
    }
    if (id === "currency:isk") { state.resources.isk = (state.resources.isk || 0) + qty; return true; }
    if (id.indexOf("special:") === 0) {
      const key = id.slice(8);
      if (!state.resources.special) state.resources.special = {};
      state.resources.special[key] = (state.resources.special[key] || 0) + qty;
      return true;
    }
    return false;
  }
  function registrySpend(state, id, qty) {
    const reg = root.ResourceRegistry;
    if (reg && typeof reg.spend === "function") {
      try { return reg.spend(state, id, qty); } catch (_) { /* fallback */ }
    }
    // 无 ResourceRegistry 环境（探针/测试）的回退实现：必须真实扣减并校验余额
    if (id === "currency:isk") {
      if ((state.resources.isk || 0) < qty) return false;
      state.resources.isk -= qty; return true;
    }
    if (id.indexOf("special:") === 0) {
      const key = id.slice(8);
      if (!state.resources.special) state.resources.special = {};
      if ((state.resources.special[key] || 0) < qty) return false;
      state.resources.special[key] -= qty; return true;
    }
    return false;
  }
  function registryGet(state, id) {
    const reg = root.ResourceRegistry;
    if (reg && typeof reg.get === "function") {
      try { return reg.get(state, id); } catch (_) { /* 回退 */ }
    }
    if (id === "currency:isk") return state.resources.isk || 0;
    if (id.indexOf("special:") === 0) return (state.resources.special || {})[id.slice(8)] || 0;
    return 0;
  }

  /* ---------------- 状态：默认值与幂等规范化 ---------------- */
  function createDefaultWormhole(state) {
    const t = nowMs();
    return {
      stateVersion: 1,
      nextRefreshAt: 0,          // 0 = 首次 tick 立即刷新
      lastRefreshKey: "",
      dailies: [],
      activeRunId: null,
      run: null,
      upgrades: {},              // { travel:2, ... }
      rerollToday: { key: "", count: 0, stock: 0 },
      owned: {},                 // 一次性商品 { darkPumpBlueprint:true }
      history: [],
      stats: { completed: 0, failed: 0, tokensEarned: 0 },
      smeltBuff: null            // { expiresAt, mult }
    };
  }

  // 污染清洗（2026-09-10 起每次归一化都跑，不再是一次性）：星图真节点 id 为纯数字，
  // 历史 "nX" 前缀与本轮 "wnN" 前缀必为虫洞污染。污染会把虫洞节点 id 写进星图完成账本，
  // 而虫洞节点 id 每日复用 → 同名节点被永久拉黑 → 采集/考古/战斗奖励静默吞掉（0 发放）。
  // 旧的 idPollutionCleaned 一次性标记已废弃（wn 前缀污染发生在标记之后，一次性清洗救不回来）。
  function cleanStarmapPollution(state) {
    if (state && state.wormhole && state.wormhole.idPollutionCleaned) {
      delete state.wormhole.idPollutionCleaned;
      if (state._dirty !== undefined) state._dirty = true;
    }
    const st = state && state.legion && state.legion.starmap;
    if (!st || !Array.isArray(st.completedNodeIds)) return;
    const before = st.completedNodeIds.length;
    st.completedNodeIds = st.completedNodeIds.filter(id => !/^(n|wn)\d+$/.test(String(id)));
    if (st.completedNodeIds.length !== before && state._dirty !== undefined) state._dirty = true;
  }

  function normalizeWormholeState(state) {
    if (!state || typeof state !== "object") return;
    cleanStarmapPollution(state);
    const dirty = () => { state._dirty = true; };
    if (!state.wormhole || typeof state.wormhole !== "object") { state.wormhole = createDefaultWormhole(state); dirty(); }
    const W = state.wormhole;
    if (W.stateVersion !== 1) { W.stateVersion = 1; dirty(); }
    if (!Array.isArray(W.dailies)) { W.dailies = []; dirty(); }
    if (typeof W.lastRefreshKey !== "string") { W.lastRefreshKey = ""; dirty(); }
    if (!(W.nextRefreshAt >= 0)) { W.nextRefreshAt = 0; dirty(); }
    if (typeof W.activeRunId !== "string" && W.activeRunId !== null) { W.activeRunId = null; dirty(); }
    if (!W.upgrades || typeof W.upgrades !== "object") { W.upgrades = {}; dirty(); }
    if (!W.rerollToday || typeof W.rerollToday !== "object") { W.rerollToday = { key: "", count: 0, stock: 0 }; dirty(); }
    if (!Number.isFinite(Number(W.rerollToday.stock))) { W.rerollToday.stock = 0; dirty(); }
    if (!W.owned || typeof W.owned !== "object") { W.owned = {}; dirty(); }
    // 退役道具清算（2026-09-10「应急舱体」下架）：该道具从未接线（run.emergency 恒 false），
    // 旧档里已购未用的库存按原价一次性退还印记，并移除残留 key。靠 retiredRefunded 标记幂等，
    // 只跑一次；无残留时不写入任何东西。
    if (!W.retiredRefunded) {
      let refund = 0;
      const retired = (root.WORMHOLE_RETIRED_ITEMS && typeof root.WORMHOLE_RETIRED_ITEMS === "object") ? root.WORMHOLE_RETIRED_ITEMS : {};
      if (W.pendingItems && typeof W.pendingItems === "object") {
        for (const id of Object.keys(retired)) {
          const n = Math.max(0, Math.floor(Number(W.pendingItems[id]) || 0));
          const unit = Math.max(0, Math.floor(Number(retired[id]) || 0));
          if (n > 0 && unit > 0) refund += n * unit;
          if (Object.prototype.hasOwnProperty.call(W.pendingItems, id)) delete W.pendingItems[id];
        }
      }
      W.retiredRefunded = true;
      if (refund > 0) registryAdd(state, "special:" + CFG.TOKEN_ID, refund);
      dirty();
    }
    if (!Array.isArray(W.history)) { W.history = []; dirty(); }
    if (!W.stats || typeof W.stats !== "object") { W.stats = { completed: 0, failed: 0, tokensEarned: 0 }; dirty(); }
    for (const k of ["completed", "failed", "tokensEarned"]) {
      if (typeof W.stats[k] !== "number") { W.stats[k] = 0; dirty(); }
    }
    if (W.smeltBuff !== null && (typeof W.smeltBuff !== "object" || !(W.smeltBuff.expiresAt > 0))) { W.smeltBuff = null; dirty(); }
    // 每日结构轻校验
    for (const d of W.dailies) {
      if (!d || typeof d !== "object") continue;
      if (!Array.isArray(d.nodes)) { d.nodes = []; dirty(); }
      if (typeof d.status !== "string") { d.status = "available"; dirty(); }
      // 旧档 daily 节点可能缺 source（enrichDailyNodes 仅在生成时写入）→ 补写，保证引擎侧
      // 虫洞识别（星图加成隔离 / 1/10 奖励缩放 / 完成账本解耦）在旧档上同样生效。
      for (const n of d.nodes) {
        if (n && typeof n === "object" && n.source !== "wormhole") { n.source = "wormhole"; dirty(); }
      }
    }
    // run 结构轻校验：run 存在但缺关键字段 → 判废弃（安全默认，不崩溃）
    if (W.run) {
      if (!W.run.id || !Array.isArray(W.run.path) || typeof W.run.phase !== "string" || typeof W.run.cursor !== "number") {
        W.run = null; W.activeRunId = null; dirty();
      }
    }
    // 旧存档中的进行中远征没有词条削弱快照：首次归一化时按当前永久升级与既有 run 标记补齐，
    // 此后购买升级不会追溯改变已经出发的远征。
    if (W.run && (!W.run.upgradeSnapshot || typeof W.run.upgradeSnapshot !== "object")) {
      W.run.upgradeSnapshot = Object.assign({}, W.upgrades);
      dirty();
    }
    if (W.run && !Number.isFinite(Number(W.run.affixScale))) {
      W.run.affixScale = Math.max(0, 1 - 0.08 * Math.max(0, Math.floor(Number(W.upgrades.affix) || 0)))
        * (W.run.overdrive ? 0.5 : 1) * (W.run.voidAffix ? 0.95 : 1);
      dirty();
    }
    if (W.run) {
      const activeDaily = W.dailies.find(d => d && d.id === W.run.dailyId);
      if (activeDaily) applyRepairAffix(state, activeDaily);
    }
    if (W.activeRunId && (!W.run || W.run.id !== W.activeRunId)) { W.activeRunId = W.run ? W.run.id : null; dirty(); }
    // 旧档：special 池补新资源键（combat.js COMBAT_SPECIAL_MATERIALS 迁移已兜底，这里双保险）
    if (!state.resources) state.resources = {};
    if (!state.resources.special) state.resources.special = {};
    for (const key of [CFG.TOKEN_ID, "暗流体助熔触媒"]) {
      if (state.resources.special[key] === undefined) { state.resources.special[key] = 0; dirty(); }
    }
  }

  function ensure(state) {
    normalizeWormholeState(state);
    return state.wormhole;
  }

  /* ---------------- 升级效果读取 ---------------- */
  function upg(W, id) { return Math.max(0, Math.floor(Number(W.upgrades[id]) || 0)); }
  function runUpg(W, id) {
    const source = W && W.run && W.run.state === "running" && W.run.upgradeSnapshot
      ? W.run.upgradeSnapshot : ((W && W.upgrades) || {});
    return Math.max(0, Math.floor(Number(source[id]) || 0));
  }
  function travelSeconds(W) { return Math.max(4, CFG.TRAVEL_SECONDS - runUpg(W, "travel") - (W.run && W.run.voidTravel ? 2 : 0)); }
  function retryLimit(W, run) {
    const base = Math.max(0, Math.floor(Number(run && run.retryLimit) || 0));
    return base + upg(W, "retryLimit");
  }
  function retryCostMult(W) { return Math.max(0.2, 1 - 0.1 * runUpg(W, "retryCost")); }
  function affixResistMult(W) {
    if (W.run && Number.isFinite(Number(W.run.affixScale))) return Math.max(0, Number(W.run.affixScale));
    const m = Math.max(0, 1 - 0.08 * runUpg(W, "affix")) * (W.run && W.run.overdrive ? 0.5 : 1) * (W.run && W.run.voidAffix ? 0.95 : 1);
    return m;
  }
  function tokenChance(state, W) {
    const implants = (state && state.implants) || {};
    return Math.min(0.6, 0.05 * runUpg(W, "tokenChance")) + (implants.implant_void_token ? 0.10 : 0);
  }
  function dailyHoleCount(W) { return CFG.DAILY_COUNT + upg(W, "dailyCount"); }
  function archSuccessBonus(W) { return 0.015 * runUpg(W, "archSuccess"); }
  function collectEffMult(W) { return 1 + 0.02 * runUpg(W, "collectEff"); }

  function getWormholeRepairTimeMultiplier(state) {
    const W = state && state.wormhole;
    const run = W && W.run;
    if (!W || !run || run.state !== "running") return 1;
    const daily = Array.isArray(W.dailies) ? W.dailies.find(d => d && d.id === run.dailyId) : null;
    const affix = affixById(daily && daily.affixId);
    if (!affix || !Number.isFinite(Number(affix.repairSuppress))) return 1;
    return towardNeutral(1.55, 1, affixResistMult(W));
  }

  /* ---------------- 词条覆盖 ---------------- */
  function affixById(id) { return AFFIXES.find(a => a.id === id) || null; }
  function affixValue(W, affix, field) {
    const raw = affix && affix[field] !== undefined ? affix[field] : null;
    if (raw === null || raw === undefined) return raw;
    if (typeof raw === "number") return raw * affixResistMult(W);       // 数值类词条受"深空适应"缓释
    if (typeof raw === "object") {
      const out = {};
      for (const k of Object.keys(raw)) out[k] = raw[k] * affixResistMult(W);
      return out;
    }
    return raw;
  }
  function towardNeutral(raw, neutral, scale) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return Number(neutral);
    return Number(neutral) + (value - Number(neutral)) * Math.max(0, Number(scale) || 0);
  }
  // 从每日原始节点生成本次远征专用副本。倍率字段向 1 缓释、加值字段向 0 缓释；
  // 不改写 daily.nodes，保证同一张每日裂隙可在不同永久升级快照下稳定复用。
  function effectiveTrialNode(W, daily, node) {
    if (!node || node.kind !== "trial") return node;
    const affix = affixById(daily && daily.affixId);
    const scale = affixResistMult(W);
    const archUpgrade = node.type === "archaeology" ? runUpg(W, "archSuccess") : 0;
    const collectUpgrade = node.type === "collection" ? runUpg(W, "collectEff") : 0;
    if ((!affix || scale >= 1) && archUpgrade <= 0 && collectUpgrade <= 0) return node;
    const out = Object.assign({}, node);
    const timeProp = { battle: "battleTrialTimeLimitSeconds", collection: "collectionTimeLimitSeconds", archaeology: "archaeologyTimeLimitSeconds" }[node.type];
    const rawTimeMult = affix && affix.timeMult && affix.timeMult[node.type];
    if (timeProp && Number.isFinite(Number(rawTimeMult))) {
      out[timeProp] = Math.max(10, Math.round(CFG.NODE_LIMIT_SECONDS * towardNeutral(rawTimeMult, 1, scale)));
    }
    if (node.type === "battle" && affix && Number.isFinite(Number(affix.enemyCountAdd))) {
      const rawAdd = Number(affix.enemyCountAdd);
      const baseCount = Math.max(1, Number(node.battleTrialEnemyCount) - rawAdd);
      out.battleTrialEnemyCount = Math.max(1, Math.round(baseCount + rawAdd * scale));
    }
    if (node.type === "collection" && affix && Number.isFinite(Number(affix.collectionAmountMult))) {
      out.collectionAmount = Math.max(1, Math.round(100 * towardNeutral(affix && affix.collectionAmountMult, 1, scale)));
    }
    if (node.type === "collection" && collectUpgrade > 0 && Number(node.collectionBaseSecondsPerUnit) > 0) {
      out.collectionBaseSecondsPerUnit = Math.max(1, Math.round(Number(node.collectionBaseSecondsPerUnit) / (1 + 0.02 * collectUpgrade)));
    }
    if (node.type === "collection" && affix && Number.isFinite(Number(affix.collectionEffMult))) {
      const collectionEff = towardNeutral(affix.collectionEffMult, 1, scale);
      if (collectionEff > 0) {
        out.collectionBaseSecondsPerUnit = Math.max(1, Math.round(Number(out.collectionBaseSecondsPerUnit || node.collectionBaseSecondsPerUnit || 1) / collectionEff));
      }
    }
    if (node.type === "archaeology") {
      if ((affix && Number.isFinite(Number(affix.successDelta))) || archUpgrade > 0) {
        const RT = root.WORMHOLE_REAL_TRIAL || {};
        const tier = ((RT.archSiteByRing || {})[node.ring]) || "iii";
        const baseDifficulty = Number((RT.archDifficulty || {})[tier]) || 121;
        const delta = Number(affix && affix.successDelta);
        const affixDifficulty = Number.isFinite(delta) ? Math.round(baseDifficulty * Math.min(0.5, Math.max(0, -delta * scale))) : 0;
        const upgradeDifficulty = archUpgrade * 1.5;
        out.archaeologyDifficulty = Math.max(1, Math.round(baseDifficulty + affixDifficulty - upgradeDifficulty));
      }
      if (affix && Number.isFinite(Number(affix.cycleMult))) {
        out.archaeologyBaseCycleSeconds = Math.max(1, Math.round(10 * towardNeutral(affix.cycleMult, 1, scale)));
      }
      if (affix && Number.isFinite(Number(affix.targetAdd))) {
        out.archaeologyTargetProgress = Math.max(1, 14 + Math.round(Number(affix.targetAdd) * scale));
      }
      if (affix && Number.isFinite(Number(affix.interferenceMult))) {
        out.archaeologyInterferenceSeconds = Math.max(0, 1.5 * towardNeutral(affix.interferenceMult, 1, scale));
      }
    }
    return out;
  }
  function getEffectiveTrialNode(state, daily, node) {
    return effectiveTrialNode(ensure(state), daily, node);
  }
  function nodeTimeLimit(W, daily, type, state) {
    const affix = affixById(daily.affixId);
    const tm = affixValue(W, affix, "timeMult") || {};
    const mult = Number(tm[type]) || 1;
    return Math.max(10, Math.round(CFG.NODE_LIMIT_SECONDS * mult * getWormholeNodeTimeMultiplier(state)));
  }

  /* ---------------- 深空开拓研究加成（frontier · 虫洞线）----------------
     统一经 ResearchState 读取；ResearchState 缺失（探针 / 旧档 / 沙箱）时返回中性值 1。
     作用域：这些乘区只在虫洞远征链路内读取（nodeTimeLimit / 奖励结算 / run 级
     combat modifier），绝不外溢到普通战斗或星图试炼。
     与虫洞商店的分工见 docs/RESEARCH_FRONTIER_SPEC_v0.1.md §6.1：商店管机制型
     （移动秒数 / 重试 / 每日洞数 / 硬保底 / 词条减免），研究只给商店空白的维度。
     --------------------------------------------------------------------- */
  function frontierResearchState() {
    return (typeof root.ResearchState === "object" && root.ResearchState) || null;
  }
  function whMultiplier(state, groups) {
    const RS = frontierResearchState();
    if (!RS || typeof RS.getResearchMultiplier !== "function") return 1;
    const v = Number(RS.getResearchMultiplier(state, groups));
    return (Number.isFinite(v) && v > 0) ? v : 1;
  }
  function whReduce(state, group) {
    const RS = frontierResearchState();
    if (!RS || typeof RS.getResearchBonusValue !== "function") return 1;
    const v = Number(RS.getResearchBonusValue(state, group));
    if (!Number.isFinite(v)) return 1;
    return Math.max(0, 1 - v);
  }
  // 战斗类乘区（伤害 / 三层生命）：以 run 级 combat modifier 写入，见 applyResearchCombatMods
  function getWormholeCombatModifiers(state) {
    return {
      damage: whMultiplier(state, ["wormholeDamage"]),
      maxHp: whMultiplier(state, ["wormholeTank"]),
    };
  }
  function getWormholeNodeTimeMultiplier(state) { return whMultiplier(state, ["wormholeNodeTime"]); }
  // 燃料消耗乘区（≤1）：与「燃料翻倍」词条同源路径（fuelMultiplier modifier）
  function getWormholeSupplyMultiplier(state) { return whReduce(state, "wormholeSupply"); }
  function getWormholeTokenMultiplier(state) { return whMultiplier(state, ["wormholeToken"]); }
  function getWormholeYieldMultiplier(state) { return whMultiplier(state, ["wormholeYield"]); }
  // 印记与脑插 void_token 加法合并后再乘（合计上限 +30%，见规格 §6.3）
  function getWormholeTokenTotalMultiplier(state) {
    const implants = (state && state.implants) || {};
    const implantBonus = implants.implant_void_token ? 0.10 : 0;
    return Math.min(1.30, 1 + (getWormholeTokenMultiplier(state) - 1) + implantBonus);
  }
  // 整数型奖励按乘区缩放：整数部分 + 余数概率（<1 转概率规则，与 whScaled 同口径）
  function scaleCount(base, mult, rng) {
    const v = Number(base) * mult;
    if (!Number.isFinite(v) || v <= 0) return Math.max(0, Math.floor(Number(base) || 0));
    const fl = Math.floor(v);
    if (typeof rng !== "function") return Math.round(v);
    return fl + (rng() < v - fl ? 1 : 0);
  }

  /* ---------------- 图生成（星图同源算法） ---------------- */
  function clipPoly(poly, nx, ny, k) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ain = nx * a.x + ny * a.y <= k, bin = nx * b.x + ny * b.y <= k;
      if (ain) out.push(a);
      if (ain !== bin) {
        const dx = b.x - a.x, dy = b.y - a.y, den = nx * dx + ny * dy;
        if (den !== 0) { const q = (k - (nx * a.x + ny * a.y)) / den; out.push({ x: a.x + dx * q, y: a.y + dy * q }); }
      }
    }
    return out;
  }
  function buildVoronoi(points, cx, cy, R) {
    const boundary = [];
    for (let i = 0; i < 72; i++) { const a = i * Math.PI * 2 / 72; boundary.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }); }
    return points.map(site => {
      let poly = boundary.slice();
      for (const other of points) {
        if (other === site || !poly.length) continue;
        const nx = other.x - site.x, ny = other.y - site.y;
        const k = (nx * (other.x + site.x) + ny * (other.y + site.y)) / 2;
        poly = clipPoly(poly, nx, ny, k);
      }
      return poly;
    });
  }

  function generateGraph(total, seed, size) {
    const rng = mulberry32(seed);
    const cx = 390, cy = 290, R = 248, inner = R * 0.80;
    const minDist = 0.60 * Math.sqrt(Math.PI * inner * inner / total);
    const pts = [];
    let guard = 0;
    while (pts.length < total && guard++ < 20000) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * inner;
      const p = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      if (pts.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= minDist)) pts.push(p);
    }
    const nodes = pts.map((p, i) => ({ id: "wn" + i, x: p.x, y: p.y }));   // "wn" 前缀：与星图数字 id / 历史 "nX" 污染隔离

    // 入口 = 距圆心最远；出口 = 距入口最远
    let entry = 0, best = -1;
    nodes.forEach((n, i) => { const d = Math.hypot(n.x - cx, n.y - cy); if (d > best) { best = d; entry = i; } });
    let exit = entry === 0 ? 1 : 0;
    nodes.forEach((n, i) => {
      if (i === entry) return;
      if (Math.hypot(n.x - nodes[entry].x, n.y - nodes[entry].y) >
          Math.hypot(nodes[exit].x - nodes[entry].x, nodes[exit].y - nodes[entry].y)) exit = i;
    });

    // 不规则近邻建图（阈值按节点密度缩放）
    const spacing = Math.sqrt(Math.PI * inner * inner / total);
    const threshold = 1.75 * spacing, maxDeg = 3;
    const deg = new Array(total).fill(0), adj = nodes.map(() => []);
    const link = (a, b) => { if (a === b || adj[a].includes(b)) return false; adj[a].push(b); adj[b].push(a); deg[a]++; deg[b]++; return true; };
    const pairs = [];
    for (let i = 0; i < total; i++) for (let j = i + 1; j < total; j++)
      pairs.push({ a: i, b: j, d: Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) });
    pairs.sort((p, q) => p.d - q.d);
    for (const p of pairs) if (p.d < threshold && deg[p.a] < maxDeg && deg[p.b] < maxDeg) link(p.a, p.b);
    for (let i = 0; i < total; i++) {
      if (deg[i] > 0) continue;
      let near = -1, nd = Infinity;
      for (let j = 0; j < total; j++) { if (j === i || deg[j] >= maxDeg) continue; const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y); if (d < nd) { nd = d; near = j; } }
      if (near >= 0) link(i, near);
    }
    const seen = new Set([0]), stack = [0];
    while (stack.length) { const c = stack.pop(); for (const nb of adj[c]) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); } }
    while (seen.size < total) {
      let out = -1, inn = -1, bd = Infinity;
      for (const i of seen) for (let j = 0; j < total; j++) { if (seen.has(j)) continue; const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y); if (d < bd) { bd = d; out = i; inn = j; } }
      link(out, inn); seen.add(inn);
      const st = [inn];
      while (st.length) { const c = st.pop(); for (const nb of adj[c]) if (!seen.has(nb)) { seen.add(nb); st.push(nb); } }
    }

    // 角色：入口/出口，其余按环带占比定 ring，宝藏替换，1:1:1 余数按 战→采→考
    const kinds = new Array(total).fill("trial");
    kinds[entry] = "entry"; kinds[exit] = "exit";
    const mix = CFG.RING_MIX[size] || CFG.RING_MIX[9];
    const slots = [];
    for (let i = 0; i < total; i++) if (kinds[i] === "trial") slots.push(i);
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp; }
    const treMax = CFG.TREASURE_MAX[size] !== undefined ? CFG.TREASURE_MAX[size] : 1;
    const nTre = Math.floor(rng() * (treMax + 1));
    const treasureIdx = new Set(slots.slice(0, nTre));
    treasureIdx.forEach(i => { kinds[i] = "treasure"; });
    const trialSlots = slots.slice(nTre);
    const order = CFG.TRIAL_RATIO_ORDER;
    const per = Math.floor(trialSlots.length / 3), rem = trialSlots.length % 3;
    const bag = [];
    order.forEach((tp, k) => { for (let i = 0; i < per + (k < rem ? 1 : 0); i++) bag.push(tp); });
    trialSlots.forEach((id, i) => { nodes[id].type = bag[i % bag.length]; });

    const ringNames = ["outer", "middle", "inner"];
    nodes.forEach((n, i) => {
      n.kind = kinds[i];
      if (n.kind === "trial") n.type = nodes[i].type;
      if (n.kind === "trial") {
        // 环带占比：按排序槽位前 x% 归入目标环
        n.ring = ringNames[0];
      }
    });
    // 环带分配：目标占比由中/内环填充（外环为默认）
    if (mix.inner > 0 || mix.middle > 0) {
      const nInner = Math.round(trialSlots.length * mix.inner);
      const nMiddle = Math.round(trialSlots.length * mix.middle);
      const shuffled = trialSlots.slice();
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp; }
      shuffled.forEach((id, i) => {
        nodes[id].ring = i < nInner ? "inner" : (i < nInner + nMiddle ? "middle" : "outer");
      });
    } else {
      trialSlots.forEach(id => { nodes[id].ring = rng() < mix.outer ? "outer" : "middle"; });
    }

    // 精英节点：战斗试炼按 CFG.ELITE_CHANCE 概率精英，复用星图 elite 数值档（ISK 2.5~5×）
    trialSlots.forEach(id => {
      if (nodes[id].type === "battle") nodes[id].tier = rng() < CFG.ELITE_CHANCE ? "elite" : "normal";
    });

    const polys = buildVoronoi(nodes.map(n => ({ x: n.x, y: n.y })), cx, cy, R);
    nodes.forEach((n, i) => { n.links = adj[i].map(j => nodes[j].id); n.poly = polys[i]; });
    return { nodes, adj, entry, exit, treasures: treasureIdx, size, total, cx, cy, R };
  }

  /* ---------------- 路径 ---------------- */
  function nextHopTo(nodes, adj, from, to) {
    const dist = {}; dist[to] = 0; const q = [to];
    while (q.length) { const c = q.shift(); for (const nb of adj[c]) if (dist[nb] === undefined) { dist[nb] = dist[c] + 1; q.push(nb); } }
    let best = -1, bd = Infinity;
    for (const nb of adj[from]) if (dist[nb] !== undefined && dist[nb] < bd) { bd = dist[nb]; best = nb; }
    return best;
  }
  function pathTo(nodes, adj, from, to) {
    const prev = {}; prev[from] = -1; const q = [from];
    while (q.length) { const c = q.shift(); if (c === to) break; for (const nb of adj[c]) if (prev[nb] === undefined) { prev[nb] = c; q.push(nb); } }
    const out = []; let c = to;
    while (c !== undefined && c !== -1) { out.unshift(c); c = prev[c]; }
    return out[0] === from ? out : [from];
  }
  function buildPath(g, mode) {
    const { adj, entry, exit, treasures, nodes, total } = g;
    const idOf = i => nodes[i].id;
    if (mode === "rush") {
      const path = [entry]; const seen = new Set([entry]);
      let cur = entry, guard = 0;
      while (cur !== exit && guard++ < 200) {
        const t = adj[cur].find(n => treasures.has(n) && !seen.has(n));
        if (t !== undefined) { cur = t; path.push(cur); seen.add(cur); continue; }   // 邻接宝藏顺路拿
        const nx = nextHopTo(nodes, adj, cur, exit);
        if (nx < 0) break;
        cur = nx; path.push(cur); seen.add(cur);
      }
      return path.map(idOf);
    }
    const path = [entry]; const seen = new Set([entry]);
    let cur = entry, guard = 0;
    while (seen.size < total && guard++ < 200) {
      let target = -1, bd = Infinity;
      for (let i = 0; i < total; i++) {
        if (seen.has(i)) continue;
        const d = Math.hypot(nodes[i].x - nodes[cur].x, nodes[i].y - nodes[cur].y);
        if (d < bd) { bd = d; target = i; }
      }
      if (target < 0) break;
      const seg = pathTo(nodes, adj, cur, target);
      for (let i = 1; i < seg.length; i++) { path.push(seg[i]); seen.add(seg[i]); }
      cur = target;
    }
    if (cur !== exit) { const seg = pathTo(nodes, adj, cur, exit); for (let i = 1; i < seg.length; i++) path.push(seg[i]); }
    return path.map(idOf);
  }

  /* ---------------- 每日刷新 ---------------- */
  // 真实引擎集成：为节点写入星图试炼引擎所需的全部字段（词条影响在此一次性烘焙）。
  // 战斗 → startBattleTrial；考古 → startArchaeologyTrial；采集 → startCollectionTrial。
  // 战斗奖励经 whRewardMult=0.1 在引擎内按 1/10 发放（含货柜/许可 <1 转概率）。
  function enrichDailyNodes(daily, affix) {
    const RT = window.WORMHOLE_REAL_TRIAL || {};
    const RW = window.WORMHOLE_REWARDS || {};
    const tm = function (type) { return (affix && affix.timeMult && affix.timeMult[type]) || 1; };
    let siteIdx = 0;
    for (const n of daily.nodes) {
      n.source = "wormhole";
      if (n.kind !== "trial") continue;
      if (n.type === "battle") {
        const zones = (RT.zonesByRing || {})[n.ring] || (RT.zonesByRing || {}).outer || [];
        n.battleTrialZoneId = zones.length ? zones[Math.floor(Math.random() * zones.length)] : "angel_warfront";
        const cnt = ((RT.enemyCount || {})[n.ring] || {})[n.tier === "elite" ? "elite" : "normal"];
        n.battleTrialEnemyCount = (cnt || 2) + (affix && affix.enemyCountAdd ? affix.enemyCountAdd : 0);
        n.battleTrialTimeLimitSeconds = Math.round(180 * tm("battle"));
        n.battleTrialTargetWaves = 1;
        n.whRewardMult = 0.1;
      } else if (n.type === "archaeology") {
        const tier = (RT.archSiteByRing || {})[n.ring] || "iii";
        n.archaeologySiteId = "site_" + tier + "_" + ["c", "b", "a"][siteIdx++ % 3];
        const baseDiff = (RT.archDifficulty || {})[tier] || 121;
        // 信号干扰（成功率 -12%）→ 站点难度 +12%（真实引擎下成功率由 难度 vs 扫描强度 推导）
        n.archaeologyDifficulty = baseDiff + (affix && affix.successDelta ? Math.round(baseDiff * Math.min(0.5, -affix.successDelta)) : 0);
        n.archaeologyBaseCycleSeconds = Math.round(10 * ((affix && affix.cycleMult) || 1));
        n.archaeologyTimeLimitSeconds = Math.round(180 * tm("archaeology"));
        n.archaeologyTargetProgress = 14 + (affix && affix.targetAdd ? affix.targetAdd : 0);
        n.archaeologyRareRate = 0.05;
        n.archaeologyInterferenceSeconds = 1.5 * ((affix && affix.interferenceMult) || 1);
        n.archaeologyFirstRewardTier = (RT.artifactTierByRing || {})[n.ring] || "iii";
        n.archaeologyFirstRewardAmount = 1;   // 引擎奖励对虫洞屏蔽（见引擎挂钩），文物由虫洞按概率发放
      } else if (n.type === "collection") {
        // 采集需求对标星图（100，同节奏同耗时）；奖励经 collectionRewardMult=0.1 变 1/10
        n.collectionAmount = Math.round(100 * ((affix && affix.collectionAmountMult) || 1));
        n.collectionResource = (((RW.collection || {}).byKind || {})[n.subtype === "gas" ? "gas" : "ore"] || {})[n.ring] || "星骸钛晶";
        n.collectionKind = n.subtype === "gas" ? "gas" : "ore";
        n.collectionTimeLimitSeconds = Math.round(180 * tm("collection"));
        // 单位基准秒（照抄星图 baseByRing 81/81/630）：缺失时引擎 required=0 → 采集瞬间完成（实测 bug）
        n.collectionBaseSecondsPerUnit = n.ring === "inner" ? 630 : 81;
        n.collectionRewardMult = 0.1;
      }
    }
  }

  function generateDailies(state, now) {
    const W = state.wormhole;
    const key = dayKey(now);
    const count = dailyHoleCount(W);
    // 活跃 run 所属的虫洞必须跨刷新保留（spec §6：进行中的远征不因跨天丢失）
    const carry = W.dailies.filter(d => d && d.status === "running");
    const genCount = Math.max(0, count - carry.length);
    const sizes = [];
    for (let i = 0; i < count; i++) sizes.push(CFG.SIZES[Math.floor(Math.random() * CFG.SIZES.length)]);
    if (sizes.every(s => s === 9)) sizes[0] = 13;                       // 禁止三个全 9
    if (upg(W, "guaranteeBig") > 0) sizes[0] = 17;                      // 出货保底
    const fresh = sizes.slice(0, genCount).map((size, idx) => {
      const seed = (Math.floor(Math.random() * 4294967295)) >>> 0;
      const g = generateGraph(size + 1, seed, size);
      const affix = AFFIXES[Math.floor(Math.random() * AFFIXES.length)];
      const dailyObj = {
        id: "wh-" + key + "-" + idx,
        seed, size,
        cx: g.cx, cy: g.cy, R: g.R,               // 几何圆心随图持久化（地图渲染不再靠回退值猜）
        affixId: affix.id,
        nodes: g.nodes,
        entryNodeId: g.nodes[g.entry].id,
        exitNodeId: g.nodes[g.exit].id,
        status: "available",
        run: null
      };
      enrichDailyNodes(dailyObj, affix);
      return dailyObj;
    });
    W.dailies = carry.concat(fresh);
    W.lastRefreshKey = key;
    W.nextRefreshAt = nextRefreshAt(now);
    if (W.rerollToday.key !== key) { W.rerollToday = { key, count: 0, stock: Math.max(0, Number(W.rerollToday.stock) || 0) }; }   // 2026-09-10：限购计数日切，已购未用的重析库存跨日保留（玩家报「买了不用第二天就没了」）
    state._dirty = true;
  }
  function applyDailyRefreshIfNeeded(state, now) {
    const W = ensure(state);
    const t = nowMs(now);
    if (!W.dailies.length || W.lastRefreshKey !== dayKey(t) || t >= W.nextRefreshAt) generateDailies(state, t);
  }

  /* ---------------- 主线通关门禁 ---------------- */
  const FINAL_NODE_ID = "200";   // 与 legion-starmap-pure.html buildNodes 末位 final 节点一致（布局变更须同步）
  function isUnlocked(state) {
    // final 节点 id 优先取星图 iframe 广播的 LEGION_STARMAP_FINAL_ID（postMessage 同步），
    // 回退到常量（当前星图布局末位；legion-starmap-pure.html buildNodes 变更须同步）
    const finalId = String(root.LEGION_STARMAP_FINAL_ID || FINAL_NODE_ID);
    const L = state && state.legion && state.legion.starmap;
    return !!(L && Array.isArray(L.completedNodeIds) && L.completedNodeIds.includes(finalId));
  }

  /* ---------------- 行动槽快照（spec §5.5） ---------------- */
  function stopNormalActivity(state, now) {
    const t = nowMs(now);
    const dispatch = fn("dispatchGameAction");
    const queueRunning = !!(state.queue && state.queue.status && state.queue.status.isRunning);
    if (queueRunning && dispatch) dispatch(state, { type: "queue/stop" }, t);
    else if (state.currentAction && state.currentAction.active && dispatch) dispatch(state, { type: "action/stop" }, t);
    if (state.currentAction) { state.currentAction.active = false; state.currentAction.progress = 0; state.currentAction.batchRemaining = 0; state.currentAction.lastProgressUpdate = t; }
    state._dirty = true;
  }
  function snapshotAction(state) {
    const a = state.currentAction || {};
    const q = state.queue;
    const queueRunning = !!(q && q.status && q.status.isRunning);
    // 2026-09-10 修复（玩家报「虫洞打完后继续已删除的行动」）：额外记录激活队列条目的 id，
    // 恢复时按 id 重新定位——run 期间玩家可增删/移动队列项，仅靠 isRunning 布尔与瞬时 activeIndex
    // 会复活已被删除的行动（幽灵行动）或恢复到错位的条目上。
    const activeItem = (queueRunning && q.items && q.status.activeIndex >= 0 && q.items[q.status.activeIndex]) || null;
    return {
      has: !!(a.active || queueRunning),
      action: a.active ? { skill: a.skill, target: a.target, progress: a.progress, lastProgressUpdate: a.lastProgressUpdate } : null,
      queueRunning,
      activeItemId: activeItem ? activeItem.id : null
    };
  }
  function restoreSnapshot(state, snap, now) {
    if (!snap) return;
    const t = nowMs(now);
    const q = state.queue;
    // 2026-09-10 修复：队列恢复加存在性校验——
    // ① 出发时在跑的队列：run 期间玩家删掉了激活条目（queueRemove→queueStop）或删空队列，
    //    则不再恢复 isRunning（旧行为无条件置 true → 幽灵行动）；
    // ② 条目仍存在时按 id 重新定位 activeIndex（待执行项增删/移动会使旧 activeIndex 错位）。
    let queueResumed = false;
    if (snap.queueRunning && q && q.status && Array.isArray(q.items) && q.items.length) {
      let idx = -1;
      if (snap.activeItemId) idx = q.items.findIndex(it => it && it.id === snap.activeItemId);
      else if (q.status.activeIndex >= 0 && q.status.activeIndex < q.items.length) idx = q.status.activeIndex;
      if (idx >= 0) { q.status.activeIndex = idx; q.status.isRunning = true; queueResumed = true; }
    }
    // currentAction 只在「行动仍有载体」时恢复：出发时走队列的行动，其条目已被删 → 不复活；
    // 出发时的独立行动（不经队列）→ 照旧恢复。
    if (snap.action && state.currentAction && ((!snap.queueRunning && snap.has) || queueResumed)) {
      Object.assign(state.currentAction, snap.action, { active: true, lastProgressUpdate: t });
    }
    state._dirty = true;
  }

  /* ---------------- 出发 ---------------- */
  function startRun(state, dailyId, opts, now) {
    const W = ensure(state);
    const t = nowMs(now);
    applyDailyRefreshIfNeeded(state, t);          // 先刷新，避免 daily 引用被替换
    if (W.run && W.run.state === "running") return { changed: false, reason: "wormhole-run-active" };
    const starmap = (root.LEGION_STARMAP_TRIAL && typeof root.LEGION_STARMAP_TRIAL.isAnyTrialRunning === "function") ? root.LEGION_STARMAP_TRIAL : null;   // fn() 只认 function；引擎是对象，曾永远拿不到 → 互斥守卫从未生效
    if (starmap && typeof starmap.isAnyTrialRunning === "function" && starmap.isAnyTrialRunning(state)) return { changed: false, reason: "starmap-trial-running" };
    if (state.combat && state.combat.active) return { changed: false, reason: "combat-running" };
    if (!isUnlocked(state)) return { changed: false, reason: "starmap-not-cleared" };
    const daily = W.dailies.find(d => d.id === dailyId);
    if (!daily) return { changed: false, reason: "unknown-daily" };
    if (daily.status !== "available") return { changed: false, reason: "daily-not-available" };
    const o = opts || {};
    // 出发卡片上的选路二选一（自动/手动）：随出发定格（不传则继承当前模式）
    if (o.control === "manual" || o.control === "auto") W.control = o.control;
    const prevAction = snapshotAction(state);   // 必须在停动作之前拍快照
    stopNormalActivity(state, t);
    const mode = o.mode === "rush" ? "rush" : "full";
    const seed = daily.seed;
    const runId = "run-" + daily.id + "-" + t.toString(36);
    // 出发时定格脑插快照（run 途中购买不回溯）；必须先算再进字面量——构造期间 W.run 仍是上一轮 run
    const voidTravel = !!(state.implants && state.implants.implant_void_travel);
    const voidAffix = !!(state.implants && state.implants.implant_void_affix);
    const upgradeSnapshot = Object.assign({}, W.upgrades);
    const affixScale = Math.max(0, 1 - 0.08 * Number(upgradeSnapshot.affix || 0)) * (voidAffix ? 0.95 : 1);
    const travelSec = Math.max(4, CFG.TRAVEL_SECONDS - Number(upgradeSnapshot.travel || 0) - (voidTravel ? 2 : 0));
    W.run = {
      id: runId, dailyId: daily.id, mode,
      retryLimit: Math.max(0, Math.min(99, Math.floor(Number(o.retryLimit) || 0))),
      overdrive: false,
      voidTravel, voidAffix, affixScale, upgradeSnapshot,
      control: W.control || "auto",          // auto=系统选路（遍历/直冲） / manual=玩家点选相邻节点（继承当前模式）
      state: "running",
      startedAt: t, endsAt: t + CFG.RUN_LIMIT_SECONDS * 1000,
      phase: "travel", nextEventAt: t + travelSec * 1000,   // 秒 → 毫秒   // 入口→首节点移动
      cursor: 1,                                            // path[0] = 入口
      current: null, attempt: 0,
      path: buildPath({ adj: graphAdj(daily), entry: indexById(daily, daily.entryNodeId), exit: indexById(daily, daily.exitNodeId), treasures: treasureSet(daily), nodes: daily.nodes, total: daily.nodes.length }, mode),
      rngState: (seed ^ t) >>> 0,
      grantedKeys: [], log: [],
      cleared: [], skipped: [], visited: 0, plan: null, pendingId: null,
      prevAction,
      summary: { materials: 0, relics: 0, tokens: 0, cleared: 0, skipped: 0, retried: 0 }
    };
    if ((W.run.control || "auto") === "manual") {
      // 手动起步：停靠入口、不自动跃迁首跳，等玩家点选（点任意未清节点自动寻路）
      W.run.phase = "idle";
      W.run.pendingId = null;
      W.run.parkedAt = daily.entryNodeId || null;
      W.run.path = [daily.entryNodeId].filter(Boolean);
      W.run.cursor = 1;
      W.run.nextEventAt = t;
    } else {
      W.run.pendingId = W.run.path.length > 1 ? W.run.path[1] : null;   // 首跳目标（入口必为 path[0]）
    }
    W.activeRunId = runId;
    // 出发策略快照：wh_autopilot 自动巡航协议在通关后沿用（模式 / 重试次数 / 选路控制）
    W.lastStrategy = { mode: W.run.mode, retryLimit: W.run.retryLimit, control: W.run.control || "auto" };
    daily.status = "running";
    daily.run = { id: runId };
    state._dirty = true;
    applyFuelAffix(state, daily);   // 燃料翻倍词条：run 级全局修正（幂等）
    applyRunResearchMods(state, daily);   // 深空开拓研究：run 级快照（幂等，出发定格不回溯）
    return { changed: true, runId, mode };
  }
  function indexById(daily, id) { return daily.nodes.findIndex(n => n.id === id); }
  function treasureSet(daily) { return new Set(daily.nodes.map((n, i) => n.kind === "treasure" ? i : -1).filter(i => i >= 0)); }
  function graphAdj(daily) { const adj = daily.nodes.map(() => []); daily.nodes.forEach((n, i) => (n.links || []).forEach(l => { const j = indexById(daily, l); if (j >= 0) adj[i].push(j); })); return adj; }

  /* ---------------- 节点结算参数 ---------------- */
  function nodeDuration(W, daily, node, state) {
    if (node.kind === "treasure") return CFG.TREASURE_NODE_SECONDS;
    return nodeTimeLimit(W, daily, node.type, state);
  }
  function collectionPlan(W, daily, node, now, state) {
    // 采集：确定性完成时刻（required = base*amount/eff），超时则不可能成功
    const base = node.ring === "inner" ? 630 : 81;
    const amount = Math.round(100 * (affixValue(W, affixById(daily.affixId), "collectionAmountMult") || 1));
    const isGas = node.subtype === "gas";
    let eff = 1;
    const gm = fn("getMiningEfficiency"), gg = fn("getGasEfficiency");
    try { eff = isGas ? (gg ? Number(gg()) || 1 : 1) : (gm ? Number(gm()) || 1 : 1); } catch (_) { eff = 1; }
    eff *= collectEffMult(W) * (affixValue(W, affixById(daily.affixId), "collectionEffMult") || 1);
    if (!(eff > 0)) eff = 1;
    const required = Math.ceil(base * amount / eff);
    const limit = nodeTimeLimit(W, daily, "collection", state);
    return { amount, required, limit, success: required <= limit, successAt: required <= limit ? required : limit };
  }
  function battleSuccessChance(W, daily, node) {
    const cl = (fn("getCombatLevelFromState") || (() => 1))(state());
    const req = ({ outer: 55, middle: 75, inner: 90 }[node.ring] || 55) + (node.tier === "elite" ? 10 : 0);   // 精英：等级要求 +10
    const p = 0.78 + (cl - req) * 0.02;
    return Math.max(0.25, Math.min(0.95, p));
  }
  function archSuccessChance(W, daily, node) {
    const base = { outer: 0.75, middle: 0.70, inner: 0.62 }[node.ring] || 0.70;
    const affix = affixById(daily.affixId);
    const delta = affixValue(W, affix, "successDelta");
    const p = base + archSuccessBonus(W) + (typeof delta === "number" ? delta : 0);
    return Math.max(0.15, Math.min(0.95, p));
  }
  function state() { return (typeof root.gameState === "object" && root.gameState) || null; }

  /* ---------------- 奖励（幂等） ---------------- */
  function grantKey(run, node, attempt) { return run.id + "|" + node.id + "|" + attempt; }
  function grantNodeRewards(state, run, daily, node, attempt) {
    const key = grantKey(run, node, attempt);
    if (run.grantedKeys.indexOf(key) >= 0) return null;
    run.grantedKeys.push(key);
    const W = state.wormhole;
    const ring = node.ring || "outer";
    const gained = {};
    const rng = mulberry32(run.rngState);
    const roll = rng(); run.rngState = (run.rngState * 1664525 + 1013904223) >>> 0;
    // 物质奖励改由星图试炼引擎在结算时发放（战斗 ISK/货柜/许可经 whRewardMult=0.1 缩放；
    // 采集材料由引擎按 collectionAmount 入库）。虫洞这里只补：考古概率文物（15%，用户拍板）。
    if (node.type === "archaeology") {
      const spec = REW.archaeology[ring];
      if (rng() < spec.chance) { const id = "calibration:art_" + spec.tier + "_calib"; registryAdd(state, id, 1); gained.relic = spec.tier; run.summary.relics += 1; }
    }
    // 采集节点：矿物实际入库量由引擎 finish() 算出并挂在 lastGrant（唯一口径）。
    // 虫洞侧不复刻 amount × collectionRewardMult 公式 —— 那样会与引擎（含词条/产出乘区）漂移。
    if (node.type === "collection") {
      const ct = state.legion && state.legion.starmap && state.legion.starmap.collectionTrial;
      const g = ct && ct.lastGrant;
      if (g && String(g.nodeId) === String(node.id)) {
        const qty = Math.max(0, Math.round(Number(g.qty) || 0));
        if (qty > 0) { gained.material = qty; run.summary.materials = (run.summary.materials || 0) + qty; }
      }
    }
    // Token：节点 1 / 宝藏 5，印记谐振 = 概率额外 +1
    let tokens = node.kind === "treasure" ? REW.token.treasure : REW.token.trial;
    if (rng() < tokenChance(state, W)) tokens += 1;
    // 印记提纯（研究）+ 虚空脑插合并后按「整数 + 余数概率」缩放（1.2 → 20% 概率多 1）
    tokens = scaleCount(tokens, getWormholeTokenTotalMultiplier(state), rng);
    registryAdd(state, "special:" + CFG.TOKEN_ID, tokens);
    W.stats.tokensEarned += tokens; run.summary.tokens += tokens;
    run.rngState = (run.rngState * 1664525 + 1013904223) >>> 0;
    state._dirty = true;
    return gained;
  }

  /* ---------------- 链式推进 ---------------- */
  // 「燃料翻倍」词条：run 期间向全局修正表写入 fuelMultiplier×2 —— 任何走 calcFuelMult 的
  // 消耗燃料行动（维修/战斗开火/MTU 等）全部 ×2。expiresAt 在 fuelMultiplier 路径不生效
  // （context 无 now），必须 run 结束时手动移除；修正随 combat 存档持久化，跨刷新/离线不掉。
  const WH_FUEL_MOD = { stat: "fuelMultiplier", operation: "multiply", value: 2, priority: 50, source: "wormhole" };
  function applyFuelAffix(state, daily) {
    if (!daily || daily.affixId !== "fuel") return;
    if (!Array.isArray(state.combat.modifiers)) state.combat.modifiers = [];
    if (state.combat.modifiers.some(m => m && m.source === "wormhole")) return;   // 幂等
    const W = state.wormhole;
    const affix = affixById(daily.affixId);
    const rawMult = Number(affix && affix.fuelMult) || WH_FUEL_MOD.value;
    const value = towardNeutral(rawMult, 1, affixResistMult(W));
    state.combat.modifiers.push(Object.assign({}, WH_FUEL_MOD, { value }));
    state._dirty = true;
  }
  const WH_REPAIR_MOD_SOURCE = "wormhole-repair-affix";
  function applyRepairAffix(state, daily) {
    if (!state || !daily || daily.affixId !== "repair") return;
    if (!state.combat || !Array.isArray(state.combat.modifiers)) return;
    if (state.combat.modifiers.some(m => m && m.source === WH_REPAIR_MOD_SOURCE)) return;
    const W = state.wormhole;
    const affix = affixById(daily.affixId);
    const suppress = Math.max(0, Math.min(1, Number(affix && affix.repairSuppress) || 0));
    const value = 1 - suppress * (1 - affixResistMult(W));
    state.combat.modifiers.push({ stat: "repairMultiplier", operation: "multiply", value, priority: 50, source: WH_REPAIR_MOD_SOURCE });
    state._dirty = true;
  }
  function removeRepairAffix(state) {
    if (!state || !state.combat || !Array.isArray(state.combat.modifiers)) return;
    const before = state.combat.modifiers.length;
    state.combat.modifiers = state.combat.modifiers.filter(m => !(m && m.source === WH_REPAIR_MOD_SOURCE));
    if (state.combat.modifiers.length !== before) state._dirty = true;
  }
  function removeFuelAffix(state) {
    if (Array.isArray(state.combat.modifiers)) {
      const before = state.combat.modifiers.length;
      state.combat.modifiers = state.combat.modifiers.filter(m => !(m && m.source === "wormhole"));
      if (state.combat.modifiers.length !== before) state._dirty = true;
    }
  }

  // 深空开拓研究 · run 级修正（与 WH_FUEL_MOD 同构；source 独立，互不误删）
  //   出发时定格、结束时移除：
  //     - 伤害 / 三层生命 / 燃料消耗 走 state.combat.modifiers（持久化，跨刷新 / 离线不掉）。
  //       燃料与「燃料翻倍」词条是同一 stat（fuelMultiplier），两者相乘而非覆盖。
  //     - 采集材料产出写回 daily 节点的 collectionRewardMult；基础恒为 0.1
  //       （enrichDailyNodes 设定），每次出发都从 0.1 重算 → 幂等、无累积。
  const WH_RESEARCH_MOD_SOURCE = "wormhole-research";
  function applyRunResearchMods(state, daily) {
    if (!state.combat || !Array.isArray(state.combat.modifiers)) {
      if (state.combat) state.combat.modifiers = [];
      else return;
    }
    removeRunResearchMods(state);   // 先清后写：同一 daily 重复出发只保留最新快照
    const mods = getWormholeCombatModifiers(state);
    const supply = getWormholeSupplyMultiplier(state);
    const push = (stat, value) => {
      if (!Number.isFinite(value) || Math.abs(value - 1) < 1e-9) return;   // 中性值不落盘
      state.combat.modifiers.push({ stat, operation: "multiply", value, priority: 50, source: WH_RESEARCH_MOD_SOURCE });
    };
    push("damageMultiplier", mods.damage);
    push("maxHp", mods.maxHp);
    push("fuelMultiplier", supply);
    applyRunYield(daily, state);
    if (state.combat.modifiers.some(m => m && m.source === WH_RESEARCH_MOD_SOURCE)) state._dirty = true;
  }
  function removeRunResearchMods(state) {
    if (!state.combat || !Array.isArray(state.combat.modifiers)) return;
    const before = state.combat.modifiers.length;
    state.combat.modifiers = state.combat.modifiers.filter(m => !(m && m.source === WH_RESEARCH_MOD_SOURCE));
    if (state.combat.modifiers.length !== before) state._dirty = true;
  }
  function applyRunYield(daily, state) {
    if (!daily || !Array.isArray(daily.nodes)) return;
    const mult = getWormholeYieldMultiplier(state);
    for (const n of daily.nodes) {
      if (n && n.type === "collection") n.collectionRewardMult = 0.1 * mult;   // 基础恒 0.1 → 幂等
    }
  }

  function pushRunLog(run, entry) {
    if (!Array.isArray(run.log)) run.log = [];
    run.log.push(entry);
    if (run.log.length > 60) run.log.shift();
  }

  // wh_autopilot 自动巡航协议：远征「通关」后沿用上次策略自动开赴下一个未通关虫洞。
  //   失败 / 超时 / 主动撤退一律不触发（此时燃料弹药已消耗，连锁出发会持续放血）。
  //   在线与离线均生效；每日最多 3 个洞，status 流转天然有界，不存在无限链式。
  function maybeAutoPilot(state, now) {
    const W = state && state.wormhole;
    if (!W) return { changed: false, reason: "no-wormhole-state" };
    const lv = Number(state.research && state.research.completedLevels && state.research.completedLevels.wh_autopilot) || 0;
    if (lv < 1) return { changed: false, reason: "autopilot-not-researched" };
    const strat = W.lastStrategy;
    if (!strat) return { changed: false, reason: "no-last-strategy" };
    if (W.run && W.run.state === "running") return { changed: false, reason: "run-active" };
    const next = (W.dailies || []).find(d => d && d.status === "available");
    if (!next) return { changed: false, reason: "no-available-daily" };
    return startRun(state, next.id, { mode: strat.mode, retryLimit: strat.retryLimit, control: strat.control }, now);
  }
  function finishRun(state, outcome, now) {
    const W = state.wormhole, run = W.run, t = nowMs(now);
    stopEngineTrialIfRunning(state);               // 引擎试炼仍在跑（放弃/超时）→ 立即停掉
    removeFuelAffix(state);                        // 任何结局（通关/超时/放弃）都移除 run 级修正
    removeRepairAffix(state);
    removeRunResearchMods(state);                  // 深空开拓研究的 run 级战斗/燃料修正同理
    run.state = outcome; run.finishedAt = t;
    const daily = W.dailies.find(d => d.id === run.dailyId);
    if (daily) { daily.status = outcome === "completed" ? "completed" : (outcome === "failed" ? "failed" : "aborted"); daily.run = null; }
    if (outcome === "completed") {
      const size = daily ? daily.size : 9;
      // 通关印记同样吃印记提纯（大额整数，四舍五入即可；误差 < 1 枚）
      const bonus = scaleCount(REW.token.clear[size] || 10, getWormholeTokenTotalMultiplier(state), null);
      registryAdd(state, "special:" + CFG.TOKEN_ID, bonus);
      W.stats.tokensEarned += bonus; run.summary.tokens += bonus;
      W.stats.completed += 1;
    } else if (outcome === "failed") { W.stats.failed += 1; }
    W.history.unshift({ id: run.id, dailyId: run.dailyId, mode: run.mode, state: outcome, at: t, summary: run.summary });
    if (W.history.length > CFG.HISTORY_LIMIT) W.history.length = CFG.HISTORY_LIMIT;
    restoreSnapshot(state, run.prevAction, t);
    W.activeRunId = null;
    state._dirty = true;
    // 自动巡航：放在 restoreSnapshot 之后 —— 此时玩家原活动已恢复，新 run 的 prevAction 才能正确继承原活动
    if (outcome === "completed") maybeAutoPilot(state, t);
  }
  function advanceCursor(state, run, daily, now) {
    // cursor 前进到下一个待处理节点；抵达出口则通关
    // 出界判定不能用"cursor 走完 path"：手动选路 path=[单跳]，目标被跳过后会误判通关。
    // 以全图待清节点为准：无待清（且出口可达/已是终点语义）才通关，否则挂起等待。
    const W = state.wormhole, t = nowMs(now);
    while (true) {
      if (run.cursor >= run.path.length) {
        const remainAny = daily.nodes.some(n => (n.kind === "trial" || n.kind === "treasure") && run.cleared.indexOf(n.id) < 0 && run.skipped.indexOf(n.id) < 0);
        if (remainAny) {
          const parkId = run.cleared.length ? run.cleared[run.cleared.length - 1] : (daily.entryNodeId || null);
          // auto：从停靠点重新规划续推（手动打断产生的单跳 path 耗尽后，auto 不能卡死在 idle）
          if (W.control === "auto" && parkId != null) {
            const plan = buildPath({ adj: graphAdj(daily), entry: indexById(daily, parkId), exit: indexById(daily, daily.exitNodeId), treasures: treasureSet(daily), nodes: daily.nodes, total: daily.nodes.length }, run.mode);
            if (plan && plan.length > 1) { run.path = plan; run.cursor = 0; continue; }
          }
          run.phase = "idle"; run.current = null;
          run.parkedAt = parkId;
          return;
        }
        finishRun(state, "completed", t); return;
      }
      const id = run.path[run.cursor];
      const node = daily.nodes.find(n => n.id === id);
      if (!node) { run.cursor++; continue; }
      if (node.kind === "exit") {
        // 出口仅在无待清节点时为终点（遍历模式出口可能在中途被路过）
        const remain = run.path.slice(run.cursor).some(pid => {
          const m = daily.nodes.find(n => n.id === pid);
          return m && (m.kind === "trial" || m.kind === "treasure") && run.cleared.indexOf(pid) < 0 && run.skipped.indexOf(pid) < 0;
        });
        if (!remain) { finishRun(state, "completed", t); return; }
        run.cursor++; continue;
      }
      if (node.kind === "entry") { run.cursor++; continue; }
      if (run.cleared.indexOf(id) >= 0 || run.skipped.indexOf(id) >= 0) { run.cursor++; continue; }
      if (W.control === "manual" && !run.manualPending) {
        // 手动模式：等玩家点选下一个相邻节点；没有目标则挂起（不推进、不耗节点时限）
        run.phase = "idle"; run.current = null;
        run.parkedAt = run.cleared.length ? run.cleared[run.cleared.length - 1] : (daily.entryNodeId || null);
        return;
      }
      if (run.visited > 0) {
        run.phase = "travel"; run.nextEventAt = t + travelSeconds(W) * 1000; run.pendingId = id; return;
      }
      beginNode(state, run, daily, node, t); return;
    }
  }
  // 引擎试炼启动（战斗/考古/采集 → 星图试炼引擎；词条与奖励倍率已烘焙进节点字段）
  function startEngineTrial(state, node, t) {
    const T = root.LEGION_STARMAP_TRIAL;
    if (!T) return { changed: false, reason: "engine-unavailable" };
    try {
      if (node.type === "battle") return T.startBattleTrial(state, node, t, { confirmed: true });
      if (node.type === "archaeology") return T.startArchaeologyTrial(state, node, t, { confirmed: true });
      if (node.type === "collection") return T.startCollectionTrial(state, node, t, { confirmed: true });
    } catch (e) { return { changed: false, reason: "engine-error:" + (e && e.message || e) }; }
    return { changed: false, reason: "unknown-node-type" };
  }

  // 试炼仍在跑时把引擎实例停掉（放弃/超时结束 run 用）
  function stopEngineTrialIfRunning(state) {
    const T = root.LEGION_STARMAP_TRIAL;
    if (!T) return;
    try { if (T.isBattleRunning && T.isBattleRunning(state)) T.stopBattleTrial(state); } catch (_) {}
    try { if (T.isArchaeologyRunning && T.isArchaeologyRunning(state)) T.stopArchaeologyTrial(state); } catch (_) {}
    try { if (T.isRunning && T.isRunning(state)) T.stopCollectionTrial(state); } catch (_) {}
  }

  function beginNode(state, run, daily, node, t) {
    run.phase = "node"; run.current = node.id;
    run.hopTravel = false;
    run.manualPending = false;
    run.currentStartedAt = t;                      // 地图进度环用
    if (run.lastNodeId !== node.id) { run.visited = (run.visited || 0) + 1; run.attempt = 1; }
    run.lastNodeId = node.id;
    if (!run.attempt) run.attempt = 1;
    const W = state.wormhole;
    if (node.kind === "treasure") { run.nextEventAt = t + nodeDuration(W, daily, node, state) * 1000; return; }
    // 真实引擎：到达即开战/开扫/开采（成败由引擎与玩家舰船/技能决定；离线由 offline-combat/分段 tick 补算）
    const res = startEngineTrial(state, effectiveTrialNode(W, daily, node), t);
    if (res && res.changed && res.trial) {
      run.nextEventAt = (Number(res.trial.endsAt) || t + 180000) + 50;   // 兜底轮询点；更早结束靠每 tick 轮询
      // 离线战斗预判（2026-09-10 方案 A）：离线共享战斗内核冻结（出发已停行动槽），战斗试炼
      // 只会烧满时限判负。开战即用离线同口径单场模拟预判胜负与真实时长；在线内核会自然先出
      // 结果（血量指纹变化），预判仅在「到点时战斗画面仍冻结」时兜底结算（见 pollEngineNode）。
      run.battlePred = null;
      if (node.type === "battle") {
        const OCS = root.OfflineCombatSystem;
        if (OCS && typeof OCS.predictTrialWave === "function") {
          const trialEndsAt = Number(res.trial.endsAt) || (t + 180000);
          const pred = OCS.predictTrialWave(state, {
            enemyCount: res.trial.enemyCount,
            maxSeconds: Math.max(1, Math.round((trialEndsAt - t) / 1000)),
            now: t
          });
          if (pred && pred.seconds > 0) {
            run.battlePred = {
              nodeId: node.id, attempt: run.attempt || 1,
              endsAt: t + pred.seconds * 1000, win: !!pred.win,
              fp: combatHpFingerprint(state.combat)
            };
            const predWake = t + pred.seconds * 1000 + 50;
            if (predWake < run.nextEventAt) run.nextEventAt = predWake;
          }
        }
      }
      return;
    }
    // 启动失败（无考古舰/无探针/维修中/战力不足等）→ 重试 → 跳过管线，原因进战报
    pushRunLog(run, { id: node.id, ok: false, reason: "启动失败:" + (res && res.reason || "未知"), at: t, attempt: run.attempt, gained: null });
    failAttempt(state, run, daily, node, t);
  }

  // 失败 → 重试（短等待后重开，耗时吃稳定锚折扣）→ 耗尽跳过
  function failAttempt(state, run, daily, node, t) {
    const W = state.wormhole;
    const maxAttempts = (run.retryLimit || 0) + 1;
    if (run.attempt < maxAttempts) {
      run.attempt += 1;
      run.summary.retried = (run.summary.retried || 0) + 1;
      run.phase = "travel"; run.pendingId = node.id;      // 复用跃迁管线做重试等待
      run.nextEventAt = t + Math.round(travelSeconds(W) * 1000 * retryCostMult(W));
      return;
    }
    run.skipped.push(node.id); run.summary.skipped += 1;
    pushRunLog(run, { id: node.id, ok: false, reason: "skip", at: t, attempt: run.attempt, gained: null });
    run.current = null; run.phase = "idle"; run.cursor++;
    advanceCursor(state, run, daily, t);
  }

  // 节点轮询：引擎试炼结束 → 制压 / 重试 / 跳过（战斗提前打完不等 deadline）
  // 战斗画面冻结指纹（2026-09-10）：离线内核不推进 → 血量恒定；任何真实开火（在线）都会
  // 改变玩家或敌人血量。预判只在该指纹与开战时一致（= 战斗从未推进）时才允许兜底结算。
  function combatHpFingerprint(c) {
    try {
      if (!c || !c.hp) return null;
      const en = Array.isArray(c.enemies) ? c.enemies.map(e => (e && e.hp) ? [e.hp.shield, e.hp.armor, e.hp.structure] : null) : [];
      return JSON.stringify({ hp: [c.hp.shield, c.hp.armor, c.hp.structure], en: en });
    } catch (_) { return null; }
  }
  function pollEngineNode(state, run, daily, node, t) {
    const T = root.LEGION_STARMAP_TRIAL;
    if (!T || !T.getTrialStates) return { events: 0, busy: true };
    let tr = T.getTrialStates(state);
    let trial = node.type === "battle" ? tr.battle : node.type === "archaeology" ? tr.archaeology : tr.collection;
    if (trial && trial.nodeId === String(node.id) && trial.status === "running") {
      // 离线预判结算（2026-09-10 方案 A）：到预判时刻且血量指纹未变（离线内核冻结）→ 按预判收口。
      // 在线内核会先行自然出结果（血量已变）→ 本分支不触发，行为与旧版完全一致。
      const pred = run.battlePred;
      if (pred && pred.nodeId === node.id && Number(pred.endsAt) > 0 && t >= Number(pred.endsAt) && pred.fp) {
        run.battlePred = null;
        if (combatHpFingerprint(state.combat) === pred.fp) {
          const c = state.combat;
          if (pred.win && c) {
            // 胜：喂满击杀数，走引擎自身出口（tickBattleTrial → combat/stop → finishBattleTrial(true)）
            c.totalKills = Math.max(Number(c.totalKills) || 0, Math.max(1, Number(trial.enemyCount) || 1));
            c.wave = Math.max(1, Number(c.wave) || 1);
          } else if (!pred.win && c && typeof root.dispatchGameAction === "function") {
            // 败：与在线超时路径同口径（combat/stop → !combat.active → finishBattleTrial(false)）
            root.dispatchGameAction(state, { type: "combat/stop" }, t);
          }
          try { T.tickBattleTrial(state, t); } catch (_) {}
          tr = T.getTrialStates(state);
          trial = node.type === "battle" ? tr.battle : node.type === "archaeology" ? tr.archaeology : tr.collection;
        }
      }
      if (trial && trial.nodeId === String(node.id) && trial.status === "running") {
        const p2 = run.battlePred;
        let wakeAt = Number(trial.endsAt) || 0;
        if (p2 && p2.nodeId === node.id && Number(p2.endsAt) > t && Number(p2.endsAt) < wakeAt) wakeAt = Number(p2.endsAt);
        run.nextEventAt = Math.max(wakeAt, t + 1000);   // 离线切分边界跟随引擎 deadline（有更早预判则取更早）
        return { events: 0, busy: true };
      }
    }
    if (!trial || trial.nodeId !== String(node.id)) return { events: 0, busy: true };
    if (trial.status === "success") {
      run.cleared.push(node.id); run.summary.cleared += 1;
      const gained = grantNodeRewards(state, run, daily, node, run.attempt);
      pushRunLog(run, { id: node.id, ok: true, at: t, attempt: run.attempt, gained: gained });
      run.current = null; run.phase = "idle"; run.cursor++;
      advanceCursor(state, run, daily, t);
      return { events: 1, busy: false };
    }
    pushRunLog(run, { id: node.id, ok: false, reason: String(trial.result || "失败"), at: t, attempt: run.attempt, gained: null });
    failAttempt(state, run, daily, node, t);
    return { events: 1, busy: false };
  }
  function resolveNode(state, run, daily, t) {
    const node = daily.nodes.find(n => n.id === run.current);
    if (!node) { run.phase = "idle"; advanceCursor(state, run, daily, t); return; }
    if (node.kind !== "treasure") { run.phase = "idle"; advanceCursor(state, run, daily, t); return; }   // 试炼节点异常兜底：交回轮询
    run.cleared.push(node.id); run.summary.cleared += 1;
    const gained = grantNodeRewards(state, run, daily, node, run.attempt);
    pushRunLog(run, { id: node.id, ok: true, at: t, attempt: run.attempt, gained: gained });
    run.current = null; run.phase = "idle"; run.cursor++;
    advanceCursor(state, run, daily, t);
  }
  function tickWormhole(state, now) {
    if (!state || typeof state !== "object") return { changed: false };
    const W = ensure(state);
    const start = nowMs(now);
    // 先推进 run 再刷新每日：跨午夜追算时 run 必须按自身时间轴结算完，刷新不能抢跑
    // 熔核过期清理（惰性，读取方按 expiresAt 自判）
    const run = W.run;
    if (!run || run.state !== "running") return { changed: false };
    const daily = W.dailies.find(d => d.id === run.dailyId);
    if (!daily) { finishRun(state, "failed", start); return { changed: true }; }
    if (!run.cleared) run.cleared = [];
    if (!run.skipped) run.skipped = [];
    if (typeof run.visited !== "number") run.visited = 0;
    let events = 0, guard = 0;
    while (guard++ < 10000) {
      if (run.state !== "running") break;
      // 节点试炼：每 tick / 每离线段先轮询引擎（战斗提前打完立即结算，不等 deadline）
      if (run.phase === "node" && run.current) {
        const node = daily.nodes.find(n => n.id === run.current);
        if (node && node.kind !== "treasure") {
          const tp = Math.min(start, run.nextEventAt);
          if (tp >= run.endsAt) { finishRun(state, "failed", tp); break; }   // 24h 超时
          const poll = pollEngineNode(state, run, daily, node, tp);
          events++;
          if (poll.busy) break;
          continue;
        }
      }
      const t = Math.min(start, run.nextEventAt);
      if (start < run.nextEventAt) break;                       // 尚未到下一事件
      if (t >= run.endsAt) { finishRun(state, "failed", t); break; }   // 24h 超时
      if (run.phase === "travel") {
        const node = daily.nodes.find(n => n.id === run.pendingId);
        if (!node) { run.phase = "idle"; advanceCursor(state, run, daily, t); continue; }
        // 手动寻路多跳：中间节点（非最终目标）不停靠，直接继续下一段跃迁
        // （仅 hopTravel 标记的 path；auto 的 buildPath 每一跳都是要打的节点，绝不能穿越）
        const hopIdx = run.path.indexOf(node.id);
        if (run.hopTravel && hopIdx < run.path.length - 1) {
          run.cursor = hopIdx + 1;
          run.pendingId = run.path[run.cursor];
          run.currentStartedAt = t;
          run.nextEventAt = t + travelSeconds(W) * 1000;
          return { changed: true };
        }
        // 最终目标：途经移动 / 出口 / 入口 / 已清节点 → 停靠，不触发试炼；出口无待清节点则通关
        if (run.passThrough || node.kind === "exit" || node.kind === "entry" || run.cleared.indexOf(node.id) >= 0 || run.skipped.indexOf(node.id) >= 0) {
          const wasExit = node.kind === "exit";
          run.passThrough = false;
          run.hopTravel = false;
          run.cursor = Math.max(run.cursor, run.path.indexOf(node.id) + 1);
          run.phase = "idle"; run.current = null; run.pendingId = null;
          run.parkedAt = node.id;
          run.path = [node.id];
          if (wasExit) {
            const remain = daily.nodes.some(n => (n.kind === "trial" || n.kind === "treasure") && run.cleared.indexOf(n.id) < 0 && run.skipped.indexOf(n.id) < 0);
            if (!remain) { finishRun(state, "completed", t); return { changed: true }; }
          }
          return { changed: true };
        }
        // cursor 指向当前节点本身；resolve 后 cursor++ 才移到下一位置（此前 +1 会双跳漏节点）
        run.cursor = Math.max(run.cursor, run.path.indexOf(run.pendingId));
        beginNode(state, run, daily, node, t);
        run.cursor = Math.max(run.cursor, run.path.indexOf(run.current));
      } else if (run.phase === "node") {
        resolveNode(state, run, daily, t);
      } else {
        advanceCursor(state, run, daily, t);
      }
      events++;
    }
    if (run.state !== "running") applyDailyRefreshIfNeeded(state, start);   // run 已了结才刷新每日
    return { changed: events > 0, events };
  }

  /* ---------------- 离线切分边界 ---------------- */
  function getNextBoundaryMs(state) {
    const W = state && state.wormhole;
    if (!W) return null;
    const list = [];
    if (W.run && W.run.state === "running") {
      if (W.run.nextEventAt > 0) list.push(W.run.nextEventAt);
      if (W.run.endsAt > 0) list.push(W.run.endsAt);
    }
    if (W.smeltBuff && W.smeltBuff.expiresAt > 0) list.push(W.smeltBuff.expiresAt);
    if (!list.length) return null;
    return Math.min.apply(null, list);
  }

  function getDailyNodeCounts(state) {
    const W = state && state.wormhole;
    const out = {};
    if (!W) return out;
    for (const d of W.dailies) {
      const c = { battle: 0, battleElite: 0, collection: 0, archaeology: 0 };
      for (const n of d.nodes) {
        if (n.kind !== "trial") continue;
        if (c[n.type] !== undefined) c[n.type]++;
        if (n.type === "battle" && n.tier === "elite") c.battleElite++;
      }
      out[d.id] = c;
    }
    return out;
  }

  /* ---------------- 商店 ---------------- */
  function spendTokens(state, amount) {
    const id = "special:" + CFG.TOKEN_ID;
    if (registryGet(state, id) < amount) return false;
    registrySpend(state, id, amount);
    return true;
  }
  function upgradePrice(W, id) {
    const def = SHOP.upgrades[id]; if (!def) return null;
    const lv = upg(W, id);
    if (lv >= def.max) return null;
    return def.base + def.inc * lv;
  }
  function buyUpgrade(state, id, now) {
    const W = ensure(state);
    const def = SHOP.upgrades[id]; if (!def) return { changed: false, reason: "unknown-upgrade" };
    const price = upgradePrice(W, id);
    if (price === null) return { changed: false, reason: "max-level" };
    if (!spendTokens(state, price)) return { changed: false, reason: "insufficient-tokens" };
    W.upgrades[id] = upg(W, id) + 1; state._dirty = true;
    return { changed: true, level: W.upgrades[id], price };
  }
  function buyItem(state, itemId, param, now) {
    const W = ensure(state); const t = nowMs(now);
    const def = SHOP.items[itemId]; if (!def) return { changed: false, reason: "unknown-item" };
    if (itemId === "reroll") {
      const key = dayKey(t);
      if (W.rerollToday.key !== key) W.rerollToday = { key, count: 0, stock: Math.max(0, Number(W.rerollToday.stock) || 0) };   // 限购计数日切，库存跨日保留
      if (W.rerollToday.count >= def.perDay) return { changed: false, reason: "daily-limit" };
      if (!spendTokens(state, def.price)) return { changed: false, reason: "insufficient-tokens" };
      W.rerollToday.count += 1;
      W.rerollToday.stock += 1;
      state._dirty = true;
      return { changed: true, item: itemId, stock: W.rerollToday.stock };
    }
    if (!spendTokens(state, def.price)) return { changed: false, reason: "insufficient-tokens" };
    state._dirty = true;
    // 其余为"下一次出发"型道具：寄存到 pending
    W.pendingItems = W.pendingItems || {};
    W.pendingItems[itemId] = (W.pendingItems[itemId] || 0) + 1;
    return { changed: true, item: itemId };
  }
  function useReroll(state, now) {
    const W = ensure(state); const t = nowMs(now); const key = dayKey(t);
    if (W.rerollToday.key !== key) W.rerollToday = { key, count: 0, stock: Math.max(0, Number(W.rerollToday.stock) || 0) };   // 限购计数日切，库存跨日保留
    if (!(W.rerollToday.stock > 0)) return { changed: false, reason: "no-reroll-stock" };
    W.rerollToday.stock -= 1;
    generateDailies(state, t);
    state._dirty = true;
    return { changed: true, item: "reroll", stock: W.rerollToday.stock };
  }
  function buyGoods(state, goodsId, param, now) {
    const W = ensure(state); const t = nowMs(now);
    const def = SHOP.goods[goodsId]; if (!def) return { changed: false, reason: "unknown-goods" };
    let price = def.price;
    let licenseChoice = null;
    if (def.licenseFactions) {
      const parts = String(param || "").split("|");
      const faction = parts[0] || ""; const tier = parts[1] || "";
      if (def.licenseFactions.indexOf(faction) < 0 || !def.byTier || !def.byTier[tier]) return { changed: false, reason: param ? "invalid-choice" : "choice-required" };
      price = def.byTier[tier];
      licenseChoice = { faction, tier };
    } else if (def.byTier && param && def.byTier[param]) price = def.byTier[param];
    if (def.byId && param && def.byId[param]) price = def.byId[param];
    if (def.once && W.owned[goodsId]) return { changed: false, reason: "already-owned" };
    if (!spendTokens(state, price)) return { changed: false, reason: "insufficient-tokens" };
    state._dirty = true;
    if (goodsId === "darkPumpBlueprint") {
      W.owned[goodsId] = true;
      const eqId = root.WORMHOLE_DARK_PUMP.equipmentId;
      const keyFn = fn("getEquipmentBlueprintOwnershipKey");
      const hasFn = fn("hasEquipmentBlueprintFromState");
      if (hasFn && hasFn(state, eqId)) { registryAdd(state, "special:" + CFG.TOKEN_ID, price); return { changed: false, reason: "already-owned" }; }
      if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
      state.ownedBlueprints.push(keyFn ? keyFn(eqId) : "equip:" + eqId);
      return { changed: true, granted: "blueprint", equipmentId: eqId };
    }
    if (def.effect === "implant") {
      if (!state.implants) state.implants = {};
      if (state.implants[def.implantId]) { registryAdd(state, "special:" + CFG.TOKEN_ID, price); return { changed: false, reason: "already-owned" }; }
      state.implants[def.implantId] = true;   // 拥有即永久生效（getImplantBonuses 聚合）
      if (def.once) W.owned[goodsId] = true;   // once 语义：从 owned 层拦截二次购买
      state._dirty = true;
      return { changed: true, granted: def.implantId };
    }
    if (def.effect === "smeltBuff") {
      W.smeltBuff = { expiresAt: t + def.hours * 3600000, mult: def.mult };   // 同名只刷新（覆盖）
      return { changed: true };
    }
    if (def.effect === "researchHours") {
      const secs = (Number(def.hours) || 0) * 3600;
      const RS = root.ResearchSystem;
      if (!RS || typeof RS.addResearchHours !== "function") {
        registryAdd(state, "special:" + CFG.TOKEN_ID, price);
        return { changed: false, reason: "research-unavailable" };
      }
      const r = RS.addResearchHours(state, secs);
      if (!r.ok) {
        registryAdd(state, "special:" + CFG.TOKEN_ID, price);
        return { changed: false, reason: r.reason || "grant-failed" };
      }
      return { changed: true, granted: "researchHours", seconds: secs };
    }
    if (goodsId === "catalystPack") { registryAdd(state, root.WORMHOLE_DARK_PUMP.catalystId, def.grant[root.WORMHOLE_DARK_PUMP.catalystId]); return { changed: true }; }
    if (def.grant) { for (const id of Object.keys(def.grant)) registryAdd(state, id, def.grant[id]); return { changed: true }; }
    if (licenseChoice) {
      const resourceId = "special:" + licenseChoice.faction + "装备生产许可" + licenseChoice.tier;
      registryAdd(state, resourceId, 1);
      return { changed: true, granted: resourceId, quantity: 1 };
    }
    if (def.byChoice) {
      const pick = String(param || "");
      const choice = def.byChoice[pick];
      if (!choice) { registryAdd(state, "special:" + CFG.TOKEN_ID, price); return { changed: false, reason: pick ? "invalid-choice" : "choice-required" }; }
      registryAdd(state, pick, Number(choice.qty) || 0);
      return { changed: true, granted: pick, quantity: Number(choice.qty) || 0 };
    }
    if (def.options || def.choose || def.byId || def.byTier) {
      const pick = String(param || "");
      if (!pick) { registryAdd(state, "special:" + CFG.TOKEN_ID, price); return { changed: false, reason: "choice-required" }; }
      if (def.options && def.options.indexOf(pick) < 0) { registryAdd(state, "special:" + CFG.TOKEN_ID, price); return { changed: false, reason: "invalid-choice" }; }
      registryAdd(state, "special:" + pick, def.qty || 1);
      return { changed: true, granted: pick };
    }
    return { changed: true };
  }

  /* ---------------- 放弃 ---------------- */
  // 切换选路模式：auto=系统按遍历/直冲推进；manual=玩家在地图上点选相邻节点（离线不推进）
  function setControl(state, control, now) {
    const W = ensure(state);
    if (control !== "auto" && control !== "manual") return { changed: false, reason: "invalid-control" };
    // run 快照同步必须在 same-control 早退之前：新 run 的 control 取自 W.control，
    // 若早退跳过同步，会出现 W.control=manual 而 run.control=auto 的错位（点击选路报 control-not-manual）
    if (W.run && W.run.state === "running") {
      W.run.control = control;
      // 切手动时打断自动选路造成的跃迁：停在跃迁出发点等待选路（否则玩家点节点永远 in-transit）
      if (control === "manual" && W.run.phase === "travel") {
        const path = W.run.path || [];
        const fromId = (W.run.cleared && W.run.cleared.length) ? W.run.cleared[W.run.cleared.length - 1]
                     : (W.run.parkedAt || W.run.current || (path.length > W.run.cursor - 1 && W.run.cursor > 0 ? path[W.run.cursor - 1] : null));
        W.run.phase = "idle";
        W.run.pendingId = null;
        W.run.current = null;
        W.run.parkedAt = fromId;
        W.run.path = fromId != null ? [fromId] : [];
        W.run.nextEventAt = 0;
      }
    }
    if (W.control === control) return { changed: false, reason: "same-control" };
    W.control = control;
    state._dirty = true;
    return { changed: true, control: control };
  }

  // 手动选路：把游标路径重设为「当前节点 → 目标节点」的最短路（目标须未制压/未跳过/非当前）
  // 纯诊断：不改状态，返回能否设目标及原因（UI 提示 / 排查"点了没反应"）
  function canSetTarget(state, nodeId) {
    const W = ensure(state);
    const run = W.run;
    if (!run || run.state !== "running") return { ok:false, reason:"no-active-run" };
    if (W.control !== "manual") return { ok:false, reason:"control-not-manual（当前为自动推进）" };
    if (run.control !== "manual") return { ok:false, reason:"run.control 未同步" };
    if (run.phase === "travel") return { ok:false, reason:"in-transit（跃迁中）" };
    if (run.phase === "node") return { ok:false, reason:"node-in-progress（当前节点试炼中）" };
    const daily = (W.dailies || []).filter(d => d.id === run.dailyId)[0];
    if (!daily) return { ok:false, reason:"no-daily" };
    const target = daily.nodes.filter(n => n.id === nodeId)[0];
    if (!target) return { ok:false, reason:"invalid-target" };
    if (nodeId === run.current) return { ok:false, reason:"already-current" };
    const parkId = run.parkedAt || run.current;
    const cur = daily.nodes.filter(n => n.id === parkId)[0];
    if (!cur) return { ok:false, reason:"no-current（停靠点丢失）" };
    if ((cur.links || []).indexOf(nodeId) < 0) return { ok:false, reason:"not-adjacent（非停靠点相邻节点）" };
    // 已制压/已跳过节点可作为「途经点」移动（对标星图：已占节点自由穿越）；出口/入口同理
    if (run.cleared.indexOf(nodeId) >= 0 || run.skipped.indexOf(nodeId) >= 0 || target.kind === "entry" || target.kind === "exit") {
      return { ok:true, parkedAt:parkId, targetKind:target.kind, passThrough:true };
    }
    return { ok:true, parkedAt:parkId, targetKind:target.kind };
  }

  // 纯诊断：不改状态，返回能否设目标及原因（UI 提示 / 排查"点了没反应"）
  function canSetTarget(state, nodeId) {
    const W = ensure(state);
    const run = W.run;
    if (!run || run.state !== "running") return { ok:false, reason:"no-active-run" };
    if (W.control !== "manual") return { ok:false, reason:"control-not-manual（当前为自动推进）" };
    if (run.control !== "manual") return { ok:false, reason:"run.control 未同步" };
    if (run.phase === "travel") return { ok:false, reason:"in-transit（跃迁中）" };
    if (run.phase === "node") return { ok:false, reason:"node-in-progress（当前节点试炼中）" };
    const daily = (W.dailies || []).filter(d => d.id === run.dailyId)[0];
    if (!daily) return { ok:false, reason:"no-daily" };
    const target = daily.nodes.filter(n => n.id === nodeId)[0];
    if (!target) return { ok:false, reason:"invalid-target" };
    if (nodeId === run.current) return { ok:false, reason:"already-current" };
    if (run.cleared.indexOf(nodeId) >= 0 || run.skipped.indexOf(nodeId) >= 0) return { ok:false, reason:"already-done" };
    const parkId = run.parkedAt || run.current;
    const cur = daily.nodes.filter(n => n.id === parkId)[0];
    if (!cur) return { ok:false, reason:"no-current（停靠点丢失）" };
    if ((cur.links || []).indexOf(nodeId) < 0) return { ok:false, reason:"not-adjacent（非停靠点相邻节点）" };
    return { ok:true, parkedAt:parkId, targetKind:target.kind };
  }

  // BFS 最短路（图连通由生成时保证，必可达；不可达返回 null）
  function findRouteBFS(daily, fromId, toId) {
    if (fromId === toId) return null;
    const prev = {};
    prev[fromId] = null;
    const queue = [fromId];
    while (queue.length) {
      const curId = queue.shift();
      const node = daily.nodes.find(n => n.id === curId);
      for (const lid of (node.links || [])) {
        if (lid in prev) continue;
        prev[lid] = curId;
        if (lid === toId) {
          const path = [toId];
          let p = curId;
          while (p != null) { path.unshift(p); p = prev[p]; }
          return path.slice(1);   // 去掉起点：纯目标序列
        }
        queue.push(lid);
      }
    }
    return null;
  }

  function setRunTarget(state, nodeId, now) {
    const W = ensure(state);
    const run = W.run;
    if (!run || run.state !== "running") return { changed: false, reason: "no-active-run" };
    if (run.control !== "manual") return { changed: false, reason: "control-not-manual" };
    if (W.control !== "manual") return { changed: false, reason: "control-not-manual" };
    if (run.phase === "travel") return { changed: false, reason: "in-transit" };
    if (run.phase === "node") return { changed: false, reason: "node-in-progress" };   // 当前节点试炼中，不可改目标
    const daily = (W.dailies || []).filter(d => d.id === run.dailyId)[0];
    if (!daily) return { changed: false, reason: "no-daily" };
    if (!nodeId || nodeId === run.current) return { changed: false, reason: "invalid-target" };
    const target = daily.nodes.filter(n => n.id === nodeId)[0];
    if (!target) return { changed: false, reason: "invalid-target" };
    // 途经语义：目标为已制压/已跳过/入口/出口时，到达后停靠继续选路（不触发试炼）
    const passThrough = run.cleared.indexOf(nodeId) >= 0 || run.skipped.indexOf(nodeId) >= 0 || target.kind === "entry" || target.kind === "exit";
    const parkId = run.parkedAt || run.current;
    const cur = daily.nodes.filter(n => n.id === parkId)[0];
    if (!cur) return { changed: false, reason: "no-current" };

    // 自动寻路（对标银河奶牛点哪去哪）：目标不必相邻——BFS 穿越已清区域，逐跳跃迁
    const adjacent = (cur.links || []).indexOf(nodeId) >= 0;
    let hops;
    if (adjacent) {
      hops = [nodeId];
    } else {
      hops = findRouteBFS(daily, parkId, nodeId);
      if (!hops) return { changed: false, reason: "not-reachable（无通路）" };
    }

    const t = nowMs(now);
    run.path = [parkId].concat(hops);          // 游标路径：当前停靠点 → …逐跳… → 目标
    run.cursor = 1;                            // path[0] = 起点（当前所在）
    run.pendingId = hops[0];
    run.phase = "travel";
    run.currentStartedAt = t;
    run.nextEventAt = t + travelSeconds(W) * 1000;
    run.manualPending = true;
    run.passThrough = !!passThrough;
    run.hopTravel = hops.length > 1;          // 手动寻路多跳：中间节点纯穿越（auto 的 path 每跳都要打，绝不能穿越）
    state._dirty = true;
    return { changed: true, target: nodeId, arriveAt: t + hops.length * travelSeconds(W) * 1000, hops: hops.length };
  }

  // 关闭已结束的远征结果（仅清理展示，历史与奖励不受影响）
  function dismissRun(state, now) {
    const W = ensure(state);
    if (!W.run || W.run.state === "running") return { changed: false, reason: "no-finished-run" };
    W.run = null;
    W.activeRunId = null;
    state._dirty = true;
    return { changed: true };
  }
  function abandonRun(state, now) {
    const W = ensure(state);
    if (!W.run || W.run.state !== "running") return { changed: false, reason: "no-active-run" };
    finishRun(state, "aborted", nowMs(now));
    return { changed: true };
  }

  /* ---------------- 视图（UI 只读） ---------------- */
  function getWormholeView(state, now) {
    const W = ensure(state); const t = nowMs(now);
    applyDailyRefreshIfNeeded(state, t);
    return {
      unlocked: isUnlocked(state),
      dailies: W.dailies.map(d => ({
        id: d.id, size: d.size, affixId: d.affixId,
        status: d.status, treasureCount: d.nodes.filter(n => n.kind === "treasure").length,
        nodeCount: d.nodes.filter(n => n.kind === "trial").length
      })),
      run: W.run ? {
        id: W.run.id, dailyId: W.run.dailyId, mode: W.run.mode, state: W.run.state,
        control: W.control || "auto", manualPending: !!W.run.manualPending,
        phase: W.run.phase, endsAt: W.run.endsAt, nextEventAt: W.run.nextEventAt,
        current: W.run.current, pendingId: W.run.pendingId || null, parkedAt: W.run.parkedAt || null, currentStartedAt: W.run.currentStartedAt || 0,
        attempt: W.run.attempt, visited: W.run.visited,
        cleared: W.run.cleared.slice(), skipped: W.run.skipped.slice(), log: (W.run.log || []).slice(-12),
        trial: (root.LEGION_STARMAP_TRIAL && root.LEGION_STARMAP_TRIAL.getTrialStates) ? root.LEGION_STARMAP_TRIAL.getTrialStates(state) : null,
        path: W.run.path.slice(), summary: W.run.summary
      } : null,
      upgrades: W.upgrades, owned: W.owned, tokens: registryGet(state, "special:" + CFG.TOKEN_ID),
      nextRefreshAt: W.nextRefreshAt, history: W.history.slice(0, 5), smeltBuff: W.smeltBuff,
      pendingItems: Object.assign({}, W.pendingItems || {}),
      rerollToday: { key: W.rerollToday.key, count: W.rerollToday.count, stock: W.rerollToday.stock }
    };
  }

  /* ---------------- 导出 ---------------- */
  const API = {
    normalizeWormholeState, applyDailyRefreshIfNeeded, generateDailies,
    canSetTarget,
    isUnlocked, startRun, abandonRun, dismissRun, setControl, setRunTarget, tickWormhole, getNextBoundaryMs, getDailyNodeCounts,
    buyUpgrade, buyItem, useReroll, buyGoods, getWormholeView, getEffectiveTrialNode,
    upgradePrice, travelSeconds, retryLimit, nodeTimeLimit,
    dayKey, nextRefreshAt,
    // 深空开拓研究（虫洞线）真实消费点：research.js 的 RESEARCH_BONUS_CONSUMERS 指向此处
    getWormholeCombatModifiers, getWormholeNodeTimeMultiplier, getWormholeSupplyMultiplier,
    getWormholeTokenMultiplier, getWormholeTokenTotalMultiplier, getWormholeYieldMultiplier,
    maybeAutoPilot,
    getWormholeRepairTimeMultiplier
  };
  root.WORMHOLE = API;
})(typeof window !== "undefined" ? window : globalThis);
