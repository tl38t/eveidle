// js/systems/ad-buff.js
// 脑突触加速剂（广告激励增益）系统。
// 设计：独立乘区 ×1.3，持续 30 分钟；看完广告(isEnded===true)激活/刷新；每日上限 10 次 + 最小触发间隔 60s。
// 作用域：采矿/采气/冶炼效率、玩家战斗伤害、技能经验(生产+战斗)。
// 明确排除：空间站建筑升级速度、自动线、战斗速度(出手频率)。
// 纪律：本模块不依赖任何 tap.* / 平台 SDK；平台调用只经 ad-service.js 的 window.showRewardedAd 抽象。

const AD_BUFF_DURATION_MS = 30 * 60 * 1000;     // 30 分钟（旧：看广告直接激活时长；新：仅作展示参考）
const AD_BUFF_DAILY_CAP = 10;                    // 每日观看上限（客户端计数，UTC+8 跨天清零）
const AD_BUFF_MIN_INTERVAL_MS = 60 * 1000;       // 最小触发间隔，防连点
const AD_BUFF_MULTIPLIER = 1.3;                  // 独立乘区倍率
const AD_BUFF_KEY = "cerebralPlasma";
const AD_BUFF_EXTRACTOR_LARGE_MS = 30 * 60 * 1000;  // 大型提取剂：看广告获取，30 分钟
const AD_BUFF_EXTRACTOR_SMALL_MS = 5 * 60 * 1000;   // 小型提取剂：重复脑插转化，5 分钟

// 取得/惰性初始化 gameState.adBuffs
function getAdBuffState(state) {
  const s = state || (typeof gameState !== "undefined" ? gameState : null);
  if (!s) return null;
  if (!s.adBuffs || typeof s.adBuffs !== "object") s.adBuffs = {};
  return s.adBuffs;
}

// 当前独立乘区倍率（仅增益激活且未暂停期间为 1.3，否则 1.0）
function getAdBuffMultiplier(state) {
  const b = getAdBuffState(state);
  if (!b) return 1.0;
  const end = Number(b[AD_BUFF_KEY]) || 0;
  const paused = !!b.pausedAt;
  return (end > Date.now() && !paused) ? AD_BUFF_MULTIPLIER : 1.0;
}

// 剩余毫秒（0 表示未激活/已过期）。暂停时返回冻结剩余（endAt - pausedAt）。
function getAdBuffRemainingMs(state) {
  const b = getAdBuffState(state);
  if (!b) return 0;
  const end = Number(b[AD_BUFF_KEY]) || 0;
  if (end <= 0) return 0;
  const paused = !!b.pausedAt;
  const ref = paused ? Number(b.pausedAt) : Date.now();
  return Math.max(0, end - ref);
}

// 激活/刷新：看完广告 isEnded===true 时调用。刷新而非叠加（不会变成 60min）。会清除暂停态。
function activateCerebralPlasma(state, durationMs) {
  const b = getAdBuffState(state);
  if (!b) return false;
  const dur = Number(durationMs) || AD_BUFF_DURATION_MS;
  b[AD_BUFF_KEY] = Date.now() + dur;
  delete b.pausedAt;
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  return true;
}

// ---- 暂停 / 继续（不享受增益、不消耗时间）----
function isAdBuffPaused(state) {
  const b = getAdBuffState(state);
  return !!(b && b.pausedAt);
}

// 暂停：仅当当前生效中才允许；记录 pausedAt，剩余时间冻结。
function pauseCerebralPlasma(state) {
  const b = getAdBuffState(state);
  if (!b) return false;
  const end = Number(b[AD_BUFF_KEY]) || 0;
  if (end <= Date.now()) return false;   // 未生效则无需暂停
  if (b.pausedAt) return false;          // 已暂停
  b.pausedAt = Date.now();
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  return true;
}

// 继续：把暂停期间流逝的时间补偿回结束时间戳，剩余时长不变、只是重新走表。
function resumeCerebralPlasma(state) {
  const b = getAdBuffState(state);
  if (!b || !b.pausedAt) return false;
  const pausedAt = Number(b.pausedAt) || Date.now();
  const end = Number(b[AD_BUFF_KEY]) || 0;
  b[AD_BUFF_KEY] = Math.max(end, pausedAt) + (Date.now() - pausedAt);
  delete b.pausedAt;
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  return true;
}

// ---- 脑突触加速提取剂库存（大型=看广告 / 小型=重复脑插）----
function getExtractorCounts(state) {
  const b = getAdBuffState(state);
  const ex = (b && b.extractors) || {};
  return { large: Math.max(0, Number(ex.large) || 0), small: Math.max(0, Number(ex.small) || 0) };
}

function addExtractor(state, type, n) {
  const b = getAdBuffState(state);
  if (!b) return false;
  if (!b.extractors || typeof b.extractors !== "object") b.extractors = {};
  const key = (type === "large" || type === "small") ? type : "large";
  b.extractors[key] = Math.max(0, (Number(b.extractors[key]) || 0) + (Number(n) || 0));
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  return true;
}

