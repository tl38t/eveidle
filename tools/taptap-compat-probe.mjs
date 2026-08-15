// TapTap H5 自测兼容性探针（仅注入构建后的 index.html，不修改正式源码）
// 用途：在 TapTap「H5 包体」网页端真机/自测环境中确认真实运行能力。
// 约束：
//  - 不调用任何 TapTap SDK，不发起网络请求，不泄露 MiniApp ID / Secret / 用户信息 / 存档内容。
//  - 不读取、覆盖或删除游戏正式存档键（游戏键为 eve_idle_save，本探针固定使用独立键）。
//  - 只显示 PASS/FAIL，不修改游戏业务状态。
//  - 通过现有 importmap 执行 import * as THREE from "three"。

const PROBE_KEY = "deep_space_idle_taptap_probe_v1";

// 设备镜像恢复自检的独立测试键（与游戏正式存档键 eve_idle_save 完全隔离）。
const RECOVERY_PROBE_KEY = "deep_space_idle_mirror_recovery_probe";

const checks = [];
function add(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || "" });
}

// ---------- 设备镜像恢复自检（纯函数，浏览器探针与机器测试共用） ----------
// 规划阶段：执行前检查 + 记录镜像信封 + 与最后云端 checksum 比对（相同则拒绝）。
// 绝不触碰任何删除 / 重载。ctx: { saveManager, cloud, localStorage }
async function mirrorRecoveryPlan(ctx) {
  const saveManager = ctx && ctx.saveManager;
  const cloud = ctx && ctx.cloud;
  if (!saveManager || typeof saveManager._localMirror === "undefined") {
    return { ok: false, reason: "NO_SAVEMANAGER", message: "SaveManager 不可用" };
  }
  const mirror = saveManager._localMirror;
  if (!mirror || typeof mirror.isAvailable !== "function" || !mirror.isAvailable()) {
    return { ok: false, reason: "MIRROR_UNAVAILABLE", message: "设备镜像不可用（available=false）" };
  }
  let best;
  try { best = await mirror.readBest(); } catch (e) { best = { status: "error", error: e }; }
  if (!best || best.status !== "ok" || !best.envelope) {
    return { ok: false, reason: "NO_MIRROR_ENVELOPE", message: "设备镜像无有效存档（status=" + (best && best.status) + "）" };
  }
  const env = best.envelope;
  const checksum = env.checksum;
  const revision = env.revision;
  const savedAt = env.savedAt;
  // 与最后云端 checksum 比对：若相同，则无法证明恢复来源是设备镜像，必须拒绝。
  let lastCloud = "";
  try {
    const meta = cloud && typeof cloud.getSyncMeta === "function" ? cloud.getSyncMeta() : null;
    lastCloud = (meta && meta.lastCloudChecksum) || "";
  } catch (e) {}
  if (checksum && lastCloud && String(checksum) === String(lastCloud)) {
    return {
      ok: false,
      reason: "REFUSE_CLOUD_MATCH",
      message: "请先产生少量游戏进度，保存并设备备份，但不要云同步。"
    };
  }
  return { ok: true, record: { checksum: checksum, revision: revision, savedAt: savedAt, slot: best.slot } };
}

// 执行阶段：设置 _pendingDelete 阻止回写 → 仅删除主存档键 → 确认已空 → 触发重载。
// ctx: { saveManager, adapterKey, localStorage, location, record }
function mirrorRecoveryExecute(ctx) {
  const saveManager = ctx && ctx.saveManager;
  const adapterKey = ctx && ctx.adapterKey;
  const localStorage = ctx && ctx.localStorage;
  const location = ctx && ctx.location;
  if (!saveManager || !adapterKey || !localStorage) throw new Error("mirrorRecoveryExecute 参数缺失");
  saveManager._pendingDelete = true;            // 阻止 beforeunload / 自动保存回写主存档
  localStorage.removeItem(adapterKey);          // 仅删除主存档键（设备镜像 / 云存档均不动）
  const stillThere = localStorage.getItem(adapterKey);
  if (stillThere !== null && stillThere !== undefined) throw new Error("删除主存档键失败：键仍存在");
  if (location && typeof location.reload === "function") location.reload();
  return true;
}

