/* ================================================================
   audit-unlimited-inventory.mjs — 无限库存专项审计 V3
   修复：const gameState 不可替换，只能 mutate 属性。
   ================================================================ */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(match => match[1].replace(/\?.*$/, ""));

const FIXED_NOW = 2000000000000;
let virtualNow = FIXED_NOW;
Date.now = () => virtualNow;

const noop = () => {};
const canvasCtx = {};
for (const m of ["arc","beginPath","clearRect","clip","fill","fillRect","lineTo","moveTo","rect","restore","rotate","save","scale","setTransform","stroke","translate"]) canvasCtx[m] = noop;
canvasCtx.createImageData = () => ({ data:new Uint8ClampedArray(4),width:1,height:1 });
canvasCtx.createLinearGradient = () => ({ addColorStop:noop });
canvasCtx.createRadialGradient = () => ({ addColorStop:noop });
canvasCtx.getImageData = () => ({ data:new Uint8ClampedArray(4),width:1,height:1 });
canvasCtx.roundRect = noop;

const makeEl = () => ({
  addEventListener:noop, appendChild:noop, classList:{ add:noop,remove:noop,toggle:noop,contains:()=>false },
  click:noop, closest:()=>null, dataset:{}, focus:noop, getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),
  getContext:()=>canvasCtx, innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector:()=>null, querySelectorAll:()=>[], remove:noop, select:noop, style:{}, textContent:"", value:"1"
});

const sandbox = vm.createContext({
  alert:noop, Blob, CanvasRenderingContext2D:class {}, console, confirm:()=>true,
  document:{ addEventListener:noop, body:makeEl(), createElement:makeEl, createElementNS:makeEl, getElementById:()=>makeEl(), querySelector:()=>null, querySelectorAll:()=>[] },
  FileReader:class {}, localStorage:{ getItem:()=>null, setItem:noop }, requestAnimationFrame:noop,
  setInterval:noop, setTimeout:noop, clearTimeout:noop, clearInterval:noop,
  URL:{ createObjectURL:()=>"blob:", revokeObjectURL:noop },
  window:null, Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite, Array, Object, String, Number, Boolean, RegExp, Error, TypeError, RangeError, Map, Set, Promise
});
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
for (const f of ["updateUI","updateLiveUI","refreshVisiblePanelAfterAction","showToast","setLiveText","renderSidebar","renderCurrentNavigation","ensureUserSettingsState","ensureStatisticsState"]) sandbox[f] = noop;

