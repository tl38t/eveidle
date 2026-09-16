/* ============================================================================
 * dom-render.js —— 微信小游戏「DOM → Canvas」渲染层（宿主侧驱动）
 *
 * 背景（为什么必须有它）：
 *   游戏界面是用 DOM 搭的；微信小游戏里没有 DOM，`wx/shim.js` 只做到「接住调用不报错」，
 *   它**不往屏幕上画任何东西**（getBoundingClientRect 恒 0、无布局无绘制）。
 *   本文件把 shim 的**活节点树**接进 dom-kernel 的样式/布局/绘制三层，接上帧循环与触摸。
 *
 * 数据流：
 *   index.html 文本（构建期内联在 wx/dom-assets.js）
 *     → install()：灌进 shim 的 document（**必须早于逻辑层**，否则逻辑层查询只会拿到桩）
 *     → 逻辑层 js/** 在真节点树上建界面（写文本/类/内联样式）
 *     → start()：每帧对 shim 树取指纹 → 变了才重建 kernel 树 → 样式 → 排版 → 绘制
 *     → 触摸：命中布局盒子 → 派发 pointerdown/touchstart/pointerup/touchend/click
 *
 * 硬约束：
 *   ⛔ 不含任何游戏逻辑；⛔ 不改 js/**、不改 index.html；
 *   ⛔ 不实现第二份 HTML 解析（用 shim 的 parseFragment）与第二份渲染内核（用 dom-kernel.js）。
 *
 * 用法（game.js 里由打包器接线）：
 *   var screen = wx.createCanvas();          // 小游戏第一次 createCanvas = 屏幕画布
 *   require("./wx/shim.js");
 *   var dom = require("./wx/dom-render.js");
 *   dom.install();                           // 早于逻辑层
 *   require("./boot.js")();
 *   dom.start(screen);
 *
 * 诊断（微信无 console 回传，故一律落文件）：
 *   wx.env.USER_DATA_PATH/dom-render-diag.json   分阶段诊断（含耗时、盒子数、像素自证、错误）
 *   wx.env.USER_DATA_PATH/dom-render-frame.png   首帧截屏（可直接肉眼核验）
 *   GameGlobal.__WX_DOM_RENDER__                 宿主内可查（diag / render / hitTest / state）
 * ==========================================================================*/
