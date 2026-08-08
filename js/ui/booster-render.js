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
    var statusLabel = recipe.isUnlocked ? (recipe.hasMaterials ? "可制造" : "材料不足") : ("Lv." + recipe.level + " 解锁");
    var statusClass = recipe.canManufacture ? "can-build" : "level-locked";
    return '<button class="equipeng-recipe-card' + (recipe.selected ? " selected" : "") + (recipe.isUnlocked ? "" : " locked") + '" data-booster-recipe="' + recipe.id + '"' + (recipe.isUnlocked ? "" : " disabled") + '>' +
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
    return '<div class="equipeng-material' + (row.enough ? " enough" : " short") + '"><span><i class="fa-solid fa-cubes-stacked"></i>' + row.displayName + '</span><strong>×' + row.required + '</strong><small>库存 ' + row.stock.toLocaleString() + '</small></div>';
  }).join("");
  var running = (display.isRunning && display.runningRecipeId && display.runningRecipeId !== recipe.id)
    ? '<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造其他配方 · 当前查看不会改变本次产物</div>'
    : (display.isRunning && display.runningRecipeId === recipe.id)
      ? '<div class="equipeng-running-note"><i class="fa-solid fa-gears"></i>正在制造：' + recipe.displayName + '</div>'
      : "";
  var lockNote = (!recipe.canManufacture && recipe.lockedReason)
    ? '<div class="equipeng-detail-section" style="color:#f0857b;">' + recipe.lockedReason + '</div>' : "";
  body.innerHTML = running +
    '<div class="equipeng-detail-section"><span class="equipeng-detail-label">效果</span><div class="equipeng-attribute-list"><span>' + recipe.effectText + '</span><span>每瓶持续 ' + recipe.durationSeconds + 's</span></div></div>' +
    '<div class="equipeng-detail-section"><span class="equipeng-detail-label">制造材料</span><div class="equipeng-material-list">' + materials + '</div></div>' +
    '<div class="equipeng-detail-section equipeng-manufacture-summary"><span>产出：' + recipe.displayName + ' ×1</span><span>单次耗时 ' + recipe.effectiveTime.toFixed(1) + 's（基础 ' + recipe.time + 's）</span><span>增强剂制造经验 +' + recipe.xp + '</span></div>' +
    lockNote;
}

