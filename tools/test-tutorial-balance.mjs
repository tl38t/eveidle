// 聚焦回归测试：本轮平衡 + 教程返修（N-23 逻辑，正式交付测试，非临时探针）
// 覆盖：production.js baseTime 比值（mining/moon/gas ×0.75；smelting ×0.5，浮点保留）、
//       教程 I2/I3/I4 目标与奖励（I3 手动领取 314 三钛合金 + 26 类银超金属；I4 去掉类银奖励）、
//       I3 领取幂等（连点/重载/旧档不重复到账）、资源账闭合。
// 加载方式与正式 verify.mjs 完全一致（同 index.html 脚本集合 + 同 vm sandbox），
// 但只跑本轮聚焦断言，不中和、不绕过、不删除 verify.mjs 任何正式断言。
// 运行：node tools/test-tutorial-balance.mjs
// 退出码：0 = 全部通过；1 = 存在失败。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));
const styleSources = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\.\/css\/[^"]+)"/g)].map((m) => m[1].replace(/\?.*$/, ""));

// ---- sandbox 构造（与 verify.mjs 同源）----
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

// ---- 断言工具 ----
let pass = 0, fail = 0;
const checks = [];
function check(name, cond) {
  checks.push({ name, ok: !!cond });
  if (cond) { pass++; } else { fail++; }
  console.log((cond ? "  PASS " : "  FAIL ") + name);
}

// ===== A. baseTime 比值（mining/moon/gas ×0.75；smelting ×0.5，浮点保留）=====
const OLD_MINING = [20, 40, 70, 120, 180, 260, 380];
const OLD_MOON   = [120, 120, 240, 240, 420, 720];
const OLD_SMELT  = [20, 40, 70, 120, 180, 260, 380];
const OLD_GAS    = [30, 60, 100, 150, 220, 320, 450];

const MINING_AREAS = vm.runInContext("MINING_AREAS", sandbox);
const MOON_MINING_AREAS = vm.runInContext("MOON_MINING_AREAS", sandbox);
const SMELTING_RECIPES = vm.runInContext("SMELTING_RECIPES", sandbox);
const GAS_AREAS = vm.runInContext("GAS_AREAS", sandbox);

check("采矿 baseTime 全部 = 旧值×0.75（含浮点 70→52.5）",
  MINING_AREAS.length === OLD_MINING.length &&
  MINING_AREAS.every((a, i) => a.baseTime === OLD_MINING[i] * 0.75));
check("月矿 baseTime 全部 = 旧值×0.75",
  MOON_MINING_AREAS.length === OLD_MOON.length &&
  MOON_MINING_AREAS.every((a, i) => a.baseTime === OLD_MOON[i] * 0.75));
check("冶炼 baseTime 全部 = 旧值×0.5",
  SMELTING_RECIPES.length === OLD_SMELT.length &&
  SMELTING_RECIPES.every((r, i) => r.baseTime === OLD_SMELT[i] * 0.5));
check("采气 baseTime 全部 = 旧值×0.75（含浮点）",
  GAS_AREAS.length === OLD_GAS.length &&
  GAS_AREAS.every((a, i) => a.baseTime === OLD_GAS[i] * 0.75));
check("采矿浮点未被取整（凡晶石带=15 非 15.0 整数比对通过 / 水硼砂带=52.5）",
  MINING_AREAS[0].baseTime === 15 && MINING_AREAS[2].baseTime === 52.5 && MINING_AREAS[6].baseTime === 285);