function getTotalExtractorDurationMs(state) {
  const c = getExtractorCounts(state);
  return c.large * AD_BUFF_EXTRACTOR_LARGE_MS + c.small * AD_BUFF_EXTRACTOR_SMALL_MS;
}

// 注入全部提取剂：汇总时长并入剩余时间（暂停态下累加进冻结剩余、保持暂停），清空库存。
function injectAllExtractors(state) {
  const b = getAdBuffState(state);
  if (!b) return 0;
  const total = getTotalExtractorDurationMs(state);
  if (total <= 0) return 0;
  if (b.pausedAt) {
    // 冻结剩余 +total，保持暂停
    b[AD_BUFF_KEY] = (Number(b[AD_BUFF_KEY]) || 0) + total;
  } else {
    const endOld = Number(b[AD_BUFF_KEY]) || 0;
    const base = endOld > Date.now() ? endOld : Date.now();
    b[AD_BUFF_KEY] = base + total;
  }
  b.extractors = { large: 0, small: 0 };
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  return total;
}

// ---- 每日频次（客户端计数，UTC+8 跨天清零）----
function getAdBuffDailyKey(date) {
  const d = date || new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = utc8.getUTCFullYear();
  const m = String(utc8.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc8.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getAdBuffDailyCount(state) {
  const b = getAdBuffState(state);
  if (!b) return 0;
  if (b.dailyDate !== getAdBuffDailyKey()) return 0;   // 跨天自动视为 0
  return Number(b.dailyCount) || 0;
}

// 是否还能看一次广告（间隔未到 / 当日已用完 则返回 false）
function canWatchAd(state) {
  const b = getAdBuffState(state);
  if (!b) return false;
  const now = Date.now();
  const last = Number(b.lastWatchAt) || 0;
  if (now - last < AD_BUFF_MIN_INTERVAL_MS) return false;   // 间隔未到
  if (b.dailyDate !== getAdBuffDailyKey()) return true;     // 新的一天
  return (Number(b.dailyCount) || 0) < AD_BUFF_DAILY_CAP;
}

// 成功观看后调用：计当日次数 + 记录最后观看时间（跨天重置）
function recordAdWatch(state) {
  const b = getAdBuffState(state);
  if (!b) return;
  const key = getAdBuffDailyKey();
  if (b.dailyDate !== key) { b.dailyDate = key; b.dailyCount = 0; }   // 跨天重置
  b.dailyCount = (Number(b.dailyCount) || 0) + 1;
  b.lastWatchAt = Date.now();
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
}

// 状态快照（供 UI 显示）
function getAdBuffStatus(state) {
  const b = getAdBuffState(state);
  const active = !!b && (Number(b[AD_BUFF_KEY]) || 0) > Date.now() && !b.pausedAt;
  return {
    multiplier: active ? AD_BUFF_MULTIPLIER : 1.0,
    active,
    paused: !!(b && b.pausedAt),
    remainingMs: getAdBuffRemainingMs(state),
    extractors: getExtractorCounts(state),
    dailyCount: getAdBuffDailyCount(state),
    dailyCap: AD_BUFF_DAILY_CAP,
    canWatch: canWatchAd(state),
    minIntervalMs: AD_BUFF_MIN_INTERVAL_MS,
    durationMs: AD_BUFF_DURATION_MS,
    extractorLargeMs: AD_BUFF_EXTRACTOR_LARGE_MS,
    extractorSmallMs: AD_BUFF_EXTRACTOR_SMALL_MS
  };
}

// 暴露到全局（vanilla <script> 全局函数，供 production.js / combat.js / selectors.js / UI 调用）
if (typeof window !== "undefined") {
  window.getAdBuffMultiplier = getAdBuffMultiplier;
  window.getAdBuffRemainingMs = getAdBuffRemainingMs;
  window.activateCerebralPlasma = activateCerebralPlasma;
  window.canWatchAd = canWatchAd;
  window.recordAdWatch = recordAdWatch;
  window.getAdBuffStatus = getAdBuffStatus;
  window.getAdBuffDailyKey = getAdBuffDailyKey;
  window.AD_BUFF_DURATION_MS = AD_BUFF_DURATION_MS;
  // 暂停 / 提取剂 / 注入（UI 与重复脑插转化使用）
  window.isAdBuffPaused = isAdBuffPaused;
  window.pauseCerebralPlasma = pauseCerebralPlasma;
  window.resumeCerebralPlasma = resumeCerebralPlasma;
  window.getExtractorCounts = getExtractorCounts;
  window.addExtractor = addExtractor;
  window.getTotalExtractorDurationMs = getTotalExtractorDurationMs;
  window.injectAllExtractors = injectAllExtractors;
  window.AD_BUFF_EXTRACTOR_LARGE_MS = AD_BUFF_EXTRACTOR_LARGE_MS;
  window.AD_BUFF_EXTRACTOR_SMALL_MS = AD_BUFF_EXTRACTOR_SMALL_MS;
}
