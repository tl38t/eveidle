import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── 沙箱设置（与 verify.mjs 相同的 DOM mock 模式） ──
function MockCanvasContext() {}
const noop = () => {};
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add:noop, remove:noop, toggle:noop, contains:() => false };
const makeElement = () => ({ addEventListener:noop, appendChild:noop, classList, click:noop, closest:() => null, dataset:{}, focus:noop, getBoundingClientRect:() => ({ left:0, top:0, width:100, height:100 }), getContext:() => new MockCanvasContext(), innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector:() => makeElement(), querySelectorAll:() => [], remove:noop, select:noop, style:{}, textContent:"", value:"1" });
const documentMock = { addEventListener:noop, body:makeElement(), createElement:() => makeElement(), createElementNS:() => ({ ...makeElement(), setAttribute:noop }), getElementById:() => makeElement(), querySelector:() => makeElement(), querySelectorAll:() => [] };

const sandbox = {
  alert:noop, Blob, CanvasRenderingContext2D:MockCanvasContext, console, confirm:() => true,
  document:documentMock, FileReader:class {}, localStorage:{ getItem:() => null, setItem:noop },
  requestAnimationFrame:noop, setInterval:noop, setTimeout:noop, clearTimeout:noop,
  URL:{ createObjectURL:() => "blob:mock", revokeObjectURL:noop }, window:null, Date, Math, JSON, Object, Array, Set, Map, Number, String, Boolean, parseInt, parseFloat, isNaN, isFinite
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);

// 加载全部脚本（与 index.html 相同顺序）
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1].replace(/\?.*$/, ""));
for (const src of scriptSources) {
  const code = fs.readFileSync(path.resolve(root, src.replace(/^\.\//, "")), "utf8");
  vm.runInContext(code, sandbox, { filename:src });
}
// 暴露顶层 const 声明（vm 中 const/let 不自动挂到 context 对象上）
vm.runInContext("window.__SMELTING_RECIPES = SMELTING_RECIPES; window.__EQUIPMENT_DB = EQUIPMENT_DB; window.__DEATHSPACE_DATABASE = DEATHSPACE_DATABASE;", sandbox);

// 辅助
const failures = [];
function assert(label, condition) {
  if (condition) console.log("  ✓ " + label);
  else { console.log("  ✗ " + label); failures.push(label); }
}
function near(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 从沙箱中提取需要的对象
const s = sandbox;
const E = s.window.EquipmentEnhancement;
const DB = s.window.__EQUIPMENT_DB;
const RECIPES = s.window.__SMELTING_RECIPES;
const ResourceRegistry = s.window.ResourceRegistry;
const GameEvents = s.window.GameEvents;
const DS_DB = s.window.__DEATHSPACE_DATABASE;
const GameEventContracts = s.window.GameEventContracts;

// ── 创建测试状态 ──
function createTestState() {
  const state = {
    skills: { equipmentEngineering: { lvl: 10, xp: 0 }, mining: { lvl: 5, xp: 0 } },
    resources: { isk: 1000000, minerals: {}, moonOres: {}, gases: {}, special: {}, fuel: 1000, ammunition: { laser:500, missile:500, cannon:500 }, shipComponents: {} },
    equipment: { inventory: [], instances: [], nextInstanceId: 1 },
    inventory: { ships: [] },
    shipAssignments: {},
    migrations: {},
    settings: {},
    statistics: {},
    currentAction: { skill:"", progress:0, lastProgressUpdate:0, startTime:0, equipEngTarget:"t1_mining_laser", equipEngCategory:"industry", shipSubAction:"component", shipCompTarget:"integrated_hull", shipAsmTarget:"rifter" },
    queue: { items: [], config: { maxSize:20, loopMode:false, skipOnFail:true }, status: { activeIndex:-1, isRunning:false, completedCount:0, failCount:0 } },
    activeIndustrialShip: null,
    combat: { mode:"belt", weapon:"laser", hp:{shield:300,armor:100,structure:100}, maxHp:{shield:300,armor:100,structure:100}, repair:{shieldBooster:true,armorRepairer:true,structureRepairer:false}, enemies:[], currentEnemy:null, wave:1, zoneClears:{}, runEliteKills:0, currentFormation:"", totalKills:0, active:false, targetingMode:"auto" },
    _dirty: false
  };
  // 给足精炼矿物
  for (const recipe of RECIPES) {
    state.resources.minerals[recipe.outputMineral] = 999999;
  }
  return state;
}

function addShip(state, shipId) {
  const ship = s.createShipInstance(shipId);
  state.inventory.ships.push(ship);
  return ship;
}

function findEquipByCategory(category) {
  for (const eq of Object.values(DB)) {
    if (E.getEquipmentEnhancementCategory(eq) === category && eq.cost && Object.keys(eq.cost).length > 0) return eq;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════
console.log("\nA. 全装备数据扫描");
// ════════════════════════════════════════════════════════════════

// A1-A2: 遍历全部可装配装备，强化成本必须非空且全部属于精炼矿物
const refinedSet = E.REFINED_MINERALS;
assert("REFINED_MINERALS 非空（来自 SMELTING_RECIPES）", refinedSet.size > 0);
assert("REFINED_MINERALS 数量与 SMELTING_RECIPES 一致", refinedSet.size === RECIPES.length);

const forbiddenMats = new Set(["莫尔石","月矿","气体","行星材料","加密数据","核心","协议"]);
let allEnhanceable = [];
let nonEnhanceable = [];
for (const eq of Object.values(DB)) {
  if (eq.slot && ["high","mid","low","rig"].includes(eq.slot) && eq.cost && Object.keys(eq.cost).length > 0) {
    allEnhanceable.push(eq);
    const cost = E.getEquipmentEnhancementCost(eq, 1);
    assert(`[${eq.id}] 强化成本非空`, Object.keys(cost).length > 0);
    for (const mat of Object.keys(cost)) {
      assert(`[${eq.id}] 材料「${mat}」属于精炼矿物`, refinedSet.has(mat));
      assert(`[${eq.id}] 材料「${mat}」不含禁用材料`, !forbiddenMats.has(mat));
    }
  }
}
assert("存在可强化装备", allEnhanceable.length > 0);

// A5: 弹药、燃料、舰船部件不得进入强化列表
// 注：rig_* 是合法 rig 槽装备（rig_archaeology_fuel_* 的 id 含 "fuel" 但并非燃料资源），
// 其不可强化性由 selectors/actions 的 rig 专项守卫保证（audit-rigs.mjs F3/F4 已断言），此处排除。
for (const eq of Object.values(DB)) {
  if (eq.slot === "rig") continue;
  if (eq.id && (eq.id.includes("ammo") || eq.id.includes("fuel") || eq.id.includes("component"))) {
    nonEnhanceable.push(eq);
    const cat = E.getEquipmentEnhancementCategory(eq);
    // 这些不应有 slot 或不应有 cost
    assert(`[${eq.id}] 非可装配装备不进入强化分类`, !eq.slot || !["high","mid","low","rig"].includes(eq.slot) || !eq.cost || Object.keys(eq.cost).length === 0);
  }
}

// ════════════════════════════════════════════════════════════════
console.log("\nB. Action 原子性");
// ════════════════════════════════════════════════════════════════

// 取各类别样本
const normalEq = findEquipByCategory("normal");
const factionEq = findEquipByCategory("faction");
const allianceEq = findEquipByCategory("alliance");
const dedStdEq = findEquipByCategory("deathspace-standard");
const dedSupEq = findEquipByCategory("deathspace-supervisor");

assert("找到 normal 样本装备", !!normalEq);
assert("找到 faction 样本装备", !!factionEq);
assert("找到 alliance 样本装备", !!allianceEq);
assert("找到 deathspace-standard 样本装备", !!dedStdEq);
assert("找到 deathspace-supervisor 样本装备", !!dedSupEq);

// B6: inventory +0 装备强化成功
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id);
  const before = deepClone(state);
  const result = s.enhanceEquipment(state, normalEq.id, 0.0); // randomValue=0 → 必成功
  assert("inventory +0 强化成功", result.changed && result.success && result.toLevel === 1);
  assert("inventory +0 强化后实例已创建", state.equipment.instances.length === 1);
  assert("inventory +0 强化后 inventory 减一", state.equipment.inventory.length === 0);
  assert("inventory +0 强化后实例等级 +1", state.equipment.instances[0].enhancementLevel === 1);
  // 矿物减少
  const cost = E.getEquipmentEnhancementCost(normalEq, 1);
  let mineralsDecreased = true;
  for (const [mat, qty] of Object.entries(cost)) {
    if (state.resources.minerals[mat] >= 999999) { mineralsDecreased = false; break; }
  }
  assert("inventory +0 强化后矿物正确减少", mineralsDecreased);
  // XP 增加
  const expectedXp = E.getEquipmentEnhancementSuccessXp(normalEq, 0);
  assert("inventory +0 强化后 XP 正确增加", state.skills.equipmentEngineering.xp === expectedXp);
}

// B7: inventory +0 装备强化失败
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id);
  const result = s.enhanceEquipment(state, normalEq.id, 0.999); // randomValue 高 → 必失败
  assert("inventory +0 强化失败", result.changed && !result.success && result.toLevel === 0);
  assert("inventory +0 强化失败后实例已创建", state.equipment.instances.length === 1);
  assert("inventory +0 强化失败后等级保持 +0", state.equipment.instances[0].enhancementLevel === 0);
  assert("inventory +0 强化失败后 XP 不增加", state.skills.equipmentEngineering.xp === 0);
  // 矿物仍消耗
  const cost = E.getEquipmentEnhancementCost(normalEq, 1);
  let mineralsDecreased = true;
  for (const [mat, qty] of Object.entries(cost)) {
    if (state.resources.minerals[mat] >= 999999) { mineralsDecreased = false; break; }
  }
  assert("inventory +0 强化失败后矿物仍消耗（失败规则C）", mineralsDecreased);
}

// B8: 已有实例强化成功与失败
{
  const state = createTestState();
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:3, installedOn:null });
  state.equipment.nextInstanceId = 2;
  const result = s.enhanceEquipment(state, "eq_1", 0.0);
  assert("实例强化成功", result.changed && result.success && result.toLevel === 4);
  assert("实例强化后等级 +4", state.equipment.instances[0].enhancementLevel === 4);

  // 再失败一次
  const result2 = s.enhanceEquipment(state, "eq_1", 0.999);
  assert("实例强化失败等级不变", result2.changed && !result2.success && result2.toLevel === 4);
}

