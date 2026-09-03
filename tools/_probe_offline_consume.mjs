// 探针：离线结算弹窗「获得 / 消耗」分区（诊断用，不入库）。
// 验证 diffInventorySnapshot 返回 {gained, consumed}，负差额（含降到 0）进 consumed，
// 且 splitOfflineDispatchBonus 仍能处理 gained 分支。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const scriptSources = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
while ((m = re.exec(html))) scriptSources.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
const UI_EXCLUDE = new Set([
  "js/ui/error-boundary.js", "js/ui/action-modal.js", "js/ui/shell-render.js",
  "js/ui/manufacturing-render.js", "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js", "js/core/runtime.js",
  "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js"
]);
const logicSources = scriptSources.filter(s => !UI_EXCLUDE.has(s));

let combined = "";
for (const src of logicSources) {
  const full = path.resolve(ROOT, src);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full)) throw new Error("本地脚本缺失：" + src);
  combined += "\n;\n// ===== " + src + " =====\n" + fs.readFileSync(full, "utf8");
}

const noop = () => {};
function MockCanvasContext() {}
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, insertAdjacentHTML: noop,
  replaceChildren: noop, removeChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 }),
  getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560,
  querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop,
  getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1", children: [], parentNode: null
});
const documentMock = {
  addEventListener: noop, body: makeElement(), createElement: () => makeElement(), createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => []
};
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true, document: documentMock,
  FileReader: class {}, localStorage: localStorageMock, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, URLSearchParams: globalThis.URLSearchParams,
  matchMedia: () => ({ matches: false, media:"", onchange:null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, dispatchEvent: noop }),
  GameEvents: { emit: noop, on: () => () => {}, once: noop, contracts: { has: () => true, validate: () => ({ valid:true, registered:true }) }, listenerCount: () => 0 },
  RuntimeGuard: { report: noop, runCritical: () => ({ ok:true }), resume: () => true, isPaused: () => false, runRecoverable: () => ({ ok:true }) },
  window: null
};
sandbox.window = sandbox; sandbox.window.addEventListener = noop;
sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
sandbox.location = { href:"", search:"", hash:"" };
sandbox.navigator = { userAgent: "node" };
sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
sandbox.updateUI = noop; sandbox.switchPage = noop; sandbox.currentPage = "";
sandbox.updateLiveUI = noop; sandbox.refreshVisiblePanelAfterAction = noop;
sandbox.playAttackFX = noop; sandbox.playEnemyAttackFX = noop;

vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: "combined.js" });

function R(expr) { return vm.runInContext(expr, sandbox); }

// 极简测试 helper
let passed = 0, failed = 0;
const failMessages = [];
function ok(cond, name, info) {
  if (cond) { passed++; }
  else { failed++; failMessages.push((info != null ? "  ✗ " + name + " : " + JSON.stringify(info) : "  ✗ " + name)); }
}
function findById(arr, id) { return (arr || []).find(it => it && it.id === id); }

// 直接构造快照对象（与 createInventorySnapshot 输出同形），隔离测试 diff 逻辑。
function diffOf(before, after) {
  sandbox.__before = before; sandbox.__after = after;
  return vm.runInContext("diffInventorySnapshot(__before, __after)", sandbox);
}

