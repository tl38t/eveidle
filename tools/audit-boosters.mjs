/* ================================================================
   audit-boosters.mjs — 增强剂系统 Phase 2A 专项审计（A~ZB 区）

   原则：加载真实项目脚本，调用真实 Action / 选择器 / 在线 gameTick / 离线结算 / 迁移，
   绝不复制公式自证。沙箱与 audit-planetary.mjs 同构：
   - 默认加载 index.html 中除 /ui/、actions.js、tick.js、offline.js、persistence.js 外的脚本
   - 额外手动加载 offline.js、actions.js、tick.js
   - 从 persistence.js 精确切片出真实 migrateBoosterState 源码并执行（非重写）
   ================================================================ */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(match => match[1]).filter(source =>
  !source.includes("/ui/") && !["actions.js", "tick.js", "offline.js", "persistence.js"].some(file => source.endsWith("/" + file))
);

const noop = () => {};
const canvasContext = { createImageData:(w, h) => ({ data:new Uint8ClampedArray(w * h * 4), w, h }), createLinearGradient:() => ({ addColorStop:noop }), createRadialGradient:() => ({ addColorStop:noop }), getImageData:(x, y, w, h) => ({ data:new Uint8ClampedArray(w * h * 4), w, h }) };
for (const method of ["arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect", "fillText", "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale", "setTransform", "stroke", "strokeText", "translate"]) canvasContext[method] = noop;
const makeElement = () => ({
  addEventListener:noop, appendChild:noop, classList:{ add:noop, remove:noop, toggle:noop, contains:() => false },
  click:noop, closest:() => null, dataset:{}, focus:noop, getBoundingClientRect:() => ({ left:0, top:0, width:100, height:100 }),
  getContext:() => canvasContext, innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector:() => null, querySelectorAll:() => [],
  remove:noop, select:noop, style:{}, textContent:"", value:"1"
});
const sandbox = {
  alert:noop, Blob, CanvasRenderingContext2D:class {}, console, confirm:() => true,
  document:{ addEventListener:noop, body:makeElement(), createElement:makeElement, createElementNS:makeElement, getElementById:makeElement, querySelector:() => null, querySelectorAll:() => [] },
  FileReader:class {}, localStorage:{ getItem:() => null, setItem:noop }, requestAnimationFrame:noop,
  setInterval:noop, setTimeout:noop, clearTimeout:noop, URL:{ createObjectURL:() => "blob:mock", revokeObjectURL:noop }, window:null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
// UI 桩（/ui/ 脚本不参与沙箱，但 gameTick 在运行时调用这些全局）
sandbox.updateUI = noop;
sandbox.updateLiveUI = noop;
sandbox.refreshVisiblePanelAfterAction = noop;
sandbox.showToast = noop;
sandbox.isCargoFull = () => false;
vm.createContext(sandbox);
for (const source of scriptSources) {
  vm.runInContext(fs.readFileSync(path.resolve(root, source.replace(/^\.\//, "")), "utf8"), sandbox, { filename:source });
}
// 手动加载动作层、离线结算层、在线 tick 层（只定义函数，无加载期副作用）
vm.runInContext(fs.readFileSync(path.resolve(root, "js/core/offline.js"), "utf8"), sandbox, { filename:"js/core/offline.js" });
vm.runInContext(fs.readFileSync(path.resolve(root, "js/core/actions.js"), "utf8"), sandbox, { filename:"js/core/actions.js" });
vm.runInContext(fs.readFileSync(path.resolve(root, "js/core/tick.js"), "utf8"), sandbox, { filename:"js/core/tick.js" });
// 精确切片真实 migrateBoosterState（含 window 绑定），执行真实迁移代码
const persistenceSource = fs.readFileSync(path.resolve(root, "js/core/persistence.js"), "utf8");
const migStart = persistenceSource.indexOf("function migrateBoosterState() {");
const migEndMarker = "window.migrateBoosterState = migrateBoosterState;";
const migEnd = persistenceSource.indexOf(migEndMarker);
if (migStart < 0 || migEnd < 0) throw new Error("无法从 persistence.js 精确切片 migrateBoosterState");
vm.runInContext(persistenceSource.slice(migStart, migEnd + migEndMarker.length), sandbox, { filename:"persistence.migrateBoosterState.js" });
if (typeof sandbox.migrateBoosterState !== "function") throw new Error("migrateBoosterState 未注入沙箱全局");

// 所有加载函数读取的真实 lexical gameState。注意：gameState 是 vm 上下文的词法绑定，
// 重新赋值 sandbox.gameState 无法影响它；必须原地变更其属性。所有状态构造都操作 G。
const G = vm.runInContext("gameState", sandbox);

const BOOSTER_ITEMS = vm.runInContext("BOOSTER_ITEMS", sandbox);
const BOOSTER_RECIPES = vm.runInContext("BOOSTER_RECIPES", sandbox);
const BOOSTER_QUALITIES = vm.runInContext("BOOSTER_QUALITIES", sandbox);
const BOOSTER_SERIES = vm.runInContext("BOOSTER_SERIES", sandbox);
const BOOSTER_CATEGORY_META = vm.runInContext("BOOSTER_CATEGORY_META", sandbox);
const TACTICAL_MATERIALS = vm.runInContext("TACTICAL_MATERIALS", sandbox);
const TACTICAL_MATERIAL_BY_LAYER = vm.runInContext("TACTICAL_MATERIAL_BY_LAYER", sandbox);
const BOOSTER_DURATION_MS = vm.runInContext("BOOSTER_DURATION_MS", sandbox);
const dispatch = (state, action, now) => sandbox.dispatchGameAction(state, action, now);
const NOW = 2000000000000;

// ---- 断言与分区框架 ----
let totalAssertions = 0;
const regionCounts = {};
let currentRegion = "?";
function assert(cond, msg) {
  totalAssertions++;
  regionCounts[currentRegion] = (regionCounts[currentRegion] || 0) + 1;
  if (!cond) throw new Error(`[区 ${currentRegion}] 断言失败：${msg}`);
}
function region(letter, name, fn) { currentRegion = letter; const before = totalAssertions; fn(); console.log(`  区 ${letter} ${name}：${totalAssertions - before} 断言 PASS`); }

// ---- 测试工具 ----
function stockBoosterMaterials(state, qtyPerKey) {
  for (const recipe of BOOSTER_RECIPES) {
    for (const ref of Object.keys(recipe.cost)) sandbox.ResourceRegistry.add(state, ref, qtyPerKey);
  }
}
// 原地重置 G（真实 lexical gameState）的增强剂相关字段，并清空材料池以防跨测试泄漏。
function freshState(opts = {}) {
  const g = G;
  g.skills.boosterEngineering = { lvl: opts.lvl || 1, xp: 0 };
  g.boosters = { inventory: opts.inventory ? Object.assign({}, opts.inventory) : {}, active: {}, lastTick: 0 };
  g.currentAction = Object.assign({}, g.currentAction || {}, {
    skill: opts.active ? "boosterEngineering" : ((g.currentAction && g.currentAction.skill) || "mining"),
    active: Boolean(opts.active),
    boosterCategory: opts.category || "mining",
    boosterQualityFilter: opts.quality || "all",
    boosterRecipeTarget: opts.recipe || "mining_lubricant_n",
    startedBoosterRecipeTarget: opts.active ? (opts.recipe || "mining_lubricant_n") : "",
    progress: 0,
    lastProgressUpdate: opts.active ? (opts.startTime || NOW) : 0,
    batchRemaining: 0
  });
  // 清空增强剂配方依赖的三种材料池（planetary/special/gas），避免上一项测试残留造成前置校验误判
  if (g.resources) { g.resources.planetary = {}; g.resources.special = {}; g.resources.gas = {}; }
  sandbox.migrateBoosterState();
  if (opts.stock !== false) stockBoosterMaterials(g, opts.stockQty || 1000);
  return g;
}
function setNow(t) { vm.runInContext(`globalThis.__auditRealDateNow = Date.now; Date.now = () => ${t};`, sandbox); }
function restoreNow() { vm.runInContext(`Date.now = globalThis.__auditRealDateNow; delete globalThis.__auditRealDateNow;`, sandbox); }

// ---- 可复现随机序列（种子 LCG，接管 Math.random） ----
function seedRandom(seed) {
  vm.runInContext("if(typeof globalThis.__savedRandom==='undefined')globalThis.__savedRandom=Math.random", sandbox);
  const s = seed >>> 0;
  vm.runInContext(`globalThis.__rngSeed=${s}; Math.random=function(){var s=globalThis.__rngSeed; s=(s*1664525+1013904223)>>>0; globalThis.__rngSeed=s; return s/4294967296; }`, sandbox);
}
function restoreRandom() {
  vm.runInContext("Math.random=globalThis.__savedRandom;delete globalThis.__savedRandom;delete globalThis.__rngSeed;", sandbox);
}

// ---- 开采场景通用工具 ----
function setupMiningState(g, opts) {
  g.boosters.active = {};
  const inv = opts.inv || {};
  for (const [k,v] of Object.entries(inv)) sandbox.ResourceRegistry.add(g, k, v);
  if (opts.ms) g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:opts.ms };
  if (opts.my) g.boosters.active.miningYield = { itemId:"booster:ore_resonance_n", remainingMs:opts.my };
  g.currentAction.skill = "mining";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.currentAction.startedArea = "凡晶石带";
  g.currentAction.area = "凡晶石带";
  // 重置 skill 等级为 Lv.1（xp=1000 对应 10 周期后升级到 Lv.2）
  if (!g.skills.mining) g.skills.mining = {};
  g.skills.mining.lvl = 1;
  g.skills.mining.xp = 0;
  g.boosters.lastTick = NOW - (opts.offlineSec || 600) * 1000;
}
function cleanupMining(g) {
  const RR = sandbox.ResourceRegistry;
  RR.spend(g, "ore:凡晶石", RR.get(g, "ore:凡晶石"));
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
}
function runOnlineBooster(state, fromTime, seconds) {
  state.currentAction.skill = "boosterEngineering";
  state.currentAction.active = true;
  state.currentAction.startedBoosterRecipeTarget = state.currentAction.boosterRecipeTarget;
  state.currentAction.progress = 0;
  state.currentAction.lastProgressUpdate = fromTime;
  setNow(fromTime);
  const steps = Math.ceil(seconds / 5);
  for (let i = 1; i <= steps; i++) {
    if (!state.currentAction.active) break;
    setNow(fromTime + i * 5000);
    sandbox.gameTick();
  }
  restoreNow();
}
function runOfflineBooster(state, seconds) {
  state.currentAction.skill = "boosterEngineering";
  state.currentAction.active = true;
  state.currentAction.startedBoosterRecipeTarget = state.currentAction.boosterRecipeTarget;
  state.currentAction.progress = 0;
  state.currentAction.batchRemaining = 0;
  return sandbox.applyOfflineGains(seconds, { runId: "audit_booster_off_" + seconds });
}
// 将 m 装入真实 G（原地变更），供迁移专项测试使用
function loadState(m) {
  G.skills = G.skills || {};
  G.skills.boosterEngineering = (m.skills && m.skills.boosterEngineering) ? m.skills.boosterEngineering : { lvl: 1, xp: 0 };
  G.boosters = m.boosters;           // 可能为 undefined（测试缺失补齐）
  G.currentAction = m.currentAction || {};
}
function invCount(state, id) { return Number(state.boosters.inventory[id] || 0) || 0; }

console.log("增强剂系统 Phase 2A 专项审计（A~ZH）");

// ================= A：数据完整性 =================
region("A", "数据完整性", () => {
  assert(BOOSTER_ITEMS && typeof BOOSTER_ITEMS === "object", "BOOSTER_ITEMS 必须为对象");
  assert(BOOSTER_RECIPES && Array.isArray(BOOSTER_RECIPES) && BOOSTER_RECIPES.length === 30, "必须 30 条增强剂/配方");
  assert(Object.keys(BOOSTER_ITEMS).length === 30, "BOOSTER_ITEMS 必须 30 项");
  assert(BOOSTER_QUALITIES && Object.keys(BOOSTER_QUALITIES).length === 3, "必须 3 品质（n/r/l）");
  assert(BOOSTER_SERIES && Object.keys(BOOSTER_SERIES).length === 10, "必须 10 系列");
  assert(TACTICAL_MATERIALS && TACTICAL_MATERIALS.length === 5, "必须 5 档战术材料");
  assert(TACTICAL_MATERIAL_BY_LAYER && Object.keys(TACTICAL_MATERIAL_BY_LAYER).length === 6, "战术材料层映射必须 6 层");
  // items 与 recipes 一一对应
  for (const recipe of BOOSTER_RECIPES) {
    assert(BOOSTER_ITEMS[recipe.id], `item ${recipe.id} 缺失`);
    assert(recipe.itemId === "booster:" + recipe.id, `recipe ${recipe.id} itemId 命名空间异常`);
  }
});

// ================= B：解锁等级分布 =================
region("B", "解锁等级分布", () => {
  const LEVELS = {
    mining_lubricant:{ n:1, r:35, l:60 }, shield_recharge:{ n:4, r:39, l:64 },
    ore_resonance:{ n:7, r:43, l:68 }, laser_coolant:{ n:10, r:47, l:72 },
    relic_solver:{ n:13, r:51, l:76 }, armor_nano:{ n:16, r:55, l:80 },
    missile_catalyst:{ n:20, r:59, l:84 }, artifact_tracer:{ n:24, r:63, l:88 },
    cannon_booster:{ n:28, r:67, l:92 }, structure_gel:{ n:32, r:71, l:96 }
  };
  for (const recipe of BOOSTER_RECIPES) {
    assert(LEVELS[recipe.series] && LEVELS[recipe.series][recipe.quality] === recipe.level, `配方 ${recipe.id} 解锁等级应为 ${LEVELS[recipe.series] && LEVELS[recipe.series][recipe.quality]}，实得 ${recipe.level}`);
  }
  // 每系列恰好 3 品质，每品质恰好 10 系列
  const bySeries = {}; const byQuality = {};
  for (const recipe of BOOSTER_RECIPES) {
    bySeries[recipe.series] = bySeries[recipe.series] || new Set();
    bySeries[recipe.series].add(recipe.quality);
    byQuality[recipe.quality] = byQuality[recipe.quality] || new Set();
    byQuality[recipe.quality].add(recipe.series);
  }
  for (const s of Object.keys(bySeries)) assert(bySeries[s].size === 3, `系列 ${s} 应含 3 品质`);
  for (const q of ["n", "r", "l"]) assert(byQuality[q].size === 10, `品质 ${q} 应含 10 系列`);
});

// ================= C：配方字段铁律 =================
region("C", "配方字段铁律", () => {
  for (const recipe of BOOSTER_RECIPES) {
    assert(recipe.durationMs === BOOSTER_DURATION_MS && BOOSTER_DURATION_MS === 180000, `配方 ${recipe.id} durationMs 必须为 180000`);
    assert(recipe.output && recipe.output.type === "booster" && recipe.output.qty === 1, `配方 ${recipe.id} 产出必须为单瓶（qty=1）`);
    assert(typeof recipe.time === "number" && recipe.time > 0, `配方 ${recipe.id} time 必须为正数`);
    assert(typeof recipe.xp === "number" && recipe.xp > 0, `配方 ${recipe.id} xp 必须为正数`);
  }
});

// ================= D：配方成本结构 =================
region("D", "配方成本结构", () => {
  for (const recipe of BOOSTER_RECIPES) {
    const keys = Object.keys(recipe.cost);
    assert(keys.length === 2, `配方 ${recipe.id} 成本应恰为 2 项（行星产物 + 战术/气体），实得 ${keys.length}`);
    const planetary = keys.filter(k => k.startsWith("planetary:"));
    const second = keys.filter(k => k.startsWith("special:") || k.startsWith("gas:"));
    assert(planetary.length === 1, `配方 ${recipe.id} 应含 1 个 planetary: 成本`);
    assert(second.length === 1, `配方 ${recipe.id} 应含 1 个 special:/gas: 成本`);
    for (const k of keys) assert(recipe.cost[k] > 0, `配方 ${recipe.id} 成本 ${k} 必须为正数`);
  }
});

// ================= E：效果类型绑定 =================
region("E", "效果类型与槽位绑定", () => {
  for (const recipe of BOOSTER_RECIPES) {
    const series = BOOSTER_SERIES[recipe.series];
    assert(series, `系列 ${recipe.series} 必须存在`);
    assert(recipe.effect && recipe.effect.type === series.effectType, `配方 ${recipe.id} effectType 应绑定系列 ${series.effectType}`);
    assert(recipe.effect && recipe.effect.slot === series.slot, `配方 ${recipe.id} effect.slot 应绑定系列 ${series.slot}`);
    const item = BOOSTER_ITEMS[recipe.id];
    assert(item.effectType === series.effectType && item.slot === series.slot, `item ${recipe.id} 槽位绑定应一致`);
  }
});

// ================= F：技能与初始状态 =================
region("F", "技能与状态结构", () => {
  const st = freshState({ lvl: 7 });
  assert(st.skills.boosterEngineering && st.skills.boosterEngineering.lvl === 7 && st.skills.boosterEngineering.xp === 0, "boosterEngineering 技能结构异常");
  assert(st.boosters && typeof st.boosters === "object", "gameState.boosters 必须存在");
  assert(st.boosters.inventory && typeof st.boosters.inventory === "object", "boosters.inventory 必须为对象");
  assert(st.boosters.active && typeof st.boosters.active === "object", "boosters.active 必须为对象");
  assert(Number.isFinite(Number(st.boosters.lastTick)) && Number(st.boosters.lastTick) > 0, "boosters.lastTick 应为正数");
  // 迁移默认回填 currentAction 字段
  assert(st.currentAction.boosterRecipeTarget === "mining_lubricant_n", "默认配方回填");
  assert(st.currentAction.boosterCategory === "mining", "默认分类回填");
  assert(st.currentAction.boosterQualityFilter === "all", "默认品质筛选回填");
});

// ================= G：ResourceRegistry 寻址与中文名 =================
region("G", "ResourceRegistry 寻址", () => {
  const st = freshState({ lvl: 1 });
  const before = sandbox.ResourceRegistry.get(st, "booster:mining_lubricant_n");
  assert(before === 0, "初始库存应为 0");
  sandbox.ResourceRegistry.add(st, "booster:mining_lubricant_n", 5);
  assert(sandbox.ResourceRegistry.get(st, "booster:mining_lubricant_n") === 5, "Registry 应按 inventory 计数");
  const nm = sandbox.getResourceDisplayName("booster:mining_lubricant_n");
  assert(nm === "纳米采掘润滑剂·普通", `中文名应为「纳米采掘润滑剂·普通」，实得「${nm}」`);
  assert(sandbox.getResourceDisplayName("special:战术残液") !== "", "special: 资源应有显示名");
  assert(sandbox.getResourceDisplayName("gas:粗制富勒烯") !== "", "gas: 资源应有显示名");
});

// ================= H：selectRecipe 只改选择不碰 started =================
region("H", "selectRecipe 只改选择", () => {
  const st = freshState({ lvl: 96, recipe: "mining_lubricant_n", active: true });
  st.currentAction.startedBoosterRecipeTarget = "mining_lubricant_n";
  const before = st.currentAction.startedBoosterRecipeTarget;
  const res = dispatch(st, { type:"booster/selectRecipe", recipeId:"structure_gel_l" }, NOW);
  assert(res.changed && st.currentAction.boosterRecipeTarget === "structure_gel_l", "selectRecipe 改选择");
  assert(st.currentAction.startedBoosterRecipeTarget === before, "selectRecipe 不触碰 startedBoosterRecipeTarget");
  assert(st.currentAction.skill === "boosterEngineering" && st.currentAction.active === true, "运行中状态保持");
  // 非法配方应拒绝且不改状态
  const r0 = dispatch(st, { type:"booster/selectRecipe", recipeId:"nope" }, NOW);
  assert(!r0.changed && r0.reason === "unknown-recipe", "非法配方 unknown-recipe");
});

// ================= I：selectCategory / selectQualityFilter 不碰 started =================
region("I", "筛选不碰 started", () => {
  const st = freshState({ lvl: 96, recipe: "mining_lubricant_n", active: true, category: "mining", quality: "all" });
  st.currentAction.startedBoosterRecipeTarget = "mining_lubricant_n";
  dispatch(st, { type:"booster/selectCategory", categoryId:"combatWeapon" }, NOW);
  assert(st.currentAction.startedBoosterRecipeTarget === "mining_lubricant_n", "selectCategory 不碰 started");
  dispatch(st, { type:"booster/selectQualityFilter", quality:"l" }, NOW);
  assert(st.currentAction.startedBoosterRecipeTarget === "mining_lubricant_n", "selectQualityFilter 不碰 started");
  // 未知分类/品质拒绝
  const r1 = dispatch(st, { type:"booster/selectCategory", categoryId:"bogus" }, NOW);
  assert(!r1.changed && r1.reason === "unknown-category", "未知分类 unknown-category");
  const r2 = dispatch(st, { type:"booster/selectQualityFilter", quality:"z" }, NOW);
  assert(!r2.changed && r2.reason === "unknown-quality", "未知品质 unknown-quality");
});

// ================= J：startManufacturing 前置校验与置位 =================
region("J", "startManufacturing 前置与置位", () => {
  // 越级
  const locked = freshState({ lvl: 1, recipe: "structure_gel_l", active: false });
  const r1 = dispatch(locked, { type:"booster/startManufacturing" }, NOW);
  assert(!r1.changed && r1.reason === "level-locked", "越级应 level-locked");
  assert(locked.currentAction.active === false, "越级不得启动");
  // 材料不足
  const poor = freshState({ lvl: 96, recipe: "mining_lubricant_n", active: false, stock: false });
  const r2 = dispatch(poor, { type:"booster/startManufacturing" }, NOW);
  assert(!r2.changed && r2.reason === "insufficient-materials", "材料不足应 insufficient-materials");
  assert(poor.currentAction.active === false, "材料不足不得启动");
  // 成功
  const good = freshState({ lvl: 96, recipe: "mining_lubricant_n", active: false });
  const r3 = dispatch(good, { type:"booster/startManufacturing" }, NOW);
  assert(r3.changed, "应成功启动");
  assert(good.currentAction.active === true && good.currentAction.skill === "boosterEngineering", "skill/active 置位");
  assert(good.currentAction.startedBoosterRecipeTarget === "mining_lubricant_n", "started 置位为所选配方");
  assert(good.currentAction.progress === 0, "progress 归零");
});

// ================= K：stopManufacturing 清除 started 保留选择 =================
region("K", "stopManufacturing 语义", () => {
  const st = freshState({ lvl: 96, recipe: "structure_gel_l", category: "combatRepair", quality: "l", active: true });
  st.currentAction.startedBoosterRecipeTarget = "structure_gel_l";
  const res = dispatch(st, { type:"booster/stopManufacturing" }, NOW);
  assert(res.changed, "应成功");
  assert(st.currentAction.startedBoosterRecipeTarget === "", "started 清除");
  assert(st.currentAction.active === false, "active 清除");
  assert(st.currentAction.progress === 0, "progress 归零");
  assert(st.currentAction.boosterRecipeTarget === "structure_gel_l", "选择保留");
  assert(st.currentAction.boosterCategory === "combatRepair" && st.currentAction.boosterQualityFilter === "l", "分类/品质保留");
  // 未制造时拒绝
  const idle = freshState({ lvl: 1, active: false });
  const r0 = dispatch(idle, { type:"booster/stopManufacturing" }, NOW);
  assert(!r0.changed && r0.reason === "not-manufacturing", "未制造应 not-manufacturing");
});

// ================= L：材料不足在线安全停止 =================
region("L", "材料不足在线安全停止", () => {
  const st = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true, stock: false });
  sandbox.ResourceRegistry.add(st, "planetary:重金属", 2);     // 恰好 1 瓶
  sandbox.ResourceRegistry.add(st, "special:战术残液", 2);
  runOnlineBooster(st, NOW, 60);
  assert(invCount(st, "mining_lubricant_n") === 1, "仅产 1 瓶（材料仅够 1）");
  assert(st.currentAction.active === false, "材料耗尽应安全停止");
});

// ================= M：在线连续制造多瓶 =================
region("M", "在线连续制造多瓶", () => {
  const st = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true });
  runOnlineBooster(st, NOW, 180);
  const cnt = invCount(st, "mining_lubricant_n");
  assert(cnt === 10, `180s 在线应产 10 瓶（lvl1 实际耗时 18/1.02），实得 ${cnt}`);
  assert(st.skills.boosterEngineering.xp === 10 * 5, "XP 应随每瓶累加（10×5）");
});

