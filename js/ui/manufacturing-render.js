/* ================================================================
   制造系统原生DOM适配器
   ================================================================ */

let equipEngSearchTerm = "";

onActionProgressReset(({ skill, shipSubAction }) => {
  let prefix = "";
  if (skill === "equipmentEngineering") prefix = "equipeng";
  else if (skill === "shipEngineering") prefix = shipSubAction === "assembly" ? "shipasm" : "shipcomp";
  if (!prefix) return;
  const row = document.getElementById(prefix + "-progress-row"); if (row) row.style.display = "none";
  drawSkillBar(document.getElementById("bar-" + prefix), 0, "purple");
  const eta = document.getElementById(prefix + "-eta"); if (eta) eta.textContent = "0s";
});

function renderShipEngSubViewTabs(display) {
  const el = document.getElementById("shipeng-subview-tabs"); if (!el) return;
  const tabs = [{ id:"component", name:"🔩 部件车间" }, { id:"assembly", name:"⚓ 舰船总装" }];
  el.innerHTML = tabs.map(tab => `<button class="shipeng-subview-tab${tab.id === display.subView ? " active" : ""}" data-subview="${tab.id}" role="tab" aria-selected="${tab.id === display.subView}">${tab.name}</button>`).join("");
}

function renderShipCompClassTabs(display) {
  const el = document.getElementById("shipeng-comp-class-tabs"); if (!el) return;
  el.innerHTML = display.componentClassTabs.map(item => `<button class="shipeng-class-tab${item.selected ? " active" : ""}" data-compclass="${item.id}">${item.name}</button>`).join("");
}

function renderShipCompGrid(display) {
  const el = document.getElementById("shipeng-comp-grid"); if (!el) return;
  if (!display.componentGrid.length) { el.innerHTML = '<div class="shipeng-empty">该分类暂无部件</div>'; return; }
  el.innerHTML = display.componentGrid.map(recipe => `
    <button class="shipeng-comp-card${recipe.selected ? " selected" : ""}${recipe.unlocked ? "" : " locked"}" data-comp="${recipe.id}">
      <span class="sec-top"><span>${recipe.requiredLevel} 级</span><span class="${recipe.unlocked ? "can-build" : "level-locked"}">${recipe.unlocked ? "可制造" : "Lv." + recipe.requiredLevel + " 解锁"}</span></span>
      <strong>${recipe.name}</strong>
      <span class="sec-cost">${recipe.cost.map(item => `<span class="${item.enough ? "enough" : "short"}">${getResourceDisplayName(item.material)}×${item.quantity}</span>`).join(" ")}</span>
      <span class="sec-bottom"><span>${recipe.time}s · ${recipe.xp} XP</span><span>库存 ${recipe.owned}</span></span>
    </button>`).join("");
}

function renderShipCompDetail(display) {
  renderShipCompCost(display);
  renderShipCompInventory(display);
  const btn = document.getElementById("btn-start-shipcomp");
  if (btn) {
    if (display.canStartComponent) { btn.textContent = "⚙ 制造 " + display.currentComponent.name; }
    else { btn.textContent = "🔒 舰船工程 Lv." + display.currentComponent.requiredLevel + " 解锁"; }
    btn.disabled = !display.canStartComponent;
  }
}

function renderShipCompCost(display) {
  display = display || getShipEngineeringDisplayState(gameState, Date.now());
  const element = document.getElementById("shipcomp-cost");
  if (!element) return;
  const parts = display.componentMaterials.map(item => `<span class="${item.enough ? "enough" : "short"}">${getResourceDisplayName(item.material)}×${item.quantity}</span>`);
  element.innerHTML = "消耗：" + parts.join(" + ") + ` · 耗时${display.currentComponent.time}s · 经验${display.currentComponent.xp}`;
}

