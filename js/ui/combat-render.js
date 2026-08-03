/* ================================================================
   战斗系统原生DOM适配器
   ================================================================ */

function renderHPBars(hp, maxHp) {
  const layers = [{ key:"shield", label:"护盾", cls:"shield" }, { key:"armor", label:"装甲", cls:"armor" }, { key:"structure", label:"结构", cls:"hull" }];
  return layers.map(layer => {
    const percent = maxHp[layer.key] > 0 ? Math.round(hp[layer.key] / maxHp[layer.key] * 100) : 0;
    return `<div class="health-bar-row"><span class="health-label">${layer.label}</span><div class="progress-bar"><div class="fill ${layer.cls}" style="width:${percent}%;"></div></div><span class="health-pct">${hp[layer.key]} / ${maxHp[layer.key]} (${percent}%)</span></div>`;
  }).join("");
}

function renderCombatEnemyPanel(display) {
  const enemySection = document.getElementById("combat-enemy-section");
  const formation = document.getElementById("combat-enemy-formation");
  const name = document.getElementById("combat-enemy-name");
  const type = document.getElementById("combat-enemy-type");
  const bars = document.getElementById("combat-enemy-bars");
  const stats = document.getElementById("combat-enemy-stats");
  const image = document.getElementById("combat-enemy-image");
  const caption = document.getElementById("combat-target-caption");
  if (formation) formation.innerHTML = display.enemies.map(enemy => `<div class="combat-enemy-card ${enemy.kind || "normal"}${enemy.current ? " target" : ""}${enemy.defeated ? " defeated" : ""}"><div class="combat-enemy-card-head"><span class="combat-enemy-card-icon">${enemy.icon || "◆"}</span><span class="combat-enemy-card-name">${enemy.name}</span><span class="combat-enemy-card-kind">${enemy.kind === "boss" ? "BOSS" : enemy.kind === "elite" ? "精英" : "普通"}</span></div><div class="combat-enemy-card-bar"><span style="width:${enemy.percent}%"></span></div></div>`).join("");
  const target = display.target;
  if (target) {
    if (enemySection) { enemySection.style.display = ""; enemySection.classList.remove("is-scanning"); }
    if (caption) caption.textContent = "LOCKED TARGET · " + (target.index + 1) + "/" + display.enemies.length;
    if (name) name.textContent = target.name;
    if (type) type.textContent = target.kindLabel + " · " + target.defenseLabel;
    if (bars) bars.innerHTML = renderHPBars(target.hp, target.maxHp);
    if (stats) stats.textContent = "威胁等级:" + (target.level || 1) + " · 攻击力:" + (target.baseDamage || 1) + " · 编队存活:" + display.enemies.filter(enemy => !enemy.defeated).length;
    if (image && !image.querySelector("#combat-enemy-3d")) image.innerHTML = target.image ? `<img src="${target.image}" alt="${target.name}">` : `<div class="combat-ship-placeholder"><span>${target.icon || "👾"}</span></div>`;
  } else {
    if (enemySection) { enemySection.style.display = ""; enemySection.classList.add("is-scanning"); }
    if (caption) caption.textContent = "NO TARGET";
    if (name) name.textContent = "等待目标";
    if (type) type.textContent = "扫描中";
    if (bars) bars.innerHTML = '<div class="combat-scan-message">正在扫描海盗星带信号…</div>';
    if (stats) stats.textContent = "尚未锁定敌舰";
    if (image && !image.querySelector("#combat-enemy-3d")) image.innerHTML = '<div class="combat-ship-placeholder"><span>👾</span></div>';
  }
}

function updateCombatRing(display) {
  const rings = [{ key:"shield", id:"combat-ring-shield", radius:72 }, { key:"armor", id:"combat-ring-armor", radius:61 }, { key:"structure", id:"combat-ring-structure", radius:50 }];
  for (const ring of rings) {
    const circle = document.getElementById(ring.id); if (!circle) continue;
    const circumference = 2 * Math.PI * ring.radius;
    const percent = display.player.maxHp[ring.key] > 0 ? Math.max(0, Math.min(1, display.player.hp[ring.key] / display.player.maxHp[ring.key])) : 0;
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = circumference * (1 - percent);
  }
  const shipName = document.getElementById("combat-ring-ship"); if (shipName) shipName.textContent = display.player.name;
  const wave = document.getElementById("combat-ring-wave"); if (wave) wave.textContent = display.active ? "WAVE " + display.wave + "/" + display.maxWave : "待命";
  const legend = document.getElementById("combat-ring-legend");
  if (legend) legend.innerHTML = ["shield", "armor", "structure"].map(key => `<span class="${key}">${Math.round((display.player.hp[key] || 0) / (display.player.maxHp[key] || 1) * 100)}%</span>`).join("");
}

