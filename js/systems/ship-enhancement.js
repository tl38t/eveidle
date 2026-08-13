/* ================================================================
   舰船强化 — 纯规则与数值层

   强化等级保存在舰船实例上；本文件不写 gameState、不操作 DOM。
   成功率委托 enhancement-chance.js 共用边际递减公式（2026-07-24）。
   ================================================================ */

const SHIP_ENHANCEMENT_TIERS = Object.freeze([
  Object.freeze({ level:1, componentIds:Object.freeze(["integrated_hull", "power_core", "functional_system"]) }),
  Object.freeze({ level:15, componentIds:Object.freeze(["destroyer_integrated_hull", "destroyer_power_core", "destroyer_functional_system"]) }),
  Object.freeze({ level:35, componentIds:Object.freeze(["cruiser_integrated_hull", "cruiser_power_core", "cruiser_functional_system"]) }),
  Object.freeze({ level:55, componentIds:Object.freeze(["battleship_integrated_hull", "battleship_power_core", "battleship_functional_system"]) }),
  Object.freeze({ level:80, componentIds:Object.freeze(["capital_integrated_hull", "capital_power_core", "capital_functional_system"]) }),
  Object.freeze({ level:90, componentIds:Object.freeze(["supercapital_integrated_hull", "supercapital_power_core", "supercapital_functional_system"]) })
]);

function normalizeShipEnhancementLevel(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function getShipManufacturingLevel(shipConfig) {
  if (!shipConfig) return null;
  const assembly = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.shipId === shipConfig.id);
  if (assembly) return assembly.level;
  const type = String(shipConfig.type || "");
  if (type.includes("battleship")) return 55;
  if (type.includes("cruiser")) return 35;
  if (type.includes("destroyer")) return 15;
  if (type === "supercapital") return 90;
  if (type === "capital" || type === "industrial_capital" || type === "archaeology_capital") return 80;
  if (type.includes("frigate")) return 1;
  return null;
}

function getShipEnhancementTier(shipConfig) {
  const level = getShipManufacturingLevel(shipConfig);
  return [...SHIP_ENHANCEMENT_TIERS].reverse().find(tier => level >= tier.level) || null;
}

function isIndustrialShipConfig(shipConfig) {
  return Boolean(shipConfig && typeof INDUSTRIAL_SHIPS !== "undefined" && INDUSTRIAL_SHIPS[shipConfig.id]);
}

function isArchaeologyShipConfig(shipConfig) {
  return Boolean(shipConfig && typeof ARCHAEOLOGY_SHIPS !== "undefined" && ARCHAEOLOGY_SHIPS[shipConfig.id]);
}

function getShipEnhancementRole(shipConfig) {
  if (!shipConfig) return "unknown";
  if (isArchaeologyShipConfig(shipConfig)) return "archaeology";
  if (!isIndustrialShipConfig(shipConfig)) return "combat";
  const bonuses = shipConfig.bonuses || {};
  if (bonuses.miningLaserEfficiency && bonuses.gasLaserEfficiency) return "industry-dual";
  if (bonuses.gasLaserEfficiency) return "gas";
  return "mining";
}

function getShipEnhancementCost(shipConfig) {
  const tier = getShipEnhancementTier(shipConfig);
  return tier ? Object.fromEntries(tier.componentIds.map(id => [id, 1])) : {};
}

// 舰船强化「星币消耗」：按制造等级分层（与组件分层同档），单次固定、不随强化等级递增。
// 设计锚点：单次 ≈ 该档满装小时收入的 ~2.5%，使 0→20 满强化 ≈ 2 小时 farm 收入，
// 既给星币持续的后期存在感，又不惩罚（~40 次尝试/小时的收入即可覆盖单次）。
const SHIP_ENHANCEMENT_ISK_BY_TIER = Object.freeze({
  1: 50000,    // 护卫（rifter）
  15: 80000,   // 驱逐（gale 等）
  35: 200000,  // 巡洋（thunder 等）
  55: 350000,  // 战列（dawnbreaker 等）
  80: 600000,  // 旗舰
  90: 1000000  // 超级旗舰
});
function getShipEnhancementIskCost(shipConfig) {
  const tier = getShipEnhancementTier(shipConfig);
  return tier ? (SHIP_ENHANCEMENT_ISK_BY_TIER[tier.level] || 0) : 0;
}

