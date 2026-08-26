/* ================================================================
   taptap-ad-provider.js — TapTap 激励视频广告 Provider

   实现 AdProvider 契约：
     showRewardedVideo(slotKey, callbacks)
     isAvailable()
     initialize()
     getProviderStatus()

   平台接入事实（来自 TapTap 小游戏官方文档）：
   - 全局对象：tap（无需 SDK，直接使用）
   - 创建：const rewardedVideoAd = tap.createRewardedVideoAd({ adUnitId })
           单例：多次调用返回同一个实例
   - 展示：rewardedVideoAd.show() 返回 Promise
   - 事件：onLoad / onError / onClose
   - 关闭回调参数：{ isEnded: boolean }，仅当 isEnded===true 时才应发奖
   - 若 show()  rejected（素材未加载），推荐：load().then(() => show())

   设计纪律（严格不越界）：
   - 不修改 state.skills / 技能等级 / 经验 / gameState / eve_idle_save。
   - 不把敏感信息写入前端；adUnitId 仅来自 AdPlatformConfig。
   - 所有方法安全捕获异常，失败结构化返回，绝不抛未处理异常。
   - 不创建 setInterval / setTimeout 做后台轮询；单次广告内部 Promise 超时
     由调用方控制，本 provider 只转发 SDK 事件。
   ================================================================ */
