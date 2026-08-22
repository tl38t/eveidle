// tools/test-taptap-leaderboard-provider.mjs
//
// 标准服技能排行榜 —— 第四阶段：TapTap Provider 单元测试
// 使用 mock tap 对象验证：登录成功 / 上报成功 / 读取成功 / 回退 local-only
// （tap 不存在 / 未登录）/ API 抛错结构化返回 / 整数分数 / 不修改 gameState /
// 不污染 eve_idle_save / 不创建定时器 / 不生成 drones 榜 / gathering 含行星工业+考古。
//
// 纯 node ESM，不依赖 jsdom（用内存版 localStorage + mock window.tap）。
// 如失败以非 0 退出。

import assert from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const url = (p) => pathToFileURL(path.join(root, p)).href;

// ---- 内存版 localStorage ----
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const mem = new MemStorage();
globalThis.localStorage = mem;

// ---- 最小 window 垫片（tap 由测试按需注入）----
const win = {
  localStorage: mem,
  LeaderboardPlatformConfig: null,
  TaptapLeaderboardProvider: null,
  NoopLeaderboardProvider: null,
};
globalThis.window = win;

// ---- 捕获定时器创建 ----
let timerCreated = false;
globalThis.setInterval = function () { timerCreated = true; return 0; };
globalThis.setTimeout = function () { timerCreated = true; return 0; };

// 加载被测试模块
await import(url("js/platform/leaderboard-platform-config.js"));
await import(url("js/platform/providers/noop-leaderboard-provider.js"));
await import(url("js/platform/providers/taptap-leaderboard-provider.js"));
const lbData = await import(url("js/data/leaderboard.js"));

const Config = globalThis.LeaderboardPlatformConfig || win.LeaderboardPlatformConfig;
const TaptapLeaderboardProvider = globalThis.TaptapLeaderboardProvider || win.TaptapLeaderboardProvider;
const NoopLeaderboardProvider = globalThis.NoopLeaderboardProvider || win.NoopLeaderboardProvider;
const { getLeaderboardSnapshot, getLeaderboardDefinitions } = lbData;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}

// ---- 真实风格 state（20 技能，含 drones 但 leaderboard.js 会过滤）----
function makeState() {
  return {
    lastSavedAt: 1700000000000,
    player: { name: "指挥官α" },
    skills: {
      mining: { lvl: 3, xp: 100 },
      planetaryIndustry: { lvl: 1, xp: 0 },
      refining: { lvl: 4, xp: 200 },
      gasHarvesting: { lvl: 2, xp: 50 },
      shipEngineering: { lvl: 5, xp: 300 },
      equipmentEngineering: { lvl: 1, xp: 10 },
      boosterEngineering: { lvl: 2, xp: 20 },
      laserOps: { lvl: 3, xp: 30 },
      cannonOps: { lvl: 3, xp: 40 },
      missileOperations: { lvl: 3, xp: 50 },
      defense: { lvl: 2, xp: 60 },
      shieldOperation: { lvl: 4, xp: 70 },
      armorReinforcement: { lvl: 4, xp: 80 },
      hullEngineering: { lvl: 4, xp: 90 },
      targeting: { lvl: 1, xp: 0 },
      piloting: { lvl: 1, xp: 0 },
      capacitorManagement: { lvl: 1, xp: 0 },
      drones: { lvl: 1, xp: 0 },
      combat: { lvl: 1, xp: 0 },
      archaeology: { lvl: 6, xp: 400 },
    },
  };
}

