// 验证：①MTU 未拥有时不可经战斗小队下拉部署（setLegionSquadSelection 拒绝）；②部署物拆解按舰船公式退款
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
const sandbox = { console, window: null, document: documentMock, localStorage: { getItem: () => null, setItem: noop }, alert: noop, setTimeout: noop, setInterval: noop, requestAnimationFrame: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), RuntimeGuard: { report: noop, guard: noop }, GameEvents: { emit: noop, on: () => () => {} }, Blob: class {}, FileReader: class {}, URL: { createObjectURL: () => "blob:", revokeObjectURL: noop } };
sandbox.window = sandbox; sandbox.window.addEventListener = noop; sandbox.addEventListener = noop; sandbox.location = { href: "", search: "", hash: "" }; sandbox.navigator = { userAgent: "node" };
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: "c.js" });
const R = e => vm.runInContext(e, sandbox);

let pass = 0, fail = 0;
function ok(cond, label, extra) { if (cond) { pass++; console.log("✓ " + label); } else { fail++; console.log("✗ " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); } }

function makeState() {
  return {
    skills: { refining: { lvl: 60, xp: 0 }, shipEngineering: { lvl: 60, xp: 0 } },
    inventory: { ships: [ { instanceId: "ship_player", shipId: "rookie_corvette", enhancementLevel: 0, fitted: { high: [], mid: [], low: [], rig: [] } } ] },
    equipment: { instances: [], inventory: [] },
    shipAssignments: {},
    resources: { fuel: 5000 },
    station: { bodyLevel: 3, buildings: { legion_hall: 1 } },
    legion: { npcs: [], hallLevel: 1, active: true, dlc: { unlocked: true } },
    research: { completedLevels: { legion_dual_squad: 1 } },
    combat: { active: false, squad: { enabled: false, members: [], deployables: [], deployableStorage: [], targetId: null, battleId: null, lastRound: null, pendingNpcIds: [] } },
    currentAction: { active: false, skill: "", shipAsmTarget: "laser_directional_salvage_unit", shipAsmLine: "special", hangarTab: "special" },
    ownedBlueprints: []
  };
}

// ---- 1. Bug①：未拥有 MTU 时，战斗小队下拉选入被拒绝 ----
{
  const st = makeState(); // 空 storage、空 deployables
  const res = R(`(function(){ const s = arguments[0]; return LEGION_COMBAT_SQUAD.setLegionSquadSelection(s, ["deployable:laser_directional_salvage_unit"], { now: Date.now() }); })`)(st);
  ok(st.combat.squad.deployables.length === 0, "未拥有时 deployables 不被写入（漏洞已堵）", st.combat.squad.deployables);
  ok(Array.isArray(res.skipped) && res.skipped.some(x => x.kind === "deployable" && x.reason === "not-owned"), "返回 skipped: not-owned", res.skipped);
}

// ---- 2. 拥有 MTU 时（库存），下拉选入被接受 ----
{
  const st = makeState();
  st.combat.squad.deployableStorage = ["laser_directional_salvage_unit"];
  const res = R(`(function(){ const s = arguments[0]; return LEGION_COMBAT_SQUAD.setLegionSquadSelection(s, ["deployable:laser_directional_salvage_unit"], { now: Date.now() }); })`)(st);
  ok(st.combat.squad.deployables.length === 1, "拥有时 deployables 被写入", st.combat.squad.deployables);
  ok(res.deployableIds.length === 1, "deployableIds 含 1 项", res.deployableIds);
}

// ---- 3. 已部署的 MTU（非库存）也可保持选中 ----
{
  const st = makeState();
  st.combat.squad.deployables = [{ deployableId: "laser_directional_salvage_unit", name: "激光定向打捞单元" }];
  const res = R(`(function(){ const s = arguments[0]; return LEGION_COMBAT_SQUAD.setLegionSquadSelection(s, ["deployable:laser_directional_salvage_unit"], { now: Date.now() }); })`)(st);
  ok(st.combat.squad.deployables.length === 1, "已部署项重选保持", st.combat.squad.deployables);
  ok(!res.skipped.some(x => x.reason === "not-owned"), "已部署不算 not-owned");
}

// ---- 4. 拆解：库存 MTU 按舰船公式退款 ----
{
  const st = makeState();
  st.combat.squad.deployableStorage = ["laser_directional_salvage_unit"];
  const rate = R(`(function(){ return getReclaimRate(arguments[0]); })`)(st);
  const recipe = R(`(function(){ return SHIP_ASSEMBLY_RECIPES.find(r => r.deployableId === "laser_directional_salvage_unit"); })`)(st);
  const expected = R(`(function(){ return getShipDismantleQuote(arguments[0], null, 0, getReclaimRate(arguments[1])); })`)(recipe, st);
  const before = {};
  for (const e of expected) if (e.refId) before[e.refId] = (R(`(function(){ return ResourceRegistry.get(arguments[0], arguments[1]); })`)(st, e.refId)) || 0;
  const res = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/dismantleDeployable", deployableId:"laser_directional_salvage_unit" }, Date.now()); })`)(st);
  ok(res.changed === true, "拆解成功", res);
  ok(st.combat.squad.deployableStorage.length === 0, "拆解后库存清零", st.combat.squad.deployableStorage);
  let okRefund = true;
  for (const e of expected) {
    if (!e.refId) continue;
    const after = R(`(function(){ return ResourceRegistry.get(arguments[0], arguments[1]); })`)(st, e.refId) || 0;
    if (after !== before[e.refId] + e.returned) okRefund = false;
  }
  ok(okRefund, "退款 = floor(成本×冶炼回收率)，与 getShipDismantleQuote 同源", { rate, expected: expected.map(e => e.name + ":" + e.returned) });
}

// ---- 5. 拆解拦截：已部署不可拆（须先取消部署） ----
{
  const st = makeState();
  st.combat.squad.deployables = [{ deployableId: "laser_directional_salvage_unit", name: "激光定向打捞单元" }];
  const res = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/dismantleDeployable", deployableId:"laser_directional_salvage_unit" }, Date.now()); })`)(st);
  ok(res.changed === false && res.reason === "deployed", "已部署时拒绝拆解", res);
}

// ---- 6. 拆解拦截：未拥有 ----
{
  const st = makeState();
  const res = R(`(function(){ const s = arguments[0]; return dispatchGameAction(s, { type:"manufacturing/dismantleDeployable", deployableId:"laser_directional_salvage_unit" }, Date.now()); })`)(st);
  ok(res.changed === false && res.reason === "not-in-storage", "未拥有时拒绝拆解", res);
}

// ---- 7. selector deployableView.dismantle 含库存项与预览 ----
{
  const st = makeState();
  st.combat.squad.deployableStorage = ["laser_directional_salvage_unit"];
  const disp = R(`(function(){ const s = arguments[0]; return getHangarDisplayState(s, Date.now()); })`)(st);
  const dz = disp.deployableView.dismantle;
  ok(Array.isArray(dz.items) && dz.items.length === 1 && dz.items[0].canDismantle === true, "dismantle.items 含可拆库存项", dz.items);
  ok(dz.items[0].preview.length > 0, "库存项有退款预览", dz.items[0].preview.map(e => e.name + ":" + e.returned));
  ok(typeof dz.reclaimPercent === "number", "含回收率百分比", dz.reclaimPercent);
}

console.log("\n=== " + pass + " passed / " + fail + " failed ===");
process.exit(fail ? 1 : 0);
