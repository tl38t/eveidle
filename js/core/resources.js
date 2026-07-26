/* ================================================================
   ResourceRegistry — 兼容当前存档结构的统一资源寻址层

   业务代码使用 namespace:itemKey；底层仍读写原有 resources.* 字段。
   ================================================================ */

const RESOURCE_NAMESPACE_CONFIG = Object.freeze({
  currency:{ kind:"scalar" },
  ore:{ kind:"pool", pool:"ores", material:true },
  mineral:{ kind:"pool", pool:"minerals", material:true },
  planetary:{ kind:"pool", pool:"planetary", material:true },
  gas:{ kind:"pool", pool:"gases", material:true },
  moon:{ kind:"pool", pool:"moonOres", material:true },
  special:{ kind:"pool", pool:"special", material:true },
  component:{ kind:"pool", pool:"shipComponents" },
  ammo:{ kind:"pool", pool:"ammunition" },
  probe:{ kind:"pool", pool:"probes" },
  artifact:{ kind:"pool", pool:"artifacts" },
  calibration:{ kind:"pool", pool:"calibrations", material:true },
  consumable:{ kind:"scalar" },
  // 增强剂系统 Phase 2A：booster 库存不属于 state.resources，而是 state.boosters.inventory（见 getPoolContainer 特判）。
  booster:{ kind:"pool", pool:"boosterInventory", material:false }
});

const MATERIAL_NAMESPACE_ORDER = Object.freeze(["mineral", "ore", "planetary", "gas", "moon", "special"]);