function renderInstalledCombatControls(display) {
  const weaponRow = document.getElementById("combat-weapon-row");
  const repairRow = document.getElementById("combat-repair-row");
  if (weaponRow) weaponRow.innerHTML = display.weapons.length ? display.weapons.map(module => `<span class="weapon-btn active installed"><span>${module.icon}</span>${module.name}</span>`).join("") : '<span class="combat-module-empty">未安装战斗武器</span>';
  if (repairRow) repairRow.innerHTML = display.repairers.length ? display.repairers.map(module => `<span class="repair-toggle on installed">${module.name} · 自动</span>`).join("") : '<span class="combat-module-empty">未安装维修装备</span>';
}

function renderCombatEquipmentRack(display) {
  const grid = document.getElementById("combat-equipment-grid"); if (!grid) return;
  const icons = { high:"⚡", mid:"◉", low:"◆", rig:"◇" };
  grid.innerHTML = display.equipmentRack.length ? display.equipmentRack.map(item => `<div class="combat-equip-slot${item.empty ? " empty" : ""}" title="${item.attributes}"><span class="combat-equip-icon">${icons[item.slot]}</span><span class="combat-equip-copy"><span class="combat-equip-name">${item.name}</span><span class="combat-equip-type">${item.slotName} ${item.index + 1}</span></span></div>`).join("") : '<div class="combat-equip-slot empty"><span class="combat-equip-icon">◇</span><span class="combat-equip-copy"><span class="combat-equip-name">暂无槽位</span><span class="combat-equip-type">舰体配置</span></span></div>';
}

function renderCombatLiveDisplay(display) {
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  text("combat-header-info", display.headerText); text("combat-wave-num", display.wave); text("combat-wave-max", display.maxWave); text("combat-clear-label", display.encounterMode === "deathspace" ? "已全通" : "已肃清"); text("combat-clear-count", display.clearCount); text("combat-lock-state", display.lockText); text("combat-player-ship", display.player.name);
  const playerBars = document.getElementById("combat-player-bars"); if (playerBars) playerBars.innerHTML = renderHPBars(display.player.hp, display.player.maxHp);
  text("combat-player-stats", "齐射伤害:" + display.player.volleyDamage + " · 武器:" + display.player.weaponCount + " · 航速:" + display.player.speed);
  renderCombatEnemyPanel(display); updateCombatRing(display);
  const rewards = document.getElementById("combat-rewards"); if (rewards) { rewards.style.display = display.showRewards ? "" : "none"; if (display.showRewards) rewards.textContent = display.runStatus; }
  text("combat-fuel-val", display.supplies.fuel.toLocaleString()); text("combat-ammo-laser", display.supplies.laser.toLocaleString()); text("combat-ammo-missile", display.supplies.missile.toLocaleString()); text("combat-ammo-cannon", display.supplies.cannon.toLocaleString());
  const start = document.getElementById("btn-start-combat"); const stop = document.getElementById("btn-stop-combat");
  if (start) { start.style.display = display.controls.showStart ? "" : "none"; start.disabled = display.controls.startDisabled; start.textContent = display.controls.startText; }
  if (stop) stop.style.display = display.controls.showStop ? "" : "none";
  document.body.classList.toggle("in-combat", display.active);
}

/* ================================================================
   战斗 3D（左右晃动体现战斗）
   ================================================================ */
