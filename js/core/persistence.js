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
  const activeAssignment = gameState.currentAction && gameState.currentAction.active ? gameState.currentAction.skill : null;
  const assignmentOrder = [...new Set([activeAssignment, "combat", ...Object.keys(gameState.shipAssignments)].filter(Boolean))];
  const assignedInstances = new Set();
  for (const actionKey of assignmentOrder) {
    const instanceId = gameState.shipAssignments[actionKey];
    if (!instanceId) continue;
    const ship = getShipInstance(instanceId);
    const config = ship ? getShipConfig(ship.shipId) : null;
    const unsupportedAssignment = getShipAssignmentRestriction(config, actionKey, false);
    if (unsupportedAssignment || assignedInstances.has(instanceId)) delete gameState.shipAssignments[actionKey];
    else assignedInstances.add(instanceId);
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
    // 兼容旧 itemId 字符串与新 eq_* 实例引用：统一经 resolveEquipmentReference 解析出装备定义。
    const installed = Object.values(instance.fitted).flat().filter(Boolean)
      .map(ref => resolveEquipmentReference(gameState, ref))
      .filter(Boolean)
      .map(resolved => resolved.definition);

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

// 确定性分配唯一装备实例 ID（不使用 Date.now / 随机，保证存档往返一致）。
function allocateEquipmentInstanceId(state) {
  if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];
  if (!Number.isFinite(Number(state.equipment.nextInstanceId))) state.equipment.nextInstanceId = 1;
  let instanceId;
  let guard = 0;
  do {
    instanceId = "eq_" + state.equipment.nextInstanceId;
    state.equipment.nextInstanceId = (Number(state.equipment.nextInstanceId) || 0) + 1;
    guard++;
  } while (state.equipment.instances.some(instance => instance.instanceId === instanceId) && guard < 100000);
  return instanceId;
}

// 一次性迁移：将舰船 fitted 中的装备字符串（itemId）转换为装备实例 instanceId（双池）。
// 关键：fitted 中的 itemId 本身就代表一件已安装的装备，不得从 inventory 删除同型号备用件。
function migrateEquipmentInstancesV1(state) {
  if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
  if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];
  if (state.migrations && state.migrations.equipmentInstancesV1) return;
  const ships = state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  for (const shipInstance of ships) {
    if (!shipInstance || !shipInstance.fitted) { if (shipInstance) shipInstance.fitted = { high:[], mid:[], low:[], rig:[] }; continue; }
    for (const slot of ["high", "mid", "low", "rig"]) {
      if (!Array.isArray(shipInstance.fitted[slot])) shipInstance.fitted[slot] = [];
      for (let i = 0; i < shipInstance.fitted[slot].length; i++) {
        const ref = shipInstance.fitted[slot][i];
        if (!ref) continue;
        if (isEquipmentInstanceId(state, ref)) continue; // 已是实例
        const equipmentId = ref; // 旧式字符串：这件装备本身就代表已安装的那一件
        if (!EQUIPMENT_DB[equipmentId]) { shipInstance.fitted[slot][i] = null; continue; } // 非法引用清空
        // 直接为 fitted 所代表的装备创建实例，不查询、不 splice inventory
        const instanceId = allocateEquipmentInstanceId(state);
        state.equipment.instances.push({ instanceId, itemId:equipmentId, enhancementLevel:0, installedOn:shipInstance.instanceId });
        shipInstance.fitted[slot][i] = instanceId;
      }
    }
  }
  state.migrations = state.migrations || {};
  state.migrations.equipmentInstancesV1 = true;
  state._dirty = true;
}

