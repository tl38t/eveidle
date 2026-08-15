// 机器测试：AchievementSyncService（Noop 不可用 / 平台映射跳过 / Mock 上报 / 账本幂等）。
// 第一阶段交付·七 / ·八 的成就同步保证。
//
// 用法：node tools/test-achievement-platform-sync.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");

let failures = 0;
function ok(cond, label) {
  if (cond) console.log("  PASS  " + label);
  else { console.log("  FAIL  " + label); failures++; }
}

function loadInContext(files, extra = []) {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = console;
  const store = {};
  ctx.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };
  ctx.setInterval = () => 0;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(join(repo, f), "utf8"), ctx, { filename: f });
  for (const code of extra) vm.runInContext(code, ctx, { filename: "inline" });
  return ctx;
}

// ---- 上下文 1：真实映射 + Noop provider（第一阶段“不发布”纪律） ----
const ctx = loadInContext([
  "js/data/platform-achievement-map.js",
  "js/platform/providers/noop-achievement-provider.js",
  "js/core/achievement-sync-service.js"
]);
const Svc = ctx.AchievementSyncService;
const MAP = ctx.PlatformAchievementMap;
const svc = new Svc({ provider: new ctx.NoopAchievementProvider(), map: MAP, platform: "taptap", metaStore: null });
const initNoop = await svc.init();
ok(initNoop === false, "Noop 成就 provider 初始化返回 false（不可用）");
ok(svc.isAvailable() === false, "Noop 服务 isAvailable() === false");
ok(svc.handleUnlock("A01", Date.now()).skipped === true, "Noop 不可用时 handleUnlock 被跳过");
// 第一阶段：映射表 OVERRIDES 为空 → 所有内部 ID 在 taptap 列均无平台 ID → 补发对账尝试 0 次。
const allUnlocked = {};
MAP.ids().forEach((id) => { allUnlocked[id] = Date.now(); });
const attempted = svc.reconcileAll(allUnlocked);
ok(attempted === 0, "第一阶段 reconcileAll 对所有已解锁成就尝试 0 次（无平台映射 → 跳过）[" + attempted + "]");

// ---- 上下文 2：Mock 映射 + Mock provider（上报逻辑） ----
const mockCode = `
  function MockAchProvider() { this.platform = "taptap"; this.initialized = false; this.calls = []; }
  MockAchProvider.prototype.initialize = function () { this.initialized = true; return Promise.resolve(true); };
  MockAchProvider.prototype.isAvailable = function () { return this.initialized; };
  MockAchProvider.prototype.unlock = function (platformId) { this.calls.push(platformId); return Promise.resolve(true); };
  function MockMap() {}
  MockMap.prototype.get = function (id) {
    if (id === "ZZZ") return null; // 无映射内部 ID（用于 no-mapping 跳过断言）
    return { taptap: "TP_" + id, steam: null };
  };
`;
const ctx2 = loadInContext([
  "js/core/achievement-sync-service.js"
], [mockCode]);
const Svc2 = ctx2.AchievementSyncService;
const svc2 = new Svc2({ provider: new ctx2.MockAchProvider(), map: new ctx2.MockMap(), platform: "taptap", metaStore: null });
await svc2.init();
ok(svc2.isAvailable() === true, "Mock 成就 provider 初始化后可用");
const r1 = await svc2.handleUnlock("A01", 1000);
ok(r1.ok === true && svc2.getLedger()["A01"], "handleUnlock 上报成功并写入账本");
const r2 = await svc2.handleUnlock("A01", 1000);
ok(r2.skipped === true && r2.reason === "already-synced", "同一成就二次上报被跳过（账本幂等）");
const r3 = await svc2.handleUnlock("ZZZ", 1000);
ok(r3.skipped === true && r3.reason === "no-mapping", "无映射内部 ID 被跳过");
const attempted2 = svc2.reconcileAll({ A01: 1000, A02: 2000, A03: 3000 });
ok(attempted2 === 2, "reconcileAll 仅对未上报的 A02/A03 尝试（A01 已上报跳过）[" + attempted2 + "]");
// reconcileAll 内部 _pushToProvider 为异步（provider.unlock 返回 Promise），需让微任务落地后再查账本。
await new Promise((resolve) => setTimeout(resolve, 0));
ok(svc2.getLedger()["A02"] && svc2.getLedger()["A03"], "reconcileAll 后 A02/A03 入账");

console.log(failures === 0 ? "\n测试通过 (0 失败)" : "\n测试失败 (" + failures + " 项)");
process.exit(failures === 0 ? 0 : 1);
