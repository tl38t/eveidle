// 集成校验：直接用真实的 selectors.js（vm 沙箱加载全部游戏脚本）调用 getHangarDisplayState，
// 确认含 unknown ship 时不再崩溃，且过滤生效。
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
const sandbox = { console, window: null, document: documentMock, localStorage: { getItem: () => null, setItem: noop }, alert: noop, setTimeout: noop, setInterval: noop, requestAnimationFrame: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), RuntimeGuard: { report: noop, guard: noop }, GameEvents: { emit: noop, on: () => () => {} }, Blob: class {}, FileReader: class {}, URL: { createObjectURL: () => "blob:", revokeObjectURL: noop }, URLSearchParams: globalThis.URLSearchParams };
sandbox.window = sandbox; sandbox.window.addEventListener = noop; sandbox.addEventListener = noop; sandbox.location = { href: "", search: "", hash: "" }; sandbox.navigator = { userAgent: "node" };
vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: "c.js" });
const R = e => vm.runInContext(e, sandbox);

let pass = 0, fail = 0;
function ok(cond, label, extra) { if (cond) { pass++; console.log("✓ " + label); } else { fail++; console.log("✗ " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : "")); } }

function makeState() {
  return {
    skills: { refining: { lvl: 60, xp: 0 }, shipEngineering: { lvl: 60, xp: 0 } },
    inventory: { ships: [
      { instanceId: "ship_player", shipId: "rookie_corvette", enhancementLevel: 0, fitted: { high: [], mid: [], low: [], rig: [] } },
      { instanceId: "ship_legacy", shipId: "removed_legacy_ship", enhancementLevel: 0, fitted: { high: [], mid: [], low: [], rig: [] } },
      { instanceId: "ship_null", shipId: undefined, enhancementLevel: 0, fitted: { high: [], mid: [], low: [], rig: [] } }
    ] },
    equipment: { instances: [], inventory: [] },
    shipAssignments: {},
    resources: { fuel: 5000 },
    station: { bodyLevel: 3, buildings: { legion_hall: 1 } },
    legion: { npcs: [], hallLevel: 1, active: true, dlc: { unlocked: true } },
    research: { completedLevels: { legion_dual_squad: 1 } },
    combat: { active: false, squad: { enabled: false, members: [], deployables: [], deployableStorage: [], targetId: null, battleId: null, lastRound: null, pendingNpcIds: [] } },
    currentAction: { active: false, skill: "", shipAsmTarget: "laser_directional_salvage_unit", shipAsmLine: "special", hangarTab: "shield_laser" },
    ownedBlueprints: []
  };
}

// 真实调用 getHangarDisplayState（含 unknown ship）
{
  const st = makeState();
  let threw = null, display = null;
  try { display = R(`(function(){ return getHangarDisplayState(arguments[0], Date.now()); })`)(st); }
  catch (e) { threw = e; }
  ok(!threw, "含未知 ship 时 getHangarDisplayState 不抛错", threw && threw.message);
  ok(display && display.ships.length === 1, "仅保留 1 个有效舰船（过滤掉 2 个 unknown）", display && display.ships.map(s => s.shipId));
  ok(display && display.count === 1, "count === 1", display && display.count);
  ok(display && display.ships[0].assignedActions && Array.isArray(display.ships[0].assignedActions), "有效舰船含 assignedActions 数组", display && display.ships[0] && display.ships[0].assignedActions);
}

// 反向：全正常舰船，结果不变
{
  const st = makeState();
  st.inventory.ships = st.inventory.ships.filter(s => s.shipId === "rookie_corvette");
  let threw = null, display = null;
  try { display = R(`(function(){ return getHangarDisplayState(arguments[0], Date.now()); })`)(st); }
  catch (e) { threw = e; }
  ok(!threw, "全正常舰船不抛错", threw && threw.message);
  ok(display && display.ships.length === 1, "全正常：1 艘", display && display.ships.length);
}

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);