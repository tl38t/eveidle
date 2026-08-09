// 速度源兜底：即使未通过 index.html 加载 speed-config.js（如部分 Node 测试环境），
// gameDeltaSec / getGameSpeed / gameNow 等全局函数也须存在且等价于「实时」（speed=1）。
if (typeof gameDeltaSec !== "function") {
  (function () {
    var g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : {});
    if (typeof g.GAME_SPEED !== "number" || !(g.GAME_SPEED > 0)) g.GAME_SPEED = 1;
    g.getGameSpeed = function () { return (typeof g.GAME_SPEED === "number" && g.GAME_SPEED > 0) ? g.GAME_SPEED : 1; };
    g.gameDeltaSec = function (realSec) { return (typeof realSec === "number" && Number.isFinite(realSec)) ? realSec * g.getGameSpeed() : 0; };
    g.gameNow = function () { return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0; };
  })();
}

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

// ===== Batch C-14A：在线会话时长的唯一入口 =====
// 模块运行期私有锚点：只活在当前页面生命周期的闭包变量里，绝不写入 gameState、绝不进存档。
// 页面重载 / 导入存档都会让锚点重建（下一 tick 只建锚不累计），因此不会把关闭浏览器的时间
// 算成在线时间；历史累计值的唯一权威是 statistics.lifecycle.onlineSeconds。
let _onlineSessionAnchorMs = null;

function accumulateOnlineSessionTime(nowMs) {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return;
  // 首个 tick：只建锚点。本次不累计、不发事件、不置脏。
  if (_onlineSessionAnchorMs === null) { _onlineSessionAnchorMs = nowMs; return; }
  // 时钟倒退（用户改系统时间 / NTP 回拨）：重置锚点，绝不累计负数。
  if (nowMs < _onlineSessionAnchorMs) { _onlineSessionAnchorMs = nowMs; return; }
  const deltaSeconds = (nowMs - _onlineSessionAnchorMs) / 1000;
  _onlineSessionAnchorMs = nowMs;
  // 同一毫秒内重复 tick（Date.now 被冻结的测试沙箱同理）→ delta 为 0，不发射空事件。
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  // GameEvents 不可用时安全降级：只推进锚点，不抛错、不阻断后续 tick 业务。
  if (typeof GameEvents === "undefined" || !GameEvents || typeof GameEvents.emit !== "function") return;
  GameEvents.emit("session:onlineElapsed", { seconds:deltaSeconds }, {
    timestamp:nowMs,
    source:"online-session",
    offline:false
  });
}

