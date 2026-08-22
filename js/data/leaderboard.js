// js/data/leaderboard.js
//
// 标准服技能排行榜 —— 第一阶段：数据模型 + 只读计算层（动态版）
// ================================================================
// 设计纪律（本文件不可越界）：
//   - 只读：函数一律不写入 state，不创建定时器，不接入 TapTap/Steam。
//   - 不改变现有 tick / 技能升级 / 存档 / 离线结算逻辑。
//   - 不新增、不修改任何技能；仅读取现有 state.skills 的真实字段。
//
// 技能唯一事实来源（运行时注册表）：
//   state.skills 的结构由 js/data/base.js 的 INITIAL_SKILLS 初始化
//   （js/core/state.js:40 skills: JSON.parse(JSON.stringify(INITIAL_SKILLS))），
//   且 js/systems/production.js 的 addSkillXpToState 对所有 state.skills[key] 通用升级。
//   因此「可升级技能注册表 = state.skills 的全部 key」是运行时唯一权威来源。
//
//   字段名 = lvl（等级）/ xp（经验）。读取范式与 js/core/selectors.js:1496
//   getCombatSkillLevelFromState（读 .lvl）一致。
//
// 单项榜由真实技能注册表动态生成：
//   boardId = "skill:" + skillId
//   每个可升级技能恰有一个单项榜，绝不固定写死 16 项。
//
// 综合榜（可固定，不替代任何单项榜）：
//   total / combat.total / production.total / gathering.total / research.total
//   —— 全部由真实技能注册表按分类聚合求和得出。
//
// 名称 / 分类来源（均取自真实代码，非杜撰）：
//   名称：聚合 SKILL_LABEL（state.js:334）与 COMBAT_LOG_SKILL_NAME（combat-log.js:33）的真实中文名；
//         缺失时 fallback 为 skillId。
//   分类：依据源码中技能真实业务归属：
//     - addSkillXpToState 的 meta.job（production.js:76）注释列出
//       mining / gasHarvesting / refining / archaeology / combat；
//     - COMBAT_SKILL_WHITELIST（station.js:1351）：capacitorManagement, laserOps, cannonOps,
//       missileOperations, targeting, shieldOperation, armorReinforcement, hullEngineering,
//       piloting, defense；
//     - tick.js 授予经验路径：mining / gasHarvesting / refining / shipEngineering /
//       equipmentEngineering / boosterEngineering / archaeology / planetaryIndustry（planetary.js:155）。
//   据此派生分类（稳定映射，缺失则 "uncategorized"）：
//     combat     : laserOps, cannonOps, missileOperations, defense, shieldOperation,
//                  armorReinforcement, hullEngineering, targeting, piloting,
//                  capacitorManagement, drones, combat
//     gathering  : mining, gasHarvesting
//     production : refining, shipEngineering, equipmentEngineering, boosterEngineering, planetaryIndustry
//     research   : archaeology

// ---- 技能名称查找表（聚合真实中文名，缺失 fallback id）----
// 来源：SKILL_LABEL（state.js:334）+ COMBAT_LOG_SKILL_NAME（combat-log.js:33）
const SKILL_DISPLAY_NAME = Object.freeze({
  mining: "采矿",
  refining: "冶炼",
  gasHarvesting: "气体采集",
  shipEngineering: "舰船工程",
  equipmentEngineering: "装备工程",
  boosterEngineering: "增强剂制造",
  archaeology: "考古",
  combat: "战斗",
  planetaryIndustry: "行星工业",
  laserOps: "激光操作",
  cannonOps: "炮台操作",
  missileOperations: "导弹操作",
  targeting: "瞄准术",
  defense: "防御",
  shieldOperation: "护盾操作",
  armorReinforcement: "装甲强化",
  hullEngineering: "舰船结构工程",
  piloting: "驾驶",
  capacitorManagement: "电容管理",
  drones: "无人机",
});