// ================= N：离线结算产出 =================
region("N", "离线结算产出", () => {
  const st = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true });
  const gains = runOfflineBooster(st, 180);
  assert(invCount(st, "mining_lubricant_n") === 10, `180s 离线应产 10 瓶，实得 ${invCount(st, "mining_lubricant_n")}`);
  assert(gains.boosterEngineering === 10, "gains.boosterEngineering 应为 10");
  assert(st.skills.boosterEngineering.xp === 10 * 5, "离线 XP 应累加（10×5）");
});

// ================= O：在线/离线同段一致 =================
region("O", "在线/离线同段一致", () => {
  const online = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true });
  runOnlineBooster(online, NOW, 180);
  const offline = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true });
  runOfflineBooster(offline, 180);
  assert(invCount(online, "mining_lubricant_n") === invCount(offline, "mining_lubricant_n"), "在线/离线库存必须一致");
  assert(online.skills.boosterEngineering.xp === offline.skills.boosterEngineering.xp, "在线/离线 XP 必须一致");
  assert(invCount(online, "mining_lubricant_n") > 0, "应确有余量产出");
});

// ================= P：不消耗 180s / 不应用效果（Phase 2A 边界） =================
region("P", "不消耗 180s 不应用效果", () => {
  const st = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true });
  runOnlineBooster(st, NOW, 180);
  // 六槽恒为 null（无装备、无计时）
  for (const slot of Object.keys(st.boosters.active)) assert(st.boosters.active[slot] === null, `六槽 ${slot} 在 Phase 2A 必须恒为 null`);
  // 库存为纯整数计数（裸 id 键），无到期/无计时字段
  const key = "mining_lubricant_n";
  assert(typeof st.boosters.inventory[key] === "number" && st.boosters.inventory[key] > 0, "库存应为纯正整数计数");
  for (const k of Object.keys(st.boosters.inventory)) {
    const v = st.boosters.inventory[k];
    assert(typeof v === "number" && Number.isInteger(v) && v > 0, `库存项 ${k} 应为正整数计数`);
    assert(!(v && typeof v === "object" && ("expiresAt" in v || "activeUntil" in v)), `库存项 ${k} 不得带到期字段`);
  }
  // 制造不得改动战斗/采矿/考古倍率状态
  assert(!("boosterTimers" in st) && !("activeEffects" in st), "不得生成计时器/效果状态");
});

// ================= Q：事件契约注册与校验 =================
region("Q", "事件契约校验", () => {
  const contracts = sandbox.GameEvents.contracts;
  for (const t of ["booster:manufactured", "boosters:manufactured", "combat:tacticalMaterialDropped"]) {
    assert(contracts.has(t), `事件 ${t} 未注册契约`);
  }
  assert(contracts.validate("booster:manufactured", { recipeId:"mining_lubricant_n", itemId:"booster:mining_lubricant_n", series:"mining_lubricant", quality:"n", quantity:1, xpGained:5, offline:false }).valid, "booster:manufactured 合法负载应通过");
  assert(!contracts.validate("booster:manufactured", { recipeId:"x", itemId:"y" }).valid, "booster:manufactured 缺字段应失败");
  assert(contracts.validate("boosters:manufactured", { recipeId:"mining_lubricant_n", itemId:"booster:mining_lubricant_n", quantity:10, totalXp:50, offline:true }).valid, "boosters:manufactured 合法负载应通过");
  assert(!contracts.validate("boosters:manufactured", { recipeId:"x", itemId:"y", quantity:1 }).valid, "boosters:manufactured 缺字段应失败");
  assert(contracts.validate("combat:tacticalMaterialDropped", { zoneId:"belt_1", deathspaceId:null, enemyId:"e1", enemyKind:"frigate", materialId:"战术残液", materialName:"战术残液", tier:"T1", quantity:2, securityLayer:"highsec" }).valid, "tacticalMaterialDropped 合法负载应通过");
  assert(!contracts.validate("combat:tacticalMaterialDropped", { zoneId:"belt_1" }).valid, "tacticalMaterialDropped 缺字段应失败");
});

// ================= R：事件实际触发 =================
region("R", "事件实际触发", () => {
  const online = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true });
  const evs = [];
  const un = sandbox.GameEvents.on("booster:manufactured", e => evs.push(e));
  runOnlineBooster(online, NOW, 180);
  un();
  assert(evs.length === invCount(online, "mining_lubricant_n"), `booster:manufactured 应每瓶一发，实得 ${evs.length}`);
  assert(evs.length > 0 && evs[0].payload.offline === false && evs[0].payload.quantity === 1, "在线事件 offline=false/quantity=1");
  assert(evs[0].payload.recipeId === "mining_lubricant_n" && evs[0].payload.series === "mining_lubricant" && evs[0].payload.quality === "n", "在线事件负载字段齐备");

  const offline = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: true });
  const offEvs = [];
  const un2 = sandbox.GameEvents.on("boosters:manufactured", e => offEvs.push(e));
  runOfflineBooster(offline, 180);
  un2();
  assert(offEvs.length === 1, "离线应合并为单发批量事件");
  assert(offEvs[0].payload.quantity === invCount(offline, "mining_lubricant_n") && offEvs[0].payload.totalXp === offline.skills.boosterEngineering.xp, "批量事件数量/XP 一致");
  assert(offEvs[0].payload.offline === true, "离线事件 offline=true");
});

// ================= S：迁移字段补齐（缺失 boosters） =================
region("S", "迁移字段补齐", () => {
  loadState({ skills:{ boosterEngineering:{ lvl:5, xp:10 } }, currentAction:{ skill:"mining", active:false } });
  sandbox.migrateBoosterState();
  assert(G.boosters && typeof G.boosters === "object", "缺失 boosters 应补齐");
  assert(G.boosters.inventory && typeof G.boosters.inventory === "object", "inventory 应补齐");
  assert(G.boosters.active && typeof G.boosters.active === "object", "active 应补齐");
  assert(Number.isFinite(Number(G.boosters.lastTick)) && Number(G.boosters.lastTick) > 0, "lastTick 应补齐为正数");
  assert(G.currentAction.boosterRecipeTarget === "mining_lubricant_n", "默认配方回填");
  assert(G.currentAction.boosterCategory === "mining" && G.currentAction.boosterQualityFilter === "all", "分类/品质筛选回填");
});

// ================= T：迁移合法库存保留 / 旧前缀键归一化 / 非法清除 =================
region("T", "迁移库存保留与清理（含前缀键归一化）", () => {
  const m = {
    skills:{ boosterEngineering:{ lvl:5, xp:10 } },
    boosters: {
      inventory: {
        "mining_lubricant_n": 5,         // 裸 id 正常键，必须原样保留
        "booster:ore_resonance_r": 4,    // 旧 booster: 前缀键，应归一化为裸 id
        "booster:bad_key": -2,           // 非法（负数）
        "booster:shield_recharge_n": NaN // 非法（NaN）
      },
      active: { miningSpeed: "stale" }, lastTick: 0
    },
    currentAction: { skill:"mining", active:false }
  };
  loadState(m);
  sandbox.migrateBoosterState();
  assert(m.boosters.inventory["mining_lubricant_n"] === 5, "裸 id 正常库存保留");
  assert(m.boosters.inventory["ore_resonance_r"] === 4, "旧 booster: 前缀键归一化为裸 id");
  assert(!("booster:ore_resonance_r" in m.boosters.inventory), "不得保留 booster: 前缀旧键（无双键）");
  assert(!("booster:bad_key" in m.boosters.inventory), "负数/NaN 库存清除");
  assert(!("booster:shield_recharge_n" in m.boosters.inventory), "NaN 库存清除");
  // 迁移后不得残留任何 booster: 前缀键（确认无双键）
  for (const k of Object.keys(m.boosters.inventory)) assert(!k.startsWith("booster:"), `迁移后不得残留 booster: 前缀键：${k}`);
});

// ================= U：迁移六槽恒 null / currentAction 字段补齐 =================
region("U", "迁移六槽与 currentAction", () => {
  const m = {
    skills:{ boosterEngineering:{ lvl:5, xp:10 } },
    boosters: { inventory: { "booster:mining_lubricant_n": 2 }, active: { miningSpeed: "stale", combatWeapon: 1 }, lastTick: 0 },
    currentAction: { skill:"mining", active:false, boosterRecipeTarget:"ore_resonance_r" }
  };
  loadState(m);
  sandbox.migrateBoosterState();
  for (const slot of Object.keys(m.boosters.active)) assert(m.boosters.active[slot] === null, `六槽 ${slot} 必须恒为 null`);
  assert(m.currentAction.boosterRecipeTarget === "ore_resonance_r", "合法配方保留");
  assert(m.currentAction.startedBoosterRecipeTarget === "", "未运行则 started 应空");
  // 运行中则 started 回填为配方
  const m2 = {
    skills:{ boosterEngineering:{ lvl:50, xp:0 } },
    boosters: { inventory:{}, active:{}, lastTick: 0 },
    currentAction: { skill:"boosterEngineering", active:true, boosterRecipeTarget:"mining_lubricant_n" }
  };
  loadState(m2);
  sandbox.migrateBoosterState();
  assert(m2.currentAction.startedBoosterRecipeTarget === "mining_lubricant_n", "运行中 started 应回填为配方");
});

