// ============================================================================
//  js/data/achievement-rules.js
//  成就规则冻结数据 —— Batch C-1（技能类 50 项）+ Batch C-2（采矿工业 18 项）
//                       + Batch C-3（战斗星带 19 项）+ Batch C-4（舰船制造 12 项）
//
//  职责：为 A01–A48、C14、F22 共 50 项技能成就、B01–B18 共 18 项采矿工业成就、
//  E01–E19 共 19 项战斗星带成就、C01–C10/C12/C13 共 12 项舰船制造成就提供显式
//  冻结规则映射（合计 116 项）。
//  规则完全静态声明：
//    - 不解析 AchievementData.conditionText
//    - 不从中文名称猜技能键
//    - 不根据 ID 字母/数字动态推导业务规则
//    - 不修改 AchievementData.trigger
//    - 本文件不保存解锁状态、不监听任何事件
//
//  规则类型（type）：
//    - "skill-level"  ：单技能等级 { skill, minLevel }
//    - "skill-count"  ：ALL_SKILL_KEYS 中至少 count 项 >= minLevel { count, minLevel }
//    - "skill-all"    ：keys 数组全部 >= minLevel { keys, minLevel }
//
//  legacy 兼容字段 combat 不属于成就技能集合，不参与任何统计。
//
//  依赖：无（纯数据）。加载顺序：js/data/achievements.js 之后、
//        js/core/achievement-state.js 之前（见 index.html）。
// ============================================================================

'use strict';

