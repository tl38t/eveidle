/* ================================================================
   考古系统第二阶段 — 核心逻辑

   规则：
   - 仅修改显式传入的 state；不访问 DOM。
   - 成功率 / 反噬 / 掉落 全部为纯函数，便于审计工具独立验证。
   - 随机值通过 randomValue 注入（在线 tick 与离线结算共用同一解析），
     未注入时回退 Math.random()，保证存档往返确定。
   ================================================================ */

// ---- 随机值解析（与战斗一致） ----
function archaeologyRandom(randomValue) {
  if (Number.isFinite(Number(randomValue))) return Math.max(0, Math.min(0.999999999, Number(randomValue)));
  return Math.random();
}

// ---- 装备增益解析（含强化倍率，受上限约束） ----
function getArchaeologyFittedBonuses(state, instance) {
  const fitted = (instance && instance.fitted) || { high:[], mid:[], low:[] };
  let scan = 0, stabilizer = 0, decoder = 0;
  for (const slot of ["high", "mid", "low"]) {
    for (const ref of (fitted[slot] || [])) {
      if (!ref) continue;
      const resolved = resolveEquipmentReference(state, ref);
      if (!resolved) continue;
      const eq = resolved.definition;
      if (!eq || !eq.archaeology) continue;
      const enh = 1 + 0.1 * (resolved.enhancementLevel || 0);
      if (slot === "high" && eq.bonuses && eq.bonuses.archaeologyScan) scan += eq.bonuses.archaeologyScan * enh;
      if (slot === "mid" && eq.bonuses && eq.bonuses.archaeologyStabilizer) stabilizer += eq.bonuses.archaeologyStabilizer * enh;
      if (slot === "low" && eq.bonuses && eq.bonuses.archaeologyDecoder) decoder += eq.bonuses.archaeologyDecoder * enh;
    }
  }
  return {
    scan,
    stabilizer: Math.min(ARCHAEOLOGY_STABILIZER_CAP, stabilizer),
    decoder: Math.min(ARCHAEOLOGY_DECODER_CAP, decoder)
  };
}

// ---- 扫描强度（成功率分子） ----
function computeArchaeologyScanStrength(state, instance, probeId) {
  const config = instance ? getShipConfigById(instance.shipId) : null;
  if (!config) return 0;
  const skill = state.skills.archaeology || { lvl: 1, xp: 0 };
  const shipScan = (config.bonuses && config.bonuses.archaeologyScanStrength) || 0;
  const enhLevel = normalizeShipEnhancementLevel(instance.enhancementLevel);
  const enhBonuses = getShipEnhancementBonuses(config, enhLevel);
  const shipMul = enhBonuses.archaeologyScanMultiplier || 1;
  const fitted = getArchaeologyFittedBonuses(state, instance);
  const probe = getArchaeologyProbe(probeId);
  const probeBonus = probe ? probe.scanBonus : 0;
  const base = skill.lvl + shipScan * shipMul + fitted.scan + probeBonus;
  // 改装件扫描强度加成（archaeologyScanPercent，乘算在扫描强度总量上）
  let scanPercent = 0;
  if (typeof getRigModifiers === "function") {
    const mods = getRigModifiers(state, instance) || {};
    scanPercent = Number(mods.archaeologyScanPercent) || 0;
  }
  return base * (1 + Math.max(0, scanPercent));
}

// ---- 成功率 ----
function computeArchaeologySuccessChance(scanStrength, difficulty) {
  return Math.max(0.05, Math.min(0.95, 0.50 + (scanStrength - difficulty) * 0.01));
}

// ---- 舰船 HP 存取 ----
function getArchaeologyShipHp(state, instanceId) {
  if (!state.archaeology.shipHp) state.archaeology.shipHp = {};
  let hp = state.archaeology.shipHp[instanceId];
  if (hp) return hp;
  const instance = getShipInstanceFromState(state, instanceId);
  const config = instance ? getShipConfigById(instance.shipId) : null;
  hp = config
    ? { shield: config.hp.shield, armor: config.hp.armor, structure: config.hp.structure }
    : { shield: 0, armor: 0, structure: 0 };
  state.archaeology.shipHp[instanceId] = hp;
  return hp;
}

