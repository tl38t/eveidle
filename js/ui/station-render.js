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
    else renderStationPage(Date.now());
  });

  document.getElementById("btn-station-refill").addEventListener("click", function() {
    var r = dispatchGameAction(gameState, { type:"station/refillMaintenance" }, Date.now());
    if (!r.changed) showToast("补给失败：" + (r.reason || "未知错误"));
    else renderStationPage(Date.now());
  });

  // 事件委托（绑定一次，幂等）：容器是 index.html 静态节点，innerHTML 替换不影响委托，
  // 因此 live updater 可安全重建子节点而不会产生监听器增长或重复绑定。
  var alDiv = document.getElementById("station-auto-lines");
  if (alDiv && !alDiv._stationDelegated) {
    alDiv._stationDelegated = true;
    alDiv.addEventListener("change", function(e) {
      var sel = e.target.closest("select[data-line]");
      if (!sel) return;
      var r = dispatchGameAction(gameState, { type:"station/selectAutoLineTarget", lineId:sel.getAttribute("data-line"), targetId:sel.value }, Date.now());
      if (!r.changed) { showToast("选择目标失败：" + (r.reason || "未知错误")); return; }
      // 轻量即时刷新（不重建下拉框，避免打断焦点）；selectedTargetId 不进结构签名，不会触发整页。
      liveUpdateStationFields(getStationPageDisplayState(gameState, Date.now()), Date.now());
    });
    alDiv.addEventListener("click", function(e) {
      var btn = e.target.closest("button[data-line]");
      if (!btn) return;
      var lineId = btn.getAttribute("data-line");
      if (btn.classList.contains("al-start")) {
        var r = dispatchGameAction(gameState, { type:"station/startAutoLine", lineId:lineId }, Date.now());
        if (!r.changed) { showToast("启动失败：" + (r.reason || "未知错误")); return; }
      } else if (btn.classList.contains("al-stop")) {
        var r2 = dispatchGameAction(gameState, { type:"station/stopAutoLine", lineId:lineId }, Date.now());
        if (!r2.changed) { showToast("停止失败：" + (r.reason || "未知错误")); return; }
      }
      // 动作成功后立即整页渲染（结构性变化：启停 / 目标改变）
      renderStationPage(Date.now());
    });
  }
  var grid = document.getElementById("station-buildings-grid");
  if (grid && !grid._stationDelegated) {
    grid._stationDelegated = true;
    grid.addEventListener("click", function(e) {
      var btn = e.target.closest("button[data-building]");
      if (!btn) return;
      var bid = btn.getAttribute("data-building");
      var r = dispatchGameAction(gameState, { type:"station/startBuildingConstruction", buildingId:bid }, Date.now());
      if (!r.changed) showToast("升级失败：" + (r.reason || "未知错误"));
      else renderStationPage(Date.now());
    });
  }
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
  // Bug4：附属建筑「作用说明」——解释每座建筑在空间站体系里的职责（静态文案）。
  var STATION_BUILDING_PURPOSE = {
    resource_dispatch: "你采矿 / 采集气体时，空间站按开采次数累计计数；达到「勘探指令阈值」后自动下达勘探指令，额外产出一批资源（只增资源、不加经验）。本建筑降低该阈值，让你更频繁吃到这笔额外产出。",
    planetary_control: "自动收取行星开发产物，并增加行星开发可同时进行的槽位。",
    smelting_refinery: "提升冶炼自动线的产出倍率，让无人值守的矿石冶炼更快。",
    equipment_factory: "提升装备自动线的产出倍率，让无人值守的装备制造更快。",
    booster_factory: "提升增强剂自动线的产出倍率，让无人值守的增强剂制造更快。",
    archaeology_lab: "提升考古独特文物的产出倍率，让遗迹勘测更有回报。",
    combat_command: "提升战斗经验获取速度，让练级更高效。",
    shipyard: "加快舰船建造与强化速度，并节省相应资源；断油也保持生效。"
  };
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
      var purposeHtml = STATION_BUILDING_PURPOSE[b.buildingId]
        ? '<div class="sbc-purpose">' + STATION_BUILDING_PURPOSE[b.buildingId] + '</div>'
        : '';
      return '<div class="station-building-card"><div class="sbc-header"><strong>' + (b.name || b.buildingId) + '</strong> Lv.' + (b.level || 0) + '</div>' +
        '<div class="sbc-effect">' + (b.effectText || "") + '</div>' +
        purposeHtml +
        (b.nextEffectText ? '<div class="sbc-next">' + b.nextEffectText + '</div>' : '') +
        (costHtml ? '<div class="sbc-cost">' + costHtml + '</div>' : '') +
        '<button class="btn sm sbc-upgrade" id="bld-upgrade-' + b.buildingId + '" data-building="' + b.buildingId + '"' + ((b.canUpgrade && !b.isConstructingThis) ? '' : ' disabled') + '>' +
        (b.isConstructingThis ? '建设中' : (bt || '升级')) + '</button></div>';
    }).join("");
    // 升级按钮点击已通过 #station-buildings-grid 的事件委托统一处理（initStationUI），不在此重复绑定。
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
      // 只显示正式中文名称：未选择时显示"未选择"，查不到配方时显示态已给出"未知配方"。
      // 绝不回退 selectedTargetId/startedTargetId，避免内部 recipeId 泄漏到界面。
      var selName = al.selectedTargetName || "未选择";
      var startName = al.startedTargetName || "";
      return '<div class="station-al-card" id="al-card-' + al.lineId + '"><div class="sal-header"><strong>' + (al.name || al.lineId) + '</strong></div>' +
        '<div class="sal-mult">建筑 ×' + al.buildingMultiplier.toFixed(2) + ' · 后勤 ×' + al.logisticsMultiplier.toFixed(2) + ' · 综合 ×' + al.effectiveMultiplier.toFixed(2) + '</div>' +
        '<div class="sal-select"><select data-line="' + al.lineId + '" class="u-select">' + opts + '</select></div>' +
        '<div class="sal-targets" id="al-targets-' + al.lineId + '">选中：' + selName + (startName ? ' · 运行：' + startName : '') + '</div>' +
        '<div class="sal-status" id="al-status-' + al.lineId + '">状态：' + statAl + '</div>' +
        (al.cycleDurationMs ? '<div class="al-progress-wrap"><div class="progress-bar"><div class="fill al-fill" id="al-fill-' + al.lineId + '" style="width:' + (al.progressRatio * 100).toFixed(0) + '%"></div></div><div class="sal-progress" id="al-progress-' + al.lineId + '">周期 ' + (al.cycleDurationMs / 1000).toFixed(1) + 's · 进度 ' + (al.progressRatio * 100).toFixed(0) + '%</div></div>' : '') +
        '<button class="btn sm al-start" id="al-start-' + al.lineId + '" data-line="' + al.lineId + '"' + (al.canStart ? '' : ' disabled') + '>' + (al.running ? '已启动' : '启动') + '</button>' +
        '<button class="btn sm al-stop" id="al-stop-' + al.lineId + '" data-line="' + al.lineId + '"' + (al.canStop ? '' : ' disabled') + '>停止</button></div>';
    }).join("");

    // 自动线 select/按钮的点击与 change 已通过 #station-auto-lines 的事件委托统一处理（initStationUI），不在此重复绑定。
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
  // 同步结构签名：用于 live updater 判断是否需要整页重渲染（节流时间戳/签名均不进 gameState/存档）。
  _stationSig = computeStationSig(display);
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

