/* ================================================================
   全装备强化 — 纯规则与数值层

   所有装备（普通战斗 / 普通工业 / 势力 / 联盟 / 死亡空间 / 旗舰）均可强化。
   强化等级保存在装备实例上；本文件不写 gameState、不操作 DOM。
   严格遵循最终锁定规则：
     · 失败规则 C：消耗全部材料，等级不变，不回退、不降级
     · 失败 XP = 0（仅成功给 baseXp·(1+0.2L)）
     · 成功率 = clamp(0.50 + skillBonus − levelPenalty, 0.05, 0.80)  [2026-07-23 新公式]
       skillBonus = 技能溢出递减（最高 +30%）
       levelPenalty = 强化等级递增惩罚
     · 每次尝试消耗精炼矿物，倍率 = 0.5 + 0.10·L + 0.5·⌊L/5⌋
     · 精炼矿物集合仅来自 SMELTING_RECIPES.outputMineral（数据驱动，无手写漂移表）
     · 普通 / 普通旗舰：任何等级均只耗精炼矿物，不耗同型号装备
     · 势力 / 联盟 / DED：仅 5 倍数目标等级（里程碑）额外收取同型号 +0 库存装备
       （DED 普通 +1 核心；DED 监督者 +1 协议）
   ================================================================ */

/* ---- 精炼矿物集合：仅来自冶炼配方产出（数据驱动，无手写漂移表） ---- */
function getRefinedMineralSet() {
  // Fail closed: 如果 SMELTING_RECIPES 不存在或为空，返回空集合。
  // 脚本顺序保证 production.js 先于 equipment-enhancement.js 加载，
  // 若数据不存在说明加载顺序错误，审计会捕获并报错。
  if (typeof SMELTING_RECIPES !== "undefined" && Array.isArray(SMELTING_RECIPES) && SMELTING_RECIPES.length) {
    return new Set(SMELTING_RECIPES.map(recipe => recipe.outputMineral));
  }
  return new Set(); // 空集合 → 强化成本为空 → 审计失败
}
const REFINED_MINERALS = getRefinedMineralSet();

/* ---- 装备分类（用于决定里程碑额外消耗） ---- */
function getEquipmentEnhancementCategory(equipment) {
  if (!equipment || !equipment.id) return "unknown";
  if (equipment.sourceDeathspaceId && equipment.deathspaceVariant === "supervisor") return "deathspace-supervisor";
  if (equipment.sourceDeathspaceId && equipment.deathspaceVariant === "standard") return "deathspace-standard";
  if (equipment.faction === "alliance") return "alliance";
  if (equipment.faction === "angel" || equipment.faction === "blood" || equipment.faction === "sansha") return "faction";
  return "normal";
}

/* ---- 效果乘区（仅作用于：武器基础伤害、维修量、采矿/采气/工业增益、护盾/装甲/结构容量） ---- */
function getEquipmentEnhancementEffectMultiplier(level) {
  const L = Math.max(0, Math.floor(Number(level) || 0));
  return 1 + 0.005 * L + 0.025 * Math.floor(L / 5);
}

/* ---- 成功率（委托 enhancement-chance.js 共用边际递减公式） ----
   2026-07-24：委托共用纯函数层，避免舰船/装备两套公式漂移。
   旧公式已废止：clamp(0.50 + 0.025×gap − 0.015×L, 0.10, 0.95)
   ---- */
function getEquipmentEnhancementSuccessChance(equipmentEngineeringLevel, equipmentLevel, currentLevel) {
  return getEnhancementChance(equipmentEngineeringLevel, equipmentLevel, currentLevel);
}

/** 返回 { base:0.50, skillBonus:number, levelPenalty:number, final:number }
 *  final = clamp(0.50 + skillBonus - levelPenalty, 0.05, 0.80) */
function getEquipmentEnhancementSuccessBreakdown(equipmentEngineeringLevel, equipmentLevel, currentLevel) {
  return getEnhancementChanceBreakdown(equipmentEngineeringLevel, equipmentLevel, currentLevel);
}

/* ---- 单次尝试精炼矿物倍率 ---- */
function getEquipmentEnhancementCostMultiplier(targetLevel) {
  const L = Math.max(1, Math.floor(Number(targetLevel) || 1));
  return 0.5 + 0.10 * L + 0.5 * Math.floor(L / 5);
}

