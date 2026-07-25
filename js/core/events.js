/* ================================================================
   GameEvents — 同步领域事件总线与事件契约

   事件用于任务、成就、统计和UI反馈；不得作为游戏状态的唯一来源。
   ================================================================ */

const GameEventContracts = (() => {
  const cycleEvents = new Set(["mining:completed", "refining:completed", "gas:completed", "manufacturing:completed"]);
  const definitions = Object.freeze({
    "mining:completed": { required:["area", "mode", "resourceId", "quantity", "cycles", "xp"], numbers:["quantity", "cycles", "xp"] },
    "refining:completed": { required:["recipe", "inputId", "outputId", "inputQuantity", "outputQuantity", "cycles", "xp"], numbers:["inputQuantity", "outputQuantity", "cycles", "xp"] },
    "gas:completed": { required:["area", "resourceId", "quantity", "cycles", "xp"], numbers:["quantity", "cycles", "xp"] },
    "planetary:completed": { required:["deploymentId", "planetType", "resourceId", "quantity", "cycles", "xp"], numbers:["quantity", "cycles", "xp"] },
    "planetary:deployed": { required:["deploymentId", "planetType", "constructionISK", "constructionResources"], numbers:["constructionISK"] },
    "planetary:renewed": { required:["deploymentId", "planetType", "maintenanceISK", "expiresAt"], numbers:["maintenanceISK", "expiresAt"] },
    "planetary:expired": { required:["deploymentId", "planetType", "expiredAt"], numbers:["expiredAt"] },
    "planetary:collected": { required:["deploymentId", "planetType", "resourceId", "quantity"], numbers:["quantity"] },
    "planetary:demolished": { required:["deploymentId", "planetType", "refundedISK", "refundedResources"], numbers:["refundedISK"] },
    "manufacturing:completed": { required:["branch", "recipeId", "quantity", "cycles", "xp"], numbers:["quantity", "cycles", "xp"] },
    "combat:enemyDefeated": { required:["zoneId", "faction", "enemyId", "enemyKind", "isk", "xp"], numbers:["isk", "xp"] },
    "combat:waveCleared": { required:["zoneId", "wave"], numbers:["wave"] },
    "combat:zoneCleared": { required:["zoneId", "name", "lp", "clearCount"], numbers:["lp", "clearCount"] },
    "combat:deathspaceWaveCleared": { required:["deathspaceId", "zoneId", "wave", "lp"], numbers:["wave", "lp"] },
    "combat:deathspaceCleared": { required:["deathspaceId", "name", "lp", "clearCount"], numbers:["lp", "clearCount"] },
    "ship:destroyed": { required:["shipId", "repairSeconds"], numbers:["repairSeconds"] },
    "ship:enhancementAttempted": { required:["shipId", "instanceId", "fromLevel", "toLevel", "chance", "success", "xp"], numbers:["fromLevel", "toLevel", "chance", "xp"] },
    "equipment:enhancementAttempted": { required:["instanceId", "itemId", "category", "fromLevel", "toLevel", "chance", "success", "xp"], numbers:["fromLevel", "toLevel", "chance", "xp"] },
    "rig:manufactured": { required:["rigId", "quantity"], numbers:["quantity"] },
    "rig:fitted": { required:["rigId", "shipInstanceId", "stackGroup", "slotIndex"], numbers:["slotIndex"] },
    "rig:destroyed": { required:["rigId", "shipInstanceId", "stackGroup", "slotIndex"], numbers:["slotIndex"] },
    "rig:replaced": { required:["oldRigId", "newRigId", "shipInstanceId", "stackGroup", "slotIndex"], numbers:["slotIndex"] },
    "skill:levelUp": { required:["skill", "previousLevel", "level"], numbers:["previousLevel", "level"] },
    "action:progressReset": { required:["skill"] },
    "combat:event": { required:["type"] },
    "archaeology:attemptCompleted": { required:["siteId", "tier", "success", "successChance"], numbers:["successChance"] },
    "archaeology:success": { required:["siteId", "tier", "xp"], numbers:["xp"] },
    "archaeology:failure": { required:["siteId", "tier", "backlashDamage"], numbers:["backlashDamage"] },
    "archaeology:artifactFound": { required:["artifactId", "category", "tier"], numbers:["iskValue", "lpValue"] },
    "archaeology:shipDisabled": { required:["instanceId", "repairSeconds"], numbers:["repairSeconds"] },
    "archaeology:repairCompleted": { required:["instanceId"], numbers:[] },
    "archaeology:artifactSold": { required:["artifactId", "quantity", "isk"], numbers:["quantity", "isk"] },
    "archaeology:artifactRedeemed": { required:["artifactId", "quantity", "lp"], numbers:["quantity", "lp"] },
    "archaeology:artifactsSold": { required:["quantity", "totalIsk"], numbers:["quantity", "totalIsk"] },
    "archaeology:artifactsRedeemed": { required:["quantity", "totalLp"], numbers:["quantity", "totalLp"] },
    // 增强剂系统 Phase 2A（§7 事件契约）
    "combat:tacticalMaterialDropped": { required:["zoneId", "deathspaceId", "enemyId", "enemyKind", "materialId", "materialName", "tier", "quantity", "securityLayer"], numbers:["quantity"], nullable:["deathspaceId"] },
    "booster:manufactured": { required:["recipeId", "itemId", "series", "quality", "quantity", "xpGained", "offline"], numbers:["quantity", "xpGained"] },
    "boosters:manufactured": { required:["recipeId", "itemId", "quantity", "totalXp", "offline"], numbers:["quantity", "totalXp"] },
    // 增强剂系统 Phase 2B：六槽生命周期事件
    "booster:equipped": { required:["slot", "itemId"], numbers:[] },
    "booster:activated": { required:["slot", "itemId", "remainingMs"], numbers:["remainingMs"] },
    "booster:consumed": { required:["slot", "itemId"], numbers:[] },
    "booster:autoRefilled": { required:["slot", "itemId", "fromInventory"], numbers:["fromInventory"] },
    "booster:depleted": { required:["slot"], numbers:[] },
    "booster:unequipped": { required:["slot", "itemId"], numbers:[] },
    "booster:replaced": { required:["slot", "oldItemId", "newItemId"], numbers:[] }
  });

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }

  function normalize(type, payload) {
    const normalized = cloneValue(payload && typeof payload === "object" ? payload : {});
    if ((cycleEvents.has(type) || type === "planetary:completed") && normalized.cycles === undefined) normalized.cycles = 1;
    return normalized;
  }

  function validate(type, payload) {
    const definition = definitions[type];
    if (!definition) return { valid:true, registered:false, errors:[] };
    const errors = [];
    const nullable = definition.nullable || [];
    for (const key of definition.required || []) {
      const value = payload[key];
      if (nullable.includes(key)) {
        // 契约必须包含该字段，但允许显式 null（如普通星带的 deathspaceId）
        if (value === undefined || value === "") errors.push("缺少字段 " + key);
      } else if (value === undefined || value === null || value === "") {
        errors.push("缺少字段 " + key);
      }
    }
    for (const key of definition.numbers || []) {
      if (!Number.isFinite(Number(payload[key])) || Number(payload[key]) < 0) errors.push("字段 " + key + " 必须是非负数");
    }
    if ((cycleEvents.has(type) || type === "planetary:completed") && Number(payload.cycles) < 1) errors.push("cycles 必须大于0");
    return { valid:errors.length === 0, registered:true, errors };
  }

  function has(type) { return Object.hasOwn(definitions, type); }
  function list() { return Object.keys(definitions); }

  return Object.freeze({ schemaVersion:1, has, list, normalize, validate });
})();