function resetArchaeologyShipHp(state, instanceId) {
  if (!state.archaeology.shipHp) state.archaeology.shipHp = {};
  const instance = getShipInstanceFromState(state, instanceId);
  const config = instance ? getShipConfigById(instance.shipId) : null;
  if (!config) return;
  state.archaeology.shipHp[instanceId] = { shield: config.hp.shield, armor: config.hp.armor, structure: config.hp.structure };
}

// ---- 反噬伤害结算（护盾→装甲→结构） ----
function applyArchaeologyDamage(hp, amount) {
  let remaining = Math.max(0, Math.ceil(amount));
  if (hp.shield > 0) {
    const absorbed = Math.min(hp.shield, remaining);
    hp.shield -= absorbed; remaining -= absorbed;
  }
  if (remaining > 0 && hp.armor > 0) {
    const absorbed = Math.min(hp.armor, remaining);
    hp.armor -= absorbed; remaining -= absorbed;
  }
  if (remaining > 0 && hp.structure > 0) {
    const absorbed = Math.min(hp.structure, remaining);
    hp.structure -= absorbed; remaining -= absorbed;
  }
  return hp.structure <= 0;
}

// ---- 信号干扰时长 ----
// interferenceReduction：改装件 archaeologyInterferenceReduction 缩短比例（0~0.9），
// 先按比例缩短再取 MIN 下限，保证干扰永不为零。
function getArchaeologyInterferenceSeconds(site, interferenceReduction) {
  const base = Math.round(site.time * 0.25);
  const reduction = Math.max(0, Math.min(0.90, Number(interferenceReduction) || 0));
  const reduced = Math.round(base * (1 - reduction));
  return Math.max(ARCHAEOLOGY_SIGNAL_MIN_SECONDS, reduced);
}

// ---- 掉落解析（rng 可注入，便于审计） ----
function weightedPick(weights, rng) {
  const roll = rng();
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (roll < cumulative) return i;
  }
  return weights.length - 1;
}

function resolveArchaeologyDrops(state, site, tier, fitted, rng, now) {
  const artifacts = getArchaeologyArtifactsByTier(tier.tier);
  const commons = artifacts.filter(a => a.category === "common_isk");
  const uniques = artifacts.filter(a => a.category === "unique");
  const lpArtifact = artifacts.find(a => a.category === "lp");
  const calibArtifact = artifacts.find(a => a.category === "calibration");
  const found = [];
  const profile = getSiteEffectiveProfile(site, tier);
  const commonWeights = profile ? profile.commonWeights : ARCHAEOLOGY_COMMON_WEIGHTS;
  const effectiveCalibRate = profile ? profile.effectiveCalibrationRate : tier.calibrationRate;
  const effectiveUniqueRate = profile ? profile.effectiveUniqueRate : tier.uniqueRate;
  const effectiveLpMult = profile ? profile.effectiveLpMultiplier : site.lpMultiplier;

  // 1) 普通 ISK 文物（必得，变体按地点权重）
  const commonIdx = weightedPick(commonWeights, rng);
  const common = commons[commonIdx];
  if (common) { ResourceRegistry.add(state, "artifact:" + common.id, 1); found.push(common); }

  // 2) 额外普通 ISK（译码器加成，受 75% 上限）
  if (fitted.decoder > 0 && rng() < fitted.decoder) {
    const extraIdx = weightedPick(commonWeights, rng);
    const extra = commons[extraIdx];
    if (extra) { ResourceRegistry.add(state, "artifact:" + extra.id, 1); found.push(extra); }
  }

  // 3) 独特文物（地点倍率 × 增强剂倍率 × 实验室倍率，上限 0.99）
  const rareShift = (typeof getBoosterEffectState === "function" && typeof getBoosterArchaeologyEffectiveUniqueRate === "function")
    ? getBoosterArchaeologyEffectiveUniqueRate(effectiveUniqueRate, getBoosterEffectState(state).rareShiftMultiplier)
    : effectiveUniqueRate;
  const labMult = (typeof getArchaeologyLabMultiplier === "function") ? getArchaeologyLabMultiplier(state) : 1;
  const withLab = Math.min(0.99, rareShift * labMult);
  const withoutLab = Math.min(0.99, rareShift);
  const uniqueRoll = rng();
  const dropped = uniqueRoll < withLab;
  const labCaused = labMult > 1 && uniqueRoll >= withoutLab && uniqueRoll < withLab;
  if (dropped && uniques.length) {
    const unique = uniques[Math.floor(rng() * uniques.length) % uniques.length];
    ResourceRegistry.add(state, "artifact:" + unique.id, 1); found.push(unique);
    if (labCaused) {
      if (typeof GameEvents !== "undefined") {
        GameEvents.emit("station:archaeologyBonusTriggered", {
          siteId: site.id, tier: tier.tier, artifactId: unique.id,
          baseUniqueRate: tier.uniqueRate, tracerMultiplier: rareShift / tier.uniqueRate,
          labMultiplier: labMult, effectiveRate: withLab
        }, { source:"station" });
      }
    }
  }

  // 4) 校准材料（地点倍率 × 档位 calibrationAmount）
  if (calibArtifact && rng() < effectiveCalibRate) {
    const calibAmount = Math.max(1, Math.round(Number(tier.calibrationAmount) || 1));
    ResourceRegistry.add(state, "calibration:" + calibArtifact.id, calibAmount); found.push(calibArtifact);
  }

  // 5) LP 文物（基础概率 × 地点有效 LP 倍率，最终 <1%）
  const lpChance = Math.min(0.0099, tier.lpBase * effectiveLpMult);
  if (lpArtifact && rng() < lpChance) {
    ResourceRegistry.add(state, "artifact:" + lpArtifact.id, 1); found.push(lpArtifact);
  }

  return found;
}

