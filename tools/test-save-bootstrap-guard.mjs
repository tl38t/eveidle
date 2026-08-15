// 机器测试：SaveManager.bootstrap() 启动引导守卫（第一阶段交付·决定 十 / Codex 返修 P0-2~P0-6）。
//
// 目标：验证 bootstrap 的状态机与守卫语义，而非完整迁移管线（迁移管线由 verify.mjs /
// audit-* 等现有套件覆盖）。本测试在 vm 上下文加载 persistence.js，并将深耦合的
// 迁移 / 云端 / 成就单例覆盖为可控桩，从而把被测对象收敛到：
//   - 双重调用防护（_bootStarted）
//   - 同步本地读档（render.js 渲染前 gameState 已就绪，但 state 保持 loading）
//   - 本地读档 / 迁移失败一律 fail closed → error（绝不静默开新档）
//   - 冲突暂停 awaiting-choice → resolveCloudConflict 放行到 ready
//   - isBootBlocked() 闸门（仅 idle 不出现；loading / awaiting-choice / error 均阻塞；local-only / ready 解阻塞）
//   - P0-4：离线结算恰好一次，且不在云端决策前发生
//   - P0-5：hasLocal 使用真实本地读档结果（不硬编码 true）
//   - P0-6：云端查询失败显式 error → 无本地则阻塞错误、有本地则 local-only 且不覆盖
//
// 用法：node tools/test-save-bootstrap-guard.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// 设备镜像恢复自检纯函数（与 selftest 探针 UI 共用，浏览器侧才触发 DOM 逻辑；本机导入安全）。
import { mirrorRecoveryPlan, mirrorRecoveryExecute, RECOVERY_PROBE_KEY } from "./taptap-compat-probe.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, "..");

let failures = 0;
function ok(cond, label) {
  if (cond) console.log("  PASS  " + label);
  else { console.log("  FAIL  " + label); failures++; }
}

