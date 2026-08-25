/* ================================================================
   AdProvider 统一契约（平台无关）

   共享核心只认识本契约定义的结构，绝不直接出现 tap / SteamBridge
   / 任何平台 SDK 调用。

   接口方法（全部异步，返回 Promise，便于未来真实平台接入）：
   - showRewardedVideo(slotKey, callbacks)
       -> { ok, status: "local-only" | "shown" | "rewarded" | "error" | ...,
            rewarded: boolean }
   - isAvailable()
       -> boolean
   - initialize()
       -> Promise<boolean>
   - getProviderStatus()
       -> { connected: boolean, mode: "local-only" | "taptap" | "steam" | "error",
            lastError: string|null, platformName: string }

   设计纪律（本文件与所有 provider 不可越界）：
   - 不修改 state.skills / 技能等级 / 经验 / gameState / eve_idle_save。
   - 不创建 setInterval / setTimeout 定时器，不自动轮询广告。
   - 不调用 TapTap / Steam / Electron 真实 SDK（仅定义结构）。
   - provider 异常一律结构化返回，不向上抛出未处理异常。
   ================================================================ */
(function (root) {
  "use strict";

  class AdProvider {
    // 该 provider 是否已连接到真实平台（local-only 时为 false）。
    isAvailable() { return false; }

    // 初始化（local-only 时直接 resolve(false)）。
    initialize() { return Promise.resolve(false); }

    // 展示激励视频广告。
    // callbacks 可选 { onLoad, onError, onClose }；返回 Promise 结构化结果。
    showRewardedVideo(/* slotKey, callbacks */) {
      return Promise.resolve({ ok: false, status: "local-only", rewarded: false, reason: "no-provider" });
    }

    // 当前 provider 状态（供 UI 显示）。
    getProviderStatus() {
      return {
        connected: false,
        mode: "local-only",
        lastError: null,
        platformName: "local"
      };
    }
  }

  const api = { AdProvider };

  root.AdProviderContract = api;
  if (typeof window !== "undefined") window.AdProviderContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
