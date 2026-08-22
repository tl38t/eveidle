// tools/test-steam-leaderboard-provider.mjs
//
// 标准服技能排行榜 —— 第四阶段：Steam Provider 占位测试
// 验证：Steam Provider 只返回 unavailable 状态；源码不引用 Steamworks SDK /
// Steam Web API / 任何网络请求（通过静态文本扫描确认）。
//
// 纯 node ESM。如失败以非 0 退出。

import assert from "node:assert";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const url = (p) => pathToFileURL(path.join(root, p)).href;

// 加载被测试模块（CommonJS IIFE，挂到 globalThis）
await import(url("js/platform/providers/steam-leaderboard-provider.js"));

const SteamLeaderboardProvider = globalThis.SteamLeaderboardProvider;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; failures.push(name + (extra ? " :: " + extra : "")); console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
}

// ============================================================
console.log("\n[1] Steam Provider 构造与状态");
{
  const p = new SteamLeaderboardProvider();
  ok("构造实例成功", p instanceof SteamLeaderboardProvider);
  ok("isAvailable() === false（占位）", p.isAvailable() === false);
  const init = await p.initialize();
  ok("initialize() resolve(false)", init === false);
  const st = p.getProviderStatus();
  ok("getProviderStatus().connected === false", st.connected === false);
  ok("getProviderStatus().mode === 'unavailable'", st.mode === "unavailable");
  ok("getProviderStatus().platformName === 'Steam'", st.platformName === "Steam");
}

// ============================================================
console.log("\n[2] submitSnapshot / fetchLeaderboard 返回结构化 unavailable");
{
  const p = new SteamLeaderboardProvider();
  const sub = await p.submitSnapshot([]);
  ok("submitSnapshot().status === 'unavailable'", sub && sub.status === "unavailable");
  ok("submitSnapshot().ok === false", sub && sub.ok === false);
  ok("submitSnapshot().reason === 'steam-not-implemented'", sub && sub.reason === "steam-not-implemented");

  const fetch = await p.fetchLeaderboard("skill:mining", {});
  ok("fetchLeaderboard().status === 'unavailable'", fetch && fetch.status === "unavailable");
  ok("fetchLeaderboard().rows 为空数组", fetch && Array.isArray(fetch.rows) && fetch.rows.length === 0);

  const del = await p.deleteLocalSnapshot();
  ok("deleteLocalSnapshot().status === 'unavailable'", del && del.status === "unavailable");
}

// ============================================================
console.log("\n[3] 不抛未处理异常（任何调用均结构化返回）");
{
  const p = new SteamLeaderboardProvider();
  let threw = false;
  try {
    await p.submitSnapshot(null);
    await p.fetchLeaderboard(null, null);
    await p.deleteLocalSnapshot();
  } catch (e) { threw = true; }
  ok("无未处理异常", threw === false);
}

// ============================================================
console.log("\n[4] 源码静态扫描：不引用 Steamworks SDK / Web API / 网络请求");
{
  const srcPath = path.join(root, "js/platform/providers/steam-leaderboard-provider.js");
  const src = readFileSync(srcPath, "utf8");

  // 禁止出现的 SDK / API / 网络调用符号（仅扫描「代码」，排除 // 注释与 /* */ 块注释）
  const forbidden = [
    "steamworks",          // Steamworks SDK
    "greenworks",          // 常见 Steam SDK 封装
    "SteamUserStats",      // Steamworks 接口
    "ISteamUserStats",
    "api.steampowered.com",// Steam Web API 域名
    "partner.steam-api",   // Steam Partner API
    "store.steampowered.com",
    "require('steam",      // 动态 require steam 模块
    "WebSocket",           // 主动网络连接
    "XMLHttpRequest",      // 主动网络请求
    "fetch(",              // 主动网络请求
    "https://",            // 硬编码 https 地址
    "http://",             // 硬编码 http 地址
  ];
  // 去掉块注释 /* ... */ 与行注释 // ...（避免把"说明不引用"的注释误判）
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  const hits = [];
  for (const f of forbidden) {
    if (codeOnly.indexOf(f) >= 0) hits.push(f);
  }
  ok("源码未引用任何 Steamworks/WebAPI/网络调用符号", hits.length === 0, "命中: " + hits.join(", "));

  // TODO 标记应存在（为未来接入保留）
  ok("包含 Steam 接入 TODO 注释", /TODO\s*\(steam\)/i.test(src));
}

// ============================================================
console.log("\n[5] 不影响 TapTap / local-only（独立占位）");
{
  // Steam provider 不参与自动选择，仅占位；其存在不应改变其他 provider 行为。
  const p = new SteamLeaderboardProvider();
  ok("Steam 永不可用于自动选择（isAvailable false）", p.isAvailable() === false);
}

// ============================================================
console.log(`\n========== Steam Provider 测试结果 ==========`);
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("全部通过 ✅");
process.exit(0);
