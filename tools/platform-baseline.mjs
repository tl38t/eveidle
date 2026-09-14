#!/usr/bin/env node
/* ============================================================================
 * platform-baseline.mjs —— TapTap / Steam 平台产物基线：捕获与漂移校验
 * ----------------------------------------------------------------------------
 * 用途（P5「冻结基线圈」）
 *   给「微信小游戏迁移对 Steam/TapTap 零影响」这条门禁一个**可机械执行的判据**
 *   （见 docs/WECHAT_MIGRATION_EXECUTION_PLAN_v0.1.md §七 收工门禁第 2 条）。
 *
 * 设计原则
 *   1. **不复制构建器逻辑**。TapTap 包的入包文件集与字节已由
 *      `deep-space-idle-taptap-rc<N>.zip` 自身完整表达（它 = 白名单 ∩ 转换后的
 *      结果）。本脚本只「读产物」，不重写 build-taptap-h5.mjs 的白名单/排除表 ——
 *      同语义第二份实现必然漂移。
 *   2. **路径与 RC 号也不另立真值**：OUTDIR 从 build-taptap-h5.mjs 源码里读，
 *      RC 号从 tools/rc-counter.txt 读。
 *   3. **区分噪声与信号**。包由 `git archive`（LF 规范化）产出，而工作树多为
 *      CRLF ⇒ 直接比字节会把 ~90 个文件误判成「被转换」。故工作树侧比较前先做
 *      LF 规范化，只有「规范化后仍不等」才算真差异。
 *
 * 用法
 *   node tools/platform-baseline.mjs --capture              # 写基线（含来源提交溯源）
 *   node tools/platform-baseline.mjs --capture --no-origin  # 跳过溯源（快）
 *   node tools/platform-baseline.mjs --check                # 复算比对，漂移则 EXIT 1
 *   node tools/platform-baseline.mjs --check --quiet
 *   --json <path>  基线文件路径（默认 D:/EVE-IDLE/wx-p5-baseline/platform-baseline.json）
 *
 * 只读保证
 *   --capture 只写基线 JSON 与（可选）溯源用的临时源码树（均在仓库外）；
 *   --check 完全不写盘。两者都不改任何 zip / Steam 产物 / 仓库文件。
 * ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const QUIET = argv.includes("--quiet");
const MODE = argv.includes("--check") ? "check" : "capture";
const NO_ORIGIN = argv.includes("--no-origin");
const BASELINE_PATH = path.resolve(
  argOf("--json") || "D:/EVE-IDLE/wx-p5-baseline/platform-baseline.json"
);

const STEAM_OUT = "D:/EVE-IDLE/STEAM-OUTPUT";
const STEAM_SHELL = "D:/EVE-IDLE/electron";
const ZIP_PREFIX = "deep-space-idle/";

const log = (...a) => { if (!QUIET) console.log(...a); };
const die = (msg) => { console.error("❌ " + msg); process.exit(2); };

/* ------------------------------------------------------------------ 工具 */

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sha256File = (p) => sha256(fs.readFileSync(p));
const toPosix = (p) => p.replace(/\\/g, "/");
/** 工作树多为 CRLF、包内为 LF ⇒ 比较前统一去 CR，消除噪声 */
const stripCR = (buf) =>
  buf.includes(0x0d) ? Buffer.from(buf.toString("binary").replace(/\r\n/g, "\n"), "binary") : buf;

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).replace(/\r?\n$/, "");
}

/** 指纹 = sha256(排序后的 "rel\0sha\n" 拼接) ⇒ 与文件顺序无关 */
function fingerprint(list) {
  return sha256(Buffer.from(list.map((x) => `${x.rel}\u0000${x.sha256}`).sort().join("\n"), "utf8"));
}

function walkFiles(dir, base = "", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) walkFiles(abs, rel, out);
    else if (e.isFile()) out.push({ abs, rel });
  }
  return out;
}

