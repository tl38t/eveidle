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
    const prevArea = action.area;
    action.area = area.name;
    action.miningMode = area.mode;
    if (area.mode === "moon") action.moonMiningArea = area.name;
    else action.normalMiningArea = area.name;
    if (!action.active || action.skill !== "mining") {
      action.progress = 0;
      action.lastProgressUpdate = now;
    }
    // 切换矿带时清空资源调度中心已累计的采矿次数（仅当矿带真正改变）
    if (area.name !== prevArea && typeof resetStationDispatchCounters === "function") resetStationDispatchCounters(state, "mining");
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
    const prevArea = action.gasArea;
    action.gasArea = area.name;
    if (!action.active || action.skill !== "gasHarvesting") {
      action.progress = 0;
      action.lastProgressUpdate = now;
    }
    // 切换气体带时清空资源调度中心已累计的采气次数（仅当气体带真正改变）
    if (area.name !== prevArea && typeof resetStationDispatchCounters === "function") resetStationDispatchCounters(state, "gas");
    state._dirty = true;
    return { changed:true, area };
  }
};

const ManufacturingStateActions = {
  buyBlueprint(state, blueprintId, now) {
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
    if (typeof GameEvents !== "undefined") {
      const ts = (typeof now === "number" && Number.isFinite(now) && now >= 0) ? now : Date.now();
      GameEvents.emit("blueprint:acquired", { ownershipKey: blueprint.shipId, blueprintKind: "ship", productId: blueprint.shipId }, { timestamp: ts, source: "blueprint-store", offline: false });
    }
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
    // 船坞等级门槛
    if (typeof canManufactureAtShipyard === "function" && !canManufactureAtShipyard(state, recipe.id)) return { changed:false, reason:"shipyard-level-locked" };
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
    // 船坞等级门槛
    if (typeof canAssembleAtShipyard === "function" && !canAssembleAtShipyard(state, recipe.id)) return { changed:false, reason:"shipyard-level-locked" };
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
    if (category.id === "rigs") {
      // 改装件类别：目标需落在当前二级筛选（类别+档位）可见集合内
      ManufacturingStateActions.selectEquipEngRigFilter(state, {});
      return { changed:true, category };
    }
    const recipes = EQUIPMENT_ENGINEERING_RECIPES.filter(recipe => recipe.category === category.id);
    const current = getEquipmentEngineeringRecipe(state.currentAction.equipEngTarget || "t1_mining_laser");
    if (!recipes.some(recipe => recipe.id === current.id)) {
      const next = recipes.find(recipe => (state.skills.equipmentEngineering.lvl || 1) >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe)) || recipes[0];
      if (next) state.currentAction.equipEngTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, category };
  },

  // 改装件二级筛选（类别：combat/industry/archaeology；档位：all/I~V）。
  // 只改筛选状态与 equipEngTarget（详情落到第一个可见配方），
  // 绝不触碰 startedEquipEngTarget —— 制造中切换筛选不改变实际产物。
  selectEquipEngRigFilter(state, payload) {
    const action = state.currentAction;
    const sub = payload.sub !== undefined ? payload.sub : (action.equipEngRigSub || "combat");
    const tier = payload.tier !== undefined ? payload.tier : (action.equipEngRigTier || "all");
    if (!RIG_ENGINEERING_SUBCATEGORIES.some(item => item.id === sub)) return { changed:false, reason:"unknown-rig-subcategory" };
    if (tier !== "all" && !RIG_ENGINEERING_TIERS.includes(tier)) return { changed:false, reason:"unknown-rig-tier" };
    action.equipEngRigSub = sub;
    action.equipEngRigTier = tier;
    const filtered = EQUIPMENT_ENGINEERING_RECIPES.filter(recipe =>
      recipe.category === "rigs" && recipe.rigCategory === sub && (tier === "all" || recipe.rigTier === tier));
    const current = getEquipmentEngineeringRecipe(action.equipEngTarget || "t1_mining_laser");
    if (!filtered.some(recipe => recipe.id === current.id)) {
      const next = filtered.find(recipe => (state.skills.equipmentEngineering.lvl || 1) >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe)) || filtered[0];
      if (next) action.equipEngTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, sub, tier };
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

