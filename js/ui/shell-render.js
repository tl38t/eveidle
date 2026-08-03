/* ================================================================
   应用外壳适配器：导航、仓库、LP商店、船坞与动作队列
   ================================================================ */

let currentPage = "skill";
let currentView = "mining";
let cargoFilter = "all";
let blueprintStoreCategory = "ships";
let orbitShipId = null;
let orbitSelectedIndex = null;

function showToast(message) {
  const existing = document.querySelector(".queue-toast"); if (existing) existing.remove();
  const toast = document.createElement("div"); toast.className = "offline-toast queue-toast"; toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
}

function getManagedPanels() {
  const ids = ["cargo-panel", "save-panel", "settings-panel", "statistics-panel", "achievements-panel", "planetary-panel", "archaeology-panel", "shipeng-panel", "equipeng-panel", "booster-panel", "queue-panel", "combat-panel", "hangar-panel", "station-panel", "blueprintstore-panel", "research-panel"];
  return ids.map(id => document.getElementById(id)).filter(Boolean);
}

function getGenericSkillPanels() {
  return [...document.querySelectorAll('.content > .panel:not(#cargo-panel):not(#save-panel):not(#settings-panel):not(#statistics-panel):not(#achievements-panel):not(#planetary-panel):not(#archaeology-panel):not(#shipeng-panel):not(#equipeng-panel):not(#booster-panel):not(#queue-panel):not(#combat-panel):not(#hangar-panel):not(#station-panel):not(#blueprintstore-panel):not(#research-panel)')];
}

function renderCombatSkillGroup() {
  const display = getSettingsDisplayState(gameState);
  const group = document.getElementById("combat-skill-group");
  const toggle = document.querySelector("[data-combat-toggle]");
  if (group) {
    group.classList.toggle("expanded", display.combatSkillsExpanded);
    group.ariaHidden = display.combatSkillsExpanded ? "false" : "true";
  }
  if (toggle) toggle.ariaExpanded = display.combatSkillsExpanded ? "true" : "false";
  return display.combatSkillsExpanded;
}

function renderCurrentNavigation() {
  const navigation = getNavigationDisplayState(currentPage, currentView);
  renderCombatSkillGroup();
  getManagedPanels().forEach(panel => { panel.style.display = "none"; });
  getGenericSkillPanels().forEach(panel => { panel.style.display = navigation.page === "skill" ? "" : "none"; });
  const skillCurrent = document.querySelector(".skill-current");
  if (skillCurrent) skillCurrent.style.display = navigation.showGenericSkill ? "" : "none";
  // 成就页 / 研究页 不改选择器契约（js/core/selectors.js 的 standalonePages 不动），
  // 由外壳层补独立页映射，其余显隐/高亮完全复用现有导航体系。
  const shellStandalonePanel = navigation.page === "achievements" ? "achievements-panel"
    : navigation.page === "research" ? "research-panel"
    : null;
  const panelId = navigation.standalonePanel || shellStandalonePanel || navigation.specializedSkillPanel;
  if (panelId) { const panel = document.getElementById(panelId); if (panel) panel.style.display = ""; }
  document.querySelectorAll(".sidebar .nav-item").forEach(item => item.classList.remove("active"));
  const activeSelector = navigation.activeNav.type === "skill" ? `.sidebar .nav-item[data-skill="${navigation.activeNav.value}"]` : `.sidebar .nav-item[data-page="${navigation.activeNav.value}"]`;
  const active = document.querySelector(activeSelector); if (active) active.classList.add("active");

  if (navigation.page === "skill") updateUI();
  else if (navigation.page === "cargo") renderCargoPage(cargoFilter);
  else if (navigation.page === "save") SaveManager._updateStatus("就绪");
  else if (navigation.page === "settings") renderSettingsPage();
  else if (navigation.page === "statistics") renderStatisticsPage();
  else if (navigation.page === "achievements") renderAchievementsPage();
  else if (navigation.page === "research") renderResearchPage();
  else if (navigation.page === "planetary") renderPlanetaryPage();
  else if (navigation.page === "archaeology") renderArchaeologyPage();
  else if (navigation.page === "queue") renderQueuePanel();
  else if (navigation.page === "combat") renderCombatPanel();
  else if (navigation.page === "hangar") renderHangarPanel();
  else if (navigation.page === "station") { renderStationPage(); }
  else if (navigation.page === "blueprints" || navigation.page === "lpstore") renderBlueprintStore();

  // 3D 层（ES module）通常晚于本函数首次执行才就绪：若尚未加载，
  // 注册一次性监听，待 ship3d:ready 后重渲当前页，补上 3D 内容。
  if (!window.Ship3D && !renderCurrentNavigation._ship3dPending) {
    renderCurrentNavigation._ship3dPending = true;
    window.addEventListener("ship3d:ready", function onReady() {
      window.removeEventListener("ship3d:ready", onReady);
      renderCurrentNavigation._ship3dPending = false;
      renderCurrentNavigation();
    }, { once: true });
  }
  // Batch P：每次页面切换（含 skill 页经 updateUI）都刷新引导小部件
  renderTutorialWidget();
}

function switchPage(page) {
  currentPage = page === "skill" ? "skill" : page;
  renderCurrentNavigation();
}

function switchSkill(skillKey) {
  currentPage = "skill";
  currentView = skillKey;
  renderCurrentNavigation();
}

