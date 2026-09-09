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
  function getTitanModule(kind, id) {
    const key = TITAN_DATA_ID_MAP[kind] && TITAN_DATA_ID_MAP[kind][id];
    if (!key || typeof window === "undefined") return null;
    const table = kind === "hull" ? window.TITAN_HULLS : kind === "weapon" ? window.TITAN_WEAPONS : window.TITAN_CORES;
    return (table && table[key]) || null;
  }
  function titanStatHtml(kind, m) {
    if (kind === "hull") {
      const t = m.capitalTrait || {};
      return `<div class="tfs-line">盾 ${fmtNum(m.hp.shield)} / 甲 ${fmtNum(m.hp.armor)} / 结 ${fmtNum(m.hp.structure)} · 总耐久 ${fmtNum(m.totalHp)}</div>`
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
      return `<div class="tfs-line">基伤 ${fmtNum(m.baseDamage)} · 命中 +${m.baseHit}</div>`
        + `<div class="tfs-line">燃料 ${m.fuelCost}/轮 · 弹药 ${m.ammoCost}/轮</div>`
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
    applyTitanViewVisibility();
  }
  function ensureView() {
    const panel = document.getElementById("shipeng-panel"); if (!panel || document.getElementById("shipeng-titan-view")) return;
    const el = document.createElement("div"); el.id = "shipeng-titan-view"; el.className = "titan-forge-fresh";
    el.style.display = isTitanSubView() ? "" : "none"; // 懒创建竞态兜底：按 state 设初值，不等下一次渲染 pass
    el.innerHTML = `<div class="titan-forge-fresh-grid"><div class="titan-forge-fresh-controls"><div class="titan-forge-kicker">TITAN ASSEMBLY</div><h2>泰坦组装</h2><p>从部件车间取得舰体、武器和核心，组合成一架泰坦。</p>${["hull","weapon","core"].map((k,i)=>`<label class="titan-fresh-slot"><span>${String(i+1).padStart(2,"0")} · ${k === "hull" ? "防御舰体" : k === "weapon" ? "攻击模块" : "核心模块"}</span><select class="u-select" data-titan-fresh="${k}">${optionHtml(k)}</select><small data-titan-note="${k}">${find(k, selection[k]).note}</small></label>`).join("")}<button class="btn primary" type="button" data-titan-fresh-build>⚓ 模拟总装泰坦</button><div class="titan-fresh-status" data-titan-fresh-status>已选 3 / 3 个组件 · 可进行原型总装</div></div><div class="titan-forge-fresh-preview"><div class="titan-preview"><span class="titan-preview-label">LIVE TITAN ASSEMBLY</span></div><div class="titan-fresh-summary" data-titan-summary></div></div></div>`;
    panel.appendChild(el);
    el.addEventListener("change", e => { const s=e.target.closest("[data-titan-fresh]"); if(!s)return; selection[s.dataset.titanFresh]=s.value; const n=el.querySelector(`[data-titan-note="${s.dataset.titanFresh}"]`); if(n)n.textContent=find(s.dataset.titanFresh,s.value).note; updateSummary(el); });
    el.querySelector("[data-titan-fresh-build]").addEventListener("click", () => { el.querySelector("[data-titan-fresh-status]").textContent="原型装配完成：已生成一架泰坦"; });
    updateSummary(el);
  }
  function updateSummary(el) { el.querySelector("[data-titan-summary]").innerHTML = ["hull","weapon","core"].map(summaryCardHtml).join(""); }
  new MutationObserver(render).observe(document.body, { childList:true, subtree:true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