// 增强剂制造 Action 层 — Phase 2A（§5）。
// selectCategory / selectQualityFilter / selectRecipe 只改用户选择状态，绝不触碰
// startedBoosterRecipeTarget —— 制造中切换筛选或配方不改变正在制造的产物。
const BoosterStateActions = {
  selectCategory(state, categoryId) {
    if (!BOOSTER_CATEGORY_META.some(meta => meta.id === categoryId)) return { changed:false, reason:"unknown-category" };
    const action = state.currentAction;
    action.boosterCategory = categoryId;
    // 目标若不在当前类别（+品质筛选）可见集合内，落到第一个可见配方（优先已解锁）。
    const filtered = getBoosterCategoryRecipes(categoryId, action.boosterQualityFilter || "all");
    const current = getBoosterRecipe(action.boosterRecipeTarget);
    if (!current || !filtered.some(recipe => recipe.id === current.id)) {
      const next = filtered.find(recipe => isBoosterRecipeUnlocked(recipe)) || filtered[0];
      if (next) action.boosterRecipeTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, categoryId };
  },

  selectQualityFilter(state, quality) {
    if (!["all", "n", "r", "l"].includes(quality)) return { changed:false, reason:"unknown-quality" };
    const action = state.currentAction;
    action.boosterQualityFilter = quality;
    const filtered = getBoosterCategoryRecipes(action.boosterCategory || "mining", quality);
    const current = getBoosterRecipe(action.boosterRecipeTarget);
    if (!current || !filtered.some(recipe => recipe.id === current.id)) {
      const next = filtered.find(recipe => isBoosterRecipeUnlocked(recipe)) || filtered[0];
      if (next) action.boosterRecipeTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, quality };
  },

  selectRecipe(state, recipeId) {
    const recipe = getBoosterRecipe(recipeId);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    const action = state.currentAction;
    action.boosterRecipeTarget = recipe.id;
    const series = BOOSTER_SERIES[recipe.series];
    if (series) action.boosterCategory = series.category;
    state._dirty = true;
    return { changed:true, recipe };
  },

  startManufacturing(state, now, recipeId) {
    const recipe = recipeId ? getBoosterRecipe(recipeId) : (getBoosterRecipe(state.currentAction.boosterRecipeTarget) || BOOSTER_RECIPES[0]);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    if (!isBoosterRecipeUnlocked(recipe)) return { changed:false, reason:"level-locked" };
    if (!hasEnoughBoosterInputs(recipe, 1)) return { changed:false, reason:"insufficient-materials" };
    Object.assign(state.currentAction, {
      skill:"boosterEngineering",
      active:true,
      startedBoosterRecipeTarget:recipe.id,
      boosterRecipeTarget:recipe.id,
      progress:0,
      lastProgressUpdate:now,
      batchRemaining:0
    });
    state._dirty = true;
    return { changed:true, recipe };
  },

  stopManufacturing(state, now) {
    const action = state.currentAction;
    if (!action.active || action.skill !== "boosterEngineering") return { changed:false, reason:"not-manufacturing" };
    // 清除运行锁定，但保留用户选择（boosterRecipeTarget/category/quality）。
    action.startedBoosterRecipeTarget = "";
    action.progress = 0;
    action.lastProgressUpdate = now;
    action.active = false;
    action.batchRemaining = 0;
    state._dirty = true;
    return { changed:true };
  },

  // --- 增强剂 Phase 2B：六槽生命周期 ---

  equip(state, slot, itemId) {
    if (!Array.isArray(BOOSTER_SLOTS) || !BOOSTER_SLOTS.includes(slot)) return { changed:false, reason:"invalid-slot" };
    const item = (typeof getBoosterItem === "function") ? getBoosterItem(itemId) : null;
    if (!item) return { changed:false, reason:"unknown-item" };
    if (item.slot !== slot) return { changed:false, reason:"slot-mismatch" };
    const active = state.boosters && state.boosters.active;
    if (!active) return { changed:false, reason:"no-state" };
    const existing = active[slot];
    // 同一 itemId 已经在槽 → 已装备
    if (existing && existing.itemId === item.itemId) return { changed:false, reason:"already-equipped" };
    // 槽已被不同 item 占用 → 需用 replace
    if (existing) return { changed:false, reason:"slot-occupied" };
    // 库存校验
    const inv = ResourceRegistry.get(state, item.itemId);
    if (!(inv >= 1)) return { changed:false, reason:"insufficient-inventory" };
    // 同系列冲突
    for (const s of BOOSTER_SLOTS) {
      const e = active[s];
      if (!e || s === slot) continue;
      const existingItem = (typeof getBoosterItem === "function") ? getBoosterItem(e.itemId) : null;
      if (existingItem && existingItem.series === item.series) return { changed:false, reason:"series-conflict" };
    }
    // 原子提交
    ResourceRegistry.spend(state, item.itemId, 1);
    active[slot] = { itemId: item.itemId, remainingMs: BOOSTER_DURATION_MS };
    state._dirty = true;
    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("booster:equipped", { slot, itemId:item.itemId }, { source:"booster-equip" });
      GameEvents.emit("booster:activated", { slot, itemId:item.itemId, remainingMs:BOOSTER_DURATION_MS }, { source:"booster-equip" });
    }
    return { changed:true, slot, itemId:item.itemId };
  },

  unequip(state, slot) {
    if (!Array.isArray(BOOSTER_SLOTS) || !BOOSTER_SLOTS.includes(slot)) return { changed:false, reason:"invalid-slot" };
    const active = state.boosters && state.boosters.active;
    if (!active) return { changed:false, reason:"no-state" };
    const entry = active[slot];
    if (!entry) return { changed:false, reason:"empty-slot" };
    const itemId = entry.itemId;
    // 作废剩余时间、不返还瓶子
    active[slot] = null;
    state._dirty = true;
    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("booster:unequipped", { slot, itemId }, { source:"booster-unequip" });
    }
    return { changed:true, slot, itemId };
  },

  replace(state, slot, itemId) {
    if (!Array.isArray(BOOSTER_SLOTS) || !BOOSTER_SLOTS.includes(slot)) return { changed:false, reason:"invalid-slot" };
    const item = (typeof getBoosterItem === "function") ? getBoosterItem(itemId) : null;
    if (!item) return { changed:false, reason:"unknown-item" };
    if (item.slot !== slot) return { changed:false, reason:"slot-mismatch" };
    const active = state.boosters && state.boosters.active;
    if (!active) return { changed:false, reason:"no-state" };
    const existing = active[slot];
    if (!existing) return { changed:false, reason:"empty-slot" }; // 空槽用 equip
    if (existing.itemId === item.itemId) return { changed:false, reason:"already-equipped" };
    // 先校验新库存（原子拒绝），原槽完全不変
    const inv = ResourceRegistry.get(state, item.itemId);
    if (!(inv >= 1)) return { changed:false, reason:"insufficient-inventory" };
    // 同系列冲突
    for (const s of BOOSTER_SLOTS) {
      const e = active[s];
      if (!e || s === slot) continue;
      const existingItem = (typeof getBoosterItem === "function") ? getBoosterItem(e.itemId) : null;
      if (existingItem && existingItem.series === item.series) return { changed:false, reason:"series-conflict" };
    }
    const oldItemId = existing.itemId;
    // 原子提交
    ResourceRegistry.spend(state, item.itemId, 1);
    active[slot] = { itemId: item.itemId, remainingMs: BOOSTER_DURATION_MS };
    state._dirty = true;
    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("booster:unequipped", { slot, itemId:oldItemId }, { source:"booster-replace" });
      GameEvents.emit("booster:replaced", { slot, oldItemId, newItemId:item.itemId }, { source:"booster-replace" });
      GameEvents.emit("booster:equipped", { slot, itemId:item.itemId }, { source:"booster-replace" });
      GameEvents.emit("booster:activated", { slot, itemId:item.itemId, remainingMs:BOOSTER_DURATION_MS }, { source:"booster-replace" });
    }
    return { changed:true, slot, oldItemId, newItemId:item.itemId };
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
    state.combat.runWeaponTypes = [];
    state.combat.runWeaponTypesZone = state.combat.zone || null;
    state.combat.currentFormation = "";
    state.combat.lastLoot = "";
    state.combat.lastSpecialLoot = "";
    state.combat.lastStatus = "";
    state.combat.lastEnemyVolley = null;
    state.combat.runDamageDealt = 0;
    state.combat.runDamageTaken = 0;
    state._dirty = true;
    return { changed:true, mode };
  },

  selectTargetingMode(state, mode) {
    const activeShip = getActiveCombatShipState(state);
    if (!isCapitalCombatShip(activeShip.config)) return { changed:false, reason:"capital-only" };
    if (state.combat.active) return { changed:false, reason:"combat-active" };
    const normalized = normalizeCapitalTargetingMode(mode);
    if (state.combat.targetingMode === normalized) return { changed:false, reason:"unchanged" };
    state.combat.targetingMode = normalized;
    state._dirty = true;
    return { changed:true, mode:normalized };
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
      lastEnemyVolley:null,
      runWeaponTypes:[],
      runWeaponTypesZone:zone.id,
      runDamageDealt:0, runDamageTaken:0
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
      currentFormation:"", lastLoot:"", lastSpecialLoot:"", lastStatus:"", lastEnemyVolley:null,
      runWeaponTypes:[], runWeaponTypesZone:site.sourceZoneId, runDamageDealt:0, runDamageTaken:0
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
      currentFormation:"", lastLoot:"", lastSpecialLoot:"", lastStatus:"", lastEnemyVolley:null,
      runWeaponTypes:[], runWeaponTypesZone:site.sourceZoneId, runDamageDealt:0, runDamageTaken:0
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
      state.combat.runWeaponTypes = [];
      state.combat.runWeaponTypesZone = state.combat.zone || null;
      state.combat.runDamageDealt = 0;
      state.combat.runDamageTaken = 0;
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
    state.resumeAfterRepair = null; // 手动/自动重新出击：清除待恢复标记
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
      lastLoot:"", lastSpecialLoot:"", lastStatus:"通行密钥已消耗", lastEnemyVolley:null,
      runWeaponTypes:[], runWeaponTypesZone:site.sourceZoneId, runDamageDealt:0, runDamageTaken:0
    });
    state.currentAction.skill = "combat";
    state.currentAction.active = true;
    state._dirty = true;
    window.GameEvents.emit("combat:deathspaceEntered", {
      deathspaceId:site.id, zoneId:site.sourceZoneId, faction:site.faction, tier:site.dedTier
    }, { timestamp:now, source:"combat", offline:false });
    return { changed:true, site };
  },

  stop(state) {
    // 玩家主动停止：即便当前处于维修中（combat 非活跃、无战斗行动），只要存在待恢复标记，
    // 也允许停止以取消"维修完成后自动出击"。这是策划要求（重创后可主动放弃自动返回）。
    const hasPendingResume = Boolean(state.resumeAfterRepair && state.resumeAfterRepair.type === "combat");
    if (!state.combat.active && !(state.currentAction.active && state.currentAction.skill === "combat") && !hasPendingResume) return { changed:false, reason:"not-active" };
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
      lastEnemyVolley:null,
      runWeaponTypes:[],
      runWeaponTypesZone:null,
      runDamageDealt:0, runDamageTaken:0
    });
    state.resumeAfterRepair = null; // 玩家主动停止：取消待恢复（含维修中取消自动出击）
    state._dirty = true;
    return { changed:true, abandonedDeathspace, cancelledResume:hasPendingResume };
  },

  beginRecovery(state, now) {
    const activeShip = getActiveCombatShipState(state);
    const failedDeathspace = state.combat.mode === "deathspace";
    const destroyedShipId = activeShip.instance ? activeShip.instance.instanceId : null;
    const failedDeathspaceId = failedDeathspace ? (state.combat.deathspaceId || null) : null;
    // 维修后自动恢复（Phase 3D 修正）：重创即本轮失败并清零遭遇；无论普通星带还是死亡空间，
    // 维修完成后都只返回普通星带、从第 1 波开始全新一轮，死亡空间永不续跑、密钥不返还。
    // returnZoneId = 维修后自动进入的普通星带。死亡空间取来源 sourceZoneId（enterDeathspace 时
    // combat.zone 已存 sourceZoneId，此处优先查库以确保权威）；defeatedMode/deathspaceId 仅供日志/UI/事件。
    let returnZoneId = state.combat.zone || null;
    if (failedDeathspace) {
      const site = DEATHSPACE_DATABASE.find(item => item.id === failedDeathspaceId);
      if (site) returnZoneId = site.sourceZoneId;
    }
    state.currentAction.active = false;
    state.resumeAfterRepair = {
      type:"combat",
      returnZoneId,
      defeatedMode:failedDeathspace ? "deathspace" : "belt",
      deathspaceId:failedDeathspaceId,
      shipInstanceId:destroyedShipId
    };
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
      destroyedShip:destroyedShipId,
      lastStatus:failedDeathspace
        ? "攻略失败，密钥不返还；维修完成后返回来源星带。"
        : "本轮肃清失败，维修完成后返回该星带。"
    });
    state._dirty = true;
    return { changed:true, repairUntil:state.combat.repairUntil, failedDeathspace, returnZoneId };
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
  // 首次布置：扣完整 constructionCost（ISK + 三钛），立即运行中；无等级/升级。
  deploy(state, planetType, now) {
    const config = PLANET_TYPES.find(planet => planet.id === planetType);
    if (!config) return { changed:false, reason:"unknown-planet" };
    const capacity = getPlanetaryCapacityState(state);
    if (capacity.level < config.level) return { changed:false, reason:"level-locked", level:config.level };
    if (capacity.usedSlots >= capacity.slots) return { changed:false, reason:"no-slots" };
    const constructionISK = Number(config.constructionCost && config.constructionCost.isk) || 0;
    const constructionResources = (config.constructionCost && config.constructionCost.resources) || {};
    if (ResourceRegistry.get(state, "currency:isk") < constructionISK) return { changed:false, reason:"insufficient-isk" };
    for (const [resourceId, amount] of Object.entries(constructionResources)) {
      if (ResourceRegistry.get(state, resourceId) < amount) return { changed:false, reason:"insufficient-tritanium", resourceId };
    }
    // 原子扣费：ISK + 全部建设材料
    ResourceRegistry.spend(state, "currency:isk", constructionISK);
    for (const [resourceId, amount] of Object.entries(constructionResources)) ResourceRegistry.spend(state, resourceId, amount);
    if (!state.planetary) state.planetary = { deployments:[], nextId:1 };
    if (!Array.isArray(state.planetary.deployments)) state.planetary.deployments = [];
    const nextId = Number(state.planetary.nextId) || 1;
    const duration = Number(config.maintenanceDuration) || 86400;
    const deployment = { id:"planet_" + nextId, planetType:config.id, deployedAt:now, duration, storage:0, lastTick:now, progress:0, active:true };
    state.planetary.nextId = nextId + 1;
    state.planetary.deployments.push(deployment);
    state._dirty = true;
    if (typeof GameEvents !== "undefined") GameEvents.emit("planetary:deployed", {
      deploymentId:deployment.id, planetType:config.id, constructionISK, constructionResources:{ ...constructionResources }
    });
    return { changed:true, deployment, config };
  },

  collect(state, id) {
    const deployment = state.planetary && state.planetary.deployments.find(item => item.id === id);
    if (!deployment) return { changed:false, reason:"unknown-deployment" };
    const quantity = Number(deployment.storage) || 0;
    if (quantity <= 0) return { changed:false, reason:"empty" };
    const config = PLANET_TYPES.find(planet => planet.id === deployment.planetType);
    const output = config ? config.output : "未知产物";
    const resourceId = "planetary:" + output;
    ResourceRegistry.add(state, resourceId, quantity);
    deployment.storage = 0;
    state._dirty = true;
    if (typeof GameEvents !== "undefined") GameEvents.emit("planetary:collected", {
      deploymentId:deployment.id, planetType:deployment.planetType, quantity, resourceId
    });
    return { changed:true, quantity, output };
  },

  // 续期：仅当已到期（active=false 或时间超期）且 ISK 足够；只扣 maintenanceCostISK，保留 storage；运行中重复续期返回 already-active。
  renew(state, id, now, meta) {
    const deployment = state.planetary && state.planetary.deployments.find(item => item.id === id);
    if (!deployment) return { changed:false, reason:"unknown-deployment" };
    const config = PLANET_TYPES.find(planet => planet.id === deployment.planetType);
    if (!config) return { changed:false, reason:"unknown-planet" };
    const deployedAt = Number(deployment.deployedAt) || 0;
    const duration = Number(deployment.duration) || 86400;
    const timeExpired = (now - deployedAt) / 1000 >= duration;
    const running = Boolean(deployment.active) && !timeExpired;
    if (running) return { changed:false, reason:"already-active" };
    // 研究批次 G · planCost（reduceFraction）：实扣与 getPlanetDeploymentDisplayState 完全同式
    // （基础费 × (1 - planCost 减免) 后 ceil），保证"显示价 = 余额判断价 = 实扣价 = 事件价"。
    const maintenanceISK = (typeof getPlanetRenewCostISK === "function")
      ? getPlanetRenewCostISK(state, config)
      : (Number(config.maintenanceCostISK) || 0);
    if (ResourceRegistry.get(state, "currency:isk") < maintenanceISK) return { changed:false, reason:"insufficient-isk" };
    ResourceRegistry.spend(state, "currency:isk", maintenanceISK);
    const newDuration = Number(config.maintenanceDuration) || 86400;
    Object.assign(deployment, { deployedAt:now, lastTick:now, progress:0, duration:newDuration, active:true });
    state._dirty = true;
    const expiresAt = now + newDuration * 1000;
    // 可选 meta 第 4 参：planauto 离线/在线自动续期透传 offline 与 source（与 completed/expired 一致）；
    // 手动续期（UI）不传则默认 offline:false，行为与历史一致，不影响 Batch G 等既有断言。
    const metaArg = (meta && typeof meta === "object") ? meta : { offline:false };
    if (typeof GameEvents !== "undefined") GameEvents.emit("planetary:renewed", {
      deploymentId:deployment.id, planetType:deployment.planetType, maintenanceISK, expiresAt
    }, metaArg);
    return { changed:true, deployment, config };
  },

  // 主动拆除：storage 必须为 0（原子拒绝），删除 deployment 且不返还任何资源。
  demolish(state, id) {
    const deployments = state.planetary && state.planetary.deployments;
    const index = Array.isArray(deployments) ? deployments.findIndex(item => item.id === id) : -1;
    if (index < 0) return { changed:false, reason:"unknown-deployment" };
    if ((Number(deployments[index].storage) || 0) !== 0) return { changed:false, reason:"storage-not-empty" };
    const removed = deployments.splice(index, 1)[0];
    state._dirty = true;
    if (typeof GameEvents !== "undefined") GameEvents.emit("planetary:demolished", {
      deploymentId:removed.id, planetType:removed.planetType, refundedISK:0, refundedResources:{}
    });
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
  } else if (skill === "archaeology") {
    config.archaeologyTarget = item.target;
  } else if (skill === "boosterEngineering") {
    config.boosterTarget = item.target;
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
  if (config.archaeologyTarget) {
    action.archaeologyTarget = config.archaeologyTarget;
    action.startedArchaeologyTarget = config.archaeologyTarget;
    state.archaeology.startedSiteId = config.archaeologyTarget;
    state.archaeology.activeSiteId = config.archaeologyTarget;
    state.archaeology.startedProbeId = state.archaeology.activeProbeId;
  }
  if (config.boosterTarget) {
    action.boosterTarget = config.boosterTarget;
    action.startedBoosterRecipeTarget = config.boosterTarget;
    action.boosterRecipeTarget = config.boosterTarget;
  }
}

