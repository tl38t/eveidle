
/* ================================================================
   战斗系统 — 核心与旧调用兼容层
   DOM渲染位于 js/ui/combat-render.js
   ================================================================ */

// Batch R 返修：所有共享内核辅助函数显式接收 state；不传 state 时回退全局 gameState
// （仅兼容冻结 UI/旧调用方），但 advanceCombatRound 调用路径始终传入 state，不触碰全局。
function getActiveCombatShipInstance(state) {
  return getActiveCombatShipState(state || gameState).instance;
}

const COMBAT_RECOVERY_MS = 180000;

function getInstalledCombatModules(state) {
  return getInstalledCombatModulesFromState(state || gameState).map(module => ({ id:module.id, itemId:module.itemId, instance:module.instance, enhancementLevel:module.enhancementLevel, multiplier:module.multiplier, equipment:EQUIPMENT_DB[module.itemId], slot:module.slot }));
}

function getInstalledCombatWeapons(state) {
  return getInstalledCombatModules(state).filter(module => module.equipment.combat.kind === "weapon");
}

function getInstalledCombatRepairers(state) {
  return getInstalledCombatModules(state).filter(module => module.equipment.combat.kind === "repair");
}

function getCombatRecoveryRemaining(state, now) {
  const g = (state && state.combat) ? state : gameState;
  // 仅用于「未显式传入 now」的显示查询（如 verify/浏览器面板）；权威战斗路径（updateCombatRecovery）
  // 始终显式传入有限 now，不会触发此回退。不存在 loose Number()——非有限即回退真实时间用于显示。
  if (typeof now !== "number" || !Number.isFinite(now)) now = Date.now();
  return getCombatDisplayState(g, now).recovery.remaining;
}

// Batch R 返修：state 优先（在线真实路径由 combatTick 传入 gameState），无 state 回退全局。
function finishCombatRecovery(state, now) {
  const g = (state && state.combat) ? state : gameState;
  const t = (typeof now === "number" && Number.isFinite(now)) ? now : Date.now();
  return dispatchGameAction(g, { type:"combat/finishRecovery" }, t).changed;
}

function updateCombatRecovery(now, state) {
  // per-ship 维修唯一恢复入口：combat.repairs[instanceId] = untilTs。
  // 清除所有已过期的维修条目（某艘舰完成只清该艘），并仅在「当前 active 战斗舰
  // 刚从维修中变为完成」且存在待恢复战斗时，自动恢复出击并发出唯一的 combat:resumedAfterRepair。
  // 关键：游戏主循环（combatTick / gameTick）以无参方式调用本函数，必须在此兜底 now=Date.now()；
  // 否则 now===undefined → Number(undefined)=NaN → isShipUnderRepair 误判为"已到期" → 维修条目被立即清空、
  // 并立刻触发 tryResumeCombatAfterRepair，表现为"被击毁后马上复活重新进入战斗"。
  // Batch R 返修：state 优先（combatTick 在线真实路径传入 gameState），无 state 回退全局。
  const g = (state && state.combat) ? state : gameState;
  now = Number(now);
  if (!Number.isFinite(now)) now = Date.now();
  const combat = g.combat;
  // 维修完成检测必须与 beginRecovery 写入维修键的解析口径完全一致：beginRecovery 用
  // getActiveCombatShipState 解析「当前 active 战斗舰」(shipAssignments.combat → combat.activeShip → ships[0])
  // 并把维修条目写在该舰 instanceId 下、resumeAfterRepair.shipInstanceId 也记该舰。
  // 若此处仅用 combat.activeShip（可能因单舰兼顾挖矿/指派变更被置 null 或指向他舰），
  // 则 repairs 键对不上 → 维修完成检测不到 → 自动续战永不触发 → 悬挂清理又删掉 resumeAfterRepair → 永久卡死
  // （表现：战败进维修、修好后又一次战败就再无动作）。故统一用 getActiveCombatShipState 解析。
  const _activeShip = getActiveCombatShipState(g);
  const activeId = (_activeShip && _activeShip.instance && _activeShip.instance.instanceId) || combat.activeShip || null;
  // 仅用于判定「当前 active 战斗舰是否刚完成维修」以触发自动恢复：语义为"该舰存在维修条目"，
  // 与到期边界（now === until）一致——到期这一 tick 既满足 activeFinished 也满足 wasRepairingActive，
  // 从而正确触发 resumeAfterRepair。注意 equip/toggle/enterDeathspace 的拦截仍用 isShipUnderRepair 的严格 > 比较，不受影响。
  const wasRepairingActive = Boolean(combat.repairs && combat.repairs[activeId] && Number(combat.repairs[activeId]) > 0);
  let activeFinished = false;
  if (combat.repairs) {
    for (const id of Object.keys(combat.repairs)) {
      // 到期边界统一：until > now 仍维修中（跳过）；until <= now 视为维修完成（清理）。
      // 与公共判断函数 isShipUnderRepair(g,id,now) 语义一致（until > now 返回 true）。
      if (isShipUnderRepair(g, id, now)) continue;
      if (id === activeId) {
        const maxHp = getCombatMaxHpFromState(g);
        combat.hp = { ...maxHp };
        combat.maxHp = { ...maxHp };
        activeFinished = true;
      }
      delete combat.repairs[id];
      g._dirty = true;
    }
  }
  let resumed = false;
  if (activeFinished && wasRepairingActive && g.resumeAfterRepair && g.resumeAfterRepair.type === "combat") {
    resumed = Boolean(tryResumeCombatAfterRepair());
  }
  // 悬挂标记清理：仅当本 tick 未成功触发 auto-resume 时，清掉已无维修条目支撑的 resumeAfterRepair。
  // （已成功续战则跳过——tryResumeCombatAfterRepair 会重新写回队列感知的续战标记，不可被此处清掉。）
  const rrPending = g.resumeAfterRepair;
  if (!resumed && rrPending && rrPending.type === "combat") {
    const sid = rrPending.shipInstanceId;
    const stillRepairing = Boolean(sid && g.combat.repairs[sid] && Number(g.combat.repairs[sid]) > 0);
    if (!stillRepairing) g.resumeAfterRepair = null;
  }
  return getCombatRecoveryRemaining(g, now);
}

function onCombatEvent(listener) {
  return GameEvents.on("combat:event", event => listener(event.payload));
}

function emitCombatEvent(event) {
  GameEvents.emit("combat:event", event);
}