// 构建一次全新 vm 上下文（每次场景隔离，避免 _bootStarted / 计数器泄漏）。
// opts.cloud      : 注入可用 Mock CloudSaveService（冲突 / 云端场景）
// opts.cloudNone  : Mock 返回 {status:"none"}（无云端存档）
// opts.cloudError : Mock 返回 {status:"error"}（云端查询失败）
// opts.cloudCorrupt: Mock 返回 {status:"error"}（下载损坏，等价于 corrupt 分支）
// opts.forceConflict: Mock.decideResolution 强制返回 conflict
// opts.seedLocal  : 预置一份本地存档（使 _hasLocalCandidate=true）
// opts.failLocal  : 让被覆盖的 normalizeAndMigratePayload 抛错（fail-closed 场景）
function buildContext(opts) {
  opts = opts || {};
  const ctx = {};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.console = console;

  // 假 localStorage
  const store = {};
  if (opts.seedLocal) {
    store["eve_idle_save"] = JSON.stringify({
      skills: {}, resources: {}, settings: {}, migrations: {},
      currentAction: {}, inventory: {}, combat: {}, achievements: {}
    });
  }
  ctx.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };

  // 定时器 / 定时器类桩（top-level setInterval 永不触发）
  ctx.setInterval = () => 0;
  ctx.clearInterval = () => {};
  ctx.setTimeout = () => 0;
  ctx.clearTimeout = () => {};

  // DOM 桩：getElementById 一律返回 null（UI 绑定被 if 守卫跳过），事件监听为空操作。
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

  // window 事件总线桩（捕获 boot:state 转换）
  ctx._bootLog = [];
  ctx.GameEvents = {
    emit(name, detail) { if (name === "boot:state") ctx._bootLog.push(detail && detail.state); }
  };
  ctx.CustomEvent = function (type, opts) { this.type = type; this.detail = (opts && opts.detail) || null; };
  ctx.addEventListener = () => {};           // window.addEventListener（beforeunload 绑定）
  ctx.dispatchEvent = (e) => { if (e && e.type === "bootstatechange") ctx._bootLog.push(e.detail && e.detail.state); };
  ctx.alert = () => {};

  // 最小 gameState（bootstrap 本地路径在空 localStorage 下不深读 gameState 结构；
  // 覆盖桩也已屏蔽 migrate/activate 对 gameState 的读写）。
  ctx.gameState = { resources: {}, skills: {}, currentAction: {}, inventory: {}, combat: {}, migrations: {}, settings: {}, achievements: {} };

  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(repo, "js/core/save-envelope.js"), "utf8"), ctx, { filename: "js/core/save-envelope.js" });
  vm.runInContext(readFileSync(join(repo, "js/core/persistence.js"), "utf8"), ctx, { filename: "js/core/persistence.js" });

  // ---- 覆盖深耦合依赖，隔离 bootstrap 守卫逻辑 ----
  const extra = `
    // 外部 ensure*（persistence.js 直接调用，未做 typeof 守卫）
    ensureUserSettingsState = function () {};
    ensureStatisticsState = function () {};
    // 读档内联迁移（load 内部调用）
    normalizeQueueState = function () {};
    migrateStationCorporationState = function () {};
    normalizePlanetaryState = function () {};
    // 快照（applyCloudSave 使用）
    createSerializableGameStateSnapshot = function (s) { return JSON.parse(JSON.stringify(s || {})); };
    restoreSerializableGameStateSnapshot = function () {};
    // 可控迁移管线（fail-closed 由其抛错驱动）
    globalThis.__migrateCalls = 0;
    globalThis.__activateCalls = 0;
    globalThis.__legacyCalls = 0;
    normalizeAndMigratePayload = function () {
      globalThis.__migrateCalls++;
      if (${opts.failLocal ? "true" : "false"}) throw new Error("injected local migration failure");
    };
    activateRestoredState = function () { globalThis.__activateCalls++; };
    applyLegacyStartupFieldMigrations = function () { globalThis.__legacyCalls++; };
    // 离线结算计数桩（P0-4：验证恰好一次且不在云端决策前发生）
    globalThis.__settleCalls = 0;
    calculateOfflineGains = function () { globalThis.__settleCalls++; };
    // 成就服务：第一阶段 web 环境无 provider → null
    getAchievementSyncService = function () { return null; };
    // 云服务：按需注入可用 Mock（冲突 / 云端场景），否则 null（本地模式）
    getCloudSaveService = function () {
      if (!${opts.cloud ? "true" : "false"}) return null;
      const __mode = ${JSON.stringify({ none: !!opts.cloudNone, error: !!opts.cloudError, corrupt: !!opts.cloudCorrupt, conflict: !!opts.forceConflict })};
      function MockCloudSaveService() { this._meta = { lastCloudChecksum: "" }; this.__uploadCalls = 0; }
      MockCloudSaveService.prototype.init = function () { return Promise.resolve(true); };
      MockCloudSaveService.prototype.isAvailable = function () { return true; };
      MockCloudSaveService.prototype.fetchCloudEnvelope = function () {
        if (__mode.error) return Promise.resolve({ status: "error", error: new Error("injected cloud query failure") });
        if (__mode.none) return Promise.resolve({ status: "none" });
        if (__mode.corrupt) return Promise.resolve({ status: "error", error: new Error("injected corrupt download") });
        return Promise.resolve({ status: "ok", meta: { slotName: "auto_save", archiveId: "arch_1" }, envelope: { checksum: "cloud-xyz", payload: { skills: {} } } });
      };
      MockCloudSaveService.prototype.getSyncMeta = function () { return this._meta; };
      MockCloudSaveService.prototype.decideResolution = function (ctx) {
        if (__mode.conflict) return { decision: "conflict" };
        const c = ctx || {}; const hasLocal = !!c.hasLocal, hasCloud = !!c.hasCloud;
        if (!hasLocal && !hasCloud) return { decision: "new" };
        if (hasLocal && !hasCloud) return { decision: "use-local" };
        if (!hasLocal && hasCloud) return { decision: "use-cloud" };
        if (c.localChecksum === c.cloudChecksum) return { decision: "identical" };
        if (c.cloudChecksum === c.lastCloudChecksum && c.localChecksum !== c.lastCloudChecksum) return { decision: "use-local" };
        if (c.localChecksum === c.lastCloudChecksum && c.cloudChecksum !== c.lastCloudChecksum) return { decision: "use-cloud" };
        return { decision: "conflict" };
      };
      MockCloudSaveService.prototype.maybeUpload = function () { this.__uploadCalls++; return Promise.resolve({ ok: true }); };
      MockCloudSaveService.prototype.uploadNow = function () { this.__uploadCalls++; return Promise.resolve({ ok: true }); };
      MockCloudSaveService.prototype.recordLocal = function () { this._meta.localRevision = (this._meta.localRevision || 0) + 1; };
      MockCloudSaveService.prototype.markDirty = function () {};
      return new MockCloudSaveService();
    };
  `;
  vm.runInContext(extra, ctx, { filename: "inline-overrides" });

  return { ctx, SaveManager: ctx.SaveManager, log: () => ctx._bootLog.slice() };
}

const tick = () => new Promise((r) => setTimeout(r, 0)); // 冲刷异步启动链（microtask → macrotask）

