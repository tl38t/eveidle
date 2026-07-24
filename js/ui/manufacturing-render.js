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

function renderShipCompDropdown(display) {
  const state = display || getShipEngineeringDisplayState(gameState, Date.now());
  const content = document.getElementById("shipcomp-dropdown-content");
  const button = document.getElementById("shipcomp-dropbtn");
  if (!content || !button) return;
  button.textContent = state.currentComponent.name + " ▾";
  content.innerHTML = state.componentOptions.map(recipe => {
    const className = (recipe.selected ? " selected" : "") + (recipe.unlocked ? "" : " locked");
    const requirement = recipe.unlocked ? "" : `<span class="area-req">需舰船工程 Lv.${recipe.level}</span>`;
    return `<div class="area-option${className}" data-comp="${recipe.id}">${recipe.name} — ${recipe.time}s / ${recipe.xp}XP${requirement}</div>`;
  }).join("");
  content.querySelectorAll(".area-option:not(.locked)").forEach(option => option.addEventListener("click", event => {
    event.stopPropagation();
    const result = switchShipCompTarget(option.dataset.comp);
    content.classList.remove("show");
    if (result.changed) renderShipEngineeringPage();
  }));
}

function renderShipCompCost(display) {
  display = display || getShipEngineeringDisplayState(gameState, Date.now());
  const element = document.getElementById("shipcomp-cost");
  if (!element) return;
  const parts = display.componentMaterials.map(item => `<span class="${item.enough ? "enough" : "short"}">${item.material}×${item.quantity}</span>`);
  element.innerHTML = "消耗：" + parts.join(" + ") + ` · 耗时${display.currentComponent.time}s · 经验${display.currentComponent.xp}`;
}

function renderShipCompInventory(display) {
  display = display || getShipEngineeringDisplayState(gameState, Date.now());
  const grid = document.getElementById("ship-comp-inventory");
  if (!grid) return;
  grid.innerHTML = display.componentInventory.map(item => `<div class="ship-comp-item"><span class="sci-name">${item.name}</span><span class="sci-qty${item.quantity === 0 ? " zero" : ""}">×${item.quantity}</span></div>`).join("");
}

function renderShipAsmDropdown(display) {
  const state = display || getShipEngineeringDisplayState(gameState, Date.now());
  const content = document.getElementById("shipasm-dropdown-content");
  const button = document.getElementById("shipasm-dropbtn");
  if (!content || !button) return;
  button.textContent = state.currentAssembly.name + " ▾";
  content.innerHTML = state.assemblyOptions.map(recipe => {
    const className = (recipe.selected ? " selected" : "") + (recipe.unlocked ? "" : " locked");
    let requirement = "";
    if (!recipe.hasRequiredBlueprint) requirement = '<span class="area-req">需先购买蓝图</span>';
    else if (state.level < recipe.level) requirement = `<span class="area-req">需舰船工程 Lv.${recipe.level}</span>`;
    return `<div class="area-option${className}" data-ship="${recipe.id}">${recipe.name}${requirement}</div>`;
  }).join("");
  content.querySelectorAll(".area-option:not(.locked)").forEach(option => option.addEventListener("click", event => {
    event.stopPropagation();
    const result = switchShipAsmTarget(option.dataset.ship);
    content.classList.remove("show");
    if (result.changed) renderShipEngineeringPage();
  }));
}