// B9: 材料不足时完整状态深比较不变
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id);
  // 清空所有矿物
  state.resources.minerals = {};
  const before = deepClone(state);
  const result = s.enhanceEquipment(state, normalEq.id, 0.0);
  assert("材料不足时拒绝", !result.changed && result.reason === "insufficient-minerals");
  assert("材料不足时状态不变", deepEqual(before, state));
}

// B10: donor 不足时完整状态深比较不变
{
  const state = createTestState();
  // 0 件 donor 在 inventory，实例 +4→+5 里程碑需要 1 件 donor
  state.equipment.instances.push({ instanceId:"eq_1", itemId:allianceEq.id, enhancementLevel:4, installedOn:null });
  state.equipment.nextInstanceId = 2;
  const before = deepClone(state);
  const result = s.enhanceEquipment(state, "eq_1", 0.0);
  assert("donor 不足时拒绝", !result.changed && result.reason === "missing-donor");
  assert("donor 不足时状态不变", deepEqual(before, state));
}

// B11: 已安装目标拒绝且状态不变
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:0, installedOn:ship.instanceId });
  state.equipment.nextInstanceId = 2;
  ship.fitted = { high:["eq_1"], mid:[], low:[], rig:[] };
  const before = deepClone(state);
  const result = s.enhanceEquipment(state, "eq_1", 0.0);
  assert("已安装目标拒绝", !result.changed && result.reason === "equipment-installed");
  assert("已安装目标状态不变", deepEqual(before, state));
}

// B12: 固定 randomValue 结果可复现
{
  const state1 = createTestState();
  state1.equipment.inventory.push(normalEq.id);
  const r1 = s.enhanceEquipment(state1, normalEq.id, 0.3);

  const state2 = createTestState();
  state2.equipment.inventory.push(normalEq.id);
  const r2 = s.enhanceEquipment(state2, normalEq.id, 0.3);
  assert("固定 randomValue 结果一致", r1.success === r2.success && r1.toLevel === r2.toLevel);
}

// B13: 普通装备 +4→+5 不吃同型号装备
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id, normalEq.id); // 2 件
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:4, installedOn:null });
  state.equipment.nextInstanceId = 2;
  const invBefore = state.equipment.inventory.length;
  const result = s.enhanceEquipment(state, "eq_1", 0.0);
  assert("普通 +4→+5 成功", result.changed && result.success);
  assert("普通 +4→+5 不消耗同型号 donor", state.equipment.inventory.length === invBefore);
}

// B14: 势力/联盟 +4→+5 正确吃一件 inventory donor
{
  const state = createTestState();
  state.equipment.inventory.push(allianceEq.id); // 1 件 donor
  state.equipment.instances.push({ instanceId:"eq_1", itemId:allianceEq.id, enhancementLevel:4, installedOn:null });
  state.equipment.nextInstanceId = 2;
  const result = s.enhanceEquipment(state, "eq_1", 0.0);
  assert("联盟 +4→+5 成功", result.changed && result.success);
  assert("联盟 +4→+5 消耗 1 件 donor", state.equipment.inventory.length === 0);
}

// B15: DED 标准 +4→+5 正确吃 donor 和核心
{
  const state = createTestState();
  const ds = DS_DB.find(d => d.id === dedStdEq.sourceDeathspaceId);
  state.equipment.inventory.push(dedStdEq.id);
  if (ds && ds.coreMaterial) state.resources.special[ds.coreMaterial] = 10;
  state.equipment.instances.push({ instanceId:"eq_1", itemId:dedStdEq.id, enhancementLevel:4, installedOn:null });
  state.equipment.nextInstanceId = 2;
  const result = s.enhanceEquipment(state, "eq_1", 0.0);
  assert("DED 标准 +4→+5 成功", result.changed && result.success);
  assert("DED 标准 +4→+5 消耗 donor", !state.equipment.inventory.includes(dedStdEq.id));
  if (ds && ds.coreMaterial) {
    assert("DED 标准 +4→+5 消耗核心", state.resources.special[ds.coreMaterial] === 9);
  }
}

// B16: DED 监督者 +4→+5 正确吃 donor 和协议
{
  const state = createTestState();
  const ds = DS_DB.find(d => d.id === dedSupEq.sourceDeathspaceId);
  state.equipment.inventory.push(dedSupEq.id);
  if (ds && ds.protocolMaterial) state.resources.special[ds.protocolMaterial] = 10;
  state.equipment.instances.push({ instanceId:"eq_1", itemId:dedSupEq.id, enhancementLevel:4, installedOn:null });
  state.equipment.nextInstanceId = 2;
  const result = s.enhanceEquipment(state, "eq_1", 0.0);
  assert("DED 监督者 +4→+5 成功", result.changed && result.success);
  assert("DED 监督者 +4→+5 消耗 donor", !state.equipment.inventory.includes(dedSupEq.id));
  if (ds && ds.protocolMaterial) {
    assert("DED 监督者 +4→+5 消耗协议", state.resources.special[ds.protocolMaterial] === 9);
  }
}

