/* ================================================================
   战斗掉落材料 → 可制造物 / 可用途 映射（Phase 3D）
   —— 提供纯函数 getMaterialCraftables(materialName, state)，
   基于游戏真实配方表扫描「该材料能造什么」，并标注蓝图解锁状态。
   被 js/ui/combat-render.js 的 combatDropToItem 在点击掉落行时调用，
   结果在 js/ui/shell-render.js 的物品详情弹窗里以「可制造 / 可用途」区块展示。
   数据单一事实源：
     · 舰船总装 materialCost（js/data/ships.js · SHIP_ASSEMBLY_RECIPES）
     · 联盟蓝图 dataMaterial（js/data/equipment.js · LP_STORE_BLUEPRINTS）
     · 势力/联盟装备 & DED 装备 cost（js/data/equipment.js · EQUIPMENT_DB，
       DED 装备在加载时已写入 EQUIPMENT_DB，cost 内含校准核心 / 协议）
   解锁判定统一走 state.ownedBlueprints（数组，存 shipId 或 "equipment:<id>"）。
   ================================================================ */

// 材料所属掉落类别（仅用于弹窗分类标签与文案）
function getCombatDropCategory(materialName) {
  if (typeof STAR_BELT_DATA_MATERIALS !== "undefined" && Array.isArray(STAR_BELT_DATA_MATERIALS) && STAR_BELT_DATA_MATERIALS.indexOf(materialName) >= 0) {
    return "加密数据";
  }
  if (typeof GEAR_DATA_MATERIALS !== "undefined" && Array.isArray(GEAR_DATA_MATERIALS) && GEAR_DATA_MATERIALS.indexOf(materialName) >= 0) {
    return "装备生产许可";
  }
  if (typeof DEATHSPACE_DATABASE !== "undefined" && Array.isArray(DEATHSPACE_DATABASE)) {
    for (const site of DEATHSPACE_DATABASE) {
      if (site.coreMaterial === materialName) return "死亡空间校准核心";
      if (site.protocolMaterial === materialName) return "死亡空间协议";
    }
  }
  return "战斗掉落";
}

// 蓝图是否已解锁：requiresBlueprint=false → 无需蓝图（恒为真）；否则查 ownedBlueprints
function _isBlueprintUnlocked(bpKey, requiresBlueprint, state) {
  if (!requiresBlueprint) return true;
  const owned = (state && Array.isArray(state.ownedBlueprints)) ? state.ownedBlueprints : [];
  return owned.indexOf(bpKey) >= 0;
}

