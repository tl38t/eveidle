/* ================================================================
   纯状态选择器 / View State

   规则：
   1. 只读取显式传入的 state 与静态配置。
   2. 不访问 DOM，不写入 state，不调用会修改 state 的兼容函数。
   3. 返回可序列化的普通对象，供原生 DOM、测试或未来框架共同消费。
   ================================================================ */

function getShipInstanceFromState(state, shipRef) {
  const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  return ships.find(ship => ship.instanceId === shipRef) || ships.find(ship => ship.shipId === shipRef) || null;
}

function getShipConfigById(shipId) {
  return STARTER_SHIPS[shipId]
    || INDUSTRIAL_SHIPS[shipId]
    || (typeof ARCHAEOLOGY_SHIPS !== "undefined" ? ARCHAEOLOGY_SHIPS[shipId] : undefined)
    || null;
}

function getShipAssignmentRestriction(config, actionKey, combatRecoveryActive) {
  const bonuses = config && config.bonuses ? config.bonuses : {};
  if (!["combat", "mining", "gasHarvesting", "refining", "archaeology"].includes(actionKey)) return { reason:"unsupported-task", text:"该任务不需要分配舰船岗位" };
  if (actionKey === "combat" && combatRecoveryActive) return { reason:"repairing", text:"舰船自动维修中" };
  if (actionKey === "mining" && !(bonuses.miningLaserEfficiency > 0)) return { reason:"unsupported-mining", text:"该舰船没有采矿岗位" };
  if (actionKey === "gasHarvesting" && !(bonuses.gasLaserEfficiency > 0)) return { reason:"unsupported-gas", text:"该舰船没有采气岗位" };
  if (actionKey === "refining" && !(bonuses.smeltingSpeed > 0)) return { reason:"unsupported-refining", text:"只有工业支援舰可以承担冶炼岗位" };
  if (actionKey === "archaeology" && !((bonuses.archaeologyScanStrength || 0) > 0)) return { reason:"unsupported-archaeology", text:"该舰船没有考古扫描能力" };
  return null;
}

function getAssignedShipState(state, actionKey) {
  const assignment = state && state.shipAssignments ? state.shipAssignments[actionKey] : null;
  const instance = assignment ? getShipInstanceFromState(state, assignment) : null;
  return instance ? { instance, config:getShipConfigById(instance.shipId) } : { instance:null, config:null };
}

function getFittingFromInstance(instance) {
  const fitted = instance && instance.fitted ? instance.fitted : {};
  return {
    high:Array.isArray(fitted.high) ? fitted.high.slice() : [],
    mid:Array.isArray(fitted.mid) ? fitted.mid.slice() : [],
    low:Array.isArray(fitted.low) ? fitted.low.slice() : [],
    rig:Array.isArray(fitted.rig) ? fitted.rig.slice() : []
  };
}

function getFleetMiningSupportState(state, assignedInstance) {
  const assignedConfig = assignedInstance ? getShipConfigById(assignedInstance.shipId) : null;
  if (!assignedConfig || !INDUSTRIAL_SHIPS[assignedConfig.id]) return { bonus:0, ship:null };
  const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  let best = { bonus:0, ship:null };
  for (const instance of ships) {
    const config = getShipConfigById(instance.shipId);
    const bonus = config && config.bonuses ? Number(config.bonuses.fleetMiningSpeed) || 0 : 0;
    if (bonus <= best.bonus) continue;
    if (config.fleetMiningExcludesSelf && instance.instanceId === assignedInstance.instanceId) continue;
    best = { bonus, ship:{ id:config.id, name:config.name } };
  }
  return best;
}

function getCargoUsedFromState(state) {
  return ResourceRegistry.getCargoTotal(state);
}

function getGlobalDisplayState(state, cargoCapacity) {
  const resources = state && state.resources ? state.resources : {};
  const capacity = cargoCapacity || 10000000;
  const cargoUsed = getCargoUsedFromState(state);
  return {
    isk:ResourceRegistry.get(state, "currency:isk"),
    lp:ResourceRegistry.get(state, "currency:lp"),
    cargo:{
      used:cargoUsed,
      capacity,
      full:cargoUsed >= capacity,
      percent:Math.min(100, Math.floor(cargoUsed / capacity * 100))
    },
    quickOres:ResourceRegistry.listStateEntries(state, "ore")
      .filter(entry => entry.quantity > 0)
      .slice(0, 4)
      .map(entry => ({ name:entry.definition.name, value:entry.quantity }))
  };
}

function getSidebarDisplayState(state) {
  const combatLevel = getCombatLevelBreakdownFromState(state);
  return Object.entries((state && state.skills) || {}).map(([key, skill]) => {
    if (key === "combat") {
      return {
        key,
        level:combatLevel.level,
        xp:null,
        xpNeeded:null,
        levelClass:combatLevel.level >= 60 ? "lv-high" : combatLevel.level >= 20 ? "lv-mid" : "lv-low",
        tooltip:"战斗等级 = ⌊(最高攻击技能 + 最高防御技能) ÷ 2⌋\n" +
          "攻击技能：激光、炮台、导弹取最高 = Lv." + combatLevel.attack + "\n" +
          "防御技能：护盾、装甲、结构取最高 = Lv." + combatLevel.defense + "\n" +
          "当前：⌊(" + combatLevel.attack + " + " + combatLevel.defense + ") ÷ 2⌋ = Lv." + combatLevel.level
      };
    }
    const level = Number(skill.lvl) || 1;
    return {
      key,
      level,
      xp:Number(skill.xp) || 0,
      xpNeeded:xpForLevel(level + 1),
      levelClass:level >= 60 ? "lv-high" : level >= 20 ? "lv-mid" : "lv-low"
    };
  });
}

function getSkillShellDisplayState(state, viewKey) {
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipEngineering:"🚀", equipmentEngineering:"🔧", combat:"⚔", archaeology:"🛰️" };
  const skill = state.skills[viewKey] || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  const running = Boolean(state.currentAction.active && state.currentAction.skill === viewKey);
  return {
    key:viewKey,
    name:SKILL_LABEL[viewKey] || viewKey,
    icon:icons[viewKey] || "▶",
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    status:running ? "进行中" : "待命",
    running
  };
}

function getCurrentActivityDisplayState(state) {
  const action = state.currentAction;
  if (!action.active) return { active:false, text:"待命" };
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipEngineering:"🚀", equipmentEngineering:"🔧", combat:"⚔", archaeology:"🛰️" };
  const key = action.skill;
  const skill = state.skills[key] || { lvl:1 };
  let detail = "";
  if (key === "archaeology") {
    const site = getArchaeologySite(state.archaeology && state.archaeology.activeSiteId);
    detail = site ? "解析" + site.name : "考古待命";
  }
  if (key === "mining") detail = "采集" + getAreaByName(ALL_MINING_AREAS, action.startedArea || action.area).ore;
  else if (key === "refining") {
    const recipe = SMELTING_RECIPES.find(item => item.name === (action.startedSmeltingArea || action.smeltingArea)) || SMELTING_RECIPES[0];
    detail = "冶炼" + recipe.consumeOre + "→" + recipe.outputMineral;
  } else if (key === "gasHarvesting") detail = "采集" + getAreaByName(GAS_AREAS, action.startedGasArea || action.gasArea).gas;
  else if (key === "shipEngineering") {
    if (action.shipSubAction === "component") {
      const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === (action.startedShipCompTarget || action.shipCompTarget)) || SHIP_COMPONENT_RECIPES[0];
      detail = "制造" + recipe.name;
    } else {
      const recipe = SHIP_ASSEMBLY_RECIPES.find(item => item.id === (action.startedShipAsmTarget || action.shipAsmTarget)) || SHIP_ASSEMBLY_RECIPES[0];
      detail = "合成" + recipe.name;
    }
  } else if (key === "equipmentEngineering") {
    const recipe = getEquipmentEngineeringRecipe(action.startedEquipEngTarget || action.equipEngTarget);
    detail = "制造" + recipe.name;
  } else if (key === "combat") detail = "交战中 波次" + (state.combat.wave || 1);
  return {
    active:true,
    key,
    level:Number(skill.lvl) || 1,
    detail,
    text:(icons[key] || "▶") + " " + (SKILL_LABEL[key] || key) + " Lv." + (Number(skill.lvl) || 1) + " · " + detail + " · 进行中"
  };
}

function getAreaByName(areas, name) {
  return areas.find(area => area.name === name || area.ore === name || area.gas === name) || areas[0];
}

function getProductionEfficiencyState(state, actionKey) {
  const isMining = actionKey === "mining";
  const skillKey = isMining ? "mining" : "gasHarvesting";
  const primaryKey = isMining ? "miningEfficiency" : "gasEfficiency";
  const secondaryKey = isMining ? "miningBonus" : "gasBonus";
  const amplifierKey = isMining ? "miningLaserEfficiency" : "gasLaserEfficiency";
  const skill = state.skills[skillKey] || { lvl:1 };
  const level = Number(skill.lvl) || 1;
  const skillMultiplier = 1 + level * 0.02;
  const assigned = getAssignedShipState(state, actionKey);
  const fitting = getFittingFromInstance(assigned.instance);
  const enhancement = assigned.instance && assigned.config
    ? getShipEnhancementBonuses(assigned.config, assigned.instance.enhancementLevel)
    : { industryMultiplier:1 };
  const shipAmplifier = assigned.config && assigned.config.bonuses ? (assigned.config.bonuses[amplifierKey] || 0) : 0;
  const fleetSupport = isMining ? getFleetMiningSupportState(state, assigned.instance) : { bonus:0, ship:null };
  const equipment = [];
  let equipmentAmplifier = 0;
  let primaryBonus = 0;
  let secondaryBonus = 0;

  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of fitting[slot]) {
      const resolved = resolveEquipmentReference(state, ref);
      const item = resolved && resolved.definition;
      if (item && item.bonuses) equipmentAmplifier += (item.bonuses[amplifierKey] || 0) * resolved.multiplier;
    }
  }
  const amplifier = shipAmplifier + equipmentAmplifier;

  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of fitting[slot]) {
      const resolved = resolveEquipmentReference(state, ref);
      const item = resolved && resolved.definition;
      if (!item || !item.bonuses) continue;
      const multiplier = resolved.multiplier;
      const rawPrimary = (item.bonuses[primaryKey] || 0) * multiplier;
      const adjustedPrimary = slot === "high" ? rawPrimary * (1 + amplifier) : rawPrimary;
      const secondary = (item.bonuses[secondaryKey] || 0) * multiplier;
      const amplifierBonus = (item.bonuses[amplifierKey] || 0) * multiplier;
      if (adjustedPrimary || secondary || amplifierBonus) {
        primaryBonus += adjustedPrimary;
        secondaryBonus += secondary;
        equipment.push({ name:item.name, slot, rawPrimary, adjustedPrimary, secondary, amplifierBonus });
      }
    }
  }

  return {
    actionKey,
    level,
    skillMultiplier,
    ship:assigned.config ? { id:assigned.config.id, name:assigned.config.name } : null,
    shipAmplifier,
    equipmentAmplifier,
    amplifier,
    equipment,
    primaryBonus,
    secondaryBonus,
    enhancementMultiplier:enhancement.industryMultiplier,
    enhancementLevel:assigned.instance ? normalizeShipEnhancementLevel(assigned.instance.enhancementLevel) : 0,
    fleetSupportBonus:fleetSupport.bonus,
    fleetSupportShip:fleetSupport.ship,
    total:skillMultiplier * (1 + primaryBonus) * (1 + secondaryBonus) * enhancement.industryMultiplier * (1 + fleetSupport.bonus)
  };
}

function buildProductionEfficiencyTooltip(display, targetName, baseTime) {
  const isMining = display.actionKey === "mining";
  const activityName = isMining ? "采矿" : "气体采集";
  const lines = ["技能：1 × (1 + Lv." + display.level + " × 0.02) = " + display.skillMultiplier.toFixed(2) + "x"];
  if (display.ship) lines.push("工业舰：" + display.ship.name);
  if (display.shipAmplifier > 0) lines.push("舰船强化：高槽采集装备效果 +" + (display.shipAmplifier * 100).toFixed(0) + "%");
  lines.push("装备加成：");
  if (display.equipment.length === 0) lines.push("- 无相关装备加成");
  for (const item of display.equipment) {
    const bonuses = [];
    if (item.adjustedPrimary) {
      let text = activityName + "效率 +" + (item.adjustedPrimary * 100).toFixed(1) + "%";
      if (item.adjustedPrimary !== item.rawPrimary) text += "（舰船强化前 " + (item.rawPrimary * 100).toFixed(1) + "%）";
      bonuses.push(text);
    }
    if (item.secondary) bonuses.push(activityName + "总加成 +" + (item.secondary * 100).toFixed(1) + "%");
    if (item.amplifierBonus) bonuses.push((isMining ? "采矿激光器" : "气云采集器") + "效果 +" + (item.amplifierBonus * 100).toFixed(1) + "%");
    lines.push("- " + item.name + "：" + bonuses.join("，"));
  }
  lines.push("装备小计：采集效率 +" + (display.primaryBonus * 100).toFixed(1) + "% / 高槽强化 +" + (display.equipmentAmplifier * 100).toFixed(1) + "%");
  if (display.enhancementLevel > 0) lines.push("舰船强化：+" + display.enhancementLevel + "，最终采集效率 ×" + display.enhancementMultiplier.toFixed(3));
  if (display.fleetSupportBonus > 0) lines.push("舰队采矿协同：" + display.fleetSupportShip.name + " +" + (display.fleetSupportBonus * 100).toFixed(0) + "%（只取最高值）");
  lines.push("最终效率：" + display.skillMultiplier.toFixed(2) + " × " + (1 + display.primaryBonus).toFixed(3) + " × " + (1 + display.secondaryBonus).toFixed(3) + " × " + display.enhancementMultiplier.toFixed(3) + " × " + (1 + display.fleetSupportBonus).toFixed(3) + " = " + display.total.toFixed(2) + "x");
  lines.push("", "当前目标：" + targetName, "基础时间：" + baseTime + "s", "实际时间：" + (baseTime / display.total).toFixed(1) + "s");
  return lines.join("\n");
}

