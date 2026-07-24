// 考古船系统第一阶段专项审计
// 加载真实游戏脚本（与 index.html 相同的 32 个脚本），通过 vm 沙箱访问全局表与函数，
// 对五艘考古船的数据 / 制造 / 强化 / 蓝图 / 展示 / 行为边界进行 20 项硬断言。
// 运行：node tools/audit-archaeology-ships.mjs

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
if (scriptSources.length !== 39) throw new Error(`预期 39 个脚本，实际 ${scriptSources.length}`); // 39 = 37 + boosters.js + booster-render.js（增强剂系统 Phase 2A 2026-07-24）

// ---- 与 verify.mjs 一致的 DOM / 环境桩 ----
function MockCanvasContext() {}
const noop = () => {};
for (const name of [
  "arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect",
  "fillText", "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale",
  "setTransform", "stroke", "strokeText", "translate"
]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });

const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, appendChild: noop, classList, click: noop, closest: () => null,
  dataset: {}, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560,
  querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, select: noop,
  style: {}, textContent: "", value: "1"
});
const documentMock = {
  addEventListener: noop, body: makeElement(), createElement: () => makeElement(),
  createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => []
};
const localStorageMock = { getItem: () => null, setItem: noop };
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console,
  confirm: () => true, document: documentMock, FileReader: class {}, localStorage: localStorageMock,
  requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (let index = 0; index < scriptSources.length; index += 1) {
  const src = scriptSources[index];
  const target = path.resolve(root, src.replace(/^\.\//, ""));
  vm.runInContext(fs.readFileSync(target, "utf8"), sandbox, { filename: src });
}

const G = (name) => vm.runInContext(name, sandbox);
const GE = (expr) => vm.runInContext(expr, sandbox);

// ---- 断言框架 ----
let passed = 0, failed = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passed += 1; }
  else { failed += 1; failures.push(label); }
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// ---- 规格基准 ----
const EXPECTED = {
  heron:      { level:1,  tier:"T1",   type:"archaeology_frigate",  hp:{shield:260,armor:80,structure:60},  totalHp:400,  dodge:22, speed:250, targeting:100, capacitor:{capacity:100,rechargeRate:5},  fuelEfficiency:1.00, slots:{high:2,mid:2,low:1,rig:1}, bonuses:{archaeologyScanStrength:10,  archaeologyFailureDamageReduction:0},    unlock:{type:"blueprint",     costISK:50000, level:1} },
  tracer:     { level:15, tier:"T1",   type:"archaeology_destroyer",hp:{shield:430,armor:150,structure:120}, totalHp:700,  dodge:18, speed:220, targeting:120, capacitor:{capacity:140,rechargeRate:7},  fuelEfficiency:0.95, slots:{high:3,mid:2,low:1,rig:1}, bonuses:{archaeologyScanStrength:25,  archaeologyFailureDamageReduction:0.05}, unlock:{type:"shipEngineering",level:15} },
  starmap:    { level:35, tier:"T1",   type:"archaeology_cruiser",  hp:{shield:780,armor:300,structure:220}, totalHp:1300, dodge:14, speed:180, targeting:150, capacitor:{capacity:200,rechargeRate:10}, fuelEfficiency:0.90, slots:{high:3,mid:3,low:2,rig:2}, bonuses:{archaeologyScanStrength:50,  archaeologyFailureDamageReduction:0.10}, unlock:{type:"shipEngineering",level:35} },
  farscope:   { level:55, tier:"T1",   type:"archaeology_battleship",hp:{shield:1400,armor:600,structure:400},totalHp:2400, dodge:9,  speed:125, targeting:180, capacitor:{capacity:280,rechargeRate:14}, fuelEfficiency:0.85, slots:{high:4,mid:4,low:2,rig:3}, bonuses:{archaeologyScanStrength:80,  archaeologyFailureDamageReduction:0.15}, unlock:{type:"shipEngineering",level:55} },
  illuminator:{ level:80, tier:"旗舰", type:"archaeology_capital",  hp:{shield:2900,armor:1100,structure:800},totalHp:4800, dodge:6,  speed:90,  targeting:220, capacitor:{capacity:400,rechargeRate:20}, fuelEfficiency:0.80, slots:{high:4,mid:5,low:3,rig:4}, bonuses:{archaeologyScanStrength:120, archaeologyFailureDamageReduction:0.20}, unlock:{type:"shipEngineering",level:80} }
};
const EXPECTED_RECIPES = {
  heron:      { level:1,  time:30,  xp:30,  requiresBlueprint:undefined, componentCost:{integrated_hull:2,power_core:2,functional_system:2},                    componentTotal:6  },
  tracer:     { level:15, time:45,  xp:60,  requiresBlueprint:false,    componentCost:{destroyer_integrated_hull:3,destroyer_power_core:3,destroyer_functional_system:4}, componentTotal:10 },
  starmap:    { level:35, time:70,  xp:100, requiresBlueprint:false,    componentCost:{cruiser_integrated_hull:4,cruiser_power_core:5,cruiser_functional_system:4},    componentTotal:13 },
  farscope:   { level:55, time:100, xp:160, requiresBlueprint:false,    componentCost:{battleship_integrated_hull:6,battleship_power_core:5,battleship_functional_system:5}, componentTotal:16 },
  illuminator:{ level:80, time:320, xp:500, requiresBlueprint:false,    componentCost:{capital_integrated_hull:10,capital_power_core:8,capital_functional_system:10},   componentTotal:28 }
};

const AS = G("ARCHAEOLOGY_SHIPS");
const STARTER = G("STARTER_SHIPS");
const INDUSTRIAL = G("INDUSTRIAL_SHIPS");
const SBP = G("SHIP_BLUEPRINTS");
const SAR = G("SHIP_ASSEMBLY_RECIPES");
const SCR = G("SHIP_COMPONENT_RECIPES");
const EQUIP = G("EQUIPMENT_DB");
const getShipConfigById = G("getShipConfigById");
const getShipConfig = G("getShipConfig");
const getRestriction = G("getShipAssignmentRestriction");
const createShipInstance = G("createShipInstance");
const canFit = G("canFitEquipmentOnShip");
const getBonuses = G("ShipEnhancement").getBonuses;
const dispatchGameAction = G("dispatchGameAction");
const gameState = G("gameState");

// ============ 1. 五艘考古船存在 ============
check(Object.keys(AS).length === 5, "① 考古船数据表恰好 5 艘");
for (const id of Object.keys(EXPECTED)) check(Boolean(AS[id]), `① 存在 ${id}`);

// ============ 2. 数值精确匹配 ============
for (const [id, exp] of Object.entries(EXPECTED)) {
  const c = AS[id];
  check(c.unlock && c.unlock.level === exp.level, `② ${id}.unlock.level=${exp.level}`);
  check(c.tier === exp.tier, `② ${id}.tier=${exp.tier}`);
  check(c.type === exp.type, `② ${id}.type=${exp.type}`);
  check(c.totalHp === exp.totalHp, `② ${id}.totalHp=${exp.totalHp}`);
  check(c.dodge === exp.dodge, `② ${id}.dodge=${exp.dodge}`);
  check(c.speed === exp.speed, `② ${id}.speed=${exp.speed}`);
  check(c.targeting === exp.targeting, `② ${id}.targeting=${exp.targeting}`);
  check(Math.abs(c.fuelEfficiency - exp.fuelEfficiency) < 1e-9, `② ${id}.fuelEfficiency=${exp.fuelEfficiency}`);
  check(deepEqual(c.hp, exp.hp), `② ${id}.hp`);
  check(deepEqual(c.capacitor, exp.capacitor), `② ${id}.capacitor`);
  check(deepEqual(c.slots, exp.slots), `② ${id}.slots`);
  check(deepEqual(c.bonuses, exp.bonuses), `② ${id}.bonuses`);
  check(c.unlock && c.unlock.type === exp.unlock.type, `② ${id}.unlock.type`);
  if (exp.unlock.costISK !== undefined) check(c.unlock.costISK === exp.unlock.costISK, `② ${id}.unlock.costISK`);
  else check(c.unlock.level === exp.unlock.level, `② ${id}.unlock.level`);
}

// ============ 3. 真实 createShipInstance（唯一实例） ============
const i1 = createShipInstance("heron", Date.now());
const i2 = createShipInstance("heron", Date.now());
check(i1 && typeof i1.instanceId === "string" && i1.instanceId.startsWith("ship_"), "③ instanceId 格式");
check(i1.instanceId !== i2.instanceId, "③ 两个实例 instanceId 唯一");
check(i1.shipId === "heron", "③ instance.shipId=heron");
check(i1.enhancementLevel === 0, "③ enhancementLevel=0");
check(i1.fitted && Array.isArray(i1.fitted.high) && i1.fitted.high.length === 0, "③ 空装配");

// ============ 4. 统一解析 ============
for (const id of Object.keys(EXPECTED)) {
  const r = getShipConfigById(id);
  check(r === AS[id], `④ getShipConfigById(${id}) 返回同一对象`);
}

// ============ 5. 不在 STARTER / INDUSTRIAL ============
for (const id of Object.keys(EXPECTED)) {
  check(!STARTER[id], `⑤ 不在 STARTER_SHIPS: ${id}`);
  check(!INDUSTRIAL[id], `⑤ 不在 INDUSTRIAL_SHIPS: ${id}`);
}

// ============ 6. 采矿/采气/冶炼仍禁止；战斗允许（无禁令） ============
for (const id of Object.keys(EXPECTED)) {
  const c = AS[id];
  for (const act of ["mining", "gasHarvesting", "refining"]) {
    const r = getRestriction(c, act, false);
    check(r !== null, `⑥ ${id} 禁止 ${act}`);
  }
  // 考古舰可参与战斗：combat 岗位检查必须返回 null（允许分配）
  const rc = getRestriction(c, "combat", false);
  check(rc === null, `⑥ ${id} 允许 战斗（restriction=null）`);
}

// ============ 7. 五条制造配方 ============
for (const [id, exp] of Object.entries(EXPECTED_RECIPES)) {
  const r = SAR.find((x) => x.id === id);
  check(Boolean(r), `⑦ 配方存在 ${id}`);
  if (!r) continue;
  check(r.level === exp.level, `⑦ ${id}.level`);
  check(r.time === exp.time, `⑦ ${id}.time`);
  check(r.xp === exp.xp, `⑦ ${id}.xp`);
  check(r.requiresBlueprint === exp.requiresBlueprint, `⑦ ${id}.requiresBlueprint`);
  check(deepEqual(r.componentCost, exp.componentCost), `⑦ ${id}.componentCost`);
  const total = Object.values(r.componentCost).reduce((a, b) => a + b, 0);
  check(total === exp.componentTotal, `⑦ ${id}.组件总数=${exp.componentTotal}`);
}

// ============ 8. 仅苍鹭级需 50000 ISK 永久蓝图 ============
const heronBp = SBP.find((b) => b.id === "heron");
check(Boolean(heronBp) && heronBp.costISK === 50000 && heronBp.level === 1 && heronBp.shipId === "heron", "⑧ 苍鹭级蓝图 50000 ISK / Lv.1");
for (const id of ["tracer", "starmap", "farscope", "illuminator"]) {
  check(!SBP.find((b) => b.id === id), `⑧ 无 ${id} 蓝图`);
}

// ============ 9. 等级锁：阈值前拒绝、阈值处通过 ============
function makeAsmState(level, owned) {
  return {
    skills: { shipEngineering: { lvl: level, xp: 0 } },
    ownedBlueprints: owned || [],
    currentAction: { shipAsmTarget: "rifter", active: false }
  };
}
{
  const s1 = makeAsmState(14, []);
  const r1 = dispatchGameAction(s1, { type: "manufacturing/selectShipAssembly", recipeId: "tracer" }, Date.now());
  check(r1.changed === false && r1.reason === "level-locked", "⑨ tracer Lv.14 等级锁拒绝");

  const s2 = makeAsmState(15, []);
  const r2 = dispatchGameAction(s2, { type: "manufacturing/selectShipAssembly", recipeId: "tracer" }, Date.now());
  check(r2.changed === true && Boolean(r2.recipe), "⑨ tracer Lv.15 阈值通过");

  const s3 = makeAsmState(1, []);
  const r3 = dispatchGameAction(s3, { type: "manufacturing/selectShipAssembly", recipeId: "heron" }, Date.now());
  check(r3.changed === false && r3.reason === "blueprint-locked", "⑨ heron 无蓝图拒绝");

  const s4 = makeAsmState(1, ["heron"]);
  const r4 = dispatchGameAction(s4, { type: "manufacturing/selectShipAssembly", recipeId: "heron" }, Date.now());
  check(r4.changed === true, "⑨ heron 持蓝图通过");
}

// ============ 10. 材料不足时原子拒绝（不写入状态） ============
{
  const origTarget = gameState.currentAction.shipAsmTarget;
  const origComp = JSON.stringify(gameState.resources.shipComponents);
  gameState.currentAction.shipAsmTarget = "tracer";
  gameState.skills.shipEngineering.lvl = 15;
  gameState.resources.shipComponents = {};
  const beforeActive = gameState.currentAction.active;
  const beforeStarted = gameState.currentAction.startedShipAsmTarget;
  const res = dispatchGameAction(gameState, { type: "manufacturing/startShipAssembly" }, Date.now());
  check(res.changed === false && res.reason === "insufficient-components", "⑩ 材料不足原子拒绝");
  check(gameState.currentAction.active === beforeActive && gameState.currentAction.startedShipAsmTarget === beforeStarted, "⑩ 拒绝时未写入状态");
  gameState.currentAction.shipAsmTarget = origTarget;
  gameState.resources.shipComponents = JSON.parse(origComp);
}

// ============ 11. 派生材料均有真实来源（复用现有舰体组件） ============
const componentIds = new Set(SCR.map((r) => r.id));
for (const id of Object.keys(EXPECTED_RECIPES)) {
  const r = SAR.find((x) => x.id === id);
  for (const cid of Object.keys(r.componentCost)) {
    check(componentIds.has(cid), `⑪ ${id} 组件 ${cid} 存在真实配方`);
  }
}

// ============ 12. 无考古/月矿/莫尔石/阵营/深层数据/核心/协议 材料 ============
const FORBIDDEN = ["莫尔石", "月岩", "低级加密数据", "中级加密数据", "高级加密数据", "深层舰船数据", "莫尔"];
for (const id of Object.keys(EXPECTED_RECIPES)) {
  const r = SAR.find((x) => x.id === id);
  check(r.materialCost === undefined, `⑫ ${id} 配方无 materialCost（禁止考古/月矿/阵营/深层数据）`);
}
for (const id of Object.keys(EXPECTED)) {
  const json = JSON.stringify(AS[id]);
  for (const token of FORBIDDEN) check(!json.includes(token), `⑫ ${id} 舰船数据不含违禁词 ${token}`);
}
check(!JSON.stringify(SBP.find((b) => b.id === "heron")).includes("sourceZoneId"), "⑫ 苍鹭级蓝图无阵营区域来源");

// ============ 13. +5/+10/+15 → HP 与扫描 1.05/1.10/1.15 ============
for (const [lvl, exp] of [[5, 1.05], [10, 1.10], [15, 1.15]]) {
  const b = getBonuses(AS.heron, lvl);
  check(Math.abs(b.hpMultiplier - exp) < 1e-9, `⑬ heron Lv.${lvl} hpMultiplier=${exp}`);
  check(Math.abs(b.archaeologyScanMultiplier - exp) < 1e-9, `⑬ heron Lv.${lvl} scanMultiplier=${exp}`);
}

// ============ 14. 强化契约安全中性字段：damage/industry 恒 1，不放大战斗伤害 ============
{
  const b = getBonuses(AS.heron, 10);
  check("damageMultiplier" in b && b.damageMultiplier === 1, "⑭ damageMultiplier 存在且恒为 1（不放大战斗伤害）");
  check("industryMultiplier" in b && b.industryMultiplier === 1, "⑭ industryMultiplier 存在且恒为 1");
  check(!("weaponMultiplier" in b), "⑭ 无 weaponMultiplier（避免歧义键）");
}
// 失败反噬减免不随强化变化
{
  const b0 = getBonuses(AS.heron, 0), b15 = getBonuses(AS.heron, 15);
  check(!("archaeologyFailureDamageReduction" in b0) && !("archaeologyFailureDamageReduction" in b15), "⑭ 强化不放大失败反噬减免");
  check(AS.heron.bonuses.archaeologyFailureDamageReduction === 0, "⑭ heron 失败减免固定为 0");
}

// ============ 15. 失败反噬减免固定（不随强化改变） ============
{
  const hangarState = {
    shipAssignments: {}, combat: { repairUntil: 0, active: false, activeShip: null },
    inventory: { ships: [createShipInstance("heron", Date.now())] },
    skills: { shipEngineering: { lvl: 1, xp: 0 } }, resources: { shipComponents: {} },
    currentAction: { skill: "mining", active: false }, equipment: { instances: [], inventory: [] }
  };
  const h0 = G("getHangarDisplayState")(hangarState, Date.now());
  hangarState.inventory.ships[0].enhancementLevel = 15;
  const h15 = G("getHangarDisplayState")(hangarState, Date.now());
  check(h0.ships[0].enhancement.failureReduction === h15.ships[0].enhancement.failureReduction, "⑮ 失败反噬减免跨强化等级固定");
  check(h0.ships[0].enhancement.failureReduction === 0, "⑮ heron 失败反噬减免固定为 0");
}

// ============ 16. 三个选择器产出正确 View State ============
{
  const eng = G("getShipEngineeringDisplayState")(gameState, Date.now());
  const archOpts = eng.assemblyOptions.filter((o) => EXPECTED_RECIPES[o.shipId]);
  check(archOpts.length === 5, "⑯ 舰船工程制造列表含 5 艘考古船");
  for (const o of archOpts) {
    const eff = o.shipId === "heron" ? true : false;
    check(o.requiresBlueprint === eff, `⑯ ${o.shipId} 蓝图需求标记(effective)`);
  }

  const catalog = G("getBlueprintStoreCatalogItems")();
  const heronCat = catalog.find((c) => c.id === "heron");
  check(Boolean(heronCat) && heronCat.category === "ships", "⑯ 蓝图商店含苍鹭级（ships 分类）");

  const hs = G("getHangarDisplayState")({
    shipAssignments: {}, combat: { repairUntil: 0, active: false, activeShip: null },
    inventory: { ships: [createShipInstance("heron", Date.now())] },
    skills: { shipEngineering: { lvl: 1, xp: 0 } }, resources: { shipComponents: {} },
    currentAction: { skill: "mining", active: false }, equipment: { instances: [], inventory: [] }
  }, Date.now());
  const card = hs.ships[0];
  check(card.archaeology === true, "⑯ 机库卡片 archaeology 标记");
  check(card.enhancement.scanStrengthBase === 10 && card.enhancement.scanStrength === 10, "⑯ 机库卡片扫描强度（基础/当前）");
  check(card.enhancement.role === "archaeology", "⑯ 机库卡片强化角色=archaeology");
}

// ============ 17. 启明级无法安装 6 件旗舰战斗装备 ============
{
  const capitalCombat = Object.values(EQUIP).filter(
    (e) => Array.isArray(e.shipTypes) && e.shipTypes.includes("capital") &&
           (e.category === "weapon" || e.slot === "high" || e.slot === "mid" || e.slot === "low")
  );
  check(capitalCombat.length >= 1, `⑰ 找到旗舰战斗装备 ${capitalCombat.length} 件`);
  let blocked = 0;
  for (const e of capitalCombat) {
    if (canFit(e, AS.illuminator) === false) blocked += 1;
  }
  check(blocked === capitalCombat.length, `⑰ 启明级(${capitalCombat.length} 件旗舰战斗装备)全部无法安装`);
}

// ============ 18. 战斗解析必须能正确解析五艘考古舰（可参战） ============
// 注意：考古舰“可参与实际战斗”，但不作为 destroyer-belts 考古专项平衡基准舰船。
for (const id of Object.keys(EXPECTED)) {
  const cfg = getShipConfig(id);
  check(cfg === AS[id], `⑱ getShipConfig(${id}) 必须解析到 ARCHAEOLOGY_SHIPS（考古舰可参战）`);
  check(cfg !== null, `⑱ getShipConfig(${id}) 不得回退成裂谷级(null)`);
}

// ============ 19. 五艘均可分配战斗 / 装备普通武器 / 真实开战 ============
function makeCombatState(id) {
  const inst = createShipInstance(id, Date.now());
  const state = {
    shipAssignments: {},
    combat: {
      active:false, activeShip:null, repairUntil:0, zone:"nullsec_belt_1", mode:"belt",
      hp:{ shield:0, armor:0, structure:0 }, maxHp:{ shield:0, armor:0, structure:0 },
      weapon:"laser", enemies:[], currentEnemy:null, wave:1, totalKills:0, runEliteKills:0,
      currentFormation:"", lastStatus:"", lastEnemyVolley:null, zoneClears:{}, viewMode:"belt"
    },
    inventory: { ships:[inst] },
    equipment: { inventory:["t1_small_laser"], instances:[], nextInstanceId:1 },
    skills: { shipEngineering:{ lvl:80, xp:0 }, piloting:80, gunnery:80, capacitorManagement:80, defense:80, combat:80 },
    resources: { shipComponents:{} },
    currentAction: { skill:"mining", active:false },
    queue: { items:[], config:{ maxSize:10 }, status:{ isRunning:false, activeIndex:-1, completedCount:0, failCount:0 } }
  };
  // 解锁首个 0.0 星带（通常 requiredCL 较低），确保 zone.unlocked
  const COMBAT_ZONES = G("COMBAT_ZONES") || [];
  if (COMBAT_ZONES.length) {
    const z = COMBAT_ZONES[0];
    state.combat.zone = z.id;
  }
  return { state, inst };
}
const noTypesWeapons = Object.values(EQUIP).filter((e) => e.combat && e.combat.kind === "weapon" && (!Array.isArray(e.shipTypes) || e.shipTypes.length === 0));
check(noTypesWeapons.length >= 1, `⑲ 找到无 shipTypes 限制的普通武器 ${noTypesWeapons.length} 件`);
const testWeaponId = noTypesWeapons[0].id;

for (const id of Object.keys(EXPECTED)) {
  const { state, inst } = makeCombatState(id);
  // (a) toggleShipAssignment 可分配 combat
  const t = dispatchGameAction(state, { type:"hangar/toggleAssignment", instanceId:inst.instanceId, actionKey:"combat" }, Date.now());
  check(t.changed === true && state.shipAssignments.combat === inst.instanceId, `⑲ ${id} toggleAssignment→combat 成功`);
  // (b) equipCombatShip 可成功
  const e = dispatchGameAction(state, { type:"hangar/equipCombatShip", instanceId:inst.instanceId }, Date.now());
  check(e.changed === true && state.combat.activeShip === inst.instanceId, `⑲ ${id} equipCombatShip 成功`);
  // (c) 安装普通无限制武器
  const f = dispatchGameAction(state, { type:"hangar/setFittingSlot", instanceId:inst.instanceId, slot:"high", slotIndex:0, equipmentId:testWeaponId }, Date.now());
  check(f.changed === true && inst.fitted.high[0] != null, `⑲ ${id} 安装 ${testWeaponId} 成功`);
  // (d) combat/start 成功
  const s = dispatchGameAction(state, { type:"combat/start", enemies:[{ id:"test_enemy", name:"测试敌", hp:{shield:100,armor:100,structure:100}, dps:10, hit:50, dodge:30, fuelCost:1 }], formationId:"test" }, Date.now());
  check(s.changed === true && state.combat.active === true, `⑲ ${id} combat/start 成功`);
  // (e) activeShip / 配置 / 实例 同一艘
  const act = G("getActiveCombatShipState")(state);
  check(act.instance && act.instance.instanceId === inst.instanceId, `⑲ ${id} activeShip 实例一致`);
  check(act.config === AS[id], `⑲ ${id} activeShip 配置一致`);
}


// ============ 19. 制造耗时符合规格 ============
for (const [id, exp] of Object.entries(EXPECTED_RECIPES)) {
  const r = SAR.find((x) => x.id === id);
  check(r.time === exp.time, `⑲ ${id}.time=${exp.time}`);
}

// ============ 20. 选择器/动作不造成意外状态突变 ============
{
  const before = JSON.stringify(gameState);
  G("getShipEngineeringDisplayState")(gameState, Date.now());
  G("getBlueprintStoreCatalogItems")();
  G("getHangarDisplayState")(gameState, Date.now());
  for (const id of Object.keys(EXPECTED)) G("getShipConfigById")(id);
  const after = JSON.stringify(gameState);
  check(before === after, "⑳ 只读选择器未突变 gameState");

  const clone = JSON.parse(JSON.stringify(gameState));
  dispatchGameAction(clone, { type: "manufacturing/selectShipAssembly", recipeId: "starmap" }, Date.now());
  check(gameState.currentAction.shipAsmTarget === JSON.parse(before).currentAction.shipAsmTarget, "⑳ selectShipAssembly 不突变原 gameState");
}

// ============ 20. 无武器考古舰 combat/start 返回 no-weapons 且状态不变 ============
for (const id of Object.keys(EXPECTED)) {
  const noW = makeCombatState(id);
  const before = JSON.stringify(noW.state.combat);
  const s = dispatchGameAction(noW.state, { type:"combat/start", enemies:[{ id:"e", name:"敌", hp:{shield:100,armor:100,structure:100}, dps:10, hit:50, dodge:30, fuelCost:1 }], formationId:"t" }, Date.now());
  check(s.changed === false && s.reason === "no-weapons", `⑳ ${id} 无武器 combat/start → no-weapons`);
  check(JSON.stringify(noW.state.combat) === before, `⑳ ${id} 无武器被拒时 combat 状态不变`);
}

// ============ 21. 苍鹭级 & 启明级 真实战斗结算（有限数 / 命中 / 无 undefined·NaN） ============
function snapshotGlobal() {
  return JSON.parse(JSON.stringify({
    combat: gameState.combat, inventory: gameState.inventory,
    shipAssignments: gameState.shipAssignments, resources: gameState.resources,
    equipment: gameState.equipment, skills: gameState.skills
  }));
}
function restoreGlobal(snap) {
  gameState.combat = snap.combat; gameState.inventory = snap.inventory;
  gameState.shipAssignments = snap.shipAssignments; gameState.resources = snap.resources;
  gameState.equipment = snap.equipment; gameState.skills = snap.skills;
}
for (const id of ["heron", "illuminator"]) {
  const { state, inst } = makeCombatState(id);
  dispatchGameAction(state, { type:"hangar/toggleAssignment", instanceId:inst.instanceId, actionKey:"combat" }, Date.now());
  dispatchGameAction(state, { type:"hangar/equipCombatShip", instanceId:inst.instanceId }, Date.now());
  dispatchGameAction(state, { type:"hangar/setFittingSlot", instanceId:inst.instanceId, slot:"high", slotIndex:0, equipmentId:testWeaponId }, Date.now());
  dispatchGameAction(state, { type:"combat/start", enemies:[{ id:"e", name:"敌", hp:{shield:100,armor:100,structure:100}, dps:10, hit:50, dodge:30, fuelCost:1 }], formationId:"t" }, Date.now());
  const maxHp = G("getCombatMaxHpFromState")(state);
  const totalMax = (maxHp.shield || 0) + (maxHp.armor || 0) + (maxHp.structure || 0);
  check(Number.isFinite(totalMax) && totalMax > 0, `㉑ ${id} 最大生命有限且 >0 (=${totalMax})`);
  const dmg = G("getCombatDamageMultiplierFromState")(state, "laser", {});
  const dodge = G("getCombatPlayerDodgeFromState")(state, {});
  const fuel = G("getCombatFuelMultiplierFromState")(state, null, {});
  check(Number.isFinite(dmg) && dmg > 0, `㉑ ${id} 伤害倍率有限 (=${dmg})`);
  check(Number.isFinite(dodge) && dodge > 0, `㉑ ${id} 闪避有限 (=${dodge})`);
  check(Number.isFinite(fuel) && fuel > 0, `㉑ ${id} 燃料倍率有限 (=${fuel})`);
  // 真实武器命中（选择器）
  const hit = G("getCombatWeaponHitFromState")(state, "laser", {}, {});
  check(Number.isFinite(hit) && hit > 0, `㉑ ${id} 武器命中有限且 >0 (=${hit})`);
  const cfg = getShipConfig(id);
  check(cfg === AS[id], `㉑ ${id} 结算配置与考古舰一致`);
}

// ============ 21b. 真实 combatTick 单回合：玩家攻击使敌人生命下降，伤害/命中/消耗无 NaN ============
{
  const snap = snapshotGlobal();
  try {
    const ZONES = G("COMBAT_ZONES") || [];
    const ENEMY_DB = G("ENEMY_DATABASE") || {};
    const zone = ZONES.find(z => Boolean(ENEMY_DB[z.faction])) || ZONES[0];
    const inst = createShipInstance("heron", Date.now());
    gameState.inventory.ships.push(inst);
    gameState.shipAssignments.combat = inst.instanceId;
    gameState.combat.active = false;
    if (!gameState.equipment) gameState.equipment = { inventory:[], instances:[], nextInstanceId:1 };
    if (!Array.isArray(gameState.equipment.inventory)) gameState.equipment.inventory = [];
    gameState.equipment.inventory.push(testWeaponId);
    dispatchGameAction(gameState, { type:"hangar/setFittingSlot", instanceId:inst.instanceId, slot:"high", slotIndex:0, equipmentId:testWeaponId }, Date.now());
    const RR = G("ResourceRegistry");
    const wpn = G("EQUIPMENT_DB")[testWeaponId];
    const wType = wpn && wpn.combat ? wpn.combat.weaponType : "laser";
    RR.add(gameState, "consumable:fuel", 100);
    RR.add(gameState, "ammo:" + wType, 100);
    const enemy = { id:"audit_enemy", name:"审计测试敌", hp:{shield:200,armor:200,structure:200}, maxHp:{shield:200,armor:200,structure:200}, hit:30, dodge:20, baseDamage:10, defeated:false, rewarded:false };
    const beforeFuel = RR.get(gameState, "consumable:fuel");
    Object.assign(gameState.combat, {
      active:true, activeShip:inst.instanceId, mode:"belt", viewMode:"belt",
      zone: zone ? zone.id : "nullsec_belt_1", enemies:[enemy], currentEnemy:enemy,
      hp:{shield:260,armor:80,structure:60}, maxHp:{shield:260,armor:80,structure:60},
      wave:1, totalKills:0, runEliteKills:0, currentFormation:"", lastStatus:"", lastEnemyVolley:null, repairUntil:0
    });
    const hitSel = G("getCombatWeaponHitFromState")(gameState, wType, {}, {});
    check(Number.isFinite(hitSel) && hitSel > 0, `㉑b heron 武器命中有限且 >0 (=${hitSel})`);
    const dmgSel = G("getCombatDamageMultiplierFromState")(gameState, wType, {});
    check(Number.isFinite(dmgSel) && dmgSel > 0, `㉑b heron 伤害倍率有限且 >0 (=${dmgSel})`);
    const enemyBefore = enemy.hp.shield + enemy.hp.armor + enemy.hp.structure;
    G("combatTick")();
    const enemyAfter = enemy.hp.shield + enemy.hp.armor + enemy.hp.structure;
    const afterFuel = RR.get(gameState, "consumable:fuel");
    check(Number.isFinite(enemyBefore) && Number.isFinite(enemyAfter), "㉑b 敌人生命数值有限（无 NaN）");
    check(enemyAfter < enemyBefore, `㉑b 真实 combatTick 后敌人生命下降（${enemyBefore}→${enemyAfter}）`);
    check(Number.isFinite(afterFuel) && (beforeFuel - afterFuel) > 0, `㉑b 燃料消耗有限且 >0（${beforeFuel}→${afterFuel}）`);
    check(gameState.combat.lastEnemyVolley === null || (gameState.combat.lastEnemyVolley && Number.isFinite(gameState.combat.lastEnemyVolley.totalDamage)), "㉑b 敌方反击事件数值有限（无 NaN）");
  } finally {
    restoreGlobal(snap);
  }
}

// ============ 21c. 苍鹭级 真实 enterDeathspace 正向测试（有武器/有密钥/等级足够 → 成功且密钥 -1） ============
{
  const snap = snapshotGlobal();
  try {
    const DEATHSPACES = G("DEATHSPACE_DATABASE") || [];
    const site = DEATHSPACES.find(s => s.requiredCL <= 1) || DEATHSPACES[0];
    const { state, inst } = makeCombatState("heron");
    dispatchGameAction(state, { type:"hangar/toggleAssignment", instanceId:inst.instanceId, actionKey:"combat" }, Date.now());
    dispatchGameAction(state, { type:"hangar/equipCombatShip", instanceId:inst.instanceId }, Date.now());
    dispatchGameAction(state, { type:"hangar/setFittingSlot", instanceId:inst.instanceId, slot:"high", slotIndex:0, equipmentId:testWeaponId }, Date.now());
    const RR = G("ResourceRegistry");
    if (!state.resources) state.resources = {};
    if (!state.resources.special) state.resources.special = {};
    RR.add(state, "special:" + site.ticketMaterial, 5);
    const keyBefore = RR.get(state, "special:" + site.ticketMaterial);
    const res = dispatchGameAction(state, { type:"combat/enterDeathspace", deathspaceId:site.id, enemies:[{ id:"de", name:"死空敌", hp:{shield:100,armor:100,structure:100}, dps:10, hit:50, dodge:30, fuelCost:1 }], formationId:"t" }, Date.now());
    check(res.changed === true, `㉑c 苍鹭级 enterDeathspace(${site.id}) 成功`);
    check(RR.get(state, "special:" + site.ticketMaterial) === keyBefore - 1, `㉑c 通行密钥精确减少 1（${keyBefore}→${RR.get(state, "special:" + site.ticketMaterial)}）`);
    check(state.combat.active === true && state.combat.mode === "deathspace", "㉑c 进入死亡空间战斗模式");
  } finally {
    restoreGlobal(snap);
  }
}

// ============ 21d. 普通战斗舰（rifter）正向回归：真实 combatTick 敌人生命下降 ============
{
  const snap = snapshotGlobal();
  try {
    const ZONES = G("COMBAT_ZONES") || [];
    const ENEMY_DB = G("ENEMY_DATABASE") || {};
    const zone = ZONES.find(z => Boolean(ENEMY_DB[z.faction])) || ZONES[0];
    const inst = createShipInstance("rifter", Date.now());
    gameState.inventory.ships.push(inst);
    gameState.shipAssignments.combat = inst.instanceId;
    gameState.combat.active = false;
    if (!gameState.equipment) gameState.equipment = { inventory:[], instances:[], nextInstanceId:1 };
    if (!Array.isArray(gameState.equipment.inventory)) gameState.equipment.inventory = [];
    gameState.equipment.inventory.push(testWeaponId);
    dispatchGameAction(gameState, { type:"hangar/setFittingSlot", instanceId:inst.instanceId, slot:"high", slotIndex:0, equipmentId:testWeaponId }, Date.now());
    const RR = G("ResourceRegistry");
    const wpn = G("EQUIPMENT_DB")[testWeaponId];
    const wType = wpn && wpn.combat ? wpn.combat.weaponType : "laser";
    RR.add(gameState, "consumable:fuel", 100);
    RR.add(gameState, "ammo:" + wType, 100);
    const enemy = { id:"audit_enemy_r", name:"审计测试敌R", hp:{shield:200,armor:200,structure:200}, maxHp:{shield:200,armor:200,structure:200}, hit:30, dodge:20, baseDamage:10, defeated:false, rewarded:false };
    Object.assign(gameState.combat, {
      active:true, activeShip:inst.instanceId, mode:"belt", viewMode:"belt",
      zone: zone ? zone.id : "nullsec_belt_1", enemies:[enemy], currentEnemy:enemy,
      hp:{shield:400,armor:300,structure:250}, maxHp:{shield:400,armor:300,structure:250},
      wave:1, totalKills:0, runEliteKills:0, currentFormation:"", lastStatus:"", lastEnemyVolley:null, repairUntil:0
    });
    const enemyBefore = enemy.hp.shield + enemy.hp.armor + enemy.hp.structure;
    G("combatTick")();
    const enemyAfter = enemy.hp.shield + enemy.hp.armor + enemy.hp.structure;
    check(enemyAfter < enemyBefore, `㉑d rifter 真实 combatTick 后敌人生命下降（${enemyBefore}→${enemyAfter}）`);
  } finally {
    restoreGlobal(snap);
  }
}

// ============ 22. 强化后的考古舰参与战斗：HP 获倍率 / damageMultiplier=1 / 扫描增长 ============
for (const [lvl, exp] of [[5, 1.05], [10, 1.10], [15, 1.15]]) {
  const b = getBonuses(AS.heron, lvl);
  check(Math.abs(b.hpMultiplier - exp) < 1e-9, `㉒ heron Lv.${lvl} 强化 HP 倍率=${exp}`);
  check(b.damageMultiplier === 1, `㉒ heron Lv.${lvl} damageMultiplier 恒为 1（不放大战斗伤害）`);
  check(b.industryMultiplier === 1, `㉒ heron Lv.${lvl} industryMultiplier 恒为 1`);
  check(Math.abs(b.archaeologyScanMultiplier - exp) < 1e-9, `㉒ heron Lv.${lvl} 扫描倍率增长=${exp}`);
}
// 强化后真实战斗：HP 上限被 hpMultiplier 放大，伤害倍率仍 1
{
  const { state, inst } = makeCombatState("heron");
  inst.enhancementLevel = 15;
  dispatchGameAction(state, { type:"hangar/toggleAssignment", instanceId:inst.instanceId, actionKey:"combat" }, Date.now());
  dispatchGameAction(state, { type:"hangar/equipCombatShip", instanceId:inst.instanceId }, Date.now());
  dispatchGameAction(state, { type:"hangar/setFittingSlot", instanceId:inst.instanceId, slot:"high", slotIndex:0, equipmentId:testWeaponId }, Date.now());
  dispatchGameAction(state, { type:"combat/start", enemies:[{ id:"e", name:"敌", hp:{shield:100,armor:100,structure:100}, dps:10, hit:50, dodge:30, fuelCost:1 }], formationId:"t" }, Date.now());
  const maxHp = G("getCombatMaxHpFromState")(state);
  const totalMax = (maxHp.shield || 0) + (maxHp.armor || 0) + (maxHp.structure || 0);
  // 隔离强化效果：用同配置 Lv.0 作基准，验证倍率≈1.15（不受技能/装备默认值干扰）
  const base = makeCombatState("heron"); base.inst.enhancementLevel = 0;
  dispatchGameAction(base.state, { type:"hangar/toggleAssignment", instanceId:base.inst.instanceId, actionKey:"combat" }, Date.now());
  dispatchGameAction(base.state, { type:"hangar/equipCombatShip", instanceId:base.inst.instanceId }, Date.now());
  dispatchGameAction(base.state, { type:"hangar/setFittingSlot", instanceId:base.inst.instanceId, slot:"high", slotIndex:0, equipmentId:testWeaponId }, Date.now());
  dispatchGameAction(base.state, { type:"combat/start", enemies:[{ id:"e", name:"敌", hp:{shield:100,armor:100,structure:100}, dps:10, hit:50, dodge:30, fuelCost:1 }], formationId:"t" }, Date.now());
  const baseHp = G("getCombatMaxHpFromState")(base.state);
  const baseTotal = (baseHp.shield||0)+(baseHp.armor||0)+(baseHp.structure||0);
  check(Number.isFinite(totalMax) && baseTotal > 0 && Math.abs(totalMax/baseTotal - 1.15) < 1e-2, `㉒ 强化 Lv.15 苍鹭最大生命获 1.15× 倍率（${baseTotal}→${totalMax}）`);
  const dmg = G("getCombatDamageMultiplierFromState")(state, "laser", {});
  const baseDmg = G("getCombatDamageMultiplierFromState")(base.state, "laser", {});
  check(Number.isFinite(dmg) && Math.abs(dmg - baseDmg) < 1e-9, `㉒ 强化 Lv.15 苍鹭伤害倍率与未强化一致（强化不增加战斗伤害：${baseDmg}→${dmg}）`);
}

// ============ 23. 明确区分：可参战 vs 不作 destroyer-belts 基准 ============
{
  // 可参战：装备+开战成功（已在前序 ⑲/㉑ 验证）。
  // 不作基准：getShipConfig 解析到考古舰本身，而非被混入 STARTER 战斗平衡集合。
  const starters = Object.keys(STARTER);
  const archInStarter = Object.keys(EXPECTED).some((id) => starters.includes(id));
  check(!archInStarter, `㉓ 考古舰不混入 STARTER 战斗平衡集合`);
  // 强化契约保持“不放大战斗伤害”的安全中性字段
  const b = getBonuses(AS.tracer, 10);
  check("damageMultiplier" in b && "industryMultiplier" in b, `㉓ 强化契约含安全中性字段（damage/industry Multiplier）`);
}

// ---- 汇总 ----
console.log(`\n考古船专项审计：通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("全部审计点通过 ✅");
process.exit(0);
