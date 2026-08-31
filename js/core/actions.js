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
    const level = getEffectiveSkillLevel(state, "mining");
    let bestArea = areas[0];
    for (const area of areas) { if (level >= area.level) bestArea = area; else break; }
    state.currentAction.area = bestArea.name;
    state._dirty = true;
    return { changed:true, area:bestArea };
  },

  selectMiningArea(state, areaName, now) {
    const area = getMiningAreaByName(areaName);
    if (!area) return { changed:false, reason:"unknown-area" };
    if (getEffectiveSkillLevel(state, "mining") < area.level) return { changed:false, reason:"level-locked" };
    const action = state.currentAction;
    const prevArea = action.area;
    action.area = area.name;
    action.miningMode = area.mode;
    if (area.mode === "moon") action.moonMiningArea = area.name;
    else action.normalMiningArea = area.name;
    if (!action.active) {
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
    const level = getEffectiveSkillLevel(state, "mining");
    let bestArea = areas[0];
    for (const area of areas) { if (level >= area.level) bestArea = area; else break; }
    action.area = savedArea && savedArea.mode === mode ? savedArea.name : bestArea.name;
    state._dirty = true;
    return { changed:true, mode, area:action.area };
  },

  selectSmeltingRecipe(state, areaName, now) {
    const recipe = SMELTING_RECIPES.find(item => item.name === areaName);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    if (getEffectiveSkillLevel(state, "refining") < recipe.level) return { changed:false, reason:"level-locked" };
    const action = state.currentAction;
    action.smeltingArea = recipe.name;
    if (!action.active) {
      action.progress = 0;
      action.lastProgressUpdate = now;
    }
    state._dirty = true;
    return { changed:true, recipe };
  },

  selectGasArea(state, areaName, now) {
    const area = GAS_AREAS.find(item => item.name === areaName);
    if (!area) return { changed:false, reason:"unknown-area" };
    if (getEffectiveSkillLevel(state, "gasHarvesting") < area.level) return { changed:false, reason:"level-locked" };
    const action = state.currentAction;
    const prevArea = action.gasArea;
    action.gasArea = area.name;
    if (!action.active) {
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
  buyBlueprint(state, blueprintId, now, quantity) {
    // 限次抄本（BPC）：势力探针抄本按「流程数」线性计价；流程用尽后抄本消失，
    // 因此**不做**「已拥有」守卫，允许重复购买（与永久 BPO 的唯一行为差异）。
    if (typeof FACTION_PROBE_BLUEPRINTS !== "undefined") {
      const probeBp = FACTION_PROBE_BLUEPRINTS.find(item => item.id === blueprintId);
      if (probeBp) {
        const maxRuns = (typeof PROBE_BLUEPRINT_MAX_RUNS_PER_PURCHASE === "number") ? PROBE_BLUEPRINT_MAX_RUNS_PER_PURCHASE : 999;
        const runs = Math.min(maxRuns, Math.max(1, Math.floor(Number(quantity) || 1)));
        const price = probeBp.perRunPrice * runs;
        if (typeof grantBlueprintRuns !== "function") return { changed:false, reason:"bpc-not-ready" };
        if (ResourceRegistry.get(state, "currency:lp") < price) return { changed:false, reason:"insufficient-lp" };
        ResourceRegistry.spend(state, "currency:lp", price);
        const totalRuns = grantBlueprintRuns(state, "probe:" + probeBp.recipeId, runs);
        state._dirty = true;
        if (typeof GameEvents !== "undefined") {
          const ts = (typeof now === "number" && Number.isFinite(now) && now >= 0) ? now : Date.now();
          GameEvents.emit("blueprint:acquired", { ownershipKey:"probe:" + probeBp.recipeId, blueprintKind:"probeBpc", productId:probeBp.recipeId, runs }, { timestamp: ts, source:"blueprint-store", offline:false });
        }
        return { changed:true, blueprint:probeBp, runs, totalRuns, price };
      }
    }
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
    // 等级锁定只挡「制造」，不挡「选中预览」：未达等级也可点选查看 3D/属性/成本
    state.currentAction.shipCompTarget = recipe.id;
    state._dirty = true;
    return { changed:true, recipe };
  },

  selectShipAssembly(state, recipeId) {
    const recipe = SHIP_ASSEMBLY_RECIPES.find(item => item.id === recipeId);
    if (!recipe) return { changed:false, reason:"unknown-assembly" };
    // 蓝图/等级锁定只挡「合成」，不挡「选中预览」：未解锁也可点选查看 3D/属性/成本
    state.currentAction.shipAsmTarget = recipe.id;
    state._dirty = true;
    return { changed:true, recipe };
  },

  // ---- 舰船工程 UI 重做（2026-08-04）：一级视图 / 部件分类 / 总装技术线 / 分页 切换 ----
  selectShipEngSubView(state, view) {
    if (view !== "component" && view !== "assembly") return { changed:false, reason:"bad-subview" };
    if (state.currentAction.shipEngSubView === view) return { changed:false, reason:"same" };
    state.currentAction.shipEngSubView = view;
    state._dirty = true;
    return { changed:true, view };
  },

  selectShipCompClass(state, cls) {
    if (!SHIP_COMPONENT_CLASSES.some(item => item.id === cls)) return { changed:false, reason:"unknown-class" };
    state.currentAction.shipCompClass = cls;
    if (getShipComponentClass(state.currentAction.shipCompTarget) !== cls) {
      const first = SHIP_COMPONENT_RECIPES.find(recipe => getShipComponentClass(recipe.id) === cls);
      if (first) state.currentAction.shipCompTarget = first.id;
    }
    state._dirty = true;
    return { changed:true, cls };
  },

  selectShipAsmLine(state, line) {
    if (!SHIP_ASSEMBLY_LINES.some(item => item.id === line)) return { changed:false, reason:"unknown-line" };
    const currentRecipe = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === state.currentAction.shipAsmTarget);
    const currentLine = currentRecipe ? getShipAssemblyLine(currentRecipe.shipId) : null;
    state.currentAction.shipAsmLine = line;
    state.currentAction.shipAsmPage = 0;
    if (currentLine !== line) {
      const first = SHIP_ASSEMBLY_RECIPES.find(recipe => getShipAssemblyLine(recipe.shipId) === line);
      if (first) state.currentAction.shipAsmTarget = first.id;
    }
    state._dirty = true;
    return { changed:true, line };
  },

  selectShipAsmPage(state, page) {
    const line = state.currentAction.shipAsmLine || "shield_laser";
    const total = SHIP_ASSEMBLY_RECIPES.filter(recipe => getShipAssemblyLine(recipe.shipId) === line).length;
    const pageCount = Math.max(1, Math.ceil(total / SHIP_ASSEMBLY_PAGE_SIZE));
    const next = Math.min(Math.max(0, Number(page) | 0), pageCount - 1);
    if (state.currentAction.shipAsmPage === next) return { changed:false, reason:"same" };
    state.currentAction.shipAsmPage = next;
    state._dirty = true;
    return { changed:true, page:next };
  },

  startShipComponent(state, now) {
    const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === state.currentAction.shipCompTarget) || SHIP_COMPONENT_RECIPES[0];
    // 精密配给剂（考古重制 Phase B · precision_rationing）：激活期间配方等级门槛 +5（组件/总装同公式）。
    const shipBuildingQuote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, recipe, { kind:"component" }) : { levelGate: recipe.level };
    if (getEffectiveSkillLevel(state, "shipEngineering") < shipBuildingQuote.levelGate) return { changed:false, reason:"level-locked" };
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
    // 精密配给剂（考古重制 Phase B · precision_rationing）：激活期间配方等级门槛 +5（组件/总装同公式）。
    const shipBuildingQuote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, recipe, { kind:"assembly" }) : { levelGate: recipe.level };
    if (getEffectiveSkillLevel(state, "shipEngineering") < shipBuildingQuote.levelGate) return { changed:false, reason:"level-locked" };
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
      const next = recipes.find(recipe => getEffectiveSkillLevel(state, "equipmentEngineering") >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe)) || recipes[0];
      if (next) state.currentAction.equipEngTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, category };
  },

  // 改装件二级筛选：按 9 个系列（stackGroup）单选。
  // 只改筛选状态与 equipEngTarget（详情落到第一个可见配方），
  // 绝不触碰 startedEquipEngTarget —— 制造中切换筛选不改变实际产物。
  selectEquipEngRigFilter(state, payload) {
    const action = state.currentAction;
    const series = payload.series !== undefined ? payload.series : (action.equipEngRigSeries || RIG_ENGINEERING_SERIES[0].id);
    if (!RIG_ENGINEERING_SERIES.some(item => item.id === series)) return { changed:false, reason:"unknown-rig-series" };
    action.equipEngRigSeries = series;
    const filtered = EQUIPMENT_ENGINEERING_RECIPES.filter(recipe =>
      recipe.category === "rigs" && recipe.stackGroup === series);
    const current = getEquipmentEngineeringRecipe(action.equipEngTarget || "t1_mining_laser");
    if (!filtered.some(recipe => recipe.id === current.id)) {
      const next = filtered.find(recipe => getEffectiveSkillLevel(state, "equipmentEngineering") >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe)) || filtered[0];
      if (next) action.equipEngTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, series };
  },

  // 三级标签：按二级分类记忆所选子标签（equipEngSubTab[categoryId]）。
  // 只改筛选状态与 equipEngTarget（详情落到第一个可见配方），不改变制造中产物。
  selectEquipEngSubTab(state, payload) {
    const action = state.currentAction;
    const categoryId = action.equipEngCategory;
    if (!EQUIPMENT_ENGINEERING_SUBTABS[categoryId]) return { changed:false, reason:"category-has-no-subtabs" };
    const subTab = payload.subTab !== undefined ? payload.subTab : "all";
    if (!EQUIPMENT_ENGINEERING_SUBTABS[categoryId].some(item => item.id === subTab)) return { changed:false, reason:"unknown-subtab" };
    if (!action.equipEngSubTab) action.equipEngSubTab = {};
    action.equipEngSubTab[categoryId] = subTab;
    const filtered = EQUIPMENT_ENGINEERING_RECIPES.filter(recipe =>
      recipe.category === categoryId && (subTab === "all" || getEquipEngSubtabId(recipe) === subTab));
    const current = getEquipmentEngineeringRecipe(action.equipEngTarget || "t1_mining_laser");
    if (!filtered.some(recipe => recipe.id === current.id)) {
      const next = filtered.find(recipe => getEffectiveSkillLevel(state, "equipmentEngineering") >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe)) || filtered[0];
      if (next) action.equipEngTarget = next.id;
    }
    state._dirty = true;
    return { changed:true, subTab };
  },

  selectEquipmentRecipe(state, recipeId) {
    const recipe = EQUIPMENT_ENGINEERING_RECIPES.find(item => item.id === recipeId);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    // 与舰船总装一致：蓝图/等级锁定只挡「制造」，不挡「选中预览」——未解锁也可点选查看属性/材料/成本。
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
    if (series) {
      const cats = Array.isArray(series.category) ? series.category : [series.category];
      // 共享分类的瓶（如精密配给剂同时归于舰船工程与装备制造）：保持当前所在标签，
      // 避免从装备制造点击它时强制跳回 category[0]（舰船工程）。
      if (!action.boosterCategory || !cats.includes(action.boosterCategory)) {
        action.boosterCategory = cats[0];
      }
    }
    state._dirty = true;
    return { changed:true, recipe };
  },

  startManufacturing(state, now, recipeId) {
    const recipe = recipeId ? getBoosterRecipe(recipeId) : (getBoosterRecipe(state.currentAction.boosterRecipeTarget) || BOOSTER_RECIPES[0]);
    if (!recipe) return { changed:false, reason:"unknown-recipe" };
    if (!isBoosterRecipeUnlocked(recipe)) {
      // 区分失败原因：等级不足 vs 缺蓝图（考古重做的新增 24 张 requiresBlueprint 配方）
      const lvl = getEffectiveSkillLevel(state, "boosterEngineering");
      const reason = (lvl < recipe.level) ? "level-locked" : "blueprint-locked";
      return { changed:false, reason };
    }
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
    if (typeof isBoosterCompatibleWithSlot === "function" && !isBoosterCompatibleWithSlot(item, slot)) return { changed:false, reason:"slot-mismatch" };
    if (typeof isBoosterCompatibleWithSlot !== "function" && !item.universal && item.slot !== slot) return { changed:false, reason:"slot-mismatch" };
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
    // 同系列冲突：同一分类组（采矿/采气/冶炼/舰船/装备/增幅剂/考古/战斗）内同系列互斥；
    // 跨分类组可共存（如精密配给剂允许同时装在舰船与装备制造槽）。通用件仍按经验技能域互斥。
    for (const s of BOOSTER_SLOTS) {
      const e = active[s];
      if (!e || s === slot) continue;
      const existingItem = (typeof getBoosterItem === "function") ? getBoosterItem(e.itemId) : null;
      if (existingItem && !item.universal && !existingItem.universal && existingItem.series === item.series) {
        const newGroup = (typeof BOOSTER_SLOT_CATEGORY !== "undefined" && BOOSTER_SLOT_CATEGORY[slot]) || BOOSTER_SLOT_XP_SKILL[slot] || slot;
        const oldGroup = (typeof BOOSTER_SLOT_CATEGORY !== "undefined" && BOOSTER_SLOT_CATEGORY[s]) || BOOSTER_SLOT_XP_SKILL[s] || s;
        if (newGroup === oldGroup) return { changed:false, reason:"series-conflict" };
      }
      // 通用件（神经/技能超载）：同一经验技能域槽位只能装一个
      if (existingItem && existingItem.universal && item.universal && BOOSTER_SLOT_XP_SKILL[s] === BOOSTER_SLOT_XP_SKILL[slot]) return { changed:false, reason:"category-conflict" };
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
    if (typeof isBoosterCompatibleWithSlot === "function" && !isBoosterCompatibleWithSlot(item, slot)) return { changed:false, reason:"slot-mismatch" };
    if (typeof isBoosterCompatibleWithSlot !== "function" && !item.universal && item.slot !== slot) return { changed:false, reason:"slot-mismatch" };
    const active = state.boosters && state.boosters.active;
    if (!active) return { changed:false, reason:"no-state" };
    const existing = active[slot];
    if (!existing) return { changed:false, reason:"empty-slot" }; // 空槽用 equip
    if (existing.itemId === item.itemId) return { changed:false, reason:"already-equipped" };
    // 先校验新库存（原子拒绝），原槽完全不変
    const inv = ResourceRegistry.get(state, item.itemId);
    if (!(inv >= 1)) return { changed:false, reason:"insufficient-inventory" };
    // 同系列冲突：同一分类组（采矿/采气/冶炼/舰船/装备/增幅剂/考古/战斗）内同系列互斥；
    // 跨分类组可共存（如精密配给剂允许同时装在舰船与装备制造槽）。通用件仍按经验技能域互斥。
    for (const s of BOOSTER_SLOTS) {
      const e = active[s];
      if (!e || s === slot) continue;
      const existingItem = (typeof getBoosterItem === "function") ? getBoosterItem(e.itemId) : null;
      if (existingItem && !item.universal && !existingItem.universal && existingItem.series === item.series) {
        const newGroup = (typeof BOOSTER_SLOT_CATEGORY !== "undefined" && BOOSTER_SLOT_CATEGORY[slot]) || BOOSTER_SLOT_XP_SKILL[slot] || slot;
        const oldGroup = (typeof BOOSTER_SLOT_CATEGORY !== "undefined" && BOOSTER_SLOT_CATEGORY[s]) || BOOSTER_SLOT_XP_SKILL[s] || s;
        if (newGroup === oldGroup) return { changed:false, reason:"series-conflict" };
      }
      // 通用件（神经/技能超载）：同一经验技能域槽位只能装一个
      if (existingItem && existingItem.universal && item.universal && BOOSTER_SLOT_XP_SKILL[s] === BOOSTER_SLOT_XP_SKILL[slot]) return { changed:false, reason:"category-conflict" };
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
      // Batch R 返修：新 run 严格顺序——先刷新 runToken + runSequence（+1）并将 enemyInstanceSeq 归零，
      // 再把「传入编队」的敌人 ID 重新盖戳为新 runToken，杜绝 UI 预生成的旧 token 敌人误入新 run；
      // 编队构成（数量/类型）保留传入值（公共路由兼容），enemyInstanceSeq 从传入敌人最大序号续推。
      if (typeof resetCombatRunState === "function") resetCombatRunState(state.combat);
      // 新 run 开战前将玩家舰血量重置为满血：上一场（惨胜/战败）残留的受损 hp 不应带入新 run，
      // 否则会出现"显示满血但开战打一下直接被击败进维修"的错觉（显示层非战斗态统一显示满血，
      // 底层 combat.hp 却仍是旧残血）。维修态已由上方 display.recovery.active 拦截，此处仅初始化健康舰。
      const _maxHp = (typeof getCombatMaxHpFromState === "function") ? getCombatMaxHpFromState(state)
        : (state.combat.maxHp || { shield:0, armor:0, structure:0 });
      state.combat.hp = { ..._maxHp };
      const newToken = state.combat.runToken;
      let maxSeq = -1;
      const stamped = enemies.map((e) => {
        const m = (e && typeof e.id === "string" && e.id.indexOf("_e") >= 0) ? parseInt(e.id.split("_e")[1], 10) : NaN;
        if (Number.isFinite(m) && m > maxSeq) maxSeq = m;
        return Object.assign({}, e, { id: newToken + "_e" + (Number.isFinite(m) ? m : 0) });
      });
      state.combat.enemies = stamped;
      state.combat.currentEnemy = stamped[0] || null;
      state.combat.currentFormation = formationId || "";
      state.combat.enemyInstanceSeq = (maxSeq >= 0 ? maxSeq + 1 : stamped.length);
      state.combat.runWeaponTypes = [];
      state.combat.runWeaponTypesZone = state.combat.zone || null;
      state.combat.runDamageDealt = 0;
      state.combat.runDamageTaken = 0;
      state.combat.wave = 1;
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
    // M5：开战入口接线——把战前选择固化为本场小队成员（无选择时保持玩家单舰，零副作用）
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD &&
        typeof LEGION_COMBAT_SQUAD.startLegionSquadBattleWithMembers === "function") {
      LEGION_COMBAT_SQUAD.startLegionSquadBattleWithMembers(state, { now: now });
    }
    state._dirty = true;
    // 出击前补给预检（非阻断）：弹药/燃料提示由 getCombatSupplyWarning 统一计算。
    const supplyWarning = getCombatSupplyWarning(state, display.zone);
    return { changed:true, supplyWarning };
  },

  enterDeathspace(state, deathspaceId, enemies, formationId, now) {
    // Batch R：委托给共享原语 beginDeathspaceRun（校验/扣密钥/初始化/emit 统一收口）。
    let waveEnemies = enemies;
    let waveFormation = formationId;
    if (!Array.isArray(waveEnemies) || waveEnemies.length === 0) {
      const site = getDeathspaceById(deathspaceId);
      if (site) {
        const w = buildDeathspaceWave(site, 1, function () { return nextCombatRandom(state.combat); }, state.combat);
        waveEnemies = w.enemies;
        waveFormation = w.formationId;
      }
    }
    const res = beginDeathspaceRun(state, {
      deathspaceId,
      enemies: waveEnemies,
      formationId: waveFormation
    }, {
      now: (typeof now === "number" ? now : (typeof Date !== "undefined" ? Date.now() : 0)),
      emit: (typeof window !== "undefined" && window.GameEvents ? window.GameEvents.emit : (typeof GameEvents !== "undefined" ? GameEvents.emit : function () {})),
      offline:false
    });
    if (!res.changed) return { changed:false, reason:res.reason, ticketMaterial:res.ticketMaterial, requiredCL:res.requiredCL, remaining:res.remaining };
    return { changed:true, site:res.site, supplyWarning:res.supplyWarning };
  },

  // 连续挑战：消耗首枚密钥进入，并设定后续自动续跑次数（N-1）。
  // 每一轮全清后由 combatTick 的 pending 钩子自动进入下一轮，直到次数耗尽 / 密钥不足 / 战败 / 手动停。
  startDeathspaceChain(state, count, now) {
    if (state.combat.active) return { changed:false, reason:"already-active" };
    const requestedMode = state.combat.viewMode === "deathspace" ? "deathspace" : state.combat.viewMode === "belt" ? "belt" : state.combat.mode;
    const site = requestedMode === "deathspace" ? getDeathspaceById(state.combat.viewDeathspaceId || state.combat.deathspaceId) : null;
    if (!site) return { changed:false, reason:"no-deathspace-selected" };
    // Batch R：严格连刷次数校验——仅接受 typeof number + isFinite + isInteger + 范围 1–99。
    // 非法值：零副作用（不改 dirty / 密钥 / remaining / pending），直接拒绝。
    if (typeof count !== "number" || !Number.isFinite(count) || !Number.isInteger(count) || count < 1 || count > 99) {
      return { changed:false, reason:"invalid-chain-count" };
    }
    const n = count;
    state.combat.deathspaceChainRemaining = n - 1;
    state.combat.deathspaceChainPending = false;
    const wave = buildDeathspaceWave(site, 1, function () { return nextCombatRandom(state.combat); }, state.combat);
    const res = CombatStateActions.enterDeathspace(state, site.id, wave.enemies, wave.formationId, now);
    if (!res.changed) {
      state.combat.deathspaceChainRemaining = 0;
      state.combat.deathspaceChainPending = false;
      return { changed:false, reason:res.reason, ticketMaterial:res.ticketMaterial, requiredCL:res.requiredCL, remaining:res.remaining };
    }
    return { changed:true, site, remaining:state.combat.deathspaceChainRemaining, supplyWarning:res.supplyWarning };
  },

  cancelDeathspaceChain(state) {
    state.combat.deathspaceChainRemaining = 0;
    state.combat.deathspaceChainPending = false;
    state._dirty = true;
    return { changed:true };
  },

  stop(state, now) {
    // 玩家主动停止：即便当前处于维修中（combat 非活跃、无战斗行动），只要存在待恢复标记，
    // 也允许停止以取消"维修完成后自动出击"。这是策划要求（重创后可主动放弃自动返回）。
    const hasPendingResume = Boolean(state.resumeAfterRepair && state.resumeAfterRepair.type === "combat");
    if (!state.combat.active && !(state.currentAction.active && state.currentAction.skill === "combat") && !hasPendingResume) return { changed:false, reason:"not-active" };
    const maxHp = getCombatMaxHpFromState(state);
    const abandonedDeathspace = state.combat.mode === "deathspace";
    // 队列驱动的战斗停止时必须同步暂停队列；否则切页触发离线结算时，
    // settleOfflineActions 会因 isRunning=true 重新启动这场战斗。
    const queueWasRunning = Boolean(state.queue && state.queue.status && state.queue.status.isRunning);
    if (queueWasRunning) {
      state.queue.status.isRunning = false;
      state.queue.status.activeIndex = -1;
    }
    // M3：玩家主动停止战斗 → 清理小队临时状态并释放占用（NPC 修复状态保留在本体）
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && state.combat.squad && state.combat.squad.enabled) {
      LEGION_COMBAT_SQUAD.endLegionSquadBattle(state);
    }
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
      runDamageDealt:0, runDamageTaken:0,
      queueItemId:null, queueWavesTarget:0, queueWavesDone:0,
      queueEntriesTarget:0, queueEntriesDone:0
    });
    state.currentAction.batchRemaining = 0;
    state.resumeAfterRepair = null; // 玩家主动停止：取消待恢复（含维修中取消自动出击）
    state.combat.deathspaceChainRemaining = 0; // 手动停止战斗：连刷链一并取消
    state.combat.deathspaceChainPending = false;
    state._dirty = true;
    return { changed:true, abandonedDeathspace, cancelledResume:hasPendingResume };
  },

  beginRecovery(state, now) {
    const activeShip = getActiveCombatShipState(state);
    const failedDeathspace = state.combat.mode === "deathspace";
    // M3：玩家舰船被击毁 → 清理小队临时状态、释放占用；NPC 的 destroyed/repairUntil/combatHp 保留在本体
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && state.combat.squad && state.combat.squad.enabled) {
      LEGION_COMBAT_SQUAD.endLegionSquadBattle(state);
    }
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
    // 队列感知：若当前是队列驱动的战斗，把队列进度带入续战标记（跨维修保留）。
    // 死亡空间队列项：战败即计 1 次入场（queueEntriesDone+1），修好重入下一入场。
    const qActive = Boolean(state.combat.queueItemId);
    const qDs = qActive && state.combat.queueEntriesTarget > 0 && state.combat.mode === "deathspace";
    // 只有队列驱动的出击才允许维修完成后自动续战。
    // 手动出击失败后不应留下“续战”意图，否则玩家清空队列后仍会被重新拉回战斗。
    state.resumeAfterRepair = qActive ? {
      type:"combat",
      returnZoneId,
      defeatedMode:failedDeathspace ? "deathspace" : "belt",
      deathspaceId:failedDeathspaceId,
      shipInstanceId:destroyedShipId,
      queueItemId: qActive ? state.combat.queueItemId : null,
      queueWavesTarget: qActive ? state.combat.queueWavesTarget : 0,
      queueWavesDone: qActive ? state.combat.queueWavesDone : 0,
      queueEntriesTarget: qActive ? state.combat.queueEntriesTarget : 0,
      queueEntriesDone: qActive ? (state.combat.queueEntriesDone + (qDs ? 1 : 0)) : 0
    } : null;
    Object.assign(state.combat, {
      active:false,
      enemies:[],
      currentEnemy:null,
      wave:1,
      totalKills:0,
      runEliteKills:0,
      currentFormation:"",
      lastEnemyVolley:null,
      deathspaceChainRemaining:0,
      deathspaceChainPending:false,
      lastStatus:failedDeathspace
        ? "攻略失败，密钥不返还；维修完成后返回来源星带。"
        : "本轮肃清失败，维修完成后返回该星带。"
    });
    // 问题2：per-ship 维修——维修状态写入 combat.repairs[destroyedShipId]，不再使用全局 repairUntil。
    // 换舰/出击均不触碰其他舰的维修条目（beginShipRepair 只写被击毁这艘）。
    beginShipRepair(state, destroyedShipId, now + 180000);
    state._dirty = true;
    return { changed:true, repairShipId:destroyedShipId, repairUntilTs:now + 180000, failedDeathspace, returnZoneId };
  },

  finishRecovery(state, now) {
    // 问题2：per-ship 维修——仅结束「当前 active 战斗舰」的维修，并恢复其满血。
    // 与 beginRecovery 保持一致：优先 combat.activeShip，缺失时回退到 shipAssignments.combat / 首舰。
    const _activeShip = getActiveCombatShipState(state);
    const activeId = state.combat.activeShip || (_activeShip && _activeShip.instance && _activeShip.instance.instanceId) || null;
    const repairUntil = getShipRepairUntil(state, activeId);
    if (!repairUntil || now < repairUntil) return { changed:false, reason:"not-due" };
    const maxHp = getCombatMaxHpFromState(state);
    state.combat.hp = { ...maxHp };
    state.combat.maxHp = { ...maxHp };
    finishShipRepair(state, activeId);
    // 维修完成：战斗上下文回到普通星带（死亡空间永不续跑、密钥不返还，见 beginRecovery 约定）
    state.combat.mode = "belt";
    state.combat.viewMode = "belt";
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
    if (item.equipEngInputLevel !== undefined) config.equipEngInputLevel = item.equipEngInputLevel;
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
  if (config.equipEngInputLevel !== undefined) action.equipEngInputLevel = config.equipEngInputLevel;
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
  if (getEffectiveSkillLevel(state, "archaeology") < site.level) return { ok:false, reason:"level-locked" };
  // 按舰船实例隔离的维修态：仅当前编入的考古舰实例维修中会阻断启动（不再使用全局 repairUntil）。
  const archInstanceId = state.shipAssignments && state.shipAssignments.archaeology;
  const archRepair = (arch.repairsByInstanceId && archInstanceId) ? arch.repairsByInstanceId[archInstanceId] : null;
  if (archRepair && Number(archRepair.until) > now) return { ok:false, reason:"repairing" };
  if (arch.interferenceUntil > now) return { ok:false, reason:"interference" };
  const instanceId = state.shipAssignments && state.shipAssignments.archaeology;
  const instance = instanceId ? getShipInstanceFromState(state, instanceId) : null;
  const config = instance ? getShipConfigById(instance.shipId) : null;
  // 考古判据统一为「能力优先」（与 selectors.js / archaeology.js 一致）：有考古扫描能力即可。
  if (!config || !config.bonuses || !((config.bonuses.archaeologyScanStrength || 0) > 0)) return { ok:false, reason:"no-archaeology-ship" };
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

  // 战斗并入队列：combat 技能项由队列 runner 特判（初始化 belt/deathspace 并写队列进度）。
  if (skill === "combat") return startCombatQueueItem(state, item, now);

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

  // 常规技能：采矿/冶炼/采气/制造等。
  // 修复：若战斗仍在进行（combat.active），启动其他 action 前必须先干净停止战斗，
  //       否则 currentAction.skill 被改走后 combatTick 不再被驱动，但 combat.active 残留
  //       → 战斗冻结在最后一帧（需手动点「停止战斗」才能收尾）。combat/start 会正确接管
  //       currentAction，这里对称地让其他 action 启动时收尾战斗。
  if (state.combat && state.combat.active) {
    const maxHp = getCombatMaxHpFromState(state);
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
      lastStatus:"已切换至其他作业，战斗停止",
      lastEnemyVolley:null,
      runWeaponTypes:[],
      runWeaponTypesZone:null,
      runDamageDealt:0, runDamageTaken:0
    });
    state.resumeAfterRepair = null;
  }
  applyQueueConfigToState(state, getQueueItemConfigForState(item), now);
  state._dirty = true;
  return { changed:true, skill:state.currentAction.skill };
}

