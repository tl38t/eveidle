
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

// ============================================================================
// 纯掉落配置读取（只读生产掉落配置，不发奖/不读写全局状态）
// 生产 roll* 系列与预览 getCombatDropPreview 共用，确保概率/材料/数量单一事实来源。
// 注意：encryptedDataChances 覆盖必须用显式 != null 判断，禁止用 || 覆盖合法的 0 概率。
// ============================================================================

// 战术材料掉落配置：层级由 zone.formationPool 映射（死亡空间复用 sourceZone 的 formationPool）。
//   普通怪 70% × 1；精英 100% × 2~3；Boss 100% × 6~10。
function getTacticalMaterialDropConfig(zone) {
  if (!zone) return null;
  const layer = zone.formationPool;
  const materialId = (typeof TACTICAL_MATERIAL_BY_LAYER !== "undefined") ? TACTICAL_MATERIAL_BY_LAYER[layer] : null;
  if (!materialId) return null;
  const meta = (typeof TACTICAL_MATERIALS !== "undefined") ? TACTICAL_MATERIALS.find(m => m.id === materialId) : null;
  return {
    materialId,
    materialName: meta ? meta.name : materialId,
    tier: meta ? meta.tier : null,
    securityLayer: layer,
    normalChance: 0.70, normalQty: 1,
    eliteChance: 1, eliteQtyMin: 2, eliteQtyMax: 3,
    bossChance: 1, bossQtyMin: 6, bossQtyMax: 10
  };
}

// 加密数据掉落配置：zone.encryptedDataDisabled 禁用；覆盖用显式 != null 判断，合法 0 概率不会被 base 覆盖。
function getEncryptedDataDropConfig(zone) {
  if (!zone || zone.encryptedDataDisabled) return null;
  const drop = FACTION_ENCRYPTED_DATA_DROPS[zone.faction];
  if (!drop) return null;
  const base = drop.chances;
  const override = zone.encryptedDataChances || null;
  const eliteChance = override && override.elite != null ? Number(override.elite) : base.elite;
  const bossChance = override && override.boss != null ? Number(override.boss) : base.boss;
  const material = zone.encryptedDataMaterial != null ? zone.encryptedDataMaterial : drop.material;
  return { material, qty: drop.qty, eliteChance, bossChance };
}

// 星带特殊掉落配置（仅 outer/deep 星带带 specialDrops）。
function getCombatZoneSpecialDropConfigs(zone) {
  if (!zone || !Array.isArray(zone.specialDrops)) return [];
  return zone.specialDrops.map(config => ({
    material: config.material || (config.resourceId || "").split(":").slice(1).join(":") || config.resourceId,
    resourceId: config.resourceId,
    qty: Math.max(1, Number(config.qty) || 1),
    eliteChance: Number(config.chances && config.chances.elite) || 0,
    bossChance: Number(config.chances && config.chances.boss) || 0
  }));
}

// 通行密钥掉落配置：按 zone 反查来源死亡空间，仅精英/Boss。
function getDeathspaceTicketDropConfig(zone) {
  if (!zone) return null;
  const site = getDeathspaceForSourceZone(zone.id);
  if (!site) return null;
  return {
    deathspaceId: site.id,
    deathspaceName: site.name,
    material: site.ticketMaterial,
    eliteChance: Number(site.ticketChances.elite) || 0,
    bossChance: Number(site.ticketChances.boss) || 0
  };
}

// 死亡空间首领战利品配置：每波 coreChance，最终波追加 protocolChance。
function getDeathspaceLeaderLootConfigs(site) {
  if (!site || !Array.isArray(site.waves)) return [];
  return site.waves.map((wave, index) => ({
    wave: index + 1,
    name: wave.name,
    isFinal: Boolean(wave.final),
    coreMaterial: site.coreMaterial,
    coreChance: Number(wave.coreChance) || 0,
    protocolMaterial: wave.final ? site.protocolMaterial : null,
    protocolChance: wave.final ? (Number(site.protocolChance) || 0) : 0
  }));
}

