/* Production-behaviour test for TapTap two-generation device mirror. */
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function ok(value, label) {
  console.log((value ? "PASS " : "FAIL ") + label);
  if (!value) failures += 1;
}

function makeFs() {
  const files = new Map();
  const ctl = { corruptTempRead: false, failFinalRename: false, readErrorPath: "" };
  function err(errno, errMsg) { return { errno, errMsg }; }
  return {
    files, ctl,
    readFile(o) {
      queueMicrotask(() => {
        if (ctl.readErrorPath && o.filePath === ctl.readErrorPath) return o.fail(err(1300013, "permission denied"));
        if (!files.has(o.filePath)) return o.fail(err(1300002, "no such file or directory " + o.filePath));
        let data = files.get(o.filePath);
        if (ctl.corruptTempRead && /\.tmp\.json$/.test(o.filePath)) data += "-corrupt";
        o.success({ data });
      });
    },
    writeFile(o) { queueMicrotask(() => { files.set(o.filePath, String(o.data)); o.success({}); }); },
    unlink(o) {
      queueMicrotask(() => {
        if (!files.has(o.filePath)) return o.fail(err(1300002, "no such file or directory " + o.filePath));
        files.delete(o.filePath); o.success({});
      });
    },
    rename(o) {
      queueMicrotask(() => {
        if (!files.has(o.oldPath)) return o.fail(err(1300002, "no such file or directory " + o.oldPath));
        if (ctl.failFinalRename && /\.tmp\.json$/.test(o.oldPath)) return o.fail(err(1300005, "Input/output error"));
        files.set(o.newPath, files.get(o.oldPath)); files.delete(o.oldPath); o.success({});
      });
    }
  };
}

function build() {
  const fs = makeFs();
  const ctx = { console, Promise, Error, JSON, Date, Object, Array, Number, String, Math, setTimeout, clearTimeout, queueMicrotask };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.tap = { env: { USER_DATA_PATH: "tapfile://usr" }, getFileSystemManager: () => fs };
  vm.createContext(ctx);
  for (const rel of [
    "js/platform/local-mirror-contract.js",
    "js/core/save-envelope.js",
    "js/platform/taptap/taptap-local-mirror-provider.js",
    "js/core/local-mirror-service.js"
  ]) vm.runInContext(readFileSync(join(repo, rel), "utf8"), ctx, { filename: rel });
  const provider = new ctx.TapTapLocalMirrorProvider();
  const service = new ctx.LocalMirrorService({ provider });
  return { ctx, fs, provider, service };
}

function buildSyncOnly() {
  const files = new Map();
  function missing(path) { const e = new Error("no such file"); e.errno = 1300002; e.errMsg = "no such file " + path; return e; }
  const fs = {
    files,
    readFileSync(path) { if (!files.has(path)) throw missing(path); return files.get(path); },
    writeFileSync(path, data) { files.set(path, String(data)); },
    unlinkSync(path) { if (!files.has(path)) throw missing(path); files.delete(path); },
    renameSync(oldPath, newPath) { if (!files.has(oldPath)) throw missing(oldPath); files.set(newPath, files.get(oldPath)); files.delete(oldPath); }
  };
  const ctx = { console, Promise, Error, JSON, Date, Object, Array, Number, String, Math, setTimeout, clearTimeout, queueMicrotask };
  ctx.window = ctx; ctx.globalThis = ctx;
  // H5 compatibility may omit tap.env while still exposing a working sync-only FS.
  ctx.tap = { getFileSystemManager: () => fs };
  vm.createContext(ctx);
  for (const rel of [
    "js/platform/local-mirror-contract.js",
    "js/core/save-envelope.js",
    "js/platform/taptap/taptap-local-mirror-provider.js",
    "js/core/local-mirror-service.js"
  ]) vm.runInContext(readFileSync(join(repo, rel), "utf8"), ctx, { filename: rel });
  const provider = new ctx.TapTapLocalMirrorProvider();
  const service = new ctx.LocalMirrorService({ provider });
  return { ctx, fs, provider, service };
}

