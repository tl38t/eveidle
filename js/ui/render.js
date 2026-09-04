/* ================================================================
   侧边栏等级刷新
   ================================================================ */

const SKILL_DESC = {
  mining: "提升采矿效率，解锁更高级矿带",
  refining: "将矿石精炼为矿物",
  gasHarvesting: "采集气体用于制造燃料",
  shipEngineering: "制造舰船部件与合成整船",
  planetaryIndustry: "自动产出行星材料",
  laserOps: "提升激光炮伤害与伤害应用",
  cannonOps: "提升炮台伤害与伤害应用",
  missileOperations: "提升导弹伤害与伤害应用",
  targeting: "提升所有武器的伤害应用",
  shieldOperation: "提升护盾容量",
  armorReinforcement: "提升装甲容量",
  hullEngineering: "提升结构容量",
  piloting: "降低舰船受到的伤害",
  capacitorManagement: "降低燃料消耗",
  defense: "提升维修效率",
  combat: "由攻击与防御技能共同决定的综合等级，决定可前往的星带安全等级",
  archaeology: "扫描遗迹信号并解析其中的文物",
  drones: "（占位）无人机伤害加成",
  equipmentEngineering: "制造舰船装备、燃料与各类弹药",
  boosterEngineering: "制造采矿、考古与战斗增强剂"
};

const PAGE_DESC = {
  blueprints:   "用星币和功勋购买可永久制造的蓝图",
  cargo:        "查看与管理物资库存，强化装备",
  hangar:       "管理舰队、指派任务、强化舰船",
  station:      "升级空间站、补给燃料、建造建筑",
  queue:        "把多个动作排成队列依次执行",
  statistics:   "查看累计游戏数据与记录排行",
  achievements: "浏览成就及解锁条件与奖励",
  research:     "解锁科技",
  save:         "保存、导出、导入或清除存档",
  settings:     "调整游戏选项与偏好"
};

function renderSidebar(sidebarState) {
  const byKey = new Map((sidebarState || getSidebarDisplayState(gameState)).map(item => [item.key, item]));
  document.querySelectorAll('.sidebar .nav-item').forEach(el => {
    const lvSpan = el.querySelector('.nav-lv');
    const pageKey = el.dataset.page;
    if (pageKey && !lvSpan) {
      const t = PAGE_DESC[pageKey];
      if (t && el.title !== t) el.title = t;
    }
    if (!lvSpan) return;
    const skillKey = lvSpan.dataset.lv;
    if (!skillKey) return;
    const s = byKey.get(skillKey);
    if (!s) return;
    const levelText = "Lv." + s.level + (s.boosted ? " (+" + (s.level - s.baseLevel) + ")" : "");
    const levelClass = "nav-lv " + s.levelClass + (s.boosted ? " nav-lv-boosted" : "");
    if (lvSpan.textContent !== levelText) lvSpan.textContent = levelText;
    if (lvSpan.className !== levelClass) lvSpan.className = levelClass;
    const title = s.tooltip || ("经验：" + Math.floor(s.xp).toLocaleString() + " / " + s.xpNeeded.toLocaleString() + "\n────────\n" + (SKILL_DESC[skillKey] || "提升此技能等级") + (s.boosted ? "\n⚡ 增强剂临时 +" + (s.level - s.baseLevel) : ""));
    if (el.title !== title) el.title = title;
  });
  if (typeof renderCombatSkillGroup === "function") renderCombatSkillGroup();
  // 军团侧边栏标签：仅在「空间站本体 ≥ Lv.3 且已建造军团议事大厅」时显示。
  var legionNav = document.getElementById("nav-legion");
  if (legionNav && typeof LegionRender !== "undefined" && LegionRender.isLegionTabVisible) {
    legionNav.style.display = LegionRender.isLegionTabVisible(gameState) ? "" : "none";
  }
  var starmapNav = document.getElementById("nav-starmap");
  if (starmapNav && typeof LegionRender !== "undefined" && LegionRender.isLegionTabVisible) {
    starmapNav.style.display = LegionRender.isLegionTabVisible(gameState) ? "" : "none";
  }
}

/* ================================================================
   UI 更新
   ================================================================ */

function setProductionControls(display, startButton) {
  const startButtons = ["btn-start-mine", "btn-start-smelt", "btn-start-gas"].map(id => document.getElementById(id));
  const stopBtn = document.getElementById("btn-stop");
  const switchBtn = document.getElementById("btn-switch-skill");
  startButtons.forEach(button => { if (button) button.style.display = "none"; });
  if (startButton) {
    startButton.style.display = display.showStart ? "" : "none";
    startButton.disabled = !display.canStart;
  }
  if (stopBtn) stopBtn.style.display = display.showStop ? "" : "none";
  if (switchBtn) switchBtn.style.display = display.showStop ? "" : "none";
}

