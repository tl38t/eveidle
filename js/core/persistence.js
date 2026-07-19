/* ================================================================
   存档系统

   迁移边界：本文件允许直接整理旧版 resources.* 字段，以便兼容历史存档。
   业务系统、选择器和UI必须改用 ResourceRegistry，不得复制这里的字段访问。
   ================================================================ */

const LocalStorageAdapter = {
  _key: "eve_idle_save",
  save(data) { try { localStorage.setItem(this._key, JSON.stringify(data)); return true; } catch (e) { console.warn("存档失败：", e); return false; } },
  load() { try { const json = localStorage.getItem(this._key); return json ? JSON.parse(json) : null; } catch (e) { console.warn("读档失败：", e); return null; } },
  export(data) { return JSON.stringify(data, null, 2); },
  import(jsonString) { return JSON.parse(jsonString); }
};

function migrateShipAndEquipmentState() {
  if (!gameState.inventory) gameState.inventory = { ships: [], equipment: [], rigs: [] };
  if (!Array.isArray(gameState.inventory.ships)) gameState.inventory.ships = [];
  if (gameState.inventory.ships.length === 0) gameState.inventory.ships.push(createShipInstance("rifter"));
  ensureShipInstances();

  if (!gameState.equipment || typeof gameState.equipment !== "object") gameState.equipment = { inventory: [] };
  if (!Array.isArray(gameState.equipment.inventory)) gameState.equipment.inventory = [];

  const legacyFitted = gameState.equipment.fitted;
  const legacyItems = legacyFitted ? Object.values(normalizeFitting(legacyFitted)).flat().filter(Boolean) : [];
  if (legacyItems.length > 0) {
    const preferredRef = (gameState.shipAssignments && gameState.shipAssignments.combat) ||
      (gameState.combat && gameState.combat.activeShip) || gameState.inventory.ships[0].instanceId;
    const targetShip = getShipInstance(preferredRef) || gameState.inventory.ships[0];
    const targetHasFitting = Object.values(targetShip.fitted || {}).some(items => Array.isArray(items) && items.some(Boolean));
    if (!targetHasFitting) targetShip.fitted = normalizeFitting(legacyFitted);
    else gameState.equipment.inventory.push(...legacyItems);
  }
  delete gameState.equipment.fitted;

  if (!gameState.shipAssignments || typeof gameState.shipAssignments !== "object") gameState.shipAssignments = {};
  for (const [actionKey, shipRef] of Object.entries(gameState.shipAssignments)) {
    const ship = getShipInstance(shipRef);
    if (ship) gameState.shipAssignments[actionKey] = ship.instanceId;
    else delete gameState.shipAssignments[actionKey];
  }
  if (gameState.combat && gameState.combat.activeShip) {
    const activeShip = getShipInstance(gameState.combat.activeShip);
    gameState.combat.activeShip = activeShip ? activeShip.instanceId : null;
  }
}

