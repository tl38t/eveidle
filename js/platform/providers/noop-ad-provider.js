/* ================================================================
   NoopAdProvider — 无平台广告能力时的本地回退

   普通浏览器 / 未来 Steam 未接入广告时，所有广告调用安全降级：
   - 不访问网络、不调用 TapTap / Steam / Electron SDK。
   - 不修改 gameState / eve_idle_save / skills。
   - 返回结构化 "local-only"，让业务层知道未触发真实广告。

   职责边界（严格不越界）：
   - 所有方法安全 no-op，失败结构化返回，绝不抛未处理异常。
   - getProviderStatus 明确返回 mode:"local-only"，供 UI 显示。
   ================================================================ */
(function (root) {
  "use strict";

  function NoopAdProvider() {
    this._lastError = null;
    this._mode = "local-only";
  }

  NoopAdProvider.prototype.isAvailable = function () { return false; };

  NoopAdProvider.prototype.initialize = function () {
    return Promise.resolve(false);
  };

  // 本地模式不展示真实广告，直接返回未奖励状态。
  // 业务层仍按统一回调触发 onClose / onError（与真实广告行为一致）。
  NoopAdProvider.prototype.showRewardedVideo = function (slotKey, callbacks) {
    const cb = callbacks || {};
    try {
      if (typeof cb.onClose === "function") {
        cb.onClose({ isEnded: false, reason: "local-only" });
      }
    } catch (e) { /* ignore */ }
    this._lastError = null;
    return Promise.resolve({
      ok: false,
      status: "local-only",
      rewarded: false,
      reason: "no-platform-connected",
      message: "未连接广告平台，本次未展示真实广告"
    });
  };

  NoopAdProvider.prototype.getProviderStatus = function () {
    return {
      connected: false,
      mode: "local-only",
      lastError: this._lastError,
      platformName: "local",
      message: "本地模式：未连接 TapTap / Steam 广告"
    };
  };

  root.NoopAdProvider = NoopAdProvider;
  if (typeof window !== "undefined") window.NoopAdProvider = NoopAdProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = NoopAdProvider;
})(typeof window !== "undefined" ? window : globalThis);
