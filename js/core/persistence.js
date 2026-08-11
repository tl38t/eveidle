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
  import(jsonString) { return JSON.parse(jsonString); },
  removeItem() { try { localStorage.removeItem(this._key); return true; } catch (e) { console.warn("删除存档失败：", e); return false; } }
};

// 定点返修：导入存档大小上限（10 MB）。既防超大文件读取，也防 importData 直调。
const MAX_IMPORT_SAVE_BYTES = 10 * 1024 * 1024;

// 定点返修：结构化遍历导入存档，拒绝任意层级的原型链污染键（__proto__/prototype/constructor）。
// 纯只读遍历、不修改输入；必须在 Object.assign(gameState, data) 之前调用。
// 返回 false 的情形：根非普通对象/为数组、或任意层级发现禁止键。
function validateImportedSavePayload(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
  const stack = [data];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) stack.push(node[i]);
      continue;
    }
    const keys = Object.keys(node); // 仅自有可枚举键，不读取继承属性
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (FORBIDDEN.has(k)) return false;
      stack.push(node[k]);
    }
  }
  return true;
}

// 新手任务 Batch O：旧档兜底补给（rifter / miner_frigate / 100 万 ISK）只允许对「老档」生效。
// Batch Q 定点返修：来源标记 SaveManager._lastLoadSourceHadTutorial 收敛为明确三态，
// 判定只看**读档瞬间的原始存档对象**，绝不看当前内存态：
//   - null  → 没有找到任何存档，真正的全新游戏；不补给（起始资产由新手任务链发放）
//   - false → 成功读取了存档，但原始存档没有 tutorial 字段 → 老档（legacy），保留历史兜底，避免老玩家资产被清空
//   - true  → 成功读取了包含 tutorial 字段的现代存档；不补给
// 严禁用 gameState.tutorial 是否存在反推来源：新游戏的默认状态本来就含 tutorial，反推会把全新开局误判成老档。
function isLegacySaveSource() {
  return typeof SaveManager !== "undefined" && SaveManager && SaveManager._lastLoadSourceHadTutorial === false;
}

