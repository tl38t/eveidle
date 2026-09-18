// 探针（临时）：联盟身份 A+B 方案的确定性验收。
//
// A 路线（不再产生新重复）：平台身份晚于设备身份就绪时，必须「先归并再切换」，
//   而不是像旧代码那样 localStorage.setItem 直接覆盖 ⇒ 设备身份的联盟数据被孤儿化。
// B 路线（换设备认领 + 清存量）：设备密钥自证 → 签发/兑换转移码 → 盟主合并成员。
//
// 断言锚「实际发出的请求 + 实际落盘的 playerId」，不锚标识符是否出现。
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
// 允许用环境变量指向「修复前」的源码副本做负控（默认始终测仓库当前源码）。
const API_SRC = process.env.EV_IDLE_API_SRC || resolve(ROOT, "js/platform/alliance-api.js");
const RENDER_SRC = process.env.EV_IDLE_RENDER_SRC || resolve(ROOT, "js/ui/alliance-render.js");
console.log("被测源码：\n  " + API_SRC + "\n  " + RENDER_SRC + "\n");
const apiCode = readFileSync(API_SRC, "utf8");
const renderCode = readFileSync(RENDER_SRC, "utf8");
const configCode = readFileSync(resolve(ROOT, "js/data/alliance-building-config.js"), "utf8");

const GATEWAY = "alliance-identity";
const TAPTAP_AUTH = "taptap-auth";
const SIGNIN = "/auth/v1/signin/anonymously";
const LEGACY_LOCAL = "local_mtfy9b2i_jqict2";
const STEAM_ID = "76561198000000001";
const TAPTAP_ID = "taptap_A";

const results = [];
function record(name, fails, note) {
  results.push({ name, fails, note });
}

// ---------------------------------------------------------------------------
// 通用桩
// ---------------------------------------------------------------------------
function makeStorage(initial) {
  const store = new Map(Object.entries(initial || {}));
  const writes = [];
  return {
    store, writes,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); writes.push(k); },
    removeItem: (k) => { store.delete(k); writes.push("!" + k); },
    writesOf: (k) => writes.filter((w) => w === k).length
  };
}

function makeResponse(body, ok = true, status = 200) {
  return { ok, status, text: () => Promise.resolve(body == null ? "" : JSON.stringify(body)) };
}

// 确定性 webcrypto：探针只需可复现，不需要真随机。
function makeCrypto() {
  let seed = 0x2f6e2b1;
  return {
    getRandomValues(buffer) {
      for (let i = 0; i < buffer.length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        buffer[i] = (seed >>> 16) & 0xff;
      }
      return buffer;
    }
  };
}