// ============================================================================
// 战斗并入队列：队列 runner 特判入口 + 续战标记 + 完成终结
// ============================================================================
function startCombatQueueItem(state, item, now) {
  const ds = (typeof DEATHSPACE_DATABASE !== "undefined") && DEATHSPACE_DATABASE.find(s => s.id === item.target);
  const isDeathspace = Boolean(ds);
  const countNum = item.count === -1 ? Infinity : (Number(item.count) || 1);
  // 写入战斗队列进度字段（随 combat 状态存档、跨维修保留）
  state.combat.queueItemId = item.id;
  state.combat.queueWavesTarget = isDeathspace ? 0 : countNum;
  state.combat.queueWavesDone = 0;
  state.combat.queueEntriesTarget = isDeathspace ? countNum : 0;
  state.combat.queueEntriesDone = 0;
  if (isDeathspace) {
    // 队列启动死亡空间时显式写入目标站点（与战斗区对称，避免续战沿用上一场残留 combat.deathspaceId）
    state.combat.deathspaceId = ds.id;
    const wave = (typeof buildDeathspaceWave === "function")
      ? buildDeathspaceWave(ds, 1, function () { return Math.random(); }, state.combat)
      : { enemies:[], formationId:"" };
    const res = CombatStateActions.enterDeathspace(state, ds.id, wave.enemies, wave.formationId, now);
    if (!res || !res.changed) {
      // 校验失败（密钥/等级/维修中）：清队列字段、记为失败跳过
      state.combat.queueItemId = null; state.combat.queueWavesTarget = 0; state.combat.queueWavesDone = 0;
      state.combat.queueEntriesTarget = 0; state.combat.queueEntriesDone = 0;
      return { changed:false, reason: res && res.reason ? res.reason : "enter-failed" };
    }
    setCombatQueueResume(state);
    return { changed:true, skill:"combat" };
  }
  const zone = (typeof COMBAT_ZONES !== "undefined") && COMBAT_ZONES.find(z => z.id === item.target);
  if (!zone) {
    state.combat.queueItemId = null; state.combat.queueWavesTarget = 0; state.combat.queueWavesDone = 0;
    return { changed:false, reason:"no-zone" };
  }
  // 队列启动战斗时显式写入目标星带（避免续战沿用上一场残留 c.zone，导致 combat→combat 打错星带）
  state.combat.zone = zone.id;
  const wave = (typeof buildCombatWave === "function")
    ? buildCombatWave(zone, 1, function () { return Math.random(); }, state.combat)
    : { enemies:[], formationId:"" };
  const res = CombatStateActions.start(state, wave.enemies, wave.formationId, now);
  if (!res || !res.changed) {
    state.combat.queueItemId = null; state.combat.queueWavesTarget = 0; state.combat.queueWavesDone = 0;
    return { changed:false, reason: res && res.reason ? res.reason : "start-failed" };
  }
  // 普通星带队列出击：登记教程 sortie token（与手动 combat/start 共用同一 run-token 生命周期）。
  // 死亡空间队列项不登记（非 C6 目标星带；其离线 runsDetail.sortieToken 留空，不会误完成 C6）。
  registerTutorialCombatStart(state, now);
  setCombatQueueResume(state);
  return { changed:true, skill:"combat" };
}

