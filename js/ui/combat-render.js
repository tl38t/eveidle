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
    if (image) image.innerHTML = target.image ? `<img src="${target.image}" alt="${target.name}">` : `<div class="combat-ship-placeholder"><span>${target.icon || "👾"}</span></div>`;
  } else {
    if (enemySection) { enemySection.style.display = ""; enemySection.classList.add("is-scanning"); }
    if (caption) caption.textContent = "NO TARGET";
    if (name) name.textContent = "等待目标";
    if (type) type.textContent = "扫描中";
    if (bars) bars.innerHTML = '<div class="combat-scan-message">正在扫描海盗星带信号…</div>';
    if (stats) stats.textContent = "尚未锁定敌舰";
    if (image) image.innerHTML = '<div class="combat-ship-placeholder"><span>👾</span></div>';
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
  if (deathspaceGrid) deathspaceGrid.innerHTML = display.deathspaces.map(site => `<button class="deathspace-card${site.selected ? " selected" : ""}${site.locked ? " locked" : ""}" data-deathspace="${site.id}" ${site.locked ? "disabled" : ""}><strong>${site.name}</strong><span>🎫 ${site.ticketMaterial} ×${site.ticketCount}</span><small>来源：${site.sourceZoneName}精英/BOSS · 5%</small><small>${site.maxWave}层 · 每层${site.waveLp} LP · 全通共${site.waveLp * site.maxWave + site.clearLpBonus} LP · 已全通 ${site.clears}</small><small class="deathspace-rare">💠 ${site.coreMaterial} · 📜 ${site.protocolMaterial} 2%</small></button>`).join("");
  const dropButton = document.getElementById("combat-zone-dropbtn"); if (dropButton) dropButton.textContent = display.zone.name + " ▾";
  const zoneContent = document.getElementById("combat-zone-dropdown-content");
  if (zoneContent) zoneContent.innerHTML = display.zones.map(zone => `<div class="area-option${zone.selected ? " selected" : ""}${zone.locked ? " locked" : ""}" data-zone="${zone.id}">${zone.name} <span class="area-req">安全 ${zone.secLevel}${zone.requiredCL ? " · 战斗等级 " + zone.requiredCL : ""} · 肃清 ${zone.clears}</span></div>`).join("");
  const playerImage = document.getElementById("combat-player-image"); if (playerImage) playerImage.innerHTML = display.player.image ? `<img src="${display.player.image}" alt="${display.player.name}" style="max-width:100%;max-height:100%;object-fit:contain;">` : '<span class="combat-ship-placeholder">🚀</span>';
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  text("combat-cl-val", display.level); text("combat-laser-lv", display.skills.laser); text("combat-cannon-lv", display.skills.cannon); text("combat-missile-lv", display.skills.missile); text("combat-target-lv", display.skills.targeting);
  renderInstalledCombatControls(display); renderCombatEquipmentRack(display); renderCombatLiveDisplay(display);
  return display;
}

function updateCombatLiveUI(now) {
  const renderTime = Number(now) || Date.now();
  updateCombatRecovery(renderTime);
  const display = getCombatDisplayState(gameState, renderTime);
  renderCombatLiveDisplay(display);
  return display;
}

function startCombatEncounter() {
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
      else if (result.reason === "missing-ticket") showToast("缺少：" + result.ticketMaterial);
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
  const start = document.getElementById("btn-start-combat"); if (start) start.addEventListener("click", startCombatEncounter);
  const stop = document.getElementById("btn-stop-combat"); if (stop) stop.addEventListener("click", stopCombatEncounter);
})();
