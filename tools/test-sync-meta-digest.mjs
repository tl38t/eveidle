// 机器测试：B 修复（2026-09-10）—— sync_meta 只持久化 64 位校验摘要，不再存整份 checksum。
//
// 背景：SaveEnvelope.checksum 是「整份 payload 的 stableStringify」（不是哈希，verify() 用全串比对）。
// 原样写进 sync_meta 的 localChecksum / lastCloudChecksum 两份 → 该键体积 ≈ 2× 存档本体
// （客户真机实测 668.5KB / 存档 304.3KB = 220%），在 localStorage 与同域名其他小游戏共享
// 10MB 配额的前提下直接触发 QuotaExceededError。
//
// 本测试守护三条不变量：
//   1. 摘要函数长度固定（16 hex）且对「已是摘要」的输入幂等 —— 旧档无损迁移的前提；
//   2. 三方比对（local / cloud / lastCloud）在「全量串 / 摘要」任意混搭输入下决策完全一致；
//   3. 落地后 sync_meta 的序列化体积与存档本体解耦（不再随之线性膨胀）。
//
// 用法：node tools/test-sync-meta-digest.mjs
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
  ctx.setTimeout = (fn, ms) => setTimeout(fn, ms);
  ctx.clearTimeout = (id) => clearTimeout(id);
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(readFileSync(join(repo, f), "utf8"), ctx, { filename: f });
  for (const code of extra) vm.runInContext(code, ctx, { filename: "inline" });
  return ctx;
}

