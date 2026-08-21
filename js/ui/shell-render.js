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

/* ---- 共享仓库物品卡（Batch R）：仓库列表 / 离线收益 / 开箱结果共用同一安全渲染 ---- */
// item 形态：{ id, name, icon, quantity, categoryLabel, source:{pageLabel} }（getCargoDisplayState 输出）
// opts 可覆写卡片段（保持旧视觉不变时由调用方传原样文本）：
//   categoryText / footText / qtyText 覆写三段文本；extraClass 追加样式类（用于离线/开箱弹窗）；
//   dataAttr 追加到卡片根元素上的 data-* 属性原文（如 data-ci="3"，由调用方转义）。
// 所有注入 innerHTML 的文本一律 escapeAchievementText 转义；icon 为受控图标字符串（不转义保持图标生效）。
function buildCargoCardHTML(item, opts) {
  const opt = opts && typeof opts === "object" ? opts : {};
  const rawName = item && item.name;
  const name = (typeof rawName === "string" && rawName) ? rawName : String((item && item.id) || "未知");
  const categoryText = opt.categoryText !== undefined ? opt.categoryText : (item.categoryLabel || "");
  const footText = opt.footText !== undefined ? opt.footText : (item.source && item.source.pageLabel) || "";
  const qtyValue = Number(item && item.quantity);
  const qtyText = opt.qtyText !== undefined ? opt.qtyText
    : ("×" + (Number.isFinite(qtyValue) && qtyValue > 0 ? qtyValue : 1).toLocaleString());
  const icon = (item && typeof item.icon === "string" && item.icon) ? item.icon : "📦";
  const cls = "cargo-card" + (opt.extraClass ? " " + opt.extraClass : "");
  const dataAttr = (typeof opt.dataAttr === "string" && opt.dataAttr) ? " " + opt.dataAttr : "";
  // 装备类物品（带 itemId 且存在于装备库）按 shipTypes 数据驱动右上角旗舰限定角标
  let flagBadge = "";
  if (item && item.itemId && typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB[item.itemId]) {
    flagBadge = getShipTypesFlagBadge(EQUIPMENT_DB[item.itemId].shipTypes, "cargo");
  }
  return `<div class="${cls}" data-cat="${escapeAchievementText(categoryText)}"${dataAttr}>` +
    `<span class="cc-cat">${escapeAchievementText(categoryText)}</span>` +
    `<div class="cc-top"><span class="cc-icon">${icon}</span><span class="cc-name">${escapeAchievementText(name)}</span></div>` +
    `<div class="cc-foot">${footText ? `<span class="cc-src">${escapeAchievementText(footText)}</span>` : ""}</div>` +
    `<div class="cc-qty">${escapeAchievementText(qtyText)}</div>` +
    flagBadge +
    `</div>`;
}

function renderCargoPage(filter) {
  cargoFilter = filter || cargoFilter || "all";
  const display = getCargoDisplayState(gameState, cargoFilter);
  const capacity = document.getElementById("cargo-capacity-text"); if (capacity) capacity.textContent = display.filter === "implant" ? ("脑插收集：" + display.total + " / " + display.items.length) : display.filter === "trade" ? ("交易品：" + display.total + " 件") : ("物资总量：" + display.total.toLocaleString());
  document.querySelectorAll(".cargo-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.filter === display.filter));
  const list = document.getElementById("cargo-list"); if (!list) return display;
  const isEquipmentTab = display.filter === "equipment";
  const isImplantTab = display.filter === "implant";
  // 装备页由强化网格接管展示，隐藏冗余的原始物品列表，避免同一批装备名字出现两遍
  list.style.display = isEquipmentTab ? "none" : "";
  if (isImplantTab) {
    renderImplantTab(display);
    renderEquipmentEnhancementList(false);
    return display;
  }
  if (display.filter === "trade") {
    renderTradeTab(display);
    return display;
  }
  if (!isEquipmentTab) {
    currentCargoItems = display.items;
    if (!display.items.length) {
      list.innerHTML = `<div class="cargo-empty">${escapeAchievementText(display.emptyText)}</div>`;
    } else {
      // 仓库自动排序视图：按顶层分类（仅「全部」时显示吸顶标题）+ 小分类分组渲染，
      // 每个分组包进 .cargo-cluster > .cargo-grid；标题 div 不带 data-ci、非 .cargo-card，不影响点击映射。
      const showTop = display.filter === "all";
      let html = "";
      let curTop = null, curSub = null, gridOpen = false;
      const closeGrid = () => { if (gridOpen) { html += "</div></div>"; gridOpen = false; } };
      display.items.forEach((item, idx) => {
        if (showTop && item.topRank !== curTop) {
          closeGrid();
          curTop = item.topRank; curSub = null;
          html += `<div class="cargo-top-head">${escapeAchievementText(item.topLabel)}</div>`;
        }
        if (item.subRank !== curSub) {
          closeGrid();
          curSub = item.subRank;
          if (item.subLabel) html += `<div class="cargo-sub-head">${escapeAchievementText(item.subLabel)}</div>`;
          html += `<div class="cargo-cluster"><div class="cargo-grid">`;
          gridOpen = true;
        }
        html += buildCargoCardHTML(item, { dataAttr:'data-ci="' + idx + '"' });
      });
      closeGrid();
      list.innerHTML = html;
    }
    if (!cargoCardBound) {
      list.addEventListener("click", event => {
        const card = event.target.closest(".cargo-card"); if (!card) return;
        const item = currentCargoItems[Number(card.dataset.ci)];
        if (item) openItemDetailModal(item);
      });
      cargoCardBound = true;
    }
  }
  renderEquipmentEnhancementList(isEquipmentTab);
  return display;
}

/* ---- 仓库「交易品」子标签：聚合货柜战利品 + 考古文物，顶部一键回收 ---- */
function renderTradeTab(display) {
  const list = document.getElementById("cargo-list"); if (!list) return;
  renderEquipmentEnhancementList(false);
  list.style.display = "";
  if (!display.items.length) {
    list.innerHTML = `<div class="cargo-empty">${escapeAchievementText(display.emptyText)}</div>`;
    return;
  }
  currentCargoItems = display.items; // 复用既有卡片点击 → 通用详情弹窗
  const q = display.quote || { byCurrency: {} };
  const iskFinal = (q.byCurrency && q.byCurrency.isk) ? q.byCurrency.isk.final : 0;
  const lpFinal = (q.byCurrency && q.byCurrency.lp) ? q.byCurrency.lp.final : 0;
  const hasVoucher = (q.byCurrency && q.byCurrency.isk && q.byCurrency.isk.multiplier > 1) || (q.byCurrency && q.byCurrency.lp && q.byCurrency.lp.multiplier > 1);
  const quoteLine = (iskFinal > 0 || lpFinal > 0)
    ? `<div class="trade-quote">预计回收：💰 ${iskFinal.toLocaleString()} 星币 · 🎖 ${lpFinal.toLocaleString()} 功勋${hasVoucher ? "（含银河凭证 ×1.10）" : ""}</div>`
    : "";
  const toolbar = `<div class="trade-toolbar">
      <button class="btn primary trade-recycle-all" id="trade-recycle-all">♻ 一键回收全部（${display.items.length} 件）</button>
      ${quoteLine}
    </div>`;
  list.innerHTML = toolbar + display.items.map((item, idx) => buildCargoCardHTML(item, {
    categoryText:item.kind === "lp" ? "🎖 功勋" : "💰 星币",
    footText:"来自：" + item.source.pageLabel,
    qtyText:"×" + item.quantity.toLocaleString() + " · " + (item.kind === "lp" ? (Number(item.value).toLocaleString() + " 功勋/件") : (Number(item.value).toLocaleString() + " 星币/件")),
    dataAttr:'data-ci="' + idx + '"'
  })).join("");
  const btn = list.querySelector("#trade-recycle-all");
  if (btn) btn.addEventListener("click", () => {
    if (typeof recycleAllTradeGoods !== "function") return;
    const r = recycleAllTradeGoods(gameState);
    if (r && r.changed) {
      const parts = [];
      if (r.isk > 0) parts.push("💰 " + r.isk.toLocaleString() + " 星币");
      if (r.lp > 0) parts.push("🎖 " + r.lp.toLocaleString() + " 功勋");
      showToast("一键回收：" + parts.join(" · "));
    } else {
      showToast("没有可回收的交易品");
    }
    renderCargoPage("trade");
    updateUI();
  });
}

/* ---- 仓库脑插子标签：展示全部 22 枚（已激活高亮 / 未获得灰显），不占仓库格、账号全局被动 ---- */
function renderImplantTab(display) {
  const list = document.getElementById("cargo-list"); if (!list) return;
  list.style.display = "";
  if (!display.items.length) { list.innerHTML = `<div class="cargo-empty">${escapeAchievementText(display.emptyText)}</div>`; return; }
  list.innerHTML = display.items.map(item => {
    const cls = item.owned ? " owned" : " locked";
    const status = item.owned ? "已激活" : ("未获得" + (item.source && item.source.pageLabel ? "（" + item.source.pageLabel + "）" : ""));
    return `<div class="implant-card${cls}" data-implant="${item.id}">
      <div class="ic-icon">${item.owned ? item.icon : "🔒"}</div>
      <div class="ic-body">
        <div class="ic-name">${escapeAchievementText(item.name)}</div>
        <div class="ic-bonus">${escapeAchievementText(item.desc)}</div>
        <div class="ic-status">${escapeAchievementText(status)}</div>
      </div>
    </div>`;
  }).join("");
}

/* 仓库物品方块卡点击 → 通用物品弹窗（装备=介绍+强化+出产；非装备=介绍+出产） */
let currentCargoItems = [];
let cargoCardBound = false;
// 货柜出率区：内容条目 / 蓝图条目点击 → 打开独立小卡片（叠在货柜卡上，不覆盖）

/* 旗舰限定角标：移动端点按提示（桌面由 CSS :hover 处理）。
   点击角标本身 → 切换 .tap-open 并显示提示，且阻止冒泡（避免触发行/卡点击打开弹窗）；
   点击其它位置 → 关闭所有已开提示。模块级仅绑定一次。 */
if (!window.__flagTapBound) {
  document.addEventListener("click", (e) => {
    const flag = e.target.closest(".flag-badge, .ee-flag");
    if (flag) {
      e.stopPropagation();
      const wasOpen = flag.classList.contains("tap-open");
      document.querySelectorAll(".flag-badge.tap-open, .ee-flag.tap-open")
        .forEach(el => el.classList.remove("tap-open"));
      if (!wasOpen) flag.classList.add("tap-open");
      return;
    }
    document.querySelectorAll(".flag-badge.tap-open, .ee-flag.tap-open")
      .forEach(el => el.classList.remove("tap-open"));
  }, true);
  window.__flagTapBound = true;
}
let currentCargoContentItems = [];
let currentCargoBlueprintItems = [];

/* ---- 装备强化：按 (型号, 等级) 折叠成单元格 + 居中弹窗（牛牛式） ---- */
let equipEnhanceFilter = "all";     // all | enhanceable | installed | unenhanced
let equipEnhanceSearch = "";
let equipEnhanceModal = null;        // { itemId, level } 或 null

function renderEquipmentEnhancementList(visible) {
  const panel = document.getElementById("equipment-enhancement-list"); if (!panel) return;
  if (!visible) { panel.style.display = "none"; panel.innerHTML = ""; closeEquipEnhanceModal(); return; }
  panel.style.display = "";
  const display = getEquipmentEnhancementListDisplayState(gameState);
  if (!display.entries.length) {
    panel.innerHTML = `<div class="cargo-empty">暂无可强化装备（制造或获取装备后将显示于此）</div>`;
    return;
  }
  const filters = [["all","全部"],["enhanceable","可强化"],["installed","已装载"],["unenhanced","未强化"]];
  panel.innerHTML =
    `<div class="eem-toolbar">
       <input class="u-select eem-search" type="text" placeholder="搜索装备名 / 分类…" data-equip-search value="${escapeAchievementText(equipEnhanceSearch)}" />
       <div class="eem-filters">
         ${filters.map(([id,label]) => `<button class="seg-tab eem-filter${equipEnhanceFilter===id?" active":""}" data-equip-filter="${id}">${label}</button>`).join("")}
       </div>
     </div>
     <div class="equip-enh-scroll" id="equip-enh-grid"></div>`;
  renderEquipEnhanceGrid();
}

function renderEquipEnhanceGrid() {
  const grid = document.getElementById("equip-enh-grid"); if (!grid) return;
  const display = getEquipmentEnhancementListDisplayState(gameState);
  const term = (equipEnhanceSearch || "").trim().toLowerCase();
  const filtered = display.entries.filter(e => {
    if (equipEnhanceFilter === "enhanceable" && !e.canEnhance) return false;
    if (equipEnhanceFilter === "installed" && (e.installedCount === 0 || e.isRig)) return false;
    if (equipEnhanceFilter === "unenhanced" && e.level !== 0) return false;
    if (term && !(e.name.toLowerCase().includes(term) || (e.groupLabel || "").toLowerCase().includes(term))) return false;
    return true;
  });
  if (!filtered.length) { grid.innerHTML = `<div class="cargo-empty">没有符合条件的装备</div>`; return; }

  // 分组维度对齐仓库「全部」小分类：装备功能组（武器/维修/采矿/采气/打捞/考古/改装件/其他），按 EQUIP_FUNCTION_ORDER 排序
  const GROUP_ORDER = ["武器","维修","采矿","采气","打捞","考古","改装件","其他"];
  const GROUP_SUB = {
    "武器":"主炮 / 无人机", "维修":"护盾 / 装甲 / 结构维修", "采矿":"采矿激光增益",
    "采气":"采气激光增益", "打捞":"残骸打捞效率", "考古":"异常空间扫描 / 解码",
    "改装件":"安装即生效 · 不可强化", "其他":"其他增效装备"
  };
  const byCat = new Map();
  for (const e of filtered) {
    const cat = e.groupLabel || "其他";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(e);
  }
  const ordered = GROUP_ORDER.filter(c => byCat.has(c))
    .concat([...byCat.keys()].filter(c => !GROUP_ORDER.includes(c)));

  grid.innerHTML = ordered.map(cat => {
    const items = byCat.get(cat);
    const cells = items.map(equipCellHtml).join("");
    return `<section class="equip-enh-group">
      <div class="equip-enh-group-head">
        <span class="g-accent"></span>
        <span class="g-name">${escapeAchievementText(cat)}</span>
        <span class="g-count">${items.length} 件</span>
        <span class="g-sub">${GROUP_SUB[cat] || ""}</span>
      </div>
      <div class="equip-enh-grid">${cells}</div>
    </section>`;
  }).join("");
}

function equipCellHtml(e) {
  const levelLabel = e.isUnenhanced ? "未强化" : `+${e.level}`;
  const badges = [];
  if (e.stockCount > 0) badges.push(`<span class="eem-badge stock">库存 ${e.stockCount}</span>`);
  if (e.installedCount > 0) badges.push(`<span class="eem-badge installed">已装 ${e.installedCount}</span>`);
  if (e.isMilestone) badges.push(`<span class="eem-badge milestone">里程碑</span>`);
  const lockCls = e.stockCount === 0 ? " locked" : ((!e.isRig && !e.canEnhance) ? " nores" : "");
  const flagBadge = (typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB[e.itemId])
    ? getShipTypesFlagBadge(EQUIPMENT_DB[e.itemId].shipTypes, "ee") : "";
  return `<div class="equip-enh-cell${lockCls}" data-equip-cell="${encodeURIComponent(e.itemId)}|${e.level}" title="点击查看强化详情">
    ${flagBadge}
    <div class="eec-icon">${e.icon}</div>
    <div class="eec-info">
      <div class="eec-name">${escapeAchievementText(e.name)}</div>
      <div class="eec-level">${levelLabel}</div>
    </div>
    <div class="eec-badges">${badges.join("")}</div>
    <div class="eec-count">${levelLabel} ×${e.totalCount}</div>
  </div>`;
}

function openEquipEnhanceModal(itemId, level) {
  const display = getEquipmentEnhancementListDisplayState(gameState);
  let cell = display.entries.find(e => e.itemId === itemId && e.level === level);
  if (!cell) {
    // 改装件不在强化列表：造一个虚拟 cell 让弹窗能正常渲染（强化区块走 isRig 分支隐藏）
    const eqEnt = EQUIPMENT_DB[itemId];
    if (!eqEnt || eqEnt.slot !== "rig") { closeEquipEnhanceModal(); return; }
    const inventory = gameState.equipment && Array.isArray(gameState.equipment.inventory) ? gameState.equipment.inventory : [];
    const instances = gameState.equipment && Array.isArray(gameState.equipment.instances) ? gameState.equipment.instances : [];
    const stockCount = inventory.filter(ref => ref === itemId).length;
    const installedCount = instances.filter(inst => inst && inst.itemId === itemId && !inst.destroyed).length;
    cell = {
      itemId, level: 0, isUnenhanced: true,
      name: eqEnt.name,
      icon: (typeof ITEM_ICONS !== "undefined" && ITEM_ICONS[eqEnt.name]) || "📦",
      categoryLabel: "改装件",
      bonusPercent: 0, previewBonusPercent: 0, successPercent: 0,
      costRows: [], extraRows: [], isMilestone: false,
      canEnhance: false, targetRef: null,
      stockCount, installedCount, totalCount: stockCount + installedCount,
      installedShips: []
    };
  }
  equipEnhanceModal = { itemId, level };
  const eqEnt = EQUIPMENT_DB[cell.itemId];
  // 改装件不参与装备强化（安装即消耗、无 enhancementLevel）：隐藏升级段与强化按钮，只展示物品介绍与库存/出产信息
  const isRig = eqEnt && eqEnt.slot === "rig";
  const descText = eqEnt ? getEquipmentAttributeText(eqEnt, "\n") : "";
  const src = { pageId:"equipmentEngineering", pageLabel:"装备工程", icon:"fa-solid fa-gears" };
  let backdrop = document.getElementById("equip-enhance-modal");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "equip-enhance-modal";
    backdrop.className = "equip-enh-modal-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) closeEquipEnhanceModal(); });
    backdrop._esc = event => { if (event.key === "Escape" && backdrop.style.display === "flex") closeEquipEnhanceModal(); };
    document.addEventListener("keydown", backdrop._esc);
  }
  const rateColor = cell.successPercent >= 75 ? "#9be8a8" : cell.successPercent >= 60 ? "#d4a843" : "#e0887e";
  const levelLabel = cell.isUnenhanced ? "未强化" : `+${cell.level}`;
  const levelCode = cell.isUnenhanced ? "+0" : `+${cell.level}`;
  const nextLabel = cell.isUnenhanced ? "+1" : `+${cell.level + 1}`;
  const costHtml = cell.costRows.map(r => `<span class="eem-cost${r.enough ? "" : " insufficient"}">${escapeAchievementText(r.name)} ${r.need}<small>(${r.stock})</small></span>`).join("");
  const extraHtml = cell.extraRows.length ? `<div class="eem-extra">${cell.extraRows.map(r => `<span class="eem-cost${r.enough ? "" : " insufficient"}">${escapeAchievementText(r.label)} ×${r.need}<small>(${r.have})</small></span>`).join("")}</div>` : "";
  const milestoneHint = cell.isMilestone && !isRig ? `<div class="eem-milestone-hint">下一里程碑：Lv.${cell.level + 1}（+${cell.previewBonusPercent}% 加成）</div>` : "";
  const stockHtml = isRig
    ? (cell.stockCount
        ? `<div class="eem-status-row"><span class="eem-dot stock">库存</span><span>${cell.stockCount} 件（未装载，可装备到舰船）</span></div>`
        : `<div class="eem-status-row"><span class="eem-dot none">无库存</span><span>无未装载件 —— 需先到装备工程制造</span></div>`)
    : (cell.stockCount
        ? `<div class="eem-status-row"><span class="eem-dot stock">库存</span><span>${cell.stockCount} 件 ${levelLabel}（未装载，可强化）</span></div>`
        : `<div class="eem-status-row"><span class="eem-dot none">无库存</span><span>无未装载件 —— 需先到船坞卸载已装载的 ${levelLabel} 装备</span></div>`);
  const installedHtml = cell.installedCount
    ? `<div class="eem-status-row"><span class="eem-dot installed">已装载</span><span>已装载 ${cell.installedCount} 件${isRig ? "" : " " + levelLabel}${isRig ? "" : "（在船上）"}</span></div>
       <div class="eem-installed-ships">🔒 ${cell.installedShips.map(s => escapeAchievementText(s)).join("、")}</div>`
    : "";
  const locked = cell.stockCount === 0;
  const lockAttr = locked ? "disabled" : "";
  const btnLabel = locked ? "无可用件可强化" : `强化 ${levelCode} → ${nextLabel}`;
  const btnDisabled = (locked || !cell.canEnhance) ? "disabled" : "";
  const btnWarn = isRig || (locked || cell.canEnhance) ? "" : `<div class="eem-warn">材料不足或缺少里程碑耗材，无法强化</div>`;
  const targetRefAttr = cell.targetRef ? encodeURIComponent(cell.targetRef) : "";
  const upgradeHtml = isRig ? "" : `
        <div class="eem-upgrade">
          <div class="eem-upgrade-title">升级 ${levelCode} → ${nextLabel}</div>
          <div class="eem-row"><span>当前加成</span><b>+${cell.bonusPercent}%</b></div>
          <div class="eem-row"><span>升级后加成</span><b>+${cell.previewBonusPercent}%</b></div>
          <div class="eem-row"><span>成功率</span><b style="color:${rateColor}">${cell.successPercent}%</b></div>
          <div class="eem-costs-label">消耗材料</div>
          <div class="eem-costs">${costHtml}${extraHtml}</div>
        </div>`;
  const enhanceBtnHtml = isRig ? "" : `<button class="btn primary eem-enhance" data-enhance-target="${targetRefAttr}" ${btnDisabled}>${btnLabel}</button>`;

  backdrop.innerHTML = `
    <div class="equip-enh-modal" role="dialog" aria-modal="true">
      <div class="eem-head">
        <span class="eem-icon">${cell.icon}</span>
        <div class="eem-title-wrap">
          <div class="eem-title">${escapeAchievementText(cell.name)} <span class="eem-level">${levelLabel}</span></div>
          <div class="eem-sub">${escapeAchievementText(cell.categoryLabel)} · 当前加成 +${cell.bonusPercent}%</div>
          ${milestoneHint}
        </div>
        <button class="eem-close" data-eem-close aria-label="关闭">✕</button>
      </div>
      <div class="eem-body">
        <div class="eem-section"><h3 class="eem-sec-title">物品介绍</h3><div class="eem-desc">${escapeAchievementText(descText)}</div></div>
        <div class="eem-status">${stockHtml}${installedHtml}</div>
        ${upgradeHtml}
        <div class="eem-section"><h3 class="eem-sec-title">出产位置</h3>
          <div class="eem-source"><span class="eem-src-icon"><i class="${src.icon}"></i></span>
            <span class="eem-src-text"><span class="eem-src-label">获取 / 出产页面</span><br><span class="eem-src-page">${escapeAchievementText(src.pageLabel)}</span></span></div>
          <button class="btn primary eem-jump" data-eem-jump="${src.pageId}">跳转至「${escapeAchievementText(src.pageLabel)}」页面</button>
        </div>
      </div>
      <div class="eem-foot">
        ${btnWarn}
        <div class="eem-foot-actions">
          <button class="btn eem-discard" data-discard-target="${targetRefAttr}" ${lockAttr}>丢弃</button>
          <button class="btn eem-dismantle" data-dismantle-target="${targetRefAttr}" ${lockAttr}>拆解</button>
          ${enhanceBtnHtml}
        </div>
      </div>
    </div>`;
  backdrop.style.display = "flex";

  const closeBtn = backdrop.querySelector("[data-eem-close]");
  if (closeBtn) closeBtn.addEventListener("click", closeEquipEnhanceModal);
  const enhBtn = backdrop.querySelector(".eem-enhance");
  if (enhBtn && !enhBtn.disabled) {
    enhBtn.addEventListener("click", () => {
      const ref = decodeURIComponent(enhBtn.dataset.enhanceTarget);
      const before = equipEnhanceModal;
      enhanceEquipmentFromWarehouse(ref, (res) => {
        if (res && res.changed) {
          const newLevel = res.success ? res.toLevel : res.fromLevel;
          openEquipEnhanceModal(before.itemId, newLevel); // 自动跳到新等级格
        }
      });
    });
  }
  const jumpBtn = backdrop.querySelector("[data-eem-jump]");
  if (jumpBtn) jumpBtn.addEventListener("click", () => { closeEquipEnhanceModal(); twGoToTarget(jumpBtn.dataset.eemJump); });
  const discardBtn = backdrop.querySelector("[data-discard-target]");
  if (discardBtn) discardBtn.addEventListener("click", () => {
    const ref = decodeURIComponent(discardBtn.dataset.discardTarget);
    discardEquipmentFromModal(ref);
  });
  const dismantleBtn = backdrop.querySelector("[data-dismantle-target]");
  if (dismantleBtn) dismantleBtn.addEventListener("click", () => {
    const ref = decodeURIComponent(dismantleBtn.dataset.dismantleTarget);
    dismantleEquipmentFromModal(ref);
  });
}

