// 生产级平台集成审计（第一阶段交付·P1-6）
//
// 目标：用真实生产代码验证 TapTap 平台集成链路，而非手写替代实现。
//
// 方法：
//   1) 解析 index.html 真实 <script defer src> 顺序，断言脚本总数 = 78，
//      并断言 15 个平台/镜像文件真实存在且全部早于 js/core/persistence.js。
//   2) 按 index.html 真实顺序加载生产脚本的子集（achievements.js + 11 平台文件 +
//      persistence.js），顺序由 index.html 决定，绝不在审计里手写一份替代实现。
//      注：完整游戏 UI 脚本（render / game / three 等）不在本无头集成审计范围内，
//      由浏览器测试覆盖；本审计只加载与平台集成直接相关的生产模块。
//   3) 在 platform-runtime 加载前注入官方形状的 mock tap（getCloudSaveManager /
//      getFileSystemManager / createAchievementManager）。
//   4) 断言 PlatformRuntime 选择 taptap（而非 web / Noop）；CloudSaveService 使用
//      TapTapCloudProvider；AchievementSyncService 使用 TapTapAchievementProvider。
//   5) 模拟三种启动场景，全部经由真实 SaveManager.bootstrap() + 真实
//      CloudSaveService + 真实 TapTapCloudProvider 驱动：
//        - 无本地 + 有云端：getArchiveList 真实调用、读取 res.saves、getArchiveData
//          真实调用且使用 archiveUUID+archiveFileId、FileSystemManager.readFile 真实调用、
//          最终恢复云端 payload、离线结算恰好一次、加载期间本地写入为 0。
//        - 无本地 + 云端查询失败：bootState=error、SaveManager.save() 直接返回 false、
//          tick 被阻塞（isBootBlocked=true）、离线结算=0、上传=0、eve_idle_save 写入=0。
//        - 有本地 + Tap API 缺失（web→Noop）：最终 local-only、本地档正常恢复、
//          不出现致命错误。
//   6) 断言生产全局存在：SaveEnvelope / PlatformRuntime / CloudSaveService /
//      AchievementSyncService / TapTapCloudProvider / TapTapAchievementProvider /
//      PlatformAchievementMap（并核对 PlatformAchievementMap.count()=193）。
//   7) 静态校验构建白名单：TapTap 生产文件允许入包；js/platform/steam/** 明确排除；
//      js/qa-seed.js 明确排除。
//
// 隔离纪律：仅把离线结算计算（calculateOfflineGains）、存档快照、本地迁移等重型依赖
// 以「计数桩」隔离（与项目自有 test-save-bootstrap-guard.mjs 同款手法），业务状态机 /
// 云端取档 / 决策 / 落定逻辑全部为真实生产代码。CloudSaveService 的 _sleep 改为即时
// 返回（测试时钟控制，与 test-cloud-save-service.mjs 同款），避免任何重试路径挂起。
//
// 用法：node tools/audit-platform-integration.mjs
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");

let failures = 0;
function ok(cond, label, extra) {
  if (cond) console.log("  PASS  " + label);
  else { console.log("  FAIL  " + label + (extra ? "  [" + extra + "]" : "")); failures++; }
}

// 真实信封（Node 侧用真实 SaveEnvelope 生成合法云端存档信封）。
const seMod = await import(pathToFileURL(join(repo, "js/core/save-envelope.js")).href);
const SaveEnvelope = seMod.default || seMod;
const CLOUD_PAYLOAD = {
  skills: { cloudMark: true },
  resources: {}, currentAction: {}, inventory: {}, combat: {},
  migrations: {}, settings: {}, achievements: {}
};
const CLOUD_ENVELOPE_JSON = SaveEnvelope.encode(
  SaveEnvelope.create({ payload: CLOUD_PAYLOAD, revision: 1, deviceId: "cloud-dev" })
);