function renderCargoPage(filter) {
  cargoFilter = filter || cargoFilter || "all";
  const display = getCargoDisplayState(gameState, cargoFilter);
  const capacity = document.getElementById("cargo-capacity-text"); if (capacity) capacity.textContent = "物资总量：" + display.total.toLocaleString();
  document.querySelectorAll(".cargo-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.filter === display.filter));
  const list = document.getElementById("cargo-list"); if (!list) return display;
  list.style.display = "";
  list.innerHTML = display.items.length ? display.items.map(item => `<div class="cargo-item${item.details ? " equipment-item" : ""}"${item.details ? ` title="${item.name}\n${item.details}"` : ""}><span class="ci-icon">${item.icon}</span><span class="ci-content"><span class="ci-name">${item.name}</span>${item.details ? `<span class="ci-details">${item.details}</span>` : ""}</span><span class="ci-qty">${item.quantity.toLocaleString()}</span></div>`).join("") : `<div class="cargo-empty">${display.emptyText}</div>`;
  renderEquipmentEnhancementList(display.filter === "equipment");
  return display;
}

function renderEquipmentEnhancementList(visible) {
  const panel = document.getElementById("equipment-enhancement-list"); if (!panel) return;
  if (!visible) { panel.style.display = "none"; panel.innerHTML = ""; return; }
  panel.style.display = "";
  const display = getEquipmentEnhancementListDisplayState(gameState);
  if (!display.entries.length) {
    panel.innerHTML = `<div class="cargo-empty">暂无可强化装备（制造或获取装备后将显示于此）</div>`;
    return;
  }
  const cardHtml = entry => {
    const instanceBlocks = entry.instanceCards.map(inst => {
      const cost = inst.costRows.map(r => `<span class="enh-cost${r.enough ? "" : " insufficient"}">${r.name} ${r.need}<small>(${r.stock})</small></span>`).join("");
      const extra = inst.extraRows.length ? `<div class="enh-extra">${inst.extraRows.map(r => `<span class="enh-cost${r.enough ? "" : " insufficient"}">${r.label} ×${r.need}<small>(${r.have})</small></span>`).join("")}</div>` : "";
      const milestoneTag = inst.isMilestone ? `<span class="enh-tag milestone">里程碑 Lv.${inst.level + 1}</span>` : "";
      return `<div class="enh-instance">
        <div class="enh-instance-head"><span class="enh-level">+${inst.level}</span><span class="enh-bonus">当前加成 +${inst.bonusPercent}%</span><span class="enh-preview">升级 → +${inst.previewBonusPercent}%</span>${milestoneTag}</div>
        <div class="enh-row"><span class="enh-label">成功率</span><span class="enh-success" title="基础${Math.round(inst.successBreakdown.base*100)}% · 技能加成+${Math.round(inst.successBreakdown.skillBonus*1000)/10}% · 强化惩罚−${Math.round(inst.successBreakdown.levelPenalty*1000)/10}% · 最终${inst.successPercent}%">${inst.successPercent}%</span></div>
        <div class="enh-costs">${cost}${extra}</div>
        <button class="btn primary enh-btn" data-enhance-target="${String(inst.instanceId)}" ${inst.canEnhance ? "" : "disabled"}>强化此件 (Lv.${inst.level} → ${inst.level + 1})</button>
      </div>`;
    }).join("");
    const stackBlock = entry.stack ? (() => {
      const disp = entry.stack;
      const cost = disp.costRows.map(r => `<span class="enh-cost${r.enough ? "" : " insufficient"}">${r.name} ${r.need}<small>(${r.stock})</small></span>`).join("");
      const extra = disp.extraRows.length ? `<div class="enh-extra">${disp.extraRows.map(r => `<span class="enh-cost${r.enough ? "" : " insufficient"}">${r.label} ×${r.need}<small>(${r.have})</small></span>`).join("")}</div>` : "";
      const milestoneTag = disp.isMilestone ? `<span class="enh-tag milestone">里程碑 Lv.1</span>` : "";
      return `<div class="enh-instance enh-stack">
        <div class="enh-instance-head"><span class="enh-level">库存新品 ×${disp.count}</span><span class="enh-preview">强化后 +${disp.previewBonusPercent}%</span>${milestoneTag}</div>
        <div class="enh-row"><span class="enh-label">成功率</span><span class="enh-success" title="基础${Math.round(disp.successBreakdown.base*100)}% · 技能加成+${Math.round(disp.successBreakdown.skillBonus*1000)/10}% · 强化惩罚−${Math.round(disp.successBreakdown.levelPenalty*1000)/10}% · 最终${disp.successPercent}%">${disp.successPercent}%</span></div>
        <div class="enh-costs">${cost}${extra}</div>
        <button class="btn primary enh-btn" data-enhance-target="${encodeURIComponent(disp.targetRef)}" ${disp.canEnhance ? "" : "disabled"}>强化一件 (+0 → +1)</button>
      </div>`;
    })() : "";
    const installedBlock = entry.installed.length ? `<div class="enh-installed">${entry.installed.map(inst => `<span class="enh-installed-line">🔒 已安装至 ${inst.shipName} (+${inst.level}) · 需先卸载</span>`).join("")}</div>` : "";
    return `<div class="enh-card">
      <div class="enh-card-head"><span class="enh-icon">${entry.icon}</span><span class="enh-name">${entry.name}</span><span class="enh-cat">${entry.categoryLabel}</span></div>
      ${instanceBlocks}${stackBlock}${installedBlock}
    </div>`;
  };
  panel.innerHTML = display.entries.map(cardHtml).join("");
  return display;
}

function renderBlueprintStore() {
  const display = getBlueprintStoreDisplayState(gameState, blueprintStoreCategory);
  const balance = document.getElementById("blueprintstore-balance");
  if (balance) balance.textContent = "可用星币（SC）：" + display.balance.isk.toLocaleString() + " · 功勋（MR）：" + display.balance.lp.toLocaleString();
  const tabs = document.getElementById("blueprintstore-tabs");
  if (tabs) tabs.innerHTML = display.categories.map(category => `<button class="blueprintstore-tab${category.selected ? " active" : ""}" data-blueprint-category="${category.id}"><i class="${category.icon}"></i><span>${category.name}</span><small>${category.count}</small></button>`).join("");
  const grid = document.getElementById("blueprintstore-grid"); if (!grid) return display;
  grid.innerHTML = display.items.map(item => `<div class="lpstore-card blueprint-preview-card${item.owned ? " owned" : ""}"><div class="lpstore-card-icon"><i class="${item.icon}"></i></div><div class="lpstore-card-info"><strong>${item.name}</strong><div class="blueprint-product"><span>可制造</span><b>${item.productName}</b></div><div class="blueprint-preview-lines">${item.previewLines.map(line => `<div><span>${line.label}</span><p>${line.value}</p></div>`).join("")}</div><small>${item.owned ? "永久蓝图已拥有" : "蓝图价格 · " + item.priceText}</small></div><button class="btn primary lpstore-buy" data-blueprint-item="${item.id}" data-blueprint-kind="${item.kind}" ${item.canBuy ? "" : "disabled"}>${item.purchaseText}</button></div>`).join("");
  return display;
}

function renderLPStore() { return renderBlueprintStore(); }

function renderSettingsPage() {
  const display = getSettingsDisplayState(gameState);
  const checkbox = document.getElementById("setting-enhancement-confirm");
  const status = document.getElementById("setting-enhancement-status");
  if (checkbox) checkbox.checked = display.confirmShipEnhancement;
  if (status) status.textContent = display.confirmShipEnhancement ? "已开启" : "已关闭";
  return display;
}

function formatStatisticValue(item) {
  const decimals = Number.isInteger(item.decimals) ? item.decimals : 0;
  const value = Number(item.value) || 0;
  return (item.prefix || "") + value.toLocaleString("zh-CN", { minimumFractionDigits:decimals, maximumFractionDigits:decimals }) + (item.suffix || "");
}

function renderStatisticsPage() {
  const display = getStatisticsDisplayState(gameState);
  const content = document.getElementById("statistics-content");
  if (!content) return display;
  const summaries = display.summaryGroups.map(group => `<section class="statistics-summary-card ${group.id}"><div class="statistics-card-title"><i class="${group.icon}"></i><span>${group.title}</span></div><div class="statistics-metric-grid">${group.items.map(item => `<div class="statistics-metric"><span>${item.label}</span><strong>${formatStatisticValue(item)}</strong></div>`).join("")}</div></section>`).join("");
  const details = display.detailGroups.map(group => `<section class="statistics-detail-card"><div class="statistics-card-title"><i class="${group.icon}"></i><span>${group.title}</span></div>${group.items.length ? `<div class="statistics-ranking">${group.items.map((item, index) => `<div class="statistics-rank-row"><span class="statistics-rank">${index + 1}</span><span class="statistics-rank-name">${item.name}</span><strong>${item.value.toLocaleString("zh-CN")}</strong></div>`).join("")}</div>` : `<div class="statistics-empty">${group.emptyText}</div>`}</section>`).join("");
  content.innerHTML = `<div class="statistics-note"><i class="fa-solid fa-circle-info"></i>${display.note}</div><div class="statistics-summary-grid">${summaries}</div><div class="statistics-detail-grid">${details}</div>`;
  return display;
}

/* ================================================================
   成就页面（成就系统 Batch D）
   —— 只读视图：目录来自 AchievementData，解锁事实来自
      gameState.achievements.unlockedAtById，本页不写状态、不触发解锁。
   ================================================================ */
const ACHIEVEMENT_TIER_ORDER = ["bronze", "silver", "gold", "legendary"];
const ACHIEVEMENT_STATUS_FILTERS = [
  { id: "all", label: "全部" },
  { id: "unlocked", label: "已解锁" },
  { id: "locked", label: "未解锁" }
];
const ACHIEVEMENT_HIDDEN_NAME = "隐藏成就";
const ACHIEVEMENT_HIDDEN_CONDITION = "达成条件未知";
let achievementCategoryFilter = "all";
let achievementStatusFilter = "all";

function escapeAchievementText(text) {
  const map = { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" };
  return String(text === null || text === undefined ? "" : text).replace(/[&<>"]/g, ch => map[ch]);
}

function getAchievementCatalogData() {
  const data = (typeof AchievementData !== "undefined" && AchievementData) ||
    (typeof window !== "undefined" && window.AchievementData) || null;
  return data && Array.isArray(data.ACHIEVEMENTS) ? data : null;
}

function getAchievementUnlockTimestamp(achievementId) {
  const map = typeof gameState !== "undefined" && gameState && gameState.achievements
    ? gameState.achievements.unlockedAtById : null;
  if (!map || typeof map !== "object") return null;
  const ts = map[achievementId];
  return (typeof ts === "number" && isFinite(ts) && ts >= 0) ? ts : null;
}

function formatAchievementUnlockTime(ms) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "";
  return new Date(ms).toLocaleString("zh-CN", { hour12:false });
}

// Batch E：成就奖励只读展示辅助（UI 纯读，绝不发放、不修改 state / 目录）。
// 奖励工时一律取自冻结目录 definition.reward，绝不按 tier 猜测。
const ACHIEVEMENT_NO_REWARD_TEXT = "无科研工时奖励";

function readAchievementRewardHours(definition) {
  if (!definition || typeof definition !== "object") return null;
  const reward = definition.reward;
  if (!reward || typeof reward !== "object" || Array.isArray(reward)) return null;
  if (reward.type !== "research-hours") return null;
  const hours = reward.hours;
  if (typeof hours !== "number" || !isFinite(hours) || hours <= 0) return null;
  return hours;
}

// 0.5 → "0.5"、1 → "1"、262 → "262"；非法值统一 "0"
function formatResearchHoursNumber(hours) {
  if (typeof hours !== "number" || !isFinite(hours) || hours <= 0) return "0";
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(2).replace(/\.?0+$/, "");
}

function formatAchievementRewardText(definition) {
  const hours = readAchievementRewardHours(definition);
  if (hours === null) return ACHIEVEMENT_NO_REWARD_TEXT;
  return "科研工时 +" + formatResearchHoursNumber(hours) + "h";
}

// 科研工时余额（秒 → 小时），只读 gameState.research.researchHourBank
function getResearchHourBankSeconds() {
  const research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : null;
  if (!research || typeof research !== "object") return 0;
  const bank = research.researchHourBank;
  if (typeof bank !== "number" || !isFinite(bank) || bank <= 0) return 0;
  return bank;
}

function getAchievementsDisplayState(category, status) {
  const data = getAchievementCatalogData();
  const selectedCategory = category || "all";
  const selectedStatus = ACHIEVEMENT_STATUS_FILTERS.some(item => item.id === status) ? status : "all";
  const bankSeconds = getResearchHourBankSeconds();
  const bankHours = bankSeconds / 3600;
  const researchBankText = "科研工时余额：" + formatResearchHoursNumber(bankHours) + " 小时";
  if (!data) {
    return { total:0, unlocked:0, percentValue:0, percentText:"0.0%", tiers:[], categories:[], statuses:[], cards:[], category:selectedCategory, status:selectedStatus,
      researchBankSeconds:bankSeconds, researchBankHours:bankHours, researchBankText };
  }
  const tiers = ACHIEVEMENT_TIER_ORDER.map(code => ({
    code, label:(data.TIERS && data.TIERS[code] ? data.TIERS[code].label : code), unlocked:0, total:0
  }));
  const tierByCode = {}; for (const tier of tiers) tierByCode[tier.code] = tier;
  const categoryCounts = {};
  const cards = [];
  let unlocked = 0;
  for (const definition of data.ACHIEVEMENTS) {
    const unlockedAt = getAchievementUnlockTimestamp(definition.id);
    const isUnlocked = unlockedAt !== null;
    if (isUnlocked) unlocked += 1;
    const tier = tierByCode[definition.tier];
    if (tier) { tier.total += 1; if (isUnlocked) tier.unlocked += 1; }
    categoryCounts[definition.category] = (categoryCounts[definition.category] || 0) + 1;
    // 未解锁的隐藏成就必须遮蔽名称与条件；解锁后原样揭示（placeholder 名称同样原样显示）
    const masked = Boolean(definition.hidden) && !isUnlocked;
    if (selectedCategory !== "all" && definition.category !== selectedCategory) continue;
    if (selectedStatus === "unlocked" && !isUnlocked) continue;
    if (selectedStatus === "locked" && isUnlocked) continue;
    cards.push({
      id: definition.id,
      category: definition.category,
      tier: definition.tier,
      tierLabel: definition.tierLabel,
      hidden: Boolean(definition.hidden),
      masked,
      unlocked: isUnlocked,
      unlockedAt,
      unlockedAtText: isUnlocked ? formatAchievementUnlockTime(unlockedAt) : "",
      name: masked ? ACHIEVEMENT_HIDDEN_NAME : definition.name,
      conditionText: masked ? ACHIEVEMENT_HIDDEN_CONDITION : definition.conditionText,
      // Batch E：奖励文字始终来自冻结目录 reward（隐藏成就也照常显示奖励，不遮蔽）
      rewardHours: readAchievementRewardHours(definition),
      rewardText: formatAchievementRewardText(definition)
    });
  }
  const total = data.ACHIEVEMENTS.length;
  const percentValue = total ? (unlocked / total) * 100 : 0;
  return {
    total, unlocked, percentValue,
    percentText: percentValue.toFixed(1) + "%",
    tiers,
    categories: [{ id:"all", label:"全部", count:total, selected:selectedCategory === "all" }].concat(
      (data.CATEGORIES || []).map(name => ({ id:name, label:name, count:categoryCounts[name] || 0, selected:selectedCategory === name }))
    ),
    statuses: ACHIEVEMENT_STATUS_FILTERS.map(item => ({ id:item.id, label:item.label, selected:selectedStatus === item.id })),
    cards,
    category: selectedCategory,
    status: selectedStatus,
    researchBankSeconds: bankSeconds,
    researchBankHours: bankHours,
    researchBankText
  };
}

function renderAchievementsPage(category, status) {
  achievementCategoryFilter = category === undefined ? achievementCategoryFilter : (category || "all");
  achievementStatusFilter = status === undefined ? achievementStatusFilter : (status || "all");
  const display = getAchievementsDisplayState(achievementCategoryFilter, achievementStatusFilter);
  achievementCategoryFilter = display.category;
  achievementStatusFilter = display.status;
  const count = document.getElementById("achievements-summary-count");
  if (count) count.textContent = display.unlocked + " / " + display.total;
  const percent = document.getElementById("achievements-summary-percent");
  if (percent) percent.textContent = display.percentText;
  const fill = document.getElementById("achievements-progress-fill");
  if (fill) fill.style.width = display.percentValue.toFixed(2) + "%";
  const tierBox = document.getElementById("achievements-tier-counts");
  if (tierBox) tierBox.innerHTML = display.tiers.map(tier => `<span class="ach-tier-count tier-${tier.code}"><b>${escapeAchievementText(tier.label)}</b><span>${tier.unlocked} / ${tier.total}</span></span>`).join("");
  const researchBank = document.getElementById("achievements-research-bank");
  if (researchBank) researchBank.textContent = display.researchBankText;
  const categoryTabs = document.getElementById("achievements-category-tabs");
  if (categoryTabs) categoryTabs.innerHTML = display.categories.map(item => `<button class="ach-tab${item.selected ? " active" : ""}" data-ach-category="${escapeAchievementText(item.id)}">${escapeAchievementText(item.label)}<small>${item.count}</small></button>`).join("");
  const statusTabs = document.getElementById("achievements-status-tabs");
  if (statusTabs) statusTabs.innerHTML = display.statuses.map(item => `<button class="ach-tab${item.selected ? " active" : ""}" data-ach-status="${escapeAchievementText(item.id)}">${escapeAchievementText(item.label)}</button>`).join("");
  const grid = document.getElementById("achievements-grid");
  if (!grid) return display;
  grid.innerHTML = display.cards.length ? display.cards.map(card => `<div class="ach-card ${card.unlocked ? "unlocked" : "locked"}${card.masked ? " masked" : ""} tier-${card.tier}" data-ach-id="${escapeAchievementText(card.id)}">
      <div class="ach-card-head"><span class="ach-card-id">${escapeAchievementText(card.id)}</span><span class="ach-card-tier tier-${card.tier}">${escapeAchievementText(card.tierLabel)}</span><span class="ach-card-cat">${escapeAchievementText(card.category)}</span><span class="ach-card-state">${card.unlocked ? "已解锁" : "未解锁"}</span></div>
      <div class="ach-card-name">${escapeAchievementText(card.name)}</div>
      <div class="ach-card-cond">${escapeAchievementText(card.conditionText)}</div>
      <div class="ach-card-reward">${escapeAchievementText(card.rewardText)}</div>
      <div class="ach-card-time">${card.unlocked ? "解锁于 " + escapeAchievementText(card.unlockedAtText) : "尚未达成"}</div>
    </div>`).join("") : `<div class="ach-empty">当前筛选条件下没有成就</div>`;
  return display;
}

// =========================================================================
// 研究系统页面（Batch F）：仅做纯读渲染 + 经 dispatchGameAction 转发操作。
//   渲染函数绝不调用 processResearchUntil，绝不修改 state.research。
// =========================================================================
function getResearchSystem() {
  return (typeof globalThis !== "undefined" && globalThis.ResearchSystem) ||
         (typeof window !== "undefined" && window.ResearchSystem) || null;
}
function getResearchData() {
  return (typeof globalThis !== "undefined" && globalThis.ResearchData) ||
         (typeof window !== "undefined" && window.ResearchData) || null;
}
function formatResearchHours(hours) {
  const h = Number(hours) || 0;
  if (h <= 0) return "0 小时";
  return formatResearchHoursNumber(h) + " 小时";
}
function formatResearchDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return h + "小时" + (m > 0 ? m + "分" : "");
  if (m > 0) return m + "分" + (sec > 0 ? sec + "秒" : "");
  return sec + "秒";
}
function formatResearchDateTime(ms) {
  const d = new Date(Number(ms) || Date.now());
  if (isNaN(d.getTime())) return "未知";
  const pad = (n) => String(n).padStart(2, "0");
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function researchReasonText(reason) {
  const map = {
    ALREADY_ACTIVE: "该研究已在进行中",
    ALREADY_QUEUED: "已加入队列",
    PREREQ_UNMET: "前置条件未满足",
    QUEUE_FULL: "队列已满（上限 20）",
    CAP_REACHED: "本步成就工时已达 50% 上限",
    INSUFFICIENT_BANK: "科研工时余额不足",
    NOTHING_ACTIVE: "当前没有进行中的研究",
    NOT_QUEUED: "队列中没有该项",
    INVALID_STEP_KEY: "无效的队列项标识",
    INVALID_STATE: "研究状态无效",
    ALREADY_COMPLETED: "该科技已完成",
    SKIP_LEVEL: "必须按顺序逐级研究",
    LEVEL_OUT_OF_RANGE: "等级超出范围",
    UNKNOWN_TECH: "未知科技",
    INVALID_HOURS: "投入工时无效",
    INVALID_ACTIVE: "当前研究状态异常",
    NO_RESEARCH_STATE: "研究系统未就绪",
    DURATION_UNAVAILABLE: "无法获取研究时长",
    "not-available": "研究系统未就绪",
    // 研究批次 I · 自动化协议稳定 reason
    UNKNOWN_PROTOCOL: "该协议尚未接入设置",
    PROTOCOL_LOCKED: "该协议尚未研究",
    INVALID_ENABLED: "开关参数无效",
    UNKNOWN_DEPLOYMENT: "未找到该行星基地",
    INVALID_RESERVE: "最低星币储备必须是不小于 0 的数字",
    ALREADY_SET: "设置未发生变化",
    PROTOCOL_DISABLED: "该协议未启用",
    RESERVE_NOT_MET: "低于最低星币储备，已跳过",
    INSUFFICIENT_ISK: "星币不足",
    NOTHING_TO_PROCESS: "当前没有可自动处理的内容",
    // 研究批次 J · autoenh / autorepair 稳定 reason
    INVALID_MAX_ATTEMPTS: "最大尝试次数必须是 0–10000 的整数",
    UNKNOWN_SHIP: "未找到该舰船实例",
    SHIP_ACTIVE: "该舰船正处于活动中，无法强化",
    ENHANCEMENT_UNAVAILABLE: "该舰船当前不可强化",
    INSUFFICIENT_COMPONENTS: "强化部件不足，已停止",
    MAX_ATTEMPTS_REACHED: "已达到设定的最大尝试次数",
    GUARD_REACHED: "已达到安全上限，已停止",
    NO_ARCHAEOLOGY_SHIP: "未指派考古舰船",
    NO_REPAIRERS: "考古舰船未安装维修装备",
    FULL_HP: "舰船已满血，无需维修",
    INSUFFICIENT_FUEL: "维修燃料不足，已停止",
    // 研究批次 K · intship 一体化造船稳定 reason（5 个复用 Batch I + 14 个新增）
    INVALID_QUANTITY: "造船数量必须是 1–1000 的整数",
    UNKNOWN_RECIPE: "未找到该舰船装配配方",
    BLUEPRINT_LOCKED: "未获得该舰船蓝图",
    LEVEL_LOCKED: "舰船工程等级不足",
    SHIPYARD_LOCKED: "船坞等级不足，无法总装该舰船",
    ACTION_BUSY: "当前有进行中的制造动作",
    JOB_ALREADY_ACTIVE: "已有一个进行中的造船作业",
    NO_ACTIVE_JOB: "当前没有造船作业",
    JOB_NOT_RESUMABLE: "该作业当前状态不可续作",
    JOB_COMPLETED: "该造船作业已完成",
    JOB_CANCELLED: "该造船作业已取消",
    INSUFFICIENT_MATERIALS: "缺口材料不足，无法开工",
    PREEMPTED: "制造动作被抢占，作业已中断",
    RECOVERY_REQUIRED: "作业与存档不一致，已冻结；请取消后重新发起",
    START_FAILED: "启动制造动作失败",
  };
  return map[reason] || ("操作失败：" + (reason || "unknown"));
}

// 节点状态：completed / active / queued / available / locked（只读 research）
function getNodeResearchState(node, projected, research) {
  const maxLevel = node.maxLevel;
  const completed = Number(research.completedLevels && research.completedLevels[node.id]) || 0;
  const ar = research.activeResearch;
  const activeLevel = (ar && typeof ar === "object" && !Array.isArray(ar) && ar.techId === node.id) ? ar.targetLevel : 0;
  const nextTarget = activeLevel || (completed + 1);
  let status;
  if (completed >= maxLevel) status = "completed";
  else if (activeLevel) status = "active";
  else {
    const queuedKey = node.id + "@" + (completed + 1);
    if (Array.isArray(research.pendingQueue) && research.pendingQueue.includes(queuedKey)) status = "queued";
    else {
      let prereqMet = true;
      for (const p of node.prerequisites || []) {
        if ((Number(projected[p.id]) || 0) < p.level) { prereqMet = false; break; }
      }
      status = prereqMet ? "available" : "locked";
    }
  }
  return { status, completed, activeLevel, nextTarget, maxLevel };
}

// 取消研究的真实退款秒数：cancelResearch 退还的是 appliedAchievementSeconds
//（受系统层既有的 50% 合法夹紧），与 capLeft「剩余可投入额度」是两个完全不同的量。
function computeResearchRefundSeconds(research) {
  if (!research || typeof research !== "object") return 0;
  const ar = research.activeResearch;
  if (!ar || typeof ar !== "object" || Array.isArray(ar)) return 0;
  const applied = Math.max(0, Number(ar.appliedAchievementSeconds) || 0);
  const capTotal = Math.max(0, (Number(ar.baseDuration) || 0) * 0.5);
  return Math.min(applied, capTotal);
}

function computeMaxApplyHours(research) {
  if (!research || typeof research !== "object") return 0;
  const ar = research.activeResearch;
  if (!ar || typeof ar !== "object" || Array.isArray(ar)) return 0;
  const bankSeconds = Math.max(0, Number(research.researchHourBank) || 0);
  const remaining = Math.max(0, Number(ar.remainingSeconds) || 0);
  const capTotal = (Number(ar.baseDuration) || 0) * 0.5;
  const applied = Math.max(0, Number(ar.appliedAchievementSeconds) || 0);
  const capLeft = Math.max(0, capTotal - applied);
  return Math.min(bankSeconds, remaining, capLeft) / 3600;
}

function renderResearchActive(research, RS) {
  const el = document.getElementById("research-active");
  const fill = document.getElementById("research-progress-fill");
  if (!el) return;
  const ar = research.activeResearch;
  if (!ar || typeof ar !== "object" || Array.isArray(ar)) {
    el.innerHTML = "";
    if (fill) fill.style.width = "0%";
    return;
  }
  const node = RS && RS.getResearchNode ? RS.getResearchNode(ar.techId) : null;
  const name = node ? node.name : ar.techId;
  const progress = RS && RS.getResearchProgress ? RS.getResearchProgress(gameState) : null;
  const ratio = progress && typeof progress.ratio === "number" ? progress.ratio : 0;
  const pct = Math.round(ratio * 100);
  const remainingText = formatResearchDuration(ar.remainingSeconds);
  const etaText = formatResearchDateTime(Date.now() + (Number(ar.remainingSeconds) || 0) * 1000);
  const base = Number(ar.baseDuration) || 0;
  const capTotal = base * 0.5;
  const applied = Math.max(0, Number(ar.appliedAchievementSeconds) || 0);
  const capLeft = Math.max(0, capTotal - applied);
  const maxHours = computeMaxApplyHours(research);
  if (fill) fill.style.width = pct + "%";
  el.innerHTML =
    '<div class="research-active-detail" id="research-active-name"><b>' + escapeAchievementText(name) + '</b> · 目标等级 ' + ar.targetLevel + '</div>' +
    '<div class="research-active-detail" id="research-active-progress">进度：' + pct + '% ｜ 剩余 ' + escapeAchievementText(remainingText) + ' ｜ 预计完成 ' + escapeAchievementText(etaText) + '</div>' +
    '<div class="research-active-detail" id="research-active-applied">本步已用成就工时：' + formatResearchHours(applied / 3600) + ' ｜ 50% 上限 ' + formatResearchHours(capTotal / 3600) + ' ｜ 剩余可投入 ' + formatResearchHours(capLeft / 3600) + '</div>' +
    '<div class="research-active-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">' +
      '<button class="research-btn" data-active-action="apply" data-hours="0.5">投入 0.5h</button>' +
      '<button class="research-btn" data-active-action="apply" data-hours="1">投入 1h</button>' +
      '<button class="research-btn" data-active-action="apply" data-hours="4">投入 4h</button>' +
      '<button class="research-btn primary" id="research-active-btn-max" data-active-action="apply" data-hours="max">最大可用（' + formatResearchHours(maxHours) + '）</button>' +
      // 退款口径 = appliedAchievementSeconds（cancelResearch 的真实退款），不是 capLeft
      '<button class="research-btn danger" id="research-active-btn-cancel" data-active-action="cancel">取消（退还 ' + formatResearchHours(computeResearchRefundSeconds(research) / 3600) + '）</button>' +
    '</div>';
}

// =========================================================================
// 文明6式横向科技树（Batch F 视觉返修）
//   布局/连线/状态全部由 ResearchData.NODES + gameState.research 动态推导，
//   原型 tools/research-tree-civ6.html 只提供视觉与绘图算法，不提供任何数据。
//   只硬编码「时代序号 / 时代名称 / 时代配色」，时代内的节点清单一律动态分组。
// =========================================================================
const RESEARCH_ERA_META = [
  { index: 0, label: "时代 I", sub: "基础科学", color: "#2a4a7a" },
  { index: 1, label: "时代 II", sub: "应用科学", color: "#2a6a4a" },
  { index: 2, label: "时代 III", sub: "工程学", color: "#6a5a2a" },
  { index: 3, label: "时代 IV", sub: "尖端科技", color: "#6a2a4a" },
  { index: 4, label: "时代 V", sub: "协议与集成", color: "#4a2a6a" }
];
const RT_LAYOUT = { COL_X0: 20, COL_W: 280, BOX_W: 204, BOX_H: 76, TOP: 98, ROW_H: 88, PAD_B: 28 };
const RESEARCH_STATUS_LABEL = { completed: "已完成", active: "研究中", queued: "已排队", available: "可研究", locked: "前置未满足" };
const RESEARCH_EDGE_ARROW = { met: "#3fd0c0", projected: "#4a8ed6", unmet: "#3a4a5e" };
const RESEARCH_CATEGORY_LABEL = {
  protocol: "协议", foundation: "基础", industry: "工业", combat: "战斗",
  archaeology: "考古", manufacturing: "制造", logistics: "后勤", planetary: "行星", ship: "舰船"
};

// 纯读模型：不写 gameState，不调用 processResearchUntil。
function buildResearchTreeModel(research, RD, RS) {
  const catalog = (RD && Array.isArray(RD.NODES)) ? RD.NODES : [];
  const L = RT_LAYOUT;
  const projected = (RS && RS.buildProjectedResearchLevels) ? RS.buildProjectedResearchLevels(gameState) : (research.completedLevels || {});
  const completedLevels = research.completedLevels || {};
  const queue = Array.isArray(research.pendingQueue) ? research.pendingQueue : [];
  const rowCursor = {};
  const viewById = {};
  const nodes = [];
  // 同时代内严格保持 ResearchData.NODES 的原始顺序
  for (const node of catalog) {
    const era = Number(node.era) || 0;
    const row = rowCursor[era] || 0;
    rowCursor[era] = row + 1;
    const st = getNodeResearchState(node, projected, research);
    const isProtocol = node.type === "protocol" || node.category === "protocol";
    const isSingle = !isProtocol && node.maxLevel === 1;
    const levelMarks = [];
    if (!isProtocol && node.maxLevel > 1) {
      const done = Number(completedLevels[node.id]) || 0;
      for (let lv = 1; lv <= node.maxLevel; lv += 1) {
        if (lv <= done) levelMarks.push("filled");
        else if (st.activeLevel === lv) levelMarks.push("active");
        else if (queue.indexOf(node.id + "@" + lv) >= 0) levelMarks.push("queued");
        else levelMarks.push("empty");
      }
    }
    const nextDuration = (RS && RS.getResearchDuration && st.nextTarget <= node.maxLevel)
      ? RS.getResearchDuration(node.id, st.nextTarget) : null;
    const effects = Array.isArray(node.effects) ? node.effects : [];
    const view = {
      id: node.id,
      name: node.name,
      era,
      row,
      x: L.COL_X0 + era * L.COL_W + (L.COL_W - L.BOX_W) / 2,
      y: L.TOP + row * L.ROW_H,
      type: node.type,
      category: node.category,
      status: st.status,
      statusLabel: RESEARCH_STATUS_LABEL[st.status] || st.status,
      completed: st.completed,
      activeLevel: st.activeLevel,
      nextTarget: st.nextTarget,
      maxLevel: node.maxLevel,
      isProtocol,
      isSingle,
      levelMarks,
      nextDurationSeconds: (nextDuration != null && isFinite(nextDuration)) ? nextDuration : null,
      shortEffect: effects.length ? String(effects[Math.min(Math.max(st.nextTarget, 1) - 1, effects.length - 1)]) : ""
    };
    viewById[node.id] = view;
    nodes.push(view);
  }
  // 连线：逐节点逐前置动态生成，边数恒等于 Σ node.prerequisites.length
  const edges = [];
  for (const node of catalog) {
    for (const prereq of (node.prerequisites || [])) {
      const from = viewById[prereq.id];
      const to = viewById[node.id];
      if (!from || !to) continue;
      const realLevel = Number(completedLevels[prereq.id]) || 0;
      const projLevel = Number(projected[prereq.id]) || 0;
      const state = realLevel >= prereq.level ? "met" : (projLevel >= prereq.level ? "projected" : "unmet");
      const sx = from.x + L.BOX_W;
      const sy = from.y + L.BOX_H / 2;
      const tx = to.x - 10;
      const ty = to.y + L.BOX_H / 2;
      const dx = tx - sx;
      // 跨时代正向走平滑贝塞尔；同列/回折时改用固定外扩控制点，避免线穿过节点正文
      const c1x = dx > 24 ? sx + dx * 0.45 : sx + 52;
      const c2x = dx > 24 ? tx - dx * 0.45 : tx - 52;
      edges.push({
        from: prereq.id,
        to: node.id,
        requiredLevel: prereq.level,
        state,
        path: "M " + sx + " " + sy + " C " + c1x + " " + sy + ", " + c2x + " " + ty + ", " + tx + " " + ty
      });
    }
  }
  const eras = RESEARCH_ERA_META.map(meta => ({
    index: meta.index, label: meta.label, sub: meta.sub, color: meta.color, count: rowCursor[meta.index] || 0
  }));
  let maxRows = 1;
  for (const era of eras) if (era.count > maxRows) maxRows = era.count;
  return {
    nodes,
    edges,
    eras,
    maxRows,
    width: L.COL_X0 * 2 + RESEARCH_ERA_META.length * L.COL_W,
    height: L.TOP + maxRows * L.ROW_H + L.PAD_B
  };
}

// 罗马数字：用于 EVE 风格的等级显示（1=I, 2=II, 3=III, 4=IV, 5=V）
function toRoman(num) {
  if (!Number.isInteger(num) || num <= 0) return "";
  const romans = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return romans[num - 1] || String(num);
}

function renderResearchNodeHtml(view) {
  const L = RT_LAYOUT;
  let cls = "rt-node rt-node--" + view.status;
  if (view.isProtocol) cls += " rt-node--protocol";
  let badge = "";
  if (view.isProtocol) badge = '<span class="rt-badge rt-badge--protocol">协议</span>';
  else if (view.isSingle) badge = '<span class="rt-badge rt-badge--single">单级</span>';
  let flag = "";
  if (view.status === "active") flag = '<span class="rt-flag rt-flag--active">研究中</span>';
  else if (view.status === "queued") flag = '<span class="rt-flag rt-flag--queued">已排队</span>';
  const pips = view.levelMarks.length
    ? '<div class="rt-node-pips">' + view.levelMarks.map(m => '<span class="rt-pip rt-pip--' + m + '"></span>').join("") + '</div>'
    : "";
  const levelText = view.isProtocol ? "协议 · " + view.completed + "/" + view.maxLevel
    : (view.isSingle ? "单级 · " + view.completed + "/" + view.maxLevel : "Lv." + view.completed + "/" + view.maxLevel);
  // 节点名称后缀规则：
  // - 单级/协议节点永远不加罗马数字（它们只有一级）
  // - 五级节点追加真实已完成等级；未完成时 completed=0 不追加，避免提前显示目标等级
  const showRomanSuffix = !view.isSingle && !view.isProtocol && view.completed >= 1;
  const nameSuffix = showRomanSuffix ? " " + toRoman(view.completed) : "";
  return '<div class="' + cls + '"' +
    ' style="left:' + view.x + 'px;top:' + view.y + 'px;width:' + L.BOX_W + 'px;height:' + L.BOX_H + 'px;"' +
    ' data-tech-id="' + escapeAchievementText(view.id) + '"' +
    ' data-era="' + view.era + '"' +
    ' data-status="' + escapeAchievementText(view.status) + '"' +
    ' role="button" tabindex="0"' +
    ' title="' + escapeAchievementText(view.name + nameSuffix + " · " + view.statusLabel) + '">' +
    badge + flag +
    '<div class="rt-node-name">' + escapeAchievementText(view.name + nameSuffix) + '</div>' +
    '<div class="rt-node-sub">' + escapeAchievementText(levelText + " ｜ " + view.statusLabel) + '</div>' +
    '<div class="rt-node-eff">' + escapeAchievementText(view.shortEffect) + '</div>' +
    pips +
  '</div>';
}

function renderResearchTree(model) {
  const el = document.getElementById("research-tree");
  if (!el) return;
  if (!model || !model.nodes.length) { el.innerHTML = ""; return; }
  const L = RT_LAYOUT;
  const bands = model.eras.map(era =>
    '<div class="rt-era-band" style="left:' + (L.COL_X0 + era.index * L.COL_W) + 'px;width:' + (L.COL_W - 8) + 'px;height:' + model.height + 'px;"></div>'
  ).join("");
  const heads = model.eras.map(era =>
    '<div class="rt-era-head" style="left:' + (L.COL_X0 + era.index * L.COL_W) + 'px;top:8px;width:' + (L.COL_W - 8) + 'px;background:' + era.color + ';">' +
      escapeAchievementText(era.sub) +
    '</div>'
  ).join("");
  const defs = '<defs>' + ["met", "projected", "unmet"].map(state =>
    '<marker id="rt-arrow-' + state + '" markerWidth="9" markerHeight="9" refX="0" refY="4.5" orient="auto">' +
      '<path d="M0,0 L9,4.5 L0,9 Z" fill="' + RESEARCH_EDGE_ARROW[state] + '"></path>' +
    '</marker>'
  ).join("") + '</defs>';
  const paths = model.edges.map(edge =>
    '<path class="rt-edge rt-edge--' + edge.state + '" d="' + edge.path + '"' +
      ' data-from="' + escapeAchievementText(edge.from) + '"' +
      ' data-to="' + escapeAchievementText(edge.to) + '"' +
      ' data-required-level="' + edge.requiredLevel + '"' +
      ' marker-end="url(#rt-arrow-' + edge.state + ')"></path>'
  ).join("");
  el.innerHTML =
    '<div class="rt-stage" style="width:' + model.width + 'px;height:' + model.height + 'px;">' +
      bands +
      '<svg class="rt-edges" width="' + model.width + '" height="' + model.height + '" viewBox="0 0 ' + model.width + ' ' + model.height + '" aria-hidden="true">' +
        defs + paths +
      '</svg>' +
      heads +
      model.nodes.map(renderResearchNodeHtml).join("") +
    '</div>';
}

// ---- 研究批次 I / J / K：已完成协议节点的配置面板（纯读 getResearchProtocolDisplayState，绝不修改 state） ----
// 已实装的 planauto / autosell / autoconv / autoenh / autorepair / intship 六个协议渲染开关与设置；
// 六个协议均已实装，不再有"协议业务尚未接入"。
function renderResearchProtocolPanelHtml(display) {
  if (!display || !display.implemented) {
    return '<div class="rt-d-hint research-protocol-hint">协议业务尚未接入</div>';
  }
  const enabled = display.enabled === true;
  const parts = [];
  parts.push('<div class="rt-d-lab">协议设置</div>');
  parts.push(
    '<div class="research-protocol-row">' +
      '<span class="research-protocol-status">总开关 ｜ ' + escapeAchievementText(display.statusText) + '</span>' +
      '<button class="research-btn' + (enabled ? " danger" : " primary") + '" type="button"' +
        ' data-detail-action="protocol-toggle"' +
        ' data-protocol-id="' + escapeAchievementText(display.protocolId) + '"' +
        ' data-protocol-enabled="' + (enabled ? "false" : "true") + '">' +
        (enabled ? "关闭协议" : "启用协议") +
      '</button>' +
    '</div>'
  );
  if (display.scopeText) {
    parts.push('<div class="rt-d-hint research-protocol-scope">' + escapeAchievementText(display.scopeText) + '</div>');
  }
  if (display.protocolId === "planauto") {
    parts.push('<div class="rt-d-lab">行星基地（逐个独立配置）</div>');
    const deployments = Array.isArray(display.deployments) ? display.deployments : [];
    if (!deployments.length) {
      parts.push('<div class="rt-d-row">当前没有行星基地</div>');
    } else {
      parts.push(deployments.map(dep => {
        const on = dep.autoRenewEnabled === true;
        const idAttr = escapeAchievementText(String(dep.deploymentId));
        const timeText = (dep.running ? "到期时间 " : "已到期于 ") + formatAchievementUnlockTime(dep.expiresAt);
        const metaText = "续期费用 " + Math.round(Number(dep.renewCostISK) || 0).toLocaleString("zh-CN") +
          " 星币 ｜ 自动续期：" + (on ? "已开启" : "已关闭");
        return '<div class="research-protocol-planet" data-deployment-row="' + idAttr + '" data-deployment-current="' + (on ? "true" : "false") + '">' +
          '<div class="research-protocol-planet-head">' +
            escapeAchievementText((dep.planetIcon ? dep.planetIcon + " " : "") + dep.planetName + " ｜ " + dep.statusText + " ｜ " + timeText) +
          '</div>' +
          '<div class="research-protocol-planet-meta">' + escapeAchievementText(metaText) + '</div>' +
          '<div class="research-protocol-planet-ctrl">' +
            '<button class="research-btn' + (on ? " danger" : "") + '" type="button"' +
              ' data-detail-action="planauto-toggle" data-deployment-id="' + idAttr + '"' +
              ' data-deployment-enabled="' + (on ? "false" : "true") + '">' +
              (on ? "关闭自动续期" : "开启自动续期") +
            '</button>' +
            '<label class="research-protocol-reserve-label">最低星币储备' +
              '<input class="research-protocol-reserve" type="number" min="0" step="1" value="' +
                escapeAchievementText(String(Number(dep.minIskReserve) || 0)) + '" data-protocol-reserve>' +
            '</label>' +
            '<button class="research-btn" type="button" data-detail-action="planauto-reserve" data-deployment-id="' + idAttr + '">保存储备</button>' +
          '</div>' +
        '</div>';
      }).join(""));
    }
  } else if (display.protocolId === "autoenh") {
    parts.push('<div class="rt-d-lab">自动强化设置</div>');
    parts.push(
      '<div class="research-protocol-row research-protocol-autoenh" data-autoenh-panel="' + (enabled ? "1" : "0") + '">' +
        '<label class="research-protocol-reserve-label">最大尝试次数（0 = 持续到部件不足）' +
          '<input class="research-protocol-reserve research-protocol-max" type="number" min="0" max="10000" step="1" value="' +
            escapeAchievementText(String(Number(display.maxAttempts) || 0)) + '" data-protocol-max>' +
        '</label>' +
        '<button class="research-btn" type="button" data-detail-action="autoenh-set-max">保存次数</button>' +
      '</div>'
    );
    const ships = Array.isArray(display.ships) ? display.ships : [];
    if (!ships.length) {
      parts.push('<div class="rt-d-row">当前没有舰船</div>');
    } else {
      parts.push('<div class="rt-d-lab">舰船列表（点击开始自动强化）</div>');
      parts.push(ships.map(s => {
        const idAttr = escapeAchievementText(String(s.instanceId));
        const suf = s.hasTier ? ("强化等级 " + s.currentLevel) : "不可强化";
        const comp = s.hasTier ? (s.componentsSufficient ? "部件充足" : "部件不足") : "";
        const disabled = (!s.hasTier || !s.componentsSufficient) ? " disabled" : "";
        return '<div class="research-protocol-planet' + (s.hasTier ? "" : " research-protocol-planet--muted") + '">' +
          '<div class="research-protocol-planet-head">' + escapeAchievementText(s.shipId || idAttr) + " ｜ " + suf + (comp ? " ｜ " + comp : "") + '</div>' +
          '<div class="research-protocol-planet-ctrl">' +
            '<button class="research-btn' + (s.hasTier && s.componentsSufficient ? " primary" : "") + '" type="button"' +
              ' data-detail-action="autoenh-run" data-instance-id="' + idAttr + '"' + disabled + '>开始自动强化</button>' +
          '</div>' +
        '</div>';
      }).join(""));
    }
  } else if (display.protocolId === "autorepair") {
    parts.push('<div class="rt-d-lab">考古舰船自动维修</div>');
    const ship = display.archaeologyShip;
    if (!ship) {
      parts.push('<div class="rt-d-row">未指派考古舰船，无法使用维修协议</div>');
    } else {
      parts.push('<div class="research-protocol-row"><span class="research-protocol-status">' + escapeAchievementText(ship.shipId) + ' ｜ 已指派考古</span></div>');
      const reps = Array.isArray(display.repairers) ? display.repairers : [];
      if (!reps.length) {
        parts.push('<div class="rt-d-row">该考古舰船未安装维修装备</div>');
      } else {
        parts.push('<div class="rt-d-lab">已安装维修装备（非致命反噬后逐件激活一次）</div>');
        parts.push(reps.map(r =>
          '<div class="research-protocol-planet">' +
            '<div class="research-protocol-planet-head">' + escapeAchievementText(String(r.itemId)) + " ｜ 修复 " + escapeAchievementText(String(r.target)) +
              " ｜ 量 " + Number(r.amount) + " ｜ 燃料 " + Number(r.fuelCost) + '</div>' +
          '</div>'
        ).join(""));
      }
    }
    parts.push('<div class="rt-d-hint research-protocol-scope">仅在非致命考古反噬后，每件维修装备最多激活一次；满血层不耗燃料、燃料不足即停止、不复活、不处理致命反噬。无主动执行按钮。</div>');
  } else if (display.protocolId === "intship") {
    parts.push('<div class="rt-d-lab">一体化造船</div>');
    const job = display.job;
    if (!job) {
      // 无作业：启动表单（舰船下拉 + 数量 + 开始按钮）
      parts.push('<div class="rt-d-hint research-protocol-scope">选定舰船与数量后，协议自动补齐缺口组件并完成总装；制造过程复用舰船工程链路。</div>');
      const recipes = Array.isArray(display.recipes) ? display.recipes : [];
      if (!recipes.length) {
        parts.push('<div class="rt-d-row">当前没有可用的装配配方</div>');
      } else {
        const options = recipes.map(r => {
          const lockedText = r.buildable ? "" : (" （" + researchReasonText(r.lockReason) + "）");
          return '<option value="' + escapeAchievementText(String(r.recipeId)) + '"' + (r.buildable ? "" : " disabled") + '>' +
            escapeAchievementText(String(r.name) + "（工程 Lv." + Number(r.level) + "）" + lockedText) + '</option>';
        }).join("");
        const busy = display.actionBusy === true;
        parts.push(
          '<div class="research-protocol-row research-protocol-intship" data-intship-panel="1">' +
            '<label class="research-protocol-reserve-label">舰船配方' +
              '<select class="research-protocol-intship-recipe" data-intship-recipe>' + options + '</select>' +
            '</label>' +
            '<label class="research-protocol-reserve-label">数量（1–' + display.maxQuantity + '）' +
              '<input class="research-protocol-intship-qty" type="number" min="1" max="' + display.maxQuantity + '" step="1" value="1" data-intship-quantity>' +
            '</label>' +
            '<button class="research-btn primary" type="button" data-detail-action="intship-start"' + (busy ? " disabled" : "") + '>开始造船</button>' +
            (busy ? '<span class="research-protocol-status">当前有制造动作进行中</span>' : "") +
          '</div>'
        );
      }
    } else {
      // 有作业：进度展示 + 续作 / 取消按钮
      const phaseText = {
        component: "组件生产",
        assembly: "舰船总装",
        completed: "已完成",
        stopped: "已停止",
        preempted: "已抢占",
        cancelled: "已取消",
        "recovery-required": "需手动恢复"
      }[job.phase] || job.phase;
      const headText = job.shipId + " ×" + Number(job.quantity) + " ｜ " + phaseText +
        (job.active || job.phase === "stopped" || job.phase === "preempted"
          ? " ｜ 已产出 " + Number(job.producedShips) + "/" + Number(job.quantity) + " 艘" : "");
      parts.push('<div class="research-protocol-planet' + (job.phase === "recovery-required" ? " research-protocol-planet--muted" : "") + '">');
      parts.push('<div class="research-protocol-planet-head">' + escapeAchievementText(headText) + '</div>');
      if (job.phase === "component") {
        parts.push('<div class="rt-d-lab">组件缺口（已产/需求）</div>');
        const compRows = job.components.map(c =>
          '<div class="research-protocol-planet-meta">' + escapeAchievementText(String(c.componentId) + " ｜ " + c.done + "/" + c.need) + '</div>'
        ).join("");
        parts.push(compRows || '<div class="rt-d-row">组件计划为空</div>');
      } else if (job.phase === "assembly") {
        parts.push('<div class="rt-d-hint research-protocol-scope">总装中：已产出 ' + Number(job.producedShips) + " / " + Number(job.quantity) + " 艘</div>");
      } else if (job.phase === "completed") {
        parts.push('<div class="rt-d-hint research-protocol-scope">作业完成：已产出 ' + Number(job.producedShips) + ' 艘' + (job.shipId ? " " + job.shipId : "") + '</div>');
      } else if (job.phase === "stopped" || job.phase === "preempted") {
        parts.push('<div class="rt-d-hint research-protocol-scope">作业已中断：' + researchReasonText(job.stopReason) +
          "（组件 " + Number(job.componentsProduced) + "/" + Number(job.componentsPlanned) +
          "，已产出 " + Number(job.producedShips) + "/" + Number(job.quantity) + " 艘）</div>");
      } else if (job.phase === "recovery-required") {
        parts.push('<div class="rt-d-hint research-protocol-scope">作业与存档不一致，已冻结；请取消后重新发起。</div>');
      }
      const canContinue = (job.phase === "stopped" || job.phase === "preempted") && display.actionBusy !== true;
      const canCancel = job.phase !== "completed" && job.phase !== "cancelled";
      parts.push('<div class="research-protocol-planet-ctrl">');
      if (canContinue) {
        parts.push('<button class="research-btn primary" type="button" data-detail-action="intship-continue">续作作业</button>');
      }
      if (canCancel) {
        parts.push('<button class="research-btn danger" type="button" data-detail-action="intship-cancel">取消作业</button>');
      }
      parts.push('</div>');
      parts.push('</div>');
    }
  }
  return '<div class="research-protocol-panel">' + parts.join("") + '</div>';
}

// ---- 节点详情（#research-detail）：直接读正式 node 对象，不从卡片截断文字反推 ----
function renderResearchDetail(research, RD, RS, model) {
  const el = document.getElementById("research-detail");
  if (!el) return;
  const node = (_researchSelectedTechId && RS && RS.getResearchNode) ? RS.getResearchNode(_researchSelectedTechId) : null;
  if (!node) {
    el.innerHTML = '';
    return;
  }
  const view = (model && model.nodes) ? model.nodes.find(n => n.id === node.id) : null;
  const status = view ? view.status : "locked";
  const statusLabel = RESEARCH_STATUS_LABEL[status] || status;
  const isProtocol = node.type === "protocol" || node.category === "protocol";
  const isSingle = !isProtocol && node.maxLevel === 1;
  const completedLevels = research.completedLevels || {};
  const completed = Number(completedLevels[node.id]) || 0;
  const activeLevel = view ? view.activeLevel : 0;
  const nextTarget = view ? view.nextTarget : completed + 1;
  const eraMeta = RESEARCH_ERA_META[Number(node.era) || 0] || { label: "时代 ?", sub: "" };
  const categoryLabel = RESEARCH_CATEGORY_LABEL[node.category] || node.category || "—";
  const effects = Array.isArray(node.effects) ? node.effects : [];

  const effectRows = effects.map((text, i) => {
    const level = i + 1;
    let rowCls = "rt-d-eff-row";
    let suffix = "";
    if (level <= completed) { rowCls += " rt-d-eff-row--owned"; suffix = "（已获得）"; }
    else if (level === nextTarget && !isProtocol) { rowCls += " rt-d-eff-row--next"; suffix = activeLevel === level ? "（研究中）" : "（下一等级）"; }
    const prefix = (isProtocol || isSingle) ? "效果" : toRoman(level);
    return '<div class="' + rowCls + '">' + escapeAchievementText(prefix + " ｜ " + text + suffix) + '</div>';
  }).join("") || '<div class="rt-d-eff-row">—</div>';

  const prereqRows = (node.prerequisites && node.prerequisites.length)
    ? node.prerequisites.map(p => {
        const pn = RS && RS.getResearchNode ? RS.getResearchNode(p.id) : null;
        const own = Number(completedLevels[p.id]) || 0;
        const met = own >= p.level;
        const ownRoman = own > 0 ? toRoman(own) : "0";
        return '<div class="rt-d-pre-row--' + (met ? "met" : "unmet") + '">' +
          escapeAchievementText((met ? "✔ " : "✖ ") + (pn ? pn.name : p.id) + " 需 " + toRoman(p.level) + " ｜ 当前 " + ownRoman + " ｜ " + (met ? "已满足" : "未满足")) +
        '</div>';
      }).join("")
    : '<div class="rt-d-row">无（根节点）</div>';

  const nextDurationText = (view && view.nextDurationSeconds != null)
    ? formatResearchDuration(view.nextDurationSeconds)
    : (status === "completed" ? "已全部完成" : "—");

  // 研究批次 I：协议节点未研究时仍复用"立即研究 / 加入队列"；已研究才进入协议配置面板。
  const protocolDisplay = (isProtocol && typeof getResearchProtocolDisplayState === "function")
    ? getResearchProtocolDisplayState(gameState, node.id) : null;
  const protocolUnlocked = Boolean(protocolDisplay && protocolDisplay.unlocked);

  let actionsHtml = "";
  if (isProtocol && !protocolDisplay) {
    actionsHtml = '<div class="rt-d-hint research-protocol-hint">协议业务尚未接入</div>';
  } else if (isProtocol && protocolUnlocked) {
    actionsHtml = renderResearchProtocolPanelHtml(protocolDisplay);
  } else if (status === "completed") {
    actionsHtml = '<div class="rt-d-row">该科技已全部完成</div>';
  } else if (status === "active") {
    actionsHtml = '<div class="rt-d-row">研究中</div>';
  } else if (status === "queued") {
    actionsHtml = '<div class="rt-d-row">已加入队列</div>';
  } else {
    const disabled = status === "locked" ? " disabled" : "";
    const unmet = (node.prerequisites || []).filter(p => (Number(completedLevels[p.id]) || 0) < p.level)
      .map(p => { const pn = RS && RS.getResearchNode ? RS.getResearchNode(p.id) : null; return (pn ? pn.name : p.id) + " " + toRoman(p.level); });
    actionsHtml =
      '<div class="rt-d-actions">' +
        '<button class="research-btn primary" data-detail-action="start" data-tech-id="' + escapeAchievementText(node.id) + '" data-level="' + nextTarget + '"' + disabled + '>立即研究 ' + toRoman(nextTarget) + '</button>' +
        '<button class="research-btn" data-detail-action="enqueue" data-tech-id="' + escapeAchievementText(node.id) + '" data-level="' + nextTarget + '"' + disabled + '>加入队列</button>' +
      '</div>' +
      (status === "locked" ? '<div class="rt-d-hint">缺少前置：' + escapeAchievementText(unmet.join("、") || "—") + '</div>' : "");
  }

  el.innerHTML =
    '<div class="rt-modal-backdrop" data-detail-close></div>' +
    '<div class="rt-modal-box">' +
      '<button class="rt-modal-close" type="button" data-detail-close aria-label="关闭">×</button>' +
      '<div class="rt-d-name">' + escapeAchievementText(node.name) + '</div>' +
      '<div class="rt-d-meta">' + escapeAchievementText("分类：" + categoryLabel + " ｜ 类型：" + (isProtocol ? "协议节点" : (isSingle ? "基础科技 · 单级" : "数值科技 · 五级"))) + '</div>' +
      '<div class="rt-d-tag' + (isProtocol ? " rt-d-tag--protocol" : "") + '">状态：' + escapeAchievementText(statusLabel) + ' ｜ 等级 ' + completed + '/' + node.maxLevel + '</div>' +
      '<div class="rt-d-desc">' + escapeAchievementText(node.description || node.bonus || "—") + '</div>' +
      '<div class="rt-d-lab">全等级效果</div>' + effectRows +
      '<div class="rt-d-lab">下一等级</div>' +
      '<div class="rt-d-row">' + escapeAchievementText(status === "completed" ? "已全部完成" : (toRoman(nextTarget) + " ｜ 研究时间 " + nextDurationText)) + '</div>' +
      '<div class="rt-d-lab">前置需求</div>' + prereqRows +
      actionsHtml +
    '</div>';
}

function renderResearchQueue(research, RD, RS) {
  const el = document.getElementById("research-queue");
  if (!el) return;
  const queue = Array.isArray(research.pendingQueue) ? research.pendingQueue : [];
  if (!queue.length) { el.innerHTML = ""; return; }
  const html = queue.map((key, idx) => {
    const parsed = RS && RS.parseResearchStepKey ? RS.parseResearchStepKey(key) : null;
    const techId = parsed ? parsed.techId : key;
    const level = parsed ? parsed.targetLevel : "?";
    const node = RS && RS.getResearchNode ? RS.getResearchNode(techId) : null;
    const name = node ? node.name : techId;
    const dur = (node && RS && RS.getResearchDuration) ? RS.getResearchDuration(techId, level) : null;
    const durText = (dur != null && isFinite(dur)) ? formatResearchDuration(dur) : "—";
    return '<div class="research-queue-item">' +
      '<div><span class="research-queue-index">#' + (idx + 1) + '</span><b>' + escapeAchievementText(name) + '</b> · Lv.' + level +
        '<div class="research-queue-meta">预计耗时 ' + escapeAchievementText(durText) + '</div></div>' +
      '<button class="research-btn danger" data-remove-key="' + key + '">移除</button>' +
    '</div>';
  }).join("");
  el.innerHTML = html;
}

function getResearchDisplayState(research, model) {
  const statuses = {};
  const edgeStates = {};
  const nodeViews = (model ? model.nodes : []).map(v => {
    statuses[v.status] = (statuses[v.status] || 0) + 1;
    return {
      id: v.id, name: v.name, type: v.type, category: v.category, era: v.era, row: v.row,
      x: v.x, y: v.y, status: v.status, nextTarget: v.nextTarget, completed: v.completed,
      maxLevel: v.maxLevel, isProtocol: v.isProtocol, isSingle: v.isSingle, levelMarks: v.levelMarks.slice()
    };
  });
  const edges = (model ? model.edges : []).map(e => {
    edgeStates[e.state] = (edgeStates[e.state] || 0) + 1;
    return { from: e.from, to: e.to, requiredLevel: e.requiredLevel, state: e.state };
  });
  return {
    bankSeconds: Number(research.researchHourBank) || 0,
    nodeCount: nodeViews.length,
    statuses,
    nodes: nodeViews,
    edges,
    edgeCount: edges.length,
    edgeStates,
    eras: (model ? model.eras : []).map(e => ({ index: e.index, label: e.label, sub: e.sub, count: e.count })),
    selectedTechId: _researchSelectedTechId,
    stage: { width: model ? model.width : 0, height: model ? model.height : 0 },
    queue: Array.isArray(research.pendingQueue) ? research.pendingQueue.slice() : []
  };
}

function renderResearchPage() {
  const research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : null;
  if (!research || typeof research !== "object" || Array.isArray(research)) return null;
  const RD = getResearchData();
  const RS = getResearchSystem();
  const bankEl = document.getElementById("research-bank");
  if (bankEl) bankEl.textContent = "科研工时余额：" + formatResearchHours((Number(research.researchHourBank) || 0) / 3600);
  const model = buildResearchTreeModel(research, RD, RS);
  _researchTreeModel = model;
  renderResearchActive(research, RS);
  renderResearchTree(model);
  renderResearchDetail(research, RD, RS, model);
  renderResearchQueue(research, RD, RS);
  // 仅首次进入研究页或 activeResearch 目标变化时定位，绝不每次重绘抢夺玩家滚动位置
  autoScrollResearchTree(research, model);
  // 同步结构签名：用于 live updater 判断是否需要整页重渲染（不进 gameState/存档）。
  _researchSig = computeResearchSig();
  return getResearchDisplayState(research, model);
}

/* ================================================================
   研究实时刷新（live updater）：只读 getResearchProgress / activeResearch 写 DOM，
   不推进游戏状态、不写 gameState、不触发整页重建（除非结构签名变化）。
   节流时间戳与结构签名均为模块级变量，绝不进入 gameState / 存档。
   ================================================================ */

var _researchSig = "";
var _researchLastLive = 0;
// Batch F 视觉返修：科技树视图态一律模块级，绝不进入 gameState / 存档。
var _researchSelectedTechId = null;   // 详情区当前选中的科技
var _researchTreeModel = null;        // 最近一次渲染的纯读布局模型
var _researchAutoScrollKey = null;    // 已完成自动定位的 activeResearch 标识
var _researchDrag = null;             // 画布拖动状态

// 结构签名：activeResearch 唯一标识（techId@targetLevel）与队列 keys。
// 二者任一变化即代表结构性变化（研究中/完成/衔接下一项/队列增减）→ 整页渲染。
function computeResearchSig() {
  var research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : {};
  var ar = research.activeResearch;
  var activeKey = (ar && typeof ar === "object" && !Array.isArray(ar)) ? (ar.techId + "@" + ar.targetLevel) : "-";
  var queue = Array.isArray(research.pendingQueue) ? research.pendingQueue : [];
  return "A:" + activeKey + "|Q:" + queue.join(",");
}

// 统一实时入口（由 updateLiveUI 每秒按 currentPage==="research" 调用）。
// 节流仅作用于「轻量字段刷新」分支；结构签名一旦变化必须无条件立即整页重渲染，
// 否则研究完成/队列衔接等结构变化在节流窗口内被漏渲染，玩家须手动切页才看得到更新。
function updateResearchLiveUI(now) {
  var t = Number(now) || Date.now();
  var research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : null;
  if (!research) return;
  var sig = computeResearchSig();
  if (sig !== _researchSig) {
    // 结构性变化（activeResearch 唯一标识变化/完成、队列变化）→ 整页渲染。
    renderResearchPage();
    _researchLastLive = t;
    return;
  }
  // 非结构变化：仅轻量更新随时间变化的字段；节流避免每秒多次无谓重写 DOM。
  if (t - _researchLastLive < 1000) return;
  _researchLastLive = t;
  liveUpdateResearchFields(t);
}

// 轻量只读刷新：只更新进度条 width / 文本 / 按钮文字，绝不重建容器、不写 gameState。
function liveUpdateResearchFields(now) {
  var t = Number(now) || Date.now();
  var research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : null;
  if (!research) return;
  var RS = getResearchSystem();
  var ar = research.activeResearch;
  if (!ar || typeof ar !== "object" || Array.isArray(ar)) return;
  var progress = (RS && RS.getResearchProgress) ? RS.getResearchProgress(gameState) : null;
  var ratio = (progress && typeof progress.ratio === "number") ? progress.ratio : 0;
  var pct = Math.round(ratio * 100);
  var fill = document.getElementById("research-progress-fill");
  if (fill) setLiveWidth(fill, pct + "%");
  var node = (RS && RS.getResearchNode) ? RS.getResearchNode(ar.techId) : null;
  var name = node ? node.name : ar.techId;
  var nameEl = document.getElementById("research-active-name");
  if (nameEl) setLiveHTML(nameEl, "<b>" + escapeAchievementText(name) + "</b> · 目标等级 " + ar.targetLevel);
  var remainingText = formatResearchDuration(ar.remainingSeconds);
  var etaText = formatResearchDateTime(t + (Number(ar.remainingSeconds) || 0) * 1000);
  var progEl = document.getElementById("research-active-progress");
  if (progEl) setLiveText(progEl, "进度：" + pct + "% ｜ 剩余 " + escapeAchievementText(remainingText) + " ｜ 预计完成 " + escapeAchievementText(etaText));
  var base = Number(ar.baseDuration) || 0;
  var capTotal = base * 0.5;
  var applied = Math.max(0, Number(ar.appliedAchievementSeconds) || 0);
  var capLeft = Math.max(0, capTotal - applied);
  var appliedEl = document.getElementById("research-active-applied");
  if (appliedEl) setLiveText(appliedEl, "本步已用成就工时：" + formatResearchHours(applied / 3600) + " ｜ 50% 上限 " + formatResearchHours(capTotal / 3600) + " ｜ 剩余可投入 " + formatResearchHours(capLeft / 3600));
  var maxHours = computeMaxApplyHours(research);
  var maxBtn = document.getElementById("research-active-btn-max");
  if (maxBtn) setLiveText(maxBtn, "最大可用（" + formatResearchHours(maxHours) + "）");
  var cancelBtn = document.getElementById("research-active-btn-cancel");
  if (cancelBtn) setLiveText(cancelBtn, "取消（退还 " + formatResearchHours(computeResearchRefundSeconds(research) / 3600) + "）");
}

// ---- 研究页交互（事件委托，全部经 dispatchGameAction） ----
function onResearchQueueClick(event) {
  const btn = event.target.closest("[data-remove-key]");
  if (!btn) return;
  const key = btn.dataset.removeKey;
  if (!key) return;
  const result = dispatchGameAction(gameState, { type: "research/removeQueued", stepKey: key }, Date.now());
  if (!result.changed) { showToast(researchReasonText(result.reason)); return; }
  renderResearchPage();
}
function onResearchActiveClick(event) {
  const btn = event.target.closest("[data-active-action]");
  if (!btn) return;
  const action = btn.dataset.activeAction;
  const research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : null;
  if (action === "apply") {
    let hours;
    if (btn.dataset.hours === "max") {
      hours = computeMaxApplyHours(research);
      if (!(hours > 0)) { showToast("无可投入的科研工时"); return; }
    } else {
      hours = Number(btn.dataset.hours);
    }
    const result = dispatchGameAction(gameState, { type: "research/applyHours", hours }, Date.now());
    if (!result.changed) { showToast(researchReasonText(result.reason)); return; }
    renderResearchPage();
  } else if (action === "cancel") {
    // 确认文案与按钮文案统一口径：都用 appliedAchievementSeconds
    const refunded = computeResearchRefundSeconds(research);
    const msg = "取消当前研究？将退还已投入的成就工时 " + formatResearchHours(refunded / 3600) + "。";
    const confirmed = (typeof window !== "undefined" && typeof window.confirm === "function") ? window.confirm(msg) : true;
    if (!confirmed) return;
    const result = dispatchGameAction(gameState, { type: "research/cancel" }, Date.now());
    if (!result.changed) { showToast(researchReasonText(result.reason)); return; }
    renderResearchPage();
  }
}

// ---- Batch F 视觉返修：画布交互（拖动 / 关联高亮 / 自动定位 / 详情操作） ----
function researchPrefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  return !!(mq && mq.matches);
}

// 只在「首次进入研究页」或「activeResearch 目标变化」时返回 true，避免每次重绘抢滚动位置
function shouldAutoScrollResearch(activeKey) {
  const key = activeKey || "-";
  if (_researchAutoScrollKey === key) return false;
  _researchAutoScrollKey = key;
  return true;
}
function resetResearchAutoScroll() { _researchAutoScrollKey = null; }

function autoScrollResearchTree(research, model) {
  const el = document.getElementById("research-tree");
  if (!el) return false;
  const ar = research ? research.activeResearch : null;
  const hasActive = !!(ar && typeof ar === "object" && !Array.isArray(ar));
  const activeKey = hasActive ? (ar.techId + "@" + ar.targetLevel) : null;
  if (!shouldAutoScrollResearch(activeKey)) return false;
  let targetLeft = 0; // 无 activeResearch 时保持时代 I 可见
  if (hasActive && model) {
    const view = model.nodes.find(n => n.id === ar.techId);
    if (view) targetLeft = Math.max(0, view.x - (Number(el.clientWidth) || 640) / 2 + RT_LAYOUT.BOX_W / 2);
  }
  if (typeof el.scrollTo === "function") {
    el.scrollTo({ left: targetLeft, behavior: researchPrefersReducedMotion() ? "auto" : "smooth" });
  } else {
    el.scrollLeft = targetLeft;
  }
  return true;
}

// 直接关联集合：该节点 + 直接入边/出边 + 直接相邻节点（不做递归祖先/后代）
function computeResearchFocusSets(techId, model) {
  const edgeKeys = [];
  const nodeIds = [techId];
  const seen = { [techId]: true };
  const edges = (model && model.edges) ? model.edges : [];
  for (const edge of edges) {
    if (edge.from !== techId && edge.to !== techId) continue;
    edgeKeys.push(edge.from + ">" + edge.to + "@" + edge.requiredLevel);
    for (const id of [edge.from, edge.to]) {
      if (!seen[id]) { seen[id] = true; nodeIds.push(id); }
    }
  }
  return { edgeKeys, nodeIds };
}

function applyResearchFocus(techId) {
  const el = document.getElementById("research-tree");
  if (!el || typeof el.querySelectorAll !== "function") return;
  const sets = computeResearchFocusSets(techId, _researchTreeModel);
  const linked = {};
  for (const id of sets.nodeIds) linked[id] = true;
  const paths = el.querySelectorAll(".rt-edge");
  for (let i = 0; i < paths.length; i += 1) {
    const p = paths[i];
    const from = p.dataset ? p.dataset.from : null;
    const to = p.dataset ? p.dataset.to : null;
    const hit = (from === techId || to === techId);
    p.classList.remove(hit ? "rt-edge--dim" : "rt-edge--hi");
    p.classList.add(hit ? "rt-edge--hi" : "rt-edge--dim");
  }
  const nodeEls = el.querySelectorAll(".rt-node");
  for (let i = 0; i < nodeEls.length; i += 1) {
    const n = nodeEls[i];
    const id = n.dataset ? n.dataset.techId : null;
    const on = !!linked[id];
    n.classList.remove(on ? "rt-node--faded" : "rt-node--linked");
    n.classList.add(on ? "rt-node--linked" : "rt-node--faded");
  }
}

function clearResearchFocus() {
  const el = document.getElementById("research-tree");
  if (!el || typeof el.querySelectorAll !== "function") return;
  const paths = el.querySelectorAll(".rt-edge");
  for (let i = 0; i < paths.length; i += 1) {
    paths[i].classList.remove("rt-edge--hi");
    paths[i].classList.remove("rt-edge--dim");
  }
  const nodeEls = el.querySelectorAll(".rt-node");
  for (let i = 0; i < nodeEls.length; i += 1) {
    nodeEls[i].classList.remove("rt-node--linked");
    nodeEls[i].classList.remove("rt-node--faded");
  }
}

// 选中节点 → 仅刷新详情区，不重排科技树、不动 gameState
function selectResearchNode(techId) {
  if (!techId) return;
  _researchSelectedTechId = techId;
  const research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : null;
  if (!research) return;
  renderResearchDetail(research, getResearchData(), getResearchSystem(), _researchTreeModel);
}

// 关闭详情弹窗：清空选中态并隐藏（纯视图，不写 gameState / 存档）
function closeResearchDetail() {
  _researchSelectedTechId = null;
  const research = (typeof gameState !== "undefined" && gameState && gameState.research) ? gameState.research : null;
  if (!research) return;
  renderResearchDetail(research, getResearchData(), getResearchSystem(), _researchTreeModel);
}

function onResearchTreeClick(event) {
  if (_researchDrag && _researchDrag.moved) return; // 拖动画布不算点选
  const node = event.target && typeof event.target.closest === "function" ? event.target.closest(".rt-node") : null;
  if (!node || !node.dataset) return;
  selectResearchNode(node.dataset.techId);
}

function onResearchTreeKeyDown(event) {
  if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
  const node = event.target && typeof event.target.closest === "function" ? event.target.closest(".rt-node") : null;
  if (!node || !node.dataset) return;
  if (typeof event.preventDefault === "function") event.preventDefault();
  selectResearchNode(node.dataset.techId);
}

function onResearchTreeOver(event) {
  const node = event.target && typeof event.target.closest === "function" ? event.target.closest(".rt-node") : null;
  if (!node || !node.dataset || !node.dataset.techId) return;
  applyResearchFocus(node.dataset.techId);
}
function onResearchTreeOut(event) {
  const node = event.target && typeof event.target.closest === "function" ? event.target.closest(".rt-node") : null;
  if (!node) return;
  clearResearchFocus();
}

// 画布拖动：只处理鼠标/触控笔，触摸交给浏览器原生横向滚动；节点上按下不触发拖动
function onResearchTreePointerDown(event) {
  if (event.pointerType === "touch") return;
  if (event.button != null && event.button !== 0) return;
  if (event.target && typeof event.target.closest === "function" && event.target.closest(".rt-node")) return;
  const el = document.getElementById("research-tree");
  if (!el) return;
  _researchDrag = { startX: Number(event.clientX) || 0, startLeft: Number(el.scrollLeft) || 0, moved: false };
  el.classList.add("is-dragging");
}
function onResearchTreePointerMove(event) {
  if (!_researchDrag) return;
  const el = document.getElementById("research-tree");
  if (!el) return;
  const dx = (Number(event.clientX) || 0) - _researchDrag.startX;
  if (Math.abs(dx) > 3) _researchDrag.moved = true;
  el.scrollLeft = _researchDrag.startLeft - dx;
}
function onResearchTreePointerUp() {
  if (!_researchDrag) return;
  const el = document.getElementById("research-tree");
  if (el) el.classList.remove("is-dragging");
  const moved = _researchDrag.moved;
  _researchDrag = moved ? { moved: true } : null;
  if (moved) setTimeout(() => { _researchDrag = null; }, 0);
}

// 详情弹窗操作：关闭（遮罩 / × / 按 ESC）→ 经 dispatchGameAction 操作 → 整页刷新
function onResearchDetailClick(event) {
  const closeEl = event.target && typeof event.target.closest === "function" ? event.target.closest("[data-detail-close]") : null;
  if (closeEl) { closeResearchDetail(); return; }
  const btn = event.target && typeof event.target.closest === "function" ? event.target.closest("[data-detail-action]") : null;
  if (!btn || !btn.dataset) return;
  if (btn.disabled) return;
  const action = btn.dataset.detailAction;
  // 研究批次 I / J / K：协议配置一律经 dispatchGameAction 派发（UI 不直接改 state、不复制业务判断）
  if (action === "protocol-toggle" || action === "planauto-toggle" || action === "planauto-reserve" ||
      action === "autoenh-set-max" || action === "autoenh-run" ||
      action === "intship-start" || action === "intship-continue" || action === "intship-cancel") {
    onResearchProtocolAction(action, btn);
    return;
  }
  const techId = btn.dataset.techId;
  const targetLevel = Number(btn.dataset.level);
  if (!techId || !Number.isInteger(targetLevel)) return;
  const type = action === "start" ? "research/start" : action === "enqueue" ? "research/enqueue" : null;
  if (!type) return;
  const result = dispatchGameAction(gameState, { type, techId, targetLevel }, Date.now());
  if (!result.changed) { showToast(researchReasonText(result.reason)); return; }
  renderResearchPage();
}

// 研究批次 I：协议总开关 / 单基地自动续期 / 最低星币储备（全部走 action 路由）
function onResearchProtocolAction(action, btn) {
  if (action === "protocol-toggle") {
    const protocolId = btn.dataset.protocolId;
    const enabled = btn.dataset.protocolEnabled === "true";
    const result = dispatchGameAction(gameState, { type:"research/setProtocolEnabled", protocolId, enabled }, Date.now());
    if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
    showToast(enabled ? "协议已启用" : "协议已关闭");
    renderResearchPage();
    return;
  }
  if (action === "autoenh-set-max") {
    const panel = (typeof btn.closest === "function") ? btn.closest("[data-autoenh-panel]") : null;
    const input = panel ? panel.querySelector("[data-protocol-max]") : null;
    const raw = input ? String(input.value).trim() : "";
    const maxAttempts = raw === "" ? 0 : Number(raw);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10000) {
      showToast(researchReasonText("INVALID_MAX_ATTEMPTS"));
      return;
    }
    const result = dispatchGameAction(gameState, { type:"research/setAutoEnhancementMaxAttempts", maxAttempts }, Date.now());
    if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
    showToast("已保存最大尝试次数：" + maxAttempts);
    renderResearchPage();
    return;
  }
  if (action === "autoenh-run") {
    const instanceId = btn.dataset.instanceId;
    if (!instanceId) return;
    if (typeof confirm === "function" && !confirm("确认对该舰船执行自动强化？将按设定次数反复尝试直至部件不足。")) return;
    const result = dispatchGameAction(gameState, { type:"research/runAutoEnhancement", instanceId, context:{} }, Date.now());
    if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
    showToast("自动强化完成 ｜ 尝试 " + result.attempts + " ｜ 成功 " + result.successes + " ｜ 失败 " + result.failures +
      " ｜ 终等级 " + result.toLevel + " ｜ 停止：" + (result.stopReason || ""));
    renderResearchPage();
    return;
  }
  // 研究批次 K：intship 一体化造船（启动 / 续作 / 取消）
  if (action === "intship-start") {
    const panel = (typeof btn.closest === "function") ? btn.closest("[data-intship-panel]") : null;
    const recipeSelect = panel ? panel.querySelector("[data-intship-recipe]") : null;
    const qtyInput = panel ? panel.querySelector("[data-intship-quantity]") : null;
    const recipeId = recipeSelect ? recipeSelect.value : "";
    if (!recipeId) { showToast(researchReasonText("UNKNOWN_RECIPE")); return; }
    const rawQty = qtyInput ? String(qtyInput.value).trim() : "1";
    const quantity = rawQty === "" ? 1 : Number(rawQty);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      showToast(researchReasonText("INVALID_QUANTITY"));
      return;
    }
    const result = dispatchGameAction(gameState, { type:"research/startIntship", options:{ recipeId, quantity } }, Date.now());
    if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
    showToast("造船作业已启动 ｜ " + String(result.shipId || "") + " ×" + quantity + " ｜ 阶段：" + (result.phase || ""));
    renderResearchPage();
    return;
  }
  if (action === "intship-continue") {
    const result = dispatchGameAction(gameState, { type:"research/continueIntship" }, Date.now());
    if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
    showToast("造船作业已续作 ｜ 阶段：" + (result.phase || ""));
    renderResearchPage();
    return;
  }
  if (action === "intship-cancel") {
    if (typeof confirm === "function" && !confirm("确认取消当前造船作业？已产出的组件与舰船保留，未完成部分不再继续。")) return;
    const result = dispatchGameAction(gameState, { type:"research/cancelIntship" }, Date.now());
    if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
    showToast("造船作业已取消");
    renderResearchPage();
    return;
  }
  const deploymentId = btn.dataset.deploymentId;
  const row = (typeof btn.closest === "function") ? btn.closest("[data-deployment-row]") : null;
  const input = row ? row.querySelector("[data-protocol-reserve]") : null;
  const raw = input ? String(input.value).trim() : "";
  const minIskReserve = raw === "" ? 0 : Number(raw);
  if (!Number.isFinite(minIskReserve) || minIskReserve < 0) {
    showToast(researchReasonText("INVALID_RESERVE"));
    return;
  }
  const enabled = (action === "planauto-toggle")
    ? btn.dataset.deploymentEnabled === "true"
    : Boolean(row && row.dataset.deploymentCurrent === "true");
  const result = dispatchGameAction(gameState, { type:"research/setPlanetAutoRenew", deploymentId, enabled, minIskReserve }, Date.now());
  if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
  showToast(action === "planauto-toggle"
    ? (enabled ? "该基地已开启自动续期" : "该基地已关闭自动续期")
    : "已保存最低星币储备");
  renderResearchPage();
}

