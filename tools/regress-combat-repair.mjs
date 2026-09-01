// 回归测试：战斗舰 per-ship 维修模型 + 出击前燃料不足非阻断告警 + 旧档迁移
// 复用 verify.mjs 的 vm 加载范式（sandbox + 逐脚本 runInContext），仅装载逻辑脚本（排除 UI）。
// 覆盖问题1（燃料 warning）与问题2（per-ship repairs）的全部关键场景。
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

// 排除 UI 渲染脚本（与 _diag-combat-dump.mjs 一致），仅装载逻辑层，降低 DOM 依赖。
const UI_EXCLUDE = new Set([
  "js/ui/error-boundary.js", "js/ui/action-modal.js", "js/ui/shell-render.js",
  "js/ui/manufacturing-render.js", "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js", "js/core/runtime.js",
  // 2026-09-01：这两个脚本在加载期就需要真实 DOM 结构（parentNode / insertBefore），
  // 会把整个测试打崩（此前本测试实际一直跑不起来）。逻辑层用不到，一并排除。
  "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js"
]);
const logicSources = scriptSources.filter((s) => !UI_EXCLUDE.has(s));

// ---- sandbox / DOM 模拟（取自 verify.mjs 的已验证可用桩）----
const noop = () => {};
function MockCanvasContext() {}
for (const name of ["arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect", "fillText", "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale", "setTransform", "stroke", "strokeText", "translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560,
  querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop,
  getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1"
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
  // 预置桩，避免任何加载期对未定义全局的引用崩溃（真实模块会在加载时覆盖 GameEvents 等）。
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
const ctx = (expr) => vm.runInContext(expr, sandbox);
const RR = sandbox.ResourceRegistry;
const DGA = sandbox.dispatchGameAction;

// ---- 断言收集 ----
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(msg); } }

// ---- 测试夹具：两艘战斗舰 A/B，均装一把 t1_small_laser（fuelCost 3）----
function mkShip(id, shipId) { return { shipId, instanceId: id, builtAt: 1, fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 }; }
function mkEq(id, itemId) { return { instanceId: id, itemId, enhancementLevel: 0, installedOn: null }; }

function ensureFixture() {
  if (!G.inventory) G.inventory = { ships: [], equipment: { instances: [], inventory: [] }, rigs: [] };
  if (!Array.isArray(G.inventory.ships)) G.inventory.ships = [];
  if (!G.equipment) G.equipment = { inventory: [], instances: [], nextInstanceId: 1 };
  if (!Array.isArray(G.equipment.instances)) G.equipment.instances = [];
  G.inventory.ships = [mkShip("ship_A", "rifter"), mkShip("ship_B", "rifter")];
  G.equipment.instances = [mkEq("eq_A", "t1_small_laser"), mkEq("eq_B", "t1_small_laser")];
  G.inventory.ships[0].fitted.high.push("eq_A");
  G.inventory.ships[1].fitted.high.push("eq_B");
}
function resetCombat() {
  G.combat.repairs = {};
  G.combat.resumeAfterRepair = null;        // 占位（实际字段在顶层）
  G.resumeAfterRepair = null;               // 真正的待恢复标记在顶层 gameState.resumeAfterRepair
  G.combat.active = false;
  G.combat.activeShip = "ship_A";
  G.combat.enemies = [];
  G.combat.currentEnemy = null;
  G.shipAssignments = { combat: "ship_A" };
  RR.set(G, "consumable:fuel", 1000);
  // 抬高战斗技能等级，使所有星带/死亡空间的 level-locked 校验通过（聚焦维修/燃料逻辑本身）
  if (!G.skills) G.skills = {};
  for (const k of ["laserOps", "cannonOps", "missileOperations", "shieldOperation", "armorReinforcement", "hullEngineering"]) {
    G.skills[k] = { lvl: 200, xp: 0 };
  }
}
const NOW = 1_000_000_000_000;