// ---- 构造 mock tap 对象 ----
// 可配置：是否记录上报、是否登录（onFailure vs onSuccess）、leaderboardId 是否真实
function makeMockTap(opts) {
  opts = opts || {};
  const submitted = [];
  const fetched = [];
  const mgr = {
    submitScores(params) {
      const cb = params.callback || {};
      // 模拟：若配置为「未登录/不可用」-> onFailure(401)；否则 onSuccess
      if (opts.loggedOut) {
        if (cb.onFailure) cb.onFailure(401, "not logged in");
        return;
      }
      // 验证 leaderboardId 非占位符（mock 仅接受真实 ID 字符串）
      for (const s of params.scores) {
        submitted.push(s);
        if (typeof s.score !== "number" || !Number.isInteger(s.score)) {
          if (cb.onFailure) cb.onFailure(400, "score not integer");
          return;
        }
        if (s.leaderboardId.indexOf("__TAPTAP_") === 0) {
          if (cb.onFailure) cb.onFailure(500001, "leaderboard not found");
          return;
        }
      }
      if (cb.onSuccess) cb.onSuccess({ submitted: params.scores.length });
    },
    loadLeaderboardScores(params) {
      const cb = params.callback || {};
      fetched.push(params.leaderboardId);
      if (opts.loggedOut) { if (cb.onFailure) cb.onFailure(401, "not logged in"); return; }
      if (params.leaderboardId.indexOf("__TAPTAP_") === 0) {
        if (cb.onFailure) cb.onFailure(500001, "leaderboard not found");
        return;
      }
      if (cb.onSuccess) cb.onSuccess({
        scores: [
          { name: "玩家A", score: 9999, level: 10 },
          { name: "玩家B", score: 5000, level: 8 },
        ],
      });
    },
    loadCurrentPlayerLeaderboardScore(params) {
      const cb = params.callback || {};
      if (cb.onSuccess) cb.onSuccess({ rank: 3, score: 4200 });
    },
  };
  return {
    _mgr: mgr,
    _submitted: submitted,
    _fetched: fetched,
    getLeaderboardManager() { return mgr; },
  };
}

// ============================================================
console.log("\n[A] tap 对象不存在 -> 回退 local-only");
{
  win.tap = undefined;
  const p = new TaptapLeaderboardProvider();
  const snap = getLeaderboardSnapshot(makeState());
  const res = await p.submitSnapshot(snap);
  ok("status === 'local-only'", res && res.status === "local-only");
  ok("mode === 'local-only'", res && res.mode === "local-only");
  ok("reason === 'unavailable'", res && res.reason === "unavailable");
  // 回退时仍写入本地快照（不丢数据）
  ok("回退时本地快照已保留", mem.getItem("leaderboard.local.snapshot.v1") != null);
  const st = p.getProviderStatus();
  ok("getProviderStatus().mode === 'local-only'", st.mode === "local-only");
  ok("getProviderStatus().platformName === 'TapTap'", st.platformName === "TapTap");
}

// ============================================================
console.log("\n[B] tap 存在但未登录 -> 回退 local-only（结构化）");
{
  // 注入真实 config，使「未登录」而非「配置缺失」成为回退原因。
  const realConfig = Object.assign({}, Config, {
    resolveTapTapLeaderboardId(boardId) {
      if (!boardId) return null;
      if (boardId === "total") return "real_total_lb";
      if (boardId.indexOf(".total") === boardId.length - 6) return "real_" + boardId + "_lb";
      if (boardId.indexOf("skill:") === 0) return "real_" + boardId.slice("skill:".length) + "_lb";
      return null;
    },
    isPlaceholderLeaderboardId(id) { return typeof id === "string" && id.indexOf("__TAPTAP_") === 0; },
  });
  win.LeaderboardPlatformConfig = realConfig;

  win.tap = makeMockTap({ loggedOut: true });
  const p = new TaptapLeaderboardProvider();
  const snap = getLeaderboardSnapshot(makeState());
  const res = await p.submitSnapshot(snap);
  ok("未登录时 status === 'local-only'", res && res.status === "local-only");
  ok("未登录时 reason === 'unavailable'", res && res.reason === "unavailable", res && res.reason);
  ok("未登录时不抛异常（ok 为 false 但结构化）", res && res.ok === false);

  win.LeaderboardPlatformConfig = Config;
}