function closeEquipEnhanceModal() {
  equipEnhanceModal = null;
  const backdrop = document.getElementById("equip-enhance-modal");
  if (backdrop) {
    backdrop.style.display = "none";
    backdrop.innerHTML = "";
  }
}

/* Batch S·装备管理：通用危险操作确认弹窗（暗金风格，动态创建，复用 .dlg-backdrop/.dlg-box.dlg-danger，与删存档一致） */
/* Batch R·舰船拆解/强化：扩展 onCancel，使取消可追踪（弹窗打开/取消/确认三层均可打日志）。
   onCancel 为可选；取消与背景点击均视为 cancel，确认不触发 onCancel。settled 防止重复结算。 */
function showDangerConfirm(title, bodyHtml, confirmLabel, onConfirm, onCancel) {
  if (document.querySelector(".dlg-backdrop")) return null; // 防重入：已有确认弹窗时不再叠加创建
  const backdrop = document.createElement("div");
  backdrop.className = "dlg-backdrop";
  const box = document.createElement("div");
  box.className = "dlg-box dlg-danger";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", title.replace(/[⚠🗑]/g, "").trim());
  box.innerHTML =
    '<div class="dlg-title">' + title + '</div>' +
    bodyHtml +
    '<div class="dlg-actions">' +
      '<button type="button" class="btn dlg-cancel">取消</button>' +
      '<button type="button" class="btn btn-danger dlg-confirm">' + confirmLabel + '</button>' +
    '</div>';
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  let settled = false;
  const close = (cancelled) => {
    if (settled) return;
    settled = true;
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    if (cancelled && typeof onCancel === "function") onCancel();
  };
  box.querySelector(".dlg-cancel").addEventListener("click", () => close(true));
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(true); });
  box.querySelector(".dlg-confirm").addEventListener("click", () => { close(false); if (typeof onConfirm === "function") onConfirm(); });
  const cb = box.querySelector(".dlg-confirm");
  if (cb && typeof cb.focus === "function") cb.focus();
  return () => close(true);
}

function discardEquipmentFromModal(targetRef) {
  const blockReason = getEquipmentDismantleBlockReason(gameState, targetRef);
  if (blockReason === "unknown-equipment") { showToast("装备不存在"); return; }
  if (blockReason === "equipment-installed") { showToast("装备已装载在舰船上，先卸下再丢弃"); return; }
  const resolved = resolveEquipmentReference(gameState, targetRef);
  const name = resolved.definition ? resolved.definition.name : String(targetRef);
  const doDiscard = () => {
    const result = dispatchGameAction(gameState, { type:"equipment/discard", targetRef }, Date.now());
    if (!result.changed) { showToast(result.reason === "equipment-installed" ? "装备已装载，无法丢弃" : "丢弃失败"); return; }
    showToast("已丢弃 " + name);
    closeEquipEnhanceModal();
    updateUI();
  };
  if (getSettingsDisplayState(gameState).confirmDiscard) {
    showDangerConfirm("⚠ 丢弃装备",
      '<p class="dlg-body">「' + escapeAchievementText(name) + '」将被永久删除，不可恢复。</p>',
      "确认丢弃", doDiscard);
  } else {
    doDiscard();
  }
}

