/* ================================================================
   增强剂制造 UI — Phase 2A
   纯消费 getBoosterManufacturingDisplayState(gameState, now)；
   仅制造与库存，不含六槽装备操作、180 秒计时消耗、效果应用（Phase 2B）。
   结构复用装备工程页样式类（equipeng-*），保持视觉一致。
   ================================================================ */

function renderBoosterCategoryTabs(display) {
  const tabs = document.getElementById("booster-category-tabs");
  if (!tabs) return;
  tabs.innerHTML = display.categories.map(category =>
    `<button class="equipeng-category-tab${category.selected ? " active" : ""}" data-booster-category="${category.id}" role="tab" aria-selected="${category.selected}"><span>${category.name}</span></button>`
  ).join("");
}

function renderBoosterQualityFilters(display) {
  const container = document.getElementById("booster-quality-filters");
  if (!container) return;
  const button = item => `<button class="equipeng-rig-filter-btn${item.selected ? " selected" : ""}" data-booster-quality="${item.id}" role="tab" aria-selected="${item.selected}" style="padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;border:1px solid ${item.selected ? "#38bdf8" : "#2a3a4a"};background:${item.selected ? "rgba(56,189,248,.15)" : "transparent"};color:${item.selected ? "#7dd3fc" : "#8a9aae"};">${item.name}</button>`;
  container.innerHTML =
    '<span style="font-size:12px;color:#6a7a8e;">品质</span>' + display.qualityFilters.map(button).join("");
}

function renderBoosterRecipeGrid(display) {
  const grid = document.getElementById("booster-recipe-grid");
  if (!grid) return;
  const category = display.categories.find(c => c.selected);
  const title = document.getElementById("booster-category-title");
  if (title) title.textContent = category ? category.name : "增强剂";
  const count = document.getElementById("booster-category-count");
  if (count) count.textContent = display.recipes.length + " 个配方";
  if (!display.recipes.length) {
    grid.innerHTML = '<div class="equipeng-empty">当前分类没有匹配的配方</div>';
    return;
  }
  grid.innerHTML = display.recipes.map(recipe => {
    const statusLabel = recipe.isUnlocked ? (recipe.hasMaterials ? "可制造" : "材料不足") : ("Lv." + recipe.level + " 解锁");
    const statusClass = recipe.canManufacture ? "can-build" : "level-locked";
    return `<button class="equipeng-recipe-card${recipe.selected ? " selected" : ""}${recipe.isUnlocked ? "" : " locked"}" data-booster-recipe="${recipe.id}"${recipe.isUnlocked ? "" : " disabled"}>
      <span class="equipeng-card-top"><span>${recipe.qualityName} · ${recipe.seriesName}</span><span class="${statusClass}">${statusLabel}</span></span>
      <span class="equipeng-card-icon"><i class="fa-solid fa-syringe"></i></span><strong>${recipe.displayName}</strong>
      <span class="equipeng-card-attributes">${recipe.effectText} · 持续 ${recipe.durationSeconds}s</span>
      <span class="equipeng-card-bottom"><span>${recipe.effectiveTime.toFixed(1)}s · ${recipe.xp} XP</span><span>库存 ${recipe.owned.toLocaleString()}</span></span></button>`;
  }).join("");
}

function renderBoosterDetail(display) {
  const recipe = display.selectedRecipe;
  const title = document.getElementById("booster-detail-title");
  const tier = document.getElementById("booster-detail-tier");
  const body = document.getElementById("booster-detail-body");
  if (!recipe) {
    if (title) title.textContent = "—";
    if (tier) tier.textContent = "";
    if (body) body.innerHTML = '<div class="equipeng-empty">请选择一个配方</div>';
    return;
  }
  if (title) title.textContent = recipe.displayName;
  if (tier) tier.textContent = recipe.qualityName;
  if (!body) return;
  const materials = recipe.materialRows.map(row =>
    `<div class="equipeng-material${row.enough ? " enough" : " short"}"><span><i class="fa-solid fa-cubes-stacked"></i>${row.displayName}</span><strong>×${row.required}</strong><small>库存 ${row.stock.toLocaleString()}</small></div>`
  ).join("");
  const running = (display.isRunning && display.runningRecipeId && display.runningRecipeId !== recipe.id)
    ? `<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造其他配方 · 当前查看不会改变本次产物</div>`
    : (display.isRunning && display.runningRecipeId === recipe.id)
      ? `<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造：${recipe.displayName}</div>`
      : "";
  const lockNote = (!recipe.canManufacture && recipe.lockedReason)
    ? `<div class="equipeng-detail-section" style="color:#f0857b;">${recipe.lockedReason}</div>` : "";
  body.innerHTML = `${running}
    <div class="equipeng-detail-section"><span class="equipeng-detail-label">效果（Phase 2B 生效）</span><div class="equipeng-attribute-list"><span>${recipe.effectText}</span><span>每瓶持续 ${recipe.durationSeconds}s</span></div></div>
    <div class="equipeng-detail-section"><span class="equipeng-detail-label">制造材料</span><div class="equipeng-material-list">${materials}</div></div>
    <div class="equipeng-detail-section equipeng-manufacture-summary"><span>产出：${recipe.displayName} ×1</span><span>单次耗时 ${recipe.effectiveTime.toFixed(1)}s（基础 ${recipe.time}s）</span><span>增强剂制造经验 +${recipe.xp}</span></div>
    ${lockNote}`;
}

