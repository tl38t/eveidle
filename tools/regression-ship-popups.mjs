// 回归测试：舰船强化/拆解 改用 showDangerConfirm 自定义 DOM 弹窗（替换原生 window.confirm）
// 背景：个别客户 WebView 屏蔽原生 confirm，导致舰船强化/拆解点击无反应（装备拆解/丢弃用自定义弹窗正常）。
// 本测试验证：
//   1) 覆盖 window.confirm 使其抛错后，舰船强化/拆解仍能弹出自定义弹窗，且不调用原生 confirm。
//   2) 装备拆解/丢弃继续走自定义弹窗（不依赖原生 confirm）。
//   3) 自定义弹窗：确认只执行一次（settled 防重入），取消不改状态、不执行。
//   4) window 入口显式导出（TapTap 竖屏入口稳定），缺失时不再静默（源码含 typeof 守卫 + toast/error）。
//   5) index.html 缓存版本已升级，避免 shell-render / taptap-portrait 新旧混用。
// 运行：NODE_OPTIONS="" node tools/regression-ship-popups.mjs
// 退出码：0 = 全部通过；1 = 存在失败。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));

// ---- sandbox 构造（与 verify.mjs / audit 同源，含完整 canvas mock）----
function MockCanvasContext() {}
const noop = () => {};
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.roundRect = noop;

// ---- 可追踪 DOM（用于验证自定义弹窗真实创建 / 确认 / 取消）----
function parseChildren(html) {
  const out = [];
  const re = /<(button|div)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const cls = (m[2].match(/class="([^"]*)"/) || [])[1] || "";
    const el = new FakeEl(m[1]);
    el.className = cls;
    out.push(el);
  }
  return out;
}
function findInTree(node, pred) {
  if (pred(node)) return node;
  for (const c of node.children) { const r = findInTree(c, pred); if (r) return r; }
  return null;
}
function collectInTree(node, pred, out) {
  if (pred(node)) out.push(node);
  for (const c of node.children) collectInTree(c, pred, out);
}
function FakeEl(tag) {
  this.tagName = tag;
  this.className = "";
  this._html = "";
  this.children = [];
  this.parentNode = null;
  this.listeners = {};
  this.dataset = {};
  this.style = {};
  this.textContent = "";
  this.classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
}
FakeEl.prototype.setAttribute = function (k, v) { if (k === "class") this.className = v; this["attr_" + k] = v; };
FakeEl.prototype.getAttribute = function (k) { return k === "class" ? this.className : (this["attr_" + k] ?? null); };
FakeEl.prototype.removeAttribute = function (k) { delete this["attr_" + k]; };
FakeEl.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
FakeEl.prototype.removeChild = function (c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; };
FakeEl.prototype.addEventListener = function (t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); };
FakeEl.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
FakeEl.prototype.focus = function () {};
FakeEl.prototype.getContext = function () { return new MockCanvasContext(); };
FakeEl.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 100, height: 100 }; };
FakeEl.prototype.select = function () {};
FakeEl.prototype.closest = function () { return null; };
Object.defineProperty(FakeEl.prototype, "innerHTML", {
  get() { return this._html; },
  set(v) { this._html = v; this.children = parseChildren(v); }
});
FakeEl.prototype.querySelector = function (sel) {
  if (sel[0] === ".") { const cls = sel.slice(1); return findInTree(this, e => (e.className || "").split(/\s+/).includes(cls)); }
  return null;
};
FakeEl.prototype.querySelectorAll = function (sel) {
  const cls = sel[0] === "." ? sel.slice(1) : sel;
  const out = []; collectInTree(this, e => (e.className || "").split(/\s+/).includes(cls), out); return out;
};
FakeEl.prototype.click = function () { (this.listeners.click || []).forEach(f => f({ target: this, preventDefault: noop, stopPropagation: noop })); };