function beginCombatRecovery(state, context) {
  context = context || {};
  const emit = (typeof context.emit === "function") ? context.emit : (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {});
  const now = context.now;
  // Batch R 返修：非有限 now → 稳定失败，绝不回退真实时间（Date.now）。
  if (typeof now !== "number" || !Number.isFinite(now)) return false;
  const activeShip = getActiveCombatShipInstance(state);
  const instanceId = activeShip ? activeShip.instanceId : null;
  const result = dispatchGameAction(state, { type:"combat/beginRecovery" }, now);
  if (result.changed) {
    // Batch C-11：战败即本 run 终止，清空实际开火武器类型登记
    resetCombatRunWeaponTypes(state.combat);
    // Batch C-12：战败即本 run 终止，清空单场伤害累计
    state.combat.runDamageDealt = 0;
    state.combat.runDamageTaken = 0;
    const payload = { type:"ship-destroyed", shipId:instanceId, repairSeconds:180, timestamp: now };
    emit("ship:destroyed", payload, { timestamp: now, source:"combat" });
    emit("combat:event", payload, { timestamp: now, source:"combat" });
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

function getActiveShip(state) {
  // Batch R 返修：state 优先（完全 state-based，不触碰全局 gameState）；无 state 回退全局。
  const st = state || gameState;
  return getActiveCombatShipState(st).config;
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
function getSkillLvl(key, state) { const g = (state && state.skills) ? state : gameState; return (g.skills[key] && g.skills[key].lvl) || 1; }

function calcPlayerHit(weapon, equipment, state) {
  return getCombatWeaponHitFromState(state || gameState, weapon, equipment && equipment.combat);
}

function calcPlayerDmgMult(weapon, state) {
  return getCombatDamageMultiplierFromState(state || gameState, weapon);
}

function calcCombatMaxHp(ship, shipInstance, state) {
  // 兼容旧调用（verify/audit 仍传 ship+shipInstance）；state-based 计算以 state 为准，忽略前两个参数。
  return getCombatMaxHpFromState(state || gameState);
}

function calcPlayerDodge(ship, state) {
  return getCombatPlayerDodgeFromState(state || gameState);
}

function calcFuelMult(zone, state) {
  return getCombatFuelMultiplierFromState(state || gameState, zone);
}

// 计算当前已装武器完成「一轮齐射」所需燃料，复用与 combatTick 完全相同的公式
// （Math.max(1, round(fuelCost * fuelMult)) 逐武器累加）。禁止另写一套公式。
// 供 Action 层出击前燃料校验与 combatTick 开火结算共用，确保两者一致。
function computeVolleyFuel(state, zone) {
  const modules = getInstalledCombatModulesFromState(state);
  const weapons = modules.filter(m => m.combat && m.combat.kind === "weapon");
  let volleyFuel = 0;
  for (const module of weapons) {
    // 不耗燃料武器（fuelCost 为 0 或未定义）不计入一轮齐射燃料需求；
    // 与 combatTick 实际逐 tick 消耗（同用本函数）保持一致，避免 fuelCost:0 武器被误算成需 1 燃料。
    const fc = module.combat && module.combat.fuelCost;
    if (!(fc > 0)) continue;
    volleyFuel += Math.max(1, Math.round(fc * getCombatFuelMultiplierFromState(state, zone)));
  }
  return volleyFuel;
}

function calcRepairMult(target, state, structureRatio) {
  return getCombatRepairMultiplierFromState(state || gameState, target, undefined, structureRatio);
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

function syncCurrentCombatTarget(combat, state) {
  const c = combat || (state || gameState).combat;
  const ship = getActiveShip(state || gameState);
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

function createCombatEnemy(zone, kind, randomFn, combatState) {
  const faction = ENEMY_DATABASE[zone.faction];
  const enemyKey = getRandomCombatEnemyKey(zone, kind, randomFn);
  const tpl = faction && faction.types[enemyKey];
  if (!tpl) return null;
  // Batch R：确定性 enemyId —— 由 combat.runToken + 单调递增 enemyInstanceSeq 生成，
  // 不再使用 Date.now()+Math.random()。combatState 缺省回退到权威 gameState.combat。
  const combat = combatState || (typeof gameState !== "undefined" ? gameState.combat : null) || {};
  const token = (typeof combat.runToken === "string" && combat.runToken) ? combat.runToken : "rt_unseeded";
  const seq = (typeof combat.enemyInstanceSeq === "number" && combat.enemyInstanceSeq >= 0 && Number.isSafeInteger(combat.enemyInstanceSeq)) ? combat.enemyInstanceSeq : 0;
  combat.enemyInstanceSeq = seq + 1;
  const balance = zone.enemyBalance || {};
  const kindBalance = balance[kind] || {};
  const hpScale = (Number(balance.hp) || 1) * (Number(kindBalance.hp) || 1);
  const damageScale = (Number(balance.damage) || 1) * (Number(kindBalance.damage) || 1);
  const scaledHp = Object.fromEntries(Object.entries(tpl.hp).map(([layer, value]) => [layer, Math.max(1, Math.round(value * hpScale))]));
  return {
    id: token + "_e" + seq,
    type:enemyKey, kind:tpl.kind || kind, name:tpl.name, icon:tpl.icon,
    hp:{...scaledHp}, maxHp:{...scaledHp},
    level:tpl.level, hit:tpl.hit, dodge:tpl.dodge, baseDamage:Math.max(1, Math.round((tpl.baseDamage || 1) * damageScale)),
    iskDrop:tpl.iskDrop, xpDrop:tpl.xpDrop, image:tpl.image,
    defeated:false, rewarded:false
  };
}

// ============================================================================
// Batch R：JSON 安全确定性 RNG（在线/离线共用，禁止 monkeypatch 全局 Math.random）
//   combat.randomState = { seed:uint32, counterLo:uint32, counterHi:uint32 }
//   nextCombatRandom(combat) 推进 64 位计数器（counterLo 溢出向 counterHi 进位），返回 [0,1)。
//   所有编队/敌人/洗牌/伤害浮动/掉落均通过注入 rng 调用，保证可复现、同态同序列。
// ============================================================================
function nextCombatRandom(combat) {
  const rs = combat.randomState;
  if (!rs || !Number.isInteger(rs.seed) || !Number.isInteger(rs.counterLo) || !Number.isInteger(rs.counterHi) ||
      rs.seed < 0 || rs.seed > 0xFFFFFFFF || rs.counterLo < 0 || rs.counterLo > 0xFFFFFFFF || rs.counterHi < 0 || rs.counterHi > 0xFFFFFFFF) {
    return 0.5; // 防御：状态缺失/损坏时确定性占位（已迁移存档不应触发）
  }
  let lo = (rs.counterLo >>> 0) + 1;
  let hi = rs.counterHi >>> 0;
  if (lo > 0xFFFFFFFF) { lo = 0; hi = (hi + 1) >>> 0; }
  rs.counterLo = lo;
  rs.counterHi = hi;
  let x = ((rs.seed >>> 0) ^ lo ^ Math.imul(hi, 0x9E3779B9)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7F4A7C15) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return (x >>> 0) / 4294967296;
}

// runToken 由当前 randomState + runSequence 派生（不含 Date.now），保证同态确定、跨 run 唯一。
// 格式 rt_<seed>_<counterHi>_<counterLo>_<runSequence>，每段均有下划线分隔，且 runSequence 保证
// 即便种子/计数器零消耗（start→stop→start）也能产生不同 token。
function makeRunToken(combat) {
  const rs = combat.randomState || { seed:0, counterLo:0, counterHi:0 };
  const seq = (typeof combat.runSequence === "number" && Number.isSafeInteger(combat.runSequence) && combat.runSequence >= 0) ? combat.runSequence : 0;
  return "rt_" + (rs.seed >>> 0).toString(36) + "_" + (rs.counterHi >>> 0).toString(36) + "_" + (rs.counterLo >>> 0).toString(36) + "_" + seq.toString(36);
}

// 新 run：runSequence +1（保证 token 唯一）、刷新 runToken、重置敌人序号。
// 续入链（continuation）不调用，沿用既有 runToken / runSequence / 敌人序号连续性。
function resetCombatRunState(combat) {
  const prev = (typeof combat.runSequence === "number" && Number.isSafeInteger(combat.runSequence) && combat.runSequence >= 0) ? combat.runSequence : 0;
  combat.runSequence = prev + 1;
  combat.runToken = makeRunToken(combat);
  combat.enemyInstanceSeq = 0;
  // 战斗日志：新 run 初始化本场累计（在线 + 离线合并，直到用户停止战斗）。
  // 开局拍库存与技能快照，供打开日志时按差值惰性算出产物 / 经验净增，避免逐帧记录开销。
  const rl = (combat.runLog && typeof combat.runLog === "object") ? combat.runLog : (combat.runLog = {});
  const now0 = (typeof Date !== "undefined") ? Date.now() : 0;
  rl.startedAt = now0;
  rl.lastActivityAt = now0;
  rl.runToken = combat.runToken;
  rl.waves = 0; rl.zones = 0; rl.dsWaves = 0; rl.dsClears = 0;
  rl.kills = 0; rl.eliteKills = 0; rl.bossKills = 0; rl.defeats = 0;
  // v2：本场战斗收益累计器（仅统计战斗系统自身产生的收益，彻底弃用库存快照差）。
  rl.lootAccountingVersion = 2;
  rl.lootGained = {};
  rl.iskGained = 0;
  rl.lpGained = 0;
  // 战斗技能经验累计器：仅累计「战斗授予」的经验（经 addStationModifiedCombatXp），
  // 不含空间站授予的非战斗经验。打开日志时读取，见 combat-log.js 的钩子。
  rl.skillXp = {};
  rl.startSkills = {};
  if (typeof gameState !== "undefined" && gameState && gameState.skills) {
    for (const k of Object.keys(gameState.skills)) {
      const s = gameState.skills[k];
      rl.startSkills[k] = { xp: s ? (Number(s.xp) || 0) : 0, lvl: s ? (Number(s.lvl) || 1) : 1 };
    }
  }
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

function buildDeathspaceWave(site, wave, randomFn, combatState) {
  const zone = site && COMBAT_ZONES.find(item => item.id === site.sourceZoneId);
  const waveConfig = site && site.waves[Math.max(0, wave - 1)];
  if (!zone || !waveConfig) return { formationId:"", enemies:[] };
  const balance = site.combatBalance || {};
  const hpScale = (balance.hp || 1) * (waveConfig.final ? (balance.finalHp || 1) : 1);
  const damageScale = (balance.damage || 1) * (waveConfig.final ? (balance.finalDamage || 1) : 1);
  const enemies = [];
  for (let index = 0; index < (waveConfig.escortNormal || 0); index++) {
    const escort = createCombatEnemy(zone, "normal", randomFn, combatState);
    if (!escort) continue;
    escort.baseDamage = Math.max(1, Math.round(escort.baseDamage * damageScale));
    for (const layer of ["shield", "armor", "structure"]) {
      escort.maxHp[layer] = Math.max(1, Math.round(escort.maxHp[layer] * hpScale));
      escort.hp[layer] = escort.maxHp[layer];
    }
    enemies.push(escort);
  }
  const leader = createCombatEnemy(zone, "boss", randomFn, combatState);
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

function buildCombatWave(zone, wave, randomFn, combatState) {
  if (!zone) return { formationId:"", enemies:[] };
  const formation = getCombatFormation(zone, wave, randomFn);
  const enemies = [];
  for (let index = 0; index < (formation.normal || 0); index++) enemies.push(createCombatEnemy(zone, "normal", randomFn, combatState));
  for (let index = 0; index < (formation.elite || 0); index++) enemies.push(createCombatEnemy(zone, "elite", randomFn, combatState));
  for (let index = 0; index < (formation.boss || 0); index++) enemies.push(createCombatEnemy(zone, "boss", randomFn, combatState));
  return { formationId:formation.id, enemies:shuffleCombatEnemies(enemies.filter(Boolean), randomFn) };
}

function spawnCombatWave(randomFn, combatState, state) {
  const c = combatState || gameState.combat;
  const g = state || gameState;
  const zone = getCombatEncounterZone(c);
  if (!zone) return [];
  const site = c.mode === "deathspace" ? getDeathspaceById(c.deathspaceId) : null;
  const wave = site ? buildDeathspaceWave(site, c.wave, randomFn, c) : buildCombatWave(zone, c.wave, randomFn, c);
  c.enemies = wave.enemies;
  c.currentFormation = wave.formationId;
  c.lastEnemyVolley = null;
  syncCurrentCombatTarget(c, g);
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

function rollFactionEncryptedDataDrop(factionId, enemyKind, randomValue, zone, state) {
  state = state || gameState;
  if (enemyKind !== "elite" && enemyKind !== "boss") return null;
  const cfg = getEncryptedDataDropConfig(zone);
  if (!cfg) return null;
  const chance = enemyKind === "elite" ? cfg.eliteChance : cfg.bossChance;
  if (!chance) return null;
  const roll = randomValue === undefined ? Math.random() : randomValue;
  if (roll >= chance) return null;
  ResourceRegistry.add(state, "special:" + cfg.material, cfg.qty);
  return { material: cfg.material, qty: cfg.qty };
}

function rollCombatZoneSpecialDrops(zone, enemyKind, randomValues, state) {
  state = state || gameState;
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
    ResourceRegistry.add(state, cfg.resourceId, cfg.qty);
    drops.push({ material: cfg.material, resourceId: cfg.resourceId, qty: cfg.qty, rarity: enemyKind === "boss" ? "guaranteedBoss" : "rare" });
  }
  return drops;
}

// Tier2 加密数据拆分：装备专用料掉落（zone-bound，不进池、不等权；死亡空间不触发）。
function getGearDropConfigs(zone) {
  if (!zone || !Array.isArray(zone.gearDrops)) return [];
  return zone.gearDrops.map(config => ({
    material: config.material || (config.resourceId || "").split(":").slice(1).join(":") || config.resourceId,
    resourceId: config.resourceId,
    qty: Math.max(1, Number(config.qty) || 1),
    eliteChance: Number(config.chances && config.chances.elite) || 0,
    bossChance: Number(config.chances && config.chances.boss) || 0
  }));
}

function rollGearDrops(zone, enemyKind, randomValues, state) {
  state = state || gameState;
  if (enemyKind !== "elite" && enemyKind !== "boss") return [];
  const configs = getGearDropConfigs(zone);
  if (configs.length === 0) return [];
  const values = Array.isArray(randomValues) ? randomValues : [];
  const drops = [];
  for (let index = 0; index < configs.length; index++) {
    const cfg = configs[index];
    const chance = enemyKind === "elite" ? cfg.eliteChance : cfg.bossChance;
    const roll = values[index] !== undefined ? values[index] :
      typeof randomValues === "number" ? randomValues : Math.random();
    if (!cfg.resourceId || roll >= chance) continue;
    ResourceRegistry.add(state, cfg.resourceId, cfg.qty);
    drops.push({ material: cfg.material, resourceId: cfg.resourceId, qty: cfg.qty, rarity: enemyKind === "boss" ? "guaranteedBoss" : "rare" });
  }
  return drops;
}

// Tier3 空间站四核心：唯一产出、特殊物资、建站才生效（生效乘子在系数 B）。
function getStationCoreDropConfigs(zone) {
  if (!zone || !Array.isArray(zone.stationCoreDrops)) return [];
  return zone.stationCoreDrops.map(config => ({
    coreId: config.coreId,
    material: config.material || (config.resourceId || "").split(":").slice(1).join(":") || config.resourceId,
    resourceId: config.resourceId,
    qty: Math.max(1, Number(config.qty) || 1),
    eliteChance: Number(config.chances && config.chances.elite) || 0,
    bossChance: Number(config.chances && config.chances.boss) || 0
  }));
}

function rollStationCoreDrop(zone, enemyKind, randomValue, state) {
  state = state || gameState;
  if (enemyKind !== "elite" && enemyKind !== "boss") return null;
  const obtained = state.stationCoresObtained || {};
  const cfg = getStationCoreDropConfigs(zone).find(c => !obtained[c.coreId]);
  if (!cfg) return null; // 该带核心已获得 → 不再掉落
  const chance = enemyKind === "elite" ? cfg.eliteChance : cfg.bossChance;
  if (!chance) return null;
  const roll = randomValue === undefined ? Math.random() : randomValue;
  if (roll >= chance) return null;
  ResourceRegistry.add(state, cfg.resourceId, cfg.qty);
  state.stationCoresObtained[cfg.coreId] = true;
  return { coreId: cfg.coreId, material: cfg.material, resourceId: cfg.resourceId, qty: cfg.qty };
}

function rollDeathspaceTicketDrop(zone, enemyKind, randomValue, state) {
  state = state || gameState;
  if (enemyKind !== "elite" && enemyKind !== "boss") return null;
  const cfg = getDeathspaceTicketDropConfig(zone);
  if (!cfg) return null;
  const chance = enemyKind === "elite" ? cfg.eliteChance : cfg.bossChance;
  if (!chance) return null;
  const roll = randomValue === undefined ? Math.random() : randomValue;
  if (roll >= chance) return null;
  ResourceRegistry.add(state, "special:" + cfg.material, 1);
  return { material: cfg.material, qty: 1, deathspaceId: cfg.deathspaceId };
}

function rollDeathspaceLeaderLoot(site, wave, coreRandomValue, protocolRandomValue, state) {
  state = state || gameState;
  const configs = getDeathspaceLeaderLootConfigs(site);
  const waveConfig = configs[Math.max(0, wave - 1)];
  if (!waveConfig) return [];
  const drops = [];
  const coreRoll = coreRandomValue === undefined ? Math.random() : coreRandomValue;
  if (coreRoll < waveConfig.coreChance) {
    ResourceRegistry.add(state, "special:" + site.coreMaterial, 1);
    drops.push({ material: site.coreMaterial, qty: 1, rarity: "rare" });
  }
  if (waveConfig.isFinal) {
    const protocolRoll = protocolRandomValue === undefined ? Math.random() : protocolRandomValue;
    if (protocolRoll < waveConfig.protocolChance) {
      ResourceRegistry.add(state, "special:" + site.protocolMaterial, 1);
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

function resolveCombatEnemyDefeat(enemy, zone, rng, emit, state) {
  state = state || gameState;
  if (!enemy || enemy.rewarded) return null;
  const c = state.combat;
  const doEmit = (typeof emit === "function") ? emit : (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {});
  const roll = (typeof rng === "function") ? rng : Math.random;
  // v2：标准化战利品字典（仅记录战斗系统自身发放的正向奖励；ISK 也在此汇总）。
  const lootGained = {};
  const addLoot = (resourceId, quantity) => {
    const q = Number(quantity) || 0;
    if (resourceId && q > 0) lootGained[resourceId] = (lootGained[resourceId] || 0) + q;
  };
  const isk = Math.round(enemy.iskDrop * zone.iskMulti);
  ResourceRegistry.add(state, "currency:isk", isk);
  addLoot("currency:isk", isk);
  enemy.defeated = true;
  enemy.rewarded = true;
  c.lastLoot = getCombatCurrencyDisplayName("isk", "星币") + " " + isk.toLocaleString();
  const deathspace = c.mode === "deathspace" ? getDeathspaceById(c.deathspaceId) : null;
  const dataDrop = deathspace ? null : rollFactionEncryptedDataDrop(zone.faction, enemy.kind, roll(), zone, state);
  if (dataDrop) { c.lastLoot += " · " + dataDrop.material + " ×" + dataDrop.qty; addLoot("special:" + dataDrop.material, dataDrop.qty); }
  const zoneSpecialConfigs = deathspace ? [] : getCombatZoneSpecialDropConfigs(zone);
  const specialValues = zoneSpecialConfigs.map(() => roll());
  const zoneSpecialDrops = deathspace ? [] : rollCombatZoneSpecialDrops(zone, enemy.kind, specialValues, state);
  for (const drop of zoneSpecialDrops) { c.lastLoot += " · " + drop.material + " ×" + drop.qty; addLoot(drop.resourceId, drop.qty); }
  const gearConfigs = deathspace ? [] : getGearDropConfigs(zone);
  const gearValues = gearConfigs.map(() => roll());
  const gearDrops = deathspace ? [] : rollGearDrops(zone, enemy.kind, gearValues, state);
  for (const drop of gearDrops) { c.lastLoot += " · " + drop.material + " ×" + drop.qty; addLoot(drop.resourceId, drop.qty); }
  const coreDrop = deathspace ? null : rollStationCoreDrop(zone, enemy.kind, roll(), state);
  if (coreDrop) { c.lastLoot += " · " + coreDrop.material + " ×" + coreDrop.qty; addLoot(coreDrop.resourceId, coreDrop.qty); }
  const ticketDrop = deathspace ? null : rollDeathspaceTicketDrop(zone, enemy.kind, roll(), state);
  if (ticketDrop) { c.lastLoot += " · " + ticketDrop.material + " ×" + ticketDrop.qty; addLoot("special:" + ticketDrop.material, ticketDrop.qty); }
  // 货柜系统：敌方船被击坠低概率掉货柜（死亡空间不掉落）；内容待玩家开箱揭晓。
  // 注意：货柜本身计入 lootGained，但箱内奖励发生在「开箱」动作里（cargo.js），不在此记录，
  // 故战斗中开箱收益不会污染战斗日志。
  const cargoDrop = deathspace ? null : (typeof rollCargoDrop === "function" ? rollCargoDrop(enemy, zone, roll, state) : null);
  if (cargoDrop) { c.lastLoot += " · 货柜" + cargoDrop.size + " ×1"; addLoot(cargoDrop.itemId || ("cargo:" + cargoDrop.size), 1); }
  // 打捞臂燃料消耗：装备即生效，每击毁一艘扣基准燃料；开主动×3。负消耗不进 lootGained。
  const salvageFuelPK = (typeof getSalvageFuelPerKill === "function") ? getSalvageFuelPerKill(state) : 0;
  if (salvageFuelPK > 0) {
    const salvageFuelAmt = state.combat.salvageArmActive ? salvageFuelPK * 3 : salvageFuelPK;
    ResourceRegistry.spend(state, "consumable:fuel", salvageFuelAmt);
  }
  // 同位素标记打捞臂：主动打捞（开关开启 + 已装备打捞臂 + 有同位素才触发；死亡空间不触发，与货柜一致）
  if (!deathspace && state.combat.salvageArmActive && typeof hasSalvageArmEquipped === "function" && hasSalvageArmEquipped(state)) {
    const isoCost = getSalvageComponentQty(enemy.kind); // 1/2/3，与组件数量一致
    const isoHave = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(state, "planetary:同位素") : 0;
    if (isoHave >= isoCost) {
      ResourceRegistry.spend(state, "planetary:同位素", isoCost);
      c.lastSalvage = c.lastSalvage || { attempts:0, hits:0, isoSpent:0, components:[] };
      c.lastSalvage.attempts++;
      c.lastSalvage.isoSpent += isoCost;
      const baseChance = (typeof CARGO_DROP_CHANCE !== "undefined" && CARGO_DROP_CHANCE[enemy.kind]) || 0;
      const chance = Math.min(baseChance * (1 + getSalvageEfficiency(state)), 0.5);
      if (roll() < chance) {
        c.lastSalvage.hits++;
        const tier = getSalvageComponentTier(enemy.level);
        const ids = (typeof SALVAGE_COMPONENT_IDS !== "undefined" && SALVAGE_COMPONENT_IDS[tier]) || SALVAGE_COMPONENT_IDS[""];
        // 选组件用独立随机源，避免与战斗掉落 rng 同相位锁定导致恒为某一类（如动力核心）
        const compId = ids[Math.floor(Math.random() * ids.length)];
        const qty = isoCost;
        ResourceRegistry.add(state, "component:" + compId, qty);
        addLoot("component:" + compId, qty); // 主动打捞组件计入战斗日志
        c.lastSalvage.components.push(compId + "×" + qty);
        c.lastLoot += " · 残骸组件 " + compId + " ×" + qty;
      }
    }
  }
  const coreRoll = roll();
  const protoRoll = roll();
  const deathspaceDrops = deathspace && enemy.deathspaceLeader ? rollDeathspaceLeaderLoot(deathspace, enemy.deathspaceWave, coreRoll, protoRoll, state) : [];
  for (const drop of deathspaceDrops) { c.lastLoot += " · " + drop.material + " ×" + drop.qty; addLoot("special:" + drop.material, drop.qty); }
  // 增强剂系统 Phase 2A：战术材料掉落（星带与死亡空间同规则，对所有 kind 开放）。
  // 纯函数 rollTacticalMaterialDrop 仅计算；此处负责发奖、事件与展示。
  const tacticalDrop = rollTacticalMaterialDrop(zone, enemy.kind, roll);
  let tacticalEvent = null;
  if (tacticalDrop) {
    ResourceRegistry.add(state, "special:" + tacticalDrop.materialId, tacticalDrop.quantity);
    addLoot("special:" + tacticalDrop.materialId, tacticalDrop.quantity);
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
    doEmit("combat:tacticalMaterialDropped", tacticalEvent);
    c.lastLoot += " · " + tacticalDrop.materialId + " ×" + tacticalDrop.quantity;
  }
  const fmtDrop = d => ((d && d.materialId !== undefined ? d.materialId : (d && d.material)) + " ×" + (d && d.quantity !== undefined ? d.quantity : (d && d.qty)));
  const specialDrops = [ticketDrop, ...zoneSpecialDrops, ...gearDrops, coreDrop, ...deathspaceDrops, tacticalDrop, cargoDrop].filter(Boolean);
  if (specialDrops.length > 0) c.lastSpecialLoot = specialDrops.map(fmtDrop).join(" · ");
  c.totalKills++;
  if (enemy.kind === "elite") c.runEliteKills = (c.runEliteKills || 0) + 1;
  syncCurrentCombatTarget(c, state);
  doEmit("combat:enemyDefeated", { zoneId:deathspace ? deathspace.id : zone.id, faction:zone.faction, enemyId:enemy.id, enemyKind:enemy.kind, isk, xp:enemy.xpDrop || 10, lootGained, dataDrop, zoneSpecialDrops, gearDrops, coreDrop, ticketDrop, deathspaceDrops, tacticalDrop: tacticalEvent, cargoDrop });
  return { isk, lootGained, dataDrop, zoneSpecialDrops, gearDrops, coreDrop, ticketDrop, deathspaceDrops, tacticalDrop: tacticalEvent, cargoDrop };
}

// 定点返修：战斗内货币显示统一入口（纯读，不写 gameState）。
// DisplayNames 不可用时回退 fallback，避免战斗/死亡空间掉落文案硬编码 LP/ISK。
function getCombatCurrencyDisplayName(currencyId, fallback) {
  if (typeof DisplayNames !== "undefined" && DisplayNames && typeof DisplayNames.getCurrencyName === "function") {
    const got = DisplayNames.getCurrencyName(currencyId);
    if (got && got !== currencyId) return got;
  }
  return fallback;
}

function resolveDeathspaceWaveVictory(site, zone, rng, emit, state) {
  state = state || gameState;
  const c = state.combat;
  const doEmit = (typeof emit === "function") ? emit : (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {});
  const theRng = (typeof rng === "function") ? rng : Math.random;
  const waveLp = site.waveLp || 0;
  ResourceRegistry.add(state, "currency:lp", waveLp);
  c.lastLoot = (c.lastLoot ? c.lastLoot + " · " : "") + getCombatCurrencyDisplayName("lp", "功勋") + " +" + waveLp;
  doEmit("combat:deathspaceWaveCleared", { deathspaceId:site.id, zoneId:zone.id, wave:c.wave, lp:waveLp });
  if (c.wave >= site.maxWave) {
    const clearLp = site.clearLpBonus || 0;
    ResourceRegistry.add(state, "currency:lp", clearLp);
    if (!c.deathspaceClears || typeof c.deathspaceClears !== "object") c.deathspaceClears = {};
    c.deathspaceClears[site.id] = (c.deathspaceClears[site.id] || 0) + 1;
    c.lastLoot += " · " + getCombatCurrencyDisplayName("lp", "功勋") + " +" + clearLp;
    c.lastStatus = "死亡空间全通 · " + site.name;
    // Batch C-12（返修）：先 emit deathspaceCleared，再清零 runDamage
    // 注意：payload.lp 保留为「每波×波数 + 全通」合计，仅供兼容旧逻辑读取；
    // 新增独立 clearLp 字段供战斗日志只累计全通额外 LP，避免与每波 LP 重复计算。
    doEmit("combat:deathspaceCleared", { deathspaceId:site.id, name:site.name, lp:waveLp * site.maxWave + clearLp, clearLp: clearLp, clearCount:c.deathspaceClears[site.id] });
    c.runDamageDealt = 0;
    c.runDamageTaken = 0;
    // 队列感知：入场清场完成计 1 次；达标则终结队列项，否则直接重入下一入场。
    const entryDone = (c.queueItemId && c.queueEntriesTarget > 0);
    if (entryDone) c.queueEntriesDone = (c.queueEntriesDone || 0) + 1;
    c.active = false;
    state.currentAction.active = false;
    c.enemies = [];
    c.currentEnemy = null;
    c.wave = 1;
    c.currentFormation = "";
    c.lastEnemyVolley = null;
    const maxHp = getCombatMaxHpFromState(state, { zoneId:zone.id });
    c.hp = { ...maxHp };
    c.maxHp = { ...maxHp };
    if (entryDone && c.queueEntriesDone >= c.queueEntriesTarget) {
      // 入场次数达标：终结战斗队列项并推进队列
      if (typeof finalizeCombatQueueItem === "function") finalizeCombatQueueItem(state, Date.now());
      return true;
    }
    if (entryDone) {
      // 未达标：直接重入同一 site 的下一入场（消耗密钥），并刷新续战标记
      const nextWave = buildDeathspaceWave(site, 1, function () { return nextCombatRandom(c); }, c);
      const res = dispatchGameAction(state, { type:"combat/enterDeathspace", deathspaceId:site.id, enemies:nextWave.enemies, formationId:nextWave.formationId }, Date.now());
      if (res && res.changed) {
        if (typeof setCombatQueueResume === "function") setCombatQueueResume(state);
        c.lastStatus = "死亡空间连刷 · 第 " + (c.queueEntriesDone + 1) + " 次入场";
      } else {
        // 重入失败（密钥/等级/维修中）：安全停止并终结队列项
        if (typeof finalizeCombatQueueItem === "function") finalizeCombatQueueItem(state, Date.now());
      }
      return true;
    }
    if (c.deathspaceChainRemaining > 0) c.deathspaceChainPending = true; // 旧连刷链（非队列）路径
    return true;
  }
  c.lastStatus = "房间肃清 · " + getCombatCurrencyDisplayName("lp", "功勋") + " +" + waveLp;
  c.wave++;
  spawnCombatWave(theRng, state.combat, state);
  return true;
}

// ============================================================================
// Batch C-11：本次星带 run 内「实际开火过」的武器类型登记（runWeaponTypes）
//   - 合法类型只有 laser / cannon / missile（与 WEAPON_CONFIG 键一致）；
//   - 只在真实攻击结算（canFire 且武器配置存在）时去重登记，安装未开火不登记；
//   - 重置点：星带肃清发事件后 / 战败进入维修 / 维修恢复新 run / 切换星带；
//   - 旧存档/坏值清洗：非数组重建为 []，数组内剔除非法类型并去重；
//   - runWeaponTypesZone 仅用于切区检测（zone 变化即视为新 run）。
// ============================================================================
const COMBAT_RUN_WEAPON_TYPES = Object.freeze(["laser", "cannon", "missile"]);

function normalizeCombatRunWeaponTypes(c, zoneId) {
  if (!Array.isArray(c.runWeaponTypes)) {
    c.runWeaponTypes = [];
  } else {
    const cleaned = [];
    for (const t of c.runWeaponTypes) {
      if (COMBAT_RUN_WEAPON_TYPES.indexOf(t) !== -1 && cleaned.indexOf(t) === -1) cleaned.push(t);
    }
    if (cleaned.length !== c.runWeaponTypes.length) c.runWeaponTypes = cleaned;
  }
  if (zoneId !== undefined && c.runWeaponTypesZone !== zoneId) {
    c.runWeaponTypesZone = zoneId;
    c.runWeaponTypes = [];
  }
}

function resetCombatRunWeaponTypes(c) {
  c.runWeaponTypes = [];
}

// Batch C-12（返修）：单一清洗原语——runDamageDealt/runDamageTaken 仅接受 typeof number、
// 有限非负；合法小数保留；字符串数字、NaN、Infinity、负数、null、对象、数组、布尔归零。
function normalizeCombatRunDamage(c) {
  const normalize = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0) ? v : 0;
  c.runDamageDealt = normalize(c.runDamageDealt);
  c.runDamageTaken = normalize(c.runDamageTaken);
}

function resolveCombatWaveVictory(zone, rng, emit, state) {
  state = state || gameState;
  const c = state.combat;
  const doEmit = (typeof emit === "function") ? emit : (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {});
  const theRng = (typeof rng === "function") ? rng : Math.random;
  if (getLivingCombatEnemies(c).length > 0) return false;
  // 普通星带并入队列：每清一波累计 queueWavesDone（跨维修累计），达标即终结队列项并推进。
  if (c.queueItemId && c.queueWavesTarget > 0) {
    c.queueWavesDone = (c.queueWavesDone || 0) + 1;
    if (c.queueWavesDone >= c.queueWavesTarget) {
      // 补发收尾波事件：原本队列终结前直接 return，会吞掉最后一波的 combat:waveCleared，
      // 导致依赖"第4波"的监听（如 C6 教程标记）永远收不到。finalize 前先发一次。
      doEmit("combat:waveCleared", { zoneId: zone.id, wave: c.wave });
      if (typeof finalizeCombatQueueItem === "function") finalizeCombatQueueItem(state, Date.now());
      return false; // 不走后续 spawn，战斗已结束
    }
  }
  if (c.mode === "deathspace") {
    const site = getDeathspaceById(c.deathspaceId);
    return site ? resolveDeathspaceWaveVictory(site, zone, theRng, doEmit, state) : false;
  }
  const maxWave = zone.maxWave || 20;
  if (c.wave >= maxWave) {
    const lp = zone.clearLp || 0;
    ResourceRegistry.add(state, "currency:lp", lp);
    if (!c.zoneClears || typeof c.zoneClears !== "object") c.zoneClears = {};
    c.zoneClears[zone.id] = (c.zoneClears[zone.id] || 0) + 1;
    c.lastLoot = (c.lastLoot ? c.lastLoot + " · " : "") + getCombatCurrencyDisplayName("lp", "功勋") + " +" + lp;
    c.lastStatus = "肃清完成 · " + zone.name;
    // Batch C-11：payload 附带通关波次与本 run 实际开火武器类型（快照副本，防外部引用篡改）
    // Batch C-12：追加 damageTaken（全程累计实际承伤，emit 后归零）
    normalizeCombatRunWeaponTypes(c, zone.id);
    normalizeCombatRunDamage(c);
    const clearedDamageTaken = c.runDamageTaken;
    doEmit("combat:zoneCleared", { zoneId:zone.id, name:zone.name, lp, clearCount:c.zoneClears[zone.id], wave:c.wave, weaponTypes:c.runWeaponTypes.slice(), damageTaken:clearedDamageTaken });
    c.wave = 1;
    c.runEliteKills = 0;
    c.runDamageDealt = 0;
    c.runDamageTaken = 0;
    resetCombatRunWeaponTypes(c);
  } else {
    doEmit("combat:waveCleared", { zoneId:zone.id, wave:c.wave });
    c.wave++;
    c.lastStatus = "";
  }
  spawnCombatWave(theRng, state.combat, state);
  return true;
}

// 维修完成后自动恢复战斗（Phase 3D 修正 + 战斗并入队列）：
//  - 队列驱动战斗：恢复队列进度字段，死亡空间队列项修好重入同一 site（消耗密钥），
//    普通星带队列项回到 returnZoneId 第 1 波继续累计清波；均达标则终结队列项。
//  - 非队列战斗（resumeAfterRepair 无 queueItemId）：维持原行为——死亡空间永不续跑、
//    只返回普通星带。
// 任何校验失败（非法 returnZoneId、等级/武器/维修中/密钥不足）一律安全停止，不抛错、不扣任何资源。
function tryResumeCombatAfterRepair() {
  const r = gameState.resumeAfterRepair;
  if (!r || r.type !== "combat") return false;
  gameState.resumeAfterRepair = null; // 一次性消费，避免重复触发
  const now = Date.now();
  const c = gameState.combat;
  // 队列感知：恢复队列进度字段（跨维修保留）。
  // 离线累计保护：c.queueWavesDone/EntriesDone 是权威的跨维修/跨离线累计值；
  // r.* 只是上次续战写入的快照，可能被离线模拟推进超越，取较大者避免回滚进度。
  if (r.queueItemId) {
    c.queueItemId = r.queueItemId;
    c.queueWavesTarget = r.queueWavesTarget || 0;
    c.queueWavesDone = Math.max(c.queueWavesDone || 0, r.queueWavesDone || 0);
    c.queueEntriesTarget = r.queueEntriesTarget || 0;
    c.queueEntriesDone = Math.max(c.queueEntriesDone || 0, r.queueEntriesDone || 0);
  }
  // 死亡空间队列项：修好重入同一 site（消耗密钥）；入场次数达标则终结队列项。
  if (r.deathspaceId && r.queueItemId && c.queueEntriesTarget > 0) {
    if (c.queueEntriesDone >= c.queueEntriesTarget) {
      if (typeof finalizeCombatQueueItem === "function") finalizeCombatQueueItem(gameState, now);
      return true;
    }
    const site = getDeathspaceById(r.deathspaceId);
    if (site) {
      const wave = buildDeathspaceWave(site, 1, function () { return nextCombatRandom(c); }, c);
      const res = dispatchGameAction(gameState, { type:"combat/enterDeathspace", deathspaceId:site.id, enemies:wave.enemies, formationId:wave.formationId }, now);
      if (res && res.changed) {
        if (typeof setCombatQueueResume === "function") setCombatQueueResume(gameState);
        GameEvents.emit("combat:resumedAfterRepair", { zoneId:site.sourceZoneId, defeatedMode:"deathspace", deathspaceId:site.id }, { offline:false });
        return true;
      }
    }
    return false;
  }
  // 普通星带（含队列）：回到 returnZoneId 第 1 波
  const zone = COMBAT_ZONES.find(item => item.id === r.returnZoneId);
  if (!zone) return false; // 非法 returnZoneId：安全停止，不生成敌人、不扣资源
  // 强制回到普通星带语义：清除死亡空间残留，回到来源星带第 1 波。
  c.mode = "belt";
  c.viewMode = "belt";
  c.deathspaceId = "";
  c.zone = r.returnZoneId;
  c.wave = 1;
  c.runEliteKills = 0;
  c.totalKills = 0;
  // Batch C-11：维修恢复即全新 run，清空武器类型登记并同步切区检测键
  resetCombatRunWeaponTypes(c);
  // Batch C-12：维修恢复即全新 run，清空单场伤害累计
  c.runDamageDealt = 0;
  c.runDamageTaken = 0;
  c.runWeaponTypesZone = r.returnZoneId;
  const wave = buildCombatWave(zone, 1);
  // 经既有 combat/start Action 续跑：内部完整校验（维修中/等级/无武器）失败则不改状态、安全停止
  const res = dispatchGameAction(gameState, { type:"combat/start", enemies:wave.enemies, formationId:wave.formationId }, now);
  if (res && res.changed) {
    if (typeof setCombatQueueResume === "function") setCombatQueueResume(gameState);
    GameEvents.emit("combat:resumedAfterRepair", { zoneId:r.returnZoneId, defeatedMode:r.defeatedMode, deathspaceId:r.deathspaceId || null }, { offline:false });
    return true;
  }
  return false;
}

// ============================================================================
// Batch R：共享战斗回合内核（在线/离线共用）
//   advanceCombatRound(state, context) —— 一次调用 = 一个战斗秒/回合。
//   context = { now, offline, emit, rng, playEffects }。emit 可注入；rng 默认推进
//   combat.randomState（JSON 安全确定性）；playEffects=false 时不触发任何 FX/DOM/toast。
//   复用原始真实逻辑（编队/敌人/武器/弹药燃料原子消耗/AOE/反击/三层 HP/维修/技能 XP/
//   掉落/清波/战败维修/死亡空间连刷），不另写公式、不做平均化。
//   返回 { ok, advanced, active, pending, recovering, reason }。
// ============================================================================
function advanceCombatRound(state, context) {
  context = context || {};
  const emit = (typeof context.emit === "function") ? context.emit : (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {});
  const playEffects = context.playEffects !== false; // 默认播放特效
  const rng = (typeof context.rng === "function") ? context.rng : function () { return nextCombatRandom(state.combat); };
  const c = state.combat;
  // Batch R 返修：虚拟时间权威化——context.now 非有限 number 时返回稳定失败，绝不回退真实时间（Date.now）。
  const now = context.now;
  if (typeof now !== "number" || !Number.isFinite(now)) {
    return { ok:false, advanced:false, active:Boolean(c.active), pending:Boolean(c.deathspaceChainPending), recovering:false, reason:"invalid-now" };
  }
  if (!c.active) return { ok:true, advanced:false, active:false, pending:Boolean(c.deathspaceChainPending), recovering:false, reason:"inactive" };
  const zone = getCombatEncounterZone(c);
  if (!zone) return { ok:true, advanced:false, active:false, pending:Boolean(c.deathspaceChainPending), recovering:false, reason:"no-zone" };
  const faction = ENEMY_DATABASE[zone.faction];
  if (!faction) return { ok:true, advanced:false, active:false, pending:Boolean(c.deathspaceChainPending), recovering:false, reason:"no-faction" };
  const ship = getActiveShip(state);
  const shipInstance = getActiveCombatShipInstance(state);
  // 防御：无拥有战斗舰（理论上 active 时必有舰，此处仅兜底，避免逻辑层凭空造舰导致崩溃）
  if (!ship || !shipInstance) return { ok:true, advanced:false, active:false, pending:Boolean(c.deathspaceChainPending), recovering:false, reason:"no-ship" };
  const weapons = getInstalledCombatWeapons(state);
  const repairers = getInstalledCombatRepairers(state);
  let enemy = syncCurrentCombatTarget(c, state);
  if (!enemy) {
    resolveCombatWaveVictory(zone, rng, emit, state);
    enemy = syncCurrentCombatTarget(c, state);
    if (!enemy) return { ok:true, advanced:false, active:Boolean(c.active), pending:Boolean(c.deathspaceChainPending), recovering:false, reason:"wave-cleared" };
  }

  // 动态刷新 maxHp（技能升级后自动增长）
  const dynMaxHp = calcCombatMaxHp(undefined, undefined, state);
  c.maxHp = dynMaxHp;
  if (c.hp.shield  > c.maxHp.shield)  c.hp.shield  = c.maxHp.shield;
  if (c.hp.armor   > c.maxHp.armor)   c.hp.armor   = c.maxHp.armor;
  if (c.hp.structure > c.maxHp.structure) c.hp.structure = c.maxHp.structure;

  // 弹药耗尽撤退：所有已装载弹药都无法供给任何需弹武器 → 结束战斗（撤退，保留已得战利品）
  const needsAmmoWeapons = weapons.filter(m => (m.equipment.combat.ammoCost || 1) > 0);
  if (needsAmmoWeapons.length > 0 && !needsAmmoWeapons.some(m => hasSelectedAmmo(state, m.equipment.combat.weaponType))) {
    c.active = false; state.currentAction.active = false;
    c.enemies = []; c.currentEnemy = null;
    c.lastStatus = "弹药耗尽，撤退";
    c.runDamageDealt = 0; c.runDamageTaken = 0;
    return { ok:true, advanced:false, active:false, pending:Boolean(c.deathspaceChainPending), recovering:false, reason:"ammo-depleted" };
  }

  const volleyFuel = computeVolleyFuel(state, zone);
  const ammoRequired = {};
  for (const module of weapons) {
    const combat = module.equipment.combat;
    ammoRequired[combat.weaponType] = (ammoRequired[combat.weaponType] || 0) + (combat.ammoCost || 1);
  }
  const enoughFuel = ResourceRegistry.get(state, "consumable:fuel") >= volleyFuel;
  const enoughAmmo = Object.entries(ammoRequired).every(([type, amount]) => getSelectedCount(state, type) >= amount);
  const canFire = weapons.length > 0 && enoughFuel && enoughAmmo;

  if (canFire) {
    // Batch C-11：真实开火前清洗/切区检测（仅普通星带模式登记；死亡空间不参与 E21–E23）
    if (c.mode !== "deathspace") normalizeCombatRunWeaponTypes(c, zone.id);
    // Batch C-12：记录本轮开火前清洗 runDamage 并捕获快照
    normalizeCombatRunDamage(c);
    const prevRunDamage = c.runDamageDealt;
    ResourceRegistry.spend(state, "consumable:fuel", volleyFuel);
    const volleyAmmoProps = {};
    for (const [type, amount] of Object.entries(ammoRequired)) {
      const r = consumeAmmoForType(state, type, amount);
      volleyAmmoProps[type] = getAmmoTierProps(r.tier);
    }
    const capSkill = state.skills.capacitorManagement;
    if (capSkill && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, "capacitorManagement", volleyFuel * 0.3, "combat"); }

    for (const module of weapons) {
      const equipment = module.equipment;
      const combat = equipment.combat;
      const weapon = WEAPON_CONFIG[combat.weaponType];
      if (!weapon) continue;
      // Batch C-11：真实攻击结算才登记武器类型（WEAPON_CONFIG 命中即为合法类型），去重追加
      if (c.mode !== "deathspace" && c.runWeaponTypes.indexOf(combat.weaponType) === -1) {
        c.runWeaponTypes.push(combat.weaponType);
      }
      const ammoProps = volleyAmmoProps[combat.weaponType] || getAmmoTierProps("T1");
      const playerHit = calcPlayerHit(combat.weaponType, equipment, state) * ammoProps.hitMult;
      const dmgMult = calcPlayerDmgMult(combat.weaponType, state);
      let counterMult = 1.0;
      if (weapon.counterType === "shield" && enemy.hp.shield > 0) counterMult = 1.25;
      else if (weapon.counterType === "armor" && enemy.hp.shield <= 0 && enemy.hp.armor > 0) counterMult = 1.25;
      else if (weapon.counterType === "structure" && enemy.hp.shield <= 0 && enemy.hp.armor <= 0 && enemy.hp.structure > 0) counterMult = 1.25;
      const traitMultiplier = getCapitalWeaponTraitMultiplier(ship, combat.weaponType, c.hp, c.maxHp);
      const boosterDmg = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).weaponDamageMultiplier : null;
      const weaponBoosterMult = (boosterDmg && boosterDmg[combat.weaponType]) ? boosterDmg[combat.weaponType] : 1;
      const damage = calcCombatDamage(playerHit, enemy.dodge, combat.baseDamage * (module.multiplier || 1) * weaponBoosterMult, counterMult * dmgMult * traitMultiplier * ammoProps.dmgMult, rng);
      const dealt = applyLayeredCombatDamage(enemy.hp, damage);
      const dealtTotal = dealt.shield + dealt.armor + dealt.structure;
      c.runDamageDealt = (typeof c.runDamageDealt === "number" ? c.runDamageDealt : 0) + dealtTotal;
      for (const areaTarget of getCapitalAreaDamageTargets(c.enemies, enemy, combat.aoe)) {
        const areaDamage = Math.max(1, Math.round(damage * areaTarget.multiplier));
        const areaDealt = applyLayeredCombatDamage(areaTarget.enemy.hp, areaDamage);
        c.runDamageDealt += areaDealt.shield + areaDealt.armor + areaDealt.structure;
      }
      if (playEffects) playAttackFX(true, combat.weaponType, damage);
      const weaponSkill = state.skills[weapon.skillKey];
      if (weaponSkill && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, weapon.skillKey, 2, "combat"); }
      const targetingSkill = state.skills.targeting;
      if (targetingSkill && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, "targeting", 1, "combat"); }
    }
    // Batch C-12（返修）：只有 amount 为有限正数才 emit；全部 miss/0 实伤不发射
    const amountThisVolley = c.runDamageDealt - prevRunDamage;
    if (typeof amountThisVolley === "number" && Number.isFinite(amountThisVolley) && amountThisVolley > 0) {
      emit("combat:damageDealt", { zoneId:zone.id, mode:c.mode, amount:amountThisVolley, runTotal:c.runDamageDealt });
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
    resolveCombatEnemyDefeat(defeated, zone, rng, emit, state);
  }

  // --- 所有存活敌人依照编队顺序逐一行动 ---
  const playerDodge = calcPlayerDodge(undefined, state);
  const capitalTrait = getCapitalCombatTrait(ship);
  const enemyVolley = { attackers:0, totalDamage:0, mitigatedDamage:0, armorRestored:0, traitName:capitalTrait ? capitalTrait.name : "", hits:[] };
  let shieldHitsUsed = 0;
  let armorDamageTaken = 0;
  for (const attacker of getLivingCombatEnemies(c)) {
    const rawEnemyDamage = calcCombatDamage(attacker.hit, playerDodge, attacker.baseDamage || 1, 1.0, rng);
    const mitigation = applyCapitalShieldMitigation(ship, rawEnemyDamage, shieldHitsUsed, c.hp.shield);
    if (mitigation.shieldHitUsed) shieldHitsUsed++;
    const enemyDmg = Math.max(0, Math.round(mitigation.damage));
    const damageTaken = applyLayeredCombatDamage(c.hp, enemyDmg);
    armorDamageTaken += damageTaken.armor;
    // Batch C-12：累计玩家实际承受伤害
    c.runDamageTaken = (typeof c.runDamageTaken === "number" ? c.runDamageTaken : 0) + damageTaken.shield + damageTaken.armor + damageTaken.structure;
    enemyVolley.mitigatedDamage += Math.round(mitigation.mitigated);
    const actualDamage = damageTaken.shield + damageTaken.armor + damageTaken.structure;
    const attackOrder = enemyVolley.attackers;
    enemyVolley.attackers++;
    enemyVolley.totalDamage += actualDamage;
    enemyVolley.hits.push({ enemyId:attacker.id, damage:actualDamage });
    if (playEffects) playEnemyAttackFX(c.enemies.indexOf(attacker), attackOrder, actualDamage);

    if (damageTaken.shield > 0) { const s = state.skills.shieldOperation; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, "shieldOperation", 1, "combat"); } }
    if (damageTaken.armor > 0) { const s = state.skills.armorReinforcement; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, "armorReinforcement", 1, "combat"); } }
    if (damageTaken.structure > 0) { const s = state.skills.hullEngineering; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, "hullEngineering", 1, "combat"); } }
    if (damageTaken.shield + damageTaken.armor + damageTaken.structure > 0) {
      const s = state.skills.piloting; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, "piloting", 1, "combat"); }
    }
    if (c.hp.structure <= 0) {
      beginCombatRecovery(state, context);
      return { ok:true, advanced:true, active:false, pending:Boolean(c.deathspaceChainPending), recovering:true, reason:"defeated" };
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
  const boosterRep = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).repairMultiplier : null;
  for (const module of repairers) {
    const rep = module.equipment.combat;
    const repFuelCost = Math.max(1, Math.round((rep.fuelCost || 1) * calcFuelMult(zone, state)));
    if (ResourceRegistry.get(state, "consumable:fuel") < repFuelCost) continue;
    if (  c.hp[rep.target] < c.maxHp[rep.target]) {
      const repMult = (boosterRep && boosterRep[rep.target]) ? boosterRep[rep.target] : 1;
      const healAmount = Math.round(rep.amount * (module.multiplier || 1) * calcRepairMult(rep.target, state, c.hp.structure / c.maxHp.structure) * repMult);
      c.hp[rep.target] = Math.min(c.maxHp[rep.target], c.hp[rep.target] + healAmount);
      ResourceRegistry.spend(state, "consumable:fuel", repFuelCost);
      // 防御经验
      const s = state.skills.defense; if (s && typeof addStationModifiedCombatXp === "function") { addStationModifiedCombatXp(state, "defense", 1, "combat"); }
    }
  }
  resolveCombatWaveVictory(zone, rng, emit, state);
  state._dirty = true;
  return { ok:true, advanced:true, active:Boolean(c.active), pending:Boolean(c.deathspaceChainPending), recovering:false, reason:c.active ? "ongoing" : "cleared" };
}

