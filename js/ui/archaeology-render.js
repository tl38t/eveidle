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
  const ship = display.assignedShip;

  // ---- 状态行 ----
  let statusText = "待命";
  if (arch.repairing) statusText = "🔧 自动维修中 " + arch.repairRemaining + "s";
  else if (arch.interference) statusText = "⚠ 信号干扰 " + arch.interferenceRemaining + "s";
  else if (arch.active) statusText = "🛰️ 解析中 · " + (arch.activeSiteId || "");
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
        ${site.locked || arch.repairing ? "disabled" : ""}>
        <span class="asc-name">${site.name}</span>
        <span class="asc-meta">Lv.${site.level} · ${site.time}s · ⛽${site.fuel}</span>
        <span class="asc-detail">
          <span>难度 ${site.difficulty}</span>
          <span>成功率 ${site.successPercent}%</span>
          <span>反噬 ${site.backlashDamage}</span>
          <span>LP ×${site.lpMultiplier}</span>
        </span>
        <span class="asc-state">${site.locked ? `需考古 Lv.${site.level}` : site.selected ? "已选择" : "可解析"}</span>
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
      ${probe.locked || arch.repairing ? "disabled" : ""}>
      <span class="apc-name">${probe.name}</span>
      <span class="apc-bonus">扫描 +${probe.scanBonus}</span>
      <span class="apc-stock">库存 ${probe.stock}</span>
      <span class="apc-level">需 Lv.${probe.level}</span>
    </button>
  `).join("");

  // ---- 进度条 ----
  const activeSite = display.sites.find(s => s.id === arch.activeSiteId);
  const progressSection = arch.active ? `
    <div class="archaeology-progress">
      <div class="archaeology-progress-header">
        <span>解析 ${activeSite ? activeSite.name : arch.activeSiteId}</span>
        <span>${activeSite ? activeSite.time + "s / 次" : ""}</span>
      </div>
      <div class="progress-bar" style="height:8px;">
        <div class="fill" style="width:${arch.progress}%; background:linear-gradient(90deg,#4ac87a,#7ae89a);"></div>
      </div>
    </div>
  ` : "";

  // ---- 控制按钮 ----
  const canStart = ship && display.canAssign && !arch.repairing && !arch.interference && arch.activeSiteId;
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
  if (startBtn) startBtn.addEventListener("click", () => {
    const result = dispatchGameAction(gameState, { type:"archaeology/start" }, Date.now());
    if (result.changed) { showToast("开始解析遗迹"); renderArchaeologyPage(); updateUI(); }
    else {
      const reasons = {
        "no-assigned-ship":"未分配考古舰船",
        "repairing":"舰船维修中",
        "interference":"信号干扰中",
        "no-site":"请先选择遗迹",
        "no-probe":"探针不足",
        "no-fuel":"燃料不足",
        "level-too-low":"考古等级不足"
      };
      showToast(reasons[result.reason] || "无法开始考古行动");
    }
  });
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