function renderShipCompInventory(display) {
  display = display || getShipEngineeringDisplayState(gameState, Date.now());
  const grid = document.getElementById("ship-comp-inventory");
  if (!grid) return;
  grid.innerHTML = display.componentInventory.map(item => `<div class="ship-comp-item"><span class="sci-name">${item.name}</span><span class="sci-qty${item.quantity === 0 ? " zero" : ""}">×${item.quantity}</span></div>`).join("");
}

function renderShipAsmLineTabs(display) {
  const el = document.getElementById("shipeng-asm-line-tabs"); if (!el) return;
  el.innerHTML = display.assemblyLineTabs.map(item => `<button class="shipeng-class-tab${item.selected ? " active" : ""}" data-asmline="${item.id}">${item.name}</button>`).join("");
}

function renderShipAsmGrid(display) {
  const el = document.getElementById("shipeng-asm-grid"); if (!el) return;
  if (!display.assemblyGrid.length) { el.innerHTML = '<div class="shipeng-empty">该系列暂无舰船</div>'; return; }
  el.innerHTML = display.assemblyGrid.map(recipe => {
    const locked = !recipe.unlocked;
    const status = locked ? ("🔒 " + (!recipe.hasRequiredBlueprint ? "需蓝图" : "Lv." + recipe.requiredLevel + " 解锁")) : "可建造";
    const statusCls = locked ? ("lock-tag" + (!recipe.hasRequiredBlueprint ? "" : " lvl")) : "can-build";
    const hybridBadge = recipe.hybrid ? '<span class="sec-hybrid">混血</span>' : "";
    return `
    <button class="shipeng-asm-card${recipe.selected ? " selected" : ""}${locked ? " locked" : ""}" data-ship="${recipe.id}">
      ${locked ? '<span class="lock-badge">🔒</span>' : ""}
      <span class="sec-top"><span>${recipe.role}</span>${hybridBadge}</span>
      <strong>${recipe.name}</strong>
      <span class="sec-bottom"><span>${recipe.requiredLevel} 级 · ${recipe.time}s</span><span class="${statusCls}">${status}</span></span>
    </button>`;
  }).join("");
}

function renderShipAsmDetail(display) {
  const wrap = document.getElementById("shipeng-asm-detail"); if (!wrap) return;
  renderShipAttributes(display.selectedShip);
  mountManufacturing3D(display);
  renderShipAsmCost(display);
  const flavorEl = document.getElementById("shipeng-asm-flavor");
  if (flavorEl) flavorEl.textContent = display.shipFlavor || "";
  const badges = document.getElementById("shipeng-asm-badges");
  if (badges) {
    const roleBadge = display.selectedShip ? `<span class="badge">${display.shipRole}</span><span class="badge">舰船工程 Lv.${display.currentAssembly.requiredLevel}+</span>` : "";
    const hybridBadge = display.hybridSelected ? '<span class="badge hybrid">混血</span>' : "";
    badges.innerHTML = roleBadge + hybridBadge;
  }
  const btn = document.getElementById("btn-start-shipasm");
  if (btn) {
    if (display.canStartAssembly) { btn.textContent = "⚓ 合成 " + display.currentAssembly.name; }
    else {
      const shipId = display.currentAssembly.shipId;
      const hasBp = (gameState.ownedBlueprints || []).includes(shipId);
      btn.textContent = hasBp ? ("🔒 舰船工程 Lv." + display.currentAssembly.requiredLevel + " 解锁") : "🔒 需蓝图解锁";
    }
    btn.disabled = !display.canStartAssembly;
  }
  // 锁定舰船：详情顶部显眼「未解锁」横幅（与装备/增强剂一致）
  let asmBanner = "";
  if (!display.canStartAssembly && display.currentAssembly) {
    const hasBp = (gameState.ownedBlueprints || []).includes(display.currentAssembly.shipId);
    asmBanner = '<div class="lock-banner"><span class="lb-icon">🔒</span><span>' + (hasBp ? ("未解锁：舰船工程 Lv." + display.currentAssembly.requiredLevel + " 解锁") : "未解锁：需蓝图解锁") + '</span></div>';
  }
  const existingBanner = wrap.querySelector(".lock-banner");
  if (existingBanner) existingBanner.remove();
  if (asmBanner) wrap.insertAdjacentHTML("afterbegin", asmBanner);
}

