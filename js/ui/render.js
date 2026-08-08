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
  boosterEngineering: "制造采矿、考古与战斗增强剂",
  rigEngineering: "制造舰船改装件",
  reverseEngineering: "（占位）解析残骸获取蓝图碎片"
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
    const levelText = "Lv." + s.level;
    const levelClass = "nav-lv " + s.levelClass;
    if (lvSpan.textContent !== levelText) lvSpan.textContent = levelText;
    if (lvSpan.className !== levelClass) lvSpan.className = levelClass;
    const title = s.tooltip || ("经验：" + Math.floor(s.xp).toLocaleString() + " / " + s.xpNeeded.toLocaleString() + "\n────────\n" + (SKILL_DESC[skillKey] || "提升此技能等级"));
    if (el.title !== title) el.title = title;
  });
  if (typeof renderCombatSkillGroup === "function") renderCombatSkillGroup();
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
  if (areaEl) areaEl.textContent = "目标矿石：" + getResourceDisplayName(display.current.ore);
  if (outEl) outEl.textContent = "经验奖励：" + display.current.baseXP + " / 次";
  const areaSelect = document.getElementById("mining-area-select"); if (areaSelect) areaSelect.style.display = "block";
  const stats = document.getElementById("mining-stats"); if (stats) stats.style.display = "block";
  document.querySelectorAll(".mining-mode-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === display.mode));
  const strip = document.getElementById("mining-target-strip");
  if (strip) {
    strip.innerHTML = display.targets.map(area => `<button class="mining-target-card${area.selected ? " selected" : ""}${area.locked ? " locked" : ""}${area.running ? " running" : ""}" data-area="${area.name}" style="--ore-color:${area.color}" ${area.locked ? "disabled" : ""}>
      <span class="mining-target-name">${getResourceDisplayName(area.ore)}</span><span class="mining-target-visual"><i class="fa-solid fa-gem"></i></span>
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
  if (areaEl) areaEl.textContent = "消耗：" + getResourceDisplayName(display.current.consumeOre) + " → " + getResourceDisplayName(display.current.outputMineral);
  if (display.progress.active && display.runningStock < 1 && areaEl) areaEl.textContent = "⚠ 原料不足：" + getResourceDisplayName(display.running.consumeOre) + " (库存：" + display.runningStock + ")";
  if (outEl) outEl.textContent = "经验奖励：" + display.current.baseXP + " / 次";
  const select = document.getElementById("smelting-area-select"); if (select) select.style.display = "flex";
  const stats = document.getElementById("smelting-stats"); if (stats) stats.style.display = "block";
  const dropdown = document.getElementById("smelting-dropbtn"); if (dropdown) dropdown.textContent = getResourceDisplayName(display.current.outputMineral) + " ▾";
  const efficiency = document.getElementById("smelting-eff-value");
  if (efficiency) {
    efficiency.textContent = display.efficiency.toFixed(2);
    efficiency.title = "技能速度：1 × (1 + " + display.level + " × 0.02) = " + display.skillEfficiency.toFixed(2) + "x" + (display.shipBonus > 0 ? "\n舰船冶炼加速：" + display.ship.name + " +" + (display.shipBonus * 100).toFixed(0) + "%" : "\n舰船冶炼加速：无") + "\n空间站综合后勤：×" + (display.stationLogisticsMultiplier || 1).toFixed(2) + "（" + ((display.stationLogistics && display.stationLogistics.text) || "未建立") + "）" + "\n最终速度：" + display.efficiency.toFixed(2) + "x\n\n基础时间：" + display.current.baseTime + "s\n实际时间：" + display.actualTime.toFixed(1) + "s\n产量只受冶炼技能影响，舰船只缩短时间";
  }
  const output = document.getElementById("smelting-output-qty"); if (output) output.textContent = display.output;
  const support = document.getElementById("smelting-ship-support"); if (support) support.textContent = display.shipBonus > 0 ? display.ship.name + " · 速度 +" + (display.shipBonus * 100).toFixed(0) + "%" : "未分配";
  const cycleTimes = document.getElementById("smelting-cycle-times");
  if (cycleTimes) cycleTimes.textContent = display.current.baseTime.toFixed(1) + "s → " + display.actualTime.toFixed(1) + "s";
  const outputNote = document.getElementById("smelting-output-note"); if (outputNote) outputNote.textContent = "支援舰只缩短冶炼周期，单次仍产出 " + display.output;
  setProductionControls(display, document.getElementById("btn-start-smelt"));
  drawSkillBar(document.getElementById("bar-smelting"), display.progress.percent, "gold");
  const eta = document.getElementById("smelting-eta"); if (eta) eta.textContent = display.progress.etaText;
}

function renderGasDisplay(display, areaEl, outEl) {
  if (areaEl) areaEl.textContent = "目标气体：" + display.current.gas;
  if (outEl) outEl.textContent = "经验奖励：" + display.current.baseXP + " / 次";
  const select = document.getElementById("gas-area-select"); if (select) select.style.display = "flex";
  const stats = document.getElementById("gas-stats"); if (stats) stats.style.display = "block";
  const dropdown = document.getElementById("gas-dropbtn"); if (dropdown) dropdown.textContent = display.current.gas + " ▾";
  const efficiency = document.getElementById("gas-eff-value"); if (efficiency) { efficiency.textContent = display.efficiency.total.toFixed(2); efficiency.title = display.efficiencyTooltip; }
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

function renderGasDropdown() {
  const display = getGasDisplayState(gameState, Date.now());
  const content = document.getElementById("gas-dropdown-content");
  const button = document.getElementById("gas-dropbtn");
  if (!content || !button) return;
  button.textContent = display.current.gas + " ▾";
  content.innerHTML = display.options.map(area => {
    const className = (area.selected ? " selected" : "") + (area.locked ? " locked" : "");
    const requirement = area.locked ? `<span class="area-req">需气体采集 Lv.${area.level}</span>` : "";
    return `<div class="area-option${className}" data-area="${area.name}">${area.gas} — ${area.baseTime}s / ${area.baseXP}XP${requirement}</div>`;
  }).join("");
  content.querySelectorAll(".area-option:not(.locked)").forEach(option => option.addEventListener("click", event => {
    event.stopPropagation();
    switchGasArea(option.dataset.area);
    content.classList.remove("show");
  }));
}

function renderSmeltingDropdown() {
  const display = getSmeltingDisplayState(gameState, Date.now());
  const content = document.getElementById("smelting-dropdown-content");
  const button = document.getElementById("smelting-dropbtn");
  if (!content || !button) return;
  button.textContent = display.current.outputMineral + " ▾";
  content.innerHTML = display.options.map(recipe => {
    const className = (recipe.selected ? " selected" : "") + (recipe.locked ? " locked" : "");
    const requirement = recipe.locked ? `<span class="area-req">需冶炼 Lv.${recipe.level}</span>` : "";
    return `<div class="area-option${className}" data-area="${recipe.name}">${getResourceDisplayName(recipe.consumeOre)} → ${getResourceDisplayName(recipe.outputMineral)} — ${recipe.baseTime}s / ${recipe.baseXP}XP${requirement}</div>`;
  }).join("");
  content.querySelectorAll(".area-option:not(.locked)").forEach(option => option.addEventListener("click", event => {
    event.stopPropagation();
    switchSmeltingRecipe(option.dataset.area);
    content.classList.remove("show");
  }));
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
  const quickEl = document.querySelector('.ore-quick');
  if (quickEl) quickEl.innerHTML = display.quickOres.length ? display.quickOres.map(item => `<span class="ore-icon">${item.name} × ${item.value.toLocaleString()}</span>`).join("") : '<span class="ore-icon">暂无矿石</span>';
  const cargoText = document.getElementById("cargo-text");
  if (cargoText) { cargoText.textContent = display.inventory.total.toLocaleString(); }
}

function updateUI(now) {
  const renderTime = Number(now) || Date.now();
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
  const levelEl = document.querySelector('.skill-current .lv-num'); if (levelEl) levelEl.textContent = shell.level;
  const areaEl = document.querySelector('.skill-current .skill-area');
  const outEl = document.querySelector('.skill-current .skill-output');
  ["mining-area-select", "mining-stats", "smelting-area-select", "smelting-stats", "gas-area-select", "gas-stats"].forEach(id => { const element = document.getElementById(id); if (element) element.style.display = "none"; });
  setProductionControls({ showStart:false, showStop:false, canStart:false }, null);

  if (currentPage === "skill") {
    if (viewKey === "mining") renderMiningDisplay(getMiningDisplayState(gameState, renderTime), areaEl, outEl);
    else if (viewKey === "refining") renderSmeltingDisplay(getSmeltingDisplayState(gameState, renderTime), areaEl, outEl);
    else if (viewKey === "gasHarvesting") renderGasDisplay(getGasDisplayState(gameState, renderTime), areaEl, outEl);
    else if (viewKey === "shipEngineering") {
      const sep = document.getElementById("shipeng-panel"); if (sep) sep.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderShipEngineeringPage();
    } else if (viewKey === "equipmentEngineering") {
      const eep = document.getElementById("equipeng-panel"); if (eep) eep.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderEquipEngPage();
    } else if (viewKey === "boosterEngineering") {
      const bp = document.getElementById("booster-panel"); if (bp) bp.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderBoosterPage(renderTime);
    } else if (viewKey === "combat") {
      const combatPanel = document.getElementById("combat-panel");
      if (combatPanel) combatPanel.style.display = "";
      const sc = document.querySelector('.skill-current'); if (sc) sc.style.display = "none";
      renderCombatPanel();
    }
  }

  const fillEl = document.querySelector('.skill-current .fill.exp'); if (fillEl) fillEl.style.width = shell.xpPercent + "%";
  const expVal = document.querySelector('.skill-current .exp-value'); if (expVal) expVal.textContent = shell.xp.toLocaleString() + " / " + shell.xpNeeded.toLocaleString();
  renderGlobalDisplay(getGlobalDisplayState(gameState));
  renderSidebar(getSidebarDisplayState(gameState));
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
  const globalDisplay = getGlobalDisplayState(gameState);
  const iskEl = document.querySelector('.res-value.isk');
  const lpEl = document.querySelector('.res-value.lp');
  setLiveText(iskEl, formatCompact(globalDisplay.isk));
  setLiveText(lpEl, formatCompact(globalDisplay.lp));

  const cargoText = document.getElementById("cargo-text");
  if (cargoText) {
    setLiveText(cargoText, globalDisplay.inventory.total.toLocaleString());
  }

  const quickEl = document.querySelector('.ore-quick');
  if (quickEl) {
    const html = globalDisplay.quickOres.length
      ? globalDisplay.quickOres.map(item => `<span class="ore-icon">${item.name} × ${item.value.toLocaleString()}</span>`).join("")
      : '<span class="ore-icon">暂无矿石</span>';
    if (quickEl.innerHTML !== html) quickEl.innerHTML = html;
  }

  renderSidebar(getSidebarDisplayState(gameState));
  if (currentPage === "planetary") updatePlanetaryLiveUI();
  if (currentPage === "skill" && currentView === "combat") updateCombatLiveUI();
  // 空间站 / 研究 实时刷新：currentPage 为唯一主判断（仅当前可见页才刷）。
  // 注意：document.hidden 不在此处做门控（只作参考），避免无头/后台环境导致刷新测试全失效。
  // 节流与展示态计算已分别约束在 updateStationLiveUI / updateResearchLiveUI 内部。
  if (currentPage === "station" && typeof updateStationLiveUI === "function") updateStationLiveUI(now);
  else if (currentPage === "research" && typeof updateResearchLiveUI === "function") updateResearchLiveUI(now);
}

function refreshVisiblePanelAfterAction() {
  if (currentPage === "skill") updateUI();
  else if (currentPage === "cargo") renderCargoPage();
  else if (currentPage === "hangar") renderHangarPanel();
  else if (currentPage === "station" && typeof renderStationPage === "function") renderStationPage(Date.now());
}

/* ================================================================
   事件绑定
   ================================================================ */

(function bindProductionSelectors() {
  document.querySelectorAll(".mining-mode-tab").forEach(tab => tab.addEventListener("click", () => switchMiningMode(tab.dataset.mode)));
  const gasButton = document.getElementById("gas-dropbtn");
  const gasContent = document.getElementById("gas-dropdown-content");
  if (gasButton && gasContent) {
    gasButton.addEventListener("click", event => { event.stopPropagation(); renderGasDropdown(); gasContent.classList.toggle("show"); });
    document.addEventListener("click", () => gasContent.classList.remove("show"));
  }
  const smeltingButton = document.getElementById("smelting-dropbtn");
  const smeltingContent = document.getElementById("smelting-dropdown-content");
  if (smeltingButton && smeltingContent) {
    smeltingButton.addEventListener("click", event => { event.stopPropagation(); renderSmeltingDropdown(); smeltingContent.classList.toggle("show"); });
    document.addEventListener("click", () => smeltingContent.classList.remove("show"));
  }
})();

(function bindCargoEvents() {
  const sortBtn = document.getElementById("btn-sort-cargo"); if (sortBtn) sortBtn.addEventListener("click", () => alert("功能开发中"));
})();

(function bindButtons() {
  const stopBtn = document.getElementById("btn-stop"); const switchBtn = document.getElementById("btn-switch-skill");
  const startSmeltBtn = document.getElementById("btn-start-smelt"); const startMineBtn = document.getElementById("btn-start-mine"); const startGasBtn = document.getElementById("btn-start-gas");
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
})();

dispatchGameAction(gameState, { type:"production/ensureMiningArea" }, Date.now());
setInterval(() => RuntimeGuard.runCritical("gameTick", gameTick), 1000);

let _lastProgressFrame = 0;
let _lastPlanetFrame = 0;
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
    else if (currentPage === "skill" && currentView === key && key === "refining") { drawSkillBar(document.getElementById("bar-smelting"), pct, "gold"); const e = document.getElementById("smelting-eta"); if (e) e.textContent = eta; }
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
  });

  requestAnimationFrame(renderLoop);
})();

updateUI();
