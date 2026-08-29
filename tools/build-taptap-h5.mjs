// build-taptap-h5.mjs — TapTap H5 确定性构建工具（RC9）
//
// 设计约束：
//  - 必须从固定提交导出，而非复制当前脏工作区：
//      git -c core.autocrlf=false -c core.eol=lf archive <SOURCE_SHA>
//  - 只产出游戏运行必需内容；排除 demo/lab/candidates/capital 原型页/audit/tools/docs 等。
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
  if (!idxClean) throw new Error("staged 非空（git diff --cached 非空）");
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
  if (/^css\/[^/]+\.css$/.test(rel)) {
    const base = rel.split("/").pop().toLowerCase();
    if (base === "ship-lab.css" || base === "three-demo.css") return false;
    return true;
  }
  if (/^js\/.*\.js$/.test(rel)) {
    if (rel.includes("three-demo") || rel.includes("ship-lab")) return false;
    return true;
  }
  if (/^images\//.test(rel)) return true;
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

// ---------- 单次构建 ----------
async function buildOnce(SOURCE_SHA, includeProbe) {
  const map = new Map();
  let commitFiles = null; // archive 模式缓存 commit 树 Map（已换行规范化），供 vendor 复用

  if (WORKTREE_SELFTEST) {
    // 游戏运行文件（index.html/css/js/images 白名单）从工作区读取 + 换行规范化
    const wt = loadWorktreeFiles(REPO, ["index.html", "css", "js", "images"], {
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

  // 本地化 index.html
  if (!map.has("index.html")) fail("包内缺少 index.html");
  map.set("index.html", Buffer.from(localizeIndexHtml(map.get("index.html").toString("utf8"), includeProbe), "utf8"));

  // 排序键（确定性）
  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));

  // 确定性 ZIP + manifest
  const buffer = await createDeterministicZip(JSZip, keys, map, PKG_TOP, FIXED_DATE);
  const manifest = createFileManifest(keys, map, PKG_TOP);

  return { buffer, manifest, count: keys.length };
}

// ---------- 校验 ----------
function verifyPackage(buffer, mode, includeProbe) {
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
  if (MODE === "release") {
    CURRENT_RC = readRcCounter() + 1;
    writeRcCounter(CURRENT_RC);
  } else {
    CURRENT_RC = readRcCounter();
  }
  ZIP_NAME = MODE === "release"
    ? "deep-space-idle-taptap-rc" + CURRENT_RC + ".zip"
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

  fs.mkdirSync(OUTDIR, { recursive: true });

  // release 模式：先内部构建同名 selftest 包，供跨模式一致性校验（证明唯一差异=探针）
  if (MODE === "release") {
    const sBuild = await buildOnce(SOURCE_SHA, true);
    const sVerify = await verifyPackage(sBuild.buffer, "selftest", true);
    const sFailList = sVerify.filter((r) => !r.pass);
    if (sFailList.length) {
      console.error("selftest 内部构建校验失败:");
      for (const r of sFailList) console.error("  FAIL " + r.name + (r.detail ? "  [" + r.detail + "]" : ""));
      process.exit(2);
    }
    fs.writeFileSync(path.join(OUTDIR, "deep-space-idle-taptap-rc" + CURRENT_RC + "-selftest.zip"), sBuild.buffer);
    console.log("[SELFTEST] 已生成匹配 selftest 包以供跨模式校验");
  }

  console.log("\n--- 第一次构建 ---");
  const b1 = await buildOnce(SOURCE_SHA, INCLUDE_PROBE);
  const v1 = await verifyPackage(b1.buffer, MODE, INCLUDE_PROBE);
  let allPass = true;
  for (const r of v1) { console.log((r.pass ? "PASS " : "FAIL ") + r.name + (r.detail ? "  [" + r.detail + "]" : "")); if (!r.pass) allPass = false; }

  console.log("\n--- 第二次构建（确定性复验）---");
  const b2 = await buildOnce(SOURCE_SHA, INCLUDE_PROBE);
  const v2 = await verifyPackage(b2.buffer, MODE, INCLUDE_PROBE);
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
  console.log("顶层结构: " + PKG_TOP + "/ (index.html + css/ + js/ + images/ + assets/vendor/taptap-h5/" + (INCLUDE_PROBE ? " + taptap-compat-probe.mjs" : "") + ")");

  console.log("\n=== 结论: " + (allPass ? "全部校验通过 ✓" : "存在失败项 ✗") + " ===");
  process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error("构建失败:", e); process.exit(2); });
