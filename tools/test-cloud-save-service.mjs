// 机器测试：CloudSaveService（冲突决策 / Noop 不可用 / Mock 上传 / 60s 门禁 / 边界纪律）。
// 第一阶段交付·四 / ·十一 的云存档状态机保证。
//
// 用法：node tools/test-cloud-save-service.mjs
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
  ctx.clearInterval = () => {};
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(join(repo, f), "utf8"), ctx, { filename: f });
  for (const code of extra) vm.runInContext(code, ctx, { filename: "inline" });
  return ctx;
}

const ctx = loadInContext([
  "js/core/save-envelope.js",
  "js/platform/cloud-save-contract.js",
  "js/platform/providers/noop-cloud-provider.js",
  "js/core/cloud-save-service.js"
]);

const CloudSaveService = ctx.CloudSaveService;
ok(typeof CloudSaveService === "function", "CloudSaveService 已加载");

// 1) decideResolution 纯函数（五种决策）
const D = CloudSaveService.decideResolution;
ok(D({ hasLocal: false, hasCloud: false }).decision === "new", "无本地无云端 → new");
ok(D({ hasLocal: true, hasCloud: false }).decision === "use-local", "有本地无云端 → use-local");
ok(D({ hasLocal: false, hasCloud: true }).decision === "use-cloud", "无本地有云端 → use-cloud");
ok(D({ hasLocal: true, hasCloud: true, localChecksum: "a", cloudChecksum: "a", lastCloudChecksum: "a" }).decision === "identical", "三方相同 → identical");
ok(D({ hasLocal: true, hasCloud: true, localChecksum: "a", cloudChecksum: "b", lastCloudChecksum: "a" }).decision === "use-cloud", "仅云端变化 → use-cloud");
ok(D({ hasLocal: true, hasCloud: true, localChecksum: "b", cloudChecksum: "a", lastCloudChecksum: "a" }).decision === "use-local", "仅本地变化 → use-local");
ok(D({ hasLocal: true, hasCloud: true, localChecksum: "b", cloudChecksum: "c", lastCloudChecksum: "a" }).decision === "conflict", "双方都变 → conflict");

// 2) Noop provider → 初始化后不可用
const noopSvc = new CloudSaveService({ provider: new ctx.NoopCloudProvider(), metaStore: null, deviceId: "dev-test" });
const initNoop = await noopSvc.init();
ok(initNoop === false, "Noop provider 初始化返回 false（不可用）");
ok(noopSvc.isAvailable() === false, "Noop 服务 isAvailable() === false");
ok(noopSvc.getState() === "local-only", "Noop 状态为 local-only");
// Noop 方法被调用亦不得触碰 localStorage
await noopSvc.listCloudArchives();
const noopFetched = await noopSvc.fetchCloudEnvelope();
ok(noopFetched && noopFetched.status === "none", "P0-6：Noop（不可用）fetchCloudEnvelope 返回 {status:'none'}（区别于 error）");
try { await noopSvc.deleteCloud(); } catch (e) { /* 不可用时应拒绝，符合预期 */ }
ok(Object.keys(ctx.localStorage._store).length === 0, "Noop 路径下无任何 localStorage 写入（决定·三 边界纪律）");

// 3) Mock provider → 可用，上传 / 元数据记账 / 60s 门禁
const mockCode = `
  function MockCloudProvider() { this.platform = "mock"; this._archives = []; this._files = {}; this.initialized = false; this.uploads = 0; }
  MockCloudProvider.prototype.initialize = function () { this.initialized = true; return Promise.resolve(true); };
  MockCloudProvider.prototype.isAvailable = function () { return this.initialized; };
  MockCloudProvider.prototype.listArchives = function () { return Promise.resolve(this._archives); };
  MockCloudProvider.prototype.downloadArchive = function (meta) { return Promise.resolve(this._files[meta.archiveId] || null); };
  MockCloudProvider.prototype.uploadArchive = function (req) {
    this.uploads++;
    var id = "arch_" + this.uploads;
    this._archives = [{ slotName: req.slotName, archiveId: id, modifiedAt: Date.now(), size: 1 }];
    this._files[id] = req.envelope;
    return Promise.resolve({ slotName: req.slotName, archiveId: id, modifiedAt: Date.now(), size: 1 });
  };
  MockCloudProvider.prototype.deleteArchive = function (meta) { this._archives = []; return Promise.resolve(true); };
`;
const ctx2 = loadInContext([
  "js/core/save-envelope.js",
  "js/platform/cloud-save-contract.js",
  "js/core/cloud-save-service.js"
], [mockCode]);
const CloudSaveService2 = ctx2.CloudSaveService;
const mock = new ctx2.MockCloudProvider();
const svc = new CloudSaveService2({ provider: mock, deviceId: "dev-x", metaStore: null });
await svc.init();
ok(svc.isAvailable() === true, "Mock provider 初始化后可用");