function migrateShipAndEquipmentState() {
  if (!gameState.inventory) gameState.inventory = { ships: [], equipment: [], rigs: [] };
  if (!Array.isArray(gameState.inventory.ships)) gameState.inventory.ships = [];
  if (isLegacySaveSource() && gameState.inventory.ships.length === 0) gameState.inventory.ships.push(createShipInstance("rifter"));
  ensureShipInstances();

  if (!gameState.equipment || typeof gameState.equipment !== "object") gameState.equipment = { inventory: [] };
  if (!Array.isArray(gameState.equipment.inventory)) gameState.equipment.inventory = [];

  const legacyFitted = gameState.equipment.fitted;
  const legacyItems = legacyFitted ? Object.values(normalizeFitting(legacyFitted)).flat().filter(Boolean) : [];
  if (legacyItems.length > 0 && gameState.inventory.ships.length > 0) {
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
  if (!combat.repairs || typeof combat.repairs !== "object" || Array.isArray(combat.repairs)) combat.repairs = {};
  // 旧字段迁移（幂等）：合法旧存档 destroyedShip + repairUntil → repairs[destroyedShip]。
  // 非法船 ID / 非法时间戳安全丢弃；不延长不缩短合法旧维修时间；迁移后旧字段清零，唯一权威归 repairs。
  const legacyUntil = Number(combat.repairUntil);
  const legacyShip = combat.destroyedShip;
  if (legacyShip && Number.isFinite(legacyUntil) && legacyUntil > 0) {
    const shipExists = gameState.inventory && Array.isArray(gameState.inventory.ships) && gameState.inventory.ships.some(s => s.instanceId === legacyShip);
    if (shipExists && !Object.prototype.hasOwnProperty.call(combat.repairs, legacyShip)) {
      combat.repairs[legacyShip] = legacyUntil;
    }
  }
  // 非法实例 ID（不在舰队中的幽灵条目）与非法时间戳（非有限数 / <=0）一律安全丢弃。
  const ships = (gameState.inventory && Array.isArray(gameState.inventory.ships)) ? gameState.inventory.ships : [];
  const shipExists = (id) => ships.some(s => String(s.instanceId) === String(id));
  for (const id of Object.keys(combat.repairs)) {
    const ts = Number(combat.repairs[id]);
    if (!Number.isFinite(ts) || ts <= 0 || !shipExists(id)) delete combat.repairs[id];
  }
  combat.repairUntil = 0;
  combat.destroyedShip = null;
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
    gameState.archaeology = { activeSiteId:null, activeProbeId:"core_probe_i", progress:0, startedSiteId:null, startedProbeId:null, shipHp:{}, repairUntil:0, repairInstanceId:null, interferenceUntil:0, fuelSavingRemainder:0, probeSavingRemainder:0, log:[] };
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
  // 探针节省累计器（研究批次 G · probe 组）：旧存档回填 0；恒有限并归一化到 [0,1)（幂等）。
  {
    const rawProbeRem = Number(arch.probeSavingRemainder);
    arch.probeSavingRemainder = (Number.isFinite(rawProbeRem) && rawProbeRem > 0) ? (rawProbeRem - Math.floor(rawProbeRem)) : 0;
  }
  // 考古重做：按舰船实例隔离的维修态（repairsByInstanceId）。
  // 幂等：旧存档回填 {}；若存在仍生效的旧全局维修（repairUntil>now 且绑定实例），
  // 转移进按舰表并清零全局残留，避免重复触发；已迁移过的二次运行因 repairUntil=0 自然跳过。
  arch.repairsByInstanceId = (arch.repairsByInstanceId && typeof arch.repairsByInstanceId === "object") ? arch.repairsByInstanceId : {};
  {
    const legacyUntil = Number(arch.repairUntil) || 0;
    const legacyInstance = arch.repairInstanceId || null;
    if (legacyUntil > 0 && legacyInstance && !arch.repairsByInstanceId[legacyInstance]) {
      const legacyResume = (gameState.resumeAfterRepair && gameState.resumeAfterRepair.type === "archaeology")
        ? gameState.resumeAfterRepair
        : null;
      arch.repairsByInstanceId[legacyInstance] = {
        until: legacyUntil,
        resume: {
          siteId: legacyResume ? (legacyResume.siteId || arch.startedSiteId) : arch.startedSiteId,
          probeId: legacyResume ? (legacyResume.probeId || arch.startedProbeId) : arch.startedProbeId,
          focusId: legacyResume ? (legacyResume.focusId || null) : null
        }
      };
      arch.repairUntil = 0;
      arch.repairInstanceId = null;
    }
  }
  if (!gameState.currentAction || gameState.currentAction.skill !== "archaeology") {
    arch.startedSiteId = null; arch.startedProbeId = null; arch.interferenceUntil = 0;
  }
  if (!gameState.shipAssignments) gameState.shipAssignments = {};
  const aId = gameState.shipAssignments.archaeology;
  if (aId) {
    const inst = getShipInstanceFromState(gameState, aId);
    const cfg = inst ? getShipConfigById(inst.shipId) : null;
    // 考古判据统一为「能力优先」：仅当该舰无考古扫描能力时才清掉考古分配（避免启程级等被误删）。
    if (!cfg || !cfg.bonuses || !((cfg.bonuses.archaeologyScanStrength || 0) > 0)) delete gameState.shipAssignments.archaeology;
  }
  // 维修后自动恢复（Phase 3D 修正）幂等迁移：旧存档回填 null；结构非法一律归 null（fail-closed）。
  // 战斗标记严格校验：returnZoneId 必须是合法 COMBAT_ZONES；defeatedMode 仅允许 belt/deathspace；
  // deathspace 模式必须携带合法 deathspaceId。任何一项不满足即 fail-closed 为 null。
  // 旧结构（含 zoneId/mode 字段的 3D 初版标记）缺少 returnZoneId，自然被判非法归零。
  {
    const r = gameState.resumeAfterRepair;
    if (r === undefined || r === null) {
      gameState.resumeAfterRepair = null;
    } else if (r && typeof r === "object" && r.type === "combat") {
      const zoneOk = (typeof COMBAT_ZONES !== "undefined") && COMBAT_ZONES.some(z => z.id === r.returnZoneId);
      const modeOk = r.defeatedMode === "belt" || r.defeatedMode === "deathspace";
      const dsOk = r.defeatedMode === "deathspace"
        ? ((typeof DEATHSPACE_DATABASE !== "undefined") && DEATHSPACE_DATABASE.some(d => d.id === r.deathspaceId))
        : true;
      if (!zoneOk || !modeOk || !dsOk) gameState.resumeAfterRepair = null;
    } else if (!(r && typeof r === "object" && r.type === "archaeology")) {
      gameState.resumeAfterRepair = null;
    }
  }
  // 凭证迁移（考古重做定点返修）：旧档 state.vouchers 布尔账本 → special:voucher_<id> 资源。
  // 兼容临时结构，不补发、不 emit；仅当确有可迁移凭证时才置脏（否则不 dirty）。
  if (gameState.vouchers && typeof gameState.vouchers === "object") {
    for (const vid of Object.keys(gameState.vouchers)) {
      if (gameState.vouchers[vid] && typeof vid === "string" && vid.indexOf("voucher_") === 0) {
        if (typeof ResourceRegistry !== "undefined") ResourceRegistry.add(gameState, "special:" + vid, 1);
        gameState._dirty = true;
      }
    }
    delete gameState.vouchers;
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
  migrateDeadSkillFields();
  migrateImplants();
}

// 移除 rigEngineering / reverseEngineering 两个死字段（仅声明 + 成就占位，
// 无制造/tick/UI 读取，且已确认不计入生产技能）。
// - 不影响任何功能（这两个字段永远 lvl:1，无 XP 来源）
// - 顺带修复 A46(全部技能Lv.50)/A48(全部技能Lv.99) 原本因死字段永远无法达成的问题
// - 幂等：连续两次调用结果一致
// - 必须在其他 skills 迁移之后运行，故注册在 finalize 主链末端
function migrateDeadSkillFields() {
  if (!gameState.skills) return;
  if (gameState.skills.rigEngineering) delete gameState.skills.rigEngineering;
  if (gameState.skills.reverseEngineering) delete gameState.skills.reverseEngineering;
  gameState._dirty = true;
}

// 脑插系统初始化与旧档补发：
// - 确保 state.implants 为对象（旧档缺失时）
// - 技能早已满 99 级但当时无脑插系统，按 IMPLANT_BY_SKILL 映射补发（幂等）
// - 注册在 finalize 主链末端（skills 迁移之后，rigEngineering/reverseEngineering 已清除）
function migrateImplants() {
  if (!gameState) return;
  if (!gameState.implants || typeof gameState.implants !== "object") gameState.implants = {};
  if (typeof reconcileImplantsFromSkills === "function") reconcileImplantsFromSkills(gameState);
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

  if (!gameState.stationCoresObtained || typeof gameState.stationCoresObtained !== "object") gameState.stationCoresObtained = {};
  for (const coreId of ["smelt", "shipEng", "equipEng", "booster"]) {
    if (gameState.stationCoresObtained[coreId] !== true) gameState.stationCoresObtained[coreId] = false;
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

// Batch R：确定性 RNG 状态迁移辅助（与 combat.js 的 nextCombatRandom 共用同一 JSON 安全结构）。
// 严格清洗三 uint32；非法（缺失/类型错/越界）整体重建；不使用固定常量 seed、不读取 Date.now。
function isUint32(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF && Number.isSafeInteger(v);
}

// 稳定摘要：仅取存档中稳定的战斗相关字段，保证「连续两次迁移 JSON 严格一致」。
// 不同旧档因 cleared/isk/lp/totalKills 等内容不同 → 派生 seed 不同 → 序列不同。
function stableCombatDigest(combat, state) {
  const resources = (state && state.resources) || {};
  const subset = {
    z: combat.zone,
    d: combat.deathspaceId,
    dc: combat.deathspaceClears,
    zc: combat.zoneClears,
    dt: combat.deathspaceTier,
    vd: combat.viewDeathspaceId,
    isk: resources.isk || 0,
    lp: resources.lp || 0,
    tk: combat.totalKills || 0
  };
  const str = JSON.stringify(subset);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function createDefaultCombatRandomState(combat, state) {
  return { seed: stableCombatDigest(combat, state) >>> 0, counterLo: 0, counterHi: 0 };
}

function migrateCombatRandomState(combat, state) {
  const rs = combat.randomState;
  if (rs && isUint32(rs.seed) && isUint32(rs.counterLo) && isUint32(rs.counterHi)) return; // 已合法：保留（保证二次迁移一致）
  combat.randomState = createDefaultCombatRandomState(combat, state);
}

function migrateDeathspaceState(combat, state) {
  combat = combat || (typeof gameState !== "undefined" ? gameState.combat : null);
  state = state || (typeof gameState !== "undefined" ? gameState : null);
  if (!combat || typeof combat !== "object") return;
  if (combat.mode !== "deathspace") combat.mode = "belt";
  // 原始 deathspaceId 合法性（供 pending 规则使用，避免被下方的修复逻辑掩盖）
  const originalDeathspaceIdValid = DEATHSPACE_DATABASE.some(site => site.id === combat.deathspaceId);
  const savedTier = [2,3,4,6].includes(Number(combat.deathspaceTier)) ? Number(combat.deathspaceTier) : null;
  if (!originalDeathspaceIdValid) {
    combat.deathspaceId = (DEATHSPACE_DATABASE.find(site => site.dedTier === savedTier) || DEATHSPACE_DATABASE[0]).id;
  }
  const selectedSite = DEATHSPACE_DATABASE.find(site => site.id === combat.deathspaceId) || DEATHSPACE_DATABASE[0];
  combat.deathspaceTier = selectedSite.dedTier;
  if (combat.viewMode !== "belt" && combat.viewMode !== "deathspace") combat.viewMode = combat.mode;
  if (!DEATHSPACE_DATABASE.some(site => site.id === combat.viewDeathspaceId)) combat.viewDeathspaceId = selectedSite.id;
  const viewedSite = DEATHSPACE_DATABASE.find(site => site.id === combat.viewDeathspaceId) || selectedSite;
  combat.viewDeathspaceTier = viewedSite.dedTier;
  if (!combat.deathspaceClears || typeof combat.deathspaceClears !== "object") combat.deathspaceClears = {};
  // Batch R：严格化死亡空间连刷数量——仅整数 0–98 合法，否则归零（覆盖小数/负数/NaN/Infinity/越界/字符串）。
  const remaining = combat.deathspaceChainRemaining;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || !Number.isInteger(remaining) || remaining < 0 || remaining > 98) {
    combat.deathspaceChainRemaining = 0;
  }
  // Batch R：pending 仅当「原值严格 true 且 remaining>0 且（原始）deathspaceId 合法」才保留，否则 false。
  const pendingRaw = combat.deathspaceChainPending;
  if (!(pendingRaw === true && combat.deathspaceChainRemaining > 0 && originalDeathspaceIdValid)) {
    combat.deathspaceChainPending = false;
  }
  // Batch R：确定性 RNG 状态严格清洗。
  migrateCombatRandomState(combat, state);
  // Batch R：runToken 仅非空字符串保留，否则 null。
  if (typeof combat.runToken !== "string" || combat.runToken.length === 0) {
    combat.runToken = null;
  }
  // Batch R：enemyInstanceSeq 仅非负安全整数保留，否则 0。
  const seq = combat.enemyInstanceSeq;
  if (typeof seq !== "number" || !Number.isFinite(seq) || !Number.isInteger(seq) || seq < 0 || !Number.isSafeInteger(seq)) {
    combat.enemyInstanceSeq = 0;
  }
  // Batch R：runSequence 仅非负安全整数保留，否则 0（并入 runToken，保证新 run 永不重复）。
  const rs = combat.runSequence;
  if (typeof rs !== "number" || !Number.isFinite(rs) || !Number.isInteger(rs) || rs < 0 || !Number.isSafeInteger(rs)) {
    combat.runSequence = 0;
  }
  if (typeof combat.lastSpecialLoot !== "string") combat.lastSpecialLoot = "";
  combat.targetingMode = normalizeCapitalTargetingMode(combat.targetingMode);
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
  // 六槽（Phase 2B）：保留合法 {itemId,remainingMs}；非法项清空，不赠送或退还瓶子。
  // itemId 统一为裸 ID，remainingMs 必须有限 >0，item 必须存在且 slot 与当前槽一致。
  for (const slot of SLOTS) {
    const entry = b.active[slot];
    if (!entry) continue; // null 已合法，保留
    if (typeof entry !== "object") { b.active[slot] = null; continue; }
    // itemId 归一化（booster: 前缀 → 裸 id）
    let rawId = entry.itemId;
    if (typeof rawId === "string" && rawId.startsWith("booster:")) rawId = rawId.slice("booster:".length);
    const item = (typeof getBoosterItem === "function") ? getBoosterItem(rawId) : null;
    if (!item || item.slot !== slot) { b.active[slot] = null; continue; }
    const remainingMs = Number(entry.remainingMs);
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) { b.active[slot] = null; continue; }
    // 存储完整 itemId（含 booster: 前缀），供 ResourceRegistry 寻址
    b.active[slot] = { itemId:item.itemId, remainingMs };
  }
  // 补齐缺失的槽为 null
  for (const slot of SLOTS) {
    if (b.active[slot] === undefined) b.active[slot] = null;
  }
  // 丢弃非法槽键
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
//  无限库存迁移（Phase 无限容量）：删除仓库容量限制
//   - 删除旧 skills.cargoManagement
//   - 删除 queue.items 中 skill==="cargoManagement" 的旧项目
//   - 若 currentAction.skill==="cargoManagement"，安全停止并切换到 mining
//   - 清理 queue.status 使 activeIndex 合法
//   - 不补偿 XP，不赠送或扣除资源
//   - 不改变舰船、装备、蓝图、资源、其他技能、空间站和行星数据
//   - 幂等：连续两次调用结果一致
//   - 必须在 calculateOfflineGains 前运行
// ================================================================
function migrateUnlimitedInventoryState(state = gameState) {
  if (!state) return;
  // 1) 删除旧技能
  if (state.skills && state.skills.cargoManagement) {
    delete state.skills.cargoManagement;
  }
  // 2) 删除队列中 cargoManagement 项目
  if (state.queue && Array.isArray(state.queue.items)) {
    state.queue.items = state.queue.items.filter(item => item.skill !== "cargoManagement");
    // 清理 queue.status：空队列归零首项，activeIndex 不得越界
    if (state.queue.status) {
      if (state.queue.items.length === 0) {
        state.queue.status.activeIndex = -1;
        state.queue.status.isRunning = false;
      } else if (state.queue.status.activeIndex >= state.queue.items.length) {
        state.queue.status.activeIndex = 0;
      }
    }
  }
  // 3) 若当前行动为 cargoManagement，安全停止并切换到 mining
  if (state.currentAction && state.currentAction.skill === "cargoManagement") {
    state.currentAction.active = false;
    state.currentAction.skill = "mining";
    state.currentAction.progress = 0;
    state.currentAction.batchRemaining = 0;
    state.currentAction.lastProgressUpdate = Date.now();
  }
  state._dirty = true;
}
window.migrateUnlimitedInventoryState = migrateUnlimitedInventoryState;

// ================================================================
//  军团与空间站系统 Phase 3C-1：存档外壳 + 幂等迁移
//   - 补齐 station / corporation 最小结构（不触碰玩家舰船/装备/资源/技能/蓝图）
//   - 旧存档无 station → 初始化空壳（bodyLevel 0、buildings 全 0、maintenance 默认）
//   - bodyLevel / buildings[id] 为 NaN/负数/越界 → 归 0
//   - buildings 含未知 ID → 丢弃
//   - construction.cost 未支付 → 不补偿、不重复扣；仅保留 paid===true 的合法结构
//   - 幂等：连续两次调用结果一致
//  迁移契约见策划文档第八节 8.2（A 区审计：tools/audit-station-migration.mjs）
// ================================================================
function createDefaultStation() {
  return {
    version: 1,
    bodyLevel: 0,
    construction: null,
    buildings: Object.fromEntries(STATION_BUILDING_IDS.map(id => [id, 0])),
    dispatch: { miningCount: 0, gasCount: 0 },
    maintenance: { fuelRemaining: 0, lastTick: 0, lowFuelNotified: false, depletedNotified: false },
    autoLines: {
      smelting:    { enabled:false, operatorId:null, selectedTargetId:null, startedTargetId:null, progress:0, lastTick:0, stoppedReason:null },
      equipment:   { enabled:false, operatorId:null, selectedTargetId:null, startedTargetId:null, progress:0, lastTick:0, stoppedReason:null },
      booster:     { enabled:false, operatorId:null, selectedTargetId:null, startedTargetId:null, progress:0, lastTick:0, stoppedReason:null }
    },
    shipyard: { unlockedFlagship:false, unlockedSupercapital:false, savingsLedger:{} },
    dlc: { npcWorkers:false, combatWings:false }
  };
}

function createDefaultCorporation() {
  return {
    version: 1,
    name: "",
    foundedAt: 0,
    dlc: { npcWorkers:false, combatWings:false }
  };
}

// construction 合法性判定（迁移契约，见策划第八节 8.2 + Phase 3C-2 建设队列结构）：
//  - paid !== true → 非法（未支付一律清除、不补偿、不重复扣）
//  - 新结构（Phase 3C-2 起）：kind/targetLevel/startedAt/completesAt/durationMs
//      · kind 必须为 body/building；targetLevel 1~3；时间戳损坏（completesAt<=startedAt/NaN）→ 非法清除
//  - 旧结构（Phase 3C-1 遗留）：type/level（兼容保留，供旧存档与 A 区迁移审计不放宽）
function isValidPaidConstruction(c) {
  if (!c || typeof c !== "object" || c.paid !== true) return false;
  // 新结构：kind 语义（三级本体建设队列）
  if (typeof c.kind === "string") {
    if (c.kind !== "body" && c.kind !== "building") return false;
    const targetLevel = Math.floor(Number(c.targetLevel));
    if (!Number.isFinite(targetLevel) || targetLevel < 1 || targetLevel > 3) return false;
    const startedAt = Number(c.startedAt);
    const completesAt = Number(c.completesAt);
    const durationMs = Number(c.durationMs);
    if (!Number.isFinite(startedAt) || startedAt < 0) return false;
    if (!Number.isFinite(completesAt) || completesAt <= startedAt) return false;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
    return true;
  }
  // 旧结构：type/level（Phase 3C-1 遗留兼容）
  if (typeof c.type === "string") {
    if (c.type !== "body" && c.type !== "building") return false;
    const lvl = Math.floor(Number(c.level));
    if (!Number.isFinite(lvl) || lvl < 1) return false;
    return true;
  }
  return false;
}
window.isValidPaidConstruction = isValidPaidConstruction;

function normalizeStationState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.station || typeof state.station !== "object") {
    state.station = createDefaultStation();
  }
  const s = state.station;
  if (!Number.isFinite(Number(s.version)) || Number(s.version) < 1) s.version = 1;

  // bodyLevel：越界/NaN/负数 → 0（合法范围 0~3）
  const bl = Math.floor(Number(s.bodyLevel));
  s.bodyLevel = (Number.isFinite(bl) && bl >= 0 && bl <= 3) ? bl : 0;

  // buildings：仅保留已知 ID，越界/NaN → 0，未知 ID → 丢弃
  const cleaned = {};
  const rawBuildings = (s.buildings && typeof s.buildings === "object") ? s.buildings : {};
  for (const id of STATION_BUILDING_IDS) {
    const lvl = Math.floor(Number(rawBuildings[id]));
    cleaned[id] = (Number.isFinite(lvl) && lvl >= 0 && lvl <= 3) ? lvl : 0;
  }
  s.buildings = cleaned;

  // construction：仅保留 paid===true 的合法结构；否则清空（不补偿、不重复扣、幂等）
  s.construction = isValidPaidConstruction(s.construction) ? s.construction : null;

  // maintenance：通用燃料（周期消耗，断油停效）
  // fuelRemaining fail-closed：NaN / 负数 / Infinity / 非法值一律归 0（Infinity 会绕过 `||0`，必须显式 isFinite 守卫）
  if (!s.maintenance || typeof s.maintenance !== "object") s.maintenance = {};
  const rawFuel = Number(s.maintenance.fuelRemaining);
  s.maintenance.fuelRemaining = (Number.isFinite(rawFuel) && rawFuel > 0) ? rawFuel : 0;
  s.maintenance.lastTick = Number.isFinite(Number(s.maintenance.lastTick)) ? Number(s.maintenance.lastTick) : 0;
  s.maintenance.lowFuelNotified = Boolean(s.maintenance.lowFuelNotified);
  s.maintenance.depletedNotified = Boolean(s.maintenance.depletedNotified);

  // autoLines：三条自动线，operatorId 仅允许 null（首版恒 null）
  // selectedTargetId/startedTargetId: null 或字符串
  // progress: 有限非负; lastTick: 有限; stoppedReason: null 或字符串
  if (!s.autoLines || typeof s.autoLines !== "object") s.autoLines = {};
  for (const key of ["smelting", "equipment", "booster"]) {
    if (!s.autoLines[key] || typeof s.autoLines[key] !== "object") s.autoLines[key] = {};
    s.autoLines[key].enabled = Boolean(s.autoLines[key].enabled);
    s.autoLines[key].operatorId = null; // Phase 3C 首版无 NPC 操作员
    const rawSel = s.autoLines[key].selectedTargetId;
    s.autoLines[key].selectedTargetId = (rawSel === null || typeof rawSel === "string") ? rawSel : null;
    const rawStart = s.autoLines[key].startedTargetId;
    s.autoLines[key].startedTargetId = (rawStart === null || typeof rawStart === "string") ? rawStart : null;
    const rawProg = Number(s.autoLines[key].progress);
    s.autoLines[key].progress = (Number.isFinite(rawProg) && rawProg > 0) ? rawProg : 0;
    s.autoLines[key].lastTick = Number.isFinite(Number(s.autoLines[key].lastTick)) ? Number(s.autoLines[key].lastTick) : 0;
    const rawStop = s.autoLines[key].stoppedReason;
    s.autoLines[key].stoppedReason = (rawStop === null || typeof rawStop === "string") ? rawStop : null;
  }

  // shipyard：材料节省余数，限制在 [0,1)；只保留合法资源 key
  if (!s.shipyard || typeof s.shipyard !== "object") s.shipyard = {};
  s.shipyard.unlockedFlagship = Boolean(s.shipyard.unlockedFlagship);
  s.shipyard.unlockedSupercapital = Boolean(s.shipyard.unlockedSupercapital);
  if (!s.shipyard.savingsLedger || typeof s.shipyard.savingsLedger !== "object") s.shipyard.savingsLedger = {};
  for (const [key, val] of Object.entries(s.shipyard.savingsLedger)) {
    // 只保留可规范化的资源 key（必须是命名空间:资源名 或 component:xxx 格式）
    const isValidKey = typeof key === "string" && key.length > 0 && (
      key.startsWith("component:") || key.startsWith("mineral:") ||
      key.startsWith("planetary:") || key.startsWith("moon:") ||
      key.startsWith("gas:") || key.startsWith("special:") ||
      key.startsWith("ore:") || key.startsWith("consumable:")
    );
    if (!isValidKey) { delete s.shipyard.savingsLedger[key]; continue; }
    const n = Number(val);
    s.shipyard.savingsLedger[key] = Number.isFinite(n) ? Math.max(0, Math.min(0.999999, n)) : 0;
  }

  // dlc 接口占位（首版恒 false）
  if (!s.dlc || typeof s.dlc !== "object") s.dlc = {};
  s.dlc.npcWorkers = Boolean(s.dlc.npcWorkers);
  s.dlc.combatWings = Boolean(s.dlc.combatWings);

  // dispatch：资源调度中心勘探指令计数器（miningCount / gasCount 非负整数，缺省归零）
  if (!s.dispatch || typeof s.dispatch !== "object") s.dispatch = {};
  const rawMining = Number(s.dispatch.miningCount);
  const rawGas = Number(s.dispatch.gasCount);
  s.dispatch.miningCount = (Number.isFinite(rawMining) && rawMining > 0) ? Math.floor(rawMining) : 0;
  s.dispatch.gasCount = (Number.isFinite(rawGas) && rawGas > 0) ? Math.floor(rawGas) : 0;

  state._dirty = true;
}

function normalizeCorporationState(state) {
  if (!state || typeof state !== "object") return;
  if (!state.corporation || typeof state.corporation !== "object") {
    state.corporation = createDefaultCorporation();
  }
  const c = state.corporation;
  if (!Number.isFinite(Number(c.version)) || Number(c.version) < 1) c.version = 1;
  if (typeof c.name !== "string") c.name = "";
  c.foundedAt = Number.isFinite(Number(c.foundedAt)) ? Number(c.foundedAt) : 0;
  if (!c.dlc || typeof c.dlc !== "object") c.dlc = {};
  c.dlc.npcWorkers = Boolean(c.dlc.npcWorkers);
  c.dlc.combatWings = Boolean(c.dlc.combatWings);
  state._dirty = true;
}

function migrateStationCorporationState() {
  normalizeStationState(gameState);
  normalizeCorporationState(gameState);
}
window.normalizeStationState = normalizeStationState;
window.normalizeCorporationState = normalizeCorporationState;
window.migrateStationCorporationState = migrateStationCorporationState;

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

// Batch C-14A 第一次定点返修：唯一幂等队列规范化函数。
// - queue 缺失/null/数组/非对象：创建完整默认队列。
// - items 非数组：归一为 []（不丢弃合法内容，只修正类型）。
// - config 非普通对象：归一为空对象后补默认字段。
// - config.maxSize：typeof number && 有限 && >=25 → Math.floor 保留；其余统一设为 25（含 20 等旧档容量，J05 才可解锁）；已有 >25 的合法容量不得缩小。
// - loopMode / skipOnFail 缺失或类型错误时补现有默认值。
// - status 缺失时补默认结构；不得清空合法旧队列项目。
// 新游戏路径安全、幂等；旧档 maxSize=20 登录/导入后变为 25，可继续真实追加 21–25 项。
function normalizeQueueState(state) {
  if (!state.queue || typeof state.queue !== "object" || Array.isArray(state.queue)) {
    state.queue = {
      items: [],
      config: { maxSize: 25, loopMode: false, skipOnFail: true },
      status: { activeIndex: -1, isRunning: false, completedCount: 0, failCount: 0 },
    };
    return;
  }
  if (!Array.isArray(state.queue.items)) state.queue.items = [];
  if (!state.queue.config || typeof state.queue.config !== "object" || Array.isArray(state.queue.config)) {
    state.queue.config = {};
  }
  const ms = state.queue.config.maxSize;
  if (typeof ms === "number" && Number.isFinite(ms) && ms >= 25) {
    state.queue.config.maxSize = Math.floor(ms);
  } else {
    state.queue.config.maxSize = 25;
  }
  if (typeof state.queue.config.loopMode !== "boolean") state.queue.config.loopMode = false;
  if (typeof state.queue.config.skipOnFail !== "boolean") state.queue.config.skipOnFail = true;
  if (!state.queue.status || typeof state.queue.status !== "object" || Array.isArray(state.queue.status)) {
    state.queue.status = { activeIndex: -1, isRunning: false, completedCount: 0, failCount: 0 };
  } else {
    if (typeof state.queue.status.activeIndex !== "number") state.queue.status.activeIndex = -1;
    if (typeof state.queue.status.isRunning !== "boolean") state.queue.status.isRunning = false;
    if (typeof state.queue.status.completedCount !== "number") state.queue.status.completedCount = 0;
    if (typeof state.queue.status.failCount !== "number") state.queue.status.failCount = 0;
  }
}
window.normalizeQueueState = normalizeQueueState;

const SaveManager = {
  adapter: LocalStorageAdapter,
  _pendingDelete: false,
  _importTransaction: false,
  save() {
    // 定点返修 P1-A：删除事务 / 导入事务挂起时禁止写盘，避免污染或回滚竞态。
    if (this._pendingDelete || this._importTransaction) return false;
    // 先保留原始 lastSaveTime；写入候选时间后再真正落盘，只有落盘成功才确认。
    // 失败（返回 false 或抛异常）时还原时间戳、保持 _dirty=true，让 5s 自动保存下一次重试。
    const prevLastSaveTime = gameState.lastSaveTime;
    const candidateSaveTime = Date.now();
    gameState.lastSaveTime = candidateSaveTime;
    let ok = false;
    try { ok = this.adapter.save(gameState); } catch (e) { ok = false; }
    if (ok) {
      gameState._dirty = false;
      this._updateStatus("已保存 " + new Date(candidateSaveTime).toLocaleTimeString());
      const footer = document.getElementById("footer-save");
      if (footer) footer.textContent = "存档：" + new Date(candidateSaveTime).toLocaleTimeString();
      return true;
    }
    // 落盘失败：还原时间戳、保持 dirty、明确失败提示；footer 绝不伪造成功。
    gameState.lastSaveTime = prevLastSaveTime;
    gameState._dirty = true;
    this._updateStatus("保存失败，将自动重试");
    const footer = document.getElementById("footer-save");
    if (footer) footer.textContent = "存档：保存失败";
    return false;
  },
  // 新手任务 Batch O：sourceHadTutorial 必须在 Object.assign 之前、对**原始存档对象**判定，
  // 用于区分「老档（无 tutorial 字段）」与「现代档（已带 tutorial）」。判定结果挂在 SaveManager 上，
  // 供 autoLoad 决定 legacy 迁移与旧档兜底补给是否生效。
  // Batch Q 定点返修：三态语义见 isLegacySaveSource() 注释。默认 null＝尚未读到任何存档（真正的全新游戏），
  // 绝不能默认 false——false 表示「确实读到了一份没有 tutorial 字段的老档」，会让全新开局被误判并补发 rifter。
  _lastLoadSourceHadTutorial: null,
  load() { const data = this.adapter.load(); if (data) { this._lastLoadSourceHadTutorial = Object.prototype.hasOwnProperty.call(data, "tutorial"); gameState.statistics = Object.hasOwn(data, "statistics") ? data.statistics : null; Object.assign(gameState, data); if (!Object.hasOwn(data, "settings")) gameState.settings = {}; normalizeQueueState(gameState); ensureUserSettingsState(gameState); ensureStatisticsState(gameState); gameState._dirty = false; return true; } this._lastLoadSourceHadTutorial = null; return false; },
  exportData() { const json = this.adapter.export(gameState); const blob = new Blob([json], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "DeepSpaceIdle_Save.json"; a.click(); URL.revokeObjectURL(url); this._updateStatus("存档已导出"); },
  importData(jsonString) {
    // 定点返修：直接调用入口防御（与文件选择器 file.size 双重守卫）。
    // 命中即返回 false，不进入事务、不快照、不触碰 gameState / 本地存档。
    if (typeof jsonString !== "string" || jsonString.length > MAX_IMPORT_SAVE_BYTES) { alert("导入失败：存档格式无效"); return false; }
    // 定点返修 P1-B：导入原子化。导入前对当前内存态与来源标记做快照，
    // 全程挂起内部 SaveManager.save（含 calculateOfflineGains 内部的落盘调用），
    // 仅在全部迁移/对账/离线/规范化/UI 切换成功后做唯一一次最终落盘。
    // 任意异常或最终落盘失败 → 就地还原导入前 gameState、还原来源标记、释放事务标志、
    // 保留本地原存档、返回 false。
    const preImportSnapshot = createSerializableGameStateSnapshot(gameState);
    const preImportSourceHadTutorial = this._lastLoadSourceHadTutorial;
    this._importTransaction = true;
    try {
      const data = this.adapter.import(jsonString);
      if (!data || !data.skills) throw new Error("无效存档");
      // 定点返修：结构遍历拒绝原型链污染键，必须在 Object.assign 之前执行。
      if (!validateImportedSavePayload(data)) throw new Error("无效存档");
      // 新手任务 Batch O：必须在 Object.assign 之前对**原始存档对象**判定 tutorial 字段是否存在。
      const sourceHadTutorial = Object.prototype.hasOwnProperty.call(data, "tutorial");
      this._lastLoadSourceHadTutorial = sourceHadTutorial;
      gameState.statistics = Object.hasOwn(data, "statistics") ? data.statistics : null;
      Object.assign(gameState, data);
      if (!Object.hasOwn(data, "settings")) gameState.settings = {};
      normalizeQueueState(gameState);
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
      // 军团与空间站系统 Phase 3C-1：station/corporation 外壳幂等迁移
      migrateStationCorporationState();
      // 无限库存迁移：必须在离线结算之前
      migrateUnlimitedInventoryState();
      // 行星规范化（与 autoLoad 同一路径，幂等）；必须在离线结算之前
      normalizePlanetaryState(gameState);
      delete gameState.planetaryDeployments;
      // 研究系统迁移（批次 B）：补全 research 子状态 + planetary deployment 自动续费。
      // 必须在 deployments 已存在之后调用（migratePlanAutoRenew 依赖 planetary.deployments）。
      if (typeof ResearchState !== "undefined" && ResearchState && typeof ResearchState.migrateResearchState === "function") {
        ResearchState.migrateResearchState(gameState);
      }
      // 成就系统迁移（Batch B）：importData 唯一调用点，恰好一次。
      // 顺序：normalizePlanetaryState → research 迁移 → achievement 迁移 → calculateOfflineGains，
      // 必须早于离线结算（为后续离线成就事件接入留下正确顺序）。迁移不 dirty、不 emit。
      if (typeof AchievementState !== "undefined" && AchievementState && typeof AchievementState.migrateAchievementState === "function") {
        AchievementState.migrateAchievementState(gameState);
      }
      // 成就追溯对账（Batch C-1 技能 + Batch C-2 生产 + Batch C-3 战斗 + Batch C-4 制造）：importData 唯一调用点，
      // 各恰好一次。在 achievement 迁移之后、离线结算之前；
      // 四次求值复用同一个 now（本次导入只取一次 Date.now()）。
      {
        const achievementReconcileNow = Date.now();
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateSkillAchievementRules === "function") {
          AchievementSystem.evaluateSkillAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateProductionAchievementRules === "function") {
          AchievementSystem.evaluateProductionAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateCombatAchievementRules === "function") {
          AchievementSystem.evaluateCombatAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateManufacturingAchievementRules === "function") {
          AchievementSystem.evaluateManufacturingAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateEquipmentAchievementRules === "function") {
          AchievementSystem.evaluateEquipmentAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateBoosterAchievementRules === "function") {
          AchievementSystem.evaluateBoosterAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateArchaeologyAchievementRules === "function") {
          AchievementSystem.evaluateArchaeologyAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluatePlanetaryAchievementRules === "function") {
          AchievementSystem.evaluatePlanetaryAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateStationAchievementRules === "function") {
          AchievementSystem.evaluateStationAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateBlueprintAchievementRules === "function") {
          AchievementSystem.evaluateBlueprintAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch C-13：经济追溯必须在离线结算**之前**，用同一 achievementReconcileNow，
        // 使解锁时间戳落在"读档瞬间"而非离线补偿之后；persistence.js 排在 resources.js 之后，
        // 此处 ResourceRegistry 必然已就绪。
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateEconomyAchievementRules === "function") {
          AchievementSystem.evaluateEconomyAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch C-14A：综合（J01–J06）追溯必须同样在离线结算**之前**，用同一 achievementReconcileNow。
        // 若放到 calculateOfflineGains 之后，本次读档触发的离线结算会先把 lifecycle 推高，
        // 导致"迁移追溯"与"本次离线收益"混为一谈，解锁时间戳也会偏移到离线补偿之后。
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateGeneralAchievementRules === "function") {
          AchievementSystem.evaluateGeneralAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch C-14B：元成就（J10/J11/J12）追溯必须排在全部普通类追溯**之后**、
        // 离线结算**之前**，复用同一 achievementReconcileNow：
        // 先让普通成就在本次读档补齐，元成就才能看到完整的解锁事实并顺序补齐 J10→J11→J12。
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateMetaAchievementRules === "function") {
          AchievementSystem.evaluateMetaAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch E：成就科研工时奖励旧档对账，必须排在**全部**成就追溯（含元成就）之后、
        // 离线结算之前，复用同一 achievementReconcileNow，且整段读档流程只调用一次。
        // 只为「已解锁但账本无记录」的成就补发；已发放过的一律跳过（幂等，重复读档不重复发）。
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.reconcileAchievementResearchRewards === "function") {
          AchievementSystem.reconcileAchievementResearchRewards(gameState, achievementReconcileNow);
        }
      }
      // Batch K：intship 一体化造船运行期恢复——必须在研究迁移之后、离线结算之前；
      // active 作业重装幂等消费者，shape 不匹配或不再驱动 currentAction 时 fail closed 为 recovery-required。
      if (typeof restoreIntshipProtocolRuntime === "function") restoreIntshipProtocolRuntime(gameState);
      // 新手任务 Batch O：与 autoLoad 对称——tutorial 迁移 + 消费者装载 + 对账，必须在离线结算之前。
      if (typeof TutorialSystem !== "undefined" && TutorialSystem && typeof TutorialSystem.bootstrap === "function") {
        TutorialSystem.bootstrap(gameState, { isLegacy: sourceHadTutorial !== true, now: Date.now() });
      }
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
      // 全流程成功：先释放事务标志，再做唯一一次最终落盘（此前所有内部 save 均被 _importTransaction 抑制）。
      this._importTransaction = false;
      if (!this.save()) throw new Error("导入后落盘失败");
      return true;
    } catch (e) {
      // 异常安全回滚：就地还原导入前内存态与来源标记，释放事务标志，保留本地原存档。
      try {
        restoreSerializableGameStateSnapshot(gameState, preImportSnapshot);
        this._lastLoadSourceHadTutorial = preImportSourceHadTutorial;
      } catch (rollbackErr) { /* 回滚自身异常安全：尽量还原，忽略回滚错误 */ }
      this._importTransaction = false;
      alert("导入失败：存档格式无效");
      return false;
    }
  },
  setAdapter(newAdapter) { this.adapter = newAdapter; },
  // 删除存档：在「存档管理」页通过带警告的二次确认弹窗调用，确认后清空本地存档并重启到全新开局。
  deleteSave() {
    // 标记待删除：阻止紧随 reload 的 beforeunload 自动保存把内存态重新写回 localStorage。
    this._pendingDelete = true;
    // Batch Q 定点返修：来源标记必须立刻回到 null，删档后重开不得沿用上一次的 legacy/modern 判定。
    const prevMarker = this._lastLoadSourceHadTutorial;
    this._lastLoadSourceHadTutorial = null;
    // 真正落盘移除，检查 removeItem 真实返回值：成功才重启；失败则回滚标志、保留存档、提示、不重启。
    let removed = false;
    try { removed = this.adapter.removeItem(this.adapter._key); } catch (e) { removed = false; }
    if (!removed) {
      this._pendingDelete = false;
      this._lastLoadSourceHadTutorial = prevMarker;
      this._updateStatus("删除失败，存档仍保留");
      return false;
    }
    this._updateStatus("存档已删除，正在重启…");
    setTimeout(() => { try { location.reload(); } catch (e) {} }, 120);
    return true;
  },
  // 暗金风格的二次确认弹窗（动态创建，不写入 index.html 静态结构，避免新增静态 DOM ID）。
  confirmDeleteSave() {
    if (this._deleteModalOpen) return;
    this._deleteModalOpen = true;
    const backdrop = document.createElement("div");
    backdrop.className = "dlg-backdrop";
    const box = document.createElement("div");
    box.className = "dlg-box dlg-danger";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "删除存档确认");
    box.innerHTML =
      '<div class="dlg-title">⚠ 删除存档</div>' +
      '<p class="dlg-body">此操作<strong>不可恢复</strong>，将永久清空本地存档中的全部进度——包括所有舰船、资源、技能、蓝图与新手指引进度。</p>' +
      '<p class="dlg-body dlg-warn">删除后游戏将回到全新开局（序章重新可玩）。请确认是否删除。</p>' +
      '<div class="dlg-actions">' +
        '<button type="button" class="btn dlg-cancel">取消</button>' +
        '<button type="button" class="btn btn-danger dlg-confirm">确认删除</button>' +
      '</div>';
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    const close = () => { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); this._deleteModalOpen = false; };
    box.querySelector(".dlg-cancel").addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    const confirmBtn = box.querySelector(".dlg-confirm");
    confirmBtn.addEventListener("click", () => { this._deleteModalOpen = false; this.deleteSave(); });
    if (confirmBtn && typeof confirmBtn.focus === "function") confirmBtn.focus();
  },
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
    if (typeof migrateLegacyAmmunition === "function") migrateLegacyAmmunition(gameState);
    if (!gameState.currentAction.gasArea) gameState.currentAction.gasArea = "富勒烯云团";
    // 旧存档迁移：舰船工程字段
    if (!gameState.resources.shipComponents) gameState.resources.shipComponents = {};
    if (!gameState.ownedBlueprints) gameState.ownedBlueprints = [];
    if (!gameState.currentAction.shipSubAction) gameState.currentAction.shipSubAction = "component";
    if (!gameState.currentAction.shipCompTarget) gameState.currentAction.shipCompTarget = "integrated_hull";
    if (gameState.currentAction.startedShipCompTarget === undefined) gameState.currentAction.startedShipCompTarget = "";
    if (!gameState.currentAction.shipAsmTarget) gameState.currentAction.shipAsmTarget = "rifter";
    if (gameState.currentAction.startedShipAsmTarget === undefined) gameState.currentAction.startedShipAsmTarget = "";
    // 舰船工程 UI 重做（2026-08-04）：旧存档补齐 UI 视图状态字段
    if (!gameState.currentAction.shipEngSubView) gameState.currentAction.shipEngSubView = "component";
    if (!gameState.currentAction.shipCompClass) gameState.currentAction.shipCompClass = "integrated";
    if (!gameState.currentAction.shipAsmLine) gameState.currentAction.shipAsmLine = "shield_laser";
    if (gameState.currentAction.shipAsmPage === undefined) gameState.currentAction.shipAsmPage = 0;
    if (gameState.currentAction.batchRemaining === undefined) gameState.currentAction.batchRemaining = 0;
    // Batch C-14A（J05）：队列规范化已收口于 SaveManager.load 内的 normalizeQueueState（含旧档 maxSize=20→25），
    // 此处不再保留只处理「!gameState.queue」的第二套兜底。
    if (!gameState.inventory.ships) gameState.inventory.ships = [];
    // 新手任务 Batch O：仅老档（原始存档无 tutorial 字段）保留兜底赠舰
    if (isLegacySaveSource() && gameState.inventory.ships.length === 0) gameState.inventory.ships.push(createShipInstance("rifter"));
    if (gameState.activeIndustrialShip === undefined) gameState.activeIndustrialShip = null;
    if (!gameState.shipAssignments) gameState.shipAssignments = {};
    if (!gameState.equipment) gameState.equipment = { inventory:[] };
    if (!gameState.currentAction.equipEngTarget) gameState.currentAction.equipEngTarget = "t1_mining_laser";
    if (!EQUIPMENT_ENGINEERING_CATEGORIES.some(category => category.id === gameState.currentAction.equipEngCategory)) {
      gameState.currentAction.equipEngCategory = getEquipmentEngineeringRecipe(gameState.currentAction.equipEngTarget).category || "mining";
    }
    if (gameState.currentAction.startedEquipEngTarget === undefined) gameState.currentAction.startedEquipEngTarget = "";
    // 20260711 迁移：赠送冲锋者级工业舰（新手任务 Batch O：仅老档生效，新档由 I7 任务发放）
    if (isLegacySaveSource() && !gameState.inventory.ships.some(s => s.shipId === "miner_frigate")) gameState.inventory.ships.push(createShipInstance("miner_frigate"));
    // 战斗系统迁移
    if (!gameState.combat) gameState.combat = {
      zone: "angel_outpost", weapon: "laser",
      hp: { shield: 300, armor: 100, structure: 100 },
      maxHp: { shield: 300, armor: 100, structure: 100 },
      repair: { shieldBooster: true, armorRepairer: true, structureRepairer: false },
      enemies: [], currentEnemy: null, wave: 1, zoneClears: {}, runEliteKills: 0,
      currentFormation: "", totalKills: 0, active: false
    };
    if (!gameState.combat.repairs || typeof gameState.combat.repairs !== "object" || Array.isArray(gameState.combat.repairs)) gameState.combat.repairs = {};
    if (gameState.combat.repairUntil === undefined) gameState.combat.repairUntil = 0;
    if (gameState.combat.destroyedShip === undefined) gameState.combat.destroyedShip = null;
    if (gameState.combat.lastStatus === undefined) gameState.combat.lastStatus = "";
    migrateDeathspaceState();
    // 测试用：旧存档 ISK 过低时补充启动资金（新手任务 Batch O：仅老档生效，新档保持 10000 起步）
    if (isLegacySaveSource() && (!gameState.resources.isk || gameState.resources.isk < 10000)) gameState.resources.isk = 1000000;
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
  // 无限库存迁移：必须在离线结算之前
  migrateUnlimitedInventoryState();
  // 装备迁移收尾（统一顺序：舰船 → 部件 → 战斗 → 实例化 → 规范化）
  finalizeEquipmentStateAfterLegacyMigrations(gameState);
  // 研究系统迁移（批次 B 返修）：唯一权威调用点，必须先于第一次 calculateOfflineGains。
  // 此时 planetary.deployments 已存在（restored 由 normalizePlanetaryState 创建，新游戏为 state.js 字面量），
  // migratePlanAutoRenew 可安全补 deployment.autoRenew。restored=false（新游戏）同样执行且幂等、不报错。
  if (typeof ResearchState !== "undefined" && ResearchState && typeof ResearchState.migrateResearchState === "function") {
    ResearchState.migrateResearchState(gameState);
  }
  // 成就系统迁移（Batch B）：autoLoad 唯一调用点，恰好一次；
  // restored=true / restored=false（新游戏）都执行且幂等、安全。
  // 顺序：research 迁移 → achievement 迁移 → restored 时 calculateOfflineGains，
  // 必须早于离线结算。迁移不 dirty、不 emit。
  if (typeof AchievementState !== "undefined" && AchievementState && typeof AchievementState.migrateAchievementState === "function") {
    AchievementState.migrateAchievementState(gameState);
  }
  // 成就追溯对账（Batch C-1 技能 + Batch C-2 生产 + Batch C-3 战斗 + Batch C-4 制造）：autoLoad 唯一调用点，
  // 各恰好一次；restored=true 与 restored=false（新游戏，应解锁 0 项）都执行；
  // 早于离线结算；四次求值复用同一个 now（本次登录只取一次 Date.now()）。
  {
    const achievementReconcileNow = Date.now();
    if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateSkillAchievementRules === "function") {
      AchievementSystem.evaluateSkillAchievementRules(gameState, achievementReconcileNow);
    }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateProductionAchievementRules === "function") {
          AchievementSystem.evaluateProductionAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateCombatAchievementRules === "function") {
          AchievementSystem.evaluateCombatAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateManufacturingAchievementRules === "function") {
          AchievementSystem.evaluateManufacturingAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateEquipmentAchievementRules === "function") {
          AchievementSystem.evaluateEquipmentAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateBoosterAchievementRules === "function") {
          AchievementSystem.evaluateBoosterAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateArchaeologyAchievementRules === "function") {
          AchievementSystem.evaluateArchaeologyAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluatePlanetaryAchievementRules === "function") {
          AchievementSystem.evaluatePlanetaryAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateStationAchievementRules === "function") {
          AchievementSystem.evaluateStationAchievementRules(gameState, achievementReconcileNow);
        }
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateBlueprintAchievementRules === "function") {
          AchievementSystem.evaluateBlueprintAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch C-13：经济追溯，同一 achievementReconcileNow，位于离线结算之前（与 importData 对称）
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateEconomyAchievementRules === "function") {
          AchievementSystem.evaluateEconomyAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch C-14A：综合（J01–J06）追溯，同一 achievementReconcileNow，位于离线结算之前（与 importData 对称）
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateGeneralAchievementRules === "function") {
          AchievementSystem.evaluateGeneralAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch C-14B：元成就（J10/J11/J12）追溯，排在全部普通类追溯之后、离线结算之前，
        // 同一 achievementReconcileNow（与 importData 对称）。
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.evaluateMetaAchievementRules === "function") {
          AchievementSystem.evaluateMetaAchievementRules(gameState, achievementReconcileNow);
        }
        // Batch E：成就科研工时奖励旧档对账，排在全部成就追溯之后、离线结算之前，
        // 同一 achievementReconcileNow（与 importData 对称），整段自动读档只调用一次。
        if (typeof AchievementSystem !== "undefined" && AchievementSystem && typeof AchievementSystem.reconcileAchievementResearchRewards === "function") {
          AchievementSystem.reconcileAchievementResearchRewards(gameState, achievementReconcileNow);
        }
      }
  // Batch K：intship 一体化造船运行期恢复——必须在研究迁移之后、离线结算之前；
  // active 作业重装幂等消费者，shape 不匹配或不再驱动 currentAction 时 fail closed 为 recovery-required。
  if (typeof restoreIntshipProtocolRuntime === "function") restoreIntshipProtocolRuntime(gameState);
  // 新手任务 Batch O：tutorial 迁移 + 幂等消费者装载 + 首次对账，必须在离线结算**之前**完成，
  // 这样离线期间补发的事件才能被新手任务消费者接住（离线只推进到 completed / claimable，不自动发奖）。
  // restored=false（真正的全新开局，来源标记为 null）时一律不走 legacy 分支；
  // restored=true 时由三态标记严格判定：仅 === false（原始存档确实没有 tutorial 字段）才算老档。
  if (typeof TutorialSystem !== "undefined" && TutorialSystem && typeof TutorialSystem.bootstrap === "function") {
    TutorialSystem.bootstrap(gameState, {
      isLegacy: restored ? isLegacySaveSource() : false,
      now: Date.now()
    });
  }
  if (restored) calculateOfflineGains();
  ensureUserSettingsState(gameState);
  ensureStatisticsState(gameState);
  // 军团与空间站系统 Phase 3C-1：station/corporation 外壳幂等迁移（新游戏/旧存档共用）
  migrateStationCorporationState();
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
  if (fileInput) fileInput.addEventListener("change", (e) => { const file = e.target.files[0]; if (!file) return; if (file.size > MAX_IMPORT_SAVE_BYTES) { fileInput.value = ""; alert("存档文件超过 10 MB，已拒绝导入"); return; } const reader = new FileReader(); reader.onload = (ev) => { SaveManager.importData(ev.target.result); fileInput.value = ""; }; reader.readAsText(file); });
  const btnDelete = document.getElementById("btn-delete-save");
  if (btnDelete) btnDelete.addEventListener("click", () => SaveManager.confirmDeleteSave());
})();

document.addEventListener("visibilitychange", () => { if (!document.hidden) calculateOfflineGains(); });

// 战斗按钮事件
(function bindCombatButtons() {
})();

console.log("🚀 深空放置：边疆纪元 已就绪");
console.log("💡 调试命令：forceOfflineTest(60) — 模拟离线 60 秒");
console.log("🪐 行星系统已加载 — 点击侧边栏「行星概览」查看");
console.log("⚔ 战斗系统已加载 — 点击侧边栏「战斗」出击");