function renderMiningDisplay(display, areaEl, outEl) {
  if (areaEl) areaEl.textContent = "目标矿带：" + display.current.displayName;
  if (outEl) outEl.textContent = "经验奖励：" + display.current.baseXP + " / 次";
  const areaSelect = document.getElementById("mining-area-select"); if (areaSelect) areaSelect.style.display = "block";
  const stats = document.getElementById("mining-stats"); if (stats) stats.style.display = "block";
  document.querySelectorAll(".mining-mode-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === display.mode));
  const strip = document.getElementById("mining-target-strip");
  if (strip) {
    strip.innerHTML = display.targets.map(area => `<button class="mining-target-card${area.selected ? " selected" : ""}${area.locked ? " locked" : ""}${area.running ? " running" : ""}" data-area="${area.name}" style="--ore-color:${area.color}" ${area.locked ? "disabled" : ""}>
      <span class="mining-target-name">${area.displayName}</span><span class="mining-target-visual"><i class="fa-solid fa-gem"></i></span>
      <span class="mining-target-meta">Lv.${area.level} · ${area.baseTime}s · ${area.baseXP} XP</span>
      <span class="mining-target-state">${area.locked ? `需要 Lv.${area.level}` : area.running ? "正在采集" : area.selected ? "已选择" : "可采集"}</span></button>`).join("");
    strip.querySelectorAll(".mining-target-card:not([disabled])").forEach(card => card.addEventListener("click", () => switchMiningArea(card.dataset.area)));
  }
  const requirement = document.getElementById("mining-target-requirement");
  if (requirement) { requirement.textContent = display.requirement.text; requirement.className = "mining-target-requirement " + (display.requirement.available ? "ready" : "blocked"); }
  const start = document.getElementById("btn-start-mine"); if (start) start.title = display.canStart ? "" : display.requirement.text;
  setProductionControls(display, start);
  const efficiency = document.getElementById("me-value"); if (efficiency) { efficiency.textContent = display.efficiency.total.toFixed(2); efficiency.title = display.efficiencyTooltip; }
  const fleetSupport = document.getElementById("mining-fleet-support");
  const fleetSupportRow = document.getElementById("mining-fleet-support-row");
  const logText = document.getElementById("mining-logistics");
  if (logText) {
    const lm = Number(display.stationLogisticsMultiplier) || 1;
    const stationLog = (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(gameState) : null;
    if (lm > 1) logText.textContent = "后勤 ×" + lm.toFixed(2) + "（+" + Math.round((lm - 1) * 100) + "%）";
    else logText.textContent = "后勤 ×1.00（" + (stationLog ? stationLog.text : (gameState.station && gameState.station.bodyLevel > 0 ? "燃料不足" : "未建立")) + "）";
  }
  if (fleetSupport) fleetSupport.textContent = display.efficiency.fleetSupportBonus > 0 ? display.efficiency.fleetSupportShip.name + " · 最终速度 +" + (display.efficiency.fleetSupportBonus * 100).toFixed(0) + "%" : "未启用";
  if (fleetSupportRow) fleetSupportRow.classList.toggle("active", display.efficiency.fleetSupportBonus > 0);
  drawSkillBar(document.getElementById("bar-mining"), display.progress.percent, "green");
  const eta = document.getElementById("mp-eta"); if (eta) eta.textContent = display.progress.etaText;
}

function renderSmeltingDisplay(display, areaEl, outEl) {
  if (areaEl) areaEl.textContent = getResourceDisplayName(display.current.outputMineral);
  if (outEl) outEl.textContent = "经验奖励：" + display.current.baseXP + " / 次";
  const select = document.getElementById("smelting-area-select"); if (select) { select.style.display = "flex"; const lbl = select.querySelector(".area-label"); if (lbl) lbl.style.display = "none"; }
  const stats = document.getElementById("smelting-stats"); if (stats) stats.style.display = "block";
  const strip = document.getElementById("smelting-target-strip");
  if (strip) {
    strip.innerHTML = display.options.map(recipe => `<button class="mining-target-card${recipe.selected ? " selected" : ""}${recipe.locked ? " locked" : ""}" data-area="${recipe.name}" style="--ore-color:#e8b04a" ${recipe.locked ? "disabled" : ""}>
      <span class="mining-target-name">${getResourceDisplayName(recipe.outputMineral)}</span><span class="mining-target-visual"><i class="fa-solid fa-fire"></i></span>
      <span class="mining-target-meta">Lv.${recipe.level} · ${recipe.baseTime}s · ${recipe.baseXP} XP</span>
      <span class="mining-target-sub">${getResourceDisplayName(recipe.consumeOre)} → ${getResourceDisplayName(recipe.outputMineral)}</span>
      <span class="mining-target-state">${recipe.locked ? `需要 Lv.${recipe.level}` : recipe.selected ? "已选择" : "可冶炼"}</span></button>`).join("");
    strip.querySelectorAll(".mining-target-card:not([disabled])").forEach(card => card.addEventListener("click", () => switchSmeltingRecipe(card.dataset.area)));
  }
  const efficiency = document.getElementById("smelting-eff-value");
  if (efficiency) {
    efficiency.textContent = display.efficiency.toFixed(2);
    efficiency.title = getSmeltingEfficiencyBreakdown(display);
  }
  const output = document.getElementById("smelting-output-qty"); if (output) output.textContent = display.output;
  const support = document.getElementById("smelting-ship-support"); if (support) support.textContent = display.shipBonus > 0 ? display.ship.name + " · 速度 +" + (display.shipBonus * 100).toFixed(0) + "%" : "未分配";
  // 外接大型精炼泵：状态行 + 供料开关（仅在冶炼舰已安装泵时显示该行）
  const pumpRow = document.getElementById("smelting-pump-row");
  const pumpState = document.getElementById("smelting-pump-state");
  const pumpToggle = document.getElementById("smelting-pump-toggle");
  if (pumpRow) pumpRow.style.display = (display.pump && display.pump.count > 0) ? "flex" : "none";
  if (pumpState && display.pump) {
    const p = display.pump;
    const fuelName = String(p.resourceId || "").replace("planetary:", "");
    if (!p.enabled) pumpState.textContent = "已关闭（不消耗" + fuelName + "）";
    else if (p.active) pumpState.textContent = "×" + p.count + " · 供料中 +" + (p.bonus * 100).toFixed(0) + "%（每炉扣 " + fuelName + " ×" + p.fuelPerCycle + "）";
    else pumpState.textContent = "×" + p.count + " · 断料失效（需 " + fuelName + " ≥" + p.fuelPerCycle + "）";
    pumpState.style.color = p.active ? "#a7f3d0" : (p.enabled ? "#f0b4a0" : "#8a9bb0");
    // 库存余量提示（2026-09-03 用户反馈）：紧跟状态显示剩余等离子体与可供炉数。
    // 数据来自 display.pump.stock（getPumpModifiers 早已读取）。三态：供料中绿色、
    // 可供 <20 炉黄色预警、断料橙色（不足一炉）；关闭供料时不显示（不消耗，无意义）。
    let stockEl = document.getElementById("smelting-pump-stock");
    if (!stockEl && pumpState.parentNode) {
      stockEl = document.createElement("span");
      stockEl.id = "smelting-pump-stock";
      pumpState.parentNode.insertBefore(stockEl, pumpState.nextSibling);
    }
    if (stockEl) {
      stockEl.textContent = "";
      if (p.enabled && p.fuelPerCycle > 0) {
        const cycles = Math.floor((Number(p.stock) || 0) / p.fuelPerCycle);
        if (p.active && cycles > 0 && cycles < 20) {
          stockEl.textContent = " · 库存 " + (Number(p.stock) || 0).toLocaleString() + " · 可供 " + cycles + " 炉 ⚠ 即将断料";
          stockEl.style.color = "#f0d9a0";
        } else if (p.active) {
          stockEl.textContent = " · 库存 " + (Number(p.stock) || 0).toLocaleString() + " · 可供 " + cycles.toLocaleString() + " 炉";
          stockEl.style.color = "#a7f3d0";
        } else if (!p.active) {
          stockEl.textContent = " · 库存 " + (Number(p.stock) || 0).toLocaleString() + "（不足一炉）";
          stockEl.style.color = "#f0b4a0";
        }
      }
    }
  }
  if (pumpToggle && display.pump) {
    pumpToggle.textContent = display.pump.enabled ? "开启中" : "已关闭";
    pumpToggle.style.display = display.pump.count > 0 ? "" : "none";
  }
  const cycleTimes = document.getElementById("smelting-cycle-times");
  if (cycleTimes) cycleTimes.textContent = display.current.baseTime.toFixed(1) + "s → " + display.actualTime.toFixed(1) + "s";
  const outputNote = document.getElementById("smelting-output-note"); if (outputNote) outputNote.textContent = "支援舰只缩短冶炼周期，单次仍产出 " + display.output;
  const smeltBtn = document.getElementById("btn-start-smelt");
  if (smeltBtn) smeltBtn.textContent = "▶ 开始冶炼";
  setProductionControls(display, smeltBtn);
  drawSkillBar(document.getElementById("bar-smelting"), display.progress.percent, "gold");
  const eta = document.getElementById("smelting-eta"); if (eta) eta.textContent = display.progress.etaText;
}

// 熔炼行动下的子视图分发（2026-09-04 新增自动拆解子活动）：
// 根据 currentAction.refiningSubAction 在「冶炼」与「自动拆解」间切换，
// 并管理两者 DOM（子模式 tab、冶炼选区/状态、自动拆解区）的显隐，避免进度串台。
function renderRefiningDisplay(renderTime, areaEl, outEl) {
  const submode = (gameState.currentAction && gameState.currentAction.refiningSubAction) || "smelting";
  const tabs = document.getElementById("refining-submode-tabs");
  if (tabs) {
    tabs.style.display = "";
    tabs.querySelectorAll(".refining-submode-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.submode === submode));
  }
  const smeltSelect = document.getElementById("smelting-area-select");
  const smeltStats = document.getElementById("smelting-stats");
  const dStats = document.getElementById("auto-dismantle-stats");
  if (submode === "dismantle") {
    if (smeltSelect) smeltSelect.style.display = "none";
    if (smeltStats) smeltStats.style.display = "none";
    if (dStats) dStats.style.display = "block";
    renderDismantleDisplay(getDismantleDisplayState(gameState, renderTime), areaEl, outEl);
  } else {
    if (dStats) dStats.style.display = "none";
    renderSmeltingDisplay(getSmeltingDisplayState(gameState, renderTime), areaEl, outEl);
  }
}

// 自动拆解显示渲染（归在熔炼行动下的挂机子活动）：组件选择卡片 + 退料预览 + 回收率/经验/周期 + 进度。
function renderDismantleDisplay(display, areaEl, outEl) {
  if (!display) return;
  if (areaEl) areaEl.textContent = "自动拆解：" + display.current.name;
  if (outEl) outEl.textContent = "回收材料 + 经验";
  const strip = document.getElementById("auto-dismantle-strip");
  if (strip) {
    strip.innerHTML = display.options.map(r => `<button class="mining-target-card${r.selected ? " selected" : ""}${r.locked ? " locked" : ""}" data-dismantle="${r.id}" style="--ore-color:#8fd6a0" ${r.locked ? "disabled" : ""}>
      <span class="mining-target-name">${r.name}</span><span class="mining-target-visual"><i class="fa-solid fa-recycle"></i></span>
      <span class="mining-target-meta">Lv.${r.level} · ${r.baseTime}s · 舰船+${r.shipXp}/冶炼+${r.smeltXp}</span>
      <span class="mining-target-state">${r.locked ? `需要 Lv.${r.level}` : (r.stock > 0 ? "库存 ×" + r.stock : "无库存")}</span></button>`).join("");
    strip.querySelectorAll(".mining-target-card:not([disabled])").forEach(card => card.addEventListener("click", () => switchDismantleComponent(card.dataset.dismantle)));
  }
  const quote = document.getElementById("auto-dismantle-quote");
  if (quote) quote.innerHTML = display.quote.length
    ? "回收：" + display.quote.map(q => q.name + "×" + q.returned).join(" · ")
    : "无回收材料";
  const reclaim = document.getElementById("ad-reclaim"); if (reclaim) reclaim.textContent = display.reclaimPercent + "%";
  const efficiency = document.getElementById("ad-efficiency"); if (efficiency) { efficiency.textContent = display.efficiency.toFixed(2); if (display.efficiencyTooltip) efficiency.title = display.efficiencyTooltip; }
  const xpShip = document.getElementById("ad-xp-ship"); if (xpShip) xpShip.textContent = "+" + display.xp.shipEngineering;
  const xpRef = document.getElementById("ad-xp-refining"); if (xpRef) xpRef.textContent = "+" + display.xp.refining;
  const cycle = document.getElementById("ad-cycle"); if (cycle) cycle.textContent = display.actualTime.toFixed(1) + "s";
  const btn = document.getElementById("btn-start-smelt");
  if (btn) btn.textContent = "▶ 开始自动拆解";
  setProductionControls(display, btn);
  drawSkillBar(document.getElementById("bar-auto-dismantle"), display.progress.percent, "gold");
  const eta = document.getElementById("auto-dismantle-eta"); if (eta) eta.textContent = display.progress.etaText;
}

function renderGasDisplay(display, areaEl, outEl) {
  if (areaEl) areaEl.textContent = "目标气云：" + display.current.name;
  if (outEl) outEl.textContent = "经验奖励：" + display.current.baseXP + " / 次";
  const select = document.getElementById("gas-area-select"); if (select) { select.style.display = "flex"; const lbl = select.querySelector(".area-label"); if (lbl) lbl.style.display = "none"; }
  const stats = document.getElementById("gas-stats"); if (stats) stats.style.display = "block";
  const strip = document.getElementById("gas-target-strip");
  if (strip) {
    strip.innerHTML = display.options.map(area => '<button class="mining-target-card'+(area.selected?" selected":"")+(area.locked?" locked":"")+'" data-area="'+area.name+'" style="--ore-color:#5fd0e6" '+(area.locked?"disabled":"")+'">'+'<span class="mining-target-name">'+area.name+'</span><span class="mining-target-visual"><i class="fa-solid fa-wind"></i></span><span class="mining-target-meta">Lv.'+area.level+' · '+area.baseTime+'s · '+area.baseXP+' XP</span><span class="mining-target-state">'+(area.locked?('需要 Lv.'+area.level):(area.selected?"已选择":"可采集"))+'</span></button>').join("");
    strip.querySelectorAll(".mining-target-card:not([disabled])").forEach(card => card.addEventListener("click", () => switchGasArea(card.dataset.area)));
  }
  const efficiency = document.getElementById("gas-eff-value");
  if (efficiency) { efficiency.textContent = display.efficiency.total.toFixed(2); efficiency.title = display.efficiencyTooltip; }
  const gasLogText = document.getElementById("gas-logistics");
  if (gasLogText) {
    const lm = Number(display.stationLogisticsMultiplier) || 1;
    const stationLog = (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(gameState) : null;
    gasLogText.textContent = lm > 1 ? "后勤 ×" + lm.toFixed(2) + "（+" + Math.round((lm - 1) * 100) + "%）" : "后勤 ×1.00（" + (stationLog ? stationLog.text : ((gameState.station && gameState.station.bodyLevel > 0) ? "燃料不足" : "未建立")) + "）";
  }
  setProductionControls(display, document.getElementById("btn-start-gas"));
  drawSkillBar(document.getElementById("bar-gas"), display.progress.percent, "green");
  const eta = document.getElementById("gas-eta"); if (eta) eta.textContent = display.progress.etaText;
}

/* ================================================================
   手机端 hover 信息等价物（方案 C：ⓘ 图标，桌面隐藏）
   —— 任何「仅桌面 hover 才有」的说明，手机端用 ⓘ 提供点按等价物；
      桌面端 ⓘ 不显示（CSS @media (hover:none) 门控），保留原生 title hover。
   ================================================================ */
function initHoverInfo() {
  // 给单个 ⓘ 按钮绑定捕获阶段监听：拦截冒泡，避免触发侧边栏导航 / 抽屉关闭，
  // 并就地弹/收说明浮层（document 层委托已来不及拦截 nav-item/sidebar 的监听）。
  function bindInfoBtn(btn, resolveTarget) {
    if (btn._hoverInfoBound) return;
    btn._hoverInfoBound = true;
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); // 捕获阶段截断 → nav-item / sidebar 的冒泡监听不再执行（不导航、不收抽屉）
      toggleHoverInfoPop(resolveTarget(), btn);
    }, true);
  }
  // 1) 侧边栏标签：页面项(data-page) 与带等级徽标的技能项(.nav-lv) 注入 ⓘ；排除无说明的（如战斗组展开钮）
  document.querySelectorAll('.sidebar .nav-item').forEach(function (el) {
    if (el.querySelector(':scope > .hover-info-btn')) return;
    if (!el.dataset.page && !el.querySelector('.nav-lv')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hover-info-btn';
    btn.textContent = 'ⓘ';
    btn.setAttribute('aria-label', '查看说明');
    el.appendChild(btn);
    bindInfoBtn(btn, function () { return btn.closest('[data-page],[data-skill]') || btn.parentElement; });
  });
  // 2) 效率数值：采矿/采气/冶炼/装备制造/增强剂/舰船工程 六处
  //    —— 数字本体即为点击目标（全平台），点击弹出因子明细弹窗（不再用独立 ⓘ）
  ['me-value', 'gas-eff-value', 'smelting-eff-value', 'equipeng-eff-display', 'booster-eff-display', 'shipeng-eff-display', 'ad-efficiency'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el || el._effClickBound) return;
    el._effClickBound = true;
    el.classList.add('eff-clickable');
    el.addEventListener('click', function (e) {
      e.stopPropagation(); // 避免触发侧边栏导航 / 抽屉关闭等冒泡监听
      showEffModal(el);
    });
  });
  // 3) 事件委托：点浮层之外即收起（ⓘ 自身已在捕获阶段 stopPropagation，不会误触此处关闭）
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.hover-info-pop')) hideHoverInfoPop();
    if (!e.target.closest('.eff-modal')) hideEffModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hideHoverInfoPop(); hideEffModal(); }
  });
}

