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

// 同位素标记打捞臂：战斗界面开关（仅已装备打捞臂时显示）。
// 开=消耗被动三倍燃料+同位素+掉落同级舰船组件；关=仅被动：消耗基础燃料提高货柜掉落。
function renderCombatSalvageToggle() {
  const title = document.getElementById("combat-salvage-title");
  const row = document.getElementById("combat-salvage-arm-row");
  if (!row) return;
  const equipped = (typeof hasSalvageArmEquipped === "function") ? hasSalvageArmEquipped(gameState) : false;
  if (!equipped) {
    if (title) title.style.display = "none";
    row.style.display = "none";
    row.innerHTML = "";
    return;
  }
  if (title) title.style.display = "";
  row.style.display = "";
  const active = gameState.combat.salvageArmActive === true;
  const isoHave = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, "planetary:同位素") : 0;
  const label = active
    ? "主动打捞：开（消耗被动三倍燃料及同位素，几率获得同级舰船组件）"
    : "主动打捞：关（仅被动：消耗基础燃料提高货柜掉落）";
  const btnStyle = "width:100%;text-align:left;padding:7px 10px;border-radius:6px;cursor:pointer;font-size:12px;box-sizing:border-box;border:1px solid " +
    (active ? "#3fd07a" : "#3a4a5a") + ";background:" + (active ? "rgba(63,208,122,.16)" : "rgba(255,255,255,.04)") +
    ";color:" + (active ? "#8ff0b5" : "#9fb3c8") + ";";
  row.innerHTML = `<button id="btn-salvage-arm-toggle" style="${btnStyle}">${active ? "⦿" : "○"} ${label}</button>` +
    (active && isoHave <= 0 ? '<span style="color:#ffb454;font-size:11px;margin-left:6px;">⚠ 同位素不足，无法打捞</span>' : '');
  const btn = document.getElementById("btn-salvage-arm-toggle");
  if (btn) {
    btn.onclick = () => {
      gameState.combat.salvageArmActive = !(gameState.combat.salvageArmActive === true);
      if (typeof renderCombatPanel === "function") renderCombatPanel();
    };
  }
}

function renderCombatEquipmentRack(display) {
  const grid = document.getElementById("combat-equipment-grid"); if (!grid) return;
  const icons = { high:"⚡", mid:"◉", low:"◆", rig:"◇" };
  grid.innerHTML = display.equipmentRack.length ? display.equipmentRack.map(item => `<div class="combat-equip-slot${item.empty ? " empty" : ""}" title="${item.attributes}"><span class="combat-equip-icon">${icons[item.slot]}</span><span class="combat-equip-copy"><span class="combat-equip-name">${item.name}</span><span class="combat-equip-type">${item.slotName} ${item.index + 1}</span></span></div>`).join("") : '<div class="combat-equip-slot empty"><span class="combat-equip-icon">◇</span><span class="combat-equip-copy"><span class="combat-equip-name">暂无槽位</span><span class="combat-equip-type">舰体配置</span></span></div>';
}

// 战斗补给状态（2026-09-03 玩家反馈「弹窗提示不够明显」）：
// ① 燃料/弹药加续航预估与三档状态色；② 常驻告警条——与出击 toast 的本质区别是不会自动消失；
// ③ 断火原因 lastStatus 常驻展示（combat.js 写入该字段后从未渲染，玩家武器哑火却看不到原因）。
// 告警区动态创建并插到补给面板之前，保证玩家折叠补给面板时依然可见。
// 判定口径全部复用 getCombatSupplyWarning（出击弹窗同一函数），不新造公式。
function renderCombatSupplyStatus(display) {
  const supply = display.supply || null;
  const panel = document.getElementById("combat-supply-panel");
  let alertBox = document.getElementById("combat-supply-alert");
  if (!alertBox && panel && panel.parentNode) {
    alertBox = document.createElement("div");
    alertBox.id = "combat-supply-alert";
    alertBox.className = "combat-supply-alert";
    panel.parentNode.insertBefore(alertBox, panel);
  }
  // 燃料格：数量 + 续航预估 + 三档色
  const fuelEl = document.getElementById("combat-fuel-val");
  if (fuelEl) {
    fuelEl.textContent = Number(display.supplies.fuel || 0).toLocaleString();
    const item = fuelEl.closest ? fuelEl.closest(".csp-item") : null;
    const rounds = supply ? (Number(supply.fuelRounds) || 0) : 0;
    const level = !supply ? "ok" : (supply.fuel === "none" ? "none" : (supply.fuel === "low" ? "low" : "ok"));
    let note = item ? item.querySelector(".csp-note") : null;
    if (item && !note) { note = document.createElement("i"); note.className = "csp-note"; item.appendChild(note); }
    if (note) {
      note.textContent = level === "none"
        ? " ⛔"
        : (" · 约 " + rounds.toLocaleString() + " 轮" + (level === "low" ? " ⚠" : ""));
      note.style.color = level === "none" ? "#e06c5a" : (level === "low" ? "#e8b04a" : "");
    }
  }
  // 弹药格：仅对当前武器实际使用的类型着状态色，不误标未装备/未使用的类型
  const ammoIds = { laser:"combat-ammo-laser", missile:"combat-ammo-missile", cannon:"combat-ammo-cannon" };
  const types = (supply && Array.isArray(supply.ammoTypes)) ? supply.ammoTypes : [];
  for (const t in ammoIds) {
    const el = document.getElementById(ammoIds[t]);
    const item = el && el.closest ? el.closest(".csp-item") : null;
    if (!item) continue;
    item.classList.remove("csp-warn", "csp-block");
    if (!supply || types.indexOf(t) < 0) continue;
    if (supply.ammo === "none" || supply.ammo === "wrong") item.classList.add("csp-block");
    else if (supply.ammo === "low") item.classList.add("csp-warn");
  }
  if (!alertBox) return;
  const lines = [];
  if (supply) {
    if (supply.fuel === "none") lines.push("⛔ 燃料耗尽，武器无法开火");
    else if (supply.fuel === "low") lines.push("⚠ 燃料仅够约 " + (Number(supply.fuelRounds) || 0).toLocaleString() + " 轮 —— 请及时补给");
    if (supply.ammo === "none") lines.push("⛔ 未装备弹药，将无法开火");
    else if (supply.ammo === "wrong") lines.push("⛔ 弹药类型错误，已装填弹药与当前武器不匹配");
    else if (supply.ammo === "low") lines.push("⚠ 已装填弹药仅够约 " + (Number(supply.ammoVolleys) || 0).toLocaleString() + " 次齐射");
  }
  // 断火原因只在「确实打不了」时展示，避免把上一次战斗的陈旧 lastStatus 一直挂着
  const blocked = Boolean(supply && (supply.fuel === "none" || supply.ammo === "none" || supply.ammo === "wrong"));
  if (blocked && display.lastStatus) lines.push("⛔ " + display.lastStatus);
  const isBlocking = lines.some(s => s.indexOf("⛔") === 0);
  alertBox.innerHTML = lines.length ? lines.map(s => squadEscape(s)).join("<br>") : "";
  alertBox.style.display = lines.length ? "" : "none";
  alertBox.classList.toggle("blocking", isBlocking);
}