function rollFactionEncryptedDataDrop(factionId, enemyKind, randomValue, zone) {
  if (enemyKind !== "elite" && enemyKind !== "boss") return null;
  const cfg = getEncryptedDataDropConfig(zone);
  if (!cfg) return null;
  const chance = enemyKind === "elite" ? cfg.eliteChance : cfg.bossChance;
  if (!chance) return null;
  const roll = randomValue === undefined ? Math.random() : randomValue;
  if (roll >= chance) return null;
  ResourceRegistry.add(gameState, "special:" + cfg.material, cfg.qty);
  return { material: cfg.material, qty: cfg.qty };
}

function rollCombatZoneSpecialDrops(zone, enemyKind, randomValues) {
  if (enemyKind !== "elite" && enemyKind !== "boss") return [];
  const configs = getCombatZoneSpecialDropConfigs(zone);
  if (configs.length === 0) return [];
  const values = Array.isArray(randomValues) ? randomValues : [];
  const drops = [];
  for (let index = 0; index < configs.length; index++) {
    const cfg = configs[index];
    const chance = enemyKind === "elite" ? cfg.eliteChance : cfg.bossChance;
    const roll = values[index] !== undefined ? values[index] :
      typeof randomValues === "number" ? randomValues : Math.random();
    if (!cfg.resourceId || roll >= chance) continue;
    ResourceRegistry.add(gameState, cfg.resourceId, cfg.qty);
    drops.push({ material: cfg.material, resourceId: cfg.resourceId, qty: cfg.qty, rarity: enemyKind === "boss" ? "guaranteedBoss" : "rare" });
  }
  return drops;
}

function rollDeathspaceTicketDrop(zone, enemyKind, randomValue) {
  if (enemyKind !== "elite" && enemyKind !== "boss") return null;
  const cfg = getDeathspaceTicketDropConfig(zone);
  if (!cfg) return null;
  const chance = enemyKind === "elite" ? cfg.eliteChance : cfg.bossChance;
  if (!chance) return null;
  const roll = randomValue === undefined ? Math.random() : randomValue;
  if (roll >= chance) return null;
  ResourceRegistry.add(gameState, "special:" + cfg.material, 1);
  return { material: cfg.material, qty: 1, deathspaceId: cfg.deathspaceId };
}

function rollDeathspaceLeaderLoot(site, wave, coreRandomValue, protocolRandomValue) {
  const configs = getDeathspaceLeaderLootConfigs(site);
  const waveConfig = configs[Math.max(0, wave - 1)];
  if (!waveConfig) return [];
  const drops = [];
  const coreRoll = coreRandomValue === undefined ? Math.random() : coreRandomValue;
  if (coreRoll < waveConfig.coreChance) {
    ResourceRegistry.add(gameState, "special:" + site.coreMaterial, 1);
    drops.push({ material: site.coreMaterial, qty: 1, rarity: "rare" });
  }
  if (waveConfig.isFinal) {
    const protocolRoll = protocolRandomValue === undefined ? Math.random() : protocolRandomValue;
    if (protocolRoll < waveConfig.protocolChance) {
      ResourceRegistry.add(gameState, "special:" + site.protocolMaterial, 1);
      drops.push({ material: site.protocolMaterial, qty: 1, rarity: "veryRare" });
    }
  }
  return drops;
}

