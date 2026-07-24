
/* ================================================================
   战斗系统 — 核心与旧调用兼容层
   DOM渲染位于 js/ui/combat-render.js
   ================================================================ */

function getActiveCombatShipInstance() {
  return getActiveCombatShipState(gameState).instance;
}

const COMBAT_RECOVERY_MS = 180000;

function getInstalledCombatModules() {
  return getInstalledCombatModulesFromState(gameState).map(module => ({ id:module.id, itemId:module.itemId, instance:module.instance, enhancementLevel:module.enhancementLevel, multiplier:module.multiplier, equipment:EQUIPMENT_DB[module.itemId], slot:module.slot }));
}

function getInstalledCombatWeapons() {
  return getInstalledCombatModules().filter(module => module.equipment.combat.kind === "weapon");
}

function getInstalledCombatRepairers() {
  return getInstalledCombatModules().filter(module => module.equipment.combat.kind === "repair");
}

function getCombatRecoveryRemaining(now) {
  return getCombatDisplayState(gameState, Number(now) || Date.now()).recovery.remaining;
}

function finishCombatRecovery(now) {
  return dispatchGameAction(gameState, { type:"combat/finishRecovery" }, Number(now) || Date.now()).changed;
}

function updateCombatRecovery(now) {
  finishCombatRecovery(now);
  return getCombatRecoveryRemaining(now);
}

function onCombatEvent(listener) {
  return GameEvents.on("combat:event", event => listener(event.payload));
}

function emitCombatEvent(event) {
  GameEvents.emit("combat:event", event);
}

function beginCombatRecovery() {
  const result = dispatchGameAction(gameState, { type:"combat/beginRecovery" }, Date.now());
  if (result.changed) {
    const payload = { type:"ship-destroyed", shipId:gameState.combat.destroyedShip, repairSeconds:180 };
    GameEvents.emit("ship:destroyed", payload);
    emitCombatEvent(payload);
  }
  return result.changed;
}

const SHIP_TYPE_NAMES = { frigate:"护卫舰", destroyer:"驱逐舰", cruiser:"巡洋舰", battleship:"战列舰", capital:"旗舰", supercapital:"超级旗舰", industrial_frigate:"工业护卫舰", industrial_destroyer:"工业驱逐舰", industrial_cruiser:"工业巡洋舰", industrial_support:"工业支援舰", industrial_battleship:"大型工业舰", industrial_capital:"工业旗舰", archaeology_frigate:"考古护卫舰", archaeology_destroyer:"考古驱逐舰", archaeology_cruiser:"考古巡洋舰", archaeology_battleship:"考古战列舰", archaeology_capital:"考古旗舰" };

function isIndustrialShip(shipId) {
  return INDUSTRIAL_SHIPS && INDUSTRIAL_SHIPS[shipId] !== undefined;
}

function getShipConfig(shipId) {
  if (isIndustrialShip(shipId)) return INDUSTRIAL_SHIPS[shipId];
  const resolved = getShipConfigById(shipId);
  return resolved || STARTER_SHIPS[shipId] || null;
}

function getActiveShip() {
  const assigned = getAssignedShip("combat");
  if (assigned) return assigned;
  const shipRef = gameState.combat.activeShip || (gameState.inventory.ships.length > 0 ? gameState.inventory.ships[0].instanceId : "rifter");
  const instance = getShipInstance(shipRef);
  const cfg = getShipConfig(instance ? instance.shipId : shipRef);
  return cfg || STARTER_SHIPS.rifter;
}


/* ================================================================
   战斗系统 — 核心逻辑
   ================================================================ */

function calcCombatDamageVariance(randomFn) {
  const roll = typeof randomFn === "function" ? randomFn : Math.random;
  return 0.90 + (roll() + roll()) * 0.10;
}

function calcCombatDamage(attackerHit, targetDodge, baseDps, counterMultiplier, randomFn) {
  const hitPower = Math.pow(attackerHit, 1.4);
  const dodgePower = Math.pow(targetDodge, 1.4);
  const coefficient = hitPower / (hitPower + dodgePower);
  const variance = calcCombatDamageVariance(randomFn);
  return Math.max(1, Math.round(baseDps * coefficient * counterMultiplier * variance));
}

// ---- 战斗技能加成计算 ----
function getSkillLvl(key) { return (gameState.skills[key] && gameState.skills[key].lvl) || 1; }