// ---- 燃料成本 + 确定性节省累计器（唯一计算层，见 RIG_SYSTEM_IMPLEMENTATION_PLAN 3.6） ----
// 在线 tick、离线结算、UI 展示三处必须共用此函数，保证结果一致、无随机、无 save-scumming。
// shipRef：考古舰实例对象（含 shipId / fitted），可为 null（此时无船体/改装件乘数）。
function getArchaeologyFuelCostState(state, site, shipRef) {
  const baseFuel = Math.max(1, Math.round((site && site.fuel) || 0));

  // 船体自身燃料效率乘数（与 getCombatFuelMultiplierFromState 读法一致）
  const config = shipRef ? getShipConfigById(shipRef.shipId) : null;
  const shipFuelMultiplier = (config && Number.isFinite(config.fuelEfficiency)) ? config.fuelEfficiency : 1;

  // 改装件燃料减免乘数（rigs.js 提供 getRigModifiers；未加载 / 无改装件时为 1）
  let rigFuelReduction = 0;
  if (typeof getRigModifiers === "function" && shipRef) {
    const mods = getRigModifiers(state, shipRef) || {};
    rigFuelReduction = Number(mods.archaeologyFuelEfficiency) || 0;
  }
  const rigFuelMultiplier = Math.max(0, 1 - Math.max(0, rigFuelReduction));

  // 生燃料成本（未取整），下限 1；也是长期平均消耗
  const rawFuelCost = Math.max(1, baseFuel * shipFuelMultiplier * rigFuelMultiplier);
  const savingPerCycle = Math.max(0, baseFuel - rawFuelCost);

  // 归一化上一次余量到 [0,1)
  const prevRaw = Number(state && state.archaeology && state.archaeology.fuelSavingRemainder);
  const previousRemainder = (Number.isFinite(prevRaw) && prevRaw > 0) ? (prevRaw - Math.floor(prevRaw)) : 0;

  const savingBalance = previousRemainder + savingPerCycle;
  // 攒满的整数节省；单次至少扣 1 燃料 → savedWholeFuel 上限 baseFuel - 1
  let savedWholeFuel = Math.floor(savingBalance + 1e-9);
  savedWholeFuel = Math.max(0, Math.min(savedWholeFuel, baseFuel - 1));

  const chargedFuel = Math.max(1, baseFuel - savedWholeFuel);

  let nextRemainder = savingBalance - savedWholeFuel;
  if (!Number.isFinite(nextRemainder) || nextRemainder < 0) nextRemainder = 0;
  nextRemainder = nextRemainder - Math.floor(nextRemainder); // 归一化 [0,1)

  return {
    baseFuel,
    shipFuelMultiplier,
    rigFuelMultiplier,
    rawFuelCost,
    savingPerCycle,
    previousRemainder,
    savedWholeFuel,
    chargedFuel,
    nextRemainder,
    averageFuelPerCycle: rawFuelCost
  };
}