// ---- 共享校验函数：考古启动校验（三个入口共用） ----
// 只做校验和原因返回，不修改 state。
function canStartArchaeology(state, now) {
  const arch = state.archaeology;
  const site = getArchaeologySite(arch.activeSiteId);
  if (!site) return { ok:false, reason:"no-site" };
  if ((state.skills.archaeology.lvl || 1) < site.level) return { ok:false, reason:"level-locked" };
  if (arch.repairUntil > now) return { ok:false, reason:"repairing" };
  if (arch.interferenceUntil > now) return { ok:false, reason:"interference" };
  const instanceId = state.shipAssignments && state.shipAssignments.archaeology;
  const instance = instanceId ? getShipInstanceFromState(state, instanceId) : null;
  const config = instance ? getShipConfigById(instance.shipId) : null;
  if (!config || !ARCHAEOLOGY_SHIP_TYPES.includes(config.type)) return { ok:false, reason:"no-archaeology-ship" };
  const probeId = arch.activeProbeId;
  if (ResourceRegistry.get(state, "probe:" + probeId) < 1) return { ok:false, reason:"insufficient-probe" };
  const fuelState = getArchaeologyFuelCostState(state, site, instance);
  if (ResourceRegistry.get(state, "consumable:fuel") < fuelState.chargedFuel) return { ok:false, reason:"insufficient-fuel" };
  return { ok:true, site, instance, probeId, fuelState };
}

