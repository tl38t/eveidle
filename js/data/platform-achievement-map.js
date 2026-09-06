/* ================================================================
   PlatformAchievementMap — 内部成就 ID → 平台成就 ID 映射（只读）

   设计纪律（第一阶段交付决定·六 / ·八）：
   - 内部成就 ID 为稳定主键，绝不随平台改名而变。
   - 映射表键集由 ACHIEVEMENTS 在加载期自动生成，
     因此“映射内部 ID 集合 === ACHIEVEMENTS 集合”由构造保证，
     机器测试只需验证无孤儿键、无缺漏键。
   - taptap / steam 两列分离：未配置（null）→ 运行时跳过同步，绝不上报未确认的 ID。
   - TapTap 仍只接受下方 OVERRIDES 中人工确认的 ID。
   - Steam 成就的确认来源是 achievements.js 的 steam.enabled + apiName；
     enabled 项自动映射为 ACH_XX，未启用项保持 null。
   - G01–G06 为首轮候选（provisional / 非隐藏 / 铜 / 首殖民行星），
     但首轮是否在后台开启由 OVERRIDES + CSV enabled 共同决定。

   本表只读（Object.freeze），运行时代码不得改写条目；要“开启”某成就，
   由开发者在源码 OVERRIDES 填写真实平台 ID，而非运行时修改。
   ================================================================ */
(function (root) {
  "use strict";

  const ACH = (typeof ACHIEVEMENTS !== "undefined") ? ACHIEVEMENTS
    : ((typeof AchievementData !== "undefined" && AchievementData.ACHIEVEMENTS) || (root.AchievementData && root.AchievementData.ACHIEVEMENTS) || []);

  // 已确认的 TapTap ID（Steam ID 由 achievements.js 的 steam 字段自动提供）。
  const OVERRIDES = Object.freeze({
    // "G01": { taptap: "ach_colonize_lava", steam: null },
    // "G02": { taptap: "ach_colonize_gas",  steam: null },
    // "G03": { taptap: "ach_colonize_ice",  steam: null },
    // "G04": { taptap: "ach_colonize_plasma", steam: null },
    // "G05": { taptap: "ach_colonize_temperate", steam: null },
    // "G06": { taptap: "ach_colonize_storm", steam: null },
  });

  // 首轮候选（仅为分组 / 文档用途；运行时是否同步由 OVERRIDES 是否含平台 ID 决定）。
  const FIRST_ROUND = Object.freeze(["G01", "G02", "G03", "G04", "G05", "G06"]);

  function build() {
    const map = {};
    for (let i = 0; i < ACH.length; i++) {
      const a = ACH[i];
      if (!a || !a.id) continue;
      const steam = a.steam && a.steam.enabled && typeof a.steam.apiName === "string"
        ? a.steam.apiName : null;
      map[a.id] = { taptap: null, steam: steam };
    }
    Object.keys(OVERRIDES).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) return; // 防呆：override 引用了不存在的内部 ID
      const o = OVERRIDES[id] || {};
      map[id] = { taptap: o.taptap || null, steam: o.steam || map[id].steam || null };
    });
    return map;
  }

  const MAP = Object.freeze(build());

  const api = Object.freeze({
    FIRST_ROUND: FIRST_ROUND,

    // 取某内部 ID 的平台映射条目；不存在返回 null。
    get: function (internalId) {
      return Object.prototype.hasOwnProperty.call(MAP, internalId) ? MAP[internalId] : null;
    },

    // 是否存在该内部 ID 的映射键（不代表已配置平台 ID）。
    has: function (internalId) {
      return Object.prototype.hasOwnProperty.call(MAP, internalId);
    },

    // 全部内部 ID（顺序同 ACHIEVEMENTS）。
    ids: function () { return Object.keys(MAP); },

    // 全部映射（只读快照）。
    all: function () { return MAP; },

    // 是否已配置至少一个平台 ID（决定是否参与同步）。
    isConfigured: function (internalId) {
      const e = MAP[internalId];
      if (!e) return false;
      return !!(e.taptap || e.steam);
    },

    // 首轮候选 ID 列表。
    firstRound: function () { return FIRST_ROUND.slice(); },

    // 映射键数量（应恒等于 ACHIEVEMENTS.length）。
    count: function () { return Object.keys(MAP).length; }
  });

  root.PlatformAchievementMap = api;
  if (typeof window !== "undefined") window.PlatformAchievementMap = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