/* ================================================================
   实时刷新（live updater）：只读 getStationPageDisplayState 写 DOM，
   不推进游戏状态、不写 gameState、不触发整页重建（除非结构签名变化）。
   节流时间戳与结构签名均为模块级变量，绝不进入 gameState / 存档。
   ================================================================ */

var _stationSig = "";
var _stationLastLive = 0;

// 结构签名：覆盖所有"随真实结算/动作变化、需要整页重建"的字段。
// 注意：selectedTargetId 不进签名（避免下拉框在普通 tick 中被重建、丢失焦点/值）。
function computeStationSig(display) {
  if (!display) return "";
  var parts = [];
  var body = display.body || {};
  parts.push("B:" + (body.bodyLevel || 0) + ":" + (body.currentConstruction ? "C" : "-") + ":" + (body.canStart ? "S" : "-") + ":" + (body.blockedReason || "-") + ":" + (body.nextName || "-"));
  (display.buildings || []).forEach(function(b) {
    parts.push("BL:" + b.buildingId + ":" + (b.level || 0) + (b.isConstructingThis ? ":C" : "") + (b.canUpgrade ? ":U" : "") + ":" + (b.blockedReason || "-"));
  });
  (display.autoLines || []).forEach(function(al) {
    parts.push("AL:" + al.lineId + ":" + (al.running ? "R" : "-") + ":" + (al.startedTargetId || "-") + ":" + (al.stoppedReason || "-") + (al.canStart ? ":S" : "") + (al.canStop ? ":T" : ""));
  });
  parts.push("M:" + (display.maintenance && display.maintenance.operational ? "O" : "F"));
  return parts.join("|");
}

// 统一实时入口（由 updateLiveUI 每秒按 currentPage==="station" 调用）。
// 节流仅作用于「轻量字段刷新」分支；结构签名一旦变化必须无条件立即整页重渲染，
// 否则建造完成/自动线启停等结构变化在节流窗口内被漏渲染，玩家须手动切页才看得到更新。
function updateStationLiveUI(now) {
  var t = Number(now) || Date.now();
  var display = getStationPageDisplayState(gameState, t);
  var sig = computeStationSig(display);
  if (sig !== _stationSig) {
    // 结构性变化（建造完成、自动线启停/目标改变、维护断油等）→ 整页渲染。
    renderStationPage(t);
    _stationLastLive = t;
    return;
  }
  // 非结构变化：仅轻量更新随时间变化的字段；节流避免每秒多次无谓重写 DOM。
  if (t - _stationLastLive < 1000) return;
  _stationLastLive = t;
  liveUpdateStationFields(display, t);
}

