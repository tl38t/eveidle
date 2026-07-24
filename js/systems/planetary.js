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

function getPlanetStorageMax() {
  return getPlanetaryCapacityState(gameState).storageMax;
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

function planetaryTick(tickNow) {
  const deployments = gameState.planetary && Array.isArray(gameState.planetary.deployments) ? gameState.planetary.deployments : [];
  if (!deployments.length) return false;
  const now = Number(tickNow) || Date.now();
  const storageMax = getPlanetStorageMax();
  let changed = false;

  for (const deployment of deployments) {
    if (!deployment.active) continue; // 已到期：跳过，且不重复触发 expired
    const interval = getPlanetOutputInterval(deployment.planetType);
    const deployedAt = Number(deployment.deployedAt) || 0;
    const durationMs = (Number(deployment.duration) > 0 ? Number(deployment.duration) : 86400) * 1000;
    const expiresAt = deployedAt + durationMs;

    // 1) 先结算 lastTick 到 min(now, expiresAt) 的最后一段（修复：不再提前 continue 丢失到期前收益）
    const res = computePlanetarySettlement({
      fromTime: deployment.lastTick,
      toTime: now,
      progress: deployment.progress,
      storage: deployment.storage,
      interval,
      storageMax,
      deployedAt,
      durationMs
    });
    deployment.progress = res.progress;
    deployment.storage = res.storage;
    deployment.lastTick = res.endSettled; // 不越过 expiresAt，避免下次 tick 重复收益
    if (res.cycles > 0) {
      const config = PLANET_TYPES.find(planet => planet.id === deployment.planetType);
      gameState.skills.planetaryIndustry.xp += res.cycles;
      changed = true;
      GameEvents.emit("planetary:completed", {
        deploymentId:deployment.id,
        planetType:deployment.planetType,
        resourceId:"planetary:" + (config ? config.output : deployment.planetType),
        quantity:res.cycles,
        cycles:res.cycles,
        xp:res.cycles
      }, { offline:false });
    }

    // 2) 结算后再判定到期：仅当 now 真正越过 expiresAt 才置 false 并触发一次 expired
    if (now >= expiresAt) {
      deployment.active = false;
      changed = true;
      GameEvents.emit("planetary:expired", {
        deploymentId:deployment.id,
        planetType:deployment.planetType,
        expiredAt:expiresAt
      });
    }
  }
  if (changed) {
    gameState._dirty = true;
    checkLevelUp("planetaryIndustry");
  }
  return changed;
}