function renderShipAsmPager(display) {
  const el = document.getElementById("shipeng-asm-pager"); if (!el) return;
  if (display.assemblyPageCount <= 1) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "";
  const prevDisabled = display.assemblyPage <= 0 ? "disabled" : "";
  const nextDisabled = display.assemblyPage >= display.assemblyPageCount - 1 ? "disabled" : "";
  el.innerHTML = `<button class="shipeng-pager-btn" data-asm-page="prev" ${prevDisabled}>‹ 上一页</button>
    <span class="shipeng-pager-info">第 ${display.assemblyPage + 1} / ${display.assemblyPageCount} 页 · 共 ${display.assemblyTotal} 艘</span>
    <button class="shipeng-pager-btn" data-asm-page="next" ${nextDisabled}>下一页 ›</button>`;
}

function renderShipAsmCost(display) {
  display = display || getShipEngineeringDisplayState(gameState, Date.now());
  const element = document.getElementById("shipasm-cost");
  if (!element) return;
  const parts = display.assemblyComponents.map(item => `<span class="${item.enough ? "enough" : "short"}">${item.name}×${item.quantity}</span>`).join(" + ");
  const materials = display.assemblyMaterials.map(item => `<span class="${item.enough ? "enough" : "short"}">${getResourceDisplayName(item.material)}×${item.quantity}</span>`).join(" + ");
  element.innerHTML = `部件：${parts}${materials ? ` · 额外材料：${materials}` : " · 组装不消耗额外材料"} · 耗时${display.currentAssembly.time}s · 经验${display.currentAssembly.xp}`;
}

function renderShipInventory(display) {
  display = display || getShipEngineeringDisplayState(gameState, Date.now());
  const element = document.getElementById("ship-inventory-list");
  if (!element) return;
  if (!display.ownedShips.length) { element.innerHTML = '<div style="font-size:11px;color:#4a5a6a;">暂无舰船</div>'; return; }
  element.innerHTML = display.ownedShips.map(ship => {
    const hp = ship.hp ? `${ship.hp.shield}/${ship.hp.armor}/${ship.hp.structure}` : "";
    return `<div class="ship-inv-item"><span class="si-name">${ship.name}</span><span class="si-qty">×${ship.quantity}</span><span class="si-hp">${hp ? "HP: " + hp : ""}</span></div>`;
  }).join("");
}