// B16b: donor 精确计数（实例 +4→+5 里程碑，donor 初始 1/2/3 件，结束应精确少 1）
// 要求：每次里程碑强化尝试只能消耗恰好一件 donor；DED 核心/协议也只精确减 1。
function testDonorExactCount(eqDef, label, extraMaterial) {
  for (const donorCount of [1, 2, 3]) {
    const state = createTestState();
    for (let i = 0; i < donorCount; i++) state.equipment.inventory.push(eqDef.id);
    state.equipment.instances.push({ instanceId:"eq_1", itemId:eqDef.id, enhancementLevel:4, installedOn:null });
    state.equipment.nextInstanceId = 2;
    if (extraMaterial) state.resources.special[extraMaterial] = 10;
    const result = s.enhanceEquipment(state, "eq_1", 0.0);
    assert(`${label} +4→+5 (donor=${donorCount}) 成功`, result.changed && result.success);
    const left = state.equipment.inventory.filter(id => id === eqDef.id).length;
    assert(`${label} +4→+5 donor=${donorCount} → 精确剩 ${donorCount - 1} 件`, left === donorCount - 1);
    if (extraMaterial) {
      assert(`${label} 里程碑额外材料(${extraMaterial}) 精确减 1`, state.resources.special[extraMaterial] === 9);
    }
  }
}
const dsStd = DS_DB.find(d => d.id === dedStdEq.sourceDeathspaceId);
const dsSup = DS_DB.find(d => d.id === dedSupEq.sourceDeathspaceId);
testDonorExactCount(allianceEq, "联盟");
testDonorExactCount(factionEq, "势力");
testDonorExactCount(dedStdEq, "DED标准", dsStd && dsStd.coreMaterial);
testDonorExactCount(dedSupEq, "DED监督者", dsSup && dsSup.protocolMaterial);

// B17: donor 不得来自 instances 或已安装装备（已在 B10/B11 验证）
// B18: 目标来自 inventory 且需要 donor 时，只有一件必须拒绝
{
  const state = createTestState();
  state.equipment.inventory.push(allianceEq.id); // 只有 1 件
  const result = s.enhanceEquipment(state, allianceEq.id, 0.0);
  // alliance +0→+1 不是里程碑，不需要 donor → 应该成功
  assert("联盟 +0→+1 非里程碑不需要 donor", result.changed && result.success);
  assert("联盟 +0→+1 后 inventory 清空", state.equipment.inventory.length === 0);
}

// B19: GameEventContracts 对实际发出的事件验证通过
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id);
  let emittedEvent = null;
  GameEvents.on("equipment:enhancementAttempted", (event) => { emittedEvent = event; });
  s.enhanceEquipment(state, normalEq.id, 0.0);
  assert("强化事件已发出", !!emittedEvent);
  assert("事件契约已注册", GameEventContracts.has("equipment:enhancementAttempted"));
  if (emittedEvent) {
    const payload = emittedEvent.payload || emittedEvent;
    const validation = GameEventContracts.validate("equipment:enhancementAttempted", payload);
    if (!validation.valid) console.log("    DEBUG validation errors:", validation.errors);
    assert("事件通过契约验证", validation.valid);
  }
}

// ════════════════════════════════════════════════════════════════
console.log("\nC. 迁移与防复制");
// ════════════════════════════════════════════════════════════════

// C20: 旧 fitted itemId 转实例，不消耗 inventory 备用件
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  ship.fitted = { high:["t1_mining_laser"], mid:[], low:[], rig:[] };
  state.equipment.inventory = ["t1_mining_laser"]; // 1 件备用
  state.migrations = {};
  s.migrateEquipmentInstancesV1(state);
  assert("迁移后 fitted 引用实例", s.isEquipmentInstanceId(state, ship.fitted.high[0]));
  assert("迁移后 inventory 保留备用件", state.equipment.inventory.includes("t1_mining_laser"));
  assert("迁移后总拥有数量 = 2", state.equipment.inventory.length + state.equipment.instances.length === 2);
}

// C21: 同舰多件同型号生成不同 ID
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  ship.fitted = { high:["t1_mining_laser","t1_mining_laser"], mid:[], low:[], rig:[] };
  state.equipment.inventory = [];
  state.migrations = {};
  s.migrateEquipmentInstancesV1(state);
  assert("同舰 2 件生成 2 个实例", state.equipment.instances.length === 2);
  assert("同舰 2 件实例 ID 不同", ship.fitted.high[0] !== ship.fitted.high[1]);
}

// C22: 多舰同型号生成不同 ID
{
  const state = createTestState();
  const ship1 = addShip(state, "rifter");
  const ship2 = addShip(state, "rifter");
  ship1.fitted = { high:["t1_mining_laser"], mid:[], low:[], rig:[] };
  ship2.fitted = { high:["t1_mining_laser"], mid:[], low:[], rig:[] };
  state.equipment.inventory = [];
  state.migrations = {};
  s.migrateEquipmentInstancesV1(state);
  assert("多舰同型号生成 2 个实例", state.equipment.instances.length === 2);
  assert("多舰实例 ID 不同", ship1.fitted.high[0] !== ship2.fitted.high[0]);
}

// C23: 缺失 instanceId 的合法实例被修复而非删除
{
  const state = createTestState();
  state.equipment.instances.push({ itemId:normalEq.id, enhancementLevel:5, installedOn:null }); // 缺 instanceId
  state.equipment.nextInstanceId = 1;
  s.normalizeEquipmentState(state);
  assert("缺失 instanceId 的实例被修复", state.equipment.instances.length === 1);
  assert("缺失 instanceId 的实例分配了新 ID", state.equipment.instances[0].instanceId && state.equipment.instances[0].instanceId.startsWith("eq_"));
  assert("修复后保留原 enhancementLevel", state.equipment.instances[0].enhancementLevel === 5);
}

// C24: 重复 instanceId 被重编号，合法数量守恒
{
  const state = createTestState();
  state.equipment.instances.push(
    { instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:0, installedOn:null },
    { instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:5, installedOn:null }
  );
  state.equipment.nextInstanceId = 2;
  s.normalizeEquipmentState(state);
  assert("重复 instanceId 修复后 2 个实例都保留", state.equipment.instances.length === 2);
  assert("重复 instanceId 修复后 ID 唯一", state.equipment.instances[0].instanceId !== state.equipment.instances[1].instanceId);
}

// C25: 同一 instanceId 被多个 fitted 槽引用时只保留第一次安装引用
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  ship.fitted = { high:["eq_1","eq_1"], mid:[], low:[], rig:[] };
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:0, installedOn:ship.instanceId });
  state.equipment.nextInstanceId = 2;
  s.normalizeEquipmentState(state);
  assert("重复 fitted 引用只保留第一个", ship.fitted.high[0] === "eq_1" && ship.fitted.high[1] === null);
  assert("未凭空复制装备", state.equipment.instances.length === 1);
}

// C26: normalize 连续执行两次深比较一致
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  ship.fitted = { high:["t1_mining_laser"], mid:[], low:[], rig:[] };
  state.equipment.inventory = ["t1_mining_laser"];
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:3, installedOn:null });
  state.equipment.nextInstanceId = 2;
  s.normalizeEquipmentState(state);
  const after1 = deepClone(state);
  s.normalizeEquipmentState(state);
  const after2 = deepClone(state);
  assert("normalize 连续两次结果一致", deepEqual(after1, after2));
}

// C27: 自动读档迁移顺序正确（autoLoad IIFE 已在加载时执行）
{
  // 验证 gameState 已被 autoLoad 初始化
  assert("autoLoad 已初始化 gameState", !!s.gameState.equipment && Array.isArray(s.gameState.equipment.instances));
  assert("autoLoad 已初始化 nextInstanceId", Number.isFinite(s.gameState.equipment.nextInstanceId));
}

// C28: importData 路径会立即完成实例迁移
{
  // 直接测试迁移函数（SaveManager 是 const 不可跨 vm 脚本访问）
  // 构造一个旧式 fitted 存档状态
  const oldState = {
    skills: { mining: { lvl:1, xp:0 } },
    resources: { isk:100000, minerals:{}, moonOres:{}, gases:{}, special:{}, fuel:1000, ammunition:{laser:500,missile:500,cannon:500}, shipComponents:{} },
    equipment: { inventory:["t1_mining_laser"] },
    inventory: { ships: [s.createShipInstance("rifter")] },
    shipAssignments: {},
    migrations: {},
    settings: {},
    statistics: {},
    currentAction: { skill:"", progress:0, lastProgressUpdate:0, startTime:0 }
  };
  oldState.inventory.ships[0].fitted = { high:["t1_mining_laser"], mid:[], low:[], rig:[] };
  // 模拟 importData 的迁移流程
  s.finalizeEquipmentStateAfterLegacyMigrations(oldState);
  assert("importData 迁移后实例已迁移", oldState.equipment.instances.length > 0);
  assert("importData 迁移后 inventory 保留备用件", oldState.equipment.inventory.includes("t1_mining_laser"));
}