// 增强剂系统 Phase 2A（§7）：战术材料掉落，对所有 kind 开放（普通/精英/Boss）。
// 本函数仅做纯计算，不改动 gameState、不发送事件；发奖与事件由 resolveCombatEnemyDefeat 负责。
// 层级由 zone.formationPool 映射（死亡空间复用其 sourceZone 的 formationPool）。
//   普通怪：70% × 1；精英：100% × 2~3（期望 2.5）；Boss：100% × 6~10（期望 8）。
// rng 可注入（默认 Math.random）；审计以固定序列核验概率边界。
function rollTacticalMaterialDrop(zone, enemyKind, randomFn) {
  const cfg = getTacticalMaterialDropConfig(zone);
  if (!cfg) return null;
  const rng = typeof randomFn === "function" ? randomFn : Math.random;
  let qty = 0;
  if (enemyKind === "boss") {
    qty = 6 + Math.floor(rng() * 5);          // 6..10
  } else if (enemyKind === "elite") {
    qty = 2 + Math.floor(rng() * 2);          // 2..3
  } else {
    qty = rng() < 0.70 ? 1 : 0;               // 普通怪 70% × 1
  }
  if (qty <= 0) return null;
  const meta = (typeof TACTICAL_MATERIALS !== "undefined") ? TACTICAL_MATERIALS.find(m => m.id === cfg.materialId) : null;
  return {
    materialId: cfg.materialId,
    materialName: meta ? meta.name : cfg.materialId,
    tier: meta ? meta.tier : null,
    quantity: qty,
    securityLayer: cfg.securityLayer
  };
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
  // 增强剂系统 Phase 2A：战术材料掉落（星带与死亡空间同规则，对所有 kind 开放）。
  // 纯函数 rollTacticalMaterialDrop 仅计算；此处负责发奖、事件与展示。
  const tacticalDrop = rollTacticalMaterialDrop(zone, enemy.kind);
  let tacticalEvent = null;
  if (tacticalDrop) {
    ResourceRegistry.add(gameState, "special:" + tacticalDrop.materialId, tacticalDrop.quantity);
    tacticalEvent = {
      zoneId: zone.id,
      deathspaceId: deathspace ? deathspace.id : null,
      enemyId: enemy.id,
      enemyKind: enemy.kind,
      materialId: tacticalDrop.materialId,
      materialName: tacticalDrop.materialName,
      tier: tacticalDrop.tier,
      quantity: tacticalDrop.quantity,
      securityLayer: tacticalDrop.securityLayer
    };
    GameEvents.emit("combat:tacticalMaterialDropped", tacticalEvent);
    c.lastLoot += " · " + tacticalDrop.materialId + " ×" + tacticalDrop.quantity;
  }
  const fmtDrop = d => ((d && d.materialId !== undefined ? d.materialId : (d && d.material)) + " ×" + (d && d.quantity !== undefined ? d.quantity : (d && d.qty)));
  const specialDrops = [ticketDrop, ...zoneSpecialDrops, ...deathspaceDrops, tacticalDrop].filter(Boolean);
  if (specialDrops.length > 0) c.lastSpecialLoot = specialDrops.map(fmtDrop).join(" · ");
  c.totalKills++;
  if (enemy.kind === "elite") c.runEliteKills = (c.runEliteKills || 0) + 1;
  syncCurrentCombatTarget(c);
  GameEvents.emit("combat:enemyDefeated", { zoneId:deathspace ? deathspace.id : zone.id, faction:zone.faction, enemyId:enemy.id, enemyKind:enemy.kind, isk, xp:enemy.xpDrop || 10, dataDrop, zoneSpecialDrops, ticketDrop, deathspaceDrops, tacticalDrop: tacticalEvent });
  return { isk, dataDrop, zoneSpecialDrops, ticketDrop, deathspaceDrops, tacticalDrop: tacticalEvent };
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

// 维修完成后自动恢复战斗（Phase 3D 修正）：无论失败来源是普通星带还是死亡空间，
// 维修完成后都只返回 returnZoneId 普通星带、从第 1 波开始全新一轮肃清。
// 死亡空间永不续原副本、绝不调用 enterDeathspace、绝不检查或扣除通行密钥。
// 任何校验失败（非法 returnZoneId、等级/武器/维修中）一律安全停止，不抛错、不扣任何资源。
function tryResumeCombatAfterRepair() {
  const r = gameState.resumeAfterRepair;
  if (!r || r.type !== "combat") return false;
  gameState.resumeAfterRepair = null; // 一次性消费，避免重复触发
  const zone = COMBAT_ZONES.find(item => item.id === r.returnZoneId);
  if (!zone) return false; // 非法 returnZoneId：安全停止，不生成敌人、不扣资源
  const now = Date.now();
  const c = gameState.combat;
  // 强制回到普通星带语义：清除死亡空间残留，回到来源星带第 1 波。
  c.mode = "belt";
  c.viewMode = "belt";
  c.deathspaceId = "";
  c.zone = r.returnZoneId;
  c.wave = 1;
  c.runEliteKills = 0;
  c.totalKills = 0;
  const wave = buildCombatWave(zone, 1);
  // 经既有 combat/start Action 续跑：内部完整校验（维修中/等级/无武器）失败则不改状态、安全停止
  const res = dispatchGameAction(gameState, { type:"combat/start", enemies:wave.enemies, formationId:wave.formationId }, now);
  if (res && res.changed) {
    GameEvents.emit("combat:resumedAfterRepair", { zoneId:r.returnZoneId, defeatedMode:r.defeatedMode, deathspaceId:r.deathspaceId || null }, { offline:false });
    return true;
  }
  return false;
}

function combatTick() {
  const c = gameState.combat;
  const hadRepair = (Number(c.repairUntil) || 0) > 0;
  updateCombatRecovery();
  // 维修刚结束（repairUntil 被 finishRecovery 清零）：尝试自动恢复被打断的战斗 run
  if (hadRepair && (Number(c.repairUntil) || 0) === 0) {
    tryResumeCombatAfterRepair();
  }
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
    if (capSkill && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, "capacitorManagement", volleyFuel * 0.3); }
    else if (capSkill) { capSkill.xp += volleyFuel * 0.3; checkLevelUp("capacitorManagement"); }

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
      const boosterDmg = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState).weaponDamageMultiplier : null;
      const weaponBoosterMult = (boosterDmg && boosterDmg[combat.weaponType]) ? boosterDmg[combat.weaponType] : 1;
      const damage = calcCombatDamage(playerHit, enemy.dodge, combat.baseDamage * (module.multiplier || 1) * weaponBoosterMult, counterMult * dmgMult * traitMultiplier);
      applyLayeredCombatDamage(enemy.hp, damage);
      for (const areaTarget of getCapitalAreaDamageTargets(c.enemies, enemy, combat.aoe)) {
        const areaDamage = Math.max(1, Math.round(damage * areaTarget.multiplier));
        applyLayeredCombatDamage(areaTarget.enemy.hp, areaDamage);
      }
      playAttackFX(true, combat.weaponType, damage);
      const weaponSkill = gameState.skills[weapon.skillKey];
      if (weaponSkill && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, weapon.skillKey, 2); }
      else if (weaponSkill) { weaponSkill.xp += 2; checkLevelUp(weapon.skillKey); }
      const targetingSkill = gameState.skills.targeting;
      if (targetingSkill && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, "targeting", 1); }
      else if (targetingSkill) { targetingSkill.xp += 1; checkLevelUp("targeting"); }
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

    if (damageTaken.shield > 0) { const s = gameState.skills.shieldOperation; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, "shieldOperation", 1); } else if (s) { s.xp += 1; checkLevelUp("shieldOperation"); } }
    if (damageTaken.armor > 0) { const s = gameState.skills.armorReinforcement; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, "armorReinforcement", 1); } else if (s) { s.xp += 1; checkLevelUp("armorReinforcement"); } }
    if (damageTaken.structure > 0) { const s = gameState.skills.hullEngineering; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, "hullEngineering", 1); } else if (s) { s.xp += 1; checkLevelUp("hullEngineering"); } }
    if (damageTaken.shield + damageTaken.armor + damageTaken.structure > 0) {
      const s = gameState.skills.piloting; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, "piloting", 1); } else if (s) { s.xp += 1; checkLevelUp("piloting"); }
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
  const boosterRep = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState).repairMultiplier : null;
  for (const module of repairers) {
    const rep = module.equipment.combat;
    const repFuelCost = Math.max(1, Math.round((rep.fuelCost || 1) * calcFuelMult(zone)));
    if (ResourceRegistry.get(gameState, "consumable:fuel") < repFuelCost) continue;
    if (c.hp[rep.target] < c.maxHp[rep.target]) {
      const repMult = (boosterRep && boosterRep[rep.target]) ? boosterRep[rep.target] : 1;
      const healAmount = Math.round(rep.amount * (module.multiplier || 1) * calcRepairMult(rep.target) * repMult);
      c.hp[rep.target] = Math.min(c.maxHp[rep.target], c.hp[rep.target] + healAmount);
      ResourceRegistry.spend(gameState, "consumable:fuel", repFuelCost);
      // 防御经验
      const s = gameState.skills.defense; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(gameState, "defense", 1); } else if (s) { s.xp += 1; checkLevelUp("defense"); }
    }
  }
  resolveCombatWaveVictory(zone);
  gameState._dirty = true;
}