function migrateShipComponentState() {
  if (!gameState.resources || typeof gameState.resources !== "object") gameState.resources = {};
  if (!gameState.resources.shipComponents || typeof gameState.resources.shipComponents !== "object") gameState.resources.shipComponents = {};
  if (!gameState.migrations || typeof gameState.migrations !== "object") gameState.migrations = {};

  const idMap = {
    hull_frame:"integrated_hull", shield_gen:"integrated_hull", armor_plate:"integrated_hull",
    propulsion:"power_core", core_system:"power_core",
    weapon_mount:"functional_system", external_cargo:"functional_system", industrial_mount:"functional_system",
    destroyer_hull_frame:"destroyer_integrated_hull", destroyer_shield_gen:"destroyer_integrated_hull", destroyer_armor_plate:"destroyer_integrated_hull",
    destroyer_propulsion:"destroyer_power_core", destroyer_core_system:"destroyer_power_core", destroyer_weapon_mount:"destroyer_functional_system",
    cruiser_hull_frame:"cruiser_integrated_hull", cruiser_shield_gen:"cruiser_integrated_hull", cruiser_armor_plate:"cruiser_integrated_hull",
    cruiser_propulsion:"cruiser_power_core", cruiser_core_system:"cruiser_power_core", cruiser_weapon_mount:"cruiser_functional_system",
    battleship_hull_frame:"battleship_integrated_hull", battleship_shield_gen:"battleship_integrated_hull", battleship_armor_plate:"battleship_integrated_hull",
    battleship_propulsion:"battleship_power_core", battleship_core_system:"battleship_power_core", battleship_weapon_mount:"battleship_functional_system"
  };
  const legacyNames = {
    "船体骨架":"integrated_hull", "护盾发生器":"integrated_hull", "装甲镀层":"integrated_hull",
    "推进系统":"power_core", "核心系统":"power_core", "武器挂架":"functional_system", "外置货舱":"functional_system", "工业挂架":"functional_system",
    "驱逐舰船体骨架":"destroyer_integrated_hull", "驱逐舰护盾发生器":"destroyer_integrated_hull", "驱逐舰装甲镀层":"destroyer_integrated_hull",
    "驱逐舰推进系统":"destroyer_power_core", "驱逐舰核心系统":"destroyer_power_core", "驱逐舰武器挂架":"destroyer_functional_system",
    "巡洋舰船体骨架":"cruiser_integrated_hull", "巡洋舰护盾发生器":"cruiser_integrated_hull", "巡洋舰装甲镀层":"cruiser_integrated_hull",
    "巡洋舰推进系统":"cruiser_power_core", "巡洋舰核心系统":"cruiser_power_core", "巡洋舰武器挂架":"cruiser_functional_system",
    "战列舰船体骨架":"battleship_integrated_hull", "战列舰护盾发生器":"battleship_integrated_hull", "战列舰装甲镀层":"battleship_integrated_hull",
    "战列舰推进系统":"battleship_power_core", "战列舰核心系统":"battleship_power_core", "战列舰武器挂架":"battleship_functional_system"
  };

  if (!gameState.migrations.shipComponentsV2) {
    for (const [legacyId, replacementId] of Object.entries(idMap)) {
      const quantity = Math.max(0, Number(gameState.resources.shipComponents[legacyId]) || 0);
      if (quantity > 0) gameState.resources.shipComponents[replacementId] = (Number(gameState.resources.shipComponents[replacementId]) || 0) + quantity;
      delete gameState.resources.shipComponents[legacyId];
    }
    gameState.migrations.shipComponentsV2 = true;
    gameState._dirty = true;
  }

  const migrateTarget = value => idMap[value] || legacyNames[value] || value;
  const action = gameState.currentAction || {};
  action.shipCompTarget = migrateTarget(action.shipCompTarget || "integrated_hull");
  action.startedShipCompTarget = migrateTarget(action.startedShipCompTarget || "");
  if (!SHIP_COMPONENT_RECIPES.some(recipe => recipe.id === action.shipCompTarget)) action.shipCompTarget = "integrated_hull";
  if (action.startedShipCompTarget && !SHIP_COMPONENT_RECIPES.some(recipe => recipe.id === action.startedShipCompTarget)) action.startedShipCompTarget = "";

  if (gameState.queue && Array.isArray(gameState.queue.items)) {
    for (const item of gameState.queue.items) {
      if (item.skill !== "shipEngineering") continue;
      const replacementId = migrateTarget(item.target);
      const recipe = SHIP_COMPONENT_RECIPES.find(candidate => candidate.id === replacementId);
      if (!recipe) continue;
      item.target = recipe.id;
      item.label = recipe.name;
    }
  }
  ensureShipInstances();
}

