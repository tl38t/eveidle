(function () {
  "use strict";

  const STORAGE_KEY = "deep-space-idle.locale";
  const supported = ["zh-CN", "en-US"];
  const queryLocale = new URLSearchParams(window.location.search).get("lang");
  // Electron/Steam may inject either name from the Steamworks bridge.
  const steamLocale = window.STEAM_LOCALE || window.steamLanguage;
  const browserLocale = navigator.language && navigator.language.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
  let locale = supported.includes(queryLocale) ? queryLocale : (steamLocale || localStorage.getItem(STORAGE_KEY) || browserLocale);
  if (!supported.includes(locale)) locale = "zh-CN";

  const navLabels = {
    mining: "Mining", gasHarvesting: "Gas Harvesting", refining: "Refining",
    shipEngineering: "Ship Engineering", equipmentEngineering: "Equipment Engineering",
    boosterEngineering: "Booster Manufacturing", combat: "Combat",
    planetary: "Planetary Industry", archaeology: "Archaeology", save: "Save Management",
    settings: "Settings", statistics: "Statistics", achievements: "Achievements",
    leaderboard: "Leaderboard"
  };
  const skillLabels = {
    laserOps: "Laser Operations", cannonOps: "Turret Operations",
    missileOperations: "Missile Operations", targeting: "Targeting",
    shieldOperation: "Shield Operation", armorReinforcement: "Armor Reinforcement",
    hullEngineering: "Hull Engineering", piloting: "Piloting",
    capacitorManagement: "Capacitor Management", defense: "Defense"
  };
  const catalog = window.I18N_CATALOG_EN || new Map();

  function applyCatalog(root) {
    if (!root || locale !== "en-US") return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    for (const textNode of textNodes) {
      const parent = textNode.parentElement;
      if (!parent || /^(SCRIPT|STYLE|CODE|PRE)$/.test(parent.tagName)) continue;
      const raw = textNode.nodeValue;
      const trimmed = raw.trim();
      const translated = catalog.get(trimmed);
      if (translated && translated !== trimmed) {
        textNode.nodeValue = raw.slice(0, raw.indexOf(trimmed)) + translated + raw.slice(raw.indexOf(trimmed) + trimmed.length);
      }
    }
    root.querySelectorAll?.("[title], [aria-label], input[placeholder]").forEach((element) => {
      for (const attribute of ["title", "aria-label", "placeholder"]) {
        const value = element.getAttribute(attribute);
        const translated = value && catalog.get(value.trim());
        if (translated) element.setAttribute(attribute, translated);
      }
    });
  }

  function replaceFirstLabel(element, value) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.trim()) {
        node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(), value);
        return;
      }
    }
  }

  function applyNav() {
    applyCatalog(document.body);
    document.querySelectorAll(".nav-item").forEach((item) => {
      const key = item.dataset.page || item.dataset.skill || item.dataset.lvSkill;
      const label = navLabels[key] || skillLabels[item.dataset.lvSkill];
      if (!item.dataset.zhLabel) item.dataset.zhLabel = item.textContent.trim().split(/\s+Lv\./)[0];
      if (label) replaceFirstLabel(item, locale === "en-US" ? label : item.dataset.zhLabel);
    });
    document.documentElement.lang = locale;
    document.title = locale === "en-US" ? "Deep Space Idle" : "深空放置";
  }

  function bindSettingsControl() {
    const control = document.getElementById("setting-language");
    if (!control) return;
    control.value = locale;
    control.addEventListener("change", () => {
      locale = supported.includes(control.value) ? control.value : "zh-CN";
      localStorage.setItem(STORAGE_KEY, locale);
      applyNav();
      window.dispatchEvent(new CustomEvent("localechange", { detail: { locale } }));
    });
  }

  window.I18N = Object.freeze({
    getLocale: () => locale,
    setLocale: (next) => { if (supported.includes(next)) { locale = next; localStorage.setItem(STORAGE_KEY, next); applyNav(); } },
    t: (key, fallback) => fallback || key
  });

  document.addEventListener("DOMContentLoaded", () => {
    applyNav();
    bindSettingsControl();
    const observer = new MutationObserver((mutations) => {
      if (locale !== "en-US") return;
      for (const mutation of mutations) for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) applyCatalog(node);
        else if (node.nodeType === Node.TEXT_NODE) applyCatalog(node.parentElement);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