// 每次读档的规范化修复（幂等）：重建 installedOn、补全/去重/清理实例与库存、绝不静默删除合法实例。
function normalizeEquipmentState(state) {
  if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
  if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];
  if (!Number.isFinite(Number(state.equipment.nextInstanceId))) state.equipment.nextInstanceId = 1;

  const ships = state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];

  // Pre-pass：将 numeric instanceId 统一为 eq_N 字符串（兼容旧存档数字 ID 与浏览器 data-* 字符串化）
  const numericIdMap = new Map();
  for (const inst of state.equipment.instances) {
    if (typeof inst.instanceId === "number") {
      const newId = allocateEquipmentInstanceId(state);
      numericIdMap.set(inst.instanceId, newId);
      inst.instanceId = newId;
    }
  }
  for (const ship of ships) {
    for (const slot of ["high", "mid", "low", "rig"]) {
      if (!Array.isArray(ship.fitted[slot])) continue;
      for (let i = 0; i < ship.fitted[slot].length; i++) {
        const ref = ship.fitted[slot][i];
        if (typeof ref === "number" && numericIdMap.has(ref)) {
          ship.fitted[slot][i] = numericIdMap.get(ref);
        }
      }
    }
  }

  // 第一遍：遍历 fitted，收集所有被引用的 instanceId，并将旧式字符串转为实例。
  // 对重复引用同一 instanceId 的多槽位：只保留第一次引用，后续清空（不得凭空复制已安装装备）。
  const referencedInstanceIds = new Set();
  const seenFittedInstanceIds = new Set();
  const referencedByShip = new Map();

  for (const shipInstance of ships) {
    if (!shipInstance) continue;
    if (!shipInstance.fitted) shipInstance.fitted = { high:[], mid:[], low:[], rig:[] };
    for (const slot of ["high", "mid", "low", "rig"]) {
      if (!Array.isArray(shipInstance.fitted[slot])) shipInstance.fitted[slot] = [];
      for (let i = 0; i < shipInstance.fitted[slot].length; i++) {
        const ref = shipInstance.fitted[slot][i];
        if (!ref) continue;
        if (isEquipmentInstanceId(state, ref)) {
          if (seenFittedInstanceIds.has(ref)) {
            // 同一 instanceId 被多个槽位引用：只保留第一个，其余清空（不复制已安装装备）
            shipInstance.fitted[slot][i] = null;
            continue;
          }
          seenFittedInstanceIds.add(ref);
          referencedInstanceIds.add(ref);
          referencedByShip.set(ref, shipInstance.instanceId);
          continue;
        }
        const equipmentId = ref; // 旧式字符串
        if (!EQUIPMENT_DB[equipmentId]) { shipInstance.fitted[slot][i] = null; continue; } // 非法引用清空
        // 为 fitted 中的旧式字符串创建实例（不消耗 inventory）
        const instanceId = allocateEquipmentInstanceId(state);
        state.equipment.instances.push({ instanceId, itemId:equipmentId, enhancementLevel:0, installedOn:shipInstance.instanceId });
        shipInstance.fitted[slot][i] = instanceId;
        seenFittedInstanceIds.add(instanceId);
        referencedInstanceIds.add(instanceId);
        referencedByShip.set(instanceId, shipInstance.instanceId);
      }
    }
  }

  // 第二遍：处理实例列表——修复缺失/重复 ID，绝不静默删除合法 itemId 的实例。
  const validInstances = [];
  const takenIds = new Set(referencedInstanceIds); // 已被 fitted 引用的 ID 先占位

  for (const inst of state.equipment.instances) {
    if (!inst || typeof inst !== "object") continue;
    if (!EQUIPMENT_DB[inst.itemId]) continue; // 非法 itemId 的实例才允许移除（边界：无法恢复的非法对象）
    // 改装件防复制：rig 实例只应在被 fitted 引用时存在。未被引用的游离 rig 实例（拆卸即销毁的语义下不应产生，
    // 仅可能来自损坏/篡改存档）一律丢弃——不归还、不保留，杜绝免费再装配的复制漏洞。
    if (EQUIPMENT_DB[inst.itemId].slot === "rig" && !referencedInstanceIds.has(inst.instanceId)) continue;

    let finalId = inst.instanceId;

    if (!finalId) {
      // 缺少 instanceId：分配新 ID
      finalId = allocateEquipmentInstanceId(state);
    } else if (takenIds.has(finalId) && !referencedInstanceIds.has(finalId)) {
      // ID 与已引用的实例重复，但当前实例不是被引用的那个：重新分配
      finalId = allocateEquipmentInstanceId(state);
    } else if (takenIds.has(finalId) && referencedInstanceIds.has(finalId)) {
      // 这个实例是被 fitted 引用的，保留原 ID
      // 但如果 takenIds 已被之前的实例占用（同一 ID 的第一个实例），则需要重新分配
      // 通过 referencedInstanceIds 判断：如果已在 validInstances 中用过了这个 ID，则重新分配
      const alreadyUsed = validInstances.some(v => v.instanceId === finalId);
      if (alreadyUsed) {
        finalId = allocateEquipmentInstanceId(state);
      }
    }

    takenIds.add(finalId);
    validInstances.push({
      instanceId: finalId,
      itemId: inst.itemId,
      enhancementLevel: Math.max(0, Math.floor(Number(inst.enhancementLevel) || 0)),
      installedOn: referencedInstanceIds.has(finalId) ? (referencedByShip.get(finalId) || null) : null
    });
  }

  state.equipment.instances = validInstances;

  // 清理 inventory：只保留合法的 itemId 字符串
  state.equipment.inventory = state.equipment.inventory.filter(id => typeof id === "string" && Boolean(EQUIPMENT_DB[id]));

  // 修复 nextInstanceId：确保大于所有现有 eq_N
  for (const inst of state.equipment.instances) {
    const num = Number(String(inst.instanceId).replace(/^eq_/, ""));
    if (Number.isFinite(num) && num >= state.equipment.nextInstanceId) state.equipment.nextInstanceId = num + 1;
  }
  state._dirty = true;
}

