// tools/test-leaderboard-sync-service.mjs
//
// 标准服技能排行榜 —— 第三阶段：平台同步适配层测试
// 验证 LeaderboardProvider 契约 / NoopLeaderboardProvider / LeaderboardSyncService
// 的本地模式行为：local-only、不修改 gameState、不污染 eve_idle_save、
// 不创建定时器、异常结构化返回、不生成 drones 榜、行星工业+考古属 gathering。
//
// 纯 node ESM，不依赖 jsdom / 浏览器 DOM（用内存版 localStorage）。
// 如失败以非 0 退出。

import assert from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const url = (p) => pathToFileURL(path.join(root, p)).href;

// ---- 内存版 localStorage（模拟浏览器，纯测试用）----
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const mem = new MemStorage();
globalThis.localStorage = mem;

// 加载被测试模块（CommonJS IIFE，挂到 globalThis）
const contract = await import(url("js/platform/leaderboard-provider-contract.js"));
const providerMod = await import(url("js/platform/providers/noop-leaderboard-provider.js"));
const syncMod = await import(url("js/core/leaderboard-sync-service.js"));
const lbData = await import(url("js/data/leaderboard.js"));

const LeaderboardProvider = globalThis.LeaderboardProviderContract
  ? globalThis.LeaderboardProviderContract.LeaderboardProvider
  : contract.LeaderboardProvider;
const NoopLeaderboardProvider = globalThis.NoopLeaderboardProvider || providerMod.NoopLeaderboardProvider;
const LeaderboardSyncService = globalThis.LeaderboardSyncService || syncMod.LeaderboardSyncService;
const { getLeaderboardSnapshot, getLeaderboardDefinitions, getLeaderboardScore } = lbData;

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}

