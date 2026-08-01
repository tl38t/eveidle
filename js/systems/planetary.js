/* ================================================================
   行星开发系统核心与旧调用兼容层
   DOM、弹窗和Canvas位于 js/ui/planetary-render.js
   ================================================================ */

function getPlanetSlots() {
  return getPlanetaryCapacityState(gameState).slots;
}

function getPlanetMaxSlots() {
  return getPlanetaryCapacityState(gameState).maxSlots;
}

function getPlanetStorageMax(planetType) {
  if (planetType) {
    return getPlanetStorageMaxFromState(gameState, planetType);
  }
  // 无类型时取第一个部署（兼容旧调，实际调用应传入类型）
  const deployments = gameState.planetary && Array.isArray(gameState.planetary.deployments) ? gameState.planetary.deployments : [];
  if (deployments.length > 0) return getPlanetStorageMaxFromState(gameState, deployments[0].planetType);
  return getPlanetStorageMaxFromState(gameState, "lava");
}

function getPlanetOutputInterval(type) {
  return getPlanetOutputIntervalFromState(gameState, type);
}

function getPlanetTypeCfg(type) {
  return PLANET_TYPES.find(planet => planet.id === type);
}

// 纯函数：结算单个部署在 [fromTime, toTime] 区间内、夹紧到 [deployedAt, deployedAt+durationMs] 的有效产出。
// 在线（planetaryTick）与离线（settleOfflinePlanets）共用，避免两套周期公式漂移。
// 返回 { progress, storage, cycles, endSettled }；endSettled 为应写入 lastTick 的时间（= min(toTime, expiresAt)，且不早于 deployedAt）。
// 满仓时丢弃残留进度（与历史行为一致）；storage 上限由调用方传入，不在此改动 interval/技能公式。
function computePlanetarySettlement({ fromTime, toTime, progress, storage, interval, storageMax, deployedAt, durationMs }) {
  const depStart = Number(deployedAt) || 0;
  const durMs = Number(durationMs) > 0 ? Number(durationMs) : 86400 * 1000; // durationMs 已是毫秒
  const start = Math.max(Number(fromTime) || 0, depStart);
  const end = Math.min(Number(toTime) || 0, depStart + durMs);
  const elapsedSeconds = Math.max(0, (end - start) / 1000);
  let prog = (Number(progress) || 0) + elapsedSeconds;
  let stor = Number(storage) || 0;
  let cycles = 0;
  while (prog >= interval && stor < storageMax) {
    prog -= interval;
    stor += 1;
    cycles += 1;
  }
  if (stor >= storageMax) prog = 0; // 满仓丢弃残留进度
  return { progress: prog, storage: stor, cycles, endSettled: Math.max(end, start) }; // lastTick 不回退
}

