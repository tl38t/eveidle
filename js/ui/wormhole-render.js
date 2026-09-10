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
  // 表单状态记忆：本页每秒整体重绘（见文件尾 setInterval），若控件值不做记忆就会被冲回默认值。
  // 这四个 map 与既有 launchControlByDaily 同构，写入点统一挂在 bindOnce 的 input/change 委托上。
  const launchControlByDaily = {};   // 出发卡片选路二选一（自动/手动），按虫洞各自记忆
  const retryByDaily = {};           // 「失败重试」输入值，按虫洞各自记忆（缺省 "2"）
  const modeByDaily = {};            // 「遍历/直冲」下拉值，按虫洞各自记忆（缺省 "full"）
  const choiceByGoods = {};          // 商店「自选购买内容」下拉值，按商品 id 记忆
  const licenseByGoods = {};         // 商店「生产许可」势力/档位，按商品 id 记忆 { faction, tier }
  function renderDailies(view) {
    const box = el("wh-dailies");
    if (!box) return;
    // 焦点守卫：玩家正在输入框/下拉里操作时跳过本轮重建，避免打断输入与丢焦点（与 renderShop 同策略）
    const ae = document.activeElement;
    if (ae && typeof ae.closest === "function" && ae.closest("#wh-dailies")
      && (ae.tagName === "INPUT" || ae.tagName === "SELECT")) return;
    if (!view.unlocked) {
      box.innerHTML = '<div style="color:#8fa8c3;padding:10px 0">虫洞裂隙尚未显现 —— 制压星图中心节点（先驱文明核心）后开启。</div>';
      return;
    }
    const runActive = !!(view.run && view.run.state === "running");
    const countsByDaily = (window.WORMHOLE && typeof window.WORMHOLE.getDailyNodeCounts === "function")
      ? window.WORMHOLE.getDailyNodeCounts(gameState) : {};
    const reroll = view.rerollToday || { count: 0, stock: 0 };
    const rerollBar = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 10px;padding:8px 10px;border:1px solid rgba(143,75,255,.30);border-radius:8px;background:rgba(18,13,37,.72);color:#a995c5;font-size:12px">' +
      '<span>裂隙重析库存：' + Number(reroll.stock || 0) + ' · 今日已购买：' + Number(reroll.count || 0) + '/2（未用库存跨日保留）</span>' +
      '<button type="button" class="btn secondary" data-wh-use-reroll' + (!(reroll.stock > 0) ? ' disabled' : '') + '>使用重析</button></div>';
    const html = view.dailies.map(d => {
      const pick = launchControlByDaily[d.id] || "auto";   // 本卡片的选路选择（默认自动）
      const modeVal = modeByDaily[d.id] === "rush" ? "rush" : "full";
      const retryVal = (retryByDaily[d.id] !== undefined && retryByDaily[d.id] !== "") ? String(retryByDaily[d.id]) : "2";
      const affix = (window.WORMHOLE_AFFIXES || []).find(a => a.id === d.affixId);
      const counts = countsByDaily[d.id] || { battle: "?", collection: "?", archaeology: "?" };
      const disabled = runActive || d.status !== "available";
      const statusText = { available: "待探索", running: "远征中", completed: "已通关", failed: "已超时", aborted: "已放弃" }[d.status] || d.status;
      return (
        '<div style="border:1px solid rgba(143,75,255,.48);border-radius:12px;padding:13px 14px;margin-bottom:10px;background:radial-gradient(circle at 92% 0,rgba(166,107,255,.13),transparent 38%),linear-gradient(135deg,rgba(18,13,37,.97),rgba(5,9,22,.99));box-shadow:inset 0 1px rgba(215,194,255,.10),inset 3px 0 rgba(143,75,255,.34),0 10px 26px rgba(0,0,0,.20)">' +
        '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<div><b style="color:#c9a0ff;font-size:14px">' + esc((window.WORMHOLE_CONFIG && window.WORMHOLE_CONFIG.SIZE_NAMES && window.WORMHOLE_CONFIG.SIZE_NAMES[d.size]) || (d.size + " 节点虫洞")) + '</b>' +
        '<span style="color:#7f97b3;font-size:12px">　' + esc(d.size) + ' 节点虫洞</span>' +
        '　<span style="color:#8fa8c3;font-size:12px">战斗 ' + counts.battle + (counts.battleElite ? ' · 精英 ' + counts.battleElite : '') + ' / 采集 ' + counts.collection + ' / 考古 ' + counts.archaeology +
        ' · 宝藏 ' + d.treasureCount + '</span></div>' +
        '<span style="display:inline-flex;align-items:center;padding:3px 8px;border:1px solid rgba(143,75,255,.28);border-radius:999px;background:rgba(91,50,151,.10);color:#a995c5;font-size:11px;letter-spacing:.04em">' + statusText + '</span></div>' +
        (affix ? '<div style="margin-top:9px;padding:7px 9px;border:1px solid rgba(192,99,139,.18);border-radius:7px;background:rgba(71,24,48,.10);font-size:12px"><span style="color:#ff9ab5">负面词条 · ' + esc(affix.name) + '</span>　<span style="color:#b58ea0">' + esc(affix.desc) + '</span></div>' : '') +
        '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<span style="display:inline-flex;border:1px solid rgba(94,75,139,.58);border-radius:6px;overflow:hidden;opacity:' + (disabled ? ".5" : "1") + '">' +
        '<button type="button" data-wh-pick-control="auto" data-wh-daily-id="' + esc(d.id) + '" style="padding:4px 10px;font-size:12px;border:none;cursor:' + (disabled ? "default" : "pointer") + ';background:' + (pick === "auto" ? "#1d3a5f" : "transparent") + ';color:' + (pick === "auto" ? "#8fd0ff" : "#5f7a99") + ';font-weight:' + (pick === "auto" ? "700" : "400") + '"' + (disabled ? " disabled" : "") + '>自动</button>' +
        '<button type="button" data-wh-pick-control="manual" data-wh-daily-id="' + esc(d.id) + '" style="padding:4px 10px;font-size:12px;border:none;border-left:1px solid rgba(94,75,139,.58);cursor:' + (disabled ? "default" : "pointer") + ';background:' + (pick === "manual" ? "#1d3a5f" : "transparent") + ';color:' + (pick === "manual" ? "#7fd8c0" : "#5f7a99") + ';font-weight:' + (pick === "manual" ? "700" : "400") + '"' + (disabled ? " disabled" : "") + '>手动</button>' +
        '</span>' +
        '<select data-wh-mode="' + esc(d.id) + '" style="background:#0c1528;color:#c7d8ef;border:1px solid rgba(94,75,139,.58);border-radius:6px;padding:4px 6px;font-size:12px"' + (disabled ? " disabled" : "") + '>' +
        '<option value="full"' + (modeVal === "full" ? " selected" : "") + '>遍历（全清）</option><option value="rush"' + (modeVal === "rush" ? " selected" : "") + '>直冲终点</option></select>' +
        '<label style="color:#7f97b3;font-size:12px">失败重试</label>' +
        '<input data-wh-retry="' + esc(d.id) + '" type="number" min="0" max="99" value="' + esc(retryVal) + '" style="width:56px;background:#0c1528;color:#c7d8ef;border:1px solid rgba(94,75,139,.58);border-radius:6px;padding:4px 6px;font-size:12px"' + (disabled ? " disabled" : "") + '/>' +
        '<button type="button" class="btn primary" data-wh-start="' + esc(d.id) + '"' + (disabled ? " disabled" : "") + '>出发</button>' +
        '</div></div>'
      );
    }).join("");
    box.innerHTML = rerollBar + html;
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

    let html = '<h3 class="wh-shop-section-title">永久升级（虫洞内生效）</h3>';
    html += Object.keys(S.upgrades).map(id => {
      const u = S.upgrades[id];
      const lv = view.upgrades[id] || 0;
      const maxed = lv >= u.max;
      const price = u.base + u.inc * lv;
      return '<div class="wh-shop-card">' +
        '<div><b style="color:#c7d8ef">' + esc(u.name) + '</b> <span style="color:#7f97b3">Lv.' + lv + '/' + u.max + '</span><br><span style="color:#8fa8c3">' + esc(u.desc) + '</span></div>' +
        '<div style="white-space:nowrap;text-align:right">' + (maxed ? '<span style="color:#7fd8c0">已满级</span>' : '<span style="color:#f0c674">' + fmtNum(price) + ' 印记</span><br>' + buyUpg(id)) + '</div></div>';
    }).join("");

    const renderShopItem = id => {
      const it = S.items[id];
      const stockCount = id === "reroll" && view.rerollToday ? Number(view.rerollToday.stock || 0) : Number((view.pendingItems || {})[id] || 0);
      const stock = ' <span style="color:#7fd8c0">库存 ' + stockCount + '</span>';
      const quota = id === "reroll" && view.rerollToday ? ' <span style="color:#d8b86a">今日限额 ' + Number(view.rerollToday.count || 0) + '/2</span>' : '';
      return '<div class="wh-shop-card">' +
        '<div><b style="color:#c7d8ef">' + esc(it.name) + '</b><br><span style="color:#8fa8c3">' + esc(it.desc) + '</span></div>' +
        '<div style="white-space:nowrap;text-align:right"><span style="color:#f0c674">' + fmtNum(it.price) + ' 印记</span>' + stock + quota + '<br>' + buyItem(id) + '</div></div>';
    };
    const strategicItemIds = Object.keys(S.items);
    html += '<h3 class="wh-shop-section-title">战略道具</h3>';
    html += strategicItemIds.map(renderShopItem).join("");

    const renderShopGood = id => {
      const g = S.goods[id];
      let priceHtml;
      const choicePicker = (options, label) => {
        const cur = choiceByGoods[id];   // 记忆上一次选择，重绘后不丢（本页每秒整体重建）
        return '<div class="wh-choice-picker"><select class="u-select wh-choice-select" data-wh-choice-select data-wh-choice-for="' + esc(id) + '" aria-label="' + esc(label) + '">' +
          options.map(o => '<option value="' + esc(o.value) + '"' + (cur === o.value ? " selected" : "") + '>' + esc(o.label) + '</option>').join('') +
          '</select><button type="button" class="btn" data-wh-buy-choice="' + esc(id) + '">购买</button></div>';
      };
      if (g.licenseFactions) {
        const lic = licenseByGoods[id] || {};
        const factions = g.licenseFactions.map(name => '<option value="' + esc(name) + '"' + (lic.faction === name ? " selected" : "") + '>' + esc(name) + '</option>').join('');
        const tiers = Object.keys(g.byTier).map(tier => '<option value="' + esc(tier) + '"' + (lic.tier === tier ? " selected" : "") + '>' + esc(tier) + ' · ' + fmtNum(g.byTier[tier]) + ' 印记</option>').join('');
        priceHtml = '<div class="wh-license-picker"><select class="u-select wh-license-select" data-wh-license-faction data-wh-license-for="' + esc(id) + '" aria-label="选择生产许可势力">' + factions + '</select>' +
          '<select class="u-select wh-license-select" data-wh-license-tier data-wh-license-for="' + esc(id) + '" aria-label="选择生产许可档位">' + tiers + '</select>' +
          '<button type="button" class="btn" data-wh-buy-license>购买</button></div>';
      }
      else if (g.byChoice) priceHtml = choicePicker(Object.keys(g.byChoice).map(ref => {
        const choice = g.byChoice[ref];
        return { value: ref, label: choice.name + ' ×' + fmtNum(choice.qty) + ' · ' + fmtNum(g.price) + ' 印记' };
      }), '选择购买内容');
      else if (g.byTier) priceHtml = choicePicker(Object.keys(g.byTier).map(t => ({ value: t, label: t + ' · ' + fmtNum(g.byTier[t]) + ' 印记' })), '选择购买档位');
      else if (g.byId) priceHtml = choicePicker(Object.keys(g.byId).map(n => ({ value: n, label: n + ' · ' + fmtNum(g.byId[n]) + ' 印记' })), '选择购买内容');
      else if (g.options) priceHtml = choicePicker(g.options.map(n => ({ value: n, label: n.replace("空间站", "").replace("深层舰船数据", "") + ' · ' + fmtNum(g.price) + ' 印记' })), '选择购买内容');
      else priceHtml = '<span style="color:#f0c674">' + fmtNum(g.price) + ' 印记</span> ' + buyGoods(id);
      const owned = g.once && view.owned && view.owned[id];
      const pumpDef = id === "darkPumpBlueprint" && window.WORMHOLE_DARK_PUMP && typeof EQUIPMENT_DB !== "undefined"
        ? EQUIPMENT_DB[window.WORMHOLE_DARK_PUMP.equipmentId] : null;
      let detailHtml = "";
      if (pumpDef) {
          const bonusPct = Math.round(Number((pumpDef.bonuses || {}).smeltingSpeed || 0) * 100);
        const fuelName = String((pumpDef.fuel && pumpDef.fuel.resourceId) || "").replace(/^special:/, "");
        const materialText = Object.keys(pumpDef.cost || {}).map(name => esc(name) + " ×" + fmtNum(pumpDef.cost[name])).join(" · ");
        detailHtml = '<div class="wh-shop-blueprint-detail">' +
          '<div><span>制造</span><b>装备 Lv.' + fmtNum(pumpDef.level) + ' · ' + fmtNum(pumpDef.time) + 's · ' + fmtNum(pumpDef.xp) + ' XP</b></div>' +
          '<div><span>加成</span><b>冶炼速度 +' + fmtNum(bonusPct) + '% / 件</b></div>' +
          '<div><span>燃料</span><b>' + esc(fuelName) + ' ×' + fmtNum((pumpDef.fuel && pumpDef.fuel.perCycle) || 0) + ' / 周期</b></div>' +
          '<div><span>适用</span><b>' + fmtNum((pumpDef.shipTypes || []).length) + ' 类工业舰型</b></div>' +
          '<div class="wh-shop-blueprint-materials"><span>材料</span><b>' + materialText + '</b></div>' +
          '</div>';
      }
      return '<div class="wh-shop-card">' +
        '<div><b style="color:#c7d8ef">' + esc(g.name) + '</b>' + (g.desc ? '<div class="wh-shop-good-desc">' + esc(g.desc) + '</div>' : '') + detailHtml + '</div>' +
        '<div style="white-space:nowrap;text-align:right">' + (owned ? '<span style="color:#7fd8c0">已拥有</span>' : priceHtml) + '</div></div>';
    };
    const implantGoodIds = Object.keys(S.goods).filter(id => S.goods[id].effect === "implant");
    const materialGoodIds = Object.keys(S.goods).filter(id => S.goods[id].effect !== "implant");
    html += '<h3 class="wh-shop-section-title">虫洞脑插</h3>';
    html += implantGoodIds.map(renderShopGood).join("");
    html += '<h3 class="wh-shop-section-title">物资兑换</h3>';
    html += materialGoodIds.map(renderShopGood).join("");

    return html;
  }
  function renderShop(view) {
    const box = el("wh-shop");
    if (!box) return;
    if (document.activeElement && document.activeElement.matches && document.activeElement.matches("#wh-shop select")) return;
    box.innerHTML = shopSectionsHtml(view);
  }

  /* ---------------- 商店嵌入（商店页子标签，双入口之二） ---------------- */
  function renderWormholeShopPanel() {
    const box = document.getElementById("bpshop-wh-content");
    if (!box) return;
    const bal = document.getElementById("bpshop-wh-balance");
    if (typeof WORMHOLE === "undefined" || !window.gameState || typeof WORMHOLE.isUnlocked !== "function" || !WORMHOLE.isUnlocked(gameState)) {
      if (bal) bal.textContent = "";
      box.innerHTML = '<div style="color:#8fa8c3;padding:10px 0">虫洞裂隙尚未显现 —— 制压星图中心节点（先驱文明核心）后开启。</div>';
      return;
    }
    try { WORMHOLE.tickWormhole(gameState, Date.now()); } catch (_) { /* 渲染不阻断 */ }
    const view = WORMHOLE.getWormholeView(gameState, Date.now());
    if (!view) { box.innerHTML = ""; if (bal) bal.textContent = ""; return; }
    if (bal) bal.textContent = "虫洞印记：" + fmtNum(view.tokens) + "　·　下次刷新：" + new Date(view.nextRefreshAt).toLocaleString();
    if (document.activeElement && document.activeElement.matches && document.activeElement.matches("#bpshop-wh-content select")) return;
    box.innerHTML = shopSectionsHtml(view);
  }

  /* ---------------- 事件绑定（一次，document 级：兼容虫洞页与商店页两个容器） ---------------- */
  let whBound = false;
  function bindOnce() {
    if (whBound) return;
    whBound = true;

    document.addEventListener("click", (e) => {
      const target = e.target.closest("[data-wh-tab],[data-wh-start],[data-wh-abandon],[data-wh-buy-upgrade],[data-wh-buy-item],[data-wh-buy-goods],[data-wh-buy-license],[data-wh-buy-choice],[data-wh-dismiss],[data-wh-control],[data-wh-goto],[data-wh-action],[data-bpshop-tab],[data-wh-pick-control],[data-wh-use-reroll]");
      if (!target) return;
      const panel = el("wormhole-panel");      // 出发/放弃分支需要面板内取模式与重试输入
      const dispatch = (type, payload) => {
        if (typeof dispatchGameAction !== "function") return;
        const result = dispatchGameAction(gameState, { type, ...payload }, Date.now());
        if (typeof updateUI === "function") updateUI();
        if ((type === "wormhole/buyUpgrade" || type === "wormhole/buyItem" || type === "wormhole/buyGoods") && typeof showToast === "function") {
          const S = window.WORMHOLE_SHOP || { upgrades:{}, items:{}, goods:{} };
          const def = S.upgrades[payload.id] || S.items[payload.id] || S.goods[payload.id];
          const name = def && def.name ? def.name : payload.id;
          if (!result || !result.changed) {
            const reasons = { "insufficient-tokens":"虫洞印记不足", "already-owned":"该项目已拥有", "choice-required":"请先选择购买内容", "invalid-choice":"购买选项无效", "daily-limit":"今日限额已用完" };
            showToast("购买失败：" + (reasons[result && result.reason] || (result && result.reason) || "无法购买"));
          } else {
            let granted = name;
            if (type === "wormhole/buyGoods" && def) {
              if (def.byChoice && def.byChoice[payload.param]) granted = def.byChoice[payload.param].name + " ×" + (def.byChoice[payload.param].qty || 0);
              else if (def.byId && def.byId[payload.param]) granted = payload.param;
              else if (def.options && payload.param) granted = payload.param;
              else if (result.granted && result.granted !== "blueprint") granted = String(result.granted).replace(/^special:/, "");
            }
            const view = WORMHOLE.getWormholeView(gameState, Date.now());
            let extra = " · 剩余 " + fmtNum(view.tokens) + " 印记";
            if (payload.id === "reroll") extra += " · 今日限额 " + Number(view.rerollToday && view.rerollToday.count || 0) + "/2";
            showToast("购买成功：" + granted + extra);
          }
        }
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
        dispatch("wormhole/startRun", { dailyId: id, opts: { mode: modeSel ? modeSel.value : "full", retryLimit: retryIn ? Number(retryIn.value) || 0 : 0, control: launchControlByDaily[id] || "auto" } });
        return;
      }
      if (target.dataset.whPickControl) {
        // 出发前选路二选一：按虫洞卡片各自记忆（出发时随 startRun 定格），立即重渲刷新高亮
        const dailyId = target.dataset.whDailyId;
        if (dailyId) launchControlByDaily[dailyId] = target.dataset.whPickControl === "manual" ? "manual" : "auto";
        if (typeof updateUI === "function") updateUI();
        renderWormholePage();
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
      const needsPurchaseConfirm = (type, id) => {
        const S = window.WORMHOLE_SHOP || { upgrades:{}, items:{}, goods:{} };
        const def = S.upgrades[id] || S.items[id] || S.goods[id];
        return Boolean(def && (type === "wormhole/buyUpgrade" || def.once || Number(def.price || 0) >= 1000));
      };
      const confirmPurchase = (type, id, onConfirm) => {
        if (!needsPurchaseConfirm(type, id)) return onConfirm();
        const S = window.WORMHOLE_SHOP || { upgrades:{}, items:{}, goods:{} };
        const def = S.upgrades[id] || S.items[id] || S.goods[id] || {};
        const title = String(def.name || id).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
        if (typeof showDangerConfirm === "function") {
          showDangerConfirm("确认购买", '<div class="dlg-message">确定购买“' + title + '”吗？</div>', "确认购买", onConfirm);
        } else {
          onConfirm();
        }
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
      if (target.dataset.whBuyUpgrade) {
        const id = target.dataset.whBuyUpgrade;
        return confirmPurchase("wormhole/buyUpgrade", id, () => dispatch("wormhole/buyUpgrade", { id }));
      }
      if (target.dataset.whUseReroll !== undefined) return dispatch("wormhole/useReroll", {});
      if (target.dataset.whBuyItem) {
        const id = target.dataset.whBuyItem;
        return confirmPurchase("wormhole/buyItem", id, () => dispatch("wormhole/buyItem", { id }));
      }
      if (target.dataset.whBuyLicense !== undefined) {
        const card = target.closest(".wh-shop-card");
        const faction = card && card.querySelector("[data-wh-license-faction]");
        const tier = card && card.querySelector("[data-wh-license-tier]");
        return dispatch("wormhole/buyGoods", { id: "licensePick", param: (faction ? faction.value : "") + "|" + (tier ? tier.value : "") });
      }
      if (target.dataset.whBuyChoice) {
        const card = target.closest(".wh-shop-card");
        const choice = card && card.querySelector("[data-wh-choice-select]");
        const id = target.dataset.whBuyChoice;
        return confirmPurchase("wormhole/buyGoods", id, () => dispatch("wormhole/buyGoods", { id, param: choice ? choice.value : null }));
      }
      if (target.dataset.whBuyGoods) {
        const id = target.dataset.whBuyGoods;
        return confirmPurchase("wormhole/buyGoods", id, () => dispatch("wormhole/buyGoods", { id, param: target.dataset.whParam || null }));
      }
    });

    // 表单状态记忆 write-back：出发卡片（重试次数 / 遍历直冲）与商店选择器（自选内容 / 生产许可）
    // 都挂在每秒重建的 innerHTML 上，必须把玩家输入写回模块级 map，否则重绘即丢失。
    const rememberField = (t) => {
      if (!t || !t.dataset || !t.tagName) return;
      const ds = t.dataset;
      if (ds.whRetry !== undefined) { retryByDaily[ds.whRetry] = t.value; return; }
      if (ds.whMode !== undefined) { modeByDaily[ds.whMode] = t.value; return; }
      if (ds.whChoiceFor !== undefined && t.hasAttribute("data-wh-choice-select")) { choiceByGoods[ds.whChoiceFor] = t.value; return; }
      if (ds.whLicenseFor !== undefined) {
        const memo = licenseByGoods[ds.whLicenseFor] = licenseByGoods[ds.whLicenseFor] || {};
        if (t.hasAttribute("data-wh-license-faction")) memo.faction = t.value;
        else if (t.hasAttribute("data-wh-license-tier")) memo.tier = t.value;
      }
    };
    document.addEventListener("input", (e) => rememberField(e.target));
    document.addEventListener("change", (e) => rememberField(e.target));
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
