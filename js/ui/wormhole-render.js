/* ================================================================
   虫洞界面渲染（Phase 2）
   ----------------------------------------------------------------
   - 页面路由：data-page="wormhole" → wormhole-panel（selectors.standalonePages）
   - 渲染入口 renderWormholePage()，由 shell-render 的页面分支调用
   - 事件：面板内事件委托，动作统一走 dispatchGameAction("wormhole/*")
   - 主线门禁动态同步：监听星图 iframe 的 final-node 消息
   ================================================================ */
(() => {
  "use strict";

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + "h" + String(m).padStart(2, "0") + "m" : (m > 0 ? m + "m" + String(s).padStart(2, "0") + "s" : s + "s");
  }
  function fmtNum(n) { return Math.floor(Number(n) || 0).toLocaleString(); }

  /* ---------------- 主线门禁动态同步 ---------------- */
  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "legion-starmap/final-node" && event.data.id != null) {
      window.LEGION_STARMAP_FINAL_ID = String(event.data.id);
    }
  });

  // 主线门禁 final 节点 id 同步：星图 iframe（同源）加载后直读其渲染模型。
  // legion-starmap-pure-content.js 为只读文件，不在其内部发消息；此处主动拉取。
  // 跨域/加载失败时回退 systems/wormhole.js 的常量（当前星图布局末位）。
  function syncFinalNodeIdFromFrame() {
    try {
      const frame = document.getElementById("legion-starmap-frame");
      const model = frame && frame.contentWindow && frame.contentWindow.LEGION_STARMAP_RENDER_MODEL;
      if (model && Array.isArray(model.nodes)) {
        const fin = model.nodes.find(n => n.type === "final");
        if (fin && fin.id != null) window.LEGION_STARMAP_FINAL_ID = String(fin.id);
      }
    } catch (_) { /* 跨域或尚未就绪：回退常量 */ }
  }
  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "legion-starmap/ready") syncFinalNodeIdFromFrame();
  });

  /* ---------------- 渲染入口 ---------------- */
  function renderWormholePage() {
    if (typeof WORMHOLE === "undefined" || !window.gameState) return;
    try { WORMHOLE.tickWormhole(gameState, Date.now()); } catch (_) { /* 渲染不阻断 */ }
    const view = WORMHOLE.getWormholeView(gameState, Date.now());
    if (!view) return;
    renderHeader(view);
    renderRunCard(view);
    try { if (typeof window.renderWormholeMap === "function") window.renderWormholeMap(view, Date.now()); } catch (_) {}
    try { if (typeof window.renderWormholeNodeRoom === "function") window.renderWormholeNodeRoom(view, Date.now()); } catch (_) {}
    try { renderManualHint(view); } catch (_) {}
    syncWormholeReturnButton(view);
    renderDailies(view);
    renderHistory(view);
    renderShop(view);
  }

  function renderHeader(view) {
    const t = el("wh-token-balance");
    if (t) t.textContent = "虫洞印记：" + fmtNum(view.tokens) + "　·　下次刷新：" + new Date(view.nextRefreshAt).toLocaleString();
  }

  /* ---------------- 进行中的远征 ---------------- */
  function renderRunCard(view) {
    const box = el("wh-run-card");
    if (!box) return;
    if (!view.run) { box.innerHTML = ""; box.style.display = "none"; return; }
    box.style.display = "";
    const r = view.run;
    if (r.state !== "running") return renderRunResult(box, r);
    const left = Math.max(0, Math.floor((r.endsAt - Date.now()) / 1000));
    const phaseText = { travel: "跃迁中", node: "节点挑战中" }[r.phase] || r.phase;
    box.innerHTML =
      '<div style="border:1px solid #7a5cff66;border-radius:10px;padding:12px 14px;margin-bottom:12px;background:linear-gradient(135deg,#150f28,#0a0a1c)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
      '<div><b style="color:#c9a0ff">远征进行中</b>　模式：' + (r.mode === "rush" ? "直冲" : "遍历") +
      '　选路：' + (r.control === "manual" ? '<span style="color:#7fd8c0">手动（点地图相邻节点）</span>' : '<span style="color:#7fb4dd">自动</span>') +
      '　<button type="button" class="btn secondary" data-wh-control="' + (r.control === "manual" ? "auto" : "manual") + '">' +
      (r.control === "manual" ? "切换为自动推进" : "切换为手动选路") + '</button>' +
      '　阶段：' + phaseText + '　剩余时限：' + fmtDur(left) + '</div>' +
      '<button type="button" class="btn secondary" data-wh-abandon="1">放弃远征</button></div>' +
      '<div style="margin-top:6px;color:#8fa8c3;font-size:12px">已制压 ' + r.summary.cleared +
      ' · 跳过 ' + r.summary.skipped + ' · 重试 ' + r.summary.retried +
      ' · 星币 +' + fmtNum(r.summary.isk) + ' · 泰坦 +' + fmtNum(r.summary.titan) +
      ' · 文物 +' + fmtNum(r.summary.relics) + ' · 印记 +' + fmtNum(r.summary.tokens) + '</div>' +
      '<div style="margin-top:4px;font-size:12px;color:#6f88a6">关闭游戏后远征照常推进，回来自动结算。</div>' +
      '</div>';
  }

  // 已结束远征的结果卡片（关闭后从 state 移除，历史与奖励不受影响）
  function renderRunResult(box, r) {
    const name = { completed: "通关", failed: "超时", aborted: "放弃" }[r.state] || r.state;
    box.innerHTML =
      '<div style="border:1px solid #4a5c7a;border-radius:10px;padding:12px 14px;margin-bottom:12px;background:linear-gradient(135deg,#12161f,#0a0a12)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
      '<div><b style="color:#9fc4e0">远征结束 · ' + name + '</b>' +
      '　<span style="color:#7f97b3;font-size:12px">模式：' + (r.mode === "rush" ? "直冲" : "遍历") + '</span></div>' +
      '<button type="button" class="btn secondary" data-wh-dismiss="1">关闭</button></div>' +
      '<div style="margin-top:6px;color:#8fa8c3;font-size:12px">已制压 ' + r.summary.cleared +
      ' · 跳过 ' + r.summary.skipped + ' · 星币 +' + fmtNum(r.summary.isk) +
      ' · 泰坦 +' + fmtNum(r.summary.titan) + ' · 文物 +' + fmtNum(r.summary.relics) +
      ' · 印记 +' + fmtNum(r.summary.tokens) + '</div></div>';
  }

  // 手动选路等待提示
  function renderManualHint(view) {
    const hint = document.getElementById("wh-manual-hint");
    if (!hint) return;
    const run = view && view.run;
    if (!run || run.state !== "running" || run.control !== "manual" || run.phase !== "idle") {
      hint.style.display = "none";
      return;
    }
    hint.style.display = "";
    hint.textContent = "等待选路：在地图上点击当前节点的相邻节点，前往下一个试炼（离线时手动模式不推进）。";
  }

  // 星图面板上的「返回远征」按钮：远征进行中才出现（从任何页面回到远征视图）
  function syncWormholeReturnButton(view) {
    const btn = document.getElementById("starmap-wormhole-return");
    if (!btn) return;
    const running = !!(view && view.run && view.run.state === "running");
    btn.style.display = running ? "" : "none";
  }

  /* ---------------- 每日虫洞卡片 ---------------- */
  function renderDailies(view) {
    const box = el("wh-dailies");
    if (!box) return;
    if (!view.unlocked) {
      box.innerHTML = '<div style="color:#8fa8c3;padding:10px 0">虫洞裂隙尚未显现 —— 制压星图主线（先驱文明核心）后开启。</div>';
      return;
    }
    const runActive = !!(view.run && view.run.state === "running");
    const countsByDaily = (window.WORMHOLE && typeof window.WORMHOLE.getDailyNodeCounts === "function")
      ? window.WORMHOLE.getDailyNodeCounts(gameState) : {};
    const html = view.dailies.map(d => {
      const affix = (window.WORMHOLE_AFFIXES || []).find(a => a.id === d.affixId);
      const counts = countsByDaily[d.id] || { battle: "?", collection: "?", archaeology: "?" };
      const disabled = runActive || d.status !== "available";
      const statusText = { available: "待探索", running: "远征中", completed: "已通关", failed: "已超时", aborted: "已放弃" }[d.status] || d.status;
      return (
        '<div style="border:1px solid #2a3d5c;border-radius:10px;padding:12px 14px;margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<div><b style="color:#c9a0ff;font-size:14px">' + esc((window.WORMHOLE_CONFIG && window.WORMHOLE_CONFIG.SIZE_NAMES && window.WORMHOLE_CONFIG.SIZE_NAMES[d.size]) || (d.size + " 节点虫洞")) + '</b>' +
        '<span style="color:#7f97b3;font-size:12px">　' + esc(d.size) + ' 节点虫洞</span>' +
        '　<span style="color:#8fa8c3;font-size:12px">战斗 ' + counts.battle + (counts.battleElite ? ' · 精英 ' + counts.battleElite : '') + ' / 采集 ' + counts.collection + ' / 考古 ' + counts.archaeology +
        ' · 宝藏 ' + d.treasureCount + '</span></div>' +
        '<span style="color:#7f97b3;font-size:12px">' + statusText + '</span></div>' +
        (affix ? '<div style="margin-top:6px;font-size:12px"><span style="color:#ff9ab5">负面词条 · ' + esc(affix.name) + '</span>　<span style="color:#b58ea0">' + esc(affix.desc) + '</span></div>' : '') +
        '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<select data-wh-mode="' + esc(d.id) + '" style="background:#0e2033;color:#c7d8ef;border:1px solid #23415e;border-radius:6px;padding:4px 6px;font-size:12px"' + (disabled ? " disabled" : "") + '>' +
        '<option value="full">遍历（全清）</option><option value="rush">直冲终点</option></select>' +
        '<label style="color:#7f97b3;font-size:12px">失败重试</label>' +
        '<input data-wh-retry="' + esc(d.id) + '" type="number" min="0" max="99" value="2" style="width:56px;background:#0e2033;color:#c7d8ef;border:1px solid #23415e;border-radius:6px;padding:4px 6px;font-size:12px"' + (disabled ? " disabled" : "") + '/>' +
        '<button type="button" class="btn primary" data-wh-start="' + esc(d.id) + '"' + (disabled ? " disabled" : "") + '>出发</button>' +
        '</div></div>'
      );
    }).join("");
    box.innerHTML = html;
  }

  /* ---------------- 历史 ---------------- */
  function renderHistory(view) {
    const box = el("wh-history");
    if (!box) return;
    if (!view.history.length) { box.innerHTML = '<div style="color:#6f88a6;font-size:12px">暂无远征记录。</div>'; return; }
    box.innerHTML = '<h3 style="font-size:13px;color:#8fb4dd;margin:12px 0 6px">最近远征</h3>' +
      view.history.map(hItem => {
        const name = { completed: "通关", failed: "超时", aborted: "放弃" }[hItem.state] || hItem.state;
        return '<div style="font-size:12px;color:#93aecb;border-bottom:1px solid #10202f;padding:3px 0">' +
          new Date(hItem.at).toLocaleString() + ' · ' + name + ' · 制压 ' + hItem.summary.cleared +
          ' · 印记 +' + fmtNum(hItem.summary.tokens) + '</div>';
      }).join("");
  }

  /* ---------------- 商店 ---------------- */
  function shopSectionsHtml(view) {
    const S = window.WORMHOLE_SHOP;
    if (!S) return "";
    const buyUpg = id => '<button type="button" class="btn primary" data-wh-buy-upgrade="' + esc(id) + '">购买</button>';
    const buyItem = id => '<button type="button" class="btn" data-wh-buy-item="' + esc(id) + '">购买</button>';
    const buyGoods = (id, param) => '<button type="button" class="btn" data-wh-buy-goods="' + esc(id) + '"' + (param ? ' data-wh-param="' + esc(param) + '"' : '') + '>购买</button>';

    let html = '<h3 style="font-size:13px;color:#8fb4dd;margin:4px 0 6px">永久升级（虫洞内生效）</h3>';
    html += Object.keys(S.upgrades).map(id => {
      const u = S.upgrades[id];
      const lv = view.upgrades[id] || 0;
      const maxed = lv >= u.max;
      const price = u.base + u.inc * lv;
      return '<div style="display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #10202f;padding:6px 0;font-size:12px">' +
        '<div><b style="color:#c7d8ef">' + esc(u.name) + '</b> <span style="color:#7f97b3">Lv.' + lv + '/' + u.max + '</span><br><span style="color:#8fa8c3">' + esc(u.desc) + '</span></div>' +
        '<div style="white-space:nowrap;text-align:right">' + (maxed ? '<span style="color:#7fd8c0">已满级</span>' : '<span style="color:#f0c674">' + fmtNum(price) + ' 印记</span><br>' + buyUpg(id)) + '</div></div>';
    }).join("");

    html += '<h3 style="font-size:13px;color:#8fb4dd;margin:14px 0 6px">战略道具</h3>';
    html += Object.keys(S.items).map(id => {
      const it = S.items[id];
      return '<div style="display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #10202f;padding:6px 0;font-size:12px">' +
        '<div><b style="color:#c7d8ef">' + esc(it.name) + '</b><br><span style="color:#8fa8c3">' + esc(it.desc) + '</span></div>' +
        '<div style="white-space:nowrap;text-align:right"><span style="color:#f0c674">' + fmtNum(it.price) + ' 印记</span><br>' + buyItem(id) + '</div></div>';
    }).join("");

    html += '<h3 style="font-size:13px;color:#8fb4dd;margin:14px 0 6px">物资兑换</h3>';
    html += Object.keys(S.goods).map(id => {
      const g = S.goods[id];
      let priceHtml;
      if (g.byTier) priceHtml = Object.keys(g.byTier).map(t => buyGoods(id, t) + ' <span style="color:#f0c674">' + t + ' ' + fmtNum(g.byTier[t]) + '</span>').join('　');
      else if (g.byId) priceHtml = Object.keys(g.byId).map(n => buyGoods(id, n) + ' <span style="color:#f0c674">' + esc(n) + ' ' + fmtNum(g.byId[n]) + '</span>').join('　');
      else if (g.options) priceHtml = g.options.map(n => buyGoods(id, n) + ' <span style="color:#f0c674">' + esc(n.replace("空间站", "").replace("深层舰船数据", "")) + ' ' + fmtNum(g.price) + '</span>').join('　');
      else priceHtml = '<span style="color:#f0c674">' + fmtNum(g.price) + ' 印记</span> ' + buyGoods(id);
      const owned = g.once && view.owned && view.owned[id];
      return '<div style="display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #10202f;padding:6px 0;font-size:12px">' +
        '<div><b style="color:#c7d8ef">' + esc(g.name) + '</b></div>' +
        '<div style="white-space:nowrap;text-align:right">' + (owned ? '<span style="color:#7fd8c0">已拥有</span>' : priceHtml) + '</div></div>';
    }).join("");

    return html;
  }
  function renderShop(view) {
    const box = el("wh-shop");
    if (!box) return;
    box.innerHTML = shopSectionsHtml(view);
  }

  /* ---------------- 商店嵌入（商店页子标签，双入口之二） ---------------- */
  function renderWormholeShopPanel() {
    const box = document.getElementById("bpshop-wh-content");
    if (!box) return;
    const bal = document.getElementById("bpshop-wh-balance");
    if (typeof WORMHOLE === "undefined" || !window.gameState || typeof WORMHOLE.isUnlocked !== "function" || !WORMHOLE.isUnlocked(gameState)) {
      if (bal) bal.textContent = "";
      box.innerHTML = '<div style="color:#8fa8c3;padding:10px 0">虫洞裂隙尚未显现 —— 制压星图主线（先驱文明核心）后开启。</div>';
      return;
    }
    try { WORMHOLE.tickWormhole(gameState, Date.now()); } catch (_) { /* 渲染不阻断 */ }
    const view = WORMHOLE.getWormholeView(gameState, Date.now());
    if (!view) { box.innerHTML = ""; if (bal) bal.textContent = ""; return; }
    if (bal) bal.textContent = "虫洞印记：" + fmtNum(view.tokens) + "　·　下次刷新：" + new Date(view.nextRefreshAt).toLocaleString();
    box.innerHTML = shopSectionsHtml(view);
  }

  /* ---------------- 事件绑定（一次，document 级：兼容虫洞页与商店页两个容器） ---------------- */
  let whBound = false;
  function bindOnce() {
    if (whBound) return;
    whBound = true;

    document.addEventListener("click", (e) => {
      const target = e.target.closest("[data-wh-tab],[data-wh-start],[data-wh-abandon],[data-wh-buy-upgrade],[data-wh-buy-item],[data-wh-buy-goods],[data-wh-dismiss],[data-wh-control],[data-wh-goto],[data-wh-action],[data-bpshop-tab]");
      if (!target) return;
      const panel = el("wormhole-panel");      // 出发/放弃分支需要面板内取模式与重试输入
      const dispatch = (type, payload) => {
        if (typeof dispatchGameAction !== "function") return;
        dispatchGameAction(gameState, { type, ...payload }, Date.now());
        if (typeof updateUI === "function") updateUI();
        renderWormholePage();                 // updateUI 不认识虫洞页，必须自己重渲
      };
      if (target.dataset.bpshopTab) {
        document.querySelectorAll(".bpshop-tab").forEach(b => b.classList.toggle("active", b === target));
        const bp = document.getElementById("bpshop-page-blueprint"), wh = document.getElementById("bpshop-page-wormhole");
        if (bp) bp.style.display = target.dataset.bpshopTab === "blueprint" ? "" : "none";
        if (wh) wh.style.display = target.dataset.bpshopTab === "wormhole" ? "" : "none";
        if (target.dataset.bpshopTab === "wormhole") renderWormholeShopPanel();
        return;
      }
      if (target.dataset.whTab) {
        const panel = el("wormhole-panel");
        if (!panel || !target.closest("#wormhole-panel")) return;
        panel.querySelectorAll(".wh-tab").forEach(b => b.classList.toggle("active", b === target));
        const runs = el("wh-page-runs"), shop = el("wh-page-shop");
        if (runs) runs.style.display = target.dataset.whTab === "runs" ? "" : "none";
        if (shop) shop.style.display = target.dataset.whTab === "shop" ? "" : "none";
        return;
      }
      if (target.dataset.whStart) {
        const id = target.dataset.whStart;
        const modeSel = panel ? panel.querySelector('[data-wh-mode="' + id + '"]') : null;
        const retryIn = panel ? panel.querySelector('[data-wh-retry="' + id + '"]') : null;
        dispatch("wormhole/startRun", { dailyId: id, opts: { mode: modeSel ? modeSel.value : "full", retryLimit: retryIn ? Number(retryIn.value) || 0 : 0 } });
        return;
      }
      if (target.dataset.whDismiss) { dispatch("wormhole/dismissRun", {}); return; }
      if (target.dataset.whControl) { dispatch("wormhole/setControl", { control: target.dataset.whControl }); return; }
      if (target.dataset.whAbandon) {
        const confirmText = (window.I18N && typeof window.I18N.t === "function") ? window.I18N.t("确定放弃本次远征？已获得的奖励保留。") : "确定放弃本次远征？已获得的奖励保留。";
        if (window.confirm(confirmText)) dispatch("wormhole/abandonRun", {});
        return;
      }
      if (target.dataset.whAction === "combat") {
        // 战斗节点房间 → 正式战斗页（与星图战斗试炼同款：房间即战斗页）
        if (typeof switchPage === "function") switchPage("combat");
        else if (typeof window.switchPage === "function") window.switchPage("combat");
        return;
      }
      const dispatchResult = (type, payload) => {
        if (typeof dispatchGameAction !== "function") return null;
        return dispatchGameAction(gameState, { type, ...payload }, Date.now());
      };
      const showRoomNotice = (msg) => {
        const box = document.getElementById("wormhole-room-result");
        if (box) box.innerHTML = '<div style="margin-top:8px;font-size:12px;color:#ff9a8a">' + msg + '</div>' + (box.innerHTML || "");
      };
      if (target.dataset.whGoto) {
        const nodeId = target.dataset.whGoto;
        if (!nodeId) return;
        // 手动选路：先切模式（same-control 幂等），再设目标；失败时把引擎原因显示出来（避免"点了没反应"）
        dispatchResult("wormhole/setControl", { control: "manual" });
        const rt = dispatchResult("wormhole/setTarget", { nodeId: nodeId });
        if (typeof updateUI === "function") updateUI();
        renderWormholePage();                 // updateUI 不认识虫洞页，必须自己重渲
        if (!rt || !rt.changed) showRoomNotice("无法前往该节点：" + ((rt && rt.reason) || "未知原因"));
        return;
      }
      if (target.dataset.whBuyUpgrade) return dispatch("wormhole/buyUpgrade", { id: target.dataset.whBuyUpgrade });
      if (target.dataset.whBuyItem) return dispatch("wormhole/buyItem", { id: target.dataset.whBuyItem });
      if (target.dataset.whBuyGoods) return dispatch("wormhole/buyGoods", { id: target.dataset.whBuyGoods, param: target.dataset.whParam || null });
    });
  }

  function init() {
    bindOnce();
    syncFinalNodeIdFromFrame();
    const frame = document.getElementById("legion-starmap-frame");
    if (frame) frame.addEventListener("load", syncFinalNodeIdFromFrame);
    const roomBack = document.getElementById("wormhole-room-back");
    if (roomBack) roomBack.addEventListener("click", () => {
      if (typeof window.closeWormholeNodeRoom === "function") window.closeWormholeNodeRoom();
      renderWormholePage();
    });
    const returnBtn = document.getElementById("starmap-wormhole-return");
    if (returnBtn) returnBtn.addEventListener("click", () => {
      if (typeof switchPage === "function") switchPage("wormhole");
    });
    const entryBtn = document.getElementById("starmap-wormhole-entry");
    if (entryBtn) entryBtn.addEventListener("click", () => {
      if (typeof switchPage === "function") switchPage("wormhole");
    });
    if (typeof updateUI === "function") { /* 由页面切换分支调用 */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.renderWormholePage = renderWormholePage;
  window.renderWormholeShopPanel = renderWormholeShopPanel;

  // 节流自刷新：主循环 updateUI 不覆盖虫洞页，这里按 1s 补刷新（仅在面板可见时）
  setInterval(function () {
    try {
      const wp = document.getElementById("wormhole-panel");
      if (wp && wp.style.display !== "none") renderWormholePage();
      const bp = document.getElementById("blueprintstore-panel");
      const whBox = document.getElementById("bpshop-page-wormhole");
      if (bp && bp.style.display !== "none" && whBox && whBox.style.display !== "none") renderWormholeShopPanel();
    } catch (_) { /* 刷新失败不影响游戏 */ }
  }, 1000);
})();
