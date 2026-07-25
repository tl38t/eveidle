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
  const ids = ["cargo-panel", "save-panel", "settings-panel", "statistics-panel", "planetary-panel", "archaeology-panel", "shipeng-panel", "equipeng-panel", "booster-panel", "queue-panel", "combat-panel", "hangar-panel", "blueprintstore-panel"];
  return ids.map(id => document.getElementById(id)).filter(Boolean);
}

function getGenericSkillPanels() {
  return [...document.querySelectorAll('.content > .panel:not(#cargo-panel):not(#save-panel):not(#settings-panel):not(#statistics-panel):not(#planetary-panel):not(#archaeology-panel):not(#shipeng-panel):not(#equipeng-panel):not(#booster-panel):not(#queue-panel):not(#combat-panel):not(#hangar-panel):not(#blueprintstore-panel)')];
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
  else if (navigation.page === "archaeology") renderArchaeologyPage();
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
    return `<div class="hangar-ship-card${ship.assignedActions.length ? " equipped" : ""}">
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
  const queueModalButton = document.getElementById("action-modal-queue"); if (queueModalButton) queueModalButton.addEventListener("click", queueActionConfirmation);
  document.addEventListener("keydown", event => { const modal = document.getElementById("equipOrbitModal"); if (event.key === "Escape" && modal && modal.classList.contains("active")) closeEquipOrbit(); });
})();
