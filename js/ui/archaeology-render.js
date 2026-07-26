/* ================================================================
   考古系统 UI 渲染
   ================================================================ */

function renderArchaeologyPage(now) {
  const renderTime = Number(now) || Date.now();
  const display = getArchaeologyDisplayState(gameState, renderTime);
  const body = document.getElementById("archaeology-body");
  const status = document.getElementById("archaeology-header-status");
  if (!body) return;

  const arch = display.archaeology;
  const logText = document.getElementById("archaeology-logistics");
  if (logText) {
    const sl = display.stationLogistics || {};
    logText.textContent = (sl.bodyLevel > 0 && sl.operational) ? "后勤 " + sl.text : "后勤未生效（" + (sl.text || "未建立") + "）";
  }
  const activeSiteId = arch.active ? (arch.startedSiteId || arch.activeSiteId) : arch.activeSiteId;
  const ship = display.assignedShip;

  // 周期时间格式化：整数不带小数，含加速时保留 1 位
  const fmtTime = t => Number.isFinite(t) ? (Number.isInteger(t) ? String(t) : t.toFixed(1)) : "0";

  // ---- 状态行 ----
  let statusText = "待命";
  if (arch.repairing) statusText = "🔧 自动维修中 " + arch.repairRemaining + "s";
  else if (arch.interference) statusText = "⚠ 信号干扰 " + arch.interferenceRemaining + "s";
  else if (arch.active) {
    const runningSite = display.sites.find(s => s.id === activeSiteId);
    statusText = "🛰️ 解析中 · " + (runningSite ? runningSite.name : activeSiteId || "");
  }
  if (status) status.textContent = statusText;

  // ---- 分配舰船 ----
  const shipSection = ship ? `
    <div class="archaeology-ship-info">
      <div class="archaeology-ship-header">
        <span class="archaeology-ship-name">🛰️ ${ship.name} <span class="archaeology-ship-type">${ship.type}</span></span>
      </div>
      ${ship.hp && ship.maxHp ? `
        <div class="archaeology-hp-bars">
          ${renderHpBar("护盾", ship.hp.shield, ship.maxHp.shield, "#4ac87a")}
          ${renderHpBar("装甲", ship.hp.armor, ship.maxHp.armor, "#d4a843")}
          ${renderHpBar("结构", ship.hp.structure, ship.maxHp.structure, "#e05555")}
        </div>` : ""}
    </div>
  ` : `<div class="archaeology-no-ship">
    <span>⚠ 未分配考古舰船</span>
    <small>在「船坞」页面将考古舰船分配至考古岗位</small>
  </div>`;

  // ---- 遗迹选择 ----
  const tierLabels = { I:"T1 低安", II:"T2 中安", III:"T3 高安", IV:"T4 旗舰", V:"T5 超旗" };
  const siteCards = groupBy(display.sites, "tier");
  const siteSection = Object.entries(tierLabels).map(([tier, label]) => {
    const sites = siteCards[tier] || [];
    if (!sites.length) return "";
    const cards = sites.map(site => `
      <button class="archaeology-site-card${site.selected ? " selected" : ""}${site.locked ? " locked" : ""}"
        data-site-id="${site.id}"
        ${site.locked || arch.repairing || arch.active ? "disabled" : ""}>
        <span class="asc-name">${site.name}</span>
        <span class="asc-profile">${site.profile && site.profile.label ? "🏷️ " + site.profile.label : ""}</span>
        <span class="asc-meta">Lv.${site.level} · ⏱${fmtTime(site.actualCycleTime)}s/次${site.archSpeedEff && site.archSpeedEff !== 1 ? ` <span class="asc-base">增强剂 ×${site.archSpeedEff.toFixed(2)}</span>` : ""}${site.archLogisticsMult && site.archLogisticsMult > 1 ? ` <span class="asc-base">后勤 ×${site.archLogisticsMult.toFixed(2)}</span>` : ""}${site.archSpeedEff && site.archSpeedEff !== 1 || (site.archLogisticsMult && site.archLogisticsMult > 1) ? ` <span class="asc-base">(基础${site.time}s)</span>` : ""} · ⛽${site.fuel}</span>
        <span class="asc-detail">
          <span>难度 ${site.difficulty}</span>
          <span>成功率 ${site.successPercent}%</span>
          <span>反噬 ${site.effectiveBacklash || site.backlashDamage}</span>
          <span>LP ×${site.preview ? site.preview.effectiveLpMultiplier : site.lpMultiplier}</span>
        </span>
        ${site.drops ? `
        <span class="asc-drops">
          <span class="ad-line"><span class="ad-icon">📜</span> ${site.drops.common.text}${site.preview ? " · 译码器+" + site.preview.decoderPct + "%" : ""}</span>
          <span class="ad-line"><span class="ad-icon">🔬</span> 独特文物 ${site.drops.unique.ratePct}%${site.drops.unique.ratePct !== site.drops.unique.boostedPct ? ` <span class="ad-boost">(增强 +${(site.drops.unique.boostedPct - site.drops.unique.ratePct).toFixed(1)}%)</span>` : ""}</span>
          <span class="ad-line"><span class="ad-icon">🎖</span> LP 文物 ${site.drops.lp.ratePct}%${site.drops.lp.item ? " · " + site.drops.lp.item.lpValue + " LP" : ""}</span>
          <span class="ad-line"><span class="ad-icon">🔧</span> 校准材料 ${site.drops.calibration.ratePct}% · ×${site.drops.calibration.amount}</span>
          ${site.preview ? `<span class="ad-line ad-expected"><span class="ad-icon">📈</span> 单次期望 ${Math.round(site.preview.expectedIskPerCycle).toLocaleString()} ISK · ${site.preview.expectedLpPerCycle.toFixed(2)} LP · ${site.preview.expectedCalibPerCycle.toFixed(2)} 校准</span>` : ""}
        </span>` : ""}
        <span class="asc-state">${site.runningTarget ? "解析中" : site.levelLocked ? `需考古 Lv.${site.level}` : site.actionLocked ? "行动中不可切换" : site.selected ? "已选择" : "可解析"}</span>
      </button>
    `).join("");
    return `<div class="archaeology-tier-group">
      <div class="archaeology-tier-label">${label}</div>
      <div class="archaeology-site-grid">${cards}</div>
    </div>`;
  }).join("");

  // ---- 探针选择 ----
  const probeSection = display.probes.map(probe => `
    <button class="archaeology-probe-card${probe.selected ? " selected" : ""}${probe.locked ? " locked" : ""}"
      data-probe-id="${probe.id}"
      ${probe.locked || arch.repairing || arch.active ? "disabled" : ""}>
      <span class="apc-name">${probe.name}</span>
      <span class="apc-bonus">扫描 +${probe.scanBonus}</span>
      <span class="apc-stock">库存 ${probe.stock}</span>
      <span class="apc-level">需 Lv.${probe.level}</span>
    </button>
  `).join("");

  // ---- 进度条（与采矿共用 drawSkillBar） ----
  const activeSite = display.sites.find(s => s.id === activeSiteId);
  const progressSection = arch.active ? `
    <div class="archaeology-progress">
      <div class="archaeology-progress-header">
        <span>解析 ${activeSite ? activeSite.name : arch.activeSiteId}</span>
        <span>${activeSite ? fmtTime(activeSite.actualCycleTime) + "s / 次" : ""}</span>
      </div>
      <canvas class="skill-canvas-bar" id="bar-archaeology" width="560" height="24"></canvas>
    </div>
  ` : "";

  // ---- 控制按钮 ----
  const canStart = ship && display.canAssign && !arch.repairing && !arch.interference && !arch.active && activeSiteId;
  const controls = `
    <div class="archaeology-controls">
      <button class="btn danger" id="archaeology-btn-stop" ${arch.active ? "" : 'style="display:none;"'}>■ 停止解析</button>
      <button class="btn primary" id="archaeology-btn-start" ${canStart && !arch.active ? "" : 'style="display:none;"'}>▶ 开始解析</button>
    </div>
  `;

  // ---- 文物库存 ----
  const artifactSection = display.artifacts.length ? `
    <div class="archaeology-artifacts">
      <div class="archaeology-section-title">📦 文物库存</div>
      <div class="archaeology-artifact-header">
        <button class="btn" id="archaeology-sell-all">💰 出售全部 ISK 文物</button>
        <button class="btn" id="archaeology-redeem-all">🎖 兑换全部 LP 文物</button>
      </div>
      <div class="archaeology-artifact-grid">
        ${display.artifacts.map(row => {
          const a = row.artifact;
          const isLP = a.category === "lp";
          const isCal = a.category === "calibration";
          const sellBtn = isLP ? `<button class="btn archaeology-redeem-btn" data-artifact-id="${a.id}">🎖 兑换 LP</button>`
            : isCal ? `<span class="archaeology-cal-note">（未来用途）</span>`
            : `<button class="btn archaeology-sell-btn" data-artifact-id="${a.id}">💰 出售</button>`;
          return `<div class="archaeology-artifact-card">
            <span class="aac-name">${isLP ? "🎖 " : isCal ? "🔬 " : "📜 "}${a.name}</span>
            <span class="aac-tier">${a.tier}</span>
            <span class="aac-count">×${row.count}</span>
            ${a.iskValue ? `<span class="aac-value">${a.iskValue.toLocaleString()} ISK</span>` : ""}
            ${a.lpValue ? `<span class="aac-value">${a.lpValue} LP</span>` : ""}
            ${sellBtn}
          </div>`;
        }).join("")}
      </div>
    </div>
  ` : `<div class="archaeology-section-title" style="color:#4a5a6a;">📦 暂无文物</div>`;

  // ---- 行动日志 ----
  const logSection = arch.log.length ? `
    <div class="archaeology-log">
      <div class="archaeology-section-title">📋 最近行动</div>
      <div class="archaeology-log-list">
        ${arch.log.map(entry => {
          const icon = entry.type === "success" ? "✅" : entry.type === "failure" ? "❌" : entry.type === "repair" ? "🔧" : "📋";
          return `<div class="archaeology-log-entry">
            <span class="ale-icon">${icon}</span>
            <span class="ale-site">${entry.site || ""}</span>
            <span class="ale-detail">${entry.detail || ""}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
  ` : "";

  body.innerHTML = `
    ${shipSection}
    ${progressSection}
    ${controls}
    <div class="archaeology-section-title">📍 选择遗迹</div>
    <div class="archaeology-site-section">${siteSection}</div>
    <div class="archaeology-section-title">📡 选择探针</div>
    <div class="archaeology-probe-row">${probeSection}</div>
    ${artifactSection}
    ${logSection}
  `;

  // ---- 事件绑定 ----
  bindArchaeologyEvents(body);

  return display;
}

function renderHpBar(label, current, max, color) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return `<div class="archaeology-hp-row">
    <span class="ahp-label">${label}</span>
    <div class="progress-bar" style="height:4px;flex:1;margin:0 6px;">
      <div class="fill" style="width:${pct}%;background:${color};"></div>
    </div>
    <span class="ahp-value" style="color:${pct < 20 ? "#e05555" : "#8899aa"};">${Math.ceil(current)}/${max}</span>
  </div>`;
}

function groupBy(arr, key) {
  const result = {};
  for (const item of arr) {
    const k = item[key];
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}

function bindArchaeologyEvents(body) {
  // 遗迹选择
  body.querySelectorAll(".archaeology-site-card:not([disabled])").forEach(card => {
    card.addEventListener("click", () => {
      const siteId = card.dataset.siteId;
      const result = dispatchGameAction(gameState, { type:"archaeology/selectSite", siteId }, Date.now());
      if (result.changed) renderArchaeologyPage();
    });
  });

  // 探针选择
  body.querySelectorAll(".archaeology-probe-card:not([disabled])").forEach(card => {
    card.addEventListener("click", () => {
      const probeId = card.dataset.probeId;
      const result = dispatchGameAction(gameState, { type:"archaeology/selectProbe", probeId }, Date.now());
      if (result.changed) renderArchaeologyPage();
    });
  });

  // 开始/停止
  const startBtn = body.querySelector("#archaeology-btn-start");
  const stopBtn = body.querySelector("#archaeology-btn-stop");
  if (startBtn) startBtn.addEventListener("click", () => { hideActionConfirm(); showActionConfirm("archaeology"); });
  if (stopBtn) stopBtn.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"archaeology/stop" }, Date.now());
    if (result.changed) { showToast("已停止考古行动"); renderArchaeologyPage(); updateUI(); }
  });

  // 出售/兑换文物
  body.querySelectorAll(".archaeology-sell-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const artifactId = btn.dataset.artifactId;
      const result = dispatchGameAction(gameState, { type:"archaeology/sellArtifact", artifactId, quantity:1 }, Date.now());
      if (result.changed) { showToast("出售文物获得 " + result.isk.toLocaleString() + " ISK"); renderArchaeologyPage(); updateUI(); }
    });
  });
  body.querySelectorAll(".archaeology-redeem-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const artifactId = btn.dataset.artifactId;
      const result = dispatchGameAction(gameState, { type:"archaeology/redeemArtifact", artifactId, quantity:1 }, Date.now());
      if (result.changed) { showToast("兑换文物获得 " + result.lp + " LP"); renderArchaeologyPage(); updateUI(); }
    });
  });

  // 全部出售/兑换
  const sellAll = body.querySelector("#archaeology-sell-all");
  const redeemAll = body.querySelector("#archaeology-redeem-all");
  if (sellAll) sellAll.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"archaeology/sellArtifact", all:true }, Date.now());
    if (result.changed) { showToast("出售全部文物获得 " + result.totalIsk.toLocaleString() + " ISK"); renderArchaeologyPage(); updateUI(); }
  });
  if (redeemAll) redeemAll.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"archaeology/redeemArtifact", all:true }, Date.now());
    if (result.changed) { showToast("兑换全部文物获得 " + result.totalLp.toLocaleString() + " LP"); renderArchaeologyPage(); updateUI(); }
  });
}