// 写/刷新「队列感知续战标记」：维修完成后由 updateCombatRecovery 据此重入战斗。
// 全部读取 state.combat 已恢复的队列字段；死亡空间项才带 deathspaceId 供重入。
function setCombatQueueResume(state) {
  const c = state.combat;
  if (!c.queueItemId) { state.resumeAfterRepair = null; return; }
  state.resumeAfterRepair = {
    type:"combat",
    queueItemId: c.queueItemId,
    queueWavesTarget: c.queueWavesTarget || 0,
    queueWavesDone: c.queueWavesDone || 0,
    queueEntriesTarget: c.queueEntriesTarget || 0,
    queueEntriesDone: c.queueEntriesDone || 0,
    deathspaceId: (c.queueEntriesTarget > 0 && c.mode === "deathspace") ? (c.deathspaceId || null) : null,
    returnZoneId: c.zone || "angel_outpost",
    defeatedMode: (c.mode === "deathspace") ? "deathspace" : "belt",
    shipInstanceId: c.activeShip
  };
}

// 战斗队列项达标终结：关闭战斗、清字段、推进队列到下一项（与普通队列项推进逻辑一致）。
function finalizeCombatQueueItem(state, now) {
  const c = state.combat;
  const queue = state.queue;
  c.active = false;
  state.currentAction.active = false;
  c.queueItemId = null; c.queueWavesTarget = 0; c.queueWavesDone = 0;
  c.queueEntriesTarget = 0; c.queueEntriesDone = 0;
  c.deathspaceChainRemaining = 0; c.deathspaceChainPending = false; // 清残留连刷链，避免污染后续作业
  state.resumeAfterRepair = null;
  if (queue.status.isRunning && queue.status.activeIndex >= 0 && queue.status.activeIndex < queue.items.length) {
    queue.items.splice(queue.status.activeIndex, 1);
  }
  if (queue.items.length) {
    queue.status.activeIndex = Math.max(0, Math.min(queue.status.activeIndex, queue.items.length - 1));
    const next = queue.items[queue.status.activeIndex];
    const r = executeQueueItemForState(state, next, now);
    if (!r.changed && !r.skill) {
      queue.status.isRunning = false; queue.status.activeIndex = -1;
    }
  } else {
    queue.status.isRunning = false; queue.status.activeIndex = -1;
    state.currentAction.active = false; state.currentAction.batchRemaining = 0;
  }
  state._dirty = true;
  return { changed:true };
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
    // 问题2：per-ship 维修——仅当被操作的这艘舰自身在维修时拒绝指派，健康舰可正常换入。
    const isRepairingThis = isShipUnderRepair(state, instanceId, now);
    const restriction = getShipAssignmentRestriction(config, actionKey, actionKey === "combat" && isRepairingThis, instance, state);
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
    // 问题2/清理：战斗舰指派被玩家主动改动（换入/撤出），取消"维修完成后自动出击"待恢复标记。
    if (actionKey === "combat" && state.resumeAfterRepair && state.resumeAfterRepair.type === "combat") state.resumeAfterRepair = null;
    state._dirty = true;
    return { changed:true, assigned:!removing, instance };
  },

  equipCombatShip(state, instanceId, now) {
    const instance = getShipInstanceFromState(state, instanceId);
    if (!instance) return { changed:false, reason:"unknown-ship" };
    // 问题2：per-ship 维修——仅当被操作的这艘舰自身在维修时拒绝装备，健康舰可正常换入。
    if (state.combat && isShipUnderRepair(state, instanceId, now)) return { changed:false, reason:"repairing" };
    const config = getShipConfigById(instance.shipId);
    if (!config) return { changed:false, reason:"unknown-ship" };
    // 已绑定军团 NPC 的舰船不可作为玩家战斗舰（与 toggleShipAssignment 共用守护）。
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && LEGION_COMBAT_SQUAD.findLegionNpcByBoundShip) {
      if (LEGION_COMBAT_SQUAD.findLegionNpcByBoundShip(state, instanceId)) return { changed:false, reason:"npc-bound" };
    }
    if (!state.shipAssignments) state.shipAssignments = {};
    const activeSkill = state.currentAction && state.currentAction.active ? state.currentAction.skill : null;
    if (activeSkill && state.shipAssignments[activeSkill] === instance.instanceId && activeSkill !== "combat") return { changed:false, reason:"ship-active" };
    for (const [assignedAction, assignedId] of Object.entries(state.shipAssignments)) {
      if (assignedId === instance.instanceId && assignedAction !== "combat") delete state.shipAssignments[assignedAction];
    }
    state.shipAssignments.combat = instance.instanceId;
    state.combat.activeShip = instance.instanceId;
    // 问题2/清理：玩家主动换入新的战斗舰（健康舰），取消"维修完成后自动出击"待恢复标记，
    // 与 combat/start（手动出击，actions.js:534）语义一致——接管战斗舰即放弃自动恢复，
    // 避免战斗面板长期显示"完成后返回战斗"误导。
    if (state.resumeAfterRepair && state.resumeAfterRepair.type === "combat") state.resumeAfterRepair = null;
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
    // 舰船强化新增星币消耗（后期可持续星币 sink）；不足则拒绝，不扣任何材料。
    const iskCost = getShipEnhancementIskCost(config);
    if (iskCost > 0 && ResourceRegistry.get(state, "currency:isk") < iskCost) {
      return { changed:false, reason:"insufficient-isk" };
    }
    for (const [id, quantity] of Object.entries(cost)) ResourceRegistry.spend(state, "component:" + id, quantity);
    if (iskCost > 0) ResourceRegistry.spend(state, "currency:isk", iskCost);

    const fromLevel = normalizeShipEnhancementLevel(instance.enhancementLevel);
    const skillLevel = getEffectiveSkillLevel(state, "shipEngineering");
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
      componentsSpent:Object.values(cost).reduce((sum, quantity) => sum + quantity, 0),
      iskSpent:iskCost
    }, { offline:false, source:"ship-enhancement" });
    return { changed:true, instance, config, fromLevel, toLevel, chance, roll, success, xp, cost, iskCost };
  },

  // Batch R（E 项·舰船拆解）：只读报价已由 selector 展示；此处执行拆解。
  // 拒绝：未知 / 已分配 / 执行中 / 维修中 / 带装备或 rig（与 selector 共用 getShipDismantleBlockReason）。
  // 归还 = getShipDismantleQuote（每项 floor(总量×回收率)），按 refId 精确入账；
  // 不归还蓝图 / XP / 强化等级 / 装备（装备经 has-fitting 拒绝后天然不残留）。
  disassembleShip(state, instanceId, now) {
    const instance = getShipInstanceFromState(state, instanceId);
    if (!instance) return { changed:false, reason:"unknown-ship" };
    const config = getShipConfigById(instance.shipId);
    if (!config) return { changed:false, reason:"unknown-ship" };
    const actionTime = Number(now) || Date.now();
    const blocked = getShipDismantleBlockReason(state, instance, actionTime);
    if (blocked) return { changed:false, reason:blocked };
    const recipe = SHIP_ASSEMBLY_RECIPES.find(item => item.shipId === instance.shipId) || null;
    if (!recipe) return { changed:false, reason:"no-dismantle-recipe" };
    const preview = getShipDismantleQuote(recipe, config, instance.enhancementLevel, getReclaimRate(state));
    // 归还材料（quote 条目已过滤 returned<=0；refId 为空则跳过该条目，避免无锚点材料丢失）。
    // refundedResources 以 canonical ref（资源权威键）→ 实际归还数量映射，与真实入账严格一致。
    const refundedResources = {};
    for (const entry of preview) {
      if (entry.refId) {
        ResourceRegistry.add(state, entry.refId, entry.returned);
        refundedResources[entry.refId] = (refundedResources[entry.refId] || 0) + entry.returned;
      }
    }
    // 移除舰船实例
    const index = state.inventory.ships.indexOf(instance);
    if (index >= 0) state.inventory.ships.splice(index, 1);
    // 清理实例级残留（防御性：正常路径 has-fitting/assigned/active/repairing 已保证无引用）
    finishShipRepair(state, instanceId);
    if (state.archaeology) {
      if (state.archaeology.shipHp && Object.prototype.hasOwnProperty.call(state.archaeology.shipHp, instanceId)) {
        delete state.archaeology.shipHp[instanceId];
      }
      if (state.archaeology.repairsByInstanceId && Object.prototype.hasOwnProperty.call(state.archaeology.repairsByInstanceId, instanceId)) {
        delete state.archaeology.repairsByInstanceId[instanceId];
      }
    }
    if (state.resumeAfterRepair && state.resumeAfterRepair.instanceId === instanceId) state.resumeAfterRepair = null;
    state._dirty = true;
    if (typeof GameEvents !== "undefined") {
      GameEvents.emit("ship:disassembled", {
        shipId:instance.shipId,
        instanceId:instance.instanceId,
        returnedCount:preview.length,
        refundedResources
      }, { offline:false, source:"ship-dismantle" });
    }
    return { changed:true, instance, config, returned:preview };
  },

  /* ---- Batch S·装备管理：物品丢弃（无返还，已装载不可丢） ---- */
  discardEquipment(state, targetRef, now) {
    const resolved = resolveEquipmentReference(state, targetRef);
    if (!resolved) return { changed:false, reason:"unknown-equipment" };
    if (resolved.instance && resolved.instance.installedOn) return { changed:false, reason:"equipment-installed" };
    const itemId = resolved.itemId;
    if (resolved.instance) {
      const idx = state.equipment.instances.findIndex(i => i.instanceId === resolved.instance.instanceId);
      if (idx < 0) return { changed:false, reason:"unknown-equipment" };
      state.equipment.instances.splice(idx, 1);
    } else {
      const idx = state.equipment.inventory.indexOf(itemId);
      if (idx < 0) return { changed:false, reason:"unknown-equipment" };
      state.equipment.inventory.splice(idx, 1);
    }
    state._dirty = true;
    if (typeof GameEvents !== "undefined" && typeof GameEvents.emit === "function") {
      GameEvents.emit("equipment:discarded", {
        itemId,
        instanceId: resolved.instance ? resolved.instance.instanceId : null
      }, { offline:false, source:"equipment-discard" });
    }
    return { changed:true, itemId };
  },

  /* ---- Batch S·装备管理：装备拆解（按冶炼回收率返还材料 + 整件逐件按回收率掷骰；isk 不返还） ---- */
  dismantleEquipment(state, targetRef, now) {
    const resolved = resolveEquipmentReference(state, targetRef);
    if (!resolved) return { changed:false, reason:"unknown-equipment" };
    if (resolved.instance && resolved.instance.installedOn) return { changed:false, reason:"equipment-installed" };
    const itemId = resolved.itemId;
    const eqDef = resolved.definition;
    const level = resolved.enhancementLevel;
    const reclaimRate = getReclaimRate(state);
    const quote = getEquipmentDismantleQuote(eqDef, level, reclaimRate);
    const refundedResources = {};
    for (const entry of quote.materials) {
      if (entry.refId) {
        ResourceRegistry.add(state, entry.refId, entry.returned);
        refundedResources[entry.refId] = (refundedResources[entry.refId] || 0) + entry.returned;
      }
    }
    const returnedItems = [];
    for (const wi of quote.wholeItems) {
      if (Math.random() < reclaimRate) {
        if (wi.type === "sameType") {
          if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
          state.equipment.inventory.push(wi.id);
          returnedItems.push({ type:wi.type, id:wi.id });
        } else {
          // core / protocol 为材料（按名解析权威 refId）
          const refId = (typeof ResourceRegistry !== "undefined" && typeof ResourceRegistry.resolveMaterialIds === "function")
            ? (ResourceRegistry.resolveMaterialIds(wi.id)[0] || null) : null;
          if (refId) {
            ResourceRegistry.add(state, refId, 1);
            returnedItems.push({ type:wi.type, id:wi.id, refId });
          }
        }
      }
    }
    if (resolved.instance) {
      const idx = state.equipment.instances.findIndex(i => i.instanceId === resolved.instance.instanceId);
      if (idx >= 0) state.equipment.instances.splice(idx, 1);
    } else {
      const idx = state.equipment.inventory.indexOf(itemId);
      if (idx >= 0) state.equipment.inventory.splice(idx, 1);
    }
    state._dirty = true;
    if (typeof GameEvents !== "undefined" && typeof GameEvents.emit === "function") {
      GameEvents.emit("equipment:dismantled", {
        itemId,
        instanceId: resolved.instance ? resolved.instance.instanceId : null,
        refundedResources,
        returnedItems
      }, { offline:false, source:"equipment-dismantle" });
    }
    return { changed:true, itemId, returned:quote.materials, returnedItems };
  },

  /* ---- Batch S·舰船工程·部件车间：组件拆解（按冶炼回收率归还 cost 材料；组件无强化、无整件耗材） ---- */
  dismantleComponent(state, componentId, now) {
    if (!componentId) return { changed:false, reason:"unknown-component" };
    const key = "component:" + componentId;
    if (ResourceRegistry.get(state, key) < 1) return { changed:false, reason:"no-component" };
    const reclaimRate = getReclaimRate(state);
    const quote = getComponentDismantleQuote(componentId, reclaimRate);
    ResourceRegistry.spend(state, key, 1);
    const refundedResources = {};
    for (const entry of quote) {
      if (entry.refId) {
        ResourceRegistry.add(state, entry.refId, entry.returned);
        refundedResources[entry.refId] = (refundedResources[entry.refId] || 0) + entry.returned;
      }
    }
    state._dirty = true;
    if (typeof GameEvents !== "undefined" && typeof GameEvents.emit === "function") {
      GameEvents.emit("component:dismantled", { componentId, refundedResources }, { offline:false, source:"component-dismantle" });
    }
    return { changed:true, componentId, returned:quote };
  },

  setDiscardConfirmation(state, enabled) {
    ensureUserSettingsState(state).confirmDiscard = Boolean(enabled);
    state._dirty = true;
    return { changed:true, enabled:Boolean(enabled) };
  },

  setDismantleConfirmation(state, enabled) {
    ensureUserSettingsState(state).confirmDismantle = Boolean(enabled);
    state._dirty = true;
    return { changed:true, enabled:Boolean(enabled) };
  },

  setFittingSlot(state, instanceId, slot, slotIndex, equipmentRef) {
    const instance = getShipInstanceFromState(state, instanceId);
    const config = instance ? getShipConfigById(instance.shipId) : null;
    if (!instance || !config || !["high", "mid", "low", "rig"].includes(slot)) return { changed:false, reason:"invalid-slot" };
    // 新增：已绑定军团 NPC 的舰船禁止在船坞装配/改装（避免误改 NPC 战斗配装）。须先在军团内卸下。
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && LEGION_COMBAT_SQUAD.findLegionNpcByBoundShip) {
      if (LEGION_COMBAT_SQUAD.findLegionNpcByBoundShip(state, instanceId)) return { changed:false, reason:"npc-bound" };
    }
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
      // 改装件：记录装配顺序序号（rigSeq），供谐振（堆叠）惩罚按装配先后排序。同系列允许重复装配。
      if (slot === "rig") { state._rigSeq = (state._rigSeq || 0) + 1; targetInstance.rigSeq = state._rigSeq; }
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
    // 新增：已绑定军团 NPC 的舰船禁止在船坞重置配装
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD && LEGION_COMBAT_SQUAD.findLegionNpcByBoundShip) {
      if (LEGION_COMBAT_SQUAD.findLegionNpcByBoundShip(state, instanceId)) return { changed:false, reason:"npc-bound" };
    }
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
    if (last && last.skill === item.skill && last.target === item.target && (last.equipEngInputLevel || 0) === (item.equipEngInputLevel || 0)) {
      last.count = last.count === -1 || count === -1 ? -1 : (Number(last.count) || 1) + count;
      if (queue.status.isRunning && queue.status.activeIndex === queue.items.length - 1) state.currentAction.batchRemaining = last.count;
      state._dirty = true;
      return { changed:true, merged:true, item:last };
    }
    const queueItem = { id:"q_" + now + "_" + queue.items.length, skill:item.skill, target:item.target, label:item.label || item.target, count };
    if (item.equipEngInputLevel !== undefined) queueItem.equipEngInputLevel = item.equipEngInputLevel;
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
    const origActive = queue.status.activeIndex;
    const item = items.splice(from, 1)[0]; items.splice(to, 0, item);
    if (origActive === from) queue.status.activeIndex = to;
    else if (from < origActive && to >= origActive) queue.status.activeIndex--;
    else if (from > origActive && to <= origActive) queue.status.activeIndex++;
    state._dirty = true;
    // 自动开始：运行中将一个「待执行/正在执行」的项顶到队列最前（index 0），
    // 若该顶位项并非当前激活项，则立即顶替开始（与「置顶」按钮行为保持一致）。
    // 已完成的项（from < origActive）顶到头部不触发，避免重跑已结束的行动。
    const running = queue.status.isRunning && origActive >= 0;
    if (running && to === 0 && from >= origActive && queue.status.activeIndex !== 0) {
      queue.status.activeIndex = 0;
      executeQueueItemForState(state, items[0], Date.now());
    }
    return { changed:true };
  },

  queueMoveToTop(state, from) {
    const queue = state.queue, items = queue.items;
    if (from < 0 || from >= items.length) return { changed:false, reason:"invalid-index" };
    if (from === 0) return { changed:false, reason:"already-top" };
    // 真正的置顶：移动到列表最前（index 0），而非紧贴当前行动之后（旧逻辑会落到第二位）。
    const item = items.splice(from, 1)[0];
    items.unshift(item);
    const running = queue.status.isRunning && queue.status.activeIndex >= 0;
    if (running) {
      // 运行中：顶替当前正在执行的行动，立即从顶部开始新行动。
      // 当前行动被推后到队列中，其进行中的一轮作废（引擎只按 count 推进，不存分项进度）。
      queue.status.activeIndex = 0;
      executeQueueItemForState(state, items[0], Date.now());
    } else {
      // 空闲：仅置顶，待用户启动队列时从顶部开始。
      queue.status.activeIndex = -1;
    }
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
    // 队列停止/删除时连带拆除战斗续战态：否则 combat.active / resumeAfterRepair /
    // deathspaceChainRemaining 残留，会导致修好后自动重开、删队列仍继续。
    // 与 stopCombat / finalizeCombatQueueItem 对齐；非战斗队列项调用时这些字段清零为幂等无副作用。
    if (state.combat) {
      state.combat.active = false;
      state.combat.deathspaceChainRemaining = 0;
      state.combat.deathspaceChainPending = false;
      state.resumeAfterRepair = null;
    }
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

// 从装配槽移除一个装备引用：
// · +0 白板实例 → 删除实例并退回 inventory（可被制造/再次安装）
// · 强化实例（enhancementLevel>0）→ 保留实例，仅置 installedOn=null（强化等级不丢失）
// · 旧式字符串引用 → 退回 inventory
function detachEquipmentRefFromFitting(state, ref) {
  if (!state.equipment) state.equipment = { inventory:[], instances:[], nextInstanceId:1 };
  if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
  if (!Array.isArray(state.equipment.instances)) state.equipment.instances = [];
  const instance = isEquipmentInstanceId(state, ref) ? getEquipmentInstanceById(state, ref) : null;
  if (instance) {
    const level = Math.max(0, Math.floor(Number(instance.enhancementLevel) || 0));
    if (level === 0) {
      const idx = state.equipment.instances.indexOf(instance);
      if (idx >= 0) state.equipment.instances.splice(idx, 1);
      state.equipment.inventory.push(instance.itemId);
    } else {
      instance.installedOn = null;
    }
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

  const engLevel = getEffectiveSkillLevel(state, "equipmentEngineering");
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
    // 产线白名单：装备自动线仅允许消耗品类（燃料/弹药/探针），可装配装备不可选为生产目标
    if (lineId === "equipment" && EQUIPMENT_AUTO_LINE_CATEGORIES.indexOf(recipe.category) === -1) {
      return { changed:false, reason:"target-not-allowed" };
    }
    // 蓝图限制：equipment / booster 自动线需对应蓝图（与装备工程页一致，防止绕过）
    // 探针类走限次抄本 BPC（要求剩余流程 > 0），见 manufacturingRecipeHasBlueprint。
    if ((lineId === "equipment" || lineId === "booster") && recipe.requiresBlueprint === true) {
      const hasBp = (lineId === "equipment")
        ? manufacturingRecipeHasBlueprint(state, recipe)
        : hasBoosterBlueprintFromState(state, recipe.id);
      if (!hasBp) return { changed:false, reason:"blueprint-locked" };
    }
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

    // 产线白名单：装备自动线仅允许消耗品类（燃料/弹药/探针），可装配装备不可启动
    if (lineId === "equipment" && EQUIPMENT_AUTO_LINE_CATEGORIES.indexOf(recipe.category) === -1) {
      return { changed:false, reason:"target-not-allowed" };
    }

    // 蓝图限制：equipment / booster 自动线需对应蓝图（与装备工程页一致，防止绕过）
    // 探针类走限次抄本 BPC（要求剩余流程 > 0），见 manufacturingRecipeHasBlueprint。
    if ((lineId === "equipment" || lineId === "booster") && recipe.requiresBlueprint === true) {
      const hasBp = (lineId === "equipment")
        ? manufacturingRecipeHasBlueprint(state, recipe)
        : hasBoosterBlueprintFromState(state, recipe.id);
      if (!hasBp) return { changed:false, reason:"blueprint-locked" };
    }

    // 检查配方等级门槛（装备自动线含配给剂激活期间的 +N 门槛）
    const eeLvl = (lineId === "equipment") ? getEffectiveSkillLevel(state, "equipmentEngineering") : 99;
    const bLvl = (lineId === "booster") ? getEffectiveSkillLevel(state, "boosterEngineering") : 99;
    const sLvl = (lineId === "smelting") ? getEffectiveSkillLevel(state, "refining") : 99;
    const eqGate = (lineId === "equipment") ? ((typeof getEquipEngBuildingQuote === "function") ? getEquipEngBuildingQuote(state, recipe).levelGate : (Number(recipe.level) || 0)) : 99;
    const levelCheck = (lineId === "equipment") ? (eeLvl < eqGate) : (lineId === "booster") ? (bLvl < recipe.level) : (lineId === "smelting") ? (sLvl < recipe.level) : false;
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
    line.producedQty = 0;
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

  // 设置自动线生产数量（targetQuantity）：0/≤0/空 = 无限（旧行为，消耗全部原料）。
  // 正整数 = 本次目标产量（按产出物件数），达到后自动停止。运行中若已达标新目标则立即停。
  setAutoLineQuantity(state, lineId, quantity) {
    if (!AUTO_LINE_IDS.includes(lineId)) return { changed:false, reason:"unknown-line" };
    const s = state.station;
    if (!s || !s.autoLines || !s.autoLines[lineId]) return { changed:false, reason:"no-state" };
    const line = s.autoLines[lineId];
    const q = Number(quantity);
    const target = (Number.isFinite(q) && q >= 1) ? Math.floor(q) : 0; // 0 = 无限
    line.targetQuantity = target;
    // 运行中且已达标新目标：立即停（避免继续生产）
    if (line.enabled && !line.stoppedReason && target > 0 && (line.producedQty || 0) >= target) {
      line.enabled = false;
      line.stoppedReason = "target-reached";
      if (typeof GameEvents !== "undefined") {
        GameEvents.emit("station:autoLineStopped", {
          lineId, targetId:line.startedTargetId, reason:"target-reached",
          quantity:line.producedQty, xp:0, offline:false
        }, { source:"station", offline:false });
      }
    }
    state._dirty = true;
    return { changed:true, lineId, targetQuantity:target };
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
    enqueueCascade(state, techId,  targetLevel, now) {
      const RS = getResearchSystemRef();
      if (!RS || typeof RS.enqueueResearchCascade !== "function") return { changed: false, reason: "not-available" };
      return researchActionResult(RS.enqueueResearchCascade(state, techId, targetLevel, now));
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
    },
    startQueued(state, stepKey, now) {
      const RS = getResearchSystemRef();
      if (!RS || typeof RS.startQueuedResearch !== "function") return { changed: false, reason: "not-available" };
      return researchActionResult(RS.startQueuedResearch(state, stepKey, now));
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

  // 单一"成功开始战斗后登记教程 sortie"入口：手动 combat/start 与普通星带队列 startCombatQueueItem 共用。
  // 复用 TutorialSystem.noteTutorialActionResult（与 dispatchGameAction 的 tutorialNote 同源），
  // 严禁在 queue.js/actions.js 复制第二套 combatRunSequence / activeCombatRunToken 生成逻辑。
  // 一次真实出击只生成一个 token：仅在战斗真实成功启动（changed）时调用一次，绝不逐波/逐 tick 重复调用。
  function registerTutorialCombatStart(state, now) {
    const TS = (typeof TutorialSystem !== "undefined" && TutorialSystem)
      ? TutorialSystem
      : (typeof window !== "undefined" && window.TutorialSystem ? window.TutorialSystem : null);
    if (TS && typeof TS.noteTutorialActionResult === "function") {
      try { TS.noteTutorialActionResult(state, { type: "combat/start" }, { changed: true }, now); } catch (e) { /* 新手任务旁路失败不影响主流程 */ }
    }
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
  if (action.type === "manufacturing/buyBlueprint") return ManufacturingStateActions.buyBlueprint(state, action.blueprintId, actionTime, action.quantity);
  if (action.type === "manufacturing/selectShipComponent") return ManufacturingStateActions.selectShipComponent(state, action.componentId);
  if (action.type === "manufacturing/selectShipAssembly") return ManufacturingStateActions.selectShipAssembly(state, action.recipeId);
  if (action.type === "manufacturing/selectShipEngSubView") return ManufacturingStateActions.selectShipEngSubView(state, action.view);
  if (action.type === "manufacturing/selectShipCompClass") return ManufacturingStateActions.selectShipCompClass(state, action.cls);
  if (action.type === "manufacturing/selectShipAsmLine") return ManufacturingStateActions.selectShipAsmLine(state, action.line);
  if (action.type === "manufacturing/selectShipAsmPage") return ManufacturingStateActions.selectShipAsmPage(state, action.page);
  if (action.type === "manufacturing/startShipComponent") return ManufacturingStateActions.startShipComponent(state, actionTime);
  if (action.type === "manufacturing/startShipAssembly") return ManufacturingStateActions.startShipAssembly(state, actionTime);
  if (action.type === "manufacturing/selectEquipmentCategory") return ManufacturingStateActions.selectEquipmentCategory(state, action.categoryId);
  if (action.type === "manufacturing/selectEquipmentRecipe") return ManufacturingStateActions.selectEquipmentRecipe(state, action.recipeId);
  if (action.type === "manufacturing/selectEquipEngRigFilter") return ManufacturingStateActions.selectEquipEngRigFilter(state, action);
  if (action.type === "manufacturing/selectEquipEngSubTab") return ManufacturingStateActions.selectEquipEngSubTab(state, action);
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
  if (action.type === "combat/start") {
    const res = CombatStateActions.start(state, action.enemies, action.formationId, actionTime);
    if (res && res.changed) registerTutorialCombatStart(state, actionTime);
    return res;
  }
  if (action.type === "combat/enterDeathspace") return CombatStateActions.enterDeathspace(state, action.deathspaceId, action.enemies, action.formationId, actionTime);
  if (action.type === "combat/startDeathspaceChain") return CombatStateActions.startDeathspaceChain(state, action.count, actionTime);
  if (action.type === "combat/cancelDeathspaceChain") return CombatStateActions.cancelDeathspaceChain(state);
  if (action.type === "combat/stop") return tutorialNote(state, action, CombatStateActions.stop(state, actionTime), actionTime);
  if (action.type === "combat/beginRecovery") return CombatStateActions.beginRecovery(state, actionTime);
  if (action.type === "combat/finishRecovery") return CombatStateActions.finishRecovery(state, actionTime);
  if (action.type === "legion/paySalaries") {
    return (typeof LEGION_NPC !== "undefined" && LEGION_NPC.payLegionNpcSalariesNow)
      ? LEGION_NPC.payLegionNpcSalariesNow(state, { now: actionTime })
      : { changed:false, reason:"legion-unavailable" };
  }
  if (action.type === "planetary/deploy") return PlanetaryStateActions.deploy(state, action.planetType, actionTime);
  if (action.type === "planetary/collect") return PlanetaryStateActions.collect(state, action.id);
  if (action.type === "planetary/renew") return PlanetaryStateActions.renew(state, action.id, actionTime);
  if (action.type === "planetary/demolish") return PlanetaryStateActions.demolish(state, action.id);
  if (action.type === "shell/buyLPItem") return ShellStateActions.buyLPItem(state, action.equipmentId, actionTime);
  if (action.type === "hangar/toggleAssignment") return tutorialNote(state, action, ShellStateActions.toggleShipAssignment(state, action.instanceId, action.actionKey, actionTime), actionTime);
  if (action.type === "hangar/equipCombatShip") return tutorialNote(state, action, ShellStateActions.equipCombatShip(state, action.instanceId, actionTime), actionTime);
  if (action.type === "hangar/enhanceShip") return ShellStateActions.enhanceShip(state, action.instanceId, action.randomValue);
  if (action.type === "hangar/disassembleShip") return ShellStateActions.disassembleShip(state, action.instanceId, actionTime);
  if (action.type === "hangar/setFittingSlot") return ShellStateActions.setFittingSlot(state, action.instanceId, action.slot, action.slotIndex, action.equipmentId);
  if (action.type === "hangar/resetFitting") return ShellStateActions.resetFitting(state, action.instanceId);
  if (action.type === "hangar/fitRig") return ShellStateActions.fitRig(state, action.instanceId, action.slotIndex, action.rigItemId);
  if (action.type === "hangar/destroyFittedRig") return ShellStateActions.destroyFittedRig(state, action.instanceId, action.slotIndex);
  if (action.type === "hangar/replaceFittedRig") return ShellStateActions.replaceFittedRig(state, action.instanceId, action.slotIndex, action.rigItemId);
  if (action.type === "equipment/enhance") return enhanceEquipment(state, action.targetRef, action.randomValue);
  if (action.type === "equipment/discard") return ShellStateActions.discardEquipment(state, action.targetRef, actionTime);
  if (action.type === "equipment/dismantle") return ShellStateActions.dismantleEquipment(state, action.targetRef, actionTime);
  if (action.type === "component/dismantle") return ShellStateActions.dismantleComponent(state, action.componentId, actionTime);
  if (action.type === "hangar/clearIndustrialShip") return ShellStateActions.clearIndustrialShip(state);
  if (action.type === "settings/setShipEnhancementConfirmation") return ShellStateActions.setShipEnhancementConfirmation(state, action.enabled);
  if (action.type === "settings/setDiscardConfirmation") return ShellStateActions.setDiscardConfirmation(state, action.enabled);
  if (action.type === "settings/setDismantleConfirmation") return ShellStateActions.setDismantleConfirmation(state, action.enabled);
  if (action.type === "settings/toggleCombatSkills") return ShellStateActions.toggleCombatSkills(state);
  if (action.type === "queue/add") return ShellStateActions.queueAdd(state, action.item, actionTime, action.front);
  if (action.type === "queue/remove") return ShellStateActions.queueRemove(state, action.index, actionTime);
  if (action.type === "queue/move") return ShellStateActions.queueMove(state, action.from, action.to);
  if (action.type === "queue/moveTop") return ShellStateActions.queueMoveToTop(state, action.from);
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
  if (action.type === "station/setAutoLineQuantity") return StationStateActions.setAutoLineQuantity(state, action.lineId, action.quantity);
  if (action.type === "station/refillMaintenance") return StationStateActions.refillMaintenance(state, actionTime);
  if (action.type === "station/startBodyConstruction") return StationStateActions.startBodyConstruction(state, actionTime);
  if (action.type === "station/startBuildingConstruction") return StationStateActions.startBuildingConstruction(state, action.buildingId, actionTime);
  // 研究系统 Batch F：所有操作经 ResearchSystem 公开 API，actionTime 透传
  if (action.type === "research/start") return ResearchStateActions.start(state, action.techId, action.targetLevel, actionTime);
  if (action.type === "research/enqueue") return ResearchStateActions.enqueue(state, action.techId, action.targetLevel, actionTime);
  if (action.type === "research/enqueueCascade") return ResearchStateActions.enqueueCascade(state, action.techId, action.targetLevel, actionTime);
  if (action.type === "research/cancel") return ResearchStateActions.cancel(state, actionTime);
  if (action.type === "research/applyHours") return ResearchStateActions.applyHours(state, action.hours, actionTime);
  if (action.type === "research/removeQueued") return ResearchStateActions.removeQueued(state, action.stepKey, actionTime);
  if (action.type === "research/startQueued") return ResearchStateActions.startQueued(state, action.stepKey, actionTime);
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
    if (getEffectiveSkillLevel(state, "archaeology") < site.level) return { changed:false, reason:"level-locked" };
    state.archaeology.activeSiteId = site.id;
    state._dirty = true;
    return { changed:true, site };
  },
  selectProbe(state, probeId) {
    const probe = getArchaeologyProbe(probeId);
    if (!probe) return { changed:false, reason:"unknown-probe" };
    if (state.currentAction.active && state.currentAction.skill === "archaeology") return { changed:false, reason:"action-running" };
    if (getEffectiveSkillLevel(state, "archaeology") < probe.level) return { changed:false, reason:"level-locked" };
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
// 离线战斗队列终结 / 续战标记：显式导出，供 offline-combat.js 的 G() 在 TapTap/脚本隔离环境中解析到
// （此前未导出导致 G("finalizeCombatQueueItem") 为 undefined，离线战斗达标后无法推进队列项）。
window.finalizeCombatQueueItem = finalizeCombatQueueItem;
globalThis.finalizeCombatQueueItem = finalizeCombatQueueItem;
window.setCombatQueueResume = setCombatQueueResume;
globalThis.setCombatQueueResume = setCombatQueueResume;
