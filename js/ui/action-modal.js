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
  const maxCount = Math.max(1, Number(display.maxCount) || 1);
  const duration = Math.max(0, Number(display.duration) || 0);

  title.textContent = display.title;
  infoEl.innerHTML = `<div class="ai-row"><span class="ai-label">单次耗时：</span><span class="ai-value">${duration.toFixed(1)}s</span></div>`;
  const requirementRows = display.requirements.map(item => {
    const className = item.enough ? "" : " ar-short";
    return `<div class="ar-row${className}">需求：${item.name}×${item.quantity}（库存：${Number(item.stock || 0).toLocaleString()}）</div>`;
  });
  if (display.outputText) requirementRows.push(`<div class="ar-row" style="color:#e8d8a0;margin-top:4px;">产出：${display.outputText}</div>`);
  resEl.innerHTML = requirementRows.join("");

  _actionConfirmDisplay = display;
  input.value = 1;
  input.max = maxCount;
  maxEl.textContent = display.unlimited ? "" : "最大：" + maxCount;
  summaryEl.innerHTML = `<span class="ai-label">总耗时：</span>约 ${formatDuration(duration)}`;
  input.oninput = function() {
    const value = Math.max(1, Math.min(maxCount, parseInt(this.value) || 1));
    this.value = value;
    summaryEl.innerHTML = `<span class="ai-label">总耗时：</span>约 ${formatDuration(duration * value)}`;
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
  let count = parseInt(document.getElementById("action-batch-count").value);
  if (count !== -1) count = Math.max(1, count || 1);
  const display = _actionConfirmDisplay;
  hideActionConfirm();
  if (!display || !display.queue) return false;

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
  if (currentPage !== "queue") switchPage("queue");
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
  document.getElementById("action-batch-count").addEventListener("keydown", event => { if (event.key === "Enter") confirmAction(); });
  document.getElementById("action-batch-infinity").addEventListener("click", () => {
    document.getElementById("action-batch-count").value = "-1";
    confirmAction();
  });
})();
