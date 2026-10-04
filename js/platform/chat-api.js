(function (root) {
  "use strict";

  /*
   * 聊天前端 API 层（CHAT_SYSTEM_SPEC.md v0.2 §3/§12-W2 配套）。
   *
   * 铁律（§11.2 flag 短路三规范）：
   *   1. 加载期零副作用 —— 不抓全局、不起定时器、不发请求；
   *   2. 不污染全局 —— 仅暴露 window.ChatAPI 一个命名空间；
   *   3. flag 短路 —— 非 Steam 平台 isAvailable()=false，所有方法直接返回
   *      {ok:false, reason:"platform"}，不产生任何网络调用。
   *
   * 依赖（全部惰性读取，缺失时功能不可用而非报错）：
   *   PlatformRuntime.getPlatform()  平台判定（js/platform/platform-runtime.js）
   *   AllianceApi.getAllianceSessionToken() / getPlayerId() / getPlayerName()
   *                                  联盟身份（js/platform/alliance-api.js，只读复用，不改）
   */

  var ENV_ID = "deepspace-d4govx4ikc2e937c5";
  // 与 alliance-api.js 的 IDENTITY_GATEWAY 同域：chat-service 部署后网关路径为 /chat-service
  var CHAT_GATEWAY = "https://" + ENV_ID + "-1477691191.ap-shanghai.app.tcloudbase.com/chat-service";

  function platformName() {
    try {
      var runtime = root.PlatformRuntime;
      return runtime && typeof runtime.getPlatform === "function" ? String(runtime.getPlatform()) : "";
    } catch (_) { return ""; }
  }

  function sessionToken() {
    try {
      var api = root.AllianceApi;
      return api && typeof api.getAllianceSessionToken === "function" ? String(api.getAllianceSessionToken() || "") : "";
    } catch (_) { return ""; }
  }

  function playerId() {
    try {
      var api = root.AllianceApi;
      return api && typeof api.getPlayerId === "function" ? String(api.getPlayerId() || "") : "";
    } catch (_) { return ""; }
  }

  function playerName() {
    try {
      var api = root.AllianceApi;
      return api && typeof api.getPlayerName === "function" ? String(api.getPlayerName() || "") : "";
    } catch (_) { return ""; }
  }

  // 聊天可用性：Steam / TapTap 双端均可 + 已有联盟会话令牌。
  // 公会聊天是成员制 + 盟主可处置（举报/禁言/删消息），非匿名公开频道，
  // 因此国区口径下可接受（区别于世界聊天）。
  // 注意轮询/UI 层必须在 isAvailable()=false 时不启动任何定时器。
  function isAvailable() {
    var p = platformName();
    return (p === "steam" || p === "taptap") && !!sessionToken();
  }

  function unavailable() {
    return Promise.resolve({ ok: false, reason: "platform" });
  }

  function request(action, payload) {
    var headers = { "Content-Type": "application/json" };
    var token = sessionToken();
    if (token) headers["x-alliance-session"] = token;
    return root.fetch(CHAT_GATEWAY, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function (response) {
      return response.text().then(function (text) {
        var parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = null; }
        if (!response.ok || !parsed || !parsed.ok) {
          var error = new Error(parsed && parsed.error || "聊天服务请求失败（" + response.status + "）");
          error.status = response.status;
          throw error;
        }
        return parsed;
      });
    });
  }

  root.ChatAPI = {
    isAvailable: isAvailable,
    getPlatform: platformName,
    getPlayerId: playerId,
    getPlayerName: playerName,

    // 发消息。返回 {ok, message}；被禁言等业务错误经 error.message 透出（DB 中文原文）。
    send: function (channel, content) {
      if (!isAvailable()) return unavailable();
      return request("send", { channel: channel, content: content });
    },

    // 拉历史。beforeId 为游标（上页最小 id）；返回消息为倒序，由 UI 正序渲染。
    list: function (channel, beforeId, limit) {
      if (!isAvailable()) return unavailable();
      return request("list", { channel: channel, beforeId: beforeId, limit: limit });
    },

    // 举报消息。reason: 'spam' | 'harass' | 'hate' | 'other'
    report: function (targetId, reason, detail) {
      if (!isAvailable()) return unavailable();
      return request("report", { targetId: targetId, reason: reason, detail: detail });
    },

    // 盟主：拉举报列表。status 缺省 'pending'。
    adminReports: function (status, limit) {
      if (!isAvailable()) return unavailable();
      return request("admin_reports", { status: status, limit: limit });
    },

    // 盟主：处置举报。action: 'dismiss' | 'delete_msg' | 'mute'。
    adminAction: function (reportId, action, muteScope, muteHours, muteReason) {
      if (!isAvailable()) return unavailable();
      return request("admin_action", {
        reportId: reportId,
        action: action,
        muteScope: muteScope,
        muteHours: muteHours,
        muteReason: muteReason
      });
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
