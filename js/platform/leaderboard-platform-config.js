/* ================================================================
   leaderboard-platform-config.js — 排行榜平台配置（仅本地→平台映射）

   职责：
   - 集中维护「本地 boardId」到「TapTap statisticName / leaderboardId」的映射。
   - 提供平台可用性探测、分类归属判定、以及允许上报的榜单白名单。
   - 不包含任何密钥（AppKey / Secret / MasterKey 一律由平台全局对象注入，
     前端代码永不持有）。

   设计纪律：
   - 不修改 state / gameState / eve_idle_save / skills。
   - 不调用 TapTap / Steam 真实 SDK（仅读取 window.tap 是否存在）。
   - 不创建定时器，不发送网络请求。
   - 不新增、不修改任何技能；boardId 集合必须与 js/data/leaderboard.js
     的动态定义完全一致（total + 4 个聚合 + 全部单项技能榜，不含 drones）。
   - 行星工业（planetaryIndustry）与考古（archaeology）一律归属 gathering。

   榜单来源事实：
   - 聚合榜：total / combat.total / production.total / gathering.total / research.total
   - 单项榜：skill:<skillId>，由 getSkillRegistry 动态生成（已排除 drones）
   ================================================================ */
(function (root) {
  "use strict";

  // ---- 聚合榜：本地 boardId -> TapTap leaderboardId（占位符）----
  // 注意：真实 leaderboardId 必须在 TapTap 开发者中心「游戏服务→游戏排行」
  // 创建后获取（文档称「排行榜ID」字符串，非名称），否则上报会返回
  // 500001 leaderboard not found。此处为配置槽位，需运营在后台填真实 ID。
  // 占位符以 "__TAPTAP_" 前缀标记，运行时若仍为此值视为「配置缺失」。
  const TAPTAP_AGGREGATE_IDS = Object.freeze({
    "total": "vytk3eu5abig6xw0q6",
    "combat.total": "7s2dgwj8hilupf7pr1",
    "production.total": "0bt66xkijdhnvc6che",
    "gathering.total": "klyj638vdk1pso8f0q",
  });

  // 单项技能榜的 TapTap leaderboardId 槽位：skill:<id> -> "__TAPTAP_SKILL_<ID>__"
  // 例如 skill:mining -> "__TAPTAP_SKILL_MINING__"。由 provider 在运行时按
  // 实际注册表拼接，故此处仅提供前缀模板。
  const TAPTAP_SKILL_ID_PREFIX = "__TAPTAP_SKILL_";
  const TAPTAP_SKILL_ID_SUFFIX = "__";
  const TAPTAP_PLACEHOLDER_PREFIX = "__TAPTAP_";
  const TAPTAP_SKILL_IDS = Object.freeze({
    mining: "9l17kcflxrc44boydz", gasHarvesting: "0j9hs06srew54zela1",
    planetaryIndustry: "4t657lbat3iotzjzfp", archaeology: "1um5dnl94ubcyepdfg",
    refining: "f0mzbpctntj319uk9n", shipEngineering: "etz2m6s46oqhiw7eux",
    equipmentEngineering: "9colxnch4okjr2g70a", boosterEngineering: "4mdndeib8f262yyjn6",
    laserOps: "7t6a3bg7dm2sq1fccr", cannonOps: "9e32z5afcj3z4zn7qi",
    missileOperations: "lbkcmygnzlk4qh6zgn", defense: "qk3yo4aivh5i603tls",
    shieldOperation: "wq81hx3fbpn6u4s78w", armorReinforcement: "kpwzr7md812nvis3rl",
    hullEngineering: "x7vlwstm4b3wm17zva", targeting: "9daun34embaqm4c4jd",
    piloting: "tlzxua65r0lakrumas", capacitorManagement: "f6sv6ocduxs7a2sbh7",
  });

  // ---- 分类归属（与 js/data/leaderboard.js 一致，且强化约束）----
  // 行星工业 / 考古 明确属于 gathering。
  const SKILL_CATEGORY = Object.freeze({
    mining: "gathering",
    gasHarvesting: "gathering",
    planetaryIndustry: "gathering",
    archaeology: "gathering",
    refining: "production",
    shipEngineering: "production",
    equipmentEngineering: "production",
    boosterEngineering: "production",
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
    combat: "combat",
    drones: "uncategorized", // 永不进入任何上报榜单
  });

  function categoryOf(skillId) {
    return (SKILL_CATEGORY && SKILL_CATEGORY[skillId]) || "uncategorized";
  }

  // 给定本地 boardId，返回 TapTap leaderboardId（聚合走表，单项按前缀拼）。
  // 返回 null 表示该 boardId 不应上报（如 drones / unknown）。
  function resolveTapTapLeaderboardId(boardId) {
    if (!boardId || typeof boardId !== "string") return null;
    if (TAPTAP_AGGREGATE_IDS[boardId]) return TAPTAP_AGGREGATE_IDS[boardId];
    if (boardId.indexOf("skill:") === 0) {
      const skillId = boardId.slice("skill:".length);
      if (!skillId || skillId === "drones") return null; // 绝不报 drones
      if (categoryOf(skillId) === "uncategorized") return null;
      if (TAPTAP_SKILL_IDS[skillId]) return TAPTAP_SKILL_IDS[skillId];
      const up = String(skillId).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      return TAPTAP_SKILL_ID_PREFIX + up + TAPTAP_SKILL_ID_SUFFIX;
    }
    return null;
  }

  // 判断某 boardId 是否允许上报（含在白名单内、且非 drones）：
  // 聚合榜 + 全部真实单项技能榜（drones 除外）。
  function isBoardReportable(boardId) {
    return resolveTapTapLeaderboardId(boardId) !== null;
  }

  // 占位符检测：若 leaderboardId 仍为 "__TAPTAP_..." 占位，说明运营尚未
  // 在开发者中心创建真实榜单，此时 provider 必须返回配置缺失，不得伪造成功。
  function isPlaceholderLeaderboardId(leaderboardId) {
    return typeof leaderboardId === "string" && leaderboardId.indexOf(TAPTAP_PLACEHOLDER_PREFIX) === 0;
  }

  // 平台能力探测（只读，不调用 SDK）：
  //  - 浏览器存在 window.tap 且暴露 getLeaderboardManager 函数 -> 可能可用
  //  - 否则不可用（local-only 回退）
  function detectTapTapAvailable() {
    try {
      const tap = (typeof window !== "undefined") ? window.tap : null;
      if (!tap) return false;
      if (typeof tap.getLeaderboardManager !== "function") return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // 分数安全化：必须是 TapTap 接受的整数（安全整数，向下取整，非负）。
  function sanitizeScore(value) {
    let n = (typeof value === "number") ? value : Number(value);
    if (!Number.isFinite(n)) n = 0;
    if (n < 0) n = 0;
    // 向下取整到整数，并夹在 JS 安全整数范围内（TapTap 分数通常为整数）
    if (n > Number.MAX_SAFE_INTEGER) n = Number.MAX_SAFE_INTEGER;
    return Math.floor(n);
  }

  const api = {
    TAPTAP_AGGREGATE_IDS,
    TAPTAP_SKILL_ID_PREFIX,
    TAPTAP_SKILL_ID_SUFFIX,
    TAPTAP_PLACEHOLDER_PREFIX,
    categoryOf,
    resolveTapTapLeaderboardId,
    isBoardReportable,
    isPlaceholderLeaderboardId,
    detectTapTapAvailable,
    sanitizeScore,
  };

  root.LeaderboardPlatformConfig = api;
  if (typeof window !== "undefined") window.LeaderboardPlatformConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