const payload = { skills: { laserOps: { lvl: 1 } }, resources: { isk: 100 } };
const up = await svc.uploadNow(payload, "auto");
ok(up.ok === true, "uploadNow 成功");
ok(!!up.meta && !!up.meta.archiveId, "uploadNow 返回 archiveId");
ok(svc.getSyncMeta().lastCloudChecksum === up.envelope.checksum, "sync_meta.lastCloudChecksum 已记录");
ok(up.envelope.revision === 1, "首次上传 envelope.revision === 1（max(local,cloud)+1）");
// localRevision 是「本地存档」计数，仅由 persistence.save() 经 recordLocal 递增（非 uploadNow）。
svc.recordLocal("chk-local", Date.now(), 1);
ok(svc.getSyncMeta().localRevision === 1, "recordLocal 后 localRevision === 1（本地存档记账）");
const up2 = await svc.maybeUpload(payload, "auto");
ok(up2.ok === true && up2.reason === "clean", "无本地变更时 maybeUpload 不重复上传");
svc.markDirty("changed");
const up3 = await svc.maybeUpload(payload, "auto");
ok(up3.ok === false && up3.reason === "rate-limited", "有变更但在 60s 门禁内保持 dirty 并返回 rate-limited");

// 4) fetchCloudEnvelope 经 Mock 下载并解码回信封
const fetched = await svc.fetchCloudEnvelope();
ok(fetched && fetched.status === "ok", "P0-6：可用服务 fetchCloudEnvelope 返回 {status:'ok'}");
ok(fetched && fetched.envelope && fetched.envelope.checksum === up.envelope.checksum, "fetchCloudEnvelope 下载并解码回信封（校验和一致）");

// 4b) P0-6：列表成功但无该 slot → {status:'none'}（允许开新档）；下载损坏 → {status:'error'}；
//     列表/下载抛错 → {status:'error'}（明确区别于 none，绝不混淆「无云档」与「查询失败」）。
{
  const corruptCode = `
    function CorruptProvider() { this.platform = "mock"; this._archives = [{ slotName: "auto_save", archiveId: "a1" }]; }
    CorruptProvider.prototype.initialize = function () { return Promise.resolve(true); };
    CorruptProvider.prototype.isAvailable = function () { return true; };
    CorruptProvider.prototype.listArchives = function () { return Promise.resolve(this._archives); };
    CorruptProvider.prototype.downloadArchive = function () { return Promise.resolve("not-a-valid-envelope"); };
    CorruptProvider.prototype.uploadArchive = function () { return Promise.resolve({ slotName: "auto_save", archiveId: "a1" }); };
  `;
  const cctx = loadInContext([
    "js/core/save-envelope.js",
    "js/platform/cloud-save-contract.js",
    "js/core/cloud-save-service.js"
  ], [corruptCode]);
  const corruptSvc = new cctx.CloudSaveService({ provider: new cctx.CorruptProvider(), deviceId: "dev-c", metaStore: null });
  await corruptSvc.init();
  const corruptFetched = await corruptSvc.fetchCloudEnvelope();
  ok(corruptFetched && corruptFetched.status === "error", "P0-6：下载损坏 / 解码失败 → {status:'error'}（不误判为 none）");

  const failCode = `
    function FailProvider() { this.platform = "mock"; }
    FailProvider.prototype.initialize = function () { return Promise.resolve(true); };
    FailProvider.prototype.isAvailable = function () { return true; };
    FailProvider.prototype.listArchives = function () { return Promise.reject(new Error("network down")); };
    FailProvider.prototype.downloadArchive = function () { return Promise.resolve("x"); };
    FailProvider.prototype.uploadArchive = function () { return Promise.resolve({ slotName: "auto_save", archiveId: "a1" }); };
  `;
  const fctx = loadInContext([
    "js/core/save-envelope.js",
    "js/platform/cloud-save-contract.js",
    "js/core/cloud-save-service.js"
  ], [failCode]);
  const failSvc = new fctx.CloudSaveService({ provider: new fctx.FailProvider(), deviceId: "dev-f", metaStore: null });
  await failSvc.init();
  const failFetched = await failSvc.fetchCloudEnvelope();
  ok(failFetched && failFetched.status === "error" && !!failFetched.error, "P0-6：列表/下载抛错 → {status:'error', error}（显式失败）");
}