// 轻量只读刷新：只更新 textContent / 进度条 width / disabled / 按钮文字，绝不重建子节点、不写 gameState。
function liveUpdateStationFields(display, now) {
  var t = Number(now) || Date.now();
  display = display || getStationPageDisplayState(gameState, t);

  // ---- 建设倒计时 + 进度条（随时间变化）----
  var pFill = document.getElementById("station-construction-fill");
  var pText = document.getElementById("station-construction-text");
  var upBtn = document.getElementById("btn-station-upgrade-body");
  if (display.body.currentConstruction) {
    var totalMs = (display.body.currentConstruction.durationMs || 1);
    var pct = Math.min(100, Math.max(0, (1 - (display.body.remainingMs || 0) / totalMs) * 100));
    if (pFill) setLiveWidth(pFill, pct.toFixed(2) + "%");
    if (pText) setLiveText(pText, "建设中 · 剩余 " + fmtDuration(display.body.remainingMs || 0));
    if (upBtn) { setLiveDisabled(upBtn, true); setLiveText(upBtn, "建设中"); }
  } else {
    if (pFill) setLiveWidth(pFill, "0%");
    if (pText) setLiveText(pText, display.body.canStart ? "就绪" : (display.body.blockedText || "已满级"));
    if (upBtn) {
      if (display.body.blockedReason === "max-level") { setLiveDisabled(upBtn, true); setLiveText(upBtn, "已满级"); }
      else { setLiveDisabled(upBtn, !display.body.canStart); setLiveText(upBtn, "升级至 " + (display.body.nextName || "")); }
    }
  }

  // ---- 维护（燃料剩余随时间变化）----
  setLiveText(document.getElementById("station-maintenance-points"), (display.maintenance.maintenancePoints || 0));
  setLiveText(document.getElementById("station-fuel-remaining"), (display.maintenance.fuelRemaining || 0).toLocaleString());
  setLiveText(document.getElementById("station-fuel-remaining-ms"), display.maintenance.remainingText || "-");
  var refBtn = document.getElementById("btn-station-refill");
  if (refBtn) { setLiveDisabled(refBtn, !display.maintenance.canRefill); setLiveText(refBtn, display.maintenance.canRefill ? "一键补给" : (display.maintenance.blockedText || "无需补给")); }

  // 总览状态（运行中 / 燃料不足 / 未建立）
  var statusEl = document.getElementById("station-status");
  if (statusEl) {
    var st = (!display.body.bodyLevel || display.body.bodyLevel === 0) ? "未建立" : (!display.maintenance.operational ? "燃料不足" : "运行中");
    setLiveText(statusEl, st);
  }

  // ---- 建筑（等级/在建为结构态；此处仅同步按钮 disabled 与文字，绝不重建，避免丢焦点）----
  (display.buildings || []).forEach(function(b) {
    var btn = document.getElementById("bld-upgrade-" + b.buildingId);
    if (btn) {
      setLiveDisabled(btn, !(b.canUpgrade && !b.isConstructingThis));
      setLiveText(btn, b.isConstructingThis ? "建设中" : (b.blockedText || blockReasonText(b.blockedReason) || "升级"));
    }
  });

  // ---- 自动线（状态/进度/按钮随时间变化；select 不重建，焦点/值安全）----
  (display.autoLines || []).forEach(function(al) {
    var statEl = document.getElementById("al-status-" + al.lineId);
    if (statEl) {
      var st = al.running ? "运行中" : (al.stoppedText || "已停止");
      if (al.stoppedReason === "insufficient-materials") st = "材料不足";
      else if (al.stoppedReason === "user-stopped") st = "已停止";
      setLiveText(statEl, "状态：" + st);
    }
    var tgtEl = document.getElementById("al-targets-" + al.lineId);
    if (tgtEl) {
      var selName = al.selectedTargetName || "未选择";
      var startName = al.startedTargetName || "";
      setLiveText(tgtEl, "选中：" + selName + (startName ? " · 运行：" + startName : ""));
    }
    var progEl = document.getElementById("al-progress-" + al.lineId);
    if (progEl) {
      if (al.cycleDurationMs) setLiveText(progEl, "周期 " + (al.cycleDurationMs / 1000).toFixed(1) + "s · 进度 " + (al.progressRatio * 100).toFixed(0) + "%");
      else progEl.textContent = "";
    }
    var fillEl = document.getElementById("al-fill-" + al.lineId);
    if (fillEl) setLiveWidth(fillEl, (al.progressRatio * 100).toFixed(0) + "%");
    var startBtn = document.getElementById("al-start-" + al.lineId);
    if (startBtn) { setLiveDisabled(startBtn, !al.canStart); setLiveText(startBtn, al.running ? "已启动" : "启动"); }
    var stopBtn = document.getElementById("al-stop-" + al.lineId);
    if (stopBtn) { setLiveDisabled(stopBtn, !al.canStop); }
  });
}