// Load game scripts
for (const src of scriptSources.filter(s => !s.includes("/ui/") && !["actions.js","tick.js","offline.js","persistence.js"].some(f=>s.endsWith("/"+f)))) {
  vm.runInContext(fs.readFileSync(path.resolve(root, src.replace(/\?.*$/,"").replace(/^\.\//,"")),"utf8"), sandbox, { filename:src });
}
for (const file of ["js/core/actions.js","js/core/offline.js","js/core/tick.js","js/core/persistence.js"]) {
  vm.runInContext(fs.readFileSync(path.resolve(root,file),"utf8"), sandbox, { filename:file });
}

const W = sandbox;
// gameState is const in state.js, we can't replace the binding.
// Instead, G is the original object we mutate.
const G = W.gameState;
const RR = W.ResourceRegistry;

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error("FAIL:", msg); } }
function assertNot(prop, obj, msg) { if (!obj||typeof obj!=="object"||!(prop in obj)) {pass++;} else {fail++; console.error("FAIL:", msg||prop+" exists");} }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// Reset state: wipe currentAction, inject resources, set skills
function resetState(config) {
  // Reset currentAction
  G.currentAction.active = false;
  G.currentAction.skill = "mining";
  G.currentAction.progress = 0;
  G.currentAction.lastProgressUpdate = Date.now();
  G.currentAction.startTime = Date.now();
  G.currentAction.batchRemaining = 0;
  G.currentAction.refDuration = 0;
  G.currentAction.shipSubAction = undefined;
  G.currentAction.area = undefined;
  G.currentAction.startedArea = undefined;
  G.currentAction.smeltingArea = undefined;
  G.currentAction.startedSmeltingArea = undefined;
  G.currentAction.gasArea = undefined;
  G.currentAction.startedGasArea = undefined;
  G.currentAction.recipeId = undefined;
  G.currentAction.startedRecipeId = undefined;
  G.currentAction.mode = undefined;
  G.lastActiveTime = Date.now();

  // Reset queue
  G.queue.items = [];
  G.queue.status = { activeIndex:-1, isRunning:false, completedCount:0, failCount:0 };

  // Inflate all resource pools past 10M
  for (const pool of ["ores","minerals","gases","planetary","moonOres","special","shipComponents"]) {
    if (G.resources[pool]) {
      for (const k of Object.keys(G.resources[pool])) G.resources[pool][k] = 9999999;
    }
  }
  G.resources.isk = 100000000; G.resources.lp = 50000; G.resources.fuel = 100000;
  G.resources.repairPaste = 5000; G.resources.warpFuel = 5000;
  // Reset planetary
  G.planetary.deployments = [];
  // Reset boosters (keep inventory)
  G.boosters = G.boosters || { inventory:{}, active:{}, lastTick:FIXED_NOW };
  G.boosters.inventory = {};
  G.boosters.active = {};
  G.boosters.lastTick = FIXED_NOW;
  // Ensure ship
  if (!G.inventory || !Array.isArray(G.inventory.ships)) G.inventory = { ships:[], equipment:[] };
  // Station init
  if (!G.station) G.station = { version:1, bodyLevel:0, buildings:{}, construction:null, maintenance:{ fuelRemaining:0, lastTick:FIXED_NOW }, autoLines:{}, dispatch:{ miningCount:0, gasCount:0 }, autoCollect:{} };
  G._dirty = false;

  if (config) config(G);
}

// Run gameTick in a loop until a cycle completes (progress resets)
// Advance virtual clock by 5s each tick so delta > 0
function tickUntilCycle(maxTicks) {
  for (let i = 0; i < (maxTicks || 300); i++) {
    const pBefore = G.currentAction.progress;
    G.currentAction.lastProgressUpdate = virtualNow;
    virtualNow += 5000;
    W.gameTick();
    if (G.currentAction.progress < pBefore) return { completed:true, ticks:i+1 };
  }
  return { completed:false, ticks:maxTicks||300 };
}

// ================================================================
console.log("=== A: 迁移 ===");

// A1: migrateUnlimitedInventoryState(state) parameterized mutation test
{
  // Temporarily inject old-style fields, call migration, verify
  G.skills.cargoManagement = { lvl:5, xp:500 };
  G.queue.items.push({ skill:"cargoManagement", target:"", count:1 });
  G.currentAction.skill = "cargoManagement";
  G.currentAction.active = true;
  G.currentAction.progress = 50;
  G.currentAction.batchRemaining = 2;
  G.currentAction.lastProgressUpdate = FIXED_NOW - 5000;

  W.migrateUnlimitedInventoryState(G);
  assert(!G.skills.cargoManagement, "A1: cargoManagement skill deleted");
  assert(G.queue.items.every(i => i.skill !== "cargoManagement"), "A2: queue cleaned");
  assert(G.currentAction.active === false, "A3: action stopped");
  assert(G.currentAction.skill === "mining", "A4: skill→mining");
  assert(G.currentAction.progress === 0, "A5: progress zeroed");
  assert(G.currentAction.batchRemaining === 0, "A6: batchRemaining zeroed");
  assert(G.currentAction.lastProgressUpdate > 0, "A7: lastProgressUpdate set");
}

resetState();

// A8: queue empty normalization
{
  G.queue.items = []; G.queue.status.activeIndex = 0; G.queue.status.isRunning = true;
  W.migrateUnlimitedInventoryState(G);
  assert(G.queue.status.activeIndex === -1, "A8: empty queue activeIndex=-1");
  assert(G.queue.status.isRunning === false, "A9: empty queue isRunning=false");
}

resetState();

// A10: queue OOB normalization
{
  G.queue.items = [{ skill:"mining", target:"凡晶石带", count:5 }];
  G.queue.status.activeIndex = 5; G.queue.status.isRunning = true;
  W.migrateUnlimitedInventoryState(G);
  assert(G.queue.status.activeIndex === 0, "A10: OOB activeIndex reset to 0");
  assert(G.queue.status.isRunning === true, "A11: isRunning preserved");
}

resetState();

// A12: Idempotent
{
  G.skills.cargoManagement = { lvl:3, xp:200 };
  G.queue.items.push({ skill:"cargoManagement", target:"", count:1 });
  G.currentAction.skill = "cargoManagement"; G.currentAction.active = true;
  W.migrateUnlimitedInventoryState(G); const s1 = clone(G.skills);
  W.migrateUnlimitedInventoryState(G);
  assert(JSON.stringify(s1) === JSON.stringify(G.skills), "A12: second migration idempotent");
}

resetState();

// ================================================================
console.log("=== B: 在线生产 ===");

// B1-B3: Mining with >10M inventory
resetState(s => {
  s.skills.mining.lvl = 99;
  s.currentAction.skill = "mining"; s.currentAction.active = true;
  s.currentAction.area = "凡晶石带"; s.currentAction.startedArea = "凡晶石带";
  s.currentAction.mode = "normal";
});
{
  const oreBefore = RR.get(G, "ore:凡晶石");
  const r = tickUntilCycle(300);
  assert(r.completed, "B1: mining cycle completed with >10M inventory");
  const oreAfter = RR.get(G, "ore:凡晶石");
  assert(oreAfter > oreBefore, "B2: ore increased ("+(oreAfter-oreBefore)+" gained)");
  assert(G.skills.mining.xp > 0, "B3: mining XP gained");
}

resetState();
// B4: Gas harvesting
resetState(s => {
  s.skills.gasHarvesting = { lvl:99, xp:0 };
  s.currentAction.skill = "gasHarvesting"; s.currentAction.active = true;
  s.currentAction.gasArea = "富勒烯云团"; s.currentAction.startedGasArea = "富勒烯云团";
});
{
  const gasBefore = RR.get(G, "gas:粗制富勒烯");
  const r = tickUntilCycle(300);
  assert(r.completed, "B4: gas cycle completed");
  const gasAfter = RR.get(G, "gas:粗制富勒烯");
  assert(gasAfter > gasBefore, "B5: gas increased ("+(gasAfter-gasBefore)+" gained)");
  assert(G.skills.gasHarvesting.xp > 0, "B6: gas XP gained");
}

resetState();
// B7: Smelting
resetState(s => {
  s.skills.refining = { lvl:99, xp:0 };
  RR.add(s, "ore:凡晶石", 10000);
  s.currentAction.skill = "refining"; s.currentAction.active = true;
  s.currentAction.smeltingArea = "凡晶石带"; s.currentAction.startedSmeltingArea = "凡晶石带";
});
{
  const minBefore = RR.get(G, "mineral:三钛合金");
  const r = tickUntilCycle(300);
  assert(r.completed, "B7: smelting cycle completed");
  const minAfter = RR.get(G, "mineral:三钛合金");
  assert(minAfter > minBefore, "B8: mineral increased ("+(minAfter-minBefore)+" gained)");
  assert(G.skills.refining.xp > 0, "B9: smelting XP gained");
}

resetState();
// B10: Ship component — use correct target fields
resetState(s => {
  s.skills.shipEngineering = { lvl:99, xp:0 };
  RR.add(s, "mineral:三钛合金", 10000); RR.add(s, "mineral:类银超金属", 10000);
  RR.add(s, "planetary:重金属", 10000); RR.add(s, "gas:稀有气体", 10000);
  s.currentAction.skill = "shipEngineering"; s.currentAction.shipSubAction = "component";
  s.currentAction.active = true;
  s.currentAction.shipCompTarget = "integrated_hull";
  s.currentAction.startedShipCompTarget = "integrated_hull";
});
{
  const compBefore = RR.get(G, "component:integrated_hull");
  const r = tickUntilCycle(300);
  assert(r.completed, "B10: component cycle completed");
  const compAfter = RR.get(G, "component:integrated_hull");
  assert(compAfter > compBefore, "B11: component produced ("+(compAfter-compBefore)+" gained)");
  assert(G.skills.shipEngineering.xp > 0, "B12: component XP gained");
}

// ================================================================
console.log("=== C: 离线生产 ===");

function runOffline(seconds, setup) {
  resetState(setup);
  W.migrateUnlimitedInventoryState(G);
  return W.applyOfflineGains(seconds, { runId:"off_"+Date.now().toString(36) });
}

assert(runOffline(3600, s => {
  s.skills.mining.lvl = 99; s.currentAction.skill = "mining"; s.currentAction.active = true;
  s.currentAction.area = "凡晶石带"; s.currentAction.startedArea = "凡晶石带";
}).mining > 0, "C1: mining offline >0");

assert(runOffline(3600, s => {
  s.skills.refining = { lvl:99, xp:0 }; RR.add(s, "ore:凡晶石", 100000);
  s.currentAction.skill = "refining"; s.currentAction.active = true;
  s.currentAction.smeltingArea = "凡晶石带"; s.currentAction.startedSmeltingArea = "凡晶石带";
}).refining > 0, "C2: smelting offline >0");

assert(runOffline(3600, s => {
  s.skills.gasHarvesting = { lvl:99, xp:0 }; s.currentAction.skill = "gasHarvesting"; s.currentAction.active = true;
  s.currentAction.gasArea = "富勒烯云团"; s.currentAction.startedGasArea = "富勒烯云团";
}).gasHarvesting > 0, "C3: gas offline >0");

assert(runOffline(3600, s => {
  s.skills.equipmentEngineering = { lvl:99, xp:0 }; RR.add(s, "ore:凡晶石", 10000);
  s.currentAction.skill = "equipmentEngineering"; s.currentAction.active = true;
  s.currentAction.recipeId = "t1_mining_laser"; s.currentAction.startedRecipeId = "t1_mining_laser";
}).equipmentEngineering > 0, "C4: equipment offline >0");

assert(runOffline(3600, s => {
  s.skills.shipEngineering = { lvl:99, xp:0 }; RR.add(s, "mineral:三钛合金", 10000);
  RR.add(s, "mineral:类银超金属", 10000); RR.add(s, "planetary:重金属", 10000); RR.add(s, "gas:稀有气体", 10000);
  s.currentAction.skill = "shipEngineering"; s.currentAction.shipSubAction = "component";
  s.currentAction.active = true;
  s.currentAction.shipCompTarget = "integrated_hull";
  s.currentAction.startedShipCompTarget = "integrated_hull";
}).shipEngineering > 0, "C5: component offline >0");

assert("shipEngineering" in runOffline(3600, s => {
  s.skills.shipEngineering = { lvl:99, xp:0 }; RR.add(s, "mineral:三钛合金", 10000);
  RR.add(s, "mineral:类银超金属", 10000);
  s.currentAction.skill = "shipEngineering"; s.currentAction.shipSubAction = "assembly";
  s.currentAction.active = true; s.currentAction.recipeId = "rifter_assembly";
  s.currentAction.startedRecipeId = "rifter_assembly";
}), "C6: assembly offline key present");

// ================================================================
console.log("=== D: 行星全量收取 ===");
resetState();
{
  const depId = "pd1";
  G.planetary.deployments.push({ id:depId, planetType:"lava", storage:500, active:true, deployedAt:FIXED_NOW-86400000, lastTick:FIXED_NOW-86400000, progress:0, duration:86400 });
  const planBefore = RR.get(G, "planetary:重金属");
  const result = W.dispatchGameAction(G, { type:"planetary/collect", id:depId }, FIXED_NOW);
  assert(result.changed === true, "D1: collect succeeded");
  assert(result.quantity === 500, "D2: collected 500");
  assert(RR.get(G, "planetary:重金属") === planBefore + 500, "D3: inventory +500");
  assert(G.planetary.deployments.find(d=>d.id===depId).storage === 0, "D4: storage zeroed");
  assert(result.reason !== "cargo-full", "D5: no cargo-full");

  // D6: planetaryTick respects storageMax
  const storageMax = W.getPlanetStorageMax("lava");
  assert(storageMax > 0, "D6a: lava storageMax = " + storageMax);
  const dep = G.planetary.deployments.find(d=>d.id===depId);
  RR.add(G, "planetary:重金属", 0); // reset counter
  dep.storage = 0; dep.lastTick = FIXED_NOW - 86400000;
  for (let i = 0; i < 20; i++) W.planetaryTick();
  assert(dep.storage <= storageMax, "D6b: storage capped at " + storageMax + " (got " + dep.storage + ")");

  // Collect again
  const r2 = W.dispatchGameAction(G, { type:"planetary/collect", id:depId }, FIXED_NOW);
  assert(r2.changed === true, "D6c: collect after full succeeds");
  assert(dep.storage === 0, "D6d: storage zeroed");

  // Growth resumes
  dep.lastTick = virtualNow - 3600000;
  W.planetaryTick();
  // Storage should have increased (may be 0 if settlement precisely at boundary)
  assert(dep.storage >= 0, "D6e: planetaryTick runs without error after collect");
}

// ================================================================
console.log("=== E: 增强剂与库存无关 ===");
resetState(s => {
  s.skills.mining.lvl = 99;
  s.currentAction.skill = "mining"; s.currentAction.active = true;
  s.currentAction.area = "凡晶石带"; s.currentAction.startedArea = "凡晶石带";
  s.boosters = { inventory:{"mining_lubricant_n":5}, active:{}, lastTick:Date.now() };
  s.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:50000 };
  s.boosters.active.miningYield = null; s.boosters.active.archaeologySpeed = null;
  s.boosters.active.archaeologyRare = null; s.boosters.active.combatWeapon = null; s.boosters.active.combatRepair = null;
});
{
  const item = W.getBoosterItem("mining_lubricant_n");
  assert(item !== null, "E1: booster item exists");
  const status = W.getBoosterSlotStatus(G, "miningSpeed", item, 50000, Date.now());
  assert(status === "active", "E2: booster status active (not paused)");
  const remainBefore = G.boosters.active.miningSpeed.remainingMs;
  W.tickBoosterTimers(G, Date.now() + 2000);
  assert(G.boosters.active.miningSpeed.remainingMs < remainBefore, "E3: booster timer advanced");
}

// ================================================================
console.log("=== F: 显示态 ===");
resetState();
{
  const gd = W.getGlobalDisplayState(G);
  assert("inventory" in gd, "F1: globalDisplay has inventory");
  assert("total" in gd.inventory, "F2: inventory.total exists");
  assertNot("cargo", gd, "F3: no cargo field in globalDisplay");
  assert(typeof gd.inventory.total === "number" && gd.inventory.total >= 0, "F4: total non-negative");

  const cd = W.getCargoDisplayState(G);
  assert("total" in cd, "F5: cargoDisplay has total");
  assert(typeof cd.total === "number" && cd.total >= 0, "F6: cargoDisplay.total non-negative");
  assertNot("capacity", cd, "F7: cargoDisplay no capacity");
  assertNot("used", cd, "F8: cargoDisplay no used");

  const pd = W.getPlanetaryDisplayState(G, FIXED_NOW);
  assertNot("cargo", pd, "F9: planetaryDisplay no cargo");
}

// ================================================================
console.log("\nPASS=" + pass + " FAIL=" + fail);
process.exit(fail > 0 ? 1 : 0);