function getProgressDisplayState(action, skillKey, duration, now) {
  const active = Boolean(action.active && action.skill === skillKey);
  if (!active || !Number.isFinite(duration) || duration <= 0) {
    return { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"—", duration:duration || 0 };
  }
  const elapsedSinceUpdate = Math.max(0, (now - (Number(action.lastProgressUpdate) || now)) / 1000);
  const elapsed = Math.max(0, (Number(action.progress) || 0) + elapsedSinceUpdate);
  const etaSeconds = Math.max(0, duration - elapsed);
  return {
    active:true,
    elapsed,
    percent:Math.min(100, Math.floor(elapsed / duration * 100)),
    etaSeconds,
    etaText:etaSeconds.toFixed(1) + "s",
    duration
  };
}

function getMoonMiningAccessState(state) {
  const assigned = getAssignedShipState(state, "mining");
  const fitting = getFittingFromInstance(assigned.instance);
  // fitted 现在保存 instanceId，必须通过 resolveEquipmentReference 解析
  const hasEquipment = fitting.high.some(ref => {
    const resolved = resolveEquipmentReference(state, ref);
    return resolved && resolved.definition && (resolved.definition.bonuses || {}).miningEfficiency > 0;
  });
  return { hasShip:Boolean(assigned.instance), hasEquipment };
}

function getMiningRequirementState(state, area) {
  const level = Number(state.skills.mining && state.skills.mining.lvl) || 1;
  if (!area || level < area.level) return { available:false, text:"需要采矿 Lv." + (area ? area.level : 1) };
  if (area.mode === "moon") {
    const access = getMoonMiningAccessState(state);
    if (!access.hasShip) return { available:false, text:"月矿需要分配一艘采矿舰船" };
    if (!access.hasEquipment) return { available:false, text:"月矿需要舰船高槽装配采矿激光器" };
    return { available:true, text:"已满足月矿采集条件" };
  }
  return { available:true, text:"已解锁，可开始采集" };
}

function getMiningDisplayState(state, now) {
  const action = state.currentAction;
  const current = getAreaByName(ALL_MINING_AREAS, action.area);
  const running = getAreaByName(ALL_MINING_AREAS, action.startedArea || action.area);
  const mode = action.miningMode === "moon" ? "moon" : "normal";
  const efficiency = getProductionEfficiencyState(state, "mining");
  const runningDuration = running.baseTime / efficiency.total;
  const progress = getProgressDisplayState(action, "mining", runningDuration, now);
  const targetChanged = progress.active && current.name !== running.name;
  const requirement = getMiningRequirementState(state, current);
  const level = Number(state.skills.mining && state.skills.mining.lvl) || 1;
  return {
    kind:"mining",
    current:{ ...current },
    running:{ ...running },
    mode,
    level,
    efficiency,
    efficiencyTooltip:buildProductionEfficiencyTooltip(efficiency, current.ore, current.baseTime),
    actualTime:current.baseTime / efficiency.total,
    progress,
    targetChanged,
    showStart:!progress.active || targetChanged,
    showStop:progress.active && !targetChanged,
    canStart:requirement.available,
    requirement,
    targets:(mode === "moon" ? MOON_MINING_AREAS : MINING_AREAS).map(area => ({
      ...area,
      locked:level < area.level,
      selected:current.name === area.name,
      running:progress.active && running.name === area.name
    }))
  };
}

function getSmeltingDisplayState(state, now) {
  const action = state.currentAction;
  const current = SMELTING_RECIPES.find(recipe => recipe.name === action.smeltingArea) || SMELTING_RECIPES[0];
  const running = SMELTING_RECIPES.find(recipe => recipe.name === (action.startedSmeltingArea || action.smeltingArea)) || current;
  const level = Number(state.skills.refining && state.skills.refining.lvl) || 1;
  const assigned = getAssignedShipState(state, "refining");
  const shipBonus = assigned.config && assigned.config.bonuses ? (assigned.config.bonuses.smeltingSpeed || 0) : 0;
  // 改装件冶炼速度加成（rig smeltingSpeed，加法并入船体加成）
  const rigMods = (assigned.instance && typeof getRigModifiers === "function")
    ? getRigModifiers(state, assigned.instance) : {};
  const rigBonus = rigMods.smeltingSpeed || 0;
  const skillEfficiency = 1 + level * 0.02;
  const efficiency = skillEfficiency * (1 + shipBonus + rigBonus);
  const progress = getProgressDisplayState(action, "refining", running.baseTime / efficiency, now);
  const targetChanged = progress.active && current.name !== running.name;
  const stock = ResourceRegistry.get(state, "ore:" + current.consumeOre);
  const runningStock = ResourceRegistry.get(state, "ore:" + running.consumeOre);
  return {
    kind:"refining",
    current:{ ...current },
    running:{ ...running },
    level,
    skillEfficiency,
    efficiency,
    ship:assigned.config ? { id:assigned.config.id, name:assigned.config.name } : null,
    shipBonus,
    rigBonus,
    actualTime:current.baseTime / efficiency,
    output:Math.max(1, Math.floor(current.baseOutput * skillEfficiency)),
    stock,
    runningStock,
    progress,
    targetChanged,
    showStart:!progress.active || targetChanged,
    showStop:progress.active && !targetChanged,
    canStart:level >= current.level,
    options:SMELTING_RECIPES.map(recipe => ({ ...recipe, locked:level < recipe.level, selected:recipe.name === current.name }))
  };
}

function getGasDisplayState(state, now) {
  const action = state.currentAction;
  const current = getAreaByName(GAS_AREAS, action.gasArea);
  const running = getAreaByName(GAS_AREAS, action.startedGasArea || action.gasArea);
  const level = Number(state.skills.gasHarvesting && state.skills.gasHarvesting.lvl) || 1;
  const efficiency = getProductionEfficiencyState(state, "gasHarvesting");
  const progress = getProgressDisplayState(action, "gasHarvesting", running.baseTime / efficiency.total, now);
  const targetChanged = progress.active && current.name !== running.name;
  return {
    kind:"gasHarvesting",
    current:{ ...current },
    running:{ ...running },
    level,
    efficiency,
    efficiencyTooltip:buildProductionEfficiencyTooltip(efficiency, current.gas, current.baseTime),
    actualTime:current.baseTime / efficiency.total,
    progress,
    targetChanged,
    showStart:!progress.active || targetChanged,
    showStop:progress.active && !targetChanged,
    canStart:level >= current.level,
    options:GAS_AREAS.map(area => ({ ...area, locked:level < area.level, selected:area.name === current.name }))
  };
}

function getMaterialStockFromState(state, material) {
  return ResourceRegistry.getMaterialStock(state, material);
}

function getShipAssemblyMaxCyclesFromState(state, recipe) {
  let max = Infinity;
  for (const [componentId, count] of Object.entries(getShipAssemblyComponentCost(recipe))) {
    max = Math.min(max, Math.floor(ResourceRegistry.get(state, "component:" + componentId) / count));
  }
  for (const [material, count] of Object.entries(recipe && recipe.materialCost || {})) {
    max = Math.min(max, Math.floor(getMaterialStockFromState(state, material) / count));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

function getEquipmentOwnedCountFromState(state, recipe) {
  if (recipe.output.type === "equipment") {
    const equipment = state.equipment || {};
    const inventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
    const instances = Array.isArray(equipment.instances) ? equipment.instances : [];
    return inventory.filter(itemId => itemId === recipe.output.itemId).length +
      instances.filter(instance => instance.itemId === recipe.output.itemId).length;
  }
  if (recipe.output.type === "fuel") return ResourceRegistry.get(state, "consumable:fuel");
  return ResourceRegistry.get(state, "ammo:" + recipe.output.weapon);
}

function getEquipmentMaxCyclesFromState(state, recipe) {
  let max = Infinity;
  for (const [material, quantity] of Object.entries(recipe.cost || {})) {
    max = Math.min(max, Math.floor(getMaterialStockFromState(state, material) / quantity));
  }
  if (recipe.inputEquipment) {
    const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
    const quantity = Math.max(1, Number(recipe.inputEquipment.quantity) || 1);
    const stock = inventory.filter(itemId => itemId === recipe.inputEquipment.itemId).length;
    max = Math.min(max, Math.floor(stock / quantity));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

function getActionConfirmationDisplayState(state, target, now) {
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipComp:"🔩", shipAsm:"⚓", equipmentEngineering:"🔧" };
  const result = {
    kind:"actionConfirmation",
    target,
    title:"",
    duration:1,
    outputText:"",
    requirements:[],
    maxCount:999999,
    unlimited:true,
    canOpen:true,
    blockedText:"",
    queue:null
  };

  if (target === "mining") {
    const display = getMiningDisplayState(state, now);
    result.title = icons.mining + " " + (SKILL_LABEL.mining || "采矿");
    result.duration = display.actualTime;
    result.outputText = display.current.ore + "×1";
    result.canOpen = display.canStart;
    result.blockedText = display.requirement.text;
    result.queue = { skill:"mining", target:display.current.name, label:display.current.ore };
  } else if (target === "refining") {
    const display = getSmeltingDisplayState(state, now);
    const recipe = display.current;
    result.title = icons.refining + " " + (SKILL_LABEL.refining || "冶炼");
    result.duration = display.actualTime;
    result.outputText = recipe.outputMineral + "×" + display.output;
    result.requirements = [{ resourceId:"ore:" + recipe.consumeOre, name:recipe.consumeOre, quantity:1, stock:display.stock, enough:display.stock >= 1 }];
    result.maxCount = Math.max(1, display.stock);
    result.unlimited = false;
    result.canOpen = display.canStart;
    result.blockedText = display.canStart ? "" : "需要冶炼等级 Lv." + recipe.level;
    result.queue = { skill:"refining", target:recipe.name, label:recipe.consumeOre + "→" + recipe.outputMineral };
  } else if (target === "gasHarvesting") {
    const display = getGasDisplayState(state, now);
    result.title = icons.gasHarvesting + " " + (SKILL_LABEL.gasHarvesting || "气体采集");
    result.duration = display.actualTime;
    result.outputText = display.current.gas + "×1";
    result.canOpen = display.canStart;
    result.blockedText = display.canStart ? "" : "需要气体采集等级 Lv." + display.current.level;
    result.queue = { skill:"gasHarvesting", target:display.current.name, label:display.current.gas };
  } else if (target === "equipmentEngineering") {
    const display = getEquipmentEngineeringDisplayState(state, now, "");
    const recipe = display.selectedRecipe;
    result.title = icons.equipmentEngineering + " " + (SKILL_LABEL.equipmentEngineering || "装备工程");
    result.duration = recipe.time / display.efficiency;
    result.requirements = [
      ...display.detail.equipmentInputs.map(item => ({ resourceId:"equipment:" + item.itemId, name:item.name, quantity:item.quantity, stock:item.stock, enough:item.enough })),
      ...display.detail.materials.map(item => ({ resourceId:ResourceRegistry.resolveMaterialIds(item.material)[0] || item.material, name:item.material, quantity:item.quantity, stock:item.stock, enough:item.enough }))
    ];
    result.maxCount = Math.max(1, getEquipmentMaxCyclesFromState(state, recipe));
    result.unlimited = false;
    if (recipe.output.type === "equipment") result.outputText = recipe.name + "×" + recipe.output.qty;
    else if (recipe.output.type === "fuel") result.outputText = "燃料单元×" + recipe.output.qty;
    else result.outputText = ({ laser:"激光晶体弹药", missile:"导弹", cannon:"炮台弹药" }[recipe.output.weapon] || "弹药") + "×" + recipe.output.qty;
    result.canOpen = display.level >= recipe.level && display.detail.hasRequiredBlueprint;
    result.blockedText = result.canOpen ? "" : !display.detail.hasRequiredBlueprint ? "需要先在 LP 商店购买" + recipe.name + "蓝图" : "需要装备工程等级 Lv." + recipe.level;
    result.queue = { skill:"equipmentEngineering", target:recipe.id, label:recipe.name };
  } else if (target === "shipComp") {
    const display = getShipEngineeringDisplayState(state, now);
    const recipe = display.currentComponent;
    result.title = icons.shipComp + " " + recipe.name;
    result.duration = recipe.time / display.efficiency;
    result.requirements = display.componentMaterials.map(item => ({ resourceId:ResourceRegistry.resolveMaterialIds(item.material)[0] || item.material, name:item.material, quantity:item.quantity, stock:item.stock, enough:item.enough }));
    result.maxCount = Math.max(1, result.requirements.reduce((max, item) => Math.min(max, Math.floor(item.stock / item.quantity)), 999999));
    result.unlimited = false;
    result.outputText = recipe.name + "×1";
    result.canOpen = display.canStartComponent;
    result.blockedText = result.canOpen ? "" : "需要舰船工程等级 Lv." + recipe.level;
    result.queue = { skill:"shipEngineering", target:recipe.name, label:recipe.name };
  } else if (target === "shipAsm") {
    const display = getShipEngineeringDisplayState(state, now);
    const recipe = display.currentAssembly;
    const option = display.assemblyOptions.find(item => item.id === recipe.id);
    result.title = icons.shipAsm + " " + recipe.name;
    result.duration = recipe.time / display.efficiency;
    result.requirements = [
      ...display.assemblyComponents.map(item => ({ resourceId:"component:" + item.id, name:item.name, quantity:item.quantity, stock:item.stock, enough:item.enough })),
      ...display.assemblyMaterials.map(item => ({ resourceId:item.material, name:item.material, quantity:item.quantity, stock:item.stock, enough:item.enough }))
    ];
    result.maxCount = Math.max(1, display.assemblyMaxCycles);
    result.unlimited = false;
    result.outputText = (display.selectedShip ? display.selectedShip.name : recipe.name) + "×1";
    result.canOpen = Boolean(option && option.unlocked);
    result.blockedText = !option || display.level < recipe.level ? "需要舰船工程等级 Lv." + recipe.level : option.hasRequiredBlueprint ? "" : "缺少舰船蓝图";
    result.queue = { skill:"shipEngineering", target:recipe.name, label:recipe.name };
  } else {
    result.canOpen = false;
    result.blockedText = "未知行动";
  }

  result.hasResources = result.requirements.every(item => item.enough);
  return result;
}

function getShipEngineeringDisplayState(state, now) {
  const action = state.currentAction;
  const skill = state.skills.shipEngineering || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  const efficiency = 1 + level * 0.02;
  const currentComponent = SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === action.shipCompTarget) || SHIP_COMPONENT_RECIPES[0];
  const runningComponent = SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === (action.startedShipCompTarget || action.shipCompTarget)) || currentComponent;
  const currentAssembly = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === action.shipAsmTarget) || SHIP_ASSEMBLY_RECIPES[0];
  const runningAssembly = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === (action.startedShipAsmTarget || action.shipAsmTarget)) || currentAssembly;
  const active = Boolean(action.active && action.skill === "shipEngineering");
  const componentActive = active && action.shipSubAction === "component";
  const assemblyActive = active && action.shipSubAction === "assembly";
  const componentProgress = componentActive
    ? getProgressDisplayState(action, "shipEngineering", runningComponent.time / efficiency, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:runningComponent.time / efficiency };
  const assemblyProgress = assemblyActive
    ? getProgressDisplayState(action, "shipEngineering", runningAssembly.time / efficiency, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:runningAssembly.time / efficiency };
  const ownedBlueprints = new Set(state.ownedBlueprints || []);
  const componentInventory = Object.fromEntries(ResourceRegistry.listStateEntries(state, "component").map(entry => [entry.definition.key, entry.quantity]));
  const selectedShip = getShipConfigById(currentAssembly.shipId);
  const shipCounts = {};
  for (const instance of (state.inventory && state.inventory.ships) || []) shipCounts[instance.shipId] = (shipCounts[instance.shipId] || 0) + 1;

  return {
    kind:"shipEngineering",
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    efficiency,
    active,
    status:active ? "进行中" : "待命",
    componentActive,
    assemblyActive,
    componentProgress,
    assemblyProgress,
    blueprints:SHIP_BLUEPRINTS.map(blueprint => ({
      ...blueprint,
      owned:ownedBlueprints.has(blueprint.shipId),
      canBuy:!ownedBlueprints.has(blueprint.shipId) && ResourceRegistry.get(state, "currency:" + (blueprint.costLP ? "lp" : "isk")) >= (blueprint.costLP || blueprint.costISK || 0)
    })),
    currentComponent:{ ...currentComponent },
    runningComponent:{ ...runningComponent },
    componentOptions:SHIP_COMPONENT_RECIPES.map(recipe => ({ ...recipe, unlocked:level >= recipe.level, selected:recipe.id === currentComponent.id })),
    componentMaterials:Object.entries(currentComponent.cost).map(([material, quantity]) => {
      const stock = getMaterialStockFromState(state, material);
      return { material, quantity, stock, enough:stock >= quantity };
    }),
    componentInventory:SHIP_COMPONENT_RECIPES.map(recipe => ({ id:recipe.id, name:recipe.name, quantity:Number(componentInventory[recipe.id]) || 0 })),
    currentAssembly:{ ...currentAssembly, componentCost:{ ...getShipAssemblyComponentCost(currentAssembly) }, materialCost:{ ...(currentAssembly.materialCost || {}) } },
    runningAssembly:{ ...runningAssembly, componentCost:{ ...getShipAssemblyComponentCost(runningAssembly) }, materialCost:{ ...(runningAssembly.materialCost || {}) } },
    assemblyOptions:SHIP_ASSEMBLY_RECIPES.map(recipe => {
      const requiresBlueprint = shipAssemblyRequiresBlueprint(recipe);
      const hasRequiredBlueprint = !requiresBlueprint || ownedBlueprints.has(recipe.shipId);
      return { ...recipe, requiresBlueprint, hasRequiredBlueprint, unlocked:level >= recipe.level && hasRequiredBlueprint, selected:recipe.id === currentAssembly.id };
    }),
    assemblyComponents:Object.entries(getShipAssemblyComponentCost(currentAssembly)).map(([componentId, quantity]) => {
      const info = SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === componentId);
      const stock = Number(componentInventory[componentId]) || 0;
      return { id:componentId, name:info ? info.name : componentId, quantity, stock, enough:stock >= quantity };
    }),
    assemblyMaterials:Object.entries(currentAssembly.materialCost || {}).map(([material, quantity]) => {
      const stock = getMaterialStockFromState(state, material);
      return { material, quantity, stock, enough:stock >= quantity };
    }),
    assemblyMaxCycles:getShipAssemblyMaxCyclesFromState(state, currentAssembly),
    canStartComponent:level >= currentComponent.level,
    canStartAssembly:level >= currentAssembly.level && (!shipAssemblyRequiresBlueprint(currentAssembly) || ownedBlueprints.has(currentAssembly.shipId)) && getShipAssemblyMaxCyclesFromState(state, currentAssembly) > 0,
    selectedShip:selectedShip ? { ...selectedShip, hp:{ ...selectedShip.hp }, slots:{ ...selectedShip.slots }, bonuses:{ ...selectedShip.bonuses }, capacitor:{ ...selectedShip.capacitor } } : null,
    ownedShips:Object.entries(shipCounts).map(([shipId, quantity]) => {
      const config = getShipConfigById(shipId);
      return { shipId, quantity, name:config ? config.name : shipId, hp:config ? { ...config.hp } : null };
    })
  };
}

