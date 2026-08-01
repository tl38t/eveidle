/* ================================================================
   制造系统核心与旧调用兼容层

   此文件不负责DOM渲染。页面展示和事件绑定位于
   js/ui/manufacturing-render.js。
   ================================================================ */

function getShipCompRecipe() {
  const id = gameState.currentAction.shipCompTarget;
  return SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === id) || SHIP_COMPONENT_RECIPES[0];
}

function getShipAsmRecipe() {
  const id = gameState.currentAction.shipAsmTarget;
  return SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === id) || SHIP_ASSEMBLY_RECIPES[0];
}

function getRunningShipCompRecipe() {
  const id = gameState.currentAction.startedShipCompTarget || gameState.currentAction.shipCompTarget;
  return SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === id) || SHIP_COMPONENT_RECIPES[0];
}

function getRunningShipAsmRecipe() {
  const id = gameState.currentAction.startedShipAsmTarget || gameState.currentAction.shipAsmTarget;
  return SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === id) || SHIP_ASSEMBLY_RECIPES[0];
}

function getShipAssemblyComponentCost(recipe) {
  if (recipe && recipe.componentCost) return recipe.componentCost;
  const fallback = {};
  const count = (recipe && recipe.compCount) || 1;
  for (const id of (recipe && recipe.comps) || []) fallback[id] = count;
  return fallback;
}

function getMaxShipAssemblyCycles(recipe) {
  return getShipAssemblyMaxCyclesFromState(gameState, recipe);
}

// 带船坞节省的舰船组装材料校验（用量 quote 计算需要的实际数量）
function hasEnoughShipAssemblyComponents(recipe, cycles) {
  const multiplier = cycles || 1;
  if (typeof getShipyardProductionQuote === "function" && typeof getShipyardSavingRate === "function" && getShipyardSavingRate(gameState) > 0) {
    const quote = getShipyardProductionQuote(gameState, recipe, multiplier);
    for (const [ref, qty] of Object.entries(quote.payable)) {
      // materialCost 键为纯材料名，须按名聚合校验（component:xxx 仍走精确读）
      if (ResourceRegistry.getByRef(gameState, ref) < qty) return false;
    }
    return true;
  }
  // 无节省时的旧路径
  const hasComponents = Object.entries(getShipAssemblyComponentCost(recipe)).every(([id, count]) =>
    ResourceRegistry.get(gameState, "component:" + id) >= count * multiplier
  );
  return hasComponents && ResourceRegistry.canAffordCost(gameState, recipe.materialCost || {}, multiplier);
}

// 带船坞节省的舰船组装材料扣除
function deductShipAssemblyComponents(recipe, cycles) {
  const multiplier = cycles || 1;
  if (typeof getShipyardProductionQuote === "function" && typeof commitShipyardProductionQuote === "function" && typeof getShipyardSavingRate === "function" && getShipyardSavingRate(gameState) > 0) {
    const quote = getShipyardProductionQuote(gameState, recipe, multiplier);
    const result = commitShipyardProductionQuote(gameState, quote);
    if (result.changed !== true) return false;
    if (quote.totalSaved > 0) {
      if (typeof GameEvents !== "undefined") {
        GameEvents.emit("station:shipyardMaterialsSaved", { recipeId:recipe.id, cycles:multiplier, savings:quote.saved, totalSaved:quote.totalSaved }, { source:"station" });
      }
    }
    return true;
  }
  // 无节省时的旧路径
  for (const [id, count] of Object.entries(getShipAssemblyComponentCost(recipe))) {
    ResourceRegistry.spend(gameState, "component:" + id, count * multiplier);
  }
  ResourceRegistry.spendCost(gameState, recipe.materialCost || {}, multiplier);
  return true;
}

function hasBlueprint(shipId) {
  return (gameState.ownedBlueprints || []).includes(shipId);
}

function shipAssemblyRequiresBlueprint(recipe) {
  return !recipe || recipe.requiresBlueprint !== false;
}

