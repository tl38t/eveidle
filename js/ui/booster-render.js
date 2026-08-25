/* ================================================================
   增强剂制造 UI — Phase 2B
   包含制造 UI 与六槽装备/替换/卸下操作。
   结构复用装备工程页样式类（equipeng-*），保持视觉一致。
   ================================================================ */

/* ---- 提示消息 ---- */
function showBoosterToast(msg, isError) {
  var existing = document.querySelector(".booster-toast");
  if (existing) existing.remove();
  var toast = document.createElement("div");
  toast.className = "booster-toast";
  toast.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:6px;z-index:10000;font-size:13px;max-width:400px;text-align:center;" +
    (isError ? "background:#5c1a1a;color:#f0857b;border:1px solid #8a3a3a;" : "background:#1a3a2a;color:#7dd3fc;border:1px solid #2a5a4a;");
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 3500);
}

/* ---- 制造 UI ---- */
function renderBoosterCategoryTabs(display) {
  var tabs = document.getElementById("booster-category-tabs");
  if (!tabs) return;
  tabs.innerHTML = display.categories.map(function(category) {
    return '<button class="equipeng-category-tab' + (category.selected ? " active" : "") + '" data-booster-category="' + category.id + '" role="tab" aria-selected="' + category.selected + '"><span>' + category.name + '</span></button>';
  }).join("");
}

function renderBoosterQualityFilters(display) {
  var container = document.getElementById("booster-quality-filters");
  if (!container) return;
  var html = '<span style="font-size:12px;color:#6a7a8e;">品质</span>';
  for (var i = 0; i < display.qualityFilters.length; i++) {
    var item = display.qualityFilters[i];
    html += '<button class="equipeng-rig-filter-btn' + (item.selected ? " selected" : "") + '" data-booster-quality="' + item.id + '" role="tab" aria-selected="' + item.selected + '" style="padding:3px 10px;border-radius:4px;font-size:12px;cursor:pointer;border:1px solid ' + (item.selected ? "#38bdf8" : "#2a3a4a") + ';background:' + (item.selected ? "rgba(56,189,248,.15)" : "transparent") + ';color:' + (item.selected ? "#7dd3fc" : "#8a9aae") + ';">' + item.name + '</button>';
  }
  container.innerHTML = html;
}

function renderBoosterRecipeGrid(display) {
  var grid = document.getElementById("booster-recipe-grid");
  if (!grid) return;
  var category = display.categories.find(function(c) { return c.selected; });
  var title = document.getElementById("booster-category-title");
  if (title) title.textContent = category ? category.name : "增强剂";
  var count = document.getElementById("booster-category-count");
  if (count) count.textContent = display.recipes.length + " 个配方";
  if (!display.recipes.length) {
    grid.innerHTML = '<div class="equipeng-empty">当前分类没有匹配的配方</div>';
    return;
  }
  grid.innerHTML = display.recipes.map(function(recipe) {
    var locked = !recipe.isUnlocked;
    var statusLabel = recipe.isUnlocked
      ? (recipe.hasMaterials ? "可制造" : "材料不足")
      : ("🔒 " + (recipe.requiresBlueprint && !recipe.hasRequiredBlueprint ? "需蓝图" : ("Lv." + recipe.level + " 解锁")));
    var statusClass = recipe.isUnlocked ? (recipe.canManufacture ? "can-build" : "level-locked") : ("lock-tag" + (recipe.requiresBlueprint && !recipe.hasRequiredBlueprint ? "" : " lvl"));
    return '<button class="equipeng-recipe-card' + (recipe.selected ? " selected" : "") + (locked ? " locked" : "") + '" data-booster-recipe="' + recipe.id + '">' +
      (locked ? '<span class="lock-badge">🔒</span>' : "") +
      '<span class="equipeng-card-top"><span>' + recipe.qualityName + " · " + recipe.seriesName + '</span><span class="' + statusClass + '">' + statusLabel + '</span></span>' +
      '<span class="equipeng-card-icon"><i class="fa-solid fa-syringe"></i></span><strong>' + recipe.displayName + '</strong>' +
      '<span class="equipeng-card-attributes">' + recipe.effectText + ' · 持续 ' + recipe.durationSeconds + 's</span>' +
      '<span class="equipeng-card-bottom"><span>' + recipe.effectiveTime.toFixed(1) + 's · ' + recipe.xp + ' XP</span><span>库存 ' + recipe.owned.toLocaleString() + '</span></span></button>';
  }).join("");
}

