/* ================================================================
   离线收益计算
   ================================================================ */

const MAX_OFFLINE_SECONDS = 86400;
let _offlineToastTimer = null;
let _offlineEventBatch = null;
// 全局单调批次序号：保证同一毫秒内多次独立结算生成的 runId 全局唯一，
// 避免不同批次的事件拿到相同 eventId、被通配消费者（onIdempotent）误判为重复而丢弃真实结算记账。
// eventId 格式仍为 runId:sequence:type；调用方显式传入的 runId 原样保留。
let _offlineBatchSeq = 0;

// 虚拟时间兼容入口：第三参 meta 可选；
// 1) 旧两参数调用（emitOfflineGameEvent(type, payload)）行为完全不变；
// 2) offline 永远为 true、source 默认仍为 "offline-settlement"；
// 3) runId/sequence/eventId 格式与唯一性完全不变（不得复制第二套事件号逻辑）；
// 4) meta.timestamp 为有限 number 时透传 GameEvents.emit（虚拟时间）；非法/缺失时保持原 Date.now() 回退。
function emitOfflineGameEvent(type, payload, meta) {
  const inputMeta = meta && typeof meta === "object" ? meta : {};
  const ts = Number.isFinite(Number(inputMeta.timestamp)) ? Number(inputMeta.timestamp) : undefined;
  const batch = _offlineEventBatch || { runId:"offline_" + Date.now().toString(36) + "_" + (++_offlineBatchSeq).toString(36), sequence:0 };
  batch.sequence++;
  const emitMeta = {
    offline:true,
    aggregate:Number(payload && payload.cycles) > 1,
    source:(typeof inputMeta.source === "string" && inputMeta.source) ? inputMeta.source : "offline-settlement",
    runId:batch.runId,
    eventId:batch.runId + ":" + batch.sequence + ":" + type
  };
  if (ts !== undefined) emitMeta.timestamp = ts;
  return GameEvents.emit(type, payload, emitMeta);
}