const ResourceRegistry = (() => {
  const definitions = new Map();
  const idsByName = new Map();

  function makeId(namespace, key) { return namespace + ":" + key; }

  function parseId(id) {
    if (typeof id !== "string") return null;
    const separator = id.indexOf(":");
    if (separator <= 0 || separator >= id.length - 1) return null;
    return { namespace:id.slice(0, separator), key:id.slice(separator + 1) };
  }

  function register(definition) {
    if (!definition || !RESOURCE_NAMESPACE_CONFIG[definition.namespace]) throw new Error("未知资源命名空间：" + (definition && definition.namespace));
    const key = String(definition.key);
    const id = definition.id || makeId(definition.namespace, key);
    const config = RESOURCE_NAMESPACE_CONFIG[definition.namespace];
    const normalized = Object.freeze({
      id,
      namespace:definition.namespace,
      key,
      name:definition.name || key,
      category:definition.category || definition.namespace,
      pool:definition.pool || config.pool || null,
      scalarKey:definition.scalarKey || (config.kind === "scalar" ? key : null),
      material:definition.material !== undefined ? Boolean(definition.material) : Boolean(config.material)
    });
    definitions.set(id, normalized);
    const nameIds = idsByName.get(normalized.name) || [];
    if (!nameIds.includes(id)) nameIds.push(id);
    idsByName.set(normalized.name, nameIds);
    return normalized;
  }

  function getDefinition(id) {
    if (definitions.has(id)) return definitions.get(id);
    const parsed = parseId(id);
    const config = parsed && RESOURCE_NAMESPACE_CONFIG[parsed.namespace];
    if (!parsed || !config) return null;
    return register({ namespace:parsed.namespace, key:parsed.key, name:parsed.key });
  }

  function getResources(state) { return state && state.resources ? state.resources : null; }

  // 解析 pool 型资源的容器对象。booster 命名空间特判：容器为 state.boosters.inventory，其余走 state.resources[pool]。
  function getPoolContainer(state, definition, createIfMissing) {
    if (!state || !definition || !definition.pool) return null;
    if (definition.namespace === "booster") {
      if (!state.boosters || typeof state.boosters !== "object") { if (!createIfMissing) return null; state.boosters = {}; }
      if (!state.boosters.inventory || typeof state.boosters.inventory !== "object") { if (!createIfMissing) return null; state.boosters.inventory = {}; }
      return state.boosters.inventory;
    }
    const resources = getResources(state);
    if (!resources) return null;
    if (!resources[definition.pool] || typeof resources[definition.pool] !== "object") { if (!createIfMissing) return null; resources[definition.pool] = {}; }
    return resources[definition.pool];
  }

  function get(state, id) {
    const definition = getDefinition(id);
    if (!definition) return 0;
    if (definition.pool) {
      const container = getPoolContainer(state, definition, false);
      return container ? Number(container[definition.key]) || 0 : 0;
    }
    const resources = getResources(state);
    return resources ? Number(resources[definition.scalarKey]) || 0 : 0;
  }

  function set(state, id, quantity) {
    const definition = getDefinition(id);
    if (!definition) return false;
    const value = Math.max(0, Number(quantity) || 0);
    if (definition.pool) {
      const container = getPoolContainer(state, definition, true);
      if (!container) return false;
      container[definition.key] = value;
    } else {
      const resources = getResources(state);
      if (!resources) return false;
      resources[definition.scalarKey] = value;
    }
    state._dirty = true;
    return true;
  }

  function add(state, id, quantity) {
    const delta = Number(quantity) || 0;
    if (delta === 0) return get(state, id);
    set(state, id, get(state, id) + delta);
    return get(state, id);
  }

  function spend(state, id, quantity) {
    const cost = Math.max(0, Number(quantity) || 0);
    if (get(state, id) < cost) return false;
    return set(state, id, get(state, id) - cost);
  }

  function resolveMaterialIds(reference) {
    if (typeof reference !== "string") return [];
    const direct = getDefinition(reference);
    if (parseId(reference)) return direct && direct.material ? [direct.id] : [];
    return (idsByName.get(reference) || [])
      .map(id => definitions.get(id))
      .filter(definition => definition && definition.material)
      .sort((left, right) => MATERIAL_NAMESPACE_ORDER.indexOf(left.namespace) - MATERIAL_NAMESPACE_ORDER.indexOf(right.namespace))
      .map(definition => definition.id);
  }

  function getMaterialStock(state, reference) {
    return resolveMaterialIds(reference).reduce((total, id) => total + get(state, id), 0);
  }

  function canAffordCost(state, cost, multiplier) {
    const cycles = Math.max(1, Number(multiplier) || 1);
    return Object.entries(cost || {}).every(([reference, quantity]) => getMaterialStock(state, reference) >= Number(quantity) * cycles);
  }

  function spendMaterial(state, reference, quantity) {
    let remaining = Math.max(0, Number(quantity) || 0);
    const ids = resolveMaterialIds(reference);
    if (ids.reduce((total, id) => total + get(state, id), 0) < remaining) return false;
    for (const id of ids) {
      if (remaining <= 0) break;
      const deduction = Math.min(remaining, get(state, id));
      spend(state, id, deduction);
      remaining -= deduction;
    }
    return true;
  }

  function spendCost(state, cost, multiplier) {
    const cycles = Math.max(1, Number(multiplier) || 1);
    if (!canAffordCost(state, cost, cycles)) return false;
    for (const [reference, quantity] of Object.entries(cost || {})) spendMaterial(state, reference, Number(quantity) * cycles);
    return true;
  }

  // 按 ref 形态自动解析：namespace:key（如 component:integrated_hull）走精确 get/spend；
  // 纯材料名（如 "镓"/"天使低级加密数据"，跨命名空间按名聚合）走 getMaterialStock/spendMaterial。
  // 供船坞节省 quote/commit 使用：materialCost 键为纯名称，componentCost 键被前缀为 component:。
  function getByRef(state, ref) {
    return parseId(ref) ? get(state, ref) : getMaterialStock(state, ref);
  }
  function spendByRef(state, ref, quantity) {
    return parseId(ref) ? spend(state, ref, quantity) : spendMaterial(state, ref, quantity);
  }

  function getResourceDisplayName(id) {
    if (typeof id !== "string" || !id) return id;
    // 已注册定义（含懒注册）优先；懒注册 fallback 的 name===key 时视为"无名称"，回退原始键
    const parsed = parseId(id);
    if (!parsed) {
      // 非 namespace:key 形式（如直接中文名"三钛合金"），原样返回
      return id;
    }
    const definition = definitions.has(id) ? definitions.get(id) : getDefinition(id);
    if (definition && definition.name && definition.name !== definition.key) return definition.name;
    return id;
  }

  function listDefinitions(namespace) {
    return [...definitions.values()].filter(definition => !namespace || definition.namespace === namespace);
  }

  function listStateEntries(state, namespace) {
    const config = RESOURCE_NAMESPACE_CONFIG[namespace];
    const resources = getResources(state);
    if (!config || !resources) return [];
    if (config.kind === "scalar") {
      return listDefinitions(namespace).map(definition => ({ definition, quantity:get(state, definition.id) }));
    }
    return Object.entries(resources[config.pool] || {}).map(([key, quantity]) => {
      const definition = getDefinition(makeId(namespace, key));
      return { definition, quantity:Number(quantity) || 0 };
    });
  }

  function getCargoTotal(state) {
    const namespaces = ["ore", "mineral", "planetary", "gas", "moon", "special", "component"];
    const stackables = namespaces.reduce((total, namespace) =>
      total + listStateEntries(state, namespace).reduce((sum, entry) => sum + entry.quantity, 0), 0);
    const equipmentStrings = state && state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory.length : 0;
    const equipmentInstances = state && state.equipment && Array.isArray(state.equipment.instances)
      ? state.equipment.instances.filter(instance => !instance.installedOn).length
      : 0;
    return stackables + equipmentStrings + equipmentInstances;
  }

  return {
    makeId,
    parseId,
    register,
    getDefinition,
    get,
    set,
    add,
    spend,
    resolveMaterialIds,
    getMaterialStock,
    canAffordCost,
    spendMaterial,
    spendCost,
    getByRef,
    spendByRef,
    getResourceDisplayName,
    listDefinitions,
    listStateEntries,
    getCargoTotal
  };
})();
window.ResourceRegistry = ResourceRegistry;