function getEquipmentEngineeringDisplayState(state, now, searchTerm) {
  const action = state.currentAction;
  const skill = state.skills.equipmentEngineering || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  const efficiency = 1 + level * 0.02;
  const requestedRecipe = getEquipmentEngineeringRecipe(action.equipEngTarget || "t1_mining_laser");
  const savedCategory = EQUIPMENT_ENGINEERING_CATEGORIES.find(category => category.id === action.equipEngCategory);
  const category = savedCategory || getEquipEngCategoryDefinition(requestedRecipe.category);
  const normalizedSearch = String(searchTerm || "").trim().toLocaleLowerCase();
  const categoryRecipes = EQUIPMENT_ENGINEERING_RECIPES.filter(recipe => recipe.category === category.id);
  // 改装件二级筛选（类别：战斗/工业/考古，默认战斗；档位：全部/I~V，默认全部）。
  // 筛选计算全部在显示态层完成，UI 只消费结果，不在 DOM 层临时隐藏。
  const isRigCategory = category.id === "rigs";
  const rigSub = isRigCategory
    ? (RIG_ENGINEERING_SUBCATEGORIES.find(sub => sub.id === action.equipEngRigSub) || RIG_ENGINEERING_SUBCATEGORIES[0])
    : null;
  const rigTier = isRigCategory && RIG_ENGINEERING_TIERS.includes(action.equipEngRigTier) ? action.equipEngRigTier : "all";
  const filteredRecipes = isRigCategory
    ? categoryRecipes.filter(recipe => recipe.rigCategory === rigSub.id && (rigTier === "all" || recipe.rigTier === rigTier))
    : categoryRecipes;
  const visibleRecipes = filteredRecipes.filter(recipe => !normalizedSearch || recipe.name.toLocaleLowerCase().includes(normalizedSearch));
  // 改装件页：切换分类/档位/搜索时详情自动落到第一个可见配方（不影响其他类别既有行为）
  const selectionPool = isRigCategory ? (visibleRecipes.length ? visibleRecipes : filteredRecipes) : categoryRecipes;
  const selectedRecipe = selectionPool.find(recipe => recipe.id === requestedRecipe.id) ||
    selectionPool.find(recipe => level >= recipe.level) || selectionPool[0] || categoryRecipes[0] || requestedRecipe;
  const active = Boolean(action.active && action.skill === "equipmentEngineering");
  const runningRecipe = getEquipmentEngineeringRecipe(action.startedEquipEngTarget || action.equipEngTarget || "t1_mining_laser");
  const progress = active
    ? getProgressDisplayState(action, "equipmentEngineering", runningRecipe.time / efficiency, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:runningRecipe.time / efficiency };
  const selectedEquipment = selectedRecipe.output.type === "equipment" ? EQUIPMENT_DB[selectedRecipe.output.itemId] : null;
  const selectedHasRequiredBlueprint = equipmentRecipeHasRequiredBlueprint(state, selectedRecipe);
  const detailMaterials = Object.entries(selectedRecipe.cost || {}).map(([material, quantity]) => {
    const stock = getMaterialStockFromState(state, material);
    // material 保留内部键（namespace:itemId 或中文名），displayName 供 UI 展示（内部键解析为真实中文名）
    return { material, displayName:getResourceDisplayName(material), quantity, stock, enough:stock >= quantity };
  });
  const detailEquipmentInputs = selectedRecipe.inputEquipment ? (() => {
    const item = EQUIPMENT_DB[selectedRecipe.inputEquipment.itemId];
    const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
    const quantity = Math.max(1, Number(selectedRecipe.inputEquipment.quantity) || 1);
    const stock = inventory.filter(itemId => itemId === selectedRecipe.inputEquipment.itemId).length;
    return [{ itemId:selectedRecipe.inputEquipment.itemId, name:item ? item.name : selectedRecipe.inputEquipment.itemId, quantity, stock, enough:stock >= quantity }];
  })() : [];

  return {
    kind:"equipmentEngineering",
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    efficiency,
    active,
    status:active ? "进行中" : "待命",
    progress,
    searchTerm:String(searchTerm || ""),
    category:{ ...category },
    categories:EQUIPMENT_ENGINEERING_CATEGORIES.map(item => ({ ...item, selected:item.id === category.id })),
    rigFilters:isRigCategory ? {
      sub:rigSub.id,
      tier:rigTier,
      subcategories:RIG_ENGINEERING_SUBCATEGORIES.map(sub => ({ id:sub.id, name:sub.name, selected:sub.id === rigSub.id })),
      tiers:[{ id:"all", name:"全部" }, ...RIG_ENGINEERING_TIERS.map(tier => ({ id:tier, name:tier }))].map(tier => ({ ...tier, selected:tier.id === rigTier }))
    } : null,
    visibleCount:visibleRecipes.length,
    selectedRecipe:{ ...selectedRecipe, cost:{ ...(selectedRecipe.cost || {}) }, inputEquipment:selectedRecipe.inputEquipment ? { ...selectedRecipe.inputEquipment } : null, output:{ ...selectedRecipe.output } },
    runningRecipe:{ ...runningRecipe, cost:{ ...(runningRecipe.cost || {}) }, inputEquipment:runningRecipe.inputEquipment ? { ...runningRecipe.inputEquipment } : null, output:{ ...runningRecipe.output } },
    recipes:visibleRecipes.map(recipe => {
      const equipment = recipe.output.type === "equipment" ? EQUIPMENT_DB[recipe.output.itemId] : null;
      const attributes = equipment ? getEquipmentAttributeLines(equipment).slice(1, 3).join(" · ") : getEquipEngOutputText(recipe).replace("产出：", "");
      const slot = equipment ? (EQUIPMENT_SLOT_NAMES[equipment.slot] || "装备") : recipe.output.type === "fuel" ? "消耗品" : "弹药";
      return {
        id:recipe.id,
        name:recipe.name,
        level:recipe.level,
        xp:recipe.xp,
      tier:getEquipEngTierLabel(recipe),
        icon:getEquipEngRecipeIcon(recipe),
        slot,
        attributes:attributes || "基础制造配方",
        requiresBlueprint:Boolean(recipe.requiresBlueprint),
        hasRequiredBlueprint:equipmentRecipeHasRequiredBlueprint(state, recipe),
        unlocked:level >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe),
        selected:recipe.id === selectedRecipe.id,
        actualTime:recipe.time / efficiency,
        ownedCount:getEquipmentOwnedCountFromState(state, recipe)
      };
    }),
    detail:{
      title:selectedRecipe.name,
      tier:getEquipEngTierLabel(selectedRecipe),
      equipment:selectedEquipment ? { id:selectedEquipment.id, name:selectedEquipment.name } : null,
      attributes:selectedEquipment ? getEquipmentAttributeLines(selectedEquipment) : [],
      materials:detailMaterials,
      equipmentInputs:detailEquipmentInputs,
      outputText:getEquipEngOutputText(selectedRecipe),
      actualTime:selectedRecipe.time / efficiency,
      baseTime:selectedRecipe.time,
      xp:selectedRecipe.xp,
      requiresBlueprint:Boolean(selectedRecipe.requiresBlueprint),
      hasRequiredBlueprint:selectedHasRequiredBlueprint,
      maxCycles:getEquipmentMaxCyclesFromState(state, selectedRecipe),
      runningNote:active ? { name:runningRecipe.name, targetDiffers:runningRecipe.id !== selectedRecipe.id } : null
    },
    canStart:level >= selectedRecipe.level && selectedHasRequiredBlueprint,
    queue:{
      count:state.queue && Array.isArray(state.queue.items) ? state.queue.items.length : 0,
      maxSize:state.queue && state.queue.config ? state.queue.config.maxSize : 20
    }
  };
}

