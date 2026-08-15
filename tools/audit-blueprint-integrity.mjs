// 蓝图系统完整性审计（定点返修交付物）
// 运行时加载真实游戏脚本（与 index.html 相同的 defer 脚本集合），通过 vm 沙箱访问全局表与函数，
// 对「舰船 / 装备 / 增幅剂」三类蓝图的策划规则做集合对账 + 行为矩阵硬断言。
// 运行：node tools/audit-blueprint-integrity.mjs
//
// 对账目标（与定点返修规格一致）：
//   舰船：43 配方 = 18 需蓝图 + 25 免蓝图；SHIP_BLUEPRINTS 恰好 18 且双向一致；
//         rookie_corvette 免蓝图且不在蓝图目录；miner_frigate 需蓝图且在目录。
//   装备：75 需蓝图 = 57 商店(LP/星带/深空) + 7 考古 + 11 货柜；三源并集 = 全集，无源外/幻影/重复键。
//   增幅剂：24 需蓝图 = 考古五地点蓝图池并集；键 "booster:<recipeId>"。

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// 脚本数基线从 verify.mjs 权威读取（避免两处硬编码漂移）；默认 62（Batch F：56 + 势力装备重做/弹药实例/
// 仓库增强网格/脑插子标签/QA 种子等未提交特性新增脚本）。verify.mjs 的基线断言位于 tools/verify.mjs 同一定义处。
function expectedScriptCount() {
  try {
    const v = fs.readFileSync(path.join(root, "tools", "verify.mjs"), "utf8");
    const m = v.match(/scriptSources\.length\s*!==\s*(\d+)/);
    if (m) return Number(m[1]);
  } catch (e) { /* 忽略：回退默认 */ }
  return 62;
}
const EXPECTED_SCRIPTS = expectedScriptCount();
const allSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)]
  .map((m) => m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
if (allSources.length !== EXPECTED_SCRIPTS) throw new Error(`预期 ${EXPECTED_SCRIPTS} 个 defer 脚本（与 verify.mjs 基线一致），实际 ${allSources.length}`);
// 执行仅加载 数据/核心/系统 脚本；跳过 UI 渲染层（其 boot() 副作用依赖真实 DOM，蓝图审计无需且难以 mock）。
const scriptSources = allSources.filter((src) => {
  const norm = src.replace(/^\.\//, "");
  return norm.startsWith("js/data/") || norm.startsWith("js/core/") || norm.startsWith("js/systems/");
});

// ---- 与 verify.mjs / audit-archaeology-ships.mjs 一致的 DOM / 环境桩 ----
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

// ---- 持久化 DOM 桩（供 UI 渲染 / action-modal 真实断言：getElementById 按 id 缓存，
//      支持 addEventListener/dispatch、disabled、value、textContent、innerHTML、classList、
//      querySelector/insertAdjacentHTML，使渲染输出可被回读校验）----
const domRegistry = new Map();
function makePersistentElement(id) {
  const listeners = {};
  const classes = new Set();
  const el = {
    id: id || "",
    _listeners: listeners,
    disabled: false,
    value: "1",
    textContent: "",
    innerHTML: "",
    onclick: null,
    style: {},
    dataset: {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn); },
    dispatch(type, evt) { (listeners[type] || []).forEach((fn) => fn(evt || { type, key: "", target: el })); },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c) => { if (classes.has(c)) classes.delete(c); else classes.add(c); },
      contains: (c) => classes.has(c)
    },
    setAttribute: noop, removeAttribute: noop, setAttributeNS: noop, append: noop, prepend: noop,
    appendChild: noop, removeChild: noop, remove: noop,
    insertAdjacentHTML: (pos, html) => { el.innerHTML += (html || ""); },
    querySelector: () => makePersistentElement("__q__"),
    querySelectorAll: () => [],
    closest: () => null,
    getContext: () => new MockCanvasContext(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    focus: noop, select: noop, click: noop,
    offsetHeight: 24, offsetWidth: 560
  };
  return el;
}
const documentMock = {
  addEventListener: noop, body: makePersistentElement("body"),
  createElement: () => makePersistentElement("__new__"),
  createElementNS: () => makePersistentElement("__ns__"),
  getElementById: (id) => {
    if (!domRegistry.has(id)) domRegistry.set(id, makePersistentElement(id));
    return domRegistry.get(id);
  },
  querySelector: () => makePersistentElement("__q__"),
  querySelectorAll: () => []
};
const localStorageMock = { getItem: () => null, setItem: noop };
// UI 渲染 / action-modal 依赖的展示辅助函数（审计中无需真实实现，置 noop 即可）。
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console,
  confirm: () => true, document: documentMock, FileReader: class {}, localStorage: localStorageMock,
  requestAnimationFrame: noop, cancelAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
  performance: { now: () => Date.now() },
  showToast: noop, formatDuration: () => "", getQueueSkillLabel: () => "", startQueue: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, window: null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
