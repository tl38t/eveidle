// js/systems/ad-buff.js
// 脑突触加速剂（广告激励增益）系统。
// 设计：独立乘区 ×1.3，持续 30 分钟；看完广告(isEnded===true)激活/刷新。
// 频次：与「科研工时广告」(js/systems/research-ad.js) 共用同一个每日额度池
//       state.adQuota = { dailyDate, dailyCount, lastWatchAt }，默认 20 次/日 + 60s 最小间隔。
//       ad-buff.js 是该池的唯一权威实现，research-ad.js 只做薄封装。
// 作用域：采矿/采气/冶炼效率、玩家战斗伤害、技能经验(仅战斗技能经验，经 addStationModifiedCombatXp 入口；生产/考古/制造等非战斗技能经验不享受)。
// 明确排除：空间站建筑升级速度、自动线、战斗速度(出手频率)。
// 纪律：本模块不依赖任何 tap.* / 平台 SDK；平台调用只经 ad-service.js 的 window.showRewardedAd 抽象。

const AD_BUFF_DURATION_MS = 30 * 60 * 1000;     // 30 分钟（旧：看广告直接激活时长；新：仅作展示参考）
// ---- 广告每日共享额度池（脑突触加速 + 科研工时 共用一个池）----
const AD_DAILY_TOTAL_CAP = 20;                   // 共享池每日总上限（客户端计数，UTC+8 跨天清零）
const AD_SHARED_INTERVAL_MS = 60 * 1000;         // 共享池最小触发间隔，防连点黑屏
const AD_BUFF_DAILY_CAP = AD_DAILY_TOTAL_CAP;    // 兼容旧名：共享池上限
const AD_BUFF_MIN_INTERVAL_MS = AD_SHARED_INTERVAL_MS; // 兼容旧名：共享池间隔
const AD_BUFF_MULTIPLIER = 1.3;                  // 独立乘区倍率
const AD_BUFF_KEY = "cerebralPlasma";
const AD_BUFF_EXTRACTOR_LARGE_MS = 30 * 60 * 1000;  // 大型提取剂：看广告获取，30 分钟
const AD_BUFF_EXTRACTOR_SMALL_MS = 5 * 60 * 1000;   // 小型提取剂：重复脑插转化，5 分钟
const CEREBRAL_SLOT_MAX_MS = 48 * 60 * 60 * 1000;

// 取得/惰性初始化 gameState.adBuffs
function getAdBuffState(state) {
  const s = state || (typeof gameState !== "undefined" ? gameState : null);
  if (!s) return null;
  if (!s.adBuffs || typeof s.adBuffs !== "object") s.adBuffs = {};
  return s.adBuffs;
}

function getCerebralSlotState(state) {
  if (!isSteamRuntime()) return null;
  const b = getAdBuffState(state);
  if (!b) return null;
  const today = getAdBuffDailyKey();
  if (!b.cerebralSlot || typeof b.cerebralSlot !== "object" || Array.isArray(b.cerebralSlot)) {
    b.cerebralSlot = { dailyDate: today, remainingMs: CEREBRAL_SLOT_MAX_MS };
    if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  } else if (b.cerebralSlot.dailyDate !== today) {
    b.cerebralSlot.dailyDate = today;
    b.cerebralSlot.remainingMs = CEREBRAL_SLOT_MAX_MS;
    if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  }
  b.cerebralSlot.remainingMs = Math.max(0, Math.min(CEREBRAL_SLOT_MAX_MS, Number(b.cerebralSlot.remainingMs) || 0));
  return b.cerebralSlot;
}

// Steam 脑突触槽按真实时间连续恢复：24 小时恢复 4 小时；启用时按真实时间消耗。
function syncCerebralSlot(state) {
  const slot = getCerebralSlotState(state);
  if (!slot) return null;
  const now = Date.now();
  const storedLast = Number(slot.lastUpdatedAt);
  if (!Number.isFinite(storedLast) || storedLast <= 0) {
    slot.lastUpdatedAt = now;
    if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
    return slot;
  }
  const last = storedLast;
  const elapsed = Math.max(0, now - last);
  if (elapsed > 0) {
    const recovered = elapsed / 6;
    slot.remainingMs = Math.min(CEREBRAL_SLOT_MAX_MS, Math.max(0, Number(slot.remainingMs) || 0) + recovered);
    if (slot.enabled) slot.remainingMs = Math.max(0, slot.remainingMs - elapsed);
    if (slot.remainingMs <= 0) slot.enabled = false;
    slot.lastUpdatedAt = now;
    if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  }
  return slot;
}

function isSteamRuntime() {
  const g = (typeof globalThis !== "undefined") ? globalThis : null;
  return !!(g && g.PlatformRuntime && typeof g.PlatformRuntime.getPlatform === "function" && g.PlatformRuntime.getPlatform() === "steam");
}

