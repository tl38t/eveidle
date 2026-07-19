import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({});
for (const file of ["js/data/ships.js", "js/data/combat.js", "js/data/equipment.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename:file });
}
const ships = vm.runInContext("STARTER_SHIPS", context);
const equipment = vm.runInContext("EQUIPMENT_DB", context);
const enemies = vm.runInContext("ENEMY_DATABASE", context);
const allZones = vm.runInContext("COMBAT_ZONES", context);
const zones = allZones.filter(zone => zone.secLevel === "0.7-0.5");
const highsecZones = allZones.filter(zone => zone.secLevel === "1.0-0.8");
const lowsecZones = allZones.filter(zone => zone.secLevel === "0.4-0.3");
const deepsecZones = allZones.filter(zone => zone.secLevel === "0.2-0.1");
const formations = vm.runInContext("COMBAT_FORMATION_POOLS", context);
const saveArgIndex = process.argv.indexOf("--save");
const supplySave = saveArgIndex >= 0 && process.argv[saveArgIndex + 1]
  ? JSON.parse(fs.readFileSync(path.resolve(process.argv[saveArgIndex + 1]), "utf8"))
  : null;

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

function chooseFormation(zone, wave, random) {
  if (wave === zone.maxWave) return { normal:zone.bossEscortCount, elite:0, boss:1 };
  const pool = formations[zone.formationPool];
  const roll = random();
  let cumulative = 0;
  for (const item of pool) {
    cumulative += item.chance;
    if (roll < cumulative) return item;
  }
  return pool.at(-1);
}

function spawnWave(zone, wave, random) {
  const formation = chooseFormation(zone, wave, random);
  const waveEnemies = [];
  for (const kind of ["normal", "elite", "boss"]) {
    for (let index = 0; index < (formation[kind] || 0); index++) {
      const type = zone.enemyPool[kind][0];
      const template = enemies[zone.faction].types[type];
      waveEnemies.push({ ...template, hp:{...template.hp} });
    }
  }
  for (let index = waveEnemies.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [waveEnemies[index], waveEnemies[swap]] = [waveEnemies[swap], waveEnemies[index]];
  }
  return waveEnemies;
}

const routeByFaction = {
  angel:{ shipId:"raylight", weaponId:"t1_small_laser", repairId:"t1_shield_booster", layer:"shield", repairSlots:3 },
  blood:{ shipId:"spearfalcon", weaponId:"t1_light_missile_launcher", repairId:"t1_armor_repairer", layer:"armor", repairSlots:3 },
  sansha:{ shipId:"swiftblade", weaponId:"t1_small_cannon", repairId:"t1_structure_repairer", layer:"structure", repairSlots:3 }
};

const mixedDestroyerRouteByFaction = {
  angel:{ shipId:"gale", weaponId:"t1_small_laser", repairId:"t1_shield_booster", layer:"shield", repairSlots:3 },
  blood:{ shipId:"bloodthorn", weaponId:"t1_light_missile_launcher", repairId:"t1_armor_repairer", layer:"armor", repairSlots:3 },
  sansha:{ shipId:"umbra", weaponId:"t1_small_cannon", repairId:"t1_structure_repairer", layer:"structure", repairSlots:3 }
};

const cruiserRouteByFaction = {
  angel:{ shipId:"dawnlight", weaponId:"t1_medium_laser", repairId:"t1_medium_shield_booster", layer:"shield", repairSlots:4 },
  blood:{ shipId:"warfalcon", weaponId:"t1_heavy_missile_launcher", repairId:"t1_medium_armor_repairer", layer:"armor", repairSlots:4 },
  sansha:{ shipId:"stormblade", weaponId:"t1_medium_cannon", repairId:"t1_medium_structure_repairer", layer:"structure", repairSlots:4 }
};

const battleshipRouteByFaction = {
  angel:{ shipId:"sunlance", weaponId:"t1_large_laser", repairId:"t1_large_shield_booster", layer:"shield", repairSlots:5 },
  blood:{ shipId:"fortfalcon", weaponId:"t1_cruise_missile_launcher", repairId:"t1_large_armor_repairer", layer:"armor", repairSlots:5 },
  sansha:{ shipId:"thunderblade", weaponId:"t1_large_cannon", repairId:"t1_large_structure_repairer", layer:"structure", repairSlots:5 }
};

function simulateRun(zone, skills, random, routes) {
  const route = (routes || routeByFaction)[zone.faction];
  const baseShip = ships[route.shipId];
  const ship = route.shipOverride ? { ...baseShip, ...route.shipOverride, hp:{ ...baseShip.hp, ...(route.shipOverride.hp || {}) }, bonuses:{ ...baseShip.bonuses, ...(route.shipOverride.bonuses || {}) } } : baseShip;
  const weapon = equipment[route.weaponId].combat;
  const repair = equipment[route.repairId].combat;
  const maxHp = {
    shield:Math.round(ship.hp.shield * (1 + (ship.bonuses.shieldCapacity || 0)) * (1 + skills.shield * 0.03)),
    armor:Math.round(ship.hp.armor * (1 + (ship.bonuses.armorCapacity || 0)) * (1 + skills.armor * 0.03)),
    structure:Math.round(ship.hp.structure * (1 + (ship.bonuses.structureCapacity || 0)) * (1 + skills.structure * 0.03))
  };
  const hp = {...maxHp};
  const playerHit = weapon.baseHit + skills.weapon * 4 + skills.targeting * 3 + (ship.bonuses.hitBonus || 0);
  const playerDmgMult = (1 + skills.weapon * 0.02) * (1 + (ship.bonuses[weapon.weaponType + "Damage"] || 0));
  const playerDodge = ship.dodge + skills.piloting;
  const repairMult = (1 + skills.defense * 0.02) * (1 + (ship.bonuses[route.layer + "Repair"] || 0));
  const fuelMult = ship.fuelEfficiency * (zone.fuelMult || 1) / (1 + (skills.capacitor || 1) * 0.02);
  const weaponFuelPerModule = Math.max(1, Math.round((weapon.fuelCost || 1) * fuelMult));
  const repairFuelPerModule = Math.max(1, Math.round((repair.fuelCost || 1) * fuelMult));
  let totalRounds = 0;
  let fuelUsed = 0;
  let ammoUsed = 0;

  for (let wave = 1; wave <= zone.maxWave; wave++) {
    const waveEnemies = spawnWave(zone, wave, random);
    let rounds = 0;
    while (waveEnemies.some(enemy => enemy.hp.structure > 0)) {
      if (++rounds > 5000) return { cleared:false, waves:wave - 1, totalRounds, fuelUsed, ammoUsed };
      totalRounds++;
      fuelUsed += weaponFuelPerModule * ship.slots.high;
      ammoUsed += (weapon.ammoCost || 1) * ship.slots.high;
      const target = waveEnemies.find(enemy => enemy.hp.structure > 0);
      for (let slot = 0; slot < ship.slots.high; slot++) {
        let counter = 1;
        if (weapon.weaponType === "laser" && target.hp.shield > 0) counter = 1.25;
        else if (weapon.weaponType === "missile" && target.hp.shield <= 0 && target.hp.armor > 0) counter = 1.25;
        else if (weapon.weaponType === "cannon" && target.hp.shield <= 0 && target.hp.armor <= 0 && target.hp.structure > 0) counter = 1.25;
        applyDamage(target.hp, damage(playerHit, target.dodge, weapon.baseDamage, counter * playerDmgMult, random));
      }
      for (const attacker of waveEnemies.filter(enemy => enemy.hp.structure > 0)) {
        applyDamage(hp, damage(attacker.hit, playerDodge, attacker.baseDamage, 1, random));
        if (hp.structure <= 0) return { cleared:false, waves:wave - 1, totalRounds, fuelUsed, ammoUsed };
      }
      for (let slot = 0; slot < route.repairSlots; slot++) {
        if (hp[route.layer] < maxHp[route.layer]) {
          hp[route.layer] = Math.min(maxHp[route.layer], hp[route.layer] + Math.round(repair.amount * repairMult));
          fuelUsed += repairFuelPerModule;
        }
      }
    }
  }
  return { cleared:true, waves:zone.maxWave, totalRounds, fuelUsed, ammoUsed };
}

function runProfile(name, profileZones, skills, runs, seedBase, routes) {
  console.log(`\n${name}（每条星带 ${runs.toLocaleString()} 次）`);
  const summaries = [];
  for (let zoneIndex = 0; zoneIndex < profileZones.length; zoneIndex++) {
    const zone = profileZones[zoneIndex];
    let clears = 0;
    let totalWaves = 0;
    let clearedFuel = 0;
    let clearedAmmo = 0;
    let clearedRounds = 0;
    for (let run = 0; run < runs; run++) {
      const result = simulateRun(zone, skills, seededRandom(seedBase + zoneIndex * runs + run), routes);
      clears += result.cleared ? 1 : 0;
      totalWaves += result.cleared ? zone.maxWave : result.waves + 1;
      if (result.cleared) {
        clearedFuel += result.fuelUsed;
        clearedAmmo += result.ammoUsed;
        clearedRounds += result.totalRounds;
      }
    }
    const supplyText = clears > 0
      ? `，成功局平均 ${Math.round(clearedRounds / clears)} 回合 / 燃料 ${Math.round(clearedFuel / clears)} / 弹药 ${Math.round(clearedAmmo / clears)}`
      : "";
    let stockText = "";
    if (clears > 0 && supplySave && routes && routes[zone.faction]) {
      const route = routes[zone.faction];
      const weaponType = equipment[route.weaponId].combat.weaponType;
      const averageFuel = clearedFuel / clears;
      const averageAmmo = clearedAmmo / clears;
      const fuelStock = Number(supplySave.resources && supplySave.resources.fuel) || 0;
      const ammoStock = Number(supplySave.resources && supplySave.resources.ammunition && supplySave.resources.ammunition[weaponType]) || 0;
      const supportedClears = Math.min(fuelStock / averageFuel, ammoStock / averageAmmo);
      stockText = `，当前存档补给约支持 ${supportedClears.toFixed(2)} 次完整肃清`;
    }
    console.log(`${zone.name}: 平均到达第 ${ (totalWaves / runs).toFixed(2) } 波，20波肃清率 ${ (clears / runs * 100).toFixed(2) }%${supplyText}${stockText}`);
    summaries.push({ zoneId:zone.id, zoneName:zone.name, averageWave:totalWaves / runs, clearRate:clears / runs });
  }
  return summaries;
}

const assertMixed = process.argv.includes("--assert-mixed");
const mixedOnly = process.argv.includes("--mixed-only") || assertMixed;
const calibrateMixed = process.argv.includes("--calibrate-mixed");
const calibrateMixedDodge = process.argv.includes("--calibrate-mixed-dodge");
if (calibrateMixedDodge) {
  const skills = { weapon:25, targeting:20, piloting:20, defense:25, shield:25, armor:25, structure:25, capacitor:25 };
  for (const zone of zones) {
    console.log(`\n${zone.name} 闪避扫描（基础属性不变，每点3,000次）`);
    for (let dodge = 10; dodge <= 30; dodge += 2) {
      const routes = { ...mixedDestroyerRouteByFaction, [zone.faction]:{ ...mixedDestroyerRouteByFaction[zone.faction], shipOverride:{ dodge } } };
      const result = runProfile(`闪避${dodge}`, [zone], skills, 3000, 20600719 + dodge * 100 + zones.indexOf(zone) * 100000, routes)[0];
      console.log(`扫描摘要：${dodge} => ${(result.clearRate * 100).toFixed(2)}%`);
    }
  }
} else if (calibrateMixed) {
  const skills = { weapon:25, targeting:20, piloting:20, defense:25, shield:25, armor:25, structure:25, capacitor:25 };
  const primaryLayer = { angel:"shield", blood:"armor", sansha:"structure" };
  for (const zone of zones) {
    console.log(`\n${zone.name} 主生命分配扫描（总生命990，每点3,000次）`);
    for (let primary = 560; primary <= 760; primary += 20) {
      const secondary = Math.floor((990 - primary) / 2);
      const hp = { shield:secondary, armor:secondary, structure:990 - primary - secondary };
      hp[primaryLayer[zone.faction]] = primary;
      if (zone.faction === "angel") hp.structure = 990 - primary - hp.armor;
      else if (zone.faction === "blood") hp.structure = 990 - primary - hp.shield;
      else hp.armor = 990 - primary - hp.shield;
      const routes = { ...mixedDestroyerRouteByFaction, [zone.faction]:{ ...mixedDestroyerRouteByFaction[zone.faction], shipOverride:{ hp } } };
      const result = runProfile(`主生命${primary}`, [zone], skills, 3000, 20500719 + primary * 100 + zones.indexOf(zone) * 100000, routes)[0];
      console.log(`扫描摘要：${primary} => ${(result.clearRate * 100).toFixed(2)}%`);
    }
  }
} else if (mixedOnly) {
  const mixedEntrySkills = { weapon:20, targeting:15, piloting:15, defense:20, shield:20, armor:20, structure:20, capacitor:20 };
  const mixedEstablishedSkills = { weapon:25, targeting:20, piloting:20, defense:25, shield:25, armor:25, structure:25, capacitor:25 };
  const mixedMatureSkills = { weapon:30, targeting:25, piloting:25, defense:30, shield:30, armor:30, structure:30, capacitor:30 };
  const commonEntry = runProfile("同技能常规驱逐舰基线", zones, mixedEntrySkills, 10000, 20400719, routeByFaction);
  const commonEstablished = runProfile("成型常规驱逐舰基线", zones, mixedEstablishedSkills, 10000, 20405719, routeByFaction);
  const mixedEntry = runProfile("入门混血驱逐舰", zones, mixedEntrySkills, 10000, 20410719, mixedDestroyerRouteByFaction);
  const mixedEstablished = runProfile("成型混血驱逐舰", zones, mixedEstablishedSkills, 10000, 20415719, mixedDestroyerRouteByFaction);
  const mixedMature = runProfile("成熟混血驱逐舰", zones, mixedMatureSkills, 10000, 20420719, mixedDestroyerRouteByFaction);
  const mixedNextTier = runProfile("成熟混血驱逐舰越级挑战0.4～0.3", lowsecZones, mixedMatureSkills, 10000, 20430719, mixedDestroyerRouteByFaction);
  if (assertMixed) {
    const failures = [];
    if (commonEntry.some(item => item.clearRate >= 0.02)) failures.push("同技能常规驱逐舰入门基线不应稳定肃清");
    if (commonEstablished.some(item => item.clearRate < 0.28 || item.clearRate > 0.42)) failures.push("成型常规驱逐舰应保持28%～42%肃清率");
    if (mixedEntry.some(item => item.clearRate >= 0.20)) failures.push("刚解锁混血驱逐舰不应稳定肃清");
    if (mixedEstablished.some(item => item.clearRate < 0.78 || item.clearRate > 0.86)) failures.push("成型混血驱逐舰应达到78%～86%肃清率");
    const mixedSpread = Math.max(...mixedEstablished.map(item => item.clearRate)) - Math.min(...mixedEstablished.map(item => item.clearRate));
    if (mixedSpread > 0.03) failures.push("成型混血驱逐舰三路线肃清率差距超过3个百分点");
    if (mixedMature.some(item => item.clearRate < 0.98)) failures.push("成熟混血驱逐舰应稳定肃清同级星带");
    if (mixedNextTier.some(item => item.clearRate > 0 || item.averageWave > 2)) failures.push("混血驱逐舰不应替代巡洋舰进入下一档星带");
    if (failures.length) throw new Error("混血驱逐舰目标校验失败：\n- " + failures.join("\n- "));
    console.log("\n目标校验通过：成型混血驱逐舰三路线为78%～86%，差距不超过3个百分点；成熟配置稳定同级且不能替代巡洋舰。");
  }
} else if (!process.argv.includes("--battleship-only")) {
  runProfile("零技能全装驱逐舰回测当前高安", highsecZones, { weapon:1, targeting:1, piloting:1, defense:1, shield:1, armor:1, structure:1 }, 5000, 20250715);
  runProfile("入门驱逐舰配置", zones, { weapon:15, targeting:10, piloting:10, defense:15, shield:15, armor:15, structure:15 }, 10000, 20260715);
  runProfile("成熟驱逐舰配置", zones, { weapon:25, targeting:20, piloting:20, defense:25, shield:25, armor:25, structure:25 }, 10000, 20270715);
  runProfile("零技能全装巡洋舰回测0.7～0.5", zones, { weapon:1, targeting:1, piloting:1, defense:1, shield:1, armor:1, structure:1 }, 5000, 20280715, cruiserRouteByFaction);
  runProfile("入门巡洋舰配置", lowsecZones, { weapon:35, targeting:25, piloting:25, defense:35, shield:35, armor:35, structure:35 }, 10000, 20290715, cruiserRouteByFaction);
  runProfile("成熟巡洋舰配置", lowsecZones, { weapon:45, targeting:40, piloting:40, defense:45, shield:45, armor:45, structure:45 }, 10000, 20300715, cruiserRouteByFaction);
}
if (!mixedOnly && !calibrateMixed && !calibrateMixedDodge) {
  runProfile("零技能全装战列舰回测0.4～0.3", lowsecZones, { weapon:1, targeting:1, piloting:1, defense:1, shield:1, armor:1, structure:1, capacitor:1 }, 5000, 20310715, battleshipRouteByFaction);
  runProfile("入门战列舰配置", deepsecZones, { weapon:55, targeting:45, piloting:45, defense:55, shield:55, armor:55, structure:55, capacitor:55 }, 10000, 20320715, battleshipRouteByFaction);
  runProfile("成熟战列舰配置", deepsecZones, { weapon:65, targeting:60, piloting:60, defense:65, shield:65, armor:65, structure:65, capacitor:65 }, 10000, 20330715, battleshipRouteByFaction);
}