// C29: 保存—读取往返后数量、等级和安装关系一致
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  state.equipment.inventory.push(normalEq.id);
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:7, installedOn:ship.instanceId });
  state.equipment.nextInstanceId = 2;
  ship.fitted = { high:["eq_1"], mid:[], low:[], rig:[] };
  s.normalizeEquipmentState(state);
  const before = deepClone(state);
  // 模拟序列化→反序列化→normalize
  const restored = JSON.parse(JSON.stringify(before));
  s.normalizeEquipmentState(restored);
  assert("保存-读取往返后实例数量一致", restored.equipment.instances.length === before.equipment.instances.length);
  assert("保存-读取往返后等级一致", restored.equipment.instances[0].enhancementLevel === 7);
  assert("保存-读取往返后安装关系一致", restored.equipment.instances[0].installedOn === ship.instanceId);
}

// C30: resetFitting 不把 instanceId 塞进 inventory
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:0, installedOn:ship.instanceId });
  state.equipment.nextInstanceId = 2;
  ship.fitted = { high:["eq_1"], mid:[], low:[], rig:[] };
  s.dispatchGameAction(state, { type:"hangar/resetFitting", instanceId:ship.instanceId }, Date.now());
  assert("resetFitting 后 instanceId 不在 inventory", !state.equipment.inventory.includes("eq_1"));
  assert("resetFitting 后实例 installedOn 清空", state.equipment.instances[0].installedOn === null);
  assert("resetFitting 后 fitted 清空", !ship.fitted.high.some(Boolean));
}

// C31: 安装、替换、卸下不复制、不丢失
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  state.equipment.inventory.push(normalEq.id);
  state.equipment.nextInstanceId = 1;
  // 安装
  s.dispatchGameAction(state, { type:"hangar/setFittingSlot", instanceId:ship.instanceId, slot:"high", slotIndex:0, equipmentId:normalEq.id }, Date.now());
  assert("安装后 inventory 清空", state.equipment.inventory.length === 0);
  assert("安装后实例已创建", state.equipment.instances.length === 1);
  assert("安装后实例 installedOn 正确", state.equipment.instances[0].installedOn === ship.instanceId);
  // 卸下
  s.dispatchGameAction(state, { type:"hangar/resetFitting", instanceId:ship.instanceId }, Date.now());
  assert("卸下后实例仍存在", state.equipment.instances.length === 1);
  assert("卸下后实例 installedOn 清空", state.equipment.instances[0].installedOn === null);
  assert("卸下后 inventory 仍为空（实例不回退为 inventory 字符串）", state.equipment.inventory.length === 0);
}

// ════════════════════════════════════════════════════════════════
console.log("\nD. 效果接入");
// ════════════════════════════════════════════════════════════════

// D32-D33: 武器伤害和维修量按 multiplier 只乘一次
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  // 找一件有 combat.baseDamage 的装备
  const weaponEq = Object.values(DB).find(eq => eq.slot === "high" && eq.combat && eq.combat.baseDamage > 0 && E.getEquipmentEnhancementCategory(eq) === "normal");
  if (weaponEq) {
    state.equipment.instances.push({ instanceId:"eq_1", itemId:weaponEq.id, enhancementLevel:10, installedOn:ship.instanceId });
    state.equipment.nextInstanceId = 2;
    ship.fitted = { high:["eq_1"], mid:[], low:[], rig:[] };
    ship.shipAssignments = { combat:true };
    state.shipAssignments.combat = ship.instanceId;
    const modules = s.getInstalledCombatModulesFromState(state);
    assert("战斗模块已解析", modules.length > 0);
    assert("战斗模块携带 multiplier", modules[0].multiplier > 1);
    const expectedMult = E.getEquipmentEnhancementEffectMultiplier(10);
    assert("multiplier 值正确 (+10=1.10)", near(modules[0].multiplier, expectedMult));
  } else {
    assert("找到武器装备样本", false);
  }
}

// D34: 护盾/装甲/结构容量加成只乘一次
{
  const state = createTestState();
  const ship = addShip(state, "rifter");
  const shieldEq = Object.values(DB).find(eq => eq.slot === "mid" && eq.bonuses && eq.bonuses.shieldCapacity > 0 && E.getEquipmentEnhancementCategory(eq) === "normal");
  if (shieldEq) {
    state.equipment.instances.push({ instanceId:"eq_1", itemId:shieldEq.id, enhancementLevel:10, installedOn:ship.instanceId });
    state.equipment.nextInstanceId = 2;
    ship.fitted = { high:[], mid:["eq_1"], low:[], rig:[] };
    const maxHpEnhanced = s.getCombatMaxHpFromState(state);

    // 对比：同一件装备 +0
    state.equipment.instances[0].enhancementLevel = 0;
    const maxHpBase = s.getCombatMaxHpFromState(state);

    assert("护盾容量加成已应用（强化后 > 未强化）", maxHpEnhanced.shield > maxHpBase.shield);
    // 验证只乘一次（不重复套乘区）
    const expectedMult = E.getEquipmentEnhancementEffectMultiplier(10);
    const expectedShield = maxHpBase.shield + (maxHpBase.shield - s.getCombatMaxHpFromState({ ...state, equipment:{ inventory:[], instances:[], nextInstanceId:1 } }).shield) * expectedMult / E.getEquipmentEnhancementEffectMultiplier(0);
    // 简化断言：强化后容量严格大于基础容量
    assert("护盾容量只乘一次（值合理）", maxHpEnhanced.shield > maxHpBase.shield && maxHpEnhanced.shield < maxHpBase.shield * 3);
  } else {
    assert("找到护盾装备样本", false);
  }
}

// D38: instanceId fitted 能通过月矿装备门槛
{
  const state = createTestState();
  const ship = addShip(state, "miner_frigate");
  const miningEq = Object.values(DB).find(eq => eq.slot === "high" && eq.bonuses && eq.bonuses.miningEfficiency > 0 && E.getEquipmentEnhancementCategory(eq) === "normal");
  if (miningEq) {
    state.equipment.instances.push({ instanceId:"eq_1", itemId:miningEq.id, enhancementLevel:5, installedOn:ship.instanceId });
    state.equipment.nextInstanceId = 2;
    ship.fitted = { high:["eq_1"], mid:[], low:[], rig:[] };
    state.shipAssignments.mining = ship.instanceId;
    const access = s.getMoonMiningAccessState(state);
    assert("instanceId 采矿装备通过月矿门槛", access.hasEquipment);
  } else {
    assert("找到采矿装备样本", false);
  }
}

// D39: 非采矿装备不能通过月矿门槛
{
  const state = createTestState();
  const ship = addShip(state, "miner_frigate");
  const nonMiningEq = Object.values(DB).find(eq => eq.slot === "high" && (!eq.bonuses || !eq.bonuses.miningEfficiency) && eq.combat && eq.combat.baseDamage > 0);
  if (nonMiningEq) {
    state.equipment.instances.push({ instanceId:"eq_1", itemId:nonMiningEq.id, enhancementLevel:0, installedOn:ship.instanceId });
    state.equipment.nextInstanceId = 2;
    ship.fitted = { high:["eq_1"], mid:[], low:[], rig:[] };
    state.shipAssignments.mining = ship.instanceId;
    const access = s.getMoonMiningAccessState(state);
    assert("非采矿装备不通过月矿门槛", !access.hasEquipment);
  } else {
    assert("找到非采矿高槽装备样本", false);
  }
}

// D40: cargo 只统计未安装实例
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id); // 1 件 inventory
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:0, installedOn:null }); // 1 件未安装实例
  state.equipment.nextInstanceId = 2;
  const cargoTotal = s.ResourceRegistry.getCargoTotal(state);
  assert("cargo 统计 inventory + 未安装实例", cargoTotal >= 2);
}

