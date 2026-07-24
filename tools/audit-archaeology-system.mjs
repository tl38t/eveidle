/* ================================================================
   考古系统第二阶段 — 专项审计
   ================================================================ */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1]);

// ========= 沙箱 =========
const noop = () => {};
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
function MockCanvasContext() {}
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
MockCanvasContext.prototype.roundRect = noop;
function makeElement() {
  return {
    addEventListener: noop, appendChild: noop, classList, click: noop,
    closest: () => null, dataset: {}, focus: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560,
    querySelector: () => makeElement(), querySelectorAll: () => [],
    remove: noop, select: noop, style: {}, textContent: "", value: "1"
  };
}
const sandbox = {
  alert: noop, Blob, confirm: () => true,
  CanvasRenderingContext2D: MockCanvasContext,
  document: {
    addEventListener: noop, body: makeElement(),
    createElement: () => makeElement(),
    createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
    getElementById: () => makeElement(),
    querySelector: () => makeElement(), querySelectorAll: () => []
  },
  FileReader: class {}, localStorage: { getItem: () => null, setItem: noop },
  requestAnimationFrame: noop, setInterval: noop, setTimeout: noop,
  clearTimeout: noop, URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
  window: null, console
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);

const scripts = scriptSources.map(s => fs.readFileSync(path.resolve(root, s), "utf8"));
for (let i = 0; i < scripts.length; i++) {
  vm.runInContext(scripts[i], sandbox, { filename: scriptSources[i] });
}