function dismantleEquipmentFromModal(targetRef) {
  const blockReason = getEquipmentDismantleBlockReason(gameState, targetRef);
  if (blockReason === "unknown-equipment") { showToast("装备不存在"); return; }
  if (blockReason === "equipment-installed") { showToast("装备已装载在舰船上，先卸下再拆解"); return; }
  const resolved = resolveEquipmentReference(gameState, targetRef);
  const eqDef = resolved.definition;
  const level = resolved.enhancementLevel;
  const reclaimRate = (typeof getReclaimRate === "function")
    ? getReclaimRate(gameState) : 0.5;
  const quote = getEquipmentDismantleQuote(eqDef, level, reclaimRate);
  const name = eqDef ? eqDef.name : String(targetRef);
  const reclaimPercent = Math.round(reclaimRate * 100);
  const materialLines = (quote.materials || []).map(e => e.name + "×" + e.returned).join("、");
  const wholeLines = (quote.wholeItems || []).map(w => {
    const wname = (w.type === "sameType" && typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB[w.id]) ? EQUIPMENT_DB[w.id].name : w.id;
    return escapeAchievementText(wname) + "（各 " + reclaimPercent + "% 概率）";
  }).join("、");
  const bodyHtml =
    '<p class="dlg-body">拆解「' + escapeAchievementText(name) + '」将按冶炼回收率返还约 ' + reclaimPercent + '% 材料：</p>' +
    '<p class="dlg-body">' + (materialLines || "无材料") + '</p>' +
    (wholeLines ? '<p class="dlg-body dlg-warn">整件耗材（' + wholeLines + '）：每件独立 ' + reclaimPercent + '% 概率返还，确认时掷骰决定。</p>' : '') +
    '<p class="dlg-body dlg-warn">强化消耗的星币不返还。装备拆解后消失，不可恢复。</p>';
  const doDismantle = () => {
    const result = dispatchGameAction(gameState, { type:"equipment/dismantle", targetRef }, Date.now());
    if (!result.changed) { showToast(result.reason === "equipment-installed" ? "装备已装载，无法拆解" : "拆解失败"); return; }
    const returnedText = (result.returned || []).map(e => e.name + "×" + e.returned).join("、");
    const itemText = (result.returnedItems || []).map(it => {
      const n = (it.type === "sameType" && typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB[it.id]) ? EQUIPMENT_DB[it.id].name : it.id;
      return escapeAchievementText(n) + "×1";
    }).join("、");
    const parts = [returnedText, itemText].filter(Boolean);
    showToast("已拆解 " + name + (parts.length ? "，归还：" + parts.join("、") : "，无返还"));
    closeEquipEnhanceModal();
    updateUI();
  };
  if (getSettingsDisplayState(gameState).confirmDismantle) {
    showDangerConfirm("🗑 拆解装备", bodyHtml, "确认拆解", doDismantle);
  } else {
    doDismantle();
  }
}

/* Bug2：制造配方材料来源映射（按资源 id 前缀 / 中文名归类，pageId 与 CARGO_SOURCE 一致，可被 twGoToTarget 路由） */
const MATERIAL_SOURCE = {
  ore:        { pageId:"mining",            pageLabel:"采矿",     icon:"fa-solid fa-gem",        emoji:"🪨" },
  mineral:    { pageId:"refining",          pageLabel:"冶炼",     icon:"fa-solid fa-fire",       emoji:"🔩" },
  planetary:  { pageId:"planetary",         pageLabel:"行星开发", icon:"fa-solid fa-globe",      emoji:"🌍" },
  gases:      { pageId:"gasHarvesting",     pageLabel:"气体采集", icon:"fa-solid fa-wind",       emoji:"💨" },
  moon:       { pageId:"mining",            pageLabel:"采矿",     icon:"fa-solid fa-moon",       emoji:"🌑" },
  special:    { pageId:"combat",            pageLabel:"战斗",     icon:"fa-solid fa-crosshairs", emoji:"⚔️" },
  consumable: { pageId:"equipmentEngineering", pageLabel:"装备工程", icon:"fa-solid fa-gears", emoji:"🔧" },
  component:  { pageId:"shipEngineering",   pageLabel:"舰船工程", icon:"fa-solid fa-rocket",  emoji:"🛠️" },
  archaeology:{ pageId:"archaeology",       pageLabel:"考古",     icon:"fa-solid fa-digging", emoji:"🏺" }
};
// 资源命名空间 → MATERIAL_SOURCE 键映射（与 ResourceRegistry 定义一致，避免中文特例维护）
const SOURCE_BY_NAMESPACE = {
  ore: "ore",
  mineral: "mineral",
  planetary: "planetary",
  gas: "gases",
  moon: "moon",
  special: "special",
  component: "component",
  consumable: "consumable",
  calibration: "archaeology"
};
function getMaterialSourceInfo(key) {
  if (typeof key !== "string") return MATERIAL_SOURCE.mineral;
  // 优先使用权威资源定义：resolveMaterialIds 同时覆盖 namespace:itemId 与纯中文名（跨命名空间按名聚合），
  // 再取 getDefinition 的 namespace 映射到来源分类。镓/铂/铪/铷（月矿）→ 采矿，行星材料 → 行星开发，气体 → 气体采集。
  const RR = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry : null;
  if (RR && typeof RR.resolveMaterialIds === "function" && typeof RR.getDefinition === "function") {
    try {
      const ids = RR.resolveMaterialIds(key);
      const id = (ids && ids[0]) || (key.indexOf(":") >= 0 ? key : null);
      const def = id ? RR.getDefinition(id) : null;
      if (def && def.namespace) {
        const mapped = SOURCE_BY_NAMESPACE[def.namespace];
        if (mapped && MATERIAL_SOURCE[mapped]) return MATERIAL_SOURCE[mapped];
      }
    } catch (e) { /* 解析异常则降级到正则 */ }
  }
  // 降级：仅当 ResourceRegistry 不可用或完全解析失败时，使用旧的命名前缀/中文正则判断
  if (key.indexOf(":") >= 0) {
    const prefix = key.slice(0, key.indexOf(":")).toLowerCase();
    const norm = prefix === "gas" ? "gases" : prefix === "calibration" ? "archaeology" : prefix;
    if (MATERIAL_SOURCE[norm]) return MATERIAL_SOURCE[norm];
  }
  if (/气体|同位素|富勒烯/.test(key)) return MATERIAL_SOURCE.gases;
  if (key === "重金属") return MATERIAL_SOURCE.planetary;
  if (/许可|教团|劫团|集群|残液/.test(key)) return MATERIAL_SOURCE.special;
  return MATERIAL_SOURCE.mineral;
}
// Bug2（修正）：制造页「制造材料」列表里的材料名 → 仓库式物品弹窗。
// 弹窗展示该材料的「物品介绍 + 出产位置（去哪获取）」，直接回答"材料怎么来"。
function openMaterialDetail(materialKey, displayName) {
  if (typeof openItemDetailModal !== "function") return;
  const src = getMaterialSourceInfo(materialKey);
  openItemDetailModal({
    id: typeof materialKey === "string" ? materialKey : String(materialKey),
    name: displayName,
    icon: src.emoji || "📦",
    category: "material",
    description: "",
    source: src
  });
}
// 全局委托：制造页材料名链接（data-mat-key / data-mat-name）点击即弹材料详情。
document.addEventListener("click", event => {
  const link = event.target.closest("[data-mat-key]");
  if (!link) return;
  openMaterialDetail(link.dataset.matKey, link.dataset.matName || link.textContent);
});

/* ---- 货柜出率区：仓库卡片 / 战斗点击查看共用 ---- */
// 把内容条目转成可打开的小卡片描述符
function cargoContentDescriptor(it, sizeLabel, tierLabel) {
  let icon = "📦", categoryLabel = "物资";
  if (it.kind === "implant") { icon = "🧠"; categoryLabel = "脑插"; }
  else if (it.kind === "blueprint") { icon = "📜"; categoryLabel = "蓝图"; }
  else if (it.kind === "ammo") { icon = "🔫"; categoryLabel = "弹药"; }
  else if (it.kind === "loot") { icon = "💰"; categoryLabel = "战利品"; }
  const desc = "货柜（" + sizeLabel + "）「" + tierLabel + "」档可能开出的物品。" + (it.qtyText ? (" 数量参考：" + it.qtyText + "。") : "");
  return {
    name: it.name, icon: icon, categoryLabel: categoryLabel, description: desc,
    source: { pageId: "cargo", pageLabel: "货柜掉落", icon: "fa-solid fa-box-open" }
  };
}

// 货柜出率区 HTML（权重 + 蓝图清单 + 各档内容）。不显示基础掉落概率与抽取次数。
function cargoDropRateSectionHTML(size) {
  if (typeof getCargoDropInfo !== "function") return "";
  const info = getCargoDropInfo(size);
  if (!info) return "";
  const weights = info.tierWeights || {};
  const total = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
  const pct = w => (((Number(w) || 0) / total) * 100).toFixed((Number(w) || 0) >= 0.1 ? 1 : 2) + "%";
  const tierClass = { T1: "t1", T2: "t2", T3: "t3", T4: "t4", BP: "bp" };
  const tierLabels = { T1: "T1 保底", T2: "T2 矿物/弹药", T3: "T3 战利品", T4: "T4 脑插" };

  currentCargoContentItems = [];
  currentCargoBlueprintItems = [];

  // 奖池权重（T4=0 时标「不出」，不附加任何口语标注）
  const weightChips = Object.keys(weights).map(t => {
    const w = Number(weights[t]) || 0;
    const label = (t === "BP") ? "蓝图" : t;
    return `<span class="cargo-w-chip ${tierClass[t] || ""}${w <= 0 ? " zero" : ""}">${label} ${w <= 0 ? "不出" : pct(w)}</span>`;
  }).join("");

  // 蓝图清单（具体名，按尺寸分配，不写档位代号）
  const bpItems = (info.blueprints || []).map(b => {
    const idx = currentCargoBlueprintItems.length;
    currentCargoBlueprintItems.push(b);
    return `<span class="cargo-content-item bp" data-cbi="${idx}">📜 ${escapeAchievementText(b.name)}</span>`;
  }).join("");

  // 各档具体内容（可点击查看）
  const contentBlocks = ["T1", "T2", "T3", "T4"].map(tier => {
    const arr = (info.content && info.content[tier]) || [];
    if (!arr.length) return "";
    const items = arr.map(it => {
      const idx = currentCargoContentItems.length;
      currentCargoContentItems.push(cargoContentDescriptor(it, info.sizeLabel, tierLabels[tier]));
      return `<span class="cargo-content-item" data-cci="${idx}">${it.icon || "📦"} ${escapeAchievementText(it.name)}${it.qtyText ? ` <i class="cci-qty">${escapeAchievementText(it.qtyText)}</i>` : ""}</span>`;
    }).join("");
    return `<div class="cargo-tier-block"><div class="cargo-tier-label">${tierLabels[tier]}</div><div class="cargo-tier-items">${items}</div></div>`;
  }).join("");

  return `
    <div class="eem-section eem-cargo-rate">
      <h3 class="eem-sec-title">📊 货柜出率（${escapeAchievementText(info.sizeLabel)}）</h3>
      <div class="cargo-rate-weights"><span class="cargo-rate-hint">奖池权重</span>${weightChips}</div>
      <div class="cargo-rate-blueprints"><span class="cargo-rate-hint">可能掉落的蓝图</span><div class="cargo-tier-items">${bpItems}</div></div>
      <div class="cargo-rate-content">${contentBlocks}</div>
    </div>`;
}

// 货柜内容/蓝图 点击 → 独立小卡片（叠在货柜详情卡上，关闭后回到货柜卡）
function openCargoContentCard(desc) {
  if (!desc) return;
  let backdrop = document.getElementById("cargo-content-modal");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "cargo-content-modal";
    backdrop.className = "equip-enh-modal-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) closeCargoContentCard(); });
    backdrop._esc = e => { if (e.key === "Escape" && backdrop.style.display === "flex") closeCargoContentCard(); };
    document.addEventListener("keydown", backdrop._esc);
  }
  const src = desc.source || { pageLabel: "获得" };
  const descText = typeof desc.description === "string" ? desc.description : "";
  backdrop.innerHTML = `
    <div class="equip-enh-modal" role="dialog" aria-modal="true">
      <div class="eem-head">
        <span class="eem-icon">${desc.icon || "📦"}</span>
        <div class="eem-title-wrap">
          <div class="eem-title">${escapeAchievementText(desc.name)}</div>
          <div class="eem-sub">${escapeAchievementText(desc.categoryLabel || "")}</div>
        </div>
        <button class="eem-close" data-cc-close aria-label="关闭">✕</button>
      </div>
      <div class="eem-body">
        ${descText ? `<div class="eem-section"><h3 class="eem-sec-title">物品介绍</h3><div class="eem-desc">${escapeAchievementText(descText)}</div></div>` : ""}
        <div class="eem-section"><h3 class="eem-sec-title">出产位置</h3>
          <div class="eem-source"><span class="eem-src-icon"><i class="${src.icon || "fa-solid fa-box-open"}"></i></span>
            <span class="eem-src-text"><span class="eem-src-label">获取 / 出产页面</span><br><span class="eem-src-page">${escapeAchievementText(src.pageLabel)}</span></span></div>
        </div>
      </div>
    </div>`;
  backdrop.style.display = "flex";
  const closeBtn = backdrop.querySelector("[data-cc-close]");
  if (closeBtn) closeBtn.addEventListener("click", closeCargoContentCard);
}
function closeCargoContentCard() {
  const backdrop = document.getElementById("cargo-content-modal");
  if (backdrop) backdrop.style.display = "none";
}

