// ---- 新手教程：脉冲聚光（spotlight）----
// 解决玩家反馈「界面元素太多时缺显眼标识」：当前激活任务在其目标页上，用一个脉冲金环
// 高亮「玩家下一步要点的那个控件」。只做脉冲聚光（不做横幅、不做文字标签）。
//
// 设计约束（与实装前给用户确认的截图一致）：
//   1. 只画脉冲环，不加文字标签 —— 保持界面干净，任务文字由右上角教程部件承载。
//   2. 环 pointer-events:none —— 只做视觉引导，绝不拦玩家点击。
//   3. 只在目标控件「存在且可见」时显示。目标控件随其页面渲染/隐藏，天然实现「只在目标页出现」。
//   4. 目标控件尚未出现、或被全屏弹窗遮住时自动隐藏（宁可不指，也不指错）。
//   5. 选择器来源唯一：js/data/tutorial.js 的 task.spotlight。本文件不硬编码任务→控件映射。
//
// 运行机制：两条轻量定时器 —— 每 1.2s 重算「当前任务的聚光选择器」（走既有显示态构建），
// 每 0.35s 仅把环重定位到控件矩形（getBoundingClientRect + 改 style，不重建任何面板、不碰输入）。
(function () {
  "use strict";

  var RING_ID = "tutorial-spotlight-ring";
  var STYLE_ID = "tutorial-spotlight-style";
  var REFRESH_SEL_MS = 1200;   // 重算「当前任务选择器」间隔
  var REPOSITION_MS = 350;     // 环跟随控件重定位间隔（廉价）
  var ring = null;
  var cachedSel = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      "@keyframes tspot-pulse{" +
      "0%{box-shadow:0 0 0 0 rgba(255,196,60,.85),0 0 16px 3px rgba(255,170,0,.5)}" +
      "70%{box-shadow:0 0 0 12px rgba(255,196,60,0),0 0 22px 6px rgba(255,170,0,0)}" +
      "100%{box-shadow:0 0 0 0 rgba(255,196,60,0)}}" +
      "#" + RING_ID + "{position:fixed;z-index:7999;pointer-events:none;display:none;" +
      "border:3px solid #ffc43c;border-radius:10px;" +
      "box-shadow:0 0 16px 3px rgba(255,170,0,.5);animation:tspot-pulse 1.5s ease-out infinite;}";
    (document.head || document.documentElement).appendChild(st);
  }

  function ensureRing() {
    if (ring && ring.isConnected) return ring;
    ring = document.createElement("div");
    ring.id = RING_ID;
    ring.setAttribute("aria-hidden", "true");
    document.body.appendChild(ring);
    return ring;
  }

  function hide() { if (ring) ring.style.display = "none"; }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (!(r.width > 1 && r.height > 1)) return false;
    var s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  }

  // 全屏遮罩打开时隐藏，避免环浮在弹窗之上。
  function blockedByModal() {
    var ov = document.querySelector(".modal-overlay");
    if (isVisible(ov)) return true;
    var rm = document.getElementById("reward-result-modal");
    if (rm && getComputedStyle(rm).display !== "none") return true;
    return false;
  }

  function computeSelector() {
    try {
      var ts = (typeof window !== "undefined" && window.TutorialSystem) ||
               (typeof globalThis !== "undefined" && globalThis.TutorialSystem);
      var st = (typeof window !== "undefined" && window.gameState) ||
               (typeof globalThis !== "undefined" && globalThis.gameState);
      if (!ts || !st || typeof ts.getTutorialDisplayState !== "function") return null;
      var disp = ts.getTutorialDisplayState(st);
      return (disp && typeof disp.currentSpotlight === "string" && disp.currentSpotlight) ? disp.currentSpotlight : null;
    } catch (e) { return null; }
  }

  function reposition() {
    if (!cachedSel || blockedByModal()) { hide(); return; }
    var el = null;
    try { el = document.querySelector(cachedSel); } catch (e) { el = null; }
    if (!isVisible(el)) { hide(); return; }
    var r = el.getBoundingClientRect();
    var ring2 = ensureRing();
    ring2.style.display = "block";
    ring2.style.left = (r.left - 5) + "px";
    ring2.style.top = (r.top - 5) + "px";
    ring2.style.width = (r.width + 10) + "px";
    ring2.style.height = (r.height + 10) + "px";
  }

  function boot() {
    ensureStyle();
    cachedSel = computeSelector();
    reposition();
    setInterval(function () { cachedSel = computeSelector(); }, REFRESH_SEL_MS);
    setInterval(reposition, REPOSITION_MS);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
  }

  function waitReady(cb) {
    (function poll() {
      var hasTs = (typeof window !== "undefined" && window.TutorialSystem) ||
                  (typeof globalThis !== "undefined" && globalThis.TutorialSystem);
      var hasSt = (typeof window !== "undefined" && window.gameState) ||
                  (typeof globalThis !== "undefined" && globalThis.gameState);
      if (typeof document !== "undefined" && document.body && hasTs && hasSt) { cb(); return; }
      setTimeout(poll, 300);
    })();
  }

  if (typeof document !== "undefined") waitReady(boot);
})();
