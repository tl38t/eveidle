import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
// 游戏数据脚本同时暴露浏览器 window API；校准工具在 Node VM 中加载时补齐同一全局别名。
context.window = context;
context.globalThis = context;
for (const file of ["js/data/ships.js", "js/data/combat.js", "js/data/equipment.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename:file });
}

const ships = vm.runInContext("STARTER_SHIPS", context);
const equipment = vm.runInContext("EQUIPMENT_DB", context);
const enemies = vm.runInContext("ENEMY_DATABASE", context);
const zones = vm.runInContext("COMBAT_ZONES", context);
const sites = vm.runInContext("DEATHSPACE_DATABASE", context);

const routes = {
  2:{
    angel:{ shipId:"rifter", weaponId:"t1_small_laser", repairId:"t1_shield_booster", layer:"shield" },
    blood:{ shipId:"kestrel", weaponId:"t1_light_missile_launcher", repairId:"t1_armor_repairer", layer:"armor" },
    sansha:{ shipId:"atron", weaponId:"t1_small_cannon", repairId:"t1_structure_repairer", layer:"structure" }
  },
  3:{
    angel:{ shipId:"raylight", weaponId:"t1_small_laser", repairId:"t1_shield_booster", layer:"shield" },
    blood:{ shipId:"spearfalcon", weaponId:"t1_light_missile_launcher", repairId:"t1_armor_repairer", layer:"armor" },
    sansha:{ shipId:"swiftblade", weaponId:"t1_small_cannon", repairId:"t1_structure_repairer", layer:"structure" }
  },
  4:{
    angel:{ shipId:"dawnlight", weaponId:"t1_medium_laser", repairId:"t1_medium_shield_booster", layer:"shield" },
    blood:{ shipId:"warfalcon", weaponId:"t1_heavy_missile_launcher", repairId:"t1_medium_armor_repairer", layer:"armor" },
    sansha:{ shipId:"stormblade", weaponId:"t1_medium_cannon", repairId:"t1_medium_structure_repairer", layer:"structure" }
  },
  6:{
    angel:{ shipId:"sunlance", weaponId:"t1_large_laser", repairId:"t1_large_shield_booster", layer:"shield" },
    blood:{ shipId:"fortfalcon", weaponId:"t1_cruise_missile_launcher", repairId:"t1_large_armor_repairer", layer:"armor" },
    sansha:{ shipId:"thunderblade", weaponId:"t1_large_cannon", repairId:"t1_large_structure_repairer", layer:"structure" }
  }
};

const matureSkills = {
  2:{ weapon:10, targeting:10, piloting:10, defense:10, shield:10, armor:10, structure:10, capacitor:10 },
  3:{ weapon:25, targeting:20, piloting:20, defense:25, shield:25, armor:25, structure:25, capacitor:25 },
  4:{ weapon:45, targeting:40, piloting:40, defense:45, shield:45, armor:45, structure:45, capacitor:45 },
  6:{ weapon:65, targeting:60, piloting:60, defense:65, shield:65, armor:65, structure:65, capacitor:65 }
};

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function damage(hit, dodge, baseDamage, multiplier, random) {
  const hitPower = Math.pow(hit, 1.4);
  const dodgePower = Math.pow(dodge, 1.4);
  const coefficient = hitPower / (hitPower + dodgePower);
  const variance = 0.90 + (random() + random()) * 0.10;
  return Math.max(1, Math.round(baseDamage * coefficient * multiplier * variance));
}

function applyDamage(hp, amount) {
  let remaining = amount;
  for (const layer of ["shield", "armor", "structure"]) {
    const taken = Math.min(remaining, hp[layer]);
    hp[layer] -= taken;
    remaining -= taken;
    if (remaining <= 0) break;
  }
}

function enhancementBonuses(level) {
  const blocks = Math.floor(level / 5);
  const remainder = level % 5;
  return {
    hp:1 + blocks * 0.05 + remainder * 0.005,
    damage:1 + blocks * 0.025 + remainder * 0.0025
  };
}

function buildWave(site, waveNumber, balance, random) {
  const zone = zones.find(item => item.id === site.sourceZoneId);
  const config = site.waves[waveNumber - 1];
  const normalTemplate = enemies[zone.faction].types[zone.enemyPool.normal[0]];
  const bossTemplate = enemies[zone.faction].types[zone.enemyPool.boss[0]];
  const wave = [];
  const hpScale = balance.hp * (config.final ? balance.finalHp : 1);
  const damageScale = balance.damage * (config.final ? balance.finalDamage : 1);
  for (let index = 0; index < config.escortNormal; index++) {
    wave.push({
      ...normalTemplate,
      hp:Object.fromEntries(Object.entries(normalTemplate.hp).map(([layer, value]) => [layer, Math.max(1, Math.round(value * hpScale))])),
      baseDamage:Math.max(1, Math.round(normalTemplate.baseDamage * damageScale)),
      leader:false
    });
  }
  wave.push({
    ...bossTemplate,
    hp:Object.fromEntries(Object.entries(bossTemplate.hp).map(([layer, value]) => [layer, Math.max(1, Math.round(value * config.hpMult * hpScale))])),
    baseDamage:Math.max(1, Math.round(bossTemplate.baseDamage * config.damageMult * damageScale)),
    leader:true
  });
  for (let index = wave.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [wave[index], wave[swap]] = [wave[swap], wave[index]];
  }
  return wave;
}

function simulate(site, enhancementLevel, useDeathspaceGear, balance, seed) {
  const random = seededRandom(seed);
  const zone = zones.find(item => item.id === site.sourceZoneId);
  const route = routes[site.dedTier][site.faction];
  const ship = ships[route.shipId];
  const weaponDefinition = equipment[useDeathspaceGear ? `ded_${site.faction}_${site.dedTier}_weapon` : route.weaponId];
  const repairDefinition = equipment[useDeathspaceGear ? `ded_${site.faction}_${site.dedTier}_repair` : route.repairId];
  const weapon = weaponDefinition.combat;
  const repair = repairDefinition.combat;
  const skill = matureSkills[site.dedTier];
  const enhancement = enhancementBonuses(enhancementLevel);
  const maxHp = {
    shield:Math.round(ship.hp.shield * (1 + (ship.bonuses.shieldCapacity || 0)) * (1 + skill.shield * 0.03) * enhancement.hp),
    armor:Math.round(ship.hp.armor * (1 + (ship.bonuses.armorCapacity || 0)) * (1 + skill.armor * 0.03) * enhancement.hp),
    structure:Math.round(ship.hp.structure * (1 + (ship.bonuses.structureCapacity || 0)) * (1 + skill.structure * 0.03) * enhancement.hp)
  };
  const hp = { ...maxHp };
  const playerHit = weapon.baseHit + skill.weapon * 4 + skill.targeting * 3 + (ship.bonuses.hitBonus || 0);
  const playerDamage = (1 + skill.weapon * 0.02) * (1 + (ship.bonuses[weapon.weaponType + "Damage"] || 0)) * enhancement.damage;
  const playerDodge = ship.dodge + skill.piloting;
  const repairAmount = Math.round(repair.amount * (1 + skill.defense * 0.02) * (1 + (ship.bonuses[route.layer + "Repair"] || 0)));
  const repairSlots = ship.slots[repairDefinition.slot] || 0;

  for (let waveNumber = 1; waveNumber <= site.maxWave; waveNumber++) {
    const wave = buildWave(site, waveNumber, balance, random);
    let rounds = 0;
    while (wave.some(enemy => enemy.hp.structure > 0)) {
      if (++rounds > 5000) return false;
      const target = wave.find(enemy => enemy.hp.structure > 0);
      for (let slot = 0; slot < ship.slots.high; slot++) {
        let counter = 1;
        if (weapon.weaponType === "laser" && target.hp.shield > 0) counter = 1.25;
        else if (weapon.weaponType === "missile" && target.hp.shield <= 0 && target.hp.armor > 0) counter = 1.25;
        else if (weapon.weaponType === "cannon" && target.hp.shield <= 0 && target.hp.armor <= 0 && target.hp.structure > 0) counter = 1.25;
        applyDamage(target.hp, damage(playerHit, target.dodge, weapon.baseDamage, counter * playerDamage, random));
      }
      for (const attacker of wave.filter(enemy => enemy.hp.structure > 0)) {
        applyDamage(hp, damage(attacker.hit, playerDodge, attacker.baseDamage, 1, random));
        if (hp.structure <= 0) return false;
      }
      for (let slot = 0; slot < repairSlots; slot++) {
        if (hp[route.layer] < maxHp[route.layer]) hp[route.layer] = Math.min(maxHp[route.layer], hp[route.layer] + repairAmount);
      }
    }
  }
  return true;
}

function rate(site, enhancementLevel, useDeathspaceGear, balance, runs, seedBase) {
  let clears = 0;
  for (let run = 0; run < runs; run++) {
    if (simulate(site, enhancementLevel, useDeathspaceGear, balance, seedBase + run)) clears++;
  }
  return clears / runs;
}

const secondUsesT1 = !process.argv.includes("--second-ded");

function evaluate(site, balance, runs, seedBase) {
  const baseRate = rate(site, 5, false, balance, runs, seedBase);
  const dedRate = rate(site, 10, !secondUsesT1, balance, runs, seedBase + runs * 2);
  const error = Math.abs(baseRate - 0.50) + Math.abs(dedRate - 0.90);
  return { ...balance, baseRate, dedRate, error };
}

const searchRuns = Math.max(100, Number(process.argv.find(argument => argument.startsWith("--search-runs="))?.split("=")[1]) || 250);
const finalRuns = Math.max(1000, Number(process.argv.find(argument => argument.startsWith("--final-runs="))?.split("=")[1]) || 5000);
const candidates = Math.max(100, Number(process.argv.find(argument => argument.startsWith("--candidates="))?.split("=")[1]) || 1200);
const selectedSiteId = process.argv.find(argument => argument.startsWith("--site="))?.split("=")[1];
const evaluateSiteId = process.argv.find(argument => argument.startsWith("--evaluate-site="))?.split("=")[1];
const sweepSiteId = process.argv.find(argument => argument.startsWith("--sweep-site="))?.split("=")[1];
if (evaluateSiteId) {
  const site = sites.find(item => item.id === evaluateSiteId);
  if (!site) throw new Error(`未知死亡空间：${evaluateSiteId}`);
  const readNumber = (name, fallback) => Number(process.argv.find(argument => argument.startsWith(`--${name}=`))?.split("=")[1]) || fallback;
  const balance = {
    hp:readNumber("hp", 1),
    damage:readNumber("damage", 1),
    finalHp:readNumber("final-hp", 1),
    finalDamage:readNumber("final-damage", 1)
  };
  const result = evaluate(site, balance, finalRuns, 610000000);
  console.log(`${site.id}: +5 T1 ${(result.baseRate * 100).toFixed(2)}%, +10 ${secondUsesT1 ? "T1" : "DED"} ${(result.dedRate * 100).toFixed(2)}%`);
  process.exit(0);
}
if (sweepSiteId) {
  const site = sites.find(item => item.id === sweepSiteId);
  if (!site) throw new Error(`未知死亡空间：${sweepSiteId}`);
  const readNumber = (name, fallback) => Number(process.argv.find(argument => argument.startsWith(`--${name}=`))?.split("=")[1]) || fallback;
  const hp = readNumber("hp", 1);
  const damageScale = readNumber("damage", 1);
  const finalHp = readNumber("final-hp", 1);
  for (let finalDamage = 0.50; finalDamage <= 4.001; finalDamage += 0.10) {
    const result = evaluate(site, { hp, damage:damageScale, finalHp, finalDamage }, finalRuns, 500000000 + Math.round(finalDamage * 100000));
    console.log(`finalDamage ${finalDamage.toFixed(2)} => +5 T1 ${(result.baseRate * 100).toFixed(2)}%, +10 ${secondUsesT1 ? "T1" : "DED"} ${(result.dedRate * 100).toFixed(2)}%`);
  }
  process.exit(0);
}

const selectedSites = selectedSiteId ? sites.filter(site => site.id === selectedSiteId) : sites;
if (selectedSiteId && selectedSites.length === 0) throw new Error(`未知死亡空间：${selectedSiteId}`);
for (const site of selectedSites) {
  const siteIndex = sites.indexOf(site);
  const random = seededRandom(2026071900 + siteIndex * 10000);
  const found = [];
  for (let index = 0; index < candidates; index++) {
    const hp = 0.20 + random() * 1.60;
    const damageScale = 0.10 + random() * 1.30;
    const finalHp = 0.45 + random() * 1.80;
    const finalDamage = 0.45 + random() * 1.80;
    found.push(evaluate(site, { hp, damage:damageScale, finalHp, finalDamage }, searchRuns, 90000000 + siteIndex * 100000 + index * searchRuns * 5));
  }
  found.sort((left, right) => left.error - right.error);
  const finalists = found.slice(0, 16).map((candidate, index) => evaluate(site, candidate, finalRuns, 700000000 + siteIndex * 1000000 + index * finalRuns * 5));
  finalists.sort((left, right) => left.error - right.error);
  const best = finalists[0];
  console.log(`${site.id}: hp ${best.hp.toFixed(4)}, damage ${best.damage.toFixed(4)}, finalHp ${best.finalHp.toFixed(4)}, finalDamage ${best.finalDamage.toFixed(4)} => +5 T1 ${(best.baseRate * 100).toFixed(2)}%, +10 ${secondUsesT1 ? "T1" : "DED"} ${(best.dedRate * 100).toFixed(2)}%, error ${(best.error * 100).toFixed(2)}`);
}
