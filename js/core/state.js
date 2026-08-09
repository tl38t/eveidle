// 军团与空间站系统（Phase 3C）：八建筑稳定 ID，供存档迁移与后续 phase 复用。
// 顺序与策划文档第三节一致；具体效果在 3C-2 之后逐步实装。
const STATION_BUILDING_IDS = [
  "resource_dispatch",  // 资源调度中心
  "planetary_control",  // 行星管控中心
  "smelting_refinery",  // 冶炼精炼厂
  "equipment_factory",  // 装备制造厂
  "booster_factory",    // 增强剂制造厂
  "archaeology_lab",    // 考古实验室
  "combat_command",     // 作战指挥中心
  "shipyard"            // 舰船船坞
];

// ---- gameState 主状态对象 ----
const gameState = {
  resources: {
    isk: 10000,
    lp: 0,
    ores: {},
    minerals: {},
    planetary: {},
    gases: {},
    moonOres: { "镓":0, "铂":0, "铪":0, "锇":0, "钷":0, "铷":0 },
    special: Object.fromEntries(COMBAT_SPECIAL_MATERIALS.map(material => [material, 0])),
    shipComponents: {},
    repairPaste: 0,
    warpFuel: 1,
    fuel: 1000,
    probes: {},
    artifacts: {},
    calibrations: {}
  },

  stationCoresObtained: { smelt:false, shipEng:false, equipEng:false, booster:false },

  ammo: [], // 弹药实例数组（见 js/data/ammo.js）；旧 resources.ammunition 计数已迁移

  implants: {}, // 账号全局被动脑插（见 js/data/implants.js）：拥有即永久生效，键为脑插 id

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
    equipEngCategory: "mining",
    equipEngRigSeries: RIG_ENGINEERING_SERIES[0].id,
    startedEquipEngTarget: "",
    shipCompTarget: "integrated_hull",
    startedShipCompTarget: "",
    shipAsmTarget: "rifter",
    startedShipAsmTarget: "",
    // 舰船工程 UI 重做（2026-08-04）：一级视图 / 部件分类 / 总装技术线 / 分页
    shipEngSubView: "component",
    shipCompClass: "integrated",
    shipAsmLine: "shield_laser",
    shipAsmPage: 0,
    batchRemaining: 0,
    startedArea: "",
    startedSmeltingArea: "",
    startedGasArea: "",
    // 增强剂系统 Phase 2A：boosterRecipeTarget = 当前选中配方；startedBoosterRecipeTarget = 运行中锁定配方（切换选择不改产物）
    boosterRecipeTarget: "mining_lubricant_n",
    boosterCategory: "mining",
    boosterQualityFilter: "all",
    startedBoosterRecipeTarget: ""
  },

  planetary: {
    deployments: [],
    nextId: 1
  },

  inventory: {
    ships: [],
    equipment: [],
    rigs: []
  },

  activeIndustrialShip: null,
  shipAssignments: {},
  cargoLoot: [],

  // 维修后自动恢复原行动（Phase 3D）：舰船在考古重创 / 战斗损毁进入维修时记录被打断的行动，
  // 维修完成后据此自动续跑。null = 无需恢复。结构：
  //   考古 { type:"archaeology", siteId, probeId, shipInstanceId }
  //   战斗 { type:"combat", zoneId, mode:"zone"|"deathspace", shipInstanceId }
  // 离线考古由 settleByTime 直接跨维修续跑，不依赖本字段；离线战斗尚未实装（Phase 4A）。
  resumeAfterRepair: null,

  archaeology: {
    activeSiteId: null,
    activeProbeId: "core_probe_i",
    progress: 0,
    startedSiteId: null,
    startedProbeId: null,
    shipHp: {},
    repairUntil: 0,
    repairInstanceId: null,
    interferenceUntil: 0,
    // 确定性燃料节省累计器（见 RIG_SYSTEM_IMPLEMENTATION_PLAN 3.6）：
    // 把每次行动被取整丢弃的小数燃料节省攒起来，攒满 1 点就少扣 1 燃料。
    // 恒有限、归一化到 [0,1)；仅在完整重置游戏时清零。
    fuelSavingRemainder: 0,
    // 确定性探针节省累计器（研究批次 G · probe 组减耗）：与燃料累计器同构。
    // 每周期把 getResearchBonusValue(state,"probe") 的小数节省攒起来，攒满 1 支就免扣 1 支探针。
    // 恒有限、归一化到 [0,1)；仅在完整重置游戏时清零。
    probeSavingRemainder: 0,
    log: []
  },

  equipment: { inventory: [], instances: [], nextInstanceId: 1 },

  // 增强剂系统 Phase 2A：inventory 启用（可堆叠库存）；active 六槽仅初始化/迁移/保存，本阶段不装备、不计时、不应用效果，始终 null。
  boosters: {
    inventory: {},
    active: {
      miningSpeed: null,
      miningYield: null,
      archaeologySpeed: null,
      archaeologyRare: null,
      combatWeapon: null,
      combatRepair: null
    },
    lastTick: Date.now()
  },

  station: {
    version: 1,
    bodyLevel: 0,
    construction: null,
    buildings: Object.fromEntries(STATION_BUILDING_IDS.map(id => [id, 0])),
    maintenance: { tier: "standard", fuelRemaining: 0, lastRefillAt: 0 },
    autoLines: {
      smelting:    { enabled:false, operatorId:null },
      equipment:   { enabled:false, operatorId:null },
      booster:     { enabled:false, operatorId:null }
    },
    shipyard: { unlockedFlagship:false, unlockedSupercapital:false, savingsLedger:{} },
    dlc: { npcWorkers:false, combatWings:false }
  },

  corporation: {
    version: 1,
    name: "",
    foundedAt: 0,
    dlc: { npcWorkers:false, combatWings:false }
  },

  upgrades: {},
  ownedBlueprints: [],

  // 新手引导（Batch O）：唯一权威 tutorial 状态，由 tutorial-state.js 提供默认结构。
  tutorial: TutorialState.createDefaultTutorialState(),

  // 研究系统（批次 B）：单一研究槽 + 队列，独立于 currentAction 与现有 queue。
  // 由 js/core/research-state.js（须在本文件之前加载）提供默认结构；不复制第二套 schema。
  research: ResearchState.createDefaultResearchState(),

  // 成就系统（Batch B）：唯一权威解锁状态（解锁时间映射为唯一事实来源）。
  // 由 js/core/achievement-state.js（须在本文件之前加载）提供默认结构；
  // fail-fast：AchievementState 缺失即抛 ReferenceError，禁止第二套兜底 schema。
  achievements: AchievementState.createDefaultAchievementState(),

  combat: {
    mode: "belt",
    viewMode: "belt",
    zone: "angel_outpost",
    deathspaceId: "angel_ded_6_10",
    deathspaceTier: 6,
    targetingMode: "formation",
    viewDeathspaceId: "angel_ded_6_10",
    viewDeathspaceTier: 6,
    deathspaceClears: {},
    deathspaceChainRemaining: 0,
    deathspaceChainPending: false,
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
    repairUntil: 0,        // 旧字段：仅存档迁移兼容占位，迁移后即清零，绝不作为权威判断（见 persistence.migrateCombatEquipmentState）
    destroyedShip: null,   // 旧字段：同上，权威维修状态见 repairs[instanceId]
    repairs: {},           // 问题2 权威：per-ship 维修截止时间戳 combat.repairs[instanceId] = untilTs
    activeShip: null,      // 当前出战战斗舰 instanceId（与 shipAssignments.combat 保持一致；getActiveCombatShipState 优先读 assignments）
    lastStatus: "",
    // Batch R：JSON 安全确定性 RNG 状态（在线/离线共用，不 monkeypatch 全局 Math.random）
    //   seed/counterLo/counterHi 均为 uint32；counterLo 溢出向 counterHi 进位。
    //   null 占位由 migrateDeathspaceState 依存档稳定摘要派生并填充。
    randomState: null,
    runToken: null,         // 当前 combat run 标识（非空字符串或 null）；整条连刷链同一 runToken
    runSequence: 0,         // Batch R：run 序号（非负安全整数）；新 run +1、续轮不增、战败恢复 +1、迁移非法归零；并入 runToken
    enemyInstanceSeq: 0,    // 当前 run 内敌人实例序号（单调、不重复），供确定性 enemyId
    // 战斗并入队列（队列 count 取代 resumeAfterRepair 的自动续战职责）：
    //   queueItemId 关联驱动当前战斗的队列项；progress 字段随 combat 状态存档、跨维修保留。
    queueItemId: null,      // 当前驱动战斗的队列项 id（combat 经队列启动时由队列 runner 写入）
    queueWavesTarget: 0,    // 普通星带：目标清波数（= 队列项 count）
    queueWavesDone: 0,      // 普通星带：已清波数（跨维修累计，达标即终结队列项并推进）
    queueEntriesTarget: 0,  // 死亡空间：目标入场次数（= 队列项 count）
    queueEntriesDone: 0     // 死亡空间：已完成入场数（清场或战败均计 1 次）
  },

  settings: {
    confirmShipEnhancement: true,
    combatSkillsExpanded: false
  },

  migrations: {},

  queue: {
    items: [],
    // Batch C-14A（J05）：队列历史首次达 25 项即解锁，故容量下限须 ≥ 25；原为 20 会使 J05 永远不可达（真实 bug）。
    config: { maxSize: 25, loopMode: false, skipOnFail: true },
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
  boosterEngineering: "增强剂制造",
  archaeology: "考古",
  combat: "战斗"
};