function renderCombatLiveDisplay(display) {
  renderCombatCrewSummary(display);
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  text("combat-header-info", display.headerText); text("combat-wave-num", display.wave); text("combat-wave-max", display.maxWave); text("combat-clear-label", display.encounterMode === "deathspace" ? "已全通" : "已肃清"); text("combat-clear-count", display.clearCount); text("combat-lock-state", display.lockText); text("combat-player-ship", display.player.name);
  const playerBars = document.getElementById("combat-player-bars"); if (playerBars) playerBars.innerHTML = renderHPBars(display.player.hp, display.player.maxHp);
  text("combat-player-stats", "齐射伤害:" + display.player.volleyDamage + " · 武器:" + display.player.weaponCount + " · 航速:" + display.player.speed);
  renderCombatEnemyPanel(display); updateCombatRing(display);
  const rewards = document.getElementById("combat-rewards"); if (rewards) { rewards.style.display = display.showRewards ? "" : "none"; if (display.showRewards) rewards.textContent = display.runStatus; }
  renderCombatSupplyStatus(display);
  const start = document.getElementById("btn-start-combat"); const stop = document.getElementById("btn-stop-combat");
  if (start) { start.style.display = display.controls.showStart ? "" : "none"; start.disabled = display.controls.startDisabled; start.textContent = display.controls.startText; }
  if (stop) stop.style.display = display.controls.showStop ? "" : "none";
  // 星带/死亡空间共用同一个「开始」按钮触发确认弹窗；死亡空间下隐藏 belt 波次信息
  const waveSpan = document.querySelector(".combat-wave");
  if (waveSpan) waveSpan.style.display = display.mode === "deathspace" ? "none" : "";
  // 战斗队列进度：普通星带显示「清波 X/Y」，死亡空间显示「入场 X/Y」
  const progressEl = document.getElementById("combat-queue-progress");
  if (progressEl) {
    const c = gameState.combat;
    if (c && c.queueItemId) {
      if (c.queueWavesTarget > 0) progressEl.textContent = "队列剩余：清波 " + (c.queueWavesDone || 0) + "/" + c.queueWavesTarget;
      else if (c.queueEntriesTarget > 0) progressEl.textContent = "队列剩余：入场 " + (c.queueEntriesDone || 0) + "/" + c.queueEntriesTarget;
      else progressEl.textContent = "";
      progressEl.style.display = "";
    } else {
      progressEl.textContent = "";
      progressEl.style.display = "none";
    }
  }
  document.body.classList.toggle("in-combat", display.active);
  renderCombatAmmoLoadout(gameState);
}

// 弹药装载面板：列出每型弹药各实例（按档降序），玩家勾选「已装载」控制是否带入战斗
function renderCombatAmmoLoadout(state) {
  const wrap = document.getElementById("combat-ammo-loadout");
  if (!wrap) return;
  // 折叠即跳过渲染：合并面板（combat-supply-panel）关闭时跳过 innerHTML 写入，解放每 tick/周期开销。
  // 展开时由 details 的 toggle 事件触发单次补渲染。
  const panel = document.getElementById("combat-supply-panel");
  if (panel && !panel.open) { wrap._needsRender = true; return; }
  if (panel && !panel._ammoCollapseBound) {
    panel._ammoCollapseBound = true;
    panel.addEventListener("toggle", function () {
      if (panel.open && wrap._needsRender) { wrap._needsRender = false; renderCombatAmmoLoadout(state); }
    });
  }
  const types = ["laser", "missile", "cannon"];
  const groups = [];
  for (const type of types) {
    const stacks = (state.ammo || []).filter(s => s.type === type && (s.qty || 0) > 0);
    if (!stacks.length) continue;
    stacks.sort((a, b) => ammoTierRank(b.tier) - ammoTierRank(a.tier));
    const stackHtml = stacks.map(s => {
      const on = s.loaded !== false;
      const tierTag = s.tier === "T2"
        ? '<span class="ammo-tier-tag t2">⚡T2 · 伤害/命中 +10%</span>'
        : '<span class="ammo-tier-tag t1">T1</span>';
      return `<div class="ammo-stack">${tierTag}<span class="ammo-stack-name">${escHtml(s.name)}</span><span class="ammo-stack-qty">×${s.qty.toLocaleString()}</span><button class="ammo-load-toggle${on ? " on" : ""}" data-ammo-id="${escHtml(s.id)}">${on ? "已装载" : "未装载"}</button></div>`;
    }).join("");
    groups.push(`<div class="ammo-type-group"><div class="ammo-type-name">${AMMO_TYPE_NAMES[type]}</div><div class="ammo-stacks">${stackHtml}</div></div>`);
  }
  wrap.innerHTML = groups.length ? groups.join("") : '<div class="ammo-empty">无弹药库存（去制造台生产）</div>';
  wrap.querySelectorAll(".ammo-load-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-ammo-id");
      const st = (state.ammo || []).find(s => s.id === id);
      if (!st) return;
      st.loaded = (st.loaded === false); // 切换已装载/未装载
      if (typeof renderCombatPanel === "function") renderCombatPanel();
    });
  });
}
function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

/* ================================================================
   战斗 3D（左右晃动体现战斗）
   ================================================================ */