/* ---------------------------------- zip 读取（零依赖：内置 zlib 即可） */

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) die("找不到 zip EOCD（文件被截断？）");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) die("zip 中央目录签名损坏 @" + p);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    entries.push({ name: buf.slice(p + 46, p + 46 + nl).toString("utf8"), method, crc, csize, usize, lho });
    p += 46 + nl + el + cl;
  }
  return entries;
}

function zipEntryData(buf, ent) {
  if (ent.name.endsWith("/")) return Buffer.alloc(0);
  const nl = buf.readUInt16LE(ent.lho + 26), el = buf.readUInt16LE(ent.lho + 28);
  const start = ent.lho + 30 + nl + el;
  const raw = buf.slice(start, start + ent.csize);
  if (ent.method === 0) return raw;
  if (ent.method === 8) return zlib.inflateRawSync(raw);
  die(`不支持的 zip 压缩方法 ${ent.method}（${ent.name}）`);
}

/* ------------------------------------------------------- 真值：构建脚本自述 */

function readTaptapOutdir() {
  const src = fs.readFileSync(path.join(ROOT, "tools/build-taptap-h5.mjs"), "utf8");
  const m = src.match(/^\s*const\s+OUTDIR\s*=\s*"([^"]+)"/m);
  if (!m) die("无法从 tools/build-taptap-h5.mjs 解析 OUTDIR —— 构建脚本结构变了，请同步本脚本");
  return m[1];
}

/* --------------------------------------------------------- 采集：四块真值 */

function captureTaptap(data) {
  const OUTDIR = readTaptapOutdir();
  const rc = data.rcCounter.value;
  const relZip = path.join(OUTDIR, `deep-space-idle-taptap-rc${rc}.zip`);
  const selfZip = path.join(OUTDIR, `deep-space-idle-taptap-rc${rc}-selftest.zip`);
  if (!fs.existsSync(relZip)) die(`当前 RC=${rc} 的 release 包不存在：${relZip}`);
  const buf = fs.readFileSync(relZip);
  const fileEntries = readZip(buf).filter((e) => !e.name.endsWith("/"));
  const bad = fileEntries.filter((e) => !e.name.startsWith(ZIP_PREFIX));
  if (bad.length) die(`zip 顶层目录不唯一：${bad.slice(0, 3).map((e) => e.name).join(", ")}`);

  const entries = fileEntries.map((e) => ({
    rel: e.name.slice(ZIP_PREFIX.length),
    usize: e.usize,
    crc32: e.crc >>> 0,
    sha256: sha256(zipEntryData(buf, e)),
  }));

  data.taptap = {
    outdir: toPosix(OUTDIR),
    rc,
    release: { file: toPosix(relZip), size: buf.length, sha256: sha256(buf) },
    selftest: fs.existsSync(selfZip)
      ? { file: toPosix(selfZip), size: fs.statSync(selfZip).size, sha256: sha256File(selfZip) }
      : null,
    entryCount: entries.length,
    packedBytes: entries.reduce((s, e) => s + e.usize, 0),
    /** ⭐ 发布运行集指纹（权威，不重复构建器逻辑） */
    packedFingerprint: fingerprint(entries),
    entries,
    otherZips: fs.readdirSync(OUTDIR)
      .filter((f) => /^deep-space-idle-taptap-rc\d+(-selftest)?\.zip$/.test(f))
      .map((f) => ({ file: f, size: fs.statSync(path.join(OUTDIR, f)).size })),
  };
}

