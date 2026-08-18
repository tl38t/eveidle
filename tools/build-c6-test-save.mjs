// 生成一个「卡在 C6 这一步」的测试存档（含启程级 + 装备），用于回归验证：
//   - C6 在线实时进度 0/4 → 1/4（清波）
//   - C6 离线保底（清 4 波即完成）
//   - 舰船强化/拆解、装备强化/拆解 自定义弹窗
// 产出：项目根目录 c6-test-save.json（与游戏 LocalStorageAdapter 实际写入格式一致的裸 gameState）
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

// 5) 序列化为「裸 gameState」——与游戏 LocalStorageAdapter.save 实际写入格式一致。
//    游戏启动后 SaveManager 把 gameState 直接 JSON.stringify 进 localStorage 的 eve_idle_save，
//    而非信封（信封仅用于云端/镜像比对）。因此测试存档必须是裸 gameState，否则
//    readCandidate（第 19 行）与导入按钮 importData（第 1483 行）会因顶层缺 .skills
//    判为「本地存档结构无效 / 导入失败：存档格式无效」。
let serialized;
try {
  serialized = G("JSON.stringify(gameState)");
} catch (e) {
  console.error("JSON.stringify(gameState) 失败（可能含不可序列化字段）：" + (e && e.message));
  process.exit(1);
}
assert(typeof serialized === "string" && serialized.length > 0, "裸 gameState 序列化成功");

// 6) 回读自检：模拟真实加载链路 Object.assign(gameState, parsed) + normalizeAndMigratePayload，
//    确认 C6 仍 active、启程级与装备完好（与 readCandidate / importData 后续处理一致）。
G("globalThis.__c6test = JSON.stringify(gameState)");
const roundTripOk = G(`(function(){
  var parsed = JSON.parse(globalThis.__c6test);
  if (!parsed || !parsed.skills) return false;
  Object.assign(gameState, parsed);
  if (!Object.hasOwn(parsed, 'settings')) gameState.settings = {};
  if (typeof normalizeQueueState === 'function') normalizeQueueState(gameState);
  if (typeof normalizeAndMigratePayload === 'function') normalizeAndMigratePayload({ isLegacy: !Object.prototype.hasOwnProperty.call(parsed, 'tutorial'), now: Date.now() });
  return gameState.tutorial.taskStateById.C6.status === 'active'
    && gameState.inventory.ships.some(function(s){ return s.instanceId === ${JSON.stringify(shipId)}; })
    && gameState.equipment.instances.length >= 3;
})()`);
assert(roundTripOk, "裸 gameState 经 Object.assign + normalizeAndMigratePayload 后 C6 仍 active、启程级/装备完好");

const outPath = path.join(root, "c6-test-save.json");
fs.writeFileSync(outPath, serialized, "utf8");
console.log("已写出测试存档（裸 gameState，可直接导入或写入 localStorage）：" + outPath);
console.log("  大小：" + serialized.length + " 字节");
console.log("  启程级 instanceId：" + shipId);
console.log("  装备实例：" + gs.equipment.instances.map((i) => i.itemId + "(" + i.instanceId + ")").join(", "));
console.log("  已指派战斗位 + 预选星带 angel_outpost（level-1 highsec）");
console.log("  教程：P1-P7/I1-I7/A1-A6/C1-C5=completed，C6=active，combat 分支=active，训练方向=laser");
console.log("");
console.log("加载方式 A（浏览器控制台，确保同源）：");
console.log("  await fetch('c6-test-save.json').then(r=>r.text()).then(t=>localStorage.setItem('eve_idle_save', t)); location.reload();");
console.log("加载方式 B（游戏内「导入存档」按钮，直接粘贴/上传本文件内容）：");
console.log("  设置 → 存档管理 → 导入存档，选择或粘贴 c6-test-save.json 内容即可。");
