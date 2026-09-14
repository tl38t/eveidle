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
const isEsmFile = (rel) =>
  /^\s*(import|export)\s/m.test(fs.readFileSync(path.join(ROOT, rel), "utf8"));
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
  const stub = forwarderStubs.get(rel);
  if (stub) {
    files.push({ rel, abs: null, pkg, outRel: (SUBROOT[pkg] || "") + rel, size: Buffer.byteLength(stub, "utf8"), gen: stub });
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

  // 非合并模块（ESM / 内部相对 require）逐个容错加载：
  //   它们不属于逻辑层，任一失败（典型：ESM 的裸包名 import "three" 在微信无 importmap 可解析）
  //   都不应阻断已加载的逻辑层。失败清单必须显式打出（禁静默），并挂 GameGlobal 供工具控制台查看。
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
require("./wx/shim.js");
require("./boot.js")();
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
   ESM 用裸包名（three / three/addons/…）依赖 index.html 的 importmap，小游戏无 importmap ⇒ 预期会失败。
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
  for (const f of ["game.js", "game.json", "boot.js", "logic.bundle.js", "wx/shim.js"]) {
    const p = path.join(OUT, f);
    if (fs.existsSync(p)) { onDisk += fs.statSync(p).size; n++; }
  }
  console.log(`   复查落盘: ${n} 个 / ${onDisk} B  ${onDisk === totalBytes || n > files.length ? "(已含入口文件)" : "⚠️ 与清单不一致"}`);
}