// 考古系统状态迁移（幂等）：确保技能、资源池、考古状态、舰船分配齐全并清理遗留锁。
function migrateArchaeologyState() {
  if (!gameState.skills) gameState.skills = {};
  if (!gameState.skills.archaeology) gameState.skills.archaeology = { lvl: 1, xp: 0 };
  if (!gameState.resources) gameState.resources = {};
  for (const pool of ["probes", "artifacts", "calibrations"]) {
    if (!gameState.resources[pool] || typeof gameState.resources[pool] !== "object") gameState.resources[pool] = {};
  }
  if (!gameState.archaeology || typeof gameState.archaeology !== "object") {
    gameState.archaeology = { activeSiteId:null, activeProbeId:"core_probe_i", progress:0, startedSiteId:null, startedProbeId:null, shipHp:{}, repairUntil:0, repairInstanceId:null, interferenceUntil:0, fuelSavingRemainder:0, log:[] };
  }
  const arch = gameState.archaeology;
  arch.activeSiteId = arch.activeSiteId || null;
  arch.activeProbeId = (typeof getArchaeologyProbe === "function" && getArchaeologyProbe(arch.activeProbeId)) ? arch.activeProbeId : "core_probe_i";
  arch.startedSiteId = arch.startedSiteId || null;
  arch.startedProbeId = arch.startedProbeId || null;
  arch.shipHp = arch.shipHp && typeof arch.shipHp === "object" ? arch.shipHp : {};
  arch.repairUntil = Number(arch.repairUntil) || 0;
  arch.repairInstanceId = arch.repairInstanceId || null;
  arch.log = Array.isArray(arch.log) ? arch.log : [];
  arch.interferenceUntil = Number(arch.interferenceUntil) || 0;
  // 燃料节省累计器：旧存档回填 0；恒有限并归一化到 [0,1)（幂等）。
  // 仅在完整重置游戏时清零；停止行动/切遗迹/切船/装卸改装件都不清零，故放在 currentAction 复位块之外。
  {
    const rawRem = Number(arch.fuelSavingRemainder);
    arch.fuelSavingRemainder = (Number.isFinite(rawRem) && rawRem > 0) ? (rawRem - Math.floor(rawRem)) : 0;
  }
  if (!gameState.currentAction || gameState.currentAction.skill !== "archaeology") {
    arch.startedSiteId = null; arch.startedProbeId = null; arch.interferenceUntil = 0;
  }
  if (!gameState.shipAssignments) gameState.shipAssignments = {};
  const aId = gameState.shipAssignments.archaeology;
  if (aId) {
    const inst = getShipInstanceFromState(gameState, aId);
    const cfg = inst ? getShipConfigById(inst.shipId) : null;
    if (!cfg || !ARCHAEOLOGY_SHIP_TYPES.includes(cfg.type)) delete gameState.shipAssignments.archaeology;
  }
  gameState._dirty = true;
}

