/* ================================================================
   状态动作层

   规则：只修改显式传入的 state；不访问 DOM、不调用 render/updateUI。
   返回 changed/reason，兼容层自行决定是否刷新界面。
   ================================================================ */

const ProductionStateActions = {
  ensureMiningArea(state) {
    if (getMiningAreaByName(state.currentAction.area)) return { changed:false, reason:"already-valid" };
    const mode = state.currentAction.miningMode === "moon" ? "moon" : "normal";
    const areas = mode === "moon" ? MOON_MINING_AREAS : MINING_AREAS;
    const level = Number(state.skills.mining && state.skills.mining.lvl) || 1;
    let bestArea = areas[0];
    for (const area of areas) { if (level >= area.level) bestArea = area; else break; }
    state.currentAction.area = bestArea.name;
    state._dirty = true;
    return { changed:true, area:bestArea };
  },

  selectMiningArea(state, areaName, now) {
    const area = getMiningAreaByName(areaName);
    if (!area) return { changed:false, reason:"unknown-area" };
    if ((state.skills.mining.lvl || 1) < area.level) return { changed:false, reason:"level-locked" };
    const action = state.currentAction;
    action.area = area.name;
    action.miningMode = area.mode;
    if (area.mode === "moon") action.moonMiningArea = area.name;
    else action.normalMiningArea = area.name;
    if (!action.active || action.skill !== "mining") {
      action.progress = 0;
      action.lastProgressUpdate = now;
    }
    state._dirty = true;
    return { changed:true, area };
  },

  selectMiningMode(state, mode) {
    if (mode !== "normal" && mode !== "moon") return { changed:false, reason:"unknown-mode" };
    const action = state.currentAction;
    action.miningMode = mode;
    const savedName = mode === "moon" ? action.moonMiningArea : action.normalMiningArea;
    const savedArea = getMiningAreaByName(savedName);
    const areas = mode === "moon" ? MOON_MINING_AREAS : MINING_AREAS;
    const level = Number(state.skills.mining && state.skills.mining.lvl) || 1;
    let bestArea = areas[0];
    for (const area of areas) { if (level >= area.level) bestArea = area; else break; }
    action.area = savedArea && savedArea.mode === mode ? savedArea.name : bestArea.name;
    state._dirty = true;
    return { changed:true, mode, area:action.area };
  },

  selectSmeltingRecipe(state, areaName, now) {
    const recipe = SMELTING_RECIPES.find(item => item.name === areaName);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    if ((state.skills.refining.lvl || 1) < recipe.level) return { changed:false, reason:"level-locked" };
    const action = state.currentAction;
    action.smeltingArea = recipe.name;
    if (!action.active || action.skill !== "refining") {
      action.progress = 0;
      action.lastProgressUpdate = now;
    }
    state._dirty = true;
    return { changed:true, recipe };
  },

  selectGasArea(state, areaName, now) {
    const area = GAS_AREAS.find(item => item.name === areaName);
    if (!area) return { changed:false, reason:"unknown-area" };
    if ((state.skills.gasHarvesting.lvl || 1) < area.level) return { changed:false, reason:"level-locked" };
    const action = state.currentAction;
    action.gasArea = area.name;
    if (!action.active || action.skill !== "gasHarvesting") {
      action.progress = 0;
      action.lastProgressUpdate = now;
    }
    state._dirty = true;
    return { changed:true, area };
  }
};

