/* ================================================================
   离线收益计算
   ================================================================ */

const MAX_OFFLINE_SECONDS = 86400;
let _offlineToastTimer = null;
let _offlineEventBatch = null;

function emitOfflineGameEvent(type, payload) {
  const batch = _offlineEventBatch || { runId:"offline_" + Date.now().toString(36), sequence:0 };
  batch.sequence++;
  return GameEvents.emit(type, payload, {
    offline:true,
    aggregate:Number(payload && payload.cycles) > 1,
    source:"offline-settlement",
    runId:batch.runId,
    eventId:batch.runId + ":" + batch.sequence + ":" + type
  });
}

function showOfflineToast(seconds, gains) {
  const old = document.querySelector('.offline-toast'); if (old) old.remove();
  if (_offlineToastTimer) clearTimeout(_offlineToastTimer);
  const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60);
  const timeStr = min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;
  const labels = {
    mining: "⛏ 采矿", refining: "🔥 冶炼", gasHarvesting: "☁️ 气体",
    equipmentEngineering: "🔧 装备工程",
    shipEngineering: "🚀 舰船工程", planetaryIndustry: "🪐 行星"
  };
  const detail = Object.entries(labels)
    .filter(([key]) => (gains[key] || 0) > 0)
    .map(([key, label]) => `${label} +${gains[key]} 次`).join("  ");
  const toast = document.createElement("div"); toast.className = "offline-toast";
  toast.innerHTML = `⏳ 离线 ${timeStr}，已自动结算${detail ? "：" + detail : ""}`;
  document.body.appendChild(toast);
  _offlineToastTimer = setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4200);
}

function getMaxMaterialCycles(cost) {
  let cycles = Infinity;
  for (const [mat, qty] of Object.entries(cost || {})) {
    cycles = Math.min(cycles, Math.floor(getMaterialStock(mat) / qty));
  }
  return cycles;
}

function deductMatsMultiple(cost, cycles) {
  return ResourceRegistry.spendCost(gameState, cost, cycles);
}

function addOfflineSkillXp(skillKey, amount) {
  const skill = gameState.skills[skillKey];
  if (!skill || amount <= 0) return;
  skill.xp += amount;
  checkLevelUp(skillKey, {
    offline:true,
    source:"offline-settlement",
    runId:_offlineEventBatch ? _offlineEventBatch.runId : null
  });
}

