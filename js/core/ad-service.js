/* ================================================================
   AdService — 平台无关的激励视频广告服务

   职责：
   - 按运行环境选择 AdProvider：TapTap 可用 -> TaptapAdProvider，否则 NoopAdProvider。
   - 对外暴露统一的 showRewardedVideo(slotKey, callbacks) 接口，业务代码不直接
     调用 window.tap / SDK。
   - 所有异常结构化返回，不向上抛出未处理异常，确保游戏主流程不受影响。

   设计纪律（严格不越界）：
   - 不修改 state.skills / 技能等级 / 经验 / gameState / eve_idle_save。
   - 不创建 setInterval / setTimeout 做后台轮询。
   - 不直接调用 TapTap / Steam / Electron SDK（经由 provider）。
   - 奖励发放逻辑由调用方在 onClose / Promise 回调中自行实现，本服务只负责
     把 SDK 的 isEnded 结果透传给调用方。
   ================================================================ */
(function (root) {
  "use strict";

  function AdService(opts) {
    opts = opts || {};
    this.provider = opts.provider || null;
    this.platform = opts.platform || "local"; // "local" | "taptap" | "steam"
    this._status = {
      connected: false,
      mode: "local-only",
      lastError: null,
      platformName: "local"
    };
    this._initialized = false;
  }

  AdService.prototype.init = function () {
    const self = this;
    if (!this.provider || typeof this.provider.initialize !== "function") {
      this._updateStatus();
      return Promise.resolve(false);
    }
    return Promise.resolve(this.provider.initialize()).then(function (ok) {
      self._initialized = true;
      self._updateStatus();
      return !!(self.provider && self.provider.isAvailable && self.provider.isAvailable());
    }).catch(function (err) {
      self._status.mode = "error";
      self._status.lastError = String(err && err.message ? err.message : err);
      return false;
    });
  };

  AdService.prototype._updateStatus = function () {
    if (this.provider && typeof this.provider.getProviderStatus === "function") {
      const ps = this.provider.getProviderStatus();
      this._status = {
        connected: !!(ps && ps.connected),
        mode: (ps && ps.mode) || "local-only",
        lastError: (ps && ps.lastError) || null,
        platformName: (ps && ps.platformName) || "local"
      };
    } else {
      this._status = { connected: false, mode: "local-only", lastError: null, platformName: "local" };
    }
  };

  AdService.prototype.getProviderStatus = function () {
    this._updateStatus();
    return this._status;
  };

  AdService.prototype.isInitialized = function () { return this._initialized; };

  AdService.prototype.isConnected = function () {
    this._updateStatus();
    return this._status.connected;
  };

  // 展示激励视频广告。业务层唯一需要使用的入口。
  // slotKey: 广告位名称（如 "rewarded_default"）。
  // callbacks 可选 { onLoad, onError, onClose }。
  // 返回 Promise<{ ok, status, rewarded, reason, error? }>。
  AdService.prototype.showRewardedVideo = function (slotKey, callbacks) {
    const self = this;
    if (!this.provider || typeof this.provider.showRewardedVideo !== "function") {
      return Promise.resolve({
        ok: false,
        status: "local-only",
        rewarded: false,
        reason: "provider-unavailable"
      });
    }
    return Promise.resolve(this.provider.showRewardedVideo(slotKey, callbacks)).then(function (res) {
      self._updateStatus();
      return res || { ok: false, status: "error", rewarded: false, reason: "empty-response" };
    }).catch(function (err) {
      self._updateStatus();
      return { ok: false, status: "error", rewarded: false, reason: "provider-error", error: String(err && err.message ? err.message : err) };
    });
  };

  // 选择 provider：TapTap 可用 -> TaptapAdProvider，否则 NoopAdProvider。
  // 该函数只读探测 window.AdPlatformConfig，不直接访问 window.tap / SDK、不抛异常。
  // 返回 { provider, platform }。
  AdService.selectProvider = function () {
    try {
      const Tap = (typeof window !== "undefined" && window.TaptapAdProvider) || null;
      const Noop = (typeof window !== "undefined" && window.NoopAdProvider) || null;
      const Config = (typeof window !== "undefined" && window.AdPlatformConfig) || null;

      let tapUsable = false;
      if (Config && typeof Config.detectTapTapAvailable === "function") {
        tapUsable = Config.detectTapTapAvailable();
      }

      if (tapUsable && Tap) {
        return { provider: new Tap(), platform: "taptap" };
      }

      if (Noop) return { provider: new Noop(), platform: "local" };
      return { provider: null, platform: "local" };
    } catch (e) {
      try {
        const Noop = (typeof window !== "undefined" && window.NoopAdProvider) || null;
        if (Noop) return { provider: new Noop(), platform: "local" };
      } catch (e2) { /* ignore */ }
      return { provider: null, platform: "local" };
    }
  };

  // 便捷构造：自动选择 provider 并初始化。
  AdService.create = function () {
    const picked = AdService.selectProvider();
    const svc = new AdService({ provider: picked.provider, platform: picked.platform });
    const r = svc.init();
    if (r && typeof r.catch === "function") r.catch(function () { /* 忽略 */ });
    return svc;
  };

  root.AdService = AdService;
  if (typeof window !== "undefined") window.AdService = AdService;
  if (typeof module !== "undefined" && module.exports) module.exports = AdService;
})(typeof window !== "undefined" ? window : globalThis);

/* ================================================================
   初始化全局单例（浏览器环境）：在 index.html 中按 defer 顺序加载本文件后
   自动创建。业务层通过 window.__adService__ 或 window.AdService 访问。
   ================================================================ */
(function () {
  "use strict";
  try {
    if (typeof window !== "undefined" && window.AdService && !window.__adService__) {
      window.__adService__ = window.AdService.create();
    }
  } catch (e) {
    // 极端异常下不阻塞页面其余逻辑。
  }
})();
