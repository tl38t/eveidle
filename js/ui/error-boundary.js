/* ================================================================
   运行错误面板 — RuntimeGuard 的原生 DOM 适配器
   ================================================================ */

(function bindRuntimeErrorBoundary() {
  let latestRecord = null;

  function ensurePanel() {
    let panel = document.getElementById("runtime-error-boundary");
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.id = "runtime-error-boundary";
    panel.className = "runtime-error-boundary hidden";
    panel.innerHTML = `
      <div class="reb-header"><span>⚠ 运行异常</span><button type="button" id="runtime-error-dismiss" aria-label="收起错误提示">×</button></div>
      <div class="reb-message" id="runtime-error-message"></div>
      <div class="reb-meta" id="runtime-error-meta"></div>
      <details><summary>错误详情</summary><pre id="runtime-error-stack"></pre></details>
      <div class="reb-actions">
        <button type="button" id="runtime-error-resume">尝试恢复主循环</button>
        <button type="button" id="runtime-error-reload">重新加载页面</button>
      </div>`;
    document.body.appendChild(panel);
    document.getElementById("runtime-error-dismiss").addEventListener("click", () => panel.classList.add("hidden"));
    document.getElementById("runtime-error-resume").addEventListener("click", () => {
      RuntimeGuard.resume("gameTick");
      panel.classList.add("hidden");
    });
    document.getElementById("runtime-error-reload").addEventListener("click", () => window.location.reload());
    return panel;
  }

  function renderRecord(record) {
    latestRecord = record || latestRecord;
    if (!latestRecord) return;
    const panel = ensurePanel();
    panel.classList.remove("hidden");
    document.getElementById("runtime-error-message").textContent = latestRecord.message;
    document.getElementById("runtime-error-meta").textContent =
      "来源：" + latestRecord.source + (latestRecord.count > 1 ? " · 重复 " + latestRecord.count + " 次" : "") +
      (latestRecord.fatal ? " · 相关循环已暂停，存档不会继续进行半结算" : "");
    document.getElementById("runtime-error-stack").textContent = latestRecord.stack || "没有可用的调用栈";
    document.getElementById("runtime-error-resume").style.display = RuntimeGuard.isPaused("gameTick") ? "" : "none";
  }

  RuntimeGuard.onEvent(event => {
    if (event.type === "error" || event.type === "error-updated") renderRecord(event.record);
  });

  window.addEventListener("load", () => {
    RuntimeGuard.verifyBoot([
      { name:"gameState", test:() => typeof gameState === "object" },
      { name:"selectors", test:() => typeof getMiningDisplayState === "function" && typeof getCombatDisplayState === "function" },
      { name:"actions", test:() => typeof dispatchGameAction === "function" },
      { name:"gameTick", test:() => typeof gameTick === "function" },
      { name:"updateUI", test:() => typeof updateUI === "function" }
    ]);
  });
})();