// ---- 统一队列项目启动函数：所有后续项目必须经此入口 ----
function executeQueueItemForState(state, item, now) {
  const skill = item.skill;
  const queue = state.queue;
  if (!queue || !item) return { changed:false, reason:"no-item" };

  // 先保存当前 user 选择（archeology activeSiteId/probeId, booster recipeTarget）以免被覆盖
  if (skill === "archaeology") {
    // 设置目标遗迹供 canStartArchaeology / ArchaeologyStateActions.start 读取
    if (item.target) {
      const siteObj = getArchaeologySite(item.target);
      if (siteObj) state.archaeology.activeSiteId = item.target;
      // activeProbeId 需提前设好，让共享校验读到正确的探针
      if (!state.archaeology.activeProbeId) state.archaeology.activeProbeId = "core_probe_i";
    }
    const result = ArchaeologyStateActions.start(state, now);
    if (!result.changed) {
      // 校验失败：failCount++、跳过此项、不污染 currentAction
      queue.status.failCount = (Number(queue.status.failCount) || 0) + 1;
      queue.items.splice(queue.status.activeIndex, 1);
      if (queue.items.length) {
        queue.status.activeIndex = Math.min(queue.status.activeIndex, queue.items.length - 1);
        // 下一项仍走统一入口
        return executeQueueItemForState(state, queue.items[queue.status.activeIndex], now);
      }
      queue.status.isRunning = false; queue.status.activeIndex = -1; queue.status.completedCount = 0;
      state.currentAction.active = false; state.currentAction.batchRemaining = 0;
      state._dirty = true;
      return { changed:false, reason:result.reason };
    }
    state._dirty = true;
    return { changed:true, skill:"archaeology" };
  }

  if (skill === "boosterEngineering") {
    const recipeId = item.target;
    const result = BoosterStateActions.startManufacturing(state, now, recipeId);
    if (!result.changed) {
      queue.status.failCount = (Number(queue.status.failCount) || 0) + 1;
      queue.items.splice(queue.status.activeIndex, 1);
      if (queue.items.length) {
        queue.status.activeIndex = Math.min(queue.status.activeIndex, queue.items.length - 1);
        return executeQueueItemForState(state, queue.items[queue.status.activeIndex], now);
      }
      queue.status.isRunning = false; queue.status.activeIndex = -1; queue.status.completedCount = 0;
      state.currentAction.active = false; state.currentAction.batchRemaining = 0;
      state._dirty = true;
      return { changed:false, reason:result.reason };
    }
    state._dirty = true;
    return { changed:true, skill:"boosterEngineering" };
  }

  // 常规技能
  applyQueueConfigToState(state, getQueueItemConfigForState(item), now);
  state._dirty = true;
  return { changed:true, skill:state.currentAction.skill };
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

  buyLPItem(state, itemId, now) {
    const item = getLPStoreCatalogItem(itemId);
    if (!item) return { changed:false, reason:"unknown-item" };
    if (item.kind === "equipmentBlueprint" && hasEquipmentBlueprintFromState(state, item.equipmentId)) return { changed:false, reason:"already-owned" };
    if (ResourceRegistry.get(state, "currency:lp") < item.lpPrice) return { changed:false, reason:"insufficient-lp" };
    ResourceRegistry.spend(state, "currency:lp", item.lpPrice);
    if (item.kind === "equipmentBlueprint") {
      if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
      const ownershipKey = getEquipmentBlueprintOwnershipKey(item.equipmentId);
      state.ownedBlueprints.push(ownershipKey);
      state._dirty = true;
      if (typeof GameEvents !== "undefined") {
        const ts = (typeof now === "number" && Number.isFinite(now) && now >= 0) ? now : Date.now();
        GameEvents.emit("blueprint:acquired", { ownershipKey, blueprintKind: "equipment", productId: item.equipmentId }, { timestamp: ts, source: "blueprint-store", offline: false });
      }
      return { changed:true, item, blueprint:item };
    }
    if (!state.equipment) state.equipment = { inventory:[] };
    if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
    state.equipment.inventory.push(item.equipmentId);
    state._dirty = true;
    // Batch C-13：普通装备购入使未安装装备数 +1，计入 ResourceRegistry.getInventoryTotal，
    // 故在真实入库成功后 emit 一次 inventory:changed（蓝图分支不发，它只发 blueprint:acquired）。
    if (typeof GameEvents !== "undefined") {
      const ts = (typeof now === "number" && Number.isFinite(now) && now >= 0) ? now : Date.now();
      GameEvents.emit("inventory:changed", { kind: "equipment", itemId: item.equipmentId, delta: 1 }, { timestamp: ts, source: "lp-store", offline: false });
    }
    return { changed:true, item, equipment:EQUIPMENT_DB[item.equipmentId] };
  },

  toggleShipAssignment(state, instanceId, actionKey, now) {
    const instance = getShipInstanceFromState(state, instanceId);
    if (!instance) return { changed:false, reason:"unknown-ship" };
    const config = getShipConfigById(instance.shipId);
    if (!config) return { changed:false, reason:"unknown-ship" };
    const restriction = getShipAssignmentRestriction(config, actionKey, actionKey === "combat" && state.combat && Number(state.combat.repairUntil) > now);
    if (restriction) return { changed:false, reason:restriction.reason };
    if (!state.shipAssignments) state.shipAssignments = {};
    const removing = state.shipAssignments[actionKey] === instance.instanceId;
    const activeSkill = state.currentAction && state.currentAction.active ? state.currentAction.skill : null;
    if (activeSkill && state.shipAssignments[activeSkill] === instance.instanceId) return { changed:false, reason:"ship-active" };
    if (!removing) {
      for (const [assignedAction, assignedId] of Object.entries(state.shipAssignments)) {
        if (assignedId !== instance.instanceId || assignedAction === actionKey) continue;
        delete state.shipAssignments[assignedAction];
        if (assignedAction === "combat" && state.combat) state.combat.activeShip = null;
      }
      state.shipAssignments[actionKey] = instance.instanceId;
    } else {
      delete state.shipAssignments[actionKey];
    }
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
    const activeSkill = state.currentAction && state.currentAction.active ? state.currentAction.skill : null;
    if (activeSkill && state.shipAssignments[activeSkill] === instance.instanceId && activeSkill !== "combat") return { changed:false, reason:"ship-active" };
    for (const [assignedAction, assignedId] of Object.entries(state.shipAssignments)) {
      if (assignedId === instance.instanceId && assignedAction !== "combat") delete state.shipAssignments[assignedAction];
    }
    state.shipAssignments.combat = instance.instanceId;
    state.combat.activeShip = instance.instanceId;
    const maxHp = getCombatMaxHpFromState(state);
    Object.assign(state.combat, { hp:{ ...maxHp }, maxHp:{ ...maxHp }, weapon:config.recommendedWeapon || "laser", enemies:[], currentEnemy:null, wave:1, totalKills:0, runEliteKills:0, currentFormation:"", runWeaponTypes:[], runWeaponTypesZone:state.combat.zone||null, runDamageDealt:0, runDamageTaken:0, active:false });
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
    const toLevel = success ? fromLevel + 1 : fromLevel; // 2026-07-24：失败不掉级（与装备强化一致）
    const xp = success ? getShipEnhancementSuccessXp(config, fromLevel) : 0; // 2026-07-24：失败 0 XP
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

  setFittingSlot(state, instanceId, slot, slotIndex, equipmentRef) {
    const instance = getShipInstanceFromState(state, instanceId);
    const config = instance ? getShipConfigById(instance.shipId) : null;
    if (!instance || !config || !["high", "mid", "low", "rig"].includes(slot)) return { changed:false, reason:"invalid-slot" };
    const activeCombat = state.combat && state.combat.active && getActiveCombatShipState(state).instance;
    if (activeCombat && activeCombat.instanceId === instance.instanceId) return { changed:false, reason:"combat-active" };
    if (slotIndex < 0 || slotIndex >= (config.slots[slot] || 0)) return { changed:false, reason:"invalid-slot" };
    if (!instance.fitted) instance.fitted = { high:[], mid:[], low:[], rig:[] };
    for (const key of ["high", "mid", "low", "rig"]) if (!Array.isArray(instance.fitted[key])) instance.fitted[key] = [];
    if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
    if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
    if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];
    const previous = instance.fitted[slot][slotIndex] || null;
    if (equipmentRef) {
      const resolved = resolveEquipmentReference(state, equipmentRef);
      const equipment = resolved && resolved.definition;
      if (!equipment || equipment.slot !== slot) return { changed:false, reason:"equipment-unavailable" };
      if (!canFitEquipmentOnShip(equipment, config)) return { changed:false, reason:"incompatible-equipment" };
      // 改装件 stackGroup 同组排重（排除当前目标槽，兼容替换）。前置校验，失败原子不变。
      if (slot === "rig" && equipment.stackGroup) {
        const check = canFitRig(state, instance, resolved.itemId, slotIndex);
        if (!check.ok) return { changed:false, reason:check.reason };
      }
      let targetInstance = resolved && resolved.instance;
      if (!targetInstance) {
        const inventoryIndex = state.equipment.inventory.indexOf(equipmentRef);
        if (inventoryIndex < 0) return { changed:false, reason:"equipment-unavailable" };
        state.equipment.inventory.splice(inventoryIndex, 1);
        const newId = allocateEquipmentInstanceId(state);
        targetInstance = { instanceId:newId, itemId:equipmentRef, enhancementLevel:0, installedOn:null };
        state.equipment.instances.push(targetInstance);
      }
      if (targetInstance.installedOn) return { changed:false, reason:"equipment-installed" };
      targetInstance.installedOn = instance.instanceId;
      // rig 槽的旧件=销毁（删除实例，不归还）；其他槽=归还 inventory
      if (previous) { if (slot === "rig") destroyRigRefFromFitting(state, previous); else detachEquipmentRefFromFitting(state, previous); }
      instance.fitted[slot][slotIndex] = targetInstance.instanceId;
    } else {
      if (previous) { if (slot === "rig") destroyRigRefFromFitting(state, previous); else detachEquipmentRefFromFitting(state, previous); }
      instance.fitted[slot][slotIndex] = null;
    }
    state._dirty = true;
    return { changed:true, previous, equipmentId: equipmentRef || null };
  },

  resetFitting(state, instanceId) {
    const instance = getShipInstanceFromState(state, instanceId);
    if (!instance) return { changed:false, reason:"unknown-ship" };
    const activeCombat = state.combat && state.combat.active && getActiveCombatShipState(state).instance;
    if (activeCombat && activeCombat.instanceId === instance.instanceId) return { changed:false, reason:"combat-active" };
    if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
    if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];
    const fitting = instance.fitted || { high:[], mid:[], low:[], rig:[] };
    const destroyedRigs = [];
    for (const slot of ["high", "mid", "low", "rig"]) {
      if (!Array.isArray(fitting[slot])) continue;
      for (let i = 0; i < fitting[slot].length; i++) {
        const ref = fitting[slot][i];
        if (ref) {
          if (slot === "rig") {
            // 重置对 rig 槽=销毁（不归还）。先记录 rigId/stackGroup 供事件与调用方使用。
            const resolved = resolveEquipmentReference(state, ref);
            if (resolved && resolved.definition) destroyedRigs.push({ rigId:resolved.itemId, stackGroup:resolved.definition.stackGroup || "", slotIndex:i });
            destroyRigRefFromFitting(state, ref);
          } else {
            detachEquipmentRefFromFitting(state, ref);
          }
        }
        fitting[slot][i] = null;
      }
    }
    state._dirty = true;
    return { changed:true, destroyedRigs };
  },

  // 安装改装件（目标槽必须为空；占用请用 replaceFittedRig）。安装即从 inventory 消耗。
  fitRig(state, instanceId, slotIndex, rigItemId) {
    const instance = getShipInstanceFromState(state, instanceId);
    const config = instance ? getShipConfigById(instance.shipId) : null;
    if (!instance || !config) return { changed:false, reason:"unknown-ship" };
    const def = getRigDefinition(rigItemId);
    if (!def) return { changed:false, reason:"not-rig" };
    if (slotIndex < 0 || slotIndex >= (config.slots.rig || 0)) return { changed:false, reason:"invalid-slot" };
    const rigSlots = (instance.fitted && instance.fitted.rig) || [];
    if (rigSlots[slotIndex]) return { changed:false, reason:"slot-occupied" };
    const result = ShellStateActions.setFittingSlot(state, instanceId, "rig", slotIndex, rigItemId);
    if (!result.changed) return result;
    GameEvents.emit("rig:fitted", { rigId:rigItemId, shipInstanceId:instanceId, stackGroup:def.stackGroup || "", slotIndex },
      { offline:false, source:"rig-fit" });
    return { changed:true, rigId:rigItemId, slotIndex, stackGroup:def.stackGroup || "" };
  },

  // 拆卸即销毁：目标槽的改装件实例被彻底删除，不归还 inventory。
  destroyFittedRig(state, instanceId, slotIndex) {
    const instance = getShipInstanceFromState(state, instanceId);
    const config = instance ? getShipConfigById(instance.shipId) : null;
    if (!instance || !config) return { changed:false, reason:"unknown-ship" };
    if (slotIndex < 0 || slotIndex >= (config.slots.rig || 0)) return { changed:false, reason:"invalid-slot" };
    const rigSlots = (instance.fitted && instance.fitted.rig) || [];
    const ref = rigSlots[slotIndex];
    if (!ref) return { changed:false, reason:"empty-slot" };
    const resolved = resolveEquipmentReference(state, ref);
    const rigId = resolved ? resolved.itemId : null;
    const stackGroup = (resolved && resolved.definition && resolved.definition.stackGroup) || "";
    const result = ShellStateActions.setFittingSlot(state, instanceId, "rig", slotIndex, null);
    if (!result.changed) return result;
    GameEvents.emit("rig:destroyed", { rigId, shipInstanceId:instanceId, stackGroup, slotIndex },
      { offline:false, source:"rig-destroy" });
    return { changed:true, rigId, slotIndex, stackGroup };
  },

  // 替换=旧件销毁+新件安装（原子）。setFittingSlot 先校验新件可用与 stackGroup（排除当前槽），
  // 全部通过后才销毁旧件、装新件——失败时状态不变。
  replaceFittedRig(state, instanceId, slotIndex, rigItemId) {
    const instance = getShipInstanceFromState(state, instanceId);
    const config = instance ? getShipConfigById(instance.shipId) : null;
    if (!instance || !config) return { changed:false, reason:"unknown-ship" };
    if (slotIndex < 0 || slotIndex >= (config.slots.rig || 0)) return { changed:false, reason:"invalid-slot" };
    const newDef = getRigDefinition(rigItemId);
    if (!newDef) return { changed:false, reason:"not-rig" };
    const rigSlots = (instance.fitted && instance.fitted.rig) || [];
    const oldRef = rigSlots[slotIndex];
    if (!oldRef) return { changed:false, reason:"empty-slot" };
    const oldResolved = resolveEquipmentReference(state, oldRef);
    const oldRigId = oldResolved ? oldResolved.itemId : null;
    const result = ShellStateActions.setFittingSlot(state, instanceId, "rig", slotIndex, rigItemId);
    if (!result.changed) return result;
    GameEvents.emit("rig:replaced", { oldRigId, newRigId:rigItemId, shipInstanceId:instanceId, stackGroup:newDef.stackGroup || "", slotIndex },
      { offline:false, source:"rig-replace" });
    return { changed:true, oldRigId, newRigId:rigItemId, slotIndex, stackGroup:newDef.stackGroup || "" };
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
    // Batch C-14A（J05）：唯一真实新增入口。仅在数组写入完成后发射一次，
    // size 取写入后的真实长度（不是 +1 推算）。合并到末项 / 队列已满 / 蓝图未解锁 /
    // 缺失队列结构等路径均在上方 return，不会到达此处，因此不存在虚增。
    // GameEvents 不可用时安全降级：入队本身已成功，不回滚、不抛错。
    if (typeof GameEvents !== "undefined" && GameEvents && typeof GameEvents.emit === "function") {
      GameEvents.emit("queue:itemAdded", {
        itemId:queueItem.id,
        size:queue.items.length,
        maxSize:queue.config.maxSize
      }, { offline:false, source:"queue-add" });
    }
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
    const result = executeQueueItemForState(state, queue.items[0], now);
    if (!result.changed && result.reason && !result.skill) {
      // queueStart 自身失败（无队列项目等）
      return result;
    }
    return { changed:result.changed, skill:result.skill || state.currentAction.skill };
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

// 从装配槽移除一个装备引用：实例置 installedOn=null（双池，不退回 inventory）；旧式字符串退回 inventory。
function detachEquipmentRefFromFitting(state, ref) {
  if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
  const instance = isEquipmentInstanceId(state, ref) ? getEquipmentInstanceById(state, ref) : null;
  if (instance) {
    instance.installedOn = null;
  } else if (typeof ref === "string") {
    state.equipment.inventory.push(ref);
  }
}

// 改装件销毁：拆卸即销毁——实例从 equipment.instances 中彻底删除，绝不归还 inventory。
// 用于 rig 槽的替换/清除/重置。ref 为 instanceId（正常）或 legacy string（仅丢弃）。
function destroyRigRefFromFitting(state, ref) {
  if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];
  if (isEquipmentInstanceId(state, ref)) {
    const index = state.equipment.instances.findIndex(entry => String(entry.instanceId) === String(ref));
    if (index >= 0) state.equipment.instances.splice(index, 1);
  }
  // legacy string ref：不归还 inventory，直接丢弃（销毁语义）
}