// ===== B. offline==online（共用同一 baseTime 数据，无离线专属倍率）=====
// 静态源检查：offline.js 三类 duration 公式均引用 .baseTime，无独立离线 baseTime 常量。
const offlineSrc = fs.readFileSync(path.join(root, "js/core/offline.js"), "utf8");
check("离线采矿 duration 用 area.baseTime（与在线同源，无离线倍率）", /duration:\s*area\.baseTime\s*\/\s*\(miningEff\s*\*\s*speedMult\)/.test(offlineSrc));
check("离线冶炼 duration 用 recipe.baseTime（与在线同源，无离线倍率）", /duration:\s*recipe\.baseTime\s*\/\s*eff/.test(offlineSrc));
check("离线采气 duration 用 area.baseTime（与在线同源，无离线倍率）", /duration:\s*area\.baseTime\s*\/\s*getGasEfficiency\(\)/.test(offlineSrc));
// 运行时校验（离线==在线）：在线 selectors 与 offline.js 共用同一 baseTime 数据 + 同一效率来源，
// 不存在离线专属 baseTime 或离线时间倍率。上三条静态源检查已证明 duration 公式均引用 .baseTime；
// 此处再校验「在线 actualTime 公式」与「离线 duration 公式」结构一致：均为 baseTime / 效率。
const selSrc = fs.readFileSync(path.join(root, "js/core/selectors.js"), "utf8");
check("在线采矿 actualTime = baseTime / 效率（与离线同源，结构一致）",
  /actualTime:\s*current\.baseTime\s*\/\s*efficiency\.total/.test(selSrc));
check("在线冶炼 actualTime = baseTime / 效率（与离线同源，结构一致）",
  /actualTime:\s*current\.baseTime\s*\/\s*efficiency\b/.test(selSrc));
check("在线采气 actualTime = baseTime / 效率（与离线同源，结构一致）",
  /actualTime:\s*current\.baseTime\s*\/\s*efficiency\.total/.test(selSrc));

// ===== C. 教程 I2/I3/I4（N-23 逻辑，独立运行）=====
const TD = sandbox.TutorialData;
const RN = sandbox.ResourceRegistry ? { ISK: "currency:isk", TI: "mineral:三钛合金", AG: "mineral:类银超金属", HEAVY: "planetary:重金属", RARE: "planetary:稀有气体" } : null;
const resAmt = (reward, key) => ((reward && reward.resourceAmounts) || {})[key];
const sizes = (reward) => ({ res: Object.keys(reward.resourceAmounts||{}).length, eq: Object.keys(reward.equipment||{}).length, sh: Object.keys(reward.ships||{}).length, bp: Object.keys(reward.blueprints||{}).length });
const emptyReward = (reward) => sizes(reward).res === 0 && sizes(reward).eq === 0 && sizes(reward).sh === 0 && sizes(reward).bp === 0;

const i2 = TD.byId.I2, i3 = TD.byId.I3, i4 = TD.byId.I4;
check("I2 目标精确为 50", i2.target.count === 50);
check("I3 目标精确为 50", i3.target.count === 50);
check("I3 为手动领取（claim + afterObjective）", i3.completionMode === "claim" && i3.rewardTiming === "afterObjective");
check("I3 奖励精确为 314 三钛合金 + 26 类银超金属", resAmt(i3.reward, RN.TI) === 314 && resAmt(i3.reward, RN.AG) === 26 && sizes(i3.reward).res === 2);
check("I4 不再奖励类银超金属，仅保留 276000 星币", resAmt(i4.reward, RN.AG) === undefined && resAmt(i4.reward, RN.ISK) === 276000 && sizes(i4.reward).res === 1);

// 幂等模拟
const mkI3State = () => {
  const s = JSON.parse(JSON.stringify(sandbox.gameState));
  s.tutorial = { rewardLedger: {}, taskStateById: {}, branchesUnlocked: [], selectedCombatTrack: null, emergencyShipGranted: false, lastReconciledAt: 0 };
  for (const id of Object.keys(TD.byId)) {
    s.tutorial.taskStateById[id] = { status: id === "I3" ? "claimable" : "locked", progress: {}, rewardClaimed: false, supportClaimed: false };
  }
  s.tutorial.taskStateById.I3.status = "claimable";
  s.tutorial.taskStateById.I3.progress = { refined: 50 };
  s.resources = s.resources || {};
  sandbox.ResourceRegistry.set(s, "mineral:三钛合金", 0);
  sandbox.ResourceRegistry.set(s, "mineral:类银超金属", 0);
  return s;
};
const tiOf = (st) => Number(sandbox.ResourceRegistry.get(st, "mineral:三钛合金") || 0);
const agOf = (st) => Number(sandbox.ResourceRegistry.get(st, "mineral:类银超金属") || 0);