function renderBoosterDetail(display) {
  var recipe = display.selectedRecipe;
  var title = document.getElementById("booster-detail-title");
  var tier = document.getElementById("booster-detail-tier");
  var body = document.getElementById("booster-detail-body");
  if (!recipe) {
    if (title) title.textContent = "—";
    if (tier) tier.textContent = "";
    if (body) body.innerHTML = '<div class="equipeng-empty">请选择一个配方</div>';
    return;
  }
  if (title) title.textContent = recipe.displayName;
  if (tier) tier.textContent = recipe.qualityName;
  if (!body) return;
  var materials = recipe.materialRows.map(function(row) {
    var key = row.reference;
    var name = row.displayName;
    return '<div class="equipeng-material' + (row.enough ? " enough" : " short") + '"><span><i class="fa-solid fa-cubes-stacked"></i><button type="button" class="mat-link" data-mat-key="' + twEsc(key) + '" data-mat-name="' + twEsc(name) + '">' + twEsc(name) + '</button></span><strong>×' + row.required + '</strong><small>库存 ' + row.stock.toLocaleString() + '</small></div>';
  }).join("");
  var running = (display.isRunning && display.runningRecipeId && display.runningRecipeId !== recipe.id)
    ? '<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造其他配方 · 当前查看不会改变本次产物</div>'
    : (display.isRunning && display.runningRecipeId === recipe.id)
      ? '<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造：' + recipe.displayName + '</div>'
      : "";
  var lockNote = (recipe && !recipe.isUnlocked)
    ? '<div class="lock-banner"><span class="lb-icon">🔒</span><span>' + (recipe.requiresBlueprint && !recipe.hasRequiredBlueprint ? "未解锁：需蓝图解锁（考古掉落获取蓝图）" : ("未解锁：增强剂制造 Lv." + recipe.level + " 解锁")) + '</span></div>'
    : "";
  body.innerHTML = running +
    '<div class="equipeng-detail-section"><span class="equipeng-detail-label">效果</span><div class="equipeng-attribute-list"><span>' + recipe.effectText + '</span><span>每瓶持续 ' + recipe.durationSeconds + 's</span></div></div>' +
    '<div class="equipeng-detail-section"><span class="equipeng-detail-label">制造材料</span><div class="equipeng-material-list">' + materials + '</div></div>' +
    '<div class="equipeng-detail-section equipeng-manufacture-summary"><span>产出：' + recipe.displayName + ' ×1</span><span>单次耗时 ' + recipe.effectiveTime.toFixed(1) + 's（基础 ' + recipe.time + 's）</span><span>增强剂制造经验 +' + recipe.xp + '</span></div>' +
    lockNote;
}

/* ---- 已装载增强剂区域 ---- */
function renderBoosterEquippedArea(display, actionKey) {
  var area = document.getElementById("booster-equipped-area");
  var countEl = document.getElementById("booster-equipped-count");
  if (!area) return;
  if (!display || !display.groups) {
    if (countEl) countEl.textContent = "0 槽";
    area.innerHTML = '<div class="equipeng-empty">暂无已装载增强剂</div>';
    return;
  }
  var groups = actionKey && typeof getActionBoosterSlots === "function"
    ? display.groups.filter(function(group) { return getActionBoosterSlots(actionKey).indexOf(group.slots[0].slot) >= 0; })
    : display.groups;
  var totalSlots = 0;
  var filled = 0;
  for (var g = 0; g < groups.length; g++) {
    totalSlots += groups[g].slots.length;
    for (var s = 0; s < groups[g].slots.length; s++) {
      if (!groups[g].slots[s].empty) filled++;
    }
  }
  if (countEl) countEl.textContent = filled + " / " + totalSlots + " 槽";
  var html = "";
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    var slotCards = "";
    for (var s = 0; s < group.slots.length; s++) {
      var slot = group.slots[s];
      if (slot.empty) {
        slotCards += '<div class="equipeng-recipe-card" data-booster-slot="' + slot.slot + '" style="cursor:pointer;opacity:0.6;" title="点击从库存装载">' +
          '<span class="equipeng-card-top"><span>空槽</span><span class="can-build">—</span></span>' +
          '<span class="equipeng-card-icon"><i class="fa-solid fa-circle-dot"></i></span>' +
          '<strong>' + group.label + ' — 待装载</strong>' +
          '<span class="equipeng-card-attributes">无增强剂</span>' +
          '<span class="equipeng-card-bottom"><span>点击从库存装载</span></span></div>';
      } else {
        var statusClass = slot.status === "active" ? "can-build" : "level-locked";
        var statusLabel = slot.statusText || (slot.remainingMs > 0 ? "生效中" : "已耗尽");
        slotCards += '<div class="equipeng-recipe-card" data-booster-slot="' + slot.slot + '" style="cursor:default;">' +
          '<span class="equipeng-card-top"><span>' + slot.qualityName + " · " + slot.name + '</span><span class="' + statusClass + '">' + statusLabel + '</span></span>' +
          '<span class="equipeng-card-icon"><i class="fa-solid fa-flask"></i></span>' +
          '<strong>' + slot.name + '</strong>' +
          '<span class="equipeng-card-attributes">' + slot.effectText + ' · 剩余 ' + slot.remainingText + '</span>' +
          '<span class="equipeng-card-bottom"><span style="font-size:11px;">备用库存 ' + (slot.inventory || 0).toLocaleString() + ' · 当前瓶 1</span><button class="booster-unequip-btn" data-booster-slot="' + slot.slot + '" style="margin-left:6px;padding:2px 8px;border-radius:3px;border:1px solid #8a3a3a;background:#3a1a1a;color:#f0857b;font-size:11px;cursor:pointer;">卸下</button></span></div>';
      }
    }
    html += '<div style="margin-bottom:8px;"><div style="font-size:12px;color:#8a9aae;margin-bottom:4px;">' + group.label + '</div>' + slotCards + '</div>';
  }
  area.innerHTML = html || '<div class="equipeng-empty">暂无已装载增强剂</div>';
}

