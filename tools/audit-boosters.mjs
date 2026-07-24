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
                   "selectedRecipeId", "runningRecipeId", "selectedRecipe", "canStart", "recipes", "inventoryCards", "phaseNote"]) {
    assert(f in ds, `显示态缺字段 ${f}`);
  }
  assert(ds.kind === "boosterEngineering" && ds.skill === "boosterEngineering", "kind/skill 应为 boosterEngineering");
  assert(ds.level === 20 && ds.xp === 0, "level/xp 正确");
  assert(ds.efficiency === 1 + 20 * 0.02, "效率应为 1+lvl*0.02");
  assert(ds.isRunning === false && ds.status === "待命", "未运行 status=待命");
  assert(ds.categories.length === 4, "分类应为 4");
  assert(ds.qualityFilters.length === 4, "品质筛选应为 4（全部/普通/精工/传奇）");
  assert(Array.isArray(ds.recipes) && ds.recipes.length > 0, "recipes 必须为非空数组");
  assert(ds.phaseNote && ds.phaseNote.includes("下一阶段"), "phaseNote 应声明 Phase 2B 开放说明");
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

// ================= Z：无 Phase 2B 行为（六槽装备/计时/效果函数不存在） =================
region("Z", "无 Phase 2B 行为", () => {
  // BoosterStateActions 为词法 const，须于 vm 上下文内求值（不可经 sandbox 对象访问）
  const BSA = vm.runInContext("typeof BoosterStateActions !== 'undefined' ? BoosterStateActions : null", sandbox);
  assert(BSA === null || (typeof BSA.equip === "undefined" && typeof BSA.unequip === "undefined"), "不得存在六槽 equip/unequip Action");
  for (const fn of ["applyBoosterEffect", "consumeBooster", "startBoosterTimer", "getActiveBoosterEffects"]) {
    assert(vm.runInContext(`typeof ${fn} === "undefined"`, sandbox), `不得存在 ${fn}`);
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

console.log(`\n专项审计通过：共 ${totalAssertions} 断言，覆盖 ${Object.keys(regionCounts).length} 区（A~ZH）`);
console.log("分区断言数：" + Object.keys(regionCounts).sort().map(k => `${k}=${regionCounts[k]}`).join(" "));