sandbox.window.removeEventListener = noop;
vm.createContext(sandbox);
for (const src of scriptSources) {
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
function checkSetEqual(a, b, label) {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size !== sb.size) { check(false, `${label}（集合大小 ${sa.size}≠${sb.size}）`); return; }
  for (const x of sa) if (!sb.has(x)) { check(false, `${label}（左含右无：${x}）`); return; }
  for (const x of sb) if (!sa.has(x)) { check(false, `${label}（右含左无：${x}）`); return; }
  check(true, label);
}

// ---- 提取权威数据 ----
const SAR = G("SHIP_ASSEMBLY_RECIPES");
const SBP = G("SHIP_BLUEPRINTS");
const shipAssemblyRequiresBlueprint = G("shipAssemblyRequiresBlueprint");
const EQUIP = G("EQUIPMENT_DB");
const LP_STORE_EQUIPMENT_IDS = G("LP_STORE_EQUIPMENT_IDS");
const getCargoBlueprintEquipmentIds = G("getCargoBlueprintEquipmentIds");
const getEquipmentBlueprintOwnershipKey = G("getEquipmentBlueprintOwnershipKey");
const BOOSTER_RECIPES = G("BOOSTER_RECIPES");
const ARCH_LOC = G("ARCHAEOLOGY_LOCATIONS");
const getBoosterBlueprintOwnershipKey = G("getBoosterBlueprintOwnershipKey");
const getShipAssemblyEligibility = G("getShipAssemblyEligibility");
const grantLegacyMinerFrigateBlueprint = G("grantLegacyMinerFrigateBlueprint");

check(Array.isArray(SAR) && SAR.length > 0, "① 加载 SHIP_ASSEMBLY_RECIPES");
check(Array.isArray(SBP) && SBP.length > 0, "① 加载 SHIP_BLUEPRINTS");
check(typeof EQUIP === "object" && Object.keys(EQUIP).length > 0, "① 加载 EQUIPMENT_DB");
check(Array.isArray(BOOSTER_RECIPES) && BOOSTER_RECIPES.length > 0, "① 加载 BOOSTER_RECIPES");
check(Array.isArray(ARCH_LOC) && ARCH_LOC.length > 0, "① 加载 ARCHAEOLOGY_LOCATIONS");
check(typeof getShipAssemblyEligibility === "function", "① 加载 getShipAssemblyEligibility");
check(typeof grantLegacyMinerFrigateBlueprint === "function", "① 加载 grantLegacyMinerFrigateBlueprint");

// ============================================================
// A. 舰船蓝图对账（43 = 18 需蓝图 + 25 免蓝图；SHIP_BLUEPRINTS ↔ 需蓝图 双向一致）
// ============================================================
const shipNeedBp = SAR.filter((r) => shipAssemblyRequiresBlueprint(r)).map((r) => r.shipId);
const shipFree = SAR.filter((r) => !shipAssemblyRequiresBlueprint(r)).map((r) => r.shipId);
const sbpShipIds = SBP.map((b) => b.shipId);

check(SAR.length === 43, `A1 舰船配方总数 = 43（实际 ${SAR.length}）`);
check(shipNeedBp.length === 18, `A2 需蓝图舰船 = 18（实际 ${shipNeedBp.length}）`);
check(shipFree.length === 25, `A3 免蓝图舰船 = 25（实际 ${shipFree.length}）`);
check(sbpShipIds.length === 18, `A4 SHIP_BLUEPRINTS 条目 = 18（实际 ${sbpShipIds.length}）`);
checkSetEqual(sbpShipIds, shipNeedBp, "A5 SHIP_BLUEPRINTS ↔ 需蓝图舰船 双向一致");
check(!shipAssemblyRequiresBlueprint(SAR.find((r) => r.id === "rookie_corvette")), "A6 启程级(rookie_corvette) 免蓝图");
check(!sbpShipIds.includes("rookie_corvette"), "A7 启程级 不在 SHIP_BLUEPRINTS");
check(shipAssemblyRequiresBlueprint(SAR.find((r) => r.id === "miner_frigate")), "A8 拓岩级(miner_frigate) 需蓝图");
check(sbpShipIds.includes("miner_frigate"), "A9 拓岩级 在 SHIP_BLUEPRINTS");
check(sbpShipIds.length === new Set(sbpShipIds).size, "A10 SHIP_BLUEPRINTS 无重复 shipId");

// ============================================================
// B. 装备蓝图对账（75 = 57 商店 + 7 考古 + 11 货柜；三源并集 = 全集，无源外/幻影/重复）
// ============================================================
const equipNeedBp = Object.values(EQUIP).filter((e) => e.requiresBlueprint === true).map((e) => e.id);
// 注意：LP_STORE_EQUIPMENT_IDS 是 vm 上下文内构造的 Set，跨 realm 的 `instanceof Set` 不可靠，统一用 Array.from。
const storeIds = Array.from(LP_STORE_EQUIPMENT_IDS || []);
const archIds = Object.values(EQUIP).filter((e) => e.requiresBlueprint === true && e.archaeology === true).map((e) => e.id);
const cargoIds = [...getCargoBlueprintEquipmentIds()];

