// tools/test-release-runtime.mjs
//
// 共享构建核心（tools/lib/release-runtime.mjs）的单元测试。
// 覆盖：换行规范化、路径统一、manifest 排序、确定性 ZIP、一致性比较、
// commit 来源完整性、worktree 读取边界。
//
// 运行方式（FRESH 根目录）：
//   node tools/test-release-runtime.mjs
//
// 本脚本不写入仓库；如需落盘证据，仅写入 D:/EVE-IDLE/TAPTAP-H5-OUTPUT/。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  sha256,
  normalizeReleasePath,
  normalizeTextBytes,
  walkDirectoryToMap,
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
const OUT = "D:/EVE-IDLE/TAPTAP-H5-OUTPUT";
const FIXED_DATE = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
const HEAD = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout.trim();

// 与共享模块一致的换行规范化管线（archive / worktree 共用）
const TEXT_NORMALIZER = (rel, buf) => normalizeTextBytes(rel, buf);
// 本地近似构建白名单（仅用于测试 16 的确定性模拟，与构建器包含集对齐）
function localIncluded(rel) {
  if (rel === "index.html") return true;
  if (rel.startsWith("css/") || rel.startsWith("js/") || rel.startsWith("images/")) return true;
  if (rel.startsWith("assets/vendor/taptap-h5/")) return true;
  return false;
}