/* 统一资源名称解析：namespace:key → 中文显示名；解析失败回退原始键 */
function getResourceDisplayName(resourceKey) {
  return ResourceRegistry.getResourceDisplayName(resourceKey);
}
window.getResourceDisplayName = getResourceDisplayName;

function registerLegacyResourceCategory(namespace, names, category) {
  for (const name of names || []) ResourceRegistry.register({ namespace, key:name, name, category });
}

registerLegacyResourceCategory("ore", ITEM_CATEGORIES.ore, "ore");
registerLegacyResourceCategory("mineral", ITEM_CATEGORIES.mineral, "mineral");
registerLegacyResourceCategory("planetary", ITEM_CATEGORIES.planetary, "planetary");
registerLegacyResourceCategory("gas", ITEM_CATEGORIES.gases, "gases");
registerLegacyResourceCategory("moon", ITEM_CATEGORIES.moon, "moon");
registerLegacyResourceCategory("special", ITEM_CATEGORIES.special, "special");

ResourceRegistry.register({ namespace:"currency", key:"isk", name:"ISK", scalarKey:"isk", category:"currency" });
ResourceRegistry.register({ namespace:"currency", key:"lp", name:"LP", scalarKey:"lp", category:"currency" });
ResourceRegistry.register({ namespace:"consumable", key:"fuel", name:"燃料单元", scalarKey:"fuel", category:"consumable" });
ResourceRegistry.register({ namespace:"consumable", key:"repairPaste", name:"纳米维修膏", scalarKey:"repairPaste", category:"consumable" });
ResourceRegistry.register({ namespace:"consumable", key:"warpFuel", name:"跃迁燃料", scalarKey:"warpFuel", category:"consumable" });
ResourceRegistry.register({ namespace:"ammo", key:"laser", name:"激光晶体弹药", category:"consumable" });
ResourceRegistry.register({ namespace:"ammo", key:"missile", name:"导弹", category:"consumable" });
ResourceRegistry.register({ namespace:"ammo", key:"cannon", name:"炮台弹药", category:"consumable" });

for (const recipe of SHIP_COMPONENT_RECIPES) {
  ResourceRegistry.register({ namespace:"component", key:recipe.id, name:recipe.name, category:"equipment" });
}

// 考古探针 / 文物 / 校准材料 资源登记（考古.js 已先于本文件加载，故 ARCHAEOLOGY_PROBES / ARCHAEOLOGY_ARTIFACTS 已就绪）
if (typeof ARCHAEOLOGY_PROBES !== "undefined") {
  for (const probe of ARCHAEOLOGY_PROBES) ResourceRegistry.register({ namespace:"probe", key:probe.id, name:probe.name, category:"probes" });
}
if (typeof ARCHAEOLOGY_ARTIFACTS !== "undefined") {
  for (const artifact of ARCHAEOLOGY_ARTIFACTS) {
    const namespace = artifact.category === "calibration" ? "calibration" : "artifact";
    ResourceRegistry.register({ namespace, key:artifact.id, name:artifact.name, category:artifact.category === "calibration" ? "calibration" : "artifact" });
  }
}

// 增强剂系统 Phase 2A：30 件增强剂登记（booster.js 已先于本文件加载）。
// booster 命名空间为 pool 型，容器特判为 state.boosters.inventory；material:false 表示不参与配方材料名称聚合。
if (typeof BOOSTER_ITEMS !== "undefined") {
  for (const key of Object.keys(BOOSTER_ITEMS)) {
    const item = BOOSTER_ITEMS[key];
    ResourceRegistry.register({ namespace:"booster", key, name:item.name, category:"booster" });
  }
}
