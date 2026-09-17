/* ================================================================
   虫洞试炼地图（游戏内）
   ----------------------------------------------------------------
   - 渲染当前远征所在虫洞：Voronoi 不规则碎片、邻接连线、节点标签
   - 未制压=黑 / 已制压=白 / 跳过=暗红 / 当前节点=琥珀 + 进度环
   - 数据：gameState.wormhole.dailies[].nodes（含 poly/links）+ run 状态
   - 由 wormhole-render 的 renderWormholePage() 调用（存在即调用）
   ================================================================ */
(() => {
  "use strict";

  const COL = {
    bg0: "#0b1420", bg1: "#050a12",
    link: "rgba(109,126,169,.22)", path: "#a982ec",
    raw: "rgba(5,10,22,.44)", rawEdge: "rgba(112,91,158,.34)",
    done: "rgba(188,218,211,.10)", doneEdge: "rgba(127,216,192,.42)",
    skip: "rgba(80,29,39,.20)", skipEdge: "rgba(211,106,112,.44)",
    cur: "rgba(105,54,173,.28)", curEdge: "rgba(184,132,255,.72)",
    tre: "#f0c674", treEdge: "rgba(240,198,116,.50)",
    entry: "#6fd3ff", exit: "#ff8a8a",
    text: "#93aecb"
  };

  function esc(s) { return String(s == null ? "" : s); }

  let wormholeBackdropImage = null;
  if (typeof Image !== "undefined") {
    try {
      wormholeBackdropImage = new Image();
      wormholeBackdropImage.decoding = "async";
      wormholeBackdropImage.onload = () => {
        if (typeof window.renderWormholePage === "function") window.renderWormholePage();
      };
      wormholeBackdropImage.src = "./demo-assets/wormhole-map-bg.png";
    } catch (_) { wormholeBackdropImage = null; }
  }

  function drawWormholeBackdrop(x, W, H, cx, cy, R, t) {
    const phase = Number(t || 0) * 0.000035;
    x.save();

    const deepSpace = x.createRadialGradient(W * 0.42, H * 0.34, 24, W * 0.42, H * 0.34, Math.max(W, H));
    deepSpace.addColorStop(0, "#030611");
    deepSpace.addColorStop(0.48, "#080719");
    deepSpace.addColorStop(1, "#02040c");
    x.fillStyle = deepSpace;
    x.fillRect(0, 0, W, H);

    if (wormholeBackdropImage && wormholeBackdropImage.complete && wormholeBackdropImage.naturalWidth > 0) {
      const iw = wormholeBackdropImage.naturalWidth;
      const ih = wormholeBackdropImage.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      x.globalAlpha = 0.76;
      x.drawImage(wormholeBackdropImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
      x.globalAlpha = 1;
    }

    for (let i = 0; i < 72; i++) {
      const sx = (i * 149 + 43) % W;
      const sy = (i * 83 + 29) % H;
      const pulse = 0.42 + Math.sin(phase * 8 + i * 1.71) * 0.22;
      const size = i % 11 === 0 ? 1.35 : (i % 4 === 0 ? 0.9 : 0.55);
      x.beginPath();
      x.arc(sx, sy, size, 0, Math.PI * 2);
      x.fillStyle = "rgba(207,194,255," + Math.max(0.12, pulse).toFixed(3) + ")";
      x.fill();
    }

    const halo = x.createRadialGradient(cx, cy, R * 0.08, cx, cy, R * 1.46);
    halo.addColorStop(0, "rgba(215,194,255,.13)");
    halo.addColorStop(0.32, "rgba(143,75,255,.15)");
    halo.addColorStop(0.72, "rgba(63,30,118,.09)");
    halo.addColorStop(1, "rgba(12,7,30,0)");
    x.fillStyle = halo;
    x.fillRect(0, 0, W, H);

    x.translate(cx, cy);
    x.rotate(phase);
    for (let i = 0; i < 5; i++) {
      const radius = R * (0.46 + i * 0.17);
      x.beginPath();
      x.arc(0, 0, radius, i * 0.72, i * 0.72 + Math.PI * (0.68 + i * 0.06));
      x.strokeStyle = "rgba(166,107,255," + (0.095 - i * 0.012).toFixed(3) + ")";
      x.lineWidth = 11 - i * 1.4;
      x.shadowColor = "rgba(143,75,255,.24)";
      x.shadowBlur = 18;
      x.stroke();
    }
    x.restore();
  }

  let selectedNodeId = null;
  let roomClosed = false;        // 用户关闭房间后停止自动跟随，直到点选节点或开新远征
  let roomRunId = null;

  function findDaily(state, dailyId) {
    const W = state && state.wormhole;
    if (!W || !dailyId) return null;
    return (W.dailies || []).filter(d => d.id === dailyId)[0] || null;
  }

  function renderWormholeMap(view, now) {
    const canvas = document.getElementById("wh-map");
    const wrap = document.getElementById("wh-map-wrap");
    if (!canvas || !wrap) return false;
    const t = now || Date.now();
    const state = (typeof gameState !== "undefined") ? gameState : null;
    const run = view && view.run;
    if (!state || !run || run.state !== "running") {
      wrap.style.display = "none";
      return false;
    }
    const daily = findDaily(state, run.dailyId);
    if (!daily || !Array.isArray(daily.nodes) || !daily.nodes.length) {
      wrap.style.display = "none";
      return false;
    }
    wrap.style.display = "";

    const x = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    // 圆心：优先读 daily 持久化值；旧档回退 = generateGraph 的常量（390/290/248，不是画布中心！）
    const cx = daily.cx !== undefined ? daily.cx : 390;
    const cy = daily.cy !== undefined ? daily.cy : 290;
    const R = daily.R !== undefined ? daily.R : 248;

    x.clearRect(0, 0, W, H);
    drawWormholeBackdrop(x, W, H, cx, cy, R, t);

    // 外边界
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2);
    x.strokeStyle = "rgba(166,107,255,.58)"; x.lineWidth = 1.2; x.stroke();

    // 邻接连线（路径上加亮）
    const pathSet = {};
    for (let i = 1; i < run.path.length; i++) {
      pathSet[run.path[i - 1] + "-" + run.path[i]] = true;
      pathSet[run.path[i] + "-" + run.path[i - 1]] = true;
    }
    daily.nodes.forEach((n) => {
      (n.links || []).forEach((lid) => {
        const m = daily.nodes.filter(q => q.id === lid)[0];
        if (!m || String(m.id) < String(n.id)) return;
        const on = pathSet[n.id + "-" + m.id];
        x.strokeStyle = on ? COL.path : COL.link;
        x.lineWidth = on ? 2 : 1.1;
        x.beginPath(); x.moveTo(n.x, n.y); x.lineTo(m.x, m.y); x.stroke();
      });
    });

    const cleared = run.cleared || [], skipped = run.skipped || [];
    // 碎片
    daily.nodes.forEach((n) => {
      const poly = n.poly || [];
      if (poly.length < 3) return;
      const isCur = run.current && n.id === run.current;
      const done = cleared.indexOf(n.id) >= 0 || n.kind === "entry";   // 入口无试炼：出发即制压
      const skip = skipped.indexOf(n.id) >= 0;
      let fill = COL.raw, edge = COL.rawEdge, lw = 0.6;
      if (done) { fill = COL.done; edge = COL.doneEdge; lw = 1.1; }
      if (skip) { fill = COL.skip; edge = COL.skipEdge; lw = 1; }
      if (n.kind === "treasure" && !done) { edge = COL.treEdge; lw = 1.2; }
      if (isCur) { fill = COL.cur; edge = COL.curEdge; lw = 1.6; }

      x.beginPath(); x.moveTo(poly[0].x, poly[0].y);
      for (let k = 1; k < poly.length; k++) x.lineTo(poly[k].x, poly[k].y);
      x.closePath();
      x.fillStyle = fill; x.globalAlpha = 1;
      x.fill();
      x.strokeStyle = edge; x.lineWidth = lw; x.stroke();
    });

    // 标签
    x.textAlign = "center"; x.textBaseline = "middle";
    daily.nodes.forEach((n) => {
      const isCur = run.current && n.id === run.current;
      const done = cleared.indexOf(n.id) >= 0 || n.kind === "entry";   // 入口无试炼：出发即制压
      const skip = skipped.indexOf(n.id) >= 0;
      let label = "·", color = COL.text, beacon = "#aab8cc";
      if (n.kind === "entry") { label = "入"; color = COL.entry; }
      else if (n.kind === "exit") { label = "出"; color = COL.exit; }
      else if (n.kind === "treasure") { label = "宝"; color = COL.tre; }
      else if (n.type === "battle") { label = "战"; beacon = "#b5c2d4"; }
      else if (n.type === "collection") { label = "采"; beacon = "#72d8b8"; }
      else if (n.type === "archaeology") { label = "考"; beacon = "#9eaff0"; }

      if (n.kind === "entry") beacon = COL.entry;
      else if (n.kind === "exit") beacon = COL.exit;
      else if (n.kind === "treasure") beacon = COL.tre;

      if (isCur) { color = "#f0e5ff"; beacon = "#b982ff"; }
      else if (done) color = "#d9eee8";
      else if (skip) color = "#c89090";

      // 节点信标：仅改变绘制外观；中心坐标与点击命中半径保持不变。
      x.save();
      x.translate(n.x, n.y);
      x.rotate(Math.PI / 4);
      x.beginPath(); x.rect(-11, -11, 22, 22);
      x.fillStyle = isCur ? "rgba(91,42,153,.82)" : (skip ? "rgba(58,20,30,.88)" : "rgba(6,12,25,.88)");
      x.shadowColor = beacon; x.shadowBlur = isCur ? 18 : 9;
      x.fill();
      x.strokeStyle = beacon; x.lineWidth = isCur ? 1.8 : 1.15; x.stroke();
      x.beginPath(); x.rect(-8, -8, 16, 16);
      x.strokeStyle = isCur ? "rgba(232,210,255,.52)" : "rgba(224,232,255,.18)";
      x.lineWidth = 0.7; x.stroke();
      x.restore();

      x.font = "700 11px 'Segoe UI','Microsoft YaHei',sans-serif";
      x.fillStyle = color;
      x.fillText(label, n.x, n.y - 3);

      // 制压/跳过保留第二重状态标识，以小型角标呈现。
      if (done || skip) {
        x.beginPath(); x.arc(n.x + 11, n.y - 11, 5, 0, Math.PI * 2);
        x.fillStyle = "rgba(4,10,18,.94)"; x.fill();
        x.strokeStyle = done ? "#7fd8c0" : "#d38a67"; x.lineWidth = 1.2; x.stroke();
        x.font = "700 7px 'Segoe UI',sans-serif";
        x.fillStyle = done ? "#7fd8c0" : "#d38a67";
        x.fillText(done ? "✓" : "✗", n.x + 11, n.y - 11);
      }

      const sub = (n.kind === "trial" && n.ring) ? (n.ring === "outer" ? "外" : n.ring === "middle" ? "中" : "内") : "";
      if (sub) {
        x.font = "10px 'Segoe UI',sans-serif";
        x.fillStyle = isCur ? "#d8baff" : (done ? "#80baa9" : "rgba(166,177,207,.62)");
        x.fillText(sub, n.x, n.y + 8);
      }
    });

    // 当前节点进度环（travel 阶段画在目标节点上）
    if (run.nextEventAt && run.currentStartedAt) {
      const targetId = run.current || run.pendingId;
      const n = targetId ? daily.nodes.filter(q => q.id === targetId)[0] : null;
      const span = run.nextEventAt - run.currentStartedAt;
      if (n && span > 0) {
        const p = Math.max(0, Math.min(1, (t - run.currentStartedAt) / span));
        x.beginPath();
        x.arc(n.x, n.y, 26, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        x.strokeStyle = "#2a1a06"; x.lineWidth = 3; x.stroke();
      }
    }
    // 手动模式：所有未清节点画青色虚圈（点哪去哪，自动寻路）；相邻未清更醒目
    if (run.control === "manual" && run.phase === "idle") {
      const cur = daily.nodes.filter(n => n.id === (run.parkedAt || run.current))[0];
      daily.nodes.forEach((m) => {
        if (!m || m.kind === "entry" || m.kind === "exit") return;
        const isDone = cleared.indexOf(m.id) >= 0 || skipped.indexOf(m.id) >= 0;
        if (isDone) return;
        const isAdj = cur && (cur.links || []).indexOf(m.id) >= 0;
        x.beginPath(); x.arc(m.x, m.y, 30, 0, Math.PI * 2);
        x.strokeStyle = "#7fd8c0"; x.lineWidth = isAdj ? 2.5 : 1.5; x.setLineDash([5, 4]); x.stroke(); x.setLineDash([]);
      });
    }
    bindMapClicks(canvas);
    return true;
  }

  let mapClicksBound = false;
  // ⚠️ 闭包陷阱：不能把 view.run / daily 快照闭包进来——bindMapClicks 只绑一次，
  // 之后 renderWormholePage 每次传入的都是新快照，闭包里永远是旧状态（曾导致
  // 手动选路点击无反应）。点击时必须读实时 gameState。
  function bindMapClicks(canvas) {
    if (mapClicksBound) return;
    mapClicksBound = true;
    canvas.addEventListener("click", (e) => {
      const state = (typeof gameState !== "undefined") ? gameState : null;
      const Wst = state && state.wormhole;
      const run = Wst && Wst.run && Wst.run.state === "running" ? Wst.run : null;
      const daily = run ? (Wst.dailies || []).filter(d => d.id === run.dailyId)[0] : null;
      if (!run || !daily) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const px = (e.clientX - rect.left) * canvas.width / rect.width;
      const py = (e.clientY - rect.top) * canvas.height / rect.height;
      let hit = null, bd = Infinity;
      for (const n of daily.nodes) {
        const d = Math.hypot(n.x - px, n.y - py);
        if (d < bd) { bd = d; hit = n; }
      }
      if (hit && bd < 26) {
        // 手动选路：点任意未清节点 = 前往（自动寻路穿越）；点相邻已清/出入口 = 移动过去；点远处已清 = 仅查看
        if (run.control === "manual" && run.phase === "idle" && (run.parkedAt || run.current)) {
          const cur = daily.nodes.filter(n => n.id === (run.parkedAt || run.current))[0];
          const adj = cur && (cur.links || []).indexOf(String(hit.id)) >= 0;
          const undone = (run.cleared || []).indexOf(hit.id) < 0 && (run.skipped || []).indexOf(hit.id) < 0;
          const isChannel = hit.kind === "entry" || hit.kind === "exit";
          if (undone || (adj && ((run.cleared || []).indexOf(hit.id) >= 0 || (run.skipped || []).indexOf(hit.id) >= 0 || isChannel))) {
            selectedNodeId = hit.id;
            roomClosed = false;
            if (typeof dispatchGameAction === "function") {
              dispatchGameAction(state, { type: "wormhole/setControl", control: "manual" }, Date.now());
              dispatchGameAction(state, { type: "wormhole/setTarget", nodeId: hit.id }, Date.now());
            }
            if (typeof window.renderWormholePage === "function") window.renderWormholePage();
            return;
          }
        }
        selectedNodeId = hit.id;
        roomClosed = false;
        if (typeof window.renderWormholePage === "function") window.renderWormholePage();
      }
    });
  }

  /* ---------------- 节点试炼房间（复用星图房间外壳 .starmap-trial-room） ---------------- */
  function typeLabel(n) {
    if (n.kind === "entry") return "入口";
    if (n.kind === "exit") return "出口";
    if (n.kind === "treasure") return "宝藏节点";
    if (n.type === "battle") return "战斗试炼";
    if (n.type === "collection") return "采集试炼";
    if (n.type === "archaeology") return "考古试炼";
    return "节点";
  }
  function ringLabel(r) { return r === "outer" ? "外环" : r === "middle" ? "中环" : r === "inner" ? "内环" : "—"; }

  function nodePlanText(n) {
    const REW = window.WORMHOLE_REWARDS || {};
    const ring = n.ring || "outer";
    if (n.kind === "treasure") return "无试炼 · 抵达即领 <b>虫洞印记 +5</b>";
    if (n.kind === "entry" || n.kind === "exit") return "通道节点 · 不产生试炼";
    if (n.type === "battle") {
      const isk = (REW.battle && REW.battle.isk && REW.battle.isk[ring]) || { normal: 0, elite: 0 };
      const v = n.tier === "elite" ? isk.elite : isk.normal;
      const cargo = REW.battle && REW.battle.cargoByRing ? REW.battle.cargoByRing[ring] : "货柜";
      const lic = REW.battle && REW.battle.licenseTierByRing ? REW.battle.licenseTierByRing[ring] : "A";
      return "胜利奖励：<b>星币 " + Number(v || 0).toLocaleString() + "</b>　另有各 50% 得 1 个：" + cargo + " / 生产许可 " + lic + " 档（势力随机）";
    }
    if (n.type === "collection") {
      const qty = (REW.collection && REW.collection.qty && REW.collection.qty[ring]) || 0;
      const byKind = (REW.collection && REW.collection.byKind) || {};
      const ore = (byKind.ore || {})[ring] || "泰坦材料";
      const gas = (byKind.gas || {})[ring] || "泰坦材料";
      return "完成奖励：<b>" + ore + " 或 " + gas + " ×" + qty + "</b>（按节点矿/气类型）";
    }
    if (n.type === "archaeology") {
      const spec = (REW.archaeology || {})[ring] || { tier: "iii", chance: 0.15 };
      return "完成奖励：<b>校准基体 " + String(spec.tier).toUpperCase() + " 型 ×1</b>（概率 " + Math.round(spec.chance * 100) + "%）";
    }
    return "—";
  }

  function fmtDurS(sec) { sec = Math.max(0, Math.round(sec)); return sec >= 60 ? Math.floor(sec / 60) + "m" + String(sec % 60).padStart(2, "0") + "s" : sec + "s"; }

  // 与 systems 结算同源的展示数值（仅供房间显示，非结算依据）
  function roomData(state, daily, run, n, t) {
    const CFG = window.WORMHOLE_CONFIG || {};
    const REW = window.WORMHOLE_REWARDS || {};
    const ring = n.ring || "outer";
    const affix = (window.WORMHOLE_AFFIXES || []).filter(a => a.id === daily.affixId)[0] || null;
  const Wst = state.wormhole || {};
  const activeUpgrades = Wst.run && Wst.run.state === "running" && Wst.run.upgradeSnapshot
    ? Wst.run.upgradeSnapshot : (Wst.upgrades || {});
  const upg = (id) => Math.max(0, Math.floor(Number(activeUpgrades[id]) || 0));
    const effectiveNode = window.WORMHOLE && typeof window.WORMHOLE.getEffectiveTrialNode === "function"
      ? window.WORMHOLE.getEffectiveTrialNode(state, daily, n) : n;
    const isCur = run.current && n.id === run.current;
    const frac = (isCur && run.currentStartedAt && run.nextEventAt)
      ? Math.max(0, Math.min(1, (t - run.currentStartedAt) / (run.nextEventAt - run.currentStartedAt))) : 0;
    const limitProp = { battle: "battleTrialTimeLimitSeconds", collection: "collectionTimeLimitSeconds", archaeology: "archaeologyTimeLimitSeconds" }[n.type];
    const data = { ring, affix, isCur, frac, limit: Number(effectiveNode && effectiveNode[limitProp]) || CFG.NODE_LIMIT_SECONDS || 180 };

    if (n.type === "battle") {
      const isk = (REW.battle && REW.battle.isk && REW.battle.isk[ring]) || { normal: 0, elite: 0 };
      data.elite = n.tier === "elite";
      data.enemyCount = Number(effectiveNode.battleTrialEnemyCount) || 2;
      data.isk = data.elite ? isk.elite : isk.normal;
      data.cargo = (REW.battle && REW.battle.cargoByRing && REW.battle.cargoByRing[ring]) || "货柜";
      data.lic = (REW.battle && REW.battle.licenseTierByRing && REW.battle.licenseTierByRing[ring]) || "A";
      const req = ({ outer: 55, middle: 75, inner: 90 })[ring] || 55;
      const cl = (typeof getCombatLevelFromState === "function") ? (getCombatLevelFromState(state) || 1) : 1;
      let p = 0.78 + (cl - (req + (data.elite ? 10 : 0))) * 0.02;
      data.win = Math.max(25, Math.min(95, Math.round(p)));
    } else if (n.type === "collection") {
      const base = Number(effectiveNode.collectionBaseSecondsPerUnit) || (ring === "inner" ? 630 : 81);
      const amount = Number(effectiveNode.collectionAmount) || 100;   // 本次 run 快照字段（已含深空适应缓释）
      let eff = 1;
      const isGas = n.subtype === "gas";
      try {
        eff = isGas ? (Number(getGasEfficiency(state)) || 1) : (Number(getMiningEfficiency(state)) || 1);
      } catch (_) { eff = 1; }
      const upgradeEff = 1 + 0.02 * upg("collectEff");
      eff *= upgradeEff;
      if (affix && affix.collectionEffMult) eff *= affix.collectionEffMult;
      if (!(eff > 0)) eff = 1;
      data.amount = Math.round(amount);
      data.eff = Math.round(eff * 10) / 10;
      // 有效节点已把采集升级折算进基准秒数；展示效率保留升级后的数值，但不能再次折算耗时。
      const required = Math.ceil(base * amount / (eff / upgradeEff));
      data.required = required;
      data.mat = isGas ? (((REW.collection.byKind || {}).gas || {})[ring]) || "泰坦材料"
                        : (((REW.collection.byKind || {}).ore || {})[ring]) || "泰坦材料";
      data.qty = (REW.collection && REW.collection.qty && REW.collection.qty[ring]) || 0;
    } else if (n.type === "archaeology") {
      const spec = (REW.archaeology || {})[ring] || { tier: "iii", chance: 0.15 };
      let p = ({ outer: 0.75, middle: 0.70, inner: 0.62 })[ring] || 0.70;
      p += 0.015 * upg("archSuccess");
      const liveRun = state.wormhole && state.wormhole.run;
      const affixScale = liveRun && Number.isFinite(Number(liveRun.affixScale)) ? Number(liveRun.affixScale) : 1;
      if (affix && typeof affix.successDelta === "number") p += affix.successDelta * affixScale;
      data.chance = Math.round(Math.max(0.15, Math.min(0.95, p)) * 100);   // p 是分数：钳位 15%~95%（此前 15 当成百分比 → 显示 1500%）
      data.cycle = Math.round((Number(effectiveNode.archaeologyBaseCycleSeconds) || 10) * 10) / 10;
      data.target = Number(effectiveNode.archaeologyTargetProgress) || 14;
      data.interf = Math.round((Number(effectiveNode.archaeologyInterferenceSeconds) || 1.5) * 10) / 10;
      data.cycleFrac = (isCur && data.cycle > 0) ? ((t / 1000) % data.cycle) / data.cycle : 0;   // 本次扫描进度
      data.tier = String(spec.tier).toUpperCase();
      data.tierChance = Math.round(spec.chance * 100);
    }
    return data;
  }

  // —— 战斗 arena 渲染即校正（方案 A：借用正式战斗页 .combat-arena，唯一 DOM） ——
  // 判定与「进入战斗画面」按钮同口径：battle 节点 && 当前节点 && 未制压未跳过。
  function shouldMountWhArena(n, isCur, done, skip) {
    return !!(n && n.type === "battle" && isCur && !done && !skip);
  }
  // restore 先行（scaffold innerHTML 重建前必须归还，否则 canvas 连根销毁），mount 随后。
  function reconcileBattleArena(n, isCur, done, skip) {
    const api = (typeof window !== "undefined") ? window.STARMAP_BATTLE_ARENA : null;
    if (!api || typeof api.mountInto !== "function" || typeof api.restoreFrom !== "function") return false;
    const whSlot = document.getElementById("wormhole-room-arena-slot");
    const wantMount = shouldMountWhArena(n, isCur, done, skip);
    if (wantMount) {
      if (!whSlot) return false;
      const ok = api.mountInto(whSlot);
      if (ok) whSlot.style.display = "block";
      return ok;   // mount 失败时调用方保留「进入战斗画面」跳页兜底
    }
    // 不该挂：arena 若被虫洞槽位持有 → 归还（幂等；不在槽位时 no-op）
    const borrowed = whSlot && whSlot.querySelector(".combat-arena");
    if (borrowed) api.restoreFrom(whSlot);
    return false;
  }

  function renderWormholeNodeRoom(view, now) {
    const sec = document.getElementById("wormhole-node-room");
    if (!sec) return false;
    const t = now || Date.now();
    const state = (typeof gameState !== "undefined") ? gameState : null;
    const run = view && view.run;
    if (!state || !run || run.state !== "running") { sec.hidden = true; return false; }
    const daily = findDaily(state, run.dailyId);
    if (!daily) { sec.hidden = true; return false; }
    let focusId = selectedNodeId;
    let following = false;
    if (!roomClosed && (!focusId || run.cleared.indexOf(focusId) >= 0 || run.skipped.indexOf(focusId) >= 0)) {
      focusId = (run.phase === "node" && run.current) || (run.phase === "travel" && run.pendingId) || run.parkedAt || run.current || null;
      following = true;
      if (focusId) selectedNodeId = focusId;      // 跟随节点推进
    }
    const n = focusId ? daily.nodes.filter(q => q.id === focusId)[0] : null;
    if (!n) { sec.hidden = true; return false; }

    sec.hidden = false;
    const cleared = run.cleared || [], skipped = run.skipped || [];
    const isCur = run.current && n.id === run.current;
    const done = cleared.indexOf(n.id) >= 0 || n.kind === "entry";   // 入口无试炼：出发即制压
    const skip = skipped.indexOf(n.id) >= 0;
    const status = done ? "已制压" : (skip ? "已跳过" : (isCur ? "进行中" : "待挑战"));
    const D = roomData(state, daily, run, n, t);

    const title = document.getElementById("wormhole-room-title");
    const sub = document.getElementById("wormhole-room-subtitle");
    if (title) title.textContent = typeLabel(n) + " · " + ringLabel(n.ring) + (n.tier === "elite" ? " · 精英" : "");
    if (sub) sub.textContent = (following ? "【跟随远征 · 点地图其他节点可锁定查看】" : "") + "状态：" + status + (n.kind === "trial" ? "　·　已尝试 " + (run.attempt || 1) + " 次" : "") + (D.affix ? "　·　词条：" + D.affix.name : "");

    // 倒计时（星图同款大字胶囊）
    const cfgLim = (window.WORMHOLE_CONFIG && window.WORMHOLE_CONFIG.NODE_LIMIT_SECONDS) || 180;
    const cdEl = document.getElementById("wormhole-room-countdown");
    if (cdEl) {
      const secsLeft = Math.max(0, Math.ceil(((run.nextEventAt || t) - t) / 1000));
      if (run.phase === "travel" && run.pendingId === n.id) cdEl.textContent = "跃迁中：" + secsLeft + "s";
      else if (isCur) cdEl.textContent = "剩余时间：" + secsLeft + "s";
      else if (!done && !skip && run.phase === "idle") cdEl.textContent = "等待选路 · 节点时限 " + cfgLim + "s";
      else cdEl.textContent = "节点时限：" + cfgLim + "s";
    }

    // 动作按钮
    const act = document.getElementById("wormhole-room-action");
    if (act) {
      act.dataset.whAction = "";
      if (n.kind === "entry") { act.style.display = "none"; }
      else {
        act.style.display = "";
        const parkId = run.parkedAt || run.current;
        const parkNode = daily.nodes.filter(q => q.id === parkId)[0];
        const adjacent = !!(parkNode && (parkNode.links || []).indexOf(n.id) >= 0);
        let label = "开始试炼", gotoId = "", disabled = true;
        const isExit = n.kind === "exit";
        if (isExit) {
          // 出口：到达即通关（无待清）或途经停留（还有未清节点，可再返回）
          const remain = daily.nodes.some(m => (m.kind === "trial" || m.kind === "treasure") && cleared.indexOf(m.id) < 0 && skipped.indexOf(m.id) < 0);
          if (isCur) { label = "已抵达出口"; }
          else if (adjacent) { label = remain ? "前往出口（途经，可再返回）" : "前往出口 · 通关"; gotoId = n.id; disabled = false; }
          else label = "不相邻 · 需沿相邻节点前往";
        } else if (done && !isCur) { label = "已制压 ✓（可途经）"; gotoId = adjacent ? n.id : ""; disabled = !adjacent; }
        else if (skip && !isCur) { label = "已跳过（可途经）"; gotoId = adjacent ? n.id : ""; disabled = !adjacent; }
        else if (isCur && n.type === "battle") { label = "进入战斗画面"; disabled = false; act.dataset.whAction = "combat"; }
        else if (isCur) label = "试炼进行中…";
        else if (run.phase === "travel" && run.pendingId === n.id) label = "跃迁中…";
        else if (adjacent) { label = (n.kind === "treasure" ? "前往领取" : "前往并开始试炼"); gotoId = n.id; disabled = false; }
        else label = "不相邻 · 需沿相邻节点前往";
        act.disabled = disabled;
        act.textContent = label;
        act.dataset.whGoto = gotoId;
      }
    }

    // —— arena 渲染即校正：先归还（防 scaffold 重建连 canvas 销毁）→ 重建 → 后借用 ——
    const whWantMount = shouldMountWhArena(n, isCur, done, skip);
    if (!whWantMount) reconcileBattleArena(n, isCur, done, skip);

    // —— 脚手架：仅在切换节点时重建（保住 Ship3D 的 canvas / WebGL 上下文，防渲染帧中断）——
    const body = document.getElementById("wormhole-room-body");
    if (body && body.dataset.whScaffold !== n.id) {
      body.dataset.whScaffold = n.id;
      body.innerHTML = buildRoomScaffold(n, D);
      hydrateRoomStage(n, state);
    }
    let whArenaMounted = false;
    if (whWantMount) whArenaMounted = reconcileBattleArena(n, isCur, done, skip);   // mount（失败时保留跳页兜底）
    updateRoomLive(n, run, state, t, done, skip, D);   // 每 render：引擎真实数据

    const result = document.getElementById("wormhole-room-result");
    if (result) {
      const log = run.log || [];
      // 战报 reason 形如「启动失败:insufficient-probe」（wormhole.js:1089，半角冒号）→ 翻成玩家可读文案
      const logText = function (e) {
        if (!e) return "失败";
        if (e.ok) return "制压";
        if (e.reason === "skip") return "跳过";
        const raw = String(e.reason || "");
        const at = raw.indexOf("启动失败");
        if (at >= 0) return "启动失败：" + whReasonText(raw.slice(at + 4).replace(/^[\s:：]+/, ""));
        return whReasonText(raw);
      };
      result.innerHTML = log.length
        ? '<div style="margin-top:8px;font-size:12px;color:#8fa8c3">最近战报：' + log.slice(-8).map(logText).join(" · ") + '</div>'
        : '<div style="margin-top:8px;font-size:12px;color:#6f88a6">暂无战报。</div>';
    }
    return true;
  }

  function buildRoomScaffold(n, D) {
    if (n.kind === "entry" || n.kind === "exit") {
      return '<div class="starmap-production-intro">通道节点：不产生试炼，路过即通过。</div>';
    }
    if (n.kind === "treasure") {
      return '<div class="starmap-production-room" style="padding:10px">' +
        '<div class="starmap-production-kicker"><i class="fa-solid fa-treasure-chest"></i><span>宝藏节点</span></div>' +
        '<h4>无试炼 · 抵达即领</h4>' +
        '<div class="starmap-production-reward-head"><span>虫洞印记</span><strong>+5</strong></div></div>';
    }
    if (n.type === "battle") {
      return '<div class="starmap-battle-arena-slot" id="wormhole-room-arena-slot" style="min-height:0">' +
        '<div class="starmap-production-requirements" style="margin-top:8px">' +
        '<div class="wormhole-room-row"><span>敌人配置</span><strong>' + (D.elite ? "精英" : "常规") + ' · ' + ringLabel(n.ring) + '</strong></div>' +
        '<div class="wormhole-room-row"><span>击杀进度</span><strong id="wh-b-kills">0 / ' + D.enemyCount + '</strong></div>' +
        '<div class="wormhole-room-row"><span>预估胜率</span><strong>' + D.win + '%（真实战斗以实际舰船为准）</strong></div>' +
        '<div class="wormhole-room-row"><span>时限</span><strong>' + D.limit + 's</strong></div>' +
        '<div class="wormhole-room-row"><span>胜利奖励</span><strong>星币 ' + Number(D.isk || 0).toLocaleString() + '</strong></div>' +
        '<div class="wormhole-room-row"><span>附加</span><strong>货柜 / 许可 各 50% ×1</strong></div>' +
        '</div></div>' +
        '<div class="text-muted" style="font-size:11.5px;margin-top:6px">点击「进入战斗画面」上真舰开打；离线时由离线战斗自动补算。</div>';
    }
    if (n.type === "collection") {
      return '<div class="starmap-collection-room">' +
        '<div class="starmap-collection-stage">' +
        '<div class="starmap-collection-ship"><canvas id="wh-room-ship-3d" class="ship3d-canvas" aria-label="Industrial ship"></canvas><span id="wh-room-ship-label" class="starmap-collection-label"></span></div>' +
        '<div id="wh-room-beams" class="starmap-collection-beams" aria-hidden="true"></div>' +
        '<div id="wh-room-resource-card" class="mining-target-card selected starmap-resource-card"></div>' +
        '</div>' +
        '<div class="starmap-collection-counter"><strong id="wh-c-collected">' + D.amount + ' / ' + D.amount + '</strong>' +
        '<span>待采集</span><span class="starmap-trial-efficiency">采集效率：' + D.eff + '</span></div>' +
        '<div class="starmap-collection-progress"><canvas id="wh-room-mining-bar" class="skill-canvas-bar" width="560" height="24"></canvas>' +
        '<span class="mp-eta" id="wh-c-eta"></span></div>' +
        '<div class="starmap-production-requirements" style="margin-top:8px">' +
        '<div class="wormhole-room-row"><span>产出材料</span><strong>' + D.mat + ' ×' + D.amount + '</strong></div>' +
        '<div class="wormhole-room-row"><span>需求产量</span><strong>' + D.amount + '</strong></div>' +
        '<div class="wormhole-room-row"><span>时限</span><strong>' + D.limit + 's（需 ' + D.required + 's）</strong></div>' +
        '</div></div>';
    }
    if (n.type === "archaeology") {
      return '<div class="starmap-archaeology-room">' +
        '<div class="starmap-archaeology-stage">' +
        '<div class="starmap-archaeology-ship-card">' +
        '<canvas id="wh-arch-ship-3d" class="ship3d-canvas" aria-label="Archaeology ship"></canvas>' +
        '<span id="wh-arch-ship-label" class="starmap-archaeology-ship-label">未指派考古舰</span>' +
        '<div class="starmap-archaeology-hp" id="wh-arch-hp"></div>' +
        '</div>' +
        '<div class="starmap-archaeology-console">' +
        '<div class="starmap-scan-visual" id="wh-a-scan"><i></i><i></i><i></i><span><i class="fa-solid fa-satellite-dish"></i></span></div>' +
        '<div class="starmap-archaeology-progress-copy"><strong id="wh-a-prog">0 / ' + D.target + '</strong><span>扫描进度</span></div>' +
        '<div class="starmap-archaeology-progress-track"><div id="wh-a-fill" style="height:100%;width:0%"></div></div>' +
        '<div class="starmap-archaeology-cycle-copy"><span>本次扫描</span><strong id="wh-a-cycpct">0%</strong></div>' +
        '<div class="starmap-archaeology-cycle-track"><div id="wh-a-cyclefill" style="height:100%;width:0%"></div></div>' +
        '<div class="starmap-archaeology-stats">' +
        '<div><span>扫描成功率</span><strong id="wh-a-chance">' + D.chance + '%</strong></div>' +
        '<div><span>扫描周期</span><strong id="wh-a-cycle">' + D.cycle + 's</strong></div>' +
        '<div><span>干扰</span><strong>' + D.interf + 's</strong></div>' +
        '<div><span>产出</span><strong>校准基体 ' + D.tier + ' 型 ×1（' + D.tierChance + '%）</strong></div>' +
        '</div>' +
        '<div class="wormhole-room-supply" id="wh-a-supply">' +
        '<div class="wormhole-room-row"><span>消耗 · 探针</span><strong id="wh-a-probe-stock">—</strong></div>' +
        '<div class="wormhole-room-row"><span>消耗 · 燃料</span><strong id="wh-a-fuel-stock">—</strong></div>' +
        '<div class="wormhole-room-row"><span>切换探针</span><select id="wh-arch-probe" class="wh-probe-select" aria-label="选择探针"></select></div>' +
        '<div class="wh-supply-warn" id="wh-a-warn" hidden></div>' +
        '</div>' +
        '</div></div></div></div>';
    }
    return '<div class="starmap-production-intro">—</div>';
  }

  // 3D 舰 / 光束 / 资源卡 / 考古舰（脚手架重建时执行一次；canvas 跨渲染复用，WebGL 上下文不泄漏）
  function hydrateRoomStage(n, state) {
    if (n.type === "collection") {
      const isGas = n.subtype === "gas";
      const actionKey = isGas ? "gasHarvesting" : "mining";
      const rc = document.getElementById("wh-room-resource-card");
      if (rc) rc.innerHTML = '<span class="mining-target-name">' + (n.collectionResource || "泰坦材料") + '</span><span class="mining-target-visual"><i class="fa-solid ' + (isGas ? "fa-cloud" : "fa-gem") + '"></i></span><span class="mining-target-meta">' + (isGas ? "采气" : "采矿") + ' · 泰坦专属材料</span><span class="mining-target-sub" id="wh-c-cardsub">0 / ' + (Number(n.collectionAmount) || 0) + '</span>';
      let assigned = (typeof getAssignedShipInstance === "function") ? getAssignedShipInstance(actionKey) : null;
      if (!assigned && typeof getAssignedShipInstance === "function") assigned = getAssignedShipInstance(actionKey === "mining" ? "gasHarvesting" : "mining");
      if (!assigned && gameState.inventory && Array.isArray(gameState.inventory.ships) && typeof getShipConfigById === "function") {
        assigned = gameState.inventory.ships.find(function (ship) {
          const cfg = getShipConfigById(ship.shipId);
          return cfg && (typeof getShipAssemblyLine !== "function" || getShipAssemblyLine(ship.shipId) === "industrial");
        }) || gameState.inventory.ships.find(function (ship) { return getShipConfigById(ship.shipId); }) || null;
      }
      const shipLabel = document.getElementById("wh-room-ship-label");
      if (shipLabel) shipLabel.textContent = assigned && typeof getShipConfigById === "function" ? ((getShipConfigById(assigned.shipId) || {}).name || "工业舰") : "未找到工业舰";
      const beams = document.getElementById("wh-room-beams");
      if (beams) {
        let beamCount = 1;
        try { const d = getProductionEfficiencyState(gameState, actionKey); beamCount = Math.max(1, (d.equipment || []).filter(e => e.slot === "high").length); } catch (_) {}
        beams.innerHTML = Array.from({ length: beamCount }, (_, i) => '<i style="--beam-index:' + i + ';--beam-count:' + beamCount + '"></i>').join("");
      }
      mountRoomShip3d("wh-room-ship-3d", assigned);
    } else if (n.type === "archaeology") {
      const instanceId = gameState.shipAssignments && gameState.shipAssignments.archaeology;
      const assigned = instanceId && (typeof getShipInstanceFromState === "function") ? getShipInstanceFromState(gameState, instanceId) : null;
      const shipCfg = assigned && (typeof getShipConfigById === "function") ? getShipConfigById(assigned.shipId) : null;
      const aLabel = document.getElementById("wh-arch-ship-label");
      if (aLabel) aLabel.textContent = shipCfg && shipCfg.name ? shipCfg.name : "未指派考古舰";
      const hpHost = document.getElementById("wh-arch-hp");
      if (hpHost) {
        const maxHp = shipCfg && shipCfg.hp ? shipCfg.hp : { shield: 0, armor: 0, structure: 0 };
        hpHost.innerHTML = [{ key: "shield", label: "护盾" }, { key: "armor", label: "装甲" }, { key: "structure", label: "结构" }].map(function (part) {
          const maximum = Math.max(0, Number(maxHp[part.key]) || 0);
          return '<div class="starmap-archaeology-hp-row ' + part.key + '"><span>' + part.label + '</span><strong>' + maximum + ' / ' + maximum + '</strong></div>';
        }).join("");
      }
      mountRoomShip3d("wh-arch-ship-3d", assigned);
      // 房间内直接切换激活探针：走与考古页同一 action（archaeology/selectProbe），不另写第二套校验。
      const probeSel = document.getElementById("wh-arch-probe");
      if (probeSel && !probeSel.dataset.whBound) {
        probeSel.dataset.whBound = "1";
        probeSel.addEventListener("change", function () {
          if (typeof dispatchGameAction !== "function") return;
          try { dispatchGameAction(gameState, { type: "archaeology/selectProbe", probeId: probeSel.value }, Date.now()); } catch (_) {}
        });
      }
    }
  }

  function mountRoomShip3d(canvasId, assigned) {
    if (!assigned || !window.Ship3D || typeof window.Ship3D.buildSpecForShip !== "function" || typeof window.Ship3D.ensureViewer !== "function" || typeof window.Ship3D.setShips !== "function") return;
    const cv = document.getElementById(canvasId);
    if (!cv) return;
    try {
      const viewer = window.Ship3D.ensureViewer(cv, { orbit: false, autoSpin: false, background: 0x07111b });
      window.Ship3D.setShips(viewer, [{ spec: window.Ship3D.buildSpecForShip(assigned.shipId), position: [0, 0, 0], scale: 1, rotation: [0, 0, 0], sway: true }]);
    } catch (_) {}
  }

  // —— 试炼启动失败原因 → 玩家可读文案（与 selectors.js:1142 blockedText 同口径） ——
  const WH_REASON_TEXT = {
    "insufficient-probe": "探针不足",
    "insufficient-fuel": "燃料不足",
    "no-archaeology-ship": "未指派考古舰",
    "no-combat-ship": "未指派出战舰",
    "no-weapons": "未装备武器",
    "no-collection-efficiency": "采集效率为 0",
    "insufficient-production-materials": "材料不足",
    "starmap-trial-running": "已有试炼进行中",
    "starmap-trial-completed": "该节点已完成",
    "player-action-running": "正在执行其他行动",
    "repairing": "舰船维修中",
    "skip": "已跳过"
  };
  function whReasonText(reason) {
    const r = String(reason == null ? "" : reason);
    if (!r) return "失败";
    if (WH_REASON_TEXT[r]) return WH_REASON_TEXT[r];
    if (r.indexOf("invalid-") === 0) return "节点配置异常";
    return r;
  }

  // —— 考古战备读数：与 canStartArchaeologyTrial 同字段构造（只读取展示，不参与判定） ——
  // site / ship 的构造必须与 legion-starmap-trial.js:1547-1557 一致，否则读数与真实校验会漂移。
  function whArchSite(node) {
    if (!node || node.type !== "archaeology" || !node.archaeologySiteId || typeof getArchaeologySite !== "function") return null;
    const base = getArchaeologySite(node.archaeologySiteId);
    if (!base) return null;
    return Object.assign({}, base, {
      difficulty: Number(node.archaeologyDifficulty) || Number(base.difficulty) || 121,
      time: Number(node.archaeologyBaseCycleSeconds) || 10
    });
  }
  function whArchShip(state) {
    const id = state && state.shipAssignments && state.shipAssignments.archaeology;
    if (!id || typeof getShipInstanceFromState !== "function") return null;
    try { return getShipInstanceFromState(state, id); } catch (_) { return null; }
  }
  function whArchConsumables(state, node, now) {
    const probeId = (state && state.archaeology && state.archaeology.activeProbeId) || "core_probe_i";
    const RR = (typeof ResourceRegistry !== "undefined") ? ResourceRegistry : window.ResourceRegistry;
    const have = (key) => (RR && typeof RR.get === "function") ? (Number(RR.get(state, key)) || 0) : 0;
    const def = (typeof getArchaeologyProbe === "function") ? getArchaeologyProbe(probeId) : null;
    const site = whArchSite(node);
    const ship = whArchShip(state);
    let fuelNeed = 0;
    if (site && ship && typeof getArchaeologyFuelCostState === "function") {
      try { fuelNeed = Number(getArchaeologyFuelCostState(state, site, ship).chargedFuel) || 0; } catch (_) { fuelNeed = 0; }
    }
    let rows = [];
    try {
      const d = (typeof getArchaeologyDisplayState === "function") ? getArchaeologyDisplayState(state, now, { skipShipHp: true }) : null;
      rows = (d && Array.isArray(d.probes)) ? d.probes : [];
    } catch (_) { rows = []; }
    return {
      probeId: probeId,
      probeName: (def && def.name) || probeId,
      probeStock: have("probe:" + probeId),
      fuelHave: have("consumable:fuel"),
      fuelNeed: fuelNeed,
      shipOk: !!ship,
      rows: rows
    };
  }

  // 实时值：全部读引擎试炼状态（不再用假插值）
  function updateRoomLive(n, run, state, t, done, skip, D) {
    if (n.kind !== "trial") return;
    const T = window.LEGION_STARMAP_TRIAL;
    const trs = T && T.getTrialStates ? T.getTrialStates(state) : null;
    const trial = trs && (n.type === "battle" ? trs.battle : n.type === "archaeology" ? trs.archaeology : trs.collection);
    const live = trial && trial.nodeId === String(n.id) && trial.status === "running" ? trial : null;
    const isCur = run.current && n.id === run.current;
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setW = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, Math.round(pct))) + "%"; };

    if (n.type === "collection") {
      // ★ 与星图 renderStarmapTrialRoom 完全同口径：
      //   采集条（skill-canvas-bar）= 当前这一单位的采集动作进度（cyclePct），不是整个试炼的进度；
      //   计数器 = 待采集余量（100/100 → 0/100）。
      const amount = Number(D && D.amount) || Number(n.collectionAmount) || 100;
      let shown = 0;
      if (done) shown = amount;
      else if (live) shown = Math.min(amount, Math.floor(Number(live.gathered) || 0));
      const required = Number((live && live.requiredSeconds) || (D && D.required) || D0_required_num(n, state));
      const cycle = required > 0 && amount > 0 ? required / amount : 0;
      const elapsed = isCur && run.currentStartedAt ? Math.max(0, (t - run.currentStartedAt) / 1000) : (done ? required : 0);
      const cycleElapsed = cycle > 0 ? Math.min(cycle, Math.max(0, elapsed - shown * cycle)) : 0;
      const cyclePct = done ? 100 : (cycle > 0 ? cycleElapsed / cycle * 100 : 0);
      setText("wh-c-collected", (amount - shown) + " / " + amount);   // 星图样式：待采集余量 100/100 → 0/100
      const bar = document.getElementById("wh-room-mining-bar");
      if (bar && typeof drawSkillBar === "function") { try { drawSkillBar(bar, cyclePct, "green"); } catch (_) {} }
      const cardsub = document.getElementById("wh-c-cardsub");
      if (cardsub) cardsub.textContent = (amount - shown) + " / " + amount;
      const eta = document.getElementById("wh-c-eta");
      if (eta) eta.textContent = done ? "已完成" : (skip ? "已跳过" : (live && cycle > 0 ? Math.max(0, cycle - cycleElapsed).toFixed(1) + "s" : ""));
    } else if (n.type === "archaeology") {
      const target = Number(D && D.target) || Number(n.archaeologyTargetProgress) || 14;
      let prog = done ? target : 0;
      if (live) prog = Math.min(target, Number(live.progress) || 0);
      setText("wh-a-prog", (done ? target : Math.floor(prog)) + " / " + target);
      setW("wh-a-fill", target > 0 ? prog / target * 100 : 0);
      let cyclePct = 0;
      if (live && Number(live.cycleSeconds) > 0 && Number(live.nextScanAt) > 0) {
        cyclePct = Math.max(0, Math.min(1, 1 - (Number(live.nextScanAt) - t) / 1000 / Number(live.cycleSeconds)));
      }
      setText("wh-a-cycpct", Math.round(cyclePct * 100) + "%");
      setW("wh-a-cyclefill", cyclePct * 100);
      const scan = document.getElementById("wh-a-scan");
      if (scan) scan.classList.toggle("is-running", !!live);
      if (live && Number(live.successChance) > 0) setText("wh-a-chance", Math.round(Number(live.successChance) * 100) + "%");
      if (live && Number(live.cycleSeconds) > 0) setText("wh-a-cycle", Math.round(Number(live.cycleSeconds) * 10) / 10 + "s");
      updateRoomSupply(n, state, t, !!live);
    } else if (n.type === "battle") {
      const enemy = Number((live && live.enemyCount) || (D && D.enemyCount) || n.battleTrialEnemyCount) || 0;
      const kills = live ? Math.min(enemy, Number(live.kills) || 0) : (done ? enemy : 0);
      setText("wh-b-kills", kills + " / " + enemy);
    }
  }
  // 考古房间的消耗品读数 + 探针选择 + 缺料提示：
  // 数据全部来自 whArchConsumables（与 canStartArchaeologyTrial 同字段），只展示、不重建判定。
  function updateRoomSupply(n, state, t, running) {
    if (!n || n.type !== "archaeology") return;
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const C = whArchConsumables(state, n, t);
    const stock = Math.floor(Number(C.probeStock) || 0);
    const need = Math.ceil(Number(C.fuelNeed) || 0);
    const have = Math.floor(Number(C.fuelHave) || 0);
    setTxt("wh-a-probe-stock", esc(C.probeName) + " ×" + stock);
    // 未指派考古舰时算不出燃料需求（与 canStartArchaeologyTrial「先判船、再查燃料」同序），显示「—」避免误导成 0
    setTxt("wh-a-fuel-stock", have + " / " + (C.shipOk ? String(need) : "—"));

    const sel = document.getElementById("wh-arch-probe");
    if (sel) {
      const options = C.rows.map(function (row) {
        const locked = !!row.levelLocked;
        const empty = !(Number(row.stock) > 0);
        return {
          value: row.id,
          label: String(row.name || row.id) + " ×" + Math.floor(Number(row.stock) || 0) + (locked ? " · 等级不足" : (empty ? " · 无库存" : "")),
          disabled: locked
        };
      });
      // 签名比对：库存/激活项没变就不重建 option，避免打断用户正在展开的下拉
      const sig = JSON.stringify(options) + "|" + String(C.probeId) + "|" + (running ? "1" : "0");
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig;
        sel.replaceChildren();
        options.forEach(function (o) {
          const opt = document.createElement("option");
          opt.value = o.value; opt.textContent = o.label; opt.disabled = o.disabled;
          sel.appendChild(opt);
        });
        sel.value = String(C.probeId);
      }
      sel.disabled = !!running;   // 试炼进行中锁定，与考古页同口径
    }

    const warn = document.getElementById("wh-a-warn");
    if (warn) {
      const msgs = [];
      if (!C.shipOk) msgs.push("未指派考古舰：请在舰队岗位指派一艘考古舰。");
      if (!(stock > 0)) msgs.push("当前激活探针「" + esc(C.probeName) + "」库存为 0：请补充库存，或用上方「切换探针」改用其他探针。");
      if (need > 0 && have < need) msgs.push("燃料不足：本次需要 " + need + "，当前 " + have + "。");
      const sig = msgs.join("|");
      if (warn.dataset.sig !== sig) {
        warn.dataset.sig = sig;
        warn.innerHTML = msgs.length ? msgs.map(function (m) { return "<div>" + m + "</div>"; }).join("") : "";
      }
      warn.hidden = msgs.length === 0;
    }
  }

  function D0_required_num(n, state) {
    const base = Number(n.collectionBaseSecondsPerUnit) || (n.ring === "inner" ? 630 : 81);
    const eff = (n.subtype === "gas" ? (typeof getGasEfficiency === "function" ? Number(getGasEfficiency(state)) || 1 : 1) : (typeof getMiningEfficiency === "function" ? Number(getMiningEfficiency(state)) || 1 : 1));
    return Math.ceil(base * (Number(n.collectionAmount) || 100) / (eff > 0 ? eff : 1));
  }
  function D0_required(n, state) {
    const base = Number(n.collectionBaseSecondsPerUnit) || (n.ring === "inner" ? 630 : 81);
    const eff = (n.subtype === "gas" ? (typeof getGasEfficiency === "function" ? Number(getGasEfficiency(state)) || 1 : 1) : (typeof getMiningEfficiency === "function" ? Number(getMiningEfficiency(state)) || 1 : 1));
    return Math.ceil(base * (Number(n.collectionAmount) || 10) / (eff > 0 ? eff : 1)) + "s";
  }

  window.WORMHOLE_DEBUG = {
    map: function () {
      const st = (typeof gameState !== "undefined") ? gameState : null;
      const Wst = st && st.wormhole;
      const run = Wst && Wst.run;
      const daily = run ? (Wst.dailies || []).filter(d => d.id === run.dailyId)[0] : null;
      return {
        hasRun: !!run, runState: run && run.state, phase: run && run.phase,
        control: Wst && Wst.control, cleared: run && run.cleared, skipped: run && run.skipped,
        current: run && run.current, parkedAt: run && run.parkedAt,
        dailyId: run && run.dailyId, dailyFound: !!daily,
        nodeIds: daily ? daily.nodes.map(n => n.id) : [],
        polyCounts: daily ? daily.nodes.map(n => (n.poly || []).length) : [],
        mapWrapVisible: (document.getElementById("wh-map-wrap") || {}).style || {}
      };
    }
  };

  window.renderWormholeMap = renderWormholeMap;
  window.renderWormholeNodeRoom = renderWormholeNodeRoom;
  window.setWormholeSelectedNode = function (id) { selectedNodeId = id; };
  window.closeWormholeNodeRoom = function () { selectedNodeId = null; roomClosed = true; };
})();