/* ================================================================
   增强剂制造纯显示态 — Phase 2A（§九）
   制造页只消费此状态：技能信息 / 分类标签 / 品质筛选 / 配方卡片 /
   制造控制 / 库存区。不含六槽装备、计时消耗、效果应用（Phase 2B）。
   ================================================================ */
function getBoosterManufacturingDisplayState(state, now) {
  const action = state.currentAction;
  const skill = state.skills.boosterEngineering || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpRequired = xpForLevel(level + 1);
  const efficiency = 1 + level * 0.02;

  // 分类与品质筛选（用户选择；运行中切换不改变正在制造的产物）。
  const categoryId = (BOOSTER_CATEGORY_META.find(c => c.id === action.boosterCategory) || BOOSTER_CATEGORY_META[0]).id;
  const qualityFilter = ["all", "n", "r", "l"].includes(action.boosterQualityFilter) ? action.boosterQualityFilter : "all";

  const isRunning = Boolean(action.active && action.skill === "boosterEngineering");
  const selectedRecipe = getBoosterRecipe(action.boosterRecipeTarget) || BOOSTER_RECIPES[0];
  const runningRecipe = getBoosterRecipe(action.startedBoosterRecipeTarget || action.boosterRecipeTarget) || selectedRecipe;
  const progress = isRunning
    ? getProgressDisplayState(action, "boosterEngineering", runningRecipe.time / efficiency, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:selectedRecipe.time / efficiency };

  const inventory = (state.boosters && state.boosters.inventory) || {};

  const filteredRecipes = BOOSTER_RECIPES.filter(recipe => {
    const series = BOOSTER_SERIES[recipe.series];
    if (!series || series.category !== categoryId) return false;
    if (qualityFilter !== "all" && recipe.quality !== qualityFilter) return false;
    return true;
  });

  const recipes = filteredRecipes.map(recipe => {
    const item = BOOSTER_ITEMS[recipe.id] || {};
    const isUnlocked = level >= recipe.level;
    const materialRows = Object.entries(recipe.cost || {}).map(([reference, quantity]) => {
      const required = Math.max(1, Number(quantity) || 1);
      const stock = ResourceRegistry.getMaterialStock(state, reference);
      return { reference, displayName:getResourceDisplayName(reference), required, stock, enough:stock >= required };
    });
    const hasMaterials = materialRows.every(row => row.enough);
    // 库存按裸 id 键存于 state.boosters.inventory（ResourceRegistry 命名空间去前缀），经 ResourceRegistry.get 统一寻址
    const owned = Number(ResourceRegistry.get(state, recipe.itemId) || 0) || 0;
    let lockedReason = "";
    if (!isUnlocked) lockedReason = "需要增强剂制造 Lv." + recipe.level;
    else if (!hasMaterials) lockedReason = "材料不足";
    return {
      id:recipe.id,
      itemId:recipe.itemId,
      displayName:item.name || recipe.id,
      seriesName:item.seriesName || "",
      qualityName:item.qualityName || "",
      category:item.category || categoryId,
      level:recipe.level,
      xp:recipe.xp,
      time:recipe.time,
      effectiveTime:recipe.time / efficiency,
      durationSeconds:Math.round((recipe.durationMs || BOOSTER_DURATION_MS) / 1000),
      effectText:(typeof describeBoosterEffect === "function") ? describeBoosterEffect(recipe.effect.type, recipe.effect.value) : "",
      materialRows,
      required:materialRows.reduce((sum, row) => sum + row.required, 0),
      owned,
      stock:owned,
      isUnlocked,
      hasMaterials,
      canManufacture:isUnlocked && hasMaterials,
      lockedReason,
      selected:recipe.id === selectedRecipe.id,
      running:isRunning && recipe.id === runningRecipe.id
    };
  });

  // 库存卡片：所有已拥有增强剂（跨分类展示），按中文名排序。
  const inventoryCards = Object.keys(inventory)
    .map(key => {
      const item = getBoosterItem(key);
      const qty = Number(inventory[key] || 0) || 0;
      if (!item || qty <= 0) return null;
      return {
        itemId:item.itemId,
        id:item.id,
        displayName:item.name,
        seriesName:item.seriesName,
        qualityName:item.qualityName,
        category:item.category,
        quantity:qty,
        durationSeconds:Math.round((item.durationMs || BOOSTER_DURATION_MS) / 1000),
        effectText:(typeof describeBoosterEffect === "function") ? describeBoosterEffect(item.effectType, item.effectValue) : ""
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hans-CN"));

  const selectedCard = recipes.find(r => r.selected) || null;
  let statusText;
  if (isRunning) {
    const runItem = BOOSTER_ITEMS[runningRecipe.id];
    statusText = "正在制造：" + (runItem ? runItem.name : runningRecipe.id) + "（" + progress.percent + "%）";
  } else if (selectedCard && !selectedCard.canManufacture) {
    statusText = selectedCard.lockedReason || "待命";
  } else {
    statusText = "待命";
  }

  return {
    kind:"boosterEngineering",
    skill:"boosterEngineering",
    level,
    xp,
    xpRequired,
    xpPercent:Math.min(100, Math.floor(xp / xpRequired * 100)),
    efficiency,
    isRunning,
    status:isRunning ? "进行中" : "待命",
    statusText,
    progress,
    progressPercent:progress.percent,
    remainingSeconds:progress.etaSeconds,
    category:categoryId,
    categories:BOOSTER_CATEGORY_META.map(c => ({ id:c.id, name:c.name, selected:c.id === categoryId })),
    qualityFilter,
    qualityFilters:[{ id:"all", name:"全部" }, { id:"n", name:"普通" }, { id:"r", name:"精工" }, { id:"l", name:"传奇" }]
      .map(q => ({ ...q, selected:q.id === qualityFilter })),
    selectedRecipeId:selectedRecipe.id,
    runningRecipeId:isRunning ? runningRecipe.id : null,
    selectedRecipe:selectedCard,
    canStart:Boolean(selectedCard && selectedCard.canManufacture),
    recipes,
    inventoryCards,
    phaseNote:"增强剂使用与自动补充将在下一阶段开放"
  };
}

function getCombatSkillLevelFromState(state, key) {
  return Number(state && state.skills && state.skills[key] && state.skills[key].lvl) || 1;
}

function getActiveCombatShipState(state) {
  const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  const assignedRef = state && state.shipAssignments ? state.shipAssignments.combat : null;
  const activeRef = state && state.combat ? state.combat.activeShip : null;
  const instance = getShipInstanceFromState(state, assignedRef) || getShipInstanceFromState(state, activeRef) || ships[0] || null;
  const config = getShipConfigById(instance ? instance.shipId : activeRef) || STARTER_SHIPS.rifter;
  return { instance, config, fitting:getFittingFromInstance(instance) };
}

function getInstalledCombatModulesFromState(state) {
  const activeShip = getActiveCombatShipState(state);
  const modules = [];
  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of activeShip.fitting[slot]) {
      const resolved = resolveEquipmentReference(state, ref);
      if (!resolved || !resolved.definition || !resolved.definition.combat) continue;
      modules.push({
        id:ref,
        itemId:resolved.itemId,
        instance:resolved.instance,
        name:resolved.definition.name,
        slot,
        enhancementLevel:resolved.enhancementLevel,
        multiplier:resolved.multiplier,
        combat:{ ...resolved.definition.combat },
        bonuses:{ ...(resolved.definition.bonuses || {}) }
      });
    }
  }
  return modules;
}

function getCombatLevelFromState(state) {
  return getCombatLevelBreakdownFromState(state).level;
}

function getCombatLevelBreakdownFromState(state) {
  const attack = Math.max(
    getCombatSkillLevelFromState(state, "laserOps"),
    getCombatSkillLevelFromState(state, "cannonOps"),
    getCombatSkillLevelFromState(state, "missileOperations")
  );
  const defense = Math.max(
    getCombatSkillLevelFromState(state, "shieldOperation"),
    getCombatSkillLevelFromState(state, "armorReinforcement"),
    getCombatSkillLevelFromState(state, "hullEngineering")
  );
  return { attack, defense, level:Math.floor((attack + defense) / 2) };
}

function getCombatMaxHpFromState(state, context) {
  const activeShip = getActiveCombatShipState(state);
  const ship = activeShip.config;
  const enhancement = getShipEnhancementBonuses(ship, activeShip.instance && activeShip.instance.enhancementLevel);
  const flat = { shield:0, armor:0, structure:0 };
  for (const ref of Object.values(activeShip.fitting).flat().filter(Boolean)) {
    const resolved = resolveEquipmentReference(state, ref);
    const bonuses = resolved && resolved.definition ? resolved.definition.bonuses : null;
    if (!bonuses) continue;
    flat.shield += (Number(bonuses.shieldCapacity) || 0) * resolved.multiplier;
    flat.armor += (Number(bonuses.armorCapacity) || 0) * resolved.multiplier;
    flat.structure += (Number(bonuses.structureCapacity) || 0) * resolved.multiplier;
  }
  const bonuses = ship.bonuses || {};
  // 改装件容量加成（护盾/装甲/结构 *Percent），乘算在最终 HP 上（含装备平段 + 强化）
  const rigMods = (activeShip.instance && typeof getRigModifiers === "function")
    ? getRigModifiers(state, activeShip.instance) : {};
  return {
    shield:Math.round(calculateCombatStatFromState(state, "maxHp", ship.hp.shield, [
      { operation:"multiply", value:1 + (bonuses.shieldCapacity || 0), priority:10, source:"ship" },
      { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "shieldOperation") * 0.03, priority:20, source:"skill" },
      { operation:"add", value:flat.shield, priority:30, source:"equipment" },
      { operation:"multiply", value:enhancement.hpMultiplier, priority:40, source:"enhancement" },
      { operation:"multiply", value:1 + (rigMods.shieldCapacityPercent || 0), priority:50, source:"rig" }
    ], { ...(context || {}), actor:"player", layer:"shield" })),
    armor:Math.round(calculateCombatStatFromState(state, "maxHp", ship.hp.armor, [
      { operation:"multiply", value:1 + (bonuses.armorCapacity || 0), priority:10, source:"ship" },
      { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "armorReinforcement") * 0.03, priority:20, source:"skill" },
      { operation:"add", value:flat.armor, priority:30, source:"equipment" },
      { operation:"multiply", value:enhancement.hpMultiplier, priority:40, source:"enhancement" },
      { operation:"multiply", value:1 + (rigMods.armorCapacityPercent || 0), priority:50, source:"rig" }
    ], { ...(context || {}), actor:"player", layer:"armor" })),
    structure:Math.round(calculateCombatStatFromState(state, "maxHp", ship.hp.structure, [
      { operation:"multiply", value:1 + (bonuses.structureCapacity || 0), priority:10, source:"ship" },
      { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "hullEngineering") * 0.03, priority:20, source:"skill" },
      { operation:"add", value:flat.structure, priority:30, source:"equipment" },
      { operation:"multiply", value:enhancement.hpMultiplier, priority:40, source:"enhancement" },
      { operation:"multiply", value:1 + (rigMods.structureCapacityPercent || 0), priority:50, source:"rig" }
    ], { ...(context || {}), actor:"player", layer:"structure" }))
  };
}

function getCombatWeaponHitFromState(state, weaponType, equipmentCombat, context) {
  const config = WEAPON_CONFIG[weaponType];
  if (!config) return 100;
  const ship = getActiveCombatShipState(state).config;
  const baseHit = equipmentCombat && equipmentCombat.baseHit !== undefined ? equipmentCombat.baseHit : config.baseHit;
  return calculateCombatStatFromState(state, "hit", baseHit, [
    { operation:"add", value:getCombatSkillLevelFromState(state, config.skillKey) * 4, priority:10, source:"weapon-skill" },
    { operation:"add", value:getCombatSkillLevelFromState(state, "targeting") * 3, priority:20, source:"targeting" },
    { operation:"add", value:(ship.bonuses && ship.bonuses.hitBonus) || 0, priority:30, source:"ship" }
  ], { ...(context || {}), actor:"player", weaponType });
}

function getCombatDamageMultiplierFromState(state, weaponType, context) {
  const config = WEAPON_CONFIG[weaponType];
  if (!config) return 1;
  const activeShip = getActiveCombatShipState(state);
  const ship = activeShip.config;
  const shipBonus = ship.bonuses ? (ship.bonuses[weaponType + "Damage"] || 0) : 0;
  const enhancement = getShipEnhancementBonuses(ship, activeShip.instance && activeShip.instance.enhancementLevel);
  return calculateCombatStatFromState(state, "damageMultiplier", 1, [
    { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, config.skillKey) * 0.02, priority:10, source:"skill" },
    { operation:"multiply", value:1 + shipBonus, priority:20, source:"ship" },
    { operation:"multiply", value:enhancement.damageMultiplier, priority:30, source:"enhancement" }
  ], { ...(context || {}), actor:"player", weaponType });
}

function getCombatPlayerDodgeFromState(state, context) {
  const ship = getActiveCombatShipState(state).config;
  return calculateCombatStatFromState(state, "dodge", ship.dodge || 20, [
    { operation:"add", value:getCombatSkillLevelFromState(state, "piloting"), priority:10, source:"skill" }
  ], { ...(context || {}), actor:"player" });
}