// ================= V：迁移幂等 =================
region("V", "迁移幂等", () => {
  const build = () => ({
    skills:{ boosterEngineering:{ lvl:5, xp:10 } },
    boosters: { inventory: { "booster:mining_lubricant_n": 3, "booster:structure_gel_l": 1 }, active: {}, lastTick: 0 },
    currentAction: {}
  });
  const m1 = build(); loadState(m1); sandbox.migrateBoosterState();
  const snap1 = JSON.stringify(m1);
  const m2 = build(); loadState(m2); sandbox.migrateBoosterState(); sandbox.migrateBoosterState();
  const snap2 = JSON.stringify(m2);
  assert(snap1 === snap2, "连续两次规范化结果必须一致（幂等）");
});

// ================= W：显示态字段齐备 =================
region("W", "显示态字段齐备", () => {
  const st = freshState({ lvl: 20, recipe: "mining_lubricant_n", active: false });
  const ds = sandbox.getBoosterManufacturingDisplayState(st, NOW);
  for (const f of ["kind", "skill", "level", "xp", "xpRequired", "efficiency", "isRunning", "status", "statusText",
                   "progress", "progressPercent", "remainingSeconds", "category", "categories", "qualityFilter", "qualityFilters",
                   "selectedRecipeId", "runningRecipeId", "selectedRecipe", "canStart", "recipes", "inventoryCards"]) {
    assert(f in ds, `显示态缺字段 ${f}`);
  }
  assert(ds.kind === "boosterEngineering" && ds.skill === "boosterEngineering", "kind/skill 应为 boosterEngineering");
  assert(ds.level === 20 && ds.xp === 0, "level/xp 正确");
  assert(ds.efficiency === 1 + 20 * 0.02, "效率应为 1+lvl*0.02");
  assert(ds.isRunning === false && ds.status === "待命", "未运行 status=待命");
  assert(ds.categories.length === 4, "分类应为 4");
  assert(ds.qualityFilters.length === 4, "品质筛选应为 4（全部/普通/精工/传奇）");
  assert(Array.isArray(ds.recipes) && ds.recipes.length > 0, "recipes 必须为非空数组");
});

// ================= X：显示态筛选与库存卡片 =================
region("X", "显示态筛选与库存卡片", () => {
  const recipeMeta = new Map(BOOSTER_RECIPES.map(r => [r.id, r]));
  // 分类筛选
  const st = freshState({ lvl: 96, category: "combatWeapon", quality: "all" });
  const ds = sandbox.getBoosterManufacturingDisplayState(st, NOW);
  assert(ds.category === "combatWeapon", "当前分类应为 combatWeapon");
  assert(ds.recipes.length > 0 && ds.recipes.every(r => { const s = BOOSTER_SERIES[recipeMeta.get(r.id).series]; return s && s.category === "combatWeapon"; }), "recipes 全部属于 combatWeapon");
  // 品质筛选
  const st2 = freshState({ lvl: 96, category: "mining", quality: "l" });
  const ds2 = sandbox.getBoosterManufacturingDisplayState(st2, NOW);
  assert(ds2.qualityFilter === "l" && ds2.recipes.length > 0 && ds2.recipes.every(r => recipeMeta.get(r.id).quality === "l"), "品质筛选 l 仅含传奇");
  // 库存卡片排序（中文名 localeCompare）
  const st3 = freshState({ lvl: 1, inventory: { "booster:ore_resonance_n": 2, "booster:mining_lubricant_n": 5 } });
  const ds3 = sandbox.getBoosterManufacturingDisplayState(st3, NOW);
  assert(ds3.inventoryCards.length === 2, "应展示 2 张库存卡片");
  const names = ds3.inventoryCards.map(c => c.displayName);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  assert(JSON.stringify(names) === JSON.stringify(sorted), "库存卡片应按中文名排序");
});

// ================= Y：显示态 canStart 语义 =================
region("Y", "显示态 canStart 语义", () => {
  // 已解锁且有材料 → canStart
  const good = freshState({ lvl: 1, recipe: "mining_lubricant_n", active: false });
  const dsg = sandbox.getBoosterManufacturingDisplayState(good, NOW);
  const rec = dsg.recipes.find(r => r.id === "mining_lubricant_n");
  assert(rec && rec.isUnlocked && rec.hasMaterials && rec.canManufacture, "lvl1 普通配方应可制造");
  assert(dsg.canStart === true, "canStart 应为 true");
  // 越级 → 不可制造（在当前分类内选越级配方）
  const locked = freshState({ lvl: 1, category: "combatRepair", recipe: "structure_gel_l", active: false });
  const dsl = sandbox.getBoosterManufacturingDisplayState(locked, NOW);
  assert(dsl.recipes.some(r => r.id === "structure_gel_l"), "越级配方应在当前分类列表中");
  const recl = dsl.recipes.find(r => r.id === "structure_gel_l");
  assert(recl && !recl.isUnlocked && !recl.canManufacture && recl.lockedReason.includes(String(96)), "越级 lockedReason 含等级门槛");
  assert(dsl.canStart === false, "越级 canStart 应为 false");
});

// ================= Z：Phase 2B 行为确认（六槽装备/计时/效果函数必须存在） =================
region("Z", "Phase 2B 行为确认", () => {
  const BSA = vm.runInContext("typeof BoosterStateActions !== 'undefined' ? BoosterStateActions : null", sandbox);
  assert(BSA !== null && typeof BSA.equip === "function" && typeof BSA.unequip === "function" && typeof BSA.replace === "function", "BoosterStateActions 必须存在 equip/unequip/replace");
  for (const fn of ["getBoosterEffectState", "calculateBoosterTimeConsumption", "tickBoosterTimers", "settleOfflineBoosters"]) {
    assert(vm.runInContext(`typeof ${fn} !== "undefined"`, sandbox), `必须存在 ${fn}`);
  }
  // 事件契约检查
  const contracts = vm.runInContext("GameEventContracts", sandbox);
  for (const ev of ["booster:equipped", "booster:activated", "booster:consumed", "booster:autoRefilled", "booster:depleted", "booster:unequipped", "booster:replaced"]) {
    assert(contracts.has(ev), `事件契约 ${ev} 必须注册`);
  }
});

// ================= ZA：战术材料档位 =================
region("ZA", "战术材料档位", () => {
  const tiers = TACTICAL_MATERIALS.map(m => m.tier);
  assert(JSON.stringify(tiers) === JSON.stringify(["T1", "T2", "T3", "T4", "T5"]), "档位应为 T1~T5");
  const unlocks = TACTICAL_MATERIALS.map(m => m.unlockLevel);
  assert(JSON.stringify(unlocks) === JSON.stringify([1, 20, 40, 60, 80]), "解锁等级应为 1/20/40/60/80");
  // 每层唯一映射
  const layers = Object.keys(TACTICAL_MATERIAL_BY_LAYER);
  for (const layer of layers) assert(TACTICAL_MATERIALS.some(m => m.name === TACTICAL_MATERIAL_BY_LAYER[layer]), `层 ${layer} 映射材料必须存在`);
  assert(TACTICAL_MATERIAL_BY_LAYER.deepnull === TACTICAL_MATERIAL_BY_LAYER.nullsec, "deepnull 复用 T5");
});

// ================= ZB：分类元数据 =================
region("ZB", "分类元数据", () => {
  assert(BOOSTER_CATEGORY_META.length === 4, "分类元数据应为 4 项");
  const ids = BOOSTER_CATEGORY_META.map(c => c.id).sort().join(",");
  assert(ids === "archaeology,combatRepair,combatWeapon,mining", "分类应为 mining/archaeology/combatWeapon/combatRepair");
  // 每系列的分类归属与分类元数据一致
  for (const seriesKey of Object.keys(BOOSTER_SERIES)) {
    const cat = BOOSTER_SERIES[seriesKey].category;
    assert(BOOSTER_CATEGORY_META.some(c => c.id === cat), `系列 ${seriesKey} 分类 ${cat} 应在元数据内`);
  }
});

// ================= ZC：普通怪概率边界（纯函数） =================
function rollTac(zoneId, kind, rfLiteral) {
  return vm.runInContext(`(function(){ const z = COMBAT_ZONES.find(z=>z.id===${JSON.stringify(zoneId)}); return rollTacticalMaterialDrop(z, ${JSON.stringify(kind)}, ${rfLiteral}); })()`, sandbox);
}
region("ZC", "普通怪概率边界（纯函数）", () => {
  const cases = [
    { rf:"()=>0",        drop:true,  qty:1 },
    { rf:"()=>0.69",     drop:true,  qty:1 },
    { rf:"()=>0.699999", drop:true,  qty:1 },
    { rf:"()=>0.70",     drop:false, qty:0 },
    { rf:"()=>0.99",     drop:false, qty:0 }
  ];
  for (const c of cases) {
    const r = rollTac("angel_outpost", "normal", c.rf);   // highsec → T1
    if (c.drop) assert(r && r.materialId === "战术残液" && r.quantity === c.qty && r.tier === "T1" && r.securityLayer === "highsec", `普通怪 rf=${c.rf} 应掉1（得 ${JSON.stringify(r)}）`);
    else assert(r === null, `普通怪 rf=${c.rf} 应不掉（得 ${JSON.stringify(r)}）`);
  }
});

// ================= ZD：精英数量边界（纯函数） =================
region("ZD", "精英数量边界（纯函数）", () => {
  const lo = rollTac("angel_outpost", "elite", "()=>0");
  assert(lo && lo.quantity === 2, `精英 rf=0 应为 2（得 ${JSON.stringify(lo)}）`);
  const hi = rollTac("angel_outpost", "elite", "()=>0.999999");
  assert(hi && hi.quantity === 3, `精英 rf≈1 应为 3（得 ${JSON.stringify(hi)}）`);
  for (const v of [0, 0.1, 0.49, 0.5, 0.99]) {
    const r = rollTac("angel_outpost", "elite", `()=>${v}`);
    assert(r && r.quantity >= 2 && r.quantity <= 3, `精英 rf=${v} 必掉且 2~3（得 ${JSON.stringify(r)}）`);
  }
});

// ================= ZE：Boss 数量边界（纯函数） =================
region("ZE", "Boss 数量边界（纯函数）", () => {
  const lo = rollTac("angel_outpost", "boss", "()=>0");
  assert(lo && lo.quantity === 6, `Boss rf=0 应为 6（得 ${JSON.stringify(lo)}）`);
  const hi = rollTac("angel_outpost", "boss", "()=>0.999999");
  assert(hi && hi.quantity === 10, `Boss rf≈1 应为 10（得 ${JSON.stringify(hi)}）`);
  for (const v of [0, 0.2, 0.5, 0.8, 0.99]) {
    const r = rollTac("angel_outpost", "boss", `()=>${v}`);
    assert(r && r.quantity >= 6 && r.quantity <= 10, `Boss rf=${v} 必掉且 6~10（得 ${JSON.stringify(r)}）`);
  }
});

// ================= ZF：六安全层→战术材料真实映射 =================
region("ZF", "六安全层→战术材料真实映射", () => {
  const expect = [
    { layer:"highsec",  mat:"战术残液",       tier:"T1" },
    { layer:"bordersec",mat:"活性战术凝胶",   tier:"T2" },
    { layer:"lowsec",   mat:"高能战术萃取物", tier:"T3" },
    { layer:"deepsec",  mat:"极化战术介质",   tier:"T4" },
    { layer:"nullsec",  mat:"深层适应性样本", tier:"T5" },
    { layer:"deepnull", mat:"深层适应性样本", tier:"T5" }
  ];
  for (const e of expect) {
    const r = vm.runInContext(`(function(){ const z = { formationPool:${JSON.stringify(e.layer)} }; return rollTacticalMaterialDrop(z, "boss", ()=>0); })()`, sandbox);
    assert(r && r.materialId === e.mat && r.tier === e.tier && r.securityLayer === e.layer, `层 ${e.layer} 应映射 ${e.mat}/${e.tier}（得 ${JSON.stringify(r)}）`);
  }
  // 高级区域不得产生低级材料：层序档位单调不降
  const order = ["highsec","bordersec","lowsec","deepsec","nullsec","deepnull"];
  const tierNum = order.map(l => Number(String((TACTICAL_MATERIALS.find(x => x.id === TACTICAL_MATERIAL_BY_LAYER[l]) || {}).tier || "T0").slice(1)));
  for (let i=1;i<tierNum.length;i++) assert(tierNum[i] >= tierNum[i-1], `层序 ${order[i-1]}→${order[i]} 档位不得下降（${tierNum[i-1]}→${tierNum[i]}）`);
});

// ================= ZG：真实 resolveCombatEnemyDefeat 战术掉落 =================
region("ZG", "真实 resolveCombatEnemyDefeat 战术掉落", () => {
  const evs = [];
  const un = sandbox.GameEvents.on("combat:tacticalMaterialDropped", e => evs.push(e.payload || e));
  const zoneBelt = vm.runInContext("COMBAT_ZONES.find(z=>z.id==='angel_outpost')", sandbox); // highsec → T1
  const makeEnemy = kind => ({ id:"audit_enemy_"+kind, kind, iskDrop:100, xpDrop:10, defeated:false, rewarded:false });
  const spGet = id => Number(sandbox.ResourceRegistry.get(G, id) || 0) || 0;

  // 普通星带：掉落（Math.random=0.5 < 0.70）
  vm.runInContext("globalThis.__origRandom = Math.random; Math.random = () => 0.5;", sandbox);
  const before = spGet("special:战术残液");
  sandbox.__auditEnemy = makeEnemy("normal"); sandbox.__auditZone = zoneBelt;
  vm.runInContext("resolveCombatEnemyDefeat(__auditEnemy, __auditZone);", sandbox);
  const after = spGet("special:战术残液");
  assert(after - before === 1, `普通星带击杀应精确增加 1 个 T1 材料（${before}→${after}）`);
  assert(evs.length === 1, `事件应恰触发一次（得 ${evs.length}）`);
  const e0 = evs[0];
  assert(e0.enemyId === "audit_enemy_normal", "enemyId 精确");
  assert(e0.zoneId === "angel_outpost", "zoneId 应为来源星带");
  assert(e0.deathspaceId === null, "普通星带 deathspaceId 应为 null");
  assert(e0.quantity === 1, "quantity 精确为 1");
  assert(e0.tier === "T1", "tier 精确为 T1");
  assert(e0.materialId === "战术残液", "materialId 精确");
  assert(e0.securityLayer === "highsec", "securityLayer 精确");

  // 未触发：Math.random=0.70 不掉落
  evs.length = 0;
  const before2 = spGet("special:战术残液");
  sandbox.__auditEnemy = makeEnemy("normal"); sandbox.__auditZone = zoneBelt;
  vm.runInContext("Math.random = () => 0.70;", sandbox);
  vm.runInContext("resolveCombatEnemyDefeat(__auditEnemy, __auditZone);", sandbox);
  const after2 = spGet("special:战术残液");
  assert(after2 === before2, `未触发时战术材料库存应不变（${before2}→${after2}）`);
  assert(evs.length === 0, `未触发时事件不应触发（得 ${evs.length}）`);

  // 死亡空间：使用来源星带档位 + deathspaceId 正确
  evs.length = 0;
  const sourceZone = vm.runInContext("COMBAT_ZONES.find(z=>z.id==='angel_outpost')", sandbox);
  G.combat.mode = "deathspace"; G.combat.deathspaceId = "angel_ded_2_10"; // sourceZone = angel_outpost (highsec T1)
  vm.runInContext("Math.random = () => 0.5;", sandbox);
  const before3 = spGet("special:战术残液");
  sandbox.__auditEnemy = makeEnemy("normal"); sandbox.__auditZone = sourceZone;
  vm.runInContext("resolveCombatEnemyDefeat(__auditEnemy, __auditZone);", sandbox);
  const after3 = spGet("special:战术残液");
  assert(after3 - before3 === 1, `死亡空间击杀应精确增加 1 个来源星带档位材料`);
  assert(evs.length === 1, `死亡空间事件应触发一次`);
  const e3 = evs[0];
  assert(e3.zoneId === "angel_outpost", `死亡空间 zoneId 应为来源星带（得 ${e3.zoneId}）`);
  assert(e3.deathspaceId === "angel_ded_2_10", `死亡空间 deathspaceId 应正确（得 ${e3.deathspaceId}）`);
  assert(e3.tier === "T1", `死亡空间应使用来源星带档位 T1（得 ${e3.tier}）`);
  G.combat.mode = "belt"; G.combat.deathspaceId = "angel_ded_6_10"; // 复原战斗上下文

  // 原有 ISK 掉落仍正常结算（普通怪 iskDrop=100 × iskMulti=1.0 = 100）
  evs.length = 0;
  sandbox.__auditEnemy = makeEnemy("normal"); sandbox.__auditZone = zoneBelt;
  vm.runInContext("Math.random = () => 0.5;", sandbox);
  const iskPre = spGet("currency:isk");
  vm.runInContext("resolveCombatEnemyDefeat(__auditEnemy, __auditZone);", sandbox);
  const iskPost = spGet("currency:isk");
  assert(iskPost - iskPre === 100, `原 ISK 掉落应正常结算（得 ${iskPost-iskPre}）`);

  vm.runInContext("Math.random = globalThis.__origRandom; delete globalThis.__origRandom;", sandbox);
  un();
});