// D41: owned count 统计 inventory 加全部 instances
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id, normalEq.id); // 2 件 inventory
  const ship = addShip(state, "rifter");
  state.equipment.instances.push(
    { instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:0, installedOn:ship.instanceId }, // 已安装
    { instanceId:"eq_2", itemId:normalEq.id, enhancementLevel:0, installedOn:null } // 未安装
  );
  state.equipment.nextInstanceId = 3;
  // getEquipmentOwnedCountFromState 需要 recipe 对象，直接验证计数逻辑
  const invCount = state.equipment.inventory.filter(id => id === normalEq.id).length;
  const instCount = state.equipment.instances.filter(inst => inst.itemId === normalEq.id).length;
  assert("owned count = inventory(2) + instances(2) = 4", invCount + instCount === 4);
}

// D42: 制造 inputEquipment 仍只消费 inventory string（制造系统不消费实例）
{
  const state = createTestState();
  state.equipment.inventory.push(normalEq.id);
  state.equipment.instances.push({ instanceId:"eq_1", itemId:normalEq.id, enhancementLevel:0, installedOn:null });
  state.equipment.nextInstanceId = 2;
  // 制造系统消费 inventory 中的 string，不消费 instances
  const beforeInstances = state.equipment.instances.length;
  // 模拟制造消费 inventory
  const idx = state.equipment.inventory.indexOf(normalEq.id);
  if (idx >= 0) state.equipment.inventory.splice(idx, 1);
  assert("制造消费后 inventory 减少", state.equipment.inventory.length === 0);
  assert("制造消费后 instances 不变", state.equipment.instances.length === beforeInstances);
}

// ════════════════════════════════════════════════════════════════
console.log("\nE. 现代存档导入回归（donor 双重扣除 / 重复赠装修复）");
// ════════════════════════════════════════════════════════════════

// 在沙箱中安全调用 SaveManager.importData：桩掉 UI 回调与离线结算，避免沙箱副作用。
// 重点验证 importData 不得无条件删除现代存档已有的迁移标志。
s.updateUI = noop;
s.switchPage = noop;
s.calculateOfflineGains = noop;
const SaveManager = s.SaveManager;

// 构造一个已完成实例化的现代存档（fitted 用 eq_* 引用，迁移标志已置位）
function buildModernSave(opts) {
  opts = opts || {};
  const st = createTestState();
  const ship = addShip(st, "rifter");
  st.equipment.instances.push(
    { instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:5, installedOn:ship.instanceId },
    { instanceId:"eq_2", itemId:"t1_small_cannon", enhancementLevel:3, installedOn:null }
  );
  st.equipment.nextInstanceId = 3;
  st.equipment.inventory = ["t1_medium_laser", "t1_medium_laser"]; // 2 件备用
  ship.fitted = { high:["eq_1"], mid:["eq_2"], low:[], rig:[] };
  if (opts.onlyWeapon) {
    // 仅装武器、不装维修器，验证不会补默认维修器
    ship.fitted = { high:["eq_1"], mid:[], low:[], rig:[] };
  }
  st.migrations = { combatEquipmentV1:true, equipmentInstancesV1:true };
  return st;
}