export { mirrorRecoveryPlan, mirrorRecoveryExecute, RECOVERY_PROBE_KEY };

function buildPanel() {
  const allPass = checks.every((c) => c.ok);
  const wrap = document.createElement("div");
  wrap.id = "taptap-probe";

  const style = document.createElement("style");
  style.textContent = `
#taptap-probe{position:fixed;right:8px;bottom:8px;z-index:2147483000;max-width:300px;
  font:12px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#d7e3ef;
  background:rgba(10,18,30,.94);border:1px solid #1d2c3c;border-radius:10px;
  box-shadow:0 6px 24px rgba(0,0,0,.45);overflow:hidden;user-select:none;}
#taptap-probe *{box-sizing:border-box;}
#taptap-probe .tp-head{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;
  background:linear-gradient(90deg,#12233a,#0c1726);}
#taptap-probe .tp-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}
#taptap-probe .tp-title{font-weight:700;letter-spacing:.3px;}
#taptap-probe .tp-toggle{margin-left:auto;opacity:.7;font-size:11px;}
#taptap-probe .tp-body{padding:6px 10px 9px;display:block;max-height:60vh;overflow:auto;}
#taptap-probe.tp-collapsed .tp-body{display:none;}
#taptap-probe .tp-row{display:flex;align-items:center;gap:6px;padding:2px 0;}
#taptap-probe .tp-badge{flex:0 0 auto;width:42px;text-align:center;border-radius:4px;
  font-weight:700;font-size:10px;padding:1px 0;}
#taptap-probe .tp-pass{background:#11331f;color:#5fe39a;}
#taptap-probe .tp-fail{background:#3a1414;color:#ff8585;}
#taptap-probe .tp-name{flex:1 1 auto;}
#taptap-probe .tp-detail{color:#8aa0b6;font-size:10px;margin-left:48px;word-break:break-all;}
#taptap-probe .tp-note{margin-top:6px;padding-top:6px;border-top:1px solid #1d2c3c;color:#9fd0ff;font-size:11px;}
#taptap-probe .tp-verdict{margin-top:6px;font-weight:700;}
#taptap-probe .tp-verdict.ok{color:#5fe39a;}
#taptap-probe .tp-verdict.bad{color:#ff8585;}`;
  document.head.appendChild(style);

  const head = document.createElement("div");
  head.className = "tp-head";
  const dot = document.createElement("span");
  dot.className = "tp-dot";
  dot.style.background = allPass ? "#5fe39a" : "#ff8585";
  const title = document.createElement("span");
  title.className = "tp-title";
  title.textContent = "TapTap H5 探针";
  const toggle = document.createElement("span");
  toggle.className = "tp-toggle";
  toggle.textContent = "收起 ▾";
  head.appendChild(dot);
  head.appendChild(title);
  head.appendChild(toggle);

  const body = document.createElement("div");
  body.className = "tp-body";
  for (const c of checks) {
    const row = document.createElement("div");
    row.className = "tp-row";
    const badge = document.createElement("span");
    badge.className = "tp-badge " + (c.ok ? "tp-pass" : "tp-fail");
    badge.textContent = c.ok ? "PASS" : "FAIL";
    const name = document.createElement("span");
    name.className = "tp-name";
    name.textContent = c.name;
    row.appendChild(badge);
    row.appendChild(name);
    body.appendChild(row);
    if (c.detail) {
      const d = document.createElement("div");
      d.className = "tp-detail";
      d.textContent = c.detail;
      body.appendChild(d);
    }
  }

  const note = document.createElement("div");
  note.className = "tp-note";
  note.textContent = probeNote || "运行中…";
  body.appendChild(note);

  const verdict = document.createElement("div");
  verdict.className = "tp-verdict " + (allPass ? "ok" : "bad");
  verdict.textContent = allPass
    ? "全部通过 ✓ 截图本面板作为 TapTap 自测证据"
    : "存在失败项 ✗ 见上方 FAIL";
  body.appendChild(verdict);

  wrap.appendChild(head);
  wrap.appendChild(body);
  document.body.appendChild(wrap);

  head.addEventListener("click", () => {
    const collapsed = wrap.classList.toggle("tp-collapsed");
    toggle.textContent = collapsed ? "展开 ▸" : "收起 ▾";
  });
}