// 共享收尾：在所有旧版迁移完成后，执行装备实例迁移与规范化。
// 调用顺序必须为：migrateShipAndEquipmentState → migrateShipComponentState → migrateCombatEquipmentState →
//                migrateEquipmentInstancesV1 → normalizeEquipmentState → migrateArchaeologyState
// 自动读档、新游戏初始化、手动导入三条路径都必须执行此函数。
function finalizeEquipmentStateAfterLegacyMigrations(state) {
  migrateShipAndEquipmentState();
  migrateShipComponentState();
  migrateCombatEquipmentState();
  migrateEquipmentInstancesV1(state);
  normalizeEquipmentState(state);
  migrateArchaeologyState();
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
  gameState.combat.targetingMode = normalizeCapitalTargetingMode(gameState.combat.targetingMode);
}

// ================================================================
//  增强剂系统 Phase 2A 幂等迁移（autoLoad 与 importData 共用）
//   - 补齐 boosterEngineering 技能（默认 Lv.1）
//   - 初始化/规范化 gameState.boosters { inventory, active(六槽), lastTick }
//   - 已有合法库存不清空；仅清理 NaN/负数/非整数；六槽在 Phase 2A 恒为 null
//   - currentAction 制造目标字段幂等回填（boosterRecipeTarget/boosterCategory/
//     boosterQualityFilter/startedBoosterRecipeTarget）
//   - 幂等：连续两次调用结果一致
// ================================================================
function migrateBoosterState() {
  if (!gameState.skills || typeof gameState.skills !== "object") gameState.skills = {};
  if (!gameState.skills.boosterEngineering || typeof gameState.skills.boosterEngineering !== "object") {
    gameState.skills.boosterEngineering = { lvl: 1, xp: 0 };
  } else {
    const s = gameState.skills.boosterEngineering;
    if (!Number.isFinite(Number(s.lvl)) || Number(s.lvl) < 1) s.lvl = 1;
    if (!Number.isFinite(Number(s.xp)) || Number(s.xp) < 0) s.xp = 0;
  }
  const SLOTS = (typeof BOOSTER_SLOTS !== "undefined" && Array.isArray(BOOSTER_SLOTS))
    ? BOOSTER_SLOTS
    : ["miningSpeed", "miningYield", "archaeologySpeed", "archaeologyRare", "combatWeapon", "combatRepair"];
  if (!gameState.boosters || typeof gameState.boosters !== "object") {
    gameState.boosters = { inventory: {}, active: {}, lastTick: Date.now() };
  }
  const b = gameState.boosters;
  if (!b.inventory || typeof b.inventory !== "object") b.inventory = {};
  if (!b.active || typeof b.active !== "object") b.active = {};
  // 规范化库存：裸 id 为权威键；旧版 booster: 前缀键就地剥离前缀归一化，
  // 不与裸 id 形成双键；合法正整数保留，NaN/负数/零/非整数丢弃（正常库存不清空）。
  for (const key of Object.keys(b.inventory)) {
    const normKey = (typeof key === "string" && key.startsWith("booster:")) ? key.slice("booster:".length) : key;
    const qty = Math.floor(Number(b.inventory[key]));
    if (!Number.isFinite(qty) || qty <= 0) { delete b.inventory[key]; continue; }
    if (normKey !== key) {
      delete b.inventory[key];                                  // 剥离前缀，避免遗留 booster: 旧键
      const prev = Math.floor(Number(b.inventory[normKey] || 0));
      b.inventory[normKey] = Math.max(qty, prev > 0 ? prev : qty);  // 与可能并存的裸 id 合并取大，不形成双键
    } else {
      b.inventory[key] = qty;
    }
  }
  // 六槽（Phase 2A 恒为 null）：补齐缺失槽位、清空任何遗留值、丢弃非法槽键。
  for (const slot of SLOTS) b.active[slot] = null;
  for (const key of Object.keys(b.active)) { if (!SLOTS.includes(key)) delete b.active[key]; }
  if (!Number.isFinite(Number(b.lastTick)) || Number(b.lastTick) <= 0) b.lastTick = Date.now();
  // currentAction 制造目标字段幂等回填。
  if (gameState.currentAction && typeof gameState.currentAction === "object") {
    const a = gameState.currentAction;
    const recipeValid = (typeof getBoosterRecipe === "function") && getBoosterRecipe(a.boosterRecipeTarget);
    if (!recipeValid) a.boosterRecipeTarget = "mining_lubricant_n";
    const recipe = (typeof getBoosterRecipe === "function") ? getBoosterRecipe(a.boosterRecipeTarget) : null;
    if (!a.boosterCategory && recipe && typeof BOOSTER_SERIES !== "undefined") {
      a.boosterCategory = (BOOSTER_SERIES[recipe.series] || {}).category || "mining";
    }
    if (!a.boosterCategory) a.boosterCategory = "mining";
    if (!["all", "n", "r", "l"].includes(a.boosterQualityFilter)) a.boosterQualityFilter = "all";
    if (a.startedBoosterRecipeTarget === undefined) {
      a.startedBoosterRecipeTarget = (a.active && a.skill === "boosterEngineering") ? a.boosterRecipeTarget : "";
    }
  }
  gameState._dirty = true;
}
window.migrateBoosterState = migrateBoosterState;