function getShipEnhancementBaseXp(shipConfig) {
  const tier = getShipEnhancementTier(shipConfig);
  if (!tier) return 0;
  const setXp = tier.componentIds.reduce((sum, id) => {
    const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === id);
    return sum + (recipe ? Number(recipe.xp) || 0 : 0);
  }, 0);
  return Math.round(setXp * 0.5);
}

function getShipEnhancementSuccessChance(shipEngineeringLevel, manufacturingLevel, currentLevel) {
  return getEnhancementChance(shipEngineeringLevel, manufacturingLevel, currentLevel);
}

function getShipEnhancementSuccessBreakdown(shipEngineeringLevel, manufacturingLevel, currentLevel) {
  return getEnhancementChanceBreakdown(shipEngineeringLevel, manufacturingLevel, currentLevel);
}

function getShipEnhancementSuccessXp(shipConfig, currentLevel) {
  const baseXp = getShipEnhancementBaseXp(shipConfig);
  return Math.round(baseXp * (1 + 0.2 * normalizeShipEnhancementLevel(currentLevel)));
}

function getShipEnhancementFailureXp(shipConfig) {
  return 0; // 2026-07-24：失败 0 XP（与装备强化一致）
}

// 冶炼侧舰船强化乘子：仅享受工业强化幅度的 50%（采矿/采气为全幅 industryMultiplier）。
// 非工业船 industryMultiplier 恒为 1 → 本函数返回 1，对战斗/考古船无副作用。
const SHIP_ENHANCE_SMELT_RATIO = 0.5;

function getShipEnhancementSmeltMultiplier(shipConfig, enhancementLevel) {
  const b = getShipEnhancementBonuses(shipConfig, enhancementLevel);
  const full = (b && b.industryMultiplier) || 1;
  return 1 + (full - 1) * SHIP_ENHANCE_SMELT_RATIO;
}

function getShipEnhancementBonuses(shipConfig, enhancementLevel) {
  const level = normalizeShipEnhancementLevel(enhancementLevel);
  const blocks = Math.floor(level / 5);
  const remainder = level % 5;
  const role = getShipEnhancementRole(shipConfig);
  if (role === "combat") {
    return {
      role,
      hpMultiplier:1 + blocks * 0.05 + remainder * 0.005,
      damageMultiplier:1 + blocks * 0.025 + remainder * 0.0025,
      industryMultiplier:1
    };
  }
  if (role === "archaeology") {
    // 考古船可参与战斗，但舰船强化只成长生命与扫描，不增加战斗伤害。
    // damageMultiplier / industryMultiplier 恒为 1（安全中性），避免战斗选择器拿到 undefined/NaN。
    const growth = 1 + blocks * 0.05 + remainder * 0.005;
    return {
      role,
      hpMultiplier:growth,
      damageMultiplier:1,
      industryMultiplier:1,
      archaeologyScanMultiplier:growth
    };
  }
  return {
    role,
    hpMultiplier:1,
    damageMultiplier:1,
    industryMultiplier:1 + blocks * 0.075 + remainder * 0.0075
  };
}

function isShipEnhancementMilestone(level) {
  const normalized = normalizeShipEnhancementLevel(level);
  return normalized > 0 && normalized % 5 === 0;
}

window.ShipEnhancement = Object.freeze({
  normalizeLevel:normalizeShipEnhancementLevel,
  getManufacturingLevel:getShipManufacturingLevel,
  getTier:getShipEnhancementTier,
  getRole:getShipEnhancementRole,
  getCost:getShipEnhancementCost,
  getIskCost:getShipEnhancementIskCost,
  getBaseXp:getShipEnhancementBaseXp,
  getSuccessChance:getShipEnhancementSuccessChance,
  getSuccessBreakdown:getShipEnhancementSuccessBreakdown,
  getSuccessXp:getShipEnhancementSuccessXp,
  getFailureXp:getShipEnhancementFailureXp,
  getBonuses:getShipEnhancementBonuses,
  getSmeltMultiplier:getShipEnhancementSmeltMultiplier,
  isMilestone:isShipEnhancementMilestone
});
