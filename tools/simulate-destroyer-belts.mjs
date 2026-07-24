import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({ window:{} });
for (const file of ["js/data/ships.js", "js/data/combat.js", "js/data/equipment.js", "js/systems/ship-enhancement.js", "js/systems/capital-combat.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename:file });
}
const enhancementRules = context.window.ShipEnhancement;
const capitalRules = context.window.CapitalCombat;
const ships = vm.runInContext("STARTER_SHIPS", context);
const equipment = vm.runInContext("EQUIPMENT_DB", context);
const enemies = vm.runInContext("ENEMY_DATABASE", context);
const allZones = vm.runInContext("COMBAT_ZONES", context);
const zones = allZones.filter(zone => zone.secLevel === "0.7-0.5");
const highsecZones = allZones.filter(zone => zone.secLevel === "1.0-0.8");
const lowsecZones = allZones.filter(zone => zone.secLevel === "0.4-0.3");
const deepsecZones = allZones.filter(zone => zone.secLevel === "0.2-0.1");
const outerNullsecZones = allZones.filter(zone => zone.secLevel === "0.0外环");
const deepNullsecZones = allZones.filter(zone => zone.secLevel === "0.0深层");
const formations = vm.runInContext("COMBAT_FORMATION_POOLS", context);
const saveArgIndex = process.argv.indexOf("--save");
const supplySave = saveArgIndex >= 0 && process.argv[saveArgIndex + 1]
  ? JSON.parse(fs.readFileSync(path.resolve(process.argv[saveArgIndex + 1]), "utf8"))
  : null;

function getNumericArg(name, fallback) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const auditEnemyHpMultiplier = getNumericArg("--enemy-hp", 1);
const auditEnemyDamageMultiplier = getNumericArg("--enemy-damage", 1);

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
  const dealt = { shield:0, armor:0, structure:0 };
  for (const layer of ["shield", "armor", "structure"]) {
    const taken = Math.min(remaining, hp[layer]);
    hp[layer] -= taken;
    remaining -= taken;
    dealt[layer] += taken;
    if (remaining <= 0) break;
  }
  return dealt;
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
      const balance = zone.enemyBalance || {};
      const kindBalance = balance[kind] || {};
      const hpScale = (Number(balance.hp) || 1) * (Number(kindBalance.hp) || 1) * auditEnemyHpMultiplier;
      const damageScale = (Number(balance.damage) || 1) * (Number(kindBalance.damage) || 1) * auditEnemyDamageMultiplier;
      waveEnemies.push({
        ...template,
        hp:Object.fromEntries(Object.entries(template.hp).map(([layer, value]) => [layer, Math.max(1, Math.round(value * hpScale))])),
        baseDamage:Math.max(1, Math.round(template.baseDamage * damageScale))
      });
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

const mixedCruiserRouteByFaction = {
  angel:{ shipId:"thunder", weaponId:"t1_medium_laser", repairId:"t1_medium_shield_booster", layer:"shield", repairSlots:4 },
  blood:{ shipId:"crimson", weaponId:"t1_heavy_missile_launcher", repairId:"t1_medium_armor_repairer", layer:"armor", repairSlots:4 },
  sansha:{ shipId:"nether", weaponId:"t1_medium_cannon", repairId:"t1_medium_structure_repairer", layer:"structure", repairSlots:4 }
};

const mixedBattleshipRouteByFaction = {
  angel:{ shipId:"dawnbreaker", weaponId:"t1_large_laser", repairId:"t1_large_shield_booster", layer:"shield", repairSlots:5 },
  blood:{ shipId:"crimson_bastion", weaponId:"t1_cruise_missile_launcher", repairId:"t1_large_armor_repairer", layer:"armor", repairSlots:5 },
  sansha:{ shipId:"spectre_frame", weaponId:"t1_large_cannon", repairId:"t1_large_structure_repairer", layer:"structure", repairSlots:5 }
};

const battleshipRouteByFaction = {
  angel:{ shipId:"sunlance", weaponId:"t1_large_laser", repairId:"t1_large_shield_booster", layer:"shield", repairSlots:5 },
  blood:{ shipId:"fortfalcon", weaponId:"t1_cruise_missile_launcher", repairId:"t1_large_armor_repairer", layer:"armor", repairSlots:5 },
  sansha:{ shipId:"thunderblade", weaponId:"t1_large_cannon", repairId:"t1_large_structure_repairer", layer:"structure", repairSlots:5 }
};

function getCapitalRoutes(enhancementLevel, supercapital, useCapitalEquipment = true) {
  const weaponIds = useCapitalEquipment
    ? { angel:"t1_capital_laser", blood:"t1_capital_missile_array", sansha:"t1_capital_cannon" }
    : { angel:"t1_large_laser", blood:"t1_cruise_missile_launcher", sansha:"t1_large_cannon" };
  const repairIds = useCapitalEquipment
    ? { angel:"t1_capital_shield_array", blood:"t1_capital_armor_array", sansha:"t1_capital_structure_array" }
    : { angel:"t1_large_shield_booster", blood:"t1_large_armor_repairer", sansha:"t1_large_structure_repairer" };
  return supercapital ? {
    angel:{ shipId:"starcrown", weaponId:weaponIds.angel, repairId:repairIds.angel, layer:"shield", repairSlots:7, enhancementLevel },
    blood:{ shipId:"eternal_fortress", weaponId:weaponIds.blood, repairId:repairIds.blood, layer:"armor", repairSlots:7, enhancementLevel },
    sansha:{ shipId:"arbiter", weaponId:weaponIds.sansha, repairId:repairIds.sansha, layer:"structure", repairSlots:7, enhancementLevel }
  } : {
    angel:{ shipId:"firmament", weaponId:weaponIds.angel, repairId:repairIds.angel, layer:"shield", repairSlots:6, enhancementLevel },
    blood:{ shipId:"heavy_bastion", weaponId:weaponIds.blood, repairId:repairIds.blood, layer:"armor", repairSlots:6, enhancementLevel },
    sansha:{ shipId:"riftbreaker", weaponId:weaponIds.sansha, repairId:repairIds.sansha, layer:"structure", repairSlots:6, enhancementLevel }
  };
}

function simulateRun(zone, skills, random, routes) {
  const route = (routes || routeByFaction)[zone.faction];
  const baseShip = ships[route.shipId];
  const ship = route.shipOverride ? { ...baseShip, ...route.shipOverride, hp:{ ...baseShip.hp, ...(route.shipOverride.hp || {}) }, bonuses:{ ...baseShip.bonuses, ...(route.shipOverride.bonuses || {}) } } : baseShip;
  const weapon = equipment[route.weaponId].combat;
  const repair = equipment[route.repairId].combat;
  const enhancement = enhancementRules.getBonuses(ship, route.enhancementLevel || 0);
  const maxHp = {
    shield:Math.round(ship.hp.shield * (1 + (ship.bonuses.shieldCapacity || 0)) * (1 + skills.shield * 0.03) * enhancement.hpMultiplier),
    armor:Math.round(ship.hp.armor * (1 + (ship.bonuses.armorCapacity || 0)) * (1 + skills.armor * 0.03) * enhancement.hpMultiplier),
    structure:Math.round(ship.hp.structure * (1 + (ship.bonuses.structureCapacity || 0)) * (1 + skills.structure * 0.03) * enhancement.hpMultiplier)
  };
  const hp = {...maxHp};
  const playerHit = weapon.baseHit + skills.weapon * 4 + skills.targeting * 3 + (ship.bonuses.hitBonus || 0);
  const playerDmgMult = (1 + skills.weapon * 0.02) * (1 + (ship.bonuses[weapon.weaponType + "Damage"] || 0)) * enhancement.damageMultiplier;
  const playerDodge = ship.dodge + skills.piloting;
  const repairMult = (1 + skills.defense * 0.02) * (1 + (ship.bonuses[route.layer + "Repair"] || 0));
  const fuelMult = ship.fuelEfficiency * (zone.fuelMult || 1) / (1 + (skills.capacitor || 1) * 0.02);
  const weaponFuelPerModule = Math.max(1, Math.round((weapon.fuelCost || 1) * fuelMult));
  const repairFuelPerModule = Math.max(1, Math.round((repair.fuelCost || 1) * fuelMult));
  let totalRounds = 0;
  let fuelUsed = 0;
  let ammoUsed = 0;
  const kills = { normal:0, elite:0, boss:0 };
  const rewardedEnemies = new WeakSet();

  for (let wave = 1; wave <= zone.maxWave; wave++) {
    const waveEnemies = spawnWave(zone, wave, random);
    let rounds = 0;
    while (waveEnemies.some(enemy => enemy.hp.structure > 0)) {
      if (++rounds > 5000) return { cleared:false, waves:wave - 1, totalRounds, fuelUsed, ammoUsed, kills };
      totalRounds++;
      fuelUsed += weaponFuelPerModule * ship.slots.high;
      ammoUsed += (weapon.ammoCost || 1) * ship.slots.high;
      const target = capitalRules.selectTarget(waveEnemies, "highest_damage", ship);
      for (let slot = 0; slot < ship.slots.high; slot++) {
        let counter = 1;
        if (weapon.weaponType === "laser" && target.hp.shield > 0) counter = 1.25;
        else if (weapon.weaponType === "missile" && target.hp.shield <= 0 && target.hp.armor > 0) counter = 1.25;
        else if (weapon.weaponType === "cannon" && target.hp.shield <= 0 && target.hp.armor <= 0 && target.hp.structure > 0) counter = 1.25;
        const traitMultiplier = capitalRules.getWeaponTraitMultiplier(ship, weapon.weaponType, hp, maxHp);
        const primaryDamage = damage(playerHit, target.dodge, weapon.baseDamage, counter * playerDmgMult * traitMultiplier, random);
        applyDamage(target.hp, primaryDamage);
        for (const areaTarget of capitalRules.getAreaDamageTargets(waveEnemies, target, weapon.aoe)) {
          applyDamage(areaTarget.enemy.hp, Math.max(1, Math.round(primaryDamage * areaTarget.multiplier)));
        }
      }
      for (const defeated of waveEnemies.filter(enemy => enemy.hp.structure <= 0 && !rewardedEnemies.has(enemy))) {
        const defeatedKind = defeated.kind || "normal";
        kills[defeatedKind] = (kills[defeatedKind] || 0) + 1;
        rewardedEnemies.add(defeated);
      }
      let shieldHitsUsed = 0;
      let armorDamageTaken = 0;
      for (const attacker of waveEnemies.filter(enemy => enemy.hp.structure > 0)) {
        const rawDamage = damage(attacker.hit, playerDodge, attacker.baseDamage, 1, random);
        const mitigation = capitalRules.applyShieldMitigation(ship, rawDamage, shieldHitsUsed, hp.shield);
        if (mitigation.shieldHitUsed) shieldHitsUsed++;
        const dealt = applyDamage(hp, Math.round(mitigation.damage));
        armorDamageTaken += dealt.armor;
        if (hp.structure <= 0) return { cleared:false, waves:wave - 1, totalRounds, fuelUsed, ammoUsed, kills };
      }
      const reactiveRepair = capitalRules.getReactiveArmorRepair(ship, armorDamageTaken, maxHp.armor);
      if (reactiveRepair > 0 && hp.armor < maxHp.armor) {
        hp.armor = Math.min(maxHp.armor, hp.armor + reactiveRepair);
      }
      for (let slot = 0; slot < route.repairSlots; slot++) {
        if (hp[route.layer] < maxHp[route.layer]) {
          hp[route.layer] = Math.min(maxHp[route.layer], hp[route.layer] + Math.round(repair.amount * repairMult));
          fuelUsed += repairFuelPerModule;
        }
      }
    }
  }
  return { cleared:true, waves:zone.maxWave, totalRounds, fuelUsed, ammoUsed, kills };
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
    let totalEliteKills = 0;
    let totalBossKills = 0;
    for (let run = 0; run < runs; run++) {
      const result = simulateRun(zone, skills, seededRandom(seedBase + zoneIndex * runs + run), routes);
      clears += result.cleared ? 1 : 0;
      totalWaves += result.cleared ? zone.maxWave : result.waves + 1;
      totalEliteKills += result.kills.elite || 0;
      totalBossKills += result.kills.boss || 0;
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
    const dataChances = zone.specialDrops && zone.specialDrops[0] ? zone.specialDrops[0].chances : zone.encryptedDataChances || { elite:0.005, boss:0.02 };
    const eliteKillsPerAttempt = totalEliteKills / runs;
    const bossKillsPerAttempt = totalBossKills / runs;
    summaries.push({
      zoneId:zone.id, zoneName:zone.name, averageWave:totalWaves / runs, clearRate:clears / runs,
      eliteKillsPerAttempt, bossKillsPerAttempt,
      expectedDataPerAttempt:eliteKillsPerAttempt * dataChances.elite + bossKillsPerAttempt * dataChances.boss
    });
  }
  return summaries;
}

const assertMixed = process.argv.includes("--assert-mixed");
const mixedOnly = process.argv.includes("--mixed-only") || assertMixed;
const calibrateMixed = process.argv.includes("--calibrate-mixed");
const calibrateMixedDodge = process.argv.includes("--calibrate-mixed-dodge");
const assertMixedCruiser = process.argv.includes("--assert-mixed-cruiser");
const mixedCruiserOnly = process.argv.includes("--mixed-cruiser-only") || assertMixedCruiser;
const calibrateMixedCruiserDodge = process.argv.includes("--calibrate-mixed-cruiser-dodge");
const calibrateMixedCruiserHp = process.argv.includes("--calibrate-mixed-cruiser-hp");
const auditMixedCruiserLoot = process.argv.includes("--audit-mixed-cruiser-loot");
const assertMixedBattleship = process.argv.includes("--assert-mixed-battleship");
const mixedBattleshipOnly = process.argv.includes("--mixed-battleship-only") || assertMixedBattleship;
const calibrateMixedBattleshipHp = process.argv.includes("--calibrate-mixed-battleship-hp");
const calibrateMixedBattleshipDodge = process.argv.includes("--calibrate-mixed-battleship-dodge");
const assertNullsec = process.argv.includes("--assert-nullsec");
const nullsecOnly = process.argv.includes("--nullsec") || assertNullsec;
const nullsecRuns = Math.round(getNumericArg("--runs", 1000));
if (nullsecOnly) {
  const skills = level => ({ weapon:level, targeting:level, piloting:level, defense:level, shield:level, armor:level, structure:level, capacitor:level });
  const factionArgIndex = process.argv.indexOf("--faction");
  const factionFilter = factionArgIndex >= 0 ? process.argv[factionArgIndex + 1] : "";
  const auditOuterZones = factionFilter ? outerNullsecZones.filter(zone => zone.faction === factionFilter) : outerNullsecZones;
  const auditDeepZones = factionFilter ? deepNullsecZones.filter(zone => zone.faction === factionFilter) : deepNullsecZones;
  const outerLegacy = runProfile("旗舰+10 / 大型T1过渡装", auditOuterZones, skills(90), nullsecRuns, 20390721, getCapitalRoutes(10, false, false));
  const outerEntry = runProfile("旗舰+0 / 同级技能", auditOuterZones, skills(80), nullsecRuns, 20400721, getCapitalRoutes(0, false));
  const outerEstablished = runProfile("旗舰+5 / 成型技能", auditOuterZones, skills(85), nullsecRuns, 20410721, getCapitalRoutes(5, false));
  const outerMature = runProfile("旗舰+10 / 成熟技能", auditOuterZones, skills(90), nullsecRuns, 20420721, getCapitalRoutes(10, false));
  const deepFlagship = runProfile("旗舰+10挑战深层", auditDeepZones, skills(90), nullsecRuns, 20430721, getCapitalRoutes(10, false));
  const deepEntry = runProfile("超级旗舰+0 / 同级技能", auditDeepZones, skills(90), nullsecRuns, 20440721, getCapitalRoutes(0, true));
  runProfile("超级旗舰+5 / 成型技能", auditDeepZones, skills(95), nullsecRuns, 20450721, getCapitalRoutes(5, true));
  const deepMature = runProfile("超级旗舰+10 / 成熟技能", auditDeepZones, skills(99), nullsecRuns, 20460721, getCapitalRoutes(10, true));
  if (assertNullsec) {
    const failures = [];
  console.log("\n旗舰+10深层数据获取期望（失败出击仍保留精英掉落）：");
  for (const result of deepFlagship) {
    console.log(`${result.zoneName}: 每次出击 ${result.expectedDataPerAttempt.toFixed(3)} 份，集齐60份约 ${Math.ceil(60 / result.expectedDataPerAttempt)} 次出击`);
  }
    const spread = results => Math.max(...results.map(item => item.clearRate)) - Math.min(...results.map(item => item.clearRate));
    if (outerLegacy.some(item => item.clearRate >= 0.30)) failures.push("大型T1过渡装不应让旗舰稳定肃清0.0外环");
    if (outerEntry.some(item => item.clearRate >= 0.10)) failures.push("旗舰+0不应稳定肃清0.0外环");
    if (outerEstablished.some(item => item.clearRate >= 0.80)) failures.push("旗舰+5不应提前进入稳定肃清阶段");
    if (outerMature.some(item => item.clearRate < 0.88 || item.clearRate > 0.95) || spread(outerMature) > 0.03) failures.push("旗舰+10外环肃清率应为88%～95%且三路线差距不超过3个百分点");
    if (deepFlagship.some(item => item.clearRate > 0 || item.expectedDataPerAttempt <= 0)) failures.push("旗舰+10不应肃清深层0.0，但必须能从精英取得少量深层数据");
    if (deepEntry.some(item => item.clearRate >= 0.10)) failures.push("超级旗舰+0不应稳定肃清深层0.0");
    if (deepMature.some(item => item.clearRate < 0.88 || item.clearRate > 0.96) || spread(deepMature) > 0.03) failures.push("超级旗舰+10深层肃清率应为88%～96%且三路线差距不超过3个百分点");
    if (failures.length) throw new Error("0.0目标校验失败：\n- " + failures.join("\n- "));
    console.log("\n0.0目标校验通过：旗舰+10稳定外环，旗舰只能从深层精英缓慢获取数据，超级旗舰+10稳定深层且三路线差距不超过3个百分点。");
  }
} else if (calibrateMixedCruiserHp) {
  const zone = lowsecZones.find(item => item.faction === "blood");
  const entrySkills = { weapon:40, targeting:30, piloting:30, defense:40, shield:40, armor:40, structure:40, capacitor:40 };
  const establishedSkills = { weapon:45, targeting:40, piloting:40, defense:45, shield:45, armor:45, structure:45, capacitor:45 };
  for (let primary = 1200; primary <= 1380; primary += 30) {
    const secondary = Math.floor((2070 - primary) / 2);
    const hp = { shield:secondary, armor:primary, structure:2070 - primary - secondary };
    const routes = { ...mixedCruiserRouteByFaction, blood:{ ...mixedCruiserRouteByFaction.blood, shipOverride:{ dodge:14, hp } } };
    const entry = runProfile(`入门主装甲${primary}`, [zone], entrySkills, 3000, 20800720 + primary, routes)[0];
    const established = runProfile(`成型主装甲${primary}`, [zone], establishedSkills, 3000, 20900720 + primary, routes)[0];
    console.log(`扫描摘要：装甲${primary} / 闪避14 => 入门 ${(entry.clearRate * 100).toFixed(2)}% / 成型 ${(established.clearRate * 100).toFixed(2)}%`);
  }} else if (calibrateMixedCruiserDodge) {
  const skills = { weapon:45, targeting:40, piloting:40, defense:45, shield:45, armor:45, structure:45, capacitor:45 };
  for (const zone of lowsecZones) {
    console.log(`\n${zone.name} 混血巡洋舰闪避扫描（基础属性不变，每点3,000次）`);
    for (let dodge = 4; dodge <= 24; dodge += 2) {
      const routes = { ...mixedCruiserRouteByFaction, [zone.faction]:{ ...mixedCruiserRouteByFaction[zone.faction], shipOverride:{ dodge } } };
      const result = runProfile(`闪避${dodge}`, [zone], skills, 3000, 20700720 + dodge * 100 + lowsecZones.indexOf(zone) * 100000, routes)[0];
      console.log(`扫描摘要：${dodge} => ${(result.clearRate * 100).toFixed(2)}%`);
    }
  }
} else if (auditMixedCruiserLoot) {
  const skills = { weapon:45, targeting:40, piloting:40, defense:45, shield:45, armor:45, structure:45, capacitor:45 };
  const results = runProfile("成型常规巡洋舰数据获取审计", lowsecZones, skills, 30000, 21000720, cruiserRouteByFaction);
  console.log("\n混血巡洋舰每艘需要30份对应中级加密数据：");
  for (const result of results) {
    const attempts = 30 / result.expectedDataPerAttempt;
    const expectedLP = attempts * result.clearRate * 10;
    console.log(`${result.zoneName}: 每次出击期望数据 ${result.expectedDataPerAttempt.toFixed(4)}，约需 ${attempts.toFixed(1)} 次出击，期间期望获得 ${expectedLP.toFixed(0)} LP`);
  }
} else if (mixedCruiserOnly) {
  const entrySkills = { weapon:40, targeting:30, piloting:30, defense:40, shield:40, armor:40, structure:40, capacitor:40 };
  const establishedSkills = { weapon:45, targeting:40, piloting:40, defense:45, shield:45, armor:45, structure:45, capacitor:45 };
  const matureSkills = { weapon:50, targeting:45, piloting:45, defense:50, shield:50, armor:50, structure:50, capacitor:50 };
  const commonEstablished = runProfile("成型常规巡洋舰基线", lowsecZones, establishedSkills, 10000, 20710720, cruiserRouteByFaction);
  const mixedEntry = runProfile("入门混血巡洋舰", lowsecZones, entrySkills, 10000, 20720720, mixedCruiserRouteByFaction);
  const mixedEstablished = runProfile("成型混血巡洋舰", lowsecZones, establishedSkills, 10000, 20730720, mixedCruiserRouteByFaction);
  const mixedMature = runProfile("成熟混血巡洋舰", lowsecZones, matureSkills, 10000, 20740720, mixedCruiserRouteByFaction);
  const mixedNextTier = runProfile("成熟混血巡洋舰越级挑战0.2～0.1", deepsecZones, matureSkills, 10000, 20750720, mixedCruiserRouteByFaction);
  if (assertMixedCruiser) {
    const failures = [];
    if (commonEstablished.some(item => item.clearRate < 0.28 || item.clearRate > 0.42)) failures.push("成型常规巡洋舰应保持28%～42%肃清率");
    if (mixedEntry.some(item => item.clearRate >= 0.20)) failures.push("刚解锁混血巡洋舰不应稳定肃清");
    if (mixedEstablished.some(item => item.clearRate < 0.78 || item.clearRate > 0.86)) failures.push("成型混血巡洋舰应达到78%～86%肃清率");
    const spread = Math.max(...mixedEstablished.map(item => item.clearRate)) - Math.min(...mixedEstablished.map(item => item.clearRate));
    if (spread > 0.03) failures.push("成型混血巡洋舰三路线肃清率差距超过3个百分点");
    if (mixedMature.some(item => item.clearRate < 0.98)) failures.push("成熟混血巡洋舰应稳定肃清同级星带");
    if (mixedNextTier.some(item => item.clearRate > 0 || item.averageWave > 2)) failures.push("混血巡洋舰不应替代战列舰进入下一档星带");
    if (failures.length) throw new Error("混血巡洋舰目标校验失败：\n- " + failures.join("\n- "));
    console.log("\n目标校验通过：成型混血巡洋舰三路线为78%～86%，差距不超过3个百分点；成熟配置稳定同级且不能替代战列舰。");
  }
} else if (mixedBattleshipOnly) {
  const entrySkills = { weapon:60, targeting:45, piloting:45, defense:60, shield:60, armor:60, structure:60, capacitor:60 };
  const establishedSkills = { weapon:65, targeting:60, piloting:60, defense:65, shield:65, armor:65, structure:65, capacitor:65 };
  const matureSkills = { weapon:70, targeting:65, piloting:65, defense:70, shield:70, armor:70, structure:70, capacitor:70 };
  const entry = runProfile("入门混血战列舰", deepsecZones, entrySkills, 10000, 20770720, mixedBattleshipRouteByFaction);
  const established = runProfile("成型混血战列舰", deepsecZones, establishedSkills, 10000, 20780720, mixedBattleshipRouteByFaction);
  const mature = runProfile("成熟混血战列舰", deepsecZones, matureSkills, 10000, 20790720, mixedBattleshipRouteByFaction);
  const nextTier = runProfile("成熟混血战列舰越级挑战0.0外环", outerNullsecZones, matureSkills, 10000, 20800720, mixedBattleshipRouteByFaction);
  if (assertMixedBattleship) {
    const failures = [];
    if (entry.some(item => item.clearRate >= 0.20)) failures.push("刚解锁混血战列舰不应稳定肃清同级星带（应<20%）");
    if (established.some(item => item.clearRate < 0.78 || item.clearRate > 0.86)) failures.push("成型混血战列舰应达到78%～86%肃清率");
    const spread = Math.max(...established.map(item => item.clearRate)) - Math.min(...established.map(item => item.clearRate));
    if (spread > 0.03) failures.push("成型混血战列舰三路线肃清率差距超过3个百分点");
    if (mature.some(item => item.clearRate < 0.98)) failures.push("成熟混血战列舰应稳定肃清同级星带（应≥98%）");
    if (nextTier.some(item => item.clearRate > 0 || item.averageWave > 2)) failures.push("混血战列舰不应替代旗舰进入0.0外环（肃清率须为0且平均推进≤2波）");
    if (failures.length) throw new Error("混血战列舰目标校验失败：\n- " + failures.join("\n- "));
    console.log("\n混血战列舰目标校验通过：成型三路线78%～86%且差距不超过3个百分点；成熟配置稳定同级且不能替代旗舰进入0.0外环。");
  }
} else if (calibrateMixedBattleshipHp) {
  const skills = { weapon:65, targeting:60, piloting:60, defense:65, shield:65, armor:65, structure:65, capacitor:65 };
  const primaryLayer = { angel:"shield", blood:"armor", sansha:"structure" };
  console.log("混血战列舰主生命分配扫描（总生命4320，每点3,000次，成型技能）");
  for (let primary = 2600; primary <= 3800; primary += 100) {
    const rest = 4320 - primary;
    const secondary = Math.floor(rest / 2);
    const trio = [];
    for (const fac of ["angel","blood","sansha"]) {
      const zone = deepsecZones.find(z => z.faction === fac);
      const otherLayers = ["shield","armor","structure"].filter(l => l !== primaryLayer[fac]);
      const hp = { shield:secondary, armor:secondary, structure:secondary };
      hp[primaryLayer[fac]] = primary;
      hp[otherLayers[1]] = rest - secondary;
      const routes = { ...mixedBattleshipRouteByFaction, [fac]:{ ...mixedBattleshipRouteByFaction[fac], shipOverride:{ hp } } };
      const result = runProfile(`主生命${primary}`, [zone], skills, 3000, 20900719 + primary * 100 + (fac === "angel" ? 0 : fac === "blood" ? 1 : 2) * 100000, routes)[0];
      trio.push(result.clearRate * 100);
    }
    const spread = Math.max(...trio) - Math.min(...trio);
    console.log(`主生命${primary}: 天使${trio[0].toFixed(2)}% 血袭${trio[1].toFixed(2)}% 萨沙${trio[2].toFixed(2)}% | 差${spread.toFixed(2)}pp`);
  }
} else if (calibrateMixedBattleshipDodge) {
  const skills = { weapon:65, targeting:60, piloting:60, defense:65, shield:65, armor:65, structure:65, capacitor:65 };
  for (const zone of deepsecZones) {
    console.log(`\n${zone.name} 闪避扫描（基础属性不变，每点3,000次）`);
    for (let dodge = 4; dodge <= 24; dodge += 2) {
      const routes = { ...mixedBattleshipRouteByFaction, [zone.faction]:{ ...mixedBattleshipRouteByFaction[zone.faction], shipOverride:{ dodge } } };
      const result = runProfile(`闪避${dodge}`, [zone], skills, 3000, 20910719 + dodge * 100 + deepsecZones.indexOf(zone) * 100000, routes)[0];
      console.log(`扫描摘要：${dodge} => ${(result.clearRate * 100).toFixed(2)}%`);
    }
  }
} else if (calibrateMixedDodge) {
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
if (!nullsecOnly && !mixedOnly && !mixedCruiserOnly && !calibrateMixed && !calibrateMixedDodge && !calibrateMixedCruiserDodge && !calibrateMixedCruiserHp && !auditMixedCruiserLoot) {
  runProfile("零技能全装战列舰回测0.4～0.3", lowsecZones, { weapon:1, targeting:1, piloting:1, defense:1, shield:1, armor:1, structure:1, capacitor:1 }, 5000, 20310715, battleshipRouteByFaction);
  runProfile("入门战列舰配置", deepsecZones, { weapon:55, targeting:45, piloting:45, defense:55, shield:55, armor:55, structure:55, capacitor:55 }, 10000, 20320715, battleshipRouteByFaction);
  runProfile("成熟战列舰配置", deepsecZones, { weapon:65, targeting:60, piloting:60, defense:65, shield:65, armor:65, structure:65, capacitor:65 }, 10000, 20330715, battleshipRouteByFaction);
}