const MOCK_PROVIDER = `
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

function loadFiles() {
  return loadInContext([
    "js/core/save-envelope.js",
    "js/platform/cloud-save-contract.js",
    "js/core/cloud-save-service.js"
  ], [MOCK_PROVIDER]);
}

const ctx = loadFiles();
const CloudSaveService = ctx.CloudSaveService;
const D = CloudSaveService.decideResolution;
const digest = CloudSaveService.checksumDigest;

console.log("\n[1] 摘要函数：格式与幂等");
{
  const full = '{"_dirty":true,"skills":{"a":1},"resources":{"isk":123}}';
  const d1 = digest(full);
  ok(typeof d1 === "string" && d1.length === 16, "全量串 → 16 位摘要");
  ok(/^[0-9a-f]{16}$/.test(d1), "摘要为小写十六进制");
  ok(digest(d1) === d1, "幂等：对已是摘要的输入原样返回（旧档无损迁移前提）");
  ok(digest("") === "", "空串 → 空（保持「未记录」语义）");
  ok(digest(undefined) === "" && digest(null) === "", "非字符串 → 空串，不抛错");
  ok(digest(full) === d1, "确定性：同内容同摘要");
  ok(digest(full + "x") !== d1, "区分度：内容变化 → 摘要变化");
}

console.log("\n[2] 摘要函数：抗碰撞（同长度前缀 / 尾字符差异）");
{
  const base = "a".repeat(2000);
  const set = new Set();
  for (let i = 0; i < 500; i++) set.add(digest(base + i));
  ok(set.size === 500, "500 个同长度不同内容 → 500 个不同摘要（无碰撞）");
  ok(digest(base + "A") !== digest(base + "B"), "尾字符差异可区分");
  ok(digest("ab") !== digest("ba"), "顺序差异可区分（含位置扰动）");
}

console.log("\n[3] decideResolution：全量串 / 摘要任意混搭 → 决策一致");
{
  const fullA = '{"_dirty":false,"v":1}';
  const fullB = '{"_dirty":false,"v":2}';
  const fullC = '{"_dirty":false,"v":3}';
  const scenarios = [
    { localChecksum: fullA, cloudChecksum: fullA, lastCloudChecksum: fullA },
    { localChecksum: fullB, cloudChecksum: fullA, lastCloudChecksum: fullA },
    { localChecksum: fullA, cloudChecksum: fullB, lastCloudChecksum: fullA },
    { localChecksum: fullB, cloudChecksum: fullC, lastCloudChecksum: fullA }
  ];
  const expected = ["identical", "use-local", "use-cloud", "conflict"];
  let allMatch = true;
  scenarios.forEach(function (s, i) {
    const modes = [
      s,                                                              // 全量 / 全量 / 全量
      { localChecksum: digest(s.localChecksum), cloudChecksum: digest(s.cloudChecksum), lastCloudChecksum: digest(s.lastCloudChecksum) }, // 摘要 / 摘要 / 摘要
      { localChecksum: s.localChecksum, cloudChecksum: digest(s.cloudChecksum), lastCloudChecksum: digest(s.lastCloudChecksum) },        // 混合（真实调用现场）
      { localChecksum: digest(s.localChecksum), cloudChecksum: s.cloudChecksum, lastCloudChecksum: s.lastCloudChecksum }
    ];
    modes.forEach(function (m, k) {
      const got = D(Object.assign({ hasLocal: true, hasCloud: true }, m)).decision;
      if (got !== expected[i]) { allMatch = false; console.log("    不匹配：场景" + i + " 形态" + k + " → " + got + "（期望 " + expected[i] + "）"); }
    });
  });
  ok(allMatch, "4 种场景 × 4 种输入形态（全量/摘要/混合）共 16 组决策全部一致");
  ok(D({ hasLocal: false, hasCloud: false }).decision === "new", "空档语义未受影响：new");
  ok(D({ hasLocal: true, hasCloud: false, localChecksum: fullA }).decision === "use-local", "有本地无云端：use-local");
}

console.log("\n[4] 旧档迁移：读到全量 checksum → 归一化并立刻落盘");
{
  const c2 = loadFiles();
  const CS2 = c2.CloudSaveService;
  const bigChecksum = '{"_dirty":true,"blob":"' + "x".repeat(300000) + '"}';
  let saved = null;
  const store = {
    load: function () {
      return { deviceId: "dev-legacy", localRevision: 7, localSavedAt: 111, localChecksum: bigChecksum, lastCloudChecksum: bigChecksum, lastCloudArchiveId: "arch_old", lastSuccessfulSyncAt: 222 };
    },
    save: function (o) { saved = JSON.parse(JSON.stringify(o)); return true; }
  };
  const svc = new CS2({ provider: new c2.MockCloudProvider(), deviceId: "dev-legacy", metaStore: store });
  const legacySize = JSON.stringify(store.load()).length;
  await svc.init();
  const meta = svc.getSyncMeta();
  ok(meta.localChecksum.length === 16 && meta.lastCloudChecksum.length === 16, "读到旧档 → 两个 checksum 字段归一化为 16 位摘要");
  ok(meta.localChecksum === CS2.checksumDigest(bigChecksum), "归一化值 == 旧全量串的摘要（无损，可继续比对）");
  ok(meta.localRevision === 7 && meta.lastCloudArchiveId === "arch_old" && meta.lastSuccessfulSyncAt === 222, "其余元数据字段原样保留");
  ok(!!saved, "迁移后立即触发 metaStore.save（旧档当场瘦身，不必等下次存档）");
  const newSize = JSON.stringify(saved).length;
  ok(newSize < 2000, "迁移后 sync_meta 序列化 < 2000 字符（实际 " + newSize + "）");
  ok(newSize * 100 < legacySize, "体积下降 > 99%（旧 " + legacySize + " → 新 " + newSize + " 字符）");
}

console.log("\n[5] 记账路径：recordLocal / recordCloudBaseline / uploadNow 都只写摘要");
{
  const c3 = loadFiles();
  const CS3 = c3.CloudSaveService;
  let saved = null;
  const store = { load: function () { return null; }, save: function (o) { saved = JSON.parse(JSON.stringify(o)); return true; } };
  const svc = new CS3({ provider: new c3.MockCloudProvider(), deviceId: "dev-3", metaStore: store });
  await svc.init();
  const big = '{"_dirty":true,"blob":"' + "y".repeat(120000) + '"}';
  svc.recordLocal(big, 12345, 3);
  ok(svc.getSyncMeta().localChecksum.length === 16, "recordLocal 只写 16 位摘要");
  svc.recordCloudBaseline(big, "arch_z");
  ok(svc.getSyncMeta().lastCloudChecksum.length === 16, "recordCloudBaseline 只写 16 位摘要");
  ok(saved && saved.lastCloudChecksum.length === 16, "落盘的 sync_meta 里也是摘要（实际写入 " + JSON.stringify(saved).length + " 字符）");

  // uploadNow：envelope.checksum 是全量串，记账必须是摘要，且仍能与云端信封比对为 identical
  const payload = { resources: { isk: 42 }, blob: "z".repeat(50000) };
  const up = await svc.uploadNow(payload, "auto");
  ok(up.ok === true, "uploadNow 成功");
  const metaNow = svc.getSyncMeta();
  ok(metaNow.lastCloudChecksum.length === 16, "uploadNow 记账为 16 位摘要");
  ok(metaNow.lastCloudChecksum === CS3.checksumDigest(up.envelope.checksum), "记账值 == 本次信封 checksum 的摘要");
  const decision = CS3.decideResolution({
    hasLocal: true, hasCloud: true,
    localChecksum: up.envelope.checksum,          // 调用方给的是全量串
    cloudChecksum: up.envelope.checksum,
    lastCloudChecksum: metaNow.lastCloudChecksum  // 元数据里是摘要
  });
  ok(decision.decision === "identical", "全量串 vs 摘要混搭仍判 identical（本地/云端一致时不误报冲突）");
}

console.log("\n[6] 端到端：正常上传后 sync_meta 体积与存档本体解耦");
{
  const c4 = loadFiles();
  const CS4 = c4.CloudSaveService;
  let saved = null;
  const store = { load: function () { return null; }, save: function (o) { saved = JSON.parse(JSON.stringify(o)); return true; } };
  const svc = new CS4({ provider: new c4.MockCloudProvider(), deviceId: "dev-4", metaStore: store });
  await svc.init();
  const payload = { resources: { isk: 1 }, bulk: "q".repeat(300000) };
  const up = await svc.uploadNow(payload, "auto");
  const metaChars = JSON.stringify(saved).length;
  const envChars = up.envelope.checksum.length;
  ok(envChars > 100000, "本次信封 checksum 确实是大对象（" + envChars + " 字符，模拟真实存档）");
  ok(metaChars < 2000, "sync_meta 落盘体积仍 < 2000 字符（实际 " + metaChars + "）");
  ok(Math.round(metaChars / envChars * 100) < 1, "sync_meta / checksum < 1%（旧实现为 ~200%）");
}

console.log("");
if (failures) { console.log("测试失败 (" + failures + " 项)"); process.exit(1); }
console.log("ALL SYNC_META DIGEST TESTS PASSED");