function migrateCombatEquipmentState() {
  if (!gameState.combat || typeof gameState.combat !== "object") gameState.combat = {};
  if (!gameState.migrations || typeof gameState.migrations !== "object") gameState.migrations = {};
  const combat = gameState.combat;
  if (!Number.isFinite(Number(combat.repairUntil))) combat.repairUntil = 0;
  if (combat.destroyedShip === undefined) combat.destroyedShip = null;
  if (combat.lastStatus === undefined) combat.lastStatus = "";
  if (combat.lastLoot === undefined) combat.lastLoot = "";
  if (!combat.lastEnemyVolley || typeof combat.lastEnemyVolley !== "object") combat.lastEnemyVolley = null;
  if (!combat.zoneClears || typeof combat.zoneClears !== "object") combat.zoneClears = {};
  if (!Number.isFinite(Number(combat.runEliteKills))) combat.runEliteKills = 0;
  if (!Number.isFinite(Number(combat.totalKills))) combat.totalKills = 0;
  if (!Number.isFinite(Number(combat.wave)) || combat.wave < 1 || combat.wave > 20) combat.wave = 1;
  if (combat.currentFormation === undefined) combat.currentFormation = "";
  if (!Array.isArray(combat.enemies)) combat.enemies = [];
  if (!gameState.migrations.combatBeltsV2) {
    combat.active = false;
    combat.enemies = [];
    combat.currentEnemy = null;
    combat.wave = 1;
    combat.totalKills = 0;
    combat.runEliteKills = 0;
    combat.currentFormation = "";
    combat.lastEnemyVolley = null;
    if (gameState.currentAction && gameState.currentAction.skill === "combat") gameState.currentAction.active = false;
    gameState.migrations.combatBeltsV2 = true;
    gameState._dirty = true;
  } else {
    for (const enemy of combat.enemies) {
      if (!enemy.kind) enemy.kind = "normal";
      if (!Number.isFinite(Number(enemy.baseDamage))) enemy.baseDamage = 1;
      enemy.defeated = Boolean(enemy.defeated || !enemy.hp || enemy.hp.structure <= 0);
      enemy.rewarded = Boolean(enemy.rewarded || enemy.defeated);
    }
    combat.currentEnemy = combat.enemies.find(enemy => !enemy.defeated && enemy.hp && enemy.hp.structure > 0) || null;
  }

  // V4：同步重新分配威胁后的敌舰属性，并保留旧存档当前各层剩余比例。
  if (!gameState.migrations.combatBeltsV4) {
    const zone = COMBAT_ZONES.find(item => item.id === combat.zone);
    const faction = zone && ENEMY_DATABASE[zone.faction];
    if (faction) {
      for (const enemy of combat.enemies) {
        const template = faction.types[enemy.type];
        if (!template) continue;
        const oldMaxHp = enemy.maxHp || template.hp;
        const oldHp = enemy.hp || oldMaxHp;
        enemy.maxHp = { ...template.hp };
        enemy.hp = Object.fromEntries(Object.entries(template.hp).map(([layer, maximum]) => {
          if (enemy.defeated) return [layer, 0];
          const previousMaximum = Number(oldMaxHp[layer]) || maximum;
          const ratio = Math.max(0, Math.min(1, (Number(oldHp[layer]) || 0) / previousMaximum));
          return [layer, Math.round(maximum * ratio)];
        }));
        enemy.hit = template.hit;
        enemy.dodge = template.dodge;
        enemy.baseDamage = template.baseDamage;
      }
    }
    combat.currentEnemy = combat.enemies.find(enemy => !enemy.defeated && enemy.hp && enemy.hp.structure > 0) || null;
    gameState.migrations.combatBeltsV3 = true;
    gameState.migrations.combatBeltsV4 = true;
    gameState._dirty = true;
  }
  delete combat.repair;

  if (gameState.migrations.combatEquipmentV1) return;
  if (!Array.isArray(gameState.equipment.inventory)) gameState.equipment.inventory = [];

  for (const instance of gameState.inventory.ships) {
    const defaults = DEFAULT_COMBAT_FITTINGS[instance.shipId];
    const ship = getShipConfig(instance.shipId);
    if (!defaults || !ship) continue;
    instance.fitted = normalizeFitting(instance.fitted);
    const installed = Object.values(instance.fitted).flat().filter(Boolean).map(id => EQUIPMENT_DB[id]).filter(Boolean);

    const installDefault = (equipmentId) => {
      const equipment = EQUIPMENT_DB[equipmentId];
      if (!equipment) return;
      const slot = equipment.slot;
      const capacity = (ship.slots && ship.slots[slot]) || 0;
      const slots = instance.fitted[slot];
      let index = -1;
      for (let i = 0; i < capacity; i++) {
        if (!slots[i]) { index = i; break; }
      }
      if (index >= 0) slots[index] = equipmentId;
      else gameState.equipment.inventory.push(equipmentId);
    };

    if (!installed.some(item => item.combat && item.combat.kind === "weapon")) {
      for (const equipmentId of defaults.high) installDefault(equipmentId);
    }
    if (!installed.some(item => item.combat && item.combat.kind === "repair")) {
      for (const equipmentId of [...defaults.mid, ...defaults.low]) installDefault(equipmentId);
    }
  }
  gameState.migrations.combatEquipmentV1 = true;
  gameState._dirty = true;
}

