/* 真实浏览器几何审计：手机端船坞「✎ 重命名」按钮是否留在可视区内（390×844）
   目的：证明两件事
     ① 修复后按钮在 16 字中文自定义名下仍完整落在视口内（右边缘 ≤ 视口宽）；
     ② 去掉 min-width:0 加固后（旧 CSS）长舰名会把按钮挤出屏幕 —— 即该加固不是装饰。
   做法：用真实生产 CSS 文本 + 探针从生产渲染器导出的真实 HTML（非手写 mock），
        在 headless Chrome 里按 390×844 量 getBoundingClientRect。
   零依赖：Node 22 内置 WebSocket + fetch 直连 CDP。
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { spawnSync } from "./lib/safe-spawn.mjs";

const REPO = "D:/EVE-IDLE/EVEIDLE-WORKBUDDY-FRESH";
const PORT = 9334;
// 自建临时目录 + 用探针从「生产渲染器」导出真实 HTML（禁止手写 mock）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "eve-portrait-layout-"));
const DUMPER = path.join(REPO, "tools/_probe_portrait_rename.mjs");
const NODE_EXE = process.execPath;
function dump(name, extraEnv) {
  const out = path.join(TMP, name);
  const env = Object.assign({}, process.env, { DUMP_HTML: out }, extraEnv || {});
  const r = spawnSync(NODE_EXE, [DUMPER], { cwd: REPO, env, encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(out)) throw new Error("dump 失败 " + name + " :: " + (r.stderr || "").slice(0, 400));
  return out;
}
dump("short.html", {});
dump("long.html", { DUMP_LONG_NAME: "1" });
dump("ascii.html", { DUMP_ASCII_NAME: "1" });
const CHROME = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
  : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const cssFull = fs.readFileSync(path.join(REPO, "css/taptap-portrait.css"), "utf8");
// 旧 CSS = 去掉本次 min-width:0 加固（模拟修复前的 flex 收缩行为）
const cssOld = cssFull
  .replace(/flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; /g, "")
  .replace(/flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;/g, "");
if (cssOld === cssFull) { console.error("FAIL: 未能构造旧 CSS（加固规则未匹配）"); process.exit(1); }

const longHtml = fs.readFileSync(path.join(TMP, "long.html"), "utf8");
const shortHtml = fs.readFileSync(path.join(TMP, "short.html"), "utf8");
const asciiHtml = fs.readFileSync(path.join(TMP, "ascii.html"), "utf8");

function page(innerHtml, css) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style>
<style>html,body{margin:0;padding:0;background:#0a121e;width:390px;overflow-x:hidden}
#hangar-panel{display:flex;flex-direction:column;width:390px;min-height:844px}</style>
</head><body><div id="hangar-panel"><div class="tp-hangar-root" id="tp-hangar-root" style="display:block">${innerHtml}</div></div></body></html>`;
}

const cases = [
  { key: "long+新CSS", file: "case_long_new.html", html: page(longHtml, cssFull), expectInside: true },
  { key: "long中文+旧CSS", file: "case_long_old.html", html: page(longHtml, cssOld), expectInside: true },
  { key: "short+新CSS", file: "case_short_new.html", html: page(shortHtml, cssFull), expectInside: true },
  // 不可断行长串（ASCII 无空格）：flex min-width:auto = min-content = 整串 ⇒ 旧 CSS 会被挤出视口
  { key: "ascii长串+新CSS", file: "case_ascii_new.html", html: page(asciiHtml, cssFull), expectInside: true },
  { key: "ascii长串+旧CSS", file: "case_ascii_old.html", html: page(asciiHtml, cssOld), expectInside: false }
];
for (const c of cases) fs.writeFileSync(path.join(TMP, c.file), c.html, "utf8");

/* ---------- CDP ---------- */
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-portrait-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--no-sandbox",
  "--hide-scrollbars", "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("devtools 未就绪");
}

let ws = null, msgId = 0;
const pending = new Map();
function send(method, params) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params: params || {} }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

async function measure(url) {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const sock = new WebSocket(t.webSocketDebuggerUrl);
  const local = { id: 0 };
  const pend = new Map();
  sock.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id).res(m); pend.delete(m.id); }
  });
  await new Promise((res, rej) => {
    sock.addEventListener("open", res);
    sock.addEventListener("error", rej);
  });
  const send2 = (method, params) => {
    const id = ++local.id;
    sock.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((res) => pend.set(id, { res }));
  };
  await send2("Page.enable");
  await send2("Runtime.enable");
  await send2("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  const ev = await send2("Runtime.evaluate", {
    expression: `(function(){
      var b = document.querySelector('.tp-rename-btn');
      if (!b) return JSON.stringify({found:false});
      var r = b.getBoundingClientRect();
      var h = document.querySelector('.tp-hangar-main-head');
      var hr = h ? h.getBoundingClientRect() : null;
      var n = document.querySelector('.tp-hangar-name');
      var nr = n ? n.getBoundingClientRect() : null;
      return JSON.stringify({
        found:true,
        docW: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
        btn: {left:Math.round(r.left), right:Math.round(r.right), top:Math.round(r.top), width:Math.round(r.width), height:Math.round(r.height)},
        head: hr ? {left:Math.round(hr.left), right:Math.round(hr.right), width:Math.round(hr.width)} : null,
        name: nr ? {left:Math.round(nr.left), right:Math.round(nr.right), width:Math.round(nr.width)} : null
      });
    })()`,
    returnByValue: true
  });
  sock.close();
  return JSON.parse(ev.result.result.value);
}

const results = [];
try {
  await waitForDevtools();
  for (const c of cases) {
    const url = "file:///" + path.join(TMP, c.file).replace(/\\/g, "/");
    const m = await measure(url);
    const inside = m.found && m.btn.right <= m.docW && m.btn.left >= 0 && m.btn.width > 0;
    const ok = inside === c.expectInside;
    results.push({ key: c.key, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.key}  found=${m.found} 视口=${m.docW} 按钮=[${m.btn.left},${m.btn.right}] w=${m.btn.width} 舰名区=[${m.name && m.name.left},${m.name && m.name.right}] 期望在可视区内=${c.expectInside} 实际=${inside}`);
  }
} catch (e) {
  console.error("HARNESS ERROR:", e && e.message);
  results.push({ key: "harness", ok: false });
} finally {
  try { chrome.kill(); } catch (e) {}
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
const failed = results.filter(r => !r.ok);
console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