let _hoverInfoPop = null;
let _hoverInfoAnchor = null;
function toggleHoverInfoPop(target, anchor) {
  if (_hoverInfoPop && _hoverInfoAnchor === anchor) { hideHoverInfoPop(); return; }
  showHoverInfoPop(target, anchor);
}
function showHoverInfoPop(target, anchor) {
  if (!target) return;
  const text = (typeof target.title === 'string') ? target.title : (target.getAttribute('title') || '');
  if (!text) return;
  hideHoverInfoPop();
  const pop = document.createElement('div');
  pop.className = 'hover-info-pop';
  pop.textContent = text;
  document.body.appendChild(pop);
  const r = (anchor || target).getBoundingClientRect();
  let top = r.bottom + 6;
  const left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8);
  if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
  pop.style.top = top + 'px';
  pop.style.left = Math.max(8, left) + 'px';
  _hoverInfoPop = pop;
  _hoverInfoAnchor = anchor;
}
function hideHoverInfoPop() {
  if (_hoverInfoPop) { _hoverInfoPop.remove(); _hoverInfoPop = null; _hoverInfoAnchor = null; }
}

/* ================================================================
   效率因子明细弹窗（全平台点击效率数字触发，居中模态）
   —— 替代原「效率 ⓘ」方案：数字本体即点击目标，PC / 手机一致。
   ================================================================ */