function captureSteam(data) {
  let latest = null;
  if (fs.existsSync(STEAM_OUT)) {
    latest = fs.readdirSync(STEAM_OUT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^0\.\d/.test(e.name))
      .map((e) => ({ name: e.name, abs: path.join(STEAM_OUT, e.name), mtime: fs.statSync(path.join(STEAM_OUT, e.name)).mtimeMs }))
      .filter((x) => fs.existsSync(path.join(x.abs, "resources/app")))
      .sort((a, b) => b.mtime - a.mtime)[0] || null;
  }
  if (!latest) { data.steam = { outdir: STEAM_OUT, latest: null, note: "未找到含 resources/app 的产物目录" }; return; }

  const appRoot = path.join(latest.abs, "resources/app");
  const files = walkFiles(appRoot).map(({ abs, rel }) => ({ rel, size: fs.statSync(abs).size, sha256: sha256File(abs) }));
  const bsPath = path.join(appRoot, "build-source.json");
  data.steam = {
    outdir: STEAM_OUT,
    latest: latest.name,
    latestAbs: toPosix(latest.abs),
    buildSource: fs.existsSync(bsPath) ? JSON.parse(fs.readFileSync(bsPath, "utf8")) : null,
    fileCount: files.length,
    totalBytes: files.reduce((s, f) => s + f.size, 0),
    gameFingerprint: fingerprint(files.filter((f) => f.rel.startsWith("game/"))),
    appFingerprint: fingerprint(files),
    files,
  };
}

function captureTools(data) {
  const tracked = new Set(git("ls-files").split("\n").filter(Boolean));
  const rels = [
    "tools/build-taptap-h5.mjs",
    "tools/taptap-compat-probe.mjs",
    "tools/build-wechat-minigame.mjs",
    "tools/wechat/shim.js",
    "tools/platform-baseline.mjs",
  ];
  data.buildTools = rels.map((rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return { rel, exists: false, tracked: tracked.has(rel) };
    const b = fs.readFileSync(abs);
    return { rel, exists: true, size: b.length, sha256: sha256(b), tracked: tracked.has(rel) };
  });
  data.steamShellTools = ["package-steam.cjs", "main.cjs", "preload.cjs", "game-source.cjs"].map((f) => {
    const abs = path.join(STEAM_SHELL, f);
    if (!fs.existsSync(abs)) return { rel: `${STEAM_SHELL}/${f}`, exists: false };
    const b = fs.readFileSync(abs);
    return { rel: `${STEAM_SHELL}/${f}`, exists: true, size: b.length, sha256: sha256(b) };
  });
}

/* ------------------------------------- 来源提交溯源（recovers the SOURCE_SHA）
 * 构建器要求「clean worktree + --source-sha == HEAD」，但不把 SHA 写进包内。
 * 于是用「包内字节 ↔ 候选提交的 git archive 字节」反查：得分最高者即来源，
 * 其差集 = 该包的构建期转换清单（这是唯一能事后拿到转换清单的办法）。
 */