// 将对应行动的两个增强剂槽位就地显示在行动页面内。
function renderActionBoosterSlots(actionKey, containerId) {
  var area = document.getElementById(containerId);
  if (!area) return;
  // Always append after the existing action UI, regardless of the placeholder's HTML position.
  var panelBody = area.closest(".panel-body");
  if (panelBody && containerId !== "booster-equipped-area" && area.parentNode !== panelBody) panelBody.appendChild(area);
  var slots = (typeof getActionBoosterSlots === "function") ? getActionBoosterSlots(actionKey) : [];
  var active = (typeof getActiveBoosterState === "function") ? getActiveBoosterState(gameState) : {};
  if (!slots.length) { area.innerHTML = ""; return; }
  var labels = { miningSpeed:"速度", miningYield:"产量", archaeologySpeed:"速度", archaeologyRare:"稀有", gasSpeed:"速度", gasYield:"产量", smeltSpeed:"速度", smeltYield:"产量", shipSpeed:"速度", shipYield:"产量", boosterSpeed:"速度", boosterYield:"产量", combatWeapon:"武器", combatRepair:"维修" };
  var html = '<div class="action-booster-title"><span>增强剂</span><span>点击空槽装载 · 点击已装备槽更换</span></div><div class="action-booster-grid">';
  slots.forEach(function(slot) {
    var entry = active[slot];
    var item = entry && typeof getBoosterItem === "function" ? getBoosterItem(entry.itemId) : null;
    if (!item) {
      html += '<div class="action-booster-slot action-booster-slot-empty" data-action-booster-slot="' + slot + '"><strong>' + (labels[slot] || slot) + '</strong><span>＋ 装载增强剂</span></div>';
      return;
    }
    var remaining = Math.max(0, Number(entry.remainingMs) || 0);
    html += '<div class="action-booster-slot" data-action-booster-slot="' + slot + '"><strong>' + (labels[slot] || slot) + ' · ' + item.name + '</strong><span>' + (typeof describeBoosterEffect === "function" ? describeBoosterEffect(item.effectType, item.effectValue, item.repairTarget, null, (typeof getSkillLabelForSlot === "function" ? getSkillLabelForSlot(slot) : null)) : "") + '</span><small>剩余 ' + Math.ceil(remaining / 1000) + 's · 点击更换</small></div>';
  });
  area.innerHTML = html + '</div>';
}

// Keep action-page slots visually consistent with the original booster cards.
function renderActionBoosterSlots(actionKey, containerId) {
  var area = document.getElementById(containerId);
  var panel = area ? area.closest(".panel") : document.getElementById(
    actionKey === "equipmentEngineering" ? "equipeng-panel" :
    actionKey === "shipEngineering" ? "shipeng-panel" :
    actionKey === "combat" ? "combat-panel" : null
  );
  var panelBody = panel ? panel.querySelector(".panel-body") : null;
  if (!area && panelBody) {
    area = document.createElement("div");
    area.id = containerId;
    area.className = "action-booster-slots";
    panelBody.appendChild(area);
  }
  if (!area) return;
  if (panelBody && containerId !== "booster-equipped-area" && area.parentNode !== panelBody) panelBody.appendChild(area);
  var slots = (typeof getActionBoosterSlots === "function") ? getActionBoosterSlots(actionKey) : [];
  var active = (typeof getActiveBoosterState === "function") ? getActiveBoosterState(gameState) : {};
  if (!slots.length) { area.innerHTML = ""; return; }
  var html = '<div class="action-booster-grid">';
  slots.forEach(function(slot) {
    var entry = active[slot];
    var item = entry && typeof getBoosterItem === "function" ? getBoosterItem(entry.itemId) : null;
    if (!item) {
      html += '<div class="equipeng-recipe-card action-booster-local-card action-booster-slot-empty" data-action-booster-slot="' + slot + '" title="Click to load a booster">' +
        '<span class="equipeng-card-top"><span>\u589e\u5f3a\u5242\u69fd</span><span class="can-build">\u5f85\u88c5\u8f7d</span></span>' +
        '<span class="equipeng-card-icon"><i class="fa-solid fa-flask-vial"></i></span><strong>\u88c5\u8f7d\u589e\u5f3a\u5242</strong>' +
        '<span class="equipeng-card-attributes">\u70b9\u51fb\u4ece\u4ed3\u5e93\u9009\u62e9</span><span class="equipeng-card-bottom"><span>\u7a7a\u69fd</span></span></div>';
      return;
    }
    var remaining = Math.max(0, Number(entry.remainingMs) || 0);
    // 库存实际按裸 id 存储于 boosters.inventory；通过 ResourceRegistry 读取可兼容 booster: 前缀旧存档。
    var inventory = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, item.itemId) : 0;
    html += '<div class="equipeng-recipe-card action-booster-local-card" data-action-booster-slot="' + slot + '" title="Click to replace this booster">' +
      '<span class="equipeng-card-top"><span>' + (item.qualityName || "\u589e\u5f3a\u5242") + ' · ' + item.name + '</span><span class="can-build">\u751f\u6548</span></span>' +
      '<span class="equipeng-card-icon"><i class="fa-solid fa-flask"></i></span><strong>' + item.name + '</strong>' +
      '<span class="equipeng-card-attributes">' + (typeof describeBoosterEffect === "function" ? describeBoosterEffect(item.effectType, item.effectValue, item.repairTarget, null, (typeof getSkillLabelForSlot === "function" ? getSkillLabelForSlot(slot) : null)) : "") + ' · \u5269\u4f59 ' + Math.ceil(remaining / 1000) + 's</span>' +
      '<span class="equipeng-card-bottom"><span>\u5e93\u5b58 ' + Number(inventory).toLocaleString() + '</span><button type="button" class="booster-unequip-btn action-booster-unequip-btn" data-action-booster-unequip="1" data-booster-slot="' + slot + '">\u5378\u4e0b</button></span></div>';
  });
  area.innerHTML = html + '</div>';
}

