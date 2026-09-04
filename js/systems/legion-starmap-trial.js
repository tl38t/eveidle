/* Legion starmap trial: first vertical slice for collection nodes. */
(function (root) {
  "use strict";
  const API = {};
  const LIMIT_SECONDS = 180;
  let replayTestingEnabled = false;

  function ensure(state) {
    if (!state.legion) state.legion = {};
    if (!state.legion.starmap) state.legion.starmap = {};
    const s = state.legion.starmap;
    if (!s.collectionTrial || typeof s.collectionTrial !== "object") {
      s.collectionTrial = { status:"idle", nodeId:null, lockedNode:null, resourceId:null, kind:null, gathered:0, amount:0, startedAt:0, endsAt:0, requiredSeconds:0, efficiency:0, result:null };
    }
    if (!Array.isArray(s.completedNodeIds)) s.completedNodeIds = [];
    s.completedNodeIds = [...new Set(s.completedNodeIds.map(String))];
    if (s.collectionTrial.status === "running" && !s.collectionTrial.lockedNode && s.collectionTrial.nodeId != null) {
      const trial = s.collectionTrial;
      const inferredBase = Number(trial.amount) > 0 && Number(trial.efficiency) > 0
        ? Number(trial.requiredSeconds) * Number(trial.efficiency) / Number(trial.amount)
        : 0;
      trial.lockedNode = lockNode({
        id:trial.nodeId, name:trial.resourceId, type:"collection",
        subtype:trial.kind === "gas" ? "\u91c7\u6c14" : "\u91c7\u77ff",
        collectionResource:trial.resourceId, collectionKind:trial.kind,
        collectionAmount:trial.amount, collectionBaseSecondsPerUnit:inferredBase,
        collectionTimeLimitSeconds:LIMIT_SECONDS
      });
    }
    if (s.collectionTrial.status === "success" && s.collectionTrial.nodeId != null) {
      const completedId = String(s.collectionTrial.nodeId);
      if (!s.completedNodeIds.includes(completedId)) s.completedNodeIds.push(completedId);
    }
    return s;
  }

  function isRunning(state) { return !!(state && ensure(state).collectionTrial.status === "running"); }
  function hasNormalAction(state) { return !!(state && state.currentAction && state.currentAction.active); }
  function resourceKey(node) { return "special:" + String(node.resourceId || node.collectionResource || ""); }
  function lockNode(node) {
    if (!node || node.id == null) return null;
    return {
      id:node.id, name:String(node.name || ""), type:"collection", subtype:String(node.subtype || ""),
      collectionResource:String(node.collectionResource || ""), collectionKind:String(node.collectionKind || ""),
      collectionAmount:Number(node.collectionAmount) || 0,
      collectionBaseSecondsPerUnit:Number(node.collectionBaseSecondsPerUnit) || 0,
      collectionTimeLimitSeconds:Number(node.collectionTimeLimitSeconds) || LIMIT_SECONDS,
      collectionEfficiencyTarget:Number(node.collectionEfficiencyTarget) || 0
    };
  }
  function readEfficiency(node) {
    const isGas = node.collectionKind === "gas" || node.subtype === "\u91c7\u6c14";
    try {
      if (isGas && typeof root.getGasEfficiency === "function") return Number(root.getGasEfficiency()) || 0;
      if (!isGas && typeof root.getMiningEfficiency === "function") return Number(root.getMiningEfficiency()) || 0;
    } catch (_) {}
    return 0;
  }
  function active(state, node) {
    return !!(state && node && node.type === "collection" && node.collectionResource && Number(node.collectionAmount) > 0 && Number(node.collectionTimeLimitSeconds) > 0);
  }
  function isNodeCompleted(state, node) {
    if (!state || !node || node.id == null) return false;
    return ensure(state).completedNodeIds.includes(String(node.id));
  }
  function canStart(state, node) {
    if (!state || !active(state, node)) return { ok:false, reason:"invalid-collection-node" };
    if (isRunning(state)) return { ok:false, reason:"starmap-trial-running" };
    if (isNodeCompleted(state, node) && !replayTestingEnabled) return { ok:false, reason:"starmap-trial-completed" };
    if (hasNormalAction(state)) return { ok:false, reason:"player-action-running" };
    const eff = readEfficiency(node);
    if (!(eff > 0)) return { ok:false, reason:"no-collection-efficiency", efficiency:eff };
    const amount = Number(node.collectionAmount);
    const base = Number(node.collectionBaseSecondsPerUnit) || 0;
    const required = base * amount / eff;
    return { ok:true, efficiency:eff, requiredSeconds:required, willSucceed:required <= Number(node.collectionTimeLimitSeconds || LIMIT_SECONDS) };
  }
  function start(state, node, now, options) {
    const opts = options || {};
    if (state && state.combat && state.combat.active) return { changed:false, reason:"combat-running" };
    if (hasNormalAction(state) && !opts.confirmed) return { changed:false, reason:"confirm-stop-action", currentSkill:state.currentAction.skill || "current-action" };
    if (hasNormalAction(state) && opts.confirmed) {
      const stop = typeof root.dispatchGameAction === "function" ? root.dispatchGameAction(state, { type:"action/stop" }, Number(now) || Date.now()) : { changed:false, reason:"action-stop-unavailable" };
      if (state.currentAction.active) return { changed:false, reason:stop.reason || "action-stop-failed" };
    }
    const check = canStart(state, node);
    if (!check.ok) return { changed:false, reason:check.reason, efficiency:check.efficiency };
    const s = ensure(state).collectionTrial;
    const t = Number(now) || Date.now();
    const limit = Number(node.collectionTimeLimitSeconds) || LIMIT_SECONDS;
    Object.assign(s, { status:"running", nodeId:String(node.id), lockedNode:lockNode(node), resourceId:String(node.collectionResource), kind:node.collectionKind || node.subtype || "", gathered:0, amount:Number(node.collectionAmount), startedAt:t, endsAt:t + limit * 1000, requiredSeconds:check.requiredSeconds, efficiency:check.efficiency, result:null });
    state._dirty = true;
    return { changed:true, trial:{ ...s }, willSucceed:check.willSucceed };
  }
  function finish(state, success, now) {
    const s = ensure(state).collectionTrial;
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    s.status = success ? "success" : "failed";
    s.gathered = success ? s.amount : 0;
    s.result = success ? "\u901a\u8fc7" : "\u5931\u8d25";
    if (success && s.nodeId != null) {
      const completedId = String(s.nodeId);
      const completedNodeIds = ensure(state).completedNodeIds;
      if (!completedNodeIds.includes(completedId)) completedNodeIds.push(completedId);
    }
    if (success && root.ResourceRegistry && typeof root.ResourceRegistry.add === "function") root.ResourceRegistry.add(state, resourceKey(s), s.amount);
    state._dirty = true;
    return { changed:true, success, trial:{ ...s } };
  }
  function stop(state) {
    const s = ensure(state).collectionTrial;
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    // 停止是一次完整的试炼重置：不结算、不保留本轮采集量，重新打开时从满额开始。
    Object.assign(s, { status:"idle", nodeId:null, lockedNode:null, resourceId:null, kind:null, gathered:0, amount:0, startedAt:0, endsAt:0, requiredSeconds:0, efficiency:0, result:null });
    state._dirty = true;
    return { changed:true, trial:{ ...s } };
  }
  function tick(state, now) {
    if (!state) return { changed:false, reason:"invalid-state" };
    const s = ensure(state).collectionTrial;
    if (s.status !== "running") return { changed:false, reason:"idle" };
    const t = Number(now) || Date.now();
    if (t < s.startedAt) return { changed:false, reason:"time-reversed" };
    const elapsed = Math.max(0, (t - s.startedAt) / 1000);
    const limit = Math.max(1, Math.min(LIMIT_SECONDS, (s.endsAt - s.startedAt) / 1000));
    s.gathered = Math.min(s.amount, s.amount * Math.min(1, elapsed / Math.max(0.001, s.requiredSeconds)));
    if (s.requiredSeconds <= limit && elapsed >= s.requiredSeconds) return finish(state, true, t);
    if (elapsed >= limit) return finish(state, false, t);
    state._dirty = true;
    return { changed:true, trial:{ ...s } };
  }
  function actionLock(state, action) {
    if (!isRunning(state) || !action || typeof action.type !== "string") return null;
    if (action.type === "legion-starmap/startCollectionTrial" || action.type === "legion-starmap/stopCollectionTrial") return null;
    return /(?:\/start|\/enter|\/begin|^start)/.test(action.type) ? { changed:false, reason:"starmap-trial-running" } : null;
  }
  function setReplayTestingEnabled(enabled) {
    replayTestingEnabled = !!enabled;
    return replayTestingEnabled;
  }
  function isReplayTestingEnabled() { return replayTestingEnabled; }
  API.ensureLegionStarmapState = ensure;
  API.isCollectionTrialRunning = isRunning;
  API.getLockedNode = function (state) {
    const trial = state && ensure(state).collectionTrial;
    return trial && trial.status === "running" && trial.lockedNode ? { ...trial.lockedNode } : null;
  };
  API.canStartCollectionTrial = canStart;
  API.isNodeCompleted = isNodeCompleted;
  API.startCollectionTrial = start;
  API.tickLegionStarmapTrial = tick;
  API.finishCollectionTrial = finish;
  API.stopCollectionTrial = stop;
  API.getActionLock = actionLock;
  API.setReplayTestingEnabled = setReplayTestingEnabled;
  API.isReplayTestingEnabled = isReplayTestingEnabled;
  API.LIMIT_SECONDS = LIMIT_SECONDS;
  root.LEGION_STARMAP_TRIAL = API;

})(typeof window !== "undefined" ? window : globalThis);