check(equipNeedBp.length === 75, `B1 需蓝图装备 = 75（实际 ${equipNeedBp.length}）`);
check(storeIds.length === 57, `B2 商店来源(LP/星带/深空) = 57（实际 ${storeIds.length}）`);
check(archIds.length === 7, `B3 考古来源 = 7（实际 ${archIds.length}）`);
check(cargoIds.length === 11, `B4 货柜来源 = 11（实际 ${cargoIds.length}）`);

// 三源并集必须等于全部需蓝图集合（无源外 = 每个需蓝图至少落一处；无幻影 = 每处来源实体确实需蓝图）
const union = new Set([...storeIds, ...archIds, ...cargoIds]);
checkSetEqual(union, new Set(equipNeedBp), "B5 三源并集 ↔ 全部需蓝图装备 双向一致（无源外/幻影）");
check(storeIds.length === new Set(storeIds).size, "B6 商店来源无重复 id");
check(archIds.length === new Set(archIds).size, "B7 考古来源无重复 id");
check(cargoIds.length === new Set(cargoIds).size, "B8 货柜来源无重复 id");
// 货柜 id 必须确为需蓝图装备（无幻影货柜键）
check(cargoIds.every((id) => equipNeedBp.includes(id)), "B9 货柜蓝图键全部指向真实需蓝图装备");
// 考古 7 件不应混入商店来源（来源边界清晰）
check(archIds.every((id) => !storeIds.includes(id)), "B10 考古装备不在商店来源内");
// 所有权键格式
check(getEquipmentBlueprintOwnershipKey("raider_mining_laser") === "equipment:raider_mining_laser", "B11 装备所有权键 = equipment:<id>");

// ============================================================
// C. 增幅剂蓝图对账（24 = 考古五地点蓝图池并集；键 "booster:<recipeId>"）
// ============================================================
const archPool = new Set();
for (const loc of ARCH_LOC) {
  if (Array.isArray(loc.boosterBlueprints)) for (const rid of loc.boosterBlueprints) archPool.add(rid);
}
const boosterNeedBp = BOOSTER_RECIPES.filter((r) => r.requiresBlueprint === true).map((r) => r.id);
const boosterNeedBpSet = new Set(boosterNeedBp);

check(archPool.size === 24, `C1 考古蓝图池并集 = 24（实际 ${archPool.size}）`);
check(boosterNeedBp.length === 24, `C2 需蓝图增幅剂 = 24（实际 ${boosterNeedBp.length}）`);
checkSetEqual(archPool, boosterNeedBpSet, "C3 考古蓝图池 ↔ 需蓝图增幅剂 双向一致（无源外/幻影）");
// 池内每个 id 都是真实增幅剂配方且确实需蓝图
check([...archPool].every((rid) => boosterNeedBpSet.has(rid)), "C4 蓝图池全部指向真实需蓝图增幅剂");
check(getBoosterBlueprintOwnershipKey("gas_rheology_n") === "booster:gas_rheology_n", "C5 增幅剂所有权键 = booster:<recipeId>");

// ============================================================
// D. 行为矩阵（10 项硬断言）
// ============================================================
function baseState(over) {
  const s = {
    skills: { shipEngineering: { lvl: 1, xp: 0 } },
    ownedBlueprints: [],
    resources: { shipComponents: {}, isk: 0, lp: 0 },
    // 默认船坞 Lv.3：除专门测试船坞锁(D4/G7)外，船坞不干扰其它判定；测试船坞锁时显式覆盖为 0。
    // station.shipyard（savingsLedger 等）与 station.buildings.shipyard（等级）为两个独立对象，缺一不可。
    station: {
      buildings: { shipyard: 3 },
      shipyard: { unlockedFlagship: false, unlockedSupercapital: false, savingsLedger: {} }
    },
    tutorial: { rewardLedger: {} },
    migrations: {},
    inventory: { ships: [] },
    currentAction: {},
    _dirty: false
  };
  // 合并 station 覆盖（保留 buildings 与 shipyard 两个子对象，避免覆盖时丢失 savingsLedger）。
  let rest = over || {};
  if (rest.station) {
    const so = rest.station;
    s.station = {
      buildings: Object.assign({}, s.station.buildings, so.buildings || {}),
      shipyard: Object.assign({}, s.station.shipyard, so.shipyard || {})
    };
    const { station, ...others } = rest;
    rest = others;
  }
  return Object.assign(s, rest);
}
// 通过权威 ResourceRegistry 注入部件与材料（getShipAssemblyMaxCyclesFromState 同时读取 component:<id> 与 materialCost 纯材料名）。
const RR = G("ResourceRegistry");
function grantComponents(state, recipe) {
  for (const cid of Object.keys(recipe.componentCost || {})) RR.add(state, "component:" + cid, (recipe.componentCost[cid] || 0) + 5);
  for (const mid of Object.keys(recipe.materialCost || {})) RR.add(state, mid, (recipe.materialCost[mid] || 0) + 5);
}
const rookie = SAR.find((r) => r.id === "rookie_corvette");
const miner = SAR.find((r) => r.id === "miner_frigate");