(function bindActionBoosterSlots() {
  document.addEventListener("click", function(event) {
    var unequipBtn = event.target.closest("[data-action-booster-unequip]");
    if (unequipBtn) {
      var unequipSlot = unequipBtn.getAttribute("data-booster-slot");
      if (!unequipSlot) return;
      showDangerConfirm("\u5378\u4e0b\u589e\u5f3a\u5242", "<p class=\"dlg-body\">\u786e\u5b9a\u5378\u4e0b\u8be5\u589e\u5f3a\u5242\uff1f\u5f53\u524d\u5269\u4f59\u65f6\u95f4\u5c06\u4f5c\u5e9f\u3002</p>", "\u786e\u8ba4\u5378\u4e0b", function() {
        var result = dispatchGameAction(gameState, { type:"booster/unequip", slot:unequipSlot }, Date.now());
        if (result.changed) { if (typeof updateUI === "function") updateUI(); }
        else { showBoosterToast(result.reason || "\u5378\u4e0b\u5931\u8d25", true); }
      });
      return;
    }
    var card = event.target.closest("[data-action-booster-slot]");
    if (!card) return;
    var slot = card.getAttribute("data-action-booster-slot");
    var compatible = getCompatibleBoosterItems(slot);
    if (!compatible.length) { showBoosterToast("没有适合该槽位的库存增强剂", true); return; }
    var active = getActiveBoosterState(gameState);
    showBoosterSlotPicker(slot, compatible, active[slot] || null);
  });
})();

/* ---- 库存卡片 ---- */
function renderBoosterInventory(display) {
  var grid = document.getElementById("booster-inventory-grid");
  var countEl = document.getElementById("booster-inventory-count");
  if (countEl) countEl.textContent = display.inventoryCards.length + " 种";
  if (!grid) return;
  if (!display.inventoryCards.length) {
    grid.innerHTML = '<div class="equipeng-empty">暂无增强剂库存，制造后将在此显示</div>';
    return;
  }
  // 需要 slot 信息：从 BOOSTER_ITEMS 获取
  var itemSlots = {};
  var itemUniversal = {};
  if (typeof BOOSTER_ITEMS !== "undefined") {
    for (var key in BOOSTER_ITEMS) {
      var it = BOOSTER_ITEMS[key];
      if (it) { itemSlots[it.itemId || it.id] = it.slot || ""; itemUniversal[it.itemId || it.id] = !!it.universal; }
    }
  }
  grid.innerHTML = display.inventoryCards.map(function(card) {
    var slotName = itemSlots[card.itemId] || itemSlots[card.id] || "";
    var isUniversal = itemUniversal[card.itemId] || itemUniversal[card.id] || false;
    return '<div class="equipeng-recipe-card" data-booster-item="' + (card.itemId || card.id) + '" data-booster-slot="' + slotName + '"' + (isUniversal ? ' data-booster-universal="1"' : '') + ' style="cursor:pointer;" title="' + (isUniversal ? "点击选择槽位装载" : "点击装载到对应槽位") + '">' +
      '<span class="equipeng-card-top"><span>' + card.qualityName + " · " + card.seriesName + '</span><span class="can-build">×' + card.quantity.toLocaleString() + '</span></span>' +
      '<span class="equipeng-card-icon"><i class="fa-solid fa-flask-vial"></i></span><strong>' + card.displayName + '</strong>' +
      '<span class="equipeng-card-attributes">' + card.effectText + ' · 持续 ' + card.durationSeconds + 's</span>' +
      '<span class="equipeng-card-bottom"><span>点击装载</span></span></div>';
  }).join("");
}

