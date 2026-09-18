// build-taptap-h5.mjs — TapTap H5 确定性构建工具（RC9）
//
// 设计约束：
//  - 必须从固定提交导出，而非复制当前脏工作区：
//      git -c core.autocrlf=false -c core.eol=lf archive <SOURCE_SHA>
//  - 只产出游戏运行必需内容；排除 demo/lab/candidates/capital 原型页/audit/tools/docs 等。
//    例外（2026-09-12）：`assets/achievements/**` 与 `demo-assets/**` 是生产 JS 字符串拼接引用的
//    运行期图片（成就图标、虫洞地图背景），必须随包；详见 isWhitelisted()。
//  - 静态资源漏打双闸 + 对账（2026-09-12 加固）：① isWhitelisted() 按「目录 + 图片后缀」放行；
//    ② worktree 目录清单（两把独立的锁）③ verifyPackage 的包内完整性断言；④ **静态资源引用对账**
//    （见 collectSourceUniverse / auditAssetRefCoverage）——遍历包内 JS/CSS 文本里的字符串字面量，
//    凡是引用了源码树中「媒体目录」的，就要求该目录下媒体文件全部在包内。
//    ③ 是「已知的两个目录」的白名单式兜底，④ 是**整类漏打**的结构化拦截（新目录自动生效）。
//  - CDN 替换只发生在“构建后的暂存包 index.html”，不修改工作区正式 index.html。
//  - 输出目录在仓库外：D:\EVE-IDLE\TAPTAP-H5-OUTPUT\
//  - ZIP 内仅一个顶层英文目录 deep-space-idle/，其下直接含 index.html。
//  - 构建两次，校验文件清单 / 各文件 SHA-256 / 最终 ZIP SHA-256 一致（确定性）。
//  - 来源 SHA 不得硬编码：由 --source-sha 提供，且必须等于本次构建时的当前 HEAD，
//    同时要求工作分支为 main、tracked 工作树干净、staged 为空。
//  - 模式：`--mode selftest` 注入探针，输出 deep-space-idle-taptap-rc{N}-selftest.zip；
//          `--mode release` 完全不注入探针，输出 deep-space-idle-taptap-rc{N}.zip。
//          RC 号由 tools/rc-counter.txt 持久化：release 每次 +1，selftest 复用当前号；
//          release 模式会内部生成同名 selftest 包供跨模式一致性校验。
//
// 共享能力抽取（Phase C）：确定性构建核心（换行规范化、archive/worktree 来源读取、
// 确定性 ZIP、manifest、一致性比较）位于 tools/lib/release-runtime.mjs。
// 本文件保留 TapTap 专属：RC 计数器、ZIP 命名、文件白名单、CDN 本地化、
// 探针注入、包验证、输出目录、selftest/release 模式。
//
// 换行规范（Phase C / C.1）：所有明确文本发布文件（index.html/css/js/images/vendor
// 的 .html/.css/.js/.mjs/.json/.txt/.svg/.xml）在入包前统一 CRLF/孤立 CR -> LF，
// 使 archive（commit LF）与 worktree（工作区 CRLF）两种来源字节一致。archive 模式
// 游戏文件、vendor、探针均来自指定 source SHA 的 commit 树（git archive 给出 LF）；
// worktree 模式从工作区读取并走同一 TEXT_NORMALIZER 管线（CRLF->LF）。两类模式
// 输出字节一致；二进制字体/图片等保持原字节；无 vendor CSS 例外。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  sha256,
  normalizeTextBytes,
  gitArchiveBuffer,
  loadCommitFiles,
  loadWorktreeFiles,
  createFileManifest,
  createDeterministicZip,
  compareBuildResults,
} from "./lib/release-runtime.mjs";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const REPO = path.resolve(process.cwd());
const OUTDIR = "D:/EVE-IDLE/TAPTAP-H5-OUTPUT";
const PKG_TOP = "deep-space-idle";
const PROBE_SRC = path.join(REPO, "tools", "taptap-compat-probe.mjs");
const FIXED_DATE = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
const MAX_BYTES = 300 * 1024 * 1024;

// 已删除的退役素材（PNG 物理删除 + 生产引用移除），包内必须零命中。
const DEAD_PNG_PATHS = ["天使侦查舰.png", "裂谷级.png"];

// Three.js r180 MIT LICENSE 权威 SHA-256（与官方 raw.githubusercontent.com/mrdoob/three.js/r180/LICENSE 逐字一致）
const LICENSE_THREE_SHA = "bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601";

// ---- 模式 ----
function parseMode() {
  const idx = process.argv.findIndex((a) => a === "--mode" || a.startsWith("--mode="));
  if (idx >= 0) {
    if (process.argv[idx].startsWith("--mode=")) return process.argv[idx].slice("--mode=".length);
    const next = process.argv[idx + 1];
    if (next && !next.startsWith("--")) return next;
    throw new Error("`--mode` 缺少取值（selftest / release）");
  }
  return process.env.TAPTAP_INCLUDE_PROBE === "0" ? "release" : "selftest";
}
const MODE = parseMode();
if (MODE !== "selftest" && MODE !== "release") {
  throw new Error("未知 --mode: " + MODE + "（仅支持 selftest / release）");
}
const INCLUDE_PROBE = MODE === "selftest";
const WORKTREE_SELFTEST = process.argv.includes("--worktree-selftest");
const SKIP_CLOUD_CHECK = process.argv.includes("--skip-cloud-check");
if (SKIP_CLOUD_CHECK && MODE !== "selftest") {
  throw new Error("--skip-cloud-check 仅允许用于 selftest 包");
}
if (WORKTREE_SELFTEST && MODE !== "selftest") {
  throw new Error("--worktree-selftest is restricted to --mode selftest");
}
// RC 计数器：每次生成 release 包时 +1；selftest/worktree-selftest 复用当前 RC 号（不 +1）。
// 计数器存于 tools/rc-counter.txt（已加入 .gitignore，纯本地、不进包、不进仓库）。
const COUNTER_PATH = path.join(REPO, "tools", "rc-counter.txt");
function readRcCounter() {
  try {
    const v = Number(fs.readFileSync(COUNTER_PATH, "utf8").trim());
    if (Number.isFinite(v) && v >= 0) return v;
  } catch (_) { /* 缺失则用默认基线 9（已发布至 rc9） */ }
  return 9;
}
function writeRcCounter(n) { fs.writeFileSync(COUNTER_PATH, String(n)); }
let ZIP_NAME = "";      // 在 main 流程中按 RC 计算
let CURRENT_RC = 0;     // 当前构建使用的 RC 号

