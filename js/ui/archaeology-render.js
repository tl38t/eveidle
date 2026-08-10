/* ================================================================
   考古系统 UI 渲染（重做 Phase C）
   三栏工作台：左=5 个地点；中=选中地点详情 + 三焦点 + 运行面板；
   右=当前地点稀有档案（蓝图 / 实物 / 脑插）+ 校准说明。
   运行时仍按「具体遗迹 site_X_y」选择（遗迹 id 内含地点 tier 与焦点 a/b/c）。
   ================================================================ */

// 焦点元数据（a=星币 b=功勋 c=货柜），与 ARCHAEOLOGY_FOCUS_REGULAR_WEIGHTS 对应
const ARCH_FOCUS_META = {
  a: { key:"coin",  icon:"◉", title:"星币焦点", sub:"偏向可回收商业物资",
       yieldTitle:"商业回收物资", yieldCopy:"常规成功偏向可回收为星币的物品；不会改变蓝图、凭证、探针或脑插概率。" },
  b: { key:"merit", icon:"✦", title:"功勋焦点", sub:"偏向军警与联盟档案",
       yieldTitle:"军警功勋档案", yieldCopy:"常规成功偏向可回收为功勋的档案；不会改变蓝图、凭证、探针或脑插概率。" },
  c: { key:"cargo", icon:"▣", title:"货柜焦点", sub:"偏向未开启标准货柜",
       yieldTitle:"舰队密封货柜", yieldCopy:"常规成功偏向未开启货柜；货柜内容仍由统一货柜系统决定。" }
};

// 地点描述（纯展示文案，与运行时数据解耦）
const ARCH_LOCATION_DESC = {
  I:"破损导航信标与民用残骸散布在边疆航道，适合完成第一批实地解析。",
  II:"停摆的精炼设施与装配环保存着大量工业档案，部分商业接口仍能响应。",
  III:"大规模舰队残骸沿失效航道漂流，军用数据库与密封货舱仍可能保持完整。",
  IV:"被封锁的研究设施仍维持危险的自动防护，留下高价值制造记录与深层信号。",
  V:"先驱文明的核心节点藏在深空干扰层内，只有顶级测绘舰与探针能够稳定接近。"
};

const ARCH_TIER_ORDER = ["I","II","III","IV","V"];

function archFocusFromSite(siteId) {
  if (typeof siteId !== "string" || siteId.length < 2) return "a";
  const suf = siteId.slice(-1).toLowerCase();
  return (suf === "a" || suf === "b" || suf === "c") ? suf : "a";
}

