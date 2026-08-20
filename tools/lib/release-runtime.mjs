// tools/lib/release-runtime.mjs
//
// 共享的确定性发布构建核心：文本换行规范化、来源读取（固定提交 / 工作区）、
// 确定性 ZIP 生成、文件 manifest 与两次构建一致性比较。
//
// 本模块与具体发布目标（平台 / 商店 / 探针策略 / 命名规则）无关，只提供通用能力；
// 平台专属的筛选、转换、命名与验证逻辑由调用方（构建器）负责。
//
// 设计约定：
//  - 小型纯函数，显式传入依赖（JSZip 实例、仓库路径、固定时间等）。
//  - 路径一律以 "/" 为分隔符（normalizeReleasePath），与 ZIP 条目一致。
//  - 确定性契约：条目排序、时间戳、压缩参数由调用方固定；
//    本模块保证相同输入产生相同字节输出。
//
// 历史背景：旧实现把构建核心内联在单个构建器中，且依赖用户目录下的私有 JSZip
// 绝对路径。抽取本模块时，同一能力（archive 读取、ZIP 生成、一致性比较）保持
// 字节级等价，仅将换行规范化作为显式步骤纳入来源读取管线。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

// 明确文本扩展名白名单：这些文件在入包前统一 CRLF / 孤立 CR -> LF。
// 二进制文件（PNG / 字体 / WASM 等）不在白名单内，保持原字节。
export const TEXT_FILE_EXTENSIONS = new Set([
  ".html", ".css", ".js", ".mjs", ".json", ".txt", ".svg", ".xml",
]);

/** Buffer -> 小写 hex sha256 */
export function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** 路径分隔符统一为 "/"（Windows 反斜杠转正斜杠） */
export function normalizeReleasePath(p) {
  // Always accept Windows separators, even when this code runs on a non-Windows host.
  // Native POSIX separators are already "/", so replacing backslashes is sufficient.
  return p.replace(/\\/g, "/");
}

/**
 * 文本换行规范化：CRLF -> LF，随后孤立 CR -> LF。
 * 仅当 relPath 扩展名命中文本白名单时处理；其余情况返回原 buffer。
 * 已是 LF 的文本返回与输入字节完全相同的 buffer（零变化）。
 */
export function normalizeTextBytes(relPath, buffer) {
  const ext = path.extname(relPath).toLowerCase();
  if (!TEXT_FILE_EXTENSIONS.has(ext)) return buffer;
  const text = buffer.toString("utf8");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized === text) return buffer;
  return Buffer.from(normalized, "utf8");
}

/**
 * 递归收集目录下文件到给定 Map。
 * @param {string} dir      磁盘目录绝对路径
 * @param {string} baseRel  目录对应的包内相对路径（"" 或 "css" 等）
 * @param {Map<string,Buffer>} map 输出容器
 * @param {{filter?: (rel:string)=>boolean, transform?: (rel:string, buf:Buffer)=>Buffer}} [opts]
 *   filter: 相对路径过滤（返回 false 则跳过）；transform: 读取后转换（如换行规范化）。
 */
export function walkDirectoryToMap(dir, baseRel, map, opts = {}) {
  const { filter, transform } = opts;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = normalizeReleasePath(baseRel ? baseRel + "/" + e.name : e.name);
    if (e.isDirectory()) {
      walkDirectoryToMap(abs, rel, map, opts);
    } else if (e.isFile()) {
      if (filter && !filter(rel)) continue;
      let buf = fs.readFileSync(abs);
      if (transform) buf = transform(rel, buf);
      map.set(rel, buf);
    }
  }
}

/**
 * 以固定参数执行 git archive 并返回 ZIP buffer（确定性来源读取）。
 * 参数与正式构建一致：autocrlf=false、eol=lf，输出提交树原始字节。
 */
export function gitArchiveBuffer(repo, sha) {
  const r = spawnSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", "--format=zip", sha],
    { cwd: repo, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error("git archive 失败: " + (r.stderr || r.stdout).toString());
  }
  return r.stdout;
}