;(function () {
"use strict";

/* ---------------- 环境探测（全部容错：宿主差异不能让整包起不来） ---------------- */
function hostRoot() {
  try { if (typeof GameGlobal !== "undefined" && GameGlobal) return GameGlobal; } catch (e) {}
  try { if (typeof globalThis !== "undefined" && globalThis) return globalThis; } catch (e) {}
  try { if (typeof window !== "undefined" && window) return window; } catch (e) {}
  return {};
}
var G = hostRoot();

function getWx() { try { return (typeof wx !== "undefined" && wx) ? wx : null; } catch (e) { return null; } }

/* ---------------- 可调参数（宿主内可改：GameGlobal.__WX_DOM_RENDER__.config） ---------------- */
var CONFIG = {
  /* 渲染节流：一帧的实际耗时 × 该系数 = 两次渲染的最小间隔。自适应，避免把 CPU 打满。
     重排+重绘是纯 JS，设备上比桌面 Node 慢 2~3 倍；先保证「能看清」再谈帧率。 */
  /* 节流间隔 = renderMs × budgetFactor ⇒ **占空比恒为 1/budgetFactor**。
     1.5 = 每 1.5 份时间里 1 份在主线程里同步烧掉（67%）⇒ 输入被压在后面。
     2.5 ⇒ 40% 占用、剩 60% 留给点击与逻辑；交互仍靠「点按后强渲」保手感。 */
  budgetFactor: 2.5,
  minIntervalMs: 120,      // 间隔下限（渲染很快时也不超过 ~8fps 的重排）
  maxIntervalMs: 1200,     // 间隔上限（渲染很慢时至少 ~0.8fps，保证界面还会更新）
  fpEveryFrame: true,      // 每帧都取指纹（便宜）vs 隔帧取
  drawFps: false,          // 首帧起在左下角叠帧率（排查用，正式留 false）
  dprMax: 3,               // ⚠️ 别为省时间降这个：paint 只占 ~29/231ms，降到 2 只省 ~15ms，
                           //    代价是画布物理像素少于屏幕（1170→780）⇒ 被拉伸变糊。收益不值。
  /* ⚠️ 诊断落盘是**同步文件 IO**（真机上每 2s 一次 writeFileSync + setStorageSync），
     会直接卡主线程。生产默认关掉定时落盘，只保留「首帧 / 出错」两次，靠 API.persist(true)
     随时手动取。要现场排查就把它设回 2000。 */
  persistEveryMs: 0,
  /* PNG 自证落盘（toTempFilePathSync 全画布编码 + copyFileSync）同样是同步重活，生产默认关。 */
  dumpPng: false,
  /* 样式缓存开关。默认开；关掉 = 退化为每帧全量级联（慢但语义最直白），
     用于「怀疑缓存导致渲染异常」时的 A/B 取证。 */
  useStyleCache: true,
  /* 选择器索引：按最右复合选择器分桶，元素只测可能匹配的规则，而不是全部 2580 条。
     实测把「整棵树冷算」从 ~180ms 降到 ~40ms —— 交互（开抽屉/切页）的唯一瓶颈。
     由「索引开/关逐元素样式等价」判据兜底（关掉必须得到完全相同的样式）。 */
  useRuleIndex: true,
  /* 调试用正则串：非空时逐帧把匹配元素的样式与缓存命中情况写进诊断（默认空 = 零开销）。 */
  debugKey: "",
  logOnce: true,
};

/* 惰性配置覆盖钩子：宿主/探针可以在 require 之前设
     GameGlobal.__WX_DOM_RENDER_CONFIG__ = { dumpPng: true, persistEveryMs: 2000 }
   用于**现场排查**（真机上把诊断/截图打开）与探针取证。不设 = 生产默认，行为不变。
   只允许覆盖 CONFIG 里已存在的键，防止拼错键名后静默无效（本项目的老坑）。 */
try {
  var __ov = (typeof GameGlobal !== "undefined" && GameGlobal && GameGlobal.__WX_DOM_RENDER_CONFIG__) || null;
  if (__ov) { for (var __k in __ov) { if (Object.prototype.hasOwnProperty.call(CONFIG, __k)) CONFIG[__k] = __ov[__k]; } }
} catch (e0) {}

/* ---------------- 模块状态 ---------------- */
var S = {
  installed: false, started: false,
  canvas: null, ctx: null, dpr: 1, fmt: "—",
  K: null, A: null,
  rules: null, vars: null, cssLabels: [],
  /* 样式缓存（WeakMap: shim 元素 → {sig,style,wins}）。宿主没有 WeakMap 时为 null ⇒ 退化为不缓存。 */
  styleCache: null,
  root: null, srcRoot: null,
  fonts: [], fontStack: "",
  lastFp: 0, lastFpAt: 0, fpMs: 0,
  lastRenderAt: 0, nextAllowedAt: 0,
  nextFpAt: 0, lastInterval: 0, rateLimited: 0, fpCalls: 0, fpMsTotal: 0,
  frames: 0, renderMs: 0, renderMsTotal: 0, layoutMs: 0, paintMs: 0, convMs: 0, styleMs: 0, styleHit: 0, styleMiss: 0,
  boxes: 0, texts: 0,
  pixel: null,
  touches: { start: null, moved: 0, taps: 0, hits: 0, misses: 0 },
  /* ⚠️ 按下的元素**不能**放进 S.touches：diagObj() 会 JSON.stringify 它，
     而 shim 元素带 parentNode/_kids ⇒ 循环引用 ⇒ stringify 抛错 ⇒ **诊断文件在第一次点击后
     就永久停止更新**（实测踩过：落盘内容永远停在启动帧，正好把最需要的信息弄瞎）。
     元素引用一律单独放这里，永不进诊断。 */
  startEl: null,
  errors: [], warns: [],
  t0: Date.now(),
  lastPersistAt: 0,
  fatal: null,
};

function err(where, e) {
  var m = (e && e.stack) ? e.stack : ((e && e.message) ? e.message : String(e));
  if (S.errors.length < 40) S.errors.push(where + " :: " + String(m).split("\n").slice(0, 3).join(" | "));
  return m;
}
function warn(msg) { if (S.warns.length < 40) S.warns.push(msg); }

function load(p) { return require(p); }   // 微信 require 基准 = 本模块所在目录

function diagObj() {
  return {
    at: Date.now(), up: Date.now() - S.t0,
    installed: S.installed, started: S.started,
    viewport: S.fmt, dpr: S.dpr, fonts: S.fonts,
    css: S.rules ? { sheets: S.cssLabels.length, rules: S.rules.length, vars: S.vars ? Object.keys(S.vars).length : 0, labels: S.cssLabels.slice(0, 12) } : null,
    tree: S.root ? { boxes: S.boxes, texts: S.texts } : null,
    perf: { frames: S.frames, renderMs: S.renderMs, renderMsTotal: Math.round(S.renderMsTotal), convMs: S.convMs, styleMs: S.styleMs, layoutMs: S.layoutMs, paintMs: S.paintMs, paintStat: S.paintStat || null, fpMs: S.fpMs, fpErr: S.fpErr, ruleIdx: S.ruleIdxStats || null, fpCalls: S.fpCalls || 0, fpMsTotal: Math.round(S.fpMsTotal || 0), rateLimited: S.rateLimited || 0, lastInterval: Math.round(S.lastInterval || 0), styleHit: S.styleHit, styleMiss: S.styleMiss, skippedFp: S.skippedFp || 0, measureHit: S.measureHit || 0, measureMiss: S.measureMiss || 0, tickN: S.tickN || 0, throttled: S.throttled || 0, fpVal: S.fpVal, fpAt: S.lastFpAt, interval: Math.round(S.nextAllowedAt - S.lastRenderAt) },
    pixel: S.pngLate || S.pixel,   // 优先报「界面建完之后」那次像素自证
    touch: { moved: S.touches.moved, taps: S.touches.taps, hits: S.touches.hits, misses: S.touches.misses, pending: !!S.touches.start },
    pngBoot: S.pngPath1 || null,
    png: S.pngPath || null,
    fatal: S.fatal,
    errors: S.errors.slice(0, 20), warns: S.warns.slice(0, 20),
    debug: S.debugLog || null,
  };
}

function persist(force) {
  var w = getWx();
  var d = diagObj();
  S.lastPersistAt = Date.now();
  try { if (w && w.setStorageSync) w.setStorageSync("__wx_dom_render__", d); } catch (e) {}
  if (!w || !w.getFileSystemManager || !w.env) return d;
  try {
    w.getFileSystemManager().writeFileSync(w.env.USER_DATA_PATH + "/dom-render-diag.json", safeJson(d), "utf8");
  } catch (e) { warn("diag 落盘失败: " + ((e && e.message) || e)); }
  return d;
}
/* 诊断**绝不能因为自己的形状问题写不出去**（那正是最需要它的时候）。
   已知雷区：shim 元素带 parentNode/_kids，一旦混进被序列化的对象就是循环引用。 */
function safeJson(d) {
  try { return JSON.stringify(d, null, 1); }
  catch (e) {
    var slim = { at: d.at, up: d.up, jsonErr: (e && e.message) || String(e), installed: d.installed, started: d.started,
      viewport: d.viewport, css: d.css && { sheets: d.css.sheets, rules: d.css.rules, vars: d.css.vars },
      tree: d.tree, perf: d.perf, pixel: d.pixel, fatal: d.fatal, errors: d.errors, warns: d.warns };
    try { return JSON.stringify(slim, null, 1); } catch (e2) { return '{"jsonErr":"诊断对象不可序列化"}'; }
  }
}

/* ==========================================================================
 * 1. install() —— 把 index.html 灌进 shim 的 document
 * --------------------------------------------------------------------------
 * 为什么必须早于逻辑层：shim 的 document 初值是「html/head/body 三个空壳」，
 *   此时 getElementById 只能回退到**占位桩**（shim.js:1101 的告警就是这条路径）。
 *   占位桩是「能接住调用、但没有属性和类」的空元素 ⇒ 依赖 data 属性 / 类的事件委派不命中。
 *   把 index.html 的真节点树喂进去后，同一批查询才第一次命中真元素。
 * ========================================================================== */
function install() {
  if (S.installed) return diagObj();
  var D = null;
  try { D = (typeof document !== "undefined" && document) ? document : (G.document || null); } catch (e) {}
  if (!D || !D.body) { S.fatal = "shim 的 document 不可用（wx/shim.js 未加载？）"; return persist(true); }
  if (!S.A) {
    try { S.A = load("./dom-assets.js"); }
    catch (e) { S.fatal = "缺少 wx/dom-assets.js：" + err("install/assets", e); return persist(true); }
  }
  var A = S.A;
  try {
    if (A.headHtml && D.head) D.head.innerHTML = A.headHtml;
  } catch (e) { err("install/head", e); }
  try {
    if (A.bodyHtml) D.body.innerHTML = A.bodyHtml;
  } catch (e) { err("install/body", e); }
  /* <html>/<body> 上的属性必须照搬：body 的 `boot-loading` 类决定「启动期隐藏顶栏与主容器」
     （.boot-loading .topbar{display:none!important}），照搬后由逻辑层在就绪时自行摘除。
     漏搬 = 启动态与浏览器不一致（顶栏提前出现 / 或缺一层加载遮罩）。 */
  setAttrs(D.documentElement, A.htmlAttrs);
  setAttrs(D.body, A.bodyAttrs);
  S.installed = true;
  var c = {};
  try { c = countRaw(D.documentElement, { els: 0, texts: 0 }); } catch (e) {}
  S.installStat = c;
  persist(true);
  return diagObj();
}

function setAttrs(el, attrText) {
  if (!el || !attrText) return;
  var re = /([\w:-]+)\s*=\s*"([^"]*)"/g, m;
  while ((m = re.exec(attrText))) {
    try { el.setAttribute(m[1], m[2]); } catch (e) {}
  }
}

