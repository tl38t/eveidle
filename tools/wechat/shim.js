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
    el.getContext = function () { return null; };
    el.toDataURL = function () { return ""; };
    return el;
  }

  // ---------- document ----------
  if (typeof G.document === "undefined") {
    var docEl = makeElement("html");
    var headEl = makeElement("head");
    var bodyEl = makeElement("body");
    docEl.appendChild(headEl);
    docEl.appendChild(bodyEl);

    var documentStub = {
      nodeType: 9,
      documentElement: docEl,
      head: headEl,
      body: bodyEl,
      readyState: "complete",
      title: "",
      cookie: "",
      activeElement: bodyEl,
      createElement: makeElement,
      createElementNS: function (_ns, tag) { return makeElement(tag); },
      createTextNode: function (t) { return { nodeType: 3, textContent: String(t) }; },
      createDocumentFragment: function () { return makeElement("fragment"); },
      getElementById: function () { return null; },
      getElementsByClassName: function () { return []; },
      getElementsByTagName: function () { return []; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      addEventListener: function (t, fn) {
        var m = listeners.get(documentStub) || {}; (m[t] = m[t] || []).push(fn); listeners.set(documentStub, m);
      },
      removeEventListener: function () {},
      dispatchEvent: function () { return true; },
    };
    G.document = documentStub;
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