/* ---- XP：成功 = round(baseXp · (1 + 0.2·currentLevel))；失败 = 0 ---- */
function getEquipmentEnhancementSuccessXp(equipment, currentLevel) {
  const L = Math.max(0, Math.floor(Number(currentLevel) || 0));
  return Math.round((Number(equipment && equipment.xp) || 0) * (1 + 0.2 * L));
}
function getEquipmentEnhancementFailureXp() { return 0; }

/* ---- 单次尝试的精炼矿物消耗（仅精炼矿物，剔除非精炼成本） ---- */
function getEquipmentEnhancementCost(equipment, targetLevel) {
  const multiplier = getEquipmentEnhancementCostMultiplier(targetLevel);
  const out = {};
  const cost = (equipment && equipment.cost) || {};
  for (const [material, quantity] of Object.entries(cost)) {
    if (REFINED_MINERALS.has(material)) out[material] = Math.max(1, Math.ceil(Number(quantity) * multiplier));
  }
  return out;
}

/* ---- DED 核心 / 协议 名称查询（来自 DEATHSPACE_DATABASE） ---- */
function getDeathspaceMaterials(equipment) {
  if (typeof DEATHSPACE_DATABASE === "undefined" || !equipment || !equipment.sourceDeathspaceId) return { core:null, protocol:null };
  const site = DEATHSPACE_DATABASE.find(entry => entry.id === equipment.sourceDeathspaceId);
  if (!site) return { core:null, protocol:null };
  return { core: site.coreMaterial || null, protocol: site.protocolMaterial || null };
}

/* ---- 里程碑额外消耗（方案2：仅 5 倍数目标等级）。
       普通 / 普通旗舰不耗同型号装备；势力/联盟/DED 额外消耗 1 件同型号 +0 库存装备；
       DED 普通 +1 核心；DED 监督者 +1 协议。 ---- */
function getEquipmentEnhancementExtraCost(equipment, targetLevel) {
  const L = Math.max(1, Math.floor(Number(targetLevel) || 1));
  if (L % 5 !== 0) return {};
  const category = getEquipmentEnhancementCategory(equipment);
  const out = {};
  if (category === "faction" || category === "alliance" ||
      category === "deathspace-standard" || category === "deathspace-supervisor") {
    out.sameTypeItemId = equipment.id; // 消耗 inventory 中同型号 +0 装备（string）
  }
  if (category === "deathspace-standard") {
    const materials = getDeathspaceMaterials(equipment);
    if (materials.core) out.core = materials.core;
  }
  if (category === "deathspace-supervisor") {
    const materials = getDeathspaceMaterials(equipment);
    if (materials.protocol) out.protocol = materials.protocol;
  }
  return out;
}

/* ---- 统一装备引用解析层（双池：inventory string 或 instanceId 均可解析） ---- */
function isEquipmentInstanceId(state, ref) {
  // 防御性兼容：浏览器 data-* 属性会将数字转为字符串；旧存档可能使用数字 ID。
  // 统一转为字符串后宽松比较，同时防止 itemId 被误判为 instanceId。
  if (!state || !state.equipment || !Array.isArray(state.equipment.instances)) return false;
  const refStr = String(ref);
  return state.equipment.instances.some(instance => String(instance.instanceId) === refStr);
}

function resolveEquipmentReference(state, ref) {
  if (!state || !state.equipment) return null;
  const instance = isEquipmentInstanceId(state, ref)
    ? state.equipment.instances.find(entry => String(entry.instanceId) === String(ref))
    : null;
  const itemId = instance ? instance.itemId : ref; // 旧 string 直接当 itemId
  const definition = EQUIPMENT_DB[itemId];
  if (!definition) return null;
  const enhancementLevel = instance ? Math.max(0, Number(instance.enhancementLevel) || 0) : 0;
  return {
    itemId,
    definition,
    instance,
    enhancementLevel,
    multiplier: getEquipmentEnhancementEffectMultiplier(enhancementLevel)
  };
}