function renderShipAttributes(ship) {
  const element = document.getElementById("ship-attr-display");
  if (!element || !ship) return;
  const labels = { shieldCapacity:"护盾容量", laserDamage:"激光伤害", capacitorRecharge:"电容回充", armorCapacity:"装甲容量", missileDamage:"导弹伤害", targetingSpeed:"锁定速度", structureCapacity:"结构容量", cannonDamage:"炮台伤害", speed:"速度", armorRepair:"装甲维修", structureRepair:"结构维修", hitBonus:"命中", miningLaserEfficiency:"采矿器效能", gasLaserEfficiency:"采气器效能", fleetMiningSpeed:"舰队采矿速度", smeltingSpeed:"冶炼速度" };
  const bonuses = Object.entries(ship.bonuses).map(([key, value]) => {
    // 考古船加成为绝对扫描强度 / 固定失败反噬减免，不能统一按百分比显示。
    if (key === "archaeologyScanStrength") return "扫描强度 " + value;
    if (key === "archaeologyFailureDamageReduction") return "失败反噬减免 " + Math.round(value * 100) + "%（固定）";
    return (labels[key] || key) + " +" + (key === "hitBonus" ? value : Math.round(value * 100) + "%");
  }).join(" · ");
  const trait = ship.capitalTrait ? `<div class="ship-attr-bonus">固有特性：<span>${ship.capitalTrait.name} · ${ship.capitalTrait.description}</span></div>` : "";
  const fuelText = ship.fuelEfficiency !== undefined ? ` · 燃料效率${(ship.fuelEfficiency * 100).toFixed(0)}%` : "";
  element.innerHTML = `<div class="ship-attr-grid">
    <div class="ship-attr-item"><span class="sa-label">护盾</span><span class="sa-value">${ship.hp.shield}</span></div><div class="ship-attr-item"><span class="sa-label">装甲</span><span class="sa-value">${ship.hp.armor}</span></div>
    <div class="ship-attr-item"><span class="sa-label">结构</span><span class="sa-value">${ship.hp.structure}</span></div><div class="ship-attr-item"><span class="sa-label">总血量</span><span class="sa-value">${ship.totalHp}</span></div>
    <div class="ship-attr-item"><span class="sa-label">闪避</span><span class="sa-value">${ship.dodge}</span></div><div class="ship-attr-item"><span class="sa-label">速度</span><span class="sa-value">${ship.speed}</span></div>
    <div class="ship-attr-item"><span class="sa-label">锁定</span><span class="sa-value">${ship.targeting}</span></div><div class="ship-attr-item"><span class="sa-label">电容</span><span class="sa-value">${ship.capacitor.capacity}</span></div>
  </div><div class="ship-attr-bonus">加成：<span>${bonuses}</span></div>${trait}<div style="font-size:11px;color:#6a7a8e;margin-top:2px;">槽位：高${ship.slots.high} · 中${ship.slots.mid} · 低${ship.slots.low} · 改装${ship.slots.rig}${fuelText}</div>`;
}

/* ================================================================
   舰船工程 3D（可拖拽查看器）
   ================================================================ */
function mountManufacturing3D(display) {
  const S3D = window.Ship3D;
  if (!S3D) return;
  const canvas = document.getElementById("manufacturing-3d-canvas");
  if (!canvas) return;
  const ship = display && display.selectedShip;
  if (!ship || !ship.id) return;
  try {
    const spec = S3D.buildSpecForShip(ship.id);
    const viewer = S3D.ensureViewer(canvas, { orbit: true, autoSpin: true });
    S3D.setShips(viewer, [{ spec, position: [0, 0, 0], scale: 1, sway: false }]);
  } catch (err) { console.error("[manufacturing] 3D 渲染失败", err); }
}

function renderShipEngineeringPage(now) {
  const display = getShipEngineeringDisplayState(gameState, Number(now) || Date.now());
  const efficiency = document.getElementById("shipeng-eff-display"); if (efficiency) {
    efficiency.textContent = "效率：" + display.efficiency.toFixed(2) + "x";
    efficiency.title = getShipEngineeringSpeedBreakdownText(display);
  }
  const lvNum = document.getElementById("shipeng-lv-num"); if (lvNum) lvNum.textContent = display.level;
  const speedInfo = document.getElementById("shipeng-speed-breakdown");
  if (speedInfo) speedInfo.textContent = getShipEngineeringSpeedBreakdownText(display);
  const fill = document.getElementById("shipeng-exp-fill"); if (fill) fill.style.width = display.xpPercent + "%";
  const xp = document.getElementById("shipeng-exp-value"); if (xp) xp.textContent = display.xp.toLocaleString() + " / " + display.xpNeeded.toLocaleString();
  const status = document.getElementById("shipeng-header-status"); if (status) status.textContent = display.status;

  renderShipEngSubViewTabs(display);
  renderShipCompClassTabs(display);
  renderShipCompGrid(display);
  renderShipCompDetail(display);
  renderShipAsmLineTabs(display);
  renderShipAsmGrid(display);
  renderShipAsmDetail(display);
  renderShipAsmPager(display);
  renderShipInventory(display);

  const compView = document.getElementById("shipeng-comp-view"); if (compView) compView.style.display = display.subView === "component" ? "" : "none";
  const asmView = document.getElementById("shipeng-asm-view"); if (asmView) asmView.style.display = display.subView === "assembly" ? "" : "none";

  const componentRow = document.getElementById("shipcomp-progress-row"); if (componentRow) componentRow.style.display = display.componentActive ? "" : "none";
  const assemblyRow = document.getElementById("shipasm-progress-row"); if (assemblyRow) assemblyRow.style.display = display.assemblyActive ? "" : "none";
  drawSkillBar(document.getElementById("bar-shipcomp"), display.componentProgress.percent, "purple");
  drawSkillBar(document.getElementById("bar-shipasm"), display.assemblyProgress.percent, "purple");
  const componentEta = document.getElementById("shipcomp-eta"); if (componentEta) componentEta.textContent = display.componentProgress.etaText;
  const assemblyEta = document.getElementById("shipasm-eta"); if (assemblyEta) assemblyEta.textContent = display.assemblyProgress.etaText;
}

