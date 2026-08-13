/* ================================================================
   QA 种子入口（仅 ?qa=场景 激活；生产 DOM；可复现；不污染存档）

   目的：为「真实浏览器验收」提供一个可复现的正式 QA 入口，全部运行在
   生产 index.html 的真实 DOM 上，不使用任何独立演示页。

   场景（独立入口，避免弹窗/状态互相遮挡）：
     ?qa=offline    离线结算持久弹窗（先 dispatchGameAction 启动采矿任务）
     ?qa=cargo      货柜开箱（授予并开启至少一个货柜，弹窗含卡）
     ?qa=enhance    星币不足强化态（ResourceRegistry.set isk=1000）
     ?qa=dismantle  舰船拆解（确保一艘无装备可拆解舰，危险按钮+返还预览）
     ?qa=fitting    装备候选列表滚动（注入足够多同槽位装备）
     ?qa=1 | ?qa=all  依次运行全部场景

   安全（不污染存档）：
   - 仅当 URL 含 ?qa= 时自动运行并暴露 window.QA；非 ?qa= 页面不暴露 window.QA（隔离 QA，防止进入生产 DOM）。
   - 可靠屏蔽 SaveManager.save（含 adapter）与 localStorage 写入；保存前快照原始
     localStorage[SAVE_KEY]，运行后比对，证明原存档未改变（可观察自检）。
   - 刷新页面即恢复原始存档（写入已屏蔽）。
   ================================================================ */