let _effModal = null;
function showEffModal(target) {
  if (!target) return;
  const text = (typeof target.title === 'string') ? target.title : (target.getAttribute('title') || '');
  if (!text) return;
  hideEffModal();
  const overlay = document.createElement('div');
  overlay.className = 'eff-modal-overlay';
  const pop = document.createElement('div');
  pop.className = 'eff-modal';
  const h = document.createElement('h3'); h.textContent = '效率因子明细';
  const body = document.createElement('div'); body.className = 'eff-modal-body'; body.textContent = text;
  const btn = document.createElement('button'); btn.className = 'eff-modal-close'; btn.type = 'button'; btn.textContent = '知道了';
  btn.addEventListener('click', function (e) { e.stopPropagation(); hideEffModal(); });
  pop.appendChild(h); pop.appendChild(body); pop.appendChild(btn);
  overlay.appendChild(pop);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) hideEffModal(); });
  document.body.appendChild(overlay);
  _effModal = overlay;
  requestAnimationFrame(function () { overlay.classList.add('show'); });
}
function hideEffModal() {
  if (_effModal) { _effModal.remove(); _effModal = null; }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHoverInfo);
} else {
  initHoverInfo();
}

function switchGasArea(areaName) {
  const result = dispatchGameAction(gameState, { type:"production/selectGasArea", areaName }, Date.now());
  if (result.changed) updateUI();
  return result;
}