function renderBoosterInventory(display) {
  const grid = document.getElementById("booster-inventory-grid");
  const count = document.getElementById("booster-inventory-count");
  if (count) count.textContent = display.inventoryCards.length + " 种";
  if (!grid) return;
  if (!display.inventoryCards.length) {
    grid.innerHTML = '<div class="equipeng-empty">暂无增强剂库存，制造后将在此显示</div>';
    return;
  }
  grid.innerHTML = display.inventoryCards.map(card =>
    `<div class="equipeng-recipe-card" style="cursor:default;">
      <span class="equipeng-card-top"><span>${card.qualityName} · ${card.seriesName}</span><span class="can-build">×${card.quantity.toLocaleString()}</span></span>
      <span class="equipeng-card-icon"><i class="fa-solid fa-flask-vial"></i></span><strong>${card.displayName}</strong>
      <span class="equipeng-card-attributes">${card.effectText} · 持续 ${card.durationSeconds}s</span>
      <span class="equipeng-card-bottom"><span>Phase 2B 可装备使用</span></span></div>`
  ).join("");
}

function renderBoosterPage(now) {
  const display = getBoosterManufacturingDisplayState(gameState, Number(now) || Date.now());
  const efficiency = document.getElementById("booster-eff-display"); if (efficiency) efficiency.textContent = "效率：" + display.efficiency.toFixed(2) + "x";
  const level = document.getElementById("booster-lv-num"); if (level) level.textContent = display.level;
  const xp = document.getElementById("booster-exp-value"); if (xp) xp.textContent = Math.floor(display.xp).toLocaleString() + " / " + display.xpRequired.toLocaleString();
  const fill = document.getElementById("booster-exp-fill"); if (fill) fill.style.width = display.xpPercent + "%";
  renderBoosterCategoryTabs(display);
  renderBoosterQualityFilters(display);
  renderBoosterRecipeGrid(display);
  renderBoosterDetail(display);
  renderBoosterInventory(display);
  const row = document.getElementById("booster-progress-row"); if (row) row.style.display = display.isRunning ? "" : "none";
  if (typeof drawSkillBar === "function") drawSkillBar(document.getElementById("bar-booster"), display.progress.percent, "purple");
  const eta = document.getElementById("booster-eta"); if (eta) eta.textContent = display.progress.etaText;
  const status = document.getElementById("booster-status-text"); if (status) status.textContent = display.statusText;
  const start = document.getElementById("btn-start-booster"); if (start) { start.style.display = display.isRunning ? "none" : ""; start.disabled = !display.canStart; }
  const stop = document.getElementById("btn-stop-booster"); if (stop) stop.style.display = display.isRunning ? "" : "none";
}

(function bindBoosterUI() {
  const tabs = document.getElementById("booster-category-tabs");
  if (tabs) tabs.addEventListener("click", event => {
    const button = event.target.closest("[data-booster-category]");
    if (!button) return;
    const result = dispatchGameAction(gameState, { type:"booster/selectCategory", categoryId:button.dataset.boosterCategory }, Date.now());
    if (result.changed) renderBoosterPage();
  });
  const quality = document.getElementById("booster-quality-filters");
  if (quality) quality.addEventListener("click", event => {
    const button = event.target.closest("[data-booster-quality]");
    if (!button) return;
    const result = dispatchGameAction(gameState, { type:"booster/selectQualityFilter", quality:button.dataset.boosterQuality }, Date.now());
    if (result.changed) renderBoosterPage();
  });
  const grid = document.getElementById("booster-recipe-grid");
  if (grid) grid.addEventListener("click", event => {
    const card = event.target.closest("[data-booster-recipe]");
    if (!card || card.disabled) return;
    const result = dispatchGameAction(gameState, { type:"booster/selectRecipe", recipeId:card.dataset.boosterRecipe }, Date.now());
    if (result.changed) renderBoosterPage();
  });
  const start = document.getElementById("btn-start-booster");
  if (start) start.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"booster/startManufacturing" }, Date.now());
    if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
  });
  const stop = document.getElementById("btn-stop-booster");
  if (stop) stop.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"booster/stopManufacturing" }, Date.now());
    if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
  });
})();

window.renderBoosterPage = renderBoosterPage;