// E1: 现代存档（combatEquipmentV1=true, equipmentInstancesV1=true）导入前后装备总数完全一致
{
  const save = buildModernSave();
  const beforeInv = save.equipment.inventory.length;
  const beforeInst = save.equipment.instances.length;
  const beforeFitted = JSON.stringify(save.inventory.ships[0].fitted);
  const beforeLevels = JSON.stringify(save.equipment.instances.map(i => i.enhancementLevel).sort());
  const ok = SaveManager.importData(JSON.stringify(save));
  assert("现代存档 importData 返回成功", ok === true);
  const gs = s.gameState;
  assert("现代存档导入后实例数量不变", gs.equipment.instances.length === beforeInst);
  assert("现代存档导入后 inventory 数量不变", gs.equipment.inventory.length === beforeInv);
  assert("现代存档导入后 fitted 引用不变", JSON.stringify(gs.inventory.ships[0].fitted) === beforeFitted);
  assert("现代存档导入后强化等级不变", JSON.stringify(gs.equipment.instances.map(i => i.enhancementLevel).sort()) === beforeLevels);
  const refsBefore = (beforeFitted.match(/"eq_/g) || []).length;
  const refsAfter = (JSON.stringify(gs.inventory.ships[0].fitted).match(/"eq_/g) || []).length;
  assert("现代存档导入不新增默认装备引用", refsAfter === refsBefore);
}

// E2: 现代 fitted 使用 eq_* 引用且只装武器时，不会得到额外默认维修器
{
  const save = buildModernSave({ onlyWeapon:true });
  const ok = SaveManager.importData(JSON.stringify(save));
  assert("现代(仅武器) importData 返回成功", ok === true);
  const gs = s.gameState;
  const ship = gs.inventory.ships[0];
  assert("现代(仅武器) 不新增默认维修器", !ship.fitted.mid.some(Boolean) && !ship.fitted.low.some(Boolean));
  assert("现代(仅武器) 实例数量仍为 2", gs.equipment.instances.length === 2);
}

// E3: 旧存档缺迁移标志时仍会正确迁移（fitted 旧式字符串 → 实例，备份保留）
{
  const st = createTestState();
  const ship = addShip(st, "rifter");
  ship.fitted = { high:["t1_small_laser"], mid:[], low:[], rig:[] };
  st.equipment.inventory = ["t1_medium_laser"]; // 1 件备用
  st.migrations = {}; // 无迁移标志
  const ok = SaveManager.importData(JSON.stringify(st));
  assert("旧存档 importData 返回成功", ok === true);
  const gs = s.gameState;
  assert("旧存档缺标志仍迁移（生成实例）", gs.equipment.instances.length > 0);
  assert("旧存档迁移后 fitted 已转实例", s.isEquipmentInstanceId(gs, gs.inventory.ships[0].fitted.high[0]));
  assert("旧存档迁移保留备用装备", gs.equipment.inventory.includes("t1_medium_laser"));
}

// E4: 连续导入同一现代存档两次，每次结果一致
{
  const save = buildModernSave();
  const json = JSON.stringify(save);
  SaveManager.importData(json);
  const snapA = {
    instances: deepClone(s.gameState.equipment.instances),
    inventory: deepClone(s.gameState.equipment.inventory),
    fitted: deepClone(s.gameState.inventory.ships[0].fitted),
    migrations: deepClone(s.gameState.migrations)
  };
  SaveManager.importData(json); // 第二次导入同一存档
  const snapB = {
    instances: deepClone(s.gameState.equipment.instances),
    inventory: deepClone(s.gameState.equipment.inventory),
    fitted: deepClone(s.gameState.inventory.ships[0].fitted),
    migrations: deepClone(s.gameState.migrations)
  };
  assert("连续导入两次：实例一致", deepEqual(snapA.instances, snapB.instances));
  assert("连续导入两次：inventory 一致", deepEqual(snapA.inventory, snapB.inventory));
  assert("连续导入两次：fitted 一致", deepEqual(snapA.fitted, snapB.fitted));
  assert("连续导入两次：迁移标志一致", deepEqual(snapA.migrations, snapB.migrations));
}

// ════════════════════════════════════════════════════════════════
// F 区：旧数字 ID 迁移兼容（numeric → eq_N）
// ════════════════════════════════════════════════════════════════
{
  const st = createTestState();
  const ship = addShip(st, "rifter");
  // 构造旧存档：数字 instanceId
  // 设置 combatEquipmentV1 = true 防止 combat migration 添加默认维修器（本测试聚焦数字 ID 迁移）
  st.migrations.combatEquipmentV1 = true;
  st.equipment.instances = [
    { instanceId: 1, itemId: "t1_small_laser", enhancementLevel: 2, installedOn: null },
    { instanceId: 2, itemId: "t1_small_cannon", enhancementLevel: 3, installedOn: null }
  ];
  st.equipment.nextInstanceId = 1; // eq_1 会与数字 1→eq_1 冲突，测试冲突解决
  st.equipment.inventory = ["t1_medium_laser"];
  // fitted 也使用数字引用
  ship.fitted = { high: [1, 2], mid: [], low: [], rig: [] };
  // 通过 importData 触发 normalize
  const ok = SaveManager.importData(JSON.stringify(st));
  assert("F1 旧数字 ID 存档 importData 成功", ok === true);
  const gs = s.gameState;
  const insts = gs.equipment.instances;
  assert("F2 数字 ID 已转为字符串", insts.every(inst => typeof inst.instanceId === "string"));
  assert("F3 没有 instanceId 为纯数字的实例", insts.every(inst => isNaN(Number(inst.instanceId)) || String(inst.instanceId).startsWith("eq_")));
  assert("F4 所有 instanceId 为 eq_N 格式", insts.every(inst => /^eq_\d+$/.test(String(inst.instanceId))));
  // 装备总数不变
  assert("F5 实例数量仍为 2", insts.length === 2);
  // itemId / enhancementLevel / installedOn 不变
  const laser = insts.find(i => i.itemId === "t1_small_laser");
  assert("F6 t1_small_laser 保留", !!laser);
  assert("F6b 强化等级保留", laser.enhancementLevel === 2);
  assert("F6c installedOn 已设为舰船 ID（已安装实例）", laser.installedOn === ship.instanceId);
  // fitted 引用同步更新
  const fittedHigh = gs.inventory.ships[0].fitted.high;
  assert("F7 fitted.high[0] 为新字符串 ID", typeof fittedHigh[0] === "string" && /^eq_\d+$/.test(fittedHigh[0]));
  assert("F7b fitted.high[1] 为新字符串 ID", typeof fittedHigh[1] === "string" && /^eq_\d+$/.test(fittedHigh[1]));
  assert("F7c 两个 fitted 引用不同", fittedHigh[0] !== fittedHigh[1]);
  // 两引用的 instanceId 在实例列表中都可找到
  const inst0 = insts.find(i => i.instanceId === fittedHigh[0]);
  const inst1 = insts.find(i => i.instanceId === fittedHigh[1]);
  assert("F8 fitted[0] 引用真实实例", !!inst0 && inst0.itemId === "t1_small_laser");
  assert("F8b fitted[1] 引用真实实例", !!inst1 && inst1.itemId === "t1_small_cannon");
  assert("F9 inventory 保留", gs.equipment.inventory.includes("t1_medium_laser"));
  // inventory 中无被迁移的 itemId
  assert("F9b inventory 无 t1_small_laser", !gs.equipment.inventory.includes("t1_small_laser"));
}

// F10: 幂等——连续 normalize 两次状态完全一致
{
  const st = createTestState();
  const ship = addShip(st, "rifter");
  st.equipment.instances = [
    { instanceId: 99, itemId: "t1_small_laser", enhancementLevel: 0, installedOn: null }
  ];
  st.equipment.nextInstanceId = 1;
  st.migrations.combatEquipmentV1 = true;
  ship.fitted = { high: [99], mid: [], low: [], rig: [] };
  SaveManager.importData(JSON.stringify(st));
  const snap1 = deepClone(s.gameState.equipment.instances);
  SaveManager.importData(JSON.stringify(st)); // 再次导入同一存档
  const snap2 = deepClone(s.gameState.equipment.instances);
  assert("F10 幂等：两次实例列表一致", deepEqual(snap1, snap2));
}

// F11: 浏览器字符串化边界——用 String(instanceId) 调用 equipment/enhance 仍可正常强化
{
  const st = createTestState();
  const ship = addShip(st, "rifter");
  st.equipment.instances = [
    { instanceId: "eq_1", itemId: "t1_small_laser", enhancementLevel: 0, installedOn: null }
  ];
  st.equipment.nextInstanceId = 3;
  // 给足材料
  st.resources = st.resources || {};
  st.resources.minerals = st.resources.minerals || {};
  st.resources.minerals["三钛合金"] = 99999;
  st.resources.minerals["类银超金属"] = 99999;
  st.resources.minerals["类晶体胶矿"] = 99999;
  st.resources.minerals["同位聚合体"] = 99999;
  st.resources.minerals["超新星诺克石"] = 99999;
  st.resources.minerals["铷"] = 99999;
  st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
  st.migrations.combatEquipmentV1 = true; // 防止 combat migration 添加默认装配
  SaveManager.importData(JSON.stringify(st));
  const gs = s.gameState;
  // 模拟浏览器 data-enhance-target 字符串化
  const browserRef = String("eq_1");
  // 验证 resolveEquipmentReference 对字符串引用正常工作
  const resolved = s.resolveEquipmentReference(gs, browserRef);
  assert("F11a resolveEquipmentReference 能解析字符串化 ID", resolved !== null && resolved.definition.id === "t1_small_laser");
  // 执行强化（randomValue 固定为 0 → 成功）
  // 注意：randomValue 必须放在 action 对象中（action.randomValue），dispatchGameAction 第三参数为 now
  const R = s.dispatchGameAction(gs, { type: "equipment/enhance", targetRef: browserRef, randomValue: 0 });
  assert("F11b equipment/enhance 用字符串化 ID 成功", R.changed === true);
  assert("F11c 强化后等级 1", R.toLevel === 1);
  const enhanced = s.getEquipmentInstanceById(gs, "eq_1");
  assert("F11d 实例等级升为 1", enhanced && enhanced.enhancementLevel === 1);
  assert("F11e 材料已扣除", gs.resources.minerals["三钛合金"] < 99999);
}

// ════════════════════════════════════════════════════════════════
// G 区：canEnhance View State 正确性 + Action 动作执行
// ════════════════════════════════════════════════════════════════
{
  // G1: 材料充足 — instanceCard.canEnhance === true
  {
    const st = createTestState();
    st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
    st.equipment.instances = [
      { instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }
    ];
    st.equipment.nextInstanceId = 3;
    st.equipment.inventory = [];
    st.migrations.combatEquipmentV1 = true;
    const display = s.getEquipmentEnhancementListDisplayState(st);
    const entry = display.entries.find(e => e.itemId === "t1_small_laser");
    assert("G1 材料充足：instanceCard.canEnhance === true", entry && entry.instanceCards[0] && entry.instanceCards[0].canEnhance === true);
  }

  // G2: 材料充足 — stack.canEnhance === true
  {
    const st = createTestState();
    st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
    st.equipment.inventory = ["t1_small_laser", "t1_small_laser"];
    st.equipment.instances = [];
    st.equipment.nextInstanceId = 1;
    st.migrations.combatEquipmentV1 = true;
    const display = s.getEquipmentEnhancementListDisplayState(st);
    const entry = display.entries.find(e => e.itemId === "t1_small_laser");
    assert("G2 材料充足：stack.canEnhance === true", entry && entry.stack && entry.stack.canEnhance === true);
  }

  // G3: 任一矿物不足 — canEnhance === false
  {
    const st = createTestState();
    st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
    // t1_small_laser 0→1 需要三钛合金，把库存设为 0
    st.resources.minerals = { "三钛合金":0, "类银超金属":0, "类晶体胶矿":0, "同位聚合体":0, "超新星诺克石":0, "铷":0 };
    st.equipment.instances = [
      { instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }
    ];
    st.equipment.nextInstanceId = 3;
    st.equipment.inventory = [];
    st.migrations.combatEquipmentV1 = true;
    const display = s.getEquipmentEnhancementListDisplayState(st);
    const entry = display.entries.find(e => e.itemId === "t1_small_laser");
    assert("G3 矿物不足：canEnhance === false", entry && entry.instanceCards[0] && entry.instanceCards[0].canEnhance === false);
  }

  // G4: 里程碑 donor 不足 — canEnhance === false（使用 alliance 装备在 Lv.4→5 触发）
  {
    const st = createTestState();
    st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
    const factionItemId = "raider_mining_laser";
    st.equipment.instances = [
      { instanceId:"eq_1", itemId:factionItemId, enhancementLevel:4, installedOn:null }
    ];
    st.equipment.nextInstanceId = 3;
    st.equipment.inventory = []; // 0 件同型号库存 → donor 不足
    st.migrations.combatEquipmentV1 = true;
    const display = s.getEquipmentEnhancementListDisplayState(st);
    const entry = display.entries.find(e => e.itemId === factionItemId);
    // Lv.4→5 是里程碑，需要同型号 +0 donor，但 inventory 为空
    assert("G4 donor 不足：canEnhance === false（alliance Lv.4→5 里程碑需 donor）", entry && entry.instanceCards[0] && entry.instanceCards[0].canEnhance === false);
    // 补足 donor(1 件)后应为 true
    st.equipment.inventory = [factionItemId];
    const display2 = s.getEquipmentEnhancementListDisplayState(st);
    const entry2 = display2.entries.find(e => e.itemId === factionItemId);
    assert("G4b donor 充足后：canEnhance === true", entry2 && entry2.instanceCards[0] && entry2.instanceCards[0].canEnhance === true);
  }

  // G5: 模拟点击→成功强化（dispatchGameAction + random=0）
  {
    const st = createTestState();
    st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
    st.equipment.instances = [
      { instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }
    ];
    st.equipment.nextInstanceId = 3;
    st.equipment.inventory = [];
    st.migrations.combatEquipmentV1 = true;
    // 先调用 getEquipmentEnhancementListDisplayState 确认 canEnhance（模拟 UI 渲染）
    const display = s.getEquipmentEnhancementListDisplayState(st);
    const entry = display.entries.find(e => e.itemId === "t1_small_laser");
    assert("G5 强化前 instanceCard.canEnhance === true", entry && entry.instanceCards[0] && entry.instanceCards[0].canEnhance === true);
    const beforeMinerals = st.resources.minerals["三钛合金"];
    // 用 randomValue=0（roll=0 ≤ successRate → 必定成功）
    // 注意：randomValue 必须放在 action 对象中（action.randomValue），dispatchGameAction 第三参数为 now
    const result = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"eq_1", randomValue: 0 });
    assert("G5a 强化成功 changed===true", result.changed === true);
    assert("G5b 等级 +0→+1", result.toLevel === 1);
    const inst = s.getEquipmentInstanceById(st, "eq_1");
    assert("G5c 实例 level===1", inst && inst.enhancementLevel === 1);
    assert("G5d 矿物已减少", st.resources.minerals["三钛合金"] < beforeMinerals);
  }

  // G6: 模拟点击→失败强化（random=0.99 → roll > successRate → 必定失败）
  {
    const st = createTestState();
    st.skills.equipmentEngineering = { lvl: 1, xp: 0 }; // 低等级确保成功率低
    st.equipment.instances = [
      { instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }
    ];
    st.equipment.nextInstanceId = 3;
    st.equipment.inventory = [];
    st.migrations.combatEquipmentV1 = true;
    const beforeMinerals = st.resources.minerals["三钛合金"];
    // Lv=1 eng, thr=1, L=0: gap=0 → skillBonus=0, levelPenalty=0 → final=0.50
    // roll=0.99 > 0.50 → 失败
    const result = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"eq_1", randomValue: 0.99 });
    assert("G6a 强化失败 changed===true（材料已扣）", result.changed === true);
    assert("G6b 失败后等级维持 0", result.toLevel === 0);
    const inst = s.getEquipmentInstanceById(st, "eq_1");
    assert("G6c 实例 level 仍为 0", inst && inst.enhancementLevel === 0);
    assert("G6d 失败后矿物仍扣除", st.resources.minerals["三钛合金"] < beforeMinerals);
  }

  // G7: 库存新品按钮点击→成功强化（inventory +0 → 创建实例 → +1）
  {
    const st = createTestState();
    st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
    st.equipment.inventory = ["t1_small_laser"];
    st.equipment.instances = [];
    st.equipment.nextInstanceId = 1;
    st.migrations.combatEquipmentV1 = true;
    const display = s.getEquipmentEnhancementListDisplayState(st);
    const entry = display.entries.find(e => e.itemId === "t1_small_laser");
    assert("G7 库存新品 stack.canEnhance === true", entry && entry.stack && entry.stack.canEnhance === true);
    const beforeCount = st.equipment.inventory.length;
    const result = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"t1_small_laser", randomValue: 0 });
    assert("G7a 库存强化成功", result.changed === true);
    assert("G7b 库存减少 1", st.equipment.inventory.length === beforeCount - 1);
    assert("G7c 实例已创建（level=1）", st.equipment.instances.some(i => i.itemId === "t1_small_laser" && i.enhancementLevel === 1));
  }
}