// ---------------------------------------------------------------------------
// Part 1：API 层（js/platform/alliance-api.js）
// ---------------------------------------------------------------------------
function makeApiSandbox({ playerId, hasTap, hasSteam, mergeLocalResult, secret }) {
  const calls = [];
  const local = makeStorage(playerId ? { eve_idle_alliance_player_id: playerId } : {});
  if (secret) local.setItem("eve_idle_alliance_device_secret", secret);
  const session = makeStorage({});

  const sandbox = {
    console: { warn() {}, log() {}, error() {}, info() {} },
    setTimeout, clearTimeout, Promise, Error, Object, Array, String, Number, Math, Date, JSON, isNaN,
    Uint8Array, URLSearchParams, encodeURIComponent, decodeURIComponent,
    fetch: (url, options) => {
      const target = String(url);
      let body = {};
      try { body = options && options.body ? JSON.parse(options.body) : {}; } catch (_) { body = {}; }
      calls.push({ url: target, body, headers: (options && options.headers) || {} });
      if (target.indexOf(SIGNIN) >= 0) return Promise.resolve(makeResponse({ access_token: "tok-anon" }));
      if (target.indexOf(TAPTAP_AUTH) >= 0) return Promise.resolve(makeResponse({ ok: true, openid: "A", sessionToken: "tok-taptap" }));
      if (target.indexOf(GATEWAY) >= 0) {
        if (body.action === "merge_local") {
          if (mergeLocalResult && mergeLocalResult.ok === false) return Promise.resolve(makeResponse({ ok: false, error: mergeLocalResult.error }, false, 400));
          return Promise.resolve(makeResponse({ ok: true, action: "merge_local", merged: true }));
        }
        if (body.action === "register") return Promise.resolve(makeResponse({ ok: true, action: "register", registered: true }));
        if (body.action === "create_code") return Promise.resolve(makeResponse({ ok: true, action: "create_code", code: "A7K2M9QP", expiresAt: "2026-09-15T10:30:00.000Z" }));
        if (body.action === "redeem_code") return Promise.resolve(makeResponse({ ok: true, action: "redeem_code", keeperPlayerId: LEGACY_LOCAL, merged: true }));
        if (body.action === "admin_merge") return Promise.resolve(makeResponse({ ok: true, action: "admin_merge", merged: true }));
        return Promise.resolve(makeResponse({ ok: false, error: "unknown_identity_action" }, false, 400));
      }
      return Promise.resolve(makeResponse({}, false, 404));
    },
    location: { href: "https://example.com/index.html", search: "" },
    navigator: { userAgent: "probe" },
    localStorage: local,
    sessionStorage: session,
    crypto: makeCrypto(),
    open: () => null
  };
  if (hasTap) {
    sandbox.tap = { login: (opts) => { opts.success({ code: "code-A" }); return undefined; } };
  }
  if (hasSteam) {
    sandbox.SteamAllianceSession = {
      authenticate: () => Promise.resolve({ ok: true, steamId: STEAM_ID, sessionToken: "tok-steam" }),
      getIdentity: () => Promise.resolve({ personaName: "Pilot" })
    };
  }
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(apiCode, sandbox, { filename: "alliance-api.js" });
  return { sandbox, calls, local, identityCalls: () => calls.filter((c) => c.url.indexOf(GATEWAY) >= 0) };
}

// S1 新设备：设备身份 id 必须由设备密钥派生（服务端可复算 ⇒ 知 id ≠ 有密钥）
{
  const { sandbox, local } = makeApiSandbox({});
  const fails = [];
  const id = sandbox.AllianceApi.getPlayerId();
  const secret = local.getItem("eve_idle_alliance_device_secret");
  if (!/^[0-9a-f]{32}$/.test(String(secret))) fails.push("设备密钥不是 32 位十六进制：" + secret);
  if (!/^local_[0-9a-f]{12}$/.test(id)) fails.push("新设备身份未按派生格式生成：" + id);
  if (id !== "local_" + String(secret).slice(0, 12)) fails.push("身份 id 与密钥前 12 位不一致：" + id + " vs " + String(secret).slice(0, 12));
  record("S1 新设备身份按密钥派生（local_<密钥前12位>）", fails, id);
}

// S2 老身份：已固化的老格式 id 必须原样保留，不得被改写
{
  const { sandbox, local } = makeApiSandbox({ playerId: LEGACY_LOCAL });
  const fails = [];
  const id = sandbox.AllianceApi.getPlayerId();
  if (id !== LEGACY_LOCAL) fails.push("老身份被改写：" + id);
  if (local.writesOf("eve_idle_alliance_player_id") > 0) fails.push("对老身份执行了覆盖写");
  if (sandbox.AllianceApi.isDeviceIdentity() !== true) fails.push("老设备身份未被识别为设备身份");
  record("S2 老格式设备身份原样保留（不迁移、不覆盖）", fails, id);
}