function mountCombat3D(display) {
  const S3D = window.Ship3D;
  if (!S3D) return; // 模块尚未就绪时静默跳过，后续 tick 会补上

  // 玩家舰：当前出战舰（combat.activeShip → 实例 → 蓝图 id）
  try {
    let playerShipId = "rifter";
    if (typeof getActiveCombatShipState === "function") {
      const active = getActiveCombatShipState(gameState);
      if (active && active.config && active.config.id) playerShipId = active.config.id;
    }
    const playerSpec = S3D.buildSpecForShip(playerShipId);
    mountCombat3D._playerSpec = playerSpec; // 供点开大图复用，确保与侧栏模型一致
    const pImg = document.getElementById("combat-player-image");
    if (pImg) {
      let canvas = pImg.querySelector("#combat-player-3d");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "combat-player-3d";
        canvas.className = "ship3d-canvas";
        canvas.style.cssText = "height:100%;width:100%;border-radius:8px;background:#070d14;display:block;";
        // 清空占位符后 append（不破坏同级元素）
        pImg.innerHTML = "";
        pImg.appendChild(canvas);
      }
      const viewer = S3D.ensureViewer(canvas, { orbit: false, autoSpin: false });
      S3D.setShips(viewer, [{ spec: playerSpec, position: [0, 0, 0], scale: 1, sway: true }]);
    }
  } catch (err) { console.error("[combat] 玩家 3D 渲染失败", err); }

  // 敌人舰：由星带 faction + 威胁等级推导的泛用海盗舰
  // 缓存 key = faction|level|wave|index|nonce：index 区分同波不同敌兵、nonce 区分每场新战斗，
  // 任一项变化才重建 buildShip（每帧不重建，无性能负担）。
  try {
    const zoneFaction = display.zone && display.zone.faction;
    const enemyLevel = display.target && display.target.level ? display.target.level : 1;
    const enemyWave = display.wave || 1;
    // 当前敌兵序号：让「每一艘不同的敌兵」都换轮廓（同艘反复切回仍稳定，不跳动）
    const enemyIdx = display.target && display.target.index != null ? display.target.index : -1;
    // 战斗会话 nonce：每开始一场新战斗自增（见 startCombatEncounter），使每场战斗都重新随机外观，
    // 避免跨场战斗复用首场随机结果（否则同区域同等级敌人每次都长一个样）。
    const combatNonce = mountCombat3D._combatNonce || 0;
    const enemyKey = (zoneFaction || "?") + "|" + enemyLevel + "|" + enemyWave + "|" + enemyIdx + "|" + combatNonce;
    if (!mountCombat3D._enemyKey || mountCombat3D._enemyKey !== enemyKey) {
      mountCombat3D._enemyKey = enemyKey;
      const baseSpec = S3D.buildEnemySpec(zoneFaction, enemyLevel);
      // 每波用不同随机 seed，产生不同外观（同波内 key 不变 → 复用，不重建）
      baseSpec.seed = "enemy-rnd-" + enemyWave + "-" + Date.now() + "-" + Math.floor(Math.random() * 99999);
      mountCombat3D._enemySpec = baseSpec;
    }
    const eImg = document.getElementById("combat-enemy-image");
    if (eImg) {
      let canvas = eImg.querySelector("#combat-enemy-3d");
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.id = "combat-enemy-3d";
        canvas.className = "ship3d-canvas";
        canvas.style.cssText = "height:100%;width:100%;border-radius:8px;background:#1a0808;display:block;";
        eImg.innerHTML = "";
        eImg.appendChild(canvas);
      }
      // background：敌方暗红背景（覆盖 createViewer 默认的蓝黑清屏色）
      // shieldColor：敌方护盾泡染红（覆盖 ShipFactory2 写死的青蓝 SHIELD_COLOR）
      const viewer = S3D.ensureViewer(canvas, { orbit: false, autoSpin: false, background: 0x1a0808 });
      S3D.setShips(viewer, [{ spec: mountCombat3D._enemySpec, position: [0, 0, 0], scale: 1, sway: true, rotation: [0, Math.PI, 0], shieldColor: 0xff3a3a }]);
    }
  } catch (err) { console.error("[combat] 敌人 3D 渲染失败", err); }
}