function gameTick() {
  // Batch C-14A：在线会话时长必须在所有业务提前 return 之前累计，
  // 保证暂停 / 资源不足 / 战斗恢复中等任何分支下在线时长都不丢失。
  accumulateOnlineSessionTime(Date.now());

  // 增强剂在线计时：必须在 gameTick 顶部调用，确保 lastTick 每个 tick 都推进。
  // 无论后续分支是否提前 return，lastTick 都已更新，恢复后不会追扣停止期间的时间。
  // 增强剂在本 tick 效果结算前处理到正确时间点，不能耗尽后仍多享受整轮效果。
  if (typeof tickBoosterTimers === "function") {
    tickBoosterTimers(gameState, Date.now());
  }

  // 空间站维护燃料（Phase 3C-6）：必须在所有可能消费空间站效果的行动之前扣除
  if (typeof settleStationMaintenance === "function") settleStationMaintenance(gameState, Date.now(), false);

  // 批次 C：科研在线时间结算 —— 必须在所有提前 return 的业务分支之前调用，
  // 确保主行动异常 / 资源不足 / 暂停时科研仍正常推进。每 tick 仅调用一次。
  if (typeof ResearchSystem !== "undefined" && ResearchSystem &&
      typeof ResearchSystem.processResearchUntil === "function") {
    ResearchSystem.processResearchUntil(gameState, Date.now(), { scale: (typeof getGameSpeed === "function") ? getGameSpeed() : 1 });
  }

  updateCombatRecovery();
  // Batch K：intship 一体化造船——每 tick 对账，作业已不驱动 currentAction 时落为 stopped/preempted
  if (typeof reconcileIntshipRuntime === "function") reconcileIntshipRuntime(gameState, Date.now());
  let actionCompleted = false;
  // 死亡空间连刷修复：上一轮全通时 resolveDeathspaceWaveVictory 会置
  // deathspaceChainPending=true 并把 currentAction.active=false（combat.js:664-666）。
  // 若不在此放行，下一 tick 因 currentAction.active=false 直接跳过 combatTick，
  // pending 续跑钩子（combat.js:1045）永远到不了，连刷在首轮后卡死。
  // 故：当前 action 是 combat 且存在死亡空间连刷待续时，仍驱动 combatTick 让其自动续进。
  const dsPending = gameState.currentAction.skill === "combat"
    && Boolean(gameState.combat && gameState.combat.deathspaceChainPending);
  if (gameState.currentAction.active || dsPending) {
    const key = gameState.currentAction.skill;
    const s = gameState.skills[key];
    if (key === "combat") { combatTick(); }
    if (key === "mining") {
      const area = getRunningMiningArea(); if (!area) return;
      if (!canMineArea(area)) { stopOrSkip(); updateUI(); return; }
      const boosterEff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(gameState) : null;
      const boosterSpeed = (boosterEff && boosterEff.miningSpeedMultiplier) || 1;
      const eff = getMiningEfficiency() * boosterSpeed;
      const actualTime = area.baseTime / eff;
      gameState.currentAction.refDuration = actualTime;
      const now = Date.now();
      const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        gameState.currentAction.progress -= actualTime;
        const resourceId = (area.mode === "moon" ? "moon:" : "ore:") + area.ore;
        // 计算本次产量：基础 1 + 双倍矿物概率翻倍
        var quantity = 1;
        if (boosterEff && boosterEff.doubleMineralChance > 0 && (typeof rollDoubleMineral === "function") && rollDoubleMineral(boosterEff.doubleMineralChance)) {
          quantity = 2;
        }
        // 资源调度中心：勘探指令额外产出（不增 XP）
        let dispatchBonus = 0;
        if (typeof recordStationDispatchAction === "function") {
          dispatchBonus = recordStationDispatchAction(gameState, "mining", 1);
          if (dispatchBonus > 0) quantity += dispatchBonus;
        }
        // 脑插·采矿双生：4% 概率本次产出×2（双倍矿物/调度加成之后）
        if (Math.random() < getImplantDoubleOutputChance(gameState, "mining")) quantity *= 2;
        ResourceRegistry.add(gameState, resourceId, quantity);
        // XP 始终只加一次（双倍不影响 XP）
        s.xp += area.baseXP; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("mining:completed", { area:area.name, mode:area.mode, resourceId, quantity:quantity, xp:area.baseXP }, { offline:false });
        if (dispatchBonus > 0 && typeof GameEvents !== "undefined") {
          GameEvents.emit("station:dispatchBonus", { kind:"mining", resourceId, quantity:dispatchBonus, counter:(gameState.station.dispatch ? gameState.station.dispatch.miningCount : 0), threshold:(typeof getStationDispatchThreshold === "function" ? getStationDispatchThreshold(gameState) : 0) }, { offline:false });
        }
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
      const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        if (ResourceRegistry.get(gameState, "ore:" + recipe.consumeOre) < 1) { stopOrSkip(); updateUI(); return; }
        gameState.currentAction.progress -= actualTime; ResourceRegistry.spend(gameState, "ore:" + recipe.consumeOre, 1);
        let output = Math.max(1, Math.floor(recipe.baseOutput * smeltingState.skillEfficiency));
        // 脑插·冶炼双生：3% 概率本次产出×2
        if (Math.random() < getImplantDoubleOutputChance(gameState, "refining")) output *= 2;
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
      const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        gameState.currentAction.progress -= actualTime;
        const resourceId = "gas:" + area.gas;
        let quantity = 1;
        let dispatchBonus = 0;
        if (typeof recordStationDispatchAction === "function") {
          dispatchBonus = recordStationDispatchAction(gameState, "gas", 1);
          if (dispatchBonus > 0) quantity += dispatchBonus;
        }
        // 脑插·采气双生：4% 概率本次产出×2（调度加成之后）
        if (Math.random() < getImplantDoubleOutputChance(gameState, "gas")) quantity *= 2;
        ResourceRegistry.add(gameState, resourceId, quantity);
        s.xp += area.baseXP; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("gas:completed", { area:area.name, resourceId, quantity:quantity, xp:area.baseXP }, { offline:false });
        if (dispatchBonus > 0 && typeof GameEvents !== "undefined") {
          GameEvents.emit("station:dispatchBonus", { kind:"gas", resourceId, quantity:dispatchBonus, counter:(gameState.station.dispatch ? gameState.station.dispatch.gasCount : 0), threshold:(typeof getStationDispatchThreshold === "function" ? getStationDispatchThreshold(gameState) : 0) }, { offline:false });
        }
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("gasHarvesting");
    } else if (key === "equipmentEngineering") {
      const recipe = getRunningEquipEngRecipe(); if (!recipe) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
      if (!equipmentRecipeHasRequiredBlueprint(gameState, recipe)) { stopOrSkip(); updateUI(); return; }
      if (!hasEnoughEquipEngInputs(recipe, 1)) { stopOrSkip(); updateUI(); return; }
      const eff = getEquipEngEfficiency(); const actualTime = recipe.time / eff;
      gameState.currentAction.refDuration = actualTime;
      const now = Date.now(); const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        if (!hasEnoughEquipEngInputs(recipe, 1)) { stopOrSkip(); updateUI(); return; }
        gameState.currentAction.progress -= actualTime;
        deductEquipEngInputs(recipe, 1);
        applyEquipEngOutput(recipe, 1);
        s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("manufacturing:completed", { branch:"equipment", recipeId:recipe.id, productType:recipe.output.type, quantity:recipe.output.qty, time:recipe.time, xp:recipe.xp }, { offline:false });
        if (recipe.slot === "rig") GameEvents.emit("rig:manufactured", { rigId:recipe.output.itemId, quantity:recipe.output.qty }, { offline:false });
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("equipmentEngineering");
    } else if (key === "shipEngineering") {
      const sub = gameState.currentAction.shipSubAction;
      if (sub === "component") {
        const recipe = getRunningShipCompRecipe(); if (!recipe) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
        if (!hasEnoughMats(recipe.cost)) { stopOrSkip(); updateUI(); return; }
        const actualTime = getShipEngineeringCycleDuration(gameState, recipe); // 唯一周期公式（技能×船坞）
        gameState.currentAction.refDuration = actualTime;
        const now = Date.now(); const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
        gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
        while (gameState.currentAction.progress >= actualTime) {
          if (!hasEnoughMats(recipe.cost)) { stopOrSkip(); updateUI(); return; }
          gameState.currentAction.progress -= actualTime;
          deductMats(recipe.cost);
          ResourceRegistry.add(gameState, "component:" + recipe.id, 1);
          s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
          GameEvents.emit("manufacturing:completed", { branch:"component", recipeId:recipe.id, resourceId:"component:" + recipe.id, quantity:1, time:recipe.time, xp:recipe.xp }, { offline:false });
          if (completeQueuedActionCycle()) {
            // Batch K：intship 阶段推进（队列清空后唯一推进点，非 intship 驱动时内部为无操作）
            if (typeof advanceIntshipAfterManufacturingAction === "function") advanceIntshipAfterManufacturingAction(gameState, { now:Date.now(), offline:false });
            updateUI(); break;
          }
        }
        if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
        if (s.xp > 0) checkLevelUp("shipEngineering");
      } else if (sub === "assembly") {
        const recipe = getRunningShipAsmRecipe(); if (!recipe) { resetActionProgress(); gameState.currentAction.active = false; updateUI(); return; }
        if (!hasEnoughShipAssemblyComponents(recipe)) { stopOrSkip(); updateUI(); return; }
        const actualTime = getShipEngineeringCycleDuration(gameState, recipe); // 唯一周期公式（技能×船坞）
        gameState.currentAction.refDuration = actualTime;
        const now = Date.now(); const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
        gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
        while (gameState.currentAction.progress >= actualTime) {
          if (!hasEnoughShipAssemblyComponents(recipe)) { stopOrSkip(); updateUI(); return; }
          gameState.currentAction.progress -= actualTime;
          deductShipAssemblyComponents(recipe);
          if (!gameState.inventory.ships) gameState.inventory.ships = [];
          gameState.inventory.ships.push(createShipInstance(recipe.shipId));
          s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
          GameEvents.emit("manufacturing:completed", { branch:"ship", recipeId:recipe.id, shipId:recipe.shipId, quantity:1, time:recipe.time, xp:recipe.xp }, { offline:false });
          if (completeQueuedActionCycle()) {
            // Batch K：intship 阶段推进（队列清空后唯一推进点，非 intship 驱动时内部为无操作）
            if (typeof advanceIntshipAfterManufacturingAction === "function") advanceIntshipAfterManufacturingAction(gameState, { now:Date.now(), offline:false });
            updateUI(); break;
          }
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
      // 维修后自动恢复（Phase 3D）：重新校验条件/资源；不足则安全停止（不抛错），充足则清标记续跑。
      if (gameState.resumeAfterRepair && gameState.resumeAfterRepair.type === "archaeology") {
        const chk = (typeof canStartArchaeology === "function") ? canStartArchaeology(gameState, now) : { ok:true };
        if (!chk.ok) {
          gameState.resumeAfterRepair = null;
          stopOrSkip(); updateUI(); return;
        }
        gameState.resumeAfterRepair = null;
        GameEvents.emit("archaeology:resumedAfterRepair", { siteId:arch.startedSiteId }, { offline:false });
      }
    }
    // 维修中：暂停并清空进度
    if (arch.repairUntil > now) { gameState.currentAction.progress = 0; updateUI(); return; }
    // 信号干扰中：暂停并清空进度
    if (arch.interferenceUntil > now) { gameState.currentAction.progress = 0; updateUI(); return; }

    // 考古周期唯一公式（研究批次 G · archEff）：base × 增强剂 ÷ 空间站后勤 ÷ 科研倍率。
    // 在线 tick / 离线 descriptor / 离线时间账本 / 显示态四处共用 getArchaeologyCycleSeconds，禁止此处再算第二套。
    const actualTime = (typeof getArchaeologyCycleSeconds === "function")
      ? getArchaeologyCycleSeconds(gameState, site)
      : site.time;
    gameState.currentAction.refDuration = actualTime;
    const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
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
          // 维修后自动恢复（Phase 3D）：记录被打断的考古 run，供维修完成后重新校验续跑。
          gameState.resumeAfterRepair = {
            type:"archaeology",
            siteId:arch.startedSiteId,
            probeId:arch.startedProbeId,
            shipInstanceId:arch.repairInstanceId
          };
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
      const now = Date.now(); const delta = gameDeltaSec(Math.min(5, (now - gameState.currentAction.lastProgressUpdate) / 1000));
      gameState.currentAction.progress += delta; gameState.currentAction.lastProgressUpdate = now;
      while (gameState.currentAction.progress >= actualTime) {
        if (!hasEnoughBoosterInputs(recipe, 1)) { stopOrSkip(); updateUI(); return; }
        gameState.currentAction.progress -= actualTime;
        deductBoosterInputs(recipe, 1);
        // 脑插·增强剂双生：3% 概率本次产出×2（inputs 仍扣 1 份，与离线一致）
        applyBoosterOutput(recipe, (Math.random() < getImplantDoubleOutputChance(gameState, "booster")) ? 2 : 1);
        s.xp += recipe.xp; gameState._dirty = true; actionCompleted = true;
        GameEvents.emit("booster:manufactured", { recipeId:recipe.id, itemId:recipe.output.itemId, series:recipe.series, quality:recipe.quality, quantity:1, time:recipe.time, xpGained:recipe.xp, offline:false }, { offline:false });
        if (completeQueuedActionCycle()) { updateUI(); break; }
      }
      if (gameState.currentAction.progress < 0.01 && gameState.currentAction.active) gameState.currentAction.progress = 0;
      if (s.xp > 0) checkLevelUp("boosterEngineering");
    }
  }

  // 行星产出（独立于主动技能，始终运行）
  planetaryTick();

  // 空间站本体建设（Phase 3C-2）：独立于 currentAction，断油/维护/停止均不暂停；到期恰好完成一次
  if (typeof completeStationConstruction === "function") completeStationConstruction(gameState, { offline: false });

  // 空间站自动线（Phase 3C-5）：独立于 currentAction，每条线自跟踪时间
  if (typeof processAutoLines === "function") processAutoLines(gameState, Date.now(), false);

  gameState.lastActiveTime = Date.now();
  updateLiveUI();
  if (actionCompleted) refreshVisiblePanelAfterAction();
}
