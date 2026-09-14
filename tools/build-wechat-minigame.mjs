/**
 * 微信小游戏构建（P4 最小版 · 仅用于真实体积门禁 + 工具链验证）
 *
 * 用法：
 *   node tools/build-wechat-minigame.mjs                     # 构建到默认输出目录
 *   node tools/build-wechat-minigame.mjs --out <DIR>         # 指定输出目录
 *   node tools/build-wechat-minigame.mjs --dry               # 只出清单不落盘
 *
 * 设计边界（硬约束）：
 *   ⛔ 只读源仓库，绝不修改 index.html / tools/build-taptap-h5.mjs / 逻辑层任何文件。
 *   ⛔ 输出目录必须在仓库外（默认 D:/EVE-IDLE/WECHAT-MINIGAME，与 TAPTAP-H5-OUTPUT 同级）。
 *   ⛔ 不碰 TapTap / Steam 的任何构建产物。
 *
 * 体积口径（2026-09-13 实测钉死，勿再按 gzip 估）：
 *   微信「代码包大小」= **未压缩的原始文件字节总和**。zip/gzip 完全不计。
 *   实测：向 demo 包塞入 2,000,000 B 纯文本 → 官方报告正好 +2,000,000 B。
 *   ⇒ 本脚本打印 raw 字节和，与 CLI 报告应逐字节对上（差 <1KB 为容器开销）。
 *
 * 包结构（3 包，总上限 30MB）：
 *   main         game.js/game.json + wx/ + js/**（排除 3D 两项）
 *   sub3d        js/vendor/**  + js/render3d/**
 *   subassets    assets/**     + demo-assets/**
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes("--dry");
const OUT = path.resolve(
  argOf("--out") || process.env.WX_MINIGAME_OUT || "D:/EVE-IDLE/WECHAT-MINIGAME"
);

const KB = (b) => (b / 1024).toFixed(1) + " KB";
const MB = (b) => (b / 1048576).toFixed(2) + " MB";

// ---------- 分包归属判定（唯一真值） ----------
const PKG = { MAIN: "main", SUB3D: "sub3d", SUBASSETS: "subassets" };
function pkgOf(rel) {
  const p = rel.replace(/\\/g, "/");
  if (p.startsWith("js/vendor/") || p.startsWith("js/render3d/")) return PKG.SUB3D;
  if (p.startsWith("assets/") || p.startsWith("demo-assets/")) return PKG.SUBASSETS;
  if (p.startsWith("js/")) return PKG.MAIN;
  return PKG.MAIN;
}

// 子包根目录前缀（相对项目根）
const SUBROOT = { [PKG.SUB3D]: "sub3d/", [PKG.SUBASSETS]: "subassets/" };

// ---------- 1. 从 index.html 抽有序脚本清单（权威加载顺序） ----------
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const ordered = [];
for (const m of html.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
  const rel = m[1].replace(/[?#].*$/, "").replace(/^\.\//, "");
  if (rel.startsWith("js/") && !ordered.includes(rel)) ordered.push(rel);
}

// ---------- 2. 目录兜底扫（index.html 会漏掉运行时动态加载的文件） ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (e.isFile()) out.push(path.relative(ROOT, abs).replace(/\\/g, "/"));
  }
  return out;
}
const allJs = walk(path.join(ROOT, "js"));
// ⚠️ 已知：js/ui/ship3d.js 走动态 import()，js/vendor/three.core.js 被 three.module.js 内部引用
//    ⇒ 两者都不出现在 index.html 的 <script src> 里，必须靠扫目录补回。
const extraJs = allJs.filter((f) => !ordered.includes(f)).sort();

const bootOrder = [...ordered, ...extraJs];

// ---------- 3. 组装文件清单 ----------
const files = []; // {rel, abs, pkg, outRel}
const add = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
  const pkg = pkgOf(rel);
  files.push({ rel, abs, pkg, outRel: (SUBROOT[pkg] || "") + rel, size: fs.statSync(abs).size });
  return true;
};

for (const rel of bootOrder) add(rel);
for (const rel of walk(path.join(ROOT, "assets"))) add(rel);
for (const rel of walk(path.join(ROOT, "demo-assets"))) add(rel);

// ---------- 4. 统计 ----------
const byPkg = {};
for (const f of files) {
  byPkg[f.pkg] = byPkg[f.pkg] || { n: 0, bytes: 0 };
  byPkg[f.pkg].n++;
  byPkg[f.pkg].bytes += f.size;
}
const totalBytes = files.reduce((s, f) => s + f.size, 0);

console.log(`源仓库   : ${ROOT}`);
console.log(`输出目录 : ${OUT}${DRY ? "   (--dry 不落盘)" : ""}`);
console.log(`\n落地文件 : ${files.length} 个`);
console.log(`index.html 有序脚本 : ${ordered.length} 个`);
console.log(`目录扫描补回       : ${extraJs.length} 个  ${extraJs.length ? "(" + extraJs.slice(0, 6).join(", ") + (extraJs.length > 6 ? " …" : "") + ")" : ""}`);

console.log("\n=== 三包「磁盘原始字节」（⚠️ 不是微信口径，见下）===");
console.log("   ⚠️ 微信对 JS 会先剥离注释/空白再计，非 JS 资源（png/txt/ttf）才逐字节计。");
console.log("      故本表对 main 会**显著高估**（实测约 5.0MB → 官方 2.69MB），subassets 基本准。");
console.log("      ⛔ 不要用本表判断是否超 4MB；权威数字只能来自");
console.log("         cli.bat preview --project <OUT> --preview-info-output <out.json>");
for (const k of [PKG.MAIN, PKG.SUB3D, PKG.SUBASSETS]) {
  const v = byPkg[k] || { n: 0, bytes: 0 };
  const limit = k === PKG.MAIN ? ` / 4MB 上限  原始余量 ${MB(4194304 - v.bytes)} (${(((4194304 - v.bytes) / 4194304) * 100).toFixed(0)}%)  ⚠️非微信口径` : " / 不限";
  console.log(`  ${k.padEnd(11)} ${String(v.n).padStart(4)} 个  ${MB(v.bytes).padStart(9)}  ${KB(v.bytes).padStart(11)}${limit}`);
}
console.log(`  ${"合计".padEnd(11)} ${String(files.length).padStart(4)} 个  ${MB(totalBytes).padStart(9)}  ${KB(totalBytes).padStart(11)} / 30MB 上限`);

// ---------- 5. 落盘 ----------
if (!DRY) {
  if (path.resolve(OUT).startsWith(path.resolve(ROOT))) {
    console.error("\n❌ 输出目录在仓库内，拒绝执行（会污染 git）：" + OUT);
    process.exit(1);
  }
  // 5.1 清旧构建产物（保留 IDE 拥有的 project.*.json）
  for (const d of ["js", "assets", "demo-assets", "wx", "sub3d", "subassets", "css", "images", "audio"]) {
    fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  }
  for (const f of ["game.js", "game.json", "README.md", ".eslintrc.js"]) {
    fs.rmSync(path.join(OUT, f), { force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  // 5.2 拷贝
  let copied = 0;
  for (const f of files) {
    const dest = path.join(OUT, f.outRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f.abs, dest);
    copied++;
  }

  // 5.2b 运行时 shim（源在 tools/wechat/shim.js，不进主仓库 js/）
  const shimSrc = path.join(__dirname, "wechat", "shim.js");
  if (fs.existsSync(shimSrc)) {
    fs.mkdirSync(path.join(OUT, "wx"), { recursive: true });
    fs.copyFileSync(shimSrc, path.join(OUT, "wx", "shim.js"));
  } else {
    console.warn("⚠️ 缺少 tools/wechat/shim.js，产物将无法加载");
  }

  // 5.3b 分包入口：微信小游戏强制要求「每个分包 root 下必须有 game.js」
  //      （实测报错：未找到 ["subpackages"][0]["root"] 对应的 /sub3d/game.js 文件）
  //      ⚠️ 小程序分包无此要求，这是小游戏专属约束。
  for (const root of Object.values(SUBROOT)) {
    const p = path.join(OUT, root);
    if (!fs.existsSync(p)) continue;
    fs.writeFileSync(path.join(p, "game.js"),
      "/* 分包入口占位：微信小游戏要求每个分包 root 必须有 game.js。本分包仅供主包 require，不做独立启动。 */\nmodule.exports = {};\n");
  }

  // 5.3 入口 + 分包配置
  fs.writeFileSync(path.join(OUT, "game.json"), JSON.stringify({
    deviceOrientation: "portrait",
    subpackages: [
      { name: "sub3d", root: "sub3d/" },
      { name: "subassets", root: "subassets/" },
    ],
  }, null, 2) + "\n");

  const requires = bootOrder
    .filter((r) => pkgOf(r) === PKG.MAIN && fs.existsSync(path.join(ROOT, r)))
    .map((r) => `  require("./${r}");`)
    .join("\n");
  fs.writeFileSync(path.join(OUT, "game.js"), `require("./wx/shim.js");\nrequire("./wx/boot.js");\n`);
  fs.writeFileSync(path.join(OUT, "wx", "boot.js"), `/* 自动生成，勿手改：tools/build-wechat-minigame.mjs 从 index.html 抽取加载顺序 */
/* ⚠️ P4 探针版：逐文件 require（各自独立作用域）。
   S1 必须改为「单作用域合并包」——浏览器 <script> 共享全局词法环境，
   逐文件 require 会隔离顶层 const/let，跨文件引用会断。 */
module.exports = function boot() {
${requires}
};
`);

  // 5.4 project.config.json：只 patch setting，保留 appid / projectname
  const pcPath = path.join(OUT, "project.config.json");
  let pc = { compileType: "game", libVersion: "latest" };
  if (fs.existsSync(pcPath)) { try { pc = JSON.parse(fs.readFileSync(pcPath, "utf8")); } catch {} }
  pc.appid = pc.appid || "wx0b109424d84cc731";
  pc.compileType = "game";
  pc.projectname = "deep-space-frontier-wechat";
  pc.setting = Object.assign({}, pc.setting, {
    urlCheck: false, es6: true, postcss: false, minified: true, newFeature: true,
    uploadWithSourceMap: false, minifyWXSS: false, minifyWXML: false,
  });
  fs.writeFileSync(pcPath, JSON.stringify(pc, null, 2) + "\n");

  console.log(`\n✅ 已写入 ${copied} 个文件 → ${OUT}`);
  console.log(`   落盘磁盘原始字节和 = ${totalBytes} B  (${MB(totalBytes)})   ⚠️ 非微信口径（JS 会被剥离注释/空白）`);
  console.log(`\n⚠️ 下一步跑 CLI 前必须等待 3~5 秒：开发者工具的文件索引有滞后，`);
  console.log(`   刚写完就 preview 会误报「未找到分包 game.js / 文件不存在」。`);
  console.log(`   preview 命令（注意旗标名，不是 --info-output）：`);
  console.log(`     cli.bat preview --project "${OUT}" --preview-info-output <out.json>`);
}

// ---------- 6. 复查：落盘文件真有这么多字节吗（防止拷贝漏/截断） ----------
if (!DRY) {
  let onDisk = 0, n = 0;
  for (const f of files) {
    const p = path.join(OUT, f.outRel);
    if (!fs.existsSync(p)) { console.log(`   ⚠️ 缺失: ${f.outRel}`); continue; }
    onDisk += fs.statSync(p).size; n++;
  }
  for (const f of ["game.js", "game.json", "wx/boot.js", "wx/shim.js"]) {
    const p = path.join(OUT, f);
    if (fs.existsSync(p)) { onDisk += fs.statSync(p).size; n++; }
  }
  console.log(`   复查落盘: ${n} 个 / ${onDisk} B  ${onDisk === totalBytes || n > files.length ? "(已含入口文件)" : "⚠️ 与清单不一致"}`);
}