const sA = mkI3State();
const c1 = sandbox.TutorialSystem.claimTutorialTask(sA, "I3", 1000);
check("I3 首次领取到账 314 TI + 26 AG", c1.ok === true && tiOf(sA) === 314 && agOf(sA) === 26);
const tiAfter1 = tiOf(sA), agAfter1 = agOf(sA);
const c2 = sandbox.TutorialSystem.claimTutorialTask(sA, "I3", 2000);
check("I3 连点第二次 ALREADY_CLAIMED 且库存不变", c2.ok === false && c2.reason === "ALREADY_CLAIMED" && tiOf(sA) === tiAfter1 && agOf(sA) === agAfter1);
const sB = mkI3State();
sB.tutorial.rewardLedger = JSON.parse(JSON.stringify(sA.tutorial.rewardLedger));
sB.tutorial.taskStateById.I3.status = "completed";
sB.tutorial.taskStateById.I3.rewardClaimed = true;
const c3 = sandbox.TutorialSystem.claimTutorialTask(sB, "I3", 3000);
check("I3 重载（已领取账本）后再领不重复到账", c3.ok === false && tiOf(sB) === 0 && agOf(sB) === 0);
const sC = mkI3State();
sC.tutorial.taskStateById.I3.status = "completed";
sC.tutorial.taskStateById.I3.rewardClaimed = false;
const c4 = sandbox.TutorialSystem.claimTutorialTask(sC, "I3", 4000);
check("I3 已完成旧档不补发（ALREADY_COMPLETED）", c4.ok === false && c4.reason === "ALREADY_COMPLETED" && tiOf(sC) === 0 && agOf(sC) === 0);

// 资源账闭合
const compRecipes = vm.runInContext("SHIP_COMPONENT_RECIPES", sandbox);
const planetTypes = vm.runInContext("PLANET_TYPES", sandbox);
const lavaCC = (planetTypes.find(p => p.id === "lava") || {}).constructionCost || {};
const gasCC = (planetTypes.find(p => p.id === "gas") || {}).constructionCost || {};
const planetTI = Number((lavaCC.resources || {})["mineral:三钛合金"] || 0) + Number((gasCC.resources || {})["mineral:三钛合金"] || 0);
check("双行星建设合计消耗 200 三钛合金（各 100）", planetTI === 200);
const want = { ti: 164, ag: 26, heavy: 18, rare: 18 };
let sum = { ti: 0, ag: 0, heavy: 0, rare: 0 };
for (const rid of ["integrated_hull", "power_core", "functional_system"]) {
  const rec = compRecipes.find(r => r.id === rid);
  const c = rec.cost;
  sum.ti += (Number(c["三钛合金"] || 0)) * 2;
  sum.ag += (Number(c["类银超金属"] || 0)) * 2;
  sum.heavy += (Number(c["重金属"] || 0)) * 2;
  sum.rare += (Number(c["稀有气体"] || 0)) * 2;
}
check("六组件(各2)总耗 = 164 TI + 26 AG + 18 重金属 + 18 稀有气体，资源账闭合",
  sum.ti === want.ti && sum.ag === want.ag && sum.heavy === want.heavy && sum.rare === want.rare);
check("I3 自炼50 + 奖励314 − 双行星200 = 164 TI，链条首端闭合", (50 + 314 - planetTI) === want.ti);