function migrateAmmunitionEngineeringState() {
  if (!gameState.skills) gameState.skills = {};
  if (!gameState.skills.equipmentEngineering) gameState.skills.equipmentEngineering = { lvl: 1, xp: 0 };
  const equipmentSkill = gameState.skills.equipmentEngineering;
  const legacySkill = gameState.skills.ammunitionEngineering;
  if (legacySkill) {
    equipmentSkill.lvl = Math.max(equipmentSkill.lvl || 1, legacySkill.lvl || 1);
    equipmentSkill.xp = (equipmentSkill.xp || 0) + (legacySkill.xp || 0);
    while (equipmentSkill.xp >= xpForLevel(equipmentSkill.lvl + 1)) {
      equipmentSkill.xp -= xpForLevel(equipmentSkill.lvl + 1);
      equipmentSkill.lvl++;
    }
    delete gameState.skills.ammunitionEngineering;
  }

  if (gameState.currentAction) {
    if (gameState.currentAction.skill === "ammunitionEngineering") {
      gameState.currentAction.skill = "equipmentEngineering";
      gameState.currentAction.equipEngTarget = gameState.currentAction.ammoEngTarget || "fuel_t1";
    }
    delete gameState.currentAction.ammoEngTarget;

    const action = gameState.currentAction;
    if (action.startedShipCompTarget === undefined || (action.active && action.skill === "shipEngineering" && action.shipSubAction === "component" && !action.startedShipCompTarget)) {
      action.startedShipCompTarget = action.active && action.skill === "shipEngineering" && action.shipSubAction === "component" ? action.shipCompTarget : "";
    }
    if (action.startedShipAsmTarget === undefined || (action.active && action.skill === "shipEngineering" && action.shipSubAction === "assembly" && !action.startedShipAsmTarget)) {
      action.startedShipAsmTarget = action.active && action.skill === "shipEngineering" && action.shipSubAction === "assembly" ? action.shipAsmTarget : "";
    }
    if (action.startedEquipEngTarget === undefined || (action.active && action.skill === "equipmentEngineering" && !action.startedEquipEngTarget)) {
      action.startedEquipEngTarget = action.active && action.skill === "equipmentEngineering" ? action.equipEngTarget : "";
    }
  }

  if (gameState.queue && Array.isArray(gameState.queue.items)) {
    for (const item of gameState.queue.items) {
      if (item.skill !== "ammunitionEngineering") continue;
      item.skill = "equipmentEngineering";
      const recipe = AMMO_ENG_RECIPES.find(candidate => candidate.id === item.target || candidate.name === item.target);
      if (recipe) { item.target = recipe.id; item.label = recipe.name; }
    }
  }

  if (gameState.shipAssignments && gameState.shipAssignments.ammunitionEngineering) {
    if (!gameState.shipAssignments.equipmentEngineering) {
      gameState.shipAssignments.equipmentEngineering = gameState.shipAssignments.ammunitionEngineering;
    }
    delete gameState.shipAssignments.ammunitionEngineering;
  }
}

function migrateMoonMiningState() {
  if (!gameState.resources || typeof gameState.resources !== "object") gameState.resources = {};
  if (!gameState.resources.moonOres || typeof gameState.resources.moonOres !== "object") gameState.resources.moonOres = {};
  for (const material of ["镓","铂","铪","锇","钷","铷"]) {
    if (gameState.resources.moonOres[material] === undefined) gameState.resources.moonOres[material] = 0;
  }
  if (!gameState.resources.special || typeof gameState.resources.special !== "object") gameState.resources.special = {};
  if ((gameState.resources.special["铷"] || 0) > 0) gameState.resources.moonOres["铷"] += gameState.resources.special["铷"];
  delete gameState.resources.special["铷"];
  if ((gameState.resources.special["天使联合加密数据"] || 0) > 0) {
    gameState.resources.special["天使初级加密数据"] = (gameState.resources.special["天使初级加密数据"] || 0) + gameState.resources.special["天使联合加密数据"];
  }
  delete gameState.resources.special["天使联合加密数据"];
  for (const material of COMBAT_SPECIAL_MATERIALS) {
    if (gameState.resources.special[material] === undefined) gameState.resources.special[material] = 0;
  }

  if (!gameState.currentAction || typeof gameState.currentAction !== "object") return;
  const action = gameState.currentAction;
  if (!action.normalMiningArea || !MINING_AREAS.some(area => area.name === action.normalMiningArea)) action.normalMiningArea = "凡晶石带";
  if (!action.moonMiningArea || !MOON_MINING_AREAS.some(area => area.name === action.moonMiningArea)) action.moonMiningArea = "镓月岩带";
  const selected = getMiningAreaByName(action.area);
  if (selected) {
    action.miningMode = selected.mode;
    if (selected.mode === "moon") action.moonMiningArea = selected.name;
    else action.normalMiningArea = selected.name;
  } else {
    action.miningMode = action.miningMode === "moon" ? "moon" : "normal";
    action.area = action.miningMode === "moon" ? action.moonMiningArea : action.normalMiningArea;
  }
}