let probeNote = "";

// ---------- 仅 selftest 可见：设备镜像恢复自检 UI / 重载后验收（浏览器侧） ----------
// 以下函数仅引用浏览器全局（document / window / localStorage / location），且只在 IIFE 内被调用；
// 在 Node 导入本模块时 IIFE 被 guard 跳过，因此不会被触发。

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function addRecoveryButton() {
  const parent = (document.querySelector && document.querySelector("#taptap-probe .tp-body")) ||
    (document.getElementById && document.getElementById("taptap-probe"));
  if (!parent) return;
  const btn = document.createElement("button");
  btn.id = "tp-recovery-btn";
  btn.textContent = "测试设备备份恢复";
  btn.style.cssText = "margin-top:8px;width:100%;padding:6px 8px;background:#1d4e7a;color:#eaf4ff;" +
    "border:1px solid #2a6aa8;border-radius:6px;font:600 12px system-ui;cursor:pointer;";
  btn.addEventListener("click", onRecoveryButtonClick);
  parent.appendChild(btn);
}

async function onRecoveryButtonClick() {
  try {
    const sm = (typeof window !== "undefined") ? window.SaveManager : null;
    if (!sm || typeof sm._localMirror === "undefined") { window.alert("SaveManager 不可用"); return; }
    const detail = "本操作将：\n" +
      "• 仅删除主存档键 eve_idle_save\n" +
      "• 保留设备镜像（TapTap 本地文件备份）\n" +
      "• 保留云存档（TapTap 云存档）\n" +
      "• 随后自动重载页面，从设备镜像恢复\n\n是否继续？";
    if (!window.confirm(detail)) return;
    const plan = await mirrorRecoveryPlan({ saveManager: sm, cloud: sm._cloudSave, localStorage: window.localStorage });
    if (!plan.ok) { window.alert(plan.message || "无法执行设备备份恢复自检"); return; }
    try { window.localStorage.setItem(RECOVERY_PROBE_KEY, JSON.stringify(plan.record)); }
    catch (e) { window.alert("记录自检上下文失败：" + e); return; }
    mirrorRecoveryExecute({
      saveManager: sm,
      adapterKey: sm.adapter._key,
      localStorage: window.localStorage,
      location: window.location,
      record: plan.record
    });
  } catch (e) {
    window.alert("设备备份恢复自检异常：" + (e && e.message ? e.message : e));
  }
}

function waitBootTerminal(sm, timeoutMs) {
  return new Promise(function (resolve) {
    const deadline = Date.now() + (timeoutMs || 20000);
    (function poll() {
      const st = sm && typeof sm.getBootState === "function" ? sm.getBootState() : "";
      if (st === "ready" || st === "local-only" || st === "error") return resolve(st);
      if (Date.now() > deadline) return resolve(st || "timeout");
      setTimeout(poll, 200);
    })();
  });
}

function verifyRecovery(sm, rec, bootState) {
  const fails = [];
  if (!(bootState === "ready" || bootState === "local-only")) {
    fails.push("bootState=" + bootState + "（非 ready/local-only）");
  }
  const key = sm.adapter && sm.adapter._key;
  let mainBack = false;
  try { mainBack = window.localStorage.getItem(key) !== null; } catch (e) {}
  if (!mainBack) fails.push("重载后主存档键 " + key + " 未重新建立");
  const sel = sm._selectedEnvelope;
  if (!sel) {
    fails.push("_selectedEnvelope 为空（未应用候选）");
  } else {
    if (String(sel.checksum) !== String(rec.checksum)) {
      fails.push("checksum 不一致（恢复=" + sel.checksum + " / 记录=" + rec.checksum + "）");
    }
    if (Number(sel.revision) !== Number(rec.revision)) {
      fails.push("revision 不一致（恢复=" + sel.revision + " / 记录=" + rec.revision + "）");
    }
    if (Number(sel.savedAt) !== Number(rec.savedAt)) {
      fails.push("savedAt 不一致（恢复=" + sel.savedAt + " / 记录=" + rec.savedAt + "）");
    }
  }
  const mirror = sm._localMirror;
  if (!mirror || typeof mirror.isAvailable !== "function" || !mirror.isAvailable()) {
    fails.push("设备镜像重载后仍不可用");
  }
  return fails.length ? { pass: false, fails: fails } : { pass: true };
}

