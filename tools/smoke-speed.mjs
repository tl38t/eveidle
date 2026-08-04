// ============================================================================
// 十倍速开关端到端冒烟测试（2026-08-04）
// ----------------------------------------------------------------------------
// 验证「单仓库 + 运行期开关」架构下：
//   A. 速度源解析：URL ?speed=10 → GAME_SPEED=10，gameDeltaSec 按倍率缩放。
//   B. 产出加速：采矿 tick 的进度积累 ≈ 10×（基于真实 elapsed × GAME_SPEED）。
//   C. 空间站自动线加速：getStationLogisticsMultiplier ≈ 10×。
//   D. 科研加速：processResearchUntil 的 scale 参数使进度积累 ≈ 10×。
//   E. 冷却实时：增强剂计时（剩余时长）按真实 elapsed 扣减，speed=10 与 speed=1 完全一致。
//   F. 代码纯度：gameDeltaSec/getGameSpeed/GAME_SPEED 仅出现在
//      speed-config.js / tick.js / station.js，冷却类函数（增强剂/战斗恢复/考古干扰/维修）
//      绝不引用速度源 → 冷却/到期保持实时。
//
// 运行：node tools/smoke-speed.mjs
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

// ---- 浏览器环境 mock（对齐 verify.mjs）----
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
const makeElement = () => ({
  addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(),
  innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [],
  remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1"
});
const documentMock = {
  addEventListener: noop, body: makeElement(), createElement: () => makeElement(),
  createElementNS: () => ({ ...makeElement(), setAttribute: noop }), getElementById: () => makeElement(),
  querySelector: () => makeElement(), querySelectorAll: () => []
};
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };

// ---- 可控制时钟的沙箱 ----
function buildSandbox(speedParam) {
  let mockNow = 1700000000000;
  const RealDate = Date;
  function DateMock(...args) {
    if (args.length === 0) return new RealDate(mockNow);
    return new RealDate(...args);
  }
  DateMock.now = () => mockNow;
  DateMock.parse = RealDate.parse;
  DateMock.UTC = RealDate.UTC;

  const sandbox = {
    alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true,
    document: documentMock, FileReader: class {}, localStorage: localStorageMock,
    requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
    URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
    URLSearchParams, // 浏览器原生全局；vm 上下文需显式注入，否则 speed-config 解析 ?speed 抛错降级为 1
    location: { search: speedParam ? `?speed=${speedParam}` : "" },
    performance: { now: () => mockNow },
    Date: DateMock
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = noop;
  sandbox.addEventListener = noop;
  vm.createContext(sandbox);
  for (let i = 0; i < scripts.length; i++) vm.runInContext(scripts[i], sandbox, { filename: scriptSources[i] });
  sandbox.__setNow = (t) => { mockNow = t; };
  sandbox.__getNow = () => mockNow;
  return sandbox;
}

// ---- 断言框架 ----
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
    failures.push(name);
  }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

console.log("== A. 速度源解析 ==");
const s1 = buildSandbox(1);
const s10 = buildSandbox(10);
check("speed=1 → GAME_SPEED===1", s1.GAME_SPEED === 1, `实际 ${s1.GAME_SPEED}`);
check("speed=10 → GAME_SPEED===10", s10.GAME_SPEED === 10, `实际 ${s10.GAME_SPEED}`);
check("speed=10 → getGameSpeed()===10", s10.getGameSpeed() === 10, `实际 ${s10.getGameSpeed()}`);
check("gameDeltaSec(1)===10 @speed=10", s10.gameDeltaSec(1) === 10, `实际 ${s10.gameDeltaSec(1)}`);
check("gameDeltaSec(5)===50 @speed=10", s10.gameDeltaSec(5) === 50, `实际 ${s10.gameDeltaSec(5)}`);
check("gameDeltaSec(0)===0（零按倍率缩放）", s10.gameDeltaSec(0) === 0);
check("gameDeltaSec(NaN)===0（非有限降级）", s10.gameDeltaSec(NaN) === 0);
check("gameDeltaSec(Infinity)===0（非有限降级）", s10.gameDeltaSec(Infinity) === 0);
check("speed=1 → gameDeltaSec(5)===5（逐字节不变）", s1.gameDeltaSec(5) === 5, `实际 ${s1.gameDeltaSec(5)}`);

console.log("== B. 产出加速（采矿 tick 进度积累）==");
const NOW = s1.__getNow();
const area = s1.getMiningAreaByName("艾克诺岩带"); // baseTime 380，level 85
const eff = s1.getMiningEfficiency();
const actualTime = area.baseTime / eff; // 无周期完成所需阈值
for (const s of [s1, s10]) {
  s.gameState.skills.mining.lvl = 90; // 解锁最高级矿带
  s.gameState.currentAction = {
    active: true, skill: "mining", area: "艾克诺岩带", startedArea: undefined,
    progress: 0, lastProgressUpdate: s.__getNow() - 4000, refDuration: 0, batchRemaining: 0
  };
}
const before1 = s1.gameState.currentAction.progress;
const before10 = s10.gameState.currentAction.progress;
s1.gameTick();
s10.gameTick();
const d1 = s1.gameState.currentAction.progress - before1;
const d10 = s10.gameState.currentAction.progress - before10;
check("speed=1 采矿进度有积累 (>0)", d1 > 0, `Δ=${d1}`);
check("speed=10 采矿进度有积累 (>0)", d10 > 0, `Δ=${d10}`);
check("采矿进度加速比 ≈ 10×", approx(d10 / d1, 10, 0.5), `speed1Δ=${d1}, speed10Δ=${d10}, 比=${(d10 / d1).toFixed(3)}`);
check("speed=10 未触发周期完成（无 wrap 噪声）", d10 < actualTime, `Δ=${d10}, actualTime=${actualTime.toFixed(2)}`);

