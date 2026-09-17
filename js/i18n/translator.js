(function () {
  "use strict";
  var STORAGE_KEY = "deep-space-idle.locale";
  // de / ru 目录**仅 Steam（Electron）端**随包发布并由 index.html 条件注入。
  // 非 Steam 端（微信 / TapTap）不会加载这两个 <script>，全局不存在 ⇒ 不加入 supported，
  // 语言下拉也不出现，玩家无法选到，体积不受影响。
  var hasDe = !!window.I18N_CATALOG_DE;
  var hasRu = !!window.I18N_CATALOG_RU;
  var supported = ["zh-CN", "zh-TW", "en-US"].concat(hasDe ? ["de"] : []).concat(hasRu ? ["ru"] : []);
  function normalizeLocale(value) {
    var code = String(value || "").toLowerCase().replace(/_/g, "-");
    if (["tchinese", "zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(code)) return "zh-TW";
    if (["schinese", "zh-cn", "zh-sg", "zh-hans"].includes(code)) return "zh-CN";
    if (["english", "en", "en-us", "en-gb"].includes(code)) return "en-US";
    return value;
  }
  // Steam 界面语言已发行 5 种：简中 / 繁中 / 英文 / 德语 / 俄语，而客户端语言代码有近三十种。
  // 这 5 种做精确映射，其余（日、法、西……）一律收敛到英文——非中文玩家看英文远比看中文可读。
  // 不能沿用 normalizeLocale 的「未识别则原样返回」：那会让日语之类的代码一路落到
  // 浏览器语言的兜底分支上（非 en、非 tw 即判为 zh-CN）。
  // 德语 / 俄语目录只在 Steam 端随包发布；非 Steam 端 hasDe / hasRu 为假，
  // 这两个 code 不在 supported 里，会被下面的 supported.includes 挡掉并回落浏览器语言。
  function normalizeSteamLocale(value) {
    var code = String(value || "").toLowerCase().replace(/_/g, "-");
    if (!code) return "";
    if (["schinese", "zh-cn", "zh-sg", "zh-hans"].includes(code)) return "zh-CN";
    if (["tchinese", "zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(code)) return "zh-TW";
    if (["german", "de", "de-de", "de-at", "de-ch"].includes(code)) return "de";
    if (["russian", "ru", "ru-ru"].includes(code)) return "ru";
    return "en-US";
  }
  var queryLocale = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
  var steamLocale = normalizeSteamLocale(window.STEAM_LOCALE || window.steamLanguage);
  var browserCode = String(navigator.language || "").toLowerCase();
  var browserLocale = browserCode.startsWith("en") ? "en-US" : (browserCode.includes("tw") ? "zh-TW" : "zh-CN");
  var storedLocale = "";
  try { storedLocale = normalizeLocale(localStorage.getItem(STORAGE_KEY) || ""); } catch (error) { /* sandboxed storage */ }
  // 定序：URL 显式指定 > 玩家在设置里的手动选择 > Steam 客户端语言 > 浏览器语言。
  // 手动选择优先于 Steam：否则玩家在设置里切成英文，重启后又被客户端语言顶回中文。
  var locale = supported.includes(queryLocale) ? queryLocale : (supported.includes(storedLocale) ? storedLocale : (supported.includes(steamLocale) ? steamLocale : browserLocale));
  var catalogs = { "en-US": window.I18N_CATALOG_EN || new Map(), "zh-TW": window.I18N_CATALOG_ZH_TW || new Map() };
  if (hasDe) catalogs["de"] = window.I18N_CATALOG_DE;
  if (hasRu) catalogs["ru"] = window.I18N_CATALOG_RU;
  var catalog = new Map();
  var catalogSources = [];
  var originals = new WeakMap();
  var IDEOGRAPH = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  function cjkCount(s) { var m = String(s || "").match(/[\u3400-\u9FFF\uF900-\uFAFF]/g); return m ? m.length : 0; }
  var ATTRIBUTES = ["title", "aria-label", "placeholder"];
  var translateCache = new Map();
  var catalogUsesIdeographs = false;

  function setActiveCatalog() {
    catalog = catalogs[locale] || new Map();
    // 子串键应用顺序：汉字个数降序 → 字符长度降序。
    // 只按字符长度降序会让「跨词边界的片段键」压过正常词：
    //   "· 总"(3 字符/1 汉字) 先于 "总部"(2 字符/2 汉字) 被应用 ⇒ 总部 被切成 "total 部"。
    // 汉字数优先可保证「完整词恒优于片段键」，从根上消除这类切词。
    catalogSources = Array.from(catalog.keys()).filter(function (source) { return source.length >= 2 && !/[<>]/.test(source); }).sort(function (a, b) { return cjkCount(b) - cjkCount(a) || b.length - a.length; });
    // 目标目录的译文是否本身就是汉字（如 zh-TW）。是的话，子串替换属于「字形/用词转换」，
    // 不能按「中英混排」处理，否则会把合法的繁体输出回退成简体。
    catalogUsesIdeographs = false;
    catalog.forEach(function (value) { if (typeof value === "string" && IDEOGRAPH.test(value)) catalogUsesIdeographs = true; });
    translateCache.clear();
  }
  function skip(element) { return !element || /^(SCRIPT|STYLE|CODE|PRE)$/.test(element.tagName) || !!element.closest?.('#achievements-panel, [data-deferred-i18n]'); }
  function translateFromCatalog(text) {
    if (!IDEOGRAPH.test(text)) return text;
    if (translateCache.has(text)) return translateCache.get(text);
    var result = text;
    catalogSources.forEach(function (source) { if (result.includes(source)) result = result.split(source).join(catalog.get(source)); });
    // 半截替换（替换后仍残留汉字）宁可整段不译，避免出现中英混排的句子。
    // 仅对「译文不含汉字」的目录（如 en-US）生效：目录中不存在含汉字的英文译文，故不会误伤合法全译。
    // 译文本身是汉字的目录（如 zh-TW）走的是字形转换，不适用此回退。
    if (!catalogUsesIdeographs && result !== text && IDEOGRAPH.test(result)) result = text;
    translateCache.set(text, result);
    return result;
  }
  function translateText(node) {
    if (skip(node.parentElement)) return;
    var raw = node.nodeValue || "";
    var sourceRaw = originals.has(node) ? originals.get(node) : raw;
    if (locale === "zh-CN") { if (sourceRaw !== raw) node.nodeValue = sourceRaw; return; }
    var trimmed = sourceRaw.trim();
    if (!trimmed || !IDEOGRAPH.test(trimmed)) return;
    if (!originals.has(node)) originals.set(node, sourceRaw);
    var translated = catalog.get(trimmed) || translateFromCatalog(trimmed);
    var start = sourceRaw.indexOf(trimmed);
    var value = sourceRaw.slice(0, start) + translated + sourceRaw.slice(start + trimmed.length);
    if (value !== raw) node.nodeValue = value;
  }
  function translateAttributes(element) {
    if (skip(element)) return;
    ATTRIBUTES.forEach(function (attribute) {
      var value = element.getAttribute(attribute); if (!value) return;
      var saved = originals.has(element) ? originals.get(element) : {};
      var sourceValue = saved[attribute] || value;
      var translated = locale === "zh-CN" ? sourceValue : (catalog.get(sourceValue.trim()) || translateFromCatalog(sourceValue));
      if (locale !== "zh-CN" && translated !== value) { saved[attribute] = sourceValue; originals.set(element, saved); }
      if (translated !== value) element.setAttribute(attribute, translated);
    });
  }
  function apply(root) {
    if (!root) return;
    var elements = root.nodeType === 1 ? [root].concat(Array.from(root.querySelectorAll("*"))) : Array.from(root.querySelectorAll("*"));
    elements.forEach(function (element) { if (skip(element)) return; Array.from(element.childNodes).forEach(function (node) { if (node.nodeType === 3) translateText(node); }); });
    elements.forEach(translateAttributes);
  }
  // 窗口 / 标签页标题：中文两个 locale 用「深空放置」，英文用品牌英文名；
  // de / ru 取本语言目录里与游戏内顶栏左上角品牌名同源的那条键（保证「窗口标题 == 顶栏标题」），
  // 取不到时回落英文品牌名。document.documentElement.lang 直接写 locale 值，
  // "de" / "ru" / "en-US" / "zh-TW" 都是合法 BCP47 代码。
  var WINDOW_TITLES = { "zh-CN": "深空放置", "zh-TW": "深空放置", "en-US": "Deep Space Idle" };
  function applyNav() {
    apply(document.body);
    document.documentElement.lang = locale;
    document.title = WINDOW_TITLES[locale] || catalog.get("深空放置 · 边疆纪元") || "Deep Space Idle";
  }
  function broadcastLocale() {
    var frame = document.getElementById("legion-starmap-frame");
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: "deep-space-idle/locale", locale: locale }, "*");
  }
  // persist 仅在玩家于设置里主动选择时为真。平台（Steam）驱动与父页广播传入的
  // locale 不能落盘：那不是玩家的选择，一旦写进本地存储就会在下次启动时压过
  // Steam 语言，导致玩家改客户端语言后界面不再跟随。
  function setLocale(next, persist) {
    if (!supported.includes(next)) return;
    locale = next; setActiveCatalog();
    if (persist !== false) { try { localStorage.setItem(STORAGE_KEY, next); } catch (error) { /* sandboxed storage */ } }
    applyNav();
    var control = document.getElementById("setting-language"); if (control) control.value = locale;
    window.dispatchEvent(new CustomEvent("localechange", { detail: { locale: locale } }));
    broadcastLocale();
  }
  // 桌面壳（Steam）正常会由 preload 同步注入 window.STEAM_LOCALE，此处兜底
  // 「首帧拿不到语言」的情形：壳层的 Steam 初始化由游戏按需触发，可能晚于首帧，
  // 所以退避重试几次，等初始化完成后把界面切过去。
  function followPlatformLocale(attempt) {
    if (steamLocale) return;
    var bridge = window.SteamBridge;
    if (!bridge || typeof bridge.getLanguage !== "function") return;
    var tries = typeof attempt === "number" ? attempt : 0;
    Promise.resolve(bridge.getLanguage()).then(function (result) {
      var next = normalizeSteamLocale(result && result.language);
      if (!next) {
        // 空语言 = 壳层还没初始化完（或环境里根本没有 Steam）。有限次重试后放弃，
        // 保持当前语言，绝不因为平台信号缺失而卡住或反复重绘。
        if (tries < 4) window.setTimeout(function () { followPlatformLocale(tries + 1); }, 700);
        return;
      }
      if (!supported.includes(next)) return;
      steamLocale = next;
      var explicit = "";
      try { explicit = localStorage.getItem(STORAGE_KEY) || ""; } catch (error) { /* sandboxed storage */ }
      // 玩家在设置里的手动选择和 URL 显式指定都优先于平台语言。
      if (queryLocale || explicit || next === locale) return;
      setLocale(next, false);
    }).catch(function () { /* 壳层未提供语言时保持当前语言 */ });
  }
  setActiveCatalog();
  // iframe 子页拿不到 preload 注入的 STEAM_LOCALE（preload 只注入主 frame，
  // webPreferences 未开 nodeIntegrationInSubFrames），它按浏览器语言自算，
  // 所以启动后主动向父页请求一次真实语言。
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "deep-space-idle/locale-request") return;
    broadcastLocale();
  });
  window.I18N = {
    getLocale: function () { return locale; },
    setLocale: function (next, options) { setLocale(next, options && options.persist); },
    t: function (key) { return locale === "zh-CN" ? key : (catalog.get(key) || key); }
  };
  document.addEventListener("DOMContentLoaded", function () {
    applyNav();
    var control = document.getElementById("setting-language");
    if (control) {
      control.value = locale;
      // 仅当对应目录全局存在（即 Steam 端）才向语言下拉追加 de / ru 选项。
      if (window.I18N_CATALOG_DE) { var od = document.createElement("option"); od.value = "de"; od.textContent = "Deutsch"; control.appendChild(od); }
      if (window.I18N_CATALOG_RU) { var or = document.createElement("option"); or.value = "ru"; or.textContent = "Русский"; control.appendChild(or); }
      control.addEventListener("change", function () { setLocale(control.value); });
    }
    followPlatformLocale();
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === "characterData") translateText(mutation.target);
        else if (mutation.type === "attributes") translateAttributes(mutation.target);
        else Array.from(mutation.addedNodes).forEach(function (node) { if (node.nodeType === 1) apply(node); else if (node.nodeType === 3) translateText(node); });
      });
    });
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES, subtree: true });
  });
})();