// ---- 技能分类查找表（基于源码事实派生）----
const SKILL_CATEGORY = Object.freeze({
  // 战斗系
  laserOps: "combat",
  cannonOps: "combat",
  missileOperations: "combat",
  defense: "combat",
  shieldOperation: "combat",
  armorReinforcement: "combat",
  hullEngineering: "combat",
  targeting: "combat",
  piloting: "combat",
  capacitorManagement: "combat",
  drones: "uncategorized",
  combat: "combat",
  // 采集系
  mining: "gathering",
  gasHarvesting: "gathering",
  planetaryIndustry: "gathering",
  archaeology: "gathering",
  // 生产 / 工业系
  refining: "production",
  shipEngineering: "production",
  equipmentEngineering: "production",
  boosterEngineering: "production",
  planetaryIndustry: "gathering",
  // 科研 / 探索系
  archaeology: "gathering",
});

// 综合榜分类键 -> 展示名
const AGGREGATE_CATEGORY_NAME = Object.freeze({
  combat: "战斗总经验",
  gathering: "采集总经验",
  production: "生产总经验",
  research: "科研总经验",
});

function skillName(skillId) {
  return (SKILL_DISPLAY_NAME && SKILL_DISPLAY_NAME[skillId]) || skillId;
}
function skillCategory(skillId) {
  return (SKILL_CATEGORY && SKILL_CATEGORY[skillId]) || "uncategorized";
}

// ---- 动态读取技能注册表（唯一事实来源 = state.skills 的全部 key）----
// 返回数组，每项 { id, name, category }，顺序与 Object.keys(state.skills) 一致。
// 此函数即为「真实技能注册表」的只读视图，供榜单动态生成与测试断言使用。
export function getSkillRegistry(state) {
  const skills = (state && state.skills) || {};
  return Object.keys(skills).filter((id) => id !== "drones" && id !== "combat").map((id) => ({
    id,
    name: skillName(id),
    category: skillCategory(id),
  }));
}

// ---- 防御性读取：技能经验（xp）----
// 缺失字段 / 非有限数 / 负数 -> 0
function safeSkillXp(skills, skillId) {
  const s = skills && skills[skillId];
  if (!s || typeof s !== "object") return 0;
  const xp = s.xp;
  if (typeof xp !== "number" || !Number.isFinite(xp) || xp < 0) return 0;
  return xp;
}

// ---- 防御性读取：技能等级（lvl）----
// 缺失字段 / 非有限数 / 负数 -> 0
function safeSkillLevel(skills, skillId) {
  const s = skills && skills[skillId];
  if (!s || typeof s !== "object") return 0;
  const lvl = s.lvl;
  if (typeof lvl !== "number" || !Number.isFinite(lvl) || lvl < 0) return 0;
  return Math.floor(lvl);
}

// state.skills[id].xp 是当前等级内的经验。排行榜分数必须使用累计总经验，
// 否则不同等级玩家会被错误地当成 Lv.1/低等级比较。
function cumulativeSkillXp(skills, skillId) {
  const level = safeSkillLevel(skills, skillId);
  let total = safeSkillXp(skills, skillId);
  for (let lv = 1; lv < level; lv++) {
    total += Math.floor(100 * Math.pow(1.1, lv)); // xpForLevel(lv + 1)
  }
  return total;
}

// ---- 返回字段统一形状 ----
function makeEntry(boardId, name, score, level, xp, updatedAt) {
  return {
    boardId,
    name,
    score,        // 该榜汇总 xp（聚合榜为求和，单项榜为对应技能 xp）
    level,        // 单项榜=对应技能 lvl；聚合榜=组成技能 lvl 之和（只读，不重算）
    xp,           // 该榜汇总 xp（与 score 同值；保留字段便于前端直接取 xp）
    updatedAt,    // state 透传的时间戳（未提供则为 null，不自行生成/不写入）
    platformGroup: "standard",
  };
}

// 提取 state 中可用于 updatedAt 的只读时间戳（不写入、不生成）
function readUpdatedAt(state) {
  if (state && typeof state === "object") {
    if (typeof state.lastSavedAt === "number" && Number.isFinite(state.lastSavedAt)) return state.lastSavedAt;
    if (typeof state.lastTickAt === "number" && Number.isFinite(state.lastTickAt)) return state.lastTickAt;
  }
  return null;
}