function renderCombatPanel(now) {
  const renderTime = Number(now) || Date.now();
  updateCombatRecovery(renderTime);
  const display = getCombatDisplayState(gameState, renderTime);
  document.querySelectorAll("[data-combat-mode]").forEach(button => button.classList.toggle("active", button.dataset.combatMode === display.mode));
  const zoneSelector = document.getElementById("combat-zone-selector"); if (zoneSelector) zoneSelector.style.display = display.mode === "belt" ? "" : "none";
  const deathspacePanel = document.getElementById("deathspace-selector-panel"); if (deathspacePanel) deathspacePanel.style.display = display.mode === "deathspace" ? "" : "none";
  const deathspaceIntro = deathspacePanel && deathspacePanel.querySelector(".deathspace-intro strong"); if (deathspaceIntro) deathspaceIntro.textContent = "DED " + display.deathspaceTier + "/10";
  const deathspaceIntroText = document.getElementById("deathspace-intro-text");
  if (deathspaceIntroText) {
    deathspaceIntroText.textContent = display.active ? "当前战斗继续结算；可查看死亡空间，但交战结束前无法进入。" : "进入即消耗1枚通行密钥；失败或主动撤离均不返还。";
    deathspaceIntroText.classList.toggle("deathspace-browse-notice", display.active);
  }
  const deathspaceTierTabs = document.getElementById("deathspace-tier-tabs");
  if (deathspaceTierTabs) deathspaceTierTabs.innerHTML = display.deathspaceTiers.map(item => `<button class="deathspace-tier-tab${item.selected ? " active" : ""}${item.unlocked ? "" : " locked"}" data-deathspace-tier="${item.tier}">${item.label}<small>战斗等级 ${item.requiredCL}</small></button>`).join("");
  const deathspaceGrid = document.getElementById("deathspace-grid");
  if (deathspaceGrid) deathspaceGrid.innerHTML = display.deathspaces.map(site => `<button class="deathspace-card${site.selected ? " selected" : ""}${site.locked ? " locked" : ""}" data-deathspace="${site.id}" ${site.locked ? "disabled" : ""}><strong>${site.name}</strong><span>🎫 ${getResourceDisplayName(site.ticketMaterial)} ×${site.ticketCount}</span><small>来源：${site.sourceZoneName}精英/BOSS · 5%</small><small>${site.maxWave}层 · 每层${site.waveLp} ${DisplayNames.getCurrencyName("lp")} · 全通共${site.waveLp * site.maxWave + site.clearLpBonus} ${DisplayNames.getCurrencyName("lp")} · 已全通 ${site.clears}</small><small class="deathspace-rare">💠 ${getResourceDisplayName(site.coreMaterial)} · 📜 ${getResourceDisplayName(site.protocolMaterial)} 2%</small></button>`).join("");
  const dropButton = document.getElementById("combat-zone-dropbtn"); if (dropButton) dropButton.textContent = display.zone.name + " ▾";
  const targetingControl = document.getElementById("capital-targeting-control");
  const targetingSelect = document.getElementById("capital-targeting-select");
  const traitSummary = document.getElementById("capital-trait-summary");
  if (targetingControl) targetingControl.style.display = display.targeting.supported ? "" : "none";
  if (targetingSelect && display.targeting.supported) {
    targetingSelect.innerHTML = display.targeting.options.map(option => `<option value="${option.id}"${option.id === display.targeting.mode ? " selected" : ""}>${option.name}</option>`).join("");
    targetingSelect.disabled = display.active;
  }
  if (traitSummary) { traitSummary.textContent = display.targeting.trait ? display.targeting.trait.name + " · " + display.targeting.trait.description : ""; traitSummary.title = traitSummary.textContent; }
  const zoneContent = document.getElementById("combat-zone-dropdown-content");
  if (zoneContent) zoneContent.innerHTML = display.zones.map(zone => `<div class="area-option${zone.selected ? " selected" : ""}${zone.locked ? " locked" : ""}" data-zone="${zone.id}">${zone.name} <span class="area-req">安全 ${zone.secLevel}${zone.requiredCL ? " · 战斗等级 " + zone.requiredCL : ""} · 肃清 ${zone.clears}</span></div>`).join("");
  const playerImage = document.getElementById("combat-player-image"); if (playerImage && !playerImage.querySelector("#combat-player-3d")) playerImage.innerHTML = display.player.image ? `<img src="${display.player.image}" alt="${display.player.name}" style="max-width:100%;max-height:100%;object-fit:contain;">` : '<span class="combat-ship-placeholder">🚀</span>';
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  text("combat-cl-val", display.level); text("combat-laser-lv", display.skills.laser); text("combat-cannon-lv", display.skills.cannon); text("combat-missile-lv", display.skills.missile); text("combat-target-lv", display.skills.targeting);
  renderInstalledCombatControls(display); renderCombatEquipmentRack(display); renderCombatLiveDisplay(display);
  mountCombat3D(display);
  renderCombatDropPreview(display);
  return display;
}

