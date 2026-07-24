/* ================================================================
   旗舰战斗规则 — 纯函数层

   只描述索敌决策与舰体固有特性，不读取/写入 gameState，不操作 DOM。
   ================================================================ */

const CAPITAL_TARGETING_MODES = Object.freeze([
  Object.freeze({ id:"formation", name:"按编队顺序" }),
  Object.freeze({ id:"elite", name:"优先精英" }),
  Object.freeze({ id:"boss", name:"优先BOSS" }),
  Object.freeze({ id:"highest_damage", name:"优先最高攻击" }),
  Object.freeze({ id:"lowest_hp", name:"优先最低生命" })
]);

function isCapitalCombatShip(shipConfig) {
  return Boolean(shipConfig && (shipConfig.type === "capital" || shipConfig.type === "supercapital"));
}

function normalizeCapitalTargetingMode(mode) {
  const value = String(mode || "formation");
  return CAPITAL_TARGETING_MODES.some(item => item.id === value) ? value : "formation";
}

function getCapitalTargetingModeName(mode) {
  const normalized = normalizeCapitalTargetingMode(mode);
  const item = CAPITAL_TARGETING_MODES.find(option => option.id === normalized);
  return item ? item.name : CAPITAL_TARGETING_MODES[0].name;
}

function getCombatEnemyTotalHp(enemy) {
  if (!enemy || !enemy.hp) return Number.POSITIVE_INFINITY;
  return ["shield", "armor", "structure"].reduce((sum, layer) => sum + Math.max(0, Number(enemy.hp[layer]) || 0), 0);
}

function selectCapitalCombatTarget(enemies, mode, shipConfig) {
  const living = (Array.isArray(enemies) ? enemies : []).filter(enemy => enemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  if (living.length === 0) return null;
  if (!isCapitalCombatShip(shipConfig)) return living[0];
  const normalized = normalizeCapitalTargetingMode(mode);
  if (normalized === "elite") return living.find(enemy => enemy.kind === "elite") || living[0];
  if (normalized === "boss") return living.find(enemy => enemy.kind === "boss") || living[0];
  if (normalized === "highest_damage") {
    return living.reduce((selected, enemy) => (Number(enemy.baseDamage) || 0) > (Number(selected.baseDamage) || 0) ? enemy : selected, living[0]);
  }
  if (normalized === "lowest_hp") {
    return living.reduce((selected, enemy) => getCombatEnemyTotalHp(enemy) < getCombatEnemyTotalHp(selected) ? enemy : selected, living[0]);
  }
  return living[0];
}

function getCapitalCombatTrait(shipConfig) {
  return isCapitalCombatShip(shipConfig) && shipConfig.capitalTrait ? shipConfig.capitalTrait : null;
}

function applyCapitalShieldMitigation(shipConfig, damage, shieldHitsUsed, currentShield) {
  const trait = getCapitalCombatTrait(shipConfig);
  const baseDamage = Math.max(0, Number(damage) || 0);
  if (!trait || trait.id !== "deflection_shield" || currentShield <= 0 || baseDamage <= 0 || shieldHitsUsed >= trait.shieldHits) {
    return { damage:baseDamage, mitigated:0, shieldHitUsed:false };
  }
  const reducedDamage = baseDamage * (1 - trait.reduction);
  return { damage:reducedDamage, mitigated:baseDamage - reducedDamage, shieldHitUsed:true };
}

function getCapitalReactiveArmorRepair(shipConfig, armorDamageTaken, maxArmor) {
  const trait = getCapitalCombatTrait(shipConfig);
  if (!trait || trait.id !== "reactive_armor") return 0;
  const restored = Math.max(0, Number(armorDamageTaken) || 0) * trait.restoreRate;
  const cap = Math.max(0, Number(maxArmor) || 0) * trait.maxArmorRate;
  return Math.max(0, Math.round(Math.min(restored, cap)));
}

function getCapitalWeaponTraitMultiplier(shipConfig, weaponType, hp, maxHp) {
  const trait = getCapitalCombatTrait(shipConfig);
  if (!trait || trait.id !== "structure_overdrive" || weaponType !== "cannon") return 1;
  const maximum = Math.max(1, Number(maxHp && maxHp.structure) || 1);
  const current = Math.max(0, Math.min(maximum, Number(hp && hp.structure) || 0));
  const missingRatio = 1 - current / maximum;
  const layers = Math.min(trait.maxLayers, Math.floor((missingRatio + 1e-9) / 0.10));
  return 1 + layers * trait.perLayer;
}

function getCapitalAreaDamageTargets(enemies, primaryEnemy, aoeConfig) {
  if (!aoeConfig || !primaryEnemy) return [];
  const living = (Array.isArray(enemies) ? enemies : []).filter(enemy =>
    enemy && enemy !== primaryEnemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  const multiplier = Math.max(0, Number(aoeConfig.multiplier) || 0);
  if (multiplier <= 0 || living.length === 0) return [];
  const maxTargets = aoeConfig.mode === "all"
    ? living.length
    : Math.max(0, Math.floor(Number(aoeConfig.maxTargets) || 0));
  return living.slice(0, maxTargets).map(enemy => ({ enemy, multiplier }));
}

window.CapitalCombat = Object.freeze({
  targetingModes:CAPITAL_TARGETING_MODES,
  isCapitalShip:isCapitalCombatShip,
  normalizeTargetingMode:normalizeCapitalTargetingMode,
  getTargetingModeName:getCapitalTargetingModeName,
  selectTarget:selectCapitalCombatTarget,
  getTrait:getCapitalCombatTrait,
  applyShieldMitigation:applyCapitalShieldMitigation,
  getReactiveArmorRepair:getCapitalReactiveArmorRepair,
  getWeaponTraitMultiplier:getCapitalWeaponTraitMultiplier,
  getAreaDamageTargets:getCapitalAreaDamageTargets
});
