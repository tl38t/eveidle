import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
for (const file of ["js/data/ships.js", "js/data/combat.js", "js/data/equipment.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename:file });
}

const ships = vm.runInContext("STARTER_SHIPS", context);
const equipment = vm.runInContext("EQUIPMENT_DB", context);
const enemies = vm.runInContext("ENEMY_DATABASE", context);
const zones = vm.runInContext("COMBAT_ZONES", context);
const deathspaces = vm.runInContext("DEATHSPACE_DATABASE", context);
const formations = vm.runInContext("COMBAT_FORMATION_POOLS", context);
const tierRules = vm.runInContext("DEATHSPACE_EQUIPMENT_TIERS", context);
const runs = Math.max(1000, Number(process.argv.find(argument => /^--runs=/.test(argument))?.split("=")[1]) || 10000);
const resetBetweenRooms = process.argv.includes("--reset-between-rooms");
const restorePrimaryBetweenRooms = process.argv.includes("--restore-primary-between-rooms");
const candidateCurve = process.argv.includes("--candidate-curve");
const finalEscortArgument = process.argv.find(argument => /^--final-escorts=/.test(argument));
const finalEscortOverride = finalEscortArgument ? Math.max(0, Number(finalEscortArgument.split("=")[1]) || 0) : null;
const candidateMultipliers = {
  3:[{hp:1.00,damage:0.85},{hp:1.25,damage:0.90},{hp:1.50,damage:1.00}],
  4:[{hp:1.00,damage:0.85},{hp:1.17,damage:0.90},{hp:1.33,damage:0.95},{hp:1.50,damage:1.00}],
  5:[{hp:1.00,damage:0.85},{hp:1.125,damage:0.90},{hp:1.25,damage:0.95},{hp:1.375,damage:0.975},{hp:1.50,damage:1.00}]
};

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

const entrySkills = {
  2:{ weapon:1, targeting:1, piloting:1, defense:1, shield:1, armor:1, structure:1, capacitor:1 },
  3:{ weapon:15, targeting:10, piloting:10, defense:15, shield:15, armor:15, structure:15, capacitor:15 },
  4:{ weapon:35, targeting:25, piloting:25, defense:35, shield:35, armor:35, structure:35, capacitor:35 },
  6:{ weapon:55, targeting:45, piloting:45, defense:55, shield:55, armor:55, structure:55, capacitor:55 }
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

function buildWave(site, waveNumber, random) {
  const zone = zones.find(item => item.id === site.sourceZoneId);
  const config = site.waves[waveNumber - 1];
  const candidate = candidateCurve ? candidateMultipliers[site.maxWave][waveNumber - 1] : null;
  const balance = site.combatBalance || {};
  const hpScale = (balance.hp || 1) * (config.final ? (balance.finalHp || 1) : 1);
  const damageScale = (balance.damage || 1) * (config.final ? (balance.finalDamage || 1) : 1);
  const hpMultiplier = (candidate ? candidate.hp : config.hpMult) * hpScale;
  const damageMultiplier = (candidate ? candidate.damage : config.damageMult) * damageScale;
  const normalTemplate = enemies[zone.faction].types[zone.enemyPool.normal[0]];
  const bossTemplate = enemies[zone.faction].types[zone.enemyPool.boss[0]];
  const wave = [];
  const escortCount = config.final && finalEscortOverride !== null ? finalEscortOverride : config.escortNormal;
  for (let index = 0; index < escortCount; index++) {
    wave.push({
      ...normalTemplate,
      hp:Object.fromEntries(Object.entries(normalTemplate.hp).map(([layer, value]) => [layer, Math.max(1, Math.round(value * hpScale))])),
      baseDamage:Math.max(1, Math.round(normalTemplate.baseDamage * damageScale)),
      leader:false
    });
  }
  const leaderHp = Object.fromEntries(Object.entries(bossTemplate.hp).map(([layer, value]) => [layer, Math.max(1, Math.round(value * hpMultiplier))]));
  wave.push({ ...bossTemplate, hp:leaderHp, baseDamage:Math.max(1, Math.round(bossTemplate.baseDamage * damageMultiplier)), leader:true });
  for (let index = wave.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [wave[index], wave[swap]] = [wave[swap], wave[index]];
  }
  return wave;
}

function simulateRun(site, profile, random) {
  const zone = zones.find(item => item.id === site.sourceZoneId);
  const route = routes[site.dedTier][site.faction];
  const ship = ships[route.shipId];
  const weaponDefinition = equipment[profile.useDeathspaceGear ? `ded_${site.faction}_${site.dedTier}_weapon` : route.weaponId];
  const repairDefinition = equipment[profile.useDeathspaceGear ? `ded_${site.faction}_${site.dedTier}_repair` : route.repairId];
  const weapon = weaponDefinition.combat;
  const repair = repairDefinition.combat;
  const skill = profile.skills;
  const enhancement = enhancementBonuses(profile.enhancementLevel);
  const maxHp = {
    shield:Math.round(ship.hp.shield * (1 + (ship.bonuses.shieldCapacity || 0)) * (1 + skill.shield * 0.03) * enhancement.hp),
    armor:Math.round(ship.hp.armor * (1 + (ship.bonuses.armorCapacity || 0)) * (1 + skill.armor * 0.03) * enhancement.hp),
    structure:Math.round(ship.hp.structure * (1 + (ship.bonuses.structureCapacity || 0)) * (1 + skill.structure * 0.03) * enhancement.hp)
  };
  const hp = { ...maxHp };
  const playerHit = weapon.baseHit + skill.weapon * 4 + skill.targeting * 3 + (ship.bonuses.hitBonus || 0);
  const damageMultiplier = (1 + skill.weapon * 0.02) * (1 + (ship.bonuses[weapon.weaponType + "Damage"] || 0)) * enhancement.damage;
  const playerDodge = ship.dodge + skill.piloting;
  const repairMultiplier = (1 + skill.defense * 0.02) * (1 + (ship.bonuses[route.layer + "Repair"] || 0));
  const fuelMultiplier = ship.fuelEfficiency * (zone.fuelMult || 1) / (1 + skill.capacitor * 0.02);
  const weaponFuel = Math.max(1, Math.round((weapon.fuelCost || 1) * fuelMultiplier));
  const repairFuel = Math.max(1, Math.round((repair.fuelCost || 1) * fuelMultiplier));
  const repairSlots = ship.slots[repairDefinition.slot] || 0;
  const roomPassed = Array(site.maxWave).fill(false);
  const leaderKilled = Array(site.maxWave).fill(false);
  let fuelUsed = 0;
  let ammoUsed = 0;
  let rounds = 0;

  for (let wave = 1; wave <= site.maxWave; wave++) {
    const waveEnemies = buildWave(site, wave, random);
    let roomRounds = 0;
    while (waveEnemies.some(enemy => enemy.hp.structure > 0)) {
      if (++roomRounds > 5000) return { cleared:false, roomPassed, leaderKilled, fuelUsed, ammoUsed, rounds };
      rounds++;
      fuelUsed += weaponFuel * ship.slots.high;
      ammoUsed += (weapon.ammoCost || 1) * ship.slots.high;
      const target = waveEnemies.find(enemy => enemy.hp.structure > 0);
      for (let slot = 0; slot < ship.slots.high; slot++) {
        let counter = 1;
        if (weapon.weaponType === "laser" && target.hp.shield > 0) counter = 1.25;
        else if (weapon.weaponType === "missile" && target.hp.shield <= 0 && target.hp.armor > 0) counter = 1.25;
        else if (weapon.weaponType === "cannon" && target.hp.shield <= 0 && target.hp.armor <= 0 && target.hp.structure > 0) counter = 1.25;
        applyDamage(target.hp, damage(playerHit, target.dodge, weapon.baseDamage, counter * damageMultiplier, random));
      }
      if (target.hp.structure <= 0 && target.leader) leaderKilled[wave - 1] = true;
      for (const attacker of waveEnemies.filter(enemy => enemy.hp.structure > 0)) {
        applyDamage(hp, damage(attacker.hit, playerDodge, attacker.baseDamage, 1, random));
        if (hp.structure <= 0) return { cleared:false, roomPassed, leaderKilled, fuelUsed, ammoUsed, rounds };
      }
      for (let slot = 0; slot < repairSlots; slot++) {
        if (hp[route.layer] < maxHp[route.layer]) {
          hp[route.layer] = Math.min(maxHp[route.layer], hp[route.layer] + Math.round(repair.amount * repairMultiplier));
          fuelUsed += repairFuel;
        }
      }
    }
    roomPassed[wave - 1] = true;
    if (resetBetweenRooms) Object.assign(hp, maxHp);
    else if (restorePrimaryBetweenRooms) hp[route.layer] = maxHp[route.layer];
  }
  return { cleared:true, roomPassed, leaderKilled, fuelUsed, ammoUsed, rounds };
}

function expectedElitesPerBeltClear(zone) {
  const pool = formations[zone.formationPool];
  return 19 * pool.reduce((sum, formation) => sum + (formation.elite || 0) * formation.chance, 0);
}

function auditSite(site, profile, seedBase) {
  const roomPasses = Array(site.maxWave).fill(0);
  const leaderKills = Array(site.maxWave).fill(0);
  let clears = 0;
  let fuel = 0;
  let ammo = 0;
  let rounds = 0;
  for (let index = 0; index < runs; index++) {
    const result = simulateRun(site, profile, seededRandom(seedBase + index));
    if (result.cleared) clears++;
    result.roomPassed.forEach((passed, wave) => { if (passed) roomPasses[wave]++; });
    result.leaderKilled.forEach((killed, wave) => { if (killed) leaderKills[wave]++; });
    fuel += result.fuelUsed;
    ammo += result.ammoUsed;
    rounds += result.rounds;
  }
  const clearRate = clears / runs;
  const roomPassRates = roomPasses.map(count => count / runs);
  const leaderKillRates = leaderKills.map(count => count / runs);
  const corePerAttempt = site.waves.reduce((sum, wave, index) => sum + wave.coreChance * leaderKillRates[index], 0);
  const protocolPerAttempt = site.protocolChance * leaderKillRates.at(-1);
  const lpPerAttempt = site.waveLp * roomPassRates.reduce((sum, rate) => sum + rate, 0) + site.clearLpBonus * clearRate;
  const zone = zones.find(item => item.id === site.sourceZoneId);
  const ticketsPerBeltClear = (expectedElitesPerBeltClear(zone) + 1) * 0.05;
  const beltClearsPerTicket = 1 / ticketsPerBeltClear;
  const attemptsPerStandard = tierRules[site.dedTier].coreRequired / corePerAttempt;
  const beltClearsPerStandard = attemptsPerStandard * beltClearsPerTicket;
  const totalLpPerStandard = attemptsPerStandard * lpPerAttempt + beltClearsPerStandard * zone.clearLp;
  return {
    clearRate, roomPassRates, leaderKillRates, corePerAttempt, protocolPerAttempt, lpPerAttempt,
    attemptsPerStandard, beltClearsPerStandard, totalLpPerStandard,
    averageFuel:fuel / runs, averageAmmo:ammo / runs, averageRounds:rounds / runs
  };
}

const profiles = [
  { id:"entry", name:"门槛等级＋0基础装配", enhancementLevel:0, useDeathspaceGear:false, skillsByTier:entrySkills },
  { id:"targetBase", name:"成熟等级＋5基础T1装配", enhancementLevel:5, useDeathspaceGear:false, skillsByTier:matureSkills },
  { id:"targetAdvanced", name:"成熟等级＋10基础T1装配", enhancementLevel:10, useDeathspaceGear:false, skillsByTier:matureSkills },
  { id:"ded", name:"成熟等级＋10普通死亡空间装配", enhancementLevel:10, useDeathspaceGear:true, skillsByTier:matureSkills }
];
const assertTargets = process.argv.includes("--assert-targets");
const targetFailures = [];

console.log(`死亡空间强度与收益审计：每个配置/副本 ${runs.toLocaleString()} 次，固定种子`);
const roomRecoveryText = resetBetweenRooms ? "诊断模式：房间间完全恢复" : restorePrimaryBetweenRooms ? "诊断模式：房间间自动回满主防御层" : "生命跨房间保留";
console.log(`口径：同级舰船满武器/满对应维修；${roomRecoveryText}；${candidateCurve ? "候选曲线：监督者提高生命、降低爆发，最终综合威胁150%" : "当前监督者曲线"}；失败消耗密钥；不限制补给库存。\n`);

for (const tier of [2, 3, 4, 6]) {
  console.log(`DED ${tier}/10`);
  for (const site of deathspaces.filter(item => item.dedTier === tier)) {
    console.log(`  ${site.name}`);
    profiles.forEach((profile, profileIndex) => {
      const result = auditSite(site, { ...profile, skills:profile.skillsByTier[tier] }, 2026071900 + tier * 100000 + profileIndex * 20000 + deathspaces.indexOf(site) * runs);
      const rooms = result.roomPassRates.map(rate => (rate * 100).toFixed(1) + "%").join("/");
      const leaders = result.leaderKillRates.map(rate => (rate * 100).toFixed(1) + "%").join("/");
      console.log(`    ${profile.name}: 全通 ${(result.clearRate * 100).toFixed(2)}%｜房间 ${rooms}｜监督者 ${leaders}`);
      console.log(`      每票期望 核心${result.corePerAttempt.toFixed(3)} / 协议${(result.protocolPerAttempt * 100).toFixed(3)}% / LP${result.lpPerAttempt.toFixed(2)}；普通装备约${result.attemptsPerStandard.toFixed(1)}票、${result.beltClearsPerStandard.toFixed(1)}次星带肃清、过程LP${result.totalLpPerStandard.toFixed(0)}`);
      console.log(`      每次尝试平均 ${result.averageRounds.toFixed(1)}回合 / 燃料${result.averageFuel.toFixed(0)} / 弹药${result.averageAmmo.toFixed(0)}`);
      if (assertTargets) {
        const percent = (result.clearRate * 100).toFixed(2) + "%";
        if (profile.id === "entry" && result.clearRate > 0.05) targetFailures.push(`${site.id} 门槛配置全通率${percent}高于5%`);
        if (profile.id === "targetBase" && (result.clearRate < 0.45 || result.clearRate > 0.55)) targetFailures.push(`${site.id} +5 T1全通率${percent}不在45%～55%`);
        if (profile.id === "targetAdvanced" && (result.clearRate < 0.85 || result.clearRate > 0.95)) targetFailures.push(`${site.id} +10 T1全通率${percent}不在85%～95%`);
        if (profile.id === "ded" && result.clearRate < 0.98) targetFailures.push(`${site.id} +10死亡空间装配全通率${percent}低于98%`);
        if ((profile.id === "targetBase" || profile.id === "targetAdvanced") && result.roomPassRates.slice(0, -1).some(rate => rate < 0.95)) {
          targetFailures.push(`${site.id} ${profile.id}在最终层之前的通过率低于95%，最终层不是主要门槛`);
        }
      }
    });
  }
  console.log("");
}

if (assertTargets && targetFailures.length > 0) {
  throw new Error("死亡空间目标校验失败：\n- " + targetFailures.join("\n- "));
}
if (assertTargets) console.log("目标校验通过：门槛配置不稳定全通，+5 T1为45%～55%，+10 T1为85%～95%，+10普通死亡空间装配不低于98%。");