// S3 TapTap 身份晚到 → 必须先归并再切换（A 路线核心）
{
  const { sandbox, calls, local, identityCalls } = makeApiSandbox({ playerId: LEGACY_LOCAL, hasTap: true });
  const fails = [];
  await sandbox.AllianceApi.initializeSteamIdentity();
  const finalId = local.getItem("eve_idle_alliance_player_id");
  const merges = identityCalls().filter((c) => c.body.action === "merge_local");
  if (finalId !== TAPTAP_ID) fails.push("切换后身份不是平台身份：" + finalId);
  if (merges.length !== 1) fails.push("未发出且仅发出一次 merge_local，实际 " + merges.length + " 次");
  else {
    if (merges[0].body.devicePlayerId !== LEGACY_LOCAL) fails.push("merge_local 的来源身份错误：" + merges[0].body.devicePlayerId);
    if (merges[0].body.platformPlayerId !== TAPTAP_ID) fails.push("merge_local 的目标身份错误：" + merges[0].body.platformPlayerId);
    if (!/^[0-9a-f]{32}$/.test(String(merges[0].body.secret || ""))) fails.push("merge_local 未携带设备密钥");
    if (!merges[0].headers["x-alliance-session"]) fails.push("merge_local 未携带会话令牌");
  }
  if (calls.some((c) => c.url.indexOf(TAPTAP_AUTH) >= 0) === false) fails.push("未调用 TapTap 身份换取接口");
  record("S3 TapTap 身份晚到：先归并设备身份再切换", fails, "final=" + finalId);
}

// S4 归并失败（两个身份已在不同联盟）→ 保留设备身份，绝不静默丢弃
{
  const { sandbox, local, identityCalls } = makeApiSandbox({
    playerId: LEGACY_LOCAL, hasTap: true,
    mergeLocalResult: { ok: false, error: "两个身份分属不同联盟，请先退出其中一个" }
  });
  const fails = [];
  await sandbox.AllianceApi.initializeSteamIdentity();
  const finalId = local.getItem("eve_idle_alliance_player_id");
  if (finalId !== LEGACY_LOCAL) fails.push("归并失败却切换了身份 ⇒ 设备身份被孤儿化：" + finalId);
  if (identityCalls().filter((c) => c.body.action === "merge_local").length !== 1) fails.push("merge_local 请求次数异常");
  record("S4 归并冲突时不丢弃设备身份（负控）", fails, "final=" + finalId);
}

// S5 Steam 全新设备 → 直接用账号级 SteamID64，且不发起归并
{
  const { sandbox, local, calls } = makeApiSandbox({ hasSteam: true });
  const fails = [];
  await sandbox.AllianceApi.initializeSteamIdentity();
  const finalId = local.getItem("eve_idle_alliance_player_id");
  if (finalId !== STEAM_ID) fails.push("Steam 新设备未落到 SteamID64：" + finalId);
  if (calls.some((c) => c.url.indexOf(GATEWAY) >= 0)) fails.push("Steam 全新设备不应发起任何身份合并请求");
  if (!calls.some((c) => c.url.indexOf(SIGNIN) >= 0)) fails.push("未领取匿名访问令牌");
  record("S5 Steam 全新设备：直接使用账号级 SteamID64", fails, "final=" + finalId);
}

// S6 Steam 已有设备身份 → 归并入 SteamID64（同一人不再变两条）
{
  const { sandbox, local, identityCalls } = makeApiSandbox({ playerId: LEGACY_LOCAL, hasSteam: true });
  const fails = [];
  await sandbox.AllianceApi.initializeSteamIdentity();
  const finalId = local.getItem("eve_idle_alliance_player_id");
  const merges = identityCalls().filter((c) => c.body.action === "merge_local");
  if (finalId !== STEAM_ID) fails.push("Steam 身份未接管：" + finalId);
  if (merges.length !== 1) fails.push("未发出且仅发出一次 merge_local，实际 " + merges.length + " 次");
  else if (merges[0].body.platformPlayerId !== STEAM_ID) fails.push("归并目标不是 SteamID64：" + merges[0].body.platformPlayerId);
  record("S6 Steam 已有设备身份：归并入 SteamID64", fails, "final=" + finalId);
}