// 掉落预览（Phase 3D 其他任务）：基于 getCombatDropPreview 纯函数渲染当前选中星带/死亡空间的
// 可能掉落物与概率。仅展示加密数据/特殊掉落/通行密钥/首领战利品/战术材料，不含 ISK/LP 经济与成功率。
function renderCombatDropPreview(display) {
  const wrap = document.getElementById("combat-drop-preview-wrap");
  const body = document.getElementById("combat-drop-preview");
  const zoneLabel = document.getElementById("combat-drop-preview-zone");
  if (!body || !wrap) return;
  const preview = getCombatDropPreview(gameState, {
    mode:display.viewMode,
    zoneId:display.zone && display.zone.id,
    deathspaceId:display.deathspace && display.deathspace.id
  });
  if (!preview) { wrap.style.display = "none"; return; }
  if (!preview.valid) {
    // fail-closed：非法 zoneId / deathspaceId / sourceZoneId 时绝不回退显示首个星带数据，
    // 明确提示掉落数据不可用（reason 见 preview.reason）。
    wrap.style.display = "";
    if (zoneLabel) zoneLabel.textContent = "";
    body.innerHTML = `<div class="drop-row drop-none"><span class="drop-name">⚠ 掉落数据不可用</span></div>`;
    return;
  }
  wrap.style.display = "";
  if (zoneLabel) zoneLabel.textContent = "· " + (preview.name || "");
  const pct = x => (Number(x) * 100).toFixed(x * 100 % 1 === 0 ? 0 : 2) + "%";
  const rows = [];
  const row = (icon, name, detail, extraClass) => `<div class="drop-row${extraClass ? " " + extraClass : ""}"><span class="drop-name">${icon} ${name}</span><span class="drop-detail">${detail}</span></div>`;

  if (preview.mode === "deathspace") {
    rows.push(`<div class="drop-mode-tag deathspace">死亡空间 · 不掉落加密数据 / 特殊掉落 / 通行密钥</div>`);
    if (Array.isArray(preview.leaderLoot) && preview.leaderLoot.length > 0) {
      rows.push(`<div class="drop-group-title">💠 首领战利品（每波 BOSS 击破时结算）</div>`);
      for (const loot of preview.leaderLoot) {
        rows.push(row("🟣", getResourceDisplayName(loot.coreMaterial), `第 ${loot.wave} 层「${loot.name}」核心 ${pct(loot.coreChance)}（稀有）` + (loot.isFinal ? ` · 最终层追加 📜 ${getResourceDisplayName(loot.protocolMaterial)} ${pct(loot.protocolChance)}（极稀有）` : ""), "drop-leader"));
      }
    }
    if (preview.tacticalMaterial) {
      const t = preview.tacticalMaterial;
      rows.push(`<div class="drop-group-title">🧪 战术材料（所有敌人）</div>`);
      rows.push(row("🧪", t.materialName + "（" + t.tier + "）", `普通 ${pct(t.normalChance)}×${t.normalQty} · 精英 100%×${t.eliteQtyMin}~${t.eliteQtyMax} · BOSS 100%×${t.bossQtyMin}~${t.bossQtyMax}`, "drop-tactical"));
    }
  } else {
    rows.push(`<div class="drop-mode-tag belt">海盗星带</div>`);
    if (preview.encryptedData) {
      const e = preview.encryptedData;
      rows.push(row("🔐", e.material, `精英 ${pct(e.eliteChance)} · BOSS ${pct(e.bossChance)}（每枚 ×${e.qty}）`, "drop-data"));
    } else {
      rows.push(row("🔐", "加密数据", "本星带禁用掉落", "drop-none"));
    }
    if (Array.isArray(preview.zoneSpecialDrops) && preview.zoneSpecialDrops.length > 0) {
      rows.push(`<div class="drop-group-title">⭐ 特殊掉落（outer/deep 独有）</div>`);
      for (const sd of preview.zoneSpecialDrops) {
        rows.push(row("⭐", sd.material, `精英 ${pct(sd.eliteChance)} · BOSS ${pct(sd.bossChance)}（每枚 ×${sd.qty}）`, "drop-special"));
      }
    }
    if (preview.ticketDrop) {
      const t = preview.ticketDrop;
      rows.push(row("🎫", t.material, `击破本星带精英/BOSS 有概率掉落（精英 ${pct(t.eliteChance)} · BOSS ${pct(t.bossChance)}）· 来源 ${t.deathspaceName}`, "drop-ticket"));
    }
    if (preview.tacticalMaterial) {
      const t = preview.tacticalMaterial;
      rows.push(`<div class="drop-group-title">🧪 战术材料（所有敌人）</div>`);
      rows.push(row("🧪", t.materialName + "（" + t.tier + "）", `普通 ${pct(t.normalChance)}×${t.normalQty} · 精英 100%×${t.eliteQtyMin}~${t.eliteQtyMax} · BOSS 100%×${t.bossQtyMin}~${t.bossQtyMax}`, "drop-tactical"));
    }
  }
  body.innerHTML = rows.join("");
}

function updateCombatLiveUI(now) {
  const renderTime = Number(now) || Date.now();
  updateCombatRecovery(renderTime);
  const display = getCombatDisplayState(gameState, renderTime);
  // 交战中实时刷新敌方 3D：mountCombat3D 内部按 target 维度
  // （faction|level|wave|index|nonce）缓存，仅击毁/切换目标/新战斗导致 key 变化时才重建 buildShip，
  // 其余每秒只复用以无性能负担。这是「击毁敌人后模型切换」的关键——
  // 主渲染循环每帧只画进度条/行星动画，并不重渲战斗面板，3D 此前只在进入面板时渲染一次。
  if (display.active) mountCombat3D(display);
  renderCombatLiveDisplay(display);
  return display;
}

