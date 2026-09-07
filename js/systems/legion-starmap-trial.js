/* Legion starmap trials: collection, production submission and archaeology rooms. */
(function (root) {
  "use strict";
  const API = {};
  const LIMIT_SECONDS = 180;
  const COLLECTION_REWARD_HOUR_MS = 60 * 60 * 1000;
  const COLLECTION_REWARD_DAILY_RATE = 0.96;
  const COLLECTION_REWARD_HOURS_PER_DAY = 24;
  const PRODUCTION_REWARD_HOUR_MS = 60 * 60 * 1000;
  const PRODUCTION_REWARD_HOURS_PER_DAY = 24;
  const ARCHAEOLOGY_REWARD_HOUR_MS = 60 * 60 * 1000;
  const ARCHAEOLOGY_REWARD_HOURS_PER_DAY = 24;
  // 2026-09-06：首次与每日改为「不同档位各 1 个」——首次比每日高一档，数量恒为 1。
  // 外环 首次III/每日II，中环 首次IV/每日III，内环 首次V/每日IV。
  // tier 仍为旧单一档位字段，仅作老存档/缺省兜底。
  const ARCHAEOLOGY_REWARD_BY_RING = {
    outer:{ tier:"ii", firstTier:"iii", dailyTier:"ii", firstRewardAmount:1, dailyAmount:1 },
    middle:{ tier:"iii", firstTier:"iv", dailyTier:"iii", firstRewardAmount:1, dailyAmount:1 },
    inner:{ tier:"iv", firstTier:"v", dailyTier:"iv", firstRewardAmount:1, dailyAmount:1 }
  };
  // 校准基体合法档位（V 型 2026-09-06 起用于内环首次奖励）。
  const ARCHAEOLOGY_CALIB_TIERS = ["ii", "iii", "iv", "v"];
  const ARCHAEOLOGY_CALIB_RE = /^calibration:art_(ii|iii|iv|v)_calib$/;
  // 星图大编队试炼专用：编队池与每战区平衡系数。仅 getBattleTrialWaveZone 消费，
  // 不改写 COMBAT_ZONES / 常规编队池，普通星带完全不受影响。
  const STARMAP_TRIAL_BIG_FORMATION_POOL = "starmap_big";
  const STARMAP_TRIAL_WAVE_OVERRIDES = {
    "angel_warfront|normal":{ hp:2, damage:2.3, formationPool:"starmap_big" },
    "blood_iron_basilica|normal":{ hp:2, damage:2.3, formationPool:"starmap_big" },
    "sansha_command_matrix|normal":{ hp:2, damage:2.3, formationPool:"starmap_big" },
    "angel_deep_domain|normal":{ hp:2.6455, damage:1.4, formationPool:"starmap_deep4" },
    "blood_deep_reliquary|normal":{ hp:2.1742, damage:1.4, formationPool:"starmap_deep4" },
    "sansha_deep_nexus|normal":{ hp:2.05088, damage:1.4, formationPool:"starmap_deep4" },
    "angel_warfront|elite":{ damage:3.8, formationPool:"starmap_outer4", elitePool:["marauder_commander"] },
    "blood_iron_basilica|elite":{ damage:3.8, formationPool:"starmap_outer4", elitePool:["apostle_commander"] },
    "sansha_command_matrix|elite":{ damage:3.8, formationPool:"starmap_outer4", elitePool:["domination_commander"] },
    // 中环普通（2026-09-05）：hp 保持战区原值，仅抬 damage（B1e55 三战列舰基线标定，各势力模板差异大须分势力定系数）。
    "angel_outer_reach|normal":{ formationPool:"starmap_mid3", damage:2.15 },
    "blood_outer_reliquary|normal":{ formationPool:"starmap_mid3", damage:2.9 },
    "sansha_outer_array|normal":{ formationPool:"starmap_mid3", damage:3.0 },
    // 中环精英（2026-09-05）：3×L80旗舰 + 1指挥舰（血=普通旗舰×2.5，光环1.3），试炼专用，L80星带保留 L85 精英。
    "angel_outer_reach|elite":{ formationPool:"starmap_mid4", elitePool:["frontier_commander"], damage:1.38 },
    "blood_outer_reliquary|elite":{ formationPool:"starmap_mid4", elitePool:["covenant_commander"], damage:1.62 },
    "sansha_outer_array|elite":{ formationPool:"starmap_mid4", elitePool:["nexus_commander"], damage:1.75 }
  };
  // 星图战斗试炼奖励（2026-09-06）：一次性 = 星带同级掉落 ×3×5 + 货柜 ×5 + 许可 ×5；
  // 每日驻留 = 一次性（未 ×5）÷ 5，只发星币与货柜。
  // 泰坦组件节点（node.titanComponent）与最终核心节点（precursor_core）不参与，保持无掉落无驻留。
  const BATTLE_TRIAL_DROP_ROLLS = 3;        // 基准份数：等于在同级星带击毁 3 艘同级敌舰
  const BATTLE_TRIAL_ONCE_SCALE = 5;        // 一次性奖励整体倍率
  const BATTLE_TRIAL_DAILY_DIVISOR = 5;     // 每日驻留 = 基准 ÷ 5（不参与一次性倍率）
  const BATTLE_TRIAL_CARGO_COUNT = 5;       // 一次性货柜数量
  const BATTLE_TRIAL_LICENSE_COUNT = 1;     // 一次性装备生产许可数量（每节点仅 1 张）
  const BATTLE_TRIAL_DAILY_CARGO = 0.2;     // 每日货柜（5 天 1 个）
  const BATTLE_TRIAL_LICENSE_BY_RING = { outer:"B", middle:"A", inner:"S" };
  const BATTLE_TRIAL_EXCLUDED_ZONE_IDS = ["precursor_core"];
  const BATTLE_TRIAL_FACTION_LABEL = { angel:"苍穹劫团", blood:"赤誓教团", sansha:"静默集群" };
  const BATTLE_TRIAL_REWARD_HOURS_PER_DAY = 24;
  const BATTLE_TRIAL_REWARD_HOUR_MS = 60 * 60 * 1000;
  let replayTestingEnabled = false;

  function isValidArchaeologyTrialHp(hp) {
    return !!(hp && typeof hp === "object" && ["shield", "armor", "structure"].every(function (key) {
      return Number.isFinite(Number(hp[key])) && Number(hp[key]) >= 0;
    }));
  }
  function getArchaeologyTrialShipHp(state, instanceId) {
    if (!state || !instanceId || typeof root.getArchaeologyShipMaxHp !== "function") return null;
    const maxHp = root.getArchaeologyShipMaxHp(state, instanceId);
    if (!isValidArchaeologyTrialHp(maxHp)) return null;
    return { shield:Number(maxHp.shield) || 0, armor:Number(maxHp.armor) || 0, structure:Number(maxHp.structure) || 0 };
  }

  function ensure(state) {
    if (!state.legion) state.legion = {};
    if (!state.legion.starmap) state.legion.starmap = {};
    const s = state.legion.starmap;
    if (!s.collectionTrial || typeof s.collectionTrial !== "object") {
      s.collectionTrial = { status:"idle", nodeId:null, lockedNode:null, resourceId:null, kind:null, gathered:0, amount:0, startedAt:0, endsAt:0, requiredSeconds:0, efficiency:0, result:null };
    }
    if (!Array.isArray(s.completedNodeIds)) s.completedNodeIds = [];
    s.completedNodeIds = [...new Set(s.completedNodeIds.map(String))];
    if (!s.collectionRewards || typeof s.collectionRewards !== "object" || Array.isArray(s.collectionRewards)) s.collectionRewards = {};
    if (!s.productionRewards || typeof s.productionRewards !== "object" || Array.isArray(s.productionRewards)) s.productionRewards = {};
    if (!s.archaeologyRewards || typeof s.archaeologyRewards !== "object" || Array.isArray(s.archaeologyRewards)) s.archaeologyRewards = {};
    if (!s.productionTrial || typeof s.productionTrial !== "object") {
      s.productionTrial = { status:"idle", nodeId:null, submittedAt:0, requirements:[], result:null };
    }
    if (!s.archaeologyTrial || typeof s.archaeologyTrial !== "object") {
      s.archaeologyTrial = { status:"idle", nodeId:null, lockedNode:null, siteId:null, shipInstanceId:null, probeId:null, trialShipHp:null, progress:0, target:14, startedAt:0, endsAt:0, nextScanAt:0, interferenceUntil:0, cycleSeconds:0, scanStrength:0, successChance:0, scans:0, successes:0, rareFinds:0, log:[], result:null };
    }
    if (s.archaeologyTrial.status === "running" && !isValidArchaeologyTrialHp(s.archaeologyTrial.trialShipHp)) {
      const restoredTrialHp = getArchaeologyTrialShipHp(state, s.archaeologyTrial.shipInstanceId);
      if (restoredTrialHp) { s.archaeologyTrial.trialShipHp = restoredTrialHp; state._dirty = true; }
    }
    if (!s.battleRewards || typeof s.battleRewards !== "object" || Array.isArray(s.battleRewards)) s.battleRewards = {};
    if (!s.battleTrial || typeof s.battleTrial !== "object") {
      s.battleTrial = { status:"idle", nodeId:null, lockedNode:null, zoneId:null, enemyCount:0, kills:0, startedAt:0, endsAt:0, wave:1, result:null, iskPerKill:0, rewardGrantedAt:0, lastRewards:[] };
    }
    if (!Number(s.battleTrial.iskPerKill)) s.battleTrial.iskPerKill = 0;
    if (!Number(s.battleTrial.rewardGrantedAt)) s.battleTrial.rewardGrantedAt = 0;
    if (!Array.isArray(s.battleTrial.lastRewards)) s.battleTrial.lastRewards = [];
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
    if (s.battleTrial.status === "running" && !s.battleTrial.lockedNode && s.battleTrial.nodeId != null) {
      const trial = s.battleTrial;
      trial.lockedNode = lockBattleNode({
        id:trial.nodeId, name:"星图战斗试炼", ring:"outer", tier:"normal", type:"battle", subtype:"战斗",
        battleTrialZoneId:trial.zoneId, battleTrialEnemyCount:trial.enemyCount,
        battleTrialTimeLimitSeconds:LIMIT_SECONDS
      });
    }
    if (s.battleTrial.status === "success" && s.battleTrial.nodeId != null) {
      const completedId = String(s.battleTrial.nodeId);
      if (!s.completedNodeIds.includes(completedId)) s.completedNodeIds.push(completedId);
    }
    return s;
  }

  function isRunning(state) { return !!(state && ensure(state).collectionTrial.status === "running"); }
  function isArchaeologyRunning(state) { return !!(state && ensure(state).archaeologyTrial.status === "running"); }
  function isBattleRunning(state) { return !!(state && ensure(state).battleTrial.status === "running"); }
  function isAnyTrialRunning(state) { return isRunning(state) || isArchaeologyRunning(state) || isBattleRunning(state); }
  function hasNormalAction(state) { return !!(state && state.currentAction && state.currentAction.active); }
  function hasNormalActivity(state) {
    return hasNormalAction(state) || !!(state && state.queue && state.queue.status && state.queue.status.isRunning);
  }
  function stopNormalActivity(state, now) {
    if (!state) return false;
    const t = Number(now) || Date.now();
    const queueRunning = !!(state.queue && state.queue.status && state.queue.status.isRunning);
    if (queueRunning && typeof root.dispatchGameAction === "function") {
      root.dispatchGameAction(state, { type:"queue/stop" }, t);
    } else if (hasNormalAction(state) && typeof root.dispatchGameAction === "function") {
      root.dispatchGameAction(state, { type:"action/stop" }, t);
    }
    if (state.currentAction) {
      state.currentAction.active = false;
      state.currentAction.progress = 0;
      state.currentAction.batchRemaining = 0;
      state.currentAction.lastProgressUpdate = t;
    }
    if (state.queue && state.queue.status) {
      state.queue.status.isRunning = false;
      state.queue.status.activeIndex = -1;
    }
    state._dirty = true;
    return queueRunning || hasNormalAction(state);
  }
  function enforceExclusiveActionState(state, now) {
    if (!isAnyTrialRunning(state)) return false;
    // 战斗试炼借用真实 combatTick；不能把 currentAction=combat 清掉，否则战斗会冻结。
    if (isBattleRunning(state) && state.combat && state.combat.active) return false;
    return stopNormalActivity(state, now);
  }
  function resourceKey(node) { return "special:" + String(node.resourceId || node.collectionResource || ""); }
  function getCollectionDailyReward(firstRewardAmount) {
    // 节点长期奖励取首次试炼奖励的 96%，并取整：100 -> 96/日，275 -> 264/日。
    return Math.max(0, Math.round(firstRewardAmount * COLLECTION_REWARD_DAILY_RATE));
  }
  function createCollectionRewardRecord(node, now) {
    const firstRewardAmount = Math.max(0, Number(node && (node.collectionAmount || node.amount)) || 0);
    const dailyAmount = getCollectionDailyReward(firstRewardAmount);
    const t = Number(now) || Date.now();
    return {
      nodeId:String(node && node.id != null ? node.id : ""),
      resourceId:String(node && (node.resourceId || node.collectionResource) || ""),
      firstRewardAmount:firstRewardAmount,
      dailyAmount:dailyAmount,
      hourlyAmount:dailyAmount / COLLECTION_REWARD_HOURS_PER_DAY,
      pendingAmount:0,
      accruedAt:t,
      totalAccruedHours:0,
      lastCollectedAt:0
    };
  }
  function normalizeCollectionRewardRecord(record, nodeId) {
    if (!record || typeof record !== "object") return null;
    const firstRewardAmount = Math.max(0, Number(record.firstRewardAmount) || 0);
    // 重新按当前规则计算，兼容旧存档中 1/10 规则留下的 dailyAmount/hourlyAmount。
    const dailyAmount = getCollectionDailyReward(firstRewardAmount);
    const hourlyAmount = dailyAmount / COLLECTION_REWARD_HOURS_PER_DAY;
    return {
      ...record,
      nodeId:String(record.nodeId != null ? record.nodeId : nodeId),
      resourceId:String(record.resourceId || ""),
      firstRewardAmount:firstRewardAmount,
      dailyAmount:dailyAmount,
      hourlyAmount:hourlyAmount,
      pendingAmount:Math.max(0, Number(record.pendingAmount) || 0),
      accruedAt:Number(record.accruedAt) || Date.now(),
      totalAccruedHours:Math.max(0, Math.floor(Number(record.totalAccruedHours) || 0)),
      lastCollectedAt:Number(record.lastCollectedAt) || 0
    };
  }
  function accrueCollectionRewards(state, now) {
    if (!state) return { changed:false, rewards:[] };
    const s = ensure(state);
    const t = Number(now) || Date.now();
    let changed = false;
    Object.keys(s.collectionRewards).forEach(function (nodeId) {
      const normalized = normalizeCollectionRewardRecord(s.collectionRewards[nodeId], nodeId);
      if (!normalized) { delete s.collectionRewards[nodeId]; changed = true; return; }
      if (normalized.resourceId && normalized.hourlyAmount > 0 && t >= normalized.accruedAt) {
        const elapsedHours = Math.floor((t - normalized.accruedAt) / COLLECTION_REWARD_HOUR_MS);
        if (elapsedHours > 0) {
          normalized.pendingAmount += normalized.hourlyAmount * elapsedHours;
          normalized.accruedAt += elapsedHours * COLLECTION_REWARD_HOUR_MS;
          normalized.totalAccruedHours += elapsedHours;
          changed = true;
        }
      }
      if (JSON.stringify(s.collectionRewards[nodeId]) !== JSON.stringify(normalized)) changed = true;
      s.collectionRewards[nodeId] = normalized;
    });
    if (changed) state._dirty = true;
    return { changed:changed, rewards:Object.keys(s.collectionRewards).map(function (nodeId) { return normalizeCollectionRewardRecord(s.collectionRewards[nodeId], nodeId); }).filter(Boolean) };
  }
  function getCollectionRewardStates(state, now) {
    return accrueCollectionRewards(state, now).rewards.map(function (record) { return { ...record }; });
  }
  function collectCollectionReward(state, nodeId, now) {
    if (!state || nodeId == null) return { changed:false, reason:"invalid-collection-reward" };
    accrueCollectionRewards(state, now);
    const s = ensure(state);
    const key = String(nodeId);
    const reward = normalizeCollectionRewardRecord(s.collectionRewards[key], key);
    if (!reward) return { changed:false, reason:"collection-reward-not-found" };
    const amount = Math.max(0, Number(reward.pendingAmount) || 0);
    if (!(amount > 0)) return { changed:false, reason:"collection-reward-empty", reward:{ ...reward, pendingAmount:0 } };
    if (!root.ResourceRegistry || typeof root.ResourceRegistry.add !== "function") return { changed:false, reason:"resource-registry-unavailable" };
    root.ResourceRegistry.add(state, "special:" + reward.resourceId, amount);
    reward.pendingAmount = 0;
    reward.lastCollectedAt = Number(now) || Date.now();
    s.collectionRewards[key] = reward;
    state._dirty = true;
    return { changed:true, nodeId:key, resourceId:reward.resourceId, amount:amount, reward:{ ...reward } };
  }
  function getArchaeologyRewardSpec(node) {
    if (!node || node.type !== "archaeology") return null;
    const fallback = ARCHAEOLOGY_REWARD_BY_RING[String(node.ring || "outer")] || ARCHAEOLOGY_REWARD_BY_RING.outer;
    const pickTier = function (value, fallbackTier) {
      const requested = String(value || "").toLowerCase();
      return ARCHAEOLOGY_CALIB_TIERS.includes(requested) ? requested : fallbackTier;
    };
    // 每日档位：优先新字段，回退环级兜底。注意 node.archaeologyRewardTier 是「站点/难度」档位
    // （内环为 v），并非奖励档位，严禁用作奖励兜底，否则内环每日会被误判为 v。
    const dailyTier = pickTier(node.archaeologyDailyRewardTier, fallback.dailyTier);
    // 首次档位：优先新字段，回退环级兜底（不回退旧 tier，否则老节点会重复拿同档）。
    const firstTier = pickTier(node.archaeologyFirstRewardTier, fallback.firstTier);
    const firstRewardAmount = Math.max(0, Math.floor(Number(node.archaeologyFirstRewardAmount) || fallback.firstRewardAmount));
    const dailyAmount = Math.max(1, Math.floor(Number(node.archaeologyDailyRewardAmount) || fallback.dailyAmount));
    const firstRewardId = "calibration:art_" + firstTier + "_calib";
    const dailyRewardId = "calibration:art_" + dailyTier + "_calib";
    return {
      tier:dailyTier,
      firstTier:firstTier,
      dailyTier:dailyTier,
      firstRewardId:firstRewardId,
      dailyRewardId:dailyRewardId,
      // rewardId 保留为「首次」档位，兼容旧读取方与老存档。
      rewardId:firstRewardId,
      firstRewardAmount:firstRewardAmount,
      dailyAmount:dailyAmount,
      hourlyAmount:dailyAmount / ARCHAEOLOGY_REWARD_HOURS_PER_DAY
    };
  }
  function getArchaeologyRewardName(rewardId) {
    const id = String(rewardId || "");
    if (root.ResourceRegistry && typeof root.ResourceRegistry.getResourceDisplayName === "function") {
      const display = root.ResourceRegistry.getResourceDisplayName(id);
      if (display && display !== id) return display;
    }
    const match = id.match(ARCHAEOLOGY_CALIB_RE);
    return match ? "校准基体 " + match[1].toUpperCase() + " 型" : id;
  }
  function createArchaeologyRewardRecord(node, now) {
    const spec = getArchaeologyRewardSpec(node);
    if (!spec || node.id == null) return null;
    const t = Number(now) || Date.now();
    return {
      nodeId:String(node.id),
      ring:String(node.ring || "outer"),
      tier:spec.tier,
      rewardId:spec.firstRewardId,
      rewardName:getArchaeologyRewardName(spec.firstRewardId),
      firstRewardId:spec.firstRewardId,
      dailyRewardId:spec.dailyRewardId,
      dailyRewardName:getArchaeologyRewardName(spec.dailyRewardId),
      firstRewardAmount:spec.firstRewardAmount,
      dailyAmount:spec.dailyAmount,
      hourlyAmount:spec.hourlyAmount,
      pendingAmount:0,
      accruedAt:t,
      totalAccruedHours:0,
      firstRewardGrantedAt:t,
      lastCollectedAt:0
    };
  }
  function normalizeArchaeologyRewardRecord(record, nodeId) {
    if (!record || typeof record !== "object") return null;
    const rewardId = String(record.rewardId || "");
    if (!/^calibration:art_(ii|iii|iv|v)_calib$/.test(rewardId)) return null;
    const tier = rewardId.match(/^calibration:art_(ii|iii|iv|v)_calib$/)[1];
    const dailyAmount = Math.max(1, Math.floor(Number(record.dailyAmount) || 0));
    return {
      ...record,
      nodeId:String(record.nodeId != null ? record.nodeId : nodeId),
      ring:String(record.ring || "outer"),
      tier:tier,
      rewardId:rewardId,
      rewardName:getArchaeologyRewardName(rewardId),
      firstRewardAmount:Math.max(0, Math.floor(Number(record.firstRewardAmount) || 0)),
      dailyAmount:dailyAmount,
      hourlyAmount:dailyAmount / ARCHAEOLOGY_REWARD_HOURS_PER_DAY,
      pendingAmount:Math.max(0, Number(record.pendingAmount) || 0),
      accruedAt:Number(record.accruedAt) || Date.now(),
      totalAccruedHours:Math.max(0, Math.floor(Number(record.totalAccruedHours) || 0)),
      firstRewardGrantedAt:Number(record.firstRewardGrantedAt) || 0,
      lastCollectedAt:Number(record.lastCollectedAt) || 0
    };
  }
  function archaeologyRewardStateView(record) {
    if (!record) return null;
    const pendingAmount = Math.max(0, Number(record.pendingAmount) || 0);
    return {
      ...record,
      rewardName:getArchaeologyRewardName(record.rewardId),
      pendingAmount:pendingAmount,
      pendingWholeAmount:Math.floor(pendingAmount + 1e-9),
      hoursUntilNextReward:ARCHAEOLOGY_REWARD_HOURS_PER_DAY - (record.totalAccruedHours % ARCHAEOLOGY_REWARD_HOURS_PER_DAY)
    };
  }
  function accrueArchaeologyRewards(state, now) {
    if (!state) return { changed:false, rewards:[] };
    const s = ensure(state);
    const t = Number(now) || Date.now();
    let changed = false;
    Object.keys(s.archaeologyRewards).forEach(function (nodeId) {
      const normalized = normalizeArchaeologyRewardRecord(s.archaeologyRewards[nodeId], nodeId);
      if (!normalized) { delete s.archaeologyRewards[nodeId]; changed = true; return; }
      if (normalized.hourlyAmount > 0 && t >= normalized.accruedAt) {
        const elapsedHours = Math.floor((t - normalized.accruedAt) / ARCHAEOLOGY_REWARD_HOUR_MS);
        if (elapsedHours > 0) {
          normalized.pendingAmount += normalized.hourlyAmount * elapsedHours;
          normalized.accruedAt += elapsedHours * ARCHAEOLOGY_REWARD_HOUR_MS;
          normalized.totalAccruedHours += elapsedHours;
          changed = true;
        }
      }
      if (JSON.stringify(s.archaeologyRewards[nodeId]) !== JSON.stringify(normalized)) changed = true;
      s.archaeologyRewards[nodeId] = normalized;
    });
    if (changed) state._dirty = true;
    return {
      changed:changed,
      rewards:Object.keys(s.archaeologyRewards).map(function (nodeId) {
        return archaeologyRewardStateView(normalizeArchaeologyRewardRecord(s.archaeologyRewards[nodeId], nodeId));
      }).filter(Boolean)
    };
  }
  function getArchaeologyRewardStates(state, now) {
    return accrueArchaeologyRewards(state, now).rewards.map(function (record) { return { ...record }; });
  }
  function getArchaeologyRewardState(state, nodeId, now) {
    if (!state || nodeId == null) return null;
    accrueArchaeologyRewards(state, now);
    const s = ensure(state);
    return archaeologyRewardStateView(normalizeArchaeologyRewardRecord(s.archaeologyRewards[String(nodeId)], String(nodeId)));
  }
  function initializeArchaeologyReward(state, node, now) {
    if (!state || !node || node.id == null) return { changed:false, reward:null };
    const s = ensure(state);
    const key = String(node.id);
    if (s.archaeologyRewards[key]) return { changed:false, reward:getArchaeologyRewardState(state, key, now) };
    const record = createArchaeologyRewardRecord(node, now);
    if (!record || !root.ResourceRegistry || typeof root.ResourceRegistry.add !== "function") return { changed:false, reward:null };
    root.ResourceRegistry.add(state, record.rewardId, record.firstRewardAmount);
    s.archaeologyRewards[key] = record;
    state._dirty = true;
    return {
      changed:true,
      reward:archaeologyRewardStateView(record),
      firstReward:{ rewardId:record.rewardId, name:record.rewardName, amount:record.firstRewardAmount }
    };
  }
  function collectArchaeologyRewards(state, now) {
    if (!state) return { changed:false, reason:"invalid-archaeology-reward" };
    accrueArchaeologyRewards(state, now);
    const s = ensure(state);
    if (!root.ResourceRegistry || typeof root.ResourceRegistry.add !== "function") return { changed:false, reason:"resource-registry-unavailable" };
    const items = [];
    Object.keys(s.archaeologyRewards).forEach(function (key) {
      const reward = normalizeArchaeologyRewardRecord(s.archaeologyRewards[key], key);
      if (!reward) return;
      const amount = Math.floor(Math.max(0, Number(reward.pendingAmount) || 0) + 1e-9);
      if (!(amount > 0)) { s.archaeologyRewards[key] = reward; return; }
      // 每日驻留发放「每日档位」（外II/中III/内IV）；首次档位（外III/中IV/内V）仅在通关时一次性发放。
      const grantedRewardId = reward.dailyRewardId || reward.rewardId;
      const grantedRewardName = reward.dailyRewardName || reward.rewardName;
      root.ResourceRegistry.add(state, grantedRewardId, amount);
      reward.pendingAmount = Math.max(0, reward.pendingAmount - amount);
      reward.lastCollectedAt = Number(now) || Date.now();
      s.archaeologyRewards[key] = reward;
      items.push({ nodeId:key, rewardId:grantedRewardId, name:grantedRewardName, amount:amount });
    });
    if (!items.length) return { changed:false, reason:"archaeology-reward-empty", rewards:getArchaeologyRewardStates(state, now) };
    state._dirty = true;
    return {
      changed:true,
      items:items,
      rewards:getArchaeologyRewardStates(state, now)
    };
  }
  function collectArchaeologyReward(state, nodeId, now) {
    return collectArchaeologyRewards(state, now);
  }
  function collectAllResidentRewards(state, now) {
    if (!state) return { changed:false, reason:"invalid-resident-reward" };
    const t = Number(now) || Date.now();
    const items = [];
    const collectionStates = getCollectionRewardStates(state, t);
    collectionStates.forEach(function (record) {
      const result = collectCollectionReward(state, record.nodeId, t);
      if (result && result.changed) items.push({ category:"collection", nodeId:result.nodeId, resourceId:result.resourceId, name:result.resourceId, amount:result.amount });
    });
    const productionStates = getProductionRewardStates(state, t);
    productionStates.forEach(function (record) {
      const result = collectProductionReward(state, record.nodeId, t);
      if (result && result.changed) (result.items || []).forEach(function (item) {
        items.push({ category:"production", nodeId:result.nodeId, rewardId:item.rewardId, name:item.name, amount:item.amount });
      });
    });
    const archaeologyResult = collectArchaeologyRewards(state, t);
    if (archaeologyResult && archaeologyResult.changed) (archaeologyResult.items || []).forEach(function (item) {
      items.push({ category:"archaeology", nodeId:item.nodeId, rewardId:item.rewardId, name:item.name, amount:item.amount });
    });
    const battleStates = getBattleRewardStates(state, t);
    battleStates.forEach(function (record) {
      const result = collectBattleReward(state, record.nodeId, t);
      if (result && result.changed) (result.items || []).forEach(function (item) {
        items.push({ category:"battle", nodeId:result.nodeId, rewardId:item.rewardId, name:item.name, amount:item.amount });
      });
    });
    if (!items.length) {
      return {
        changed:false,
        reason:"resident-reward-empty",
        collectionRewards:getCollectionRewardStates(state, t),
        productionRewards:getProductionRewardStates(state, t),
        archaeologyRewards:getArchaeologyRewardStates(state, t),
        battleRewards:getBattleRewardStates(state, t)
      };
    }
    state._dirty = true;
    return {
      changed:true,
      items:items,
      collectionRewards:getCollectionRewardStates(state, t),
      productionRewards:getProductionRewardStates(state, t),
      archaeologyRewards:getArchaeologyRewardStates(state, t),
      battleRewards:getBattleRewardStates(state, t)
    };
  }
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
  function lockArchaeologyNode(node) {
    if (!node || node.id == null) return null;
    const ring = String(node.ring || "outer");
    const rewardDefaults = ARCHAEOLOGY_REWARD_BY_RING[ring] || ARCHAEOLOGY_REWARD_BY_RING.outer;
    return {
      id:node.id, name:String(node.name || ""), ring:ring, tier:String(node.tier || "normal"), type:"archaeology", subtype:String(node.subtype || "遗迹扫描"),
      archaeologySiteId:String(node.archaeologySiteId || "site_iii_b"),
      archaeologyRewardTier:String(node.archaeologyRewardTier || rewardDefaults.tier),
      archaeologyFirstRewardAmount:Math.max(0, Math.floor(Number(node.archaeologyFirstRewardAmount) || rewardDefaults.firstRewardAmount)),
      archaeologyDailyRewardAmount:Math.max(0, Math.floor(Number(node.archaeologyDailyRewardAmount) || rewardDefaults.dailyAmount)),
      archaeologyDifficulty:Number(node.archaeologyDifficulty) || 121,
      archaeologyBaseCycleSeconds:Number(node.archaeologyBaseCycleSeconds) || 10,
      archaeologyTimeLimitSeconds:Number(node.archaeologyTimeLimitSeconds) || LIMIT_SECONDS,
      archaeologyTargetProgress:Number(node.archaeologyTargetProgress) || 14,
      archaeologyRareRate:Number(node.archaeologyRareRate) || 0.05,
      archaeologyInterferenceSeconds:Number(node.archaeologyInterferenceSeconds) || 1.5
    };
  }
  function lockBattleNode(node) {
    if (!node || node.id == null) return null;
    return {
      id:node.id, name:String(node.name || ""), ring:String(node.ring || "outer"), tier:String(node.tier || "normal"),
      type:"battle", subtype:String(node.subtype || "战斗"),
      battleTrialZoneId:String(node.battleTrialZoneId || ""),
      battleTrialEnemyCount:Math.max(1, Number(node.battleTrialEnemyCount) || 2),
      battleTrialTimeLimitSeconds:Number(node.battleTrialTimeLimitSeconds) || LIMIT_SECONDS,
      // 泰坦组件节点不参与战斗试炼奖励（2026-09-06），锁定快照必须带上该标记。
      titanComponent:node.titanComponent === true
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
  function battleNode(node) {
    return !!(node && node.type === "battle" && node.battleTrialZoneId && Number(node.battleTrialEnemyCount) > 0 && Number(node.battleTrialTimeLimitSeconds || LIMIT_SECONDS) > 0);
  }
  function getBattleZone(node) {
    if (!battleNode(node) || typeof COMBAT_ZONES === "undefined" || !Array.isArray(COMBAT_ZONES)) return null;
    return COMBAT_ZONES.find(function (zone) { return zone.id === node.battleTrialZoneId; }) || null;
  }
  function getBattleCombatDisplay(state, now, zoneId) {
    if (typeof root.getCombatDisplayState !== "function") return null;
    const combat = state && state.combat;
    if (!combat) return null;
    const previousZone = combat.zone;
    combat.zone = zoneId;
    let display = null;
    try { display = root.getCombatDisplayState(state, Number(now) || Date.now()); } catch (_) {}
    combat.zone = previousZone;
    return display;
  }
  function canStartBattleTrial(state, node, now) {
    if (!state) return { ok:false, reason:"invalid-state" };
    const zone = getBattleZone(node);
    if (!zone) return { ok:false, reason:"invalid-battle-node" };
    if (isAnyTrialRunning(state)) return { ok:false, reason:"starmap-trial-running" };
    if (isNodeCompleted(state, node) && !replayTestingEnabled) return { ok:false, reason:"starmap-trial-completed" };
    if (hasNormalActivity(state)) return { ok:false, reason:"player-action-running" };
    const display = getBattleCombatDisplay(state, now, zone.id);
    if (!display || !display.player || !display.player.hasShip) return { ok:false, reason:"no-combat-ship" };
    if (display.recovery && display.recovery.active) return { ok:false, reason:"repairing", remaining:display.recovery.remaining };
    if (!Array.isArray(display.weapons) || display.weapons.length === 0) return { ok:false, reason:"no-weapons" };
    return { ok:true, zone:zone, display:display };
  }
  function getBattleTrialFormationRoll(zone, node) {
    const formations = (typeof COMBAT_FORMATION_POOLS !== "undefined" && COMBAT_FORMATION_POOLS[zone && zone.formationPool]) || [];
    if (!formations.length) return 0;
    const expectedCount = Math.max(1, Number(node && node.battleTrialEnemyCount) || 2);
    let targetIndex = formations.findIndex(function (formation) {
      const count = Number(formation.normal || 0) + Number(formation.elite || 0) + Number(formation.boss || 0);
      return count === expectedCount && Number(formation.elite || 0) === 0 && Number(formation.boss || 0) === 0;
    });
    if (targetIndex < 0) targetIndex = formations.findIndex(function (formation) {
      const count = Number(formation.normal || 0) + Number(formation.elite || 0) + Number(formation.boss || 0);
      return count === expectedCount;
    });
    if (targetIndex < 0) targetIndex = formations.length - 1;
    const before = formations.slice(0, targetIndex).reduce(function (sum, formation) { return sum + (Number(formation.chance) || 0); }, 0);
    const chance = Math.max(0.000001, Number(formations[targetIndex].chance) || 0.000001);
    return Math.min(0.999999, before + chance * 0.5);
  }
  function getBattleTrialWaveZone(zone, node) {
    if (!zone || !node) return zone;
    // 星图大编队/专用编队（2026-09-05）：按「战区|档位」显式配置波次。
    // 命中 override 时提前返回：编队池/精英池/平衡系数全部以 override 为准，
    // 不再走旧的「elite 池重映射到 normal 槽」路径（避免 normal 槽被旧精英模板污染），
    // 且不改写 COMBAT_ZONES / 常规编队池，普通星带完全不受影响。
    const waveOverride = STARMAP_TRIAL_WAVE_OVERRIDES[zone.id + "|" + node.tier];
    if (waveOverride) {
      let out = { ...zone, formationPool:waveOverride.formationPool };
      if (Array.isArray(waveOverride.elitePool) && waveOverride.elitePool.length > 0) {
        out = { ...out, enemyPool:{ ...zone.enemyPool, elite:waveOverride.elitePool } };
      }
      if (waveOverride.hp != null || waveOverride.damage != null) {
        const base = zone.enemyBalance || { hp:1, damage:1 };
        out = { ...out, enemyBalance:{
          hp: waveOverride.hp != null ? waveOverride.hp : (Number(base.hp) || 1),
          damage: waveOverride.damage != null ? waveOverride.damage : (Number(base.damage) || 1),
          boss: base.boss || { hp:1, damage:1 }
        } };
      }
      return out;
    }
    if (node.tier !== "elite") return zone;
    const elitePool = zone.enemyPool && zone.enemyPool.elite;
    if (!Array.isArray(elitePool) || elitePool.length === 0) return zone;
    // 试炼精英档（未配置 override 的战区）保持旧行为：全部敌舰使用现有精英敌舰模板。
    return { ...zone, enemyPool:{ ...zone.enemyPool, normal:elitePool, elite:[] } };
  }
  function isBattleTrialRewardExcluded(node) {
    if (!node) return true;
    if (node.titanComponent === true) return true;
    return BATTLE_TRIAL_EXCLUDED_ZONE_IDS.indexOf(String(node.battleTrialZoneId || "")) >= 0;
  }
  function getBattleTrialZoneById(zoneId) {
    const id = String(zoneId || "");
    const zones = (typeof COMBAT_ZONES !== "undefined" && Array.isArray(COMBAT_ZONES)) ? COMBAT_ZONES : [];
    if (!id || !zones.length) return null;
    for (const entry of zones) { if (entry && String(entry.id) === id) return entry; }
    return null;
  }
  function battleTrialEnemyTypeKey(zone, node) {
    if (!zone) return "";
    const tier = node && node.tier === "elite" ? "elite" : "normal";
    const override = STARMAP_TRIAL_WAVE_OVERRIDES[zone.id + "|" + tier];
    if (override && Array.isArray(override.elitePool) && override.elitePool.length) return override.elitePool[0];
    const pool = zone.enemyPool ? (tier === "elite" ? zone.enemyPool.elite : zone.enemyPool.normal) : null;
    return Array.isArray(pool) && pool.length ? pool[0] : "";
  }
  // 同级单艘实得星币：优先取编队中与节点档位同级的敌舰 iskDrop 均值 × 战区 iskMulti。
  function battleTrialIskPerKill(enemies, node, zone) {
    const want = node && node.tier === "elite" ? "elite" : "normal";
    const list = (Array.isArray(enemies) ? enemies : []).filter(function (enemy) {
      return enemy && enemy.kind === want && Number(enemy.iskDrop) > 0;
    });
    const pool = list.length ? list : (Array.isArray(enemies) ? enemies : []).filter(function (enemy) {
      return enemy && Number(enemy.iskDrop) > 0;
    });
    if (!pool.length) return 0;
    const sum = pool.reduce(function (acc, enemy) { return acc + Number(enemy.iskDrop); }, 0);
    return Math.round(sum / pool.length * (Number(zone && zone.iskMulti) || 1));
  }
  // 未记录编队时（老存档补发）按战区反推：复用生产 createCombatEnemy 取模板 iskDrop。
  function battleTrialIskPerKillByZone(zone, node) {
    if (!zone || typeof createCombatEnemy !== "function") return 0;
    const waveZone = typeof getBattleTrialWaveZone === "function" ? getBattleTrialWaveZone(zone, node) : zone;
    const kinds = node && node.tier === "elite" ? ["elite", "normal"] : ["normal"];
    for (const kind of kinds) {
      const probe = createCombatEnemy(waveZone, kind, Math.random, {});
      if (probe && Number(probe.iskDrop) > 0) return Math.round(Number(probe.iskDrop) * (Number(waveZone.iskMulti) || 1));
    }
    return 0;
  }
  function battleTrialLicenseId(zone, node) {
    if (!zone) return "";
    const ring = node && BATTLE_TRIAL_LICENSE_BY_RING[node.ring] ? node.ring : "outer";
    const label = BATTLE_TRIAL_FACTION_LABEL[zone.faction] || BATTLE_TRIAL_FACTION_LABEL.angel;
    return "special:" + label + "装备生产许可" + (BATTLE_TRIAL_LICENSE_BY_RING[ring] || "A");
  }
  // 必掉货柜：第一次 rng 调用返回 0 使掉率判定必中，后续调用仍走真实随机决定尺寸，
  // 完全复用生产 rollCargoDrop 本身，不另写尺寸与入池逻辑。
  function grantBattleTrialCargo(state, zone, node) {
    if (typeof rollCargoDrop !== "function" || !zone) return null;
    let forced = true;
    const rng = function () { if (forced) { forced = false; return 0; } return Math.random(); };
    return rollCargoDrop({ kind:(node && node.tier === "elite" ? "elite" : "normal"), type:battleTrialEnemyTypeKey(zone, node) }, zone, rng, state);
  }
  function normalizeBattleRewardRecord(record, nodeId) {
    if (!record || typeof record !== "object") return null;
    const dailyIsk = Math.max(0, Math.round(Number(record.dailyIsk) || 0));
    const dailyCargo = Math.max(0, Number(record.dailyCargo) || 0);
    return {
      ...record,
      nodeId:String(record.nodeId != null ? record.nodeId : nodeId),
      ring:String(record.ring || "outer"),
      tier:record.tier === "elite" ? "elite" : "normal",
      dailyIsk:dailyIsk,
      hourlyIsk:dailyIsk / BATTLE_TRIAL_REWARD_HOURS_PER_DAY,
      cargoSize:String(record.cargoSize || ""),
      dailyCargo:dailyCargo,
      hourlyCargo:dailyCargo / BATTLE_TRIAL_REWARD_HOURS_PER_DAY,
      pendingIsk:Math.max(0, Number(record.pendingIsk) || 0),
      pendingCargo:Math.max(0, Number(record.pendingCargo) || 0),
      accruedAt:Number(record.accruedAt) || Date.now(),
      lastCollectedAt:Number(record.lastCollectedAt) || 0
    };
  }
  function accrueBattleRewards(state, now) {
    if (!state) return { changed:false, rewards:[] };
    const s = ensure(state);
    const t = Number(now) || Date.now();
    let changed = false;
    Object.keys(s.battleRewards).forEach(function (nodeId) {
      const normalized = normalizeBattleRewardRecord(s.battleRewards[nodeId], nodeId);
      if (!normalized) { delete s.battleRewards[nodeId]; changed = true; return; }
      if (t >= normalized.accruedAt && (normalized.hourlyIsk > 0 || normalized.hourlyCargo > 0)) {
        const elapsedHours = Math.floor((t - normalized.accruedAt) / BATTLE_TRIAL_REWARD_HOUR_MS);
        if (elapsedHours > 0) {
          normalized.pendingIsk += elapsedHours * normalized.hourlyIsk;
          if (normalized.cargoSize) normalized.pendingCargo += elapsedHours * normalized.hourlyCargo;
          normalized.accruedAt += elapsedHours * BATTLE_TRIAL_REWARD_HOUR_MS;
          changed = true;
        }
      }
      if (JSON.stringify(s.battleRewards[nodeId]) !== JSON.stringify(normalized)) changed = true;
      s.battleRewards[nodeId] = normalized;
    });
    if (changed) state._dirty = true;
    return { changed:changed, rewards:Object.keys(s.battleRewards).map(function (nodeId) {
      return normalizeBattleRewardRecord(s.battleRewards[nodeId], nodeId);
    }).filter(Boolean) };
  }
  function collectBattleReward(state, nodeId, now) {
    if (!state || nodeId == null) return { changed:false, reason:"invalid-battle-reward" };
    accrueBattleRewards(state, now);
    const s = ensure(state);
    const key = String(nodeId);
    const record = normalizeBattleRewardRecord(s.battleRewards[key], key);
    if (!record) return { changed:false, reason:"battle-reward-not-found" };
    if (!root.ResourceRegistry || typeof root.ResourceRegistry.add !== "function") return { changed:false, reason:"resource-registry-unavailable" };
    const t = Number(now) || Date.now();
    const items = [];
    const isk = Math.floor(record.pendingIsk + 1e-9);
    if (isk > 0) {
      root.ResourceRegistry.add(state, "currency:isk", isk);
      items.push({ rewardId:"currency:isk", name:"星币", amount:isk });
    }
    let cargo = 0;
    if (record.cargoSize) {
      cargo = Math.floor(record.pendingCargo + 1e-9);
      if (cargo > 0) {
        const itemId = typeof cargoItemId === "function" ? cargoItemId(record.cargoSize) : ("cargo:" + record.cargoSize);
        root.ResourceRegistry.add(state, itemId, cargo);
        items.push({ rewardId:itemId, name:"货柜" + record.cargoSize, amount:cargo });
      }
    }
    if (!items.length) return { changed:false, reason:"battle-reward-empty" };
    record.pendingIsk = Math.max(0, record.pendingIsk - isk);
    record.pendingCargo = Math.max(0, record.pendingCargo - cargo);
    record.lastCollectedAt = t;
    s.battleRewards[key] = record;
    state._dirty = true;
    return { changed:true, nodeId:key, items:items };
  }
  function getBattleRewardStates(state, now) {
    return accrueBattleRewards(state, now).rewards.map(function (record) { return { ...record }; });
  }
  function getBattleRewardState(state, nodeId, now) {
    if (!state || nodeId == null) return null;
    accrueBattleRewards(state, now);
    const s = ensure(state);
    return normalizeBattleRewardRecord(s.battleRewards[String(nodeId)], String(nodeId));
  }
  // 战斗试炼通关奖励：星带同级掉落 ×15（3 × 5）+ 货柜 ×5 + 许可 ×5，并建每日驻留账本。
  function grantBattleTrialRewards(state, node, now, options) {
    if (!state || !node || node.id == null) return null;
    if (isBattleTrialRewardExcluded(node)) return null;
    const zone = getBattleTrialZoneById(node.battleTrialZoneId);
    const registry = root.ResourceRegistry;
    if (!zone || !registry || typeof registry.add !== "function") return null;
    const opts = options || {};
    const t = Number(now) || Date.now();
    const starmap = ensure(state);
    const trial = starmap.battleTrial;
    const key = String(node.id);
    if (starmap.battleRewards[key]) return null;
    const kind = node.tier === "elite" ? "elite" : "normal";
    const rolls = BATTLE_TRIAL_DROP_ROLLS * BATTLE_TRIAL_ONCE_SCALE;
    let perKill = Math.max(0, Math.round(Number(opts.iskPerKill) || 0));
    if (!perKill) perKill = Math.max(0, Number(trial.iskPerKill) || 0);
    if (!perKill) perKill = battleTrialIskPerKillByZone(zone, node);
    const tally = Object.create(null);
    const record = function (id, qty, name, alreadyGranted) {
      if (!id || !(qty > 0)) return;
      if (!alreadyGranted) registry.add(state, id, qty);
      if (!tally[id]) tally[id] = { id:id, name:name || id, qty:0 };
      tally[id].qty += qty;
    };
    record("currency:isk", Math.round(perKill * rolls), "星币", false);
    for (let index = 0; index < rolls; index++) {
      if (typeof rollFactionEncryptedDataDrop === "function") {
        const drop = rollFactionEncryptedDataDrop(zone.faction, kind, Math.random(), zone, state);
        if (drop) record("special:" + drop.material, drop.qty, drop.material, true);
      }
      if (typeof rollCombatZoneSpecialDrops === "function") {
        rollCombatZoneSpecialDrops(zone, kind, [Math.random()], state).forEach(function (drop) {
          record(drop.resourceId, drop.qty, drop.material, true);
        });
      }
      if (typeof rollGearDrops === "function") {
        rollGearDrops(zone, kind, [Math.random()], state).forEach(function (drop) {
          record(drop.resourceId, drop.qty, drop.material, true);
        });
      }
      if (typeof rollStationCoreDrop === "function") {
        const drop = rollStationCoreDrop(zone, kind, Math.random(), state);
        if (drop) record(drop.resourceId, drop.qty, drop.material, true);
      }
      if (typeof rollDeathspaceTicketDrop === "function") {
        const drop = rollDeathspaceTicketDrop(zone, kind, Math.random(), state);
        if (drop) record("special:" + drop.material, drop.qty, drop.material, true);
      }
      if (typeof rollTacticalMaterialDrop === "function") {
        // 战术材料是纯计算函数（自身不发奖），需在此入池。
        const drop = rollTacticalMaterialDrop(zone, kind, Math.random);
        if (drop) record("special:" + drop.materialId, drop.quantity, drop.materialName || drop.materialId, false);
      }
    }
    let cargoSize = "";
    for (let index = 0; index < BATTLE_TRIAL_CARGO_COUNT; index++) {
      const cargo = grantBattleTrialCargo(state, zone, node);
      if (!cargo) continue;
      if (!cargoSize) cargoSize = String(cargo.size || "");
      record(cargo.itemId || ("cargo:" + cargo.size), 1, "货柜" + cargo.size, true);
    }
    const licenseId = battleTrialLicenseId(zone, node);
    if (licenseId) record(licenseId, BATTLE_TRIAL_LICENSE_COUNT, licenseId.replace(/^special:/, ""), false);
    const items = Object.keys(tally).map(function (id) { return tally[id]; });
    starmap.battleRewards[key] = normalizeBattleRewardRecord({
      nodeId:key,
      ring:String(node.ring || "outer"),
      tier:kind,
      dailyIsk:Math.round(perKill * BATTLE_TRIAL_DROP_ROLLS / BATTLE_TRIAL_DAILY_DIVISOR),
      cargoSize:cargoSize,
      dailyCargo:cargoSize ? BATTLE_TRIAL_DAILY_CARGO : 0,
      pendingIsk:0,
      pendingCargo:0,
      accruedAt:t,
      lastCollectedAt:0
    }, key);
    if (!opts.silent) {
      trial.rewardGrantedAt = t;
      trial.lastRewards = items;
    }
    state._dirty = true;
    return items;
  }
  function startBattleTrial(state, node, now, options) {
    const opts = options || {};
    if (state && state.combat && state.combat.active) return { changed:false, reason:"combat-running" };
    if (hasNormalActivity(state) && !opts.confirmed) return { changed:false, reason:"confirm-stop-action", currentSkill:state.currentAction && state.currentAction.skill || "current-action" };
    if (hasNormalActivity(state) && opts.confirmed) {
      stopNormalActivity(state, now);
      if (state.currentAction && state.currentAction.active) return { changed:false, reason:"action-stop-failed" };
    }
    const check = canStartBattleTrial(state, node, now);
    if (!check.ok) return { changed:false, reason:check.reason, remaining:check.remaining };
    if (typeof buildCombatWave !== "function" || typeof root.dispatchGameAction !== "function") return { changed:false, reason:"combat-unavailable" };
    const t = Number(now) || Date.now();
    const combat = state.combat;
    Object.assign(combat, {
      mode:"belt", viewMode:"belt", zone:check.zone.id, enemies:[], currentEnemy:null,
      wave:1, totalKills:0, runEliteKills:0, currentFormation:"", lastStatus:"",
      lastLoot:"", lastSpecialLoot:"", lastEnemyVolley:null, runDamageDealt:0, runDamageTaken:0,
      deathspaceChainPending:false, deathspaceChainRemaining:0
    });
    // buildCombatWave 的第一次随机数选择编队，后续随机数只用于敌舰抽取/洗牌；
    // 这里仅控制首个编队选择，仍复用现有战斗生成与结算，不另写敌人数据。
    const waveZone = getBattleTrialWaveZone(check.zone, node);
    // 续波一致性（2026-09-05）：战斗内核重建后续波次时用 combat.trialWaveZone，
    // 否则第 2 波起会退回原始战区平衡（旧系数），多波试炼难度不一致。
    let randomCalls = 0;
    const formationRoll = getBattleTrialFormationRoll(waveZone, node);
    const wave = buildCombatWave(waveZone, 1, function () { return randomCalls++ === 0 ? formationRoll : 0; }, combat);
    const enemyCount = Math.max(1, Math.min(Number(node.battleTrialEnemyCount) || 2, wave.enemies.length));
    if (!Array.isArray(wave.enemies) || wave.enemies.length < enemyCount) return { changed:false, reason:"missing-formation" };
    combat.trialWaveZone = waveZone;
    const trialEnemies = wave.enemies.slice(0, enemyCount);
    // 同级单艘实得星币：通关奖励按此基数发放，故在开战时随编队一起固化。
    const trialIskPerKill = battleTrialIskPerKill(trialEnemies, node, waveZone);
    const res = root.dispatchGameAction(state, { type:"combat/start", enemies:trialEnemies, formationId:wave.formationId }, t);
    if (!res || !res.changed) return { changed:false, reason:res && res.reason || "combat-start-failed", requiredCL:res && res.requiredCL, remaining:res && res.remaining };
    // 小队开战接线（2026-09-06 修复）：与普通星带（actions.js combat/start）和死亡空间同口径——
    // 把战前选择的 NPC（squad.pendingNpcIds）固化为本场小队成员。此前试炼从不拉起小队，
    // 玩家单人硬扛 BOSS 级齐射数回合即灭；无战前选择时该调用零副作用（玩家单舰，行为不变）。
    if (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD &&
        typeof LEGION_COMBAT_SQUAD.startLegionSquadBattleWithMembers === "function") {
      LEGION_COMBAT_SQUAD.startLegionSquadBattleWithMembers(state, { now: t });
    }
    const s = ensure(state).battleTrial;
    const limit = Number(node.battleTrialTimeLimitSeconds) || LIMIT_SECONDS;
    Object.assign(s, {
      status:"running", nodeId:String(node.id), lockedNode:lockBattleNode(node), zoneId:check.zone.id,
      enemyCount:enemyCount, kills:0, startedAt:t, endsAt:t + limit * 1000, wave:1, result:null,
      iskPerKill:trialIskPerKill, rewardGrantedAt:0, lastRewards:[],
      previousZone:combat.zone || null
    });
    state._dirty = true;
    return { changed:true, trial:{ ...s }, combat:res };
  }
  function finishBattleTrial(state, success, reason) {
    const s = ensure(state).battleTrial;
    if (state && state.combat) {
      state.combat.trialWaveZone = null;
      state.combat.trialPreviousZone = null;
      // 恢复试炼前玩家选中的普通星带，避免后续普通战斗误用试炼战区。
      if (s && s.previousZone) state.combat.zone = s.previousZone;
    }
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    s.status = success ? "success" : "failed";
    s.result = success ? "通过" : String(reason || "失败");
    s.kills = Math.max(0, Number(s.kills) || 0);
    if (success && s.nodeId != null) {
      const completedId = String(s.nodeId);
      const completed = ensure(state).completedNodeIds;
      if (!completed.includes(completedId)) completed.push(completedId);
      // 通关奖励（2026-09-06）：星带同级掉落 ×15 + 货柜 ×5 + 许可 ×5，并建立每日驻留账本。
      // 取开战时的节点快照；泰坦组件节点与核心节点在内部直接跳过。
      const rewardNode = s.lockedNode || { id:s.nodeId, ring:"outer", tier:"normal", battleTrialZoneId:s.zoneId };
      const rewards = grantBattleTrialRewards(state, rewardNode, Date.now());
      if (rewards) s.lastRewards = rewards;
    }
    // 试炼结束（2026-09-06）：参战 NPC 立即满修——destroyed/repairUntil 清除、combatHp 置空重算，
    // 与玩家侧「试炼后即刻满血再战」对齐（此前 NPC 爆船要吃 180 秒修复锁定，下次试炼无法上阵）。
    // 普通星带战败的 NPC 180s 维修不受影响（本出口仅星图试炼）。
    if (state && state.legion && Array.isArray(state.legion.npcs)) {
      for (const npc of state.legion.npcs) {
        npc.destroyed = false;
        npc.repairUntil = null;
        npc.occupiedByCombat = false;
        npc.combatHp = null;
      }
    }
    state._dirty = true;
    return { changed:true, success:success, trial:{ ...s } };
  }
  function stopBattleTrial(state) {
    const s = ensure(state).battleTrial;
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    // 先保存先前星带；dispatch combat/stop 会走 endCombatSession 清掉 trialPreviousZone，
    // 因此恢复逻辑依赖 battleTrial 状态里的 previousZone（startBattleTrial 时保存）。
    const previousZone = s && s.previousZone ? s.previousZone : (state && state.combat && state.combat.trialPreviousZone) || null;
    if (state && state.combat && (state.combat.active || (state.currentAction && state.currentAction.skill === "combat" && state.currentAction.active)) && typeof root.dispatchGameAction === "function") {
      root.dispatchGameAction(state, { type:"combat/stop" }, Date.now());
    }
    if (previousZone && state && state.combat) state.combat.zone = previousZone;
    Object.assign(s, { status:"idle", nodeId:null, lockedNode:null, zoneId:null, enemyCount:0, kills:0, startedAt:0, endsAt:0, wave:1, result:null, previousZone:null });
    state._dirty = true;
    return { changed:true, trial:{ ...s } };
  }
  function tickBattleTrial(state, now) {
    const s = ensure(state).battleTrial;
    if (s.status !== "running") return { changed:false, reason:"idle" };
    const t = Number(now) || Date.now();
    const combat = state.combat || {};
    const enemyCount = Math.max(1, Number(s.enemyCount) || 2);
    s.kills = Math.max(0, Math.min(enemyCount, Number(combat.totalKills) || 0));
    s.wave = Math.max(1, Number(combat.wave) || 1);
    // 共享战斗内核在清完第一波后会准备下一波；星图试炼只认证这一波，立即收口并保留真实掉落。
    if (s.kills >= enemyCount) {
      if (combat.active && typeof root.dispatchGameAction === "function") root.dispatchGameAction(state, { type:"combat/stop" }, t);
      return finishBattleTrial(state, true);
    }
    if (!combat.active) {
      let recovering = false;
      const display = getBattleCombatDisplay(state, t, s.zoneId);
      recovering = !!(display && display.recovery && display.recovery.active);
      return finishBattleTrial(state, false, recovering ? "战斗失败，舰船进入维修" : "战斗未完成");
    }
    if (t >= Number(s.endsAt)) {
      if (typeof root.dispatchGameAction === "function") root.dispatchGameAction(state, { type:"combat/stop" }, t);
      return finishBattleTrial(state, false, "超出试炼时限");
    }
    state._dirty = true;
    return { changed:true, trial:{ ...s } };
  }
  function isNodeCompleted(state, node) {
    if (!state || !node || node.id == null) return false;
    return ensure(state).completedNodeIds.includes(String(node.id));
  }
  function getProductionRewardSpec(node) {
    if (!node || node.type !== "production" || !node.productionReward || typeof node.productionReward !== "object") return null;
    const raw = node.productionReward;
    const kind = raw.kind === "booster" ? "booster" : "mineral";
    const dailyAmount = Math.max(1, Math.floor(Number(raw.dailyAmount) || 0));
    const rewardPool = Array.isArray(raw.rewardPool) ? raw.rewardPool.map(String).filter(Boolean) : [];
    const qualityPool = Array.isArray(raw.qualityPool) ? raw.qualityPool.map(String).filter(Boolean) : [];
    const qualityWeights = Array.isArray(raw.qualityWeights) ? raw.qualityWeights.map(function (entry) {
      return { quality:String(entry && entry.quality || ""), weight:Math.max(0, Number(entry && entry.weight) || 0) };
    }).filter(function (entry) { return entry.quality && entry.weight > 0; }) : [];
    return { kind:kind, dailyAmount:dailyAmount, hourlyAmount:dailyAmount / PRODUCTION_REWARD_HOURS_PER_DAY, rewardPool:rewardPool, qualityPool:qualityPool, qualityWeights:qualityWeights };
  }
  function getBoosterRewardPool(qualities) {
    const items = root.BOOSTER_ITEMS;
    if (!items || typeof items !== "object") return [];
    const allowed = new Set((qualities || []).map(String));
    return Object.keys(items).map(function (key) { return items[key]; }).filter(function (item) {
      return item && allowed.has(String(item.quality || "")) && item.itemId;
    }).map(function (item) { return String(item.itemId); });
  }
  function chooseWeightedQuality(spec) {
    const weights = spec && spec.qualityWeights && spec.qualityWeights.length ? spec.qualityWeights : (spec && spec.qualityPool || []).map(function (quality) { return { quality:quality, weight:1 }; });
    const total = weights.reduce(function (sum, entry) { return sum + entry.weight; }, 0);
    if (!(total > 0)) return "";
    let roll = Math.random() * total;
    for (const entry of weights) {
      roll -= entry.weight;
      if (roll <= 0) return entry.quality;
    }
    return weights[weights.length - 1].quality;
  }
  function chooseProductionRewardId(spec) {
    if (!spec) return "";
    if (spec.kind === "booster") {
      const quality = chooseWeightedQuality(spec);
      const pool = getBoosterRewardPool(quality ? [quality] : spec.qualityPool);
      if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
      const fallback = getBoosterRewardPool(spec.qualityPool);
      return fallback.length ? fallback[Math.floor(Math.random() * fallback.length)] : "";
    }
    const pool = spec.rewardPool || [];
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : "";
  }
  function getProductionRewardName(rewardId) {
    const id = String(rewardId || "");
    if (id.indexOf("booster:") === 0 && typeof root.getBoosterItem === "function") {
      const item = root.getBoosterItem(id);
      if (item && item.name) return item.name;
    }
    if (root.ResourceRegistry && typeof root.ResourceRegistry.getResourceDisplayName === "function") {
      const display = root.ResourceRegistry.getResourceDisplayName(id);
      if (display && display !== id) return display;
    }
    return id.replace(/^mineral:/, "");
  }
  function createProductionRewardRecord(node, now) {
    const spec = getProductionRewardSpec(node);
    if (!spec) return null;
    const t = Number(now) || Date.now();
    const currentRewardId = chooseProductionRewardId(spec);
    return {
      nodeId:String(node && node.id != null ? node.id : ""),
      subtype:String(node && node.subtype || "生产"),
      ring:String(node && node.ring || "outer"),
      rewardKind:spec.kind,
      rewardPool:spec.rewardPool.slice(),
      qualityPool:spec.qualityPool.slice(),
      qualityWeights:spec.qualityWeights.map(function (entry) { return { ...entry }; }),
      dailyAmount:spec.dailyAmount,
      hourlyAmount:spec.hourlyAmount,
      currentRewardId:currentRewardId,
      pendingByReward:{},
      accruedAt:t,
      cycleHours:0,
      cycleIndex:0,
      firstRewardAmount:spec.dailyAmount,
      firstRewardGrantedAt:t,
      totalAccruedHours:0,
      lastCollectedAt:0
    };
  }
  function syncResidentRewardsForCompletedNodes(state, nodes, now) {
    if (!state || !Array.isArray(nodes)) return { changed:false, nodeIds:[] };
    const s = ensure(state);
    const t = Number(now) || Date.now();
    const completed = new Set(s.completedNodeIds.map(String));
    let changed = false;
    nodes.forEach(function (node) {
      if (!node || node.id == null) return;
      const key = String(node.id);
      if (!node.conquered && !completed.has(key)) return;
      if (!completed.has(key)) {
        s.completedNodeIds.push(key);
        completed.add(key);
        changed = true;
      }
      // 历史制压节点只从迁移时开始累计驻留奖励，不重复发放首次通关奖励；
      // 保留规格数量供每日数量计算，legacyResident 仅作迁移标记。
      if (node.type === "collection" && !s.collectionRewards[key]) {
        const record = createCollectionRewardRecord(node, t);
        if (record) {
          record.firstRewardGrantedAt = 0;
          record.legacyResident = true;
          s.collectionRewards[key] = record;
          changed = true;
        }
      }
      if (node.type === "production" && !s.productionRewards[key]) {
        const record = createProductionRewardRecord(node, t);
        if (record) {
          record.firstRewardGrantedAt = 0;
          record.legacyResident = true;
          s.productionRewards[key] = record;
          changed = true;
        }
      }
      if (node.type === "archaeology" && !s.archaeologyRewards[key]) {
        const record = createArchaeologyRewardRecord(node, t);
        if (record) {
          record.firstRewardGrantedAt = 0;
          record.legacyResident = true;
          s.archaeologyRewards[key] = record;
          changed = true;
        }
      }
      // 战斗节点（2026-09-06 新增奖励）：已认证但从未发过奖励的老存档节点按战区反推基数补发一次，
      // battleRewards 存在即跳过，保证只补一次。泰坦组件与核心节点内部直接跳过，保持无奖励。
      if (node.type === "battle" && !s.battleRewards[key]) {
        grantBattleTrialRewards(state, node, t, {
          silent:true,
          iskPerKill:battleTrialIskPerKillByZone(getBattleTrialZoneById(node.battleTrialZoneId), node)
        });
        if (s.battleRewards[key]) changed = true;
      }
    });
    if (changed) state._dirty = true;
    return { changed:changed, nodeIds:s.completedNodeIds.slice() };
  }
  function normalizeProductionRewardRecord(record, nodeId) {
    if (!record || typeof record !== "object") return null;
    const pendingByReward = {};
    if (record.pendingByReward && typeof record.pendingByReward === "object" && !Array.isArray(record.pendingByReward)) {
      Object.keys(record.pendingByReward).forEach(function (rewardId) {
        const amount = Math.max(0, Number(record.pendingByReward[rewardId]) || 0);
        if (amount > 0) pendingByReward[String(rewardId)] = amount;
      });
    }
    const dailyAmount = Math.max(1, Math.floor(Number(record.dailyAmount) || 0));
    const hourlyAmount = dailyAmount / PRODUCTION_REWARD_HOURS_PER_DAY;
    const currentRewardId = String(record.currentRewardId || "");
    return {
      ...record,
      nodeId:String(record.nodeId != null ? record.nodeId : nodeId),
      subtype:String(record.subtype || "生产"),
      ring:String(record.ring || "outer"),
      rewardKind:record.rewardKind === "booster" ? "booster" : "mineral",
      rewardPool:Array.isArray(record.rewardPool) ? record.rewardPool.map(String).filter(Boolean) : [],
      qualityPool:Array.isArray(record.qualityPool) ? record.qualityPool.map(String).filter(Boolean) : [],
      qualityWeights:Array.isArray(record.qualityWeights) ? record.qualityWeights.map(function (entry) { return { quality:String(entry && entry.quality || ""), weight:Math.max(0, Number(entry && entry.weight) || 0) }; }).filter(function (entry) { return entry.quality && entry.weight > 0; }) : [],
      dailyAmount:dailyAmount,
      hourlyAmount:hourlyAmount,
      currentRewardId:currentRewardId,
      pendingByReward:pendingByReward,
      accruedAt:Number(record.accruedAt) || Date.now(),
      cycleHours:Math.max(0, Math.min(PRODUCTION_REWARD_HOURS_PER_DAY - 1, Math.floor(Number(record.cycleHours) || 0))),
      cycleIndex:Math.max(0, Math.floor(Number(record.cycleIndex) || 0)),
      firstRewardAmount:Math.max(0, Math.floor(Number(record.firstRewardAmount) || dailyAmount)),
      firstRewardGrantedAt:Number(record.firstRewardGrantedAt) || 0,
      totalAccruedHours:Math.max(0, Math.floor(Number(record.totalAccruedHours) || 0)),
      lastCollectedAt:Number(record.lastCollectedAt) || 0
    };
  }
  function productionRewardStateView(record) {
    if (!record) return null;
    const pendingItems = Object.keys(record.pendingByReward || {}).map(function (rewardId) {
      const amount = Math.max(0, Number(record.pendingByReward[rewardId]) || 0);
      return { rewardId:rewardId, name:getProductionRewardName(rewardId), amount:amount, wholeAmount:Math.floor(amount + 1e-9) };
    }).filter(function (entry) { return entry.amount > 0; });
    const pendingAmount = pendingItems.reduce(function (sum, entry) { return sum + entry.amount; }, 0);
    return { ...record, currentRewardName:getProductionRewardName(record.currentRewardId), pendingItems:pendingItems, pendingAmount:pendingAmount, pendingWholeAmount:pendingItems.reduce(function (sum, entry) { return sum + entry.wholeAmount; }, 0), hoursUntilNextReward:PRODUCTION_REWARD_HOURS_PER_DAY - record.cycleHours };
  }
  function accrueProductionRewards(state, now) {
    if (!state) return { changed:false, rewards:[] };
    const s = ensure(state);
    const t = Number(now) || Date.now();
    let changed = false;
    Object.keys(s.productionRewards).forEach(function (nodeId) {
      const normalized = normalizeProductionRewardRecord(s.productionRewards[nodeId], nodeId);
      if (!normalized) { delete s.productionRewards[nodeId]; changed = true; return; }
      if (normalized.currentRewardId && normalized.hourlyAmount > 0 && t >= normalized.accruedAt) {
        const elapsedHours = Math.floor((t - normalized.accruedAt) / PRODUCTION_REWARD_HOUR_MS);
        if (elapsedHours > 0) {
          for (let index = 0; index < elapsedHours; index++) {
            const rewardId = normalized.currentRewardId;
            normalized.pendingByReward[rewardId] = (Number(normalized.pendingByReward[rewardId]) || 0) + normalized.hourlyAmount;
            normalized.cycleHours += 1;
            normalized.totalAccruedHours += 1;
            if (normalized.cycleHours >= PRODUCTION_REWARD_HOURS_PER_DAY) {
              normalized.cycleHours = 0;
              normalized.cycleIndex += 1;
              const nextSpec = { kind:normalized.rewardKind, rewardPool:normalized.rewardPool, qualityPool:normalized.qualityPool, qualityWeights:normalized.qualityWeights };
              const nextRewardId = chooseProductionRewardId(nextSpec);
              if (nextRewardId) normalized.currentRewardId = nextRewardId;
            }
          }
          normalized.accruedAt += elapsedHours * PRODUCTION_REWARD_HOUR_MS;
          changed = true;
        }
      }
      if (JSON.stringify(s.productionRewards[nodeId]) !== JSON.stringify(normalized)) changed = true;
      s.productionRewards[nodeId] = normalized;
    });
    if (changed) state._dirty = true;
    return { changed:changed, rewards:Object.keys(s.productionRewards).map(function (nodeId) { return productionRewardStateView(normalizeProductionRewardRecord(s.productionRewards[nodeId], nodeId)); }).filter(Boolean) };
  }
  function getProductionRewardStates(state, now) {
    return accrueProductionRewards(state, now).rewards.map(function (record) { return { ...record }; });
  }
  function getProductionRewardState(state, nodeId, now) {
    if (!state || nodeId == null) return null;
    accrueProductionRewards(state, now);
    const s = ensure(state);
    return productionRewardStateView(normalizeProductionRewardRecord(s.productionRewards[String(nodeId)], String(nodeId)));
  }
  function initializeProductionReward(state, node, now) {
    if (!state || !node || node.id == null) return { changed:false, reward:null };
    const s = ensure(state);
    const key = String(node.id);
    if (s.productionRewards[key]) return { changed:false, reward:getProductionRewardState(state, key, now) };
    const record = createProductionRewardRecord(node, now);
    if (!record || !record.currentRewardId || !root.ResourceRegistry || typeof root.ResourceRegistry.add !== "function") return { changed:false, reward:null };
    root.ResourceRegistry.add(state, record.currentRewardId, record.firstRewardAmount);
    s.productionRewards[key] = record;
    state._dirty = true;
    return { changed:true, reward:productionRewardStateView(record), firstReward:{ rewardId:record.currentRewardId, name:getProductionRewardName(record.currentRewardId), amount:record.firstRewardAmount } };
  }
  function collectProductionReward(state, nodeId, now) {
    if (!state || nodeId == null) return { changed:false, reason:"invalid-production-reward" };
    accrueProductionRewards(state, now);
    const s = ensure(state);
    const key = String(nodeId);
    const reward = normalizeProductionRewardRecord(s.productionRewards[key], key);
    if (!reward) return { changed:false, reason:"production-reward-not-found" };
    if (!root.ResourceRegistry || typeof root.ResourceRegistry.add !== "function") return { changed:false, reason:"resource-registry-unavailable" };
    const items = [];
    Object.keys(reward.pendingByReward).forEach(function (rewardId) {
      const rawAmount = Math.max(0, Number(reward.pendingByReward[rewardId]) || 0);
      const amount = Math.floor(rawAmount + 1e-9);
      if (amount > 0) {
        root.ResourceRegistry.add(state, rewardId, amount);
        items.push({ rewardId:rewardId, name:getProductionRewardName(rewardId), amount:amount });
      }
      const remainder = rawAmount - amount;
      if (remainder > 1e-9) reward.pendingByReward[rewardId] = remainder;
      else delete reward.pendingByReward[rewardId];
    });
    if (!items.length) return { changed:false, reason:"production-reward-empty", reward:productionRewardStateView(reward) };
    reward.lastCollectedAt = Number(now) || Date.now();
    s.productionRewards[key] = reward;
    state._dirty = true;
    return { changed:true, nodeId:key, items:items, reward:productionRewardStateView(reward) };
  }
  function productionRequirements(node) {
    if (!node || node.type !== "production" || !Array.isArray(node.productionRequirements)) return [];
    return node.productionRequirements.map(function (entry) {
      const kind = ["resource", "ship", "equipment"].includes(String(entry && entry.kind || "")) ? String(entry.kind) : "resource";
      return {
        kind:kind,
        resourceId:String(entry && entry.resourceId || ""),
        itemId:String(entry && entry.itemId || ""),
        shipId:String(entry && entry.shipId || ""),
        name:String(entry && entry.name || ""),
        amount:Math.max(0, Math.floor(Number(entry && entry.amount) || 0)),
        minEnhancement:Math.max(0, Math.floor(Number(entry && entry.minEnhancement) || 0))
      };
    }).filter(function (entry) {
      const reference = entry.kind === "ship" ? entry.shipId : entry.kind === "equipment" ? entry.itemId : entry.resourceId;
      return reference && entry.amount > 0;
    });
  }
  function getResourceStock(state, resourceId) {
    if (!root.ResourceRegistry) return 0;
    if (typeof root.ResourceRegistry.getByRef === "function") return Number(root.ResourceRegistry.getByRef(state, resourceId)) || 0;
    if (typeof root.ResourceRegistry.get === "function") return Number(root.ResourceRegistry.get(state, resourceId)) || 0;
    return 0;
  }
  function availableShips(state, requirement) {
    const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
    const assigned = new Set(Object.values(state && state.shipAssignments || {}).filter(Boolean).map(String));
    if (state && state.combat && state.combat.activeShip) assigned.add(String(state.combat.activeShip));
    return ships.filter(function (ship) {
      if (!ship || ship.shipId !== requirement.shipId || assigned.has(String(ship.instanceId))) return false;
      const fitted = ship.fitted || {};
      const hasFittedEquipment = ["high", "mid", "low", "rig"].some(function (slot) { return Array.isArray(fitted[slot]) && fitted[slot].some(Boolean); });
      return !hasFittedEquipment && Math.max(0, Number(ship.enhancementLevel) || 0) >= requirement.minEnhancement;
    }).sort(function (left, right) { return (Number(left.enhancementLevel) || 0) - (Number(right.enhancementLevel) || 0); });
  }
  function availableEquipment(state, requirement) {
    const equipment = state && state.equipment || {};
    const entries = [];
    if (requirement.minEnhancement === 0 && Array.isArray(equipment.inventory)) {
      equipment.inventory.forEach(function (itemId, index) { if (itemId === requirement.itemId) entries.push({ source:"inventory", index:index, enhancementLevel:0 }); });
    }
    if (Array.isArray(equipment.instances)) {
      equipment.instances.forEach(function (instance, index) {
        const level = Math.max(0, Number(instance && instance.enhancementLevel) || 0);
        if (instance && instance.itemId === requirement.itemId && !instance.installedOn && level >= requirement.minEnhancement && (requirement.minEnhancement > 0 || level === 0)) {
          entries.push({ source:"instances", index:index, enhancementLevel:level, instanceId:instance.instanceId });
        }
      });
    }
    return entries.sort(function (left, right) { return left.enhancementLevel - right.enhancementLevel; });
  }
  function requirementStock(state, requirement) {
    if (requirement.kind === "ship") return availableShips(state, requirement).length;
    if (requirement.kind === "equipment") return availableEquipment(state, requirement).length;
    return getResourceStock(state, requirement.resourceId);
  }
  function getProductionRequirementState(state, node) {
    return productionRequirements(node).map(function (entry) {
      const owned = requirementStock(state, entry);
      return { ...entry, owned:owned, enough:owned >= entry.amount };
    });
  }
  function spendRequirement(state, requirement) {
    if (requirement.kind === "ship") {
      const selected = new Set(availableShips(state, requirement).slice(0, requirement.amount).map(function (ship) { return ship.instanceId; }));
      if (selected.size < requirement.amount) return false;
      state.inventory.ships = state.inventory.ships.filter(function (ship) { return !selected.has(ship.instanceId); });
      return true;
    }
    if (requirement.kind === "equipment") {
      const selected = availableEquipment(state, requirement).slice(0, requirement.amount);
      if (selected.length < requirement.amount) return false;
      const inventoryIndexes = new Set(selected.filter(function (entry) { return entry.source === "inventory"; }).map(function (entry) { return entry.index; }));
      const instanceIndexes = new Set(selected.filter(function (entry) { return entry.source === "instances"; }).map(function (entry) { return entry.index; }));
      state.equipment.inventory = state.equipment.inventory.filter(function (_, index) { return !inventoryIndexes.has(index); });
      state.equipment.instances = state.equipment.instances.filter(function (_, index) { return !instanceIndexes.has(index); });
      return true;
    }
    const spend = root.ResourceRegistry && (typeof root.ResourceRegistry.spendByRef === "function" ? root.ResourceRegistry.spendByRef : root.ResourceRegistry.spend);
    return typeof spend === "function" && spend.call(root.ResourceRegistry, state, requirement.resourceId, requirement.amount);
  }
  function canSubmitProductionTrial(state, node) {
    if (!state) return { ok:false, reason:"invalid-state" };
    const requirements = productionRequirements(node);
    if (!requirements.length) return { ok:false, reason:"invalid-production-node" };
    if (isAnyTrialRunning(state)) return { ok:false, reason:"starmap-trial-running" };
    if (isNodeCompleted(state, node) && !replayTestingEnabled) return { ok:false, reason:"starmap-trial-completed" };
    const stocks = getProductionRequirementState(state, node);
    return { ok:stocks.every(function (entry) { return entry.enough; }), reason:stocks.every(function (entry) { return entry.enough; }) ? null : "insufficient-production-materials", requirements:stocks };
  }
  function submitProductionTrial(state, node, now) {
    const check = canSubmitProductionTrial(state, node);
    if (!check.ok) return { changed:false, reason:check.reason, requirements:check.requirements || [] };
    for (const requirement of check.requirements) {
      if (!spendRequirement(state, requirement)) {
        return { changed:false, reason:"production-material-spend-failed", requirements:check.requirements };
      }
    }
    const starmap = ensure(state);
    const completedId = String(node.id);
    if (!starmap.completedNodeIds.includes(completedId)) starmap.completedNodeIds.push(completedId);
    Object.assign(starmap.productionTrial, {
      status:"success", nodeId:completedId, submittedAt:Number(now) || Date.now(),
      requirements:check.requirements.map(function (entry) { return { kind:entry.kind, resourceId:entry.resourceId, itemId:entry.itemId, shipId:entry.shipId, name:entry.name, amount:entry.amount, minEnhancement:entry.minEnhancement }; }),
      result:"通过"
    });
    const rewardResult = initializeProductionReward(state, node, now);
    state._dirty = true;
    return { changed:true, success:true, trial:{ ...starmap.productionTrial }, reward:rewardResult.reward, firstReward:rewardResult.firstReward || null };
  }
  function archaeologySite(node) {
    if (!node || node.type !== "archaeology" || !node.archaeologySiteId || typeof root.getArchaeologySite !== "function") return null;
    const base = root.getArchaeologySite(node.archaeologySiteId);
    if (!base) return null;
    return { ...base, difficulty:Number(node.archaeologyDifficulty) || Number(base.difficulty) || 121, time:Number(node.archaeologyBaseCycleSeconds) || 10 };
  }
  function archaeologyShip(state) {
    const instanceId = state && state.shipAssignments && state.shipAssignments.archaeology;
    if (!instanceId || typeof root.getShipInstanceFromState !== "function") return null;
    return root.getShipInstanceFromState(state, instanceId);
  }
  function canStartArchaeologyTrial(state, node) {
    if (!state) return { ok:false, reason:"invalid-state" };
    const site = archaeologySite(node);
    if (!site) return { ok:false, reason:"invalid-archaeology-node" };
    if (isAnyTrialRunning(state)) return { ok:false, reason:"starmap-trial-running" };
    if (isNodeCompleted(state, node) && !replayTestingEnabled) return { ok:false, reason:"starmap-trial-completed" };
    if (hasNormalAction(state)) return { ok:false, reason:"player-action-running" };
    const instance = archaeologyShip(state);
    if (!instance) return { ok:false, reason:"no-archaeology-ship" };
    const probeId = state.archaeology && state.archaeology.activeProbeId || "core_probe_i";
    if (!root.ResourceRegistry || typeof root.ResourceRegistry.get !== "function" || root.ResourceRegistry.get(state, "probe:" + probeId) < 1) return { ok:false, reason:"insufficient-probe" };
    const fuelState = typeof root.getArchaeologyFuelCostState === "function" ? root.getArchaeologyFuelCostState(state, site, instance) : { chargedFuel:0 };
    if (root.ResourceRegistry.get(state, "consumable:fuel") < Number(fuelState.chargedFuel || 0)) return { ok:false, reason:"insufficient-fuel" };
    const scanStrength = typeof root.computeArchaeologyScanStrength === "function" ? Number(root.computeArchaeologyScanStrength(state, instance, probeId)) || 0 : 0;
    const successChance = typeof root.getArchaeologyFinalSuccessChance === "function" ? Number(root.getArchaeologyFinalSuccessChance(state, scanStrength, site.difficulty)) || 0 : 0;
    const cycleSeconds = typeof root.getArchaeologyCycleSeconds === "function" ? Number(root.getArchaeologyCycleSeconds(state, site, { instanceId:instance.instanceId, probeId:probeId })) || site.time : site.time;
    return { ok:true, site:site, instance:instance, probeId:probeId, scanStrength:scanStrength, successChance:successChance, cycleSeconds:Math.max(0.05, cycleSeconds) };
  }
  function startArchaeologyTrial(state, node, now, options) {
    const opts = options || {};
    if (state && state.combat && state.combat.active) return { changed:false, reason:"combat-running" };
    if (hasNormalAction(state) && !opts.confirmed) return { changed:false, reason:"confirm-stop-action", currentSkill:state.currentAction.skill || "current-action" };
    if (hasNormalAction(state) && opts.confirmed) {
      stopNormalActivity(state, now);
      if (state.currentAction.active) return { changed:false, reason:"action-stop-failed" };
    }
    const check = canStartArchaeologyTrial(state, node);
    if (!check.ok) return { changed:false, reason:check.reason };
    const s = ensure(state).archaeologyTrial;
    const t = Number(now) || Date.now();
    stopNormalActivity(state, t);
    const limit = Number(node.archaeologyTimeLimitSeconds) || LIMIT_SECONDS;
    const trialShipHp = getArchaeologyTrialShipHp(state, check.instance.instanceId);
    if (!trialShipHp) return { changed:false, reason:"archaeology-hp-unavailable" };
    Object.assign(s, { status:"running", nodeId:String(node.id), lockedNode:lockArchaeologyNode(node), siteId:check.site.id, shipInstanceId:check.instance.instanceId, probeId:check.probeId, trialShipHp:trialShipHp, progress:0, target:Number(node.archaeologyTargetProgress) || 14, startedAt:t, endsAt:t + limit * 1000, nextScanAt:t + check.cycleSeconds * 1000, interferenceUntil:0, cycleSeconds:check.cycleSeconds, scanStrength:check.scanStrength, successChance:check.successChance, scans:0, successes:0, rareFinds:0, log:[], result:null });
    state._dirty = true;
    return { changed:true, trial:{ ...s } };
  }
  function finishArchaeologyTrial(state, success, reason, now) {
    const starmap = ensure(state);
    const s = starmap.archaeologyTrial;
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    const t = Number(now) || Date.now();
    const wasCompleted = s.nodeId != null && starmap.completedNodeIds.includes(String(s.nodeId));
    let rewardResult = null;
    s.status = success ? "success" : "failed";
    s.result = success ? "通过" : String(reason || "失败");
    if (success && s.nodeId != null) {
      const completedId = String(s.nodeId);
      const firstCompletion = !wasCompleted;
      if (firstCompletion) starmap.completedNodeIds.push(completedId);
      if (firstCompletion) rewardResult = initializeArchaeologyReward(state, s.lockedNode, t);
    }
    state._dirty = true;
    return {
      changed:true,
      success:success,
      trial:{ ...s },
      reward:rewardResult && rewardResult.reward ? rewardResult.reward : null,
      firstReward:rewardResult && rewardResult.firstReward ? rewardResult.firstReward : null
    };
  }
  function stopArchaeologyTrial(state) {
    const s = ensure(state).archaeologyTrial;
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    Object.assign(s, { status:"idle", nodeId:null, lockedNode:null, siteId:null, shipInstanceId:null, probeId:null, trialShipHp:null, progress:0, target:14, startedAt:0, endsAt:0, nextScanAt:0, interferenceUntil:0, cycleSeconds:0, scanStrength:0, successChance:0, scans:0, successes:0, rareFinds:0, log:[], result:null });
    state._dirty = true;
    return { changed:true, trial:{ ...s } };
  }
  function tickArchaeologyTrial(state, now) {
    const s = ensure(state).archaeologyTrial;
    if (s.status !== "running") return { changed:false, reason:"idle" };
    const t = Number(now) || Date.now();
    if (t < s.startedAt) return { changed:false, reason:"time-reversed" };
    const node = s.lockedNode || {};
    const site = archaeologySite(node);
    if (!site || typeof root.resolveArchaeologyCycle !== "function") return finishArchaeologyTrial(state, false, "考古结算不可用", t);
    const deadline = Math.min(t, Number(s.endsAt) || t);
    let changed = false;
    while (s.status === "running" && Number(s.nextScanAt) <= deadline) {
      const scanAt = Number(s.nextScanAt);
      const outcome = root.resolveArchaeologyCycle(state, scanAt, undefined, { source:"legion-starmap-trial", offline:false }, { site:site, instanceId:s.shipInstanceId, probeId:s.probeId, trial:true, trialHp:s.trialShipHp });
      if (!outcome || outcome.reason) return finishArchaeologyTrial(state, false, outcome && outcome.reason === "insufficient" ? "探针或燃料不足" : "扫描中断", scanAt);
      s.scans += 1;
      if (outcome.success) {
        s.successes += 1;
        const rare = Math.random() < (Number(node.archaeologyRareRate) || 0.05);
        if (rare) s.rareFinds += 1;
        const gain = rare ? 5 : 1;
        s.progress = Math.min(s.target, s.progress + gain);
        s.log.unshift({ time:scanAt, success:true, rare:rare, gain:gain, text:rare ? "稀有信号解析 +5" : "遗迹解析成功 +1" });
        if (s.progress >= s.target) return finishArchaeologyTrial(state, true, undefined, scanAt);
      } else {
        const interference = Number(node.archaeologyInterferenceSeconds) || 1.5;
        s.interferenceUntil = scanAt + interference * 1000;
        s.log.unshift({ time:scanAt, success:false, backlash:Number(outcome.backlash) || 0, destroyed:!!outcome.destroyed, text:outcome.destroyed ? "考古舰遭反噬重创" : "扫描失败 · 反噬 " + (Number(outcome.backlash) || 0) + " · 干扰 " + interference.toFixed(1) + "s" });
        if (outcome.destroyed) return finishArchaeologyTrial(state, false, "考古舰重创", scanAt);
        s.nextScanAt += interference * 1000;
      }
      const instance = typeof root.getShipInstanceFromState === "function" ? root.getShipInstanceFromState(state, s.shipInstanceId) : null;
      const cycle = typeof root.getArchaeologyCycleSeconds === "function" ? Number(root.getArchaeologyCycleSeconds(state, site, { instanceId:s.shipInstanceId, probeId:s.probeId })) || s.cycleSeconds : s.cycleSeconds;
      s.cycleSeconds = Math.max(0.05, cycle);
      s.scanStrength = instance && typeof root.computeArchaeologyScanStrength === "function" ? Number(root.computeArchaeologyScanStrength(state, instance, s.probeId)) || s.scanStrength : s.scanStrength;
      s.successChance = typeof root.getArchaeologyFinalSuccessChance === "function" ? Number(root.getArchaeologyFinalSuccessChance(state, s.scanStrength, site.difficulty)) || s.successChance : s.successChance;
      s.nextScanAt += s.cycleSeconds * 1000;
      s.log = s.log.slice(0, 8);
      changed = true;
    }
    if (t >= Number(s.endsAt)) return finishArchaeologyTrial(state, false, "未在时限内完成", t);
    if (changed) state._dirty = true;
    return { changed:changed, trial:{ ...s } };
  }
  function canStart(state, node) {
    if (!state || !active(state, node)) return { ok:false, reason:"invalid-collection-node" };
    if (isAnyTrialRunning(state)) return { ok:false, reason:"starmap-trial-running" };
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
      stopNormalActivity(state, now);
      if (state.currentAction.active) return { changed:false, reason:"action-stop-failed" };
    }
    const check = canStart(state, node);
    if (!check.ok) return { changed:false, reason:check.reason, efficiency:check.efficiency };
    const s = ensure(state).collectionTrial;
    const t = Number(now) || Date.now();
    stopNormalActivity(state, t);
    const limit = Number(node.collectionTimeLimitSeconds) || LIMIT_SECONDS;
    Object.assign(s, { status:"running", nodeId:String(node.id), lockedNode:lockNode(node), resourceId:String(node.collectionResource), kind:node.collectionKind || node.subtype || "", gathered:0, amount:Number(node.collectionAmount), startedAt:t, endsAt:t + limit * 1000, requiredSeconds:check.requiredSeconds, efficiency:check.efficiency, result:null });
    state._dirty = true;
    return { changed:true, trial:{ ...s }, willSucceed:check.willSucceed };
  }
  function finish(state, success, now) {
    const starmap = ensure(state);
    const s = starmap.collectionTrial;
    const wasCompleted = s.nodeId != null && starmap.completedNodeIds.includes(String(s.nodeId));
    if (s.status !== "running") return { changed:false, reason:"not-running" };
    s.status = success ? "success" : "failed";
    s.gathered = success ? s.amount : 0;
    s.result = success ? "\u901a\u8fc7" : "\u5931\u8d25";
    if (success && s.nodeId != null) {
      const completedId = String(s.nodeId);
      const completedNodeIds = starmap.completedNodeIds;
      const firstCompletion = !wasCompleted;
      if (firstCompletion) completedNodeIds.push(completedId);
      // 首次试炼产物立即入库；测试重试只复用房间，不重复发放首次奖励。
      if (firstCompletion) starmap.collectionRewards[completedId] = createCollectionRewardRecord({ id:completedId, resourceId:s.resourceId, collectionResource:s.resourceId, amount:s.amount }, Number(now) || Date.now());
      if (firstCompletion && root.ResourceRegistry && typeof root.ResourceRegistry.add === "function") root.ResourceRegistry.add(state, resourceKey(s), s.amount);
    }
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
  function tickCollection(state, now) {
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
  function tick(state, now) {
    if (!state) return { changed:false, reason:"invalid-state" };
    accrueProductionRewards(state, now);
    accrueArchaeologyRewards(state, now);
    if (isArchaeologyRunning(state)) return tickArchaeologyTrial(state, now);
    if (isBattleRunning(state)) return tickBattleTrial(state, now);
    return tickCollection(state, now);
  }
  function actionLock(state, action) {
    if (!isAnyTrialRunning(state) || !action || typeof action.type !== "string") return null;
    if (/^legion-starmap\//.test(action.type)) return null;
    if (isArchaeologyRunning(state) && (action.type === "archaeology/selectProbe" || action.type === "hangar/toggleAssignment")) return { changed:false, reason:"starmap-trial-running" };
    if (isBattleRunning(state) && /^combat\/(?:select|enter|start)/.test(action.type)) return { changed:false, reason:"starmap-trial-running" };
    return /(?:\/start|\/enter|\/begin|^start)/.test(action.type) ? { changed:false, reason:"starmap-trial-running" } : null;
  }
  function setReplayTestingEnabled(enabled) {
    replayTestingEnabled = !!enabled;
    return replayTestingEnabled;
  }
  function isReplayTestingEnabled() { return replayTestingEnabled; }
  API.ensureLegionStarmapState = ensure;
  API.isCollectionTrialRunning = isRunning;
  API.isArchaeologyTrialRunning = isArchaeologyRunning;
  API.isBattleTrialRunning = isBattleRunning;
  API.enforceExclusiveActionState = enforceExclusiveActionState;
  API.getLockedNode = function (state) {
    if (!state) return null;
    const starmap = ensure(state);
    if (starmap.collectionTrial.status === "running" && starmap.collectionTrial.lockedNode) return { ...starmap.collectionTrial.lockedNode };
    if (starmap.archaeologyTrial.status === "running" && starmap.archaeologyTrial.lockedNode) return { ...starmap.archaeologyTrial.lockedNode };
    if (starmap.battleTrial.status === "running" && starmap.battleTrial.lockedNode) return { ...starmap.battleTrial.lockedNode };
    return null;
  };
  API.canStartCollectionTrial = canStart;
  API.isNodeCompleted = isNodeCompleted;
  API.canSubmitProductionTrial = canSubmitProductionTrial;
  API.getProductionRequirementState = getProductionRequirementState;
  API.submitProductionTrial = submitProductionTrial;
  API.getProductionRewardSpec = getProductionRewardSpec;
  API.getProductionRewardStates = getProductionRewardStates;
  API.getProductionRewardState = getProductionRewardState;
  API.accrueProductionRewards = accrueProductionRewards;
  API.collectProductionReward = collectProductionReward;
  API.getArchaeologyRewardSpec = getArchaeologyRewardSpec;
  API.getArchaeologyRewardStates = getArchaeologyRewardStates;
  API.getArchaeologyRewardState = getArchaeologyRewardState;
  API.accrueArchaeologyRewards = accrueArchaeologyRewards;
  API.collectArchaeologyRewards = collectArchaeologyRewards;
  API.collectArchaeologyReward = collectArchaeologyReward;
  API.collectAllResidentRewards = collectAllResidentRewards;
  API.syncResidentRewardsForCompletedNodes = syncResidentRewardsForCompletedNodes;
  API.startCollectionTrial = start;
  API.canStartArchaeologyTrial = canStartArchaeologyTrial;
  API.startArchaeologyTrial = startArchaeologyTrial;
  API.finishArchaeologyTrial = finishArchaeologyTrial;
  API.stopArchaeologyTrial = stopArchaeologyTrial;
  API.canStartBattleTrial = canStartBattleTrial;
  API.startBattleTrial = startBattleTrial;
  API.finishBattleTrial = finishBattleTrial;
  API.stopBattleTrial = stopBattleTrial;
  API.tickBattleTrial = tickBattleTrial;
  API.isBattleTrialRewardExcluded = isBattleTrialRewardExcluded;
  API.grantBattleTrialRewards = grantBattleTrialRewards;
  API.getBattleRewardStates = getBattleRewardStates;
  API.getBattleRewardState = getBattleRewardState;
  API.accrueBattleRewards = accrueBattleRewards;
  API.collectBattleReward = collectBattleReward;
  API.tickLegionStarmapTrial = tick;
  API.finishCollectionTrial = finish;
  API.stopCollectionTrial = stop;
  API.accrueCollectionRewards = accrueCollectionRewards;
  API.getCollectionRewardStates = getCollectionRewardStates;
  API.collectCollectionReward = collectCollectionReward;
  API.getActionLock = actionLock;
  API.setReplayTestingEnabled = setReplayTestingEnabled;
  API.isReplayTestingEnabled = isReplayTestingEnabled;
  API.LIMIT_SECONDS = LIMIT_SECONDS;
  root.LEGION_STARMAP_TRIAL = API;

})(typeof window !== "undefined" ? window : globalThis);