/* 通用物品详情弹窗：装备 → 解析到强化弹窗（含强化+介绍+出产）；非装备 → 介绍+出产 */
function openItemDetailModal(item) {
  if (item.category === "equipment" && item.itemId) {
    // 改装件不在强化列表（不参与装备强化），绕过 getEquipmentEnhancementListDisplayState.entries 直接打开
    const eqEnt = EQUIPMENT_DB[item.itemId];
    if (eqEnt && eqEnt.slot === "rig") {
      openEquipEnhanceModal(item.itemId, 0);
      return;
    }
    const disp = getEquipmentEnhancementListDisplayState(gameState);
    const entries = disp.entries.filter(e => e.itemId === item.itemId);
    if (entries.length) {
      entries.sort((a, b) => (b.stockCount > 0 ? 1 : 0) - (a.stockCount > 0 ? 1 : 0) || b.level - a.level);
      openEquipEnhanceModal(entries[0].itemId, entries[0].level);
    } else {
      closeItemDetailModal();
    }
    return;
  }
  let backdrop = document.getElementById("item-detail-modal");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "item-detail-modal";
    backdrop.className = "equip-enh-modal-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) closeItemDetailModal(); });
    backdrop._esc = event => { if (event.key === "Escape" && backdrop.style.display === "flex") closeItemDetailModal(); };
    document.addEventListener("keydown", backdrop._esc);
    // 货柜出率区：内容条目 / 蓝图条目点击 → 打开独立小卡片（叠在货柜卡上，不覆盖）
    backdrop.addEventListener("click", event => {
      const ci = event.target.closest(".cargo-content-item[data-cci]");
      if (ci) { const d = currentCargoContentItems[Number(ci.dataset.cci)]; if (d) openCargoContentCard(d); return; }
      const bi = event.target.closest(".cargo-content-item.bp[data-cbi]");
      if (bi) {
        const b = currentCargoBlueprintItems[Number(bi.dataset.cbi)];
        if (b) openCargoContentCard({ name: b.name, icon: "📜", categoryLabel: "蓝图", description: "货柜掉落的装备生产许可蓝图，持有后可在装备工程页制造对应装备。", source: { pageId: "cargo", pageLabel: "货柜掉落", icon: "fa-solid fa-box-open" } });
        return;
      }
    });
  }
  const src = item.source || { pageId:"station", pageLabel:"空间站", icon:"fa-regular fa-building" };
  const isComponentItem = item.category === "equipment" && !item.isEquipment && !!item.componentId;
  const compReclaimPct = (typeof getReclaimRate === "function") ? Math.round(getReclaimRate(gameState) * 100) : 50;
  const isCargo = typeof item.id === "string" && item.id.indexOf("special:货柜") === 0;
  const cargoSize = isCargo ? item.id.slice("special:货柜".length) : null;
  backdrop.innerHTML = `
    <div class="equip-enh-modal" role="dialog" aria-modal="true">
      <div class="eem-head">
        <span class="eem-icon">${item.icon}</span>
        <div class="eem-title-wrap">
          <div class="eem-title">${escapeAchievementText(item.name)}</div>
          <div class="eem-sub">${escapeAchievementText(item.categoryLabel || item.category)}</div>
        </div>
        <button class="eem-close" data-idm-close aria-label="关闭">✕</button>
      </div>
      <div class="eem-body">
        <div class="eem-section"><h3 class="eem-sec-title">物品介绍</h3><div class="eem-desc">${escapeAchievementText(item.description)}</div></div>
        <div class="eem-section"><h3 class="eem-sec-title">出产位置</h3>
          <div class="eem-source"><span class="eem-src-icon"><i class="${src.icon}"></i></span>
            <span class="eem-src-text"><span class="eem-src-label">获取 / 出产页面</span><br><span class="eem-src-page">${escapeAchievementText(src.pageLabel)}</span></span></div>
          <button class="btn primary eem-jump" data-idm-jump="${src.pageId}">跳转至「${escapeAchievementText(src.pageLabel)}」页面</button>
        </div>
        ${item.craftables !== undefined ? `
        <div class="eem-section"><h3 class="eem-sec-title">可制造 / 可用途</h3>
          <div class="eem-craft-list">
            ${item.craftables.length ? item.craftables.map(c => `
              <div class="eem-craft-row">
                <span class="eem-craft-name">${escapeAchievementText(c.name)}</span>
                <span class="eem-craft-type">${escapeAchievementText(c.type)}</span>
                <span class="eem-craft-bp ${c.unlocked ? "unlocked" : (c.requiresBlueprint ? "locked" : "free")}">${c.unlocked ? "✅ 已解锁" : (c.requiresBlueprint ? "🔒 未解锁" : "⚪ 无需蓝图")}</span>
              </div>`).join("") : `<div class="eem-craft-empty">当前版本暂无配方消耗此材料。</div>`}
          </div>
        </div>` : ""}
        ${isComponentItem && item.quantity > 0 ? `
        <div class="eem-section">
          <h3 class="eem-sec-title">拆解</h3>
          <div class="eem-desc">按冶炼回收率（约 ${compReclaimPct}%）归还制造该组件所消耗的材料。拆解后组件消失，不可恢复。</div>
          <button class="btn danger eem-comp-dismantle" data-comp-dismantle="${item.componentId}">🗑 拆解此组件</button>
        </div>` : ""}
        ${isCargo && !item.fromCombat ? `
        <div class="eem-section eem-cargo-open">
          <div class="eem-open-row">
            <label class="eem-qty-label">开箱数量</label>
            <button class="btn eem-qty-dec" type="button" aria-label="减少">−</button>
            <input class="eem-qty-input" type="number" min="1" max="${item.quantity}" value="1" data-cargo-size="${cargoSize}">
            <button class="btn eem-qty-inc" type="button" aria-label="增加">＋</button>
            <span class="eem-qty-have">/ 持有 ${item.quantity} 个</span>
          </div>
          <div class="eem-open-actions">
            <button class="btn primary eem-open-cargo" data-cargo-size="${cargoSize}">📦 开箱揭晓内容</button>
            <button class="btn eem-open-all" data-cargo-size="${cargoSize}" data-open-count="${item.quantity}">全部打开（${item.quantity}）</button>
          </div>
        </div>` : ""}
        ${isCargo ? cargoDropRateSectionHTML(cargoSize) : ""}
        ${item.category === "trade" ? `<div class="eem-section"><button class="btn primary eem-trade-recycle">♻ 回收此物品（换${item.kind === "lp" ? "功勋" : "星币"}）</button></div>` : ""}
      </div>
    </div>`;
  backdrop.style.display = "flex";
  const closeBtn = backdrop.querySelector("[data-idm-close]");
  if (closeBtn) closeBtn.addEventListener("click", closeItemDetailModal);
  const jumpBtn = backdrop.querySelector("[data-idm-jump]");
  if (jumpBtn) jumpBtn.addEventListener("click", () => { closeItemDetailModal(); twGoToTarget(jumpBtn.dataset.idmJump); });
  if (isCargo) {
    const qtyInput = backdrop.querySelector(".eem-qty-input");
    const maxQty = Math.max(1, item.quantity);
    const clampQty = v => {
      let n = Math.floor(Number(v));
      if (!isFinite(n) || n < 1) n = 1;
      if (n > maxQty) n = maxQty;
      return n;
    };
    const decBtn = backdrop.querySelector(".eem-qty-dec");
    const incBtn = backdrop.querySelector(".eem-qty-inc");
    if (qtyInput) qtyInput.addEventListener("change", () => { qtyInput.value = clampQty(qtyInput.value); });
    if (decBtn) decBtn.addEventListener("click", () => { if (qtyInput) qtyInput.value = clampQty(Number(qtyInput.value) - 1); });
    if (incBtn) incBtn.addEventListener("click", () => { if (qtyInput) qtyInput.value = clampQty(Number(qtyInput.value) + 1); });
    const doOpen = count => {
      // C 项：操作期间禁用两个开箱按钮防双击；成功/失败后统一恢复（成功后详情弹窗已关闭，恢复对已分离节点无害）
      const setOpenBusy = busy => {
        [openBtn, openAllBtn].forEach(b => { if (b) { b.disabled = busy; b.classList.toggle("disabled", busy); } });
        if (qtyInput) qtyInput.disabled = busy;
      };
      setOpenBusy(true);
      try {
        let result = null;
        if (typeof openCargoContainers === "function") {
          result = openCargoContainers(gameState, cargoSize, count, Math.random);
        } else if (typeof openCargoContainer === "function") {
          // 兜底：旧版 cargo.js 仅暴露单箱 openCargoContainer 时，按数量循环开箱
          const have = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, "special:货柜" + cargoSize) : 0;
          const n = Math.max(1, Math.min(Math.floor(Number(count)) || 1, have));
          const all = [];
          for (let k = 0; k < n; k++) {
            const one = openCargoContainer(gameState, cargoSize, Math.random);
            if (!one) break;
            if (Array.isArray(one.rolls)) for (const r of one.rolls) all.push(r);
          }
          result = { size: cargoSize, opened: all.length ? n : 0, rolls: all };
        } else {
          if (typeof showToast === "function") showToast("开箱功能未加载，请硬刷新页面（Ctrl/Cmd+Shift+R）");
          console.error("[开箱] openCargoContainer(s) 均未定义：cargo.js 可能未加载或被旧缓存拦截");
          return;
        }
        // 失败（无货柜可开 / 开箱数 0）：不关闭详情弹窗、不刷新仓库，仅提示后恢复按钮
        if (!result || !result.opened || !Array.isArray(result.rolls)) {
          if (typeof showToast === "function") showToast("没有可开启的货柜");
          return;
        }
        closeItemDetailModal();
        if (typeof renderCargoPage === "function") renderCargoPage(cargoFilter);
        // C 项：统一聚合 rolls → 持久结果弹窗（同一张仓库物品卡，合并相同 canonical ref）
        const aggregated = aggregateRewardRolls(result.rolls);
        if (aggregated.length) {
          if (typeof openRewardResultModal === "function") {
            openRewardResultModal({
              title:"📦 开箱结果",
              subtitle:`货柜 ${cargoSize} · 实际开启 ${result.opened} 个 · 共获得 ${aggregated.length} 类物品`,
              items: aggregated,
              emptyText:"已开箱，但未获得可展示奖励"
            });
            return;
          }
        }
        if (typeof showToast === "function") showToast("已开箱，但未获得可展示奖励");
      } catch (err) {
        console.error("[开箱] 执行异常：", err);
        if (typeof showToast === "function") showToast("开箱出错：" + (err && err.message ? err.message : String(err)));
      } finally {
        setOpenBusy(false);
      }
    };
    const openBtn = backdrop.querySelector(".eem-open-cargo");
    if (openBtn) openBtn.addEventListener("click", () => doOpen(qtyInput ? clampQty(qtyInput.value) : 1));
    const openAllBtn = backdrop.querySelector(".eem-open-all");
    if (openAllBtn) openAllBtn.addEventListener("click", () => doOpen(openAllBtn.dataset.openCount));
  }
  const tradeRecycleBtn = backdrop.querySelector(".eem-trade-recycle");
  if (tradeRecycleBtn) tradeRecycleBtn.addEventListener("click", () => {
    if (typeof recycleOneTradeItem !== "function") return;
    const res = recycleOneTradeItem(gameState, item);
    if (res && res.changed) {
      closeItemDetailModal();
      renderCargoPage("trade");
      updateUI();
      showToast(item.kind === "lp"
        ? ("🎖 兑换获得 " + ((res.lp || 0)).toLocaleString() + " 功勋")
        : ("💰 出售获得 " + ((res.isk || 0)).toLocaleString() + " 星币"));
    } else {
      showToast("此物品无需回收");
    }
  });
  const compDismantleBtn = backdrop.querySelector(".eem-comp-dismantle");
  if (compDismantleBtn) compDismantleBtn.addEventListener("click", () => {
    const cid = compDismantleBtn.dataset.compDismantle;
    closeItemDetailModal();
    if (typeof openComponentDismantleModal === "function") {
      openComponentDismantleModal(cid, () => { if (typeof renderCargoPage === "function") renderCargoPage(cargoFilter); });
    }
  });
}

function closeItemDetailModal() {
  const backdrop = document.getElementById("item-detail-modal");
  if (backdrop) { backdrop.style.display = "none"; backdrop.innerHTML = ""; }
}

/* ================================================================
   奖励条目规范化 + 持久结算弹窗（Batch R）
   —— 离线收益（B 项）与货柜开箱（C 项）统一走同一张仓库物品卡。
   ================================================================ */

// cargo rolls 条目（openCargoContainer 输出）或库存快照 diff 条目 →
// buildCargoCardHTML 可直接消费的 item 形态（含 name/icon/quantity/categoryLabel/source）。
// 名称优先使用条目自带 name，否则经 getResourceDisplayName（内部走 DisplayNames）解析；
// 未知 id 回退 raw id，绝不泄漏 undefined。
const CARGO_TIER_LABELS = { T1:"T1 保底", T2:"T2 矿物", T3:"T3 战利品", T4:"T4 植入体", BP:"蓝图" };
function normalizeRewardItem(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry._normalized) return entry;
  const qtyRaw = Number(entry.quantity);
  const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : (Math.max(1, Math.floor(Number(entry.qty)) || 1));
  let name = (typeof entry.name === "string" && entry.name) ? entry.name : "";
  if (!name && typeof entry.id === "string") {
    const rid = entry.id;
    // 脑插 / 货柜装备蓝图条目无自带 name：先走专用 DB（IMPLANT_DB / EQUIPMENT_DB），
    // 再回落资源显示名解析（getResourceDisplayName 内部走 DisplayNames），最后原始 id。
    if (entry.implant && typeof IMPLANT_DB !== "undefined" && IMPLANT_DB && IMPLANT_DB[rid]) {
      name = IMPLANT_DB[rid].name || rid;
    } else if (rid.indexOf("blueprint:") === 0 && typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB) {
      const eq = EQUIPMENT_DB[rid.slice("blueprint:".length)];
      name = (eq && eq.name ? eq.name : rid.slice("blueprint:".length)) + "蓝图";
    } else if (typeof getResourceDisplayName === "function") {
      name = getResourceDisplayName(rid);
    } else if (typeof DisplayNames !== "undefined" && DisplayNames && typeof DisplayNames.getResourceRefName === "function") {
      name = DisplayNames.getResourceRefName(rid, rid);
    } else {
      name = rid;
    }
  }
  if (!name) name = "未知";
  let icon = (typeof entry.icon === "string" && entry.icon) ? entry.icon : "";
  if (!icon) {
    const rid = typeof entry.id === "string" ? entry.id : "";
    if (entry.loot || rid.indexOf("loot:") === 0) icon = entry.kind === "lp" ? "🎖" : "💰";
    else if (entry.implant) icon = "🧠";
    else if (entry.blueprint || rid.indexOf("blueprint:") === 0) icon = "📜";
    else if (entry.ammo) icon = entry.weaponType === "laser" ? "🔹" : entry.weaponType === "missile" ? "🚀" : "💥";
    else if (rid.indexOf("special:货柜") === 0) icon = "📦";
    else icon = "📦";
  }
  const categoryLabel = (typeof entry.categoryLabel === "string" && entry.categoryLabel)
    ? entry.categoryLabel
    : (CARGO_TIER_LABELS[entry.tier] || (entry.loot ? "战利品" : entry.implant ? "脑插" : entry.blueprint ? "蓝图" : entry.ammo ? "弹药" : "物资"));
  // canonical ref：优先保留条目自带 ref/id（资源权威键），仅在两者皆缺时回落显示名。
  // 注意：具名战利品（loot:isk/loot:lp）和弹药（ammo:T1/ammo:T2）的 id 是统一档位键，
  // 真正区分它们的是显示名 / 武器类型，因此必须拼接成唯一 ref，否则「同 ID、不同名」会被错误合并。
  let canonicalRef = (typeof entry.ref === "string" && entry.ref)
    ? entry.ref
    : (typeof entry.id === "string" && entry.id ? entry.id : name);
  if (entry.loot || (typeof entry.id === "string" && entry.id.indexOf("loot:") === 0)) {
    canonicalRef = "loot:" + (entry.kind || "isk") + ":" + name;
  } else if (entry.ammo) {
    canonicalRef = "ammo:" + (entry.weaponType || "unknown") + ":" + (entry.tier || "T1") + ":" + name;
  }
  return {
    _normalized:true,
    ref:canonicalRef,
    name,
    icon,
    quantity,
    categoryLabel,
    source:entry.source || { pageLabel:"获得" }
  };
}