function canUseShipAssemblyRecipe(recipe) {
  return Boolean(recipe) && (!shipAssemblyRequiresBlueprint(recipe) || hasBlueprint(recipe.shipId));
}

function getMaterialStock(material) {
  return ResourceRegistry.getMaterialStock(gameState, material);
}

function hasEnoughMats(cost) {
  return ResourceRegistry.canAffordCost(gameState, cost);
}

function deductMats(cost) {
  return ResourceRegistry.spendCost(gameState, cost);
}

function buyBlueprint(blueprintId) {
  return dispatchGameAction(gameState, { type:"manufacturing/buyBlueprint", blueprintId }, Date.now());
}

function switchShipCompTarget(componentId) {
  return dispatchGameAction(gameState, { type:"manufacturing/selectShipComponent", componentId }, Date.now());
}

function switchShipAsmTarget(recipeId) {
  return dispatchGameAction(gameState, { type:"manufacturing/selectShipAssembly", recipeId }, Date.now());
}

function startShipCompManufacturing() {
  return dispatchGameAction(gameState, { type:"manufacturing/startShipComponent" }, Date.now());
}

function startShipAssembly() {
  return dispatchGameAction(gameState, { type:"manufacturing/startShipAssembly" }, Date.now());
}

/* ================================================================
   装备工程核心
   ================================================================ */

function getEquipEngRecipe() {
  return getEquipmentEngineeringRecipe(gameState.currentAction.equipEngTarget || "t1_mining_laser");
}

function getRunningEquipEngRecipe() {
  return getEquipmentEngineeringRecipe(gameState.currentAction.startedEquipEngTarget || gameState.currentAction.equipEngTarget || "t1_mining_laser");
}

function getEquipEngEfficiency() {
  const skillMult = 1 + gameState.skills.equipmentEngineering.lvl * 0.02;
  const stationMult = (typeof getStationLogisticsMultiplier === "function") ? Math.max(0.001, getStationLogisticsMultiplier(gameState)) : 1;
  // 研究批次 G：与 selectors.getEquipmentEngineeringDisplayState 共用同一科研 API，保证显示/在线/离线三处一致
  const researchMult = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(gameState, ["allMfg", "equip"]) : 1;
  return skillMult * stationMult * researchMult;
}

function getEquipEngCategoryDefinition(categoryId) {
  return EQUIPMENT_ENGINEERING_CATEGORIES.find(category => category.id === categoryId) || EQUIPMENT_ENGINEERING_CATEGORIES[0];
}

function getEquipEngCategory() {
  const saved = EQUIPMENT_ENGINEERING_CATEGORIES.find(category => category.id === gameState.currentAction.equipEngCategory);
  return saved || getEquipEngCategoryDefinition(getEquipEngRecipe().category);
}

function getEquipEngRecipesForCategory(categoryId) {
  return EQUIPMENT_ENGINEERING_RECIPES.filter(recipe => recipe.category === categoryId);
}

function getEquipEngMaxCycles(recipe) {
  return getEquipmentMaxCyclesFromState(gameState, recipe);
}

function getEquipEngOwnedCount(recipe) {
  return getEquipmentOwnedCountFromState(gameState, recipe);
}

function hasEnoughEquipEngInputs(recipe, cycles) {
  const count = Math.max(1, Number(cycles) || 1);
  if (!ResourceRegistry.canAffordCost(gameState, recipe.cost, count)) return false;
  if (!recipe.inputEquipment) return true;
  const inventory = gameState.equipment && Array.isArray(gameState.equipment.inventory) ? gameState.equipment.inventory : [];
  const required = Math.max(1, Number(recipe.inputEquipment.quantity) || 1) * count;
  return inventory.filter(itemId => itemId === recipe.inputEquipment.itemId).length >= required;
}

