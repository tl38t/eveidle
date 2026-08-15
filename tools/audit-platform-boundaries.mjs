// 机器审计：平台边界纪律（决定·三）与版本 fail-closed（决定·一）。
// - Noop provider 绝不接管 localStorage（不得出现第二个本地写入者）。
// - SAVE_ENVELOPE_VERSION / GAME_SAVE_SCHEMA_VERSION 权威值 = 1。
// - 高于本机支持版本的信封 → 抛 ENVELOPE_VERSION_TOO_NEW（fail closed）。
// - checksum 被篡改 → 抛 CHECKSUM_MISMATCH（fail closed，绝不覆盖本地）。
// - 规范化序列化键序无关（冲突判定基础）。
//
// 用法：node tools/audit-platform-boundaries.mjs
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

function loadInContext(files) {
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
  return ctx;
}

const ctx = loadInContext([
  "js/core/save-envelope.js",
  "js/platform/cloud-save-contract.js",
  "js/platform/local-mirror-contract.js",
  "js/platform/providers/noop-cloud-provider.js",
  "js/platform/providers/noop-achievement-provider.js",
  "js/platform/providers/noop-local-mirror-provider.js"
]);

const SE = ctx.SaveEnvelope;
ok(SE && typeof SE === "object", "SaveEnvelope 已加载");
ok(SE.SAVE_ENVELOPE_VERSION === 1, "SAVE_ENVELOPE_VERSION === 1（外层信封格式版本）[" + SE.SAVE_ENVELOPE_VERSION + "]");
ok(SE.GAME_SAVE_SCHEMA_VERSION === 1, "GAME_SAVE_SCHEMA_VERSION === 1（仅不兼容结构升级才 +1）[" + SE.GAME_SAVE_SCHEMA_VERSION + "]");

// fail-closed：高于本机支持版本的信封
let tooNew = null;
try {
  SE.verify({ format: "deep-space-idle-save", envelopeVersion: 2, revision: 1, savedAt: Date.now(), deviceId: "", payload: { a: 1 }, checksum: "x" });
} catch (e) { tooNew = e; }
ok(tooNew && tooNew.code === "ENVELOPE_VERSION_TOO_NEW", "高于支持版本的信封 → 抛 ENVELOPE_VERSION_TOO_NEW（fail closed，不强行加载）");

// fail-closed：checksum 被篡改
const env = SE.create({ payload: { skills: { a: 1 } }, revision: 1, deviceId: "d1" });
env.payload.skills.a = 999; // 篡改 payload，但未更新 checksum
let tampered = null;
try { SE.verify(env); } catch (e) { tampered = e; }
ok(tampered && tampered.code === "CHECKSUM_MISMATCH", "checksum 被篡改 → 抛 CHECKSUM_MISMATCH（fail closed）");

// 规范化序列化键序无关
ok(SE.stableStringify({ a: 1, b: 2 }) === SE.stableStringify({ b: 2, a: 1 }), "stableStringify 键序无关（冲突判定基础）");
ok(SE.stableStringify([1, { x: 1, y: 2 }]) === SE.stableStringify([1, { y: 2, x: 1 }]), "stableStringify 嵌套键序无关");

// 边界纪律：Noop provider 方法被调用不得写入 localStorage
const noopCloud = new ctx.NoopCloudProvider();
const noopAch = new ctx.NoopAchievementProvider();
const noopMirror = new ctx.NoopLocalMirrorProvider();
await noopCloud.initialize();
await noopCloud.listArchives();
try { await noopCloud.downloadArchive({ archiveId: "x" }); } catch (e) {}
try { await noopCloud.uploadArchive({ envelope: {} }); } catch (e) {}
try { await noopCloud.deleteArchive({ archiveId: "x" }); } catch (e) {}
await noopAch.initialize();
try { await noopAch.unlock("TP_A01"); } catch (e) {}
await noopMirror.initialize();
await noopMirror.readSlots();
await noopMirror.writeAtomic("{}");
await noopMirror.deleteAll();
ok(Object.keys(ctx.localStorage._store).length === 0, "Noop 全部方法被调用后 localStorage 仍为空（决定·三：不接管本地）");

// Noop 始终不可用
ok(noopCloud.isAvailable() === false, "NoopCloudProvider.isAvailable() === false");
ok(noopAch.isAvailable() === false, "NoopAchievementProvider.isAvailable() === false");
ok(noopMirror.isAvailable() === false, "NoopLocalMirrorProvider.isAvailable() === false");

// Shared core may depend on provider contracts, but never on platform globals.
for (const rel of ["js/core/cloud-save-service.js", "js/core/local-mirror-service.js", "js/core/achievement-sync-service.js"]) {
  const source = readFileSync(join(repo, rel), "utf8");
  ok(!/\b(?:tap|SteamBridge)\b/.test(source), rel + " 不直接访问 tap/SteamBridge");
}
const mirrorSource = readFileSync(join(repo, "js/platform/taptap/taptap-local-mirror-provider.js"), "utf8");
ok(!mirrorSource.includes("localStorage"), "TapTap mirror provider 不接管 localStorage");
const cloudSource = readFileSync(join(repo, "js/platform/taptap/taptap-cloud-provider.js"), "utf8");
ok(cloudSource.includes("deep_space_idle_archive.json") && mirrorSource.includes("deep_space_idle_device_backup.json"),
   "云上传暂存文件与设备镜像文件名严格分离");

console.log(failures === 0 ? "\n审计通过 (0 失败)" : "\n审计失败 (" + failures + " 项)");
process.exit(failures === 0 ? 0 : 1);
