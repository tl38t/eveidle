/* 考古(启程级)判定统一 + 死亡空间连刷修复 —— 针对性回归 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1].replace(/\?.*$/, ""));
const noop = () => {};
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
function MockCanvasContext() {}
for (const name of ["arc","arcTo","beginPath","clearRect","fill","fillRect","fillText","lineTo","moveTo","rect","restore","save","scale","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
function makeElement() {
  return { addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, select: noop, setAttribute: noop, style: {}, textContent: "", value: "1" };
}
const sandbox = {
  alert: noop, Blob, confirm: () => true, CanvasRenderingContext2D: MockCanvasContext,
  document: { addEventListener: noop, body: makeElement(), createElement: () => makeElement(), createElementNS: () => ({ ...makeElement(), setAttribute: noop }), getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => [] },
  FileReader: class {}, localStorage: { getItem: () => null, setItem: noop }, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null, console
};
sandbox.window = sandbox; sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
const scripts = scriptSources.map(s => fs.readFileSync(path.resolve(root, s), "utf8"));
for (let i = 0; i < scripts.length; i++) vm.runInContext(scripts[i], sandbox, { filename: scriptSources[i] });

// 在沙箱内部执行需要词法绑定的调用（const 声明不挂 sandbox 对象）
function run(expr) { return vm.runInContext(expr, sandbox); }

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.error("  FAIL", m); } }
function eq(a, b, m) { if (a === b) { pass++; } else { fail++; console.error(`  FAIL ${m}: expected ${b}, got ${a}`); } }

// ============ 考古：启程级 ============
const gs = sandbox.gameState;
gs.skills.archaeology = { lvl: 1, xp: 0 };
sandbox.ResourceRegistry.add(gs, "consumable:fuel", 1000);
sandbox.ResourceRegistry.add(gs, "probe:core_probe_i", 50);
const rookie = sandbox.createShipInstance("rookie_corvette");
if (!gs.inventory) gs.inventory = { ships: [], equipment: [], rigs: [] };
if (!gs.inventory.ships) gs.inventory.ships = [];
gs.inventory.ships.push(rookie);
gs.shipAssignments = gs.shipAssignments || {};
gs.shipAssignments.archaeology = rookie.instanceId;
gs.archaeology.activeSiteId = "site_i_a";
const disp = sandbox.getArchaeologyDisplayState(gs, Date.now());
ok(disp.canAssign === true, "启程级 canAssign 应为 true（能力判据）");
const chk = sandbox.canStartArchaeology(gs, Date.now());
ok(chk.ok === true, "启程级 canStartArchaeology.ok 应为 true，实际 reason=" + (chk.reason || ""));
sandbox.migrateArchaeologyState();
ok(gs.shipAssignments.archaeology === rookie.instanceId, "迁移后启程级考古分配应保留（不再被删）");

// ============ 死亡空间连刷 ============
gs.skills.laserOps = gs.skills.laserOps || { lvl: 1, xp: 0 };
gs.skills.missileOps = gs.skills.missileOps || { lvl: 1, xp: 0 };
gs.skills.cannonOps = gs.skills.cannonOps || { lvl: 1, xp: 0 };
gs.skills.shipCommand = gs.skills.shipCommand || { lvl: 1, xp: 0 };
const combatShip = sandbox.createShipInstance("rifter");
gs.inventory.ships.push(combatShip);
gs.shipAssignments.combat = combatShip.instanceId;
gs.combat.activeShip = combatShip.instanceId;
combatShip.fitted.high = ["t1_small_laser"];
combatShip.fitted.mid = []; combatShip.fitted.low = []; combatShip.fitted.rig = [];
sandbox.ResourceRegistry.add(gs, "special:天使秘密补给站通行密钥", 5);
gs.combat.viewMode = "deathspace";
gs.combat.viewDeathspaceId = "angel_ded_2_10";
gs.combat.deathspaceId = "angel_ded_2_10";
const site = run("getDeathspaceById('angel_ded_2_10')");
ok(!!site, "死亡空间 site 可查");
const chainRes = run("CombatStateActions.startDeathspaceChain(gameState, 3, Date.now())");
ok(chainRes && chainRes.changed === true, "startDeathspaceChain 应进入，reason=" + (chainRes && chainRes.reason || ""));
ok(gs.combat.active === true && gs.currentAction.active === true, "进入后 combat/currentAction active");
eq(gs.combat.deathspaceChainRemaining, 2, "连刷剩余应为 2（3-1）");
// 模拟首轮全通：wave 推到 maxWave 后调用 resolveDeathspaceWaveVictory
run("gameState.combat.wave = getDeathspaceById('angel_ded_2_10').maxWave;");
run("resolveDeathspaceWaveVictory(getDeathspaceById('angel_ded_2_10'), {id:getDeathspaceById('angel_ded_2_10').sourceZoneId, faction:getDeathspaceById('angel_ded_2_10').faction}, Math.random, function(){}, gameState);");
ok(gs.currentAction.active === false, "全通后 currentAction.active 应被置 false（连刷间隙）");
ok(gs.combat.deathspaceChainPending === true, "全通后应置 deathspaceChainPending=true");
eq(gs.combat.deathspaceChainRemaining, 2, "间隙期 remaining 仍为 2（未减）");
// 调用 combatTick（续跑钩子）：try 容忍后续战斗推进可能缺 UI 效果
try { run("combatTick()"); } catch (e) { /* 续跑已完成，忽略后续 UI 错误 */ }
ok(gs.currentAction.active === true, "combatTick 续跑后应重新 active=true（连刷不再卡死）");
eq(gs.combat.deathspaceChainRemaining, 1, "续跑后 remaining 应减为 1");

console.log(`\n考古(启程级)+死亡空间连刷回归：pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