(function (root) {
  "use strict";

  function getConfig() {
    try {
      if (typeof window !== "undefined" && window.AdPlatformConfig)
        return window.AdPlatformConfig;
    } catch (e) { /* ignore */ }
    try {
      if (typeof require !== "undefined") return require("../ad-platform-config.js");
    } catch (e) { /* ignore */ }
    return null;
  }

  function getTap() {
    try {
      if (typeof window !== "undefined" && window.tap) return window.tap;
    } catch (e) { /* ignore */ }
    return null;
  }

  function TaptapAdProvider() {
    this._lastError = null;       // 字符串：初始化/配置类错误
    this._lastAdError = null;     // 对象：最近一次 SDK onError / load-show 失败的原始错误（结构化）
    this._usedAdUnitId = null;    // 最近一次请求实际使用的 adUnitId
    this._mode = "local-only";
    this._connected = false;
    this._available = false;
    this._ads = {};      // slotKey -> rewardedVideoAd instance
    this._loaded = {};   // slotKey -> boolean
    this._pending = {};  // slotKey -> { resolve, callbacks }
  }

  TaptapAdProvider.prototype.isAvailable = function () {
    return this._available;
  };

  TaptapAdProvider.prototype.initialize = function () {
    const tap = getTap();
    const cfg = getConfig();
    const can = !!(tap && typeof tap.createRewardedVideoAd === "function" && cfg);
    this._available = can;
    this._connected = can;
    this._mode = can ? "taptap" : "local-only";
    if (can) this._lastError = null;
    return Promise.resolve(can);
  };

  // 取/创建激励视频广告实例；配置缺失或 tap 不可用时返回 null。
  TaptapAdProvider.prototype._ensureAd = function (slotKey) {
    const cfg = getConfig();
    if (!cfg || typeof cfg.resolveAdUnitId !== "function") {
      this._lastError = "ad-config-unavailable";
      return null;
    }
    const adUnitId = cfg.resolveAdUnitId(slotKey);
    if (!adUnitId) {
      this._lastError = "ad-unit-id-missing:" + String(slotKey);
      return null;
    }
    this._usedAdUnitId = adUnitId;
    if (this._ads[slotKey]) return this._ads[slotKey];

    const tap = getTap();
    if (!tap || typeof tap.createRewardedVideoAd !== "function") {
      this._lastError = "tap-ad-unavailable";
      return null;
    }

    const self = this;
    try {
      const ad = tap.createRewardedVideoAd({ adUnitId: adUnitId });
      this._ads[slotKey] = ad;
      this._loaded[slotKey] = false;

      // 创建后立即预加载；TapTap 文档说组件会自动拉取，但沙盒/真机经常出现首次 show() 无素材，
      // 主动 load() 可让 onLoad/onError 提前触发，后续 show() 更稳。
      try { ad.load(); } catch (e) { /* ignore: load 失败由 onError 处理 */ }

      ad.onLoad(function () {
        self._loaded[slotKey] = true;
        try {
          const pending = self._pending[slotKey];
          if (pending && typeof pending.callbacks.onLoad === "function") {
            pending.callbacks.onLoad();
          }
        } catch (e) { /* ignore */ }
      });

      ad.onError(function (err) {
        self._loaded[slotKey] = false;
        self._recordAdError(err, slotKey);
        const pending = self._pending[slotKey];
        if (pending) {
          self._pending[slotKey] = null;
          try {
            if (typeof pending.callbacks.onError === "function") {
              pending.callbacks.onError(err);
            }
          } catch (e2) { /* ignore */ }
          pending.resolve({
            ok: false,
            status: "error",
            rewarded: false,
            reason: "ad-error",
            error: self._lastError
          });
        }
      });

      ad.onClose(function (res) {
        const pending = self._pending[slotKey];
        if (pending) {
          self._pending[slotKey] = null;
          const rewarded = !!(res && res.isEnded);
          try {
            if (typeof pending.callbacks.onClose === "function") {
              pending.callbacks.onClose({ isEnded: rewarded, rewarded: rewarded });
            }
          } catch (e) { /* ignore */ }
          pending.resolve({
            ok: true,
            status: rewarded ? "rewarded" : "closed",
            rewarded: rewarded,
            reason: rewarded ? "watched" : "skipped"
          });
        }
      });

      return ad;
    } catch (e) {
      this._recordAdError(e, slotKey);
      return null;
    }
  };

  TaptapAdProvider.prototype.showRewardedVideo = function (slotKey, callbacks) {
    const self = this;
    return new Promise(function (resolve) {
      const cfg = getConfig();
      if (!cfg || !cfg.isSlotConfigured(slotKey)) {
        try {
          if (callbacks && typeof callbacks.onClose === "function") {
            callbacks.onClose({ isEnded: false, rewarded: false, reason: "config-missing" });
          }
        } catch (e) { /* ignore */ }
        return resolve({
          ok: false,
          status: "error",
          rewarded: false,
          reason: "ad-unit-id-missing",
          message: "该广告位尚未在 AdPlatformConfig 配置 adUnitId"
        });
      }

      if (self._pending[slotKey]) {
        return resolve({
          ok: false,
          status: "busy",
          rewarded: false,
          reason: "ad-already-showing"
        });
      }

      const ad = self._ensureAd(slotKey);
      if (!ad) {
        try {
          if (callbacks && typeof callbacks.onClose === "function") {
            callbacks.onClose({ isEnded: false, rewarded: false, reason: "unavailable" });
          }
        } catch (e) { /* ignore */ }
        return resolve({
          ok: false,
          status: self._available ? "error" : "local-only",
          rewarded: false,
          reason: self._available ? "ad-creation-failed" : "tap-not-available",
          error: self._lastError
        });
      }

      self._pending[slotKey] = { resolve: resolve, callbacks: callbacks || {} };

      // 优先直接 show；若素材未就绪则 load 后再 show。
      try {
        ad.show()
          .then(function () {
            // show 成功仅代表广告开始展示，最终奖励以 onClose 为准。
          })
          .catch(function () {
            ad.load()
              .then(function () { return ad.show(); })
              .catch(function (err) {
                self._recordAdError(err, slotKey);
                const pending = self._pending[slotKey];
                if (pending) {
                  self._pending[slotKey] = null;
                  try {
                    if (typeof pending.callbacks.onError === "function") pending.callbacks.onError(err);
                  } catch (e2) { /* ignore */ }
                  pending.resolve({
                    ok: false,
                    status: "error",
                    rewarded: false,
                    reason: "load-or-show-failed",
                    error: self._lastError
                  });
                }
              });
          });
      } catch (e) {
        self._lastError = String(e && e.message ? e.message : e);
        const pending = self._pending[slotKey];
        if (pending) {
          self._pending[slotKey] = null;
          pending.resolve({
            ok: false,
            status: "error",
            rewarded: false,
            reason: "show-exception",
            error: self._lastError
          });
        }
      }
    });
  };

  // 结构化记录一次广告失败：保留原始 errMsg/errCode，并标注本次请求实际用的 adUnitId。
  TaptapAdProvider.prototype._recordAdError = function (err, slotKey) {
    const cfg = getConfig();
    const adUnitId = (cfg && typeof cfg.resolveAdUnitId === "function") ? cfg.resolveAdUnitId(slotKey) : null;
    this._usedAdUnitId = adUnitId;
    this._lastError = (err && err.errMsg) ? err.errMsg : (err ? String(err) : "unknown");
    this._lastAdError = {
      time: Date.now(),
      slotKey: slotKey || null,
      adUnitId: adUnitId,
      errMsg: (err && err.errMsg) ? err.errMsg : (err ? String(err) : ""),
      errCode: (err && err.errCode != null) ? err.errCode : null,
      raw: err || null
    };
  };

  TaptapAdProvider.prototype.getProviderStatus = function () {
    return {
      connected: this._connected,
      mode: this._mode,
      lastError: this._lastError,
      lastAdError: this._lastAdError,
      adUnitId: this._usedAdUnitId,
      platformName: "taptap",
      message: this._connected
        ? "已连接 TapTap 激励视频广告"
        : "未连接 TapTap 广告（仅本地模式）"
    };
  };

  root.TaptapAdProvider = TaptapAdProvider;
  if (typeof window !== "undefined") window.TaptapAdProvider = TaptapAdProvider;
  if (typeof module !== "undefined" && module.exports) module.exports = TaptapAdProvider;
})(typeof window !== "undefined" ? window : globalThis);
