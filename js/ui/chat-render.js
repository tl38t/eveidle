(function (root) {
  "use strict";

  /*
   * 聊天面板渲染（CHAT_SYSTEM_SPEC.md v0.2 §4/§12-W3 配套）。
   *
   * 铁律遵守：
   *   * 内联 <script> 恒早于 defer 模块 ⇒ 本文件不在加载期抓任何全局、不起定时器、不发请求；
   *     唯一入口 window.syncChatDock()，由 shell-render 在导航渲染时调用（与 alliance-render 同模式）。
   *   * flag 短路（§11.2）：ChatAPI.isAvailable()=false 时只渲染提示、不起定时器。
   *   * 轮询仅停靠条展开时运行：tick 自检面板 display，被收起即自停（§9 决策 ④）。
   *   * 状态全部挂本闭包，不污染 window.gameState 等共享对象。
   *
   * 形态（v0.3）：底部停靠条（非独立页），可展开/收起，开合状态记 localStorage。
   * 屏蔽（§9 决策 ③）：本地 localStorage，仅影响自己的渲染，不通知对方。
   */

  var POLL_MS = 3000;              // 轮询间隔（§9 决策 ④：2~3s，取 3s）
  var ALLIANCE_TTL_MS = 120000;    // 盟信息缓存（聊天只需要 id / owner_player_id）
  var BLOCK_KEY = "eve_idle_chat_blocks";
  var DOCK_KEY = "eve_idle_chat_dock_open";   // 停靠条开合状态（本机偏好，非存档数据）
  var REPORT_REASONS = [["spam", "广告刷屏"], ["harass", "骚扰辱骂"], ["hate", "仇恨言论"], ["other", "其他"]];

  var state = {
    timer: null,
    alliance: null,
    allianceAt: 0,
    channel: "",
    messages: [],        // 正序（服务端倒序返回后 reverse）
    oldestId: null,      // 已加载的最小 id（加载更早的游标）
    newestId: 0,
    hasMore: false,
    blocked: [],
    reportTarget: null,  // 正在选举报原因的消息 id
    adminOpen: false,
    reports: [],
    sending: false,
    dockOpen: false,     // 底部停靠条是否展开
    error: "",
    notice: ""
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtTime(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    var h = new Date(t).getHours(), m = new Date(t).getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  // ------------------------------------------------------------ 本地屏蔽 ----

  function loadBlocks() {
    try {
      var raw = JSON.parse(root.localStorage.getItem(BLOCK_KEY) || "[]");
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch (_) { return []; }
  }

  function saveBlocks() {
    try { root.localStorage.setItem(BLOCK_KEY, JSON.stringify(state.blocked)); } catch (_) {}
  }

  function isBlocked(uid) { return state.blocked.indexOf(String(uid)) >= 0; }

  function toggleBlock(uid, name) {
    uid = String(uid);
    if (isBlocked(uid)) {
      state.blocked = state.blocked.filter(function (x) { return x !== uid; });
      state.notice = "已解除对 " + (name || uid) + " 的屏蔽";
    } else {
      state.blocked.push(uid);
      state.notice = "已屏蔽 " + (name || uid) + "（本机生效，可在其消息原位解除）";
    }
    saveBlocks();
    render();
  }

  // ------------------------------------------------------------ 数据流 ----

  function api() { return root.ChatAPI || null; }

  // 盟信息（id + owner）缓存读取；TTL 过期或未取过时拉取。无盟返回 null。
  function ensureAlliance() {
    var A = root.AllianceApi;
    if (!A || typeof A.getAlliance !== "function") return Promise.resolve(null);
    if (state.alliance && (Date.now() - state.allianceAt) < ALLIANCE_TTL_MS) return Promise.resolve(state.alliance);
    return A.getAlliance().then(function (alliance) {
      state.alliance = alliance || null;
      state.allianceAt = Date.now();
      state.channel = alliance && alliance.id ? "alliance:" + alliance.id : "";
      return state.alliance;
    }).catch(function () { return state.alliance || null; });
  }

  function mergeMessages(rows) {
    var known = {};
    state.messages.forEach(function (m) { known[m.id] = true; });
    var added = 0;
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || known[row.id]) return;
      known[row.id] = true;
      state.messages.push(row);
      if (row.id > state.newestId) state.newestId = row.id;
      added++;
    });
    if (added) state.messages.sort(function (a, b) { return a.id - b.id; });
    return added;
  }

  function loadLatest() {
    if (!state.channel || !api()) return Promise.resolve();
    return api().list(state.channel).then(function (res) {
      mergeMessages(res && res.messages);
      state.hasMore = (res && res.messages ? res.messages.length : 0) >= 30;
      if (state.messages.length) state.oldestId = state.messages[0].id;
      state.error = "";
      render();
    }).catch(function (error) {
      state.error = error && error.message || "拉取消息失败";
      render();
    });
  }

  function loadMore() {
    if (!state.channel || !state.oldestId || !api()) return;
    return api().list(state.channel, state.oldestId).then(function (res) {
      var rows = res && res.messages || [];
      mergeMessages(rows);
      state.hasMore = rows.length >= 30;
      if (state.messages.length) state.oldestId = state.messages[0].id;
      render();
    }).catch(function (error) {
      state.error = error && error.message || "加载更早消息失败";
      render();
    });
  }

  function sendMessage(text) {
    if (state.sending || !state.channel || !api()) return;
    state.sending = true;
    state.error = "";
    render();
    api().send(state.channel, text).then(function (res) {
      state.sending = false;
      if (res && res.message) mergeMessages([res.message]);  // 乐观上屏，轮询按 id 去重
      // 清空输入框必须发生在 render() **之前**：render() 以 live DOM 值为真值来源，
      // 否则刚发出去的内容会被 restoreComposer 原样恢复回输入框。
      var live = document.getElementById("chat-input");
      if (live) live.value = "";
      render();
      var input = document.getElementById("chat-input");
      if (input) input.focus();
    }).catch(function (error) {
      state.sending = false;
      state.error = error && error.message || "发送失败";
      render();   // 失败时不清空：内容原样留在输入框，玩家可直接重试
    });
  }

  function submitReport(messageId, reason) {
    if (!api()) return;
    api().report(messageId, reason).then(function () {
      state.reportTarget = null;
      state.notice = "举报已提交，盟主将在审核面板处理";
      render();
    }).catch(function (error) {
      state.error = error && error.message || "举报失败";
      render();
    });
  }

  function adminLoad() {
    if (!api()) return;
    api().adminReports("pending").then(function (res) {
      state.reports = res && res.reports || [];
      render();
    }).catch(function (error) {
      state.error = error && error.message || "拉取举报失败";
      render();
    });
  }

  function adminHandle(reportId, action, muteScope, muteHours) {
    if (!api()) return;
    api().adminAction(reportId, action, muteScope, muteHours).then(function () {
      state.notice = action === "dismiss" ? "已忽略该举报"
        : action === "delete_msg" ? "已删除该消息"
        : "已禁言（" + (muteHours ? muteHours + " 小时" : (muteScope === "global" ? "全频道永久" : "本频道永久")) + "）";
      adminLoad();
    }).catch(function (error) {
      state.error = error && error.message || "处置失败";
      render();
    });
  }

  // ------------------------------------------------------------ 轮询 ----

  function startPolling() {
    if (state.timer) return;
    state.timer = root.setInterval(pollTick, POLL_MS);
  }

  function stopPolling() {
    if (state.timer) { root.clearInterval(state.timer); state.timer = null; }
  }

  function panelVisible() {
    var panel = document.getElementById("chat-panel");
    return !!panel && panel.style.display !== "none";
  }

  function pollTick() {
    // 自停闸：面板被 shell 隐藏（玩家切走页面）即停轮询，零空转。
    if (!panelVisible()) { stopPolling(); return; }
    // 标签页后台：跳过本次拉取但保留定时器（回来即可续）。
    if (root.document && root.document.hidden) return;
    if (!state.channel) return;
    loadLatest();
  }

  // ------------------------------------------------------------ 渲染 ----

  function msgRow(m, selfUid) {
    var self = String(m.sender_uid) === String(selfUid);
    var actions = "";
    if (!self && !isBlocked(m.sender_uid)) {
      actions = '<span class="chat-msg-actions">'
        + '<button data-chat-report="' + esc(m.id) + '">举报</button>'
        + '<button data-chat-block="' + esc(m.sender_uid) + '" data-chat-block-name="' + esc(m.sender_name) + '">屏蔽</button>'
        + '</span>';
    } else if (isBlocked(m.sender_uid)) {
      actions = '<span class="chat-msg-actions"><button data-chat-block="' + esc(m.sender_uid) + '" data-chat-block-name="' + esc(m.sender_name) + '">解除屏蔽</button></span>';
    }
    var reasons = "";
    if (state.reportTarget === m.id) {
      reasons = '<span class="chat-report-reasons">举报原因：'
        + REPORT_REASONS.map(function (r) {
          return '<button data-chat-reason="' + r[0] + '" data-chat-reason-target="' + esc(m.id) + '">' + r[1] + '</button>';
        }).join("")
        + '<button data-chat-reason-cancel="1">取消</button></span>';
    }
    return '<div class="chat-msg' + (self ? " self" : "") + '">'
      + '<span class="chat-msg-name">' + esc(m.sender_name) + '</span>'
      + '<span class="chat-msg-text">' + esc(m.content) + '</span>'
      + '<span class="chat-msg-time">' + fmtTime(m.created_at) + '</span>'
      + actions + reasons
      + '</div>';
  }

  function renderAdminSection(selfUid) {
    var alliance = state.alliance;
    var isOwner = !!(alliance && String(alliance.owner_player_id) === String(selfUid));
    if (!isOwner) return "";
    var body;
    if (!state.adminOpen) {
      body = '<button data-chat-admin-open="1">打开举报审核</button>';
    } else if (!state.reports.length) {
      body = '<button data-chat-admin-close="1">收起</button><div class="chat-admin-empty">暂无待处理举报</div>';
    } else {
      body = '<button data-chat-admin-close="1">收起</button>'
        + state.reports.map(function (r) {
          return '<div class="chat-admin-report">'
            + '#' + esc(r.report_id) + ' ' + esc(r.sender_name) + '：「' + esc(String(r.content || "").slice(0, 40)) + '」 · 原因：' + esc(r.reason)
            + '<span class="chat-admin-actions">'
            + '<button data-chat-act="dismiss" data-chat-rid="' + esc(r.report_id) + '">忽略</button>'
            + '<button data-chat-act="delete_msg" data-chat-rid="' + esc(r.report_id) + '">删消息</button>'
            + '<button data-chat-act="mute" data-chat-rid="' + esc(r.report_id) + '" data-chat-scope="channel" data-chat-hours="1">禁言1h</button>'
            + '<button data-chat-act="mute" data-chat-rid="' + esc(r.report_id) + '" data-chat-scope="global" data-chat-hours="24">全频道禁言24h</button>'
            + '</span></div>';
        }).join("");
    }
    return '<div class="chat-admin-section"><div class="chat-admin-head"><i class="fa-solid fa-shield-halved"></i> 盟主审核</div>' + body + '</div>';
  }

  // 输入框（composer）状态保持。
  //
  // 🔴 修复（2026-10-01，真实 bug）：render() 每次整块重写 content.innerHTML，
  //   `#chat-input` 会被销毁重建；而 3s 轮询每轮都走到 loadLatest() → render()。
  //   ⇒ 玩家打到一半、尚未发送的内容，最迟 3s 后被新空节点冲掉（焦点与光标一并丢失）。
  //   修法：渲染前把「值 + 焦点 + 光标」快照下来，渲染后回写。
  //   ⚠️ 由此确立一条约定：**render() 一律以「渲染那一刻的 live DOM 值」为真值来源**，
  //   任何「想清空输入框」的代码必须**在调用 render() 之前**清（见 sendMessage 成功分支）。
  function captureComposer() {
    var el = document.getElementById("chat-input");
    if (!el) return null;
    return {
      value: el.value,
      start: el.selectionStart,
      end: el.selectionEnd,
      focused: document.activeElement === el
    };
  }

  function restoreComposer(snap) {
    if (!snap) return;
    var el = document.getElementById("chat-input");
    if (!el) return;
    el.value = snap.value;
    if (!snap.focused) return;          // 焦点不在输入框时不抢焦点（例如玩家刚点了「屏蔽」）
    el.focus();
    try { el.setSelectionRange(snap.start, snap.end); } catch (_) {}
  }

  function render() {
    var content = document.getElementById("chat-content");
    if (!content) return;
    var C = api();
    var selfUid = C ? C.getPlayerId() : "";

    if (!C || !C.isAvailable()) {
      content.innerHTML = '<div class="chat-blocked-line">聊天暂不可用：需要 Steam 登录状态（且已接入联盟服务）。</div>';
      stopPolling();
      return;
    }

    // 消息列表的滚动位置保持：重建 innerHTML 前记录，渲染后恢复（近底部则贴底）。
    var listEl = document.getElementById("chat-msg-list");
    var wasNearBottom = false, prevScroll = 0;
    if (listEl) {
      prevScroll = listEl.scrollTop;
      wasNearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 60;
    }

    if (!state.channel) {
      content.innerHTML = '<div class="chat-blocked-line">正在获取联盟信息…</div>';
      return;
    }

    var self = state.alliance || {};
    var visible = state.messages.filter(function (m) { return !isBlocked(m.sender_uid) || String(m.sender_uid) === String(selfUid); });
    var blockedCount = state.messages.length - visible.length;

    var html = '<div class="chat-channel-line"><span>'
      + esc(self.name || "联盟") + ' · 频道 #' + esc(self.id || "")
      + '</span><span>' + (state.sending ? "发送中…" : "") + '</span></div>';

    html += '<div class="chat-msg-list" id="chat-msg-list">';
    if (state.hasMore) html += '<div class="chat-more-row"><button data-chat-more="1">加载更早的消息</button></div>';
    if (blockedCount > 0) html += '<div class="chat-blocked-line">已屏蔽 ' + blockedCount + ' 条被屏蔽玩家的消息（本机设置）</div>';
    html += visible.length
      ? visible.map(function (m) { return msgRow(m, selfUid); }).join("")
      : '<div class="chat-blocked-line">还没有消息，说点什么吧。</div>';
    html += '</div>';

    html += '<div class="chat-input-row">'
      + '<input id="chat-input" type="text" maxlength="280" placeholder="输入消息（1~280 字，Enter 发送）" autocomplete="off">'
      + '<button class="btn" id="chat-send">发送</button>'
      + '</div>';

    html += '<div class="chat-status-line' + (state.error ? " error" : "") + '">'
      + (state.error ? esc(state.error) : esc(state.notice))
      + '</div>';

    html += renderAdminSection(selfUid);

    var composerSnap = captureComposer();   // 必须在重写 innerHTML 之前（旧节点此刻还活着）
    content.innerHTML = html;
    restoreComposer(composerSnap);

    var newList = document.getElementById("chat-msg-list");
    if (newList) {
      if (wasNearBottom) newList.scrollTop = newList.scrollHeight;
      else newList.scrollTop = prevScroll;
    }

    bindChatEvents(content);
  }

  // ------------------------------------------------------------ 事件 ----

  function bindChatEvents(content) {
    if (content.dataset.chatBound === "1") return;   // 委托绑定一次；按钮在重建的 innerHTML 里
    content.dataset.chatBound = "1";

    content.addEventListener("click", function (event) {
      var target = event.target.closest("button");
      if (!target) return;

      var input = document.getElementById("chat-input");
      if (target.id === "chat-send") {
        // 清空交给 sendMessage（必须在 render 之前清）；此处只负责取值。
        if (input && input.value.trim()) sendMessage(input.value.trim());
        return;
      }
      if (target.dataset.chatMore) { loadMore(); return; }
      if (target.dataset.chatReport) { state.reportTarget = Number(target.dataset.chatReport); state.notice = ""; render(); return; }
      if (target.dataset.chatReason) { submitReport(Number(target.dataset.chatReasonTarget), target.dataset.chatReason); return; }
      if (target.dataset.chatReasonCancel) { state.reportTarget = null; render(); return; }
      if (target.dataset.chatBlock) { toggleBlock(target.dataset.chatBlock, target.dataset.chatBlockName); return; }
      if (target.dataset.chatAdminOpen) { state.adminOpen = true; adminLoad(); return; }
      if (target.dataset.chatAdminClose) { state.adminOpen = false; state.reports = []; render(); return; }
      if (target.dataset.chatAct) {
        adminHandle(Number(target.dataset.chatRid), target.dataset.chatAct, target.dataset.chatScope || null,
          target.dataset.chatHours ? Number(target.dataset.chatHours) : null);
        return;
      }
    });

    content.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      var input = document.getElementById("chat-input");
      if (input && event.target === input && input.value.trim()) {
        sendMessage(input.value.trim());   // 同上：清空由 sendMessage 负责
      }
    });
  }

  // ------------------------------------------------------------ 停靠条入口 ----

  // 唯一入口：shell-render 每次导航渲染时调用 window.syncChatDock()（成功门控后短路）。
  // 本文件因此保持**加载期零副作用**：不抓全局、不起定时器、不发网络请求。
  // 平台判定必须在此处（调用时）做——platform-runtime.js 晚于本文件加载，加载期读不到。
  // 返回 true 表示已完成门控并绑定（含非 steam 的隐藏），供调用方置一次性 flag。
  function syncChatDock() {
    var dock = document.getElementById("chat-dock");
    var P = root.PlatformRuntime;
    if (!dock || !P || typeof P.getPlatform !== "function") return false;

    if (P.getPlatform() !== "steam") {
      // §11.2 flag 短路：非 Steam 平台整条隐藏且不执行任何聊天逻辑（零网络、零定时器）。
      dock.style.display = "none";
      stopPolling();
      return true;
    }

    dock.style.display = "";
    if (dock.dataset.chatDockBound !== "1") {
      dock.dataset.chatDockBound = "1";
      var bar = document.getElementById("chat-dock-toggle");
      if (bar) {
        bar.addEventListener("click", function () { setDockOpen(!state.dockOpen, true); });
        bar.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setDockOpen(!state.dockOpen, true); }
        });
      }
      // 恢复上次开合状态（首次运行默认收起 ⇒ 不产生任何启动期请求）。
      setDockOpen(readDockOpen(), false);
    }
    return true;
  }

  function readDockOpen() {
    try { return root.localStorage.getItem(DOCK_KEY) === "1"; } catch (_) { return false; }
  }

  function saveDockOpen(open) {
    try { root.localStorage.setItem(DOCK_KEY, open ? "1" : "0"); } catch (_) {}
  }

  // 展开/收起。展开时：起轮询（tick 自检面板可见性）+ 拉盟信息 + 首次拉消息。
  // 收起时：停轮询（零空转）。persist=true 才写 localStorage（恢复态不回写，避免无谓写盘）。
  function setDockOpen(open, persist) {
    state.dockOpen = !!open;
    var dock = document.getElementById("chat-dock");
    var panel = document.getElementById("chat-panel");
    var bar = document.getElementById("chat-dock-toggle");
    if (dock) dock.classList.toggle("is-open", state.dockOpen);
    if (bar) bar.setAttribute("aria-expanded", state.dockOpen ? "true" : "false");
    if (panel) panel.style.display = state.dockOpen ? "block" : "none";
    if (persist) saveDockOpen(state.dockOpen);

    if (!state.dockOpen) { stopPolling(); return; }

    var C = api();
    if (!C || !C.isAvailable()) { state.error = ""; render(); return; }

    startPolling();
    ensureAlliance().then(function (alliance) {
      if (!state.dockOpen) return;          // 期间被收起：放弃本次渲染
      if (!alliance) {
        state.error = "";
        render();
        var content = document.getElementById("chat-content");
        if (content) content.innerHTML = '<div class="chat-blocked-line">加入联盟后开放聊天。</div>';
        return;
      }
      if (!state.messages.length) loadLatest();
      else { render(); loadLatest(); }
    });
  }

  root.syncChatDock = syncChatDock;
})(typeof window !== "undefined" ? window : globalThis);
