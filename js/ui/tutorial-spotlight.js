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
  var cachedSel = [];
  var cachedAux = [];
  var auxedEls = [];   // 已挂 .tutorial-spotlight-aux 的元素（差量维护，防 classList 反复增删重启动画）

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
      "box-shadow:0 0 16px 3px rgba(255,170,0,.5);animation:tspot-pulse 1.5s ease-out infinite;}" +
      // 辅助高亮（spotlightAux）：主环之外的次级导航控件金光（如 I7 主环打船卡时工业系线标签）。
      // 用 box-shadow 呼吸而非改 border —— 线标签选中态自带 cyan 边框，不能覆盖。
      "@keyframes tspot-aux-pulse{" +
      "0%{box-shadow:0 0 0 0 rgba(255,196,60,.6),0 0 12px 2px rgba(255,170,0,.4)}" +
      "70%{box-shadow:0 0 0 9px rgba(255,196,60,0),0 0 18px 5px rgba(255,170,0,0)}" +
      "100%{box-shadow:0 0 0 0 rgba(255,196,60,0)}}" +
      ".tutorial-spotlight-aux{animation:tspot-aux-pulse 1.5s ease-out infinite;" +
      "outline:2px solid #ffc43c;outline-offset:2px;border-radius:8px;}";
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

  // 可打环 = 可见 **且可点**。排除 disabled 与 .unavailable/.locked：
  // 锁定控件（如无采矿激光的启程级点「采矿」）虽然可见但点不动，环指过去是纯误导。
  // @param allowLocked 多候选回退时是否接受锁定控件（默认不接受）。
  function isRingable(el, allowLocked) {
    if (!isVisible(el)) return false;
    if (allowLocked) return true;
    try {
      if (el.disabled) return false;
      if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return false;
      var cls = String(el.className || "");
      if (/(^|\s)(unavailable|locked)(\s|$)/.test(cls)) return false;
    } catch (e) { /* 属性访问失败则按可点处理 */ }
    return true;
  }

  // 全屏遮罩打开时隐藏，避免环浮在弹窗之上。
  function blockedByModal() {
    var ov = document.querySelector(".modal-overlay");
    if (isVisible(ov)) return true;
    var rm = document.getElementById("reward-result-modal");
    if (rm && getComputedStyle(rm).display !== "none") return true;
    return false;
  }

  // 把 task.spotlight 规整成「选择器数组」：字符串 → [字符串]；数组 → 过滤非空字符串。
  function normalizeSelectors(v) {
    if (typeof v === "string" && v) return [v];
    if (Array.isArray(v)) return v.filter(function (s) { return typeof s === "string" && s; });
    return [];
  }
  // task.spotlight 允许是**函数**（动态目标）：收到该任务的显示态条目 + 逐项进度，
  // 返回当前该打环的选择器（字符串/数组/空）。
  // 用于「同一页有多个同类控件、且要挨个做完」的任务（如 I6 组件量产：三种组件各造 2 件）——
  // 静态选择器会死钉第一个控件，造完也不跳，玩家会以为功能坏了。
  // 函数返回空串/空数组 ⇒ 视为「无需指引」⇒ 环隐藏。
  function resolveSpec(spec, taskEntry) {
    if (typeof spec === "function") {
      try {
        var prog = (taskEntry && taskEntry.progress) || {};
        return normalizeSelectors(spec(taskEntry, prog));
      } catch (e) { return []; }
    }
    return normalizeSelectors(spec);
  }
  // 聚光必须跟「教程卡正在展示的任务」，而不是全局第一个 active 任务：
  // P7 后 I/A/C 三条支线同时 active（activateNext），而教程卡按所选支线显示当前任务
  // （shell-render.js _tutorialWidgetBranch → chapterById[branch].currentTaskId）。
  // 若聚光只跟全局 currentTaskId，玩家切到考古页签看 A2 时，环仍指 I 线任务 ⇒ 「看得见任务、等不到环」。
  // _tutorialWidgetBranch 是 shell-render.js 顶层的 let（全局词法绑定，经典脚本间可见），此处只读不写。
  // 返回 {sel: 主环选择器数组, aux: 辅助金光选择器数组}（均来自同一任务条目）。
  function computeSelectors() {
    var empty = { sel: [], aux: [] };
    try {
      var ts = (typeof window !== "undefined" && window.TutorialSystem) ||
               (typeof globalThis !== "undefined" && globalThis.TutorialSystem);
      var st = (typeof window !== "undefined" && window.gameState) ||
               (typeof globalThis !== "undefined" && globalThis.gameState);
      if (!ts || !st || typeof ts.getTutorialDisplayState !== "function") return empty;
      var disp = ts.getTutorialDisplayState(st);
      if (!disp) return empty;
      var branch = null;
      try { branch = (typeof _tutorialWidgetBranch !== "undefined") ? _tutorialWidgetBranch : null; }
      catch (e) { branch = null; }
      var t = null;
      if (branch && disp.chapterById && disp.chapterById[branch]) {
        var ctid = disp.chapterById[branch].currentTaskId;
        t = (ctid && disp.taskById) ? disp.taskById[ctid] : null;
      } else {
        t = (disp && disp.currentTaskId && disp.taskById) ? disp.taskById[disp.currentTaskId] : null;
      }
      // 所选章节当前任务带聚光 ⇒ 用它；无聚光（领取/等待型）或章节已清 ⇒ 环隐藏，不回退指别的支线。
      if (!t) return empty;
      return {
        sel: t.spotlight ? resolveSpec(t.spotlight, t) : [],
        aux: t.spotlightAux ? resolveSpec(t.spotlightAux, t) : []
      };
    } catch (e) { return empty; }
  }

  // 辅助金光差量维护：只对「集合变化」的元素增删 class —— 每帧盲删盲加会让 CSS 动画
  // 每 350ms 重启一次，呼吸效果变成频闪。控件被 innerHTML 重渲染替换后（新节点无 class）
  // 会经差量比对自动补挂。
  function applyAux() {
    var want = [];
    if (cachedAux.length && !blockedByModal()) {
      for (var i = 0; i < cachedAux.length; i++) {
        var els = null;
        try { els = document.querySelectorAll(cachedAux[i]); } catch (e) { continue; }
        for (var j = 0; j < els.length; j++) {
          if (isVisible(els[j]) && want.indexOf(els[j]) === -1) want.push(els[j]);
        }
      }
    }
    for (var k = auxedEls.length - 1; k >= 0; k--) {
      if (want.indexOf(auxedEls[k]) === -1) {
        try { auxedEls[k].classList.remove("tutorial-spotlight-aux"); } catch (e) { /* 节点已脱离 */ }
        auxedEls.splice(k, 1);
      }
    }
    for (var m = 0; m < want.length; m++) {
      if (auxedEls.indexOf(want[m]) === -1) {
        want[m].classList.add("tutorial-spotlight-aux");
        auxedEls.push(want[m]);
      }
    }
  }

  function reposition() {
    applyAux();
    if (!cachedSel.length || blockedByModal()) { hide(); return; }
    // 多候选：按数组顺序取第一个「当前可见且可点」的控件打环（先匹配先得）。
    // 单候选（长度 1）时允许锁定态兜底？—— 不允许：任务就是要玩家点它，锁定即视为不可打，
    // 等它解锁后环自然出现。多候选（长度>1）时同样只取可点的第一个，保证环指向有效操作。
    var el = null;
    for (var i = 0; i < cachedSel.length; i++) {
      var cand = null;
      try { cand = document.querySelector(cachedSel[i]); } catch (e) { cand = null; }
      if (isRingable(cand, false)) { el = cand; break; }
    }
    if (!el) { hide(); return; }
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
    var r = computeSelectors();
    cachedSel = r.sel; cachedAux = r.aux;
    reposition();
    setInterval(function () {
      var r2 = computeSelectors();
      cachedSel = r2.sel; cachedAux = r2.aux;
    }, REFRESH_SEL_MS);
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