function deductEquipEngInputs(recipe, cycles) {
  const count = Math.max(1, Number(cycles) || 1);
  if (!hasEnoughEquipEngInputs(recipe, count)) return false;
  ResourceRegistry.spendCost(gameState, recipe.cost, count);
  if (recipe.inputEquipment) {
    const required = Math.max(1, Number(recipe.inputEquipment.quantity) || 1) * count;
    for (let index = 0; index < required; index++) {
      const inventoryIndex = gameState.equipment.inventory.indexOf(recipe.inputEquipment.itemId);
      gameState.equipment.inventory.splice(inventoryIndex, 1);
    }
  }
  return true;
}

function getEquipEngTierLabel(recipe) {
  if (recipe.deathspaceTier) return "DED " + recipe.deathspaceTier + "/10" + (recipe.deathspaceVariant === "supervisor" ? " 改良" : "");
  if (recipe.faction) return "势力";
  const match = recipe.id.match(/(?:^|_)t([1-5])(?:_|$)/);
  if (match) return "T" + match[1];
  if (recipe.level >= 80) return "T5";
  if (recipe.level >= 55) return "T4";
  if (recipe.level >= 35) return "T3";
  if (recipe.level >= 15) return "T2";
  return "T1";
}

function getEquipEngRecipeIcon(recipe) {
  const equipment = recipe.output.type === "equipment" ? EQUIPMENT_DB[recipe.output.itemId] : null;
  if (recipe.category === "industry") return recipe.id.includes("gas") ? "fa-solid fa-wind" : "fa-solid fa-gem";
  if (recipe.category === "drones") return "fa-solid fa-satellite-dish";
  if (recipe.category === "fuel") return "fa-solid fa-gas-pump";
  if (recipe.category === "ammunition") return recipe.output.weapon === "missile" ? "fa-solid fa-rocket" : "fa-solid fa-burst";
  if (recipe.category === "defense") return equipment && equipment.combat && equipment.combat.target === "structure" ? "fa-solid fa-wrench" : "fa-solid fa-shield-halved";
  if (equipment && equipment.combat && equipment.combat.weaponType === "laser") return "fa-solid fa-bolt";
  if (equipment && equipment.combat && equipment.combat.weaponType === "missile") return "fa-solid fa-rocket";
  return "fa-solid fa-crosshairs";
}

function switchEquipEngCategory(categoryId) {
  return dispatchGameAction(gameState, { type:"manufacturing/selectEquipmentCategory", categoryId }, Date.now());
}

function switchEquipEngTarget(recipeId) {
  return dispatchGameAction(gameState, { type:"manufacturing/selectEquipmentRecipe", recipeId }, Date.now());
}

function getEquipEngOutputText(recipe) {
  const output = recipe.output;
  if (output.type === "equipment") {
    const slotName = { high:"高槽", mid:"中槽", low:"低槽", rig:"改装件" }[recipe.slot] || "装备";
    return "产出：" + recipe.name + " ×" + output.qty + "（" + slotName + "）";
  }
  if (output.type === "fuel") return "产出：⛽燃料 +" + output.qty;
  if (output.type === "probe") return "产出：🛰 探针 " + (EQUIPMENT_DB[output.itemId] ? EQUIPMENT_DB[output.itemId].name : output.itemId) + " ×" + output.qty;
  const ammoName = output.weapon === "laser" ? "激光弹药" : output.weapon === "missile" ? "导弹" : "炮台弹药";
  return "产出：" + ammoName + " +" + output.qty;
}

function getEquipEngOutputHtml(recipe) {
  if (recipe.output.type !== "equipment") return getEquipEngOutputText(recipe);
  const equipment = EQUIPMENT_DB[recipe.output.itemId];
  const attributes = equipment ? getEquipmentAttributeText(equipment, "\n") : "";
  const slotName = { high:"高槽", mid:"中槽", low:"低槽", rig:"改装件" }[recipe.slot] || "装备";
  return '产出：<span class="equip-output-name" title="' + attributes + '">' + recipe.name + "</span> ×" + recipe.output.qty + "（" + slotName + "）";
}

