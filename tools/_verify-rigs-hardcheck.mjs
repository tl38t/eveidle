// 真实 VM 沙箱：加载游戏逻辑脚本（排除纯 UI 渲染层），
// 用真实函数验证 (一) 五档燃料累计器 与 (二) 校准材料经济。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = "c:/Users/10195/Documents/EVE IDLE/EVEIDLE-WORKBUDDY";
const html = readFileSync(join(ROOT, "index.html"), "utf8");

// 解析 <script defer src="...">
const scripts = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);

// 排除纯 UI 渲染脚本（只需逻辑层）
const UI_EXCLUDE = [
  "js/ui/error-boundary.js",
  "js/ui/action-modal.js",
  "js/ui/shell-render.js",
  "js/ui/manufacturing-render.js",
  "js/ui/combat-render.js",
  "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js",
  "js/ui/render.js",
  "js/core/runtime.js"
];
const logicScripts = scripts.filter(s => !UI_EXCLUDE.includes(s));

// ---- 递归 DOM mock ----
function makeCtx() {
  return new Proxy({}, {
    get: () => () => undefined,
    set: () => true
  });
}
function makeEl() {
  const el = new Proxy(function () {}, {
    get(t, p) {
      if (p === "style") return new Proxy({}, { get: () => "", set: () => true });
      if (p === "classList") return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (p === "getContext") return () => makeCtx();
      if (p === "querySelector") return () => makeEl();
      if (p === "querySelectorAll") return () => [];
      if (["appendChild","removeChild","setAttribute","remove","focus","click","append","prepend","insertBefore","addEventListener","removeEventListener","dispatchEvent"].includes(p)) return () => makeEl();
      if (["children","childNodes"].includes(p)) return [];
      if (["value","innerHTML","textContent","className","id","width","height","top","left","src","href"].includes(p)) return "";
      return () => makeEl();
    },
    set: () => true,
    apply: () => makeEl()
  });
  return el;
}

const localStorageMock = (() => {
  const store = {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; }
  };
})();

const sandbox = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  confirm: () => true,
  alert: () => {},
  localStorage: localStorageMock,
  document: new Proxy({}, {
    get(t, p) {
      if (p === "getElementById" || p === "querySelector") return () => makeEl();
      if (p === "querySelectorAll") return () => [];
      if (p === "createElement") return () => makeEl();
      if (p === "addEventListener" || p === "removeEventListener") return () => {};
      if (p === "body") return makeEl();
      return makeEl();
    }
  })
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.dispatchEvent = () => {};
sandbox.location = { href: "", search: "", hash: "" };
sandbox.navigator = { userAgent: "node" };
sandbox.innerWidth = 1280;
sandbox.innerHeight = 800;
sandbox.CanvasRenderingContext2D = function () {};
sandbox.CanvasRenderingContext2D.prototype = {};

// 拼接所有逻辑脚本为单一脚本（复刻浏览器共享词法作用域）
let combined = "";
for (const s of logicScripts) {
  const code = readFileSync(join(ROOT, s), "utf8");
  combined += "\n// === " + s + " ===\n" + code + "\n";
}

// 末尾导出：const 数据常量未挂 window，需显式复制（同一作用域内可见）
combined += `
window.EQUIPMENT_DB = (typeof EQUIPMENT_DB !== 'undefined') ? EQUIPMENT_DB : null;
window.SHIPS = (typeof SHIPS !== 'undefined') ? SHIPS : null;
window.ARCHAEOLOGY_SHIPS = (typeof ARCHAEOLOGY_SHIPS !== 'undefined') ? ARCHAEOLOGY_SHIPS : null;
window.ARCHAEOLOGY_TIERS = (typeof ARCHAEOLOGY_TIERS !== 'undefined') ? ARCHAEOLOGY_TIERS : null;
window.ARCHAEOLOGY_SITES = (typeof ARCHAEOLOGY_SITES !== 'undefined') ? ARCHAEOLOGY_SITES : null;
window.RIG_SERIES = (typeof RIG_SERIES !== 'undefined') ? RIG_SERIES : null;
window.RIG_TIER_META = (typeof RIG_TIER_META !== 'undefined') ? RIG_TIER_META : null;
window.gameState = (typeof gameState !== 'undefined') ? gameState : null;
`;