function getCerebralSlotStatus(state) {
  const slot = syncCerebralSlot(state);
  const remainingMs = slot ? slot.remainingMs : 0;
  return {
    maxMs: CEREBRAL_SLOT_MAX_MS,
    remainingMs,
    enabled: !!(slot && slot.enabled),
    recoveryRate: 1 / 6,
    recoverToFullMs: Math.ceil(Math.max(0, CEREBRAL_SLOT_MAX_MS - remainingMs) * 6),
    dailyDate: slot ? slot.dailyDate : getAdBuffDailyKey()
  };
}

function setCerebralSlotEnabled(state, enabled) {
  const slot = syncCerebralSlot(state);
  if (!slot) return false;
  slot.enabled = !!enabled && slot.remainingMs > 0;
  slot.lastUpdatedAt = Date.now();
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  return slot.enabled;
}

function injectCerebralSlot(state, durationMs) {
  const slot = getCerebralSlotState(state);
  const amount = Math.max(0, Math.min(slot ? slot.remainingMs : 0, Number(durationMs) || 0));
  if (!slot || amount <= 0) return 0;
  const b = getAdBuffState(state);
  const now = Date.now();
  const end = Number(b[AD_BUFF_KEY]) || 0;
  b[AD_BUFF_KEY] = (end > now ? end : now) + amount;
  delete b.pausedAt;
  slot.remainingMs -= amount;
  if (typeof gameState !== "undefined" && gameState) gameState._dirty = true;
  return amount;
}