// 场景1：per-ship 维修隔离 — A毁→换B→B毁→两舰各自维修；不同截止；清A不影响B
(function scenario1() {
  ensureFixture(); resetCombat();
  // A 出击并"被毁"（beginRecovery 写 repairs[ship_A]）
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  ok(G.combat.repairs.ship_A === NOW + 180000, "场景1: A被毁后 repairs[ship_A] 写入 now+180000");
  ok(!G.combat.repairs.ship_B, "场景1: 此时不应有 ship_B 维修条目");
  // 换入健康舰 B（per-ship：A维修中仍可换B）
  const swap = DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" });
  ok(swap.changed === true, "场景1: A维修中换入健康舰B应成功");
  ok(G.combat.activeShip === "ship_B", "场景1: 换舰后 activeShip 应为 ship_B");
  ok(G.combat.repairs.ship_A === NOW + 180000, "场景1: 换舰不应触碰 ship_A 的维修条目");
  // B 出击并"被毁"（不同时间点，制造不同截止）
  DGA(G, { type: "combat/beginRecovery" }, NOW + 60000);
  ok(G.combat.repairs.ship_B === NOW + 60000 + 180000, "场景1: B被毁后 repairs[ship_B] 独立写入 (now+60s)+180s");
  ok(G.combat.repairs.ship_A === NOW + 180000, "场景1: 两舰维修条目共存且互不干扰");
  // 时间点 t = A截止+1ms：A应清、B仍在
  sandbox.updateCombatRecovery(NOW + 180000 + 1);
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_A"), "场景1: 越过A截止后A条目被清除");
  ok(G.combat.repairs.ship_B === NOW + 240000, "场景1: 越过A截止时B条目（截止更晚）仍在");
  ok(sandbox.isShipUnderRepair(G, "ship_A", NOW + 180001) === false, "场景1: isShipUnderRepair(A) 在A完成后为false");
  ok(sandbox.isShipUnderRepair(G, "ship_B", NOW + 180001) === true, "场景1: isShipUnderRepair(B) 在B完成前为true");
})();

// 场景2：被维修舰自身拒绝装备/指派；健康舰可正常装备
(function scenario2() {
  ensureFixture(); resetCombat();
  DGA(G, { type: "combat/beginRecovery" }, NOW); // A 维修中，activeShip 仍为 ship_A
  const equipA = DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_A" }, NOW);
  ok(equipA.changed === false && equipA.reason === "repairing", "场景2: 维修中的A再次装备应被拒(reason=repairing)");
  const toggleA = DGA(G, { type: "hangar/toggleAssignment", instanceId: "ship_A", actionKey: "combat" }, NOW);
  ok(toggleA.changed === false && toggleA.reason === "repairing", "场景2: 维修中的A指派战斗应被拒(reason=repairing)");
  const equipB = DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" }, NOW);
  ok(equipB.changed === true, "场景2: 健康舰B装备不受A维修影响，应成功");
})();

// 场景3：finishRecovery 仅结束"当前 active 战斗舰"的维修
(function scenario3() {
  ensureFixture(); resetCombat();
  DGA(G, { type: "combat/beginRecovery" }, NOW);            // A 维修中
  DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" });
  DGA(G, { type: "combat/beginRecovery" }, NOW + 60000);    // B 维修中，activeShip=B
  // 未到截止：拒绝
  const early = DGA(G, { type: "combat/finishRecovery" }, NOW + 60000 + 1);
  ok(early.changed === false && early.reason === "not-due", "场景3: 未到截止 finishRecovery 应被拒(not-due)");
  // 两舰均到截止，finishRecovery 只清 active(B)，保留 A
  const fin = DGA(G, { type: "combat/finishRecovery" }, NOW + 240000 + 1);
  ok(fin.changed === true, "场景3: 到截止 finishRecovery 应成功");
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_B"), "场景3: finishRecovery 清除了 active 舰 B 的维修");
  ok(G.combat.repairs.ship_A === NOW + 180000, "场景3: finishRecovery 不触碰非 active 的 A 维修条目");
})();

