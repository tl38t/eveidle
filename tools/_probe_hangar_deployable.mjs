// 验证：船坞标签 = 复用舰船工程 SHIP_ASSEMBLY_LINES 六条线 + 部署物归入「特殊」线 + 桌面端按线过滤 + 部署物渲染/动作
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m; const srcs = [];
while ((m = re.exec(html))) srcs.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
const UI_EXCLUDE = new Set([
  "js/ui/error-boundary.js",
  "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js",
  "js/core/runtime.js", "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js"
]);
let combined = "";
for (const s of srcs.filter(x => !UI_EXCLUDE.has(x))) {
  combined += "\n;\n// " + s + "\n" + fs.readFileSync(path.resolve(ROOT, s), "utf8");
}
const noop = () => {};
const mk = () => ({ addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, dataset: {}, getContext: () => ({}), innerHTML: "", querySelector: () => mk(), querySelectorAll: () => [], getElementById: () => mk(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }), offsetHeight: 1, offsetWidth: 1, textContent: "", value: "1", children: [], parentNode: null, setAttribute: noop, getAttribute: () => null });
const documentMock = { addEventListener: noop, body: mk(), createElement: () => mk(), getElementById: () => mk(), querySelector: () => mk(), querySelectorAll: () => [] };
const sandbox = { console, window: null, document: documentMock, localStorage: { getItem: () => null, setItem: noop }, alert: noop, setTimeout: noop, setInterval: noop, requestAnimationFrame: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), GameEvents: { emit: noop, on: () => () => {} }, Blob: class {}, FileReader: class {}, URL: { createObjectURL: () => "blob:", revokeObjectURL: noop } };
sandbox.window = sandbox; sandbox.window.addEventListener = noop; sandbox.addEventListener = noop; sandbox.location = { href: "", search: "", hash: "" }; sandbox.navigator = { userAgent: "node" };
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: "c.js" });
const R = e => vm.runInContext(e, sandbox);

let pass = 0, fail = 0;
function ok(cond, label, extra) { if (cond) { pass++; console.log("✓ " + label); } else { fail++; console.log("✗ " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); } }

// 多舰船（跨线），验证桌面端按 SHIP_ASSEMBLY_LINES 过滤
function makeState(over) {
  const base = {
    skills: { shipEngineering: { lvl: 60, xp: 0 } },
    inventory: { ships: [
      { instanceId: "ship_player", shipId: "rookie_corvette", enhancementLevel: 0, fitted: { high: ["t1_small_laser"], mid: [], low: [], rig: [] } },
      { instanceId: "ship_miner", shipId: "miner_frigate", enhancementLevel: 0, fitted: { high: [], mid: [], low: [], rig: [] } },
      { instanceId: "ship_heron", shipId: "heron", enhancementLevel: 0, fitted: { high: [], mid: [], low: [], rig: [] } }
    ] },
    equipment: { instances: [], inventory: [] },
    shipAssignments: {},
    resources: { fuel: 5000 },
    station: { bodyLevel: 3, buildings: { legion_hall: 1 } },
    legion: { npcs: [], hallLevel: 1, active: true, dlc: { unlocked: true } },
    research: { completedLevels: { legion_dual_squad: 1 } },
    combat: { active: false, squad: { enabled: false, members: [], deployables: [], deployableStorage: [], targetId: null, battleId: null, lastRound: null, pendingNpcIds: [] } },
    currentAction: { active: false, skill: "", shipAsmTarget: "laser_directional_salvage_unit", shipAsmLine: "special", hangarTab: "ships" },
    ownedBlueprints: []
  };
  return JSON.parse(JSON.stringify(base), (k, v) => v);
}
function buildState(over) { const s = makeState(); if (over) Object.assign(s, over); return s; }

// ---- 1. 标签 = 六条线，默认 shield_laser ----
{
  const st = buildState();
  st.combat.squad.deployables = [{ deployableId: "laser_directional_salvage_unit", name: "激光定向打捞单元" }];
  st.combat.squad.deployableStorage = ["laser_directional_salvage_unit"];
  const d = R(`(function(){ const s = arguments[0]; return getHangarDisplayState(s, Date.now()); })`);
  const disp = d(st);
  ok(Array.isArray(disp.tabs) && disp.tabs.length === 6, "hangar tabs = 6 条舰船工程线", disp.tabs.map(t => t.id));
  ok(disp.tabs.some(t => t.id === "special") && disp.tabs.some(t => t.id === "shield_laser"), "tabs 含 shield_laser 与 special", disp.tabs.map(t => t.id));
  ok(disp.activeTab === "shield_laser", "默认 activeTab=shield_laser（旧 ships/deployables 存档值被修正）", disp.activeTab);
  ok(disp.tabs.find(t => t.id === "shield_laser").selected === true, "shield_laser 被选中");
  ok(Array.isArray(disp.ships) && disp.ships.length === 3, "display.ships 返回全部舰船（移动端兼容，桌面端自行过滤）", disp.ships.length);
  ok(disp.deployableView.deployed.length === 1 && disp.deployableView.deployableStorage.length === 1, "deployableView 含 MTU");
  ok(disp.deployableView.capacity >= 1 && disp.deployableView.mtu.active === true, "special 线容量/MTU 生效", disp.deployableView.capacity);
}

// ---- 2. selectHangarTab 仅接受六条线 id ----
{
  const st = buildState();
  const r1 = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/selectHangarTab", tab:"archaeology" }, Date.now()); })`)(st);
  ok(r1.changed === true && st.currentAction.hangarTab === "archaeology", "selectHangarTab 切到 archaeology", st.currentAction.hangarTab);
  const r2 = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/selectHangarTab", tab:"special" }, Date.now()); })`)(st);
  ok(r2.changed === true && st.currentAction.hangarTab === "special", "selectHangarTab 切到 special", st.currentAction.hangarTab);
  const r3 = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/selectHangarTab", tab:"bogus" }, Date.now()); })`)(st);
  ok(r3.changed === false && r3.reason === "unknown-tab", "非法 tab 拒绝", r3);
}