function getOfflineActionDescriptor() {
  const action = gameState.currentAction;
  const key = action.skill;

  if (key === "mining") {
    const areaName = action.startedArea || action.area;
    const area = getMiningAreaByName(areaName) || MINING_AREAS[0];
    if (!area || !canMineArea(area)) return null;
    return {
      key, duration: area.baseTime / getMiningEfficiency(),
      maxCycles: () => Math.max(0, getCargoCapacity() - getCargoUsed()),
      apply(cycles, gains) {
        ResourceRegistry.add(gameState, (area.mode === "moon" ? "moon:" : "ore:") + area.ore, cycles);
        addOfflineSkillXp(key, cycles * area.baseXP); gains[key] += cycles;
        emitOfflineGameEvent("mining:completed", { area:area.name, mode:area.mode, resourceId:(area.mode === "moon" ? "moon:" : "ore:") + area.ore, quantity:cycles, cycles, xp:cycles * area.baseXP });
      }
    };
  }

  if (key === "refining") {
    const recipeName = action.startedSmeltingArea || action.smeltingArea;
    const recipe = SMELTING_RECIPES.find(r => r.name === recipeName || r.outputMineral === recipeName) || SMELTING_RECIPES[0];
    if (!recipe) return null;
    const eff = getSmeltingEfficiency(); const output = Math.max(1, Math.floor(recipe.baseOutput * eff));
    return {
      key, duration: recipe.baseTime / eff,
      maxCycles() {
        let cycles = ResourceRegistry.get(gameState, "ore:" + recipe.consumeOre);
        const netCargo = output - 1;
        if (netCargo > 0) cycles = Math.min(cycles, Math.floor(Math.max(0, getCargoCapacity() - getCargoUsed()) / netCargo));
        return cycles;
      },
      apply(cycles, gains) {
        ResourceRegistry.spend(gameState, "ore:" + recipe.consumeOre, cycles);
        ResourceRegistry.add(gameState, "mineral:" + recipe.outputMineral, cycles * output);
        addOfflineSkillXp(key, cycles * recipe.baseXP); gains[key] += cycles;
        emitOfflineGameEvent("refining:completed", { recipe:recipe.name, inputId:"ore:" + recipe.consumeOre, outputId:"mineral:" + recipe.outputMineral, inputQuantity:cycles, outputQuantity:cycles * output, cycles, xp:cycles * recipe.baseXP });
      }
    };
  }

  if (key === "gasHarvesting") {
    const areaName = action.startedGasArea || action.gasArea;
    const area = GAS_AREAS.find(a => a.name === areaName || a.gas === areaName) || GAS_AREAS[0];
    if (!area) return null;
    return {
      key, duration: area.baseTime / getGasEfficiency(),
      maxCycles: () => Math.max(0, getCargoCapacity() - getCargoUsed()),
      apply(cycles, gains) {
        ResourceRegistry.add(gameState, "gas:" + area.gas, cycles);
        addOfflineSkillXp(key, cycles * area.baseXP); gains[key] += cycles;
        emitOfflineGameEvent("gas:completed", { area:area.name, resourceId:"gas:" + area.gas, quantity:cycles, cycles, xp:cycles * area.baseXP });
      }
    };
  }

  if (key === "shipEngineering" && action.shipSubAction === "component") {
    const recipe = getRunningShipCompRecipe(); if (!recipe) return null;
    return {
      key, duration: recipe.time / getShipEngineeringEfficiency(),
      maxCycles: () => Math.min(getMaxMaterialCycles(recipe.cost), Math.max(0, getCargoCapacity() - getCargoUsed())),
      apply(cycles, gains) {
        deductMatsMultiple(recipe.cost, cycles);
        ResourceRegistry.add(gameState, "component:" + recipe.id, cycles);
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("manufacturing:completed", { branch:"component", recipeId:recipe.id, resourceId:"component:" + recipe.id, quantity:cycles, cycles, xp:cycles * recipe.xp });
      }
    };
  }

  if (key === "shipEngineering" && action.shipSubAction === "assembly") {
    const recipe = getRunningShipAsmRecipe(); if (!recipe) return null;
    return {
      key, duration: recipe.time / getShipEngineeringEfficiency(),
      maxCycles() {
        return isCargoFull() ? 0 : getMaxShipAssemblyCycles(recipe);
      },
      apply(cycles, gains) {
        deductShipAssemblyComponents(recipe, cycles);
        for (let i = 0; i < cycles; i++) gameState.inventory.ships.push(createShipInstance(recipe.shipId));
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("manufacturing:completed", { branch:"ship", recipeId:recipe.id, shipId:recipe.shipId, quantity:cycles, cycles, xp:cycles * recipe.xp });
      }
    };
  }

  if (key === "equipmentEngineering") {
    const recipe = getRunningEquipEngRecipe(); if (!recipe) return null;
    return {
      key, duration: recipe.time / getEquipEngEfficiency(),
      maxCycles: () => !equipmentRecipeHasRequiredBlueprint(gameState, recipe) ? 0 : recipe.output.type === "equipment"
        ? recipe.inputEquipment ? getEquipEngMaxCycles(recipe) : Math.min(getEquipEngMaxCycles(recipe), Math.max(0, getCargoCapacity() - getCargoUsed()))
        : getEquipEngMaxCycles(recipe),
      apply(cycles, gains) {
        deductEquipEngInputs(recipe, cycles);
        applyEquipEngOutput(recipe, cycles);
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("manufacturing:completed", { branch:"equipment", recipeId:recipe.id, productType:recipe.output.type, quantity:cycles * recipe.output.qty, cycles, xp:cycles * recipe.xp });
      }
    };
  }

  return null;
}

function advanceOfflineQueue() {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning || queue.items.length === 0) return false;
  let nextIndex = queue.status.activeIndex + 1;
  if (nextIndex >= queue.items.length) {
    if (!queue.config.loopMode) {
      queue.status.isRunning = false; queue.status.activeIndex = -1;
      return false;
    }
    queue.status.completedCount++;
    nextIndex = 0;
  }
  queue.status.activeIndex = nextIndex;
  applyQueueItemConfig(queueItemConfig(queue.items[nextIndex]));
  return true;
}

