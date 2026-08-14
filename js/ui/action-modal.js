/* ================================================================
   执行确认弹窗
   业务计算由 getActionConfirmationDisplayState 负责，本文件只负责展示与派发。
   ================================================================ */

let _actionConfirmDisplay = null;

function hideActionConfirm() {
  document.getElementById("action-modal").classList.add("hidden");
  _actionConfirmDisplay = null;
}

function renderActionConfirmation(display) {
  if (!display || !display.canOpen) {
    showToast(display && display.blockedText ? display.blockedText : "当前行动不可用");
    return false;
  }

  const title = document.getElementById("action-modal-title");
  const infoEl = document.getElementById("action-modal-info");
  const resEl = document.getElementById("action-modal-resources");
  const summaryEl = document.getElementById("action-modal-summary");
  const input = document.getElementById("action-batch-count");
  const maxEl = document.getElementById("action-batch-max");
  // 尊重选择器显式给出的 0：非无限类行动（如舰船总装缺料）maxCount=0 即「不可确认」。
  const rawMax = Number(display.maxCount);
  const maxCount = rawMax > 0 ? rawMax : (display.unlimited ? 999999 : 0);
  const duration = Math.max(0, Number(display.duration) || 0);

  const unitEl = document.getElementById("action-batch-unit");
  if (unitEl) unitEl.textContent = display.combat ? (display.combatMode === "deathspace" ? "入场" : "波") : "次";
  title.textContent = display.title;
  infoEl.innerHTML = `<div class="ai-row"><span class="ai-label">单次耗时：</span><span class="ai-value">${display.combat ? "视战斗情况而定" : duration.toFixed(1) + "s"}</span></div>`;
  const requirementRows = display.requirements.map(item => {
    const className = item.enough ? "" : " ar-short";
    const matName = item.displayName || item.name;
    return `<div class="ar-row${className}">需求：${matName}×${item.quantity}（库存：${Number(item.stock || 0).toLocaleString()}）</div>`;
  });
  if (display.outputText) requirementRows.push(`<div class="ar-row" style="color:#e8d8a0;margin-top:4px;">产出：${display.outputText}</div>`);
  resEl.innerHTML = requirementRows.join("");

  _actionConfirmDisplay = display;
  input.value = 1;
  const infinityBtn = document.getElementById("action-batch-infinity");
  if (infinityBtn) infinityBtn.classList.remove("selected");
  input.max = maxCount;
  maxEl.textContent = display.unlimited ? "" : "最大：" + maxCount;
  // 缺料（maxCount=0）时禁用确认/加入队列/无限/输入框，并给出明确提示（与 startShipAssembly 材料校验同源）。
  const confirmBtn = document.getElementById("action-modal-confirm");
  const queueBtn = document.getElementById("action-modal-queue");
  if (maxCount <= 0) {
    if (confirmBtn) confirmBtn.disabled = true;
    if (queueBtn) queueBtn.disabled = true;
    if (infinityBtn) infinityBtn.disabled = true;
    if (input) input.disabled = true;
    maxEl.textContent = "材料/组件不足，无法合成";
  } else {
    if (confirmBtn) confirmBtn.disabled = false;
    if (queueBtn) queueBtn.disabled = false;
    if (infinityBtn) infinityBtn.disabled = false;
    if (input) input.disabled = false;
  }
  summaryEl.innerHTML = `<span class="ai-label">总耗时：</span>${display.combat ? "视战斗情况而定" : "约 " + formatDuration(duration)}`;
  input.oninput = function() {
    const value = Math.max(1, Math.min(maxCount, parseInt(this.value) || 1));
    this.value = value;
    document.getElementById("action-batch-infinity").classList.remove("selected");
    summaryEl.innerHTML = `<span class="ai-label">总耗时：</span>${display.combat ? "视战斗情况而定" : "约 " + formatDuration(duration * value)}`;
  };

  document.getElementById("action-modal").classList.remove("hidden");
  input.focus();
  input.select();
  return true;
}

function showActionConfirm(skillKey) {
  renderActionConfirmation(getActionConfirmationDisplayState(gameState, skillKey, Date.now()));
}

function showShipCompConfirm() {
  renderActionConfirmation(getActionConfirmationDisplayState(gameState, "shipComp", Date.now()));
}

function showShipAsmConfirm() {
  renderActionConfirmation(getActionConfirmationDisplayState(gameState, "shipAsm", Date.now()));
}

function formatDuration(seconds) {
  if (seconds < 60) return Math.ceil(seconds) + "s";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m" + Math.ceil(seconds % 60) + "s";
  return Math.floor(seconds / 3600) + "h" + Math.floor((seconds % 3600) / 60) + "m";
}

function submitActionConfirmation(front) {
  const display = _actionConfirmDisplay;
  // fail-closed：最内层重新校验，不依赖 disabled 按钮阻止业务动作。
  if (!display || !display.canOpen || !display.queue) return false;
  // 与 render 同源计算真实 maxCount（尊重显式 0）。
  const rawMax = Number(display.maxCount);
  const maxCount = rawMax > 0 ? rawMax : (display.unlimited ? 999999 : 0);
  // 非无限类行动且 maxCount<=0（材料/组件不足）：禁止派发、不隐藏、不 dispatch。
  if (!display.unlimited && maxCount <= 0) return false;
  const input = document.getElementById("action-batch-count");
  let count = parseInt((input && input.value) || "1");
  if (count === -1) {
    if (!display.unlimited) count = 1; // 无限被禁用时回退（双重保护，正常不会发生）
  } else {
    count = Math.max(1, count || 1);
    if (count > maxCount) count = maxCount; // 数量不得超过 maxCount
  }
  hideActionConfirm();
  const queueItem = {
    skill:display.queue.skill,
    target:display.queue.target,
    label:display.queue.label,
    count
  };
  const action = { type:"queue/add", item:queueItem };
  if (front) action.front = true;
  dispatchGameAction(gameState, action, Date.now());

  const countText = count === -1 ? "（无限）" : " ×" + count;
  const positionText = front ? "队列首位" : "队列";
  showToast(`已加入${positionText}${countText}：${getQueueSkillLabel(queueItem.skill)} · ${queueItem.label}`);
  if (front) startQueue();
  return true;
}

function confirmAction() {
  return submitActionConfirmation(true);
}

function queueActionConfirmation() {
  return submitActionConfirmation(false);
}

(function bindActionModal() {
  document.getElementById("action-modal-close").addEventListener("click", hideActionConfirm);
  document.getElementById("action-modal-cancel").addEventListener("click", hideActionConfirm);
  document.getElementById("action-modal-confirm").addEventListener("click", confirmAction);
  document.getElementById("action-modal").addEventListener("click", event => { if (event.target.id === "action-modal") hideActionConfirm(); });
  document.getElementById("action-batch-count").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const confirmBtn = document.getElementById("action-modal-confirm");
      // fail-closed：确认按钮被禁用（缺料等）时，Enter 不得绕过校验直接派发。
      if (confirmBtn && confirmBtn.disabled) return;
      confirmAction();
    }
  });
  document.getElementById("action-batch-infinity").addEventListener("click", () => {
    const input = document.getElementById("action-batch-count");
    input.value = "-1";
    // 仅选中无限，不自动提交；刷新摘要并显示选中态，与填入其他数字体验一致
    const summaryEl = document.getElementById("action-modal-summary");
    if (summaryEl) summaryEl.innerHTML = '<span class="ai-label">总耗时：</span>∞ 无限';
    document.getElementById("action-batch-infinity").classList.add("selected");
  });
})();
