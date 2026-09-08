/* Titan assembly tab for the FRESH workspace. Keeps the existing manufacturing
   renderer untouched and mounts the saved TitanFactory model into its own view. */
(function () {
  const OPTIONS = {
    hull: [{ id:"shield", name:"天穹壁垒", note:"高护盾 · 偏导防护" }, { id:"structure", name:"裂骨方舟", note:"高结构 · 过载火力" }, { id:"armor", name:"铁幕堡垒", note:"高装甲 · 阵地承伤" }],
    weapon: [{ id:"laser", name:"曙光长矛", note:"持续聚焦光束" }, { id:"missile", name:"天火齐射", note:"多轮导弹压制" }, { id:"cannon", name:"震荡王座", note:"重型动能齐射" }],
    core: [{ id:"blue", name:"统御矩阵", note:"全小队伤害光环", color:"#38c8ff" }, { id:"red", name:"天罚裁决", note:"周期点名 · 眩晕", color:"#ff553b" }, { id:"violet", name:"裂界侵蚀", note:"范围削弱防御", color:"#c16cff" }]
  };
  const selection = { hull:"shield", weapon:"laser", core:"blue" };
  const find = (kind, id) => OPTIONS[kind].find(x => x.id === id) || OPTIONS[kind][0];
  function optionHtml(kind) { return OPTIONS[kind].map(x => `<option value="${x.id}">${x.name} · ${x.note}</option>`).join(""); }
  function show(view) {
    const tabs = document.querySelector("#shipeng-subview-tabs");
    const comp = document.getElementById("shipeng-comp-view"), asm = document.getElementById("shipeng-asm-view"), titan = document.getElementById("shipeng-titan-view");
    if (!tabs || !titan) return;
    tabs.querySelectorAll(".shipeng-subview-tab").forEach(b => {
      const selected = b.dataset.titanSubview === view || b.dataset.subview === view;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-selected", String(selected));
    });
    if (comp) comp.style.display = view === "component" ? "" : "none";
    if (asm) asm.style.display = view === "assembly" ? "" : "none";
    titan.style.display = view === "titan" ? "" : "none";
  }
  function render() {
    const host = document.getElementById("shipeng-panel"); if (!host) return;
    let tabs = document.getElementById("shipeng-subview-tabs"); if (!tabs) return;
    const boosters = document.getElementById("ship-action-booster-slots");
    if (boosters && boosters.parentElement === document.querySelector("#shipeng-panel .panel-body")) tabs.after(boosters);
    if (!tabs.querySelector("[data-titan-subview]")) {
      const b = document.createElement("button"); b.className = "shipeng-subview-tab"; b.dataset.titanSubview = "titan"; b.textContent = "✦ 泰坦组装"; b.type = "button"; tabs.appendChild(b);
      b.addEventListener("click", () => { ensureView(); show("titan"); });
    }
    ensureView();
  }
  function ensureView() {
    const panel = document.getElementById("shipeng-panel"); if (!panel || document.getElementById("shipeng-titan-view")) return;
    const el = document.createElement("div"); el.id = "shipeng-titan-view"; el.className = "titan-forge-fresh"; el.style.display = "none";
    el.innerHTML = `<div class="titan-forge-fresh-grid"><div class="titan-forge-fresh-controls"><div class="titan-forge-kicker">TITAN ASSEMBLY</div><h2>泰坦组装</h2><p>从部件车间取得舰体、武器和核心，组合成一架泰坦。</p>${["hull","weapon","core"].map((k,i)=>`<label class="titan-fresh-slot"><span>${String(i+1).padStart(2,"0")} · ${k === "hull" ? "防御舰体" : k === "weapon" ? "攻击模块" : "核心模块"}</span><select class="u-select" data-titan-fresh="${k}">${optionHtml(k)}</select><small data-titan-note="${k}">${find(k, selection[k]).note}</small></label>`).join("")}<button class="btn primary" type="button" data-titan-fresh-build>⚓ 模拟总装泰坦</button><div class="titan-fresh-status" data-titan-fresh-status>已选 3 / 3 个组件 · 可进行原型总装</div></div><div class="titan-forge-fresh-preview"><div class="titan-preview"><span class="titan-preview-label">LIVE TITAN ASSEMBLY</span></div><div class="titan-fresh-summary" data-titan-summary></div></div></div>`;
    panel.appendChild(el);
    el.addEventListener("change", e => { const s=e.target.closest("[data-titan-fresh]"); if(!s)return; selection[s.dataset.titanFresh]=s.value; const n=el.querySelector(`[data-titan-note="${s.dataset.titanFresh}"]`); if(n)n.textContent=find(s.dataset.titanFresh,s.value).note; updateSummary(el); });
    el.querySelector("[data-titan-fresh-build]").addEventListener("click", () => { el.querySelector("[data-titan-fresh-status]").textContent="原型装配完成：已生成一架泰坦"; });
    updateSummary(el);
  }
  function updateSummary(el) { el.querySelector("[data-titan-summary]").innerHTML = ["hull","weapon","core"].map(k=>`<span><b>${k === "hull" ? "舰体" : k === "weapon" ? "武器" : "核心"}</b>${find(k,selection[k]).name}</span>`).join(""); }
  new MutationObserver(render).observe(document.body, { childList:true, subtree:true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
