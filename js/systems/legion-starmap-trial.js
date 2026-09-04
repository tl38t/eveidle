/* Legion starmap trial: first vertical slice for collection nodes. */
(function (root) {
  "use strict";
  const API = {};
  const LIMIT_SECONDS = 180;

  function ensure(state) {
    if (!state.legion) state.legion = {};
    if (!state.legion.starmap) state.legion.starmap = {};
    const s = state.legion.starmap;
    if (!s.collectionTrial || typeof s.collectionTrial !== "object") {
      s.collectionTrial = { status:"idle", nodeId:null, resourceId:null, kind:null, gathered:0, amount:0, startedAt:0, endsAt:0, requiredSeconds:0, efficiency:0, result:null };
    }
    return s;
  }

  function isRunning(state) { return !!(state && ensure(state).collectionTrial.status === "running"); }
  function hasNormalAction(state) { return !!(state && state.currentAction && state.currentAction.active); }
  function resourceKey(node) { return "special:" + String(node.resourceId || node.collectionResource || ""); }
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
  function canStart(state, node) {
    if (!state || !active(state, node)) return { ok:false, reason:"invalid-collection-node" };
    if (isRunning(state)) return { ok:false, reason:"starmap-trial-running" };
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
    Object.assign(s, { status:"running", nodeId:String(node.id), resourceId:String(node.collectionResource), kind:node.collectionKind || node.subtype || "", gathered:0, amount:Number(node.collectionAmount), startedAt:t, endsAt:t + Math.min(check.requiredSeconds, limit) * 1000, requiredSeconds:check.requiredSeconds, efficiency:check.efficiency, result:null });
    state._dirty = true;
    return { changed:true, trial:{ ...s }, willSucceed:check.willSucceed };
  }
  function finish(state, success, now) {
    const s = ensure(state).collectionTrial;
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    s.status = success ? "success" : "failed";
    s.gathered = success ? s.amount : 0;
    s.result = success ? "\u901a\u8fc7" : "\u5931\u8d25";
    if (success && root.ResourceRegistry && typeof root.ResourceRegistry.add === "function") root.ResourceRegistry.add(state, resourceKey(s), s.amount);
    state._dirty = true;
    return { changed:true, success, trial:{ ...s } };
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
    if (elapsed >= limit) return finish(state, s.requiredSeconds <= limit, t);
    state._dirty = true;
    return { changed:true, trial:{ ...s } };
  }
  function actionLock(state, action) {
    if (!isRunning(state) || !action || typeof action.type !== "string") return null;
    if (action.type === "legion-starmap/startCollectionTrial" || action.type === "legion-starmap/stopCollectionTrial") return null;
    return /(?:\/start|\/enter|\/begin|^start)/.test(action.type) ? { changed:false, reason:"starmap-trial-running" } : null;
  }
  API.ensureLegionStarmapState = ensure;
  API.isCollectionTrialRunning = isRunning;
  API.canStartCollectionTrial = canStart;
  API.startCollectionTrial = start;
  API.tickLegionStarmapTrial = tick;
  API.finishCollectionTrial = finish;
  API.getActionLock = actionLock;
  API.LIMIT_SECONDS = LIMIT_SECONDS;
  root.LEGION_STARMAP_TRIAL = API;

})(typeof window !== "undefined" ? window : globalThis);