function env(ctx, revision, savedAt, marker) {
  return ctx.SaveEnvelope.create({ payload: { skills: {}, marker, lastSaveTime: savedAt }, revision, savedAt, deviceId: "test-device" });
}

console.log("\n[1] empty / first write / rotation");
{
  const { ctx, fs, provider, service } = build();
  ok(await service.init(), "TapTap mirror provider initializes");
  ok((await service.readBest()).status === "none", "missing files are explicit none");
  await service.scheduleWrite(env(ctx, 1, 100, "A"));
  const paths = provider.getPaths();
  ok(fs.files.has(paths.current), "first generation committed to current");
  ok(!fs.files.has(paths.temporary), "temporary removed by rename");
  await service.scheduleWrite(env(ctx, 2, 200, "B"));
  ok(fs.files.has(paths.previous), "second write rotates current to previous");
  const best = await service.readBest();
  ok(best.status === "ok" && best.envelope.payload.marker === "B", "newest valid generation selected");
}

console.log("\n[2] corrupt current falls back to previous");
{
  const { ctx, fs, provider, service } = build();
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "old"));
  await service.scheduleWrite(env(ctx, 2, 200, "new"));
  const paths = provider.getPaths();
  fs.files.set(paths.current, "{corrupt");
  const result = await service.readBest();
  ok(result.status === "ok" && result.slot === "previous" && result.envelope.payload.marker === "old", "previous survives corrupt current");
  ok(Array.isArray(result.warnings) && result.warnings.length === 1, "corruption retained as warning");
}

console.log("\n[3] temporary read-back mismatch never replaces current");
{
  const { ctx, fs, provider, service } = build();
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "safe"));
  fs.ctl.corruptTempRead = true;
  let rejected = false;
  try { await service.scheduleWrite(env(ctx, 2, 200, "bad")); } catch (_) { rejected = true; }
  fs.ctl.corruptTempRead = false;
  const result = await service.readBest();
  ok(rejected, "read-back mismatch rejects write");
  ok(result.status === "ok" && result.envelope.payload.marker === "safe", "validated current remains intact");
  ok(!fs.files.has(provider.getPaths().temporary), "failed temporary cleaned up");
  await service.retryPending();
  const retried = await service.readBest();
  ok(retried.status === "ok" && retried.envelope.payload.marker === "bad", "queued generation succeeds on explicit retry");
}

console.log("\n[4] interrupted final rename preserves previous generation");
{
  const { ctx, fs, provider, service } = build();
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "survivor"));
  fs.ctl.failFinalRename = true;
  try { await service.scheduleWrite(env(ctx, 2, 200, "interrupted")); } catch (_) {}
  fs.ctl.failFinalRename = false;
  const result = await service.readBest();
  ok(result.status === "ok" && result.envelope.payload.marker === "survivor", "rotation interruption is recoverable");
}

console.log("\n[5] permission error is error, never none");
{
  const { fs, provider, service } = build();
  await service.init();
  fs.ctl.readErrorPath = provider.getPaths().current;
  const result = await service.readBest();
  ok(result.status === "error", "I/O/permission failure remains explicit error");
}

console.log("\n[6] delete clears all generations");
{
  const { ctx, fs, provider, service } = build();
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "A"));
  await service.scheduleWrite(env(ctx, 2, 200, "B"));
  await service.deleteAll();
  const paths = provider.getPaths();
  ok(!fs.files.has(paths.current) && !fs.files.has(paths.previous) && !fs.files.has(paths.temporary), "current/previous/tmp all removed");
}

console.log("\n[7] sync-only H5 FileSystemManager without tap.env");
{
  const { ctx, provider, service } = buildSyncOnly();
  ok(await service.init(), "sync-only provider initializes without tap.env");
  await service.scheduleWrite(env(ctx, 1, 100, "sync-A"));
  await service.scheduleWrite(env(ctx, 2, 200, "sync-B"));
  const result = await service.readBest();
  ok(result.status === "ok" && result.envelope.payload.marker === "sync-B", "sync-only provider writes, rotates and reads newest generation");
  ok(provider.getPaths().current.startsWith("./"), "missing USER_DATA_PATH uses the cloud-adapter-compatible relative base");
}