// 全装备强化 Action（原子）。targetRef 可为实例 instanceId 或 inventory 中的 +0 装备字符串。
// 拒绝统一返回 { changed:false, reason }，绝不抛异常。
function enhanceEquipment(state, targetRef, randomValue) {
  if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
  if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];

  const isInstance = isEquipmentInstanceId(state, targetRef);
  let targetInstance = isInstance ? getEquipmentInstanceById(state, targetRef) : null;
  let targetInventoryIndex = -1;
  let targetItemId;

  if (targetInstance) {
    targetItemId = targetInstance.itemId;
    if (targetInstance.installedOn) return { changed:false, reason:"equipment-installed" };
  } else {
    targetInventoryIndex = state.equipment.inventory.indexOf(targetRef);
    if (targetInventoryIndex < 0) return { changed:false, reason:"unknown-equipment" };
    targetItemId = targetRef;
  }

  const eq = EQUIPMENT_DB[targetItemId];
  if (!eq) return { changed:false, reason:"unknown-equipment" };
  if (eq.slot === "rig") return { changed:false, reason:"rig-not-enhanceable" }; // 改装件不参与强化

  const engLevel = Number(state.skills && state.skills.equipmentEngineering && state.skills.equipmentEngineering.lvl) || 1;
  const currentLevel = targetInstance ? Math.max(0, Number(targetInstance.enhancementLevel) || 0) : 0;
  const display = getEquipmentEnhancementDisplayState(eq, currentLevel, engLevel);
  const needDonor = Boolean(display.extra.sameTypeItemId);

  // ── 前置校验：全部通过后才允许任何状态修改（原子性） ──
  if (!ResourceRegistry.canAffordCost(state, display.cost)) return { changed:false, reason:"insufficient-minerals" };

  // 校验里程碑额外材料（donor / core / protocol）是否充足
  const requiredInventory = needDonor ? (isInstance ? 1 : 2) : (isInstance ? 0 : 1);
  if (getEquipmentInventoryCount(state, targetItemId) < requiredInventory) {
    if (needDonor) return { changed:false, reason:"missing-donor" };
    return { changed:false, reason:"unknown-equipment" };
  }
  if (display.extra.core && ResourceRegistry.getMaterialStock(state, display.extra.core) < 1) return { changed:false, reason:"insufficient-core" };
  if (display.extra.protocol && ResourceRegistry.getMaterialStock(state, display.extra.protocol) < 1) return { changed:false, reason:"insufficient-protocol" };

  // ── 原子扣减：所有校验已通过，开始修改状态 ──
  if (!targetInstance) {
    // inventory +0 装备：先创建实例（此时 inventory 尚未删除，donor 查找不受影响）
    const newId = allocateEquipmentInstanceId(state);
    targetInstance = { instanceId:newId, itemId:targetItemId, enhancementLevel:0, installedOn:null };
    state.equipment.instances.push(targetInstance);
    // 删除 inventory 中被选为目标的那一件（按原始 index 精确删除）
    state.equipment.inventory.splice(targetInventoryIndex, 1);
  }
  if (needDonor) {
    // donor 必须来自 inventory（不得来自 instances、已安装或正在强化的装备）
    // 每次里程碑强化尝试只消耗恰好一件 donor
    const donorIndex = findDonorInventoryIndex(state, targetItemId, -1);
    if (donorIndex >= 0) state.equipment.inventory.splice(donorIndex, 1);
  }
  ResourceRegistry.spendCost(state, display.cost);
  if (display.extra.core) ResourceRegistry.spendCost(state, { [display.extra.core]:1 });
  if (display.extra.protocol) ResourceRegistry.spendCost(state, { [display.extra.protocol]:1 });

  const fromLevel = targetInstance.enhancementLevel;
  const roll = Number.isFinite(Number(randomValue)) ? Math.max(0, Math.min(0.999999999, Number(randomValue))) : Math.random();
  const success = roll < display.success;
  const toLevel = success ? fromLevel + 1 : fromLevel; // 失败规则 C：等级不变，不回退、不降级
  targetInstance.enhancementLevel = toLevel;
  const xp = success ? display.successXp : 0; // 失败 XP = 0
  if (xp > 0) addSkillXpToState(state, "equipmentEngineering", xp, { source:"equipment-enhancement" });
  state._dirty = true;

  GameEvents.emit("equipment:enhancementAttempted", {
    instanceId: targetInstance.instanceId,
    itemId: targetItemId,
    category: display.category,
    fromLevel,
    toLevel,
    chance: display.success,
    success,
    xp,
    consumedResources: display.cost,
    consumedEquipmentItemId: needDonor ? targetItemId : null,
    offline:false
  }, { offline:false, source:"equipment-enhancement" });

  return { changed:true, instanceId:targetInstance.instanceId, itemId:targetItemId, fromLevel, toLevel, success, xp, cost:display.cost, extra:display.extra, isMilestone:display.isMilestone };
}

