import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({ window:{} });
for (const file of ["js/data/ships.js", "js/systems/ship-enhancement.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename:file });
}

const enhancement = context.window.ShipEnhancement;
const tiers = [
  { name:"护卫舰", ship:{ id:"rifter", type:"frigate" }, threshold:1 },
  { name:"驱逐舰", ship:{ id:"raylight", type:"destroyer" }, threshold:15 },
  { name:"巡洋舰", ship:{ id:"dawnlight", type:"cruiser" }, threshold:35 },
  { name:"战列舰", ship:{ id:"sunlance", type:"battleship" }, threshold:55 }
];

function auditTarget(ship, threshold, skillLevel, targetLevel) {
  let reachProbability = 1;
  let cycleAttempts = 0;
  let cycleXp = 0;
  const failureXp = enhancement.getFailureXp(ship);

  for (let currentLevel = 0; currentLevel < targetLevel; currentLevel++) {
    const chance = enhancement.getSuccessChance(skillLevel, threshold, currentLevel);
    const successXp = enhancement.getSuccessXp(ship, currentLevel);
    cycleAttempts += reachProbability;
    cycleXp += reachProbability * (chance * successXp + (1 - chance) * failureXp);
    reachProbability *= chance;
  }

  return {
    completionProbabilityPerRun:reachProbability,
    expectedAttempts:cycleAttempts / reachProbability,
    expectedXp:cycleXp / reachProbability
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "∞";
  if (value >= 10000000) return value.toExponential(2);
  return Math.round(value).toLocaleString("zh-CN");
}

for (const tier of tiers) {
  const levels = [...new Set([
    tier.threshold,
    Math.min(99, tier.threshold + 10),
    Math.min(99, tier.threshold + 25),
    99
  ])];
  console.log(`\n${tier.name}（制造门槛Lv.${tier.threshold}，单次消耗3件部件）`);
  for (const skillLevel of levels) {
    const rows = [5, 10, 15].map(target => {
      const result = auditTarget(tier.ship, tier.threshold, skillLevel, target);
      return `+${target}：约${formatNumber(result.expectedAttempts)}次 / ${formatNumber(result.expectedAttempts * 3)}件部件 / ${formatNumber(result.expectedXp)}舰船工程XP`;
    });
    console.log(`  舰船工程Lv.${skillLevel}｜${rows.join("；")}`);
  }
}

