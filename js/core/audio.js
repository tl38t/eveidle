/* ================================================================
   背景音乐（BGM）管理器

   职责：单一 <audio loop> 实例 + 设置页音量 / 静音的读写与持久化。
   ----------------------------------------------------------------
   设计约束（与项目既有模式对齐）：
   1. 加载期零副作用：只挂 bootstatechange 监听，不碰 DOM、不碰 gameState；
      init 由启动链（persistence.js 派发的 bootstatechange → ready/local-only）触发，
      另留 8s 兜底定时器，防止极端分支漏发事件时静默无音乐。
   2. 自动播放策略：浏览器 / H5 容器普遍拦截无手势播放 ⇒ play() 被拒时
      挂首个用户手势（pointerdown / keydown / touchstart，capture）补播，
      播成功后立即摘除；Electron（Steam）一般直接放行。
   3. 沙箱降级：无 Audio 宿主（tools/verify.mjs 的 vm 沙箱、Worker）时
      本模块退化为纯状态记录，任何步骤绝不抛错（全函数 try/catch 包裹）。
   4. 状态持久化：bgmVolume（0-100 整数）/ bgmMuted（bool）写
      gameState.settings，并置 _dirty —— 与 actions.js ShellStateActions
      的既有语义逐字一致（ensureUserSettingsState + state._dirty = true），
      存档序列化走 persistence.js 全量 JSON，无需额外接线。
      ⚠️ 此处不经 dispatchGameAction：本轮受 ≤4 文件 scope 约束，
      故意不扩 actions.js / selectors.js / state.js；写入口径与既有
      ShellStateActions 完全同构，后续若要收编到 action 总线只需平移。
   5. 轨道路径为左引号邻接字面量：tools/build-taptap-h5.mjs 的
      「媒体目录可达性对账」按此形态收集引用，漏引会被闸门拦下。
   ================================================================ */