// 按 canonical ref（显示名）聚合 rolls 条目，合并相同物品数量，按数量降序。
function aggregateRewardRolls(rolls) {
  const byRef = new Map();
  for (const roll of Array.isArray(rolls) ? rolls : []) {
    const item = normalizeRewardItem(roll);
    if (!item) continue;
    const existing = byRef.get(item.ref);
    if (existing) existing.quantity += item.quantity;
    else byRef.set(item.ref, item);
  }
  return [...byRef.values()].sort((a, b) => b.quantity - a.quantity || a.ref.localeCompare(b.ref, "zh-CN"));
}

// 离线战斗停止原因 → 人话（供结算弹窗「结算说明」展示）
function humanizeOfflineStopReason(reason) {
  const map = {
    "time": "离线时间耗尽（正常结算）",
    "time-pending": "离线时间耗尽（正常结算）",
    "queue-target-reached": "战斗队列目标已达成",
    "ammo": "弹药耗尽，战斗停止",
    "resources": "资源不足，无法继续开火",
    "repairing": "战败维修中，离线预算已耗尽",
    "belt-continue-after-repair": "维修完成后继续战斗",
    "ds-continue-after-repair": "维修完成后继续战斗",
    "inactive": "离线前无有效战斗",
    "no-zone": "无可用星带目标",
    "no-site": "无可用死亡空间",
    "level-locked": "战斗等级不足（死亡空间锁定）",
    "no-weapons": "未安装战斗武器",
    "no-keys": "通行密钥不足",
    "chain-complete": "连刷链已完成",
    "queue-finalize-error": "队列结算异常",
    "resolved": "战斗已自然结束"
  };
  if (!reason) return "（未记录停止原因）";
  return map[reason] || ("结算状态：" + reason);
}

// 持久奖励结算弹窗：仅显式关闭按钮 / 点击背景 / Escape 可关闭（无自动计时）。
// options: { title, subtitle, items, emptyText, combat }
function openRewardResultModal(options) {
  const opt = options && typeof options === "object" ? options : {};
  const items = Array.isArray(opt.items) ? opt.items : [];
  // 离线战斗汇总块（opt.combat 由 showOfflineToast 透传）
  const c = opt.combat;
  const combatHtml = c ? `
    <div class="reward-combat-block${c.warn ? " warn" : ""}">
      <div class="rcb-head"><span class="rcb-icon">⚔️</span><span>离线战斗</span></div>
      <div class="rcb-stats">
        <div class="rcb-stat"><span>清剿波次</span><b>${Number(c.waves) || 0} 波</b></div>
        <div class="rcb-stat"><span>击杀</span><b>${Number(c.kills) || 0}</b></div>
        <div class="rcb-stat"><span>清波</span><b>${Number(c.zoneClears) || 0}</b></div>
        <div class="rcb-stat"><span>被击败</span><b>${Number(c.defeats) || 0}</b></div>
        <div class="rcb-stat"><span>最高波次</span><b>${Number(c.maxWave) || 0}</b></div>
      </div>
      <div class="rcb-note">结算说明：${escapeAchievementText(humanizeOfflineStopReason(c.stopReason))}</div>
    </div>` : "";
  let backdrop = document.getElementById("reward-result-modal");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "reward-result-modal";
    backdrop.className = "equip-enh-modal-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) closeRewardResultModal(); });
    backdrop._esc = event => { if (event.key === "Escape" && backdrop.style.display === "flex") closeRewardResultModal(); };
    document.addEventListener("keydown", backdrop._esc);
  }
  const cards = items.map(item => buildCargoCardHTML(item, { extraClass:"reward-result-card" })).join("");
  const emptyText = opt.emptyText || "本次没有获得可展示的物品";
  backdrop.innerHTML = `
    <div class="equip-enh-modal reward-result-modal" role="dialog" aria-modal="true">
      <div class="eem-head">
        <span class="eem-icon">🎁</span>
        <div class="eem-title-wrap">
          <div class="eem-title">${escapeAchievementText(opt.title || "结算结果")}</div>
          ${opt.subtitle ? `<div class="eem-sub reward-sub-line">${escapeAchievementText(opt.subtitle)}</div>` : ""}
        </div>
        <button class="eem-close" data-rrm-close aria-label="关闭">✕</button>
      </div>
      <div class="eem-body">
        ${combatHtml}
        ${items.length ? `<div class="reward-result-grid">${cards}</div>` : `<div class="reward-result-empty">${escapeAchievementText(emptyText)}</div>`}
      </div>
    </div>`;
  backdrop.style.display = "flex";
  const closeBtn = backdrop.querySelector("[data-rrm-close]");
  if (closeBtn) closeBtn.addEventListener("click", closeRewardResultModal);
  return backdrop;
}

function closeRewardResultModal() {
  const backdrop = document.getElementById("reward-result-modal");
  if (backdrop) { backdrop.style.display = "none"; backdrop.innerHTML = ""; }
}

// 战斗日志弹窗：展示「本场战斗」（在线+离线合并）的累计统计。
// 数据来自 getCombatLog()：计数器走事件/离线聚合，产物/ISK/LP/技能经验由开局快照差惰性得出。
function openCombatLogModal() {
  const log = (typeof getCombatLog === "function") ? getCombatLog() : null;
  const backdrop = ensureCombatLogBackdrop();
  if (!log) {
    backdrop.innerHTML = combatLogShell(
      `<div class="cl-empty">本场暂无战斗记录。<br/>开始一场战斗后，这里会累计波次、肃清、技能经验与获得产物。</div>`
    );
    backdrop.style.display = "flex";
    return backdrop;
  }

  // 时长格式化
  const fmtDur = (ms) => {
    const s = Math.floor((ms || 0) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h} 小时 ${m} 分`;
    if (m > 0) return `${m} 分 ${sec} 秒`;
    return `${sec} 秒`;
  };
  // ISK 紧凑格式
  const fmtIsk = (n) => {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toLocaleString();
  };

  const stat = (k, v, cls) => `<div class="cl-stat${cls ? " " + cls : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const statHtml = [
    stat("清剿波次", log.waves.toLocaleString(), "gold"),
    stat("星带肃清", log.zones.toLocaleString(), "green"),
    stat("死亡空间波", log.dsWaves.toLocaleString(), "blue"),
    stat("死亡空间全通", log.dsClears.toLocaleString(), "blue"),
    stat("击杀", log.kills.toLocaleString()),
    stat("精英 / BOSS", log.eliteKills.toLocaleString() + " / " + log.bossKills.toLocaleString()),
    stat("被击败", log.defeats.toLocaleString(), log.defeats > 0 ? "warn" : ""),
    stat("ISK / LP", fmtIsk(log.isk) + " / " + log.lp.toLocaleString())
  ].join("");

  // 技能经验
  let skillHtml;
  if (log.skills.length === 0) {
    skillHtml = `<div class="cl-empty small">本场暂无技能经验获得</div>`;
  } else {
    skillHtml = log.skills.map(s => {
      const lvlText = s.leveled
        ? `<span class="cl-lvl-up">Lv${s.startLvl} → Lv${s.lvlNow} ↑升级</span>`
        : `Lv${s.lvlNow}`;
      return `<div class="cl-xp-row">
        <span class="cl-xp-name">${s.icon} ${escapeAchievementText(s.name)}</span>
        <span class="cl-xp-bar"><span style="width:${s.progress}%"></span></span>
        <span class="cl-xp-val">+${s.xp.toLocaleString()}<span class="cl-lvl">${lvlText}</span></span>
      </div>`;
    }).join("");
  }

  // 产物（复用 cargo 卡片，与仓库一致）
  let lootHtml;
  if (log.loot.length === 0) {
    lootHtml = `<div class="cl-empty small">本场未获得可展示的产物</div>`;
  } else {
    lootHtml = `<div class="reward-result-grid">${log.loot.map(item => buildCargoCardHTML(item, { extraClass:"reward-result-card" })).join("")}</div>`;
  }

  const sub = `<span class="cl-tag">在线 + 离线合并</span>本场累计 ${fmtDur(log.elapsedMs)}${log.running ? " · 进行中" : " · 已停止"}`;

  backdrop.innerHTML = combatLogShell(`
    <div class="cl-sec">
      <div class="cl-sec-title">战斗统计</div>
      <div class="cl-stat-grid">${statHtml}</div>
    </div>
    <div class="cl-sec">
      <div class="cl-sec-title">战斗技能经验（战斗授予）</div>
      <div class="cl-xp-list">${skillHtml}</div>
    </div>
    <div class="cl-sec">
      <div class="cl-sec-title">获得产物（在线 + 离线合并逐件）</div>
      ${lootHtml}
    </div>
  `, sub);
  backdrop.style.display = "flex";
  const closeBtn = backdrop.querySelector("[data-clm-close]");
  if (closeBtn) closeBtn.addEventListener("click", closeCombatLogModal);
  return backdrop;
}

function ensureCombatLogBackdrop() {
  let backdrop = document.getElementById("combat-log-modal");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "combat-log-modal";
    backdrop.className = "equip-enh-modal-backdrop";
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) closeCombatLogModal(); });
    backdrop._esc = event => { if (event.key === "Escape" && backdrop.style.display === "flex") closeCombatLogModal(); };
    document.addEventListener("keydown", backdrop._esc);
  }
  return backdrop;
}

function closeCombatLogModal() {
  const backdrop = document.getElementById("combat-log-modal");
  if (backdrop) { backdrop.style.display = "none"; backdrop.innerHTML = ""; }
}

// 战斗日志弹窗外壳（复用结算弹窗的 eem-* 容器类，保证风格一致）
function combatLogShell(bodyHtml, subHtml) {
  return `
    <div class="equip-enh-modal combat-log-modal" role="dialog" aria-modal="true">
      <div class="eem-head">
        <span class="eem-icon">📜</span>
        <div class="eem-title-wrap">
          <div class="eem-title">本场战斗日志</div>
          ${subHtml ? `<div class="eem-sub reward-sub-line">${subHtml}</div>` : ""}
        </div>
        <button class="eem-close" data-clm-close aria-label="关闭">✕</button>
      </div>
      <div class="eem-body">${bodyHtml}</div>
    </div>`;
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
  const discardCb = document.getElementById("setting-discard-confirm");
  if (discardCb) discardCb.checked = display.confirmDiscard;
  const dismantleCb = document.getElementById("setting-dismantle-confirm");
  if (dismantleCb) dismantleCb.checked = display.confirmDismantle;
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
    const bodyHtml = '<p class="dlg-body">取消当前研究？将退还已投入的成就工时 ' + formatResearchHours(refunded / 3600) + '。</p>';
    console.log("[research] cancel confirm open");
    showDangerConfirm("取消研究", bodyHtml, "确认取消", () => {
      console.log("[research] cancel confirm confirmed");
      const result = dispatchGameAction(gameState, { type: "research/cancel" }, Date.now());
      if (!result.changed) { showToast(researchReasonText(result.reason)); return; }
      renderResearchPage();
    }, () => {
      console.log("[research] cancel confirm dismissed");
    });
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
    showDangerConfirm("⚠ 自动强化",
      "<p class=\"dlg-body\">确认对该舰船执行自动强化？将按设定次数反复尝试直至部件不足。</p>",
      "确认强化",
      () => {
        const result = dispatchGameAction(gameState, { type:"research/runAutoEnhancement", instanceId, context:{} }, Date.now());
        if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
        showToast("自动强化完成 ｜ 尝试 " + result.attempts + " ｜ 成功 " + result.successes + " ｜ 失败 " + result.failures +
          " ｜ 终等级 " + result.toLevel + " ｜ 停止：" + (result.stopReason || ""));
        renderResearchPage();
      });
    return;
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
    showDangerConfirm("⚠ 取消造船作业",
      "<p class=\"dlg-body\">确认取消当前造船作业？已产出的组件与舰船保留，未完成部分不再继续。</p>",
      "确认取消",
      () => {
        const result = dispatchGameAction(gameState, { type:"research/cancelIntship" }, Date.now());
        if (!result || !result.changed) { showToast(researchReasonText(result && result.reason)); return; }
        showToast("造船作业已取消");
        renderResearchPage();
      });
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
  const names = { shieldCapacity:"+护盾", armorCapacity:"+装甲", structureCapacity:"+结构", laserDamage:"+激光伤", missileDamage:"+导弹伤", cannonDamage:"+炮台伤", targetingSpeed:"+锁定", speed:"+速度", miningLaserEfficiency:"+采矿器效能", gasLaserEfficiency:"+采气器效能", salvageEfficiency:"+打捞效率", fleetMiningSpeed:"+舰队采矿速度", smeltingSpeed:"+冶炼速度", miningEfficiency:"+采矿效率", gasEfficiency:"+采气效率", armorRepair:"装甲维修", structureRepair:"结构维修" };
  return Object.entries(bonuses || {}).filter(([key]) => key !== "structureEmergencyRepair").map(([key, value]) => {
    // 考古船加成为绝对数值 / 固定减免，不能按百分比乘 100 显示。
    if (key === "archaeologyScanStrength") return "扫描强度 " + value;
    if (key === "archaeologyFailureDamageReduction") return "失败反噬减免 " + Math.round(value * 100) + "%";
    if (key === "structureRepair") {
      const extra = (bonuses.structureEmergencyRepair || 0);
      const line = "结构维修 +" + Math.round(value * 100) + "%";
      return extra > 0 ? line + "（结构<70%时 +" + Math.round((value + extra) * 100) + "%）" : line;
    }
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
    const iskCostLine = enhancement.iskCost > 0
      ? `<span class="enhance-material${enhancement.iskEnough ? "" : " short"}">💰 星币 ${enhancement.iskStock.toLocaleString()}/${enhancement.iskCost.toLocaleString()}</span>`
      : "";
    const enhanceDisabled = enhancement.canEnhance ? "" : "disabled";
    const enhanceLabel = enhancement.busy ? "执行任务中" : enhancement.available ? "强化至 +" + (enhancement.level + 1) : "暂不可强化";
    const thumbUrl = getHangarThumb(ship.shipId);
    const thumbHtml = thumbUrl ? `<img class="hangar-ship-thumb" data-open-3d="${ship.instanceId}" src="${thumbUrl}" alt="${ship.name}" title="点击查看 3D 模型">` : "";
    // Batch R（E 项·舰船拆解）：危险样式按钮；不可拆解时禁用并悬停提示阻塞原因
    const dismantle = ship.dismantle || { available:false, preview:[], canDismantle:false, blockedText:"", reclaimPercent:null };
    const reclaimHint = dismantle.reclaimPercent != null ? "（冶炼回收 " + dismantle.reclaimPercent + "%）" : "";
    const dismantleBtn = dismantle.available
      ? `<button class="btn danger hangar-dismantle-btn" data-dismantle-ship="${ship.instanceId}" ${dismantle.canDismantle ? "" : "disabled"} title="${escapeAchievementText((dismantle.blockedText || "当前无法拆解") + reclaimHint)}" style="margin-left:6px;">🗑 拆解</button>`
      : "";
    return `<div class="hangar-ship-card${ship.assignedActions.length ? " equipped" : ""}">${thumbHtml}
      <div class="hangar-ship-header"><span class="hsh-icon">${ship.archaeology ? "🛰️" : ship.industrial ? "🏭" : "🚀"}</span><span class="hsh-name">${ship.name}</span><span class="enhance-level${enhancement.milestone ? " milestone-next" : ""}">+${enhancement.level}</span><span class="hsh-tier">${ship.tier} ${ship.typeName}</span><span class="hsh-tier">${ship.archaeology ? "🛰️ 考古" : ship.industrial ? "🏭 工业" : "⚔️ 战斗"}</span>${ship.assignedActions.length ? `<span class="hsh-equipped">📋 ${ship.assignedActions.map(key => display.actionNames[key]).join("+")}</span>` : ""}</div>
      <div class="hangar-ship-stats"><span class="hss-item"><span class="hss-label">护盾</span><span class="hss-val">${ship.hp.shield}</span></span><span class="hss-item"><span class="hss-label">装甲</span><span class="hss-val">${ship.hp.armor}</span></span><span class="hss-item"><span class="hss-label">结构</span><span class="hss-val">${ship.hp.structure}</span></span><span class="hss-item"><span class="hss-label">闪避</span><span class="hss-val">${ship.dodge}</span></span><span class="hss-item"><span class="hss-label">速度</span><span class="hss-val">${ship.speed}</span></span></div>
      ${bonuses ? `<div class="hangar-ship-bonuses">舰船加成：${bonuses}</div>` : ""}
      ${ship.repairing ? `<div class="hangar-ship-repair" data-repair-ship="${ship.instanceId}">🔧 自动维修中 · 剩余 <span class="repair-remaining">${ship.repairRemaining}</span> 秒</div>` : ""}
      <div class="hangar-enhancement${enhancement.milestone ? " milestone" : ""}"><div class="enhance-summary"><strong>强化 +${enhancement.level}</strong><span>${getEnhancementBonusText(enhancement)}</span></div><div class="enhance-next">${enhancement.milestone ? "★ 里程碑 · " : ""}${getEnhancementNextText(enhancement)}</div><div class="enhance-materials">${materials}${iskCostLine}</div><div class="enhance-roll"><span>成功率 <b>${enhancement.chancePercent}%</b></span><span>成功 ${enhancement.successXp} XP · 失败 ${enhancement.failureXp} XP并清零</span><button class="btn enhance-btn" data-enhance-ship="${ship.instanceId}" ${enhanceDisabled}>${enhanceLabel}</button></div></div>
      <div class="hangar-ship-actions">${assignments}<button class="btn" data-open-fitting="${ship.instanceId}" style="margin-left:6px;">🔧 装备</button>${dismantleBtn}</div></div>`;
  }).join("");
  return display;
}