// 场景4：出击前燃料不足 → 非阻断 warning（changed:true），足够则不告警；无武器返回 no-weapons
(function scenario4() {
  ensureFixture(); resetCombat();
  // 4a 燃料=0（低于 volleyFuel≈3）→ warning:low-fuel 但出击成功
  RR.set(G, "consumable:fuel", 0);
  const low = DGA(G, { type: "combat/start", enemies: [{ id: "d1", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(low.changed === true, "场景4a: 0燃料出击仍成功(changed=true，非阻断)");
  // 2026-09-01 修正：真实契约是 result.supplyWarning = { ammo, fuel, fuelRounds }，
  // fuel 取值 null|"low"|"none"（不是此前断言的 result.warning === "low-fuel"，该字段从未存在）。
  ok(low.supplyWarning && low.supplyWarning.fuel === "none", "场景4a: 0燃料应返回 supplyWarning.fuel='none'");
  // 4b 燃料充足 → 无告警
  RR.set(G, "consumable:fuel", 1000);
  const okFuel = DGA(G, { type: "combat/start", enemies: [{ id: "d2", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(okFuel.changed === true && okFuel.supplyWarning && okFuel.supplyWarning.fuel == null, "场景4b: 充足燃料出击无燃料告警");
  // 4c 拆掉武器 → 返回 no-weapons（changed:false，不应误报 low-fuel）
  G.inventory.ships[0].fitted.high = [];
  RR.set(G, "consumable:fuel", 0);
  const noW = DGA(G, { type: "combat/start", enemies: [{ id: "d3", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(noW.changed === false && noW.reason === "no-weapons", "场景4c: 无武器返回 no-weapons");
  ok(noW.supplyWarning == null, "场景4c: 无武器不应误报燃料告警（无 supplyWarning）");
})();

// 场景5：存档序列化（JSON 往返）+ 重新迁移，repairs 不丢、幂等
(function scenario5() {
  ensureFixture(); resetCombat();
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" });
  DGA(G, { type: "combat/beginRecovery" }, NOW + 60000);
  const snapshot = JSON.parse(JSON.stringify(G));
  ok(snapshot.combat.repairs.ship_A === NOW + 180000 && snapshot.combat.repairs.ship_B === NOW + 240000,
    "场景5: JSON 序列化保留两舰 repairs");
  // 模拟载入后再跑迁移
  sandbox.migrateCombatEquipmentState();
  ok(G.combat.repairs.ship_A === NOW + 180000 && G.combat.repairs.ship_B === NOW + 240000,
    "场景5: 重新迁移后 repairs 不变（幂等）");
  ok(G.combat.repairUntil === 0 && G.combat.destroyedShip === null, "场景5: 迁移后旧字段 repairUntil/destroyedShip 已清零");
})();

// 场景6：旧档迁移 — repairUntil + destroyedShip → repairs[destroyedShip]，幂等且旧字段清零
(function scenario6() {
  ensureFixture(); resetCombat();
  // 手工构造旧档：A 被毁（全局单槽），B 健康
  G.combat.repairs = {};
  G.combat.repairUntil = NOW + 180000;
  G.combat.destroyedShip = "ship_A";
  G.combat.activeShip = "ship_A";
  sandbox.migrateCombatEquipmentState();
  ok(G.combat.repairs.ship_A === NOW + 180000, "场景6: 旧档 repairUntil+destroyedShip 迁移为 repairs[ship_A]");
  ok(G.combat.repairUntil === 0 && G.combat.destroyedShip === null, "场景6: 迁移后旧字段清零");
  // 幂等：再跑一次，不应多条目、不应改变
  G.combat.repairUntil = NOW + 180000; // 模拟旧字段又被某种历史路径写回
  G.combat.destroyedShip = "ship_A";
  sandbox.migrateCombatEquipmentState();
  ok(Object.keys(G.combat.repairs).length === 1 && G.combat.repairs.ship_A === NOW + 180000,
    "场景6: 幂等——重复迁移不产生重复条目");
})();

// 场景7：死亡空间 — 维修中的 active 舰被拒；换健康舰后允许进入（per-ship）
(function scenario7() {
  ensureFixture(); resetCombat();
  const dsId = ctx("DEATHSPACE_DATABASE[0].id");
  const ticketMat = ctx("DEATHSPACE_DATABASE[0].ticketMaterial");
  const reqCL = ctx("DEATHSPACE_DATABASE[0].requiredCL");
  RR.set(G, "special:" + ticketMat, 5);
  // 提升战斗等级以满足 requiredCL（若需要）
  if (reqCL > 1) { G.skills.combat = { lvl: reqCL, xp: 0 }; }
  // 7a active=A 且 A 维修中 → 拒绝
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  const blocked = DGA(G, { type: "combat/enterDeathspace", deathspaceId: dsId, enemies: [{ id: "e1", hp: 10 }], formationId: "ds_1" }, NOW);
  ok(blocked.changed === false && blocked.reason === "repairing", "场景7a: 维修中的 active 舰进入死亡空间应被拒(repairing)");
  // 7b 换健康舰 B → 允许进入（仅 A 在维修）
  const allow = DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" }, NOW);
  ok(allow.changed === true, "场景7b: 换入健康舰B成功");
  const enter = DGA(G, { type: "combat/enterDeathspace", deathspaceId: dsId, enemies: [{ id: "e2", hp: 10 }], formationId: "ds_1" }, NOW);
  ok(enter.changed === true, "场景7b: 健康舰B可进入死亡空间（A维修不阻塞B）");
})();

// 场景8：燃料告警边界（问题1 二）：volley-1/volley、混合武器部分可负担、全零耗、belt+死亡空间
(function scenario8() {
  // 注入一个"零耗燃料武器"定义，用于 8d（全武器不耗燃料不应误报）。
  ctx("EQUIPMENT_DB['test_zero_fuel_weapon'] = { name:'零耗弹武器', combat:{ kind:'weapon', fuelCost:0, damage:1 } };");

  // 8a / 8b：belt 出击，fuel = volley-1 → 成功 + low-fuel；fuel = volley → 成功无 warning
  ensureFixture(); resetCombat();
  const vf = ctx("computeVolleyFuel(gameState, COMBAT_ZONES[0])");
  ok(vf > 0, "场景8: 单把 t1_small_laser 的 volleyFuel 应 >0（实际 " + vf + "）");
  RR.set(G, "consumable:fuel", vf - 1);
  const low1 = DGA(G, { type: "combat/start", enemies: [{ id: "b1", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(low1.changed === true && low1.supplyWarning && low1.supplyWarning.fuel === "low", "场景8a: fuel=volley-1 出击成功且返回 supplyWarning.fuel='low'（非阻断）");
  // 8b：告警阈值是「≤100 轮满负荷」（见 getCombatSupplyWarning 与 UI 文案
  // “燃料仅够约 N 轮满负荷行动（≤100）”）。fuel=volley 只够约 1 轮，远低于阈值，
  // 因此仍属 low —— 原断言期望「volley 即无告警」是错的边界假设。
  RR.set(G, "consumable:fuel", vf);
  const okVolley = DGA(G, { type: "combat/start", enemies: [{ id: "b2", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(okVolley.changed === true && okVolley.supplyWarning && okVolley.supplyWarning.fuel === "low",
    "场景8b: fuel=volley（约1轮，远低于100轮阈值）仍返回 low");
  // 真正「无告警」要用远超阈值的量（>100 轮）
  RR.set(G, "consumable:fuel", vf * 101);
  const ok1 = DGA(G, { type: "combat/start", enemies: [{ id: "b2b", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(ok1.changed === true && ok1.supplyWarning && ok1.supplyWarning.fuel == null, "场景8b: 燃料充足(>100轮)无燃料告警");

  // 8c：混合武器（两把激光）→ volley=2*vf；fuel 仅够一把 → 仍告警且不阻断
  ensureFixture(); resetCombat();
  const vfSingle = ctx("computeVolleyFuel(gameState, COMBAT_ZONES[0])");
  G.equipment.instances.push(mkEq("eq_C", "t1_small_laser"));
  G.inventory.ships[0].fitted.high.push("eq_C");
  const vfMixed = ctx("computeVolleyFuel(gameState, COMBAT_ZONES[0])");
  ok(vfMixed >= vfSingle * 2 - 0.001, "场景8c: 两把激光 volleyFuel 约为单把两倍（实际 " + vfMixed + "）");
  RR.set(G, "consumable:fuel", vfSingle); // 仅够一把的量
  const mixed = DGA(G, { type: "combat/start", enemies: [{ id: "b3", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(mixed.changed === true && mixed.supplyWarning && mixed.supplyWarning.fuel === "low", "场景8c: 混合武器仅部分可负担，仍返回 supplyWarning.fuel='low' 且不阻断");

  // 8d：全武器不耗燃料 → fuel=0 也不误报
  ensureFixture(); resetCombat();
  G.inventory.ships[0].fitted.high = [];
  G.equipment.instances.push({ instanceId: "eq_Z", itemId: "test_zero_fuel_weapon", enhancementLevel: 0, installedOn: null });
  G.inventory.ships[0].fitted.high.push("eq_Z");
  const vf0 = ctx("computeVolleyFuel(gameState, COMBAT_ZONES[0])");
  ok(vf0 === 0, "场景8d: 全武器不耗燃料时 volleyFuel 应为 0（实际 " + vf0 + "）");
  RR.set(G, "consumable:fuel", 0);
  const z = DGA(G, { type: "combat/start", enemies: [{ id: "b4", hp: 10 }], formationId: "belt_1" }, NOW);
  ok(z.changed === true && z.supplyWarning && z.supplyWarning.fuel == null, "场景8d: 全武器不耗燃料 + fuel=0 不误报燃料告警");

  // 8e：死亡空间同样覆盖 volley-1 / volley
  ensureFixture(); resetCombat();
  const dsId = ctx("DEATHSPACE_DATABASE[0].id");
  const ticketMat = ctx("DEATHSPACE_DATABASE[0].ticketMaterial");
  RR.set(G, "special:" + ticketMat, 5);
  const vfds = ctx("computeVolleyFuel(gameState, COMBAT_ZONES[0])");
  RR.set(G, "consumable:fuel", vfds - 1);
  const dlow = DGA(G, { type: "combat/enterDeathspace", deathspaceId: dsId, enemies: [{ id: "d1", hp: 10 }], formationId: "ds_1" }, NOW);
  ok(dlow.changed === true && dlow.supplyWarning && dlow.supplyWarning.fuel === "low", "场景8e: 死亡空间 fuel=volley-1 返回 supplyWarning.fuel='low' 非阻断告警");
  // 与 8b 同理：volley 量（约1轮）低于 100 轮阈值，仍属 low；无告警需 >100 轮
  RR.set(G, "consumable:fuel", vfds);
  const dokVolley = DGA(G, { type: "combat/enterDeathspace", deathspaceId: dsId, enemies: [{ id: "d2", hp: 10 }], formationId: "ds_1" }, NOW);
  ok(dokVolley.changed === true && dokVolley.supplyWarning && dokVolley.supplyWarning.fuel === "low",
    "场景8e: 死亡空间 fuel=volley（约1轮）仍返回 low");
  RR.set(G, "consumable:fuel", vfds * 101);
  const dok = DGA(G, { type: "combat/enterDeathspace", deathspaceId: dsId, enemies: [{ id: "d3", hp: 10 }], formationId: "ds_1" }, NOW);
  ok(dok.changed === true && dok.supplyWarning && dok.supplyWarning.fuel == null, "场景8e: 死亡空间 燃料充足(>100轮)无燃料告警");
})();

// 场景9：正式存档迁移入口清理非法实例ID/时间戳，幂等，旧字段清零（问题2 三）
(function scenario9() {
  ensureFixture(); resetCombat();
  // 构造同时含合法、非法实例ID、非法时间戳、旧字段的"脏存档"
  G.combat.repairs = {
    ship_A: NOW + 180000,     // 合法
    ghost_ship: NOW + 240000, // 非法实例ID（不在舰队中）
    ship_B: NaN,              // 非法时间戳（非有限数）
    ship_C: 0,                // 非法时间戳(<=0)
    ship_D: -1000             // 非法时间戳(<0)
  };
  G.combat.repairUntil = NOW + 180000;   // 旧字段：ship_A 已存在 → 不应重复写入
  G.combat.destroyedShip = "ship_A";
  sandbox.migrateCombatEquipmentState();
  ok(G.combat.repairs.ship_A === NOW + 180000, "场景9: 合法 repairs[ship_A] 保留");
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ghost_ship"), "场景9: 非法实例ID ghost_ship 被清理");
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_B"), "场景9: 非法时间戳(NaN)被清理");
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_C"), "场景9: 非法时间戳(0)被清理");
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_D"), "场景9: 非法时间戳(<0)被清理");
  ok(G.combat.repairUntil === 0 && G.combat.destroyedShip === null, "场景9: 迁移后旧字段清零");
  ok(Object.keys(G.combat.repairs).length === 1, "场景9: 迁移后仅剩合法条目");
  // 幂等：再跑一次不应改变
  sandbox.migrateCombatEquipmentState();
  ok(Object.keys(G.combat.repairs).length === 1 && G.combat.repairs.ship_A === NOW + 180000, "场景9: 幂等——重复迁移结果不变");
})();

// 场景10：离线返回结算——每舰剩余维修时间按既有规则结算（到期清理、未到期保留剩余）
(function scenario10() {
  ensureFixture(); resetCombat();
  // A 截止 NOW+180000；换B后 B 截止 NOW+120000+180000=NOW+300000；activeShip=B
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" });
  DGA(G, { type: "combat/beginRecovery" }, NOW + 120000);
  ok(sandbox.isShipUnderRepair(G, "ship_A", NOW) === true, "场景10: 离线前 A 维修中");
  ok(sandbox.isShipUnderRepair(G, "ship_B", NOW + 120000) === true, "场景10: 离线前 B 维修中");
  // 离线到 t = NOW+200000：A 已到期(200000>180000)，B 未到期(200000<300000)
  sandbox.updateCombatRecovery(NOW + 200000);
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_A"), "场景10: 离线结算后已到期的 A 被清理");
  ok(G.combat.repairs.ship_B === NOW + 300000, "场景10: 离线结算后未到期的 B 保留");
  ok(sandbox.isShipUnderRepair(G, "ship_B", NOW + 200000) === true, "场景10: B 在结算时刻仍维修中");
  ok(Math.abs((G.combat.repairs.ship_B - (NOW + 200000)) / 1000 - 100) < 1, "场景10: B 剩余维修时间 = 100 秒（既有规则 until-now）");
  // 再推进越过 B 截止 → B 也清理
  sandbox.updateCombatRecovery(NOW + 300001);
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_B"), "场景10: 越过 B 截止后 B 也被清理");
})();

// 场景11：游戏主循环以"无参"方式调用 updateCombatRecovery（combatTick/gameTick 顶部），
// 不得误清维修条目、不得立即触发自动恢复（修复前 now===undefined→isShipUnderRepair 误判到期）。
// 注意：无参路径默认 Date.now()（真实时钟），故 beginRecovery 也必须用真实时钟，二者口径一致。
(function scenario11() {
  ensureFixture(); resetCombat();
  // 2026-09-01 修正夹具：resumeAfterRepair 只在「队列驱动出击」时写入
  // （beginRecovery 注释：手动出击失败不应留下续战意图，否则玩家清空队列后会被重新拉回战斗）。
  // 原夹具未模拟队列驱动，导致标记必然为 null，断言不可能通过。
  G.combat.queueItemId = "q_test_11";
  G.combat.queueWavesTarget = 5;
  G.combat.queueWavesDone = 1;
  const realNow = Date.now();
  DGA(G, { type: "combat/beginRecovery" }, realNow);
  ok(G.combat.repairs.ship_A === realNow + 180000, "场景11: A被毁后 repairs[ship_A] 写入 realNow+180000");
  // 模拟主循环无参调用（最关键：修复前会立即清空并触发自动恢复出击）
  sandbox.updateCombatRecovery();
  ok(G.combat.repairs.ship_A === realNow + 180000, "场景11: 无参 updateCombatRecovery 不得误清维修条目");
  ok(G.combat.active === false, "场景11: 无参调用后战斗仍处于维修态（未立即自动恢复出击）");
  ok(G.resumeAfterRepair !== null, "场景11: 无参调用后待恢复标记仍在（未提前消费）");
  // 连续无参 tick 仍保留
  sandbox.updateCombatRecovery();
  sandbox.updateCombatRecovery();
  ok(G.combat.repairs.ship_A === realNow + 180000, "场景11: 连续无参 tick 维修条目持续保留");
  // 仅越过截止（带参，使用真实时钟+180001）才清 + 消费待恢复标记
  sandbox.updateCombatRecovery(realNow + 180001);
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_A"), "场景11: 越过截止后条目才被清");
  ok(G.resumeAfterRepair === null, "场景11: 越过截止后待恢复标记被消费（自动恢复意图已处理）");
})();

// 场景12：玩家换舰（接管战斗舰）应取消"维修完成后自动出击"待恢复标记（问题2 清理），
// 避免战斗面板长期显示"完成后返回战斗"误导；且 A 到期不得误触发自动恢复。
// 对照：不换舰时 A 到期仍应正常自动恢复（验证清理改动未破坏合法 auto-resume）。
(function scenario12() {
  ensureFixture(); resetCombat();
  // 与场景11 同理：必须是队列驱动出击才会有待恢复标记
  G.combat.queueItemId = "q_test_12";
  G.combat.queueWavesTarget = 5;
  G.combat.queueWavesDone = 1;
  G.combat.activeShip = "ship_A";
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  ok(G.combat.repairs.ship_A === NOW + 180000, "场景12: A被毁 repairs[ship_A]=now+180000");
  ok(G.resumeAfterRepair && G.resumeAfterRepair.type === "combat" && G.resumeAfterRepair.shipInstanceId === "ship_A",
    "场景12: 待恢复标记指向 A");

  // 玩家换入健康舰 B → 待恢复标记应被清
  const swap = DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_B" }, NOW);
  ok(swap.changed === true && G.combat.activeShip === "ship_B", "场景12: 换入 B 成功且 activeShip 切到 B");
  ok(G.resumeAfterRepair === null, "场景12: 换舰后 resumeAfterRepair 被清（不再误导）");

  // A 维修到期：不得 auto-resume（active 已是 B），A 条目清除
  sandbox.updateCombatRecovery(NOW + 180000 + 1);
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_A"), "场景12: A 到期后维修条目清除");
  ok(G.combat.active === false, "场景12: A 到期未自动恢复出击（B 接管，无 auto-resume）");

  // 对照：不换舰，A 到期应正常 auto-resume（确保清理改动未破坏合法路径）
  ensureFixture(); resetCombat();
  // 与场景11/12 同理：auto-resume 依赖「队列驱动出击」留下的待恢复标记。
  // 且 tryResumeCombatAfterRepair 会到 queue.items 里按 id 查找该队列项、
  // 并要求 queue.status.isRunning === true，故必须构造真实队列项（否则续战被拒）。
  G.combat.queueItemId = "q_test_12c";
  G.combat.queueWavesTarget = 5;
  G.combat.queueWavesDone = 1;
  // 增量修改：保留 G.queue 原有字段（maxSize 等），整体替换会破坏后续场景（如场景14 的 queue/add）
  if (!G.queue) G.queue = { items: [], status: {} };
  if (!Array.isArray(G.queue.items)) G.queue.items = [];
  G.queue.items = [{ id: "q_test_12c", skill: "combat", target: ctx("COMBAT_ZONES[0].id"), label: "战斗", count: 5 }];
  G.queue.status = Object.assign({}, G.queue.status, { isRunning: true, activeIndex: 0, completedCount: 0, failCount: 0 });
  G.skills.combat = { lvl: 999 }; // 确保星带等级解锁，auto-resume 的 combat/start 能成功
  // 续战要回到来源星带（beginRecovery 的 returnZoneId 取自 combat.zone），
  // 缺 zone 会导致 auto-resume 的 combat/start 找不到目标而失败。
  G.combat.zone = ctx("COMBAT_ZONES[0].id");
  G.combat.activeShip = "ship_A";
  DGA(G, { type: "combat/beginRecovery" }, NOW);
  sandbox.updateCombatRecovery(NOW + 180000 + 1);
  ok(!Object.prototype.hasOwnProperty.call(G.combat.repairs, "ship_A"), "场景12(对照): 不换舰时 A 到期条目清除");
  ok(G.combat.active === true, "场景12(对照): 不换舰时 A 到期正常自动恢复出击");
})();


// 场景13：新存档空库存 + 无 activeShip（玩家无拥有战斗舰）时，战斗页不应显示幽灵舰（星矛级），
// 而应显示"未装备战斗舰"、禁用开战并提示去机库指派；逻辑层 getActiveShip 返回 null（不凭空造舰）。
(function scenario13() {
  ensureFixture(); resetCombat();
  // 模拟"新存档"：清空所有拥有舰与战斗指派
  G.inventory.ships = [];
  G.combat.activeShip = null;
  if (G.shipAssignments) G.shipAssignments.combat = null;
  G.combat.active = false;

  // 逻辑层：不应凭空造舰
  ok(ctx("getActiveShip()") === null, "场景13: 空库存+无指派时 getActiveShip 返回 null（不造幽灵舰）");

  // 显示层：getCombatDisplayState 的 player 必须反映"无舰"
  const disp = ctx("getCombatDisplayState(gameState, 1234567890000)");
  ok(disp.player.hasShip === false, "场景13: 显示层 player.hasShip === false");
  ok(disp.player.name === "未装备战斗舰", "场景13: 显示层玩家舰名 = '未装备战斗舰'（非星矛级幽灵）");
  ok(disp.player.instanceId === null, "场景13: 显示层玩家 instanceId === null");
  ok(disp.player.image === "", "场景13: 显示层玩家 image 为空（走占位符）");
  ok(disp.controls.startDisabled === true, "场景13: 无舰时开战按钮禁用");
  ok(disp.controls.startText === "请先在机库指派战斗舰", "场景13: 无舰时开战提示 = '请先在机库指派战斗舰'");

  // 对照：装备一艘真实舰后，显示层应恢复真实舰名、可开战
  ensureFixture(); resetCombat();
  DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_A" });
  const disp2 = ctx("getCombatDisplayState(gameState, 1234567890000)");
  ok(disp2.player.hasShip === true, "场景13(对照): 装备真实舰后 hasShip === true");
  ok(disp2.player.name === "星矛级", "场景13(对照): 装备真实舰后显示真实舰名 星矛级");
  ok(disp2.player.instanceId === "ship_A", "场景13(对照): 装备真实舰后 instanceId === ship_A");
})();

// 场景14：战斗中启动采矿（用户复现：点采矿→开始采矿走队列），必须自动停止战斗，
//         否则 currentAction.skill 改走后 combatTick 不再驱动、combat.active 残留 → 战斗冻结。
//         修复落点：executeQueueItemForState 常规技能分支（actions.js）启动非战斗 action 前先收尾战斗。
(function scenario14() {
  ensureFixture(); resetCombat();
  // 重置队列：场景12(对照)遗留的战斗队列项（isRunning=true/activeIndex=0）会让
  // 本场景的 queue/start 先去执行那个战斗项而不是采矿，必须清干净。
  if (G.queue) { G.queue.items = []; G.queue.status = Object.assign({}, G.queue.status, { isRunning: false, activeIndex: -1, completedCount: 0, failCount: 0 }); }
  DGA(G, { type: "hangar/equipCombatShip", instanceId: "ship_A" });
  // 模拟战斗中（专注"战斗中启动其他 action"的收尾逻辑，不依赖 combat/start 诸多门槛）
  G.combat.active = true;
  G.combat.enemies = [{ id:"e1", type:"frigate", kind:"normal", name:"测试敌", icon:"", hp:{shield:10,armor:10,structure:10}, maxHp:{shield:10,armor:10,structure:10}, level:1, hit:0.5, dodge:0.2, baseDamage:1, iskDrop:0, xpDrop:1, image:"", defeated:false, rewarded:false }];
  G.combat.currentEnemy = G.combat.enemies[0];
  G.combat.lastStatus = "交战中";
  G.currentAction.skill = "combat";
  G.currentAction.active = true;
  G.resumeAfterRepair = { type:"combat", shipInstanceId:"ship_A" };

  ok(G.combat.active === true, "场景14: 前置——战斗进行中（combat.active=true）");

  // 复现用户操作：队列加采矿 + 启动（executeQueueItemForState 常规技能分支应自动停战斗）
  DGA(G, { type: "queue/add", item:{ skill:"mining", target:"凡晶石带", label:"凡晶石带" } }, NOW);
  DGA(G, { type: "queue/start" }, NOW);

  ok(G.combat.active === false, "场景14: 启动采矿后战斗被自动停止（不再冻结）");
  ok(G.combat.enemies.length === 0 && G.combat.currentEnemy === null, "场景14: 战斗状态已清空（enemies/currentEnemy 为初始）");
  ok(G.currentAction.skill === "mining" && G.currentAction.active === true, "场景14: 当前行动已切到采矿");
  ok(G.resumeAfterRepair === null, "场景14: 待恢复标记已清（避免误导自动恢复）");
})();

// ---- 汇总 ----
console.log("========================================");
console.log(`战斗维修/燃料回归测试：通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) {
  console.log("失败明细：");
  for (const f of fails) console.log("  ✗ " + f);
}
console.log("========================================");
process.exit(fail > 0 ? 1 : 0);