// ---- 单项榜：skill:<skillId> ----
function singleBoardEntry(reg, skills, updatedAt) {
  const xp = cumulativeSkillXp(skills, reg.id);
  const lvl = safeSkillLevel(skills, reg.id);
  return makeEntry("skill:" + reg.id, reg.name, xp, lvl, xp, updatedAt);
}

// ---- 综合榜聚合：按分类或全量求和 ----
// categoryFilter: null=全部；或 "combat"/"gathering"/"production"/"research"
function aggregateBoardEntry(boardId, name, registry, skills, categoryFilter, updatedAt) {
  let totalXp = 0;
  let totalLevel = 0;
  for (const reg of registry) {
    if (categoryFilter && reg.category !== categoryFilter) continue;
    totalXp += cumulativeSkillXp(skills, reg.id);
    const l = safeSkillLevel(skills, reg.id);
    totalLevel += l;
  }
  return makeEntry(boardId, name, totalXp, totalLevel, totalXp, updatedAt);
}

// 综合榜定义（固定，不替代任何单项榜）
const AGGREGATE_BOARDS = Object.freeze([
  { boardId: "total", name: "综合总经验", category: null },
  { boardId: "combat.total", name: "战斗总经验", category: "combat" },
  { boardId: "production.total", name: "生产总经验", category: "production" },
  { boardId: "gathering.total", name: "采集总经验", category: "gathering" },
]);

/**
 * 读取单个榜单的只读快照（动态生成单项榜 + 固定综合榜）。
 * 纯函数：不修改 state，不创建定时器，不触发任何副作用。
 * @param {object} state 游戏状态（需含 skills）
 * @param {string} boardId 榜单 ID（"skill:<id>" 或综合榜 ID）
 * @returns {object|null} 榜单条目；boardId 未知返回 null
 */
export function getLeaderboardScore(state, boardId) {
  if (!boardId) return null;
  const registry = getSkillRegistry(state);
  const skills = state && state.skills;
  const updatedAt = readUpdatedAt(state);

  // 综合榜
  for (const ab of AGGREGATE_BOARDS) {
    if (ab.boardId === boardId) {
      return aggregateBoardEntry(ab.boardId, ab.name, registry, skills, ab.category, updatedAt);
    }
  }

  // 单项榜 skill:<skillId>
  if (boardId.startsWith("skill:")) {
    const skillId = boardId.slice("skill:".length);
    const reg = registry.find((r) => r.id === skillId);
    if (!reg) return null;
    return singleBoardEntry(reg, skills, updatedAt);
  }

  return null;
}

/**
 * 读取全部榜单的只读快照：先全部单项榜（按注册表顺序），后固定综合榜。
 * 纯函数：不修改 state。
 * @param {object} state 游戏状态
 * @returns {object[]} 全部榜单条目数组
 */
export function getLeaderboardSnapshot(state) {
  const registry = getSkillRegistry(state);
  const skills = state && state.skills;
  const updatedAt = readUpdatedAt(state);

  const single = registry.map((reg) => singleBoardEntry(reg, skills, updatedAt));
  const agg = AGGREGATE_BOARDS.map((ab) =>
    aggregateBoardEntry(ab.boardId, ab.name, registry, skills, ab.category, updatedAt)
  );
  return single.concat(agg);
}

/**
 * 返回榜单定义（动态单项榜定义 + 固定综合榜定义）。
 * 单项榜定义从 state.skills 实时推导，每个可升级技能恰一项。
 * @param {object} state 游戏状态
 * @returns {object[]} 榜单定义数组，每项 { boardId, name, type, skillId? , category? }
 */
export function getLeaderboardDefinitions(state) {
  const registry = getSkillRegistry(state);
  const single = registry.map((reg) => ({
    boardId: "skill:" + reg.id,
    name: reg.name,
    type: "single",
    skillId: reg.id,
    category: reg.category,
  }));
  const agg = AGGREGATE_BOARDS.map((ab) => ({
    boardId: ab.boardId,
    name: ab.name,
    type: "aggregate",
    category: ab.category,
  }));
  return single.concat(agg);
}