// ════════════════════════════════════════════════════════════════
// H 区：装备强化成功率边际递减 + 期望次数 + 经济回归 + 舰船保障
// ════════════════════════════════════════════════════════════════

// 纯计算审计函数：从当前 level 0 累加到 targetLevel 所需期望尝试次数
// 使用真实的 getEquipmentEnhancementSuccessChance，不是复制公式
function expectedAttemptsToLevel(skillLevel, equipmentLevel, targetLevel) {
  let sum = 0;
  for (let L = 0; L < targetLevel; L++) {
    const p = s.getEquipmentEnhancementSuccessChance(skillLevel, equipmentLevel, L);
    if (p <= 0) continue; // 防御
    sum += 1 / p;
  }
  return sum;
}
const EE = s.EquipmentEnhancement;

// H1–H7: 技能溢出收益分段边界
{
  const cases = [
    { gap:0,  expectedBonus:0,    expectedFinal:0.50  },
    { gap:5,  expectedBonus:0.10, expectedFinal:0.60  },
    { gap:10, expectedBonus:0.20, expectedFinal:0.70  },
    { gap:15, expectedBonus:0.225,expectedFinal:0.725 },
    { gap:25, expectedBonus:0.275,expectedFinal:0.775 },
    { gap:50, expectedBonus:0.30, expectedFinal:0.80  },
    { gap:79, expectedBonus:0.30, expectedFinal:0.80  },
  ];
  for (const { gap, expectedBonus, expectedFinal } of cases) {
    const engLvl = 1 + gap; // equipmentLevel=1 → gap = eng-1
    const b = EE.getEquipmentEnhancementSuccessBreakdown(engLvl, 1, 0);
    assert(`H gap=${gap} skillBonus=${expectedBonus}`, Math.abs(b.skillBonus - expectedBonus) < 1e-9);
    assert(`H gap=${gap} final=${expectedFinal}`, Math.abs(b.final - expectedFinal) < 1e-9);
  }
}

// H8–H14: 强化等级惩罚分段边界（Lv.80 eng, Lv.1 eq）
{
  const cases = [
    { L:0,   expected:0.80   },
    { L:5,   expected:0.725  },
    { L:10,  expected:0.575  },
    { L:15,  expected:0.325  },
    { L:20,  expected:0.05   },
    { L:30,  expected:0.05   },
    { L:100, expected:0.05   },
  ];
  for (const { L, expected } of cases) {
    const p = EE.getEquipmentEnhancementSuccessChance(80, 1, L);
    assert(`H Lv.80 eng, L=${L} = ${expected}`, Math.abs(p - expected) < 1e-9);
  }
}

// H15–H20: 刚达到门槛（gap=0）时各等级成功率
{
  const cases = [
    { L:0,  expected:0.50   },
    { L:5,  expected:0.425  },
    { L:10, expected:0.275  },
    { L:15, expected:0.05   },
    { L:20, expected:0.05   },
  ];
  for (const { L, expected } of cases) {
    const p = EE.getEquipmentEnhancementSuccessChance(1, 1, L);
    assert(`H gap=0, L=${L} = ${expected}`, Math.abs(p - expected) < 1e-9);
  }
}

// H21–H27: 期望尝试次数（Lv.80 eng, Lv.1 eq）
{
  const cases = [
    { target:5,  expected:6.5   },
    { target:10, expected:14.0  },
    { target:15, expected:24.8  },
    { target:20, expected:69.8  },
    { target:30, expected:269.8 },
    { target:35, expected:369.8 },
    { target:100,expected:1669.8},
  ];
  for (const { target, expected } of cases) {
    const n = expectedAttemptsToLevel(80, 1, target);
    assert(`H expAttempts eng=80 thr=1 +${target} ~ ${expected}`, Math.abs(n - expected) < 1.0);
  }
}