function recoverOrigin(data, candidates = 8) {
  const tmpDir = path.join(path.dirname(BASELINE_PATH), "_origin");
  fs.mkdirSync(tmpDir, { recursive: true });
  const packed = new Map(data.taptap.entries.map((e) => [e.rel, e.sha256]));
  const rels = [...packed.keys()];
  const shas = git("log", "--format=%H", `-${candidates}`).split("\n").filter(Boolean);

  /** 把一次 git archive 结果读成 rel → sha256（不落盘解压；tar 在本机 MSYS 下会被路径转义搞坏） */
  const archiveMap = (sha) => {
    const zipPath = path.join(tmpDir, sha + ".zip");
    execFileSync("git",
      ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=zip", "-o", zipPath, sha],
      { cwd: ROOT, maxBuffer: 1 << 28 });
    const buf = fs.readFileSync(zipPath);
    fs.rmSync(zipPath, { force: true });
    const m = new Map();
    for (const e of readZip(buf)) {
      if (e.name.endsWith("/")) continue;
      m.set(e.name, sha256(zipEntryData(buf, e)));
    }
    return m;
  };

  const results = [];
  for (const sha of shas) {
    let tree;
    try { tree = archiveMap(sha); }
    catch (e) { log(`  (候选 ${sha.slice(0, 8)} 导出失败：${String(e.message).split("\n")[0]})`); continue; }
    let same = 0; const diff = [], missing = [];
    for (const rel of rels) {
      if (!tree.has(rel)) { missing.push(rel); continue; }
      if (tree.get(rel) === packed.get(rel)) same++; else diff.push(rel);
    }
    results.push({ sha, same, total: rels.length, diff, missing, tree });
  }
  // 命中最多者胜（same 越高越好，并列时差异/缺失更少者胜）
  results.sort((a, b) =>
    (b.same - a.same) || (a.diff.length - b.diff.length) || (a.missing.length - b.missing.length));

  const best = results[0];
  if (!best) { data.origin = { recovered: false, note: "所有候选提交都未能导出" }; return; }
  data.origin = {
    recovered: true,
    method: "包内字节 ↔ `git -c core.autocrlf=false archive --format=zip <sha>` 逐条比对",
    sha: git("rev-parse", best.sha),
    shaShort: best.sha.slice(0, 7),
    subject: git("log", "-1", "--format=%s", best.sha),
    committedAt: git("log", "-1", "--format=%cI", best.sha),
    matched: best.same,
    total: best.total,
    /** 构建期转换 = 包里与来源提交不同的那些文件（其余逐字节相同） */
    transforms: best.diff.map((rel) => ({
      rel,
      packedSha256: packed.get(rel),
      sourceSha256: best.tree.has(rel) ? best.tree.get(rel) : null,
    })),
    /** 包内有、来源提交里没有的文件（正常应为 0） */
    packedOnly: best.missing,
    /** 其余候选的得分，用于证明「第一名是唯一解」（若并列则不唯一，须人工判） */
    runnerUp: results.slice(1, 4).map((r) => ({ sha: r.sha.slice(0, 7), matched: r.same, diff: r.diff.length })),
    unambiguous: !results[1] || results[1].same < best.same,
  };
}

/* --------------------------------------------------------- 源侧对照（CRLF 感知） */

function captureSourceCompare(data) {
  const rows = [];
  for (const e of data.taptap.entries) {
    const abs = path.join(ROOT, e.rel);
    if (!fs.existsSync(abs)) { rows.push({ rel: e.rel, status: "no-worktree-file" }); continue; }
    const raw = fs.readFileSync(abs);
    if (sha256(raw) === e.sha256) rows.push({ rel: e.rel, status: "identical" });
    else if (sha256(stripCR(raw)) === e.sha256) rows.push({ rel: e.rel, status: "crlf-only" });
    else rows.push({ rel: e.rel, status: "differs" });
  }
  data.sourceCompare = {
    identical: rows.filter((r) => r.status === "identical").length,
    crlfOnly: rows.filter((r) => r.status === "crlf-only").length,
    differs: rows.filter((r) => r.status === "differs").map((r) => r.rel),
    noWorktreeFile: rows.filter((r) => r.status === "no-worktree-file").map((r) => r.rel),
  };
}

/* ------------------------------------------------------------- 平台入包集 */

