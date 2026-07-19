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
  return PLANET_TYPES.find(planet => planet.type === type);
}

function planetaryTick(tickNow) {
  const deployments = gameState.planetary && Array.isArray(gameState.planetary.deployments) ? gameState.planetary.deployments : [];
  if (!deployments.length) return false;
  const now = Number(tickNow) || Date.now();
  const storageMax = getPlanetStorageMax();
  let changed = false;

  for (const deployment of deployments) {
    if (!deployment.active) continue;
    if ((now - deployment.deployedAt) / 1000 >= deployment.duration) {
      deployment.active = false;
      changed = true;
      continue;
    }
    if (deployment.storage >= storageMax) continue;
    const interval = getPlanetOutputInterval(deployment.type);
    const delta = Math.min(5, Math.max(0, (now - deployment.lastTick) / 1000));
    deployment.progress = (Number(deployment.progress) || 0) + delta;
    deployment.lastTick = now;
    let completedCycles = 0;
    while (deployment.progress >= interval) {
      if (deployment.storage >= storageMax) { deployment.progress = 0; break; }
      deployment.progress -= interval;
      deployment.storage++;
      gameState.skills.planetaryIndustry.xp++;
      completedCycles++;
      changed = true;
    }
    if (completedCycles > 0) {
      const config = PLANET_TYPES.find(planet => planet.type === deployment.type);
      GameEvents.emit("planetary:completed", {
        deploymentId:deployment.id,
        planetType:deployment.type,
        resourceId:"planetary:" + (config ? config.output : deployment.type),
        quantity:completedCycles,
        cycles:completedCycles,
        xp:completedCycles
      }, { offline:false });
    }
  }
  if (changed) {
    gameState._dirty = true;
    checkLevelUp("planetaryIndustry");
  }
  return changed;
}
