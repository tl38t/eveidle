/* ================================================================
   空间站 UI 渲染（Phase 3C-8 v2）
   所有状态来自 getStationPageDisplayState，不直接操作 gameState。
   按钮走 dispatchGameAction，绑定一次不重复。
   ================================================================ */

var StationUI = { initDone: false };

function initStationUI() {
  if (StationUI.initDone) return;
  StationUI.initDone = true;

  document.getElementById("btn-station-upgrade-body").addEventListener("click", function() {
    var r = dispatchGameAction(gameState, { type:"station/startBodyConstruction" }, Date.now());
    if (!r.changed) showToast("升级失败：" + (r.reason || "未知错误"));
    else { updateUI(); refreshVisiblePanelAfterAction(); }
  });

  document.getElementById("btn-station-refill").addEventListener("click", function() {
    var r = dispatchGameAction(gameState, { type:"station/refillMaintenance" }, Date.now());
    if (!r.changed) showToast("补给失败：" + (r.reason || "未知错误"));
    else { updateUI(); refreshVisiblePanelAfterAction(); }
  });
}

function renderStationPage(now) {
  if (!StationUI.initDone) initStationUI();
  var display = getStationPageDisplayState(gameState, Number(now) || Date.now());

  // ---- A. 总览 ----
  setText("station-body-name", display.body.bodyName || "未建立");
  setText("station-body-level", "Lv." + (display.body.bodyLevel || 0));
  var lm = display.logistics.multiplier || 1;
  setText("station-logistics-summary",
    display.logistics.bodyLevel > 0 && display.logistics.operational
      ? "综合后勤：×" + lm.toFixed(2) + "（" + (display.logistics.text || "") + "）"
      : "综合后勤：×" + lm.toFixed(2) + "（" + (display.logistics.text || "未建立") + "）");
  if (!display.body.bodyLevel || display.body.bodyLevel === 0) setText("station-status", "未建立");
  else if (!display.maintenance.operational) setText("station-status", "燃料不足");
  else setText("station-status", "运行中");

  // 建设进度
  var pFill = document.getElementById("station-construction-fill");
  var pText = document.getElementById("station-construction-text");
  var upBtn = document.getElementById("btn-station-upgrade-body");
  if (display.body.currentConstruction) {
    var totalMs = display.body.currentConstruction.durationMs || 1;
    var pct = Math.min(100, Math.max(0, (1 - (display.body.remainingMs || 0) / totalMs) * 100));
    if (pFill) pFill.style.width = pct + "%";
    if (pText) {
      var rem = display.body.remainingMs || 0;
      pText.textContent = "建设中 · 剩余 " + fmtDuration(rem);
    }
    if (upBtn) { upBtn.disabled = true; upBtn.textContent = "建设中"; }
  } else {
    if (pFill) pFill.style.width = "0%";
    if (pText) pText.textContent = display.body.canStart ? "就绪" : (display.body.blockedText || "已满级");
    if (upBtn) {
      if (display.body.blockedReason === "max-level") { upBtn.disabled = true; upBtn.textContent = "已满级"; }
      else { upBtn.disabled = !display.body.canStart; upBtn.textContent = "升级至 " + (display.body.nextName || ""); }
    }
  }

  // 建设成本
  var costEl = document.getElementById("station-upgrade-cost");
  if (costEl) {
    if (display.body.nextCostRows && display.body.nextCostRows.length) {
      costEl.innerHTML = display.body.nextCostRows.map(function(r) {
        return '<span class="' + (r.enough ? "cost-enough" : "cost-short") + '">' + r.displayName + ' ×' + r.quantity + ' <small>（持有 ' + r.have + '）</small></span>';
      }).join(" · ") + ' · 时间 ' + fmtDuration(display.body.durationMs);
    } else costEl.textContent = "";
  }

  // ---- B. 维护 ----
  setText("station-maintenance-points", (display.maintenance.maintenancePoints || 0));
  setText("station-fuel-remaining", (display.maintenance.fuelRemaining || 0).toLocaleString());
  setText("station-fuel-remaining-ms", display.maintenance.remainingText || "-");
  var refBtn = document.getElementById("btn-station-refill");
  if (refBtn) {
    refBtn.disabled = !display.maintenance.canRefill;
    refBtn.textContent = display.maintenance.canRefill ? "一键补给" : (display.maintenance.blockedText || "无需补给");
  }

  // ---- C. 建筑 ----
  var grid = document.getElementById("station-buildings-grid");
  if (grid) {
    grid.innerHTML = display.buildings.map(function(b) {
      var bt = b.blockedText || blockReasonText(b.blockedReason);
      var costHtml = "";
      if (b.nextCostRows && b.nextCostRows.length) {
        costHtml = b.nextCostRows.map(function(r) {
          return '<span class="' + (r.enough ? "cost-enough" : "cost-short") + '">' + r.displayName + ' ×' + r.quantity + ' <small>（' + r.have + '）</small></span>';
        }).join(" · ");
        if (b.durationMs) costHtml += ' · ' + fmtDuration(b.durationMs);
      }
      return '<div class="station-building-card"><div class="sbc-header"><strong>' + (b.name || b.buildingId) + '</strong> Lv.' + (b.level || 0) + '</div>' +
        '<div class="sbc-effect">' + (b.effectText || "") + '</div>' +
        (b.nextEffectText ? '<div class="sbc-next">' + b.nextEffectText + '</div>' : '') +
        (costHtml ? '<div class="sbc-cost">' + costHtml + '</div>' : '') +
        '<button class="btn small sbc-upgrade" data-building="' + b.buildingId + '"' + ((b.canUpgrade && !b.isConstructingThis) ? '' : ' disabled') + '>' +
        (b.isConstructingThis ? '建设中' : (bt || '升级')) + '</button></div>';
    }).join("");
    // 绑定升级按钮
    grid.querySelectorAll(".sbc-upgrade").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var bid = btn.getAttribute("data-building");
        var r = dispatchGameAction(gameState, { type:"station/startBuildingConstruction", buildingId:bid }, Date.now());
        if (!r.changed) showToast("升级失败：" + (r.reason || "未知错误"));
        else { updateUI(); refreshVisiblePanelAfterAction(); }
      });
    });
  }

  // ---- D. 自动线 ----
  var alDiv = document.getElementById("station-auto-lines");
  if (alDiv) {
    alDiv.innerHTML = display.autoLines.map(function(al) {
      var opts = al.targetOptions.map(function(t) {
        var sel = t.id === al.selectedTargetId ? " selected" : "";
        return '<option value="' + t.id + '"' + sel + '>' + t.name + '</option>';
      }).join("");
      var statAl = al.running ? "运行中" : (al.stoppedText || "已停止");
      if (al.stoppedReason === "insufficient-materials") statAl = "材料不足";
      if (al.stoppedReason === "user-stopped") statAl = "已停止";
      var selName = al.selectedTargetName || al.selectedTargetId || "未选择";
      var startName = al.startedTargetName || al.startedTargetId || "";
      return '<div class="station-al-card"><div class="sal-header"><strong>' + (al.name || al.lineId) + '</strong></div>' +
        '<div class="sal-mult">建筑 ×' + al.buildingMultiplier.toFixed(2) + ' · 后勤 ×' + al.logisticsMultiplier.toFixed(2) + ' · 综合 ×' + al.effectiveMultiplier.toFixed(2) + '</div>' +
        '<div class="sal-select"><select data-line="' + al.lineId + '">' + opts + '</select></div>' +
        '<div class="sal-targets">选中：' + selName + (startName ? ' · 运行：' + startName : '') + '</div>' +
        '<div class="sal-status">状态：' + statAl + '</div>' +
        (al.cycleDurationMs ? '<div class="sal-progress">周期 ' + (al.cycleDurationMs / 1000).toFixed(1) + 's · 进度 ' + (al.progressRatio * 100).toFixed(0) + '%</div>' : '') +
        '<button class="btn small al-start" data-line="' + al.lineId + '"' + (al.canStart ? '' : ' disabled') + '>' + (al.running ? '已启动' : '启动') + '</button>' +
        '<button class="btn small al-stop" data-line="' + al.lineId + '"' + (al.canStop ? '' : ' disabled') + '>停止</button></div>';
    }).join("");

    alDiv.querySelectorAll("select[data-line]").forEach(function(sel) {
      sel.addEventListener("change", function() {
        var r = dispatchGameAction(gameState, { type:"station/selectAutoLineTarget", lineId:sel.getAttribute("data-line"), targetId:sel.value }, Date.now());
        if (!r.changed) showToast("选择目标失败：" + (r.reason || "未知错误"));
        else updateUI();
      });
    });
    alDiv.querySelectorAll(".al-start").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var r = dispatchGameAction(gameState, { type:"station/startAutoLine", lineId:btn.getAttribute("data-line") }, Date.now());
        if (!r.changed) { showToast("启动失败：" + (r.reason || "未知错误")); return; }
        updateUI(); refreshVisiblePanelAfterAction();
      });
    });
    alDiv.querySelectorAll(".al-stop").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var r = dispatchGameAction(gameState, { type:"station/stopAutoLine", lineId:btn.getAttribute("data-line") }, Date.now());
        if (!r.changed) showToast("停止失败：" + (r.reason || "未知错误"));
        else updateUI();
      });
    });
  }

  // ---- E. 效果 ----
  var effEl = document.getElementById("station-effects-list");
  if (effEl) {
    effEl.innerHTML = display.effects.map(function(e) {
      var cls = e.shipyardException ? " effect-shipyard-exception" : (e.active ? " effect-active" : " effect-inactive");
      var tag = e.shipyardException ? " · 断油仍生效" : (!e.active && e.disabledReason ? " · " + e.disabledReason : "");
      return '<div class="station-effect-line' + cls + '">' + e.text + tag + '</div>';
    }).join("");
  }

  // ---- F. 军团 ----
  setText("station-corp-name", display.corporation.name || "未成立");
  if (display.corporation.foundedAt) setText("station-corp-founded", new Date(display.corporation.foundedAt).toLocaleDateString());
  else setText("station-corp-founded", "-");
  setText("station-corp-dlc", display.corporation.statusText || "DLC 预留");
}

function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }

function blockReasonText(reason) {
  if (!reason) return "";
  var m = { "construction-in-progress":"已有建设项目进行中", "body-level-cap":"不能超过本体等级", "max-level":"已满级", "insufficient-isk":"星币不足", "insufficient-materials":"材料不足", "unknown-building":"未知建筑" };
  return m[reason] || reason;
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  var sec = Math.ceil(ms / 1000);
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  return [h ? h + "h" : "", m ? m + "m" : "", s + "s"].filter(Boolean).join(" ");
}