/* shim 树是**惰性**的：innerHTML 存入缓冲区，首次读 childNodes 时才解析
   （shim.js 的 __materialize）。遍历/转换前必须物化，否则会数出一棵空树。 */
function materialize(n) {
  if (n && typeof n.__materialize === "function") { try { n.__materialize(); } catch (e) {} }
  return n;
}
function countRaw(n, acc) {
  materialize(n);
  var kids = n._kids || [];
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (!k) continue;
    if (k.nodeType === 1) { acc.els++; countRaw(k, acc); }
    else if (k.nodeType === 3) acc.texts++;
  }
  return acc;
}

/* ==========================================================================
 * 2. start(canvas) —— 接管屏幕画布：字体 → 首帧 → 帧循环 → 触摸
 * ========================================================================== */
function start(canvas) {
  if (S.started) return diagObj();
  var w = getWx();
  if (!canvas && w && w.createCanvas) { try { canvas = w.createCanvas(); } catch (e) {} }
  if (!canvas) { S.fatal = "没有屏幕画布（wx.createCanvas 不可用）"; return persist(true); }
  try { S.K = (G.__WX_DOM_KERNEL__ || load("./dom-kernel.js")); }
  catch (e) { S.fatal = "缺少 wx/dom-kernel.js：" + err("start/kernel", e); return persist(true); }

  /* --- 视口：与已在真机验证过的 first-screen 同口径（screenWidth/Height，pixelRatio 封顶 3） --- */
  var info = {};
  try { info = (w && w.getWindowInfo) ? (w.getWindowInfo() || {}) : ((w && w.getSystemInfoSync) ? (w.getSystemInfoSync() || {}) : {}); } catch (e) { err("start/windowInfo", e); }
  var W = Math.round(info.screenWidth || info.windowWidth || 375);
  var H = Math.round(info.screenHeight || info.windowHeight || 667);
  S.winInfo = { windowWidth: info.windowWidth, windowHeight: info.windowHeight, screenWidth: info.screenWidth, screenHeight: info.screenHeight, pixelRatio: info.pixelRatio };
  S.dpr = Math.min(Math.max(info.pixelRatio || 2, 1), CONFIG.dprMax);
  S.fmt = W + "x" + H + "@" + S.dpr + "x";
  S.ENV = { width: W, height: H, hover: false, reducedMotion: false };
  /* 样式缓存在 start 时才建：install 阶段可能被多次调用（热重载），缓存跟着视图走更干净。
     ⚠️ key 是 shim 元素，HTML 重解析会换出新元素 ⇒ 旧条目由 WeakMap 自动回收，不会持续膨胀。 */
  try { S.styleCache = (CONFIG.useStyleCache && typeof WeakMap === "function") ? new WeakMap() : null; } catch (e) { S.styleCache = null; }
  /* 测量缓存：字体一旦变化（loadFonts / 宿主回退），先前算出的宽度全部作废 ⇒ 见 loadFonts 末尾。 */
  try { S.measureCache = new Map(); } catch (e2) { S.measureCache = null; }

  canvas.width = Math.round(W * S.dpr);
  canvas.height = Math.round(H * S.dpr);
  S.canvas = canvas;
  try {
    S.ctx = canvas.getContext("2d");
    if (!S.ctx) throw new Error("getContext('2d') 返回空");
    if (S.ctx.setTransform) S.ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    else S.ctx.scale(S.dpr, S.dpr);
  } catch (e) { S.fatal = "拿不到 2D 上下文：" + err("start/ctx", e); return persist(true); }

  loadFonts(w);
  S.started = true;

  /* --- 样式表只解析一次（解析 400KB CSS 是纯 CPU，不能每帧做） --- */
  try {
    var A = S.A || (S.A = load("./dom-assets.js"));
    var rules = [], vars = Object.create(null), orderRef = { i: 0 };
    for (var i = 0; i < A.css.length; i++) {
      var r = S.K.parseStylesheet(A.css[i], S.ENV, orderRef);
      rules = rules.concat(r.rules);
      for (var k in r.vars) vars[k] = r.vars[k];
    }
    S.rules = rules; S.vars = vars; S.cssLabels = A.cssLabels || [];
    /* 索引也**只建一次**（规则集在运行期不变）。buildRuleIndex 由内核导出。 */
    S.ruleIdx = null;
    /* ⚠️ 无条件建索引（不受开关影响）：否则探针无法在同一进程里做「索引开/关」A/B 等价对比。
       开关只决定 computeStyles 是否**使用**它。 */
    if (typeof S.K.buildRuleIndex === "function") {
      try { S.ruleIdx = S.K.buildRuleIndex(S.rules); S.ruleIdxStats = S.ruleIdx.stats; }
      catch (eIdx) { warn("buildRuleIndex: " + ((eIdx && eIdx.message) || eIdx)); }
    }
  } catch (e) { S.fatal = "样式表解析失败：" + err("start/css", e); return persist(true); }

  /* --- 生命周期事件（小游戏没人派发，必须自己补）→ 再出首帧，避免首帧是「半成品界面」 --- */
  fireBootEvents();

  /* --- 首帧：无条件渲染（此时逻辑层可能还没建完界面，但先出图，避免「纯黑看不出进度」） --- */
  render("first", true);

  /* --- 帧循环 --- */
  requestFrame(tick);
  bindTouch(w);
  try {
    if (G) G.__WX_DOM_RENDER__ = { diag: diagObj, render: function (why) { return render(why || "manual", true); }, hitTest: hitTest, config: CONFIG, state: S, persist: persist };
  } catch (e) {}
  persist(true);
  return diagObj();
}