function archBlueprintName(id) {
  if (typeof getEquipmentBlueprint === "function") { const e = getEquipmentBlueprint(id); if (e && e.name) return e.name; }
  if (typeof getBoosterRecipe === "function") { const b = getBoosterRecipe(id); if (b && b.name) return b.name; }
  if (typeof getBoosterItem === "function") { const bi = getBoosterItem(id); if (bi && bi.name) return bi.name; }
  if (typeof getArchaeologyProbe === "function") { const p = getArchaeologyProbe(id); if (p && p.name) return p.name; }
  if (typeof ARCHAEOLOGY_VOUCHERS === "object" && ARCHAEOLOGY_VOUCHERS[id] && ARCHAEOLOGY_VOUCHERS[id].name) return ARCHAEOLOGY_VOUCHERS[id].name;
  return id;
}

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

  // ---- 本舰重创维修面板（按舰隔离：仅当前编入实例维修时显示） ----
  const repairPanel = (arch.repairing && ship) ? `
    <div class="archaeology-repair-panel">
      <div class="arch-repair-title">🔧 本舰重创 · 自动维修中 ${arch.repairRemaining}s</div>
      <div class="arch-repair-detail">结构归零触发维修；维修完成且本舰仍编入、燃料与探针充足时将自动恢复解析。</div>
      <button class="btn" id="archaeology-btn-swap-ship">🚀 更换考古舰（前往船坞）</button>
    </div>` : "";

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
      ${repairPanel}
    </div>
  ` : `<div class="archaeology-no-ship">
    <span>⚠ 未分配考古舰船</span>
    <small>在「船坞」页面将考古舰船分配至考古岗位</small>
  </div>`;

  // 当前选中地点 / 焦点
  const selectedTier = (activeSiteId && getArchaeologySite(activeSiteId)) ? getArchaeologySite(activeSiteId).tier : (display.sites[0] ? display.sites[0].tier : "I");
  const selectedFocus = archFocusFromSite(activeSiteId);
  const selectedLocation = (typeof ARCHAEOLOGY_LOCATIONS !== "undefined") ? ARCHAEOLOGY_LOCATIONS.find(l => l.tier === selectedTier) : null;
  const selectedSite = display.sites.find(s => s.id === activeSiteId) || display.sites.find(s => s.tier === selectedTier) || null;
  const lockSel = arch.repairing || arch.active;

  // ---- 左栏：5 个地点 ----
  const locationCards = (typeof ARCHAEOLOGY_LOCATIONS !== "undefined" ? ARCHAEOLOGY_LOCATIONS : []).map(loc => {
    const lv = gameState.skills.archaeology.lvl || 1;
    const locked = lv < loc.level;
    const isSel = loc.tier === selectedTier;
    const cargoSizes = (loc.cargoWeights || []).map(c => c.size).join(" / ");
    const stateLabel = isSel ? "当前地点" : (locked ? "需考古 Lv." + loc.level : "已勘明");
    return `<button class="arch-location${isSel ? " active" : ""}${locked ? " locked" : ""}"
        data-loc-tier="${loc.tier}" ${locked || lockSel ? "disabled" : ""}>
        <span class="arch-loc-mark">${loc.tier}</span>
        <span class="arch-loc-main"><span class="arch-loc-name">${loc.name}</span><span class="arch-loc-meta">Lv.${loc.level} · ${cargoSizes} 货柜</span></span>
        <span class="arch-loc-state">${stateLabel}</span>
      </button>`;
  }).join("");

  // ---- 中栏：地点详情 + 三焦点 + 产出示意 + 运行面板 ----
  const locName = selectedLocation ? selectedLocation.name : (selectedSite ? selectedSite.name : "考古");
  const locCopy = selectedLocation ? (ARCH_LOCATION_DESC[selectedTier] || "") : "";
  const riskText = selectedSite ? `难度 ${selectedSite.difficulty} · 反噬 ${selectedSite.effectiveBacklash || selectedSite.backlashDamage}` : "";

  const focusTabs = ARCH_TIER_ORDER.length ? ["a","b","c"].map(f => {
    const fm = ARCH_FOCUS_META[f];
    const siteId = selectedLocation ? selectedLocation.foci[f] : null;
    const site = siteId ? display.sites.find(s => s.id === siteId) : null;
    const isActive = f === selectedFocus;
    return `<button class="arch-focus${isActive ? " active" : ""}" data-site-id="${siteId || ""}" ${!site || site.locked || lockSel ? "disabled" : ""}>
        <b>${fm.icon} ${fm.title}</b><small>${fm.sub}</small>
      </button>`;
  }).join("") : "";

  // 产出示意卡（按焦点）
  const fm = ARCH_FOCUS_META[selectedFocus];
  let yieldBody = "";
  if (selectedFocus === "c" && selectedLocation) {
    const sizes = selectedLocation.cargoWeights || [];
    const maxW = sizes.reduce((m, c) => Math.max(m, c.weight), 0);
    yieldBody = `<div class="arch-cargo-mix">${sizes.map(c => `<span class="arch-cargo-pill${c.weight === maxW ? " main" : ""}">${c.size}</span>`).join("")}</div>`;
  } else if (selectedFocus === "a" && selectedSite && selectedSite.drops) {
    yieldBody = `<p class="arch-yield-sub">常规成功 → 星币文物（低 / 中 / 高三档，按档内权重抽取）</p>`;
  } else if (selectedFocus === "b" && selectedSite && selectedSite.drops) {
    yieldBody = `<p class="arch-yield-sub">常规成功 → 功勋文物（固定功勋值）</p>`;
  }

  // 运行面板
  const runTitle = (arch.active ? "正在解析 · " : "准备解析 · ") + fm.title;
  const runClock = selectedSite ? fmtTime(selectedSite.actualCycleTime) + "s / 次" : "";
  const progressSection = arch.active ? `
    <div class="archaeology-progress">
      <div class="archaeology-progress-header">
        <span>解析 ${selectedSite ? selectedSite.name : activeSiteId}</span>
        <span>${runClock}</span>
      </div>
      <canvas class="skill-canvas-bar" id="bar-archaeology" width="560" height="24"></canvas>
    </div>
  ` : "";

  const canStart = ship && display.canAssign && !arch.repairing && !arch.interference && !arch.active && activeSiteId;
  const controls = `
    <div class="archaeology-controls">
      <button class="btn danger" id="archaeology-btn-stop" ${arch.active ? "" : 'style="display:none;"'}>■ 停止解析</button>
      <button class="btn primary" id="archaeology-btn-start" ${canStart && !arch.active ? "" : 'style="display:none;"'}>▶ 开始解析</button>
    </div>
  `;

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

  const runStats = selectedSite ? `
    <div class="arch-run-stats">
      <div class="arch-run-stat"><label>成功率</label><b>${selectedSite.successPercent}%</b></div>
      <div class="arch-run-stat"><label>每周期燃料</label><b>${selectedSite.nextFuelCost}</b></div>
      <div class="arch-run-stat"><label>探针消耗</label><b>${selectedSite.nextProbeCost}</b></div>
      <div class="arch-run-stat"><label>经验</label><b>${selectedSite.xp} XP</b></div>
    </div>` : "";

  const detailColumn = `
    <div class="arch-detail-head">
      <div><h1 class="arch-place-name">${locName}</h1><p class="arch-place-copy">${locCopy}</p></div>
      <div class="arch-risk"><label>反噬威胁</label><b>${riskText}</b></div>
    </div>
    <div class="arch-focus-title">选择回收焦点</div>
    <div class="arch-focus-tabs">${focusTabs}</div>
    <div class="arch-yield-card">
      <div class="arch-yield-icon">${fm.icon}</div>
      <div><b class="arch-yield-title">${fm.yieldTitle}</b><p class="arch-yield-copy">${fm.yieldCopy}</p></div>
      ${yieldBody}
    </div>
    <div class="arch-run-panel">
      <div class="arch-run-top"><b>${runTitle}</b><span>${runClock}</span></div>
      ${runStats}
      <div class="arch-focus-title">选择探针</div>
      <div class="arch-probe-row">${probeSection}</div>
    </div>
    ${controls}
  `;

  // ---- 右栏：当前地点稀有档案 ----
  let rareArchive = "";
  if (selectedLocation) {
    const eqBps = selectedLocation.equipmentBlueprints || [];
    const boBps = selectedLocation.boosterBlueprints || [];
    const prBps = selectedLocation.probeBlueprints || [];
    const owned = new Set(gameState.ownedBlueprints || []);
    const bpList = []
      .concat(eqBps.map(id => ({ id, kind:"equipment" })))
      .concat(boBps.map(id => ({ id, kind:"booster" })));
    const blueprintRows = bpList.map((b, i) => {
      const ownedKey = b.kind === "equipment" ? "equipment:" + b.id : (b.kind === "booster" ? "booster:" + b.id : null);
      const isOwned = ownedKey ? owned.has(ownedKey) : false;
      const sub = i === 0 ? "地点标志性蓝图" : "未拥有时进入有效蓝图池";
      return rewardRow("⌘", archBlueprintName(b.id), isOwned ? ("已拥有 · " + sub) : sub, i === 0 ? "epic" : "rare", isOwned);
    }).join("");

    const itemIds = [];
    (selectedLocation.probeBlueprints || []).forEach(id => itemIds.push(id));
    if (selectedLocation.credential) itemIds.push(selectedLocation.credential);
    const itemRows = itemIds.map(id => {
      const isVoucher = typeof id === "string" && id.indexOf("voucher_") === 0;
      return rewardRow(isVoucher ? "◆" : "⌁", archBlueprintName(id), isVoucher ? "唯一永久回收凭证" : "直接获得的消耗型探针", isVoucher ? "unique" : "rare", false);
    }).join("");

    // 脑插信号：能力探测（中央目录无专属标签时回退说明）
    let implantNote = "具体 ID 由中央脑插目录按稀有权重提供";
    if (typeof tryGetArchaeologyImplantDrop === "function") {
      const probe = tryGetArchaeologyImplantDrop(gameState, selectedLocation, Math.random);
      if (probe && probe.implantId) implantNote = "可能掉落：" + probe.implantId;
    }
    const implantRows = rewardRow("◇", "脑插信号", implantNote, "", false);

    rareArchive = `
      <p class="arch-eyebrow">当前地点 · 稀有档案</p>
      <div class="arch-reward-grid">
        <section class="arch-reward-section">
          <div class="arch-reward-head"><b>技术蓝图</b><span>只抽未拥有项目</span></div>
          <div class="arch-reward-list">${blueprintRows}</div>
        </section>
        <section class="arch-reward-section">
          <div class="arch-reward-head"><b>实物发现</b><span>三个焦点概率相同</span></div>
          <div class="arch-reward-list">${itemRows || '<div class="arch-reward-note">本地点无实物掉落</div>'}</div>
        </section>
        <section class="arch-reward-section">
          <div class="arch-reward-head"><b>脑插信号</b><span>由中央脑插目录提供</span></div>
          <div class="arch-reward-list">${implantRows}</div>
        </section>
      </div>
      <div class="arch-calibration"><b>校准材料</b><br>用于<b>改装件制造</b>：rig 配方在装备工程消耗 <code>calibration:art_&lt;tier&gt;_calib</code>。本次重做不改变其掉落概率与数量。</div>
    `;
  }

  // ---- 文物库存 / 统一回收舱：已整合至仓库「交易品」标签（renderTradeTab），此处不再展示 ----

  // ---- 行动日志 ----
  const logSection = arch.log.length ? `
    <div class="archaeology-log">
      <div class="archaeology-section-title">📋 最近行动</div>
      <div class="archaeology-log-list">
        ${arch.log.map(entry => {
          let icon = "📋", detail = "";
          if (entry.success) {
            icon = "✅";
            detail = "解析成功" + (entry.artifacts && entry.artifacts.length ? "：获得 " + entry.artifacts.join("、") : "");
          } else if (entry.destroyed) {
            icon = "💥";
            detail = "重创！结构归零，进入自动维修" + (Number(entry.backlash) > 0 ? "（反噬 " + entry.backlash + "）" : "");
          } else {
            icon = "⚠️";
            detail = "解析失败" + (Number(entry.backlash) > 0 ? "（反噬 " + entry.backlash + "）" : "");
          }
          return `<div class="archaeology-log-entry">
            <span class="ale-icon">${icon}</span>
            <span class="ale-site">${entry.site || ""}</span>
            <span class="ale-detail">${detail}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
  ` : "";

  body.innerHTML = `
    ${shipSection}
    ${progressSection}
    ${controls}
    <div class="arch-workbench">
      <aside class="arch-col arch-col-locations">
        <p class="arch-eyebrow">勘探区域 · 5</p>
        <div class="arch-location-list">${locationCards}</div>
        <div class="arch-side-note">地点决定稀有池；星币、功勋、货柜三个焦点只改变常规回报。切换焦点不会改变蓝图、强化探针、凭证或脑插概率。</div>
      </aside>
      <section class="arch-col arch-col-detail">${detailColumn}</section>
      <aside class="arch-col arch-col-loot">${rareArchive}</aside>
    </div>
    ${logSection}
  `;

  bindArchaeologyEvents(body);
  return display;
}

function rewardRow(icon, name, sub, rarity, owned) {
  const rarityCls = (rarity === "unique" || rarity === "epic" || rarity === "rare") ? " " + rarity : "";
  const dim = owned ? " arch-reward-owned" : "";
  const rarityLabel = rarity === "unique" ? "唯一" : rarity === "epic" ? "极稀有" : rarity === "rare" ? "稀有" : "";
  return `<div class="arch-reward${dim}">
    <span class="arch-reward-icon">${icon}</span>
    <div><b>${name}</b><small>${sub}</small></div>
    ${rarityLabel ? `<span class="arch-rarity${rarityCls}">${rarityLabel}</span>` : ""}
  </div>`;
}

// 统一回收舱报价行 / 反查函数已迁移至仓库「交易品」标签，考古页不再需要

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

function bindArchaeologyEvents(body) {
  // 地点选择（选中该地点的当前焦点遗迹）
  body.querySelectorAll(".arch-location:not([disabled])").forEach(card => {
    card.addEventListener("click", () => {
      const tier = card.dataset.locTier;
      const loc = (typeof ARCHAEOLOGY_LOCATIONS !== "undefined") ? ARCHAEOLOGY_LOCATIONS.find(l => l.tier === tier) : null;
      if (!loc) return;
      const focus = (gameState.archaeology.startedSiteId || gameState.archaeology.activeSiteId || "");
      const f = archFocusFromSite(focus);
      const siteId = loc.foci[f] || loc.foci.a;
      const result = dispatchGameAction(gameState, { type:"archaeology/selectSite", siteId }, Date.now());
      if (result.changed) renderArchaeologyPage();
    });
  });

  // 焦点选择（直接选中具体遗迹 site_X_y）
  body.querySelectorAll(".arch-focus:not([disabled])").forEach(card => {
    card.addEventListener("click", () => {
      const siteId = card.dataset.siteId;
      if (!siteId) return;
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
  // 更换考古舰：手动换船取消原舰自动恢复意图（不取消其维修）；释放岗位后前往船坞指派健康舰
  const swapBtn = body.querySelector("#archaeology-btn-swap-ship");
  if (swapBtn) swapBtn.addEventListener("click", () => {
    const instId = (gameState.shipAssignments && gameState.shipAssignments.archaeology) || null;
    if (instId) dispatchGameAction(gameState, { type:"hangar/toggleAssignment", instanceId:instId, actionKey:"archaeology" }, Date.now());
    if (typeof switchPage === "function") switchPage("hangar");
    else { renderArchaeologyPage(); updateUI(); }
  });

  // 出售/兑换文物：已整合至仓库「交易品」标签（renderTradeTab 一键回收），此处不再绑定

}