// D1. 启程级免蓝图：不报蓝图锁
{
  const st = baseState({});
  grantComponents(st, rookie);
  const el = getShipAssemblyEligibility(st, rookie);
  check(el.requiresBlueprint === false && el.assemblyBlockReason !== "blueprint-locked", "D1 启程级免蓝图不报蓝图锁");
}
// D2. 拓岩级需蓝图：无蓝图则 blueprint-locked
{
  const st = baseState({});
  grantComponents(st, miner);
  const el = getShipAssemblyEligibility(st, miner);
  check(el.requiresBlueprint === true && el.assemblyBlockReason === "blueprint-locked" && el.assemblyUnlocked === false, "D2 拓岩级无蓝图 → blueprint-locked");
}
// D3. 等级锁：找一艘需蓝图且等级>1 的舰船，持蓝图但等级不足 → level-locked
{
  const bpHigh = SAR.find((r) => shipAssemblyRequiresBlueprint(r) && r.level > 1) || null;
  if (bpHigh) {
    const st = baseState({ skills: { shipEngineering: { lvl: 1, xp: 0 } }, ownedBlueprints: [bpHigh.shipId] });
    grantComponents(st, bpHigh);
    const el = getShipAssemblyEligibility(st, bpHigh);
    check(el.assemblyBlockReason === "level-locked", `D3 ${bpHigh.id} 持蓝图但等级不足 → level-locked`);
  } else {
    // 退化情形：用免蓝图高等级舰船验证等级锁逻辑（蓝图满足，仅等级不足）
    const high = SAR.find((r) => r.level > 1);
    const st = baseState({ skills: { shipEngineering: { lvl: 1, xp: 0 } } });
    grantComponents(st, high);
    const el = getShipAssemblyEligibility(st, high);
    check(el.assemblyBlockReason === "level-locked", `D3 ${high.id} 等级不足 → level-locked（退化）`);
  }
}
// D4. 船坞锁：旗舰（capital）需船坞 Lv.2，持蓝图+满级但船坞 Lv.0 → shipyard-level-locked
{
  const capital = SAR.find((r) => { const c = G("getShipConfigById")(r.shipId); return c && c.type === "capital"; });
  const st = baseState({ skills: { shipEngineering: { lvl: 80, xp: 0 } }, ownedBlueprints: capital ? [capital.shipId] : [], station: { buildings: { shipyard: 0 } } });
  if (capital) grantComponents(st, capital);
  const el = getShipAssemblyEligibility(st, capital);
  check(!!capital && el.assemblyBlockReason === "shipyard-level-locked", `D4 ${capital ? capital.id : "?"} 船坞不足 → shipyard-level-locked`);
}
// D5. I6 旧档补偿：显式函数契约（restoredSave 门禁 + I6 合法时间戳 + 幂等）
{
  const g = grantLegacyMinerFrigateBlueprint;
  const validI6 = Date.now();
  // 负面：restoredSave:false + 合法 I6 ledger → 不补发（零副作用）
  {
    const s = baseState({ tutorial: { rewardLedger: { I6: validI6 } }, ownedBlueprints: [] });
    g(s, { restoredSave: false });
    check(!s.ownedBlueprints.includes("miner_frigate"), "D5a restoredSave:false → 不补发");
  }
  // 负面：缺少 options → 不补发
  {
    const s = baseState({ tutorial: { rewardLedger: { I6: validI6 } }, ownedBlueprints: [] });
    g(s);
    check(!s.ownedBlueprints.includes("miner_frigate"), "D5b 缺少 options → 不补发");
  }
  // 负面：I6 为字符串/对象/NaN/Infinity/负数等 truthy → 不补发
  for (const badI6 of ["claimed", { ts: 1 }, NaN, Infinity, -100, 0]) {
    const s = baseState({ tutorial: { rewardLedger: { I6: badI6 } }, ownedBlueprints: [] });
    g(s, { restoredSave: true });
    check(!s.ownedBlueprints.includes("miner_frigate"), `D5c I6=${JSON.stringify(badI6)} 非法 → 不补发`);
  }
  // 正向：restoredSave:true + 合法 I6 ledger → 补发一次
  {
    const s = baseState({ tutorial: { rewardLedger: { I6: validI6 } }, ownedBlueprints: [] });
    g(s, { restoredSave: true });
    check(s.ownedBlueprints.includes("miner_frigate"), "D5d restoredSave:true + 合法 I6 → 补发");
    const len = s.ownedBlueprints.length;
    g(s, { restoredSave: true });
    check(s.ownedBlueprints.length === len && s.ownedBlueprints.filter((x) => x === "miner_frigate").length === 1, "D5e 重复调用仍仅一个 miner_frigate（幂等）");
  }
  // 幂等：已持有 → 不重复
  {
    const s = baseState({ tutorial: { rewardLedger: { I6: validI6 } }, ownedBlueprints: ["miner_frigate"] });
    const len = s.ownedBlueprints.length;
    g(s, { restoredSave: true });
    check(s.ownedBlueprints.length === len && s.ownedBlueprints.filter((x) => x === "miner_frigate").length === 1, "D5f 已持有 → 不重复");
  }
}
// D6. 装备所有权键 + 需蓝图标记（代表件 raider_mining_laser）
{
  const eq = EQUIP["raider_mining_laser"];
  check(eq && eq.requiresBlueprint === true, "D6a raider_mining_laser 需蓝图");
  check(getEquipmentBlueprintOwnershipKey("raider_mining_laser") === "equipment:raider_mining_laser", "D6b 装备所有权键格式");
}
// D7. 增幅剂所有权键 + 在考古池（代表件 gas_rheology_n）
{
  const rid = "gas_rheology_n";
  const rec = BOOSTER_RECIPES.find((r) => r.id === rid);
  check(rec && rec.requiresBlueprint === true, "D7a gas_rheology_n 需蓝图");
  check(archPool.has(rid), "D7b gas_rheology_n 在考古蓝图池");
  check(getBoosterBlueprintOwnershipKey(rid) === "booster:" + rid, "D7c 增幅剂所有权键格式");
}
// D8. assemblyUnlocked 不含材料：免蓝图+满级+船坞够 但无部件 → assemblyUnlocked 真、canStartAssembly 假、insufficient-components
{
  const st = baseState({}); // 不注入部件
  const el = getShipAssemblyEligibility(st, rookie);
  check(el.assemblyUnlocked === true && el.hasComponents === false && el.canStartAssembly === false && el.assemblyBlockReason === "insufficient-components", "D8 缺部件 → assemblyUnlocked 真但 canStartAssembly 假");
}
// D9. 统一优先级：蓝图锁优先于等级/部件（需蓝图舰船，无蓝图+等级不足+无部件 → blueprint-locked）
{
  const bpHigh = SAR.find((r) => shipAssemblyRequiresBlueprint(r) && r.level > 1) || miner;
  const st = baseState({ skills: { shipEngineering: { lvl: 1, xp: 0 } }, ownedBlueprints: [] }); // 无部件
  const el = getShipAssemblyEligibility(st, bpHigh);
  check(el.assemblyBlockReason === "blueprint-locked", "D9 蓝图/等级/部件三缺 → 优先 blueprint-locked");
}
// D10. canStartAssembly 需材料（免蓝图+满级+船坞够+有部件 → 真）
{
  const st = baseState({});
  grantComponents(st, rookie);
  const el = getShipAssemblyEligibility(st, rookie);
  check(el.canStartAssembly === true, "D10 满足全部条件 → canStartAssembly 真");
}

