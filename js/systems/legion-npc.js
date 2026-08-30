// ================================================================
// 军团 DLC —— NPC 逻辑与统一接口
// ----------------------------------------------------------------
// 本文件只提供「数据生成」与「文案选择」能力，不实现也不修改：
//   刷新 / 招募 / 工资 / 经验 / 舰船绑定 等核心玩法逻辑。
// 生成候选人与选择台词都不会改动玩家技能、资源或现有存档结构
// （genenerate 仅读取 state.legion 中已有名字用于去重，不写入）；
// getNpcDialogue 仅向 npc.dialogueHistory 追加一条去重记录。
//
// 随机数：默认使用项目既有的 Math.random（cargo / 战斗波次等同机制），
// 也可通过 opts.rng / context.rng 注入（测试用确定性 RNG），
// 不引入任何新的随机系统。
//
// 兼容双环境：浏览器挂 window.LEGION_NPC，Node 下 module.exports。
// ================================================================
(function (root, factory) {
  const deps = (typeof require !== "undefined")
    ? {
        names: require("./../data/legion/npc-names.js"),
        personalities: require("./../data/legion/npc-personalities.js"),
        skillsMod: require("./../data/legion/npc-skills.js"),
        dialogue: require("./../data/legion/npc-dialogue.js")
      }
    : {
        names: root.LEGION_NPC_NAMES,
        personalities: root.LEGION_NPC_PERSONALITIES,
        skillsMod: root.LEGION_NPC_SKILLS,
        dialogue: root.LEGION_NPC_DIALOGUE
      };
  const mod = factory(deps);
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") window.LEGION_NPC = mod;
  else if (root) root.LEGION_NPC = mod;
})(typeof self !== "undefined" ? self : this, function (deps) {
  "use strict";

  const NAMES = deps.names;                       // string[]
  const PERSONALITIES = deps.personalities;       // {personalityId,...}[]
  const SKILLS = deps.skillsMod.SKILLS;           // {id,type,name,category,shipClass,grades,effect}[]
  const GRADE_WEIGHTS = deps.skillsMod.GRADE_WEIGHTS; // {A,B,C,D}
  const DIALOGUE = deps.dialogue;                 // {generic, personality, skillCategory}

  // 12 种触发事件（与需求一致）
  const EVENTS = [
    "recruit", "dailyGreeting", "salaryPaid", "salaryOverdue",
    "shipAssigned", "shipReplaced", "noShip", "incompatibleShip",
    "levelUp", "skillMilestone", "maxLevel", "dismiss"
  ];

  const GRADES = ["A", "B", "C", "D"];

  // —— 索引（O(1) 查表）——
  const SKILL_BY_ID = {};
  SKILLS.forEach(function (s) { SKILL_BY_ID[s.id] = s; });
  const PERSONALITY_BY_ID = {};
  PERSONALITIES.forEach(function (p) { PERSONALITY_BY_ID[p.personalityId] = p; });

  // —— 随机工具（复用注入的 rng，默认 Math.random）——
  function resolveRng(rng) {
    return (typeof rng === "function") ? rng : Math.random;
  }
  function pickFromArray(arr, rng) {
    const r = resolveRng(rng);
    return arr[Math.floor(r() * arr.length)];
  }
  // 按权重对象 {key: weight} 取值
  function pickByWeight(weightMap, rng) {
    const r = resolveRng(rng);
    let total = 0;
    for (const k in weightMap) total += weightMap[k];
    let roll = r() * total;
    for (const k in weightMap) {
      roll -= weightMap[k];
      if (roll < 0) return k;
    }
    // 浮点兜底：返回最后一个键
    const keys = Object.keys(weightMap);
    return keys[keys.length - 1];
  }

  // —— NPC 数据结构工厂（单一事实来源）——
  // 字段：npcId, name, personalityId, skillId, skillGrade,
  //       level(1), xp(0), boundShipInstanceId(null), salaryState("paid"),
  //       dialogueHistory([])
  function createNpc(partial) {
    partial = partial || {};
    return {
      npcId: partial.npcId != null ? partial.npcId : null,
      name: partial.name != null ? partial.name : "",
      personalityId: partial.personalityId != null ? partial.personalityId : null,
      skillId: partial.skillId != null ? partial.skillId : null,
      skillGrade: partial.skillGrade != null ? partial.skillGrade : null,
      level: partial.level != null ? partial.level : 1,
      xp: partial.xp != null ? partial.xp : 0,
      boundShipInstanceId: partial.boundShipInstanceId != null ? partial.boundShipInstanceId : null,
      salaryState: partial.salaryState != null ? partial.salaryState : "paid",
      dialogueHistory: Array.isArray(partial.dialogueHistory) ? partial.dialogueHistory.slice() : [],
      // —— 战斗小队持久化字段（M1，2026-08-29）——
      // 修复状态权威来源在本体：destroyed / repairUntil / combatHp 不随战斗结束清理。
      // 新招募 NPC 恒为默认值；旧档 NPC 由 ensureLegionState 幂等补齐。
      destroyed: partial.destroyed != null ? Boolean(partial.destroyed) : false,
      repairUntil: partial.repairUntil != null ? partial.repairUntil : null,
      occupiedByCombat: partial.occupiedByCombat != null ? Boolean(partial.occupiedByCombat) : false,
      combatHp: normalizeNpcCombatHp(partial.combatHp)
    };
  }

  // combatHp 归一化：{ shield, armor, structure }，非战斗中恒 null（由战斗系统写入临时值）
  function normalizeNpcCombatHp(combatHp) {
    const base = { shield: null, armor: null, structure: null };
    if (!combatHp || typeof combatHp !== "object") return base;
    ["shield", "armor", "structure"].forEach(function (k) {
      base[k] = combatHp[k] != null ? combatHp[k] : null;
    });
    return base;
  }

  // NPC 是否被战斗/修复锁定（解雇、换舰等管理操作共享此口径）：
  //   occupiedByCombat=true → 战斗占用中；destroyed / repairUntil 未到期 → 爆船修复期间。
  // 注意与 legion-combat-squad.getShipCombatLockReason 的舰船锁定口径保持语义一致。
  function isLegionNpcCombatLocked(npc, now) {
    if (!npc) return false;
    if (npc.occupiedByCombat) return true;
    if (npc.destroyed) return true;
    const until = Number(npc.repairUntil);
    if (Number.isFinite(until) && until > (typeof now === "number" && Number.isFinite(now) ? now : Date.now())) return true;
    return false;
  }

  // —— 生成唯一 npcId ——
  function generateNpcId(rng) {
    const r = resolveRng(rng);
    return "npc_" + Date.now().toString(36) + "_" + Math.floor(r() * 0xFFFFFF).toString(36);
  }

  // —— 收集军团内已占用名字（仅读取，不修改 state）——
  function collectTakenNames(state) {
    const taken = new Set();
    if (state && state.legion) {
      const npcs = state.legion.npcs;
      if (Array.isArray(npcs)) npcs.forEach(function (n) { if (n && n.name) taken.add(n.name); });
      const cands = state.legion.candidates;
      if (Array.isArray(cands)) cands.forEach(function (n) { if (n && n.name) taken.add(n.name); });
    }
    return taken;
  }

  // —— 选一个不与已占用集合重复的名字 ——
  function pickUniqueName(rng, takenSet) {
    const r = resolveRng(rng);
    const avail = NAMES.filter(function (n) { return !takenSet.has(n); });
    const pool = avail.length > 0 ? avail : NAMES; // 名字用尽则允许复用
    return pool[Math.floor(r() * pool.length)];
  }

  // —— 等级概率：A5/B15/C30/D50（权重来自数据）——
  function rollNpcSkillGrade(rng, weights) {
    return pickByWeight(weights || GRADE_WEIGHTS, rng);
  }

  // —— 生成一名候选人（默认 level=1, xp=0, 单技能, 未绑舰）——
  // opts: { rng, excludeNames:Set|string[], gradeWeights }
  // 注意：本函数只读 state 去重，不向 state 写入任何内容。
  function generateLegionNpcCandidate(state, opts) {
    opts = opts || {};
    const rng = resolveRng(opts.rng);
    const taken = collectTakenNames(state);
    if (opts.excludeNames) {
      (Array.isArray(opts.excludeNames) ? opts.excludeNames : [opts.excludeNames]).forEach(function (n) {
        if (n) taken.add(n);
      });
    }
    const skill = pickFromArray(SKILLS, rng);
    const grade = rollNpcSkillGrade(rng, opts.gradeWeights || GRADE_WEIGHTS);
    const personality = pickFromArray(PERSONALITIES, rng);
    const name = pickUniqueName(rng, taken);
    return createNpc({
      npcId: generateNpcId(rng),
      name: name,
      personalityId: personality.personalityId,
      skillId: skill.id,
      skillGrade: grade,
      level: 1,
      xp: 0,
      boundShipInstanceId: null,
      dialogueHistory: []
    });
  }

  // —— 生成一批候选人（默认 3 名，批内不重名）——
  function generateLegionNpcCandidates(state, count, opts) {
    count = count || 3;
    opts = opts || {};
    const rng = resolveRng(opts.rng);
    const batch = [];
    const exclude = new Set(opts.excludeNames || []);
    for (let i = 0; i < count; i++) {
      const c = generateLegionNpcCandidate(state, { rng: rng, excludeNames: exclude, gradeWeights: opts.gradeWeights });
      exclude.add(c.name);
      batch.push(c);
    }
    return batch;
  }

  // —— 查表辅助 ——
  function getSkillById(id) { return SKILL_BY_ID[id] || null; }
  function getPersonalityById(id) { return PERSONALITY_BY_ID[id] || null; }
  function getSkillShipClass(skillId) {
    const s = getSkillById(skillId);
    return s ? s.shipClass : null;
  }
  // 舰船大类与技能是否匹配（management 恒为 true）
  function isShipClassCompatible(skillId, shipClass) {
    const required = getSkillShipClass(skillId);
    if (!required) return true;          // 管理类不与舰船挂钩
    if (!shipClass) return false;        // 有要求但无船 → 不匹配
    return required === shipClass;
  }

  // —— 统一文案接口 ——
  // getNpcDialogue(npc, eventType, context)
  //   npc     : 含 personalityId / skillId / dialogueHistory 的 NPC 对象
  //   eventType: 见 EVENTS
  //   context : { rng, now, shipClass }（可选）
  // 返回：{ text, eventType, personalityId, skillId }
  // 行为：
  //   - 按 性格文案 > 技能类别文案 > 通用兜底 顺序选择
  //   - 排除该 NPC 上一条台词，保证「不连续重复」
  //   - 仅向 npc.dialogueHistory 追加记录；不触碰游戏数值/存档结构
  function getNpcDialogue(npc, eventType, context) {
    npc = npc || {};
    context = context || {};
    const rng = resolveRng(context.rng);
    const now = (typeof context.now === "number") ? context.now : Date.now();
    const personalityId = npc.personalityId;
    const skillId = npc.skillId;

    // 1) 候选池（按优先级）
    let pool = [];
    const pLine = DIALOGUE.personality[personalityId] && DIALOGUE.personality[personalityId][eventType];
    if (Array.isArray(pLine) && pLine.length) pool = pLine;
    else {
      const skill = getSkillById(skillId);
      const cat = skill ? skill.category : null;
      const cLine = cat && DIALOGUE.skillCategory[cat] && DIALOGUE.skillCategory[cat][eventType];
      if (Array.isArray(cLine) && cLine.length) pool = cLine;
      else {
        const gLine = DIALOGUE.generic[eventType];
        if (Array.isArray(gLine) && gLine.length) pool = gLine;
      }
    }
    // 2) 兜底：若三级皆空（理论上不会发生），返回空串占位
    if (!pool.length) return { text: "", eventType: eventType, personalityId: personalityId, skillId: skillId };

    // 3) 排除上一条台词，避免连续重复
    const history = Array.isArray(npc.dialogueHistory) ? npc.dialogueHistory : (npc.dialogueHistory = []);
    const lastText = history.length ? history[history.length - 1].text : null;
    let candidates = pool;
    if (lastText != null && pool.length > 1) {
      const filtered = pool.filter(function (t) { return t !== lastText; });
      if (filtered.length) candidates = filtered;
    }
    const text = candidates[Math.floor(rng() * candidates.length)];

    // 4) 记录到 dialogueHistory（仅此一处副作用，且只作用于该 NPC）
    history.push({ eventType: eventType, text: text, ts: now });
    if (history.length > 6) history.splice(0, history.length - 6);

    return { text: text, eventType: eventType, personalityId: personalityId, skillId: skillId };
  }

  // ================================================================
  // 军团 DLC —— NPC 招募 / 贡献 / 工资 / 经验 / 舰船 / 解雇 核心逻辑
  // （本段在原有「数据生成 + 文案」基础上扩展；不修改任何 NPC 数据文件）
  // 货币权威存储：state.resources.isk / lp（与 ResourceRegistry 的 scalarKey 一致）。
  // 舰船实例：state.inventory.ships（含 instanceId / shipId）。
  // 议事大厅等级：state.station.buildings.legion_hall；本体等级：state.station.bodyLevel。
  // 随机数：沿用 resolveRng(rng)（默认 Math.random），禁止引入第二套随机系统。
  // 双环境：以下函数均挂到返回对象，浏览器 window.LEGION_NPC / Node module.exports 均可调用。
  // ================================================================

  // —— 常量 ——
  const CANDIDATE_REFRESH_MS = 4 * 3600 * 1000;   // 候选人自然刷新周期
  const SETTLEMENT_PERIOD_MS = 4 * 3600 * 1000;   // 工资 / 经验结算周期
  const BASE_XP_PER_HOUR = 100;                   // 基础经验 100 XP/小时
  const HOURS_PER_PERIOD = SETTLEMENT_PERIOD_MS / 3600000; // 4
  const CANDIDATE_BATCH_SIZE = 3;                 // 每批候选人数量

  // 招募费用（按技能等级）：ISK / 功勋
  const RECRUIT_COST = {
    A: { isk: 8000000, lp: 200 },
    B: { isk: 4000000, lp: 100 },
    C: { isk: 2000000, lp: 50 },
    D: { isk: 1000000, lp: 25 }
  };
  // 每 4 小时工资（按技能等级）
  const WAGE = { A: 600000, B: 350000, C: 200000, D: 100000 };

  // 手动刷新基础费用与翻倍上限（1/2/4/8/16 倍）
  const MANUAL_REFRESH_BASE = { isk: 1000000, lp: 50 };
  const MANUAL_REFRESH_MAX_MULT = 16;

  // 舰船尺寸阶级 → 经验倍率（按 type 后缀判定）
  const SHIP_TIER_MULT = {
    frigate: 1.0,
    destroyer: 1.25,
    cruiser: 1.6,
    battleship: 2.0,
    capital: 2.5,
    supercapital: 3.0
  };
  // 管理类技能 NPC 的 9 座建筑等级总和 → 经验倍率分段（与 station 管理倍率一致）
  const MANAGEMENT_XP_TIERS = [
    { max: 8,  mult: 0.5 },
    { max: 17, mult: 1.0 },
    { max: 26, mult: 1.5 },
    { max: 35, mult: 2.0 },
    { max: 44, mult: 2.5 },
    { max: 45, mult: 3.0 }
  ];
  const MANAGEMENT_BUILDING_IDS = [
    "resource_dispatch", "planetary_control", "smelting_refinery", "equipment_factory",
    "booster_factory", "archaeology_lab", "combat_command", "shipyard", "legion_hall"
  ];

  // —— 货币读写（直接操作 state.resources，避免对 ResourceRegistry 的硬依赖，Node/浏览器通用）——
  function getCurrency(state, ref) {
    const k = ref === "currency:isk" ? "isk" : ref === "currency:lp" ? "lp" : null;
    if (!k || !state || !state.resources) return 0;
    return Number(state.resources[k]) || 0;
  }
  function spendCurrency(state, ref, amount) {
    const k = ref === "currency:isk" ? "isk" : ref === "currency:lp" ? "lp" : null;
    if (!k || !state || !state.resources) return false;
    const have = Number(state.resources[k]) || 0;
    if (have < amount) return false;
    state.resources[k] = have - amount;
    return true;
  }

  // —— 状态与激活 ——
  function ensureLegionState(state) {
    if (!state) return null;
    if (!state.legion || typeof state.legion !== "object") {
      state.legion = {
        candidates: [], npcs: [], candidateRefreshAt: 0, manualRefreshCount: 0,
        manualRefreshCycleStartedAt: 0, lastSalarySettlementAt: 0, lastXpSettlementAt: 0,
        technologyLevel: 0
      };
    }
    const L = state.legion;
    if (!Array.isArray(L.candidates)) L.candidates = [];
    if (!Array.isArray(L.npcs)) L.npcs = [];
    if (typeof L.candidateRefreshAt !== "number") L.candidateRefreshAt = 0;
    if (typeof L.manualRefreshCount !== "number") L.manualRefreshCount = 0;
    if (typeof L.manualRefreshCycleStartedAt !== "number") L.manualRefreshCycleStartedAt = 0;
    if (typeof L.lastSalarySettlementAt !== "number") L.lastSalarySettlementAt = 0;
    if (typeof L.lastXpSettlementAt !== "number") L.lastXpSettlementAt = 0;
    if (typeof L.technologyLevel !== "number") L.technologyLevel = 0;
    // 战斗小队持久化字段（M1）：旧档 NPC 幂等补默认值（destroyed/repairUntil/occupiedByCombat/combatHp）。
    if (Array.isArray(L.npcs)) L.npcs.forEach(function (n) { if (n && typeof n === "object") ensureNpcCombatFields(n); });
    return L;
  }

  // 单个 NPC 战斗字段幂等归一化（ensureLegionState 内部使用；legion-combat-squad.js 另有等价实现）
  function ensureNpcCombatFields(npc) {
    if (npc.destroyed === undefined) npc.destroyed = false;
    if (npc.repairUntil === undefined) npc.repairUntil = null;
    if (npc.occupiedByCombat === undefined) npc.occupiedByCombat = false;
    if (!npc.combatHp || typeof npc.combatHp !== "object") npc.combatHp = { shield: null, armor: null, structure: null };
    ["shield", "armor", "structure"].forEach(function (k) { if (npc.combatHp[k] === undefined) npc.combatHp[k] = null; });
    return npc;
  }

  function getHallLevel(state) {
    const b = state && state.station && state.station.buildings;
    const v = b && b.legion_hall;
    return (typeof v === "number") ? v : 0;
  }

  // 安全读取研究系统状态层（避免对 research-state.js 的硬依赖）。
  // 缺失时返回 null，调用方据此走安全回退（加成=0）。
  function getResearchStateApi() {
    if (typeof globalThis !== "undefined" && globalThis.ResearchState) return globalThis.ResearchState;
    if (typeof window !== "undefined" && window.ResearchState) return window.ResearchState;
    return null;
  }

  // 激活条件：本体 >= 2 且 议事大厅已建成(等级 >= 1)。DLC 授权门禁：未授权则不激活
  // （不生成候选 / 不结算工资 / 不增加经验 / 不提供军团贡献）。接口缺失时视为放行，避免硬依赖。
  function isLegionSystemActive(state) {
    const bodyLevel = state && state.station ? (state.station.bodyLevel || 0) : 0;
    if (bodyLevel < 2) return false;
    if (getHallLevel(state) < 1) return false;
    if (typeof getStationDlcNpcWorkers === "function" && !getStationDlcNpcWorkers(state)) return false;
    return true;
  }

  function getLegionState(state) { return ensureLegionState(state); }

  function getLegionNpcCount(state) {
    const L = state && state.legion;
    return (L && Array.isArray(L.npcs)) ? L.npcs.length : 0;
  }

  // 总人数上限（含玩家本人）：6 + (大厅等级 - 1) + 研究加成(legionNpcCapacity)，封顶 15。
  // 原 state.legion.technologyLevel 已不提供数值效果（仅为旧档兼容保留字段），
  // 现统一经 ResearchState 读取研究效果。
  function getLegionNpcCapacity(state) {
    const hall = getHallLevel(state);
    const RS = getResearchStateApi();
    const tech = RS ? RS.getResearchBonusRaw(state, "legionNpcCapacity") : 0;
    let cap = 6 + (hall - 1) + (tech || 0);
    if (!Number.isFinite(cap)) cap = 6 + (hall - 1);
    if (cap > 15) cap = 15;
    if (cap < 0) cap = 0;
    return cap;
  }

  // 手动刷新费用（按本周期已刷新次数翻倍，封顶 16 倍）
  function manualRefreshCost(count) {
    const c = Math.max(0, Math.floor(count || 0));
    const mult = Math.min(Math.pow(2, c), MANUAL_REFRESH_MAX_MULT);
    return { isk: MANUAL_REFRESH_BASE.isk * mult, lp: MANUAL_REFRESH_BASE.lp * mult };
  }

  function getLegionCandidateRefreshState(state) {
    const L = ensureLegionState(state);
    return {
      active: isLegionSystemActive(state),
      nextRefreshAt: L.candidateRefreshAt,
      manualRefreshCount: L.manualRefreshCount,
      manualRefreshCycleStartedAt: L.manualRefreshCycleStartedAt,
      candidateCount: L.candidates.length,
      nextManualRefreshCost: manualRefreshCost(L.manualRefreshCount)
    };
  }

  // —— 舰船实例查找 / 销毁 ——
  function findShipInstance(state, instanceId) {
    const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
    for (let i = 0; i < ships.length; i++) if (ships[i] && ships[i].instanceId === instanceId) return ships[i];
    return null;
  }
  function destroyShipInstance(state, instanceId) {
    if (!state || !state.inventory || !Array.isArray(state.inventory.ships)) return false;
    for (let i = 0; i < state.inventory.ships.length; i++) {
      if (state.inventory.ships[i] && state.inventory.ships[i].instanceId === instanceId) {
        state.inventory.ships.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  // 建立 shipId → type 查表（复用既有 SHIP_DATA；浏览器走 window，Node 走导出）
  const SHIP_BY_ID = (function buildShipIndex() {
    const data = (typeof SHIP_DATA !== "undefined") ? SHIP_DATA
      : (typeof require !== "undefined" ? (function () { try { return require("./../data/ships.js").SHIP_DATA; } catch (_) { return null; } })() : null);
    const idx = {};
    if (data) {
      ["STARTER_SHIPS", "INDUSTRIAL_SHIPS", "ARCHAEOLOGY_SHIPS"].forEach(function (key) {
        const coll = data[key];
        if (coll && typeof coll === "object") {
          for (const id in coll) { if (coll[id] && coll[id].type) idx[id] = coll[id].type; }
        }
      });
    }
    return idx;
  })();

  function getShipTypeDef(shipId) { return SHIP_BY_ID[shipId] || null; }
  // 舰船角色（industrial / combat / archaeology）：type 前缀判定
  function getShipRole(type) {
    if (!type) return null;
    if (type.indexOf("industrial") === 0) return "industrial";
    if (type.indexOf("archaeology") === 0) return "archaeology";
    return "combat"; // frigate/destroyer/cruiser/battleship/capital/supercapital
  }
  // 舰船尺寸阶级倍率（type 末尾尺寸词）
  function getShipTierMult(type) {
    const size = type ? type.split("_").pop() : "";
    return SHIP_TIER_MULT[size] != null ? SHIP_TIER_MULT[size] : 0.5;
  }

  // —— 经验倍率 ——
  function getLegionNpcShipXpMultiplier(state, npc) {
    if (!npc) return 0.5;
    const ship = findShipInstance(state, npc.boundShipInstanceId);
    if (!ship || !ship.shipId) return 0.5;          // 无舰船 / 引用不存在 → 0.5
    const type = getShipTypeDef(ship.shipId);
    if (!type) return 0.5;                           // 未知舰船按无舰船
    const tierMult = getShipTierMult(type);
    const skill = getSkillById(npc.skillId);
    if (!skill || !skill.shipClass) return 1.0;      // 管理类：舰船倍率不参与（调用方改用建筑倍率）
    const compatible = (getShipRole(type) === skill.shipClass);
    return compatible ? tierMult : tierMult * 0.5;   // 不相容 → 50% 惩罚
  }

  function getLegionNpcManagementXpMultiplier(state) {
    const b = state && state.station && state.station.buildings;
    let sum = 0;
    for (const id of MANAGEMENT_BUILDING_IDS) {
      const v = (b && typeof b[id] === "number") ? b[id] : 0; // legion_hall 未建成 → 0
      sum += Math.max(0, Math.min(5, v));
    }
    if (sum > 45) sum = 45;
    for (const tier of MANAGEMENT_XP_TIERS) if (sum <= tier.max) return tier.mult;
    return 3.0;
  }

  function getNpcXpMultiplier(state, npc) {
    const skill = getSkillById(npc && npc.skillId);
    if (!skill || !skill.shipClass) return getLegionNpcManagementXpMultiplier(state);
    return getLegionNpcShipXpMultiplier(state, npc);
  }

  // —— 等级 / 经验 ——
  // LVn → LVn+1 所需经验
  function xpCostForLevel(n) { return 100 + 5 * (n - 1); }
  // 等级上限：默认 20；研究加成(legionNpcLevelCap) 每点 +10；最高 70。
  // 原 state.legion.technologyLevel 已不提供数值效果。
  function getLegionNpcLevelCap(state) {
    const RS = getResearchStateApi();
    const tech = RS ? RS.getResearchBonusRaw(state, "legionNpcLevelCap") : 0;
    let cap = 20 + (tech || 0);
    if (!Number.isFinite(cap)) cap = 20;
    if (cap > 70) cap = 70;
    if (cap < 20) cap = 20;
    return cap;
  }
  // NPC 技能原始值（含里程碑强化）：base + floor(level/10) * per
  function getLegionNpcSkillRawValue(npc) {
    const skill = getSkillById(npc && npc.skillId);
    if (!skill) return 0;
    const g = skill.grades && skill.grades[npc.skillGrade];
    if (!g) return 0;
    const milestones = Math.floor((npc.level || 1) / 10);
    return g.base + milestones * g.per;
  }
  function applyLegionNpcXp(npc, gained, cap) {
    if (!(npc.xp >= 0)) npc.xp = 0;
    npc.xp += gained;
    while (npc.level < cap && npc.xp >= xpCostForLevel(npc.level)) {
      npc.xp -= xpCostForLevel(npc.level);
      npc.level += 1;
    }
    if (npc.level >= cap) npc.xp = 0; // 达上限不再累计
  }
  // 研究经验乘子（仅作战学说 legionNpcXp）：1 + 研究加成 fraction。
  // 缺失研究系统或军团未激活时返回 1（即不提供额外加成，安全回退）。
  function getLegionNpcResearchXpMultiplier(state) {
    const RS = getResearchStateApi();
    if (!RS) return 1;
    return 1 + RS.getResearchBonusValue(state, "legionNpcXp");
  }
  // 纯计算：某 NPC 在 hours 内获得的经验（0 表示欠薪/未激活）
  function calculateLegionNpcXp(state, npc, hours, opts) {
    if (!isLegionSystemActive(state)) return 0;
    if (!npc || npc.salaryState !== "paid") return 0; // 仅工资正常时
    const mult = getNpcXpMultiplier(state, npc) * getLegionNpcResearchXpMultiplier(state);
    return BASE_XP_PER_HOUR * (Number(hours) || 0) * mult;
  }

  // —— 候选人刷新 ——
  function refreshLegionNpcCandidates(state, opts) {
    opts = opts || {};
    if (!isLegionSystemActive(state)) return { changed: false, reason: "inactive" };
    const L = ensureLegionState(state);
    const rng = resolveRng(opts.rng);
    const batch = generateLegionNpcCandidates(state, CANDIDATE_BATCH_SIZE, { rng: rng });
    L.candidates = batch;
    const now = (typeof opts.now === "number") ? opts.now : Date.now();
    L.candidateRefreshAt = now + CANDIDATE_REFRESH_MS; // 重新计算下次自然刷新
    L.manualRefreshCount = 0;                          // 自然刷新清零手动次数
    L.manualRefreshCycleStartedAt = now;
    return { changed: true, candidates: batch };
  }

  function manuallyRefreshLegionNpcCandidates(state, opts) {
    opts = opts || {};
    if (!isLegionSystemActive(state)) return { changed: false, reason: "inactive" };
    const L = ensureLegionState(state);
    const cost = manualRefreshCost(L.manualRefreshCount);
    const isk = getCurrency(state, "currency:isk");
    const lp = getCurrency(state, "currency:lp");
    if (isk < cost.isk || lp < cost.lp) return { changed: false, reason: "insufficient" }; // 原子：两种都不足则都不扣
    spendCurrency(state, "currency:isk", cost.isk);
    spendCurrency(state, "currency:lp", cost.lp);
    const rng = resolveRng(opts.rng);
    L.candidates = generateLegionNpcCandidates(state, CANDIDATE_BATCH_SIZE, { rng: rng });
    L.manualRefreshCount += 1;                         // 手动次数 +1
    // 不改变 candidateRefreshAt（自然计时器不受影响）
    return { changed: true, cost: cost, candidates: L.candidates };
  }

  // —— 招募 ——
  function recruitLegionNpc(state, candidateId, opts) {
    opts = opts || {};
    if (!isLegionSystemActive(state)) return { changed: false, reason: "inactive" };
    const L = ensureLegionState(state);
    const candidate = (L.candidates || []).filter(function (c) { return c && c.npcId === candidateId; })[0];
    if (!candidate) return { changed: false, reason: "candidate-not-found" };
    if (getLegionNpcCount(state) >= getLegionNpcCapacity(state) - 1) return { changed: false, reason: "capacity" };
    const grade = candidate.skillGrade;
    const cost = RECRUIT_COST[grade];
    if (!cost) return { changed: false, reason: "invalid-grade" };
    const isk = getCurrency(state, "currency:isk");
    const lp = getCurrency(state, "currency:lp");
    if (isk < cost.isk || lp < cost.lp) return { changed: false, reason: "insufficient" }; // 原子：两种都不足则都不扣
    spendCurrency(state, "currency:isk", cost.isk);
    spendCurrency(state, "currency:lp", cost.lp);
    const npc = createNpc({
      npcId: candidate.npcId,
      name: candidate.name,
      personalityId: candidate.personalityId,
      skillId: candidate.skillId,
      skillGrade: candidate.skillGrade,
      level: 1, xp: 0, boundShipInstanceId: null, salaryState: "paid", dialogueHistory: []
    });
    L.npcs.push(npc);
    L.candidates = (L.candidates || []).filter(function (c) { return c.npcId !== candidateId; }); // 移除该候选人
    return { changed: true, npc: npc };
  }

  // —— 舰船绑定 ——
  function assignLegionNpcShip(state, npcId, shipInstanceId) {
    const L = ensureLegionState(state);
    const npc = (L.npcs || []).filter(function (n) { return n && n.npcId === npcId; })[0];
    if (!npc) return { changed: false, reason: "npc-not-found" };
    // 占用保护（M1）：战斗占用 / 爆船修复期间禁止换舰或卸舰（接口级，非仅 UI 禁用）
    if (isLegionNpcCombatLocked(npc)) return { changed: false, reason: "npc-combat-locked" };

    // 空值/空字符串表示卸下当前舰船（舰船归还机库，不销毁）
    if (shipInstanceId == null || shipInstanceId === "") {
      npc.boundShipInstanceId = null;
      return { changed: true };
    }

    const ship = findShipInstance(state, shipInstanceId);
    if (!ship) return { changed: false, reason: "ship-not-found" };
    const inUse = (L.npcs || []).some(function (n) { return n.npcId !== npcId && n.boundShipInstanceId === shipInstanceId; });
    if (inUse) return { changed: false, reason: "ship-in-use" }; // 已被其他 NPC 绑定
    // 反向保护：该舰船正在作为玩家战斗舰出战，禁止绑给 NPC（避免同一艘船被双方同时占用）。
    const playerCombatId = (state.shipAssignments && state.shipAssignments.combat) || (state.combat && state.combat.activeShip);
    if (playerCombatId === shipInstanceId) return { changed: false, reason: "ship-is-combat" };
    npc.boundShipInstanceId = shipInstanceId;
    // 旧绑定舰船直接解绑归还机库，不再销毁
    return { changed: true };
  }

  // —— 解雇 ——
  function dismissLegionNpc(state, npcId) {
    const L = ensureLegionState(state);
    const idx = (L.npcs || []).findIndex(function (n) { return n && n.npcId === npcId; });
    if (idx < 0) return { changed: false, reason: "npc-not-found" };
    const npc = L.npcs[idx];
    // 占用保护（M1）：战斗占用 / 爆船修复期间禁止解雇（接口级，非仅 UI 禁用）
    if (isLegionNpcCombatLocked(npc)) return { changed: false, reason: "npc-combat-locked" };
    // 解雇仅移除 NPC，绑定舰船归还机库，不再销毁
    L.npcs.splice(idx, 1); // 立即释放人数位置；不返还任何资源
    return { changed: true, npc: npc };
  }

  // —— 工资结算（按 4h 周期逐次结算，在线/离线一致）——
  function settleLegionNpcSalaries(state, opts) {
    opts = opts || {};
    if (!isLegionSystemActive(state)) return { settled: false, reason: "inactive", paidNpcIds: [], overdueNpcIds: [], totalPaid: 0, nextSettlementAt: 0 };
    const L = ensureLegionState(state);
    const now = (typeof opts.now === "number") ? opts.now : Date.now();
    if (L.lastSalarySettlementAt <= 0) {
      L.lastSalarySettlementAt = now; // 首次排程
      return { settled: false, reason: "scheduled", paidNpcIds: [], overdueNpcIds: [], totalPaid: 0, nextSettlementAt: now + SETTLEMENT_PERIOD_MS };
    }
    let periods = 0, totalPaid = 0;
    // 工资减免（薪资统筹技能）必须在「支付前」计算：基于本周期开始时仍 paid 的 NPC 计算，
    // 实际应付 = 原始总工资 × (1 - 减免%)；下限为 0；减免仅影响工资不影响招募价格。
    const reducePct = getLegionWageReductionPct(state);
    while (now >= L.lastSalarySettlementAt + SETTLEMENT_PERIOD_MS) {
      L.lastSalarySettlementAt += SETTLEMENT_PERIOD_MS;
      periods += 1;
      const total = (L.npcs || []).reduce(function (s, n) { return s + (WAGE[n.skillGrade] || 0); }, 0);
      const actual = Math.max(0, total * (1 - reducePct / 100)); // 减免后实际应付（下限 0）
      const isk = getCurrency(state, "currency:isk");
      if (actual >= 0 && isk >= actual) {
        if (actual > 0) spendCurrency(state, "currency:isk", actual); // 一次性扣除实际工资
        (L.npcs || []).forEach(function (n) { n.salaryState = "paid"; });
        totalPaid += actual;
      } else {
        (L.npcs || []).forEach(function (n) { n.salaryState = "overdue"; }); // 星币不足 → 全部欠薪，不扣部分工资
      }
    }
    const paidNpcIds = [], overdueNpcIds = [];
    (L.npcs || []).forEach(function (n) { if (n.salaryState === "paid") paidNpcIds.push(n.npcId); else overdueNpcIds.push(n.npcId); });
    return {
      settled: periods > 0,
      periods: periods,
      paidNpcIds: paidNpcIds,
      overdueNpcIds: overdueNpcIds,
      totalPaid: totalPaid,
      nextSettlementAt: L.lastSalarySettlementAt + SETTLEMENT_PERIOD_MS
    };
  }

  // —— 经验结算（按 4h 周期逐次结算；仅工资正常者获得经验）——
  function settleLegionNpcExperience(state, opts) {
    opts = opts || {};
    if (!isLegionSystemActive(state)) return { settled: false, reason: "inactive", periods: 0, totalXpGained: 0, leveledUpNpcIds: [], milestones: [] };
    const L = ensureLegionState(state);
    const now = (typeof opts.now === "number") ? opts.now : Date.now();
    if (L.lastXpSettlementAt <= 0) {
      L.lastXpSettlementAt = now;
      return { settled: false, reason: "scheduled", periods: 0, totalXpGained: 0, leveledUpNpcIds: [], milestones: [] };
    }
    const cap = getLegionNpcLevelCap(state);
    let periods = 0, totalXp = 0;
    const leveledUpNpcIds = [], milestones = [];
    while (now >= L.lastXpSettlementAt + SETTLEMENT_PERIOD_MS) {
      L.lastXpSettlementAt += SETTLEMENT_PERIOD_MS;
      periods += 1;
      for (const npc of (L.npcs || [])) {
        if (npc.salaryState !== "paid") continue; // 欠薪 → 0 经验
        const gained = calculateLegionNpcXp(state, npc, HOURS_PER_PERIOD, opts);
        totalXp += gained;
        const before = npc.level;
        applyLegionNpcXp(npc, gained, cap);
        if (npc.level > before) {
          leveledUpNpcIds.push(npc.npcId);
          for (let lv = before + 1; lv <= npc.level; lv++) if (lv % 10 === 0) milestones.push({ npcId: npc.npcId, level: lv }); // 每 10 级触发技能强化
        }
      }
    }
    return { settled: periods > 0, periods: periods, totalXpGained: totalXp, leveledUpNpcIds: leveledUpNpcIds, milestones: milestones };
  }

  // —— 技能效果聚合（同类递减；前 5 个完整，第 6 个起 1/(1+0.25*(数量-5))）——
  function sameCategoryDiminishingFactor(rank1Based) {
    if (rank1Based <= 5) return 1;
    return 1 / (1 + 0.25 * (rank1Based - 5));
  }
  function getLegionNpcSkillEffects(state) {
    const L = ensureLegionState(state);
    const categories = { production: 0, combat: 0, archaeology: 0, management: 0 };
    const contributions = [];
    const byCat = { production: [], combat: [], archaeology: [], management: [] };
    (L.npcs || []).forEach(function (n) {
      if (n.salaryState !== "paid") return; // 欠薪不计入
      const sk = getSkillById(n.skillId);
      if (sk && byCat[sk.category]) byCat[sk.category].push(n);
    });
    Object.keys(byCat).forEach(function (cat) {
      byCat[cat].forEach(function (n, idx) {
        const rank = idx + 1;
        const raw = getLegionNpcSkillRawValue(n);
        const factor = sameCategoryDiminishingFactor(rank);
        categories[cat] += raw * factor;
        contributions.push({ npcId: n.npcId, skillId: n.skillId, category: cat, rawValue: raw, factor: factor, effective: raw * factor, counted: true });
      });
    });
    // 欠薪 NPC 也记录（counted:false）
    (L.npcs || []).forEach(function (n) {
      if (n.salaryState === "paid") return;
      const sk = getSkillById(n.skillId);
      if (sk) contributions.push({ npcId: n.npcId, skillId: n.skillId, category: sk.category, rawValue: getLegionNpcSkillRawValue(n), factor: 0, effective: 0, counted: false });
    });
    return { categories: categories, contributions: contributions };
  }

  // ================================================================
  // 军团贡献快照（纯计算，不修改 state）
  // ----------------------------------------------------------------
  // 汇总所有「工资正常」的 NPC 技能效果，按类别递减后映射到对外字段。
  // 字段语义：
  //   - Efficiency/Speed/Manufacturing/Collection/CombatBonus/DefenseBonus：
  //       百分比加成，外部按 (1 + value/100) 用作乘子。
  //   - shipComponentCostReduction / wageReduction / capacitorEfficiency：
  //       百分比减免，外部按 max(不足为 0, 1 - value/100) 用作减免因子（下限 0）。
  //   - combatRareDropBonus / archaeologyRareDropBonus：稀有掉率加成，
  //       外部按 (1 + value/100) 作用于稀有掉落检定（倍率）。
  // 同类(by category)前 5 个完整生效，第 6 个起按 1/(1+0.25*(rank-5)) 递减。
  // ================================================================
  // skill.id → 快照字段 映射（shipEngineering 当前无对应字段：仅占位、不抹平同类递减权重）
  const SKILL_FIELD = {
    mining: "miningEfficiency",
    planetaryIndustry: "planetaryEfficiency",
    refining: "refiningSpeed",
    gasHarvesting: "gasCollectionEfficiency",
    shipEngineering: "shipManufacturingSpeed",
    equipmentEngineering: "equipmentManufacturingSpeed",
    boosterEngineering: "boosterManufacturingSpeed",
    laserOps: "laserCombatBonus",
    cannonOps: "projectileCombatBonus",
    missileOperations: "missileCombatBonus",
    shieldOperation: "shieldDefenseBonus",
    armorReinforcement: "armorDefenseBonus",
    hullEngineering: "hullDefenseBonus",
    capacitorManagement: "capacitorEfficiency",
    lootSearch: "combatRareDropBonus",
    archaeologySpeed: "archaeologySpeed",
    archaeologyLoot: "archaeologyRareDropBonus",
    autolineSpeed: "autolineSpeed",
    shipComponentCostReduce: "shipComponentCostReduction",
    wageReduce: "wageReduction",
    xpGain: "playerNpcXpGain"
  };

  // 缓存：仅在签名变化时重算（招募/解雇/绑定/结算会改变签名）。
  let _snapCache = { sig: "", value: null };
  function getLegionContributionSignature(state) {
    const L = ensureLegionState(state);
    const b = state && state.station ? state.station.buildings : {};
    const sig = [
      (L.technologyLevel || 0),
      (L.npcs || []).map(function (n) {
        return [n.npcId, n.salaryState, n.level, n.skillGrade, n.skillId, n.boundShipInstanceId].join(":");
      }).join("|"),
      MANAGEMENT_BUILDING_IDS.map(function (id) { return b[id] || 0; }).join(",")
    ].join("#");
    return sig;
  }

  function getLegionContributionSnapshot(state) {
    // 未激活（本体/大厅/DLC 任一不满足）→ 不提供任何军团贡献：乘子恒 1、效果恒 0。
    if (!isLegionSystemActive(state)) {
      return {
        activeNpcCount:   0, totalNpcCount: 0,
        skillCounts: { production: 0, combat: 0, archaeology: 0, management: 0 },
        effects: {
          miningEfficiency: 0, planetaryEfficiency: 0, refiningSpeed: 0, gasCollectionEfficiency: 0,
          shipComponentCostReduction: 0, equipmentManufacturingSpeed: 0, boosterManufacturingSpeed: 0,
          shipManufacturingSpeed: 0, laserCombatBonus: 0, projectileCombatBonus: 0, missileCombatBonus: 0,
          shieldDefenseBonus: 0, armorDefenseBonus: 0, hullDefenseBonus: 0, capacitorEfficiency: 0,
          combatRareDropBonus: 0, archaeologySpeed: 0, archaeologyRareDropBonus: 0, autolineSpeed: 0,
          wageReduction: 0, playerNpcXpGain: 0
        },
        multipliers: {
          mining: 1, planetary: 1, refining: 1, gas: 1, equipment: 1, booster: 1, shipManufacturing: 1,
          archaeologySpeed: 1, autoline: 1, laserDamage: 1, projectileDamage: 1, missileDamage: 1,
          shieldHp: 1, armorHp: 1, hullHp: 1, fuelSave: 1, shipComponentCost: 1, combatDrop: 1,
          archaeologyDrop: 1, playerXp: 1
        },
        salary: { totalWage: 0, paidNpcCount: 0, overdueNpcCount: 0 },
        management: { buildingLevelSum: 0, xpMultiplier: 1 }
      };
    }
    const sig = getLegionContributionSignature(state);
    if (_snapCache.sig === sig && _snapCache.value) return _snapCache.value;

    const L = ensureLegionState(state);
    const eff = {
      miningEfficiency: 0, planetaryEfficiency: 0, refiningSpeed: 0, gasCollectionEfficiency: 0,
      shipComponentCostReduction: 0, equipmentManufacturingSpeed: 0, boosterManufacturingSpeed: 0,
      shipManufacturingSpeed: 0,
      laserCombatBonus: 0, projectileCombatBonus: 0, missileCombatBonus: 0,
      shieldDefenseBonus: 0, armorDefenseBonus: 0, hullDefenseBonus: 0,
      capacitorEfficiency: 0, combatRareDropBonus: 0, archaeologySpeed: 0, archaeologyRareDropBonus: 0,
      autolineSpeed: 0, wageReduction: 0, playerNpcXpGain: 0
    };

    const byCat = { production: [], combat: [], archaeology: [], management: [] };
    (L.npcs || []).forEach(function (n) {
      if (n.salaryState !== "paid") return; // 欠薪不计入
      const sk = getSkillById(n.skillId);
      if (sk && byCat[sk.category]) byCat[sk.category].push(n);
    });

    Object.keys(byCat).forEach(function (cat) {
      byCat[cat].forEach(function (n, idx) {
        const rank = idx + 1;
        const raw = getLegionNpcSkillRawValue(n);
        const factor = sameCategoryDiminishingFactor(rank);
        const field = SKILL_FIELD[n.skillId];
        if (field) eff[field] += raw * factor;
      });
    });

    // 工资汇总
    let totalWage = 0, paidNpcCount = 0, overdueNpcCount = 0;
    (L.npcs || []).forEach(function (n) {
      if (n.salaryState === "paid") { paidNpcCount++; totalWage += WAGE[n.skillGrade] || 0; }
      else overdueNpcCount++;
    });

    const buildingLevelSum = (function () {
      const b = state && state.station ? state.station.buildings : {};
      let sum = 0;
      for (const id of MANAGEMENT_BUILDING_IDS) sum += Math.max(0, Math.min(5, (b && typeof b[id] === "number") ? b[id] : 0));
      return Math.min(45, sum);
    })();

    const value = {
      activeNpcCount: paidNpcCount,
      totalNpcCount: (L.npcs || []).length,
      skillCounts: { production: byCat.production.length, combat: byCat.combat.length, archaeology: byCat.archaeology.length, management: byCat.management.length },
      effects: eff,
      salary: { totalWage: totalWage, paidNpcCount: paidNpcCount, overdueNpcCount: overdueNpcCount },
      management: { buildingLevelSum: buildingLevelSum, xpMultiplier: getLegionNpcManagementXpMultiplier(state) },
      // 便捷乘子（供系统直接乘用，避免各自再算）
      multipliers: {
        mining: 1 + eff.miningEfficiency / 100,
        planetary: 1 + eff.planetaryEfficiency / 100,
        refining: 1 + eff.refiningSpeed / 100,
        gas: 1 + eff.gasCollectionEfficiency / 100,
        equipment: 1 + eff.equipmentManufacturingSpeed / 100,
        booster: 1 + eff.boosterManufacturingSpeed / 100,
        shipManufacturing: 1 + eff.shipManufacturingSpeed / 100,
        archaeologySpeed: 1 + eff.archaeologySpeed / 100,
        autoline: 1 + eff.autolineSpeed / 100,
        laserDamage: 1 + eff.laserCombatBonus / 100,
        projectileDamage: 1 + eff.projectileCombatBonus / 100,
        missileDamage: 1 + eff.missileCombatBonus / 100,
        shieldHp: 1 + eff.shieldDefenseBonus / 100,
        armorHp: 1 + eff.armorDefenseBonus / 100,
        hullHp: 1 + eff.hullDefenseBonus / 100,
        fuelSave: Math.max(0, 1 - eff.capacitorEfficiency / 100),
        shipComponentCost: Math.max(0, 1 - eff.shipComponentCostReduction / 100),
        combatDrop: 1 + eff.combatRareDropBonus / 100,
        archaeologyDrop: 1 + eff.archaeologyRareDropBonus / 100,
        playerXp: 1 + eff.playerNpcXpGain / 100
      }
    };
    _snapCache = { sig: sig, value: value };
    return value;
  }

  // 工资减免比例（0..1）：仅在薪资统筹(wageReduce)技能上累加（含同类递减），用于「工资支付前」计算。
  function getLegionWageReductionPct(state) {
    const snap = getLegionContributionSnapshot(state);
    let pct = snap.effects.wageReduction || 0;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct;
  }

  // —— 集成入口（在线 tick / 离线结算统一调用）——
  function tickLegionNpc(state, opts) {
    opts = opts || {};
    if (!isLegionSystemActive(state)) return { active: false };
  const L = ensureLegionState(state);
  const now = (typeof opts.now === "number") ? opts.now : Date.now();
  const rng = resolveRng(opts.rng);
  // 首次激活（candidateRefreshAt 未排程）：立即生成一批候选，避免玩家需空等一个完整周期；
  // 否则仅当计时器到期才刷新。两种路径都走 refreshLegionNpcCandidates，重置计数并排程下次。
  const res = { active: true };
  if (L.candidateRefreshAt <= 0) {
    res.candidates = refreshLegionNpcCandidates(state, { now: now, rng: rng });
  } else if (now >= L.candidateRefreshAt) {
    res.candidates = refreshLegionNpcCandidates(state, { now: now, rng: rng });
  }
  if (L.lastSalarySettlementAt <= 0) L.lastSalarySettlementAt = now;
  if (L.lastXpSettlementAt <= 0) L.lastXpSettlementAt = now;
    res.salaries = settleLegionNpcSalaries(state, { now: now });
    res.experience = settleLegionNpcExperience(state, { now: now });
    return res;
  }

  return {
    // 数据再导出
    NAMES: NAMES,
    PERSONALITIES: PERSONALITIES,
    SKILLS: SKILLS,
    GRADE_WEIGHTS: GRADE_WEIGHTS,
    DIALOGUE: DIALOGUE,
    EVENTS: EVENTS,
    GRADES: GRADES,
    // 工厂 / 生成
    createNpc: createNpc,
    generateNpcId: generateNpcId,
    generateLegionNpcCandidate: generateLegionNpcCandidate,
    generateLegionNpcCandidates: generateLegionNpcCandidates,
    collectTakenNames: collectTakenNames,
    // 查表 / 兼容
    getSkillById: getSkillById,
    getPersonalityById: getPersonalityById,
    getSkillShipClass: getSkillShipClass,
    getShipTypeDef: getShipTypeDef,
    getShipRole: getShipRole,
    isShipClassCompatible: isShipClassCompatible,
    // 随机（可注入）
    rollNpcSkillGrade: rollNpcSkillGrade,
    // 文案接口
    getNpcDialogue: getNpcDialogue,

    // —— 军团 DLC 核心接口（招募 / 贡献 / 工资 / 经验 / 舰船 / 解雇）——
    CANDIDATE_REFRESH_MS: CANDIDATE_REFRESH_MS,
    SETTLEMENT_PERIOD_MS: SETTLEMENT_PERIOD_MS,
    RECRUIT_COST: RECRUIT_COST,
    WAGE: WAGE,
    getLegionState: getLegionState,
    ensureLegionState: ensureLegionState,
    getLegionNpcCount: getLegionNpcCount,
    getLegionNpcCapacity: getLegionNpcCapacity,
    getLegionCandidateRefreshState: getLegionCandidateRefreshState,
    manualRefreshCost: manualRefreshCost,
    refreshLegionNpcCandidates: refreshLegionNpcCandidates,
    manuallyRefreshLegionNpcCandidates: manuallyRefreshLegionNpcCandidates,
    recruitLegionNpc: recruitLegionNpc,
    settleLegionNpcSalaries: settleLegionNpcSalaries,
    calculateLegionNpcXp: calculateLegionNpcXp,
    settleLegionNpcExperience: settleLegionNpcExperience,
    assignLegionNpcShip: assignLegionNpcShip,
    dismissLegionNpc: dismissLegionNpc,
    getLegionNpcSkillEffects: getLegionNpcSkillEffects,
    getLegionContributionSnapshot: getLegionContributionSnapshot,
    getLegionWageReductionPct: getLegionWageReductionPct,
    getLegionNpcManagementXpMultiplier: getLegionNpcManagementXpMultiplier,
    getLegionNpcShipXpMultiplier: getLegionNpcShipXpMultiplier,
    getNpcXpMultiplier: getNpcXpMultiplier,
    getLegionNpcLevelCap: getLegionNpcLevelCap,
    getLegionNpcResearchXpMultiplier: getLegionNpcResearchXpMultiplier,
    getLegionNpcSkillRawValue: getLegionNpcSkillRawValue,
    isLegionNpcCombatLocked: isLegionNpcCombatLocked,
    isLegionSystemActive: isLegionSystemActive,
    getHallLevel: getHallLevel,
    tickLegionNpc: tickLegionNpc
  };
});