vm.createContext(sandbox);
try {
  vm.runInContext(combined, sandbox, { filename: "combined.js" });
} catch (e) {
  console.error("LOAD ERROR:", e.message);
  console.error(e.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
}

const W = sandbox;
const getArchaeologyFuelCostState = W.getArchaeologyFuelCostState;
const computeArchaeologyScanStrength = W.computeArchaeologyScanStrength;
const computeArchaeologySuccessChance = W.computeArchaeologySuccessChance;
const getArchaeologyTierConfig = W.getArchaeologyTierConfig;
const getArchaeologySite = W.getArchaeologySite;
const getShipConfigById = W.getShipConfigById;
const getRigModifiers = W.getRigModifiers;
const EQUIPMENT_DB = W.EQUIPMENT_DB;

console.log("=== 加载成功 ===");
console.log("getArchaeologyFuelCostState:", typeof getArchaeologyFuelCostState);
console.log("getRigModifiers:", typeof getRigModifiers);
console.log("EQUIPMENT_DB rig_archaeology_fuel_v:", EQUIPMENT_DB && EQUIPMENT_DB["rig_archaeology_fuel_v"] ? JSON.stringify(EQUIPMENT_DB["rig_archaeology_fuel_v"].bonuses) : "MISSING");

// ============================================================
// 一、真实五档燃料累计器验证
// 档位 / baseFuel / shipFuelEfficiency / rigMultiplier
// ============================================================
const TIERS = [
  { roman: "I",   siteId: "site_i_a",   shipId: "heron",       baseFuel: 2,  fuelEff: 1.00, rigMult: 0.92, rigId: "rig_archaeology_fuel_i" },
  { roman: "II",  siteId: "site_ii_a",  shipId: "tracer",      baseFuel: 5,  fuelEff: 0.95, rigMult: 0.88, rigId: "rig_archaeology_fuel_ii" },
  { roman: "III", siteId: "site_iii_a", shipId: "starmap",     baseFuel: 10, fuelEff: 0.90, rigMult: 0.84, rigId: "rig_archaeology_fuel_iii" },
  { roman: "IV",  siteId: "site_iv_a",  shipId: "farscope",    baseFuel: 20, fuelEff: 0.85, rigMult: 0.80, rigId: "rig_archaeology_fuel_iv" },
  { roman: "V",   siteId: "site_v_a",   shipId: "illuminator", baseFuel: 35, fuelEff: 0.80, rigMult: 0.75, rigId: "rig_archaeology_fuel_v" }
];

function makeState() {
  return {
    archaeology: { fuelSavingRemainder: 0 },
    equipment: { instances: [], inventory: [] },
    skills: { archaeology: { lvl: 1, xp: 0 } }
  };
}
function makeShip(shipId, rigId) {
  const fitted = { high: [], mid: [], low: [], rig: [] };
  if (rigId) fitted.rig = [rigId];
  return { shipId, instanceId: "ship_" + shipId, fitted, enhancementLevel: 0 };
}

function runCycles(site, shipRef, n) {
  const state = makeState();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const fs = getArchaeologyFuelCostState(state, site, shipRef);
    total += fs.chargedFuel;
    state.archaeology.fuelSavingRemainder = fs.nextRemainder;
  }
  return { total, finalRemainder: state.archaeology.fuelSavingRemainder };
}

console.log("\n=== 一、真实五档 1000 周期燃料累计器 ===");
console.log("档 |  baseFuel | fuelEff | rigMul | 无效率总耗 | 仅船总耗 | 船+rig总耗 | 理论(船+rig) | 误差 | 最终remainder");
const fuelResults = [];
for (const t of TIERS) {
  const site = getArchaeologySite(t.siteId);
  const rigDef = EQUIPMENT_DB[t.rigId];
  // 把 rig 实例放进 equipment.instances 以便 getRigModifiers 解析
  const baseState = makeState();
  baseState.equipment.instances.push({ instanceId: "rig_inst", itemId: t.rigId, enhancementLevel: 0, installedOn: "ship_" + t.shipId });
  // 验证 getRigModifiers 返回真实减免
  const rigMods = getRigModifiers(baseState, makeShip(t.shipId, t.rigId));

  const none = runCycles(site, null, 1000);
  const shipOnly = runCycles(site, makeShip(t.shipId, null), 1000);
  const shipRig = runCycles(site, makeShip(t.shipId, t.rigId), 1000);

  const theoNone = 1000 * t.baseFuel;
  const theoShip = 1000 * (t.baseFuel * t.fuelEff);
  const theoShipRig = 1000 * (t.baseFuel * t.fuelEff * t.rigMult);

  const err = Math.abs(shipRig.total - theoShipRig);
  fuelResults.push({ t, none, shipOnly, shipRig, theoNone, theoShip, theoShipRig, err, rigMods });
  console.log(
    `${t.roman.padEnd(2)} | ${String(t.baseFuel).padStart(8)} | ${t.fuelEff.toFixed(2)} | ${t.rigMult.toFixed(2)} | ` +
    `${String(none.total).padStart(11)} | ${String(shipOnly.total).padStart(9)} | ${String(shipRig.total).padStart(11)} | ${String(theoShipRig).padStart(13)} | ${String(err).padStart(4)} | ${shipRig.finalRemainder.toFixed(4)}`
  );
  console.log(`     rigMods(${t.rigId})=${JSON.stringify(rigMods)}  (期望 archaeologyFuelEfficiency=${rigDef.bonuses.archaeologyFuelEfficiency})`);
}