// ============================================================
// F. 船坞等级规则（普通舰船 Lv.0；未知配方 fail closed → null）
// ============================================================
const getShipyardAssemblyLevelRequirement = G("getShipyardAssemblyLevelRequirement");
const canAssembleAtShipyard = G("canAssembleAtShipyard");
const getShipConfigById = G("getShipConfigById");
check(typeof getShipyardAssemblyLevelRequirement === "function" && typeof canAssembleAtShipyard === "function", "F0 加载船坞等级函数");
const heron = SAR.find((r) => r.id === "heron");
const tracer = SAR.find((r) => r.id === "tracer");
const capitalR = SAR.find((r) => { const c = getShipConfigById(r.shipId); return c && (c.type === "capital" || c.type === "industrial_capital" || c.type === "archaeology_capital"); });
// 权威超级旗舰配方（定点返修规格指定 id，不动态猜测）：starcrown（星冕级），shipConfig.type="supercapital"，recipe.level=90。
const supercapitalR = SAR.find((r) => r.id === "starcrown");

// 未知配方 → null（fail closed），且 canAssemble 必须判否（不得因 null<=level 隐式为真）
check(getShipyardAssemblyLevelRequirement(baseState({}), "no_such_recipe_xyz") === null, "F1 未知配方 → null（fail closed）");
check(canAssembleAtShipyard(baseState({}), "no_such_recipe_xyz") === false, "F2 未知配方 canAssemble → false");

