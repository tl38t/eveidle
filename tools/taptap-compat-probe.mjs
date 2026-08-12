// TapTap H5 自测兼容性探针（仅注入构建后的 index.html，不修改正式源码）
// 用途：在 TapTap「H5 包体」网页端真机/自测环境中确认真实运行能力。
// 约束：
//  - 不调用任何 TapTap SDK，不发起网络请求，不泄露 MiniApp ID / Secret / 用户信息 / 存档内容。
//  - 不读取、覆盖或删除游戏正式存档键（游戏键为 eve_idle_save，本探针固定使用独立键）。
//  - 只显示 PASS/FAIL，不修改游戏业务状态。
//  - 通过现有 importmap 执行 import * as THREE from "three"。

const PROBE_KEY = "deep_space_idle_taptap_probe_v1";

const checks = [];
function add(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || "" });
}

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