// 弹窗内按 ESC 关闭
function onResearchDetailKey(event) {
  if (event.key === "Escape") closeResearchDetail();
}

function getLPStoreItems() {
  return getLPStoreCatalogItems();
}

function buyLPStoreItem(itemId) {
  const result = dispatchGameAction(gameState, { type:"shell/buyLPItem", equipmentId:itemId }, Date.now());
  if (!result.changed) {
    if (result.reason === "insufficient-lp") showToast("功勋不足");
    else if (result.reason === "already-owned") showToast("该蓝图已拥有");
    return false;
  }
  showToast("已兑换：" + result.item.name); renderLPStore(); updateUI(); return true;
}

function buyBlueprintStoreItem(itemId, kind) {
  const result = kind === "shipBlueprint"
    ? dispatchGameAction(gameState, { type:"manufacturing/buyBlueprint", blueprintId:itemId }, Date.now())
    : dispatchGameAction(gameState, { type:"shell/buyLPItem", equipmentId:itemId }, Date.now());
  if (!result.changed) {
    if (result.reason === "insufficient-lp") showToast("功勋不足");
    else if (result.reason === "insufficient-isk") showToast("星币不足");
    else if (result.reason === "already-owned") showToast("该蓝图已拥有");
    return false;
  }
  showToast("已购买：" + (result.blueprint ? result.blueprint.name + "蓝图" : result.item.name));
  renderBlueprintStore(); updateUI(); return true;
}