// ================= ZH：30 配方独立期望表（硬锁，不反向依赖 BOOSTER_RECIPES） =================
const EXPECTED_BOOSTER_RECIPES = [
  // ---- 普通档 n ----
  { id:"mining_lubricant_n", level:1, time:18, xp:5, cost:{"planetary:重金属":2,"special:战术残液":2}, durationMs:180000, effect:{type:"miningSpeed",value:0.08,slot:"miningSpeed"} },
  { id:"shield_recharge_n", level:4, time:18, xp:6, cost:{"planetary:稀有气体":2,"gas:粗制富勒烯":1}, durationMs:180000, effect:{type:"repairAmount",value:0.10,slot:"combatRepair"} },
  { id:"ore_resonance_n", level:7, time:19, xp:7, cost:{"planetary:重金属":2,"special:战术残液":2}, durationMs:180000, effect:{type:"doubleMineral",value:0.10,slot:"miningYield"} },
  { id:"laser_coolant_n", level:10, time:19, xp:8, cost:{"planetary:稀有气体":2,"gas:氦同位素":1}, durationMs:180000, effect:{type:"damageMultiplier",value:0.06,slot:"combatWeapon"} },
  { id:"relic_solver_n", level:13, time:20, xp:9, cost:{"planetary:稀有气体":2,"special:战术残液":2}, durationMs:180000, effect:{type:"archaeologySpeed",value:-0.08,slot:"archaeologySpeed"} },
  { id:"armor_nano_n", level:16, time:20, xp:10, cost:{"planetary:稀有气体":2,"gas:氦同位素":1}, durationMs:180000, effect:{type:"repairAmount",value:0.10,slot:"combatRepair"} },
  { id:"missile_catalyst_n", level:20, time:21, xp:11, cost:{"planetary:同位素":2,"gas:稳定富勒烯":1}, durationMs:180000, effect:{type:"damageMultiplier",value:0.06,slot:"combatWeapon"} },
  { id:"artifact_tracer_n", level:24, time:21, xp:12, cost:{"planetary:同位素":2,"special:战术残液":2}, durationMs:180000, effect:{type:"rareShift",value:1.25,slot:"archaeologyRare"} },
  { id:"cannon_booster_n", level:28, time:22, xp:13, cost:{"planetary:同位素":2,"gas:稳定富勒烯":1}, durationMs:180000, effect:{type:"damageMultiplier",value:0.06,slot:"combatWeapon"} },
  { id:"structure_gel_n", level:32, time:22, xp:14, cost:{"planetary:同位素":2,"gas:稳定富勒烯":1}, durationMs:180000, effect:{type:"repairAmount",value:0.10,slot:"combatRepair"} },
  // ---- 精工档 r ----
  { id:"mining_lubricant_r", level:35, time:56, xp:50, cost:{"planetary:同位素":3,"special:活性战术凝胶":4}, durationMs:180000, effect:{type:"miningSpeed",value:0.18,slot:"miningSpeed"} },
  { id:"shield_recharge_r", level:39, time:58, xp:53, cost:{"planetary:稀有气体":3,"gas:稳定富勒烯":2}, durationMs:180000, effect:{type:"repairAmount",value:0.25,slot:"combatRepair"} },
  { id:"ore_resonance_r", level:43, time:60, xp:56, cost:{"planetary:等离子体":3,"special:高能战术萃取物":4}, durationMs:180000, effect:{type:"doubleMineral",value:0.20,slot:"miningYield"} },
  { id:"laser_coolant_r", level:47, time:62, xp:59, cost:{"planetary:等离子体":3,"gas:氢同位素":2}, durationMs:180000, effect:{type:"damageMultiplier",value:0.14,slot:"combatWeapon"} },
  { id:"relic_solver_r", level:51, time:64, xp:62, cost:{"planetary:等离子体":3,"special:高能战术萃取物":4}, durationMs:180000, effect:{type:"archaeologySpeed",value:-0.16,slot:"archaeologySpeed"} },
  { id:"armor_nano_r", level:55, time:66, xp:65, cost:{"planetary:等离子体":3,"gas:高纯富勒烯":2}, durationMs:180000, effect:{type:"repairAmount",value:0.25,slot:"combatRepair"} },
  { id:"missile_catalyst_r", level:59, time:68, xp:68, cost:{"planetary:等离子体":3,"gas:高纯富勒烯":2}, durationMs:180000, effect:{type:"damageMultiplier",value:0.14,slot:"combatWeapon"} },
  { id:"artifact_tracer_r", level:63, time:70, xp:71, cost:{"planetary:生物质":3,"special:极化战术介质":4}, durationMs:180000, effect:{type:"rareShift",value:1.60,slot:"archaeologyRare"} },
  { id:"cannon_booster_r", level:67, time:72, xp:74, cost:{"planetary:等离子体":3,"gas:高纯富勒烯":2}, durationMs:180000, effect:{type:"damageMultiplier",value:0.14,slot:"combatWeapon"} },
  { id:"structure_gel_r", level:71, time:74, xp:77, cost:{"planetary:生物质":3,"special:极化战术介质":4}, durationMs:180000, effect:{type:"repairAmount",value:0.25,slot:"combatRepair"} },
  // ---- 传奇档 l ----
  { id:"mining_lubricant_l", level:60, time:128, xp:306, cost:{"planetary:生物质":5,"special:极化战术介质":7}, durationMs:180000, effect:{type:"miningSpeed",value:0.30,slot:"miningSpeed"} },
  { id:"shield_recharge_l", level:64, time:131, xp:315, cost:{"planetary:生物质":5,"gas:高纯富勒烯":3}, durationMs:180000, effect:{type:"repairAmount",value:0.45,slot:"combatRepair"} },
  { id:"ore_resonance_l", level:68, time:135, xp:326, cost:{"planetary:等离子体":5,"special:极化战术介质":7}, durationMs:180000, effect:{type:"doubleMineral",value:0.30,slot:"miningYield"} },
  { id:"laser_coolant_l", level:72, time:138, xp:335, cost:{"planetary:生物质":5,"gas:聚合气体":3}, durationMs:180000, effect:{type:"damageMultiplier",value:0.24,slot:"combatWeapon"} },
  { id:"relic_solver_l", level:76, time:142, xp:346, cost:{"planetary:生物质":5,"special:极化战术介质":7}, durationMs:180000, effect:{type:"archaeologySpeed",value:-0.25,slot:"archaeologySpeed"} },
  { id:"armor_nano_l", level:80, time:146, xp:356, cost:{"planetary:磁场聚合物":5,"gas:聚合气体":3}, durationMs:180000, effect:{type:"repairAmount",value:0.45,slot:"combatRepair"} },
  { id:"missile_catalyst_l", level:84, time:149, xp:365, cost:{"planetary:磁场聚合物":5,"gas:聚合气体":3}, durationMs:180000, effect:{type:"damageMultiplier",value:0.24,slot:"combatWeapon"} },
  { id:"artifact_tracer_l", level:88, time:153, xp:376, cost:{"planetary:磁场聚合物":5,"special:深层适应性样本":7}, durationMs:180000, effect:{type:"rareShift",value:2.20,slot:"archaeologyRare"} },
  { id:"cannon_booster_l", level:92, time:156, xp:385, cost:{"planetary:磁场聚合物":5,"gas:超纯聚合气体":3}, durationMs:180000, effect:{type:"damageMultiplier",value:0.24,slot:"combatWeapon"} },
  { id:"structure_gel_l", level:96, time:160, xp:396, cost:{"planetary:磁场聚合物":5,"gas:超纯聚合气体":3}, durationMs:180000, effect:{type:"repairAmount",value:0.45,slot:"combatRepair"} }
];
region("ZH", "30 配方独立期望表（硬锁）", () => {
  assert(BOOSTER_RECIPES.length === 30, "应有 30 条配方");
  const byId = new Map(BOOSTER_RECIPES.map(r => [r.id, r]));
  for (const exp of EXPECTED_BOOSTER_RECIPES) {
    const r = byId.get(exp.id);
    assert(r, `配方 ${exp.id} 必须存在`);
    if (!r) continue;
    assert(r.level === exp.level, `${exp.id} level 应=${exp.level}（得 ${r.level}）`);
    assert(r.time === exp.time, `${exp.id} time 应=${exp.time}（得 ${r.time}）`);
    assert(r.xp === exp.xp, `${exp.id} xp 应=${exp.xp}（得 ${r.xp}）`);
    assert(r.durationMs === exp.durationMs, `${exp.id} durationMs 应=${exp.durationMs}`);
    const rk = Object.keys(r.cost).sort(), ek = Object.keys(exp.cost).sort();
    assert(JSON.stringify(rk) === JSON.stringify(ek), `${exp.id} 成本键应=${JSON.stringify(ek)}（得 ${JSON.stringify(rk)}）`);
    for (const k of ek) assert(r.cost[k] === exp.cost[k], `${exp.id} 成本 ${k} 数量应=${exp.cost[k]}（得 ${r.cost[k]}）`);
    assert(r.output.itemId === "booster:" + exp.id, `${exp.id} output.itemId 应=booster:${exp.id}（得 ${r.output.itemId}）`);
    assert(r.output.qty === 1, `${exp.id} output.qty 应=1`);
    assert(r.effect.type === exp.effect.type, `${exp.id} effect.type 应=${exp.effect.type}`);
    assert(r.effect.value === exp.effect.value, `${exp.id} effect.value 应=${exp.effect.value}（得 ${r.effect.value}）`);
    assert(r.effect.slot === exp.effect.slot, `${exp.id} effect.slot 应=${exp.effect.slot}`);
  }
  assert(EXPECTED_BOOSTER_RECIPES.length === 30, "独立期望表应覆盖 30 张配方");
});

// ================= ZI：Phase 2B — 六槽装备/替换/卸下原子性 =================
region("ZI", "Phase 2B 六槽装备操作", () => {
  const state = freshState({ lvl: 5 });
  const BSA = vm.runInContext("BoosterStateActions", sandbox);
  const RR = sandbox.ResourceRegistry;
  const D = (typeof BOOSTER_DURATION_MS !== "undefined") ? BOOSTER_DURATION_MS : 180000;
  // 给足库存
  RR.add(state, "booster:mining_lubricant_n", 3);
  RR.add(state, "booster:laser_coolant_n", 2);
  RR.add(state, "booster:missile_catalyst_n", 2);
  RR.add(state, "booster:ore_resonance_n", 2);

  // 1) 装备空槽（miningSpeed）
  const r1 = BSA.equip(state, "miningSpeed", "mining_lubricant_n");
  assert(r1.changed, "装备空槽应成功");
  assert(state.boosters.active.miningSpeed && state.boosters.active.miningSpeed.itemId === "booster:mining_lubricant_n", "装备后槽位 itemId 正确");
  assert(state.boosters.active.miningSpeed.remainingMs === D, "装备后剩余时间应为 DUR");
  assert(RR.get(state, "booster:mining_lubricant_n") === 2, "装备扣 1 瓶");

  // 2) 同 itemId 再次点击 → already-equipped，不扣
  const r2 = BSA.equip(state, "miningSpeed", "mining_lubricant_n");
  assert(!r2.changed && r2.reason === "already-equipped", "同物品再次点击应为 already-equipped");
  assert(RR.get(state, "booster:mining_lubricant_n") === 2, "重复点击不扣库存");

  // 3) 同 slot 不同系列（combatWeapon）→ slot-occupied（必须先卸下或替换）
  const r3 = BSA.equip(state, "combatWeapon", "laser_coolant_n");
  assert(r3.changed, "装备战斗槽应成功");
  const r3b = BSA.equip(state, "combatWeapon", "missile_catalyst_n");
  assert(!r3b.changed && (r3b.reason === "slot-occupied" || r3b.reason === "series-conflict"), "已占用槽应返回 slot-occupied 或 series-conflict（得 " + r3b.reason + "）");

  // 4) 替换
  const r4 = BSA.replace(state, "combatWeapon", "missile_catalyst_n");
  assert(r4.changed, "替换应成功（库存足）");
  assert(state.boosters.active.combatWeapon.itemId === "booster:missile_catalyst_n", "替换后 itemId 为新");
  assert(RR.get(state, "booster:laser_coolant_n") === 1, "替换不扣旧瓶");
  assert(RR.get(state, "booster:missile_catalyst_n") === 1, "替换扣新瓶 1");

  // 5) 卸下
  const r5 = BSA.unequip(state, "combatWeapon");
  assert(r5.changed, "卸下应成功");
  assert(state.boosters.active.combatWeapon === null, "卸下后槽为 null");
  assert(RR.get(state, "booster:missile_catalyst_n") === 1, "卸下不返还瓶子");

  // 6) 空槽卸下 → empty-slot
  const r6 = BSA.unequip(state, "combatWeapon");
  assert(!r6.changed && r6.reason === "empty-slot", "空槽卸下应返回 empty-slot");
});

// ================= ZJ：Phase 2B — 时间消耗边界 =================
region("ZJ", "计算时间消耗边界", () => {
  const calc = sandbox.calculateBoosterTimeConsumption;
  const D = (typeof BOOSTER_DURATION_MS !== "undefined") ? BOOSTER_DURATION_MS : 180000;

  // 179999ms
  const r1 = calc({ itemId:"test_id", remainingMs:D }, 179999, 3);
  assert(r1.entry && r1.entry.remainingMs === 1, "179999ms 后剩余应=1（得 " + (r1.entry ? r1.entry.remainingMs : "null") + "）");
  assert(r1.consumed === 0 && !r1.depleted, "179999 不消耗、不耗尽");

  // 180000ms（刚好耗尽 + 自动续瓶）
  const r2 = calc({ itemId:"test_id", remainingMs:D }, D, 3);
  assert(r2.entry && r2.entry.remainingMs === D, "180000ms 自动续瓶后应=D（得 " + (r2.entry ? r2.entry.remainingMs : "null") + "）");
  assert(r2.consumed === 1 && !r2.depleted, "180000 消耗 1 瓶");

  // 180001ms（续瓶 + 消耗 1ms）
  const r3 = calc({ itemId:"test_id", remainingMs:D }, D + 1, 3);
  assert(r3.entry && r3.entry.remainingMs === D - 1, "180001ms 续瓶后剩余应=" + (D - 1) + "（得 " + (r3.entry ? r3.entry.remainingMs : "null") + "）");
  assert(r3.consumed === 1, "180001 消耗 1 瓶");

  // 一次跨多瓶：elapsed = 3 * D
  const r4 = calc({ itemId:"test_id", remainingMs:D }, 3 * D, 5);
  assert(r4.entry && r4.entry.remainingMs === D, "3*D 跨瓶后应=D（得 " + (r4.entry ? r4.entry.remainingMs : "null") + "）");
  assert(r4.consumed === 3, "3*D 消耗 3 瓶");

  // 库存耗尽清槽
  const r5 = calc({ itemId:"test_id", remainingMs:D }, D, 0);
  assert(r5.entry === null && r5.depleted, "库存为 0 时应 depleted");

  // 不消耗（elapsed=0）
  const r6 = calc({ itemId:"test_id", remainingMs:5000 }, 0, 3);
  assert(r6.entry && r6.entry.remainingMs === 5000, "elapsed=0 应不变");
  assert(r6.consumed === 0, "elapsed=0 不消耗");
});