// ---- 展示版本号（给玩家看的版本，如 0.7.1）----
// 规则：每次封包最后一位 +1；但同一自然日内无论封包多少次只 +1 一次。
// 存于 tools/build-version.json（加入 .gitignore，纯本地、不进包、不进仓库，与 rc-counter.txt 同策略）。
const VERSION_PATH = path.join(REPO, "tools", "build-version.json");
let BUILD_VERSION = "0.7.1";
function readBuildVersion() {
  try {
    const o = JSON.parse(fs.readFileSync(VERSION_PATH, "utf8"));
    if (o && typeof o.version === "string") {
      return { version: o.version, lastBumpDate: typeof o.lastBumpDate === "string" ? o.lastBumpDate : "" };
    }
  } catch (_) { /* 缺失则回退基线 0.7.1 */ }
  return { version: "0.7.1", lastBumpDate: "" };
}
function writeBuildVersion(v) { fs.writeFileSync(VERSION_PATH, JSON.stringify(v, null, 2) + "\n"); }
function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || "");
  if (!m) return "0.7.1";
  return `${Number(m[1])}.${Number(m[2])}.${Number(m[3]) + 1}`;
}

// ---- 来源 SHA（--source-sha，必须 == 当前 HEAD）----
function parseSourceSha() {
  const idx = process.argv.findIndex((a) => a === "--source-sha" || a.startsWith("--source-sha="));
  if (idx < 0) return null;
  if (process.argv[idx].startsWith("--source-sha=")) return process.argv[idx].slice("--source-sha=".length);
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

// ---- 仓库状态守卫 ----
function checkRepoState() {
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  if (branch !== "main") throw new Error("工作分支必须为 main，当前: " + branch);
  const idxClean = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: REPO }).status === 0;
  // selftest 明确从当前工作树读取白名单文件；暂存的成就图标也属于当前工作树内容，
  // 因此允许 staged 非空。正式 release 仍必须保持 staged 为空。
  if (!idxClean && !WORKTREE_SELFTEST) throw new Error("staged 非空（git diff --cached 非空）");
  if (WORKTREE_SELFTEST) return;
  const wtClean = spawnSync("git", ["diff", "--quiet"], { cwd: REPO }).status === 0;
  if (!wtClean) throw new Error("tracked 工作树不干净（git diff 非空）");
}

const fail = (m) => { throw new Error(m); };