/* ---- 强化预览展示态 ---- */
function getEquipmentEnhancementDisplayState(equipment, level, equipmentEngineeringLevel) {
  const L = Math.max(0, Math.floor(Number(level) || 0));
  const threshold = Number(equipment && equipment.level) || 1;
  const targetLevel = L + 1;
  const milestone = targetLevel % 5 === 0;
  const breakdown = getEquipmentEnhancementSuccessBreakdown(equipmentEngineeringLevel, threshold, L);
  return {
    currentLevel: L,
    previewLevel: targetLevel,
    multiplier: getEquipmentEnhancementEffectMultiplier(L),
    previewMultiplier: getEquipmentEnhancementEffectMultiplier(targetLevel),
    success: breakdown.final,
    successBreakdown: breakdown,
    cost: getEquipmentEnhancementCost(equipment, targetLevel),
    extra: getEquipmentEnhancementExtraCost(equipment, targetLevel),
    isMilestone: milestone,
    category: getEquipmentEnhancementCategory(equipment),
    successXp: getEquipmentEnhancementSuccessXp(equipment, L),
    failureXp: 0
  };
}

/* ---- 双池计数与查询辅助（只读 state） ---- */
function getEquipmentInventoryCount(state, itemId) {
  const inventory = state && state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  return inventory.filter(id => id === itemId).length;
}

function getEquipmentInstanceList(state) {
  return state && state.equipment && Array.isArray(state.equipment.instances) ? state.equipment.instances : [];
}

function getEquipmentInstanceById(state, instanceId) {
  const idStr = String(instanceId);
  return getEquipmentInstanceList(state).find(instance => String(instance.instanceId) === idStr) || null;
}

function getUninstalledEquipmentInstances(state, itemId) {
  return getEquipmentInstanceList(state).filter(instance =>
    (!itemId || instance.itemId === itemId) && !instance.installedOn);
}

function getEquipmentOwnedCount(state, itemId) {
  const inventory = state && state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  const instances = getEquipmentInstanceList(state).filter(instance => !itemId || instance.itemId === itemId);
  return inventory.filter(id => id === itemId).length + instances.length;
}

function findDonorInventoryIndex(state, itemId, excludeIndex) {
  const inventory = state && state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  for (let index = 0; index < inventory.length; index++) {
    if (index === excludeIndex) continue;
    if (inventory[index] === itemId) return index;
  }
  return -1;
}

/* ---- 拆解报价辅助：按「只算成功」反推累计消耗（失败尝试不计入）。
       强化等级仅在成功时 +1，故 total = 逐级 L=1..level 之和：
       · minerals：每次精炼矿物消耗（仅精炼，剔除非精炼）
       · wholeItems：每个 5 倍数里程碑的同型装备 / DED 核心 / 协议（逐件列表，供拆解时独立 50% 掷骰） ---- */
function getEquipmentEnhancementSuccessCostSummary(equipment, level) {
  const L = Math.max(0, Math.floor(Number(level) || 0));
  const minerals = {};
  const wholeItems = [];
  for (let lvl = 1; lvl <= L; lvl++) {
    const cost = getEquipmentEnhancementCost(equipment, lvl); // 精炼矿物
    for (const [mat, qty] of Object.entries(cost)) minerals[mat] = (minerals[mat] || 0) + Number(qty);
    if (lvl % 5 === 0) {
      const extra = getEquipmentEnhancementExtraCost(equipment, lvl);
      if (extra.sameTypeItemId) wholeItems.push({ type:"sameType", id:extra.sameTypeItemId });
      if (extra.core) wholeItems.push({ type:"core", id:extra.core });
      if (extra.protocol) wholeItems.push({ type:"protocol", id:extra.protocol });
    }
  }
  return { minerals, wholeItems };
}

window.EquipmentEnhancement = Object.freeze({
  REFINED_MINERALS,
  getRefinedMineralSet,
  getEquipmentEnhancementCategory,
  getEquipmentEnhancementEffectMultiplier,
  getEquipmentEnhancementSuccessChance,
  getEquipmentEnhancementSuccessBreakdown,
  getEquipmentEnhancementCostMultiplier,
  getEquipmentEnhancementSuccessXp,
  getEquipmentEnhancementFailureXp,
  getEquipmentEnhancementCost,
  getDeathspaceMaterials,
  getEquipmentEnhancementExtraCost,
  getEquipmentEnhancementSuccessCostSummary,
  isEquipmentInstanceId,
  resolveEquipmentReference,
  getEquipmentEnhancementDisplayState,
  getEquipmentInventoryCount,
  getEquipmentInstanceList,
  getEquipmentInstanceById,
  getUninstalledEquipmentInstances,
  getEquipmentOwnedCount,
  findDonorInventoryIndex
});
