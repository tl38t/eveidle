/* =============================================================
   TapTap 竖屏 UI（生产迁移版）
   - 独立覆盖脚本：抽屉 / 底部五项导航 / 全页滚动 / 仓库双列 /
     考古单列 / 移动船坞单舰焦点 / 装备弹窗全屏 + 环中央缩略图。
   - 只新增 DOM 与监听，不复制导航状态、不重写生产逻辑。
   - 复用现有 switchPage / switchSkill / openEquipOrbit /
     dispatchGameAction / getHangarDisplayState / getHangarThumb 等。
   - 不改动 selectors / actions / state / persistence / ship3d / data。
   ============================================================= */
(function () {
  "use strict";
  var MOBILE = window.matchMedia("(max-width: 820px)");
  function onMobile() { return MOBILE.matches; }

  /* 顶部活动状态条（方案 B）状态引用；仅窄屏（≤820px）显示并更新 */
  var _tpActStrip = null, _tpActIcon = null, _tpActLabel = null, _tpActPct = null,
      _tpActEta = null, _tpActBar = null, _tpActFill = null, _tpLastStripFrame = 0;

  function init() {
    var topbar = document.querySelector(".topbar");
    var sidebar = document.querySelector(".sidebar");
    var mainContainer = document.querySelector(".main-container");
    if (!topbar || !sidebar || !mainContainer) return;

    /* 菜单按钮 */
    var menuBtn = document.createElement("button");
    menuBtn.className = "tp-menu-btn";
    menuBtn.setAttribute("aria-label", "菜单");
    menuBtn.textContent = "☰";
    topbar.insertBefore(menuBtn, topbar.firstChild);

    /* 顶部活动状态条（方案 B）：运行期创建，置于顶栏之后（main-container 之前）；
       显隐完全由 CSS 媒体查询控制（≤820px 显示，桌面隐藏）。
       更新逻辑 tpUpdateActivityStrip 仅在 onMobile() 时执行，桌面不显示也不刷新。 */
    var strip = document.createElement("div");
    strip.id = "tp-activity-strip";
    strip.className = "tp-activity-strip no-progress";
    strip.innerHTML =
      '<div class="tp-act-row">'
        + '<span class="tp-act-icon"></span>'
        + '<span class="tp-act-label"></span>'
        + '<span class="tp-act-pct"></span>'
        + '<span class="tp-act-eta"></span>'
      + '</div>'
      + '<div class="tp-act-bar flowing"><span class="tp-act-fill"></span></div>';
    /* 方案 A：把活动条放到 topbar 之后、main-container 之前，作为 body 层级的独立 fixed 条。
       抽屉打开时由 CSS 向右缩进，避免覆盖侧边栏顶部标签（不再压在 sidebar 之上）。 */
    topbar.parentNode.insertBefore(strip, mainContainer);
    _tpActStrip = strip;
    _tpActIcon = strip.querySelector(".tp-act-icon");
    _tpActLabel = strip.querySelector(".tp-act-label");
    _tpActPct = strip.querySelector(".tp-act-pct");
    _tpActEta = strip.querySelector(".tp-act-eta");
    _tpActBar = strip.querySelector(".tp-act-bar");
    _tpActFill = strip.querySelector(".tp-act-fill");

    /* 抽屉遮罩：与 .sidebar 同处于 .main-container stacking context，
       content(0) < overlay(1300) < sidebar(1400)，sidebar 因此绘制在遮罩之上、
       点击不被截获；顶栏(z1500)/底部导航(z1100) 处于 body 层，仍可见可点。 */
    var overlay = document.createElement("div");
    overlay.className = "tp-drawer-overlay";
    mainContainer.appendChild(overlay);

    /* 底部五项导航：复用现有 switchPage / switchSkill */
    var nav = document.createElement("nav");
    nav.className = "tp-bottom-nav";
    var items = [
      ["总览", "fa-house", "overview"],
      ["船坞", "fa-ship", "hangar"],
      ["仓库", "fa-warehouse", "cargo"],
      ["队列", "fa-list-check", "queue"],
      ["更多", "fa-bars", "more"]
    ];
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.dataset.tp = it[2];
      b.innerHTML = '<span class="ico"><i class="fa-solid ' + it[1] + '"></i></span><span>' + it[0] + "</span>";
      nav.appendChild(b);
    });
    document.body.appendChild(nav);

    function openDrawer() { sidebar.classList.add("open"); overlay.classList.add("show"); document.body.classList.add("tp-drawer-open"); }
    function closeDrawer() { sidebar.classList.remove("open"); overlay.classList.remove("show"); document.body.classList.remove("tp-drawer-open"); }

    menuBtn.addEventListener("click", function () {
      if (sidebar.classList.contains("open")) closeDrawer(); else openDrawer();
    });
    overlay.addEventListener("click", closeDrawer);

    /* 底部导航：复用现有 switchPage / switchSkill；更多打开抽屉 */
    nav.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var k = b.dataset.tp;
      nav.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
      if (k === "more") { b.classList.add("active"); openDrawer(); return; }
      b.classList.add("active");
      if (window.switchPage) {
        if (k === "overview") window.switchPage("skill");
        else window.switchPage(k);
      }
      closeDrawer();
    });

    /* 抽屉内导航点击后自动关闭（生产 line 2578 的 nav-item 监听负责真实跳转） */
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest(".nav-item")) setTimeout(closeDrawer, 60);
    });

    hookActivityStrip();
    hookHangar();
  }

  /* ============================================================
     船坞移动端「单舰焦点」重构（只读 getHangarDisplayState 构建）
     - 不改动生产 renderHangarPanel 桌面输出（仅在 ≤820px 覆盖）
     - 不写 gameState：当前舰船 / 过滤 / 页签仅存 UI 临时变量
     - 复用正式 data-enhance-ship / data-ship-action / data-open-fitting / data-open-3d
     - 复用 openEquipOrbit / enhanceShipFromHangar / dispatchGameAction
     ============================================================ */
  var _tpCurrentShipId = null;
  var _tpHangarFilter = "all";
  var _tpHangarTab = "overview";

  function tpRoleOf(ship) {
    if (ship.archaeology) return { key: "archaeology", cls: "role-arch", label: "考古" };
    if (ship.industrial) return { key: "industrial", cls: "role-ind", label: "工业" };
    return { key: "combat", cls: "role-combat", label: "战斗" };
  }
  function tpFilterShips(display, filter) {
    var list = display.ships.slice();
    if (filter === "combat") list = list.filter(function (s) { return !s.industrial && !s.archaeology; });
    else if (filter === "industrial") list = list.filter(function (s) { return s.industrial; });
    else if (filter === "archaeology") list = list.filter(function (s) { return s.archaeology; });
    return list;
  }
  function tpEnsureRoot(panel) {
    var root = document.getElementById("tp-hangar-root");
    if (!root) { root = document.createElement("div"); root.id = "tp-hangar-root"; root.className = "tp-hangar-root"; if (panel) panel.appendChild(root); }
    return root;
  }
  function tpHangarThumb(ship) {
    // 优先级：正式缩略图(getHangarThumb) → 角色化 fallback（图标+舰名+舰型+深蓝渐变+点击查看3D）。
    // 不创建第二套 WebGL renderer。
    var roleIco = ship.industrial ? "🏭" : ship.archaeology ? "🛰️" : "🚀";
    var fb = '<div class="tp-3d-fallback" data-open-3d="' + ship.instanceId + '">'
      + '<span class="tp-3d-fb-ico">' + roleIco + '</span>'
      + '<span class="tp-3d-fb-name">' + ship.name + '</span>'
      + '<span class="tp-3d-fb-type">' + ship.tier + " " + ship.typeName + '</span>'
      + '<span class="tp-3d-fb-tip">点击查看 3D</span>'
      + '</div>';
    var u = null;
    try { u = window.getHangarThumb ? window.getHangarThumb(ship.shipId) : null; } catch (e) {}
    var img = u ? '<img class="tp-hangar-3d-img" data-open-3d="' + ship.instanceId + '" src="' + u + '" alt="' + ship.name + '" title="点击查看 3D 模型" onerror="this.style.display=\'none\'">' : '';
    return fb + img;
  }
  function tpShipMeta(display, ship) {
    var r = tpRoleOf(ship);
    var roleTag = '<span class="tp-htag ' + r.cls + '">' + r.label + "</span>";
    var lvTag = '<span class="tp-htag tp-lv">强化 +' + ship.enhancement.level + "</span>";
    var duty = ship.assignedActions.length ? ship.assignedActions.map(function (k) { return display.actionNames[k]; }).join(" · ") : "无岗位";
    var dutyTag = '<span class="tp-htag tp-duty">📋 ' + duty + "</span>";
    var repair = ship.repairing ? '<span class="tp-htag tp-repair">🔧 维修中 · 剩 ' + ship.repairRemaining + "s</span>" : "";
    return '<div class="tp-hangar-meta">' + roleTag + lvTag + dutyTag + repair + "</div>";
  }
  function tpSelectorHTML(display, ship) {
    var filtered = tpFilterShips(display, _tpHangarFilter);
    var chips = filtered.map(function (s) {
      var r = tpRoleOf(s);
      var cur = s.instanceId === ship.instanceId ? " current" : "";
      var dot = '<span class="tp-chip-dot ' + r.cls + '"></span>';
      var assigned = s.assignedActions.length ? '<span class="tp-chip-assigned" title="已指派">●</span>' : "";
      var thumb = null;
      try { thumb = window.getHangarThumb ? window.getHangarThumb(s.shipId) : null; } catch (e) {}
      var thumbHtml = '<span class="tp-chip-vis">'
        + '<span class="tp-chip-ico">' + (s.industrial ? "🏭" : s.archaeology ? "🛰️" : "🚀") + '</span>'
        + (thumb ? '<img class="tp-chip-thumb" src="' + thumb + '" alt="" onerror="this.style.display=\'none\'">' : '')
        + '</span>';
      return '<button class="tp-hangar-chip' + cur + '" data-ship-chip="' + s.instanceId + '">' + thumbHtml + '<span class="tp-chip-name">' + s.name + '</span><span class="tp-chip-lv">+' + s.enhancement.level + '</span>' + dot + assigned + "</button>";
    }).join("");
    return '<div class="tp-hangar-selector">' + chips + "</div>";
  }
  function tpStatsHTML(ship) {
    var hp = ship.hp;
    return '<div class="tp-stat-grid">'
      + '<div class="tp-stat"><span class="tp-stat-l">护盾</span><span class="tp-stat-v shield">' + hp.shield + "</span></div>"
      + '<div class="tp-stat"><span class="tp-stat-l">装甲</span><span class="tp-stat-v armor">' + hp.armor + "</span></div>"
      + '<div class="tp-stat"><span class="tp-stat-l">结构</span><span class="tp-stat-v hull">' + hp.structure + "</span></div>"
      + '<div class="tp-stat"><span class="tp-stat-l">闪避</span><span class="tp-stat-v">' + ship.dodge + "</span></div>"
      + '<div class="tp-stat"><span class="tp-stat-l">速度</span><span class="tp-stat-v speed">' + ship.speed + "</span></div>"
      + "</div>";
  }
  function tpOverviewHTML(display, ship) {
    var bonus = window.getHangarBonusText ? window.getHangarBonusText(ship.bonuses) : "";
    var bonusHtml = bonus ? '<div class="tp-box"><div class="tp-box-t">舰船加成</div><div class="tp-box-b">' + bonus + "</div></div>" : '<div class="tp-empty">无舰船加成</div>';
    var task = ship.assignedActions.length ? ship.assignedActions.map(function (k) { return display.actionNames[k]; }).join(" · ") : "";
    var taskHtml = task ? '<div class="tp-box"><div class="tp-box-t">当前任务</div><div class="tp-box-b">' + task + "</div></div>" : '<div class="tp-empty">无当前任务</div>';
    var repairHtml = ship.repairing ? '<div class="tp-box tp-repair-box"><div class="tp-box-t">维修状态</div><div class="tp-box-b">🔧 自动维修中 · 剩余 ' + ship.repairRemaining + " 秒</div></div>" : "";
    return tpStatsHTML(ship) + bonusHtml + taskHtml + repairHtml;
  }
  function tpFittingHTML(display, ship) {
    var fit = null;
    try { fit = window.getShipFittingDisplayState(window.gameState, ship.instanceId); } catch (e) {}
    var rows = "";
    if (fit) {
      ["high", "mid", "low", "rig"].forEach(function (type) {
        var slots = fit.orbitSlots.filter(function (o) { return o.type === type; });
        var total = slots.filter(function (o) { return o.enabled; }).length;
        var inst = slots.filter(function (o) { return o.enabled && o.equipmentId; });
        var installed = inst.length;
        var detail = installed > 0 ? (installed + " 件已装 · 例：" + inst[0].name) : "空槽";
        var name = { high: "高槽", mid: "中槽", low: "低槽", rig: "改装件" }[type];
        rows += '<div class="tp-fit-row"><span class="tp-fit-type">' + name + '</span><span class="tp-fit-count">' + installed + "/" + total + '</span><span class="tp-fit-detail">' + detail + "</span></div>";
      });
    } else { rows = '<div class="tp-empty">无法读取装配数据</div>'; }
    return '<div class="tp-fit-list">' + rows + '</div><button class="tp-manage-equip btn" data-open-fitting="' + ship.instanceId + '">🔧 管理装备</button>';
  }
  function tpEnhanceHTML(display, ship) {
    var e = ship.enhancement;
    if (!e.available) return '<div class="tp-empty">该舰船暂无可强化部件</div>';
    var next = window.getEnhancementNextText ? window.getEnhancementNextText(e) : "";
    var bonus = window.getEnhancementBonusText ? window.getEnhancementBonusText(e) : "";
    var mats = e.materials.map(function (m) { return '<span class="tp-mat' + (m.enough ? "" : " short") + '">' + m.name + " " + m.stock + "/" + m.quantity + "</span>"; }).join("");
    // 星币消耗（与桌面 enhance-material 同口径：iskEnough 不足时 short 红字）
    var iskLine = e.iskCost > 0
      ? '<span class="tp-mat' + (e.iskEnough ? "" : " short") + '">💰 星币 ' + e.iskStock.toLocaleString() + "/" + e.iskCost.toLocaleString() + "</span>"
      : "";
    var label = e.busy ? "执行任务中" : (e.available ? "强化至 +" + (e.level + 1) : "暂不可强化");
    var dis = e.canEnhance ? "" : "disabled";
    // 星币不足时显式提示（不只在 canEnhance 暗中禁用按钮）
    var insufficientNote = (e.iskCost > 0 && !e.iskEnough)
      ? '<div class="tp-enh-insufficient">⚠ 星币不足，无法强化（需 ' + e.iskCost.toLocaleString() + "）</div>"
      : "";
    return '<div class="tp-enh-card">'
      + '<div class="tp-enh-top"><span class="tp-enh-lv">强化 +' + e.level + '</span><span class="tp-enh-next">' + (e.milestone ? "★ 里程碑 · " : "") + next + "</span></div>"
      + (bonus ? '<div class="tp-enh-bonus">' + bonus + "</div>" : "")
      + '<div class="tp-enh-meta"><span>成功率 <b>' + e.chancePercent + "%</b></span><span>成功 " + e.successXp + " XP · 失败 " + e.failureXp + " XP 并清零</span></div>"
      + '<div class="tp-enh-mats">' + mats + iskLine + "</div>"
      + insufficientNote
      + '<button class="tp-enh-btn btn" data-enhance-ship="' + ship.instanceId + '" ' + dis + ">" + label + "</button></div>";
  }
  function tpAssignmentHTML(display, ship) {
    var groups = [
      { title: "工业", keys: ["mining", "gasHarvesting"] },
      { title: "探索", keys: ["archaeology"] },
      { title: "作战", keys: ["combat"] }
    ];
    var occupied = {};
    display.ships.forEach(function (s) { if (s.instanceId !== ship.instanceId) s.assignedActions.forEach(function (k) { occupied[k] = true; }); });
    var html = "";
    groups.forEach(function (g) {
      html += '<div class="tp-assign-group"><div class="tp-assign-gt">' + g.title + "</div>";
      g.keys.forEach(function (key) {
        var a = null;
        ship.assignments.forEach(function (x) { if (x.actionKey === key) a = x; });
        if (!a) return;
        var cls = "act-tag", title = "", disabled = "";
        if (a.active) { cls += " on"; title = "点击解除"; }
        else if (a.locked) { cls += " unavailable"; disabled = "disabled"; title = a.lockedReason || "舰型不兼容"; }
        else if (occupied[key]) { cls += " occ"; title = "被其他舰船占用"; }
        else { title = "分配至此任务"; }
        html += '<button class="' + cls + '" data-ship-action="' + key + '" data-sid="' + ship.instanceId + '" title="' + title + '" ' + disabled + ">" + a.name + "</button>";
      });
      html += "</div>";
    });
    return html;
  }
  function tpDismantleHTML(display, ship) {
    var d = ship.dismantle || { available:false, preview:[], canDismantle:false, blockedText:"" };
    if (!d.available) return '<div class="tp-empty">该舰船没有可拆解配方</div>';
    var preview = (d.preview || []).map(function (p) {
      return '<li class="tp-dismantle-item">' + p.name + " ×" + p.returned + "</li>";
    }).join("");
    var blocked = (!d.canDismantle && d.blockedText)
      ? '<div class="tp-dismantle-blocked">⚠ ' + d.blockedText + "</div>"
      : "";
    var btn = '<button class="tp-dismantle-btn btn danger" data-dismantle-ship="' + ship.instanceId + '" ' + (d.canDismantle ? "" : "disabled") + ">🗑 拆解此舰船（不可恢复）</button>";
    return '<div class="tp-dismantle-card">'
      + '<div class="tp-dismantle-warn">拆解后舰船将<b>永久消失</b>，仅归还约 50% 已消耗材料：</div>'
      + '<ul class="tp-dismantle-preview">' + (preview || '<li class="tp-dismantle-item">无材料可归还</li>') + "</ul>"
      + blocked
      + btn
      + "</div>";
  }
  function tpTabBodyHTML(display, ship) {
    if (_tpHangarTab === "fitting") return tpFittingHTML(display, ship);
    if (_tpHangarTab === "enhancement") return tpEnhanceHTML(display, ship);
    if (_tpHangarTab === "assignment") return tpAssignmentHTML(display, ship);
    if (_tpHangarTab === "dismantle") return tpDismantleHTML(display, ship);
    return tpOverviewHTML(display, ship);
  }
  function tpEmptyHTML() {
    return '<div class="tp-hangar-empty">'
      + '<div class="tp-empty-ship">🚀</div>'
      + '<div class="tp-empty-title">尚无可用舰船</div>'
      + '<div class="tp-empty-desc">在舰船工程中制造第一艘舰船</div>'
      + '<button class="tp-empty-cta btn primary" data-go-skill="shipEngineering">前往舰船工程</button>'
      + '<div class="tp-empty-hint">新玩家可按新手引导制造启程级</div>'
      + "</div>";
  }
  function tpFiltersHTML() {
    var tabs = [["all", "全部"], ["combat", "战斗"], ["industrial", "工业"], ["archaeology", "考古"]];
    return '<div class="tp-hangar-filters">' + tabs.map(function (t) { return '<button class="tp-filter' + (_tpHangarFilter === t[0] ? " active" : "") + '" data-tp-filter="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</div>";
  }
  function tpTabsHTML() {
    var t = [["overview", "概览"], ["fitting", "装备"], ["enhancement", "强化"], ["assignment", "指派"], ["dismantle", "拆解"]];
    return '<div class="tp-hangar-tabs">' + t.map(function (x) { return '<button class="tp-htab' + (_tpHangarTab === x[0] ? " active" : "") + '" data-tp-htab="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>";
  }
  /* 装备弹窗环带中央：注入当前舰真实 getHangarThumb 缩略图（移动端）。
     作为 #equipOrbitWrapper 的子节点（svg 的兄弟），不会被 buildOrbit 的 svg.innerHTML="" 清除；
     覆盖层 pointer-events:none 不阻挡槽位点击；不创建第二个 WebGL renderer。 */
  function tpPopulateOrbitCenter(instId) {
    var wrap = document.getElementById("equipOrbitWrapper");
    if (!wrap) return;
    var center = wrap.querySelector(".tp-orbit-center");
    if (!center) { center = document.createElement("div"); center.className = "tp-orbit-center"; wrap.appendChild(center); }
    var ship = null;
    try { var disp = window.getHangarDisplayState(window.gameState, Date.now()); if (disp) ship = disp.ships.filter(function (s) { return s.instanceId === instId; })[0]; } catch (e) {}
    if (!ship) { center.style.display = "none"; return; }
    var roleIco = ship.archaeology ? "🛰️" : ship.industrial ? "🏭" : "🚀";
    var url = null;
    try { url = window.getHangarThumb ? window.getHangarThumb(ship.shipId) : null; } catch (e) {}
    if (url) {
      center.innerHTML = '<img class="tp-orbit-center-img" src="' + url + '" alt="' + ship.name + '" title="点击查看 3D 模型" onerror="this.style.display=\'none\'">'
        + '<div class="tp-orbit-center-name">' + ship.name + '</div>'
        + '<div class="tp-orbit-center-tier">' + ship.tier + " " + ship.typeName + '</div>';
    } else {
      center.innerHTML = '<div class="tp-orbit-center-fb"><span class="tp-orbit-center-fb-ico">' + roleIco + '</span><span class="tp-orbit-center-fb-txt">3D 预览暂不可用</span></div>'
        + '<div class="tp-orbit-center-name">' + ship.name + '</div>';
    }
    center.style.display = "";
  }
  function mobileRenderHangarPanel() {
    var panel = document.getElementById("hangar-panel");
    if (!panel) return;
    panel.style.display = "flex";
    var display = window.getHangarDisplayState(window.gameState, Date.now());
    var info = document.getElementById("hangar-header-info");
    if (info) info.textContent = "已拥有 " + display.count + " 艘舰船";
    var grid = document.getElementById("hangar-ship-grid");
    var empty = document.getElementById("hangar-empty");
    if (grid) grid.style.display = "none";
    if (empty) empty.style.display = "none";
    var root = tpEnsureRoot(panel);
    root.style.display = "block";

    if (!_tpCurrentShipId || !display.ships.some(function (s) { return s.instanceId === _tpCurrentShipId; })) {
      _tpCurrentShipId = display.ships.length ? display.ships[0].instanceId : null;
    }
    // 过滤器激活时，若当前舰不在该过滤集合内，则自动选中集合内第一艘
    var _tpFiltered = tpFilterShips(display, _tpHangarFilter);
    if (_tpFiltered.length && !_tpFiltered.some(function (s) { return s.instanceId === _tpCurrentShipId; })) {
      _tpCurrentShipId = _tpFiltered[0].instanceId;
    }
    if (!_tpHangarTab) _tpHangarTab = "overview";
    if (!_tpHangarFilter) _tpHangarFilter = "all";

    if (!display.ships.length) { root.innerHTML = tpEmptyHTML(); root.setAttribute("data-current-ship", ""); return; }
    var ship = null;
    display.ships.forEach(function (s) { if (s.instanceId === _tpCurrentShipId) ship = s; });
    if (!ship) ship = display.ships[0];
    root.setAttribute("data-current-ship", ship.instanceId);
    root.innerHTML =
      tpFiltersHTML()
      + '<div class="tp-hangar-main">'
        + '<div class="tp-hangar-main-head"><span class="tp-hangar-name">' + ship.name + '</span><span class="tp-hangar-tier">' + ship.tier + " " + ship.typeName + "</span></div>"
        + tpShipMeta(display, ship)
        + '<div class="tp-hangar-3d">' + tpHangarThumb(ship) + "</div>"
      + "</div>"
      + tpSelectorHTML(display, ship)
      + tpTabsHTML()
      + '<div class="tp-hangar-tabbody">' + tpTabBodyHTML(display, ship) + "</div>";
  }
  function hookHangar() {
    tpEnsureRoot(document.getElementById("hangar-panel"));
    var _orig = window.renderHangarPanel;
    window.renderHangarPanel = function () {
      if (onMobile()) { mobileRenderHangarPanel(); return; }
      if (_orig) _orig();
      var root = document.getElementById("tp-hangar-root"); if (root) root.style.display = "none";
      var g = document.getElementById("hangar-ship-grid"); if (g) g.style.display = "";
      var em = document.getElementById("hangar-empty"); if (em) em.style.display = "";
    };
    var root = document.getElementById("tp-hangar-root");
    if (root && !root.dataset.tpHooked) {
      root.dataset.tpHooked = "1";
      root.addEventListener("click", function (e) {
        var t = e.target;
        var chip = t.closest("[data-ship-chip]");
        if (chip) { _tpCurrentShipId = chip.getAttribute("data-ship-chip"); mobileRenderHangarPanel(); return; }
        var htab = t.closest("[data-tp-htab]");
        if (htab) { _tpHangarTab = htab.getAttribute("data-tp-htab"); mobileRenderHangarPanel(); return; }
        var filt = t.closest("[data-tp-filter]");
        if (filt) { _tpHangarFilter = filt.getAttribute("data-tp-filter"); mobileRenderHangarPanel(); return; }
        var enh = t.closest("[data-enhance-ship]");
        if (enh) { window.enhanceShipFromHangar(enh.getAttribute("data-enhance-ship")); return; }
        var dism = t.closest("[data-dismantle-ship]");
        if (dism) { window.dismantleShipFromHangar(dism.getAttribute("data-dismantle-ship")); return; }
        var act = t.closest("[data-ship-action]");
        if (act) {
          var res = window.dispatchGameAction(window.gameState, { type: "hangar/toggleAssignment", instanceId: act.getAttribute("data-sid"), actionKey: act.getAttribute("data-ship-action") }, Date.now());
          if (!res.changed) {
            var msgs = { "repairing": "舰船自动维修中，暂时不能更换战斗舰", "unsupported-mining": "该舰船没有采矿岗位", "unsupported-gas": "该舰船没有采气岗位", "unsupported-archaeology": "该舰船没有考古扫描能力", "unsupported-refining": "只有工业支援舰可以承担冶炼岗位", "unsupported-task": "该任务不需要分配舰船岗位", "ship-active": "舰船正在执行任务，停止当前任务后才能重新分配" };
            if (window.showToast) window.showToast(msgs[res.reason] || "分配失败");
          } else { window.renderHangarPanel(); if (window.renderCombatPanel) window.renderCombatPanel(); }
          return;
        }
        var fit = t.closest("[data-open-fitting]");
        if (fit) { window.openEquipOrbit(fit.getAttribute("data-open-fitting")); return; }
        var go = t.closest("[data-go-skill]");
        if (go) { if (window.switchSkill) window.switchSkill(go.getAttribute("data-go-skill")); return; }
      });
    }
    // 装备弹窗打开时隐藏底栏/抽屉/教程（不影响生产 openEquipOrbit/closeEquipOrbit 逻辑）。
    var eqModal = document.getElementById("equipOrbitModal");
    if (eqModal && !eqModal.dataset.tpObs) {
      eqModal.dataset.tpObs = "1";
      var syncEquipOpen = function () {
        if (eqModal.classList.contains("active")) document.body.classList.add("tp-equip-open");
        else document.body.classList.remove("tp-equip-open");
      };
      var mo = new MutationObserver(syncEquipOpen);
      mo.observe(eqModal, { attributes: true, attributeFilter: ["class"] });
      syncEquipOpen();
    }
    // 包裹 openEquipOrbit：拿到实例 id 后注入环带中央真实缩略图（不改动生产装配逻辑）。
    var _origOpenEquip = window.openEquipOrbit;
    if (_origOpenEquip && !_origOpenEquip.__tpWrapped) {
      _origOpenEquip.__tpWrapped = true;
      window.openEquipOrbit = function (ref) {
        var r = _origOpenEquip.apply(this, arguments);
        try { tpPopulateOrbitCenter(ref); } catch (e) {}
        return r;
      };
    }
  }

  /* 顶部活动状态条（方案 B）：仅窄屏（≤820px）显示并刷新。
     复用正式 getCurrentActivityDisplayState（文案含展示名+图标+等级+动作+进行中）
     与 getActiveActionProgressDisplayState（percent / etaText）；
     每 ~100ms 刷新，与桌面顶部迷你进度条同频，避免只在事件触发时跳变。
     严格门控：onMobile() 为假时直接返回，桌面不显示也不刷新。 */
  function tpUpdateActivityStrip() {
    if (!onMobile() || !_tpActStrip || !window.gameState) return;
    var act = null, prog = null;
    try { act = window.getCurrentActivityDisplayState(window.gameState, Date.now()); } catch (e) {}
    try { prog = window.getActiveActionProgressDisplayState(window.gameState, Date.now()); } catch (e) {}
    if (!act) return;
    if (!act.active) {
      _tpActStrip.classList.add("idle", "no-progress");
      if (_tpActIcon) _tpActIcon.textContent = "⏸";
      if (_tpActLabel) _tpActLabel.textContent = "待命";
      if (_tpActPct) _tpActPct.textContent = "";
      if (_tpActEta) _tpActEta.textContent = "";
      if (_tpActFill) _tpActFill.style.width = "0%";
      return;
    }
    var isCombat = act.key === "combat";
    _tpActStrip.classList.remove("idle");
    _tpActStrip.classList.toggle("no-progress", isCombat);
    var cps = Array.from(act.text || "");
    if (_tpActIcon) _tpActIcon.textContent = cps[0] || "";
    if (_tpActLabel) _tpActLabel.textContent = cps.slice(1).join("").replace(/^\s+/, "");
    if (isCombat) {
      if (_tpActPct) _tpActPct.textContent = "";
      if (_tpActEta) _tpActEta.textContent = "";
      if (_tpActFill) _tpActFill.style.width = "0%";
    } else {
      var pct = prog ? Number(prog.percent) || 0 : 0;
      pct = Math.max(0, Math.min(100, pct));
      if (_tpActPct) _tpActPct.textContent = Math.floor(pct) + "%";
      if (_tpActEta) _tpActEta.textContent = (prog && prog.etaText) ? prog.etaText : "";
      if (_tpActFill) _tpActFill.style.width = pct + "%";
    }
  }
  function hookActivityStrip() {
    function loop(t) {
      if (onMobile() && t - _tpLastStripFrame >= 100) {
        _tpLastStripFrame = t;
        tpUpdateActivityStrip();
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  /* ---------- 测试/QA 句柄（无副作用，仅供自动化审计与 ?qa=1 调用） ---------- */
  window.TapTapPortrait = {
    tpRoleOf: tpRoleOf,
    tpShipMeta: tpShipMeta,
    tpEnhanceHTML: tpEnhanceHTML,
    tpDismantleHTML: tpDismantleHTML,
    tpUpdateActivityStrip: tpUpdateActivityStrip,
    get currentShipId() { return _tpCurrentShipId; },
    get hangarFilter() { return _tpHangarFilter; },
    get hangarTab() { return _tpHangarTab; },
    get activityStripText() { return _tpActLabel ? _tpActLabel.textContent : ""; },
    get activityStripPercent() { return _tpActPct ? _tpActPct.textContent : ""; }
  };

  /* ---------- 启动 ---------- */
  function boot() { init(); }
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