const ManufacturingStateActions = {
  buyBlueprint(state, blueprintId) {
    const blueprint = SHIP_BLUEPRINTS.find(item => item.id === blueprintId);
    if (!blueprint) return { changed:false, reason:"unknown-blueprint" };
    if ((state.ownedBlueprints || []).includes(blueprint.shipId)) return { changed:false, reason:"already-owned" };
    const currency = blueprint.costLP ? "lp" : "isk";
    const price = blueprint.costLP || blueprint.costISK || 0;
    if (ResourceRegistry.get(state, "currency:" + currency) < price) return { changed:false, reason:"insufficient-" + currency };
    ResourceRegistry.spend(state, "currency:" + currency, price);
    if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
    state.ownedBlueprints.push(blueprint.shipId);
    state._dirty = true;
    return { changed:true, blueprint };
  },

  selectShipComponent(state, componentId) {
    const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === componentId);
    if (!recipe) return { changed:false, reason:"unknown-component" };
    if ((state.skills.shipEngineering.lvl || 1) < recipe.level) return { changed:false, reason:"level-locked" };
    state.currentAction.shipCompTarget = recipe.id;
    state._dirty = true;
    return { changed:true, recipe };
  },

  selectShipAssembly(state, recipeId) {
    const recipe = SHIP_ASSEMBLY_RECIPES.find(item => item.id === recipeId);
    if (!recipe) return { changed:false, reason:"unknown-assembly" };
    const hasBlueprint = recipe.requiresBlueprint === false || (state.ownedBlueprints || []).includes(recipe.shipId);
    if (!hasBlueprint) return { changed:false, reason:"blueprint-locked" };
    if ((state.skills.shipEngineering.lvl || 1) < recipe.level) return { changed:false, reason:"level-locked" };
    state.currentAction.shipAsmTarget = recipe.id;
    state._dirty = true;
    return { changed:true, recipe };
  },

  startShipComponent(state, now) {
    const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === state.currentAction.shipCompTarget) || SHIP_COMPONENT_RECIPES[0];
    if ((state.skills.shipEngineering.lvl || 1) < recipe.level) return { changed:false, reason:"level-locked" };
    Object.assign(state.currentAction, {
      skill:"shipEngineering",
      active:true,
      shipSubAction:"component",
      startedShipCompTarget:recipe.id,
      progress:0,
      lastProgressUpdate:now
    });
    state._dirty = true;
    return { changed:true, recipe };
  },

  startShipAssembly(state, now) {
    const recipe = SHIP_ASSEMBLY_RECIPES.find(item => item.id === state.currentAction.shipAsmTarget) || SHIP_ASSEMBLY_RECIPES[0];
    const hasBlueprint = recipe.requiresBlueprint === false || (state.ownedBlueprints || []).includes(recipe.shipId);
    if (!hasBlueprint) return { changed:false, reason:"blueprint-locked" };
    if ((state.skills.shipEngineering.lvl || 1) < recipe.level) return { changed:false, reason:"level-locked" };
    if (getShipAssemblyMaxCyclesFromState(state, recipe) < 1) return { changed:false, reason:"insufficient-components" };
    Object.assign(state.currentAction, {
      skill:"shipEngineering",
      active:true,
      shipSubAction:"assembly",
      startedShipAsmTarget:recipe.id,
      progress:0,
      lastProgressUpdate:now
    });
    state._dirty = true;
    return { changed:true, recipe };
  },

  selectEquipmentCategory(state, categoryId) {
    const category = EQUIPMENT_ENGINEERING_CATEGORIES.find(item => item.id === categoryId);
    if (!category) return { changed:false, reason:"unknown-category" };
    state.currentAction.equipEngCategory = category.id;
    const recipes = EQUIPMENT_ENGINEERING_RECIPES.filter(recipe => recipe.category === category.id);
    const current = getEquipmentEngineeringRecipe(state.currentAction.equipEngTarget || "t1_mining_laser");
    if (!recipes.some(recipe => recipe.id === current.id)) {
      const next = recipes.find(recipe => (state.skills.equipmentEngineering.lvl || 1) >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe)) || recipes[0];
      if (next) state.currentAction.equipEngTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, category };
  },

  selectEquipmentRecipe(state, recipeId) {
    const recipe = EQUIPMENT_ENGINEERING_RECIPES.find(item => item.id === recipeId);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    if (!equipmentRecipeHasRequiredBlueprint(state, recipe)) return { changed:false, reason:"blueprint-locked" };
    if ((state.skills.equipmentEngineering.lvl || 1) < recipe.level) return { changed:false, reason:"level-locked" };
    state.currentAction.equipEngTarget = recipe.id;
    state.currentAction.equipEngCategory = recipe.category;
    state._dirty = true;
    return { changed:true, recipe };
  },

  stop(state, now) {
    const action = state.currentAction;
    if (!action.active || (action.skill !== "shipEngineering" && action.skill !== "equipmentEngineering")) return { changed:false, reason:"not-manufacturing" };
    action.progress = 0;
    action.lastProgressUpdate = now;
    action.active = false;
    action.batchRemaining = 0;
    state._dirty = true;
    return { changed:true };
  }
};