function startCombatEncounter() {
  // 新战斗会话：递增 nonce，让敌方 3D 外观重新随机（每场战斗都不同轮廓/细节）
  if (typeof mountCombat3D === "function") {
    mountCombat3D._combatNonce = (mountCombat3D._combatNonce || 0) + 1;
  }
  const now = Date.now();
  updateCombatRecovery(now);
  const combat = gameState.combat;
  const requestedMode = combat.viewMode === "deathspace" ? "deathspace" : combat.viewMode === "belt" ? "belt" : combat.mode;
  const deathspace = requestedMode === "deathspace" ? getDeathspaceById(combat.viewDeathspaceId || combat.deathspaceId) || DEATHSPACE_DATABASE[0] : null;
  const maxWave = deathspace ? deathspace.maxWave : 20;
  if (combat.wave < 1 || combat.wave > maxWave) combat.wave = 1;
  if (deathspace) {
    const wave = buildDeathspaceWave(deathspace, 1);
    const result = dispatchGameAction(gameState, { type:"combat/enterDeathspace", deathspaceId:deathspace.id, enemies:wave.enemies, formationId:wave.formationId }, now);
    if (!result.changed) {
      if (result.reason === "repairing") showToast("舰船自动维修中，还需 " + result.remaining + " 秒");
      else if (result.reason === "level-locked") showToast("该死亡空间需要战斗等级 " + result.requiredCL);
      else if (result.reason === "no-weapons") showToast("当前战斗舰没有安装武器，请先在船坞装配");
      else if (result.reason === "missing-ticket") showToast("缺少：" + getResourceDisplayName(result.ticketMaterial));
      renderCombatPanel(now); return false;
    }
    showToast("已消耗1枚通行密钥，进入" + deathspace.name);
    renderCombatPanel(now); updateUI(); return true;
  }
  const zone = COMBAT_ZONES.find(item => item.id === combat.zone) || COMBAT_ZONES[0];
  const wave = getCombatLivingEnemiesFromState(combat).length === 0 ? buildCombatWave(zone, combat.wave) : { formationId:combat.currentFormation, enemies:combat.enemies };
  const result = dispatchGameAction(gameState, { type:"combat/start", enemies:wave.enemies, formationId:wave.formationId }, now);
  if (!result.changed) {
    if (result.reason === "repairing") showToast("舰船自动维修中，还需 " + result.remaining + " 秒");
    else if (result.reason === "level-locked") showToast("该星带需要战斗等级 " + result.requiredCL);
    else if (result.reason === "no-weapons") showToast("当前战斗舰没有安装武器，请先在船坞装配");
    renderCombatPanel(now); return false;
  }
  renderCombatPanel(now); updateUI(); return true;
}

function stopCombatEncounter() {
  const result = dispatchGameAction(gameState, { type:"combat/stop" }, Date.now());
  if (!result.changed) return false;
  if (result.abandonedDeathspace) showToast("已撤离死亡空间，通行密钥不返还");
  renderCombatPanel(); updateUI(); return true;
}

onCombatEvent(event => {
  if (event.type === "ship-destroyed") showToast("💥 舰船被击毁！自动维修需要 " + event.repairSeconds + " 秒");
});

/* ================================================================
   战斗攻击特效
   ================================================================ */

function playAttackFX(isPlayer, weapon, dmg, damageIndex) {
  const fxLayer = document.getElementById("combat-fx-layer");
  if (!fxLayer) return;

  // --- 闪边 ---
  if (isPlayer) {
    const enemySec = document.getElementById("combat-enemy-section");
    if (enemySec) {
      enemySec.classList.remove("enemy-hit-flash");
      void enemySec.offsetWidth;
      enemySec.classList.add("enemy-hit-flash");
    }
  } else {
    const playerSec = document.getElementById("combat-player-section") || document.querySelector(".combat-player-side");
    if (playerSec) {
      playerSec.classList.remove("player-hit-flash");
      void playerSec.offsetWidth;
      playerSec.classList.add("player-hit-flash");
    }
  }

  // --- 光束 ---
  if (isPlayer && weapon) {
    const beam = document.createElement("div");
    const beamMap = { laser: "beam-laser", cannon: "beam-cannon", missile: "beam-rocket" };
    beam.className = "fx-beam " + (beamMap[weapon] || "beam-laser");
    // 从玩家区中心到敌人区中心
    const playerEl = document.querySelector(".combat-player-side");
    const enemyEl  = document.getElementById("combat-enemy-section");
    if (playerEl && enemyEl) {
      const pr = playerEl.getBoundingClientRect();
      const er = enemyEl.getBoundingClientRect();
      const fxr = fxLayer.getBoundingClientRect();
      const x1 = pr.left + pr.width / 2 - fxr.left;
      const y1 = pr.top  + pr.height / 2 - fxr.top;
      const x2 = er.left + er.width / 2 - fxr.left;
      const y2 = er.top  + er.height / 2 - fxr.top;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      beam.style.left = x1 + "px";
      beam.style.top  = y1 + "px";
      beam.style.width = len + "px";
      beam.style.transform = "rotate(" + angle + "deg)";
      beam.style.transformOrigin = "0 50%";
    } else {
      // 回退：固定示意
      beam.style.left = "30%";
      beam.style.top = "45%";
      beam.style.width = "40%";
      beam.style.transform = "rotate(0deg)";
      beam.style.transformOrigin = "0 50%";
    }
    fxLayer.appendChild(beam);
    setTimeout(() => beam.remove(), 320);
  }

  // --- 伤害数字 ---
  if (dmg !== undefined && dmg > 0) {
    const el = document.createElement("div");
    el.className = "fx-dmg";
    el.textContent = "−" + Math.round(dmg);
    if (isPlayer) {
      const enemySec = document.getElementById("combat-enemy-section");
      if (enemySec) {
        const rect = enemySec.getBoundingClientRect();
        const fxr = fxLayer.getBoundingClientRect();
        el.style.left = (rect.left + rect.width * 0.6 - fxr.left) + "px";
        el.style.top  = (rect.top  + rect.height * 0.3 - fxr.top + (damageIndex || 0) * 18) + "px";
      } else {
        el.style.left = "60%"; el.style.top = "30%";
      }
    } else {
      const playerSec = document.querySelector(".combat-player-side");
      if (playerSec) {
        const rect = playerSec.getBoundingClientRect();
        const fxr = fxLayer.getBoundingClientRect();
        el.style.left = (rect.left + rect.width * 0.6 - fxr.left) + "px";
        el.style.top  = (rect.top  + rect.height * 0.3 - fxr.top) + "px";
      } else {
        el.style.left = "20%"; el.style.top = "30%";
      }
    }
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 620);
  }
}