console.log("== C. 空间站自动线加速（后勤倍率）==");
// 构造可运营空间站：bodyLevel=3（base ×1.03），有维护燃料 → operational。
function setOperationalStation(s) {
  s.gameState.station = { bodyLevel: 3, maintenance: { fuelRemaining: 999999, lastTick: s.__getNow() }, buildings: {} };
}
setOperationalStation(s1);
setOperationalStation(s10);
const mult1 = s1.getStationLogisticsMultiplier(s1.gameState);
const mult10 = s10.getStationLogisticsMultiplier(s10.gameState);
check("speed=1 后勤倍率 == 1.03（Lv.3 基线）", approx(mult1, 1.03, 1e-9), `实际 ${mult1}`);
check("speed=10 后勤倍率 == 10.3（≈10×）", approx(mult10, 10.3, 1e-9), `实际 ${mult10}`);
check("后勤倍率加速比 == 10×", approx(mult10 / mult1, 10, 1e-9), `比=${(mult10 / mult1).toFixed(4)}`);

console.log("== D. 科研加速（processResearchUntil scale 参数）==");
// 经由真实 gameTick 路径：tick.js 调用 processResearchUntil(state, Date.now(), {scale:getGameSpeed()})
for (const s of [s1, s10]) {
  s.gameState.currentAction.active = false; // 隔离采矿分支
  s.gameState.research.activeResearch = { techId: "__smoke__", targetLevel: 1, remainingSeconds: 20000, baseDuration: 20000 };
  s.gameState.research.lastProcessedAt = s.__getNow() - 1000 * 1000; // 真实 elapsed = 1000s
}
const rBefore1 = s1.gameState.research.activeResearch.remainingSeconds;
const rBefore10 = s10.gameState.research.activeResearch.remainingSeconds;
s1.gameTick();
s10.gameTick();
const rConsumed1 = rBefore1 - s1.gameState.research.activeResearch.remainingSeconds;
const rConsumed10 = rBefore10 - s10.gameState.research.activeResearch.remainingSeconds;
check("speed=1 科研进度消耗 = 1000s", approx(rConsumed1, 1000, 1e-6), `实际 ${rConsumed1}`);
check("speed=10 科研进度消耗 = 10000s", approx(rConsumed10, 10000, 1e-6), `实际 ${rConsumed10}`);
check("科研加速比 ≈ 10×", approx(rConsumed10 / rConsumed1, 10, 0.001), `比=${(rConsumed10 / rConsumed1).toFixed(3)}`);

console.log("== E. 冷却实时（增强剂剩余时长不受 speed 影响）==");
// tickBoosterTimers 按真实 elapsed（now - lastTick）扣减 remainingMs，绝不乘 GAME_SPEED。
for (const s of [s1, s10]) {
  s.gameState.skills.mining.lvl = 90;
  s.gameState.currentAction = { active: true, skill: "mining", area: "艾克诺岩带", startedArea: undefined, progress: 0, lastProgressUpdate: s.__getNow(), refDuration: 0, batchRemaining: 0 };
  s.gameState.boosters = { lastTick: s.__getNow(), active: { miningSpeed: { itemId: "booster:smoke", remainingMs: 60000 } } };
}
const T0 = s1.__getNow();
s1.tickBoosterTimers(s1.gameState, T0 + 30000);   // 真实 30s 后
s10.tickBoosterTimers(s10.gameState, T0 + 30000); // 真实 30s 后（同档 speed=10）
const rem1 = s1.gameState.boosters.active.miningSpeed.remainingMs;
const rem10 = s10.gameState.boosters.active.miningSpeed.remainingMs;
check("speed=1 增强剂剩余 30000ms（真实 30s 扣减）", rem1 === 30000, `实际 ${rem1}`);
check("speed=10 增强剂剩余 30000ms（未被 ×10 误加速）", rem10 === 30000, `实际 ${rem10}`);
check("增强剂冷却 speed=1 与 speed=10 完全一致（实时）", rem1 === rem10);
// 继续推进到真实 70s：60000→耗尽，两沙箱均应 depleted（active[slot]=null）
s1.tickBoosterTimers(s1.gameState, T0 + 70000);
s10.tickBoosterTimers(s10.gameState, T0 + 70000);
const dep1 = s1.gameState.boosters.active.miningSpeed === null;
const dep10 = s10.gameState.boosters.active.miningSpeed === null;
check("speed=1 增强剂于真实 70s 耗尽", dep1);
check("speed=10 增强剂于真实 70s 耗尽（与 speed=1 同步）", dep10);

console.log("== F. 代码纯度（速度源仅出现在预期文件）==");
const allowed = new Set(["js/core/speed-config.js", "js/core/tick.js", "js/systems/station.js"]);
const speedIdents = ["gameDeltaSec", "getGameSpeed(", "GAME_SPEED"];
let purityOk = true;
let purityDetail = [];
function walkJs(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}
for (const file of walkJs(path.join(root, "js"), [])) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const src = fs.readFileSync(file, "utf8");
  if (speedIdents.some((id) => src.includes(id))) {
    if (!allowed.has(rel)) { purityOk = false; purityDetail.push(`非预期文件含速度源：${rel}`); }
  }
}
check("速度源仅出现在 speed-config.js / tick.js / station.js", purityOk, purityDetail.join("; "));

console.log("");
if (failures.length === 0) {
  console.log("✅ 十倍速冒烟测试全部通过");
  process.exit(0);
} else {
  console.log(`❌ 十倍速冒烟测试失败 ${failures.length} 项：${failures.join(", ")}`);
  process.exit(1);
}