function switchSmeltingRecipe(areaName) {
  const result = dispatchGameAction(gameState, { type:"production/selectSmeltingRecipe", areaName }, Date.now());
  if (result.changed) updateUI();
  return result;
}

function switchDismantleComponent(componentId) {
  const result = dispatchGameAction(gameState, { type:"production/selectDismantleComponent", componentId }, Date.now());
  if (result.changed) updateUI();
  return result;
}

function switchRefiningSubmode(submode) {
  const result = dispatchGameAction(gameState, { type:"production/selectRefiningSubmode", submode }, Date.now());
  if (result.changed) updateUI();
  return result;
}

function switchMiningArea(areaName) {
  const result = dispatchGameAction(gameState, { type:"production/selectMiningArea", areaName }, Date.now());
  if (result.changed) updateUI();
  return result;
}

function switchMiningMode(mode) {
  const result = dispatchGameAction(gameState, { type:"production/selectMiningMode", mode }, Date.now());
  if (result.changed) updateUI();
  return result;
}

function renderGlobalDisplay(display) {
  const iskEl = document.querySelector('.res-value.isk'); if (iskEl) iskEl.textContent = formatCompact(display.isk);
  const lpEl = document.querySelector('.res-value.lp'); if (lpEl) lpEl.textContent = formatCompact(display.lp);
  // 顶部矿石速览条已移除（2026-09-03 用户拍板「没啥意义，直接删掉」）；quickOres selector 保留不破坏数据面
  const cargoText = document.getElementById("cargo-text");
  if (cargoText) { cargoText.textContent = display.inventory.total.toLocaleString(); }
}