const CombatStateActions = {
  selectMode(state, mode) {
    if (mode !== "belt" && mode !== "deathspace") return { changed:false, reason:"unknown-mode" };
    state.combat.viewMode = mode;
    if (state.combat.active) {
      state._dirty = true;
      return { changed:true, mode, viewOnly:true };
    }
    state.combat.mode = mode;
    state.combat.enemies = [];
    state.combat.currentEnemy = null;
    state.combat.wave = 1;
    state.combat.currentFormation = "";
    state.combat.lastLoot = "";
    state.combat.lastSpecialLoot = "";
    state.combat.lastStatus = "";
    state.combat.lastEnemyVolley = null;
    state._dirty = true;
    return { changed:true, mode };
  },

  selectZone(state, zoneId) {
    const zone = COMBAT_ZONES.find(item => item.id === zoneId);
    if (!zone) return { changed:false, reason:"unknown-zone" };
    if (state.combat.active) return { changed:false, reason:"combat-active" };
    if (getCombatLevelFromState(state) < (zone.requiredCL || 1)) return { changed:false, reason:"level-locked", requiredCL:zone.requiredCL || 1 };
    Object.assign(state.combat, {
      mode:"belt",
      viewMode:"belt",
      zone:zone.id,
      enemies:[],
      currentEnemy:null,
      wave:1,
      totalKills:0,
      runEliteKills:0,
      currentFormation:"",
      lastLoot:"",
      lastSpecialLoot:"",
      lastStatus:"",
      lastEnemyVolley:null
    });
    state._dirty = true;
    return { changed:true, zone };
  },

  selectDeathspace(state, deathspaceId) {
    const site = DEATHSPACE_DATABASE.find(item => item.id === deathspaceId);
    if (!site) return { changed:false, reason:"unknown-deathspace" };
    if (getCombatLevelFromState(state) < site.requiredCL) return { changed:false, reason:"level-locked", requiredCL:site.requiredCL };
    if (state.combat.active) {
      Object.assign(state.combat, {
        viewMode:"deathspace",
        viewDeathspaceId:site.id,
        viewDeathspaceTier:site.dedTier
      });
      state._dirty = true;
      return { changed:true, site, viewOnly:true };
    }
    Object.assign(state.combat, {
      mode:"deathspace",
      viewMode:"deathspace",
      deathspaceId:site.id,
      deathspaceTier:site.dedTier,
      viewDeathspaceId:site.id,
      viewDeathspaceTier:site.dedTier,
      zone:site.sourceZoneId,
      enemies:[], currentEnemy:null, wave:1, totalKills:0, runEliteKills:0,
      currentFormation:"", lastLoot:"", lastSpecialLoot:"", lastStatus:"", lastEnemyVolley:null
    });
    state._dirty = true;
    return { changed:true, site };
  },

  selectDeathspaceTier(state, tier) {
    const selectedTier = Number(tier);
    if (![2,3,4,6].includes(selectedTier)) return { changed:false, reason:"unknown-deathspace-tier" };
    const currentSite = DEATHSPACE_DATABASE.find(site => site.id === (state.combat.viewDeathspaceId || state.combat.deathspaceId));
    const site = DEATHSPACE_DATABASE.find(item => item.dedTier === selectedTier && item.faction === (currentSite && currentSite.faction)) ||
      DEATHSPACE_DATABASE.find(item => item.dedTier === selectedTier);
    if (state.combat.active) {
      Object.assign(state.combat, {
        viewMode:"deathspace",
        viewDeathspaceTier:selectedTier,
        viewDeathspaceId:site.id
      });
      state._dirty = true;
      return { changed:true, tier:selectedTier, site, viewOnly:true };
    }
    Object.assign(state.combat, {
      mode:"deathspace", viewMode:"deathspace",
      deathspaceTier:selectedTier, deathspaceId:site.id,
      viewDeathspaceTier:selectedTier, viewDeathspaceId:site.id,
      zone:site.sourceZoneId,
      enemies:[], currentEnemy:null, wave:1, totalKills:0, runEliteKills:0,
      currentFormation:"", lastLoot:"", lastSpecialLoot:"", lastStatus:"", lastEnemyVolley:null
    });
    state._dirty = true;
    return { changed:true, tier:selectedTier, site };
  },

  start(state, enemies, formationId, now) {
    const display = getCombatDisplayState(state, now);
    if (display.recovery.active) return { changed:false, reason:"repairing", remaining:display.recovery.remaining };
    if (!display.zone.unlocked) return { changed:false, reason:"level-locked", requiredCL:display.zone.requiredCL || 1 };
    if (display.weapons.length === 0) return { changed:false, reason:"no-weapons" };
    const living = getCombatLivingEnemiesFromState(state.combat);
    if (living.length === 0) {
      if (!Array.isArray(enemies) || enemies.length === 0) return { changed:false, reason:"missing-formation" };
      state.combat.enemies = enemies;
      state.combat.currentEnemy = enemies[0] || null;
      state.combat.currentFormation = formationId || "";
    } else {
      state.combat.currentEnemy = living[0];
    }
    state.currentAction.skill = "combat";
    state.currentAction.active = true;
    state.combat.mode = "belt";
    state.combat.viewMode = "belt";
    state.combat.active = true;
    state.combat.lastStatus = "";
    state.combat.lastEnemyVolley = null;
    state._dirty = true;
    return { changed:true };
  },

  enterDeathspace(state, deathspaceId, enemies, formationId, now) {
    const site = DEATHSPACE_DATABASE.find(item => item.id === deathspaceId);
    if (!site) return { changed:false, reason:"unknown-deathspace" };
    const recoveryUntil = Number(state.combat.repairUntil) || 0;
    if (recoveryUntil > now) return { changed:false, reason:"repairing", remaining:Math.ceil((recoveryUntil - now) / 1000) };
    if (getCombatLevelFromState(state) < site.requiredCL) return { changed:false, reason:"level-locked", requiredCL:site.requiredCL };
    const weapons = getInstalledCombatModulesFromState(state).filter(module => module.combat.kind === "weapon");
    if (weapons.length === 0) return { changed:false, reason:"no-weapons" };
    if (ResourceRegistry.get(state, "special:" + site.ticketMaterial) < 1) return { changed:false, reason:"missing-ticket", ticketMaterial:site.ticketMaterial };
    if (!Array.isArray(enemies) || enemies.length === 0) return { changed:false, reason:"missing-formation" };
    ResourceRegistry.spend(state, "special:" + site.ticketMaterial, 1);
    Object.assign(state.combat, {
      mode:"deathspace", viewMode:"deathspace", deathspaceId:site.id, zone:site.sourceZoneId,
      deathspaceTier:site.dedTier, viewDeathspaceId:site.id, viewDeathspaceTier:site.dedTier,
      active:true, enemies, currentEnemy:enemies[0] || null, wave:1,
      totalKills:0, runEliteKills:0, currentFormation:formationId || "deathspace_1",
      lastLoot:"", lastSpecialLoot:"", lastStatus:"通行密钥已消耗", lastEnemyVolley:null
    });
    state.currentAction.skill = "combat";
    state.currentAction.active = true;
    state._dirty = true;
    return { changed:true, site };
  },

  stop(state) {
    if (!state.combat.active && !(state.currentAction.active && state.currentAction.skill === "combat")) return { changed:false, reason:"not-active" };
    const maxHp = getCombatMaxHpFromState(state);
    const abandonedDeathspace = state.combat.mode === "deathspace";
    state.currentAction.active = false;
    Object.assign(state.combat, {
      active:false,
      hp:{ ...maxHp },
      maxHp:{ ...maxHp },
      enemies:[],
      currentEnemy:null,
      wave:1,
      totalKills:0,
      runEliteKills:0,
      currentFormation:"",
      lastLoot:"",
      lastSpecialLoot:"",
      lastStatus:abandonedDeathspace ? "已撤离死亡空间，通行密钥不返还" : "",
      lastEnemyVolley:null
    });
    state._dirty = true;
    return { changed:true, abandonedDeathspace };
  },

  beginRecovery(state, now) {
    const activeShip = getActiveCombatShipState(state);
    const failedDeathspace = state.combat.mode === "deathspace";
    state.currentAction.active = false;
    Object.assign(state.combat, {
      active:false,
      enemies:[],
      currentEnemy:null,
      wave:1,
      totalKills:0,
      runEliteKills:0,
      currentFormation:"",
      lastEnemyVolley:null,
      repairUntil:now + 180000,
      destroyedShip:activeShip.instance ? activeShip.instance.instanceId : null,
      lastStatus:failedDeathspace ? "死亡空间攻略失败，通行密钥不返还；舰船自动维修中" : "舰船损毁，自动维修中"
    });
    state._dirty = true;
    return { changed:true, repairUntil:state.combat.repairUntil, failedDeathspace };
  },

  finishRecovery(state, now) {
    const repairUntil = Number(state.combat.repairUntil) || 0;
    if (!repairUntil || now < repairUntil) return { changed:false, reason:"not-due" };
    const maxHp = getCombatMaxHpFromState(state);
    state.combat.hp = { ...maxHp };
    state.combat.maxHp = { ...maxHp };
    state.combat.repairUntil = 0;
    state.combat.destroyedShip = null;
    state.combat.lastStatus = "自动维修完成，可以重新出击";
    state._dirty = true;
    return { changed:true };
  }
};