function buildShippedSet(data) {
  const set = new Set(data.taptap.entries.map((e) => e.rel));
  if (data.steam.latest) {
    for (const f of data.steam.files) {
      const rel = f.rel.replace(/^game\//, "");
      if (f.rel.startsWith("game/")) set.add(rel);
    }
  }
  return [...set].sort();
}

/* ------------------------------------------------------------------ capture */

const now = {
  schema: 1,
  capturedAt: new Date().toISOString(),
  node: { execPath: process.execPath, version: process.version },
};

// 仓库状态
{
  const top = git("rev-parse", "--show-toplevel");
  if (path.resolve(top) !== ROOT) die(`仓库根不符：git 说 ${top}，脚本在 ${ROOT}`);
  const porc = git("status", "--porcelain=v1", "-uall").split("\n").filter(Boolean);
  now.repo = {
    path: toPosix(ROOT),
    branch: git("rev-parse", "--abbrev-ref", "HEAD"),
    head: git("rev-parse", "HEAD"),
    originMain: (() => { try { return git("rev-parse", "origin/main"); } catch { return null; } })(),
    remote: (() => { try { return git("remote", "get-url", "origin"); } catch { return null; } })(),
    staged: porc.filter((l) => /^[MADRC]/.test(l)).map((l) => l.slice(3)),
    trackedModified: porc.filter((l) => /^.[MADRC]/.test(l)).map((l) => l.slice(3)),
    untracked: porc.filter((l) => l.startsWith("??")).map((l) => l.slice(3)),
  };
  now.repo.untrackedCount = now.repo.untracked.length;
}

// RC 计数器
{
  const rcFile = path.join(ROOT, "tools/rc-counter.txt");
  if (!fs.existsSync(rcFile)) die("tools/rc-counter.txt 不存在");
  const b = fs.readFileSync(rcFile);
  const raw = b.toString("utf8").trim();
  now.rcCounter = { rel: "tools/rc-counter.txt", raw, value: Number(raw), size: b.length, sha256: sha256(b) };
  if (!Number.isInteger(now.rcCounter.value)) die("rc-counter.txt 解析不出整数");
}

captureTools(now);
captureTaptap(now);
captureSteam(now);
captureSourceCompare(now);
now.shippedRel = buildShippedSet(now);

/** 捕获时刻「已被工作树改动的平台入包文件」= 已知既成事实（如尚未发布的 i18n 批次）。
 *  门禁只对**超出这份名单**的新增改动告警，否则会把历史遗留持续误报成迁移引入。 */
function touchedShippedNow() {
  const shipped = new Set(now.shippedRel);
  const all = [...new Set([
    ...now.repo.staged,
    ...now.repo.trackedModified,
    ...now.repo.untracked,
  ].map((s) => toPosix(s.trim())))];
  return { touchedShipped: all.filter((p) => shipped.has(p)).sort(), touchedAll: all };
}
now.knownTouchedShipped = touchedShippedNow().touchedShipped;

if (!NO_ORIGIN && MODE === "capture") recoverOrigin(now);

if (MODE === "capture") {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(now, null, 2));

  log("=== 平台基线已冻结 ===");
  log(`  基线文件      ${toPosix(BASELINE_PATH)}`);
  log(`  仓库          ${now.repo.path}`);
  log(`  分支/HEAD     ${now.repo.branch} @ ${now.repo.head}`);
  log(`  工作树        staged=${now.repo.staged.length} modified=${now.repo.trackedModified.length} untracked=${now.repo.untrackedCount}`);
  log(`  RC            ${now.rcCounter.value}`);
  log("  ── TapTap ──");
  log(`  release       ${path.basename(now.taptap.release.file)}  ${now.taptap.release.size} B`);
  log(`                sha256=${now.taptap.release.sha256}`);
  if (now.taptap.selftest) log(`  selftest      ${now.taptap.selftest.size} B  sha256=${now.taptap.selftest.sha256}`);
  log(`  入包条目      ${now.taptap.entryCount}  解压字节和=${now.taptap.packedBytes}`);
  log(`  ⭐ 入包指纹   ${now.taptap.packedFingerprint}`);
  const sc = now.sourceCompare;
  log(`  源侧对照      逐字节同=${sc.identical} 仅 CRLF 差异=${sc.crlfOnly} 真差异=${sc.differs.length} 仓库无此文件=${sc.noWorktreeFile.length}`);
  if (sc.differs.length) log(`    真差异：${sc.differs.slice(0, 12).join(", ")}${sc.differs.length > 12 ? ` … 共 ${sc.differs.length}` : ""}`);
  if (now.origin) {
    log("  ── 来源溯源 ──");
    if (now.origin.recovered) {
      log(`  来源提交      ${now.origin.shaShort}  ${now.origin.committedAt}  ${now.origin.subject}`);
      log(`  逐条命中      ${now.origin.matched}/${now.origin.total}${now.origin.unambiguous ? "  （唯一解）" : "  ⚠ 与次名并列，需人工确认"}`);
      log(`  构建期转换    ${now.origin.transforms.length} 个：`);
      for (const t of now.origin.transforms) log(`                · ${t.rel}`);
      if (now.origin.runnerUp.length) {
        log(`  次名          ${now.origin.runnerUp.map((r) => `${r.sha}(${r.matched}, 差${r.diff})`).join("  ")}`);
      }
      if (now.origin.packedOnly.length) log(`  ⚠ 包内有而源内无：${now.origin.packedOnly.join(", ")}`);
    } else log(`  ${now.origin.note}`);
  }
  log("  ── Steam ──");
  if (now.steam.latest) {
    log(`  最新产物      ${now.steam.latest}  (${now.steam.fileCount} 文件 / ${now.steam.totalBytes} B)`);
    log(`  build-source  ${JSON.stringify(now.steam.buildSource)}`);
    log(`  ⭐ game 指纹  ${now.steam.gameFingerprint}`);
    log(`     app 指纹   ${now.steam.appFingerprint}`);
  } else log(`  无产物：${now.steam.note}`);
  log(`  平台入包集    ${now.shippedRel.length} 个 rel`);
  log(`  ⚠ 既成改动    ${now.knownTouchedShipped.length} 个入包文件此刻已被工作树改动（登记为已知，后续只对「新增」告警）`);
  for (const p of now.knownTouchedShipped) log(`                · ${p}`);
  log("  ── 构建工具 ──");
  for (const t of now.buildTools) log(`  ${t.exists ? t.sha256.slice(0, 16) + "…" : "(缺失)"}  ${t.rel}${t.tracked ? "" : "  [未跟踪]"}`);
  for (const t of now.steamShellTools) log(`  ${t.exists ? t.sha256.slice(0, 16) + "…" : "(缺失)"}  ${t.rel}`);
  process.exit(0);
}

