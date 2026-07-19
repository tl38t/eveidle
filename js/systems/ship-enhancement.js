/* ================================================================
   舰船强化 — 纯规则与数值层

   强化等级保存在舰船实例上；本文件不写 gameState、不操作 DOM。
   ================================================================ */

const SHIP_ENHANCEMENT_TIERS = Object.freeze([
  Object.freeze({ level:1, componentIds:Object.freeze(["integrated_hull", "power_core", "functional_system"]) }),
  Object.freeze({ level:15, componentIds:Object.freeze(["destroyer_integrated_hull", "destroyer_power_core", "destroyer_functional_system"]) }),
  Object.freeze({ level:35, componentIds:Object.freeze(["cruiser_integrated_hull", "cruiser_power_core", "cruiser_functional_system"]) }),
  Object.freeze({ level:55, componentIds:Object.freeze(["battleship_integrated_hull", "battleship_power_core", "battleship_functional_system"]) })
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

function getShipEnhancementRole(shipConfig) {
  if (!shipConfig) return "unknown";
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
  const skillLevel = Math.max(1, Number(shipEngineeringLevel) || 1);
  const threshold = Math.max(1, Number(manufacturingLevel) || 1);
  const enhancement = normalizeShipEnhancementLevel(currentLevel);
  return Math.max(0.05, Math.min(0.95, 0.50 + 0.02 * (skillLevel - threshold) - 0.01 * enhancement));
}

function getShipEnhancementSuccessXp(shipConfig, currentLevel) {
  const baseXp = getShipEnhancementBaseXp(shipConfig);
  return Math.round(baseXp * (1 + 0.2 * normalizeShipEnhancementLevel(currentLevel)));
}

function getShipEnhancementFailureXp(shipConfig) {
  return Math.round(getShipEnhancementBaseXp(shipConfig) * 0.5);
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
  getBaseXp:getShipEnhancementBaseXp,
  getSuccessChance:getShipEnhancementSuccessChance,
  getSuccessXp:getShipEnhancementSuccessXp,
  getFailureXp:getShipEnhancementFailureXp,
  getBonuses:getShipEnhancementBonuses,
  isMilestone:isShipEnhancementMilestone
});
