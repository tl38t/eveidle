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
 *
 * 加载模型（2026-09-14 定稿）：单作用域合并包
 *   浏览器里所有 classic <script> 共享同一全局词法环境；微信把每个文件包进
 *   function(module, exports, require){…}，顶层 const/let 立刻跨文件不可见 ⇒ 裸引用全断。
 *   故把 index.html 有序 classic 脚本（按加载顺序）**逐字节拼成单个 logic.bundle.js（主包根目录）**，
 *   恢复「一个文件 = 一个作用域」的浏览器语义。合并后的源文件不再单独落盘（否则主包翻倍）。
 *   例外（留在模块体系外逐文件 require）：ESM 文件、以及内部调用相对路径 require() 的文件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { maskCode, findOps, downlevelSource } from "./wechat/es5-downlevel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes("--dry");
const NO_MINIFY = argv.includes("--no-minify"); // 仅排查用；正式产物必须压缩（否则主包超 4MB）
let es5Delta = 0;         // 5.4 降级给**非合并包**文件加的字节数（供第 6 步复查对账）
let bundleEs5Delta = 0;   // 5.4 给 logic.bundle.js 加的字节数。单独记账：该文件最终尺寸由 5.5 决定，
                          //                   混进 es5Delta 会让第 6 步的对账在「压缩覆盖了降级增量」时误报
let bundleFinalSize = null; // 5.5 压缩后 logic.bundle.js 的盘上真实字节；未跑 5.5 时保持 null
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

// ---------- 2a. 微信端排除清单（唯一真值） ----------
// 这几个文件**不进任何包**（既不入合并包、也不单独落盘）。
// 逐项可排除的依据（2026-09-15 已核源码，勿凭印象增删）：
//   · js/i18n/catalog-en.js / js/i18n/catalog-zh-TW.js
//       词典用**属性赋值**发布（`window.I18N_CATALOG_EN = new Map([...])`），不是裸变量；
//       全仓只有 js/i18n/translator.js:32 读它，且写法自带兜底：`window.I18N_CATALOG_EN || new Map()`；
//       translator.js:43 又是 `catalogs[locale] || new Map()`、:72 判定 `locale === "zh-CN"` 时
//       **直接 return、根本不查词典** ⇒ 缺失即优雅降级为空 Map，**简中零影响**。
//       ⚠️ 已接受的副作用：微信端设备语言若为 en / zh-TW，会看到原文（中文），功能不坏。
//       ⇒ 单/双本合计约 1.08 MB，曾占 bundle 21.7%，且是当时**增速最快**的一项。
//   · js/qa-seed.js —— 开发期 QA 种子（index.html 里 defer 引入），不该进玩家包。
// ⛔ 不要把它当成「清理演示件」的入口：assets/ 与 demo-assets/ 里全是**生产**资源
//    （js/ui/wormhole-map.js 硬引用 ./demo-assets/wormhole-map-bg.png），删了会破图。
const WX_EXCLUDE = new Set([
  "js/i18n/catalog-en.js",
  "js/i18n/catalog-zh-TW.js",
  "js/qa-seed.js",
]);
const bootOrderAll = [...ordered, ...extraJs];
const excludedFiles = bootOrderAll.filter((r) => WX_EXCLUDE.has(r));
const bootOrder = bootOrderAll.filter((r) => !WX_EXCLUDE.has(r));
// 清单里写了要排除、但仓库里根本没有 ⇒ 说明清单已过期，必须显式报警（禁静默）
const excludeStale = [...WX_EXCLUDE].filter((r) => !fs.existsSync(path.join(ROOT, r)));

// ---------- 2b+. 微信小游戏无法运行的模块 stub 化 ----------
// 这些模块在浏览器/TapTap 里依赖 WebGL / importmap / ESM 动态导入；微信小游戏无这些能力，
// 加载它们会抛 SyntaxError / "module is not defined" 红字。构建期直接替换成空实现，
// 让 boot.js 的容错加载成功通过，避免噪声掩盖真正的致命错误。
// 2026-09-15 已核：主游戏逻辑（采集/战斗/生产/星图/军团等）不依赖下列模块。
const WX_STUB = new Set([
  // 3D 渲染入口（微信小游戏无 WebGL/importmap）
  "js/ui/ship3d-loader.js",
  "js/ui/ship3d.js",
  "js/ui/titan-forge-3d.js",
  "js/ship-lab.js",
  "js/three-demo.js",
  // 排行榜模块（TapTap 排行榜未在微信小游戏接入；ESM/require 混合会抛红字）
  "js/data/leaderboard.js",
  "js/ui/leaderboard-render.js",
  "js/core/leaderboard-sync-service.js",
]);
const wxStubBody = (rel) => `/* 自动生成，勿手改：tools/build-wechat-minigame.mjs
 * 微信小游戏无 WebGL/importmap，${rel} 无法运行，已替换为空实现。
 * 主游戏逻辑不依赖此模块；浏览器/TapTap/Steam 版本保持原文件不变。 */
module.exports = {};
`;