// ============================================================================
// Batch R：死亡空间进入原语（手动进入 / 连刷首轮 / 在线续跑 共用）
//   严格顺序：先全部校验 → 通过后才扣 1 密钥 → 初始化死亡空间状态 → emit
//   combat:deathspaceEntered（context.emit）。任一校验失败：密钥/剩余/待续/HP/敌人/
//   账本全部不变（原子回滚）。continuation:true 沿用既有 runToken（同一连刷链=同一 run）；
//   否则刷新 runToken（新 run）。
// ============================================================================
function beginDeathspaceRun(state, options, context) {
  context = context || {};
  const emit = (typeof context.emit === "function") ? context.emit : (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {});
  // Batch R 返修：虚拟时间权威化——context.now 非有限 number 时返回稳定失败，绝不宽松 Number()、绝不回退真实时间。
  if (typeof context.now !== "number" || !Number.isFinite(context.now)) return { changed:false, reason:"invalid-now" };
  const now = context.now;
  const opts = options || {};
  const deathspaceId = opts.deathspaceId;
  const site = getDeathspaceById(deathspaceId);
  if (!site) return { changed:false, reason:"unknown-deathspace" };
  // 问题2：per-ship 维修——仅当「当前战斗舰」正在维修时拒绝出击，健康舰可正常进入。
  const activeShipId = state.combat.activeShip || (getActiveCombatShipState(state).instance && getActiveCombatShipState(state).instance.instanceId) || null;
  if (isShipUnderRepair(state, activeShipId, now)) return { changed:false, reason:"repairing", remaining:Math.ceil((getShipRepairUntil(state, activeShipId) - now) / 1000) };
  if (getCombatLevelFromState(state) < site.requiredCL) return { changed:false, reason:"level-locked", requiredCL:site.requiredCL };
  const weapons = getInstalledCombatModulesFromState(state).filter(module => module.combat && module.combat.kind === "weapon");
  if (weapons.length === 0) return { changed:false, reason:"no-weapons" };
  if (ResourceRegistry.get(state, "special:" + site.ticketMaterial) < 1) return { changed:false, reason:"missing-ticket", ticketMaterial:site.ticketMaterial };
  // 全部校验通过：仅在此时进入新 run 初始化 / 扣密钥（原子——之前任一 return 均未触达此处）。
  // Batch R 返修：新 run 先刷新 runToken + runSequence（+1）并将 enemyInstanceSeq 归零；
  // 续跑（continuation）沿用既有 runToken / runSequence，敌人序号继续递增。
  // 编队/敌人统一在入口内用「当前 run 的 RNG 与 token」权威生成，杜绝 UI 预生成的旧 token 敌人误入新 run。
  if (!opts.continuation) {
    resetCombatRunState(state.combat);
    // 新 run 开战前将玩家舰血量重置为满血：上一场残留受损 hp 不应带入新 run（惨胜残血会导致
    // 开战即被击败、立即进维修）。维修态已由上方 isShipUnderRepair 拦截，此处仅初始化健康舰满血。
    const _maxHp = (typeof getCombatMaxHpFromState === "function") ? getCombatMaxHpFromState(state)
      : (state.combat.maxHp || { shield:0, armor:0, structure:0 });
    state.combat.hp = { ..._maxHp };
    state.combat.maxHp = { ..._maxHp };
  }
  const wave = buildDeathspaceWave(site, 1, function () { return nextCombatRandom(state.combat); }, state.combat);
  const enemies = wave.enemies;
  const formationId = wave.formationId;
  if (!Array.isArray(enemies) || enemies.length === 0) return { changed:false, reason:"missing-formation" };
  ResourceRegistry.spend(state, "special:" + site.ticketMaterial, 1); // 校验通过后才扣密钥
  Object.assign(state.combat, {
    mode:"deathspace", viewMode:"deathspace", deathspaceId:site.id, zone:site.sourceZoneId,
    deathspaceTier:site.dedTier, viewDeathspaceId:site.id, viewDeathspaceTier:site.dedTier,
    active:true, enemies, currentEnemy:enemies[0] || null, wave:1,
    totalKills:0, runEliteKills:0, currentFormation:formationId,
    lastLoot:"", lastSpecialLoot:"", lastStatus:"通行密钥已消耗", lastEnemyVolley:null,
    runWeaponTypes:[], runWeaponTypesZone:site.sourceZoneId, runDamageDealt:0, runDamageTaken:0
  });
  state.currentAction.skill = "combat";
  state.currentAction.active = true;
  state._dirty = true;
  emit("combat:deathspaceEntered", {
    deathspaceId:site.id, zoneId:site.sourceZoneId, faction:site.faction, tier:site.dedTier
  }, { timestamp:now, source:"combat", offline:Boolean(context.offline) });
  // 问题1：进入死亡空间前同样做燃料校验（非阻断 warning）。
  const dsZone = COMBAT_ZONES.find(item => item.id === site.sourceZoneId) || COMBAT_ZONES[0];
  const dsVolleyFuel = computeVolleyFuel(state, dsZone);
  const dsFuel = ResourceRegistry.get(state, "consumable:fuel");
  const dsWarning = (dsVolleyFuel > 0 && dsFuel < dsVolleyFuel) ? "low-fuel" : null;
  return { changed:true, site, warning:dsWarning };
}