function getHangarBonusText(bonuses) {
  const names = { shieldCapacity:"+护盾", armorCapacity:"+装甲", structureCapacity:"+结构", laserDamage:"+激光伤", missileDamage:"+导弹伤", cannonDamage:"+炮台伤", capacitorRecharge:"+电容", targetingSpeed:"+锁定", speed:"+速度", miningLaserEfficiency:"+采矿器效能", gasLaserEfficiency:"+采气器效能", fleetMiningSpeed:"+舰队采矿速度", smeltingSpeed:"+冶炼速度", miningEfficiency:"+采矿效率", gasEfficiency:"+采气效率" };
  return Object.entries(bonuses || {}).map(([key, value]) => {
    // 考古船加成为绝对数值 / 固定减免，不能按百分比乘 100 显示。
    if (key === "archaeologyScanStrength") return "扫描强度 " + value;
    if (key === "archaeologyFailureDamageReduction") return "失败反噬减免 " + Math.round(value * 100) + "%";
    return (names[key] || key) + " " + Math.round(value * 100) + "%";
  }).join(" · ");
}

function getEnhancementBonusText(enhancement) {
  if (!enhancement || !enhancement.available) return "该舰船暂无强化部件";
  if (enhancement.role === "combat") {
    return "生命 +" + (enhancement.hpBonus * 100).toFixed(1) + "% · 武器伤害 +" + (enhancement.damageBonus * 100).toFixed(2) + "%";
  }
  if (enhancement.role === "archaeology") {
    return "生命 +" + (enhancement.hpBonus * 100).toFixed(1) + "% · 扫描强度 +" + (enhancement.scanBonus * 100).toFixed(1) +
      "%（" + enhancement.scanStrengthBase + "→" + enhancement.scanStrength + "） · 失败反噬减免 " + Math.round(enhancement.failureReduction * 100) + "%（固定）";
  }
  const label = enhancement.role === "gas" ? "采气效率" : enhancement.role === "industry-dual" ? "采矿/采气效率" : "采矿效率";
  return label + " +" + (enhancement.industryBonus * 100).toFixed(1) + "%";
}