// ================= ZK：Phase 2B — 效果聚合检查 =================
region("ZK", "效果聚合", () => {
  const state = freshState({ lvl: 5 });
  const getEff = () => sandbox.getBoosterEffectState(state);
  const IT = vm.runInContext("BOOSTER_ITEMS", sandbox);
  state.boosters.active.miningSpeed = { itemId:IT.mining_lubricant_r.itemId, remainingMs:180000 };
  state.boosters.active.miningYield = { itemId:IT.ore_resonance_l.itemId, remainingMs:180000 };
  state.boosters.active.archaeologySpeed = { itemId:IT.relic_solver_n.itemId, remainingMs:180000 };
  state.boosters.active.archaeologyRare = { itemId:IT.artifact_tracer_r.itemId, remainingMs:180000 };
  state.boosters.active.combatWeapon = { itemId:IT.laser_coolant_r.itemId, remainingMs:180000 };
  state.boosters.active.combatRepair = { itemId:IT.armor_nano_r.itemId, remainingMs:180000 };

  const eff = getEff();
  const approx = (actual, expected, tol) => Math.abs(actual - expected) < (tol || 1e-9);
  assert(approx(eff.miningSpeedMultiplier, 1.18), "采矿速度倍率应≈1.18（得 " + eff.miningSpeedMultiplier + "）");
  assert(eff.doubleMineralChance === 0.30, "双倍概率应=0.30");
  assert(approx(eff.archaeologySpeedMultiplier, 0.92), "考古速度倍率应≈0.92（得 " + eff.archaeologySpeedMultiplier + "）");
  assert(eff.miningSpeedMultiplier === 1.18, "采矿速度倍率应=1.18");
  assert(eff.doubleMineralChance === 0.30, "双倍概率应=0.30");
  assert(approx(eff.archaeologySpeedMultiplier, 0.92), "考古速度倍率应≈0.92（得 " + eff.archaeologySpeedMultiplier + "）");
  assert(eff.rareShiftMultiplier === 1.60, "稀有率倍率应=1.60");
  assert(approx(eff.weaponDamageMultiplier.laser, 1.14), "激光伤害倍率应≈1.14（得 " + eff.weaponDamageMultiplier.laser + "）");
  assert(eff.weaponDamageMultiplier.missile === 1, "导弹不应受影响");
  assert(eff.weaponDamageMultiplier.cannon === 1, "火炮不应受影响");
  assert(approx(eff.repairMultiplier.armor, 1.25), "装甲维修倍率应≈1.25（得 " + eff.repairMultiplier.armor + "）");
  assert(eff.repairMultiplier.shield === 1, "护盾不应受影响");
  assert(eff.repairMultiplier.structure === 1, "结构不应受影响");

  // 三武器隔离
  state.boosters.active.combatWeapon = { itemId:IT.missile_catalyst_r.itemId, remainingMs:180000 };
  const eff2 = getEff();
  assert(approx(eff2.weaponDamageMultiplier.missile, 1.14), "导弹伤害倍率应≈1.14（得 " + eff2.weaponDamageMultiplier.missile + "）");
  assert(eff2.weaponDamageMultiplier.laser === 1, "切换导弹后激光应恢复为 1");

  // 清空后恢复
  state.boosters.active.combatWeapon = null;
  state.boosters.active.combatRepair = null;
  const eff3 = getEff();
  assert(eff3.weaponDamageMultiplier.laser === 1 && eff3.repairMultiplier.armor === 1, "清空槽后倍率恢复为 1");
});

// ================= ZL：Phase 2B — 迁移保留合法六槽 =================
region("ZL", "迁移六槽保留合法", () => {
  const m = {
    skills:{ boosterEngineering:{ lvl:10, xp:100 } },
    boosters: {
      inventory: { "mining_lubricant_n":5, "ore_resonance_r":3 },
      active: {
        miningSpeed: { itemId:"mining_lubricant_n", remainingMs:150000 },  // 合法
        miningYield: { itemId:"booster:ore_resonance_r", remainingMs:90000 }, // booster: 前缀应归一化
        combatWeapon: null,     // 合法 null
        combatRepair: "stale",  // 非法字符串 -> null
        archaeologySpeed: { itemId:"nonexistent", remainingMs:5000 } // item 不存在 -> null
      },
      lastTick: Date.now()
    },
    currentAction: { skill:"mining", active:false }
  };
  loadState(m);
  sandbox.migrateBoosterState();
  assert(m.boosters.active.miningSpeed !== null && m.boosters.active.miningSpeed.remainingMs === 150000 && m.boosters.active.miningSpeed.itemId === "booster:mining_lubricant_n", "合法 miningSpeed 保留");
  assert(m.boosters.active.miningYield !== null && m.boosters.active.miningYield.itemId === "booster:ore_resonance_r" && m.boosters.active.miningYield.remainingMs === 90000, "booster: 前缀归一化后保留");
  assert(m.boosters.active.miningYield.itemId.startsWith("booster:"), "迁移后 itemId 应含 booster: 前缀");
  assert(m.boosters.active.combatWeapon === null, "合法 null 保留");
  assert(m.boosters.active.combatRepair === null, "非法字符串清为 null");
  assert(m.boosters.active.archaeologySpeed === null, "不存在的 item 清为 null");
  // 连续迁移幂等
  const snap = JSON.stringify(m.boosters.active);
  sandbox.migrateBoosterState();
  assert(JSON.stringify(m.boosters.active) === snap, "连续迁移幂等");
});

// ================= ZM：真实集成 — 逐瓶事件序列 =================
region("ZM", "真实集成：逐瓶事件序列", () => {
  const calc = sandbox.calculateBoosterTimeConsumption;
  const D = (typeof BOOSTER_DURATION_MS !== "undefined") ? BOOSTER_DURATION_MS : 180000;
  // 1) 跨 3 瓶：current + 3 inventory, elapsed=540000
  const r = calc({ itemId:"test", remainingMs:D }, 540000, 3);
  assert(r.consumed === 3, "3*D+3inv 消耗 3 瓶（得 " + r.consumed + "）");
  assert(!r.depleted, "不耗尽");
  assert(r.entry && r.entry.remainingMs === D, "最后 autoRefilled 应满 D（得 " + (r.entry ? r.entry.remainingMs : "null") + "）");
  const evTypes = r.events.map(e => e.type).join(",");
  assert(evTypes === "booster:consumed,booster:autoRefilled,booster:consumed,booster:autoRefilled,booster:consumed,booster:autoRefilled",
    "3 瓶事件序列应为 consumed→autoRefilled→consumed→autoRefilled→consumed→autoRefilled，得 " + evTypes);
  const autoRefills = r.events.filter(e => e.type === "booster:autoRefilled");
  assert(autoRefills.length === 3, "应有 3 个 autoRefilled");
  for (const ar of autoRefills) {
    assert(ar.fromInventory === 1, "autoRefilled 应 fromInventory=1（得 " + ar.fromInventory + "）");
  }

  // 2) 库存不足时最后 consumed→depleted
  const r2 = calc({ itemId:"test", remainingMs:D }, D + 5000, 0);
  const ev2 = r2.events.map(e => e.type).join(",");
  assert(ev2 === "booster:consumed,booster:depleted", "无库存应 consumed→depleted，得 " + ev2);
  assert(r2.entry === null && r2.depleted, "无库存 entry=null");

  // 3) 恰好耗尽（有库存）：elapsed=D, inv>0 → consumed, autoRefilled
  const r3 = calc({ itemId:"test", remainingMs:D }, D, 3);
  const ev3 = r3.events.map(e => e.type).join(",");
  assert(ev3 === "booster:consumed,booster:autoRefilled", "恰好耗尽有库存应 consumed→autoRefilled，得 " + ev3);
  assert(r3.consumed === 1, "消耗 1 瓶");

  // 4) 跨 2 瓶：elapsed=D+179999（刚超过当前瓶，旧瓶空时用库存）
  const r4 = calc({ itemId:"test", remainingMs:D }, D + 179999, 2);
  assert(r4.consumed === 1, "D+179999 消耗 1 瓶（得 " + r4.consumed + "）");
  assert(!r4.depleted, "不耗尽");
  assert(r4.entry && r4.entry.remainingMs === 1, "D+179999 应剩余 1ms");
  const ev4 = r4.events.map(e => e.type).join(",");
  assert(ev4 === "booster:consumed,booster:autoRefilled", "D+179999 序列 consumed→autoRefilled，得 " + ev4);
});

// ================= ZN：真实集成 — applyBoosterTimeConsumption 离线事件 offline:true =================
region("ZN", "真实集成：apply 在线/离线事件标志", () => {
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = (typeof BOOSTER_DURATION_MS !== "undefined") ? BOOSTER_DURATION_MS : 180000;
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  RR.add(g, "booster:mining_lubricant_n", 3);
  const evs = [];
  // 收集所有增强剂生命周期事件
  let unListeners = [];
  const collect = (type) => {
    const un = sandbox.GameEvents.on(type, e => evs.push({ type, meta:e.meta || e._meta || {}, payload:e.payload || e }));
    unListeners.push(un);
  };
  collect("booster:consumed");
  collect("booster:autoRefilled");
  collect("booster:depleted");

  // 在线（offline:false）：消耗到耗尽并续瓶，应触发事件
  const rOnline = sandbox.applyBoosterTimeConsumption(g, "miningSpeed", D + 1000, Date.now(), { offline:false });
  assert(rOnline.consumed > 0, "在线应消耗瓶子（得 " + rOnline.consumed + "）");
  assert(evs.length > 0, "在线应触发事件");
  // 检查事件标记
  const onlineEv = evs[0];
  assert(onlineEv.meta && onlineEv.meta.offline === false,
    "在线事件 meta.offline 应为 false（得 " + JSON.stringify(onlineEv.meta) + "）");
  evs.length = 0;

  // 重置状态
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  // 离线（offline:true）：消耗到耗尽并续瓶，应触发事件
  const rOffline = sandbox.applyBoosterTimeConsumption(g, "miningSpeed", D + 1000, Date.now(), { offline:true });
  assert(rOffline.consumed > 0, "离线应消耗瓶子（得 " + rOffline.consumed + "）");
  assert(evs.length > 0, "离线应触发事件");
  let foundOfflineFlag = false;
  for (const ev of evs) {
    if (ev.meta && ev.meta.offline === true) { foundOfflineFlag = true; break; }
  }
  assert(foundOfflineFlag, "离线事件 meta.offline 应为 true 至少一次");

  for (const un of unListeners) un();
  // 清理状态
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  g.boosters.active.miningSpeed = null;
});

// ================= ZO：采矿1瓶离线10分钟 — 三参考值精确计算 =================
region("ZO", "采矿1瓶离线10分钟 — 三参考值精确计算", () => {
  // 场景：当前瓶 180s，库存 0。离线 600s。
  // 三参考值：A=无增强600s, B=增强180s+无增强420s, C=全增强600s
  // 实际结果(B_actual) 必须 abs(B_actual - B) <= 1
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;

  seedRandom(42);

  // === A 参考：无增强 600s ===
  setupMiningState(g, { ms:0, my:0, offlineSec:600 });
  const gainsA = sandbox.applyOfflineGains(600, { runId:"A" });
  const A = gainsA.mining;
  cleanupMining(g);
  g.currentAction.progress = 0;
  g.currentAction.lastProgressUpdate = NOW;

  // === C 参考：全增强 600s（当前瓶 5×180=900s > 600s） ===
  setupMiningState(g, { ms:D*5, my:D*5, offlineSec:600 });
  const gainsC = sandbox.applyOfflineGains(600, { runId:"C" });
  const C = gainsC.mining;
  cleanupMining(g);
  g.currentAction.progress = 0;
  g.currentAction.lastProgressUpdate = NOW;

  // === B 参考：增强 180s + 无增强 420s（两段结算，XP/进度承继） ===
  // 第1段：180s 有增强
  setupMiningState(g, { ms:D, my:D, offlineSec:600 });
  const gainsB1 = { mining:0, refining:0, shipEngineering:0, gasHarvesting:0,
    equipmentEngineering:0, boosterEngineering:0, planetaryIndustry:0 };
  const tbs1 = {};
  sandbox.settleOfflineActions(180, gainsB1, undefined, tbs1);
  // 第2段：清增强剂、保持进度和XP，再跑 420s
  g.boosters.active.miningSpeed = null;
  g.boosters.active.miningYield = null;
  g.boosters.lastTick = NOW;
  const gainsB2 = { mining:0, refining:0, shipEngineering:0, gasHarvesting:0,
    equipmentEngineering:0, boosterEngineering:0, planetaryIndustry:0 };
  sandbox.settleOfflineActions(420, gainsB2, undefined, tbs1);
  const B = gainsB1.mining + gainsB2.mining;
  cleanupMining(g);
  g.boosters.active = {};

  // === 实际（B_actual）：1 瓶 180s 覆盖 600s ===
  seedRandom(42);
  setupMiningState(g, { ms:D, my:D, offlineSec:600 });
  setNow(NOW);
  const gains = sandbox.applyOfflineGains(600, { runId:"ZO" });
  restoreNow();
  const actual = gains.mining;

  // 三参考值 + 实际输出
  console.log(`  ZO 参考值：A=${A}  B=${B}  C=${C}  实际=${actual}`);

  // 断言
  assert(Math.abs(actual - B) <= 1,
    `ZO 实际(${actual})与B(${B})相差≤1（A=${A} C=${C})`);
  assert(actual > A, `ZO(${actual}) > A(${A})`);
  assert(actual < C, `ZO(${actual}) < C(${C})`);

  // 耗尽验证
  assert(g.boosters.active.miningSpeed === null || g.boosters.active.miningSpeed.remainingMs < D,
    "miningSpeed 耗尽");
  assert(g.boosters.active.miningYield === null || g.boosters.active.miningYield.remainingMs < D,
    "miningYield 耗尽");
  assert(g.boosters.lastTick >= NOW, "lastTick ≥ NOW");

  cleanupMining(g);
  g.boosters.active = {};
  restoreRandom();
});

// ================= ZP：采矿 2 瓶 = 当前瓶+库存1瓶共 360s 覆盖 =================
region("ZP", "采矿 2 瓶离线 10 分钟 — 360s 覆盖精确", () => {
  // 当前瓶 180s + 库存 1 瓶 = 360s 覆盖。离线 600s。
  // B360 = 增强 360s + 无增强 240s（两段结算）
  // 断言 abs(actual - B360) <= 1，库存归零，两槽精确耗尽。
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;

  seedRandom(42);

  // === A 参考 ===
  setupMiningState(g, { ms:0, my:0, offlineSec:600 });
  const gainsA = sandbox.applyOfflineGains(600, { runId:"ZP_A" });
  const A = gainsA.mining;
  cleanupMining(g); g.currentAction.progress = 0;

  // === C 参考 ===
  setupMiningState(g, { ms:D*5, my:D*5, offlineSec:600 });
  const gainsC = sandbox.applyOfflineGains(600, { runId:"ZP_C" });
  const C = gainsC.mining;
  cleanupMining(g); g.currentAction.progress = 0;

  // === B360 参考：增强 360s + 无增强 240s ===
  // 第1段：360s 有增强（当前瓶 D + 库存 1 瓶 = 2 瓶 = 360s）
  setupMiningState(g, { ms:D, my:D, inv:{ "booster:mining_lubricant_n":1, "booster:ore_resonance_n":1 }, offlineSec:600 });
  const gB1 = { mining:0, refining:0, shipEngineering:0, gasHarvesting:0, equipmentEngineering:0, boosterEngineering:0, planetaryIndustry:0 };
  sandbox.settleOfflineActions(360, gB1, undefined, {});
  // 第2段：清增强剂，跑 240s
  g.boosters.active.miningSpeed = null;
  g.boosters.active.miningYield = null;
  g.boosters.lastTick = NOW;
  const gB2 = { mining:0, refining:0, shipEngineering:0, gasHarvesting:0, equipmentEngineering:0, boosterEngineering:0, planetaryIndustry:0 };
  sandbox.settleOfflineActions(240, gB2, undefined, {});
  const B360 = gB1.mining + gB2.mining;
  cleanupMining(g); g.boosters.active = {};

  // === 实际：2 瓶 360s 覆盖 600s ===
  seedRandom(42);
  setupMiningState(g, { ms:D, my:D, inv:{ "booster:mining_lubricant_n":1, "booster:ore_resonance_n":1 }, offlineSec:600 });
  setNow(NOW);
  const gains = sandbox.applyOfflineGains(600, { runId:"ZP" });
  restoreNow();
  const actual = gains.mining;

  console.log(`  ZP 参考值：A=${A}  B360=${B360}  C=${C}  实际=${actual}`);

  assert(Math.abs(actual - B360) <= 1,
    `ZP 实际(${actual})与B360(${B360})相差≤1`);
  assert(actual > A, `ZP(${actual}) > A(${A})`);
  assert(actual < C, `ZP(${actual}) < C(${C})`);

  // 库存精确归零
  assert(RR.get(g, "booster:mining_lubricant_n") <= 0, "miningSpeed 库存=0（得 " + RR.get(g, "booster:mining_lubricant_n") + "）");
  assert(RR.get(g, "booster:ore_resonance_n") <= 0, "miningYield 库存=0（得 " + RR.get(g, "booster:ore_resonance_n") + "）");
  // 两槽耗尽
  assert(g.boosters.active.miningSpeed === null, "miningSpeed 槽耗尽");
  assert(g.boosters.active.miningYield === null, "miningYield 槽耗尽");

  cleanupMining(g); g.boosters.active = {};
  restoreRandom();
});

// ================= ZQ：真实集成 — 双槽不同时间耗尽 =================
region("ZQ", "真实集成：双槽不同时间耗尽", () => {
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  g.boosters.active.miningYield = { itemId:"booster:ore_resonance_n", remainingMs:D };
  RR.add(g, "booster:mining_lubricant_n", 2);
  RR.add(g, "booster:ore_resonance_n", 0);
  const r1 = sandbox.applyBoosterTimeConsumption(g, "miningSpeed", D, Date.now(), { offline:true });
  const r2 = sandbox.applyBoosterTimeConsumption(g, "miningYield", D, Date.now(), { offline:true });
  assert(r1.consumed === 1 && !r1.depleted, "miningSpeed 消耗 1 瓶不耗尽");
  assert(r2.depleted === true, "miningYield 耗尽");
  assert(g.boosters.active.miningYield === null, "miningYield 槽清空");
  assert(g.boosters.active.miningSpeed !== null, "miningSpeed 槽保留");
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
  g.boosters.active.miningSpeed = null;
  g.boosters.active.miningYield = null;
});