const PlanetaryStateActions = {
  deploy(state, type, now) {
    const config = PLANET_TYPES.find(planet => planet.type === type);
    if (!config) return { changed:false, reason:"unknown-planet" };
    const capacity = getPlanetaryCapacityState(state);
    if (capacity.level < config.level) return { changed:false, reason:"level-locked", level:config.level };
    if (capacity.usedSlots >= capacity.slots) return { changed:false, reason:"no-slots" };
    if (ResourceRegistry.get(state, "currency:isk") < config.costISK) return { changed:false, reason:"insufficient-isk" };
    const tritanium = ResourceRegistry.get(state, "mineral:三钛合金");
    if (tritanium < config.costTrit) return { changed:false, reason:"insufficient-tritanium" };
    ResourceRegistry.spend(state, "currency:isk", config.costISK);
    ResourceRegistry.spend(state, "mineral:三钛合金", config.costTrit);
    if (!state.planetary) state.planetary = { deployments:[], nextId:1 };
    if (!Array.isArray(state.planetary.deployments)) state.planetary.deployments = [];
    const nextId = Number(state.planetary.nextId) || 1;
    const deployment = { id:"planet_" + nextId, type:config.type, deployedAt:now, duration:86400, storage:0, lastTick:now, progress:0, active:true };
    state.planetary.nextId = nextId + 1;
    state.planetary.deployments.push(deployment);
    state._dirty = true;
    return { changed:true, deployment, config };
  },

  collect(state, id, cargoCapacity) {
    const deployment = state.planetary && state.planetary.deployments.find(item => item.id === id);
    if (!deployment) return { changed:false, reason:"unknown-deployment" };
    if ((Number(deployment.storage) || 0) <= 0) return { changed:false, reason:"empty" };
    const freeCargo = Math.max(0, (Number(cargoCapacity) || 10000000) - getCargoUsedFromState(state));
    const quantity = Math.min(Number(deployment.storage) || 0, freeCargo);
    if (quantity <= 0) return { changed:false, reason:"cargo-full" };
    const config = PLANET_TYPES.find(planet => planet.type === deployment.type);
    const output = config ? config.output : "未知产物";
    ResourceRegistry.add(state, "planetary:" + output, quantity);
    deployment.storage -= quantity;
    state._dirty = true;
    return { changed:true, quantity, output };
  },

  redeploy(state, id, now) {
    const deployment = state.planetary && state.planetary.deployments.find(item => item.id === id);
    if (!deployment) return { changed:false, reason:"unknown-deployment" };
    const config = PLANET_TYPES.find(planet => planet.type === deployment.type);
    if (!config) return { changed:false, reason:"unknown-planet" };
    if (ResourceRegistry.get(state, "currency:isk") < config.costISK) return { changed:false, reason:"insufficient-isk" };
    const tritanium = ResourceRegistry.get(state, "mineral:三钛合金");
    if (tritanium < config.costTrit) return { changed:false, reason:"insufficient-tritanium" };
    ResourceRegistry.spend(state, "currency:isk", config.costISK);
    ResourceRegistry.spend(state, "mineral:三钛合金", config.costTrit);
    Object.assign(deployment, { deployedAt:now, lastTick:now, progress:0, active:true });
    state._dirty = true;
    return { changed:true, deployment, config };
  },

  remove(state, id) {
    const deployments = state.planetary && state.planetary.deployments;
    const index = Array.isArray(deployments) ? deployments.findIndex(item => item.id === id) : -1;
    if (index < 0) return { changed:false, reason:"unknown-deployment" };
    if ((Number(deployments[index].storage) || 0) > 0) return { changed:false, reason:"storage-not-empty" };
    const removed = deployments.splice(index, 1)[0];
    state._dirty = true;
    return { changed:true, removed };
  }
};