/* -------------------------------------------------------------------- check */

if (!fs.existsSync(BASELINE_PATH)) die(`基线不存在：${BASELINE_PATH}（先跑 --capture）`);
const base = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));

log("=== 平台基线漂移校验 ===");
log(`  基线   ${toPosix(BASELINE_PATH)}  (captured ${base.capturedAt})`);
log(`  当前   ${now.capturedAt}`);

const drift = [];
/** 通过 → 仅非 --quiet 时打印；失败 → 永远打印（--quiet 也不许吞掉失败原因） */
const same = (label, a, b) => {
  if (a === b) { log(`  ✓ ${label}`); return; }
  console.log(`  ✗ ${label}\n      基线 ${a}\n      当前 ${b}`);
  drift.push(label);
};

log("\n=== 门禁 1 · TapTap 已产出包未被改动 ===");
same("rc release zip SHA-256", base.taptap.release.sha256, now.taptap.release.sha256);
same("rc selftest zip SHA-256", base.taptap.selftest?.sha256 ?? null, now.taptap.selftest?.sha256 ?? null);
same("入包条目数", base.taptap.entryCount, now.taptap.entryCount);
same("⭐ 入包内容指纹", base.taptap.packedFingerprint, now.taptap.packedFingerprint);

log("\n=== 门禁 2 · Steam 已产出产物未被改动 ===");
same("最新产物目录", base.steam.latest, now.steam.latest);
same("app 文件数", base.steam.fileCount, now.steam.fileCount);
same("⭐ game/** 指纹", base.steam.gameFingerprint, now.steam.gameFingerprint);
same("   resources/app 全量指纹", base.steam.appFingerprint, now.steam.appFingerprint);

