/* ================================================================
   新版本首次打开弹窗（What's New）
   —— 启动进入游戏（ready / local-only）后，若本地记录的
      “已读版本”低于 GAME_CHANGELOG 最新版本，则弹出更新说明。
   —— 复用 settings 页的 changelog 渲染口径与现有 .modal-* 样式，
      不依赖 shell-render.js，独立文件便于 cache-buster 与并行会话隔离。

   ⚠ 时序约束（2026-09-15 修）：
   `SaveManager._emitBootState()` 是**同步**派发 `bootstatechange`，本地存档
   路径的 Promise 链会在 `bootstrap-launch.js` 那个 defer 任务内跑完并派发
   终态事件。因此本文件在 index.html 中必须**排在 bootstrap-launch.js 之前**
   （已排到 persistence.js 之后、bootstrap-launch.js 之前）；
   同时下面保留「立即读状态 + 有限轮询」兜底，防止以后脚本顺序被改动后
   静默失去弹窗。

   调试：URL 追加 ?whatsnew=1 可强制弹出且不写入已读（便于人工验收）。
   ================================================================ */
(function () {
  "use strict";

  var SEEN_KEY = "eve_idle_changelog_popup_v";
  var READY_STATES = { "ready": 1, "local-only": 1 };
  var POLL_INTERVAL_MS = 500;
  var POLL_MAX_TRIES = 120; // ≈60s 兜底窗口；此后不再轮询（含 error 分支）

  var _handled = false;  // 已进入终态并入队展示
  var _pollTimer = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getLatest() {
    var log = (typeof window.GAME_CHANGELOG !== "undefined" && window.GAME_CHANGELOG) || [];
    return log.length ? log[0] : null;
  }

  // 启动状态由 persistence.js 的 SaveManager 持有（注意：全局名是 SaveManager，
  // 没有 GamePersistence 这个全局）。
  function readBootState() {
    try {
      var sm = window.SaveManager;
      if (sm && typeof sm.getBootState === "function") return sm.getBootState();
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function isReady(st) { return !!READY_STATES[st]; }

  function forceRequested() {
    try {
      return /[?&]whatsnew=1\b/.test((typeof location !== "undefined" && location.search) || "");
    } catch (e) { return false; }
  }

  function buildBody(latest) {
    var html = '<div class="changelog-head">本次更新内容 · V' +
      esc(latest.version) + "（" + esc(latest.date || "") + "）</div>";
    (latest.sections || []).forEach(function (sec) {
      html += '<div class="changelog-sec">';
      html += '<div class="changelog-sec-title">' + esc(sec.heading || "") + "</div>";
      html += '<ul class="changelog-list">';
      (sec.items || []).forEach(function (it) {
        html += "<li>" + esc(it) + "</li>";
      });
      html += "</ul></div>";
    });
    return html;
  }

  function close(version) {
    try {
      if (version) localStorage.setItem(SEEN_KEY, version);
    } catch (e) { /* localStorage 不可用时忽略，下次仍会弹 */ }
    var el = document.getElementById("changelog-popup");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show() {
    var latest = getLatest();
    if (!latest) return;
    if (document.getElementById("changelog-popup")) return;

    var force = forceRequested();
    if (!force) {
      var seen;
      try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { seen = null; }
      if (seen === latest.version) return;
    }

    var overlay = document.createElement("div");
    overlay.id = "changelog-popup";
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal-box" role="dialog" aria-modal="true">' +
        '<h3>更新说明 · V' + esc(latest.version) +
          '<button class="modal-close" id="changelog-popup-close" aria-label="关闭">×</button></h3>' +
        '<div class="changelog-popup-body">' + buildBody(latest) + "</div>" +
        '<div class="modal-actions"><button class="btn primary" id="changelog-popup-ok">知道了</button></div>' +
      "</div>";

    document.body.appendChild(overlay);

    // 调试强制展示时不写已读，避免污染真实玩家的“每版本一次”语义。
    function dismiss() { close(force ? "" : latest.version); }
    var ok = document.getElementById("changelog-popup-ok");
    var x = document.getElementById("changelog-popup-close");
    if (ok) ok.addEventListener("click", dismiss);
    if (x) x.addEventListener("click", dismiss);
    // 点击遮罩空白处关闭（避免误触内部内容）
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dismiss();
    });
  }

  function stopPoll() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // 进入终态后，延后一拍再渲染：让同一事件里 bootstrap-launch 收起 loading /
  // awaiting-cloud 浮层，避免更新说明叠在启动浮层下面。
  function queueShow() {
    if (_handled) return;
    _handled = true;
    stopPoll();
    setTimeout(function () {
      try { show(); } catch (e) { /* 弹窗失败不影响游戏 */ }
    }, 0);
  }

  function checkNow() {
    if (_handled) return;
    if (isReady(readBootState())) queueShow();
  }

  function startPoll() {
    if (_pollTimer || _handled) return;
    var n = 0;
    _pollTimer = setInterval(function () {
      n++;
      if (_handled) { stopPoll(); return; }
      if (isReady(readBootState())) { queueShow(); return; }
      if (n >= POLL_MAX_TRIES) stopPoll(); // error / 长期 awaiting 分支：放弃
    }, POLL_INTERVAL_MS);
  }

  function onBootState(e) {
    var st = e && e.detail && e.detail.state;
    // 仅在游戏真正进入（本地/云存档就绪）后弹；loading / awaiting-* / error 不弹。
    if (isReady(st)) queueShow();
  }

  function boot() {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("bootstatechange", onBootState);
    }
    // 兜底一：本脚本可能仍晚于第一次派发（历史 bug）⇒ 立刻查一次状态。
    checkNow();
    // 兜底二：若此刻还在 loading / awaiting-*，靠轮询等到终态。
    startPoll();
  }

  if (typeof document !== "undefined" && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
