// 回归测试：战斗结束的 4 条路径必须一致地处理队列状态（2026-09-01）
//
// 背景：战斗结束有 4 条路径，原先各清各的导致行为分叉 ——
//   queue.status.isRunning 只在 stop() 里清了，被击毁（beginRecovery）漏清。
//   漏清后，切页触发离线结算时 offline.js settleOfflineActions 会因
//   (isRunning && items.length && !currentAction.active) 重新执行该队列项，
//   而舰正在 180s 维修中、启动校验失败，队列便永久卡在「执行中」。
//   现在统一走 endCombatSession(state, reason, opts)，其中：
//     pauseQueue=true（默认）—— 主动停止 / 被击毁 / 战斗中换舰：队列项已中断，必须暂停队列
//     pauseQueue=false       —— 队列正常切换下一项：队列必须继续跑，绝不能清
//
// 退出码：全部通过 EXIT 0；任一断言失败 EXIT 1。
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
  // 以下两个在加载期就需要真实 DOM 结构（parentNode / insertBefore），逻辑测试用不上
  "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js"
]);
const logicSources = scriptSources.filter((s) => !UI_EXCLUDE.has(s));

const noop = () => {};
function MockCanvasContext() {}
for (const name of ["arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect", "fillText", "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale", "setTransform", "stroke", "strokeText", "translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, insertAdjacentHTML: noop,
  replaceChildren: noop, removeChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
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
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
  matchMedia: () => ({ matches: false, media: "", onchange: null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, dispatchEvent: noop }),
  GameEvents: { emit: noop, on: () => () => {}, once: noop, contracts: { has: () => true, validate: () => ({ valid: true, registered: true }) }, listenerCount: () => 0 },
  RuntimeGuard: { report: noop, runCritical: () => ({ ok: true }), resume: () => true, isPaused: () => false, runRecoverable: () => ({ ok: true }) },
  window: null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
sandbox.addEventListener = noop;
sandbox.removeEventListener = noop;
sandbox.dispatchEvent = noop;
sandbox.location = { href: "", search: "", hash: "" };
sandbox.navigator = { userAgent: "node" };
sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
sandbox.updateUI = noop; sandbox.switchPage = noop; sandbox.currentPage = "";
sandbox.updateLiveUI = noop; sandbox.refreshVisiblePanelAfterAction = noop;
sandbox.playAttackFX = noop; sandbox.playEnemyAttackFX = noop;

vm.createContext(sandbox);
for (const src of logicSources) {
  const full = path.resolve(ROOT, src);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full)) throw new Error("本地脚本缺失：" + src);
  vm.runInContext(fs.readFileSync(full, "utf8"), sandbox, { filename: src });
}

const G = sandbox.gameState;
const DGA = sandbox.dispatchGameAction;
const RR = sandbox.ResourceRegistry;
const NOW = 1_000_000_000_000;

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  PASS " + msg); }
  else { fail++; fails.push(msg); console.log("  FAIL " + msg); }
}

// ---- 夹具：两艘战斗舰 A/B，各装一把 t1_small_laser ----
function mkShip(id, shipId) { return { shipId, instanceId: id, builtAt: 1, fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 }; }
function mkEq(id, itemId) { return { instanceId: id, itemId, enhancementLevel: 0, installedOn: null }; }
function ensureShips() {
  if (!G.inventory) G.inventory = { ships: [], equipment: { instances: [], inventory: [] }, rigs: [] };
  if (!Array.isArray(G.inventory.ships)) G.inventory.ships = [];
  if (!G.equipment) G.equipment = { inventory: [], instances: [], nextInstanceId: 1 };
  if (!Array.isArray(G.equipment.instances)) G.equipment.instances = [];
  G.inventory.ships = [mkShip("ship_A", "rifter"), mkShip("ship_B", "rifter")];
  G.equipment.instances = [mkEq("eq_A", "t1_small_laser"), mkEq("eq_B", "t1_small_laser")];
  G.inventory.ships[0].fitted.high.push("eq_A");
  G.inventory.ships[1].fitted.high.push("eq_B");
  if (!G.skills) G.skills = {};
  for (const k of ["laserOps", "cannonOps", "missileOperations", "shieldOperation", "armorReinforcement", "hullEngineering"]) {
    G.skills[k] = { lvl: 200, xp: 0 };
  }
}

const ctx = (expr) => vm.runInContext(expr, sandbox);

// 构造「队列驱动 + 战斗进行中」的现场
function armQueueCombat() {
  ensureShips();
  G.combat.repairs = {};
  G.resumeAfterRepair = null;
  // 抬高战斗相关技能等级，使星带 level-locked 校验通过（否则续战的 combat/start 会失败）
  if (!G.skills) G.skills = {};
  G.skills.combat = { lvl: 999, xp: 0 };
  for (const k of ["laserOps", "cannonOps", "missileOperations", "shieldOperation", "armorReinforcement", "hullEngineering"]) {
    G.skills[k] = { lvl: 200, xp: 0 };
  }
  // 用真实存在的星带 id（写死 id 会因找不到 zone 导致续战失败）
  const zoneId = ctx("COMBAT_ZONES[0].id");
  G.combat.active = true;
  G.combat.activeShip = "ship_A";
  G.combat.mode = "belt";
  G.combat.zone = zoneId;
  G.combat.enemies = [{ id: "e1", hp: 10 }];
  G.combat.currentEnemy = { id: "e1", hp: 10 };
  G.combat.queueItemId = "q1";
  G.combat.queueWavesTarget = 5;
  G.combat.queueWavesDone = 2;
  G.combat.queueEntriesTarget = 0;
  G.combat.queueEntriesDone = 0;
  G.shipAssignments = { combat: "ship_A" };
  G.currentAction = { skill: "combat", active: true, batchRemaining: 3, startedAt: NOW };
  G.queue = {
    items: [
      { id: "q1", skill: "combat", target: zoneId, label: "战斗", count: 5 },
      { id: "q2", skill: "mining", target: "ore_veldspar", label: "采矿", count: 5 }
    ],
    status: { isRunning: true, activeIndex: 0, completedCount: 0, failCount: 0 }
  };
  RR.set(G, "consumable:fuel", 1000);
  return G;
}

