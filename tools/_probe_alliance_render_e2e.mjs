// 探针（临时）：假 DOM + 桩 AllianceApi，跑通 renderAlliancePage 的「云端直读」路径，
// 断言成员卡片真的渲染出 当日 / 总 / 最后上线 三个新字段。
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync("js/ui/alliance-render.js", "utf8");
// 必须加载真配置：renderBuildingSummary 会读 BUILDINGS[id].maxLevel/levels，
// 早先用 `BUILDINGS: {}` 的桩会让面板加载即抛 TypeError（探针从未真正跑到断言）。
const configCode = readFileSync("js/data/alliance-building-config.js", "utf8");

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

const els = {};
const content = makeEl("alliance-content");
const stateBox = makeEl("alliance-state");
els["alliance-content"] = content;
els["alliance-state"] = stateBox;
els["alliance-msg"] = makeEl("alliance-msg");
els["btn-open-cloud-test"] = makeEl("btn-open-cloud-test");
els["btn-alliance-diagnose"] = null;

const MEMBERS = [
  { playerId: "taptap_A", username: "ZM", isOwner: true, totalPoints: 774, dailyPoints: 310, lastOnlineAt: new Date(Date.now() - 3 * 3600000).toISOString() },
  { playerId: "taptap_B", username: "Hitler", isOwner: false, totalPoints: 770, dailyPoints: 150, lastOnlineAt: null }
];
const ALLIANCE = {
  id: 50, code: "ACE", name: "ACE", ownerId: "taptap_A",
  memberCount: 19, memberCap: 25,
  construction: { points_balance: 1234, total_points_earned: 5678 },
  buildings: []
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  URLSearchParams,
  Intl,
  Date,
  Math,
  JSON,
  Promise,
  Error,
  Object,
  Array,
  String,
  Number,
  Number,
  fetch: () => Promise.reject(new Error("no network in probe")),
  location: { href: "https://example.com/index.html", search: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {} },
  open: () => null,
  gameState: { _dirty: false },
  SaveManager: { save() {} },
  AllianceApi: {
    initializeSteamIdentity: () => Promise.resolve(),
    getPlayerId: () => "taptap_A",
    getAllianceSessionToken: () => "",
    getAlliance: () => Promise.resolve(ALLIANCE),
    getMemberStats: (id) => {
      sandbox.__statsCalledWith = id;
      return Promise.resolve(MEMBERS);
    },
    pingOnline: () => { sandbox.__pingCount = (sandbox.__pingCount || 0) + 1; return Promise.resolve(); },
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

const msgs = [];
let pass = true;
const check = (cond, msg) => { if (!cond) { pass = false; msgs.push(msg); } };

try {
  vm.runInContext(configCode, sandbox, { filename: "alliance-building-config.js" });
  vm.runInContext(code, sandbox, { filename: "alliance-render.js" });
} catch (e) {
  pass = false;
  msgs.push("加载抛错: " + e.message);
}

sandbox.renderAlliancePage();

await new Promise((r) => setTimeout(r, 200));

const html = stateBox.innerHTML;
check(sandbox.__statsCalledWith === 50, `getMemberStats 未被调用或入参错：${sandbox.__statsCalledWith}`);
check((sandbox.__pingCount || 0) >= 1, "pingOnline 心跳未调用");
check(/当日 310/.test(html), "成员卡片缺少「当日 310」");
check(/总 774/.test(html), "成员卡片缺少「总 774」");
check(/3 小时前/.test(html), "成员卡片缺少「3 小时前」");
check(/从未上线/.test(html), "成员卡片缺少无上线时间时的「从未上线」");

console.log("---- 渲染出的成员区 HTML 片段 ----");
const idx = html.indexOf("联盟成员");
console.log(idx >= 0 ? html.slice(idx, idx + 800) : "(未找到「联盟成员」区段)");
console.log("---------------------------------");
console.log(pass ? "PASS —— 游戏内渲染路径已输出 当日/总/最后上线 ✅" : "FAIL —— " + msgs.join("; "));
process.exit(pass ? 0 : 1);
