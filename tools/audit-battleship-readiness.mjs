import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const savePath = process.argv[2];
if (!savePath) throw new Error("用法：node tools/audit-battleship-readiness.mjs <EVE_Save.json>");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
for (const file of ["js/data/ships.js", "js/data/combat.js", "js/data/equipment.js", "js/systems/production.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename:file });
}

const save = JSON.parse(fs.readFileSync(path.resolve(savePath), "utf8"));
const assemblies = vm.runInContext("SHIP_ASSEMBLY_RECIPES", context);
const components = vm.runInContext("SHIP_COMPONENT_RECIPES", context);
const equipment = vm.runInContext("EQUIPMENT_DB", context);
const refiningRecipes = vm.runInContext("SMELTING_RECIPES", context);
const resources = save.resources || {};

const routes = [
  { shipId:"sunlance", weaponId:"t1_large_laser", repairId:"t1_large_shield_booster", attackSkill:"laserOps", defenseSkill:"shieldOperation" },
  { shipId:"fortfalcon", weaponId:"t1_cruise_missile_launcher", repairId:"t1_large_armor_repairer", attackSkill:"missileOperations", defenseSkill:"armorReinforcement" },
  { shipId:"thunderblade", weaponId:"t1_large_cannon", repairId:"t1_large_structure_repairer", attackSkill:"cannonOps", defenseSkill:"hullEngineering" }
];

function getLevel(skill) {
  return Number(save.skills && save.skills[skill] && save.skills[skill].lvl) || 1;
}

function addCost(target, cost, count = 1) {
  for (const [material, quantity] of Object.entries(cost || {})) {
    target[material] = (target[material] || 0) + quantity * count;
  }
  return target;
}

function getShipCost(shipId) {
  const assembly = assemblies.find(recipe => recipe.shipId === shipId);
  const cost = {};
  for (const [componentId, count] of Object.entries(assembly.componentCost)) {
    const component = components.find(recipe => recipe.id === componentId);
    addCost(cost, component.cost, count);
  }
  return cost;
}

function getDirectStock(material) {
  for (const poolName of ["minerals", "planetary", "gases", "moonOres", "special"]) {
    const pool = resources[poolName] || {};
    if (Object.prototype.hasOwnProperty.call(pool, material)) return Number(pool[material]) || 0;
  }
  return 0;
}

const targetRefiningLevel = 55;
const targetRefiningOutput = Math.max(1, Math.floor(1 + targetRefiningLevel * 0.02));
function getPotentialStock(material) {
  const direct = getDirectStock(material);
  const recipe = refiningRecipes.find(item => item.outputMineral === material);
  const ore = recipe ? Number((resources.ores || {})[recipe.consumeOre]) || 0 : 0;
  return { direct, ore, converted:ore * targetRefiningOutput, total:direct + ore * targetRefiningOutput, recipe };
}

function formatDeficits(cost) {
  const deficits = [];
  for (const [material, required] of Object.entries(cost)) {
    const stock = getPotentialStock(material);
    const deficit = Math.max(0, required - stock.total);
    if (deficit <= 0) continue;
    const source = stock.recipe
      ? `现有${stock.direct}＋${stock.recipe.consumeOre}${stock.ore}折算${stock.converted}`
      : `现有${stock.direct}`;
    deficits.push(`${material} 缺${deficit}（需${required}，${source}）`);
  }
  return deficits.length ? deficits.join("；") : "当前库存及矿石折算后已经齐备";
}

const attackSkills = ["laserOps", "cannonOps", "missileOperations"];
const defenseSkills = ["shieldOperation", "armorReinforcement", "hullEngineering"];
const highestAttack = Math.max(...attackSkills.map(getLevel));
const highestDefense = Math.max(...defenseSkills.map(getLevel));
const combatLevel = Math.floor((highestAttack + highestDefense) / 2);

console.log(`存档：${path.basename(savePath)}`);
console.log(`生产门槛：采矿 Lv.${getLevel("mining")} / 冶炼 Lv.${getLevel("refining")} / 行星 Lv.${getLevel("planetaryIndustry")} / 舰船工程 Lv.${getLevel("shipEngineering")} / 装备工程 Lv.${getLevel("equipmentEngineering")}`);
console.log(`距离战列生产：冶炼 ${Math.max(0, 55 - getLevel("refining"))}级，行星 ${Math.max(0, 40 - getLevel("planetaryIndustry"))}级，舰船工程 ${Math.max(0, 55 - getLevel("shipEngineering"))}级，装备工程 ${Math.max(0, 55 - getLevel("equipmentEngineering"))}级`);
console.log(`当前战斗等级：${combatLevel}（攻击最高${highestAttack}，防御最高${highestDefense}），距离0.2～0.1门槛还差 ${Math.max(0, 55 - combatLevel)} 级`);
console.log(`补给库存：燃料 ${Number(resources.fuel) || 0} / 激光弹 ${Number(resources.ammunition && resources.ammunition.laser) || 0} / 导弹 ${Number(resources.ammunition && resources.ammunition.missile) || 0} / 炮台弹 ${Number(resources.ammunition && resources.ammunition.cannon) || 0}`);

for (const route of routes) {
  const assembly = assemblies.find(recipe => recipe.shipId === route.shipId);
  const weapon = equipment[route.weaponId];
  const repairer = equipment[route.repairId];
  const shipCost = getShipCost(route.shipId);
  const fullFitCost = { ...shipCost };
  addCost(fullFitCost, weapon.cost, 5);
  addCost(fullFitCost, repairer.cost, 5);
  const routeCombatLevel = Math.floor((getLevel(route.attackSkill) + getLevel(route.defenseSkill)) / 2);
  console.log(`\n${assembly.name}路线 · ${weapon.name}×5＋${repairer.name}×5`);
  console.log(`  路线战斗等级 ${routeCombatLevel}（${route.attackSkill} ${getLevel(route.attackSkill)} / ${route.defenseSkill} ${getLevel(route.defenseSkill)}）`);
  console.log(`  仅船体：${formatDeficits(shipCost)}`);
  console.log(`  船体＋满装：${formatDeficits(fullFitCost)}`);
}