// 普通舰船（rookie/miner/heron/tracer）+ 船坞 Lv.0 → shipyardEnough=true
{
  const mk = (recipe) => getShipAssemblyEligibility(baseState({ station: { buildings: { shipyard: 0 } } }), recipe);
  check(mk(rookie).shipyardEnough === true, "F3 启程级 + 船坞Lv.0 → shipyardEnough=true");
  check(mk(miner).shipyardEnough === true, "F4 拓岩级 + 船坞Lv.0 → shipyardEnough=true");
  check(mk(heron).shipyardEnough === true, "F5 苍鹭级 + 船坞Lv.0 → shipyardEnough=true");
  check(mk(tracer).shipyardEnough === true, "F6 追踪者级 + 船坞Lv.0 → shipyardEnough=true");
}
// 旗舰 + 船坞 Lv.1 → shipyard-level-locked；Lv.2 → 通过
{
  const st1 = baseState({ skills: { shipEngineering: { lvl: 80, xp: 0 } }, ownedBlueprints: capitalR ? [capitalR.shipId] : [], station: { buildings: { shipyard: 1 } } });
  grantComponents(st1, capitalR);
  const el1 = getShipAssemblyEligibility(st1, capitalR);
  check(!!capitalR && el1.assemblyBlockReason === "shipyard-level-locked", "F7 旗舰 + 船坞Lv.1 → shipyard-level-locked");
  const st2 = baseState({ skills: { shipEngineering: { lvl: 80, xp: 0 } }, ownedBlueprints: capitalR ? [capitalR.shipId] : [], station: { buildings: { shipyard: 2 } } });
  grantComponents(st2, capitalR);
  const el2 = getShipAssemblyEligibility(st2, capitalR);
  check(!!capitalR && el2.assemblyBlockReason === null && el2.canStartAssembly === true, "F8 旗舰 + 船坞Lv.2 → 通过");
}
// 超级旗舰 + 船坞 Lv.2 → locked；Lv.3 → 通过
{
  // 星冕级/恒城级/裁决级 recipe.level=90，须将舰船工程 ≥90 以越过 level-locked，单独检验船坞 Lv.2/Lv.3 门禁。
  const st1 = baseState({ skills: { shipEngineering: { lvl: 90, xp: 0 } }, ownedBlueprints: supercapitalR ? [supercapitalR.shipId] : [], station: { buildings: { shipyard: 2 } } });
  grantComponents(st1, supercapitalR);
  const el1 = getShipAssemblyEligibility(st1, supercapitalR);
  check(!!supercapitalR && el1.assemblyBlockReason === "shipyard-level-locked", "F9 超级旗舰 + 船坞Lv.2 → shipyard-level-locked");
  const st2 = baseState({ skills: { shipEngineering: { lvl: 90, xp: 0 } }, ownedBlueprints: supercapitalR ? [supercapitalR.shipId] : [], station: { buildings: { shipyard: 3 } } });
  grantComponents(st2, supercapitalR);
  const el2 = getShipAssemblyEligibility(st2, supercapitalR);
  // F9/F10 仅检验「船坞等级门禁」：Lv.3 时船坞不再拦截（超级旗舰 materialCost 的特殊材料库存属生产侧库存语义，不在本审计范围）。
  check(!!supercapitalR && el2.shipyardEnough === true && el2.assemblyBlockReason !== "shipyard-level-locked", "F10 超级旗舰 + 船坞Lv.3 → 通过（船坞门禁放行）");
}