function updateUI(now) {
  const renderTime = Number(now) || Date.now();
  if (typeof renderStarmapTrialRoom === "function") renderStarmapTrialRoom(renderTime);
  const viewKey = currentView;
  const shell = getSkillShellDisplayState(gameState, viewKey);
  const panelTitle = document.getElementById("skill-panel-title"); if (panelTitle) panelTitle.textContent = shell.icon + " " + shell.name;
  const panelStatus = document.getElementById("skill-panel-status"); if (panelStatus) panelStatus.textContent = shell.status;
  const nameEl = document.querySelector('.skill-current .skill-name'); if (nameEl) nameEl.textContent = shell.name;
  const activityEl = document.getElementById("current-activity");
  if (activityEl) {
    const activity = getCurrentActivityDisplayState(gameState, renderTime);
    const bar = activity.progressActive
      ? `<span class="activity-mini-progress" aria-label="进度 ${activity.progressPercent}%" title="${activity.progressPercent}%"><span class="fill" style="width:${activity.progressPercent}%"></span></span>`
      : "";
    const safeText = String(activity.text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    activityEl.innerHTML = safeText + bar;
  }
  const levelEl = document.querySelector('.skill-current .lv-num'); if (levelEl) levelEl.textContent = shell.level + (shell.boosted ? " (+" + shell.bonusLevels + ")" : "");
  const areaEl = document.querySelector('.skill-current .skill-area');
  const outEl = document.querySelector('.skill-current .skill-output');
  ["mining-area-select", "mining-stats", "smelting-area-select", "smelting-stats", "auto-dismantle-stats", "refining-submode-tabs", "gas-area-select", "gas-stats"].forEach(id => { const element = document.getElementById(id); if (element) element.style.display = "none"; });
  setProductionControls({ showStart:false, showStop:false, canStart:false }, null);

  if (currentPage === "skill") {
    if (viewKey === "mining") renderMiningDisplay(getMiningDisplayState(gameState, renderTime), areaEl, outEl);
    else if (viewKey === "refining") renderRefiningDisplay(renderTime, areaEl, outEl);
    else if (viewKey === "gasHarvesting") renderGasDisplay(getGasDisplayState(gameState, renderTime), areaEl, outEl);
    else if (viewKey === "shipEngineering") {
      const sep = document.getElementById("shipeng-panel"); if (sep) sep.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderShipEngineeringPage();
    } else if (viewKey === "equipmentEngineering") {
      const eep = document.getElementById("equipeng-panel"); if (eep) eep.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderEquipEngPage();
      renderActionBoosterSlots(viewKey, "equipeng-action-booster-slots");
    } else if (viewKey === "boosterEngineering") {
      const bp = document.getElementById("booster-panel"); if (bp) bp.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderBoosterPage(renderTime);
      renderActionBoosterSlots(viewKey, "booster-equipped-area");
    } else if (viewKey === "combat") {
      const combatPanel = document.getElementById("combat-panel");
      if (combatPanel) combatPanel.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderCombatPanel();
    }
  }
  if (typeof renderActionBoosterSlots === "function") {
    if (viewKey === "mining" || viewKey === "refining" || viewKey === "gasHarvesting") renderActionBoosterSlots(viewKey, "action-booster-slots");
    else if (viewKey === "shipEngineering") renderActionBoosterSlots(viewKey, "ship-action-booster-slots");
    else if (viewKey === "combat") renderActionBoosterSlots(viewKey, "combat-action-booster-slots");
    else if (viewKey === "archaeology") renderActionBoosterSlots(viewKey, "archaeology-action-booster-slots");
  }

  const fillEl = document.querySelector('.skill-current .fill.exp'); if (fillEl) fillEl.style.width = shell.xpPercent + "%";
  const expVal = document.querySelector('.skill-current .exp-value'); if (expVal) expVal.textContent = shell.xp.toLocaleString() + " / " + shell.xpNeeded.toLocaleString();
  renderGlobalDisplay(getGlobalDisplayState(gameState));
  renderSidebar(getSidebarDisplayState(gameState));
  // 已打开的确认弹窗随状态变化（装/卸增强剂、船坞升级完成等）实时刷新消耗/耗时
  if (typeof refreshActionConfirmation === "function") refreshActionConfirmation();
}

function setLiveText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

// 轻量 DOM 更新辅助：写 DOM 前比较新旧值（避免无谓写入/重排）。
function setLiveWidth(element, value) {
  if (element && element.style.width !== value) element.style.width = value;
}
function setLiveDisabled(element, value) {
  if (element && element.disabled !== value) element.disabled = value;
}
// 含子标签的片段（如 <b> 名称）用 innerHTML 比较更新，避免整容器重建。
function setLiveHTML(element, value) {
  if (element && element.innerHTML !== value) element.innerHTML = value;
}

// 每秒只更新会持续变化的字段；结构性面板仍由 updateUI() 按事件重建。
// 新增：空间站 / 研究 实时字段刷新（接入同一每秒 tick，不另建定时器）。
// 统一接收显式 now：整条刷新链路只取一次时间，避免显示态时间不一致。
function updateLiveUI(nowArg) {
  const now = Number(nowArg) || Date.now();
  if (typeof renderStarmapTrialRoom === "function") renderStarmapTrialRoom(now);
  const globalDisplay = getGlobalDisplayState(gameState);
  const iskEl = document.querySelector('.res-value.isk');
  const lpEl = document.querySelector('.res-value.lp');
  setLiveText(iskEl, formatCompact(globalDisplay.isk));
  setLiveText(lpEl, formatCompact(globalDisplay.lp));

  const cargoText = document.getElementById("cargo-text");
  if (cargoText) {
    setLiveText(cargoText, globalDisplay.inventory.total.toLocaleString());
  }

  renderSidebar(getSidebarDisplayState(gameState));
  if (currentPage === "planetary") updatePlanetaryLiveUI();
  if (currentPage === "skill" && currentView === "combat") updateCombatLiveUI();
  // 空间站 / 研究 实时刷新：currentPage 为唯一主判断（仅当前可见页才刷）。
  // 注意：document.hidden 不在此处做门控（只作参考），避免无头/后台环境导致刷新测试全失效。
  // 节流与展示态计算已分别约束在 updateStationLiveUI / updateResearchLiveUI 内部。
  if (currentPage === "station" && typeof updateStationLiveUI === "function") updateStationLiveUI(now);
  else if (currentPage === "research" && typeof updateResearchLiveUI === "function") updateResearchLiveUI(now);
  else if (currentPage === "legion" && typeof LegionRender !== "undefined" && LegionRender.renderLegionSection) LegionRender.renderLegionSection(now);
  // 仓库 / 机库 / 队列：停留页实时刷新；用 withPreservedScroll 避免「回到顶部」(回版头)。
  else if (currentPage === "cargo") withPreservedScroll(() => renderCargoPage());
  else if (currentPage === "hangar") withPreservedScroll(() => renderHangarPanel());
  else if (currentPage === "queue") withPreservedScroll(() => renderQueuePanel());
}

// 重建面板时保留滚动位置：用于原先「整体 innerHTML 重建」的页面（仓库/机库/队列），
// 使其停留可见时也能实时刷新，而不会因 DOM 重建导致滚动位置归零（回版头）。
function withPreservedScroll(repaint) {
  const ids = ["cargo-list", "hangar-panel", "hangar-ship-grid", "queue-list"];
  const prev = {};
  ids.forEach(id => { const e = document.getElementById(id); prev[id] = e ? (parseFloat(e.scrollTop) || 0) : 0; });
  const de = document.scrollingElement || document.documentElement;
  const docPrev = de ? (parseFloat(de.scrollTop) || 0) : 0;
  repaint();
  ids.forEach(id => { const e = document.getElementById(id); if (e) e.scrollTop = prev[id]; });
  if (de) de.scrollTop = docPrev;
}

function refreshVisiblePanelAfterAction() {
  if (currentPage === "skill") updateUI();
  else if (currentPage === "cargo") renderCargoPage();
  else if (currentPage === "hangar") renderHangarPanel();
  else if (currentPage === "queue") renderQueuePanel();
  else if (currentPage === "station" && typeof renderStationPage === "function") renderStationPage(Date.now());
}

/* ================================================================
   事件绑定
   ================================================================ */

(function bindProductionSelectors() {
  document.querySelectorAll(".mining-mode-tab").forEach(tab => tab.addEventListener("click", () => switchMiningMode(tab.dataset.mode)));
})();

(function bindButtons() {
  const stopBtn = document.getElementById("btn-stop"); const switchBtn = document.getElementById("btn-switch-skill");
  const startSmeltBtn = document.getElementById("btn-start-smelt"); const startMineBtn = document.getElementById("btn-start-mine"); const startGasBtn = document.getElementById("btn-start-gas");
  document.querySelectorAll(".refining-submode-tab").forEach(tab => tab.addEventListener("click", () => switchRefiningSubmode(tab.dataset.submode)));
  if (stopBtn) stopBtn.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"action/stop" }, Date.now());
    if (result.changed) GameEvents.emit("action:progressReset", { skill:result.skill, shipSubAction:result.shipSubAction });
    updateUI();
  });
  if (switchBtn) switchBtn.addEventListener("click", () => { const order = ["mining","refining","gasHarvesting"]; const idx = order.indexOf(gameState.currentAction.skill); const next = order[(idx + 1) % 3]; switchSkill(next); });
  if (startMineBtn) startMineBtn.addEventListener("click", () => showActionConfirm("mining"));
  if (startSmeltBtn) startSmeltBtn.addEventListener("click", () => showActionConfirm("refining"));
  if (startGasBtn) startGasBtn.addEventListener("click", () => showActionConfirm("gasHarvesting"));
  const startShipCompBtn = document.getElementById("btn-start-shipcomp"); const startShipAsmBtn = document.getElementById("btn-start-shipasm");
  if (startShipCompBtn) startShipCompBtn.addEventListener("click", showShipCompConfirm);
  if (startShipAsmBtn) startShipAsmBtn.addEventListener("click", showShipAsmConfirm);
  // 外接大型精炼泵供料开关（全局设置；只影响下一炉）
  const pumpToggleBtn = document.getElementById("smelting-pump-toggle");
  if (pumpToggleBtn) pumpToggleBtn.addEventListener("click", () => {
    const current = !(gameState.settings && gameState.settings.refineryPumpEnabled === false);
    dispatchGameAction(gameState, { type:"settings/setRefineryPumpEnabled", enabled:!current }, Date.now());
    updateUI();
  });
})();

