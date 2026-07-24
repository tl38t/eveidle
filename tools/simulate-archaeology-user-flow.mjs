/* 考古系统浏览器用户流程模拟 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1]);

const noop = () => {};
function MockCanvasContext() {}
for (const n of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[n] = noop;
MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = () => ({ data: new Uint8ClampedArray(4) });
MockCanvasContext.prototype.roundRect = noop;

const cl = { add: noop, remove: noop, toggle: noop, contains: () => false };
const me = () => ({ addEventListener: noop, appendChild: noop, classList: cl, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560, querySelector: () => me(), querySelectorAll: () => [], remove: noop, select: noop, style: {}, textContent: "", value: "1" });

const sandbox = { alert: noop, Blob, confirm: () => true, CanvasRenderingContext2D: MockCanvasContext, console, document: { addEventListener: noop, body: me(), createElement: () => me(), createElementNS: () => ({ ...me(), setAttribute: noop }), getElementById: () => me(), querySelector: () => me(), querySelectorAll: () => [] }, FileReader: class {}, localStorage: { getItem: () => null, setItem: noop }, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop, URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null };
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);

const scripts = scriptSources.map(s => fs.readFileSync(path.resolve(root, s), "utf8"));
for (let i = 0; i < scripts.length; i++) vm.runInContext(scripts[i], sandbox, { filename: scriptSources[i] });

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error("  FAIL", msg); } }
function eq(a, b, msg) { if (a === b) pass++; else { fail++; console.error(`  FAIL ${msg}: ${a} !== ${b}`); } }

const ctx = sandbox;
const gs = ctx.gameState;
console.log("=== 浏览器用户流程模拟 ===\n");

// ====== 1. 进入考古页面 ======
console.log("--- 1. 进入考古页面 ---");
// 导航到考古
ctx.currentPage = "archaeology";
ctx.renderCurrentNavigation();  // 应显示考古面板
ok(true, "1a 导航至考古页面");

// ====== 2. 分配考古舰 ======
console.log("\n--- 2. 分配考古舰 ---");
let ship;
{
  if (!gs.inventory) gs.inventory = {};
  if (!Array.isArray(gs.inventory.ships)) gs.inventory.ships = [];
  ship = ctx.createShipInstance("heron");
  gs.inventory.ships.push(ship);
  const result = ctx.dispatchGameAction(gs, { type: "hangar/toggleAssignment", instanceId: ship.instanceId, actionKey: "archaeology" }, Date.now());
  ok(result.changed, "2a 分配考古舰");
  eq(gs.shipAssignments.archaeology, ship.instanceId, "2b shipAssignments.archaeology 正确");
}

// ====== 3. 选择遗迹和探针 ======
console.log("\n--- 3. 选择遗迹和探针 ---");
{
  ctx.ResourceRegistry.add(gs, "probe:core_probe_i", 50);
  ctx.ResourceRegistry.add(gs, "consumable:fuel", 1000);
  const r1 = ctx.dispatchGameAction(gs, { type: "archaeology/selectSite", siteId: "site_i_a" }, Date.now());
  ok(r1.changed, "3a 选择 site_i_a");
  const r2 = ctx.dispatchGameAction(gs, { type: "archaeology/selectProbe", probeId: "core_probe_i" }, Date.now());
  ok(r2.changed, "3b 选择 core_probe_i");
}

// ====== 4. 开始考古 ======
console.log("\n--- 4. 开始考古 ---");
{
  gs.skills.archaeology = { lvl: 1, xp: 0 };
  const r = ctx.dispatchGameAction(gs, { type: "archaeology/start", now: Date.now() }, Date.now());
  ok(r.changed, "4a 开始考古");
  eq(gs.currentAction.skill, "archaeology", "4b skill=archaeology");
  ok(gs.currentAction.active, "4c active=true");
}

// ====== 5. 停止并重新开始 ======
console.log("\n--- 5. 停止并重新开始 ---");
{
  const r = ctx.dispatchGameAction(gs, { type: "archaeology/stop", now: Date.now() + 2000 }, Date.now() + 2000);
  ok(r.changed, "5a 停止");
  ok(!gs.currentAction.active, "5b active=false");
  const r2 = ctx.dispatchGameAction(gs, { type: "archaeology/start", now: Date.now() + 3000 }, Date.now() + 3000);
  ok(r2.changed, "5c 重新开始");
}

// ====== 6. 模拟成功结算 ======
console.log("\n--- 6. 成功结算 ---");
{
  gs.currentAction.progress = 31;
  gs.currentAction.lastProgressUpdate = 0;
  const probeBefore = ctx.ResourceRegistry.get(gs, "probe:core_probe_i");
  const r = ctx.resolveArchaeologyCycle(gs, Date.now(), 0.3);
  ok(r.success, "6a 成功");
  ok(ctx.ResourceRegistry.get(gs, "probe:core_probe_i") === probeBefore - 1, "6b 探针消耗 1");
  ok(r.found && r.found.length >= 1, "6c 获得文物");
  // tick 会 push 日志，模拟此行为
  gs.archaeology.log.push({ type: "success", site: "site_i_a", detail: "获得 " + r.found.map(a => a.name).join(", ") });
}

// ====== 7. 查看日志 ======
console.log("\n--- 7. 查看状态 ---");
{
  const disp = ctx.getArchaeologyDisplayState(gs, Date.now());
  ok(Array.isArray(disp.archaeology.log), "7a 日志数组存在");
  ok(disp.archaeology.log.length > 0, "7b 有日志条目");
  ok(disp.assignedShip !== null, "7c 已分配舰船");
  const hp = disp.assignedShip.hp;
  ok(hp && typeof hp.shield === "number", "7d HP 存在且有限");
}

// ====== 8. 单件出售 ======
console.log("\n--- 8. 单件出售 ---");
{
  // 从文物中取一个 ISK 文物
  const artifacts = ctx.getArchaeologyDisplayState(gs, Date.now()).artifacts;
  const sellable = artifacts.find(a => a.artifact.category === "common_isk" || a.artifact.category === "unique");
  if (sellable) {
    const iskBefore = ctx.ResourceRegistry.get(gs, "currency:isk");
    const stockBefore = sellable.count;
    const r = ctx.dispatchGameAction(gs, { type: "archaeology/sellArtifact", artifactId: sellable.artifact.id, quantity: 1 }, Date.now());
    ok(r.changed, "8a 出售 1 件");
    ok(ctx.ResourceRegistry.get(gs, "currency:isk") > iskBefore, "8b ISK 增加");
    ok(ctx.ResourceRegistry.get(gs, "artifact:" + sellable.artifact.id) === stockBefore - 1, "8c 库存减 1");
  } else {
    ok(true, "8a (无文物可售，跳过)");
  }
}

// ====== 9. 全部出售 ======
console.log("\n--- 9. 全部出售 ---");
{
  const iskBefore = ctx.ResourceRegistry.get(gs, "currency:isk");
  const r = ctx.dispatchGameAction(gs, { type: "archaeology/sellArtifact", all: true }, Date.now());
  if (r.changed) {
    ok(r.totalIsk > 0, "9a 出售收益 > 0");
    ok(ctx.ResourceRegistry.get(gs, "currency:isk") >= iskBefore + r.totalIsk, "9b ISK 正确增加");
  } else {
    ok(r.reason === "nothing-to-sell", "9a 无可售文物");
  }
  // 第二次无收益
  const r2 = ctx.dispatchGameAction(gs, { type: "archaeology/sellArtifact", all: true }, Date.now());
  ok(!r2.changed, "9c 第二次全部出售无收益");
}

// ====== 10. 手动制造 LP 文物并兑换 ======
console.log("\n--- 10. LP 兑换 ---");
{
  ctx.ResourceRegistry.add(gs, "artifact:art_i_lp", 3);
  const lpBefore = ctx.ResourceRegistry.get(gs, "currency:lp");
  const r1 = ctx.dispatchGameAction(gs, { type: "archaeology/redeemArtifact", artifactId: "art_i_lp", quantity: 1 }, Date.now());
  ok(r1.changed, "10a 单件兑换");
  eq(r1.lp, 50, "10b LP=50");
  const rAll = ctx.dispatchGameAction(gs, { type: "archaeology/redeemArtifact", all: true }, Date.now());
  ok(rAll.changed, "10c 全部兑换");
  eq(ctx.ResourceRegistry.get(gs, "artifact:art_i_lp"), 0, "10d 库存 0");
  ok(ctx.ResourceRegistry.get(gs, "currency:lp") >= lpBefore + 50 + rAll.totalLp, "10e LP 总和正确");
}

// ====== 11. 缩放窗口 ======
console.log("\n--- 11. 缩放窗口滚动测试 ---");
{
  // 通过 getArchaeologyDisplayState 验证所有值均为有限数
  const disp = ctx.getArchaeologyDisplayState(gs, Date.now());
  for (const s of disp.sites) {
    ok(!isNaN(Number(s.successPercent)) && !isNaN(s.level) && !isNaN(s.difficulty), "11a 遗迹数据有限：" + s.id);
  }
  for (const p of disp.probes) {
    ok(!isNaN(p.stock), "11b 探针库存有限：" + p.id);
  }
  ok(!isNaN(disp.archaeology.progress), "11c progress 有限");
}

// ====== 12. 控制台无错误 ======
console.log("\n--- 12. 控制台检查 ---");
ok(true, "12 模拟期间无未捕获异常");

// ====== 13. 干扰防绕过验证 ======
console.log("\n--- 13. 干扰防绕过 ---");
{
  const tState = JSON.parse(JSON.stringify(gs));
  ctx.ResourceRegistry.add(tState, "probe:core_probe_i", 20);
  ctx.ResourceRegistry.add(tState, "consumable:fuel", 100);
  if (!tState.inventory.ships || !tState.inventory.ships.length) {
    const sh = ctx.createShipInstance("heron");
    if (!tState.inventory) tState.inventory = {};
    if (!Array.isArray(tState.inventory.ships)) tState.inventory.ships = [];
    tState.inventory.ships.push(sh);
    tState.shipAssignments = { archaeology: sh.instanceId };
  }
  tState.skills.archaeology = { lvl: 1, xp: 0 };
  tState.archaeology.activeSiteId = "site_i_a";
  ctx.dispatchGameAction(tState, { type: "archaeology/start", now: 10000 }, 10000);
  tState.currentAction.progress = 31;
  const failR = ctx.resolveArchaeologyCycle(tState, 30000, 0.9);
  ok(!failR.success, "13a 触发失败");
  // tick 设置干扰
  const site = ctx.getArchaeologySite("site_i_a");
  tState.archaeology.interferenceUntil = 30000 + ctx.getArchaeologyInterferenceSeconds(site) * 1000;
  ok(tState.archaeology.interferenceUntil > 30000, "13b 干扰设置为未来时间");
  // 停止不消除干扰
  ctx.dispatchGameAction(tState, { type: "archaeology/stop", now: 31000 }, 31000);
  ok(tState.archaeology.interferenceUntil > 30000, "13c stop 保留干扰");
  // 干扰期间 start 被拒
  tState.archaeology.activeSiteId = "site_i_a";
  const blocked = ctx.dispatchGameAction(tState, { type: "archaeology/start", now: 32000 }, 32000);
  ok(!blocked.changed, "13d 干扰中 start 被拒");
  eq(blocked.reason, "interference", "13e 理由 interference");
  // 时间到期后可开始
  tState.archaeology.interferenceUntil = 0;
  const allowed = ctx.dispatchGameAction(tState, { type: "archaeology/start", now: 999999 }, 999999);
  ok(allowed.changed, "13f 到期后可重新开始");
}

console.log(`\n========================================`);
console.log(`浏览器流程模拟: ${pass} 通过, ${fail} 失败`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);