console.log("\n[8] TapTap H5 read/write/unlink without rename");
{
  const { ctx, fs, provider, service } = build();
  delete fs.rename;
  ok(await service.init(), "provider initializes when rename is absent");
  await service.scheduleWrite(env(ctx, 1, 100, "copy-A"));
  await service.scheduleWrite(env(ctx, 2, 200, "copy-B"));
  const paths = provider.getPaths();
  const best = await service.readBest();
  ok(best.status === "ok" && best.envelope.payload.marker === "copy-B", "copy fallback commits newest generation");
  fs.files.set(paths.current, "{corrupt");
  const fallback = await service.readBest();
  ok(fallback.status === "ok" && fallback.envelope.payload.marker === "copy-A", "copy fallback preserves previous generation");
  ok(!fs.files.has(paths.temporary), "copy fallback removes temporary file");
}

// ---------- 真实 H5 行为矩阵：回调 / Promise(AsyncFunction) / 双触发 ----------
// 真机差异：TapTap H5 的 readFile 是 AsyncFunction，返回 Promise 且不调用 success/fail
// 回调。以下制造三种文件系统实现，全部加载生产 provider/service/envelope，验证修复。
function makeFsVariant(mode, opts) {
  opts = opts || {};
  const files = new Map();
  const ctl = {
    corruptTempRead: false,
    failFinalRename: false,
    readErrorPath: "",
    readError: null,
    readNotFound: null,
    writeFailsPath: "",
    writeFailsErrno: 1300013,
    unlinkFailsPath: "",
    unlinkFailsErrno: 1300013,
    unlinkNotFound: null
  };
  function mkErr(errno, errMsg) { return { errno, errMsg }; }
  function runSucc(o, res) {
    if (mode === "callback") { queueMicrotask(() => o.success(res)); return undefined; }
    if (mode === "promise") return Promise.resolve(res);
    return (async () => { queueMicrotask(() => o.success(res)); return res; })(); // dual
  }
  function runFail(o, err) {
    if (mode === "callback") { queueMicrotask(() => o.fail(err)); return undefined; }
    if (mode === "promise") return Promise.reject(err);
    return (async () => { queueMicrotask(() => o.fail(err)); throw err; })(); // dual
  }
  const handlers = {
    readFile(o) {
      if (ctl.readErrorPath && o.filePath === ctl.readErrorPath) return runFail(o, ctl.readError || mkErr(1300013, "permission denied"));
      if (!files.has(o.filePath)) return runFail(o, ctl.readNotFound || mkErr(1300002, "no such file or directory " + o.filePath));
      let data = files.get(o.filePath);
      if (ctl.corruptTempRead && /\.tmp\.json$/.test(o.filePath)) data += "-corrupt";
      return runSucc(o, { data });
    },
    writeFile(o) {
      if (ctl.writeFailsPath && o.filePath === ctl.writeFailsPath) return runFail(o, mkErr(ctl.writeFailsErrno, "write failed " + o.filePath));
      files.set(o.filePath, String(o.data));
      return runSucc(o, {});
    },
    unlink(o) {
      if (ctl.unlinkFailsPath && o.filePath === ctl.unlinkFailsPath) return runFail(o, mkErr(ctl.unlinkFailsErrno, "unlink failed " + o.filePath));
      if (!files.has(o.filePath)) return runFail(o, ctl.unlinkNotFound || mkErr(1300002, "no such file or directory " + o.filePath));
      files.delete(o.filePath);
      return runSucc(o, {});
    },
    rename(o) {
      if (!files.has(o.oldPath)) return runFail(o, mkErr(1300002, "no such file " + o.oldPath));
      if (ctl.failFinalRename && /\.tmp\.json$/.test(o.oldPath)) return runFail(o, mkErr(1300005, "I/O error"));
      files.set(o.newPath, files.get(o.oldPath)); files.delete(o.oldPath);
      return runSucc(o, {});
    }
  };
  const fs = { files, ctl };
  ["readFile", "writeFile", "unlink", "rename"].forEach((k) => { fs[k] = function (o) { return handlers[k](o); }; });
  if (opts && opts.rename === false) delete fs.rename;
  return fs;
}

