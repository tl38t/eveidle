/* ================================================================
   steam-leaderboard-provider.js — Steam 排行榜 Provider（占位 / 未接入）

   当前状态：仅实现 LeaderboardProvider 统一接口与 unavailable 状态返回。
   不引入 Steamworks SDK、不引用 Steam Web API、不发送任何 Steam 网络请求。

   设计纪律（严格不越界）：
   - 所有方法返回结构化 unavailable，绝不抛未处理异常。
   - 不修改 state / gameState / eve_idle_save / skills。
   - 不创建定时器，不自动上传，不做后台轮询。
   - 不引用 Steamworks SDK（steamworks.js / greenworks 等）任何符号。
   - 不引用 Steam Web API（api.steampowered.com）任何 URL。
   - 不发送任何网络请求（无 fetch / XMLHttpRequest / WebSocket 到 Steam）。
   - 为未来接入 Steam 保留明确 TODO，但不得影响 TapTap 与 local-only。

   自动选择优先级（见 leaderboard-sync-service.js）：
     1) TapTap 可用且已登录 -> TapTap Provider
     2) TapTap 不可用 -> Noop/Local Provider
     3) Steam 永远不参与自动选择，只保留占位接口。
   ================================================================ */
(function (root) {
  "use strict";

  function SteamLeaderboardProvider(/* opts */) {
    this._lastError = "steam-not-implemented";
    this._mode = "unavailable";
    this._connected = false;
  }

  SteamLeaderboardProvider.prototype.isAvailable = function () {
    return false; // 占位：当前永不可用
  };

  SteamLeaderboardProvider.prototype.initialize = function () {
    // 占位：不启动任何 Steam 会话，直接 resolve(false)
    // TODO(steam): 未来接入 Steamworks SDK 时，此处调用用户授权 / 初始化
    //   const client = require('steamworks.js'); // 不在此处 require
    //   ... 但当前阶段禁止引入
    this._mode = "unavailable";
    this._connected = false;
    return Promise.resolve(false);
  };

  SteamLeaderboardProvider.prototype.submitSnapshot = function (/* snapshot */) {
    // 占位：不向 Steam 上报任何数据
    // TODO(steam): 未来调用 Steamworks ISteamUserStats->SetScore / StoreStats
    this._lastError = "steam-not-implemented";
    return Promise.resolve({
      ok: false,
      status: "unavailable",
      mode: "unavailable",
      reason: "steam-not-implemented",
      message: "Steam 排行榜尚未接入",
    });
  };

  SteamLeaderboardProvider.prototype.fetchLeaderboard = function (/* boardId, options */) {
    // 占位：不向 Steam 请求任何榜单
    // TODO(steam): 未来调用 ISteamUserStats->DownloadScores / GetLeaderboardEntries
    return Promise.resolve({
      boardId: null,
      rows: [],
      status: "unavailable",
      mode: "unavailable",
      connected: false,
      reason: "steam-not-implemented",
      message: "Steam 排行榜尚未接入",
    });
  };

  SteamLeaderboardProvider.prototype.deleteLocalSnapshot = function () {
    // 占位：无本地 Steam 数据可删
    return Promise.resolve({
      ok: false,
      status: "unavailable",
      reason: "steam-not-implemented",
    });
  };

  SteamLeaderboardProvider.prototype.getProviderStatus = function () {
    return {
      connected: false,
      mode: "unavailable",
      lastError: this._lastError,
      platformName: "Steam",
      message: "Steam 排行榜尚未接入（暂未支持）",
    };
  };

  root.SteamLeaderboardProvider = SteamLeaderboardProvider;
  if (typeof window !== "undefined") window.SteamLeaderboardProvider = SteamLeaderboardProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = SteamLeaderboardProvider;
})(typeof window !== "undefined" ? window : globalThis);
