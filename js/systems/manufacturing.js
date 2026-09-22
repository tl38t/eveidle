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

// 总装 materialCost 先过精密配给剂权威报价（不复制 ceil×0.9/+5 公式），再用于船坞节省 quote / 扣料。
function getDiscountedAssemblyRecipe(state, recipe) {
  const asmQuote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, recipe, { kind:"assembly" }) : { cost: (recipe && recipe.materialCost) || {} };
  return Object.assign({}, recipe, { materialCost: asmQuote.cost });
}

// 舰船组装材料校验（精密配给剂折扣后）。注意：船坞材料节省仅作用于部件制造，总装不再享受。
function hasEnoughShipAssemblyComponents(recipe, cycles) {
  const multiplier = cycles || 1;
  // 先按精密配给剂权威报价折扣 materialCost
  const discountedRecipe = getDiscountedAssemblyRecipe(gameState, recipe);
  const hasComponents = Object.entries(getShipAssemblyComponentCost(recipe)).every(([id, count]) =>
    ResourceRegistry.get(gameState, "component:" + id) >= count * multiplier
  );
  return hasComponents && ResourceRegistry.canAffordCost(gameState, discountedRecipe.materialCost, multiplier);
}

// 舰船组装材料扣除（精密配给剂折扣后）。注意：船坞材料节省仅作用于部件制造，总装不再享受。
function deductShipAssemblyComponents(recipe, cycles) {
  const multiplier = cycles || 1;
  // 先按精密配给剂权威报价折扣 materialCost
  const discountedRecipe = getDiscountedAssemblyRecipe(gameState, recipe);
  for (const [id, count] of Object.entries(getShipAssemblyComponentCost(recipe))) {
    ResourceRegistry.spend(gameState, "component:" + id, count * multiplier);
  }
  ResourceRegistry.spendCost(gameState, discountedRecipe.materialCost, multiplier);
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

// 带船坞节省的舰船部件制造成本校验（船坞材料节省仅作用于部件制造，总装不再享受）
function hasEnoughShipCompMats(cost, recipeId) {
  const pseudo = { materialCost: cost, id: recipeId || null };
  if (typeof getShipyardProductionQuote === "function" && typeof getShipyardSavingRate === "function" && getShipyardSavingRate(gameState) > 0) {
    const quote = getShipyardProductionQuote(gameState, pseudo, 1);
    for (const [ref, qty] of Object.entries(quote.payable)) {
      if (ResourceRegistry.getByRef(gameState, ref) < qty) return false;
    }
    return true;
  }
  return ResourceRegistry.canAffordCost(gameState, cost);
}

// 带船坞节省的舰船部件制造成本扣除（船坞材料节省仅作用于部件制造，总装不再享受）
function deductShipCompMats(cost, recipeId) {
  const pseudo = { materialCost: cost, id: recipeId || null };
  if (typeof getShipyardProductionQuote === "function" && typeof commitShipyardProductionQuote === "function" && typeof getShipyardSavingRate === "function" && getShipyardSavingRate(gameState) > 0) {
    const quote = getShipyardProductionQuote(gameState, pseudo, 1);
    const result = commitShipyardProductionQuote(gameState, quote);
    if (result.changed !== true) return false;
    if (quote.totalSaved > 0 && typeof GameEvents !== "undefined") {
      GameEvents.emit("station:shipyardMaterialsSaved", { recipeId:quote.recipeId, kind:"component", savings:quote.saved, totalSaved:quote.totalSaved }, { source:"station" });
    }
    return true;
  }
  ResourceRegistry.spendCost(gameState, cost);
  return true;
}

// 带船坞节省的舰船部件制造成本批量扣除（离线结算用，cycles 倍乘）
function deductShipCompMatsMultiple(cost, cycles, recipeId) {
  const pseudo = { materialCost: cost, id: recipeId || null };
  if (typeof getShipyardProductionQuote === "function" && typeof commitShipyardProductionQuote === "function" && typeof getShipyardSavingRate === "function" && getShipyardSavingRate(gameState) > 0) {
    const quote = getShipyardProductionQuote(gameState, pseudo, cycles || 1);
    return commitShipyardProductionQuote(gameState, quote).changed === true;
  }
  ResourceRegistry.spendCost(gameState, cost, cycles || 1);
  return true;
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

function getEquipEngEfficiency(recipe) {
  const skillMult = 1 + getEffectiveSkillLevel(gameState, "equipmentEngineering") * 0.02;
  const stationMult = (typeof getStationLogisticsMultiplier === "function") ? Math.max(0.001, getStationLogisticsMultiplier(gameState, "equipEng")) : 1;
  // 研究批次 G：与 selectors.getEquipmentEngineeringDisplayState 共用同一科研 API，保证显示/在线/离线三处一致
  const researchMult = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(gameState, ["allMfg", "equip"]) : 1;
  // 装备总装协调剂（equipmentSpeed）：激活期间缩短装备制造耗时；与舰船 shipSpeed 同一乘区模型。
  const boosterSpeed = (typeof getBoosterEffectState === "function") ? (getBoosterEffectState(gameState).equipmentSpeedMultiplier || 1) : 1;
  let total = skillMult * stationMult * researchMult * boosterSpeed;
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    total *= LEGION_NPC.getLegionContributionSnapshot(gameState).multipliers.equipment;
  }
  // TE 减免（蓝图发明·效率研究）：缩短装备工程制造耗时；per-recipe，无蓝图则无减免。
  const teR = (typeof window !== "undefined" && window.INVENTION && typeof window.INVENTION.teReductionForRecipe === "function")
    ? window.INVENTION.teReductionForRecipe(gameState, recipe || getEquipEngRecipe()) : 0;
  if (teR) total *= (1 - teR);
  return total;
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

function hasEnoughEquipEngInputs(recipe, cycles, chosenLevel, quotedCost) {
  const count = Math.max(1, Number(cycles) || 1);
  const cost = quotedCost || recipe.cost;
  if (!ResourceRegistry.canAffordCost(gameState, cost, count)) return false;
  if (!recipe.inputEquipment) return true;
  const level = (chosenLevel === undefined || chosenLevel === null)
    ? getEquipEngInputLevelFromState(gameState, recipe)
    : Math.max(0, Math.floor(Number(chosenLevel)));
  const itemId = recipe.inputEquipment.itemId;
  const required = Math.max(1, Number(recipe.inputEquipment.quantity) || 1) * count;
  const groups = getGroupedInputEquipmentCandidates(gameState, itemId);
  return (groups[level] || 0) >= required;
}

function deductEquipEngInputs(recipe, cycles, chosenLevel, quotedCost) {
  const count = Math.max(1, Number(cycles) || 1);
  const cost = quotedCost || recipe.cost;
  if (!hasEnoughEquipEngInputs(recipe, count, chosenLevel, cost)) return false;
  ResourceRegistry.spendCost(gameState, cost, count);
  if (!recipe.inputEquipment) return true;
  const level = (chosenLevel === undefined || chosenLevel === null)
    ? getEquipEngInputLevelFromState(gameState, recipe)
    : Math.max(0, Math.floor(Number(chosenLevel)));
  const itemId = recipe.inputEquipment.itemId;
  const required = Math.max(1, Number(recipe.inputEquipment.quantity) || 1) * count;
  if (!gameState.equipment) gameState.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (level === 0) {
    const inventory = gameState.equipment.inventory || (gameState.equipment.inventory = []);
    for (let index = 0; index < required; index++) {
      const inventoryIndex = inventory.indexOf(itemId);
      if (inventoryIndex >= 0) inventory.splice(inventoryIndex, 1);
    }
  } else {
    const removeIds = [];
    let removed = 0;
    for (const inst of gameState.equipment.instances) {
      if (removed >= required) break;
      if (inst.itemId === itemId && Math.max(0, Math.floor(Number(inst.enhancementLevel) || 0)) === level && !inst.installedOn) {
        removeIds.push(inst.instanceId); removed++;
      }
    }
    if (removed < required) return false; // 安全保护（理论上 hasEnough 已拦截）
    const removeSet = new Set(removeIds);
    gameState.equipment.instances = gameState.equipment.instances.filter(inst => !removeSet.has(inst.instanceId));
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
  if (recipe.category === "mining") return "fa-solid fa-gem";
  if (recipe.category === "gas") return "fa-solid fa-cloud";
  if (recipe.category === "collect_boost") return "fa-solid fa-arrow-up";
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
  if (output.type === "probe") return "产出：🛰 探针 " + ((typeof getResourceDisplayName === "function" ? getResourceDisplayName("probe:" + output.itemId) : null) || output.itemId) + " ×" + output.qty;
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

function applyEquipEngOutput(recipe, cycles, chosenLevel) {
  const output = recipe.output;
  const count = Math.max(1, Number(cycles) || 1);
  const total = output.qty * count;
  if (output.type === "equipment") {
    if (!gameState.equipment) gameState.equipment = { inventory:[], instances:[], nextInstanceId:1 };
    const level = (chosenLevel === undefined || chosenLevel === null)
      ? getEquipEngInputLevelFromState(gameState, recipe)
      : Math.max(0, Math.floor(Number(chosenLevel)));
    const outLevel = Math.max(0, Math.floor(level / 3));
    if (recipe.inputEquipment && outLevel > 0) {
      // 继承强化：产出为带等级的实例（强化件永留 instances 池，不回流 inventory）
      if (!Array.isArray(gameState.equipment.instances)) gameState.equipment.instances = [];
      for (let index = 0; index < total; index++) {
        const instanceId = allocateEquipmentInstanceId(gameState);
        gameState.equipment.instances.push({ instanceId, itemId:output.itemId, enhancementLevel:outLevel, installedOn:null });
      }
    } else {
      // +0（或未消耗输入装备的普通配方）：维持库存字符串池（与既有 +0 模型一致）
      if (!Array.isArray(gameState.equipment.inventory)) gameState.equipment.inventory = [];
      for (let index = 0; index < total; index++) gameState.equipment.inventory.push(output.itemId);
    }
  } else if (output.type === "fuel") {
    ResourceRegistry.add(gameState, "consumable:fuel", total);
  } else if (output.type === "ammo") {
    addAmmo(gameState, { type: output.weapon, tier: output.tier || "T1", props: output.props, qty: total });
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

function getBoosterEfficiency(recipe) {
  const lvl = getEffectiveSkillLevel(gameState, "boosterEngineering");
  const skillMult = 1 + lvl * 0.02;
  const stationMult = (typeof getStationLogisticsMultiplier === "function") ? Math.max(0.001, getStationLogisticsMultiplier(gameState, "booster")) : 1;
  // 研究批次 G：与 selectors.getBoosterManufacturingDisplayState 共用同一科研 API，保证显示/在线/离线三处一致
  const researchMult = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(gameState, ["allMfg", "booster"]) : 1;
  // 脑插·增强剂增效（货柜 T4 来源）：效率 +6%，独立乘区
  const implantBoosterEff = (typeof getImplantBonuses === "function") ? getImplantBonuses(gameState).boosterEff : 1;
  // 增强剂·增强剂制造速度（考古重制 Phase B · 考古蓝图产出）：效率 × 速度乘区
  const boosterSpeedMult = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState).boosterSpeedMultiplier : 1;
  let total = skillMult * stationMult * researchMult * implantBoosterEff * boosterSpeedMult;
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    total *= LEGION_NPC.getLegionContributionSnapshot(gameState).multipliers.booster;
  }
  // TE 减免（蓝图发明·效率研究）：缩短增强剂制造耗时；per-recipe，无蓝图则无减免。
  const teR = (typeof window !== "undefined" && window.INVENTION && typeof window.INVENTION.teReductionForRecipe === "function")
    ? window.INVENTION.teReductionForRecipe(gameState, recipe || getSelectedBoosterRecipe()) : 0;
  if (teR) total *= (1 - teR);
  return total;
}

function getSelectedBoosterRecipe() {
  return getBoosterRecipe(gameState.currentAction.boosterRecipeTarget || "mining_lubricant_n") || BOOSTER_RECIPES[0];
}

function getRunningBoosterRecipe() {
  return getBoosterRecipe(gameState.currentAction.startedBoosterRecipeTarget || gameState.currentAction.boosterRecipeTarget || "mining_lubricant_n") || null;
}

function isBoosterRecipeUnlocked(recipe) {
  if (!recipe) return false;
  const lvl = getEffectiveSkillLevel(gameState, "boosterEngineering");
  if (lvl < recipe.level) return false;
  // 考古重做：requiresBlueprint 配方（新增 24 张）需对应蓝图解锁；既有 30 张无此标记，仅受等级限制。
  return typeof boosterRecipeHasRequiredBlueprint === "function"
    ? boosterRecipeHasRequiredBlueprint(gameState, recipe)
    : true;
}

// ME 减免后的增强剂配方成本（叠加蓝图发明里程碑减免）；无减免则原样返回 recipe.cost。
function meDiscountedBoosterCost(state, recipe) {
  if (typeof window !== "undefined" && window.INVENTION && typeof window.INVENTION.applyMeReduction === "function") {
    return window.INVENTION.applyMeReduction(state, recipe, recipe.cost);
  }
  return recipe.cost || {};
}

// 单一材料约束下的最大可制造瓶数（不占货舱：产物入 boosters.inventory）。
function getBoosterMaxCyclesFromState(state, recipe) {
  if (!recipe || !recipe.cost) return 0;
  const cost = meDiscountedBoosterCost(state, recipe);
  let cycles = Infinity;
  for (const [reference, qty] of Object.entries(cost)) {
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
  const cost = meDiscountedBoosterCost(gameState, recipe);
  return ResourceRegistry.canAffordCost(gameState, cost, count);
}

function deductBoosterInputs(recipe, cycles) {
  const count = Math.max(1, Number(cycles) || 1);
  const cost = meDiscountedBoosterCost(gameState, recipe);
  if (!ResourceRegistry.canAffordCost(gameState, cost, count)) return false;
  return ResourceRegistry.spendCost(gameState, cost, count);
}

function applyBoosterOutput(recipe, cycles) {
  const count = Math.max(1, Number(cycles) || 1);
  ResourceRegistry.add(gameState, recipe.output.itemId, recipe.output.qty * count);
}

function getBoosterCategoryRecipes(categoryId, qualityFilter) {
  return BOOSTER_RECIPES.filter(recipe => {
    const series = BOOSTER_SERIES[recipe.series];
    if (!series) return false;
    const cats = Array.isArray(series.category) ? series.category : [series.category];
    if (!cats.includes(categoryId)) return false;
    if (qualityFilter && qualityFilter !== "all" && recipe.quality !== qualityFilter) return false;
    return true;
  });
}

// 双模式出口（微信小游戏 CommonJS 适配）：本文件 39 个顶层声明被 js/core/actions.js、js/core/offline.js、js/core/selectors.js 等 跨文件消费，
// 在小游戏的模块包裹下不显式导出即不可见；浏览器侧为幂等赋值，行为零变化。
// 写法与 js/data/ships.js 等已上线的同款出口一致。
if (typeof window !== "undefined") window.getShipAssemblyComponentCost = getShipAssemblyComponentCost;
if (typeof window !== "undefined") window.hasEnoughShipAssemblyComponents = hasEnoughShipAssemblyComponents;
if (typeof window !== "undefined") window.isBoosterRecipeUnlocked = isBoosterRecipeUnlocked;
if (typeof window !== "undefined") window.getDiscountedAssemblyRecipe = getDiscountedAssemblyRecipe;
if (typeof window !== "undefined") window.deductShipAssemblyComponents = deductShipAssemblyComponents;
if (typeof window !== "undefined") window.getEquipEngEfficiency = getEquipEngEfficiency;
if (typeof window !== "undefined") window.hasEnoughBoosterInputs = hasEnoughBoosterInputs;
if (typeof window !== "undefined") window.getRunningShipCompRecipe = getRunningShipCompRecipe;
if (typeof window !== "undefined") window.getRunningShipAsmRecipe = getRunningShipAsmRecipe;
if (typeof window !== "undefined") window.getEquipEngRecipe = getEquipEngRecipe;
if (typeof window !== "undefined") window.getRunningEquipEngRecipe = getRunningEquipEngRecipe;
if (typeof window !== "undefined") window.deductEquipEngInputs = deductEquipEngInputs;
if (typeof window !== "undefined") window.getEquipEngTierLabel = getEquipEngTierLabel;
if (typeof window !== "undefined") window.getEquipEngOutputText = getEquipEngOutputText;
if (typeof window !== "undefined") window.applyEquipEngOutput = applyEquipEngOutput;
if (typeof window !== "undefined") window.getBoosterEfficiency = getBoosterEfficiency;
if (typeof window !== "undefined") window.getRunningBoosterRecipe = getRunningBoosterRecipe;
if (typeof window !== "undefined") window.deductBoosterInputs = deductBoosterInputs;
if (typeof window !== "undefined") window.applyBoosterOutput = applyBoosterOutput;
if (typeof window !== "undefined") window.getBoosterCategoryRecipes = getBoosterCategoryRecipes;
if (typeof window !== "undefined") window.getShipCompRecipe = getShipCompRecipe;
if (typeof window !== "undefined") window.getShipAsmRecipe = getShipAsmRecipe;
if (typeof window !== "undefined") window.getMaxShipAssemblyCycles = getMaxShipAssemblyCycles;
if (typeof window !== "undefined") window.shipAssemblyRequiresBlueprint = shipAssemblyRequiresBlueprint;
if (typeof window !== "undefined") window.getMaterialStock = getMaterialStock;
if (typeof window !== "undefined") window.hasEnoughShipCompMats = hasEnoughShipCompMats;
if (typeof window !== "undefined") window.deductShipCompMats = deductShipCompMats;
if (typeof window !== "undefined") window.deductShipCompMatsMultiple = deductShipCompMatsMultiple;
if (typeof window !== "undefined") window.buyBlueprint = buyBlueprint;
if (typeof window !== "undefined") window.switchShipCompTarget = switchShipCompTarget;
if (typeof window !== "undefined") window.switchShipAsmTarget = switchShipAsmTarget;
if (typeof window !== "undefined") window.startShipAssembly = startShipAssembly;
if (typeof window !== "undefined") window.getEquipEngCategoryDefinition = getEquipEngCategoryDefinition;
if (typeof window !== "undefined") window.getEquipEngMaxCycles = getEquipEngMaxCycles;
if (typeof window !== "undefined") window.hasEnoughEquipEngInputs = hasEnoughEquipEngInputs;
if (typeof window !== "undefined") window.getEquipEngRecipeIcon = getEquipEngRecipeIcon;
if (typeof window !== "undefined") window.switchEquipEngCategory = switchEquipEngCategory;
if (typeof window !== "undefined") window.switchEquipEngTarget = switchEquipEngTarget;
if (typeof window !== "undefined") window.getBoosterMaxCyclesFromState = getBoosterMaxCyclesFromState;
if (typeof module !== "undefined" && module.exports) module.exports = { getShipAssemblyComponentCost: getShipAssemblyComponentCost, hasEnoughShipAssemblyComponents: hasEnoughShipAssemblyComponents, isBoosterRecipeUnlocked: isBoosterRecipeUnlocked, getDiscountedAssemblyRecipe: getDiscountedAssemblyRecipe, deductShipAssemblyComponents: deductShipAssemblyComponents, getEquipEngEfficiency: getEquipEngEfficiency, hasEnoughBoosterInputs: hasEnoughBoosterInputs, getRunningShipCompRecipe: getRunningShipCompRecipe, getRunningShipAsmRecipe: getRunningShipAsmRecipe, getEquipEngRecipe: getEquipEngRecipe, getRunningEquipEngRecipe: getRunningEquipEngRecipe, deductEquipEngInputs: deductEquipEngInputs, getEquipEngTierLabel: getEquipEngTierLabel, getEquipEngOutputText: getEquipEngOutputText, applyEquipEngOutput: applyEquipEngOutput, getBoosterEfficiency: getBoosterEfficiency, getRunningBoosterRecipe: getRunningBoosterRecipe, deductBoosterInputs: deductBoosterInputs, applyBoosterOutput: applyBoosterOutput, getBoosterCategoryRecipes: getBoosterCategoryRecipes, getShipCompRecipe: getShipCompRecipe, getShipAsmRecipe: getShipAsmRecipe, getMaxShipAssemblyCycles: getMaxShipAssemblyCycles, shipAssemblyRequiresBlueprint: shipAssemblyRequiresBlueprint, getMaterialStock: getMaterialStock, hasEnoughShipCompMats: hasEnoughShipCompMats, deductShipCompMats: deductShipCompMats, deductShipCompMatsMultiple: deductShipCompMatsMultiple, buyBlueprint: buyBlueprint, switchShipCompTarget: switchShipCompTarget, switchShipAsmTarget: switchShipAsmTarget, startShipAssembly: startShipAssembly, getEquipEngCategoryDefinition: getEquipEngCategoryDefinition, getEquipEngMaxCycles: getEquipEngMaxCycles, hasEnoughEquipEngInputs: hasEnoughEquipEngInputs, getEquipEngRecipeIcon: getEquipEngRecipeIcon, switchEquipEngCategory: switchEquipEngCategory, switchEquipEngTarget: switchEquipEngTarget, getBoosterMaxCyclesFromState: getBoosterMaxCyclesFromState };