function getQueueItemConfigForState(item) {
  const skill = item.skill === "ammunitionEngineering" ? "equipmentEngineering" : item.skill;
  const config = { skill, progress:0, active:true, batchRemaining:item.count || 1 };
  if (skill === "mining") config.area = item.target;
  else if (skill === "refining") config.smeltingArea = item.target;
  else if (skill === "gasHarvesting") config.gasArea = item.target;
  else if (skill === "shipEngineering") {
    const component = SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === item.target || recipe.name === item.target);
    const assembly = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === item.target || recipe.name === item.target);
    if (component) { config.shipSubAction = "component"; config.shipCompTarget = component.id; }
    else if (assembly) { config.shipSubAction = "assembly"; config.shipAsmTarget = assembly.id; }
    else { config.shipSubAction = "component"; config.shipCompTarget = "integrated_hull"; }
  } else if (skill === "equipmentEngineering") {
    config.equipEngTarget = EQUIPMENT_ENGINEERING_RECIPES.find(recipe => recipe.id === item.target || recipe.name === item.target)?.id || "t1_mining_laser";
  }
  return config;
}

function applyQueueConfigToState(state, config, now) {
  const action = state.currentAction;
  Object.assign(action, { skill:config.skill, active:true, progress:0, lastProgressUpdate:now, batchRemaining:config.batchRemaining });
  if (config.area) {
    const area = ALL_MINING_AREAS.find(item => item.name === config.area || item.ore === config.area);
    action.area = config.area; action.startedArea = config.area;
    if (area) { action.miningMode = area.mode; if (area.mode === "moon") action.moonMiningArea = area.name; else action.normalMiningArea = area.name; }
  }
  if (config.smeltingArea) { action.smeltingArea = config.smeltingArea; action.startedSmeltingArea = config.smeltingArea; }
  if (config.gasArea) { action.gasArea = config.gasArea; action.startedGasArea = config.gasArea; }
  if (config.shipSubAction) action.shipSubAction = config.shipSubAction;
  if (config.shipCompTarget) { action.shipCompTarget = config.shipCompTarget; action.startedShipCompTarget = config.shipCompTarget; }
  if (config.shipAsmTarget) { action.shipAsmTarget = config.shipAsmTarget; action.startedShipAsmTarget = config.shipAsmTarget; }
  if (config.equipEngTarget) { action.equipEngTarget = config.equipEngTarget; action.startedEquipEngTarget = config.equipEngTarget; }
}