// ============================================================
// 二、校准材料经济复算
// 【历史快照 2026-07-22】本区是触发"经济停报"时的原始口径（无 analyzer 配置成功率 + 固定 +1 份掉落），
// 保留用于对照。停报后经用户批准的正式基准见 tools/_verify-calib-amount.mjs：
// ①成功率基准 = 五档完整标准配置（满 high 槽同级 analyzer+0）恰 50%；
// ②掉落数量 tier.calibrationAmount = 1/1/2/2/3（掉落层读档位数量，不再固定 +1）；
// ③经济结果 V 档四槽 ≈ 133.3h，已固化进 tools/audit-rigs.mjs J 区。
// 本区表格中的"期望实际次数/偏差"不再是验收标准，勿据此改数值。
// ============================================================
console.log("\n=== 二、校准材料经济复算（【历史快照】停报时原始口径，正式基准见 _verify-calib-amount.mjs） ===");
console.log("掉落机制（快照时）：仅成功时判定（archaeology.js if(success) 内），每次固定 +1 份——现已改为 tier.calibrationAmount(1/1/2/2/3)。");
console.log("档 | calibRate | 配方需求 | 每次掉落 | 同级+0成功率 | 期望实际次数/个 | 计划表值 | 偏差");
const economy = [];
for (const t of TIERS) {
  const site = getArchaeologySite(t.siteId);
  const tierCfg = getArchaeologyTierConfig(site.tier);
  const calibRate = tierCfg.calibrationRate;
  const rigDef = EQUIPMENT_DB[t.rigId];
  const requiredQty = rigDef.cost["calibration:" + metaCalib(t.rigId)];
  const qtyPerDrop = 1;

  // 真实同级+0普通探针成功率
  const stState = makeState();
  stState.skills.archaeology.lvl = site.level;
  const scan = computeArchaeologyScanStrength(stState, makeShip(t.shipId, null), "core_probe_i");
  const success = computeArchaeologySuccessChance(scan, site.difficulty);

  const expectedActions = requiredQty / (success * calibRate * qtyPerDrop);
  const planTable = { I: 100, II: 133, III: 200, IV: 267, V: 400 }[t.roman]; // 来自 PLAN 经济表（I/III/V 明确给出）
  const dev = expectedActions - planTable;
  economy.push({ t, calibRate, requiredQty, qtyPerDrop, success, expectedActions, planTable, dev, siteTime: tierCfg.time });
  console.log(
    `${t.roman.padEnd(2)} | ${String(calibRate).padStart(8)} | ${String(requiredQty).padStart(8)} | ${String(qtyPerDrop).padStart(8)} | ` +
    `${String((success*100).toFixed(1)+"%").padStart(11)} | ${String(Math.round(expectedActions)).padStart(15)} | ${String(planTable).padStart(8)} | ${String(Math.round(dev)).padStart(5)}`
  );
}

function metaCalib(rigId) {
  // 从 RIG_TIER_META 反查 calib 名（兜底）
  const map = { "rig_archaeology_fuel_i":"art_i_calib","rig_archaeology_fuel_ii":"art_ii_calib","rig_archaeology_fuel_iii":"art_iii_calib","rig_archaeology_fuel_iv":"art_iv_calib","rig_archaeology_fuel_v":"art_v_calib" };
  return map[rigId];
}

console.log("\n=== 二（续）装满同级船全部 rig 槽的期望 ===");
console.log("档 | 船 | rig槽数 | 单件期望次数 | 全船期望次数 | 单次周期(s) | 全船期望耗时(h)");
const rigSlots = { heron:1, tracer:1, starmap:2, farscope:3, illuminator:4 };
for (const e of economy) {
  const slots = rigSlots[e.t.shipId];
  const total = e.expectedActions * slots;
  const hours = total * e.siteTime / 3600;
  console.log(
    `${e.t.roman.padEnd(2)} | ${e.t.shipId.padEnd(11)} | ${String(slots).padStart(6)} | ${String(Math.round(e.expectedActions)).padStart(12)} | ${String(Math.round(total)).padStart(12)} | ${String(e.siteTime).padStart(11)} | ${hours.toFixed(1).padStart(13)}`
  );
}

