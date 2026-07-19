/* ================================================================
   运行时守卫 — 无 DOM 的错误记录、节流与关键循环隔离
   ================================================================ */

const RuntimeGuard = (() => {
  const listeners = new Set();
  const records = [];
  const pausedChannels = new Set();
  const recentSignatures = new Map();
  const MAX_RECORDS = 50;
  const DUPLICATE_WINDOW_MS = 3000;

  function normalizeError(error) {
    if (error instanceof Error) return error;
    if (error && typeof error === "object") {
      const normalized = new Error(error.message || JSON.stringify(error));
      if (error.stack) normalized.stack = error.stack;
      return normalized;
    }
    return new Error(String(error || "未知错误"));
  }

  function notify(event) {
    for (const listener of listeners) {
      try { listener(event); }
      catch (listenerError) { console.error("[RuntimeGuard] 错误监听器异常", listenerError); }
    }
  }

  function report(error, context) {
    const normalized = normalizeError(error);
    const details = context || {};
    const source = details.source || "runtime";
    const signature = source + "|" + normalized.message;
    const now = Date.now();
    const recent = recentSignatures.get(signature);
    if (recent && now - recent.timestamp < DUPLICATE_WINDOW_MS) {
      recent.record.count += 1;
      recent.timestamp = now;
      notify({ type:"error-updated", record:recent.record });
      return recent.record;
    }
    const record = {
      id:"runtime_error_" + now + "_" + records.length,
      timestamp:now,
      source,
      message:normalized.message,
      stack:normalized.stack || "",
      fatal:Boolean(details.fatal),
      kind:details.kind || "runtime",
      count:1
    };
    records.push(record);
    if (records.length > MAX_RECORDS) records.shift();
    recentSignatures.set(signature, { timestamp:now, record });
    console.error("[RuntimeGuard] " + source + "：" + normalized.message, normalized);
    notify({ type:"error", record });
    return record;
  }

  function runCritical(channel, callback) {
    if (pausedChannels.has(channel)) return { ok:false, paused:true };
    try { return { ok:true, value:callback() }; }
    catch (error) {
      pausedChannels.add(channel);
      return { ok:false, error, record:report(error, { source:channel, fatal:true, kind:"critical-loop" }) };
    }
  }

  function runRecoverable(channel, callback) {
    try { return { ok:true, value:callback() }; }
    catch (error) { return { ok:false, error, record:report(error, { source:channel, fatal:false, kind:"recoverable-loop" }) }; }
  }

  function resume(channel) {
    const changed = pausedChannels.delete(channel);
    if (changed) notify({ type:"resumed", channel });
    return changed;
  }

  function verifyBoot(checks) {
    const failed = [];
    for (const check of checks || []) {
      let passed = false;
      try { passed = Boolean(check.test()); } catch (_) { passed = false; }
      if (!passed) failed.push(check.name);
    }
    if (failed.length) report(new Error("关键模块未完成加载：" + failed.join("、")), { source:"bootstrap", fatal:true, kind:"boot" });
    else notify({ type:"boot-ready" });
    return failed;
  }

  function onEvent(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    report,
    runCritical,
    runRecoverable,
    resume,
    verifyBoot,
    onEvent,
    getErrors:() => records.slice(),
    isPaused:channel => pausedChannels.has(channel)
  };
})();

window.RuntimeGuard = RuntimeGuard;

window.addEventListener("error", event => {
  const target = event && event.target;
  if (target && target.tagName === "SCRIPT") {
    RuntimeGuard.report(new Error("脚本加载失败：" + (target.src || "未知脚本")), { source:"script-loader", fatal:true, kind:"script-load" });
    return;
  }
  if (event && event.error) RuntimeGuard.report(event.error, { source:event.filename || "window", fatal:false });
}, true);

window.addEventListener("unhandledrejection", event => {
  RuntimeGuard.report(event && event.reason ? event.reason : new Error("未处理的异步异常"), { source:"promise", fatal:false, kind:"unhandled-rejection" });
});