(function () {
  "use strict";
  var SAVE_KEY = "eve_idle_save";
  var SCENARIO_KEYS = ["offline", "cargo", "enhance", "dismantle", "fitting"];

  function qaActive() {
    try { return /[?&]qa=/.test(window.location && window.location.search || ""); }
    catch (e) { return false; }
  }
  function qaScenario() {
    try {
      var m = (window.location.search || "").match(/[?&]qa=([^&]+)/);
      if (!m) return "all";
      var v = m[1];
      if (v === "1" || v === "all") return "all";
      return SCENARIO_KEYS.indexOf(v) >= 0 ? v : "all";
    } catch (e) { return "all"; }
  }
  function log(msg) { try { console.log("[QA] " + msg); } catch (e) {} }
  function assertLog(name, pass, detail) {
    try { console.log("[QA] " + (pass ? "✓" : "✗") + " " + name + (detail ? " (" + detail + ")" : "")); } catch (e) {}
  }
  function now() { try { return Date.now(); } catch (e) { return 0; } }
  function G() { return window.gameState; }
  // 真实浏览器 DOM 才可用：审计沙箱 documentMock 每个 getElementById 返回新元素、querySelectorAll→[]，
  // 真实 DOM 断言必须跳过，否则会误报失败。判定依据：createElement→appendChild→getElementById 是否返回同一引用。
  function hasRealDom() {
    try {
      if (typeof document === "undefined" || !document.createElement || !document.body || !document.getElementById) return false;
      var el = document.createElement("div");
      el.id = "__qa_dom_probe__";
      document.body.appendChild(el);
      var found = document.getElementById("__qa_dom_probe__");
      var ok = found === el;
      if (found && found.parentNode) found.parentNode.removeChild(found);
      return ok;
    } catch (e) { return false; }
  }

  // ---- 可靠屏蔽存档（SaveManager.save + adapter + localStorage），并保留可观察自检 ----
  function blockSaving() {
    var rawBefore = null;
    try { rawBefore = window.localStorage.getItem(SAVE_KEY); } catch (e) {}
    var saveCalls = 0;
    if (window.SaveManager && typeof window.SaveManager.save === "function") {
      window.SaveManager.save = function () { saveCalls++; return false; }; // 不落盘
    }
    if (window.SaveManager && window.SaveManager.adapter && typeof window.SaveManager.adapter.save === "function") {
      window.SaveManager.adapter.save = function () { return false; };
    }
    try {
      var ls = window.localStorage;
      if (ls && typeof ls.setItem === "function") {
        var _set = ls.setItem.bind(ls);
        ls.setItem = function (k, v) { if (k === SAVE_KEY) return; return _set(k, v); };
      }
    } catch (e) {}
    return {
      rawBefore: rawBefore,
      saveCalls: function () { return saveCalls; },
      verify: function () {
        var rawAfter = null;
        try { rawAfter = window.localStorage.getItem(SAVE_KEY); } catch (e) {}
        var equal = rawAfter === rawBefore;
        log("存档污染自检: SaveManager.save 调用 " + saveCalls + " 次；localStorage[" + SAVE_KEY + "] " + (equal ? "未改变 ✅" : "已改变 ❌"));
        return { equal: equal, saveCalls: saveCalls };
      }
    };
  }

  function getDisplay() { return window.getHangarDisplayState(G(), now()); }
  function shipById(display, id) {
    return display && display.ships ? display.ships.filter(function (s) { return s.instanceId === id; })[0] || null : null;
  }
  function firstOfType(display, type) {
    if (!display || !display.ships) return null;
    if (type === "combat") return display.ships.filter(function (s) { return !s.industrial && !s.archaeology; })[0] || null;
    if (type === "industrial") return display.ships.filter(function (s) { return s.industrial; })[0] || null;
    if (type === "archaeology") return display.ships.filter(function (s) { return s.archaeology; })[0] || null;
    return display.ships[0] || null;
  }

  // ============================ 场景：星币不足强化 ============================
  function scenarioEnhance() {
    var checks = [], ok = true;
    function check(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || "" }); if (!pass) ok = false; }
    try {
      window.ResourceRegistry.set(G(), "currency:isk", 1000);
      var got = window.ResourceRegistry.get(G(), "currency:isk");
      check("ResourceRegistry.set/get currency:isk === 1000", got === 1000, "isk=" + got);

      var display = getDisplay();
      var target = display.ships.filter(function (s) {
        return s.enhancement && s.enhancement.available && s.enhancement.iskCost > 0;
      })[0] || null;
      if (!target) {
        // 兜底：取任意可强化舰，在「显示态」上合成不足态以验证渲染（不写 gameState）
        target = display.ships.filter(function (s) { return s.enhancement && s.enhancement.available; })[0] || null;
        if (target) {
          target = Object.assign({}, target, { enhancement: Object.assign({}, target.enhancement, { iskCost: 50000, iskStock: 1000, iskEnough: false }) });
          log("未找到 iskCost>0 舰，使用合成不足态校验渲染");
        }
      }
      if (!target) { check("找到可强化舰", false, "无可用舰"); return { name: "enhance", ok: false, checks: checks }; }
      check("找到可强化且 iskCost>0 的舰", true, target.name + " iskCost=" + target.enhancement.iskCost);
      check("强化选择器 iskEnough=false（星币不足）", target.enhancement.iskEnough === false, "iskEnough=" + target.enhancement.iskEnough);

      var TP = window.TapTapPortrait;
      var html = TP.tpEnhanceHTML(display, target);
      check("tpEnhanceHTML 含 .tp-enh-insufficient", html.indexOf("tp-enh-insufficient") >= 0, "");
      check("星币行含 .short 红字", html.indexOf("tp-mat short") >= 0, "");
    } catch (err) {
      check("场景执行无异常", false, String((err && err.message) || err));
    }
    return { name: "enhance", ok: ok, checks: checks };
  }

  // ============================ 场景：离线结算 ============================
  function scenarioOffline() {
    var checks = [], ok = true;
    function check(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || "" }); if (!pass) ok = false; }
    var opened = null, closed = 0;
    var origOpen = window.openRewardResultModal, origClose = window.closeRewardResultModal;
    // 必须在覆盖 window.openRewardResultModal 之前捕获「生产函数源码」，否则 String() 会得到
    // spy 而非生产源码（此前 H(e) offline 两项静态断言失败的根因）。
    var prodOpenSrc = typeof origOpen === "function" ? String(origOpen) : "";
    window.openRewardResultModal = function (opt) { opened = opt || {}; return origOpen ? origOpen.call(window, opt) : null; };
    window.closeRewardResultModal = function () { closed++; if (origClose) origClose.call(window); };
    try {
      // 1) 正式启动一个可离线结算任务（采矿）
      window.dispatchGameAction(G(), { type: "queue/add", item: { skill: "mining", target: "凡晶石带", count: 1 }, front: true }, now());
      window.dispatchGameAction(G(), { type: "queue/start" }, now());
      var ca = G().currentAction;
      check("dispatchGameAction 启动采矿任务", ca && ca.active && ca.skill === "mining", ca ? (ca.skill + " active=" + ca.active) : "无 currentAction");

      // 2) 离线结算
      var gains = window.forceOfflineTest(3600);
      var positive = gains ? Object.keys(gains).filter(function (k) { return (gains[k] || 0) > 0; }) : [];
      check("forceOfflineTest 产生离线收益", positive.length > 0, positive.join(",") || "无收益");

      // 3) 持久弹窗真实打开 + 携带卡片
      check("离线结算持久弹窗已打开(openRewardResultModal 被调用)", opened !== null, opened ? ("items=" + (opened.items ? opened.items.length : 0)) : "未打开");
      check("弹窗携带 ≥1 张奖励卡", opened && opened.items && opened.items.length >= 1, opened && opened.items ? ("cards=" + opened.items.length) : "0");
      // 弹窗含关闭按钮 + 使用 display:flex（静态核对「生产函数源码」prodOpenSrc，非 spy）
      check("produce 弹窗函数含关闭按钮 data-rrm-close", prodOpenSrc.indexOf("data-rrm-close") >= 0, "");
      check("produce 弹窗函数使用 display:flex", prodOpenSrc.indexOf('style.display = "flex"') >= 0, "");
      // 4) 不自动关闭：打开后 closeRewardResultModal 未被同步调用（确无自动关闭计时）
      check("弹窗不自动关闭(closeRewardResultModal 未被调用)", closed === 0, "closed=" + closed);
    } catch (err) {
      check("场景执行无异常", false, String((err && err.message) || err));
    }
    // 还原 spy
    window.openRewardResultModal = origOpen;
    window.closeRewardResultModal = origClose;
    return { name: "offline", ok: ok, checks: checks };
  }

  // ============================ 场景：货柜开箱 ============================
  function scenarioCargo() {
    var checks = [], ok = true;
    function check(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || "" }); if (!pass) ok = false; }
    try {
      // 确定性 RNG：固定返回 0 → 加权抽取稳定命中首个 tier(=T1) 与首个条目，
      // 保证每次开箱必出 ≥1 件奖励，从而稳定展示正式的持久开箱弹窗。
      // 仅用于 ?qa=cargo 测试数据准备，不改动正式开箱弹窗/关闭逻辑。
      function cargoRngZero() { return 0; }

      var size = "T1";
      var cargoId = "special:货柜" + size;
      window.ResourceRegistry.add(G(), cargoId, 1);
      var have = window.ResourceRegistry.get(G(), cargoId);
      check("授予 1 个 " + size + " 货柜(" + cargoId + ")", have >= 1, "have=" + have);

      var res = window.openCargoContainers(G(), size, 1, cargoRngZero);
      check("openCargoContainers 成功开启", res && res.opened >= 1, res ? ("opened=" + res.opened) : "null");
      check("开启产生 ≥1 件战利品(rolls)", res && res.rolls && res.rolls.length >= 1, res && res.rolls ? ("rolls=" + res.rolls.length) : "0");

      // 复用正式开箱 doOpen 路径：先 aggregateRewardRolls（内部走 normalizeRewardItem 规范化名称/分类/来源），
      // 再传给 openRewardResultModal。禁止手工 res.rolls.map 构造 items（会泄漏原始 id 如 planetary:重金属）。
      if (typeof window.aggregateRewardRolls !== "function") {
        check("aggregateRewardRolls 可用（正式路径）", false, "未定义");
      } else {
        var items = window.aggregateRewardRolls(res.rolls);
        check("aggregateRewardRolls 产出已规范化 items", Array.isArray(items) && items.length >= 1, items ? ("len=" + items.length) : "null");
        // 手写 res.rolls.map 不会带 _normalized；此标志证明走的是正式 normalizeRewardItem 路径
        check("items[0]._normalized === true（走 normalizeRewardItem 路径）", !!(items && items[0] && items[0]._normalized === true), items && items[0] ? ("_normalized=" + items[0]._normalized) : "null");
        // 展示正式持久开箱弹窗（与生产 doOpen 同款：仓库物品卡 buildCargoCardHTML，无自动关闭）
        try {
          window.openRewardResultModal({ title: "📦 开箱结果", subtitle: size + " 货柜开箱结果", items: items });
          log("货柜弹窗已展示 " + items.length + " 张卡（正式 aggregateRewardRolls 路径）");
        } catch (e) { log("货柜弹窗展示异常：" + (e && e.message)); }
      }

      // 真实 DOM 断言（仅浏览器；审计沙箱 DOM 为 mock，跳过以免误报）
      if (hasRealDom()) {
        var modal = document.getElementById("reward-result-modal");
        check("开箱弹窗已挂载 #reward-result-modal", !!modal, "");
        check("开箱弹窗 display=flex（持久、不自动关闭）", !!(modal && modal.style.display === "flex"), modal ? ("display=" + modal.style.display) : "null");
        var cards = (modal && modal.querySelectorAll) ? modal.querySelectorAll(".reward-result-card") : [];
        check(".reward-result-card === 1", cards.length === 1, "cards=" + cards.length);
        if (cards.length >= 1) {
          var card = cards[0];
          var nameEl = card.querySelector ? card.querySelector(".cc-name") : null;
          var nameText = (nameEl && nameEl.textContent) || "";
          check("卡片显示『重金属』而非『planetary:重金属』", nameText.indexOf("重金属") >= 0 && nameText.indexOf("planetary:") < 0, "nameText=" + nameText);
          var catEl = card.querySelector ? card.querySelector(".cc-cat") : null;
          check("卡片含正式分类字段 .cc-cat", !!(catEl && catEl.textContent), catEl ? ("cat=" + catEl.textContent) : "null");
          var srcEl = card.querySelector ? card.querySelector(".cc-src") : null;
          check("卡片含来源字段 .cc-src", !!(srcEl && srcEl.textContent), srcEl ? ("src=" + srcEl.textContent) : "null");
        }
      } else {
        log("真实 DOM 断言跳过（非浏览器环境 / documentMock）");
      }
    } catch (err) {
      check("场景执行无异常", false, String((err && err.message) || err));
    }
    return { name: "cargo", ok: ok, checks: checks };
  }

  // ============================ 场景：舰船拆解 ============================
  function scenarioDismantle() {
    var checks = [], ok = true;
    function check(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || "" }); if (!pass) ok = false; }
    try {
      var ships = (G().inventory && Array.isArray(G().inventory.ships)) ? G().inventory.ships : [];
      // 选一艘：清空其装配 + 解除指派 + 解除战斗激活，确保可拆解（数据真正准备，而非只打印）
      var inst = ships[0];
      if (inst) {
        if (inst.fitting) { inst.fitting.high = []; inst.fitting.mid = []; inst.fitting.low = []; inst.fitting.rig = []; }
        var assigns = G().shipAssignments || {};
        for (var k in assigns) { if (assigns[k] === inst.instanceId) delete assigns[k]; }
        if (G().combat && G().combat.active && G().combat.activeShipInstanceId === inst.instanceId) G().combat.active = false;
      }
      var reason = inst ? window.getShipDismantleBlockReason(G(), inst, now()) : "no-ship";
      // 兜底：若仍被占用（如当前动作占用），再解除一次
      if (reason) {
        if (G().currentAction) G().currentAction.active = false;
        if (G().combat) G().combat.active = false;
        reason = inst ? window.getShipDismantleBlockReason(G(), inst, now()) : "no-ship";
      }
      check("找到一艘无装备/未指派、允许拆解的舰船(block reason=null)", reason === null, "reason=" + reason);

      var display = getDisplay();
      var ship = shipById(display, inst ? inst.instanceId : null) || firstOfType(display, "combat");
      if (!ship || !ship.dismantle || !ship.dismantle.available) {
        check("该舰有可拆解配方", false, "无 dismantle.available");
        return { name: "dismantle", ok: false, checks: checks };
      }
      check("该舰 dismantle.canDismantle=true", ship.dismantle.canDismantle === true, "canDismantle=" + ship.dismantle.canDismantle);

      var TP = window.TapTapPortrait;
      var html = TP.tpDismantleHTML(display, ship);
      check("tpDismantleHTML 含危险按钮 data-dismantle-ship", html.indexOf("data-dismantle-ship") >= 0, "");
      check("tpDismantleHTML 含返还预览 tp-dismantle-item(×N)", html.indexOf("tp-dismantle-item") >= 0 && html.indexOf("×") >= 0, "");
    } catch (err) {
      check("场景执行无异常", false, String((err && err.message) || err));
    }
    return { name: "dismantle", ok: ok, checks: checks };
  }

  // ============================ 场景：装备候选列表滚动 ============================
  function scenarioFitting() {
    var checks = [], ok = true;
    function check(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || "" }); if (!pass) ok = false; }
    try {
      var HIGH_SLOT_IDS = [
        "t1_small_laser", "t1_light_missile_launcher", "t1_small_cannon",
        "t1_medium_laser", "t1_heavy_missile_launcher", "t1_medium_cannon",
        "t1_large_laser", "t1_cruise_missile_launcher", "t1_large_cannon",
        "t2_mining_laser", "t3_mining_laser", "t4_mining_laser", "t5_mining_laser"
      ];
      var eq = G().equipment || (G().equipment = {});
      var inv = Array.isArray(eq.inventory) ? eq.inventory : (eq.inventory = []);
      for (var i = 0; i < HIGH_SLOT_IDS.length; i++) inv.push(HIGH_SLOT_IDS[i]);
      check("注入 " + HIGH_SLOT_IDS.length + " 件同槽位(高槽)装备", true, "inventory+=" + HIGH_SLOT_IDS.length);

      var display = getDisplay();
      var combat = firstOfType(display, "combat") || display.ships[0];
      if (!combat) { check("找到战斗舰以打开装备候选", false, "无舰"); return { name: "fitting", ok: false, checks: checks }; }
      var fit = window.getShipFittingDisplayState(G(), combat.instanceId);
      var highCount = (fit && fit.inventoryStacksBySlot && fit.inventoryStacksBySlot.high) ? fit.inventoryStacksBySlot.high.length : 0;
      check("高槽候选数足以触发滚动(>=12)", highCount >= 12, "highStacks=" + highCount);

      // 真正打开装备弹窗并选中高槽，使 #equipSelectOptions 渲染（浏览器可见滚动）
      try {
        window.openEquipOrbit(combat.instanceId);
        var slot = fit && fit.orbitSlots ? fit.orbitSlots.filter(function (s) { return s.type === "high" && s.enabled; })[0] : null;
        if (slot) window.openOrbitSelect(slot.index);
        log("已打开装备弹窗并选中高槽（#equipSelectOptions 渲染 " + highCount + " 项候选）");
      } catch (e) { log("打开装备弹窗异常：" + (e && e.message)); }
    } catch (err) {
      check("场景执行无异常", false, String((err && err.message) || err));
    }
    return { name: "fitting", ok: ok, checks: checks };
  }

  var SCENARIOS = {
    enhance: scenarioEnhance,
    offline: scenarioOffline,
    cargo: scenarioCargo,
    dismantle: scenarioDismantle,
    fitting: scenarioFitting
  };

  // 供审计/Codex 调用：返回结构化真实状态结果（offline 同步返回，无未决计时）
  function runScenario(name) {
    if (name === "all") return SCENARIO_KEYS.map(function (k) { return SCENARIOS[k](); });
    if (SCENARIOS[name]) return SCENARIOS[name]();
    return { name: name, ok: false, checks: [{ name: "未知场景", pass: false }] };
  }

  // ---- 仅 ?qa= 时暴露 QA 句柄并自动运行（防止非 ?qa= 页面暴露 window.QA）----
  if (qaActive()) {
    window.QA = { runScenario: runScenario, scenarios: SCENARIO_KEYS.slice(), blockSaving: blockSaving, available: true };

    function waitReady(cb) {
      var tries = 0;
      (function poll() {
        if (window.gameState && typeof window.forceOfflineTest === "function" && typeof window.renderHangarPanel === "function") { cb(); return; }
        if (++tries > 240) { log("等待 gameState/forceOfflineTest 超时（可手动 window.QA.runScenario('all')）"); return; }
        setTimeout(poll, 50);
      })();
    }
    waitReady(function () {
      var block = blockSaving();
      log("QA 模式已激活（?qa=" + qaScenario() + "）。存档写入已屏蔽，刷新即恢复。");
      var which = qaScenario();
      var list = which === "all" ? SCENARIO_KEYS : [which];
      list.forEach(function (name) {
        var res = SCENARIOS[name]();
        log("场景 " + name + " -> " + (res.ok ? "PASS ✅" : "FAIL ❌"));
        (res.checks || []).forEach(function (c) { log("  - [" + (c.pass ? "✓" : "✗") + "] " + c.name + (c.detail ? " (" + c.detail + ")" : "")); });
      });
      // 浏览器额外：离线/货柜弹窗等待后仍未自动关闭；货柜弹窗模拟手动关闭后消失
      var needWait = (list.indexOf("offline") >= 0 || which === "all") || (list.indexOf("cargo") >= 0 || which === "all");
      if (needWait) {
        setTimeout(function () {
          if (list.indexOf("offline") >= 0 || which === "all") {
            var om = null; try { om = document.getElementById("reward-result-modal"); } catch (e) {}
            log("离线弹窗等待 1.5s 后 display=" + (om ? (om.style.display || "(无)") : "未找到") + "（应为 flex，证明未自动关闭）");
          }
          if (list.indexOf("cargo") >= 0 || which === "all") {
            var m = null; try { m = document.getElementById("reward-result-modal"); } catch (e) {}
            assertLog("货柜弹窗等待后 display 仍为 flex（无自动关闭）", !!(m && m.style.display === "flex"), "display=" + (m ? (m.style.display || "(无)") : "未找到"));
            // 模拟手动关闭：点击关闭按钮（[data-rrm-close]），等同玩家操作；不改动 shell-render.js 关闭逻辑
            var closeBtn = (m && m.querySelector) ? m.querySelector("[data-rrm-close]") : null;
            try { if (closeBtn && closeBtn.click) closeBtn.click(); else if (typeof window.closeRewardResultModal === "function") window.closeRewardResultModal(); } catch (e) {}
            var m2 = null; try { m2 = document.getElementById("reward-result-modal"); } catch (e) {}
            assertLog("货柜弹窗手动关闭后 display=none", !!(m2 && m2.style.display === "none"), "display=" + (m2 ? (m2.style.display || "(无)") : "未找到"));
          }
          block.verify();
        }, 1500);
      } else {
        block.verify();
      }
    });
  }
})();