/* ---- 主渲染入口 ---- */
function renderBoosterPage(now) {
  var display = getBoosterManufacturingDisplayState(gameState, Number(now) || Date.now());
  var efficiency = document.getElementById("booster-eff-display");
  if (efficiency) {
    efficiency.textContent = "效率：" + display.efficiency.toFixed(2) + "x";
    var skillMult = (1 + display.level * 0.02);
    efficiency.title = "技能速度：1 × (1 + Lv." + display.level + " × 0.02) = " + skillMult.toFixed(2) + "x"
      + "\n空间站综合后勤：×" + (display.stationLogisticsMultiplier || 1).toFixed(2) + "（" + ((display.stationLogistics && display.stationLogistics.text) || "未建立") + "）"
      + "\n科研加成：×" + (display.researchMultiplier || 1).toFixed(3)
      + "\n最终效率：" + display.efficiency.toFixed(2) + "x";
  }
  var bsLog = document.getElementById("booster-logistics");
  if (bsLog) {
    var lm = display.stationLogisticsMultiplier || 1;
    bsLog.textContent = lm > 1 ? "后勤 ×" + lm.toFixed(2) + "（+" + Math.round((lm - 1) * 100) + "%）" : "后勤 ×" + lm.toFixed(2);
  }
  var level = document.getElementById("booster-lv-num"); if (level) level.textContent = display.level;
  var xp = document.getElementById("booster-exp-value"); if (xp) xp.textContent = Math.floor(display.xp).toLocaleString() + " / " + display.xpRequired.toLocaleString();
  var fill = document.getElementById("booster-exp-fill"); if (fill) fill.style.width = display.xpPercent + "%";
  renderBoosterCategoryTabs(display);
  renderBoosterQualityFilters(display);
  renderBoosterRecipeGrid(display);
  renderBoosterDetail(display);
  renderBoosterInventory(display);
  var boosterDisplay = (typeof getBoosterDisplayState === "function") ? getBoosterDisplayState(gameState, now) : null;
  // 制造页是增强剂总览，应展示所有已装载槽位；行动页再按 actionKey 过滤到对应的两个槽位。
  renderBoosterEquippedArea(boosterDisplay);
  var row = document.getElementById("booster-progress-row"); if (row) row.style.display = display.isRunning ? "" : "none";
  if (typeof drawSkillBar === "function") drawSkillBar(document.getElementById("bar-booster"), display.progress.percent, "purple");
  var eta = document.getElementById("booster-eta"); if (eta) eta.textContent = display.progress.etaText;
  var status = document.getElementById("booster-status-text"); if (status) status.textContent = display.statusText;
  // 仿装备制造：正在制造 A、当前选中 B（targetChanged）时，隐藏"停止"、显示"切换制造"；
  // 选中==在跑时显示停止；完全未跑时显示开始。
  var targetChanged = Boolean(display.isRunning && display.runningRecipeId && display.selectedRecipe && display.runningRecipeId !== display.selectedRecipe.id);
  var start = document.getElementById("btn-start-booster"); if (start) {
    start.style.display = (display.isRunning && !targetChanged) ? "none" : "";
    start.disabled = !display.canStart;
    // 未解锁也可选中预览；启动按钮按舰船总装逻辑显示锁定原因（需蓝图 / 等级），不再只是置灰。
    if (!display.canStart && display.selectedRecipe) {
      start.textContent = "🔒 " + (display.selectedRecipe.lockedReason || "无法制造");
    } else if (targetChanged) {
      start.textContent = "▶ 切换制造";
    } else {
      start.textContent = "▶ 开始制造";
    }
  }
  var stop = document.getElementById("btn-stop-booster"); if (stop) stop.style.display = (display.isRunning && !targetChanged) ? "" : "none";
}