(function () {
  // 21 项权威技能键（顺序冻结，精确对应 A01–A21 / A22–A42）
  const ALL_SKILL_KEYS = Object.freeze([
    "mining",
    "planetaryIndustry",
    "refining",
    "gasHarvesting",
    "shipEngineering",
    "equipmentEngineering",
    "rigEngineering",
    "boosterEngineering",
    "reverseEngineering",
    "laserOps",
    "cannonOps",
    "missileOperations",
    "defense",
    "shieldOperation",
    "armorReinforcement",
    "hullEngineering",
    "targeting",
    "piloting",
    "capacitorManagement",
    "drones",
    "archaeology",
  ]);

  // 11 项战斗技能键（精确对应 A10–A20）
  const COMBAT_SKILL_KEYS = Object.freeze([
    "laserOps",
    "cannonOps",
    "missileOperations",
    "defense",
    "shieldOperation",
    "armorReinforcement",
    "hullEngineering",
    "targeting",
    "piloting",
    "capacitorManagement",
    "drones",
  ]);

  function skillRule(achievementId, skill, minLevel) {
    return Object.freeze({ achievementId, type: "skill-level", skill, minLevel });
  }
  function countRule(achievementId, count, minLevel) {
    return Object.freeze({ achievementId, type: "skill-count", count, minLevel });
  }
  function allRule(achievementId, keys, minLevel) {
    return Object.freeze({ achievementId, type: "skill-all", keys, minLevel });
  }

  // 50 条规则（顺序即求值顺序）：A01–A42 单技能、A43–A48 组合、C14/F22 分类重复
  const SKILL_RULES = Object.freeze([
    // ---- Lv.50 单技能：A01–A21 ----
    skillRule("A01", "mining", 50),
    skillRule("A02", "planetaryIndustry", 50),
    skillRule("A03", "refining", 50),
    skillRule("A04", "gasHarvesting", 50),
    skillRule("A05", "shipEngineering", 50),
    skillRule("A06", "equipmentEngineering", 50),
    skillRule("A07", "rigEngineering", 50),
    skillRule("A08", "boosterEngineering", 50),
    skillRule("A09", "reverseEngineering", 50),
    skillRule("A10", "laserOps", 50),
    skillRule("A11", "cannonOps", 50),
    skillRule("A12", "missileOperations", 50),
    skillRule("A13", "defense", 50),
    skillRule("A14", "shieldOperation", 50),
    skillRule("A15", "armorReinforcement", 50),
    skillRule("A16", "hullEngineering", 50),
    skillRule("A17", "targeting", 50),
    skillRule("A18", "piloting", 50),
    skillRule("A19", "capacitorManagement", 50),
    skillRule("A20", "drones", 50),
    skillRule("A21", "archaeology", 50),
    // ---- Lv.99 单技能：A22–A42 ----
    skillRule("A22", "mining", 99),
    skillRule("A23", "planetaryIndustry", 99),
    skillRule("A24", "refining", 99),
    skillRule("A25", "gasHarvesting", 99),
    skillRule("A26", "shipEngineering", 99),
    skillRule("A27", "equipmentEngineering", 99),
    skillRule("A28", "rigEngineering", 99),
    skillRule("A29", "boosterEngineering", 99),
    skillRule("A30", "reverseEngineering", 99),
    skillRule("A31", "laserOps", 99),
    skillRule("A32", "cannonOps", 99),
    skillRule("A33", "missileOperations", 99),
    skillRule("A34", "defense", 99),
    skillRule("A35", "shieldOperation", 99),
    skillRule("A36", "armorReinforcement", 99),
    skillRule("A37", "hullEngineering", 99),
    skillRule("A38", "targeting", 99),
    skillRule("A39", "piloting", 99),
    skillRule("A40", "capacitorManagement", 99),
    skillRule("A41", "drones", 99),
    skillRule("A42", "archaeology", 99),
    // ---- 组合规则：A43–A48 ----
    allRule("A43", COMBAT_SKILL_KEYS, 99),
    countRule("A44", 5, 80),
    countRule("A45", 10, 90),
    allRule("A46", ALL_SKILL_KEYS, 50),
    allRule("A47", COMBAT_SKILL_KEYS, 80),
    allRule("A48", ALL_SKILL_KEYS, 99),
    // ---- 分类重复规则（必须与 A26/A42 分别同时解锁）----
    skillRule("C14", "shipEngineering", 99),
    skillRule("F22", "archaeology", 99),
  ]);

  const SKILL_RULES_BY_ID = {};
  for (const rule of SKILL_RULES) SKILL_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(SKILL_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-2：采矿工业类 18 项（B01–B18）
  //
  //  规则类型（type）：
  //    - "production-gathered" ：statistics.production.gathered[resourceId] >= minValue
  //    - "production-refined"  ：statistics.production.refined[resourceId] >= minValue
  //    - "production-total"    ：statistics.totals[totalKey] >= minValue
  //
  //  资源键与 js/core/tick.js / js/core/offline.js 发射的事件 payload 精确一致：
  //    矿石采集 → "ore:<矿石名>"（moon:* 月矿不计入 B01–B07）
  //    冶炼产出 → "mineral:<矿物名>"
  //    气体采集 → totals.gasUnits（statistics 由 gas:completed 累计）
  //  累计事实唯一来源为 gameState.statistics（GameStatistics 维护），
  //  本文件不读取事件 payload、不自建第二套累计。
  // ==========================================================================

  function productionGatheredRule(achievementId, resourceId, minValue) {
    return Object.freeze({ achievementId, type: "production-gathered", resourceId, minValue });
  }
  function productionRefinedRule(achievementId, resourceId, minValue) {
    return Object.freeze({ achievementId, type: "production-refined", resourceId, minValue });
  }
  function productionTotalRule(achievementId, totalKey, minValue) {
    return Object.freeze({ achievementId, type: "production-total", totalKey, minValue });
  }

  // 18 条规则（顺序即求值顺序）：B01–B07 首次采集、B08–B14 首次冶炼、
  // B15/B16 累计采矿、B17 首次气体、B18 累计气体
  const PRODUCTION_RULES = Object.freeze([
    // ---- 首次采集矿石：B01–B07 ----
    productionGatheredRule("B01", "ore:凡晶石", 1),
    productionGatheredRule("B02", "ore:灼烧岩", 1),
    productionGatheredRule("B03", "ore:水硼砂", 1),
    productionGatheredRule("B04", "ore:斜长岩", 1),
    productionGatheredRule("B05", "ore:干焦岩", 1),
    productionGatheredRule("B06", "ore:灰岩", 1),
    productionGatheredRule("B07", "ore:艾克诺岩", 1),
    // ---- 首次冶炼矿物：B08–B14 ----
    productionRefinedRule("B08", "mineral:三钛合金", 1),
    productionRefinedRule("B09", "mineral:类银超金属", 1),
    productionRefinedRule("B10", "mineral:类晶体胶矿", 1),
    productionRefinedRule("B11", "mineral:同位聚合体", 1),
    productionRefinedRule("B12", "mineral:超新星诺克石", 1),
    productionRefinedRule("B13", "mineral:基腹断岩", 1),
    productionRefinedRule("B14", "mineral:超噬矿", 1),
    // ---- 累计与气体：B15–B18 ----
    productionTotalRule("B15", "minedUnits", 1000000),
    productionTotalRule("B16", "minedUnits", 100000000),
    productionTotalRule("B17", "gasUnits", 1),
    productionTotalRule("B18", "gasUnits", 1000000),
  ]);

  const PRODUCTION_RULES_BY_ID = {};
  for (const rule of PRODUCTION_RULES) PRODUCTION_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(PRODUCTION_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-3：战斗星带通关类 19 项（E01–E19）
  //
  //  规则类型（type）：
  //    - "combat-zone-clear" ：statistics.combat.zoneClears[zoneId] >= minValue
  //    - "combat-all-zones"  ：COMBAT_ZONE_IDS 中全部 18 个不同 zoneId 的通关数
  //                            均 >= minValue（禁止使用 totals.zonesCleared，
  //                            防止重复刷同一星带错误累计解锁 E19）
  //
  //  权威累计唯一来源为 gameState.statistics.combat.zoneClears（由冻结的
  //  GameStatistics 消费者在 combat:zoneCleared 时维护）。本文件不读取事件
  //  payload、不自建第二套通关计数或历史状态。
  // ==========================================================================

  // 18 个权威战斗星带 ID（顺序冻结，精确对应 E01–E18）
  const COMBAT_ZONE_IDS = Object.freeze([
    "angel_outpost",
    "blood_hideout",
    "sansha_outpost",
    "angel_corridor",
    "blood_sacrifice",
    "sansha_node",
    "angel_hunting_ground",
    "blood_cathedral",
    "sansha_nexus",
    "angel_warfront",
    "blood_iron_basilica",
    "sansha_command_matrix",
    "angel_outer_reach",
    "blood_outer_reliquary",
    "sansha_outer_array",
    "angel_deep_domain",
    "blood_deep_reliquary",
    "sansha_deep_nexus",
  ]);

  // ==========================================================================
  //  Batch C-11：战斗进阶（E20–E25）冻结集合
  //    - CAPITAL_COMBAT_ZONE_IDS：3 个旗舰星带（js/data/combat.js COMBAT_ZONES 中 level 80）
  //    - SUPERCAPITAL_COMBAT_ZONE_IDS：3 个超旗星带（level 90）
  //    - COMBAT_WEAPON_TYPES：3 个合法武器类型（WEAPON_CONFIG 键；"cannon"=火炮）
  //  与 js/data/combat.js 双向一致，审计逐项交叉校验；本文件不 import、字面量冻结。
  // ==========================================================================
  const CAPITAL_COMBAT_ZONE_IDS = Object.freeze([
    "angel_outer_reach",
    "blood_outer_reliquary",
    "sansha_outer_array",
  ]);

  const SUPERCAPITAL_COMBAT_ZONE_IDS = Object.freeze([
    "angel_deep_domain",
    "blood_deep_reliquary",
    "sansha_deep_nexus",
  ]);

  const COMBAT_WEAPON_TYPES = Object.freeze(["laser", "cannon", "missile"]);

  function combatZoneClearRule(achievementId, zoneId, minValue) {
    return Object.freeze({ achievementId, type: "combat-zone-clear", zoneId, minValue });
  }
  function combatAllZonesRule(achievementId, zoneIds, minValue) {
    return Object.freeze({ achievementId, type: "combat-all-zones", zoneIds, minValue });
  }
  // Batch C-11 新规则类型工厂：
  //   combat-max-wave        ：statistics.combat.maxWaveReached >= minValue（E20）
  //   combat-weapon-clear    ：statistics.combat.zoneClearsByWeapon[weaponType] >= minValue（E21–E23）
  //   combat-capital-kills   ：statistics.combat.capitalEnemyKills >= minValue（E24）
  //   combat-supercapital-kills：statistics.combat.supercapitalEnemyKills >= minValue（E25）
  function combatMaxWaveRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "combat-max-wave", minValue });
  }
  function combatWeaponClearRule(achievementId, weaponType, minValue) {
    return Object.freeze({ achievementId, type: "combat-weapon-clear", weaponType, minValue });
  }
  function combatCapitalKillsRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "combat-capital-kills", minValue });
  }
  function combatSupercapitalKillsRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "combat-supercapital-kills", minValue });
  }
  function combatDeathspaceEnterRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "combat-deathspace-enter", minValue });
  }
  function combatDeathspaceClearAnyRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "combat-deathspace-clear-any", minValue });
  }
  function combatFlawlessZoneClearRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "combat-flawless-zone-clear", minValue });
  }
  function combatSingleBattleDamageRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "combat-single-battle-damage", minValue });
  }
  function combatFactionBossKillRule(achievementId, faction, minValue) {
    return Object.freeze({ achievementId, type: "combat-faction-boss-kill", faction, minValue });
  }

  // 32 条规则（顺序即求值顺序，跳过 E28）：E01–E18 首次通关 18 个星带、E19 通关全部 18 星带、
  // E20 打到第 20 波、E21–E23 用激光炮/火炮/导弹通关星带、E24/E25 首杀旗舰级/超旗级敌人、
  // E26/E27 死亡空间进入与通关、E29 无伤通关星带、E30 单场百万伤害、E31–E33 三阵营 Boss 首杀
  const COMBAT_RULES = Object.freeze([
    combatZoneClearRule("E01", "angel_outpost", 1),
    combatZoneClearRule("E02", "blood_hideout", 1),
    combatZoneClearRule("E03", "sansha_outpost", 1),
    combatZoneClearRule("E04", "angel_corridor", 1),
    combatZoneClearRule("E05", "blood_sacrifice", 1),
    combatZoneClearRule("E06", "sansha_node", 1),
    combatZoneClearRule("E07", "angel_hunting_ground", 1),
    combatZoneClearRule("E08", "blood_cathedral", 1),
    combatZoneClearRule("E09", "sansha_nexus", 1),
    combatZoneClearRule("E10", "angel_warfront", 1),
    combatZoneClearRule("E11", "blood_iron_basilica", 1),
    combatZoneClearRule("E12", "sansha_command_matrix", 1),
    combatZoneClearRule("E13", "angel_outer_reach", 1),
    combatZoneClearRule("E14", "blood_outer_reliquary", 1),
    combatZoneClearRule("E15", "sansha_outer_array", 1),
    combatZoneClearRule("E16", "angel_deep_domain", 1),
    combatZoneClearRule("E17", "blood_deep_reliquary", 1),
    combatZoneClearRule("E18", "sansha_deep_nexus", 1),
    combatAllZonesRule("E19", COMBAT_ZONE_IDS, 1),
    combatMaxWaveRule("E20", 20),
    combatWeaponClearRule("E21", COMBAT_WEAPON_TYPES[0], 1), // laser 激光炮
    combatWeaponClearRule("E22", COMBAT_WEAPON_TYPES[1], 1), // cannon 火炮
    combatWeaponClearRule("E23", COMBAT_WEAPON_TYPES[2], 1), // missile 导弹
    combatCapitalKillsRule("E24", 1),
    combatSupercapitalKillsRule("E25", 1),
    // Batch C-12：跳过 E28（已删除）
    combatDeathspaceEnterRule("E26", 1),
    combatDeathspaceClearAnyRule("E27", 1),
    combatFlawlessZoneClearRule("E29", 1),
    combatSingleBattleDamageRule("E30", 1000000),
    combatFactionBossKillRule("E31", "angel", 1),
    combatFactionBossKillRule("E32", "blood", 1),
    combatFactionBossKillRule("E33", "sansha", 1),
  ]);

  // Batch C-12：死亡空间 ID 冻结数组（硬编码，与 DEATHSPACE_DATABASE 12 项双向一致）
  const DEATHSPACE_IDS_FOR_ACHIEVEMENTS = Object.freeze([
    "angel_ded_2_10","blood_ded_2_10","sansha_ded_2_10",
    "angel_ded_3_10","blood_ded_3_10","sansha_ded_3_10",
    "angel_ded_4_10","blood_ded_4_10","sansha_ded_4_10",
    "angel_ded_6_10","blood_ded_6_10","sansha_ded_6_10",
  ]);

  const COMBAT_RULES_BY_ID = {};
  for (const rule of COMBAT_RULES) COMBAT_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(COMBAT_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-4：舰船制造类 12 项（C01–C10、C12、C13）
  //
  //  规则类型（type）：
  //    - "manufacturing-recipe-set-any" ：SHIP_COMPONENT_RECIPE_IDS 中任一配方
  //            在 statistics.production.manufactured[recipeId] 的累计 >= minValue
  //    - "manufacturing-total"          ：statistics.totals[totalKey] >= minValue
  //    - "manufacturing-recipe"         ：statistics.production.manufactured[recipeId] >= minValue
  //    - "manufacturing-recipe-set-total"：recipeIds 数组各项 manufactured 累计和 >= minValue
  //
  //  权威累计唯一来源为 gameState.statistics（由冻结的 GameStatistics 消费者在
  //  manufacturing:completed 时维护 manufactured[recipeId] 与 totals.shipsBuilt）。
  //  本文件不读取事件 payload、不读 inventory 数量、不自建第二套累计或历史状态。
  //
  //  三个配方 ID 集合与 js/data/ships.js 的 SHIP_COMPONENT_RECIPES /
  //  SHIP_ASSEMBLY_RECIPES 逐项一致（审计 mc2/mc3 交叉证明）。
  // ==========================================================================

  // 18 个权威舰船部件配方 ID（顺序冻结，精确对应 SHIP_COMPONENT_RECIPES）
  const SHIP_COMPONENT_RECIPE_IDS = Object.freeze([
    "integrated_hull",
    "power_core",
    "functional_system",
    "destroyer_integrated_hull",
    "destroyer_power_core",
    "destroyer_functional_system",
    "cruiser_integrated_hull",
    "cruiser_power_core",
    "cruiser_functional_system",
    "battleship_integrated_hull",
    "battleship_power_core",
    "battleship_functional_system",
    "capital_integrated_hull",
    "capital_power_core",
    "capital_functional_system",
    "supercapital_integrated_hull",
    "supercapital_power_core",
    "supercapital_functional_system",
  ]);

  // 5 个旗舰总装配方 ID（顺序冻结，精确对应 SHIP_ASSEMBLY_RECIPES 中 capital_* 组件项）
  const CAPITAL_SHIP_RECIPE_IDS = Object.freeze([
    "firmament",
    "heavy_bastion",
    "riftbreaker",
    "orca",
    "illuminator",
  ]);

  // 3 个超级旗舰总装配方 ID（顺序冻结，精确对应 SHIP_ASSEMBLY_RECIPES 中 supercapital_* 组件项）
  const SUPERCAPITAL_SHIP_RECIPE_IDS = Object.freeze([
    "starcrown",
    "eternal_fortress",
    "arbiter",
  ]);

  function manufacturingComponentAnyRule(achievementId, recipeIds, minValue) {
    return Object.freeze({ achievementId, type: "manufacturing-recipe-set-any", recipeIds, minValue });
  }
  function manufacturingTotalRule(achievementId, totalKey, minValue) {
    return Object.freeze({ achievementId, type: "manufacturing-total", totalKey, minValue });
  }
  function manufacturingRecipeRule(achievementId, recipeId, minValue) {
    return Object.freeze({ achievementId, type: "manufacturing-recipe", recipeId, minValue });
  }
  function manufacturingRecipeSetTotalRule(achievementId, recipeIds, minValue) {
    return Object.freeze({ achievementId, type: "manufacturing-recipe-set-total", recipeIds, minValue });
  }

  // 12 条规则（顺序即求值顺序）：C01 部件任一、C02 首艘舰船、C03–C10 各舰、C12 旗舰累计、C13 超级旗舰累计
  const MANUFACTURING_RULES = Object.freeze([
    manufacturingComponentAnyRule("C01", SHIP_COMPONENT_RECIPE_IDS, 1),
    manufacturingTotalRule("C02", "shipsBuilt", 1),
    manufacturingRecipeRule("C03", "firmament", 1),
    manufacturingRecipeRule("C04", "heavy_bastion", 1),
    manufacturingRecipeRule("C05", "riftbreaker", 1),
    manufacturingRecipeRule("C06", "orca", 1),
    manufacturingRecipeRule("C07", "illuminator", 1),
    manufacturingRecipeRule("C08", "starcrown", 1),
    manufacturingRecipeRule("C09", "eternal_fortress", 1),
    manufacturingRecipeRule("C10", "arbiter", 1),
    manufacturingRecipeSetTotalRule("C12", CAPITAL_SHIP_RECIPE_IDS, 50),
    manufacturingRecipeSetTotalRule("C13", SUPERCAPITAL_SHIP_RECIPE_IDS, 25),
  ]);

  const MANUFACTURING_RULES_BY_ID = {};
  for (const rule of MANUFACTURING_RULES) MANUFACTURING_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(MANUFACTURING_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-5：装备制造 / 燃料 / 弹药 / 装备强化 / 改装件（D13–D17，共 5 项）
  //
  //  规则类型（type）：
  //    - "equipment-recipe-set-any"    ：recipeIds 中任一配方在
  //            statistics.production.manufactured[recipeId] 的累计 >= minValue
  //    - "equipment-enhancement-total" ：statistics.totals[totalKey] >= minValue
  //
  //  权威累计唯一来源为 gameState.statistics（由冻结的 GameStatistics 消费者维护
  //  manufactured[recipeId] 与 totals.equipmentEnhancementAttempts；D16 升级
  //  GAME_STATISTICS_VERSION 1→2 新增 equipmentEnhancementAttempts 字段）。
  //  本文件不读取事件 payload、不读 inventory、不读装备 enhancementLevel、
  //  不自建第二套累计或历史状态。
  //
  //  四个 ID 集合与 js/data/equipment.js（EQUIPMENT_RECIPES）及
  //  js/data/ammunition.js（AMMO_ENG_RECIPES）双向完全相等（审计 eq12–eq17 交叉证明）。
  //  NON_RIG 含「显式非 rig 装备」+「死亡空间派生 ded_* 装备」（slot 非 rig），
  //  与 RIG（9 系列 × 5 档 = 45）零交集。
  // ==========================================================================

  // 非 rig 装备配方 ID（顺序冻结，精确对应 EQUIPMENT_RECIPES.filter(slot!=="rig")）
  const NON_RIG_EQUIPMENT_RECIPE_IDS = Object.freeze([
    "alliance_drone_link",
    "alliance_mineral_assimilation",
    "angel_gas_harvester",
    "angel_mining_laser",
    "archaeo_analyzer_i",
    "archaeo_analyzer_ii",
    "archaeo_analyzer_iii",
    "archaeo_analyzer_iv",
    "archaeo_analyzer_v",
    "archaeo_decoder_i",
    "archaeo_decoder_ii",
    "archaeo_decoder_iii",
    "archaeo_decoder_iv",
    "archaeo_decoder_v",
    "archaeo_stabilizer_i",
    "archaeo_stabilizer_ii",
    "archaeo_stabilizer_iii",
    "archaeo_stabilizer_iv",
    "archaeo_stabilizer_v",
    "blood_servant_drone_link",
    "ded_angel_2_repair",
    "ded_angel_2_repair_supervisor",
    "ded_angel_2_weapon",
    "ded_angel_2_weapon_supervisor",
    "ded_angel_3_repair",
    "ded_angel_3_repair_supervisor",
    "ded_angel_3_weapon",
    "ded_angel_3_weapon_supervisor",
    "ded_angel_4_repair",
    "ded_angel_4_repair_supervisor",
    "ded_angel_4_weapon",
    "ded_angel_4_weapon_supervisor",
    "ded_angel_6_repair",
    "ded_angel_6_repair_supervisor",
    "ded_angel_6_weapon",
    "ded_angel_6_weapon_supervisor",
    "ded_blood_2_repair",
    "ded_blood_2_repair_supervisor",
    "ded_blood_2_weapon",
    "ded_blood_2_weapon_supervisor",
    "ded_blood_3_repair",
    "ded_blood_3_repair_supervisor",
    "ded_blood_3_weapon",
    "ded_blood_3_weapon_supervisor",
    "ded_blood_4_repair",
    "ded_blood_4_repair_supervisor",
    "ded_blood_4_weapon",
    "ded_blood_4_weapon_supervisor",
    "ded_blood_6_repair",
    "ded_blood_6_repair_supervisor",
    "ded_blood_6_weapon",
    "ded_blood_6_weapon_supervisor",
    "ded_sansha_2_repair",
    "ded_sansha_2_repair_supervisor",
    "ded_sansha_2_weapon",
    "ded_sansha_2_weapon_supervisor",
    "ded_sansha_3_repair",
    "ded_sansha_3_repair_supervisor",
    "ded_sansha_3_weapon",
    "ded_sansha_3_weapon_supervisor",
    "ded_sansha_4_repair",
    "ded_sansha_4_repair_supervisor",
    "ded_sansha_4_weapon",
    "ded_sansha_4_weapon_supervisor",
    "ded_sansha_6_repair",
    "ded_sansha_6_repair_supervisor",
    "ded_sansha_6_weapon",
    "ded_sansha_6_weapon_supervisor",
    "raider_gas_harvester",
    "raider_mining_laser",
    "sansha_mineral_assimilation",
    "shield_ext_small",
    "t1_armor_repairer",
    "t1_capital_armor_array",
    "t1_capital_cannon",
    "t1_capital_laser",
    "t1_capital_missile_array",
    "t1_capital_shield_array",
    "t1_capital_structure_array",
    "t1_cruise_missile_launcher",
    "t1_drone_control",
    "t1_gas_booster",
    "t1_gas_harvester",
    "t1_heavy_missile_launcher",
    "t1_large_armor_repairer",
    "t1_large_cannon",
    "t1_large_laser",
    "t1_large_shield_booster",
    "t1_large_structure_repairer",
    "t1_light_missile_launcher",
    "t1_medium_armor_repairer",
    "t1_medium_cannon",
    "t1_medium_laser",
    "t1_medium_shield_booster",
    "t1_medium_structure_repairer",
    "t1_mining_booster",
    "t1_mining_laser",
    "t1_shield_booster",
    "t1_small_cannon",
    "t1_small_laser",
    "t1_structure_repairer",
    "t2_drone_link",
    "t2_gas_harvester",
    "t2_mining_booster",
    "t2_mining_laser",
    "t3_drone_link",
    "t3_gas_harvester",
    "t3_mining_booster",
    "t3_mining_laser",
    "t4_drone_link",
    "t4_gas_harvester",
    "t4_mining_booster",
    "t4_mining_laser",
    "t5_drone_core",
    "t5_gas_harvester",
    "t5_mining_booster",
    "t5_mining_laser",
  ]);

  // 改装件配方 ID（顺序冻结，精确对应 EQUIPMENT_RECIPES.filter(slot==="rig")，9 系列 × 5 档 = 45）
  const RIG_RECIPE_IDS = Object.freeze([
    "rig_archaeology_fuel_i",
    "rig_archaeology_fuel_ii",
    "rig_archaeology_fuel_iii",
    "rig_archaeology_fuel_iv",
    "rig_archaeology_fuel_v",
    "rig_archaeology_interference_i",
    "rig_archaeology_interference_ii",
    "rig_archaeology_interference_iii",
    "rig_archaeology_interference_iv",
    "rig_archaeology_interference_v",
    "rig_archaeology_scan_i",
    "rig_archaeology_scan_ii",
    "rig_archaeology_scan_iii",
    "rig_archaeology_scan_iv",
    "rig_archaeology_scan_v",
    "rig_armor_capacity_i",
    "rig_armor_capacity_ii",
    "rig_armor_capacity_iii",
    "rig_armor_capacity_iv",
    "rig_armor_capacity_v",
    "rig_gas_speed_i",
    "rig_gas_speed_ii",
    "rig_gas_speed_iii",
    "rig_gas_speed_iv",
    "rig_gas_speed_v",
    "rig_mining_speed_i",
    "rig_mining_speed_ii",
    "rig_mining_speed_iii",
    "rig_mining_speed_iv",
    "rig_mining_speed_v",
    "rig_shield_capacity_i",
    "rig_shield_capacity_ii",
    "rig_shield_capacity_iii",
    "rig_shield_capacity_iv",
    "rig_shield_capacity_v",
    "rig_smelting_speed_i",
    "rig_smelting_speed_ii",
    "rig_smelting_speed_iii",
    "rig_smelting_speed_iv",
    "rig_smelting_speed_v",
    "rig_structure_capacity_i",
    "rig_structure_capacity_ii",
    "rig_structure_capacity_iii",
    "rig_structure_capacity_iv",
    "rig_structure_capacity_v",
  ]);

  // 燃料配方 ID（顺序冻结，精确对应 AMMO_ENG_RECIPES.category==="fuel"）
  const FUEL_RECIPE_IDS = Object.freeze([
    "fuel_t1",
    "fuel_t2",
  ]);

  // 弹药配方 ID（顺序冻结，精确对应 AMMO_ENG_RECIPES.category==="ammunition"）
  const AMMUNITION_RECIPE_IDS = Object.freeze([
    "ammo_laser",
    "ammo_missile",
    "ammo_cannon",
  ]);

  function equipmentRecipeSetAnyRule(achievementId, recipeIds, minValue) {
    return Object.freeze({ achievementId, type: "equipment-recipe-set-any", recipeIds, minValue });
  }
  // Batch C-13：D18 全收集型。集合内每一个 recipeId 的 manufactured 计数都必须 >= minValue 才算达成；
  // 与 set-any 的语义严格互补（any = 存在一个达标；all = 全部达标）。
  function equipmentRecipeSetAllRule(achievementId, recipeIds, minValue) {
    return Object.freeze({ achievementId, type: "equipment-recipe-set-all", recipeIds, minValue });
  }
  function equipmentEnhancementTotalRule(achievementId, totalKey, minValue) {
    return Object.freeze({ achievementId, type: "equipment-enhancement-total", totalKey, minValue });
  }

  // 6 条规则（顺序即求值顺序）：D13 非 rig 装备任一、D14 燃料任一、D15 弹药任一、D16 装备强化累计、
  // D17 rig 任一、D18 rig 全部 45 件（Batch C-13 新增；recipeIds 直接复用冻结的 RIG_RECIPE_IDS，不另立副本）
  const EQUIPMENT_RULES = Object.freeze([
    equipmentRecipeSetAnyRule("D13", NON_RIG_EQUIPMENT_RECIPE_IDS, 1),
    equipmentRecipeSetAnyRule("D14", FUEL_RECIPE_IDS, 1),
    equipmentRecipeSetAnyRule("D15", AMMUNITION_RECIPE_IDS, 1),
    equipmentEnhancementTotalRule("D16", "equipmentEnhancementAttempts", 1),
    equipmentRecipeSetAnyRule("D17", RIG_RECIPE_IDS, 1),
    equipmentRecipeSetAllRule("D18", RIG_RECIPE_IDS, 1),
  ]);

  const EQUIPMENT_RULES_BY_ID = {};
  for (const rule of EQUIPMENT_RULES) EQUIPMENT_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(EQUIPMENT_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-6：增幅剂制造（D01–D12，共 12 项）
  //
  //  规则类型（type）：
  //    - "booster-recipe"    ：production.boosters[recipeId] >= minValue
  //    - "booster-total"     ：totals.boostersManufactured >= minValue
  //
  //  权威累计唯一来源为 gameState.statistics（由冻结的 GameStatistics 消费者维护
  //  production.boosters[recipeId] 与 totals.boostersManufactured；本批
  //  GAME_STATISTICS_VERSION 2→3 新增 boosters 结构）。
  //  本文件不读取事件 payload、不读 inventory、不读 currentAction、不自建第二套累计。
  //
  //  配方集合与 js/data/boosters.js（BOOSTER_RECIPES）双向完全相等（审计交叉证明）。
  //  10 个传奇配方精确对应 D01–D10。
  // ==========================================================================

  // 全部 30 个增幅剂配方 ID（顺序冻结，精确对应 BOOSTER_RECIPES.map(r => r.id)）
  const BOOSTER_RECIPE_IDS = Object.freeze([
    "mining_lubricant_n", "shield_recharge_n", "ore_resonance_n", "laser_coolant_n",
    "relic_solver_n", "armor_nano_n", "missile_catalyst_n", "artifact_tracer_n",
    "cannon_booster_n", "structure_gel_n",
    "mining_lubricant_r", "shield_recharge_r", "ore_resonance_r", "laser_coolant_r",
    "relic_solver_r", "armor_nano_r", "missile_catalyst_r", "artifact_tracer_r",
    "cannon_booster_r", "structure_gel_r",
    "mining_lubricant_l", "shield_recharge_l", "ore_resonance_l", "laser_coolant_l",
    "relic_solver_l", "armor_nano_l", "missile_catalyst_l", "artifact_tracer_l",
    "cannon_booster_l", "structure_gel_l",
  ]);

  // 10 个传奇配方 ID（顺序与 D01→D10 一致）
  const LEGENDARY_BOOSTER_RECIPE_IDS = Object.freeze([
    "mining_lubricant_l",
    "ore_resonance_l",
    "relic_solver_l",
    "artifact_tracer_l",
    "laser_coolant_l",
    "missile_catalyst_l",
    "cannon_booster_l",
    "shield_recharge_l",
    "armor_nano_l",
    "structure_gel_l",
  ]);

  function boosterRecipeRule(achievementId, recipeId, minValue) {
    return Object.freeze({ achievementId, type: "booster-recipe", recipeId, minValue });
  }
  function boosterTotalRule(achievementId, totalKey, minValue) {
    return Object.freeze({ achievementId, type: "booster-total", totalKey, minValue });
  }

  // 12 条规则（顺序即求值顺序）：D01–D10 各自传奇配方 >=1、D11 总制造 >=1、D12 总制造 >=1000
  const BOOSTER_RULES = Object.freeze([
    boosterRecipeRule("D01", LEGENDARY_BOOSTER_RECIPE_IDS[0], 1),  // mining_lubricant_l
    boosterRecipeRule("D02", LEGENDARY_BOOSTER_RECIPE_IDS[1], 1),  // ore_resonance_l
    boosterRecipeRule("D03", LEGENDARY_BOOSTER_RECIPE_IDS[2], 1),  // relic_solver_l
    boosterRecipeRule("D04", LEGENDARY_BOOSTER_RECIPE_IDS[3], 1),  // artifact_tracer_l
    boosterRecipeRule("D05", LEGENDARY_BOOSTER_RECIPE_IDS[4], 1),  // laser_coolant_l
    boosterRecipeRule("D06", LEGENDARY_BOOSTER_RECIPE_IDS[5], 1),  // missile_catalyst_l
    boosterRecipeRule("D07", LEGENDARY_BOOSTER_RECIPE_IDS[6], 1),  // cannon_booster_l
    boosterRecipeRule("D08", LEGENDARY_BOOSTER_RECIPE_IDS[7], 1),  // shield_recharge_l
    boosterRecipeRule("D09", LEGENDARY_BOOSTER_RECIPE_IDS[8], 1),  // armor_nano_l
    boosterRecipeRule("D10", LEGENDARY_BOOSTER_RECIPE_IDS[9], 1),  // structure_gel_l
    boosterTotalRule("D11", "boostersManufactured", 1),
    boosterTotalRule("D12", "boostersManufactured", 1000),
  ]);

  const BOOSTER_RULES_BY_ID = {};
  for (const rule of BOOSTER_RULES) BOOSTER_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(BOOSTER_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-7：考古（F01–F21，共 21 项；F22 属技能规则 SKILL_RULES，不在本组）
  //
  //  规则类型（type）：
  //    - "archaeology-total"    ：totals[totalKey] >= minValue
  //    - "archaeology-site"     ：archaeology.sites[siteId] >= minValue
  //    - "archaeology-tier-set" ：tierKeys 中每一档 archaeology.tiers[tier] >= minValue
  //
  //  权威累计唯一来源为 gameState.statistics（由冻结的 GameStatistics 消费者维护
  //  totals.archaeologyAttempts / artifactsSold / archaeologyLpEarned /
  //  archaeologyRareFinds 与 archaeology.sites / archaeology.tiers；本批
  //  GAME_STATISTICS_VERSION 3→4 新增 archaeology 结构）。
  //  本文件不读取事件 payload、不读 inventory、不读 currentAction、不自建第二套累计。
  //
  //  站点集合与 js/data/archaeology.js（ARCHAEOLOGY_SITES）双向完全相等（审计交叉证明）。
  //  15 个站点精确对应 F02–F16；档位键精确对应 ARCHAEOLOGY_TIERS 的 "I"–"V"。
  // ==========================================================================

  // 全部 15 个考古站点 ID（顺序冻结，精确对应 ARCHAEOLOGY_SITES.map(s => s.id)，
  // 且与 F02→F16 逐项一致：site_i_a=失落信标残骸 … site_v_c=深渊观测站）
  const ARCHAEOLOGY_SITE_IDS = Object.freeze([
    "site_i_a",   // F02 失落信标残骸
    "site_i_b",   // F03 远古殖民舱
    "site_i_c",   // F04 漂流货柜群
    "site_ii_a",  // F05 破碎巡防站
    "site_ii_b",  // F06 废弃采矿平台
    "site_ii_c",  // F07 星图中继塔
    "site_iii_a", // F08 沉睡战列残骸
    "site_iii_b", // F09 湮灭实验室
    "site_iii_c", // F10 深空方尖碑
    "site_iv_a",  // F11 湮灭旗舰坟场
    "site_iv_b",  // F12 虚空研究所
    "site_iv_c",  // F13 远古跃迁枢纽
    "site_v_a",   // F14 失落文明圣殿
    "site_v_b",   // F15 湮灭母舰核心
    "site_v_c",   // F16 深渊观测站
  ]);

  // 全部 5 个考古档位键（顺序冻结，精确对应 ARCHAEOLOGY_TIERS 的 tier 字段取值）
  const ARCHAEOLOGY_TIER_KEYS = Object.freeze([
    "I",
    "II",
    "III",
    "IV",
    "V",
  ]);

  function archaeologyTotalRule(achievementId, totalKey, minValue) {
    return Object.freeze({ achievementId, type: "archaeology-total", totalKey, minValue });
  }
  function archaeologySiteRule(achievementId, siteId, minValue) {
    return Object.freeze({ achievementId, type: "archaeology-site", siteId, minValue });
  }
  function archaeologyTierSetRule(achievementId, tierKeys, minValue) {
    return Object.freeze({ achievementId, type: "archaeology-tier-set", tierKeys, minValue });
  }

  // 21 条规则（顺序即求值顺序）：
  //   F01 首次扫描（尝试 >=1）、F02–F16 各站点首次解析（成功 >=1）、
  //   F17 全部 5 档各成功 >=1、F18 首次出售、F19 累计出售 100、
  //   F20 累计考古 LP 10000、F21 首次稀有掉落（unique）。
  const ARCHAEOLOGY_RULES = Object.freeze([
    archaeologyTotalRule("F01", "archaeologyAttempts", 1),
    archaeologySiteRule("F02", ARCHAEOLOGY_SITE_IDS[0], 1),   // site_i_a 失落信标残骸
    archaeologySiteRule("F03", ARCHAEOLOGY_SITE_IDS[1], 1),   // site_i_b 远古殖民舱
    archaeologySiteRule("F04", ARCHAEOLOGY_SITE_IDS[2], 1),   // site_i_c 漂流货柜群
    archaeologySiteRule("F05", ARCHAEOLOGY_SITE_IDS[3], 1),   // site_ii_a 破碎巡防站
    archaeologySiteRule("F06", ARCHAEOLOGY_SITE_IDS[4], 1),   // site_ii_b 废弃采矿平台
    archaeologySiteRule("F07", ARCHAEOLOGY_SITE_IDS[5], 1),   // site_ii_c 星图中继塔
    archaeologySiteRule("F08", ARCHAEOLOGY_SITE_IDS[6], 1),   // site_iii_a 沉睡战列残骸
    archaeologySiteRule("F09", ARCHAEOLOGY_SITE_IDS[7], 1),   // site_iii_b 湮灭实验室
    archaeologySiteRule("F10", ARCHAEOLOGY_SITE_IDS[8], 1),   // site_iii_c 深空方尖碑
    archaeologySiteRule("F11", ARCHAEOLOGY_SITE_IDS[9], 1),   // site_iv_a 湮灭旗舰坟场
    archaeologySiteRule("F12", ARCHAEOLOGY_SITE_IDS[10], 1),  // site_iv_b 虚空研究所
    archaeologySiteRule("F13", ARCHAEOLOGY_SITE_IDS[11], 1),  // site_iv_c 远古跃迁枢纽
    archaeologySiteRule("F14", ARCHAEOLOGY_SITE_IDS[12], 1),  // site_v_a 失落文明圣殿
    archaeologySiteRule("F15", ARCHAEOLOGY_SITE_IDS[13], 1),  // site_v_b 湮灭母舰核心
    archaeologySiteRule("F16", ARCHAEOLOGY_SITE_IDS[14], 1),  // site_v_c 深渊观测站
    archaeologyTierSetRule("F17", ARCHAEOLOGY_TIER_KEYS, 1),
    archaeologyTotalRule("F18", "artifactsSold", 1),
    archaeologyTotalRule("F19", "artifactsSold", 100),
    archaeologyTotalRule("F20", "archaeologyLpEarned", 10000),
    archaeologyTotalRule("F21", "archaeologyRareFinds", 1),
  ]);

  const ARCHAEOLOGY_RULES_BY_ID = {};
  for (const rule of ARCHAEOLOGY_RULES) ARCHAEOLOGY_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(ARCHAEOLOGY_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-8 行星类（G01–G07、G09、G10；目录无 G08，不得创建幽灵规则）
  //
  //  权威来源（详见批处理规格）：
  //   - G01–G06 首次殖民六类行星：statistics.planetary.deployedTypes[planetType] >= 1
  //     （仅记录真实 PlanetaryStateActions.deploy 成功发射的 planetary:deployed 的 planetType）。
  //   - G07 同时运营 5 颗：statistics.planetary.maxConcurrentDeployments >= 5
  //     （每次成功部署后读取真实 state.planetary.deployments 的 active 数量取 max）。
  //   - G09 累计产出 1,000,000：statistics.totals.planetaryUnits >= 1,000,000
  //     （在线 planetary:completed 与离线 settleOfflinePlanets 共用同一统计链）。
  //   - G10 解锁全部槽位：getPlanetaryCapacityState(state).slots >= .maxSlots
  //     （不写死技能等级；空间站 planetary_control 加成也可能提供槽位）。
  //
  //  六类行星类型与 js/data/planets.js 的 PLANET_TYPES 双向完全一致（审计交叉证明）。
  //  本文件不读取事件 payload、不读 inventory、不读 currentAction、不自建第二套累计。
  // ==========================================================================

  // 全部六个行星类型（顺序冻结，精确对应 PLANET_TYPES.map(p => p.id)，
  // 且与 G01→G06 逐项一致：lava=熔岩 … storm=风暴）
  const PLANETARY_TYPE_IDS = Object.freeze([
    "lava",      // G01 熔岩行星
    "gas",       // G02 气态行星
    "ice",       // G03 冰行星
    "plasma",    // G04 等离子行星
    "temperate", // G05 温带行星
    "storm",     // G06 风暴行星
  ]);

  function planetaryColonizedRule(achievementId, planetType, minValue) {
    return Object.freeze({ achievementId, type: "planetary-colonized", planetType, minValue });
  }
  function planetaryConcurrentRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "planetary-concurrent", minValue });
  }
  function planetaryTotalRule(achievementId, totalKey, minValue) {
    return Object.freeze({ achievementId, type: "planetary-total", totalKey, minValue });
  }
  function planetarySlotsRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "planetary-slots", minValue });
  }

  // 9 条规则（顺序即求值顺序）：G01–G06 各类型首次殖民、G07 同时 5 颗、
  //   G09 累计产出 1,000,000、G10 全槽位（slots >= maxSlots，当前 maxSlots=5）。
  //   目录无 G08，故此处跳过 G08，不产生幽灵规则。
  const PLANETARY_RULES = Object.freeze([
    planetaryColonizedRule("G01", PLANETARY_TYPE_IDS[0], 1), // 熔岩行星
    planetaryColonizedRule("G02", PLANETARY_TYPE_IDS[1], 1), // 气态行星
    planetaryColonizedRule("G03", PLANETARY_TYPE_IDS[2], 1), // 冰行星
    planetaryColonizedRule("G04", PLANETARY_TYPE_IDS[3], 1), // 等离子行星
    planetaryColonizedRule("G05", PLANETARY_TYPE_IDS[4], 1), // 温带行星
    planetaryColonizedRule("G06", PLANETARY_TYPE_IDS[5], 1), // 风暴行星
    planetaryConcurrentRule("G07", 5),                        // 同时运营 5 颗行星
    planetaryTotalRule("G09", "planetaryUnits", 1000000),     // 累计行星产出 1,000,000
    planetarySlotsRule("G10", 5),                             // 解锁全部行星槽位（slots >= maxSlots）
  ]);

  const PLANETARY_RULES_BY_ID = {};
  for (const rule of PLANETARY_RULES) PLANETARY_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(PLANETARY_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-9 空间站类（H01–H13、H15、H16，共 15 项；目录无 H14，不得创建幽灵规则）
  //
  //  权威来源（详见批处理规格）：
  //   - H01/H02 本体等级：state.station.bodyLevel >= 1 / >= 3（当前权威状态，非事件 payload）。
  //   - H03–H10、H16 建筑等级：state.station.buildings[buildingId] >= 3
  //     （八建筑 ID 与 js/core/state.js 的 STATION_BUILDING_IDS 逐项一致；
  //      H10 与 H16 条件重复——都要求 shipyard Lv.3——但必须是两条独立规则、同批解锁）。
  //   - H11 首次建设完成：statistics.station.constructionCompletions >= 1
  //     （仅记录真实 completeStationConstruction 发射的 station:constructionCompleted）。
  //   - H12 三条自动线同时运行：statistics.station.maxConcurrentAutoLines >= 3
  //     （每次 station:autoLineStarted 后读取真实 state.station.autoLines 的 enabled 数量取 max）。
  //   - H13 物流枢纽满级效果：真实 getStationLogisticsMultiplier(state) >= 1.03
  //     （断油/未运行时倍率为 1，不得仅看 bodyLevel === 3）。
  //   - H15 单次离线结算超过 8 小时：statistics.station.maxOfflineSettlementSeconds > 28800
  //     （严格大于：28800 不解锁、28801 解锁；仅由真实 offline:settlementCompleted 累计）。
  //
  //  本文件不读取事件 payload、不读 conditionText、不自建第二套累计。
  // ==========================================================================

  // 全部八个空间站建筑 ID（顺序冻结，精确对应 js/core/state.js 的 STATION_BUILDING_IDS）
  const STATION_BUILDING_IDS_FOR_ACHIEVEMENTS = Object.freeze([
    "resource_dispatch", // H03 资源调度中心
    "planetary_control", // H04 行星管理中心
    "smelting_refinery", // H05 冶炼精炼厂
    "equipment_factory", // H06 装备工厂
    "booster_factory",   // H07 增幅剂工厂
    "archaeology_lab",   // H08 考古实验室
    "combat_command",    // H09 战斗指挥部
    "shipyard",          // H10 / H16 旗舰船坞
  ]);

  function stationBodyLevelRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "station-body-level", minValue });
  }
  function stationBuildingLevelRule(achievementId, buildingId, minValue) {
    return Object.freeze({ achievementId, type: "station-building-level", buildingId, minValue });
  }
  function stationStatRule(achievementId, statKey, minValue) {
    return Object.freeze({ achievementId, type: "station-stat", statKey, minValue });
  }
  function stationLogisticsRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "station-logistics-multiplier", minValue });
  }
  function stationOfflineExceedsRule(achievementId, exceedsValue) {
    return Object.freeze({ achievementId, type: "station-offline-exceeds", statKey: "maxOfflineSettlementSeconds", exceedsValue });
  }

  // 15 条规则（顺序即求值顺序）：H01,H02,H03,H04,H05,H06,H07,H08,H09,H10,H11,H12,H13,H15,H16。
  //   目录无 H14，故此处跳过 H14，不产生幽灵规则。
  //   H10 与 H16 都映射 shipyard Lv.3，但 achievementId 独立、各自解锁。
  const STATION_RULES = Object.freeze([
    stationBodyLevelRule("H01", 1),                                                   // 空间站本体 Lv.1
    stationBodyLevelRule("H02", 3),                                                   // 空间站本体 Lv.3
    stationBuildingLevelRule("H03", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[0], 3),     // 资源调度中心 Lv.3
    stationBuildingLevelRule("H04", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[1], 3),     // 行星管理中心 Lv.3
    stationBuildingLevelRule("H05", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[2], 3),     // 冶炼精炼厂 Lv.3
    stationBuildingLevelRule("H06", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[3], 3),     // 装备工厂 Lv.3
    stationBuildingLevelRule("H07", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[4], 3),     // 增幅剂工厂 Lv.3
    stationBuildingLevelRule("H08", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[5], 3),     // 考古实验室 Lv.3
    stationBuildingLevelRule("H09", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[6], 3),     // 战斗指挥部 Lv.3
    stationBuildingLevelRule("H10", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[7], 3),     // 旗舰船坞 Lv.3
    stationStatRule("H11", "constructionCompletions", 1),                             // 首次建设完成
    stationStatRule("H12", "maxConcurrentAutoLines", 3),                              // 三条自动线同时运行
    stationLogisticsRule("H13", 1.03),                                                // 物流枢纽满级效果（真实倍率 >= 1.03）
    stationOfflineExceedsRule("H15", 28800),                                          // 单次离线结算 > 8 小时（严格大于）
    stationBuildingLevelRule("H16", STATION_BUILDING_IDS_FOR_ACHIEVEMENTS[7], 3),     // 旗舰船坞 Lv.3（与 H10 同条件、独立规则）
  ]);

  const STATION_RULES_BY_ID = {};
  for (const rule of STATION_RULES) STATION_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(STATION_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-10A2：蓝图首次获得类 1 项（C11）
  //
  //  规则类型（type）：
  //    - "blueprint-owned-any" ：state.ownedBlueprints 中至少存在一个
  //      BLUEPRINT_OWNERSHIP_KEYS 内的真实合法 ownershipKey 即满足（minValue:1）。
  //
  //  ownershipKey 由权威目录 getBlueprintStoreCatalogItems() 确定性生成：
  //    - 舰船蓝图 item.kind === "shipBlueprint" → blueprint.shipId
  //    - 装备蓝图 item.kind === "equipmentBlueprint" → getEquipmentBlueprintOwnershipKey(item.equipmentId)
  //  只接受两种蓝图 kind，去重、顺序确定、冻结；不含普通 LP 商店装备、不含价格/名称/UI 字段。
  //  本文件不读取事件 payload、不自建第二套累计；C11 不进入任何既有规则集合。
  // ==========================================================================

  // 从权威目录确定性生成 ownershipKey 集合（去重、顺序确定、冻结）
  const BLUEPRINT_OWNERSHIP_KEYS = (function buildBlueprintOwnershipKeys() {
    const seen = new Set();
    const keys = [];
    const catalog = (typeof getBlueprintStoreCatalogItems === "function") ? getBlueprintStoreCatalogItems() : [];
    for (const item of catalog) {
      if (!item || typeof item !== "object") continue;
      let key = null;
      if (item.kind === "shipBlueprint") {
        key = (item.shipId != null) ? String(item.shipId) : null;
      } else if (item.kind === "equipmentBlueprint") {
        key = (typeof getEquipmentBlueprintOwnershipKey === "function")
          ? getEquipmentBlueprintOwnershipKey(item.equipmentId) : null;
      } else {
        continue; // 普通 LP 商店装备（kind:"equipment" 等）不进入蓝图成就集合
      }
      if (key == null || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    return Object.freeze(keys);
  })();

  function blueprintOwnedAnyRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "blueprint-owned-any", minValue });
  }

  // 仅 1 项规则：C11（blueprint-owned-any, minValue:1）
  const BLUEPRINT_RULES = Object.freeze([
    blueprintOwnedAnyRule("C11", 1),
  ]);

  const BLUEPRINT_RULES_BY_ID = {};
  for (const rule of BLUEPRINT_RULES) BLUEPRINT_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(BLUEPRINT_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-13：经济（I01–I12，共 12 项）
  //
  //  规则类型（type）：
  //    - "economy-resource-min"      ：ResourceRegistry.get(state, resourceId) >= minValue
  //    - "economy-resource-set-all"  ：resourceIds 中每一个的当前持有量都 >= minValue
  //    - "economy-inventory-total"   ：ResourceRegistry.getInventoryTotal(state) > minValue（严格大于）
  //
  //  权威来源唯一为 ResourceRegistry 的**当前持有量**（不是累计产出、不读 statistics、
  //  不读事件 payload、不自建第二套计数）。因此卖出/消耗会让进度回落，这是"持有"语义的
  //  必然结果；成就一旦解锁则由 unlockAchievement 幂等保证不回撤。
  //
  //  资源 ID 必须使用 ResourceRegistry 的真实命名空间（namespace:key），
  //  与 js/systems/production.js 的 ITEM_CATEGORIES 分类严格一致：
  //    ITEM_CATEGORIES.mineral 含「莫尔石」；ITEM_CATEGORIES.moon 不含「莫尔石」。
  //  故 I11 的莫尔石权威 ID 是 mineral:莫尔石（与 js/data/combat.js 外环掉落
  //  resourceId:"mineral:莫尔石" 同池），**不存在 moon:莫尔石**，也不得为其创建别名或兼容键。
  //  即使坏档把旧 moonOres 池里的「莫尔石」键伪造为正数，也不满足 I11
  //  （求值一律经 ResourceRegistry 按 namespace:key 寻址，不直接触碰旧资源池）。
  // ==========================================================================

  // I04–I10 的 7 种基础矿物（顺序即 I04→I10；注意不含「莫尔石」——它是 I11 的高级材料）
  const ECONOMY_MINERAL_RESOURCE_IDS = Object.freeze([
    "mineral:三钛合金",
    "mineral:类银超金属",
    "mineral:类晶体胶矿",
    "mineral:同位聚合体",
    "mineral:超新星诺克石",
    "mineral:基腹断岩",
    "mineral:超噬矿",
  ]);

  // I11 的 4 种高级战略材料（跨 moon / mineral / planetary 三个命名空间，各以真实库存池为准）
  const ECONOMY_COLLECTION_RESOURCE_IDS = Object.freeze([
    "moon:铷",
    "mineral:莫尔石",
    "planetary:等离子体",
    "planetary:磁场聚合物",
  ]);

  function economyResourceMinRule(achievementId, resourceId, minValue) {
    return Object.freeze({ achievementId, type: "economy-resource-min", resourceId, minValue });
  }
  function economyResourceSetAllRule(achievementId, resourceIds, minValue) {
    return Object.freeze({ achievementId, type: "economy-resource-set-all", resourceIds, minValue });
  }
  function economyInventoryTotalRule(achievementId, minValue) {
    return Object.freeze({ achievementId, type: "economy-inventory-total", minValue });
  }

  // 12 条规则（顺序即求值顺序，I01→I12）
  const ECONOMY_RULES = Object.freeze([
    economyResourceMinRule("I01", "currency:isk", 1000000),
    economyResourceMinRule("I02", "currency:isk", 100000000),
    economyResourceMinRule("I03", "currency:isk", 1000000000),
    economyResourceMinRule("I04", ECONOMY_MINERAL_RESOURCE_IDS[0], 1000),
    economyResourceMinRule("I05", ECONOMY_MINERAL_RESOURCE_IDS[1], 1000),
    economyResourceMinRule("I06", ECONOMY_MINERAL_RESOURCE_IDS[2], 1000),
    economyResourceMinRule("I07", ECONOMY_MINERAL_RESOURCE_IDS[3], 1000),
    economyResourceMinRule("I08", ECONOMY_MINERAL_RESOURCE_IDS[4], 1000),
    economyResourceMinRule("I09", ECONOMY_MINERAL_RESOURCE_IDS[5], 1000),
    economyResourceMinRule("I10", ECONOMY_MINERAL_RESOURCE_IDS[6], 1000),
    economyResourceSetAllRule("I11", ECONOMY_COLLECTION_RESOURCE_IDS, 1),
    economyInventoryTotalRule("I12", 1000000),
  ]);

  const ECONOMY_RULES_BY_ID = {};
  for (const rule of ECONOMY_RULES) ECONOMY_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(ECONOMY_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-14A：综合（J01–J06，共 6 项）
  //
  //  规则类型（type）—— 权威来源一律为 statistics.lifecycle，不读事件 payload、
  //  不读 UI、不自建第二套计数：
  //    - "lifecycle-online-seconds"        ：statistics.lifecycle.onlineSeconds        >= minValue
  //    - "lifecycle-offline-settlements"   ：statistics.lifecycle.offlineSettlements   >= minValue
  //    - "lifecycle-offline-seconds"       ：statistics.lifecycle.offlineSettledSeconds>= minValue
  //    - "lifecycle-max-queue-items"       ：statistics.lifecycle.maxQueueItems        >= minValue
  //    - "lifecycle-combat-repair-resumes" ：statistics.lifecycle.combatRepairResumes  >= minValue
  //
  //  这五个字段都是单调不减的累计/历史极值，因此 J01–J06 的进度不会像经济类那样回落。
  //  本批只实装 J01–J06；J10/J11/J12（元成就）留待下一批，目录中保持 trigger=null。
  // ==========================================================================

  function generalLifecycleRule(achievementId, type, minValue) {
    return Object.freeze({ achievementId, type, minValue });
  }

  // 6 条规则（顺序即求值顺序，J01→J06）
  const GENERAL_RULES = Object.freeze([
    // 累计在线 24 小时 = 86400 秒
    generalLifecycleRule("J01", "lifecycle-online-seconds", 86400),
    // 累计在线 7 天 = 604800 秒
    generalLifecycleRule("J02", "lifecycle-online-seconds", 604800),
    // 首次真实离线收益结算（offline.js 对 <=5 秒不结算、不发事件）
    generalLifecycleRule("J03", "lifecycle-offline-settlements", 1),
    // 累计离线结算等价 7 天 = 604800 秒（单次上限 86400，故至少需 7 次满额离线）
    generalLifecycleRule("J04", "lifecycle-offline-seconds", 604800),
    // 队列历史同时在列达到 25 项
    generalLifecycleRule("J05", "lifecycle-max-queue-items", 25),
    // 首次重创维修后真实恢复出击
    generalLifecycleRule("J06", "lifecycle-combat-repair-resumes", 1),
  ]);

  const GENERAL_RULES_BY_ID = {};
  for (const rule of GENERAL_RULES) GENERAL_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(GENERAL_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-14B：元成就（J10 / J11 / J12，共 3 项）
  //
  //  规则类型（type）—— 权威来源一律为「AchievementData 真实目录 ∩
  //  state.achievements.unlockedAtById 的合法解锁时间」，不读 statistics、
  //  不读事件 payload、不自建第二套计数：
  //    - "meta-non-meta-count"   ：目录中**非元成就**的已解锁项数 >= minValue
  //    - "meta-catalog-complete" ：目录中除 excludeIds（仅自身 J12）以外的
  //                                每一项都已解锁（因此必然含 J10 与 J11）
  //
  //  自我抬高防护：META_ACHIEVEMENT_IDS 三项在 J10/J11 计数时一律排除，
  //  元成就自身解锁不得把 J10/J11 的门槛推过线。
  //  幽灵防护：计数只遍历真实目录 AchievementData.ACHIEVEMENTS，
  //  存档里的未知 ID 与非法时间（非数字/NaN/Infinity/负数）都不计数。
  //  J12 不硬编码 196 个 ID 副本，运行时按真实目录逐项检查。
  // ==========================================================================

  // 三项元成就 ID（顺序冻结，J10→J11→J12；J10/J11 计数时必须排除本集合）
  const META_ACHIEVEMENT_IDS = Object.freeze(["J10", "J11", "J12"]);

  function metaNonMetaCountRule(achievementId, minValue) {
    return Object.freeze({
      achievementId,
      type: "meta-non-meta-count",
      excludeIds: META_ACHIEVEMENT_IDS,
      minValue,
    });
  }
  function metaCatalogCompleteRule(achievementId) {
    // excludeIds 只含自身：目录中其余全部成就（含 J10/J11）都必须已解锁
    return Object.freeze({
      achievementId,
      type: "meta-catalog-complete",
      excludeIds: Object.freeze([achievementId]),
    });
  }

  // 3 条规则（顺序即求值顺序，J10→J11→J12；一次求值允许顺序补齐）
  const META_RULES = Object.freeze([
    metaNonMetaCountRule("J10", 50),   // 达成 50 项非元成就
    metaNonMetaCountRule("J11", 100),  // 达成 100 项非元成就
    metaCatalogCompleteRule("J12"),    // 目录中除 J12 自身外全部成就
  ]);

  const META_RULES_BY_ID = {};
  for (const rule of META_RULES) META_RULES_BY_ID[rule.achievementId] = rule;
  Object.freeze(META_RULES_BY_ID);

  // ==========================================================================
  //  Batch C-14B：十三组规则的全局合并视图
  //
  //  ACHIEVEMENT_RULES        ：按分组顺序拼接的全部已映射规则（唯一真实总量）
  //  ACHIEVEMENT_RULES_BY_ID  ：achievementId → rule 的全局索引
  //
  //  数量恒等式：50 skill + 18 production + 32 combat + 12 manufacturing + 6 equipment
  //            + 12 booster + 21 archaeology + 9 planetary + 15 station + 1 blueprint
  //            + 12 economy + 6 general + 3 meta = 197；目录共 197 项，
  //            未映射 197 - 197 = 0（全目录已映射）。
  //  十三组的 achievementId 两两零交集（重复即为构建期错误，直接抛出）。
  // ==========================================================================
  const ACHIEVEMENT_RULE_GROUPS = Object.freeze([
    SKILL_RULES, PRODUCTION_RULES, COMBAT_RULES, MANUFACTURING_RULES, EQUIPMENT_RULES,
    BOOSTER_RULES, ARCHAEOLOGY_RULES, PLANETARY_RULES, STATION_RULES, BLUEPRINT_RULES,
    ECONOMY_RULES, GENERAL_RULES, META_RULES,
  ]);

  const ACHIEVEMENT_RULES_BY_ID = {};
  const ACHIEVEMENT_RULES = Object.freeze((() => {
    const merged = [];
    for (const group of ACHIEVEMENT_RULE_GROUPS) {
      for (const rule of group) {
        if (ACHIEVEMENT_RULES_BY_ID[rule.achievementId]) {
          throw new Error("成就规则 ID 跨组重复：" + rule.achievementId);
        }
        ACHIEVEMENT_RULES_BY_ID[rule.achievementId] = rule;
        merged.push(rule);
      }
    }
    return merged;
  })());
  Object.freeze(ACHIEVEMENT_RULES_BY_ID);

  const AchievementRuleData = Object.freeze({
    schemaVersion: 1,
    ALL_SKILL_KEYS,
    COMBAT_SKILL_KEYS,
    SKILL_RULES,
    SKILL_RULES_BY_ID,
    PRODUCTION_RULES,
    PRODUCTION_RULES_BY_ID,
    COMBAT_ZONE_IDS,
    CAPITAL_COMBAT_ZONE_IDS,
    SUPERCAPITAL_COMBAT_ZONE_IDS,
    COMBAT_WEAPON_TYPES,
    COMBAT_RULES,
    COMBAT_RULES_BY_ID,
    DEATHSPACE_IDS_FOR_ACHIEVEMENTS,
    SHIP_COMPONENT_RECIPE_IDS,
    CAPITAL_SHIP_RECIPE_IDS,
    SUPERCAPITAL_SHIP_RECIPE_IDS,
    MANUFACTURING_RULES,
    MANUFACTURING_RULES_BY_ID,
    NON_RIG_EQUIPMENT_RECIPE_IDS,
    RIG_RECIPE_IDS,
    FUEL_RECIPE_IDS,
    AMMUNITION_RECIPE_IDS,
    EQUIPMENT_RULES,
    EQUIPMENT_RULES_BY_ID,
    BOOSTER_RECIPE_IDS,
    LEGENDARY_BOOSTER_RECIPE_IDS,
    BOOSTER_RULES,
    BOOSTER_RULES_BY_ID,
    ARCHAEOLOGY_SITE_IDS,
    ARCHAEOLOGY_TIER_KEYS,
    ARCHAEOLOGY_RULES,
    ARCHAEOLOGY_RULES_BY_ID,
    PLANETARY_TYPE_IDS,
    PLANETARY_RULES,
    PLANETARY_RULES_BY_ID,
    STATION_BUILDING_IDS_FOR_ACHIEVEMENTS,
    STATION_RULES,
    STATION_RULES_BY_ID,
    BLUEPRINT_OWNERSHIP_KEYS,
    BLUEPRINT_RULES,
    BLUEPRINT_RULES_BY_ID,
    ECONOMY_MINERAL_RESOURCE_IDS,
    ECONOMY_COLLECTION_RESOURCE_IDS,
    ECONOMY_RULES,
    ECONOMY_RULES_BY_ID,
    GENERAL_RULES,
    GENERAL_RULES_BY_ID,
    META_ACHIEVEMENT_IDS,
    META_RULES,
    META_RULES_BY_ID,
    ACHIEVEMENT_RULE_GROUPS,
    ACHIEVEMENT_RULES,
    ACHIEVEMENT_RULES_BY_ID,
  });

  if (typeof window !== "undefined") window.AchievementRuleData = AchievementRuleData;
  if (typeof globalThis !== "undefined") globalThis.AchievementRuleData = AchievementRuleData;
})();