function migrateDeathspaceState() {
  if (!gameState.combat || typeof gameState.combat !== "object") return;
  if (gameState.combat.mode !== "deathspace") gameState.combat.mode = "belt";
  const savedTier = [2,3,4,6].includes(Number(gameState.combat.deathspaceTier)) ? Number(gameState.combat.deathspaceTier) : null;
  if (!DEATHSPACE_DATABASE.some(site => site.id === gameState.combat.deathspaceId)) {
    gameState.combat.deathspaceId = (DEATHSPACE_DATABASE.find(site => site.dedTier === savedTier) || DEATHSPACE_DATABASE[0]).id;
  }
  const selectedSite = DEATHSPACE_DATABASE.find(site => site.id === gameState.combat.deathspaceId) || DEATHSPACE_DATABASE[0];
  gameState.combat.deathspaceTier = selectedSite.dedTier;
  if (gameState.combat.viewMode !== "belt" && gameState.combat.viewMode !== "deathspace") gameState.combat.viewMode = gameState.combat.mode;
  if (!DEATHSPACE_DATABASE.some(site => site.id === gameState.combat.viewDeathspaceId)) gameState.combat.viewDeathspaceId = selectedSite.id;
  const viewedSite = DEATHSPACE_DATABASE.find(site => site.id === gameState.combat.viewDeathspaceId) || selectedSite;
  gameState.combat.viewDeathspaceTier = viewedSite.dedTier;
  if (!gameState.combat.deathspaceClears || typeof gameState.combat.deathspaceClears !== "object") gameState.combat.deathspaceClears = {};
  if (typeof gameState.combat.lastSpecialLoot !== "string") gameState.combat.lastSpecialLoot = "";
}