/* ---- 事件绑定 ---- */
(function bindBoosterUI() {
  // 分类标签
  var tabs = document.getElementById("booster-category-tabs");
  if (tabs) tabs.addEventListener("click", function(event) {
    var button = event.target.closest("[data-booster-category]");
    if (!button) return;
    var result = dispatchGameAction(gameState, { type:"booster/selectCategory", categoryId:button.dataset.boosterCategory }, Date.now());
    if (result.changed) renderBoosterPage();
  });
  // 品质筛选
  var quality = document.getElementById("booster-quality-filters");
  if (quality) quality.addEventListener("click", function(event) {
    var button = event.target.closest("[data-booster-quality]");
    if (!button) return;
    var result = dispatchGameAction(gameState, { type:"booster/selectQualityFilter", quality:button.dataset.boosterQuality }, Date.now());
    if (result.changed) renderBoosterPage();
  });
  // 配方选择
  var grid = document.getElementById("booster-recipe-grid");
  if (grid) grid.addEventListener("click", function(event) {
    var card = event.target.closest("[data-booster-recipe]");
    if (!card || card.disabled) return;
    var result = dispatchGameAction(gameState, { type:"booster/selectRecipe", recipeId:card.dataset.boosterRecipe }, Date.now());
    if (result.changed) renderBoosterPage();
  });
  // 开始制造
  var start = document.getElementById("btn-start-booster");
  if (start) start.addEventListener("click", function() { showActionConfirm("boosterEngineering"); });
  // 停止制造
  var stop = document.getElementById("btn-stop-booster");
  if (stop) stop.addEventListener("click", function() {
    var result = dispatchGameAction(gameState, { type:"booster/stopManufacturing" }, Date.now());
    if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
  });

  // --- 已装载区域交互：装备 / 卸下 / 替换 ---
  var equippedArea = document.getElementById("booster-equipped-area");
  if (equippedArea) {
    equippedArea.addEventListener("click", function(event) {
      // 卸下按钮
      var unequipBtn = event.target.closest(".booster-unequip-btn");
      if (unequipBtn) {
        var slot = unequipBtn.dataset.boosterSlot;
        if (!slot) return;
        showDangerConfirm("⚠ 卸下增强剂",
          "<p class=\"dlg-body\">确定卸下该增强剂？当前瓶剩余时间将作废，且不会返还。</p>",
          "确认卸下",
          function() {
            var result = dispatchGameAction(gameState, { type:"booster/unequip", slot:slot }, Date.now());
            if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
            else { showBoosterToast(result.reason || "卸下失败", true); }
          });
        return;
      }
      // 空槽点击：打开库存选择装载
      var slotCard = event.target.closest("[data-booster-slot]");
      if (!slotCard) return;
      var slot = slotCard.dataset.boosterSlot;
      if (!slot) return;
      // 获取该槽位的兼容库存物品
      var compatibleItems = getCompatibleBoosterItems(slot);
      if (!compatibleItems || compatibleItems.length === 0) {
        showBoosterToast("没有适合该槽位的库存增强剂", true);
        return;
      }
      // 检查该槽是否已被占用
      var active = (typeof getActiveBoosterState === "function") ? getActiveBoosterState(gameState) : {};
      var existing = active[slot];
      // 始终弹出选择界面（即使只有一个候选项），由用户点按钮确认装备/替换
      showBoosterSlotPicker(slot, compatibleItems, existing);
    });
  }

  // --- 库存卡片点击：装载或替换 ---
  var invGrid = document.getElementById("booster-inventory-grid");
  if (invGrid) {
    invGrid.addEventListener("click", function(event) {
      var card = event.target.closest("[data-booster-item]");
      if (!card) return;
      var itemId = card.dataset.boosterItem;
      var slot = card.dataset.boosterSlot;
      var isUniversal = card.dataset.boosterUniversal === "1";
      if (!itemId) return;
      // 检查库存
      var inv = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, itemId) : 0;
      if (!(inv >= 1)) { showBoosterToast("库存不足，无法装载", true); return; }
      // 通用件（神经训练催化器）：弹出槽位选择器，由用户选择装载到哪类槽
      if (isUniversal) { showUniversalBoosterSlotPicker(itemId, inv); return; }
      if (!slot) return;
      // 检查槽位状态
      var active = (typeof getActiveBoosterState === "function") ? getActiveBoosterState(gameState) : {};
      var existing = active[slot];
      if (existing) {
        var existingItemId = existing.itemId;
        var normExisting = (typeof existingItemId === "string" && existingItemId.startsWith("booster:")) ? existingItemId.slice("booster:".length) : existingItemId;
        var normNew = (typeof itemId === "string" && itemId.startsWith("booster:")) ? itemId.slice("booster:".length) : itemId;
        if (normExisting === normNew) {
          showBoosterToast("该增强剂已在槽位中", true);
          return;
        }
        showDangerConfirm("⚠ 替换增强剂",
          "<p class=\"dlg-body\">替换后当前瓶剩余时间将作废，且不会返还。</p>",
          "确认替换",
          function() {
            var result = dispatchGameAction(gameState, { type:"booster/replace", slot:slot, itemId:itemId }, Date.now());
            if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
            else { showBoosterToast(result.reason || "替换失败", true); }
          });
        return;
      } else {
        // 空槽：直接装备
        var result = dispatchGameAction(gameState, { type:"booster/equip", slot:slot, itemId:itemId }, Date.now());
        if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
        else { showBoosterToast(result.reason || "装载失败", true); }
      }
    });
  }
})();

/* ---- 辅助：获取某槽位的兼容库存物品 ---- */
function getCompatibleBoosterItems(slot) {
  var result = [];
  if (typeof getActiveBoosterState !== "function" || typeof ResourceRegistry === "undefined") return result;
  var active = getActiveBoosterState(gameState);
  var inventory = (gameState.boosters && gameState.boosters.inventory) || {};
  for (var key in inventory) {
    var qty = Number(inventory[key]) || 0;
    if (qty <= 0) continue;
    // 用裸 id 查找
    var item = (typeof getBoosterItem === "function") ? getBoosterItem(key) : null;
    if (!item) continue;
    if (typeof isBoosterCompatibleWithSlot === "function" ? !isBoosterCompatibleWithSlot(item, slot) : (!item.universal && item.slot !== slot)) continue;
    // 同系列冲突检查（通用件不参与系列互斥，可跨槽多槽共存）
    var conflict = false;
    for (var s = 0; s < BOOSTER_SLOTS.length; s++) {
      var e = active[BOOSTER_SLOTS[s]];
      if (!e || BOOSTER_SLOTS[s] === slot) continue;
      var existingItem = (typeof getBoosterItem === "function") ? getBoosterItem(e.itemId) : null;
      if (existingItem && !item.universal && !existingItem.universal && existingItem.series === item.series) { conflict = true; break; }
      // 通用件（神经）：同一类别槽位只能装一个
      if (existingItem && existingItem.universal && item.universal && BOOSTER_SLOT_XP_SKILL[BOOSTER_SLOTS[s]] === BOOSTER_SLOT_XP_SKILL[slot]) { conflict = true; break; }
    }
    if (conflict) continue;
    result.push({ id:item.itemId, name:item.name, quality:item.quality, qualityName:item.qualityName, effectText:(typeof describeBoosterEffect === "function") ? describeBoosterEffect(item.effectType, item.effectValue, item.repairTarget) : "", inv:qty });
  }
  result.sort(function(a, b) { return (a.name || "").localeCompare(b.name || "", "zh-Hans-CN"); });
  return result;
}