function getEquipEngOutputHtmlFromDisplay(display) {
  const recipe = display.selectedRecipe;
  if (recipe.output.type !== "equipment") return display.detail.outputText;
  const equipment = EQUIPMENT_DB[recipe.output.itemId];
  const attributes = equipment ? getEquipmentAttributeText(equipment, "\n") : "";
  const slotName = { high:"高槽", mid:"中槽", low:"低槽", rig:"改装件" }[recipe.slot] || "装备";
  return `产出：<span class="equip-output-name" title="${attributes}">${recipe.name}</span> ×${recipe.output.qty}（${slotName}）`;
}

function renderEquipEngTabs(display) {
  const tabs = document.getElementById("equipeng-category-tabs"); if (!tabs) return;
  tabs.innerHTML = display.categories.map(category => `<button class="equipeng-category-tab${category.selected ? " active" : ""}" data-category="${category.id}" role="tab" aria-selected="${category.selected}"><i class="${category.icon}"></i><span>${category.name}</span></button>`).join("");
}

function renderEquipEngRigFilters(display) {
  const container = document.getElementById("equipeng-rig-filters"); if (!container) return;
  if (!display.rigFilters) { container.style.display = "none"; container.innerHTML = ""; return; }
  container.style.display = "flex"; // flex-wrap:wrap（见 index.html 内联样式），窄窗口自动换行不遮挡
  const button = (item) => `<button class="equipeng-rig-filter-btn${item.selected ? " selected" : ""}" data-rig-series="${item.id}" role="tab" aria-selected="${item.selected}" style="padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;border:1px solid ${item.selected ? "#38bdf8" : "#2a3a4a"};background:${item.selected ? "rgba(56,189,248,.15)" : "transparent"};color:${item.selected ? "#7dd3fc" : "#8a9aae"};">${item.name}</button>`;
  container.innerHTML =
    '<span style="font-size:12px;color:#6a7a8e;">系列</span>' + display.rigFilters.seriesList.map(item => button(item)).join("");
}

function renderEquipEngRecipeGrid(display) {
  const state = display || getEquipmentEngineeringDisplayState(gameState, Date.now(), equipEngSearchTerm);
  const grid = document.getElementById("equipeng-recipe-grid"); if (!grid) return;
  const title = document.getElementById("equipeng-category-title"); if (title) title.textContent = state.category.name;
  const count = document.getElementById("equipeng-category-count"); if (count) count.textContent = (typeof state.visibleCount === "number" ? state.visibleCount : state.recipes.length) + " 个配方";
  if (!state.recipes.length) { grid.innerHTML = '<div class="equipeng-empty">当前分类没有匹配的配方</div>'; return; }
  grid.innerHTML = state.recipes.map(recipe => {
    const locked = !recipe.unlocked;
    const statusCls = recipe.unlocked ? "can-build" : ("lock-tag" + (recipe.hasRequiredBlueprint ? " lvl" : ""));
    const statusTxt = recipe.unlocked ? "可制造" : ("🔒 " + (!recipe.hasRequiredBlueprint ? "需蓝图" : "Lv." + recipe.level + " 解锁"));
    return `<button class="equipeng-recipe-card${recipe.selected ? " selected" : ""}${locked ? " locked" : ""}" data-recipe="${recipe.id}">
    ${locked ? '<span class="lock-badge">🔒</span>' : ""}
    <span class="equipeng-card-top"><span>${recipe.tier} · ${recipe.slot}</span><span class="${statusCls}">${statusTxt}</span></span>
    <span class="equipeng-card-icon"><i class="${recipe.icon}"></i></span><strong>${recipe.name}</strong><span class="equipeng-card-attributes">${recipe.attributes}</span>
    <span class="equipeng-card-bottom"><span>${recipe.actualTime.toFixed(1)}s · ${recipe.xp} XP</span><span>库存 ${recipe.ownedCount.toLocaleString()}</span></span></button>`;
  }).join("");
}

