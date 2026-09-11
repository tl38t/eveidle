(function () {
  "use strict";
  var STORAGE_KEY = "deep-space-idle.locale";
  var supported = ["zh-CN", "zh-TW", "en-US"];
  function normalizeLocale(value) {
    var code = String(value || "").toLowerCase().replace(/_/g, "-");
    if (["tchinese", "zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(code)) return "zh-TW";
    if (["schinese", "zh-cn", "zh-sg", "zh-hans"].includes(code)) return "zh-CN";
    if (["english", "en", "en-us", "en-gb"].includes(code)) return "en-US";
    return value;
  }
  var queryLocale = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
  var steamLocale = normalizeLocale(window.STEAM_LOCALE || window.steamLanguage);
  var browserCode = String(navigator.language || "").toLowerCase();
  var browserLocale = browserCode.startsWith("en") ? "en-US" : (browserCode.includes("tw") ? "zh-TW" : "zh-CN");
  var storedLocale = "";
  try { storedLocale = normalizeLocale(localStorage.getItem(STORAGE_KEY) || ""); } catch (error) { /* sandboxed storage */ }
  var locale = supported.includes(queryLocale) ? queryLocale : (supported.includes(steamLocale) ? steamLocale : (supported.includes(storedLocale) ? storedLocale : browserLocale));
  var catalogs = { "en-US": window.I18N_CATALOG_EN || new Map(), "zh-TW": window.I18N_CATALOG_ZH_TW || new Map() };
  var catalog = new Map();
  var catalogSources = [];
  var originals = new WeakMap();
  var IDEOGRAPH = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  var ATTRIBUTES = ["title", "aria-label", "placeholder"];
  var translateCache = new Map();

  function setActiveCatalog() {
    catalog = catalogs[locale] || new Map();
    catalogSources = Array.from(catalog.keys()).filter(function (source) { return source.length >= 2 && !/[<>]/.test(source); }).sort(function (a, b) { return b.length - a.length; });
    translateCache.clear();
  }
  function skip(element) { return !element || /^(SCRIPT|STYLE|CODE|PRE)$/.test(element.tagName) || !!element.closest?.('#achievements-panel, [data-deferred-i18n]'); }
  function translateFromCatalog(text) {
    if (!IDEOGRAPH.test(text)) return text;
    if (translateCache.has(text)) return translateCache.get(text);
    var result = text;
    catalogSources.forEach(function (source) { if (result.includes(source)) result = result.split(source).join(catalog.get(source)); });
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
  function applyNav() { apply(document.body); document.documentElement.lang = locale; document.title = locale === "en-US" ? "Deep Space Idle" : "深空放置"; }
  function setLocale(next) {
    if (!supported.includes(next)) return;
    locale = next; setActiveCatalog();
    try { localStorage.setItem(STORAGE_KEY, next); } catch (error) { /* sandboxed storage */ }
    applyNav();
    var control = document.getElementById("setting-language"); if (control) control.value = locale;
    window.dispatchEvent(new CustomEvent("localechange", { detail: { locale: locale } }));
    var frame = document.getElementById("legion-starmap-frame"); if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: "deep-space-idle/locale", locale: locale }, "*");
  }
  setActiveCatalog();
  window.I18N = { getLocale: function () { return locale; }, setLocale: setLocale, t: function (key) { return locale === "zh-CN" ? key : (catalog.get(key) || key); } };
  document.addEventListener("DOMContentLoaded", function () {
    applyNav();
    var control = document.getElementById("setting-language");
    if (control) { control.value = locale; control.addEventListener("change", function () { setLocale(control.value); }); }
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