// —— 场景 1：综合（冶炼吃矿石+产矿物、战斗烧燃料+耗弹药、造舰吃装备、损失舰船/蓝图/脑插/战利品） ——
const before = {
  res: { "consumable:fuel": 5000, "ore:tritanium": 1000, "mineral:三钛晶体": 0 },
  ammo: { "laser|T1": 100 },
  equipment: { "t1_small_laser": 3 },
  ships: { "rookie_corvette": 2 },
  blueprints: { "equipment:t1_small_laser": 1 },
  loot: { "isk": { count: 10, kind: "isk", name: "星币单位" } },
  implants: { "imp_focus": true }
};
const after = {
  res: { "consumable:fuel": 2000, "ore:tritanium": 0, "mineral:三钛晶体": 500 },
  ammo: { "laser|T1": 30 },
  equipment: { "t1_small_laser": 4 },
  ships: { "rookie_corvette": 1 },
  blueprints: {},
  loot: { "isk": { count: 5, kind: "isk", name: "星币单位" } },
  implants: {}
};
const r1 = diffOf(before, after);
ok(Array.isArray(r1.gained) && Array.isArray(r1.consumed), "返回 {gained, consumed} 形状", r1);
// 消耗项
const cFuel = findById(r1.consumed, "consumable:fuel");
ok(cFuel && cFuel.quantity === 3000 && cFuel.consumed === true, "燃料消耗 5000→2000 = 3000", cFuel);
const cOre = findById(r1.consumed, "ore:tritanium");
ok(cOre && cOre.quantity === 1000, "矿石被冶炼吃光 1000→0 = 1000", cOre);
const cAmmo = findById(r1.consumed, "ammo:laser|T1");
ok(cAmmo && cAmmo.quantity === 70, "弹药消耗 100→30 = 70", cAmmo);
const cShip = findById(r1.consumed, "ship:rookie_corvette");
ok(cShip && cShip.quantity === 1 && cShip.categoryLabel === "损失", "舰船损失 2→1，标为「损失」", cShip);
const cBp = findById(r1.consumed, "blueprint:equipment:t1_small_laser");
ok(cBp && cBp.quantity === 1, "蓝图消耗 1→0 = 1", cBp);
const cLoot = findById(r1.consumed, "loot:isk");
ok(cLoot && cLoot.quantity === 5 && cLoot.kind === "isk", "战利品消耗 10→5 = 5", cLoot);
const cImp = findById(r1.consumed, "imp_focus");
ok(cImp && cImp.quantity === 1 && cImp.implant === true, "脑插消耗 1→0 = 1", cImp);
// 获得项
const gMin = findById(r1.gained, "mineral:三钛晶体");
ok(gMin && gMin.quantity === 500, "矿物产出 0→500 = 500（获得）", gMin);
const gEq = findById(r1.gained, "t1_small_laser");
ok(gEq && gEq.quantity === 1, "装备增加 3→4 = 1（获得）", gEq);
ok(!findById(r1.gained, "consumable:fuel"), "燃料不在获得区", r1.gained.map(i => i.id));
ok(!findById(r1.consumed, "mineral:三钛晶体"), "矿物不在消耗区", r1.consumed.map(i => i.id));

// —— 场景 2：消耗「降到 0」也必须捕获（before 有、after 键消失） ——
const r2 = diffOf(
  { res:{ "consumable:fuel": 5000 }, ammo:{}, equipment:{}, ships:{}, blueprints:{}, loot:{}, implants:{} },
  { res:{}, ammo:{}, equipment:{}, ships:{}, blueprints:{}, loot:{}, implants:{} }
);
const cFuel0 = findById(r2.consumed, "consumable:fuel");
ok(cFuel0 && cFuel0.quantity === 5000, "燃料烧到 0 仍被捕获（键并集）= 5000", cFuel0);
ok(r2.gained.length === 0, "全消耗无获得", r2);

// —— 场景 3：纯获得（无消耗），consumed 为空 ——
const r3 = diffOf(
  { res:{ "mineral:三钛晶体": 0 }, ammo:{}, equipment:{}, ships:{}, blueprints:{}, loot:{}, implants:{} },
  { res:{ "mineral:三钛晶体": 250 }, ammo:{}, equipment:{}, ships:{}, blueprints:{}, loot:{}, implants:{} }
);
ok(r3.consumed.length === 0 && r3.gained.length === 1, "纯获得时 consumed 为空", r3);

// —— 场景 4：splitOfflineDispatchBonus 仍能处理 gained（不崩、返回数组） ——
const split = R("splitOfflineDispatchBonus")(r1.gained);
ok(Array.isArray(split), "splitOfflineDispatchBonus(gained) 返回数组", split);

// —— 场景 5：消耗项 UI 字段齐全（consumed 标记 + 绝对值 quantity） ——
const allConsumedFlagged = r1.consumed.every(it => it.consumed === true && Number(it.quantity) > 0);
ok(allConsumedFlagged, "所有消耗项带 consumed 标记且 quantity>0", r1.consumed);

console.log(`\n离线消耗探针：${passed} 通过 / ${failed} 失败`);
if (failed) { console.log(failMessages.join("\n")); process.exit(1); }
else console.log("全部通过 ✓");