dispatchGameAction(gameState, { type:"production/ensureMiningArea" }, Date.now());
// 定点返修 P1-D：后台计时安全。页面隐藏（document.hidden）时跳过 gameTick 且不更新 lastActiveTime，
// 避免移动端后台降频期间空转少结算；可见时正常推进。可见性恢复后的离线追算由 persistence.js
// 的 visibilitychange 处理。单一计时器、不在 render.js 额外注册 visibilitychange。
function runScheduledGameTick() {
  if (document.hidden) return;
  if (typeof SaveManager !== "undefined" && SaveManager.isBootBlocked && SaveManager.isBootBlocked()) return;
  RuntimeGuard.runCritical("gameTick", gameTick);
}
setInterval(runScheduledGameTick, 1000);

let _lastProgressFrame = 0;
let _lastPlanetFrame = 0;
let _lastBoosterFrame = 0;
(function renderLoop(frameTime) {
  RuntimeGuard.runRecoverable("renderLoop", () => {
  const visible = !document.hidden;
  if (visible && gameState.currentAction.active && frameTime - _lastProgressFrame >= 100) {
    _lastProgressFrame = frameTime;
    const key = gameState.currentAction.skill;
    const progressDisplay = getActiveActionProgressDisplayState(gameState, Date.now());
    const pct = progressDisplay.percent;
    const eta = progressDisplay.etaText;
    if (currentPage === "skill" && currentView === key && key === "mining") { drawSkillBar(document.getElementById("bar-mining"), pct, "green"); const e = document.getElementById("mp-eta"); if (e) e.textContent = eta; }
    else if (currentPage === "skill" && currentView === key && key === "refining") {
      if ((gameState.currentAction.refiningSubAction || "smelting") === "dismantle") {
        drawSkillBar(document.getElementById("bar-auto-dismantle"), pct, "gold");
        const e = document.getElementById("auto-dismantle-eta"); if (e) e.textContent = eta;
      } else {
        drawSkillBar(document.getElementById("bar-smelting"), pct, "gold");
        const e = document.getElementById("smelting-eta"); if (e) e.textContent = eta;
      }
    }
    else if (currentPage === "skill" && currentView === key && key === "gasHarvesting") { drawSkillBar(document.getElementById("bar-gas"), pct, "green"); const e = document.getElementById("gas-eta"); if (e) e.textContent = eta; }
    else if (currentPage === "skill" && currentView === key && key === "shipEngineering") {
      const sub = gameState.currentAction.shipSubAction || "";
      const barId = sub === "component" ? "bar-shipcomp" : "bar-shipasm";
      const etaId = sub === "component" ? "shipcomp-eta" : "shipasm-eta";
      drawSkillBar(document.getElementById(barId), pct, "purple");
      const e = document.getElementById(etaId); if (e) e.textContent = eta;
    }
    else if (currentPage === "skill" && currentView === key && key === "equipmentEngineering") {
      drawSkillBar(document.getElementById("bar-equipeng"), pct, "purple");
      const e = document.getElementById("equipeng-eta"); if (e) e.textContent = eta;
    }
    else if (currentPage === "skill" && currentView === key && key === "boosterEngineering") {
      drawSkillBar(document.getElementById("bar-booster"), pct, "purple");
      const e = document.getElementById("booster-eta"); if (e) e.textContent = eta;
    }
    else if (currentPage === "archaeology" && key === "archaeology") {
      drawSkillBar(document.getElementById("bar-archaeology"), pct, "green");
    }
    // 顶部全局活动迷你进度条：随渲染循环约每 100ms 刷新，
    // 避免只在事件触发或周期切换时才跳变（原先靠 updateUI 离散刷新）。
    const topFill = document.querySelector("#current-activity .activity-mini-progress .fill");
    if (topFill) topFill.style.width = pct + "%";
  }

  // 行星动画限制在约 15 FPS；页面隐藏或不在行星页时完全暂停绘制。
  if (visible && currentPage === "planetary" && frameTime - _lastPlanetFrame >= 66) {
    const elapsedFrames = _lastPlanetFrame ? Math.min(5, (frameTime - _lastPlanetFrame) / (1000 / 60)) : 1;
    _lastPlanetFrame = frameTime;
    updatePlanetaryAnimationFrame(frameTime, elapsedFrames);
  }

  // 增强剂槽「剩余 Xs」：updateUI 是事件驱动的（不会每秒触发），常驻/吸顶后
  // 数字会长时间不动。这里 1s 节流只改写文本节点，值未变化时跳过（成本可忽略）。
  if (visible && frameTime - _lastBoosterFrame >= 1000) {
    _lastBoosterFrame = frameTime;
    if (typeof refreshBoosterSlotTimers === "function") refreshBoosterSlotTimers();
  }
  });

  requestAnimationFrame(renderLoop);
})();

updateUI();