function showRecoveryResult(result) {
  const wrap = document.createElement("div");
  wrap.id = "taptap-recovery-result";
  wrap.style.cssText = "position:fixed;left:8px;top:8px;z-index:2147483001;max-width:320px;font:12px/1.5 system-ui;" +
    "color:#d7e3ef;background:rgba(10,18,30,.95);border:1px solid #1d2c3c;border-radius:10px;padding:10px 12px;" +
    "box-shadow:0 6px 24px rgba(0,0,0,.45);white-space:pre-wrap;";
  if (result.pass) {
    wrap.style.borderColor = "#1f7a4a";
    wrap.innerHTML = "<b style='color:#5fe39a'>PASS：已从设备镜像恢复</b>";
  } else {
    wrap.style.borderColor = "#7a1f1f";
    const ul = (result.fails || []).map(function (f) {
      return "<div style='color:#ff9a9a'>• " + escapeHtml(f) + "</div>";
    }).join("");
    wrap.innerHTML = "<b style='color:#ff8585'>FAIL：设备镜像恢复自检未通过</b>" + ul;
  }
  (document.body || document.documentElement).appendChild(wrap);
}

async function maybeRunRecoveryVerification() {
  let raw = null;
  try { raw = window.localStorage.getItem(RECOVERY_PROBE_KEY); } catch (e) {}
  if (!raw) return;
  let rec = null;
  try { rec = JSON.parse(raw); } catch (e) {}
  if (!rec) return;
  const sm = (typeof window !== "undefined") ? window.SaveManager : null;
  const bootState = await waitBootTerminal(sm, 20000);
  let result;
  try { result = verifyRecovery(sm, rec, bootState); } catch (e) {
    result = { pass: false, fails: ["verifyRecovery 抛错：" + (e && e.message ? e.message : e)] };
  }
  try { showRecoveryResult(result); } catch (e) {}
  // 验收结束后删除独立测试键，不污染正式存档。
  try { window.localStorage.removeItem(RECOVERY_PROBE_KEY); } catch (e) {}
}