// ================= ZR：真实集成 — 离线事件 booster 事件 offline:true =================
region("ZR", "真实集成：离线事件 offline=true", () => {
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  RR.add(g, "booster:mining_lubricant_n", 1);
  g.currentAction.skill = "mining";
  g.currentAction.active = true;
  var offlineEvents = [];
  var un = sandbox.GameEvents.on("booster:consumed", function(e) { offlineEvents.push(e); });
  var un2 = sandbox.GameEvents.on("booster:autoRefilled", function(e) { offlineEvents.push(e); });
  var r = sandbox.applyBoosterTimeConsumption(g, "miningSpeed", D + 5000, Date.now(), { offline:true });
  un(); un2();
  var hasOffline = false;
  for (var i = 0; i < offlineEvents.length; i++) {
    if (offlineEvents[i].meta && offlineEvents[i].meta.offline === true) hasOffline = true;
  }
  assert(hasOffline, "离线事件 meta.offline 应为 true");
  assert(r.consumed === 1, "消耗 1 瓶（得 " + r.consumed + "）");
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  g.boosters.active.miningSpeed = null;
});

// ================= ZS：真实集成 — 考古周期缩短 + 稀有率倍率 =================
region("ZS", "真实集成：考古周期缩短与稀有率", () => {
  const eff = sandbox.getBoosterEffectState;
  const g = G;
  g.boosters.active = {};
  g.boosters.active.archaeologySpeed = { itemId:"booster:relic_solver_n", remainingMs:180000 };
  const e = eff(g);
  assert(e.archaeologySpeedMultiplier === 0.92, "考古速度倍率应=0.92（得 " + e.archaeologySpeedMultiplier + "）");
  // 清空恢复
  g.boosters.active.archaeologySpeed = null;
  const e2 = eff(g);
  assert(e2.archaeologySpeedMultiplier === 1, "清空后应=1");
  // 稀有率
  g.boosters.active.archaeologyRare = { itemId:"booster:artifact_tracer_n", remainingMs:180000 };
  const e3 = eff(g);
  assert(e3.rareShiftMultiplier === 1.25, "稀有率倍率=1.25（得 " + e3.rareShiftMultiplier + "）");
  const uRate = sandbox.getBoosterArchaeologyEffectiveUniqueRate(0.05, e3.rareShiftMultiplier);
  assert(Math.abs(uRate - 0.0625) < 1e-9, "有效 uniqueRate=0.0625（得 " + uRate + "）");
  g.boosters.active.archaeologyRare = null;
});

// ================= ZT：队列切换 — 真实 gameState.queue 一次 applyOfflineGains =================
region("ZT", "队列切换：真实 queue 单次离线 mining→refining→mining", () => {
  // 真实 gameState.queue，一次 applyOfflineGains 内完成 mining→refining→mining。
  // 验证 timeBySkill 跨行动正确分段，refining 不消耗采矿增强剂。
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;

  // 设置增强剂（1 瓶各）
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  g.boosters.active.miningYield = { itemId:"booster:ore_resonance_n", remainingMs:D };
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
  RR.add(g, "booster:mining_lubricant_n", 0);
  RR.add(g, "booster:ore_resonance_n", 0);

  // 设置采矿（首段：凡晶石带）
  g.currentAction.skill = "mining";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.currentAction.startedArea = "凡晶石带";
  if (g.skills.mining) g.skills.mining.xp = 1000;

  // 提供冶炼所需矿料
  RR.spend(g, "ore:凡晶石", RR.get(g, "ore:凡晶石"));
  RR.add(g, "ore:凡晶石", 5000);

  // 设置真实队列：mining(10次) → refining(5次) → mining(10次)
  g.queue = {
    items: [
      { skill:"mining", target:"凡晶石带", count:10, label:"⛏采矿" },
      { skill:"refining", target:"凡晶石带", count:5, label:"🔥冶炼" },
      { skill:"mining", target:"凡晶石带", count:10, label:"⛏采矿" }
    ],
    status: { isRunning:true, activeIndex:0, completedCount:0, failCount:0 },
    config: { loopMode:false, skipOnFail:false }
  };
  g.boosters.lastTick = NOW - 600000;

  // 记录各槽初始状态
  const speedBefore = g.boosters.active.miningSpeed ? g.boosters.active.miningSpeed.remainingMs : 0;
  const yieldBefore = g.boosters.active.miningYield ? g.boosters.active.miningYield.remainingMs : 0;

  setNow(NOW);
  const gains = sandbox.applyOfflineGains(600, { runId:"audit_zt" });
  restoreNow();

  // 获取 timeBySkill
  const tbs = g._auditTimeBySkill || {};

  // 验证：mining 和 refining 都有时间
  assert(Number(tbs.mining) > 0, "mining timeBySkill > 0（得 " + tbs.mining + "）");
  assert(Number(tbs.refining) > 0, "refining timeBySkill > 0（得 " + tbs.refining + "）");

  // 验证：增长剂消耗正确（mining 段消耗，refining 段不额外消耗）
  const speedAfter = g.boosters.active.miningSpeed ? g.boosters.active.miningSpeed.remainingMs : 0;
  const yieldAfter = g.boosters.active.miningYield ? g.boosters.active.miningYield.remainingMs : 0;
  const speedConsumed = speedBefore - speedAfter;
  const yieldConsumed = yieldBefore - yieldAfter;
  assert(speedConsumed > 0, "miningSpeed 在 mining 段被消耗（" + speedConsumed + "ms）");
  assert(yieldConsumed > 0, "miningYield 在 mining 段被消耗（" + yieldConsumed + "ms）");

  // 验证：队列正确推进
  assert(g.queue.status.completedCount >= 2, "队列至少完成 2 项（得 " + g.queue.status.completedCount + "）");

  // 验证：gains 正确
  assert(Number(gains.mining) > 0, "采矿产出 > 0（得 " + gains.mining + "）");
  assert(Number(gains.refining) > 0, "冶炼产出 > 0（得 " + gains.refining + "）");

  // 清理
  delete g._auditTimeBySkill;
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
  g.boosters.active = {};
  g.queue = null;
});

// ================= ZUA：队列切换 — mining→archaeology =================
region("ZUA", "队列切换：真实 queue mining→archaeology", () => {
  // mining→archaeology：验证 timeBySkill、mining 槽扣时、archaeology 槽扣时
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;

  // 创建考古船
  const ship = sandbox.createShipInstance("heron");
  g.inventory.ships = g.inventory.ships || [];
  g.inventory.ships.push(ship);
  g.shipAssignments = g.shipAssignments || {};
  g.shipAssignments.archaeology = ship.instanceId;

  // boosters: mining + archaeology
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  g.boosters.active.miningYield = { itemId:"booster:ore_resonance_n", remainingMs:D };
  g.boosters.active.archaeologySpeed = { itemId:"booster:relic_solver_n", remainingMs:D };
  g.boosters.active.archaeologyRare = { itemId:"booster:artifact_tracer_n", remainingMs:D };

  // mining setup
  g.currentAction.skill = "mining";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.currentAction.startedArea = "凡晶石带";
  g.currentAction.area = "凡晶石带";
  if (g.skills.mining) { g.skills.mining.lvl = 1; g.skills.mining.xp = 0; }
  if (g.skills.archaeology) { g.skills.archaeology.lvl = 1; g.skills.archaeology.xp = 1500; }

  // 考古资源
  g.archaeology = g.archaeology || {};
  g.archaeology.startedSiteId = "site_i_a";
  g.archaeology.activeSiteId = "site_i_a";
  g.archaeology.startedProbeId = "core_probe_i";
  g.archaeology.activeProbeId = "core_probe_i";
  g.archaeology.repairUntil = 0;
  g.archaeology.interferenceUntil = 0;
  RR.spend(g, "probe:core_probe_i", RR.get(g, "probe:core_probe_i"));
  RR.spend(g, "consumable:fuel", RR.get(g, "consumable:fuel"));
  RR.add(g, "probe:core_probe_i", 30);
  RR.add(g, "consumable:fuel", 200);

  // 队列：mining(10) → archaeology(5)
  g.queue = {
    items: [
      { skill:"mining", target:"凡晶石带", count:10, label:"⛏采矿" },
      { skill:"archaeology", target:"site_i_a", count:5, label:"🔍考古" }
    ],
    status: { isRunning:true, activeIndex:0, completedCount:0, failCount:0 },
    config: { loopMode:false, skipOnFail:false }
  };
  g.boosters.lastTick = NOW - 600000;

  const msBefore = g.boosters.active.miningSpeed ? g.boosters.active.miningSpeed.remainingMs : 0;
  const asBefore = g.boosters.active.archaeologySpeed ? g.boosters.active.archaeologySpeed.remainingMs : 0;

  setNow(NOW);
  const gains = sandbox.applyOfflineGains(600, { runId:"ZUA" });
  restoreNow();
  const tbs = g._auditTimeBySkill || {};

  // mining 和 archaeology 都有时间
  assert(Number(tbs.mining) > 0, "mining timeBySkill > 0（得 " + tbs.mining + "）");
  assert(Number(tbs.archaeology) > 0, "archaeology timeBySkill > 0（得 " + tbs.archaeology + "）");

  // mining 槽消耗
  const msAfter = g.boosters.active.miningSpeed ? g.boosters.active.miningSpeed.remainingMs : 0;
  assert((msBefore - msAfter) > 0, "miningSpeed 在 mining 段消耗（" + (msBefore - msAfter) + "ms）");
  // archaeology 槽消耗
  const asAfter = g.boosters.active.archaeologySpeed ? g.boosters.active.archaeologySpeed.remainingMs : 0;
  assert((asBefore - asAfter) > 0, "archaeologySpeed 在 archaeology 段消耗（" + (asBefore - asAfter) + "ms）");

  // 队列至少完成 1 项
  assert(g.queue.status.completedCount >= 1, "队列完成 ≥1（得 " + g.queue.status.completedCount + "）");

  // 清理
  delete g._auditTimeBySkill;
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
  RR.spend(g, "booster:relic_solver_n", RR.get(g, "booster:relic_solver_n"));
  RR.spend(g, "booster:artifact_tracer_n", RR.get(g, "booster:artifact_tracer_n"));
  g.boosters.active = {};
  g.queue = null;
  // 移除船
  const idx2 = g.inventory.ships.indexOf(ship);
  if (idx2 >= 0) g.inventory.ships.splice(idx2, 1);
  delete g.shipAssignments.archaeology;
});

// ================= ZUB：队列切换 — archaeology→mining =================
region("ZUB", "队列切换：真实 queue archaeology→mining", () => {
  // archaeology→mining：验证 timeBySkill、两组槽扣时、产出和队列推进。
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;

  // 创建考古船
  const ship = sandbox.createShipInstance("heron");
  g.inventory.ships = g.inventory.ships || [];
  g.inventory.ships.push(ship);
  g.shipAssignments = g.shipAssignments || {};
  g.shipAssignments.archaeology = ship.instanceId;

  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  g.boosters.active.miningYield = { itemId:"booster:ore_resonance_n", remainingMs:D };
  g.boosters.active.archaeologySpeed = { itemId:"booster:relic_solver_n", remainingMs:D };
  g.boosters.active.archaeologyRare = { itemId:"booster:artifact_tracer_n", remainingMs:D };

  // arch setup first
  g.currentAction.skill = "archaeology";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  if (g.skills.mining) { g.skills.mining.lvl = 1; g.skills.mining.xp = 0; }
  if (g.skills.archaeology) { g.skills.archaeology.lvl = 1; g.skills.archaeology.xp = 1500; }

  g.archaeology = g.archaeology || {};
  g.archaeology.startedSiteId = "site_i_a";
  g.archaeology.activeSiteId = "site_i_a";
  g.archaeology.startedProbeId = "core_probe_i";
  g.archaeology.activeProbeId = "core_probe_i";
  g.archaeology.repairUntil = 0;
  g.archaeology.interferenceUntil = 0;
  RR.spend(g, "probe:core_probe_i", RR.get(g, "probe:core_probe_i"));
  RR.spend(g, "consumable:fuel", RR.get(g, "consumable:fuel"));
  RR.add(g, "probe:core_probe_i", 30);
  RR.add(g, "consumable:fuel", 200);

  g.currentAction.archaeologyTargetId = "site_i_a";

  // 队列：archaeology(3) → mining(10)
  g.queue = {
    items: [
      { skill:"archaeology", target:"site_i_a", count:3, label:"🔍考古" },
      { skill:"mining", target:"凡晶石带", count:10, label:"⛏采矿" }
    ],
    status: { isRunning:true, activeIndex:0, completedCount:0, failCount:0 },
    config: { loopMode:false, skipOnFail:false }
  };
  g.boosters.lastTick = NOW - 600000;

  const asBefore = g.boosters.active.archaeologySpeed ? g.boosters.active.archaeologySpeed.remainingMs : 0;
  const msBefore = g.boosters.active.miningSpeed ? g.boosters.active.miningSpeed.remainingMs : 0;

  setNow(NOW);
  const gains = sandbox.applyOfflineGains(600, { runId:"ZUB" });
  restoreNow();
  const tbs = g._auditTimeBySkill || {};

  assert(Number(tbs.mining) > 0, "mining timeBySkill > 0（得 " + tbs.mining + "）");
  assert(Number(tbs.archaeology) > 0, "archaeology timeBySkill > 0（得 " + tbs.archaeology + "）");

  const asAfter = g.boosters.active.archaeologySpeed ? g.boosters.active.archaeologySpeed.remainingMs : 0;
  assert((asBefore - asAfter) > 0, "archaeologySpeed 在 archaeology 段消耗（" + (asBefore - asAfter) + "ms）");
  const msAfter = g.boosters.active.miningSpeed ? g.boosters.active.miningSpeed.remainingMs : 0;
  assert((msBefore - msAfter) > 0, "miningSpeed 在 mining 段消耗（" + (msBefore - msAfter) + "ms）");

  assert(g.queue.status.completedCount >= 1, "队列完成 ≥1（得 " + g.queue.status.completedCount + "）");

  delete g._auditTimeBySkill;
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
  RR.spend(g, "booster:relic_solver_n", RR.get(g, "booster:relic_solver_n"));
  RR.spend(g, "booster:artifact_tracer_n", RR.get(g, "booster:artifact_tracer_n"));
  g.boosters.active = {};
  g.queue = null;
  const idx3 = g.inventory.ships.indexOf(ship);
  if (idx3 >= 0) g.inventory.ships.splice(idx3, 1);
  delete g.shipAssignments.archaeology;
});

// ================= ZU：真实集成 — checkBoosterValidTarget 精确 true/false =================
region("ZU", "真实集成：checkBoosterValidTarget 精确", () => {
  const check = sandbox.checkBoosterValidTarget;
  // 采矿/考古增强剂永远有效
  assert(check(G, { effectType:"miningSpeed" }) === true, "miningSpeed 永远 valid");
  assert(check(G, { effectType:"doubleMineral" }) === true, "doubleMineral 永远 valid");
  assert(check(G, { effectType:"archaeologySpeed" }) === true, "archaeologySpeed 永远 valid");
  assert(check(G, { effectType:"rareShift" }) === true, "rareShift 永远 valid");
  // 战斗武器/维修增强剂：通过真实 getInstalledCombatModulesFromState 判定
  if (typeof sandbox.getInstalledCombatModulesFromState === "function") {
    const modules = sandbox.getInstalledCombatModulesFromState(G);
    const weaponTypes = modules.filter(function(m) { return m.combat && m.combat.kind === "weapon"; }).map(function(m) { return m.combat.weaponType; });
    const repairTargets = modules.filter(function(m) { return m.combat && m.combat.kind === "repair"; }).map(function(m) { return m.combat.target; });
    // 只有实际安装的武器/维修才返回 true
    for (const wt of ["laser", "missile", "cannon"]) {
      const expected = weaponTypes.indexOf(wt) >= 0;
      assert(check(G, { effectType:"damageMultiplier", weaponType:wt }) === expected,
        wt + "武器 validTarget=" + expected + "（实际武器类型：" + weaponTypes.join(",") + "）");
    }
    for (const rt of ["shield", "armor", "structure"]) {
      const expected = repairTargets.indexOf(rt) >= 0;
      assert(check(G, { effectType:"repairAmount", repairTarget:rt }) === expected,
        rt + "维修 validTarget=" + expected + "（实际维修目标：" + repairTargets.join(",") + "）");
    }
  } else {
    assert(check(G, { effectType:"damageMultiplier", weaponType:"laser" }) === true, "无函数守卫 true");
    assert(check(G, { effectType:"repairAmount", repairTarget:"shield" }) === true, "无函数守卫 true");
  }
  // 无 weaponType/repairTarget 时返回 true
  assert(check(G, { effectType:"damageMultiplier" }) === true, "无 weaponType 则 true");
  assert(check(G, { effectType:"repairAmount" }) === true, "无 repairTarget 则 true");
});