// ---------- 白名单 ----------
function isWhitelisted(rel) {
  // QA 种子（js/qa-seed.js）仅用于本地验收，禁止进入任何 TapTap 包（selftest / release 均排除）
  if (rel === "js/qa-seed.js") return false;
  // Steam 适配器为「合同预留、未签约」状态，严禁进入任何 TapTap 发布包（selftest / release 均排除）
  if (rel.startsWith("js/platform/steam/")) return false;
  // 精确许可证白名单（修复 release 对白名单 .txt 许可证的遗漏）
  if (rel === "js/vendor/LICENSE_THREE.txt") return true;
  if (rel === "index.html") return true;
  // 军团星图：index.html 星图面板以 iframe 引用 legion-starmap-pure.html，
  // 该页又引用同目录的 legion-starmap-pure-content.js / -events.js，三者须一并随包发布，否则打包后必然 404。
  // 2026-09-03：旧文件名 legion-starmap.html 已重命名为 *-pure.html（旧文件已删），
  // 同步更新白名单；兼容新旧两种命名，避免再次因改名漏包。
  // 注：两个配套 js 位于仓库根目录，不匹配下方 `^js\/.*\.js$` 规则，必须在此显式放行。
  // 已校验：无 CDN 外链、无探针 key、无测试文案、无 window.QA / ?qa= 入口。
  if (/^legion-starmap(-pure)?\.html$/.test(rel)) return true;
  if (/^legion-starmap(-pure)?-(content|events)\.js$/.test(rel)) return true;
  if (/^css\/[^/]+\.css$/.test(rel)) {
    const base = rel.split("/").pop().toLowerCase();
    if (base === "ship-lab.css" || base === "three-demo.css") return false;
    return true;
  }
  // de / ru 目录仅随 Steam（Electron）包发布，不进 TapTap H5 包（避免体积膨胀）。
  // index.html 也只在检测到 Steam 运行时才注入对应 <script>，此处再拦一道，双保险。
  if (rel === "js/i18n/catalog-de.js" || rel === "js/i18n/catalog-ru.js") return false;
  if (/^js\/.*\.js$/.test(rel)) {
    if (rel.includes("three-demo") || rel.includes("ship-lab")) return false;
    return true;
  }
  if (/^images\//.test(rel)) return true;
  // 静态资源：**字符串拼接路径**，打包器的引用收集看不见（只认 html 的 src/href、css 的 url()、
  // js 的 from/import）⇒ 白名单漏一行就是整目录静默漏打，且 verifyPackage 也不会报。
  // 2026-09-12 事故：成就图标 232 张 + 虫洞地图背景图 1 张，rc1→rc70 **所有历史包**全 0 张，
  // 玩家侧成就页每张卡都是「破图 + alt 文本」。故此处按**目录 + 图片后缀**放行（不逐文件列举，
  // 避免以后加图时再静默漏打），并在 verifyPackage 里加包内完整性断言兜底。
  //   - js/ui/shell-render.js:getAchievementIconPath → "./assets/achievements/<achieved|unachieved>/<ID>.png"
  //   - js/ui/wormhole-map.js:34                → "./demo-assets/wormhole-map-bg.png"
  //   `..` 一律拒绝（与 verifyPackage 的「无 .. 穿越」断言同向；`.+` 会放过 "../.." 这种段）。
  if (!rel.includes("..")) {
    if (/^assets\/achievements\/.+\.(png|webp|jpg|jpeg|gif|svg)$/i.test(rel)) return true;
    if (/^demo-assets\/.+\.(png|webp|jpg|jpeg|gif|svg)$/i.test(rel)) return true;
  }
  return false;
}

// ---------- 来源读取（archive / worktree 共用换行规范化管线）----------
// 所有明确文本发布文件（含 vendor CSS/TXT）统一 CRLF/孤立 CR -> LF，
// 使 archive（commit LF）与 worktree（工作区 CRLF）两种来源在确定性打包前字节一致。
// 无 vendor CSS 例外；二进制字体/图片等保持原字节（normalizeTextBytes 按扩展名白名单处理）。
const TEXT_NORMALIZER = (rel, buf) => normalizeTextBytes(rel, buf);

// ---------- 本地化 index.html ----------
function localizeIndexHtml(html, includeProbe) {
  let out = html;
  // 移除本地 QA 入口脚本（js/qa-seed.js 仅用于本地验收，禁止进入发布包；无论 selftest/release）
  out = out.replace(/<script[^>]*src=["'][^"']*js\/qa-seed\.js[^"']*["'][^>]*>\s*<\/script>\s*/g, "");
  // 移除 Steam 适配器引用（合同预留、未签约；js/platform/steam/** 被构建硬排除严禁进 TapTap 包，
  // 与 qa-seed 同模式在本地化阶段摘除 index.html 引用，使 selftest"引用可在包内找到"通过且不向 TapTap 泄露 Steam 代码）
  out = out.replace(/<script[^>]*src=["'][^"']*js\/platform\/steam\/[^"']*["'][^>]*>\s*<\/script>\s*/g, "");
  // 移除 Steam 专属 i18n（de / ru）注入块。该块本就在运行时判定 isSteam 才注入（TapTap 恒 false），
  // 但 document.write 的参数字符串里含 `src="./js/i18n/catalog-de.js?v=1"` 字面量，会被 collectRefs
  // 当作本地引用，导致「本地静态引用均可在包内找到」断言失败（这两个文件已被 isWhitelisted 排除）。
  // 故按 marker 整块剥离，与 qa-seed / steam 引用同模式。
  out = out.replace(/<!--\s*steam-i18n-de-ru:start\s*-->[\s\S]*?<!--\s*steam-i18n-de-ru:end\s*-->\s*/g, "");
  out = out.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/g, "");
  out = out.replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*/g, "");
  out = out.replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Orbitron:[^"]*" rel="stylesheet">\s*/g, "");
  out = out.replace(
    /<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.5\.0\/css\/all\.min\.css">/,
    '<link rel="stylesheet" href="./assets/vendor/taptap-h5/fonts/fonts.css">\n' +
    '<link rel="stylesheet" href="./assets/vendor/taptap-h5/fontawesome/css/all.min.css">'
  );
  if (includeProbe) {
    out = out.replace(
      "</body>",
      '<script type="module" src="./taptap-compat-probe.mjs"></script>\n</body>'
    );
  }
  return out;
}

// ---------- 解析本地引用 ----------
function resolveRef(baseDir, ref) {
  if (/^https?:\/\//i.test(ref) || ref.startsWith("//") || ref.startsWith("data:") || ref.startsWith("#")) return null;
  ref = ref.split("?")[0].split("#")[0];
  if (ref.startsWith("/")) ref = ref.slice(1);
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function collectRefs(rel, content) {
  const refs = [];
  const rootRel = rel.startsWith(PKG_TOP + "/") ? rel.slice(PKG_TOP.length + 1) : rel;
  const baseDir = rootRel.includes("/") ? rootRel.slice(0, rootRel.lastIndexOf("/")) : "";
  if (rel.endsWith(".html")) {
    for (const m of content.matchAll(/(?:href|src)="([^"]+)"/g)) refs.push(m[1]);
  } else if (rel.endsWith(".css")) {
    for (const m of content.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) refs.push(m[1]);
  } else if (rel.endsWith(".js") || rel.endsWith(".mjs")) {
    for (const m of content.matchAll(/(?:from|import)\s+["'](\.[^"']+)["']/g)) refs.push(m[1]);
  }
  return refs.map((r) => resolveRef(baseDir, r)).filter(Boolean);
}

// ---------- 静态资源引用对账（collectRefs 的补充：字符串拼接路径）----------
// 起因（2026-09-12 事故）：collectRefs 只认 html 的 src/href、css 的 url()、js 的 from/import，
// **看不见 JS 里用字符串拼接出来的资源路径**（`"./assets/achievements/" + dir + id + ".png"`）
// ⇒ 漏打完全静默：`assets/achievements/**`（232 张）与 `demo-assets/**`（1 张）从 rc1 到 rc70
// 一直没进任何包，玩家侧成就页每张卡都是「破图 + alt 文本」；而 verifyPackage 第 10 条
// 「本地静态引用均可在包内找到」只遍历 collectRefs 的产物，对拼接路径天然免疫，照样全绿。
//
// 规则 = 「媒体目录可达性对账」，**不解析语法、不做 string tokenizer**：
//   1. 源码树清单 = 工作区 `git ls-files` + `--others --exclude-standard`（排除 node_modules/.git）。
//      ★ 刻意用**工作区**而非 commit 树：让「新增了图片但忘了 git add / 忘了进白名单」也被抓到
//        —— 成就图标事故发生时它们正是 untracked。release 模式仍从 commit 树取包内容，
//        故此项等于「commit 树 vs 工作区」的漂移哨兵。
//   2. 由源码树里所有**媒体文件**（图片/字体/音视频）推出「媒体目录」集合（含全部祖先；仓库根不算）。
//   3. 扫**包内** .js/.mjs/.css/.html 的文本，抽**左引号邻接**的路径 token：
//        匹配「`"` / `'` / `` ` `` 紧跟 seg/seg…」的位置，例 `"./assets/achievements/"`、
//        `"./demo-assets/wormhole-map-bg.png"`；去掉前导 `./` 或 `/` 后按**目录形态 / 文件形态**
//        分别展开（详见 referencedPathRefs 的注释）。
//      ★ 左引号邻接是**误报闸门**：翻译文案 `"Paste archive/progress code"` 与注释
//        `// …derived from design/titan-three-view-v1.png` 都因路径前是空格而被排除。
//        （实测：不加此约束会误报 `archive/` 与 `design/` 两个目录，都是正文里的巧合路径。）
//   4. 两类命中都要求「在包内」：① 被引用的**媒体目录** D ⇒ D 下媒体文件必须全部在包内；
//        ② 被引用的**具体媒体文件** F（且源码树中确实存在 F）⇒ F 必须在包内。
//      ★ ①只要求「D 下全部**媒体**」而非「全部文件」：D 里可能混有 .js/.json 等非媒体成员；
//        ②则给「父目录只有 1 段」的情况精确兜底（`demo-assets/` 就是这种）。
//      方向是「包内 ⊇ 被引用者」**单向**断言，允许包内多带（多带不报）。
//
// 已知边界（有意为之，勿当 bug 修）：
//   - 注释/文案里写成**带引号**的路径仍会算作引用（如 `// 见 "./assets/x/"`）⇒ 宁可多要求，不漏打。
//   - 改成非媒体后缀（.bin）或运行时拼装的动态路径本规则看不见，属**新一类**漏打；届时优先扩本函数。
const MEDIA_EXT_RE = /\.(png|jpe?g|webp|gif|svg|bmp|ico|woff2?|ttf|otf|eot|mp3|ogg|wav|m4a|mp4|webm)$/i;
const REF_SCANABLE_RE = /\.(js|mjs|css|html)$/i;

// 取工作区源码树文件清单（tracked + untracked-not-ignored）
function collectSourceUniverse(repo) {
  const ls = (args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.status !== 0) return null;
    return r.stdout.split("\0").filter(Boolean);
  };
  const tracked = ls(["ls-files", "-z"]);
  const others = ls(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (tracked === null || others === null) fail("静态资源引用对账：git ls-files 失败（无法枚举工作区）");
  const all = [...new Set([...tracked, ...others])]
    .filter((f) => !f.startsWith("node_modules/") && !f.startsWith(".git/"));
  if (!all.length) fail("静态资源引用对账：工作区文件清单为空");
  return all;
}

// 源码树文件清单 → 「媒体目录 → 该目录下媒体文件清单」
function buildMediaDirIndex(sourceFiles) {
  const index = new Map();
  for (const f of sourceFiles) {
    if (!MEDIA_EXT_RE.test(f)) continue;
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join("/");
      if (!index.has(d)) index.set(d, []);
      index.get(d).push(f);
    }
  }
  return index;
}

// 包内文本 → 左引号邻接路径 token 解析出的**目录集合**与**整文件集合**。
// 分两种形态处理（这是落地过程中实测踩出来的：一刀切会把 `demo-assets` 整条保护线漏掉）：
//   A) 目录形态（token 以 `/` 结尾，作者明写了「这是个目录」，如 `"./assets/achievements/"`）
//        ⇒ 收该目录本身（**不限深度**）+ 其祖先中深度 ≥ 2 的目录。
//        祖先也要收，是为了 `"./assets/achievements/achieved/"` 这种写深一层时，
//        仍能覆盖到 `assets/achievements` 这一级（否则 unachieved/ 会漏出保护网）。
//   B) 文件形态（如 `"./demo-assets/wormhole-map-bg.png"`）
//        ⇒ 收**该文件本身** + 其祖先中深度 ≥ 2 的目录。
//        ★ 刻意**不收**「文件的父目录（若只有 1 段）」：否则只要出现任意 `"./assets/x.png"`，
//          `assets` 就会变成被引用目录，把 `assets/**` 下一切媒体都变成硬要求 ——
//          以后新增 `assets/design-notes/x.png`（非运行期资源、不进包）就会误报。
//        父目录只有 1 段时靠「整文件本身」精确兜底，语义反而更准。
function referencedPathRefs(content) {
  const dirs = new Set();
  const files = new Set();
  // 注意：正则字面量在函数内求值 ⇒ 每次都是新对象，不受 g 的 lastIndex 状态污染
  const re = /(["'`])([A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+\/?)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[2];
    const isDirForm = /\/+$/.test(raw);
    const t = raw.replace(/^\.\//, "").replace(/^\//, "").replace(/\/+$/, "");
    if (!t) continue;
    const parts = t.split("/");
    if (isDirForm) dirs.add(parts.join("/"));
    else files.add(parts.join("/"));
    for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return { dirs, files };
}

// 主对账。pkg = 包内根相对成员 Set；pkgTexts = [[根相对名, 文本]]；sourceFiles = 源码树清单
// 两类违规：
//   dirViolations  ——「被引用的媒体目录 D ⇒ D 下媒体文件必须全部在包内」
//   fileViolations ——「被引用的具体文件 F（源码树中确实存在）⇒ F 必须在包内」
function auditAssetRefCoverage(pkg, pkgTexts, sourceFiles) {
  const srcSet = new Set(sourceFiles || []);
  const mediaIndex = buildMediaDirIndex(sourceFiles || []);
  const refDirs = new Map();  // 被引用的媒体目录 -> 触发它的包内文件集合
  const refFiles = new Map(); // 被引用的具体文件 -> 触发它的包内文件集合
  for (const [rel, text] of pkgTexts) {
    const { dirs, files } = referencedPathRefs(text);
    for (const d of dirs) {
      if (!mediaIndex.has(d)) continue;
      if (!refDirs.has(d)) refDirs.set(d, new Set());
      refDirs.get(d).add(rel);
    }
    for (const f of files) {
      if (!srcSet.has(f) || !MEDIA_EXT_RE.test(f)) continue;
      if (!refFiles.has(f)) refFiles.set(f, new Set());
      refFiles.get(f).add(rel);
    }
  }
  const dirViolations = [];
  for (const [d, srcs] of refDirs) {
    const expected = mediaIndex.get(d);
    const missing = expected.filter((f) => !pkg.has(f));
    if (missing.length) dirViolations.push({ dir: d, total: expected.length, missing, sources: [...srcs].sort() });
  }
  const fileViolations = [];
  for (const [f, srcs] of refFiles) {
    if (!pkg.has(f)) fileViolations.push({ file: f, sources: [...srcs].sort() });
  }
  dirViolations.sort((a, b) => b.missing.length - a.missing.length);
  fileViolations.sort((a, b) => a.file.localeCompare(b.file));
  return { refDirs, refFiles, dirViolations, fileViolations, mediaDirCount: mediaIndex.size };
}

// ---------- 单次构建 ----------
async function buildOnce(SOURCE_SHA, includeProbe) {
  const map = new Map();
  let commitFiles = null; // archive 模式缓存 commit 树 Map（已换行规范化），供 vendor 复用

  if (WORKTREE_SELFTEST) {
    // 游戏运行文件（index.html/css/js/images + 两份字符串拼接引用的静态资源目录）从工作区读取 + 换行规范化。
    // ⚠️ 此清单与 isWhitelisted() 是**两把独立的锁**：目录不列进来，白名单放行也没用（2026-09-12 事故两侧都漏）。
    const wt = loadWorktreeFiles(REPO, [
      "index.html", "css", "js", "images", "assets/achievements", "demo-assets",
      "legion-starmap-pure.html", "legion-starmap-content.js",
      "legion-starmap-pure-content.js", "legion-starmap-pure-events.js",
    ], {
      fileFilter: isWhitelisted,
      transform: TEXT_NORMALIZER,
    });
    for (const [rel, buf] of wt) map.set(rel, buf);
  } else {
    // 游戏运行文件 + 探针均来自指定 source SHA（commit 树），归一化后不做工作区覆盖
    const archiveBuf = gitArchiveBuffer(REPO, SOURCE_SHA);
    const all = await loadCommitFiles(archiveBuf, JSZip, { transform: TEXT_NORMALIZER });
    commitFiles = all;
    for (const [rel, buf] of all) {
      if (isWhitelisted(rel)) map.set(rel, buf);
    }
    if (includeProbe) {
      const probe = all.get("tools/taptap-compat-probe.mjs");
      if (!probe) fail("探针源文件缺失（commit 中无 tools/taptap-compat-probe.mjs）");
      map.set("taptap-compat-probe.mjs", probe);
    }
  }

  // 本地化资源（assets/vendor/taptap-h5/**）——来源纯度修正（Phase C.1）
  //  archive 模式：来自指定 source SHA 的 commit 树（commitFiles 已含、已换行规范化），
  //    不再从工作区读取，消除 core.autocrlf 导致的跨机器换行不确定性。
  //  worktree-selftest 模式：从工作区读取并走同一 TEXT_NORMALIZER 管线（CRLF->LF），
  //    与 archive 模式输出字节一致；二进制字体/图片保持原字节。
  //  两类模式统一为 LF，无 vendor CSS 的 CRLF 例外。
  if (WORKTREE_SELFTEST) {
    const vendor = loadWorktreeFiles(REPO, ["assets/vendor/taptap-h5"], { transform: TEXT_NORMALIZER });
    for (const [rel, buf] of vendor) map.set(rel, buf);
  } else {
    for (const [rel, buf] of commitFiles) {
      if (rel.startsWith("assets/vendor/taptap-h5/")) map.set(rel, buf);
    }
  }

  // 探针（worktree 模式从工作区读取并规范化；archive 模式已在上方从 commit 树注入）
  if (includeProbe && WORKTREE_SELFTEST) {
    if (!fs.existsSync(PROBE_SRC)) fail("探针源文件缺失: " + PROBE_SRC);
    map.set("taptap-compat-probe.mjs", normalizeTextBytes("taptap-compat-probe.mjs", fs.readFileSync(PROBE_SRC)));
  }

  // ---- 广告调试探针门控（release/selftest 包强制关闭本地调试开关）----
  // ad-buff-widget.js 在本地开发时允许 ?debugAd=1 / localStorage.debugAd=1 唤出广告诊断浮层；
  // 发布包必须忽略这些用户可调开关，避免诊断浮层在用户侧显示。
  const ADBUFF_REL = "js/ui/ad-buff-widget.js";
  if (map.has(ADBUFF_REL)) {
    let c = map.get(ADBUFF_REL).toString("utf8");
    c = c.replace(/const\s+DEBUG\s*=\s*isAdDebug\s*\(\s*\)\s*;/, "const DEBUG = false;");
    map.set(ADBUFF_REL, Buffer.from(c, "utf8"));
  }

  // 云存档跳过自测：仅注入 selftest 包，正式 release 永远不包含此分支。
  // 保留本地/设备镜像读取；有本地候选就直接使用，没有则直接进入新档。
  if (SKIP_CLOUD_CHECK) {
    const rel = "js/core/persistence.js";
    if (!map.has(rel)) fail("自测包缺少 " + rel);
    let c = map.get(rel).toString("utf8");
    const marker = "  _runCloudStartup() {\n    const self = this;\n    const cs = this._cloudSave;\n    const device = this._deviceCandidate;";
    const injected = marker + "\n    // SELFTEST_ONLY: skip cloud archive probing.\n    if (true) {\n      if (device) {\n        this._applySelectedEnvelope(device.envelope, device.source);\n        return this._commitFinal(\"local-only\", { persist: device.source !== \"local\", upload: \"none\", ensureMirror: true });\n      }\n      this._prepareFreshState();\n      return this._commitFinal(\"local-only\", { persist: true, upload: \"none\", ensureMirror: true });\n    }";
    if (!c.includes(marker)) fail("无法定位云存档启动入口，拒绝生成跳过检查自测包");
    c = c.replace(marker, injected);
    map.set(rel, Buffer.from(c, "utf8"));
  }

  // 本地化 index.html
  if (!map.has("index.html")) fail("包内缺少 index.html");
  map.set("index.html", Buffer.from(localizeIndexHtml(map.get("index.html").toString("utf8"), includeProbe), "utf8"));

  // 注入展示版本号（window.GAME_VERSION）：替换 index.html 中的占位声明
  if (map.has("index.html")) {
    const vhtml = map.get("index.html").toString("utf8").replace(
      /window\.GAME_VERSION\s*=\s*"[^"]*";/,
      `window.GAME_VERSION = "${BUILD_VERSION}";`
    );
    map.set("index.html", Buffer.from(vhtml, "utf8"));
  }

  // 排序键（确定性）
  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));

  // 确定性 ZIP + manifest
  const buffer = await createDeterministicZip(JSZip, keys, map, PKG_TOP, FIXED_DATE);
  const manifest = createFileManifest(keys, map, PKG_TOP);

  return { buffer, manifest, count: keys.length };
}

// ---------- 校验 ----------
// sourceUniverse：工作区源码树文件清单（用「媒体目录可达性对账」，见 collectSourceUniverse）。
// 不给默认值：调用方必须显式传入，避免忘记传而让对账静默退化成空转。
function verifyPackage(buffer, mode, includeProbe, sourceUniverse) {
  const results = [];
  const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || "" });

  return (async () => {
    const z = await JSZip.loadAsync(buffer);
    const entries = [];
    z.forEach((p, f) => { if (!f.dir) entries.push(p); });
    const set = new Set(entries);
    const indexHtmlName = PKG_TOP + "/index.html";
    const indexBuf = set.has(indexHtmlName) ? await z.file(indexHtmlName).async("nodebuffer") : null;
    const indexTxt = indexBuf ? indexBuf.toString("utf8") : "";

    // 2) 体积
    ok("ZIP < 300MB", buffer.length < MAX_BYTES, (buffer.length / 1024 / 1024).toFixed(2) + " MB");
    // 3) 仅一个顶层目录
    const tops = new Set(entries.map((e) => e.split("/")[0]));
    ok("仅一个顶层目录", tops.size === 1 && tops.has(PKG_TOP), [...tops].join(","));
    // 4) 顶层目录名
    ok("顶层目录名=deep-space-idle", tops.has(PKG_TOP));
    // 5) index.html 位置
    ok("index.html 位于正确位置", set.has(indexHtmlName));
    // 6) 无 _MACOSX / 绝对路径 / .. / 多余顶层
    const bad = entries.filter(
      (e) => e.includes("_MACOSX") || e.startsWith("/") || e.includes("..") || e.split("/")[0] !== PKG_TOP
    );
    ok("无 _MACOSX/绝对路径/.. 穿越/多余顶层", bad.length === 0, bad.slice(0, 5).join(" | "));
    // 7) 排除清单零命中
    const FORBID = [/three-demo/i, /ship-lab/i, /candidates/i, /-demo\./i, /-prototype\./i, /\baudit/i, /debug/i, /^tools\//i, /\.md$/i, /\.csv$/i, /\.log$/i, /node_modules/i, /\.git/i, /eve_save/i];
    const hits = entries.filter((e) => FORBID.some((re) => re.test(e)));
    ok("排除清单零命中", hits.length === 0, hits.slice(0, 5).join(" | "));
    // 8)9) 探针注入一次 & 外链零残留
    const probeCount = (indexTxt.match(/taptap-compat-probe\.mjs/g) || []).length;
    ok("探针恰好注入一次", includeProbe ? probeCount === 1 : probeCount === 0, "count=" + probeCount);
    const extHit = (indexTxt.match(/fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare/i) || []);
    ok("index.html 外链零残留", extHit.length === 0, extHit.join(","));

    // QA 隔离硬断言（selftest / release 两种包都不得包含 qa-seed.js，index.html 不得引用）
    const qaFileHit = entries.filter((e) => /(^|\/)js\/qa-seed\.js$/.test(e));
    ok("QA 隔离: 包内不含 js/qa-seed.js", qaFileHit.length === 0, qaFileHit.join(" | "));
    ok("QA 隔离: 包内 index.html 不引用 qa-seed.js", !/qa-seed\.js/.test(indexTxt));

    // 静态资源完整性（2026-09-12 新增，两种模式都跑）
    //   起因：js/ui/shell-render.js 用字符串拼接出成就图标路径，打包器的 ref 收集永远看不见它，
    //   于是 assets/achievements/**（232 张）与 demo-assets/**（1 张）从 rc1 到 rc70 一直静默漏打，
    //   玩家侧成就页每张卡都是「破图 + alt 文本」，而所有既有断言全绿。
    //   期望值**不硬编码**（避免重蹈 verify.mjs EXPECTED_SCRIPTS 那种基线腐烂）：直接读**包内**
    //   js/data/achievements.js，数出 steam.enabled === true 的条目——成就页只渲染这些条目
    //   （shell-render.js:getAchievementsDisplayState 的 filter），故 achieved/ 与 unachieved/
    //   各应覆盖其全部 ID；多出来的 ID 也算错（说明图标与目录不同步）。
    const achCatalogName = PKG_TOP + "/js/data/achievements.js";
    const achCatalog = set.has(achCatalogName) ? await z.file(achCatalogName).async("string") : "";
    const expectedAchIds = achCatalog.split("\n")
      .filter((l) => /Object\.freeze\(\{\s*id:\s*"[A-Z]\d{2}"/.test(l) && /steam:\s*Object\.freeze\(\{\s*enabled:\s*true/.test(l))
      .map((l) => (l.match(/id:\s*"([A-Z]\d{2})"/) || [])[1])
      .filter(Boolean);
    const expectedAchSet = new Set(expectedAchIds);
    const achPngIds = (sub) => new Set(
      entries
        .map((e) => e.match(new RegExp("^" + PKG_TOP + "/assets/achievements/" + sub + "/([A-Z]\\d{2})\\.png$")))
        .filter(Boolean)
        .map((m) => m[1])
    );
    const achAchieved = achPngIds("achieved");
    const achUnachieved = achPngIds("unachieved");
    const missA = [...expectedAchSet].filter((id) => !achAchieved.has(id));
    const missU = [...expectedAchSet].filter((id) => !achUnachieved.has(id));
    const extraA = [...achAchieved].filter((id) => !expectedAchSet.has(id));
    const extraU = [...achUnachieved].filter((id) => !expectedAchSet.has(id));
    ok("成就图标: 包内目录可解析出期望 ID 集合", expectedAchSet.size > 0, "expected=" + expectedAchSet.size + (achCatalog ? "" : "（包内缺 achievements.js）"));
    ok("成就图标: achieved/ 覆盖全部期望 ID", missA.length === 0, "命中 " + achAchieved.size + " 缺 " + missA.length + ": " + missA.slice(0, 8).join(","));
    ok("成就图标: unachieved/ 覆盖全部期望 ID", missU.length === 0, "命中 " + achUnachieved.size + " 缺 " + missU.length + ": " + missU.slice(0, 8).join(","));
    ok("成就图标: 无目录外多余 ID", extraA.length === 0 && extraU.length === 0, "extra=" + extraA.concat(extraU).slice(0, 8).join(","));
    // 虫洞地图背景图：js/ui/wormhole-map.js 无条件 new Image().src = "./demo-assets/wormhole-map-bg.png"，
    // 缺图有径向渐变兜底、**不报错不破图**（所以更难发现），但属预期发布内容 ⇒ 硬断言存在。
    const whBgName = PKG_TOP + "/demo-assets/wormhole-map-bg.png";
    ok("虫洞地图背景图在包内", set.has(whBgName), whBgName);

    // 8b) release 专属：探针文件 / key 字符串 / 测试文案 / 全包 CDN 零残留
    const probeFile = PKG_TOP + "/taptap-compat-probe.mjs";
    if (mode === "release") {
      ok("release: 探针文件零残留", !set.has(probeFile));
      let keyHit = false, textHit = false, cdnHit = [];
      for (const e of entries) {
        if (!/\.(html|css|js|mjs)$/i.test(e)) continue;
        const c = await z.file(e).async("string");
        if (c.includes("deep_space_idle_taptap_probe_v1")) keyHit = true;
        if (/taptap-compat-probe|TapTap H5 探针|内部测试证据|自测探针/i.test(c)) textHit = true;
        const m = c.match(/fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare/gi);
        if (m) cdnHit.push(e + ":" + m.length);
      }
      ok("release: 探针 key 字符串零残留", !keyHit);
      ok("release: 测试文案零残留", !textHit);
      ok("release: 全包 Google Fonts/cdnjs 外链零残留", cdnHit.length === 0, cdnHit.join(" | "));

      // release 专属：运行文件不得含 window.QA 句柄与 ?qa= 场景入口
      const QA_SCENES = ["?qa=offline", "?qa=cargo", "?qa=enhance", "?qa=dismantle", "?qa=fitting"];
      let qaGlobalHit = false, qaSceneHit = false;
      for (const e of entries) {
        if (!/\.(html|css|js|mjs)$/i.test(e)) continue;
        const c = await z.file(e).async("string");
        if (/window\.QA\b/.test(c)) qaGlobalHit = true;
        if (QA_SCENES.some((s) => c.includes(s))) qaSceneHit = true;
      }
      ok("release: 运行文件不含 window.QA", !qaGlobalHit);
      ok("release: 运行文件不含 ?qa= 场景入口", !qaSceneHit);

      // release 专属：广告调试探针必须被强制关闭（防止 localStorage/URL debugAd=1 在发布包唤出诊断浮层）
      const adBuffFile = PKG_TOP + "/js/ui/ad-buff-widget.js";
      const adBuffContent = set.has(adBuffFile) ? await z.file(adBuffFile).async("string") : "";
      ok("release: 广告调试探针已关闭",
        /const\s+DEBUG\s*=\s*false\s*;/.test(adBuffContent) && !/const\s+DEBUG\s*=\s*isAdDebug\s*\(\s*\)\s*;/.test(adBuffContent));

      // 跨模式比对：与 selftest 产物证明“唯一差异=探针文件+index.html 注入标签”
      const selftestZip = path.join(OUTDIR, "deep-space-idle-taptap-rc" + CURRENT_RC + "-selftest.zip");
      if (fs.existsSync(selftestZip)) {
        try {
          const sz = await JSZip.loadAsync(fs.readFileSync(selftestZip));
          const sEntries = [];
          sz.forEach((p, f) => { if (!f.dir) sEntries.push(p); });
          const relProd = [...new Set(entries.filter((e) => e !== probeFile))].sort();
          const selfProd = [...new Set(sEntries.filter((e) => e !== probeFile))].sort();
          ok("跨模式生产文件清单一致（除探针）", relProd.join("\n") === selfProd.join("\n"));
          let allShaSame = true, diffFiles = [];
          for (const e of relProd) {
            if (e.endsWith("/index.html")) continue;
            const a = sha256(await z.file(e).async("nodebuffer"));
            const b = sha256(await sz.file(e).async("nodebuffer"));
            if (a !== b) { allShaSame = false; diffFiles.push(e); }
          }
          ok("跨模式生产文件内容一致（除 index.html 与探针）", allShaSame, diffFiles.slice(0, 5).join(" | "));
          const selfIdxBuf = sEntries.includes(indexHtmlName) ? await sz.file(indexHtmlName).async("string") : "";
          const selfIdxStripped = selfIdxBuf.replace(/<script type="module" src="\.\/taptap-compat-probe\.mjs"><\/script>\s*/g, "");
          ok("index.html 仅差异于探针注入标签", indexTxt === selfIdxStripped);
        } catch (err) {
          ok("跨模式比对", false, "异常: " + err.message);
        }
      } else {
        ok("跨模式比对(跳过)", true, "selftest 产物不存在，设计保证同 SHA+同白名单+同资源仅 INCLUDE_PROBE 差异");
      }
    }

    // E) 许可证专项校验（两类模式均断言；release 为硬性要求）
    const LIC_THREE = PKG_TOP + "/js/vendor/LICENSE_THREE.txt";
    const LIC_FA = PKG_TOP + "/assets/vendor/taptap-h5/fontawesome/license/LICENSE_fontawesome.txt";
    const LIC_ORBITRON = PKG_TOP + "/assets/vendor/taptap-h5/fonts/license/OFL_orbitron.txt";
    const LIC_RAJDHANI = PKG_TOP + "/assets/vendor/taptap-h5/fonts/license/OFL_rajdhani.txt";

    ok("Three.js MIT LICENSE 入包", set.has(LIC_THREE));
    if (set.has(LIC_THREE)) {
      const s = sha256(await z.file(LIC_THREE).async("nodebuffer"));
      ok("Three.js LICENSE SHA-256 匹配官方 r180", s === LICENSE_THREE_SHA, s);
    }
    const threeCore = PKG_TOP + "/js/vendor/three.core.js";
    if (set.has(threeCore)) {
      const t = await z.file(threeCore).async("string");
      const m = t.match(/REVISION\s*=\s*['"]?(\d+)['"]?/);
      ok("Three.js REVISION = 180", m && m[1] === "180", m ? m[1] : "未找到");
    } else ok("Three.js REVISION = 180", false, "three.core.js 缺失");

    ok("Font Awesome LICENSE 入包", set.has(LIC_FA));
    const faCss = PKG_TOP + "/assets/vendor/taptap-h5/fontawesome/css/all.min.css";
    if (set.has(faCss)) {
      const fc = await z.file(faCss).async("string");
      ok("Font Awesome 版本 = 6.5.0", /6\.5\.0/.test(fc), fc.includes("6.5.0") ? "6.5.0" : "未找到 6.5.0");
    } else ok("Font Awesome 版本 = 6.5.0", false, "all.min.css 缺失");

    for (const [name, p] of [["OFL_orbitron", LIC_ORBITRON], ["OFL_rajdhani", LIC_RAJDHANI]]) {
      const present = set.has(p);
      let nonempty = false;
      if (present) { const b = await z.file(p).async("nodebuffer"); nonempty = b.length > 0; }
      ok("OFL " + name + " 入包且非空", present && nonempty);
    }

    // F) 已删除素材零命中（退役 PNG 物理删除 + 引用移除）
    const deadFileHits = entries.filter((e) => DEAD_PNG_PATHS.some((d) => e.includes(d)));
    ok("已删除 PNG 文件名零命中", deadFileHits.length === 0, deadFileHits.slice(0, 5).join(" | "));
    let deadContentHit = false;
    for (const e of entries) {
      if (!/\.(html|css|js|mjs)$/i.test(e)) continue;
      const c = await z.file(e).async("string");
      if (/天使侦查舰\.png|裂谷级\.png/.test(c)) { deadContentHit = true; break; }
    }
    ok("已删除 PNG 路径字符串零命中（内容）", !deadContentHit);

    // 10) 本地静态引用可解析
    let missing = [];
    for (const e of entries) {
      if (!/\.(html|css|js|mjs)$/.test(e)) continue;
      const content = await z.file(e).async("string");
      for (const ref of collectRefs(e, content)) {
        if (!set.has(PKG_TOP + "/" + ref)) missing.push(e + " -> " + ref);
      }
    }
    ok("本地静态引用均可在包内找到", missing.length === 0, missing.slice(0, 8).join(" | "));

    // 10b) 静态资源引用对账（2026-09-12 加固）—— 覆盖上一条**看不见**的那一类：
    //      JS 里字符串拼接出来的资源路径（`"./assets/achievements/" + dir + id + ".png"`）。
    //      两类断言：①「被引用的媒体目录 ⇒ 其下媒体文件必须全部在包内」；
    //      ②「被引用的具体媒体文件（源码树中确实存在）⇒ 必须在包内」。
    //      反向哨兵由第 1 条断言承担：若规则静默失效（源码树清单拿不到 / 正则被改坏），
    //      被引用目录数会跌到 0 而**报错**，不是变成永真空转 ——
    //      这正是 verify.mjs 基线腐烂与本次漏打事故的共同教训：**断言本身也要有反向哨兵**。
    {
      const pkgRel = new Set(entries.map((e) => (e.startsWith(PKG_TOP + "/") ? e.slice(PKG_TOP.length + 1) : e)));
      const pkgTexts = [];
      for (const e of entries) {
        if (!REF_SCANABLE_RE.test(e)) continue;
        const rootRel = e.startsWith(PKG_TOP + "/") ? e.slice(PKG_TOP.length + 1) : e;
        pkgTexts.push([rootRel, await z.file(e).async("string")]);
      }
      const audit = auditAssetRefCoverage(pkgRel, pkgTexts, sourceUniverse);
      ok("静态资源引用对账: 规则有效（被引用媒体目录 ≥ 2）",
        audit.refDirs.size >= 2,
        "源码树媒体目录 " + audit.mediaDirCount + "，被引用目录 " + audit.refDirs.size +
        " / 被引用整文件 " + audit.refFiles.size + "：" + [...audit.refDirs.keys()].sort().join(", "));
      const refViolations = [
        ...audit.dirViolations.map((v) =>
          v.dir + " 缺 " + v.missing.length + "/" + v.total +
          "（引用自 " + v.sources.slice(0, 2).join(",") + "；例：" + v.missing.slice(0, 3).join(",") + "）"),
        ...audit.fileViolations.map((v) => v.file + " 整文件缺失（引用自 " + v.sources.slice(0, 2).join(",") + "）"),
      ];
      ok("静态资源引用对账: 被引用的媒体目录/文件全部在包内",
        refViolations.length === 0,
        refViolations.slice(0, 5).join(" | ") || "被引用目录 " + [...audit.refDirs.keys()].sort().join(", "));
    }
    // 11) Font Awesome webfonts 路径有效
    if (set.has(faCss)) {
      const txt = await z.file(faCss).async("string");
      const wf = [...txt.matchAll(/url\(\.\.\/webfonts\/([^)]+)\)/g)].map((m) => "assets/vendor/taptap-h5/fontawesome/webfonts/" + m[1]);
      const badWf = wf.filter((p) => !set.has(PKG_TOP + "/" + p));
      ok("Font Awesome webfonts 路径有效", badWf.length === 0, badWf.slice(0, 5).join(" | "));
    } else {
      ok("Font Awesome webfonts 路径有效", false, "all.min.css 缺失");
    }
    // 12) importmap 与 ship3d module 标签仍在
    ok("importmap 标签存在", /type="importmap"/.test(indexTxt));
    ok("ship3d module 标签存在", /ship3d\.js/.test(indexTxt));

    return results;
  })();
}

// ---------- 主流程 ----------
(async () => {
  // 2) 计算 RC 号：release 包每次 +1；selftest/worktree 复用当前号（不 +1）
  // 注意：release 的 +1 延迟到 selftest 内部构建校验通过后再写入，避免 repo/SHA/selftest 失败时跳号。
  if (MODE === "release") {
    CURRENT_RC = readRcCounter() + 1;
  } else {
    CURRENT_RC = readRcCounter();
  }

  // 计算展示版本号：仅 release 正式包才 +1，同一自然日仅 +1 一次（首次封包即从 0.7.1 -> 0.7.2）。
  // selftest / worktree 自测包不递增，仅读取当前版本号用于显示。
  if (MODE === "release") {
    const verState = readBuildVersion();
    const todayStr = todayLocalDate();
    if (todayStr !== verState.lastBumpDate) {
      BUILD_VERSION = bumpPatch(verState.version);
      writeBuildVersion({ version: BUILD_VERSION, lastBumpDate: todayStr });
      console.log("[VERSION] 构建版本递增: " + verState.version + " -> " + BUILD_VERSION + "（" + todayStr + "）");
    } else {
      BUILD_VERSION = verState.version;
      console.log("[VERSION] 构建版本（今日已递增，沿用）: " + BUILD_VERSION);
    }
  } else {
    BUILD_VERSION = readBuildVersion().version;
    console.log("[VERSION] 自测包不递增版本，沿用当前: " + BUILD_VERSION);
  }

  ZIP_NAME = MODE === "release"
    ? "deep-space-idle-taptap-rc" + CURRENT_RC + ".zip"
    : SKIP_CLOUD_CHECK
      ? "deep-space-idle-taptap-rc" + CURRENT_RC + "-skip-cloud-selftest.zip"
      : WORKTREE_SELFTEST
        ? "deep-space-idle-taptap-rc" + CURRENT_RC + "-worktree-selftest.zip"
        : "deep-space-idle-taptap-rc" + CURRENT_RC + "-selftest.zip";

  console.log("=== TapTap H5 构建（RC" + CURRENT_RC + "）===");
  console.log("模式: " + MODE + (INCLUDE_PROBE ? "（保留探针）" : "（正式候选包 RC" + CURRENT_RC + "，无探针）"));
  console.log("输出 ZIP: " + ZIP_NAME);
  if (WORKTREE_SELFTEST) console.log("[SELFTEST] 从当前工作区白名单文件构建；release 模式禁止使用此开关");

  // 0) 仓库状态守卫
  checkRepoState();
  console.log(WORKTREE_SELFTEST
    ? "[REPO] 分支=main，staged 为空；允许未提交工作区（仅 selftest） ✓"
    : "[REPO] 分支=main 且 tracked 工作树干净、staged 为空 ✓");

  // 1) 来源 SHA 校验
  const SOURCE_SHA = parseSourceSha();
  if (!SOURCE_SHA) fail("--source-sha <完整 SHA> 必须提供");
  if (!/^[0-9a-f]{40}$/i.test(SOURCE_SHA)) fail("--source-sha 不完整（需 40 位 hex）: " + SOURCE_SHA);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  const rev = spawnSync("git", ["rev-parse", SOURCE_SHA], { cwd: REPO, encoding: "utf8" }).stdout.trim();
  if (rev !== SOURCE_SHA) fail("来源 SHA 不存在于仓库: " + SOURCE_SHA);
  if (rev !== head) fail("来源 SHA 必须等于当前 HEAD (" + head + ")，得到 " + rev);
  console.log("[SHA] 来源校验通过，构建基线 HEAD = " + rev);

  // 静态资源引用对账的源码树基线。刻意取**工作区**（含 untracked，见 collectSourceUniverse 注释）：
  // 这样「新增图片但忘了 git add / 忘了进白名单」也会被抓到——成就图标事故发生时它们正是 untracked。
  const SOURCE_UNIVERSE = collectSourceUniverse(REPO);
  console.log("[ASSET-REF] 源码树基线文件数 = " + SOURCE_UNIVERSE.length + "（git ls-files + --others --exclude-standard）");

  fs.mkdirSync(OUTDIR, { recursive: true });

  // release 模式：先内部构建同名 selftest 包，供跨模式一致性校验（证明唯一差异=探针）
  if (MODE === "release") {
    const sBuild = await buildOnce(SOURCE_SHA, true);
    const sVerify = await verifyPackage(sBuild.buffer, "selftest", true, SOURCE_UNIVERSE);
    const sFailList = sVerify.filter((r) => !r.pass);
    if (sFailList.length) {
      console.error("selftest 内部构建校验失败:");
      for (const r of sFailList) console.error("  FAIL " + r.name + (r.detail ? "  [" + r.detail + "]" : ""));
      process.exit(2);
    }
    fs.writeFileSync(path.join(OUTDIR, "deep-space-idle-taptap-rc" + CURRENT_RC + "-selftest.zip"), sBuild.buffer);
    console.log("[SELFTEST] 已生成匹配 selftest 包以供跨模式校验");
    // release 内部 selftest 通过后再持久化 RC 号，避免前面任何失败导致跳号
    writeRcCounter(CURRENT_RC);
  }

  console.log("\n--- 第一次构建 ---");
  const b1 = await buildOnce(SOURCE_SHA, INCLUDE_PROBE);
  const v1 = await verifyPackage(b1.buffer, MODE, INCLUDE_PROBE, SOURCE_UNIVERSE);
  let allPass = true;
  for (const r of v1) { console.log((r.pass ? "PASS " : "FAIL ") + r.name + (r.detail ? "  [" + r.detail + "]" : "")); if (!r.pass) allPass = false; }

  console.log("\n--- 第二次构建（确定性复验）---");
  const b2 = await buildOnce(SOURCE_SHA, INCLUDE_PROBE);
  const v2 = await verifyPackage(b2.buffer, MODE, INCLUDE_PROBE, SOURCE_UNIVERSE);
  for (const r of v2) { console.log((r.pass ? "PASS " : "FAIL ") + r.name); if (!r.pass) allPass = false; }

  // 14) 两次构建一致
  const det = compareBuildResults(b1, b2);
  console.log("\n--- 确定性 ---");
  console.log((det.listSame ? "PASS " : "FAIL ") + "两次文件清单一致 (" + det.count + " 项)");
  console.log((det.hashSame ? "PASS " : "FAIL ") + "两次各文件 SHA-256 一致");
  console.log((det.zipSame ? "PASS " : "FAIL ") + "两次最终 ZIP SHA-256 一致 = " + det.zipSha256);
  if (!det.listSame || !det.hashSame || !det.zipSame) allPass = false;

  // 15) 写出最终 ZIP
  const finalPath = path.join(OUTDIR, ZIP_NAME);
  fs.writeFileSync(finalPath, b2.buffer);
  const finalSha = sha256(b2.buffer);
  console.log("\n--- 最终产物 ---");
  console.log("路径: " + finalPath);
  console.log("字节: " + b2.buffer.length);
  console.log("SHA-256: " + finalSha);
  console.log("文件数: " + b2.count);
  if (WORKTREE_SELFTEST) {
    const fingerprint = sha256(Buffer.from(b2.manifest.map((m) => m.rel + ":" + m.sha256).join("\n"), "utf8"));
    console.log("工作区包指纹 SHA-256: " + fingerprint);
    console.log("基线提交: " + SOURCE_SHA + " + 未提交工作区（仅供 TapTap 沙箱自测）");
  }
  console.log("顶层结构: " + PKG_TOP + "/ (index.html + css/ + js/ + images/ + assets/achievements/ + assets/vendor/taptap-h5/ + demo-assets/" + (INCLUDE_PROBE ? " + taptap-compat-probe.mjs" : "") + ")");

  console.log("\n=== 结论: " + (allPass ? "全部校验通过 ✓" : "存在失败项 ✗") + " ===");
  process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error("构建失败:", e); process.exit(2); });