// ============================================================
console.log("\n[C] TapTap 登录成功 + 上报成功（真实 leaderboardId 已配置）");
{
  // 临时注入「已配置真实 leaderboardId」的 config 变体，验证真实上报路径。
  const realConfig = Object.assign({}, Config, {
    resolveTapTapLeaderboardId(boardId) {
      if (!boardId) return null;
      if (boardId === "total") return "real_total_lb";
      if (boardId.indexOf(".total") === boardId.length - 6) return "real_" + boardId + "_lb";
      if (boardId.indexOf("skill:") === 0) return "real_" + boardId.slice("skill:".length) + "_lb";
      return null;
    },
    isPlaceholderLeaderboardId(id) { return typeof id === "string" && id.indexOf("__TAPTAP_") === 0; },
  });
  win.LeaderboardPlatformConfig = realConfig;

  win.tap = makeMockTap({ loggedOut: false });
  const p = new TaptapLeaderboardProvider();
  const snap = getLeaderboardSnapshot(makeState());
  const res = await p.submitSnapshot(snap);
  ok("status === 'submitted'", res && res.status === "submitted", res && res.status);
  ok("ok === true", res && res.ok === true);
  ok("mode === 'taptap'", res && res.mode === "taptap", res && res.mode);
  // 验证上报分数均为整数
  const submitted = win.tap._submitted;
  ok("有上报记录", submitted.length > 0);
  const allInt = submitted.every((s) => Number.isInteger(s.score) && s.score >= 0);
  ok("所有上报分数均为非负整数", allInt);
  // 验证未上报 drones
  const hasDrones = submitted.some((s) => String(s.leaderboardId).toLowerCase().indexOf("drone") >= 0);
  ok("未上报 drones 榜单", !hasDrones);
  ok("上报条数 = 快照条数（不含 drones）", submitted.length === snap.length, "submitted=" + submitted.length + " snap=" + snap.length);

  // 还原默认 config（保证 [J] 配置缺失测试基于占位符）
  win.LeaderboardPlatformConfig = Config;
}

// ============================================================
console.log("\n[D] TapTap 读取榜单成功（真实 leaderboardId 已配置）");
{
  // 临时注入「已配置真实 leaderboardId」的 config 变体，验证真实读取路径。
  const realConfig = Object.assign({}, Config, {
    resolveTapTapLeaderboardId(boardId) {
      if (!boardId) return null;
      if (boardId === "total") return "real_total_lb";
      if (boardId.indexOf(".total") === boardId.length - 6) return "real_" + boardId + "_lb";
      if (boardId.indexOf("skill:") === 0) return "real_" + boardId.slice("skill:".length) + "_lb";
      return null;
    },
    isPlaceholderLeaderboardId(id) { return typeof id === "string" && id.indexOf("__TAPTAP_") === 0; },
  });
  win.LeaderboardPlatformConfig = realConfig;
  // 重新加载 provider 以捕获新 config（模块顶部 capture 的是旧 Config，运行期走 window）
  // 注意 provider 运行时通过 window.LeaderboardPlatformConfig 读取，故直接复用实例即可。

  win.tap = makeMockTap({ loggedOut: false });
  const p = new TaptapLeaderboardProvider();
  const res = await p.fetchLeaderboard("skill:mining", { limit: 10 });
  ok("status === 'connected'", res && res.status === "connected", res && res.status);
  ok("mode === 'taptap'", res && res.mode === "taptap", res && res.mode);
  ok("返回 rows 数组且非空", res && Array.isArray(res.rows) && res.rows.length === 2);
  ok("rows 含 name/score", res && res.rows[0] && typeof res.rows[0].name === "string" && typeof res.rows[0].score === "number");

  // 还原默认 config（保证后续 [J] 配置缺失测试仍基于占位符）
  win.LeaderboardPlatformConfig = Config;
}

// ============================================================
console.log("\n[E] API 抛错 -> 结构化返回，不崩溃");
{
  // 让 getLeaderboardManager 直接抛错
  win.tap = {
    getLeaderboardManager() { throw new Error("mock-crash"); },
  };
  const p = new TaptapLeaderboardProvider();
  let threw = false;
  let res;
  try {
    res = await p.submitSnapshot(getLeaderboardSnapshot(makeState()));
  } catch (e) { threw = true; }
  ok("不抛出未处理异常", threw === false);
  ok("结构化返回 local-only", res && res.status === "local-only");
}