// ===================== 1) index.html 真实脚本顺序 =====================
console.log("\n[1] 解析 index.html 真实 <script defer src> 顺序");
const html = readFileSync(join(repo, "index.html"), "utf8");
const re = /<script\s+defer\s+src="([^"]+)"\s*><\/script>/g;
const srcs = [];
let m;
while ((m = re.exec(html)) !== null) srcs.push(m[1].replace(/^\.\//, "").replace(/\?.*$/, ""));
ok(srcs.length === 78, "真实脚本数 = 78", "实际 " + srcs.length);

const PLATFORM_FILES = [
  "js/platform/cloud-save-contract.js",
  "js/platform/achievement-provider-contract.js",
  "js/platform/local-mirror-contract.js",
  "js/core/save-envelope.js",
  "js/platform/providers/noop-cloud-provider.js",
  "js/platform/providers/noop-achievement-provider.js",
  "js/platform/providers/noop-local-mirror-provider.js",
  "js/platform/taptap/taptap-cloud-provider.js",
  "js/platform/taptap/taptap-achievement-provider.js",
  "js/platform/taptap/taptap-local-mirror-provider.js",
  "js/platform/platform-runtime.js",
  "js/core/cloud-save-service.js",
  "js/core/local-mirror-service.js",
  "js/data/platform-achievement-map.js",
  "js/core/achievement-sync-service.js"
];
const persistIdx = srcs.indexOf("js/core/persistence.js");
ok(persistIdx !== -1, "index.html 引用 js/core/persistence.js（基准锚点）", "位置#" + persistIdx);

console.log("\n[2] 15 个平台/镜像文件存在且全部早于 persistence.js");
const idxMap = {};
PLATFORM_FILES.forEach((p) => {
  const i = srcs.indexOf(p);
  idxMap[p] = i;
  ok(i !== -1, "index.html 引用 " + p, i === -1 ? "未找到" : "位置#" + i);
  if (i !== -1) ok(existsSync(join(repo, p)), "  磁盘存在 " + p, existsSync(join(repo, p)) ? "" : "缺失");
  if (i !== -1 && persistIdx !== -1) ok(i < persistIdx, "  " + p + " 早于 persistence.js", "位置#" + i + " < " + persistIdx);
});
// 最小依赖顺序（真实相对顺序）
const depChain = [
  "js/platform/cloud-save-contract.js",
  "js/platform/local-mirror-contract.js",
  "js/core/save-envelope.js",
  "js/platform/taptap/taptap-cloud-provider.js",
  "js/platform/taptap/taptap-local-mirror-provider.js",
  "js/platform/platform-runtime.js",
  "js/core/cloud-save-service.js",
  "js/core/local-mirror-service.js",
  "js/data/platform-achievement-map.js",
  "js/core/achievement-sync-service.js"
];
let orderOk = true, prev = -1, prevLabel = "";
for (const p of depChain) {
  const i = idxMap[p];
  if (i === -1) { orderOk = false; break; }
  if (i <= prev) { orderOk = false; prevLabel = p; break; }
  prev = i;
}
ok(orderOk, "真实相对依赖顺序（contract→envelope→taptap→runtime→css→map→sync）", prevLabel);

// 仅加载与平台集成直接相关的真实生产脚本（index.html 真实顺序子集）。
const AUDIT_RELEVANT = [...PLATFORM_FILES, "js/data/achievements.js", "js/core/persistence.js"];
const loadOrder = srcs.filter((s) => AUDIT_RELEVANT.includes(s));
ok(loadOrder.length === AUDIT_RELEVANT.length, "审计加载集 = 真实生产脚本全集（" + AUDIT_RELEVANT.length + " 个）",
   "实际加载 " + loadOrder.length);

// ===================== 构造 vm 上下文（真实生产脚本 + mock tap） =====================
function makeCloudTap(rec) {
  const localFiles = {};
  const cloudMgr = {
    getArchiveList({ success /* , fail */ }) {
      rec.getArchiveList++;
      success({ saves: [{ uuid: "arch-uuid-1", fileId: "fid-1", name: "deep_space_idle_autosave", modifiedTime: 1700000000, saveSize: 1234 }] });
    },
    getArchiveData({ archiveUUID, archiveFileId, success /* , fail */ }) {
      rec.getArchiveData++;
      rec.getArchiveDataArgs = { archiveUUID, archiveFileId };
      success({ filePath: "tmp/cloud_dl.json" });
    },
    createArchive() { rec.createArchive++; },
    updateArchive() { rec.updateArchive++; },
    deleteArchive() { rec.deleteArchive++; }
  };
  const fsMgr = {
    readFile({ filePath, success, fail }) {
      rec.readFile++;
      rec.readFileArgs = filePath;
      if (filePath === "tmp/cloud_dl.json") success({ data: CLOUD_ENVELOPE_JSON });
      else if (Object.prototype.hasOwnProperty.call(localFiles, filePath)) success({ data: localFiles[filePath] });
      else fail({ errno: 1300002, errMsg: "no such file or directory " + filePath });
    },
    writeFile({ filePath, data, success }) { rec.writeFile++; localFiles[filePath] = String(data); success({}); },
    unlink({ filePath, success, fail }) {
      if (!Object.prototype.hasOwnProperty.call(localFiles, filePath)) return fail({ errno:1300002, errMsg:"no such file or directory " + filePath });
      delete localFiles[filePath]; success({});
    },
    rename({ oldPath, newPath, success, fail }) {
      if (!Object.prototype.hasOwnProperty.call(localFiles, oldPath)) return fail({ errno:1300002, errMsg:"no such file or directory " + oldPath });
      localFiles[newPath] = localFiles[oldPath]; delete localFiles[oldPath]; success({});
    }
  };
  return {
    getCloudSaveManager() { return cloudMgr; },
    getFileSystemManager() { return fsMgr; },
    createAchievementManager() { return { registerListener() {}, unlockAchievement() {} }; },
    env: { USER_DATA_PATH: "tmp" }
  };
}
function makeFailingTap(rec) {
  const cloudMgr = {
    getArchiveList({ /* success, */ fail }) {
      rec.getArchiveList++;
      fail({ errMsg: "network down", errno: 500000 });
    },
    getArchiveData() { rec.getArchiveData++; },
    createArchive() { rec.createArchive++; },
    updateArchive() { rec.updateArchive++; },
    deleteArchive() { rec.deleteArchive++; }
  };
  const fsMgr = {
    readFile({ fail }) { rec.readFile++; fail({ errno:1300002, errMsg:"no such file or directory" }); },
    writeFile({ success }) { rec.writeFile++; success({}); },
    unlink({ fail }) { fail({ errno:1300002, errMsg:"no such file or directory" }); },
    rename({ fail }) { fail({ errno:1300002, errMsg:"no such file or directory" }); }
  };
  return {
    getCloudSaveManager() { return cloudMgr; },
    getFileSystemManager() { return fsMgr; },
    createAchievementManager() { return { registerListener() {}, unlockAchievement() {} }; },
    env: { USER_DATA_PATH: "tmp" }
  };
}

function buildContext({ tap, seedLocal }) {
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = console;

  const store = {};
  if (seedLocal) {
    store["eve_idle_save"] = JSON.stringify({
      skills: { localMark: true },
      resources: {}, currentAction: {}, inventory: {}, combat: {},
      migrations: {}, settings: {}, achievements: {}
    });
  }
  ctx.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };

  ctx.setInterval = () => 0;
  ctx.clearInterval = () => {};
  ctx.setTimeout = () => 0;   // vm 内定时器；本审计场景不触发真实退避（_sleep 已被覆盖为即时）
  ctx.clearTimeout = () => {};

  const stubEl = {
    setAttribute() {}, appendChild() {}, removeChild() {},
    querySelector() { return null; }, addEventListener() {}, focus() {},
    set textContent(_) {}, get textContent() { return ""; }, click() {}
  };
  ctx.document = {
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => stubEl,
    body: { appendChild() {} }
  };

  ctx._bootLog = [];
  ctx.GameEvents = {
    emit(name, detail) { if (name === "boot:state") ctx._bootLog.push(detail && detail.state); }
  };
  ctx.CustomEvent = function (type, opts) { this.type = type; this.detail = (opts && opts.detail) || null; };
  ctx.addEventListener = () => {};
  ctx.dispatchEvent = (e) => { if (e && e.type === "bootstatechange") ctx._bootLog.push(e.detail && e.detail.state); };
  ctx.alert = () => {};

  ctx.gameState = { resources: {}, skills: {}, currentAction: {}, inventory: {}, combat: {}, migrations: {}, settings: {}, achievements: {} };

  // 5) 在 platform-runtime 加载前注入官方形状的 mock tap（无 tap 场景置 undefined → web/Noop）。
  ctx.tap = (typeof tap !== "undefined") ? tap : undefined;
  ctx.__rec = { getArchiveList: 0, getArchiveData: 0, readFile: 0, createArchive: 0, updateArchive: 0, deleteArchive: 0, getArchiveDataArgs: null, readFileArgs: null };

  vm.createContext(ctx);
  // 4) 按 index.html 真实顺序加载生产脚本（真实实现，非替代）。
  for (const rel of loadOrder) {
    vm.runInContext(readFileSync(join(repo, rel), "utf8"), ctx, { filename: rel });
  }

  // 隔离重型依赖（与项目自有 test-save-bootstrap-guard.mjs 同款计数桩），业务状态机保持真实。
  const extra = `
    ensureUserSettingsState = function () {};
    ensureStatisticsState = function () {};
    normalizeQueueState = function () {};
    migrateStationCorporationState = function () {};
    normalizePlanetaryState = function () {};
    createSerializableGameStateSnapshot = function (s) { return JSON.parse(JSON.stringify(s || {})); };
    restoreSerializableGameStateSnapshot = function (snap) {
      if (snap && globalThis) { var p = snap.payload || snap; if (p && typeof p === "object") Object.assign(globalThis.gameState, p); }
    };
    globalThis.__migrateCalls = 0;
    globalThis.__activateCalls = 0;
    globalThis.__legacyCalls = 0;
    normalizeAndMigratePayload = function () { globalThis.__migrateCalls++; };
    activateRestoredState = function () { globalThis.__activateCalls++; };
    applyLegacyStartupFieldMigrations = function () { globalThis.__legacyCalls++; };
    globalThis.__settleCalls = 0;
    calculateOfflineGains = function () { globalThis.__settleCalls++; };
    // 测试时钟：退避即时返回，避免任何重试路径挂起（不改变业务判定）。
    if (globalThis.CloudSaveService && globalThis.CloudSaveService.prototype) {
      globalThis.CloudSaveService.prototype._sleep = function () { return Promise.resolve(); };
    }
    // 注意：getCloudSaveService / getAchievementSyncService 故意不覆盖 → 使用真实生产单例
    // （真实 CloudSaveService + 真实 TapTapCloudProvider / NoopCloudProvider）。
  `;
  vm.runInContext(extra, ctx, { filename: "inline-isolations" });

  return { ctx, SaveManager: ctx.SaveManager, rec: ctx.__rec, store };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ===================== 6/7/8 + 12：Provider 选择 / 全局存在 =====================
console.log("\n[3] Provider 选择 + 生产全局存在");
{
  const { ctx } = buildContext({ tap: makeCloudTap({}), seedLocal: false });
  // 6) PlatformRuntime 选择 taptap（非 web / Noop）
  ok(ctx.PlatformRuntime.getPlatform() === "taptap", "PlatformRuntime.getPlatform() === 'taptap'（非 web/Noop）");
  const cp = ctx.PlatformRuntime.createCloudProvider();
  ok(cp instanceof ctx.TapTapCloudProvider, "createCloudProvider() 返回 TapTapCloudProvider（非 Noop）");
  ok(!(cp instanceof ctx.NoopCloudProvider), "createCloudProvider() 不是 NoopCloudProvider");
  // 7) CloudSaveService 使用 TapTapCloudProvider
  const cs = ctx.getCloudSaveService();
  ok(!!cs && cs.provider instanceof ctx.TapTapCloudProvider, "CloudSaveService.provider 为 TapTapCloudProvider");
  // 8) AchievementSyncService 使用 TapTapAchievementProvider
  const as = ctx.getAchievementSyncService();
  ok(!!as && as.provider instanceof ctx.TapTapAchievementProvider, "AchievementSyncService.provider 为 TapTapAchievementProvider");
  const mp = ctx.PlatformRuntime.createLocalMirrorProvider();
  ok(mp instanceof ctx.TapTapLocalMirrorProvider, "createLocalMirrorProvider() 返回 TapTapLocalMirrorProvider");
  const ms = ctx.getLocalMirrorService();
  ok(!!ms && ms.provider instanceof ctx.TapTapLocalMirrorProvider, "LocalMirrorService.provider 为 TapTapLocalMirrorProvider");
  // 12) 生产全局存在
  ["SaveEnvelope", "PlatformRuntime", "CloudSaveService", "AchievementSyncService", "LocalMirrorService",
   "TapTapCloudProvider", "TapTapAchievementProvider", "TapTapLocalMirrorProvider", "PlatformAchievementMap"].forEach((g) => {
    ok(typeof ctx[g] !== "undefined", "生产全局存在：" + g);
  });
  // PlatformAchievementMap.count() = 193（与 ACHIEVEMENTS 一致）
  ok(ctx.PlatformAchievementMap.count() === 193, "PlatformAchievementMap.count() = 193", "实际 " + ctx.PlatformAchievementMap.count());
}

// ===================== 9) 无本地 + 有云端 =====================
console.log("\n[4] 场景·无本地 + 有云端（真实取档链路）");
{
  const rec = { getArchiveList: 0, getArchiveData: 0, readFile: 0, createArchive: 0, updateArchive: 0, deleteArchive: 0, getArchiveDataArgs: null, readFileArgs: null };
  const { ctx, SaveManager, store } = buildContext({ tap: makeCloudTap(rec), seedLocal: false });
  const p = SaveManager.bootstrap();
  // 加载期间（云端决策/落定前）本地写入必须为 0。
  ok(typeof store["eve_idle_save"] === "undefined", "加载期间本地写入为 0（eve_idle_save 尚未创建）");
  await p;
  ok(SaveManager.getBootState() === "ready", "无本地+有云端 → use-cloud → ready");
  ok(rec.getArchiveList >= 1, "getArchiveList 真实被调用", "调用 " + rec.getArchiveList + " 次");
  ok(rec.getArchiveData >= 1, "getArchiveData 真实被调用", "调用 " + rec.getArchiveData + " 次");
  ok(rec.getArchiveDataArgs && rec.getArchiveDataArgs.archiveUUID === "arch-uuid-1" && rec.getArchiveDataArgs.archiveFileId === "fid-1",
     "getArchiveData 使用 archiveUUID + archiveFileId", JSON.stringify(rec.getArchiveDataArgs));
  ok(rec.readFile >= 1, "FileSystemManager.readFile 真实被调用（下载后读取本地落盘文件）", "调用 " + rec.readFile + " 次");
  ok(ctx.gameState.skills && ctx.gameState.skills.cloudMark === true, "最终恢复云端 payload（gameState.skills.cloudMark）");
  ok(ctx.__settleCalls === 1, "离线结算恰好一次（P0-4）", "实际 " + ctx.__settleCalls);
  ok(rec.createArchive === 0 && rec.updateArchive === 0, "P1-1：use-cloud 不向云端回传（create/update 均未调用）");
  ok(typeof store["eve_idle_save"] !== "undefined", "use-cloud 落定后本地存档已写入（persist:true）");
}

// ===================== 10) 无本地 + 云端查询失败 =====================
console.log("\n[5] 场景·无本地 + 云端查询失败（显式 error）");
{
  const rec = { getArchiveList: 0, getArchiveData: 0, readFile: 0, createArchive: 0, updateArchive: 0, deleteArchive: 0, getArchiveDataArgs: null, readFileArgs: null };
  const { ctx, SaveManager, store } = buildContext({ tap: makeFailingTap(rec), seedLocal: false });
  let rejected = false;
  try { await SaveManager.bootstrap(); } catch (e) { rejected = true; }
  ok(SaveManager.getBootState() === "error", "无本地+云端失败 → 阻塞错误页（bootState=error）");
  ok(SaveManager.save() === false, "SaveManager.save() 直接调用返回 false（fail-closed）");
  ok(SaveManager.isBootBlocked() === true, "error 阻塞 tick（tick=0 等价：isBootBlocked=true）");
  ok(ctx.__settleCalls === 0, "离线结算 = 0（error 路径不结算）", "实际 " + ctx.__settleCalls);
  ok(rec.createArchive === 0 && rec.updateArchive === 0, "上传 = 0（绝不凭空覆盖未知云端）");
  ok(typeof store["eve_idle_save"] === "undefined", "eve_idle_save 写入 = 0（不开新档）");
  ok(rejected === false, "bootstrap 以 error 状态落定而非 reject（调用方可感知阻塞）");
}

// ===================== 11) 有本地 + Tap API 缺失（web → Noop） =====================
console.log("\n[6] 场景·有本地 + Tap API 缺失（web → NoopCloudProvider）");
{
  const rec = { getArchiveList: 0, getArchiveData: 0, readFile: 0, createArchive: 0, updateArchive: 0, deleteArchive: 0, getArchiveDataArgs: null, readFileArgs: null };
  let fatal = null;
  let res;
  try {
    const { ctx, SaveManager, store } = buildContext({ tap: undefined, seedLocal: true });
    res = { ctx, SaveManager, store };
    await SaveManager.bootstrap();
  } catch (e) { fatal = e; }
  ok(fatal === null, "不出现致命错误（web/Noop 本地模式正常）", fatal ? String(fatal && fatal.message) : "");
  ok(res.SaveManager.getBootState() === "local-only", "有本地+无 Tap → 最终 local-only");
  ok(typeof res.store["eve_idle_save"] !== "undefined", "本地档正常恢复 / 落定（eve_idle_save 已写入）");
  ok(res.ctx.__settleCalls === 1, "本地模式离线结算恰好一次", "实际 " + res.ctx.__settleCalls);
}

// ===================== 13) 静态校验构建白名单 =====================
console.log("\n[7] 静态校验构建白名单（build-taptap-h5.mjs）");
{
  const build = readFileSync(join(repo, "tools/build-taptap-h5.mjs"), "utf8");
  ok(build.includes('if (rel === "js/qa-seed.js") return false;'), "构建硬排除 js/qa-seed.js（不进入任何 TapTap 包）");
  ok(build.includes('if (rel.startsWith("js/platform/steam/")) return false;'), "构建硬排除 js/platform/steam/**");
  ok(!build.includes('"js/platform/taptap/"'), "构建未排除 js/platform/taptap/（TapTap 生产文件允许入包）");
  ok(!/return false;\s*\n\s*if \(rel\.startsWith\("js\/data\/platform-achievement-map/.test(build),
     "构建未排除 js/data/platform-achievement-map.js（平台映射允许入包）");
}

console.log(failures === 0 ? "\n审计通过 (0 失败)" : "\n审计失败 (" + failures + " 项)");
process.exit(failures === 0 ? 0 : 1);