const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({ addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1" });

const body = new FakeEl("body");
const _byId = {};
const documentMock = {
  addEventListener: noop, readyState: "loading", body,
  createElement: (t) => new FakeEl(t),
  createElementNS: (_n, t) => new FakeEl(t),
  getElementById: (id) => (_byId[id] || (_byId[id] = new FakeEl("div"))),
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: (sel) => body.querySelectorAll(sel)
};
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console,
  confirm: () => true, document: documentMock, FileReader: class {},
  localStorage: localStorageMock,
  matchMedia: () => ({ matches: false, media: "", addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (const src of scriptSources) {
  vm.runInContext(fs.readFileSync(path.resolve(root, src.replace(/^\.\//, "")), "utf8"), sandbox, { filename: src });
}

// ---- 断言工具 ----
let pass = 0, fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name); }
}

// ---- 测试夹具：开启所有确认开关，模拟 WebView 屏蔽原生对话框 ----
const G = (expr) => vm.runInContext(expr, sandbox);
const gs = G("gameState");
// 开启舰船强化确认 + 装备拆解/丢弃确认
if (!gs.settings) gs.settings = {};
if (gs.settings.ui) { gs.settings.ui.confirmShipEnhancement = true; }
else gs.settings.ui = { confirmShipEnhancement: true };
// getSettingsDisplayState 可能读 gs.settings 或嵌套；直接设置兼容字段
Object.assign(gs.settings, { confirmShipEnhancement: true, confirmDismantle: true, confirmDiscard: true });

let confirmCalls = 0;
sandbox.confirm = () => { confirmCalls++; throw new Error("native dialog blocked in WebView"); };

// 同时确认 window 入口已导出
check("window.enhanceShipFromHangar 已显式导出为 function", typeof sandbox.enhanceShipFromHangar === "function");
check("window.dismantleShipFromHangar 已显式导出为 function", typeof sandbox.dismantleShipFromHangar === "function");

// 找一个可强化的舰船（tier 存在即可；材料不足也会弹窗，确认后因材料不足报错，不影响弹窗验证）
const display = G("getHangarDisplayState(gameState, Date.now())");
const enhanceShip = display.ships.find(s => s.enhancement && s.enhancement.available);
const dismantleShip = display.ships.find(s => s.dismantle && s.dismantle.available && s.dismantle.canDismantle);

// ===== T1：舰船强化 —— 覆盖 confirm 抛错，仍弹自定义弹窗，且不调用原生 confirm =====
if (enhanceShip) {
  confirmCalls = 0;
  let threw = false;
  try { sandbox.enhanceShipFromHangar(enhanceShip.instanceId); } catch (e) { threw = true; }
  const popup = body.querySelector(".dlg-backdrop");
  check("T1 舰船强化：原生 window.confirm 未被调用（即使被覆盖为抛错）", confirmCalls === 0);
  check("T1 舰船强化：自定义弹窗 .dlg-backdrop 已创建", !!popup);
  check("T1 舰船强化：调用未因原生 confirm 抛错而中断", !threw);
} else {
  console.log("  SKIP T1：当前存档无可用强化舰船（tier 存在），无法动态验证（详见 T7 静态保证）");
}

// ===== T2：舰船拆解 —— 同上 =====
if (dismantleShip) {
  confirmCalls = 0;
  let threw = false;
  try { sandbox.dismantleShipFromHangar(dismantleShip.instanceId); } catch (e) { threw = true; }
  const popup = body.querySelector(".dlg-backdrop");
  check("T2 舰船拆解：原生 window.confirm 未被调用", confirmCalls === 0);
  check("T2 舰船拆解：自定义弹窗 .dlg-backdrop 已创建", !!popup);
  check("T2 舰船拆解：调用未因原生 confirm 抛错而中断", !threw);
} else {
  console.log("  SKIP T2：当前存档无「可拆解且无阻塞」舰船，无法动态验证（详见 T7 静态保证）");
}

// ===== T3：弹窗确认只执行一次；取消不改状态不执行 =====
// 复用 T1 弹窗（enhanceShip 仍打开）→ 若 T1 未打开则用 enhanceShip 重新打开
function ensureEnhancePopup() {
  if (!body.querySelector(".dlg-backdrop") && enhanceShip) sandbox.enhanceShipFromHangar(enhanceShip.instanceId);
}
ensureEnhancePopup();
let popup = body.querySelector(".dlg-backdrop");
if (popup) {
  const before = JSON.stringify(gs.inventory.ships);
  // 确认执行计数：包裹 dispatchGameAction
  const realDispatch = (typeof sandbox.dispatchGameAction === "function")
    ? sandbox.dispatchGameAction
    : (sandbox.GameActions && sandbox.GameActions.dispatchGameAction);
  let dispatchN = 0;
  const wrap = (...a) => { dispatchN++; return realDispatch.apply(sandbox, a); };
  if (typeof sandbox.dispatchGameAction === "function") sandbox.dispatchGameAction = wrap;
  else if (sandbox.GameActions) sandbox.GameActions.dispatchGameAction = wrap;

  const confirmBtn = popup.querySelector(".dlg-confirm");
  confirmBtn.click();
  confirmBtn.click(); // 二次点击：settled 防重入，应不再执行
  check("T3 舰船强化：确认只执行一次（settled 防重入）", dispatchN === 1);

  // 取消路径：重新打开后点取消
  ensureEnhancePopup();
  popup = body.querySelector(".dlg-backdrop");
  dispatchN = 0;
  if (typeof sandbox.dispatchGameAction === "function") sandbox.dispatchGameAction = wrap;
  else if (sandbox.GameActions) sandbox.GameActions.dispatchGameAction = wrap;
  const cancelBtn = popup.querySelector(".dlg-cancel");
  cancelBtn.click();
  const after = JSON.stringify(gs.inventory.ships);
  check("T3 舰船强化：点击取消不执行 Action", dispatchN === 0);
  check("T3 舰船强化：点击取消不改舰船状态", before === after);
  check("T3 舰船强化：取消后弹窗已移除", !body.querySelector(".dlg-backdrop"));
  // 还原 dispatchGameAction（避免影响后续）
  if (typeof sandbox.dispatchGameAction === "function") sandbox.dispatchGameAction = realDispatch;
  else if (sandbox.GameActions) sandbox.GameActions.dispatchGameAction = realDispatch;
} else {
  console.log("  SKIP T3：无可用强化舰船弹窗，跳过确认/取消执行次数验证（详见 T7 静态保证）");
}

// ===== T4：装备拆解 / 丢弃 继续走自定义弹窗（不依赖原生 confirm） =====
function findEquipmentRef() {
  const eq = gs.equipment && Array.isArray(gs.equipment.inventory) ? gs.equipment.inventory : [];
  return eq.length ? eq[0].instanceId || eq[0].id : null;
}
const eqRef = findEquipmentRef();
if (eqRef) {
  for (const fnName of ["discardEquipmentFromModal", "dismantleEquipmentFromModal"]) {
    if (typeof sandbox[fnName] !== "function") continue;
    confirmCalls = 0;
    body.children = body.children.filter(c => false); // 清空旧弹窗
    let threw = false;
    try { sandbox[fnName](eqRef); } catch (e) { threw = true; }
    const popup = body.querySelector(".dlg-backdrop");
    check("T4 " + fnName + "：原生 window.confirm 未被调用", confirmCalls === 0);
    check("T4 " + fnName + "：自定义弹窗已创建", !!popup);
    check("T4 " + fnName + "：调用未因原生 confirm 抛错而中断", !threw);
  }
} else {
  console.log("  SKIP T4：当前存档无装备实例，无法动态验证（详见 T7 静态保证：装备函数仅用 showDangerConfirm）");
}

// ===== T5：TapTap 竖屏入口缺失时不再静默（源码含 typeof 守卫 + toast/error） =====
const tpsrc = fs.readFileSync(path.join(root, "js/ui/taptap-portrait.js"), "utf8");
check("T5 taptap-portrait 对 enhanceShipFromHangar 做 typeof 守卫",
  /typeof window\.enhanceShipFromHangar\s*===\s*"function"/.test(tpsrc));
check("T5 taptap-portrait 对 dismantleShipFromHangar 做 typeof 守卫",
  /typeof window\.dismantleShipFromHangar\s*===\s*"function"/.test(tpsrc));
check("T5 入口缺失时记录明确错误（console.error）",
  /入口缺失：window\.enhanceShipFromHangar 未定义/.test(tpsrc) && /入口缺失：window\.dismantleShipFromHangar 未定义/.test(tpsrc));
check("T5 入口缺失时 showToast 提示（不静默）",
  /window\.showToast\([^)]*刷新或更新客户端/.test(tpsrc));

// ===== T6：index.html 缓存版本升级（防 shell-render / taptap-portrait 新旧混用） =====
const shV = (html.match(/shell-render\.js\?v=(\d+)/) || [])[1];
const tpV = (html.match(/taptap-portrait\.js\?v=(\d+)/) || [])[1];
check("T6 shell-render.js 缓存版本 ≥ 22（已升级）", Number(shV) >= 22);
check("T6 taptap-portrait.js 缓存版本 ≥ 9（已升级）", Number(tpV) >= 9);

// ===== T7：静态保证 —— 舰船强化/拆解不再调用 window.confirm，改为 showDangerConfirm =====
const shellSrc = fs.readFileSync(path.join(root, "js/ui/shell-render.js"), "utf8");
// 仅检查 enhanceShipFromHangar / dismantleShipFromHangar 函数体内是否含 window.confirm
function fnBody(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  // 粗定位：到下一个顶层 function 或文件尾
  let depth = 0, j = src.indexOf("{", i);
  let k = j;
  for (; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1);
}
const enhBody = fnBody(shellSrc, "enhanceShipFromHangar");
const disBody = fnBody(shellSrc, "dismantleShipFromHangar");
check("T7 舰船强化函数不再调用 window.confirm", !/window\.confirm/.test(enhBody));
check("T7 舰船强化函数改用 showDangerConfirm", /showDangerConfirm/.test(enhBody));
check("T7 舰船拆解函数不再调用 window.confirm", !/window\.confirm/.test(disBody));
check("T7 舰船拆解函数改用 showDangerConfirm", /showDangerConfirm/.test(disBody));

// ===== 汇总 =====
console.log("\n==== 回归结果：" + pass + " 通过 / " + fail + " 失败 ====");
if (failures.length) console.log("失败项：\n - " + failures.join("\n - "));
process.exit(fail === 0 ? 0 : 1);