function showOfflineToast(seconds, gains) {
  const old = document.querySelector('.offline-toast'); if (old) old.remove();
  if (_offlineToastTimer) clearTimeout(_offlineToastTimer);
  const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60);
  const timeStr = min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;
  const labels = {
    mining: "⛏ 采矿", refining: "🔥 冶炼", gasHarvesting: "☁️ 气体",
    equipmentEngineering: "🔧 装备工程", boosterEngineering: "💉 增强剂制造",
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
    const miningEff = getMiningEfficiency();
    const boosterEff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState) : null;
    const speedMult = (boosterEff && boosterEff.miningSpeedMultiplier) || 1;
    const doubleChance = (boosterEff && boosterEff.doubleMineralChance) || 0;
    return {
      key, duration: area.baseTime / (miningEff * speedMult),
      maxCycles: () => Infinity,
      apply(cycles, gains) {
        let totalOre = cycles;
        if (doubleChance > 0) {
          for (let i = 0; i < cycles; i++) {
            if ((typeof rollDoubleMineral === "function") && rollDoubleMineral(doubleChance)) totalOre++;
          }
        }
        ResourceRegistry.add(gameState, (area.mode === "moon" ? "moon:" : "ore:") + area.ore, totalOre);
        // XP 始终按实际采集次数计算（双倍不增加 XP）
        addOfflineSkillXp(key, cycles * area.baseXP); gains[key] += cycles;
        emitOfflineGameEvent("mining:completed", { area:area.name, mode:area.mode, resourceId:(area.mode === "moon" ? "moon:" : "ore:") + area.ore, quantity:totalOre, cycles, xp:cycles * area.baseXP });
      }
    };
  }

  if (key === "refining") {
    const recipeName = action.startedSmeltingArea || action.smeltingArea;
    const recipe = SMELTING_RECIPES.find(r => r.name === recipeName || r.outputMineral === recipeName) || SMELTING_RECIPES[0];
    if (!recipe) return null;
    const smeltingState = getSmeltingDisplayState(gameState, Date.now());
    const eff = smeltingState.efficiency; const output = Math.max(1, Math.floor(recipe.baseOutput * smeltingState.skillEfficiency));
    return {
      key, duration: recipe.baseTime / eff,
      maxCycles() {
        return ResourceRegistry.get(gameState, "ore:" + recipe.consumeOre);
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
      maxCycles: () => Infinity,
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
      key, duration: getShipEngineeringCycleDuration(gameState, recipe), // 唯一周期公式（技能×船坞，与在线 tick 一致）
      maxCycles: () => getMaxMaterialCycles(recipe.cost),
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
      key, duration: getShipEngineeringCycleDuration(gameState, recipe), // 唯一周期公式（技能×船坞，与在线 tick 一致）
      maxCycles() {
        return getMaxShipAssemblyCycles(recipe);
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
        ? recipe.inputEquipment ? getEquipEngMaxCycles(recipe) : getEquipEngMaxCycles(recipe)
        : getEquipEngMaxCycles(recipe),
      apply(cycles, gains) {
        deductEquipEngInputs(recipe, cycles);
        applyEquipEngOutput(recipe, cycles);
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("manufacturing:completed", { branch:"equipment", recipeId:recipe.id, productType:recipe.output.type, quantity:cycles * recipe.output.qty, cycles, xp:cycles * recipe.xp });
        if (recipe.slot === "rig") emitOfflineGameEvent("rig:manufactured", { rigId:recipe.output.itemId, quantity:cycles * recipe.output.qty });
      }
    };
  }

  if (key === "boosterEngineering") {
    // 增强剂离线制造（Phase 2A）：每瓶独立产 1；受离线时间/材料限制；不占货舱；
    // 与在线同秒数产量一致；不消耗 180 秒、不应用效果；批量事件另发 boosters:manufactured。
    const recipe = getRunningBoosterRecipe(); if (!recipe) return null;
    return {
      key, duration: recipe.time / getBoosterEfficiency(),
      maxCycles: () => isBoosterRecipeUnlocked(recipe) ? getBoosterMaxCyclesFromState(gameState, recipe) : 0,
      apply(cycles, gains) {
        deductBoosterInputs(recipe, cycles);
        applyBoosterOutput(recipe, cycles);
        addOfflineSkillXp(key, cycles * recipe.xp); gains[key] += cycles;
        emitOfflineGameEvent("boosters:manufactured", { recipeId:recipe.id, itemId:recipe.output.itemId, quantity:cycles * recipe.output.qty, totalXp:cycles * recipe.xp, offline:true });
      }
    };
  }

  if (key === "archaeology") {
    const arch = gameState.archaeology;
    const site = getArchaeologySite(arch.startedSiteId || arch.activeSiteId);
    if (!site) return null;
    const probeId = arch.startedProbeId || arch.activeProbeId;
    const instanceId = gameState.shipAssignments && gameState.shipAssignments.archaeology;
    const instance = instanceId ? getShipInstanceFromState(gameState, instanceId) : null;
    if (!instance) return null;
    // 考古周期唯一公式（研究批次 G · archEff）：与在线 tick / 显示态共用 getArchaeologyCycleSeconds，
    // 离线 descriptor 与时间账本都只读这一个数，禁止再算第二套。
    const archCycleSeconds = (typeof getArchaeologyCycleSeconds === "function")
      ? getArchaeologyCycleSeconds(gameState, site)
      : site.time;
    return {
      key, duration: archCycleSeconds,
      maxCycles() {
        const probeStock = ResourceRegistry.get(gameState, "probe:" + probeId);
        const fuelStock = ResourceRegistry.get(gameState, "consumable:fuel");
        // 用唯一计算层的长期平均燃料作为除数（含船体 fuelEfficiency + 改装件减免），
        // 保证在线/离线可负担次数一致；apply 循环内每次仍以真实累计器结算并在不足时中断。
        const fuelState = getArchaeologyFuelCostState(gameState, site, instance);
        const perCycle = Math.max(1, fuelState.averageFuelPerCycle);
        // 研究批次 G · probe：探针也走确定性累计器，长期平均 < 1 时可跑的周期数多于库存数。
        // 无科研（平均 = 1）时保持与接入前完全一致的 probeStock 上限，避免基线漂移。
        const probeState = (typeof getArchaeologyProbeCostState === "function")
          ? getArchaeologyProbeCostState(gameState) : { averageProbePerCycle:1 };
        const probeAvg = Math.max(0.01, Number(probeState.averageProbePerCycle) || 1);
        const probeCapacity = (probeAvg >= 1) ? probeStock : (Math.floor(probeStock / probeAvg) + 2);
        return Math.max(0, Math.min(probeCapacity, Math.floor(fuelStock / perCycle) + 2));
      },
      apply(cycles, gains) {
        let done = 0;
        const durMs = archCycleSeconds * 1000;
        let repairMs = 0;
        if (gameState.archaeology.repairUntil > Date.now()) {
          repairMs = gameState.archaeology.repairUntil - Date.now();
        }
        let virtualNow = Date.now();
        for (let i = 0; i < cycles; i++) {
          if (repairMs > 0) {
            const consume = Math.min(repairMs, durMs);
            virtualNow += consume;
            repairMs -= consume;
            if (repairMs <= 0) {
              if (gameState.archaeology.repairInstanceId) {
                resetArchaeologyShipHp(gameState, gameState.archaeology.repairInstanceId);
              }
              gameState.archaeology.repairUntil = 0;
              gameState.archaeology.repairInstanceId = null;
            }
            continue;
          }
          virtualNow += durMs;
          const result = resolveArchaeologyCycle(gameState, virtualNow, "offline");
          if (!result || result.reason === "insufficient") break;
          done++;
          if (gameState.archaeology.repairUntil) {
            repairMs = gameState.archaeology.repairUntil - virtualNow;
          }
        }
        gains[key] = (gains[key] || 0) + done;
      },
      // 考古时间预算接口：按墙钟秒数精确推进，兼容维修/干扰/队列/增强剂分段
      // 时间账本铁律：elapsedSeconds === actionSeconds + repairSeconds
      //   - 维修：只消耗墙钟（wallBudget），不扣行动预算（actionBudget=增强剂）、不扣增强剂、不推进进度
      //   - 完整周期：消耗真实 remainingForCycle（含追进度），actionSeconds += cycleCostMs/1000（禁止整段 durSec）
      //   - 部分周期：只推进真实 partialSec，actionSeconds += partialSec
      //   - 每个完整周期前做真实探针 + getArchaeologyFuelCostState 燃料校验，不足则不推进时间/资源/队列
      settleByTime(maxWallSeconds, gains, context) {
        const arch = gameState.archaeology;
        const durMs = archCycleSeconds * 1000;
        let wallBudgetMs = maxWallSeconds * 1000;
        // 行动预算（增强剂分段边界）：仅约束行动时间，维修时间不占用
        let actionBudgetMs = (context && Number.isFinite(context.actionBudgetSeconds))
          ? context.actionBudgetSeconds * 1000 : Infinity;
        // 合法值 0 必须保留：显式 != null 判断，禁止 || 覆盖
        let virtualNow = (context && context.virtualNowMs != null) ? context.virtualNowMs : Date.now();
        const batchLimit = (context && context.batchLimit && context.batchLimit !== Infinity)
          ? context.batchLimit : Infinity;

        let actionSec = 0, repairSec = 0, progressSec = 0;
        let cyclesDone = 0;
        let stopped = false, reason = "";

        while (wallBudgetMs > 1) {
          // 1) 维修优先：按墙钟消耗，不扣行动预算/增强剂，不推进进度
          if (arch.repairUntil > virtualNow) {
            const repairNeedMs = Math.min(arch.repairUntil - virtualNow, wallBudgetMs);
            virtualNow += repairNeedMs;
            wallBudgetMs -= repairNeedMs;
            repairSec += repairNeedMs / 1000;
            if (arch.repairUntil <= virtualNow) {
              // 维修完成：恢复 HP，清维修状态
              if (arch.repairInstanceId) resetArchaeologyShipHp(gameState, arch.repairInstanceId);
              arch.repairUntil = 0; arch.repairInstanceId = null;
              continue; // 维修完成后重新进入循环，重新检查资源/预算
            }
            // 墙钟耗尽仍在维修
            stopped = true; reason = "repair-incomplete";
            break;
          }

          // 2) 批次耗尽
          if (cyclesDone >= batchLimit) { stopped = true; reason = "batch-exhausted"; break; }

          // 3) 行动预算耗尽（增强剂分段边界）
          if (actionBudgetMs <= 0.5) { stopped = true; reason = "booster-boundary"; break; }

          // 4) 计算完成本周期所需的行动时间（含追既有进度）
          const progress = Math.max(0, Number(gameState.currentAction.progress) || 0);
          const remainingForCycle = Math.max(0, durMs - progress * 1000);
          const availActionMs = Math.min(wallBudgetMs, actionBudgetMs);

          if (availActionMs < remainingForCycle) {
            // 不足以完成一个完整周期：只推进进度，扣真实行动时间
            const partialSec = availActionMs / 1000;
            gameState.currentAction.progress = progress + partialSec;
            progressSec = gameState.currentAction.progress;
            actionSec += partialSec;
            virtualNow += availActionMs;
            wallBudgetMs -= availActionMs;
            actionBudgetMs -= availActionMs;
            stopped = true;
            reason = (wallBudgetMs <= 1) ? "partial-cycle" : "booster-boundary";
            break;
          }

          // 5) 完成完整周期前：真实探针 + 燃料校验（不足则不推进任何时间/资源/队列）
          const probeStock = ResourceRegistry.get(gameState, "probe:" + probeId);
          // 研究批次 G · probe：与 resolveArchaeologyCycle 同一累计器口径（免费周期 chargedProbe=0 不拦）
          const probeState = (typeof getArchaeologyProbeCostState === "function")
            ? getArchaeologyProbeCostState(gameState) : { chargedProbe:1 };
          if (probeStock < probeState.chargedProbe) { stopped = true; reason = "insufficient-probe"; break; }
          const fuelState = getArchaeologyFuelCostState(gameState, site, instance);
          const fuelStock = ResourceRegistry.get(gameState, "consumable:fuel");
          if (fuelStock < fuelState.chargedFuel) { stopped = true; reason = "insufficient-fuel"; break; }

          // 6) 扣除完成本周期所需墙钟/行动时间
          const cycleCostMs = remainingForCycle;
          virtualNow += cycleCostMs;
          wallBudgetMs -= cycleCostMs;
          actionBudgetMs -= cycleCostMs;

          // 7) 执行真实考古周期（含探针/燃料实扣、成功率、重创判定）
          const result = resolveArchaeologyCycle(gameState, virtualNow, "offline");
          if (!result || result.reason === "insufficient") {
            // 理论上前置校验已挡住，此处为防御性回退；不计入完成周期
            stopped = true; reason = (result && result.reason) || "insufficient";
            break;
          }
          cyclesDone++;
          actionSec += cycleCostMs / 1000; // 只计真实完成本周期的行动时间（含追进度）
          gameState.currentAction.progress = 0;
          progressSec = 0;
          // resolveArchaeologyCycle 可能设置 repairUntil（重创），下一轮循环维修分支处理
        }

        gains[key] = (gains[key] || 0) + cyclesDone;
        if (context) context.virtualNowMs = virtualNow;
        return {
          elapsedSeconds: actionSec + repairSec,
          actionSeconds: actionSec,
          repairSeconds: repairSec,
          completedCycles: cyclesDone,
          progressSeconds: progressSec,
          stopped, reason
        };
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
  executeQueueItemForState(gameState, queue.items[nextIndex], Date.now());
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
  executeQueueItemForState(gameState, queue.items[index], Date.now());
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
    executeQueueItemForState(gameState, queue.items[index], Date.now());
  }

  let remaining = seconds;
  let guard = 0;
  const timeBySkill = (arguments.length >= 4 && typeof arguments[3] === "object") ? arguments[3] : null;
  const now = Date.now();
  const DUR = typeof BOOSTER_DURATION_MS === "number" ? BOOSTER_DURATION_MS : 180000;

  while (remaining > 0.0001 && gameState.currentAction.active && guard++ < 10000) {
    const descriptor = getOfflineActionDescriptor();
    if (!descriptor || !Number.isFinite(descriptor.duration) || descriptor.duration <= 0) break;
    const currentSkill = gameState.currentAction.skill;

    // --- Booster segmentation ---
    // For mining/archaeology, cap this batch to the minimum available time
    // among the two relevant booster slots. When a slot depletes, the next
    // loop iteration re-reads the updated (depleted) booster state via
    // getOfflineActionDescriptor, naturally splitting the timeline.
    let boosterLimitSec = Infinity;
    let relevantSlots = [];
    if (currentSkill === "mining" || currentSkill === "archaeology") {
      if (typeof getActionBoosterSlots === "function") {
        relevantSlots = getActionBoosterSlots(currentSkill);
      }
      if (typeof getActiveBoosterState === "function") {
        const active = getActiveBoosterState(gameState);
        for (const slot of relevantSlots) {
          const entry = active[slot];
          if (entry && entry.itemId && Number(entry.remainingMs) > 0) {
            const invCount = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, entry.itemId) : 0;
            const availMs = Number(entry.remainingMs) + Math.max(0, Math.floor(invCount)) * DUR;
            const availSec = availMs / 1000;
            if (availSec < boosterLimitSec) boosterLimitSec = availSec;
          }
        }
      }
    }

    // 考古专用：在通用 partial/cyclesByTime/cycles<=0/apply 分支之前，立即进入时间预算接口。
    // 无论维修/干扰/剩余或增强剂时间不足一周期，都由 settleByTime 统一按墙钟精确结算：
    //   - maxWallSeconds = 完整剩余墙钟（remaining），保证维修可跨段按墙钟完成
    //   - actionBudgetSeconds = boosterLimitSec（仅约束行动时间，不约束维修/进度）
    if (currentSkill === "archaeology" && typeof descriptor.settleByTime === "function") {
      const batchRemaining2 = gameState.currentAction.batchRemaining;
      const batchLimit2 = batchRemaining2 > 0 ? batchRemaining2 : Infinity;
      const ctx = {
        virtualNowMs: (gameState._archVirtualNowMs != null) ? gameState._archVirtualNowMs : null,
        batchLimit: batchLimit2,
        actionBudgetSeconds: boosterLimitSec
      };
      const result = descriptor.settleByTime(remaining, gains, ctx);
      gameState._archVirtualNowMs = ctx.virtualNowMs;
      gameState._dirty = true;

      const elapsed = result.elapsedSeconds || 0;
      const actionSec = result.actionSeconds || 0;
      const completed = result.completedCycles || 0;

      // 墙钟消耗（settleByTime 保证 elapsedSeconds === actionSeconds + repairSeconds）
      remaining -= elapsed;

      // timeBySkill 只记行动时间（维修不算行动、不追扣增强剂）
      if (timeBySkill) timeBySkill[currentSkill] = (timeBySkill[currentSkill] || 0) + actionSec;

      // 进度：由 settleByTime 内部管理（含部分周期）
      gameState.currentAction.progress = result.progressSeconds > 0 ? result.progressSeconds : 0;

      // 增强剂只扣 actionSeconds（不含维修/干扰）
      if (actionSec > 0 && relevantSlots.length > 0 && typeof applyBoosterTimeConsumption === "function") {
        const consumedMs = Math.ceil(actionSec * 1000);
        for (const slot of relevantSlots) {
          applyBoosterTimeConsumption(gameState, slot, consumedMs, now, { offline:true });
        }
      }

      // 队列只按真实完成周期推进
      if (completed > 0) {
        if (completeOfflineQueueCycles(completed)) {
          if (gameState.currentAction.active) continue;
          break;
        }
      }

      if (result.stopped) {
        // 资源不足（探针/燃料）：跳过失败队列项或停止行动
        if (result.reason === "insufficient" || result.reason === "insufficient-probe" || result.reason === "insufficient-fuel") {
          if (skipFailedOfflineQueueItem()) continue;
          gameState.currentAction.active = false;
          break;
        }
        // repair-incomplete / partial-cycle / booster-boundary / batch-exhausted：
        // 剩余墙钟或分段边界。若还有时间且本段确有推进则继续外循环（重读增强剂/维修状态），
        // 否则终止防止死循环。
        if (remaining >= 0.001 && (elapsed >= 0.0005 || result.reason === "batch-exhausted")) continue;
        break;
      }
      if (remaining >= 0.001) continue;
      break;
    }

    const progress = Math.max(0, Number(gameState.currentAction.progress) || 0);
    const timeToFirst = Math.max(0, descriptor.duration - progress);
    const maxTime = Math.min(remaining, boosterLimitSec);

    if (maxTime < timeToFirst) {
      // Cannot complete one cycle within time/booster limit.
      const partialTime = maxTime;
      gameState.currentAction.progress = progress + partialTime;
      if (timeBySkill) timeBySkill[currentSkill] = (timeBySkill[currentSkill] || 0) + partialTime;
      remaining -= partialTime;
      if (partialTime > 0 && relevantSlots.length > 0 && typeof applyBoosterTimeConsumption === "function") {
        const consumedMs = Math.ceil(partialTime * 1000);
        for (const slot of relevantSlots) {
          applyBoosterTimeConsumption(gameState, slot, consumedMs, now, { offline:true });
        }
      }
      if (remaining > 0.0001) continue;
      break;
    }

      const cyclesByTime = 1 + Math.floor((maxTime - timeToFirst) / descriptor.duration);
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
    const cycleTime = timeToFirst + Math.max(0, cycles - 1) * descriptor.duration;
    remaining -= cycleTime;
    if (timeBySkill) timeBySkill[currentSkill] = (timeBySkill[currentSkill] || 0) + cycleTime;
    gameState.currentAction.progress = 0;

    // Consume booster time: mining/archaeology only.
    // Combat boosters frozen offline; refining/gas/manufacturing don't consume.
    if (cycleTime > 0 && relevantSlots.length > 0 && typeof applyBoosterTimeConsumption === "function") {
      const consumedMs = Math.ceil(cycleTime * 1000);
      for (const slot of relevantSlots) {
        applyBoosterTimeConsumption(gameState, slot, consumedMs, now, { offline:true });
      }
    }

    if (completeOfflineQueueCycles(cycles)) {
      // Batch K：intship 阶段推进（离线批量清空后唯一推进点，非 intship 驱动时内部为无操作；
      // 推进成功后 currentAction.active 重新为 true，经下方 continue 用剩余离线时间续下一阶段）
      if (typeof advanceIntshipAfterManufacturingAction === "function") {
        advanceIntshipAfterManufacturingAction(gameState, { now, offline:true });
      }
      if (gameState.currentAction.active) continue;
      break;
    }

    if (cycles < cyclesByTime) {
      if (skipFailedOfflineQueueItem()) continue;
      gameState.currentAction.active = false;
      break;
    }

    // If significant remaining time, continue looping for the next segment
    // (e.g., after a booster-limited batch, the depleted-booster descriptor
    // will be used in the next iteration for the base rate).
    if (remaining >= descriptor.duration) {
      gameState.currentAction.progress = 0;
      continue;
    }

    gameState.currentAction.progress = Math.min(remaining, descriptor.duration);
    remaining = 0;
  }
  return seconds - remaining;
}

function settleOfflinePlanets(seconds, gains, segmentEnd) {
  if (!gameState.planetary || !Array.isArray(gameState.planetary.deployments)) return;
  const now = segmentEnd || Date.now();
  const offlineStart = now - seconds * 1000;
  for (const deployment of gameState.planetary.deployments) {
    if (!deployment.active) continue; // 已到期：跳过，且不重复触发 expired
    // 研究批次 I · planauto：离线与在线共用同一个「单 deployment 时间轴」入口
    // （产出结算 / 精确到期判定 / 逐周期自动续期全部在 advancePlanetDeploymentTimeline 内完成）。
    // 离线区间从离线起点（= now - 离线秒数，受 MAX_OFFLINE_SECONDS 上限约束）起算。
    const res = advancePlanetDeploymentTimeline(gameState, deployment, offlineStart, now, {
      offline:true,
      emit:(type, payload, eventMeta) => emitOfflineGameEvent(type, payload, eventMeta),
      // 空间站自动收取（Phase 3C-4/6）：storage>=storageMax 时移入库存并清零
      collect:(dep, storageMax) => (typeof applyStationAutoCollect === "function" && dep.storage >= storageMax)
        ? applyStationAutoCollect(gameState, dep, storageMax, true) : 0
    });
    if (res.cycles > 0) {
      gameState.skills.planetaryIndustry.xp += res.cycles;
      gains.planetaryIndustry += res.cycles;
      gameState._dirty = true;
    }
    if (res.renewals > 0) gameState._dirty = true;
  }
  if (gains.planetaryIndustry > 0) {
    checkLevelUp("planetaryIndustry", {
      offline:true,
      source:"offline-settlement",
      runId:_offlineEventBatch ? _offlineEventBatch.runId : null
    });
  }
}

// Booster segmentation is handled directly inside settleOfflineActions:
// for mining/archaeology, each loop iteration caps the batch time to the
// minimum available time among the two relevant booster slots. When a slot
// depletes, the next iteration re-reads the updated state via
// getOfflineActionDescriptor, naturally splitting the timeline.
// Combat boosters are frozen offline; refining/gas/manufacturing don't
// consume non-combat slots.

/* ----------------------------------------------------------------
   离线时间轴协调器（唯一入口）
   按燃料耗尽和施工完成分段时间轴，每段用正确的 operational 状态
   真实调用子系统的 settle 函数。
   定义在 offline.js 以便直接调用 settleOfflineActions/Planets 等。
   ---------------------------------------------------------------- */
function settleOfflineTimeline(totalSeconds, gains, context) {
  const seconds = Math.min(Math.max(0, totalSeconds || 0), MAX_OFFLINE_SECONDS);
  if (seconds <= 5) return;
  const now = Date.now();
  const totalMs = seconds * 1000;
  const offlineStart = now - totalMs;
  const offlineEnd = now;

  const s = gameState && gameState.station;
  // 将 maintenance.lastTick 设为离线起点，使 settleStationMaintenance 按段正确消耗
  if (s && s.maintenance && (Number(s.maintenance.lastTick) || 0) > offlineStart) {
    s.maintenance.lastTick = offlineStart;
  }

  const haveFuelFns = typeof getStationMaintenancePoints === "function"
    && typeof getStationEffectiveFuelBurnRatePerMs === "function";

  // 动态时间轴：不再在循环前一次性构造边界。每段开始重算维护点数/燃烧率/
  // 燃料耗尽时刻/施工完成时刻——这样施工中途升级维护点数后，剩余燃料按
  // 「新点数」重新推算耗尽点，而非沿用离线开始时的旧点数。
  let currentTime = offlineStart;
  let guard = 0;
  while (currentTime < offlineEnd) {
    if (++guard > 100000) break; // 安全网：防意外死循环

    // ---- 每段开始动态重算 ----
    // 1) 当前维护点数  2) 当前燃烧率  3) 当前燃料覆盖时长  4) 当前燃料耗尽时刻
    let fuelExhaustAt = Infinity;
    if (haveFuelFns && s && s.maintenance) {
      const points = getStationMaintenancePoints(gameState);
      // 研究批次 G · fuel：离线分段的燃料耗尽时刻必须用实际燃烧速率推算，
      // 与 settleStationMaintenance 的实际扣减完全同源，否则会提前把站点判为断油。
      const burnRate = points > 0 ? getStationEffectiveFuelBurnRatePerMs(gameState, points) : 0;
      const fuelRem = Number(s.maintenance.fuelRemaining) || 0;
      if (burnRate > 0 && fuelRem > 0) {
        const fuelCoverageMs = fuelRem / burnRate;
        const exhaustAt = currentTime + fuelCoverageMs;
        if (exhaustAt > currentTime) fuelExhaustAt = exhaustAt;
      }
    }
    // 5) 当前施工完成时刻
    let constructionAt = Infinity;
    if (s && s.construction && s.construction.paid === true
      && Number(s.construction.completesAt) > currentTime) {
      constructionAt = Number(s.construction.completesAt);
    }
    // 6) nextBoundary = min(fuelExhaustAt, constructionAt, offlineEnd)
    let nextBoundary = offlineEnd;
    if (fuelExhaustAt > currentTime && fuelExhaustAt < nextBoundary) nextBoundary = fuelExhaustAt;
    if (constructionAt > currentTime && constructionAt < nextBoundary) nextBoundary = constructionAt;

    const segEnd = Math.min(nextBoundary, offlineEnd);
    const segMs = segEnd - currentTime;
    if (segMs <= 0.001) {
      // 边界重合的极短段：仅推进时间指针，防止死循环
      currentTime = segEnd > currentTime ? segEnd : currentTime + 1;
      continue;
    }
    const segSec = segMs / 1000;

    // 当前段是否 operational（在扣除该段燃料之前判断）
    const segOperational = typeof isStationOperational === "function"
      ? isStationOperational(gameState) : false;

    // 1) 玩家行动始终完整进行（采矿/采气/制造/考古不受燃料影响）
    const timeBySkill = {};
    settleOfflineActions(segSec, gains, undefined, timeBySkill);
    gameState._auditTimeBySkill = timeBySkill;

    // 2) 行星：按段结束时间结算（segmentEnd 使 deployment.lastTick 正确推进）
    settleOfflinePlanets(segSec, gains, segEnd);

    // 3) 自动线：始终调用。无油段由 processAutoLines 内部燃料闸门负责——
    //    不产出/不扣料/不加XP，但推进 line.lastTick=segEnd，防止补油后
    //    首个在线 tick 追算整段断油时间。
    if (typeof processAutoLines === "function") {
      processAutoLines(gameState, segEnd, true);
    }

    // 4) 扣除该段燃料（仅 operational 段真实消耗）
    if (segOperational && typeof settleStationMaintenance === "function") {
      settleStationMaintenance(gameState, segEnd, true);
    } else if (s && s.maintenance) {
      // 无油段也推进 maintenance.lastTick，避免补油后重复扣断油段
      s.maintenance.lastTick = segEnd;
    }

    // 5) 施工完成（边界正好落在 segEnd）
    if (s && s.construction && s.construction.paid === true
      && Number(s.construction.completesAt) > currentTime
      && Number(s.construction.completesAt) <= segEnd) {
      if (typeof completeStationConstruction === "function") {
        completeStationConstruction(gameState, { offline: true });
      }
    }

    currentTime = segEnd;
  }
}

function applyOfflineGains(rawSeconds, context) {
  // Batch C-9 定点返修：rawSeconds 严格归一化（唯一归一点）。
  // 合法 = typeof "number" 且 Number.isFinite 且 >= 0；合法值原样保留（不整数化）。
  // 其余一切输入（NaN / Infinity / -Infinity / 负数 / 数字字符串 / 普通字符串 /
  // null / undefined / 对象 / 数组 / 布尔）一律归一为 0，随后被 seconds <= 5 提前返回拦截：
  // 不初始化考古虚拟时间、不调用 settleOfflineTimeline、不发射离线结算完成事件、
  // 不改动统计/事件账本/_dirty。事件构造处禁止再做 Number() / || 0 等宽松转换。
  const normalizedRawSeconds =
    (typeof rawSeconds === "number" && Number.isFinite(rawSeconds) && rawSeconds >= 0)
      ? rawSeconds
      : 0;
  const seconds = Math.min(normalizedRawSeconds, MAX_OFFLINE_SECONDS);
  const gains = {
    mining: 0, refining: 0, shipEngineering: 0, gasHarvesting: 0,
    equipmentEngineering: 0, boosterEngineering: 0, planetaryIndustry: 0
  };
  if (seconds <= 5) return gains;
  // 初始化考古虚拟时间
  gameState._archVirtualNowMs = Date.now() - seconds * 1000;
  const previousBatch = _offlineEventBatch;
  const runId = context && typeof context.runId === "string" && context.runId
    ? context.runId
    : "offline_" + Math.round(Date.now() - seconds * 1000).toString(36) + "_" + Date.now().toString(36) + "_" + (++_offlineBatchSeq).toString(36);
  _offlineEventBatch = { runId, sequence:0 };
  try {
    // 唯一协调入口：按燃料/施工分段时间轴
    settleOfflineTimeline(seconds, gains, context);
    // Batch C-9：真实结算成功完成后、_offlineEventBatch 恢复前，严格 emit 一次唯一完成事件
    // （沿用同一 runId/eventId 链）。settleOfflineTimeline 抛出异常时不会执行到此行，
    // 不伪造完成事件。calculateOfflineGains / forceOfflineTest / 直接 applyOfflineGains
    // 均经由本入口，禁止在其他位置复制发射。rawSeconds 使用入口处唯一严格归一化结果
    // normalizedRawSeconds（非负有限 number、未封顶、不整数化），settledSeconds 为实际
    // 结算秒数（已按 MAX_OFFLINE_SECONDS 封顶）。禁止此处再做 Number()/|| 0 等宽松转换。
    emitOfflineGameEvent("offline:settlementCompleted", {
      rawSeconds: normalizedRawSeconds,
      settledSeconds: seconds
    });
  } finally {
    _offlineEventBatch = previousBatch;
    delete gameState._archVirtualNowMs;
  }
  // 同步 boosters.lastTick，防止首次在线 gameTick 追扣旧离线时间
  if (gameState.boosters) {
    gameState.boosters.lastTick = Date.now();
  }
  return gains;
}

function calculateOfflineGains() {
  const now = Date.now();
  // 批次 C：科研离线时间结算 —— 必须在既有 elapsed <= 5 提前 return 之前调用，
  // 复用本函数同一 now（不传 elapsed、不预封顶）。每离线结算仅调用一次；
  // 真实超时封顶在 processResearchUntil 内统一处理。
  if (typeof ResearchSystem !== "undefined" && ResearchSystem &&
      typeof ResearchSystem.processResearchUntil === "function") {
    ResearchSystem.processResearchUntil(gameState, now);
  }
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
  const gains = applyOfflineGains(seconds, { runId:"offline_test_" + Date.now().toString(36) + "_" + (++_offlineBatchSeq).toString(36) });
  gameState.currentAction.lastProgressUpdate = Date.now();
  gameState.lastActiveTime = Date.now(); gameState._dirty = true;
  const total = Object.values(gains).reduce((sum, value) => sum + value, 0);
  if (total > 0) showOfflineToast(seconds, gains);
  console.log("[离线测试] 完成", gains);
  updateUI();
  return gains;
}
window.forceOfflineTest = forceOfflineTest;