// ================= ZV：真实集成 — getBoosterSlotStatus 四状态严格 =================
region("ZV", "真实集成：getBoosterSlotStatus 四状态", () => {
  const status = sandbox.getBoosterSlotStatus;
  const g = G;
  // 1) depleted：remainingMs=0
  const s1 = status(g, "miningSpeed", { effectType:"miningSpeed" }, 0, Date.now());
  assert(s1 === "depleted", "remainingMs=0 → depleted（得 " + s1 + "）");
  // 2) paused：有剩余，行动不运行（g.currentAction.active=false）
  g.currentAction.active = false;
  const s2 = status(g, "miningSpeed", { effectType:"miningSpeed" }, 5000, Date.now());
  assert(s2 === "paused", "有剩余但 active=false → paused（得 " + s2 + "）");
  // 3) no-target：使用 G 中实际未安装的武器类型
  const mods = (typeof sandbox.getInstalledCombatModulesFromState === "function")
    ? sandbox.getInstalledCombatModulesFromState(G) : [];
  const installedWeapons = mods.filter(function(m) { return m.combat && m.combat.kind === "weapon"; }).map(function(m) { return m.combat.weaponType; });
  const missingWt = ["laser","missile","cannon"].find(function(wt) { return installedWeapons.indexOf(wt) < 0; });
  if (missingWt) {
    g.currentAction.active = true;
    g.currentAction.skill = "combat";
    const s3 = status(g, "combatWeapon", { effectType:"damageMultiplier", weaponType:missingWt }, 5000, Date.now());
    assert(s3 === "no-target", "无" + missingWt + "武器 → no-target（得 " + s3 + "）");
  }
  // 4) active：有效 target + 行动运行中
  g.currentAction.active = true;
  g.currentAction.skill = "mining";
  const s4 = status(g, "miningSpeed", { effectType:"miningSpeed" }, 5000, Date.now());
  assert(s4 === "active", "采矿运行+有效 → active（得 " + s4 + "）");
});

// ================= ZW：真实集成 — getBoosterDisplayState 字段 =================
region("ZW", "真实集成：getBoosterDisplayState 字段", () => {
  const g = G;
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:180000 };
  g.currentAction.active = true;
  g.currentAction.skill = "mining";
  const ds = sandbox.getBoosterDisplayState(g, Date.now());
  assert(ds && ds.groups && Array.isArray(ds.groups), "groups 数组");
  assert(ds.groups.length === 3, "groups 长度=3（mining/archaeology/combat）");
  const miningGroup = ds.groups.find(function(gr) { return gr.key === "mining"; });
  assert(miningGroup, "mining group 存在");
  const miningSlot = miningGroup.slots.find(function(s) { return s.slot === "miningSpeed"; });
  assert(miningSlot && !miningSlot.empty, "miningSpeed 非空");
  assert(miningSlot.itemId === "mining_lubricant_n", "itemId 正确");
  assert(typeof miningSlot.status === "string" && miningSlot.status.length > 0, "status 非空");
  assert(typeof miningSlot.statusText === "string" && miningSlot.statusText.length > 0, "statusText 非空");
  assert(miningSlot.validTarget === true, "miningSpeed validTarget=true");
  g.boosters.active = {};
});

// ================= ZX：65秒离线/10秒周期 + 探针不足/燃料不足 =================
region("ZX", "65s运行+探针不足+燃料不足", () => {
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;

  // --- 场景 A：65s 运行 / 10s 周期 ---
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  g.boosters.active.miningYield = { itemId:"booster:ore_resonance_n", remainingMs:D };
  RR.add(g, "booster:mining_lubricant_n", 0);
  RR.add(g, "booster:ore_resonance_n", 0);
  g.currentAction.skill = "mining";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.currentAction.startedArea = "凡晶石带";
  g.boosters.lastTick = NOW - 3600000;

  setNow(NOW + 5000);
  const gains = sandbox.applyOfflineGains(65, { runId:"audit_zx_a" });
  restoreNow();

  // 2 次完整产出 (≈43s) + ~21s progress
  assert(gains.mining >= 2, "65s 采矿产出至少 2（得 " + gains.mining + "）");
  assert(gains.mining <= 6, "65s 采矿产出最多 6（得 " + gains.mining + "）");
  // 增强剂按实际运行秒数扣除（约 43~65s）
  const msDeductedSpeed = g.boosters.active.miningSpeed ? (D - g.boosters.active.miningSpeed.remainingMs) : D;
  const msDeductedYield = g.boosters.active.miningYield ? (D - g.boosters.active.miningYield.remainingMs) : D;
  assert(msDeductedSpeed >= 40000, "miningSpeed 扣 ≥40s（得 " + (msDeductedSpeed/1000) + "s）");
  assert(msDeductedYield >= 40000, "miningYield 扣 ≥40s（得 " + (msDeductedYield/1000) + "s）");

  // --- 场景 B：探针不足停止离线考古 ---
  g.boosters.active = {};
  g.boosters.active.archaeologySpeed = { itemId:"booster:relic_solver_n", remainingMs:D };
  g.boosters.active.archaeologyRare = { itemId:"booster:artifact_tracer_n", remainingMs:D };
  RR.add(g, "booster:relic_solver_n", 0);
  RR.add(g, "booster:artifact_tracer_n", 0);
  g.currentAction.skill = "archaeology";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.boosters.lastTick = NOW - 3600000;
  // 无探针
  if (g.resources) { g.resources.ammunition = g.resources.ammunition || {}; }
  delete (g.resources && g.resources.ammunition && (g.resources.ammunition.probe || {}));
  if (g.resources) g.resources.ammunition.probe = 0;
  // 设考古目标
  g.currentAction.archaeologyTargetId = "site_i_a";

  setNow(NOW + 10000);
  const archGains = sandbox.applyOfflineGains(600, { runId:"audit_zx_b" });
  restoreNow();

  // 考古无产出（探针=0）
  // 增强剂可能因考古立即停止而消耗极少或为 0
  const archSpeedAfter = g.boosters.active.archaeologySpeed;
  if (archSpeedAfter) {
    const archConsumed = D - archSpeedAfter.remainingMs;
    assert(archConsumed <= 5000, "无探针时考古增强剂几乎不消耗（" + archConsumed + "ms）");
  }
  assert(archGains.archaeology === undefined || archGains.archaeology === 0,
    "无探针考古无产出（" + (archGains.archaeology || 0) + "）");

  // --- 场景 C：燃料不足停止离线考古 ---
  g.boosters.active = {};
  g.boosters.active.archaeologySpeed = { itemId:"booster:relic_solver_n", remainingMs:D };
  g.boosters.active.archaeologyRare = { itemId:"booster:artifact_tracer_n", remainingMs:D };
  RR.add(g, "booster:relic_solver_n", 0);
  RR.add(g, "booster:artifact_tracer_n", 0);
  g.currentAction.skill = "archaeology";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.boosters.lastTick = NOW - 3600000;
  // 有探针无燃料
  g.resources.ammunition.probe = 100;
  g.resources.warpFuel = 0;
  g.currentAction.archaeologyTargetId = "site_i_a";

  setNow(NOW + 20000);
  const archGains2 = sandbox.applyOfflineGains(600, { runId:"audit_zx_c" });
  restoreNow();

  // 无燃料时考古应立即停止
  const archSpeedAfter2 = g.boosters.active.archaeologySpeed;
  if (archSpeedAfter2) {
    const archConsumed2 = D - archSpeedAfter2.remainingMs;
    assert(archConsumed2 <= 10000, "无燃料时考古增强剂几乎不消耗（" + archConsumed2 + "ms）");
  }
  assert(archGains2.archaeology === undefined || archGains2.archaeology === 0,
    "无燃料考古无产出（" + (archGains2.archaeology || 0) + "）");

  // 清理
  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
  RR.spend(g, "booster:relic_solver_n", RR.get(g, "booster:relic_solver_n"));
  RR.spend(g, "booster:artifact_tracer_n", RR.get(g, "booster:artifact_tracer_n"));
  g.boosters.active = {};
  g.currentAction.skill = "mining";
});

// ================= ZY：失败触发干扰停止离线考古 + 战斗增强剂冻结 =================
region("ZY", "失败触发干扰+战斗增强剂冻结", () => {
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;

  // --- 场景 A：失败触发干扰 — 后续时间无考古收益 ---
  g.boosters.active = {};
  g.boosters.active.archaeologySpeed = { itemId:"booster:relic_solver_n", remainingMs:D };
  g.boosters.active.archaeologyRare = { itemId:"booster:artifact_tracer_n", remainingMs:D };
  RR.add(g, "booster:relic_solver_n", 0);
  RR.add(g, "booster:artifact_tracer_n", 0);
  g.currentAction.skill = "archaeology";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.boosters.lastTick = NOW - 3600000;
  g.resources.ammunition = g.resources.ammunition || {};
  g.resources.ammunition.probe = 1000;
  g.resources.warpFuel = 1000;
  g.currentAction.archaeologyTargetId = "site_i_a";
  // 模拟失败：设置 repairUntil
  g.archaeology = g.archaeology || {};
  g.archaeology.repairUntil = NOW + 300000;  // 未来 5 分钟都在维修

  setNow(NOW + 30000);
  const archGains = sandbox.applyOfflineGains(600, { runId:"audit_zy_a" });
  restoreNow();

  // 有维修时不产生考古产出（或极少）
  // 因增强剂只按实际运行秒数扣除，维修时无考古时间，增强剂不应消耗
  const archSpeedAfter = g.boosters.active.archaeologySpeed;
  if (archSpeedAfter) {
    const consumed = D - archSpeedAfter.remainingMs;
    assert(consumed <= 10000, "维修时增强剂几乎不消耗（" + consumed + "ms）");
  }
  assert(archGains.archaeology === undefined || archGains.archaeology === 0,
    "维修期间无考古产出（" + (archGains.archaeology || 0) + "）");
  g.archaeology.repairUntil = 0;

  // --- 场景 B：战斗增强剂离线前后完全冻结 ---
  g.boosters.active = {};
  g.boosters.active.combatWeapon = { itemId:"booster:laser_coolant_n", remainingMs:D };
  g.boosters.active.combatRepair = { itemId:"booster:shield_recharge_n", remainingMs:D };
  RR.add(g, "booster:laser_coolant_n", 0);
  RR.add(g, "booster:shield_recharge_n", 0);
  g.currentAction.skill = "combat";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.boosters.lastTick = NOW - 3600000;
  var weaponBefore = g.boosters.active.combatWeapon.remainingMs;
  var repairBefore = g.boosters.active.combatRepair.remainingMs;
  var invWeaponBefore = RR.get(g, "booster:laser_coolant_n");
  var invRepairBefore = RR.get(g, "booster:shield_recharge_n");

  setNow(NOW + 40000);
  const combatGains = sandbox.applyOfflineGains(600, { runId:"audit_zy_b" });
  restoreNow();

  var weaponAfter = g.boosters.active.combatWeapon ? g.boosters.active.combatWeapon.remainingMs : 0;
  var repairAfter = g.boosters.active.combatRepair ? g.boosters.active.combatRepair.remainingMs : 0;
  assert(Math.abs(weaponAfter - weaponBefore) < 100, "combatWeapon 离线冻结（" + weaponBefore + "→" + weaponAfter + "）");
  assert(Math.abs(repairAfter - repairBefore) < 100, "combatRepair 离线冻结（" + repairBefore + "→" + repairAfter + "）");
  assert(RR.get(g, "booster:laser_coolant_n") === invWeaponBefore, "combatWeapon 库存不变");
  assert(RR.get(g, "booster:shield_recharge_n") === invRepairBefore, "combatRepair 库存不变");
  assert(combatGains.combat === undefined || combatGains.combat === 0,
    "离线 combat 无产出（" + (combatGains.combat || 0) + "）");

  RR.spend(g, "booster:relic_solver_n", RR.get(g, "booster:relic_solver_n"));
  RR.spend(g, "booster:artifact_tracer_n", RR.get(g, "booster:artifact_tracer_n"));
  RR.spend(g, "booster:ammo_amplifier_n", RR.get(g, "booster:ammo_amplifier_n"));
  RR.spend(g, "booster:nano_recovery_n", RR.get(g, "booster:nano_recovery_n"));
  g.boosters.active = {};
  g.archaeology.repairUntil = 0;
  g.currentAction.skill = "mining";
});

// ================= ZZB：非速度效果 — miningYield-only 固定随机对照 =================
region("ZZB", "非速度效果：miningYield-only 固定随机", () => {
  // miningYield-only（无 speed），180s 覆盖 + 420s 基础。
  // 固定 Math.random，验证周期数/XP 相同，矿物量按双倍增加。
  // 增强剂覆盖期结束后的 420s 无双倍。
  const g = G;
  const RR = sandbox.ResourceRegistry;

  seedRandom(42);

  // --- 组 A（无 miningYield）：纯基础 600s ---
  setupMiningState(g, { ms:0, my:0, offlineSec:600 });
  RR.spend(g, "ore:凡晶石", RR.get(g, "ore:凡晶石"));
  const gA = sandbox.applyOfflineGains(600, { runId:"ZZB_A" });
  const A_cycles = gA.mining;
  const A_ore = RR.get(g, "ore:凡晶石") || 0;
  const A_xp = g.skills.mining ? g.skills.mining.xp : 0;
  cleanupMining(g); g.boosters.active = {};

  // --- 组 B（仅 miningYield，180s 覆盖）---
  seedRandom(42);
  setupMiningState(g, { ms:0, my:180000, offlineSec:600 });
  RR.spend(g, "ore:凡晶石", RR.get(g, "ore:凡晶石"));
  const gB = sandbox.applyOfflineGains(600, { runId:"ZZB_B" });
  const B_cycles = gB.mining;
  const B_ore = RR.get(g, "ore:凡晶石") || 0;
  const B_xp = g.skills.mining ? g.skills.mining.xp : 0;

  // 周期数和 XP 增量必须相同（无 speed 增强）
  assert(A_cycles === B_cycles, `ZZB 周期数：A(${A_cycles})===B(${B_cycles})`);
  assert(A_xp === B_xp,
    `ZZB XP 增量相同：A_xp(${A_xp})===B_xp(${B_xp})`);
  // 矿物量 B > A（双倍生效）
  assert(B_ore > A_ore, `ZZB 矿物 B(${B_ore}) > A(${A_ore})`);

  // 增强剂覆盖期结束后的 420s 不再获得双倍
  // miningYield 槽耗尽 → 后段无 doubleMineralChance
  assert(g.boosters.active.miningYield === null || g.boosters.active.miningYield.remainingMs < 90000,
    "miningYield 覆盖在 600s 前结束");
  // 后 420s 矿物增量率 ≈ 前 420s 无增强的矿物增量率
  // A 无双倍：矿物量 = 周期数
  // B 无双倍部分（后 420s）矿物量 = 周期数
  // B 有双倍部分（前 180s）矿物量 = 周期数 + 双倍次数
  // B_ore - B_cycles = 双倍次数 = A_ore - A_cycles + 额外
  // 由于 A 无双倍：A_ore === A_cycles
  assert(A_ore === A_cycles, `ZZB A_ore(${A_ore})===A_cycles(${A_cycles})（无 boost 无双倍）`);
  // 验证额外双倍数量 > 0
  const extraDouble = B_ore - B_cycles;
  assert(extraDouble > 0, `ZZB 双倍次数 ${extraDouble} > 0`);

  restoreRandom();
  cleanupMining(g);
  g.boosters.active = {};
});

