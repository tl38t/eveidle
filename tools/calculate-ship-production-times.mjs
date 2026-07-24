import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
for (const file of ["js/data/ships.js", "js/data/combat.js", "js/data/equipment.js", "js/systems/production.js", "js/data/planets.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename:file });
}

const components = vm.runInContext("SHIP_COMPONENT_RECIPES", context);
const assemblies = vm.runInContext("SHIP_ASSEMBLY_RECIPES", context);
const equipment = vm.runInContext("EQUIPMENT_DB", context);
const miningAreas = vm.runInContext("MINING_AREAS", context);
const moonMiningAreas = vm.runInContext("MOON_MINING_AREAS", context);
const combatZones = vm.runInContext("COMBAT_ZONES", context);
const formationPools = vm.runInContext("COMBAT_FORMATION_POOLS", context);
const refiningRecipes = vm.runInContext("SMELTING_RECIPES", context);
const gasAreas = vm.runInContext("GAS_AREAS", context);
const planets = vm.runInContext("PLANET_TYPES", context);

const mineralSources = new Map(refiningRecipes.map(recipe => [recipe.outputMineral, {
  mining:miningAreas.find(area => area.ore === recipe.consumeOre),
  refining:recipe
}]));
const planetSources = new Map(planets.map(planet => [planet.output, planet]));
const gasSources = new Map(gasAreas.map(area => [area.gas, area]));
const moonSources = new Map(moonMiningAreas.map(area => [area.ore, area]));
const combatSourceMaterials = new Set([
  ...combatZones.map(zone => zone.encryptedDataMaterial).filter(Boolean),
  ...combatZones.flatMap(zone => (zone.specialDrops || []).map(drop => drop.material || drop.resourceId.split(":").slice(1).join(":")))
]);

function sumShipMaterials(assembly) {
  const materials = {};
  for (const [componentId, count] of Object.entries(assembly.componentCost || {})) {
    const component = components.find(item => item.id === componentId);
    if (!component) throw new Error(`${assembly.name}缺少部件配方：${componentId}`);
    for (const [material, quantity] of Object.entries(component.cost || {})) {
      materials[material] = (materials[material] || 0) + quantity * count;
    }
  }
  return materials;
}

function schedulePlanetaryJobs(jobs, slots) {
  const lanes = Array.from({ length:Math.max(1, slots) }, () => 0);
  for (const seconds of jobs.sort((left, right) => right - left)) {
    const lane = lanes.indexOf(Math.min(...lanes));
    lanes[lane] += seconds;
  }
  return Math.max(...lanes);
}

function calculateShipProductionTime(assembly, options = {}) {
  const level = assembly.level;
  const productionLevel = Number.isFinite(options.productionLevel) ? options.productionLevel : level;
  const gatheringLevel = Math.min(99, Number.isFinite(options.gatheringLevel) ? options.gatheringLevel : productionLevel + 10);
  const gatheringEfficiency = 1 + gatheringLevel * 0.02;
  const manufacturingEfficiency = 1 + productionLevel * 0.02;
  const refiningOutput = Math.max(1, Math.floor(gatheringEfficiency));
  const materials = sumShipMaterials(assembly);
  const directMaterials = { ...(assembly.materialCost || {}) };
  const combatMaterials = {};
  const lockedMaterials = [];
  let gatheringSeconds = 0;
  let moonMiningSeconds = 0;
  let refiningSeconds = 0;
  const planetaryJobs = [];

  for (const [material, quantity] of Object.entries(materials)) {
    const mineral = mineralSources.get(material);
    if (mineral) {
      if (!mineral.mining || mineral.mining.level > gatheringLevel || mineral.refining.level > gatheringLevel) {
        lockedMaterials.push(`${material}(需Lv.${Math.max(mineral.mining?.level || 1, mineral.refining.level)})`);
      }
      const cycles = Math.ceil(quantity / refiningOutput);
      gatheringSeconds += cycles * mineral.mining.baseTime / gatheringEfficiency;
      refiningSeconds += cycles * mineral.refining.baseTime / gatheringEfficiency;
      continue;
    }
    const moon = moonSources.get(material);
    if (moon) {
      if (moon.level > gatheringLevel) lockedMaterials.push(`${material}(需Lv.${moon.level})`);
      moonMiningSeconds += quantity * moon.baseTime / gatheringEfficiency;
      continue;
    }
    const gas = gasSources.get(material);
    if (gas) {
      if (gas.level > gatheringLevel) lockedMaterials.push(`${material}(需Lv.${gas.level})`);
      gatheringSeconds += quantity * gas.baseTime / gatheringEfficiency;
      continue;
    }
    if (combatSourceMaterials.has(material)) {
      combatMaterials[material] = quantity;
      continue;
    }
    const planet = planetSources.get(material);
    if (planet) {
      if (planet.level > level) lockedMaterials.push(`${material}(需Lv.${planet.level})`);
      planetaryJobs.push(quantity * planet.interval / manufacturingEfficiency);
      continue;
    }
    lockedMaterials.push(`${material}(无采集来源)`);
  }

  for (const [material, quantity] of Object.entries(directMaterials)) {
    const moon = moonSources.get(material);
    if (moon) {
      if (moon.level > gatheringLevel) lockedMaterials.push(`${material}(需Lv.${moon.level})`);
      moonMiningSeconds += quantity * moon.baseTime / gatheringEfficiency;
      continue;
    }
    if (combatSourceMaterials.has(material)) {
      combatMaterials[material] = quantity;
      continue;
    }
    const mineral = mineralSources.get(material);
    if (mineral) {
      const cycles = Math.ceil(quantity / refiningOutput);
      gatheringSeconds += cycles * mineral.mining.baseTime / gatheringEfficiency;
      refiningSeconds += cycles * mineral.refining.baseTime / gatheringEfficiency;
      continue;
    }
    const planet = planetSources.get(material);
    if (planet) {
      if (planet.level > productionLevel) lockedMaterials.push(`${material}(需Lv.${planet.level})`);
      planetaryJobs.push(quantity * planet.interval / manufacturingEfficiency);
      continue;
    }
    const gas = gasSources.get(material);
    if (gas) {
      if (gas.level > gatheringLevel) lockedMaterials.push(`${material}(需Lv.${gas.level})`);
      gatheringSeconds += quantity * gas.baseTime / gatheringEfficiency;
      continue;
    }
    lockedMaterials.push(`${material}(无采集来源)`);
  }

  let manufacturingSeconds = assembly.time / manufacturingEfficiency;
  for (const [componentId, count] of Object.entries(assembly.componentCost || {})) {
    const component = components.find(item => item.id === componentId);
    manufacturingSeconds += component.time * count / manufacturingEfficiency;
  }
  const activeSeconds = gatheringSeconds + moonMiningSeconds + refiningSeconds + manufacturingSeconds;
  const planetSlots = Math.min(5, 1 + Math.floor(productionLevel / 10));
  const planetarySeconds = schedulePlanetaryJobs(planetaryJobs, planetSlots);
  return {
    id:assembly.id,
    name:assembly.name,
    level,
    productionLevel,
    gatheringLevel,
    materials,
    directMaterials,
    combatMaterials,
    xp:assembly.xp + Object.entries(assembly.componentCost || {}).reduce((total, [componentId, count]) => total + components.find(item => item.id === componentId).xp * count, 0),
    lockedMaterials,
    gatheringSeconds,
    moonMiningSeconds,
    refiningSeconds,
    manufacturingSeconds,
    planetarySeconds,
    totalSeconds:Math.max(activeSeconds, planetarySeconds)
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "不可制造";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded % 3600 / 60);
  const secs = rounded % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

function convolveProbability(left, right) {
  const result = Array(left.length + right.length - 1).fill(0);
  for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) result[i + j] += left[i] * right[j];
  return result;
}

function binomialProbability(count, chance) {
  let result = [1];
  for (let i = 0; i < count; i++) result = convolveProbability(result, [1 - chance, chance]);
  return result;
}

function expectedClearsForBeltData(zone, required) {
  const chances = zone.encryptedDataChances || { elite:0.005, boss:0.02 };
  const formations = formationPools[zone.formationPool];
  let waveDistribution = [0];
  for (const formation of formations) {
    const formationDistribution = binomialProbability(formation.elite || 0, chances.elite || 0);
    if (waveDistribution.length < formationDistribution.length) waveDistribution.length = formationDistribution.length;
    for (let i = 0; i < formationDistribution.length; i++) waveDistribution[i] = (waveDistribution[i] || 0) + formation.chance * formationDistribution[i];
  }
  let clearDistribution = [1];
  for (let wave = 1; wave < zone.maxWave; wave++) clearDistribution = convolveProbability(clearDistribution, waveDistribution);
  clearDistribution = convolveProbability(clearDistribution, [1 - chances.boss, chances.boss]);
  const expected = [0];
  for (let remaining = 1; remaining <= required; remaining++) {
    let numerator = 1;
    for (let gain = 1; gain < clearDistribution.length; gain++) numerator += clearDistribution[gain] * expected[Math.max(0, remaining - gain)];
    expected[remaining] = numerator / (1 - clearDistribution[0]);
  }
  return expected[required];
}

function getMixedCruiserEconomyAudit() {
  const pairs = [
    { commonId:"dawnlight", hybridId:"thunder", zoneId:"angel_hunting_ground" },
    { commonId:"warfalcon", hybridId:"crimson", zoneId:"blood_cathedral" },
    { commonId:"stormblade", hybridId:"nether", zoneId:"sansha_nexus" }
  ];
  return pairs.map(pair => {
    const common = assemblies.find(item => item.id === pair.commonId);
    const hybrid = assemblies.find(item => item.id === pair.hybridId);
    const zone = combatZones.find(item => item.id === pair.zoneId);
    const commonProduction = calculateShipProductionTime(common, { productionLevel:40, gatheringLevel:50 });
    const hybridProduction = calculateShipProductionTime(hybrid, { productionLevel:40, gatheringLevel:50 });
    const dataMaterial = Object.keys(hybridProduction.combatMaterials)[0];
    const dataRequired = hybridProduction.combatMaterials[dataMaterial];
    const expectedClears = expectedClearsForBeltData(zone, dataRequired);
    const fullFactionFitClears = expectedClearsForBeltData(zone, 40);
    return {
      ...pair, commonName:common.name, hybridName:hybrid.name, dataMaterial, dataRequired,
      commonProduction, hybridProduction,
      productionRatio:hybridProduction.totalSeconds / commonProduction.totalSeconds,
      expectedClears, expectedLP:expectedClears * zone.clearLp,
      fullFactionFitClears, fullFactionFitLP:fullFactionFitClears * zone.clearLp
    };
  });
}
function getMixedBattleshipEconomyAudit() {
  const pairs = [
    { commonId:"sunlance", hybridId:"dawnbreaker", zoneId:"angel_warfront" },
    { commonId:"fortfalcon", hybridId:"crimson_bastion", zoneId:"blood_iron_basilica" },
    { commonId:"thunderblade", hybridId:"spectre_frame", zoneId:"sansha_command_matrix" }
  ];
  return pairs.map(pair => {
    const common = assemblies.find(item => item.id === pair.commonId);
    const hybrid = assemblies.find(item => item.id === pair.hybridId);
    const zone = combatZones.find(item => item.id === pair.zoneId);
    const commonProduction = calculateShipProductionTime(common, { productionLevel:60, gatheringLevel:70 });
    const hybridProduction = calculateShipProductionTime(hybrid, { productionLevel:60, gatheringLevel:70 });
    const dataMaterial = Object.keys(hybridProduction.combatMaterials)[0];
    const dataRequired = hybridProduction.combatMaterials[dataMaterial];
    const expectedClears = expectedClearsForBeltData(zone, dataRequired);
    return {
      ...pair, commonName:common.name, hybridName:hybrid.name, dataMaterial, dataRequired,
      commonProduction, hybridProduction,
      productionRatio:hybridProduction.totalSeconds / commonProduction.totalSeconds,
      expectedClears, expectedLP:expectedClears * zone.clearLp
    };
  });
}
function getLockedRecipeMaterials(cost, level) {
  const locked = [];
  for (const material of Object.keys(cost || {})) {
    const mineral = mineralSources.get(material);
    const planet = planetSources.get(material);
    const gas = gasSources.get(material);
    const required = mineral ? Math.max(mineral.mining?.level || 1, mineral.refining.level) : planet?.level ?? gas?.level;
    const limit = planet ? level : level + 10;
    if (required !== undefined && required > limit) locked.push(`${material}(需Lv.${required})`);
  }
  return locked;
}

const auditMixedCruiserRequested = process.argv.includes("--audit-mixed-cruiser");
if (auditMixedCruiserRequested) {
  console.log("混血巡洋舰经济闭环（舰船工程40、采矿/冶炼50、无舰船与装备加成）：");
  for (const audit of getMixedCruiserEconomyAudit()) {
    const commonTime = formatDuration(audit.commonProduction.totalSeconds);
    const hybridTime = formatDuration(audit.hybridProduction.totalSeconds);
    console.log(`${audit.hybridName}: 常规同路线 ${commonTime} → 混血 ${hybridTime}（${audit.productionRatio.toFixed(2)}x）`);
    console.log(`  月矿 ${formatDuration(audit.hybridProduction.moonMiningSeconds)}；部件与组装 ${formatDuration(audit.hybridProduction.manufacturingSeconds)}；生产经验 ${audit.hybridProduction.xp}`);
    console.log(`  ${audit.dataMaterial}×${audit.dataRequired}: 理论约 ${audit.expectedClears.toFixed(2)} 次全通，产出 ${audit.expectedLP.toFixed(0)} LP；完整势力装40份约 ${audit.fullFactionFitClears.toFixed(2)} 次全通`);
  }
}
const auditMixedBattleshipRequested = process.argv.includes("--audit-mixed-battleship");
if (auditMixedBattleshipRequested) {
  console.log("混血战列舰经济闭环（舰船工程60、采矿/冶炼70、无舰船与装备加成）：");
  for (const audit of getMixedBattleshipEconomyAudit()) {
    const commonTime = formatDuration(audit.commonProduction.totalSeconds);
    const hybridTime = formatDuration(audit.hybridProduction.totalSeconds);
    console.log(`${audit.hybridName}: 常规同路线 ${commonTime} → 混血 ${hybridTime}（${audit.productionRatio.toFixed(2)}x）`);
    console.log(`  月矿 ${formatDuration(audit.hybridProduction.moonMiningSeconds)}；部件与组装 ${formatDuration(audit.hybridProduction.manufacturingSeconds)}；生产经验 ${audit.hybridProduction.xp}`);
    console.log(`  ${audit.dataMaterial}×${audit.dataRequired}: 理论约 ${audit.expectedClears.toFixed(2)} 次全通，产出 ${audit.expectedLP.toFixed(0)} LP`);
  }
}
const results = assemblies.map(assembly => calculateShipProductionTime(assembly));
if (!auditMixedCruiserRequested && !auditMixedBattleshipRequested) for (const result of results) {
  const lockText = result.lockedMaterials.length ? ` · 阻塞：${result.lockedMaterials.join("、")}` : "";
  const moonText = result.moonMiningSeconds > 0 ? ` · 月矿 ${formatDuration(result.moonMiningSeconds)}` : "";
  console.log(`${result.name} Lv.${result.level} · 总计 ${formatDuration(result.totalSeconds)} · 采矿 ${formatDuration(result.gatheringSeconds)}${moonText} · 冶炼 ${formatDuration(result.refiningSeconds)} · 制造 ${formatDuration(result.manufacturingSeconds)} · 行星关键路径 ${formatDuration(result.planetarySeconds)}${lockText}`);
}

const auditedEquipmentLocks = Object.values(equipment)
  .filter(item => [35, 55].includes(item.level) && item.cost && item.combat)
  .map(item => ({ name:item.name, locked:getLockedRecipeMaterials(item.cost, item.level) }))
  .filter(item => item.locked.length > 0);
if (auditedEquipmentLocks.length > 0) {
  console.log("\nLv.35/Lv.55装备材料阻塞：");
  for (const item of auditedEquipmentLocks) console.log(`${item.name} · ${item.locked.join("、")}`);
}

if (process.argv.includes("--verify")) {
  const mixedCruiserAudits = getMixedCruiserEconomyAudit();
  const invalidMixedCruiser = mixedCruiserAudits.filter(audit =>
    audit.dataRequired !== 30 || audit.hybridProduction.lockedMaterials.length > 0 ||
    audit.hybridProduction.totalSeconds < 3.5 * 3600 || audit.hybridProduction.totalSeconds > 4.5 * 3600 ||
    audit.productionRatio < 1.45 || audit.productionRatio > 1.65 ||
    audit.expectedClears < 135 || audit.expectedClears > 150 || audit.expectedLP < 100 ||
    Math.abs(audit.dataRequired / 40 - 0.75) > 1e-9
  );
  if (invalidMixedCruiser.length > 0) throw new Error(`混血巡洋舰经济闭环验收失败：${invalidMixedCruiser.map(item => item.hybridName).join("、")}`);
  const mixedBattleshipAudits = getMixedBattleshipEconomyAudit();
  const invalidMixedBattleship = mixedBattleshipAudits.filter(audit =>
    audit.dataRequired !== 45 || audit.hybridProduction.lockedMaterials.length > 0 ||
    audit.hybridProduction.totalSeconds < 36000 || audit.hybridProduction.totalSeconds > 43200 ||
    audit.productionRatio < 1.10 || audit.productionRatio > 1.30 ||
    audit.expectedClears < 120 || audit.expectedClears > 130 || audit.expectedLP < 150 ||
    Math.abs(audit.dataRequired / 60 - 0.75) > 1e-9
  );
  if (invalidMixedBattleship.length > 0) throw new Error(`混血战列舰经济闭环验收失败：${invalidMixedBattleship.map(item => item.hybridName).join("、")}`);
  const budgets = new Map([[1, [7200, 10800]], [15, [11700, 13500]], [35, [14400, 21600]], [55, [28800, 36000]], [60, [36000, 43200]]]);
  const invalid = results.filter(result => {
    const budget = budgets.get(result.level);
    return budget && (result.lockedMaterials.length > 0 || result.totalSeconds < budget[0] || result.totalSeconds > budget[1]);
  });
  if (invalid.length > 0) throw new Error(`舰船全链路时间预算失败：${invalid.map(result => result.name).join("、")}`);
  const endgameBudgets = new Map([
    ["firmament", [18 * 3600, 24 * 3600]],
    ["heavy_bastion", [18 * 3600, 24 * 3600]],
    ["riftbreaker", [18 * 3600, 24 * 3600]],
    ["orca", [18 * 3600, 24 * 3600]],
    ["starcrown", [48 * 3600, 72 * 3600]],
    ["eternal_fortress", [48 * 3600, 72 * 3600]],
    ["arbiter", [48 * 3600, 72 * 3600]]
  ]);
  const invalidEndgame = results.filter(result => {
    const budget = endgameBudgets.get(result.id);
    return budget && (result.totalSeconds < budget[0] || result.totalSeconds > budget[1]);
  });
  if (invalidEndgame.length > 0) throw new Error(`终局舰船（旗舰/超级旗舰）全链路时间预算失败：${invalidEndgame.map(result => result.name).join("、")}`);
}

export { calculateShipProductionTime, expectedClearsForBeltData, formatDuration, getMixedCruiserEconomyAudit, sumShipMaterials };
