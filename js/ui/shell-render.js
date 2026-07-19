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
  const ids = ["cargo-panel", "save-panel", "settings-panel", "statistics-panel", "planetary-panel", "shipeng-panel", "equipeng-panel", "queue-panel", "combat-panel", "hangar-panel", "blueprintstore-panel"];
  return ids.map(id => document.getElementById(id)).filter(Boolean);
}

function getGenericSkillPanels() {
  return [...document.querySelectorAll('.content > .panel:not(#cargo-panel):not(#save-panel):not(#settings-panel):not(#statistics-panel):not(#planetary-panel):not(#shipeng-panel):not(#equipeng-panel):not(#queue-panel):not(#combat-panel):not(#hangar-panel):not(#blueprintstore-panel)')];
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
  const panelId = navigation.standalonePanel || navigation.specializedSkillPanel;
  if (panelId) { const panel = document.getElementById(panelId); if (panel) panel.style.display = ""; }
  document.querySelectorAll(".sidebar .nav-item").forEach(item => item.classList.remove("active"));
  const activeSelector = navigation.activeNav.type === "skill" ? `.sidebar .nav-item[data-skill="${navigation.activeNav.value}"]` : `.sidebar .nav-item[data-page="${navigation.activeNav.value}"]`;
  const active = document.querySelector(activeSelector); if (active) active.classList.add("active");

  if (navigation.page === "skill") updateUI();
  else if (navigation.page === "cargo") renderCargoPage(cargoFilter);
  else if (navigation.page === "save") SaveManager._updateStatus("就绪");
  else if (navigation.page === "settings") renderSettingsPage();
  else if (navigation.page === "statistics") renderStatisticsPage();
  else if (navigation.page === "planetary") renderPlanetaryPage();
  else if (navigation.page === "queue") renderQueuePanel();
  else if (navigation.page === "combat") renderCombatPanel();
  else if (navigation.page === "hangar") renderHangarPanel();
  else if (navigation.page === "blueprints" || navigation.page === "lpstore") renderBlueprintStore();
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
  const display = getCargoDisplayState(gameState, cargoFilter, getCargoCapacity());
  const capacity = document.getElementById("cargo-capacity-text"); if (capacity) capacity.textContent = "容量：" + display.used.toLocaleString() + " / " + display.capacity.toLocaleString();
  document.querySelectorAll(".cargo-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.filter === display.filter));
  const list = document.getElementById("cargo-list"); if (!list) return display;
  list.innerHTML = display.items.length ? display.items.map(item => `<div class="cargo-item${item.details ? " equipment-item" : ""}"${item.details ? ` title="${item.name}\n${item.details}"` : ""}><span class="ci-icon">${item.icon}</span><span class="ci-content"><span class="ci-name">${item.name}</span>${item.details ? `<span class="ci-details">${item.details}</span>` : ""}</span><span class="ci-qty">${item.quantity.toLocaleString()}</span></div>`).join("") : `<div class="cargo-empty">${display.emptyText}</div>`;
  return display;
}

function renderBlueprintStore() {
  const display = getBlueprintStoreDisplayState(gameState, blueprintStoreCategory);
  const balance = document.getElementById("blueprintstore-balance");
  if (balance) balance.textContent = "可用 ISK：" + display.balance.isk.toLocaleString() + " · LP：" + display.balance.lp.toLocaleString();
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

function getLPStoreItems() {
  return getLPStoreCatalogItems();
}

function buyLPStoreItem(itemId) {
  const result = dispatchGameAction(gameState, { type:"shell/buyLPItem", equipmentId:itemId }, Date.now());
  if (!result.changed) {
    if (result.reason === "insufficient-lp") showToast("LP不足");
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
    if (result.reason === "insufficient-lp") showToast("LP不足");
    else if (result.reason === "insufficient-isk") showToast("ISK不足");
    else if (result.reason === "already-owned") showToast("该蓝图已拥有");
    return false;
  }
  showToast("已购买：" + (result.blueprint ? result.blueprint.name + "蓝图" : result.item.name));
  renderBlueprintStore(); updateUI(); return true;
}

function getHangarBonusText(bonuses) {
  const names = { shieldCapacity:"+护盾", armorCapacity:"+装甲", structureCapacity:"+结构", laserDamage:"+激光伤", missileDamage:"+导弹伤", cannonDamage:"+炮台伤", capacitorRecharge:"+电容", targetingSpeed:"+锁定", speed:"+速度", miningLaserEfficiency:"+采矿器效能", gasLaserEfficiency:"+采气器效能", smeltingEfficiency:"+冶炼效率", miningEfficiency:"+采矿效率", gasEfficiency:"+采气效率" };
  return Object.entries(bonuses || {}).map(([key, value]) => (names[key] || key) + " " + Math.round(value * 100) + "%").join(" · ");
}

function getEnhancementBonusText(enhancement) {
  if (!enhancement || !enhancement.available) return "该舰船暂无强化部件";
  if (enhancement.role === "combat") {
    return "生命 +" + (enhancement.hpBonus * 100).toFixed(1) + "% · 武器伤害 +" + (enhancement.damageBonus * 100).toFixed(2) + "%";
  }
  const label = enhancement.role === "gas" ? "采气效率" : enhancement.role === "industry-dual" ? "采矿/采气效率" : "采矿效率";
  return label + " +" + (enhancement.industryBonus * 100).toFixed(1) + "%";
}

function getEnhancementNextText(enhancement) {
  if (!enhancement || !enhancement.available) return "";
  if (enhancement.role === "combat") {
    return "下一级：生命 +" + (enhancement.nextHpGain * 100).toFixed(1) + "% · 武器伤害 +" + (enhancement.nextDamageGain * 100).toFixed(2) + "%";
  }
  return "下一级：最终采集效率 +" + (enhancement.nextIndustryGain * 100).toFixed(1) + "%";
}

function renderHangarPanel() {
  const display = getHangarDisplayState(gameState, Date.now());
  const info = document.getElementById("hangar-header-info"); if (info) info.textContent = "已拥有 " + display.count + " 艘舰船";
  const grid = document.getElementById("hangar-ship-grid"); const empty = document.getElementById("hangar-empty");
  if (!grid) return display;
  if (!display.ships.length) { grid.innerHTML = ""; if (empty) empty.style.display = ""; return display; }
  if (empty) empty.style.display = "none";
  grid.innerHTML = display.ships.map(ship => {
    if (ship.unknown) return "";
    const assignments = ship.assignments.map(item => `<button class="act-tag${item.active ? " on" : ""}" data-ship-action="${item.actionKey}" data-sid="${ship.instanceId}" ${item.locked ? "disabled" : ""}>${item.name}</button>`).join("");
    const bonuses = getHangarBonusText(ship.bonuses);
    const enhancement = ship.enhancement;
    const materials = enhancement.materials.map(item => `<span class="enhance-material${item.enough ? "" : " short"}">${item.name} ${item.stock}/${item.quantity}</span>`).join("");
    const enhanceDisabled = enhancement.canEnhance ? "" : "disabled";
    const enhanceLabel = enhancement.busy ? "执行任务中" : enhancement.available ? "强化至 +" + (enhancement.level + 1) : "暂不可强化";
    return `<div class="hangar-ship-card${ship.assignedActions.length ? " equipped" : ""}">
      <div class="hangar-ship-header"><span class="hsh-icon">${ship.industrial ? "🏭" : "🚀"}</span><span class="hsh-name">${ship.name}</span><span class="enhance-level${enhancement.milestone ? " milestone-next" : ""}">+${enhancement.level}</span><span class="hsh-tier">${ship.tier} ${ship.typeName}</span><span class="hsh-tier">${ship.industrial ? "🏭 工业" : "⚔️ 战斗"}</span>${ship.assignedActions.length ? `<span class="hsh-equipped">📋 ${ship.assignedActions.map(key => display.actionNames[key]).join("+")}</span>` : ""}</div>
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
  if (confirmationEnabled && ship.enhancement.level > 0 && !window.confirm("强化失败会使 " + ship.name + " 从 +" + ship.enhancement.level + " 清零，仍要继续吗？")) return false;
  const result = dispatchGameAction(gameState, { type:"hangar/enhanceShip", instanceId }, Date.now());
  if (!result.changed) {
    const messages = { "insufficient-components":"强化部件不足", "ship-active":"舰船执行任务时不能强化", "enhancement-unavailable":"该舰船暂无对应强化部件" };
    showToast(messages[result.reason] || "强化失败");
    return false;
  }
  showToast(result.success
    ? result.config.name + " 强化成功：+" + result.fromLevel + " → +" + result.toLevel + "，获得 " + result.xp + " 经验"
    : result.config.name + " 强化失败：+" + result.fromLevel + " → +0，获得 " + result.xp + " 经验");
  renderHangarPanel();
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
  const namespace = "http://www.w3.org/2000/svg", center = 250, radius = 180, segment = Math.PI * 2 / 27;
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
  const available = display.inventoryBySlot[slot.type] || [];
  options.innerHTML = '<button class="equip-option empty-option" data-equip=""><span class="eq-icon">○</span><span class="eq-name">卸下装备</span></button>' + available.map(item => `<button class="equip-option" data-equip="${item.id}"><span class="eq-icon">${item.icon}</span><span class="eq-name">${item.name}</span></button>`).join("");
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
  if (!target) return false;
  const changed = addToQueue(skill, target, label); if (changed) showToast("已加入队列：" + getQueueSkillLabel(skill) + " · " + label);
  return changed;
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
      if (result.changed) { renderHangarPanel(); renderCombatPanel(); }
      return;
    }
    const fitting = event.target.closest("[data-open-fitting]"); if (fitting) openEquipOrbit(fitting.dataset.openFitting);
  });
  const fittingOptions = document.getElementById("equipSelectOptions"); if (fittingOptions) fittingOptions.addEventListener("click", event => {
    const option = event.target.closest("[data-equip]"); if (!option || orbitSelectedIndex === null) return;
    const display = getShipFittingDisplayState(gameState, orbitShipId); const slot = display && display.orbitSlots.find(item => item.index === orbitSelectedIndex); if (!slot) return;
    const result = dispatchGameAction(gameState, { type:"hangar/setFittingSlot", instanceId:orbitShipId, slot:slot.type, slotIndex:slot.slotIndex, equipmentId:option.dataset.equip || null }, Date.now());
    if (!result.changed && result.reason === "combat-active") showToast("战斗中不能调整当前舰船装备");
    const panel = document.getElementById("equipSelectPanel"); if (panel) panel.classList.remove("active");
    buildOrbit(); updateOrbitLibrary(); updateOrbitStats(); renderHangarPanel();
  });
  const orbitClose = document.getElementById("equipOrbitClose"); if (orbitClose) orbitClose.addEventListener("click", closeEquipOrbit);
  const orbitDone = document.getElementById("equipDoneBtn"); if (orbitDone) orbitDone.addEventListener("click", closeEquipOrbit);
  const orbitModal = document.getElementById("equipOrbitModal"); if (orbitModal) orbitModal.addEventListener("click", event => { if (event.target === orbitModal) closeEquipOrbit(); });
  const orbitReset = document.getElementById("equipResetBtn"); if (orbitReset) orbitReset.addEventListener("click", () => {
    if (!orbitShipId || !confirm("确定清空所有装备吗？")) return;
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
  const queueModalButton = document.getElementById("action-modal-queue"); if (queueModalButton) queueModalButton.addEventListener("click", queueActionConfirmation);
  document.addEventListener("keydown", event => { const modal = document.getElementById("equipOrbitModal"); if (event.key === "Escape" && modal && modal.classList.contains("active")) closeEquipOrbit(); });
})();