// 浏览器侧逻辑（面板 / 按钮 / 重载验收）只在有 DOM 的环境执行；Node 导入本模块做机器测试时跳过。
if (typeof document !== "undefined" && typeof document.createElement === "function") {
(async () => {
  try {
    add("window 存在", typeof window !== "undefined");
    add("document 存在", typeof document !== "undefined");

    // DOM 创建 / 插入 / 删除
    try {
      const el = document.createElement("div");
      el.id = "taptap-probe-tmp";
      el.textContent = "x";
      document.body.appendChild(el);
      const inserted = !!document.getElementById("taptap-probe-tmp");
      document.body.removeChild(el);
      const removed = !document.getElementById("taptap-probe-tmp");
      add("DOM 创建/插入/删除", inserted && removed);
    } catch (e) {
      add("DOM 创建/插入/删除", false, String(e));
    }

    // localStorage 写入/读取/删除
    try {
      const t = "taptap_probe_tmp_" + Date.now();
      localStorage.setItem(t, "1");
      const r = localStorage.getItem(t);
      localStorage.removeItem(t);
      add("localStorage 写入/读取/删除", r === "1");
    } catch (e) {
      add("localStorage 写入/读取/删除", false, String(e));
    }

    // localStorage 跨刷新持久标记（独立键，不碰游戏存档）
    try {
      if (localStorage.getItem(PROBE_KEY)) {
        probeNote = "刷新后持久化成功：探针键已存在（可截图）";
        add("localStorage 跨刷新持久", true, probeNote);
      } else {
        localStorage.setItem(PROBE_KEY, "ok-" + Date.now());
        probeNote = "首次启动：已写入持久标记，请刷新页面复验";
        add("localStorage 跨刷新持久", true, probeNote + "（需刷新复验）");
      }
    } catch (e) {
      add("localStorage 跨刷新持久", false, String(e));
    }

    // ES Module 已执行（本文件即 module）
    add("ES Module 已执行", true);

    // importmap 中 "three" 可解析 + THREE 可导入
    let threeOk = false;
    let threeDetail = "";
    try {
      const THREE = await import("three");
      threeOk = !!(THREE && THREE.WebGLRenderer);
      threeDetail = THREE && THREE.REVISION ? "three r" + THREE.REVISION : "已导入但缺 WebGLRenderer";
    } catch (e) {
      threeDetail = String(e && e.message ? e.message : e);
    }
    add("importmap three 可解析 + THREE 可导入", threeOk, threeDetail);

    // Canvas WebGL / WebGL2 context
    let webglOk = false;
    let webglDetail = "";
    try {
      const c = document.createElement("canvas");
      const gl2 = c.getContext("webgl2");
      const gl1 = c.getContext("webgl");
      const gl = gl2 || gl1;
      webglOk = !!gl;
      webglDetail = gl ? (gl2 ? "webgl2" : "webgl") : "无可用 context";
    } catch (e) {
      webglDetail = String(e);
    }
    add("Canvas WebGL/WebGL2 context", webglOk, webglDetail);

    add("requestAnimationFrame", typeof requestAnimationFrame === "function");

    add("Blob", typeof Blob !== "undefined");
    try {
      const b = new Blob(["x"]);
      const u = URL.createObjectURL(b);
      URL.revokeObjectURL(u);
      add("URL.createObjectURL", true);
    } catch (e) {
      add("URL.createObjectURL", false, String(e));
    }

    let visOk = false;
    let visDetail = "";
    try {
      const h = () => {};
      document.addEventListener("visibilitychange", h);
      document.removeEventListener("visibilitychange", h);
      visOk = true;
    } catch (e) {
      visDetail = String(e);
    }
    add("visibilitychange 监听能力", visOk, visDetail);

    let buOk = false;
    let buDetail = "";
    try {
      const h = () => {};
      window.addEventListener("beforeunload", h);
      window.removeEventListener("beforeunload", h);
      buOk = true;
    } catch (e) {
      buDetail = String(e);
    }
    add("beforeunload 监听能力", buOk, buDetail);

    // 游戏主 DOM 已成功生成（静态节点存在 + 核心脚本已执行）
    let gameOk = false;
    let gameDetail = "";
    try {
      const dom = !!document.getElementById("current-activity");
      const booted = typeof window.TutorialState !== "undefined";
      gameOk = dom && booted;
      gameDetail = (dom ? "DOM✓" : "DOM✗") + " " + (booted ? "JS✓" : "JS✗");
    } catch (e) {
      gameDetail = String(e);
    }
    add("游戏主 DOM/脚本已生成", gameOk, gameDetail);

    buildPanel();
    try { addRecoveryButton(); } catch (e) {}
    maybeRunRecoveryVerification();
  } catch (e) {
    // 兜底：任何意外都不要影响游戏，仅尝试提示
    try {
      const pre = document.createElement("pre");
      pre.style.cssText =
        "position:fixed;right:8px;bottom:8px;z-index:2147483000;max-width:280px;color:#ff8585;" +
        "background:rgba(10,18,30,.95);border:1px solid #3a1414;border-radius:8px;padding:8px;font:11px monospace;white-space:pre-wrap;";
      pre.textContent = "探针异常：" + String(e && e.stack ? e.stack : e);
      document.body.appendChild(pre);
    } catch (_) {}
  }
})();
}