// ---- 单次挖掘结算（在线/离线共用） ----
function resolveArchaeologyCycle(state, now, randomValue) {
  const arch = state.archaeology;
  const siteId = arch.startedSiteId;
  const probeId = arch.startedProbeId;
  const site = getArchaeologySite(siteId);
  if (!site) return { success:false, reason:"no-site" };
  const instanceId = state.shipAssignments && state.shipAssignments.archaeology;
  const instance = instanceId ? getShipInstanceFromState(state, instanceId) : null;
  if (!instance) return { success:false, reason:"no-ship" };

  // 燃料成本 = 唯一计算层结果（含船体 fuelEfficiency + 改装件减免 + 确定性累计器）
  const fuelState = getArchaeologyFuelCostState(state, site, instance);
  const chargedFuel = fuelState.chargedFuel;

  // 探针 / 燃料校验（不足则原子拒绝：不消耗任何资源、不推进累计器、停止）
  const probeStock = ResourceRegistry.get(state, "probe:" + probeId);
  const fuelStock = ResourceRegistry.get(state, "consumable:fuel");
  if (probeStock < 1 || fuelStock < chargedFuel) return { success:false, reason:"insufficient" };
  // 原子提交：燃料扣减 + 累计器推进一起写回（成功/失败扣同样的燃料）
  ResourceRegistry.spend(state, "probe:" + probeId, 1);
  ResourceRegistry.spend(state, "consumable:fuel", chargedFuel);
  arch.fuelSavingRemainder = fuelState.nextRemainder;

  const tier = getArchaeologyTierConfig(site.tier);
  const scanStrength = computeArchaeologyScanStrength(state, instance, probeId);
  const successChance = computeArchaeologySuccessChance(scanStrength, site.difficulty);
  const roll = archaeologyRandom(randomValue);
  const success = roll < successChance;

  GameEvents.emit("archaeology:attemptCompleted", { siteId:site.id, tier:site.tier, success, successChance }, { offline:Boolean(randomValue === "offline") });

  if (success) {
    addSkillXpToState(state, "archaeology", site.xp, { source:"archaeology" });
    const fitted = getArchaeologyFittedBonuses(state, instance);
    const rng = (randomValue === "offline" || typeof randomValue === "function")
      ? (typeof randomValue === "function" ? randomValue : Math.random)
      : Math.random;
    const found = resolveArchaeologyDrops(state, site, tier, fitted, typeof rng === "function" ? rng : Math.random, now);
    for (const artifact of found) {
      GameEvents.emit("archaeology:artifactFound", {
        artifactId: artifact.id, category: artifact.category, tier: artifact.tier,
        iskValue: artifact.iskValue || 0, lpValue: artifact.lpValue || 0
      }, { offline:Boolean(randomValue === "offline") });
    }
    GameEvents.emit("archaeology:success", { siteId:site.id, tier:site.tier, xp:site.xp }, { offline:Boolean(randomValue === "offline") });
    return { success:true, site, successChance, found };
  }

  // 失败：反噬伤害（含地点profile倍率）
  const config = getShipConfigById(instance.shipId);
  const shipReduction = (config && config.bonuses && config.bonuses.archaeologyFailureDamageReduction) || 0;
  const fitted = getArchaeologyFittedBonuses(state, instance);
  const tier3 = getArchaeologyTierConfig(site.tier);
  const profile3 = getSiteEffectiveProfile(site, tier3);
  const backlashMult = profile3 ? profile3.backlashMultiplier : 1;
  const backlash = Math.ceil(site.backlashDamage * (1 - shipReduction) * (1 - fitted.stabilizer) * backlashMult);
  const hp = getArchaeologyShipHp(state, instanceId);
  const destroyed = applyArchaeologyDamage(hp, backlash);
  GameEvents.emit("archaeology:failure", { siteId:site.id, tier:site.tier, backlashDamage:backlash }, { offline:Boolean(randomValue === "offline") });

  if (destroyed) {
    arch.repairUntil = now + ARCHAEOLOGY_REPAIR_SECONDS * 1000;
    arch.repairInstanceId = instanceId;
    GameEvents.emit("archaeology:shipDisabled", { instanceId, repairSeconds:ARCHAEOLOGY_REPAIR_SECONDS }, { offline:Boolean(randomValue === "offline") });
    return { success:false, site, successChance, backlash, destroyed:true };
  }
  return { success:false, site, successChance, backlash };
}