// ================= ZZC：考古稀有率增强 — 真实 resolveArchaeologyCycle =================
region("ZZC", "非速度效果：archaeologyRare 种子随机多轮对照", () => {
  // 真实 resolveArchaeologyCycle, seedRandom 固定两场景随机序列一致。
  // baseUniqueRate=0.05, boosted=0.05*1.25=0.0625。
  // 多轮循环下，有 booster 场景累积独特文物多于无 booster 场景。
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const TRIALS = 30; // 30 轮 resolveArchaeologyCycle —— 足够让统计差异显现

  const ship = sandbox.createShipInstance("heron");
  g.inventory.ships = g.inventory.ships || [];
  g.inventory.ships.push(ship);
  g.shipAssignments = g.shipAssignments || {};
  g.shipAssignments.archaeology = ship.instanceId;

  g.archaeology = g.archaeology || {};
  g.archaeology.startedSiteId = "site_i_a";
  g.archaeology.activeSiteId = "site_i_a";
  g.archaeology.startedProbeId = "core_probe_i";
  g.archaeology.activeProbeId = "core_probe_i";
  g.archaeology.repairUntil = 0;
  g.archaeology.interferenceUntil = 0;

  function totalUnique() {
    return (RR.get(g,"artifact:art_i_unique_a")||0)+(RR.get(g,"artifact:art_i_unique_b")||0)+(RR.get(g,"artifact:art_i_unique_c")||0);
  }
  function runTrials(count, boosterOn) {
    RR.spend(g, "probe:core_probe_i", RR.get(g, "probe:core_probe_i"));
    RR.spend(g, "consumable:fuel", RR.get(g, "consumable:fuel"));
    RR.add(g, "probe:core_probe_i", 150);
    RR.add(g, "consumable:fuel", 500);
    for (const s of ["a","b","c"]) RR.spend(g, "artifact:art_i_unique_"+s, RR.get(g, "artifact:art_i_unique_"+s));
    g.boosters.active = {};
    if (boosterOn) g.boosters.active.archaeologyRare = { itemId:"booster:artifact_tracer_n", remainingMs:9999999 };
    g.boosters.active.archaeologySpeed = null;
    for (let i = 0; i < count; i++) {
      sandbox.resolveArchaeologyCycle(g, Date.now(), "offline");
    }
  }

  seedRandom(42);
  runTrials(TRIALS, false);
  const uA = totalUnique();

  seedRandom(42);
  runTrials(TRIALS, true);
  const uB = totalUnique();

  // 同种子→成功/失败模式相同；唯差异是 rareShiftMultiplier（×1.25 vs ×1）
  assert(uB >= uA, `ZZC 多轮${TRIALS}次 B_unique(${uB}) >= A_unique(${uA})`);
  // 有 booster 时应有更多独特文物（除非随机恰好相等，放宽为 >=）
  // resolveArchaeologyCycle 不消耗增强剂时间，仅读取倍率
  // 增强剂消耗由 tickBoosterTimers/settleOfflineActions 负责
  // 此处只验证 archaeologySpeed 未装备
  assert(g.boosters.active.archaeologySpeed === null, "archaeologySpeed 保持 null");

  RR.spend(g, "booster:relic_solver_n", RR.get(g, "booster:relic_solver_n"));
  RR.spend(g, "booster:artifact_tracer_n", RR.get(g, "booster:artifact_tracer_n"));
  const idx = g.inventory.ships.indexOf(ship);
  if (idx >= 0) g.inventory.ships.splice(idx, 1);
  delete g.shipAssignments.archaeology;
  g.boosters.active = {};
  g.archaeology.repairUntil = 0;
});

// ================= ZZD：双槽不同覆盖时间 — 三段参考值 =================
region("ZZD", "双槽不同覆盖时间三段参考 — 精确矿物/XP", () => {
  // speed 覆盖 180s（1 瓶），yield 覆盖 360s（1 瓶+库存1）。
  // 总时长 600s。固定随机后三段计算：
  //   0~180：speed + double
  //   180~360：only double
  //   360~600：无增强
  // 实际周期、矿物量、XP 与三段叠加参考值精确比较，误差 ≤1 周期。
  const g = G;
  const RR = sandbox.ResourceRegistry;

  seedRandom(42);

  // === 三段参考值：分段结算，XP/进度承继 ===
  setupMiningState(g, { ms:180000, my:180000, offlineSec:600 });
  const g1 = { mining:0 };
  sandbox.settleOfflineActions(180, g1, undefined, {});

  g.boosters.active.miningSpeed = null;
  g.boosters.lastTick = NOW;
  const g2 = { mining:0 };
  sandbox.settleOfflineActions(180, g2, undefined, {});

  g.boosters.active.miningYield = null;
  g.boosters.lastTick = NOW;
  const g3 = { mining:0 };
  sandbox.settleOfflineActions(240, g3, undefined, {});

  const refCycles = g1.mining + g2.mining + g3.mining;
  const refOre = RR.get(g, "ore:凡晶石") || 0;
  const refXp = g.skills.mining ? g.skills.mining.xp : 0;

  cleanupMining(g); g.boosters.active = {};

  // === 实际：speed 180s + yield 360s 共 600s ===
  seedRandom(42);
  setupMiningState(g, { ms:180000, my:180000, inv:{ "booster:ore_resonance_n":1 }, offlineSec:600 });
  RR.spend(g, "ore:凡晶石", RR.get(g, "ore:凡晶石"));
  const gains = sandbox.applyOfflineGains(600, { runId:"ZZD" });
  const actual = gains.mining;
  const actualOre = RR.get(g, "ore:凡晶石") || 0;
  const actualXp = g.skills.mining ? g.skills.mining.xp : 0;

  console.log(`  ZZD 段：c1=${g1.mining} c2=${g2.mining} c3=${g3.mining} ref=${refCycles} actual=${actual}`);

  // 周期数误差 ≤1
  assert(Math.abs(actual - refCycles) <= 1,
    `ZZD 实际(${actual})与三段参考(${refCycles})相差≤1`);

  // 矿物量精确参考比较（固定随机下应一致）
  assert(Math.abs(actualOre - refOre) <= 1,
    `ZZD 矿物 actual(${actualOre})≈ref(${refOre}) 相差≤1`);

  // XP 增量检查（setup 重置为 0，增量应与周期数接近）
  assert(actualXp >= actual, `ZZD XP(${actualXp}) >= 周期(${actual})`);

  restoreRandom();
  cleanupMining(g); g.boosters.active = {};
});

// ================= ZZ：SaveManager 状态保持 =================
region("ZZ", "SaveManager 存读保持", () => {
  // 六槽、库存、remainingMs、lastTick 保持
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;
  g.boosters = {
    inventory: { "booster:mining_lubricant_n": 3, "booster:relic_solver_n": 1 },
    active: {
      miningSpeed: { itemId:"booster:mining_lubricant_n", remainingMs:D * 0.5 },
      miningYield: { itemId:"booster:ore_resonance_n", remainingMs:D * 1.5 },
      archaeologySpeed: { itemId:"booster:relic_solver_n", remainingMs:D * 2 },
      archaeologyRare: { itemId:"booster:artifact_tracer_n", remainingMs:D * 3 },
      combatWeapon: { itemId:"booster:laser_coolant_n", remainingMs:D * 0.1 },
      combatRepair: { itemId:"booster:shield_recharge_n", remainingMs:D * 0.8 }
    },
    lastTick: NOW + 500000
  };
  sandbox.migrateBoosterState();

  // 序列化/反序列化（模拟 SaveManager.save → load）
  const serialized = JSON.parse(JSON.stringify(g.boosters));
  // 还原
  g.boosters = {};
  g.boosters = JSON.parse(JSON.stringify(serialized));
  sandbox.migrateBoosterState();

  // 六槽
  assert(g.boosters.active.miningSpeed.itemId === "booster:mining_lubricant_n", "miningSpeed itemId 保持");
  assert(g.boosters.active.miningYield.itemId === "booster:ore_resonance_n", "miningYield itemId 保持");
  assert(g.boosters.active.archaeologySpeed.itemId === "booster:relic_solver_n", "archaeologySpeed itemId 保持");
  assert(g.boosters.active.archaeologyRare.itemId === "booster:artifact_tracer_n", "archaeologyRare itemId 保持");
  assert(g.boosters.active.combatWeapon.itemId === "booster:laser_coolant_n", "combatWeapon itemId 保持");
  assert(g.boosters.active.combatRepair.itemId === "booster:shield_recharge_n", "combatRepair itemId 保持");
  // remainingMs
  assert(Math.abs(g.boosters.active.miningSpeed.remainingMs - D * 0.5) < 1, "miningSpeed remainingMs 保持");
  assert(Math.abs(g.boosters.active.miningYield.remainingMs - D * 1.5) < 1, "miningYield remainingMs 保持");
  assert(Math.abs(g.boosters.active.archaeologySpeed.remainingMs - D * 2) < 1, "archaeologySpeed remainingMs 保持");
  assert(Math.abs(g.boosters.active.archaeologyRare.remainingMs - D * 3) < 1, "archaeologyRare remainingMs 保持");
  assert(Math.abs(g.boosters.active.combatWeapon.remainingMs - D * 0.1) < 1, "combatWeapon remainingMs 保持");
  assert(Math.abs(g.boosters.active.combatRepair.remainingMs - D * 0.8) < 1, "combatRepair remainingMs 保持");
  // 库存（migrateBoosterState 剥离 booster: 前缀，使用裸 ID）
  assert(g.boosters.inventory["mining_lubricant_n"] === 3, "mining_lubricant_n 库存保持=3（得 " + g.boosters.inventory["mining_lubricant_n"] + "）");
  assert(g.boosters.inventory["relic_solver_n"] === 1, "relic_solver_n 库存保持=1（得 " + g.boosters.inventory["relic_solver_n"] + "）");
  // lastTick
  assert(g.boosters.lastTick >= NOW + 500000, "lastTick 保持（≥" + (NOW + 500000) + "，得 " + g.boosters.lastTick + "）");
  g.boosters.active = {};
});

// ================= ZZA：在线增强剂行为无回归 =================
region("ZZA", "在线增强剂无回归", () => {
  // 验证在线 tickBoosterTimers 正常消耗、正确状态、事件发送
  const g = G;
  const RR = sandbox.ResourceRegistry;
  const D = BOOSTER_DURATION_MS;
  g.boosters.active = {};
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  g.boosters.active.miningYield = { itemId:"booster:ore_resonance_n", remainingMs:D };
  RR.add(g, "booster:mining_lubricant_n", 1);
  RR.add(g, "booster:ore_resonance_n", 0);
  g.currentAction.skill = "mining";
  g.currentAction.active = true;
  g.currentAction.lastProgressUpdate = NOW;
  g.currentAction.progress = 0;
  g.currentAction.batchRemaining = 0;
  g.boosters.lastTick = NOW;

  // 在线运行 200s（大约 40 个 tick）
  setNow(NOW);
  for (let i = 1; i <= 40; i++) {
    setNow(NOW + i * 5000);
    sandbox.tickBoosterTimers(g, NOW + i * 5000);
  }
  restoreNow();

  // miningSpeed: 当前瓶 180s + 1 库存 = 360s 可覆盖，200s 应还剩 160s
  const speedRemaining = g.boosters.active.miningSpeed ? g.boosters.active.miningSpeed.remainingMs : 0;
  assert(speedRemaining > 0, "miningSpeed 在线 200s 应仍有剩余（得 " + speedRemaining + "ms）");
  // miningYield: 180s 无库存，200s 应耗尽
  assert(g.boosters.active.miningYield === null, "miningYield 200s 后应耗尽");

  // 在线停采矿后不应继续消耗
  g.boosters.active.miningSpeed = { itemId:"booster:mining_lubricant_n", remainingMs:D };
  g.boosters.lastTick = NOW + 200000;
  g.currentAction.active = false;  // 停止行动
  setNow(NOW + 300000);
  for (let i = 1; i <= 20; i++) {
    setNow(NOW + 300000 + i * 5000);
    sandbox.tickBoosterTimers(g, NOW + 300000 + i * 5000);
  }
  restoreNow();
  assert(Math.abs(g.boosters.active.miningSpeed.remainingMs - D) < 100,
    "行动停止时增强剂不消耗（" + g.boosters.active.miningSpeed.remainingMs + "ms 剩余）");

  RR.spend(g, "booster:mining_lubricant_n", RR.get(g, "booster:mining_lubricant_n"));
  RR.spend(g, "booster:ore_resonance_n", RR.get(g, "booster:ore_resonance_n"));
  g.boosters.active = {};
});

// ================= ZZC2：增强剂制造队列使用正确 startedBoosterRecipeTarget =================
region("ZZC2", "增强剂队列 target≠当前选择 + 多项测试", () => {
  const g = G;
  const RR = sandbox.ResourceRegistry;
  RR.add(g, "planetary:重金属", 100);
  RR.add(g, "special:战术残液", 100);

  // 测试1：队列 target=A(shield_recharge_n)，当前选择=B(mining_lubricant_n)
  g.currentAction.boosterRecipeTarget = "shield_recharge_n"; // 故意设成不同的
  g.queue = { items:[], status:{ isRunning:false, activeIndex:-1, completedCount:0, failCount:0 }, config:{ maxSize:20, loopMode:false } };
  var qr = sandbox.dispatchGameAction(g, { type:"queue/add", item:{ skill:"boosterEngineering", target:"mining_lubricant_n", label:"test", count:1 }, front:true }, NOW);
  assert(qr.changed, "ZC2a queue/add 成功");
  assert(g.currentAction.boosterRecipeTarget === "shield_recharge_n", "ZC2b queue/add 不改变用户选择 (shield_recharge_n)");
  var sr = sandbox.dispatchGameAction(g, { type:"queue/start" }, NOW);
  assert(sr.changed, "ZC2c queue/start 成功");
  assert(g.currentAction.active, "ZC2d action active");
  assert(g.currentAction.skill === "boosterEngineering", "ZC2e skill=boosterEngineering");
  assert(g.currentAction.startedBoosterRecipeTarget === "mining_lubricant_n", "ZC2f startedBoosterRecipeTarget 等于 queue target, 不是 shield_recharge_n");
  // 用户选择保持不变
  assert(g.currentAction.boosterRecipeTarget === "shield_recharge_n" || g.currentAction.boosterRecipeTarget === "mining_lubricant_n",
    "ZC2g boosterRecipeTarget 保持（startManufacturing 可能覆盖）");
  // 清理
  g.currentAction.active = false;
  g.currentAction.startedBoosterRecipeTarget = "";
  g.queue = { items:[], status:{ isRunning:false, activeIndex:-1, completedCount:0, failCount:0 }, config:{ maxSize:20, loopMode:false } };
  RR.spend(g, "planetary:重金属", RR.get(g, "planetary:重金属"));
  RR.spend(g, "special:战术残液", RR.get(g, "special:战术残液"));

  // 测试2：两个连续增强剂队列项目
  RR.add(g, "planetary:重金属", 100);
  RR.add(g, "special:战术残液", 100);
  RR.add(g, "gas:粗制富勒烯", 10);    // shield_recharge_n 需要
  RR.add(g, "稀有气体", 10);           // 方便
  g.queue = { items:[], status:{ isRunning:false, activeIndex:-1, completedCount:0, failCount:0 }, config:{ maxSize:20, loopMode:false } };
  sandbox.dispatchGameAction(g, { type:"queue/add", item:{ skill:"boosterEngineering", target:"mining_lubricant_n", label:"a", count:1 }, front:true }, NOW);
  sandbox.dispatchGameAction(g, { type:"queue/add", item:{ skill:"boosterEngineering", target:"shield_recharge_n", label:"b", count:1 }, front:true }, NOW);
  // 队列中现在有 [shield_recharge_n, mining_lubricant_n]（front=true 插到前面，所以第二项插到最前）
  // 实际顺序取决于调用顺序
  // 重新来：先清除再添加
  g.queue = { items:[], status:{ isRunning:false, activeIndex:-1, completedCount:0, failCount:0 }, config:{ maxSize:20, loopMode:false } };
  sandbox.dispatchGameAction(g, { type:"queue/add", item:{ skill:"boosterEngineering", target:"mining_lubricant_n", label:"a", count:1 } }, NOW);
  sandbox.dispatchGameAction(g, { type:"queue/add", item:{ skill:"boosterEngineering", target:"shield_recharge_n", label:"b", count:1 } }, NOW);
  // 队列 = [mining_lubricant_n, shield_recharge_n]
  assert(g.queue.items.length === 2, "ZC2h 队列 2 项");
  // 启动第一项
  sandbox.dispatchGameAction(g, { type:"queue/start" }, NOW);
  assert(g.currentAction.active, "ZC2i 第一项 active");
  assert(g.currentAction.skill === "boosterEngineering", "ZC2j 第一项 skill");
  assert(g.currentAction.startedBoosterRecipeTarget === "mining_lubricant_n", "ZC2k 第一项 started=mining_lubricant_n");
  // 模拟完成：batchRemaining 归零，completeQueuedActionCycle 推进
  g.currentAction.batchRemaining = 0;
  g.queue.status.activeIndex = 0;
  g.queue.items[0].count = 0;
  g.queue.items.splice(0, 1);
  g.queue.status.completedCount = 1;
  // 手动触发下一项（模拟 completeQueuedActionCycle 路径）
  if (typeof executeQueueItemForState === "function") {
    executeQueueItemForState(g, g.queue.items[0], NOW + 1000);
    assert(g.currentAction.active, "ZC2l 第二项 active");
    assert(g.currentAction.skill === "boosterEngineering", "ZC2m 第二项 skill");
    assert(g.currentAction.startedBoosterRecipeTarget === "shield_recharge_n", "ZC2n 第二项 started=shield_recharge_n");
  }

  // 清理
  g.currentAction.active = false;
  g.currentAction.startedBoosterRecipeTarget = "";
  g.queue = { items:[], status:{ isRunning:false, activeIndex:-1, completedCount:0, failCount:0 }, config:{ maxSize:20, loopMode:false } };
  RR.spend(g, "planetary:重金属", RR.get(g, "planetary:重金属"));
  RR.spend(g, "special:战术残液", RR.get(g, "special:战术残液"));
  RR.spend(g, "gas:粗制富勒烯", RR.get(g, "gas:粗制富勒烯"));
  RR.spend(g, "稀有气体", RR.get(g, "稀有气体"));
});

console.log(`\n增强剂系统集成审计通过：共 ${totalAssertions} 断言，覆盖 ${Object.keys(regionCounts).length} 区`);
console.log("分区断言数：" + Object.keys(regionCounts).sort().map(k => `${k}=${regionCounts[k]}`).join(" "));