function getEnhancementNextText(enhancement) {
  if (!enhancement || !enhancement.available) return "";
  if (enhancement.role === "combat") {
    return "下一级：生命 +" + (enhancement.nextHpGain * 100).toFixed(1) + "% · 武器伤害 +" + (enhancement.nextDamageGain * 100).toFixed(2) + "%";
  }
  if (enhancement.role === "archaeology") {
    return "下一级：生命 +" + (enhancement.nextHpGain * 100).toFixed(1) + "% · 扫描强度 +" + (enhancement.nextScanGain * 100).toFixed(1) + "%";
  }
  return "下一级：最终采集效率 +" + (enhancement.nextIndustryGain * 100).toFixed(1) + "%";
}

/* ================================================================
   船坞 3D（静态截图列表 + 点击弹出可拖拽查看器）
   ================================================================ */
const _hangarThumbCache = new Map();
let _hangarPopupViewer = null;

function getHangarThumb(shipId) {
  const S3D = window.Ship3D;
  if (!S3D) return null;
  if (_hangarThumbCache.has(shipId)) return _hangarThumbCache.get(shipId);
  let url = null;
  try {
    const spec = S3D.buildSpecForShip(shipId);
    url = S3D.captureThumbnail(spec, { width: 300, height: 180 });
  } catch (e) { console.error("[hangar] 3D 截图失败", shipId, e); }
  if (url) _hangarThumbCache.set(shipId, url); // 仅缓存成功结果，未就绪时下次重试
  return url;
}