(function () {
  "use strict";

  var TRACK_PATH = "./images/audio/deep_space_voyage_gameloop_v7.m4a";
  var DEFAULT_VOLUME = 60; // 提议值：首次启动默认 60%（待标定，玩家可在设置页 0-100 调整）
  var VOLUME_KEY = "bgmVolume";
  var MUTED_KEY = "bgmMuted";
  var FALLBACK_INIT_MS = 8000;

  var element = null;       // HTMLAudioElement | null（无宿主时为 null）
  var initialized = false;  // init 幂等闸门
  var gestureBound = false; // 手势补播监听挂载闸门
  var gestureHandlers = null;
  var lastError = null;

  function clampVolume(value) {
    var n = Number(value);
    if (typeof value === "boolean" || value === null || value === undefined || !isFinite(n)) return DEFAULT_VOLUME;
    n = Math.round(n);
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  // gameState 是 state.js 的顶层 const 全局（同时挂在 window.gameState）；
  // 两种取法都试，typeof 守卫保证未加载时不抛 ReferenceError。
  function currentState() {
    try {
      if (typeof gameState !== "undefined" && gameState && typeof gameState === "object") return gameState;
    } catch (_) { /* 继续试 window */ }
    try {
      if (typeof window !== "undefined" && window && window.gameState && typeof window.gameState === "object") return window.gameState;
    } catch (_) { /* 无宿主 */ }
    return null;
  }

  function settingsBag() {
    var state = currentState();
    if (!state) return null;
    if (!state.settings || typeof state.settings !== "object") state.settings = {};
    return state.settings;
  }

  function markDirty() {
    var state = currentState();
    if (state) {
      try { state._dirty = true; } catch (_) { /* 只读对象不致命 */ }
    }
  }

  function getSettings() {
    var bag = settingsBag();
    var volume = DEFAULT_VOLUME;
    var muted = false;
    if (bag) {
      if (bag[VOLUME_KEY] !== undefined) volume = clampVolume(bag[VOLUME_KEY]);
      muted = Boolean(bag[MUTED_KEY]);
    }
    return { volume: volume, muted: muted };
  }

  function applyToElement() {
    if (!element) return;
    try {
      var s = getSettings();
      element.muted = s.muted;
      element.volume = s.volume / 100;
    } catch (_) { /* 极端宿主：静默跳过 */ }
  }

  function unbindGestureUnlock() {
    if (!gestureBound || typeof window === "undefined" || !window.removeEventListener || !gestureHandlers) return;
    try {
      window.removeEventListener("pointerdown", gestureHandlers, true);
      window.removeEventListener("keydown", gestureHandlers, true);
      window.removeEventListener("touchstart", gestureHandlers, true);
    } catch (_) { /* ignore */ }
    gestureBound = false;
    gestureHandlers = null;
  }

  function tryPlay() {
    if (!element) return;
    try {
      var result = element.play();
      if (result && typeof result.then === "function") {
        result.then(function () { unbindGestureUnlock(); }, function (err) {
          // 自动播放被拦截（NotAllowedError 等）：挂首个用户手势补播
          lastError = err && err.name ? err.name : String(err || "play-rejected");
          bindGestureUnlock();
        });
      } else {
        unbindGestureUnlock();
      }
    } catch (err) {
      lastError = err && err.name ? err.name : String(err || "play-threw");
      bindGestureUnlock();
    }
  }

  function bindGestureUnlock() {
    if (gestureBound || !element || typeof window === "undefined" || !window.addEventListener) return;
    gestureBound = true;
    var onGesture = function () {
      if (!element) { unbindGestureUnlock(); return; }
      tryPlay();
    };
    gestureHandlers = onGesture;
    try {
      window.addEventListener("pointerdown", onGesture, true);
      window.addEventListener("keydown", onGesture, true);
      window.addEventListener("touchstart", onGesture, true);
    } catch (_) { gestureBound = false; gestureHandlers = null; }
  }

  function init() {
    if (initialized) return { ok: true, already: true };
    initialized = true;
    if (typeof Audio === "undefined" || !Audio) {
      // 无音频宿主（沙箱 / Worker）：仅保留状态记录能力
      return { ok: false, reason: "no-audio-host" };
    }
    try {
      element = new Audio();
      element.loop = true;
      element.preload = "auto";
      element.src = TRACK_PATH;
      applyToElement();
      tryPlay();
      return { ok: true };
    } catch (err) {
      lastError = err && err.message ? err.message : String(err || "init-failed");
      element = null;
      return { ok: false, reason: lastError };
    }
  }

  function onBootState(event) {
    var state = event && event.detail ? event.detail.state : null;
    if (state === "ready" || state === "local-only") init();
  }

  // ---- 对外 API ----
  var api = {
    // 读当前设置（未写入过时回落默认值；显式 0 / true 原样保留）
    getSettings: function () { return getSettings(); },

    // 设音量（0-100，越界钳制）；返回生效值供 UI 回填
    setVolume: function (value) {
      var v = clampVolume(value);
      var bag = settingsBag();
      if (bag) bag[VOLUME_KEY] = v;
      markDirty();
      applyToElement();
      return v;
    },

    // 设静音；返回生效值
    setMuted: function (muted) {
      var m = Boolean(muted);
      var bag = settingsBag();
      if (bag) bag[MUTED_KEY] = m;
      markDirty();
      applyToElement();
      return m;
    },

    // 静音开 / 关翻转；返回翻转后的状态
    toggleMute: function () {
      return api.setMuted(!getSettings().muted);
    },

    // 是否正在播放（无宿主 / 未初始化时恒 false）
    isPlaying: function () {
      try { return !!(element && !element.paused && !element.ended); } catch (_) { return false; }
    },

    // 诊断：最近一次播放错误名（自动播放被拦时为 "NotAllowedError"）
    getLastError: function () { return lastError; },

    // 启动入口：幂等；供启动链 / 测试探针显式调用
    init: function () { return init(); }
  };

  if (typeof window !== "undefined") {
    window.GameAudio = api;
    try {
      if (window.addEventListener) {
        window.addEventListener("bootstatechange", onBootState);
      }
    } catch (_) { /* 无事件总线的宿主：仅保留手动 init */ }
    // 兜底：极端分支漏发 bootstatechange 时，8s 后仍尝试起播
    try {
      if (typeof setTimeout === "function") {
        setTimeout(function () { if (!initialized) init(); }, FALLBACK_INIT_MS);
      }
    } catch (_) { /* ignore */ }
  }
})();
