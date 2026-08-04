/* 真实渲染考古页 —— 检查启程级分配后「开始解析」按钮是否可见 */
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
const elements = {};
function makeElement(id) {
  const el = { id: id || "", addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, select: noop, setAttribute: noop, style: {}, textContent: "", value: "1" };
  return el;
}
const sandbox = {
  alert: noop, Blob, confirm: () => true, CanvasRenderingContext2D: MockCanvasContext,
  document: {
    addEventListener: noop, body: makeElement(),
    createElement: () => makeElement(),
    createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
    getElementById: (id) => (elements[id] || (elements[id] = makeElement(id))),
    querySelector: () => makeElement(), querySelectorAll: () => []
  },
  FileReader: class {}, localStorage: { getItem: () => null, setItem: noop }, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null, console
};
sandbox.window = sandbox; sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
const scripts = scriptSources.map(s => fs.readFileSync(path.resolve(root, s), "utf8"));
for (let i = 0; i < scripts.length; i++) vm.runInContext(scripts[i], sandbox, { filename: scriptSources[i] });

function run(expr) { return vm.runInContext(expr, sandbox); }

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

// 真实渲染考古页（renderArchaeologyPage 是函数声明，沙箱内可见）
run("renderArchaeologyPage(Date.now())");
const bodyHtml = elements["archaeology-body"] ? elements["archaeology-body"].innerHTML : "";
const startBtn = bodyHtml.match(/id="archaeology-btn-start"([^>]*)/);
const startStyle = startBtn ? (startBtn[1] || "") : "(按钮缺失)";
const hidden = /display\s*:\s*none/i.test(startStyle);
console.log("archaeology-body 含 start 按钮:", !!startBtn);
console.log("start 按钮 style 属性:", startStyle);
console.log("=> 启程级「开始解析」按钮可见? ", startBtn && !hidden ? "是 ✅" : "否 ❌");

const disp = sandbox.getArchaeologyDisplayState(gs, Date.now());
console.log("display.canAssign =", disp.canAssign, " assignedShip =", !!disp.assignedShip);
process.exit(0);