// _emitBootState 同时经 GameEvents 与 window CustomEvent 双通道广播，
// 故 boot 状态记录会逐状态重复一次；按"连续去重"还原真实状态序列用于断言。
function dedupeConsecutive(arr) {
  const out = [];
  for (const x of arr) { if (out.length === 0 || out[out.length - 1] !== x) out.push(x); }
  return out;
}

// ===================== 场景 1：本地模式 happy path =====================
console.log("\n[场景1] 本地模式 bootstrap（无云端）→ local-only");
{
  const { ctx, SaveManager, log } = buildContext({ cloud: false, failLocal: false });
  const p = SaveManager.bootstrap();
  // 同步断言（P0-2）：bootstrap 返回前本地读档已完成，但 state 必须保持 loading（不得提前跳 local-only）。
  ok(SaveManager.getBootState() === "loading", "返回瞬间仍保持 loading（P0-2：不得提前跳 local-only）");
  ok(SaveManager._bootStarted === true, "_bootStarted 在同步段已置位（双重调用防护就绪）");
  ok(ctx.__migrateCalls === 0, "候选尚未选定时不提前迁移");
  ok(SaveManager.isBootBlocked() === true, "loading 阻塞 tick（P0-2：启动未完成前暂停）");
  ok(ctx.__settleCalls === 0, "云端决策前未发生离线结算（P0-4）");
  const result = await p;
  ok(ctx.__migrateCalls === 1, "最终候选迁移管线恰好调用一次");
  ok(result === true, "bootstrap promise 解析为 true");
  ok(SaveManager.getBootState() === "local-only", "异步链结束 state=local-only（确认无云服务的纯本地态）");
  ok(SaveManager.isBootBlocked() === false, "local-only 不阻塞（render / tick 可运行）");
  ok(ctx.__settleCalls === 1, "离线结算恰好一次（P0-4）");
  const seq = dedupeConsecutive(log());
  ok(JSON.stringify(seq) === JSON.stringify(["loading", "local-only"]),
     "boot:state 序列 = loading→local-only [" + JSON.stringify(seq) + "]");
}

// ===================== 场景 2：双重调用防护 =====================
console.log("\n[场景2] 双重 bootstrap() 调用防护");
{
  const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
  const p1 = SaveManager.bootstrap();
  const p2 = SaveManager.bootstrap();
  ok(p1 === p2, "第二次调用返回同一 _bootPromise（未重复启动）");
  ok(SaveManager._bootStarted === true, "_bootStarted 已置位");
  ok(ctx.__migrateCalls === 0, "异步候选决策前不迁移");
  await p1;
  ok(ctx.__migrateCalls === 1, "重复 bootstrap 仍只迁移最终候选一次");
  ok(SaveManager.getBootState() === "local-only", "去重后仍正常到达 local-only");
}

// ===================== 场景 3：fail-closed（迁移失败 → error） =====================
console.log("\n[场景3] 本地读档/迁移失败 fail closed → error");
{
  const { SaveManager, log } = buildContext({ cloud: false, failLocal: true });
  let rejected = false, errValue = null;
  try { await SaveManager.bootstrap(); } catch (e) { rejected = true; errValue = e; }
  ok(rejected === true, "bootstrap 因迁移失败而拒绝（Promise.reject）");
  ok(SaveManager.getBootState() === "error", "state=error（阻塞错误页，绝不静默开新档）");
  ok(SaveManager.isBootBlocked() === true, "error 阻塞（P0-2 修正：error 必须阻塞）");
  ok(SaveManager._lastBootError === errValue, "_lastBootError 已记录注入错误");
  ok(SaveManager._offlineSettled === false, "fail-closed 路径不发生离线结算（P0-4）");
  const seq = dedupeConsecutive(log());
  ok(JSON.stringify(seq) === JSON.stringify(["loading", "error"]),
     "boot:state 序列 = loading→error（未到达 local-only）[" + JSON.stringify(seq) + "]");
}

