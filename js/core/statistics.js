/* ================================================================
   内部统计 — GameEvents首个只读消费者

   只记录已经发生的领域事件，不参与生产、战斗或奖励计算。
   ================================================================ */

const GAME_STATISTICS_VERSION = 1;

function createDefaultStatisticsState() {
  return {
    version:GAME_STATISTICS_VERSION,
    totals:{
      events:0, miningCycles:0, minedUnits:0, refiningCycles:0, refinedUnits:0,
      gasCycles:0, gasUnits:0, planetaryCycles:0, planetaryUnits:0,
      manufacturingCycles:0, manufacturedUnits:0, shipsBuilt:0,
      enemyKills:0, eliteKills:0, bossKills:0, wavesCleared:0, zonesCleared:0,
      deathspaceWavesCleared:0, deathspacesCleared:0,
      shipsDestroyed:0, skillLevelsGained:0,
      enhancementAttempts:0, enhancementSuccesses:0, enhancementFailures:0,
      enhancementComponentsSpent:0, highestEnhancementLevel:0
    },
    activity:{ onlineEvents:0, offlineEvents:0, onlineCycles:0, offlineCycles:0 },
    production:{ gathered:{}, refined:{}, manufactured:{} },
    combat:{ factionKills:{}, zoneKills:{}, zoneClears:{}, deathspaceClears:{} },
    eventLedger:{ processedEventIds:[] }
  };
}

function ensureStatisticsState(state) {
  const defaults = createDefaultStatisticsState();
  const current = state && state.statistics && typeof state.statistics === "object" ? state.statistics : {};
  const statistics = current;
  statistics.version = GAME_STATISTICS_VERSION;
  statistics.totals = { ...defaults.totals, ...(current.totals || {}) };
  statistics.activity = { ...defaults.activity, ...(current.activity || {}) };
  statistics.production = current.production && typeof current.production === "object" ? current.production : {};
  for (const key of ["gathered", "refined", "manufactured"]) {
    if (!statistics.production[key] || typeof statistics.production[key] !== "object") statistics.production[key] = {};
  }
  statistics.combat = current.combat && typeof current.combat === "object" ? current.combat : {};
  for (const key of ["factionKills", "zoneKills", "zoneClears", "deathspaceClears"]) {
    if (!statistics.combat[key] || typeof statistics.combat[key] !== "object") statistics.combat[key] = {};
  }
  statistics.eventLedger = current.eventLedger && typeof current.eventLedger === "object" ? current.eventLedger : {};
  if (!Array.isArray(statistics.eventLedger.processedEventIds)) statistics.eventLedger.processedEventIds = [];
  if (statistics.eventLedger.processedEventIds.length > 512) statistics.eventLedger.processedEventIds = statistics.eventLedger.processedEventIds.slice(-512);
  state.statistics = statistics;
  return statistics;
}

function addStatistic(map, key, amount) {
  if (!key || !Number.isFinite(Number(amount)) || Number(amount) === 0) return;
  map[key] = (Number(map[key]) || 0) + Number(amount);
}

function consumeStatisticsEvent(event) {
  const statistics = ensureStatisticsState(gameState);
  const payload = event.payload;
  const cycles = Math.max(1, Number(payload.cycles) || 1);
  let handled = true;

  switch (event.type) {
    case "mining:completed":
      statistics.totals.miningCycles += cycles;
      statistics.totals.minedUnits += Number(payload.quantity) || 0;
      addStatistic(statistics.production.gathered, payload.resourceId, payload.quantity);
      break;
    case "refining:completed":
      statistics.totals.refiningCycles += cycles;
      statistics.totals.refinedUnits += Number(payload.outputQuantity) || 0;
      addStatistic(statistics.production.refined, payload.outputId, payload.outputQuantity);
      break;
    case "gas:completed":
      statistics.totals.gasCycles += cycles;
      statistics.totals.gasUnits += Number(payload.quantity) || 0;
      addStatistic(statistics.production.gathered, payload.resourceId, payload.quantity);
      break;
    case "planetary:completed":
      statistics.totals.planetaryCycles += cycles;
      statistics.totals.planetaryUnits += Number(payload.quantity) || 0;
      addStatistic(statistics.production.gathered, payload.resourceId, payload.quantity);
      break;
    case "manufacturing:completed":
      statistics.totals.manufacturingCycles += cycles;
      statistics.totals.manufacturedUnits += Number(payload.quantity) || 0;
      if (payload.branch === "ship") statistics.totals.shipsBuilt += Number(payload.quantity) || 0;
      addStatistic(statistics.production.manufactured, payload.recipeId, payload.quantity);
      break;
    case "combat:enemyDefeated":
      statistics.totals.enemyKills++;
      if (payload.enemyKind === "elite") statistics.totals.eliteKills++;
      if (payload.enemyKind === "boss") statistics.totals.bossKills++;
      addStatistic(statistics.combat.factionKills, payload.faction, 1);
      addStatistic(statistics.combat.zoneKills, payload.zoneId, 1);
      break;
    case "combat:waveCleared":
      statistics.totals.wavesCleared++;
      break;
    case "combat:zoneCleared":
      statistics.totals.zonesCleared++;
      addStatistic(statistics.combat.zoneClears, payload.zoneId, 1);
      break;
    case "combat:deathspaceWaveCleared":
      statistics.totals.deathspaceWavesCleared++;
      break;
    case "combat:deathspaceCleared":
      statistics.totals.deathspacesCleared++;
      addStatistic(statistics.combat.deathspaceClears, payload.deathspaceId, 1);
      break;
    case "ship:destroyed":
      statistics.totals.shipsDestroyed++;
      break;
    case "ship:enhancementAttempted":
      statistics.totals.enhancementAttempts++;
      if (payload.success) statistics.totals.enhancementSuccesses++;
      else statistics.totals.enhancementFailures++;
      statistics.totals.enhancementComponentsSpent += Number(payload.componentsSpent) || 0;
      statistics.totals.highestEnhancementLevel = Math.max(statistics.totals.highestEnhancementLevel, Number(payload.toLevel) || 0);
      break;
    case "skill:levelUp":
      statistics.totals.skillLevelsGained += Math.max(1, Number(payload.level) - Number(payload.previousLevel) || 1);
      break;
    default:
      handled = false;
  }

  if (!handled) return false;
  statistics.totals.events++;
  if (event.meta.offline) {
    statistics.activity.offlineEvents++;
    statistics.activity.offlineCycles += cycles;
  } else {
    statistics.activity.onlineEvents++;
    statistics.activity.onlineCycles += cycles;
  }
  gameState._dirty = true;
  return true;
}

function getStatisticsSnapshot(state) {
  const statistics = state && state.statistics ? state.statistics : createDefaultStatisticsState();
  return JSON.parse(JSON.stringify(statistics));
}

ensureStatisticsState(gameState);
GameEvents.onIdempotent("*", {
  consumerId:"statistics",
  maxEntries:512,
  getLedger:() => ensureStatisticsState(gameState).eventLedger
}, consumeStatisticsEvent);

window.GameStatistics = Object.freeze({ snapshot:() => getStatisticsSnapshot(gameState) });