function completeOfflineQueueCycles(cycles) {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning || queue.status.activeIndex < 0 || queue.status.activeIndex >= queue.items.length) {
    if (gameState.currentAction.batchRemaining > 0) {
      gameState.currentAction.batchRemaining = Math.max(0, gameState.currentAction.batchRemaining - cycles);
      if (gameState.currentAction.batchRemaining === 0) {
        resetActionProgress();
        gameState.currentAction.active = false;
        return true;
      }
    }
    return false;
  }

  const index = queue.status.activeIndex;
  const item = queue.items[index];
  if (item.count === -1) {
    gameState.currentAction.batchRemaining = -1;
    return false;
  }

  item.count = Math.max(0, (Number(item.count) || 1) - cycles);
  gameState.currentAction.batchRemaining = item.count;
  gameState._dirty = true;
  if (item.count > 0) return false;

  queue.items.splice(index, 1);
  queue.status.completedCount++;
  queue.status.failCount = 0;

  if (queue.items.length === 0 || index >= queue.items.length) {
    queue.status.isRunning = false;
    queue.status.activeIndex = -1;
    resetActionProgress();
    gameState.currentAction.active = false;
    gameState.currentAction.batchRemaining = 0;
    return true;
  }

  queue.status.activeIndex = index;
  applyQueueItemConfig(queueItemConfig(queue.items[index]));
  return true;
}

function skipFailedOfflineQueueItem() {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning || !queue.config.skipOnFail) return false;
  queue.status.failCount++;
  if (queue.status.failCount > queue.items.length * 2 + 2) {
    queue.status.isRunning = false; queue.status.activeIndex = -1;
    return false;
  }
  return advanceOfflineQueue();
}

function settleOfflineActions(seconds, gains) {
  const queue = gameState.queue;
  if (queue && queue.status.isRunning && queue.items.length > 0 && !gameState.currentAction.active) {
    let index = queue.status.activeIndex;
    if (index < 0 || index >= queue.items.length) index = 0;
    queue.status.activeIndex = index;
    applyQueueItemConfig(queueItemConfig(queue.items[index]));
  }

  let remaining = seconds;
  let guard = 0;
  while (remaining > 0.0001 && gameState.currentAction.active && guard++ < 10000) {
    const descriptor = getOfflineActionDescriptor();
    if (!descriptor || !Number.isFinite(descriptor.duration) || descriptor.duration <= 0) break;

    const progress = Math.max(0, Number(gameState.currentAction.progress) || 0);
    const timeToFirst = Math.max(0, descriptor.duration - progress);
    if (remaining < timeToFirst) {
      gameState.currentAction.progress = progress + remaining;
      remaining = 0;
      break;
    }

    const cyclesByTime = 1 + Math.floor((remaining - timeToFirst) / descriptor.duration);
    const batchRemaining = gameState.currentAction.batchRemaining;
    const batchLimit = batchRemaining > 0 ? batchRemaining : Infinity;
    const possibleCycles = Math.max(0, descriptor.maxCycles());
    const cycles = Math.min(cyclesByTime, batchLimit, possibleCycles);

    if (cycles <= 0) {
      if (skipFailedOfflineQueueItem()) continue;
      gameState.currentAction.active = false;
      break;
    }

    descriptor.apply(cycles, gains);
    gameState._dirty = true;
    remaining -= timeToFirst + Math.max(0, cycles - 1) * descriptor.duration;
    gameState.currentAction.progress = 0;

    if (completeOfflineQueueCycles(cycles)) {
      if (gameState.currentAction.active) continue;
      break;
    }

    if (cycles < cyclesByTime) {
      if (skipFailedOfflineQueueItem()) continue;
      gameState.currentAction.active = false;
      break;
    }

    gameState.currentAction.progress = Math.min(remaining, descriptor.duration);
    remaining = 0;
  }
}

