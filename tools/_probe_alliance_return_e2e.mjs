// 探针（临时）：假 DOM + 桩 AllianceApi，把「联盟面板 → 成员列表」的**两条**渲染路径都跑出来，
// 回答一个唯一问题：游戏里到底能不能看到 当日/总/最后上线 这三个新字段。
//
// 路径 A「云端直读」：renderAlliancePage() 内 startCloudRefresh() 直读 getMemberStats。
// 路径 B「云端回传」：从 relay 页返回时 URL 带 allianceSnapshot（内含 members[]，含三个字段），
//                    但直读失败 ⇒ 走 ctx.fallbackHtml。
//
// 断言 A/B 都必须渲染出三个字段。B 失败 = 用户在游戏里看不到「回传」的成员建设点。
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const renderCode = readFileSync(resolve(ROOT, "js/ui/alliance-render.js"), "utf8");
const configCode = readFileSync(resolve(ROOT, "js/data/alliance-building-config.js"), "utf8");

function makeEl(id) {
  return {
    id,
    _html: "",
    style: {},
    hidden: false,
    textContent: "",
    value: "",
    children: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML() {},
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    onclick: null,
    parentNode: null
  };
}

const MEMBERS_STATS = [
  { playerId: "taptap_A", username: "ZM", isOwner: true, totalPoints: 774, dailyPoints: 310, lastOnlineAt: new Date(Date.now() - 3 * 3600000).toISOString() },
  { playerId: "taptap_B", username: "Hitler", isOwner: false, totalPoints: 770, dailyPoints: 150, lastOnlineAt: null }
];
const ALLIANCE = {
  id: 50, code: "ACE", name: "ACE", ownerId: "taptap_A",
  memberCount: 19, memberCap: 25,
  construction: { points_balance: 1234, total_points_earned: 5678 },
  buildings: [{ building_type: "logistics_hub", level: 3 }]
};
// relay alliance.html 的真实回传载荷：allianceSnapshot.members（snake_case，来自 RPC 原始行）
const SNAPSHOT = {
  id: 50, code: "ACE", memberCount: 19,
  construction: { points_balance: 1234, total_points_earned: 5678 },
  buildings: [{ building_type: "logistics_hub", level: 3 }],
  members: [
    { player_id: "taptap_A", username: "ZM", is_owner: true, total_points: 774, daily_points: 310, last_online_at: new Date(Date.now() - 3 * 3600000).toISOString() },
    { player_id: "taptap_B", username: "Hitler", is_owner: false, total_points: 770, daily_points: 150, last_online_at: null }
  ],
  tasks: []
};

function runScenario(name, { search, getAlliance, expectStats = true }) {
  const els = {};
  const content = makeEl("alliance-content");
  const stateBox = makeEl("alliance-state");
  els["alliance-content"] = content;
  els["alliance-state"] = stateBox;
  els["alliance-msg"] = makeEl("alliance-msg");
  els["btn-open-cloud-test"] = makeEl("btn-open-cloud-test");
  els["btn-alliance-diagnose"] = null;

  const sandbox = {
    console: { warn() {}, log() {}, error: () => undefined },
    setTimeout, clearTimeout,
    URLSearchParams, Intl, Date, Math, JSON, Promise, Error, Object, Array, String, Number, isNaN,
    fetch: () => Promise.reject(new Error("no network in probe")),
    location: { href: "https://example.com/index.html", search },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    open: () => null,
    gameState: { _dirty: false },
    SaveManager: { save() {} },
    AllianceTaskCatalog: { buildRuntimeCatalog: () => [] },
    AllianceTaskModel: { generateFive: () => [] },
    ResourceRegistry: { get: () => 0, add() {}, spend: () => false },
    AllianceApi: {
      initializeSteamIdentity: () => Promise.resolve(),
      getPlayerId: () => "taptap_A",
      getAllianceSessionToken: () => "",
      getAlliance,
      getMemberStats: () => Promise.resolve(MEMBERS_STATS),
      pingOnline: () => Promise.resolve(),
      listAlliances: () => Promise.resolve([])
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

  const fails = [];
  const check = (cond, msg) => { if (!cond) fails.push(msg); };

  try {
    vm.runInContext(configCode, sandbox, { filename: "alliance-building-config.js" });
    vm.runInContext(renderCode, sandbox, { filename: "alliance-render.js" });
  } catch (e) {
    return { name, fails: ["加载抛错: " + e.message], html: "" };
  }

  sandbox.renderAlliancePage();
  return new Promise((r) => setTimeout(() => {
    const html = stateBox.innerHTML;
    const hasSection = html.indexOf("联盟成员") >= 0;
    check(hasSection, "未渲染出「联盟成员」区段");
    if (expectStats) {
      check(/当日 310/.test(html), "缺少「当日 310」");
      check(/总 774/.test(html), "缺少「总 774」");
      check(/3 小时前/.test(html), "缺少「3 小时前」");
      check(/从未上线/.test(html), "缺少「从未上线」");
    }
    r({ name, fails, html, hasSection });
  }, 250));
}

const enc = encodeURIComponent;
const snapshotSearch =
  "?allianceId=50&allianceCode=ACE&allianceOwner=taptap_A&allianceOwnerName=ZM&allianceMembers=19" +
  "&allianceBuildingLevel=3&allianceSnapshot=" + enc(JSON.stringify(SNAPSHOT));

const A = await runScenario("A 云端直读（getMemberStats 成功）", {
  search: "",
  getAlliance: () => Promise.resolve(ALLIANCE)
});
const B = await runScenario("B 云端回传（relay 返回 allianceSnapshot，直读失败）", {
  search: snapshotSearch,
  getAlliance: () => Promise.reject(new Error("cloud unreachable in probe"))
});

// 兜底：旧 relay 只发 allianceMemberList（camelCase，无统计字段）时，成员区仍须渲染（不炸、不空）。
const legacySearch =
  "?allianceId=50&allianceCode=ACE&allianceOwner=taptap_A&allianceMembers=19" +
  "&allianceBuildingLevel=3&allianceMemberList=" + enc(JSON.stringify([{ playerId: "taptap_A", username: "ZM" }]));
const C = await runScenario("C 旧 relay 契约（仅 allianceMemberList 兜底）", {
  search: legacySearch,
  getAlliance: () => Promise.reject(new Error("cloud unreachable in probe")),
  expectStats: false
});

let allPass = true;
for (const res of [A, B, C]) {
  const ok = res.fails.length === 0;
  if (!ok) allPass = false;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${res.name}`);
  if (!ok) for (const f of res.fails) console.log("        - " + f);
}
console.log("\n---- 路径 B 实际渲染出的成员区 ----");
const i = B.html.indexOf("联盟成员");
console.log(i >= 0 ? B.html.slice(i, i + 400) : "(整卡都没有「联盟成员」区段)");
console.log("-----------------------------------");
console.log(allPass ? "\nALL PASS —— 两条路径都能在游戏内显示 当日/总/最后上线" : "\n存在 FAIL —— 上面列出的字段在对应路径下玩家看不到");
process.exit(allPass ? 0 : 1);