/**
 * 从提交 archive ZIP 解出文件 Map<rel, Buffer>（rel 为仓库相对路径，"/" 分隔）。
 * @param {Buffer} archiveZipBuffer gitArchiveBuffer 的产物
 * @param {*} jszip JSZip 实例
 * @param {{fileFilter?: (rel:string)=>boolean, transform?: (rel:string, buf:Buffer)=>Buffer}} [opts]
 *   默认返回归档内全部非目录条目。
 */
export async function loadCommitFiles(archiveZipBuffer, jszip, opts = {}) {
  const { fileFilter, transform } = opts;
  const map = new Map();
  const zip = await jszip.loadAsync(archiveZipBuffer);
  for (const [rel, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const r = normalizeReleasePath(rel);
    if (fileFilter && !fileFilter(r)) continue;
    let buf = await file.async("nodebuffer");
    if (transform) buf = transform(r, buf);
    map.set(r, buf);
  }
  return map;
}

/**
 * 从工作区读取指定 relPaths（文件或目录）到 Map<rel, Buffer>。
 * @param {string} rootDir 仓库根目录
 * @param {string[]} relPaths 相对仓库根的路径列表（文件或目录）
 * @param {{fileFilter?: (rel:string)=>boolean, transform?: (rel:string, buf:Buffer)=>Buffer}} [opts]
 */
export function loadWorktreeFiles(rootDir, relPaths, opts = {}) {
  const { fileFilter, transform } = opts;
  const map = new Map();
  for (const rel of relPaths) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) continue;
    const st = fs.statSync(abs);
    const r = normalizeReleasePath(rel);
    if (st.isDirectory()) {
      walkDirectoryToMap(abs, r, map, { filter: fileFilter, transform });
    } else if (st.isFile()) {
      if (fileFilter && !fileFilter(r)) continue;
      let buf = fs.readFileSync(abs);
      if (transform) buf = transform(r, buf);
      map.set(r, buf);
    }
  }
  return map;
}

/**
 * 生成确定性文件 manifest：按传入 keys 顺序输出 {arc, rel, size, sha256}。
 * arc = topDir + "/" + rel（ZIP 条目路径）。
 */
export function createFileManifest(sortedKeys, map, topDir) {
  return sortedKeys.map((k) => ({
    arc: topDir + "/" + k,
    rel: k,
    size: map.get(k).length,
    sha256: sha256(map.get(k)),
  }));
}

/**
 * 确定性 ZIP 生成：条目时间戳固定、目录条目时间戳固定、DEFLATE level 9、
 * platform 0、dosDates true。调用方负责传入已排序的 keys。
 */
export async function createDeterministicZip(jszip, sortedKeys, map, topDir, fixedDate) {
  const out = new jszip();
  for (const k of sortedKeys) {
    out.file(topDir + "/" + k, map.get(k), { date: fixedDate });
  }
  // 强制所有条目（含 JSZip 自动生成的目录条目）使用固定日期，保证字节级确定性
  for (const name of Object.keys(out.files)) {
    out.files[name].date = fixedDate;
  }
  return out.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: 0,
    dosDates: true,
  });
}

/**
 * 两次构建结果一致性比较。
 * @param {{buffer: Buffer, manifest: Array}} a
 * @param {{buffer: Buffer, manifest: Array}} b
 * @returns {{listSame: boolean, hashSame: boolean, zipSame: boolean, count: number, zipSha256: string}}
 */
export function compareBuildResults(a, b) {
  const la = a.manifest.map((m) => m.arc);
  const lb = b.manifest.map((m) => m.arc);
  const listSame = la.length === lb.length && la.every((v, i) => v === lb[i]);
  const hashSame =
    a.manifest.length === b.manifest.length &&
    a.manifest.every((m, i) => m.sha256 === b.manifest[i].sha256);
  const zipSame = a.buffer.length === b.buffer.length && sha256(a.buffer) === sha256(b.buffer);
  return { listSame, hashSame, zipSame, count: a.manifest.length, zipSha256: sha256(a.buffer) };
}