// ============================================================
console.log("\n[F] 分数为整数（非有限 -> 0，负数 -> 0）");
{
  ok("sanitizeScore(12.9)=12", Config.sanitizeScore(12.9) === 12);
  ok("sanitizeScore(-5)=0", Config.sanitizeScore(-5) === 0);
  ok("sanitizeScore(NaN)=0", Config.sanitizeScore(NaN) === 0);
  ok("sanitizeScore('abc')=0", Config.sanitizeScore("abc") === 0);
  ok("sanitizeScore(1e15)=int", Number.isInteger(Config.sanitizeScore(1e15)));
}

// ============================================================
console.log("\n[G] 不修改 gameState / 不污染 eve_idle_save");
{
  win.tap = makeMockTap({ loggedOut: false });
  mem.clear();
  const p = new TaptapLeaderboardProvider();
  const state = makeState();
  const before = JSON.stringify(state.skills);
  const beforeSave = mem.getItem("eve_idle_save");
  await p.submitSnapshot(getLeaderboardSnapshot(state));
  ok("state.skills 未被修改", JSON.stringify(state.skills) === before);
  ok("eve_idle_save 未被污染", mem.getItem("eve_idle_save") === beforeSave);
}

// ============================================================
console.log("\n[H] 不创建定时器");
{
  win.tap = makeMockTap({ loggedOut: false });
  const p = new TaptapLeaderboardProvider();
  await p.submitSnapshot(getLeaderboardSnapshot(makeState()));
  ok("未创建 setInterval/setTimeout", timerCreated === false);
}

// ============================================================
console.log("\n[I] 不生成 drones 榜；gathering 含行星工业 + 考古");
{
  // 1) 快照中不应出现 skill:drones
  const snap = getLeaderboardSnapshot(makeState());
  const hasDrones = snap.some((e) => e.boardId === "skill:drones");
  ok("快照不含 skill:drones", !hasDrones);
  // 2) 配置层：drones 不可上报
  ok("isBoardReportable('skill:drones') === false", Config.isBoardReportable("skill:drones") === false);
  // 3) 行星工业 / 考古 属 gathering
  ok("categoryOf('planetaryIndustry') === 'gathering'", Config.categoryOf("planetaryIndustry") === "gathering");
  ok("categoryOf('archaeology') === 'gathering'", Config.categoryOf("archaeology") === "gathering");
  // 4) 全部定义不含 drones
  const defs = getLeaderboardDefinitions(makeState());
  ok("定义不含 drones", !defs.some((d) => d.boardId === "skill:drones"));
  // 5) 聚合榜可解析
  ok("total 可解析为 leaderboardId", typeof Config.resolveTapTapLeaderboardId("total") === "string");
  ok("gathering.total 可解析", typeof Config.resolveTapTapLeaderboardId("gathering.total") === "string");
}

// ============================================================
console.log("\n[J] 配置缺失（占位符 leaderboardId）-> 不伪造成功");
{
  // 默认 config 的 leaderboardId 仍是占位符 __TAPTAP_...
  win.tap = makeMockTap({ loggedOut: false });
  const p = new TaptapLeaderboardProvider();
  // 提交未配置的未知榜单，验证不会伪造成功。
  const res = await p.submitSnapshot([{ boardId: "skill:unknown", score: 1, level: 1, xp: 1 }]);
  ok("占位符未配置时返回 local-only", res && res.status === "local-only");
  ok("未知榜单被拒绝且不伪造成功", res && res.reason !== "submitted");
  ok("ok === false（不伪造成功）", res && res.ok === false);
}

// ============================================================
console.log("\n[K] detectTapTapAvailable 探测");
{
  win.tap = makeMockTap({ loggedOut: false });
  ok("tap 可用 -> true", Config.detectTapTapAvailable() === true);
  win.tap = undefined;
  ok("tap 不存在 -> false", Config.detectTapTapAvailable() === false);
}

// ============================================================
console.log(`\n========== TapTap Provider 测试结果 ==========`);
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("全部通过 ✅");
process.exit(0);