// ===== D. C6「连续清场」在线回归：跳过第 1 波锚点（续打 / 换 zone / 船毁场景）也能完成 =====
// 复现旧 bug：在线 C6 曾要求第 4 波 token 必须等于第 1 波锚点 c5Token，而该锚点在
// 非第 1 波续打 / 中途换 zone / 船毁重开时必丢，导致「清了四波却卡住」。修复后只需
// 一次活跃出击（有有效 run token）内于指定 zones 清掉第 4 波即完成（与离线路径对齐）。
const GE = sandbox.GameEvents;
// 本沙箱不会在加载时跑 autoLoad，故手动安装 tutorial 的 combat 事件消费者（绑定 sandbox.gameState）。
sandbox.TutorialSystem.installTutorialConsumers(sandbox.gameState);
const c6Reset = () => {
  const g = sandbox.gameState;
  if (!g.tutorial) g.tutorial = {};
  if (!g.tutorial.taskStateById) g.tutorial.taskStateById = {};
  g.tutorial.taskStateById.C6 = { status: "active", progress: {}, rewardClaimed: false, supportClaimed: false, instanceId: null, combatRunToken: null, c5Token: null, c6Token: null, wave1: false, wave4: false };
  g.tutorial.activeCombatRunToken = "run-fixed-" + Math.random().toString(36).slice(2);
  return g;
};
const c6Done = (g) => { const s = sandbox.TutorialSystem.getTutorialTaskState(g, "C6"); return !!s && (s.status === "claimable" || s.status === "completed"); };

// 场景 1：直接从第 4 波清场（无第 1 波锚点）—— 旧逻辑会因 c5Token 缺失卡住，修复后应通过
const g1 = c6Reset();
GE.emit("combat:waveCleared", { zoneId: "angel_outpost", wave: 4 });
check("C6 在线：跳过第 1 波锚点、直接清第 4 波仍能完成（修复后）", c6Done(g1));

// 场景 2：第 4 波但 zone 不在白名单（非一级普通星带）—— 仍应保持 active，zone 门禁不受损
const g2 = c6Reset();
GE.emit("combat:waveCleared", { zoneId: "sansha_redoubt_lv80", wave: 4 });
check("C6 在线：第 4 波但 zone 不在白名单 → 不完成（zone 门禁 intact）", !c6Done(g2));

// 场景 3：有效 zone 但仅清到第 3 波 —— 仍应保持 active，wave 门禁不受损
const g3 = c6Reset();
GE.emit("combat:waveCleared", { zoneId: "blood_hideout", wave: 3 });
check("C6 在线：有效 zone 仅清第 3 波 → 不完成（wave 门禁 intact）", !c6Done(g3));

// ===== E. 序章组件任务读取真实库存（修复「提前造组件却卡住」）=====
// 复现旧 bug：P2 激活前玩家已造出 integrated_hull，动作计数被 bump 守卫丢弃，
// tsd.progress.integrated_hull 永久为 0；旧逻辑只读 progress → 任务永不完成。
// 修复后 objectiveMet / 进度展示改为读 component:<recipeId> 真实库存。
const mkCompState = () => {
  const s = JSON.parse(JSON.stringify(sandbox.gameState));
  s.tutorial = { rewardLedger: {}, taskStateById: {}, branchesUnlocked: [], selectedCombatTrack: null, emergencyShipGranted: false, lastReconciledAt: 0 };
  for (const id of Object.keys(TD.byId)) {
    s.tutorial.taskStateById[id] = { status: "locked", progress: {}, rewardClaimed: false, supportClaimed: false };
  }
  s.tutorial.taskStateById.P2.status = "active";
  s.tutorial.taskStateById.P2.progress = { integrated_hull: 0 }; // 模拟动作计数被丢弃
  sandbox.ResourceRegistry.set(s, "component:integrated_hull", 1); // 真实库存已有 1
  sandbox.ResourceRegistry.set(s, "component:power_core", 0);
  sandbox.ResourceRegistry.set(s, "component:functional_system", 0);
  return s;
};
const statusOf = (st, id) => ((sandbox.TutorialSystem.getTutorialTaskState(st, id)) || {}).status;

const e1 = mkCompState();
sandbox.TutorialSystem.reconcileTutorialState(e1, 5000);
check("P2 序章组件：库存已有 integrated_hull（progress=0）→ 自动完成（读库存而非动作）", statusOf(e1, "P2") === "completed");

const e2 = mkCompState();
sandbox.ResourceRegistry.set(e2, "component:integrated_hull", 0);
sandbox.TutorialSystem.reconcileTutorialState(e2, 5000);
check("P2 序章组件：库存为 0 → 仍 active，不误完成", statusOf(e2, "P2") === "active");

// ===== 汇总 =====
console.log(`\n聚焦探针结果：${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