function renderShipAsmCost(display) {
  display = display || getShipEngineeringDisplayState(gameState, Date.now());
  const element = document.getElementById("shipasm-cost");
  if (!element) return;
  const parts = display.assemblyComponents.map(item => `<span class="${item.enough ? "enough" : "short"}">${item.name}×${item.quantity}</span>`).join(" + ");
  const materials = display.assemblyMaterials.map(item => `<span class="${item.enough ? "enough" : "short"}">${item.material}×${item.quantity}</span>`).join(" + ");
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

function renderShipEngineeringPage(now) {
  const display = getShipEngineeringDisplayState(gameState, Number(now) || Date.now());
  const efficiency = document.getElementById("shipeng-eff-value"); if (efficiency) efficiency.textContent = display.efficiency.toFixed(2) + "x";
  const fill = document.getElementById("shipeng-exp-fill"); if (fill) fill.style.width = display.xpPercent + "%";
  const xp = document.getElementById("shipeng-exp-value"); if (xp) xp.textContent = display.xp.toLocaleString() + " / " + display.xpNeeded.toLocaleString();
  const status = document.getElementById("shipeng-header-status"); if (status) status.textContent = display.status;
  renderShipCompDropdown(display);
  renderShipCompCost(display);
  renderShipCompInventory(display);
  renderShipAsmDropdown(display);
  renderShipAsmCost(display);
  renderShipInventory(display);
  renderShipAttributes(display.selectedShip);
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
  const button = (kind, item) => `<button class="equipeng-rig-filter-btn${item.selected ? " selected" : ""}" data-rig-${kind}="${item.id}" role="tab" aria-selected="${item.selected}" style="padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;border:1px solid ${item.selected ? "#38bdf8" : "#2a3a4a"};background:${item.selected ? "rgba(56,189,248,.15)" : "transparent"};color:${item.selected ? "#7dd3fc" : "#8a9aae"};">${item.name}</button>`;
  container.innerHTML =
    '<span style="font-size:12px;color:#6a7a8e;">类别</span>' + display.rigFilters.subcategories.map(item => button("sub", item)).join("") +
    '<span style="font-size:12px;color:#6a7a8e;margin-left:8px;">档位</span>' + display.rigFilters.tiers.map(item => button("tier", item)).join("");
}

function renderEquipEngRecipeGrid(display) {
  const state = display || getEquipmentEngineeringDisplayState(gameState, Date.now(), equipEngSearchTerm);
  const grid = document.getElementById("equipeng-recipe-grid"); if (!grid) return;
  const title = document.getElementById("equipeng-category-title"); if (title) title.textContent = state.category.name;
  const count = document.getElementById("equipeng-category-count"); if (count) count.textContent = (typeof state.visibleCount === "number" ? state.visibleCount : state.recipes.length) + " 个配方";
  if (!state.recipes.length) { grid.innerHTML = '<div class="equipeng-empty">当前分类没有匹配的配方</div>'; return; }
  grid.innerHTML = state.recipes.map(recipe => `<button class="equipeng-recipe-card${recipe.selected ? " selected" : ""}${recipe.unlocked ? "" : " locked"}" data-recipe="${recipe.id}" ${recipe.unlocked ? "" : "disabled"}>
    <span class="equipeng-card-top"><span>${recipe.tier} · ${recipe.slot}</span><span class="${recipe.unlocked ? "can-build" : "level-locked"}">${recipe.unlocked ? "可制造" : !recipe.hasRequiredBlueprint ? "需蓝图" : "Lv." + recipe.level + " 解锁"}</span></span>
    <span class="equipeng-card-icon"><i class="${recipe.icon}"></i></span><strong>${recipe.name}</strong><span class="equipeng-card-attributes">${recipe.attributes}</span>
    <span class="equipeng-card-bottom"><span>${recipe.actualTime.toFixed(1)}s · ${recipe.xp} XP</span><span>库存 ${recipe.ownedCount.toLocaleString()}</span></span></button>`).join("");
}

function renderEquipEngDetail(display) {
  const title = document.getElementById("equipeng-detail-title"); if (title) title.textContent = display.detail.title;
  const tier = document.getElementById("equipeng-detail-tier"); if (tier) tier.textContent = display.detail.tier;
  const body = document.getElementById("equipeng-detail-body"); if (!body) return;
  const attributes = display.detail.attributes.length ? `<div class="equipeng-detail-section"><span class="equipeng-detail-label">装备属性</span><div class="equipeng-attribute-list">${display.detail.attributes.map(line => `<span>${line}</span>`).join("")}</div></div>` : "";
  const equipmentInputs = display.detail.equipmentInputs.map(item => `<div class="equipeng-material${item.enough ? " enough" : " short"}"><span><i class="fa-solid fa-box"></i>${item.name}</span><strong>×${item.quantity}</strong><small>未装配库存 ${item.stock.toLocaleString()}</small></div>`).join("");
  const materials = display.detail.materials.map(item => `<div class="equipeng-material${item.enough ? " enough" : " short"}"><span><i class="fa-solid fa-cubes-stacked"></i>${item.displayName || item.material}</span><strong>×${item.quantity}</strong><small>库存 ${item.stock.toLocaleString()}</small></div>`).join("");
  const running = display.detail.runningNote ? `<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造：${display.detail.runningNote.name}${display.detail.runningNote.targetDiffers ? " · 当前查看不会改变本次产物" : ""}</div>` : "";
  body.innerHTML = `${running}${attributes}<div class="equipeng-detail-section"><span class="equipeng-detail-label">制造材料</span><div class="equipeng-material-list">${equipmentInputs}${materials}</div></div>
    <div class="equipeng-detail-section equipeng-manufacture-summary"><span>${getEquipEngOutputHtmlFromDisplay(display)}</span><span>单次耗时 ${display.detail.actualTime.toFixed(1)}s（基础 ${display.detail.baseTime}s）</span><span>装备工程经验 +${display.detail.xp}</span><span>按当前库存最多制造 ${display.detail.maxCycles.toLocaleString()} 次</span></div>`;
}

function renderEquipEngPage(now) {
  const display = getEquipmentEngineeringDisplayState(gameState, Number(now) || Date.now(), equipEngSearchTerm);
  const efficiency = document.getElementById("equipeng-eff-display"); if (efficiency) efficiency.textContent = "效率：" + display.efficiency.toFixed(2) + "x";
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
  const start = document.getElementById("btn-start-equipeng"); if (start) { start.style.display = display.active ? "none" : ""; start.disabled = !display.canStart; }
  const stop = document.getElementById("btn-stop-equipeng"); if (stop) stop.style.display = display.active ? "" : "none";
}

(function bindManufacturingUI() {
  const componentButton = document.getElementById("shipcomp-dropbtn");
  const componentContent = document.getElementById("shipcomp-dropdown-content");
  if (componentButton && componentContent) {
    componentButton.addEventListener("click", event => { event.stopPropagation(); renderShipCompDropdown(); componentContent.classList.toggle("show"); });
    document.addEventListener("click", () => componentContent.classList.remove("show"));
  }
  const assemblyButton = document.getElementById("shipasm-dropbtn");
  const assemblyContent = document.getElementById("shipasm-dropdown-content");
  if (assemblyButton && assemblyContent) {
    assemblyButton.addEventListener("click", event => { event.stopPropagation(); renderShipAsmDropdown(); assemblyContent.classList.toggle("show"); });
    document.addEventListener("click", () => assemblyContent.classList.remove("show"));
  }
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
    const subButton = event.target.closest("[data-rig-sub]");
    const tierButton = event.target.closest("[data-rig-tier]");
    if (!subButton && !tierButton) return;
    const payload = { type:"manufacturing/selectEquipEngRigFilter" };
    if (subButton) payload.sub = subButton.dataset.rigSub;
    if (tierButton) payload.tier = tierButton.dataset.rigTier;
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