// ---------- 2b. 主包脚本三分类（单作用域合并包） ----------
// 为什么必须合并：浏览器里所有 classic <script> 共享同一个全局词法环境，跨文件裸标识符可读；
// 微信把每个文件包进 function(module, exports, require){…}，顶层 const/let/function 立刻互相
// 不可见 ⇒ 跨文件裸引用全部静默 fallback 或 ReferenceError。
// 解法不是逐名补 window 挂载，而是**恢复浏览器的真实执行语义**：按加载顺序把 classic 脚本
// 拼成单个文件，于是「一个文件 = 一个作用域」，与浏览器同构，且未来新增跨文件引用天然正确。
// 两类文件必须留在模块体系外，不参与拼接：
//   ① ESM（含 import/export）—— 本就靠真模块系统加载；
//   ② 文件内做了**相对路径动态加载**的（require(…)/import(…)）—— 拼接后该路径的解析基准
//      会从原目录变成 wx/，必然取不到（它们都是自包含 IIFE）。
const readSrc = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const isEsmFile = (rel) => /^\s*(import|export)\s/m.test(readSrc(rel));
// ESM 文件拷贝到微信包时，必须把 import/export 里的 `?v=N` cache-buster 剥掉：
// 微信小游戏把 ESM 转译成 CommonJS 后按字面路径 require，带 `?v=2` 会找不到文件。
// （CSS 的 cache-buster 在 3a 已剥；这里补 ESM import/export 的。）
function stripEsmCacheBusters(src) {
  return src
    // static import/export: from "...?v=N"
    .replace(/(\bfrom\s+["'])([^"']+)(\?[^"']+)(["'])/g, "$1$2$4")
    // bare import "...?v=N"
    .replace(/(\bimport\s+["'])([^"']+)(\?[^"']+)(["'])/g, "$1$2$4")
    // dynamic import("./x?v=N")  —— group4 已包含右引号+右括号，不要额外加 )
    .replace(/(\bimport\s*\(\s*["'])([^"']+)(\?[^"']+)(["']\s*\))/g, "$1$2$4")
    // export * from "...?v=N" / export { x } from "...?v=N"
    .replace(/(\bexport\s+[^"']*?from\s+["'])([^"']+)(\?[^"']+)(["'])/g, "$1$2$4");
}

// 微信小游戏没有 <script type="importmap">，ESM 里的 import/export specifier 必须
// 全部映射为包内真实相对路径。这里处理：
//   1) 裸包名 "three" / "three/addons/..." → js/vendor/... 实际文件；
//   2) 相对路径 "./x" / "../x" → 按产物分包位置重新计算（例如主包 js/ui/ship3d.js
//      引用 ../render3d/... 的目标实际在 sub3d 分包，需要写成 ../../sub3d/js/render3d/...）。
function resolveModulePath(targetRel, fromRel, fromPkg) {
  const targetPkg = pkgOf(targetRel);
  if (fromPkg === targetPkg) {
    const fromDir = path.dirname(fromRel).replace(/\\/g, "/");
    let relPath = path.relative(fromDir, targetRel).replace(/\\/g, "/");
    // 同目录或子目录时 path.relative 会丢掉 "./" 前缀，但 ESM 需要它才不是裸包名。
    if (relPath && !relPath.startsWith("../") && !relPath.startsWith("/") && relPath !== ".") {
      relPath = "./" + relPath;
    }
    return relPath;
  }
  const fromDir = path.dirname(fromRel).replace(/\\/g, "/");
  const up = path.relative(fromDir, ".").replace(/\\/g, "/") || ".";
  const prefix = (SUBROOT[targetPkg] || "").replace(/\/$/, "");
  if (up === ".") return `${prefix}/${targetRel}`;
  return `${up}/${prefix}/${targetRel}`;
}
function resolveSpecToTargetRel(spec, fromRel) {
  // 裸包名 three（与 index.html importmap 同目标）
  if (spec === "three") return "js/vendor/three.module.js";
  if (spec.startsWith("three/addons/")) return `js/vendor/addons/${spec.slice("three/addons/".length)}`;
  // 相对路径：先还原为仓库根相对路径
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const fromDir = path.dirname(fromRel);
    const abs = path.resolve(ROOT, fromDir, spec);
    return path.relative(ROOT, abs).replace(/\\/g, "/");
  }
  return null; // 其他裸包名保持原样（如 taptap-leaderboard-provider 里的相对 require 已处理）
}
function remapEsmImports(src, rel, pkg) {
  const fromDir = path.dirname(rel).replace(/\\/g, "/");
  function resolveSpec(spec) {
    const targetRel = resolveSpecToTargetRel(spec, rel);
    if (!targetRel) return spec;
    return resolveModulePath(targetRel, rel, pkg);
  }
  return src
    .replace(/(\bfrom\s+["'])([^"']+)(["'])/g, (_, a, s, b) => `${a}${resolveSpec(s)}${b}`)
    .replace(/(\bimport\s+["'])([^"']+)(["'])/g, (_, a, s, b) => `${a}${resolveSpec(s)}${b}`)
    .replace(/(\bimport\s*\(\s*["'])([^"']+)(["']\s*\))/g, (_, a, s, b) => `${a}${resolveSpec(s)}${b}`)
    .replace(/(\bexport\s+[^"']*?from\s+["'])([^"']+)(["'])/g, (_, a, s, b) => `${a}${resolveSpec(s)}${b}`);
}
// ⚠️ 必须区分「动态加载调用」与「名为 import 的类/对象方法定义」（如 persistence.js 的
//    `import(jsonString) { … }`）与属性访问 `this.adapter.import(…)`。判据：排除注释行、
//    排除前面带 `.`/标识符字符，且排除「闭括号紧跟 {」（= 方法定义）。
const usesRuntimeRequire = (rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const re = /(?<![.\w$])(?:require|import)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    if (/^\s*(?:\/\/|\*|\/\*)/.test(src.slice(lineStart, m.index))) continue;
    if (/^[^)\n]*\)\s*\{/.test(src.slice(re.lastIndex))) continue; // 方法定义，非加载
    return true;
  }
  return false;
};

const mainJs = bootOrder.filter((r) => {
  if (pkgOf(r) !== PKG.MAIN) return false;
  const abs = path.join(ROOT, r);
  return fs.existsSync(abs) && fs.statSync(abs).isFile();
});
const mainEsm = mainJs.filter(isEsmFile);
const mainDeferred = mainJs.filter((r) => !isEsmFile(r) && usesRuntimeRequire(r));

// ---------- 2c. 运行时相对加载的「目标文件」必须保持原路径可 require ----------
// 那几个 deferred 文件在运行期做相对加载（require("./x.js") / import("./x.js")），所以它们
// 被排除在合并包外、路径基准不变、照常可用。但它们的**目标文件**若被合并进 bundle，
// 原路径就没有文件了 ⇒ 运行期加载失败。目标分两类处理：
//   · 目标自身是自包含 UMD（0 个顶层声明：js/data/legion/npc-*.js、js/platform/ad-platform-config.js）
//     ⇒ 从 bundle 移出、原样单独落盘（不损失任何顶层名字，单作用域不受影响）；
//   · 目标含顶层声明（js/data/ships.js：14 个名字、被 12 个文件裸引用）
//     ⇒ 必须留在 bundle（否则单作用域塌陷），并在原路径生成「转发桩」，
//       由合并包末尾发布的 __WX_FILE_EXPORTS__ 取到**同一实例**（不复制第二份真值）。
const topLevelDeclsOf = (rel) => {
  const out = [];
  for (const ln of fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/)) {
    if (/^\s/.test(ln)) continue;
    let m;
    if ((m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(ln))) out.push(m[1]);
    else if ((m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(ln))) out.push(m[1]);
    else if ((m = /^class\s+([A-Za-z_$][\w$]*)/.exec(ln))) out.push(m[1]);
  }
  return [...new Set(out)];
};
const REL_SPEC_RE = /(?<![.\w$])(?:require|import)\s*\(\s*["']([^"']+)["']/g;
const runtimeTargets = new Set();
function collectTargets(rel, depth) {
  if (depth > 8) return;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
  const src = fs.readFileSync(abs, "utf8");
  REL_SPEC_RE.lastIndex = 0;
  let m;
  while ((m = REL_SPEC_RE.exec(src)) !== null) {
    const spec = m[1].split("?")[0].split("#")[0];
    if (!spec.startsWith(".")) continue; // 裸包名：微信走 npm，不在本脚本职责内
    let p = path.resolve(path.dirname(abs), spec);
    if (!fs.existsSync(p) && fs.existsSync(p + ".js")) p += ".js";
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
    const t = path.relative(ROOT, p).replace(/\\/g, "/");
    if (runtimeTargets.has(t)) continue;
    runtimeTargets.add(t);
    collectTargets(t, depth + 1);
  }
}
for (const rel of mainDeferred) collectTargets(rel, 0);
const bundledTargets = [...runtimeTargets]
  .filter((t) => !mainEsm.includes(t) && !mainDeferred.includes(t));
const unbundleTargets = new Set(bundledTargets.filter((t) => topLevelDeclsOf(t).length === 0));
const forwardTargets = bundledTargets.filter((t) => !unbundleTargets.has(t));
const forwarderStubs = new Map();
for (const t of forwardTargets) {
  forwarderStubs.set(t, `/* 自动生成，勿手改：tools/build-wechat-minigame.mjs
   本文件已并入 logic.bundle.js（主包根）的单作用域；此处仅为「运行时 require」提供转发，
   使其拿到**同一实例**（不复制状态、不产生第二份真值）。
   名字来源：合并包末尾发布的 globalThis.__WX_FILE_EXPORTS__。 */
var __wxe = (typeof globalThis !== "undefined" ? globalThis : this).__WX_FILE_EXPORTS__;
module.exports = (__wxe && __wxe[${JSON.stringify(t)}]) || {};
if (!__wxe) console.warn("[wx] 转发桩在合并包之前被加载：${t}");
`);
}

const concatList = mainJs.filter((r) => !isEsmFile(r) && !usesRuntimeRequire(r) && !unbundleTargets.has(r));
const concatSet = new Set(concatList);
const nonConcat = mainJs.filter((r) => !concatSet.has(r));

// ---------- 2d. 全局桥：非合并模块实际引用到的经典层名字 ----------
// 未参与合并的文件（ESM / 运行时相对加载）各自独立作用域，读经典层符号只能走全局对象。
// 浏览器里那是「共享全局词法环境」白送的，微信里必须显式挂。本步骤**按实际引用逐名计算**
// （不是人工清单、也不是把 1615 个名字全发布），且只发布确实定义在合并包内的名字，
// 并用 typeof 守卫避免覆盖宿主 API。
const RESERVED_WORDS = new Set(("break case catch class const continue debugger default delete do else " +
  "export extends finally for function if import in instanceof new return super switch this throw try " +
  "typeof var void while with yield let static get set of async await true false null undefined NaN " +
  "Infinity arguments eval").split(" "));
// 剥离注释 / 字符串 / 正则字面量 —— 否则「只出现在注释里的名字」会被误当成依赖
// （实测：不过滤会把 16 个真依赖放大成 63 个，多出的 47 个全是 legion-combat-squad.js 注释里的函数名）
function stripCommentsAndStrings(src) {
  let out = "", i = 0, prev = "";
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && c2 === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; out += " "; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      out += " "; prev = "x"; continue;
    }
    if (c === "/" && /[([{,;=:!&|?+\-*%~^<>]|^$/.test(prev || "^")) {
      i++; let inClass = false;
      while (i < n) { const d = src[i];
        if (d === "\\") { i += 2; continue; }
        if (d === "[") inClass = true; else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { i++; break; } else if (d === "\n") break;
        i++;
      }
      out += " "; prev = "x"; continue;
    }
    out += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return out;
}
/** 等长掩码：注释内容与字符串内容 → 空格（保留引号与换行，**长度严格不变**）。
 *  用途：正则在掩码上定位（排除注释/字符串里的假命中），而**名字仍从原文取**
 *  —— 因为 G("名字") / window["名字"] 的名字本身就在字符串里，用上面的 strip 会连真依赖一起抹掉。 */
function maskCodeKeepLength(src) {
  const a = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (c === "/" && c2 === "/") { while (i < n && src[i] !== "\n") { a[i] = " "; i++; } continue; }
    if (c === "/" && c2 === "*") {
      a[i] = " "; a[i + 1] = " "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") a[i] = " "; i++; }
      if (i < n) { a[i] = " "; a[i + 1] = " "; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n) {
        if (src[i] === "\\") { a[i] = " "; a[i + 1] = " "; i += 2; continue; }
        if (src[i] === q) { i++; break; }
        if (src[i] !== "\n") a[i] = " "; i++;
      }
      continue;
    }
    i++;
  }
  return a.join("");
}
const concatDecls = new Set();
for (const rel of concatList) for (const nm of topLevelDeclsOf(rel)) concatDecls.add(nm);
const globalBridge = new Set();
const bridgeDetail = {};
for (const rel of nonConcat) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  if (isEsmFile(rel)) {
    // ESM 层通过 window.X 取经典层符号（属性访问，不受作用域影响，但要求 X 真的在全局上）
    for (const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)/g)) {
      if (concatDecls.has(m[1])) globalBridge.add(m[1]);
    }
    continue;
  }
  const stripped = stripCommentsAndStrings(src);
  const local = new Set([...stripped.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const hits = [];
  for (const m of stripped.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
    const nm = m[1];
    if (RESERVED_WORDS.has(nm) || local.has(nm)) continue;
    if (concatDecls.has(nm)) {
      if (!globalBridge.has(nm)) hits.push(nm);
      globalBridge.add(nm);
    }
  }
  if (hits.length) bridgeDetail[rel] = hits.sort();
}

// ---------- 2d-2. 合并文件**自身**的「按名动态取全局」也必须桥接（2026-09-14 实测缺陷） ----------
// 为什么上面 2d 不够：2d 只算了「未合并模块需要读经典层的名字」。
// 但**合并文件自己**也有大量「按名字动态取全局」的写法，它们在浏览器里是成立的：
//   浏览器 classic <script> 的**顶层 var/function 会自动成为 window 属性**，
//   于是 G("X")（offline-combat.js 的全局解析器）与 window.X 都能取到。
// 合并后这些声明被包进模块作用域（function(require,module,exports){…}）⇒ globalThis.X 为 undefined
//   ⇒ 动态取用返回 undefined，而**调用方往往只看 typeof/真值**，于是静默走错分支或报个含糊的错。
// 实测症状（真实 IDE，logic.bundle.js:69593）：
//   [RuntimeGuard] offline:timeline：G(...) is not a function
//     at ensureVirtualAmmoFuel → Object.settle → settleOfflineTimeline → applyOfflineGains
//   即 G("getActiveShip")(state) 里 G(...) 返回 undefined（V8 对「调用一个调用结果」的报错长这样），
//   离线结算整条链被 RuntimeGuard 兜住 ⇒ **玩家离线收益静默归零**。
// 判据：动态读 ∩ 顶层 var/function 声明（= 浏览器会挂 window 的那批；const/let/class 按浏览器语义**不挂**，故不发布）。
// 文件自身已发布（window.X = X，微信里 window===globalThis，真的有效）的名字会命中 typeof 守卫被跳过，
//   因此这里只做「读」的判定，不做自发布排除——多桥一个无害，少桥一个致命。
const browserGlobalDeclsOf = (rel) => {
  const out = new Set();
  for (const ln of fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/)) {
    if (/^\s/.test(ln)) continue;
    let m2;
    if ((m2 = /^var\s+([A-Za-z_$][\w$]*)/.exec(ln))) out.add(m2[1]);
    else if ((m2 = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(ln))) out.add(m2[1]);
  }
  return out;
};
const concatGlobalDecls = new Set();
for (const rel of concatList) for (const nm of browserGlobalDeclsOf(rel)) concatGlobalDecls.add(nm);
const mergedGlobalsUsed = new Set();
const mergedGlobalsDetail = {};
for (const rel of concatList) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const mask = maskCodeKeepLength(src);
  const hits = new Set();
  // G("X")：掩码定位，原文取名 —— 名字本身在字符串里，用 strip 会把真依赖一起抹掉
  for (const m2 of mask.matchAll(/(?<![.\w$])G\(\s*["']/g)) {
    const r = /^G\(\s*["']([A-Za-z_$][\w$]*)["']\s*\)/.exec(src.slice(m2.index, m2.index + 96));
    if (r) hits.add(r[1]);
  }
  for (const m2 of mask.matchAll(/(?<![.\w$])(?:window|globalThis)\.([A-Za-z_$][\w$]*)/g)) {
    if (/^\s*=/.test(mask.slice(m2.index + m2[0].length))) continue; // 赋值左值 = 文件自身的发布语句
    hits.add(m2[1]);
  }
  const add = [];
  for (const nm of [...hits].sort()) {
    if (!concatGlobalDecls.has(nm)) continue;
    if (!mergedGlobalsUsed.has(nm)) { mergedGlobalsUsed.add(nm); add.push(nm); }
  }
  if (add.length) mergedGlobalsDetail[rel] = add;
}
for (const nm of mergedGlobalsUsed) globalBridge.add(nm);

// ---------- 3. 组装文件清单 ----------
// ⛔ 参与拼接的文件**不再单独落盘**：内容已逐字节进入 bundle，重复落盘会让主包原始体积翻倍
//    （实测 ~5.0MB → ~10MB），微信口径会顶破 4MB 主包上限。
// 🔴 合并包必须落在**主包根目录**，不能放 wx/ 子目录。
//    微信小游戏的 require 路径基准恒为「当前模块所在目录」，且**不支持 `..` 上溯、也不支持 `/` 绝对路径**
//    （实测：wx/boot.js 里 require("../js/x.js") 与 require("/js/x.js") 都被解析成 wx/js/x.js、
//     wx/wx/logic.bundle.js —— 即子目录里的模块永远无法引用兄弟目录）。
//    放根目录后，包内所有 `./js/...` 都与「原相对仓库根」的写法一致，转发桩也写在原路径 ⇒ 全部命中。
const BUNDLE_REL = "logic.bundle.js";
const forwardMapSrc = forwardTargets.length === 0 ? "" :
  `\n/* ---- 运行时 require 转发表：把合并包内这些文件的顶层名字按原路径发布，供转发桩取同一实例 ---- */\n` +
  `;globalThis.__WX_FILE_EXPORTS__ = Object.assign(globalThis.__WX_FILE_EXPORTS__ || {}, {\n` +
  forwardTargets.map((t) =>
    `  ${JSON.stringify(t)}: { ${topLevelDeclsOf(t).map((n) => `${n}: ${n}`).join(", ")} }`).join(",\n") +
  `\n});\n`;
const bridgeSrc = globalBridge.size === 0 ? "" :
  `\n/* ---- 全局桥：把经典层里「会被按名字动态取用」的顶层名字发布到全局对象。\n` +
  `   两类来源：① 未参与合并的模块（ESM / 运行时相对加载）需要读经典层符号；\n` +
  `            ② 合并文件自身的 G("X") / window.X 动态取用（浏览器靠「顶层 var/function 自动挂 window」白送）。\n` +
  `   只发布「确实定义在合并包内」的名字；typeof 守卫避免覆盖宿主 API；\n` +
  `   try/catch 记录失败（禁静默失败），失败名单见 GameGlobal.__WX_BRIDGE_FAILED__。 ---- */\n` +
  `;globalThis.__WX_BRIDGE_FAILED__ = globalThis.__WX_BRIDGE_FAILED__ || [];\n` +
  [...globalBridge].sort().map((nm) =>
    `;try { if (typeof globalThis.${nm} === "undefined") globalThis.${nm} = ${nm}; } catch (__e) { globalThis.__WX_BRIDGE_FAILED__.push(${JSON.stringify(nm)}); }`
  ).join("\n") + "\n";
const bundleSrc = concatList.length === 0 ? "" :
  `/* 自动生成，勿手改：tools/build-wechat-minigame.mjs（单作用域合并包）\n` +
  ` * 来源：index.html 有序 classic <script> 共 ${concatList.length} 个，按加载顺序逐字节拼接。\n` +
  ` * 目的：微信把每个文件包进 function 作用域，顶层 const/let 跨文件不可见；\n` +
  ` *       合并为单文件即恢复浏览器「共享全局词法环境」的语义（与浏览器同构）。\n` +
  ` * 未参与合并：ESM ${mainEsm.length} 个 + 运行时相对加载 ${mainDeferred.length} 个，见 boot.js（主包根）。\n` +
  ` */\n` +
  concatList.map((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^\uFEFF/, "");
    return `\n/* ==================== ${rel} ==================== */\n` + (src.endsWith("\n") ? src : src + "\n");
  }).join("") + forwardMapSrc + bridgeSrc;

const files = []; // {rel, abs, pkg, outRel, size, gen?}
const add = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
  const pkg = pkgOf(rel);
  // 微信小游戏无法运行的模块 → 空实现 stub（避免 require 抛红字）
  if (WX_STUB.has(rel)) {
    const stub = wxStubBody(rel);
    files.push({ rel, abs: null, pkg, outRel: (SUBROOT[pkg] || "") + rel, size: Buffer.byteLength(stub, "utf8"), gen: stub });
    return true;
  }
  const stub = forwarderStubs.get(rel);
  if (stub) {
    files.push({ rel, abs: null, pkg, outRel: (SUBROOT[pkg] || "") + rel, size: Buffer.byteLength(stub, "utf8"), gen: stub });
    return true;
  }
  const srcRaw = fs.readFileSync(abs, "utf8");
  // 普通 JS（classic script / deferred）也可能写 import("./x.js?v=N") / require("./x.js?v=N"),
  // 微信按字面路径解析会找不到；统一先剥 cache-buster。
  const srcStripped = /\.js$/i.test(rel) ? stripEsmCacheBusters(srcRaw) : srcRaw;
  // ESM 文件额外把所有 import/export/dynamic-import specifier 映射为产物内真实相对路径。
  if (isEsmFile(rel)) {
    const tx = remapEsmImports(srcStripped, rel, pkg);
    files.push({ rel, abs: null, pkg, outRel: (SUBROOT[pkg] || "") + rel, size: Buffer.byteLength(tx, "utf8"), gen: tx });
    return true;
  }
  if (srcStripped !== srcRaw) {
    files.push({ rel, abs: null, pkg, outRel: (SUBROOT[pkg] || "") + rel, size: Buffer.byteLength(srcStripped, "utf8"), gen: srcStripped });
    return true;
  }
  files.push({ rel, abs, pkg, outRel: (SUBROOT[pkg] || "") + rel, size: fs.statSync(abs).size });
  return true;
};

for (const rel of bootOrder) if (!concatSet.has(rel)) add(rel);
// 转发桩：这些文件本体在合并包内，但在原路径额外写一份桩，供运行时 require 取到同一实例
for (const t of forwardTargets) add(t);
if (bundleSrc) {
  files.push({ rel: BUNDLE_REL, abs: null, pkg: PKG.MAIN, outRel: BUNDLE_REL, size: Buffer.byteLength(bundleSrc, "utf8"), gen: bundleSrc });
}
for (const rel of walk(path.join(ROOT, "assets"))) add(rel);
for (const rel of walk(path.join(ROOT, "demo-assets"))) add(rel);

// ---------- 3b. 渲染层三件套（T2「把界面画出来」） ----------
// ------------------------------------------------------------------
// 为什么需要：微信小游戏没有 DOM。`wx/shim.js` 只做到「接住调用不报错」，
//   它**不往屏幕上画任何东西**（getBoundingClientRect 恒 0、无布局无绘制）。
//   真机实测症状 = 启动后停在纯黑/静态 logo，永远进不了游戏（逻辑层其实在跑）。
// 组成（缺一不可）：
//   · wx/dom-assets.js   构建期内联的 index.html 与全部 CSS。
//       微信运行环境**没有文件系统**：包内的 .css/.html 只能用 require 取（读不了盘），
//       所以必须在此处转成 JS 模块。CSS 按 index.html 的**文档顺序**（link 与 inline <style> 交错）保留，
//       层叠顺序错 = 样式整体错位，不是「差一点」。
//   · wx/dom-kernel.js   渲染内核（源：tools/wechat/dom-kernel.js，从 mini-dom-poc 移植）。
//       样式表解析 → 样式计算 → 排版（写 node.__box）→ 绘制。
//   · wx/dom-render.js   宿主驱动（源：tools/wechat/dom-render.js）。
//       注入 index.html → 帧循环（脏标记 + 自适应节流）→ 触摸命中 → 合成 click。
// ⛔ 三者都在**主包**（wx/ 前缀）：渲染层与 shim 一起在启动路径上，不能等分包。
const RENDER_MODULES = [
  ["tools/wechat/dom-kernel.js", "wx/dom-kernel.js"],
  ["tools/wechat/dom-render.js", "wx/dom-render.js"],
];
const renderMissing = RENDER_MODULES.filter(([s]) => !fs.existsSync(path.join(ROOT, s)));
if (renderMissing.length) {
  console.error("\n❌ 渲染层源文件缺失：" + renderMissing.map(([s]) => s).join(", "));
  console.error("   → 这两个文件是 T2 的骨架，缺了产物会退回「纯黑屏」。拒绝继续。");
  process.exit(1);
}
for (const [srcRel, outRel] of RENDER_MODULES) {
  const abs = path.join(ROOT, srcRel);
  files.push({ rel: srcRel, abs, pkg: PKG.MAIN, outRel, size: fs.statSync(abs).size });
}

/* 构建期抽取 index.html 的内联资源。与渲染层同口径（顺序 = 文档顺序）。 */
const htmlAttrMatch = /<html([^>]*)>/i.exec(html);
const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
const bodyMatch = /<body([^>]*)>([\s\S]*)<\/body>/i.exec(html);
if (!headMatch || !bodyMatch) {
  console.error("\n❌ index.html 里找不到 <head>/<body> —— 抽不出界面骨架，拒绝继续。");
  process.exit(1);
}
const cssTexts = [];
const cssLabels = [];
{
  const STYLE_RE = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = STYLE_RE.exec(html)) !== null) {
    if (m[1] !== undefined) {
      const idm = /id\s*=\s*["']([^"']+)["']/.exec(m[0]);
      cssTexts.push(m[1]);
      cssLabels.push("<style#" + (idm ? idm[1] : "-") + ">");
      continue;
    }
    const hm = /href\s*=\s*["']([^"']+)["']/.exec(m[0]);
    if (!hm) continue;
    const rel = hm[1].replace(/^\.\//, "").replace(/[?#].*$/, "");
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { cssLabels.push("(缺失) " + rel); continue; }
    cssTexts.push(fs.readFileSync(abs, "utf8"));
    cssLabels.push(rel);
  }
}
const cssBytes = cssTexts.reduce((a, b) => a + Buffer.byteLength(b, "utf8"), 0);
const domAssetsSrc =
  `/* 自动生成，勿手改：tools/build-wechat-minigame.mjs\n` +
  ` * 微信运行环境没有文件系统 ⇒ index.html 与 CSS 只能在构建期内联成 JS 模块。\n` +
  ` * CSS 顺序 = index.html 文档顺序（${cssTexts.length} 份），层叠顺序错会导致样式整体错位。\n` +
  ` * 来源：index.html ${Buffer.byteLength(html, "utf8")} B · head ${headMatch[1].length} B · body ${bodyMatch[2].length} B · CSS ${cssBytes} B\n` +
  ` */\n` +
  `/* eslint-disable */\n` +
  `module.exports = {\n` +
  `  htmlAttrs: ${JSON.stringify((htmlAttrMatch ? htmlAttrMatch[1] : "").trim())},\n` +
  `  bodyAttrs: ${JSON.stringify(bodyMatch[1].trim())},\n` +
  `  headHtml: ${JSON.stringify(headMatch[1])},\n` +
  `  bodyHtml: ${JSON.stringify(bodyMatch[2])},\n` +
  `  cssLabels: ${JSON.stringify(cssLabels)},\n` +
  `  css: [\n${cssTexts.map((t) => "    " + JSON.stringify(t)).join(",\n")}\n  ],\n` +
  `};\n`;
files.push({ rel: "wx/dom-assets.js", abs: null, pkg: PKG.MAIN, outRel: "wx/dom-assets.js", size: Buffer.byteLength(domAssetsSrc, "utf8"), gen: domAssetsSrc });
// 门禁：资源抽空了也必须构建失败（否则产物能过体积、却是个画不出东西的空壳）
if (!cssTexts.length || bodyMatch[2].length < 1000) {
  console.error(`\n❌ 渲染资源抽取异常：CSS ${cssTexts.length} 份 / body ${bodyMatch[2].length} B`);
  console.error("   → 产物会「体积正常但界面空白」，拒绝继续。");
  process.exit(1);
}

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
if (excludedFiles.length) {
  let exBytes = 0;
  for (const r of excludedFiles) exBytes += fs.statSync(path.join(ROOT, r)).size;
  console.log(`微信端排除         : ${excludedFiles.length} 个 / ${KB(exBytes)}（不进任何包，依据见脚本 §2a）`);
  for (const r of excludedFiles) console.log(`                     · ${r}  ${KB(fs.statSync(path.join(ROOT, r)).size)}`);
}
if (excludeStale.length) {
  console.warn(`   ⚠️ 排除清单里有仓库中不存在的路径 ${excludeStale.length} 个（清单已过期，请清理）: ${excludeStale.join(", ")}`);
}
console.log(`主包加载模型       : 单作用域合并包 — ${concatList.length} 个 classic script 拼成 1 个 ${BUNDLE_REL}（不单独落盘）`);
console.log(`                     另 ${nonConcat.length} 个逐文件 require（ESM ${mainEsm.length} + 运行时相对加载 ${mainDeferred.length}）`);
console.log(`                     运行时加载目标 ${runtimeTargets.size} 个 → 移出合并包 ${unbundleTargets.size} 个、生成转发桩 ${forwardTargets.length} 个`);
if (forwardTargets.length) forwardTargets.forEach((t) => console.log(`                     · 转发桩（留在合并包内）: ${t}  [${topLevelDeclsOf(t).length} 名]`));
console.log(`                     全局桥 ${globalBridge.size} 个名字 = 非合并模块引用 ${Object.values(bridgeDetail).flat().length} + 合并文件动态取用 ${mergedGlobalsUsed.size}`);
for (const r in bridgeDetail) console.log(`                     · [非合并模块] ${r} → ${bridgeDetail[r].join(", ")}`);
for (const r in mergedGlobalsDetail) console.log(`                     · [合并文件动态取用] ${r} → ${mergedGlobalsDetail[r].join(", ")}`);
if (mainEsm.length) console.log(`                     · ESM: ${mainEsm.join(", ")}`);
if (mainDeferred.length) console.log(`                     · 含 require(): ${mainDeferred.join(", ")}`);

console.log("\n=== 三包「磁盘原始字节」（⚠️ 不是微信口径，见下）===");
console.log("   ⚠️ 微信对 JS 会先剥离注释/空白再计，非 JS 资源（png/txt/ttf）才逐字节计。");
console.log("      故本表对 main 会**显著高估**（实测约 5.0MB → 官方 2.69MB），subassets 基本准。");
console.log("      ⛔ 不要用本表判断是否超 4MB；权威数字只能来自");
console.log("         cli.bat preview --project <OUT> --info-output <out.json>");
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
  for (const f of ["game.js", "game.json", "boot.js", "logic.bundle.js", "README.md", ".eslintrc.js"]) {
    fs.rmSync(path.join(OUT, f), { force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  // 5.2 拷贝（gen 型条目 = 生成内容，直接写盘）
  let copied = 0;
  for (const f of files) {
    const dest = path.join(OUT, f.outRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (f.gen != null) fs.writeFileSync(dest, f.gen, "utf8");
    else fs.copyFileSync(f.abs, dest);
    copied++;
  }

  // 5.2b 运行时 shim（源在 tools/wechat/shim.js，不进主仓库 js/）
  // ------------------------------------------------------------------
  // ⚠️ 拷进去之前**必须先过语义门禁**。原因（实测，代价很惨）：
  //   早先版本的 shim 里 `el.querySelector` 恒返 null —— 启动路径**测不出来**
  //    （异常数 0、app 照跑、存档照写），只有派发事件才暴露，而且症状是
  //    「弹窗能显示但点不动」。这种「假绿」绝不能进产物。
  //    门禁断言的是语义（查得到真子节点 / 事件真冒泡 / classList 真同步 /
  //    不支持的选择器显式抛错），不是「没抛错」。失败即 exit 1。
  const shimSrc = path.join(__dirname, "wechat", "shim.js");
  if (fs.existsSync(shimSrc)) {
    const t = spawnSync(process.execPath, [path.join(__dirname, "wechat", "shim-selftest.mjs")], { encoding: "utf8" });
    if (t.status !== 0) {
      console.error("\n❌ shim 语义门禁未通过（tools/wechat/shim-selftest.mjs）——已阻止打包。");
      console.error((t.stdout || "") + (t.stderr || ""));
      console.error("   → shim 的 DOM 语义有回归；修好再打包。勿把产物直接改绿。");
      process.exit(1);
    }
    console.log(`   5.2b shim 门禁: ${(t.stdout || "").trim()}`);
    fs.mkdirSync(path.join(OUT, "wx"), { recursive: true });
    fs.copyFileSync(shimSrc, path.join(OUT, "wx", "shim.js"));
  } else {
    console.warn("⚠️ 缺少 tools/wechat/shim.js，产物将无法加载");
  }

  // 5.2c 渲染层资源自证（构建期抓「转义写坏 / CSS 抽空 / 路径错」，不等真机）
  // ------------------------------------------------------------------
  // 这类缺陷的症状是「体积正常、界面上什么都没有」——最难查的一类，必须在构建期拦掉。
  {
    const p = path.join(OUT, "wx", "dom-assets.js");
    if (!fs.existsSync(p)) { console.error("\n❌ 缺 wx/dom-assets.js（渲染层拿不到 index.html）"); process.exit(1); }
    const src = fs.readFileSync(p, "utf8");
    const mod = { exports: {} };
    try { new Function("module", "exports", src)(mod, mod.exports); }
    catch (e) { console.error("\n❌ wx/dom-assets.js 无法求值：" + ((e && e.message) || e)); process.exit(1); }
    const A = mod.exports || {};
    const kb1 = (n) => (n / 1024).toFixed(1) + " KB";
    const problems = [];
    if (typeof A.bodyHtml !== "string" || A.bodyHtml.length < 1000) problems.push("bodyHtml 过短（" + String((A.bodyHtml || "").length) + " B）");
    if (typeof A.headHtml !== "string") problems.push("headHtml 缺失");
    if (!Array.isArray(A.css) || !A.css.length) problems.push("css 为空");
    if (!Array.isArray(A.cssLabels) || (A.cssLabels || []).length !== (A.css || []).length) problems.push("cssLabels 与 css 不等长（顺序真值会被打乱）");
    const cssTot = (A.css || []).reduce((s, t) => s + Buffer.byteLength(String(t), "utf8"), 0);
    if (cssTot < 100 * 1024) problems.push("CSS 总量异常小（" + cssTot + " B）");
    for (const [, outRel] of RENDER_MODULES) {
      if (!fs.existsSync(path.join(OUT, outRel))) problems.push("缺 " + outRel);
    }
    if (problems.length) {
      console.error("\n❌ 渲染层资源自证未通过：");
      for (const x of problems) console.error("   · " + x);
      console.error("   → 产物会「体积正常但界面空白/错位」，拒绝继续。");
      process.exit(1);
    }
    console.log(`   5.2c 渲染资源自证: body ${kb1(Buffer.byteLength(A.bodyHtml, "utf8"))} · head ${kb1(Buffer.byteLength(A.headHtml, "utf8"))}` +
      ` · CSS ${A.css.length} 份 ${kb1(cssTot)} · 内核/驱动已就位`);
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

  // 非合并模块（ESM / 内部相对 require）逐个容错加载：
  //   它们不属于逻辑层。ESM 的裸包名 "three" / "three/addons/..." 已在构建期映射为包内相对路径；
  //   仍可能残留的其它裸包名依赖 index.html importmap，小游戏无 importmap ⇒ 会失败。
  //   任一失败都不应阻断已加载的逻辑层。失败清单必须显式打出（禁静默），并挂 GameGlobal 供工具控制台查看。
  // ⚠️ 路径一律用 ./ 从主包根**下溯**：微信 require 的基准恒为「当前模块所在目录」，
  //    且不支持 `..` 上溯、不支持 `/` 绝对路径（实测三条全被拼到当前目录下：
  //    wx/boot.js 里 "../js/x.js" → wx/js/x.js、"/js/x.js" → wx/js/x.js、
  //    "/wx/logic.bundle.js" → wx/wx/logic.bundle.js）。
  const deferredLoads = nonConcat.map((r) => `  loadModule("./${r}");`).join("\n");
  const bootRequires = bundleSrc
    ? `  require("./logic.bundle.js");   // ${concatList.length} 个 classic script 的单作用域合并包（逻辑层；失败即致命，故**故意不兜**）`
    : "";
  // ⚠️ boot() 必须显式调用：require 只执行模块体、返回其 exports，不会自动运行逻辑层。
  //    （旧版本写成 require("./wx/boot.js"); 且 boot.js 内 require 路径基准错误 ⇒ 逻辑层从未加载过。）
  fs.writeFileSync(path.join(OUT, "game.js"), `/* 微信小游戏入口（自动生成，勿手改）：tools/build-wechat-minigame.mjs */
/* ★ 启动顺序有原因，勿调换：
   1) 抢屏幕画布 —— 小游戏里**第一次** wx.createCanvas() 返回的才是上屏画布，
      必须早于任何人（shim 自己也会 createCanvas 造离屏画布）。
   2) shim —— 提供 document/window/localStorage 等宿主替身。
   3) dom.install() —— 把 index.html 灌进 shim 的 document。**必须在逻辑层之前**：
      否则逻辑层的 getElementById / querySelector 只会拿到「没属性没类」的占位桩，
      依赖 data 属性与类的事件委派全部不命中（症状：界面残缺、按钮点不动）。
   4) 逻辑层 boot() —— 在真节点树上建界面（这一步之后 DOM 才长出内容）。
   5) dom.start(屏幕画布) —— 接管绘制：布局 + 绘制 + 帧循环 + 触摸命中。
   ⚠️ 3/5 都容错：渲染层挂了也只是「没画面」，不能让逻辑层陪葬（逻辑层仍要跑，
      这样 GameGlobal.__WX_DOM_RENDER__ 里的诊断才拿得到）。 */
var __screen = null;
try {
  if (typeof wx !== "undefined" && wx && typeof wx.createCanvas === "function") __screen = wx.createCanvas();
} catch (e) { console.error("[wx/game] 取屏幕画布失败：" + ((e && e.message) || e)); }
require("./wx/shim.js");
var __dom = null;
try { __dom = require("./wx/dom-render.js"); }
catch (e) { console.error("[wx/game] dom-render 加载失败：" + ((e && e.message) || e)); }
if (__dom) {
  try { __dom.install(); }
  catch (e) { console.error("[wx/game] dom-render.install 失败：" + ((e && e.message) || e)); }
}
require("./boot.js")();
if (__dom) {
  try { __dom.start(__screen); }
  catch (e) { console.error("[wx/game] dom-render.start 失败：" + ((e && e.message) || e)); }
}
`);
  fs.writeFileSync(path.join(OUT, "boot.js"), `/* 自动生成，勿手改：tools/build-wechat-minigame.mjs 从 index.html 抽取加载顺序 */
/* 加载模型：单作用域合并包（与浏览器同构）。
   浏览器里 classic <script> 共享全局词法环境 ⇒ 跨文件裸标识符可读；
   微信逐文件 require 会隔离顶层 const/let ⇒ 跨文件引用全断。
   故把 ${concatList.length} 个 classic script 按加载顺序合并为 ./logic.bundle.js（一个文件 = 一个作用域）。 */
/* 🔴 本文件与 logic.bundle.js 都必须在**主包根目录**（不是 wx/，shim 仍在 wx/）。
   微信 require 的路径基准恒为「当前模块所在目录」，且不支持 '..' 上溯、不支持 '/' 绝对路径：
   放 wx/ 子目录时 require("../js/x.js") 被解析成 wx/js/x.js（不存在）、
   require("/js/x.js") 变成 wx/js/x.js、require("/wx/logic.bundle.js") 变成 wx/wx/logic.bundle.js，
   ⇒ 整个 js/** 逻辑层永远加载不到（实测症状：IDE 控制台只有一条无消息的 WAGameSubContext 堆栈、纯黑屏）。
   放根目录后全部用 ./ 下溯，与包内「原相对仓库根」的写法一致。 */
/* 下面 ${nonConcat.length} 个模块（ESM ${mainEsm.length} + runtime 加载源 ${mainDeferred.length} + 其加载目标 ${nonConcat.length - mainEsm.length - mainDeferred.length}）**逐个容错**：
   它们不属于逻辑层，任一加载失败只影响自身功能，不得阻断已加载的逻辑层。
   ESM 的裸包名 "three" / "three/addons/..." 已在构建期映射为包内相对路径；仍可能残留的其它裸包名
   依赖 index.html 的 importmap，小游戏无 importmap ⇒ 会失败。
   失败一律显式打印 + 挂 GameGlobal.__WX_BOOT_SKIPPED__（禁静默失败）。
   无论成败都挂 GameGlobal.__WX_BOOT_STATUS__（正向证据，不受日志级别过滤器影响）。 */
module.exports = function boot() {
${bootRequires}
  var __g = null;
  try { __g = (typeof GameGlobal !== "undefined") ? GameGlobal : (typeof globalThis !== "undefined" ? globalThis : null); } catch (__e) {}
  console.log("[wx/boot] 逻辑层就绪：单作用域合并包 ${concatList.length} 个 classic script 已加载");
  var __skipped = [];
  function loadModule(rel) {
    try { require(rel); }
    catch (e) { __skipped.push(rel + "  ::  " + ((e && e.message) ? e.message : String(e))); }
  }
${deferredLoads}
  if (__skipped.length) {
    console.warn("[wx/boot] " + __skipped.length + " / ${nonConcat.length} 个非逻辑层模块加载失败（已跳过，逻辑层不受影响）:");
    for (var __i = 0; __i < __skipped.length; __i++) console.warn("  ✗ " + __skipped[__i]);
  }
  /* 正向证据：**无条件**挂到 GameGlobal。
     控制台的 console.log 可能被「日志级别过滤器」隐藏，这个不会 ——
     在开发者工具 Console 里执行 GameGlobal.__WX_BOOT_STATUS__ 即可确认逻辑层是否真的加载。 */
  try {
    if (__g) __g.__WX_BOOT_STATUS__ = { ok: true, bundleFiles: ${concatList.length}, skipped: __skipped, at: Date.now() };
    if (__g && __skipped.length) __g.__WX_BOOT_SKIPPED__ = __skipped;
  } catch (__e) {}
};
`);

  // 5.4 ES5 降级：产物内**所有** .js 的代码区必须没有 `?.` / `??`
  // ------------------------------------------------------------------
  // 为什么必须自己做（而不是指望 IDE）：
  //   微信编译链对 **>2000KB 的文件整文件跳过**（原话「文件超过最大大小：2000KB，编译进程不处理」），
  //   即该文件既不做 ES6→ES5、也不压缩。logic.bundle.js 约 4.9MB 必然落在这一档，
  //   里面的 `?.` 就原样落到模拟器运行时（JSCore 不认）⇒
  //     SyntaxError: invalid file: logic.bundle.js, 12815:117
  //   ⇒ app 编译失败 ⇒ 模拟器拿不到 app ⇒ **纯黑屏**（且 Ctrl+B 编译看起来「没反应」）。
  //   实证：编译缓存目录里查无 logic.bundle.js，而其余文件都在。
  // 规则：对所有含 `?.`/`??` 的产物 .js 统一降级，**不依赖编译器行为**
  //   （project.config.json 的 es6/minified 是 IDE 侧配置，可能被改或被平台重置）。
  // 降级器语义等价性由 tools/wechat/es5-downlevel.mjs --selftest 保证（含行为与副作用次数断言）。
  // 失败即报：任何一处解析不了、或降级后仍有残余 ⇒ 直接 exit 1（禁静默放行）。
  const dlFiles = [];
  const walkOutJs = (dir, o = []) => {
    if (!fs.existsSync(dir)) return o;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walkOutJs(abs, o);
      else if (e.isFile() && e.name.endsWith(".js")) o.push(abs);
    }
    return o;
  };
  for (const abs of walkOutJs(OUT)) {
    const rel = path.relative(OUT, abs).replace(/\\/g, "/");
    const src = fs.readFileSync(abs, "utf8");
    if (findOps(maskCode(src)).length === 0) continue;
    const before = Buffer.byteLength(src, "utf8");
    let r;
    try {
      r = downlevelSource(src);
    } catch (e) {
      console.error(`\n❌ ES5 降级失败：${rel}\n   ${e.message}`);
      console.error("   → 请扩展 tools/wechat/es5-downlevel.mjs 支持的语法形状后重跑；勿手工改产物。");
      process.exit(1);
    }
    const rest = findOps(maskCode(r.out));
    if (rest.length) {
      console.error(`\n❌ ES5 降级后仍有残余：${rel} 共 ${rest.length} 处（首个 @ 偏移 ${rest[0].index}）`);
      console.error("   → 这是构建漏洞，不可放行。");
      process.exit(1);
    }
    fs.writeFileSync(abs, r.out, "utf8");
    const delta = Buffer.byteLength(r.out, "utf8") - before;
    if (rel === BUNDLE_REL) bundleEs5Delta += delta; else es5Delta += delta; // 见文件头记账说明
    dlFiles.push({ rel, n: r.hits.length, delta, over: before > 2000 * 1024 });
  }
  if (dlFiles.length) {
    console.log(`\n=== ES5 降级（?. / ??）===`);
    for (const x of dlFiles) {
      console.log(`  ${x.rel.padEnd(46)} 替换 ${String(x.n).padStart(2)} 处  ${(x.delta >= 0 ? "+" : "") + x.delta} B` +
        (x.over ? "   ⚠️ >2000KB：编译链会跳过它，本条降级是唯一保险" : ""));
    }
    console.log(`  合计 ${dlFiles.length} 个文件 / ${dlFiles.reduce((s, x) => s + x.n, 0)} 处；降级后残余 0（已断言）`);
  } else {
    console.log('\n=== ES5 降级（?. / ??）=== 产物内无 `?.`/`??`，跳过');
  }

  // 5.5 主包压缩（terser —— 只压 logic.bundle.js 这一个文件）
  // ------------------------------------------------------------------
  // 为什么**必须**有这一步（不是优化，是过关）：微信编译链对 **>2000KB 的文件整文件跳过**
  //   （原话「文件超过最大大小：2000KB，编译进程不处理」）—— 该文件既不 ES6→ES5、不剥离注释空白、
  //   也不压缩，于是**按原始字节**计入主包。logic.bundle.js 正落在这一档 ⇒
  //   主包 ≈ 5127.7(该文件原样) + 197.3(其余件压缩后) = **5325 KB > 4096 KB** ⇒
  //   `cli preview` 拒绝出二维码（实测日志：SyntaxError 0、simulator compile 8 次成功，仍报 exceed）。
  // 为什么**只压这一个**：其余文件都 <2000KB，微信自己会剥离注释/空白后按**压缩后**口径计入；
  //   我们再压一遍收益近乎为零（它们合计只占主包约 197 KB），却平添「压坏非合并模块」的风险。
  //   ⇒ 收益 100% 集中在 logic.bundle.js，风险面也收在同一个文件。
  // 为什么放在 5.4 **之后**：降级器工作在未压缩、可读的输入上（其解析器在该形态已验证）。
  //   terser 不会重新引入 `?.`/`??`，但**不靠假设、直接断言**（残余即 exit 1）。
  // ⛔ 绝对不开 toplevel 改名（mangle.toplevel 恒 false、也不传 topLevel）：
  //   合并包靠**尾部 `globalThis.X = X` 桥**把内部名字发布给主包根下另外 ${nonConcat.length} 个独立模块，
  //   顶层改名会让桥发布的名字与那些模块读的名字对不上 ⇒ 那些模块全部静默失效。
  // 保留「段标记」注释：产物是单行巨行，崩溃时微信只报 line:col；
  //   段标记「==== js/xxx.js ====」保留后可用 grep 把报错位置映回源文件（代价约几 KB）。
  if (NO_MINIFY) {
    console.warn("\n⚠️⚠️ --no-minify：已**跳过**主包压缩。");
    console.warn("    产物主包必然 >4096KB（preview 出不了码），仅用于排查「是不是压缩导致的」。禁止用于正式包。");
  } else {
    const bundleAbs = path.join(OUT, BUNDLE_REL);
    if (!bundleSrc || !fs.existsSync(bundleAbs)) {
      console.log(`\n=== 主包压缩（terser）=== 无 ${BUNDLE_REL}，跳过`);
    } else {
      // 解析 terser：① WX_TERSER_PATH ② 仓库根 node_modules（package.json devDependencies）
      // 找不到就**直接失败**——静默降级为「不压缩」会让产物超限却不报错，是最坏的失败模式。
      let terser = null, terserReq = null, terserFrom = "", terserVersion = "";
      const cands = [];
      if (process.env.WX_TERSER_PATH) cands.push({ dir: process.env.WX_TERSER_PATH, why: "WX_TERSER_PATH" });
      cands.push({ dir: ROOT, why: "仓库根 node_modules" });
      for (const c of cands) {
        try {
          const req = createRequire(path.join(c.dir, "noop.js"));
          terser = req("terser");
          terserReq = req;
          terserFrom = c.why;
          break;
        } catch (e) { /* 换下一个候选来源 */ }
      }
      if (!terser) {
        console.error("\n❌ 主包压缩需要 terser，但找不到它。已阻止打包。");
        console.error("   装法（钉死版本，与已验证行为一致）：");
        console.error(`     cd "${ROOT}" && npm install --save-dev --save-exact terser@5.51.2`);
        console.error("   或指向已有安装：");
        console.error("     WX_TERSER_PATH=<含 terser 的 node_modules 目录> node tools/build-wechat-minigame.mjs");
        console.error("   → 拒绝在未压缩状态下继续：那样产物必然顶破 4MB 主包上限，是「拿不到二维码还不报错」。");
        process.exit(1);
      }
      try { terserVersion = terserReq("terser/package.json").version; } catch { /* 版本仅用于打印 */ }

      const beforeSrc = fs.readFileSync(bundleAbs, "utf8");
      const beforeBytes = Buffer.byteLength(beforeSrc, "utf8");
      let minified;
      try {
        const r = await terser.minify({ [BUNDLE_REL]: beforeSrc }, {
          ecma: 5,
          compress: { passes: 2 },
          mangle: { toplevel: false }, // ⛔ 见上：顶层改名会打断尾部 globalThis 桥
          format: { comments: (node, comment) => /\.(?:js|mjs)\s*=+\s*$/.test(comment.value) },
        });
        minified = r.code;
      } catch (e) {
        console.error(`\n❌ terser 压缩失败：${e && e.message ? e.message : String(e)}`);
        console.error("   → 修好再打包；勿手工改产物。");
        process.exit(1);
      }
      const rest = findOps(maskCode(minified));
      if (rest.length) {
        console.error(`\n❌ terser 产物出现 ${rest.length} 处 ?. / ??（首个 @ 偏移 ${rest[0].index}）`);
        console.error("   → 构建漏洞：本文件 >2000KB 会被微信编译链跳过，残留语法将直接 SyntaxError ⇒ 黑屏。不可放行。");
        process.exit(1);
      }
      /* 自带来源横幅：产物是压缩后的单行巨行，必须自己说明来历与「怎么映回报错位置」。
         ⚠️ 横幅里不能出现嵌套的块注释结束符。 */
      const banner = `/* 自动生成，勿手改：tools/build-wechat-minigame.mjs（单作用域合并包，已 terser 压缩）\n` +
        ` * 源：index.html 有序 classic <script> 共 ${concatList.length} 个，按加载顺序拼接。\n` +
        ` * 本文件是压缩产物，行号不可读；段标记「==== js/xxx.js ====」已保留，\n` +
        ` * 可用 grep 把崩溃报错位置映回源文件。\n` +
        ` */\n`;
      fs.writeFileSync(bundleAbs, banner + minified, "utf8");
      const afterBytes = Buffer.byteLength(banner + minified, "utf8");
      bundleFinalSize = afterBytes; // 第 6 步以此为准对账（5.4 的降级增量已被压缩覆盖）

      console.log(`\n=== 主包压缩（terser${terserVersion ? " " + terserVersion : ""}，来源：${terserFrom}）===`);
      console.log(`  ${BUNDLE_REL}  ${KB(beforeBytes)} → ${KB(afterBytes)}   −${(100 - (afterBytes / beforeBytes) * 100).toFixed(1)}%` +
        `  （主包体积的**唯一**大头，其余文件合计仅约 197 KB 且由微信压缩）`);
      const stillOver = afterBytes > 2000 * 1024;
      console.log(`  该文件 ${stillOver
        ? `**仍 >2000KB** ⇒ 微信编译链仍会跳过它 ⇒ 按原始字节计入主包；这是当前主包的额度上限来源`
        : `已 <2000KB ⇒ 微信会自行压缩它 ⇒ 主包按压缩口径计（额度显著变宽）`}`);
      console.log(`  ⚠️ 主包最终数字只能来自 cli preview（本脚本的字节和不是微信口径）：`);
      console.log(`     cli.bat preview --project "${OUT}" --info-output <out.json>`);
      console.log(`  压缩后残余 ?. / ?? : ${rest.length}（已断言为 0）；顶层名未改名（尾部 globalThis 桥完好）`);
    }
  }

  // 5.6 project.config.json：只 patch setting，保留 appid / projectname
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

  // 落盘后的**真实**字节（含 5.4 降级 / 5.5 压缩的改写）：第 4 步那张表在压缩前打印、对 main 已失真，
  // 这里按盘上实际文件重算。⚠️ 口径仍是「磁盘字节」，**不是**微信口径（微信对 <2000KB 的 JS 会剥离注释空白后再计）。
  const diskBy = {};
  const walkDisk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walkDisk(abs); continue; }
      if (!e.isFile()) continue;
      const rel = path.relative(OUT, abs).replace(/\\/g, "/");
      let pkg = PKG.MAIN;
      for (const k of Object.keys(SUBROOT)) if (rel.startsWith(SUBROOT[k])) pkg = k;
      if (!diskBy[pkg]) diskBy[pkg] = { n: 0, bytes: 0 };
      diskBy[pkg].n++;
      diskBy[pkg].bytes += fs.statSync(abs).size;
    }
  };
  walkDisk(OUT);
  let diskTotal = 0, diskN = 0;
  console.log("=== 落盘真实字节（压缩/降级之后；⚠️ 仍是磁盘口径，权威数字只能来自 cli preview）===");
  for (const k of [PKG.MAIN, PKG.SUB3D, PKG.SUBASSETS]) {
    const v = diskBy[k] || { n: 0, bytes: 0 };
    diskTotal += v.bytes; diskN += v.n;
    console.log(`  ${k.padEnd(11)} ${String(v.n).padStart(4)} 个  ${MB(v.bytes).padStart(9)}  ${KB(v.bytes).padStart(11)}`);
  }
  console.log(`  ${"合计".padEnd(11)} ${String(diskN).padStart(4)} 个  ${MB(diskTotal).padStart(9)}  ${KB(diskTotal).padStart(11)} / 30MB 上限`);
  console.log(`\n⚠️ 下一步跑 CLI 前必须等待 3~5 秒：开发者工具的文件索引有滞后，`);
  console.log(`   刚写完就 preview 会误报「未找到分包 game.js / 文件不存在」。`);
  console.log(`   preview 命令（旗标是 --info-output / -i；写成 --preview-info-output 不报错、只是 json 静默不落盘）：`);
  console.log(`     cli.bat preview --project "${OUT}" --info-output <out.json>`);
}

// ---------- 6. 复查：落盘文件真有这么多字节吗（防止拷贝漏/截断/多出残留） ----------
if (!DRY) {
  // ⚠️ 旧写法有两处失真：① logic.bundle.js 已在 files 里，第二个循环又加一遍 ⇒ onDisk 恒 ≠ totalBytes，
  //    靠 `|| n > files.length` 把检查变成永真；② 完全看不见「产物目录里多出来、不属于本次构建的文件」
  //    （实测踩过：演示用的 first-screen.js 与备份 game.js.bak-* 会悄悄留在主包体积里）。
  // 现在改为「期望集 → 实盘集」双向对账：既查缺失，也查多余。
  const expected = new Set(files.map((f) => f.outRel));
  /* 「生成件」：不在 files 清单里，是本脚本自己写出来的。它们要参与「多余文件」判定，
   * 但**不参与**「清单字节和」对账（清单字节和只对 files 逐个比 size，用来抓拷贝截断）。
   * project.private.config.json 不是我们写的，是**开发者工具自己维护**的本地私有配置
   * （5.1 清理时刻意保留了 project.*.json）⇒ 列入白名单，否则每次构建都会误报「盘上有、清单里没有」。 */
  const generated = new Set(["game.js", "game.json", "boot.js", "wx/shim.js", "project.config.json", "project.private.config.json"]);
  for (const root of Object.values(SUBROOT)) generated.add(root + "game.js"); // 5.3b 的分包入口占位
  for (const g of generated) expected.add(g);
  const listRels = new Set(files.map((f) => f.outRel));
  const walkAll = (dir, o = []) => {
    if (!fs.existsSync(dir)) return o;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walkAll(abs, o);
      else if (e.isFile()) o.push(path.relative(OUT, abs).replace(/\\/g, "/"));
    }
    return o;
  };
  let listBytes = 0, n = 0;
  const missing = [], extra = [];
  for (const rel of walkAll(OUT)) {
    if (!expected.has(rel)) { extra.push(rel + "  " + fs.statSync(path.join(OUT, rel)).size + " B"); continue; }
    if (listRels.has(rel)) { listBytes += fs.statSync(path.join(OUT, rel)).size; n++; }
  }
  for (const rel of expected) if (!fs.existsSync(path.join(OUT, rel))) missing.push(rel);
  const bundleEntry = files.find((f) => f.outRel === BUNDLE_REL);
  const bundlePre = bundleEntry ? bundleEntry.size : 0;
  // 期望值 = 清单原始和 + 非合并包文件的降级增量 + logic.bundle.js 的最终增量
  //   （跑了压缩 ⇒ 用「压缩后 - 原始」；没跑（--no-minify）⇒ 退回用降级增量）
  const bundleAdjust = bundleFinalSize != null ? bundleFinalSize - bundlePre : bundleEs5Delta;
  const want = totalBytes + es5Delta + bundleAdjust;
  const why = [
    es5Delta ? `非合并包 ES5 降级 +${es5Delta} B` : "",
    bundleFinalSize != null ? `logic.bundle.js 压缩 ${bundleAdjust} B（${KB(bundlePre)} → ${KB(bundleFinalSize)}）`
      : (bundleEs5Delta ? `logic.bundle.js 降级 +${bundleEs5Delta} B（未压缩）` : ""),
  ].filter(Boolean).join("；");
  console.log(`   复查落盘: 清单 ${n} 个 / ${listBytes} B  ` +
    (listBytes === want ? `✓ 与清单逐项一致${why ? `（${why}）` : ""}`
      : `⚠️ 与清单不一致（清单应 ${want} B，差 ${listBytes - want} B）`));
  if (missing.length) console.log(`   ⚠️ 清单里有、盘上没有 ${missing.length} 个: ${missing.slice(0, 8).join(", ")}`);
  if (extra.length) {
    console.log(`   ⚠️ 盘上有、清单里没有 ${extra.length} 个（会白占包体，正式打包前应清掉）:`);
    for (const e of extra.slice(0, 12)) console.log(`      · ${e}`);
  }
}
