// ============================================================================
//  js/systems/achievements.js
//  成就系统解锁内核 —— Batch B + Batch C-1 + Batch C-2
//
//  Batch B 职责（契约不变）：
//    - getAchievementDefinition(achievementId)   目录查询（只读）
//    - isAchievementUnlocked(state, achievementId)   解锁判定（只读）
//    - getAchievementUnlockTime(state, achievementId) 解锁时间（只读）
//    - getUnlockedAchievements(state)            已解锁视图（目录顺序，只读）
//    - unlockAchievement(state, achievementId, atMs)  幂等手动/内部解锁
//
//  Batch C-1 职责（技能类 50 项真实触发与追溯对账）：
//    - evaluateSkillAchievementRules(state, atMs)
//        按 AchievementRuleData.SKILL_RULES 冻结顺序求值；
//        条件只读 state.skills 权威等级（不信任 event.payload.level）；
//        达标只调用现有 unlockAchievement，不复制解锁逻辑；
//        同批解锁使用同一个 atMs；重复求值 unlockedIds=[]。
//    - installSkillAchievementConsumer(state)
//        幂等安装唯一 skill:levelUp 监听（不监听通配符 *）；
//        事件到达后按 event.timestamp 调用 evaluateSkillAchievementRules。
//
//  Batch C-2 职责（采矿工业 18 项真实触发与追溯对账）：
//    - evaluateProductionAchievementRules(state, atMs)
//        按 AchievementRuleData.PRODUCTION_RULES 冻结顺序求值；
//        条件只读 state.statistics 权威累计（不信任 event.payload）；
//        达标只调用现有 unlockAchievement，不复制解锁逻辑。
//    - installProductionAchievementConsumer(state)
//        幂等安装唯一生产事件消费者（严格过滤 mining:completed /
//        refining:completed / gas:completed 三类事件）。
//
//  本批不做：conditionText 解析、其余 130 项规则、进度累计、奖励发放、
//            成就 UI、Steamworks / Steam Adapter / 同步队列、J10/J11/J12。
//
//  事件（平台无关，未来 Steam Adapter 的唯一挂钩点）：
//    首次解锁成功严格 emit 一次：
//      GameEvents.emit("achievement:unlocked",
//        { achievementId, unlockedAt },
//        { timestamp: unlockedAt, source: "achievement-system" })
//    - payload 只含 achievementId、unlockedAt；timestamp 精确等于 unlockedAt。
//    - 重复解锁 / 迁移 / 查询不 emit。
//    - GameEvents 缺失时解锁仍必须成功（不因平台/事件层缺失回滚）。
//
//  dirty 规则：
//    - 只有首次成功解锁设置 state._dirty = true。
//    - UNKNOWN_ACHIEVEMENT / ALREADY_UNLOCKED / INVALID_STATE 不改状态、
//      不设置 dirty、不 emit；查询函数全部纯只读。
//
//  依赖：AchievementData（js/data/achievements.js，冻结目录，须先加载）。
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

  // 状态结构合法性：achievements 存在且 unlockedAtById 是普通对象
  function hasValidAchievementState(state) {
    return !!(
      state && typeof state === "object" &&
      state.achievements && typeof state.achievements === "object" && !Array.isArray(state.achievements) &&
      state.achievements.unlockedAtById && typeof state.achievements.unlockedAtById === "object" &&
      !Array.isArray(state.achievements.unlockedAtById)
    );
  }

  // -------------------------------------------------------------------------
  // 目录查询：未知 ID 返回 null；返回冻结目录原对象引用（不复制不修改）。
  // -------------------------------------------------------------------------
  function getAchievementDefinition(achievementId) {
    const AD = getAchievementData();
    if (!AD || !AD.ACHIEVEMENTS_BY_ID) return null;
    if (!Object.prototype.hasOwnProperty.call(AD.ACHIEVEMENTS_BY_ID, achievementId)) return null;
    return AD.ACHIEVEMENTS_BY_ID[achievementId];
  }

  // -------------------------------------------------------------------------
  // 解锁判定：仅检查 state.achievements.unlockedAtById；严格 boolean；纯只读。
  // -------------------------------------------------------------------------
  function isAchievementUnlocked(state, achievementId) {
    if (!hasValidAchievementState(state)) return false;
    const ts = state.achievements.unlockedAtById[achievementId];
    return typeof ts === "number" && isFinite(ts) && ts >= 0;
  }

  // -------------------------------------------------------------------------
  // 解锁时间：已解锁返回原始毫秒时间戳；未解锁/状态非法返回 null；纯只读。
  // -------------------------------------------------------------------------
  function getAchievementUnlockTime(state, achievementId) {
    if (!hasValidAchievementState(state)) return null;
    const ts = state.achievements.unlockedAtById[achievementId];
    if (typeof ts === "number" && isFinite(ts) && ts >= 0) return ts;
    return null;
  }

  // -------------------------------------------------------------------------
  // 已解锁视图：[{achievement, unlockedAt}]，achievement 为目录原对象引用；
  // 顺序严格按 AchievementData.ACHIEVEMENTS 目录顺序（不按对象键枚举顺序）；
  // 不修改 state 或 AchievementData。
  // -------------------------------------------------------------------------
  function getUnlockedAchievements(state) {
    const out = [];
    if (!hasValidAchievementState(state)) return out;
    const AD = getAchievementData();
    if (!AD || !Array.isArray(AD.ACHIEVEMENTS)) return out;
    const map = state.achievements.unlockedAtById;
    for (const achievement of AD.ACHIEVEMENTS) {
      const ts = map[achievement.id];
      if (typeof ts === "number" && isFinite(ts) && ts >= 0) {
        out.push({ achievement, unlockedAt: ts });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // 幂等解锁：
  //   - state/achievements 结构非法 → {ok:false, reason:"INVALID_STATE"}
  //   - ID 不在目录            → {ok:false, reason:"UNKNOWN_ACHIEVEMENT"}
  //   - 已解锁                 → {ok:false, reason:"ALREADY_UNLOCKED", achievementId, unlockedAt}
  //   - 首次成功               → {ok:true, reason:null, achievementId, unlockedAt}
  //
  //  时间规则：atMs 有限且 >=0 原样使用（允许浮点毫秒，不整数化）；
  //            其余（非数字/非有限/负数）统一使用 Date.now()。
  //  重复解锁不覆盖第一次 unlockedAt。
  // -------------------------------------------------------------------------
  function unlockAchievement(state, achievementId, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const def = getAchievementDefinition(achievementId);
    if (!def) {
      return { ok: false, reason: "UNKNOWN_ACHIEVEMENT" };
    }
    const map = state.achievements.unlockedAtById;
    const prev = map[achievementId];
    if (typeof prev === "number" && isFinite(prev) && prev >= 0) {
      return { ok: false, reason: "ALREADY_UNLOCKED", achievementId, unlockedAt: prev };
    }

    const unlockedAt = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    // 首次成功解锁：写入唯一权威事实 + dirty
    map[achievementId] = unlockedAt;
    state._dirty = true;

    // 平台无关解锁事件（严格一次）；GameEvents 缺失时解锁仍成功、不回滚
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (GE && typeof GE.emit === "function") {
      GE.emit(
        "achievement:unlocked",
        { achievementId, unlockedAt },
        { timestamp: unlockedAt, source: "achievement-system" }
      );
    }

    // Batch E：首次成功解锁 → 直接发放一次性科研工时（不经过事件总线，
    // 因此 GameEvents 缺失时奖励仍能到账）。发放本身幂等且安全失败：
    // 无奖励 / research 缺失 / 账本已有记录都只是返回失败，不影响解锁结果。
    grantAchievementResearchReward(state, achievementId, unlockedAt);

    return { ok: true, reason: null, achievementId, unlockedAt };
  }

  // =========================================================================
  //  Batch C-1：技能规则求值内核
  // =========================================================================

  function getAchievementRuleData() {
    return (
      (typeof globalThis !== "undefined" && globalThis.AchievementRuleData) ||
      (typeof window !== "undefined" && window.AchievementRuleData) ||
      null
    );
  }

  // 技能等级统一读取：仅接受有限数字；缺失/非法（字符串、NaN、Infinity）按未达标处理
  function readSkillLevel(skills, key) {
    const entry = skills[key];
    if (!entry || typeof entry !== "object") return null;
    const lvl = entry.lvl;
    if (typeof lvl !== "number" || !isFinite(lvl)) return null;
    return lvl;
  }

  function skillAtLeast(skills, key, minLevel) {
    const lvl = readSkillLevel(skills, key);
    return lvl !== null && lvl >= minLevel;
  }

  // 单条规则求值（纯只读）；未知类型一律视为未达标
  function isRuleMet(rule, skills, ruleData) {
    if (rule.type === "skill-level") {
      return skillAtLeast(skills, rule.skill, rule.minLevel);
    }
    if (rule.type === "skill-count") {
      let count = 0;
      for (const key of ruleData.ALL_SKILL_KEYS) {
        if (skillAtLeast(skills, key, rule.minLevel)) count++;
      }
      return count >= rule.count;
    }
    if (rule.type === "skill-all") {
      for (const key of rule.keys) {
        if (!skillAtLeast(skills, key, rule.minLevel)) return false;
      }
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // evaluateSkillAchievementRules(state, atMs)
  //   - 条件只从 state.skills 权威等级读取（不信任 event.payload.level）。
  //   - 按 SKILL_RULES 冻结顺序求值；达标只调用现有 unlockAchievement。
  //   - 同一次求值中全部新解锁使用同一个 atMs（atMs 规则沿用 unlockAchievement：
  //     有限且 >=0 原样使用，否则本次求值统一取一次 Date.now()）。
  //   - unlockedIds 只含本次新解锁项；重复求值返回 []；无新解锁不主动 dirty。
  //   - 单次求值中每个成就最多调用一次 unlockAchievement。
  // -------------------------------------------------------------------------
  function evaluateSkillAchievementRules(state, atMs) {
    if (
      !hasValidAchievementState(state) ||
      !state.skills || typeof state.skills !== "object" || Array.isArray(state.skills)
    ) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.SKILL_RULES) || ruleData.SKILL_RULES.length === 0 ||
      !Array.isArray(ruleData.ALL_SKILL_KEYS)
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    // 同批统一时间：合法 atMs 原样（允许浮点），否则本次求值只取一次 Date.now()
    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const skills = state.skills;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.SKILL_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isRuleMet(rule, skills, ruleData)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installSkillAchievementConsumer(state)
  //   - 只监听 skill:levelUp（不注册通配符 *）；同一系统实例最多一个 listener。
  //   - 事件到达后读取 state.skills 权威状态求值（不凭 payload 直接解锁），
  //     时间取 event.timestamp。
  //   - 返回 reason：INVALID_STATE / EVENTS_UNAVAILABLE / ALREADY_INSTALLED / null。
  // -------------------------------------------------------------------------
  let _skillConsumerInstalled = false;

  function installSkillAchievementConsumer(state) {
    if (
      !hasValidAchievementState(state) ||
      !state.skills || typeof state.skills !== "object" || Array.isArray(state.skills)
    ) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_skillConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("skill:levelUp", function (event) {
      // 权威事实是 state.skills 当前等级；payload.level 只作为触发信号
      evaluateSkillAchievementRules(state, event ? event.timestamp : undefined);
    });
    _skillConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // =========================================================================
  //  Batch C-2：采矿工业规则求值内核（B01–B18）
  //
  //  累计事实唯一权威来源：state.statistics（由冻结的 GameStatistics 消费者
  //  维护）。本内核不信任 event.payload 作为累计事实、不自建第二套累计进度。
  // =========================================================================

  // 统计读数统一入口：仅接受有限数字，缺失/非法一律按 0 处理（未达标）
  function readStatNumber(value) {
    return (typeof value === "number" && isFinite(value)) ? value : 0;
  }

  function readStatTotal(statistics, totalKey) {
    if (!statistics.totals || typeof statistics.totals !== "object") return 0;
    return readStatNumber(statistics.totals[totalKey]);
  }

  function readStatBucket(statistics, bucket, resourceId) {
    const production = statistics.production;
    if (!production || typeof production !== "object") return 0;
    const table = production[bucket];
    if (!table || typeof table !== "object") return 0;
    return readStatNumber(table[resourceId]);
  }

  // 单条生产规则求值（纯只读）；未知类型一律视为未达标
  function isProductionRuleMet(rule, statistics) {
    if (rule.type === "production-gathered") {
      return readStatBucket(statistics, "gathered", rule.resourceId) >= rule.minValue;
    }
    if (rule.type === "production-refined") {
      return readStatBucket(statistics, "refined", rule.resourceId) >= rule.minValue;
    }
    if (rule.type === "production-total") {
      return readStatTotal(statistics, rule.totalKey) >= rule.minValue;
    }
    return false;
  }

  // 战斗星带通关读数：仅接受有限数字，缺失/非法一律按 0 处理（未达标）
  function readCombatZoneClears(statistics) {
    if (!statistics.combat || typeof statistics.combat !== "object") return {};
    const zc = statistics.combat.zoneClears;
    return (zc && typeof zc === "object" && !Array.isArray(zc)) ? zc : {};
  }

  // 单条战斗规则求值（纯只读）；未知类型一律视为未达标
  function isCombatRuleMet(rule, statistics) {
    if (rule.type === "combat-zone-clear") {
      const zc = readCombatZoneClears(statistics);
      return readStatNumber(zc[rule.zoneId]) >= rule.minValue;
    }
    if (rule.type === "combat-all-zones") {
      const zc = readCombatZoneClears(statistics);
      // 必须全部 18 个不同 zoneId 均 >= minValue；不得使用 totals.zonesCleared
      const ids = rule.zoneIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      for (const id of ids) {
        if (readStatNumber(zc[id]) < rule.minValue) return false;
      }
      return true;
    }
    // ------ Batch C-11：战斗进阶（E20–E25）四种新类型，只读 statistics.combat 权威累计 ------
    if (rule.type === "combat-max-wave") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      return readStatNumber(combat.maxWaveReached) >= rule.minValue;
    }
    if (rule.type === "combat-weapon-clear") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      const zw = combat.zoneClearsByWeapon;
      if (!zw || typeof zw !== "object" || Array.isArray(zw)) return false;
      return readStatNumber(zw[rule.weaponType]) >= rule.minValue;
    }
    if (rule.type === "combat-capital-kills") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      return readStatNumber(combat.capitalEnemyKills) >= rule.minValue;
    }
    if (rule.type === "combat-supercapital-kills") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      return readStatNumber(combat.supercapitalEnemyKills) >= rule.minValue;
    }
    // ------ Batch C-12：特殊战斗实装（E26/E27/E29–E33），只读 statistics.combat ------
    if (rule.type === "combat-deathspace-enter") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      return readStatNumber(combat.deathspaceEntries) >= rule.minValue;
    }
    if (rule.type === "combat-deathspace-clear-any") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      const ds = combat.deathspaceClears;
      if (!ds || typeof ds !== "object" || Array.isArray(ds)) return false;
      for (const id of Object.keys(ds)) {
        if (readStatNumber(ds[id]) >= rule.minValue) return true;
      }
      return false;
    }
    if (rule.type === "combat-flawless-zone-clear") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      return readStatNumber(combat.flawlessZoneClears) >= rule.minValue;
    }
    if (rule.type === "combat-single-battle-damage") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      return readStatNumber(combat.maxSingleBattleDamage) >= rule.minValue;
    }
    if (rule.type === "combat-faction-boss-kill") {
      const combat = statistics.combat;
      if (!combat || typeof combat !== "object") return false;
      const fbk = combat.factionBossKills;
      if (!fbk || typeof fbk !== "object" || Array.isArray(fbk)) return false;
      return readStatNumber(fbk[rule.faction]) >= rule.minValue;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // evaluateProductionAchievementRules(state, atMs)
  //   - 条件只从 state.statistics 权威累计读取（不信任 event.payload）。
  //   - 按 PRODUCTION_RULES 冻结顺序求值；达标只调用现有 unlockAchievement。
  //   - 同一次求值中全部新解锁使用同一个 atMs（规则沿用 unlockAchievement：
  //     有限且 >=0 原样使用，否则本次求值统一取一次 Date.now()）。
  //   - unlockedIds 只含本次新解锁项；重复求值返回 []；无新解锁不主动 dirty。
  //   - 单次求值中每个成就最多调用一次 unlockAchievement。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function evaluateProductionAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.PRODUCTION_RULES) || ruleData.PRODUCTION_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    // 同批统一时间：合法 atMs 原样（允许浮点），否则本次求值只取一次 Date.now()
    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.PRODUCTION_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isProductionRuleMet(rule, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // evaluateCombatAchievementRules(state, atMs)
  //   - 条件只从 state.statistics.combat 权威累计读取（zoneClears /
  //     maxWaveReached / zoneClearsByWeapon / capitalEnemyKills /
  //     supercapitalEnemyKills；不信任 event.payload）。
  //   - 按 COMBAT_RULES 冻结顺序求值（E01–E18 逐个星带、E19 全星带、
  //     E20 波次、E21–E23 武器通关、E24/E25 旗舰/超旗击杀）；
  //     达标只调用现有 unlockAchievement。
  //   - E19 必须 COMBAT_ZONE_IDS 中全部 18 个不同 zoneId 的通关数均 >= 1
  //     才达标；禁止使用 statistics.totals.zonesCleared（防重复刷同区解锁）。
  //   - 同一次求值中全部新解锁使用同一个 atMs（规则沿用 unlockAchievement：
  //     有限且 >=0 原样使用，否则本次求值统一取一次 Date.now()）。
  //   - unlockedIds 只含本次新解锁项；重复求值返回 []；无新解锁不主动 dirty。
  //   - 单次求值中每个成就最多调用一次 unlockAchievement。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function evaluateCombatAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.COMBAT_RULES) || ruleData.COMBAT_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    // 同批统一时间：合法 atMs 原样（允许浮点），否则本次求值只取一次 Date.now()
    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.COMBAT_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isCombatRuleMet(rule, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installProductionAchievementConsumer(state)
  //   - 逻辑上只消费 mining:completed / refining:completed / gas:completed
  //     三类领域事件（在线与离线共用同一条链路）。
  //   - 注册方式说明（关键实现细节）：冻结的 GameStatistics 消费者注册在
  //     通配符 "*" 上，而 GameEvents.emit 的分发顺序是「具体类型监听先执行、
  //     通配符监听后执行」。若本消费者注册为具体类型监听，将先于
  //     GameStatistics 运行，读到事件累计前的旧统计，导致“首次采集”成就
  //     延迟一个事件才解锁。因此本消费者同样注册在 "*" 上（晚于 statistics
  //     注册、故在通配符列表中排其后运行），并在入口处严格过滤事件类型，
  //     三类领域事件之外的任何事件立即 return，不做任何求值。
  //   - 幂等：独立标志 _productionConsumerInstalled（不占用技能消费者标志），
  //     重复调用返回 ALREADY_INSTALLED，同一系统实例最多安装一个 listener。
  //   - 事件到达后读取 state.statistics 权威累计求值（不凭 payload 解锁），
  //     时间取 event.timestamp。
  //   - 返回 reason：INVALID_STATE / STATISTICS_UNAVAILABLE /
  //     EVENTS_UNAVAILABLE / ALREADY_INSTALLED / null。
  // -------------------------------------------------------------------------
  let _productionConsumerInstalled = false;

  function installProductionAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_productionConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅三类生产领域事件触发求值，其余事件一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      if (t !== "mining:completed" && t !== "refining:completed" && t !== "gas:completed") return;
      // 权威事实是 state.statistics 当前累计；payload 只作为触发信号
      evaluateProductionAchievementRules(state, event.timestamp);
    });
    _productionConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // -------------------------------------------------------------------------
  // installCombatAchievementConsumer(state)
  //   - 逻辑上只消费 combat:zoneCleared / combat:enemyDefeated 两类领域事件
  //     （在线与离线共用同一条链路）。Batch C-11 起 E24/E25（旗舰/超旗击杀）
  //     依赖 combat:enemyDefeated 后的 capitalEnemyKills/supercapitalEnemyKills
  //     即时求值，故过滤器扩展为两类；仍保持单一 "*" 监听、单一消费者。
  //   - 注册方式说明（与 Batch C-2 生产消费者一致的关键实现细节）：
  //     冻结的 GameStatistics 消费者注册在通配符 "*" 上，而 GameEvents.emit 的
  //     分发顺序是「具体类型监听先执行、通配符监听后执行」。若本消费者注册为
  //     具体类型监听，将先于 GameStatistics 运行，读到事件累计前的旧统计，导致
  //     “首次通关”成就延迟一个事件才解锁。因此本消费者同样注册在 "*" 上（晚于
  //     statistics 注册、故在通配符列表中排其后运行），并在入口处严格过滤事件类型，
  //     combat:zoneCleared 之外的任何事件立即 return，不做任何求值。
  //   - 幂等：独立标志 _combatConsumerInstalled（不占用技能/生产消费者标志），
  //     重复调用返回 ALREADY_INSTALLED，同一系统实例最多安装一个 listener。
  //   - 事件到达后读取 state.statistics.combat.zoneClears 权威累计求值
  //     （不凭 payload 解锁），时间取 event.timestamp。
  //   - 返回 reason：INVALID_STATE / STATISTICS_UNAVAILABLE /
  //     EVENTS_UNAVAILABLE / ALREADY_INSTALLED / null。
  // -------------------------------------------------------------------------
  let _combatConsumerInstalled = false;

  function installCombatAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_combatConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅 combat:zoneCleared / combat:enemyDefeated 触发求值，其余事件一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      // Batch C-12：扩展至 5 类战斗事件——通关、击杀、进入死亡空间、通关死亡空间、齐射伤害
      // Batch S：追加 offline:combatSettled（聚合事件），使离线战斗折叠进 state.statistics.combat
      // 后立刻触发成就求值（statistics 通配消费者注册早于本消费者，已先更新权威累计）。
      if (t !== "combat:zoneCleared" && t !== "combat:enemyDefeated" &&
          t !== "combat:deathspaceEntered" && t !== "combat:deathspaceCleared" &&
          t !== "combat:damageDealt" && t !== "offline:combatSettled") return;
      // 权威事实是 state.statistics.combat 当前累计；payload 只作为触发信号
      evaluateCombatAchievementRules(state, event.timestamp);
    });
    _combatConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // =========================================================================
  //  Batch C-4：舰船制造规则求值内核（C01–C10、C12、C13）
  //
  //  累计事实唯一权威来源：state.statistics（由冻结的 GameStatistics 消费者
  //  维护 manufactured[recipeId] 与 totals.shipsBuilt）。本内核不信任
  //  event.payload 作为累计事实、不读 inventory 数量、不自建第二套累计进度。
  // =========================================================================

  // 制造累计读数：仅接受有限数字，缺失/非法一律按 0 处理（未达标）
  function readManufactured(statistics, recipeId) {
    return readStatBucket(statistics, "manufactured", recipeId);
  }

  // 单条制造规则求值（纯只读）；未知类型一律视为未达标
  function isManufacturingRuleMet(rule, statistics) {
    if (rule.type === "manufacturing-recipe-set-any") {
      const ids = rule.recipeIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      for (const id of ids) {
        if (readManufactured(statistics, id) >= rule.minValue) return true;
      }
      return false;
    }
    if (rule.type === "manufacturing-total") {
      return readStatTotal(statistics, rule.totalKey) >= rule.minValue;
    }
    if (rule.type === "manufacturing-recipe") {
      return readManufactured(statistics, rule.recipeId) >= rule.minValue;
    }
    if (rule.type === "manufacturing-recipe-set-total") {
      const ids = rule.recipeIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      let sum = 0;
      for (const id of ids) sum += readManufactured(statistics, id);
      return sum >= rule.minValue;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // evaluateManufacturingAchievementRules(state, atMs)
  //   - 条件只从 state.statistics.production.manufactured[recipeId] 与
  //     state.statistics.totals[totalKey] 权威累计读取（不信任 event.payload）。
  //   - 按 MANUFACTURING_RULES 冻结顺序求值；达标只调用现有 unlockAchievement。
  //   - C01：18 个部件配方任一累计 >=1；C02：totals.shipsBuilt >=1；
  //     C03–C10：对应 recipeId 的 manufactured >=1；C12/C13：分组累计和 >= minValue。
  //   - C12/C13 必须按 recipeIds 分组求和（禁止用 totals.shipsBuilt 代替）。
  //   - 同一次求值中全部新解锁使用同一个 atMs（atMs 规则沿用 unlockAchievement：
  //     有限且 >=0 原样使用，否则本次求值统一取一次 Date.now()）。
  //   - unlockedIds 只含本次新解锁项；重复求值返回 []；无新解锁不主动 dirty。
  //   - 单次求值中每个成就最多调用一次 unlockAchievement。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function evaluateManufacturingAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.MANUFACTURING_RULES) || ruleData.MANUFACTURING_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    // 同批统一时间：合法 atMs 原样（允许浮点），否则本次求值只取一次 Date.now()
    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.MANUFACTURING_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isManufacturingRuleMet(rule, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installManufacturingAchievementConsumer(state)
  //   - 只消费 manufacturing:completed 单一领域事件（在线与离线共用同一条链路）。
  //   - 注册方式说明（与 Batch C-2/C-3 生产/战斗消费者一致的关键实现细节）：
  //     冻结的 GameStatistics 消费者注册在通配符 "*" 上，而 GameEvents.emit 的
  //     分发顺序是「具体类型监听��执行、通配符监听后执行」。本消费者同样注册在
  //     "*" 上（晚于 statistics 注册、故在通配符列表中排其后运行），并在入口处
  //     严格过滤事件类型，manufacturing:completed 之外的任何事件立即 return，
  //     不做任何求值。
  //   - 幂等：独立标志 _manufacturingConsumerInstalled（不占用技能/生产/战斗标志），
  //     重复调用返回 ALREADY_INSTALLED，同一系统实例最多安装一个 listener。
  //   - 事件到达后读取 state.statistics 权威累计求值（不凭 payload 解锁），
  //     时间取 event.timestamp。
  //   - 返回 reason：INVALID_STATE / STATISTICS_UNAVAILABLE /
  //     EVENTS_UNAVAILABLE / ALREADY_INSTALLED / null。
  // -------------------------------------------------------------------------
  let _manufacturingConsumerInstalled = false;

  function installManufacturingAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_manufacturingConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅 manufacturing:completed 触发求值，其余事件一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      if (t !== "manufacturing:completed") return;
      // 权威事实是 state.statistics.production.manufactured 当前累计与 totals.shipsBuilt；
      // payload 只作为触发信号
      evaluateManufacturingAchievementRules(state, event.timestamp);
    });
    _manufacturingConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // -------------------------------------------------------------------------
  // evaluateEquipmentAchievementRules(state, atMs)
  //   - 权威来源：state.statistics.production.manufactured[recipeId] 与
  //     state.statistics.totals.equipmentEnhancementAttempts（不信任 event.payload）。
  //   - D13：NON_RIG_EQUIPMENT_RECIPE_IDS 任一累计 >=1；D14：FUEL 任一 >=1；
  //     D15：AMMUNITION 任一 >=1；D16：equipmentEnhancementAttempts >=1；
  //     D17：RIG_RECIPE_IDS 任一累计 >=1。
  //   - 不读取 inventory、不读装备 enhancementLevel、不用舰船 enhancementAttempts
  //     解锁 D16、不把考古探针算作弹药、不把改装件算作 D13。
  //   - 同批统一 atMs（有限且 >=0 原样，否则本次只取一次 Date.now()）。
  //   - 已解锁不覆盖、不重复调用；无新解锁不 dirty。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function isEquipmentRuleMet(rule, statistics) {
    if (!rule || !statistics || typeof statistics !== "object") return false;
    if (rule.type === "equipment-recipe-set-any") {
      const ids = rule.recipeIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      for (const id of ids) {
        // 与 C-1~C-4 相同的读数清洗：非 number / NaN / ±Infinity 一律按 0 处理
        if (readManufactured(statistics, id) >= rule.minValue) return true;
      }
      return false;
    }
    // Batch C-13：D18 全收集。集合内每一个配方的 manufactured 计数都必须达标。
    // 语义要点：44/45 不解锁；同一个配方造 45 次也不解锁（逐 id 判定，不做求和）；
    // 集合外的"幽灵配方"计数不能补位（只遍历冻结的 rule.recipeIds）。
    if (rule.type === "equipment-recipe-set-all") {
      const ids = rule.recipeIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      for (const id of ids) {
        if (readManufactured(statistics, id) < rule.minValue) return false;
      }
      return true;
    }
    if (rule.type === "equipment-enhancement-total") {
      return readStatTotal(statistics, rule.totalKey) >= rule.minValue;
    }
    return false;
  }

  function evaluateEquipmentAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.EQUIPMENT_RULES) || ruleData.EQUIPMENT_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.EQUIPMENT_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isEquipmentRuleMet(rule, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installEquipmentAchievementConsumer(state)
  //   - 只消费三类事件：manufacturing:completed（普通/离线装备制造）、
  //     equipment:enhancementAttempted（装备强化）、
  //     station:autoLineCompleted 且 payload.lineId==="equipment"（空间站装备自动线）。
  //   - 其余事件立即 return。
  //   - 注册后置 "*"（晚于 statistics 注册），读取更新后的权威统计。
  //   - 独立标志 _equipmentConsumerInstalled；幂等。
  // -------------------------------------------------------------------------
  let _equipmentConsumerInstalled = false;

  function installEquipmentAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_equipmentConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅三类事件触发装备成就求值，其余一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      if (t === "manufacturing:completed") {
        evaluateEquipmentAchievementRules(state, event.timestamp);
        return;
      }
      if (t === "equipment:enhancementAttempted") {
        evaluateEquipmentAchievementRules(state, event.timestamp);
        return;
      }
      if (t === "station:autoLineCompleted") {
        const payload = event.payload;
        if (payload && payload.lineId === "equipment") {
          evaluateEquipmentAchievementRules(state, event.timestamp);
        }
        return;
      }
      // 其余事件一律忽略
    });
    _equipmentConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // -------------------------------------------------------------------------
  // evaluateBoosterAchievementRules(state, atMs)
  //   - 权威来源：state.statistics.production.boosters[recipeId] 与
  //     state.statistics.totals.boostersManufactured（不信任 event.payload、
  //     不读 inventory、不读 currentAction）。
  //   - D01–D10：对应传奇配方 production.boosters[recipeId] >=1；
  //     D11：totals.boostersManufactured >=1；
  //     D12：totals.boostersManufactured >=1000。
  //   - 同批统一 atMs（有限且 >=0 原样，否则本次只取一次 Date.now()）。
  //   - 已解锁不覆盖、不重复调用；无新解锁不 dirty。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function readBoosterBucket(statistics, recipeId) {
    // boosters 子统计：仅接受有限数字，缺失/非法一律按 0 处理
    const map = statistics && statistics.production && statistics.production.boosters;
    if (!map || typeof map !== "object") return 0;
    const v = map[recipeId];
    return (typeof v === "number" && isFinite(v) && v >= 0) ? v : 0;
  }

  function isBoosterRuleMet(rule, statistics) {
    if (!rule || !statistics || typeof statistics !== "object") return false;
    if (rule.type === "booster-recipe") {
      return readBoosterBucket(statistics, rule.recipeId) >= rule.minValue;
    }
    if (rule.type === "booster-total") {
      return readStatTotal(statistics, rule.totalKey) >= rule.minValue;
    }
    return false;
  }

  function evaluateBoosterAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.BOOSTER_RULES) || ruleData.BOOSTER_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.BOOSTER_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isBoosterRuleMet(rule, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installBoosterAchievementConsumer(state)
  //   - 只消费两类事件：booster:manufactured（在线/空间站）、
  //     boosters:manufactured（离线聚合）。
  //   - 其余事件立即 return。
  //   - 注册后置 "*"（晚于 statistics 注册），读取更新后的权威统计。
  //   - 独立标志 _boosterConsumerInstalled；幂等。
  // -------------------------------------------------------------------------
  let _boosterConsumerInstalled = false;

  function installBoosterAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_boosterConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅两类增幅剂制造事件触发求值，其余一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      if (t === "booster:manufactured" || t === "boosters:manufactured") {
        evaluateBoosterAchievementRules(state, event.timestamp);
        return;
      }
      // 其余事件一律忽略
    });
    _boosterConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // -------------------------------------------------------------------------
  // evaluateArchaeologyAchievementRules(state, atMs)
  //   - 权威来源：state.statistics.totals（archaeologyAttempts / artifactsSold /
  //     archaeologyLpEarned / archaeologyRareFinds）与
  //     state.statistics.archaeology.sites / archaeology.tiers
  //     （不信任 event.payload、不读 inventory、不读 currentAction）。
  //   - F01 尝试>=1；F02–F16 各站点成功>=1；F17 五档各成功>=1；
  //     F18 出售>=1；F19 出售>=100；F20 考古LP>=10000；F21 稀有掉落>=1。
  //   - 同批统一 atMs（有限且 >=0 原样，否则本次只取一次 Date.now()）。
  //   - 已解锁不覆盖、不重复调用；无新解锁不 dirty。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function readArchaeologyBucket(statistics, mapKey, entryKey) {
    // archaeology 子统计（sites/tiers）：仅接受有限非负数字，缺失/非法一律按 0 处理
    const root = statistics && statistics.archaeology;
    if (!root || typeof root !== "object") return 0;
    const map = root[mapKey];
    if (!map || typeof map !== "object") return 0;
    const v = map[entryKey];
    return (typeof v === "number" && isFinite(v) && v >= 0) ? v : 0;
  }

  function isArchaeologyRuleMet(rule, statistics) {
    if (!rule || !statistics || typeof statistics !== "object") return false;
    if (rule.type === "archaeology-total") {
      return readStatTotal(statistics, rule.totalKey) >= rule.minValue;
    }
    if (rule.type === "archaeology-site") {
      return readArchaeologyBucket(statistics, "sites", rule.siteId) >= rule.minValue;
    }
    if (rule.type === "archaeology-tier-set") {
      if (!Array.isArray(rule.tierKeys) || rule.tierKeys.length === 0) return false;
      for (const tierKey of rule.tierKeys) {
        if (readArchaeologyBucket(statistics, "tiers", tierKey) < rule.minValue) return false;
      }
      return true;
    }
    return false;
  }

  function evaluateArchaeologyAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.ARCHAEOLOGY_RULES) || ruleData.ARCHAEOLOGY_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.ARCHAEOLOGY_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isArchaeologyRuleMet(rule, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installArchaeologyAchievementConsumer(state)
  //   - 只消费六类真实考古事件：archaeology:attemptCompleted、archaeology:success、
  //     archaeology:artifactFound、archaeology:artifactsSold / artifactSold、
  //     archaeology:artifactsRedeemed / artifactRedeemed。
  //   - 其余事件立即 return（station:archaeologyBonusTriggered 不消费，避免双计数）。
  //   - 注册后置 "*"（晚于 statistics 注册），读取更新后的权威统计。
  //   - 独立标志 _archaeologyConsumerInstalled；幂等。
  // -------------------------------------------------------------------------
  let _archaeologyConsumerInstalled = false;

  function installArchaeologyAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_archaeologyConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅真实考古事件触发考古成就求值，其余一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      if (t === "archaeology:attemptCompleted" ||
          t === "archaeology:success" ||
          t === "archaeology:artifactFound" ||
          t === "archaeology:artifactsSold" ||
          t === "archaeology:artifactSold" ||
          t === "archaeology:artifactsRedeemed" ||
          t === "archaeology:artifactRedeemed") {
        evaluateArchaeologyAchievementRules(state, event.timestamp);
        return;
      }
      // 其余事件一律忽略
    });
    _archaeologyConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // -------------------------------------------------------------------------
  // evaluatePlanetaryAchievementRules(state, atMs)
  //   - 权威来源：state.statistics.planetary（deployedTypes / maxConcurrentDeployments）、
  //     state.statistics.totals.planetaryUnits，以及真实 getPlanetaryCapacityState(state)（slots/maxSlots）。
  //   - 不信任事件 payload；statistics 深度只读；G10 读真实 capacity（不写死技能等级）。
  //   - G01–G06 各类型首次殖民；G07 同时运营>=5；G09 累计产出>=1,000,000；G10 slots>=maxSlots。
  //   - 同批统一 atMs（有限且 >=0 原样，否则本次只取一次 Date.now()）。
  //   - 已解锁不覆盖、不重复调用；无新解锁不 dirty。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function readPlanetaryNumber(statistics, key) {
    const root = statistics && statistics.planetary;
    if (!root || typeof root !== "object") return 0;
    const v = root[key];
    return (typeof v === "number" && isFinite(v) && v >= 0) ? v : 0;
  }

  function isPlanetaryRuleMet(rule, state, statistics) {
    if (!rule || !state || !statistics || typeof statistics !== "object") return false;
    if (rule.type === "planetary-colonized") {
      const v = readPlanetaryNumber(statistics, "deployedTypes");
      const dv = (statistics.planetary && statistics.planetary.deployedTypes) ? statistics.planetary.deployedTypes[rule.planetType] : undefined;
      return (typeof dv === "number" && isFinite(dv) && dv >= 0) ? dv >= rule.minValue : false;
    }
    if (rule.type === "planetary-concurrent") {
      return readPlanetaryNumber(statistics, "maxConcurrentDeployments") >= rule.minValue;
    }
    if (rule.type === "planetary-total") {
      return readStatTotal(statistics, rule.totalKey) >= rule.minValue;
    }
    if (rule.type === "planetary-slots") {
      // 真实读取 getPlanetaryCapacityState(state)：slots >= maxSlots（不写死技能等级；
      // 空间站 planetary_control 加成也可能提供槽位）。不修改 state。
      if (typeof getPlanetaryCapacityState !== "function") return false;
      const cap = getPlanetaryCapacityState(state);
      if (!cap || typeof cap.slots !== "number" || typeof cap.maxSlots !== "number") return false;
      return cap.slots >= cap.maxSlots;
    }
    return false;
  }

  function evaluatePlanetaryAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.PLANETARY_RULES) || ruleData.PLANETARY_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.PLANETARY_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isPlanetaryRuleMet(rule, state, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installPlanetaryAchievementConsumer(state)
  //   - 只消费真实事件：planetary:deployed（首次殖民/并发）、planetary:completed（累计产出）、
  //     skill:levelUp（planetaryIndustry 升级可能改变槽位）、station:constructionCompleted /
  //     station:buildingUpgraded（planetary_control 建成/升级可能改变槽位）。
  //   - 其余事件立即 return（不监听伪造事件）。
  //   - 注册后置 "*"（晚于 statistics 注册），读取更新后的权威统计。
  //   - 独立标志 _planetaryConsumerInstalled；幂等。
  // -------------------------------------------------------------------------
  let _planetaryConsumerInstalled = false;

  function installPlanetaryAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_planetaryConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅真实行星/槽位相关事件触发成就求值，其余一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      if (t === "planetary:deployed" || t === "planetary:completed" ||
          t === "skill:levelUp" ||
          t === "station:constructionCompleted" || t === "station:buildingUpgraded") {
        evaluatePlanetaryAchievementRules(state, event.timestamp);
        return;
      }
      // 其余事件一律忽略
    });
    _planetaryConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // -------------------------------------------------------------------------
  // Batch C-9 空间站类（H01–H13、H15、H16，共 15 项）
  //   - 只读 state.station（本体/建筑等级）与 state.statistics.station（三统计字段）；
  //   - H13 只调用真实 getStationLogisticsMultiplier(state)（断油/未运行倍率为 1，
  //     不得仅看 bodyLevel === 3）；
  //   - H15 严格大于（> 28800）：28800 不解锁、28801 解锁；
  //   - 不读事件 payload、不解析 conditionText、不修改 state.station / statistics。
  // -------------------------------------------------------------------------
  function isStationRuleMet(rule, state, statistics) {
    if (!rule || typeof rule !== "object") return false;
    if (rule.type === "station-body-level") {
      const st = state.station;
      if (!st || typeof st !== "object") return false;
      const lv = st.bodyLevel;
      return typeof lv === "number" && isFinite(lv) && lv >= rule.minValue;
    }
    if (rule.type === "station-building-level") {
      const st = state.station;
      if (!st || typeof st !== "object" || !st.buildings || typeof st.buildings !== "object") return false;
      const lv = st.buildings[rule.buildingId];
      return typeof lv === "number" && isFinite(lv) && lv >= rule.minValue;
    }
    if (rule.type === "station-stat") {
      const stStats = statistics.station;
      if (!stStats || typeof stStats !== "object") return false;
      const v = stStats[rule.statKey];
      return typeof v === "number" && isFinite(v) && v >= rule.minValue;
    }
    if (rule.type === "station-logistics-multiplier") {
      // 真实物流倍率：只调 getStationLogisticsMultiplier(state)。断油/未运行时该函数返回 1，
      // 天然不满足 >= 1.03；不允许退化为 bodyLevel 判断。不修改 state。
      if (typeof getStationLogisticsMultiplier !== "function") return false;
      const mult = getStationLogisticsMultiplier(state);
      return typeof mult === "number" && isFinite(mult) && mult >= rule.minValue;
    }
    if (rule.type === "station-offline-exceeds") {
      // 严格大于：settledSeconds 恰为 exceedsValue（28800）时不解锁。
      const stStats = statistics.station;
      if (!stStats || typeof stStats !== "object") return false;
      const v = stStats[rule.statKey];
      return typeof v === "number" && isFinite(v) && v > rule.exceedsValue;
    }
    return false;
  }

  function evaluateStationAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.STATION_RULES) || ruleData.STATION_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.STATION_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isStationRuleMet(rule, state, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installStationAchievementConsumer(state)
  //   - 严格只消费四类真实事件：station:constructionCompleted（H01/H02/H03–H10/H11/H16）、
  //     station:autoLineStarted（H12）、station:maintenanceRefilled（H13 补油后物流倍率恢复）、
  //     offline:settlementCompleted（H15）。
  //   - 其余事件立即 return（不监听伪造事件、不从 station:autoLineCompleted 推断并发）。
  //   - 注册后置 "*"（晚于 statistics 注册），读取更新后的权威统计。
  //   - 独立标志 _stationConsumerInstalled；幂等。
  // -------------------------------------------------------------------------
  let _stationConsumerInstalled = false;

  function installStationAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_stationConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("*", function (event) {
      // 严格类型过滤：仅四类真实空间站/离线结算事件触发成就求值，其余一律忽略
      if (!event || typeof event !== "object") return;
      const t = event.type;
      if (t === "station:constructionCompleted" || t === "station:autoLineStarted" ||
          t === "station:maintenanceRefilled" || t === "offline:settlementCompleted") {
        evaluateStationAchievementRules(state, event.timestamp);
        return;
      }
      // 其余事件一律忽略
    });
    _stationConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // -------------------------------------------------------------------------
  // evaluateBlueprintAchievementRules(state, atMs)
  //   - 权威来源：state.ownedBlueprints（不信任 event.payload）。
  //   - 规则类型 "blueprint-owned-any"：ownedBlueprints 中至少存在一个
  //     BLUEPRINT_OWNERSHIP_KEYS 内的真实合法 ownershipKey（非空字符串）即满足。
  //   - 未知字符串、空串、null、数字、对象、重复幽灵键均不得触发。
  //   - 舰船蓝图与装备蓝图任一合法键都可触发。
  //   - 同批统一 atMs（有限且 >=0 原样，否则本次只取一次 Date.now()）。
  //   - 已解锁不覆盖时间、不重复 emit、不重新 dirty；除首次解锁外不修改 state。
  //   - reason：INVALID_STATE / BLUEPRINT_STATE_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function evaluateBlueprintAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (!Array.isArray(state.ownedBlueprints)) {
      return { ok: false, reason: "BLUEPRINT_STATE_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.BLUEPRINT_RULES) || ruleData.BLUEPRINT_RULES.length === 0 ||
      !Array.isArray(ruleData.BLUEPRINT_OWNERSHIP_KEYS)
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const owned = state.ownedBlueprints;
    const legalSet = ruleData.BLUEPRINT_OWNERSHIP_KEYS;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.BLUEPRINT_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      // 仅当 ownedBlueprints 中存在至少一个真实合法 ownershipKey 才满足
      const met = Array.isArray(owned) && owned.some(
        (k) => typeof k === "string" && k.length > 0 && legalSet.indexOf(k) !== -1
      );
      if (!met) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installBlueprintAchievementConsumer(state)
  //   - 只消费 blueprint:acquired 单一具体事件（不注册通配符 "*"）。
  //   - 幂等：独立标志 _blueprintConsumerInstalled，重复调用返回 ALREADY_INSTALLED，
  //     同一系统实例最多安装一个 listener（listenerCount("blueprint:acquired")===1）。
  //   - 事件到达后读取 state.ownedBlueprints 权威求值（不凭 payload 解锁），时间取 event.timestamp。
  //   - 返回 reason：INVALID_STATE / BLUEPRINT_STATE_UNAVAILABLE /
  //     EVENTS_UNAVAILABLE / ALREADY_INSTALLED / null。
  // -------------------------------------------------------------------------
  let _blueprintConsumerInstalled = false;

  function installBlueprintAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (!Array.isArray(state.ownedBlueprints)) {
      return { ok: false, reason: "BLUEPRINT_STATE_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_blueprintConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("blueprint:acquired", function (event) {
      // 严格只处理 blueprint:acquired；权威事实是 state.ownedBlueprints 当前集合，payload 仅作触发信号
      if (!event || typeof event !== "object") return;
      evaluateBlueprintAchievementRules(state, event.timestamp);
    });
    _blueprintConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // =========================================================================
  // Batch C-13：经济成就（I01–I12）
  //
  //   - 权威来源唯一为 ResourceRegistry 的**当前持有量**：
  //       I01–I10 / I11 → ResourceRegistry.get(state, resourceId)
  //       I12          → ResourceRegistry.getInventoryTotal(state)（严格 > 1,000,000）
  //     不读 statistics 累计、不读事件 payload、不自建第二套计数。
  //
  //   - 脚本顺序约束（关键）：稳定加载顺序为
  //       core/statistics.js < systems/achievements.js < systems/production.js
  //       < core/resources.js < systems/manufacturing.js
  //     即本文件执行时 ResourceRegistry **尚不存在**（它在 resources.js 里创建，
  //     而 resources.js 顶层又依赖 production.js 的 ITEM_CATEGORIES）。
  //     因此本消费者采用「监听器先注册、ResourceRegistry 延迟解析」：
  //       · install 时只校验 state / state.resources / GameEvents，不要求 ResourceRegistry；
  //       · 每次 evaluate 被真正调用时才动态取 globalThis/window.ResourceRegistry；
  //       · 取不到则返回 RESOURCE_REGISTRY_UNAVAILABLE，不抛错、不污染状态。
  //     真实资源变动事件只会在全部脚本加载后发生，届时 ResourceRegistry 必然就绪；
  //     persistence.js 也排在 resources.js 之后，读档追溯同样安全。
  //     严禁在 resources.js 末尾反向调用 AchievementSystem，
  //     严禁新增 resource-registry-ready 事件（避免 core → achievement 反向耦合）。
  //
  //   - reason：INVALID_STATE / RESOURCES_UNAVAILABLE / RESOURCE_REGISTRY_UNAVAILABLE
  //             / RULE_DATA_UNAVAILABLE / null。
  // =========================================================================

  // 动态解析 ResourceRegistry（每次求值现取，不缓存，避免早绑定到 undefined）
  function getResourceRegistry() {
    return (
      (typeof globalThis !== "undefined" && globalThis.ResourceRegistry) ||
      (typeof window !== "undefined" && window.ResourceRegistry) ||
      null
    );
  }

  // 读数清洗：非 number / NaN / ±Infinity / 负数一律按 0 处理
  function readResourceAmount(registry, state, resourceId) {
    if (!registry || typeof registry.get !== "function" || typeof resourceId !== "string") return 0;
    let raw;
    try {
      raw = registry.get(state, resourceId);
    } catch (error) {
      return 0;
    }
    const value = Number(raw);
    if (!isFinite(value) || value <= 0) return 0;
    return value;
  }

  function isEconomyRuleMet(rule, registry, state) {
    if (!rule || !registry) return false;
    if (rule.type === "economy-resource-min") {
      return readResourceAmount(registry, state, rule.resourceId) >= rule.minValue;
    }
    // I11：集合内每一个资源的当前持有量都必须 >= minValue（缺任意一项即不解锁）。
    // 资源 ID 取自冻结的 ECONOMY_COLLECTION_RESOURCE_IDS，其中莫尔石为 mineral:莫尔石；
    // 在旧 moonOres 池里伪造「莫尔石」键不会被读到，因而不满足本规则。
    if (rule.type === "economy-resource-set-all") {
      const ids = rule.resourceIds;
      if (!Array.isArray(ids) || ids.length === 0) return false;
      for (const id of ids) {
        if (readResourceAmount(registry, state, id) < rule.minValue) return false;
      }
      return true;
    }
    // I12：物资总量**首次突破**，严格大于（恰好等于 1,000,000 不解锁）
    if (rule.type === "economy-inventory-total") {
      if (typeof registry.getInventoryTotal !== "function") return false;
      let raw;
      try {
        raw = registry.getInventoryTotal(state);
      } catch (error) {
        return false;
      }
      const total = Number(raw);
      if (!isFinite(total)) return false;
      return total > rule.minValue;
    }
    return false;
  }

  function evaluateEconomyAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (!state.resources || typeof state.resources !== "object" || Array.isArray(state.resources)) {
      return { ok: false, reason: "RESOURCES_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const registry = getResourceRegistry();
    if (!registry || typeof registry.get !== "function") {
      return { ok: false, reason: "RESOURCE_REGISTRY_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.ECONOMY_RULES) || ruleData.ECONOMY_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.ECONOMY_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isEconomyRuleMet(rule, registry, state)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installEconomyAchievementConsumer(state)
  //   - 只消费四类事件（具体类型监听，不用 "*"，不改变 listenerCount("*")）：
  //       resource:changed          （ResourceRegistry.set 真实变更）
  //       inventory:changed         （LP 商店购入未安装装备等库存变动）
  //       manufacturing:completed   （制造产出入库）
  //       station:autoLineCompleted （空间站自动线产出入库）
  //   - 安装时**不要求 ResourceRegistry 已存在**，只登记回调；求值时再动态解析。
  //   - 独立标志 _economyConsumerInstalled；幂等。
  // -------------------------------------------------------------------------
  let _economyConsumerInstalled = false;

  function installEconomyAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (!state.resources || typeof state.resources !== "object" || Array.isArray(state.resources)) {
      return { ok: false, reason: "RESOURCES_UNAVAILABLE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_economyConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    const onEconomyEvent = function (event) {
      evaluateEconomyAchievementRules(state, event && event.timestamp);
    };
    GE.on("resource:changed", onEconomyEvent);
    GE.on("inventory:changed", onEconomyEvent);
    GE.on("manufacturing:completed", onEconomyEvent);
    GE.on("station:autoLineCompleted", onEconomyEvent);
    _economyConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // =========================================================================
  //  Batch C-14A：综合生命周期成就内核（J01–J06）
  //
  //  累计事实唯一权威来源：state.statistics.lifecycle（由 GameStatistics 消费者维护）。
  //  不信任 event.payload、不读 UI、不自建第二套计数。
  // =========================================================================

  function readLifecycleNumber(statistics, key) {
    const lifecycle = statistics && statistics.lifecycle;
    if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) return 0;
    return readStatNumber(lifecycle[key]);
  }

  function isGeneralRuleMet(rule, statistics) {
    switch (rule.type) {
      case "lifecycle-online-seconds":
        return readLifecycleNumber(statistics, "onlineSeconds") >= rule.minValue;
      case "lifecycle-offline-settlements":
        return readLifecycleNumber(statistics, "offlineSettlements") >= rule.minValue;
      case "lifecycle-offline-seconds":
        return readLifecycleNumber(statistics, "offlineSettledSeconds") >= rule.minValue;
      case "lifecycle-max-queue-items":
        return readLifecycleNumber(statistics, "maxQueueItems") >= rule.minValue;
      case "lifecycle-combat-repair-resumes":
        return readLifecycleNumber(statistics, "combatRepairResumes") >= rule.minValue;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------
  // evaluateGeneralAchievementRules(state, atMs)
  //   - 条件只从 state.statistics.lifecycle 权威累计读取（不信任 event.payload）。
  //   - 按 GENERAL_RULES 冻结顺序求值（J01→J06）；达标只调用现有 unlockAchievement。
  //   - 同一次求值中全部新解锁使用同一个 atMs（合法则原样，否则本次只取一次 Date.now()）。
  //   - unlockedIds 只含本次新解锁项；重复求值返回 []；无新解锁不主动 dirty。
  //   - reason：INVALID_STATE / STATISTICS_UNAVAILABLE / RULE_DATA_UNAVAILABLE / null。
  // -------------------------------------------------------------------------
  function evaluateGeneralAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (
      !state.statistics || typeof state.statistics !== "object" || Array.isArray(state.statistics)
    ) {
      return { ok: false, reason: "STATISTICS_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.GENERAL_RULES) || ruleData.GENERAL_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const statistics = state.statistics;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    for (const rule of ruleData.GENERAL_RULES) {
      evaluatedCount++;
      const prev = map[rule.achievementId];
      if (typeof prev === "number" && isFinite(prev) && prev >= 0) continue; // 已解锁：不覆盖、不重复调用
      if (!isGeneralRuleMet(rule, statistics)) continue;
      const res = unlockAchievement(state, rule.achievementId, batchAtMs);
      if (res && res.ok === true) unlockedIds.push(rule.achievementId);
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installGeneralAchievementConsumer(state)
  //   - 只消费四类事件（具体类型监听，不用 "*"，不改变 listenerCount("*")）：
  //       session:onlineElapsed      （tick.js 私有锚点，J01/J02）
  //       offline:settlementCompleted（真实离线结算，J03/J04）
  //       queue:itemAdded            （队列真实新增一项，J05）
  //       combat:resumedAfterRepair  （重创维修后真实恢复出击，J06）
  //   - 采用通配后置监听（GE.on("*")）而非具体类型监听：GameEvents.emit 的派发顺序是
  //     [具体类型监听..., "*" 监听...]，statistics 以 onIdempotent("*") 在 core 阶段先注册，
  //     本消费者在 systems 阶段后注册到同一 "*" 组尾部，因此回调触发时 statistics.lifecycle
  //     已经是最新值，J01–J06 当拍即可解锁（无一拍延迟）。
  //     回调内自行过滤，只对上述四类事件求值，其余事件立即返回。
  //   - 独立标志 _generalConsumerInstalled；幂等。
  //   - reason：INVALID_STATE / EVENTS_UNAVAILABLE / ALREADY_INSTALLED / null。
  // -------------------------------------------------------------------------
  let _generalConsumerInstalled = false;

  const GENERAL_CONSUMER_EVENT_TYPES = Object.freeze([
    "session:onlineElapsed",
    "offline:settlementCompleted",
    "queue:itemAdded",
    "combat:resumedAfterRepair",
  ]);

  function installGeneralAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_generalConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    // 通配后置监听：statistics 用 onIdempotent("*") 注册在前，本消费者用 on("*") 注册在后，
    // 同一 "*" 组内按注册顺序派发，因此本回调总能读到 statistics 已更新的 lifecycle。
    // 但只对上述四类事件求值，其余事件直接忽略（不做无谓的 194 条规则扫描）。
    const onGeneralEvent = function (event) {
      if (!event || typeof event.type !== "string") return;
      if (GENERAL_CONSUMER_EVENT_TYPES.indexOf(event.type) === -1) return;
      evaluateGeneralAchievementRules(state, event.timestamp);
    };
    GE.on("*", onGeneralEvent);
    _generalConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // =========================================================================
  //  Batch C-14B：元成就内核（J10 / J11 / J12）
  //
  //  权威事实唯一来源：AchievementData 真实目录 ∩ state.achievements.unlockedAtById
  //  的合法解锁时间。不读 statistics、不读事件 payload、不硬编码目录 ID 副本、
  //  不新增状态字段。
  // =========================================================================

  // 合法解锁时间判定（与 isAchievementUnlocked 同一标准；非法时间一律不计数）
  function hasValidUnlockTime(map, achievementId) {
    const ts = map[achievementId];
    return typeof ts === "number" && isFinite(ts) && ts >= 0;
  }

  // 目录中「非排除集合」的已解锁项数：只遍历真实目录，
  // 因此存档中的未知 ID / 幽灵成就永远不会进入计数。
  function countUnlockedCatalogAchievements(map, catalog, excludeIds) {
    let count = 0;
    for (const achievement of catalog) {
      if (!achievement || typeof achievement.id !== "string") continue;
      if (excludeIds && excludeIds.indexOf(achievement.id) !== -1) continue;
      if (hasValidUnlockTime(map, achievement.id)) count++;
    }
    return count;
  }

  // 目录中「非排除集合」是否全部已解锁（J12：excludeIds 只含自身，故必含 J10/J11）
  function isCatalogCompleteExcept(map, catalog, excludeIds) {
    let required = 0;
    for (const achievement of catalog) {
      if (!achievement || typeof achievement.id !== "string") continue;
      if (excludeIds && excludeIds.indexOf(achievement.id) !== -1) continue;
      required++;
      if (!hasValidUnlockTime(map, achievement.id)) return false;
    }
    return required > 0;
  }

  function isMetaRuleMet(rule, map, catalog) {
    if (rule.type === "meta-non-meta-count") {
      return countUnlockedCatalogAchievements(map, catalog, rule.excludeIds) >= rule.minValue;
    }
    if (rule.type === "meta-catalog-complete") {
      return isCatalogCompleteExcept(map, catalog, rule.excludeIds);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // evaluateMetaAchievementRules(state, atMs)
  //   - 按 META_RULES 冻结顺序求值（J10→J11→J12），每条规则求值前重新读取
  //     当前解锁事实，因此一次求值可顺序补齐 J10→J11→J12。
  //   - J10/J11 计数排除 META_ACHIEVEMENT_IDS，元成就不得自我抬高计数。
  //   - 达标只调用现有 unlockAchievement；已解锁不覆盖时间、不重复 emit。
  //   - 重入保护：unlockAchievement 会同步 emit achievement:unlocked，
  //     该事件的消费者又会调用本函数；嵌套调用立即返回 REENTRANT，
  //     由最外层这次求值负责把 J10→J11→J12 顺序补齐（不递归、不栈溢出）。
  //   - reason：INVALID_STATE / CATALOG_UNAVAILABLE / RULE_DATA_UNAVAILABLE /
  //             REENTRANT / null。
  // -------------------------------------------------------------------------
  let _metaEvaluating = false;

  function evaluateMetaAchievementRules(state, atMs) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE", evaluatedCount: 0, unlockedIds: [] };
    }
    const AD = getAchievementData();
    if (!AD || !Array.isArray(AD.ACHIEVEMENTS) || AD.ACHIEVEMENTS.length === 0) {
      return { ok: false, reason: "CATALOG_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    const ruleData = getAchievementRuleData();
    if (
      !ruleData || typeof ruleData !== "object" ||
      !Array.isArray(ruleData.META_RULES) || ruleData.META_RULES.length === 0
    ) {
      return { ok: false, reason: "RULE_DATA_UNAVAILABLE", evaluatedCount: 0, unlockedIds: [] };
    }
    if (_metaEvaluating) {
      return { ok: false, reason: "REENTRANT", evaluatedCount: 0, unlockedIds: [] };
    }

    const batchAtMs = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();

    const catalog = AD.ACHIEVEMENTS;
    const map = state.achievements.unlockedAtById;
    const unlockedIds = [];
    let evaluatedCount = 0;

    _metaEvaluating = true;
    try {
      for (const rule of ruleData.META_RULES) {
        evaluatedCount++;
        if (hasValidUnlockTime(map, rule.achievementId)) continue; // 已解锁：不覆盖、不重复调用
        if (!isMetaRuleMet(rule, map, catalog)) continue;
        const res = unlockAchievement(state, rule.achievementId, batchAtMs);
        if (res && res.ok === true) unlockedIds.push(rule.achievementId);
      }
    } finally {
      _metaEvaluating = false;
    }

    return { ok: true, reason: null, evaluatedCount, unlockedIds };
  }

  // -------------------------------------------------------------------------
  // installMetaAchievementConsumer(state)
  //   - 只监听具体事件 achievement:unlocked（不注册通配符 "*"，
  //     不改变 listenerCount("*")）；同一系统实例最多一个 listener。
  //   - 权威事实是 state.achievements.unlockedAtById（不凭 payload 直接解锁），
  //     时间取 event.timestamp（即该次解锁的 unlockedAt）。
  //   - 解锁 J10/J11/J12 自身也会 emit 同一事件，由 _metaEvaluating 重入保护
  //     拦截嵌套求值：不重复 emit、不递归。
  //   - reason：INVALID_STATE / EVENTS_UNAVAILABLE / ALREADY_INSTALLED / null。
  // -------------------------------------------------------------------------
  let _metaConsumerInstalled = false;

  function installMetaAchievementConsumer(state) {
    if (!hasValidAchievementState(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    const GE =
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null;
    if (!GE || typeof GE.on !== "function") {
      return { ok: false, reason: "EVENTS_UNAVAILABLE" };
    }
    if (_metaConsumerInstalled) {
      return { ok: false, reason: "ALREADY_INSTALLED" };
    }
    GE.on("achievement:unlocked", function (event) {
      evaluateMetaAchievementRules(state, event ? event.timestamp : undefined);
    });
    _metaConsumerInstalled = true;
    return { ok: true, reason: null };
  }

  // =========================================================================
  //  Batch E：成就科研工时奖励（一次性发放 + 账本防重）
  //
  //  设计约束：
  //    - 奖励只是「一次性科研工时」，不提供任何永久研究速度加成。
  //    - 唯一权威工时载体：state.research.researchHourBank（单位：秒）。
  //    - 唯一防重账本：state.achievements.researchRewardSecondsById（单位：秒），
  //      只记录「已经真实发放过的秒数」；键存在即视为已发放，绝不二次入账。
  //    - 发放金额只信任冻结目录 AchievementData 的 reward.hours，
  //      绝不信任事件 payload 或存档里的任何数值。
  //    - 只有首次真实入账才设置 _dirty 并 emit achievement:researchHoursGranted。
  // =========================================================================

  const RESEARCH_REWARD_TYPE = "research-hours";
  const RESEARCH_REWARD_SECONDS_PER_HOUR = 3600;

  function getGameEventsBus() {
    return (
      (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
      (typeof window !== "undefined" && window.GameEvents) ||
      null
    );
  }

  // schema v2 账本可用性：achievements 结构合法 且 researchRewardSecondsById 是普通对象
  function hasValidResearchRewardLedger(state) {
    if (!hasValidAchievementState(state)) return false;
    const ledger = state.achievements.researchRewardSecondsById;
    return !!(ledger && typeof ledger === "object" && !Array.isArray(ledger));
  }

  // -------------------------------------------------------------------------
  // 只读：目录奖励工时。
  //   未知 ID / reward 为 null / reward 非对象 / type 不是 research-hours /
  //   hours 非有限正数 → 一律返回 null（表示「本成就没有科研工时奖励」）。
  // 纯只读，不接触 state。
  // -------------------------------------------------------------------------
  function getAchievementResearchRewardHours(achievementId) {
    const def = getAchievementDefinition(achievementId);
    if (!def) return null;
    const reward = def.reward;
    if (!reward || typeof reward !== "object" || Array.isArray(reward)) return null;
    if (reward.type !== RESEARCH_REWARD_TYPE) return null;
    const hours = reward.hours;
    if (typeof hours !== "number" || !isFinite(hours) || hours <= 0) return null;
    return hours;
  }

  // -------------------------------------------------------------------------
  // 一次性发放：
  //   - 账本/成就状态非法        → {ok:false, reason:"INVALID_STATE"}
  //   - ID 不在目录              → {ok:false, reason:"UNKNOWN_ACHIEVEMENT"}
  //   - 尚未真正解锁             → {ok:false, reason:"NOT_UNLOCKED"}
  //   - 目录 reward 为 null/非法 → {ok:false, reason:"NO_REWARD"}
  //   - 账本已有记录             → {ok:false, reason:"ALREADY_GRANTED", seconds:已发秒数}
  //   - state.research 缺失/非法 → {ok:false, reason:"RESEARCH_UNAVAILABLE"}（安全失败，不抛异常）
  //   - 首次成功                 → {ok:true, reason:null, achievementId, hours, seconds, bankSeconds}
  //
  // 失败分支一律不改状态、不设置 _dirty、不 emit。
  // -------------------------------------------------------------------------
  function grantAchievementResearchReward(state, achievementId, atMs) {
    if (!hasValidResearchRewardLedger(state)) {
      return { ok: false, reason: "INVALID_STATE" };
    }
    if (!getAchievementDefinition(achievementId)) {
      return { ok: false, reason: "UNKNOWN_ACHIEVEMENT" };
    }
    if (!isAchievementUnlocked(state, achievementId)) {
      return { ok: false, reason: "NOT_UNLOCKED", achievementId };
    }
    const hours = getAchievementResearchRewardHours(achievementId);
    if (hours === null) {
      return { ok: false, reason: "NO_REWARD", achievementId };
    }

    const ledger = state.achievements.researchRewardSecondsById;
    const prev = ledger[achievementId];
    if (typeof prev === "number" && isFinite(prev) && prev >= 0) {
      return { ok: false, reason: "ALREADY_GRANTED", achievementId, hours, seconds: prev };
    }

    const research = state.research;
    if (!research || typeof research !== "object" || Array.isArray(research)) {
      return { ok: false, reason: "RESEARCH_UNAVAILABLE", achievementId, hours };
    }

    const seconds = hours * RESEARCH_REWARD_SECONDS_PER_HOUR;
    const bankRaw = research.researchHourBank;
    const bank = (typeof bankRaw === "number" && isFinite(bankRaw) && bankRaw > 0) ? bankRaw : 0;

    research.researchHourBank = bank + seconds;
    ledger[achievementId] = seconds;
    state._dirty = true;

    const grantedAt = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();
    const GE = getGameEventsBus();
    if (GE && typeof GE.emit === "function") {
      GE.emit(
        "achievement:researchHoursGranted",
        { achievementId, hours, seconds },
        { timestamp: grantedAt, source: "achievement-system" }
      );
    }

    return {
      ok: true,
      reason: null,
      achievementId,
      hours,
      seconds,
      bankSeconds: research.researchHourBank,
    };
  }

  // -------------------------------------------------------------------------
  // 旧档对账：按冻结目录顺序，为「已解锁但账本无记录」的成就补发一次。
  //   - 状态非法 → {ok:false, reason:"INVALID_STATE", grantedIds:[], grantedSeconds:0}
  //   - 正常     → {ok:true, reason:null, grantedIds:[...], grantedSeconds:总秒数}
  //   - 同批补发共用同一个 atMs；已发放过的一律跳过（幂等：第二次 grantedIds 为空）。
  // -------------------------------------------------------------------------
  function reconcileAchievementResearchRewards(state, atMs) {
    if (!hasValidResearchRewardLedger(state)) {
      return { ok: false, reason: "INVALID_STATE", grantedIds: [], grantedSeconds: 0 };
    }
    const AD = getAchievementData();
    if (!AD || !Array.isArray(AD.ACHIEVEMENTS)) {
      return { ok: true, reason: null, grantedIds: [], grantedSeconds: 0 };
    }
    const at = (typeof atMs === "number" && isFinite(atMs) && atMs >= 0) ? atMs : Date.now();
    const grantedIds = [];
    let grantedSeconds = 0;
    for (const achievement of AD.ACHIEVEMENTS) {
      const r = grantAchievementResearchReward(state, achievement.id, at);
      if (r && r.ok) {
        grantedIds.push(achievement.id);
        grantedSeconds += r.seconds;
      }
    }
    return { ok: true, reason: null, grantedIds, grantedSeconds };
  }

  // -------------------------------------------------------------------------
  // 暴露
  // -------------------------------------------------------------------------
  const AchievementSystem = {
    getAchievementDefinition,
    isAchievementUnlocked,
    getAchievementUnlockTime,
    getUnlockedAchievements,
    unlockAchievement,
    evaluateSkillAchievementRules,
    installSkillAchievementConsumer,
    evaluateProductionAchievementRules,
    installProductionAchievementConsumer,
    evaluateCombatAchievementRules,
    installCombatAchievementConsumer,
    evaluateManufacturingAchievementRules,
    installManufacturingAchievementConsumer,
    evaluateEquipmentAchievementRules,
    installEquipmentAchievementConsumer,
    evaluateBoosterAchievementRules,
    installBoosterAchievementConsumer,
    evaluateArchaeologyAchievementRules,
    installArchaeologyAchievementConsumer,
    evaluatePlanetaryAchievementRules,
    installPlanetaryAchievementConsumer,
    evaluateStationAchievementRules,
    installStationAchievementConsumer,
    evaluateBlueprintAchievementRules,
    installBlueprintAchievementConsumer,
    evaluateEconomyAchievementRules,
    installEconomyAchievementConsumer,
    evaluateGeneralAchievementRules,
    installGeneralAchievementConsumer,
    evaluateMetaAchievementRules,
    installMetaAchievementConsumer,
    getAchievementResearchRewardHours,
    grantAchievementResearchReward,
    reconcileAchievementResearchRewards,
  };

  if (typeof window !== "undefined") window.AchievementSystem = AchievementSystem;
  if (typeof globalThis !== "undefined") globalThis.AchievementSystem = AchievementSystem;

  // Batch C-1/C-2/C-3/C-4/C-5/C-6/C-7/C-8/C-9/C-12/C-13/C-14A：脚本加载完成时，对真实 gameState 依次自动安装
  // 技能 / 生产 / 战斗 / 制造 / 装备 / 增幅剂 / 考古 / 行星 / 空间站 / 蓝图 / 经济 / 综合 十二个消费者各一次
  // （十二个独立标志，互不占用）。
  // 此处只安装监听、不做追溯扫描；初始追溯由 persistence 的明确调用完成。
  // 经济消费者放在最后安装：它同样只登记回调，不在此刻求值，因此不要求 ResourceRegistry 已就绪。
  if (typeof gameState !== "undefined" && gameState &&
      ((typeof globalThis !== "undefined" && globalThis.GameEvents) ||
       (typeof window !== "undefined" && window.GameEvents))) {
    installSkillAchievementConsumer(gameState);
    installProductionAchievementConsumer(gameState);
    installCombatAchievementConsumer(gameState);
    installManufacturingAchievementConsumer(gameState);
    installEquipmentAchievementConsumer(gameState);
    installBoosterAchievementConsumer(gameState);
    installArchaeologyAchievementConsumer(gameState);
    installPlanetaryAchievementConsumer(gameState);
    installStationAchievementConsumer(gameState);
    installBlueprintAchievementConsumer(gameState);
    installEconomyAchievementConsumer(gameState);
    // 综合消费者放在最后安装：它注册到 "*" 组尾部，保证求值时 statistics.lifecycle 已更新。
    installGeneralAchievementConsumer(gameState);
    // Batch C-14B：元成就消费者只监听具体事件 achievement:unlocked（不占用 "*" 组），
    // 注册在全部业务消费者之后，保证任何一项普通成就解锁后当拍即可补齐 J10/J11/J12。
    installMetaAchievementConsumer(gameState);
  }
})();
