// ============================================================================
//  js/core/achievement-state.js
//  成就系统状态层 —— Batch B
//
//  职责（仅本批次）：
//    - 默认成就状态构造 createDefaultAchievementState()
//    - 幂等迁移 migrateAchievementState(state)
//
//  设计约束：
//    - state.achievements.unlockedAtById 是唯一解锁事实来源（single source of truth）。
//      不维护 history / unlockedIds / unlocked 数组等第二套事实来源。
//    - 不保存成就名称、难度、Steam API Name 等目录字段；目录字段始终从
//      AchievementData（js/data/achievements.js，冻结目录）查询。
//    - 不建立 Steam pending/synced/outbox 等同步状态字段。未来 Steam Adapter
//      启动时应遍历 unlockedAtById 做对账（本批不实现 Adapter）。
//    - 迁移不 emit 事件、不设置 gameState._dirty、幂等（连续两次 JSON 严格一致）。
//    - 不根据玩家现有技能/资源/统计补发成就（追溯解锁属于后续 Batch C）。
//
//  依赖：AchievementData 来自 js/data/achievements.js（须先于本文件加载）。
// ============================================================================

'use strict';

(function () {
  function getAchievementData() {
    return (
      (typeof globalThis !== "undefined" && globalThis.AchievementData) ||
      (typeof window !== "undefined" && window.AchievementData) ||
      null
    );
  }

  // -------------------------------------------------------------------------
  // 默认成就状态：每次调用返回全新对象（unlockedAtById 引用绝不共享）。
  // -------------------------------------------------------------------------
  function createDefaultAchievementState() {
    return {
      schemaVersion: 1,
      unlockedAtById: {},
    };
  }

  // -------------------------------------------------------------------------
  // 幂等迁移：
  //   1) state 非对象           → 安全返回，不抛异常
  //   2) achievements 缺失/null/数组/非对象 → 替换为默认结构
  //   3) schemaVersion          → 最终规范为 1
  //   4) unlockedAtById 缺失/数组/非对象 → 规范为空对象
  //   5) 重建干净普通对象：仅保留目录内 ID + 有限且 >=0 的 number 时间戳；
  //      未知 ID、NaN、Infinity、负数、字符串、对象、布尔值全部删除
  //   6) 不补发成就、不 emit、不设置 _dirty
  //   7) 幂等：连续迁移两次 JSON 严格一致
  //   8) 返回传入的根 state
  // -------------------------------------------------------------------------
  function migrateAchievementState(state) {
    if (!state || typeof state !== "object") return state;

    if (!state.achievements || typeof state.achievements !== "object" || Array.isArray(state.achievements)) {
      state.achievements = createDefaultAchievementState();
      return state;
    }

    const a = state.achievements;
    a.schemaVersion = 1;

    if (!a.unlockedAtById || typeof a.unlockedAtById !== "object" || Array.isArray(a.unlockedAtById)) {
      a.unlockedAtById = {};
    }

    const AD = getAchievementData();
    const byId = (AD && AD.ACHIEVEMENTS_BY_ID) || {};

    // 重建干净普通对象（清洗非法键值）
    const clean = {};
    for (const id of Object.keys(a.unlockedAtById)) {
      if (!Object.prototype.hasOwnProperty.call(byId, id)) continue; // 未知 ID 删除
      const ts = a.unlockedAtById[id];
      if (typeof ts !== "number" || !isFinite(ts) || ts < 0) continue; // 非法时间戳删除
      clean[id] = ts;
    }
    a.unlockedAtById = clean;

    return state;
  }

  // -------------------------------------------------------------------------
  // 暴露
  // -------------------------------------------------------------------------
  const AchievementState = {
    createDefaultAchievementState,
    migrateAchievementState,
  };

  if (typeof window !== "undefined") window.AchievementState = AchievementState;
  if (typeof globalThis !== "undefined") globalThis.AchievementState = AchievementState;
})();
