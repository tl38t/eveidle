// ============================================================================
// 装备制造「切配方按钮切换」冒烟测试（2026-08-04）
// ----------------------------------------------------------------------------
// 验证装备工程页仿采矿范式（task #44）：
//   1. 正在制造 A、当前选中 B（targetChanged）时：
//      - 「开始制造」按钮显示，文案为「▶ 切换制造」；「停止制造」按钮隐藏。
//   2. 正在制造 A、当前选中 A（无切换）时：
//      - 「停止制造」按钮显示；「开始制造」按钮隐藏。
//   3. 未在制造（active=false）时：
//      - 「开始制造」按钮显示；「停止制造」按钮隐藏。
//   4. 点击「开始制造」（走 showActionConfirm → 确认 → front 接管）后，
//      startedEquipEngTarget 变为当前选中配方 B（即替换在制品）。
//
// 运行：node tools/smoke-equipeng-switch.mjs
// 退出码：0 全通过；1 任一断言失败。
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));
if (scriptSources.length !== 55) throw new Error(`预期 55 个脚本，实际 ${scriptSources.length}`);
const scripts = scriptSources.map((s) => fs.readFileSync(path.resolve(root, s.replace(/^\.\//, "")), "utf8"));

// ---- 浏览器环境 mock（对齐 verify.mjs / smoke-speed.mjs）----
function MockCanvasContext() {}
const noop = () => {};
for (const name of ["arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect",
  "fillText", "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale",
  "setTransform", "stroke", "strokeText", "translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };

// 持久化按钮实例，记录 style.display / textContent，以便断言真实 DOM 显隐。
function makeButton(id) {
  return {
    id, _listeners: {}, addEventListener(type, fn) { this._listeners[type] = fn; },
    classList, click() { if (this._listeners.click) this._listeners.click(); },
    closest: () => null, dataset: {}, focus: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => new MockCanvasContext(),
    innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [],
    remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop,
    style: {}, textContent: "", value: "1"
  };
}
function makeElement() {
  return {
    addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(),
    innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [],
    remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1"
  };
}
const startBtn = makeButton("btn-start-equipeng");
const stopBtn = makeButton("btn-stop-equipeng");
const documentMock = {
  addEventListener: noop, body: makeElement(), createElement: () => makeElement(),
  createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: (id) => (id === "btn-start-equipeng" ? startBtn : id === "btn-stop-equipeng" ? stopBtn : makeElement()),
  querySelector: () => makeElement(), querySelectorAll: () => []
};
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };

function buildSandbox() {
  let mockNow = 1700000000000;
  const RealDate = Date;
  function DateMock(...args) { return args.length === 0 ? new RealDate(mockNow) : new RealDate(...args); }
  DateMock.now = () => mockNow;
  DateMock.parse = RealDate.parse;
  DateMock.UTC = RealDate.UTC;
  const sandbox = {
    alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true,
    document: documentMock, FileReader: class {}, localStorage: localStorageMock,
    requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
    URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
    URLSearchParams,
    location: { search: "" },
    performance: { now: () => mockNow },
    Date: DateMock
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = noop;
  sandbox.addEventListener = noop;
  vm.createContext(sandbox);
  for (let i = 0; i < scripts.length; i++) vm.runInContext(scripts[i], sandbox, { filename: scriptSources[i] });
  // 顶层 const 不会成为 sandbox 全局属性，这里在同一词法环境里二次求值导出。
  try { vm.runInContext("this.EQUIPMENT_ENGINEERING_RECIPES = (typeof EQUIPMENT_ENGINEERING_RECIPES !== 'undefined') ? EQUIPMENT_ENGINEERING_RECIPES : [];", sandbox); } catch (e) { sandbox.EQUIPMENT_ENGINEERING_RECIPES = []; }
  sandbox.__setNow = (t) => { mockNow = t; };
  return sandbox;
}

// ---- 断言框架 ----
const failures = [];
function check(name, cond, detail) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); failures.push(name); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// 选取两个可制造配方（level 1、无需蓝图），保证 canStart 为真。
const s = buildSandbox();
const RECIPES = s.EQUIPMENT_ENGINEERING_RECIPES;
const lvl1Recipes = RECIPES.filter((r) => r.level <= 1 && !r.requiresBlueprint);
check("存在至少两个 Lv.1 无需蓝图的装备配方", lvl1Recipes.length >= 2, `找到 ${lvl1Recipes.length}`);
const RECIPE_A = lvl1Recipes[0].id;
const RECIPE_B = lvl1Recipes[1].id;

// 装备工程需要：技能等级、且 state.queue 存在（display 读取 state.queue）。
s.gameState.skills.equipmentEngineering = { lvl: 10, xp: 0 };
if (!s.gameState.queue) s.gameState.queue = { items: [], config: { maxSize: 20 }, status: { isRunning: false, activeIndex: -1, completedCount: 0, failCount: 0 } };

function setAction({ active, started, target }) {
  s.gameState.currentAction.active = active;
  s.gameState.currentAction.skill = "equipmentEngineering";
  s.gameState.currentAction.startedEquipEngTarget = started || "";
  s.gameState.currentAction.equipEngTarget = target;
  s.gameState.currentAction.progress = active ? 0.4 : 0;
  s.gameState.currentAction.lastProgressUpdate = Date.now() - 1000;
}

console.log("== 1. 制造 A + 选中 B（targetChanged）：停止隐藏、开始显示且文案=切换制造 ==");
setAction({ active: true, started: RECIPE_A, target: RECIPE_B });
s.renderEquipEngPage(Date.now());
check("开始按钮显示", startBtn.style.display !== "none", `display=${startBtn.style.display}`);
check("开始按钮文案=切换制造", startBtn.textContent === "▶ 切换制造", `实际「${startBtn.textContent}」`);
check("停止按钮隐藏", stopBtn.style.display === "none", `display=${stopBtn.style.display}`);

console.log("== 2. 制造 A + 选中 A（无切换）：停止显示、开始隐藏 ==");
setAction({ active: true, started: RECIPE_A, target: RECIPE_A });
s.renderEquipEngPage(Date.now());
check("停止按钮显示", stopBtn.style.display !== "none", `display=${stopBtn.style.display}`);
check("开始按钮隐藏", startBtn.style.display === "none", `display=${startBtn.style.display}`);

console.log("== 3. 未制造（active=false）+ 选中 B：开始显示、停止隐藏 ==");
setAction({ active: false, started: "", target: RECIPE_B });
s.renderEquipEngPage(Date.now());
check("开始按钮显示", startBtn.style.display !== "none", `display=${startBtn.style.display}`);
check("开始按钮文案=开始制造", startBtn.textContent === "▶ 开始制造", `实际「${startBtn.textContent}」`);
check("停止按钮隐藏", stopBtn.style.display === "none", `display=${stopBtn.style.display}`);

console.log("== 4. 点开始（切换制造）→ startedEquipEngTarget 变为当前选中 B ==");
// 模拟「开始制造」按钮点击：其绑定是 showActionConfirm('equipmentEngineering')；
// 再模拟弹窗确认（confirmAction → front=true → queue/add + startQueue 接管 currentAction）。
setAction({ active: true, started: RECIPE_A, target: RECIPE_B });
s.showActionConfirm("equipmentEngineering");
const beforeStart = s.gameState.currentAction.startedEquipEngTarget;
check("切换前在制品为 A", beforeStart === RECIPE_A, `实际 ${beforeStart}`);
s.confirmAction(); // 等价于点弹窗「确认」：插队首并立即 startQueue
const afterStart = s.gameState.currentAction.startedEquipEngTarget;
check("切换后在制品变为 B（替换 A）", afterStart === RECIPE_B, `实际 ${afterStart}`);
check("切换后 active 仍为 true（继续制造）", s.gameState.currentAction.active === true);
check("切换后 skill 仍为 equipmentEngineering", s.gameState.currentAction.skill === "equipmentEngineering");

console.log("== 5. 窗口大小/可用性不变（regression guard）：canStart 计算仍有效 ==");
setAction({ active: false, started: "", target: RECIPE_B });
const disp = s.getEquipmentEngineeringDisplayState(s.gameState, Date.now(), "");
check("display.canStart 为真（Lv.10 解锁 Lv.1 配方）", disp.canStart === true, `canStart=${disp.canStart}`);

console.log("");
if (failures.length === 0) {
  console.log("✅ 装备制造切配方按钮切换冒烟全部通过");
  process.exit(0);
} else {
  console.log(`❌ 装备制造切配方按钮切换冒烟失败 ${failures.length} 项：${failures.join(", ")}`);
  process.exit(1);
}