// S7 已是平台身份 → 重复登录不得再发归并（幂等）
{
  const { sandbox, calls } = makeApiSandbox({ playerId: TAPTAP_ID, hasTap: true });
  const fails = [];
  await sandbox.AllianceApi.initializeSteamIdentity();
  if (calls.some((c) => c.url.indexOf(GATEWAY) >= 0)) fails.push("平台身份重复登录时发起了多余的身份请求");
  record("S7 平台身份重复登录幂等（无多余请求）", fails, TAPTAP_ID);
}

// S8 签发转移码：先登记密钥，再签发；两步都走云函数
{
  const { sandbox, identityCalls } = makeApiSandbox({ playerId: LEGACY_LOCAL });
  const fails = [];
  const result = await sandbox.AllianceApi.createIdentityCode(900);
  const actions = identityCalls().map((c) => c.body.action);
  if (actions.indexOf("register") < 0) fails.push("签发前未登记设备密钥：" + JSON.stringify(actions));
  if (actions.indexOf("create_code") < 0) fails.push("未调用 create_code：" + JSON.stringify(actions));
  if (actions.indexOf("register") > actions.indexOf("create_code")) fails.push("登记与签发顺序颠倒");
  if (!result || result.code !== "A7K2M9QP") fails.push("未取回转移码：" + JSON.stringify(result));
  record("S8 签发转移码（先登记密钥后签发）", fails, result && result.code);
}

// S9 兑换转移码：本机 playerId 必须切到保留方
{
  const { sandbox, local, identityCalls } = makeApiSandbox({ playerId: "local_ffffffffffff" });
  const fails = [];
  const result = await sandbox.AllianceApi.redeemIdentityCode(" a7k2m9qp ");
  const redeem = identityCalls().filter((c) => c.body.action === "redeem_code")[0];
  if (!redeem) fails.push("未调用 redeem_code");
  else if (redeem.body.code !== "A7K2M9QP") fails.push("转移码未归一化为大写去空格：" + redeem.body.code);
  if (local.getItem("eve_idle_alliance_player_id") !== LEGACY_LOCAL) fails.push("兑换后未切换到保留身份：" + local.getItem("eve_idle_alliance_player_id"));
  if (!result || result.keeperPlayerId !== LEGACY_LOCAL) fails.push("返回值缺少 keeperPlayerId");
  if (local.writesOf("!eve_idle_alliance_access_token") < 1) fails.push("切换身份后未清理匿名访问令牌缓存");
  record("S9 兑换转移码并切换到保留身份", fails, local.getItem("eve_idle_alliance_player_id"));
}

// S10 盟主合并：请求体字段与权限通道
{
  const { sandbox, identityCalls } = makeApiSandbox({ playerId: STEAM_ID });
  const fails = [];
  await sandbox.AllianceApi.adminMergeIdentity(50, "local_aaaa", "local_bbbb");
  const merge = identityCalls().filter((c) => c.body.action === "admin_merge")[0];
  if (!merge) fails.push("未调用 admin_merge");
  else {
    if (merge.body.allianceId !== 50) fails.push("联盟 ID 错误：" + merge.body.allianceId);
    if (merge.body.fromPlayerId !== "local_aaaa" || merge.body.toPlayerId !== "local_bbbb") fails.push("合并方向字段错误");
  }
  record("S10 盟主合并成员身份的请求契约", fails, "");
}

// ---------------------------------------------------------------------------
// Part 2：渲染层（js/ui/alliance-render.js）
// ---------------------------------------------------------------------------
function makeEl(id) {
  const nodes = new Map();
  const el = {
    id, _html: "", style: {}, textContent: "", value: "", disabled: false,
    children: [], onclick: null, parentNode: null,
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = String(v); },
    insertAdjacentHTML(_pos, html) { el._html += String(html); },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    remove() {},
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, focus() {},
    querySelectorAll(sel) { return matchNodes(el, nodes, sel); },
    querySelector(sel) { return matchNodes(el, nodes, sel)[0] || null; }
  };
  return el;
}