// ===================== 场景 4：冲突暂停 → resolveCloudConflict("local") =====================
console.log("\n[场景4] 云端冲突 awaiting-choice → resolveCloudConflict(local) → ready");
{
  const { ctx, SaveManager, log } = buildContext({ cloud: true, forceConflict: true, seedLocal: true, failLocal: false });
  const bootP = SaveManager.bootstrap();
  // 同步段（P0-2）：本地读档完成即返回，但 state 仍为 loading（冲突判定在异步云端段）
  ok(SaveManager.getBootState() === "loading", "同步段 state=loading（本地先就绪但不提前解阻塞）");
  ok(SaveManager.isBootBlocked() === true, "loading 尚未解阻塞");
  await tick(); // 让异步云端启动链推进到 awaiting-choice
  ok(SaveManager.getBootState() === "awaiting-choice", "云端决策 = conflict → awaiting-choice");
  ok(SaveManager.isBootBlocked() === true, "awaiting-choice 阻塞（暂停 tick/离线/自动存档/成就）");
  ok(ctx.__settleCalls === 0, "冲突未决前不发生离线结算（P0-4）");
  const resolved = await SaveManager.resolveCloudConflict("local");
  ok(resolved === true, "resolveCloudConflict('local') 返回 true");
  ok(SaveManager.getBootState() === "ready", "选择本地后 state=ready");
  ok(SaveManager.isBootBlocked() === false, "ready 不再阻塞");
  ok(SaveManager._pendingCloudEnvelope === null, "_pendingCloudEnvelope 已清空");
  ok(ctx.__settleCalls === 1, "选择本地后离线结算恰好一次（P0-4）");
  const bootResult = await bootP;
  ok(bootResult === true, "被挂起的 bootstrap promise 随 resolver 放行 → true");
  const seq = dedupeConsecutive(log());
  ok(JSON.stringify(seq) === JSON.stringify(["loading", "awaiting-choice", "ready"]),
     "boot:state 序列 = loading→awaiting-choice→ready [" + JSON.stringify(seq) + "]");
}

// ===================== 场景 5：冲突 → resolveCloudConflict("cloud") 实际落地 =====================
console.log("\n[场景5] 云端冲突 awaiting-choice → resolveCloudConflict(cloud) → 应用云存档");
{
  const { ctx, SaveManager, log } = buildContext({ cloud: true, forceConflict: true, seedLocal: true, failLocal: false });
  SaveManager.bootstrap();
  await tick();
  ok(SaveManager.getBootState() === "awaiting-choice", "到达 awaiting-choice");
  ok(ctx.__settleCalls === 0, "冲突未决前不发生离线结算（P0-4）");
  const resolved = await SaveManager.resolveCloudConflict("cloud");
  ok(resolved === true, "resolveCloudConflict('cloud') 返回 true");
  ok(SaveManager.getBootState() === "ready", "应用云存档后 state=ready");
  // P1-1：使用云端存档 → 写本地 + 同步校验和 + 【不】上传。
  const written = ctx.localStorage.getItem("eve_idle_save");
  ok(!!written, "云存档经 _persistSelectedPayload 已写入本地存档键 eve_idle_save");
  ok(SaveManager._cloudSave.__uploadCalls === 0, "P1-1：冲突选云端不向云端回传（__uploadCalls=0）");
  ok(SaveManager._pendingCloudEnvelope === null, "_pendingCloudEnvelope 已清空");
  ok(ctx.__settleCalls === 1, "应用云存档后离线结算恰好一次（P0-4）");
  const seq = dedupeConsecutive(log());
  ok(seq.indexOf("awaiting-choice") !== -1 && seq[seq.length - 1] === "ready",
     "序列含 awaiting-choice 且最终 ready [" + JSON.stringify(seq) + "]");
}

// ===================== 场景 6：isBootBlocked() 纯函数闸门（P0-2 修正） =====================
console.log("\n[场景6] isBootBlocked() 各状态闸门语义（P0-2 修正）");
{
  const { SaveManager } = buildContext({ cloud: false, failLocal: false });
  const blocked = ["loading", "awaiting-choice", "error", "idle"];
  const free = ["local-only", "ready"];
  let allBlocked = true, allFree = true;
  for (const s of blocked) { SaveManager._bootState = s; if (SaveManager.isBootBlocked() !== true) allBlocked = false; }
  for (const s of free) { SaveManager._bootState = s; if (SaveManager.isBootBlocked() !== false) allFree = false; }
  ok(allBlocked, "loading / awaiting-choice / error 均阻塞（P0-2 修正：error 现在阻塞）");
  ok(allFree, "idle / local-only / ready 均不阻塞");
}

// ===================== 场景 7：P0-3 save() 启动门禁 fail-closed =====================
console.log("\n[场景7] save() 启动门禁（loading / awaiting-choice / error 禁止写盘）");
{
  const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
  // loading 阶段：save() 必须返回 false 且不写盘、不清除 dirty。
  SaveManager._bootState = "loading";
  const before = SaveManager.save();
  ok(before === false, "loading 阶段 save() 返回 false（P0-3 fail-closed）");
  ok(ctx.localStorage.getItem("eve_idle_save") === null, "loading 阶段未写入 eve_idle_save");
  // awaiting-choice 阶段同样禁止。
  SaveManager._bootState = "awaiting-choice";
  ok(SaveManager.save() === false, "awaiting-choice 阶段 save() 返回 false");
  // error 阶段同样禁止。
  SaveManager._bootState = "error";
  ok(SaveManager.save() === false, "error 阶段 save() 返回 false");
  // local-only / ready 解禁。
  SaveManager._bootState = "local-only";
  const lsaved = SaveManager.save();
  ok(lsaved === true, "local-only 阶段 save() 可写盘");
  ok(ctx.localStorage.getItem("eve_idle_save") !== null, "local-only 阶段已写入 eve_idle_save");
}