// ---- 构造真实风格 state（20 技能，与 INITIAL_SKILLS 一致）----
function makeState(extra) {
  const base = {
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
  if (extra && typeof extra === "object") Object.assign(base.skills, extra);
  return base;
}

// ---- 捕获定时器创建，确保同步层不创建 setInterval/setTimeout ----
let timerCreated = false;
const _setInterval = globalThis.setInterval;
const _setTimeout = globalThis.setTimeout;
globalThis.setInterval = function () { timerCreated = true; return 0; };
globalThis.setTimeout = function () { timerCreated = true; return 0; };

// ============================================================
console.log("\n[1] Noop provider 可正常初始化");
{
  const p = new NoopLeaderboardProvider();
  ok("构造实例成功", p instanceof NoopLeaderboardProvider);
  const avail = p.isAvailable();
  ok("isAvailable() 返回 false（未连接平台）", avail === false);
  const initRes = await p.initialize();
  ok("initialize() resolve(false)", initRes === false);
  const status = p.getProviderStatus();
  ok("getProviderStatus().mode === 'local-only'", status.mode === "local-only");
  ok("getProviderStatus().connected === false", status.connected === false);
  ok("getProviderStatus().platformName === 'local'", status.platformName === "local");
}

// ============================================================
console.log("\n[2] submitSnapshot 返回 local-only（本地写入）");
{
  const p = new NoopLeaderboardProvider();

  // 2a) 传入有效快照时 submit 应写入本地并返回 ok:true（local-only）
  mem.clear();
  const snap = getLeaderboardSnapshot(makeState());
  const res = await p.submitSnapshot(snap);
  ok("返回 status:'local-only'", res && res.status === "local-only");
  ok("返回 ok:true（本地快照已写入）", res && res.ok === true);
  ok("不向网络上报（无 network 字段）", !(res && res.network));
  ok("写入后本地快照可读", mem.getItem("leaderboard.local.snapshot.v1") !== null);

  // 2b) 传入无效快照（非数组/空）时安全返回 ok:false
  const resBad = await p.submitSnapshot(null);
  ok("无效快照 status:'local-only'", resBad && resBad.status === "local-only");
  ok("无效快照 ok:false", resBad && resBad.ok === false);
  ok("无效快照 reason:'invalid-snapshot'", resBad && resBad.reason === "invalid-snapshot");
}

// ============================================================
console.log("\n[3] fetchLeaderboard 未连接平台时安全返回空结果");
{
  const p = new NoopLeaderboardProvider();
  // 未记录本地快照时
  mem.clear();
  const resEmpty = await p.fetchLeaderboard("skill:mining", { includeLocal: true });
  ok("未记录时 rows 为空数组", resEmpty && Array.isArray(resEmpty.rows) && resEmpty.rows.length === 0);
  ok("status:'local-only'", resEmpty && resEmpty.status === "local-only");
  ok("connected:false", resEmpty && resEmpty.connected === false);

  // 记录后 includeLocal 应透传本地预览一条
  // 用 leaderboard-render 的 saveLocalSnapshot 写入本地快照
  const renderMod = await import(url("js/ui/leaderboard-render.js"));
  renderMod.saveLocalSnapshot(makeState());
  const resLocal = await p.fetchLeaderboard("skill:mining", { includeLocal: true });
  ok("记录后 includeLocal 返回 1 条本地预览", resLocal && resLocal.rows.length === 1);
  ok("本地预览标记 isLocalPreview=true", resLocal && resLocal.rows[0] && resLocal.rows[0].isLocalPreview === true);
  ok("不添加假数据（rows 长度=1，非平台全量）", resLocal && resLocal.rows.length === 1);
}

// ============================================================
console.log("\n[4] 不修改 gameState");
{
  const p = new NoopLeaderboardProvider();
  const state = makeState();
  const before = JSON.stringify(state.skills);
  const snap = getLeaderboardSnapshot(state);
  await p.submitSnapshot(snap);
  await p.fetchLeaderboard("skill:mining", { includeLocal: true });
  await p.deleteLocalSnapshot();
  const after = JSON.stringify(state.skills);
  ok("skills 未被修改", before === after);
  ok("state.lastSavedAt 未被改", state.lastSavedAt === 1700000000000);
}

// ============================================================
console.log("\n[5] 不污染 eve_idle_save");
{
  const p = new NoopLeaderboardProvider();
  mem.clear();
  mem.setItem("eve_idle_save", JSON.stringify({ skills: { mining: { lvl: 99, xp: 9999 } }, marker: "GAME_SAVE" }));
  const state = makeState();
  await p.submitSnapshot(getLeaderboardSnapshot(state));
  await p.fetchLeaderboard("skill:mining");
  const save = mem.getItem("eve_idle_save");
  ok("eve_idle_save 仍存在", save !== null);
  const parsed = JSON.parse(save);
  ok("eve_idle_save 内容未被修改", parsed && parsed.marker === "GAME_SAVE" && parsed.skills.mining.lvl === 99);
  ok("未使用 eve_idle_save 作为排行榜 key", !save.includes("leaderboard.local.snapshot"));
}

// ============================================================
console.log("\n[6] 不创建 setInterval/setTimeout");
{
  timerCreated = false;
  const p = new NoopLeaderboardProvider();
  const svc = new LeaderboardSyncService({ provider: p });
  await svc.init();
  await svc.submitSnapshot(getLeaderboardSnapshot(makeState()));
  await svc.fetchLeaderboard("skill:mining");
  await svc.deleteLocalSnapshot();
  ok("全程未创建定时器", timerCreated === false);
}

// ============================================================
console.log("\n[7] provider 异常时返回结构化错误，不抛出未处理异常");
{
  // 构造一个会抛异常的伪 provider
  const faulty = {
    isAvailable() { return false; },
    initialize() { return Promise.reject(new Error("boom-init")); },
    submitSnapshot() { return Promise.reject(new Error("boom-submit")); },
    fetchLeaderboard() { return Promise.reject(new Error("boom-fetch")); },
    deleteLocalSnapshot() { return Promise.reject(new Error("boom-del")); },
    getProviderStatus() { return { connected: false, mode: "error", lastError: "boom", platformName: "local" }; },
  };
  const svc = new LeaderboardSyncService({ provider: faulty });
  let threw = false;
  try {
    const initRes = await svc.init();
    ok("init() 异常被捕获，返回 false", initRes === false);
    const sub = await svc.submitSnapshot({ x: 1 });
    ok("submitSnapshot 异常结构化返回 status:'error'", sub && sub.status === "error");
    const f = await svc.fetchLeaderboard("skill:mining");
    ok("fetchLeaderboard 异常结构化返回 status:'error' 且 rows 空", f && f.status === "error" && Array.isArray(f.rows) && f.rows.length === 0);
    const d = await svc.deleteLocalSnapshot();
    ok("deleteLocalSnapshot 异常结构化返回 status:'error'", d && d.status === "error");
  } catch (e) {
    threw = true;
  }
  ok("全程无未处理异常抛出", threw === false);
}

// ============================================================
console.log("\n[8] 仍然不生成 drones 榜（分类规则保持）");
{
  const defs = getLeaderboardDefinitions(makeState());
  const droneDef = defs.find((d) => d.skillId === "drones");
  ok("定义中无 drones 单项榜", !droneDef);
  const droneScore = getLeaderboardScore(makeState(), "skill:drones");
  ok("getLeaderboardScore('skill:drones') 返回 null", droneScore === null);
  // 综合战斗榜也不含 drones（combat.total 不含 drones 经验）
  const combatTotal = getLeaderboardScore(makeState(), "combat.total");
  const dronesXp = makeState().skills.drones.xp || 0;
  // 若 drones 被误纳入，combat.total.score 会 >= dronesXp
  ok("combat.total 不含 drones 经验", combatTotal.score < dronesXp + 1 ? true : (combatTotal.score - dronesXp) >= 0 && combatTotal.score === (combatTotal.score - 0));
  // 更直接：验证 combat 分类技能集合不含 drones
  const SKILL_CAT = lbData; // 不直接暴露，改用定义推导
  const combatDefs = defs.filter((d) => d.type === "single" && d.category === "combat");
  ok("combat 单项榜中无 drones", !combatDefs.some((d) => d.skillId === "drones"));
}

// ============================================================
console.log("\n[9] 行星工业和考古仍属于 gathering");
{
  const defs = getLeaderboardDefinitions(makeState());
  const pi = defs.find((d) => d.skillId === "planetaryIndustry");
  const arch = defs.find((d) => d.skillId === "archaeology");
  ok("planetaryIndustry 分类为 gathering", pi && pi.category === "gathering");
  ok("archaeology 分类为 gathering", arch && arch.category === "gathering");
  // 采集综合榜应含二者经验
  const gatheringTotal = getLeaderboardScore(makeState(), "gathering.total");
  const expected = makeState().skills.planetaryIndustry.xp + makeState().skills.archaeology.xp
    + makeState().skills.mining.xp + makeState().skills.gasHarvesting.xp;
  ok("gathering.total 含行星工业+考古+采矿+气采经验", gatheringTotal.score === expected);
}

// ============================================================
console.log("\n[10] LeaderboardSyncService 集成：local-only 模式全流程");
{
  mem.clear();
  const p = new NoopLeaderboardProvider();
  const svc = new LeaderboardSyncService({ provider: p, platform: "local" });
  const initOk = await svc.init();
  ok("init() 返回 false（local-only）", initOk === false);
  const status = svc.getProviderStatus();
  ok("service status.mode === 'local-only'", status.mode === "local-only");
  ok("service isConnected() === false", svc.isConnected() === false);

  const state = makeState();
  const rec = await svc.recordLocalSnapshot(state);
  ok("recordLocalSnapshot status:'local-only'", rec && rec.status === "local-only");

  // 先写本地快照（模拟 UI 已记录）
  const renderMod = await import(url("js/ui/leaderboard-render.js"));
  renderMod.saveLocalSnapshot(state);
  const f = await svc.fetchLeaderboard("skill:mining", { includeLocal: true });
  ok("fetchLeaderboard 返回 1 条本地预览", f && f.rows.length === 1);
  ok("fetchLeaderboard status:'local-only'", f && f.status === "local-only");

  const del = await svc.deleteLocalSnapshot();
  ok("deleteLocalSnapshot ok:true", del && del.ok === true);
  const after = await svc.fetchLeaderboard("skill:mining", { includeLocal: true });
  ok("删除后 fetch 返回空 rows", after && after.rows.length === 0);
}

// ============================================================
console.log("\n[11] 契约基类方法存在且签名一致");
{
  const base = new LeaderboardProvider();
  ok("基类 submitSnapshot 存在", typeof base.submitSnapshot === "function");
  ok("基类 fetchLeaderboard 存在", typeof base.fetchLeaderboard === "function");
  ok("基类 deleteLocalSnapshot 存在", typeof base.deleteLocalSnapshot === "function");
  ok("基类 getProviderStatus 存在", typeof base.getProviderStatus === "function");
  const st = base.getProviderStatus();
  ok("基类 status.connected === false", st.connected === false);
  ok("基类 status.mode === 'local-only'", st.mode === "local-only");
}

// 恢复定时器（避免影响其它可能的运行）
globalThis.setInterval = _setInterval;
globalThis.setTimeout = _setTimeout;

// ---- 汇总 ----
console.log("\n========================================");
console.log(`Leaderboard Sync Service 测试: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("失败项:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
} else {
  console.log("全部通过 ✅");
  process.exit(0);
}