function getCombatFuelMultiplierFromState(state, zone, context) {
  const ship = getActiveCombatShipState(state).config;
  const selectedZone = zone || COMBAT_ZONES.find(item => item.id === (state.combat && state.combat.zone));
  const shipMultiplier = Number.isFinite(ship.fuelEfficiency) ? ship.fuelEfficiency : 1;
  const zoneMultiplier = selectedZone && Number.isFinite(selectedZone.fuelMult) ? selectedZone.fuelMult : 1;
  return calculateCombatStatFromState(state, "fuelMultiplier", 1, [
    { operation:"multiply", value:shipMultiplier, priority:10, source:"ship" },
    { operation:"multiply", value:zoneMultiplier, priority:20, source:"zone" },
    { operation:"multiply", value:1 / (1 + getCombatSkillLevelFromState(state, "capacitorManagement") * 0.02), priority:30, source:"skill" }
  ], { ...(context || {}), actor:"player", zoneId:selectedZone && selectedZone.id });
}

function getCombatRepairMultiplierFromState(state, target, context) {
  const ship = getActiveCombatShipState(state).config;
  const roleBonus = ship.bonuses && target ? (ship.bonuses[target + "Repair"] || 0) : 0;
  return calculateCombatStatFromState(state, "repairMultiplier", 1, [
    { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "defense") * 0.02, priority:10, source:"skill" },
    { operation:"multiply", value:1 + roleBonus, priority:20, source:"ship" }
  ], { ...(context || {}), actor:"player", layer:target });
}