const SaveManager = {
  adapter: LocalStorageAdapter,
  save() { gameState.lastSaveTime = Date.now(); gameState._dirty = false; const ok = this.adapter.save(gameState); this._updateStatus(ok ? "已保存 " + new Date().toLocaleTimeString() : "保存失败"); document.getElementById("footer-save") && (document.getElementById("footer-save").textContent = "存档：" + new Date().toLocaleTimeString()); return ok; },
  load() { const data = this.adapter.load(); if (data) { gameState.statistics = Object.hasOwn(data, "statistics") ? data.statistics : null; Object.assign(gameState, data); if (!Object.hasOwn(data, "settings")) gameState.settings = {}; ensureUserSettingsState(gameState); ensureStatisticsState(gameState); gameState._dirty = false; return true; } return false; },
  exportData() { const json = this.adapter.export(gameState); const blob = new Blob([json], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "EVE_Save.json"; a.click(); URL.revokeObjectURL(url); this._updateStatus("存档已导出"); },
  importData(jsonString) { try { const data = this.adapter.import(jsonString); if (!data || !data.skills) throw new Error("无效存档"); gameState.statistics = Object.hasOwn(data, "statistics") ? data.statistics : null; Object.assign(gameState, data); if (!Object.hasOwn(data, "settings")) gameState.settings = {}; ensureUserSettingsState(gameState); ensureStatisticsState(gameState); if (!data.migrations || !data.migrations.combatEquipmentV1) { if (!gameState.migrations) gameState.migrations = {}; delete gameState.migrations.combatEquipmentV1; } migrateAmmunitionEngineeringState(); migrateMoonMiningState(); migrateDeathspaceState(); migrateShipAndEquipmentState(); migrateShipComponentState(); migrateCombatEquipmentState(); gameState._dirty = false; gameState.currentAction.progress = 0; gameState.currentAction.lastProgressUpdate = Date.now(); window.gameState = gameState; currentPage = "skill"; switchPage("skill"); this._updateStatus("存档已导入，共 " + JSON.stringify(data).length + " 字节"); updateUI(); return true; } catch (e) { alert("导入失败：存档格式无效"); return false; } },
  setAdapter(newAdapter) { this.adapter = newAdapter; },
  _updateStatus(msg) { const el = document.getElementById("save-status"); if (el) el.textContent = msg; const info = document.getElementById("save-info"); if (info) info.textContent = msg; }
};

setInterval(() => { if (gameState._dirty) SaveManager.save(); }, 5000);
window.addEventListener("beforeunload", () => SaveManager.save());

(function autoLoad() {
  const restored = SaveManager.load();
  if (restored) {
    // 迁移旧版 planetaryDeployments → 新版 planetary.deployments
    if (gameState.planetaryDeployments && !gameState.planetary) {
      gameState.planetary = { deployments: [], nextId: 1 };
    }
    if (!gameState.planetary) gameState.planetary = { deployments: [], nextId: 1 };
    if (!gameState.planetary.deployments) gameState.planetary.deployments = [];
    if (!gameState.planetary.nextId) gameState.planetary.nextId = gameState.planetary.deployments.length + 1;
    // 旧存档迁移：补充 progress 字段
    for (const dep of gameState.planetary.deployments) {
      if (dep.progress === undefined) dep.progress = 0;
    }
    // 旧存档迁移：气体采集技能和配置
    if (!gameState.skills.gasHarvesting) gameState.skills.gasHarvesting = { lvl: 1, xp: 0 };
    // 旧 gunnery 迁移到新拆分技能
    if (gameState.skills.gunnery) {
      gameState.skills.laserOps = gameState.skills.laserOps || { lvl: gameState.skills.gunnery.lvl, xp: gameState.skills.gunnery.xp };
      gameState.skills.cannonOps = gameState.skills.cannonOps || { lvl: gameState.skills.gunnery.lvl, xp: gameState.skills.gunnery.xp };
      delete gameState.skills.gunnery;
    }
    if (!gameState.skills.laserOps) gameState.skills.laserOps = { lvl: 1, xp: 0 };
    if (!gameState.skills.cannonOps) gameState.skills.cannonOps = { lvl: 1, xp: 0 };
    if (!gameState.skills.missileOperations) gameState.skills.missileOperations = { lvl: 1, xp: 0 };
    if (!gameState.skills.piloting) gameState.skills.piloting = { lvl: 1, xp: 0 };
    if (!gameState.skills.combat) gameState.skills.combat = { lvl: 1, xp: 0 };
    // 清理废弃技能
    delete gameState.skills.electronicWarfare;
    delete gameState.skills.gunnery;
    if (!gameState.resources.gases) gameState.resources.gases = {};
    migrateMoonMiningState();
    if (gameState.resources.fuel === undefined) gameState.resources.fuel = 1000;
    if (!gameState.resources.ammunition || typeof gameState.resources.ammunition !== "object" || !gameState.resources.ammunition.laser) gameState.resources.ammunition = { laser: 500, missile: 500, cannon: 500 };
    if (!gameState.currentAction.gasArea) gameState.currentAction.gasArea = "富勒烯云团";
    // 旧存档迁移：舰船工程字段
    if (!gameState.resources.shipComponents) gameState.resources.shipComponents = {};
    if (!gameState.ownedBlueprints) gameState.ownedBlueprints = [];
    if (!gameState.currentAction.shipSubAction) gameState.currentAction.shipSubAction = "component";
    if (!gameState.currentAction.shipCompTarget) gameState.currentAction.shipCompTarget = "integrated_hull";
    if (gameState.currentAction.startedShipCompTarget === undefined) gameState.currentAction.startedShipCompTarget = "";
    if (!gameState.currentAction.shipAsmTarget) gameState.currentAction.shipAsmTarget = "rifter";
    if (gameState.currentAction.startedShipAsmTarget === undefined) gameState.currentAction.startedShipAsmTarget = "";
    if (gameState.currentAction.batchRemaining === undefined) gameState.currentAction.batchRemaining = 0;
    if (!gameState.queue) gameState.queue = { items: [], config: { maxSize: 20, loopMode: false, skipOnFail: true }, status: { activeIndex: -1, isRunning: false, completedCount: 0, failCount: 0 } };
    if (!gameState.inventory.ships) gameState.inventory.ships = [];
    if (gameState.inventory.ships.length === 0) gameState.inventory.ships.push(createShipInstance("rifter"));
    if (gameState.activeIndustrialShip === undefined) gameState.activeIndustrialShip = null;
    if (!gameState.shipAssignments) gameState.shipAssignments = {};
    if (!gameState.equipment) gameState.equipment = { inventory:[] };
    if (!gameState.currentAction.equipEngTarget) gameState.currentAction.equipEngTarget = "t1_mining_laser";
    if (!EQUIPMENT_ENGINEERING_CATEGORIES.some(category => category.id === gameState.currentAction.equipEngCategory)) {
      gameState.currentAction.equipEngCategory = getEquipmentEngineeringRecipe(gameState.currentAction.equipEngTarget).category || "industry";
    }
    if (gameState.currentAction.startedEquipEngTarget === undefined) gameState.currentAction.startedEquipEngTarget = "";
    // 20260711 迁移：赠送冲锋者级工业舰
    if (!gameState.inventory.ships.some(s => s.shipId === "miner_frigate")) gameState.inventory.ships.push(createShipInstance("miner_frigate"));
    // 战斗系统迁移
    if (!gameState.combat) gameState.combat = {
      zone: "angel_outpost", weapon: "laser",
      hp: { shield: 300, armor: 100, structure: 100 },
      maxHp: { shield: 300, armor: 100, structure: 100 },
      repair: { shieldBooster: true, armorRepairer: true, structureRepairer: false },
      enemies: [], currentEnemy: null, wave: 1, zoneClears: {}, runEliteKills: 0,
      currentFormation: "", totalKills: 0, active: false
    };
    if (gameState.combat.repairUntil === undefined) gameState.combat.repairUntil = 0;
    if (gameState.combat.destroyedShip === undefined) gameState.combat.destroyedShip = null;
    if (gameState.combat.lastStatus === undefined) gameState.combat.lastStatus = "";
    migrateDeathspaceState();
    // 测试用：旧存档 ISK 过低时补充启动资金
    if (!gameState.resources.isk || gameState.resources.isk < 10000) gameState.resources.isk = 1000000;
    migrateAmmunitionEngineeringState();
    // 旧舰船部件必须先迁移，再结算离线制造；否则旧配方目标会被错误地回退到新配方首项。
    migrateShipAndEquipmentState();
    migrateShipComponentState();
    gameState.currentAction.progress = 0;
    gameState.currentAction.lastProgressUpdate = Date.now();
    gameState.currentAction.startTime = Date.now();
    SaveManager._updateStatus("存档已恢复");
    calculateOfflineGains();
  }
  migrateAmmunitionEngineeringState();
  migrateMoonMiningState();
  migrateDeathspaceState();
  migrateShipAndEquipmentState();
  migrateShipComponentState();
  migrateCombatEquipmentState();
  ensureUserSettingsState(gameState);
  ensureStatisticsState(gameState);
  // 清理旧字段
  delete gameState.planetaryDeployments;
})();

(function bindSaveEvents() {
  const btnSave = document.getElementById("btn-save-game"), btnExport = document.getElementById("btn-export-save"),
        btnImport = document.getElementById("btn-import-save"), fileInput = document.getElementById("import-file-input");
  if (btnSave) btnSave.addEventListener("click", () => SaveManager.save());
  if (btnExport) btnExport.addEventListener("click", () => SaveManager.exportData());
  if (btnImport) btnImport.addEventListener("click", () => fileInput && fileInput.click());
  if (fileInput) fileInput.addEventListener("change", (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { SaveManager.importData(ev.target.result); fileInput.value = ""; }; reader.readAsText(file); });
})();

document.addEventListener("visibilitychange", () => { if (!document.hidden) calculateOfflineGains(); });

// 战斗按钮事件
(function bindCombatButtons() {
})();

console.log("🚀 EVE放置：新伊甸纪元 已就绪");
console.log("💡 调试命令：forceOfflineTest(60) — 模拟离线 60 秒");
console.log("🪐 行星系统已加载 — 点击侧边栏「行星概览」查看");
console.log("⚔ 战斗系统已加载 — 点击侧边栏「战斗」出击");