// 4c) P1-2：可重试错误码经有限退避后最终成功（不无限循环）；不可重试错误直接转 error。
{
  const retryCode = `
    function RetryProvider() {
      this.platform = "mock"; this._archives = []; this._files = {}; this.initialized = true;
      this.listCalls = 0; this.upCalls = 0;
    }
    RetryProvider.prototype.initialize = function () { return Promise.resolve(true); };
    RetryProvider.prototype.isAvailable = function () { return true; };
    RetryProvider.prototype.listArchives = function () { this.listCalls++; return Promise.resolve(this._archives); };
    RetryProvider.prototype.downloadArchive = function (m) { return Promise.resolve(this._files[m.archiveId] || null); };
    RetryProvider.prototype.uploadArchive = function (req) {
      this.upCalls++;
      if (this.upCalls < 3) { var e = new Error("concurrent"); e.code = "400007"; return Promise.reject(e); }
      var id = "arch_" + this.upCalls;
      this._archives = [{ slotName: req.slotName, archiveId: id }];
      this._files[id] = req.envelope;
      return Promise.resolve({ slotName: req.slotName, archiveId: id });
    };
    RetryProvider.prototype.deleteArchive = function () { this._archives = []; return Promise.resolve(true); };
  `;
  const rctx = loadInContext([
    "js/core/save-envelope.js",
    "js/platform/cloud-save-contract.js",
    "js/core/cloud-save-service.js"
  ], [retryCode]);
  const rsvc = new rctx.CloudSaveService({ provider: new rctx.RetryProvider(), deviceId: "dev-r", metaStore: null });
  rsvc._sleep = function () { return Promise.resolve(); }; // 可控时钟：无真实等待
  await rsvc.init();
  const rUp = await rsvc.uploadNow({ skills: {}, resources: {} }, "auto");
  ok(rUp.ok === true, "P1-2：400007 瞬时并发经有限退避重试后最终成功");
  ok(rsvc.getSyncMeta().localChecksum !== undefined, "P1-2：retry 成功后元数据已记账");

  const hardCode = `
    function HardProvider() { this.platform = "mock"; this.initialized = true; }
    HardProvider.prototype.initialize = function () { return Promise.resolve(true); };
    HardProvider.prototype.isAvailable = function () { return true; };
    HardProvider.prototype.listArchives = function () { return Promise.resolve([]); };
    HardProvider.prototype.downloadArchive = function () { return Promise.resolve(null); };
    HardProvider.prototype.uploadArchive = function () {
      var e = new Error("fatal"); e.code = "500000"; return Promise.reject(e);
    };
    HardProvider.prototype.deleteArchive = function () { return Promise.resolve(true); };
  `;
  const hctx = loadInContext([
    "js/core/save-envelope.js",
    "js/platform/cloud-save-contract.js",
    "js/core/cloud-save-service.js"
  ], [hardCode]);
  const hsvc = new hctx.CloudSaveService({ provider: new hctx.HardProvider(), deviceId: "dev-h", metaStore: null });
  hsvc._sleep = function () { return Promise.resolve(); };
  await hsvc.init();
  const hUp = await hsvc.uploadNow({ skills: {} }, "auto");
  ok(hUp.ok === false && hUp.reason === "500000", "P1-2：不可重试错误码立即失败（不无限重试）");
  ok(hsvc.status().dirty === true, "上传失败后 dirty 保留，允许后续重试");
}

// 上传进行中产生的新本地变更不能被旧上传成功错误清除。
{
  let finishUpload;
  class SlowProvider {
    initialize(){return Promise.resolve(true);} isAvailable(){return true;}
    listArchives(){return Promise.resolve([]);} downloadArchive(){return Promise.resolve(null);}
    deleteArchive(){return Promise.resolve(true);}
    uploadArchive(req) { return new Promise((resolve) => { finishUpload = () => resolve({ slotName:"auto_save", archiveId:"slow", modifiedAt:Date.now(), size:1 }); }); }
  }
  const slow = new CloudSaveService({ provider:new SlowProvider(), deviceId:"slow", metaStore:null });
  await slow.init();
  slow.markDirty("before");
  const pending = slow.uploadNow({ skills:{} }, "auto");
  slow.markDirty("during");
  finishUpload();
  const result = await pending;
  ok(result.ok === true && slow.status().dirty === true, "上传期间的新变更在旧上传成功后仍保持 dirty");
}

// 5) deleteCloud 清除云端标记但绝不触碰本地存档键
await svc.deleteCloud();
ok(svc.getSyncMeta().lastCloudChecksum === "", "deleteCloud 后 lastCloudChecksum 清空");

console.log(failures === 0 ? "\n测试通过 (0 失败)" : "\n测试失败 (" + failures + " 项)");
process.exit(failures === 0 ? 0 : 1);
