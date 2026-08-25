/* ================================================================
   ad-platform-config.js — 广告平台配置（仅本地→平台映射）

   职责：
   - 集中维护「本地广告位名称」到「TapTap 推广位 ID（adUnitId）」的映射。
   - 提供平台可用性探测、adUnitId 解析、安全校验。
   - 不包含密钥；adUnitId 来自 Dirichlet 媒体管理后台创建推广位后生成。

   设计纪律：
   - 不修改 state / gameState / eve_idle_save / skills。
   - 不调用 TapTap / Steam 真实 SDK（仅只读探测 window.tap 是否存在）。
   - 不创建定时器，不发送网络请求。
   ================================================================ */
(function (root) {
  "use strict";

  // ---- 聚合广告位：本地 slotKey -> TapTap adUnitId ----
  // 注意：真实 adUnitId 必须在 Dirichlet 媒体管理平台「推广位」创建后获取。
  // 此处的 ID 是字符串，直接来自后台；未配置前保持空字符串或占位符。
  const TAPTAP_AD_SLOTS = Object.freeze({
    // 激励视频默认位：深空放置 · 边疆纪元 - 激励广告
    rewarded_default: "1062738"
  });

  // 占位符前缀：运行时若 adUnitId 仍为此类占位，视为「配置缺失」。
  const AD_PLACEHOLDER_PREFIX = "__TAPTAP_";

  function isPlaceholderAdUnitId(id) {
    return typeof id === "string" && id.indexOf(AD_PLACEHOLDER_PREFIX) === 0;
  }

  // 给定本地 slotKey，返回 adUnitId；未配置时返回 null。
  function resolveAdUnitId(slotKey) {
    if (!slotKey || typeof slotKey !== "string") return null;
    const id = TAPTAP_AD_SLOTS[slotKey];
    if (!id || typeof id !== "string") return null;
    if (id.trim() === "" || isPlaceholderAdUnitId(id)) return null;
    return id;
  }

  // 平台能力探测（只读，不调用 SDK）：
  // 浏览器存在 window.tap 且暴露 createRewardedVideoAd 函数 -> 可能可用。
  function detectTapTapAvailable() {
    try {
      const tap = (typeof window !== "undefined") ? window.tap : null;
      if (!tap) return false;
      if (typeof tap.createRewardedVideoAd !== "function") return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // 判断某 slotKey 是否允许展示广告（配置存在且非占位）。
  function isSlotConfigured(slotKey) {
    return resolveAdUnitId(slotKey) !== null;
  }

  const api = {
    TAPTAP_AD_SLOTS,
    AD_PLACEHOLDER_PREFIX,
    isPlaceholderAdUnitId,
    resolveAdUnitId,
    detectTapTapAvailable,
    isSlotConfigured
  };

  root.AdPlatformConfig = api;
  if (typeof window !== "undefined") window.AdPlatformConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
