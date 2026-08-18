// 生成一个「卡在 C6 这一步」的测试存档（含启程级 + 装备），用于回归验证：
//   - C6 在线实时进度 0/4 → 1/4（清波）
//   - C6 离线保底（清 4 波即完成）
//   - 舰船强化/拆解、装备强化/拆解 自定义弹窗
// 产出：项目根目录 c6-test-save.json（与游戏 SaveManager 写入格式一致的信封存档）
// 运行：NODE_OPTIONS="" node tools/build-c6-test-save.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));

// ---- 最小 DOM mock（能成功加载全部脚本即可，无需追踪弹窗）----
function MockCanvasContext() {}
const noop = () => {};
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.roundRect = noop;

const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({ addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1" });
const body = { addEventListener: noop, appendChild: noop, classList, querySelector: () => makeElement(), querySelectorAll: () => [], removeChild: noop, setAttribute: noop, innerHTML: "" };
const documentMock = { addEventListener: noop, readyState: "loading", body, createElement: () => makeElement(), createElementNS: () => makeElement(), getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => [] };
const localStorageMock = { _store: {}, getItem(k){ return this._store[k] ?? null; }, setItem(k,v){ this._store[k] = String(v); }, removeItem(k){ delete this._store[k]; } };
const sandbox = { alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true, document: documentMock, FileReader: class {}, localStorage: localStorageMock, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }), requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop, URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null };
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (const src of scriptSources) {
  vm.runInContext(fs.readFileSync(path.resolve(root, src.replace(/^\.\//, "")), "utf8"), sandbox, { filename: src });
}

const G = (expr) => vm.runInContext(expr, sandbox);
const gs = G("gameState");

// 守卫：确认 gameState 已初始化且含关键结构
function assert(cond, msg) { if (!cond) { console.error("断言失败：" + msg); process.exit(1); } }
assert(gs && typeof gs === "object", "gameState 已初始化");
assert(gs.skills, "gameState.skills 存在");
assert(gs.tutorial && gs.tutorial.taskStateById, "gameState.tutorial.taskStateById 存在");
if (!gs.inventory) gs.inventory = { ships: [], equipment: [], rigs: [] };
if (!gs.equipment) gs.equipment = { instances: [], inventory: [] };
if (!gs.shipAssignments) gs.shipAssignments = {};
if (!gs.combat) gs.combat = {};

const now = Date.now();

// 1) 启程级舰船实例
const makeShip = G("typeof createShipInstance === 'function'")
  ? G(`createShipInstance("rookie_corvette", ${now})`)
  : { shipId: "rookie_corvette", instanceId: "ship_" + now + "_c6test", builtAt: now, fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 };
const shipId = makeShip.instanceId;
gs.inventory.ships.push(makeShip);

// 2) 指派到战斗位 + 预选一级普通星带（C6 目标之一）
gs.shipAssignments.combat = shipId;
gs.combat.activeShip = shipId;
gs.combat.zone = "angel_outpost";   // C6 目标星带之一（level-1 highsec）
gs.combat.mode = "belt";

// 3) 装备实例：武器(高槽) + 护盾(中槽) 装到船；装甲维修器(低槽) 留仓库测弹窗
const equipPlan = [
  { itemId: "t1_small_laser", slot: "high" },
  { itemId: "t1_shield_booster", slot: "mid" },
  { itemId: "t1_armor_repairer", slot: "low" }
];
const eqIds = {};
for (const e of equipPlan) {
  const inst = { instanceId: "eq_" + e.itemId + "_" + Math.random().toString(36).slice(2, 7), itemId: e.itemId, enhancementLevel: 0, installedOn: null };
  gs.equipment.instances.push(inst);
  eqIds[e.slot] = inst.instanceId;
}
// 装武器 + 护盾到启程级（与游戏持久化范式一致：fitted[slot][0]=instanceId + installedOn=shipId）
if (!makeShip.fitted) makeShip.fitted = { high: [], mid: [], low: [], rig: [] };
for (const slot of ["high", "mid"]) {
  makeShip.fitted[slot][0] = eqIds[slot];
  const inst = gs.equipment.instances.find((i) => i.instanceId === eqIds[slot]);
  if (inst) inst.installedOn = shipId;
}

// 4) 教程状态：P1-P7 / I1-I7 / A1-A6 / C1-C5 完成，C6 进行中
const completed = ["P1","P2","P3","P4","P5","P6","P7","I1","I2","I3","I4","I5","I6","I7","A1","A2","A3","A4","A5","A6","C1","C2","C3","C4","C5"];
for (const id of completed) { if (gs.tutorial.taskStateById[id]) gs.tutorial.taskStateById[id].status = "completed"; }
if (gs.tutorial.taskStateById.C6) gs.tutorial.taskStateById.C6.status = "active";
gs.tutorial.prologueStatus = "completed";
gs.tutorial.branchStatus = { industrial: "completed", archaeology: "completed", combat: "active" };
gs.tutorial.selectedCombatTrack = "laser";
gs.tutorial.c6RunWaves = 0;

// 5) 校验：SaveEnvelope 可用，生成与游戏写入一致的有校验和信封
assert(G("typeof SaveEnvelope === 'object' && typeof SaveEnvelope.create === 'function'"), "SaveEnvelope 可用");
const encoded = G(`(function(){
  var e = SaveEnvelope.create({ payload: gameState, revision: 1, savedAt: ${now}, deviceId: "c6-test-device", gameSaveVersion: 1 });
  return SaveEnvelope.encode(e);
})()`);
assert(typeof encoded === "string" && encoded.length > 0, "信封编码成功");

// 6) 回读自检：用 SaveEnvelope.decode 验证校验和，并确认 payload 含关键字段
const decoded = G(`SaveEnvelope.decode(${JSON.stringify(encoded)})`);
assert(decoded && decoded.payload && decoded.payload.tutorial && decoded.payload.tutorial.taskStateById.C6 && decoded.payload.tutorial.taskStateById.C6.status === "active", "回读校验：C6 为 active");
assert(decoded.payload.inventory.ships.some((s) => s.instanceId === shipId), "回读校验：启程级在 ships 中");
assert(decoded.payload.equipment.instances.length >= 3, "回读校验：装备实例 ≥ 3");

const outPath = path.join(root, "c6-test-save.json");
fs.writeFileSync(outPath, encoded, "utf8");
console.log("已写出测试存档：" + outPath);
console.log("  大小：" + encoded.length + " 字节");
console.log("  启程级 instanceId：" + shipId);
console.log("  装备实例：" + gs.equipment.instances.map((i) => i.itemId + "(" + i.instanceId + ")").join(", "));
console.log("  已指派战斗位 + 预选星带 angel_outpost（level-1 highsec）");
console.log("  教程：P1-P7/I1-I7/A1-A6/C1-C5=completed，C6=active，combat 分支=active，训练方向=laser");
console.log("加载方式（浏览器控制台，确保同源）：");
console.log("  await fetch('c6-test-save.json').then(r=>r.text()).then(t=>localStorage.setItem('eve_idle_save', t)); location.reload();");
