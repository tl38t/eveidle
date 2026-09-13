/* Titan assembly tab for the FRESH workspace. Keeps the existing manufacturing
   renderer untouched and mounts the saved TitanFactory model into its own view.

   2026-09-09 弹回总装根因修复：tab 收编进 manufacturing-render.js 状态机
   （renderShipEngSubViewTabs 渲染 data-subview="titan"，点击经既有监听分发
   manufacturing/selectShipEngSubView 写 state）。本文件只负责：
   ① #shipeng-titan-view 视图懒创建（渲染 pass 可能早于本脚本/元素存在）；
   ② 视图显隐兜底（与渲染器同口径读 state.currentAction.shipEngSubView，幂等）。
   禁止在此重新自建 tab 或私管显隐——双状态源打架正是弹回总装的根源。 */
(function () {
  const OPTIONS = {
    hull: [{ id:"shield", name:"天穹壁垒", note:"高护盾 · 偏导防护" }, { id:"structure", name:"裂骨方舟", note:"高结构 · 过载火力" }, { id:"armor", name:"铁幕堡垒", note:"高装甲 · 阵地承伤" }],
    weapon: [{ id:"laser", name:"曙光长矛", note:"持续聚焦光束" }, { id:"missile", name:"天火齐射", note:"多轮导弹压制" }, { id:"cannon", name:"震荡王座", note:"重型动能齐射" }],
    core: [{ id:"blue", name:"统御矩阵", note:"全小队伤害光环", color:"#38c8ff" }, { id:"red", name:"天罚裁决", note:"周期点名 · 眩晕", color:"#ff553b" }, { id:"violet", name:"裂界侵蚀", note:"范围削弱防御", color:"#c16cff" }]
  };
  const selection = { hull:"shield", weapon:"laser", core:"blue" };
  const find = (kind, id) => OPTIONS[kind].find(x => x.id === id) || OPTIONS[kind][0];
  function optionHtml(kind) { return OPTIONS[kind].map(x => `<option value="${x.id}">${x.name} · ${x.note}</option>`).join(""); }
  // ---- 汇总卡具体属性（2026-09-09 用户需求）：从 js/data/titans.js 真值直读，不在 UI 侧维护数值 ----
  // 选择器 id → 数据表 key 映射（OPTIONS 的 id 是展示语义名，数据表 key 是谱系 id）
  const TITAN_DATA_ID_MAP = {
    hull: { shield:"titan_hull_aegis", armor:"titan_hull_bulwark", structure:"titan_hull_keelbreaker" },
    weapon: { laser:"titan_weapon_dawn_spear", missile:"titan_weapon_skyfire_salvo", cannon:"titan_weapon_throne_quake" },
    core: { blue:"titan_core_command_matrix", red:"titan_core_doom_judgment", violet:"titan_core_rift_erosion" }
  };
  const fmtNum = n => Number(n || 0).toLocaleString("en-US");
  const pct = x => Math.round((x || 0) * 100);
  // 全局函数安全取用（数据表/选择器脚本加载晚于本文件时为 undefined）
  const gfn = name => (typeof window !== "undefined" && typeof window[name] === "function") ? window[name]
    : (typeof globalThis !== "undefined" && typeof globalThis[name] === "function") ? globalThis[name] : null;
  function getTitanModule(kind, id) {
    const key = TITAN_DATA_ID_MAP[kind] && TITAN_DATA_ID_MAP[kind][id];
    if (!key || typeof window === "undefined") return null;
    const table = kind === "hull" ? window.TITAN_HULLS : kind === "weapon" ? window.TITAN_WEAPONS : window.TITAN_CORES;
    return (table && table[key]) || null;
  }
  // ---- 总装真接线（2026-09-10）：本页三个下拉 → state.currentAction.titanAsmCombo → startTitanAssembly ----
  // 选择器展示 id → 数据表谱系 id（与 buildTitanConfig / getTitanAssemblyRecipe 同口径）
  // 反向映射：数据表谱系 id → 选择器展示 id（用于从存档恢复下拉选择）
  const TITAN_OPTION_BY_DATA = { hull:{}, weapon:{}, core:{} };
  for (const kind of ["hull","weapon","core"]) {
    for (const optId of Object.keys(TITAN_DATA_ID_MAP[kind])) TITAN_OPTION_BY_DATA[kind][TITAN_DATA_ID_MAP[kind][optId]] = optId;
  }
  // 启动后首次从存档恢复组合（2026-09-10 修复：原 syncSelectionFromState 是零调用死代码，
  // 导致刷新/重进组装页后三个下拉永远回落成默认值，与存档里的 titanAsmCombo 不一致）。
  // 只做一次性回填：此后 selection 仍是前端唯一真值（change 先改 selection 再写 state），
  // 不做"每次渲染都从 state 反向覆盖"——那正是历史上弹回总装的双状态源打架问题。
  let selectionHydrated = false;
  function hydrateSelectionFromState(el) {
    if (selectionHydrated) return;
    const c = (typeof gameState !== "undefined" && gameState.currentAction && gameState.currentAction.titanAsmCombo) || null;
    if (!c) return; // 存档尚无组合或 gameState 未就绪：保持默认，等下一次渲染 pass
    if (!el) return; // 视图尚未创建：不消费这次机会
    selectionHydrated = true;
    let changed = false;
    for (const kind of ["hull","weapon","core"]) {
      const optId = TITAN_OPTION_BY_DATA[kind][c[kind]];
      if (optId && optId !== selection[kind]) { selection[kind] = optId; changed = true; } // 存档组合优先于默认选择
    }
    for (const kind of ["hull","weapon","core"]) {
      // select.value 不随 selection 自动同步，须显式回写（option 无 selected 属性，默认停在第 1 项）
      const sel = el.querySelector(`[data-titan-fresh="${kind}"]`);
      if (sel && sel.value !== selection[kind]) sel.value = selection[kind];
      const note = el.querySelector(`[data-titan-note="${kind}"]`);
      if (note) setText(note, find(kind, selection[kind]).note);
    }
    if (changed) { updateSummary(el); refreshAssemblyUi(el); }
  }
  function comboOf() {
    return {
      hull: TITAN_DATA_ID_MAP.hull[selection.hull],
      weapon: TITAN_DATA_ID_MAP.weapon[selection.weapon],
      core: TITAN_DATA_ID_MAP.core[selection.core]
    };
  }
  function componentDisplayName(componentId) {
    const list = (typeof window !== "undefined" && Array.isArray(window.TITAN_COMPONENT_RECIPES)) ? window.TITAN_COMPONENT_RECIPES : [];
    const hit = list.find(r => r.id === componentId);
    return hit ? hit.name : componentId;
  }
  // 门禁判定：与 actions.startTitanAssembly 阻塞优先级逐条一致（组合→组件解锁→船坞→等级→星币→材料）
  function evaluateTitanGate() {
    const recipe = gfn("getTitanAssemblyRecipe") ? gfn("getTitanAssemblyRecipe")(comboOf()) : null;
    if (!recipe) return { ok:false, label:"组合无效", detail:"", recipe:null };
    const unlock = gfn("isTitanComponentUnlocked");
    if (unlock) {
      for (const cid of Object.keys(recipe.componentCost)) {
        const gate = unlock(gameState, cid);
        if (gate && gate.ok === false) return { ok:false, reason:gate.reason || "", label:(gate.text || "未解锁"), detail:componentDisplayName(cid) + " 尚未解锁", recipe };
      }
    }
    const yard = gfn("getShipyardLevel");
    if (yard && yard(gameState) < recipe.shipyardLevel) {
      return { ok:false, label:"船坞 Lv." + recipe.shipyardLevel + " 解锁", detail:"当前船坞 Lv." + yard(gameState), recipe };
    }
    const lvl = gfn("getEffectiveSkillLevel");
    if (lvl && lvl(gameState, "shipEngineering") < recipe.level) {
      return { ok:false, label:"舰船工程 Lv." + recipe.level + " 解锁", detail:"当前 Lv." + lvl(gameState, "shipEngineering"), recipe };
    }
    // ISK 权威存储只有 state.resources.isk（顶层 gameState.isk 不存在，读之恒 0 → UI 恒显星币不足）——2026-09-10 修复
    const isk = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, "currency:isk") : 0;
    if (isk < recipe.isk) return { ok:false, label:"星币不足", detail:"需 " + fmtNum(recipe.isk) + " · 现有 " + fmtNum(isk), recipe };
    const short = [];
    for (const [cid, qty] of Object.entries(recipe.componentCost)) {
      const stock = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, "component:" + cid) : 0;
      if (stock < qty) short.push(componentDisplayName(cid) + "×" + qty);
    }
    for (const [name, qty] of Object.entries(recipe.materialCost)) {
      const stock = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.getMaterialStock(gameState, name) : 0;
      if (stock < qty) short.push(name + "×" + qty);
    }
    if (short.length) return { ok:false, label:"组件不足", detail:"缺少 " + short.join("、"), recipe };
    return { ok:true, label:"", detail:"", recipe };
  }
  // 成本行：部件 + 额外材料 + 星币 + 耗时 + 经验（够/缺着色）
  function titanCostHtml(recipe) {
    if (!recipe) return "";
    const span = (enough, text) => `<span class="${enough ? "enough" : "short"}">${text}</span>`;
    const parts = Object.entries(recipe.componentCost).map(([cid, qty]) => {
      const stock = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, "component:" + cid) : 0;
      return span(stock >= qty, componentDisplayName(cid) + "×" + qty);
    }).join(" + ");
    const mats = Object.entries(recipe.materialCost).map(([name, qty]) => {
      const stock = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.getMaterialStock(gameState, name) : 0;
      return span(stock >= qty, name + "×" + qty);
    }).join(" + ");
    const isk = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry.get(gameState, "currency:isk") : 0;
    return `部件：${parts}${mats ? ` · 额外材料：${mats}` : ""} · ${span(isk >= recipe.isk, "星币 " + fmtNum(recipe.isk))} · 耗时 ${fmtNum(recipe.time)}s · 经验 ${fmtNum(recipe.xp)}`;
  }
  // 幂等写：与「本组件上次写入的值」比较，而不是与实时 DOM 比较。
  // 2026-09-11 卡死修复：英文态下 i18n 翻译器会把已写入的中文就地替换成英文，于是
  // el.innerHTML / el.textContent 永远不等于我们期望的中文串 → 每次 render 都真实写 DOM →
  // 触发本文件 :290 的 MutationObserver(childList, subtree: body) → 再次 render → 无限自触发，
  // 主线程被占满（命中场景：存档停在泰坦组装子页 + 语言为英文，开屏即"页面无响应"）。
  // 缓存自身写入值即可彻底断开回环；这三个写点（cost/goto/status/note/summary）均由本文件独占，无外部写入者。
  const LW = "__titanForgeLastWrite";
  function setText(el, s) { if (!el) return; if (el[LW + "text"] === s) return; el[LW + "text"] = s; el.textContent = s; }
  function setHtml(el, h) { if (!el) return; if (el[LW + "html"] === h) return; el[LW + "html"] = h; el.innerHTML = h; }
  function setDisabled(el, d) { if (el && el.disabled !== d) el.disabled = d; }
  // 状态区 + 按钮：运行中显示进度并可停止；未解锁/缺料按门禁文案禁用
  // startTitanAssembly 失败原因 → 中文提示（与 actions 门禁 reason 一一对应）
  const FAIL_TEXT = {
    "invalid-combo":"组合无效",
    "titan-synthesis-locked":"需制压先驱文明核心",
    "titan-node-locked":"需制压对应星图分线节点",
    "shipyard-level-locked":"船坞等级不足",
    "level-locked":"舰船工程等级不足",
    "insufficient-isk":"星币不足",
    "insufficient-components":"组件或材料不足"
  };
  // 门禁 → 跳转页（2026-09-10）：只给「玩家该去哪做」的门禁配按钮，缺料缺钱不给（刷材料不是跳转能解决的）
  const GATE_GOTO = { "titan-synthesis-locked":"starmap", "titan-node-locked":"starmap" };
  const GOTO_LABEL = { starmap:"前往星图" };
  function gotoHtml(gate) {
    const page = gate && GATE_GOTO[gate.reason];
    if (!page) return "";
    return '<button type="button" class="btn titan-goto" data-titan-goto="' + page + '">' + (GOTO_LABEL[page] || "前往") + '</button>';
  }
  const btnMode = el => (el.querySelector("[data-titan-fresh-build]") || {}).dataset
    ? (el.querySelector("[data-titan-fresh-build]").dataset.titanMode || "start") : "start";
  function refreshAssemblyUi(el) {
    const statusEl = el.querySelector("[data-titan-fresh-status]");
    const costEl = el.querySelector("[data-titan-asm-cost]");
    const btn = el.querySelector("[data-titan-fresh-build]");
    const gotoEl = el.querySelector("[data-titan-asm-goto]");
    if (!statusEl || !btn) return;
    const a = (typeof gameState !== "undefined" && gameState.currentAction) || {};
    // 判据必须同时锚 skill（2026-09-13 玩家反馈「装完后会一直显示装」修复）：
    // 旧判据只查 shipSubAction，而该字段切到其他技能时曾无人清理 ⇒ 装备工程/采矿运行中
    // 泰坦组装页也显示「总装进行中 x%」，且按钮变成「停止总装」会把玩家真正在做的事停掉。
    const running = Boolean(a.active && a.skill === "shipEngineering" && a.shipSubAction === "titanAssembly");
    const gate = evaluateTitanGate();
    setHtml(costEl, titanCostHtml(gate.recipe));
    if (running) {
      const dur = gfn("getShipEngineeringCycleDuration") ? gfn("getShipEngineeringCycleDuration")(gameState, gate.recipe) : (gate.recipe ? gate.recipe.time : 1);
      const prog = Math.max(0, Math.min(1, (Number(a.progress) || 0) / (dur || 1)));
      setText(btn, "⏹ 停止总装（" + Math.floor(prog * 100) + "%）");
      setDisabled(btn, false);
      btn.dataset.titanMode = "stop";
      setText(statusEl, "总装进行中：" + (gate.recipe ? gate.recipe.name : "泰坦") + " · " + Math.floor(prog * 100) + "%");
      setHtml(gotoEl, "");
      return;
    }
    btn.dataset.titanMode = "start";
    if (gate.ok) {
      setText(btn, "⚓ 总装泰坦");
      setDisabled(btn, false);
      setText(statusEl, "已选 3 / 3 个组件 · 材料齐备，可开始总装");
      setHtml(gotoEl, "");
    } else {
      setText(btn, "🔒 " + gate.label);
      setDisabled(btn, true);
      setText(statusEl, gate.detail ? (gate.label + "：" + gate.detail) : gate.label);
      setHtml(gotoEl, gotoHtml(gate)); // 幂等写：内容不变不触碰 DOM
    }
  }
  // 武器类型显示名（激光/导弹/火炮）与弹药类型显示名。
  // 弹药名优先读数据表 AMMO_TYPE_NAMES（ammo.js 顶层 const，跨脚本裸名可用）；未就绪时用同值兜底，不在 UI 侧另立真值。
  const WEAPON_TYPE_NAMES = { laser: "激光", missile: "导弹", cannon: "火炮" };
  const AMMO_NAME_FALLBACK = { laser: "激光晶体弹药", missile: "导弹", cannon: "炮台弹药" };
  function ammoNameOf(weaponType) {
    const table = (typeof AMMO_TYPE_NAMES !== "undefined" && AMMO_TYPE_NAMES) ? AMMO_TYPE_NAMES : AMMO_NAME_FALLBACK;
    return table[weaponType] || "弹药";
  }
  // 舰体防御加成（用户 2026-09-13 反馈「要写明白」）：数据表 bonuses 带容量的防御类字段此前完全未渲染，
  // 只有命中被显示。命中仍在下一行，本行只列容量/维修类，避免与命中重复。
  const HULL_DEF_BONUS_LABELS = [
    ["shieldCapacity", "护盾容量"], ["armorCapacity", "装甲容量"], ["structureCapacity", "结构容量"],
    ["armorRepair", "装甲维修"], ["structureRepair", "结构维修"], ["structureEmergencyRepair", "结构紧急维修"]
  ];
  function hullDefenseBonusHtml(m) {
    const b = (m && m.bonuses) || {};
    const parts = HULL_DEF_BONUS_LABELS.filter(([k]) => Number(b[k]) > 0).map(([k, label]) => `${label} +${pct(b[k])}%`);
    return parts.length ? `<div class="tfs-line">防御加成：${parts.join(" · ")}</div>` : "";
  }
  function titanStatHtml(kind, m) {
    if (kind === "hull") {
      const t = m.capitalTrait || {};
      return `<div class="tfs-line">盾 ${fmtNum(m.hp.shield)} / 甲 ${fmtNum(m.hp.armor)} / 结 ${fmtNum(m.hp.structure)} · 总耐久 ${fmtNum(m.totalHp)}</div>`
        + hullDefenseBonusHtml(m)
        + `<div class="tfs-line">命中 +${m.bonuses.hitBonus} · 闪避 ${m.dodge} · 速度 ${m.speed} · 电容 ${fmtNum(m.capacitor && m.capacitor.capacity)}</div>`
        + (t.name ? `<div class="tfs-dim">特性「${t.name}」：${t.description}</div>` : "");
    }
    if (kind === "weapon") {
      const mech = [];
      const sw = m.perShotSweep;
      if (sw) {
        let s = `${sw.name}：${sw.mode === "all" ? "所有敌人" : "邻近 " + (sw.count || 1) + " 个目标"}受 ${pct(sw.damagePct)}%`;
        if (sw.boostedPct) s += `（主目标血量 >${pct(sw.boostTargetHpAbovePct)}% 时 ${pct(sw.boostedPct)}%）`;
        mech.push(s);
      }
      const e = m.extraAttack;
      if (e && e.kind === "layerPierce") mech.push(`${e.name}：目标下一层防御受 ${pct(e.damagePct)}%`);
      if (e && e.trigger === "chancePerRound") mech.push(`${e.name}：每轮 ${pct(e.chance)}% 几率再次齐射`);
      if (m.crit) mech.push(`${m.crit.name}：每发 ${pct(m.crit.chance)}% 几率 ×${m.crit.multiplier} 暴击${m.crit.appliesToSweep ? "（溅射同享）" : ""}`);
      const wtName = WEAPON_TYPE_NAMES[m.weaponType] || m.weaponType || "—";
      return `<div class="tfs-line">基伤 ${fmtNum(m.baseDamage)} · 命中 +${m.baseHit} · 武器类型 ${wtName}</div>`
        + `<div class="tfs-line">燃料 ${m.fuelCost}/轮 · 弹药 ${ammoNameOf(m.weaponType)} ${m.ammoCost}/轮</div>`
        + (mech.length ? `<div class="tfs-dim">${mech.join("；")}</div>` : "");
    }
    // core：description 即一句话规格（数据表维护），补一行供能消耗
    const c = m.consumption || {};
    let cost = "";
    if (c.mode === "sustain") cost = `供能：每轮消耗主武器齐射燃料的 ${pct(c.fuelPctOfVolley)}%`;
    else if (c.mode === "perTrigger") cost = `供能：每 ${m.everyRounds} 轮触发时消耗 ${pct(c.fuelPctOfVolley)}% 齐射燃料${c.ammoPerTrigger ? ` + ${c.ammoPerTrigger} 发主武器弹药` : ""}`;
    return `<div class="tfs-line">${m.description}</div>` + (cost ? `<div class="tfs-dim">${cost}</div>` : "");
  }
  function summaryCardHtml(kind) {
    const label = kind === "hull" ? "舰体" : kind === "weapon" ? "武器" : "核心";
    const m = getTitanModule(kind, selection[kind]);
    const body = m ? titanStatHtml(kind, m) : ""; // 数据表未加载时回退为纯名字
    return `<div><b>${label}</b><span class="tfs-name">${find(kind, selection[kind]).name}</span>${body}</div>`;
  }
  // 与渲染器同口径的显隐判定（state 真值；gameState 未就绪时按非 titan 处理）
  function isTitanSubView() {
    try { return gameState && gameState.currentAction && gameState.currentAction.shipEngSubView === "titan"; }
    catch (_) { return false; }
  }
  function applyTitanViewVisibility() {
    const titan = document.getElementById("shipeng-titan-view"); if (!titan) return;
    const want = isTitanSubView() ? "" : "none";
    if (titan.style.display !== want) titan.style.display = want; // 幂等写，避免无谓 mutation 回环
  }
  function render() {
    const host = document.getElementById("shipeng-panel"); if (!host) return;
    const tabs = document.getElementById("shipeng-subview-tabs"); if (!tabs) return;
    const boosters = document.getElementById("ship-action-booster-slots");
    // 2026-09-08 卡死修复：#ship-action-booster-slots 与 #shipeng-subview-tabs 同在 .panel-body 内，
    // tabs.after(boosters) 后 parentElement 不变，原条件恒真 → 每次都真实移动节点 →
    // 自身 MutationObserver(:46) 无限自触发 → 主线程微任务死循环（开屏即"页面无响应"）。
    // 修复：已紧跟在 tabs 之后则不再移动（幂等）。
    if (boosters && boosters.parentElement === document.querySelector("#shipeng-panel .panel-body") && boosters.previousElementSibling !== tabs) tabs.after(boosters);
    ensureView();
    const view = document.getElementById("shipeng-titan-view");
    hydrateSelectionFromState(view); // 一次性回填存档组合（幂等；gameState 晚就绪时由后续渲染 pass 补上）
    applyTitanViewVisibility();
    // 运行中进度/门禁随时间与库存变化：随渲染 pass 幂等刷新（内容不变则不写 DOM）
    if (view && isTitanSubView()) refreshAssemblyUi(view);
  }
  function ensureView() {
    const panel = document.getElementById("shipeng-panel"); if (!panel || document.getElementById("shipeng-titan-view")) return;
    const el = document.createElement("div"); el.id = "shipeng-titan-view"; el.className = "titan-forge-fresh";
    el.style.display = isTitanSubView() ? "" : "none"; // 懒创建竞态兜底：按 state 设初值，不等下一次渲染 pass
    el.innerHTML = `<div class="titan-forge-fresh-grid"><div class="titan-forge-fresh-controls"><div class="titan-forge-kicker">TITAN ASSEMBLY</div><h2>泰坦组装</h2><p>从部件车间取得舰体、武器和核心，组合成一架泰坦。</p>${["hull","weapon","core"].map((k,i)=>`<label class="titan-fresh-slot"><span>${String(i+1).padStart(2,"0")} · ${k === "hull" ? "防御舰体" : k === "weapon" ? "攻击模块" : "核心模块"}</span><select class="u-select" data-titan-fresh="${k}">${optionHtml(k)}</select><small data-titan-note="${k}">${find(k, selection[k]).note}</small></label>`).join("")}<button class="btn primary" type="button" data-titan-fresh-build>⚓ 总装泰坦</button><div class="titan-fresh-status" data-titan-fresh-status>已选 3 / 3 个组件</div><div class="titan-asm-cost" data-titan-asm-cost></div><div class="titan-asm-goto" data-titan-asm-goto></div></div><div class="titan-forge-fresh-preview"><div class="titan-preview"><span class="titan-preview-label">LIVE TITAN ASSEMBLY</span></div><div class="titan-fresh-summary" data-titan-summary></div></div></div>`;
    panel.appendChild(el);
    el.addEventListener("change", e => {
      const s = e.target.closest("[data-titan-fresh]"); if (!s) return;
      selection[s.dataset.titanFresh] = s.value;
      const n = el.querySelector(`[data-titan-note="${s.dataset.titanFresh}"]`); if (n) setText(n, find(s.dataset.titanFresh, s.value).note);
      updateSummary(el);
      // 回写 state（真值单一来源），再刷新门禁/成本（改选后立即反映该组合的材料缺口）
      if (typeof dispatchGameAction === "function") dispatchGameAction(gameState, { type:"manufacturing/selectTitanCombo", combo:comboOf() }, Date.now());
      refreshAssemblyUi(el);
    });
    el.querySelector("[data-titan-fresh-build]").addEventListener("click", () => {
      if (btnMode(el) === "stop") { dispatchGameAction(gameState, { type:"manufacturing/stop" }, Date.now()); refreshAssemblyUi(el); return; }
      const res = dispatchGameAction(gameState, { type:"manufacturing/startTitanAssembly", combo:comboOf() }, Date.now());
      if (res && res.changed) { refreshAssemblyUi(el); return; }
      const statusEl = el.querySelector("[data-titan-fresh-status]");
      const label = FAIL_TEXT[res && res.reason] || ((res && (res.text || res.reason)) || "无法开始总装");
      setText(statusEl, "无法开始：" + label);
    });
    el.addEventListener("click", e => {
      const g = e.target.closest("[data-titan-goto]");
      if (g) {
        const page = g.getAttribute("data-titan-goto");
        const go = (typeof switchPage === "function") ? switchPage : (typeof window !== "undefined" && typeof window.switchPage === "function") ? window.switchPage : null;
        if (go) go(page);
        return;
      }
    });
    updateSummary(el);
    refreshAssemblyUi(el);
  }
  // 幂等写：内容不变不重建节点（本文件由 MutationObserver 驱动 render，裸 innerHTML 赋值会回环）
  function updateSummary(el) {
    const host = el.querySelector("[data-titan-summary]"); if (!host) return;
    setHtml(host, ["hull","weapon","core"].map(summaryCardHtml).join(""));
  }
  new MutationObserver(render).observe(document.body, { childList:true, subtree:true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