const GameEvents = (() => {
  const listeners = new Map();
  const sessionId = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  let sequence = 0;

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) deepFreeze(item);
    return Object.freeze(value);
  }

  function on(type, listener) {
    if (typeof type !== "string" || typeof listener !== "function") return () => {};
    const group = listeners.get(type) || new Set();
    group.add(listener);
    listeners.set(type, group);
    return () => off(type, listener);
  }

  function once(type, listener) {
    const unsubscribe = on(type, event => { unsubscribe(); listener(event); });
    return unsubscribe;
  }

  function off(type, listener) {
    const group = listeners.get(type);
    if (!group) return false;
    const removed = group.delete(listener);
    if (group.size === 0) listeners.delete(type);
    return removed;
  }

  function createEventId(timestamp) {
    sequence++;
    return "evt_" + sessionId + "_" + timestamp.toString(36) + "_" + sequence.toString(36);
  }

  function emit(type, payload, meta) {
    const inputMeta = meta && typeof meta === "object" ? meta : {};
    const timestamp = Number.isFinite(Number(inputMeta.timestamp)) ? Number(inputMeta.timestamp) : Date.now();
    const normalizedPayload = GameEventContracts.normalize(type, payload);
    const validation = GameEventContracts.validate(type, normalizedPayload);
    const eventId = typeof inputMeta.eventId === "string" && inputMeta.eventId ? inputMeta.eventId : createEventId(timestamp);
    const eventMeta = {
      offline:Boolean(inputMeta.offline),
      aggregate:inputMeta.aggregate === undefined ? Boolean(inputMeta.offline && Number(normalizedPayload.cycles) > 1) : Boolean(inputMeta.aggregate),
      source:typeof inputMeta.source === "string" && inputMeta.source ? inputMeta.source : "game",
      runId:typeof inputMeta.runId === "string" && inputMeta.runId ? inputMeta.runId : null
    };
    const event = deepFreeze({
      schemaVersion:GameEventContracts.schemaVersion,
      eventId,
      type,
      timestamp,
      payload:normalizedPayload,
      meta:eventMeta,
      valid:validation.valid,
      registered:validation.registered
    });

    if (!validation.valid) {
      RuntimeGuard.report(new Error("事件契约校验失败：" + validation.errors.join("；")), { source:"event:" + type, fatal:false, kind:"event-contract" });
      return event;
    }

    const targets = [...(listeners.get(type) || []), ...(listeners.get("*") || [])];
    for (const listener of targets) {
      try { listener(event); }
      catch (error) { RuntimeGuard.report(error, { source:"event:" + type, fatal:false, kind:"event-listener" }); }
    }
    return event;
  }

  function onIdempotent(type, options, listener) {
    const config = options && typeof options === "object" ? options : {};
    const consumerId = typeof config.consumerId === "string" && config.consumerId ? config.consumerId : "consumer";
    const maxEntries = Math.max(16, Number(config.maxEntries) || 512);
    if (typeof config.getLedger !== "function" || typeof listener !== "function") return () => {};
    return on(type, event => {
      const ledger = config.getLedger();
      if (!ledger || typeof ledger !== "object") return;
      if (!Array.isArray(ledger.processedEventIds)) ledger.processedEventIds = [];
      const ledgerKey = consumerId + ":" + event.eventId;
      if (ledger.processedEventIds.includes(ledgerKey)) return;
      const consumed = listener(event);
      if (consumed === false) return;
      ledger.processedEventIds.push(ledgerKey);
      if (ledger.processedEventIds.length > maxEntries) ledger.processedEventIds.splice(0, ledger.processedEventIds.length - maxEntries);
    });
  }

  function clear(type) {
    if (type) listeners.delete(type); else listeners.clear();
  }

  function listenerCount(type) { return (listeners.get(type) || new Set()).size; }

  return { on, once, off, emit, onIdempotent, clear, listenerCount, contracts:GameEventContracts };
})();

window.GameEventContracts = GameEventContracts;
window.GameEvents = GameEvents;