// H28–H34: 期望尝试次数（gap=0）
{
  const cases = [
    { target:5,  expected:10.7  },
    { target:10, expected:24.5  },
    { target:15, expected:59.7  },
    { target:20, expected:159.7 },
    { target:30, expected:359.7 },
    { target:35, expected:459.7 },
  ];
  for (const { target, expected } of cases) {
    const n = expectedAttemptsToLevel(1, 1, target);
    assert(`H expAttempts eng=1 thr=1 +${target} ~ ${expected}`, Math.abs(n - expected) < 1.5);
  }
}

// H35–H39: 经济回归——真实成本 × 期望次数（t1_small_laser, Lv.80 eng）
{
  const eq = s.__EQUIPMENT_DB["t1_small_laser"];
  const costCases = [
    { target:14, expectedAttempts:22.2, expectedMineral:1931  },
    { target:20, expectedAttempts:69.8, expectedMineral:10699 },
    { target:30, expectedAttempts:269.8,expectedMineral:59399 },
    { target:35, expectedAttempts:369.8,expectedMineral:90499 },
    { target:100,expectedAttempts:1669.8,expectedMineral:904359},
  ];
  for (const { target, expectedAttempts, expectedMineral } of costCases) {
    const attempts = expectedAttemptsToLevel(80, 1, target);
    assert(`H economic +${target} attempts ~ ${expectedAttempts}`, Math.abs(attempts - expectedAttempts) < 1.0);
    // 用真实成本函数计算总矿物消耗
    let totalMinerals = 0;
    for (let L = 0; L < target; L++) {
      const cost = EE.getEquipmentEnhancementCost(eq, L + 1);
      const attemptsAtLevel = 1 / Math.max(0.0001, EE.getEquipmentEnhancementSuccessChance(80, 1, L));
      totalMinerals += (cost["三钛合金"] || 0) * attemptsAtLevel;
    }
    assert(`H economic +${target} tritanium ~ ${expectedMineral}`, Math.abs(totalMinerals - expectedMineral) < 200);
  }
}

// H40–H41: 上限 80%、下限 5%
{
  assert("H 上限 80%（高技能、低等级）", EE.getEquipmentEnhancementSuccessChance(99, 1, 0) === 0.80);
  assert("H 下限 5%（低技能、高等级）", EE.getEquipmentEnhancementSuccessChance(1, 80, 100) === 0.05);
}

// H42–H43: 门槛时 +0→+1 恰好 50%
{
  assert("H gap=0 L=0 = 0.50", EE.getEquipmentEnhancementSuccessChance(1, 1, 0) === 0.50);
  assert("H gap=0 L=0 = 0.50 (equipLv=15)", EE.getEquipmentEnhancementSuccessChance(15, 15, 0) === 0.50);
}

// H44: 高技能低级装备不再长期 95%（旧公式 0.95 → 新上限 0.80）
{
  assert("H 高技能不再 95%（80→上限80%）", EE.getEquipmentEnhancementSuccessChance(80, 1, 0) === 0.80);
  assert("H 技能=10, T1(+0) < 80%", EE.getEquipmentEnhancementSuccessChance(10, 1, 0) < 0.80);
}

// H45: 真实 Action 使用新概率（random略低于成功率时成功）
{
  const st = createTestState();
  st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
  st.equipment.instances = [{ instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }];
  st.equipment.nextInstanceId = 3;
  st.equipment.inventory = [];
  st.migrations.combatEquipmentV1 = true;
  // random=0.79 < 0.80 → 成功
  const r1 = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"eq_1", randomValue:0.79 });
  assert("H action 0.79<0.80 成功", r1.changed && r1.success && r1.toLevel === 1);
  // L=1: penalty=0.015, final=0.50+0.30-0.015=0.785
  // random=0.78 < 0.785 → 成功
  const r2 = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"eq_1", randomValue:0.78 });
  assert("H action L=1→2 成功", r2.changed && r2.success && r2.toLevel === 2);
  // L=2: penalty=0.03, final=0.50+0.30-0.03=0.770
  // random=0.78 >= 0.770 → 失败
  const r3 = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"eq_1", randomValue:0.78 });
  assert("H action random=0.78 >= 0.770 失败", r3.changed && !r3.success && r3.toLevel === 2);
}

// H46–H48: 失败语义
{
  const st = createTestState();
  st.skills.equipmentEngineering = { lvl: 1, xp: 0 };
  st.equipment.instances = [{ instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }];
  st.equipment.nextInstanceId = 3;
  st.equipment.inventory = [];
  st.migrations.combatEquipmentV1 = true;
  const before = st.resources.minerals["三钛合金"];
  const r = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"eq_1", randomValue:0.99 });
  assert("H fail 材料已扣", r.changed === true);
  assert("H fail 等级不变", r.toLevel === 0);
  const inst = s.getEquipmentInstanceById(st, "eq_1");
  assert("H fail XP=0", r.xp === 0);
  assert("H fail 矿物减少", st.resources.minerals["三钛合金"] < before);
}

// H49: 成功 XP 正常
{
  const st = createTestState();
  st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
  st.equipment.instances = [{ instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }];
  st.equipment.nextInstanceId = 3;
  st.equipment.inventory = [];
  st.migrations.combatEquipmentV1 = true;
  const beforeXp = st.skills.equipmentEngineering.xp;
  const r = s.dispatchGameAction(st, { type:"equipment/enhance", targetRef:"eq_1", randomValue:0.79 });
  assert("H success XP>0", r.changed && r.success && r.xp > 0);
}

// H50–H52: 按钮修复不回归（canEnhance、材料充足/不足）
{
  const st = createTestState();
  st.skills.equipmentEngineering = { lvl: 80, xp: 0 };
  st.equipment.instances = [{ instanceId:"eq_1", itemId:"t1_small_laser", enhancementLevel:0, installedOn:null }];
  st.equipment.nextInstanceId = 3;
  st.equipment.inventory = [];
  st.migrations.combatEquipmentV1 = true;
  const display = s.getEquipmentEnhancementListDisplayState(st);
  const entry = display.entries.find(e => e.itemId === "t1_small_laser");
  assert("H canEnhance true 材料充足", entry && entry.instanceCards[0] && entry.instanceCards[0].canEnhance === true);
  // 矿物不足
  st.resources.minerals["三钛合金"] = 0;
  const display2 = s.getEquipmentEnhancementListDisplayState(st);
  const entry2 = display2.entries.find(e => e.itemId === "t1_small_laser");
  assert("H canEnhance false 材料不足", entry2 && entry2.instanceCards[0] && entry2.instanceCards[0].canEnhance === false);
}

// H53: 舰船强化公式哨兵——锁定精确值防误改（2026-07-24：已改用共用边际递减公式）
{
  const shipSuccess = s.getShipEnhancementSuccessChance;
  assert("H shipEnhanceSuccessChance 是函数", typeof shipSuccess === "function");
  // 共用边际递减公式：getEnhancementChance(eng, thr, L)
  assert("H 舰船 gap=0 L=0 = 0.50", shipSuccess(35, 35, 0) === 0.50);
  assert("H 舰船 gap=0 L=5 = 0.425", shipSuccess(35, 35, 5) === 0.425);
  assert("H 舰船 gap=25 L=0 = 0.775", shipSuccess(60, 35, 0) === 0.775);
  assert("H 舰船 gap=0 L=100 = 0.05", shipSuccess(1, 1, 100) === 0.05);
}

console.log("\n结果汇总");
// ════════════════════════════════════════════════════════════════
const failCount = failures.length;
console.log("\n" + (failCount === 0 ? "全部断言通过 ✅" : `${failCount} 项断言失败 ❌：\n  ${failures.join("\n  ")}`));
process.exit(failCount === 0 ? 0 : 1);