function openHangar3DPopup(instanceId) {
  const S3D = window.Ship3D;
  if (!S3D) return;
  const display = getHangarDisplayState(gameState, Date.now());
  const ship = display.ships.find(item => item.instanceId === instanceId);
  if (!ship) return;
  const popup = document.getElementById("hangar-3d-popup");
  const canvas = document.getElementById("hangar-3d-popup-canvas");
  const nameEl = document.getElementById("hangar-3d-popup-name");
  if (!popup || !canvas) return;
  nameEl.textContent = ship.name;
  popup.classList.add("open");
  const spec = S3D.buildSpecForShip(ship.shipId);
  if (!_hangarPopupViewer) {
    // 首次打开：等布局完成再创建 viewer；之后常驻复用，关闭不销毁，避免 forceContextLoss 后再创建失败/白屏。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _hangarPopupViewer = S3D.ensureViewer(canvas, { orbit: true, autoSpin: true });
        if (_hangarPopupViewer) S3D.setShips(_hangarPopupViewer, [{ spec, position: [0, 0, 0], scale: 1, sway: false }]);
      });
    });
  } else {
    S3D.setShips(_hangarPopupViewer, [{ spec, position: [0, 0, 0], scale: 1, sway: false }]);
    _hangarPopupViewer._needsAutoFit = true;
  }
}

function closeHangar3DPopup() {
  const popup = document.getElementById("hangar-3d-popup");
  if (popup) popup.classList.remove("open");
  // 不销毁 viewer：复用，避免 forceContextLoss 后再创建失败（第二个弹窗白屏的根因）。
}

(function bindHangar3D() {
  document.addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-open-3d]");
    if (thumb) { openHangar3DPopup(thumb.getAttribute("data-open-3d")); }
  });
  const popup = document.getElementById("hangar-3d-popup");
  const closeBtn = document.getElementById("hangar-3d-popup-close");
  if (closeBtn) closeBtn.addEventListener("click", closeHangar3DPopup);
  if (popup) popup.addEventListener("click", (event) => { if (event.target === popup) closeHangar3DPopup(); });
})();

function renderHangarPanel() {
  const panel = document.getElementById("hangar-panel");
  if (panel) panel.style.display = "flex";
  const display = getHangarDisplayState(gameState, Date.now());
  const info = document.getElementById("hangar-header-info"); if (info) info.textContent = "已拥有 " + display.count + " 艘舰船";
  const grid = document.getElementById("hangar-ship-grid"); const empty = document.getElementById("hangar-empty");
  if (!grid) return display;
  if (!display.ships.length) { grid.innerHTML = ""; if (empty) empty.style.display = ""; return display; }
  if (empty) empty.style.display = "none";
  grid.innerHTML = display.ships.map(ship => {
    if (ship.unknown) return "";
    const assignments = ship.assignments.map(item => `<button class="act-tag${item.active ? " on" : ""}${item.locked ? " unavailable" : ""}" data-ship-action="${item.actionKey}" data-sid="${ship.instanceId}" title="${item.lockedReason || (item.active ? "当前唯一任务，点击解除" : "分配至此任务")}" ${item.locked ? "disabled" : ""}>${item.name}</button>`).join("");
    const bonuses = getHangarBonusText(ship.bonuses);
    const enhancement = ship.enhancement;
    const materials = enhancement.materials.map(item => `<span class="enhance-material${item.enough ? "" : " short"}">${item.name} ${item.stock}/${item.quantity}</span>`).join("");
    const enhanceDisabled = enhancement.canEnhance ? "" : "disabled";
    const enhanceLabel = enhancement.busy ? "执行任务中" : enhancement.available ? "强化至 +" + (enhancement.level + 1) : "暂不可强化";
    const thumbUrl = getHangarThumb(ship.shipId);
    const thumbHtml = thumbUrl ? `<img class="hangar-ship-thumb" data-open-3d="${ship.instanceId}" src="${thumbUrl}" alt="${ship.name}" title="点击查看 3D 模型">` : "";
    return `<div class="hangar-ship-card${ship.assignedActions.length ? " equipped" : ""}">${thumbHtml}
      <div class="hangar-ship-header"><span class="hsh-icon">${ship.archaeology ? "🛰️" : ship.industrial ? "🏭" : "🚀"}</span><span class="hsh-name">${ship.name}</span><span class="enhance-level${enhancement.milestone ? " milestone-next" : ""}">+${enhancement.level}</span><span class="hsh-tier">${ship.tier} ${ship.typeName}</span><span class="hsh-tier">${ship.archaeology ? "🛰️ 考古" : ship.industrial ? "🏭 工业" : "⚔️ 战斗"}</span>${ship.assignedActions.length ? `<span class="hsh-equipped">📋 ${ship.assignedActions.map(key => display.actionNames[key]).join("+")}</span>` : ""}</div>
      <div class="hangar-ship-stats"><span class="hss-item"><span class="hss-label">护盾</span><span class="hss-val">${ship.hp.shield}</span></span><span class="hss-item"><span class="hss-label">装甲</span><span class="hss-val">${ship.hp.armor}</span></span><span class="hss-item"><span class="hss-label">结构</span><span class="hss-val">${ship.hp.structure}</span></span><span class="hss-item"><span class="hss-label">闪避</span><span class="hss-val">${ship.dodge}</span></span><span class="hss-item"><span class="hss-label">速度</span><span class="hss-val">${ship.speed}</span></span></div>
      ${bonuses ? `<div class="hangar-ship-bonuses">舰船加成：${bonuses}</div>` : ""}
      <div class="hangar-enhancement${enhancement.milestone ? " milestone" : ""}"><div class="enhance-summary"><strong>强化 +${enhancement.level}</strong><span>${getEnhancementBonusText(enhancement)}</span></div><div class="enhance-next">${enhancement.milestone ? "★ 里程碑 · " : ""}${getEnhancementNextText(enhancement)}</div><div class="enhance-materials">${materials}</div><div class="enhance-roll"><span>成功率 <b>${enhancement.chancePercent}%</b></span><span>成功 ${enhancement.successXp} XP · 失败 ${enhancement.failureXp} XP并清零</span><button class="btn enhance-btn" data-enhance-ship="${ship.instanceId}" ${enhanceDisabled}>${enhanceLabel}</button></div></div>
      <div class="hangar-ship-actions">${assignments}<button class="btn" data-open-fitting="${ship.instanceId}" style="margin-left:6px;">🔧 装备</button></div></div>`;
  }).join("");
  return display;
}

function enhanceShipFromHangar(instanceId) {
  const display = getHangarDisplayState(gameState, Date.now());
  const ship = display.ships.find(item => item.instanceId === instanceId);
  if (!ship || !ship.enhancement || !ship.enhancement.available) return false;
  const confirmationEnabled = getSettingsDisplayState(gameState).confirmShipEnhancement;
  if (confirmationEnabled) {
    const costLines = (ship.enhancement.materials || []).map(m => m.name + "×" + m.quantity).join("、");
    const tip = "强化 " + ship.name + "：+" + ship.enhancement.level + " → +" + (ship.enhancement.level + 1) +
      "\n成功率：" + ship.enhancement.chancePercent + "%" +
      "\n消耗部件：" + costLines +
      "\n失败消耗部件、等级保持 +" + ship.enhancement.level + "、0 XP。确认执行强化？";
    if (!window.confirm(tip)) return false;
  }
  const result = dispatchGameAction(gameState, { type:"hangar/enhanceShip", instanceId }, Date.now());
  if (!result.changed) {
    const messages = { "insufficient-components":"强化部件不足", "ship-active":"舰船执行任务时不能强化", "enhancement-unavailable":"该舰船暂无对应强化部件" };
    showToast(messages[result.reason] || "强化失败");
    return false;
  }
  showToast(result.success
    ? result.config.name + " 强化成功：+" + result.fromLevel + " → +" + result.toLevel + "，获得 " + result.xp + " 经验"
    : result.config.name + " 强化失败，等级保持 +" + result.fromLevel + "，本次部件已消耗");
  renderHangarPanel();
  renderCombatPanel();
  updateUI();
  return true;
}

function enhanceEquipmentFromWarehouse(targetRef) {
  if (!targetRef) return false;
  const resolved = resolveEquipmentReference(gameState, targetRef);
  if (!resolved) { showToast("装备不存在"); return false; }
  const definition = resolved.definition;
  const fromLevel = resolved.enhancementLevel;
  const engLevel = Number(gameState.skills && gameState.skills.equipmentEngineering && gameState.skills.equipmentEngineering.lvl) || 1;
  const preview = getEquipmentEnhancementDisplayState(definition, fromLevel, engLevel);
  const confirmationEnabled = getSettingsDisplayState(gameState).confirmShipEnhancement;
  if (confirmationEnabled) {
    const materialLines = Object.entries(preview.cost).map(([mineral, qty]) => `${mineral}×${qty}`).join("、");
    const extraLines = [];
    if (preview.extra.sameTypeItemId) extraLines.push("同型号 +0 装备×1");
    if (preview.extra.core) extraLines.push(preview.extra.core + "×1");
    if (preview.extra.protocol) extraLines.push(preview.extra.protocol + "×1");
    const fullList = [materialLines, ...extraLines].filter(Boolean).join(" + ");
    const tip = `强化 ${definition.name}：+${fromLevel} → +${fromLevel + 1}\n成功率：${Math.round(preview.success * 1000) / 10}%\n消耗材料：${fullList || "无"}\n失败仅消耗材料，等级保持 +${fromLevel}，不会回退或降级。\n确认执行强化？`;
    if (!window.confirm(tip)) return false;
  }
  const result = dispatchGameAction(gameState, { type:"equipment/enhance", targetRef }, Date.now());
  if (!result.changed) {
    const messages = {
      "insufficient-minerals":"精炼矿物不足",
      "missing-donor":"缺少同型号 +0 装备",
      "insufficient-core":"缺少对应核心",
      "insufficient-protocol":"缺少对应协议",
      "equipment-installed":"装备已安装，需先卸载",
      "unknown-equipment":"装备不存在"
    };
    showToast(messages[result.reason] || "强化失败");
    return false;
  }
  showToast(result.success
    ? `${definition.name} 强化成功：+${result.fromLevel} → +${result.toLevel}，获得 ${result.xp} 经验`
    : `强化失败，等级保持 +${result.fromLevel}，本次材料已消耗`);
  renderCargoPage("equipment");
  renderCombatPanel();
  updateUI();
  return true;
}

function equipShip(shipRef) {
  const result = dispatchGameAction(gameState, { type:"hangar/equipCombatShip", instanceId:shipRef }, Date.now());
  if (!result.changed) { if (result.reason === "repairing") showToast("舰船自动维修中，暂时不能更换战斗舰"); return false; }
  renderHangarPanel(); renderCombatPanel(); showToast(result.config.name + " 已装备，准备出击！"); return true;
}

function equipIndustrialShip(shipRef) { return equipShip(shipRef); }

function unequipIndustrialShip() {
  const result = dispatchGameAction(gameState, { type:"hangar/clearIndustrialShip" }, Date.now());
  if (result.changed) { renderHangarPanel(); showToast("工业舰已卸下"); }
  return result.changed;
}

function repairShip() {
  showToast("舰船损毁后只能等待 180 秒自动维修，不能手动修复");
  return false;
}

function getOrbitSlotType(index) { return index < 8 ? "high" : index < 16 ? "mid" : index < 24 ? "low" : "rig"; }
const ORBIT_TYPE_NAMES = { high:"高槽", mid:"中槽", low:"低槽", rig:"改装件" };
const ORBIT_TYPE_ICONS = { high:"⚡", mid:"🛡", low:"⚙", rig:"🔮" };

function openEquipOrbit(shipRef) {
  const display = getShipFittingDisplayState(gameState, shipRef); if (!display) return;
  if (display.combatLocked) { showToast("战斗中不能调整当前舰船装备"); return; }
  orbitShipId = display.instanceId;
  const title = document.getElementById("equipOrbitTitle"); if (title) title.textContent = display.name;
  const subtitle = document.getElementById("equipOrbitSub"); if (subtitle) subtitle.textContent = display.tier + " · " + display.typeName;
  const modal = document.getElementById("equipOrbitModal"); if (modal) modal.classList.add("active");
  document.body.style.overflow = "hidden";
  buildOrbit(); updateOrbitLibrary(); updateOrbitStats();
}

function closeEquipOrbit() {
  const modal = document.getElementById("equipOrbitModal"); if (modal) modal.classList.remove("active");
  const panel = document.getElementById("equipSelectPanel"); if (panel) panel.classList.remove("active");
  document.body.style.overflow = ""; orbitShipId = null; orbitSelectedIndex = null;
}

function buildOrbit() {
  const display = getShipFittingDisplayState(gameState, orbitShipId); const svg = document.getElementById("equipOrbitSvg");
  if (!display || !svg) return;
  // 分段角度按显示态槽位真实数量计算（8高+8中+8低+动态 rig 容量），不硬编码 27
  const namespace = "http://www.w3.org/2000/svg", center = 250, radius = 180, segment = Math.PI * 2 / display.orbitSlots.length;
  svg.innerHTML = "";
  for (const ring of [180, 210, 150]) { const circle = document.createElementNS(namespace, "circle"); circle.setAttribute("cx", center); circle.setAttribute("cy", center); circle.setAttribute("r", ring); circle.setAttribute("class", ring === 180 ? "orbit-ring-glow" : ring === 210 ? "orbit-ring-outer" : "orbit-ring-inner"); svg.appendChild(circle); }
  display.orbitSlots.forEach(slot => {
    const angle = slot.index * segment - Math.PI / 2 + segment / 2;
    const group = document.createElementNS(namespace, "g"); group.setAttribute("class", "slot-segment " + slot.type + (slot.enabled ? "" : " disabled"));
    const marker = document.createElementNS(namespace, "circle"); marker.setAttribute("cx", center + radius * Math.cos(angle)); marker.setAttribute("cy", center + radius * Math.sin(angle)); marker.setAttribute("r", 22); marker.setAttribute("class", slot.equipmentId ? "slot-bg-active" : "slot-bg"); group.appendChild(marker);
    const label = document.createElementNS(namespace, "text"); label.setAttribute("x", center + radius * Math.cos(angle)); label.setAttribute("y", center + radius * Math.sin(angle) + 5); label.setAttribute("text-anchor", "middle"); label.setAttribute("class", "slot-icon"); label.textContent = slot.icon || ORBIT_TYPE_ICONS[slot.type]; group.appendChild(label);
    if (slot.enabled) group.addEventListener("click", event => { event.stopPropagation(); openOrbitSelect(slot.index); });
    svg.appendChild(group);
  });
  const ship = document.createElementNS(namespace, "text"); ship.setAttribute("x", center); ship.setAttribute("y", center + 10); ship.setAttribute("text-anchor", "middle"); ship.setAttribute("class", "ship-icon"); ship.textContent = "🚀"; svg.appendChild(ship);
}

function openOrbitSelect(index) {
  const display = getShipFittingDisplayState(gameState, orbitShipId); if (!display) return;
  const slot = display.orbitSlots.find(item => item.index === index); if (!slot || !slot.enabled) return;
  orbitSelectedIndex = index;
  const panel = document.getElementById("equipSelectPanel"), options = document.getElementById("equipSelectOptions"), title = document.getElementById("equipSelectTitle");
  if (!panel || !options) return;
  if (title) title.textContent = ORBIT_TYPE_NAMES[slot.type] + " · 选择装备";
  // rig 槽候选按槽位取（替换场景排除当前槽的同组判定，允许同系列升级）；其余槽仍按类型取
  const available = slot.type === "rig"
    ? ((display.rigCandidates && display.rigCandidates[slot.slotIndex]) || [])
    : (display.inventoryBySlot[slot.type] || []);
  if (slot.type === "rig") {
    // 改装件槽：拆卸即销毁（不返还库存）。占用槽提供"销毁"按钮；替换=旧件销毁+新件安装。
    const destroyButton = slot.equipmentId
      ? '<button class="equip-option empty-option" data-rig-destroy="1"><span class="eq-icon">🗑</span><span class="eq-name">销毁改装件（不返还）</span></button>'
      : "";
    const hint = '<div class="equip-option-hint" style="padding:6px 10px;font-size:11px;color:#8a6d3b;">⚠ 改装件安装后拆卸/替换即销毁，同类改装件不能重复安装</div>';
    options.innerHTML = hint + destroyButton + (available.length
      ? available.map(item => `<button class="equip-option" data-equip="${item.id}"><span class="eq-icon">${item.icon}</span><span class="eq-name">${item.name}${item.isInstance ? " +" + item.enhancementLevel : ""}</span></button>`).join("")
      : '<div class="equip-option-hint" style="padding:6px 10px;font-size:12px;color:#4a5a6a;">仓库中没有可安装的改装件</div>');
  } else {
    options.innerHTML = '<button class="equip-option empty-option" data-equip=""><span class="eq-icon">○</span><span class="eq-name">卸下装备</span></button>' + available.map(item => `<button class="equip-option" data-equip="${item.id}"><span class="eq-icon">${item.icon}</span><span class="eq-name">${item.name}${item.isInstance ? " +" + item.enhancementLevel : ""}</span></button>`).join("");
  }
  panel.style.left = "auto"; panel.style.right = "-10px"; panel.style.top = "50%"; panel.style.transform = "translateY(-50%)"; panel.classList.add("active");
}

