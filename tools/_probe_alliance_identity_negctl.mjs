// 负控：把「修复前」的代码（HEAD 版本）放进同一套桩里跑，证明探针锚的判据确实是
// 修复才成立的，而不是桩自己造出来的假阳性。
//   before-1：设备身份存在时，平台身份登录会**直接覆盖** playerId，且不发任何归并请求
//   before-2：渲染层没有身份卡片出口（AllianceRenderHelpers.renderIdentityCardHtml 不存在）
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const git = (p) => execFileSync("git", ["show", "HEAD:" + p], { cwd: ROOT, encoding: "utf8" });
const apiCode = git("js/platform/alliance-api.js");
const renderCode = git("js/ui/alliance-render.js");

const GATEWAY = "alliance-identity";
const LEGACY_LOCAL = "local_mtfy9b2i_jqict2";
const fails = [];

// --- before-1 ---
{
  const store = new Map([["eve_idle_alliance_player_id", LEGACY_LOCAL]]);
  const calls = [];
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, Promise, Error, Object, Array, String, Number, Math, Date, JSON, isNaN,
    Uint8Array, URLSearchParams, encodeURIComponent, decodeURIComponent,
    fetch: (url, options) => {
      const target = String(url);
      let body = {};
      try { body = options && options.body ? JSON.parse(options.body) : {}; } catch (_) {}
      calls.push({ url: target, body });
      if (target.indexOf("taptap-auth") >= 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, openid: "A", sessionToken: "t" })) });
      if (target.indexOf("/auth/v1/signin") >= 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ access_token: "t" })) });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("[]") });
    },
    location: { href: "https://example.com/", search: "" },
    navigator: { userAgent: "negctl" },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    crypto: undefined,
    open: () => null,
    tap: { login: (o) => { o.success({ code: "c" }); } }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(apiCode, sandbox, { filename: "HEAD/alliance-api.js" });
  await sandbox.AllianceApi.initializeSteamIdentity();
  const finalId = store.get("eve_idle_alliance_player_id");
  const identityRequests = calls.filter((c) => c.url.indexOf(GATEWAY) >= 0).length;
  console.log("[before-1] 平台身份登录后的 playerId =", finalId, "｜身份类请求数 =", identityRequests);
  if (finalId !== "taptap_A") fails.push("预期旧代码直接覆盖为 taptap_A，实际 " + finalId);
  if (identityRequests !== 0) fails.push("预期旧代码不发身份请求，实际 " + identityRequests + " 次");
}

// --- before-2 ---
{
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, Error, Object, Array, String, Number, isNaN,
    URLSearchParams, RegExp, encodeURIComponent,
    fetch: () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("{}") }),
    location: { href: "https://example.com/", search: "" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    open: () => null,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], remove() {} }), head: { appendChild() {} }, body: { appendChild() {} } }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(resolve(ROOT, "js/data/alliance-building-config.js"), "utf8"), sandbox, { filename: "config" });
  vm.runInContext(renderCode, sandbox, { filename: "HEAD/alliance-render.js" });
  const has = typeof sandbox.AllianceRenderHelpers?.renderIdentityCardHtml === "function";
  console.log("[before-2] HEAD 渲染层是否提供身份卡片渲染函数 =", has);
  if (has) fails.push("预期旧代码没有身份卡片渲染函数");
}

if (fails.length) {
  console.log("\n负控未通过（判据可能与修复无关）：");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log("\n负控通过 —— 修复前：设备身份被直接覆盖、面板无身份出口；两点都由本次改动修复。");
process.exit(0);