function getCombatLivingEnemiesFromState(combat) {
  const enemies = combat && Array.isArray(combat.enemies) ? combat.enemies : [];
  if (enemies.length > 0) return enemies.filter(enemy => enemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  const fallback = combat && combat.currentEnemy;
  return fallback && !fallback.defeated && fallback.hp && fallback.hp.structure > 0 ? [fallback] : [];
}

function getCombatDisplayState(state, now) {
  const combat = state.combat || {};
  const storedMode = combat.mode === "deathspace" ? "deathspace" : "belt";
  const viewMode = combat.viewMode === "deathspace" ? "deathspace" : combat.viewMode === "belt" ? "belt" : storedMode;
  const encounterMode = combat.active ? storedMode : viewMode;
  const requestedTier = [2,3,4,6].includes(Number(combat.viewDeathspaceTier)) ? Number(combat.viewDeathspaceTier) :
    [2,3,4,6].includes(Number(combat.deathspaceTier)) ? Number(combat.deathspaceTier) : null;
  const storedDeathspace = getDeathspaceById(combat.viewDeathspaceId || combat.deathspaceId);
  const deathspaceTier = requestedTier || (storedDeathspace && storedDeathspace.dedTier) || 2;
  const deathspace = storedDeathspace && storedDeathspace.dedTier === deathspaceTier
    ? storedDeathspace
    : DEATHSPACE_DATABASE.find(site => site.dedTier === deathspaceTier) || DEATHSPACE_DATABASE[0];
  const encounterDeathspace = encounterMode === "deathspace"
    ? getDeathspaceById(combat.active ? combat.deathspaceId : (combat.viewDeathspaceId || combat.deathspaceId)) || deathspace
    : null;
  const activeShip = getActiveCombatShipState(state);
  const ship = activeShip.config;
  const modules = getInstalledCombatModulesFromState(state);
  const weapons = modules.filter(module => module.combat.kind === "weapon");
  const repairers = modules.filter(module => module.combat.kind === "repair");
  const level = getCombatLevelFromState(state);
  const zone = encounterMode === "deathspace"
    ? COMBAT_ZONES.find(item => item.id === encounterDeathspace.sourceZoneId) || COMBAT_ZONES[0]
    : COMBAT_ZONES.find(item => item.id === combat.zone) || COMBAT_ZONES[0];
  const recoveryUntil = Number(combat.repairUntil) || 0;
  const recoveryRemaining = recoveryUntil > now ? Math.ceil((recoveryUntil - now) / 1000) : 0;
  const livingEnemies = getCombatLivingEnemiesFromState(combat);
  const target = selectCapitalCombatTarget(livingEnemies, combat.targetingMode, ship);
  const enemies = Array.isArray(combat.enemies) ? combat.enemies : [];
  const targetIndex = target ? Math.max(0, enemies.indexOf(target)) : -1;
  const derivedMaxHp = getCombatMaxHpFromState(state, { now, zoneId:zone.id });
  const maxHp = combat.maxHp && Number.isFinite(combat.maxHp.structure) ? { ...combat.maxHp } : { ...derivedMaxHp };
  const hp = combat.hp && Number.isFinite(combat.hp.structure) ? { ...combat.hp } : { ...maxHp };
  const requiredLevel = encounterMode === "deathspace" ? encounterDeathspace.requiredCL : (zone.requiredCL || 1);
  const zoneUnlocked = level >= requiredLevel;
  const volleyDamage = weapons.reduce((total, module) => total + Math.round(module.combat.baseDamage * getCombatDamageMultiplierFromState(state, module.combat.weaponType, { now, zoneId:zone.id })), 0);
  const clears = encounterMode === "deathspace"
    ? combat.deathspaceClears && combat.deathspaceClears[encounterDeathspace.id] || 0
    : combat.zoneClears && combat.zoneClears[zone.id] || 0;
  const enemyVolley = combat.lastEnemyVolley;
  const enemyVolleyText = enemyVolley && enemyVolley.attackers > 0
    ? " · 敌方出手 " + enemyVolley.attackers + " 艘 / 实伤 " + enemyVolley.totalDamage +
      (enemyVolley.mitigatedDamage ? " / 偏导减伤 " + enemyVolley.mitigatedDamage : "") + (enemyVolley.armorRestored ? " / 应激恢复 " + enemyVolley.armorRestored : "")
    : "";
  const maxWave = encounterMode === "deathspace" ? encounterDeathspace.maxWave : (zone.maxWave || 20);
  const runStatus = (encounterMode === "deathspace" ? "房间 " : "第 ") + (combat.wave || 1) + "/" + maxWave + (encounterMode === "deathspace" ? "" : " 波") +
    (target ? " · 当前敌人 " + (targetIndex + 1) + "/" + enemies.length : "") +
    (encounterMode === "deathspace" ? " · 已全通 " : " · 本轮精英 " + (combat.runEliteKills || 0) + " · 已肃清 ") + clears + enemyVolleyText +
    (combat.lastLoot ? " · 最近掉落: " + combat.lastLoot : "") +
    (combat.lastSpecialLoot ? " · 本次稀有收获: " + combat.lastSpecialLoot : "") +
    (combat.lastStatus ? " · " + combat.lastStatus : "");
  const ticketCount = ResourceRegistry.get(state, "special:" + deathspace.ticketMaterial);
  const startDisabled = recoveryRemaining > 0 || weapons.length === 0 || !zoneUnlocked || (viewMode === "deathspace" && ticketCount < 1);
  const startText = recoveryRemaining > 0 ? "维修中 " + recoveryRemaining + "s" : !zoneUnlocked ? "需要战斗等级 " + requiredLevel : weapons.length === 0 ? "未安装武器" : viewMode === "deathspace" && ticketCount < 1 ? "缺少通行密钥" : viewMode === "deathspace" ? "▶ 消耗密钥进入" : "▶ 开始战斗";
  const slotNames = { high:"高槽", mid:"中槽", low:"低槽", rig:"改装槽" };
  const equipmentRack = [];
  for (const slot of ["high", "mid", "low", "rig"]) {
    const fitted = activeShip.fitting[slot];
    const count = Math.max((ship.slots && ship.slots[slot]) || 0, fitted.length);
    for (let index = 0; index < count; index++) {
      const ref = fitted[index] || null;
      const resolved = ref ? resolveEquipmentReference(state, ref) : null;
      const equipment = resolved ? resolved.definition : null;
      equipmentRack.push({ slot, slotName:slotNames[slot], index, equipmentRef:ref, equipmentId:resolved ? resolved.itemId : null, enhancementLevel:resolved ? resolved.enhancementLevel : 0, name:equipment ? equipment.name : "空槽位", empty:!equipment, attributes:equipment ? getEquipmentAttributeText(equipment, "\n") : slotNames[slot] + "：空槽位" });
    }
  }

  return {
    kind:"combat",
    mode:viewMode,
    viewMode,
    encounterMode,
    deathspaceTier,
    active:Boolean(combat.active),
    browsingDuringCombat:Boolean(combat.active && viewMode !== encounterMode),
    headerText:recoveryRemaining > 0 ? "维修中 · " + recoveryRemaining + "s" : combat.active && target ? (encounterMode === "deathspace" ? "▶ 死亡空间攻略中" : "▶ 交战中") : "待命",
    wave:Number(combat.wave) || 1,
    maxWave,
    clearCount:clears,
    level,
    skills:{
      laser:getCombatSkillLevelFromState(state, "laserOps"), cannon:getCombatSkillLevelFromState(state, "cannonOps"),
      missile:getCombatSkillLevelFromState(state, "missileOperations"), targeting:getCombatSkillLevelFromState(state, "targeting")
    },
    targeting:{
      supported:isCapitalCombatShip(ship),
      mode:isCapitalCombatShip(ship) ? normalizeCapitalTargetingMode(combat.targetingMode) : "formation",
      modeName:getCapitalTargetingModeName(combat.targetingMode),
      options:CAPITAL_TARGETING_MODES.map(option => ({ ...option })),
      trait:ship.capitalTrait ? { ...ship.capitalTrait } : null
    },
    zone:{ ...zone, unlocked:zoneUnlocked },
    zones:COMBAT_ZONES.map(item => ({ ...item, selected:item.id === zone.id, unlocked:level >= (item.requiredCL || 1), locked:Boolean(combat.active) || level < (item.requiredCL || 1), clears:combat.zoneClears && combat.zoneClears[item.id] || 0 })),
    deathspace:{ ...deathspace, ticketCount, unlocked:level >= deathspace.requiredCL, clearCount:combat.deathspaceClears && combat.deathspaceClears[deathspace.id] || 0 },
    deathspaceTiers:[2,3,4,6].map(tier => {
      const sites = DEATHSPACE_DATABASE.filter(site => site.dedTier === tier);
      return { tier, label:tier + "/10", selected:tier === deathspaceTier, unlocked:sites.some(site => level >= site.requiredCL), requiredCL:sites[0] ? sites[0].requiredCL : 1 };
    }),
    deathspaces:DEATHSPACE_DATABASE.filter(site => site.dedTier === deathspaceTier).map(site => ({
      ...site,
      selected:site.id === deathspace.id,
      unlocked:level >= site.requiredCL,
      locked:level < site.requiredCL,
      ticketCount:ResourceRegistry.get(state, "special:" + site.ticketMaterial),
      clears:combat.deathspaceClears && combat.deathspaceClears[site.id] || 0,
      sourceZoneName:(COMBAT_ZONES.find(item => item.id === site.sourceZoneId) || {}).name || site.sourceZoneId
    })),
    recovery:{ active:recoveryRemaining > 0, remaining:recoveryRemaining, until:recoveryUntil },
    player:{ instanceId:activeShip.instance ? activeShip.instance.instanceId : null, name:ship.name, image:ship.image || "", speed:ship.speed || 0, dodge:getCombatPlayerDodgeFromState(state, { now, zoneId:zone.id }), hp, maxHp, derivedMaxHp, volleyDamage, weaponCount:weapons.length },
    enemies:enemies.map((enemy, index) => {
      const currentHp = enemy.hp ? enemy.hp.shield + enemy.hp.armor + enemy.hp.structure : 0;
      const maximumHp = enemy.maxHp ? enemy.maxHp.shield + enemy.maxHp.armor + enemy.maxHp.structure : 1;
      return { ...enemy, hp:enemy.hp ? { ...enemy.hp } : null, maxHp:enemy.maxHp ? { ...enemy.maxHp } : null, index, current:enemy === target, defeated:Boolean(enemy.defeated || !enemy.hp || enemy.hp.structure <= 0), percent:Math.max(0, Math.min(100, Math.round(currentHp / maximumHp * 100))) };
    }),
    target:target ? { ...target, hp:{ ...target.hp }, maxHp:{ ...target.maxHp }, index:targetIndex, kindLabel:target.kind === "boss" ? "BOSS" : target.kind === "elite" ? "精英" : "普通", defenseLabel:zone.faction === "angel" ? "护盾特化" : zone.faction === "blood" ? "装甲特化" : "结构特化" } : null,
    lockText:target ? "目标锁定" : "等待目标",
    runStatus,
    showRewards:Boolean(combat.active && target || combat.lastLoot || combat.lastSpecialLoot || combat.lastStatus),
    supplies:{ fuel:ResourceRegistry.get(state, "consumable:fuel"), laser:ResourceRegistry.get(state, "ammo:laser"), missile:ResourceRegistry.get(state, "ammo:missile"), cannon:ResourceRegistry.get(state, "ammo:cannon") },
    weapons:weapons.map(module => ({ ...module, icon:{ laser:"⚡", missile:"🚀", cannon:"💥" }[module.combat.weaponType] || "◆" })),
    repairers:repairers.map(module => ({ ...module })),
    equipmentRack,
    controls:{ showStart:!combat.active, showStop:Boolean(combat.active), startDisabled, startText }
  };
}

function getPlanetaryCapacityState(state) {
  const skill = state.skills.planetaryIndustry || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  const deployments = state.planetary && Array.isArray(state.planetary.deployments) ? state.planetary.deployments : [];
  return {
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    usedSlots:deployments.length,
    slots:Math.min(5, 1 + Math.floor(level / 10)),
    maxSlots:5,
    storageMax:100 + level * 5
  };
}

function getPlanetOutputIntervalFromState(state, type) {
  const config = PLANET_TYPES.find(planet => planet.id === type);
  const level = getPlanetaryCapacityState(state).level;
  return config ? config.interval / (1 + level * 0.02) : 10;
}

// 纯显示态：只消费不修改。三状态 running / expired（deployment 一定存在，未布置态由 deployOptions 表达）。
function getPlanetDeploymentDisplayState(state, deployment, now) {
  const config = PLANET_TYPES.find(planet => planet.id === deployment.planetType) || null;
  const capacity = getPlanetaryCapacityState(state);
  const duration = Number(deployment.duration) || 86400;
  const deployedAt = Number(deployment.deployedAt) || now;
  const elapsed = Math.max(0, (now - deployedAt) / 1000);
  const remaining = Math.max(0, duration - elapsed);
  const timeExpired = remaining <= 0;
  // 已到期 = 时间超期 或 active 标志已被置为 false
  const expired = timeExpired || !deployment.active;
  const storage = Number(deployment.storage) || 0;
  const full = storage >= capacity.storageMax;
  const active = Boolean(deployment.active) && !timeExpired;
  const runState = active ? "running" : "expired";
  const interval = getPlanetOutputIntervalFromState(state, deployment.planetType);
  const sinceTick = active && !full ? Math.max(0, (now - (Number(deployment.lastTick) || now)) / 1000) : 0;
  const displayProgress = active && !full ? Math.min(interval, (Number(deployment.progress) || 0) + sinceTick) : Number(deployment.progress) || 0;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const statusClass = expired ? "expired" : full ? "full" : "running";
  const statusText = expired ? "已到期 · 停止生产" : full ? "满仓停产" : "运行中";
  const renewCost = config ? Number(config.maintenanceCostISK) || 0 : 0;
  const isk = ResourceRegistry.get(state, "currency:isk");
  const enoughIskForRenew = isk >= renewCost;
  return {
    id:deployment.id,
    type:deployment.planetType,
    planetType:deployment.planetType,
    name:config ? config.name : deployment.planetType,
    icon:config ? config.icon : "🪐",
    output:config ? config.output : "未知产物",
    outputIcon:config ? ITEM_ICONS[config.output] || "📦" : "📦",
    state:runState,
    active,
    expired,
    full,
    statusClass,
    statusText,
    storage,
    storageMax:capacity.storageMax,
    storagePercent:Math.min(100, Math.floor(storage / capacity.storageMax * 100)),
    interval,
    outputProgress:displayProgress,
    outputPercent:Math.min(100, Math.floor(displayProgress / interval * 100)),
    outputEta:Math.max(0, interval - displayProgress),
    showOutputProgress:active && !full,
    duration,
    elapsed,
    remaining,
    timePercent:Math.min(100, Math.floor(elapsed / duration * 100)),
    timeWarning:remaining < 3600,
    timeLeftText:expired ? "已到期" : hours > 0 ? `剩余 ${hours}h${minutes}m` : `剩余 ${minutes}m`,
    renewCost,
    enoughIskForRenew,
    showRenew:expired,
    canRenew:expired && enoughIskForRenew,
    canCollect:storage > 0,
    canDemolish:storage === 0,
    canRemove:storage === 0
  };
}

function getPlanetaryDisplayState(state, now, cargoCapacity) {
  const capacity = getPlanetaryCapacityState(state);
  const deployments = state.planetary && Array.isArray(state.planetary.deployments) ? state.planetary.deployments : [];
  const isk = ResourceRegistry.get(state, "currency:isk");
  const tritanium = ResourceRegistry.get(state, "mineral:三钛合金");
  const usedCargo = getCargoUsedFromState(state);
  const totalCargo = Number(cargoCapacity) || 10000000;
  return {
    kind:"planetary",
    ...capacity,
    canDeploy:capacity.usedSlots < capacity.slots,
    cargo:{ used:usedCargo, capacity:totalCargo, free:Math.max(0, totalCargo - usedCargo) },
    deployments:deployments.map(deployment => getPlanetDeploymentDisplayState(state, deployment, now)),
    deployOptions:PLANET_TYPES.map(config => {
      const constructionISK = Number(config.constructionCost && config.constructionCost.isk) || 0;
      const constructionTrit = Number(config.constructionCost && config.constructionCost.resources && config.constructionCost.resources["mineral:三钛合金"]) || 0;
      const maintenanceCostISK = Number(config.maintenanceCostISK) || 0;
      return {
        id:config.id,
        type:config.id,
        name:config.name,
        icon:config.icon,
        output:config.output,
        level:config.level,
        interval:getPlanetOutputIntervalFromState(state, config.id),
        constructionISK,
        constructionTrit,
        maintenanceCostISK,
        renewCost:maintenanceCostISK,
        unlocked:capacity.level >= config.level,
        enoughIsk:isk >= constructionISK,
        enoughTrit:tritanium >= constructionTrit,
        canDeploy:capacity.usedSlots < capacity.slots && capacity.level >= config.level && isk >= constructionISK && tritanium >= constructionTrit
      };
    })
  };
}

function getCargoDisplayState(state, filter, cargoCapacity) {
  const selectedFilter = ITEM_CATEGORIES[filter] || filter === "all" ? filter : "all";
  const componentNames = Object.fromEntries(SHIP_COMPONENT_RECIPES.map(recipe => [recipe.id, recipe.name]));
  const resources = state.resources || {};
  const equipmentSource = {};
  for (const { definition, quantity } of ResourceRegistry.listStateEntries(state, "component")) equipmentSource[componentNames[definition.key] || definition.name] = quantity;
  for (const equipmentId of state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : []) {
    const equipment = EQUIPMENT_DB[equipmentId];
    if (equipment) equipmentSource[equipment.name] = (equipmentSource[equipment.name] || 0) + 1;
  }
  // 双池：未安装的装备实例同样占用 cargo
  for (const instance of (state.equipment && Array.isArray(state.equipment.instances) ? state.equipment.instances : [])) {
    if (instance.installedOn) continue;
    const equipment = EQUIPMENT_DB[instance.itemId];
    if (equipment) equipmentSource[equipment.name] = (equipmentSource[equipment.name] || 0) + 1;
  }
  const sources = {
    ore:Object.fromEntries(ResourceRegistry.listStateEntries(state, "ore").map(entry => [entry.definition.name, entry.quantity])),
    mineral:Object.fromEntries(ResourceRegistry.listStateEntries(state, "mineral").map(entry => [entry.definition.name, entry.quantity])),
    planetary:Object.fromEntries(ResourceRegistry.listStateEntries(state, "planetary").map(entry => [entry.definition.name, entry.quantity])),
    gases:Object.fromEntries(ResourceRegistry.listStateEntries(state, "gas").map(entry => [entry.definition.name, entry.quantity])),
    moon:Object.fromEntries(ResourceRegistry.listStateEntries(state, "moon").map(entry => [entry.definition.name, entry.quantity])),
    special:Object.fromEntries(ResourceRegistry.listStateEntries(state, "special").map(entry => [entry.definition.name, entry.quantity])),
    consumable:{ "燃料单元":ResourceRegistry.get(state, "consumable:fuel"), "激光晶体弹药":ResourceRegistry.get(state, "ammo:laser"), "导弹":ResourceRegistry.get(state, "ammo:missile"), "炮台弹药":ResourceRegistry.get(state, "ammo:cannon"), "纳米维修膏":ResourceRegistry.get(state, "consumable:repairPaste") },
    equipment:equipmentSource
  };
  const equipmentByName = Object.fromEntries(Object.values(EQUIPMENT_DB).map(equipment => [equipment.name, equipment]));
  const items = [];
  for (const [category, configuredNames] of Object.entries(ITEM_CATEGORIES)) {
    if (selectedFilter !== "all" && selectedFilter !== category) continue;
    const names = [...new Set([...configuredNames, ...Object.keys(sources[category] || {})])];
    for (const name of names) {
      const quantity = Number(sources[category] && sources[category][name]) || 0;
      if (quantity <= 0) continue;
      const equipment = category === "equipment" ? equipmentByName[name] : null;
      const fallbackIcon = equipment ? (equipment.slot === "mid" ? "🤖" : equipment.slot === "low" ? "⬆️" : "📦") : "📦";
      items.push({ category, name, quantity, icon:ITEM_ICONS[name] || fallbackIcon, details:equipment ? getEquipmentAttributeText(equipment) : "" });
    }
  }
  items.sort((left, right) => right.quantity - left.quantity);
  return {
    kind:"cargo",
    filter:selectedFilter,
    used:getCargoUsedFromState(state),
    capacity:Number(cargoCapacity) || 10000000,
    items,
    emptyText:selectedFilter === "all" ? "仓库空空如也" : selectedFilter === "equipment" ? "暂无舰船/装备数据" : "该分类暂无物品",
    filters:Object.keys(ITEM_CATEGORIES).map(id => ({ id, selected:id === selectedFilter }))
  };
}

/* ---- 仓库装备强化列表展示态（双池：inventory 字符串 + instances） ---- */
function getEquipmentEnhancementListDisplayState(state) {
  if (typeof getEquipmentEnhancementCategory !== "function") return { entries:[] };
  const engLevel = Number(state.skills && state.skills.equipmentEngineering && state.skills.equipmentEngineering.lvl) || 1;
  const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  const instances = state.equipment && Array.isArray(state.equipment.instances) ? state.equipment.instances : [];

  const buildCostRows = display => Object.entries(display.cost).map(([mineral, qty]) => {
    const stock = ResourceRegistry.getMaterialStock(state, mineral);
    return { name:mineral, need:qty, stock, enough:stock >= qty };
  });
  const buildExtraRows = (display, itemId) => {
    const rows = [];
    if (display.extra.sameTypeItemId) {
      const have = getEquipmentInventoryCount(state, itemId);
      rows.push({ label:"同型号 +0 装备", need:1, have, enough:have >= 1 });
    }
    if (display.extra.core) {
      const stock = ResourceRegistry.getMaterialStock(state, display.extra.core);
      rows.push({ label:display.extra.core, need:1, have:stock, enough:stock >= 1 });
    }
    if (display.extra.protocol) {
      const stock = ResourceRegistry.getMaterialStock(state, display.extra.protocol);
      rows.push({ label:display.extra.protocol, need:1, have:stock, enough:stock >= 1 });
    }
    return rows;
  };
  const canEnhance = (costRows, extraRows) =>
    Array.isArray(costRows) &&
    costRows.length > 0 &&
    costRows.every(row => row.enough) &&
    Array.isArray(extraRows) &&
    extraRows.every(row => row.enough);

  const groups = new Map();
  const ensure = itemId => { if (!groups.has(itemId)) groups.set(itemId, { itemId, inventoryRefs:[], instances:[] }); return groups.get(itemId); };
  for (const ref of inventory) ensure(ref).inventoryRefs.push(ref);
  for (const inst of instances) ensure(inst.itemId).instances.push(inst);

  const CATEGORY_LABEL = { normal:"通用", faction:"势力", alliance:"联盟", "deathspace-standard":"死亡空间", "deathspace-supervisor":"死亡空间(监督者)", "deathspace":"死亡空间", unknown:"其它" };
  const entries = [];
  for (const [itemId, group] of groups) {
    const eq = EQUIPMENT_DB[itemId];
    if (!eq) continue;
    if (eq.slot === "rig") continue; // 改装件不参与强化（安装即消耗，无 enhancementLevel），不进强化列表
    const category = getEquipmentEnhancementCategory(eq);
    const instanceCards = [];
    const installed = [];
    for (const inst of group.instances) {
      const level = Math.max(0, Number(inst.enhancementLevel) || 0);
      if (inst.installedOn) {
        const ship = getShipInstanceFromState(state, inst.installedOn);
        const shipName = ship ? (getShipConfigById(ship.shipId) ? getShipConfigById(ship.shipId).name : inst.installedOn) : inst.installedOn;
        installed.push({ instanceId:inst.instanceId, level, shipName });
        continue;
      }
      const display = getEquipmentEnhancementDisplayState(eq, level, engLevel);
      const costRows = buildCostRows(display);
      const extraRows = buildExtraRows(display, itemId);
      instanceCards.push({
        instanceId:inst.instanceId,
        level,
        multiplier:display.multiplier,
        bonusPercent:Math.round((display.multiplier - 1) * 1000) / 10,
        previewMultiplier:display.previewMultiplier,
        previewBonusPercent:Math.round((display.previewMultiplier - 1) * 1000) / 10,
        successPercent:Math.round(display.success * 1000) / 10,
        successBreakdown:display.successBreakdown,
        isMilestone:display.isMilestone,
        costRows,
        extraRows,
        canEnhance:canEnhance(costRows, extraRows)
      });
    }
    instanceCards.sort((a, b) => a.level - b.level);

    let stack = null;
    if (group.inventoryRefs.length) {
      const display = getEquipmentEnhancementDisplayState(eq, 0, engLevel);
      const costRows = buildCostRows(display);
      const extraRows = buildExtraRows(display, itemId);
      stack = {
        count:group.inventoryRefs.length,
        targetRef:group.inventoryRefs[0],
        bonusPercent:0,
        previewBonusPercent:Math.round((display.previewMultiplier - 1) * 1000) / 10,
        successPercent:Math.round(display.success * 1000) / 10,
        successBreakdown:display.successBreakdown,
        isMilestone:display.isMilestone,
        costRows,
        extraRows,
        canEnhance:canEnhance(costRows, extraRows)
      };
    }

    entries.push({
      itemId,
      name:eq.name,
      icon:ITEM_ICONS[eq.name] || "📦",
      slot:eq.slot,
      category,
      categoryLabel:CATEGORY_LABEL[category] || "其它",
      instanceCards,
      stack,
      installed
    });
  }
  entries.sort((a, b) => (CATEGORY_LABEL[a.category] || "其它").localeCompare(CATEGORY_LABEL[b.category] || "其它", "zh") || a.name.localeCompare(b.name, "zh"));
  return { entries };
}

function getLPStoreDisplayState(state) {
  const lp = ResourceRegistry.get(state, "currency:lp");
  const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  return {
    kind:"lpstore",
    balance:lp,
    items:getLPStoreCatalogItems().map(item => {
      const isBlueprint = item.kind === "equipmentBlueprint";
      const owned = isBlueprint
        ? (hasEquipmentBlueprintFromState(state, item.equipmentId) ? 1 : 0)
        : inventory.filter(id => id === item.equipmentId).length;
      return {
        id:item.id,
        name:item.name,
        kind:item.kind,
        price:item.lpPrice,
        attributes:isBlueprint ? item.description : getEquipmentAttributeText(item.equipmentId, " · "),
        owned,
        ownedText:isBlueprint ? (owned ? "永久蓝图已拥有" : "永久蓝图未拥有") : "已拥有 " + owned,
        canBuy:lp >= item.lpPrice && (!isBlueprint || owned === 0),
        purchaseText:isBlueprint && owned ? "已拥有" : item.lpPrice + " LP 兑换",
        icon:isBlueprint ? "fa-solid fa-scroll" : item.equipmentId.includes("gas") ? "fa-solid fa-wind" : "fa-solid fa-gem"
      };
    })
  };
}

function getBlueprintShipPreview(item) {
  const recipe = SHIP_ASSEMBLY_RECIPES.find(entry => entry.shipId === item.shipId);
  const ship = getShipConfigById(item.shipId);
  if (!recipe || !ship) return { productName:item.name.replace(/蓝图$/, ""), previewLines:[] };
  const componentText = Object.entries(getShipAssemblyComponentCost(recipe)).map(([componentId, quantity]) => {
    const component = SHIP_COMPONENT_RECIPES.find(entry => entry.id === componentId);
    return (component ? component.name : componentId) + "×" + quantity;
  });
  const materialText = Object.entries(recipe.materialCost || {}).map(([material, quantity]) => material + "×" + quantity);
  const bonusNames = {
    shieldCapacity:"护盾容量", armorCapacity:"装甲容量", structureCapacity:"结构容量",
    laserDamage:"激光伤害", missileDamage:"导弹伤害", cannonDamage:"射弹伤害",
    capacitorRecharge:"电容回充", targetingSpeed:"锁定速度", speed:"速度",
    armorRepair:"装甲维修", structureRepair:"结构维修", hitBonus:"命中",
    miningLaserEfficiency:"采矿装备效果", gasLaserEfficiency:"采气装备效果",
    fleetMiningSpeed:"舰队采矿速度", smeltingSpeed:"冶炼速度",
    archaeologyScanStrength:"扫描强度", archaeologyFailureDamageReduction:"失败反噬减免"
  };
  const percentKeys = new Set(["shieldCapacity", "armorCapacity", "structureCapacity", "laserDamage", "missileDamage", "cannonDamage", "capacitorRecharge", "targetingSpeed", "speed", "armorRepair", "structureRepair", "miningLaserEfficiency", "gasLaserEfficiency", "fleetMiningSpeed", "smeltingSpeed", "archaeologyFailureDamageReduction"]);
  const bonuses = Object.entries(ship.bonuses || {}).map(([key, value]) =>
    (bonusNames[key] || key) + " +" + (percentKeys.has(key) ? Math.round(value * 100) + "%" : value)
  );
  return {
    productName:ship.name,
    previewLines:[
      { label:"制造", value:`舰船工程 Lv.${recipe.level} · ${recipe.time}s · ${recipe.xp} XP` },
      { label:"舰体", value:`护盾 ${ship.hp.shield} · 装甲 ${ship.hp.armor} · 结构 ${ship.hp.structure} · 总生命 ${ship.totalHp}` },
      { label:"槽位", value:`高 ${ship.slots.high} · 中 ${ship.slots.mid} · 低 ${ship.slots.low} · 改装 ${ship.slots.rig}` },
      ...(bonuses.length ? [{ label:"加成", value:bonuses.join(" · ") }] : []),
      { label:"消耗", value:[...componentText, ...materialText].join(" + ") }
    ]
  };
}

function getBlueprintEquipmentPreview(item) {
  const equipment = EQUIPMENT_DB[item.equipmentId];
  const recipe = getEquipmentEngineeringRecipe(item.equipmentId);
  if (!equipment || !recipe) return { productName:item.name.replace(/蓝图$/, ""), previewLines:[] };
  const inputs = [];
  if (recipe.inputEquipment) {
    const input = EQUIPMENT_DB[recipe.inputEquipment.itemId];
    inputs.push((input ? input.name : recipe.inputEquipment.itemId) + "×" + recipe.inputEquipment.quantity);
  }
  for (const [material, quantity] of Object.entries(recipe.cost || {})) inputs.push(material + "×" + quantity);
  return {
    productName:equipment.name,
    previewLines:[
      { label:"制造", value:`装备工程 Lv.${recipe.level} · ${recipe.time}s · ${recipe.xp} XP` },
      { label:"属性", value:getEquipmentAttributeLines(equipment).join(" · ") },
      { label:"消耗", value:inputs.join(" + ") }
    ]
  };
}

function getBlueprintStoreDisplayState(state, selectedCategory) {
  const categoryId = BLUEPRINT_STORE_CATEGORIES.some(item => item.id === selectedCategory) ? selectedCategory : "ships";
  const isk = ResourceRegistry.get(state, "currency:isk");
  const lp = ResourceRegistry.get(state, "currency:lp");
  const ownedBlueprints = new Set(state.ownedBlueprints || []);
  const catalog = getBlueprintStoreCatalogItems();
  return {
    kind:"blueprintStore",
    balance:{ isk, lp },
    category:categoryId,
    categories:BLUEPRINT_STORE_CATEGORIES.map(category => ({
      ...category,
      selected:category.id === categoryId,
      count:catalog.filter(item => item.category === category.id).length
    })),
    items:catalog.filter(item => item.category === categoryId).map(item => {
      const owned = item.kind === "shipBlueprint"
        ? ownedBlueprints.has(item.shipId)
        : hasEquipmentBlueprintFromState(state, item.equipmentId);
      const balance = item.currency === "lp" ? lp : isk;
      const preview = item.kind === "shipBlueprint" ? getBlueprintShipPreview(item) : getBlueprintEquipmentPreview(item);
      return {
        ...item,
        owned,
        canBuy:!owned && balance >= item.price,
        productName:preview.productName,
        previewLines:preview.previewLines,
        priceText:item.price.toLocaleString() + " " + item.currency.toUpperCase(),
        purchaseText:owned ? "已拥有" : item.price.toLocaleString() + " " + item.currency.toUpperCase() + " 购买",
        icon:item.kind === "shipBlueprint" ? "fa-solid fa-ship" : item.deathspaceTier ? "fa-solid fa-dungeon" : "fa-solid fa-scroll"
      };
    })
  };
}

function getHangarDisplayState(state, now) {
  const assignments = state.shipAssignments || {};
  const actionNames = { combat:"⚔ 战斗", mining:"⛏ 采矿", gasHarvesting:"☁ 采气", refining:"🔥 冶炼", archaeology:"🛰 考古" };
  const recovery = state.combat && Number(state.combat.repairUntil) > now;
  const ships = state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  return {
    kind:"hangar",
    count:ships.length,
    actionNames,
    combatRecoveryActive:recovery,
    ships:ships.map(instance => {
      const config = getShipConfigById(instance.shipId);
      if (!config) return { instanceId:instance.instanceId, shipId:instance.shipId, unknown:true };
      const assignedActions = Object.entries(assignments)
        .filter(([key, id]) => id === instance.instanceId && Object.prototype.hasOwnProperty.call(actionNames, key))
        .map(([key]) => key);
      const tier = getShipEnhancementTier(config);
      const enhancementLevel = normalizeShipEnhancementLevel(instance.enhancementLevel);
      const enhancementBonuses = getShipEnhancementBonuses(config, enhancementLevel);
      const nextEnhancementBonuses = getShipEnhancementBonuses(config, enhancementLevel + 1);
      const activeCombatShip = state.combat && state.combat.active ? getActiveCombatShipState(state).instance : null;
      const activeSkill = state.currentAction && state.currentAction.active ? state.currentAction.skill : null;
      const busy = Boolean((activeCombatShip && activeCombatShip.instanceId === instance.instanceId) ||
        (activeSkill && assignments[activeSkill] === instance.instanceId));
      const enhancementCost = getShipEnhancementCost(config);
      const materials = Object.entries(enhancementCost).map(([id, quantity]) => {
        const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === id);
        const stock = ResourceRegistry.get(state, "component:" + id);
        return { id, name:recipe ? recipe.name : id, quantity, stock, enough:stock >= quantity };
      });
      const skillLevel = Number(state.skills.shipEngineering && state.skills.shipEngineering.lvl) || 1;
      const chance = tier ? getShipEnhancementSuccessChance(skillLevel, tier.level, enhancementLevel) : 0;
      const breakdown = tier ? getShipEnhancementSuccessBreakdown(skillLevel, tier.level, enhancementLevel) : null;
      const role = getShipEnhancementRole(config);
      const hpBefore = { ...config.hp };
      const hp = Object.fromEntries(Object.entries(config.hp).map(([layer, value]) => [layer, Math.round(value * enhancementBonuses.hpMultiplier)]));
      const archaeology = role === "archaeology";
      const scanMul = Number(enhancementBonuses.archaeologyScanMultiplier) || 1;
      const nextScanMul = Number(nextEnhancementBonuses.archaeologyScanMultiplier) || 1;
      const scanBase = archaeology ? (Number(config.bonuses && config.bonuses.archaeologyScanStrength) || 0) : 0;
      const failureReduction = archaeology ? (Number(config.bonuses && config.bonuses.archaeologyFailureDamageReduction) || 0) : 0;
      return {
        instanceId:instance.instanceId,
        shipId:instance.shipId,
        name:config.name,
        tier:config.tier,
        type:config.type,
        typeName:typeof SHIP_TYPE_NAMES !== "undefined" ? SHIP_TYPE_NAMES[config.type] || config.type : config.type,
        industrial:Boolean(INDUSTRIAL_SHIPS[instance.shipId]),
        archaeology,
        hpBefore,
        hp,
        dodge:config.dodge,
        speed:config.speed,
        bonuses:{ ...(config.bonuses || {}) },
        enhancement:{
          available:Boolean(tier),
          level:enhancementLevel,
          role,
          chance,
          chancePercent:(chance * 100).toFixed(1),
          successBreakdown:breakdown,
          baseXp:getShipEnhancementBaseXp(config),
          successXp:getShipEnhancementSuccessXp(config, enhancementLevel),
          failureXp:getShipEnhancementFailureXp(config),
          milestone:isShipEnhancementMilestone(enhancementLevel + 1),
          materials,
          busy,
          canEnhance:Boolean(tier) && !busy && materials.length === 3 && materials.every(item => item.enough),
          hpBonus:enhancementBonuses.hpMultiplier - 1,
          damageBonus:(enhancementBonuses.damageMultiplier || 1) - 1,
          industryBonus:(enhancementBonuses.industryMultiplier || 1) - 1,
          nextHpGain:nextEnhancementBonuses.hpMultiplier - enhancementBonuses.hpMultiplier,
          nextDamageGain:(nextEnhancementBonuses.damageMultiplier || 1) - (enhancementBonuses.damageMultiplier || 1),
          nextIndustryGain:(nextEnhancementBonuses.industryMultiplier || 1) - (enhancementBonuses.industryMultiplier || 1),
          scanBonus:scanMul - 1,
          nextScanGain:nextScanMul - scanMul,
          scanStrengthBase:scanBase,
          scanStrength:Math.round(scanBase * scanMul),
          failureReduction
        },
        assignedActions,
        assignments:Object.keys(actionNames).map(actionKey => {
          const restriction = getShipAssignmentRestriction(config, actionKey, recovery);
          return { actionKey, name:actionNames[actionKey], active:assignedActions.includes(actionKey), locked:Boolean(restriction), lockedReason:restriction ? restriction.text : "" };
        })
      };
    })
  };
}