// 给定材料中文名（不含 "special:" 前缀），返回可制造 / 可用途列表。
// 每项：{ name, type, bpKey, requiresBlueprint, unlocked }
function getMaterialCraftables(materialName, state) {
  if (!materialName) return [];
  // Accept both the canonical resource id used by inventory items and the
  // historical bare material name used by combat preview callers.
  const canonical = String(materialName);
  const bareMaterialName = canonical.indexOf("special:") === 0
    ? canonical.slice("special:".length)
    : canonical;
  materialName = bareMaterialName;
  const out = [];
  const seen = {};

  // 1) 舰船总装：materialCost 含该材料
  // ships.js 末尾把 SHIP_ASSEMBLY_RECIPES / SHIP_BLUEPRINTS 挂到了 window.SHIP_DATA；
  // 总装配方才真正包含 materialCost，因此优先扫描 SHIP_ASSEMBLY_RECIPES。
  const shipAssembly = (typeof window !== "undefined" && window.SHIP_DATA && Array.isArray(window.SHIP_DATA.SHIP_ASSEMBLY_RECIPES))
    ? window.SHIP_DATA.SHIP_ASSEMBLY_RECIPES
    : ((typeof SHIP_ASSEMBLY_RECIPES !== "undefined" && Array.isArray(SHIP_ASSEMBLY_RECIPES)) ? SHIP_ASSEMBLY_RECIPES : null);
  const shipBlueprints = (typeof window !== "undefined" && window.SHIP_DATA && Array.isArray(window.SHIP_DATA.SHIP_BLUEPRINTS))
    ? window.SHIP_DATA.SHIP_BLUEPRINTS
    : ((typeof SHIP_BLUEPRINTS !== "undefined" && Array.isArray(SHIP_BLUEPRINTS)) ? SHIP_BLUEPRINTS : null);
  const shipRecipeSources = [shipAssembly, shipBlueprints].filter(Boolean);
  for (const src of shipRecipeSources) {
    for (const bp of src) {
      if (!bp || !bp.materialCost) continue;
      const qty = Number(bp.materialCost[materialName]);
      if (!qty || qty <= 0) continue;
      const bpKey = bp.shipId || bp.id;
      if (seen[bpKey]) continue;
      const req = !!bp.requiresBlueprint;
      out.push({
        name: bp.name || bpKey,
        type: "舰船",
        bpKey: bpKey,
        requiresBlueprint: req,
        unlocked: _isBlueprintUnlocked(bpKey, req, state)
      });
      seen[bpKey] = true;
    }
  }

  // 2) 联盟蓝图：dataMaterial 等于该材料（解锁后造对应装备）
  if (typeof LP_STORE_BLUEPRINTS !== "undefined" && Array.isArray(LP_STORE_BLUEPRINTS)) {
    for (const bp of LP_STORE_BLUEPRINTS) {
      if (bp && bp.dataMaterial === materialName && bp.equipmentId) {
        const bpKey = "equipment:" + bp.equipmentId;
        const req = true;
        out.push({
          name: bp.name || bpKey,
          type: "联盟蓝图",
          bpKey: bpKey,
          requiresBlueprint: req,
          unlocked: _isBlueprintUnlocked(bpKey, req, state)
        });
        seen[bpKey] = true;
      }
    }
  }

  // 3) 装备工程 & DED 装备：cost 含 "<材料>"（多数势力许可/死亡空间核心）或 "special:<材料>"
  if (typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB) {
    const bareKey = materialName;
    const specialKey = "special:" + materialName;
    for (const id in EQUIPMENT_DB) {
      if (!Object.prototype.hasOwnProperty.call(EQUIPMENT_DB, id)) continue;
      const eq = EQUIPMENT_DB[id];
      if (!eq || !eq.cost) continue;
      const qty = Number(eq.cost[bareKey]) || Number(eq.cost[specialKey]);
      if (!qty || qty <= 0) continue;
      if (seen[id]) continue;
      const bpKey = "equipment:" + id;
      const req = !!eq.requiresBlueprint;
      out.push({
        name: eq.name || id,
        type: eq.deathspaceVariant ? "DED装备" : "装备",
        bpKey: bpKey,
        requiresBlueprint: req,
        unlocked: _isBlueprintUnlocked(bpKey, req, state)
      });
      seen[id] = true;
    }
  }

  // 同类型按名称排序，稳定输出
  out.sort((a, b) => (a.type === b.type ? (a.name < b.name ? -1 : 1) : (a.type < b.type ? -1 : 1)));
  return out;
}

// 类别文案（用于弹窗「物品介绍」）
function getCombatDropCraftDescription(materialName, category, craftables) {
  switch (category) {
    case "加密数据":
      return "加密数据（显示名可能已被替换）：用于舰船总装材料与联盟蓝图解锁。下列为消耗该加密数据的舰船与联盟装备蓝图。";
    case "装备生产许可":
      return "势力 / 联盟装备制造所需的许可材料。下列为消耗该许可的装备配方。";
    case "死亡空间校准核心":
      return "死亡空间掉落的核心材料，用于制造对应死亡空间 DED 装备（普通型与监督者改良型）。";
    case "死亡空间协议":
      return "死亡空间掉落的协议材料，仅用于制造对应死亡空间监督者改良型 DED 装备。";
    default:
      return (Array.isArray(craftables) && craftables.length)
        ? "该材料可用于制造下列物品。"
        : "战斗掉落物：击坠敌人后有概率获得。";
  }
}