function enhanceShipFromHangar(instanceId) {
  const display = getHangarDisplayState(gameState, Date.now());
  const ship = display.ships.find(item => item.instanceId === instanceId);
  if (!ship || !ship.enhancement || !ship.enhancement.available) return false;
  console.log("[ship-op][enhance] open", { instanceId: instanceId, name: ship.name, level: ship.enhancement.level });
  const doEnhance = () => {
    console.log("[ship-op][enhance] confirm", { instanceId: instanceId });
    const result = dispatchGameAction(gameState, { type:"hangar/enhanceShip", instanceId }, Date.now());
    if (!result.changed) {
      const messages = { "insufficient-components":"强化部件不足", "insufficient-isk":"星币不足", "ship-active":"舰船执行任务时不能强化", "enhancement-unavailable":"该舰船暂无对应强化部件" };
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
  };
  const confirmationEnabled = getSettingsDisplayState(gameState).confirmShipEnhancement;
  if (confirmationEnabled) {
    const costLines = (ship.enhancement.materials || []).map(m => m.name + "×" + m.quantity).join("、");
    const iskLine = ship.enhancement.iskCost > 0 ? ("<br>消耗星币：" + ship.enhancement.iskCost.toLocaleString()) : "";
    const bodyHtml =
      '<p class="dlg-body">强化 ' + escapeAchievementText(ship.name) + '：+' + ship.enhancement.level + ' → +' + (ship.enhancement.level + 1) + '</p>' +
      '<p class="dlg-body">成功率：' + ship.enhancement.chancePercent + '%</p>' +
      '<p class="dlg-body">消耗部件：' + escapeAchievementText(costLines) + iskLine + '</p>' +
      '<p class="dlg-body dlg-warn">失败将消耗部件，等级保持 +' + ship.enhancement.level + '、0 XP。</p>';
    showDangerConfirm("⚠ 强化舰船", bodyHtml, "确认强化", doEnhance, () => {
      console.log("[ship-op][enhance] cancel", { instanceId: instanceId });
    });
  } else {
    doEnhance();
  }
  return true;
}

/* 诊断加固：显式导出到 window，确保 TapTap 竖屏入口在任意加载顺序/打包方式下都能稳定调用，
   不再依赖经典脚本顶层函数提升产生的隐式全局（防止未来模块化或 shell-render / taptap-portrait 版本错配）。 */
if (typeof window !== "undefined") {
  window.enhanceShipFromHangar = enhanceShipFromHangar;
  window.dismantleShipFromHangar = dismantleShipFromHangar;
}

// Batch R（E 项·舰船拆解）：二次确认（含归还预览 + 不可恢复警告）→ Action → 重渲染。
function dismantleShipFromHangar(instanceId) {
  const display = getHangarDisplayState(gameState, Date.now());
  const ship = display.ships.find(item => item.instanceId === instanceId);
  if (!ship || !ship.dismantle || !ship.dismantle.available) { showToast("该舰船没有可拆解配方"); return false; }
  if (!ship.dismantle.canDismantle) {
    showToast(ship.dismantle.blockedText || "当前无法拆解");
    return false;
  }
  console.log("[ship-op][dismantle] open", { instanceId: instanceId, name: ship.name });
  const previewLines = (ship.dismantle.preview || []).map(entry => entry.name + "×" + entry.returned).join("、");
  const doDismantle = () => {
    console.log("[ship-op][dismantle] confirm", { instanceId: instanceId });
    const result = dispatchGameAction(gameState, { type:"hangar/disassembleShip", instanceId }, Date.now());
    if (!result.changed) {
      const messages = {
        "unknown-ship":"舰船不存在",
        "ship-assigned":"舰船正在执行岗位任务，无法拆解",
        "ship-active":"舰船正在执行中，停止当前任务后才能拆解",
        "repairing":"舰船正在维修中，维修完成后才能拆解",
        "has-fitting":"舰船仍装配有装备或改装件，先全部卸下",
        "no-dismantle-recipe":"该舰船没有可拆解配方"
      };
      showToast(messages[result.reason] || "拆解失败");
      return false;
    }
    const returnedText = (result.returned || []).map(entry => entry.name + "×" + entry.returned).join("、");
    showToast("已拆解 " + result.config.name + "，归还：" + (returnedText || "无材料"));
    renderHangarPanel();
    renderCombatPanel();
    updateUI();
    return true;
  };
  const reclaimPercent = (ship.dismantle && ship.dismantle.reclaimPercent != null) ? ship.dismantle.reclaimPercent : 50;
  const bodyHtml =
    '<p class="dlg-body dlg-warn">确认拆解 ' + escapeAchievementText(ship.name) + '？拆解后舰船将消失，不可恢复。</p>' +
    '<p class="dlg-body">归还材料（约 ' + reclaimPercent + '%）：' + (escapeAchievementText(previewLines) || "无") + '</p>' +
    '<p class="dlg-body dlg-warn">不归还：蓝图、技能经验、强化等级、已装配装备、强化消耗的星币。</p>';
  showDangerConfirm("🗑 拆解舰船", bodyHtml, "确认拆解", doDismantle, () => {
    console.log("[ship-op][dismantle] cancel", { instanceId: instanceId });
  });
  return true;
}

function enhanceEquipmentFromWarehouse(targetRef, onDone) {
  if (!targetRef) { if (typeof onDone === "function") onDone(null); return false; }
  const resolved = resolveEquipmentReference(gameState, targetRef);
  if (!resolved) { showToast("装备不存在"); if (typeof onDone === "function") onDone(null); return false; }
  const definition = resolved.definition;
  const fromLevel = resolved.enhancementLevel;
  const engLevel = Number(gameState.skills && gameState.skills.equipmentEngineering && gameState.skills.equipmentEngineering.lvl) || 1;
  const preview = getEquipmentEnhancementDisplayState(definition, fromLevel, engLevel);
  const doEnhance = () => {
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
      if (typeof onDone === "function") onDone(result);
      return;
    }
    showToast(result.success
      ? `${definition.name} 强化成功：+${result.fromLevel} → +${result.toLevel}，获得 ${result.xp} 经验`
      : `强化失败，等级保持 +${result.fromLevel}，本次材料已消耗`);
    renderCargoPage("equipment");
    renderCombatPanel();
    updateUI();
    if (typeof onDone === "function") onDone(result);
  };
  const confirmationEnabled = getSettingsDisplayState(gameState).confirmShipEnhancement;
  if (confirmationEnabled) {
    const materialLines = Object.entries(preview.cost).map(([mineral, qty]) => `${mineral}×${qty}`).join("、");
    const extraLines = [];
    if (preview.extra.sameTypeItemId) extraLines.push("同型号 +0 装备×1");
    if (preview.extra.core) extraLines.push(preview.extra.core + "×1");
    if (preview.extra.protocol) extraLines.push(preview.extra.protocol + "×1");
    const fullList = [materialLines, ...extraLines].filter(Boolean).join(" + ");
    const bodyHtml =
      '<p class="dlg-body">强化 ' + escapeAchievementText(definition.name) + '：+' + fromLevel + ' → +' + (fromLevel + 1) + '</p>' +
      '<p class="dlg-body">成功率：' + (Math.round(preview.success * 1000) / 10) + '%</p>' +
      '<p class="dlg-body">消耗材料：' + escapeAchievementText(fullList || "无") + '</p>' +
      '<p class="dlg-body dlg-warn">失败仅消耗材料，等级保持 +' + fromLevel + '，不会回退或降级。</p>';
    console.log("[equip-op][enhance] confirm open");
    showDangerConfirm("强化装备", bodyHtml, "确认强化", () => {
      console.log("[equip-op][enhance] confirm confirmed");
      doEnhance();
    }, () => {
      console.log("[equip-op][enhance] confirm dismissed", { targetRef: targetRef });
    });
    return true;
  }
  doEnhance();
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
    // 相同 itemId 按强化等级聚合堆叠，避免装备过多撑破面板
    const stacks = slot.type === "rig"
      ? ((display.rigStackCandidates && display.rigStackCandidates[slot.slotIndex]) || [])
      : (display.inventoryStacksBySlot && display.inventoryStacksBySlot[slot.type]) || [];
    if (slot.type === "rig") {
      // 改装件槽：拆卸即销毁（不返还库存）。占用槽提供"销毁"按钮；替换=旧件销毁+新件安装。
      const destroyButton = slot.equipmentId
        ? '<button class="equip-option empty-option" data-rig-destroy="1"><span class="eq-icon">🗑</span><span class="eq-name">销毁改装件（不返还）</span></button>'
        : "";
      const hint = '<div class="equip-option-hint" style="padding:6px 10px;font-size:11px;color:#8a6d3b;">⚠ 改装件安装后拆卸/替换即销毁；同系列可重复装配，但后续装配受谐振效应影响，实际效果递减</div>';
      options.innerHTML = hint + destroyButton + (stacks.length
        ? stacks.map(item => `<button class="equip-option" data-equip="${item.ids[0]}"><span class="eq-icon">${item.icon}</span><span class="eq-name">${item.name}${item.enhancementLevel ? " +" + item.enhancementLevel : ""}${item.count > 1 ? " <span class=\"eq-count\">×" + item.count + "</span>" : ""}</span></button>`).join("")
        : '<div class="equip-option-hint" style="padding:6px 10px;font-size:12px;color:#4a5a6a;">仓库中没有可安装的改装件</div>');
    } else {
      options.innerHTML = '<button class="equip-option empty-option" data-equip=""><span class="eq-icon">○</span><span class="eq-name">卸下装备</span></button>' + stacks.map(item => `<button class="equip-option" data-equip="${item.ids[0]}"><span class="eq-icon">${item.icon}</span><span class="eq-name">${item.name}${item.enhancementLevel ? " +" + item.enhancementLevel : ""}${item.count > 1 ? " <span class=\"eq-count\">×" + item.count + "</span>" : ""}</span></button>`).join("");
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

// 改装件安装结果处理：提示 + 刷新装配面板
function handleRigFitResult(res) {
  if (!res.changed && res.reason === "combat-active") showToast("战斗中不能调整当前舰船装备");
  else if (!res.changed && res.reason === "slot-occupied") showToast("该改装槽已被占用");
  else if (!res.changed && res.reason === "equipment-unavailable") showToast("仓库中没有该改装件");
  else if (!res.changed && res.reason) showToast("操作失败：" + res.reason);
  const panel = document.getElementById("equipSelectPanel"); if (panel) panel.classList.remove("active");
  buildOrbit(); updateOrbitLibrary(); updateOrbitStats(); renderHangarPanel();
}

// 谐振（堆叠）提示弹窗：显示本次装配同系列改装件的实际效果量
function showRigResonanceModal(preview, def, onConfirm) {
  let modal = document.getElementById("rigResonanceModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "rigResonanceModal";
    modal.className = "rig-resonance-overlay";
    document.body.appendChild(modal);
    const style = document.createElement("style");
    style.textContent =
      ".rig-resonance-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);}" +
      ".rig-resonance-overlay.active{display:flex;}" +
      ".rig-resonance-box{width:min(420px,90vw);background:#16202c;border:1px solid #2a3a4a;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden;}" +
      ".rig-resonance-box h3{margin:0;padding:14px 18px;font-size:15px;background:linear-gradient(90deg,#1d2a38,#16202c);border-bottom:1px solid #2a3a4a;color:#ffd27d;}" +
      ".rig-resonance-body{padding:16px 18px;color:#cdd8e3;font-size:13px;line-height:1.6;}" +
      ".rig-resonance-note{color:#8a9aae;font-size:12px;margin:8px 0 12px;}" +
      ".rig-resonance-grid{display:grid;grid-template-columns:1fr auto;gap:6px 12px;background:#0f1822;border:1px solid #223040;border-radius:8px;padding:12px 14px;margin:6px 0;}" +
      ".rig-resonance-grid .k{color:#8a9aae;}" +
      ".rig-resonance-grid .v{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;}" +
      ".rig-resonance-grid .v.dim{color:#7dd3fc;}" +
      ".rig-resonance-grid .v.warn{color:#ffb454;}" +
      ".rig-resonance-actions{display:flex;gap:10px;padding:14px 18px;border-top:1px solid #2a3a4a;}" +
      ".rig-resonance-actions button{flex:1;padding:9px 0;border-radius:7px;border:1px solid #2a3a4a;cursor:pointer;font-size:13px;}" +
      ".rig-resonance-actions .cancel{background:transparent;color:#9fb0c0;}" +
      ".rig-resonance-actions .confirm{background:#c0392b;border-color:#e74c3c;color:#fff;}";
    document.head.appendChild(style);
  }
  const series = (typeof RIG_SERIES !== "undefined") ? RIG_SERIES.find(s => s.stackGroup === preview.stackGroup) : null;
  const seriesLabel = (series && series.label) || preview.stackGroup;
  const bonusLabel = (typeof EQUIPMENT_BONUS_NAMES !== "undefined" && EQUIPMENT_BONUS_NAMES[preview.bonusKey]) || preview.bonusKey;
  const pct = v => (v * 100).toFixed((Math.abs(v * 100) % 1 < 1e-9) ? 0 : 1) + "%";
  modal.innerHTML =
    '<div class="rig-resonance-box">' +
      '<h3>⚡ 谐振效应提示</h3>' +
      '<div class="rig-resonance-body">' +
        '你正在安装第 <b>' + preview.newPosition + '</b> 个「<b>' + seriesLabel + '</b>」改装件。<br>' +
        '同一舰船重复装配同系列改装件，后装配的改装件会因<b>谐振效应</b>降低实际效果。' +
        '<div class="rig-resonance-note">「' + bonusLabel + '」名义效果 ' + pct(preview.baseValue) + '，实际生效量见下：</div>' +
        '<div class="rig-resonance-grid">' +
          '<span class="k">本件名义效果</span><span class="v">+' + pct(preview.baseValue) + '</span>' +
          '<span class="k">谐振系数（第 ' + preview.newPosition + ' 件）</span><span class="v warn">×' + pct(preview.penalty) + '</span>' +
          '<span class="k">本件实际生效</span><span class="v dim">+' + pct(preview.effectiveValue) + '</span>' +
          '<span class="k">安装前该系列累计</span><span class="v">+' + pct(preview.totalBefore) + '</span>' +
          '<span class="k">安装后该系列累计</span><span class="v dim">+' + pct(preview.totalAfter) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="rig-resonance-actions">' +
        '<button class="cancel" data-rr-cancel>取消</button>' +
        '<button class="confirm" data-rr-confirm>仍要安装</button>' +
      '</div>' +
    '</div>';
  modal.classList.add("active");
  const close = () => modal.classList.remove("active");
  modal.querySelector("[data-rr-cancel]").onclick = close;
  modal.querySelector("[data-rr-confirm]").onclick = () => { close(); onConfirm(); };
  modal.onclick = e => { if (e.target === modal) close(); };
}

function renderQueuePanel() {
  const display = getQueueDisplayState(gameState);
  const status = document.getElementById("queue-status-text"); if (status) status.textContent = display.statusText;
  const loop = document.getElementById("queue-loop-check"); if (loop) loop.checked = display.loopMode;
  const list = document.getElementById("queue-list"); if (!list) return display;
  list.innerHTML = display.items.length ? display.items.map(item => `<div class="queue-item${item.active ? " active" : ""}"><span class="qi-idx">${item.index + 1}</span><span class="qi-icon">${item.icon}</span><div class="qi-info"><span class="qi-name">${item.skillLabel} · ${item.label}</span><span class="qi-detail">${item.countText}</span></div><span class="qi-status ${item.active ? "running" : "waiting"}">${item.active ? "执行中" : "等待"}</span><div class="qi-actions">${item.canMoveTop ? `<button class="qi-btn top-btn" data-queue-action="top" data-index="${item.index}" title="一键置顶"><i class="fa-solid fa-angles-up"></i></button>` : ""}${item.canMoveUp ? `<button class="qi-btn" data-queue-action="up" data-index="${item.index}" title="上移一位"><i class="fa-solid fa-arrow-up"></i></button>` : ""}${item.canMoveDown ? `<button class="qi-btn" data-queue-action="down" data-index="${item.index}" title="下移一位"><i class="fa-solid fa-arrow-down"></i></button>` : ""}<button class="qi-btn" data-queue-action="remove" data-index="${item.index}" title="移除"><i class="fa-solid fa-xmark"></i></button></div></div>`).join("") : '<div style="text-align:center;color:#4a5a6a;padding:20px;font-size:13px;">队列为空，从技能面板点击"加入队列"添加任务</div>';
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
let _tutorialWidgetDragInstalled = false;
const TUTORIAL_WIDGET_POS_KEY = "eveidle.tutorialWidgetPos";
const TUTORIAL_WIDGET_DRAG_MIN_W = 721; // 历史阈值：桌面默认右上角悬浮卡；移动端默认底部条。两类布局均允许拖动。

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

// 拖动支持：标题栏作为抓手，把原 right/bottom 锚点折算成 left/top，clamp 到视口，位置写入 localStorage 持久化。
// 桌面端（>720px）默认右上角悬浮卡；移动端（≤720px）默认底部条；两类布局都允许拖动，拖动后切换为 left/top 定位
// （base.css 移动端媒体查询已去掉 !important，以便内联样式生效）。
function twInstallDrag() {
  if (_tutorialWidgetDragInstalled) return;
  _tutorialWidgetDragInstalled = true;
  const widget = document.getElementById("tutorial-widget");
  const header = document.getElementById("tutorial-widget-header");
  if (!widget || !header) return;

  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  const vw = () => (window.innerWidth || document.documentElement.clientWidth || 0);
  const vh = () => (window.innerHeight || document.documentElement.clientHeight || 0);
  // 仅移动端有固定顶栏/底栏：教程卡片拖动范围需夹在二者之间，避免被遮挡。
  // 桌面端（无遮挡固定条）返回 0，保持原行为不变。
  const isMobile = () => (typeof window.matchMedia === "function") && window.matchMedia("(max-width: 820px)").matches;
  const topbarEl = document.querySelector(".topbar");
  const bottomNavEl = document.querySelector(".tp-bottom-nav");
  const safeTop = () => (isMobile() && topbarEl) ? Math.ceil(topbarEl.getBoundingClientRect().height) : 0;
  const safeBottom = () => (isMobile() && bottomNavEl) ? Math.ceil(bottomNavEl.getBoundingClientRect().height) : 0;

  // 把当前 CSS 锚定（right/bottom 或 left/right 全宽）折算为 left/top 浮动定位，并固化宽度
  // （移动端 width:auto 需锁成具体 px，否则只设 left 会让卡片坍缩到内容宽）。
  const pinToFloating = (left, top) => {
    const w0 = widget.offsetWidth || 280;
    const lockedW = clamp(w0, 140, Math.max(140, vw() - 16));
    widget.style.right = "auto";
    widget.style.bottom = "auto";
    widget.style.width = lockedW + "px";
    widget.style.left = clamp(left, 0, Math.max(0, vw() - lockedW)) + "px";
    widget.style.top = clamp(top, safeTop(), Math.max(safeTop(), vh() - widget.offsetHeight - safeBottom())) + "px";
  };

  // 还原已保存位置（桌面/移动通用）：clamp 到当前视口，避免跨设备/旋转后跑出屏幕。
  try {
    const saved = JSON.parse((typeof localStorage !== "undefined" ? localStorage.getItem(TUTORIAL_WIDGET_POS_KEY) : null) || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      pinToFloating(saved.left, saved.top);
    }
  } catch (e) { /* 忽略损坏的存档 */ }

  let pointerActive = false, panelDragMode = false, scrollMode = false, pointerCaptured = false;
  let startX = 0, startY = 0, lastY = 0, originLeft = 0, originTop = 0, moved = false;
  let startTarget = null;
  let dragStartTab = null;        // 起拖所在的具体 .tw-tab 元素，用于限定 click 抑制范围
  let clickGuardHandler = null;   // 当前活动的「拖拽后 click 拦截」监听
  let clickGuardTimer = null;     // 超时自动清理定时器
  const bodyEl = widget.querySelector(".tw-body");
  const removeClickGuard = () => {
    if (clickGuardTimer) { clearTimeout(clickGuardTimer); clickGuardTimer = null; }
    if (clickGuardHandler) { document.removeEventListener("click", clickGuardHandler, true); clickGuardHandler = null; }
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;            // 仅主键 / 触摸
    if (e.target && e.target.closest && e.target.closest("#tutorial-widget-toggle")) return; // 收起按钮不触发
    if (e.target && e.target.closest && e.target.closest(".tw-btn")) return; // 任务按钮不触发
    // 仅记录起点与候选手势状态；禁止在 down 阶段 pin/捕获/写位置/加 tw-dragging。
    // 单击、标签切换、正文滚动都不得移动面板或写 TUTORIAL_WIDGET_POS_KEY。
    removeClickGuard();             // 新一次按下先撤销任何残留的 click 守卫，避免误吞后续点击
    const rect = widget.getBoundingClientRect();
    pointerActive = true;
    panelDragMode = false;
    scrollMode = false;
    pointerCaptured = false;
    moved = false;
    startX = e.clientX; startY = e.clientY; lastY = e.clientY;
    originLeft = rect.left; originTop = rect.top;
    startTarget = e.target;
    dragStartTab = (startTarget && startTarget.closest) ? startTarget.closest(".tw-tab") : null;
  };

  const onMove = (e) => {
    if (!pointerActive) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;     // 超过 4px 阈值后才判定手势意图
    if (!moved) {
      moved = true;
      // 首次明显移动：起点在可滚动 .tw-body 且竖向为主 → 仅滚正文；其余（标题/标签/横向/列表不溢出）→ 拖动面板
      const onTabs = startTarget && startTarget.closest && startTarget.closest(".tw-tabs");
      const onBody = !onTabs && startTarget && startTarget.closest && startTarget.closest(".tw-body");
      const bodyScrollable = bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight + 1;
      if (onBody && bodyScrollable && Math.abs(dy) > Math.abs(dx)) {
        scrollMode = true;
      } else {
        panelDragMode = true;
        // 仅确认 panelDragMode 后才 pin/捕获/加拖动态/更新 left/top
        const rect = widget.getBoundingClientRect();
        if (widget.style.right !== "auto" || widget.style.bottom !== "auto" || widget.style.left === "") {
          pinToFloating(rect.left, rect.top);                       // CSS 锚点 → left/top 折算并锁宽
        }
        originLeft = parseFloat(widget.style.left) || rect.left;
        originTop = parseFloat(widget.style.top) || rect.top;
        widget.classList.add("tw-dragging");
        if (widget.setPointerCapture && e.pointerId !== undefined) { try { widget.setPointerCapture(e.pointerId); pointerCaptured = true; } catch (_) {} }
      }
      e.preventDefault();                                           // 已确认手势，阻止浏览器原生滚动/选择
    }
    if (scrollMode) {
      const delta = lastY - e.clientY;                              // 手指上移 → 列表上滚
      if (bodyEl) bodyEl.scrollTop += delta;
      lastY = e.clientY;
      return;                                                       // 不改动面板 left/top/width，不保存位置
    }
    if (panelDragMode) {
      const w = widget.offsetWidth, h = widget.offsetHeight;
      const left = clamp(originLeft + dx, 0, Math.max(0, vw() - w));
      const top = clamp(originTop + dy, safeTop(), Math.max(safeTop(), vh() - h - safeBottom()));
      widget.style.left = left + "px";
      widget.style.top = top + "px";
    }
  };

  // 统一收尾：isCancel=true 表示 pointercancel（只清理状态/释放捕获，不安装 click 守卫）；
  // isCancel=false 表示 pointerup（可安装「拖拽后 click 抑制」）。
  const finishPointer = (e, isCancel) => {
    if (!pointerActive) return;
    pointerActive = false;
    const wasPanelDrag = panelDragMode;
    widget.classList.remove("tw-dragging");
    // 释放指针捕获前先判断确实捕获过
    if (pointerCaptured) {
      if (widget.releasePointerCapture && e.pointerId !== undefined) { try { widget.releasePointerCapture(e.pointerId); } catch (_) {} }
      pointerCaptured = false;
    }
    // 仅 pointerup 的真实面板拖动才持久化；pointercancel/单击/标签切换/正文滚动一律不写位置
    if (!isCancel && wasPanelDrag) {
      try {
        const left = parseFloat(widget.style.left), top = parseFloat(widget.style.top);
        if (Number.isFinite(left) && Number.isFinite(top)) localStorage.setItem(TUTORIAL_WIDGET_POS_KEY, JSON.stringify({ left, top }));
      } catch (e2) { /* 忽略隐私模式写入失败 */ }
    }
    // 仅 pointerup + 从标签起拖 + 确属面板拖动时，才安装 click 抑制：
    // 限定为「同一 .tw-tab 内部」的 click，避免吞掉其他按钮或页面点击；超时 100ms 自动清理，绝不残留。
    if (!isCancel && wasPanelDrag && dragStartTab) {
      const tab = dragStartTab;
      clickGuardHandler = (ev) => {
        const t = ev.target;
        if (t && t.closest && tab.contains(t)) { ev.stopPropagation(); ev.preventDefault(); }
        removeClickGuard();
      };
      document.addEventListener("click", clickGuardHandler, true);
      clickGuardTimer = setTimeout(() => { removeClickGuard(); }, 100);
    }
    panelDragMode = false;
    scrollMode = false;
    startTarget = null;
    dragStartTab = null;
  };

  const onUp = (e) => finishPointer(e, false);
  const onCancel = (e) => finishPointer(e, true);

  widget.addEventListener("pointerdown", onDown);
  widget.addEventListener("pointermove", onMove);
  widget.addEventListener("pointerup", onUp);
  widget.addEventListener("pointercancel", onCancel);
}

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

function twIsOnTargetPage(target, subtab) {
  if (twResolveTargetKind(target) === "skill") return (currentPage === "skill" && currentView === target);
  if (currentPage !== target) return false;
  // 仓库子标签导航：指定 subtab 时，必须当前 cargoFilter 与之匹配才算「已在目标页」。
  // 这样玩家停留在仓库「全部/装备」等标签时，「前往执行」按钮仍可见，可引导至目标子标签。
  if (target === "cargo" && subtab) {
    const cur = (typeof cargoFilter !== "undefined") ? cargoFilter : null;
    return cur === subtab;
  }
  return true;
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
    // display 为 null 的两种情形：① 启动早期 TutorialSystem 尚未挂到 window/globalThis；
    // ② gameState.tutorial 尚未就绪（存档异步加载 / 对账未完成）。此时 #tutorial-widget 在 index.html
    // 中默认可见（无 hidden 属性），若仅清空内部内容后提前返回会留下「空壳」卡片（仅标题与收起按钮），
    // 与「全部完成后仍跳出来、切页后消失」的反馈吻合。统一改为隐藏，待下次有效渲染（如切页 / 系统就绪）
    // 再据 display.allCompleted 判定显隐，从根源消除空壳闪现。
    twSet(progressEl, ""); twSet(tabsEl, ""); twSet(dialogueEl, ""); twSet(objectiveEl, ""); twSet(actionsEl, "");
    if (widget) widget.hidden = true;
    return;
  }

  // 全部任务完成后自动隐藏新手引导卡：常驻会遮挡操作且无后续动作（此前卡片一直保留，被反馈为 bug）。
  // 若后续版本加入新任务使 allCompleted 重新变 false，卡片会随渲染自动重现。
  if (widget) widget.hidden = Boolean(display.allCompleted);
  if (display.allCompleted) return;

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

  // 收起态 mini 标签：仅显示「· 已完成 N/M」（展开态由 .tw-progress 完整区呈现）
  const miniEl = document.getElementById("tutorial-widget-mini");
  if (miniEl) miniEl.innerHTML = " · 已完成 <span class=\"tw-mini-num\">" + display.completedCount + "/" + display.totalCount + "</span>";

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
    // 导航按钮：有 navigationTarget（可选 navigationSubtab）且当前不在目标页/子标签时显示「前往执行」
    if (task.navigationTarget && !twIsOnTargetPage(task.navigationTarget, task.navigationSubtab)) {
      const subAttr = task.navigationSubtab ? ' data-nav-sub="' + twEsc(task.navigationSubtab) + '"' : '';
      actHtml += '<button type="button" class="tw-btn tw-btn-secondary" data-act="nav" data-nav="' + twEsc(task.navigationTarget) + '"' + subAttr + '>前往执行</button>';
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
  // 启动落定后重渲：SaveManager.bootstrap() 是异步的（本地读档仅同步探测，真正把存档
  // Object.assign 进 gameState 发生在 _applySelectedEnvelope，晚于 render.js 的首帧渲染）。
  // 因此首帧 renderTutorialWidget 读到的是「默认未加载」的 gameState → 全任务 locked →
  // allCompleted=false → 卡片误显且此后无自动重渲（tick 不调用 updateUI），只能手动收起。
  // 监听 bootstatechange，在存档落定（ready / local-only / error）后立刻用加载态重渲，
  // 让「全已完成」的玩家卡片正确隐藏，消除刷新误弹。
  const _bsTarget = (typeof window !== "undefined") ? window
    : (typeof globalThis !== "undefined" ? globalThis : null);
  if (_bsTarget && typeof _bsTarget.addEventListener === "function") {
    _bsTarget.addEventListener("bootstatechange", function (e) {
      const st = e && e.detail && e.detail.state;
      if (st === "ready" || st === "local-only" || st === "error") {
        try { renderTutorialWidget(); } catch (err) { /* 启动期重渲失败不得中断流程 */ }
      }
    });
  }
  const GE = (typeof GameEvents !== "undefined" && GameEvents) || (typeof window !== "undefined" && window.GameEvents) || (typeof globalThis !== "undefined" && globalThis.GameEvents) || null;
  if (GE && typeof GE.on === "function") {
    // 仅监听 5 个具体事件，绝不监听 "*" 通配；监听器只安装一次
    GE.on("tutorial:taskCompleted", twOnTaskCompleted);
    GE.on("tutorial:rewardClaimed", twOnRewardClaimed);
    GE.on("tutorial:branchesUnlocked", twOnBranchesUnlocked);
    GE.on("tutorial:combatTrackSelected", twOnCombatTrackSelected);
    GE.on("tutorial:emergencyShipGranted", twOnEmergencyShipGranted);
    // 在线战斗每清一波即刷新任务卡，让 C6 进度从 0/4 实时跳到 1/4…
    GE.on("combat:waveCleared", () => { if (typeof twRenderSoon === "function") twRenderSoon(); });
  }
  const toggleEl = document.getElementById("tutorial-widget-toggle");
  if (toggleEl) toggleEl.addEventListener("click", () => {
    _tutorialWidgetCollapsed = !_tutorialWidgetCollapsed;
    renderTutorialWidget();
  });
  twInstallDrag();
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
    else if (act === "nav") { twGoToTarget(btn.getAttribute("data-nav")); const sub = btn.getAttribute("data-nav-sub"); if (sub) renderCargoPage(sub); }
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
  const headerCargoItem = document.querySelector(".topbar .resources .res-item.cargo-item");
  if (headerCargoItem) headerCargoItem.addEventListener("click", () => switchPage("cargo"));
  const blueprintTabs = document.getElementById("blueprintstore-tabs"); if (blueprintTabs) blueprintTabs.addEventListener("click", event => {
    const button = event.target.closest("[data-blueprint-category]"); if (!button) return;
    blueprintStoreCategory = button.dataset.blueprintCategory; renderBlueprintStore();
  });
  const blueprintGrid = document.getElementById("blueprintstore-grid"); if (blueprintGrid) blueprintGrid.addEventListener("click", event => {
    const button = event.target.closest("[data-blueprint-item]");
    if (button && !button.disabled) buyBlueprintStoreItem(button.dataset.blueprintItem, button.dataset.blueprintKind);
  });
  const hangar = document.getElementById("hangar-ship-grid"); if (hangar) hangar.addEventListener("click", event => {
    const dismantleBtn = event.target.closest("[data-dismantle-ship]");
    if (dismantleBtn) { dismantleShipFromHangar(dismantleBtn.dataset.dismantleShip); return; }
    const enhance = event.target.closest("[data-enhance-ship]");
    if (enhance) { enhanceShipFromHangar(enhance.dataset.enhanceShip); return; }
    const assignment = event.target.closest("[data-ship-action]");
    if (assignment) {
      const result = dispatchGameAction(gameState, { type:"hangar/toggleAssignment", instanceId:assignment.dataset.sid, actionKey:assignment.dataset.shipAction }, Date.now());
      if (!result.changed && result.reason === "repairing") showToast("舰船自动维修中，暂时不能更换战斗舰");
      else       if (!result.changed && result.reason === "unsupported-mining") showToast("该舰船没有采矿岗位");
      else if (!result.changed && result.reason === "unsupported-gas") showToast("该舰船没有采气岗位");
      else if (!result.changed && result.reason === "unsupported-archaeology") showToast("该舰船没有考古扫描能力");
      else if (!result.changed && result.reason === "unsupported-refining") showToast("只有工业支援舰可以承担冶炼岗位");
      else if (!result.changed && result.reason === "unsupported-task") showToast("该任务不需要分配舰船岗位");
      else if (!result.changed && result.reason === "ship-active") showToast("舰船正在执行任务，停止当前任务后才能重新分配");
      if (result.changed) { renderHangarPanel(); renderCombatPanel(); }
      return;
    }
    const fitting = event.target.closest("[data-open-fitting]"); if (fitting) openEquipOrbit(fitting.dataset.openFitting);
  });
  const enhPanel = document.getElementById("equipment-enhancement-list"); if (enhPanel) {
    enhPanel.addEventListener("click", event => {
      const filterBtn = event.target.closest("[data-equip-filter]");
      if (filterBtn) {
        equipEnhanceFilter = filterBtn.dataset.equipFilter;
        enhPanel.querySelectorAll(".eem-filter").forEach(b => b.classList.toggle("active", b.dataset.equipFilter === equipEnhanceFilter));
        renderEquipEnhanceGrid();
        return;
      }
      const cell = event.target.closest("[data-equip-cell]");
      if (cell) {
        const [itemId, level] = decodeURIComponent(cell.dataset.equipCell).split("|");
        openEquipEnhanceModal(itemId, Number(level));
      }
    });
    enhPanel.addEventListener("input", event => {
      if (event.target.matches("[data-equip-search]")) { equipEnhanceSearch = event.target.value; renderEquipEnhanceGrid(); }
    });
  }
  const fittingOptions = document.getElementById("equipSelectOptions"); if (fittingOptions) fittingOptions.addEventListener("click", event => {
    const option = event.target.closest("[data-equip],[data-rig-destroy]"); if (!option || orbitSelectedIndex === null) return;
    const display = getShipFittingDisplayState(gameState, orbitShipId); const slot = display && display.orbitSlots.find(item => item.index === orbitSelectedIndex); if (!slot) return;
    let result;
    if (slot.type === "rig") {
      // 改装件槽：销毁 / 替换 / 安装均走专属 Action（事件契约 rig:destroyed / rig:replaced / rig:fitted）
      const finishRigOp = () => {
        const panel = document.getElementById("equipSelectPanel"); if (panel) panel.classList.remove("active");
        buildOrbit(); updateOrbitLibrary(); updateOrbitStats(); renderHangarPanel();
      };
      if (option.dataset.rigDestroy) {
        showDangerConfirm("⚠ 销毁改装件",
          "<p class=\"dlg-body\">确定销毁「" + (slot.name || "该改装件") + "」吗？<br><br>⚠ 改装件拆卸即销毁，不会返还仓库，此操作不可撤销！</p>",
          "确认销毁",
          () => { handleRigFitResult(dispatchGameAction(gameState, { type:"hangar/destroyFittedRig", instanceId:orbitShipId, slotIndex:slot.slotIndex }, Date.now())); finishRigOp(); });
        return;
      } else if (slot.equipmentId) {
        const newName = (EQUIPMENT_DB[option.dataset.equip] || {}).name || option.dataset.equip;
        showDangerConfirm("⚠ 替换改装件",
          "<p class=\"dlg-body\">确定用「" + newName + "」替换「" + (slot.name || "当前改装件") + "」吗？<br><br>⚠ 被替换的旧改装件将被销毁，不会返还仓库，此操作不可撤销！</p>",
          "确认替换",
          () => { handleRigFitResult(dispatchGameAction(gameState, { type:"hangar/replaceFittedRig", instanceId:orbitShipId, slotIndex:slot.slotIndex, rigItemId:option.dataset.equip }, Date.now())); finishRigOp(); });
        return;
      } else {
        // 新安装：同系列已装配则弹谐振提示（显示实际效果量），确认后再装
        const newRigId = option.dataset.equip;
        const newDef = EQUIPMENT_DB[newRigId];
        const inst = getShipInstanceFromState(gameState, orbitShipId);
        const preview = (newDef && newDef.slot === "rig" && inst) ? getRigResonancePreview(gameState, inst, newRigId) : null;
        const doInstall = () => { handleRigFitResult(dispatchGameAction(gameState, { type:"hangar/fitRig", instanceId:orbitShipId, slotIndex:slot.slotIndex, rigItemId:newRigId }, Date.now())); finishRigOp(); };
        if (preview && preview.existingCount > 0) {
          showRigResonanceModal(preview, newDef, doInstall);
        } else {
          doInstall();
        }
        return;
      }
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
    const display = getShipFittingDisplayState(gameState, orbitShipId); if (!display) return;
    const fittedRigNames = display.orbitSlots.filter(slot => slot.type === "rig" && slot.equipmentId).map(slot => slot.name || slot.equipmentId);
    let body = "<p class=\"dlg-body\">确定清空所有装备吗？<br><br>普通装备将返还仓库（保留为未安装实例）。</p>";
    if (fittedRigNames.length) {
      const counts = new Map();
      for (const name of fittedRigNames) counts.set(name, (counts.get(name) || 0) + 1);
      const lines = [...counts.entries()].map(([name, count]) => "· " + name + (count > 1 ? " ×" + count : ""));
      body += "<p class=\"dlg-body dlg-warn\">⚠ 以下改装件将被永久销毁（不返还）：<br>" + lines.join("<br>") + "</p>";
    }
    showDangerConfirm("⚠ 清空所有装备", body, "确认清空", () => {
      const result = dispatchGameAction(gameState, { type:"hangar/resetFitting", instanceId:orbitShipId }, Date.now());
      if (result.changed) { buildOrbit(); updateOrbitLibrary(); updateOrbitStats(); renderHangarPanel(); }
    });
  });
  const queueList = document.getElementById("queue-list"); if (queueList) queueList.addEventListener("click", event => {
    const button = event.target.closest("[data-queue-action]"); if (!button) return;
    const index = Number(button.dataset.index), action = button.dataset.queueAction;
    if (action === "remove") removeFromQueue(index); else if (action === "up") moveQueueItem(index, index - 1); else if (action === "down") moveQueueItem(index, index + 1); else if (action === "top") moveQueueItemToTop(index);
    renderQueuePanel();
  });
  const startQueueButton = document.getElementById("btn-start-queue"); if (startQueueButton) startQueueButton.addEventListener("click", () => { if (startQueue()) { currentView = gameState.currentAction.skill; renderQueuePanel(); updateUI(); } });
  const stopQueueButton = document.getElementById("btn-stop-queue"); if (stopQueueButton) stopQueueButton.addEventListener("click", () => { stopQueue(); renderQueuePanel(); updateUI(); });
  const clearQueueButton = document.getElementById("btn-clear-queue"); if (clearQueueButton) clearQueueButton.addEventListener("click", () => {
    showDangerConfirm("⚠ 清空队列",
      "<p class=\"dlg-body\">确定清空队列？已排队的生产作业将被移除。</p>",
      "确认清空",
      () => { clearQueue(); renderQueuePanel(); });
  });
  const loop = document.getElementById("queue-loop-check"); if (loop) loop.addEventListener("change", () => dispatchGameAction(gameState, { type:"queue/setLoop", enabled:loop.checked }, Date.now()));
  const enhancementConfirm = document.getElementById("setting-enhancement-confirm"); if (enhancementConfirm) enhancementConfirm.addEventListener("change", () => {
    const result = dispatchGameAction(gameState, { type:"settings/setShipEnhancementConfirmation", enabled:enhancementConfirm.checked }, Date.now());
    if (result.changed) { renderSettingsPage(); showToast(result.enabled ? "舰船强化确认提示已开启" : "舰船强化确认提示已关闭"); }
  });
  const discardConfirm = document.getElementById("setting-discard-confirm"); if (discardConfirm) discardConfirm.addEventListener("change", () => {
    const result = dispatchGameAction(gameState, { type:"settings/setDiscardConfirmation", enabled:discardConfirm.checked }, Date.now());
    if (result.changed) showToast(result.enabled ? "物品丢弃确认已开启" : "物品丢弃确认已关闭");
  });
  const dismantleConfirm = document.getElementById("setting-dismantle-confirm"); if (dismantleConfirm) dismantleConfirm.addEventListener("change", () => {
    const result = dispatchGameAction(gameState, { type:"settings/setDismantleConfirmation", enabled:dismantleConfirm.checked }, Date.now());
    if (result.changed) showToast(result.enabled ? "装备拆解确认已开启" : "装备拆解确认已关闭");
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