function loadFonts(w) {
  /* 真机有系统字体；图标与标题字体是包内的 ttf/woff2。
     微信提供 wx.loadFont(path)（同步，返回字体族名）。**尽力而为**：失败只记录，不影响渲染。
     价值：FontAwesome 的图标字形当前渲染成方块（私有区码点无字体覆盖）。 */
  var cands = [
    "subassets/assets/vendor/taptap-h5/fontawesome/webfonts/fa-solid-900.ttf",
    "assets/vendor/taptap-h5/fontawesome/webfonts/fa-solid-900.ttf",
  ];
  if (w && typeof w.loadFont === "function") {
    for (var i = 0; i < cands.length; i++) {
      try {
        var fam = w.loadFont(cands[i]);
        if (fam && typeof fam === "string") { S.fonts.push(fam); S.fontSrc = S.fontSrc || cands[i]; break; }
      } catch (e) { warn("loadFont " + cands[i] + " 失败: " + ((e && e.message) || e)); }
    }
  } else warn("宿主无 wx.loadFont，图标字体不加载");
  S.fontStack = (S.fonts.length ? S.fonts.join(", ") + ", " : "") +
    'DengXian, "Microsoft YaHei", "PingFang SC", "Heiti SC", sans-serif';
  /* 字体族一变，先前按旧字体量出来的宽度全部失效。 */
  if (S.measureCache) S.measureCache.clear();
  S.lastFont = null;
}

/* ==========================================================================
 * 3. 树转换：shim 活节点树 → kernel 树
 * --------------------------------------------------------------------------
 * kernel 只认 {type:'element'|'text', tag, attrs, classes, children, style}。
 * 每帧从 shim 树**重建**（不增量），换来的是「永远与逻辑层所见一致」——
 * 增量维护一份影子树才是真正的坑源（两份真值必然漂移）。
 * ========================================================================== */
var SKIP_TAGS = { script: 1, link: 1, meta: 1, title: 1, head: 1, style: 1, noscript: 1, base: 1 };
var CONV = { els: 0, texts: 0, skipped: 0, inline: 0 };

function toKernel(n, parentEl) {
  if (!n) return null;
  var nt = n.nodeType;
  if (nt === 3) {
    var t = n.textContent != null ? n.textContent : n.data;
    if (t == null) return null;
    t = String(t).replace(/\s+/g, " ");
    if (!t.trim()) return null;
    CONV.texts++;
    var tn = { type: "text", text: t, src: n, srcEl: parentEl };
    tn.parent = parentEl || null;
    return tn;
  }
  if (nt !== 1) return null;
  materialize(n);
  var tag = String(n.tagName || "").toLowerCase();
  if (!tag || SKIP_TAGS[tag]) { CONV.skipped++; return null; }
  var attrs = {};
  if (n._attrs) { for (var k in n._attrs) attrs[k] = n._attrs[k]; }
  // 🔴 桥接：shim 里 `el.hidden = true`（IDL 属性赋值）不会反射进 `_attrs`，
  // 而 kernel 的 [hidden] 选择器 / [hidden]{display:none}（dom-kernel.js applyInlineAndUAStyles）只认 `attrs.hidden`。
  // 结果：所有用 `.hidden = true` 隐藏的元素在微信 canvas 里「隐藏免疫」——用户见的「黑块」即 #tutorial-widget。
  // 这里把 hidden IDL 属性反射进 kernel attrs，与 setAttribute("hidden","") 路径对齐（shim.js:581/588）。
  if (n.hidden && attrs.hidden === undefined) attrs.hidden = "";
  if (n.id) attrs.id = n.id;
  if (n.className != null) attrs["class"] = String(n.className);
  attrs["class"] = attrs["class"] || "";
  var cssText = "";
  try { if (typeof n.getAttribute === "function") cssText = n.getAttribute("style") || ""; }
  catch (e) { attrs.__styleErr = 1; }
  if (cssText) { attrs.style = cssText; CONV.inline++; }
  var el = {
    type: "element", tag: tag, attrs: attrs,
    classes: String(attrs["class"]).trim().split(/\s+/).filter(Boolean),
    children: [], style: Object.create(null),
    src: n, srcEl: n,
  };
  el.scrollTop = (typeof n.scrollTop === "number") ? n.scrollTop : 0;
  el.scrollLeft = (typeof n.scrollLeft === "number") ? n.scrollLeft : 0;
  CONV.els++;
  var kids = n._kids || [];
  for (var i = 0; i < kids.length; i++) {
    var c = toKernel(kids[i], el);
    if (c) { c.parent = el; el.children.push(c); }
  }
  return el;
}

/* ==========================================================================
 * 4. 指纹：判断「界面这一帧到底变没变」
 * --------------------------------------------------------------------------
 * 全量重排 150ms 级，不能每帧跑；而游戏大部分时间（挂机）界面是不变的。
 * 指纹只读节点树（不建 kernel 树、不算样式），实测远低于重排成本。
 * 参与哈希的必须是**能影响呈现**的量：标签、id、类、内联样式、文本。
 * ========================================================================== */