function updateOrbitLibrary() {
  const display = getShipFittingDisplayState(gameState, orbitShipId); const container = document.getElementById("equipLibrary");
  if (!display || !container) return;
  container.innerHTML = display.equipped.length ? display.equipped.map(item => `<span class="el-item">${item.icon} ${item.name}</span>`).join("") : '<span class="el-item" style="color:#4a5a6a;">暂无装备</span>';
}

function updateOrbitStats() {
  const display = getShipFittingDisplayState(gameState, orbitShipId); if (!display) return;
  const values = { orbitStatShield:display.stats.shield, orbitStatArmor:display.stats.armor, orbitStatHull:display.stats.structure, orbitStatSpeed:display.stats.speed };
  for (const [id, value] of Object.entries(values)) { const element = document.getElementById(id); if (element) element.textContent = value; }
}

function renderQueuePanel() {
  const display = getQueueDisplayState(gameState);
  const status = document.getElementById("queue-status-text"); if (status) status.textContent = display.statusText;
  const loop = document.getElementById("queue-loop-check"); if (loop) loop.checked = display.loopMode;
  const list = document.getElementById("queue-list"); if (!list) return display;
  list.innerHTML = display.items.length ? display.items.map(item => `<div class="queue-item${item.active ? " active" : ""}"><span class="qi-idx">${item.index + 1}</span><span class="qi-icon">${item.icon}</span><div class="qi-info"><span class="qi-name">${item.skillLabel} · ${item.label}</span><span class="qi-detail">${item.countText}</span></div><span class="qi-status ${item.active ? "running" : "waiting"}">${item.active ? "执行中" : "等待"}</span><div class="qi-actions">${item.canMoveUp ? `<button class="qi-btn" data-queue-action="up" data-index="${item.index}">↑</button>` : ""}${item.canMoveDown ? `<button class="qi-btn" data-queue-action="down" data-index="${item.index}">↓</button>` : ""}<button class="qi-btn" data-queue-action="remove" data-index="${item.index}">✕</button></div></div>`).join("") : '<div style="text-align:center;color:#4a5a6a;padding:20px;font-size:13px;">队列为空，从技能面板点击"加入队列"添加任务</div>';
  return display;
}

function addCurrentToQueue() {
  const skill = currentView;
  let target = "", label = "";
  if (skill === "mining") { const area = getMiningArea(); target = area.ore; label = area.ore; }
  else if (skill === "refining") { const recipe = getSmeltingRecipe(); target = recipe.name; label = recipe.consumeOre + "→" + recipe.outputMineral; }
  else if (skill === "gasHarvesting") { const area = getGasArea(); target = area.gas; label = area.gas; }
  else if (skill === "shipEngineering") { const recipe = gameState.currentAction.shipSubAction === "assembly" ? getShipAsmRecipe() : getShipCompRecipe(); target = recipe.name; label = recipe.name; }
  else if (skill === "equipmentEngineering") { const recipe = getEquipEngRecipe(); target = recipe.id; label = recipe.name; }
  else if (skill === "archaeology") { const arch = gameState.archaeology; const site = arch.activeSiteId; if (site) { target = site; label = getArchaeologySite(site)?.name || site; } }
  else if (skill === "boosterEngineering") { const recipe = gameState.currentAction.boosterRecipeTarget; const item = getBoosterItem(recipe); if (item) { target = recipe; label = item.name; } }
  if (!target) return false;
  const changed = addToQueue(skill, target, label); if (changed) showToast("已加入队列：" + getQueueSkillLabel(skill) + " · " + (typeof transformDisplayText === "function" ? transformDisplayText(label) : label));
  return changed;
}

/* ================================================================
   新手引导常驻小部件（Batch P：右上角 / 移动端底栏）
   设计约束：仅读取 tutorial 显示态，绝不修改 gameState.tutorial；
   折叠与支线切换仅保存在模块级临时变量（不写入存档）。
   交互委托 + 5 个具体事件监听器均只安装一次。
   ================================================================ */
let _tutorialWidgetCollapsed = false;
let _tutorialWidgetBranch = "prologue"; // 仅 UI 临时变量，不写 gameState
let _tutorialWidgetUpdateUIWrapped = false;
let _tutorialWidgetListenersInstalled = false;
let _tutorialWidgetRenderQueued = false;

function getTutorialSystemGlobal() {
  if (typeof window !== "undefined" && window.TutorialSystem && typeof window.TutorialSystem.getTutorialDisplayState === "function") return window.TutorialSystem;
  if (typeof globalThis !== "undefined" && globalThis.TutorialSystem && typeof globalThis.TutorialSystem.getTutorialDisplayState === "function") return globalThis.TutorialSystem;
  return null;
}

function getTutorialWidgetDisplay() {
  const ts = getTutorialSystemGlobal();
  if (!ts) return null;
  let state = null;
  try { state = (typeof gameState !== "undefined") ? gameState : null; } catch (e) { state = null; }
  if (!state || !state.tutorial) return null;
  try { return ts.getTutorialDisplayState(state); } catch (e) { return null; }
}

function twEsc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function twSet(el, html) { if (el) el.innerHTML = html; }

// 统一经 dispatchGameAction 派发新手任务动作；失败显示简短中文 toast（不吞掉 reason）
function twDispatch(action) {
  let gs = null;
  try { gs = (typeof gameState !== "undefined") ? gameState : null; } catch (e) { gs = null; }
  if (!gs) { showToast("游戏状态尚未就绪"); return; }
  let result = null;
  try { result = dispatchGameAction(gs, action, Date.now()); }
  catch (e) { showToast("操作失败：" + (e && e.message ? e.message : "未知错误")); return; }
  if (!result || !result.changed) {
    showToast("操作未完成：" + ((result && result.reason) ? result.reason : "未知原因"));
    return;
  }
  // 成功后依赖 5 个具体事件重新渲染；此处额外主动重渲一次以防事件未触发
  renderTutorialWidget();
}

function twActButton(act, taskId, track, label, kind, preview) {
  const dataAct = ' data-act="' + act + '"' + (taskId ? ' data-task="' + taskId + '"' : "") + (track ? ' data-track="' + track + '"' : "");
  const previewAttr = preview ? ' title="' + twEsc(preview) + '"' : "";
  const cls = "tw-btn " + (kind || "tw-btn-primary");
  return '<button type="button" class="' + cls + '"' + dataAct + previewAttr + '>' + twEsc(label) + '</button>';
}

function twStatusClass(isLocked, isCompleted, isClaimable) {
  if (isCompleted) return "tw-status-completed";
  if (isLocked) return "tw-status-locked";
  if (isClaimable) return "tw-status-claimable";
  return "tw-status-active";
}

// 复用侧边栏真实路由：按 data-skill / data-page 决定目标类型，而不是用 gameState.skills 猜测。
// 背景坑：planetary / archaeology 既是 gameState.skills 的键，又是页面名（sidebar 用 data-page）。
// 若按 skills 猜测会误判成 skill 视图、调 switchSkill 跳错页；查真实 DOM 才与 sidebar 点击行为完全一致。
function twResolveTargetKind(target) {
  let doc = null; try { doc = (typeof document !== "undefined") ? document : null; } catch (e) { doc = null; }
  if (doc && typeof doc.querySelector === "function") {
    if (doc.querySelector('.sidebar .nav-item[data-skill="' + target + '"]')) return "skill";
    if (doc.querySelector('.sidebar .nav-item[data-page="' + target + '"]')) return "page";
  }
  // 降级（无 DOM 环境，如测试沙箱）：用 gameState.skills 猜测，与旧逻辑一致
  const gs = (typeof gameState !== "undefined") ? gameState : null;
  if (gs && gs.skills && gs.skills[target]) return "skill";
  return "page";
}

function twIsOnTargetPage(target) {
  if (twResolveTargetKind(target) === "skill") return (currentPage === "skill" && currentView === target);
  return (currentPage === target);
}

function twGoToTarget(target) {
  // 复用现有导航机制：与 sidebar nav-item 的 data-skill / data-page 完全一致
  if (twResolveTargetKind(target) === "skill") switchSkill(target); else switchPage(target);
}

// ---- 渲染：读取显示态并填充静态外壳（不改动任何状态）----
function renderTutorialWidget() {
  // 惰性包裹 updateUI：保证任意 updateUI() 调用后小部件也刷新（不修改 render.js）
  ensureTutorialWidgetUpdateUIWrap();

  const widget = document.getElementById("tutorial-widget");
  const toggleEl = document.getElementById("tutorial-widget-toggle");
  const progressEl = document.getElementById("tutorial-widget-progress");
  const tabsEl = document.getElementById("tutorial-widget-branch-tabs");
  const dialogueEl = document.getElementById("tutorial-widget-dialogue");
  const objectiveEl = document.getElementById("tutorial-widget-objective");
  const actionsEl = document.getElementById("tutorial-widget-actions");

  // 折叠状态仅作用于 DOM class（不写入 gameState）
  if (widget) {
    widget.classList.toggle("collapsed", _tutorialWidgetCollapsed);
    widget.setAttribute("aria-expanded", _tutorialWidgetCollapsed ? "false" : "true");
  }
  if (toggleEl) {
    toggleEl.textContent = _tutorialWidgetCollapsed ? "展开" : "收起";
    toggleEl.setAttribute("aria-expanded", _tutorialWidgetCollapsed ? "false" : "true");
  }

  const display = getTutorialWidgetDisplay();
  if (!display) {
    twSet(progressEl, ""); twSet(tabsEl, ""); twSet(dialogueEl, ""); twSet(objectiveEl, ""); twSet(actionsEl, "");
    return;
  }

  // 选定支线：P7 前仅序章；分支未解锁时强制回退序章
  if (!display.branchesUnlocked && _tutorialWidgetBranch !== "prologue") _tutorialWidgetBranch = "prologue";
  const chapterId = _tutorialWidgetBranch;
  const chapter = (display.chapterById && display.chapterById[chapterId]) || (display.chapterById && display.chapterById.prologue) || null;
  const task = (chapter && chapter.currentTaskId && display.taskById[chapter.currentTaskId]) ? display.taskById[chapter.currentTaskId] : null;

  // ---- 进度头：总进度 + 当前支线进度 ----
  const totalPct = display.totalCount > 0 ? Math.round((display.completedCount / display.totalCount) * 100) : 0;
  let progressHtml = "";
  progressHtml += '<div class="tw-chapter-name">' + twEsc(chapter ? chapter.name : "新手引导") + (chapter ? " · " + chapter.completed + "/" + chapter.total : "") + '</div>';
  // 全部完成时给出明确的收尾文案（仍保留 X/Y 计数，卡片继续可展开、不出现跳过入口）
  progressHtml += '<div class="tw-total">' + (display.allCompleted ? "培训档案完成 " : "已完成 ") + display.completedCount + "/" + display.totalCount + '</div>';
  progressHtml += '<div class="tw-bar"><div class="tw-bar-fill" style="width:' + totalPct + '%"></div></div>';
  twSet(progressEl, progressHtml);

  // ---- 支线选项卡 ----
  const chapterOrder = display.chapters || [];
  let tabsHtml = "";
  for (const c of chapterOrder) {
    const enabled = display.branchesUnlocked || c.id === "prologue";
    const active = c.id === chapterId;
    const disabledAttr = enabled ? "" : ' disabled aria-disabled="true"';
    tabsHtml += '<button type="button" class="tw-tab' + (active ? " active" : "") + '" data-branch="' + twEsc(c.id) + '"' + disabledAttr + '>' + twEsc(c.name) + '</button>';
  }
  twSet(tabsEl, tabsHtml);

  // ---- 对话（讲者 + 简报）----
  if (task) {
    let dlg = "";
    if (task.speaker) dlg += '<div class="tw-speaker">' + twEsc(task.speaker) + '</div>';
    if (task.briefing) dlg += '<div class="tw-line">' + twEsc(task.briefing) + '</div>';
    twSet(dialogueEl, dlg);
  } else {
    const allDone = chapter && chapter.total > 0 && chapter.completed === chapter.total;
    twSet(dialogueEl, '<div class="tw-line">' + (allDone ? "本章全部任务已完成。" : "本章暂无进行中的任务。") + '</div>');
  }

  // ---- 目标 + 奖励 + 状态 ----
  let objHtml = "";
  if (task) {
    const statusCls = twStatusClass(task.isLocked, task.isCompleted, task.isClaimable);
    objHtml += '<div class="tw-task ' + statusCls + '">';
    objHtml += '<div class="tw-task-title"><span class="tw-task-index">' + twEsc(task.chapterName) + " · 任务 " + task.order + '</span>' + twEsc(task.title) + '</div>';
    if (task.objectiveText) objHtml += '<div class="tw-objective-text">' + twEsc(task.objectiveText) + '</div>';
    if (task.progressSummary && task.progressSummary.text) objHtml += '<div class="tw-objective-progress">' + twEsc(task.progressSummary.text) + '</div>';
    if (task.rewardItems && task.rewardItems.length) {
      const rewardText = task.rewardItems.map(x => twEsc(x.text)).join("、");
      objHtml += '<div class="tw-reward">奖励：' + rewardText + '</div>';
    } else if (task.canChooseCombatTrack && task.trackOptions) {
      objHtml += '<div class="tw-reward">奖励：选择战斗方向后确定（含专属舰船与装备）</div>';
    }
    if (task.isCompleted && task.completionText) {
      objHtml += '<div class="tw-completion">' + twEsc(task.completionText) + '</div>';
      if (task.rewardClaimed) objHtml += '<div class="tw-claimed">奖励已领取</div>';
    }
    objHtml += '</div>';
  } else {
    objHtml += '<div class="tw-empty">暂无可用任务</div>';
  }
  twSet(objectiveEl, objHtml);

  // ---- 动作按钮 ----
  let actHtml = "";
  // 应急舰船（顶层条件，与当前任务无关）
  if (display.emergencyShipAvailable) {
    actHtml += twActButton("claimEmergency", null, null, "领取应急舰船", "tw-btn-primary", "完成 P5 后无舰船时可领取一次性应急舰船");
  }
  if (task && !task.isLocked) {
    if (task.canChooseCombatTrack && task.trackOptions) {
      for (const opt of task.trackOptions) {
        actHtml += twActButton("chooseTrack", task.id, opt.track, opt.label + "方向", "tw-btn-track", opt.previewText);
      }
    } else if (task.canConfirm) {
      const label = (task.id === "P7") ? "开启三条职业支线" : "确认完成";
      actHtml += twActButton("confirm", task.id, null, label, "tw-btn-primary", null);
    } else if (task.canClaim) {
      let label = "领取";
      if (task.id === "I1" || task.id === "I4") {
        // 支援包领取后按钮消失、任务保持 active
        if (!task.supportClaimed) label = "领取支援包"; else label = null;
      } else if (task.id === "I6" || task.id === "I7" || task.id === "A6" || task.id === "C6") {
        label = "领取奖励";
      }
      if (label) actHtml += twActButton("claim", task.id, null, label, "tw-btn-primary", null);
    }
    // 导航按钮：有 navigationTarget 且当前不在目标页时显示「前往执行」
    if (task.navigationTarget && !twIsOnTargetPage(task.navigationTarget)) {
      actHtml += '<button type="button" class="tw-btn tw-btn-secondary" data-act="nav" data-nav="' + twEsc(task.navigationTarget) + '">前往执行</button>';
    }
  }
  if (!actHtml) actHtml = '<div class="tw-no-action"></div>';
  twSet(actionsEl, actHtml);
}

// 教程事件在同一次 dispatch 内部同步派发，早于该次 dispatch 末尾的「解锁下一任务」收尾：
// 事件回调看到的是中间态（上一任务刚完成、下一任务仍 locked），只渲染一次会把动作区永久留在空态。
// 因此事件回调统一走本函数：先立即渲染一次（即时反馈），再在结算后补渲一次（宏任务，合并去重）。
function twRenderSoon() {
  renderTutorialWidget();
  if (_tutorialWidgetRenderQueued) return;
  if (typeof setTimeout !== "function") return; // 无定时器环境（测试沙箱）仅保留即时渲染
  _tutorialWidgetRenderQueued = true;
  setTimeout(() => {
    _tutorialWidgetRenderQueued = false;
    try { renderTutorialWidget(); } catch (e) { /* 补渲失败不得影响核心流程 */ }
  }, 0);
}

// ---- 5 个具体事件处理器（纯读，不推进/发放，仅重渲 + 非阻塞 toast）----
function twOnTaskCompleted(event) {
  const display = getTutorialWidgetDisplay();
  const taskId = event && event.payload ? event.payload.taskId : null;
  if (display && taskId && display.taskById[taskId] && display.taskById[taskId].completionText) {
    showToast(display.taskById[taskId].completionText);
  }
  twRenderSoon();
}
function twOnRewardClaimed() { twRenderSoon(); }
function twOnBranchesUnlocked() {
  if (_tutorialWidgetBranch === "prologue") _tutorialWidgetBranch = "industrial"; // 解锁后默认切到首条支线
  twRenderSoon();
}
function twOnCombatTrackSelected() { twRenderSoon(); }
function twOnEmergencyShipGranted() { twRenderSoon(); }