const ShellStateActions = {
  stopCurrentAction(state, now) {
    const action = state.currentAction;
    const previous = { skill:action.skill, shipSubAction:action.shipSubAction };
    action.progress = 0;
    action.lastProgressUpdate = now;
    action.active = false;
    action.batchRemaining = 0;
    state._dirty = true;
    return { changed:true, ...previous };
  },

  clearIndustrialShip(state) {
    if (!state.activeIndustrialShip) return { changed:false, reason:"already-empty" };
    state.activeIndustrialShip = null;
    state._dirty = true;
    return { changed:true };
  },

  setShipEnhancementConfirmation(state, enabled) {
    ensureUserSettingsState(state).confirmShipEnhancement = Boolean(enabled);
    state._dirty = true;
    return { changed:true, enabled:Boolean(enabled) };
  },

  toggleCombatSkills(state) {
    const settings = ensureUserSettingsState(state);
    settings.combatSkillsExpanded = !settings.combatSkillsExpanded;
    state._dirty = true;
    return { changed:true, expanded:settings.combatSkillsExpanded };
  },

  buyLPItem(state, itemId) {
    const item = getLPStoreCatalogItem(itemId);
    if (!item) return { changed:false, reason:"unknown-item" };
    if (item.kind === "equipmentBlueprint" && hasEquipmentBlueprintFromState(state, item.equipmentId)) return { changed:false, reason:"already-owned" };
    if (ResourceRegistry.get(state, "currency:lp") < item.lpPrice) return { changed:false, reason:"insufficient-lp" };
    ResourceRegistry.spend(state, "currency:lp", item.lpPrice);
    if (item.kind === "equipmentBlueprint") {
      if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
      state.ownedBlueprints.push(getEquipmentBlueprintOwnershipKey(item.equipmentId));
      state._dirty = true;
      return { changed:true, item, blueprint:item };
    }
    if (!state.equipment) state.equipment = { inventory:[] };
    if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
    state.equipment.inventory.push(item.equipmentId);
    state._dirty = true;
    return { changed:true, item, equipment:EQUIPMENT_DB[item.equipmentId] };
  },

  toggleShipAssignment(state, instanceId, actionKey, now) {
    const instance = getShipInstanceFromState(state, instanceId);
    if (!instance) return { changed:false, reason:"unknown-ship" };
    if (actionKey === "combat" && state.combat && Number(state.combat.repairUntil) > now) return { changed:false, reason:"repairing" };
    if (!state.shipAssignments) state.shipAssignments = {};
    const removing = state.shipAssignments[actionKey] === instance.instanceId;
    if (removing) delete state.shipAssignments[actionKey]; else state.shipAssignments[actionKey] = instance.instanceId;
    if (actionKey === "combat") state.combat.activeShip = removing ? null : instance.instanceId;
    state._dirty = true;
    return { changed:true, assigned:!removing, instance };
  },

  equipCombatShip(state, instanceId, now) {
    const instance = getShipInstanceFromState(state, instanceId);
    if (!instance) return { changed:false, reason:"unknown-ship" };
    if (state.combat && Number(state.combat.repairUntil) > now) return { changed:false, reason:"repairing" };
    const config = getShipConfigById(instance.shipId);
    if (!config) return { changed:false, reason:"unknown-ship" };
    if (!state.shipAssignments) state.shipAssignments = {};
    state.shipAssignments.combat = instance.instanceId;
    state.combat.activeShip = instance.instanceId;
    const maxHp = getCombatMaxHpFromState(state);
    Object.assign(state.combat, { hp:{ ...maxHp }, maxHp:{ ...maxHp }, weapon:config.recommendedWeapon || "laser", enemies:[], currentEnemy:null, wave:1, totalKills:0, runEliteKills:0, currentFormation:"", active:false });
    state._dirty = true;
    return { changed:true, instance, config };
  },

  enhanceShip(state, instanceId, randomValue) {
    const instance = getShipInstanceFromState(state, instanceId);
    const config = instance ? getShipConfigById(instance.shipId) : null;
    const tier = config ? getShipEnhancementTier(config) : null;
    if (!instance || !config) return { changed:false, reason:"unknown-ship" };
    if (!tier) return { changed:false, reason:"enhancement-unavailable" };

    const combatShip = state.combat && state.combat.active ? getActiveCombatShipState(state).instance : null;
    if (combatShip && combatShip.instanceId === instance.instanceId) return { changed:false, reason:"ship-active" };
    const activeSkill = state.currentAction && state.currentAction.active ? state.currentAction.skill : null;
    if (activeSkill && state.shipAssignments && state.shipAssignments[activeSkill] === instance.instanceId) return { changed:false, reason:"ship-active" };

    const cost = getShipEnhancementCost(config);
    if (!Object.keys(cost).length) return { changed:false, reason:"enhancement-unavailable" };
    if (!Object.entries(cost).every(([id, quantity]) => ResourceRegistry.get(state, "component:" + id) >= quantity)) {
      return { changed:false, reason:"insufficient-components" };
    }
    for (const [id, quantity] of Object.entries(cost)) ResourceRegistry.spend(state, "component:" + id, quantity);

    const fromLevel = normalizeShipEnhancementLevel(instance.enhancementLevel);
    const skillLevel = Number(state.skills.shipEngineering && state.skills.shipEngineering.lvl) || 1;
    const chance = getShipEnhancementSuccessChance(skillLevel, tier.level, fromLevel);
    const roll = Number.isFinite(Number(randomValue)) ? Math.max(0, Math.min(0.999999999, Number(randomValue))) : Math.random();
    const success = roll < chance;
    const toLevel = success ? fromLevel + 1 : 0;
    const xp = success ? getShipEnhancementSuccessXp(config, fromLevel) : getShipEnhancementFailureXp(config);
    instance.enhancementLevel = toLevel;
    addSkillXpToState(state, "shipEngineering", xp, { source:"ship-enhancement" });
    state._dirty = true;

    GameEvents.emit("ship:enhancementAttempted", {
      shipId:instance.shipId,
      instanceId:instance.instanceId,
      role:getShipEnhancementRole(config),
      fromLevel,
      toLevel,
      chance,
      roll,
      success,
      xp,
      componentsSpent:Object.values(cost).reduce((sum, quantity) => sum + quantity, 0)
    }, { offline:false, source:"ship-enhancement" });
    return { changed:true, instance, config, fromLevel, toLevel, chance, roll, success, xp, cost };
  },

  setFittingSlot(state, instanceId, slot, slotIndex, equipmentId) {
    const instance = getShipInstanceFromState(state, instanceId);
    const config = instance ? getShipConfigById(instance.shipId) : null;
    if (!instance || !config || !["high", "mid", "low", "rig"].includes(slot)) return { changed:false, reason:"invalid-slot" };
    const activeCombat = state.combat && state.combat.active && getActiveCombatShipState(state).instance;
    if (activeCombat && activeCombat.instanceId === instance.instanceId) return { changed:false, reason:"combat-active" };
    if (slotIndex < 0 || slotIndex >= (config.slots[slot] || 0)) return { changed:false, reason:"invalid-slot" };
    if (!instance.fitted) instance.fitted = { high:[], mid:[], low:[], rig:[] };
    for (const key of ["high", "mid", "low", "rig"]) if (!Array.isArray(instance.fitted[key])) instance.fitted[key] = [];
    if (!state.equipment) state.equipment = { inventory:[] };
    if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
    const previous = instance.fitted[slot][slotIndex] || null;
    if (equipmentId) {
      const equipment = EQUIPMENT_DB[equipmentId];
      const inventoryIndex = state.equipment.inventory.indexOf(equipmentId);
      if (!equipment || equipment.slot !== slot || inventoryIndex < 0) return { changed:false, reason:"equipment-unavailable" };
      state.equipment.inventory.splice(inventoryIndex, 1);
    }
    if (previous) state.equipment.inventory.push(previous);
    instance.fitted[slot][slotIndex] = equipmentId || null;
    state._dirty = true;
    return { changed:true, previous, equipmentId:equipmentId || null };
  },

  resetFitting(state, instanceId) {
    const instance = getShipInstanceFromState(state, instanceId);
    if (!instance) return { changed:false, reason:"unknown-ship" };
    const activeCombat = state.combat && state.combat.active && getActiveCombatShipState(state).instance;
    if (activeCombat && activeCombat.instanceId === instance.instanceId) return { changed:false, reason:"combat-active" };
    if (!state.equipment) state.equipment = { inventory:[] };
    if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
    const fitting = getFittingFromInstance(instance);
    state.equipment.inventory.push(...Object.values(fitting).flat().filter(Boolean));
    instance.fitted = { high:[], mid:[], low:[], rig:[] };
    state._dirty = true;
    return { changed:true };
  },

  queueAdd(state, item, now, front) {
    const queue = state.queue;
    if (!queue || !Array.isArray(queue.items)) return { changed:false, reason:"missing-queue" };
    if (item.skill === "equipmentEngineering") {
      const recipe = EQUIPMENT_ENGINEERING_RECIPES.find(recipe => recipe.id === item.target || recipe.name === item.target);
      if (recipe && !equipmentRecipeHasRequiredBlueprint(state, recipe)) return { changed:false, reason:"blueprint-locked" };
    }
    if (queue.items.length >= queue.config.maxSize) return { changed:false, reason:"queue-full" };
    const count = item.count === -1 ? -1 : Math.max(1, Number(item.count) || 1);
    const last = !front ? queue.items[queue.items.length - 1] : null;
    if (last && last.skill === item.skill && last.target === item.target) {
      last.count = last.count === -1 || count === -1 ? -1 : (Number(last.count) || 1) + count;
      if (queue.status.isRunning && queue.status.activeIndex === queue.items.length - 1) state.currentAction.batchRemaining = last.count;
      state._dirty = true;
      return { changed:true, merged:true, item:last };
    }
    const queueItem = { id:"q_" + now + "_" + queue.items.length, skill:item.skill, target:item.target, label:item.label || item.target, count };
    if (front) queue.items.unshift(queueItem); else queue.items.push(queueItem);
    if (front && queue.status.isRunning && queue.status.activeIndex >= 0) queue.status.activeIndex++;
    state._dirty = true;
    return { changed:true, item:queueItem };
  },

  queueRemove(state, index, now) {
    const queue = state.queue;
    if (index < 0 || index >= queue.items.length) return { changed:false, reason:"invalid-index" };
    if (queue.status.isRunning && index === queue.status.activeIndex) return ShellStateActions.queueStop(state, now);
    const removed = queue.items.splice(index, 1)[0];
    if (queue.status.activeIndex > index) queue.status.activeIndex--;
    state._dirty = true;
    return { changed:true, removed };
  },

  queueMove(state, from, to) {
    const queue = state.queue, items = queue.items;
    if (from < 0 || from >= items.length || to < 0 || to >= items.length) return { changed:false, reason:"invalid-index" };
    const item = items.splice(from, 1)[0]; items.splice(to, 0, item);
    if (queue.status.activeIndex === from) queue.status.activeIndex = to;
    else if (from < queue.status.activeIndex && to >= queue.status.activeIndex) queue.status.activeIndex--;
    else if (from > queue.status.activeIndex && to <= queue.status.activeIndex) queue.status.activeIndex++;
    state._dirty = true;
    return { changed:true };
  },

  queueStart(state, now) {
    const queue = state.queue;
    if (!queue.items.length) return { changed:false, reason:"empty" };
    queue.status = { ...queue.status, isRunning:true, activeIndex:0, completedCount:0, failCount:0 };
    applyQueueConfigToState(state, getQueueItemConfigForState(queue.items[0]), now);
    state._dirty = true;
    return { changed:true, skill:state.currentAction.skill };
  },

  queueStop(state, now) {
    const queue = state.queue;
    queue.status.isRunning = false; queue.status.activeIndex = -1;
    state.currentAction.progress = 0; state.currentAction.lastProgressUpdate = now; state.currentAction.active = false; state.currentAction.batchRemaining = 0;
    state._dirty = true;
    return { changed:true };
  },

  queueClear(state, now) {
    ShellStateActions.queueStop(state, now);
    state.queue.items = [];
    state.queue.status.completedCount = 0; state.queue.status.failCount = 0;
    state._dirty = true;
    return { changed:true };
  },

  queueSetLoop(state, enabled) {
    state.queue.config.loopMode = Boolean(enabled); state._dirty = true;
    return { changed:true, enabled:Boolean(enabled) };
  }
};