console.log("\n=== 1) 主动停止 stop() —— 必须暂停队列 ===");
{
  armQueueCombat();
  const r = DGA(G, { type: "combat/stop" }, NOW);
  ok(r.changed === true, "stop: action 返回 changed");
  ok(G.queue.status.isRunning === false, "stop: queue.status.isRunning 已清为 false");
  ok(G.queue.status.activeIndex === -1, "stop: queue.status.activeIndex 已清为 -1");
  ok(G.combat.active === false, "stop: combat.active 为 false");
}

console.log("\n=== 2) 被击毁 beginRecovery() —— 队列保持运行，靠待恢复标记阻止重启 ===");
{
  armQueueCombat();
  const r = DGA(G, { type: "combat/beginRecovery" }, NOW);
  ok(r.changed === true, "beginRecovery: action 返回 changed");
  // 注意：被击毁时队列不能清！isRunning=true 是维修后自动续战的前提
  // （tryResumeCombatAfterRepair 要求 isRunning===true 才续战）。
  // 防重启改由 settleOfflineActions 判断 resumeAfterRepair 实现。
  ok(G.queue.status.isRunning === true, "beginRecovery: 队列保持运行（等待维修后续战，不可清）");
  ok(G.queue.status.activeIndex === 0, "beginRecovery: activeIndex 保持在队列项 0");
  ok(G.combat.active === false, "beginRecovery: combat.active 为 false");
  ok(G.combat.repairs && G.combat.repairs.ship_A === NOW + 180000, "beginRecovery: 已写入 180s 维修");
  ok(G.resumeAfterRepair && G.resumeAfterRepair.type === "combat", "beginRecovery: 保留续战标记");
  ok(G.resumeAfterRepair.queueWavesTarget === 5 && G.resumeAfterRepair.queueWavesDone === 2,
    "beginRecovery: 队列波次进度带进续战标记（未被统一清理抹掉）");
}

console.log("\n=== 3) 战斗中换舰 equipCombatShip() —— 必须暂停队列 ===");
{
  armQueueCombat();
  const r = DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" }, NOW);
  ok(r.changed === true, "ship-swap(战斗中): 换舰成功");
  ok(G.queue.status.isRunning === false, "ship-swap(战斗中): queue.status.isRunning 已清为 false");
  ok(G.combat.active === false, "ship-swap(战斗中): combat.active 为 false");
}

console.log("\n=== 4) 非战斗状态换舰 —— 绝不能误停正在跑的队列 ===");
{
  armQueueCombat();
  G.combat.active = false;                 // 非战斗状态
  G.currentAction = { skill: "mining", active: false, batchRemaining: 0, startedAt: NOW };
  G.queue.status.activeIndex = 1;          // 队列正在跑第 2 项（采矿）
  const r = DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" }, NOW);
  ok(r.changed === true, "ship-swap(非战斗): 换舰成功");
  ok(G.queue.status.isRunning === true, "ship-swap(非战斗): 队列仍在运行（未被误停）");
  ok(G.queue.status.activeIndex === 1, "ship-swap(非战斗): activeIndex 保持不变");
}

console.log("\n=== 5) 端到端：被击毁后触发离线结算，战斗不得被重启 ===");
{
  armQueueCombat();
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  // 记录结算前状态
  const before = { running: G.queue.status.isRunning, active: G.combat.active };
  // 模拟切页 / 重进触发的离线结算
  let settled = "n/a";
  if (typeof sandbox.settleOfflineActions === "function") {
    sandbox.settleOfflineActions(60, {});
    settled = "called";
  }
  ok(G.combat.active === false, "离线结算后: 战斗未被重启（combat.active 仍 false）");
  ok(G.resumeAfterRepair && G.resumeAfterRepair.type === "combat", "离线结算后: 待恢复标记仍在（未被提前消费）");
  ok(G.queue.status.isRunning === true, "离线结算后: 队列仍标记为运行中（等待维修）");
  console.log("    (settleOfflineActions: " + settled + ")");
}

console.log("\n=== 6) 维修到期后必须能自动续战（防止修复把续战一起打断）===");
{
  armQueueCombat();
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  ok(G.resumeAfterRepair && G.resumeAfterRepair.queueItemId === "q1", "续战: 待恢复标记指向队列项 q1");
  if (typeof sandbox.updateCombatRecovery === "function") {
    sandbox.updateCombatRecovery(NOW + 180001);
  }
  ok(G.combat.active === true, "续战: 维修到期后战斗自动恢复（combat.active 回到 true）");
  ok(G.combat.queueItemId === "q1", "续战: 队列项 id 恢复为 q1");
  ok(G.combat.queueWavesDone === 2, "续战: 波次进度跨维修保留（queueWavesDone=2）");
}

console.log("\n========================================");
console.log("战斗结束路径 × 队列状态一致性回归测试");
console.log("PASS = " + pass + "  FAIL = " + fail + "  TOTAL = " + (pass + fail));
console.log("========================================");
if (fail) { console.log("失败项："); fails.forEach(f => console.log("  - " + f)); }
process.exit(fail === 0 ? 0 : 1);
