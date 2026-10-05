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
  var BG_POLL_MS = 12000;          // 非当前频道的未读探测间隔（折叠/切 tab 时降频，成本可控）
  var ALLIANCE_TTL_MS = 120000;    // 盟信息缓存（聊天只需要 id / owner_player_id）
  var BLOCK_KEY = "eve_idle_chat_blocks";
  var DOCK_KEY = "eve_idle_chat_dock_open";   // 停靠条开合状态（本机偏好，非存档数据）
  var REPORT_REASONS = [["spam", "广告刷屏"], ["harass", "骚扰辱骂"], ["hate", "仇恨言论"], ["other", "其他"]];

  var WORLD_CHANNEL = "world";
  var ALLIANCE_TAB = "alliance";

  /*
   * 频道桶：每个频道一份独立的消息/游标/未读数。
   * 🔴 为什么按桶存而不是共用一份 messages：切 tab 时若共用，切回来会看到
   *   另一个频道的消息（id 游标与 channel 混用 ⇒ mergeMessages 按 id 去重会
   *   把「同 id 不同频道」误判为重复而丢消息）。分桶后各频道历史互不污染。
   */
  function newBucket() {
    return { messages: [], oldestId: null, newestId: 0, hasMore: false, unread: 0, primed: false };
  }

  var state = {
    timer: null,
    bgTimer: null,
    alliance: null,
    allianceAt: 0,
    // 🔴 2026-10-04（TapTap 公会聊天卡在"加入联盟后开放"的根因）：
    // AllianceApi.getAlliance() 是**四步串行**请求（成员 → 联盟 → 建筑 → 建设），
    // 任一步失败即整体 reject。旧代码在 catch 里 `return state.alliance || null`
    // —— 该值本来就是 null，等于**把真实失败原因静默吞掉**，于是：
    //   state.alliance 恒为 null → 公会频道 id 派生不出 → 频道恒空
    //   → 每 3s 轮询重试一次、每次都被吞 ⇒ 面板永久卡在"加入联盟后开放公会聊天"，
    //   而同时联盟页（走**另一条"云端回传"链路**）能正常显示 LEA ⇒ 两处自相矛盾。
    // 现在显式区分三种状态并把原因透出，避免"看起来是没加盟，实际是拉取失败"。
    allianceFetchState: "idle",   // idle | ok | none | failed
    allianceError: "",            // failed 时的可读原因（渲染到面板上，便于自助排查）
    allianceRetryAt: 0,           // failed 后的退避重试时间戳（避免 3s 空转打服务端）
    activeTab: ALLIANCE_TAB,  // 停靠条当前选中的频道 tab（世界 / 公会）
    buckets: { world: newBucket(), alliance: newBucket() },
    blocked: [],
    reportTarget: null,  // 正在选举报原因的消息 id
    adminOpen: false,
    reports: [],
    sending: false,
    dockOpen: false,     // 底部停靠条是否展开
    mountEl: null,       // 聊天挂载目标（联盟面板「聊天」tab 容器；null=停靠条 #chat-content）
    error: "",
    notice: ""
  };

  // 当前生效的消息桶。联盟面板 tab 恒为公会频道（mountMode 语义），不跟停靠条串台。
  function curBucket() {
    return state.buckets[state.mountEl ? ALLIANCE_TAB : state.activeTab] || state.buckets[ALLIANCE_TAB];
  }

  function bucketOf(tab) {
    return state.buckets[tab] || state.buckets[ALLIANCE_TAB];
  }

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

  // 渲染挂载点：联盟面板 tab 把容器注入 state.mountEl；否则回退停靠条 #chat-content。
  function contentEl() {
    return state.mountEl || document.getElementById("chat-content");
  }

  // 拉取失败后的退避重试间隔（渐进，避免 3s 轮询把服务端打满）。
  var ALLIANCE_RETRY_BACKOFF_MS = [4000, 8000, 15000, 30000];

  // 盟信息（id + owner）缓存读取；TTL 过期或未取过时拉取。无盟返回 null。
  function ensureAlliance() {
    var A = root.AllianceApi;
    if (!A || typeof A.getAlliance !== "function") return Promise.resolve(null);
    if (state.alliance && (Date.now() - state.allianceAt) < ALLIANCE_TTL_MS) return Promise.resolve(state.alliance);
    // 🔴 退避：失败后不要立刻重试（此前 3s 轮询会连续打服务端且每次都被静默吞）。
    if (state.allianceFetchState === "failed" && Date.now() < state.allianceRetryAt) {
      return Promise.resolve(state.alliance || null);
    }
    return A.getAlliance().then(function (alliance) {
      state.alliance = alliance || fallbackAlliance() || null;
      state.allianceAt = Date.now();
      // "确实没加盟"与"拉取失败"必须分开：前者是稳定事实（不该反复重试），
      // 后者是瞬时故障（该退避重试）。旧代码把两者都归一成 alliance=null。
      state.allianceFetchState = state.alliance ? "ok" : "none";
      state.allianceError = "";
      state.allianceErrorRetryCount = 0;
      // 公会频道 id 随联盟信息派生；无盟则为空（公会 tab 随之不可用）。
      bucketOf(ALLIANCE_TAB).channel = state.alliance && state.alliance.id ? "alliance:" + state.alliance.id : "";
      // 当前停在公会 tab 但已无盟 ⇒ 退回世界频道，避免面板卡在空频道。
      if (!state.mountEl && state.activeTab === ALLIANCE_TAB && !bucketOf(ALLIANCE_TAB).channel) {
        state.activeTab = WORLD_CHANNEL;
      }
      return state.alliance;
    }).catch(function (error) {
      // 🔴 旧实现在此 `return state.alliance || null`（恒为 null）⇒ 失败被完全吞掉，
      //   面板永远停在"加入联盟后开放"，玩家无从判断是没加盟还是网络失败。
      // 现在：记录可读原因 + 退避，并让 render() 把原因显示出来。
      state.allianceFetchState = "failed";
      var msg = (error && (error.message || error.errMsg)) || String(error || "未知错误");
      state.allianceError = String(msg).slice(0, 120);
      var n = state.allianceErrorRetryCount || 0;
      state.allianceErrorRetryCount = Math.min(n + 1, ALLIANCE_RETRY_BACKOFF_MS.length);
      state.allianceRetryAt = Date.now() + ALLIANCE_RETRY_BACKOFF_MS[state.allianceErrorRetryCount - 1];
      // 🔴 关键：即使直读失败，只要本地已有「云端回传」的联盟 id（TapTap 走云端网页
      //   创建/加入后用 ?allianceId= 回传，alliance-render.js 已写入 gameState.alliance），
      //   就仍然能派生频道 id ⇒ 公会聊天可用。只有两条路都拿不到才算真的不可用。
      var fallback = fallbackAlliance();
      if (fallback) {
        state.alliance = fallback;
        bucketOf(ALLIANCE_TAB).channel = "alliance:" + fallback.id;
      }
      return state.alliance || null;
    });
  }

  // 从 gameState.alliance 派生联盟信息（TapTap「云端回传」链路的共享出口）。
  // AllianceApi.getAlliance() 走 PostgREST 直读 alliance_members；在 TapTap 端
  // 该直读可能拿不到数据（会话 token / 网络 / 权限任一环节失败），
  // 但联盟页此时已从 URL 回传参数写好了 gameState.alliance.allianceId
  // （alliance-render.js:1090）。聊天只需 id + 名称，不重复请求。
  function fallbackAllianceFromGameState() {
    var a = root.gameState && root.gameState.alliance;
    var id = a && (a.allianceId != null ? a.allianceId : a.id);
    if (!id || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
    return { id: Number(id), name: a.name || a.code || "联盟", owner_player_id: a.ownerPlayerId || "" };
  }

  // TapTap 云端页回传时联盟 ID 也写在 URL 参数里（?allianceId=45&allianceCode=LEA）。
  // gameState.alliance 的回写依赖 loadAfterIdentity 异步链路，可能晚于聊天挂载；
  // URL 参数在页面加载瞬间即可读，作为第二兜底避免频道 ID 恒空。
  function fallbackAllianceFromUrl() {
    try {
      var params = new URLSearchParams(root.location && root.location.search || "");
      var id = params.get("allianceId");
      if (!id || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
      return { id: Number(id), name: params.get("allianceCode") || "联盟", owner_player_id: params.get("allianceOwner") || "" };
    } catch (_) { return null; }
  }

  function fallbackAlliance() {
    return fallbackAllianceFromGameState() || fallbackAllianceFromUrl();
  }

  // 某 tab 对应的实际频道 id；空串表示该 tab 当前不可用（无盟 / 未登录）。
  function channelOf(tab) {
    if (tab === WORLD_CHANNEL) return WORLD_CHANNEL;   // 世界频道无需联盟
    return bucketOf(ALLIANCE_TAB).channel;
  }

  // 频道展示名（tab 栏与频道线共用）。
  function channelLabel(tab) {
    if (tab === WORLD_CHANNEL) return "世界频道";
    var a = state.alliance || {};
    return (a.name || "联盟") + " · 频道 #" + (a.id || "");
  }

  // 🔴 频道不可用时的提示文案（2026-10-04）。
  // 旧实现只按"有没有盟"给一句「加入联盟后开放公会聊天。」，于是**拉取失败与
  // 真的没加盟显示同一句话**——TapTap 玩家已加入 LEA 却看到该提示，无从判断真因。
  // 现在按 allianceFetchState 区分，并附上重试中的说明与真实错误（供自助排查 / 反馈）。
  function unavailableText(tab) {
    if (tab === WORLD_CHANNEL) return "世界频道暂不可用。";
    if (state.allianceFetchState === "failed") {
      var retryIn = Math.max(0, Math.ceil((state.allianceRetryAt - Date.now()) / 1000));
      return "公会聊天加载失败，正在重试"
        + (retryIn > 0 ? "（" + retryIn + " 秒后）" : "…")
        + "。若持续失败，请检查网络后重新进入联盟页。";
    }
    if (state.allianceFetchState === "idle") return "正在读取联盟信息…";
    return "加入联盟后开放公会聊天。";
  }

  // 当前渲染目标对应的 tab（联盟面板挂载时恒为公会）。
  function currentTab() {
    return state.mountEl ? ALLIANCE_TAB : state.activeTab;
  }

  // 合并新消息到**指定桶**。countOnly=true 时只累计未读、不写入消息列表
  //（后台探测非当前频道用：只要知道"有几条新的"，不把消息拉进内存）。
  function mergeMessages(rows, bucket, countOnly) {
    bucket = bucket || curBucket();
    var known = {};
    if (!countOnly) bucket.messages.forEach(function (m) { known[m.id] = true; });
    var added = 0;
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      if (!countOnly && known[row.id]) return;
      if (countOnly) {
        // 已读水位线：不高于 newestId 的都是自己已渲染过的
        if (bucket.primed && row.id <= bucket.newestId) return;
        added++;
        if (row.id > bucket.newestId) bucket.newestId = row.id;
        return;
      }
      known[row.id] = true;
      bucket.messages.push(row);
      if (row.id > bucket.newestId) bucket.newestId = row.id;
      added++;
    });
    if (added && !countOnly) bucket.messages.sort(function (a, b) { return a.id - b.id; });
    return added;
  }

  function loadLatest() {
    var bucket = curBucket();
    var channel = channelOf(currentTab());
    if (!channel || !api()) return Promise.resolve();
    return api().list(channel).then(function (res) {
      mergeMessages(res && res.messages, bucket, false);
      bucket.hasMore = (res && res.messages ? res.messages.length : 0) >= 30;
      if (bucket.messages.length) bucket.oldestId = bucket.messages[0].id;
      bucket.unread = 0;
      bucket.primed = true;
      state.error = "";
      render();
    }).catch(function (error) {
      state.error = error && error.message || "拉取消息失败";
      render();
    });
  }

  function loadMore() {
    var bucket = curBucket();
    var channel = channelOf(currentTab());
    if (!channel || !bucket.oldestId || !api()) return;
    return api().list(channel, bucket.oldestId).then(function (res) {
      var rows = res && res.messages || [];
      mergeMessages(rows, bucket, false);
      bucket.hasMore = rows.length >= 30;
      if (bucket.messages.length) bucket.oldestId = bucket.messages[0].id;
      render();
    }).catch(function (error) {
      state.error = error && error.message || "加载更早消息失败";
      render();
    });
  }

  // 切频道：清空当前桶的临时态（错误/举报选单/审核面板），载入目标频道。
  // 未读数随 loadLatest 成功而归零。
  function switchChannel(tab) {
    if (tab !== WORLD_CHANNEL && tab !== ALLIANCE_TAB) return;
    if (tab === state.activeTab) return;
    if (tab === ALLIANCE_TAB && !channelOf(ALLIANCE_TAB)) {
      state.notice = "加入联盟后才能使用公会频道";
      render();
      return;
    }
    state.activeTab = tab;
    state.error = "";
    state.notice = "";
    state.reportTarget = null;
    state.adminOpen = false;
    state.reports = [];
    render();
    loadLatest();
  }

  function sendMessage(text) {
    var bucket = curBucket();
    var channel = channelOf(currentTab());
    if (state.sending || !channel || !api()) return;
    state.sending = true;
    state.error = "";
    render();
    api().send(channel, text).then(function (res) {
      state.sending = false;
      if (res && res.message) mergeMessages([res.message], bucket, false);  // 乐观上屏，轮询按 id 去重
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
      // 世界频道无盟主处置通道（审核后置），文案如实说明只进留档。
      state.notice = currentTab() === WORLD_CHANNEL
        ? "举报已提交，平台会尽快核查处理"
        : "举报已提交，盟主将在审核面板处理";
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
    startBgPolling();
  }

  function stopPolling() {
    if (state.timer) { root.clearInterval(state.timer); state.timer = null; }
    stopBgPolling();
  }

  // 后台未读探测：只对**非当前**频道拉最近 1 条（limit=1），用来点亮 tab 角标。
  // 🔴 成本控制：12s 一次、limit=1、且仅在停靠条展开时跑；不写入消息列表。
  function startBgPolling() {
    if (state.bgTimer) return;
    state.bgTimer = root.setInterval(bgPollTick, BG_POLL_MS);
  }

  function stopBgPolling() {
    if (state.bgTimer) { root.clearInterval(state.bgTimer); state.bgTimer = null; }
  }

  function panelVisible() {
    if (state.mountEl) return !!state.mountEl.offsetParent;  // 联盟 tab：容器在 DOM 且可见才轮询
    var panel = document.getElementById("chat-panel");
    return !!panel && panel.style.display !== "none";
  }

  function pollTick() {
    // 自停闸：面板被 shell 隐藏（玩家切走页面）即停轮询，零空转。
    if (!panelVisible()) { stopPolling(); return; }
    // 标签页后台：跳过本次拉取但保留定时器（回来即可续）。
    if (root.document && root.document.hidden) return;
    var channel = channelOf(currentTab());
    if (!channel) return;
    loadLatest();
  }

  // 联盟面板 tab 内不探测未读（那里只有一个频道，tab 栏也不显示）。
  function bgPollTick() {
    if (state.mountEl) return;
    if (!panelVisible()) return;
    if (root.document && root.document.hidden) return;
    if (!api()) return;
    var other = state.activeTab === WORLD_CHANNEL ? ALLIANCE_TAB : WORLD_CHANNEL;
    var channel = channelOf(other);
    if (!channel) return;
    var bucket = bucketOf(other);
    api().list(channel, null, 1).then(function (res) {
      var rows = res && res.messages || [];
      if (!rows.length) return;
      var added = mergeMessages(rows, bucket, true);
      if (added) {
        bucket.unread += added;
        renderTabBar();     // 只刷 tab 栏，不动消息区（避免打断正在输入的玩家）
      }
    }).catch(function () { /* 后台探测失败静默：不打扰玩家 */ });
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
    // 🔴 盟主审核只对公会频道成立：世界频道无联盟归属，chat_admin_handle_report
    //   会因 chat_alliance_id_of('world')=null 直接 raise ⇒ 这里显示按钮也是死的。
    if (currentTab() !== ALLIANCE_TAB) return "";
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
    var el = contentEl() && contentEl().querySelector("#chat-input");
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
    var el = contentEl() && contentEl().querySelector("#chat-input");
    if (!el) return;
    el.value = snap.value;
    if (!snap.focused) return;          // 焦点不在输入框时不抢焦点（例如玩家刚点了「屏蔽」）
    el.focus();
    try { el.setSelectionRange(snap.start, snap.end); } catch (_) {}
  }

  // 频道 tab 栏（仅停靠条形态；联盟面板 tab 内不显示——那里只有公会一个频道）。
  // 形制参考同类游戏的频道切换条：横向 tab + 未读角标。
  function tabBarHtml() {
    if (state.mountEl) return "";
    var tabs = [
      { key: WORLD_CHANNEL, label: "世界", enabled: true },
      { key: ALLIANCE_TAB, label: "公会", enabled: !!channelOf(ALLIANCE_TAB) }
    ];
    return '<div class="chat-tabs">' + tabs.map(function (t) {
      var b = bucketOf(t.key);
      var active = state.activeTab === t.key;
      var cls = "chat-tab" + (active ? " active" : "") + (t.enabled ? "" : " disabled");
      var badge = (!active && b.unread > 0) ? '<span class="chat-tab-badge">' + (b.unread > 99 ? "99+" : b.unread) + '</span>' : "";
      return '<button class="' + cls + '" data-chat-tab="' + t.key + '"' + (t.enabled ? "" : " disabled") + '>'
        + esc(t.label) + badge + '</button>';
    }).join("") + '</div>';
  }

  // 只重画 tab 栏（后台未读探测用），不碰消息区与输入框。
  function renderTabBar() {
    if (state.mountEl) return;
    var bar = document.querySelector("#chat-content .chat-tabs");
    if (!bar) { render(); return; }
    var content = contentEl();
    var composerSnap = captureComposer();
    bar.outerHTML = tabBarHtml();
    restoreComposer(composerSnap);
    if (content) bindChatEvents(content);
  }

  function render() {
    var content = contentEl();
    if (!content) return;
    var C = api();
    var selfUid = C ? C.getPlayerId() : "";
    var bucket = curBucket();
    var tab = currentTab();

    if (!C || !C.isAvailable()) {
      content.innerHTML = '<div class="chat-blocked-line">聊天暂不可用：需要登录状态（且已接入联盟服务）。</div>';
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

    if (!channelOf(tab)) {
      content.innerHTML = tabBarHtml()
        + '<div class="chat-blocked-line">' + unavailableText(tab) + '</div>';
      return;
    }

    var visible = bucket.messages.filter(function (m) { return !isBlocked(m.sender_uid) || String(m.sender_uid) === String(selfUid); });
    var blockedCount = bucket.messages.length - visible.length;

    var html = tabBarHtml();

    html += '<div class="chat-channel-line"><span>'
      + esc(channelLabel(tab))
      + '</span><span>' + (state.sending ? "发送中…" : "") + '</span></div>';

    html += '<div class="chat-msg-list" id="chat-msg-list">';
    if (bucket.hasMore) html += '<div class="chat-more-row"><button data-chat-more="1">加载更早的消息</button></div>';
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

      var input = content.querySelector("#chat-input");
      if (target.id === "chat-send") {
        // 清空交给 sendMessage（必须在 render 之前清）；此处只负责取值。
        if (input && input.value.trim()) sendMessage(input.value.trim());
        return;
      }
      if (target.dataset.chatTab) { switchChannel(target.dataset.chatTab); return; }
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
      var input = content.querySelector("#chat-input");
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
      // 无盟也能聊：ensureAlliance 已把 activeTab 退回世界频道，这里只需载入即可。
      // （有盟时默认停在公会频道，行为与改动前一致。）
      if (!channelOf(currentTab())) { state.error = ""; render(); return; }
      if (!curBucket().messages.length) loadLatest();
      else { render(); loadLatest(); }
    });
  }

  // ------------------------------------------------------------ 联盟面板 tab 挂载 ----
  // 公会聊天作为「联盟」面板的「聊天」tab 嵌入（跨平台：Steam / TapTap 均可）。
  // 与停靠条共用同一套 state / 轮询 / 渲染逻辑，只是渲染目标换成传入的容器。
  function mountChatTab(container) {
    if (!container) return;
    state.mountEl = container;
    var C = api();
    if (!C || !C.isAvailable()) { render(); return; }
    startPolling();
    ensureAlliance().then(function (alliance) {
      if (!state.mountEl || state.mountEl !== container) return;  // 期间已切走/卸载
      // 联盟面板的「聊天」tab 语义上就是公会频道 ⇒ 无盟时如实提示，不回退世界频道。
      // 🔴 无论成功失败都要 render()：失败时把真实原因显示出来（见 unavailableText），
      //   旧实现只 render 成功路径，导致失败后一直停在旧文案「加入联盟后开放」。
      if (!alliance || !channelOf(ALLIANCE_TAB)) {
        render();
        return;
      }
      if (!bucketOf(ALLIANCE_TAB).messages.length) loadLatest();
      else { render(); loadLatest(); }
    });
  }

  function unmountChatTab() {
    state.mountEl = null;
    stopPolling();
    // Steam 端：停靠条仍可能开着，卸载 tab 后恢复停靠条轮询与渲染。
    var P = root.PlatformRuntime;
    if (P && typeof P.getPlatform === "function" && P.getPlatform() === "steam") {
      var dock = document.getElementById("chat-dock");
      if (dock && dock.classList.contains("is-open")) {
        startPolling();
        if (!curBucket().messages.length) ensureAlliance().then(function () { if (channelOf(currentTab())) loadLatest(); });
        else { render(); loadLatest(); }
      }
    }
  }

  root.syncChatDock = syncChatDock;
  root.mountChatTab = mountChatTab;
  root.unmountChatTab = unmountChatTab;
})(typeof window !== "undefined" ? window : globalThis);