var FBUF = [];
function fpWalk(n, depth) {
  materialize(n);
  var kids = n._kids || [];
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (!k) continue;
    if (k.nodeType === 1) {
      var st = null;
      try { st = typeof k.getAttribute === "function" ? k.getAttribute("style") : null; } catch (e) {}
      FBUF.push(k.tagName, k.id || "", k.className || "", st || "");
      fpWalk(k, depth + 1);
    } else if (k.nodeType === 3) {
      FBUF.push(k.textContent != null ? k.textContent : k.data);
    }
  }
}
function fingerprint() {
  FBUF.length = 0;
  try { fpWalk(G.document.documentElement, 0); }
  catch (e) { S.fpErr = err("fingerprint", e); return 0; }   // ⛔ 不许静默：指纹恒返 0 会让「界面永远不重绘」
  S.fpErr = null;
  var h = 0x811c9dc5;
  for (var i = 0; i < FBUF.length; i++) {
    var s = String(FBUF[i] == null ? "" : FBUF[i]);
    for (var j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    h = (h ^ 0x2c) >>> 0;   // 段分隔符，避免 ["ab","c"] 与 ["a","bc"] 同哈希
  }
  return h >>> 0;
}

/* 生命周期事件：浏览器里由宿主派发，**小游戏里没人派发**。
   游戏的 UI 初始化挂在 DOMContentLoaded 上 —— 不补这一步，逻辑层建不出界面
   （实测：补之前首帧只有 55 个布局盒子，补之后是完整界面）。
   ⚠️ 必须晚于逻辑层 boot()（game.js 的顺序：install → boot → start），正好与浏览器一致。
   ⚠️ 事件对象必须是真 Event（若环境有 Event 构造器）：模拟器的原生 dispatchEvent
      严格要求 Event 实例，普通对象抛 "parameter 1 is not of type 'Event'"
      ⇒ DOMContentLoaded 派发失败 ⇒ 逻辑层建不出界面 ⇒ 黑屏（2026-09-16 实测）。
      shim 侧已强制接管 dispatchEvent（双保险），这里再兼容原生。 */
function makeEvt(type) {
  try {
    var EC = (typeof G !== "undefined" && G && typeof G.Event === "function") ? G.Event
           : (typeof Event === "function" ? Event : null);
    if (EC) {
      var ev = new EC(type);
      try { ev.target = G.document; } catch (e2) {}
      return ev;
    }
  } catch (e) {}
  return { type: type, target: G.document };
}
function fireBootEvents() {
  if (S.bootEventsFired) return;
  S.bootEventsFired = true;
  try {
    var D = G.document;
    if (D && typeof D.dispatchEvent === "function") D.dispatchEvent(makeEvt("DOMContentLoaded"));
    else warn("document.dispatchEvent 不可用，DOMContentLoaded 未派发");
  } catch (e) { err("fireBootEvents/DOMContentLoaded", e); }
  try {
    if (typeof G.dispatchEvent === "function") G.dispatchEvent(makeEvt("load"));
  } catch (e2) { err("fireBootEvents/load", e2); }
}

/* ==========================================================================
 * 5. 渲染一帧
 * ========================================================================== */
function measure(text, spec) {
  var size = spec.size || 14;
  var weight = spec.weight || "400";
  var fam = spec.family || S.fontStack;
  var T = text == null ? "" : String(text);
  /* 🔴 测量只取决于 (text, weight, size, family) ⇒ 纯函数，可缓存。
     实测每帧 5333 次测量里只有 3408 个唯一串（重复 1.56x），而那批长正文
     （新手引导、说明文字）**每帧都被整段重测**，纯属浪费。 */
  var cache = S.measureCache;
  var key = weight + " " + size + " " + fam + "" + T;
  if (cache) {
    var hit = cache.get(key);
    if (hit !== undefined) { S.measureHit = (S.measureHit || 0) + 1; return hit; }
  }
  var out;
  try {
    var font = weight + " " + size + "px " + fam;
    /* ⚡ `ctx.font` 赋值要重新解析字体串（实测 0.74µs/次 × 5333 = 3.9ms/帧）。
       连续测量多来自同一个元素 ⇒ 自行记住上次赋的值，不必依赖 getter 的规范化行为。 */
    if (S.lastFont !== font) { S.ctx.font = font; S.lastFont = font; }
    var m = S.ctx.measureText(T);
    out = { width: m.width, height: size * 1.35 };
  } catch (e) { out = { width: T.length * size * 0.55, height: size * 1.35 }; }
  if (cache) {
    if (cache.size >= 8000) cache.clear();
    cache.set(key, out);
    S.measureMiss = (S.measureMiss || 0) + 1;
  }
  return out;
}

function render(reason, force) {
  if (!S.ctx || !S.K) return null;
  var now = Date.now();
  if (!force && now < S.nextAllowedAt) return null;
  var t0 = now;
  S.fatal = null;
  try {
    CONV.els = 0; CONV.texts = 0; CONV.skipped = 0; CONV.inline = 0;
    var D = G.document;
    var root = { type: "element", tag: "#document", attrs: {}, classes: [], children: [], style: Object.create(null) };
    var htmlNode = toKernel(D.documentElement, null);
    if (htmlNode) { htmlNode.parent = root; root.children.push(htmlNode); }
    var t1 = Date.now();

    /* 样式缓存：键 = shim 元素（跨帧稳定，WeakMap 自动回收被重建的节点）。
       实测这是**最大单项开销**（≈120ms/帧，占全量渲染一半以上）：1248 元素 × 2580 规则
       全量重跑选择器匹配，而挂机游戏绝大多数帧只有文本在变，元素属性/结构根本没动。
       没有 WeakMap 的宿主降级为不缓存（与原行为一致，只是慢）。 */
    var st = S.K.computeStyles(root, S.rules, CONFIG.useStyleCache ? S.styleCache : null, CONFIG.useRuleIndex ? S.ruleIdx : null);
    S.styleHit = (st && st.hit) || 0;
    S.styleMiss = (st && st.miss) || 0;
    S.K.applyInlineAndUAStyles(root);
    /* 调试：按 CONFIG.debugKey（正则串）逐帧打印目标元素的样式与缓存命中情况。
       为什么需要：缓存类缺陷（「某些元素的样式和新鲜级联不一致」）光看盒子数只能知道「塌了」，
       必须看到那个元素**每一帧**的 display 与 hit/miss 才能定位是哪一帧写坏了缓存。
       ⚠️ 生产必须留空串（默认），否则每帧字符串匹配会拖慢渲染。 */
    if (CONFIG.debugKey) {
      try {
        var probe = new RegExp(CONFIG.debugKey);
        var rows = [];
        var bodyCls = null;
        (function bfind(n) { if (!n) return; if (n.tag === "body") { bodyCls = (n.attrs || {})["class"] || ""; return; } for (var i = 0; i < (n.children || []).length; i++) bfind(n.children[i]); })(root);
        (function pwalk(n) {
          if (!n || n.type !== "element") return;
          var at = n.attrs || {};
          if (probe.test(at.id || "") || probe.test(at["class"] || "")) {
            rows.push((at.id || at["class"]) + " hit=" + (n.__cacheHit ? 1 : 0) +
              " display=" + JSON.stringify((n.style || {}).display) + " sig=" + n.__sig +
              " bodyCls=" + JSON.stringify(bodyCls));
          }
          for (var i = 0; i < (n.children || []).length; i++) pwalk(n.children[i]);
        })(root);
        if (!S.debugLog) S.debugLog = [];
        S.debugLog.push("f" + S.frames + " " + rows.join(" | "));
        if (S.debugLog.length > 60) S.debugLog.shift();
      } catch (eK) { warn("debugKey: " + ((eK && eK.message) || eK)); }
    }
    S.K.resolveVarsInTree(root, S.vars);
    var t2 = Date.now();

    var lstat = S.K.layoutTree(root, S.ENV, { measure: measure, baseFontSize: 14, rootFontSize: 16, fontFamily: S.fontStack });
    var t3 = Date.now();

    var ctx = S.ctx;
    ctx.fillStyle = "#0b1119";
    ctx.fillRect(0, 0, S.ENV.width, S.ENV.height);
    var pstat = S.K.paintTree(root, ctx, S.ENV, {});
    var t4 = Date.now();

    S.root = root; S.srcRoot = htmlNode;
    S.boxes = (lstat && lstat.count) || 0;
    S.texts = (lstat && lstat.texts) || 0;
    S.convMs = t1 - t0; S.styleMs = t2 - t1; S.layoutMs = t3 - t2; S.paintMs = t4 - t3;
    /* 绘制图元计数（rects/texts/clipped/gradients）—— 诊断「同一棵树 paint 忽快忽慢」时必需：
       只看得出的毫秒数分不清「画得更多」与「机器/后端变慢」，有计数才能二分。 */
    S.paintStat = pstat || null;
    S.renderMs = t4 - t0;
    S.renderMsTotal = (S.renderMsTotal || 0) + S.renderMs;
    S.frames++;
    S.lastRenderAt = t4;
    /* 自适应节流：间隔 ∝ 本帧成本，夹在 [min,max]。设备上重排是纯 JS，宁可慢也不要卡死。 */
    var iv = Math.min(Math.max(S.renderMs * CONFIG.budgetFactor, CONFIG.minIntervalMs), CONFIG.maxIntervalMs);
    S.nextAllowedAt = t4 + iv;
    /* 轮询闸门与渲染节流同周期：理由见 tick() 顶部注释（真机卡顿的真正根因）。 */
    S.lastInterval = iv; S.nextFpAt = t4 + iv;
    S.pstat = pstat;
    if (CONFIG.drawFps) drawFps();

    if (S.frames === 1) {
      S.pixel = pixelProof();
      if (CONFIG.dumpPng) grabPng("1");
      persist(true);
    } else if (!S.pngLate && CONFIG.dumpPng && (t4 - S.t0) > 1500) {
      /* 「代表性首屏」截图：第 1 帧往往在逻辑层建完界面**之前**就画了（实测只有 55 个盒子），
         拿它肉眼核验会误判成「界面没出来」。故 1.5s 后再截一张，与像素自证一起看这一张。
         ⚠️ toTempFilePathSync 是**同步 PNG 编码整张画布**（1170×2532）+ copyFileSync，
         属重活 ⇒ 生产关掉（CONFIG.dumpPng=false），只在探针/排查时开。 */
      S.pngLate = pixelProof();
      grabPng("");
      persist(true);
    } else if (CONFIG.persistEveryMs > 0 && t4 - S.lastPersistAt > CONFIG.persistEveryMs) {
      /* 诊断节流落盘：不这么做，落盘内容会永远停在启动帧（实测踩过 —— 后面所有 persist 都被
         循环引用搞失败，于是「打开诊断文件」看到的是最没信息的那一版）。
         ⚠️ 但它是**同步文件 IO**，真机上会直接卡帧 ⇒ 生产默认 persistEveryMs=0（关）。
         需要现场排查时设 2000，或随时调 API.persist(true) 手动取一次。 */
      persist(true);
    }
    return { reason: reason, ms: S.renderMs, boxes: S.boxes, texts: S.texts };
  } catch (e) {
    var msg = err("render/" + reason, e);
    S.fatal = msg;
    S.nextAllowedAt = Date.now() + 2000;   // 别在错误上死循环
    drawErrorCard(msg);
    persist(true);
    return null;
  }
}

/* 逐像素自证：区分「跑通但没画」与「真画了」。
   ⚠️ 判据陷阱：**不能拿我填的背景色当参照** —— 页面自己还会再铺一层背景，那样恒得 100%。
   正解 = 采样后**出现次数最多的颜色**当背景（众数），报「非众数像素占比」。 */
function pixelProof() {
  try {
    var img = S.ctx.getImageData(0, 0, S.canvas.width, S.canvas.height).data;
    var sampled = 0, modes = {}, best = 0;
    for (var p = 0; p < img.length; p += 4 * 37) {
      sampled++;
      var key = ((img[p] >> 3) << 10) | ((img[p + 1] >> 3) << 5) | (img[p + 2] >> 3);
      modes[key] = (modes[key] || 0) + 1;
      if (modes[key] > best) best = modes[key];
    }
    var non = sampled - best;
    return { sampled: sampled, nonMode: non, nonModeRatio: sampled ? +(non / sampled).toFixed(4) : -1 };
  } catch (e) { return { err: (e && e.message) || String(e) }; }
}

function grabPng(suffix) {
  var w = getWx();
  try {
    if (!S.canvas.toTempFilePathSync || !w || !w.getFileSystemManager || !w.env) return;
    var tmp = S.canvas.toTempFilePathSync({ x: 0, y: 0, width: S.canvas.width, height: S.canvas.height, destWidth: S.canvas.width, destHeight: S.canvas.height, fileType: "png" });
    var dst = w.env.USER_DATA_PATH + "/dom-render-frame" + (suffix ? "-" + suffix : "") + ".png";
    w.getFileSystemManager().copyFileSync(tmp, dst);
    if (suffix) S["pngPath" + suffix] = dst; else S.pngPath = dst;
  } catch (e) { warn("截屏失败: " + ((e && e.message) || e)); }
}

function drawErrorCard(msg) {
  try {
    var ctx = S.ctx, W = S.ENV.width, H = S.ENV.height;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = "#1b0f12"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#ff6b81";
    ctx.font = "700 18px " + S.fontStack;
    ctx.fillText("渲染层异常（截图发给开发）", 16, 48);
    ctx.font = "12px " + S.fontStack;
    ctx.fillStyle = "#ffd6dc";
    var lines = String(msg).split("|");
    for (var i = 0; i < lines.length && i < 12; i++) {
      var s = lines[i].trim().slice(0, 46);
      ctx.fillText(s, 16, 78 + i * 18);
    }
    ctx.fillStyle = "#9aa7b4";
    ctx.fillText("已渲染帧 " + S.frames + " · 盒子 " + S.boxes + " · " + S.fmt, 16, H - 24);
  } catch (e) {}
}
function drawFps() {
  try {
    var ctx = S.ctx;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(6, S.ENV.height - 40, 132, 20);
    ctx.fillStyle = "#7fd1ff"; ctx.font = "11px " + S.fontStack;
    ctx.fillText("fps?" + " ms " + S.renderMs + " box " + S.boxes, 12, S.ENV.height - 26);
  } catch (e) {}
}

/* ==========================================================================
 * 6. 帧循环
 * ========================================================================== */
function requestFrame(cb) {
  try {
    if (typeof requestAnimationFrame === "function") {
      /* 模拟器 rAF 可能注册后永不回调（2026-09-16 实测：127 秒 tickN=0、只画首帧 ⇒ 黑屏）。
         每帧同时挂一个 setTimeout 兜底：rAF 先到就用 rAF 的时间戳，rAF 哑火则退化为 ~10fps。
         done 标志防双跑；正常环境 rAF 每次 16ms 先触发，setTimeout 到点时 done=true 直接返回。 */
      var done = false;
      var once = function (t) { if (done) return; done = true; cb(t || Date.now()); };
      try { requestAnimationFrame(once); } catch (e) {}
      setTimeout(function () { once(Date.now()); }, 16);
      return;
    }
  } catch (e) {}
  return setTimeout(function () { cb(Date.now()); }, 16);
}
function tick() {
  S.tickN = (S.tickN || 0) + 1;
  if (!S.started) return;
  requestFrame(tick);
  try {
    var now = Date.now();
    if (now < S.nextAllowedAt) { S.skippedFp = (S.skippedFp || 0) + 1; return; }
    /* 轮询限速 —— 真机「卡顿非常严重」的**真正根因**就在这里（2026-09-15 实测定位）。
       上一版只做了「先过闸再取指纹」，**治不了稳态**：nextAllowedAt 只在 render() 成功后
       才推进 ⇒ 树不变（挂机游戏绝大多数时间）时闸门**恒开** ⇒ 每个 rAF 都在跑全树指纹。
       实测代价：4ms × 60Hz = **240ms/s = 桌面 24% 主线程**；真机 JS 慢 3~5 倍
       ⇒ 720~1200ms/s = **完全饱和**。这与渲染贵不贵无关（渲染本身只占 1.2%）——
       所以上一轮把 231ms 降到 53ms 之后，真机依旧卡。
       ⇒ 轮询周期 = 渲染节流周期。**比 interval 更快地轮询毫无意义**：渲染被 interval 限住，
         再快也画不出来。代价从 24% 常数级降到 ~3%，且**随设备自动缩放**
         （慢设备 renderMs 大 ⇒ interval 大 ⇒ 轮询更稀），不靠调参碰运气。
       ⚠️ 变更不会漏画：lastFp 只在**渲染成功**时推进，被限速挡下的变更会在下个轮询点重读。 */
    if (now < S.nextFpAt) { S.rateLimited = (S.rateLimited || 0) + 1; return; }
    var f0 = Date.now();
    var fp = fingerprint();
    S.fpMs = Date.now() - f0;
    S.fpCalls = (S.fpCalls || 0) + 1;
    S.fpMsTotal = (S.fpMsTotal || 0) + S.fpMs;
    S.nextFpAt = now + Math.max(CONFIG.minIntervalMs, S.lastInterval || CONFIG.minIntervalMs);
    S.fpVal = fp;
    if (fp !== S.lastFp) {
      /* ⚠️ 只有**真的渲染成功**才推进指纹。旧写法无条件推进 ⇒ 被节流挡掉的那次变更
         再也不会被画出来（界面停在旧状态，直到下一次无关的变更把它一并带出）。 */
      var r = render("dirty", false);
      if (r) { S.lastFp = fp; S.lastFpAt = Date.now(); }
      else S.throttled = (S.throttled || 0) + 1;
    }
  } catch (e) { err("tick", e); }
}

/* ==========================================================================
 * 7. 触摸 → 命中 → 事件合成
 * --------------------------------------------------------------------------
 * 命中：在 kernel 树上找**最深的、盒子包含该点、且 display!=none** 的元素。
 *   后绘制的兄弟优先（DOM 顺序靠后 = 覆盖在上面），与视觉层级一致。
 * 合成：与浏览器一致的顺序 ——
 *   start: pointerdown → touchstart     end: touchend → pointerup → click
 * 游戏实测的监听面：click 262 处、pointer* 8 处、touch* 3 处 ⇒ click 是主路径。
 * ========================================================================== */
  function hitWalk(node, x, y) {
    var hit = null;
    /* ⚠️ 必须用内核的 stackOrder（与 paintTree 同一份实现），**不能**按 node.children 的
       DOM 顺序走。原因（实测踩过）：css/taptap-portrait.css 用 z-index 表达层叠
       （抽屉 1400 > 遮罩 1300 > 底部栏 1100；顶栏 1500）。按 DOM 顺序，「后面的兄弟覆盖
       前面的」会把命中判给 DOM 靠后的 .content —— 于是**抽屉打开时整条左侧导航点不到**
       （抽屉是 .main-container 的前一个兄弟）。而且画面看着「没错」：.content 背景多为
       透明，被盖住的抽屉文字照样显形 ⇒ 纯截图判据永远发现不了。 */
    var kids = (S.K && S.K.stackOrder) ? S.K.stackOrder(node.children) : node.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.type !== "element") continue;
      var b = c.__box;
      if (!b || b.display === "none" || b.w <= 0 || b.h <= 0) continue;
      if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
      /* 卷动反推：canvas 无原生滚动，paint 按 scrollTop 把内容整体上移；
         hitTest 必须做对称反推——进入可卷动容器 c 的子树时，把视口坐标 (x,y)
         还原成内容坐标 (x+scrollLeft, y+scrollTop) 再测 c 的子节点，
         否则滚动后点击会落在「滚动前」的元素上（= 用户报的「点不了/点错」）。
         与 paint.mjs 的 ctx.translate(-scrollLeft, -scrollTop) 同一套坐标关系。 */
      var _ox = 0, _oy = 0;
      var _cst = c.style || {};
      var _cov = _cst.overflow || _cst["overflow-y"] || "";
      if (/auto|scroll|hidden/.test(String(_cov))) {
        var _cso = c.__scrollTop || 0, _cslo = c.__scrollLeft || 0;
        var _csh = c.__scrollH || 0, _cch = c.__clientH || b.h;
        var _cmaxY = Math.max(0, _csh - _cch);
        _oy = Math.max(0, Math.min(_cso, _cmaxY));
        _ox = _cslo || 0;
      }
      var deeper = hitWalk(c, x + _ox, y + _oy);
      /* ⚠️ 必须尊重 pointer-events:none：浏览器里这类层（如 #combat-fx-layer:
         inset:0; z-index:10; pointer-events:none）是透明/装饰层，点击应**穿透**到下层的真实
         按钮。canvas 内核没有真实 DOM 穿透，若不跳过，全屏 pointer-events:none 层会吞掉所有
         点击 ⇒ 界面可见但「什么都点不了」。子节点可显式 pointer-events:auto 重新开启，
         故跳过本节点自身、仍递归子节点（与浏览器一致）。 */
      var pe = c.style && c.style["pointer-events"];
      hit = (pe === "none") ? deeper : (deeper || c);
    }
    return hit;
  }
