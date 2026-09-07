/* ================================================================
   星图内虫洞裂隙叠加层（入口）
   ----------------------------------------------------------------
   - 星图是同源 iframe，此处从主窗口注入叠加 canvas（不改只读的
     legion-starmap-pure.html / content.js）
   - 裂隙数据来自 gameState.wormhole.dailies（真实尺寸/宝藏数/词条）
   - 位置按 daily.seed 确定性生成：避开星图节点、彼此不重叠、落在目标环带
   - 点击裂隙 → postMessage 回主窗口 → 切到虫洞页面
   - 主线未通关：完全不绘制（门禁与系统一致）
   ================================================================ */
(() => {
  "use strict";

  const CX = 500, CY = 350;
  // 半径上限受节点圈约束：r + 光晕(44) + 标签偏移(42) <= 318（星图 Voronoi 边界）
  const SIZE_STYLE = {
    9:  { color: "#c9a0ff", rMin: 238, rMax: 268 },
    13: { color: "#a66bff", rMin: 148, rMax: 196 },
    17: { color: "#8f4bff", rMin: 88,  rMax: 138 }
  };
  const HIT_RADIUS = 38;

  function rngFrom(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  }
  function unlocked() {
    try {
      return typeof WORMHOLE !== "undefined" && WORMHOLE.isUnlocked && window.gameState && WORMHOLE.isUnlocked(window.gameState);
    } catch (_) { return false; }
  }
  function dailies() {
    try {
      const W = window.gameState && window.gameState.wormhole;
      return (W && W.dailies) || [];
    } catch (_) { return []; }
  }

  let ctxRef = null;      // { doc, win, cv, vp, ov, o }
  let rifts = [];
  let riftKey = "";
  let downPt = null;

  function frameParts() {
    try {
      const f = document.getElementById("legion-starmap-frame");
      if (!f || !f.contentDocument || !f.contentWindow) return null;
      const doc = f.contentDocument;
      const cv = doc.getElementById("map");
      if (!cv || !cv.parentNode) return null;
      return { doc: doc, win: f.contentWindow, cv: cv, vp: cv.parentNode };
    } catch (_) { return null; }   // file:// 不透明源 → 跨文档访问被浏览器拦截
  }

  /* ---------------- 回退：无法进入 iframe 时的入口卡片 ----------------
     file:// 打开（或 Electron file:// 加载）时，浏览器把本地文件视为不透明源，
     父窗口读不到 iframe 的 document，星图内裂隙无法绘制。此时在星图面板内
     插入一排入口卡片，保证任何环境下都有虫洞入口。 */
  let fallbackEl = null, fallbackKey = "", missCount = 0;

  function fallbackText(list) {
    const names = (window.WORMHOLE_CONFIG && window.WORMHOLE_CONFIG.SIZE_NAMES) || {};
    const AFF = window.WORMHOLE_AFFIXES || [];
    return list.map(d => {
      const style = SIZE_STYLE[d.size] || SIZE_STYLE[9];
      const aff = AFF.filter(a => a.id === d.affixId)[0];
      const done = d.status === "completed" || d.status === "failed" || d.status === "aborted";
      return '<button type="button" class="wh-rift-card" data-wh-rift="' + String(d.id) + '"' +
        ' style="flex:1;min-width:150px;text-align:left;padding:9px 11px;border:1px solid ' + style.color +
        '77;border-radius:8px;background:linear-gradient(135deg,#150f28,#0a0a1c);color:#dcd2ff;cursor:pointer;font:inherit' +
        (done ? ';opacity:.45' : '') + '">' +
        '<div style="color:' + style.color + ';font-size:13px;font-weight:600">' + (names[d.size] || ("虫洞 " + d.size)) + ' · ' + d.size + ' 节点</div>' +
        '<div style="color:#8fa8c3;font-size:11.5px;margin-top:3px;line-height:1.6">宝藏 ' + (d.treasureCount || 0) +
        ' 个' + (aff ? '<br>词条：' + aff.name : '') + '</div></button>';
    }).join("");
  }

  function mountFallback() {
    const frame = document.getElementById("legion-starmap-frame");
    if (!frame || !frame.parentNode) return null;
    if (!fallbackEl) {
      fallbackEl = document.createElement("div");
      fallbackEl.id = "wh-rift-fallback";
      fallbackEl.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px";
      fallbackEl.addEventListener("click", (e) => {
        const btn = e.target.closest ? e.target.closest("[data-wh-rift]") : null;
        if (!btn) return;
        try { if (typeof switchPage === "function") switchPage("wormhole"); } catch (_) {}
      });
      frame.parentNode.insertBefore(fallbackEl, frame);
    }
    const list = dailies();
    const key = list.map(d => d.id + ":" + d.status).join("|");
    if (key !== fallbackKey) { fallbackEl.innerHTML = fallbackText(list); fallbackKey = key; }
    fallbackEl.style.display = list.length ? "flex" : "none";
    return fallbackEl;
  }

  function hideFallback() {
    if (fallbackEl) { fallbackEl.style.display = "none"; fallbackEl.innerHTML = ""; fallbackKey = ""; }
  }

  function mount() {
    if (ctxRef) return ctxRef;
    const parts = frameParts();
    if (!parts) return null;
    // 防双影：iframe load 重置 ctxRef 后旧画布会残留在 DOM，先全部移除再挂新的
    try {
      const stale = parts.doc.querySelectorAll ? parts.doc.querySelectorAll('canvas[id="wh-rift-overlay"]') : [];
      for (let i = 0; i < stale.length; i++) {
        const el = stale[i];
        if (el && el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
      }
    } catch (_) {}
    const ov = parts.doc.createElement("canvas");
    ov.id = "wh-rift-overlay";
    ov.width = 1000; ov.height = 700;
    ov.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:1";
    parts.vp.appendChild(ov);
    ctxRef = { doc: parts.doc, win: parts.win, cv: parts.cv, vp: parts.vp, ov: ov, o: ov.getContext("2d") };

    // 与星图节点完全一致的绑法：canvas 上的 pointerdown/pointerup（events.js 同款）
    // document 级再兜一层（个别覆盖层可能吃掉冒泡）
    const onDown = (e) => { downPt = { x: e.clientX, y: e.clientY }; };
    parts.cv.addEventListener("pointerdown", onDown);
    parts.cv.addEventListener("pointerup", (e) => { hitTestAndOpen(e, parts.win); });
    parts.doc.addEventListener("pointerdown", onDown, true);
    parts.doc.addEventListener("pointerup", (e) => { hitTestAndOpen(e, parts.win); }, false);
    parts.doc.addEventListener("click", (e) => { hitTestAndOpen(e, parts.win); }, false);
    return ctxRef;
  }

  let lastOpenAt = 0;
  function hitTestAndOpen(e, win) {
    if (!e || !rifts.length) return;
    const moved = downPt && Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y) > 6;
    downPt = null;
    if (moved) return;                        // 拖拽平移地图，不当作点击
    const nowMs = Date.now();
    if (nowMs - lastOpenAt < 400) return;     // pointerup + click 双路径去重
    lastOpenAt = nowMs;
    const p = toCanvas(e);
    if (!p) return;
    const hit = rifts.filter(r => Math.hypot(r.x - p.x, r.y - p.y) < HIT_RADIUS)[0];
    if (!hit) return;
    try { if (typeof win.LEGION_STARMAP_SELECT === "function") win.LEGION_STARMAP_SELECT(null); } catch (_) {}
    try { win.parent.postMessage({ type: "wormhole/open", dailyId: hit.id }, "*"); } catch (_) {}
    try { if (typeof switchPage === "function") switchPage("wormhole"); } catch (_) {}   // 同源时直接切，双保险
  }

  function toCanvas(e) {
    if (!ctxRef) return null;
    const rect = ctxRef.cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: (e.clientX - rect.left) * 1000 / rect.width, y: (e.clientY - rect.top) * 700 / rect.height };
  }

  function syncTransform() {
    const cv = ctxRef.cv, ov = ctxRef.ov;
    const gv = (n, d) => { const v = cv.style.getPropertyValue(n); return (v === "" || v == null) ? d : v; };
    ov.style.transform = "translate(" + gv("--pan-x", "0px") + "," + gv("--pan-y", "0px") + ") scale(" + gv("--zoom", "1") + ")";
    ov.style.transformOrigin = "center";
  }

  function ensureRifts() {
    const list = dailies();
    if (!list.length) { rifts = []; return; }
    const key = list.map(d => d.id + ":" + d.size).join("|");
    if (key === riftKey && rifts.length) return;
    const model = ctxRef.win.LEGION_STARMAP_RENDER_MODEL;
    const nodes = (model && Array.isArray(model.nodes)) ? model.nodes : [];
    if (!nodes.length) return;                    // 等星图模型就绪
    const names = (window.WORMHOLE_CONFIG && window.WORMHOLE_CONFIG.SIZE_NAMES) || {};
    const placed = [];
    rifts = list.map((d, idx) => {
      const style = SIZE_STYLE[d.size] || SIZE_STYLE[9];
      const rnd = rngFrom((Number(d.seed) || (idx + 1) * 7919) + idx * 104729);
      let best = null, bestScore = -1;
      // 双层：外层是「裂隙彼此间距」硬门槛（96→80→64），内层是「离星图节点」门槛（66→24）
      for (const placedMin of [96, 80, 64]) {
        for (let minD = 66; minD >= 24; minD -= 6) {
          for (let t = 0; t < 700; t++) {
            const a = rnd() * Math.PI * 2;
            const rad = style.rMin + rnd() * (style.rMax - style.rMin);
            const px = CX + Math.cos(a) * rad, py = CY + Math.sin(a) * rad;
            if (px < 78 || px > 922 || py < 78 || py > 622) continue;
            let dNode = Infinity;
            for (let i = 0; i < nodes.length; i++) {
              const dd = Math.hypot(nodes[i].x - px, nodes[i].y - py);
              if (dd < dNode) dNode = dd;
            }
            let dPlaced = Infinity;
            for (let j = 0; j < placed.length; j++) {
              const dd = Math.hypot(placed[j].x - px, placed[j].y - py);
              if (dd < dPlaced) dPlaced = dd;
            }
            if (dNode >= minD && dPlaced >= placedMin) { best = { x: px, y: py }; break; }
            const score = Math.min(dNode, dPlaced) * 10;
            if (score > bestScore) { bestScore = score; best = { x: px, y: py }; }
          }
          if (best && bestScore >= placedMin * 10) break;
        }
        const okPlaced = !best || (function () {
          for (let j = 0; j < placed.length; j++) {
            if (Math.hypot(placed[j].x - best.x, placed[j].y - best.y) < placedMin) return false;
          }
          return true;
        })();
        if (best && okPlaced) break;
      }
      if (!best) best = { x: CX + (style.rMin + style.rMax) / 2, y: CY };
      const r = {
        id: d.id, size: d.size, x: best.x, y: best.y,
        color: style.color,
        label: names[d.size] || ("虫洞 " + d.size),
        status: d.status
      };
      placed.push(r);
      return r;
    });
    riftKey = key;
  }

  function drawRift(r, t) {
    const o = ctxRef.o;
    const pulse = 1 + Math.sin(t / 700 + r.x) * 0.08;
    o.save();
    o.translate(r.x, r.y);
    const g = o.createRadialGradient(0, 0, 0, 0, 0, 44 * pulse);
    g.addColorStop(0, r.color + "cc");
    g.addColorStop(0.35, r.color + "44");
    g.addColorStop(1, r.color + "00");
    o.fillStyle = g; o.globalAlpha = 0.85;
    o.beginPath(); o.arc(0, 0, 44 * pulse, 0, 6.2832); o.fill();

    const dim = r.status === "completed" || r.status === "failed" || r.status === "aborted";
    o.globalAlpha = dim ? 0.35 : 1;
    o.rotate(t / 1400);
    for (let i = 0; i < 3; i++) {
      const rr = 10 + i * 7, a0 = i * 2.1;
      o.strokeStyle = r.color; o.globalAlpha = (dim ? 0.35 : 0.9) - i * 0.22; o.lineWidth = 2.2 - i * 0.5;
      o.beginPath(); o.arc(0, 0, rr * pulse, a0, a0 + 2.2); o.stroke();
    }
    o.rotate(-t / 1400);

    o.globalAlpha = dim ? 0.4 : 1;
    o.beginPath(); o.arc(0, 0, 5.5, 0, 6.2832); o.fillStyle = "#ffffff"; o.fill();
    o.globalAlpha = dim ? 0.4 : 0.9; o.strokeStyle = r.color; o.lineWidth = 1.6;
    o.beginPath(); o.arc(0, 0, 29 * pulse, 0, 6.2832); o.stroke();

    o.globalAlpha = dim ? 0.5 : 1;
    o.font = '600 13px system-ui, "Microsoft YaHei", sans-serif';
    o.textAlign = "center"; o.textBaseline = "middle";
    o.fillStyle = r.color;
    o.fillText(r.label + " · " + r.size, 0, 42);
    o.restore();
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const panel = document.getElementById("starmap-panel");
    if (panel && panel.style.display === "none") return;      // 星图页不可见时不绘制
    if (!unlocked()) {
      if (ctxRef) { ctxRef.o.clearRect(0, 0, 1000, 700); }
      rifts = []; riftKey = ""; missCount = 0;
      hideFallback();
      return;
    }
    const c = mount();
    mountFallback();                     // 入口卡片常驻：任何环境都有可点入口
    if (!c) {
      missCount++;
      return;
    }
    missCount = 0;
    ensureRifts();
    syncTransform();
    c.o.clearRect(0, 0, 1000, 700);
    for (let i = 0; i < rifts.length; i++) drawRift(rifts[i], t);
  }

  // 主窗口收到 iframe 的点击 → 打开虫洞页
  window.addEventListener("message", (event) => {
    const d = event.data;
    if (!d || d.type !== "wormhole/open") return;
    try { if (typeof switchPage === "function") switchPage("wormhole"); } catch (_) {}
  });

  let loopStarted = false;
  function init() {
    if (loopStarted) return;
    loopStarted = true;                    // rAF 链只允许一条，防双画布双循环
    const frame = document.getElementById("legion-starmap-frame");
    if (frame) {
      frame.addEventListener("load", () => { ctxRef = null; rifts = []; riftKey = ""; });   // iframe 重载后重挂
    }
    requestAnimationFrame(loop);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.WORMHOLE_RIFTS = {
    get rifts() { return rifts; },
    mount: mount,
    frameParts: frameParts,
    // 调试：控制台执行 WORMHOLE_RIFTS.open() 直接开虫洞页；state() 看挂载状态
    open: function () { try { if (typeof switchPage === "function") switchPage("wormhole"); } catch (_) {} },
    state: function () {
      return {
        mounted: !!ctxRef,
        docAccess: !!frameParts(),
        unlocked: unlocked(),
        riftCount: rifts.length,
        rifts: rifts.map(r => ({ id: r.id, label: r.label, size: r.size, x: Math.round(r.x), y: Math.round(r.y) })),
        fallbackVisible: !!fallbackEl && fallbackEl.style.display !== "none"
      };
    }
  };
})();
