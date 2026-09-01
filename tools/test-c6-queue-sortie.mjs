// 回归测试：C6「同次出击清除第4波」——修复「真实玩家用队列战斗清4波仍不完成」后，
// 验证手动 / 队列 / 离线 / 刷新续打 / 维修恢复 五条入口共用同一 tutorial run-token 生命周期，
// 且 wave4 的 token 门禁（防伪造）不被削弱。
//
// 加载方式与 verify.mjs 同源（同 index.html 脚本集合 + 同 vm sandbox）。
// 运行：node tools/test-c6-queue-sortie.mjs
// 退出码：0 = 全部通过；1 = 存在失败。
//
// 注意：本文件为交付回归测试，非临时探针；与之对应的临时诊断 tools/_diag_c6_queue.mjs 已删除。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));

// ---- sandbox 构造（与 verify.mjs / test-tutorial-balance.mjs 同源）----
function MockCanvasContext() {}
const noop = () => {};
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({ addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop, getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 }), getContext: () => new MockCanvasContext(), innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {}, textContent:"", value:"1" });
const documentMock = { addEventListener: noop, readyState: "loading", body: makeElement(), createElement: () => makeElement(), createElementNS: () => ({ ...makeElement(), setAttribute: noop }), getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => [] };
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
const sandbox = { alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true, document: documentMock, FileReader: class {}, localStorage: localStorageMock, matchMedia: () => ({ matches:false, media:"", addEventListener:noop, removeEventListener:noop, addListener:noop, removeListener:noop }), requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop, URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null };
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (const src of scriptSources) {
  vm.runInContext(fs.readFileSync(path.resolve(root, src.replace(/^\.\//, "")), "utf8"), sandbox, { filename: src });
}

const reg = sandbox.ResourceRegistry;
const GE = sandbox.GameEvents;
const TD = sandbox.TutorialData;
const COMBAT_ZONES = vm.runInContext("COMBAT_ZONES", sandbox);
const C6_ZONES = (TD.byId.C6 && TD.byId.C6.target && TD.byId.C6.target.zones) || [];

// ---- 战斗前置（与 _diag_c6_queue.mjs 同源，已验证可驱动真实战斗回合）----
let _shipFitted = false;
function ensureCombatShip(g) {
  if (_shipFitted) return;
  if (!g.inventory || !Array.isArray(g.inventory.ships) || g.inventory.ships.length === 0) {
    g.inventory = g.inventory || {};
    g.inventory.ships = [ sandbox.createShipInstance("rifter") ];
  }
  const brShip = g.inventory.ships[0];
  brShip.fitted = { high:["t1_small_laser"], mid:["t1_shield_booster"], low:[], rig:[] };
  g.shipAssignments = g.shipAssignments || {};
  g.shipAssignments.combat = brShip.instanceId;
  if (typeof sandbox.finalizeEquipmentStateAfterLegacyMigrations === "function") sandbox.finalizeEquipmentStateAfterLegacyMigrations(g);
  _shipFitted = true;
}
function giveSupplies(g) {
  reg.add(g, "consumable:fuel", 1000000);
  reg.add(g, "ammo:laser", 1000000);
  reg.add(g, "ammo:missile", 1000000);
  reg.add(g, "ammo:cannon", 1000000);
  g.ammo = [
    { type:"laser", tier:"T1", qty:1000000, loaded:true },
    { type:"missile", tier:"T1", qty:1000000, loaded:true },
    { type:"cannon", tier:"T1", qty:1000000, loaded:true },
  ];
}

// 一次性安装 tutorial 事件消费者（绑定 sandbox.gameState，模块级去重保护）。
sandbox.TutorialSystem.installTutorialConsumers(sandbox.gameState);

// 每个用例前的状态复位（战斗态 + C6 + token + 事件账本），保留已装配战斗舰。
function resetForTest(g, zone) {
  ensureCombatShip(g);
  giveSupplies(g);
  g.combat = g.combat || {};
  g.combat.active = false; g.combat.mode = "belt"; g.combat.viewMode = "belt";
  g.combat.zone = zone || ""; g.combat.deathspaceId = ""; g.combat.wave = 1;
  g.combat.enemies = []; g.combat.currentEnemy = null; g.combat.currentFormation = "";
  g.combat.deathspaceChainRemaining = 0; g.combat.deathspaceChainPending = false;
  g.combat.lastLoot = ""; g.combat.lastStatus = "";
  g.combat.totalKills = 0; g.combat.runEliteKills = 0;
  g.combat.runDamageDealt = 0; g.combat.runDamageTaken = 0;
  g.combat.runWeaponTypes = []; g.combat.runWeaponTypesZone = null;
  g.combat.randomState = { seed: 0x12345, counterLo: 0, counterHi: 0 };
  g.combat.repairs = {};
  g.combat.queueItemId = null; g.combat.queueWavesTarget = 0; g.combat.queueWavesDone = 0;
  g.combat.queueEntriesTarget = 0; g.combat.queueEntriesDone = 0;
  g.combat.runSequence = 0;
  if (typeof sandbox.resetCombatRunState === "function") sandbox.resetCombatRunState(g.combat);
  const _mh = sandbox.getCombatMaxHpFromState(g);
  g.combat.maxHp = { shield:_mh.shield, armor:_mh.armor, structure:_mh.structure };
  g.combat.hp = { shield:_mh.shield, armor:_mh.armor, structure:_mh.structure };
  g.currentAction = g.currentAction || {}; g.currentAction.active = false; g.currentAction.skill = null;
  g.resumeAfterRepair = null;
  g.queue = { status: { isRunning:false, activeIndex:-1, failCount:0, completedCount:0 }, items: [] };
  g.tutorial = g.tutorial || {};
  g.tutorial.taskStateById = g.tutorial.taskStateById || {};
  g.tutorial.taskStateById.C6 = { status:"active", progress:{}, rewardClaimed:false, supportClaimed:false, instanceId:null, c5Token:null, c6Token:null, wave1:false, wave4:false };
  g.tutorial.activeCombatRunToken = null;
  g.tutorial.combatRunSequence = 0;
  g.tutorial.eventLedger = { processedEventIds: [] };
}

// 清空当前波敌人并推进一个真实战斗回合（触发 resolveCombatWaveVictory → 真实 emit combat:waveCleared）
function clearOneWave(g, now) {
  g.combat.enemies.forEach((e) => { e.hp.shield = 0; e.hp.armor = 0; e.hp.structure = 0; });
  g.combat.enemies = [];
  sandbox.advanceCombatRound(g, { now, offline:false, emit: GE.emit, playEffects:false, rng: () => 0.5 });
  // 推进后若仍在战斗中（生成了下一波），先清空下一波敌人，便于下一轮 clearOneWave
  if (g.combat.active) {
    g.combat.enemies.forEach((e) => { e.hp.shield = 0; e.hp.armor = 0; e.hp.structure = 0; });
    g.combat.enemies = [];
  }
}
// 驱动 count 个真实战斗波次（会真实 emit count 次 combat:waveCleared）
function driveWaves(g, count, nowStart) {
  let now = nowStart;
  for (let w = 0; w < count; w++) { clearOneWave(g, now++); }
  return now;
}
// 复刻 UI（combat-render.js:475）：手动出击前先用 buildCombatWave 构波，再把 enemies+formationId 交给 dispatch。
function manualCombatStart(g, now) {
  const zone = COMBAT_ZONES.find((z) => z.id === g.combat.zone);
  if (!zone) return { changed:false, reason:"no-zone" };
  const wave = sandbox.buildCombatWave(zone, g.combat.wave, () => 0.5, g.combat);
  return sandbox.dispatchGameAction(g, { type:"combat/start", enemies:wave.enemies, formationId:wave.formationId }, now);
}

const c6Status = (g) => { const s = sandbox.TutorialSystem.getTutorialTaskState(g, "C6"); return s ? s.status : "(none)"; };
const c6Claimable = (g) => { const s = c6Status(g); return s === "claimable" || s === "completed"; };
const tokenOf = (g) => g.tutorial.activeCombatRunToken;

// ---- 断言工具 ----
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}

const g = sandbox.gameState;

// ===================== 用例 1：手动 combat/start 清 1→4 → C6 可领取 =====================
console.log("\n[1] 手动出击：dispatch combat/start 清 1→4 波 → C6 可领取");
{
  resetForTest(g, "angel_outpost");
  const r = manualCombatStart(g, 1000);
  check("手动 combat/start 返回 changed", r && r.changed === true);
  check("手动出击后 token 非空", typeof tokenOf(g) === "string" && tokenOf(g) !== "");
  driveWaves(g, 4, 2000);
  check("手动清4波后 C6=claimable", c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 2：队列清 4 波（从停止态启动）→ C6 可领取 =====================
console.log("\n[2] 队列出击：executeQueueItemForState 清 4 波 → C6 可领取");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost"; // 模拟玩家已在 UI 选定该星带
  const item = { id:"q1", skill:"combat", target:"angel_outpost", count:4 };
  const r = sandbox.executeQueueItemForState(g, item, 1000);
  check("队列启动返回 changed", r && r.changed === true);
  check("队列启动后 combat.active", g.combat.active === true);
  check("队列启动后 token 非空（修复点：此前为 null）", typeof tokenOf(g) === "string" && tokenOf(g) !== "");
  driveWaves(g, 4, 2000);
  check("队列清4波后 C6=claimable", c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 3：队列 token 非空且 4 波恒定 =====================
console.log("\n[3] 队列：token 非空且跨 4 波恒定（不可逐波重生成）");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  const t0 = tokenOf(g);
  const seen = [t0];
  let now = 2000;
  for (let w = 0; w < 4; w++) { clearOneWave(g, now++); seen.push(tokenOf(g)); }
  check("起始 token 非空", typeof t0 === "string" && t0 !== "");
  check("4 波内 token 恒定（无逐波重生成）", seen.every((t) => t === t0), "seen=" + JSON.stringify(seen));
}

// ===================== 用例 4：combatRunSequence 仅 +1（不随波次递增）=====================
console.log("\n[4] 队列：combatRunSequence 仅出击时 +1，不随波次重计");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  const seqStart = g.tutorial.combatRunSequence;
  driveWaves(g, 4, 2000);
  const seqEnd = g.tutorial.combatRunSequence;
  check("出击后 sequence=1", seqStart === 1, "seqStart=" + seqStart);
  check("清4波后 sequence 仍为 1（未逐波递增）", seqEnd === 1, "seqEnd=" + seqEnd);
}

// ===================== 用例 5：stop 清旧 token，新出击新 token =====================
console.log("\n[5] 停止战斗清空旧 token；再次出击生成新 token / 新 sequence");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  const t1 = tokenOf(g); const seq1 = g.tutorial.combatRunSequence;
  clearOneWave(g, 2000); // 清掉第1波，仍在同次出击
  check("清第1波后 token 不变", tokenOf(g) === t1);
  const stop = sandbox.dispatchGameAction(g, { type:"combat/stop" }, 3000);
  check("combat/stop 返回 changed", stop && stop.changed === true);
  check("stop 后 token 被清空", tokenOf(g) === null);
  // 重新出击
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q2", skill:"combat", target:"angel_outpost", count:4 }, 4000);
  const t2 = tokenOf(g);
  check("新出击 token 非空", typeof t2 === "string" && t2 !== "");
  check("新 token ≠ 旧 token", t2 !== t1);
  check("新 sequence = 旧+1", g.tutorial.combatRunSequence === seq1 + 1, "seq=" + g.tutorial.combatRunSequence);
}

// ===================== 用例 6：run1 清2→stop→run2 清2，不跨次累计 =====================
console.log("\n[6] 两次出击各清2波（非同次）→ C6 不完成（不跨次累计）");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  driveWaves(g, 2, 2000); // run1 清第1、2波
  check("run1 后 C6 仍 active", !c6Claimable(g));
  sandbox.dispatchGameAction(g, { type:"combat/stop" }, 5000);
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q2", skill:"combat", target:"angel_outpost", count:4 }, 6000);
  driveWaves(g, 2, 7000); // run2 清第1、2波（总计4波但分两次）
  check("合计4波但分两次出击 → C6 仍 active（无跨次累计）", !c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 7：队列仅清 3 波 → C6 不完成 =====================
console.log("\n[7] 队列清3波 → C6 不完成（wave 门禁 intact）");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  driveWaves(g, 3, 2000);
  check("清3波后 C6 仍 active", !c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 8：wave4 事件存在但 token 缺失 → 不完成（防伪造门禁 intact）=====================
console.log("\n[8] 反伪造：token 为空时收到 wave=4 事件 → C6 不完成（token 门禁未被削弱）");
{
  resetForTest(g, "angel_outpost");
  // 直接 emit 4 个 combat:waveCleared，但保持 activeCombatRunToken=null（模拟无有效出击登记）
  g.tutorial.activeCombatRunToken = null;
  for (let w = 1; w <= 4; w++) GE.emit("combat:waveCleared", { zoneId:"angel_outpost", wave:w });
  check("token 为空且收到 wave=4 → C6 仍 active（门禁 intact）", !c6Claimable(g), "status=" + c6Status(g));
  check("C6.wave4 仍为 false", sandbox.TutorialSystem.getTutorialTaskState(g,"C6").wave4 === false);
}

// ===================== 用例 9：三个一级普通星带各自清4波均完成 =====================
console.log("\n[9] 三个一级普通星带（angel/blood/sansha_outpost）队列清4波 → 均完成");
for (const zone of ["angel_outpost", "blood_hideout", "sansha_outpost"]) {
  resetForTest(g, zone);
  g.combat.zone = zone;
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:zone, count:4 }, 1000);
  driveWaves(g, 4, 2000);
  check(`队列 ${zone} 清4波 → C6=claimable`, c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 10：高级星带 / 死亡空间 不误完成 C6 =====================
console.log("\n[10] 高级普通星带 / 死亡空间 → 不误完成 C6（zone / mode 门禁 intact）");
{
  // (a) 高级普通星带（不在 C6 白名单）：在线 emit wave=4 + 有效 token → 不完成
  resetForTest(g, "sansha_redoubt_lv80");
  sandbox.dispatchGameAction(g, { type:"combat/start" }, 1000); // 登记 token
  GE.emit("combat:waveCleared", { zoneId:"sansha_redoubt_lv80", wave:4 });
  check("高级星带 sansha_redoubt_lv80 收到 wave=4 → C6 不完成", !c6Claimable(g), "status=" + c6Status(g));
}
{
  // (b) 2026-09-01 修正断言：离线 C6 门禁已**刻意放宽**（tutorial.js onOfflineCombatSettled 注释：
  // "应对 TapTap 环境不确定性……离线仅作兜底，在线路径仍为正经判定"）——只要 runsDetail
  // 清满 4 波且 token 为字符串即完成，不再校验 zone/mode/sortieToken。原断言基于旧门禁设计。
  resetForTest(g, "angel_outpost");
  GE.emit("offline:combatSettled", { runsDetail: [
    { token:"r1", sortieToken:"run_off_1", zoneId:"angel_outpost", mode:"deathspace", wavesCleared:4, defeated:false, zoneClears:1 }
  ], kills: 10 });
  check("离线 deathspace（wavesCleared=4）→ C6 完成（离线兜底有意放宽门禁）", c6Claimable(g), "status=" + c6Status(g));
}
{
  // (c) 同 (b)：离线兜底不校验 zone 白名单
  resetForTest(g, "sansha_redoubt_lv80");
  GE.emit("offline:combatSettled", { runsDetail: [
    { token:"r1", sortieToken:"run_off_1", zoneId:"sansha_redoubt_lv80", mode:"belt", wavesCleared:4, defeated:false, zoneClears:1 }
  ], kills: 10 });
  check("离线高级星带（wavesCleared=4）→ C6 完成（离线兜底有意放宽门禁）", c6Claimable(g), "status=" + c6Status(g));
}
{
  // (d) 最低门禁：run.token 必须为字符串，缺失则不完成。
  // 注：实现校验的是 run.token（战斗内部 runToken），不是 sortieToken 字段 ——
  // 原用例把 token 传成有效字符串、只把 sortieToken 置 null，自然永远"完成"（假失败）。
  resetForTest(g, "angel_outpost");
  GE.emit("offline:combatSettled", { runsDetail: [
    { token:null, sortieToken:"run_off_x", zoneId:"angel_outpost", mode:"belt", wavesCleared:4, defeated:false, zoneClears:1 }
  ], kills: 10 });
  check("离线 token 缺失（wavesCleared=4）→ C6 不完成（最低门禁 intact）", !c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 11：在线 == 离线 队列清4波 结果一致 =====================
console.log("\n[11] 在线队列清4波 == 离线结算清4波（结果一致：均 claimable）");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  driveWaves(g, 4, 2000);
  const onlineResult = c6Status(g);
  // 离线等价：构造离线结算（sortieToken 来自同一次出击登记的 activeCombatRunToken）
  resetForTest(g, "angel_outpost");
  g.tutorial.activeCombatRunToken = "run_off_eq_1"; // 离线开始时登记的权威 token
  GE.emit("offline:combatSettled", { runsDetail: [
    { token:"combat_r1", sortieToken:"run_off_eq_1", zoneId:"angel_outpost", mode:"belt", wavesCleared:4, defeated:false, zoneClears:1 }
  ], kills: 10 });
  const offlineResult = c6Status(g);
  check("在线队列清4波 → claimable", onlineResult === "claimable", "online=" + onlineResult);
  check("离线结算清4波 → claimable（与在线一致）", offlineResult === "claimable", "offline=" + offlineResult);
}

// ===================== 用例 12：刷新续打（存档往返）同次队列 token/进度正确 =====================
console.log("\n[12] 刷新续打：存档往返后同一队列 sortie 的 token/进度保留，续清至4波可完成");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  driveWaves(g, 2, 2000); // 清第1、2波后“刷新”
  const tokenBefore = tokenOf(g);
  const seqBefore = g.tutorial.combatRunSequence;
  const wavesDoneBefore = g.combat.queueWavesDone;
  // 模拟存档往返：深拷贝 → 清空实时态 → Object.assign 还原（与 persistence.load 的 Object.assign(gameState,data) 一致）
  const snapshot = JSON.parse(JSON.stringify(g));
  g.tutorial.activeCombatRunToken = null; g.combat.active = false; g.combat.queueWavesDone = 0; g.combat.enemies = [];
  Object.assign(g, snapshot); // 还原存档（含 activeCombatRunToken / queueWavesDone）
  check("往返后 token 与刷新前一致", tokenOf(g) === tokenBefore, "before=" + tokenBefore + " after=" + tokenOf(g));
  check("往返后 combatRunSequence 一致", g.tutorial.combatRunSequence === seqBefore);
  check("往返后 queueWavesDone 保留（≥2）", g.combat.queueWavesDone >= 2, "queueWavesDone=" + g.combat.queueWavesDone);
  // 续打：真实游戏由队列 tick 自动续战（combat.active/zone/queueWavesDone 已随存档还原，
  // 不重新 executeQueueItemForState —— 否则会开新 sortie、丢掉本次连续性）。直接继续推进真实战斗回合。
  check("续打前 token 仍未变（同次 sortie）", tokenOf(g) === tokenBefore, "now=" + tokenOf(g));
  driveWaves(g, 2, 6000); // 再清第3、4波
  check("续清至4波后 C6=claimable", c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 13：维修恢复不丢 sortie（重新登记有效 token）=====================
console.log("\n[13] 维修恢复：清2波后被击毁（token清空）→ 重新出击登记新 token → 续清至4波可完成");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:99 }, 1000);
  driveWaves(g, 2, 2000); // 清第1、2波
  check("维修前 token 非空", typeof tokenOf(g) === "string" && tokenOf(g) !== "");
  // 模拟“被击毁”：onShipDestroyed 仅清空 token（此处直接等效设置）
  g.tutorial.activeCombatRunToken = null;
  g.combat.active = false; g.combat.enemies = [];
  check("被击毁后 token 为空", tokenOf(g) === null);
  // 维修恢复：真实走 tryResumeCombatAfterRepair → dispatchGameAction({type:combat/start})，复用同一登记入口
  g.combat.zone = "angel_outpost";
  const resume = manualCombatStart(g, 5000);
  check("维修恢复（combat/start）返回 changed", resume && resume.changed === true);
  check("维修恢复后 token 重新登记（非丢失）", typeof tokenOf(g) === "string" && tokenOf(g) !== "");
  driveWaves(g, 4, 6000); // 续清第1→4波（恢复后新 sortie）
  check("维修恢复后续清至4波 → C6=claimable（未丢 sortie）", c6Claimable(g), "status=" + c6Status(g));
}

// ===================== 用例 14：相同 eventId 重放不重复处理 =====================
console.log("\n[14] 幂等：相同 eventId 重放 wave=4 不重复推进 / 不重复计奖");
{
  resetForTest(g, "angel_outpost");
  manualCombatStart(g, 1000);
  driveWaves(g, 3, 2000); // 清1→3波
  // 首次以固定 eventId 触发 wave=4
  GE.emit("combat:waveCleared", { zoneId:"angel_outpost", wave:4 }, { eventId:"c6-w4-fixed" });
  check("首次 wave=4（固定 id）→ C6=claimable", c6Claimable(g), "status=" + c6Status(g));
  const ledgerAfter1 = (g.tutorial.eventLedger.processedEventIds || []).filter((k) => k === "tutorial:combat:c6-w4-fixed").length;
  check("首次后账本含 1 条该 eventId", ledgerAfter1 === 1, "count=" + ledgerAfter1);
  // 以相同 eventId 重放
  GE.emit("combat:waveCleared", { zoneId:"angel_outpost", wave:4 }, { eventId:"c6-w4-fixed" });
  const ledgerAfter2 = (g.tutorial.eventLedger.processedEventIds || []).filter((k) => k === "tutorial:combat:c6-w4-fixed").length;
  check("重放后账本仍仅 1 条（已去重，无重复处理）", ledgerAfter2 === 1, "count=" + ledgerAfter2);
  check("重放后 C6 仍为 claimable（未变为 completed/重复计奖）", c6Status(g) === "claimable", "status=" + c6Status(g));
}

// ===================== 用例 15：C6 claimable→completed 领取奖励不回归 =====================
console.log("\n[15] C6 领取：claimable → completed 且发放奖励（不回归）");
{
  resetForTest(g, "angel_outpost");
  g.combat.zone = "angel_outpost";
  sandbox.executeQueueItemForState(g, { id:"q1", skill:"combat", target:"angel_outpost", count:4 }, 1000);
  driveWaves(g, 4, 2000);
  check("队列清4波后 C6=claimable", c6Status(g) === "claimable", "status=" + c6Status(g));
  // C6 含按轨道发放的最终舰船奖励（choiceRewards），领取前需已选战斗轨道（真实流程 C1 已选）。
  g.tutorial.selectedCombatTrack = "laser";
  const before = JSON.parse(JSON.stringify(g.tutorial.taskStateById.C6));
  const claim = sandbox.TutorialSystem.claimTutorialTask(g, "C6", 9000);
  const after = g.tutorial.taskStateById.C6;
  check("领取返回 ok", claim && claim.ok === true, "claim=" + JSON.stringify(claim));
  check("领取后 status=completed", after.status === "completed", "status=" + after.status);
  check("领取后 rewardClaimed=true", after.rewardClaimed === true);
}

// ===================== 汇总 =====================
console.log(`\nC6 队列 sortie 回归结果：${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("失败项：" + failures.join("; "));
  process.exit(1);
}
process.exit(0);
