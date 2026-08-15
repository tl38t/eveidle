/* ================================================================
   平台运行时检测（唯一检测入口）

   纪律：
   - 业务代码不得再散落 `if (window.tap)` / `if (window.SteamBridge)`。
   - 全部平台判断集中在此文件，一次性检测。
   - 具体 provider 构造延迟到调用时解析（按脚本加载顺序，
     provider 类在 bootstrap 之前均已定义）。

   检测优先级：
   1. tap 且 tap.getFileSystemManager 存在       → "taptap"
   2. window.SteamBridge 存在                    → "steam"
   3. 其它                                        → "web"
   ================================================================ */
(function (root) {
  "use strict";

  function detectPlatform() {
    const g = (typeof globalThis !== "undefined") ? globalThis : root;
    // TapTap platform identity is independent from optional cloud/achievement capability.
    // This keeps durable device mirrors available even when cloud SDK init is unavailable.
    if (g.tap && typeof g.tap.getFileSystemManager === "function") {
      return "taptap";
    }
    // 2) 未来 Steam 桌面壳层。
    if (g.SteamBridge) return "steam";
    // 3) 普通浏览器 / 未知环境。
    return "web";
  }

  function getPlatform() {
    return detectPlatform();
  }

  function createCloudProvider() {
    const p = getPlatform();
    if (p === "taptap" && typeof TapTapCloudProvider !== "undefined") {
      return new TapTapCloudProvider();
    }
    if (p === "steam" && typeof SteamCloudProvider !== "undefined") {
      return new SteamCloudProvider();
    }
    // 默认 / 降级：无云服务的本地模式。
    return new NoopCloudProvider();
  }

  function createAchievementProvider() {
    const p = getPlatform();
    if (p === "taptap" && typeof TapTapAchievementProvider !== "undefined") {
      return new TapTapAchievementProvider();
    }
    if (p === "steam" && typeof SteamAchievementProvider !== "undefined") {
      return new SteamAchievementProvider();
    }
    return new NoopAchievementProvider();
  }

  function createLocalMirrorProvider() {
    const p = getPlatform();
    if (p === "taptap" && typeof TapTapLocalMirrorProvider !== "undefined") {
      return new TapTapLocalMirrorProvider();
    }
    if (p === "steam" && typeof DesktopFileMirrorProvider !== "undefined") {
      return new DesktopFileMirrorProvider();
    }
    return new NoopLocalMirrorProvider();
  }

  const api = {
    getPlatform,
    createCloudProvider,
    createAchievementProvider,
    createLocalMirrorProvider,
    detectPlatform
  };

  root.PlatformRuntime = api;
  if (typeof window !== "undefined") window.PlatformRuntime = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