function dispatchGameAction(state, action, now) {
  if (!state || !action || typeof action.type !== "string") return { changed:false, reason:"invalid-action" };
  const actionTime = Number(now) || Date.now();
  if (action.type === "action/stop") return ShellStateActions.stopCurrentAction(state, actionTime);
  if (action.type === "production/ensureMiningArea") return ProductionStateActions.ensureMiningArea(state);
  if (action.type === "production/selectMiningArea") return ProductionStateActions.selectMiningArea(state, action.areaName, actionTime);
  if (action.type === "production/selectMiningMode") return ProductionStateActions.selectMiningMode(state, action.mode);
  if (action.type === "production/selectSmeltingRecipe") return ProductionStateActions.selectSmeltingRecipe(state, action.areaName, actionTime);
  if (action.type === "production/selectGasArea") return ProductionStateActions.selectGasArea(state, action.areaName, actionTime);
  if (action.type === "manufacturing/buyBlueprint") return ManufacturingStateActions.buyBlueprint(state, action.blueprintId);
  if (action.type === "manufacturing/selectShipComponent") return ManufacturingStateActions.selectShipComponent(state, action.componentId);
  if (action.type === "manufacturing/selectShipAssembly") return ManufacturingStateActions.selectShipAssembly(state, action.recipeId);
  if (action.type === "manufacturing/startShipComponent") return ManufacturingStateActions.startShipComponent(state, actionTime);
  if (action.type === "manufacturing/startShipAssembly") return ManufacturingStateActions.startShipAssembly(state, actionTime);
  if (action.type === "manufacturing/selectEquipmentCategory") return ManufacturingStateActions.selectEquipmentCategory(state, action.categoryId);
  if (action.type === "manufacturing/selectEquipmentRecipe") return ManufacturingStateActions.selectEquipmentRecipe(state, action.recipeId);
  if (action.type === "manufacturing/stop") return ManufacturingStateActions.stop(state, actionTime);
  if (action.type === "combat/selectMode") return CombatStateActions.selectMode(state, action.mode);
  if (action.type === "combat/selectZone") return CombatStateActions.selectZone(state, action.zoneId);
  if (action.type === "combat/selectDeathspace") return CombatStateActions.selectDeathspace(state, action.deathspaceId);
  if (action.type === "combat/selectDeathspaceTier") return CombatStateActions.selectDeathspaceTier(state, action.tier);
  if (action.type === "combat/start") return CombatStateActions.start(state, action.enemies, action.formationId, actionTime);
  if (action.type === "combat/enterDeathspace") return CombatStateActions.enterDeathspace(state, action.deathspaceId, action.enemies, action.formationId, actionTime);
  if (action.type === "combat/stop") return CombatStateActions.stop(state);
  if (action.type === "combat/beginRecovery") return CombatStateActions.beginRecovery(state, actionTime);
  if (action.type === "combat/finishRecovery") return CombatStateActions.finishRecovery(state, actionTime);
  if (action.type === "planetary/deploy") return PlanetaryStateActions.deploy(state, action.planetType, actionTime);
  if (action.type === "planetary/collect") return PlanetaryStateActions.collect(state, action.id, action.cargoCapacity);
  if (action.type === "planetary/redeploy") return PlanetaryStateActions.redeploy(state, action.id, actionTime);
  if (action.type === "planetary/remove") return PlanetaryStateActions.remove(state, action.id);
  if (action.type === "shell/buyLPItem") return ShellStateActions.buyLPItem(state, action.equipmentId);
  if (action.type === "hangar/toggleAssignment") return ShellStateActions.toggleShipAssignment(state, action.instanceId, action.actionKey, actionTime);
  if (action.type === "hangar/equipCombatShip") return ShellStateActions.equipCombatShip(state, action.instanceId, actionTime);
  if (action.type === "hangar/enhanceShip") return ShellStateActions.enhanceShip(state, action.instanceId, action.randomValue);
  if (action.type === "hangar/setFittingSlot") return ShellStateActions.setFittingSlot(state, action.instanceId, action.slot, action.slotIndex, action.equipmentId);
  if (action.type === "hangar/resetFitting") return ShellStateActions.resetFitting(state, action.instanceId);
  if (action.type === "hangar/clearIndustrialShip") return ShellStateActions.clearIndustrialShip(state);
  if (action.type === "settings/setShipEnhancementConfirmation") return ShellStateActions.setShipEnhancementConfirmation(state, action.enabled);
  if (action.type === "settings/toggleCombatSkills") return ShellStateActions.toggleCombatSkills(state);
  if (action.type === "queue/add") return ShellStateActions.queueAdd(state, action.item, actionTime, action.front);
  if (action.type === "queue/remove") return ShellStateActions.queueRemove(state, action.index, actionTime);
  if (action.type === "queue/move") return ShellStateActions.queueMove(state, action.from, action.to);
  if (action.type === "queue/start") return ShellStateActions.queueStart(state, actionTime);
  if (action.type === "queue/stop") return ShellStateActions.queueStop(state, actionTime);
  if (action.type === "queue/clear") return ShellStateActions.queueClear(state, actionTime);
  if (action.type === "queue/setLoop") return ShellStateActions.queueSetLoop(state, action.enabled);
  return { changed:false, reason:"unknown-action" };
}
