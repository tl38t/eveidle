/* ================================================================
   动作队列执行引擎
   页面渲染与交互位于 js/ui/shell-render.js
   ================================================================ */

function getQueueSkillLabel(skill) {
  const labels = { mining:"⛏采矿", refining:"🔥冶炼", gasHarvesting:"☁️气体", shipEngineering:"🚀舰船", equipmentEngineering:"🔧装备工程", archaeology:"🔍考古", boosterEngineering:"💉增强剂" };
  return labels[skill] || skill;
}

function queueItemConfig(item) {
  return getQueueItemConfigForState(item);
}

function addToQueue(skill, target, label, count) {
  return dispatchGameAction(gameState, { type:"queue/add", item:{ skill, target, label, count } }, Date.now()).changed;
}

function removeFromQueue(index) {
  return dispatchGameAction(gameState, { type:"queue/remove", index }, Date.now()).changed;
}

function clearQueue() {
  return dispatchGameAction(gameState, { type:"queue/clear" }, Date.now()).changed;
}

function moveQueueItem(from, to) {
  return dispatchGameAction(gameState, { type:"queue/move", from, to }, Date.now()).changed;
}

function startQueue() {
  return dispatchGameAction(gameState, { type:"queue/start" }, Date.now()).changed;
}

function onActionProgressReset(listener) {
  return GameEvents.on("action:progressReset", event => listener(event.payload));
}

function resetActionProgress(skill, shipSubAction, now) {
  const actionSkill = skill || gameState.currentAction.skill;
  const subAction = shipSubAction || gameState.currentAction.shipSubAction;
  gameState.currentAction.progress = 0;
  gameState.currentAction.lastProgressUpdate = Number(now) || Date.now();
  GameEvents.emit("action:progressReset", { skill:actionSkill, shipSubAction:subAction });
}

function stopQueue() {
  const skill = gameState.currentAction.skill;
  const shipSubAction = gameState.currentAction.shipSubAction;
  const result = dispatchGameAction(gameState, { type:"queue/stop" }, Date.now());
  if (result.changed) GameEvents.emit("action:progressReset", { skill, shipSubAction });
  return result.changed;
}

function applyQueueItemConfig(config, now) {
  applyQueueConfigToState(gameState, config, Number(now) || Date.now());
}

function completeQueuedActionCycle() {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning || queue.status.activeIndex < 0 || queue.status.activeIndex >= queue.items.length) {
    if (gameState.currentAction.batchRemaining > 0) {
      gameState.currentAction.batchRemaining--;
      if (gameState.currentAction.batchRemaining === 0) {
        resetActionProgress(); gameState.currentAction.active = false; return true;
      }
    }
    return false;
  }
  const index = queue.status.activeIndex;
  const item = queue.items[index];
  if (item.count === -1) { gameState.currentAction.batchRemaining = -1; return false; }
  item.count = Math.max(0, (Number(item.count) || 1) - 1);
  gameState.currentAction.batchRemaining = item.count;
  gameState._dirty = true;
  if (item.count > 0) return false;
  queue.items.splice(index, 1);
  queue.status.completedCount++;
  queue.status.failCount = 0;
  if (queue.items.length === 0 || index >= queue.items.length) {
    queue.status.isRunning = false; queue.status.activeIndex = -1;
    resetActionProgress(); gameState.currentAction.active = false; gameState.currentAction.batchRemaining = 0;
    return true;
  }
  resetActionProgress(); executeQueueItem(index); return true;
}

function executeQueueItem(index) {
  const queue = gameState.queue;
  if (index < 0 || index >= queue.items.length) {
    if (queue.config.loopMode && queue.items.length > 0) {
      // 循环模式：受失败保护，防止无限同步递归
      if ((Number(queue.status.failCount) || 0) > queue.items.length * 10) {
        queue.status.isRunning = false; queue.status.activeIndex = -1;
        resetActionProgress(); gameState.currentAction.active = false; gameState.currentAction.batchRemaining = 0;
        return false;
      }
      queue.status.activeIndex = 0; queue.status.completedCount++; executeQueueItem(0);
    } else {
      queue.status.isRunning = false; queue.status.activeIndex = -1;
      resetActionProgress(); gameState.currentAction.active = false; gameState.currentAction.batchRemaining = 0;
    }
    return false;
  }
  queue.status.activeIndex = index;
  // 所有项目经统一入口执行
  if (typeof executeQueueItemForState === "function") {
    executeQueueItemForState(gameState, queue.items[index], Date.now());
  } else {
    applyQueueItemConfig(queueItemConfig(queue.items[index]));
  }
  gameState._dirty = true;
  return true;
}

function advanceQueue() {
  const queue = gameState.queue;
  if (!queue || !queue.status.isRunning) return false;
  const nextIndex = queue.status.activeIndex + 1;
  if (nextIndex >= queue.items.length) {
    if (queue.config.loopMode && queue.items.length > 0) { queue.status.completedCount++; executeQueueItem(0); return true; }
    queue.status.isRunning = false; queue.status.activeIndex = -1; return false;
  }
  executeQueueItem(nextIndex); return true;
}