function settleOfflinePlanets(seconds, gains) {
  if (!gameState.planetary || !Array.isArray(gameState.planetary.deployments)) return;
  const now = Date.now(); const offlineStart = now - seconds * 1000;
  const storageMax = getPlanetStorageMax();
  for (const deployment of gameState.planetary.deployments) {
    if (!deployment.active) continue;
    const deployedAt = deployment.deployedAt || offlineStart;
    const expiresAt = deployedAt + (deployment.duration || 86400) * 1000;
    const activeStart = Math.max(offlineStart, deployedAt);
    const activeEnd = Math.min(now, expiresAt);
    const activeSeconds = Math.max(0, (activeEnd - activeStart) / 1000);
    const interval = getPlanetOutputInterval(deployment.type);
    const totalProgress = (deployment.progress || 0) + activeSeconds;
    let cycles = Math.floor(totalProgress / interval);
    cycles = Math.min(cycles, Math.max(0, storageMax - deployment.storage));
    if (cycles > 0) {
      deployment.storage += cycles;
      deployment.progress = deployment.storage >= storageMax ? 0 : totalProgress - cycles * interval;
      gameState.skills.planetaryIndustry.xp += cycles;
      gains.planetaryIndustry += cycles;
      gameState._dirty = true;
      const config = PLANET_TYPES.find(planet => planet.type === deployment.type);
      emitOfflineGameEvent("planetary:completed", {
        deploymentId:deployment.id,
        planetType:deployment.type,
        resourceId:"planetary:" + (config ? config.output : deployment.type),
        quantity:cycles,
        cycles,
        xp:cycles
      });
    } else if (deployment.storage < storageMax) {
      deployment.progress = totalProgress;
    }
    deployment.lastTick = now;
    if (now >= expiresAt) deployment.active = false;
  }
  if (gains.planetaryIndustry > 0) {
    checkLevelUp("planetaryIndustry", {
      offline:true,
      source:"offline-settlement",
      runId:_offlineEventBatch ? _offlineEventBatch.runId : null
    });
  }
}

function applyOfflineGains(rawSeconds, context) {
  const seconds = Math.min(Math.max(0, rawSeconds || 0), MAX_OFFLINE_SECONDS);
  const gains = {
    mining: 0, refining: 0, shipEngineering: 0, gasHarvesting: 0,
    equipmentEngineering: 0, planetaryIndustry: 0
  };
  if (seconds <= 5) return gains;
  const previousBatch = _offlineEventBatch;
  const runId = context && typeof context.runId === "string" && context.runId
    ? context.runId
    : "offline_" + Math.round(Date.now() - seconds * 1000).toString(36) + "_" + Date.now().toString(36);
  _offlineEventBatch = { runId, sequence:0 };
  try {
    settleOfflineActions(seconds, gains);
    settleOfflinePlanets(seconds, gains);
  } finally {
    _offlineEventBatch = previousBatch;
  }
  return gains;
}

function calculateOfflineGains() {
  const now = Date.now();
  const lastActive = gameState.lastActiveTime || now;
  const elapsed = Math.floor((now - lastActive) / 1000);
  if (elapsed <= 5) return;
  const gains = applyOfflineGains(elapsed, { runId:"offline_" + lastActive.toString(36) + "_" + now.toString(36) });
  gameState.currentAction.lastProgressUpdate = now;
  gameState.lastActiveTime = now;
  const totalGains = Object.values(gains).reduce((sum, value) => sum + value, 0);
  if (totalGains > 0) showOfflineToast(elapsed, gains);
  gameState._dirty = true;
  SaveManager.save();
}

function forceOfflineTest(seconds) {
  if (!seconds || seconds <= 0) { console.log("用法：forceOfflineTest(60) — 模拟离线 60 秒"); return; }
  const gains = applyOfflineGains(seconds, { runId:"offline_test_" + Date.now().toString(36) });
  gameState.currentAction.lastProgressUpdate = Date.now();
  gameState.lastActiveTime = Date.now(); gameState._dirty = true;
  const total = Object.values(gains).reduce((sum, value) => sum + value, 0);
  if (total > 0) showOfflineToast(seconds, gains);
  console.log("[离线测试] 完成", gains);
  updateUI();
  return gains;
}
window.forceOfflineTest = forceOfflineTest;