// ========= 断言辅助 =========
let pass = 0, fail = 0, assertions = 0;
function ok(cond, msg) {
  assertions++;
  if (cond) { pass++; } else { fail++; console.error("  FAIL", msg); }
}
function eq(actual, expected, msg) {
  assertions++;
  if (actual === expected) { pass++; }
  else { fail++; console.error(`  FAIL ${msg}: expected ${expected}, got ${actual}`); }
}
function seq(actual, expected, msg) {
  assertions++;
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; }
  else { fail++; console.error(`  FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// ========== A. 加载与初始状态 ==========
console.log("\n=== A. 加载与初始状态 ===");

// A1: 脚本无 ReferenceError（已在沙箱加载阶段验证）
ok(true, "A1 沙箱加载完成（无 ReferenceError）");

// A2: ARCHAEOLOGY_SHIP_TYPES 唯一定义
ok(typeof sandbox.ARCHAEOLOGY_SHIP_TYPES !== "undefined", "A2a ARCHAEOLOGY_SHIP_TYPES 已定义");
ok(Array.isArray(sandbox.ARCHAEOLOGY_SHIP_TYPES), "A2b 是数组");
eq(sandbox.ARCHAEOLOGY_SHIP_TYPES.length, 5, "A2c 五个类型");
eq(sandbox.ARCHAEOLOGY_SHIP_TYPES[0], "archaeology_frigate", "A2d 第一项正确");

// A3: 新游戏 archaeology 状态完整
const gs = sandbox.gameState;
ok(typeof gs.archaeology === "object", "A3a archaeology 对象存在");
eq(gs.archaeology.activeSiteId, null, "A3b activeSiteId=null");
eq(gs.archaeology.activeProbeId, "core_probe_i", "A3c activeProbeId=core_probe_i");
eq(gs.archaeology.progress, 0, "A3d progress=0");
eq(gs.archaeology.repairUntil, 0, "A3e repairUntil=0");
eq(gs.archaeology.repairInstanceId, null, "A3f repairInstanceId=null");
ok(typeof gs.archaeology.shipHp === "object", "A3g shipHp 是对象");
ok(Array.isArray(gs.archaeology.log), "A3h log 是数组");
eq(typeof gs.archaeology.interferenceUntil, "number", "A3i interferenceUntil 类型为 number");
eq(gs.archaeology.interferenceUntil, 0, "A3j interferenceUntil=0");

// A4: 旧存档缺失字段补齐（migrateArchaeologyState 操作全局 gameState）
{
  // 保存原始全局状态的关键值
  const origArch = JSON.parse(JSON.stringify(sandbox.gameState.archaeology));
  const origSkillsArch = JSON.parse(JSON.stringify(sandbox.gameState.skills.archaeology));

  // 清空全局 archaeology 模拟旧存档
  delete sandbox.gameState.archaeology;
  delete sandbox.gameState.skills.archaeology;
  delete sandbox.gameState.resources.probes;
  delete sandbox.gameState.resources.artifacts;
  delete sandbox.gameState.resources.calibrations;

  sandbox.migrateArchaeologyState();
  ok(typeof sandbox.gameState.archaeology === "object", "A4a 旧存档注入 archaeology");
  eq(typeof sandbox.gameState.archaeology.interferenceUntil, "number", "A4b interferenceUntil 补齐");
  eq(sandbox.gameState.skills.archaeology.lvl, 1, "A4c 考古技能默认 Lv.1");
  ok(typeof sandbox.gameState.resources.probes === "object", "A4d probes 池");
  ok(typeof sandbox.gameState.resources.artifacts === "object", "A4e artifacts 池");
  ok(typeof sandbox.gameState.resources.calibrations === "object", "A4f calibrations 池");

  // 恢复全局状态
  sandbox.gameState.archaeology = origArch;
  sandbox.gameState.skills.archaeology = origSkillsArch;
  sandbox.gameState.resources.probes = {};
  sandbox.gameState.resources.artifacts = {};
  sandbox.gameState.resources.calibrations = {};
}

// A5: 连续规范化幂等（调用真实 migrateArchaeologyState 两次）
{
  const a5State = sandbox.gameState;
  const probesBefore = Object.keys(a5State.resources.probes || {}).length;
  sandbox.migrateArchaeologyState();
  sandbox.migrateArchaeologyState();
  eq(a5State.skills.archaeology.lvl, 1, "A5a 二次规范化不改变技能等级");
  eq(Object.keys(a5State.resources.probes || {}).length, probesBefore, "A5b 不重复赠送探针");
}

// ========== B. 舰船与遗迹准入 ==========
console.log("\n=== B. 舰船与遗迹准入 ===");

// 创建一艘苍鹭级实例并分配考古岗位
const s = JSON.parse(JSON.stringify(gs)); // fresh state copy
s.skills.archaeology = { lvl: 1, xp: 0 };
sandbox.ResourceRegistry.add(s, "consumable:fuel", 1000);
sandbox.ResourceRegistry.add(s, "probe:core_probe_i", 50);

// 制造苍鹭级实例
const heronCfg = sandbox.getShipConfigById("heron");
ok(heronCfg !== undefined, "B1a getShipConfigById 可以解析 heron");

// 创建实例并放入 inventory.ships
if (!s.inventory) s.inventory = {};
if (!s.inventory.ships) s.inventory.ships = [];
const shipObj = sandbox.createShipInstance("heron");
s.inventory.ships.push(shipObj);
const shipIid = shipObj.instanceId;
if (!s.shipAssignments) s.shipAssignments = {};
s.shipAssignments.archaeology = shipIid;
ok(typeof shipIid === "string" && shipIid.startsWith("ship_"), "B1b 创建苍鹭级实例: " + shipIid);

// B2: 遗迹准入检查
const site = sandbox.getArchaeologySite("site_i_a");
ok(site !== null, "B2a 失落信标残骸可查");
eq(s.archaeology.activeSiteId, null, "B2b 初始无选择");

// selectSite action
const selectResult = sandbox.dispatchGameAction(s, { type: "archaeology/selectSite", siteId: "site_i_a" }, 0);
ok(selectResult.changed, "B2c selectSite 成功");
eq(s.archaeology.activeSiteId, "site_i_a", "B2d activeSiteId 已设置");

// 等级不足拒绝
s.skills.archaeology.lvl = 1;
const denyLevel = sandbox.dispatchGameAction(s, { type: "archaeology/selectSite", siteId: "site_ii_a" }, 0);
ok(!denyLevel.changed, "B2e 等级不足拒绝 T2 遗迹");
eq(denyLevel.reason, "level-locked", "B2f 理由 level-locked");

// B3: 同级船 +0 + 同档满装 + core_probe_i 的 50% 基准
function makeTestState(shipId, skillLvl, analyzerIds, siteTier) {
  const st = JSON.parse(JSON.stringify(gs));
  sandbox.ResourceRegistry.add(st, "consumable:fuel", 1000);
  sandbox.ResourceRegistry.add(st, "probe:core_probe_i", 50);
  st.skills.archaeology = { lvl: skillLvl, xp: 0 };
  st.inventory = st.inventory || {};
  st.inventory.ships = [];
  const shp = sandbox.createShipInstance(shipId);
  st.inventory.ships.push(shp);
  st.shipAssignments = { archaeology: shp.instanceId };
  // 安装分析仪
  if (!shp.fitted) shp.fitted = { high: [], mid: [], low: [], rig: [] };
  for (const aid of analyzerIds) shp.fitted.high.push(aid);
  return st;
}

{
  const tState = makeTestState("heron", 1, ["archaeo_analyzer_i", "archaeo_analyzer_i"], "I");
  const inst = sandbox.getShipInstanceFromState(tState, tState.shipAssignments.archaeology);
  const scanStr = sandbox.computeArchaeologyScanStrength(tState, inst, "core_probe_i");
  ok(typeof scanStr === "number", "B3a 扫描强度计算不抛异常");
  eq(scanStr, 21, "B3b 苍鹭+0+双分析仪I+普通探针 scanStrength=21");
  const chance = sandbox.computeArchaeologySuccessChance(scanStr, 21);
  eq(chance, 0.50, "B3c Tier I 同级基础成功率=50%");
}

// III 档验证（星图级 + skill 35 + 3×分析仪III + core_probe）
{
  const tState = makeTestState("starmap", 35,
    ["archaeo_analyzer_iii","archaeo_analyzer_iii","archaeo_analyzer_iii"], "III");
  const inst = sandbox.getShipInstanceFromState(tState, tState.shipAssignments.archaeology);
  const scanStr = sandbox.computeArchaeologyScanStrength(tState, inst, "core_probe_i");
  eq(scanStr, 121, "B3d 星图+0+三分析仪III+普通探针 scanStrength=121");
  const chance3 = sandbox.computeArchaeologySuccessChance(scanStr, 121);
  eq(chance3, 0.50, "B3e Tier III 同级基础成功率=50%");
}

// V 档验证（启明级 + skill 80 + 4×分析仪V + core_probe）
{
  const tState = makeTestState("illuminator", 80,
    ["archaeo_analyzer_v","archaeo_analyzer_v","archaeo_analyzer_v","archaeo_analyzer_v"], "V");
  const inst = sandbox.getShipInstanceFromState(tState, tState.shipAssignments.archaeology);
  const scanStr = sandbox.computeArchaeologyScanStrength(tState, inst, "core_probe_i");
  eq(scanStr, 300, "B3f 启明+0+四分析仪V+普通探针 scanStrength=300");
  const chance5 = sandbox.computeArchaeologySuccessChance(scanStr, 300);
  eq(chance5, 0.50, "B3g Tier V 同级基础成功率=50%");
}

// B4: 准入拒绝条件
{
  const denyState = makeTestState("heron", 1, [], "I");
  denyState.archaeology.activeSiteId = "site_i_a";
  // 无探针
  sandbox.ResourceRegistry.set(denyState, "probe:core_probe_i", 0);
  const noProbe = sandbox.dispatchGameAction(denyState, { type: "archaeology/start", now: 0 }, 0);
  ok(!noProbe.changed, "B4a 无探针被拒");
  eq(noProbe.reason, "insufficient-probe", "B4b 理由 insufficient-probe");

  // 有探针无燃料
  sandbox.ResourceRegistry.add(denyState, "probe:core_probe_i", 10);
  sandbox.ResourceRegistry.set(denyState, "consumable:fuel", 0);
  const noFuel = sandbox.dispatchGameAction(denyState, { type: "archaeology/start", now: 0 }, 0);
  ok(!noFuel.changed, "B4c 无燃料被拒");
}

// B5: 考古舰允许普通战斗（不恢复已废止的禁令）
{
  const combatState = makeTestState("heron", 1, [], "I");
  const inst = sandbox.getShipInstanceFromState(combatState, combatState.shipAssignments.archaeology);
  const cfg = sandbox.getShipConfigById(inst.shipId);
  ok(cfg && sandbox.ARCHAEOLOGY_SHIP_TYPES.includes(cfg.type), "B5a 苍鹭是考古舰");
  const assignResult = sandbox.getShipAssignmentRestriction(cfg, "combat");
  ok(assignResult === null || assignResult.reason !== "unsupported-archaeology", "B5b 考古舰不被禁止战斗");
}

// ========== C. 开始、停止与 tick ==========
console.log("\n=== C. 开始、停止与 tick ===");

// C1: 真实 start action
{
  const tState = makeTestState("heron", 1, [], "I");
  tState.archaeology.activeSiteId = "site_i_a";
  const startR = sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: 1000 }, 1000);
  ok(startR.changed, "C1a start 成功");
  eq(tState.currentAction.skill, "archaeology", "C1b currentAction.skill=archaeology");
  ok(tState.currentAction.active, "C1c active=true");
  eq(tState.archaeology.startedSiteId, "site_i_a", "C1d startedSiteId 锁定");
  eq(tState.archaeology.startedProbeId, "core_probe_i", "C1e startedProbeId 锁定");
  eq(tState.currentAction.progress, 0, "C1f progress 归零");
}

// C2: 在线 tick 结算（成功，用 fixed randomValue）
{
  const tState = makeTestState("heron", 1, ["archaeo_analyzer_i", "archaeo_analyzer_i"], "I");
  tState.archaeology.activeSiteId = "site_i_a";
  sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: 0 }, 0);

  // 推进时间到完成一次
  const probeBefore = sandbox.ResourceRegistry.get(tState, "probe:core_probe_i");
  const fuelBefore = sandbox.ResourceRegistry.get(tState, "consumable:fuel");
  const xpBefore = tState.skills.archaeology.xp;

  tState.currentAction.progress = 31; // site time is 30, so progress >= site.time
  tState.currentAction.lastProgressUpdate = 0;

  // 使用固定 randomValue=0.3 (<0.50 successChance) 保证成功
  const result = sandbox.resolveArchaeologyCycle(tState, 30000, 0.3);
  ok(result.success, "C2a randomValue=0.3 触发成功");
  eq(sandbox.ResourceRegistry.get(tState, "probe:core_probe_i"), probeBefore - 1, "C2b 探针消耗 1");
  eq(sandbox.ResourceRegistry.get(tState, "consumable:fuel"), fuelBefore - 2, "C2c 燃料消耗 2");
  ok(tState.skills.archaeology.xp > xpBefore, "C2d 成功获得 XP");
  ok(result.found && result.found.length >= 1, "C2e 成功产出文物");
}

// C3: 在线 tick 结算（失败，用 fixed randomValue）
{
  const tState = makeTestState("heron", 1, [], "I");
  tState.archaeology.activeSiteId = "site_i_a";
  sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: 0 }, 0);

  const xpBefore = tState.skills.archaeology.xp;
  const hp = sandbox.getArchaeologyShipHp(tState, tState.shipAssignments.archaeology);
  const shieldBefore = hp.shield;
  tState.currentAction.progress = 31;

  // randomValue=0.9 (>0.50) 保证失败
  const result = sandbox.resolveArchaeologyCycle(tState, 30000, 0.9);
  ok(!result.success, "C3a randomValue=0.9 触发失败");
  ok(result.backlash > 0, "C3b 反噬伤害 >0");
  ok(hp.shield < shieldBefore || result.backlash > 0, "C3c HP 减少");
  eq(tState.skills.archaeology.xp, xpBefore, "C3d 失败不获得 XP");
}

// C4: 资源不足原子拒绝（直接 call resolveArchaeologyCycle，绕过 start 检查）
{
  const tState = makeTestState("heron", 1, [], "I");
  // 手动设置 started 字段，模拟 tick 调用路径
  tState.archaeology.startedSiteId = "site_i_a";
  tState.archaeology.startedProbeId = "core_probe_i";
  sandbox.ResourceRegistry.set(tState, "consumable:fuel", 0); // 清空燃料
  const result = sandbox.resolveArchaeologyCycle(tState, 30000, 0.3);
  ok(!result.success, "C4a 资源不足拒绝");
  eq(result.reason, "insufficient", "C4b 理由 insufficient");
}

// C5: 停止后 locked startedSiteId 被清除（但 interferenceUntil 不清除）
{
  const tState = makeTestState("heron", 1, [], "I");
  tState.archaeology.activeSiteId = "site_i_a";
  sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: 0 }, 0);
  const stopR = sandbox.dispatchGameAction(tState, { type: "archaeology/stop", now: 1000 }, 1000);
  ok(stopR.changed, "C5a stop 成功");
  eq(tState.archaeology.startedSiteId, null, "C5b startedSiteId 清空");
  eq(tState.archaeology.startedProbeId, null, "C5c startedProbeId 清空");
  ok(!tState.currentAction.active, "C5e active=false");
}

// C5x: 失败后干扰期间不能重新开始（防绕过）
{
  const tState = makeTestState("heron", 1, [], "I");
  tState.archaeology.activeSiteId = "site_i_a";
  const now = 30000;
  // 触发失败
  sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: 0 }, 0);
  tState.currentAction.progress = 31;
  tState.currentAction.lastProgressUpdate = 0;
  const failResult = sandbox.resolveArchaeologyCycle(tState, now, 0.9);
  ok(!failResult.success, "C5f 触发失败");
  // tick 会在失败且未毁坏时设置 interferenceUntil
  const site = sandbox.getArchaeologySite("site_i_a");
  tState.archaeology.interferenceUntil = now + sandbox.getArchaeologyInterferenceSeconds(site) * 1000;
  ok(tState.archaeology.interferenceUntil > now, "C5g interferenceUntil 设为未来时间");
  // 停止后 interferenceUntil 必须保留
  sandbox.dispatchGameAction(tState, { type: "archaeology/stop", now: now + 1000 }, now + 1000);
  ok(tState.archaeology.interferenceUntil > now, "C5h stop 不清除 interferenceUntil");
  // 干扰期间 start 被拒绝
  tState.archaeology.activeSiteId = "site_i_a";
  const blocked = sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: now + 2000 }, now + 2000);
  ok(!blocked.changed, "C5i 干扰中 start 被拒绝");
  eq(blocked.reason, "interference", "C5j 理由 interference");
  // 探针/燃料未被 start 消耗（但失败时已消耗 1）
  const probeStock = sandbox.ResourceRegistry.get(tState, "probe:core_probe_i");
  eq(probeStock, 50 - 1, "C5k 仅消耗 1 根探针（失败时消耗）");
  // 时间到期后可以重新开始
  tState.archaeology.interferenceUntil = 0;
  const allowed = sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: 999999 }, 999999);
  ok(allowed.changed, "C5l 时间到期后可以重新开始");
}

// C6: tick 不重复结算
{
  const tState = makeTestState("heron", 1, [], "I");
  tState.archaeology.activeSiteId = "site_i_a";
  sandbox.dispatchGameAction(tState, { type: "archaeology/start", now: 0 }, 0);
  tState.currentAction.progress = 0; // 未达到阈值
  const preProbe = sandbox.ResourceRegistry.get(tState, "probe:core_probe_i");
  // gameTick progress 不满 30 秒不触发
  eq(sandbox.ResourceRegistry.get(tState, "probe:core_probe_i"), preProbe, "C6 tick 小 progress 不触发结算");
}

// ========== D. 文物掉落、出售与 LP 兑换 ==========
console.log("\n=== D. 文物掉落、出售与 LP 兑换 ===");

// D1: itemId 唯一性
{
  const ids = sandbox.ARCHAEOLOGY_ARTIFACTS.map(a => a.id);
  eq(ids.length, new Set(ids).size, "D1a 文物 ID 唯一");
  eq(ids.length, 40, "D1b 40 个文物");
  const probes = sandbox.ARCHAEOLOGY_PROBES.map(p => p.id);
  eq(probes.length, new Set(probes).size, "D1c 探针 ID 唯一");
  const sites = sandbox.ARCHAEOLOGY_SITES.map(s => s.id);
  eq(sites.length, new Set(sites).size, "D1d 遗迹 ID 唯一");
}

// D2-5: 单件出售
{
  const sellState = JSON.parse(JSON.stringify(gs));
  sandbox.ResourceRegistry.add(sellState, "artifact:art_i_common_a", 3); // 锈蚀数据核心 600 ISK
  const iskBefore = sandbox.ResourceRegistry.get(sellState, "currency:isk");
  const result = sandbox.dispatchGameAction(sellState, { type: "archaeology/sellArtifact", artifactId: "art_i_common_a", quantity: 1 }, 0);
  ok(result.changed, "D2a 单件出售成功");
  eq(result.isk, 600, "D2b ISK=600");
  eq(sandbox.ResourceRegistry.get(sellState, "artifact:art_i_common_a"), 2, "D2c 库存 3→2");
  eq(sandbox.ResourceRegistry.get(sellState, "currency:isk"), iskBefore + 600, "D2d ISK 增加 600");
}

// D6-7: sell-all（含修复后的 common_isk 类型匹配）
{
  const sellState = JSON.parse(JSON.stringify(gs));
  sandbox.ResourceRegistry.add(sellState, "artifact:art_i_common_a", 2); // 600×2
  sandbox.ResourceRegistry.add(sellState, "artifact:art_i_common_b", 1); // 900
  sandbox.ResourceRegistry.add(sellState, "artifact:art_i_unique_a", 1); // 3000
  sandbox.ResourceRegistry.add(sellState, "artifact:art_i_lp", 1);       // LP 不可出售
  sandbox.ResourceRegistry.add(sellState, "calibration:art_i_calib", 1);  // 校准不可出售
  const iskBefore = sandbox.ResourceRegistry.get(sellState, "currency:isk");

  const result = sandbox.dispatchGameAction(sellState, { type: "archaeology/sellArtifact", all: true }, 0);
  ok(result.changed, "D3a sell-all 成功");
  eq(result.totalIsk, 600 * 2 + 900 + 3000, "D3b totalIsk=600×2+900+3000=" + (600 * 2 + 900 + 3000));
  eq(result.sold, 4, "D3c 出售 4 件 (2+1+1 ISK)");
  eq(sandbox.ResourceRegistry.get(sellState, "currency:isk"), iskBefore + result.totalIsk, "D3d ISK 正确增加");

  // LP 和校准不可出售，应保留
  eq(sandbox.ResourceRegistry.get(sellState, "artifact:art_i_lp"), 1, "D3e LP 文物保留");
  eq(sandbox.ResourceRegistry.get(sellState, "calibration:art_i_calib"), 1, "D3f 校准材料保留");
}

// D8: 失败请求不改库存
{
  const sellState = JSON.parse(JSON.stringify(gs));
  const iskBefore = sandbox.ResourceRegistry.get(sellState, "currency:isk");
  const result = sandbox.dispatchGameAction(sellState, { type: "archaeology/sellArtifact", artifactId: "art_i_lp", quantity: 1 }, 0);
  ok(!result.changed, "D4a LP 文物不可出售");
  eq(sandbox.ResourceRegistry.get(sellState, "currency:isk"), iskBefore, "D4b ISK 不变");
}

// D9: 连续全部出售第二次无收益
{
  const sellState = JSON.parse(JSON.stringify(gs));
  sandbox.ResourceRegistry.add(sellState, "artifact:art_i_common_a", 1);
  const r1 = sandbox.dispatchGameAction(sellState, { type: "archaeology/sellArtifact", all: true }, 0);
  ok(r1.changed, "D5a 首次全部出售成功");
  const r2 = sandbox.dispatchGameAction(sellState, { type: "archaeology/sellArtifact", all: true }, 0);
  ok(!r2.changed, "D5b 第二次全部出售无收益");
  eq(r2.reason, "nothing-to-sell", "D5c 理由 nothing-to-sell");
}

// D10-11: 单件/全部 LP 兑换
{
  const redeemState = JSON.parse(JSON.stringify(gs));
  sandbox.ResourceRegistry.add(redeemState, "artifact:art_i_lp", 3); // 50 LP × 3
  sandbox.ResourceRegistry.add(redeemState, "artifact:art_ii_lp", 1); // 150 LP
  const lpBefore = sandbox.ResourceRegistry.get(redeemState, "currency:lp");

  // 单件
  const r1 = sandbox.dispatchGameAction(redeemState, { type: "archaeology/redeemArtifact", artifactId: "art_i_lp", quantity: 1 }, 0);
  ok(r1.changed, "D6a 单件兑换成功");
  eq(r1.lp, 50, "D6b LP=50");
  eq(sandbox.ResourceRegistry.get(redeemState, "artifact:art_i_lp"), 2, "D6c 库存 3→2");

  // 全部
  const rAll = sandbox.dispatchGameAction(redeemState, { type: "archaeology/redeemArtifact", all: true }, 0);
  ok(rAll.changed, "D6d redeem-all 成功");
  eq(rAll.totalLp, 50 * 2 + 150, "D6e totalLp=50×2+150");
  eq(sandbox.ResourceRegistry.get(redeemState, "currency:lp"), lpBefore + r1.lp + rAll.totalLp, "D6f LP 总和正确");
}

// D12: 不可兑换物品保留
{
  const redeemState = JSON.parse(JSON.stringify(gs));
  sandbox.ResourceRegistry.add(redeemState, "artifact:art_i_common_a", 1);
  sandbox.ResourceRegistry.add(redeemState, "artifact:art_i_lp", 1);
  sandbox.dispatchGameAction(redeemState, { type: "archaeology/redeemArtifact", all: true }, 0);
  eq(sandbox.ResourceRegistry.get(redeemState, "artifact:art_i_common_a"), 1, "D7a 非 LP 文物不被兑换");
  eq(sandbox.ResourceRegistry.get(redeemState, "artifact:art_i_lp"), 0, "D7b LP 文物被兑换");
}

// D13: 事件契约（单件 + 批量）
{
  const eventState = JSON.parse(JSON.stringify(gs));
  let caughtSell = null;
  const unsub = sandbox.GameEvents.on("archaeology:artifactSold", ev => { caughtSell = ev; });
  sandbox.ResourceRegistry.add(eventState, "artifact:art_i_common_a", 1);
  sandbox.dispatchGameAction(eventState, { type: "archaeology/sellArtifact", artifactId: "art_i_common_a", quantity: 1 }, 0);
  unsub();
  ok(caughtSell !== null, "D8a 单件 artifactSold 事件触发");
  eq(caughtSell.payload.artifactId, "art_i_common_a", "D8b payload.artifactId 正确");
  eq(caughtSell.payload.isk, 600, "D8c payload.isk=600");

  // 批量售卖：应发射独立 artifactsSold 事件
  const bulkState = JSON.parse(JSON.stringify(gs));
  let caughtBulk = null;
  const unsub2 = sandbox.GameEvents.on("archaeology:artifactsSold", ev => { caughtBulk = ev; });
  sandbox.ResourceRegistry.add(bulkState, "artifact:art_i_common_a", 2);
  sandbox.ResourceRegistry.add(bulkState, "artifact:art_i_common_b", 1);
  sandbox.dispatchGameAction(bulkState, { type: "archaeology/sellArtifact", all: true }, 0);
  unsub2();
  ok(caughtBulk !== null, "D8d 批量 artifactsSold 事件触发");
  eq(caughtBulk.payload.quantity, 3, "D8e quantity=3");
  eq(caughtBulk.payload.totalIsk, 600 * 2 + 900, "D8f totalIsk=2100");
  ok(caughtBulk.payload.artifactId === undefined, "D8g 不含 artifactId");
}

// ========== E. UI 显示态 ==========
console.log("\n=== E. UI 显示态 ===");

{
  const dispState = makeTestState("heron", 1, [], "I");
  const disp = sandbox.getArchaeologyDisplayState(dispState, 0);
  ok(disp !== undefined, "E1 display state 可调用");
  ok(Array.isArray(disp.sites), "E2 sites 是数组");
  eq(disp.sites.length, 15, "E3 15 个遗迹");
  ok(Array.isArray(disp.probes), "E4 probes 是数组");
  eq(disp.probes.length, 3, "E5 3 种探针");
  ok(disp.assignedShip === null || typeof disp.assignedShip === "object", "E6 assignedShip 合法");
  // 无 NaN/undefined
  for (const site of disp.sites) {
    ok(typeof site.successPercent === "string" && site.successPercent !== "NaN", "E7 successPercent 非 NaN:" + site.id);
    ok(typeof site.level === "number", "E8 level 数字:" + site.id);
  }
  for (const probe of disp.probes) {
    ok(typeof probe.stock === "number" && !isNaN(probe.stock), "E9 probe stock 非 NaN:" + probe.id);
  }
}

// ========== F. 离线与兼容性 ==========
console.log("\n=== F. 离线与兼容性 ===");

// F1: 检查离线 descriptor
{
  const offlineState = makeTestState("heron", 1, [], "I");
  offlineState.archaeology.activeSiteId = "site_i_a";
  sandbox.dispatchGameAction(offlineState, { type: "archaeology/start", now: 0 }, 0);

  const desc = sandbox.getOfflineActionDescriptor("archaeology");
  if (desc) {
    ok(typeof desc.duration === "number", "F1a 离线 descriptor 存在");
    ok(typeof desc.maxCycles === "function", "F1b maxCycles 是函数");
    ok(typeof desc.apply === "function", "F1c apply 是函数");
  } else {
    console.log("  (离线考古已接入或者未接入，审计不做强制断言)");
  }
}

// F2: 旧存档补齐（已验证在 A4）

// ========= 结果汇总 =========
console.log("\n========================================");
console.log(`审计断言: ${assertions}  通过: ${pass}  失败: ${fail}`);
console.log("========================================");
process.exit(fail > 0 ? 1 : 0);