// ===================== 场景 8：P0-5 真实 hasLocal 决策 =====================
console.log("\n[场景8] P0-5：hasLocal 使用真实本地读档结果（不硬编码 true）");
{
  // 8a) 无本地 + 有云端 → use-cloud（应用云存档，无 fake conflict）
  {
    const { SaveManager } = buildContext({ cloud: true, cloudNone: false, failLocal: false });
    await SaveManager.bootstrap();
    ok(SaveManager._hasLocalCandidate === false, "8a：空 localStorage → _hasLocalCandidate=false");
    ok(SaveManager.getBootState() === "ready", "8a：无本地有云端 → use-cloud → ready");
    ok(SaveManager._cloudSave.__uploadCalls === 0, "8a：use-cloud 不回传云端（P1-1）");
  }
  // 8b) 有本地 + 无云端 → use-local（保留本地，不误报 conflict）
  {
    const { SaveManager } = buildContext({ cloud: true, cloudNone: true, seedLocal: true, failLocal: false });
    await SaveManager.bootstrap();
    ok(SaveManager._hasLocalCandidate === true, "8b：预置本地存档 → _hasLocalCandidate=true");
    ok(SaveManager.getBootState() === "ready", "8b：有本地无云端 → use-local → ready");
  }
  // 8c) 无本地 + 无云端 → new（落本地后 ready）
  {
    const { ctx, SaveManager } = buildContext({ cloud: true, cloudNone: true, failLocal: false });
    await SaveManager.bootstrap();
    ok(SaveManager._hasLocalCandidate === false, "8c：空 localStorage → _hasLocalCandidate=false");
    ok(SaveManager.getBootState() === "ready", "8c：无本地无云端 → new → ready");
    ok(ctx.localStorage.getItem("eve_idle_save") !== null, "8c：new 落本地存档");
  }
}

// ===================== 场景 9：P0-6 云端查询失败显式 error → 零写盘零上传 =====================
console.log("\n[场景9] P0-6：云端查询失败 → 显式 error / 不覆盖本地");
{
  // 9a) 无本地 + 云端查询失败 → 阻塞错误页，零写盘零上传（绝不凭空开新档）
  {
    const { ctx, SaveManager } = buildContext({ cloud: true, cloudError: true, failLocal: false });
    let rejected = false;
    try { await SaveManager.bootstrap(); } catch (e) { rejected = true; }
    ok(SaveManager.getBootState() === "error", "9a：无本地+云端失败 → error（阻塞，不开新档）");
    ok(ctx.localStorage.getItem("eve_idle_save") === null, "9a：零本地写盘（无存档不应凭空创建）");
    ok(SaveManager._cloudSave.__uploadCalls === 0, "9a：零上传（不得用新存档覆盖未知云端）");
    ok(SaveManager._cloudSyncFailed === true, "9a：已标记 _cloudSyncFailed");
  }
  // 9b) 无本地 + 下载损坏 → 同 9a（error / 零写盘零上传）
  {
    const { ctx, SaveManager } = buildContext({ cloud: true, cloudCorrupt: true, failLocal: false });
    try { await SaveManager.bootstrap(); } catch (e) {}
    ok(SaveManager.getBootState() === "error", "9b：无本地+下载损坏 → error");
    ok(ctx.localStorage.getItem("eve_idle_save") === null, "9b：零本地写盘");
    ok(SaveManager._cloudSave.__uploadCalls === 0, "9b：零上传");
  }
  // 9c) 有本地 + 云端查询失败 → local-only 兜底，保留本地且不覆盖云端
  {
    const { ctx, SaveManager } = buildContext({ cloud: true, cloudError: true, seedLocal: true, failLocal: false });
    await SaveManager.bootstrap();
    ok(SaveManager.getBootState() === "local-only", "9c：有本地+云端失败 → local-only 兜底");
    ok(SaveManager._cloudSyncFailed === true, "9c：已标记 _cloudSyncFailed（提示同步失败）");
    ok(SaveManager._cloudSave.__uploadCalls === 0, "9c：不自动覆盖未知云端（零上传）");
    ok(ctx.localStorage.getItem("eve_idle_save") !== null, "9c：本地存档原样保留（未被云端错误覆盖）");
  }
}