function buildVariant(mode, opts) {
  const fs = makeFsVariant(mode, opts);
  const ctx = { console, Promise, Error, JSON, Date, Object, Array, Number, String, Math, setTimeout, clearTimeout, queueMicrotask };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.tap = { env: { USER_DATA_PATH: "tapfile://usr" }, getFileSystemManager: () => fs };
  vm.createContext(ctx);
  for (const rel of [
    "js/platform/local-mirror-contract.js",
    "js/core/save-envelope.js",
    "js/platform/taptap/taptap-local-mirror-provider.js",
    "js/core/local-mirror-service.js"
  ]) vm.runInContext(readFileSync(join(repo, rel), "utf8"), ctx, { filename: rel });
  const provider = new ctx.TapTapLocalMirrorProvider();
  const service = new ctx.LocalMirrorService({ provider });
  return { ctx, fs, provider, service };
}

console.log("\n[9] H5 回调/Promise/双触发 三种形态下无 rename 提交");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  ok(provider.isAvailable(), "[" + mode + "] provider 初始化（rename 缺失）");
  await service.scheduleWrite(env(ctx, 1, 100, "A-" + mode));
  await service.scheduleWrite(env(ctx, 2, 200, "B-" + mode));
  const paths = provider.getPaths();
  const best = await service.readBest();
  ok(best.status === "ok" && best.envelope.payload.marker === "B-" + mode, "[" + mode + "] 最新一代已提交并可读");
  ok(fs.files.has(paths.current) && fs.files.has(paths.previous) && !fs.files.has(paths.temporary), "[" + mode + "] current/previous 存在、temporary 已清理");
}

console.log("\n[10] 回调 + Promise 同时触发仅落定一次（once 守卫）");
{
  const { ctx, provider } = buildVariant("dual", { rename: false });
  await provider.initialize();
  let calls = 0;
  provider._fs.readFile = function (o) { calls += 1; o.success({ data: "x" }); return Promise.resolve({ data: "x" }); };
  let settles = 0;
  const p = provider._invoke("readFile", "readFileSync", { filePath: "p", encoding: "utf8" }, "readFile", "p");
  p.then(() => { settles += 1; }).catch(() => { settles += 1; });
  const res = await p;
  await Promise.resolve();
  ok(res && res.data === "x", "[dual] _invoke 解析正确数据");
  ok(calls === 1, "[dual] fs 方法仅被调用一次");
  ok(settles === 1, "[dual] provider promise 仅落定一次（无双 resolve）");
}

console.log("\n[11] Promise reject 保留 errno/errMsg/op/path");
for (const mode of ["promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  fs.ctl.readErrorPath = provider.getPaths().current;
  const r = await service.readBest();
  ok(r.status === "error", "[" + mode + "] 读取错误保留为 error");
  const e = r.error;
  ok(e && e.code === 1300013, "[" + mode + "] errno 1300013 保留");
  ok(e && /permission denied/.test(e.errMsg || e.message || ""), "[" + mode + "] errMsg 保留");
  ok(e && e.op === "read-current", "[" + mode + "] op=read-current 保留");
  ok(e && /deep_space_idle_device_backup.*\.json$/.test(e.path || ""), "[" + mode + "] path 含备份文件名");
}

console.log("\n[12] temporary 写失败不损坏 current/previous");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "safe-" + mode));
  fs.ctl.writeFailsPath = provider.getPaths().temporary;
  let rejected = false;
  try { await service.scheduleWrite(env(ctx, 2, 200, "bad-" + mode)); } catch (_) { rejected = true; }
  fs.ctl.writeFailsPath = "";
  ok(rejected, "[" + mode + "] temporary 写失败 reject");
  const r = await service.readBest();
  ok(r.status === "ok" && r.envelope.payload.marker === "safe-" + mode, "[" + mode + "] current 完好（旧代有效）");
}