function hitTest(x, y) {
  if (!S.root) return null;
  var n = hitWalk(S.root, x, y);
  var chain = [];
  while (n) { chain.push({ tag: n.tag, id: (n.attrs && n.attrs.id) || "", cls: (n.attrs && n.attrs["class"]) || "", box: n.__box ? [Math.round(n.__box.x), Math.round(n.__box.y), Math.round(n.__box.w), Math.round(n.__box.h)] : null }); n = n.parent; }
  return { node: chain.length ? chain[0] : null, chain: chain.slice(0, 8) };
}
/* 返回命中点对应的 shim 元素（用于派发） */
function hitEl(x, y) {
  if (!S.root) return null;
  var n = hitWalk(S.root, x, y);
  while (n && !n.srcEl) n = n.parent;
  return n ? n.srcEl : null;
}

function makeEvent(type, x, y) {
  var t = { clientX: x, clientY: y, pageX: x, pageY: y, identifier: 0, force: 1 };
  var ev = {
    type: type, target: null, currentTarget: null,
    clientX: x, clientY: y, pageX: x, pageY: y,
    pageX_: x, screenX: x, screenY: y,
    bubbles: true, cancelable: true, defaultPrevented: false,
    timeStamp: Date.now(),
    touches: [], targetTouches: [], changedTouches: [],
    preventDefault: function () { this.defaultPrevented = true; },
    stopPropagation: function () {},
    stopImmediatePropagation: function () {},
  };
  if (type.indexOf("touch") === 0) { ev.touches = [t]; ev.targetTouches = [t]; ev.changedTouches = [t]; }
  return ev;
}
function fire(el, type, x, y) {
  if (!el || typeof el.dispatchEvent !== "function") return false;
  try { el.dispatchEvent(makeEvent(type, x, y)); return true; }
  catch (e) { err("fire/" + type, e); return false; }
}