log("\n=== 门禁 3 · 构建链未被改动 ===");
same("RC 计数器", base.rcCounter.value, now.rcCounter.value);
same("rc-counter.txt SHA-256", base.rcCounter.sha256, now.rcCounter.sha256);
for (const b of base.buildTools) {
  const n = now.buildTools.find((x) => x.rel === b.rel);
  if (!n || !n.exists) { log(`  ! ${b.rel} 已不存在`); drift.push(b.rel + " 缺失"); continue; }
  if (!b.exists) { log(`  · ${b.rel}（基线时不存在，视为新增，不判失败）`); continue; }
  same(`构建工具 ${b.rel}`, b.sha256, n.sha256);
}
for (const b of base.steamShellTools || []) {
  const n = (now.steamShellTools || []).find((x) => x.rel === b.rel);
  if (!n || !n.exists) { log(`  ! ${b.rel} 已不存在`); drift.push(b.rel + " 缺失"); continue; }
  if (!b.exists) continue;
  same(`Steam 壳 ${b.rel.split("/").slice(-2).join("/")}`, b.sha256, n.sha256);
}

/* ⭐ 门禁 4 —— 这条才真正回答「微信迁移动了平台打包文件没有」 */
log("\n=== 门禁 4 · 平台入包文件未被新增改动（硬告警）===");
{
  const { touchedShipped, touchedAll } = touchedShippedNow();
  const known = new Set(base.knownTouchedShipped || []);
  const newly = touchedShipped.filter((p) => !known.has(p));
  const resolved = [...known].filter((p) => !touchedShipped.includes(p));
  log(`  平台入包集 ${now.shippedRel.length} 个文件；工作树变更 ${touchedAll.length} 个，其中落在入包集内 ${touchedShipped.length} 个`);
  log(`  基线已登记的既成改动 ${known.size} 个${known.size ? "：" + [...known].join(", ") : ""}`);
  if (resolved.length) log(`  （其中 ${resolved.length} 个已复原/提交，不再出现在工作树：${resolved.join(", ")}）`);
  if (newly.length === 0) {
    log("  ✓ **无新增** —— 相比基线没有多改任何一个被平台打包的文件");
  } else {
    log(`  ✗ 新增 ${newly.length} 个被平台打包的文件被改动：`);
    for (const p of newly.slice(0, 40)) log(`      · ${p}`);
    drift.push(`平台入包文件新增改动（${newly.length} 个）`);
  }
  const outside = touchedAll.filter((p) => !now.shippedRel.includes(p));
  log(`  · 未入包变更 ${outside.length} 个（信息性，不影响平台打包内容）`);
}

if (base.origin) {
  log("\n=== 参考（非门禁）· 来源溯源 ===");
  const o = base.origin;
  if (o.sha) log(`  基线记录的来源提交：${o.shaShort}  (含 ${o.matched}/${o.total} 逐条命中，转换 ${(o.transforms || []).length} 个)`);
  log(`  基线 HEAD ${base.repo.head.slice(0, 12)}  →  当前 HEAD ${now.repo.head.slice(0, 12)}`);
  const sc = now.sourceCompare;
  log(`  当前源侧对照：逐字节同=${sc.identical} 仅CRLF=${sc.crlfOnly} 真差异=${sc.differs.length} 无源=${sc.noWorktreeFile.length}`);
  if (sc.differs.length) log(`    真差异：${sc.differs.slice(0, 10).join(", ")}${sc.differs.length > 10 ? " …" : ""}`);
}

log("");
if (drift.length === 0) {
  const n = 3 + base.buildTools.length + (base.steamShellTools || []).length + 1;
  log(`✅ PASS —— ${n + 6} 项断言全部通过`);
  log("  （入包集相对基线的变化不计为漂移：它反映「构建源已前进」，属预期；");
  log("    门禁回答的是「已产出的包/产物是否被动过」+「有没有人改到平台打包文件」。）");
  process.exit(0);
}
// ⚠️ 失败裁决一律走 console.log，**不受 --quiet 抑制**。
//    教训：本块曾用 log()，导致 `--check --quiet` 时只剩零散的 ✗ 行，
//    裁决句与漂移清单被吞 ⇒ CI 里看到「没报 PASS 也没报 FAIL」，无法定位。
console.log(`❌ FAIL —— ${drift.length} 项漂移：`);
for (const d of drift) console.log("   - " + d);
process.exit(1);