// ===================== 场景 10：设备镜像写入后状态自动 写入中→正常（本次定点修复） =====================
// 目标：验证 SaveManager.save()（真实保存入口）→ _recordSuccessfulLocalSave → mirror.scheduleWrite
// 的成功/失败链会刷新设备备份状态：写入中 →（成功）正常 /（失败）备份失败（op/code/msg/file）；
// 成功时清除旧 _mirrorSyncFailed/_lastMirrorError；连续两次保存最终回到正常。
console.log("\n[场景10] SaveManager.save() 设备镜像写入成功 → 状态自动 写入中→正常（定点修复）");
{
  const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
  // persistence.js 直接调用、未做 typeof 守卫的全局，注入桩。
  vm.runInContext(
    "getOrCreateDeviceId = function () { return 'test-device-001'; }; " +
    "computeGameStateChecksum = function () { return 'cs-test'; };",
    ctx
  );

  // 捕获 UI 文案的 DOM 桩（仅对设备备份相关 id 返回可写 textContent 的元素）。
  const els = {};
  function makeEl(id) {
    return { id, _text: "", style: {}, setAttribute() {}, addEventListener() {},
      set textContent(v) { this._text = String(v); }, get textContent() { return this._text; } };
  }
  els["device-backup-status"] = makeEl("device-backup-status");
  els["device-backup-time"] = makeEl("device-backup-time");
  els["cloud-sync-status"] = makeEl("cloud-sync-status");
  els["local-save-time"] = makeEl("local-save-time");
  ctx.document.getElementById = (id) => (id in els ? els[id] : null);

  // 可控 deferred 假 mirror：scheduleWrite 返回一个未决 Promise，resolveAll/rejectAll 控制落定。
  function makeDeferredMirror() {
    const m = {
      _busy: false, _lastWriteAt: null, _error: null, _pending: [],
      isAvailable() { return true; },
      getLastError() { return this._error; },
      status() {
        return { available: true, busy: this._busy, lastWriteAt: this._lastWriteAt,
          initError: null, lastError: this._error, error: this._error };
      },
      scheduleWrite() {
        this._busy = true;
        return new Promise((res, rej) => { this._pending.push({ res, rej }); });
      },
      resolveAll() {
        this._busy = false; this._lastWriteAt = Date.now();
        const list = this._pending; this._pending = [];
        list.forEach((p) => p.res());
      },
      rejectAll(e) {
        this._busy = false; this._error = e;
        const list = this._pending; this._pending = [];
        list.forEach((p) => p.rej(e));
      }
    };
    return m;
  }

  // ---- 10a) 干净状态成功路径：写入中 → 自动 正常；时间更新 ----
  {
    const m = makeDeferredMirror();
    SaveManager._localMirror = m;
    SaveManager._bootState = "ready";
    SaveManager._mirrorSyncFailed = false;
    SaveManager._lastMirrorError = null;
    const saved = SaveManager.save();
    ok(saved === true, "10a: save() 返回 true（本地落盘成功）");
    SaveManager._refreshCloudSaveStatus();
    ok(els["device-backup-status"].textContent === "写入中",
       "10a: 干净状态下 Promise 未完成时状态=写入中（busy 优先于 normal）");
    m.resolveAll();
    await tick();
    SaveManager._refreshCloudSaveStatus();
    ok(els["device-backup-status"].textContent === "正常", "10a: resolve 后状态自动=正常");
    ok(els["device-backup-time"].textContent !== "—" && els["device-backup-time"].textContent !== "",
       "10a: 设备备份时间已更新（非 —）");
  }

  // ---- 10b) 成功写入清除旧失败标记 ----
  {
    const m = makeDeferredMirror();
    SaveManager._localMirror = m;
    SaveManager._bootState = "ready";
    SaveManager._mirrorSyncFailed = true;        // 预设旧失败标记
    SaveManager._lastMirrorError = { op: "prev", code: 1, errMsg: "old failure" };
    SaveManager.save();
    m.resolveAll();
    await tick();
    SaveManager._refreshCloudSaveStatus();
    ok(els["device-backup-status"].textContent === "正常",
       "10b: 旧失败标记下成功写入 → 状态回到正常（标记被清除）");
    ok(SaveManager._mirrorSyncFailed === false, "10b: 成功后清除 _mirrorSyncFailed");
    ok(SaveManager._lastMirrorError === null, "10b: 成功后清除 _lastMirrorError");
  }

  // ---- 10c) 失败路径：写入中 → 备份失败（op/code/msg/file） ----
  {
    const m = makeDeferredMirror();
    SaveManager._localMirror = m;
    SaveManager._bootState = "ready";
    SaveManager._mirrorSyncFailed = false;
    SaveManager._lastMirrorError = null;
    SaveManager.save();
    SaveManager._refreshCloudSaveStatus();
    ok(els["device-backup-status"].textContent === "写入中", "10c: reject 前状态=写入中");
    const rejErr = { op: "write-current", code: 1300013, errMsg: "disk full",
      path: "deep_space_idle_device_backup.json" };
    m.rejectAll(rejErr);
    await tick();
    SaveManager._refreshCloudSaveStatus();
    ok(els["device-backup-status"].textContent ===
       "备份失败（op=write-current code=1300013 msg=disk full file=deep_space_idle_device_backup.json）",
       "10c: reject 后状态=备份失败（op/code/msg/file）");
    ok(SaveManager._mirrorSyncFailed === true, "10c: 失败后 _mirrorSyncFailed=true");
  }

  // ---- 10d) 连续两次保存，最终状态回到 正常 ----
  {
    const m = makeDeferredMirror();
    SaveManager._localMirror = m;
    SaveManager._bootState = "ready";
    SaveManager._mirrorSyncFailed = false;
    SaveManager._lastMirrorError = null;
    SaveManager.save();
    SaveManager.save();
    SaveManager._refreshCloudSaveStatus();
    ok(els["device-backup-status"].textContent === "写入中", "10d: 两次保存均 pending → 写入中");
    m.resolveAll();
    await tick();
    SaveManager._refreshCloudSaveStatus();
    ok(els["device-backup-status"].textContent === "正常", "10d: 两次保存都完成后最终=正常");
  }
}

