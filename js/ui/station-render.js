/* ================================================================
   空间站 UI 渲染（Phase 3C-8 v2）
   所有状态来自 getStationPageDisplayState，不直接操作 gameState。
   按钮走 dispatchGameAction，绑定一次不重复。
   ================================================================ */

var StationUI = { initDone: false };

// 升级/建造材料成本网格：材料(左) | 需要(右) | 持有(右) 三列对齐；可选表头与耗时行。
function renderStationCostGrid(rows, opts) {
  opts = opts || {};
  if (!rows || !rows.length) return "";
  var html = "";
  if (opts.header) {
    html += '<span class="c-th">材料</span><span class="c-th c-tr">需要</span><span class="c-th c-tr">持有</span>';
  }
  var haveLabel = !opts.header; // 无表头时保留「持有」字样以免歧义
  html += rows.map(function(r) {
    var cls = r.enough ? "cost-enough" : "cost-short";
    var have = haveLabel ? ("持有 " + r.have) : ("" + r.have);
    return '<span class="c-name ' + cls + '">' + r.displayName + '</span>' +
           '<span class="c-need ' + cls + '">×' + r.quantity + '</span>' +
           '<span class="c-have ' + cls + '">' + have + '</span>';
  }).join("");
  if (opts.durationMs) {
    html += '<span class="c-dur">⏱ 耗时 ' + fmtDuration(opts.durationMs) + '</span>';
  }
  return html;
}

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
    if (!r.changed) {
      var msg;
      switch (r.reason) {
        case "maintenance-not-needed": msg = "燃料还充足，暂无需补给（剩余不足 24 小时时才开放）。"; break;
        case "insufficient-fuel": msg = "仓库燃料单元不足，无法补给（需 " + (r.fuelCost || 0) + "，持有 " + (r.fuelStock || 0) + "）。"; break;
        case "station-not-built": msg = "空间站尚未建立，无法补给。"; break;
        case "no-station": msg = "空间站不可用，无法补给。"; break;
        default: msg = "补给失败：" + (r.reason || "未知错误");
      }
      showToast(msg);
    } else renderStationPage(Date.now());
  });

  // 事件委托（绑定一次，幂等）：容器是 index.html 静态节点，innerHTML 替换不影响委托，
  // 因此 live updater 可安全重建子节点而不会产生监听器增长或重复绑定。
  var alDiv = document.getElementById("station-auto-lines");
  if (alDiv && !alDiv._stationDelegated) {
    alDiv._stationDelegated = true;
    alDiv.addEventListener("change", function(e) {
      var qty = e.target.closest("input[data-al-qty]");
      if (qty) {
        var r2 = dispatchGameAction(gameState, { type:"station/setAutoLineQuantity", lineId:qty.getAttribute("data-al-qty"), quantity:qty.value }, Date.now());
        if (!r2.changed) { showToast("设置生产数量失败：" + (r2.reason || "未知错误")); return; }
        renderStationPage(Date.now());
        return;
      }
      var sel = e.target.closest("select[data-line]");
      if (!sel) return;
      var r = dispatchGameAction(gameState, { type:"station/selectAutoLineTarget", lineId:sel.getAttribute("data-line"), targetId:sel.value }, Date.now());
      if (!r.changed) { showToast("选择目标失败：" + (r.reason || "未知错误")); return; }
      // 轻量即时刷新（不重建下拉框，避免打断焦点）；selectedTargetId 不进结构签名，不会触发整页。
      liveUpdateStationFields(getStationPageDisplayState(gameState, Date.now()), Date.now());
    });
    // 输入框实时写入（每次按键即写 state，比依赖 change/失焦更及时，移动端也可靠）：
    // 未启动时即时刷新「目标：X 件」文案，避免「填了数却看不到生效」的困惑。
    alDiv.addEventListener("input", function(e) {
      var qty = e.target.closest("input[data-al-qty]");
      if (!qty) return;
      var r = dispatchGameAction(gameState, { type:"station/setAutoLineQuantity", lineId:qty.getAttribute("data-al-qty"), quantity:Number(qty.value) }, Date.now());
      if (!r.changed && r.reason && r.reason !== "no-state" && r.reason !== "unknown-line") {
        showToast("设置生产数量失败：" + (r.reason || "未知错误"));
      }
      liveUpdateStationFields(getStationPageDisplayState(gameState, Date.now()), Date.now());
    });
    alDiv.addEventListener("click", function(e) {
      var btn = e.target.closest("button[data-line]");
      if (!btn) return;
      var lineId = btn.getAttribute("data-line");
      if (btn.classList.contains("al-start")) {
        // 启动前先把该线输入框的当前值抓进 state（兜底）：避免「直接在输入框填数后点启动、
        // 而 input 的 change 事件未及时触发」导致目标数量丢失、仍以无限模式运行。
        var qInput = alDiv.querySelector('input[data-al-qty="' + lineId + '"]');
        if (qInput) {
          var r0 = dispatchGameAction(gameState, { type:"station/setAutoLineQuantity", lineId:lineId, quantity:Number(qInput.value) }, Date.now());
          if (!r0.changed && r0.reason && r0.reason !== "no-state" && r0.reason !== "unknown-line") {
            showToast("设置生产数量失败：" + (r0.reason || "未知错误"));
          }
        }
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


  // —— 军团 DLC：事件委托交给独立模块（绑定幂等；模块缺失不影响主内容）——
  if (typeof LegionEvents !== "undefined" && LegionEvents.bind) LegionEvents.bind();

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

  var allianceBonusRate = Number(display.logistics.allianceBonusRate) || 0;
  if (allianceBonusRate > 0) {
    var logisticsSummaryEl = document.getElementById("station-logistics-summary");
    if (logisticsSummaryEl) logisticsSummaryEl.textContent += "（联盟人数+" + allianceBonusRate.toFixed(2) + "）";
  }

  updateStationOpsSummary(display);

  // 军团入口卡（空间站页底部）：激活/锁定态随存档进度变化，整页渲染时同步刷新。
  if (typeof LegionRender !== "undefined" && LegionRender.renderLegionEntry) LegionRender.renderLegionEntry(now);

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
      costEl.innerHTML = renderStationCostGrid(display.body.nextCostRows, { header: true, durationMs: display.body.durationMs });
    } else costEl.textContent = "";
  }

  // 升级预览备注（如 Lv.4 解锁军团议事大厅）
  var noteEl = document.getElementById("station-upgrade-note");
  if (noteEl) {
    var note = (display.body.nextDesc && !display.body.currentConstruction) ? display.body.nextDesc : "";
    noteEl.textContent = note;
    noteEl.style.display = note ? "" : "none";
  }

  // ---- B. 维护 ----
  setText("station-maintenance-points", (display.maintenance.maintenancePoints || 0));
  setText("station-fuel-remaining", (display.maintenance.fuelRemaining || 0).toLocaleString());
  setText("station-fuel-remaining-ms", display.maintenance.remainingText || "-");
  var mInfo = display.maintenance;
  var refBtn = document.getElementById("btn-station-refill");
  var infoEl = document.getElementById("station-refill-info");
  // 不可用时的友好原因（替代原“无需补给”技术感文案）
  var blockedHint = "";
  if (!mInfo.canRefill) {
    if (mInfo.blockedReason === "maintenance-not-needed") {
      blockedHint = "燃料还充足（剩余约 " + (mInfo.remainingText || "-") + "），不足 24 小时时才开放补给。";
    } else if (mInfo.blockedReason === "station-not-built" || mInfo.blockedReason === "no-station") {
      blockedHint = "空间站尚未建立，无法补给。";
    } else {
      blockedHint = "当前无法补给。";
    }
  }
  // 仓库燃料是否够本次补给（避免点了才报“仓库不足”）
  var needFuel = Number(mInfo.refillFuelCost) || 0;
  var haveFuel = Number(mInfo.warehouseFuel) || 0;
  var stockShort = mInfo.canRefill && needFuel > haveFuel;
  if (refBtn) {
    if (stockShort) {
      refBtn.disabled = true;
      refBtn.textContent = "仓库燃料不足";
    } else if (mInfo.canRefill) {
      refBtn.disabled = false;
      refBtn.textContent = "一键补给（需 " + needFuel.toLocaleString() + "）";
    } else {
      refBtn.disabled = true;
      refBtn.textContent = "无需补给";
    }
  }
  if (infoEl) {
    if (stockShort) {
      infoEl.className = "station-refill-info warn";
      infoEl.textContent = "本次补给需 " + needFuel.toLocaleString() + " 燃料，但仓库仅 " + haveFuel.toLocaleString() +
        "（仓库 › 消耗品 › 燃料单元）。请先制造或获取燃料后再补给。";
    } else if (mInfo.canRefill) {
      infoEl.className = "station-refill-info ok";
      infoEl.textContent = "本次补给需 " + needFuel.toLocaleString() + " 燃料（仓库持有 " + haveFuel.toLocaleString() + "），补给后约可维持一周。";
    } else {
      infoEl.className = "station-refill-info";
      infoEl.textContent = blockedHint;
    }
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
        costHtml = renderStationCostGrid(b.nextCostRows, { durationMs: b.durationMs });
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
  // 仅在「可选项集合」变化时重建 select（选项集只随建筑解锁 / 蓝图购买变化，与运行态 / 资源 / 燃料无关）。
  // 运行态、进度、启停按钮、倍率由 liveUpdateStationFields 每秒轻量同步，不再整段重建，
  // 避免无关结构变化（本体升级变可负担、他线启停、燃料状态）触发整页重建把原生下拉关掉。
  var alDiv = document.getElementById("station-auto-lines");
  if (alDiv) {
    var alOptsSig = computeStationAlOptsSig(display.autoLines);
    if (alOptsSig !== _stationAlOptsSig) {
      alDiv.innerHTML = display.autoLines.map(function(al) {
        var opts = renderAutoLineOptions(al.targetOptions, al.selectedTargetId);
        var statAl = al.running ? "运行中" : (al.stoppedText || "已停止");
        if (al.stoppedReason === "insufficient-materials") statAl = "材料不足";
        else if (al.stoppedReason === "user-stopped") statAl = "已停止";
        else if (al.stoppedReason === "target-not-allowed") statAl = "目标不在产线范围";
        else if (al.stoppedReason === "target-reached") statAl = "已达目标";
        else if (al.stoppedReason === "blueprint-runs-depleted") statAl = "抄本流程已用尽";
        // 「选中 / 运行」行统一由 autoLineTargetsText 生成（只显示正式中文名，
        // 绝不回退 selectedTargetId/startedTargetId，避免内部 recipeId 泄漏到界面）。
        var prodText = "";
        if (al.running || al.stoppedReason === "target-reached") {
          prodText = al.targetQuantity > 0 ? ("已产 " + al.producedQty + " / " + al.targetQuantity) : ("已产 " + al.producedQty + "（无限）");
        } else if (al.targetQuantity > 0) {
          prodText = "目标：" + al.targetQuantity + " 件";
        }
        return '<div class="station-al-card" id="al-card-' + al.lineId + '"><div class="sal-header"><strong>' + (al.name || al.lineId) + '</strong></div>' +
          '<div class="sal-mult" id="al-mult-' + al.lineId + '">建筑 ×' + al.buildingMultiplier.toFixed(2) + ' · 后勤 ×' + al.logisticsMultiplier.toFixed(2) + ' · 综合 ×' + al.effectiveMultiplier.toFixed(2) + '</div>' +
          '<div class="sal-select"><select data-line="' + al.lineId + '" class="u-select">' + opts + '</select></div>' +
          '<div class="sal-qty">生产数量 <input type="number" min="1" class="al-qty" data-al-qty="' + al.lineId + '" value="' + (al.targetQuantity ? al.targetQuantity : '') + '" placeholder="∞ 全部原料"></div>' +
          '<div class="sal-targets" id="al-targets-' + al.lineId + '">' + autoLineTargetsText(al) + '</div>' +
          '<div class="sal-status" id="al-status-' + al.lineId + '">状态：' + statAl + '</div>' +
          '<div class="sal-produced" id="al-produced-' + al.lineId + '">' + prodText + '</div>' +
          (al.cycleDurationMs ? '<div class="al-progress-wrap"><div class="progress-bar"><div class="fill al-fill" id="al-fill-' + al.lineId + '" style="width:' + (al.progressRatio * 100).toFixed(0) + '%"></div></div><div class="sal-progress" id="al-progress-' + al.lineId + '">周期 ' + (al.cycleDurationMs / 1000).toFixed(1) + 's · 进度 ' + (al.progressRatio * 100).toFixed(0) + '%</div></div>' : '') +
          '<button class="btn sm al-start" id="al-start-' + al.lineId + '" data-line="' + al.lineId + '"' + (al.canStart ? '' : ' disabled') + '>' + (al.running ? '已启动' : '启动') + '</button>' +
          '<button class="btn sm al-stop" id="al-stop-' + al.lineId + '" data-line="' + al.lineId + '"' + (al.canStop ? '' : ' disabled') + '>停止</button></div>';
      }).join("");
      _stationAlOptsSig = alOptsSig;
    }
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

  // ---- E2. 空间站核心加成 ----
  var coreEl = document.getElementById("station-cores-list");
  if (coreEl) {
    var cores = display.coreEffects || [];
    var ownedCount = cores.filter(function(c){ return c.active; }).length;
    if (cores.length > 0) {
      var rowsHtml = cores.map(function(c) {
        var dot = c.active ? "●" : "○";
        var cls = c.active ? " core-active" : " core-inactive";
        return '<span class="' + cls + '">' + dot + " " + c.label + " " + (c.active ? c.effectText : "未激活") + '</span>';
      }).join("");
      coreEl.innerHTML =
        '<div class="station-cores-title">空间站核心加成 ' + ownedCount + "/" + cores.length + "</div>" +
        '<div class="station-cores-grid">' + rowsHtml + "</div>";
    } else {
      coreEl.innerHTML = "";
    }
  }

  // ---- F. 军团 ----
  setText("station-corp-name", display.corporation.name || "未成立");
  if (display.corporation.foundedAt) setText("station-corp-founded", new Date(display.corporation.foundedAt).toLocaleDateString());
  else setText("station-corp-founded", "-");
  setText("station-corp-dlc", display.corporation.statusText || "DLC 预留");
  // 军团已迁出为独立侧边栏页面；此处不再渲染军团区块。
  // 同步结构签名：用于 live updater 判断是否需要整页重渲染（节流时间戳/签名均不进 gameState/存档）。
  _stationSig = computeStationSig(display);
}

// 折叠面板摘要（空间站总览）：状态标签 + 建设状态 + 燃料量
function updateStationOpsSummary(display) {
  var statusEl = document.getElementById("station-ops-status");
  var buildEl = document.getElementById("station-ops-build");
  var fuelEl = document.getElementById("station-ops-fuel");
  if (!statusEl && !buildEl && !fuelEl) return;

  // 状态标签
  var status, statusCls;
  if (!display.body.bodyLevel || display.body.bodyLevel === 0) { status = "未建立"; statusCls = "idle"; }
  else if (!display.maintenance.operational) { status = "燃料不足"; statusCls = "warn"; }
  else { status = "运行中"; statusCls = ""; }
  if (statusEl) { statusEl.textContent = status; statusEl.className = "sop-tag" + (statusCls ? " " + statusCls : ""); }

  // 建设状态
  if (buildEl) {
    if (display.body.currentConstruction) {
      buildEl.textContent = "建设中 · 剩余 " + fmtDuration(display.body.remainingMs || 0);
    } else if (display.body.bodyLevel && display.body.bodyLevel > 0) {
      buildEl.textContent = "Lv." + display.body.bodyLevel;
    } else {
      buildEl.textContent = "";
    }
  }

  // 燃料量
  if (fuelEl) fuelEl.textContent = (display.maintenance.fuelRemaining || 0).toLocaleString();
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

// 自动线「选中 / 运行」行文案（初始渲染与 live 更新共用，杜绝两处不一致）。
// 限次抄本（BPC）追加剩余流程数，避免玩家误以为只要有材料就能一直产。
function autoLineTargetsText(al) {
  var selName = al.selectedTargetName || "未选择";
  var startName = al.startedTargetName || "";
  var text = "选中：" + selName + (startName ? " · 运行：" + startName : "");
  if (typeof al.selectedBlueprintRuns === "number") text += " · 抄本剩余 " + al.selectedBlueprintRuns + " 流程";
  return text;
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

var _stationAlOptsSig = "";
// 自动线「可选项集合」签名：仅覆盖选项 id 与蓝图锁状态（随建筑解锁 / 蓝图购买变化）。
// 运行态、进度、启停、倍率均不进此签名（由 liveUpdateStationFields 每秒轻量同步），
// 因此无关结构变化（本体升级可负担、他线启停、燃料状态）不会触发 select 重建、误关下拉。
function computeStationAlOptsSig(autoLines) {
  if (!autoLines) return "";
  return autoLines.map(function(al) {
    return al.lineId + "[" + (al.targetOptions || []).map(function(t) {
      return t.id + (t.requiresBlueprint && !t.hasRequiredBlueprint ? "L" : "");
    }).join(",") + "]";
  }).join("|");
}

// 自动线下拉分组：按 recipe.category 聚成 <optgroup>（仿装备制造页标签）。
// 原生 select + optgroup，不引入新渲染路径，上一轮修好的「下拉不被误关」逻辑原样生效。
// 选项集签名（computeStationAlOptsSig）只认 id + 蓝图锁状态，category 不参与 → 分组不影响重建判定。
var AUTO_LINE_CATEGORY_ORDER = ["smelting","fuel","ammunition","probes","mining","archaeology","combatWeapon","combatRepair","gas","refining","ship","equipment","booster","training"];
var AUTO_LINE_CATEGORY_LABELS = {
  smelting:"原矿冶炼", fuel:"燃料", ammunition:"弹药", probes:"探针",
  mining:"采矿", archaeology:"考古", combatWeapon:"战斗武器", combatRepair:"战斗维修",
  gas:"采气", refining:"冶炼", ship:"舰船工程", equipment:"装备制造", booster:"增幅剂制造", training:"技能训练"
};
function renderAutoLineOptions(options, selectedId) {
  if (!options || !options.length) return '<option value="">（无可生产配方）</option>';
  // 强制空占位：移动端原生 select 若默认选中唯一/第一个实际 option，用户再点选同一项不会触发 change，
  // 导致 selectedTargetId 永远为 null、启动按钮被 no-target-selected 锁住。
  var placeholder = '<option value=""' + (!selectedId ? ' selected' : '') + ' disabled>请选择生产目标</option>';
  var buckets = {};
  options.forEach(function(t) {
    // category 可能是字符串（多数配方）或数组（如精密配给剂 ["ship","equipment"]）。
    // 数组时需遍历每个元素分别入桶，否则 Array.toString() 得到 "ship,equipment" 这种
    // 不在 AUTO_LINE_CATEGORY_ORDER 里的 key，导致该配方在自动线下拉里整组静默丢失。
    var cats = Array.isArray(t.category) ? t.category : [t.category || "other"];
    cats.forEach(function(c) {
      (buckets[c] = buckets[c] || []).push(t);
    });
  });
  return placeholder + AUTO_LINE_CATEGORY_ORDER.filter(function(c){ return buckets[c] && buckets[c].length; }).map(function(cat) {
    var label = AUTO_LINE_CATEGORY_LABELS[cat] || cat;
    var inner = buckets[cat].map(function(t) {
      var sel = t.id === selectedId ? " selected" : "";
      var locked = (t.requiresBlueprint && !t.hasRequiredBlueprint) ? " disabled" : "";
      var txt = t.name + ((t.requiresBlueprint && !t.hasRequiredBlueprint) ? "（需蓝图）" : "");
      return '<option value="' + t.id + '"' + sel + locked + '>' + txt + '</option>';
    }).join("");
    return '<optgroup label="' + label + '">' + inner + '</optgroup>';
  }).join("");
}

// 统一实时入口（由 updateLiveUI 每秒按 currentPage==="station" 调用）。
// 节流仅作用于「轻量字段刷新」分支；结构签名一旦变化必须无条件立即整页重渲染，
// 否则建造完成/自动线启停等结构变化在节流窗口内被漏渲染，玩家须手动切页才看得到更新。
function updateStationLiveUI(now) {
  var t = Number(now) || Date.now();
  var display = getStationPageDisplayState(gameState, t);
  var sig = computeStationSig(display);
  var alOptsSig = computeStationAlOptsSig(display.autoLines);
  if (sig !== _stationSig || alOptsSig !== _stationAlOptsSig) {
    // 结构性变化（建造完成、自动线启停/目标改变、维护断油、选项集变化等）→ 整页渲染。
    // 注意：renderStationPage 内部按 _stationAlOptsSig 自行决定是否重建 alDiv 的 <select>，
    // 选项集未变的无关结构变化不会触碰 <select>，避免误关下拉。
    renderStationPage(t);
    // 选项集未变时 renderStationPage 不会重建 alDiv；补一次轻量同步确保自动线
    // 状态/进度/启停/倍率与最新显示态一致（最多延迟到本次渲染）。
    liveUpdateStationFields(display, t);
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

  updateStationOpsSummary(display);

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

  // 军团入口卡：大厅施工完成（离线结算/事件后）状态可能翻转，轻量每秒同步。
  if (typeof LegionRender !== "undefined" && LegionRender.renderLegionEntry) LegionRender.renderLegionEntry(t);

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
      else if (al.stoppedReason === "target-not-allowed") st = "目标不在产线范围";
      else if (al.stoppedReason === "target-reached") st = "已达目标";
      else if (al.stoppedReason === "blueprint-runs-depleted") st = "抄本流程已用尽";
      setLiveText(statEl, "状态：" + st);
    }
    var prodEl = document.getElementById("al-produced-" + al.lineId);
    if (prodEl) {
      var pt = "";
      if (al.running || al.stoppedReason === "target-reached") {
        pt = al.targetQuantity > 0 ? ("已产 " + al.producedQty + " / " + al.targetQuantity) : ("已产 " + al.producedQty + "（无限）");
      } else if (al.targetQuantity > 0) {
        pt = "目标：" + al.targetQuantity + " 件";
      }
      setLiveText(prodEl, pt);
    }
    var tgtEl = document.getElementById("al-targets-" + al.lineId);
    if (tgtEl) {
      setLiveText(tgtEl, autoLineTargetsText(al));
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
    var multEl = document.getElementById("al-mult-" + al.lineId);
    if (multEl) setLiveText(multEl, "建筑 ×" + al.buildingMultiplier.toFixed(2) + " · 后勤 ×" + al.logisticsMultiplier.toFixed(2) + " · 综合 ×" + al.effectiveMultiplier.toFixed(2));
  });
}

// ================================================================
// 军团 DLC —— 面板渲染与交互
// ----------------------------------------------------------------
// 与既有 UI 一致：只读 getLegionContributionSnapshot / getLegionCandidateRefreshState / 直接读 gameState.legion；
// 所有文案类展示（如招募台词）一律经 getNpcDialogue，不在此硬编码字符串。
// 交互经事件委托（已在 initStationUI 绑定），动作后统一 renderStationPage 重建。
// ================================================================

// 仅在「随真实动作/结算变化、需重建卡片」时重建候选人/NPC 卡片；倒计时等时间字段不进签名。
var _legionSig = "";

function getShipDisplayName(shipId) {
  if (!shipId) return "";
  if (typeof getShipConfigById === "function") {
    var cfg = getShipConfigById(shipId);
    if (cfg && cfg.name) return cfg.name;
  }
  if (typeof SHIP_DATA !== "undefined") {
    for (var _k in SHIP_DATA) {
      var _coll = SHIP_DATA[_k];
      if (_coll && typeof _coll === "object" && _coll[shipId] && _coll[shipId].name) return _coll[shipId].name;
    }
  }
  return shipId;
}