// 装配环 rig 容量 = 当前舰船数据库中最大 rig 槽数（不硬编码，随数据库自动扩展）
let ORBIT_RIG_CAPACITY_CACHE = 0;
function getOrbitRigCapacity() {
  if (ORBIT_RIG_CAPACITY_CACHE > 0) return ORBIT_RIG_CAPACITY_CACHE;
  const pools = [STARTER_SHIPS, INDUSTRIAL_SHIPS, typeof ARCHAEOLOGY_SHIPS !== "undefined" ? ARCHAEOLOGY_SHIPS : {}];
  let capacity = 3;
  for (const pool of pools) {
    for (const config of Object.values(pool || {})) {
      capacity = Math.max(capacity, Number(config && config.slots && config.slots.rig) || 0);
    }
  }
  ORBIT_RIG_CAPACITY_CACHE = capacity;
  return capacity;
}

function getShipFittingDisplayState(state, shipRef) {
  const instance = getShipInstanceFromState(state, shipRef);
  if (!instance) return null;
  const config = getShipConfigById(instance.shipId);
  if (!config) return null;
  const fitting = getFittingFromInstance(instance);
  const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  const slots = { high:config.slots.high || 0, mid:config.slots.mid || 0, low:config.slots.low || 0, rig:config.slots.rig || 0 };
  const orbitSlots = [];
  const totalOrbitSlots = 24 + slots.rig; // 8高 + 8中 + 8低 + 本舰 rig 槽数（rig 索引从 24 起，随舰船动态；illuminator=28，starcrown=29）
  for (let index = 0; index < totalOrbitSlots; index++) {
    const type = index < 8 ? "high" : index < 16 ? "mid" : index < 24 ? "low" : "rig";
    const start = type === "high" ? 0 : type === "mid" ? 8 : type === "low" ? 16 : 24;
    const slotIndex = index - start;
    const enabled = slotIndex < slots[type]; // rig 槽已随改装件系统解禁（超出舰船槽数的仍禁用）
    const equipmentRef = enabled ? fitting[type][slotIndex] || null : null;
    const resolved = equipmentRef ? resolveEquipmentReference(state, equipmentRef) : null;
    const equipment = resolved ? resolved.definition : null;
    orbitSlots.push({
      index, type, slotIndex, enabled, equipmentRef, equipmentId: resolved ? resolved.itemId : null,
      enhancementLevel: resolved ? resolved.enhancementLevel : 0,
      name: equipment ? equipment.name : "", icon: equipment ? ITEM_ICONS[equipment.name] || "📦" : null,
      installedInstanceId: resolved && resolved.instance ? resolved.instance.instanceId : null
    });
  }
  const equippedIds = Object.values(fitting).flat().filter(Boolean);
  const enhancement = getShipEnhancementBonuses(config, instance.enhancementLevel);
  const rigMods = (typeof getRigModifiers === "function") ? getRigModifiers(state, instance) : {};
  return {
    instanceId:instance.instanceId,
    shipId:instance.shipId,
    name:config.name,
    tier:config.tier,
    type:config.type,
    typeName:typeof SHIP_TYPE_NAMES !== "undefined" ? SHIP_TYPE_NAMES[config.type] || config.type : config.type,
    slots,
    orbitSlots,
    equipped:equippedIds.map(id => {
      const resolved = resolveEquipmentReference(state, id);
      const equipment = resolved ? resolved.definition : null;
      return {
        ref:id, id: resolved ? resolved.itemId : id,
        enhancementLevel: resolved ? resolved.enhancementLevel : 0,
        name: equipment ? equipment.name : id,
        icon: equipment ? ITEM_ICONS[equipment.name] || "📦" : "📦"
      };
    }),
    inventoryBySlot:Object.fromEntries(["high", "mid", "low", "rig"].map(slot => {
      // 1. 来自 inventory 字符串池的候选
      const fromInventory = inventory.filter(id => {
        const eq = EQUIPMENT_DB[id];
        if (!eq || eq.slot !== slot || !canFitEquipmentOnShip(eq, config)) return false;
        if (slot === "rig" && typeof canFitRig === "function" && !canFitRig(state, instance, id).ok) return false;
        return true;
      }).map(id => ({ id, name:EQUIPMENT_DB[id].name, icon:ITEM_ICONS[EQUIPMENT_DB[id].name] || "📦", enhancementLevel:0, isInstance:false }));
      // 2. 来自实例池中游离（installedOn===null）的非 rig 装备
      let fromInstances = [];
      if (state.equipment && Array.isArray(state.equipment.instances)) {
        const freeInsts = state.equipment.instances.filter(inst => inst.installedOn === null && !(inst.itemId || "").startsWith("rig_"));
        fromInstances = freeInsts.map(inst => {
          const itemId = inst.itemId;
          const eq = EQUIPMENT_DB[itemId];
          if (!eq || eq.slot !== slot || !canFitEquipmentOnShip(eq, config)) return null;
          return { id:inst.instanceId, name:eq.name, icon:ITEM_ICONS[eq.name] || "📦", enhancementLevel:Math.max(0, Number(inst.enhancementLevel) || 0), isInstance:true };
        }).filter(Boolean);
      }
      return [slot, fromInventory.concat(fromInstances)];
    })),
    // rig 候选按槽位计算：excludeSlotIndex 排除当前槽（替换场景旧件将被销毁），
    // 其他槽存在同 stackGroup 时仍拒绝。UI 打开某 rig 槽时消费 rigCandidates[slotIndex]。
    rigCandidates:Array.from({ length:slots.rig }, (unusedValue, slotIndex) => inventory.filter(id => {
      const eq = EQUIPMENT_DB[id];
      if (!eq || eq.slot !== "rig" || !canFitEquipmentOnShip(eq, config)) return false;
      return typeof canFitRig !== "function" || canFitRig(state, instance, id, slotIndex).ok;
    }).map(id => ({ id, name:EQUIPMENT_DB[id].name, icon:ITEM_ICONS[EQUIPMENT_DB[id].name] || "📦" }))),
    enhancementLevel:normalizeShipEnhancementLevel(instance.enhancementLevel),
    stats:{ shield:Math.round(config.hp.shield * enhancement.hpMultiplier * (1 + (rigMods.shieldCapacityPercent || 0))), armor:Math.round(config.hp.armor * enhancement.hpMultiplier * (1 + (rigMods.armorCapacityPercent || 0))), structure:Math.round(config.hp.structure * enhancement.hpMultiplier * (1 + (rigMods.structureCapacityPercent || 0))), speed:config.speed || 0 },
    combatLocked:Boolean(state.combat && state.combat.active && getActiveCombatShipState(state).instance && getActiveCombatShipState(state).instance.instanceId === instance.instanceId)
  };
}

