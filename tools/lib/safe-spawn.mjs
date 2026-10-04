/**
 * 子进程包装：绕开本机 `spawnSync` 的 EBUSY（2026-10-04 根因修复）
 *
 * ── 现象 ────────────────────────────────────────────────────────────
 * `spawnSync("git", [...], { encoding: "utf8" })` 一律返回
 *   `Error: spawnSync git EBUSY`（errno **-4082**），`.stdout` 为 `undefined`，
 * 紧接着 `.trim()` / `.toString()` 抛
 *   `TypeError: Cannot read properties of undefined`。
 *   表象是"脚本第一行就崩"，很容易误判成脚本本身坏了。
 *
 * ── 根因（实测四种组合逐层排除，非 git 被拦、非沙箱策略）────────────
 *   1. 异步 `spawn("git", …)` **正常**返回（git version 2.55.0）
 *      ⇒ 子进程机制本身没问题，问题局限在 `spawnSync` 这条同步路径。
 *   2. `spawnSync` 传 `stdio: "ignore"` / `"inherit"` /
 *      `["ignore","pipe","ignore"]` **全部成功**；只有**默认 `pipe`（三通道全开）失败**。
 *   3. `cmd.exe`、`node.exe` **自身**同样失败 ⇒ 与具体程序无关。
 *   ⇒ 结论：本机 libuv 在 `spawnSync` **同时创建 stdin+stdout+stderr 三条匿名管道**
 *     时失败（Windows 句柄 / Job Object 层面的限制）。
 *     把 **stdin 改为 `ignore`**、保留 stdout/stderr 管道，即可正常拿到输出。
 *
 * ── 语义保证 ────────────────────────────────────────────────────────
 *   · 调用点**显式**给了 `stdio` ⇒ 尊重调用点，不覆盖。
 *   · 未给 ⇒ 注入 `["ignore", "pipe", "pipe"]`，其余选项（`encoding` /
 *     `cwd` / `maxBuffer` / `shell` / `env` …）全部原样透传。
 *   · 已实测 `encoding: "buffer"` 与本包装**兼容**（stdout 仍为 Buffer），
 *     故 `git archive --format=zip` 这类需要二进制输出的调用不受影响。
 *   · 本机未来若修复该限制，本包装可原样保留，不改变任何语义。
 *
 * ── 使用约定（重要）─────────────────────────────────────────────────
 *   本模块 2026-10-04 抽出后，仓库内**所有**需要 `spawnSync` 的工具脚本
 *   都应改为从这里 import，而不是各自 `import { spawnSync } from "node:child_process"`。
 *   踩过的坑：`build-taptap-h5.mjs` 与 `lib/release-runtime.mjs` 是两处**独立实现**，
 *   只改一处 → release 封包会在下一关（`gitArchiveBuffer`）**二次崩溃**。
 */

import { spawnSync as _spawnSyncRaw } from "node:child_process";

/**
 * spawnSync 的安全包装：默认注入 stdio 修复 EBUSY。
 *
 * @param {string}   cmd              可执行文件
 * @param {string[]} args             参数数组
 * @param {object}  [options]         原生 spawnSync 选项
 * @returns {import("node:child_process").SpawnSyncReturns<Buffer|string>}
 */
export function spawnSync(cmd, args, options) {
  const opts = options || {};
  if (opts.stdio === undefined) {
    // 关键：stdin 必须不是 "pipe"。三通道全 pipe 会在本机触发 EBUSY。
    opts.stdio = ["ignore", "pipe", "pipe"];
  }
  return _spawnSyncRaw(cmd, args, opts);
}

export default spawnSync;