// ================================================================
//  行星部署幂等规范化（autoLoad 与 importData 共用）
//  设计：
//   - 旧 planetaryDeployments 容器内容必须完整迁移到 planetary.deployments
//     （不丢弃玩家旧基地、不追收 ISK/三钛、不重复创建、不改 storage/类型/id）
//   - 旧字段 type → planetType（迁移后删除 type）；capacity 旧字段不进入新 deployment（但仍保留 storage）
//   - 安全回填 duration/progress/storage/deployedAt/lastTick（不改动已有有效值）
//   - 字段迁移阶段（finalizeExpiry:false）：保留显式 active 值，绝不因“当前时间超期”提前把 active=true 改成 false
//     （否则离线结算会跳过该部署，丢失最后一段收益）
//   - 最终化阶段（finalizeExpiry:true）：对仍 active 且已超期者置 false（离线结算已先行处理，此处为安全网）
//   - 幂等：连续两次调用结果一致；旧+新容器共存时按 id 去重合并（同 id 优先保留新版）
//  调用约定（与 autoLoad / importData 顺序一致）：
//    normalizePlanetaryState(state, { now, finalizeExpiry:false })  // 字段迁移（读档/导入第一步）
//    ... calculateOfflineGains() ...                                  // 离线结算（在 finalizeExpiry 之前完成）
//    normalizePlanetaryState(state, { now, finalizeExpiry:true })    // 最终化
// ================================================================
function normalizePlanetaryState(state, opts) {
  if (!state || typeof state !== "object") return;
  const options = (opts && typeof opts === "object") ? opts : {};
  const finalizeExpiry = options.finalizeExpiry === true;
  const now = Number(options.now) || Date.now();
  if (!state.planetary || typeof state.planetary !== "object") state.planetary = { deployments:[], nextId:1 };
  if (!Array.isArray(state.planetary.deployments)) state.planetary.deployments = [];
  if (!Number.isFinite(Number(state.planetary.nextId))) state.planetary.nextId = 1;

  // 旧容器 planetaryDeployments → 新容器 planetary.deployments 的内容迁移（去重合并）
  if (state.planetaryDeployments && Array.isArray(state.planetaryDeployments)) {
    const existingIds = new Set(state.planetary.deployments.map(d => d && d.id));
    state.planetaryDeployments.forEach((old, idx) => {
      if (!old || typeof old !== "object") return;
      const planetType = old.planetType !== undefined ? old.planetType : old.type;
      if (planetType === undefined) return; // 无法识别行星类型，跳过（保守）
      const duration = Number(old.duration) > 0 ? Number(old.duration) : 86400;
      const deployedAt = Number(old.deployedAt) > 0 ? Number(old.deployedAt)
        : (Number(old.timeDeployed) > 0 ? Number(old.timeDeployed) : 0);
      if (!(deployedAt > 0)) return; // 无法定位时间，跳过（保守）
      let id = old.id;
      if (id === undefined || id === null || String(id).length === 0) {
        id = "planet_legacy_" + idx; // 稳定 id（按旧数组索引，二次迁移不漂移）
      }
      if (existingIds.has(id)) return; // 同 id 优先保留新版，不重复迁移
      const storage = (Number(old.storage) >= 0 && Number.isFinite(Number(old.storage))) ? Number(old.storage) : 0;
      const progress = (Number(old.progress) >= 0 && Number.isFinite(Number(old.progress))) ? Number(old.progress) : 0;
      const lastTick = Number(old.lastTick) > 0 ? Number(old.lastTick) : deployedAt;
      const timeExpired = (now - deployedAt) / 1000 >= duration;
      const active = old.active === undefined ? !timeExpired : Boolean(old.active);
      state.planetary.deployments.push({
        id, planetType, deployedAt, duration,
        storage, progress, lastTick, active
      });
      existingIds.add(id);
    });
  }

  // 逐部署字段规范化 + active 处理
  let maxPlanetNum = 0;
  for (const dep of state.planetary.deployments) {
    if (!dep || typeof dep !== "object") continue;
    if (dep.planetType === undefined && dep.type !== undefined) dep.planetType = dep.type;
    if (dep.type !== undefined) delete dep.type; // capacity 旧字段不复制；不处理 capacity
    if (dep.planetType === undefined) continue;
    if (!(Number(dep.duration) > 0)) dep.duration = 86400;
    if (dep.progress === undefined || !Number.isFinite(Number(dep.progress)) || Number(dep.progress) < 0) dep.progress = 0;
    if (dep.storage === undefined || !Number.isFinite(Number(dep.storage)) || Number(dep.storage) < 0) dep.storage = 0;
    if (!(Number(dep.deployedAt) > 0)) dep.deployedAt = now;
    if (!(Number(dep.lastTick) > 0)) dep.lastTick = dep.deployedAt; // 安全回填：不产生追溯离线收益
    const timeExpired = (now - Number(dep.deployedAt)) / 1000 >= Number(dep.duration);
    if (dep.active === undefined) dep.active = !timeExpired;
    // 字段迁移阶段不提前关闭 active=true 的部署；最终化阶段再强制过期一致性
    if (finalizeExpiry && dep.active && timeExpired) dep.active = false;
    const match = /planet_(\d+)/.exec(String(dep.id || ""));
    if (match) maxPlanetNum = Math.max(maxPlanetNum, Number(match[1]));
  }
  const nextId = Number(state.planetary.nextId) || 0;
  state.planetary.nextId = Math.max(nextId, maxPlanetNum + 1, 1);
}
window.normalizePlanetaryState = normalizePlanetaryState;