// 极简选择器匹配：只支持本次用到的 #id / .class / [data-xxxx]，命中则在
// innerHTML 里已出现过的前提下返回**同一个**桩（保证 onclick 赋值可被观察）。
function matchNodes(el, nodes, selector) {
  const found = [];
  const specs = String(selector).split(",").map((s) => s.trim()).filter(Boolean);
  for (const spec of specs) {
    const key = spec;
    if (nodes.has(key)) { found.push(nodes.get(key)); continue; }
    const present = spec.charAt(0) === "#"
      ? el._html.indexOf('id="' + spec.slice(1) + '"') >= 0
      : spec.charAt(0) === "."
        ? new RegExp('class="[^"]*' + spec.slice(1) + '[^"]*"').test(el._html)
        : el._html.indexOf(spec.slice(1, -1)) >= 0;
    if (!present) continue;
    const node = makeEl(spec);
    nodes.set(key, node);
    found.push(node);
  }
  return found;
}

function renderHarness({ playerId, isDevice, isOwner, ownerId }) {
  const els = {};
  const content = makeEl("alliance-content");
  const stateBox = makeEl("alliance-state");
  els["alliance-content"] = content;
  els["alliance-state"] = stateBox;
  els["alliance-msg"] = makeEl("alliance-msg");
  els["btn-open-cloud-test"] = makeEl("btn-open-cloud-test");
  const calls = [];
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, Error, Object, Array, String, Number, isNaN,
    URLSearchParams, RegExp, encodeURIComponent,
    fetch: () => Promise.resolve(makeResponse({}, false, 404)),
    location: { href: "https://example.com/index.html", search: "" },
    localStorage: makeStorage({}),
    sessionStorage: makeStorage({}),
    open: () => null,
    gameState: {
      _dirty: false,
      alliance: isOwner === undefined ? null : { allianceId: 50, ownerPlayerId: ownerId, buildings: [] }
    },
    SaveManager: { save() {} },
    AllianceTaskCatalog: { buildRuntimeCatalog: () => [] },
    AllianceTaskModel: { generateFive: () => [] },
    ResourceRegistry: { get: () => 0, add() {}, spend: () => false },
    AllianceApi: {
      initializeSteamIdentity: () => Promise.resolve(),
      getPlayerId: () => playerId,
      isDeviceIdentity: () => !!isDevice,
      getAllianceSessionToken: () => "",
      getAlliance: () => Promise.resolve(null),
      getMemberStats: () => Promise.resolve([]),
      pingOnline: () => Promise.resolve(),
      listAlliances: () => Promise.resolve([]),
      createIdentityCode: () => { calls.push({ action: "create_code" }); return Promise.resolve({ code: "A7K2M9QP", expiresAt: "2026-08-09T12:00:00.000Z" }); },
      redeemIdentityCode: () => { calls.push({ action: "redeem_code" }); return Promise.resolve({ keeperPlayerId: LEGACY_LOCAL }); },
      adminMergeIdentity: () => { calls.push({ action: "admin_merge" }); return Promise.resolve({ merged: true }); }
    },
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      head: { appendChild() {} },
      body: { appendChild() {} }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(configCode, sandbox, { filename: "alliance-building-config.js" });
  vm.runInContext(renderCode, sandbox, { filename: "alliance-render.js" });
  return { sandbox, content, calls, helpers: sandbox.AllianceRenderHelpers };
}

// R1 设备身份：提示为设备级，且不显示「合并成员身份」
{
  const { helpers } = renderHarness({ playerId: "local_ab12cd34ef56", isDevice: true });
  const fails = [];
  if (typeof helpers.renderIdentityCardHtml !== "function") {
    record("R1 身份卡片（设备身份 / 非盟主）", ["渲染层未提供身份卡片渲染函数"]);
  } else {
    const html = helpers.renderIdentityCardHtml(false);
    if (html.indexOf("alliance-identity-card") < 0) fails.push("缺少身份卡片容器");
    if (html.indexOf("本机设备") < 0) fails.push("未标注「本机设备」");
    if (html.indexOf("local_ab12cd34ef56") < 0) fails.push("未显示本机身份");
    if (html.indexOf("生成转移码") < 0 || html.indexOf("使用转移码") < 0) fails.push("缺少转移码按钮");
    if (html.indexOf("合并成员身份") >= 0) fails.push("非盟主出现「合并成员身份」按钮");
    if (html.indexOf("设备身份（未绑定平台账号）") < 0) fails.push("缺少换设备提示");
    record("R1 身份卡片（设备身份 / 非盟主）", fails, String(helpers.identityKindLabel && helpers.identityKindLabel("local_ab12cd34ef56")));
  }
}