function getQueueDisplayState(state) {
  const queue = state.queue || { items:[], config:{}, status:{} };
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipEngineering:"🚀", equipmentEngineering:"🔧" };
  const labels = { mining:"⛏采矿", refining:"🔥冶炼", gasHarvesting:"☁️气体", shipEngineering:"🚀舰船", equipmentEngineering:"🔧装备工程" };
  return {
    kind:"queue",
    running:Boolean(queue.status.isRunning),
    statusText:queue.status.isRunning ? "▶ 运行中" : "空闲",
    loopMode:Boolean(queue.config.loopMode),
    maxSize:Number(queue.config.maxSize) || 20,
    count:Array.isArray(queue.items) ? queue.items.length : 0,
    completedCount:Number(queue.status.completedCount) || 0,
    failCount:Number(queue.status.failCount) || 0,
    items:(queue.items || []).map((item, index) => ({
      ...item,
      index,
      active:Boolean(queue.status.isRunning && queue.status.activeIndex === index),
      icon:icons[item.skill] || "▶",
      skillLabel:labels[item.skill] || item.skill,
      countText:item.count === -1 ? "无限" : "剩余 ×" + (item.count || 1) + " 次",
      canMoveUp:index > 0,
      canMoveDown:index < queue.items.length - 1
    }))
  };
}

function getSettingsDisplayState(state) {
  return {
    kind:"settings",
    confirmShipEnhancement:!state.settings || state.settings.confirmShipEnhancement !== false,
    combatSkillsExpanded:Boolean(state.settings && state.settings.combatSkillsExpanded)
  };
}

function getStatisticsDisplayState(state) {
  const statistics = state && state.statistics ? state.statistics : createDefaultStatisticsState();
  const totals = statistics.totals || {};
  const activity = statistics.activity || {};
  const production = statistics.production || {};
  const combat = statistics.combat || {};
  const number = value => Math.max(0, Number(value) || 0);
  const resourceNames = new Map(ResourceRegistry.listDefinitions().map(definition => [definition.id, definition.name]));
  const recipeNames = new Map([
    ...SHIP_COMPONENT_RECIPES.map(recipe => [recipe.id, recipe.name]),
    ...SHIP_ASSEMBLY_RECIPES.map(recipe => [recipe.id, recipe.name]),
    ...Object.values(EQUIPMENT_DB).map(recipe => [recipe.id, recipe.name]),
    ...AMMO_ENG_RECIPES.map(recipe => [recipe.id, recipe.name])
  ]);
  const zoneNames = new Map([
    ...COMBAT_ZONES.map(zone => [zone.id, zone.name]),
    ...DEATHSPACE_DATABASE.map(site => [site.id, site.name])
  ]);
  const deathspaceNames = new Map(DEATHSPACE_DATABASE.map(site => [site.id, site.name]));
  const factionNames = new Map([["angel", "天使联合"], ["blood", "血袭者"], ["sansha", "萨沙共和国"]]);
  const fallbackName = id => {
    const text = String(id || "未知");
    const separator = text.indexOf(":");
    return separator >= 0 ? text.slice(separator + 1) : text;
  };
  const ranked = (map, names) => Object.entries(map || {})
    .map(([id, value]) => ({ id, name:names.get(id) || fallbackName(id), value:number(value) }))
    .filter(item => item.value > 0)
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "zh-CN"));
  const attempts = number(totals.enhancementAttempts);
  const successes = number(totals.enhancementSuccesses);

  return {
    kind:"statistics",
    note:"数据从统计系统启用后开始累计；旧存档此前发生的行为不会倒推补记。",
    summaryGroups:[
      { id:"career", icon:"fa-solid fa-user-astronaut", title:"航行生涯", items:[
        { label:"记录事件", value:number(totals.events) },
        { label:"在线周期", value:number(activity.onlineCycles) },
        { label:"离线周期", value:number(activity.offlineCycles) },
        { label:"技能升级", value:number(totals.skillLevelsGained) }
      ] },
      { id:"production", icon:"fa-solid fa-industry", title:"生产活动", items:[
        { label:"采矿循环", value:number(totals.miningCycles) },
        { label:"采集产物", value:number(totals.minedUnits) + number(totals.gasUnits) + number(totals.planetaryUnits) },
        { label:"冶炼产物", value:number(totals.refinedUnits) },
        { label:"制造次数", value:number(totals.manufacturingCycles) },
        { label:"建造舰船", value:number(totals.shipsBuilt) }
      ] },
      { id:"combat", icon:"fa-solid fa-crosshairs", title:"战斗记录", items:[
        { label:"击毁敌舰", value:number(totals.enemyKills) },
        { label:"精英击毁", value:number(totals.eliteKills) },
        { label:"BOSS击毁", value:number(totals.bossKills) },
        { label:"完成波次", value:number(totals.wavesCleared) },
        { label:"肃清星带", value:number(totals.zonesCleared) },
        { label:"死亡空间层数", value:number(totals.deathspaceWavesCleared) },
        { label:"死亡空间全通", value:number(totals.deathspacesCleared) },
        { label:"舰船战败", value:number(totals.shipsDestroyed) }
      ] },
      { id:"enhancement", icon:"fa-solid fa-angles-up", title:"舰船强化", items:[
        { label:"强化尝试", value:attempts },
        { label:"成功", value:successes },
        { label:"失败", value:number(totals.enhancementFailures) },
        { label:"成功率", value:attempts > 0 ? successes / attempts * 100 : 0, suffix:"%", decimals:1 },
        { label:"消耗部件", value:number(totals.enhancementComponentsSpent) },
        { label:"历史最高", value:number(totals.highestEnhancementLevel), prefix:"+" }
      ] }
    ],
    detailGroups:[
      { id:"gathered", title:"采集产出", icon:"fa-solid fa-gem", items:ranked(production.gathered, resourceNames), emptyText:"尚无采集记录" },
      { id:"refined", title:"冶炼产出", icon:"fa-solid fa-fire", items:ranked(production.refined, resourceNames), emptyText:"尚无冶炼记录" },
      { id:"manufactured", title:"制造产出", icon:"fa-solid fa-screwdriver-wrench", items:ranked(production.manufactured, recipeNames), emptyText:"尚无制造记录" },
      { id:"zones", title:"星带肃清", icon:"fa-solid fa-burst", items:ranked(combat.zoneClears, zoneNames), emptyText:"尚无肃清记录" },
      { id:"deathspaces", title:"死亡空间全通", icon:"fa-solid fa-dungeon", items:ranked(combat.deathspaceClears, deathspaceNames), emptyText:"尚无全通记录" },
      { id:"zoneKills", title:"战斗区域击毁", icon:"fa-solid fa-skull-crossbones", items:ranked(combat.zoneKills, zoneNames), emptyText:"尚无击毁记录" },
      { id:"factions", title:"势力击毁", icon:"fa-solid fa-flag", items:ranked(combat.factionKills, factionNames), emptyText:"尚无势力击毁记录" }
    ]
  };
}

function getNavigationDisplayState(page, view) {
  const standalonePages = { cargo:"cargo-panel", save:"save-panel", settings:"settings-panel", statistics:"statistics-panel", planetary:"planetary-panel", queue:"queue-panel", combat:"combat-panel", hangar:"hangar-panel", archaeology:"archaeology-panel", blueprints:"blueprintstore-panel", lpstore:"blueprintstore-panel" };
  const skillPanels = { shipEngineering:"shipeng-panel", equipmentEngineering:"equipeng-panel", boosterEngineering:"booster-panel", combat:"combat-panel" };
  const selectedPage = page || "skill";
  const selectedView = view || "mining";
  return {
    page:selectedPage,
    view:selectedView,
    standalonePanel:standalonePages[selectedPage] || null,
    specializedSkillPanel:selectedPage === "skill" ? skillPanels[selectedView] || null : null,
    showGenericSkill:selectedPage === "skill" && !skillPanels[selectedView],
    activeNav:selectedPage === "skill" ? { type:"skill", value:selectedView } : { type:"page", value:selectedPage }
  };
}

function getActiveActionProgressDisplayState(state, now) {
  const action = state.currentAction;
  return getProgressDisplayState(action, action.skill, Number(action.refDuration) || 1, now);
}