function renderEquipEngDetail(display) {
  const title = document.getElementById("equipeng-detail-title"); if (title) title.textContent = display.detail.title;
  const tier = document.getElementById("equipeng-detail-tier"); if (tier) tier.textContent = display.detail.tier;
  const body = document.getElementById("equipeng-detail-body"); if (!body) return;
  const attributes = display.detail.attributes.length ? `<div class="equipeng-detail-section"><span class="equipeng-detail-label">装备属性</span><div class="equipeng-attribute-list">${display.detail.attributes.map(line => `<span>${line}</span>`).join("")}</div></div>` : "";
  const equipmentInputs = display.detail.equipmentInputs.map(item => `<div class="equipeng-material${item.enough ? " enough" : " short"}"><span><i class="fa-solid fa-box"></i>${item.name}</span><strong>×${item.quantity}</strong><small>未装配库存 ${item.stock.toLocaleString()}</small></div>`).join("");
  const materials = display.detail.materials.map(item => `<div class="equipeng-material${item.enough ? " enough" : " short"}"><span><i class="fa-solid fa-cubes-stacked"></i>${item.displayName || item.name || getResourceDisplayName(item.material)}</span><strong>×${item.quantity}</strong><small>库存 ${item.stock.toLocaleString()}</small></div>`).join("");
  const running = display.detail.runningNote ? `<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造：${display.detail.runningNote.name}${display.detail.runningNote.targetDiffers ? " · 点击「切换制造」将改为制造当前配方" : ""}</div>` : "";
  const selRecipe = display.selectedRecipe;
  const lockBanner = (selRecipe && !selRecipe.unlocked)
    ? `<div class="lock-banner"><span class="lb-icon">🔒</span><span>${selRecipe.hasRequiredBlueprint ? ("未解锁：装备工程 Lv." + selRecipe.level + " 解锁") : "未解锁：需蓝图解锁（考古掉落获取蓝图）"}</span></div>`
    : "";
  body.innerHTML = `${lockBanner}${running}${attributes}<div class="equipeng-detail-section"><span class="equipeng-detail-label">制造材料</span><div class="equipeng-material-list">${equipmentInputs}${materials}</div></div>
    <div class="equipeng-detail-section equipeng-manufacture-summary"><span>${getEquipEngOutputHtmlFromDisplay(display)}</span><span>单次耗时 ${display.detail.actualTime.toFixed(1)}s（基础 ${display.detail.baseTime}s）</span><span>装备工程经验 +${display.detail.xp}</span><span>按当前库存最多制造 ${display.detail.maxCycles.toLocaleString()} 次</span></div>`;
}