function playEnemyAttackFX(enemyIndex, attackOrder, dmg) {
  setTimeout(() => {
    const cards = document.querySelectorAll(".combat-enemy-card");
    const card = cards && cards[enemyIndex];
    if (card) {
      card.classList.remove("attacking");
      void card.offsetWidth;
      card.classList.add("attacking");
      setTimeout(() => card.classList.remove("attacking"), 260);
    }
    playAttackFX(false, null, dmg, attackOrder);
  }, attackOrder * 110);
}


/* ================================================================
   战斗 3D 弹窗：点开侧栏建模看大图 + 敌方/我方属性
   复用船坞弹窗模式（ensureViewer orbit:true + setShips），
   关闭时 disposeViewer 释放 WebGL 上下文。
   ================================================================ */
let _combatPopupViewer = null;

function openCombat3DPopup(which) {
  const S3D = window.Ship3D;
  if (!S3D) return;
  const display = getCombatDisplayState(gameState, Date.now());
  const popup = document.getElementById("combat-3d-popup");
  const canvas = document.getElementById("combat-3d-popup-canvas");
  const nameEl = document.getElementById("combat-3d-popup-name");
  const attrsEl = document.getElementById("combat-3d-popup-attrs");
  if (!popup || !canvas || !nameEl || !attrsEl) return;

  let spec, rotation = [0, 0, 0], shieldColor = null, title, attrsHTML;

  if (which === "enemy") {
    const target = display.target;
    if (!target) { showToast("当前没有锁定的敌舰"); return; }
    // 复用侧栏当前渲染的敌方 spec，保证大图与侧栏轮廓一致
    spec = mountCombat3D._enemySpec
      ? JSON.parse(JSON.stringify(mountCombat3D._enemySpec))
      : S3D.buildEnemySpec(display.zone && display.zone.faction, target.level || 1);
    rotation = [0, Math.PI, 0];
    shieldColor = 0xff3a3a;
    title = target.name;
    attrsHTML =
      '<div class="c3d-attr-title">' + target.name + '</div>' +
      '<div class="c3d-attr-grid">' +
        '<div><span>类型</span><b>' + (target.kindLabel || "—") + '</b></div>' +
        '<div><span>防御</span><b>' + (target.defenseLabel || "—") + '</b></div>' +
        '<div><span>威胁等级</span><b>' + (target.level || 1) + '</b></div>' +
        '<div><span>攻击力</span><b>' + (target.baseDamage || 1) + '</b></div>' +
      '</div>' +
      '<div class="c3d-attr-bars">' + renderHPBars(target.hp, target.maxHp) + '</div>';
  } else {
    const player = display.player;
    spec = mountCombat3D._playerSpec
      ? JSON.parse(JSON.stringify(mountCombat3D._playerSpec))
      : S3D.buildSpecForShip("rifter");
    title = player.name;
    attrsHTML =
      '<div class="c3d-attr-title">' + player.name + '</div>' +
      '<div class="c3d-attr-grid">' +
        '<div><span>齐射伤害</span><b>' + (player.volleyDamage || 0) + '</b></div>' +
        '<div><span>武器数</span><b>' + (player.weaponCount || 0) + '</b></div>' +
        '<div><span>航速</span><b>' + (player.speed || 0) + '</b></div>' +
      '</div>' +
      '<div class="c3d-attr-bars">' + renderHPBars(player.hp, player.maxHp) + '</div>';
  }

  nameEl.textContent = title;
  attrsEl.innerHTML = attrsHTML;
  popup.classList.add("open");

  const item = { spec, position: [0, 0, 0], scale: 1, sway: false, rotation, shieldColor };
  // 我方蓝黑 / 敌方暗红：每次打开都按当前对象设定背景（复用同一 viewer，避免看完我方再看敌方时背景残留）。
  const bg = which === "enemy" ? 0x1a0808 : 0x0a121e;
  if (!_combatPopupViewer) {
    // 首次打开：等弹窗从 display:none→flex 完成布局（拿到真实尺寸）后再创建 viewer，避免基于 0 尺寸取景。
    // 之后该 viewer 常驻复用，关闭不销毁（不调 forceContextLoss），彻底规避第二次创建上下文失败/白屏。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _combatPopupViewer = S3D.ensureViewer(canvas, { orbit: true, autoSpin: true, background: bg });
        if (_combatPopupViewer) {
          if (S3D.setBackground) S3D.setBackground(_combatPopupViewer, bg);
          S3D.setShips(_combatPopupViewer, [item]);
        }
      });
    });
  } else {
    // 已存在：安全更新背景（不重建 WebGL 上下文）+ 换模型
    if (S3D.setBackground) S3D.setBackground(_combatPopupViewer, bg);
    S3D.setShips(_combatPopupViewer, [item]);
    _combatPopupViewer._needsAutoFit = true;
  }
}

