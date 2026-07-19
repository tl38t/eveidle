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
const refiningRecipes = vm.runInContext("SMELTING_RECIPES", context);
const gasAreas = vm.runInContext("GAS_AREAS", context);
const planets = vm.runInContext("PLANET_TYPES", context);

const mineralSources = new Map(refiningRecipes.map(recipe => [recipe.outputMineral, {
  mining:miningAreas.find(area => area.ore === recipe.consumeOre),
  refining:recipe
}]));
const planetSources = new Map(planets.map(planet => [planet.output, planet]));
const gasSources = new Map(gasAreas.map(area => [area.gas, area]));

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

function calculateShipProductionTime(assembly) {
  const level = assembly.level;
  const gatheringLevel = Math.min(99, level + 10);
  const gatheringEfficiency = 1 + gatheringLevel * 0.02;
  const manufacturingEfficiency = 1 + level * 0.02;
  const refiningOutput = Math.max(1, Math.floor(gatheringEfficiency));
  const materials = sumShipMaterials(assembly);
  const lockedMaterials = [];
  let gatheringSeconds = 0;
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
    const planet = planetSources.get(material);
    if (planet) {
      if (planet.level > level) lockedMaterials.push(`${material}(需Lv.${planet.level})`);
      planetaryJobs.push(quantity * planet.interval / manufacturingEfficiency);
      continue;
    }
    lockedMaterials.push(`${material}(无采集来源)`);
  }

  let manufacturingSeconds = assembly.time / manufacturingEfficiency;
  for (const [componentId, count] of Object.entries(assembly.componentCost || {})) {
    const component = components.find(item => item.id === componentId);
    manufacturingSeconds += component.time * count / manufacturingEfficiency;
  }
  const activeSeconds = gatheringSeconds + refiningSeconds + manufacturingSeconds;
  const planetSlots = Math.min(5, 1 + Math.floor(level / 10));
  const planetarySeconds = schedulePlanetaryJobs(planetaryJobs, planetSlots);
  return {
    id:assembly.id,
    name:assembly.name,
    level,
    gatheringLevel,
    materials,
    lockedMaterials,
    gatheringSeconds,
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

const results = assemblies.map(calculateShipProductionTime);
for (const result of results) {
  const lockText = result.lockedMaterials.length ? ` · 阻塞：${result.lockedMaterials.join("、")}` : "";
  console.log(`${result.name} Lv.${result.level} · 总计 ${formatDuration(result.totalSeconds)} · 采矿 ${formatDuration(result.gatheringSeconds)} · 冶炼 ${formatDuration(result.refiningSeconds)} · 制造 ${formatDuration(result.manufacturingSeconds)} · 行星关键路径 ${formatDuration(result.planetarySeconds)}${lockText}`);
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
  const budgets = new Map([[1, [7200, 10800]], [15, [11700, 13500]], [35, [14400, 21600]], [55, [28800, 36000]]]);
  const invalid = results.filter(result => {
    const budget = budgets.get(result.level);
    return budget && (result.lockedMaterials.length > 0 || result.totalSeconds < budget[0] || result.totalSeconds > budget[1]);
  });
  if (invalid.length > 0) throw new Error(`舰船全链路时间预算失败：${invalid.map(result => result.name).join("、")}`);
}

export { calculateShipProductionTime, formatDuration, sumShipMaterials };
