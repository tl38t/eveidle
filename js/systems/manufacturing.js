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

function hasEnoughShipAssemblyComponents(recipe, cycles) {
  const multiplier = cycles || 1;
  const hasComponents = Object.entries(getShipAssemblyComponentCost(recipe)).every(([id, count]) =>
    ResourceRegistry.get(gameState, "component:" + id) >= count * multiplier
  );
  return hasComponents && ResourceRegistry.canAffordCost(gameState, recipe.materialCost || {}, multiplier);
}

function deductShipAssemblyComponents(recipe, cycles) {
  const multiplier = cycles || 1;
  for (const [id, count] of Object.entries(getShipAssemblyComponentCost(recipe))) {
    ResourceRegistry.spend(gameState, "component:" + id, count * multiplier);
  }
  ResourceRegistry.spendCost(gameState, recipe.materialCost || {}, multiplier);
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
  return 1 + gameState.skills.equipmentEngineering.lvl * 0.02;
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
  }
}