console.log("\n[13] temporary 回读失败不损坏 current/previous");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "safe-" + mode));
  fs.ctl.corruptTempRead = true;
  let rejected = false;
  try { await service.scheduleWrite(env(ctx, 2, 200, "bad-" + mode)); } catch (_) { rejected = true; }
  fs.ctl.corruptTempRead = false;
  ok(rejected, "[" + mode + "] 回读不一致 reject（op=verify-temporary）");
  const r = await service.readBest();
  ok(r.status === "ok" && r.envelope.payload.marker === "safe-" + mode, "[" + mode + "] current 完好");
  ok(!fs.files.has(provider.getPaths().temporary), "[" + mode + "] temporary 已清理");
}

console.log("\n[14] previous 复制失败不覆盖 current");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "gen1-" + mode));
  fs.ctl.writeFailsPath = provider.getPaths().previous;
  let rejected = false;
  try { await service.scheduleWrite(env(ctx, 2, 200, "gen2-" + mode)); } catch (_) { rejected = true; }
  fs.ctl.writeFailsPath = "";
  ok(rejected, "[" + mode + "] copy-previous 失败 reject（op=copy-previous）");
  const r = await service.readBest();
  ok(r.status === "ok" && r.envelope.payload.marker === "gen1-" + mode, "[" + mode + "] current 未被新代覆盖（旧代有效）");
}

console.log("\n[15] current 覆盖失败仍可从 previous 恢复");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "gen1-" + mode));
  fs.ctl.writeFailsPath = provider.getPaths().current;
  let rejected = false;
  try { await service.scheduleWrite(env(ctx, 2, 200, "gen2-" + mode)); } catch (_) { rejected = true; }
  fs.ctl.writeFailsPath = "";
  ok(rejected, "[" + mode + "] write-current 失败 reject（op=write-current）");
  const r = await service.readBest();
  ok(r.status === "ok" && r.envelope.payload.marker === "gen1-" + mode, "[" + mode + "] 仍可从 previous 恢复旧代");
}

console.log("\n[16] unlink temporary 失败：current 已有效、状态如实、可重试");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  fs.ctl.unlinkFailsPath = provider.getPaths().temporary;
  fs.ctl.unlinkFailsErrno = 1300013;
  let rejected = false;
  try { await service.scheduleWrite(env(ctx, 1, 100, "U-" + mode)); } catch (_) { rejected = true; }
  ok(rejected, "[" + mode + "] unlink-temporary 失败 reject（op=unlink-temporary）");
  const r = await service.readBest();
  ok(r.status === "ok" && r.envelope.payload.marker === "U-" + mode, "[" + mode + "] current 已有效（新代落定）");
  const st = service.status();
  ok(st.error && st.error.op === "unlink-temporary", "[" + mode + "] status.error.op=unlink-temporary 如实上报");
  ok(service._pendingEnvelope !== null, "[" + mode + "] 最新待写信封保留用于重试");
  fs.ctl.unlinkFailsPath = "";
  const retried = await service.retryPending();
  ok(retried && retried.ok === true, "[" + mode + "] retryPending 成功");
  ok(!fs.files.has(provider.getPaths().temporary), "[" + mode + "] 重试后 temporary 清理");
}

console.log("\n[17] 连续快速 scheduleWrite 仅保留最新待写信封，不并发破坏双槽");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  await service.init();
  const paths = provider.getPaths();
  const writes = [];
  for (let i = 1; i <= 5; i++) writes.push(service.scheduleWrite(env(ctx, i, i * 100, "rapid-" + mode + "-" + i)));
  await Promise.all(writes);
  await service.retryPending().catch(() => {});
  const r = await service.readBest();
  ok(r.status === "ok", "[" + mode + "] 最终可读");
  ok(r.envelope.payload.marker === "rapid-" + mode + "-5", "[" + mode + "] 仅最新一代（#5）落定");
  ok(fs.files.has(paths.current) && fs.files.has(paths.previous), "[" + mode + "] 双槽均有效");
  ok(!fs.files.has(paths.temporary), "[" + mode + "] temporary 最终已清理");
  ok(fs.files.get(paths.current) === ctx.SaveEnvelope.encode(env(ctx, 5, 500, "rapid-" + mode + "-5")), "[" + mode + "] current 字节等于最新信封");
}