function calcPlayerHit(weapon, equipment) {
  return getCombatWeaponHitFromState(gameState, weapon, equipment && equipment.combat);
}

function calcPlayerDmgMult(weapon) {
  return getCombatDamageMultiplierFromState(gameState, weapon);
}

function calcCombatMaxHp(ship, shipInstance) {
  return getCombatMaxHpFromState(gameState);
}

function calcPlayerDodge(ship) {
  return getCombatPlayerDodgeFromState(gameState);
}

function calcFuelMult(zone) {
  return getCombatFuelMultiplierFromState(gameState, zone);
}

function calcRepairMult(target) {
  return getCombatRepairMultiplierFromState(gameState, target);
}

function calcCL() {
  return getCombatLevelFromState(gameState);
}

function canEnterCombatZone(zone) {
  return Boolean(zone) && getCombatLevelFromState(gameState) >= (zone.requiredCL || 1);
}

function getLivingCombatEnemies(combat) {
  const c = combat || gameState.combat;
  if (!Array.isArray(c.enemies)) c.enemies = [];
  if (c.enemies.length === 0 && c.currentEnemy && c.currentEnemy.hp && c.currentEnemy.hp.structure > 0) {
    c.enemies = [c.currentEnemy];
  }
  return c.enemies.filter(enemy => enemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
}

function syncCurrentCombatTarget(combat) {
  const c = combat || gameState.combat;
  const ship = getActiveShip();
  c.currentEnemy = selectCapitalCombatTarget(getLivingCombatEnemies(c), c.targetingMode, ship);
  return c.currentEnemy;
}

function getCombatFormation(zone, wave, randomFn) {
  const maxWave = zone.maxWave || 20;
  if (wave >= maxWave) {
    return { id:"boss", normal:zone.bossEscortCount || 0, elite:0, boss:1 };
  }
  const formations = COMBAT_FORMATION_POOLS[zone.formationPool] || COMBAT_FORMATION_POOLS.highsec;
  const roll = typeof randomFn === "function" ? randomFn : Math.random;
  const value = roll();
  let cumulative = 0;
  for (const formation of formations) {
    cumulative += formation.chance;
    if (value < cumulative) return { ...formation, boss:0 };
  }
  const fallback = formations[formations.length - 1];
  return { ...fallback, boss:0 };
}

function getRandomCombatEnemyKey(zone, kind, randomFn) {
  const pool = zone.enemyPool && zone.enemyPool[kind];
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const roll = typeof randomFn === "function" ? randomFn : Math.random;
  return pool[Math.min(pool.length - 1, Math.floor(roll() * pool.length))];
}

function createCombatEnemy(zone, kind, randomFn) {
  const faction = ENEMY_DATABASE[zone.faction];
  const enemyKey = getRandomCombatEnemyKey(zone, kind, randomFn);
  const tpl = faction && faction.types[enemyKey];
  if (!tpl) return null;
  const balance = zone.enemyBalance || {};
  const kindBalance = balance[kind] || {};
  const hpScale = (Number(balance.hp) || 1) * (Number(kindBalance.hp) || 1);
  const damageScale = (Number(balance.damage) || 1) * (Number(kindBalance.damage) || 1);
  const scaledHp = Object.fromEntries(Object.entries(tpl.hp).map(([layer, value]) => [layer, Math.max(1, Math.round(value * hpScale))]));
  return {
    id:"enemy_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    type:enemyKey, kind:tpl.kind || kind, name:tpl.name, icon:tpl.icon,
    hp:{...scaledHp}, maxHp:{...scaledHp},
    level:tpl.level, hit:tpl.hit, dodge:tpl.dodge, baseDamage:Math.max(1, Math.round((tpl.baseDamage || 1) * damageScale)),
    iskDrop:tpl.iskDrop, xpDrop:tpl.xpDrop, image:tpl.image,
    defeated:false, rewarded:false
  };
}

function getDeathspaceById(deathspaceId) {
  return DEATHSPACE_DATABASE.find(site => site.id === deathspaceId) || null;
}

function getDeathspaceForSourceZone(zoneId) {
  return DEATHSPACE_DATABASE.find(site => site.sourceZoneId === zoneId) || null;
}

function getCombatEncounterZone(combat) {
  const c = combat || gameState.combat;
  if (c && c.mode === "deathspace") {
    const site = getDeathspaceById(c.deathspaceId);
    return site ? COMBAT_ZONES.find(zone => zone.id === site.sourceZoneId) || null : null;
  }
  return COMBAT_ZONES.find(zone => zone.id === (c && c.zone)) || null;
}

function buildDeathspaceWave(site, wave, randomFn) {
  const zone = site && COMBAT_ZONES.find(item => item.id === site.sourceZoneId);
  const waveConfig = site && site.waves[Math.max(0, wave - 1)];
  if (!zone || !waveConfig) return { formationId:"", enemies:[] };
  const balance = site.combatBalance || {};
  const hpScale = (balance.hp || 1) * (waveConfig.final ? (balance.finalHp || 1) : 1);
  const damageScale = (balance.damage || 1) * (waveConfig.final ? (balance.finalDamage || 1) : 1);
  const enemies = [];
  for (let index = 0; index < (waveConfig.escortNormal || 0); index++) {
    const escort = createCombatEnemy(zone, "normal", randomFn);
    if (!escort) continue;
    escort.baseDamage = Math.max(1, Math.round(escort.baseDamage * damageScale));
    for (const layer of ["shield", "armor", "structure"]) {
      escort.maxHp[layer] = Math.max(1, Math.round(escort.maxHp[layer] * hpScale));
      escort.hp[layer] = escort.maxHp[layer];
    }
    enemies.push(escort);
  }
  const leader = createCombatEnemy(zone, "boss", randomFn);
  if (leader) {
    leader.name = waveConfig.name;
    leader.deathspaceLeader = true;
    leader.deathspaceWave = wave;
    leader.deathspaceFinal = Boolean(waveConfig.final);
    leader.baseDamage = Math.max(1, Math.round(leader.baseDamage * waveConfig.damageMult * damageScale));
    for (const layer of ["shield", "armor", "structure"]) {
      leader.maxHp[layer] = Math.max(1, Math.round(leader.maxHp[layer] * waveConfig.hpMult * hpScale));
      leader.hp[layer] = leader.maxHp[layer];
    }
    enemies.push(leader);
  }
  return { formationId:"deathspace_" + wave, enemies:shuffleCombatEnemies(enemies.filter(Boolean), randomFn) };
}

function shuffleCombatEnemies(enemies, randomFn) {
  const roll = typeof randomFn === "function" ? randomFn : Math.random;
  for (let index = enemies.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(roll() * (index + 1));
    [enemies[index], enemies[swapIndex]] = [enemies[swapIndex], enemies[index]];
  }
  return enemies;
}

function buildCombatWave(zone, wave, randomFn) {
  if (!zone) return { formationId:"", enemies:[] };
  const formation = getCombatFormation(zone, wave, randomFn);
  const enemies = [];
  for (let index = 0; index < (formation.normal || 0); index++) enemies.push(createCombatEnemy(zone, "normal", randomFn));
  for (let index = 0; index < (formation.elite || 0); index++) enemies.push(createCombatEnemy(zone, "elite", randomFn));
  for (let index = 0; index < (formation.boss || 0); index++) enemies.push(createCombatEnemy(zone, "boss", randomFn));
  return { formationId:formation.id, enemies:shuffleCombatEnemies(enemies.filter(Boolean), randomFn) };
}

function spawnCombatWave(randomFn) {
  const c = gameState.combat;
  const zone = getCombatEncounterZone(c);
  if (!zone) return [];
  const site = c.mode === "deathspace" ? getDeathspaceById(c.deathspaceId) : null;
  const wave = site ? buildDeathspaceWave(site, c.wave, randomFn) : buildCombatWave(zone, c.wave, randomFn);
  c.enemies = wave.enemies;
  c.currentFormation = wave.formationId;
  c.lastEnemyVolley = null;
  syncCurrentCombatTarget(c);
  return c.enemies;
}

// 保留旧调试入口名称；新系统每次生成整支编队。
function spawnCombatEnemy(randomFn) {
  return spawnCombatWave(randomFn);
}

function rollFactionEncryptedDataDrop(factionId, enemyKind, randomValue, zone) {
  if (zone && zone.encryptedDataDisabled) return null;
  if (enemyKind !== "elite" && enemyKind !== "boss") return null;
  const drop = FACTION_ENCRYPTED_DATA_DROPS[factionId];
  if (!drop) return null;
  const chanceTable = zone && zone.encryptedDataChances ? zone.encryptedDataChances : drop.chances;
  const chance = chanceTable && chanceTable[enemyKind];
  if (!chance) return null;
  const roll = randomValue === undefined ? Math.random() : randomValue;
  if (roll >= chance) return null;
  const material = zone && zone.encryptedDataMaterial ? zone.encryptedDataMaterial : drop.material;
  ResourceRegistry.add(gameState, "special:" + material, drop.qty);
  return { material, qty:drop.qty };
}

function rollCombatZoneSpecialDrops(zone, enemyKind, randomValues) {
  if (!zone || !Array.isArray(zone.specialDrops) || (enemyKind !== "elite" && enemyKind !== "boss")) return [];
  const values = Array.isArray(randomValues) ? randomValues : [];
  const drops = [];
  for (let index = 0; index < zone.specialDrops.length; index++) {
    const config = zone.specialDrops[index];
    const chance = config && config.chances ? Number(config.chances[enemyKind]) || 0 : 0;
    const roll = values[index] !== undefined ? values[index] :
      typeof randomValues === "number" ? randomValues : Math.random();
    if (!config || !config.resourceId || roll >= chance) continue;
    const qty = Math.max(1, Number(config.qty) || 1);
    ResourceRegistry.add(gameState, config.resourceId, qty);
    drops.push({ material:config.material || config.resourceId.split(":").slice(1).join(":"), resourceId:config.resourceId, qty, rarity:enemyKind === "boss" ? "guaranteedBoss" : "rare" });
  }
  return drops;
}

function rollDeathspaceTicketDrop(zone, enemyKind, randomValue) {
  if (!zone || (enemyKind !== "elite" && enemyKind !== "boss")) return null;
  const site = getDeathspaceForSourceZone(zone.id);
  if (!site) return null;
  const chance = site.ticketChances[enemyKind] || 0;
  const roll = randomValue === undefined ? Math.random() : randomValue;
  if (roll >= chance) return null;
  ResourceRegistry.add(gameState, "special:" + site.ticketMaterial, 1);
  return { material:site.ticketMaterial, qty:1, deathspaceId:site.id };
}

function rollDeathspaceLeaderLoot(site, wave, coreRandomValue, protocolRandomValue) {
  const waveConfig = site && site.waves[Math.max(0, wave - 1)];
  if (!waveConfig) return [];
  const drops = [];
  const coreRoll = coreRandomValue === undefined ? Math.random() : coreRandomValue;
  if (coreRoll < (waveConfig.coreChance || 0)) {
    ResourceRegistry.add(gameState, "special:" + site.coreMaterial, 1);
    drops.push({ material:site.coreMaterial, qty:1, rarity:"rare" });
  }
  if (waveConfig.final) {
    const protocolRoll = protocolRandomValue === undefined ? Math.random() : protocolRandomValue;
    if (protocolRoll < (site.protocolChance || 0)) {
      ResourceRegistry.add(gameState, "special:" + site.protocolMaterial, 1);
      drops.push({ material:site.protocolMaterial, qty:1, rarity:"veryRare" });
    }
  }
  return drops;
}

function applyLayeredCombatDamage(hp, amount) {
  let remaining = Math.max(0, amount);
  const dealt = { shield:0, armor:0, structure:0 };
  for (const layer of ["shield","armor","structure"]) {
    if (remaining <= 0 || hp[layer] <= 0) continue;
    const damage = Math.min(remaining, hp[layer]);
    hp[layer] -= damage;
    remaining -= damage;
    dealt[layer] += damage;
  }
  return dealt;
}

function resolveCombatEnemyDefeat(enemy, zone) {
  if (!enemy || enemy.rewarded) return null;
  const c = gameState.combat;
  const isk = Math.round(enemy.iskDrop * zone.iskMulti);
  ResourceRegistry.add(gameState, "currency:isk", isk);
  enemy.defeated = true;
  enemy.rewarded = true;
  c.lastLoot = "ISK " + isk.toLocaleString();
  const deathspace = c.mode === "deathspace" ? getDeathspaceById(c.deathspaceId) : null;
  const dataDrop = deathspace ? null : rollFactionEncryptedDataDrop(zone.faction, enemy.kind, undefined, zone);
  if (dataDrop) c.lastLoot += " · " + dataDrop.material + " ×" + dataDrop.qty;
  const zoneSpecialDrops = deathspace ? [] : rollCombatZoneSpecialDrops(zone, enemy.kind);
  for (const drop of zoneSpecialDrops) c.lastLoot += " · " + drop.material + " ×" + drop.qty;
  const ticketDrop = deathspace ? null : rollDeathspaceTicketDrop(zone, enemy.kind);
  if (ticketDrop) c.lastLoot += " · " + ticketDrop.material + " ×" + ticketDrop.qty;
  const deathspaceDrops = deathspace && enemy.deathspaceLeader ? rollDeathspaceLeaderLoot(deathspace, enemy.deathspaceWave) : [];
  for (const drop of deathspaceDrops) c.lastLoot += " · " + drop.material + " ×" + drop.qty;
  const specialDrops = [ticketDrop, ...zoneSpecialDrops, ...deathspaceDrops].filter(Boolean);
  if (specialDrops.length > 0) c.lastSpecialLoot = specialDrops.map(drop => drop.material + " ×" + drop.qty).join(" · ");
  c.totalKills++;
  if (enemy.kind === "elite") c.runEliteKills = (c.runEliteKills || 0) + 1;
  syncCurrentCombatTarget(c);
  GameEvents.emit("combat:enemyDefeated", { zoneId:deathspace ? deathspace.id : zone.id, faction:zone.faction, enemyId:enemy.id, enemyKind:enemy.kind, isk, xp:enemy.xpDrop || 10, dataDrop, zoneSpecialDrops, ticketDrop, deathspaceDrops });
  return { isk, dataDrop, zoneSpecialDrops, ticketDrop, deathspaceDrops };
}

function resolveDeathspaceWaveVictory(site, zone) {
  const c = gameState.combat;
  const waveLp = site.waveLp || 0;
  ResourceRegistry.add(gameState, "currency:lp", waveLp);
  c.lastLoot = (c.lastLoot ? c.lastLoot + " · " : "") + "房间LP +" + waveLp;
  GameEvents.emit("combat:deathspaceWaveCleared", { deathspaceId:site.id, zoneId:zone.id, wave:c.wave, lp:waveLp });
  if (c.wave >= site.maxWave) {
    const clearLp = site.clearLpBonus || 0;
    ResourceRegistry.add(gameState, "currency:lp", clearLp);
    if (!c.deathspaceClears || typeof c.deathspaceClears !== "object") c.deathspaceClears = {};
    c.deathspaceClears[site.id] = (c.deathspaceClears[site.id] || 0) + 1;
    c.lastLoot += " · 全通LP +" + clearLp;
    c.lastStatus = "死亡空间全通 · " + site.name;
    c.active = false;
    gameState.currentAction.active = false;
    c.enemies = [];
    c.currentEnemy = null;
    c.wave = 1;
    c.currentFormation = "";
    c.lastEnemyVolley = null;
    const maxHp = getCombatMaxHpFromState(gameState, { zoneId:zone.id });
    c.hp = { ...maxHp };
    c.maxHp = { ...maxHp };
    GameEvents.emit("combat:deathspaceCleared", { deathspaceId:site.id, name:site.name, lp:waveLp * site.maxWave + clearLp, clearCount:c.deathspaceClears[site.id] });
    return true;
  }
  c.lastStatus = "房间肃清 · LP +" + waveLp;
  c.wave++;
  spawnCombatWave();
  return true;
}

function resolveCombatWaveVictory(zone) {
  const c = gameState.combat;
  if (getLivingCombatEnemies(c).length > 0) return false;
  if (c.mode === "deathspace") {
    const site = getDeathspaceById(c.deathspaceId);
    return site ? resolveDeathspaceWaveVictory(site, zone) : false;
  }
  const maxWave = zone.maxWave || 20;
  if (c.wave >= maxWave) {
    const lp = zone.clearLp || 0;
    ResourceRegistry.add(gameState, "currency:lp", lp);
    if (!c.zoneClears || typeof c.zoneClears !== "object") c.zoneClears = {};
    c.zoneClears[zone.id] = (c.zoneClears[zone.id] || 0) + 1;
    c.lastLoot = (c.lastLoot ? c.lastLoot + " · " : "") + "肃清LP +" + lp;
    c.lastStatus = "肃清完成 · " + zone.name;
    GameEvents.emit("combat:zoneCleared", { zoneId:zone.id, name:zone.name, lp, clearCount:c.zoneClears[zone.id] });
    c.wave = 1;
    c.runEliteKills = 0;
  } else {
    GameEvents.emit("combat:waveCleared", { zoneId:zone.id, wave:c.wave });
    c.wave++;
    c.lastStatus = "";
  }
  spawnCombatWave();
  return true;
}

function combatTick() {
  const c = gameState.combat;
  updateCombatRecovery();
  if (!c.active) return;
  const zone = getCombatEncounterZone(c);
  if (!zone) return;
  const faction = ENEMY_DATABASE[zone.faction];
  if (!faction) return;
  const ship = getActiveShip();
  const shipInstance = getActiveCombatShipInstance();
  const weapons = getInstalledCombatWeapons();
  const repairers = getInstalledCombatRepairers();
  let enemy = syncCurrentCombatTarget(c);
  if (!enemy) {
    resolveCombatWaveVictory(zone);
    enemy = syncCurrentCombatTarget(c);
    if (!enemy) return;
  }

  // 动态刷新 maxHp（技能升级后自动增长）
  const dynMaxHp = calcCombatMaxHp(ship, shipInstance);
  c.maxHp = dynMaxHp;
  if (c.hp.shield  > c.maxHp.shield)  c.hp.shield  = c.maxHp.shield;
  if (c.hp.armor   > c.maxHp.armor)   c.hp.armor   = c.maxHp.armor;
  if (c.hp.structure > c.maxHp.structure) c.hp.structure = c.maxHp.structure;

  const ammoRequired = {};
  let volleyFuel = 0;
  for (const module of weapons) {
    const combat = module.equipment.combat;
    volleyFuel += Math.max(1, Math.round(combat.fuelCost * calcFuelMult(zone)));
    ammoRequired[combat.weaponType] = (ammoRequired[combat.weaponType] || 0) + (combat.ammoCost || 1);
  }
  const enoughFuel = ResourceRegistry.get(gameState, "consumable:fuel") >= volleyFuel;
  const enoughAmmo = Object.entries(ammoRequired).every(([type, amount]) => ResourceRegistry.get(gameState, "ammo:" + type) >= amount);
  const canFire = weapons.length > 0 && enoughFuel && enoughAmmo;

  if (canFire) {
    ResourceRegistry.spend(gameState, "consumable:fuel", volleyFuel);
    for (const [type, amount] of Object.entries(ammoRequired)) ResourceRegistry.spend(gameState, "ammo:" + type, amount);
    const capSkill = gameState.skills.capacitorManagement;
    if (capSkill) { capSkill.xp += volleyFuel * 0.3; checkLevelUp("capacitorManagement"); }

    for (const module of weapons) {
      const equipment = module.equipment;
      const combat = equipment.combat;
      const weapon = WEAPON_CONFIG[combat.weaponType];
      if (!weapon) continue;
      const playerHit = calcPlayerHit(combat.weaponType, equipment);
      const dmgMult = calcPlayerDmgMult(combat.weaponType);
      let counterMult = 1.0;
      if (weapon.counterType === "shield" && enemy.hp.shield > 0) counterMult = 1.25;
      else if (weapon.counterType === "armor" && enemy.hp.shield <= 0 && enemy.hp.armor > 0) counterMult = 1.25;
      else if (weapon.counterType === "structure" && enemy.hp.shield <= 0 && enemy.hp.armor <= 0 && enemy.hp.structure > 0) counterMult = 1.25;
      const traitMultiplier = getCapitalWeaponTraitMultiplier(ship, combat.weaponType, c.hp, c.maxHp);
      const damage = calcCombatDamage(playerHit, enemy.dodge, combat.baseDamage * (module.multiplier || 1), counterMult * dmgMult * traitMultiplier);
      applyLayeredCombatDamage(enemy.hp, damage);
      for (const areaTarget of getCapitalAreaDamageTargets(c.enemies, enemy, combat.aoe)) {
        const areaDamage = Math.max(1, Math.round(damage * areaTarget.multiplier));
        applyLayeredCombatDamage(areaTarget.enemy.hp, areaDamage);
      }
      playAttackFX(true, combat.weaponType, damage);
      const weaponSkill = gameState.skills[weapon.skillKey];
      if (weaponSkill) { weaponSkill.xp += 2; checkLevelUp(weapon.skillKey); }
      const targetingSkill = gameState.skills.targeting;
      if (targetingSkill) { targetingSkill.xp += 1; checkLevelUp("targeting"); }
    }
    c.lastStatus = "";
  } else if (weapons.length === 0) {
    c.lastStatus = "未安装战斗武器，无法攻击";
  } else if (!enoughFuel) {
    c.lastStatus = "燃料不足，整轮武器未能开火";
  } else {
    c.lastStatus = "弹药不足，整轮武器未能开火";
  }

  // 玩家先手与AOE击毁的所有敌舰均立即结算，本轮不再反击。
  for (const defeated of c.enemies.filter(item => item && !item.rewarded && item.hp && item.hp.structure <= 0)) {
    resolveCombatEnemyDefeat(defeated, zone);
  }

  // --- 所有存活敌人依照编队顺序逐一行动 ---
  const playerDodge = calcPlayerDodge(ship);
  const capitalTrait = getCapitalCombatTrait(ship);
  const enemyVolley = { attackers:0, totalDamage:0, mitigatedDamage:0, armorRestored:0, traitName:capitalTrait ? capitalTrait.name : "", hits:[] };
  let shieldHitsUsed = 0;
  let armorDamageTaken = 0;
  for (const attacker of getLivingCombatEnemies(c)) {
    const rawEnemyDamage = calcCombatDamage(attacker.hit, playerDodge, attacker.baseDamage || 1, 1.0);
    const mitigation = applyCapitalShieldMitigation(ship, rawEnemyDamage, shieldHitsUsed, c.hp.shield);
    if (mitigation.shieldHitUsed) shieldHitsUsed++;
    const enemyDmg = Math.max(0, Math.round(mitigation.damage));
    const damageTaken = applyLayeredCombatDamage(c.hp, enemyDmg);
    armorDamageTaken += damageTaken.armor;
    enemyVolley.mitigatedDamage += Math.round(mitigation.mitigated);
    const actualDamage = damageTaken.shield + damageTaken.armor + damageTaken.structure;
    const attackOrder = enemyVolley.attackers;
    enemyVolley.attackers++;
    enemyVolley.totalDamage += actualDamage;
    enemyVolley.hits.push({ enemyId:attacker.id, damage:actualDamage });
    playEnemyAttackFX(c.enemies.indexOf(attacker), attackOrder, actualDamage);

    if (damageTaken.shield > 0) { const s = gameState.skills.shieldOperation; if (s) { s.xp += 1; checkLevelUp("shieldOperation"); } }
    if (damageTaken.armor > 0) { const s = gameState.skills.armorReinforcement; if (s) { s.xp += 1; checkLevelUp("armorReinforcement"); } }
    if (damageTaken.structure > 0) { const s = gameState.skills.hullEngineering; if (s) { s.xp += 1; checkLevelUp("hullEngineering"); } }
    if (damageTaken.shield + damageTaken.armor + damageTaken.structure > 0) {
      const s = gameState.skills.piloting; if (s) { s.xp += 1; checkLevelUp("piloting"); }
    }
    if (c.hp.structure <= 0) {
      beginCombatRecovery();
      return;
    }
  }
  c.lastEnemyVolley = enemyVolley;
  const reactiveArmorRepair = getCapitalReactiveArmorRepair(ship, armorDamageTaken, c.maxHp.armor);
  if (reactiveArmorRepair > 0 && c.hp.armor < c.maxHp.armor) {
    const restored = Math.min(reactiveArmorRepair, c.maxHp.armor - c.hp.armor);
    c.hp.armor += restored;
    enemyVolley.armorRestored = restored;
  }

  // --- 维修：只读取舰船实际安装的维修装备 ---
  for (const module of repairers) {
    const rep = module.equipment.combat;
    const repFuelCost = Math.max(1, Math.round((rep.fuelCost || 1) * calcFuelMult(zone)));
    if (ResourceRegistry.get(gameState, "consumable:fuel") < repFuelCost) continue;
    if (c.hp[rep.target] < c.maxHp[rep.target]) {
      const healAmount = Math.round(rep.amount * (module.multiplier || 1) * calcRepairMult(rep.target));
      c.hp[rep.target] = Math.min(c.maxHp[rep.target], c.hp[rep.target] + healAmount);
      ResourceRegistry.spend(gameState, "consumable:fuel", repFuelCost);
      // 防御经验
      const s = gameState.skills.defense; if (s) { s.xp += 1; checkLevelUp("defense"); }
    }
  }
  resolveCombatWaveVictory(zone);
  gameState._dirty = true;
}
