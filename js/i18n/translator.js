(function () {
  "use strict";
  var STORAGE_KEY = "deep-space-idle.locale";
  var supported = ["zh-CN", "en-US"];
  var queryLocale = new URLSearchParams(window.location.search).get("lang");
  var steamLocale = window.STEAM_LOCALE || window.steamLanguage;
  var browserLocale = String(navigator.language || "").toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
  var locale = supported.includes(queryLocale) ? queryLocale : (steamLocale || localStorage.getItem(STORAGE_KEY) || browserLocale);
  if (!supported.includes(locale)) locale = "zh-CN";
  var catalog = window.I18N_CATALOG_EN || new Map();
  var originals = new WeakMap();
  var catalogSources = Array.from(catalog.keys()).filter(function (source) { return source.length >= 2 && !/[<>]/.test(source); }).sort(function (a, b) { return b.length - a.length; });
  var fragments = [
    ["\u672c\u7ae0\u5168\u90e8\u4efb\u52a1\u5df2\u5b8c\u6210\u3002", "All tasks in this chapter are complete."],
    ["\u70b9\u51fb\u4ece\u4ed3\u5e93\u9009\u62e9", "Click to select from storage"],
    ["\u76ee\u6807\u77ff\u5e26\uff1a", "Target Belt: "], ["\u7ecf\u9a8c\u5956\u52b1\uff1a", "XP Reward: "],
    ["\u6280\u80fd\u603b\u89c8", "Skill Overview"], ["\u84dd\u56fe\u5546\u5e97", "Blueprint Store"],
    ["\u52a8\u4f5c\u961f\u5217", "Action Queue"], ["\u589e\u5f3a\u5242\u69fd", "Booster Slot"],
    ["\u88c5\u8f7d\u589e\u5f3a\u5242", "Load Booster"], ["\u5f85\u88c5\u8f7d", "Ready to Load"],
    ["\u540e\u52e4", "Logistics"], ["\u672a\u5efa\u7acb", "Not Built"], ["\u9700\u8981", "Requires"],
    ["\u6781\u661f\u77ff\u5e26", "Pole Star Mineral Belt"], ["\u5e8f\u7ae0\u00b7\u767b\u8bb0", "Prologue · Registration"],
    ["\u5df2\u5b8c\u6210", "Completed"], ["\u6682\u65e0\u53ef\u7528\u4efb\u52a1", "No available tasks"],
    ["\u661f\u5e01", "Starcoin"], ["\u91c7\u77ff", "Mining"], ["\u8054\u76df", "Alliance"],
    ["\u94c1\u7845\u539f\u77ff\u5e26", "Iron-Silicon Ore Belt"], ["\u94c1\u7845\u539f\u77ff", "Iron-Silicon Ore"],
    ["\u8fdb\u884c\u4e2d", "In Progress"], ["\u8fd0\u884c\u4e2d", "Running"], ["\u6bcf\u6b21", "per cycle"]
  ];
  var navLabels = { blueprints: "Blueprint Store", cargo: "Cargo", hangar: "Hangar", station: "Station", legion: "Legion", alliance: "Alliance", research: "Research", queue: "Action Queue", statistics: "Statistics", leaderboard: "Leaderboard", mining: "Mining", gasHarvesting: "Gas Harvesting", refining: "Refining", shipEngineering: "Ship Engineering", equipmentEngineering: "Equipment Engineering", boosterEngineering: "Booster Manufacturing", combat: "Combat", planetary: "Planetary Industry", archaeology: "Archaeology", save: "Save Management", settings: "Settings" };

  function skip(element) { return !element || /^(SCRIPT|STYLE|CODE|PRE)$/.test(element.tagName) || !!element.closest?.('#achievements-panel, [data-deferred-i18n]'); }
  function translateFromCatalog(text) {
    var result = text;
    for (var i = 0; i < catalogSources.length; i++) {
      var source = catalogSources[i];
      if (result.indexOf(source) !== -1) result = result.split(source).join(catalog.get(source));
    }
    return result;
  }
  function translateText(node) {
    var parent = node.parentElement; if (skip(parent)) return;
    var raw = node.nodeValue || ""; var value = raw; var trimmed = raw.trim();
    if (!trimmed) return;
    if (!originals.has(node)) originals.set(node, raw);
    if (locale === "en-US") {
      var translated = catalog.get(trimmed) || translateFromCatalog(trimmed);
      value = raw.slice(0, raw.indexOf(trimmed)) + translated + raw.slice(raw.indexOf(trimmed) + trimmed.length);
    } else {
      value = originals.get(node) || raw;
    }
    if (value !== raw) node.nodeValue = value;
  }
  function apply(root) {
    if (!root) return;
    var elements = root.nodeType === 1 ? [root].concat(Array.from(root.querySelectorAll("*"))) : Array.from(root.querySelectorAll("*"));
    elements.forEach(function (element) { if (skip(element)) return; Array.from(element.childNodes).forEach(function (node) { if (node.nodeType === 3) translateText(node); }); });
    elements.forEach(function (element) { ["title", "aria-label", "placeholder"].forEach(function (attribute) { var value = element.getAttribute(attribute); if (!value) return; var translated = locale === "en-US" ? (catalog.get(value.trim()) || value) : value; if (locale === "en-US" && translated !== value) { if (!originals.has(element)) originals.set(element, {}); originals.get(element)[attribute] = value; } if (locale === "zh-CN" && originals.has(element) && originals.get(element)[attribute]) translated = originals.get(element)[attribute]; if (translated !== value) element.setAttribute(attribute, translated); }); });
  }
  function applyNav() { apply(document.body); document.documentElement.lang = locale; document.title = locale === "en-US" ? "Deep Space Idle" : "\u6df1\u7a7a\u653e\u7f6e"; document.querySelectorAll(".nav-item").forEach(function (item) { var key = item.dataset.page || item.dataset.skill || item.dataset.lvSkill; if (locale === "en-US" && navLabels[key]) item.dataset.originalLabel = item.dataset.originalLabel || item.textContent.trim(); }); }
  function setLocale(next) { if (!supported.includes(next)) return; locale = next; localStorage.setItem(STORAGE_KEY, next); applyNav(); var control = document.getElementById("setting-language"); if (control) control.value = locale; window.dispatchEvent(new CustomEvent("localechange", { detail: { locale: locale } })); var frame = document.getElementById("legion-starmap-frame"); if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: "deep-space-idle/locale", locale: locale }, "*"); }
  window.I18N = { getLocale: function () { return locale; }, setLocale: setLocale, t: function (key) { return locale === "en-US" ? (catalog.get(key) || key) : key; } };
  document.addEventListener("DOMContentLoaded", function () { applyNav(); var control = document.getElementById("setting-language"); if (control) { control.value = locale; control.addEventListener("change", function () { setLocale(control.value); }); } var observer = new MutationObserver(function (mutations) { if (locale !== "en-US") return; mutations.forEach(function (mutation) { if (mutation.type === "characterData") { apply(mutation.target.parentElement); } else { Array.from(mutation.addedNodes).forEach(function (node) { apply(node.nodeType === 1 ? node : node.parentElement); }); } }); }); observer.observe(document.body, { childList: true, characterData: true, subtree: true }); });
})();