console.log("\n[18] 真机消息式 not-found（无 errno）：空设备首备→current，二备→previous，损坏→previous 恢复");
for (const mode of ["callback", "promise", "dual"]) {
  const { ctx, fs, provider, service } = buildVariant(mode, { rename: false });
  // 真机：缺文件仅返回 errMsg（无 errno）
  fs.ctl.readNotFound = { errMsg: "readFile fail: File does not exist" };
  fs.ctl.unlinkNotFound = { errMsg: "unlink fail: File does not exist" };
  await service.init();
  await service.scheduleWrite(env(ctx, 1, 100, "empty-first-" + mode));
  const paths = provider.getPaths();
  ok(fs.files.has(paths.current), "[" + mode + "] 空设备首备成功创建 current");
  ok(!fs.files.has(paths.previous), "[" + mode + "] 首备尚无 previous");
  await service.scheduleWrite(env(ctx, 2, 200, "empty-second-" + mode));
  ok(fs.files.has(paths.previous), "[" + mode + "] 二备创建 previous（复制式双槽）");
  fs.files.set(paths.current, "{corrupt");
  const r = await service.readBest();
  ok(r.status === "ok" && r.envelope.payload.marker === "empty-first-" + mode, "[" + mode + "] current 损坏后从 previous 恢复旧代");
}

console.log("\n[19] not-found 消息式判定：errMsg 对象 / Promise Error / unlink 缺失成功");
{
  const { fs, service } = buildVariant("callback", { rename: false });
  fs.ctl.readNotFound = { errMsg: "readFile fail: File does not exist" };
  await service.init();
  const r1 = await service.readBest();
  ok(r1.status === "none", "[callback] readFile fail({errMsg}) 无 errno → none（首备前缺文件正常）");
}
{
  const { fs, service } = buildVariant("promise", { rename: false });
  fs.ctl.readNotFound = new Error("readFile fail: File does not exist");
  await service.init();
  const r2 = await service.readBest();
  ok(r2.status === "none", "[promise] Promise reject Error(...) 无 errno → none");
}
{
  const { fs, service } = buildVariant("callback", { rename: false });
  fs.ctl.unlinkNotFound = { errMsg: "unlink fail: File does not exist" };
  await service.init();
  let okDel = true;
  try { await service.deleteAll(); } catch (_) { okDel = false; }
  ok(okDel, "[callback] unlink 缺文件（消息式 not-found）且 missingIsSuccess=true → 成功");
}

console.log("\n[20] 误判防御：permission denied / Input/output error 无 errno 必须保持 error");
{
  const { fs, provider, service } = buildVariant("callback", { rename: false });
  fs.ctl.readNotFound = { errMsg: "readFile fail: File does not exist" };
  fs.ctl.readError = { errMsg: "permission denied" };
  await service.init();
  fs.ctl.readErrorPath = provider.getPaths().current;
  const r = await service.readBest();
  ok(r.status === "error", "[callback] permission denied（无 errno）保持 error（非 none）");
  ok(r.error && r.error.op === "read-current", "[callback] error.op=read-current 保留");
}
{
  const { fs, provider, service } = buildVariant("callback", { rename: false });
  fs.ctl.readNotFound = { errMsg: "readFile fail: File does not exist" };
  fs.ctl.readError = { errMsg: "Input/output error" };
  await service.init();
  fs.ctl.readErrorPath = provider.getPaths().current;
  const r = await service.readBest();
  ok(r.status === "error", "[callback] Input/output error（无 errno）保持 error（非 none）");
}

console.log(failures ? `\nFAILED ${failures}` : "\nALL LOCAL MIRROR TESTS PASSED");
process.exit(failures ? 1 : 0);
