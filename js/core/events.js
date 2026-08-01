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
    // Batch C-11：升级 combat:zoneCleared 契约——wave（通关时波次，required+numbers）、
    // weaponTypes（本次通关期间实际开火过的武器类型数组，required；数组非数字故不入 numbers）。
    // Batch C-12：追加 damageTaken（全程累计实际承伤，required+numbers）。
    "combat:zoneCleared": { required:["zoneId", "name", "lp", "clearCount", "wave", "weaponTypes", "damageTaken"], numbers:["lp", "clearCount", "wave", "damageTaken"] },
    "combat:deathspaceWaveCleared": { required:["deathspaceId", "zoneId", "wave", "lp"], numbers:["wave", "lp"] },
    // Batch C-12：死亡空间进入事件——严格在 enterDeathspace 成功完成后 emit 一次。
    "combat:deathspaceEntered": { required:["deathspaceId", "zoneId", "faction", "tier"], numbers:["tier"] },
    "combat:deathspaceCleared": { required:["deathspaceId", "name", "lp", "clearCount"], numbers:["lp", "clearCount"] },
    // Batch C-12：每次玩家真实齐射结算后 emit 实际伤害（amount 为本次三层合计，runTotal 为单场累计）。
    "combat:damageDealt": { required:["zoneId", "mode", "amount", "runTotal"], numbers:["amount", "runTotal"] },
    // 维修后自动恢复（Phase 3D 修正）：无论普通星带/死亡空间重创，维修后都返回来源普通星带第 1 波。
    // zoneId=返回星带；defeatedMode(belt|deathspace)/deathspaceId 仅供日志/UI，deathspaceId 可为 null。
    "combat:resumedAfterRepair": { required:["zoneId", "defeatedMode"], numbers:[] },
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
    // 野外自动维修（Batch J · autorepair）：每件实际激活的维修装备恰好 emit 一次。
    // amount = 实际治疗量（非理论量），fuelCost = 真实扣除量；meta.timestamp = context.now、offline、source = "research-protocol"。
    // 满血 / 燃料不足 / 协议关闭 / 未研究 / 致命反噬均不 emit。
    "archaeology:fieldRepairApplied": { required:["instanceId", "itemId", "target", "amount", "fuelCost"], numbers:["amount", "fuelCost"] },
    // 维修后自动恢复（Phase 3D）：维修完成后自动续跑被打断的考古行动
    "archaeology:resumedAfterRepair": { required:["siteId"], numbers:[] },
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
    "booster:replaced": { required:["slot", "oldItemId", "newItemId"], numbers:[] },
    // 军团与空间站系统 Phase 3C-2：三级本体建设队列事件契约（在线/离线语义一致）
    // fromLevel 允许 0（Lv.0→Lv.1），startedAt 允许 0（测试注入），故均以非负数校验
    "station:constructionStarted": { required:["kind", "fromLevel", "targetLevel", "startedAt", "completesAt", "durationMs"], numbers:["fromLevel", "targetLevel", "startedAt", "completesAt", "durationMs"] },
    "station:constructionCompleted": { required:["kind", "fromLevel", "targetLevel", "startedAt", "completesAt"], numbers:["fromLevel", "targetLevel", "startedAt", "completesAt"] },
    "station:bodyUpgraded": { required:["fromLevel", "toLevel", "startedAt", "completesAt"], numbers:["fromLevel", "toLevel", "startedAt", "completesAt"] },
    // 军团与空间站系统 Phase 3C-4：八附属建筑施工事件契约
    "station:buildingUpgraded": { required:["buildingId", "fromLevel", "toLevel", "startedAt", "completesAt"], numbers:["fromLevel", "toLevel", "startedAt", "completesAt"] },
    // 资源调度中心：勘探指令额外产出（不增 XP）
    "station:dispatchBonus": { required:["kind", "resourceId", "quantity", "counter", "threshold"], numbers:["quantity", "counter", "threshold"] },
    // 军团与空间站系统 Phase 3C-5：三条自动线事件
    "station:autoLineStarted": { required:["lineId", "targetId"], numbers:[] },
    "station:autoLineStopped": { required:["lineId", "targetId", "reason", "quantity", "xp", "offline"], numbers:["quantity", "xp"] },
    "station:autoLineCompleted": { required:["lineId", "targetId", "quantity", "xp", "offline", "cycles"], numbers:["quantity", "xp", "cycles"] },
    // 军团与空间站系统 Phase 3C-6：维护燃料、考古实验室、作战指挥中心、舰船船坞
    "station:maintenanceRefilled": { required:["points", "fuelSpent", "fuelRemaining", "remainingMs"], numbers:["points", "fuelSpent", "fuelRemaining", "remainingMs"] },
    "station:maintenanceLow": { required:["fuelRemaining", "remainingMs"], numbers:["fuelRemaining", "remainingMs"] },
    "station:maintenanceDepleted": { required:["fuelRemaining"], numbers:["fuelRemaining"] },
    "station:archaeologyBonusTriggered": { required:["siteId", "tier", "artifactId", "baseUniqueRate", "tracerMultiplier", "labMultiplier", "effectiveRate"], numbers:["baseUniqueRate", "tracerMultiplier", "labMultiplier", "effectiveRate"] },
    "station:combatXpBoosted": { required:["skillId", "baseXp", "multiplier", "actualXp"], numbers:["baseXp", "multiplier", "actualXp"] },
    "station:shipyardMaterialsSaved": { required:["recipeId", "savings"], numbers:[] },
    // 研究系统（批次 C）：每完成一个研究步骤严格 emit 一次；payload 契约 {techId, level}
    "research:stepCompleted": { required:["techId", "level"], numbers:["level"] },
    // 离线结算（Batch C-9）：applyOfflineGains 在真实 settleOfflineTimeline 成功完成后严格 emit 一次；
    // rawSeconds = 原始离线秒数（未封顶），settledSeconds = 实际结算秒数（0..86400），均为非负有限 number。
    // calculateOfflineGains / forceOfflineTest / 直接 applyOfflineGains 共用这一唯一入口；结算异常不发射。
    "offline:settlementCompleted": { required:["rawSeconds", "settledSeconds"], numbers:["rawSeconds", "settledSeconds"] },
    // 成就系统（Batch B）：首次解锁严格 emit 一次；payload 只含 {achievementId, unlockedAt}；
    // meta.timestamp 精确等于 unlockedAt，meta.source = "achievement-system"。
    // 平台无关，是未来 Steam Adapter 的唯一挂钩点（本批不实现 Adapter）。
    "achievement:unlocked": { required:["achievementId", "unlockedAt"], numbers:["unlockedAt"] },
    // 蓝图首次获得（Batch C-10A1）：仅在 ownedBlueprints 首次成功写入后严格 emit 一次；
    // payload 精确 {ownershipKey, blueprintKind, productId}；ownershipKey 为权威归属键
    // （舰船 = shipId，装备 = "equipment:" + equipmentId），blueprintKind ∈ {"ship","equipment"}，
    // productId 为产品标识（舰船 = shipId，装备 = equipmentId）；
    // meta.timestamp = acquiredAt（合法 number 否则 Date.now()），source = "blueprint-store"，offline = false。
    "blueprint:acquired": { required:["ownershipKey", "blueprintKind", "productId"], numbers:[] },
    // Batch C-13：统一资源变动事件（ResourceRegistry.set 真实成功变更后 emit 一次；add/spend 经 set 自然得到一次）
    "resource:changed": { required:["resourceId", "previousValue", "value", "delta"], numbers:["previousValue", "value", "delta"] },
    // Batch C-13：未安装装备/库存变动（buyLPItem 普通装备购买成功分支 emit；蓝图分支不发）
    "inventory:changed": { required:["kind", "itemId", "delta"], numbers:["delta"] },
    // Batch C-14A：在线会话时间片。唯一入口为 tick.js 的模块运行期私有锚点（不写入存档）：
    // 首个 gameTick 只建锚点不发射；此后每 tick 发射一次真实经过秒数（保留小数）。
    // payload 严格 {seconds}；meta.timestamp 为绝对时刻，source="online-session"，offline=false。
    // 页面重新加载会重建锚点，因此关闭游戏期间的时间绝不会被计入。
    "session:onlineElapsed": { required:["seconds"], numbers:["seconds"] },
    // Batch C-14A：动作队列真实新增一项（ShellStateActions.queueAdd 在数组写入完成后 emit 一次）。
    // 相同项目合并 count（items.length 未增长）/ 队列已满 / 蓝图未解锁等失败路径一律不发。
    // size 为写入后的真实 queue.items.length，maxSize 为队列容量上限。
    "queue:itemAdded": { required:["itemId", "size", "maxSize"], numbers:["size", "maxSize"] },
    // Batch E：成就一次性科研工时发放。只有「首次真实入账」才发射一次；
    // 重复解锁 / 重复读档对账 / reward=null / research 缺失一律不发。
    // payload 精确 {achievementId, hours, seconds}，hours 取自冻结目录 reward.hours，
    // seconds = hours * 3600（绝不信任事件外部传入的数值）；
    // meta.timestamp = 发放时刻，source = "achievement-system"。
    "achievement:researchHoursGranted": { required:["achievementId", "hours", "seconds"], numbers:["hours", "seconds"] },
    // Batch E：科研工时投入当前研究。ResearchSystem.applyResearchHours 真实扣减成功后发射一次；
    // usedSeconds 为实扣秒数（已按 50% 上限 / 银行余额 / 本步剩余时间三重截断，必然 > 0）。
    "research:hoursApplied": { required:["techId", "level", "usedSeconds"], numbers:["level", "usedSeconds"] },
    // Batch E：研究取消。ResearchSystem.cancelResearch 真实作废当前步骤后发射一次；
    // refundedSeconds 为退回银行的成就工时秒数（可为 0）；取消不发 research:stepCompleted。
    "research:cancelled": { required:["techId", "level", "refundedSeconds"], numbers:["level", "refundedSeconds"] }
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