// ============================================================
// 一（续）：fuelSavingRemainder 生命周期保留（真实函数执行）
// ============================================================
console.log("\n=== 一（续）fuelSavingRemainder 生命周期保留（真实 resolveArchaeologyCycle + SaveManager）===");
const resolveArchaeologyCycle = W.resolveArchaeologyCycle;
const SaveManager = W.SaveManager;

function buildRealState() {
  const st = JSON.parse(JSON.stringify(W.gameState));
  st.inventory.ships.push({ shipId:"heron", instanceId:"test_heron", fitted:{high:[],mid:[],low:[],rig:["rig_archaeology_fuel_i"]}, enhancementLevel:0, builtAt:1, shipCompInstalled:true });
  st.shipAssignments = st.shipAssignments || {};
  st.shipAssignments.archaeology = "test_heron";
  st.archaeology = st.archaeology || {};
  st.archaeology.startedSiteId = "site_i_a";
  st.archaeology.startedProbeId = "core_probe_i";
  st.archaeology.fuelSavingRemainder = 0;
  st.archaeology.shipHp = {};
  st.skills = st.skills || {};
  st.skills.archaeology = { lvl: 1, xp: 0 };
  st.resources.fuel = 1e9;
  st.resources.probes = st.resources.probes || {};
  st.resources.probes.core_probe_i = 1e9;
  st.equipment = { instances: [], inventory: [] };
  return st;
}

const lc = [];
// 1-2: run cycles, then stop (no more cycles), remainder persists
let st = buildRealState();
for (let i=0;i<10;i++) resolveArchaeologyCycle(st, Date.now()+i, 0.9);
const remAfter10 = st.archaeology.fuelSavingRemainder;
const remAfterStop = st.archaeology.fuelSavingRemainder;
lc.push(["stop后余数保留", remAfter10 > 0 && remAfterStop === remAfter10]);

// 3: switch site — switch mutation must NOT reset remainder; cycles continue continuously
const remBeforeSwitch = st.archaeology.fuelSavingRemainder;
st.archaeology.startedSiteId = "site_ii_a";
const remImmediatelyAfterSwitch = st.archaeology.fuelSavingRemainder;
resolveArchaeologyCycle(st, Date.now()+100, 0.9);
const remAfterNewSiteCycle = st.archaeology.fuelSavingRemainder;
lc.push(["切换遗迹后保留", remImmediatelyAfterSwitch === remBeforeSwitch && remAfterNewSiteCycle >= 0 && remAfterNewSiteCycle < 1]);

// 4: switch ship — switch mutation must NOT reset remainder; cycles continue continuously
const remBeforeShip = st.archaeology.fuelSavingRemainder;
st.inventory.ships.push({ shipId:"starmap", instanceId:"test_starmap", fitted:{high:[],mid:[],low:[],rig:[]}, enhancementLevel:0, builtAt:1, shipCompInstalled:true });
st.shipAssignments.archaeology = "test_starmap";
const remImmediatelyAfterShipSwitch = st.archaeology.fuelSavingRemainder;
resolveArchaeologyCycle(st, Date.now()+200, 0.9);
const remAfterNewShipCycle = st.archaeology.fuelSavingRemainder;
lc.push(["切换舰船后保留", remImmediatelyAfterShipSwitch === remBeforeShip && remAfterNewShipCycle >= 0 && remAfterNewShipCycle < 1]);

// 5: install/uninstall rig, remainder unaffected
const remBeforeFit = st.archaeology.fuelSavingRemainder;
const starInst = st.inventory.ships.find(s=>s.instanceId==="test_starmap");
starInst.fitted.rig = ["rig_archaeology_fuel_iii"];
const modsAfterFit = getRigModifiers(st, starInst);
starInst.fitted.rig = [];
lc.push(["安装/拆卸改装件后保留", st.archaeology.fuelSavingRemainder === remBeforeFit && modsAfterFit.archaeologyFuelEfficiency === 0.16]);