// 在线 combatTick：薄包装。先执行 recovery / 连刷 pending 语义，再每 tick 恰好一次调用
// 共享内核 advanceCombatRound（离线结算仅在 Batch S 接入，本批不接 offline.js）。
// 在线 combatTick：薄包装。本 tick 仅取一次 Date.now() 并复用同一 now 给 recovery / 连刷 pending /
// entered / continued / 首回合，严禁多次 Date.now()。state 固定传入权威 gameState。
function combatTick() {
  const now = Date.now();
  const emit = (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {});
  updateCombatRecovery(now, gameState);
  const c = gameState.combat;
  // 连刷自动续跑：上一轮全清后 pending，本 tick（满血、无维修）自动续进下一轮。
  // 顺序：beginDeathspaceRun 成功并已扣密钥 → deathspaceChainRemaining-- → emit
  // combat:deathspaceChainContinued → 同 tick 内由下方 advanceCombatRound 跑首轮。
  // entered 必须早于 continued。编队/敌人统一由 beginDeathspaceRun 内部用「当前 run 的 RNG 与 token」
  // 权威生成（续跑沿用既有 runToken，敌人序号继续递增），杜绝 UI 预生成的旧 token 敌人误入。
  if (c.deathspaceChainPending && !c.active) {
    c.deathspaceChainPending = false;
    if (c.deathspaceChainRemaining > 0) {
      const pendingSite = getDeathspaceById(c.deathspaceId);
      if (pendingSite) {
        const res = beginDeathspaceRun(gameState, {
          deathspaceId: pendingSite.id,
          continuation: true
        }, { now, emit, offline:false });
        if (res && res.changed) {
          c.deathspaceChainRemaining--;
          if (typeof GameEvents !== "undefined") GameEvents.emit("combat:deathspaceChainContinued", { deathspaceId:pendingSite.id, remaining:c.deathspaceChainRemaining }, { timestamp:now, source:"combat", offline:false });
        } else {
          c.deathspaceChainRemaining = 0; // 无密钥/等级/维修任一不过 → 连刷自然终止
        }
      } else {
        c.deathspaceChainRemaining = 0;
      }
    }
  }
  if (!c.active) return;
  advanceCombatRound(gameState, { now, offline:false, emit, playEffects:true });
}
