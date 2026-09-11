// js/systems/research-ad.js
// 科研工时 · 看广告产出系统（「认知萃取注入器」的广告等价物）。
//
// 设计要点：
//   1. 复用现有广告抽象层 window.showRewardedAd("rewarded_default", ...)。
//      "rewarded_default" 已映射到竖屏激励视频位 1054324（同一 adUnitId），
//      且 TaptapAdProvider 按 slotKey 单实例复用 —— 不新建第二个广告实例，
//      避免官方文档警告的「多实例互相挤占 / 未 load 完就 show 黑屏」问题。
//   2. 看完广告(isEnded===true) → 仅此唯一发奖时机 → 经 ResearchSystem.addResearchHours
//      注入固定 1 小时(3600s) 科研工时。与虫洞商店、成就共用同一条写入入口。
//   3. 每日额度不自建计数：与「脑突触加速」(js/systems/ad-buff.js) 共用同一个额度池
//      window.AdDailyQuota（state.adQuota，默认 20 次/日 + 60s 最小间隔）。
//      两边消耗同一个池 —— 玩家必须在「加速」与「工时」之间做取舍，
//      但 TapTap 侧仍然只有一个激励位(1054324)，不会多开广告实例。
//
// 纪律（严格不越界）：
//   - 不依赖 tap.* / 任何平台 SDK；平台调用只经 window.showRewardedAd 抽象。
//   - 不修改 skills / 经验 / gameState 其他结构，只写 researchHourBank。
//   - 所有异常安全捕获，绝不抛未处理异常。
(function (root) {
  "use strict";

  const RESEARCH_AD_REWARD_SECONDS = 3600; // 每看完一个广告 +1 小时科研工时
  const RESEARCH_AD_FALLBACK_CAP = 20;     // 共享池不可用时的兜底上限（正常取自 AdDailyQuota）

  // ---- 共享额度池薄封装（权威实现在 js/systems/ad-buff.js）----
  // 本文件在 index.html 中先于 ad-buff.js 加载，所以只能在「调用时」取，不能在加载时取。
  function quotaLib() {
    if (typeof window === "undefined") return null;
    return window.AdDailyQuota || null;
  }

  // 今日已用次数（与脑突触加速共用同一个池）。
  function getDailyCount(state) {
    const lib = quotaLib();
    if (lib && typeof lib.getUsed === "function") return Number(lib.getUsed(state)) || 0;
    if (typeof window !== "undefined" && typeof window.getAdDailyUsed === "function") return Number(window.getAdDailyUsed(state)) || 0;
    return 0;
  }

  function getDailyCap() {
    const lib = quotaLib();
    if (lib && typeof lib.TOTAL_CAP === "number") return lib.TOTAL_CAP;
    if (typeof window !== "undefined" && typeof window.AD_DAILY_TOTAL_CAP === "number") return window.AD_DAILY_TOTAL_CAP;
    return RESEARCH_AD_FALLBACK_CAP;
  }

  function getDailyRemaining(state) {
    return Math.max(0, getDailyCap() - getDailyCount(state));
  }

  // 是否还能看一次广告（间隔未到 / 当日已用完 则 false）。
  function canWatch(state) {
    const lib = quotaLib();
    if (lib && typeof lib.canUse === "function") return !!lib.canUse(state);
    if (typeof window !== "undefined" && typeof window.canUseAdQuota === "function") return !!window.canUseAdQuota(state);
    return false;
  }

  // 成功观看后消耗共享额度（跨天自动重置）。
  function recordWatch(state) {
    const lib = quotaLib();
    if (lib && typeof lib.consume === "function") { lib.consume(state); return; }
    if (typeof window !== "undefined" && typeof window.consumeAdQuota === "function") window.consumeAdQuota(state);
  }

  // 本地调试开关（与 ad-buff-widget.js 判定一致）：URL ?debugAd=1 或 localStorage.debugAd==='1'。
  function isAdDebug() {
    try {
      if (typeof location !== "undefined" && new URLSearchParams(location.search).get("debugAd") === "1") return true;
      if (typeof localStorage !== "undefined" && localStorage.getItem("debugAd") === "1") return true;
    } catch (e) {}
    return false;
  }

  // 直接发放（调试 / 兜底用）：调 ResearchSystem.addResearchHours 并消耗共享额度。
  function grantDirect(state, seconds) {
    const RS = (typeof window !== "undefined" && window.ResearchSystem) || null;
    if (!RS || typeof RS.addResearchHours !== "function") return { ok: false, reason: "no-research-system" };
    const sec = Number(seconds) || RESEARCH_AD_REWARD_SECONDS;
    const res = RS.addResearchHours(state, sec);
    if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || "add-failed" };
    recordWatch(state);
    return { ok: true, seconds: sec };
  }

  // 主入口：看完广告发奖。handlers: { onGranted(seconds), onSkip(), onError(err), onLimit(reason) }
  // 返回 { ok, reason }。
  function watchForResearchHours(state, handlers) {
    handlers = handlers || {};
    if (!canWatch(state)) {
      const reason = (getDailyCount(state) >= getDailyCap()) ? "daily-cap" : "interval";
      if (typeof handlers.onLimit === "function") handlers.onLimit(reason);
      return { ok: false, reason: "not-allowed" };
    }
    if (typeof window === "undefined" || typeof window.showRewardedAd !== "function") {
      if (typeof handlers.onError === "function") handlers.onError(new Error("广告功能未就绪"));
      return { ok: false, reason: "no-ad-service" };
    }
    return window.showRewardedAd("rewarded_default", {
      onReward() {
        // 唯一发奖时机：广告完整看完(isEnded===true)，由 ad-service 保证只在此回调。
        const res = grantDirect(state, RESEARCH_AD_REWARD_SECONDS);
        if (res && res.ok) {
          if (typeof handlers.onGranted === "function") handlers.onGranted(RESEARCH_AD_REWARD_SECONDS);
        } else {
          if (typeof handlers.onError === "function") handlers.onError(new Error("发放失败：" + ((res && res.reason) || "unknown")));
        }
      },
      onSkip() { if (typeof handlers.onSkip === "function") handlers.onSkip(); },
      onError(err) { if (typeof handlers.onError === "function") handlers.onError(err); }
    });
  }

  const api = {
    RESEARCH_AD_REWARD_SECONDS,
    getDailyCount: getDailyCount,
    getDailyCap: getDailyCap,
    getDailyRemaining: getDailyRemaining,
    isAdDebug: isAdDebug,
    canWatchResearchAd: canWatch,
    recordResearchAdWatch: recordWatch,
    grantResearchHoursDirect: grantDirect,
    watchAdForResearchHours: watchForResearchHours
  };

  root.ResearchAdSystem = api;
  if (typeof window !== "undefined") window.ResearchAdSystem = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
