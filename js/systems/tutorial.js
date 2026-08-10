// ---- 新手引导：运行时系统（Batch O）----
// 负责任务状态推进、事件消费者、奖励原子发放、防重复、旧档迁移引导、同一次出击 run token。
// 不做任何 UI 渲染；只读 API 不得修改状态。
// 依赖（须在本文件之前加载）：js/data/tutorial.js、js/core/tutorial-state.js、
// js/core/events.js、js/core/resources.js、js/core/state.js（createShipInstance / getShipInstance）。
(function () {
  "use strict";

  // ---- 稳定 reason ----
  const REASON = {
    INVALID_STATE: "INVALID_STATE",
    UNKNOWN_TASK: "UNKNOWN_TASK",
    TASK_LOCKED: "TASK_LOCKED",
    TASK_NOT_ACTIVE: "TASK_NOT_ACTIVE",
    TASK_NOT_CLAIMABLE: "TASK_NOT_CLAIMABLE",
    ALREADY_COMPLETED: "ALREADY_COMPLETED",
    ALREADY_CLAIMED: "ALREADY_CLAIMED",
    INVALID_CHOICE: "INVALID_CHOICE",
    CHOICE_ALREADY_SET: "CHOICE_ALREADY_SET",
    REQUIREMENTS_UNMET: "REQUIREMENTS_UNMET",
    REWARD_UNAVAILABLE: "REWARD_UNAVAILABLE",
    BLUEPRINT_UNAVAILABLE: "BLUEPRINT_UNAVAILABLE",
    EVENTS_UNAVAILABLE: "EVENTS_UNAVAILABLE",
    EMERGENCY_NOT_AVAILABLE: "EMERGENCY_NOT_AVAILABLE",
    EMERGENCY_ALREADY_GRANTED: "EMERGENCY_ALREADY_GRANTED",
    NOTHING_TO_RECONCILE: "NOTHING_TO_RECONCILE"
  };

  const TRACK_WEAPON = { laser: "t1_small_laser", missile: "t1_light_missile_launcher", cannon: "t1_small_cannon" };

  let _consumersInstalled = false;

  function def(id) { return (typeof TutorialData !== "undefined" && TutorialData.byId) ? TutorialData.byId[id] : null; }
  function ts(state, id) { return state && state.tutorial && state.tutorial.taskStateById ? state.tutorial.taskStateById[id] || null : null; }
  function nowMs(now) { const n = Number(now); return Number.isFinite(n) && n > 0 ? n : Date.now(); }
  function markDirty(state) { if (state) state._dirty = true; }

  function shipInstanceById(state, instanceId) {
    if (!state || !state.inventory || !Array.isArray(state.inventory.ships)) return null;
    return state.inventory.ships.find(s => s.instanceId === instanceId) || null;
  }
  function shipInstanceByShipId(state, shipId) {
    if (!state || !state.inventory || !Array.isArray(state.inventory.ships)) return null;
    return state.inventory.ships.find(s => s.shipId === shipId) || null;
  }
  function shipHasEquipment(state, ship, itemId) {
    if (!ship || !ship.fitted || !state.equipment || !Array.isArray(state.equipment.instances)) return false;
    for (const slot of ["high", "mid", "low", "rig"]) {
      const arr = ship.fitted[slot];
      if (!Array.isArray(arr)) continue;
      for (const ref of arr) {
        if (!ref) continue;
        const inst = state.equipment.instances.find(i => i.instanceId === ref);
        if (inst && inst.itemId === itemId) return true;
      }
    }
    return false;
  }
  function isValidShipId(shipId) {
    if (typeof getShipConfigById === "function") return Boolean(getShipConfigById(shipId));
    return typeof shipInstanceByShipId === "function";
  }
  function isValidEquipmentId(id) {
    return typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB && Object.prototype.hasOwnProperty.call(EQUIPMENT_DB, id);
  }
  function isValidBlueprintId(id) {
    if (typeof SHIP_BLUEPRINTS !== "undefined" && SHIP_BLUEPRINTS) {
      if (SHIP_BLUEPRINTS.some(b => b.shipId === id)) return true;
    }
    return isValidShipId(id);
  }

  // ---- 弹药引用解析（局部、纯读）----
  // 仅允许 ammo:laser / ammo:missile / ammo:cannon 三种；未知 ammo:* 必须拒绝，
  // 不得让 ResourceRegistry 动态注册占位 def。普通资源命名空间不经过此解析。
  function isAmmoRef(id) {
    return typeof id === "string" && id.indexOf("ammo:") === 0;
  }
  function resolveAmmoType(id) {
    if (id === "ammo:laser") return "laser";
    if (id === "ammo:missile") return "missile";
    if (id === "ammo:cannon") return "cannon";
    return null; // 已知 ammo 命名空间但类型非法 → 拒绝
  }

  // ---- 奖励原子原语：先全量校验，再统一写入 ----
  function validateReward(state, reward) {
    if (!reward || typeof reward !== "object") return { ok: true };
    const ra = reward.resourceAmounts || {};
    for (const id of Object.keys(ra)) {
      const qty = Number(ra[id]);
      if (!(qty >= 0) || !Number.isInteger(qty)) return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
      if (isAmmoRef(id)) {
        const ammoType = resolveAmmoType(id);
        if (ammoType === null) return { ok: false, reason: REASON.REWARD_UNAVAILABLE }; // 未知 ammo 类型拒绝，不放行到 ResourceRegistry
        if (typeof addAmmo !== "function") return { ok: false, reason: REASON.REWARD_UNAVAILABLE }; // 确认 addAmmo 可用
        continue; // 三种合法 ammo 类型：不经 ResourceRegistry 校验
      }
      if (typeof ResourceRegistry === "undefined" || !ResourceRegistry.getDefinition(id)) return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
    }
    const eq = reward.equipment || {};
    for (const id of Object.keys(eq)) {
      const count = Number(eq[id]);
      if (!(count >= 0) || !Number.isInteger(count)) return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
      if (!isValidEquipmentId(id)) return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
    }
    const ships = reward.ships || {};
    for (const id of Object.keys(ships)) {
      const spec = ships[id];
      const count = spec && Number(spec.count);
      if (!(count >= 0) || !Number.isInteger(count)) return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
      if (!isValidShipId(id)) return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
      if (!spec || spec.fitting !== "empty") return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
    }
    const bp = reward.blueprints || {};
    for (const id of Object.keys(bp)) {
      const count = Number(bp[id]);
      if (!(count >= 0) || !Number.isInteger(count)) return { ok: false, reason: REASON.BLUEPRINT_UNAVAILABLE };
      if (!isValidBlueprintId(id)) return { ok: false, reason: REASON.BLUEPRINT_UNAVAILABLE };
    }
    return { ok: true };
  }

  function grantReward(state, reward, ctx) {
    const v = validateReward(state, reward);
    if (!v.ok) return { ok: false, reason: v.reason };
    if (!reward || typeof reward !== "object") {
      if (ctx && ctx.ledgerKey) state.tutorial.rewardLedger[ctx.ledgerKey] = nowMs(ctx.now);
      if (ctx && ctx.taskId) emitRewardClaimed(state, ctx.taskId, nowMs(ctx.now));
      return { ok: true };
    }
    const now = nowMs(ctx ? ctx.now : null);

    // 资源（普通命名空间经 ResourceRegistry；ammo:* 三种分流至正式 state.ammo 实例）
    const ra = reward.resourceAmounts || {};
    if (typeof ResourceRegistry !== "undefined") {
      for (const id of Object.keys(ra)) {
        if (isAmmoRef(id)) continue; // 弹药走 addAmmo，不写废弃计数池 resources.ammunition
        ResourceRegistry.add(state, id, Number(ra[id]));
      }
    }
    // 弹药分流：三种 ammo:* 经正式 addAmmo 写入 state.ammo 实例数组（T1，默认 props/name）
    const ammoRefs = Object.keys(ra).filter(isAmmoRef);
    if (ammoRefs.length && typeof addAmmo === "function") {
      for (const id of ammoRefs) {
        const ammoType = resolveAmmoType(id);
        if (ammoType === null) continue; // 理论上已被 validateReward 拦截
        const qty = Number(ra[id]) || 0;
        if (qty <= 0) continue; // 数量为 0 时不创建空弹药栈
        addAmmo(state, { type: ammoType, tier: "T1", qty });
      }
    }
    // 装备
    const eq = reward.equipment || {};
    if (!state.equipment) state.equipment = { inventory: [], instances: [], nextInstanceId: 1 };
    if (!Array.isArray(state.equipment.inventory)) state.equipment.inventory = [];
    for (const id of Object.keys(eq)) {
      const count = Number(eq[id]) || 0;
      for (let i = 0; i < count; i++) state.equipment.inventory.push(id);
    }
    // 舰船（空配）
    const ships = reward.ships || {};
    if (!state.inventory) state.inventory = { ships: [], equipment: [], rigs: [] };
    if (!Array.isArray(state.inventory.ships)) state.inventory.ships = [];
    for (const id of Object.keys(ships)) {
      const spec = ships[id];
      const count = Number(spec.count) || 0;
      for (let i = 0; i < count; i++) {
        const inst = (typeof createShipInstance === "function")
          ? createShipInstance(id, now)
          : { shipId: id, instanceId: "ship_" + now + "_" + Math.random().toString(36).slice(2, 8), builtAt: now, fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
        state.inventory.ships.push(inst);
      }
    }
    // 蓝图
    const bp = reward.blueprints || {};
    if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
    for (const id of Object.keys(bp)) {
      const count = Number(bp[id]) || 0;
      for (let i = 0; i < count; i++) {
        const already = state.ownedBlueprints.includes(id);
        if (!already) {
          state.ownedBlueprints.push(id);
          if (typeof GameEvents !== "undefined") {
            GameEvents.emit("blueprint:acquired",
              { ownershipKey: id, blueprintKind: "ship", productId: id },
              { timestamp: now, source: "blueprint-store", offline: false });
          }
        }
      }
    }
    if (ctx && ctx.ledgerKey) state.tutorial.rewardLedger[ctx.ledgerKey] = now;
    markDirty(state);
    if (ctx && ctx.taskId) emitRewardClaimed(state, ctx.taskId, now);
    return { ok: true };
  }

  function emitTutorial(type, payload, now) {
    if (typeof GameEvents === "undefined") return;
    GameEvents.emit(type, payload, { timestamp: nowMs(now), source: "tutorial-system", offline: false });
  }
  function emitRewardClaimed(state, taskId, now) {
    emitTutorial("tutorial:rewardClaimed", { taskId, claimedAt: nowMs(now) }, now);
  }

  // ---- 只读奖励解析：普通任务返回 task.reward；有 choiceRewards 的任务按所选轨道解析 ----
  // 纯只读，解析失败稳定返回（不修改任务 / 库存 / 资源 / 账本 / dirty）。
  function resolveTutorialReward(state, task) {
    if (!task || typeof task !== "object") return { ok: false, reason: REASON.UNKNOWN_TASK };
    if (task.choiceRewards && typeof task.choiceRewards === "object") {
      const track = state && state.tutorial ? state.tutorial.selectedCombatTrack : null;
      const reward = track ? task.choiceRewards[track] : null;
      if (!reward || typeof reward !== "object") return { ok: false, reason: REASON.INVALID_CHOICE };
      return { ok: true, reward, track };
    }
    if (!task.reward || typeof task.reward !== "object") return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
    return { ok: true, reward: task.reward };
  }

  // ---- 任务推进 ----
  function setActive(state, id, now) {
    const t = def(id); const tsd = ts(state, id);
    if (!t || !tsd) return;
    if (tsd.status === "locked") {
      tsd.status = "active";
      tsd.activatedAt = nowMs(now);
    }
    if (id === "P5") {
      tsd.baseline = (state.inventory.ships || [])
        .filter(s => s.shipId === "rookie_corvette")
        .map(s => s.instanceId);
    }
  }

  function completeTask(state, id, now) {
    const t = def(id); const tsd = ts(state, id);
    if (!t || !tsd) return false;
    if (tsd.status === "completed" || tsd.status === "legacyCompleted") return false;
    tsd.status = "completed";
    tsd.completedAt = nowMs(now);
    markDirty(state);
    emitTutorial("tutorial:taskCompleted", { taskId: id, chapter: t.chapter, completedAt: tsd.completedAt }, now);
    activateNext(state, id, now);
    return true;
  }

  function activateNext(state, id, now) {
    const t = def(id);
    if (!t) return;
    if (t.chapter === "prologue") {
      const next = (typeof TutorialData !== "undefined")
        ? TutorialData.tasks.find(x => x.chapter === "prologue" && x.order === t.order + 1) : null;
      if (next) setActive(state, next.id, now);
      if (id === "P7") {
        state.tutorial.branchStatus = { industrial: "active", archaeology: "active", combat: "active" };
        setActive(state, "I1", now);
        setActive(state, "A1", now);
        setActive(state, "C1", now);
        emitTutorial("tutorial:branchesUnlocked", { unlockedAt: nowMs(now) }, now);
      }
    } else {
      const next = (typeof TutorialData !== "undefined")
        ? TutorialData.tasks.find(x => x.chapter === t.chapter && x.order === t.order + 1) : null;
      if (next) setActive(state, next.id, now);
      else if (state.tutorial.branchStatus[t.chapter]) state.tutorial.branchStatus[t.chapter] = "completed";
    }
  }

  // ---- 目标达成判定 ----
  function objectiveMet(state, task, tsd) {
    switch (task.id) {
      case "P2": return (tsd.progress.integrated_hull || 0) >= 1;
      case "P3": return (tsd.progress.power_core || 0) >= 1;
      case "P4": return (tsd.progress.functional_system || 0) >= 1;
      case "P5": {
        const inst = shipInstanceById(state, tsd.instanceId);
        return Boolean(inst) && inst.shipId === "rookie_corvette"
          && state.shipAssignments && state.shipAssignments.combat === tsd.instanceId;
      }
      case "I1": {
        const rookie = shipInstanceByShipId(state, "rookie_corvette");
        if (!rookie) return false;
        const installed = shipHasEquipment(state, rookie, "t1_mining_laser");
        const assigned = state.shipAssignments && state.shipAssignments.mining === rookie.instanceId;
        return installed && assigned;
      }
      case "I2": return (tsd.progress.mined || 0) >= (task.target.count || 0);
      case "I3": return (tsd.progress.refined || 0) >= (task.target.count || 0);
      case "I4": {
        const deployed = (state.planetary && Array.isArray(state.planetary.deployments))
          ? state.planetary.deployments.map(d => d.planetType) : [];
        return deployed.includes("lava") && deployed.includes("gas");
      }
      case "I5": return (tsd.progress.heavyMetal || 0) >= 18 && (tsd.progress.rareGas || 0) >= 18;
      case "I6": return (tsd.progress.integrated_hull || 0) >= 2
        && (tsd.progress.power_core || 0) >= 2
        && (tsd.progress.functional_system || 0) >= 2;
      case "I7": return tsd.shipBuilt === true;
      case "A2": {
        const inst = shipInstanceById(state, state.shipAssignments && state.shipAssignments.archaeology);
        return Boolean(inst) && inst.shipId === "rookie_corvette";
      }
      case "A3": return tsd.attemptDone === true;
      case "A4": return tsd.artifactFound === true;
      case "A5": return tsd.artifactDisposed === true;
      case "A6": return true; // 确认类，激活即可领取
      case "C2": {
        const track = state.tutorial.selectedCombatTrack;
        if (!track) return false;
        const rookie = shipInstanceByShipId(state, "rookie_corvette");
        if (!rookie) return false;
        return shipHasEquipment(state, rookie, TRACK_WEAPON[track])
          && shipHasEquipment(state, rookie, "t1_shield_booster");
      }
      case "C3": {
        const inst = shipInstanceById(state, state.shipAssignments && state.shipAssignments.combat);
        const zoneOk = task.target.zones.includes(state.combat && state.combat.zone);
        return Boolean(inst) && inst.shipId === "rookie_corvette" && zoneOk;
      }
      case "C4": return tsd.kill === true;
      case "C5": return tsd.wave1 === true && Boolean(tsd.c5Token);
      case "C6": return tsd.wave4 === true && Boolean(tsd.c6Token) && tsd.c6Token === tsd.c5Token;
      default: return false;
    }
  }

  function reconcileTutorialState(state, now) {
    if (!state || !state.tutorial) return { ok: false, reason: REASON.INVALID_STATE };
    const tasks = (typeof TutorialData !== "undefined") ? TutorialData.tasks : [];
    let changed = false;
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const tsd = ts(state, task.id);
      if (!tsd) continue;
      if (tsd.status === "active") {
        const met = objectiveMet(state, task, tsd);
        if (!met) continue;
        if (task.rewardTiming === "afterObjective") {
          tsd.status = "claimable";
          markDirty(state);
          changed = true;
        } else {
          // automatic / beforeObjective：直接完成（beforeObjective 奖励已在领取时发放）
          if (completeTask(state, task.id, now)) changed = true;
        }
      }
      // claimable 状态等待玩家领取，不自动完成
    }
    state.tutorial.lastReconciledAt = nowMs(now);
    if (changed) markDirty(state);
    return { ok: true, changed };
  }

  // ---- 公开动作 API ----
  function claimTutorialTask(state, taskId, now) {
    const task = def(taskId);
    if (!task) return { ok: false, reason: REASON.UNKNOWN_TASK };
    const tsd = ts(state, taskId);
    if (!tsd) return { ok: false, reason: REASON.UNKNOWN_TASK };
    const ledgerKey = taskId;
    // 已领取奖励优先于已完成：claim 类任务领取后即 completed，重复领取应报 ALREADY_CLAIMED（原子防重复）
    if (state.tutorial.rewardLedger[ledgerKey]) return { ok: false, reason: REASON.ALREADY_CLAIMED };
    if (tsd.status === "completed" || tsd.status === "legacyCompleted") return { ok: false, reason: REASON.ALREADY_COMPLETED };
    if (tsd.status === "locked") return { ok: false, reason: REASON.TASK_LOCKED };

    if (task.completionMode === "choice") return { ok: false, reason: REASON.INVALID_STATE };

    // 解析实际奖励（普通任务=task.reward；有 choiceRewards=按所选轨道）。
    // 解析失败稳定返回，且不修改任务 / 库存 / 资源 / 账本 / dirty。
    const resolved = resolveTutorialReward(state, task);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };

    if (task.completionMode === "claim") {
      if (task.rewardTiming === "beforeObjective") {
        // 先发支援包，任务保持 active，目标达成后由 reconcile 完成
        const r = grantReward(state, resolved.reward, { ledgerKey, taskId, now });
        if (!r.ok) return r;
        tsd.supportClaimed = true;
        tsd.rewardClaimed = true;
        return { ok: true, changed: true, supportGranted: true };
      }
      if (task.rewardTiming === "afterObjective" && tsd.status !== "claimable") {
        return { ok: false, reason: REASON.TASK_NOT_CLAIMABLE };
      }
      const r = grantReward(state, resolved.reward, { ledgerKey, taskId, now });
      if (!r.ok) return r;
      tsd.rewardClaimed = true;
      completeTask(state, taskId, now);
      return { ok: true, changed: true };
    }

    if (task.completionMode === "confirm") {
      const r = grantReward(state, resolved.reward, { ledgerKey, taskId, now });
      if (!r.ok) return r;
      tsd.rewardClaimed = true;
      completeTask(state, taskId, now);
      return { ok: true, changed: true };
    }

    return { ok: false, reason: REASON.INVALID_STATE };
  }

  function confirmTutorialTask(state, taskId, now) {
    const task = def(taskId);
    if (!task) return { ok: false, reason: REASON.UNKNOWN_TASK };
    const tsd = ts(state, taskId);
    if (!tsd) return { ok: false, reason: REASON.UNKNOWN_TASK };
    if (tsd.status === "completed" || tsd.status === "legacyCompleted") return { ok: false, reason: REASON.ALREADY_COMPLETED };
    if (tsd.status === "locked") return { ok: false, reason: REASON.TASK_LOCKED };
    if (state.tutorial.rewardLedger[taskId]) return { ok: false, reason: REASON.ALREADY_CLAIMED };
    const r = grantReward(state, task.reward, { ledgerKey: taskId, taskId, now });
    if (!r.ok) return r;
    tsd.rewardClaimed = true;
    completeTask(state, taskId, now);
    return { ok: true, changed: true };
  }

  function chooseTutorialCombatTrack(state, track, now) {
    const task = def("C1");
    if (!task) return { ok: false, reason: REASON.UNKNOWN_TASK };
    const tsd = ts(state, "C1");
    if (!tsd) return { ok: false, reason: REASON.UNKNOWN_TASK };
    // 已选轨道优先于状态检查：选择方向为一次性动作，轨道锁定后即便任务状态异常也不应重复选择
    if (state.tutorial.selectedCombatTrack !== null) return { ok: false, reason: REASON.CHOICE_ALREADY_SET };
    if (tsd.status === "completed") return { ok: false, reason: REASON.ALREADY_COMPLETED };
    if (tsd.status === "locked") return { ok: false, reason: REASON.TASK_LOCKED };
    if (!task.target.tracks.includes(track)) return { ok: false, reason: REASON.INVALID_CHOICE };
    const reward = task.choiceRewards && task.choiceRewards[track];
    if (!reward) return { ok: false, reason: REASON.REWARD_UNAVAILABLE };
    if (state.tutorial.rewardLedger["C1"]) return { ok: false, reason: REASON.ALREADY_CLAIMED };
    const r = grantReward(state, reward, { ledgerKey: "C1", taskId: "C1", now });
    if (!r.ok) return r;
    state.tutorial.selectedCombatTrack = track;
    tsd.rewardClaimed = true;
    emitTutorial("tutorial:combatTrackSelected", { track, selectedAt: nowMs(now) }, now);
    completeTask(state, "C1", now);
    return { ok: true, changed: true, track };
  }

  function claimEmergencyTutorialShip(state, now) {
    const p5 = ts(state, "P5");
    if (!p5 || p5.status !== "completed") return { ok: false, reason: REASON.EMERGENCY_NOT_AVAILABLE };
    // 已发放优先于「有舰船」检查：应急舰船一旦发放即视为完成，重复调用应报 ALREADY_GRANTED
    if (state.tutorial.emergencyShipGranted) return { ok: false, reason: REASON.EMERGENCY_ALREADY_GRANTED };
    const ships = (state.inventory && Array.isArray(state.inventory.ships)) ? state.inventory.ships : [];
    if (ships.length > 0) return { ok: false, reason: REASON.EMERGENCY_NOT_AVAILABLE };
    const inst = (typeof createShipInstance === "function")
      ? createShipInstance("rookie_corvette", nowMs(now))
      : { shipId: "rookie_corvette", instanceId: "ship_" + nowMs(now) + "_em", builtAt: nowMs(now), fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
    if (!state.inventory) state.inventory = { ships: [], equipment: [], rigs: [] };
    state.inventory.ships.push(inst);
    state.tutorial.emergencyShipGranted = true;
    state.tutorial.rewardLedger["recovery:emergencyCorvette"] = nowMs(now);
    markDirty(state);
    emitTutorial("tutorial:emergencyShipGranted", { instanceId: inst.instanceId, grantedAt: nowMs(now) }, now);
    return { ok: true, changed: true, instanceId: inst.instanceId };
  }

  function noteTutorialActionResult(state, action, result, now) {
    if (!action || typeof action.type !== "string") return { ok: false, reason: REASON.INVALID_STATE };
    const t = state && state.tutorial;
    if (!t) return { ok: false, reason: REASON.INVALID_STATE };
    const changed = result && result.changed;
    switch (action.type) {
      case "combat/start":
        if (changed) {
          t.combatRunSequence += 1;
          t.activeCombatRunToken = "run_" + t.combatRunSequence + "_" + nowMs(now);
          markDirty(state);
        }
        if (changed) reconcileTutorialState(state, now);
        return { ok: true };
      case "combat/stop":
      case "combat/selectZone":
        if (changed) { t.activeCombatRunToken = null; markDirty(state); reconcileTutorialState(state, now); }
        return { ok: true };
      case "hangar/toggleAssignment":
      case "hangar/equipCombatShip":
        if (changed) reconcileTutorialState(state, now);
        return { ok: true };
      default:
        return { ok: false, reason: REASON.INVALID_STATE };
    }
  }

  // ---- 事件消费者 ----
  function bump(state, id, key, qty) {
    const tsd = ts(state, id);
    if (!tsd) return;
    if (tsd.status !== "active" && tsd.status !== "claimable") return;
    tsd.progress[key] = (Number(tsd.progress[key]) || 0) + (Number(qty) || 0);
    markDirty(state);
  }

  function onManufacturing(state, event) {
    const p = event && event.payload;
    if (!p) return;
    if (p.branch === "component") {
      const recipeId = p.recipeId;
      const qty = Number(p.quantity) || 0;
      const map = { integrated_hull: "P2", power_core: "P3", functional_system: "P4" };
      if (map[recipeId]) bump(state, map[recipeId], recipeId, qty);
      bump(state, "I6", recipeId, qty);
    } else if (p.branch === "ship" && p.shipId === "rookie_corvette") {
      const tsd = ts(state, "P5");
      if (tsd && (tsd.status === "active" || tsd.status === "claimable")) {
        const baseline = Array.isArray(tsd.baseline) ? tsd.baseline : [];
        const rookies = (state.inventory.ships || []).filter(s => s.shipId === "rookie_corvette" && baseline.indexOf(s.instanceId) < 0);
        if (rookies.length) { tsd.instanceId = rookies[0].instanceId; markDirty(state); }
      }
    } else if (p.branch === "ship" && p.shipId === "miner_frigate") {
      const tsd = ts(state, "I7");
      if (tsd && (tsd.status === "active" || tsd.status === "claimable")) { tsd.shipBuilt = true; markDirty(state); }
    }
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onMining(state, event) {
    const p = event && event.payload;
    if (p && p.resourceId === "ore:凡晶石") bump(state, "I2", "mined", Number(p.quantity) || 0);
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onRefining(state, event) {
    const p = event && event.payload;
    if (p && p.outputId === "mineral:三钛合金") bump(state, "I3", "refined", Number(p.outputQuantity) || 0);
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onPlanetDeployed(state, event) {
    const p = event && event.payload;
    const tsd = ts(state, "I4");
    if (p && tsd && (tsd.status === "active" || tsd.status === "claimable") && (p.planetType === "lava" || p.planetType === "gas")) {
      const arr = Array.isArray(tsd.progress.deployedTypes) ? tsd.progress.deployedTypes : [];
      if (arr.indexOf(p.planetType) < 0) { arr.push(p.planetType); tsd.progress.deployedTypes = arr; markDirty(state); }
    }
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onPlanetCollected(state, event) {
    const p = event && event.payload;
    if (!p) return;
    if (p.resourceId === "planetary:重金属") bump(state, "I5", "heavyMetal", Number(p.quantity) || 0);
    if (p.resourceId === "planetary:稀有气体") bump(state, "I5", "rareGas", Number(p.quantity) || 0);
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onArchAttempt(state, event) {
    const p = event && event.payload;
    const task = def("A3");
    const tsd = ts(state, "A3");
    if (p && task && tsd && task.target.sites.includes(p.siteId)) { tsd.attemptDone = true; markDirty(state); }
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onArchFound(state, event) {
    const tsd = ts(state, "A4");
    if (tsd) { tsd.artifactFound = true; markDirty(state); }
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onArchDispose(state, event) {
    const tsd = ts(state, "A5");
    if (tsd) { tsd.artifactDisposed = true; markDirty(state); }
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onEnemyDefeated(state, event) {
    const tsd = ts(state, "C4");
    if (tsd) { tsd.kill = true; markDirty(state); }
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onWaveCleared(state, event) {
    const p = event && event.payload;
    if (!p) return;
    const wave = Number(p.wave);
    const token = state.tutorial.activeCombatRunToken;
    const c5 = def("C5"), c6 = def("C6");
    // C5 不限制 zone（target 无 zones），任意 zone 的第 1 波均可计入；C6 须落在指定 zones 内
    const c5ZoneOk = c5 && c5.target && Array.isArray(c5.target.zones) ? c5.target.zones.includes(p.zoneId) : true;
    const c6ZoneOk = c6 && c6.target && Array.isArray(c6.target.zones) ? c6.target.zones.includes(p.zoneId) : false;
    if (wave === 1 && c5ZoneOk && token) {
      const c5tsd = ts(state, "C5");
      if (c5tsd) { c5tsd.wave1 = true; c5tsd.c5Token = token; markDirty(state); }
      // C6 同次锚点：第 1 波清场写入本次 run token；若 C6 尚未完成 / claimable，新一局第 1 波可替换旧锚点（修复重开出击卡死）
      const c6tsd = ts(state, "C6");
      if (c6tsd && c6tsd.status !== "completed" && c6tsd.status !== "claimable") {
        c6tsd.c5Token = token; markDirty(state);
      }
    }
    if (wave === 4 && c6ZoneOk && token) {
      const tsd = ts(state, "C6");
      // 同次校验：第 4 波 token 须与第 1 波锚点一致；已完成 / claimable 的 C6 不得被后续事件回退或覆盖
      if (tsd && tsd.c5Token && token === tsd.c5Token && tsd.status !== "completed" && tsd.status !== "claimable") {
        tsd.wave4 = true; tsd.c6Token = token; markDirty(state);
      }
    }
    reconcileTutorialState(state, event && event.timestamp);
  }
  function onShipDestroyed(state, event) {
    state.tutorial.activeCombatRunToken = null;
    markDirty(state);
  }
  // Batch S：离线战斗聚合事件驱动 C4/C5/C6。不重放 combat:waveCleared（指令禁止逐波事件），
  // 改由聚合 payload.runsDetail 一次性推进。C4=任意击杀；C5=某次出击清第 1 波；C6=同次出击清第 4 波。
  // 离线单次会话只产 1 个 runsDetail 条目（settle 仅首段 activeAtStart 时入列），故同次校验天然成立。
  function onOfflineCombatSettled(state, event) {
    const p = event && event.payload;
    if (!p || !p.runsDetail || !Array.isArray(p.runsDetail) || !state.tutorial) return;
    // C4：本段离线有任何击杀即达成
    if (Number(p.kills) > 0) {
      const c4 = ts(state, "C4");
      if (c4 && (c4.status === "active" || c4.status === "claimable")) { c4.kill = true; markDirty(state); }
    }
    // C5/C6：按 runsDetail 推进（同条目内 wavesCleared 既含第 1 波也含第 4 波 → 同次 token 一致）
    for (const run of p.runsDetail) {
      if (!run || typeof run.token !== "string") continue;
      if (Number(run.wavesCleared) >= 1) {
        const c5 = ts(state, "C5");
        if (c5 && c5.status !== "completed" && c5.status !== "claimable") { c5.wave1 = true; c5.c5Token = run.token; markDirty(state); }
      }
      if (Number(run.wavesCleared) >= 4) {
        const c6 = ts(state, "C6");
        if (c6 && c6.status !== "completed" && c6.status !== "claimable") {
          c6.c5Token = run.token; c6.c6Token = run.token; c6.wave4 = true; markDirty(state);
        }
      }
    }
    reconcileTutorialState(state, event && event.timestamp);
  }

  function installTutorialConsumers(state) {
    if (_consumersInstalled) return { ok: true, reason: null, already: true };
    if (typeof GameEvents === "undefined") return { ok: false, reason: REASON.EVENTS_UNAVAILABLE };
    const getLedger = () => state.tutorial.eventLedger;
    GameEvents.onIdempotent("manufacturing:completed", { consumerId: "tutorial:prod", getLedger }, e => onManufacturing(state, e));
    GameEvents.onIdempotent("mining:completed", { consumerId: "tutorial:prod", getLedger }, e => onMining(state, e));
    GameEvents.onIdempotent("refining:completed", { consumerId: "tutorial:prod", getLedger }, e => onRefining(state, e));
    GameEvents.onIdempotent("planetary:deployed", { consumerId: "tutorial:planet", getLedger }, e => onPlanetDeployed(state, e));
    GameEvents.onIdempotent("planetary:collected", { consumerId: "tutorial:planet", getLedger }, e => onPlanetCollected(state, e));
    GameEvents.onIdempotent("archaeology:attemptCompleted", { consumerId: "tutorial:arch", getLedger }, e => onArchAttempt(state, e));
    GameEvents.onIdempotent("archaeology:artifactFound", { consumerId: "tutorial:arch", getLedger }, e => onArchFound(state, e));
    GameEvents.onIdempotent("archaeology:artifactSold", { consumerId: "tutorial:arch", getLedger }, e => onArchDispose(state, e));
    GameEvents.onIdempotent("archaeology:artifactRedeemed", { consumerId: "tutorial:arch", getLedger }, e => onArchDispose(state, e));
    GameEvents.onIdempotent("combat:enemyDefeated", { consumerId: "tutorial:combat", getLedger }, e => onEnemyDefeated(state, e));
    GameEvents.onIdempotent("combat:waveCleared", { consumerId: "tutorial:combat", getLedger }, e => onWaveCleared(state, e));
    GameEvents.onIdempotent("ship:destroyed", { consumerId: "tutorial:combat", getLedger }, e => onShipDestroyed(state, e));
    // Batch S：离线战斗聚合事件（具体类型监听，先于通配消费者运行；只驱动 C4/C5/C6，不依赖统计/成就）
    GameEvents.onIdempotent("offline:combatSettled", { consumerId: "tutorial:combat", getLedger }, e => onOfflineCombatSettled(state, e));
    _consumersInstalled = true;
    return { ok: true, reason: null };
  }

  function bootstrap(state, options) {
    const opts = options && typeof options === "object" ? options : {};
    TutorialState.migrateTutorialState(state, { isLegacy: Boolean(opts.isLegacy) });
    installTutorialConsumers(state);
    reconcileTutorialState(state, Number.isFinite(opts.now) ? opts.now : Date.now());
    return state.tutorial;
  }

  // ---- 只读 API ----
  function getTutorialTaskState(state, taskId) {
    return ts(state, taskId);
  }

  // ======================= Batch P：显示态命名与预览（纯只读） =======================
  // 仅做「内部 ID → 原创显示名」的转换，绝不参与任何业务判定；
  // 全部走 DisplayNames / ResourceRegistry / EQUIPMENT_DB，找不到映射时回退内部键。
  const TRACK_LABEL = { laser: "激光", missile: "导弹", cannon: "火炮" };
  const DONE_STATUS = { completed: true, legacyCompleted: true };
  const PLANET_PROGRESS_KEY = { "planetary:重金属": "heavyMetal", "planetary:稀有气体": "rareGas" };

  function resourceDisplayName(refId) {
    const raw = String(refId == null ? "" : refId);
    const idx = raw.indexOf(":");
    const ns = idx > 0 ? raw.slice(0, idx) : "";
    const key = idx > 0 ? raw.slice(idx + 1) : raw;
    if (typeof DisplayNames !== "undefined" && DisplayNames) {
      if (ns === "currency") return DisplayNames.getCurrencyName(key);
      const mapped = DisplayNames.getResourceRefName(raw, null);
      if (mapped && mapped !== key) return mapped;
    }
    if (typeof ResourceRegistry !== "undefined" && ResourceRegistry) {
      const definition = ResourceRegistry.getDefinition(raw);
      if (definition && definition.name) return definition.name;
    }
    return key;
  }
  function componentDisplayName(recipeId) {
    return resourceDisplayName("component:" + String(recipeId));
  }
  function equipmentDisplayName(itemId) {
    if (typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB && EQUIPMENT_DB[itemId] && EQUIPMENT_DB[itemId].name) return EQUIPMENT_DB[itemId].name;
    return String(itemId);
  }
  function shipDisplayName(shipId) {
    if (typeof DisplayNames !== "undefined" && DisplayNames) return DisplayNames.getShipName(shipId, shipId);
    return String(shipId);
  }
  function formatCount(value) {
    const n = Number(value) || 0;
    return n.toLocaleString("zh-CN");
  }

  // 奖励预览条目：resource / equipment / ship / blueprint 四类，text 已是可直接上屏的原创名
  function buildRewardItems(reward) {
    const items = [];
    if (!reward || typeof reward !== "object") return items;
    const ra = reward.resourceAmounts || {};
    for (const id of Object.keys(ra)) {
      const amount = Number(ra[id]) || 0;
      if (amount <= 0) continue;
      const name = resourceDisplayName(id);
      items.push({ kind: "resource", id, name, amount, text: name + " ×" + formatCount(amount) });
    }
    const eq = reward.equipment || {};
    for (const id of Object.keys(eq)) {
      const amount = Number(eq[id]) || 0;
      if (amount <= 0) continue;
      const name = equipmentDisplayName(id);
      items.push({ kind: "equipment", id, name, amount, text: name + " ×" + formatCount(amount) });
    }
    const ships = reward.ships || {};
    for (const id of Object.keys(ships)) {
      const spec = ships[id] || {};
      const amount = Number(spec.count) || 0;
      if (amount <= 0) continue;
      const name = shipDisplayName(id);
      items.push({ kind: "ship", id, name, amount, empty: spec.fitting === "empty", text: (spec.fitting === "empty" ? "空配" : "") + name + " ×" + formatCount(amount) });
    }
    const bp = reward.blueprints || {};
    for (const id of Object.keys(bp)) {
      const amount = Number(bp[id]) || 0;
      if (amount <= 0) continue;
      const name = shipDisplayName(id);
      items.push({ kind: "blueprint", id, name, amount, text: name + "蓝图 ×" + formatCount(amount) });
    }
    return items;
  }

  // 进度摘要：只读「正式任务状态 tsd」与「冻结 target」，不读库存/资源等旁路数据
  function buildProgressSummary(state, task, tsd) {
    const p = (tsd && tsd.progress) || {};
    const t = task.target || {};
    const done = Boolean(tsd && DONE_STATUS[tsd.status]);
    const num = v => Number(v) || 0;
    const mk = (current, target, text) => ({
      current, target,
      ratio: target > 0 ? Math.min(1, Math.max(0, current / target)) : (current > 0 ? 1 : 0),
      text
    });
    const flag = (value, label) => {
      const hit = Boolean(value) || done ? 1 : 0;
      return mk(hit, 1, hit + "/1 " + label);
    };

    switch (task.progressType) {
      case "manufacture": {
        const target = num(t.count);
        const cur = Math.min(num(p[t.recipeId]), target);
        return mk(cur, target, componentDisplayName(t.recipeId) + " " + cur + "/" + target);
      }
      case "manufacture_components": {
        const comps = t.components || {};
        let cur = 0, target = 0; const seg = [];
        for (const id of Object.keys(comps)) {
          const need = num(comps[id]);
          const have = Math.min(num(p[id]), need);
          cur += have; target += need;
          seg.push(componentDisplayName(id) + " " + have + "/" + need);
        }
        return mk(cur, target, seg.join(" · "));
      }
      case "mine": {
        const target = num(t.count);
        const cur = Math.min(num(p.mined), target);
        return mk(cur, target, resourceDisplayName(t.resourceId) + " " + formatCount(cur) + "/" + formatCount(target));
      }
      case "refine": {
        const target = num(t.count);
        const cur = Math.min(num(p.refined), target);
        return mk(cur, target, resourceDisplayName(t.outputId) + " " + formatCount(cur) + "/" + formatCount(target));
      }
      case "planetDeploy": {
        const types = Array.isArray(t.planetTypes) ? t.planetTypes : [];
        const deployed = Array.isArray(p.deployedTypes) ? p.deployedTypes : [];
        const cur = types.filter(x => deployed.indexOf(x) >= 0).length;
        return mk(cur, types.length, "行星部署 " + cur + "/" + types.length);
      }
      case "planetExtract": {
        const res = t.resources || {};
        let cur = 0, target = 0; const seg = [];
        for (const id of Object.keys(res)) {
          const need = num(res[id]);
          const have = Math.min(num(p[PLANET_PROGRESS_KEY[id]]), need);
          cur += have; target += need;
          seg.push(resourceDisplayName(id) + " " + have + "/" + need);
        }
        return mk(cur, target, seg.join(" · "));
      }
      case "claim":
        return mk(tsd && tsd.rewardClaimed ? 1 : 0, 1, tsd && tsd.rewardClaimed ? "1/1 已领取" : "0/1 待领取");
      case "claim_install_assign": {
        const claimed = tsd && tsd.supportClaimed ? 1 : 0;
        const installed = done ? 1 : 0;
        return mk(claimed + installed, 2, "支援包 " + claimed + "/1 · 安装并编入 " + installed + "/1");
      }
      case "build_and_assign": return flag(false, "建造并编入战斗位");
      case "assemble_ship": return flag(tsd && tsd.shipBuilt, "总装完成");
      case "assign": return flag(false, "编入岗位");
      case "install": return flag(false, "装备安装");
      case "assign_and_select_zone": return flag(false, "编队并选定星带");
      case "archaeology_attempt": return flag(tsd && tsd.attemptDone, "遗迹勘测");
      case "obtain_artifact": return flag(tsd && tsd.artifactFound, "获得遗物");
      case "dispose_artifact": return flag(tsd && tsd.artifactDisposed, "遗物兑现");
      case "kill": return flag(tsd && tsd.kill, "击毁目标");
      case "clear_wave": return flag(tsd && tsd.wave1, "第 1 波清场");
      case "clear_wave_same_sortie": return flag(tsd && tsd.wave4, "同次出击第 4 波");
      case "confirm": return mk(done ? 1 : 0, 1, done ? "1/1 已确认" : "0/1 待确认");
      case "choose_combat_training": {
        const track = state && state.tutorial ? state.tutorial.selectedCombatTrack : null;
        return mk(track ? 1 : 0, 1, track ? "1/1 已选择 " + (TRACK_LABEL[track] || track) : "0/1 待选择训练方向");
      }
      default:
        return mk(done ? 1 : 0, 1, done ? "1/1 已完成" : "0/1 进行中");
    }
  }

  // ---- 最终有效 navigationTarget（纯只读，绝不修改 state.tutorial）----
  // 指令：P1/P6/P7/A1/C1 永不导航；completed/legacyCompleted 无导航；
  // I1/I4 支援包未领无导航；I6/I7/A6/C6 claimable 后只领奖励；
  // P5/C3 按真实状态动态切换。shell-render 不复制此逻辑，统一在此派生。
  function computeNavigationTarget(state, task, tsd, isCompleted, isClaimable) {
    const id = task.id;
    if (id === "P1" || id === "P6" || id === "P7" || id === "A1" || id === "C1") return null;
    if (isCompleted) return null;
    if ((id === "I6" || id === "I7" || id === "A6" || id === "C6") && isClaimable) return null;
    if ((id === "I1" || id === "I4") && task.rewardTiming === "beforeObjective" && !tsd.supportClaimed) return null;
    if (id === "P5") {
      const ships = (state.inventory && Array.isArray(state.inventory.ships)) ? state.inventory.ships : [];
      const baseline = Array.isArray(tsd.baseline) ? tsd.baseline : [];
      const hasBuilt = Boolean(tsd.instanceId)
        || ships.some(s => s.shipId === "rookie_corvette" && baseline.indexOf(s.instanceId) < 0);
      if (!hasBuilt) return "shipEngineering";
      const assigned = Boolean(state.shipAssignments) && state.shipAssignments.combat === tsd.instanceId;
      return assigned ? null : "hangar";
    }
    if (id === "C3") {
      const combatId = state.shipAssignments && state.shipAssignments.combat;
      const inst = combatId ? shipInstanceById(state, combatId) : null;
      const assigned = Boolean(inst) && inst.shipId === "rookie_corvette";
      if (!assigned) return "hangar";
      const zones = (task.target && Array.isArray(task.target.zones)) ? task.target.zones : [];
      const zoneOk = zones.includes(state.combat && state.combat.zone);
      return zoneOk ? null : "combat";
    }
    return task.navigationTarget || null;
  }

  // ---- 唯一显示态 API（Batch P 扩充；纯只读，绝不修改 state.tutorial）----
  function getTutorialDisplayState(state) {
    if (!state || !state.tutorial) return null;
    const tasks = (typeof TutorialData !== "undefined") ? TutorialData.tasks : [];
    const chapterDefs = (typeof TutorialData !== "undefined" && Array.isArray(TutorialData.chapters)) ? TutorialData.chapters : [];
    const tut = state.tutorial;
    const ships = (state.inventory && Array.isArray(state.inventory.ships)) ? state.inventory.ships : [];
    const p5 = ts(state, "P5");
    const emergencyShipAvailable = Boolean(p5 && p5.status === "completed") && !tut.emergencyShipGranted && ships.length === 0;

    const out = {
      schemaVersion: tut.schemaVersion,
      legacy: tut.legacy,
      prologueStatus: tut.prologueStatus,
      prologueCompleted: false,
      branchStatus: Object.assign({}, tut.branchStatus),
      branchesUnlocked: Boolean(tut.branchStatus && tut.branchStatus.industrial && tut.branchStatus.industrial !== "locked"),
      selectedCombatTrack: tut.selectedCombatTrack,
      selectedCombatTrackLabel: tut.selectedCombatTrack ? (TRACK_LABEL[tut.selectedCombatTrack] || tut.selectedCombatTrack) : null,
      emergencyShipGranted: tut.emergencyShipGranted,
      emergencyShipAvailable,
      combatRunTokenActive: Boolean(tut.activeCombatRunToken),
      completedCount: 0,
      totalCount: tasks.length,
      allCompleted: false,
      chapters: [],
      chapterById: {},
      currentTaskId: null,
      tasks: [],
      taskById: {}
    };

    for (let i = 0; i < chapterDefs.length; i++) {
      const c = chapterDefs[i];
      const entry = {
        id: c.id, name: c.name, order: c.order, speaker: c.speaker, summary: c.summary,
        completed: 0, total: 0, currentTaskId: null,
        status: c.id === "prologue" ? tut.prologueStatus : ((tut.branchStatus && tut.branchStatus[c.id]) || "locked")
      };
      out.chapters.push(entry);
      out.chapterById[c.id] = entry;
    }

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const tsd = ts(state, task.id) || {};
      const status = tsd.status || "locked";
      const isCompleted = Boolean(DONE_STATUS[status]);
      const isActive = status === "active";
      const isClaimable = status === "claimable";
      const rewardLocked = Boolean(tut.rewardLedger && tut.rewardLedger[task.id]);
      const resolved = resolveTutorialReward(state, task);
      const reward = resolved.ok ? JSON.parse(JSON.stringify(resolved.reward)) : null;

      const openForAction = !isCompleted && status !== "locked" && !rewardLocked;
      const canClaim = openForAction && task.completionMode === "claim" && resolved.ok
        && (task.rewardTiming === "afterObjective" ? isClaimable : (isActive || isClaimable));
      const canConfirm = openForAction && task.completionMode === "confirm" && isActive;
      const canChooseCombatTrack = openForAction && task.completionMode === "choice"
        && isActive && tut.selectedCombatTrack === null;

      let trackOptions = null;
      if (task.choiceRewards && typeof task.choiceRewards === "object") {
        trackOptions = [];
        const tracks = (task.target && Array.isArray(task.target.tracks)) ? task.target.tracks : Object.keys(task.choiceRewards);
        for (const track of tracks) {
          const r = task.choiceRewards[track];
          if (!r) continue;
          const items = buildRewardItems(r);
          trackOptions.push({
            track,
            label: TRACK_LABEL[track] || track,
            rewardItems: items,
            previewText: items.map(x => x.text).join("、"),
            selected: tut.selectedCombatTrack === track
          });
        }
      }

      const entry = {
        id: task.id,
        chapter: task.chapter,
        chapterName: (out.chapterById[task.chapter] && out.chapterById[task.chapter].name) || task.chapter,
        order: task.order,
        title: task.title,
        speaker: task.speaker,
        briefing: task.briefing,
        objectiveText: task.objectiveText,
        completionText: task.completionText,
        navigationTarget: computeNavigationTarget(state, task, tsd, isCompleted, isClaimable),
        completionMode: task.completionMode,
        rewardTiming: task.rewardTiming,
        progressType: task.progressType,
        status,
        isLocked: status === "locked",
        isActive,
        isClaimable,
        isCompleted,
        progress: Object.assign({}, tsd.progress || {}),
        progressSummary: buildProgressSummary(state, task, tsd),
        reward,
        rewardItems: buildRewardItems(reward),
        rewardTrack: resolved.ok && resolved.track ? resolved.track : null,
        rewardTrackLabel: resolved.ok && resolved.track ? (TRACK_LABEL[resolved.track] || resolved.track) : null,
        rewardClaimed: Boolean(tsd.rewardClaimed),
        supportClaimed: Boolean(tsd.supportClaimed),
        rewardLocked,
        canClaim,
        canConfirm,
        canChooseCombatTrack,
        trackOptions,
        unlocks: task.unlocks || []
      };
      out.tasks.push(entry);
      out.taskById[task.id] = entry;

      const chapterEntry = out.chapterById[task.chapter];
      if (chapterEntry) {
        chapterEntry.total += 1;
        if (isCompleted) chapterEntry.completed += 1;
        else if (!chapterEntry.currentTaskId && (isActive || isClaimable)) chapterEntry.currentTaskId = task.id;
      }
      if (isCompleted) out.completedCount += 1;
      else if (!out.currentTaskId && (isActive || isClaimable)) out.currentTaskId = task.id;
    }

    const prologue = out.chapterById.prologue;
    out.prologueCompleted = Boolean(prologue && prologue.total > 0 && prologue.completed === prologue.total);
    out.allCompleted = out.totalCount > 0 && out.completedCount === out.totalCount;
    return out;
  }

  const TutorialSystem = {
    REASON,
    getTutorialTaskState,
    getTutorialDisplayState,
    reconcileTutorialState,
    installTutorialConsumers,
    claimTutorialTask,
    confirmTutorialTask,
    chooseTutorialCombatTrack,
    claimEmergencyTutorialShip,
    noteTutorialActionResult,
    bootstrap
  };

  if (typeof window !== "undefined") window.TutorialSystem = TutorialSystem;
  if (typeof globalThis !== "undefined") globalThis.TutorialSystem = TutorialSystem;
})();