/* ---- 辅助：槽位选择器弹窗 ---- */
function showBoosterSlotPicker(slot, items, existingEntry) {
  var existing = document.querySelector(".booster-picker-overlay");
  if (existing) existing.remove();
  var overlay = document.createElement("div");
  overlay.className = "booster-picker-overlay";
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;";
  var box = document.createElement("div");
  box.style.cssText = "background:#1a2a3a;border:1px solid #3a5a6a;border-radius:8px;padding:20px;max-width:420px;width:90%;max-height:70vh;overflow-y:auto;";
  var title = document.createElement("div");
  title.style.cssText = "font-size:14px;font-weight:bold;color:#7dd3fc;margin-bottom:12px;";
  title.textContent = "选择增强剂 — 槽位 " + slot;
  box.appendChild(title);
  if (existingEntry) {
    var note = document.createElement("div");
    note.style.cssText = "font-size:12px;color:#f0857b;margin-bottom:10px;";
    note.textContent = "替换后当前瓶剩余时间将作废，且不会返还。";
    box.appendChild(note);
  }
  for (var i = 0; i < items.length; i++) {
    (function(item) {
      var card = document.createElement("div");
      card.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;margin-bottom:6px;background:#0f1a2a;border:1px solid #2a3a4a;border-radius:4px;cursor:pointer;";
      card.innerHTML = '<span><strong>' + item.name + '</strong><br><span style="font-size:11px;color:#8a9aae;">' + item.effectText + '</span></span><span style="color:' + (item.inv > 0 ? "#7dd3fc" : "#f0857b") + ';font-size:12px;">×' + item.inv + '</span>';
      if (item.inv <= 0) card.style.opacity = "0.5";
      card.addEventListener("click", function() {
        overlay.remove();
        if (item.inv <= 0) { showBoosterToast("库存不足", true); return; }
        if (existingEntry) {
          var result = dispatchGameAction(gameState, { type:"booster/replace", slot:slot, itemId:item.id }, Date.now());
          if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
          else { showBoosterToast(result.reason || "替换失败", true); }
        } else {
          var result = dispatchGameAction(gameState, { type:"booster/equip", slot:slot, itemId:item.id }, Date.now());
          if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
          else { showBoosterToast(result.reason || "装载失败", true); }
        }
      });
      box.appendChild(card);
    })(items[i]);
  }
  var closeBtn = document.createElement("button");
  closeBtn.textContent = "取消";
  closeBtn.style.cssText = "margin-top:10px;padding:6px 16px;border-radius:4px;border:1px solid #3a5a6a;background:transparent;color:#8a9aae;cursor:pointer;width:100%;";
  closeBtn.addEventListener("click", function() { overlay.remove(); });
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

/* ---- 辅助：通用增强剂（神经训练催化器）装备槽位选择器 ---- */
var BOOSTER_SLOT_FRIENDLY = {
  equipmentSpeed:"\u88c5\u5907\u5de5\u7a0b \u00b7 \u901f\u5ea6", equipmentYield:"\u88c5\u5907\u5de5\u7a0b \u00b7 \u4ea7\u91cf",
  miningSpeed:"采矿 · 速度", miningYield:"采矿 · 产量",
  archaeologySpeed:"考古 · 速度", archaeologyRare:"考古 · 稀有",
  combatWeapon:"战斗 · 武器", combatRepair:"战斗 · 维修",
  gasSpeed:"采气 · 速度", gasYield:"采气 · 产量",
  smeltSpeed:"冶炼 · 速度", smeltYield:"冶炼 · 产量",
  shipSpeed:"舰船 · 速度", shipYield:"舰船 · 材料",
  boosterSpeed:"增幅剂 · 速度", boosterYield:"增幅剂 · 产量"
};
Object.keys(BOOSTER_SLOT_FRIENDLY).forEach(function(slot) {
  var action = (typeof BOOSTER_SLOT_XP_SKILL !== "undefined") ? BOOSTER_SLOT_XP_SKILL[slot] : null;
  var labels = {
    mining:"\u91c7\u77ff", archaeology:"\u8003\u53e4", gasHarvesting:"\u91c7\u6c14", refining:"\u51b6\u70bc",
    shipEngineering:"\u8230\u8239\u5de5\u7a0b", equipmentEngineering:"\u88c5\u5907\u5de5\u7a0b", boosterEngineering:"\u589e\u5f3a\u5242\u5236\u9020", combat:"\u6218\u6597"
  };
  if (action && labels[action]) BOOSTER_SLOT_FRIENDLY[slot] = labels[action] + " \u00b7 \u589e\u5f3a\u5242\u69fd";
});

function showUniversalBoosterSlotPicker(itemId, inv) {
  var existingOverlay = document.querySelector(".booster-picker-overlay");
  if (existingOverlay) existingOverlay.remove();
  var item = (typeof getBoosterItem === "function") ? getBoosterItem(itemId) : null;
  var isSkillOverdrive = !!(item && item.effectType === "skillLevelBonus");
  var overlay = document.createElement("div");
  overlay.className = "booster-picker-overlay";
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;";
  var box = document.createElement("div");
  box.style.cssText = "background:#1a2a3a;border:1px solid #3a5a6a;border-radius:8px;padding:20px;max-width:460px;width:92%;max-height:78vh;overflow-y:auto;";
  var title = document.createElement("div");
  title.style.cssText = "font-size:14px;font-weight:bold;color:#7dd3fc;margin-bottom:6px;";
  title.textContent = (item ? item.name : "增强剂") + " — 选择装备槽位";
  box.appendChild(title);
  var sub = document.createElement("div");
  sub.style.cssText = "font-size:12px;color:#8a9aae;margin-bottom:12px;line-height:1.5;";
  sub.textContent = isSkillOverdrive
    ? "装入某类槽后，只加成该槽对应技能的临时等级；各类槽可分别装备一个，可多槽同时生效。不能装在战斗槽。"
    : "装入某类槽后，只加成该槽对应类别的技能经验；各类槽可分别装备一个，可多槽同时生效。";
  box.appendChild(sub);

  var GROUPS = [
    { label:"\u88c5\u5907\u5de5\u7a0b", slots:["equipmentSpeed","equipmentYield"] },
    { label:"采矿", slots:["miningSpeed","miningYield"] },
    { label:"考古", slots:["archaeologySpeed","archaeologyRare"] },
    { label:"采气", slots:["gasSpeed","gasYield"] },
    { label:"冶炼", slots:["smeltSpeed","smeltYield"] },
    { label:"舰船工程", slots:["shipSpeed","shipYield"] },
    { label:"增幅剂制造", slots:["boosterSpeed","boosterYield"] }
  ];
  if (!isSkillOverdrive) {
    GROUPS.push({ label:"战斗", slots:["combatWeapon","combatRepair"] });
  }
  var active = (typeof getActiveBoosterState === "function") ? getActiveBoosterState(gameState) : {};

  function doEquip(slot, occupiedEntry) {
    overlay.remove();
    if (occupiedEntry) {
      showDangerConfirm("⚠ 替换增强剂",
        "<p class=\"dlg-body\">当前槽位已装载增强剂。替换后当前瓶剩余时间将作废，且不会返还。</p>",
        "确认替换",
        function() {
          var result = dispatchGameAction(gameState, { type:"booster/replace", slot:slot, itemId:itemId }, Date.now());
          if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
          else { showBoosterToast(result.reason || "替换失败", true); }
        });
    } else {
      var result = dispatchGameAction(gameState, { type:"booster/equip", slot:slot, itemId:itemId }, Date.now());
      if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
      else { showBoosterToast(result.reason || "装载失败", true); }
    }
  }

  for (var g = 0; g < GROUPS.length; g++) {
    var group = GROUPS[g];
    var gh = document.createElement("div");
    gh.style.cssText = "font-size:12px;color:#8a9aae;margin:10px 0 4px;";
    gh.textContent = group.label;
    box.appendChild(gh);
    for (var s = 0; s < group.slots.length; s++) {
      (function(slot) {
        var entry = active[slot];
        var occupied = !!(entry && entry.itemId);
        // 同类别已装神经（在其它槽）→ 该类别不能再装第二个神经，禁用
        var catBlocked = false;
        var cat = BOOSTER_SLOT_XP_SKILL[slot];
        for (var z = 0; z < BOOSTER_SLOTS.length; z++) {
          var zs = BOOSTER_SLOTS[z];
          if (zs === slot) continue;
          if (BOOSTER_SLOT_XP_SKILL[zs] !== cat) continue;
          var ze = active[zs];
          if (ze && ze.itemId) {
            var zi = (typeof getBoosterItem === "function") ? getBoosterItem(ze.itemId) : null;
            if (zi && zi.universal) { catBlocked = true; break; }
          }
        }
        var statusText;
        if (catBlocked) {
          statusText = "同类别已装神经";
        } else if (occupied) {
          var oi = (typeof getBoosterItem === "function") ? getBoosterItem(entry.itemId) : null;
          statusText = (oi ? oi.name : entry.itemId) + " · 已装载";
        } else {
          statusText = "空槽";
        }
        var row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 12px;margin-bottom:6px;background:#0f1a2a;border:1px solid #2a3a4a;border-radius:4px;" + (catBlocked ? "opacity:0.45;cursor:not-allowed;" : "cursor:pointer;");
        row.innerHTML = '<span>' + (BOOSTER_SLOT_FRIENDLY[slot] || slot) + '</span><span style="font-size:12px;color:' + (catBlocked ? "#8a9aae" : (occupied ? "#f0857b" : "#7dd3fc")) + ';">' + statusText + '</span>';
        if (!catBlocked) row.addEventListener("click", function() { doEquip(slot, occupied ? entry : null); });
        box.appendChild(row);
      })(group.slots[s]);
    }
  }
  var closeBtn = document.createElement("button");
  closeBtn.textContent = "取消";
  closeBtn.style.cssText = "margin-top:12px;padding:6px 16px;border-radius:4px;border:1px solid #3a5a6a;background:transparent;color:#8a9aae;cursor:pointer;width:100%;";
  closeBtn.addEventListener("click", function() { overlay.remove(); });
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

window.renderBoosterPage = renderBoosterPage;
window.showBoosterToast = showBoosterToast;
