// ---- gameState 主状态对象 ----
const gameState = {
  resources: {
    isk: 1000000,
    lp: 0,
    ores: {},
    minerals: {},
    planetary: {},
    ammunition: {},
    gases: {},
    moonOres: { "镓":0, "铂":0, "铪":0, "锇":0, "钷":0, "铷":0 },
    special: Object.fromEntries(COMBAT_SPECIAL_MATERIALS.map(material => [material, 0])),
    shipComponents: {},
    repairPaste: 0,
    warpFuel: 1,
    fuel: 1000,
    ammunition: { laser: 500, missile: 500, cannon: 500 }
  },

  skills: JSON.parse(JSON.stringify(INITIAL_SKILLS)),

  currentAction: {
    skill: "mining",
    area: "凡晶石带",
    miningMode: "normal",
    normalMiningArea: "凡晶石带",
    moonMiningArea: "镓月岩带",
    startTime: Date.now(),
    active: false,
    progress: 0,
    lastProgressUpdate: Date.now(),
    refDuration: 1,
    smeltingArea: "凡晶石带",
    gasArea: "富勒烯云团",
    equipEngTarget: "t1_mining_laser",
    equipEngCategory: "industry",
    startedEquipEngTarget: "",
    shipCompTarget: "integrated_hull",
    startedShipCompTarget: "",
    shipAsmTarget: "rifter",
    startedShipAsmTarget: "",
    batchRemaining: 0,
    startedArea: "",
    startedSmeltingArea: "",
    startedGasArea: ""
  },

  planetary: {
    deployments: [],
    nextId: 1
  },

  inventory: {
    ships: [{ shipId: "rifter", instanceId: "ship_" + Date.now() + "_0", builtAt: Date.now(), fitted: getDefaultCombatFitting("rifter") }],
    equipment: [],
    rigs: []
  },

  activeIndustrialShip: null,
  shipAssignments: {},

  equipment: { inventory: [] },

  upgrades: {},
  ownedBlueprints: [],

  combat: {
    mode: "belt",
    viewMode: "belt",
    zone: "angel_outpost",
    deathspaceId: "angel_ded_6_10",
    deathspaceTier: 6,
    viewDeathspaceId: "angel_ded_6_10",
    viewDeathspaceTier: 6,
    deathspaceClears: {},
    weapon: "laser",
    hp: { shield: 300, armor: 100, structure: 100 },
    maxHp: { shield: 300, armor: 100, structure: 100 },
    repair: { shieldBooster: true, armorRepairer: true, structureRepairer: false },
    enemies: [],
    currentEnemy: null,
    wave: 1,
    zoneClears: {},
    runEliteKills: 0,
    currentFormation: "",
    totalKills: 0,
    lastLoot: "",
    lastSpecialLoot: "",
    lastEnemyVolley: null,
    active: false,
    repairUntil: 0,
    destroyedShip: null,
    lastStatus: ""
  },

  settings: {
    confirmShipEnhancement: true,
    combatSkillsExpanded: false
  },

  migrations: {},

  queue: {
    items: [],
    config: { maxSize: 20, loopMode: false, skipOnFail: true },
    status: { activeIndex: -1, isRunning: false, completedCount: 0, failCount: 0 }
  },

  _dirty: false,
  lastActiveTime: Date.now(),
  lastSaveTime: Date.now()
};

// 挂到 window 供存档系统使用
window.gameState = gameState;

function ensureUserSettingsState(state) {
  if (!state.settings || typeof state.settings !== "object") state.settings = {};
  if (state.settings.confirmShipEnhancement === undefined) state.settings.confirmShipEnhancement = true;
  else state.settings.confirmShipEnhancement = Boolean(state.settings.confirmShipEnhancement);
  if (state.settings.combatSkillsExpanded === undefined) state.settings.combatSkillsExpanded = false;
  else state.settings.combatSkillsExpanded = Boolean(state.settings.combatSkillsExpanded);
  return state.settings;
}

function createEmptyFitting() {
  return { high: [], mid: [], low: [], rig: [] };
}

function normalizeFitting(fitted) {
  const normalized = createEmptyFitting();
  for (const slot of Object.keys(normalized)) {
    normalized[slot] = Array.isArray(fitted && fitted[slot]) ? fitted[slot].slice() : [];
  }
  return normalized;
}

function createShipInstance(shipId, builtAt) {
  const timestamp = builtAt || Date.now();
  return {
    shipId,
    instanceId: "ship_" + timestamp + "_" + Math.random().toString(36).slice(2, 8),
    builtAt: timestamp,
    fitted: createEmptyFitting(),
    enhancementLevel: 0
  };
}

function ensureShipInstances() {
  if (!gameState.inventory) gameState.inventory = { ships: [], equipment: [], rigs: [] };
  if (!Array.isArray(gameState.inventory.ships)) gameState.inventory.ships = [];
  const usedIds = new Set();
  gameState.inventory.ships.forEach((ship, index) => {
    let instanceId = ship.instanceId || "ship_" + (ship.builtAt || Date.now()) + "_" + index;
    while (usedIds.has(instanceId)) instanceId += "_" + index;
    ship.instanceId = instanceId;
    usedIds.add(instanceId);
    ship.fitted = normalizeFitting(ship.fitted);
    ship.enhancementLevel = Math.max(0, Math.floor(Number(ship.enhancementLevel) || 0));
  });
}

function getShipInstance(shipRef) {
  ensureShipInstances();
  return gameState.inventory.ships.find(ship => ship.instanceId === shipRef) ||
    gameState.inventory.ships.find(ship => ship.shipId === shipRef) || null;
}

function getShipFitting(shipRef) {
  const ship = getShipInstance(shipRef);
  if (!ship) return createEmptyFitting();
  ship.fitted = normalizeFitting(ship.fitted);
  return ship.fitted;
}

function getAssignedShipInstance(actionKey) {
  if (!gameState.shipAssignments) return null;
  return getShipInstance(gameState.shipAssignments[actionKey]);
}

/* ================================================================
   核心逻辑 — 采矿 / 冶炼 tick + 技能切换 + UI 刷新
   ================================================================ */

const SKILL_LABEL = {
  mining: "采矿", refining: "冶炼", gasHarvesting: "气体采集",
  shipEngineering: "舰船工程", equipmentEngineering: "装备工程",
  rigEngineering: "改装件工程",
  reverseEngineering: "逆向工程",
  combat: "战斗"
};