// ---- 文物出售 / 兑换 ----
function sellArchaeologyArtifacts(state, artifactId, quantity, all) {
  // 全部出售：遍历所有 ISK 文物
  if (all && !artifactId) {
    let totalIsk = 0, sold = 0;
    for (const artifact of ARCHAEOLOGY_ARTIFACTS) {
      if (artifact.category === "common_isk" || artifact.category === "unique") {
        const stock = ResourceRegistry.get(state, "artifact:" + artifact.id);
        if (stock > 0) {
          const iskValue = artifact.iskValue || 0;
          ResourceRegistry.spend(state, "artifact:" + artifact.id, stock);
          totalIsk += iskValue * stock;
          sold += stock;
        }
      }
    }
    if (sold === 0) return { changed:false, reason:"nothing-to-sell" };
    ResourceRegistry.add(state, "currency:isk", totalIsk);
    GameEvents.emit("archaeology:artifactsSold", { quantity:sold, totalIsk }, { offline:false });
    return { changed:true, all:true, totalIsk, sold };
  }

  const artifact = getArchaeologyArtifact(artifactId);
  if (!artifact || artifact.category === "calibration" || artifact.category === "lp") return { changed:false, reason:"not-sellable" };
  const stock = ResourceRegistry.get(state, "artifact:" + artifactId);
  const qty = all ? stock : Math.max(1, Math.min(quantity || 1, stock));
  if (qty <= 0 || stock < qty) return { changed:false, reason:"insufficient" };
  const iskValue = artifact.iskValue || 0;
  ResourceRegistry.spend(state, "artifact:" + artifactId, qty);
  ResourceRegistry.add(state, "currency:isk", iskValue * qty);
  GameEvents.emit("archaeology:artifactSold", { artifactId, quantity:qty, isk:iskValue * qty }, { offline:false });
  return { changed:true, artifactId, quantity:qty, isk:iskValue * qty };
}

function redeemArchaeologyArtifacts(state, artifactId, quantity, all) {
  // 全部兑换：遍历所有 LP 文物
  if (all && !artifactId) {
    let totalLp = 0, redeemed = 0;
    for (const artifact of ARCHAEOLOGY_ARTIFACTS) {
      if (artifact.category === "lp") {
        const stock = ResourceRegistry.get(state, "artifact:" + artifact.id);
        if (stock > 0) {
          const lpValue = artifact.lpValue || 0;
          ResourceRegistry.spend(state, "artifact:" + artifact.id, stock);
          totalLp += lpValue * stock;
          redeemed += stock;
        }
      }
    }
    if (redeemed === 0) return { changed:false, reason:"nothing-to-redeem" };
    ResourceRegistry.add(state, "currency:lp", totalLp);
    GameEvents.emit("archaeology:artifactsRedeemed", { quantity:redeemed, totalLp }, { offline:false });
    return { changed:true, all:true, totalLp, redeemed };
  }

  const artifact = getArchaeologyArtifact(artifactId);
  if (!artifact || artifact.category !== "lp") return { changed:false, reason:"not-redeemable" };
  const stock = ResourceRegistry.get(state, "artifact:" + artifactId);
  const qty = all ? stock : Math.max(1, Math.min(quantity || 1, stock));
  if (qty <= 0 || stock < qty) return { changed:false, reason:"insufficient" };
  const lpValue = artifact.lpValue || 0;
  ResourceRegistry.spend(state, "artifact:" + artifactId, qty);
  ResourceRegistry.add(state, "currency:lp", lpValue * qty);
  GameEvents.emit("archaeology:artifactRedeemed", { artifactId, quantity:qty, lp:lpValue * qty }, { offline:false });
  return { changed:true, artifactId, quantity:qty, lp:lpValue * qty };
}