function bindTouch(w) {
  if (!w || typeof w.onTouchStart !== "function") { warn("宿主无 onTouchStart，触摸不可用"); return; }
  var T = S.touches;
  w.onTouchStart(function (e) {
    try {
      var p = pointOf(e);
      if (!p) return;
      var el = hitEl(p.x, p.y);
      T.start = { x: p.x, y: p.y };      // 只存标量：进诊断的必须可序列化
      S.startEl = el;                    // 元素引用单独放，永不序列化
      T.moved = 0;
      if (el) { T.hits++; fire(el, "pointerdown", p.x, p.y); fire(el, "touchstart", p.x, p.y); }
      else T.misses++;
    } catch (e2) { err("onTouchStart", e2); }
  });
  if (typeof w.onTouchMove === "function") {
    w.onTouchMove(function (e) {
      try {
        var p = pointOf(e); if (!p || !T.start) return;
        var dx = p.x - T.start.x, dy = p.y - T.start.y;
        if (dx * dx + dy * dy > 144) T.moved = 1;
        // 卷动：从按下点所在节点向上找最近的可卷动容器
        var sc = findScrollContainer(S.startNode);
        if (sc && sc.srcEl) {
          var nsTop = clampScroll(sc.top - dy, sc.maxY);
          var nsLeft = clampScroll(sc.left - dx, sc.maxX);
          if (nsTop !== sc.top || nsLeft !== sc.left) {
            try {
              sc.srcEl.scrollTop = nsTop;
              sc.srcEl.scrollLeft = nsLeft;
              if (sc.node) { sc.node.__scrollTop = nsTop; sc.node.__scrollLeft = nsLeft; }
            } catch (eS) {}
            T.moved = 1;
            try { render("scroll", true); } catch (eR) { err("scroll-render", eR); }
            T.start = { x: p.x, y: p.y };   // 重置起点 ⇒ 连续拖动平滑
            return;                          // 卷动时不派发 touchmove（避免与游戏拖拽冲突）
          }
        }
        if (S.startEl) fire(S.startEl, "touchmove", p.x, p.y);
      } catch (e2) { err("onTouchMove", e2); }
    });
  }
  w.onTouchEnd(function (e) {
    try {
      var p = pointOf(e) || { x: T.start ? T.start.x : 0, y: T.start ? T.start.y : 0 };
      var st = T.start;
      var el = S.startEl;
      T.start = null; S.startEl = null;
      if (!st) return;
      /* 松手点重新命中：只有「按下与抬起在同一元素且位移小」才算点击（与浏览器一致）。
         位移大 = 滑动，不该触发按钮。 */
      var el2 = hitEl(p.x, p.y);
      var same = el && el2 === el && !T.moved;
      if (el) { fire(el, "touchend", p.x, p.y); fire(el, "pointerup", p.x, p.y); }
      if (el2 && el2 !== el) { fire(el2, "touchend", p.x, p.y); fire(el2, "pointerup", p.x, p.y); }
      if (same) {
        T.taps++; fire(el, "click", p.x, p.y);
        /* ⚡ 点按必须立刻有反馈。空闲更新按 40% 占空比节流，界面最多要等一个窗口
           （数百毫秒）才变 —— 手感就是「点了没反应」。交互路径强制重绘。 */
        try { var fpIn = fingerprint(); if (render("input", true)) S.lastFp = fpIn; }
        catch (eIn) { err("input-render", eIn); }
      }
    } catch (e2) { err("onTouchEnd", e2); }
  });
}
function pointOf(e) {
  try {
    var t = (e && e.changedTouches && e.changedTouches[0]) || (e && e.touches && e.touches[0]) || e;
    if (!t) return null;
    var x = (t.clientX != null) ? t.clientX : t.x;
    var y = (t.clientY != null) ? t.clientY : t.y;
    if (x == null || y == null) return null;
    return { x: Number(x), y: Number(y) };
  } catch (e2) { return null; }
}

/* ==========================================================================
 * 8. 导出
 * ========================================================================== */
var API = { install: install, start: start, render: function (why) { return render(why || "manual", true); }, diag: diagObj, persist: persist, hitTest: hitTest, hitElement: hitEl, fingerprint: fingerprint, config: CONFIG, state: S };

try { if (G) G.__WX_DOM_RENDER_API__ = API; } catch (e0) {}
try { if (typeof module !== "undefined" && module && module.exports) module.exports = API; } catch (e1) {}
})();