function applyEquipEngOutput(recipe, cycles) {
  const output = recipe.output;
  const total = output.qty * cycles;
  if (output.type === "equipment") {
    if (!gameState.equipment) gameState.equipment = { inventory:[] };
    if (!Array.isArray(gameState.equipment.inventory)) gameState.equipment.inventory = [];
    for (let index = 0; index < cycles; index++) gameState.equipment.inventory.push(output.itemId);
  } else if (output.type === "fuel") {
    ResourceRegistry.add(gameState, "consumable:fuel", total);
  } else if (output.type === "ammo") {
    ResourceRegistry.add(gameState, "ammo:" + output.weapon, total);
  } else if (output.type === "probe") {
    ResourceRegistry.add(gameState, "probe:" + output.itemId, total);
  }
}

/* ================================================================
   增强剂制造核心 — Phase 2A
   独立技能 boosterEngineering；配方 durationMs 固定 180000（Phase 2B 才消耗）；
   制造 time 受技能效率加速；产物走 booster: 命名空间（→ state.boosters.inventory）。
   仅制造与库存；不实装六槽装备、计时消耗与效果。
   ================================================================ */

function getBoosterEfficiency() {
  const lvl = (gameState.skills && gameState.skills.boosterEngineering && gameState.skills.boosterEngineering.lvl) || 1;
  const skillMult = 1 + lvl * 0.02;
  const stationMult = (typeof getStationLogisticsMultiplier === "function") ? Math.max(0.001, getStationLogisticsMultiplier(gameState)) : 1;
  // 研究批次 G：与 selectors.getBoosterManufacturingDisplayState 共用同一科研 API，保证显示/在线/离线三处一致
  const researchMult = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(gameState, ["allMfg", "booster"]) : 1;
  return skillMult * stationMult * researchMult;
}

function getSelectedBoosterRecipe() {
  return getBoosterRecipe(gameState.currentAction.boosterRecipeTarget || "mining_lubricant_n") || BOOSTER_RECIPES[0];
}

function getRunningBoosterRecipe() {
  return getBoosterRecipe(gameState.currentAction.startedBoosterRecipeTarget || gameState.currentAction.boosterRecipeTarget || "mining_lubricant_n") || null;
}

function isBoosterRecipeUnlocked(recipe) {
  if (!recipe) return false;
  const lvl = (gameState.skills && gameState.skills.boosterEngineering && gameState.skills.boosterEngineering.lvl) || 1;
  return lvl >= recipe.level;
}

// 单一材料约束下的最大可制造瓶数（不占货舱：产物入 boosters.inventory）。
function getBoosterMaxCyclesFromState(state, recipe) {
  if (!recipe || !recipe.cost) return 0;
  let cycles = Infinity;
  for (const [reference, qty] of Object.entries(recipe.cost)) {
    const need = Math.max(1, Number(qty) || 1);
    cycles = Math.min(cycles, Math.floor(ResourceRegistry.getMaterialStock(state, reference) / need));
  }
  return Number.isFinite(cycles) ? Math.max(0, cycles) : 0;
}

function getBoosterMaxCycles(recipe) {
  return getBoosterMaxCyclesFromState(gameState, recipe);
}

function hasEnoughBoosterInputs(recipe, cycles) {
  const count = Math.max(1, Number(cycles) || 1);
  return ResourceRegistry.canAffordCost(gameState, recipe.cost, count);
}

function deductBoosterInputs(recipe, cycles) {
  const count = Math.max(1, Number(cycles) || 1);
  if (!hasEnoughBoosterInputs(recipe, count)) return false;
  return ResourceRegistry.spendCost(gameState, recipe.cost, count);
}

function applyBoosterOutput(recipe, cycles) {
  const count = Math.max(1, Number(cycles) || 1);
  ResourceRegistry.add(gameState, recipe.output.itemId, recipe.output.qty * count);
}

function getBoosterCategoryRecipes(categoryId, qualityFilter) {
  return BOOSTER_RECIPES.filter(recipe => {
    const series = BOOSTER_SERIES[recipe.series];
    if (!series || series.category !== categoryId) return false;
    if (qualityFilter && qualityFilter !== "all" && recipe.quality !== qualityFilter) return false;
    return true;
  });
}