// ---- 3. 桌面端按线过滤：getShipAssemblyLine 归类 ----
{
  const st = buildState();
  const d = R(`(function(){ const s = arguments[0]; return getHangarDisplayState(s, Date.now()); })`);
  const disp = d(st);
  // 复刻 renderHangarPanel 的过滤逻辑
  const filterBy = (line) => disp.ships.filter(s => !s.unknown && R(`(function(){ return getShipAssemblyLine(arguments[0]); })`)(s.shipId) === line);
  const ind = filterBy("industrial");
  const arc = filterBy("archaeology");
  ok(ind.length === 1 && ind[0].shipId === "miner_frigate", "industrial 线仅 miner_frigate", ind.map(s => s.shipId));
  ok(arc.length === 1 && arc[0].shipId === "heron", "archaeology 线仅 heron", arc.map(s => s.shipId));
  const lines = disp.ships.map(s => R(`(function(){ return getShipAssemblyLine(arguments[0]); })`)(s.shipId));
  ok(new Set(lines).size >= 2, "各舰船归属不同线（过滤有效）", lines);
}

// ---- 4. 总装选中 MTU：productKind=deployable、selectedShip=null ----
{
  const st = buildState();
  const eng = R(`(function(){ const s = arguments[0]; return getShipEngineeringDisplayState(s, Date.now()); })`)(st);
  ok(eng.currentAssembly && eng.currentAssembly.productKind === "deployable", "currentAssembly.productKind=deployable", eng.currentAssembly && eng.currentAssembly.productKind);
  ok(eng.selectedShip === null, "selectedShip=null（MTU 无 shipId）", eng.selectedShip);
}

// ---- 5. renderDeployableAttributes：覆盖面板、无残留槽位 ----
{
  const st = buildState();
  const eng = R(`(function(){ const s = arguments[0]; return getShipEngineeringDisplayState(s, Date.now()); })`)(st);
  const el = { innerHTML: "" };
  sandbox.document.getElementById = (id) => (id === "ship-attr-display" ? el : mk());
  R(`(function(){ const display = arguments[0]; renderDeployableAttributes(display); })`)(eng);
  ok(el.innerHTML.includes("货柜/组件") && el.innerHTML.includes("小队 1 格"), "renderDeployableAttributes 含部署物属性", el.innerHTML.slice(0, 60));
  ok(!el.innerHTML.includes("槽位：高"), "renderDeployableAttributes 不含舰船槽位残留", el.innerHTML.slice(0, 60));
  ok(el.innerHTML.includes("非舰船"), "renderDeployableAttributes 标注非舰船");
}

// ---- 6. renderHangarDeployables：已部署卡 + data-undeploy ----
{
  const st = buildState();
  st.combat.squad.deployables = [{ deployableId: "laser_directional_salvage_unit", name: "激光定向打捞单元" }];
  const disp = R(`(function(){ const s = arguments[0]; return getHangarDisplayState(s, Date.now()); })`)(st);
  const gridEl = { innerHTML: "" };
  sandbox.document.getElementById = (id) => (id === "hangar-ship-grid" ? gridEl : mk());
  R(`(function(){ const d = arguments[0]; renderHangarDeployables(d); })`)(disp);
  ok(gridEl.innerHTML.includes("lcs-deploy-card") && gridEl.innerHTML.includes("激光定向打捞单元"), "renderHangarDeployables 渲染已部署卡", gridEl.innerHTML.slice(0, 40));
  ok(gridEl.innerHTML.includes("data-undeploy="), "含 data-undeploy（取消部署）按钮", gridEl.innerHTML.includes("data-undeploy"));
}

// ---- 7. renderHangarDeployables：库存卡 + data-deploy（可部署） ----
{
  const st = buildState();
  st.combat.squad.deployables = [];
  st.combat.squad.deployableStorage = ["laser_directional_salvage_unit"];
  const disp = R(`(function(){ const s = arguments[0]; return getHangarDisplayState(s, Date.now()); })`)(st);
  const gridEl = { innerHTML: "" };
  sandbox.document.getElementById = (id) => (id === "hangar-ship-grid" ? gridEl : mk());
  R(`(function(){ const d = arguments[0]; renderHangarDeployables(d); })`)(disp);
  ok(gridEl.innerHTML.includes("data-deploy="), "库存 MTU 含 data-deploy（部署）按钮");
  ok(!gridEl.innerHTML.includes("disabled"), "容量足够时部署按钮不禁用", gridEl.innerHTML.includes("disabled"));
}

// ---- 8. undeploy/deploy 动作经 manufacturing/* 走通 ----
{
  const st = buildState();
  st.combat.squad.deployables = [{ deployableId: "laser_directional_salvage_unit", name: "激光定向打捞单元" }];
  const u = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/undeployDeployable", deployableId:"laser_directional_salvage_unit" }, Date.now()); })`)(st);
  ok(u.changed === true && st.combat.squad.deployables.length === 0 && st.combat.squad.deployableStorage.includes("laser_directional_salvage_unit"), "undeploy 经 manufacturing/* 走通", u);
  const dp = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/deployDeployable", deployableId:"laser_directional_salvage_unit" }, Date.now()); })`)(st);
  ok(dp.changed === true && st.combat.squad.deployables.length === 1, "deploy 经 manufacturing/* 走通", dp);
}

console.log("\n=== " + pass + " passed / " + fail + " failed ===");
process.exit(fail ? 1 : 0);