/* ---- 已装载增强剂区域 ---- */
function renderBoosterEquippedArea(display) {
  var area = document.getElementById("booster-equipped-area");
  var countEl = document.getElementById("booster-equipped-count");
  if (!area) return;
  if (!display || !display.groups) {
    if (countEl) countEl.textContent = "0 槽";
    area.innerHTML = '<div class="equipeng-empty">暂无已装载增强剂</div>';
    return;
  }
  var totalSlots = 0;
  var filled = 0;
  for (var g = 0; g < display.groups.length; g++) {
    totalSlots += display.groups[g].slots.length;
    for (var s = 0; s < display.groups[g].slots.length; s++) {
      if (!display.groups[g].slots[s].empty) filled++;
    }
  }
  if (countEl) countEl.textContent = filled + " / " + totalSlots + " 槽";
  var html = "";
  for (var g = 0; g < display.groups.length; g++) {
    var group = display.groups[g];
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
          '<span class="equipeng-card-bottom"><span style="font-size:11px;">库存 ' + (slot.inventory || 0).toLocaleString() + '</span><button class="booster-unequip-btn" data-booster-slot="' + slot.slot + '" style="margin-left:6px;padding:2px 8px;border-radius:3px;border:1px solid #8a3a3a;background:#3a1a1a;color:#f0857b;font-size:11px;cursor:pointer;">卸下</button></span></div>';
      }
    }
    html += '<div style="margin-bottom:8px;"><div style="font-size:12px;color:#8a9aae;margin-bottom:4px;">' + group.label + '</div>' + slotCards + '</div>';
  }
  area.innerHTML = html || '<div class="equipeng-empty">暂无已装载增强剂</div>';
}

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
  if (typeof BOOSTER_ITEMS !== "undefined") {
    for (var key in BOOSTER_ITEMS) {
      var it = BOOSTER_ITEMS[key];
      if (it) itemSlots[it.itemId || it.id] = it.slot || "";
    }
  }
  grid.innerHTML = display.inventoryCards.map(function(card) {
    var slotName = itemSlots[card.itemId] || itemSlots[card.id] || "";
    return '<div class="equipeng-recipe-card" data-booster-item="' + (card.itemId || card.id) + '" data-booster-slot="' + slotName + '" style="cursor:pointer;" title="点击装载到对应槽位">' +
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
  renderBoosterEquippedArea(boosterDisplay);
  var row = document.getElementById("booster-progress-row"); if (row) row.style.display = display.isRunning ? "" : "none";
  if (typeof drawSkillBar === "function") drawSkillBar(document.getElementById("bar-booster"), display.progress.percent, "purple");
  var eta = document.getElementById("booster-eta"); if (eta) eta.textContent = display.progress.etaText;
  var status = document.getElementById("booster-status-text"); if (status) status.textContent = display.statusText;
  var start = document.getElementById("btn-start-booster"); if (start) { start.style.display = display.isRunning ? "none" : ""; start.disabled = !display.canStart; }
  var stop = document.getElementById("btn-stop-booster"); if (stop) stop.style.display = display.isRunning ? "" : "none";
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
        if (!confirm("确定卸下该增强剂？当前瓶剩余时间将作废，且不会返还。")) return;
        var result = dispatchGameAction(gameState, { type:"booster/unequip", slot:slot }, Date.now());
        if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
        else { showBoosterToast(result.reason || "卸下失败", true); }
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
      // 如果有多选，让用户选择
      if (compatibleItems.length === 1) {
        var item = compatibleItems[0];
        if (item.inv <= 0) { showBoosterToast("库存不足", true); return; }
        if (existing) {
          if (!confirm("当前槽位已装载增强剂。替换后当前瓶剩余时间将作废，且不会返还。")) return;
          var result = dispatchGameAction(gameState, { type:"booster/replace", slot:slot, itemId:item.id }, Date.now());
          if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
          else { showBoosterToast(result.reason || "替换失败", true); }
        } else {
          var result = dispatchGameAction(gameState, { type:"booster/equip", slot:slot, itemId:item.id }, Date.now());
          if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
          else { showBoosterToast(result.reason || "装载失败", true); }
        }
      } else {
        // 多选：弹出选择界面
        showBoosterSlotPicker(slot, compatibleItems, existing);
      }
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
      if (!itemId || !slot) return;
      // 检查库存
      var inv = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, itemId) : 0;
      if (!(inv >= 1)) { showBoosterToast("库存不足，无法装载", true); return; }
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
        if (!confirm("替换后当前瓶剩余时间将作废，且不会返还。")) return;
        var result = dispatchGameAction(gameState, { type:"booster/replace", slot:slot, itemId:itemId }, Date.now());
        if (result.changed) { renderBoosterPage(); if (typeof updateUI === "function") updateUI(); }
        else { showBoosterToast(result.reason || "替换失败", true); }
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
    if (item.slot !== slot) continue;
    // 同系列冲突检查
    var conflict = false;
    for (var s = 0; s < BOOSTER_SLOTS.length; s++) {
      var e = active[BOOSTER_SLOTS[s]];
      if (!e || BOOSTER_SLOTS[s] === slot) continue;
      var existingItem = (typeof getBoosterItem === "function") ? getBoosterItem(e.itemId) : null;
      if (existingItem && existingItem.series === item.series) { conflict = true; break; }
    }
    if (conflict) continue;
    result.push({ id:item.itemId, name:item.name, quality:item.quality, qualityName:item.qualityName, effectText:(typeof describeBoosterEffect === "function") ? describeBoosterEffect(item.effectType, item.effectValue) : "", inv:qty });
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

window.renderBoosterPage = renderBoosterPage;
window.showBoosterToast = showBoosterToast;