const SaveManager = {
  adapter: LocalStorageAdapter,
  save() { gameState.lastSaveTime = Date.now(); gameState._dirty = false; const ok = this.adapter.save(gameState); this._updateStatus(ok ? "已保存 " + new Date().toLocaleTimeString() : "保存失败"); document.getElementById("footer-save") && (document.getElementById("footer-save").textContent = "存档：" + new Date().toLocaleTimeString()); return ok; },
  load() { const data = this.adapter.load(); if (data) { gameState.statistics = Object.hasOwn(data, "statistics") ? data.statistics : null; Object.assign(gameState, data); if (!Object.hasOwn(data, "settings")) gameState.settings = {}; ensureUserSettingsState(gameState); ensureStatisticsState(gameState); gameState._dirty = false; return true; } return false; },
  exportData() { const json = this.adapter.export(gameState); const blob = new Blob([json], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "EVE_Save.json"; a.click(); URL.revokeObjectURL(url); this._updateStatus("存档已导出"); },
  importData(jsonString) {
    try {
      const data = this.adapter.import(jsonString);
      if (!data || !data.skills) throw new Error("无效存档");
      gameState.statistics = Object.hasOwn(data, "statistics") ? data.statistics : null;
      Object.assign(gameState, data);
      if (!Object.hasOwn(data, "settings")) gameState.settings = {};
      ensureUserSettingsState(gameState);
      ensureStatisticsState(gameState);
      // 装备迁移标志管理：不得无条件删除现代存档已有的迁移标志。
      // 一次性迁移（migrateCombatEquipmentState / migrateEquipmentInstancesV1）各自带有幂等守卫，
      // 仅当存档确实缺少对应标志时才运行；normalizeEquipmentState 每次导入都必须执行。
      if (!gameState.migrations) gameState.migrations = {};
      // 旧版技能/资源迁移
      migrateAmmunitionEngineeringState();
      migrateMoonMiningState();
      migrateDeathspaceState();
      migrateBoosterState();
      // 装备迁移收尾（统一顺序：舰船 → 部件 → 战斗 → 实例化 → 规范化）
      finalizeEquipmentStateAfterLegacyMigrations(gameState);
      // 行星规范化（与 autoLoad 同一路径，幂等）；必须在离线结算之前
      normalizePlanetaryState(gameState);
      delete gameState.planetaryDeployments;
      // 离线结算必须在规范化之后
      if (typeof calculateOfflineGains === "function") calculateOfflineGains();
      // 最终化：离线结算已处理到期，此处仅强制 active 过期一致性（安全网，幂等）
      normalizePlanetaryState(gameState, { finalizeExpiry:true });
      gameState._dirty = false;
      gameState.currentAction.progress = 0;
      gameState.currentAction.lastProgressUpdate = Date.now();
      window.gameState = gameState;
      currentPage = "skill";
      switchPage("skill");
      this._updateStatus("存档已导入，共 " + JSON.stringify(data).length + " 字节");
      updateUI();
      return true;
    } catch (e) {
      alert("导入失败：存档格式无效");
      return false;
    }
  },
  setAdapter(newAdapter) { this.adapter = newAdapter; },
  _updateStatus(msg) { const el = document.getElementById("save-status"); if (el) el.textContent = msg; const info = document.getElementById("save-info"); if (info) info.textContent = msg; }
};
window.SaveManager = SaveManager;

setInterval(() => { if (gameState._dirty) SaveManager.save(); }, 5000);
window.addEventListener("beforeunload", () => SaveManager.save());

(function autoLoad() {
  const restored = SaveManager.load();
  if (restored) {
    // 行星部署幂等规范化（旧 planetaryDeployments 迁移、字段回填、到期规范化、type→planetType）
    normalizePlanetaryState(gameState);
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
  }
  migrateAmmunitionEngineeringState();
  migrateMoonMiningState();
  migrateDeathspaceState();
  migrateBoosterState();
  // 装备迁移收尾（统一顺序：舰船 → 部件 → 战斗 → 实例化 → 规范化）
  finalizeEquipmentStateAfterLegacyMigrations(gameState);
    if (restored) calculateOfflineGains();
  ensureUserSettingsState(gameState);
  ensureStatisticsState(gameState);
  // 最终化：离线结算已处理到期，此处仅强制 active 过期一致性（安全网，幂等）
  normalizePlanetaryState(gameState, { finalizeExpiry:true });
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
