/* ================================================================
   NoopAchievementProvider — 无平台成就同步的本地模式

   普通浏览器 / 未来 Steam 未接入时，成就完全由本地 gameState 事实驱动，
   不向任何平台上报。所有方法安全 no-op（resolve），不影响本地成就与奖励。
   ================================================================ */
(function (root) {
  "use strict";

  function NoopAchievementProvider() {
    this._lastError = "local-only";
  }

  NoopAchievementProvider.prototype.isAvailable = function () { return false; };
  NoopAchievementProvider.prototype.initialize = function () { return Promise.resolve(false); };
  NoopAchievementProvider.prototype.unlock = function () { return Promise.resolve(false); };
  NoopAchievementProvider.prototype.setProgress = function () { return Promise.resolve(false); };
  NoopAchievementProvider.prototype.reconcile = function () { return Promise.resolve([]); };
  NoopAchievementProvider.prototype.getLastError = function () { return this._lastError; };

  root.NoopAchievementProvider = NoopAchievementProvider;
  if (typeof window !== "undefined") window.NoopAchievementProvider = NoopAchievementProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = NoopAchievementProvider;
})(typeof window !== "undefined" ? window : globalThis);
