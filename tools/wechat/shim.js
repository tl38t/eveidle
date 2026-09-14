/**
 * 微信小游戏 DOM shim（P4 探针版）
 *
 * 依据 P1 探针实测结论（docs/WECHAT_PROBE_P1_LOGIC_SMOKE_v0.1.md）：
 *   逻辑层裸 document. 仅 5 个文件 / 149 处，全在函数体内，加载期不触发；
 *   唯二「加载期硬失败」= translator.js:23 的 URLSearchParams(window.location.search)
 *                        + persistence.js 顶层的 document.addEventListener("visibilitychange")。
 *
 * 本文件在 S1 会替换为正式平台层；当前目标是「让整包能加载不抛错」。
 * ⛔ 禁止在此文件里实现任何游戏逻辑。
 */
(function () {
  var G = typeof globalThis !== "undefined" ? globalThis : this;
  if (G.__WX_SHIM_INSTALLED__) return;
  G.__WX_SHIM_INSTALLED__ = true;

  // ---------- window / globalThis 互指 ----------
  if (typeof G.window === "undefined") G.window = G;
  if (typeof window !== "undefined" && !window.globalThis) window.globalThis = G;

  // ---------- 极简元素桩 ----------
  var listeners = new WeakMap();

  function makeElement(tag) {
    var el = {
      tagName: String(tag || "div").toUpperCase(),
      nodeType: 1,
      id: "",
      className: "",
      style: {},
      dataset: {},
      children: [],
      childNodes: [],
      parentNode: null,
      textContent: "",
      innerHTML: "",
      innerText: "",
      value: "",
      checked: false,
      disabled: false,
      hidden: false,
      offsetWidth: 0,
      offsetHeight: 0,
      clientWidth: 0,
      clientHeight: 0,
      scrollTop: 0,
      scrollLeft: 0,
      _attrs: {},
    };
    el.classList = {
      add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; },
    };
    el.getAttribute = function (k) { return k in el._attrs ? el._attrs[k] : null; };
    el.setAttribute = function (k, v) { el._attrs[k] = String(v); };
    el.removeAttribute = function (k) { delete el._attrs[k]; };
    el.hasAttribute = function (k) { return k in el._attrs; };
    el.appendChild = function (c) { el.children.push(c); el.childNodes.push(c); if (c) c.parentNode = el; return c; };
    el.insertBefore = el.appendChild;
    el.removeChild = function (c) {
      var i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1);
      var j = el.childNodes.indexOf(c); if (j >= 0) el.childNodes.splice(j, 1);
      return c;
    };
    el.remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    el.replaceChildren = function () { el.children.length = 0; el.childNodes.length = 0; };
    el.contains = function () { return false; };
    el.closest = function () { return null; };
    el.matches = function () { return false; };
    el.querySelector = function () { return null; };
    el.querySelectorAll = function () { return []; };
    el.getBoundingClientRect = function () { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; };
    el.scrollIntoView = function () {};
    el.focus = function () {};
    el.blur = function () {};
    el.click = function () { el.dispatchEvent({ type: "click", target: el }); };
    el.addEventListener = function (t, fn) {
      var m = listeners.get(el) || {}; (m[t] = m[t] || []).push(fn); listeners.set(el, m);
    };
    el.removeEventListener = function (t, fn) {
      var m = listeners.get(el) || {}; if (m[t]) m[t] = m[t].filter(function (f) { return f !== fn; });
    };
    el.dispatchEvent = function (ev) {
      var m = listeners.get(el) || {};
      (m[ev && ev.type] || []).forEach(function (fn) { try { fn(ev); } catch (e) { console.warn("[shim] listener error", e); } });
      return true;
    };
    el.getContext = function (type, attrs) {
      if (el._ctx) return el._ctx;
      // 小游戏没有 DOM canvas；用 wx.createCanvas() 造真画布并把上下文交回，
      // 使 canvas.getContext("2d") 这类 DOM 写法的语义成立（S1 会把绘制接到同一批画布上）。
      try {
        if (typeof wx !== "undefined" && typeof wx.createCanvas === "function") {
          var c = wx.createCanvas();
          if (c && typeof c.getContext === "function") {
            el._canvas = c;
            el._ctx = c.getContext(type || "2d", attrs);
            return el._ctx;
          }
        }
      } catch (e) {}
      return null;
    };
    el.toDataURL = function () { return ""; };
    return el;
  }

  // ---------- document ----------
  // 🔴 判据必须锚「能力是否齐备」而不是「对象是否存在」：
  //    微信小游戏（IDE 模拟器）**自带一份部分实现的 document** —— 有 createElement，
  //    但没有 getElementById / querySelector（实测快照：doc=object, createElement=function,
  //    getElementById=undefined）。旧判据 `typeof G.document === "undefined"` 因此为假，
  //    整个桩被跳过 ⇒ 逻辑层里大量**顶层无保护**的 document.getElementById("x").addEventListener(…)
  //    直接 TypeError ⇒ 整包起不来（现象：控制台一条无消息堆栈 + 纯黑屏）。
  //    ⇒ 只**补齐缺失项**，不整体替换（保留宿主已有实现，如真实 createElement）。
  // ⚠️ 而且必须取「逻辑层实际看到的那个 document」：优先**裸标识符**——
  //    若宿主以模块参数注入 document，它与 globalThis.document 可能不是同一对象，
  //    只补 globalThis 等于白补（实测：flag 已置位、getById 仍是 undefined）。
  var WX_DOC = null;
  try { WX_DOC = (typeof document !== "undefined" && document) ? document : null; } catch (e) {}
  if (!WX_DOC) { try { WX_DOC = G.document || null; } catch (e) {} }
  var needDocPatch = !WX_DOC ||
    (typeof WX_DOC.getElementById !== "function") ||
    (typeof WX_DOC.querySelector !== "function") ||
    (typeof WX_DOC.createElement !== "function");
  try { G.__WX_SHIM_DOC_STEP__ = "needPatch=" + needDocPatch + "|bareEqGlobal=" + (WX_DOC === G.document); } catch (e) {}
  if (needDocPatch) {
    var docEl = makeElement("html");
    var headEl = makeElement("head");
    var bodyEl = makeElement("body");
    docEl.appendChild(headEl);
    docEl.appendChild(bodyEl);

    // ⚠️ DOM 查询必须返回「桩元素」而不是 null：
    //    逻辑/UI 层大量存在**顶层无保护**的 document.getElementById("x").addEventListener(…)
    //    （如 action-modal.js:194 的 bindActionModal），在浏览器里这些元素由 index.html 提供，
    //    返回 null 会在加载期直接 TypeError ⇒ 整包起不来。这里返回缓存桩元素以对齐浏览器事实，
    //    并打印一次性告警——避免「静默降级」难以察觉。
    var idCache = Object.create(null);
    var warnedIds = Object.create(null);
    function stubById(id) {
      var k = String(id);
      if (!idCache[k]) {
        idCache[k] = makeElement("div");
        idCache[k].id = k;
      }
      if (!warnedIds[k]) {
        warnedIds[k] = true;
        if (typeof console !== "undefined" && console.warn) console.warn('[shim] #' + k + " → 桩元素（DOM 层尚未接入，S1 由 Canvas 内核取代）");
      }
      return idCache[k];
    }

    // ⚠️ 绝不能写 G.document：浏览器/模拟器里 window.document 是 **getter-only**
    //    （实测 TypeError: Cannot set property document of #<Window> which has only a getter）。
    //    该文档对象本身可自由加属性（实测 assignable=yes）⇒ 只往它身上**补缺失方法**。
    if (!WX_DOC) WX_DOC = {};
    var D = WX_DOC;
    if (G.document !== D) { try { G.document = D; } catch (e) {} }
    var docDefaults = {
      nodeType: 9,
      documentElement: docEl,
      head: headEl,
      body: bodyEl,
      readyState: "complete",
      title: "",
      cookie: "",
      activeElement: bodyEl,
    };
    for (var dk in docDefaults) { try { if (!(dk in D) || D[dk] == null) D[dk] = docDefaults[dk]; } catch (e) {} }
    var docMethods = {
      createElement: makeElement,
      createElementNS: function (_ns, tag) { return makeElement(tag); },
      createTextNode: function (t) { return { nodeType: 3, textContent: String(t) }; },
      createDocumentFragment: function () { return makeElement("fragment"); },
      getElementById: stubById,
      getElementsByClassName: function () { return []; },
      getElementsByTagName: function () { return []; },
      querySelector: function (sel) {
        // 只对 #id 形式给桩（index.html 里确实有该元素）；其余按浏览器语义返回 null
        var m = /^#([\w-]+)$/.exec(String(sel || "").trim());
        return m ? stubById(m[1]) : null;
      },
      querySelectorAll: function () { return []; },
      addEventListener: function (t, fn) {
        var m = listeners.get(D) || {}; (m[t] = m[t] || []).push(fn); listeners.set(D, m);
      },
      removeEventListener: function () {},
      dispatchEvent: function () { return true; },
    };
    // ⚠️ 必须用 Object.defineProperty 在**对象自身**定义，不能写 `D[mk] = fn`：
    //    原型链上若存在同名 **getter-only** 访问器（实测 document 正是这种情况），
    //    普通赋值会走 set 语义 → 找不到 setter → 在非严格模式下**静默失败**（不抛错、也不生效）。
    //    自身 data property 不查原型 ⇒ 稳定生效。
    var __docFailed = [];
    for (var mk in docMethods) {
      if (typeof D[mk] === "function") continue;
      try {
        Object.defineProperty(D, mk, { value: docMethods[mk], writable: true, configurable: true, enumerable: false });
      } catch (e) {
        try { D[mk] = docMethods[mk]; } catch (e2) {}
      }
      if (typeof D[mk] !== "function") __docFailed.push(mk);
    }
    try { G.__WX_SHIM_DOC_STEP__ += "|done|getById=" + typeof D.getElementById + "|failed=[" + __docFailed.join(",") + "]|thisDocHas=" + Object.prototype.hasOwnProperty.call(D, "getElementById"); } catch (e) {}
  }

  // ---------- location（translator.js:23 会读 window.location.search）----------
  if (typeof G.location === "undefined") {
    G.location = { href: "https://wx-minigame/", protocol: "https:", host: "wx-minigame", hostname: "wx-minigame", pathname: "/", search: "", hash: "", origin: "https://wx-minigame", reload: function () {}, assign: function () {}, replace: function () {} };
  }
  if (!G.URLSearchParams) {
    G.URLSearchParams = function (s) {
      this._m = {};
      String(s || "").replace(/^\?/, "").split("&").forEach(function (kv) {
        if (!kv) return; var i = kv.indexOf("=");
        var k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
        try { this._m[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { this._m[k] = v; }
      }, this);
    };
    G.URLSearchParams.prototype.get = function (k) { return k in this._m ? this._m[k] : null; };
    G.URLSearchParams.prototype.has = function (k) { return k in this._m; };
    G.URLSearchParams.prototype.toString = function () { var m = this._m, o = []; for (var k in m) o.push(k + "=" + m[k]); return o.join("&"); };
  }

  // ---------- 其它浏览器全局 ----------
  if (typeof G.navigator === "undefined") {
    G.navigator = { userAgent: "WeChatMiniGame", platform: "wechat-minigame", language: "zh-CN", languages: ["zh-CN"], onLine: true, clipboard: null };
  }
  if (typeof G.performance === "undefined") G.performance = {};
  if (typeof G.performance.now !== "function") {
    G.performance.now = function () { return Date.now() - (G.__WX_T0__ || (G.__WX_T0__ = Date.now())); };
  }
  if (typeof G.requestAnimationFrame !== "function") {
    G.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(G.performance.now()); }, 16); };
    G.cancelAnimationFrame = function (id) { clearTimeout(id); };
  }
  if (typeof G.setTimeout !== "function" && typeof wx !== "undefined" && wx.setTimeout) {
    G.setTimeout = wx.setTimeout.bind(wx); G.clearTimeout = wx.clearTimeout.bind(wx);
  }
  if (typeof G.matchMedia !== "function") {
    G.matchMedia = function (q) { return { matches: false, media: q, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} }; };
  }
  if (typeof G.getComputedStyle !== "function") {
    G.getComputedStyle = function () { return { getPropertyValue: function () { return ""; }, width: "0px", height: "0px" }; };
  }
  if (typeof G.alert !== "function") { G.alert = function () {}; G.confirm = function () { return false; }; G.prompt = function () { return null; }; }

  // ---------- 观察器（空实现）----------
  // 逻辑层在顶层直接 new MutationObserver(…)（小游戏无此全局）。
  // 它们是纯观察器、不产生副作用 ⇒ 空实现语义安全。
  [["MutationObserver", "observe disconnect takeRecords"],
   ["IntersectionObserver", "observe unobserve disconnect takeRecords"],
   ["ResizeObserver", "observe unobserve disconnect"]].forEach(function (def) {
    var name = def[0];
    if (typeof G[name] === "function") return;
    var Ctor = function (cb) { this._cb = cb; this._targets = []; };
    def[1].split(" ").forEach(function (m) {
      Ctor.prototype[m] = function () { return m === "takeRecords" ? [] : undefined; };
    });
    G[name] = Ctor;
  });

  // ---------- window 事件总线 ----------
  // 逻辑层多处**在顶层无保护地**调用 window.addEventListener(…)
  // （persistence.js:2896/3173、runtime.js:113/122、shell-render.js:13/754/2747、
  //   translator.js:139、error-boundary.js:50 等）。小游戏全局对象上没有这套 API，
  //   缺了会在加载期直接 TypeError ⇒ 整个逻辑层起不来。
  if (typeof G.addEventListener !== "function") {
    var gListeners = Object.create(null);
    G.addEventListener = function (t, fn) { (gListeners[t] = gListeners[t] || []).push(fn); };
    G.removeEventListener = function (t, fn) {
      if (gListeners[t]) gListeners[t] = gListeners[t].filter(function (f) { return f !== fn; });
    };
    G.dispatchEvent = function (ev) {
      var t = ev && ev.type;
      (gListeners[t] || []).slice().forEach(function (fn) {
        try { fn(ev); } catch (e) { console.warn("[shim] window listener error", e); }
      });
      if (t === "error" && typeof G.onerror === "function") { try { G.onerror(ev); } catch (e) {} }
      return true;
    };
  }
  if (typeof G.CustomEvent !== "function") {
    G.CustomEvent = function (type, opts) {
      this.type = String(type);
      this.detail = opts && "detail" in opts ? opts.detail : null;
      this.bubbles = !!(opts && opts.bubbles);
      this.cancelable = !!(opts && opts.cancelable);
      this.defaultPrevented = false;
      this.target = null;
    };
    G.CustomEvent.prototype.preventDefault = function () {};
    G.CustomEvent.prototype.stopPropagation = function () {};
  }
  if (typeof G.Event !== "function") {
    G.Event = function (type, opts) {
      this.type = String(type);
      this.bubbles = !!(opts && opts.bubbles);
      this.cancelable = !!(opts && opts.cancelable);
      this.defaultPrevented = false;
      this.target = null;
    };
    G.Event.prototype.preventDefault = function () {};
    G.Event.prototype.stopPropagation = function () {};
  }

  // ---------- CanvasRenderingContext2D ----------
  // js/ui/planetary-render.js:5 在顶层给 CanvasRenderingContext2D.prototype 打 roundRect 补丁；
  // 小游戏没有这个全局。优先取小游戏真实 2D 上下文的原型构造器（这样补丁打在真对象上），
  // 取不到才退回桩类（保证加载期不抛错）。
  if (typeof G.CanvasRenderingContext2D !== "function") {
    var CtxCtor = null;
    try {
      if (typeof wx !== "undefined" && typeof wx.createCanvas === "function") {
        var _cv = wx.createCanvas();
        var _ctx = _cv && _cv.getContext && _cv.getContext("2d");
        if (_ctx) {
          var _proto = Object.getPrototypeOf(_ctx);
          if (_proto && typeof _proto.constructor === "function") CtxCtor = _proto.constructor;
        }
      }
    } catch (e) {}
    if (!CtxCtor) {
      CtxCtor = function CanvasRenderingContext2D() {};
      ("arc arcTo beginPath bezierCurveTo clearRect clip closePath drawImage ellipse fill fillRect fillText " +
       "lineTo moveTo putImageData quadraticCurveTo rect restore rotate save scale setTransform stroke " +
       "strokeRect strokeText translate createLinearGradient createRadialGradient createPattern " +
       "getImageData createImageData setLineDash getLineDash").split(" ").forEach(function (m) {
        CtxCtor.prototype[m] = function () { return m === "getLineDash" ? [] : undefined; };
      });
      CtxCtor.prototype.measureText = function () { return { width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }; };
    }
    G.CanvasRenderingContext2D = CtxCtor;
  }

  // ---------- localStorage：优先落到小游戏真实存储 ----------
  if (typeof G.localStorage === "undefined") {
    var mem = Object.create(null);
    var hasWx = typeof wx !== "undefined" && typeof wx.setStorageSync === "function";
    G.localStorage = {
      getItem: function (k) {
        if (hasWx) { try { var v = wx.getStorageSync("ls:" + k); return v === "" || v === undefined ? null : v; } catch (e) {} }
        return k in mem ? mem[k] : null;
      },
      setItem: function (k, v) {
        v = String(v);
        if (hasWx) { try { wx.setStorageSync("ls:" + k, v); return; } catch (e) {} }
        mem[k] = v;
      },
      removeItem: function (k) {
        if (hasWx) { try { wx.removeStorageSync("ls:" + k); return; } catch (e) {} }
        delete mem[k];
      },
      clear: function () { mem = Object.create(null); },
      key: function () { return null; },
      get length() { return Object.keys(mem).length; },
    };
  }
})();