function renderEquipEngPage(now) {
  const display = getEquipmentEngineeringDisplayState(gameState, Number(now) || Date.now(), equipEngSearchTerm);
  const efficiency = document.getElementById("equipeng-eff-display");
  if (efficiency) {
    efficiency.textContent = "效率：" + display.efficiency.toFixed(2) + "x";
    const skillMult = (1 + display.level * 0.02);
    efficiency.title = "技能速度：1 × (1 + Lv." + display.level + " × 0.02) = " + skillMult.toFixed(2) + "x"
      + "\n空间站综合后勤：×" + (display.stationLogisticsMultiplier || 1).toFixed(2) + "（" + ((display.stationLogistics && display.stationLogistics.text) || "未建立") + "）"
      + "\n科研加成：×" + (display.researchMultiplier || 1).toFixed(3)
      + "\n最终效率：" + display.efficiency.toFixed(2) + "x";
  }
  const eqLog = document.getElementById("equipeng-logistics");
  if (eqLog) {
    const lm = display.stationLogisticsMultiplier || 1;
    eqLog.textContent = lm > 1 ? "后勤 ×" + lm.toFixed(2) + "（+" + Math.round((lm - 1) * 100) + "%）" : "后勤 ×" + lm.toFixed(2);
  }
  const level = document.getElementById("equipeng-lv-num"); if (level) level.textContent = display.level;
  const xp = document.getElementById("equipeng-exp-value"); if (xp) xp.textContent = Math.floor(display.xp).toLocaleString() + " / " + display.xpNeeded.toLocaleString();
  const fill = document.getElementById("equipeng-exp-fill"); if (fill) fill.style.width = display.xpPercent + "%";
  renderEquipEngTabs(display);
  renderEquipEngRigFilters(display);
  renderEquipEngRecipeGrid(display);
  renderEquipEngDetail(display);
  const search = document.getElementById("equipeng-search-input"); if (search && search.value !== equipEngSearchTerm) search.value = equipEngSearchTerm;
  const queue = document.getElementById("equipeng-queue-summary"); if (queue) queue.textContent = "制造队列 " + display.queue.count + " / " + display.queue.maxSize;
  const row = document.getElementById("equipeng-progress-row"); if (row) row.style.display = display.active ? "" : "none";
  drawSkillBar(document.getElementById("bar-equipeng"), display.progress.percent, "purple");
  const eta = document.getElementById("equipeng-eta"); if (eta) eta.textContent = display.progress.etaText;
  const status = document.getElementById("equipeng-status-text"); if (status) status.textContent = display.status;
  // 仿采矿范式：正在制造 A、当前选中 B（targetChanged）时，停止按钮隐藏、开始按钮显示
  // 且文案提示"切换制造"；选中==在跑时显示停止；完全未在跑时显示开始。
  const targetChanged = Boolean(display.active && display.runningRecipe && display.selectedRecipe && display.runningRecipe.id !== display.selectedRecipe.id);
  const showStart = !display.active || targetChanged;
  const showStop = display.active && !targetChanged;
  const start = document.getElementById("btn-start-equipeng");
  if (start) {
    start.style.display = showStart ? "" : "none";
    start.disabled = !display.canStart;
    // 未解锁也可选中预览；启动按钮按舰船总装逻辑显示锁定原因（蓝图 / 等级），不再只是置灰。
    if (!display.canStart) {
      start.textContent = !display.detail.hasRequiredBlueprint
        ? "🔒 需蓝图解锁"
        : ("🔒 装备工程 Lv." + (display.selectedRecipe ? display.selectedRecipe.level : display.detail.tier) + " 解锁");
    } else {
      start.textContent = targetChanged ? "▶ 切换制造" : "▶ 开始制造";
    }
  }
  const stop = document.getElementById("btn-stop-equipeng"); if (stop) stop.style.display = showStop ? "" : "none";
}