// 惰性包裹全局 updateUI：让每次 updateUI() 也刷新小部件（不修改 render.js）
function ensureTutorialWidgetUpdateUIWrap() {
  if (_tutorialWidgetUpdateUIWrapped) return;
  let ui = null;
  if (typeof window !== "undefined" && typeof window.updateUI === "function") ui = window.updateUI;
  else if (typeof globalThis !== "undefined" && typeof globalThis.updateUI === "function") ui = globalThis.updateUI;
  if (!ui) return; // render.js 晚于本脚本，首次 renderTutorialWidget 调用时再尝试
  const _orig = ui;
  const wrapped = function (now) {
    const r = _orig.apply(this, arguments);
    try { renderTutorialWidget(); } catch (e) { /* 小部件渲染错误不得中断核心 UI 刷新 */ }
    return r;
  };
  if (typeof window !== "undefined") window.updateUI = wrapped;
  if (typeof globalThis !== "undefined") globalThis.updateUI = wrapped;
  _tutorialWidgetUpdateUIWrapped = true;
}

// 安装事件监听器与交互委托（仅一次）
function installTutorialWidgetListeners() {
  if (_tutorialWidgetListenersInstalled) return;
  const GE = (typeof GameEvents !== "undefined" && GameEvents) || (typeof window !== "undefined" && window.GameEvents) || (typeof globalThis !== "undefined" && globalThis.GameEvents) || null;
  if (GE && typeof GE.on === "function") {
    // 仅监听 5 个具体事件，绝不监听 "*" 通配；监听器只安装一次
    GE.on("tutorial:taskCompleted", twOnTaskCompleted);
    GE.on("tutorial:rewardClaimed", twOnRewardClaimed);
    GE.on("tutorial:branchesUnlocked", twOnBranchesUnlocked);
    GE.on("tutorial:combatTrackSelected", twOnCombatTrackSelected);
    GE.on("tutorial:emergencyShipGranted", twOnEmergencyShipGranted);
  }
  const toggleEl = document.getElementById("tutorial-widget-toggle");
  if (toggleEl) toggleEl.addEventListener("click", () => {
    _tutorialWidgetCollapsed = !_tutorialWidgetCollapsed;
    renderTutorialWidget();
  });
  const tabsEl = document.getElementById("tutorial-widget-branch-tabs");
  if (tabsEl) tabsEl.addEventListener("click", (event) => {
    const btn = event.target && event.target.closest ? event.target.closest("[data-branch]") : null;
    if (!btn || btn.disabled) return;
    const branch = btn.getAttribute("data-branch");
    if (!branch) return;
    _tutorialWidgetBranch = branch;
    renderTutorialWidget();
  });
  const actionsEl = document.getElementById("tutorial-widget-actions");
  if (actionsEl) actionsEl.addEventListener("click", (event) => {
    const btn = event.target && event.target.closest ? event.target.closest("button[data-act]") : null;
    if (!btn || btn.disabled) return;
    const act = btn.getAttribute("data-act");
    const taskId = btn.getAttribute("data-task");
    const track = btn.getAttribute("data-track");
    if (act === "claim") twDispatch({ type: "tutorial/claim", taskId: taskId });
    else if (act === "confirm") twDispatch({ type: "tutorial/confirm", taskId: taskId });
    else if (act === "chooseTrack") twDispatch({ type: "tutorial/chooseCombatTrack", track: track });
    else if (act === "claimEmergency") twDispatch({ type: "tutorial/claimEmergencyShip" });
    else if (act === "nav") twGoToTarget(btn.getAttribute("data-nav"));
  });
  _tutorialWidgetListenersInstalled = true;
}

(function bindShellUI() {
  document.querySelectorAll(".sidebar .nav-item[data-skill], .sidebar .nav-item[data-page]").forEach(item => item.addEventListener("click", () => {
    if (item.dataset.combatToggle !== undefined) {
      dispatchGameAction(gameState, { type:"settings/toggleCombatSkills" }, Date.now());
      switchSkill("combat");
      return;
    }
    if (item.dataset.skill && gameState.skills[item.dataset.skill]) switchSkill(item.dataset.skill); else if (item.dataset.page) switchPage(item.dataset.page);
  }));
  document.querySelectorAll(".cargo-tab").forEach(tab => tab.addEventListener("click", () => renderCargoPage(tab.dataset.filter)));
  const blueprintTabs = document.getElementById("blueprintstore-tabs"); if (blueprintTabs) blueprintTabs.addEventListener("click", event => {
    const button = event.target.closest("[data-blueprint-category]"); if (!button) return;
    blueprintStoreCategory = button.dataset.blueprintCategory; renderBlueprintStore();
  });
  const blueprintGrid = document.getElementById("blueprintstore-grid"); if (blueprintGrid) blueprintGrid.addEventListener("click", event => {
    const button = event.target.closest("[data-blueprint-item]");
    if (button && !button.disabled) buyBlueprintStoreItem(button.dataset.blueprintItem, button.dataset.blueprintKind);
  });
  const hangar = document.getElementById("hangar-ship-grid"); if (hangar) hangar.addEventListener("click", event => {
    const enhance = event.target.closest("[data-enhance-ship]");
    if (enhance) { enhanceShipFromHangar(enhance.dataset.enhanceShip); return; }
    const assignment = event.target.closest("[data-ship-action]");
    if (assignment) {
      const result = dispatchGameAction(gameState, { type:"hangar/toggleAssignment", instanceId:assignment.dataset.sid, actionKey:assignment.dataset.shipAction }, Date.now());
      if (!result.changed && result.reason === "repairing") showToast("舰船自动维修中，暂时不能更换战斗舰");
      else if (!result.changed && result.reason === "unsupported-mining") showToast("该舰船没有采矿岗位");
      else if (!result.changed && result.reason === "unsupported-gas") showToast("该舰船没有采气岗位");
      else if (!result.changed && result.reason === "unsupported-refining") showToast("只有工业支援舰可以承担冶炼岗位");
      else if (!result.changed && result.reason === "unsupported-task") showToast("该任务不需要分配舰船岗位");
      else if (!result.changed && result.reason === "ship-active") showToast("舰船正在执行任务，停止当前任务后才能重新分配");
      if (result.changed) { renderHangarPanel(); renderCombatPanel(); }
      return;
    }
    const fitting = event.target.closest("[data-open-fitting]"); if (fitting) openEquipOrbit(fitting.dataset.openFitting);
  });
  const enhPanel = document.getElementById("equipment-enhancement-list"); if (enhPanel) enhPanel.addEventListener("click", event => {
    const btn = event.target.closest("[data-enhance-target]");
    if (btn && !btn.disabled) enhanceEquipmentFromWarehouse(decodeURIComponent(btn.dataset.enhanceTarget));
  });
  const fittingOptions = document.getElementById("equipSelectOptions"); if (fittingOptions) fittingOptions.addEventListener("click", event => {
    const option = event.target.closest("[data-equip],[data-rig-destroy]"); if (!option || orbitSelectedIndex === null) return;
    const display = getShipFittingDisplayState(gameState, orbitShipId); const slot = display && display.orbitSlots.find(item => item.index === orbitSelectedIndex); if (!slot) return;
    let result;
    if (slot.type === "rig") {
      // 改装件槽：销毁 / 替换 / 安装均走专属 Action（事件契约 rig:destroyed / rig:replaced / rig:fitted）
      if (option.dataset.rigDestroy) {
        if (!confirm("确定销毁「" + (slot.name || "该改装件") + "」吗？\n\n⚠ 改装件拆卸即销毁，不会返还仓库，此操作不可撤销！")) return;
        result = dispatchGameAction(gameState, { type:"hangar/destroyFittedRig", instanceId:orbitShipId, slotIndex:slot.slotIndex }, Date.now());
      } else if (slot.equipmentId) {
        const newName = (EQUIPMENT_DB[option.dataset.equip] || {}).name || option.dataset.equip;
        if (!confirm("确定用「" + newName + "」替换「" + (slot.name || "当前改装件") + "」吗？\n\n⚠ 被替换的旧改装件将被销毁，不会返还仓库，此操作不可撤销！")) return;
        result = dispatchGameAction(gameState, { type:"hangar/replaceFittedRig", instanceId:orbitShipId, slotIndex:slot.slotIndex, rigItemId:option.dataset.equip }, Date.now());
      } else {
        result = dispatchGameAction(gameState, { type:"hangar/fitRig", instanceId:orbitShipId, slotIndex:slot.slotIndex, rigItemId:option.dataset.equip }, Date.now());
      }
      if (!result.changed && result.reason === "combat-active") showToast("战斗中不能调整当前舰船装备");
      else if (!result.changed && result.reason === "same-stack-group-exists") showToast("同类改装件已安装，不能重复安装");
      else if (!result.changed && result.reason === "slot-occupied") showToast("该改装槽已被占用");
      else if (!result.changed && result.reason === "equipment-unavailable") showToast("仓库中没有该改装件");
      else if (!result.changed && result.reason) showToast("操作失败：" + result.reason);
    } else {
      result = dispatchGameAction(gameState, { type:"hangar/setFittingSlot", instanceId:orbitShipId, slot:slot.type, slotIndex:slot.slotIndex, equipmentId:option.dataset.equip || null }, Date.now());
      if (!result.changed && result.reason === "combat-active") showToast("战斗中不能调整当前舰船装备");
      else if (!result.changed && result.reason === "incompatible-equipment") showToast("该装备只能安装在旗舰或超级旗舰上");
      else if (!result.changed && result.reason === "equipment-unavailable") showToast("该装备不存在或已被使用");
      else if (!result.changed && result.reason === "equipment-installed") showToast("该装备已安装在其他舰船上");
      else if (!result.changed && result.reason) showToast("操作失败：" + result.reason);
    }
    const panel = document.getElementById("equipSelectPanel"); if (panel) panel.classList.remove("active");
    buildOrbit(); updateOrbitLibrary(); updateOrbitStats(); renderHangarPanel();
  });
  const orbitClose = document.getElementById("equipOrbitClose"); if (orbitClose) orbitClose.addEventListener("click", closeEquipOrbit);
  const orbitDone = document.getElementById("equipDoneBtn"); if (orbitDone) orbitDone.addEventListener("click", closeEquipOrbit);
  const orbitModal = document.getElementById("equipOrbitModal"); if (orbitModal) orbitModal.addEventListener("click", event => { if (event.target === orbitModal) closeEquipOrbit(); });
  const orbitReset = document.getElementById("equipResetBtn"); if (orbitReset) orbitReset.addEventListener("click", () => {
    if (!orbitShipId) return;
    // 从真实显示态读取已装改装件，逐件列出即将销毁的名称（同名合并计数）。
    // 此确认为破坏性操作专用，使用原生 confirm，不受设置中的强化提示开关控制。
    const display = getShipFittingDisplayState(gameState, orbitShipId); if (!display) return;
    const fittedRigNames = display.orbitSlots.filter(slot => slot.type === "rig" && slot.equipmentId).map(slot => slot.name || slot.equipmentId);
    let message = "确定清空所有装备吗？\n\n普通装备将返还仓库（保留为未安装实例）。";
    if (fittedRigNames.length) {
      const counts = new Map();
      for (const name of fittedRigNames) counts.set(name, (counts.get(name) || 0) + 1);
      const lines = [...counts.entries()].map(([name, count]) => "  · " + name + (count > 1 ? " ×" + count : ""));
      message += "\n\n⚠ 以下改装件将被永久销毁（不返还）：\n" + lines.join("\n");
    }
    if (!confirm(message)) return;
    const result = dispatchGameAction(gameState, { type:"hangar/resetFitting", instanceId:orbitShipId }, Date.now());
    if (result.changed) { buildOrbit(); updateOrbitLibrary(); updateOrbitStats(); renderHangarPanel(); }
  });
  const queueList = document.getElementById("queue-list"); if (queueList) queueList.addEventListener("click", event => {
    const button = event.target.closest("[data-queue-action]"); if (!button) return;
    const index = Number(button.dataset.index), action = button.dataset.queueAction;
    if (action === "remove") removeFromQueue(index); else if (action === "up") moveQueueItem(index, index - 1); else if (action === "down") moveQueueItem(index, index + 1);
    renderQueuePanel();
  });
  const startQueueButton = document.getElementById("btn-start-queue"); if (startQueueButton) startQueueButton.addEventListener("click", () => { if (startQueue()) { currentView = gameState.currentAction.skill; renderQueuePanel(); updateUI(); } });
  const stopQueueButton = document.getElementById("btn-stop-queue"); if (stopQueueButton) stopQueueButton.addEventListener("click", () => { stopQueue(); renderQueuePanel(); updateUI(); });
  const clearQueueButton = document.getElementById("btn-clear-queue"); if (clearQueueButton) clearQueueButton.addEventListener("click", () => { if (confirm("确定清空队列？")) { clearQueue(); renderQueuePanel(); } });
  const loop = document.getElementById("queue-loop-check"); if (loop) loop.addEventListener("change", () => dispatchGameAction(gameState, { type:"queue/setLoop", enabled:loop.checked }, Date.now()));
  const enhancementConfirm = document.getElementById("setting-enhancement-confirm"); if (enhancementConfirm) enhancementConfirm.addEventListener("change", () => {
    const result = dispatchGameAction(gameState, { type:"settings/setShipEnhancementConfirmation", enabled:enhancementConfirm.checked }, Date.now());
    if (result.changed) { renderSettingsPage(); showToast(result.enabled ? "舰船强化确认提示已开启" : "舰船强化确认提示已关闭"); }
  });
  const achievementCategoryTabs = document.getElementById("achievements-category-tabs"); if (achievementCategoryTabs) achievementCategoryTabs.addEventListener("click", event => {
    const button = event.target.closest("[data-ach-category]"); if (!button) return;
    renderAchievementsPage(button.dataset.achCategory, achievementStatusFilter);
  });
  const achievementStatusTabs = document.getElementById("achievements-status-tabs"); if (achievementStatusTabs) achievementStatusTabs.addEventListener("click", event => {
    const button = event.target.closest("[data-ach-status]"); if (!button) return;
    renderAchievementsPage(achievementCategoryFilter, button.dataset.achStatus);
  });
  // 成就解锁播报：只读消费具体事件，不改成就状态、不重复解锁；在成就页时即时重渲。
  const achievementEvents = (typeof GameEvents !== "undefined" && GameEvents) || (typeof window !== "undefined" && window.GameEvents) || null;
  if (achievementEvents && typeof achievementEvents.on === "function") {
    achievementEvents.on("achievement:unlocked", event => {
      const achievementId = event && event.payload ? event.payload.achievementId : null;
      if (!achievementId) return;
      const data = getAchievementCatalogData();
      const definition = data && data.ACHIEVEMENTS_BY_ID ? data.ACHIEVEMENTS_BY_ID[achievementId] : null;
      if (!definition) return; // 目录外的幽灵 ID 不播报
      // Batch E：奖励文字读冻结目录 definition.reward，不按 tier 猜测、不读事件 payload
      const rewardHours = readAchievementRewardHours(definition);
      const rewardSuffix = rewardHours === null
        ? "（" + ACHIEVEMENT_NO_REWARD_TEXT + "）"
        : "（科研工时 +" + formatResearchHoursNumber(rewardHours) + "h）";
      showToast("🏆 成就解锁：" + definition.name + rewardSuffix);
      if (currentPage === "achievements") renderAchievementsPage();
    });
  }
  // Batch F 研究页：只监听具体事件（无 "*" 通配），在研究页时重绘；监听器纯读，不改状态。
  const researchEvents = (typeof GameEvents !== "undefined" && GameEvents) || (typeof window !== "undefined" && window.GameEvents) || null;
  if (researchEvents && typeof researchEvents.on === "function") {
    const redrawResearch = () => { if (currentPage === "research") renderResearchPage(); };
    researchEvents.on("research:stepCompleted", redrawResearch);
    researchEvents.on("research:hoursApplied", redrawResearch);
    researchEvents.on("research:cancelled", redrawResearch);
    researchEvents.on("achievement:researchHoursGranted", redrawResearch);
  }
  // 科技树画布：全部事件委托到容器，只注册一次；38 个节点不做逐个永久绑定。
  const researchTreeEl = document.getElementById("research-tree");
  if (researchTreeEl) {
    researchTreeEl.addEventListener("click", onResearchTreeClick);
    researchTreeEl.addEventListener("keydown", onResearchTreeKeyDown);
    researchTreeEl.addEventListener("mouseover", onResearchTreeOver);
    researchTreeEl.addEventListener("mouseout", onResearchTreeOut);
    researchTreeEl.addEventListener("focusin", onResearchTreeOver);
    researchTreeEl.addEventListener("focusout", onResearchTreeOut);
    researchTreeEl.addEventListener("pointerdown", onResearchTreePointerDown);
    researchTreeEl.addEventListener("pointermove", onResearchTreePointerMove);
    researchTreeEl.addEventListener("pointerup", onResearchTreePointerUp);
    researchTreeEl.addEventListener("pointerleave", onResearchTreePointerUp);
  }
  const researchDetailEl = document.getElementById("research-detail"); if (researchDetailEl) { researchDetailEl.addEventListener("click", onResearchDetailClick); researchDetailEl.addEventListener("keydown", onResearchDetailKey); }
  const researchQueueEl = document.getElementById("research-queue"); if (researchQueueEl) researchQueueEl.addEventListener("click", onResearchQueueClick);
  const researchActiveEl = document.getElementById("research-active"); if (researchActiveEl) researchActiveEl.addEventListener("click", onResearchActiveClick);
  const queueModalButton = document.getElementById("action-modal-queue"); if (queueModalButton) queueModalButton.addEventListener("click", queueActionConfirmation);
  document.addEventListener("keydown", event => { const modal = document.getElementById("equipOrbitModal"); if (event.key === "Escape" && modal && modal.classList.contains("active")) closeEquipOrbit(); });

  // ---- Batch P：新手引导常驻小部件 —— 事件监听器与交互委托只安装一次 ----
  installTutorialWidgetListeners();
  renderTutorialWidget();
})();