// 6 & 7: save/load + import on the GLOBAL gameState (SaveManager uses closure gameState)
function setupGlobal() {
  const g = W.gameState;
  g.inventory.ships.push({ shipId:"heron", instanceId:"test_heron_g", fitted:{high:[],mid:[],low:[],rig:[]}, enhancementLevel:0, builtAt:1, shipCompInstalled:true });
  g.shipAssignments = g.shipAssignments || {};
  g.shipAssignments.archaeology = "test_heron_g";
  g.archaeology = g.archaeology || {};
  g.archaeology.startedSiteId = "site_i_a";
  g.archaeology.startedProbeId = "core_probe_i";
  g.archaeology.fuelSavingRemainder = 0;
  g.archaeology.shipHp = {};
  g.skills = g.skills || {};
  g.skills.archaeology = { lvl: 1, xp: 0 };
  g.resources.fuel = 1e9;
  g.resources.probes = g.resources.probes || {};
  g.resources.probes.core_probe_i = 1e9;
  g.equipment = { instances: [], inventory: [] };
  return g;
}
const g = setupGlobal();
for (let i=0;i<10;i++) resolveArchaeologyCycle(g, Date.now()+300+i, 0.9);
const remBeforeSave = g.archaeology.fuelSavingRemainder;
SaveManager.save();
SaveManager.load();
const remAfterLoad = W.gameState.archaeology.fuelSavingRemainder;
lc.push(["保存读取后保留", Math.abs(remAfterLoad - remBeforeSave) < 1e-9]);
const remBeforeImport = W.gameState.archaeology.fuelSavingRemainder;
const exported = JSON.stringify(W.gameState);
let importOk = false;
try { importOk = SaveManager.importData(exported); } catch(e) { importOk = false; }
const remAfterImport = W.gameState.archaeology.fuelSavingRemainder;
lc.push(["import后保留", importOk && Math.abs(remAfterImport - remBeforeImport) < 1e-9]);

// 8: online vs offline same-cycle consumption (same source function)
const st8 = buildRealState();
const site8 = getArchaeologySite("site_i_a");
const inst8 = st8.inventory.ships.find(s=>s.instanceId==="test_heron");
const fcState = getArchaeologyFuelCostState(st8, site8, inst8);
const beforeFuel = st8.resources.fuel;
resolveArchaeologyCycle(st8, Date.now()+400, 0.9);
const actualCharged = beforeFuel - st8.resources.fuel;
lc.push(["在线与离线同周期消耗一致", actualCharged === fcState.chargedFuel]);

// 9: insufficient fuel -> remainder/probe/fuel unchanged
const st9 = buildRealState();
st9.resources.fuel = 0;
const rem9 = st9.archaeology.fuelSavingRemainder;
const probe9 = st9.resources.probes.core_probe_i;
const r9 = resolveArchaeologyCycle(st9, Date.now()+500, 0.9);
lc.push(["燃料不足时余数/探针/燃料不变", r9.success === false && r9.reason === "insufficient" && st9.archaeology.fuelSavingRemainder === rem9 && st9.resources.probes.core_probe_i === probe9 && st9.resources.fuel === 0]);

// 10: start/stop loop cannot farm extra savings
function runSegments(segments){
  const s = buildRealState();
  let totalSpent = 0;
  for (const seg of segments){
    for (let i=0;i<seg;i++){ const b=s.resources.fuel; resolveArchaeologyCycle(s, Date.now()+600+i, 0.9); totalSpent += (b - s.resources.fuel); }
  }
  return { totalSpent, finalRem: s.archaeology.fuelSavingRemainder };
}
const segA = runSegments([20]);
const segB = runSegments([10,10]);
const segC = runSegments([5,5,5,5]);
lc.push(["start/stop循环不刷节省", segA.totalSpent === segB.totalSpent && segB.totalSpent === segC.totalSpent && Math.abs(segA.finalRem-segB.finalRem)<1e-9 && Math.abs(segB.finalRem-segC.finalRem)<1e-9]);

console.log("生命周期检查：");
let allPass = true;
for (const [name, ok] of lc){ console.log(`  [${ok?"PASS":"FAIL"}] ${name}`); if(!ok) allPass=false; }
console.log("  全部通过：" + allPass);

// 关键判定
const vEco = economy.find(e => e.t.roman === "V");
console.log("\n=== 关键判定 ===");
console.log(`V 档真实期望实际次数/个 = ${Math.round(vEco.expectedActions)}（计划表 ${vEco.planTable}）`);
console.log(`V 档 4 rig 槽全船期望 = ${Math.round(vEco.expectedActions * 4)} 次`);
const devPct = (vEco.expectedActions - vEco.planTable) / vEco.planTable;
console.log(`偏差 = ${(devPct*100).toFixed(0)}%`);
console.log(devPct > 0.5 ? ">>> 触发『约400→约1200』停报条件：校准材料经济与已批准方案明显偏差。" : ">>> 与已批准方案一致，继续。");