// ===================== 场景 11：设备镜像恢复自检（探针纯函数 + SaveManager 守卫） =====================
// 覆盖：_pendingDelete 阻止 beforeunload/save 回写；仅删除主 localStorage 键；
// 镜像 deleteAll 零调用；云端 deleteArchive 零调用；镜像 checksum 恢复一致；
// 云端与镜像 checksum 相同时拒绝执行（无法证明恢复来源）。
console.log("\n[场景11] 设备镜像恢复自检（探针纯函数 + SaveManager._pendingDelete 门禁）");
{
  // 假镜像 / 假云端构造器（带调用计数器，用于断言零调用）。
  function makeFakeMirror(env, opts) {
    opts = opts || {};
    return {
      _deleteAllCalls: 0,
      _env: env,
      isAvailable() { return true; },
      readBest() { return Promise.resolve({ status: "ok", slot: "current", envelope: this._env }); },
      deleteAll() { this._deleteAllCalls++; return Promise.resolve(true); },
      scheduleWrite() { return Promise.resolve(); }
    };
  }
  function makeFakeCloud(lastCloudChecksum, opts) {
    opts = opts || {};
    return {
      _deleteArchiveCalls: 0,
      getSyncMeta() { return { lastCloudChecksum: lastCloudChecksum }; },
      deleteArchive() { this._deleteArchiveCalls++; return Promise.resolve(true); }
    };
  }

  // ---- 11a) 云端与镜像 checksum 相同 → 拒绝执行（REFUSE_CLOUD_MATCH） ----
  {
    const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
    const env = { checksum: "MIR-CHK-1", revision: 3, savedAt: 111 };
    const mirror = makeFakeMirror(env);
    const cloud = makeFakeCloud("MIR-CHK-1"); // 与镜像相同
    SaveManager._localMirror = mirror;
    SaveManager._cloudSave = cloud;
    const plan = await mirrorRecoveryPlan({ saveManager: SaveManager, cloud: SaveManager._cloudSave, localStorage: ctx.localStorage });
    ok(plan.ok === false, "11a: 云=镜像 checksum 相同 → plan.ok=false");
    ok(plan.reason === "REFUSE_CLOUD_MATCH", "11a: 拒绝原因=REFUSE_CLOUD_MATCH（避免无法证明恢复来源）");
  }

  // ---- 11b) 云端与镜像 checksum 不同 → plan.ok 并记录 envelope 字段 ----
  {
    const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
    const env = { checksum: "MIR-CHK-1", revision: 3, savedAt: 111 };
    const mirror = makeFakeMirror(env);
    const cloud = makeFakeCloud("CLOUD-OTHER"); // 与镜像不同
    SaveManager._localMirror = mirror;
    SaveManager._cloudSave = cloud;
    const plan = await mirrorRecoveryPlan({ saveManager: SaveManager, cloud: SaveManager._cloudSave, localStorage: ctx.localStorage });
    ok(plan.ok === true, "11b: 云≠镜像 → plan.ok=true");
    ok(plan.record && plan.record.checksum === "MIR-CHK-1", "11b: 记录 checksum=MIR-CHK-1");
    ok(plan.record && Number(plan.record.revision) === 3, "11b: 记录 revision=3");
    ok(plan.record && Number(plan.record.savedAt) === 111, "11b: 记录 savedAt=111");
  }

  // ---- 11c) 执行：设 _pendingDelete、仅删主键、镜像/云端零删除、触发重载 ----
  {
    const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
    const env = { checksum: "MIR-CHK-1", revision: 3, savedAt: 111 };
    const mirror = makeFakeMirror(env);
    const cloud = makeFakeCloud("CLOUD-OTHER");
    SaveManager._localMirror = mirror;
    SaveManager._cloudSave = cloud;
    // 预置主存档键 + 两个诱饵键（云端键、设备镜像文件），用于证明只删主键。
    ctx.localStorage.setItem("eve_idle_save", JSON.stringify({ skills: {} }));
    ctx.localStorage.setItem("eve_cloud_save", "cloud-payload");
    ctx.localStorage.setItem("deep_space_idle_device_backup.json", "mirror-payload");
    const plan = await mirrorRecoveryPlan({ saveManager: SaveManager, cloud: SaveManager._cloudSave, localStorage: ctx.localStorage });
    ok(plan.ok === true, "11c: plan 通过");
    const loc = { reloaded: false, reload() { this.reloaded = true; } };
    const execRet = mirrorRecoveryExecute({
      saveManager: SaveManager, adapterKey: "eve_idle_save",
      localStorage: ctx.localStorage, location: loc, record: plan.record
    });
    ok(execRet === true, "11c: mirrorRecoveryExecute 返回 true");
    ok(SaveManager._pendingDelete === true, "11c: 已设置 SaveManager._pendingDelete=true（阻止回写）");
    ok(ctx.localStorage.getItem("eve_idle_save") === null, "11c: 仅主存档键 eve_idle_save 已被删除");
    ok(ctx.localStorage.getItem("eve_cloud_save") === "cloud-payload", "11c: 云端键 eve_cloud_save 未被触碰");
    ok(ctx.localStorage.getItem("deep_space_idle_device_backup.json") === "mirror-payload", "11c: 设备镜像文件未被触碰");
    ok(mirror._deleteAllCalls === 0, "11c: 镜像 deleteAll 零调用");
    ok(cloud._deleteArchiveCalls === 0, "11c: 云端 deleteArchive 零调用");
    ok(loc.reloaded === true, "11c: 已触发 location.reload()（重载后由探针验收恢复）");
  }

  // ---- 11d) _pendingDelete=true 时 SaveManager.save()（beforeunload 路径）被门禁、不回写主键 ----
  {
    const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
    SaveManager._bootState = "ready";
    SaveManager._pendingDelete = true; // 模拟 11c execute 之后的状态
    const r = SaveManager.save();       // 等价于 beforeunload → SaveManager.save()
    ok(r === false, "11d: _pendingDelete=true 时 save() 返回 false（beforeunload 不落盘）");
    ok(ctx.localStorage.getItem("eve_idle_save") === null, "11d: 主键未被 save() 回写（仍为空）");
  }

  // ---- 11e) 执行后镜像源仍完好 → 重载恢复会得到一致的 checksum/revision/savedAt ----
  {
    const { ctx, SaveManager } = buildContext({ cloud: false, failLocal: false });
    const env = { checksum: "MIR-CHK-1", revision: 3, savedAt: 111 };
    const mirror = makeFakeMirror(env);
    const cloud = makeFakeCloud("CLOUD-OTHER");
    SaveManager._localMirror = mirror;
    SaveManager._cloudSave = cloud;
    const plan = await mirrorRecoveryPlan({ saveManager: SaveManager, cloud: SaveManager._cloudSave, localStorage: ctx.localStorage });
    mirrorRecoveryExecute({ saveManager: SaveManager, adapterKey: "eve_idle_save", localStorage: ctx.localStorage, location: { reload() {} }, record: plan.record });
    // 模拟重载后启动流程再次读取镜像（恢复来源完好）。
    const best2 = await mirror.readBest();
    ok(best2.status === "ok", "11e: 执行后镜像仍可读取（status=ok）");
    ok(String(best2.envelope.checksum) === String(plan.record.checksum), "11e: 恢复后 checksum 与记录一致（MIR-CHK-1）");
    ok(Number(best2.envelope.revision) === Number(plan.record.revision), "11e: 恢复后 revision 一致（3）");
    ok(Number(best2.envelope.savedAt) === Number(plan.record.savedAt), "11e: 恢复后 savedAt 一致（111）");
  }

  ok(RECOVERY_PROBE_KEY === "deep_space_idle_mirror_recovery_probe", "11: 独立测试键隔离于正式存档键（RECOVERY_PROBE_KEY）");
}

console.log(failures === 0 ? "\n测试通过 (0 失败)" : "\n测试失败 (" + failures + " 项)");
process.exit(failures === 0 ? 0 : 1);