// R2 盟主：出现「合并成员身份」
{
  const { helpers } = renderHarness({ playerId: "local_ab12cd34ef56", isDevice: true });
  const fails = [];
  if (typeof helpers.renderIdentityCardHtml !== "function") {
    record("R2 身份卡片（盟主）", ["渲染层未提供身份卡片渲染函数"]);
  } else {
    if (helpers.renderIdentityCardHtml(true).indexOf("合并成员身份") < 0) fails.push("盟主缺少「合并成员身份」按钮");
    record("R2 身份卡片（盟主）", fails, "");
  }
}

// R3 平台身份：类型标注为账号级，且提示无需转移码
{
  const { helpers } = renderHarness({ playerId: TAPTAP_ID, isDevice: false });
  const fails = [];
  if (typeof helpers.renderIdentityCardHtml !== "function" || typeof helpers.identityKindLabel !== "function") {
    record("R3 身份卡片（平台账号身份）", ["渲染层未提供身份卡片渲染函数"]);
  } else {
    const html = helpers.renderIdentityCardHtml(false);
    if (html.indexOf("TapTap 账号") < 0) fails.push("未标注 TapTap 账号");
    if (html.indexOf("无需转移码") < 0) fails.push("账号级身份缺少「无需转移码」提示");
    if (helpers.identityKindLabel(STEAM_ID) !== "Steam 账号") fails.push("SteamID64 未识别为 Steam 账号");
    record("R3 身份卡片（平台账号身份）", fails, "");
  }
}

// R4 端到端接线：面板实际渲染出身份卡片，按钮点了真的走到 API
{
  const { sandbox, content, calls } = renderHarness({ playerId: "local_ab12cd34ef56", isDevice: true, isOwner: false, ownerId: "" });
  const fails = [];
  sandbox.renderAlliancePage();
  await new Promise((r) => setTimeout(r, 300));
  if (content.innerHTML.indexOf("alliance-identity-card") < 0) fails.push("面板未渲染出身份卡片");
  const card = content.querySelector(".alliance-identity-card");
  if (!card) fails.push("身份卡片节点不可定位");
  const createButton = content.querySelector(".alliance-identity-create");
  if (!createButton) fails.push("「生成转移码」按钮不在 DOM 中");
  else if (typeof createButton.onclick !== "function") fails.push("「生成转移码」按钮未接线");
  if (createButton && typeof createButton.onclick === "function") {
    createButton.onclick();
    await new Promise((r) => setTimeout(r, 20));
    if (!calls.some((c) => c.action === "create_code")) fails.push("点击「生成转移码」没有走到 API");
  }
  const mergeButton = content.querySelector(".alliance-identity-merge");
  if (mergeButton && mergeButton.style.display !== "none") fails.push("非盟主的合并按钮未被隐藏");
  record("R4 面板端到端接线（渲染 + 点击落点）", fails, "actions=" + JSON.stringify(calls.map((c) => c.action)));
}

// ---------------------------------------------------------------------------
let allPass = true;
for (const r of results) {
  const ok = r.fails.length === 0;
  if (!ok) allPass = false;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${r.name}${r.note ? "  → " + r.note : ""}`);
  for (const f of r.fails) console.log("        - " + f);
}
console.log(allPass
  ? "\nALL PASS —— A（归并不丢弃 / Steam 不回归）+ B（转移码认领 + 盟主合并）全部成立"
  : "\n存在 FAIL —— 见上");
process.exit(allPass ? 0 : 1);