function mountCombat3D(display) {
  const S3D = window.Ship3D;
  if (!S3D) return; // 模块尚未就绪时静默跳过，后续 tick 会补上

  // 玩家舰：当前出战舰（combat.activeShip → 实例 → 蓝图 id）
  // 修复：无拥有战斗舰时不渲染幽灵模型，保留/恢复占位符（🚀），与机库保持一致。
  // 关键：必须用 display.player.hasShip（已按"是否真有指派战斗舰"计算），
  //       不能重新调 getActiveCombatShipState（它的 ships[0] 回退会把库存未指派舰误判为 active）。
  try {
    let playerShipId = "rifter";
    const hasPlayerShip = !!(display && display.player && display.player.hasShip);
    if (!hasPlayerShip) {
      const pImg = document.getElementById("combat-player-image");
      if (pImg) {
        const old = pImg.querySelector("#combat-player-3d");
        if (old) old.remove();
        pImg.innerHTML = '<span class="combat-ship-placeholder">🚀</span>';
      }
      mountCombat3D._playerSpec = null;
    } else {
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

// ================================================================
// 军团 NPC 战斗小队（M5）—— 战斗面板小队区域
// 只读渲染 + 事件委托；所有状态变更统一走 LEGION_COMBAT_SQUAD 的 action/system 接口，
// UI 绝不直接改 state.combat.squad 或 NPC 字段。
// ================================================================
function legionSquadApi() {
  return (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD) ? LEGION_COMBAT_SQUAD : null;
}
function squadEscape(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function squadHpBars(hp, maxHp) {
  if (!hp || !maxHp) return "";
  return ["shield", "armor", "structure"].map(function (key) {
    const cur = Math.max(0, Number(hp[key]) || 0);
    const max = Math.max(1, Number(maxHp[key]) || 1);
    const pct = Math.max(0, Math.min(100, Math.round(cur / max * 100)));
    return '<span class="lcs-hp ' + key + '"><i style="width:' + pct + '%"></i><em>' + cur + "/" + max + "</em></span>";
  }).join("");
}
function renderCombatSquadSection(now) {
  const host = document.getElementById("combat-squad-section");
  if (!host) return;
  const api = legionSquadApi();
  if (!api || typeof api.getLegionCombatSquadUiState !== "function") { host.innerHTML = ""; host.style.display = "none"; return; }
  const t = Number(now) || Date.now();
  const ui = api.getLegionCombatSquadUiState(gameState, { now: t });
  const combatNpcs = (ui.candidates || []).filter(c => c.isCombatSkill);
  host.style.display = "";
  const capacity = Math.max(0, ui.capacity);
  const selection = (ui.selection || []).filter(Boolean);
  const active = Boolean(ui.active);
  // 结构签名：仅这些维度变化才需整体重建（含原生 <select>）。
  // 空闲（未交战）且签名未变时直接返回 —— 否则 updateCombatLiveUI 每秒 innerHTML 重建会
  // 把用户刚打开的「挑选 NPC 上场」下拉瞬间销毁（闪退）。交战中（active）仍需每秒重建以刷新血条/状态。
  // 注意：修复倒计时只取布尔（修复中/否），不取剩余秒数，避免空闲时每秒都因秒数变化而重建。
  const structSig = [
    capacity,
    combatNpcs.map(function (c) {
      return [c.npcId, c.level || 0, c.shipName || "", c.inSquad ? "S" : "-", c.destroyedInBattle ? "D" : "-",
        (c.repair && c.repair.repairing) ? "R" : "-", c.salaryState || "", c.skillName || ""].join(":");
    }).join(","),
    selection.join(","),
    active ? "A" : "I",
    combatNpcs.length,
    "D:" + (ui.deployedCount || 0) + "/" + (ui.deployableStorage ? ui.deployableStorage.length : 0),
    "F:" + (typeof ResourceRegistry !== "undefined" ? ResourceRegistry.get(gameState, "consumable:fuel") : 0)
  ].join("|");
  if (!active && structSig === host._squadStructSig) return; // 空闲且结构未变：保留打开态的下拉，不重建
  host._squadStructSig = structSig;

  // 协议行
  const proto = ui.tripleUnlocked ? "三人协议已解锁" : (ui.dualUnlocked ? "双人协议已解锁" : "双人协议未解锁");
  const protoHint = ui.tripleUnlocked ? "最多可选 2 名战斗 NPC" : (ui.dualUnlocked ? "最多可选 1 名战斗 NPC（三人协议未解锁）" : "未研究「双人战斗小队」：只能玩家单舰战斗");
  const head = '<div class="lcs-head">' +
    '<span class="lcs-title"><i class="fa-solid fa-people-group"></i> 战斗小队</span>' +
    '<span class="lcs-proto' + (ui.dualUnlocked ? " on" : " off") + '">' + squadEscape(proto) + "</span>" +
    '<span class="lcs-count">上限 ' + (ui.capacity + 1) + " 人（含玩家）</span>" +
    "</div>";
  if (combatNpcs.length === 0) {
    host.innerHTML = head + '<div class="lcs-empty">暂无战斗技能 NPC；招募并绑定战斗舰、安装武器后即可编入小队。</div>';
    return;
  }
  if (capacity === 0) {
    host.innerHTML = head + '<div class="lcs-note warn">' + squadEscape(protoHint) + "：只能玩家单舰战斗。</div>" + renderSquadDeployables(ui, 0);
    return;
  }
  // 槽位数 = 当前协议容量（1 或 2），按 selection 顺序映射到各槽位。
  // selection 项可能是 npcId 或 "deployable:<id>"（部署物前缀）；两者都视为占一格。
  const PREFIX = (typeof LEGION_COMBAT_SQUAD !== "undefined" && LEGION_COMBAT_SQUAD.MTU_DEPLOYABLE_PREFIX) || "deployable:";
  const slotEntries = [];
  for (let i = 0; i < capacity; i++) {
    const id = selection[i];
    if (!id) { slotEntries.push({ kind: "empty" }); continue; }
    if (typeof id === "string" && id.indexOf(PREFIX) === 0) {
      const did = id.substring(PREFIX.length);
      const dep = (ui.deployables || []).find(d => d.deployableId === did);
      slotEntries.push({ kind: "deployable", deployableId: did, name: dep ? dep.name : did });
    } else {
      const npc = combatNpcs.find(c => c.npcId === id);
      slotEntries.push({ kind: "npc", npc: npc || null, id: id });
    }
  }
  const slotsHtml = slotEntries.map(function (entry, idx) {
    return renderSquadSlot(entry, idx, combatNpcs, selection, ui, PREFIX);
  }).join("");
  const orderHtml = active ? renderSquadFireOrder(ui) : "";
  const lockedNote = active ? '<div class="lcs-note">战斗进行中：成员与舰船已锁定，不可更换。</div>' : "";
  const deployHtml = renderSquadDeployables(ui, capacity);
  host.innerHTML = head + orderHtml + '<div class="lcs-slots">' + slotsHtml + "</div>" + lockedNote + deployHtml;
}

let combatConfigShipKey = "player";

function getCombatConfigForShip(display, shipKey) {
  if (!shipKey || shipKey === "player" || typeof getInstalledCombatModulesFromState !== "function") {
    return { weapons: display.weapons, repairers: display.repairers, equipmentRack: display.equipmentRack };
  }
  const crew = getCombatCrewSummary(display);
  const item = crew.items.find(function (entry) { return entry.key === shipKey; });
  if (!item || !item.shipInstanceId) return { weapons: display.weapons, repairers: display.repairers, equipmentRack: display.equipmentRack };
  const modules = getInstalledCombatModulesFromState(gameState, { shipInstanceId: item.shipInstanceId, excludeImplants: true });
  const slotNames = { high: "高槽", mid: "中槽", low: "低槽", rig: "改装" };
  const toModule = function (module) { return { ...module, icon: module.combat && module.combat.kind === "weapon" ? "⚡" : "◉" }; };
  return {
    weapons: modules.filter(function (module) { return module.combat && module.combat.kind === "weapon"; }).map(toModule),
    repairers: modules.filter(function (module) { return module.combat && module.combat.kind === "repair"; }).map(toModule),
    equipmentRack: modules.map(function (module, index) { return { name: module.name, slotName: slotNames[module.slot] || module.slot, index: index, attributes: "NPC 舰船配置", empty: false }; })
  };
}

function renderCombatConfig(display) {
  const config = getCombatConfigForShip(display, combatConfigShipKey);
  renderInstalledCombatControls(config);
  renderCombatEquipmentRack(config);
}

function renderSquadFireOrder(ui) {
  const round = ui && ui.lastRound;
  const entries = round && Array.isArray(round.perNpc) ? round.perNpc : [];
  if (!entries.length) return '<div class="lcs-fire-order"><span class="lcs-fire-order-title">本轮开火顺序</span><span class="lcs-fire-order-empty">等待开火</span></div>';
  const enemyById = {};
  const enemies = gameState && gameState.combat && Array.isArray(gameState.combat.enemies) ? gameState.combat.enemies : [];
  enemies.forEach(function (enemy) { if (enemy && enemy.id != null) enemyById[enemy.id] = enemy; });
  const nameByNpc = {};
  (ui.candidates || []).forEach(function (candidate) { if (candidate && candidate.npcId != null) nameByNpc[candidate.npcId] = candidate.name || candidate.npcId; });
  const rows = entries.map(function (entry, idx) {
    const npcName = nameByNpc[entry.npcId] || entry.npcId || ("NPC " + (idx + 1));
    const target = entry.targetId != null ? enemyById[entry.targetId] : null;
    const targetName = target ? (target.name || target.type || target.kind || entry.targetId) : (entry.skipped ? "跳过：" + entry.skipped : "无目标");
    const cls = entry.skipped ? " skipped" : "";
    return '<span class="lcs-fire-order-item' + cls + '"><b>' + (idx + 1) + '</b> ' + squadEscape(npcName) + ' → ' + squadEscape(String(targetName)) + '</span>';
  }).join("");
  return '<div class="lcs-fire-order"><span class="lcs-fire-order-title">本轮开火顺序</span><span class="lcs-fire-order-current">当前目标：' + squadEscape(String(ui.currentTargetId || round.targetId || "无")) + '</span><div class="lcs-fire-order-list">' + rows + '</div></div>';
}

// 单个 NPC 方块（玩家左侧）：头像 + 名字 + 下拉选角 + 三色实时血条 + 状态徽标。
// entry 可能为：{kind:"empty"} | {kind:"npc", npc, id} | {kind:"deployable", deployableId, name}
function renderSquadSlot(entry, idx, allNpcs, selection, ui, prefix) {
  const locked = ui.active;
  const kind = entry ? entry.kind : "empty";
  const selfValue = (kind === "npc") ? entry.id
                  : (kind === "deployable") ? (prefix + entry.deployableId)
                  : "";
  // deployable 选项在每个槽都常驻：让玩家从任一空槽切到 MTU，已装备也允许重选/取消。
  // 当已装备在另一槽 → 本槽 disabled；本容量已满 → 本槽 disabled（除非 selfValue 就是它，表示可以"取消"）。
  const deployableId = "laser_directional_salvage_unit";
  const depValue = prefix + deployableId;
  const depSelected = selfValue === depValue;
  const depElsewhereSelected = selection.indexOf(depValue) >= 0 && selfValue !== depValue;
  // 拥有门控：未制造/未拥有的 MTU 不允许在空槽选入（杜绝"未制造即部署"漏洞）；
  // 已选中（已部署）或库存中确实拥有时允许。
  const ownsMtu = depSelected || ((ui.deployableStorage || []).indexOf(deployableId) >= 0);
  // 已被占用的槽位数（NPC + deployable 都算）
  const usedSlotsNow = (ui.selection ? (ui.selection || []).filter(Boolean).length : 0);
  const capacity = Math.max(0, ui.capacity);
  // 容量门控：仅阻止"空槽再塞 MTU 且容量已满"。
  // NPC→MTU 同槽互换是等量替换（数据层 setLegionSquadSelection 整组 REPLACE），永远允许，玩家看见 disabled 才奇怪。
  const capacityWouldOverflow = !depSelected && kind === "empty" && usedSlotsNow >= capacity;
  const depDisabled = !depSelected && (depElsewhereSelected || capacityWouldOverflow || !ownsMtu);
  const npcOptions = allNpcs.map(function (c) {
    const otherSelected = selection.indexOf(c.npcId) >= 0 && selfValue !== c.npcId;
    const selected = kind === "npc" && entry.id === c.npcId;
    return '<option value="' + squadEscape(c.npcId) + '"' + (selected ? " selected" : "") + (otherSelected ? " disabled" : "") + ">" +
      squadEscape(c.name) + " Lv." + Number(c.level || 1) + " · " + squadEscape(c.skillName || "") + (c.shipName ? " · " + squadEscape(c.shipName) : "") + "</option>";
  }).join("");
  const deployableOption = '<option value="' + squadEscape(depValue) + '"' + (depSelected ? " selected" : "") + (depDisabled ? " disabled" : "") + ">🛰️ " + squadEscape("激光定向打捞单元") + " · 部署物</option>";
  const options = ['<option value="">— 选择 NPC —</option>', deployableOption].concat(npcOptions).join("");
  let avatar = "➕";
  let nameText = "空位 " + (idx + 1);
  let badges = [];
  let cls = " empty";
  let bars = '<div class="lcs-bars-empty">未参战</div>';
  let statusText = "";
  let dataAttr = "";
  if (kind === "npc" && entry.npc) {
    const npc = entry.npc;
    avatar = npc.destroyedInBattle ? "💀" : "🛡️";
    nameText = squadEscape(npc.name) + ' <small>Lv.' + Number(npc.level || 1) + "</small>";
    if (npc.inSquad && !npc.destroyedInBattle) badges.push('<span class="lcs-badge ok">出战中</span>');
    if (npc.destroyedInBattle) badges.push('<span class="lcs-badge bad">已爆船</span>');
    if (npc.repair && npc.repair.repairing) badges.push('<span class="lcs-badge warn">修复 ' + Math.ceil(npc.repair.remaining / 1000) + "s</span>");
    if (npc.salaryState && npc.salaryState !== "paid") badges.push('<span class="lcs-badge warn">欠薪</span>');
    cls = npc.destroyedInBattle ? " destroyed" : (npc.inSquad && !npc.destroyedInBattle ? " active" : "");
    if (npc.hp && npc.maxHp) {
      bars = ["shield", "armor", "structure"].map(function (key) {
        const cur = Math.max(0, Number(npc.hp[key]) || 0);
        const max = Math.max(1, Number(npc.maxHp[key]) || 1);
        const pct = Math.max(0, Math.min(100, Math.round(cur / max * 100)));
        const label = key === "shield" ? "护盾" : (key === "armor" ? "装甲" : "结构");
        return '<div class="lcs-mini-bar"><span class="lcs-mini-label">' + label + '</span><div class="lcs-mini-track"><div class="lcs-mini-fill ' + key + '" style="width:' + pct + '%"></div></div><span class="lcs-mini-val">' + cur + "</span></div>";
      }).join("");
    }
    statusText = npc.statusText || "";
    dataAttr = ' data-npc-id="' + squadEscape(npc.npcId) + '"';
  } else if (kind === "deployable") {
    // 部署物形态：🛰️ + 名 + 锁的 select（deployable selected），不显示 NPC 血条
    avatar = "🛰️";
    nameText = squadEscape(entry.name || entry.deployableId);
    cls = " active deployable";
    const def = (typeof getDeployableDefinition === "function") ? getDeployableDefinition(entry.deployableId) : null;
    const mtu = (typeof getMtuModifiers === "function") ? getMtuModifiers(gameState) : null;
    const activeMtu = !!(mtu && mtu.active);
    badges.push('<span class="lcs-badge ' + (activeMtu ? "ok" : "warn") + '">' + (activeMtu ? "部署中（生效）" : "已部署（断料暂停）") + "</span>");
    const fuelCost = mtu ? Math.max(1, Math.round(mtu.fuelPerKill)) : 0;
    const rarePct = def ? Math.round((def.rareDropBonus || 0) * 100) : 0;
    const eff = def ? ("货柜×" + (1 + def.salvageEfficiency).toFixed(1) + " · 星币/功勋+" + Math.round(def.iskBonus * 100) + "%" + (rarePct > 0 ? " · 稀有掉率+" + rarePct + "%" : "")) : "部署物";
    statusText = squadEscape(eff) + " · 每击毁 −燃料" + fuelCost;
    bars = '<div class="lcs-deploy-stats">' +
      '<span class="lcs-stat"><b>货柜</b>×' + (def ? (1 + def.salvageEfficiency).toFixed(1) : "—") + '</span>' +
      '<span class="lcs-stat"><b>星币</b>+' + Math.round((def ? def.iskBonus : 0) * 100) + '%</span>' +
      '<span class="lcs-stat"><b>功勋</b>+' + Math.round((def ? def.lpBonus : 0) * 100) + '%</span>' +
      (rarePct > 0 ? '<span class="lcs-stat"><b>稀有掉率</b>+' + rarePct + '%</span>' : "") +
      '</div>';
    dataAttr = ' data-deployable-id="' + squadEscape(entry.deployableId) + '"';
  } else if (kind === "empty" && usedSlotsNow >= capacity && capacity > 0) {
    statusText = "本槽已被占用（小队容量已满 " + capacity + " 格）";
  }
  return '<div class="lcs-slot' + (cls ? " " + cls : "") + '" id="lcs-slot-' + idx + '"' + dataAttr + '>' +
    '<div class="lcs-slot-head">' +
      '<span class="lcs-slot-avatar">' + avatar + "</span>" +
      '<span class="lcs-slot-name">' + nameText + "</span>" +
    "</div>" +
    '<select class="lcs-slot-select" data-slot="' + idx + '"' + (locked ? " disabled" : "") + ">" + options + "</select>" +
    '<div class="lcs-mini-bars">' + bars + "</div>" +
    (badges.length ? '<div class="lcs-slot-badges">' + badges.join("") + "</div>" : "") +
    (statusText ? '<div class="lcs-slot-status">' + statusText + "</div>" : "") +
    "</div>";
}
// 部署物（激光定向打捞单元）面板：仅库存可部署（部署/取消部署由上方小队槽位的下拉选择全权管理，已部署卡不在此重复渲染）。
function renderSquadDeployables(ui, capacity) {
  const deployed = (ui && ui.deployables) || [];
  const storage = (ui && ui.deployableStorage) || [];
  let html = '<div class="lcs-deployables">';
  html += '<div class="lcs-deploy-title"><i>🛰️</i> 部署物（激光定向打捞单元）</div>';
  if (deployed.length === 0 && storage.length === 0) {
    html += '<div class="lcs-deploy-empty">未拥有；请于舰船总装「特殊」线制造。占用小队 1 格，提高战利品产出、消耗燃料。</div>';
    html += "</div>";
    return html;
  }
  // 已部署状态（生效/断料/取消部署）一律看小队槽位卡；此处仅在库存为空时给一行提示。
  if (storage.length === 0) {
    html += '<div class="lcs-deploy-empty">库存为空 · ' + deployed.length + " 台已部署（见上方小队槽位）</div>";
    html += "</div>";
    return html;
  }
  if (storage.length > 0) {
    const used = (ui.selection ? ui.selection.length : 0) + deployed.length;
    const canDeploy = (capacity || 0) > 0 && used < (capacity || 0);
    const deployedIds = (deployed || []).map(function (d) { return d.deployableId; });
    storage.forEach(function (id) {
      const def = (typeof getDeployableDefinition === "function") ? getDeployableDefinition(id) : null;
      const defName = def ? def.name : id;
      const canDis = deployedIds.indexOf(id) < 0;
      html += '<div class="lcs-deploy-card stored">' +
        '<span class="lcs-deploy-name">' + squadEscape(defName) + "</span>" +
        '<span class="lcs-deploy-effects">已拥有 · 待部署</span>' +
        '<button class="lcs-deploy-btn deploy" data-deploy="' + squadEscape(id) + '"' + (canDeploy ? "" : " disabled") + ">部署（占 1 格）</button>" +
        '<button class="lcs-deploy-btn recycle" data-dismantle-deployable="' + squadEscape(id) + '"' + (canDis ? "" : " disabled") + ' title="拆解回收（按冶炼回收率退还材料）">♻ 回收</button>' +
        "</div>";
    });
    if (!canDeploy) html += '<div class="lcs-deploy-hint">小队格位不足：需空出 1 个共享格（与 NPC 成员互斥）才能部署。</div>';
  }
  html += "</div>";
  return html;
}
function bindCombatSquadUI() {
  const host = document.getElementById("combat-squad-section");
  if (!host) return;
  // 用 once 绑定防止重复累加（bindCombatUI 在启动期可能调用多次）
  if (host._squadBound) return;
  host._squadBound = true;
  host.addEventListener("change", function (event) {
    const sel = event.target && event.target.closest ? event.target.closest(".lcs-slot-select") : null;
    if (!sel) return;
    const api = legionSquadApi();
    if (!api || typeof api.setLegionSquadSelection !== "function") return;
    // 收集所有槽位下拉的当前值，组装成 selection 集合（去重、按容量由 API 钳制）
    const selects = host.querySelectorAll(".lcs-slot-select");
    const next = [];
    selects.forEach(function (s) {
      const v = s.value;
      if (v && next.indexOf(v) < 0) next.push(v);
    });
    const res = api.setLegionSquadSelection(gameState, next, { now: Date.now() });
    if (res.changed === false && res.reason) {
      if (typeof showToast === "function") {
        const reason = api.JOIN_REASONS && api.JOIN_REASONS[res.reason] ? api.JOIN_REASONS[res.reason] : res.reason;
        showToast("⚠ " + reason);
      }
    }
    renderCombatSquadSection(Date.now());
  });
  // 部署物：部署 / 取消部署 / 拆解回收（事件委托，点击）
  host.addEventListener("click", function (event) {
    const btn = event.target && event.target.closest ? event.target.closest("[data-deploy],[data-undeploy],[data-dismantle-deployable]") : null;
    if (!btn || btn.disabled) return;
    const api = legionSquadApi();
    if (!api) return;
    let res = null;
    if (btn.dataset.undeploy) {
      const fn = api.undeployDeployable;
      if (typeof fn === "function") res = fn(gameState, btn.dataset.undeploy);
    } else if (btn.dataset.deploy) {
      const fn = api.deployDeployable;
      if (typeof fn === "function") res = fn(gameState, btn.dataset.deploy);
    } else if (btn.dataset.dismantleDeployable) {
      const fn = api.dismantleDeployable;
      if (typeof fn === "function") res = fn(gameState, btn.dataset.dismantleDeployable);
    }
    if (res && res.changed === false && res.reason && typeof showToast === "function") {
      const reasonMap = Object.assign({}, api.JOIN_REASONS || {}, {
        deployed:"已部署中，先取消部署再回收", "no-recipe":"无拆解配方", "not-in-storage":"不在库存", "no-squad":"无战斗小队"
      });
      const reason = reasonMap[res.reason] ? reasonMap[res.reason] : res.reason;
      showToast("⚠ " + reason);
    } else if (res && res.changed && res.refundedResources && typeof showToast === "function") {
      const parts = Object.keys(res.refundedResources).map(function (k) { return k + "×" + res.refundedResources[k]; });
      showToast("♻ 已回收：" + (parts.join(" · ") || "无"));
    }
    renderCombatSquadSection(Date.now());
  });
}

// 战区烈度分级：按 zone.fuelMult（燃料消耗系数）映射 5 档标签。
// 1.0=极低(无环境耗油) / 1.2=低 / 1.35=中 / 1.6=高 / 1.8=极高。
function zoneIntensityLabel(fuelMult) {
  const m = Number(fuelMult) || 1;
  if (m <= 1.05) return { label: "极低", cls: "c-gray" };
  if (m <= 1.25) return { label: "低", cls: "c-green" };
  if (m <= 1.45) return { label: "中", cls: "c-yellow" };
  if (m <= 1.7) return { label: "高", cls: "c-orange" };
  return { label: "极高", cls: "c-red" };
}

function renderCombatPanel(now) {
  const renderTime = Number(now) || Date.now();
  updateCombatRecovery(renderTime);
  const display = getCombatDisplayState(gameState, renderTime);
  renderCombatSquadSection(renderTime);
  document.querySelectorAll("[data-combat-mode]").forEach(button => button.classList.toggle("active", button.dataset.combatMode === display.mode));
  const zoneSelector = document.getElementById("combat-zone-selector"); if (zoneSelector) zoneSelector.style.display = display.mode === "belt" ? "" : "none";
  const deathspacePanel = document.getElementById("deathspace-selector-panel"); if (deathspacePanel) deathspacePanel.style.display = display.mode === "deathspace" ? "" : "none";
  const queueControl = document.getElementById("combat-queue-control"); if (queueControl) queueControl.style.display = "none";
  const chainControl = document.getElementById("deathspace-chain-control"); if (chainControl) chainControl.style.display = "none";
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
  const intensityEl = document.getElementById("combat-zone-intensity");
  if (intensityEl) {
    const curZone = COMBAT_ZONES.find(z => z.id === (gameState.combat && gameState.combat.zone)) || display.zone || null;
    const it = curZone ? zoneIntensityLabel(curZone.fuelMult) : null;
    if (it) { intensityEl.textContent = `战区烈度：${it.label}（燃料消耗×${curZone.fuelMult}）`; intensityEl.className = "zone-intensity " + it.cls; }
    else intensityEl.textContent = "";
  }
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
  if (zoneContent) zoneContent.innerHTML = display.zones.map(zone => {
    const zObj = COMBAT_ZONES.find(z => z.id === zone.id);
    const it = zObj ? zoneIntensityLabel(zObj.fuelMult) : null;
    const intHtml = it ? `<span class="area-intensity ${it.cls}">战区烈度：${it.label} · 燃料消耗×${zObj.fuelMult}</span>` : "";
    return `<div class="area-option${zone.selected ? " selected" : ""}${zone.locked ? " locked" : ""}" data-zone="${zone.id}">${zone.name} <span class="area-req">安全 ${zone.secLevel}${zone.requiredCL ? " · 战斗等级 " + zone.requiredCL : ""} · 肃清 ${zone.clears}</span>${intHtml}</div>`;
  }).join("");
  const playerImage = document.getElementById("combat-player-image"); if (playerImage && !playerImage.querySelector("#combat-player-3d")) playerImage.innerHTML = display.player.image ? `<img src="${display.player.image}" alt="${display.player.name}" style="max-width:100%;max-height:100%;object-fit:contain;">` : '<span class="combat-ship-placeholder">🚀</span>';
  const text = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  text("combat-cl-val", display.level); text("combat-laser-lv", display.skills.laser); text("combat-cannon-lv", display.skills.cannon); text("combat-missile-lv", display.skills.missile); text("combat-target-lv", display.skills.targeting);
  // 控制台折叠摘要：无论展开/折叠都更新 summary 行（船名 + 波次 + HP 百分比）
  const crew = renderCombatCrewSummary(display);
  const cccWave = document.getElementById("ccc-wave-info"); if (cccWave) cccWave.textContent = display.active ? "WAVE " + display.wave + "/" + display.maxWave : "待命";
  const cccLegend = document.getElementById("ccc-ring-legend");
  if (cccLegend) cccLegend.innerHTML = ["shield","armor","structure"].map(function(k){var p=Math.round((display.player.hp[k]||0)/(display.player.maxHp[k]||1)*100);return '<span class="'+k+'">'+p+'%</span>';}).join("");
  const ccc = document.getElementById("combat-command-console");
  if (!ccc || ccc.open === false) {
    // 折叠时跳过控制台内部所有重量级渲染（武器行/装备网格/维修/打捞臂/DOM 写入）
    renderCombatLiveDisplay(display); /* 轻量：只写 text node */
    mountCombat3D(display);
    renderCombatDropPreview(display);
    return display;
  }
  renderCombatConfig(display); renderCombatLiveDisplay(display);
  renderCombatSalvageToggle();
  mountCombat3D(display);
  renderCombatDropPreview(display);
  return display;
}

// 掉落预览（Phase 3D 其他任务）：基于 getCombatDropPreview 纯函数渲染当前选中星带/死亡空间的
// 可能掉落物与概率。展示势力密钥/特殊掉落/装备专用数据/通行密钥/首领战利品/战术材料/货柜，不含 ISK/LP 经济与成功率。
// 战斗掉落行点击 → 打开对应物品卡片：dropId → 描述符（含货柜 fromCombat 标记）。
// 本渲染内聚合 name/icon，避免属性注入。
let _combatDropMeta = {};
function combatDropToItem(dropId) {
  const meta = _combatDropMeta[dropId];
  const name = meta ? meta.name : dropId;
  const icon = meta ? meta.icon : "📦";
  // 脑插卡片（死亡空间掉落预览点击）：直接读 IMPLANT_DB 定义
  if (dropId && (typeof IMPLANT_DB !== "undefined") && IMPLANT_DB[dropId]) {
    const imp = IMPLANT_DB[dropId];
    return {
      id: dropId,
      name: imp.name,
      icon: imp.icon || "🧠",
      description: (imp.desc || "") + (imp.sourceName ? "（来源：" + imp.sourceName + "）" : "") + "；在线与离线清场均有概率掉落。",
      source: { pageId: imp.source === "deathspace" ? "combat" : (imp.source || "combat"), pageLabel: "脑插", icon: "🧠" }
    };
  }
  if (dropId.indexOf("special:空间站") === 0 && dropId.indexOf("核心") > 0) {
    const coreKey = dropId.slice("special:".length);
    const owned = (typeof ResourceRegistry !== "undefined" && typeof gameState !== "undefined")
      ? ResourceRegistry.get(gameState, dropId) : 0;
    // 系数 B 各核心效果：冶炼/装备/增强剂走自动线 +10% 速度；船坞核心使部件制造材料消耗额外 -5%（复用船坞节省率）。
    const coreDesc = {
      "空间站冶炼核心": "【冶炼制造线】效率 +10%（系数 B）",
      "空间站船坞核心": "【舰船船坞·部件制造】材料消耗额外降低 2%（仅部件车间生效，与船坞等级节省加算）",
      "空间站装备制造核心": "【装备制造线】效率 +10%（系数 B）",
      "空间站增强剂制造核心": "【增强剂制造线】效率 +10%（系数 B）"
    }[coreKey] || "【对应制造线】效率 +10%（系数 B）";
    return {
      id: dropId,
      name: coreKey,
      icon: "🌟",
      categoryLabel: "空间站核心",
      quantity: owned,
      fromCombat: true,
      description: `空间站建设核心材料。${coreDesc}。全游戏唯一掉落，获得后该星带不再产出此核心。`,
      source: { pageId: "combat", pageLabel: "战斗掉落", icon: "fa-solid fa-crosshairs" }
    };
  }
  if (dropId.indexOf("cargo:") === 0 || dropId.indexOf("special:货柜") === 0) {
    const size = dropId.indexOf("cargo:") === 0 ? dropId.slice("cargo:".length) : dropId.slice("special:货柜".length);
    const sizeLabel = { S: "小型", M: "中型", L: "大型", XL: "超大型" }[size] || size;
    const owned = (typeof ResourceRegistry !== "undefined" && typeof gameState !== "undefined")
      ? ResourceRegistry.get(gameState, "special:货柜" + size) : 0;
    return {
      id: "special:货柜" + size,
      name: "货柜（" + sizeLabel + "）",
      icon: "📦",
      categoryLabel: "货柜",
      quantity: owned,
      fromCombat: true,
      description: "击坠敌人有概率掉落的低概率宝箱。开箱后按尺寸权重随机获得行星材料、晶体弹药、脑插或装备蓝图等奖励，尺寸越大奖励越丰厚。",
      source: { pageId: "combat", pageLabel: "战斗掉落", icon: "fa-solid fa-crosshairs" }
    };
  }
  // 通用 special: / gear: 战斗掉落材料 → 计算「可制造 / 可用途」并标注蓝图解锁状态。
  // gear: 仅用于装备生产许可等「装备专用数据」行，底层资源权威键仍是 special:<材料>。
  if (dropId.indexOf("special:") === 0 || dropId.indexOf("gear:") === 0) {
    const materialName = dropId.indexOf("special:") === 0
      ? dropId.slice("special:".length)
      : dropId.slice("gear:".length);
    const resourceId = "special:" + materialName;
    const category = (typeof getCombatDropCategory === "function") ? getCombatDropCategory(materialName) : "战斗掉落";
    const craftables = (typeof getMaterialCraftables === "function") ? getMaterialCraftables(materialName, gameState) : [];
    const knownCategory = category === "加密数据" || category === "装备生产许可" || category === "死亡空间校准核心" || category === "死亡空间协议";
    if (craftables.length > 0 || knownCategory) {
      const owned = (typeof ResourceRegistry !== "undefined" && typeof gameState !== "undefined")
        ? ResourceRegistry.get(gameState, resourceId) : 0;
      const description = (typeof getCombatDropCraftDescription === "function")
        ? getCombatDropCraftDescription(materialName, category, craftables) : "战斗掉落物：击坠敌人后有概率获得。";
      return {
        id: resourceId,
        name: name,
        icon: icon,
        categoryLabel: category,
        quantity: owned,
        fromCombat: true,
        description: description,
        source: { pageId: "combat", pageLabel: "战斗掉落", icon: "fa-solid fa-crosshairs" },
        craftables: craftables
      };
    }
  }
  return {
    name: name,
    icon: icon,
    categoryLabel: "战斗掉落",
    description: "战斗掉落物：击坠敌人后有概率获得。",
    source: { pageId: "combat", pageLabel: "战斗掉落", icon: "fa-solid fa-crosshairs" }
  };
}

function renderCombatDropPreview(display) {
  const wrap = document.getElementById("combat-drop-preview-wrap");
  const body = document.getElementById("combat-drop-preview");
  const zoneLabel = document.getElementById("combat-drop-preview-zone");
  if (!body || !wrap) return;
  // 折叠即跳过渲染：details 关闭时跳过 getCombatDropPreview 纯函数计算 + innerHTML 写入，
  // 解放每 tick/每周期触发的 DOM 重写开销。展开时由 toggle 事件触发单次补渲染。
  if (!wrap.open) { wrap._needsRender = true; return; }
  // 绑定 toggle：用户展开时若标记了待渲染则立即补一次（仅补一次，不循环）
  if (!wrap._collapseBound) {
    wrap._collapseBound = true;
    wrap.addEventListener("toggle", function () {
      if (wrap.open && wrap._needsRender) {
        wrap._needsRender = false;
        renderCombatDropPreview(display);
      }
    });
  }
  if (!body._cargoDropBound) {
    body._cargoDropBound = true;
    body.addEventListener("click", e => {
      const r = e.target.closest(".drop-row[data-drop-id]");
      if (!r) return;
      const item = combatDropToItem(r.dataset.dropId);
      if (item) openItemDetailModal(item);
    });
  }
  _combatDropMeta = {};
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
  const row = (icon, name, detail, extraClass, dropId) => {
    if (dropId) _combatDropMeta[dropId] = { name, icon };
    return `<div class="drop-row${extraClass ? " " + extraClass : ""}"${dropId ? ` data-drop-id="${dropId}"` : ""}><span class="drop-name">${icon} ${name}</span><span class="drop-detail">${detail}</span></div>`;
  };

  if (preview.mode === "deathspace") {
    rows.push(`<div class="drop-mode-tag deathspace">死亡空间 · 不掉落势力密钥 / 特殊掉落 / 通行密钥</div>`);
    if (Array.isArray(preview.leaderLoot) && preview.leaderLoot.length > 0) {
      rows.push(`<div class="drop-group-title">💠 首领战利品（每波 BOSS 击破时结算）</div>`);
      for (const loot of preview.leaderLoot) {
        rows.push(row("🟣", getResourceDisplayName(loot.coreMaterial), `第 ${loot.wave} 层「${loot.name}」核心 ${pct(loot.coreChance)}（稀有）`, "drop-leader", "special:" + loot.coreMaterial));
        if (loot.isFinal && loot.protocolMaterial) {
          rows.push(row("📜", getResourceDisplayName(loot.protocolMaterial), `最终层「${loot.name}」协议 ${pct(loot.protocolChance)}（极稀有）`, "drop-leader", "special:" + loot.protocolMaterial));
        }
      }
    }
    if (preview.tacticalMaterial) {
      const t = preview.tacticalMaterial;
      rows.push(`<div class="drop-group-title">🧪 战术材料（所有敌人）</div>`);
      rows.push(row("🧪", t.materialName + "（" + t.tier + "）", `普通 ${pct(t.normalChance)}×${t.normalQty} · 精英 100%×${t.eliteQtyMin}~${t.eliteQtyMax} · BOSS 100%×${t.bossQtyMin}~${t.bossQtyMax}`, "drop-tactical", "tactical"));
    }
    if (preview.probeDrop) {
      const pb = preview.probeDrop;
      rows.push(`<div class="drop-group-title">🔬 势力考古探针（小怪与 BOSS 均掉落）</div>`);
      rows.push(row("🔬", getResourceDisplayName(pb.resourceId), `BOSS ${pct(pb.bossChance)} · 小怪 ${pct(pb.normalChance)}（每次 ×${pb.qty}）`, "drop-probe", pb.resourceId));
    }
    if (preview.implantDrop) {
      const imp = preview.implantDrop;
      rows.push(`<div class="drop-group-title">🧠 脑插掉落（全通时结算 · 在线/离线同概率）</div>`);
      rows.push(row("🧠", imp.name, `全通 ${pct(imp.chance)}（固定概率）`, "drop-implant", imp.id));
    }
  } else {
    rows.push(`<div class="drop-mode-tag belt">海盗星带</div>`);
    if (preview.encryptedData) {
      const e = preview.encryptedData;
      rows.push(row("🔐", getResourceDisplayName("special:" + e.material), `精英 ${pct(e.eliteChance)} · BOSS ${pct(e.bossChance)}（每枚 ×${e.qty}）`, "drop-data", "special:" + e.material));
    } else {
      rows.push(row("🔐", "势力密钥", "本星带禁用掉落", "drop-none"));
    }
    if (Array.isArray(preview.zoneSpecialDrops) && preview.zoneSpecialDrops.length > 0) {
      rows.push(`<div class="drop-group-title">⭐ 特殊掉落（outer/deep 独有）</div>`);
      for (const sd of preview.zoneSpecialDrops) {
        rows.push(row("⭐", getResourceDisplayName(sd.resourceId), `精英 ${pct(sd.eliteChance)} · BOSS ${pct(sd.bossChance)}（每枚 ×${sd.qty}）`, "drop-special", sd.resourceId));
      }
    }
    if (preview.ticketDrop) {
      const t = preview.ticketDrop;
      rows.push(row("🎫", getResourceDisplayName("special:" + t.material), `击破本星带精英/BOSS 有概率掉落（精英 ${pct(t.eliteChance)} · BOSS ${pct(t.bossChance)}）· 来源 ${t.deathspaceName}`, "drop-ticket", "ticket"));
    }
    if (Array.isArray(preview.gearDrops) && preview.gearDrops.length > 0) {
      rows.push(`<div class="drop-group-title">🔧 装备专用数据（精英/BOSS 掉落）</div>`);
      for (const gd of preview.gearDrops) {
        rows.push(row("🔧", getResourceDisplayName("special:" + gd.material), `精英 ${pct(gd.eliteChance)} · BOSS ${pct(gd.bossChance)}（每枚 ×${gd.qty}）`, "drop-gear", "gear:" + gd.material));
      }
    }
    if (Array.isArray(preview.stationCoreDrops) && preview.stationCoreDrops.length > 0) {
      rows.push(`<div class="drop-group-title">🌟 空间站核心（唯一掉落）</div>`);
      for (const sc of preview.stationCoreDrops) {
        rows.push(row("🌟", getResourceDisplayName(sc.resourceId), `精英 ${pct(sc.eliteChance)} · BOSS ${pct(sc.bossChance)}（每枚 ×${sc.qty}）· 全游戏唯一`, "drop-core", sc.resourceId));
      }
    }
    if (preview.tacticalMaterial) {
      const t = preview.tacticalMaterial;
      rows.push(`<div class="drop-group-title">🧪 战术材料（所有敌人）</div>`);
      rows.push(row("🧪", t.materialName + "（" + t.tier + "）", `普通 ${pct(t.normalChance)}×${t.normalQty} · 精英 100%×${t.eliteQtyMin}~${t.eliteQtyMax} · BOSS 100%×${t.bossQtyMin}~${t.bossQtyMax}`, "drop-tactical", "tactical"));
    }
    // 货柜（低概率宝箱；死亡空间模式 cargoDrops===null，不渲染）
    if (preview.cargoDrops) {
      const c = preview.cargoDrops;
      const dc = c.dropChance;
      const sizeNames = { S:"小型", M:"中型", L:"大型", XL:"超大型" };
      // 汇总本区所有可能出现的货柜尺寸（去重保序），每个尺寸一行、各自可点开对应尺寸卡片
      const sizeSet = new Set();
      if (c.sizesByClass) for (const sizes of Object.values(c.sizesByClass)) for (const s of sizes) sizeSet.add(s);
      const sizeList = Array.from(sizeSet);
      rows.push(`<div class="drop-group-title">📦 货柜（击坠敌人低概率掉落）</div>`);
      for (const s of sizeList) {
        rows.push(row("📦", "货柜（" + (sizeNames[s] || s) + "）",
          `普通 ${pct(dc.normal)} · 精英 ${pct(dc.elite)} · BOSS ${pct(dc.boss)}`,
          "drop-cargo", "cargo:" + s));
      }
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
  // 在线 combatTick 每秒走这里；小队卡片也必须同步重绘，才能实时显示 NPC 受伤/爆船状态。
  renderCombatSquadSection(renderTime);
  return display;
}

function getCombatCrewSummary(display) {
  const items = [{
    key: "player",
    role: "玩家",
    name: display && display.player ? (display.player.name || "玩家舰") : "玩家舰",
    hp: display && display.player ? display.player.hp : null,
    maxHp: display && display.player ? display.player.maxHp : null,
    destroyed: false
  }];
  const api = legionSquadApi();
  if (api && typeof api.getLegionCombatSquadUiState === "function") {
    const ui = api.getLegionCombatSquadUiState(gameState, { now: Date.now() });
    const selected = new Set(Array.isArray(ui.selection) ? ui.selection : []);
    (ui.candidates || []).filter(function (candidate) {
      if (!candidate) return false;
      return ui.active ? candidate.inSquad : selected.has(candidate.npcId);
    }).forEach(function (candidate) {
      items.push({
        key: candidate.npcId,
        shipInstanceId: candidate.shipInstanceId,
        role: ui.active ? "NPC" : "预备",
        name: candidate.shipName || candidate.name || candidate.npcId,
        hp: candidate.hp,
        maxHp: candidate.maxHp,
        destroyed: Boolean(candidate.destroyedInBattle)
      });
    });
  }
  return {
    items: items,
    summary: items.map(function (item) { return item.name + (item.destroyed ? "（爆船）" : ""); }).join(" · ")
  };
}

function renderCombatCrewSummary(display) {
  const crew = getCombatCrewSummary(display);
  const cccShip = document.getElementById("ccc-ship-name");
  if (cccShip) { cccShip.textContent = crew.summary; cccShip.title = crew.summary; }
  const cccCrew = document.getElementById("ccc-crew-status");
  if (cccCrew) cccCrew.innerHTML = crew.items.map(function (item) {
    return '<button type="button" class="ccc-crew-item' + (item.destroyed ? ' destroyed' : '') + (item.key === combatConfigShipKey ? ' selected' : '') + '" data-crew-config="' + squadEscape(item.key) + '"><div class="ccc-crew-name"><b>' + squadEscape(item.role) + '</b> ' + squadEscape(item.name) + '</div><div class="ccc-crew-hp">' + squadHpBars(item.hp, item.maxHp) + '</div></button>';
  }).join("");
  if (cccCrew) cccCrew.querySelectorAll("[data-crew-config]").forEach(function (button) {
    button.addEventListener("click", function () {
      combatConfigShipKey = button.getAttribute("data-crew-config") || "player";
      renderCombatPanel(Date.now());
    });
  });
  return crew;
}

// 统一展示战斗补给预检提示（非阻断）。ammo/fuel 各为 null|"none"|"low"。
function showCombatSupplyWarnings(sw) {
  if (!sw) return;
  if (sw.ammo === "none") showToast("⚠ 未装备弹药，将无法开火");
  else if (sw.ammo === "wrong") showToast("⚠ 弹药类型错误，已装填弹药与当前武器不匹配，将无法开火");
  else if (sw.ammo === "low") showToast("⚠ 已装填弹药仅够约 " + sw.ammoVolleys + " 次齐射（≤100）");
  if (sw.fuel === "none") showToast("⚠ 燃料库存为 0，武器无法开火");
  else if (sw.fuel === "low") showToast("⚠ 燃料仅够约 " + sw.fuelRounds + " 轮满负荷行动（≤100）");
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
    showCombatSupplyWarnings(result.supplyWarning);
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
  showCombatSupplyWarnings(result.supplyWarning);
  renderCombatPanel(now); updateUI(); return true;
}

function startDeathspaceChainEncounter() {
  const now = Date.now();
  const c = gameState.combat;
  const armed = (c.deathspaceChainRemaining > 0) || c.deathspaceChainPending;
  if (armed) {
    const result = dispatchGameAction(gameState, { type:"combat/cancelDeathspaceChain" }, now);
    if (result && result.changed) showToast("已取消连刷");
    renderCombatPanel(now); updateUI(); return;
  }
  const input = document.getElementById("deathspace-chain-count");
  const n = input ? Math.max(1, Math.min(99, Math.floor(Number(input.value) || 1))) : 1;
  const result = dispatchGameAction(gameState, { type:"combat/startDeathspaceChain", count:n }, now);
  if (!result.changed) {
    if (result.reason === "repairing") showToast("舰船自动维修中，还需 " + result.remaining + " 秒");
    else if (result.reason === "level-locked") showToast("该死亡空间需要战斗等级 " + result.requiredCL);
    else if (result.reason === "no-weapons") showToast("当前战斗舰没有安装武器，请先在船坞装配");
    else if (result.reason === "missing-ticket") showToast("缺少：" + getResourceDisplayName(result.ticketMaterial));
    else if (result.reason === "already-active") showToast("战斗进行中，请先停止");
    else showToast("无法开始连刷");
    renderCombatPanel(now); return;
  }
  showToast("连刷 " + n + " 次：已消耗1枚通行密钥进入" + result.site.name);
  showCombatSupplyWarnings(result.supplyWarning);
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

// source: "player" | "enemy" | "squad"（NPC 小队攻击，命中敌人区，颜色区分）
// alt: 仅 source==="squad" 时生效，切换暗红 / 橙红两色，便于区分不同 NPC
function playAttackFX(isPlayer, weapon, dmg, damageIndex, source, alt, targetRef) {
  source = source || (isPlayer ? "player" : "enemy");
  const fxLayer = document.getElementById("combat-fx-layer");
  if (!fxLayer) return;

  // --- 闪边 ---
  if (source === "player" || source === "squad") {
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

  // --- 光束（仅玩家武器，NPC 小队不画光束）---
  if (source === "player" && weapon) {
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
    if (source === "squad") {
      el.classList.add("squad");
      if (alt) el.classList.add("squad-alt");
    }
    el.textContent = "−" + Math.round(dmg);
    if (source === "player" || source === "squad") {
      const enemySec = document.getElementById("combat-enemy-section");
      let targetEl = null;
      if (targetRef != null) {
        const targetId = typeof targetRef === "object" ? targetRef.id : targetRef;
        const enemies = gameState && gameState.combat && Array.isArray(gameState.combat.enemies) ? gameState.combat.enemies : [];
        const targetIndex = enemies.findIndex(enemy => enemy && String(enemy.id) === String(targetId));
        const cards = document.querySelectorAll(".combat-enemy-card");
        if (targetIndex >= 0 && cards[targetIndex]) targetEl = cards[targetIndex];
      }
      if (targetEl || enemySec) {
        const rect = (targetEl || enemySec).getBoundingClientRect();
        const fxr = fxLayer.getBoundingClientRect();
        // NPC 小队数字略低于玩家数字并向下排布，避免重叠
        const idx = Number(damageIndex) || 0;
        if (targetEl) {
          el.style.left = (rect.left + rect.width * 0.5 - fxr.left + (idx % 3 - 1) * 12) + "px";
          el.style.top  = (rect.top - fxr.top - 4 + (idx % 2) * 12) + "px";
        } else {
          const baseTop = (source === "squad") ? 0.46 : 0.30;
          el.style.left = (rect.left + rect.width * 0.6 - fxr.left + idx * 6) + "px";
          el.style.top  = (rect.top + rect.height * baseTop - fxr.top + idx * 20) + "px";
        }
      } else {
        el.style.left = "60%"; el.style.top = "30%";
      }
    } else {
      let targetEl = null;
      if (targetRef && typeof targetRef === "object" && targetRef.kind === "npc" && targetRef.npcId != null) {
        const slots = document.querySelectorAll(".lcs-slot[data-npc-id]");
        for (const slot of slots) {
          if (String(slot.getAttribute("data-npc-id")) === String(targetRef.npcId)) { targetEl = slot; break; }
        }
      }
      const playerSec = document.querySelector(".combat-player-side");
      if (targetEl || playerSec) {
        const rect = (targetEl || playerSec).getBoundingClientRect();
        const fxr = fxLayer.getBoundingClientRect();
        if (targetEl) {
          el.classList.add("npc-hit");
          el.style.left = (rect.left + rect.width * 0.5 - fxr.left) + "px";
          el.style.top  = (rect.top - fxr.top - 4) + "px";
        } else {
          el.style.left = (rect.left + rect.width * 0.6 - fxr.left) + "px";
          el.style.top  = (rect.top  + rect.height * 0.3 - fxr.top) + "px";
        }
      } else {
        el.style.left = "20%"; el.style.top = "30%";
      }
    }
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }
}

function playEnemyAttackFX(enemyIndex, attackOrder, dmg, targetRef) {
  setTimeout(() => {
    const cards = document.querySelectorAll(".combat-enemy-card");
    const card = cards && cards[enemyIndex];
    if (card) {
      card.classList.remove("attacking");
      void card.offsetWidth;
      card.classList.add("attacking");
      setTimeout(() => card.classList.remove("attacking"), 260);
    }
    playAttackFX(false, null, dmg, attackOrder, "enemy", false, targetRef);
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
    // 无拥有战斗舰时不应放大幽灵模型：提示去机库指派后返回。
    if (!player.hasShip) { showToast("请先在机库指派战斗舰"); return; }
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


  const start = document.getElementById("btn-start-combat"); if (start) start.addEventListener("click", () => {
    const mode = (gameState.combat && gameState.combat.viewMode === "deathspace") ? "deathspace" : "belt";
    if (typeof showActionConfirm === "function") showActionConfirm(mode === "deathspace" ? "combatDeathspace" : "combatBelt");
  });
  const stop = document.getElementById("btn-stop-combat"); if (stop) stop.addEventListener("click", stopCombatEncounter);
  const chainBtn = document.getElementById("btn-start-combat-chain"); if (chainBtn) chainBtn.addEventListener("click", () => {
    if (typeof showActionConfirm === "function") showActionConfirm("combatDeathspace");
  });
  const logBtn = document.getElementById("btn-combat-log"); if (logBtn) logBtn.addEventListener("click", () => {
    if (typeof openCombatLogModal === "function") openCombatLogModal();
  });
  // 军团 NPC 战斗小队（M5）：小队区域选择事件（渲染由 renderCombatPanel 驱动）
  bindCombatSquadUI();
})();