// 研究批次 I · planauto：单 deployment 时间轴（在线 planetaryTick 与离线 settleOfflinePlanets 唯一共用入口）。
// 语义：
//   1) 先把 [fromTime, min(toTime, expiresAt)] 的最后一段产出结算完；
//   2) 到达精确 expiresAt 时判断并执行一次自动续期（走 tryPlanetAutoRenew → PlanetaryStateActions.renew）；
//   3) 续期成功后若 toTime 仍在更后方，继续处理下一个维护周期（逐周期判断储备金、逐次扣费）；
//   4) 未续期则精确停产并只触发一次 expired（expiredAt 用虚拟时间轴边界）。
// 事件发射方式由 context.emit 决定（在线走 GameEvents，离线走 emitOfflineGameEvent），
// 自动收取由 context.collect 决定（在线/离线沿用各自既有语义）。
function advancePlanetDeploymentTimeline(state, deployment, fromTime, toTime, context) {
  const ctx = context || {};
  const emit = typeof ctx.emit === "function"
    ? ctx.emit
    : ((type, payload, eventMeta) => { if (typeof GameEvents !== "undefined") GameEvents.emit(type, payload, { offline:false, ...(eventMeta && typeof eventMeta === "object" ? eventMeta : {}) }); });
  const interval = getPlanetOutputIntervalFromState(state, deployment.planetType);
  const storageMax = getPlanetStorageMaxFromState(state, deployment.planetType);
  const end = Number(toTime) || 0;
  let cursor = Number(fromTime) || 0;
  let cycles = 0;
  let renewals = 0;
  let renewedISK = 0;
  let expired = false;
  let collected = 0;
  // 防御性上限：单次结算最多处理的维护周期数（正常离线上限 24h / 维护周期 24h ≪ 该值）
  for (let guard = 0; guard < 5000; guard += 1) {
    const deployedAt = Number(deployment.deployedAt) || 0;
    const durationMs = (Number(deployment.duration) > 0 ? Number(deployment.duration) : 86400) * 1000;
    const expiresAt = deployedAt + durationMs;

    const res = computePlanetarySettlement({
      fromTime: cursor,
      toTime: end,
      progress: deployment.progress,
      storage: deployment.storage,
      interval,
      storageMax,
      deployedAt,
      durationMs
    });
    deployment.progress = res.progress;
    deployment.storage = res.storage;
    deployment.lastTick = res.endSettled; // 不越过 expiresAt，避免重复收益
    if (res.cycles > 0) {
      cycles += res.cycles;
      const config = PLANET_TYPES.find(planet => planet.id === deployment.planetType);
      emit("planetary:completed", {
        deploymentId:deployment.id,
        planetType:deployment.planetType,
        resourceId:"planetary:" + (config ? config.output : deployment.planetType),
        quantity:res.cycles,
        cycles:res.cycles,
        xp:res.cycles
      });
    }
    if (typeof ctx.collect === "function") collected += Number(ctx.collect(deployment, storageMax)) || 0;

    if (end < expiresAt) break;

    // 到达精确到期时刻：planauto 自动续期（三层门槛 + 储备金逐周期判断）
    const renew = (typeof tryPlanetAutoRenew === "function")
      ? tryPlanetAutoRenew(state, deployment, expiresAt, { offline:Boolean(ctx.offline) })
      : { renewed:false };
    if (renew && renew.renewed) {
      renewals += 1;
      renewedISK += Number(renew.maintenanceISK) || 0;
      cursor = expiresAt; // renew 已把 deployedAt/lastTick/progress 重置到 expiresAt
      continue;
    }
    deployment.active = false;
    expired = true;
    // 失败停产：事件 timestamp 必须等于本周期真实到期边界 expiresAt（与 payload.expiredAt 同源），
    // 不得使用结算/登录时刻 Date.now() 替换。
    emit("planetary:expired", {
      deploymentId:deployment.id,
      planetType:deployment.planetType,
      expiredAt:expiresAt
    }, { timestamp: expiresAt });
    break;
  }
  return { cycles, renewals, renewedISK, expired, collected };
}

function planetaryTick(tickNow) {
  const deployments = gameState.planetary && Array.isArray(gameState.planetary.deployments) ? gameState.planetary.deployments : [];
  if (!deployments.length) return false;
  const now = Number(tickNow) || Date.now();
  let changed = false;

  for (const deployment of deployments) {
    if (!deployment.active) continue; // 已到期：跳过，且不重复触发 expired
    const res = advancePlanetDeploymentTimeline(gameState, deployment, deployment.lastTick, now, {
      offline:false,
      emit:(type, payload, eventMeta) => GameEvents.emit(type, payload, { offline:false, ...(eventMeta && typeof eventMeta === "object" ? eventMeta : {}) }),
      // 行星管控中心 Lv.1+：自动收取（装满即收，移入库存并清零本地仓储，不自动续期）
      collect:(dep, storageMax) => (typeof applyStationAutoCollect === "function")
        ? applyStationAutoCollect(gameState, dep, storageMax, false) : 0
    });
    if (res.cycles > 0) gameState.skills.planetaryIndustry.xp += res.cycles;
    if (res.cycles > 0 || res.renewals > 0 || res.expired || res.collected > 0) changed = true;
  }
  if (changed) {
    gameState._dirty = true;
    checkLevelUp("planetaryIndustry");
  }
  return changed;
}