let passCount = 0;
let failCount = 0;
function ok(name, cond, detail = "") {
  if (cond) passCount++;
  else failCount++;
  console.log((cond ? "PASS " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
}

async function main() {
  // 1) CRLF 文本规范化为 LF
  {
    const out = normalizeTextBytes("x.css", Buffer.from("a\r\nb\r\nc", "utf8"));
    ok("1 CRLF 文本规范化为 LF", out.toString("utf8") === "a\nb\nc" && out.length === 5, out.toString("utf8"));
  }

  // 2) LF 文本规范化后字节不变
  {
    const buf = Buffer.from("a\nb\nc", "utf8");
    ok("2 LF 文本规范化后字节不变", normalizeTextBytes("x.js", buf) === buf);
  }

  // 3) 孤立 CR 规范化为 LF
  {
    const out = normalizeTextBytes("x.txt", Buffer.from("a\rb\rc", "utf8"));
    ok("3 孤立 CR 规范化为 LF", out.toString("utf8") === "a\nb\nc", out.toString("utf8"));
  }

  // 4) PNG / 字体等二进制 Buffer 不变
  {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]);
    ok("4 PNG 二进制保持原字节", normalizeTextBytes("x.png", png) === png);
    const woff = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x0d, 0x0a, 0x00]);
    ok("4b 字体二进制保持原字节", normalizeTextBytes("x.woff2", woff) === woff);
    const wasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x0d, 0x0a, 0x00]);
    ok("4c WASM 二进制保持原字节", normalizeTextBytes("x.wasm", wasm) === wasm);
  }

  // 5) Windows 路径分隔符转为 "/"
  {
    ok("5 路径分隔符统一为 /", normalizeReleasePath("a\\b\\c.css") === "a/b/c.css", normalizeReleasePath("a\\b\\c.css"));
  }

  // 6) manifest 排序稳定
  {
    const map = new Map([
      ["b.js", Buffer.from("b")],
      ["a.css", Buffer.from("a")],
      ["c.png", Buffer.from("c")],
    ]);
    const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
    const m1 = createFileManifest(keys, map, "top");
    const m2 = createFileManifest(keys, map, "top");
    ok("6 manifest 排序稳定", JSON.stringify(m1) === JSON.stringify(m2) && m1[0].rel === "a.css" && m1[2].rel === "c.png");
  }

  // 7) 相同 Map 连续生成两次 ZIP 完全一致
  {
    const map = new Map([
      ["b.js", Buffer.from("let x=1;\n")],
      ["a.css", Buffer.from("body{color:red}\n")],
      ["c.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ]);
    const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
    const z1 = await createDeterministicZip(JSZip, keys, map, "pkg", FIXED_DATE);
    const z2 = await createDeterministicZip(JSZip, keys, map, "pkg", FIXED_DATE);
    ok("7 相同 Map 两次 ZIP 完全一致", z1.length === z2.length && z1.equals(z2), z1.length + "B");
    const ev = path.join(OUT, "_test_runtime_repack.zip");
    fs.writeFileSync(ev, z1);
    console.log("   证据(仓库外): " + ev + "  sha=" + sha256(z1));
  }

  // 8) 修改一个输入字节后一致性比较必须失败
  {
    // buffer 与 manifest 均反映输入字节；单字节改动应同时使 hashSame 与 zipSame 为 false
    const mk = (ch) => ({
      buffer: Buffer.from("pkg-" + ch),
      manifest: [{ arc: "pkg/a.js", rel: "a.js", size: 1, sha256: sha256(Buffer.from(ch)) }],
    });
    const r = compareBuildResults(mk("a"), mk("b"));
    ok("8 单字节改动一致性比较失败", r.listSame && !r.hashSame && !r.zipSame);
  }

  // 9) commit 来源资源均来自指定 SHA（完整 archive 树，未过滤）
  {
    const archiveBuf = gitArchiveBuffer(REPO, HEAD);
    const all = await loadCommitFiles(archiveBuf, JSZip, {});
    const idx = all.get("index.html");
    const idxGit = spawnSync("git", ["show", HEAD + ":index.html"], { cwd: REPO, encoding: "buffer" }).stdout;
    ok("9a index.html 与指定 SHA 提交内容一致", idx && idx.equals(idxGit));
    ok("9b archive 含 js/qa-seed.js（完整提交树未过滤）", all.has("js/qa-seed.js"));
    ok("9c archive 含 tools/ 文件（来源=提交树而非白名单）", all.has("tools/build-taptap-h5.mjs"));
    const tree = spawnSync("git", ["ls-tree", "-r", "--name-only", HEAD], {
      cwd: REPO,
      encoding: "utf8",
    }).stdout.split(/\r?\n/).filter(Boolean).sort();
    const archivePaths = [...all.keys()].sort();
    ok("9d archive 路径集与指定 HEAD 的 git tree 完全一致",
       JSON.stringify(archivePaths) === JSON.stringify(tree),
       "archive=" + archivePaths.length + " tree=" + tree.length);
  }

  // 10) worktree 读取不把 tools、package.json、草稿带入运行包
  {
    const wt = loadWorktreeFiles(REPO, ["index.html", "css", "js", "images"], {});
    const keys = [...wt.keys()];
    const prefixOk = keys.every((k) => k === "index.html" || k.startsWith("css/") || k.startsWith("js/") || k.startsWith("images/"));
    ok("10a worktree 仅含白名单路径前缀", prefixOk, keys.length + " 项");
    ok("10b 不含 tools/ 与 package.json", !keys.some((k) => k.startsWith("tools/")) && !wt.has("package.json") && !wt.has("package-lock.json"));
    // 仓库根级草稿（PLAN-*.md / CODEX_* / probe*.mjs / demo*.html 等）全部位于根目录；
    // worktree 读取仅允许 index.html 位于根级，其余必须位于 css/js/images 子目录
    const rootLevel = keys.filter((k) => !k.includes("/"));
    ok("10c 根级仅 index.html（无草稿泄漏）", rootLevel.length === 1 && rootLevel[0] === "index.html", rootLevel.join(","));
    ok("10d 不含 .md 文档", !keys.some((k) => k.endsWith(".md")));
    ok("10e 含 index.html", wt.has("index.html"));
  }

  // ---------- Phase C.1 来源纯度（vendor 来源 + 统一换行）----------
  const gitShow = (rel) => spawnSync("git", ["show", HEAD + ":" + rel], { cwd: REPO, encoding: "buffer" }).stdout;
  const VENDOR_CSS = "assets/vendor/taptap-h5/fonts/fonts.css";
  const VENDOR_CSS2 = "assets/vendor/taptap-h5/fontawesome/css/all.min.css";
  const VENDOR_TXT = "assets/vendor/taptap-h5/fontawesome/license/LICENSE_fontawesome.txt";
  const VENDOR_BIN = "assets/vendor/taptap-h5/fontawesome/webfonts/fa-solid-900.woff2";

  // 11) commit 模式 vendor 内容来自 git show <SHA>:<path>
  {
    const aBuf = gitArchiveBuffer(REPO, HEAD);
    const aAll = await loadCommitFiles(aBuf, JSZip, { transform: TEXT_NORMALIZER });
    const vPaths = [VENDOR_CSS, VENDOR_CSS2, VENDOR_TXT, VENDOR_BIN];
    let allFromGit = true;
    for (const p of vPaths) {
      const got = aAll.get(p);
      const git = gitShow(p);
      if (!got || !got.equals(git)) { allFromGit = false; break; }
    }
    // 断言全部 vendor 条目均等于 git show（来源纯度：commit 树即权威）
    let everyVendorFromGit = true;
    for (const [rel, buf] of aAll) {
      if (rel.startsWith("assets/vendor/taptap-h5/") && !buf.equals(gitShow(rel))) { everyVendorFromGit = false; break; }
    }
    ok("11 commit 模式 vendor 内容来自 git show <SHA>:<path>", allFromGit && everyVendorFromGit);
  }

  // 12) commit 模式不读取对应工作区 vendor 内容
  {
    const aBuf = gitArchiveBuffer(REPO, HEAD);
    const aAll = await loadCommitFiles(aBuf, JSZip, { transform: TEXT_NORMALIZER });
    // 复刻 buildOnce 的 archive vendor 抽取逻辑：仅从 commitFiles 取 assets/vendor/taptap-h5/
    const archVendor = new Map();
    for (const [rel, buf] of aAll) if (rel.startsWith("assets/vendor/taptap-h5/")) archVendor.set(rel, buf);
    // 全部等于 git show（commit 权威），且对 CRLF 的 CSS 明确不等于工作区原始字节
    let equalsGit = true, differsFromWorktreeCss = false;
    for (const [rel, buf] of archVendor) {
      if (!buf.equals(gitShow(rel))) { equalsGit = false; break; }
    }
    const wtCssRaw = fs.readFileSync(path.join(REPO, VENDOR_CSS), "utf8");
    const archCss = archVendor.get(VENDOR_CSS);
    if (archCss && !archCss.equals(Buffer.from(wtCssRaw, "utf8"))) differsFromWorktreeCss = true;
    ok("12 commit 模式不读取工作区 vendor 内容（==git show 且 ≠ 工作区 CRLF 原字节）", equalsGit && differsFromWorktreeCss,
       "vendor条目=" + archVendor.size);
  }

  // 13) vendor CSS 的 CRLF 工作区内容规范化后与 commit LF 内容一致
  {
    const wtRaw = fs.readFileSync(path.join(REPO, VENDOR_CSS2), "utf8");
    const norm = normalizeTextBytes(VENDOR_CSS2, Buffer.from(wtRaw, "utf8"));
    const git = gitShow(VENDOR_CSS2);
    ok("13 工作区 CRLF vendor CSS 规范化 == commit LF 内容", norm.equals(git),
       "norm=" + norm.length + "B git=" + git.length + "B");
  }

  // 14) 二进制 vendor 文件保持原字节
  {
    const aBuf = gitArchiveBuffer(REPO, HEAD);
    const aAll = await loadCommitFiles(aBuf, JSZip, { transform: TEXT_NORMALIZER });
    const got = aAll.get(VENDOR_BIN);
    const git = gitShow(VENDOR_BIN);
    // normalizeTextBytes 对二进制（.woff2 不在文本白名单）应保持原 buffer（同引用/等价）
    const passed = got && got.equals(git) && normalizeTextBytes(VENDOR_BIN, git) === git;
    ok("14 二进制 vendor 文件保持原字节（==git show 且 normalize 透传）", passed,
       got ? got.length + "B" : "缺失");
  }

  // 15) archive / worktree 对相同逻辑内容生成相同 manifest
  {
    const aBuf = gitArchiveBuffer(REPO, HEAD);
    const aAll = await loadCommitFiles(aBuf, JSZip, { transform: TEXT_NORMALIZER });
    const archVendor = new Map();
    for (const [rel, buf] of aAll) if (rel.startsWith("assets/vendor/taptap-h5/")) archVendor.set(rel, buf);
    const wtVendor = loadWorktreeFiles(REPO, ["assets/vendor/taptap-h5"], { transform: TEXT_NORMALIZER });
    let keysMatch = archVendor.size === wtVendor.size && [...archVendor.keys()].sort().join("\n") === [...wtVendor.keys()].sort().join("\n");
    let shaMatch = true;
    for (const [rel, buf] of archVendor) {
      const wb = wtVendor.get(rel);
      if (!wb || sha256(buf) !== sha256(wb)) { shaMatch = false; break; }
    }
    // 两份 manifest（arc/rel/size/sha256）应完全一致
    const keys = [...archVendor.keys()].sort((a, b) => a.localeCompare(b));
    const mArch = createFileManifest(keys, archVendor, "deep-space-idle");
    const mWt = createFileManifest(keys, wtVendor, "deep-space-idle");
    const manifestSame = JSON.stringify(mArch) === JSON.stringify(mWt);
    ok("15a archive/worktree vendor 路径集与逐文件 SHA 一致", keysMatch && shaMatch, "arch=" + archVendor.size + " wt=" + wtVendor.size);
    ok("15b archive/worktree 生成相同 manifest", manifestSame);
  }

  // 16) 连续两次构建 ZIP 完全一致（模拟同一来源两次构建）
  {
    const aBuf = gitArchiveBuffer(REPO, HEAD);
    const aAll = await loadCommitFiles(aBuf, JSZip, { transform: TEXT_NORMALIZER });
    const buildMap = new Map();
    for (const [rel, buf] of aAll) {
      if (localIncluded(rel) || rel.startsWith("assets/vendor/taptap-h5/")) buildMap.set(rel, buf);
    }
    const keys = [...buildMap.keys()].sort((a, b) => a.localeCompare(b));
    const z1 = await createDeterministicZip(JSZip, keys, buildMap, "deep-space-idle", FIXED_DATE);
    const z2 = await createDeterministicZip(JSZip, keys, buildMap, "deep-space-idle", FIXED_DATE);
    ok("16 连续两次构建 ZIP 完全一致", z1.length === z2.length && z1.equals(z2), z1.length + "B / files=" + keys.length);
  }

  // 17) 共享模块仍不含平台词和用户绝对路径
  {
    const src = fs.readFileSync(path.join(REPO, "tools/lib/release-runtime.mjs"), "utf8");
    const platformHit = /taptap|steam|electron|dlc|corporation|weixin|alipay|rc-counter|taptap-h5-output/i.test(src);
    const absPathHit = /C:\\Users\\|D:\\EVE-IDLE|EVEIDLE-WORKBUDDY|\.workbuddy/i.test(src);
    ok("17 共享模块不含平台词与用户绝对路径", !platformHit && !absPathHit,
       platformHit ? "platform-word" : (absPathHit ? "abs-path" : "clean"));
  }

  console.log("\n=== 共享构建核心测试: " + passCount + " PASS / " + failCount + " FAIL ===");
  process.exit(failCount ? 1 : 0);
}

main().catch((e) => {
  console.error("测试异常:", e);
  process.exit(2);
});