(function bindManufacturingUI() {
  const subviewTabs = document.getElementById("shipeng-subview-tabs");
  if (subviewTabs) subviewTabs.addEventListener("click", event => {
    const btn = event.target.closest("[data-subview]"); if (!btn) return;
    const result = dispatchGameAction(gameState, { type:"manufacturing/selectShipEngSubView", view:btn.dataset.subview }, Date.now());
    if (result.changed) renderShipEngineeringPage();
  });
  const compClassTabs = document.getElementById("shipeng-comp-class-tabs");
  if (compClassTabs) compClassTabs.addEventListener("click", event => {
    const btn = event.target.closest("[data-compclass]"); if (!btn) return;
    const result = dispatchGameAction(gameState, { type:"manufacturing/selectShipCompClass", cls:btn.dataset.compclass }, Date.now());
    if (result.changed) renderShipEngineeringPage();
  });
  const compGrid = document.getElementById("shipeng-comp-grid");
  if (compGrid) compGrid.addEventListener("click", event => {
    const btn = event.target.closest("[data-comp]"); if (!btn || btn.disabled) return;
    const result = switchShipCompTarget(btn.dataset.comp);
    if (result.changed) renderShipEngineeringPage();
  });
  const asmLineTabs = document.getElementById("shipeng-asm-line-tabs");
  if (asmLineTabs) asmLineTabs.addEventListener("click", event => {
    const btn = event.target.closest("[data-asmline]"); if (!btn) return;
    const result = dispatchGameAction(gameState, { type:"manufacturing/selectShipAsmLine", line:btn.dataset.asmline }, Date.now());
    if (result.changed) renderShipEngineeringPage();
  });
  const asmGrid = document.getElementById("shipeng-asm-grid");
  if (asmGrid) asmGrid.addEventListener("click", event => {
    const btn = event.target.closest("[data-ship]"); if (!btn || btn.disabled) return;
    const result = switchShipAsmTarget(btn.dataset.ship);
    if (result.changed) renderShipEngineeringPage();
  });
  const pager = document.getElementById("shipeng-asm-pager");
  if (pager) pager.addEventListener("click", event => {
    const btn = event.target.closest("[data-asm-page]"); if (!btn || btn.disabled) return;
    const current = gameState.currentAction.shipAsmPage || 0;
    const next = btn.dataset.asmPage === "prev" ? current - 1 : current + 1;
    const result = dispatchGameAction(gameState, { type:"manufacturing/selectShipAsmPage", page:next }, Date.now());
    if (result.changed) renderShipEngineeringPage();
  });
  const tabs = document.getElementById("equipeng-category-tabs");
  if (tabs) tabs.addEventListener("click", event => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const result = switchEquipEngCategory(button.dataset.category);
    if (result.changed) { equipEngSearchTerm = ""; renderEquipEngPage(); }
  });
  const grid = document.getElementById("equipeng-recipe-grid");
  if (grid) grid.addEventListener("click", event => {
    const card = event.target.closest("[data-recipe]");
    if (!card || card.disabled) return;
    const result = switchEquipEngTarget(card.dataset.recipe);
    if (result.changed) renderEquipEngPage();
  });
  const rigFilters = document.getElementById("equipeng-rig-filters");
  if (rigFilters) rigFilters.addEventListener("click", event => {
    const seriesButton = event.target.closest("[data-rig-series]");
    if (!seriesButton) return;
    const payload = { type:"manufacturing/selectEquipEngRigFilter", series: seriesButton.dataset.rigSeries };
    const result = dispatchGameAction(gameState, payload, Date.now());
    if (result.changed) renderEquipEngPage();
  });
  const search = document.getElementById("equipeng-search-input");
  if (search) search.addEventListener("input", () => {
    equipEngSearchTerm = search.value;
    // 搜索后详情自动落到第一个可见配方：将显示态选中项同步回 equipEngTarget
    // （selectEquipmentRecipe 不触碰 startedEquipEngTarget，制造中产物不变）
    const display = getEquipmentEngineeringDisplayState(gameState, Date.now(), equipEngSearchTerm);
    if (display.selectedRecipe && display.selectedRecipe.id !== gameState.currentAction.equipEngTarget) {
      dispatchGameAction(gameState, { type:"manufacturing/selectEquipmentRecipe", recipeId:display.selectedRecipe.id }, Date.now());
    }
    renderEquipEngPage();
  });
  const start = document.getElementById("btn-start-equipeng"); if (start) start.addEventListener("click", () => showActionConfirm("equipmentEngineering"));
  const stop = document.getElementById("btn-stop-equipeng"); if (stop) stop.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"manufacturing/stop" }, Date.now());
    if (result.changed) updateUI();
  });
})();
