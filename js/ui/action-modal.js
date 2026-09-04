/* ================================================================
   执行确认弹窗
   业务计算由 getActionConfirmationDisplayState 负责，本文件只负责展示与派发。
   ================================================================ */

let _actionConfirmDisplay = null;

function hideActionConfirm() {
  document.getElementById("action-modal").classList.add("hidden");
  _actionConfirmDisplay = null;
}

function renderActionConfirmation(display, opts) {
  opts = opts || {};
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
  const rawMax = Number(display.maxCount);
  const maxCount = rawMax > 0 ? rawMax : (display.unlimited ? 999999 : 0);
  const noCap = !!display.noCap; // 超量预排：数量可超过当前材料，运行期 skipOnFail 在不足时切下一项
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

  // 战斗补给预检提示（非阻断）：在确认/加入队列按钮上方显示弹药/燃料不足警告。
  const warnEl = document.getElementById("action-modal-warn");
  if (warnEl) {
    const sw = display.supplyWarn;
    const wl = [];
    if (sw) {
      if (sw.ammo === "none") wl.push('<div class="aw-row aw-none">⚠ 未装备弹药，战斗将无法开火</div>');
      else if (sw.ammo === "wrong") wl.push('<div class="aw-row aw-none">⚠ 弹药类型错误，已装填弹药与当前武器不匹配</div>');
      else if (sw.ammo === "low") wl.push('<div class="aw-row aw-low">⚠ 已装填弹药仅够约 ' + sw.ammoVolleys + ' 次齐射（≤100）</div>');
      if (sw.fuel === "none") wl.push('<div class="aw-row aw-none">⚠ 燃料库存为 0，武器无法开火</div>');
      else if (sw.fuel === "low") wl.push('<div class="aw-row aw-low">⚠ 燃料仅够约 ' + sw.fuelRounds + ' 轮满负荷行动（≤100）</div>');
    }
    warnEl.innerHTML = wl.join("");
  }

  _actionConfirmDisplay = display;
  if (!opts.preserveCount) input.value = 1;
  const infinityBtn = document.getElementById("action-batch-infinity");
  if (infinityBtn && !opts.preserveCount) infinityBtn.classList.remove("selected");
  input.max = noCap ? 99999999 : maxCount;
  if (noCap) {
    maxEl.textContent = "当前材料可产 " + (Number(display.materialHint) || 0) + " 批（可超量预排）";
  } else {
    maxEl.textContent = display.unlimited ? "" : "最大：" + maxCount;
  }
  // 缺料（maxCount=0 且非超量预排）时禁用确认/加入队列/无限/输入框（与 startShipAssembly 材料校验同源）。
  const confirmBtn = document.getElementById("action-modal-confirm");
  const queueBtn = document.getElementById("action-modal-queue");
  if (maxCount <= 0 && !noCap) {
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
    let value = Math.max(1, parseInt(this.value) || 1);
    if (!noCap) value = Math.min(maxCount, value);
    this.value = value;
    document.getElementById("action-batch-infinity").classList.remove("selected");
    summaryEl.innerHTML = `<span class="ai-label">总耗时：</span>${display.combat ? "视战斗情况而定" : "约 " + formatDuration(duration * value)}`;
  };

  document.getElementById("action-modal").classList.remove("hidden");
  if (!opts.preserveFocus) { input.focus(); input.select(); }
  return true;
}

// 已打开的确认弹窗在状态变化（装/卸增强剂、船坞升级完成等）后重新计算并重绘，
// 避免弹窗内消耗/耗时停留在打开瞬间的旧值（船坞减耗、增强剂减料均不生效的假象）。
// 保留用户已输入的数量，且不抢焦点（由 updateUI 在事件驱动下调用，不每帧触发）。
function refreshActionConfirmation() {
  const modal = document.getElementById("action-modal");
  if (!modal || modal.classList.contains("hidden") || !_actionConfirmDisplay) return;
  const target = _actionConfirmDisplay.target;
  const input = document.getElementById("action-batch-count");
  const infinityBtn = document.getElementById("action-batch-infinity");
  const oldCount = input ? input.value : "1";
  const wasInfinity = (oldCount === "-1");
  const fresh = getActionConfirmationDisplayState(gameState, target, Date.now());
  // 资源耗尽等导致不可用时不再弹 toast（避免每次事件刷新都提示），保留弹窗原内容。
  if (!fresh.canOpen) return;
  renderActionConfirmation(fresh, { preserveCount:true, preserveFocus:true });
  if (input && oldCount != null) {
    if (wasInfinity && fresh.unlimited) {
      // 保持无限状态，避免每次 updateUI 刷新都把 -1 重置回 1。
      input.value = "-1";
      if (infinityBtn) infinityBtn.classList.add("selected");
      const sumEl = document.getElementById("action-modal-summary");
      if (sumEl) sumEl.innerHTML = '<span class="ai-label">总耗时：</span>∞ 无限';
    } else {
      const noCap = !!fresh.noCap;
      let v = Math.max(1, parseInt(oldCount) || 1);
      const mc = Number(fresh.maxCount);
      if (!noCap && mc > 0) v = Math.min(mc, v);
      input.value = v;
      const sumEl = document.getElementById("action-modal-summary");
      if (sumEl) sumEl.innerHTML = `<span class="ai-label">总耗时：</span>${fresh.combat ? "视战斗情况而定" : "约 " + formatDuration(fresh.duration * v)}`;
    }
  }
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
  const noCap = !!display.noCap; // 超量预排：材料不足也允许派发，由运行期 skipOnFail 切下一项
  // 非无限类且非超量预排且 maxCount<=0（材料/组件不足）：禁止派发、不隐藏、不 dispatch。
  if (!display.unlimited && !noCap && maxCount <= 0) return false;
  const input = document.getElementById("action-batch-count");
  let count = parseInt((input && input.value) || "1");
  if (count === -1) {
    if (!display.unlimited) count = 1; // 无限被禁用时回退（双重保护，正常不会发生）
  } else {
    count = Math.max(1, count || 1);
    if (!noCap && count > maxCount) count = maxCount; // 非超量预排时数量不得超过 maxCount
  }
  hideActionConfirm();
  const queueItem = {
    skill:display.queue.skill,
    target:display.queue.target,
    label:display.queue.label,
    subAction:display.queue.subAction,
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
