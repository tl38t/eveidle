// ================================================================
// 无头 Chrome 运行 tools/station-browser-test.html 并返回 EXIT CODE。
// 起本地静态服务（iframe 需同源可访问 contentWindow，file:// 不行），
// 用真实浏览器加载真实 index.html，跑真实 DOM / 真实点击用例。
//   EXIT 0 = RESULT=PASS；EXIT 1 = 有 FAIL/SKIP 或未跑完；EXIT 2 = 找不到浏览器。
// 用法：node tools/run-station-browser-test.mjs [--keep-log]
// ================================================================
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".webp": "image/webp"
};

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

const browser = BROWSERS.find(p => { try { return existsSync(p); } catch { return false; } });
if (!browser) {
  console.error("未找到 Chrome/Edge 可执行文件；可用 CHROME_PATH 环境变量指定。");
  process.exit(2);
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(String(req.url).split("?")[0]);
    let file = normalize(join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("403"); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { res.writeHead(404); res.end("404"); return; }
    const buf = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(buf);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/tools/station-browser-test.html?autorun=1`;
const profile = await mkdtemp(join(tmpdir(), "eveidle-station-test-"));

console.log("浏览器：" + browser);
console.log("测试页：" + url);

const args = [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-timer-throttling",
  "--use-gl=swiftshader", "--enable-unsafe-swiftshader",
  `--user-data-dir=${profile}`, "--virtual-time-budget=60000",
  "--dump-dom", url
];

const dom = await new Promise(resolve => {
  const child = spawn(browser, args, { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", d => { out += d.toString("utf8"); });
  child.stderr.on("data", () => {});
  const killer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 180000);
  child.on("close", () => { clearTimeout(killer); resolve(out); });
  child.on("error", () => { clearTimeout(killer); resolve(out); });
});

server.close();
await rm(profile, { recursive: true, force: true }).catch(() => {});

const text = dom.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "\n"); // 去掉脚本源码，避免格式串被误判为失败行
const line = s => { const m = text.match(s); return m ? m[0].trim() : null; };
const summary = line(/==== 结果: PASS=\d+ FAIL=\d+ SKIP=\d+ 总共=\d+ ====/);
const errLine = line(/控制台错误: \d+ 页面错误: \d+ 未捕获rejection: \d+ 资源错误: \d+/);

if (!dom.includes("AUTORUN_DONE")) {
  console.error("测试未跑完（页面未产生 AUTORUN_DONE 标记）。");
  if (summary) console.error(summary);
  process.exit(1);
}

// 逐条回显失败项，便于定位
for (const m of text.matchAll(/❌[^\n]+/g)) console.log(m[0].trim());
for (const m of text.matchAll(/✅ P\d[^\n]+/g)) console.log(m[0].trim());
if (errLine) console.log(errLine);
if (summary) console.log(summary);

const passed = text.includes("RESULT=PASS");
console.log(passed ? "★ RESULT=PASS" : "RESULT=FAIL");
process.exit(passed ? 0 : 1);