// ============================================================
// G. 行为矩阵·动作层与渲染层真实断言（10 项）
// ============================================================
// 加载 UI 渲染层与 action-modal（仅用于真实渲染/确认断言；其 bind 副作用依赖持久化 DOM，已就绪）。
const uiSources = ["./js/ui/action-modal.js", "./js/ui/manufacturing-render.js"];
for (const src of uiSources) {
  const target = path.resolve(root, src.replace(/^\.\//, ""));
  if (fs.existsSync(target)) vm.runInContext(fs.readFileSync(target, "utf8"), sandbox, { filename: src });
}
// 隔离与蓝图锁逻辑无关的 3D/属性/成本渲染（桩），只验证按钮文案与横幅映射。
sandbox.mountManufacturing3D = noop;
sandbox.renderShipAttributes = noop;
sandbox.renderShipAsmCost = noop;

const dispatchGameAction = G("dispatchGameAction");
const getShipEngineeringDisplayState = G("getShipEngineeringDisplayState");
const renderShipAsmDetail = G("renderShipAsmDetail");
const renderActionConfirmation = G("renderActionConfirmation");
const submitActionConfirmation = G("submitActionConfirmation");
const EQUIPMENT_ENGINEERING_RECIPES = G("EQUIPMENT_ENGINEERING_RECIPES");
check(typeof dispatchGameAction === "function" && typeof getShipEngineeringDisplayState === "function" && typeof renderShipAsmDetail === "function", "G0 加载动作/渲染函数");

function startAsm(state, recipeId, withComponents) {
  state.currentAction = { shipAsmTarget: recipeId, active: false, startedShipAsmTarget: null, progress: 0, shipSubAction: "assembly" };
  if (withComponents) {
    const r = SAR.find((x) => x.id === recipeId);
    for (const cid of Object.keys(r.componentCost || {})) RR.add(state, "component:" + cid, (r.componentCost[cid] || 0) + 5);
  }
  return dispatchGameAction(state, { type: "manufacturing/startShipAssembly" }, Date.now());
}
function renderAsm(state) {
  const display = getShipEngineeringDisplayState(state, Date.now());
  const wrap = sandbox.document.getElementById("shipeng-asm-detail");
  wrap.innerHTML = ""; // 清空上一次渲染横幅
  renderShipAsmDetail(display);
  return { btnText: sandbox.document.getElementById("btn-start-shipasm").textContent, html: wrap.innerHTML };
}
function makeQueueState(over) {
  const s = baseState(over);
  s.queue = { items: [], config: { maxSize: 50 }, status: { isRunning: false, activeIndex: -1, failCount: 0, completedCount: 0 } };
  return s;
}

// G1. rookie 无蓝图、材料足 → selector canStartAssembly=true；dispatch changed=true
{
  const s = baseState({ skills: { shipEngineering: { lvl: 99, xp: 0 } } });
  grantComponents(s, rookie);
  const el = getShipAssemblyEligibility(s, rookie);
  check(el.canStartAssembly === true, "G1a rookie 无蓝图+材料足 → canStartAssembly=true");
  const res = startAsm(s, "rookie_corvette", true);
  check(res.changed === true, "G1b rookie 无蓝图+材料足 → dispatch startShipAssembly changed=true");
}
// G2. rookie 无蓝图、材料不足 → action insufficient-components；UI 按钮"组件不足"；HTML 不含需蓝图/未解锁
{
  const s = baseState({ skills: { shipEngineering: { lvl: 99, xp: 0 } } }); // 无部件
  const res = startAsm(s, "rookie_corvette", false);
  check(res.changed === false && res.reason === "insufficient-components", "G2a rookie 无蓝图+材料不足 → insufficient-components");
  const r = renderAsm(s);
  check(r.btnText === "组件不足", `G2b 渲染按钮文案="${r.btnText}"（应为"组件不足"）`);
  check(!r.html.includes("需蓝图") && !r.html.includes("未解锁"), "G2c 渲染 HTML 不含 需蓝图 及 未解锁 横幅");
}
// G3. miner 无蓝图、材料足 → action blueprint-locked
{
  const s = baseState({ skills: { shipEngineering: { lvl: 99, xp: 0 } } });
  grantComponents(s, miner);
  const res = startAsm(s, "miner_frigate", true);
  check(res.changed === false && res.reason === "blueprint-locked", "G3 miner 无蓝图+材料足 → blueprint-locked");
}
// G4. miner 有蓝图、材料足 → action changed=true
{
  const s = baseState({ skills: { shipEngineering: { lvl: 99, xp: 0 } }, ownedBlueprints: ["miner_frigate"] });
  grantComponents(s, miner);
  const res = startAsm(s, "miner_frigate", true);
  check(res.changed === true, "G4 miner 持蓝图+材料足 → changed=true");
}
// G5. miner 有蓝图、材料不足 → action insufficient-components；UI 不含蓝图锁/等级锁
{
  const s = baseState({ skills: { shipEngineering: { lvl: 99, xp: 0 } }, ownedBlueprints: ["miner_frigate"] }); // 无部件
  const res = startAsm(s, "miner_frigate", false);
  check(res.changed === false && res.reason === "insufficient-components", "G5a miner 持蓝图+材料不足 → insufficient-components");
  const r = renderAsm(s);
  check(!r.html.includes("需蓝图") && !r.html.includes("未解锁"), "G5b miner 缺料 UI 不含蓝图锁/等级锁横幅");
  check(r.btnText === "组件不足", `G5c miner 缺料按钮="${r.btnText}"`);
}
// G6. 技能不足 → level-locked
{
  const bpHigh = SAR.find((r) => shipAssemblyRequiresBlueprint(r) && r.level > 1) || miner;
  const s = baseState({ skills: { shipEngineering: { lvl: 1, xp: 0 } }, ownedBlueprints: [bpHigh.shipId] });
  grantComponents(s, bpHigh);
  const res = startAsm(s, bpHigh.id, true);
  check(res.changed === false && res.reason === "level-locked", `G6 ${bpHigh.id} 持蓝图+等级不足 → level-locked`);
}
// G7. 船坞不足 → shipyard-level-locked
{
  const s = baseState({ skills: { shipEngineering: { lvl: 99, xp: 0 } }, ownedBlueprints: capitalR ? [capitalR.shipId] : [], station: { buildings: { shipyard: 0 } } });
  grantComponents(s, capitalR);
  const res = startAsm(s, capitalR.id, true);
  check(!!capitalR && res.changed === false && res.reason === "shipyard-level-locked", `G7 ${capitalR ? capitalR.id : "?"} 船坞Lv.0 → shipyard-level-locked`);
}
// G8. 装备代表配方：未持蓝图 → 入队 blueprint-locked；持有 equipment:<id> → 通过
{
  const eqRep = EQUIPMENT_ENGINEERING_RECIPES.find((r) => r.requiresBlueprint === true);
  check(!!eqRep, "G8z 存在需蓝图装备配方");
  if (eqRep) {
    const s1 = makeQueueState({ ownedBlueprints: [] });
    const res1 = dispatchGameAction(s1, { type: "queue/add", item: { skill: "equipmentEngineering", target: eqRep.id, label: eqRep.id, count: 1 } }, Date.now());
    check(res1.changed === false && res1.reason === "blueprint-locked", `G8a 装备 ${eqRep.id} 无蓝图 → 入队 blueprint-locked`);
    const s2 = makeQueueState({ ownedBlueprints: ["equipment:" + eqRep.id] });
    const res2 = dispatchGameAction(s2, { type: "queue/add", item: { skill: "equipmentEngineering", target: eqRep.id, label: eqRep.id, count: 1 } }, Date.now());
    check(res2.changed === true, `G8b 装备 ${eqRep.id} 持 equipment:<id> → 入队通过`);
  }
}
// G9. 增幅剂代表配方：未持 booster:<id> → blueprint-locked；持有后通过蓝图门禁
{
  const boosterRep = BOOSTER_RECIPES.find((r) => r.requiresBlueprint === true);
  const needLvl = (boosterRep && boosterRep.level) || 1;
  check(!!boosterRep, "G9z 存在需蓝图增幅剂配方");
  if (boosterRep) {
    // isBoosterRecipeUnlocked 读取唯一全局 gameState（生产环境始终就是被派发的唯一 state）。
    // vm 的全局词法环境跨 runInContext 共享，故 state.js 的 const gameState 为权威对象；
    // 审计直接复用并就地改写该权威对象（等价复刻生产「gameState 即唯一 state」的同步关系），不改正式逻辑。
    const canon = G("gameState");
    const savedBp = canon.ownedBlueprints;
    const savedSkills = canon.skills;
    canon.ownedBlueprints = [];
    canon.skills = Object.assign({}, savedSkills, { boosterEngineering: { lvl: Math.max(needLvl, 1), xp: 0 } });
    dispatchGameAction(canon, { type: "booster/selectRecipe", recipeId: boosterRep.id }, Date.now());
    const res1 = dispatchGameAction(canon, { type: "booster/startManufacturing" }, Date.now());
    check(res1.changed === false && res1.reason === "blueprint-locked", `G9a 增幅剂 ${boosterRep.id} 无蓝图 → blueprint-locked`);
    canon.ownedBlueprints = ["booster:" + boosterRep.id];
    dispatchGameAction(canon, { type: "booster/selectRecipe", recipeId: boosterRep.id }, Date.now());
    const res2 = dispatchGameAction(canon, { type: "booster/startManufacturing" }, Date.now());
    check(res2.reason !== "blueprint-locked", `G9b 增幅剂 ${boosterRep.id} 持 booster:<id> → 通过蓝图门禁（reason=${res2.reason}）`);
    // 还原权威对象，避免污染后续断言。
    canon.ownedBlueprints = savedBp;
    canon.skills = savedSkills;
  }
}
// G10. I6 矩阵全覆盖（restored/fresh/非法/重复）—— 与 D5 互为交叉验证
{
  const g = grantLegacyMinerFrigateBlueprint;
  const v = Date.now();
  const fresh = baseState({ tutorial: { rewardLedger: { I6: v } }, ownedBlueprints: [] });
  g(fresh); // 无 flag（模拟全新游戏路径未传 restoredSave）
  check(!fresh.ownedBlueprints.includes("miner_frigate"), "G10a 全新游戏路径（无 restoredSave）→ 不补发");
  const restored = baseState({ tutorial: { rewardLedger: { I6: v } }, ownedBlueprints: [] });
  g(restored, { restoredSave: true });
  check(restored.ownedBlueprints.includes("miner_frigate"), "G10b 已恢复存档（restoredSave）→ 补发");
  g(restored, { restoredSave: true });
  check(restored.ownedBlueprints.filter((x) => x === "miner_frigate").length === 1, "G10c 重复加载仍仅一个");
  const bad = baseState({ tutorial: { rewardLedger: { I6: "x" } }, ownedBlueprints: [] });
  g(bad, { restoredSave: true });
  check(!bad.ownedBlueprints.includes("miner_frigate"), "G10d 非法 ledger（字符串）→ 不补发");
}

// ============================================================
// H. action-modal fail-closed：maxCount=0 时点击/Enter/无限/直接调用均不派发 queue/add
// ============================================================
{
  const disp = {
    canOpen: true, unlimited: false, maxCount: 0,
    title: "测试", duration: 1, requirements: [], outputText: "",
    queue: { skill: "shipEngineering", target: "x", label: "x" }
  };
  // 经真实渲染注入 _actionConfirmDisplay 并触发禁用逻辑
  renderActionConfirmation(disp);
  let queueAddCalls = 0;
  const origDispatch = sandbox.dispatchGameAction;
  sandbox.dispatchGameAction = function (st, action, now) {
    if (action && action.type === "queue/add") queueAddCalls += 1;
    return { changed: true };
  };
  submitActionConfirmation(false);                                                              // 直接调用
  sandbox.document.getElementById("action-modal-confirm").dispatch("click");                    // 点击确认
  sandbox.document.getElementById("action-modal-queue").dispatch("click");                      // 点击加入队列
  sandbox.document.getElementById("action-batch-count").dispatch("keydown", { key: "Enter" });  // Enter
  sandbox.document.getElementById("action-batch-infinity").dispatch("click");                   // 点击无限
  submitActionConfirmation(true);                                                               // 再次直接调用（无限分支）
  sandbox.dispatchGameAction = origDispatch;
  check(queueAddCalls === 0, `H maxCount=0 时所有入口（直接/点击/Enter/无限）均未派发 queue/add（实际 ${queueAddCalls}）`);
  check(sandbox.document.getElementById("action-modal-confirm").disabled === true, "H confirm 按钮在 maxCount=0 时禁用");
  check(sandbox.document.getElementById("action-batch-count").disabled === true, "H 输入框在 maxCount=0 时禁用");
}

// ---- 汇总 ----
console.log(`\n蓝图系统完整性审计：通过 ${passed} 项，失败 ${failed} 项（index.html 共 ${allSources.length} 个 defer 脚本，本次执行 ${scriptSources.length} 个 数据/核心/系统 脚本）`);
if (failed > 0) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("全部蓝图审计点通过 ✅");
process.exit(0);
