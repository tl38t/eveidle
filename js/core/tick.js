// 队列失败/资源不足时：跳转到下一项或停止
function stopOrSkip() {
    const q = gameState.queue;
    resetActionProgress();
    if (q && q.status.isRunning && q.config.skipOnFail) {
        q.status.failCount++;
        // 防止无限失败循环：连续失败超过队列长度×2时暂停
        if (q.status.failCount > q.items.length * 2 + 2) {
            q.status.isRunning = false;
            showToast("队列因连续失败已暂停");
        }
        if (!advanceQueue()) {
            gameState.currentAction.active = false;
            gameState.currentAction.batchRemaining = 0;
        }
    } else {
        gameState.currentAction.active = false;
    }
}

function gameTick() {
  // 增强剂在线计时：必须在 gameTick 顶部调用，确保 lastTick 每个 tick 都推进。
  // 无论后续分支是否提前 return，lastTick 都已更新，恢复后不会追扣停止期间的时间。
  // 增强剂在本 tick 效果结算前处理到正确时间点，不能耗尽后仍多享受整轮效果。
  if (typeof tickBoosterTimers === "function") {
    tickBoosterTimers(gameState, Date.now());
  }

  updateCombatRecovery();
  let actionCompleted = false;
  if (gameState.currentAction.active) {
    const key = gameState.currentAction.skill;
    const s = gameState.skills[key];
    if (key === "combat") { combatTick(); }
    if (key !== "combat" && isCargoFull()) { stopOrSkip(); updateUI(); }
    else if (key === "mining") {
      const area = getRunningMiningArea(); if (!area) return;
      if (!canMineArea(area)) { stopOrSkip(); updateUI(); return; }
      const boosterEff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState) : null;
      const boosterSpeed = (boosterEff && boosterEff.miningSpeedMultiplier) || 1;
      const eff = getMiningEfficiency() * boosterSpeed;
      const actualTime = area.baseTime / eff;
      gameState.currentAction.refDuration = actualTime;
      const now = Date.now();
      const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        gameState.currentAction.progress -= actualTime;
        // 计算本次产量：基础 1 + 双倍矿物概率翻倍
        var quantity = 1;
        if (boosterEff && boosterEff.doubleMineralChance > 0 && (typeof rollDoubleMineral === "function") && rollDoubleMineral(boosterEff.doubleMineralChance)) {
          quantity = 2;
        }
        // *** FIX 4: 双倍不得突破货舱硬上限 ***
        if (quantity > 1) {
          const cargoSpace = Math.max(0, (typeof getCargoCapacity === "function" ? getCargoCapacity() : Infinity) - (typeof getCargoUsed === "function" ? getCargoUsed() : 0));
          if (quantity > cargoSpace) quantity = Math.max(1, cargoSpace);
        }
        ResourceRegistry.add(gameState, (area.mode === "moon" ? "moon:" : "ore:") + area.ore, quantity);
        // XP 始终只加一次（双倍不影响 XP）
        s.xp += area.baseXP; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("mining:completed", { area:area.name, mode:area.mode, resourceId:(area.mode === "moon" ? "moon:" : "ore:") + area.ore, quantity:quantity, xp:area.baseXP }, { offline:false });
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("mining");
    } else if (key === "refining") {
      const recipeName = gameState.currentAction.startedSmeltingArea || gameState.currentAction.smeltingArea;
      const recipe = SMELTING_RECIPES.find(r => r.name === recipeName) || SMELTING_RECIPES[0]; if (!recipe) return;
      const stock = ResourceRegistry.get(gameState, "ore:" + recipe.consumeOre);
      if (stock < 1) { stopOrSkip(); updateUI(); return; }
      const smeltingState = getSmeltingDisplayState(gameState, Date.now());
      const eff = smeltingState.efficiency; const actualTime = recipe.baseTime / eff;
      gameState.currentAction.refDuration = actualTime;
      const now = Date.now();
      const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        if (ResourceRegistry.get(gameState, "ore:" + recipe.consumeOre) < 1) { stopOrSkip(); updateUI(); return; }
        gameState.currentAction.progress -= actualTime; ResourceRegistry.spend(gameState, "ore:" + recipe.consumeOre, 1);
        const output = Math.max(1, Math.floor(recipe.baseOutput * smeltingState.skillEfficiency));
        ResourceRegistry.add(gameState, "mineral:" + recipe.outputMineral, output);
        s.xp += recipe.baseXP; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("refining:completed", { recipe:recipe.name, inputId:"ore:" + recipe.consumeOre, outputId:"mineral:" + recipe.outputMineral, inputQuantity:1, outputQuantity:output, xp:recipe.baseXP }, { offline:false });
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("refining");
    } else if (key === "gasHarvesting") {
      const gasName = gameState.currentAction.startedGasArea || gameState.currentAction.gasArea;
      const area = GAS_AREAS.find(a => a.name === gasName) || GAS_AREAS[0]; if (!area) return;
      const eff = getGasEfficiency(); const actualTime = area.baseTime / eff;
      gameState.currentAction.refDuration = actualTime;
      const now = Date.now();
      const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        gameState.currentAction.progress -= actualTime;
        ResourceRegistry.add(gameState, "gas:" + area.gas, 1);
        s.xp += area.baseXP; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("gas:completed", { area:area.name, resourceId:"gas:" + area.gas, quantity:1, xp:area.baseXP }, { offline:false });
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("gasHarvesting");
    } else if (key === "equipmentEngineering") {
      const recipe = getRunningEquipEngRecipe(); if (!recipe) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
      if (!equipmentRecipeHasRequiredBlueprint(gameState, recipe)) { stopOrSkip(); updateUI(); return; }
      if (isCargoFull() && !recipe.inputEquipment) { stopOrSkip(); updateUI(); return; }
      if (!hasEnoughEquipEngInputs(recipe, 1)) { stopOrSkip(); updateUI(); return; }
      const eff = getEquipEngEfficiency(); const actualTime = recipe.time / eff;
      gameState.currentAction.refDuration = actualTime;
      const now = Date.now(); const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        if (!hasEnoughEquipEngInputs(recipe, 1)) { stopOrSkip(); updateUI(); return; }
        gameState.currentAction.progress -= actualTime;
        deductEquipEngInputs(recipe, 1);
        applyEquipEngOutput(recipe, 1);
        s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("manufacturing:completed", { branch:"equipment", recipeId:recipe.id, productType:recipe.output.type, quantity:recipe.output.qty, xp:recipe.xp }, { offline:false });
        if (recipe.slot === "rig") GameEvents.emit("rig:manufactured", { rigId:recipe.output.itemId, quantity:recipe.output.qty }, { offline:false });
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("equipmentEngineering");
    } else if (key === "shipEngineering") {
      const sub = gameState.currentAction.shipSubAction;
      if (sub === "component") {
        const recipe = getRunningShipCompRecipe(); if (!recipe) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
        if (isCargoFull()) { stopOrSkip(); updateUI(); return; }
        if (!hasEnoughMats(recipe.cost)) { stopOrSkip(); updateUI(); return; }
        const eff = getShipEngineeringEfficiency(); const actualTime = recipe.time / eff;
        gameState.currentAction.refDuration = actualTime;
        const now = Date.now(); const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
        gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
        while (gameState.currentAction.progress >= actualTime) {
          if (!hasEnoughMats(recipe.cost)) { stopOrSkip(); updateUI(); return; }
          gameState.currentAction.progress -= actualTime;
          deductMats(recipe.cost);
          ResourceRegistry.add(gameState, "component:" + recipe.id, 1);
          s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
          GameEvents.emit("manufacturing:completed", { branch:"component", recipeId:recipe.id, resourceId:"component:" + recipe.id, quantity:1, xp:recipe.xp }, { offline:false });
          if (completeQueuedActionCycle()) { updateUI(); break; }
        }
        if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
        if (s.xp > 0) checkLevelUp("shipEngineering");
      } else if (sub === "assembly") {
        const recipe = getRunningShipAsmRecipe(); if (!recipe) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
        if (!hasEnoughShipAssemblyComponents(recipe)) { stopOrSkip(); updateUI(); return; }
        if (isCargoFull()) { stopOrSkip(); updateUI(); return; }
        const eff = getShipEngineeringEfficiency(); const actualTime = recipe.time / eff;
        gameState.currentAction.refDuration = actualTime;
        const now = Date.now(); const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
        gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
        while (gameState.currentAction.progress >= actualTime) {
          if (!hasEnoughShipAssemblyComponents(recipe)) { stopOrSkip(); updateUI(); return; }
          gameState.currentAction.progress -= actualTime;
          deductShipAssemblyComponents(recipe);
          if (!gameState.inventory.ships) gameState.inventory.ships = [];
          gameState.inventory.ships.push(createShipInstance(recipe.shipId));
          s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
          GameEvents.emit("manufacturing:completed", { branch:"ship", recipeId:recipe.id, shipId:recipe.shipId, quantity:1, xp:recipe.xp }, { offline:false });
          if (completeQueuedActionCycle()) { updateUI(); break; }
        }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("shipEngineering");
      }
    } else if (key === "archaeology") {
    const arch = gameState.archaeology;
    const site = getArchaeologySite(arch.startedSiteId);
    if (!site) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
    const instanceId = gameState.shipAssignments && gameState.shipAssignments.archaeology;
    const instance = instanceId ? getShipInstanceFromState(gameState, instanceId) : null;
    if (!instance) { stopOrSkip(); updateUI(); return; }
    const now = Date.now();
    // 维修完成：恢复满血并继续
    if (arch.repairUntil && arch.repairUntil <= now) {
      if (arch.repairInstanceId) {
        resetArchaeologyShipHp(gameState, arch.repairInstanceId);
        GameEvents.emit("archaeology:repairCompleted", { instanceId:arch.repairInstanceId }, { offline:false });
      }
      arch.repairUntil = 0; arch.repairInstanceId = null;
    }
    // 维修中：暂停并清空进度
    if (arch.repairUntil > now) { gameState.currentAction.progress = 0; updateUI(); return; }
    // 信号干扰中：暂停并清空进度
    if (arch.interferenceUntil > now) { gameState.currentAction.progress = 0; updateUI(); return; }

    const archSpeedEff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState).archaeologySpeedMultiplier : 1;
    const actualTime = site.time * archSpeedEff;
    gameState.currentAction.refDuration = actualTime;
    const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
    gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
    while (gameState.currentAction.progress >= actualTime) {
      gameState.currentAction.progress -= actualTime;
      const result = resolveArchaeologyCycle(gameState, now, undefined);
      if (!result || result.reason === "insufficient") { stopOrSkip(); updateUI(); return; }
      if (result.success) {
        arch.log.push({ time:now, site:site.name, success:true, artifacts:result.found.map(a => a.name) });
      } else {
        if (result.destroyed) {
          arch.log.push({ time:now, site:site.name, success:false, destroyed:true, backlash:result.backlash });
        } else {
          const rigMods = (typeof getRigModifiers === "function" && instance) ? (getRigModifiers(gameState, instance) || {}) : {};
          const interferenceSeconds = getArchaeologyInterferenceSeconds(site, rigMods.archaeologyInterferenceReduction);
          arch.interferenceUntil = now + interferenceSeconds * 1000;
          arch.log.push({ time:now, site:site.name, success:false, backlash:result.backlash });
        }
      }
      gameState._dirty = true;
      if (completeQueuedActionCycle()) { updateUI(); break; }
    }
    if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
    if (gameState.skills.archaeology.xp > 0) checkLevelUp("archaeology");
    } else if (key === "boosterEngineering") {
      // 增强剂制造（Phase 2A）：每完成 1 瓶原子扣料 + 入库 + 加 XP；单件事件 quantity=1。
      const recipe = getRunningBoosterRecipe();
      if (!recipe) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
      if (!isBoosterRecipeUnlocked(recipe)) { stopOrSkip(); updateUI(); return; }
      if (!hasEnoughBoosterInputs(recipe, 1)) { stopOrSkip(); updateUI(); return; }
      const eff = getBoosterEfficiency(); const actualTime = recipe.time / eff;
      gameState.currentAction.refDuration = actualTime;
      const now = Date.now(); const delta = Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000);
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        if (!hasEnoughBoosterInputs(recipe, 1)) { stopOrSkip(); updateUI(); return; }
        gameState.currentAction.progress -= actualTime;
        deductBoosterInputs(recipe, 1);
        applyBoosterOutput(recipe, 1);
        s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("booster:manufactured", { recipeId:recipe.id, itemId:recipe.output.itemId, series:recipe.series, quality:recipe.quality, quantity:1, xpGained:recipe.xp, offline:false }, { offline:false });
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("boosterEngineering");
    }
  }

  // 行星产出（独立于主动技能，始终运行）
  planetaryTick();

  gameState.lastActiveTime = Date.now();
  updateLiveUI();
  if (actionCompleted) refreshVisiblePanelAfterAction();
}