// 当前独立乘区倍率（仅增益激活且未暂停期间为 1.3，否则 1.0）。
// atTime 可选：离线结算传入虚拟时间戳，避免用 Date.now() 误判过去/未来是否生效。
function getAdBuffMultiplier(state, atTime) {
  if (isSteamRuntime()) {
    const slot = syncCerebralSlot(state);
    return slot && slot.enabled && slot.remainingMs > 0 ? AD_BUFF_MULTIPLIER : 1.0;
  }
  const b = getAdBuffState(state);
  if (!b) return 1.0;
  const end = Number(b[AD_BUFF_KEY]) || 0;
  const paused = !!b.pausedAt;
  const ref = (typeof atTime === "number" && Number.isFinite(atTime)) ? atTime : Date.now();
  return (end > ref && !paused) ? AD_BUFF_MULTIPLIER : 1.0;
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

// ---- 广告每日共享额度池（唯一权威实现）----
// 存储：state.adQuota = { dailyDate, dailyCount, lastWatchAt }
// 旧的 state.adBuffs.dailyCount / state.researchAd.dailyCount 从此不再写入，
// 仅在共享池「首次初始化」时做一次性迁移（见 migrateAdQuota），迁移后绝不回写旧字段。
function resolveAdState(state) {
  if (state && typeof state === "object") return state;
  return (typeof gameState !== "undefined") ? gameState : null;
}

// UTC+8 当日 key，跨天自动归零。
function getAdBuffDailyKey(date) {
  const d = date || new Date();
  const utc8 = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = utc8.getUTCFullYear();
  const m = String(utc8.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc8.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 取得/惰性初始化共享池，并在必要时执行一次性迁移。
function getAdQuotaState(state) {
  const s = resolveAdState(state);
  if (!s) return null;
  let q = s.adQuota;
  if (!q || typeof q !== "object" || Array.isArray(q)) { q = {}; s.adQuota = q; }
  migrateAdQuota(s, q);
  return q;
}

// 一次性迁移：仅当共享池从未初始化（dailyDate 为空）时执行。
// 起点取「当天已存在的计数」的最大值，保证老玩家今天已看的广告次数不被清零重获；
// lastWatchAt 同样取最大值，避免迁移瞬间绕过最小间隔。
function migrateAdQuota(state, q) {
  if (q.dailyDate) return;
  const key = getAdBuffDailyKey();
  let seed = 0, lastAt = 0;
  const b = state.adBuffs;
  if (b && typeof b === "object" && b.dailyDate === key) {
    seed = Math.max(seed, Number(b.dailyCount) || 0);
    lastAt = Math.max(lastAt, Number(b.lastWatchAt) || 0);
  }
  const r = state.researchAd;
  if (r && typeof r === "object" && r.dailyDate === key) {
    seed = Math.max(seed, Number(r.dailyCount) || 0);
    lastAt = Math.max(lastAt, Number(r.lastWatchAt) || 0);
  }
  q.dailyDate = key;
  q.dailyCount = Math.min(seed, AD_DAILY_TOTAL_CAP);
  q.lastWatchAt = lastAt;
  state._dirty = true;
}

// 今日已用次数（跨天自动视为 0）。
function getAdDailyUsed(state) {
  const q = getAdQuotaState(state);
  if (!q) return 0;
  if (q.dailyDate !== getAdBuffDailyKey()) return 0;
  return Math.min(AD_DAILY_TOTAL_CAP, Number(q.dailyCount) || 0);
}

// 今日剩余次数。
function getAdDailyRemaining(state) {
  return Math.max(0, AD_DAILY_TOTAL_CAP - getAdDailyUsed(state));
}

function getAdLastWatchAt(state) {
  const q = getAdQuotaState(state);
  return q ? (Number(q.lastWatchAt) || 0) : 0;
}

// 共享池是否还允许再触发一次广告（间隔未到 / 当日已用完 → false）。
function canUseAdQuota(state) {
  const q = getAdQuotaState(state);
  if (!q) return false;
  if (Date.now() - (Number(q.lastWatchAt) || 0) < AD_SHARED_INTERVAL_MS) return false;
  return getAdDailyUsed(state) < AD_DAILY_TOTAL_CAP;
}

// 成功看完广告后调用：共享池 +1 并刷新最后观看时间（跨天自动重置）。
function consumeAdQuota(state) {
  const q = getAdQuotaState(state);
  if (!q) return false;
  const key = getAdBuffDailyKey();
  if (q.dailyDate !== key) { q.dailyDate = key; q.dailyCount = 0; }   // 跨天重置
  q.dailyCount = (Number(q.dailyCount) || 0) + 1;
  q.lastWatchAt = Date.now();
  const s = resolveAdState(state);
  if (s) s._dirty = true;
  return true;
}

// ---- 旧接口：签名保持不变，内部改走共享池（ad-buff-widget.js 零改动）----
function getAdBuffDailyCount(state) { return getAdDailyUsed(state); }
function canWatchAd(state) { return canUseAdQuota(state); }
function recordAdWatch(state) { consumeAdQuota(state); }

// 状态快照（供 UI 显示）
function getAdBuffStatus(state) {
  if (isSteamRuntime()) {
    const slot = getCerebralSlotStatus(state);
    return {
      multiplier: slot.enabled ? AD_BUFF_MULTIPLIER : 1.0,
      active: slot.enabled,
      paused: false,
      remainingMs: slot.remainingMs,
      extractors: { large: 0, small: 0 },
      dailyCount: 0,
      dailyCap: 0,
      dailyRemaining: 0,
      sharedQuota: false,
      canWatch: false,
      minIntervalMs: 0,
      durationMs: 0,
      extractorLargeMs: 0,
      extractorSmallMs: 0,
      cerebralSlot: slot
    };
  }
  const b = getAdBuffState(state);
  const active = !!b && (Number(b[AD_BUFF_KEY]) || 0) > Date.now() && !b.pausedAt;
  return {
    multiplier: active ? AD_BUFF_MULTIPLIER : 1.0,
    active,
    paused: !!(b && b.pausedAt),
    remainingMs: getAdBuffRemainingMs(state),
    extractors: getExtractorCounts(state),
    dailyCount: getAdBuffDailyCount(state),
    dailyCap: AD_DAILY_TOTAL_CAP,
    dailyRemaining: getAdDailyRemaining(state),
    sharedQuota: true,
    canWatch: canWatchAd(state),
    minIntervalMs: AD_BUFF_MIN_INTERVAL_MS,
    durationMs: AD_BUFF_DURATION_MS,
    extractorLargeMs: AD_BUFF_EXTRACTOR_LARGE_MS,
    extractorSmallMs: AD_BUFF_EXTRACTOR_SMALL_MS,
    cerebralSlot: isSteamRuntime() ? getCerebralSlotStatus(state) : null
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
  window.CEREBRAL_SLOT_MAX_MS = CEREBRAL_SLOT_MAX_MS;
  window.getCerebralSlotStatus = getCerebralSlotStatus;
  window.setCerebralSlotEnabled = setCerebralSlotEnabled;
  window.injectCerebralSlot = injectCerebralSlot;
  // ---- 广告每日共享额度池（脑突触加速 + 科研工时 共用）----
  window.getAdDailyUsed = getAdDailyUsed;
  window.getAdDailyRemaining = getAdDailyRemaining;
  window.getAdLastWatchAt = getAdLastWatchAt;
  window.canUseAdQuota = canUseAdQuota;
  window.consumeAdQuota = consumeAdQuota;
  window.AD_DAILY_TOTAL_CAP = AD_DAILY_TOTAL_CAP;
  window.AD_SHARED_INTERVAL_MS = AD_SHARED_INTERVAL_MS;
  // 命名空间入口：research-ad.js 只依赖它，不猜函数名。
  window.AdDailyQuota = {
    TOTAL_CAP: AD_DAILY_TOTAL_CAP,
    INTERVAL_MS: AD_SHARED_INTERVAL_MS,
    getUsed: getAdDailyUsed,
    getRemaining: getAdDailyRemaining,
    getLastWatchAt: getAdLastWatchAt,
    canUse: canUseAdQuota,
    consume: consumeAdQuota,
    getDailyKey: getAdBuffDailyKey
  };
}
