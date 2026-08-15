/* ================================================================
   AchievementProvider 统一契约（平台无关）

   共享核心只认识本契约定义的结构，绝不直接出现 tap / SteamBridge。
   成就权威事实仍为 gameState.achievements.unlockedAtById（见 achievements.js），
   本契约仅负责把已确定的解锁事实同步到平台，永不反向成为“是否解锁”的事实来源。

   接口方法（全部异步，返回 Promise）：
   - isAvailable()
   - initialize()
   - unlock(platformAchievementId)
   - setProgress(platformAchievementId, current, max)
   - reconcile(entries)            // entries: [{ internalId, platformId, unlockedAt }]
   - getLastError()
   ================================================================ */
(function (root) {
  "use strict";

  // 小游戏成就基础库最低版本。
  const TAPTAP_ACH_MIN_BASE_LIB = "1.5.0";

  class AchievementProvider {
    isAvailable() { return false; }
    initialize() { return Promise.resolve(false); }
    unlock(/* platformAchievementId */) { return Promise.resolve(false); }
    setProgress(/* platformAchievementId, current, max */) { return Promise.resolve(false); }
    reconcile(/* entries */) { return Promise.resolve([]); }
    getLastError() { return null; }
  }

  const api = { TAPTAP_ACH_MIN_BASE_LIB, AchievementProvider };

  root.AchievementProviderContract = api;
  if (typeof window !== "undefined") window.AchievementProviderContract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