function closeCombat3DPopup() {
  const popup = document.getElementById("combat-3d-popup");
  if (popup) popup.classList.remove("open");
  // 不销毁 viewer：弹窗 viewer 只创建一次并复用，避免 forceContextLoss 后再创建失败（第二个弹窗白屏的根因）。
}

(function bindCombat3DPopup() {
  const playerImg = document.getElementById("combat-player-image");
  const enemyImg = document.getElementById("combat-enemy-image");
  if (playerImg) playerImg.addEventListener("click", () => openCombat3DPopup("player"));
  if (enemyImg) enemyImg.addEventListener("click", () => openCombat3DPopup("enemy"));
  const popup = document.getElementById("combat-3d-popup");
  const closeBtn = document.getElementById("combat-3d-popup-close");
  if (closeBtn) closeBtn.addEventListener("click", closeCombat3DPopup);
  if (popup) popup.addEventListener("click", (event) => { if (event.target === popup) closeCombat3DPopup(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCombat3DPopup(); });
})();


(function bindCombatUI() {
  const modeTabs = document.getElementById("combat-mode-tabs");
  if (modeTabs) modeTabs.addEventListener("click", event => {
    const button = event.target.closest("[data-combat-mode]"); if (!button) return;
    dispatchGameAction(gameState, { type:"combat/selectMode", mode:button.dataset.combatMode }, Date.now());
    renderCombatPanel();
  });
  const deathspaceGrid = document.getElementById("deathspace-grid");
  if (deathspaceGrid) deathspaceGrid.addEventListener("click", event => {
    const card = event.target.closest("[data-deathspace]"); if (!card || card.disabled) return;
    const result = dispatchGameAction(gameState, { type:"combat/selectDeathspace", deathspaceId:card.dataset.deathspace }, Date.now());
    if (!result.changed && result.reason === "level-locked") showToast("该死亡空间需要战斗等级 " + result.requiredCL);
    renderCombatPanel();
  });
  const deathspaceTierTabs = document.getElementById("deathspace-tier-tabs");
  if (deathspaceTierTabs) deathspaceTierTabs.addEventListener("click", event => {
    const button = event.target.closest("[data-deathspace-tier]"); if (!button) return;
    dispatchGameAction(gameState, { type:"combat/selectDeathspaceTier", tier:Number(button.dataset.deathspaceTier) }, Date.now());
    renderCombatPanel();
  });
  const button = document.getElementById("combat-zone-dropbtn"); const content = document.getElementById("combat-zone-dropdown-content");
  if (button && content) {
    button.addEventListener("click", event => { event.stopPropagation(); renderCombatPanel(); content.classList.toggle("show"); });
    document.addEventListener("click", () => content.classList.remove("show"));
    content.addEventListener("click", event => {
      const option = event.target.closest("[data-zone]"); if (!option) return;
      const result = dispatchGameAction(gameState, { type:"combat/selectZone", zoneId:option.dataset.zone }, Date.now());
      if (!result.changed && result.reason === "combat-active") showToast("交战中不能切换星带，请先停止战斗");
      else if (!result.changed && result.reason === "level-locked") showToast("该星带需要战斗等级 " + result.requiredCL);
      content.classList.remove("show"); renderCombatPanel();
    });
  }
  const targetingSelect = document.getElementById("capital-targeting-select");
  if (targetingSelect) targetingSelect.addEventListener("change", () => {
    const result = dispatchGameAction(gameState, { type:"combat/selectTargetingMode", mode:targetingSelect.value }, Date.now());
    if (!result.changed && result.reason === "combat-active") showToast("交战中不能切换战术索敌模式");
    else if (!result.changed && result.reason === "capital-only") showToast("只有旗舰与超级旗舰可以使用战术索敌");
    renderCombatPanel();
  });


  const start = document.getElementById("btn-start-combat"); if (start) start.addEventListener("click", startCombatEncounter);
  const stop = document.getElementById("btn-stop-combat"); if (stop) stop.addEventListener("click", stopCombatEncounter);
})();