// ---- 纯展示状态（供 UI） ----
function getArchaeologyDisplayState(state, now) {
  const arch = state.archaeology;
  const nowMs = Number(now) || Date.now();
  const instanceId = state.shipAssignments && state.shipAssignments.archaeology;
  const instance = instanceId ? getShipInstanceFromState(state, instanceId) : null;
  const config = instance ? getShipConfigById(instance.shipId) : null;
  const isArchaeologyShip = Boolean(config && ARCHAEOLOGY_SHIP_TYPES.includes(config.type));

  const assignedShip = instance ? {
    instanceId,
    name: config ? config.name : instance.shipId,
    type: config ? config.type : "",
    archaeology: isArchaeologyShip,
    hp: instanceId ? getArchaeologyShipHp(state, instanceId) : null,
    maxHp: config ? { ...config.hp } : null
  } : null;

  const repairing = arch.repairUntil > nowMs;
  const interference = arch.interferenceUntil > nowMs;
  const isArchActive = Boolean(state.currentAction.active && state.currentAction.skill === "archaeology");
  const boosterEff = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state) : null;

  // 运行中锁定目标，从 started 读取；待命时从 active 读取（允许选择切换）
  const effectiveSiteId = isArchActive ? (arch.startedSiteId || arch.activeSiteId) : arch.activeSiteId;
  const effectiveProbeId = isArchActive ? (arch.startedProbeId || arch.activeProbeId) : arch.activeProbeId;

  const sites = ARCHAEOLOGY_SITES.map(site => {
    const tier = getArchaeologyTierConfig(site.tier);
    const scanStrength = instance ? computeArchaeologyScanStrength(state, instance, effectiveProbeId) : 0;
    const successChance = computeArchaeologySuccessChance(scanStrength, site.difficulty);
    const probeStock = ResourceRegistry.get(state, "probe:" + effectiveProbeId);
    const fuelStock = ResourceRegistry.get(state, "consumable:fuel");
    const fuelState = getArchaeologyFuelCostState(state, site, instance);
    const canStart = isArchaeologyShip && (state.skills.archaeology.lvl || 1) >= site.level
      && probeStock >= 1 && fuelStock >= fuelState.chargedFuel && !repairing && !interference && !isArchActive;
    // 地点 profile
    const profile = getSiteEffectiveProfile(site, tier) || {};
    // 掉落预览
    const artis = getArchaeologyArtifactsByTier(tier.tier);
    const commonArts = artis.filter(a => a.category === "common_isk");
    const uniqueArts = artis.filter(a => a.category === "unique");
    const lpArt = artis.find(a => a.category === "lp");
    const calibArt = artis.find(a => a.category === "calibration");
    const cw = profile.commonWeights || ARCHAEOLOGY_COMMON_WEIGHTS;
    const commonNames = commonArts.map((a,i) => a.name + " (" + a.iskValue.toLocaleString() + " ISK, " + Math.round(cw[i]*100) + "%)").join("、");
    const uniqueNames = uniqueArts.map(a => a.name + " (" + a.iskValue.toLocaleString() + " ISK)").join("、");
    // 稀有率预览（含 profile 倍率）
    const effectiveUniqueRate = profile.effectiveUniqueRate !== undefined ? profile.effectiveUniqueRate : tier.uniqueRate;
    const rareShiftMul = (boosterEff && Number.isFinite(boosterEff.rareShiftMultiplier)) ? boosterEff.rareShiftMultiplier : 1;
    const labMult = (typeof getArchaeologyLabMultiplier === "function") ? getArchaeologyLabMultiplier(state) : 1;
    const tracerRate = (typeof getBoosterArchaeologyEffectiveUniqueRate === "function" && rareShiftMul !== 1)
      ? getBoosterArchaeologyEffectiveUniqueRate(effectiveUniqueRate, rareShiftMul) : effectiveUniqueRate;
    const boostedRate = Math.min(0.99, tracerRate * labMult);
    const uniqueRatePct = (effectiveUniqueRate * 100).toFixed(1);
    const boostedUniquePct = (boostedRate * 100).toFixed(1);
    const effectiveLpMult = profile.effectiveLpMultiplier !== undefined ? profile.effectiveLpMultiplier : site.lpMultiplier;
    const lpChancePct = (Math.min(0.0099, tier.lpBase * effectiveLpMult) * 100).toFixed(2);
    const effectiveCalibRate = profile.effectiveCalibrationRate !== undefined ? profile.effectiveCalibrationRate : tier.calibrationRate;
    const calibRatePct = (effectiveCalibRate * 100).toFixed(1);
    const calibAmount = tier.calibrationAmount;
    // 译码器概率
    const fitted = instance ? getArchaeologyFittedBonuses(state, instance) : { decoder:0 };
    const decoderPct = (fitted.decoder * 100).toFixed(1);
    // 实际反噬（含profile倍率，与resolveArchaeologyCycle一致）
    const shipReduction3 = (config && config.bonuses && config.bonuses.archaeologyFailureDamageReduction) || 0;
    const fittedBonuses = instance ? getArchaeologyFittedBonuses(state, instance) : { stabilizer:0 };
    const profile4 = getSiteEffectiveProfile(site, tier);
    const profBacklashMult = profile4 ? profile4.backlashMultiplier : 1;
    const effectiveBacklash = Math.ceil(site.backlashDamage * profBacklashMult * (1 - shipReduction3) * (1 - fittedBonuses.stabilizer));
    // 干扰
    const rigInterfRed = instance && typeof getRigModifiers === "function"
      ? (getRigModifiers(state, instance) || {}).archaeologyInterferenceReduction || 0 : 0;
    const interferenceSec = getArchaeologyInterferenceSeconds(site, rigInterfRed);
    // 实际周期时间（含加速 ÷ 空间站综合后勤倍率）
    const archSpeedEff = (boosterEff && boosterEff.archaeologySpeedMultiplier) || 1;
    const archLogisticsMult = (typeof getStationLogisticsMultiplier === "function") ? Math.max(0.001, getStationLogisticsMultiplier(state)) : 1;
    const actualCycleTime = site.time * archSpeedEff / archLogisticsMult;
    return {
      id: site.id, name: site.name, tier: site.tier, level: site.level,
      difficulty: site.difficulty, time: site.time, fuel: site.fuel, xp: site.xp,
      lpMultiplier: site.lpMultiplier, backlashDamage: site.backlashDamage,
      profile: { type:profile.type || "", label:profile.label || "", desc:profile.desc || "" },
      successChance, successPercent: (successChance * 100).toFixed(1),
      actualCycleTime, archSpeedEff, archLogisticsMult,
      baseFuel: fuelState.baseFuel,
      nextFuelCost: fuelState.chargedFuel,
      averageFuelPerCycle: Number(fuelState.averageFuelPerCycle.toFixed(2)),
      fuelSavedNext: fuelState.savedWholeFuel,
      interferenceSec,
      effectiveBacklash,
      levelLocked: (state.skills.archaeology.lvl || 1) < site.level,
      actionLocked: isArchActive && effectiveSiteId !== site.id,
      runningTarget: isArchActive && effectiveSiteId === site.id,
      locked: (state.skills.archaeology.lvl || 1) < site.level || (isArchActive && effectiveSiteId !== site.id),
      selected: effectiveSiteId === site.id,
      canStart,
      drops: {
        common: { items:commonArts, weights:cw.map(w=>Math.round(w*100)), text:commonNames },
        unique: { items:uniqueArts, ratePct:Number(uniqueRatePct), boostedPct:Number(boostedUniquePct), text:uniqueNames },
        lp: { item:lpArt, ratePct:Number(lpChancePct) },
        calibration: { item:calibArt, ratePct:Number(calibRatePct), amount:calibAmount }
      },
      preview: {
        decoderPct: Number(decoderPct),
        effectiveUniqueRate: Number(uniqueRatePct),
        effectiveCalibrationRate: Number(calibRatePct),
        effectiveLpMultiplier: effectiveLpMult,
        expectedCommonIsk: (cw[0]*commonArts[0].iskValue+cw[1]*commonArts[1].iskValue+cw[2]*commonArts[2].iskValue),
        expectedCommonIskPerSuccess: (cw[0]*commonArts[0].iskValue+cw[1]*commonArts[1].iskValue+cw[2]*commonArts[2].iskValue) * (1 + fitted.decoder),
        expectedUniqueIskPerSuccess: boostedRate * (uniqueArts.reduce((s,a)=>s+a.iskValue,0) / Math.max(1, uniqueArts.length)),
        expectedIskPerCycle: successChance * (
          (cw[0]*commonArts[0].iskValue+cw[1]*commonArts[1].iskValue+cw[2]*commonArts[2].iskValue) * (1 + fitted.decoder)
          + boostedRate * (uniqueArts.reduce((s,a)=>s+a.iskValue,0) / Math.max(1, uniqueArts.length))
        ),
        expectedLpPerCycle: successChance * Number(lpChancePct)/100 * (lpArt ? lpArt.lpValue : 0),
        expectedCalibPerCycle: successChance * effectiveCalibRate * calibAmount
      }
    };
  });

  // 燃料累计器展示：当前余量（如 0.64/1）与改装件燃料减免百分比
  const remRaw = Number(arch.fuelSavingRemainder);
  const fuelRemainder = (Number.isFinite(remRaw) && remRaw > 0) ? (remRaw - Math.floor(remRaw)) : 0;
  let rigFuelReductionPercent = 0;
  if (typeof getRigModifiers === "function" && instance) {
    const mods = getRigModifiers(state, instance) || {};
    rigFuelReductionPercent = Math.round((Number(mods.archaeologyFuelEfficiency) || 0) * 100);
  }
  const shipFuelEfficiency = (config && Number.isFinite(config.fuelEfficiency)) ? config.fuelEfficiency : 1;

  const probes = ARCHAEOLOGY_PROBES.map(probe => ({
    id: probe.id, name: probe.name, level: probe.level, scanBonus: probe.scanBonus,
    stock: ResourceRegistry.get(state, "probe:" + probe.id),
    selected: effectiveProbeId === probe.id,
    levelLocked: (state.skills.archaeology.lvl || 1) < probe.level,
    actionLocked: isArchActive,
    locked: (state.skills.archaeology.lvl || 1) < probe.level || isArchActive
  }));

  // 文物库存（按类别聚合）
  const artifactRows = ARCHAEOLOGY_ARTIFACTS
    .map(artifact => ({ artifact, count: ResourceRegistry.get(state, (artifact.category === "calibration" ? "calibration:" : "artifact:") + artifact.id) }))
    .filter(row => row.count > 0);

  // 进度百分比：从 currentAction.progress 读取（tick 实际更新此值）
  const activeSite = isArchActive ? getArchaeologySite(effectiveSiteId) : null;
  const archSpeedEff = (boosterEff && boosterEff.archaeologySpeedMultiplier) || 1;
  const cycleDuration = activeSite ? activeSite.time * archSpeedEff : 1;
  const progressPct = isArchActive && cycleDuration > 0
    ? Math.min(100, (Number(state.currentAction.progress) || 0) / cycleDuration * 100) : 0;

  return {
    archaeology: {
      active: isArchActive,
      activeSiteId: arch.activeSiteId,
      activeProbeId: arch.activeProbeId,
      startedSiteId: arch.startedSiteId,
      startedProbeId: arch.startedProbeId,
      progress: progressPct,
      repairing,
      repairRemaining: repairing ? Math.ceil((arch.repairUntil - nowMs) / 1000) : 0,
      interference,
      interferenceRemaining: interference ? Math.ceil((arch.interferenceUntil - nowMs) / 1000) : 0,
      log: (arch.log || []).slice(-12).reverse(),
      // 燃料累计器（UI 直观展示）
      fuelRemainder,
      fuelRemainderText: fuelRemainder.toFixed(2) + "/1",
      rigFuelReductionPercent,
      shipFuelEfficiency
    },
    assignedShip,
    canAssign: isArchaeologyShip,
    sites,
    probes,
    artifacts: artifactRows,
    stationLogistics: (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(state) : {}
  };
}

window.getArchaeologyDisplayState = getArchaeologyDisplayState;
window.computeArchaeologyScanStrength = computeArchaeologyScanStrength;
window.computeArchaeologySuccessChance = computeArchaeologySuccessChance;
window.getArchaeologyFittedBonuses = getArchaeologyFittedBonuses;
window.resolveArchaeologyCycle = resolveArchaeologyCycle;
window.getArchaeologyFuelCostState = getArchaeologyFuelCostState;
window.sellArchaeologyArtifacts = sellArchaeologyArtifacts;
window.redeemArchaeologyArtifacts = redeemArchaeologyArtifacts;