/* ================================================================
   空间站 Action 层（Phase 3C-5）
   所有 UI 和未来入口必须通过 Action，不允许直接改状态。
   ================================================================ */
const StationStateActions = {
  // 选择自动线目标（只改 selectedTargetId，不触及 startedTargetId/运行状态）
  selectAutoLineTarget(state, lineId, targetId) {
    if (!AUTO_LINE_IDS.includes(lineId)) return { changed:false, reason:"unknown-line" };
    const s = state.station;
    if (!s || !s.autoLines || !s.autoLines[lineId]) return { changed:false, reason:"no-state" };
    const line = s.autoLines[lineId];
    // 目标为空则清空选择
    if (!targetId) {
      line.selectedTargetId = null;
      state._dirty = true;
      return { changed:true, lineId, targetId:null };
    }
    // 验证 targetId 属于对应配方池
    let recipe;
    if (lineId === "smelting") recipe = SMELTING_RECIPES.find(r => r.name === targetId);
    else if (lineId === "equipment") recipe = EQUIPMENT_ENGINEERING_RECIPES.find(r => r.id === targetId);
    else if (lineId === "booster") recipe = BOOSTER_RECIPES.find(r => r.id === targetId);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    // 运行时允许修改 selectedTargetId（但不能改变 startedTargetId）
    line.selectedTargetId = targetId;
    state._dirty = true;
    return { changed:true, lineId, targetId };
  },

  // 启动自动线
  startAutoLine(state, lineId, nowOverride) {
    if (!AUTO_LINE_IDS.includes(lineId)) return { changed:false, reason:"unknown-line" };
    const s = state.station;
    if (!s || !s.autoLines || !s.autoLines[lineId]) return { changed:false, reason:"no-state" };
    const line = s.autoLines[lineId];

    // 必须在运行状态的线才能启动（不管 enabled、clear stoppedReason）
    const buildingLevel = (typeof getStationBuildingLevel === "function")
      ? getStationBuildingLevel(state, AUTO_LINE_CONFIG[lineId].buildingId) : 0;
    if (buildingLevel < 1) return { changed:false, reason:"building-required" };

    const targetId = line.selectedTargetId;
    if (!targetId) return { changed:false, reason:"no-target-selected" };

    // 检查配方合法（不同线使用不同配方池）
    let recipe;
    if (lineId === "smelting") recipe = SMELTING_RECIPES.find(r => r.name === targetId);
    else if (lineId === "equipment") recipe = EQUIPMENT_ENGINEERING_RECIPES.find(r => r.id === targetId);
    else if (lineId === "booster") recipe = BOOSTER_RECIPES.find(r => r.id === targetId);

    if (!recipe) return { changed:false, reason:"unknown-recipe" };

    // 检查配方等级门槛
    const eeLvl = (lineId === "equipment") ? (Number(state.skills.equipmentEngineering && state.skills.equipmentEngineering.lvl) || 1) : 99;
    const bLvl = (lineId === "booster") ? (Number(state.skills.boosterEngineering && state.skills.boosterEngineering.lvl) || 1) : 99;
    const sLvl = (lineId === "smelting") ? (Number(state.skills.refining && state.skills.refining.lvl) || 1) : 99;
    const levelCheck = (lineId === "equipment") ? (eeLvl < recipe.level) : (lineId === "booster") ? (bLvl < recipe.level) : (lineId === "smelting") ? (sLvl < recipe.level) : false;
    if (levelCheck) return { changed:false, reason:"level-locked" };

    // 如果正在运行另一个目标，拒绝
    if (line.enabled && line.startedTargetId && line.startedTargetId !== targetId) {
      return { changed:false, reason:"different-target-running" };
    }

    // 如果已经运行相同目标且处于运行中，幂等
    if (line.enabled && line.startedTargetId === targetId && !line.stoppedReason) {
      return { changed:true, lineId, targetId, alreadyRunning:true };
    }

    // 启动
    const now = Number.isFinite(Number(nowOverride)) ? Number(nowOverride) : Date.now();
    line.enabled = true;
    line.startedTargetId = targetId;
    line.selectedTargetId = targetId;
    line.stoppedReason = null;
    line.progress = 0;
    line.lastTick = now;
    state._dirty = true;

    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("station:autoLineStarted", { lineId, targetId }, { source:"station", offline:false });
    }

    return { changed:true, lineId, targetId, startedAt:now };
  },

  // 停止自动线
  stopAutoLine(state, lineId, nowOverride) {
    if (!AUTO_LINE_IDS.includes(lineId)) return { changed:false, reason:"unknown-line" };
    const s = state.station;
    if (!s || !s.autoLines || !s.autoLines[lineId]) return { changed:false, reason:"no-state" };
    const line = s.autoLines[lineId];
    if (!line.enabled && !line.startedTargetId) return { changed:false, reason:"not-running" };

    const targetId = line.startedTargetId || line.selectedTargetId;
    line.enabled = false;
    line.stoppedReason = "user-stopped";
    line.progress = 0;
    state._dirty = true;

    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("station:autoLineStopped", {
        lineId, targetId, reason:"user-stopped",
        quantity:0, xp:0, offline:false
      }, { source:"station", offline:false });
    }

    return { changed:true, lineId, targetId };
  },

  // 一键补给维护燃料
  refillMaintenance(state, nowOverride) {
    if (typeof getStationRefillMaintenanceState !== "function") return { changed:false, reason:"not-available" };
    const info = getStationRefillMaintenanceState(state);
    if (!info.canRefill) return { changed:false, reason:info.reason, points:info.points, fuelRemaining:info.fuel };
    const cost = Math.ceil(info.targetFuel - info.fuel);
    const fuelStock = ResourceRegistry.get(state, "consumable:fuel");
    if (fuelStock < cost) return { changed:false, reason:"insufficient-fuel", fuelCost:cost, fuelStock };
    ResourceRegistry.spend(state, "consumable:fuel", cost);
    const m = state.station.maintenance;
    m.fuelRemaining = info.targetFuel;
    const now = Number.isFinite(Number(nowOverride)) ? Number(nowOverride) : Date.now();
    m.lastTick = now;
    m.lowFuelNotified = false;
    m.depletedNotified = false;
    state._dirty = true;
    // 研究批次 G · fuel：补满后的可持续时长同样按实际燃烧速率计算（与显示态/结算同源）
    const remainingMs = info.targetFuel / getStationEffectiveFuelBurnRatePerMs(state, info.points);
    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("station:maintenanceRefilled", { points:info.points, fuelSpent:cost, fuelRemaining:info.targetFuel, remainingMs }, { source:"station", offline:false });
    }
    return { changed:true, points:info.points, fuelSpent:cost, fuelRemaining:info.targetFuel, remainingMs };
  },

  // 建设本体
  startBodyConstruction(state, nowOverride) {
    if (typeof startStationBodyConstruction !== "function") return { changed:false, reason:"not-available" };
    const now = Number.isFinite(Number(nowOverride)) ? Number(nowOverride) : Date.now();
    return startStationBodyConstruction(state, now);
  },

  // 建设附属建筑
  startBuildingConstruction(state, buildingId, nowOverride) {
    if (typeof startStationBuildingConstruction !== "function") return { changed:false, reason:"not-available" };
    const now = Number.isFinite(Number(nowOverride)) ? Number(nowOverride) : Date.now();
    return startStationBuildingConstruction(state, buildingId, now);
  }
};

  // -------------------------------------------------------------------------
  // 研究系统 Action（Batch F）：仅转发到 ResearchSystem 公开 API，
  //   不复制验证 / 时间结算 / 额度公式。actionTime 透传给系统层，
  //   系统层返回的稳定 reason 原样保留。失败分支由 ResearchSystem 负责
  //   （不置 dirty、不改状态），此处只映射为 { changed, reason }。
  // -------------------------------------------------------------------------
  function getResearchSystemRef() {
    return (typeof globalThis !== "undefined" && globalThis.ResearchSystem) ||
           (typeof window !== "undefined" && window.ResearchSystem) || null;
  }
  function researchActionResult(result) {
    if (!result || typeof result !== "object") return { changed: false, reason: "internal-error" };
    const { ok, reason, ...rest } = result;
    return Object.assign({ changed: !!ok, reason: ok ? null : (reason || "failed") }, rest);
  }
  const ResearchStateActions = {
    start(state, techId, targetLevel, now) {
      const RS = getResearchSystemRef();
      if (!RS || typeof RS.startResearch !== "function") return { changed: false, reason: "not-available" };
      return researchActionResult(RS.startResearch(state, techId, targetLevel, now));
    },
    enqueue(state, techId, targetLevel, now) {
      const RS = getResearchSystemRef();
      if (!RS || typeof RS.enqueueResearch !== "function") return { changed: false, reason: "not-available" };
      return researchActionResult(RS.enqueueResearch(state, techId, targetLevel, now));
    },
    cancel(state, now) {
      const RS = getResearchSystemRef();
      if (!RS || typeof RS.cancelResearch !== "function") return { changed: false, reason: "not-available" };
      return researchActionResult(RS.cancelResearch(state, now));
    },
    applyHours(state, hours, now) {
      const RS = getResearchSystemRef();
      if (!RS || typeof RS.applyResearchHours !== "function") return { changed: false, reason: "not-available" };
      return researchActionResult(RS.applyResearchHours(state, hours, now));
    },
    removeQueued(state, stepKey, now) {
      const RS = getResearchSystemRef();
      if (!RS || typeof RS.removeQueuedResearch !== "function") return { changed: false, reason: "not-available" };
      return researchActionResult(RS.removeQueuedResearch(state, stepKey, now));
    }
  };

  function tutorialNote(state, action, result, now) {
    const TS = (typeof TutorialSystem !== "undefined" && TutorialSystem)
      ? TutorialSystem
      : (typeof window !== "undefined" && window.TutorialSystem ? window.TutorialSystem : null);
    if (TS && typeof TS.noteTutorialActionResult === "function" && result && result.changed) {
      try { TS.noteTutorialActionResult(state, action, result, now); } catch (e) { /* 新手任务旁路失败不影响主流程 */ }
    }
    return result;
  }

  function dispatchGameAction(state, action, now) {
  if (!state || !action || typeof action.type !== "string") return { changed:false, reason:"invalid-action" };
  const actionTime = Number(now) || Date.now();
  if (action.type === "action/stop") return ShellStateActions.stopCurrentAction(state, actionTime);
  if (action.type === "production/ensureMiningArea") return ProductionStateActions.ensureMiningArea(state);
  if (action.type === "production/selectMiningArea") return ProductionStateActions.selectMiningArea(state, action.areaName, actionTime);
  if (action.type === "production/selectMiningMode") return ProductionStateActions.selectMiningMode(state, action.mode);
  if (action.type === "production/selectSmeltingRecipe") return ProductionStateActions.selectSmeltingRecipe(state, action.areaName, actionTime);
  if (action.type === "production/selectGasArea") return ProductionStateActions.selectGasArea(state, action.areaName, actionTime);
  if (action.type === "manufacturing/buyBlueprint") return ManufacturingStateActions.buyBlueprint(state, action.blueprintId, actionTime);
  if (action.type === "manufacturing/selectShipComponent") return ManufacturingStateActions.selectShipComponent(state, action.componentId);
  if (action.type === "manufacturing/selectShipAssembly") return ManufacturingStateActions.selectShipAssembly(state, action.recipeId);
  if (action.type === "manufacturing/startShipComponent") return ManufacturingStateActions.startShipComponent(state, actionTime);
  if (action.type === "manufacturing/startShipAssembly") return ManufacturingStateActions.startShipAssembly(state, actionTime);
  if (action.type === "manufacturing/selectEquipmentCategory") return ManufacturingStateActions.selectEquipmentCategory(state, action.categoryId);
  if (action.type === "manufacturing/selectEquipmentRecipe") return ManufacturingStateActions.selectEquipmentRecipe(state, action.recipeId);
  if (action.type === "manufacturing/selectEquipEngRigFilter") return ManufacturingStateActions.selectEquipEngRigFilter(state, action);
  if (action.type === "manufacturing/stop") return ManufacturingStateActions.stop(state, actionTime);
  if (action.type === "booster/selectCategory") return BoosterStateActions.selectCategory(state, action.categoryId);
  if (action.type === "booster/selectQualityFilter") return BoosterStateActions.selectQualityFilter(state, action.quality);
  if (action.type === "booster/selectRecipe") return BoosterStateActions.selectRecipe(state, action.recipeId);
  if (action.type === "booster/startManufacturing") return BoosterStateActions.startManufacturing(state, actionTime);
  if (action.type === "booster/stopManufacturing") return BoosterStateActions.stopManufacturing(state, actionTime);
  if (action.type === "booster/equip") return BoosterStateActions.equip(state, action.slot, action.itemId);
  if (action.type === "booster/unequip") return BoosterStateActions.unequip(state, action.slot);
  if (action.type === "booster/replace") return BoosterStateActions.replace(state, action.slot, action.itemId);
  if (action.type === "combat/selectMode") return CombatStateActions.selectMode(state, action.mode);
  if (action.type === "combat/selectTargetingMode") return CombatStateActions.selectTargetingMode(state, action.mode);
  if (action.type === "combat/selectZone") return tutorialNote(state, action, CombatStateActions.selectZone(state, action.zoneId), actionTime);
  if (action.type === "combat/selectDeathspace") return CombatStateActions.selectDeathspace(state, action.deathspaceId);
  if (action.type === "combat/selectDeathspaceTier") return CombatStateActions.selectDeathspaceTier(state, action.tier);
  if (action.type === "combat/start") return tutorialNote(state, action, CombatStateActions.start(state, action.enemies, action.formationId, actionTime), actionTime);
  if (action.type === "combat/enterDeathspace") return CombatStateActions.enterDeathspace(state, action.deathspaceId, action.enemies, action.formationId, actionTime);
  if (action.type === "combat/stop") return tutorialNote(state, action, CombatStateActions.stop(state), actionTime);
  if (action.type === "combat/beginRecovery") return CombatStateActions.beginRecovery(state, actionTime);
  if (action.type === "combat/finishRecovery") return CombatStateActions.finishRecovery(state, actionTime);
  if (action.type === "planetary/deploy") return PlanetaryStateActions.deploy(state, action.planetType, actionTime);
  if (action.type === "planetary/collect") return PlanetaryStateActions.collect(state, action.id);
  if (action.type === "planetary/renew") return PlanetaryStateActions.renew(state, action.id, actionTime);
  if (action.type === "planetary/demolish") return PlanetaryStateActions.demolish(state, action.id);
  if (action.type === "shell/buyLPItem") return ShellStateActions.buyLPItem(state, action.equipmentId, actionTime);
  if (action.type === "hangar/toggleAssignment") return tutorialNote(state, action, ShellStateActions.toggleShipAssignment(state, action.instanceId, action.actionKey, actionTime), actionTime);
  if (action.type === "hangar/equipCombatShip") return tutorialNote(state, action, ShellStateActions.equipCombatShip(state, action.instanceId, actionTime), actionTime);
  if (action.type === "hangar/enhanceShip") return ShellStateActions.enhanceShip(state, action.instanceId, action.randomValue);
  if (action.type === "hangar/setFittingSlot") return ShellStateActions.setFittingSlot(state, action.instanceId, action.slot, action.slotIndex, action.equipmentId);
  if (action.type === "hangar/resetFitting") return ShellStateActions.resetFitting(state, action.instanceId);
  if (action.type === "hangar/fitRig") return ShellStateActions.fitRig(state, action.instanceId, action.slotIndex, action.rigItemId);
  if (action.type === "hangar/destroyFittedRig") return ShellStateActions.destroyFittedRig(state, action.instanceId, action.slotIndex);
  if (action.type === "hangar/replaceFittedRig") return ShellStateActions.replaceFittedRig(state, action.instanceId, action.slotIndex, action.rigItemId);
  if (action.type === "equipment/enhance") return enhanceEquipment(state, action.targetRef, action.randomValue);
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
  if (action.type === "archaeology/selectSite") return ArchaeologyStateActions.selectSite(state, action.siteId);
  if (action.type === "archaeology/selectProbe") return ArchaeologyStateActions.selectProbe(state, action.probeId);
  if (action.type === "archaeology/start") return ArchaeologyStateActions.start(state, actionTime);
  if (action.type === "archaeology/stop") return ArchaeologyStateActions.stop(state, actionTime);
  if (action.type === "archaeology/sellArtifact") return ArchaeologyStateActions.sellArtifact(state, action.artifactId, action.quantity, action.all);
  if (action.type === "archaeology/redeemArtifact") return ArchaeologyStateActions.redeemArtifact(state, action.artifactId, action.quantity, action.all);
  // 空间站 Phase 3C-5：自动线 Action
  if (action.type === "station/selectAutoLineTarget") return StationStateActions.selectAutoLineTarget(state, action.lineId, action.targetId);
  if (action.type === "station/startAutoLine") return StationStateActions.startAutoLine(state, action.lineId, actionTime);
  if (action.type === "station/stopAutoLine") return StationStateActions.stopAutoLine(state, action.lineId, actionTime);
  if (action.type === "station/refillMaintenance") return StationStateActions.refillMaintenance(state, actionTime);
  if (action.type === "station/startBodyConstruction") return StationStateActions.startBodyConstruction(state, actionTime);
  if (action.type === "station/startBuildingConstruction") return StationStateActions.startBuildingConstruction(state, action.buildingId, actionTime);
  // 研究系统 Batch F：所有操作经 ResearchSystem 公开 API，actionTime 透传
  if (action.type === "research/start") return ResearchStateActions.start(state, action.techId, action.targetLevel, actionTime);
  if (action.type === "research/enqueue") return ResearchStateActions.enqueue(state, action.techId, action.targetLevel, actionTime);
  if (action.type === "research/cancel") return ResearchStateActions.cancel(state, actionTime);
  if (action.type === "research/applyHours") return ResearchStateActions.applyHours(state, action.hours, actionTime);
  if (action.type === "research/removeQueued") return ResearchStateActions.removeQueued(state, action.stepKey, actionTime);
  // 研究系统 Batch I：自动化协议配置（业务实现全在 js/systems/research-protocols.js，actionTime 原样透传）
  if (action.type === "research/setProtocolEnabled") {
    return (typeof setResearchProtocolEnabled === "function")
      ? setResearchProtocolEnabled(state, action.protocolId, action.enabled, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  if (action.type === "research/setPlanetAutoRenew") {
    return (typeof setPlanetAutoRenew === "function")
      ? setPlanetAutoRenew(state, action.deploymentId, action.enabled, action.minIskReserve, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  // 研究系统 Batch J：autoenh 自动强化配置与执行（业务实现全在 js/systems/research-protocols.js）
  if (action.type === "research/setAutoEnhancementMaxAttempts") {
    return (typeof setAutoEnhancementMaxAttempts === "function")
      ? setAutoEnhancementMaxAttempts(state, action.maxAttempts)
      : { changed:false, reason:"INVALID_STATE" };
  }
  if (action.type === "research/runAutoEnhancement") {
    return (typeof runAutoEnhancement === "function")
      ? runAutoEnhancement(state, action.instanceId, action.context)
      : { changed:false, reason:"INVALID_STATE" };
  }
  // 研究系统 Batch K：intship 一体化造船（业务实现全在 js/systems/research-protocols.js）
  if (action.type === "research/startIntship") {
    return (typeof startIntship === "function")
      ? startIntship(state, action.options, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  if (action.type === "research/continueIntship") {
    return (typeof continueIntship === "function")
      ? continueIntship(state, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  if (action.type === "research/cancelIntship") {
    return (typeof cancelIntship === "function")
      ? cancelIntship(state, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  // 新手任务 Batch O：任务领取 / 确认 / 战斗路线选择 / 应急舰船
  if (action.type === "tutorial/claim") {
    return (typeof TutorialSystem !== "undefined" && TutorialSystem)
      ? TutorialSystem.claimTutorialTask(state, action.taskId, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  if (action.type === "tutorial/confirm") {
    return (typeof TutorialSystem !== "undefined" && TutorialSystem)
      ? TutorialSystem.confirmTutorialTask(state, action.taskId, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  if (action.type === "tutorial/chooseCombatTrack") {
    return (typeof TutorialSystem !== "undefined" && TutorialSystem)
      ? TutorialSystem.chooseTutorialCombatTrack(state, action.track, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  if (action.type === "tutorial/claimEmergencyShip") {
    return (typeof TutorialSystem !== "undefined" && TutorialSystem)
      ? TutorialSystem.claimEmergencyTutorialShip(state, actionTime)
      : { changed:false, reason:"INVALID_STATE" };
  }
  return { changed:false, reason:"unknown-action" };
}

const ArchaeologyStateActions = {
  selectSite(state, siteId) {
    const site = getArchaeologySite(siteId);
    if (!site) return { changed:false, reason:"unknown-site" };
    if (state.currentAction.active && state.currentAction.skill === "archaeology") return { changed:false, reason:"action-running" };
    if ((state.skills.archaeology.lvl || 1) < site.level) return { changed:false, reason:"level-locked" };
    state.archaeology.activeSiteId = site.id;
    state._dirty = true;
    return { changed:true, site };
  },
  selectProbe(state, probeId) {
    const probe = getArchaeologyProbe(probeId);
    if (!probe) return { changed:false, reason:"unknown-probe" };
    if (state.currentAction.active && state.currentAction.skill === "archaeology") return { changed:false, reason:"action-running" };
    if ((state.skills.archaeology.lvl || 1) < probe.level) return { changed:false, reason:"level-locked" };
    state.archaeology.activeProbeId = probe.id;
    state._dirty = true;
    return { changed:true, probe };
  },
  start(state, now) {
    const check = canStartArchaeology(state, now);
    if (!check.ok) return { changed:false, reason:check.reason };
    const arch = state.archaeology;
    Object.assign(state.currentAction, {
      skill:"archaeology", active:true, progress:0,
      lastProgressUpdate:now, startedSiteId:check.site.id, startedProbeId:check.probeId
    });
    arch.startedSiteId = check.site.id;
    arch.startedProbeId = check.probeId;
    state.resumeAfterRepair = null; // 新开考古：清除待恢复标记
    state._dirty = true;
    return { changed:true, site:check.site };
  },
  stop(state, now) {
    const action = state.currentAction;
    if (!action.active || action.skill !== "archaeology") return { changed:false, reason:"not-archaeology" };
    action.progress = 0;
    action.lastProgressUpdate = now;
    action.active = false;
    state.archaeology.startedSiteId = null;
    state.archaeology.startedProbeId = null;
    state.resumeAfterRepair = null; // 玩家主动停止考古：取消待恢复
    state._dirty = true;
    return { changed:true };
  },
  sellArtifact(state, artifactId, quantity, all) {
    const result = sellArchaeologyArtifacts(state, artifactId, quantity, all);
    if (result.changed) state._dirty = true;
    return result;
  },
  redeemArtifact(state, artifactId, quantity, all) {
    const result = redeemArchaeologyArtifacts(state, artifactId, quantity, all);
    if (result.changed) state._dirty = true;
    return result;
  }
};

window.canStartArchaeology = canStartArchaeology;
window.executeQueueItemForState = executeQueueItemForState;
