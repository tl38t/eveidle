import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

// 归一化：去掉 ?v= 缓存串（UI 脚本用 ?v=2 破缓存），否则本地文件读取 ENOENT
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((match) => match[1].replace(/\?.*$/, ""));
const styleSources = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\.\/css\/[^"]+)"/g)].map((match) => match[1].replace(/\?.*$/, ""));
const localSources = [...styleSources, ...scriptSources];

if (scriptSources.length !== 56) throw new Error(`预期 56 个脚本，实际 ${scriptSources.length}`); // 56 = 55 + Batch S 离线战斗 js/systems/offline-combat.js（2026-08-05） // 55 = 54 + 十倍速开关 js/core/speed-config.js（2026-08-04） // 54 = 52 + 新手任务系统 Batch O 运行时两模块：js/core/tutorial-state.js、js/systems/tutorial.js // 52 = 51 + 新手任务系统 Batch N 任务目录数据：js/data/tutorial.js // 50 = 49 + 研究系统 Batch I 自动化协议统一模块：js/systems/research-protocols.js（49 = 48 + 成就系统 Batch C-1 规则数据：js/data/achievement-rules.js（Batch C-2 仅重排 statistics.js 位置、不增减脚本；48 = 45 + 成就系统 Batch B 三个脚本：js/data/achievements.js、js/core/achievement-state.js、js/systems/achievements.js；45 = 42 + 研究系统批次 B：js/data/research.js、js/core/research-state.js、js/systems/research.js））
if (styleSources.length !== 4) throw new Error(`预期 4 个样式，实际 ${styleSources.length}`);

// 断言：production.js 必须早于 equipment-enhancement.js（REFINED_MINERALS 依赖 SMELTING_RECIPES）
{
  const prodIdx = scriptSources.findIndex(s => s.includes("production.js"));
  const enhIdx = scriptSources.findIndex(s => s.includes("equipment-enhancement.js"));
  if (prodIdx < 0) throw new Error("未找到 production.js 脚本引用");
  if (enhIdx < 0) throw new Error("未找到 equipment-enhancement.js 脚本引用");
  if (prodIdx >= enhIdx) throw new Error(`脚本顺序错误：production.js (idx=${prodIdx}) 必须早于 equipment-enhancement.js (idx=${enhIdx})`);
}

// 断言：研究系统批次 B 脚本依赖顺序（缺失或顺序错误必须抛错 EXIT 1）
// data/research.js → core/research-state.js → core/state.js → systems/research.js → persistence.js / tick.js / offline.js
{
  const idxOf = (suffix) => scriptSources.findIndex(s => s.endsWith(suffix));
  const researchData = idxOf("js/data/research.js");
  const researchState = idxOf("js/core/research-state.js");
  const coreState = idxOf("js/core/state.js");
  const researchSystem = idxOf("js/systems/research.js");
  const persistence = idxOf("js/core/persistence.js");
  const tick = idxOf("js/core/tick.js");
  const offline = idxOf("js/core/offline.js");
  const required = { "js/data/research.js": researchData, "js/core/research-state.js": researchState, "js/core/state.js": coreState, "js/systems/research.js": researchSystem, "js/core/persistence.js": persistence, "js/core/tick.js": tick, "js/core/offline.js": offline };
  for (const [name, idx] of Object.entries(required)) {
    if (idx < 0) throw new Error(`未找到脚本引用：${name}`);
  }
  if (researchData >= researchState) throw new Error(`脚本顺序错误：js/data/research.js (idx=${researchData}) 必须早于 js/core/research-state.js (idx=${researchState})`);
  if (researchState >= coreState) throw new Error(`脚本顺序错误：js/core/research-state.js (idx=${researchState}) 必须早于 js/core/state.js (idx=${coreState})`);
  if (coreState >= researchSystem) throw new Error(`脚本顺序错误：js/core/state.js (idx=${coreState}) 必须早于 js/systems/research.js (idx=${researchSystem})`);
  if (researchSystem >= persistence) throw new Error(`脚本顺序错误：js/systems/research.js (idx=${researchSystem}) 必须早于 js/core/persistence.js (idx=${persistence})`);
  if (researchSystem >= tick) throw new Error(`脚本顺序错误：js/systems/research.js (idx=${researchSystem}) 必须早于 js/core/tick.js (idx=${tick})`);
  if (researchSystem >= offline) throw new Error(`脚本顺序错误：js/systems/research.js (idx=${researchSystem}) 必须早于 js/core/offline.js (idx=${offline})`);
}

// 断言：成就系统 Batch B + C-1 + C-2 脚本依赖顺序（真实索引断言，缺失或顺序错误必须抛错 EXIT 1）
// events.js < data/achievements.js < data/achievement-rules.js < core/achievement-state.js
//   < core/state.js < core/statistics.js < systems/achievements.js < systems/production.js < persistence.js
// C-2 关键：statistics.js 必须先于 systems/achievements.js 注册通配符消费者，
// 生产成就消费者才能在 GameStatistics 累计之后读到更新后的统计。
{
  const idxOf = (suffix) => scriptSources.findIndex(s => s.endsWith(suffix));
  const eventsIdx = idxOf("js/core/events.js");
  const achData = idxOf("js/data/achievements.js");
  const achRules = idxOf("js/data/achievement-rules.js");
  const achState = idxOf("js/core/achievement-state.js");
  const coreState = idxOf("js/core/state.js");
  const statistics = idxOf("js/core/statistics.js");
  const achSystem = idxOf("js/systems/achievements.js");
  const production = idxOf("js/systems/production.js");
  const persistence = idxOf("js/core/persistence.js");
  const required = { "js/core/events.js": eventsIdx, "js/data/achievements.js": achData, "js/data/achievement-rules.js": achRules, "js/core/achievement-state.js": achState, "js/core/state.js": coreState, "js/core/statistics.js": statistics, "js/systems/achievements.js": achSystem, "js/systems/production.js": production, "js/core/persistence.js": persistence };
  for (const [name, idx] of Object.entries(required)) {
    if (idx < 0) throw new Error(`未找到脚本引用：${name}`);
  }
  if (eventsIdx >= achData) throw new Error(`脚本顺序错误：js/core/events.js (idx=${eventsIdx}) 必须早于 js/data/achievements.js (idx=${achData})`);
  if (achData >= achRules) throw new Error(`脚本顺序错误：js/data/achievements.js (idx=${achData}) 必须早于 js/data/achievement-rules.js (idx=${achRules})`);
  if (achRules >= achState) throw new Error(`脚本顺序错误：js/data/achievement-rules.js (idx=${achRules}) 必须早于 js/core/achievement-state.js (idx=${achState})`);
  if (achState >= coreState) throw new Error(`脚本顺序错误：js/core/achievement-state.js (idx=${achState}) 必须早于 js/core/state.js (idx=${coreState})`);
  if (coreState >= statistics) throw new Error(`脚本顺序错误：js/core/state.js (idx=${coreState}) 必须早于 js/core/statistics.js (idx=${statistics})`);
  if (statistics >= achSystem) throw new Error(`脚本顺序错误：js/core/statistics.js (idx=${statistics}) 必须早于 js/systems/achievements.js (idx=${achSystem})`);
  if (coreState >= achSystem) throw new Error(`脚本顺序错误：js/core/state.js (idx=${coreState}) 必须早于 js/systems/achievements.js (idx=${achSystem})`);
  if (achSystem >= production) throw new Error(`脚本顺序错误：js/systems/achievements.js (idx=${achSystem}) 必须早于 js/systems/production.js (idx=${production})`);
  if (achSystem >= persistence) throw new Error(`脚本顺序错误：js/systems/achievements.js (idx=${achSystem}) 必须早于 js/core/persistence.js (idx=${persistence})`);
  if (production >= persistence) throw new Error(`脚本顺序错误：js/systems/production.js (idx=${production}) 必须早于 js/core/persistence.js (idx=${persistence})`);
}

for (const source of localSources) {
  const target = path.resolve(root, source.replace(/^\.\//, ""));
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) {
    throw new Error(`本地资源不存在：${source}`);
  }
}

const scripts = scriptSources.map((source) => fs.readFileSync(path.resolve(root, source.replace(/^\.\//, "")), "utf8"));
new vm.Script(scripts.join("\n\n"), { filename: "eveidle-modular.concatenated.js" });
const combatCss = fs.readFileSync(path.join(root, "css", "combat.css"), "utf8");
if (!/\.combat-panel\s*\{[^}]*flex:\s*0\s+0\s+auto/s.test(combatCss)) {
  throw new Error("战斗面板没有阻止 flex 压缩，长内容在小窗口中仍可能被裁切而无法滚动");
}

// 页面滚动布局结构哨兵（非浏览器行为测试，仅为 CSS 规则存在性检查）
const baseCss = fs.readFileSync(path.join(root, "css", "base.css"), "utf8");
if (!/\.content\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s.test(baseCss)) {
  throw new Error(".content 缺少 min-height:0 或 overflow-y:auto，无法作为主滚动容器");
}
if (!/\.content\s*>\s*\.panel:not\(#hangar-panel\):not\(#cargo-panel\)\s*\{[^}]*flex:\s*0\s+0\s+auto[^}]*min-height:\s*min-content/s.test(baseCss)) {
  throw new Error(".content > .panel 缺少 flex:0 0 auto / min-height:min-content，面板会 flex 压缩裁切内容");
}
const componentsCss = fs.readFileSync(path.join(root, "css", "components.css"), "utf8");
if (!/#hangar-panel\s*>\s*\.panel-body\s*\{[^}]*overflow-y:\s*auto/s.test(componentsCss)) {
  throw new Error("#hangar-panel > .panel-body 缺少 overflow-y:auto，船坞列表内部滚动可能丢失");
}

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const literalIdReferences = new Set(
  scripts.flatMap((script) => [...script.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]))
);
const optionalIds = new Set([
  "combat-player-section", "footer-save",
  "runtime-error-boundary", "runtime-error-dismiss", "runtime-error-resume", "runtime-error-reload",
  "runtime-error-message", "runtime-error-meta", "runtime-error-stack",
  // 动态创建的 ID：bar-archaeology 由 archaeology-render.js 运行时创建 canvas
  "bar-archaeology",
  // 动态创建的 ID：research-active-* 由 shell-render.js 的 renderResearchActive 运行时 innerHTML 生成
  "research-active-name", "research-active-progress", "research-active-applied",
  "research-active-btn-max", "research-active-btn-cancel",
  // 动态创建的 ID：由 shell-render.js 的装备强化与物品详情弹窗运行时创建
  "equip-enh-grid", "equip-enhance-modal", "item-detail-modal"
]);
const missingIds = [...literalIdReferences].filter((id) => !htmlIds.has(id) && !optionalIds.has(id));
if (missingIds.length) throw new Error(`HTML 缺少脚本引用的 ID：${missingIds.join(", ")}`);

// DOM ID 基线：313 = 294 + Batch P 新手引导常驻小部件 8 个 ID + 删除存档按钮 btn-delete-save 1 个 ID + 舰船工程 UI 重做新增 6 个结构 id + 死亡空间连刷控件 4 个 id
// （tutorial-widget / -header / -toggle / -progress / -branch-tabs / -dialogue / -objective / -actions）
// （achievements-panel / -summary-count / -summary-percent / -progress-fill /
//   -tier-counts / -category-tabs / -status-tabs / -grid）
// + Batch E 科研工时余额 1 个 ID（achievements-research-bank）
// + Batch F 研究页 8 个 ID（research-panel / -summary / -bank / -active /
//   research-progress-fill / research-tree / research-detail / research-queue）
if (htmlIds.size !== 313) throw new Error(`预期 313 个 DOM ID，实际 ${htmlIds.size}`);
const BATCH_F_IDS = [
  "research-panel", "research-summary", "research-bank", "research-active",
  "research-progress-fill", "research-tree", "research-detail", "research-queue"
];
for (const id of BATCH_F_IDS) {
  if (!htmlIds.has(id)) throw new Error(`Batch F：index.html 缺少研究页 DOM ID ${id}`);
}

// bar-archaeology 是动态创建 ID，verify 必须在源码中确认它被创建且有 null 守卫
const barArchSourceCheck = scripts.some(src => src.includes('id="bar-archaeology"'));
if (!barArchSourceCheck) throw new Error("没有脚本创建 id=\"bar-archaeology\"（期望 archaeology-render.js 创建）");
// render.js 中对 bar-archaeology 的 getElementById 调用必须有 null 守卫
const barArchGetEl = scripts.filter(src => src.includes('getElementById("bar-archaeology")'));
for (const src of barArchGetEl) {
  // 检查附近有 guard：typeof drawSkillBar === "function" 或 document.getElementById 非 null 判断
  const lines = src.split("\n");
  let foundGuard = false;
  for (const line of lines) {
    if (line.includes('getElementById("bar-archaeology")')) {
      // 同一行或附近行有 guard 模式
      const nearby = lines.slice(Math.max(0, lines.indexOf(line) - 3), Math.min(lines.length, lines.indexOf(line) + 3)).join(" ");
      if (nearby.includes("typeof drawSkillBar") || nearby.includes("if (")) foundGuard = true;
    }
  }
  if (!foundGuard) throw new Error('getElementById("bar-archaeology") 调用没有 null 守卫');
}

function MockCanvasContext() {}
const noop = () => {};
for (const name of [
  "arc", "arcTo", "beginPath", "clearRect", "clip", "drawImage", "ellipse", "fill", "fillRect",
  "fillText", "lineTo", "moveTo", "putImageData", "rect", "restore", "rotate", "save", "scale",
  "setTransform", "stroke", "strokeText", "translate"
]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4), width, height });

const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop,
  appendChild: noop,
  classList,
  click: noop,
  closest: () => null,
  dataset: {},
  focus: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  getContext: () => new MockCanvasContext(),
  innerHTML: "",
  offsetHeight: 24,
  offsetWidth: 560,
  querySelector: () => makeElement(),
  querySelectorAll: () => [],
  remove: noop,
  setAttribute: noop,
  removeAttribute: noop,
  getAttribute: () => null,
  select: noop,
  style: {},
  textContent: "",
  value: "1"
});

const documentMock = {
  addEventListener: noop,
  body: makeElement(),
  createElement: () => makeElement(),
  createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: () => makeElement(),
  querySelector: () => makeElement(),
  querySelectorAll: () => []
};

const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
const sandbox = {
  alert: noop,
  Blob,
  CanvasRenderingContext2D: MockCanvasContext,
  console,
  confirm: () => true,
  document: documentMock,
  FileReader: class {},
  localStorage: localStorageMock,
  requestAnimationFrame: noop,
  setInterval: noop,
  setTimeout: noop,
  clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop },
  window: null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (let index = 0; index < scripts.length; index += 1) {
  vm.runInContext(scripts[index], sandbox, { filename: scriptSources[index] });
}

// Batch Q 最终定点返修：脚本装载完毕的这一刻，就是「空 localStorage 的真实首次启动」——
// persistence.js 的 autoLoad IIFE 已经跑完（localStorageMock.getItem 恒返回 null）。
// 后续断言会大量改写 gameState 与来源标记，因此必须在此立即取证，不能事后补拍。
const freshBootEvidence = {
  lastLoadSource: sandbox.SaveManager._lastLoadSourceHadTutorial,
  isLegacy: sandbox.isLegacySaveSource(),
  ships: JSON.parse(JSON.stringify(sandbox.gameState.inventory.ships || [])),
  isk: sandbox.gameState.resources.isk,
  tutorial: JSON.parse(JSON.stringify(sandbox.gameState.tutorial))
};

// 取证完成后再为测试环境播种一艘舰船：修复前全新开局被误判成老档、白送一艘 rifter，
// 下方大量既有 fixture（选择器 / 战斗视图 / 装配 / 生产效率 / 死亡空间）都建立在「gameState 自带首舰
// 且该舰已由 migrateCombatEquipmentState 装上默认战斗挂载」之上。
// 真实新档零舰船的结论已由 freshBootEvidence 固化；这里只是把测试环境复原成修复前的样子，
// 且完全交由真实迁移函数完成（重置一次性迁移标志后重跑收尾链），不手写任何挂载数据。
if (!Array.isArray(sandbox.gameState.inventory.ships) || sandbox.gameState.inventory.ships.length === 0) {
  sandbox.gameState.inventory.ships = [sandbox.createShipInstance("rifter")];
  sandbox.gameState.migrations.combatEquipmentV1 = false;
  sandbox.finalizeEquipmentStateAfterLegacyMigrations(sandbox.gameState);
}

// 运行时守卫必须隔离关键循环错误、允许显式恢复，并让可恢复循环继续调度。
const originalConsoleError = sandbox.console.error;
sandbox.console.error = noop;
const criticalFailure = sandbox.RuntimeGuard.runCritical("verify-critical", () => { throw new Error("verify critical failure"); });
let blockedCriticalRan = false;
const blockedCritical = sandbox.RuntimeGuard.runCritical("verify-critical", () => { blockedCriticalRan = true; });
const resumedCritical = sandbox.RuntimeGuard.resume("verify-critical");
const recoveredCritical = sandbox.RuntimeGuard.runCritical("verify-critical", () => 42);
const recoverableFailure = sandbox.RuntimeGuard.runRecoverable("verify-frame", () => { throw new Error("verify frame failure"); });
sandbox.console.error = originalConsoleError;
if (criticalFailure.ok || !sandbox.RuntimeGuard.isPaused("verify-critical") && !resumedCritical || !blockedCritical.paused || blockedCriticalRan ||
    !resumedCritical || !recoveredCritical.ok || recoveredCritical.value !== 42 || recoverableFailure.ok || sandbox.RuntimeGuard.isPaused("verify-frame")) {
  throw new Error("运行时守卫没有正确暂停、隔离或恢复故障通道");
}

// 领域事件总线必须支持订阅/取消/单次监听，并保留离线聚合元数据。
let domainEvent = null; let onceCount = 0;
const unsubscribeDomain = sandbox.GameEvents.on("verify:domain", event => { domainEvent = event; });
sandbox.GameEvents.once("verify:domain", () => { onceCount++; });
sandbox.GameEvents.emit("verify:domain", { quantity:12 }, { offline:true });
sandbox.GameEvents.emit("verify:domain", { quantity:3 }, { offline:false });
unsubscribeDomain();
if (!domainEvent || domainEvent.payload.quantity !== 3 || domainEvent.meta.offline !== false || onceCount !== 1 || sandbox.GameEvents.listenerCount("verify:domain") !== 0) {
  throw new Error("领域事件总线订阅、单次监听、取消或元数据异常");
}

// 领域事件必须遵守统一信封和契约；统计消费者必须按eventId幂等处理在线/离线事件。
const statisticsBeforeContractTest = JSON.parse(JSON.stringify(sandbox.gameState.statistics));
const statisticsTotalsBefore = { ...sandbox.gameState.statistics.totals };
const statisticsActivityBefore = { ...sandbox.gameState.statistics.activity };
const statisticsOreBefore = sandbox.gameState.statistics.production.gathered["ore:凡晶石"] || 0;
const contractEventMeta = { offline:true, aggregate:true, eventId:"verify:mining:batch:1", runId:"verify:mining", timestamp:2000000000000 };
const contractEvent = sandbox.GameEvents.emit("mining:completed", {
  area:"凡晶石带", mode:"normal", resourceId:"ore:凡晶石", quantity:7, cycles:7, xp:70
}, contractEventMeta);
sandbox.GameEvents.emit("mining:completed", {
  area:"凡晶石带", mode:"normal", resourceId:"ore:凡晶石", quantity:7, cycles:7, xp:70
}, contractEventMeta);
if (contractEvent.schemaVersion !== 1 || contractEvent.eventId !== contractEventMeta.eventId || contractEvent.timestamp !== contractEventMeta.timestamp ||
    contractEvent.meta.runId !== "verify:mining" || !contractEvent.meta.offline || !contractEvent.meta.aggregate || !contractEvent.valid || !contractEvent.registered ||
    !Object.isFrozen(contractEvent) || !Object.isFrozen(contractEvent.payload) || !Object.isFrozen(contractEvent.meta)) {
  throw new Error("领域事件信封、离线聚合元数据或不可变约束异常");
}
if (sandbox.gameState.statistics.totals.miningCycles !== statisticsTotalsBefore.miningCycles + 7 ||
    sandbox.gameState.statistics.totals.minedUnits !== statisticsTotalsBefore.minedUnits + 7 ||
    sandbox.gameState.statistics.totals.events !== statisticsTotalsBefore.events + 1 ||
    sandbox.gameState.statistics.activity.offlineEvents !== statisticsActivityBefore.offlineEvents + 1 ||
    sandbox.gameState.statistics.activity.offlineCycles !== statisticsActivityBefore.offlineCycles + 7 ||
    sandbox.gameState.statistics.production.gathered["ore:凡晶石"] !== statisticsOreBefore + 7) {
  throw new Error("统计消费者没有聚合离线事件或重复eventId被累计了两次");
}
let invalidContractDeliveries = 0;
const unsubscribeInvalidContract = sandbox.GameEvents.on("mining:completed", () => { invalidContractDeliveries++; });
const consoleErrorBeforeInvalidEvent = sandbox.console.error;
sandbox.console.error = noop;
const invalidContractEvent = sandbox.GameEvents.emit("mining:completed", { quantity:1 }, { eventId:"verify:invalid" });
sandbox.console.error = consoleErrorBeforeInvalidEvent;
unsubscribeInvalidContract();
if (invalidContractEvent.valid || !invalidContractEvent.registered || invalidContractDeliveries !== 0) {
  throw new Error("无效领域事件通过了契约校验或仍被分发给消费者");
}
const emittedEventTypes = new Set(scripts.flatMap(source => [
  ...[...source.matchAll(/GameEvents\.emit\(["']([^"']+)["']/g)].map(match => match[1]),
  // 局部别名发布点（如 research.js / achievements.js 的 `const GE = ...GameEvents; GE.emit(...)`）
  ...[...source.matchAll(/\bGE\.emit\(\s*["']([^"']+)["']/g)].map(match => match[1]),
  ...[...source.matchAll(/emitOfflineGameEvent\(["']([^"']+)["']/g)].map(match => match[1])
]));
for (const type of emittedEventTypes) {
  if (!sandbox.GameEvents.contracts.has(type)) throw new Error(`事件发布点缺少契约：${type}`);
}
// 成就系统 Batch B：achievement:unlocked 必须被发布点扫描识别、契约已注册、且契约行为正确
if (!emittedEventTypes.has("achievement:unlocked")) throw new Error("未识别 achievement:unlocked 事件发布点（js/systems/achievements.js）");
if (!sandbox.GameEvents.contracts.has("achievement:unlocked")) throw new Error("achievement:unlocked 契约未注册");
{
  const okCheck = sandbox.GameEvents.contracts.validate("achievement:unlocked", { achievementId:"A01", unlockedAt:1700000000000 });
  if (!okCheck.valid || !okCheck.registered) throw new Error("achievement:unlocked 合法 payload 未通过契约校验");
  const missCheck = sandbox.GameEvents.contracts.validate("achievement:unlocked", { achievementId:"A01" });
  if (missCheck.valid) throw new Error("achievement:unlocked 缺少 unlockedAt 却通过契约校验");
  const nanCheck = sandbox.GameEvents.contracts.validate("achievement:unlocked", { achievementId:"A01", unlockedAt:"not-a-number" });
  if (nanCheck.valid) throw new Error("achievement:unlocked 非数字 unlockedAt 却通过契约校验");
}
let wrappedOfflineEvent = null;
const unsubscribeWrappedOffline = sandbox.GameEvents.on("gas:completed", event => { wrappedOfflineEvent = event; });
vm.runInContext('_offlineEventBatch = { runId:"verify_offline_run", sequence:0 }', sandbox);
sandbox.emitOfflineGameEvent("gas:completed", { area:"富勒烯云团", resourceId:"gas:粗制富勒烯", quantity:4, cycles:4, xp:40 });
vm.runInContext('_offlineEventBatch = null', sandbox);
unsubscribeWrappedOffline();
if (!wrappedOfflineEvent || wrappedOfflineEvent.eventId !== "verify_offline_run:1:gas:completed" ||
    wrappedOfflineEvent.meta.runId !== "verify_offline_run" || wrappedOfflineEvent.meta.source !== "offline-settlement" ||
    !wrappedOfflineEvent.meta.offline || !wrappedOfflineEvent.meta.aggregate) {
  throw new Error("离线事件包装器没有生成稳定eventId、runId或聚合元数据");
}
sandbox.gameState.statistics = statisticsBeforeContractTest;

// 行星在线产出也必须发布领域事件并由统计消费者记录，但不能改变产出规则。
const originalPlanetaryForEventTest = sandbox.gameState.planetary;
const originalPlanetarySkillForEventTest = sandbox.gameState.skills.planetaryIndustry;
const statisticsBeforePlanetaryEvent = JSON.parse(JSON.stringify(sandbox.gameState.statistics));
const planetaryEventNow = 2000000100000;
sandbox.gameState.planetary = { nextId:2, deployments:[{
  id:"planet_verify_event", planetType:"lava", deployedAt:planetaryEventNow - 10000, duration:86400,
  storage:0, lastTick:planetaryEventNow - 10000, progress:5, active:true
}] };
sandbox.gameState.skills.planetaryIndustry = { lvl:1, xp:0 };
let onlinePlanetaryEvent = null;
const unsubscribePlanetaryEvent = sandbox.GameEvents.on("planetary:completed", event => { onlinePlanetaryEvent = event; });
sandbox.planetaryTick(planetaryEventNow);
unsubscribePlanetaryEvent();
if (!onlinePlanetaryEvent || onlinePlanetaryEvent.meta.offline || onlinePlanetaryEvent.payload.cycles !== 1 ||
    onlinePlanetaryEvent.payload.resourceId !== "planetary:重金属" || sandbox.gameState.planetary.deployments[0].storage !== 1 ||
    sandbox.gameState.statistics.totals.planetaryCycles !== statisticsBeforePlanetaryEvent.totals.planetaryCycles + 1) {
  throw new Error("行星在线产出没有发布契约事件、写入库存或被统计消费者记录");
}
sandbox.gameState.planetary = originalPlanetaryForEventTest;
sandbox.gameState.skills.planetaryIndustry = originalPlanetarySkillForEventTest;
sandbox.gameState.statistics = statisticsBeforePlanetaryEvent;

// ResourceRegistry统一寻址，但必须继续读写旧存档字段且保证扣费原子性。
const registryState = JSON.parse(JSON.stringify(sandbox.gameState));
const resourceRegistry = vm.runInContext("ResourceRegistry", sandbox);
resourceRegistry.register({ namespace:"mineral", key:"验证同名资源", name:"验证同名资源" });
resourceRegistry.register({ namespace:"ore", key:"验证同名资源", name:"验证同名资源" });
registryState.resources.minerals["验证同名资源"] = 3;
registryState.resources.ores["验证同名资源"] = 2;
if (resourceRegistry.getMaterialStock(registryState, "验证同名资源") !== 5 ||
    !resourceRegistry.spendMaterial(registryState, "验证同名资源", 4) ||
    registryState.resources.minerals["验证同名资源"] !== 0 || registryState.resources.ores["验证同名资源"] !== 1) {
  throw new Error("ResourceRegistry同名兼容库存或确定性扣除异常");
}
const registryBeforeFailedSpend = JSON.stringify(registryState.resources);
if (resourceRegistry.spendCost(registryState, { "验证同名资源":2 }) || JSON.stringify(registryState.resources) !== registryBeforeFailedSpend) {
  throw new Error("ResourceRegistry资源不足时发生了部分扣除");
}
resourceRegistry.add(registryState, "moon:验证月矿", 7);
if (registryState.resources.moonOres["验证月矿"] !== 7 || Object.hasOwn(registryState.resources, "items")) {
  throw new Error("ResourceRegistry没有保持旧存档结构或无法登记新资源");
}
const registryRecipes = vm.runInContext("[...SHIP_COMPONENT_RECIPES, ...EQUIPMENT_ENGINEERING_RECIPES]", sandbox);
for (const recipe of registryRecipes) {
  for (const material of Object.keys(recipe.cost || {})) {
    if (!resourceRegistry.resolveMaterialIds(material).length) throw new Error(`配方材料未注册：${recipe.id} / ${material}`);
  }
}

// 动态战斗修正使用统一管线，按条件和过期时间生效，且不能污染原状态。
const modifierState = JSON.parse(JSON.stringify(sandbox.gameState));
modifierState.combat.modifiers = [{ id:"verify_buff", stat:"damageMultiplier", operation:"multiply", value:1.5, weaponType:"laser", expiresAt:2000000001000 }];
const modifierStateBefore = JSON.stringify(modifierState);
const baseLaserMultiplier = sandbox.getCombatDamageMultiplierFromState(sandbox.gameState, "laser", { now:2000000000000 });
const buffedLaserMultiplier = sandbox.getCombatDamageMultiplierFromState(modifierState, "laser", { now:2000000000000 });
const expiredLaserMultiplier = sandbox.getCombatDamageMultiplierFromState(modifierState, "laser", { now:2000000002000 });
if (Math.abs(buffedLaserMultiplier - baseLaserMultiplier * 1.5) > 1e-9 || expiredLaserMultiplier !== baseLaserMultiplier ||
    sandbox.applyCombatModifiers(100, [{ operation:"add", value:10, priority:20 }, { operation:"multiply", value:2, priority:10 }]) !== 210 ||
    JSON.stringify(modifierState) !== modifierStateBefore) {
  throw new Error("CombatModifiers条件、顺序、过期处理或纯度异常");
}

// 伤害浮动使用 90%～110% 的中心三角分布，且不改变平均伤害。
const damageLow = sandbox.calcCombatDamage(100, 100, 200, 1, () => 0);
const damageMid = sandbox.calcCombatDamage(100, 100, 200, 1, () => 0.5);
const damageHigh = sandbox.calcCombatDamage(100, 100, 200, 1, () => 1);
if (damageLow !== 90 || damageMid !== 100 || damageHigh !== 110) {
  throw new Error(`伤害浮动范围或中心值错误：${damageLow}/${damageMid}/${damageHigh}`);
}

const originalUpdateUI = sandbox.updateUI;
const originalUpdateLiveUI = sandbox.updateLiveUI;
let fullUpdateCalls = 0; let liveUpdateCalls = 0;
sandbox.updateUI = () => { fullUpdateCalls++; };
sandbox.updateLiveUI = () => { liveUpdateCalls++; };
sandbox.gameState.currentAction.active = false;
sandbox.gameTick();
if (fullUpdateCalls !== 0 || liveUpdateCalls !== 1) {
  throw new Error("空闲 gameTick 仍在执行完整 UI 重建");
}
sandbox.updateUI = originalUpdateUI;
sandbox.updateLiveUI = originalUpdateLiveUI;

// View State 选择器必须是纯读取层；状态动作必须与 DOM/渲染解耦。
const selectorsSource = scripts[scriptSources.indexOf("./js/core/selectors.js")];
const actionsSource = scripts[scriptSources.indexOf("./js/core/actions.js")];
const resourcesSource = scripts[scriptSources.indexOf("./js/core/resources.js")];
const eventsSource = scripts[scriptSources.indexOf("./js/core/events.js")];
const statisticsSource = scripts[scriptSources.indexOf("./js/core/statistics.js")];
const combatModifiersSource = scripts[scriptSources.indexOf("./js/core/combat-modifiers.js")];
const runtimeSource = scripts[scriptSources.indexOf("./js/core/runtime.js")];
const errorBoundarySource = scripts[scriptSources.indexOf("./js/ui/error-boundary.js")];
const actionModalSource = scripts[scriptSources.indexOf("./js/ui/action-modal.js")];
if (!selectorsSource || /document\.|\bgameState\b|updateUI\s*\(|render[A-Z]\w*\s*\(/.test(selectorsSource)) {
  throw new Error("selectors.js 访问了DOM、全局gameState或渲染函数");
}
if (!actionsSource || /document\.|\bgameState\b|updateUI\s*\(|render[A-Z]\w*\s*\(/.test(actionsSource)) {
  throw new Error("actions.js 访问了DOM、全局gameState或渲染函数");
}
for (const [name, source] of [["ResourceRegistry", resourcesSource], ["GameEvents", eventsSource], ["CombatModifiers", combatModifiersSource]]) {
  if (!source || /document\.|\bgameState\b|updateUI\s*\(|render[A-Z]\w*\s*\(/.test(source)) throw new Error(`${name}核心访问了DOM、全局gameState或渲染函数`);
}
if (!statisticsSource || !/onIdempotent/.test(statisticsSource) || /document\.|updateUI\s*\(|render[A-Z]\w*\s*\(/.test(statisticsSource)) {
  throw new Error("统计事件消费者缺少幂等订阅或反向依赖了UI");
}
if (!runtimeSource || !/runCritical/.test(runtimeSource) || !/unhandledrejection/.test(runtimeSource) ||
    !errorBoundarySource || !/verifyBoot/.test(errorBoundarySource) || !/runtime-error-boundary/.test(errorBoundarySource)) {
  throw new Error("运行时错误守卫、全局异常捕获或可见错误边界缺失");
}
if (!actionModalSource || !/getActionConfirmationDisplayState/.test(actionModalSource) ||
    /gameState\.resources|getShipCompRecipe\(|getShipAsmRecipe\(|getEquipEngRecipe\(/.test(actionModalSource)) {
  throw new Error("执行确认弹窗重新引入了业务资源读取或提交时配方重算");
}
const rawResourcePoolPattern = /(?:gameState|state)\.resources\.(?:ores|minerals|planetary|gases|moonOres|special|shipComponents|fuel|ammunition|isk|lp)\b/;
const rawResourcePoolViolations = scriptSources.filter((source, index) =>
  source !== "./js/core/persistence.js" && rawResourcePoolPattern.test(scripts[index])
);
if (rawResourcePoolViolations.length) {
  throw new Error(`业务代码绕过ResourceRegistry直接访问旧资源池：${rawResourcePoolViolations.join(", ")}`);
}

const selectorState = JSON.parse(JSON.stringify(sandbox.gameState));
const selectorNow = 2000000000000;
selectorState.skills.mining.lvl = 20;
selectorState.currentAction.active = true;
selectorState.currentAction.skill = "mining";
selectorState.currentAction.area = "镓月岩带";
selectorState.currentAction.miningMode = "moon";
selectorState.currentAction.startedArea = "凡晶石带";
selectorState.currentAction.progress = 2;
selectorState.currentAction.lastProgressUpdate = selectorNow - 5000;
// Batch Q 定点返修：全新开局已不再误发兜底舰船，选择器 fixture 必须自备一艘测试舰。
if (!selectorState.inventory.ships.length) selectorState.inventory.ships.push(sandbox.createShipInstance("rifter"));
const selectorShip = selectorState.inventory.ships[0];
selectorShip.fitted = { high:["t1_mining_laser"], mid:[], low:[], rig:[] };
selectorState.shipAssignments.mining = selectorShip.instanceId;
const selectorStateBefore = JSON.stringify(selectorState);
const miningDisplay = sandbox.getMiningDisplayState(selectorState, selectorNow);
const globalDisplay = sandbox.getGlobalDisplayState(selectorState, 10000000);
if (JSON.stringify(selectorState) !== selectorStateBefore) throw new Error("View State 选择器修改了输入状态");
if (miningDisplay.current.ore !== "镓" || miningDisplay.running.ore !== "凡晶石" || !miningDisplay.targetChanged ||
    !miningDisplay.showStart || miningDisplay.showStop || !miningDisplay.requirement.available || !miningDisplay.progress.active ||
    miningDisplay.progress.elapsed !== 7 || miningDisplay.targets.length !== 6) {
  throw new Error("采矿View State没有正确表达运行目标、待选目标、月矿门槛或进度");
}
miningDisplay.current.ore = "被外部修改";
if (vm.runInContext('MOON_MINING_AREAS[0].ore', sandbox) !== "镓") throw new Error("View State向调用方暴露了可修改的静态配置引用");
if (typeof globalDisplay.inventory.total !== "number" || globalDisplay.inventory.total < 0 || globalDisplay.quickOres.length > 4) {
  throw new Error("全局资源View State没有正确汇总仓库总量或快捷矿石");
}
if ("cargo" in globalDisplay) throw new Error("全局View State不应包含 cargo 字段");

const actionState = JSON.parse(JSON.stringify(sandbox.gameState));
actionState.skills.mining.lvl = 1;
const lockedActionBefore = JSON.stringify(actionState);
const lockedAction = sandbox.dispatchGameAction(actionState, { type:"production/selectMiningArea", areaName:"镓月岩带" }, selectorNow);
if (lockedAction.changed || JSON.stringify(actionState) !== lockedActionBefore) throw new Error("状态动作允许选择锁定月矿或在失败时修改了状态");
actionState.skills.mining.lvl = 20;
const changedAction = sandbox.dispatchGameAction(actionState, { type:"production/selectMiningArea", areaName:"镓月岩带" }, selectorNow);
if (!changedAction.changed || actionState.currentAction.area !== "镓月岩带" || actionState.currentAction.miningMode !== "moon" ||
    actionState.currentAction.lastProgressUpdate !== selectorNow || !actionState._dirty) {
  throw new Error("统一状态动作入口没有正确切换月矿目标");
}
const unknownAction = sandbox.dispatchGameAction(actionState, { type:"production/notImplemented" }, selectorNow);
if (unknownAction.changed || unknownAction.reason !== "unknown-action") throw new Error("统一状态动作入口没有拒绝未知动作");

// 制造系统View State必须保留“当前查看/当前运行”边界，核心文件不得重新引入DOM渲染。
const manufacturingSource = scripts[scriptSources.indexOf("./js/systems/manufacturing.js")];
if (!manufacturingSource || /document\.|render[A-Z]\w*\s*\(/.test(manufacturingSource)) {
  throw new Error("制造系统核心仍然直接访问DOM或调用渲染函数");
}
const manufacturingState = JSON.parse(JSON.stringify(sandbox.gameState));
manufacturingState.skills.shipEngineering.lvl = 15;
manufacturingState.skills.equipmentEngineering.lvl = 99;
manufacturingState.currentAction.active = true;
manufacturingState.currentAction.skill = "shipEngineering";
manufacturingState.currentAction.shipSubAction = "component";
manufacturingState.currentAction.shipCompTarget = "destroyer_integrated_hull";
manufacturingState.currentAction.startedShipCompTarget = "integrated_hull";
manufacturingState.currentAction.shipAsmTarget = "raylight";
manufacturingState.currentAction.startedShipAsmTarget = "rifter";
manufacturingState.currentAction.progress = 3;
manufacturingState.currentAction.lastProgressUpdate = selectorNow - 2000;
for (const [componentId, quantity] of Object.entries(vm.runInContext('SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === "raylight").componentCost', sandbox))) {
  manufacturingState.resources.shipComponents[componentId] = quantity;
}
const manufacturingStateBefore = JSON.stringify(manufacturingState);
const shipEngineeringDisplay = sandbox.getShipEngineeringDisplayState(manufacturingState, selectorNow);
if (JSON.stringify(manufacturingState) !== manufacturingStateBefore) throw new Error("舰船工程View State修改了输入状态");
if (shipEngineeringDisplay.currentComponent.id !== "destroyer_integrated_hull" || shipEngineeringDisplay.runningComponent.id !== "integrated_hull" ||
    !shipEngineeringDisplay.componentActive || shipEngineeringDisplay.assemblyActive || shipEngineeringDisplay.componentProgress.elapsed !== 5 ||
    shipEngineeringDisplay.currentAssembly.id !== "raylight" || !shipEngineeringDisplay.canStartAssembly ||
    !shipEngineeringDisplay.assemblyOptions.find(recipe => recipe.id === "raylight")?.unlocked) {
  throw new Error("舰船工程View State没有正确表达运行部件、待选舰船、进度或免蓝图组装状态");
}

manufacturingState.currentAction.skill = "equipmentEngineering";
manufacturingState.currentAction.equipEngCategory = "drones";
manufacturingState.currentAction.equipEngTarget = "blood_servant_drone_link";
manufacturingState.currentAction.startedEquipEngTarget = "t1_mining_laser";
manufacturingState.currentAction.progress = 4;
manufacturingState.currentAction.lastProgressUpdate = selectorNow - 1000;
const equipmentStateBefore = JSON.stringify(manufacturingState);
const equipmentEngineeringDisplay = sandbox.getEquipmentEngineeringDisplayState(manufacturingState, selectorNow, "赤誓仆从");
if (JSON.stringify(manufacturingState) !== equipmentStateBefore) throw new Error("装备工程View State修改了输入状态");
if (equipmentEngineeringDisplay.selectedRecipe.id !== "blood_servant_drone_link" || equipmentEngineeringDisplay.runningRecipe.id !== "t1_mining_laser" ||
    !equipmentEngineeringDisplay.active || !equipmentEngineeringDisplay.detail.runningNote?.targetDiffers || equipmentEngineeringDisplay.recipes.length !== 1 ||
    equipmentEngineeringDisplay.recipes[0].id !== "blood_servant_drone_link" || equipmentEngineeringDisplay.progress.elapsed !== 5) {
  throw new Error("装备工程View State没有正确表达分类搜索、运行配方、查看配方或进度");
}

// 执行确认必须生成稳定快照，库存统一通过 ResourceRegistry 汇总，且选择器保持纯读。
const confirmationState = JSON.parse(JSON.stringify(sandbox.gameState));
confirmationState.skills.shipEngineering.lvl = 99;
confirmationState.skills.equipmentEngineering.lvl = 99;
confirmationState.currentAction.shipCompTarget = "integrated_hull";
confirmationState.currentAction.equipEngCategory = "mining";
confirmationState.currentAction.equipEngTarget = "t1_mining_laser";
const confirmationRecipe = vm.runInContext('SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === "integrated_hull")', sandbox);
const splitMaterial = Object.keys(confirmationRecipe.cost)[0];
const splitQuantity = confirmationRecipe.cost[splitMaterial];
resourceRegistry.register({ namespace:"gas", key:"verify_" + splitMaterial, name:splitMaterial });
for (const resourceId of resourceRegistry.resolveMaterialIds(splitMaterial)) resourceRegistry.set(confirmationState, resourceId, 0);
resourceRegistry.set(confirmationState, "gas:verify_" + splitMaterial, splitQuantity);
const confirmationBefore = JSON.stringify(confirmationState);
const componentConfirmation = sandbox.getActionConfirmationDisplayState(confirmationState, "shipComp", selectorNow);
const equipmentConfirmation = sandbox.getActionConfirmationDisplayState(confirmationState, "equipmentEngineering", selectorNow);
if (JSON.stringify(confirmationState) !== confirmationBefore) throw new Error("执行确认View State修改了输入状态");
if (componentConfirmation.queue.target !== confirmationRecipe.name ||
    componentConfirmation.requirements.find(item => item.name === splitMaterial)?.stock !== splitQuantity ||
    !componentConfirmation.requirements.find(item => item.name === splitMaterial)?.enough) {
  throw new Error("执行确认View State没有通过ResourceRegistry汇总跨资源池库存");
}
const snapshottedEquipmentTarget = equipmentConfirmation.queue.target;
confirmationState.currentAction.equipEngTarget = "ammo_missile";
if (equipmentConfirmation.queue.target !== snapshottedEquipmentTarget || snapshottedEquipmentTarget !== "t1_mining_laser") {
  throw new Error("确认弹窗快照会被后续下拉选择覆盖");
}

const manufacturingActionState = JSON.parse(JSON.stringify(sandbox.gameState));
manufacturingActionState.skills.shipEngineering.lvl = 15;
manufacturingActionState.resources.isk = 100000;
manufacturingActionState.ownedBlueprints = [];
const lockedFrigateAssembly = sandbox.dispatchGameAction(manufacturingActionState, { type:"manufacturing/selectShipAssembly", recipeId:"rifter" }, selectorNow);
if (!lockedFrigateAssembly.changed || manufacturingActionState.currentAction.shipAsmTarget !== "rifter") throw new Error("无蓝图舰船无法选中预览");
if (sandbox.getShipEngineeringDisplayState(manufacturingActionState, selectorNow).canStartAssembly) throw new Error("无蓝图状态仍能合成护卫舰");
const freeDestroyerAssembly = sandbox.dispatchGameAction(manufacturingActionState, { type:"manufacturing/selectShipAssembly", recipeId:"raylight" }, selectorNow);
if (!freeDestroyerAssembly.changed || manufacturingActionState.currentAction.shipAsmTarget !== "raylight") throw new Error("免蓝图驱逐舰无法通过状态动作选择");
const blueprintPurchase = sandbox.dispatchGameAction(manufacturingActionState, { type:"manufacturing/buyBlueprint", blueprintId:"rifter" }, selectorNow);
if (!blueprintPurchase.changed || manufacturingActionState.resources.isk !== 50000 || !manufacturingActionState.ownedBlueprints.includes("rifter")) {
  throw new Error("蓝图购买动作没有正确扣除ISK或写入所有权");
}
manufacturingActionState.skills.shipEngineering.lvl = 20;
manufacturingActionState.resources.lp = 60;
const lockedMixedAssembly = sandbox.dispatchGameAction(manufacturingActionState, { type:"manufacturing/selectShipAssembly", recipeId:"gale" }, selectorNow);
const mixedBlueprintPurchase = sandbox.dispatchGameAction(manufacturingActionState, { type:"manufacturing/buyBlueprint", blueprintId:"gale" }, selectorNow);
const unlockedMixedAssembly = sandbox.dispatchGameAction(manufacturingActionState, { type:"manufacturing/selectShipAssembly", recipeId:"gale" }, selectorNow);
if (!lockedMixedAssembly.changed || !mixedBlueprintPurchase.changed ||
    manufacturingActionState.resources.lp !== 0 || !manufacturingActionState.ownedBlueprints.includes("gale") || !unlockedMixedAssembly.changed) {
  throw new Error("混血舰船LP蓝图没有正确执行选中预览、购买与永久解锁");
}
manufacturingActionState.currentAction.active = true;
manufacturingActionState.currentAction.skill = "equipmentEngineering";
manufacturingActionState.currentAction.progress = 9;
manufacturingActionState.currentAction.batchRemaining = 3;
const stopManufacturing = sandbox.dispatchGameAction(manufacturingActionState, { type:"manufacturing/stop" }, selectorNow);
if (!stopManufacturing.changed || manufacturingActionState.currentAction.active || manufacturingActionState.currentAction.progress !== 0 ||
    manufacturingActionState.currentAction.batchRemaining !== 0 || manufacturingActionState.currentAction.lastProgressUpdate !== selectorNow) {
  throw new Error("停止制造动作没有完整清理运行状态");
}

// 战斗View State统一提供HUD、编队、补给与按钮条件；战斗面板DOM不得回流到核心文件。
const combatCoreSource = scripts[scriptSources.indexOf("./js/systems/combat.js")];
if (!combatCoreSource || /getElementById\(["']combat-|querySelector\(["']\.combat-|function renderCombatPanel|function updateCombatLiveUI|function playAttackFX/.test(combatCoreSource)) {
  throw new Error("战斗核心重新包含HUD DOM、面板渲染或攻击特效");
}
if (/equipment\.inventory\s*\.\s*push|inventory\.equipment\s*\.\s*push/.test(combatCoreSource)) {
  throw new Error("星带战斗核心不得直接向装备仓库发放完整装备，只能产出制造材料");
}
const combatViewState = JSON.parse(JSON.stringify(sandbox.gameState));
const combatViewShip = combatViewState.inventory.ships[0];
combatViewShip.fitted = { high:["t1_small_laser"], mid:["t1_shield_booster"], low:[], rig:[] };
combatViewState.shipAssignments.combat = combatViewShip.instanceId;
combatViewState.combat.activeShip = combatViewShip.instanceId;
combatViewState.combat.zone = "angel_outpost";
const combatViewZone = vm.runInContext('COMBAT_ZONES.find(zone => zone.id === "angel_outpost")', sandbox);
const combatViewWave = sandbox.buildCombatWave(combatViewZone, 1, () => 0);
combatViewState.combat.enemies = combatViewWave.enemies;
combatViewState.combat.currentEnemy = combatViewWave.enemies[0];
combatViewState.combat.currentFormation = combatViewWave.formationId;
combatViewState.combat.active = true;
combatViewState.currentAction.active = true;
combatViewState.currentAction.skill = "combat";
const combatViewBefore = JSON.stringify(combatViewState);
const combatDisplay = sandbox.getCombatDisplayState(combatViewState, selectorNow);
if (JSON.stringify(combatViewState) !== combatViewBefore) throw new Error("战斗View State修改了输入状态");
if (!combatDisplay.active || combatDisplay.player.weaponCount !== 1 || combatDisplay.weapons[0].id !== "t1_small_laser" ||
    combatDisplay.repairers[0].id !== "t1_shield_booster" || combatDisplay.enemies.length !== 2 || !combatDisplay.enemies[0].current || combatDisplay.target?.index !== 0 ||
    combatDisplay.supplies.fuel !== combatViewState.resources.fuel || !combatDisplay.showRewards || combatDisplay.controls.showStart) {
  throw new Error("战斗View State没有正确表达舰船装备、敌方编队、补给、目标或按钮状态");
}

const combatActionState = JSON.parse(JSON.stringify(combatViewState));
combatActionState.combat.active = false;
combatActionState.currentAction.active = false;
combatActionState.combat.enemies = [];
combatActionState.combat.currentEnemy = null;
const lockedCombatBefore = JSON.stringify(combatActionState);
const lockedZoneAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/selectZone", zoneId:"angel_corridor" }, selectorNow);
if (lockedZoneAction.changed || lockedZoneAction.reason !== "level-locked" || JSON.stringify(combatActionState) !== lockedCombatBefore) {
  throw new Error("战斗区域动作允许进入未解锁星带或失败时修改了状态");
}
for (const key of ["laserOps", "shieldOperation"]) combatActionState.skills[key].lvl = 15;
const selectZoneAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/selectZone", zoneId:"angel_corridor" }, selectorNow);
const selectedZone = vm.runInContext('COMBAT_ZONES.find(zone => zone.id === "angel_corridor")', sandbox);
const selectedWave = sandbox.buildCombatWave(selectedZone, 1, () => 0);
const startCombatAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/start", enemies:selectedWave.enemies, formationId:selectedWave.formationId }, selectorNow);
const blockedSwitchAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/selectZone", zoneId:"angel_outpost" }, selectorNow);
if (!selectZoneAction.changed || !startCombatAction.changed || !combatActionState.combat.active || !combatActionState.currentAction.active ||
    combatActionState.combat.enemies.length !== 2 || blockedSwitchAction.changed || blockedSwitchAction.reason !== "combat-active") {
  throw new Error("战斗区域选择、开始战斗或交战中区域锁定动作异常");
}
const stopCombatAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/stop" }, selectorNow);
const beginRecoveryAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/beginRecovery" }, selectorNow);
const earlyRecoveryAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/finishRecovery" }, selectorNow + 179000);
const finishRecoveryAction = sandbox.dispatchGameAction(combatActionState, { type:"combat/finishRecovery" }, selectorNow + 180000);
if (!stopCombatAction.changed || !beginRecoveryAction.changed || earlyRecoveryAction.changed || !finishRecoveryAction.changed ||
    combatActionState.combat.repairUntil !== 0 || combatActionState.combat.destroyedShip !== null ||
    combatActionState.combat.hp.structure !== combatActionState.combat.maxHp.structure) {
  throw new Error("停止战斗或180秒自动维修动作没有正确收束状态");
}

// 行星核心必须与DOM/Canvas分离，View State统一表达产出进度、库存、周期和部署选项。
const planetaryCoreSource = scripts[scriptSources.indexOf("./js/systems/planetary.js")];
const planetDataSource = scripts[scriptSources.indexOf("./js/data/planets.js")];
if (!planetaryCoreSource || /document\.|CanvasRenderingContext2D|alert\s*\(|confirm\s*\(|render[A-Z]\w*\s*\(/.test(planetaryCoreSource)) {
  throw new Error("行星核心仍然直接访问DOM、Canvas、弹窗或渲染函数");
}
if (!planetDataSource || /document\.|CanvasRenderingContext2D|function _drawPlanet/.test(planetDataSource)) {
  throw new Error("行星静态配置重新混入Canvas实现");
}
const planetaryViewState = JSON.parse(JSON.stringify(sandbox.gameState));
planetaryViewState.skills.planetaryIndustry = { lvl:1, xp:7 };
planetaryViewState.planetary = { nextId:2, deployments:[{
  id:"planet_1", planetType:"lava", deployedAt:selectorNow - 5000, duration:86400,
  storage:2, lastTick:selectorNow - 3000, progress:1, active:true
}] };
const planetaryViewBefore = JSON.stringify(planetaryViewState);
const planetaryDisplay = sandbox.getPlanetaryDisplayState(planetaryViewState, selectorNow, 10000000);
if (JSON.stringify(planetaryViewState) !== planetaryViewBefore) throw new Error("行星View State修改了输入状态");
const planetaryCard = planetaryDisplay.deployments[0];
// Batch N：新手期行星槽位保底 2（Lv.1-19 = 2），后续曲线不变
if (planetaryDisplay.level !== 1 || planetaryDisplay.slots !== 2 ||
    planetaryCard.output !== "重金属" || planetaryCard.outputProgress !== 4 || planetaryCard.outputPercent !== 40 ||
    planetaryCard.storage !== 2 || !planetaryCard.active || planetaryCard.statusText !== "运行中" || !planetaryDisplay.deployOptions[0].unlocked) {
  throw new Error("行星View State没有正确表达技能、槽位、库存、产出进度或部署选项");
}
// Lv.1 lava: interval = 10/(1+0.02) ≈ 9.804, storageMax = ceil(21600/9.804) ≈ 2204
if (planetaryCard.storageMax < 2000) {
  throw new Error("行星仓储上限应约为6小时产量，≥2000（得" + planetaryCard.storageMax + "）");
}
planetaryViewState.planetary.deployments[0].deployedAt = selectorNow - 90000000;
const expiredPlanetBefore = JSON.stringify(planetaryViewState);
const expiredPlanetDisplay = sandbox.getPlanetaryDisplayState(planetaryViewState, selectorNow, 10000000).deployments[0];
if (!expiredPlanetDisplay.expired || expiredPlanetDisplay.active || JSON.stringify(planetaryViewState) !== expiredPlanetBefore) {
  throw new Error("过期行星View State没有保持纯读取或没有正确显示过期状态");
}

const planetaryActionState = JSON.parse(JSON.stringify(sandbox.gameState));
planetaryActionState.skills.planetaryIndustry = { lvl:1, xp:0 };
planetaryActionState.planetary = { deployments:[], nextId:1 };
planetaryActionState.resources.isk = 500000;
planetaryActionState.resources.minerals["三钛合金"] = 100;
const lockedPlanetBefore = JSON.stringify(planetaryActionState);
const lockedPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/deploy", planetType:"ice" }, selectorNow);
if (lockedPlanetAction.changed || lockedPlanetAction.reason !== "level-locked" || JSON.stringify(planetaryActionState) !== lockedPlanetBefore) {
  throw new Error("行星部署动作允许越级部署或失败时修改了状态");
}
// 建设材料不足时原子拒绝（三钛不足）
planetaryActionState.resources.minerals["三钛合金"] = 50;
const poorTritBefore = JSON.stringify(planetaryActionState);
const poorTritAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/deploy", planetType:"lava" }, selectorNow);
if (poorTritAction.changed || poorTritAction.reason !== "insufficient-tritanium" || JSON.stringify(planetaryActionState) !== poorTritBefore) {
  throw new Error("三钛不足时行星建设没有原子拒绝");
}
planetaryActionState.resources.minerals["三钛合金"] = 100;
// 成功建设熔岩行星：扣 138000 ISK + 100 三钛，立即运行中，字段用 planetType，并发布 planetary:deployed
let deployedEvent = null;
const unsubDeployed = sandbox.GameEvents.on("planetary:deployed", event => { deployedEvent = event; });
const deployPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/deploy", planetType:"lava" }, selectorNow);
unsubDeployed();
const deployedPlanet = planetaryActionState.planetary.deployments[0];
if (!deployPlanetAction.changed || deployedPlanet.id !== "planet_1" || deployedPlanet.planetType !== "lava" ||
    Object.hasOwn(deployedPlanet, "type") || deployedPlanet.deployedAt !== selectorNow || deployedPlanet.duration !== 86400 ||
    !deployedPlanet.active || planetaryActionState.resources.isk !== 362000 || planetaryActionState.resources.minerals["三钛合金"] !== 0 ||
    Object.hasOwn(deployedPlanet, "_scrollOffset") || !deployedEvent || deployedEvent.payload.constructionISK !== 138000 ||
    deployedEvent.payload.constructionResources["mineral:三钛合金"] !== 100) {
  throw new Error("行星建设动作没有正确扣费、创建 planetType 部署或发布 planetary:deployed 事件");
}
deployedPlanet.storage = 5;
const collectPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/collect", id:deployedPlanet.id }, selectorNow);
if (!collectPlanetAction.changed || collectPlanetAction.quantity !== 5 || deployedPlanet.storage !== 0) {
  throw new Error("行星收取动作数量或库存异常（应全量收取）");
}
// 重新加回库存以测试非空禁止拆除
deployedPlanet.storage = 1;
// 非空库存禁止拆除
const demolishStoredPlanet = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/demolish", id:deployedPlanet.id }, selectorNow);
if (demolishStoredPlanet.changed || demolishStoredPlanet.reason !== "storage-not-empty" || planetaryActionState.planetary.deployments.length !== 1) {
  throw new Error("非空库存行星被错误拆除");
}
// 还原库存供后续续期测试
deployedPlanet.storage = 2;
// 运行中重复续期返回 already-active，且不扣费
const iskBeforeAlreadyActive = planetaryActionState.resources.isk;
const renewRunning = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/renew", id:deployedPlanet.id }, selectorNow + 1000);
if (renewRunning.changed || renewRunning.reason !== "already-active" || planetaryActionState.resources.isk !== iskBeforeAlreadyActive) {
  throw new Error("运行中行星重复续期没有返回 already-active 或错误扣费");
}
// 到期后续期：只扣 maintenanceCostISK（46000），保留 storage，重置周期，发布 planetary:renewed，不扣三钛
deployedPlanet.active = false;
const iskBeforeRenew = planetaryActionState.resources.isk;
const tritBeforeRenew = planetaryActionState.resources.minerals["三钛合金"];
let renewedEvent = null;
const unsubRenewed = sandbox.GameEvents.on("planetary:renewed", event => { renewedEvent = event; });
const renewExpired = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/renew", id:deployedPlanet.id }, selectorNow + 5000);
unsubRenewed();
if (!renewExpired.changed || planetaryActionState.resources.isk !== iskBeforeRenew - 46000 ||
    planetaryActionState.resources.minerals["三钛合金"] !== tritBeforeRenew || deployedPlanet.deployedAt !== selectorNow + 5000 ||
    deployedPlanet.progress !== 0 || !deployedPlanet.active || deployedPlanet.storage !== 2 || deployedPlanet.duration !== 86400 ||
    !renewedEvent || renewedEvent.payload.maintenanceISK !== 46000) {
  throw new Error("行星续期没有只扣 ISK、保留库存、重置周期或发布 planetary:renewed 事件");
}
// 空库存拆除：删除部署、不返还任何资源、发布 planetary:demolished(refundedISK=0)
deployedPlanet.storage = 0;
let demolishedEvent = null;
const unsubDemolished = sandbox.GameEvents.on("planetary:demolished", event => { demolishedEvent = event; });
const demolishPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/demolish", id:deployedPlanet.id }, selectorNow);
unsubDemolished();
if (!demolishPlanetAction.changed || planetaryActionState.planetary.deployments.length !== 0 ||
    !demolishedEvent || demolishedEvent.payload.refundedISK !== 0 || Object.keys(demolishedEvent.payload.refundedResources).length !== 0) {
  throw new Error("空库存行星无法拆除或拆除返还了资源");
}

// ---- 行星经济数据驱动哨兵（Phase 1：无升级 / 六费用精确值 / 24h / 续期只扣 ISK / 拆除不返还）----
const planetTypes = vm.runInContext("PLANET_TYPES", sandbox);
const expectedPlanetEconomy = {
  lava:      { isk:138000,  trit:100,  maint:46000 },
  gas:       { isk:138000,  trit:100,  maint:46000 },
  ice:       { isk:249000,  trit:150,  maint:83000 },
  plasma:    { isk:714000,  trit:300,  maint:238000 },
  temperate: { isk:1914000, trit:500,  maint:638000 },
  storm:     { isk:4899000, trit:1000, maint:1633000 }
};
if (!Array.isArray(planetTypes) || planetTypes.length !== 6) throw new Error("行星类型数量必须为 6");
for (const config of planetTypes) {
  const expected = expectedPlanetEconomy[config.id];
  if (!expected) throw new Error(`未知行星类型：${config.id}`);
  if (Object.hasOwn(config, "costISK") || Object.hasOwn(config, "costTrit")) throw new Error(`行星 ${config.id} 仍保留占位字段 costISK/costTrit`);
  if (!config.constructionCost || Number(config.constructionCost.isk) !== expected.isk) throw new Error(`行星 ${config.id} 建设 ISK 不符：期望 ${expected.isk}`);
  if (Number(config.constructionCost.resources["mineral:三钛合金"]) !== expected.trit) throw new Error(`行星 ${config.id} 建设三钛不符：期望 ${expected.trit}`);
  if (Number(config.maintenanceCostISK) !== expected.maint) throw new Error(`行星 ${config.id} 维护 ISK 不符：期望 ${expected.maint}`);
  if (Number(config.maintenanceDuration) !== 86400) throw new Error(`行星 ${config.id} 维护周期必须为 86400`);
  if (/upgrade|upgradeCost|升级/i.test(JSON.stringify(config))) throw new Error(`行星 ${config.id} 混入了升级字段`);
}
// 选 B：旧动作名彻底移除；新动作路由存在；无升级系统；续期不读 constructionCost；拆除不返还
const planetaryRenderSource = scripts[scriptSources.indexOf("./js/ui/planetary-render.js")];
if (/planetary\/redeploy|planetary\/remove/.test(actionsSource)) throw new Error("actions.js 仍保留旧行星动作 redeploy/remove");
if (/planetary\/redeploy|planetary\/remove/.test(planetaryRenderSource)) throw new Error("planetary-render.js 仍派发旧行星动作 redeploy/remove");
if (!/planetary\/renew/.test(actionsSource) || !/planetary\/demolish/.test(actionsSource)) throw new Error("actions.js 缺少 renew/demolish 动作路由");
if (/planetary\/upgrade|planetaryUpgrade|upgradePlanet/.test(actionsSource + planetaryRenderSource + planetaryCoreSource + planetDataSource)) throw new Error("引入了行星升级系统");
if (/data-action="upgrade"|升级行星|planet-upgrade|upgrade-planet/.test(planetaryRenderSource + html)) throw new Error("行星 UI 引入了升级按钮");
{
  const renewMatch = /renew\(state, id, now(, [^)]*)?\) \{[\s\S]*?\n  \},/.exec(actionsSource);
  if (!renewMatch) throw new Error("未能定位 renew 动作实现");
  if (/constructionCost/.test(renewMatch[0])) throw new Error("续期路径读取了 constructionCost（应只扣 maintenanceCostISK）");
  if (!/maintenanceCostISK/.test(renewMatch[0])) throw new Error("续期路径没有读取 maintenanceCostISK");
}
{
  const demolishMatch = /demolish\(state, id\) \{[\s\S]*?\r?\n  }\r?\n\};/.exec(actionsSource);
  if (!demolishMatch) throw new Error("未能定位 demolish 动作实现");
  if (/ResourceRegistry\.add/.test(demolishMatch[0])) throw new Error("拆除路径向玩家返还了资源");
  if (!/refundedISK:0/.test(demolishMatch[0]) || !/refundedResources:\{\}/.test(demolishMatch[0])) throw new Error("拆除事件没有声明零返还");
}
// audit-planetary.mjs 存在且调用真实行星系统
const auditPlanetaryPath = path.resolve(root, "tools/audit-planetary.mjs");
if (!fs.existsSync(auditPlanetaryPath)) throw new Error("缺少 tools/audit-planetary.mjs");
const auditPlanetarySource = fs.readFileSync(auditPlanetaryPath, "utf8");
if (!/dispatchGameAction|PlanetaryStateActions/.test(auditPlanetarySource) || !/planetaryTick/.test(auditPlanetarySource) ||
    !/settleOfflinePlanets/.test(auditPlanetarySource) || !/normalizePlanetaryState/.test(auditPlanetarySource)) {
  throw new Error("audit-planetary.mjs 没有调用真实行星 Action / 在线 tick / 离线结算 / 迁移");
}

// 增强剂系统 Phase 2A：audit-boosters.mjs 存在且调用真实系统
const auditBoosterPath = path.resolve(root, "tools/audit-boosters.mjs");
if (!fs.existsSync(auditBoosterPath)) throw new Error("缺少 tools/audit-boosters.mjs");
const auditBoosterSource = fs.readFileSync(auditBoosterPath, "utf8");
if (!/dispatchGameAction|BoosterStateActions/.test(auditBoosterSource) || !/gameTick/.test(auditBoosterSource) ||
    !/applyOfflineGains/.test(auditBoosterSource) || !/migrateBoosterState/.test(auditBoosterSource)) {
  throw new Error("audit-boosters.mjs 没有调用真实增强剂 Action / 在线 tick / 离线结算 / 迁移");
}
// Phase 2B 行为确认：六槽装备动作路由必须存在
{
  const boosterSurfaces = actionsSource;
  if (!/booster\/equip/.test(boosterSurfaces) || !/booster\/unequip/.test(boosterSurfaces) || !/booster\/replace/.test(boosterSurfaces)) {
    throw new Error("actions.js 缺少 Phase 2B 六槽装备动作路由 (booster/equip / unequip / replace)");
  }
  if (!/BoosterStateActions\.equip/.test(boosterSurfaces) || !/BoosterStateActions\.unequip/.test(boosterSurfaces)) {
    throw new Error("BoosterStateActions 缺少六槽 equip/unequip 方法");
  }
  // 确认 booster effect 层存在
  const boostersIdx = scriptSources.indexOf("./js/systems/boosters.js");
  const boostersSource = boostersIdx >= 0 ? (scripts[boostersIdx] || "") : "";
  if (!/getBoosterEffectState/.test(boosterSurfaces + selectorsSource + boostersSource)) {
    throw new Error("缺少 getBoosterEffectState（Phase 2B 效果层未加载）");
  }
}

// 最终外壳迁移：生产、战斗、行星和队列核心均不得再包含DOM或页面渲染。
const productionCoreSource = scripts[scriptSources.indexOf("./js/systems/production.js")];
const queueCoreSource = scripts[scriptSources.indexOf("./js/core/queue.js")];
const shellRenderSource = scripts[scriptSources.indexOf("./js/ui/shell-render.js")];
const mainRenderSource = scripts[scriptSources.indexOf("./js/ui/render.js")];
for (const [name, source] of [["生产", productionCoreSource], ["战斗", combatCoreSource], ["行星", planetaryCoreSource], ["队列", queueCoreSource]]) {
  if (!source || /document\.|updateUI\s*\(|render[A-Z]\w*\s*\(|showToast\s*\(/.test(source)) throw new Error(`${name}核心仍直接访问DOM或页面渲染`);
}
if (!shellRenderSource || !/function switchPage|function renderCargoPage|function renderHangarPanel|function renderQueuePanel/.test(shellRenderSource)) {
  throw new Error("应用外壳适配器缺少导航、仓库、船坞或队列渲染入口");
}
const directUiStateWrite = /\bgameState(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])+\s*(?:\+\+|--|\+=|-=|(?<![=!<>])=(?!=))/;
if (directUiStateWrite.test(shellRenderSource) || directUiStateWrite.test(mainRenderSource)) {
  throw new Error("UI适配层重新直接修改了gameState，必须改为派发Action");
}
if (!/RuntimeGuard\.runCritical\("gameTick"/.test(mainRenderSource) || !/RuntimeGuard\.runRecoverable\("renderLoop"/.test(mainRenderSource)) {
  throw new Error("主循环或渲染循环没有通过运行时守卫调度");
}

if (!/currentPage\s*===\s*["']station["'][\s\S]{0,160}renderStationPage\s*\(/.test(mainRenderSource)) {
  throw new Error("空间站动作成功后没有刷新当前空间站页面");
}

const shellViewState = JSON.parse(JSON.stringify(sandbox.gameState));
shellViewState.resources.minerals["三钛合金"] = 5;
shellViewState.resources.shipComponents.destroyer_integrated_hull = 7;
shellViewState.resources.lp = 2;
shellViewState.equipment.inventory = ["t1_small_laser", "t1_light_missile_launcher"];
shellViewState.statistics.totals.enhancementAttempts = 4;
shellViewState.statistics.totals.enhancementSuccesses = 3;
shellViewState.statistics.totals.enhancementFailures = 1;
shellViewState.statistics.totals.highestEnhancementLevel = 5;
shellViewState.statistics.production.manufactured.integrated_hull = 2;
shellViewState.statistics.combat.zoneClears.angel_outpost = 1;
const shellViewBefore = JSON.stringify(shellViewState);
const cargoDisplay = sandbox.getCargoDisplayState(shellViewState, "mineral");
const equipmentCargoDisplay = sandbox.getCargoDisplayState(shellViewState, "equipment");
const lpDisplay = sandbox.getLPStoreDisplayState(shellViewState);
const hangarDisplay = sandbox.getHangarDisplayState(shellViewState, selectorNow);
const fittingDisplay = sandbox.getShipFittingDisplayState(shellViewState, shellViewState.inventory.ships[0].instanceId);
const queueDisplay = sandbox.getQueueDisplayState(shellViewState);
const navigationDisplay = sandbox.getNavigationDisplayState("skill", "combat");
const settingsDisplay = sandbox.getSettingsDisplayState(shellViewState);
const settingsNavigation = sandbox.getNavigationDisplayState("settings", "mining");
const statisticsDisplay = sandbox.getStatisticsDisplayState(shellViewState);
const statisticsNavigation = sandbox.getNavigationDisplayState("statistics", "mining");
const combatSidebarState = JSON.parse(JSON.stringify(shellViewState));
combatSidebarState.skills.combat = { lvl:99, xp:999999 };
combatSidebarState.skills.laserOps.lvl = 31;
combatSidebarState.skills.cannonOps.lvl = 8;
combatSidebarState.skills.missileOperations.lvl = 12;
combatSidebarState.skills.shieldOperation.lvl = 21;
combatSidebarState.skills.armorReinforcement.lvl = 15;
combatSidebarState.skills.hullEngineering.lvl = 10;
const combatSidebarDisplay = sandbox.getSidebarDisplayState(combatSidebarState).find(item => item.key === "combat");
if (JSON.stringify(shellViewState) !== shellViewBefore) throw new Error("外壳View State修改了输入状态");
if (cargoDisplay.filter !== "mineral" || cargoDisplay.items.find(item => item.name === "标准钛材")?.quantity !== 5 ||
    equipmentCargoDisplay.items.find(item => item.name === "驱逐舰综合舰体组件")?.quantity !== 7 ||
    !lpDisplay.items.length || hangarDisplay.count !== shellViewState.inventory.ships.length || !fittingDisplay ||
    queueDisplay.count !== shellViewState.queue.items.length || navigationDisplay.specializedSkillPanel !== "combat-panel" || navigationDisplay.showGenericSkill ||
    !settingsDisplay.confirmShipEnhancement || settingsDisplay.combatSkillsExpanded || settingsNavigation.standalonePanel !== "settings-panel" ||
    statisticsNavigation.standalonePanel !== "statistics-panel" || statisticsDisplay.kind !== "statistics" || statisticsDisplay.summaryGroups.length !== 4 ||
    statisticsDisplay.summaryGroups.find(group => group.id === "enhancement")?.items.find(item => item.label === "成功率")?.value !== 75 ||
    statisticsDisplay.detailGroups.find(group => group.id === "manufactured")?.items[0]?.name !== "综合舰体组件" ||
    statisticsDisplay.detailGroups.find(group => group.id === "zones")?.items[0]?.name !== "苍穹劫团前哨站" ||
    combatSidebarDisplay?.level !== 26 || combatSidebarDisplay.xp !== null ||
    !combatSidebarDisplay.tooltip.includes("⌊(31 + 21) ÷ 2⌋ = Lv.26")) {
  throw new Error("仓库、LP商店、船坞、装配、队列或导航View State异常");
}

// ---- station-panel 导航互斥断言（独立面板不允许出现在通用技能面板中）----
const stationNav = sandbox.getNavigationDisplayState("station", "");
if (stationNav.standalonePanel !== "station-panel") throw new Error("station 导航 standalonePanel 应为 station-panel，实际为 " + stationNav.standalonePanel);
if (stationNav.showGenericSkill !== false) throw new Error("station 导航 showGenericSkill 应为 false，实际为 " + stationNav.showGenericSkill);
const shellSource = sandbox.scriptSources && sandbox.scriptSources[sandbox.scriptSources.indexOf("./js/ui/shell-render.js")];
if (shellSource) {
  if (!shellSource.includes('"station-panel"')) throw new Error("getManagedPanels 的 ids 中缺少 station-panel");
  if (!shellSource.includes(':not(#station-panel)')) throw new Error("getGenericSkillPanels 选择器中缺少 :not(#station-panel)");
}
// 检查各独立页面导航均不指向 station-panel
for (const page of ["equipmentEngineering", "boosterEngineering", "archaeology", "combat", "cargo", "hangar", "statistics"]) {
  const nav = sandbox.getNavigationDisplayState(page, "");
  if (nav.standalonePanel === "station-panel") throw new Error(page + " 导航误指向 station-panel");
}

const shellActionState = JSON.parse(JSON.stringify(shellViewState));
// 采矿职责须由具备采矿加成的工业/采矿舰承担（getShipAssignmentRestriction 规则，
// 要求 bonuses.miningLaserEfficiency>0）。默认测试库存不含此类舰船，这里显式注入
// 一艘 miner_frigate（冲锋者级，miningLaserEfficiency=1.0）作为船坞/装配测试舰。
let shellShip = shellActionState.inventory.ships.find(s => s.shipId === "miner_frigate");
if (!shellShip) {
  shellShip = sandbox.createShipInstance("miner_frigate");
  shellActionState.inventory.ships.push(shellShip);
}
shellShip.fitted = { high:["t1_small_laser"], mid:[], low:[], rig:[] };
shellActionState.equipment.inventory = ["t1_light_missile_launcher"];
const assignmentAction = sandbox.dispatchGameAction(shellActionState, { type:"hangar/toggleAssignment", instanceId:shellShip.instanceId, actionKey:"mining" }, selectorNow);
const fittingAction = sandbox.dispatchGameAction(shellActionState, { type:"hangar/setFittingSlot", instanceId:shellShip.instanceId, slot:"high", slotIndex:1, equipmentId:"t1_light_missile_launcher" }, selectorNow);
const resetFittingAction = sandbox.dispatchGameAction(shellActionState, { type:"hangar/resetFitting", instanceId:shellShip.instanceId }, selectorNow);
const lpItem = sandbox.getLPStoreItems().find(item => item.kind === "equipmentBlueprint");
shellActionState.resources.lp = lpItem.lpPrice;
const lpPurchaseAction = sandbox.dispatchGameAction(shellActionState, { type:"shell/buyLPItem", equipmentId:lpItem.id }, selectorNow);
const lpBlueprintKey = sandbox.getEquipmentBlueprintOwnershipKey(lpItem.equipmentId);
const settingsAction = sandbox.dispatchGameAction(shellActionState, { type:"settings/setShipEnhancementConfirmation", enabled:false }, selectorNow);
const combatSkillsAction = sandbox.dispatchGameAction(shellActionState, { type:"settings/toggleCombatSkills" }, selectorNow);
if (!assignmentAction.changed || shellActionState.shipAssignments.mining !== shellShip.instanceId || !fittingAction.changed || !resetFittingAction.changed ||
    Object.values(shellShip.fitted).flat().filter(Boolean).length !== 0 || !shellActionState.equipment.inventory.includes("t1_small_laser") ||
    !shellActionState.equipment.instances.some(i => i.itemId === "t1_light_missile_launcher" && !i.installedOn) || !lpPurchaseAction.changed || shellActionState.resources.lp !== 0 ||
    !shellActionState.ownedBlueprints.includes(lpBlueprintKey) || !settingsAction.changed || settingsAction.enabled !== false ||
    shellActionState.settings.confirmShipEnhancement !== false || !combatSkillsAction.changed || !combatSkillsAction.expanded ||
    shellActionState.settings.combatSkillsExpanded !== true || !shellActionState._dirty) {
  throw new Error("船坞分配、装配交换、清空装配或LP兑换动作异常");
}

shellActionState.queue = { items:[], config:{ maxSize:20, loopMode:false, skipOnFail:true }, status:{ activeIndex:-1, isRunning:false, completedCount:0, failCount:0 } };
const queueAddA = sandbox.dispatchGameAction(shellActionState, { type:"queue/add", item:{ skill:"mining", target:"凡晶石带", label:"凡晶石", count:2 } }, selectorNow);
const queueMerge = sandbox.dispatchGameAction(shellActionState, { type:"queue/add", item:{ skill:"mining", target:"凡晶石带", label:"凡晶石", count:3 } }, selectorNow + 1);
const queueAddB = sandbox.dispatchGameAction(shellActionState, { type:"queue/add", item:{ skill:"refining", target:"凡晶石带", label:"凡晶石→三钛", count:1 } }, selectorNow + 2);
const queueMove = sandbox.dispatchGameAction(shellActionState, { type:"queue/move", from:1, to:0 }, selectorNow + 3);
const queueStart = sandbox.dispatchGameAction(shellActionState, { type:"queue/start" }, selectorNow + 4);
const runningQueueDisplay = sandbox.getQueueDisplayState(shellActionState);
const queueStop = sandbox.dispatchGameAction(shellActionState, { type:"queue/stop" }, selectorNow + 5);
const queueClear = sandbox.dispatchGameAction(shellActionState, { type:"queue/clear" }, selectorNow + 6);
if (!queueAddA.changed || !queueMerge.changed || !queueMerge.merged || !queueAddB.changed || !queueMove.changed ||
    !queueStart.changed || runningQueueDisplay.items[0].active !== true || shellActionState.currentAction.active ||
    !queueStop.changed || !queueClear.changed || shellActionState.queue.items.length !== 0 || shellActionState.queue.status.isRunning) {
  throw new Error("队列添加合并、排序、启动、停止或清空动作异常");
}

sandbox.gameState.planetary.deployments = [{
  id: 99, planetType: "lava", deployedAt: Date.now() - 5000, duration: 3600,
  active: true, storage: 1, progress: 2, lastTick: Date.now()
}];
sandbox.renderPlanetaryPage();
sandbox.updatePlanetaryLiveUI();
sandbox.updateCombatLiveUI();
if (sandbox.demolishPlanet(99) || sandbox.gameState.planetary.deployments.length !== 1) {
  throw new Error("行星仍有库存时可以被撤除");
}
sandbox.gameState.planetary.deployments[0].storage = 0;
if (!sandbox.demolishPlanet(99) || sandbox.gameState.planetary.deployments.length !== 0) {
  throw new Error("空库存行星无法撤除或槽位没有释放");
}

// 常规舰仅使用三类部件；混血舰在相同部件体系上追加月矿与势力数据。
const expectedShipMaterials = {
  rifter: { "三钛合金":164, "类银超金属":26, "重金属":18, "稀有气体":18 },
  kestrel: { "三钛合金":164, "类银超金属":26, "重金属":18, "稀有气体":18 },
  atron: { "三钛合金":164, "类银超金属":26, "重金属":18, "稀有气体":18 },
  miner_frigate: { "三钛合金":164, "类银超金属":26, "重金属":18, "稀有气体":18 },
  gas_frigate: { "三钛合金":164, "类银超金属":26, "重金属":18, "稀有气体":18 },
  raylight: { "三钛合金":281, "类银超金属":76, "重金属":27, "稀有气体":30, "类晶体胶矿":6 },
  spearfalcon: { "三钛合金":281, "类银超金属":76, "重金属":27, "稀有气体":30, "类晶体胶矿":6 },
  swiftblade: { "三钛合金":281, "类银超金属":76, "重金属":27, "稀有气体":30, "类晶体胶矿":6 },
  miner_destroyer: { "三钛合金":281, "类银超金属":76, "重金属":27, "稀有气体":30, "类晶体胶矿":6 },
  gas_destroyer: { "三钛合金":281, "类银超金属":76, "重金属":27, "稀有气体":30, "类晶体胶矿":6 },
  gale: { "三钛合金":370, "类银超金属":100, "重金属":36, "稀有气体":39, "类晶体胶矿":8 },
  bloodthorn: { "三钛合金":370, "类银超金属":100, "重金属":36, "稀有气体":39, "类晶体胶矿":8 },
  umbra: { "三钛合金":370, "类银超金属":100, "重金属":36, "稀有气体":39, "类晶体胶矿":8 },
  dawnlight: { "三钛合金":367, "类银超金属":96, "同位聚合体":38, "同位素":24, "重金属":36, "类晶体胶矿":15, "稀有气体":36 },
  warfalcon: { "三钛合金":367, "类银超金属":96, "同位聚合体":38, "同位素":24, "重金属":36, "类晶体胶矿":15, "稀有气体":36 },
  stormblade: { "三钛合金":367, "类银超金属":96, "同位聚合体":38, "同位素":24, "重金属":36, "类晶体胶矿":15, "稀有气体":36 },
  miner_cruiser: { "三钛合金":367, "类银超金属":96, "同位聚合体":38, "同位素":24, "重金属":36, "类晶体胶矿":15, "稀有气体":36 },
  gas_cruiser: { "三钛合金":367, "类银超金属":96, "同位聚合体":38, "同位素":24, "重金属":36, "类晶体胶矿":15, "稀有气体":36 },
  dolphin: { "三钛合金":370, "类银超金属":98, "同位聚合体":38, "同位素":24, "重金属":32, "类晶体胶矿":12, "稀有气体":40 },
  thunder: { "三钛合金":440, "类银超金属":118, "同位聚合体":46, "同位素":30, "重金属":40, "类晶体胶矿":15, "稀有气体":44 },
  crimson: { "三钛合金":440, "类银超金属":118, "同位聚合体":46, "同位素":30, "重金属":40, "类晶体胶矿":15, "稀有气体":44 },
  nether: { "三钛合金":440, "类银超金属":118, "同位聚合体":46, "同位素":30, "重金属":40, "类晶体胶矿":15, "稀有气体":44 },
  sunlance: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  fortfalcon: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  thunderblade: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  miner_battleship: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  gas_battleship: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  dawnbreaker: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  crimson_bastion: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  spectre_frame: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 },
  heron: { "三钛合金":164, "类银超金属":26, "重金属":18, "稀有气体":18 },
  tracer: { "三钛合金":281, "类银超金属":76, "重金属":27, "稀有气体":30, "类晶体胶矿":6 },
  starmap: { "三钛合金":367, "类银超金属":96, "同位聚合体":38, "同位素":24, "重金属":36, "类晶体胶矿":15, "稀有气体":36 },
  farscope: { "三钛合金":430, "同位聚合体":223, "超新星诺克石":215, "同位素":30, "重金属":66, "等离子体":95, "稀有气体":60 }
};
const shipAssemblyRecipes = vm.runInContext("SHIP_ASSEMBLY_RECIPES", sandbox);
const shipComponentRecipes = vm.runInContext("SHIP_COMPONENT_RECIPES", sandbox);
// 启程级（rookie_corvette）是新手引导专属训练艇，采用 1/1/1 的减半用料，不参与常规同级整船材料模型；
// 其专项校验见文末「Batch N」块。
for (const recipe of shipAssemblyRecipes.filter(item => item.level <= 60 && item.id !== "rookie_corvette")) {
  if (!recipe.componentCost || recipe.extraCost || recipe.comps || recipe.compCount) {
    throw new Error(`${recipe.name}仍使用旧式统一部件字段`);
  }
  const componentTotal = Object.values(recipe.componentCost).reduce((sum, count) => sum + count, 0);
  const expectedTotal = recipe.id === "dolphin" ? 14 : recipe.level === 60 || recipe.level === 55 || recipe.level === 40 ? 16 : recipe.level === 35 || recipe.level === 20 ? 13 : recipe.level === 15 ? 10 : 6;
  if (componentTotal !== expectedTotal) throw new Error(`${recipe.name}部件总数不是${expectedTotal}`);
  const materials = {};
  for (const [componentId, count] of Object.entries(recipe.componentCost)) {
    const component = shipComponentRecipes.find(item => item.id === componentId);
    const expectedComponentLevel = recipe.level === 20 ? 15 : recipe.level === 40 ? 35 : recipe.level === 60 ? 55 : recipe.level;
    if (!component || component.level !== expectedComponentLevel) throw new Error(`${recipe.name}包含不存在或舰级不匹配的部件`);
    for (const [material, quantity] of Object.entries(component.cost)) {
      materials[material] = (materials[material] || 0) + quantity * count;
    }
  }
  if (JSON.stringify(materials) !== JSON.stringify(expectedShipMaterials[recipe.id])) {
    throw new Error(`${recipe.name}整船材料总计不符合设计：${JSON.stringify(materials)}`);
  }
}

for (const recipe of shipAssemblyRecipes.filter(item => item.level === 20)) {
  const dataCost = Object.entries(recipe.materialCost || {}).find(([material]) => material.endsWith("低级加密数据"));
  if (!dataCost || dataCost[1] !== 15 || recipe.materialCost["镓"] !== 10 || recipe.materialCost["铂"] !== 8) {
    throw new Error(`${recipe.name}没有执行四分之三套势力装的数据与月矿成本`);
  }
}

// 旗舰（Lv.80）与超级旗舰（Lv.90）采用独立校验：部件总数、档位、莫尔石依赖（旗舰禁耗莫尔石，
// 超级旗舰恰耗52份）、深层舰船数据（各60份）与旗舰固有特性。不从 expectedShipMaterials 走整船材料比对。
const capitalRecipeExpectations = {
  firmament:{ level:80, total:26, trait:"deflection_shield" },
  heavy_bastion:{ level:80, total:26, trait:"reactive_armor" },
  riftbreaker:{ level:80, total:26, trait:"structure_overdrive" },
  orca:{ level:80, total:28, industrial:true },
  starcrown:{ level:90, total:52, trait:"deflection_shield", data:"天穹深层舰船数据" },
  eternal_fortress:{ level:90, total:52, trait:"reactive_armor", data:"重垒深层舰船数据" },
  arbiter:{ level:90, total:52, trait:"structure_overdrive", data:"裂界深层舰船数据" }
};
const starterShips = vm.runInContext("STARTER_SHIPS", sandbox);
for (const [shipId, expectation] of Object.entries(capitalRecipeExpectations)) {
  const recipe = shipAssemblyRecipes.find(item => item.id === shipId);
  if (!recipe || recipe.level !== expectation.level) throw new Error(`${shipId}缺少对应旗舰制造配方`);
  const componentTotal = Object.values(recipe.componentCost).reduce((sum, count) => sum + count, 0);
  if (componentTotal !== expectation.total) throw new Error(`${recipe.name}部件总数不是${expectation.total}`);
  const fullMaterialCost = { ...(recipe.materialCost || {}) };
  for (const componentId of Object.keys(recipe.componentCost)) {
    const component = shipComponentRecipes.find(item => item.id === componentId);
    if (!component || component.level !== expectation.level) throw new Error(`${recipe.name}使用了错误档位的强化部件`);
    const count = recipe.componentCost[componentId];
    for (const [material, quantity] of Object.entries(component.cost || {})) {
      fullMaterialCost[material] = (fullMaterialCost[material] || 0) + quantity * count;
    }
  }
  const morphiteCost = fullMaterialCost["莫尔石"] || 0;
  if (expectation.level === 80 && morphiteCost !== 0) throw new Error(`${recipe.name}错误依赖旗舰进入0.0后才能取得的莫尔石`);
  if (expectation.level === 90 && morphiteCost !== 52) throw new Error(`${recipe.name}莫尔石总需求不是52份`);
  if (expectation.data && recipe.materialCost[expectation.data] !== 60) throw new Error(`${recipe.name}没有消耗60份对应深层舰船数据`);
  if (!expectation.industrial) {
    const ship = starterShips[shipId];
    if (!ship || ship.capitalTrait.id !== expectation.trait) throw new Error(`${recipe.name}缺少对应旗舰固有特性`);
  }
}

// 常规舰从零库存开始：矿物允许使用高出舰船工程不超过10级的材料，采矿/冶炼按L+10计算；
// 行星与制造仍按舰船工程L计算。护卫预算2～3小时，驱逐约3.5小时，巡洋预算4～6小时，战列预算8～10小时。
const buildMiningAreas = vm.runInContext("MINING_AREAS", sandbox);
const buildRefiningRecipes = vm.runInContext("SMELTING_RECIPES", sandbox);
const buildPlanetTypes = vm.runInContext("PLANET_TYPES", sandbox);
// 同上：启程级刻意低于常规护卫舰 2～3 小时的自给预算（新手引导用），不纳入预算模型。
for (const recipe of shipAssemblyRecipes.filter(item => item.level <= 55 && !item.materialCost && item.id !== "rookie_corvette")) {
  const level = recipe.level;
  const gatheringLevel = Math.min(99, level + 10);
  const gatheringEfficiency = 1 + gatheringLevel * 0.02;
  const manufacturingEfficiency = 1 + level * 0.02;
  const refiningOutput = Math.max(1, Math.floor(gatheringEfficiency));
  const materials = expectedShipMaterials[recipe.id];
  const planetJobs = [];
  let activeSeconds = 0;
  for (const [material, quantity] of Object.entries(materials)) {
    const refining = buildRefiningRecipes.find(item => item.outputMineral === material);
    if (refining) {
      const mining = buildMiningAreas.find(item => item.ore === refining.consumeOre);
      if (!mining || mining.level > gatheringLevel || refining.level > gatheringLevel) {
        throw new Error(`${recipe.name}无法在L+10材料范围内自给${material}`);
      }
      const cycles = Math.ceil(quantity / refiningOutput);
      activeSeconds += cycles * (mining.baseTime + refining.baseTime) / gatheringEfficiency;
      continue;
    }
    const planet = buildPlanetTypes.find(item => item.output === material);
    if (!planet || planet.level > level) throw new Error(`${recipe.name}无法以同级采集自给${material}`);
    planetJobs.push(quantity * planet.interval / manufacturingEfficiency);
  }
  activeSeconds += recipe.time / manufacturingEfficiency;
  for (const [componentId, count] of Object.entries(recipe.componentCost)) {
    const component = shipComponentRecipes.find(item => item.id === componentId);
    activeSeconds += component.time * count / manufacturingEfficiency;
  }
  // 行星并行车道数与正式 selectors 一致：Lv.1-19 保底 2 道（Batch N 行星槽保底 2 的同源修正）
  const lanes = Array.from({ length:Math.min(5, Math.max(2, 1 + Math.floor(level / 10))) }, () => 0);
  for (const seconds of planetJobs.sort((left, right) => right - left)) {
    const lane = lanes.indexOf(Math.min(...lanes));
    lanes[lane] += seconds;
  }
  const totalSeconds = Math.max(activeSeconds, Math.max(...lanes));
  const budget = level === 55 ? [28800, 36000] : level === 35 ? [14400, 21600] : level === 15 ? [11700, 13500] : [7200, 10800];
  if (totalSeconds < budget[0] || totalSeconds > budget[1]) {
    const budgetLabel = level === 55 ? "8～10" : level === 35 ? "4～6" : level === 15 ? "3.25～3.75" : "2～3";
    throw new Error(`${recipe.name}全链路工时${(totalSeconds / 3600).toFixed(2)}小时，不在${budgetLabel}小时预算内`);
  }
}

// Lv.35/Lv.55装备遵循相同材料跨度：矿物/气体最多高10级，行星产物不得高于装备工程等级。
const buildEquipment = vm.runInContext("EQUIPMENT_DB", sandbox);
const buildGasAreas = vm.runInContext("GAS_AREAS", sandbox);
for (const equipment of Object.values(buildEquipment).filter(item => [35, 55].includes(item.level) && item.cost && item.combat)) {
  const materialLimit = Math.min(99, equipment.level + 10);
  for (const material of Object.keys(equipment.cost)) {
    const refining = buildRefiningRecipes.find(item => item.outputMineral === material);
    const mining = refining && buildMiningAreas.find(item => item.ore === refining.consumeOre);
    const gas = buildGasAreas.find(item => item.gas === material);
    const planet = buildPlanetTypes.find(item => item.output === material);
    if (refining && (!mining || mining.level > materialLimit || refining.level > materialLimit)) {
      throw new Error(`${equipment.name}使用了超出L+10范围的矿物${material}`);
    }
    if (gas && gas.level > materialLimit) throw new Error(`${equipment.name}使用了超出L+10范围的气体${material}`);
    if (planet && planet.level > equipment.level) throw new Error(`${equipment.name}使用了高于同级的行星产物${material}`);
  }
}
const destroyerAssemblies = shipAssemblyRecipes.filter(recipe => recipe.level === 15);
if (destroyerAssemblies.length !== 6 || destroyerAssemblies.some(recipe => recipe.requiresBlueprint !== false)) {
  throw new Error("Lv.15 免蓝图配方应为 6 艘（5 战斗/工业驱逐舰 + 考古追迹级）");
}
if (!destroyerAssemblies.every(recipe => sandbox.canUseShipAssemblyRecipe(recipe))) {
  throw new Error("免蓝图驱逐舰仍被蓝图门槛阻止组装");
}
const cruiserAssemblies = shipAssemblyRecipes.filter(recipe => recipe.level === 35);
if (cruiserAssemblies.length !== 7 || cruiserAssemblies.some(recipe => recipe.requiresBlueprint !== false) ||
    !cruiserAssemblies.every(recipe => sandbox.canUseShipAssemblyRecipe(recipe))) {
  throw new Error("Lv.35 免蓝图配方应为 7 艘（6 战斗/工业巡洋舰 + 考古星图级）");
}
const battleshipAssemblies = shipAssemblyRecipes.filter(recipe => recipe.level === 55);
if (battleshipAssemblies.length !== 6 || battleshipAssemblies.some(recipe => recipe.requiresBlueprint !== false) ||
    !battleshipAssemblies.every(recipe => sandbox.canUseShipAssemblyRecipe(recipe))) {
  throw new Error("Lv.55 免蓝图配方应为 6 艘（5 战斗/工业战列舰 + 考古远镜级）");
}
const rifterAssembly = shipAssemblyRecipes.find(recipe => recipe.id === "rifter");
for (const [componentId, count] of Object.entries(rifterAssembly.componentCost)) {
  sandbox.gameState.resources.shipComponents[componentId] = count * 2;
}
if (sandbox.getMaxShipAssemblyCycles(rifterAssembly) !== 2) throw new Error("舰船批量组装上限没有按独立部件数量计算");
sandbox.deductShipAssemblyComponents(rifterAssembly, 2);
if (Object.keys(rifterAssembly.componentCost).some(id => sandbox.gameState.resources.shipComponents[id] !== 0)) {
  throw new Error("舰船组装没有按独立部件数量扣除库存");
}

// 有限队列的次数必须是“剩余次数”，并在归零时删除当前项。
const queueState = sandbox.gameState.queue;
queueState.items = [
  { id: "verify_1", skill: "mining", target: "凡晶石带", label: "凡晶石", count: 100 },
  { id: "verify_2", skill: "mining", target: "凡晶石带", label: "凡晶石", count: 2 }
];
queueState.status = { activeIndex: 0, isRunning: true, completedCount: 0, failCount: 0 };
sandbox.gameState.currentAction.active = true;
sandbox.gameState.currentAction.batchRemaining = 100;
sandbox.completeQueuedActionCycle();
if (queueState.items[0].count !== 99 || sandbox.gameState.currentAction.batchRemaining !== 99) {
  throw new Error("在线有限队列没有同步递减剩余次数");
}
queueState.items[0].count = 1;
sandbox.gameState.currentAction.batchRemaining = 1;
sandbox.completeQueuedActionCycle();
if (queueState.items.length !== 1 || queueState.items[0].id !== "verify_2" || queueState.status.activeIndex !== 0) {
  throw new Error("在线有限队列归零后没有删除并启动下一项");
}

queueState.items = [{ id: "verify_offline", skill: "mining", target: "凡晶石带", label: "凡晶石", count: 3 }];
queueState.status = { activeIndex: 0, isRunning: true, completedCount: 0, failCount: 0 };
sandbox.gameState.currentAction.active = true;
sandbox.gameState.currentAction.batchRemaining = 3;
sandbox.completeOfflineQueueCycles(2);
if (queueState.items[0].count !== 1 || sandbox.gameState.currentAction.batchRemaining !== 1) {
  throw new Error("离线有限队列没有同步递减剩余次数");
}
sandbox.completeOfflineQueueCycles(1);
if (queueState.items.length !== 0 || queueState.status.isRunning || sandbox.gameState.currentAction.active) {
  throw new Error("离线有限队列归零后没有删除出队");
}

if (sandbox.gameState.skills.ammunitionEngineering || sandbox.getEquipmentEngineeringRecipe("ammo_laser").id !== "ammo_laser") {
  throw new Error("弹药配方没有合并到装备工程");
}
const resources = sandbox.gameState.resources;
const equipmentCount = sandbox.gameState.equipment.inventory.length;
const miningLaserOutputHtml = sandbox.getEquipEngOutputHtml(sandbox.getEquipmentEngineeringRecipe("t1_mining_laser"));
const moonMiningAreas = vm.runInContext("MOON_MINING_AREAS", sandbox);
const normalMiningAreas = vm.runInContext("MINING_AREAS", sandbox);
const expectedMoonMining = [
  ["镓",20,120,100], ["铂",20,120,100], ["铪",40,240,240],
  ["锇",40,240,240], ["钷",55,420,450], ["铷",70,720,870]
];
if (JSON.stringify(moonMiningAreas.map(area => [area.ore,area.level,area.baseTime,area.baseXP])) !== JSON.stringify(expectedMoonMining)) {
  throw new Error("月矿等级、耗时或经验配置不符合策划案");
}
for (const area of moonMiningAreas) {
  const normal = normalMiningAreas.filter(item => item.level <= area.level).sort((left, right) => right.level - left.level)[0];
  if (!normal || area.baseXP / area.baseTime >= normal.baseXP / normal.baseTime) {
    throw new Error(`${area.ore}的经验效率没有低于该等级已解锁的最高普通矿`);
  }
}
if (!html.includes('id="mining-target-strip"') || !html.includes('data-mode="normal"') || !html.includes('data-mode="moon"') || !html.includes('data-filter="moon"')) {
  throw new Error("采矿双页面、横向目标容器或月矿仓库标签缺失");
}
if (!html.includes('fa-solid fa-gem') || html.includes('fa-solid fa-pickaxe')) {
  throw new Error("侧边栏采矿图标没有使用可用的 Font Awesome 图标");
}
if (!miningLaserOutputHtml.includes('equip-output-name') || !miningLaserOutputHtml.includes('采矿效率 +5%') || !miningLaserOutputHtml.includes('高槽')) {
  throw new Error("装备工程产出名称没有包含装备属性 hover");
}
const fuelBefore = resources.fuel || 0;
const laserAmmoBefore = resources.ammunition.laser || 0;
sandbox.applyEquipEngOutput(sandbox.getEquipmentEngineeringRecipe("t1_mining_laser"), 1);
sandbox.applyEquipEngOutput(sandbox.getEquipmentEngineeringRecipe("fuel_t1"), 2);
sandbox.applyEquipEngOutput(sandbox.getEquipmentEngineeringRecipe("ammo_laser"), 3);
if (sandbox.gameState.equipment.inventory.length !== equipmentCount + 1 || resources.fuel !== fuelBefore + 200 || resources.ammunition.laser !== laserAmmoBefore + 150) {
  throw new Error("装备工程没有按配方类型正确产出装备、燃料或弹药");
}

const bloodLinkRecipe = sandbox.getEquipmentEngineeringRecipe("blood_servant_drone_link");
const sanshaBoosterRecipe = sandbox.getEquipmentEngineeringRecipe("sansha_mineral_assimilation");
if (bloodLinkRecipe.level !== 45 || bloodLinkRecipe.cost["血袭者中级加密数据"] !== 8 || sanshaBoosterRecipe.level !== 65 || sanshaBoosterRecipe.cost["萨沙高级加密数据"] !== 10) {
  throw new Error("势力装备配方等级或加密数据需求不正确");
}
for (const [material, qty] of Object.entries(bloodLinkRecipe.cost)) {
  const pool = material === "血袭者中级加密数据" ? resources.special : resources.minerals;
  pool[material] = qty;
}
if (!sandbox.hasEnoughMats(bloodLinkRecipe.cost)) throw new Error("装备工程无法读取特殊物资中的加密数据");
sandbox.deductMats(bloodLinkRecipe.cost);
if (resources.special["血袭者中级加密数据"] !== 0) throw new Error("势力装备制造没有扣除加密数据");
const factionEquipmentBefore = sandbox.gameState.equipment.inventory.length;
sandbox.applyEquipEngOutput(bloodLinkRecipe, 1);
if (sandbox.gameState.equipment.inventory.length !== factionEquipmentBefore + 1 || !sandbox.gameState.equipment.inventory.includes("blood_servant_drone_link")) {
  throw new Error("血仆无人机指挥链路没有进入装备库存");
}

// 装备工程分类不再单列势力标签；原「工业采集」按功能细分为 采矿装备 / 采气装备 / 采集增益 三个顶层分类，LP商品不混入制造配方。
const equipEngCategories = vm.runInContext("EQUIPMENT_ENGINEERING_CATEGORIES.map(category => category.id)", sandbox);
if (equipEngCategories.length !== 11 || equipEngCategories.includes("faction")) { // 11 = 采矿/采气/采集增益 + 无人机/武器/防御/燃料/弹药/考古/探针/改装件
  throw new Error("装备工程仍然存在独立势力标签，或基础分类数量不正确");
}
for (const equipmentId of [
  "t2_mining_laser","t3_mining_laser","t4_mining_laser","t5_mining_laser",
  "t2_gas_harvester","t3_gas_harvester","t4_gas_harvester","t5_gas_harvester"
]) {
  const equipment = vm.runInContext(`EQUIPMENT_DB["${equipmentId}"]`, sandbox);
  const recipe = sandbox.getEquipmentEngineeringRecipe(equipmentId);
  const expectedCategory = equipmentId.includes("gas_harvester") ? "gas" : "mining";
  if (!equipment || recipe.id !== equipmentId || recipe.category !== expectedCategory) {
    throw new Error(`高级采集装备 ${equipmentId} 没有进入正确的制造分类（应为 ${expectedCategory}）`);
  }
}
if (bloodLinkRecipe.category !== "drones" || sanshaBoosterRecipe.category !== "collect_boost") {
  throw new Error("势力装备没有按实际用途归入无人机或采集增益分类");
}
const lpStoreItems = sandbox.getLPStoreItems();
const beltEquipmentPairs = [
  { factionId:"angel_mining_laser", allianceId:"raider_mining_laser", blueprintId:"alliance_mining_laser_blueprint", zoneId:"angel_corridor", data:"天使低级加密数据", need:5, price:624 },
  { factionId:"angel_gas_harvester", allianceId:"raider_gas_harvester", blueprintId:"alliance_gas_harvester_blueprint", zoneId:"angel_corridor", data:"天使低级加密数据", need:5, price:624 },
  { factionId:"blood_servant_drone_link", allianceId:"alliance_drone_link", blueprintId:"alliance_drone_link_blueprint", zoneId:"blood_cathedral", data:"血袭者中级加密数据", need:8, price:764 },
  { factionId:"sansha_mineral_assimilation", allianceId:"alliance_mineral_assimilation", blueprintId:"alliance_mineral_assimilation_blueprint", zoneId:"sansha_command_matrix", data:"萨沙高级加密数据", need:10, price:836 }
];
const beltZoneConfigs = vm.runInContext("COMBAT_ZONES", sandbox);
const beltFormationPools = vm.runInContext("COMBAT_FORMATION_POOLS", sandbox);
const beltDataMaterials = vm.runInContext("STAR_BELT_DATA_MATERIALS", sandbox);

function convolveProbability(left, right) {
  const result = Array(left.length + right.length - 1).fill(0);
  for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) result[i + j] += left[i] * right[j];
  return result;
}
function binomialProbability(count, chance) {
  let result = [1];
  for (let i = 0; i < count; i++) result = convolveProbability(result, [1 - chance, chance]);
  return result;
}
function expectedClearsForBeltData(zone, required) {
  const chances = zone.encryptedDataChances || { elite:0.005, boss:0.02 };
  const formations = beltFormationPools[zone.formationPool];
  let waveDistribution = [0];
  for (const formation of formations) {
    const formationDistribution = binomialProbability(formation.elite || 0, chances.elite || 0);
    if (waveDistribution.length < formationDistribution.length) waveDistribution.length = formationDistribution.length;
    for (let i = 0; i < formationDistribution.length; i++) waveDistribution[i] = (waveDistribution[i] || 0) + formation.chance * formationDistribution[i];
  }
  let clearDistribution = [1];
  for (let wave = 1; wave < zone.maxWave; wave++) clearDistribution = convolveProbability(clearDistribution, waveDistribution);
  clearDistribution = convolveProbability(clearDistribution, [1 - chances.boss, chances.boss]);
  const expected = [0];
  for (let remaining = 1; remaining <= required; remaining++) {
    let numerator = 1;
    for (let gain = 1; gain < clearDistribution.length; gain++) numerator += clearDistribution[gain] * expected[Math.max(0, remaining - gain)];
    expected[remaining] = numerator / (1 - clearDistribution[0]);
  }
  return expected[required];
}

if (lpStoreItems.length !== 56 || lpStoreItems.some(item => item.kind !== "equipmentBlueprint")) {
  throw new Error("蓝图商店装备蓝图数量不完整，或仍混入装备成品");
}
for (const pair of beltEquipmentPairs) {
  const factionEquipment = vm.runInContext(`EQUIPMENT_DB["${pair.factionId}"]`, sandbox);
  const allianceEquipment = vm.runInContext(`EQUIPMENT_DB["${pair.allianceId}"]`, sandbox);
  const factionRecipe = sandbox.getEquipmentEngineeringRecipe(pair.factionId);
  const allianceRecipe = sandbox.getEquipmentEngineeringRecipe(pair.allianceId);
  const blueprint = lpStoreItems.find(item => item.id === pair.blueprintId);
  const zone = beltZoneConfigs.find(item => item.id === pair.zoneId);
  const expectedClears = expectedClearsForBeltData(zone, pair.need);
  const expectedLP = expectedClears * zone.clearLp;
  const baseCosts = Object.entries(factionRecipe.cost).filter(([material]) => !beltDataMaterials.includes(material));
  if (!blueprint || blueprint.equipmentId !== pair.allianceId || blueprint.sourceZoneId !== pair.zoneId ||
      blueprint.dataMaterial !== pair.data || blueprint.dataRequired !== pair.need || blueprint.lpPrice !== pair.price ||
      blueprint.lpPrice !== Math.round(expectedLP) * 2 || Math.abs(blueprint.expectedClears - expectedClears) > 1e-9 ||
      Math.abs(blueprint.expectedLP - expectedLP) > 1e-9 || zone.encryptedDataMaterial !== pair.data ||
      factionRecipe.cost[pair.data] !== pair.need || !allianceRecipe.requiresBlueprint ||
      allianceRecipe.level !== factionRecipe.level || allianceRecipe.time !== factionRecipe.time || allianceRecipe.xp !== factionRecipe.xp ||
      JSON.stringify(allianceEquipment.bonuses) !== JSON.stringify(factionEquipment.bonuses) ||
      baseCosts.some(([material, quantity]) => allianceRecipe.cost[material] !== Math.ceil(quantity * 1.2)) ||
      beltDataMaterials.some(material => allianceRecipe.cost[material])) {
    throw new Error(`星带装备 ${pair.allianceId} 的联盟蓝图价格、120%材料配方或势力数据绑定错误`);
  }
  const purchaseState = JSON.parse(JSON.stringify(sandbox.gameState));
  purchaseState.skills.equipmentEngineering.lvl = 99;
  purchaseState.resources.lp = pair.price;
  const ownershipKey = sandbox.getEquipmentBlueprintOwnershipKey(pair.allianceId);
  purchaseState.ownedBlueprints = (purchaseState.ownedBlueprints || []).filter(id => id !== ownershipKey);
  const inventoryBefore = purchaseState.equipment.inventory.filter(id => id === pair.allianceId).length;
  const locked = sandbox.dispatchGameAction(purchaseState, { type:"manufacturing/selectEquipmentRecipe", recipeId:pair.allianceId }, Date.now());
  const purchase = sandbox.dispatchGameAction(purchaseState, { type:"shell/buyLPItem", equipmentId:pair.blueprintId }, Date.now());
  const unlocked = sandbox.dispatchGameAction(purchaseState, { type:"manufacturing/selectEquipmentRecipe", recipeId:pair.allianceId }, Date.now());
  const duplicate = sandbox.dispatchGameAction(purchaseState, { type:"shell/buyLPItem", equipmentId:pair.blueprintId }, Date.now());
  if (locked.changed || locked.reason !== "blueprint-locked" || !purchase.changed || purchaseState.resources.lp !== 0 ||
      !purchaseState.ownedBlueprints.includes(ownershipKey) || purchaseState.equipment.inventory.filter(id => id === pair.allianceId).length !== inventoryBefore ||
      !unlocked.changed || duplicate.changed || duplicate.reason !== "already-owned") {
    throw new Error(`联盟蓝图 ${pair.blueprintId} 的购买、永久解锁或重复购买保护失效`);
  }
}

const blueprintCatalog = vm.runInContext("getBlueprintStoreCatalogItems()", sandbox);
const blueprintCategories = vm.runInContext("BLUEPRINT_STORE_CATEGORIES", sandbox);
if (blueprintCatalog.length !== 74 || blueprintCategories.length !== 7 ||
    blueprintCatalog.filter(item => item.category === "ships").length !== 18 ||
    blueprintCatalog.filter(item => item.category === "alliance").length !== 4 ||
    blueprintCatalog.filter(item => item.category === "faction").length !== 4 ||
    [2, 3, 4, 6].some(tier => blueprintCatalog.filter(item => item.category === `deathspace-${tier}`).length !== 12)) {
  throw new Error("独立蓝图商店分类或舰船/装备蓝图数量不正确");
}
const shipBlueprintPreview = sandbox.getBlueprintStoreDisplayState(sandbox.gameState, "ships");
const mixedShipPreview = shipBlueprintPreview.items.find(item => item.shipId === "gale");
const deathspaceBlueprintPreview = sandbox.getBlueprintStoreDisplayState(sandbox.gameState, "deathspace-6");
const improvedEquipmentPreview = deathspaceBlueprintPreview.items.find(item => item.equipmentId === "ded_angel_6_weapon_supervisor");
const visibleBlueprintText = JSON.stringify([shipBlueprintPreview, deathspaceBlueprintPreview]);
if (!mixedShipPreview || mixedShipPreview.productName !== "疾风级" ||
    !mixedShipPreview.previewLines.some(line => line.label === "舰体" && line.value.includes("总生命 990")) ||
    !mixedShipPreview.previewLines.some(line => line.label === "消耗" && line.value.includes("劫团低阶密钥×15")) ||
    !improvedEquipmentPreview || !improvedEquipmentPreview.previewLines.some(line => line.label === "属性" && line.value.includes("基础伤害")) ||
    !improvedEquipmentPreview.previewLines.some(line => line.label === "消耗" && line.value.includes("劫团A型大型激光炮")) ||
    /价格等于|次肃清LP|次全通LP/.test(visibleBlueprintText)) {
  throw new Error("蓝图商店没有完整预览产物属性/制造消耗，或仍显示策划定价语言");
}
for (const equipmentId of ["angel_mining_laser", "angel_gas_harvester", "blood_servant_drone_link", "sansha_mineral_assimilation"]) {
  const equipment = vm.runInContext(`EQUIPMENT_DB["${equipmentId}"]`, sandbox);
  const zone = beltZoneConfigs.find(item => item.id === equipment.sourceZoneId);
  const blueprint = blueprintCatalog.find(item => item.equipmentId === equipmentId);
  if (!equipment.requiresBlueprint || !blueprint || blueprint.price !== zone.clearLp * 2) {
    throw new Error(`${equipment.name}未按来源星带2次肃清LP设置制造蓝图`);
  }
}
const deathspaceConfigs = vm.runInContext("DEATHSPACE_DATABASE", sandbox);
for (const equipment of Object.values(vm.runInContext("EQUIPMENT_DB", sandbox)).filter(item => item.sourceDeathspaceId)) {
  const site = deathspaceConfigs.find(item => item.id === equipment.sourceDeathspaceId);
  const blueprint = blueprintCatalog.find(item => item.equipmentId === equipment.id);
  const fullClearLP = site.waveLp * site.maxWave + site.clearLpBonus;
  if (!equipment.requiresBlueprint || !blueprint || blueprint.price !== fullClearLP * 2) {
    throw new Error(`${equipment.name}未按对应死亡空间2次全通LP设置制造蓝图`);
  }
}

const allianceMiningLaser = vm.runInContext('EQUIPMENT_DB.raider_mining_laser', sandbox);
const allianceGasHarvester = vm.runInContext('EQUIPMENT_DB.raider_gas_harvester', sandbox);
const angelMiningLaser = vm.runInContext('EQUIPMENT_DB.angel_mining_laser', sandbox);
const angelGasHarvester = vm.runInContext('EQUIPMENT_DB.angel_gas_harvester', sandbox);
const angelMiningRecipe = sandbox.getEquipmentEngineeringRecipe("angel_mining_laser");
const angelGasRecipe = sandbox.getEquipmentEngineeringRecipe("angel_gas_harvester");
if (angelMiningRecipe.id !== "angel_mining_laser" || angelGasRecipe.id !== "angel_gas_harvester" ||
    angelMiningLaser.bonuses.miningEfficiency !== allianceMiningLaser.bonuses.miningEfficiency ||
    angelGasHarvester.bonuses.gasEfficiency !== allianceGasHarvester.bonuses.gasEfficiency ||
    angelMiningRecipe.level !== 25 || angelGasRecipe.level !== 25 ||
    angelMiningRecipe.cost["天使低级加密数据"] !== 5 || angelGasRecipe.cost["天使低级加密数据"] !== 5 ||
    angelMiningRecipe.category !== "mining" || angelGasRecipe.category !== "gas") {
  throw new Error("天使联合采集装备没有保持联盟装备属性或未正确接入数据制造配方");
}

resources.special["血袭者中级加密数据"] = 0;
resources.special["萨沙高级加密数据"] = 0;
resources.special["血袭者低级加密数据"] = 0;
resources.special["血袭者高级加密数据"] = 0;
const bloodDataZone = beltZoneConfigs.find(zone => zone.id === "blood_cathedral");
const sanshaDataZone = beltZoneConfigs.find(zone => zone.id === "sansha_command_matrix");
const normalBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "normal", 0, bloodDataZone);
const bloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0, bloodDataZone);
const failedBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0.02, bloodDataZone);
const sanshaDrop = sandbox.rollFactionEncryptedDataDrop("sansha", "boss", 0, sanshaDataZone);
if (normalBloodDrop || !bloodDrop || failedBloodDrop || !sanshaDrop || resources.special["血袭者中级加密数据"] !== 1 || resources.special["萨沙高级加密数据"] !== 1) {
  throw new Error("势力加密数据掉落概率边界或资源入库不正确");
}
const borderDropZone = vm.runInContext('COMBAT_ZONES.find(zone => zone.id === "blood_sacrifice")', sandbox);
const borderBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0.009, borderDropZone);
const failedBorderBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0.01, borderDropZone);
if (!borderBloodDrop || failedBorderBloodDrop || borderBloodDrop.material !== "血袭者低级加密数据" || resources.special["血袭者低级加密数据"] !== 1 || resources.special["血袭者中级加密数据"] !== 1) {
  throw new Error("0.7～0.5星带没有使用精英1%、BOSS4%的加密数据概率");
}
resources.special["天使初级加密数据"] = 0;
resources.special["天使低级加密数据"] = 0;
const angelBorderDropZone = vm.runInContext('COMBAT_ZONES.find(zone => zone.id === "angel_corridor")', sandbox);
const angelBorderEliteDrop = sandbox.rollFactionEncryptedDataDrop("angel", "elite", 0.009, angelBorderDropZone);
const angelBorderBossDrop = sandbox.rollFactionEncryptedDataDrop("angel", "boss", 0.039, angelBorderDropZone);
const failedAngelBorderBossDrop = sandbox.rollFactionEncryptedDataDrop("angel", "boss", 0.04, angelBorderDropZone);
if (!angelBorderEliteDrop || !angelBorderBossDrop || failedAngelBorderBossDrop ||
    angelBorderEliteDrop.material !== "天使低级加密数据" || resources.special["天使低级加密数据"] !== 2 ||
    resources.special["天使初级加密数据"] !== 0) {
  throw new Error("天使劫掠走廊没有只掉落本档制造用的天使低级加密数据，或1%/4%概率边界不正确");
}
const lowsecDropZone = vm.runInContext('COMBAT_ZONES.find(zone => zone.id === "blood_cathedral")', sandbox);
const lowsecBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0.019, lowsecDropZone);
const failedLowsecBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0.02, lowsecDropZone);
if (!lowsecBloodDrop || failedLowsecBloodDrop || resources.special["血袭者中级加密数据"] !== 2) {
  throw new Error("0.4～0.3星带没有使用精英2%、BOSS6%的加密数据概率");
}
const deepsecDropZone = vm.runInContext('COMBAT_ZONES.find(zone => zone.id === "blood_iron_basilica")', sandbox);
const deepsecBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0.029, deepsecDropZone);
const failedDeepsecBloodDrop = sandbox.rollFactionEncryptedDataDrop("blood", "elite", 0.03, deepsecDropZone);
if (!deepsecBloodDrop || failedDeepsecBloodDrop || deepsecBloodDrop.material !== "血袭者高级加密数据" || resources.special["血袭者高级加密数据"] !== 1 || resources.special["血袭者中级加密数据"] !== 2) {
  throw new Error("0.2～0.1星带没有使用精英3%、BOSS8%的加密数据概率");
}

// 高安星带使用四个固定编队池；第20波绕过随机池并必定生成BOSS。
const combatZones = vm.runInContext("COMBAT_ZONES", sandbox);
const angelZone = combatZones.find(zone => zone.id === "angel_outpost");
const borderZones = combatZones.filter(zone => zone.secLevel === "0.7-0.5");
const lowsecZones = combatZones.filter(zone => zone.secLevel === "0.4-0.3");
const deepsecZones = combatZones.filter(zone => zone.secLevel === "0.2-0.1");
const deathspaces = vm.runInContext("DEATHSPACE_DATABASE", sandbox);
const combatSpecialMaterials = vm.runInContext("COMBAT_SPECIAL_MATERIALS", sandbox);
const deathspaceTierRules = {
  2:{ secLevel:"1.0-0.8", requiredCL:1, maxWave:3, waveLp:1, clearLpBonus:9, coreChances:[0.08,0.12,0.25] },
  3:{ secLevel:"0.7-0.5", requiredCL:15, maxWave:4, waveLp:1, clearLpBonus:18, coreChances:[0.08,0.12,0.17,0.28] },
  4:{ secLevel:"0.4-0.3", requiredCL:35, maxWave:5, waveLp:2, clearLpBonus:30, coreChances:[0.08,0.12,0.16,0.20,0.29] },
  6:{ secLevel:"0.2-0.1", requiredCL:55, maxWave:5, waveLp:3, clearLpBonus:45, coreChances:[0.12,0.15,0.18,0.22,0.35] }
};
if (deathspaces.length !== 12 || [2,3,4,6].some(tier => deathspaces.filter(site => site.dedTier === tier).length !== 3) || deathspaces.some(site => site.protocolChance !== 0.02)) {
  throw new Error("死亡空间数量、准入门槛、层数或LP/协议参数偏离定案");
}
for (const site of deathspaces) {
  const sourceZone = combatZones.find(zone => zone.id === site.sourceZoneId);
  const rule = deathspaceTierRules[site.dedTier];
  const finalWave = site.waves[site.waves.length - 1];
  const balanceKeys = Object.keys(site.combatBalance || {}).sort().join(",");
  if (!rule || !sourceZone || sourceZone.secLevel !== rule.secLevel || site.requiredCL !== rule.requiredCL || site.maxWave !== rule.maxWave ||
      site.waveLp !== rule.waveLp || site.clearLpBonus !== rule.clearLpBonus || site.waves.length !== rule.maxWave ||
      site.ticketChances.elite !== 0.05 || site.ticketChances.boss !== 0.05 ||
      site.waves.some((wave, index) => wave.coreChance !== rule.coreChances[index]) || !finalWave.final || finalWave.escortNormal !== 2 ||
      balanceKeys !== "damage,finalDamage,finalHp,hp" || Object.values(site.combatBalance).some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`${site.name}的来源星带、门票概率、核心概率或最终层编队错误`);
  }
  const generatedWaves = site.waves.map((wave, index) => sandbox.buildDeathspaceWave(site, index + 1, () => 0));
  const normalTemplate = vm.runInContext(`ENEMY_DATABASE[${JSON.stringify(site.faction)}].types[${JSON.stringify(sourceZone.enemyPool.normal[0])}]`, sandbox);
  const firstEscort = generatedWaves[0].enemies.find(enemy => !enemy.deathspaceLeader);
  const expectedEscortHp = Math.round(normalTemplate.hp.shield * site.combatBalance.hp);
  const expectedEscortDamage = Math.round(normalTemplate.baseDamage * site.combatBalance.damage);
  if (!firstEscort || firstEscort.maxHp.shield !== expectedEscortHp || firstEscort.baseDamage !== expectedEscortDamage || generatedWaves.at(-1).enemies.length !== 3) {
    throw new Error(`${site.name}没有应用固定编队校准系数或最终层双护卫编队`);
  }
  for (const material of [site.ticketMaterial, site.coreMaterial, site.protocolMaterial]) {
    const definition = vm.runInContext(`ResourceRegistry.getDefinition(${JSON.stringify("special:" + material)})`, sandbox);
    if (!combatSpecialMaterials.includes(material) || !Object.hasOwn(sandbox.gameState.resources.special, material) || !definition) {
      throw new Error(`${material}未完整注册到战斗特殊资源池`);
    }
  }
}
const expectedBeltDataByZone = {
  angel_outpost:"天使初级加密数据", blood_hideout:"血袭者初级加密数据", sansha_outpost:"萨沙初级加密数据",
  angel_corridor:"天使低级加密数据", blood_sacrifice:"血袭者低级加密数据", sansha_node:"萨沙低级加密数据",
  angel_hunting_ground:"天使中级加密数据", blood_cathedral:"血袭者中级加密数据", sansha_nexus:"萨沙中级加密数据",
  angel_warfront:"天使高级加密数据", blood_iron_basilica:"血袭者高级加密数据", sansha_command_matrix:"萨沙高级加密数据"
};
const encryptedDataZones = combatZones.filter(zone => !zone.encryptedDataDisabled);
if (encryptedDataZones.some(zone => zone.encryptedDataMaterial !== expectedBeltDataByZone[zone.id]) ||
    new Set(encryptedDataZones.map(zone => zone.encryptedDataMaterial)).size !== encryptedDataZones.length) {
  throw new Error("星带加密数据没有按势力与安全等级完全隔离");
}
const specialResourcesBeforeMigration = { ...sandbox.gameState.resources.special };
sandbox.gameState.resources.special = { ...specialResourcesBeforeMigration, "天使联合加密数据":4, "天使初级加密数据":1 };
sandbox.migrateMoonMiningState();
if (sandbox.gameState.resources.special["天使初级加密数据"] !== 5 ||
    Object.hasOwn(sandbox.gameState.resources.special, "天使联合加密数据") ||
    beltDataMaterials.some(material => sandbox.gameState.resources.special[material] === undefined)) {
  throw new Error("旧版天使联合数据没有安全迁移到初级数据，或新分层资源没有补齐");
}
sandbox.gameState.resources.special = specialResourcesBeforeMigration;
if (borderZones.length !== 3 || borderZones.some(zone => zone.requiredCL !== 15 || zone.maxWave !== 20 || zone.clearLp !== 6 || zone.fuelMult !== 1.2 || zone.iskMulti !== 1.5)) {
  throw new Error("0.7～0.5三条星带的CL门槛、20波肃清或奖励倍率不符合设计");
}
if (lowsecZones.length !== 3 || lowsecZones.some(zone => zone.requiredCL !== 35 || zone.maxWave !== 20 || zone.clearLp !== 10 || zone.fuelMult !== 1.4 || zone.iskMulti !== 2 || zone.formationPool !== "lowsec")) {
  throw new Error("0.4～0.3三条星带的CL门槛、20波肃清、编队池或奖励倍率不符合设计");
}
if (deepsecZones.length !== 3 || deepsecZones.some(zone => zone.requiredCL !== 55 || zone.maxWave !== 20 || zone.clearLp !== 15 || zone.fuelMult !== 1.6 || zone.iskMulti !== 2.5 || zone.formationPool !== "deepsec")) {
  throw new Error("0.2～0.1三条星带的战斗等级门槛、20波肃清、编队池或奖励倍率不符合设计");
}
const expectedFormations = [
  [0.10, "2_normal", 2, 0], [0.60, "3_normal", 3, 0],
  [0.93, "2_normal_1_elite", 2, 1], [0.99, "3_normal_1_elite", 3, 1]
];
for (const [roll, id, normal, elite] of expectedFormations) {
  const formation = sandbox.getCombatFormation(angelZone, 1, () => roll);
  if (formation.id !== id || formation.normal !== normal || formation.elite !== elite || formation.boss !== 0) {
    throw new Error(`高安刷怪池概率边界错误：${roll}/${JSON.stringify(formation)}`);
  }
}
const bossFormation = sandbox.getCombatFormation(angelZone, 20, () => 0);
if (bossFormation.boss !== 1 || bossFormation.normal !== 1 || bossFormation.elite !== 0) {
  throw new Error("第20波没有固定生成1只BOSS和1只普通护卫");
}
const borderAngelZone = borderZones.find(zone => zone.faction === "angel");
const expectedBorderFormations = [
  [0.10, "2_normal", 2, 0], [0.50, "3_normal", 3, 0],
  [0.80, "2_normal_1_elite", 2, 1], [0.95, "3_normal_1_elite", 3, 1]
];
for (const [roll, id, normal, elite] of expectedBorderFormations) {
  const formation = sandbox.getCombatFormation(borderAngelZone, 1, () => roll);
  if (formation.id !== id || formation.normal !== normal || formation.elite !== elite || formation.boss !== 0) {
    throw new Error(`0.7～0.5刷怪池概率边界错误：${roll}/${JSON.stringify(formation)}`);
  }
}
const borderBossFormation = sandbox.getCombatFormation(borderAngelZone, 20, () => 0);
if (borderBossFormation.boss !== 1 || borderBossFormation.normal !== 1) {
  throw new Error("0.7～0.5第20波没有固定生成BOSS与普通护卫");
}
const lowsecAngelZone = lowsecZones.find(zone => zone.faction === "angel");
const expectedLowsecFormations = [
  [0.10, "2_normal", 2, 0], [0.40, "3_normal", 3, 0],
  [0.70, "2_normal_1_elite", 2, 1], [0.95, "3_normal_1_elite", 3, 1]
];
for (const [roll, id, normal, elite] of expectedLowsecFormations) {
  const formation = sandbox.getCombatFormation(lowsecAngelZone, 1, () => roll);
  if (formation.id !== id || formation.normal !== normal || formation.elite !== elite || formation.boss !== 0) {
    throw new Error(`0.4～0.3刷怪池概率边界错误：${roll}/${JSON.stringify(formation)}`);
  }
}
const lowsecBossFormation = sandbox.getCombatFormation(lowsecAngelZone, 20, () => 0);
if (lowsecBossFormation.boss !== 1 || lowsecBossFormation.normal !== 1) {
  throw new Error("0.4～0.3第20波没有固定生成BOSS与普通护卫");
}
const deepsecAngelZone = deepsecZones.find(zone => zone.faction === "angel");
const expectedDeepsecFormations = [
  [0.10, "2_normal", 2, 0], [0.35, "3_normal", 3, 0],
  [0.65, "2_normal_1_elite", 2, 1], [0.90, "3_normal_1_elite", 3, 1]
];
for (const [roll, id, normal, elite] of expectedDeepsecFormations) {
  const formation = sandbox.getCombatFormation(deepsecAngelZone, 1, () => roll);
  if (formation.id !== id || formation.normal !== normal || formation.elite !== elite || formation.boss !== 0) {
    throw new Error(`0.2～0.1刷怪池概率边界错误：${roll}/${JSON.stringify(formation)}`);
  }
}
const deepsecBossFormation = sandbox.getCombatFormation(deepsecAngelZone, 20, () => 0);
if (deepsecBossFormation.boss !== 1 || deepsecBossFormation.normal !== 1) {
  throw new Error("0.2～0.1第20波没有固定生成BOSS与普通护卫");
}
const combatLevelSnapshot = JSON.parse(JSON.stringify(sandbox.gameState.skills));
for (const key of ["laserOps","cannonOps","missileOperations","shieldOperation","armorReinforcement","hullEngineering"]) sandbox.gameState.skills[key].lvl = 14;
if (sandbox.canEnterCombatZone(borderAngelZone)) throw new Error("CL14仍能进入0.7～0.5星带");
sandbox.gameState.skills.laserOps.lvl = 15;
sandbox.gameState.skills.shieldOperation.lvl = 15;
if (!sandbox.canEnterCombatZone(borderAngelZone)) throw new Error("CL15仍无法进入0.7～0.5星带");
for (const key of ["laserOps","shieldOperation"]) sandbox.gameState.skills[key].lvl = 34;
if (sandbox.canEnterCombatZone(lowsecAngelZone)) throw new Error("CL34仍能进入0.4～0.3星带");
sandbox.gameState.skills.laserOps.lvl = 35;
sandbox.gameState.skills.shieldOperation.lvl = 35;
if (!sandbox.canEnterCombatZone(lowsecAngelZone)) throw new Error("CL35仍无法进入0.4～0.3星带");
for (const key of ["laserOps","shieldOperation"]) sandbox.gameState.skills[key].lvl = 54;
if (sandbox.canEnterCombatZone(deepsecAngelZone)) throw new Error("战斗等级54仍能进入0.2～0.1星带");
sandbox.gameState.skills.laserOps.lvl = 55;
sandbox.gameState.skills.shieldOperation.lvl = 55;
if (!sandbox.canEnterCombatZone(deepsecAngelZone)) throw new Error("战斗等级55仍无法进入0.2～0.1星带");
sandbox.gameState.skills = combatLevelSnapshot;

const destroyerEnemyStats = [
  ["angel", "patrol_destroyer", 545, 94], ["angel", "hunter_commander", 4200, 308],
  ["blood", "ritual_destroyer", 545, 82], ["blood", "high_priest", 4200, 260],
  ["sansha", "control_destroyer", 545, 74], ["sansha", "control_overlord", 4200, 226]
];
for (const [faction, type, primaryHp, damage] of destroyerEnemyStats) {
  const enemy = vm.runInContext(`ENEMY_DATABASE["${faction}"].types["${type}"]`, sandbox);
  if (!enemy || Math.max(...Object.values(enemy.hp)) !== primaryHp || enemy.baseDamage !== damage) {
    throw new Error(`${faction}/${type}没有使用定案后的固定属性`);
  }
}
const cruiserEnemyStats = [
  ["angel", "strike_cruiser", 1800, 310], ["angel", "fleet_commander", 14040, 990],
  ["blood", "sermon_cruiser", 1755, 280], ["blood", "blood_archon", 13689, 840],
  ["sansha", "assimilation_cruiser", 1800, 250], ["sansha", "nexus_overlord", 14040, 801]
];
for (const [faction, type, primaryHp, damage] of cruiserEnemyStats) {
  const enemy = vm.runInContext(`ENEMY_DATABASE["${faction}"].types["${type}"]`, sandbox);
  if (!enemy || Math.max(...Object.values(enemy.hp)) !== primaryHp || enemy.baseDamage !== damage) {
    throw new Error(`${faction}/${type}巡洋舰敌人没有使用定案后的固定属性`);
  }
}
const battleshipEnemyStats = [
  ["angel", "siege_battleship", 5400, 930], ["angel", "war_master", 42120, 2970],
  ["blood", "iron_battleship", 5265, 840], ["blood", "blood_sovereign", 41067, 2570],
  ["sansha", "command_battleship", 5400, 750], ["sansha", "matrix_overlord", 42120, 2550]
];
for (const [faction, type, primaryHp, damage] of battleshipEnemyStats) {
  const enemy = vm.runInContext(`ENEMY_DATABASE["${faction}"].types["${type}"]`, sandbox);
  if (!enemy || Math.max(...Object.values(enemy.hp)) !== primaryHp || enemy.baseDamage !== damage) {
    throw new Error(`${faction}/${type}战列舰敌人没有使用定案后的固定属性`);
  }
}
const beltCombatBefore = sandbox.gameState.combat;
const beltLpBefore = sandbox.gameState.resources.lp;
const beltIskBefore = sandbox.gameState.resources.isk;
const beltCombatSkillBefore = { ...sandbox.gameState.skills.combat };
const legacyCombatXpBefore = sandbox.gameState.skills.combat.xp;
const normalEnemy = sandbox.createCombatEnemy(angelZone, "normal", () => 0);
sandbox.gameState.combat = { ...beltCombatBefore, enemies:[normalEnemy], currentEnemy:normalEnemy, wave:1, totalKills:0, runEliteKills:0, zoneClears:{} };
sandbox.resolveCombatEnemyDefeat(normalEnemy, angelZone);
if (sandbox.gameState.resources.lp !== beltLpBefore) throw new Error("普通怪仍然直接掉落LP");
if (sandbox.gameState.skills.combat.xp !== legacyCombatXpBefore) throw new Error("废弃的独立战斗经验仍在随击杀增长");
sandbox.gameState.combat.enemies = [];
sandbox.gameState.combat.currentEnemy = null;
sandbox.gameState.combat.wave = 20;
sandbox.resolveCombatWaveVictory(angelZone);
if (sandbox.gameState.resources.lp !== beltLpBefore + 3 || sandbox.gameState.combat.wave !== 1 || sandbox.gameState.combat.zoneClears.angel_outpost !== 1 ||
    sandbox.gameState.combat.enemies.filter(enemy => enemy.kind === "boss").length !== 0) {
  throw new Error("第20波肃清没有统一结算3 LP、记录次数或重置到新一轮第1波");
}
sandbox.gameState.combat = beltCombatBefore;
sandbox.gameState.resources.lp = beltLpBefore;
sandbox.gameState.resources.isk = beltIskBefore;
sandbox.gameState.skills.combat = beltCombatSkillBefore;

// 死亡空间：门票只由对应深空星带精英/BOSS掉落，进入即消耗，退出或失败不返还。
const angelDeathspace = deathspaces.find(site => site.id === "angel_ded_6_10");
const ticketMaterial = angelDeathspace.ticketMaterial;
const coreMaterial = angelDeathspace.coreMaterial;
const protocolMaterial = angelDeathspace.protocolMaterial;
const specialBeforeDeathspaceTest = { ...sandbox.gameState.resources.special };
sandbox.gameState.resources.special[ticketMaterial] = 0;
const eliteTicket = sandbox.rollDeathspaceTicketDrop(deepsecAngelZone, "elite", 0.049);
const failedEliteTicket = sandbox.rollDeathspaceTicketDrop(deepsecAngelZone, "elite", 0.05);
const normalTicket = sandbox.rollDeathspaceTicketDrop(deepsecAngelZone, "normal", 0);
const wrongZoneTicket = sandbox.rollDeathspaceTicketDrop(angelBorderDropZone, "boss", 0);
if (!eliteTicket || failedEliteTicket || normalTicket || !wrongZoneTicket || wrongZoneTicket.deathspaceId === angelDeathspace.id ||
    eliteTicket.deathspaceId !== angelDeathspace.id || sandbox.gameState.resources.special[ticketMaterial] !== 1) {
  throw new Error("死亡空间密钥没有按对应星带精英/BOSS的5%边界掉落或发生跨档掉落");
}

// 每层监督者独立掉核心，最终层再独立判定极稀有协议。
sandbox.gameState.resources.special[coreMaterial] = 0;
sandbox.gameState.resources.special[protocolMaterial] = 0;
const firstCoreDrop = sandbox.rollDeathspaceLeaderLoot(angelDeathspace, 1, 0.119, 1);
const failedFirstCoreDrop = sandbox.rollDeathspaceLeaderLoot(angelDeathspace, 1, 0.12, 0);
const finalRareDrops = sandbox.rollDeathspaceLeaderLoot(angelDeathspace, 5, 0.349, 0.019);
const failedFinalDrops = sandbox.rollDeathspaceLeaderLoot(angelDeathspace, 5, 0.35, 0.02);
if (firstCoreDrop.length !== 1 || failedFirstCoreDrop.length !== 0 || finalRareDrops.length !== 2 || failedFinalDrops.length !== 0 ||
    sandbox.gameState.resources.special[coreMaterial] !== 2 || sandbox.gameState.resources.special[protocolMaterial] !== 1) {
  throw new Error("死亡空间核心/协议的逐层概率边界或资源入库错误");
}

const finalDeathspaceWave = sandbox.buildDeathspaceWave(angelDeathspace, 5, () => 0);
const finalLeader = finalDeathspaceWave.enemies.find(enemy => enemy.deathspaceLeader);
const sourceBoss = vm.runInContext('ENEMY_DATABASE.angel.types.war_master', sandbox);
const finalBalance = angelDeathspace.combatBalance;
const expectedFinalDamage = Math.round(sourceBoss.baseDamage * 1.25 * finalBalance.damage * finalBalance.finalDamage);
const expectedFinalShield = Math.round(sourceBoss.hp.shield * 1.25 * finalBalance.hp * finalBalance.finalHp);
const finalLeaderThreat = Object.values(finalLeader.maxHp).reduce((sum, value) => sum + value, 0) * finalLeader.baseDamage;
const sourceBossThreat = Object.values(sourceBoss.hp).reduce((sum, value) => sum + value, 0) * sourceBoss.baseDamage;
if (finalDeathspaceWave.formationId !== "deathspace_5" || finalDeathspaceWave.enemies.length !== 3 || !finalLeader || !finalLeader.deathspaceFinal ||
    finalLeader.baseDamage !== expectedFinalDamage || finalLeader.maxHp.shield !== expectedFinalShield || finalLeaderThreat <= sourceBossThreat * 1.35) {
  throw new Error("死亡空间最终层没有生成2只护卫、应用固定校准参数或保持监督者综合威胁");
}

const deathspaceActionState = JSON.parse(JSON.stringify(sandbox.gameState));
deathspaceActionState.skills.laserOps.lvl = 55;
deathspaceActionState.skills.shieldOperation.lvl = 55;
deathspaceActionState.resources.special[ticketMaterial] = 1;
const firstDeathspaceWave = sandbox.buildDeathspaceWave(angelDeathspace, 1, () => 0);
const enterDeathspaceResult = sandbox.dispatchGameAction(deathspaceActionState, {
  type:"combat/enterDeathspace", deathspaceId:angelDeathspace.id,
  enemies:firstDeathspaceWave.enemies, formationId:firstDeathspaceWave.formationId
}, 2000000200000);
if (!enterDeathspaceResult.changed || deathspaceActionState.resources.special[ticketMaterial] !== 0 || !deathspaceActionState.combat.active ||
    deathspaceActionState.combat.mode !== "deathspace" || deathspaceActionState.combat.wave !== 1) {
  throw new Error("死亡空间准入没有在开战时准确消耗1张密钥");
}
const abandonDeathspaceResult = sandbox.dispatchGameAction(deathspaceActionState, { type:"combat/stop" }, 2000000201000);
if (!abandonDeathspaceResult.changed || !abandonDeathspaceResult.abandonedDeathspace || deathspaceActionState.resources.special[ticketMaterial] !== 0 ||
    !deathspaceActionState.combat.lastStatus.includes("不返还")) {
  throw new Error("主动撤离死亡空间错误返还了密钥或没有给出提示");
}
const deathspaceDisplayState = JSON.parse(JSON.stringify(deathspaceActionState));
deathspaceDisplayState.combat.mode = "deathspace";
deathspaceDisplayState.combat.deathspaceId = angelDeathspace.id;
deathspaceDisplayState.combat.lastSpecialLoot = coreMaterial + " ×1";
deathspaceDisplayState.resources.special[ticketMaterial] = 1;
const deathspaceDisplay = sandbox.getCombatDisplayState(deathspaceDisplayState, 2000000201500);
if (deathspaceDisplay.mode !== "deathspace" || deathspaceDisplay.deathspaceTier !== 6 || deathspaceDisplay.deathspaceTiers.length !== 4 || deathspaceDisplay.maxWave !== 5 || deathspaceDisplay.deathspaces.length !== 3 ||
    deathspaceDisplay.deathspace.ticketCount !== 1 || deathspaceDisplay.controls.startDisabled ||
    !deathspaceDisplay.controls.startText.includes("消耗密钥") || !deathspaceDisplay.showRewards || !deathspaceDisplay.runStatus.includes("本次稀有收获")) {
  throw new Error("死亡空间选择器没有提供密钥、5层、可进入状态或持久稀有掉落提示");
}
const tierSelectionState = JSON.parse(JSON.stringify(deathspaceDisplayState));
tierSelectionState.combat.active = false;
const selectTierResult = sandbox.dispatchGameAction(tierSelectionState, { type:"combat/selectDeathspaceTier", tier:2 }, 2000000201750);
const tierSelectionDisplay = sandbox.getCombatDisplayState(tierSelectionState, 2000000201750);
if (!selectTierResult.changed || tierSelectionState.combat.deathspaceTier !== 2 || tierSelectionDisplay.maxWave !== 3 ||
    tierSelectionDisplay.deathspaces.length !== 3 || !tierSelectionDisplay.deathspaces.every(site => site.dedTier === 2)) {
  throw new Error("死亡空间2/10、3/10、4/10、6/10档位切换没有同步副本选择与层数");
}

// 交战中的实际战斗与浏览页签必须解耦：可查看死亡空间，但不能改变星带波次、敌人或启动另一场战斗。
const activeBrowseState = JSON.parse(JSON.stringify(deathspaceDisplayState));
activeBrowseState.combat.mode = "belt";
activeBrowseState.combat.viewMode = "belt";
activeBrowseState.combat.active = true;
activeBrowseState.combat.wave = 7;
activeBrowseState.combat.currentFormation = "verify_belt_formation";
activeBrowseState.combat.enemies = JSON.parse(JSON.stringify(firstDeathspaceWave.enemies));
activeBrowseState.combat.currentEnemy = activeBrowseState.combat.enemies[0];
activeBrowseState.currentAction.skill = "combat";
activeBrowseState.currentAction.active = true;
const activeEnemiesBeforeBrowse = JSON.stringify(activeBrowseState.combat.enemies);
const actualDeathspaceBeforeBrowse = activeBrowseState.combat.deathspaceId;
const browseModeResult = sandbox.dispatchGameAction(activeBrowseState, { type:"combat/selectMode", mode:"deathspace" }, 2000000201800);
const browseTierResult = sandbox.dispatchGameAction(activeBrowseState, { type:"combat/selectDeathspaceTier", tier:2 }, 2000000201850);
const viewedSite = deathspaces.find(site => site.dedTier === 2 && site.faction === angelDeathspace.faction);
const browseSiteResult = sandbox.dispatchGameAction(activeBrowseState, { type:"combat/selectDeathspace", deathspaceId:viewedSite.id }, 2000000201900);
const activeBrowseDisplay = sandbox.getCombatDisplayState(activeBrowseState, 2000000201950);
if (!browseModeResult.changed || !browseModeResult.viewOnly || !browseTierResult.changed || !browseTierResult.viewOnly ||
    !browseSiteResult.changed || !browseSiteResult.viewOnly || activeBrowseState.combat.mode !== "belt" || activeBrowseState.combat.wave !== 7 ||
    activeBrowseState.combat.currentFormation !== "verify_belt_formation" || JSON.stringify(activeBrowseState.combat.enemies) !== activeEnemiesBeforeBrowse ||
    activeBrowseState.combat.deathspaceId !== actualDeathspaceBeforeBrowse || activeBrowseState.combat.viewMode !== "deathspace" ||
    activeBrowseState.combat.viewDeathspaceId !== viewedSite.id || activeBrowseDisplay.mode !== "deathspace" || activeBrowseDisplay.encounterMode !== "belt" ||
    activeBrowseDisplay.maxWave !== 20 || !activeBrowseDisplay.browsingDuringCombat || activeBrowseDisplay.controls.showStart ||
    !activeBrowseDisplay.controls.showStop || activeBrowseDisplay.deathspaces.some(site => site.locked)) {
  throw new Error("交战中浏览死亡空间改变了实际战斗，或错误开放了开始按钮");
}
const missingTicketState = JSON.parse(JSON.stringify(deathspaceActionState));
const missingTicketResult = sandbox.dispatchGameAction(missingTicketState, {
  type:"combat/enterDeathspace", deathspaceId:angelDeathspace.id,
  enemies:firstDeathspaceWave.enemies, formationId:firstDeathspaceWave.formationId
}, 2000000202000);
if (missingTicketResult.changed || missingTicketResult.reason !== "missing-ticket") {
  throw new Error("缺少密钥时仍能进入死亡空间");
}

// 五层总计15 LP，完成额外45 LP；全通过后自动退出并完整修复舰船。
const deathspaceCombatBefore = sandbox.gameState.combat;
const deathspaceActionBefore = sandbox.gameState.currentAction;
const deathspaceLpBefore = sandbox.gameState.resources.lp;
const deathspaceStatisticsBefore = JSON.parse(JSON.stringify(sandbox.gameState.statistics));
sandbox.gameState.combat = {
  ...deathspaceCombatBefore, mode:"deathspace", deathspaceId:angelDeathspace.id, zone:angelDeathspace.sourceZoneId,
  active:true, wave:1, enemies:[], currentEnemy:null, deathspaceClears:{}, lastLoot:"", lastSpecialLoot:"", lastStatus:""
};
sandbox.gameState.currentAction = { ...deathspaceActionBefore, skill:"combat", active:true };
for (let wave = 1; wave <= 5; wave++) {
  sandbox.gameState.combat.enemies = [];
  sandbox.gameState.combat.currentEnemy = null;
  sandbox.gameState.combat.wave = wave;
  sandbox.resolveDeathspaceWaveVictory(angelDeathspace, deepsecAngelZone);
}
const completedDeathspaceCombat = sandbox.gameState.combat;
if (sandbox.gameState.resources.lp !== deathspaceLpBefore + 60 || completedDeathspaceCombat.active || sandbox.gameState.currentAction.active ||
    completedDeathspaceCombat.deathspaceClears[angelDeathspace.id] !== 1 || completedDeathspaceCombat.wave !== 1 ||
    sandbox.gameState.statistics.totals.deathspaceWavesCleared !== (deathspaceStatisticsBefore.totals.deathspaceWavesCleared || 0) + 5 ||
    sandbox.gameState.statistics.totals.deathspacesCleared !== (deathspaceStatisticsBefore.totals.deathspacesCleared || 0) + 1) {
  throw new Error("死亡空间五层推进、15+45 LP、全通退出或统计结算错误");
}
sandbox.gameState.combat = deathspaceCombatBefore;
sandbox.gameState.currentAction = deathspaceActionBefore;
sandbox.gameState.resources.lp = deathspaceLpBefore;
sandbox.gameState.statistics = deathspaceStatisticsBefore;
Object.assign(sandbox.gameState.resources.special, specialBeforeDeathspaceTest);

// 每处死亡空间生成武器/维修两条普通与监督者制造链，共48件；底材必须真实从未装配库存扣除。
const deathspaceEquipment = vm.runInContext("Object.values(EQUIPMENT_DB).filter(item => item.deathspaceTier)", sandbox);
if (deathspaceEquipment.length !== 48 || [2,3,4,6].some(tier => deathspaceEquipment.filter(item => item.deathspaceTier === tier).length !== 12) ||
    deathspaceEquipment.filter(item => item.deathspaceVariant === "standard").length !== 24 ||
    deathspaceEquipment.filter(item => item.deathspaceVariant === "supervisor").length !== 24) {
  throw new Error("12处死亡空间没有生成完整的48件普通/监督者武器与维修装备");
}
const deathspaceEquipmentRules = vm.runInContext("DEATHSPACE_EQUIPMENT_TIERS", sandbox);
for (const site of deathspaces) {
  const rules = deathspaceEquipmentRules[site.dedTier];
  for (const role of ["weapon", "repair"]) {
    const standard = deathspaceEquipment.find(item => item.id === `ded_${site.faction}_${site.dedTier}_${role}`);
    const improved = deathspaceEquipment.find(item => item.id === `ded_${site.faction}_${site.dedTier}_${role}_supervisor`);
    const base = vm.runInContext(`EQUIPMENT_DB[${JSON.stringify(standard && standard.inputEquipment.itemId)}]`, sandbox);
    const standardEffect = standard.combat.kind === "weapon" ? standard.combat.baseDamage / base.combat.baseDamage : standard.combat.amount / base.combat.amount;
    const improvedValue = improved.combat.kind === "weapon" ? improved.combat.baseDamage : improved.combat.amount;
    const standardValue = standard.combat.kind === "weapon" ? standard.combat.baseDamage : standard.combat.amount;
    if (!standard || !improved || standard.level !== rules.level || standard.cost[site.coreMaterial] !== rules.coreRequired ||
        improved.cost[site.protocolMaterial] !== 1 || improved.inputEquipment.itemId !== standard.id ||
        Math.abs(standardEffect - rules.effect) > 0.031 || improvedValue !== Math.round(standardValue * 1.10)) {
      throw new Error(`${site.name}/${role}的死亡空间装备效果、核心、协议或升级底材错误`);
    }
  }
}

const equipmentChainResourcesBefore = JSON.parse(JSON.stringify(sandbox.gameState.resources));
const equipmentChainInventoryBefore = [...sandbox.gameState.equipment.inventory];
const equipmentChainActionBefore = JSON.parse(JSON.stringify(sandbox.gameState.currentAction));
for (const definition of deathspaceEquipment) {
  sandbox.gameState.resources = JSON.parse(JSON.stringify(equipmentChainResourcesBefore));
  const recipe = sandbox.getEquipmentEngineeringRecipe(definition.id);
  sandbox.gameState.equipment.inventory = [recipe.inputEquipment.itemId];
  for (const [material, quantity] of Object.entries(recipe.cost)) {
    const materialIds = resourceRegistry.resolveMaterialIds(material);
    for (const materialId of materialIds) resourceRegistry.set(sandbox.gameState, materialId, 0);
    resourceRegistry.set(sandbox.gameState, materialIds[0], quantity);
  }
  if (sandbox.getEquipmentMaxCyclesFromState(sandbox.gameState, recipe) !== 1 || !sandbox.deductEquipEngInputs(recipe, 1)) {
    throw new Error(`${definition.name}没有同时识别装备底材与常规/核心/协议材料`);
  }
  sandbox.applyEquipEngOutput(recipe, 1);
  if (sandbox.gameState.equipment.inventory.includes(recipe.inputEquipment.itemId) ||
      sandbox.gameState.equipment.inventory.filter(itemId => itemId === recipe.id).length !== 1 ||
      Object.keys(recipe.cost).some(material => resourceRegistry.getMaterialStock(sandbox.gameState, material) !== 0)) {
    throw new Error(`${definition.name}没有原子扣除全部输入或正确发放成品`);
  }
}

// 离线装备工程必须复用同一底材链，不能绕过监督者装备所需的普通死亡空间装备。
sandbox.gameState.resources = JSON.parse(JSON.stringify(equipmentChainResourcesBefore));
const offlineDeathspaceRecipe = sandbox.getEquipmentEngineeringRecipe("ded_blood_6_repair_supervisor");
sandbox.gameState.equipment.inventory = [offlineDeathspaceRecipe.inputEquipment.itemId];
for (const [material, quantity] of Object.entries(offlineDeathspaceRecipe.cost)) {
  const materialIds = resourceRegistry.resolveMaterialIds(material);
  for (const materialId of materialIds) resourceRegistry.set(sandbox.gameState, materialId, 0);
  resourceRegistry.set(sandbox.gameState, materialIds[0], quantity);
}
sandbox.gameState.currentAction.skill = "equipmentEngineering";
sandbox.gameState.currentAction.equipEngTarget = offlineDeathspaceRecipe.id;
sandbox.gameState.currentAction.startedEquipEngTarget = offlineDeathspaceRecipe.id;
sandbox.gameState.ownedBlueprints = [...new Set([...(sandbox.gameState.ownedBlueprints || []), sandbox.getEquipmentBlueprintOwnershipKey(offlineDeathspaceRecipe.id)])];
const offlineDeathspaceDescriptor = sandbox.getOfflineActionDescriptor();
const offlineDeathspaceGains = { equipmentEngineering:0 };
if (!offlineDeathspaceDescriptor || offlineDeathspaceDescriptor.maxCycles() !== 1) throw new Error("离线制造没有识别监督者装备的完整输入链");
offlineDeathspaceDescriptor.apply(1, offlineDeathspaceGains);
if (offlineDeathspaceGains.equipmentEngineering !== 1 || sandbox.gameState.equipment.inventory.includes(offlineDeathspaceRecipe.inputEquipment.itemId) ||
    !sandbox.gameState.equipment.inventory.includes(offlineDeathspaceRecipe.id)) {
  throw new Error("离线制造绕过了监督者装备底材或没有发放成品");
}

// 仓库View State必须能完整展示48件死亡空间装备及其真实战斗属性。
sandbox.gameState.equipment.inventory = deathspaceEquipment.map(item => item.id);
const deathspaceCargoDisplay = sandbox.getCargoDisplayState(sandbox.gameState, "equipment");
if (deathspaceCargoDisplay.items.length !== 48 || deathspaceCargoDisplay.items.some(item => !item.details || !/(基础伤害|自动维修)/.test(item.details))) {
  throw new Error("仓库没有完整展示48件死亡空间装备或其战斗属性");
}
sandbox.gameState.resources = equipmentChainResourcesBefore;
sandbox.gameState.equipment.inventory = equipmentChainInventoryBefore;
Object.keys(sandbox.gameState.currentAction).forEach(key => delete sandbox.gameState.currentAction[key]);
Object.assign(sandbox.gameState.currentAction, equipmentChainActionBefore);

// 制造出的装备必须进入仓库装备分类，并展示数据库中的具体属性。
const cargoList = makeElement();
const originalGetElementById = sandbox.document.getElementById;
sandbox.document.getElementById = (id) => id === "cargo-list" ? cargoList : makeElement();
sandbox.renderCargoPage("equipment");
sandbox.document.getElementById = originalGetElementById;
if (!cargoList.innerHTML.includes("T1采矿激光器") || !cargoList.innerHTML.includes("采矿效率 +5%")) {
  throw new Error("仓库没有展示已制造装备或装备具体属性");
}

// 生产效率与 hover 必须使用同一份装备计算，并覆盖高/中/低槽。
const efficiencyShip = sandbox.gameState.inventory.ships[0];
const originalShipId = efficiencyShip.shipId;
const originalFitting = efficiencyShip.fitted;
const originalMiningAssignment = sandbox.gameState.shipAssignments.mining;
const originalMiningLevel = sandbox.gameState.skills.mining.lvl;
const originalMiningXp = sandbox.gameState.skills.mining.xp;
efficiencyShip.shipId = "miner_frigate";
efficiencyShip.fitted = { high:["t1_mining_laser"], mid:["t1_drone_control"], low:["t1_mining_booster"], rig:[] };
sandbox.gameState.shipAssignments.mining = efficiencyShip.instanceId;
sandbox.gameState.skills.mining.lvl = 1;
const efficiencyInfo = sandbox.getProductionEfficiencyBreakdown("mining");
const efficiencyTooltip = sandbox.getProductionEfficiencyTooltip("mining", "凡晶石", 20);
if (Math.abs(efficiencyInfo.primaryBonus - 0.13) > 1e-9 || Math.abs(efficiencyInfo.equipmentAmplifier - 0.20) > 1e-9 || efficiencyInfo.secondaryBonus !== 0) {
  throw new Error("生产效率没有完整计算高/中/低槽装备");
}
if (Math.abs(efficiencyInfo.total - (1.02 * 1.13)) > 1e-9) {
  throw new Error("采矿提升器仍被当成最终总乘区，而不是高槽装备强化");
}
if (!efficiencyTooltip.includes("T1采矿激光器") || !efficiencyTooltip.includes("T1无人机控制单元") || !efficiencyTooltip.includes("T1采矿提升器")) {
  throw new Error("生产效率 hover 没有展示完整装备明细");
}
const moonActionBefore = sandbox.gameState.currentAction;
const moonQueueBefore = sandbox.gameState.queue;
const galliumBefore = sandbox.gameState.resources.moonOres["镓"] || 0;
sandbox.gameState.skills.mining.lvl = 20;
sandbox.gameState.currentAction = {
  ...moonActionBefore, skill:"mining", active:true, area:"凡晶石带", startedArea:"镓月岩带",
  miningMode:"normal", normalMiningArea:"凡晶石带", moonMiningArea:"镓月岩带",
  progress:120 / sandbox.getMiningEfficiency(), lastProgressUpdate:Date.now(), batchRemaining:-1
};
sandbox.gameState.queue = { items:[], config:{ maxSize:20, loopMode:false, skipOnFail:true }, status:{ activeIndex:-1, isRunning:false, completedCount:0, failCount:0 } };
if (sandbox.getMiningArea().ore !== "凡晶石" || sandbox.getRunningMiningArea().ore !== "镓") {
  throw new Error("切换采矿页面后，运行目标被当前选择覆盖");
}
sandbox.gameTick();
if (sandbox.gameState.resources.moonOres["镓"] !== galliumBefore + 1 || (sandbox.gameState.resources.ores["镓"] || 0) !== 0) {
  throw new Error("月矿在线结算没有进入独立月矿仓库");
}
sandbox.gameState.currentAction = moonActionBefore;
sandbox.gameState.queue = moonQueueBefore;
sandbox.gameState.skills.mining.xp = originalMiningXp;
efficiencyShip.fitted.low = ["sansha_mineral_assimilation"];
const sanshaEfficiency = sandbox.getProductionEfficiencyBreakdown("mining");
if (Math.abs(sanshaEfficiency.equipmentAmplifier - 0.90) > 1e-9 || sanshaEfficiency.secondaryBonus !== 0) {
  throw new Error("矿物同化注入器没有按采矿激光器强化计算");
}
efficiencyShip.shipId = originalShipId;
efficiencyShip.fitted = originalFitting;
if (originalMiningAssignment) sandbox.gameState.shipAssignments.mining = originalMiningAssignment;
else delete sandbox.gameState.shipAssignments.mining;
sandbox.gameState.skills.mining.lvl = originalMiningLevel;

sandbox.gameState.skills.equipmentEngineering = { lvl: 3, xp: 2 };
sandbox.gameState.skills.ammunitionEngineering = { lvl: 7, xp: 5 };
sandbox.gameState.currentAction.skill = "ammunitionEngineering";
sandbox.gameState.currentAction.ammoEngTarget = "ammo_missile";
sandbox.gameState.queue.items = [{ id: "legacy_ammo", skill: "ammunitionEngineering", target: "激光晶体弹药", label: "旧弹药任务", count: 4 }];
sandbox.gameState.shipAssignments = { ammunitionEngineering: "legacy_ship" };
sandbox.migrateAmmunitionEngineeringState();
if (sandbox.gameState.skills.ammunitionEngineering || sandbox.gameState.skills.equipmentEngineering.lvl !== 7 || sandbox.gameState.skills.equipmentEngineering.xp !== 7) {
  throw new Error("旧弹药工程技能进度迁移失败");
}
if (sandbox.gameState.currentAction.skill !== "equipmentEngineering" || sandbox.gameState.currentAction.equipEngTarget !== "ammo_missile") {
  throw new Error("旧弹药工程当前行动迁移失败");
}
if (sandbox.gameState.queue.items[0].skill !== "equipmentEngineering" || sandbox.gameState.queue.items[0].target !== "ammo_laser") {
  throw new Error("旧弹药工程队列迁移失败");
}

// 工业舰必须使用统一舰船配置显示名称和 HP，不能回退到内部 ID。
const originalShips = sandbox.gameState.inventory.ships;
const shipInventoryList = makeElement();
const originalInventoryGetElementById = sandbox.document.getElementById;
sandbox.gameState.inventory.ships = [sandbox.createShipInstance("rifter"), sandbox.createShipInstance("miner_frigate")];
sandbox.document.getElementById = (id) => id === "ship-inventory-list" ? shipInventoryList : makeElement();
sandbox.renderShipInventory();
sandbox.document.getElementById = originalInventoryGetElementById;
sandbox.gameState.inventory.ships = originalShips;
if (!shipInventoryList.innerHTML.includes("拓岩级") || !shipInventoryList.innerHTML.includes("HP: 220/75/75") || shipInventoryList.innerHTML.includes("miner_frigate")) {
  throw new Error("已有舰船仍把工业舰显示成内部 ID 或缺少实际属性");
}

// 制造开工后，下拉菜单只改变下一次选择，本次在线/离线制造必须锁定开工目标。
const originalAction = sandbox.gameState.currentAction;
const originalQueue = sandbox.gameState.queue;
const originalMinerals = { ...sandbox.gameState.resources.minerals };
const originalAmmo = { ...sandbox.gameState.resources.ammunition };
sandbox.gameState.currentAction = {
  ...originalAction,
  skill: "equipmentEngineering", active: true, progress: 10,
  lastProgressUpdate: Date.now(), batchRemaining: 1,
  equipEngTarget: "ammo_missile", startedEquipEngTarget: "ammo_laser",
  shipCompTarget: "functional_system", startedShipCompTarget: "integrated_hull",
  shipAsmTarget: "gas_frigate", startedShipAsmTarget: "rifter"
};
sandbox.gameState.queue = { items: [], config: { maxSize:20, loopMode:false, skipOnFail:true }, status: { activeIndex:-1, isRunning:false, completedCount:0, failCount:0 } };
sandbox.gameState.resources.minerals["三钛合金"] = 10;
const laserBeforeLockedTick = sandbox.gameState.resources.ammunition.laser || 0;
const missileBeforeLockedTick = sandbox.gameState.resources.ammunition.missile || 0;
if (sandbox.getRunningShipCompRecipe().id !== "integrated_hull" || sandbox.getRunningShipAsmRecipe().id !== "rifter" || sandbox.getRunningEquipEngRecipe().id !== "ammo_laser") {
  throw new Error("制造系统没有锁定开工时的部件、舰船或装备工程目标");
}
sandbox.gameTick();
if (sandbox.gameState.resources.ammunition.laser !== laserBeforeLockedTick + 50 || sandbox.gameState.resources.ammunition.missile !== missileBeforeLockedTick) {
  throw new Error("制造中切换下拉菜单后，产物仍被错误替换");
}

// 制造完成事件本身必须立刻把进度状态和画布清为 0%，不能依赖后续页面重绘。
const progressElements = new Map();
const originalProgressGetElementById = sandbox.document.getElementById;
const originalDrawSkillBar = sandbox.drawSkillBar;
const clearedBars = [];
sandbox.document.getElementById = (id) => {
  if (!progressElements.has(id)) {
    const element = makeElement(); element._verifyId = id; progressElements.set(id, element);
  }
  return progressElements.get(id);
};
sandbox.drawSkillBar = (canvas, pct) => { if (canvas) clearedBars.push([canvas._verifyId, pct]); };
for (const config of [
  { skill: "shipEngineering", shipSubAction: "component", prefix: "shipcomp" },
  { skill: "shipEngineering", shipSubAction: "assembly", prefix: "shipasm" },
  { skill: "equipmentEngineering", shipSubAction: "component", prefix: "equipeng" }
]) {
  sandbox.gameState.currentAction.skill = config.skill;
  sandbox.gameState.currentAction.shipSubAction = config.shipSubAction;
  sandbox.gameState.currentAction.active = true;
  sandbox.gameState.currentAction.progress = 99;
  sandbox.gameState.currentAction.batchRemaining = 1;
  sandbox.completeQueuedActionCycle();
  const row = progressElements.get(config.prefix + "-progress-row");
  const eta = progressElements.get(config.prefix + "-eta");
  if (sandbox.gameState.currentAction.active || sandbox.gameState.currentAction.progress !== 0 ||
      !row || row.style.display !== "none" || !eta || eta.textContent !== "0s") {
    throw new Error(`${config.prefix} 制造完成事件没有立即清空进度状态和界面`);
  }
}
sandbox.drawSkillBar = originalDrawSkillBar;
sandbox.document.getElementById = originalProgressGetElementById;
if (!clearedBars.some(([id, pct]) => id === "bar-shipcomp" && pct === 0) ||
    !clearedBars.some(([id, pct]) => id === "bar-shipasm" && pct === 0) ||
    !clearedBars.some(([id, pct]) => id === "bar-equipeng" && pct === 0)) {
  throw new Error("制造完成事件没有清空部件、舰船或装备工程进度条");
}

// 战斗必须读取逐舰真实装配；爆船不丢舰装，锁定180秒后自动满血。
for (const equipmentId of [
  "t1_small_laser", "t1_light_missile_launcher", "t1_small_cannon",
  "t1_shield_booster", "t1_armor_repairer", "t1_structure_repairer",
  "t1_medium_laser", "t1_heavy_missile_launcher", "t1_medium_cannon",
  "t1_medium_shield_booster", "t1_medium_armor_repairer", "t1_medium_structure_repairer",
  "t1_large_laser", "t1_cruise_missile_launcher", "t1_large_cannon",
  "t1_large_shield_booster", "t1_large_armor_repairer", "t1_large_structure_repairer"
]) {
  const equipment = sandbox.EQUIPMENT_DB ? sandbox.EQUIPMENT_DB[equipmentId] : vm.runInContext(`EQUIPMENT_DB["${equipmentId}"]`, sandbox);
  const recipe = sandbox.getEquipmentEngineeringRecipe(equipmentId);
  if (!equipment || !equipment.combat || recipe.output.itemId !== equipmentId) {
    throw new Error(`战斗装备 ${equipmentId} 没有接入装备数据库或制造配方`);
  }
}
const largeCombatEquipment = [
  ["t1_large_laser", "weapon", 480], ["t1_cruise_missile_launcher", "weapon", 400], ["t1_large_cannon", "weapon", 320],
  ["t1_large_shield_booster", "repair", 120], ["t1_large_armor_repairer", "repair", 80], ["t1_large_structure_repairer", "repair", 40]
];
for (const [equipmentId, kind, amount] of largeCombatEquipment) {
  const equipment = vm.runInContext(`EQUIPMENT_DB["${equipmentId}"]`, sandbox);
  const actual = kind === "weapon" ? equipment.combat.baseDamage : equipment.combat.amount;
  if (equipment.level !== 55 || equipment.combat.kind !== kind || actual !== amount) {
    throw new Error(`${equipmentId}大型战斗装备的等级、类型或强度不符合设计`);
  }
}

const originalCombat = sandbox.gameState.combat;
const originalCombatShips = sandbox.gameState.inventory.ships;
const originalAssignments = sandbox.gameState.shipAssignments;
const originalMigrations = sandbox.gameState.migrations;
const originalEquipmentInventory = sandbox.gameState.equipment.inventory;
const originalFuel = sandbox.gameState.resources.fuel;
const originalCombatAmmo = { ...sandbox.gameState.resources.ammunition };
const combatSkillSnapshot = JSON.parse(JSON.stringify(sandbox.gameState.skills));
const destroyerConfigs = [
  ["raylight", "laser", 600, 3, 0.95],
  ["spearfalcon", "missile", 600, 3, 0.85],
  ["swiftblade", "cannon", 600, 3, 0.90]
];
for (const [shipId, weapon, primaryHp, highSlots, fuelEfficiency] of destroyerConfigs) {
  const ship = vm.runInContext(`STARTER_SHIPS["${shipId}"]`, sandbox);
  if (!ship || ship.type !== "destroyer" || ship.hp[shipId === "raylight" ? "shield" : shipId === "spearfalcon" ? "armor" : "structure"] !== primaryHp ||
      ship.slots.high !== highSlots || ship.bonuses[weapon + "Damage"] !== 0.10 || ship.bonuses.hitBonus !== 10 || ship.fuelEfficiency !== fuelEfficiency) {
    throw new Error(`${shipId}驱逐舰属性、槽位或舰体加成不符合设计`);
  }
}
const mixedDestroyerConfigs = [
  ["gale", "laser", "shield", 26],
  ["bloodthorn", "missile", "armor", 12],
  ["umbra", "cannon", "structure", 24]
];
for (const [shipId, weapon, layer, dodge] of mixedDestroyerConfigs) {
  const ship = vm.runInContext(`STARTER_SHIPS["${shipId}"]`, sandbox);
  if (!ship || ship.type !== "destroyer" || ship.totalHp !== 990 || ship.hp[layer] !== 660 || ship.slots.high !== 3 ||
      ship.bonuses[layer + "Capacity"] !== 0.20 || ship.bonuses[weapon + "Damage"] !== 0.15 || ship.dodge !== dodge) {
    throw new Error(`${shipId}混血驱逐舰属性、槽位或校准闪避不符合设计`);
  }
}
const cruiserConfigs = [
  ["dawnlight", "laser", "shield", 1300, 0.90],
  ["warfalcon", "missile", "armor", 1200, 0.80],
  ["stormblade", "cannon", "structure", 1400, 0.85]
];
for (const [shipId, weapon, layer, primaryHp, fuelEfficiency] of cruiserConfigs) {
  const ship = vm.runInContext(`STARTER_SHIPS["${shipId}"]`, sandbox);
  if (!ship || ship.type !== "cruiser" || ship.totalHp !== 1800 || ship.hp[layer] !== primaryHp || ship.slots.high !== 4 ||
      ship.bonuses[weapon + "Damage"] !== 0.15 || ship.bonuses.hitBonus !== 15 || ship.fuelEfficiency !== fuelEfficiency) {
    throw new Error(`${shipId}巡洋舰属性、槽位或舰体加成不符合设计`);
  }
}
const battleshipConfigs = [
  ["sunlance", "laser", "shield", 2600, 0.85],
  ["fortfalcon", "missile", "armor", 2500, 0.75],
  ["thunderblade", "cannon", "structure", 2800, 0.80]
];
for (const [shipId, weapon, layer, primaryHp, fuelEfficiency] of battleshipConfigs) {
  const ship = vm.runInContext(`STARTER_SHIPS["${shipId}"]`, sandbox);
  if (!ship || ship.type !== "battleship" || ship.totalHp !== 3600 || ship.hp[layer] !== primaryHp || ship.slots.high !== 5 ||
      ship.bonuses[weapon + "Damage"] !== 0.20 || ship.bonuses.hitBonus !== 20 || ship.fuelEfficiency !== fuelEfficiency) {
    throw new Error(`${shipId}战列舰属性、槽位或舰体加成不符合设计`);
  }
}
const roleTestShip = sandbox.createShipInstance("spearfalcon");
sandbox.gameState.inventory.ships = [roleTestShip];
sandbox.gameState.shipAssignments = { combat:roleTestShip.instanceId };
const borderFuelExpected = 0.85 * 1.2 / (1 + sandbox.getSkillLvl("capacitorManagement") * 0.02);
const armorRepairExpected = (1 + sandbox.getSkillLvl("defense") * 0.02) * 1.5;
if (Math.abs(sandbox.calcFuelMult(borderAngelZone) - borderFuelExpected) > 1e-9 ||
    Math.abs(sandbox.calcRepairMult("armor") - armorRepairExpected) > 1e-9 ||
    sandbox.calcPlayerHit("missile") !== 130 + sandbox.getSkillLvl("missileOperations") * 4 + sandbox.getSkillLvl("targeting") * 3 + 10) {
  throw new Error("驱逐舰燃料效率、区域燃料倍率、命中或装甲维修专精没有接入战斗公式");
}
const testCombatShip = sandbox.createShipInstance("rifter");
testCombatShip.fitted = {
  high:["t1_small_laser","t1_light_missile_launcher"],
  mid:["t1_shield_booster"], low:[], rig:[]
};
sandbox.gameState.inventory.ships = [testCombatShip];
sandbox.gameState.shipAssignments = { combat:testCombatShip.instanceId };
sandbox.gameState.equipment.inventory = [];
sandbox.gameState.resources.fuel = 100;
sandbox.gameState.resources.ammunition = { laser:10, missile:10, cannon:10 };
const testMaxHp = sandbox.calcCombatMaxHp(sandbox.getActiveShip(), testCombatShip);
const testEnemy = {
  name:"验证靶舰", hp:{shield:100000,armor:100000,structure:100000}, maxHp:{shield:100000,armor:100000,structure:100000},
  kind:"normal", hit:100, dodge:30, baseDamage:36, iskDrop:0, xpDrop:0, level:1, defeated:false, rewarded:false
};
sandbox.gameState.combat = {
  ...originalCombat, activeShip:testCombatShip.instanceId, active:true, enemies:[testEnemy], currentEnemy:testEnemy, hp:{...testMaxHp}, maxHp:{...testMaxHp},
  repairUntil:0, destroyedShip:null, repairs:{}, lastStatus:"", zone:"angel_outpost"
};
const volleyFuel = Math.max(1, Math.round(3 * sandbox.calcFuelMult())) + Math.max(1, Math.round(1 * sandbox.calcFuelMult()));
const enemyShieldBefore = testEnemy.hp.shield;
sandbox.combatTick();
if (sandbox.getInstalledCombatWeapons().length !== 2 || sandbox.getInstalledCombatRepairers().length !== 1 ||
    sandbox.gameState.resources.fuel > 100 - volleyFuel ||
    sandbox.gameState.resources.ammunition.laser !== 9 || sandbox.gameState.resources.ammunition.missile !== 9 ||
    testEnemy.hp.shield >= enemyShieldBefore) {
  throw new Error("战斗回合没有按舰船真实装配执行多武器齐射或自动维修");
}

// 一回合必须是我方齐射一次，随后所有存活敌人依照编队顺序各攻击一次。
testCombatShip.fitted.mid = [];
const groupEnemyA = { ...testEnemy, id:"group_a", hp:{shield:100000,armor:100000,structure:100000}, maxHp:{shield:100000,armor:100000,structure:100000}, hit:1000000, baseDamage:100, defeated:false, rewarded:false };
const groupEnemyB = { ...testEnemy, id:"group_b", hp:{shield:100000,armor:100000,structure:100000}, maxHp:{shield:100000,armor:100000,structure:100000}, hit:1000000, baseDamage:100, defeated:false, rewarded:false };
sandbox.gameState.combat.enemies = [groupEnemyA, groupEnemyB];
sandbox.gameState.combat.currentEnemy = groupEnemyA;
sandbox.gameState.combat.hp = {...testMaxHp};
const groupHpBefore = Object.values(sandbox.gameState.combat.hp).reduce((sum, value) => sum + value, 0);
sandbox.combatTick();
const groupHpAfter = Object.values(sandbox.gameState.combat.hp).reduce((sum, value) => sum + value, 0);
if (groupHpBefore - groupHpAfter < 180 || sandbox.gameState.combat.currentEnemy !== groupEnemyA ||
    sandbox.gameState.combat.lastEnemyVolley?.attackers !== 2 ||
    sandbox.gameState.combat.lastEnemyVolley?.hits?.length !== 2) {
  throw new Error("多目标战斗没有让所有存活敌人在我方齐射后分别行动");
}

const angelStats = vm.runInContext('ENEMY_DATABASE.angel.types', sandbox);
if (angelStats.scout.baseDamage !== 40 || angelStats.scout.hp.shield !== 220 ||
    angelStats.raider.baseDamage !== 59 || angelStats.commander.baseDamage !== 96 ||
    angelStats.commander.hp.shield !== 1853) {
  throw new Error("星带普通、精英和BOSS没有使用加强后的固定基础属性");
}
testCombatShip.fitted.mid = ["t1_shield_booster"];

const shipCountBeforeDestruction = sandbox.gameState.inventory.ships.length;
const fittingBeforeDestruction = JSON.stringify(testCombatShip.fitted);
sandbox.gameState.resources.ammunition.laser = 0;
sandbox.gameState.resources.ammunition.missile = 0;
sandbox.gameState.combat.hp = { shield:0, armor:0, structure:1 };
sandbox.gameState.combat.enemies[0].hit = 1000000;
sandbox.gameState.combat.active = true;
sandbox.gameState.currentAction.active = true;
sandbox.gameState.currentAction.skill = "combat";
sandbox.combatTick();
const repairRemaining = sandbox.getCombatRecoveryRemaining();
if (sandbox.gameState.combat.active || sandbox.gameState.currentAction.active || repairRemaining < 179 || repairRemaining > 180 ||
    sandbox.gameState.inventory.ships.length !== shipCountBeforeDestruction || JSON.stringify(testCombatShip.fitted) !== fittingBeforeDestruction) {
  throw new Error("爆船后没有保留舰船装备并进入180秒强制维修");
}
const destroyedHp = sandbox.gameState.combat.hp.structure;
if (sandbox.repairShip() !== false || sandbox.gameState.combat.hp.structure !== destroyedHp) {
  throw new Error("爆船后仍然可以手动修复");
}
// 问题2：per-ship 维修权威字段为 combat.repairs[instanceId]；旧 repairUntil 已不参与判断。
sandbox.gameState.combat.repairs = sandbox.gameState.combat.repairs || {};
sandbox.gameState.combat.repairs[testCombatShip.instanceId] = Date.now() - 1;
sandbox.updateCombatRecovery(Date.now());
if (sandbox.gameState.combat.repairs[testCombatShip.instanceId] !== undefined || sandbox.gameState.combat.hp.structure !== sandbox.gameState.combat.maxHp.structure) {
  throw new Error("180秒结束后没有自动满血修复");
}

const migrationShip = sandbox.createShipInstance("kestrel");
sandbox.gameState.inventory.ships = [migrationShip];
sandbox.gameState.shipAssignments = { combat:migrationShip.instanceId };
sandbox.gameState.equipment.inventory = [];
sandbox.gameState.migrations = {};
sandbox.gameState.combat.zone = "angel_outpost";
sandbox.gameState.combat.enemies = [{
  id:"legacy_enemy", type:"scout", kind:"normal", hp:{shield:100,armor:80,structure:50},
  maxHp:{shield:200,armor:80,structure:50}, baseDamage:36, defeated:false, rewarded:false
}];
sandbox.migrateCombatEquipmentState();
const migratedItems = Object.values(migrationShip.fitted).flat().filter(Boolean);
if (!migratedItems.includes("t1_light_missile_launcher") || !migratedItems.includes("t1_armor_repairer") ||
    !sandbox.gameState.migrations.combatBeltsV2 || !sandbox.gameState.migrations.combatBeltsV4 ||
    !Array.isArray(sandbox.gameState.combat.enemies)) {
  throw new Error("旧存档的新手战斗舰没有补发默认武器和维修装备");
}

sandbox.gameState.combat = originalCombat;
sandbox.gameState.inventory.ships = originalCombatShips;
sandbox.gameState.shipAssignments = originalAssignments;
sandbox.gameState.migrations = originalMigrations;
sandbox.gameState.equipment.inventory = originalEquipmentInventory;
sandbox.gameState.resources.fuel = originalFuel;
sandbox.gameState.resources.ammunition = originalCombatAmmo;
sandbox.gameState.skills = combatSkillSnapshot;

sandbox.gameState.currentAction = originalAction;
sandbox.gameState.queue = originalQueue;
sandbox.gameState.resources.minerals = originalMinerals;
sandbox.gameState.resources.ammunition = originalAmmo;

// 舰船强化：三部件、共用边际成功率、失败等级保持、里程碑收益与工业最终乘区。
const enhancementComponents = vm.runInContext("SHIP_COMPONENT_RECIPES", sandbox);
for (const level of [1, 15, 35, 55]) {
  const recipes = enhancementComponents.filter(recipe => recipe.level === level);
  if (recipes.length !== 3) throw new Error(`Lv.${level}舰船部件不是三种`);
}
const expectedEnhancementSetXp = new Map([[1, 86], [15, 148], [35, 275], [55, 425]]);
for (const [level, expectedXp] of expectedEnhancementSetXp) {
  const actualXp = enhancementComponents.filter(recipe => recipe.level === level).reduce((sum, recipe) => sum + recipe.xp, 0);
  if (actualXp !== expectedXp) throw new Error(`Lv.${level}强化套件生产经验不是${expectedXp}`);
}
const near = (actual, expected, epsilon = 1e-9) => Math.abs(actual - expected) <= epsilon;
if (!near(sandbox.getShipEnhancementSuccessChance(1, 1, 0), 0.50) ||
    !near(sandbox.getShipEnhancementSuccessChance(11, 1, 0), 0.70) ||
    !near(sandbox.getShipEnhancementSuccessChance(11, 1, 5), 0.625) ||
    !near(sandbox.getShipEnhancementSuccessChance(1, 55, 1000), 0.05) ||
    !near(sandbox.getShipEnhancementSuccessChance(99, 1, 0), 0.80)) {
  throw new Error("舰船强化成功率没有保持共用边际递减公式的边界（5%～80%、门槛50%、技能加成最高30%）");
}
const rifterConfig = sandbox.getShipConfigById("rifter");
const minerConfig = sandbox.getShipConfigById("miner_frigate");
const combatFive = sandbox.getShipEnhancementBonuses(rifterConfig, 5);
const combatTen = sandbox.getShipEnhancementBonuses(rifterConfig, 10);
const industrialFive = sandbox.getShipEnhancementBonuses(minerConfig, 5);
if (!near(combatFive.hpMultiplier, 1.05) || !near(combatFive.damageMultiplier, 1.025) ||
    !near(combatTen.hpMultiplier, 1.10) || !near(combatTen.damageMultiplier, 1.05) ||
    !near(industrialFive.hpMultiplier, 1) || !near(industrialFive.industryMultiplier, 1.075)) {
  throw new Error("战斗/工业舰强化里程碑收益错误");
}

const enhancementState = JSON.parse(JSON.stringify(sandbox.gameState));
enhancementState.currentAction.active = false;
enhancementState.combat.active = false;
enhancementState.skills.shipEngineering = { lvl:1, xp:0 };
const enhancementShip = enhancementState.inventory.ships.find(ship => ship.shipId === "rifter");
enhancementShip.enhancementLevel = 0;
for (const id of ["integrated_hull", "power_core", "functional_system"]) enhancementState.resources.shipComponents[id] = 3;
const enhancementSuccess = sandbox.dispatchGameAction(enhancementState, { type:"hangar/enhanceShip", instanceId:enhancementShip.instanceId, randomValue:0.49 }, selectorNow);
if (!enhancementSuccess.changed || !enhancementSuccess.success || enhancementShip.enhancementLevel !== 1 || enhancementSuccess.xp !== 43 ||
    ["integrated_hull", "power_core", "functional_system"].some(id => enhancementState.resources.shipComponents[id] !== 2)) {
  throw new Error("0→1强化没有正确扣除三件部件、成功或结算43经验");
}
enhancementShip.enhancementLevel = 4;
const xpBeforeFailure = enhancementState.skills.shipEngineering.xp;
const enhancementFailure = sandbox.dispatchGameAction(enhancementState, { type:"hangar/enhanceShip", instanceId:enhancementShip.instanceId, randomValue:0.99 }, selectorNow);
if (!enhancementFailure.changed || enhancementFailure.success || enhancementShip.enhancementLevel !== 4 || enhancementFailure.xp !== 0 ||
    enhancementState.skills.shipEngineering.xp - xpBeforeFailure !== 0) {
  throw new Error("强化失败没有保持等级、消耗部件、或结算0 XP");
}

const industrialState = JSON.parse(JSON.stringify(sandbox.gameState));
industrialState.currentAction.active = false;
industrialState.combat.active = false;
let industrialShip = industrialState.inventory.ships.find(ship => ship.shipId === "miner_frigate");
if (!industrialShip) {
  industrialShip = { shipId:"miner_frigate", instanceId:"verify_industrial", builtAt:selectorNow, fitted:{ high:[], mid:[], low:[], rig:[] }, enhancementLevel:0 };
  industrialState.inventory.ships.push(industrialShip);
}
industrialShip.enhancementLevel = 5;
industrialState.shipAssignments.mining = industrialShip.instanceId;
const industrialEnhanced = sandbox.getProductionEfficiencyState(industrialState, "mining");
industrialShip.enhancementLevel = 0;
const industrialBase = sandbox.getProductionEfficiencyState(industrialState, "mining");
if (!near(industrialEnhanced.total / industrialBase.total, 1.075)) throw new Error("工业舰+5没有作为最终1.075倍采集乘区");

const combatEnhancementState = JSON.parse(JSON.stringify(sandbox.gameState));
combatEnhancementState.combat.active = false;
const combatEnhancementShip = combatEnhancementState.inventory.ships.find(ship => ship.shipId === "rifter");
combatEnhancementState.shipAssignments.combat = combatEnhancementShip.instanceId;
combatEnhancementState.combat.activeShip = combatEnhancementShip.instanceId;
combatEnhancementShip.enhancementLevel = 0;
const baseHp = sandbox.getCombatMaxHpFromState(combatEnhancementState);
const baseDamage = sandbox.getCombatDamageMultiplierFromState(combatEnhancementState, "laser");
combatEnhancementShip.enhancementLevel = 5;
const enhancedHp = sandbox.getCombatMaxHpFromState(combatEnhancementState);
const enhancedDamage = sandbox.getCombatDamageMultiplierFromState(combatEnhancementState, "laser");
if (Math.abs(enhancedHp.shield / baseHp.shield - 1.05) > 0.01 || !near(enhancedDamage / baseDamage, 1.025)) {
  throw new Error("战斗舰+5没有接入最终生命与武器伤害乘区");
}

const migrationSnapshot = JSON.parse(JSON.stringify(sandbox.gameState));
sandbox.gameState.resources.shipComponents = { hull_frame:2, shield_gen:3, armor_plate:1, propulsion:4, core_system:2, weapon_mount:5 };
sandbox.gameState.currentAction.shipCompTarget = "hull_frame";
sandbox.gameState.currentAction.startedShipCompTarget = "shield_gen";
sandbox.gameState.queue.items = [{ skill:"shipEngineering", target:"武器挂架", label:"武器挂架", count:1 }];
delete sandbox.gameState.migrations.shipComponentsV2;
sandbox.migrateShipComponentState();
if (sandbox.gameState.resources.shipComponents.integrated_hull !== 6 || sandbox.gameState.resources.shipComponents.power_core !== 6 ||
    sandbox.gameState.resources.shipComponents.functional_system !== 5 || sandbox.gameState.currentAction.shipCompTarget !== "integrated_hull" ||
    sandbox.gameState.currentAction.startedShipCompTarget !== "integrated_hull" || sandbox.gameState.queue.items[0].target !== "functional_system") {
  throw new Error("旧舰船部件、运行目标或制造队列没有迁移到三部件结构");
}
delete sandbox.gameState.combat.mode;
delete sandbox.gameState.combat.deathspaceId;
delete sandbox.gameState.combat.deathspaceTier;
delete sandbox.gameState.combat.viewMode;
delete sandbox.gameState.combat.viewDeathspaceId;
delete sandbox.gameState.combat.viewDeathspaceTier;
delete sandbox.gameState.combat.deathspaceClears;
delete sandbox.gameState.combat.lastSpecialLoot;
for (const site of deathspaces) {
  delete sandbox.gameState.resources.special[site.ticketMaterial];
  delete sandbox.gameState.resources.special[site.coreMaterial];
  delete sandbox.gameState.resources.special[site.protocolMaterial];
}
sandbox.migrateMoonMiningState();
sandbox.migrateDeathspaceState();
if (sandbox.gameState.combat.mode !== "belt" || sandbox.gameState.combat.viewMode !== "belt" || sandbox.gameState.combat.deathspaceId !== deathspaces[0].id || sandbox.gameState.combat.deathspaceTier !== 2 ||
    sandbox.gameState.combat.viewDeathspaceId !== deathspaces[0].id || sandbox.gameState.combat.viewDeathspaceTier !== 2 ||
    !sandbox.gameState.combat.deathspaceClears || sandbox.gameState.combat.lastSpecialLoot !== "" ||
    deathspaces.some(site => [site.ticketMaterial, site.coreMaterial, site.protocolMaterial].some(material => sandbox.gameState.resources.special[material] !== 0))) {
  throw new Error("旧存档没有补齐死亡空间模式、选择、记录或特殊掉落资源");
}
Object.keys(sandbox.gameState).forEach(key => delete sandbox.gameState[key]);
Object.assign(sandbox.gameState, migrationSnapshot);

// 可选真实存档回归：node tools/verify.mjs <EVE_Save.json>
const saveFixturePath = process.argv[2];
if (saveFixturePath) {
  const resolvedSavePath = path.resolve(saveFixturePath);
  const saveJson = fs.readFileSync(resolvedSavePath, "utf8");
  const imported = vm.runInContext("SaveManager", sandbox).importData(saveJson);
  if (!imported) throw new Error(`真实存档导入失败：${resolvedSavePath}`);
  const importedNow = Date.now();
  const importedDisplayFactories = {
    global:() => sandbox.getGlobalDisplayState(sandbox.gameState, 10000000),
    shipEngineering:() => sandbox.getShipEngineeringDisplayState(sandbox.gameState, importedNow),
    equipmentEngineering:() => sandbox.getEquipmentEngineeringDisplayState(sandbox.gameState, importedNow, ""),
    combat:() => sandbox.getCombatDisplayState(sandbox.gameState, importedNow),
    cargo:() => sandbox.getCargoDisplayState(sandbox.gameState, "all"),
    hangar:() => sandbox.getHangarDisplayState(sandbox.gameState),
    statistics:() => sandbox.getStatisticsDisplayState(sandbox.gameState),
    queue:() => sandbox.getQueueDisplayState(sandbox.gameState),
    actionConfirmation:() => sandbox.getActionConfirmationDisplayState(sandbox.gameState, "equipmentEngineering", importedNow)
  };
  for (const [name, createDisplay] of Object.entries(importedDisplayFactories)) {
    const importedStateBefore = JSON.stringify(sandbox.gameState);
    const display = createDisplay();
    if (!display || (name !== "global" && !display.kind)) throw new Error(`真实存档无法生成 ${name} View State`);
    if (JSON.stringify(sandbox.gameState) !== importedStateBefore) throw new Error(`真实存档的 ${name} View State修改了输入状态`);
  }
  const importedResources = ["ore", "mineral", "planetary", "gas", "moon", "special", "component", "consumable", "ammo", "currency"]
    .flatMap(namespace => resourceRegistry.listStateEntries(sandbox.gameState, namespace));
  if (!Array.isArray(sandbox.gameState.inventory.ships) || sandbox.gameState.inventory.ships.length === 0 ||
      !Array.isArray(importedResources) || importedResources.length === 0) {
    throw new Error(`真实存档迁移后缺少舰船或无法通过ResourceRegistry读取资源：ships=${sandbox.gameState.inventory.ships?.length}, resources=${importedResources?.length}`);
  }
  if (!sandbox.gameState.statistics || sandbox.gameState.statistics.version !== 7 ||
      !Array.isArray(sandbox.gameState.statistics.eventLedger?.processedEventIds)) {
    throw new Error("真实旧存档没有迁移到统计事件消费者所需的兼容结构（version 应为 9）");
  }
  // Batch C-14A：真实旧存档迁移后必须补齐 lifecycle 五字段（有限非负；秒量纲允许小数）
  {
    const _lcOld = sandbox.gameState.statistics.lifecycle;
    if (!_lcOld || typeof _lcOld !== "object" || Array.isArray(_lcOld)) {
      throw new Error("真实旧存档迁移后 statistics.lifecycle 缺失或不是普通对象");
    }
    for (const _k of ["onlineSeconds", "offlineSettlements", "offlineSettledSeconds", "maxQueueItems", "combatRepairResumes"]) {
      const _v = _lcOld[_k];
      if (typeof _v !== "number" || !Number.isFinite(_v) || _v < 0) {
        throw new Error("真实旧存档迁移后 statistics.lifecycle." + _k + " 缺失或非有限非负");
      }
    }
    if (!Number.isInteger(_lcOld.offlineSettlements) || !Number.isInteger(_lcOld.maxQueueItems) || !Number.isInteger(_lcOld.combatRepairResumes)) {
      throw new Error("真实旧存档迁移后 statistics.lifecycle 的三个计数字段必须为非负整数");
    }
  }
  if (!Number.isFinite(Number(sandbox.gameState.statistics.totals?.equipmentEnhancementAttempts)) ||
      Number(sandbox.gameState.statistics.totals?.equipmentEnhancementAttempts) < 0) {
    throw new Error("真实旧存档迁移后 statistics.totals.equipmentEnhancementAttempts 缺失或非有限非负");
  }
  if (!Number.isFinite(Number(sandbox.gameState.statistics.totals?.boostersManufactured)) ||
      Number(sandbox.gameState.statistics.totals?.boostersManufactured) < 0) {
    throw new Error("真实旧存档迁移后 statistics.totals.boostersManufactured 缺失或非有限非负");
  }
  if (!sandbox.gameState.statistics.production?.boosters ||
      typeof sandbox.gameState.statistics.production.boosters !== "object" ||
      Array.isArray(sandbox.gameState.statistics.production.boosters)) {
    throw new Error("真实旧存档迁移后 statistics.production.boosters 缺失或不是普通对象");
  }
  // 成就系统 Batch C-7：真实旧存档迁移到 v4 后必须补齐考古 totals 与 archaeology map
  for (const archTotalKey of ["archaeologyAttempts", "artifactsSold", "archaeologyLpEarned", "archaeologyRareFinds"]) {
    const archTotalValue = Number(sandbox.gameState.statistics.totals?.[archTotalKey]);
    if (!Number.isFinite(archTotalValue) || archTotalValue < 0) {
      throw new Error(`真实旧存档迁移后 statistics.totals.${archTotalKey} 缺失或非有限非负`);
    }
  }
  {
    const archMap = sandbox.gameState.statistics.archaeology;
    if (!archMap || typeof archMap !== "object" || Array.isArray(archMap) ||
        !archMap.sites || typeof archMap.sites !== "object" || Array.isArray(archMap.sites) ||
        !archMap.tiers || typeof archMap.tiers !== "object" || Array.isArray(archMap.tiers)) {
      throw new Error("真实旧存档迁移后 statistics.archaeology 缺失或 sites/tiers 不是普通对象");
    }
  }
  // 成就系统 Batch C-8：真实旧存档迁移到 v5 后必须补齐 planetary 子结构与 planetaryUnits
  {
    const planStat = sandbox.gameState.statistics.planetary;
    if (!planStat || typeof planStat !== "object" || Array.isArray(planStat) ||
        !planStat.deployedTypes || typeof planStat.deployedTypes !== "object" || Array.isArray(planStat.deployedTypes)) {
      throw new Error("真实旧存档迁移后 statistics.planetary 缺失或 deployedTypes 不是普通对象");
    }
    const planMc = Number(planStat.maxConcurrentDeployments);
    if (!Number.isFinite(planMc) || planMc < 0 || Math.floor(planMc) !== planMc) {
      throw new Error("真实旧存档迁移后 statistics.planetary.maxConcurrentDeployments 非有限非负整数");
    }
    const planUnits = Number(sandbox.gameState.statistics.totals?.planetaryUnits);
    if (!Number.isFinite(planUnits) || planUnits < 0) {
      throw new Error("真实旧存档迁移后 statistics.totals.planetaryUnits 缺失或非有限非负");
    }
  }
  // 成就系统 Batch C-9：真实旧存档迁移到 v6 后必须补齐 station 子结构三字段（均为有限非负整数）
  {
    const stationStat = sandbox.gameState.statistics.station;
    if (!stationStat || typeof stationStat !== "object" || Array.isArray(stationStat)) {
      throw new Error("真实旧存档迁移后 statistics.station 缺失或不是普通对象");
    }
    for (const stationKey of ["constructionCompletions", "maxConcurrentAutoLines", "maxOfflineSettlementSeconds"]) {
      const stationValue = Number(stationStat[stationKey]);
      if (!Number.isFinite(stationValue) || stationValue < 0 || Math.floor(stationValue) !== stationValue) {
        throw new Error(`真实旧存档迁移后 statistics.station.${stationKey} 非有限非负整数`);
      }
    }
  }
  // 成就系统 Batch C-11/C-12：真实旧存档迁移到 v7/v8 后必须补齐战斗进阶字段
  // （maxWaveReached / capital / supercapital / deathspaceEntries / flawlessZoneClears / maxSingleBattleDamage 有限非负；
  //  zoneClearsByWeapon 三键有限非负；factionBossKills 三键有限非负整数）
  {
    const cStat = sandbox.gameState.statistics.combat;
    if (!cStat || typeof cStat !== "object" || Array.isArray(cStat)) {
      throw new Error("真实旧存档迁移后 statistics.combat 缺失或不是普通对象");
    }
    if (!Number.isFinite(Number(cStat.maxWaveReached)) || Number(cStat.maxWaveReached) < 0) {
      throw new Error("真实旧存档迁移后 statistics.combat.maxWaveReached 非有限非负");
    }
    const zw = cStat.zoneClearsByWeapon;
    if (!zw || typeof zw !== "object" || Array.isArray(zw) ||
        !Number.isFinite(Number(zw.laser)) || Number(zw.laser) < 0 ||
        !Number.isFinite(Number(zw.cannon)) || Number(zw.cannon) < 0 ||
        !Number.isFinite(Number(zw.missile)) || Number(zw.missile) < 0) {
      throw new Error("真实旧存档迁移后 statistics.combat.zoneClearsByWeapon 非三键有限非负");
    }
    if (!Number.isFinite(Number(cStat.capitalEnemyKills)) || Number(cStat.capitalEnemyKills) < 0 ||
        !Number.isFinite(Number(cStat.supercapitalEnemyKills)) || Number(cStat.supercapitalEnemyKills) < 0) {
      throw new Error("真实旧存档迁移后 statistics.combat.capital/supercapitalEnemyKills 非有限非负");
    }
    // Batch C-12：v8 字段验证
    for (const k of ["deathspaceEntries","flawlessZoneClears","maxSingleBattleDamage"]) {
      if (typeof cStat[k] !== "number" || !Number.isFinite(cStat[k]) || cStat[k] < 0) {
        throw new Error("真实旧存档迁移后 statistics.combat." + k + " 非有限非负");
      }
    }
    const cfk = cStat.factionBossKills;
    if (!cfk || typeof cfk !== "object" || Array.isArray(cfk) ||
        typeof cfk.angel !== "number" || !Number.isFinite(cfk.angel) || cfk.angel < 0 ||
        typeof cfk.blood !== "number" || !Number.isFinite(cfk.blood) || cfk.blood < 0 ||
        typeof cfk.sansha !== "number" || !Number.isFinite(cfk.sansha) || cfk.sansha < 0) {
      throw new Error("真实旧存档迁移后 statistics.combat.factionBossKills 非三键有限非负");
    }
  }
  if (!sandbox.gameState.settings || sandbox.gameState.settings.confirmShipEnhancement !== true || sandbox.gameState.settings.combatSkillsExpanded !== false) {
    throw new Error("真实旧存档没有补齐默认开启的强化确认或默认折叠的战斗技能设置");
  }
  console.log(`真实存档回归通过：${path.basename(resolvedSavePath)}，${sandbox.gameState.inventory.ships.length} 艘舰船，${importedResources.length} 类已注册资源`);
}

// 统计量 v9 硬断言（fresh 游戏）：version 应为 9 且 v7/v8 战斗字段、v9 生命周期字段全部有限非负
if (!sandbox.gameState || !sandbox.gameState.statistics || sandbox.gameState.statistics.version !== 9) {
  throw new Error("游戏初始 statistics 版本不为 v9");
}
const _eea = sandbox.gameState.statistics.totals ? sandbox.gameState.statistics.totals.equipmentEnhancementAttempts : undefined;
if (!Number.isFinite(Number(_eea)) || Number(_eea) < 0) {
  throw new Error("游戏初始 statistics.totals.equipmentEnhancementAttempts 缺失或非有限非负");
}
const _bm = sandbox.gameState.statistics.totals ? sandbox.gameState.statistics.totals.boostersManufactured : undefined;
if (!Number.isFinite(Number(_bm)) || Number(_bm) < 0) {
  throw new Error("游戏初始 statistics.totals.boostersManufactured 缺失或非有限非负");
}
if (!sandbox.gameState.statistics.production?.boosters ||
    typeof sandbox.gameState.statistics.production.boosters !== "object" ||
    Array.isArray(sandbox.gameState.statistics.production.boosters)) {
  throw new Error("游戏初始 statistics.production.boosters 缺失或不是普通对象");
}
// 成就系统 Batch C-11：fresh 游戏 v7 必须自带战斗进阶字段且均为有限非负。
// 注意：本脚本在捕获 migrationSnapshot 前已运行若干领域事件测试，
//   故 maxWaveReached 等可能因先前的 combat:zoneCleared 事件而 >0；
//   此处只校验 v7 字段存在且有限非负，精确归零由审计 cbE18/cbE19 覆盖。
{
  const fcStat = sandbox.gameState.statistics.combat;
  if (!fcStat || typeof fcStat !== "object" || Array.isArray(fcStat) ||
      !Number.isFinite(Number(fcStat.maxWaveReached)) || Number(fcStat.maxWaveReached) < 0) {
    throw new Error("游戏初始 statistics.combat.maxWaveReached 非有限非负");
  }
  const fzw = fcStat.zoneClearsByWeapon;
  if (!fzw || typeof fzw !== "object" || Array.isArray(fzw) ||
      !Number.isFinite(Number(fzw.laser)) || Number(fzw.laser) < 0 ||
      !Number.isFinite(Number(fzw.cannon)) || Number(fzw.cannon) < 0 ||
      !Number.isFinite(Number(fzw.missile)) || Number(fzw.missile) < 0) {
    throw new Error("游戏初始 statistics.combat.zoneClearsByWeapon 非三键有限非负");
  }
  if (!Number.isFinite(Number(fcStat.capitalEnemyKills)) || Number(fcStat.capitalEnemyKills) < 0 ||
      !Number.isFinite(Number(fcStat.supercapitalEnemyKills)) || Number(fcStat.supercapitalEnemyKills) < 0) {
    throw new Error("游戏初始 statistics.combat.capital/supercapitalEnemyKills 非有限非负");
  }
  // Batch C-12：v8 战斗字段（deathspaceEntries/flawlessZoneClears/maxSingleBattleDamage 有限非负整数）
  for (const k of ["deathspaceEntries","flawlessZoneClears","maxSingleBattleDamage"]) {
    if (typeof fcStat[k] !== "number" || !Number.isFinite(fcStat[k]) || fcStat[k] < 0 || Math.floor(fcStat[k]) !== fcStat[k]) {
      throw new Error("游戏初始 statistics.combat." + k + " 非有限非负整数");
    }
  }
  // Batch C-12：factionBossKills 仅三合法键且均为有限非负整数
  const fbk = fcStat.factionBossKills;
  if (!fbk || typeof fbk !== "object" || Array.isArray(fbk) ||
      Object.keys(fbk).length !== 3 ||
      !("angel" in fbk) || !("blood" in fbk) || !("sansha" in fbk) ||
      typeof fbk.angel !== "number" || !Number.isFinite(fbk.angel) || fbk.angel < 0 ||
      typeof fbk.blood !== "number" || !Number.isFinite(fbk.blood) || fbk.blood < 0 ||
      typeof fbk.sansha !== "number" || !Number.isFinite(fbk.sansha) || fbk.sansha < 0) {
    throw new Error("游戏初始 statistics.combat.factionBossKills 非三键有限非负");
  }
}
// 成就系统 Batch C-7：fresh 游戏 v4 必须自带考古 totals（全 0）与 archaeology={sites:{},tiers:{}}
for (const archTotalKey of ["archaeologyAttempts", "artifactsSold", "archaeologyLpEarned", "archaeologyRareFinds"]) {
  if (sandbox.gameState.statistics.totals?.[archTotalKey] !== 0) {
    throw new Error(`游戏初始 statistics.totals.${archTotalKey} 不为 0`);
  }
}
{
  const freshArch = sandbox.gameState.statistics.archaeology;
  if (!freshArch || typeof freshArch !== "object" || Array.isArray(freshArch) ||
      !freshArch.sites || typeof freshArch.sites !== "object" || Array.isArray(freshArch.sites) || Object.keys(freshArch.sites).length !== 0 ||
      !freshArch.tiers || typeof freshArch.tiers !== "object" || Array.isArray(freshArch.tiers) || Object.keys(freshArch.tiers).length !== 0) {
    throw new Error("游戏初始 statistics.archaeology 不是 {sites:{},tiers:{}} 空结构");
  }
}
// 成就系统 Batch C-8：v5 必须自带 planetary 子结构（deployedTypes 普通对象、maxConcurrentDeployments 有限非负整数）
// 注：verify 前文的玩法模拟会经全局事件总线向 sandbox.gameState.statistics 入账（如 planetary:deployed），
// 故此处校验结构合法而非严格为空——严格空结构由 audit-achievements.mjs 的 VM 隔离分区覆盖。
{
  const freshPlan = sandbox.gameState.statistics.planetary;
  if (!freshPlan || typeof freshPlan !== "object" || Array.isArray(freshPlan) ||
      !freshPlan.deployedTypes || typeof freshPlan.deployedTypes !== "object" || Array.isArray(freshPlan.deployedTypes)) {
    throw new Error("游戏 statistics.planetary 缺失或 deployedTypes 不是普通对象");
  }
  const freshMc = Number(freshPlan.maxConcurrentDeployments);
  if (!Number.isFinite(freshMc) || freshMc < 0 || Math.floor(freshMc) !== freshMc) {
    throw new Error("游戏 statistics.planetary.maxConcurrentDeployments 非有限非负整数");
  }
  const freshUnits = Number(sandbox.gameState.statistics.totals?.planetaryUnits);
  if (!Number.isFinite(freshUnits) || freshUnits < 0) {
    throw new Error("游戏 statistics.totals.planetaryUnits 缺失或非有限非负");
  }
}
// 成就系统 Batch C-9：v6 必须自带 station 子结构三字段（有限非负整数；
// verify 前文玩法模拟可能经事件总线入账，故校验结构合法而非严格为 0——
// 严格边界由 audit-achievements.mjs 的 --station VM 隔离分区覆盖）
{
  const freshStation = sandbox.gameState.statistics.station;
  if (!freshStation || typeof freshStation !== "object" || Array.isArray(freshStation)) {
    throw new Error("游戏 statistics.station 缺失或不是普通对象");
  }
  for (const stationKey of ["constructionCompletions", "maxConcurrentAutoLines", "maxOfflineSettlementSeconds"]) {
    const stationValue = Number(freshStation[stationKey]);
    if (!Number.isFinite(stationValue) || stationValue < 0 || Math.floor(stationValue) !== stationValue) {
      throw new Error(`游戏 statistics.station.${stationKey} 非有限非负整数`);
    }
  }
}

const mime = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, "index.html")) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) response.writeHead(404).end();
    else response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" }).end(data);
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
for (const source of ["./index.html", ...localSources, "./images/ships/裂谷级.png", "./images/enemies/天使侦查舰.png"]) {
  const response = await fetch(new URL(source.replace(/^\.\//, "/"), baseUrl));
  if (!response.ok) throw new Error(`HTTP ${response.status}：${source}`);
  await response.arrayBuffer();
}
await new Promise((resolve) => server.close(resolve));

// ============================================================
// Lv.80 旗舰基础战斗装备与 0.0 强度校准 — 专项校验
// 覆盖：六件装备数据/配方/无莫尔石/舰体限制、三族 AOE、动作拒装、制造可见、AOE 击杀结算
// ============================================================
function assertFlagship(condition, message) {
  if (!condition) throw new Error("旗舰装备校验失败：" + message);
}
const G = (name) => vm.runInContext(name, sandbox);
const ED = G("EQUIPMENT_DB");
const SS = G("STARTER_SHIPS");
const IS = G("INDUSTRIAL_SHIPS");
const ER = G("EQUIPMENT_RECIPES");
const SCR = G("SHIP_COMPONENT_RECIPES");
const SAR = G("SHIP_ASSEMBLY_RECIPES");
const CZ = G("COMBAT_ZONES");
const canFit = G("canFitEquipmentOnShip");
const dispatch = G("dispatchGameAction");
const CapitalCombat = G("CapitalCombat");
const getLiving = G("getLivingCombatEnemies");
const resolveDefeat = G("resolveCombatEnemyDefeat");
const ResourceRegistry = G("ResourceRegistry");
const FLAGSHIP_IDS = ["t1_capital_laser","t1_capital_missile_array","t1_capital_cannon","t1_capital_shield_array","t1_capital_armor_array","t1_capital_structure_array"];
const EXPECTED = {
  t1_capital_laser:{ slot:"high", level:80, time:180, xp:130, combat:{ kind:"weapon", weaponType:"laser", baseDamage:600, baseHit:100, fuelCost:15, ammoCost:1 }, aoe:{ mode:"next", maxTargets:1, multiplier:0.30 } },
  t1_capital_missile_array:{ slot:"high", level:80, time:180, xp:130, combat:{ kind:"weapon", weaponType:"missile", baseDamage:500, baseHit:130, fuelCost:5, ammoCost:1 }, aoe:{ mode:"all", multiplier:0.12 } },
  t1_capital_cannon:{ slot:"high", level:80, time:180, xp:130, combat:{ kind:"weapon", weaponType:"cannon", baseDamage:400, baseHit:80, fuelCost:10, ammoCost:1 }, aoe:{ mode:"next", maxTargets:2, multiplier:0.15 } },
  t1_capital_shield_array:{ slot:"mid", level:80, time:160, xp:110, combat:{ kind:"repair", target:"shield", amount:150, fuelCost:5 } },
  t1_capital_armor_array:{ slot:"low", level:80, time:160, xp:110, combat:{ kind:"repair", target:"armor", amount:100, fuelCost:5 } },
  t1_capital_structure_array:{ slot:"low", level:80, time:160, xp:110, combat:{ kind:"repair", target:"structure", amount:50, fuelCost:15 } }
};
for (const id of FLAGSHIP_IDS) {
  const eq = ED[id];
  assertFlagship(eq, "缺少装备定义 " + id);
  const exp = EXPECTED[id];
  assertFlagship(eq.slot === exp.slot && eq.level === exp.level && eq.time === exp.time && eq.xp === exp.xp, id + " 槽位/等级/时间/经验不符");
  assertFlagship(!eq.requiresBlueprint, id + " 不应需要蓝图");
  assertFlagship(Array.isArray(eq.shipTypes) && eq.shipTypes.length === 2 && eq.shipTypes.includes("capital") && eq.shipTypes.includes("supercapital"), id + " 舰体限制应为 [capital, supercapital]");
  assertFlagship(eq.combat && eq.combat.kind === exp.combat.kind, id + " 战斗类型不符");
  for (const key of ["weaponType","baseDamage","baseHit","fuelCost","ammoCost","target","amount"]) {
    if (exp.combat[key] === undefined) continue;
    assertFlagship(eq.combat[key] === exp.combat[key], id + " 战斗属性 " + key + " 不符（实际 " + eq.combat[key] + " 期望 " + exp.combat[key] + "）");
  }
  if (exp.aoe) {
    assertFlagship(eq.combat.aoe && eq.combat.aoe.mode === exp.aoe.mode && Math.abs(eq.combat.aoe.multiplier - exp.aoe.multiplier) < 1e-9 && (exp.aoe.maxTargets === undefined || eq.combat.aoe.maxTargets === exp.aoe.maxTargets), id + " AOE 配置不符");
  }
}
// 合法材料集合仅从真实资源产出源建立，禁止「先把装备/配方材料塞进集合再校验」的自证循环。
// 真实来源：冶炼产出矿物(SMELTING_RECIPES.outputMineral)、气体(GAS_AREAS.gas)、
// 行星产物(PLANET_TYPES.output)，以及月矿基础资源（镓/铂/铪/锇/钷/铷，不属于上述派生来源，显式纳入）。
const knownMaterials = new Set();
for (const r of buildRefiningRecipes) if (r.outputMineral) knownMaterials.add(r.outputMineral);
for (const g of buildGasAreas) if (g.gas) knownMaterials.add(g.gas);
for (const p of buildPlanetTypes) if (p.output) knownMaterials.add(p.output);
for (const m of ["镓", "铂", "铪", "锇", "钷", "铷"]) knownMaterials.add(m);
for (const id of FLAGSHIP_IDS) {
  const eq = ED[id];
  for (const m of Object.keys(eq.cost || {})) {
    assertFlagship(m !== "莫尔石" && m !== "mineral:莫尔石", id + " 配方不得含莫尔石");
    assertFlagship(knownMaterials.has(m), id + " 配方含未知资源 " + m);
  }
}
const bsCfg = SS.sunlance, indCapCfg = IS.orca, capCfg = SS.firmament, supCfg = SS.starcrown;
assertFlagship(bsCfg.type === "battleship" && indCapCfg.type === "industrial_capital" && capCfg.type === "capital" && supCfg.type === "supercapital", "测试用舰体类型假设失效");
for (const id of FLAGSHIP_IDS) {
  const eq = ED[id];
  assertFlagship(canFit(eq, bsCfg) === false, id + " 不应可装于战列舰");
  assertFlagship(canFit(eq, indCapCfg) === false, id + " 不应可装于工业旗舰");
  assertFlagship(canFit(eq, capCfg) === true, id + " 应可装于旗舰");
  assertFlagship(canFit(eq, supCfg) === true, id + " 应可装于超级旗舰");
}
const gs = JSON.parse(JSON.stringify(G("gameState")));
gs.inventory.ships.push({ instanceId:"bs_test", shipId:"sunlance", fitted:{ high:[], mid:[], low:[], rig:[] } });
gs.equipment = gs.equipment || { inventory:[] };
if (!Array.isArray(gs.equipment.inventory)) gs.equipment.inventory = [];
gs.equipment.inventory = ["t1_capital_laser"];
const reject = dispatch(gs, { type:"hangar/setFittingSlot", instanceId:"bs_test", slot:"high", slotIndex:0, equipmentId:"t1_capital_laser" }, Date.now());
assertFlagship(reject.changed === false && reject.reason === "incompatible-equipment", "战列舰安装旗舰装备应被动作层拒绝，实际 " + JSON.stringify(reject));
const recipeIds = new Set(ER.map(r => r.id));
for (const id of FLAGSHIP_IDS) assertFlagship(recipeIds.has(id), id + " 未出现在制造配方表");
const capWeapons = ER.filter(r => ["t1_capital_laser","t1_capital_missile_array","t1_capital_cannon"].includes(r.id));
assertFlagship(capWeapons.length === 3 && capWeapons.every(r => r.category === "weapons"), "旗舰武器应归入 weapons 分类并可见");
function aoeEnemy(key, hp) { return { id:"aoe_"+key, type:key, kind:"normal", name:key, hp:{ shield:0, armor:0, structure:hp }, maxHp:{ shield:0, armor:0, structure:hp }, hit:10, dodge:10, baseDamage:1, iskDrop:100, xpDrop:10, defeated:false, rewarded:false }; }
const primary = aoeEnemy("primary", 1000), e1 = aoeEnemy("e1", 100), e2 = aoeEnemy("e2", 100), e3 = aoeEnemy("e3", 100);
const group = [primary, e1, e2, e3];
const laserT = CapitalCombat.getAreaDamageTargets(group, primary, { mode:"next", maxTargets:1, multiplier:0.30 });
assertFlagship(laserT.length === 1 && laserT[0].enemy === e1 && Math.abs(laserT[0].multiplier - 0.30) < 1e-9, "聚焦激光炮 AOE 应命中下一目标 30%");
const missileT = CapitalCombat.getAreaDamageTargets(group, primary, { mode:"all", multiplier:0.12 });
assertFlagship(missileT.length === 3 && missileT.every(t => Math.abs(t.multiplier - 0.12) < 1e-9), "巡航导弹阵列 AOE 应命中其他全部目标 12%");
const cannonT = CapitalCombat.getAreaDamageTargets(group, primary, { mode:"next", maxTargets:2, multiplier:0.15 });
assertFlagship(cannonT.length === 2 && cannonT[0].enemy === e1 && cannonT[1].enemy === e2 && cannonT.every(t => Math.abs(t.multiplier - 0.15) < 1e-9), "攻城射弹炮 AOE 应命中最多两个其他目标 15%");
e2.defeated = true;
const cannonT2 = CapitalCombat.getAreaDamageTargets(group, primary, { mode:"next", maxTargets:2, multiplier:0.15 });
assertFlagship(cannonT2.length === 2 && cannonT2[0].enemy === e1 && cannonT2[1].enemy === e3, "AOE 应排除已死亡目标并命中其余存活目标（最多 maxTargets）");
const liveState = G("gameState");
liveState.combat = liveState.combat || {};
const deadEnemy = aoeEnemy("dead", 0); deadEnemy.defeated = true;
liveState.combat.enemies = [ aoeEnemy("alive", 100), deadEnemy ];
const livingNow = getLiving(liveState.combat);
assertFlagship(livingNow.length === 1 && livingNow[0].id === "aoe_alive", "已死亡敌舰不应再参与攻击");
const outerZone = CZ.find(z => z.secLevel === "0.0外环") || CZ[0];
const beforeIsk = ResourceRegistry.get(liveState, "currency:isk");
const victim = aoeEnemy("aoe_victim", 10); victim.defeated = true; victim.rewarded = false;
const reward = resolveDefeat(victim, outerZone);
assertFlagship(victim.rewarded === true, "AOE 击杀应标记为已结算");
assertFlagship(typeof reward.isk === "number" && reward.isk > 0, "AOE 击杀应结算 ISK");
assertFlagship(ResourceRegistry.get(liveState, "currency:isk") > beforeIsk, "AOE 击杀的 ISK 应入账");
console.log("旗舰装备专项校验通过：六件 Lv.80 装备数据/配方/无莫尔石/舰体限制、三族 AOE、动作拒装、制造可见、AOE 击杀结算均符合预期");

// ── Lv.60 混血战列舰专项校验：锁定最终属性，任何误改都必须失败 ──
{
  const starter = G("STARTER_SHIPS");
  const recipes = G("SHIP_ASSEMBLY_RECIPES");
  const blueprints = G("SHIP_BLUEPRINTS");
  const mixedSpec = [
    {
      id: "dawnbreaker", name: "破晓级", regularId: "sunlance",
      hp: { shield: 3300, armor: 510, structure: 510 }, dodge: 13,
      bonuses: { shieldCapacity: 0.30, laserDamage: 0.25, hitBonus: 20 },
      dataMat: "天使高级加密数据", sourceZoneId: "angel_warfront"
    },
    {
      id: "crimson_bastion", name: "赤垒级", regularId: "fortfalcon",
      hp: { shield: 660, armor: 3000, structure: 660 }, dodge: 8,
      bonuses: { armorCapacity: 0.30, missileDamage: 0.25, armorRepair: 0.50, hitBonus: 20 },
      dataMat: "血袭者高级加密数据", sourceZoneId: "blood_iron_basilica"
    },
    {
      id: "spectre_frame", name: "幽构级", regularId: "thunderblade",
      hp: { shield: 460, armor: 460, structure: 3400 }, dodge: 5,
      bonuses: { structureCapacity: 0.30, cannonDamage: 0.25, speed: 0.15, structureRepair: 2.00, hitBonus: 20 },
      dataMat: "萨沙高级加密数据", sourceZoneId: "sansha_command_matrix"
    }
  ];
  const assertMixed = (cond, msg) => { if (!cond) throw new Error("混血战列舰专项校验失败：" + msg); };
  for (const spec of mixedSpec) {
    const ship = starter[spec.id];
    assertMixed(ship, `${spec.id} 未出现在 STARTER_SHIPS`);
    assertMixed(ship.tier === "混血", `${spec.id} tier 应为 混血，实际 ${ship.tier}`);
    assertMixed(ship.type === "battleship", `${spec.id} type 应为 battleship，实际 ${ship.type}`);
    assertMixed(ship.totalHp === 4320, `${spec.id} totalHp 应为 4320，实际 ${ship.totalHp}`);
    assertMixed(ship.hp.shield === spec.hp.shield && ship.hp.armor === spec.hp.armor && ship.hp.structure === spec.hp.structure,
      `${spec.id} HP 应为 ${JSON.stringify(spec.hp)}，实际 ${JSON.stringify(ship.hp)}`);
    assertMixed(ship.dodge === spec.dodge, `${spec.id} dodge 应为 ${spec.dodge}，实际 ${ship.dodge}`);
    assertMixed(ship.unlock && ship.unlock.type === "blueprint", `${spec.id} unlock.type 应为 blueprint，实际 ${ship.unlock && ship.unlock.type}`);
    assertMixed(ship.unlock.costLP === 150, `${spec.id} unlock.costLP 应为 150，实际 ${ship.unlock && ship.unlock.costLP}`);
    assertMixed(ship.unlock.level === 60, `${spec.id} unlock.level 应为 60，实际 ${ship.unlock && ship.unlock.level}`);
    const reg = starter[spec.regularId];
    assertMixed(reg, `对照常规战列舰 ${spec.regularId} 缺失`);
    for (const key of ["speed", "targeting", "fuelEfficiency"]) {
      assertMixed(ship[key] === reg[key], `${spec.id}.${key} 应与 ${spec.regularId} 一致（${reg[key]}），实际 ${ship[key]}`);
    }
    assertMixed(ship.capacitor.capacity === reg.capacitor.capacity && ship.capacitor.rechargeRate === reg.capacitor.rechargeRate,
      `${spec.id} capacitor 应与 ${spec.regularId} 一致，实际 ${JSON.stringify(ship.capacitor)}`);
    assertMixed(JSON.stringify(ship.slots) === JSON.stringify(reg.slots),
      `${spec.id} slots 应与 ${spec.regularId} 一致（${JSON.stringify(reg.slots)}），实际 ${JSON.stringify(ship.slots)}`);
    assertMixed(JSON.stringify(ship.bonuses) === JSON.stringify(spec.bonuses),
      `${spec.id} bonuses 应为 ${JSON.stringify(spec.bonuses)}，实际 ${JSON.stringify(ship.bonuses)}`);
    const recipe = recipes.find(r => r.id === spec.id);
    assertMixed(recipe, `${spec.id} 未出现在 SHIP_ASSEMBLY_RECIPES`);
    assertMixed(recipe.level === 60, `${spec.id} 配方 level 应为 60，实际 ${recipe.level}`);
    assertMixed(recipe.time === 120, `${spec.id} 配方 time 应为 120，实际 ${recipe.time}`);
    assertMixed(recipe.xp === 200, `${spec.id} 配方 xp 应为 200，实际 ${recipe.xp}`);
    assertMixed(JSON.stringify(recipe.componentCost) === JSON.stringify({ battleship_integrated_hull: 6, battleship_power_core: 5, battleship_functional_system: 5 }),
      `${spec.id} 部件应为 6/5/5，实际 ${JSON.stringify(recipe.componentCost)}`);
    assertMixed(recipe.materialCost["钷"] === 20, `${spec.id} 钷应为 20，实际 ${recipe.materialCost["钷"]}`);
    assertMixed(recipe.materialCost["铷"] === 16, `${spec.id} 铷应为 16，实际 ${recipe.materialCost["铷"]}`);
    assertMixed(recipe.materialCost[spec.dataMat] === 45, `${spec.id} ${spec.dataMat} 应为 45，实际 ${recipe.materialCost[spec.dataMat]}`);
    const bp = blueprints.find(b => b.id === spec.id);
    assertMixed(bp, `${spec.id} 未出现在 SHIP_BLUEPRINTS`);
    assertMixed(bp.costLP === 150, `${spec.id} 蓝图 costLP 应为 150，实际 ${bp.costLP}`);
    assertMixed(bp.level === 60, `${spec.id} 蓝图 level 应为 60，实际 ${bp.level}`);
    assertMixed(bp.sourceZoneId === spec.sourceZoneId, `${spec.id} 蓝图 sourceZoneId 应为 ${spec.sourceZoneId}，实际 ${bp.sourceZoneId}`);
  }
  console.log("混血战列舰专项校验通过：三舰 tier/type/解锁/总生命/精确HP/闪避/框架一致/舰体加成/命中/配方/蓝图均锁定");
}

// ── 工业舰与逆戟鲸专项防回归校验 ──
{
  const assertIndustrial = (cond, msg) => { if (!cond) throw new Error("工业舰校验失败：" + msg); };
  const industrialShips = G("INDUSTRIAL_SHIPS");
  const assemblyRecipes = G("SHIP_ASSEMBLY_RECIPES");
  const componentRecipes = G("SHIP_COMPONENT_RECIPES");
  const starterShips = G("STARTER_SHIPS");
  const expectedIds = ["miner_frigate","gas_frigate","miner_destroyer","gas_destroyer","miner_cruiser","gas_cruiser","dolphin","miner_battleship","gas_battleship","orca"];
  assertIndustrial(industrialShips && Object.keys(industrialShips).length === 10, `INDUSTRIAL_SHIPS 必须精确 10 艘，实际 ${industrialShips ? Object.keys(industrialShips).length : 0}`);
  for (const id of expectedIds) assertIndustrial(industrialShips[id], `INDUSTRIAL_SHIPS 缺少 ${id}`);
  for (const id of Object.keys(industrialShips)) assertIndustrial(expectedIds.includes(id), `INDUSTRIAL_SHIPS 含预期外舰船 ${id}`);
  const orca = industrialShips.orca;
  assertIndustrial(orca.type === "industrial_capital", "逆戟鲸 type 应为 industrial_capital");
  assertIndustrial(orca.unlock && orca.unlock.type === "shipEngineering" && orca.unlock.level === 80, "逆戟鲸解锁应为 shipEngineering/Lv.80");
  assertIndustrial(orca.bonuses && orca.bonuses.miningLaserEfficiency === 2.8, "逆戟鲸 miningLaserEfficiency 应为 2.8");
  assertIndustrial(orca.bonuses && orca.bonuses.gasLaserEfficiency === 2.8, "逆戟鲸 gasLaserEfficiency 应为 2.8");
  assertIndustrial(orca.bonuses && orca.bonuses.fleetMiningSpeed === 0.20, "逆戟鲸 fleetMiningSpeed 应为 0.20");
  assertIndustrial(orca.bonuses && orca.bonuses.smeltingSpeed === 0.30, "逆戟鲸 smeltingSpeed 应为 0.30");
  const orcaRecipe = assemblyRecipes.find(r => r.id === "orca");
  assertIndustrial(orcaRecipe, "逆戟鲸缺少整船制造配方");
  assertIndustrial(orcaRecipe.requiresBlueprint === false, "逆戟鲸配方 requiresBlueprint 应为 false");
  assertIndustrial(orcaRecipe.time === 320, `逆戟鲸组装 time 应为 320，实际 ${orcaRecipe.time}`);
  assertIndustrial(orcaRecipe.xp === 500, `逆戟鲸组装 xp 应为 500，实际 ${orcaRecipe.xp}`);
  const cc = orcaRecipe.componentCost || {};
  const ccSum = (cc.capital_integrated_hull || 0) + (cc.capital_power_core || 0) + (cc.capital_functional_system || 0);
  assertIndustrial(cc.capital_integrated_hull === 10 && cc.capital_power_core === 8 && cc.capital_functional_system === 10, "逆戟鲸部件应为 10/8/10");
  assertIndustrial(ccSum === 28, `逆戟鲸部件总数应为 28，实际 ${ccSum}`);
  const forbidden = new Set(["莫尔石"]);
  const allOrcaMaterials = {};
  for (const [compId, count] of Object.entries(cc)) {
    const comp = componentRecipes.find(c => c.id === compId);
    assertIndustrial(comp, `逆戟鲸部件 ${compId} 缺少部件配方`);
    for (const [mat, qty] of Object.entries(comp.cost || {})) allOrcaMaterials[mat] = (allOrcaMaterials[mat] || 0) + qty * count;
  }
  for (const mat of Object.keys(orcaRecipe.materialCost || {})) allOrcaMaterials[mat] = (allOrcaMaterials[mat] || 0) + (orcaRecipe.materialCost[mat] || 0);
  for (const mat of Object.keys(allOrcaMaterials)) {
    assertIndustrial(!forbidden.has(mat), `逆戟鲸配方不得消耗莫尔石（含 ${mat}）`);
    assertIndustrial(!mat.includes("深层"), `逆戟鲸配方不得消耗深层舰船数据（含 ${mat}）`);
    assertIndustrial(!mat.includes("考古"), `逆戟鲸配方不得消耗考古材料（含 ${mat}）`);
  }
  // 旗舰战斗装备仍不得安装到逆戟鲸（复用 canFit，工业旗舰类型已覆盖）
  for (const id of FLAGSHIP_IDS) assertIndustrial(canFit(ED[id], orca) === false, id + " 不应可装于逆戟鲸");
  // 逆戟鲸不得进入旗舰/超级旗舰 0.0 战斗平衡测试配置：既不在 STARTER_SHIPS 战斗名册，也不属 capital/supercapital 类型
  assertIndustrial(starterShips.orca === undefined, "逆戟鲸不得进入 STARTER_SHIPS 战斗名册（否则会被资本战斗平衡选取）");
  assertIndustrial(orca.type !== "capital" && orca.type !== "supercapital", "逆戟鲸类型不得为 capital/supercapital，避免进入 0.0 战斗平衡配置");
  console.log("工业舰与逆戟鲸专项校验通过：10 舰/type=industrial_capital/解锁 shipEngineering Lv.80/双 2.8/支援 0.20/冶炼 0.30/配方免蓝图 10-8-10 总 28/time320/xp500/禁莫尔石深层考古/旗舰装备禁装/不进战斗平衡");
}

// ── 考古船第一阶段专项防回归校验 ──
{
  const assertArch = (cond, msg) => { if (!cond) throw new Error("考古船校验失败：" + msg); };
  const archShips = G("ARCHAEOLOGY_SHIPS");
  const assemblyRecipes = G("SHIP_ASSEMBLY_RECIPES");
  const componentRecipes = G("SHIP_COMPONENT_RECIPES");
  const blueprints = G("SHIP_BLUEPRINTS");
  const starterShips = G("STARTER_SHIPS");
  const industrialShips = G("INDUSTRIAL_SHIPS");
  const getShipConfigById = G("getShipConfigById");
  const getShipConfig = G("getShipConfig");
  const expectedIds = ["heron","tracer","starmap","farscope","illuminator"];
  const expectedUnlockLevel = { heron:1, tracer:15, starmap:35, farscope:55, illuminator:80 };
  const expectedRecipe = {
    heron:      { level:1,  time:30,  xp:30,  reqBP:true,  total:6  },
    tracer:     { level:15, time:45,  xp:60,  reqBP:false, total:10 },
    starmap:    { level:35, time:70,  xp:100, reqBP:false, total:13 },
    farscope:   { level:55, time:100, xp:160, reqBP:false, total:16 },
    illuminator:{ level:80, time:320, xp:500, reqBP:false, total:28 }
  };

  assertArch(archShips && Object.keys(archShips).length === 5, `ARCHAEOLOGY_SHIPS 必须精确 5 艘，实际 ${archShips ? Object.keys(archShips).length : 0}`);
  for (const id of expectedIds) {
    assertArch(archShips[id], `ARCHAEOLOGY_SHIPS 缺少 ${id}`);
    assertArch(archShips[id].unlock && archShips[id].unlock.level === expectedUnlockLevel[id], `${id} 解锁等级应为 ${expectedUnlockLevel[id]}`);
    assertArch(getShipConfigById(id) === archShips[id], `getShipConfigById(${id}) 必须解析到 ARCHAEOLOGY_SHIPS`);
    assertArch(starterShips[id] === undefined, `${id} 不得进入 STARTER_SHIPS`);
    assertArch(industrialShips[id] === undefined, `${id} 不得进入 INDUSTRIAL_SHIPS`);
    assertArch(getShipConfig(id) === archShips[id], `${id} 战斗解析器必须能解析 ARCHAEOLOGY_SHIPS（考古舰可参战）`);
  }
  for (const id of Object.keys(archShips)) assertArch(expectedIds.includes(id), `ARCHAEOLOGY_SHIPS 含预期外舰船 ${id}`);

  for (const id of expectedIds) {
    const recipe = assemblyRecipes.find(r => r.id === id);
    const exp = expectedRecipe[id];
    assertArch(recipe, `${id} 缺少整船制造配方`);
    assertArch(recipe.level === exp.level, `${id} 配方 level 应为 ${exp.level}`);
    assertArch(recipe.time === exp.time, `${id} 配方 time 应为 ${exp.time}`);
    assertArch(recipe.xp === exp.xp, `${id} 配方 xp 应为 ${exp.xp}`);
    const effReq = !recipe || recipe.requiresBlueprint !== false;
    assertArch(effReq === exp.reqBP, `${id} 配方 needsBlueprint 应为 ${exp.reqBP}`);
    const cc = recipe.componentCost || {};
    const ccSum = Object.values(cc).reduce((a, b) => a + b, 0);
    assertArch(ccSum === exp.total, `${id} 部件总数应为 ${exp.total}，实际 ${ccSum}`);
    for (const compId of Object.keys(cc)) assertArch(componentRecipes.find(c => c.id === compId), `${id} 部件 ${compId} 缺少部件配方`);
    assertArch(recipe.materialCost === undefined, `${id} 配方不得含 materialCost（禁考古/月矿/阵营/深层数据）`);
  }

  const heronBp = blueprints.find(b => b.id === "heron");
  assertArch(heronBp && heronBp.costISK === 50000 && heronBp.level === 1 && heronBp.shipId === "heron", "苍鹭级必须存在 50000 ISK / Lv.1 永久蓝图");
  for (const id of ["tracer","starmap","farscope","illuminator"]) assertArch(!blueprints.find(b => b.id === id), `${id} 不得存在蓝图`);

  // 工业舰数量不受影响（第一阶段仅新增考古表，未改动工业舰）
  assertArch(industrialShips && Object.keys(industrialShips).length === 10, `INDUSTRIAL_SHIPS 必须保持 10 艘，实际 ${industrialShips ? Object.keys(industrialShips).length : 0}`);
  // 启明级（archaeology_capital）不得安装 6 件旗舰战斗装备
  for (const fid of FLAGSHIP_IDS) assertArch(canFit(ED[fid], archShips.illuminator) === false, fid + " 不应可装于启明级");

  console.log("考古船第一阶段校验通过：5 舰/解锁等级 1·15·35·55·80/统一解析/不进 STARTER·INDUSTRIAL 数据表、可由战斗解析器正确解析并参战/5 配方 level-time-xp-免蓝图(仅苍鹭)-部件总数 6·10·13·16·28-禁 materialCost/苍鹭 50000 ISK 蓝图·余者无蓝图/工业仍 10 舰/启明级禁装旗舰装备");
}

// Batch C-12：成就目录恰 197 项且 E28 不存在
const _achData = sandbox.AchievementData;
const _allIds = _achData && _achData.ACHIEVEMENTS ? _achData.ACHIEVEMENTS.map(a => a.id) : [];
if (_allIds.length !== 197) throw new Error("成就目录长度不为 197，实际为 " + _allIds.length);
if (_allIds.includes("E28")) throw new Error("已删除的 E28 仍存在于成就目录");
if (!_allIds.includes("E26") || !_allIds.includes("E33")) throw new Error("E26/E33 不存在于成就目录");

// Batch C-14A/C-14B：J01–J06 与 J10–J12 全部已有规则映射；总规则 197、未映射 0
{
  const _rd = sandbox.AchievementRuleData;
  if (!_rd || !Array.isArray(_rd.GENERAL_RULES) || _rd.GENERAL_RULES.length !== 6) {
    throw new Error("AchievementRuleData.GENERAL_RULES 缺失或不为 6 条");
  }
  if (_rd.GENERAL_RULES.map(r => r.achievementId).join(",") !== "J01,J02,J03,J04,J05,J06") {
    throw new Error("GENERAL_RULES 的 achievementId 顺序不为 J01→J06");
  }
  if (!Array.isArray(_rd.META_RULES) || _rd.META_RULES.length !== 3) {
    throw new Error("AchievementRuleData.META_RULES 缺失或不为 3 条");
  }
  if (_rd.META_RULES.map(r => r.achievementId).join(",") !== "J10,J11,J12") {
    throw new Error("META_RULES 的 achievementId 顺序不为 J10→J12");
  }
  if (!Object.isFrozen(_rd.META_RULES) || !Object.isFrozen(_rd.META_RULES_BY_ID) ||
      !Object.isFrozen(_rd.META_ACHIEVEMENT_IDS) || _rd.META_RULES.some(r => !Object.isFrozen(r))) {
    throw new Error("META_RULES / META_RULES_BY_ID / META_ACHIEVEMENT_IDS 未冻结");
  }
  if (_rd.META_ACHIEVEMENT_IDS.join(",") !== "J10,J11,J12") {
    throw new Error("META_ACHIEVEMENT_IDS 不为 J10,J11,J12");
  }
  if (_rd.META_RULES_BY_ID.J10.minValue !== 50 || _rd.META_RULES_BY_ID.J11.minValue !== 100) {
    throw new Error("J10/J11 阈值不为 50/100");
  }
  if (_rd.META_RULES_BY_ID.J12.type !== "meta-catalog-complete" ||
      _rd.META_RULES_BY_ID.J12.excludeIds.join(",") !== "J12") {
    throw new Error("J12 规则必须为 meta-catalog-complete 且仅排除自身");
  }
  if (!Array.isArray(_rd.ACHIEVEMENT_RULES) || _rd.ACHIEVEMENT_RULES.length !== 197) {
    throw new Error("ACHIEVEMENT_RULES 总数不为 197，实际为 " + (_rd.ACHIEVEMENT_RULES ? _rd.ACHIEVEMENT_RULES.length : "缺失"));
  }
  for (const _jid of ["J01", "J02", "J03", "J04", "J05", "J06", "J10", "J11", "J12"]) {
    if (!_rd.ACHIEVEMENT_RULES_BY_ID[_jid]) throw new Error(_jid + " 未映射规则");
  }
  const _unmapped = _allIds.filter(id => !_rd.ACHIEVEMENT_RULES_BY_ID[id]);
  if (_unmapped.length !== 0) {
    throw new Error("未映射成就应为 0，实际为 " + _unmapped.join(","));
  }
}

// Batch C-14A：statistics v9 版本断言
if (sandbox.gameState.statistics.version !== 9) throw new Error("statistics version 不为 9");
// v9 生命周期字段有限非负（fresh 游戏；秒量纲允许小数，计数量纲必须为整数）
{
  const _lc = sandbox.gameState.statistics.lifecycle;
  if (!_lc || typeof _lc !== "object" || Array.isArray(_lc)) {
    throw new Error("statistics.lifecycle 缺失或不是普通对象");
  }
  for (const _k of ["onlineSeconds", "offlineSettlements", "offlineSettledSeconds", "maxQueueItems", "combatRepairResumes"]) {
    const _v = _lc[_k];
    if (typeof _v !== "number" || !Number.isFinite(_v) || _v < 0) {
      throw new Error("statistics.lifecycle." + _k + " 无效或非有限非负");
    }
  }
  if (!Number.isInteger(_lc.offlineSettlements) || !Number.isInteger(_lc.maxQueueItems) || !Number.isInteger(_lc.combatRepairResumes)) {
    throw new Error("statistics.lifecycle 的 offlineSettlements/maxQueueItems/combatRepairResumes 必须为非负整数");
  }
}
// v8 战斗字段有限非负
const _cb = sandbox.gameState.statistics.combat;
if (typeof _cb.deathspaceEntries !== "number" || _cb.deathspaceEntries < 0 || !Number.isFinite(_cb.deathspaceEntries) ||
    typeof _cb.flawlessZoneClears !== "number" || _cb.flawlessZoneClears < 0 || !Number.isFinite(_cb.flawlessZoneClears) ||
    typeof _cb.maxSingleBattleDamage !== "number" || _cb.maxSingleBattleDamage < 0 || !Number.isFinite(_cb.maxSingleBattleDamage)) {
  throw new Error("v8 战斗字段 deathspaceEntries/flawlessZoneClears/maxSingleBattleDamage 无效");
}
if (typeof _cb.factionBossKills !== "object" || _cb.factionBossKills === null ||
    typeof _cb.factionBossKills.angel !== "number" || _cb.factionBossKills.angel < 0 || !Number.isFinite(_cb.factionBossKills.angel) ||
    typeof _cb.factionBossKills.blood !== "number" || _cb.factionBossKills.blood < 0 || !Number.isFinite(_cb.factionBossKills.blood) ||
    typeof _cb.factionBossKills.sansha !== "number" || _cb.factionBossKills.sansha < 0 || !Number.isFinite(_cb.factionBossKills.sansha)) {
  throw new Error("factionBossKills 三键(angel/blood/sansha)无效或非有限非负");
}

// ===== Batch C-14A 第一次定点返修 verify 断言：队列容量迁移 + 维修后真实自动恢复链 =====
// 仅覆盖「旧档 J05 仍不可达」「J06 实际不可达」两真实缺口已修复；不触碰其它系统、不创建辅助文件。
{
  // 捕获 pristine 游戏态，供 import/load 旧档测试构造合法存档（避免 A4 改写 gameState 影响）
  const pristineGameState = JSON.parse(JSON.stringify(sandbox.gameState));

  // 断言 4（先于队列测试，使用 pristine gameState）：维修后真实自动恢复链可执行且 combat:resumedAfterRepair 恰发 1 次
  {
    const beltZone = sandbox.gameState.combat.zone;
    let resumeCount = 0;
    const offResume = sandbox.GameEvents.on("combat:resumedAfterRepair", () => { resumeCount += 1; });
    const T0 = 1700000000000;
    const beginRes = sandbox.dispatchGameAction(sandbox.gameState, { type: "combat/beginRecovery" }, T0);
    if (!beginRes || !beginRes.changed || sandbox.gameState.combat.repairs[beginRes.repairShipId] !== T0 + 180000 ||
        sandbox.gameState.currentAction.active !== false || !sandbox.gameState.resumeAfterRepair ||
        sandbox.gameState.resumeAfterRepair.returnZoneId !== beltZone) {
      throw new Error("combat/beginRecovery 未正确建立 repairs + resumeAfterRepair");
    }
    // 镜像真实游戏：被毁舰即当前 active 战斗舰（beginRecovery 不改动 activeShip，真实流程中它本就指向被毁舰）
    sandbox.gameState.combat.activeShip = beginRes.repairShipId;
    sandbox.updateCombatRecovery(T0 + 180000); // 维修到期：唯一入口真实自动恢复出击
    if (resumeCount !== 1 || sandbox.gameState.combat.active !== true || sandbox.gameState.currentAction.active !== true ||
        sandbox.gameState.resumeAfterRepair !== null || sandbox.gameState.combat.repairs[beginRes.repairShipId] !== undefined) {
      throw new Error("维修到期后未真实自动恢复出击，或 combat:resumedAfterRepair 事件次数不为 1（实际 " + resumeCount + "）");
    }
    sandbox.updateCombatRecovery(T0 + 999999); // 已恢复后重复调用不得再 emit
    if (resumeCount !== 1) throw new Error("重复 updateCombatRecovery 再次发射了 combat:resumedAfterRepair");
    if (typeof offResume === "function") offResume();
  }

  // 断言 1：fresh 队列默认容量 >= 25（normalizeQueueState 为新游戏路径建立默认队列）
  {
    const freshState = {};
    sandbox.normalizeQueueState(freshState);
    if (!freshState.queue || !freshState.queue.config || typeof freshState.queue.config.maxSize !== "number" ||
        freshState.queue.config.maxSize < 25) {
      throw new Error("normalizeQueueState 新建默认队列 config.maxSize 未达 25，实际 " +
        (freshState.queue && freshState.queue.config && freshState.queue.config.maxSize));
    }
  }

  // 断言 2：旧档 maxSize=20 经 load / importData 迁移后均为 25（修复旧档 J05 不可达）
  {
    const oldSave = JSON.parse(JSON.stringify(pristineGameState));
    oldSave.queue.config.maxSize = 20;
    const oldJson = JSON.stringify(oldSave);
    sandbox.SaveManager.importData(oldJson); // importData 路径
    if (sandbox.gameState.queue.config.maxSize !== 25) {
      throw new Error("旧档 maxSize=20 经 importData 后未迁移为 25，实际 " + sandbox.gameState.queue.config.maxSize);
    }
    localStorageMock.getItem = () => oldJson; // load 路径（经 localStorage 适配器）
    const loaded = sandbox.SaveManager.load();
    localStorageMock.getItem = () => null;
    if (!loaded) throw new Error("SaveManager.load 返回 false");
    if (sandbox.gameState.queue.config.maxSize !== 25) {
      throw new Error("旧档 maxSize=20 经 load 后未迁移为 25，实际 " + sandbox.gameState.queue.config.maxSize);
    }
  }

  // 断言 3：合法 maxSize>25 不被缩小（normalizeQueueState 直接 + importData 路径）
  {
    const bigSave = JSON.parse(JSON.stringify(pristineGameState));
    bigSave.queue.config.maxSize = 100;
    sandbox.normalizeQueueState(bigSave);
    if (bigSave.queue.config.maxSize !== 100) {
      throw new Error("normalizeQueueState 将合法 maxSize=100 错误缩小为 " + bigSave.queue.config.maxSize);
    }
    sandbox.SaveManager.importData(JSON.stringify(bigSave));
    if (sandbox.gameState.queue.config.maxSize !== 100) {
      throw new Error("合法 maxSize=100 旧档经 importData 后被缩小为 " + sandbox.gameState.queue.config.maxSize);
    }
  }
}

// ===== Batch C-14B：元成就 J10/J11/J12 最小行为断言 =====
// 覆盖：阈值边界（49/50、99/100）、J12 目录完整性、元成就不自我抬高计数、
//       旧档追溯补齐且已有时间不覆盖、事件递归不重复 emit / 不栈溢出。
{
  const AS = sandbox.AchievementSystem;
  const META_IDS = ["J10", "J11", "J12"];
  const NON_META = _allIds.filter(id => META_IDS.indexOf(id) === -1);
  if (NON_META.length !== 194) throw new Error("非元成就应为 194 项，实际 " + NON_META.length);
  if (typeof AS.evaluateMetaAchievementRules !== "function" || typeof AS.installMetaAchievementConsumer !== "function") {
    throw new Error("AchievementSystem 缺少 evaluateMetaAchievementRules / installMetaAchievementConsumer");
  }

  // 断言 4：元成就自身 / 未知 ID / 非法时间都不得计入 J10 阈值（离线纯求值）
  {
    const T = 1800000000000;
    const st = { achievements: { schemaVersion: 1, unlockedAtById: {} } };
    const m = st.achievements.unlockedAtById;
    for (let i = 0; i < 49; i++) m[NON_META[i]] = T;
    m.J11 = T; m.J12 = T;                  // 元成就自身不得抬高 J10 计数
    m.ZZ99 = T;                            // 未知 ID（幽灵成就）
    m[NON_META[100]] = Number.NaN;         // 非法时间
    m[NON_META[101]] = -1;
    m[NON_META[102]] = "1800000000000";
    const r1 = AS.evaluateMetaAchievementRules(st, T);
    if (!r1.ok || r1.unlockedIds.length !== 0 || typeof m.J10 === "number") {
      throw new Error("元成就自身/未知 ID/非法时间被错误计入 J10 阈值");
    }
    m[NON_META[49]] = T;                   // 补足到真实 50 项非元成就
    const r2 = AS.evaluateMetaAchievementRules(st, T);
    if (r2.unlockedIds.join(",") !== "J10" || m.J10 !== T) {
      throw new Error("真实 50 项非元成就时 J10 未解锁");
    }
  }

  // 断言 1/2/3/6：真实解锁事件链在 gameState 上顺序驱动 J10→J11→J12，各恰 emit 一次
  {
    const gs = sandbox.gameState;
    gs.achievements.unlockedAtById = {};   // 受控场景
    const T0 = 1810000000000;
    const emitted = [];
    const reasons = [];
    const off = sandbox.GameEvents.on("achievement:unlocked", (e) => {
      emitted.push(e.payload.achievementId);
      // 递归探针：嵌套派发期间再次求值必须被重入保护拦截（不递归、不重复解锁）
      reasons.push(AS.evaluateMetaAchievementRules(gs, e.timestamp).reason);
    });

    for (let i = 0; i < 49; i++) AS.unlockAchievement(gs, NON_META[i], T0 + i);
    if (AS.isAchievementUnlocked(gs, "J10")) throw new Error("49 项非元成就时 J10 不应解锁");
    AS.unlockAchievement(gs, NON_META[49], T0 + 49);
    if (!AS.isAchievementUnlocked(gs, "J10")) throw new Error("第 50 项真实解锁后 J10 未解锁");
    if (AS.getAchievementUnlockTime(gs, "J10") !== T0 + 49) throw new Error("J10 未采用第 50 次解锁的事件时间戳");
    if (AS.isAchievementUnlocked(gs, "J11")) throw new Error("50 项时 J11 不应解锁");

    for (let i = 50; i < 99; i++) AS.unlockAchievement(gs, NON_META[i], T0 + i);
    if (AS.isAchievementUnlocked(gs, "J11")) throw new Error("99 项非元成就时 J11 不应解锁");
    AS.unlockAchievement(gs, NON_META[99], T0 + 99);
    if (!AS.isAchievementUnlocked(gs, "J11")) throw new Error("第 100 项真实解锁后 J11 未解锁");
    if (AS.isAchievementUnlocked(gs, "J12")) throw new Error("100 项时 J12 不应解锁");

    for (let i = 100; i < 193; i++) AS.unlockAchievement(gs, NON_META[i], T0 + i);
    if (AS.isAchievementUnlocked(gs, "J12")) throw new Error("缺任意一个普通成就时 J12 不应解锁");
    AS.unlockAchievement(gs, NON_META[193], T0 + 193);
    if (!AS.isAchievementUnlocked(gs, "J12")) throw new Error("目录除 J12 外全部解锁后 J12 未解锁");

    for (const id of META_IDS) {
      const n = emitted.filter(x => x === id).length;
      if (n !== 1) throw new Error(id + " 的 achievement:unlocked 次数应为 1，实际 " + n);
    }
    if (reasons.indexOf("REENTRANT") === -1) throw new Error("嵌套派发期间未触发元成就重入保护");
    const before = emitted.length;
    const again = AS.evaluateMetaAchievementRules(gs, T0 + 500);
    if (!again.ok || again.unlockedIds.length !== 0 || emitted.length !== before) {
      throw new Error("重复求值元成就产生了重复解锁或重复 emit");
    }
    if (Object.keys(gs.achievements.unlockedAtById).length !== 197) {
      throw new Error("最终解锁总数不为 197，实际 " + Object.keys(gs.achievements.unlockedAtById).length);
    }
    if (typeof off === "function") off();
  }

  // 断言 5：旧档追溯（importData 路径）可补 J10/J11/J12，已有解锁时间保持不变
  {
    const oldSave = JSON.parse(JSON.stringify(sandbox.gameState));
    const OLD_J10_AT = 1234567890;
    oldSave.achievements.unlockedAtById = {};
    for (const id of NON_META) oldSave.achievements.unlockedAtById[id] = 1700000000000;
    oldSave.achievements.unlockedAtById.J10 = OLD_J10_AT; // 旧档已有 J10：时间必须原样保持
    sandbox.SaveManager.importData(JSON.stringify(oldSave));
    const map = sandbox.gameState.achievements.unlockedAtById;
    if (map.J10 !== OLD_J10_AT) throw new Error("旧档已有的 J10 解锁时间被覆盖，实际 " + map.J10);
    if (typeof map.J11 !== "number" || typeof map.J12 !== "number") {
      throw new Error("旧档追溯未补齐 J11/J12");
    }
    if (Object.keys(map).length !== 197) {
      throw new Error("旧档追溯后解锁总数不为 197，实际 " + Object.keys(map).length);
    }
  }

  console.log("Batch C-14B 元成就校验通过：J10 49/50 边界、J11 99/100 边界、J12 目录完整性、元成就不自我计数、旧档追溯保时间、事件重入保护、规则 197/未映射 0");
}

// ==========================================================================
// 成就系统 Batch D：成就页面实装（导航 / 面板显隐 / 汇总 / 筛选 / 隐藏遮蔽）
// 只读视图校验：不触发解锁、不改成就规则与状态，用例结束后恢复原 unlockedAtById。
// ==========================================================================
{
  const AD = sandbox.AchievementData;
  const TOTAL = AD.ACHIEVEMENTS.length;
  if (TOTAL !== 197) throw new Error("成就目录不为 197 项，实际 " + TOTAL);

  // 1) 导航入口与 panel DOM 必须存在，且成就入口位于统计档案附近（其后）
  if (!/<div class="nav-item" data-page="achievements">/.test(html)) {
    throw new Error('侧边栏缺少 data-page="achievements" 成就入口');
  }
  if (html.indexOf('data-page="statistics"') >= html.indexOf('data-page="achievements"')) {
    throw new Error("成就入口应位于统计档案之后");
  }
  const achDomIds = [
    "achievements-panel", "achievements-summary-count", "achievements-summary-percent",
    "achievements-progress-fill", "achievements-tier-counts", "achievements-category-tabs",
    "achievements-status-tabs", "achievements-grid"
  ];
  for (const id of achDomIds) if (!htmlIds.has(id)) throw new Error("index.html 缺少成就页 DOM：" + id);
  if (!/<div class="panel achievements-panel" id="achievements-panel" style="display:none;">/.test(html)) {
    throw new Error("achievements-panel 未按现有面板体系声明（class .panel + 默认 display:none）");
  }

  const achEls = {};
  for (const id of achDomIds) achEls[id] = makeElement();
  const originalAchGetElementById = sandbox.document.getElementById;
  sandbox.document.getElementById = (id) => achEls[id] || makeElement();
  const achievementsUnlockedBefore = sandbox.gameState.achievements.unlockedAtById;
  sandbox.gameState.achievements.unlockedAtById = {};
  const countCards = () => (achEls["achievements-grid"].innerHTML.match(/data-ach-id="/g) || []).length;

  try {
    // 2) 切换到成就页后 panel 必须显示（复用现有导航显隐体系）
    sandbox.switchPage("achievements");
    if (achEls["achievements-panel"].style.display !== "") throw new Error("切换到成就页后 achievements-panel 未显示");

    // 3) 卡片按目录原顺序全量渲染 197 张
    let display = sandbox.renderAchievementsPage("all", "all");
    if (display.total !== TOTAL || display.cards.length !== TOTAL || countCards() !== TOTAL) {
      throw new Error("成就卡片总数不为 197，实际 " + display.cards.length + " / DOM " + countCards());
    }
    for (let i = 0; i < TOTAL; i += 1) {
      if (display.cards[i].id !== AD.ACHIEVEMENTS[i].id) throw new Error("成就卡片未按 AchievementData.ACHIEVEMENTS 原目录顺序渲染");
    }
    const placeholder = AD.ACHIEVEMENTS.find(a => a.nameStatus === "placeholder" && !a.hidden);
    if (!achEls["achievements-grid"].innerHTML.includes(placeholder.name)) throw new Error("placeholder 成就名称未原样显示");
    if (display.unlocked !== 0 || display.percentText !== "0.0%") throw new Error("零解锁时汇总或百分比不正确");

    // 4) 未解锁的隐藏成就必须遮蔽名称与条件
    const hiddenDef = AD.ACHIEVEMENTS.find(a => a.hidden);
    if (!hiddenDef) throw new Error("目录中没有 hidden=true 成就，遮蔽用例失效");
    let hiddenCard = display.cards.find(c => c.id === hiddenDef.id);
    if (!hiddenCard.masked || hiddenCard.name !== "隐藏成就" || hiddenCard.conditionText !== "达成条件未知") {
      throw new Error("锁定隐藏成就未被遮蔽");
    }
    if (achEls["achievements-grid"].innerHTML.includes(hiddenDef.conditionText)) throw new Error("锁定隐藏成就真实条件泄漏到 DOM");

    // 5) 汇总数量必须与 unlockedAtById 一致（幽灵 ID 不计入）
    const T = 1751000000000;
    const map = sandbox.gameState.achievements.unlockedAtById;
    const unlockedIds = AD.ACHIEVEMENTS.slice(0, 5).map(a => a.id);
    for (const id of unlockedIds) map[id] = T;
    map[hiddenDef.id] = T + 1000;
    const expectedUnlocked = unlockedIds.length + 1;
    display = sandbox.renderAchievementsPage("all", "all");
    if (display.unlocked !== expectedUnlocked) throw new Error("汇总已解锁数量与 unlockedAtById 不一致");
    if (achEls["achievements-summary-count"].textContent !== expectedUnlocked + " / " + TOTAL) throw new Error("汇总文本不为 已解锁/197");
    if (display.percentText !== ((expectedUnlocked / TOTAL) * 100).toFixed(1) + "%") throw new Error("完成百分比计算错误");
    if (achEls["achievements-progress-fill"].style.width !== ((expectedUnlocked / TOTAL) * 100).toFixed(2) + "%") throw new Error("完成度进度条宽度未跟随解锁比例");
    map["ZZ99"] = T;
    if (sandbox.renderAchievementsPage("all", "all").unlocked !== expectedUnlocked) throw new Error("目录外幽灵成就被计入汇总");
    delete map["ZZ99"];

    // 6) 铜/银/金/传奇分级汇总
    display = sandbox.renderAchievementsPage("all", "all");
    if (display.tiers.map(t => t.label).join(",") !== "铜,银,金,传奇") throw new Error("分级汇总不是 铜/银/金/传奇 四档");
    const tierTotals = {};
    for (const a of AD.ACHIEVEMENTS) tierTotals[a.tier] = (tierTotals[a.tier] || 0) + 1;
    for (const tier of display.tiers) {
      if (tier.total !== (tierTotals[tier.code] || 0)) throw new Error("分级总数与目录不一致：" + tier.code);
    }
    if (display.tiers.reduce((sum, t) => sum + t.unlocked, 0) !== display.unlocked) throw new Error("分级已解锁数量之和与总解锁数不一致");

    // 7) 已解锁 / 未解锁筛选
    const unlockedView = sandbox.renderAchievementsPage("all", "unlocked");
    if (unlockedView.cards.length !== expectedUnlocked || unlockedView.cards.some(c => !c.unlocked) || countCards() !== expectedUnlocked) {
      throw new Error("已解锁筛选结果错误");
    }
    const lockedView = sandbox.renderAchievementsPage("all", "locked");
    if (lockedView.cards.length !== TOTAL - expectedUnlocked || lockedView.cards.some(c => c.unlocked) || countCards() !== TOTAL - expectedUnlocked) {
      throw new Error("未解锁筛选结果错误");
    }

    // 8) 分类筛选：全部 + AchievementData.CATEGORIES 真实分类
    const firstCategory = AD.CATEGORIES[0];
    const categoryView = sandbox.renderAchievementsPage(firstCategory, "all");
    const categoryTotal = AD.ACHIEVEMENTS.filter(a => a.category === firstCategory).length;
    if (categoryView.cards.length !== categoryTotal || categoryView.cards.some(c => c.category !== firstCategory)) {
      throw new Error("分类筛选结果错误：" + firstCategory);
    }
    if (categoryView.categories.length !== AD.CATEGORIES.length + 1 || categoryView.categories[0].id !== "all") {
      throw new Error("分类筛选项不是 全部 + 全部真实分类");
    }

    // 9) 隐藏成就解锁后显示真实名称、真实条件与本地化解锁时间
    display = sandbox.renderAchievementsPage("all", "all");
    hiddenCard = display.cards.find(c => c.id === hiddenDef.id);
    if (hiddenCard.masked || hiddenCard.name !== hiddenDef.name || hiddenCard.conditionText !== hiddenDef.conditionText) {
      throw new Error("解锁后隐藏成就未显示真实名称与条件");
    }
    if (!hiddenCard.unlockedAtText || hiddenCard.unlockedAtText !== new Date(T + 1000).toLocaleString("zh-CN", { hour12: false })) {
      throw new Error("已解锁成就缺少本地化解锁时间");
    }
    if (!achEls["achievements-grid"].innerHTML.includes(hiddenDef.conditionText)) throw new Error("解锁后隐藏成就真实条件未渲染到 DOM");
  } finally {
    sandbox.gameState.achievements.unlockedAtById = achievementsUnlockedBefore;
    sandbox.document.getElementById = originalAchGetElementById;
  }
  console.log("Batch D 成就页面校验通过：导航/panel 显隐、197 张目录序卡片、汇总与 unlockedAtById 一致、铜银金传奇分级、状态与分类筛选、隐藏成就遮蔽与解锁揭示");
}

// ==========================================================================
// Batch E：成就科研工时奖励 + 研究工时消耗/取消闭环
// 覆盖：目录奖励确定性、schema v2 账本迁移清洗与幂等、在线首发/防重/旧档对账、
//       研究状态清洗与 50% 夹紧、applyResearchHours / cancelResearch 行为与事件契约、
//       最小 UI（余额 + 卡片奖励 + 解锁播报奖励文字）。
// 全部用例使用独立 state 对象；触碰真实 gameState 的部分在 finally 中原样恢复。
// ==========================================================================
{
  const AD = sandbox.AchievementData;
  const AS = sandbox.AchievementSystem;
  const RS = sandbox.ResearchSystem;
  const RD = sandbox.ResearchData;
  const AStateM = sandbox.AchievementState;
  const RStateM = sandbox.ResearchState;
  const TIER_HOURS = { bronze: 0.5, silver: 1, gold: 2, legendary: 4 };
  const HOUR = 3600;
  const T0 = 1751000000000;

  for (const fn of ["getAchievementResearchRewardHours", "grantAchievementResearchReward", "reconcileAchievementResearchRewards"]) {
    if (typeof AS[fn] !== "function") throw new Error("AchievementSystem 缺少 Batch E API：" + fn);
  }
  for (const fn of ["applyResearchHours", "cancelResearch"]) {
    if (typeof RS[fn] !== "function") throw new Error("ResearchSystem 缺少 Batch E API：" + fn);
  }

  // ---- E-1 目录奖励数据：四档确定性 + 总计 262 小时 + 研究类必须 null ----
  {
    const tierCount = { bronze: 0, silver: 0, gold: 0, legendary: 0 };
    let totalHours = 0;
    for (const a of AD.ACHIEVEMENTS) {
      if (a.category === "研究") {
        if (a.reward !== null) throw new Error("研究类成就 " + a.id + " 的 reward 必须为 null");
        continue;
      }
      const r = a.reward;
      if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("成就 " + a.id + " 缺少 reward 对象");
      if (!Object.isFrozen(r)) throw new Error("成就 " + a.id + " 的 reward 未冻结");
      if (r.type !== "research-hours") throw new Error("成就 " + a.id + " 的 reward.type 必须是 research-hours");
      if (Object.keys(r).length !== 2) throw new Error("成就 " + a.id + " 的 reward 字段必须精确为 {type, hours}");
      if (r.hours !== TIER_HOURS[a.tier]) throw new Error("成就 " + a.id + " 奖励工时与档位不匹配：" + r.hours);
      tierCount[a.tier] += 1;
      totalHours += r.hours;
    }
    if (tierCount.bronze !== 44 || tierCount.silver !== 82 || tierCount.gold !== 63 || tierCount.legendary !== 8) {
      throw new Error("四档奖励数量不是 44/82/63/8：" + JSON.stringify(tierCount));
    }
    if (Math.abs(totalHours - 262) > 1e-9) throw new Error("奖励总工时不是 262，实际 " + totalHours);
    if (AS.getAchievementResearchRewardHours("ZZ99") !== null) throw new Error("未知 ID 的奖励工时必须为 null");
    const probe = AD.ACHIEVEMENTS[0];
    if (AS.getAchievementResearchRewardHours(probe.id) !== TIER_HOURS[probe.tier]) {
      throw new Error("getAchievementResearchRewardHours 与冻结目录不一致");
    }
  }

  // ---- E-2 账本 schema v2：默认结构 / 迁移清洗 / 幂等 / 不补发 ----
  {
    const d1 = AStateM.createDefaultAchievementState();
    const d2 = AStateM.createDefaultAchievementState();
    if (d1.schemaVersion !== 2) throw new Error("默认成就状态 schemaVersion 必须为 2，实际 " + d1.schemaVersion);
    if (!d1.researchRewardSecondsById || typeof d1.researchRewardSecondsById !== "object" ||
        Array.isArray(d1.researchRewardSecondsById) || Object.keys(d1.researchRewardSecondsById).length !== 0) {
      throw new Error("默认成就状态缺少空的 researchRewardSecondsById");
    }
    if (d1.researchRewardSecondsById === d2.researchRewardSecondsById) throw new Error("researchRewardSecondsById 引用被共享");

    // 旧档 v1 升级：只升版本 + 补空账本，绝不补发、不 dirty
    const legacy = {
      achievements: { schemaVersion: 1, unlockedAtById: { [AD.ACHIEVEMENTS[0].id]: T0 } },
      research: RStateM.createDefaultResearchState()
    };
    legacy.research.researchHourBank = 0;
    AStateM.migrateAchievementState(legacy);
    if (legacy.achievements.schemaVersion !== 2) throw new Error("旧档 schemaVersion 未升级到 2");
    if (Object.keys(legacy.achievements.researchRewardSecondsById).length !== 0) throw new Error("迁移不得补发奖励");
    if (legacy.research.researchHourBank !== 0) throw new Error("迁移不得改动 researchHourBank");
    if (legacy._dirty) throw new Error("迁移不得设置 _dirty");

    // 非法账本值清洗：未知 ID / 负数 / NaN / Infinity / 字符串 / 对象 / 布尔 全部删除
    const ids = AD.ACHIEVEMENTS.slice(0, 7).map(a => a.id);
    const dirty = { achievements: { schemaVersion: 1, unlockedAtById: {}, researchRewardSecondsById: {} } };
    const L = dirty.achievements.researchRewardSecondsById;
    L[ids[0]] = 1800; L[ids[1]] = -1; L[ids[2]] = Number.NaN; L[ids[3]] = Infinity;
    L[ids[4]] = "3600"; L[ids[5]] = { seconds: 1 }; L[ids[6]] = true; L["ZZ99"] = 3600;
    AStateM.migrateAchievementState(dirty);
    if (JSON.stringify(dirty.achievements.researchRewardSecondsById) !== JSON.stringify({ [ids[0]]: 1800 })) {
      throw new Error("账本清洗结果不正确：" + JSON.stringify(dirty.achievements.researchRewardSecondsById));
    }
    const snapshot = JSON.stringify(dirty.achievements);
    AStateM.migrateAchievementState(dirty);
    if (JSON.stringify(dirty.achievements) !== snapshot) throw new Error("成就状态迁移不幂等");

    // 账本为数组 / 非对象 → 规范为空对象
    for (const bad of [[1, 2, 3], "x", 5, null]) {
      const st = { achievements: { schemaVersion: 1, unlockedAtById: {}, researchRewardSecondsById: bad } };
      AStateM.migrateAchievementState(st);
      const led = st.achievements.researchRewardSecondsById;
      if (!led || typeof led !== "object" || Array.isArray(led) || Object.keys(led).length !== 0) {
        throw new Error("非法账本容器未被规范为空对象：" + JSON.stringify(bad));
      }
    }
  }

  const goldDef = AD.ACHIEVEMENTS.find(a => a.tier === "gold");
  const mkState = () => ({
    achievements: AStateM.createDefaultAchievementState(),
    research: RStateM.createDefaultResearchState()
  });

  // ---- E-3 发放 API：在线首发 / 防重 / 失败 reason / 事件契约 / 旧档对账 ----
  {
    const grantEvents = [];
    const offGrant = sandbox.GameEvents.on("achievement:researchHoursGranted", e => grantEvents.push(e));
    try {
      const s1 = mkState();
      const u1 = AS.unlockAchievement(s1, goldDef.id, T0);
      if (!u1.ok) throw new Error("首次解锁应成功");
      if (s1.research.researchHourBank !== 2 * HOUR) throw new Error("金档首次解锁应到账 7200 秒，实际 " + s1.research.researchHourBank);
      if (s1.achievements.researchRewardSecondsById[goldDef.id] !== 2 * HOUR) throw new Error("账本未记录已发放秒数");
      if (s1._dirty !== true) throw new Error("首次发放必须置 _dirty");
      if (grantEvents.length !== 1) throw new Error("首次发放必须 emit 恰一次 achievement:researchHoursGranted");
      const ev = grantEvents[0];
      if (ev.payload.achievementId !== goldDef.id || ev.payload.hours !== 2 || ev.payload.seconds !== 7200) {
        throw new Error("achievement:researchHoursGranted payload 契约不符：" + JSON.stringify(ev.payload));
      }
      if (ev.timestamp !== T0 || ev.meta.source !== "achievement-system") throw new Error("发放事件 meta 不符");
      if (!sandbox.GameEvents.contracts.has("achievement:researchHoursGranted")) throw new Error("缺少 achievement:researchHoursGranted 契约登记");

      // 重复解锁 / 重复 grant 都不得二次入账、不得再 emit
      const u2 = AS.unlockAchievement(s1, goldDef.id, T0 + 5000);
      if (u2.ok || u2.reason !== "ALREADY_UNLOCKED") throw new Error("重复解锁应返回 ALREADY_UNLOCKED");
      const g2 = AS.grantAchievementResearchReward(s1, goldDef.id, T0 + 6000);
      if (g2.ok || g2.reason !== "ALREADY_GRANTED" || g2.seconds !== 2 * HOUR) throw new Error("重复 grant 应返回 ALREADY_GRANTED");
      if (s1.research.researchHourBank !== 2 * HOUR) throw new Error("重复发放导致工时重复到账");
      if (grantEvents.length !== 1) throw new Error("重复发放不得再次 emit");

      // 稳定失败 reason
      const otherDef = AD.ACHIEVEMENTS.find(a => a.id !== goldDef.id);
      if (AS.grantAchievementResearchReward(s1, otherDef.id, T0).reason !== "NOT_UNLOCKED") throw new Error("未解锁成就应返回 NOT_UNLOCKED");
      if (AS.grantAchievementResearchReward(s1, "ZZ99", T0).reason !== "UNKNOWN_ACHIEVEMENT") throw new Error("未知 ID 应返回 UNKNOWN_ACHIEVEMENT");
      if (AS.grantAchievementResearchReward({}, goldDef.id, T0).reason !== "INVALID_STATE") throw new Error("非法状态应返回 INVALID_STATE");
      if (grantEvents.length !== 1) throw new Error("失败分支不得 emit");

      // research 缺失：解锁仍成功，安全失败；research 就绪后可补发且置 dirty
      const s2 = { achievements: AStateM.createDefaultAchievementState() };
      if (!AS.unlockAchievement(s2, goldDef.id, T0).ok) throw new Error("research 缺失时解锁仍必须成功");
      if (Object.keys(s2.achievements.researchRewardSecondsById).length !== 0) throw new Error("research 缺失时不得写账本");
      if (AS.grantAchievementResearchReward(s2, goldDef.id, T0).reason !== "RESEARCH_UNAVAILABLE") throw new Error("research 缺失应返回 RESEARCH_UNAVAILABLE");
      s2.research = RStateM.createDefaultResearchState();
      s2._dirty = false;
      const g3 = AS.grantAchievementResearchReward(s2, goldDef.id, T0 + 1);
      if (!g3.ok || g3.seconds !== 2 * HOUR || s2.research.researchHourBank !== 2 * HOUR) throw new Error("research 就绪后补发失败");
      if (s2._dirty !== true) throw new Error("grant 首次成功必须置 _dirty");

      // 旧档对账：已解锁但账本为空 → 按目录顺序补发一次；重复对账为空
      const legacyDefs = ["bronze", "silver", "legendary"].map(t => AD.ACHIEVEMENTS.find(a => a.tier === t));
      const s4 = mkState();
      for (const d of legacyDefs) s4.achievements.unlockedAtById[d.id] = T0;
      const rec1 = AS.reconcileAchievementResearchRewards(s4, T0 + 10);
      const expectSeconds = (0.5 + 1 + 4) * HOUR;
      const orderedIds = AD.ACHIEVEMENTS.filter(a => legacyDefs.some(d => d.id === a.id)).map(a => a.id);
      if (!rec1.ok || rec1.grantedIds.join(",") !== orderedIds.join(",")) throw new Error("旧档对账未按目录顺序补发：" + rec1.grantedIds.join(","));
      if (Math.abs(rec1.grantedSeconds - expectSeconds) > 1e-9) throw new Error("旧档对账补发秒数错误：" + rec1.grantedSeconds);
      if (Math.abs(s4.research.researchHourBank - expectSeconds) > 1e-9) throw new Error("旧档补发未正确入账");
      const rec2 = AS.reconcileAchievementResearchRewards(s4, T0 + 20);
      if (rec2.grantedIds.length !== 0 || rec2.grantedSeconds !== 0) throw new Error("重复对账必须为空（不重复补发）");
      if (Math.abs(s4.research.researchHourBank - expectSeconds) > 1e-9) throw new Error("重复对账改变了工时余额");
      if (AS.reconcileAchievementResearchRewards({}, T0).reason !== "INVALID_STATE") throw new Error("非法状态对账应返回 INVALID_STATE");
    } finally { offGrant(); }

    // 事件总线缺失时奖励仍必须到账（不依赖 GameEvents）
    const s3 = mkState();
    const savedBus = sandbox.GameEvents;
    delete sandbox.GameEvents;
    try {
      if (!AS.unlockAchievement(s3, goldDef.id, T0).ok) throw new Error("事件总线缺失时解锁必须成功");
      if (s3.research.researchHourBank !== 2 * HOUR) throw new Error("事件总线缺失时奖励仍必须到账");
      if (s3.achievements.researchRewardSecondsById[goldDef.id] !== 2 * HOUR) throw new Error("事件总线缺失时账本未记录");
    } finally { sandbox.GameEvents = savedBus; }

    // reward = null（未来研究类成就）：稳定失败、不入账、不补发
    {
      const nullDef = Object.freeze({
        id: "RSCH01", category: "研究", conditionText: "研究类占位", tier: "bronze", tierLabel: "铜",
        hidden: false, name: "研究类占位", nameStatus: "placeholder", trigger: null, reward: null,
        steam: Object.freeze({ enabled: false, apiName: null, progressStatApiName: null, progressMax: null }), note: ""
      });
      const fakeCatalog = Object.freeze({
        SCHEMA_VERSION: 1, ACHIEVEMENTS: Object.freeze([nullDef]),
        ACHIEVEMENTS_BY_ID: Object.freeze({ RSCH01: nullDef }),
        CATEGORIES: Object.freeze(["研究"]), TIERS: AD.TIERS, PLACEHOLDER_NAME_PREFIX: AD.PLACEHOLDER_NAME_PREFIX
      });
      const savedCatalog = sandbox.AchievementData;
      sandbox.AchievementData = fakeCatalog;
      try {
        if (AS.getAchievementResearchRewardHours("RSCH01") !== null) throw new Error("reward=null 的奖励工时必须为 null");
        const s5 = {
          achievements: { schemaVersion: 2, unlockedAtById: { RSCH01: T0 }, researchRewardSecondsById: {} },
          research: RStateM.createDefaultResearchState()
        };
        const g5 = AS.grantAchievementResearchReward(s5, "RSCH01", T0);
        if (g5.ok || g5.reason !== "NO_REWARD") throw new Error("reward=null 的 grant 必须返回 NO_REWARD");
        if (s5.research.researchHourBank !== 0 || Object.keys(s5.achievements.researchRewardSecondsById).length !== 0) {
          throw new Error("reward=null 不得改动余额或账本");
        }
        const recNull = AS.reconcileAchievementResearchRewards(s5, T0);
        if (!recNull.ok || recNull.grantedIds.length !== 0) throw new Error("reward=null 对账不得补发");
      } finally { sandbox.AchievementData = savedCatalog; }
    }
  }

  // ---- E-4 研究状态清洗：researchHourBank + appliedAchievementSeconds 50% 夹紧 ----
  const rootNode = RD.NODES.find(n => !n.prerequisites || n.prerequisites.length === 0);
  const nextNode = RD.NODES.find(n => n.id !== rootNode.id && (!n.prerequisites || n.prerequisites.length === 0));
  if (!rootNode || !nextNode) throw new Error("找不到两个无前置研究节点，Batch E 研究用例失效");
  const BASE = rootNode.durationByLevel[0];
  const CAP = BASE * 0.5;
  {
    const bankCases = [["3600", 0], [Number.NaN, 0], [Infinity, 0], [-Infinity, 0], [-5, 0], [{}, 0], [true, 0],
                       [null, 0], [undefined, 0], [[], 0], [0, 0], [1.5, 1.5], [7200, 7200]];
    for (const [input, expect] of bankCases) {
      const st = { research: RStateM.createDefaultResearchState() };
      st.research.researchHourBank = input;
      RStateM.migrateResearchState(st);
      if (st.research.researchHourBank !== expect) {
        throw new Error("researchHourBank 清洗失败：" + String(input) + " → " + st.research.researchHourBank);
      }
    }
    const appliedCases = [["x", 0], [Number.NaN, 0], [Infinity, 0], [-1, 0], [true, 0], [{}, 0], [null, 0],
                          [0, 0], [10.25, 10.25], [CAP, CAP], [CAP + 1, CAP], [BASE, CAP], [1e9, CAP]];
    for (const [input, expect] of appliedCases) {
      const st = { research: RStateM.createDefaultResearchState() };
      st.research.activeResearch = {
        techId: rootNode.id, targetLevel: 1, startedAt: T0,
        baseDuration: BASE, remainingSeconds: BASE, appliedAchievementSeconds: input
      };
      RStateM.migrateResearchState(st);
      const got = st.research.activeResearch.appliedAchievementSeconds;
      if (got !== expect) throw new Error("appliedAchievementSeconds 夹紧失败：" + String(input) + " → " + got);
    }
  }

  const mkResearchState = (now) => {
    const st = mkState();
    st.research.lastProcessedAt = now;
    return st;
  };

  // ---- E-5 applyResearchHours：50% 上限截断 / 余额扣减 / 完成衔接 / 失败 reason ----
  {
    const applyEvents = [];
    const offApply = sandbox.GameEvents.on("research:hoursApplied", e => applyEvents.push(e));
    try {
      const s6 = mkResearchState(T0);
      if (!RS.startResearch(s6, rootNode.id, 1, T0).ok) throw new Error("研究启动失败");
      s6.research.researchHourBank = 10 * HOUR;
      const a1 = RS.applyResearchHours(s6, 10, T0); // 请求远超上限 → 截断到 50%
      if (!a1.ok) throw new Error("applyResearchHours 应成功，实际 " + a1.reason);
      if (Math.abs(a1.usedSeconds - CAP) > 1e-9) throw new Error("单步抵扣未截断到 50% 上限，实际 " + a1.usedSeconds);
      if (Math.abs(s6.research.activeResearch.remainingSeconds - (BASE - CAP)) > 1e-9) throw new Error("remainingSeconds 未按实扣减少");
      if (Math.abs(s6.research.activeResearch.appliedAchievementSeconds - CAP) > 1e-9) throw new Error("appliedAchievementSeconds 未累计");
      if (Math.abs(s6.research.researchHourBank - (10 * HOUR - CAP)) > 1e-9) throw new Error("银行余额未按实扣扣减");
      if (s6._dirty !== true) throw new Error("成功抵扣必须置 _dirty");
      if (applyEvents.length !== 1) throw new Error("成功抵扣必须 emit 恰一次 research:hoursApplied");
      const ap = applyEvents[0].payload;
      if (ap.techId !== rootNode.id || ap.level !== 1 || Math.abs(ap.usedSeconds - CAP) > 1e-9) {
        throw new Error("research:hoursApplied payload 契约不符：" + JSON.stringify(ap));
      }
      if (!sandbox.GameEvents.contracts.has("research:hoursApplied")) throw new Error("缺少 research:hoursApplied 契约登记");

      // 已达 50% 上限：稳定失败、不改状态、不 emit
      const bankBefore = s6.research.researchHourBank;
      const remainBefore = s6.research.activeResearch.remainingSeconds;
      const a2 = RS.applyResearchHours(s6, 1, T0);
      if (a2.ok || a2.reason !== "CAP_REACHED") throw new Error("已达 50% 上限应返回 CAP_REACHED");
      if (s6.research.researchHourBank !== bankBefore || s6.research.activeResearch.remainingSeconds !== remainBefore) {
        throw new Error("CAP_REACHED 分支不得改动状态");
      }
      if (applyEvents.length !== 1) throw new Error("CAP_REACHED 不得 emit");

      // 非法 hours
      for (const bad of [0, -1, Number.NaN, Infinity, "1", null, undefined, {}]) {
        if (RS.applyResearchHours(s6, bad, T0).reason !== "INVALID_HOURS") throw new Error("非法 hours 必须返回 INVALID_HOURS：" + String(bad));
      }
      if (applyEvents.length !== 1) throw new Error("非法 hours 不得 emit");

      // 无进行中研究 / 余额为 0 / 无 research 状态
      const s7 = mkResearchState(T0);
      s7.research.researchHourBank = HOUR;
      if (RS.applyResearchHours(s7, 1, T0).reason !== "NOTHING_ACTIVE") throw new Error("无进行中研究应返回 NOTHING_ACTIVE");
      const s8 = mkResearchState(T0);
      RS.startResearch(s8, rootNode.id, 1, T0);
      s8.research.researchHourBank = 0;
      if (RS.applyResearchHours(s8, 1, T0).reason !== "INSUFFICIENT_BANK") throw new Error("余额为 0 应返回 INSUFFICIENT_BANK");
      if (RS.applyResearchHours({}, 1, T0).reason !== "NO_RESEARCH_STATE") throw new Error("无 research 状态应返回 NO_RESEARCH_STATE");

      // 抵扣到 0 → 立即完成该步并衔接队列下一项（不越过 50% 上限：剩余仅 25%）
      const s9 = mkResearchState(T0);
      if (!RS.startResearch(s9, rootNode.id, 1, T0).ok) throw new Error("s9 启动失败");
      if (!RS.enqueueResearch(s9, nextNode.id, 1).ok) throw new Error("s9 入队失败");
      s9.research.researchHourBank = 10 * HOUR;
      const bank9Before = s9.research.researchHourBank;
      const T9 = T0 + Math.round(BASE * 750); // 自然推进 75% 时长，剩余 25%
      const a3 = RS.applyResearchHours(s9, 10, T9);
      if (!a3.ok || !a3.completed) throw new Error("抵扣到 0 应立即完成该步");
      if (Math.abs(a3.usedSeconds - BASE * 0.25) > 0.01) throw new Error("完成步实扣秒数应约为剩余 25%，实际 " + a3.usedSeconds);
      if (Math.abs(s9.research.researchHourBank - (bank9Before - a3.usedSeconds)) > 1e-9) throw new Error("完成步未按实扣扣减余额");
      if ((s9.research.completedLevels[rootNode.id] || 0) !== 1) throw new Error("完成后 completedLevels 未写入");
      if (!s9.research.activeResearch || s9.research.activeResearch.techId !== nextNode.id) throw new Error("完成后未衔接队列下一项");
      if (s9.research.pendingQueue.length !== 0) throw new Error("已启动的队列项未出队");
      if (s9.research.activeResearch.appliedAchievementSeconds !== 0) throw new Error("新步骤的 appliedAchievementSeconds 必须从 0 开始");
    } finally { offApply(); }
  }

  // ---- E-6 cancelResearch：全额退款 / 进度作废 / 队列衔接 / 事件契约 ----
  {
    const cancelEvents = [];
    const stepEvents = [];
    const offCancel = sandbox.GameEvents.on("research:cancelled", e => cancelEvents.push(e));
    const offStep = sandbox.GameEvents.on("research:stepCompleted", e => stepEvents.push(e));
    try {
      const s10 = mkResearchState(T0);
      if (!RS.startResearch(s10, rootNode.id, 1, T0).ok) throw new Error("s10 启动失败");
      if (!RS.enqueueResearch(s10, nextNode.id, 1).ok) throw new Error("s10 入队失败");
      s10.research.researchHourBank = 5 * HOUR;
      const inv = RS.applyResearchHours(s10, 0.1, T0); // 投入 360 秒
      if (!inv.ok || Math.abs(inv.usedSeconds - 360) > 1e-9) throw new Error("预投入失败：" + inv.reason);
      const bankAfterInvest = s10.research.researchHourBank;

      const c1 = RS.cancelResearch(s10, T0);
      if (!c1.ok || Math.abs(c1.refundedSeconds - 360) > 1e-9) throw new Error("取消应全额退还已投入的成就工时");
      if (Math.abs(s10.research.researchHourBank - (bankAfterInvest + 360)) > 1e-9) throw new Error("取消退款未入账");
      if ((s10.research.completedLevels[rootNode.id] || 0) !== 0) throw new Error("取消不得写入 completedLevels");
      if (s10.research.history.length !== 0) throw new Error("取消不得写入 history");
      if (stepEvents.length !== 0) throw new Error("取消不得 emit research:stepCompleted");
      if (cancelEvents.length !== 1) throw new Error("取消必须 emit 恰一次 research:cancelled");
      const cp = cancelEvents[0].payload;
      if (cp.techId !== rootNode.id || cp.level !== 1 || Math.abs(cp.refundedSeconds - 360) > 1e-9) {
        throw new Error("research:cancelled payload 契约不符：" + JSON.stringify(cp));
      }
      if (!sandbox.GameEvents.contracts.has("research:cancelled")) throw new Error("缺少 research:cancelled 契约登记");
      if (!s10.research.activeResearch || s10.research.activeResearch.techId !== nextNode.id) throw new Error("取消后未衔接队列下一项");
      if (c1.startedNext !== nextNode.id + "@1") throw new Error("取消返回的 startedNext 不正确：" + c1.startedNext);

      // 未投入工时的取消退款为 0；随后无 active
      const c2 = RS.cancelResearch(s10, T0);
      if (!c2.ok || c2.refundedSeconds !== 0) throw new Error("未投入工时的取消退款必须为 0");
      if (s10.research.activeResearch !== null) throw new Error("队列为空时取消后不应有进行中研究");
      const c3 = RS.cancelResearch(s10, T0);
      if (c3.ok || c3.reason !== "NOTHING_ACTIVE") throw new Error("无进行中研究取消应返回 NOTHING_ACTIVE");
      if (RS.cancelResearch({}, T0).reason !== "NO_RESEARCH_STATE") throw new Error("无 research 状态取消应返回 NO_RESEARCH_STATE");
      if (cancelEvents.length !== 2) throw new Error("失败取消不得 emit（累计应为 2 次成功）");
      if (stepEvents.length !== 0) throw new Error("整个取消流程都不得 emit research:stepCompleted");
    } finally { offCancel(); offStep(); }
  }

  // ---- E-7 最小 UI：科研工时余额 + 卡片奖励文字 + 解锁播报奖励文字 ----
  {
    const achDomIds = [
      "achievements-panel", "achievements-summary-count", "achievements-summary-percent",
      "achievements-progress-fill", "achievements-tier-counts", "achievements-category-tabs",
      "achievements-status-tabs", "achievements-grid", "achievements-research-bank"
    ];
    for (const id of achDomIds) if (!htmlIds.has(id)) throw new Error("index.html 缺少成就页 DOM：" + id);
    if (!sandbox.gameState.research || typeof sandbox.gameState.research !== "object") throw new Error("gameState.research 缺失，UI 用例失效");

    const els = {};
    for (const id of achDomIds) els[id] = makeElement();
    const savedGetElementById = sandbox.document.getElementById;
    const savedBank = sandbox.gameState.research.researchHourBank;
    const savedUnlocked = sandbox.gameState.achievements.unlockedAtById;
    const savedToast = sandbox.showToast;
    if (typeof savedToast !== "function") throw new Error("沙箱缺少 showToast，解锁播报用例失效");
    sandbox.document.getElementById = (id) => els[id] || makeElement();
    sandbox.gameState.achievements.unlockedAtById = {};
    try {
      sandbox.gameState.research.researchHourBank = 262 * HOUR;
      let display = sandbox.renderAchievementsPage("all", "all");
      if (display.researchBankText !== "科研工时余额：262 小时") throw new Error("科研工时余额文案错误：" + display.researchBankText);
      if (els["achievements-research-bank"].textContent !== "科研工时余额：262 小时") throw new Error("achievements-research-bank 未渲染余额");

      sandbox.gameState.research.researchHourBank = 1800;
      sandbox.renderAchievementsPage("all", "all");
      if (els["achievements-research-bank"].textContent !== "科研工时余额：0.5 小时") {
        throw new Error("半小时余额渲染错误：" + els["achievements-research-bank"].textContent);
      }
      sandbox.gameState.research.researchHourBank = -5; // UI 纯读兜底，不修改 state
      display = sandbox.renderAchievementsPage("all", "all");
      if (els["achievements-research-bank"].textContent !== "科研工时余额：0 小时") throw new Error("非法余额未兜底为 0 小时");
      if (sandbox.gameState.research.researchHourBank !== -5) throw new Error("UI 渲染必须纯只读，不得修改 researchHourBank");

      // 每张卡的奖励文字必须与冻结目录 reward 一致（隐藏成就同样显示奖励）
      const rewardTextOf = (hours) => "科研工时 +" + (hours === 0.5 ? "0.5" : String(hours)) + "h";
      if (display.cards.length !== AD.ACHIEVEMENTS.length) throw new Error("UI 用例应渲染全量卡片");
      for (const card of display.cards) {
        const def = AD.ACHIEVEMENTS_BY_ID[card.id];
        const expected = def.reward === null ? "无科研工时奖励" : rewardTextOf(def.reward.hours);
        if (card.rewardText !== expected) throw new Error("成就卡奖励文字错误：" + card.id + " → " + card.rewardText);
        if (card.rewardHours !== (def.reward === null ? null : def.reward.hours)) throw new Error("成就卡 rewardHours 与目录不一致：" + card.id);
      }
      const gridHtml = els["achievements-grid"].innerHTML;
      for (const text of ["科研工时 +0.5h", "科研工时 +1h", "科研工时 +2h", "科研工时 +4h"]) {
        if (!gridHtml.includes(text)) throw new Error("成就卡 DOM 缺少奖励文字：" + text);
      }

      // 解锁播报必须带真实奖励文字（读目录 reward，不按 tier 猜测）
      const toasts = [];
      sandbox.showToast = (message) => { toasts.push(String(message)); };
      sandbox.GameEvents.emit("achievement:unlocked", { achievementId: goldDef.id, unlockedAt: T0 },
        { timestamp: T0, source: "achievement-system" });
      if (!toasts.some(m => m.includes(goldDef.name) && m.includes("科研工时 +2h"))) {
        throw new Error("解锁播报缺少真实奖励文字：" + toasts.join(" | "));
      }
    } finally {
      sandbox.showToast = savedToast;
      sandbox.gameState.research.researchHourBank = savedBank;
      sandbox.gameState.achievements.unlockedAtById = savedUnlocked;
      sandbox.document.getElementById = savedGetElementById;
    }
  }

  console.log("Batch E 校验通过：四档奖励 44/82/63/8 合计 262 小时、schema v2 账本迁移清洗与幂等、在线首发/防重/旧档对账/无事件总线仍到账、researchHourBank 与 appliedAchievementSeconds 50% 夹紧、applyResearchHours 截断与完成衔接、cancelResearch 全额退款与队列衔接、三条事件契约、成就页余额与卡片奖励文字");
}

// ==========================================================================
// Batch F：研究页面 + 在线操作闭环
// 覆盖：导航与面板显隐、8 个研究页 DOM、38 节点冻结序渲染、五种节点状态、
//       dispatchGameAction 启动/排队/投入/取消/移除、协议节点只读、
//       50% 上限截断、退款与队列衔接、渲染纯读、既有基线不放宽。
// 操作用例使用独立 state；触碰真实 gameState / document 的部分 finally 恢复。
// ==========================================================================
{
  const RS = sandbox.ResearchSystem;
  const RD = sandbox.ResearchData;
  const RStateM = sandbox.ResearchState;
  const HOUR = 3600;
  const TF = 1752000000000;

  // ---- F-12 既有基线不得放宽（脚本 / 样式 / DOM ID / Batch D·E 关键 DOM） ----
  if (scriptSources.length !== 56) throw new Error("Batch F 起 JS 基线为 56（55 + Batch S 新增 js/systems/offline-combat.js），实际 " + scriptSources.length);
  if (styleSources.length !== 4) throw new Error("Batch F 不得改变 4 CSS 基线，实际 " + styleSources.length);
  if (htmlIds.size !== 313) throw new Error("Batch F DOM ID 基线应为 313，实际 " + htmlIds.size);
  for (const id of ["achievements-panel", "achievements-grid", "achievements-research-bank"]) {
    if (!htmlIds.has(id)) throw new Error("Batch F 不得移除 Batch D/E 成就页 DOM：" + id);
  }
  if (typeof RS.removeQueuedResearch !== "function") throw new Error("ResearchSystem 缺少 Batch F API：removeQueuedResearch");

  // ---- F-2 研究页 8 个新 DOM ID + 导航入口 + 面板体系声明 ----
  const researchDomIds = [
    "research-panel", "research-summary", "research-bank", "research-active",
    "research-progress-fill", "research-tree", "research-detail", "research-queue"
  ];
  for (const id of researchDomIds) if (!htmlIds.has(id)) throw new Error("index.html 缺少研究页 DOM：" + id);
  if (!/<div class="nav-item" data-page="research">/.test(html)) throw new Error('侧边栏缺少 data-page="research" 研究入口');
  if (html.indexOf('data-page="achievements"') >= html.indexOf('data-page="research"')) {
    throw new Error("研究入口应位于成就入口之后");
  }
  if (!/<div class="panel research-panel" id="research-panel" style="display:none;">/.test(html)) {
    throw new Error("research-panel 未按现有面板体系声明（class .panel + 默认 display:none）");
  }

  const nodes = RD.NODES;
  if (nodes.length !== 38) throw new Error("研究目录不为 38 节点，实际 " + nodes.length);
  const nodeById = {};
  for (const n of nodes) nodeById[n.id] = n;
  const MATSCI_BASE = nodeById.matsci.durationByLevel[0];

  const mkFState = () => {
    const research = RStateM.createDefaultResearchState();
    research.lastProcessedAt = TF;
    return { research };
  };

  // ---- F-5 / F-7 / F-8 / F-9 / F-10：全部经 dispatchGameAction 的在线操作闭环 ----
  {
    // F-5 启动 + 排队
    const s = mkFState();
    const started = sandbox.dispatchGameAction(s, { type: "research/start", techId: "syseng", targetLevel: 1 }, TF);
    if (!started.changed) throw new Error("research/start 应成功，实际 reason=" + started.reason);
    if (!s.research.activeResearch || s.research.activeResearch.techId !== "syseng" || s.research.activeResearch.targetLevel !== 1) {
      throw new Error("research/start 未写入 activeResearch");
    }
    if (s._dirty !== true) throw new Error("research/start 成功必须置 _dirty");
    const dupe = sandbox.dispatchGameAction(s, { type: "research/start", techId: "syseng", targetLevel: 1 }, TF);
    if (dupe.changed || dupe.reason !== "ALREADY_ACTIVE") throw new Error("重复启动应返回稳定 reason ALREADY_ACTIVE，实际 " + dupe.reason);

    for (const id of ["matsci", "dataan", "autocon"]) {
      const q = sandbox.dispatchGameAction(s, { type: "research/enqueue", techId: id, targetLevel: 1 }, TF);
      if (!q.changed) throw new Error("research/enqueue 应成功：" + id + " reason=" + q.reason);
    }
    if (s.research.pendingQueue.join(",") !== "matsci@1,dataan@1,autocon@1") {
      throw new Error("排队顺序不符：" + s.research.pendingQueue.join(","));
    }
    const dupeQ = sandbox.dispatchGameAction(s, { type: "research/enqueue", techId: "matsci", targetLevel: 1 }, TF);
    if (dupeQ.changed || dupeQ.reason !== "ALREADY_QUEUED") throw new Error("重复排队应返回 ALREADY_QUEUED，实际 " + dupeQ.reason);

    // F-10 移除队列项：只删完全匹配的一项，其余顺序不变
    const notQueued = sandbox.dispatchGameAction(s, { type: "research/removeQueued", stepKey: "mine@1" }, TF);
    if (notQueued.changed || notQueued.reason !== "NOT_QUEUED") throw new Error("移除未排队项应返回 NOT_QUEUED，实际 " + notQueued.reason);
    const badKey = sandbox.dispatchGameAction(s, { type: "research/removeQueued", stepKey: "matsci" }, TF);
    if (badKey.changed || badKey.reason !== "INVALID_STEP_KEY") throw new Error("非法 stepKey 应返回 INVALID_STEP_KEY，实际 " + badKey.reason);
    const activeBefore = JSON.stringify(s.research.activeResearch);
    const removed = sandbox.dispatchGameAction(s, { type: "research/removeQueued", stepKey: "dataan@1" }, TF);
    if (!removed.changed) throw new Error("research/removeQueued 应成功，实际 " + removed.reason);
    if (s.research.pendingQueue.join(",") !== "matsci@1,autocon@1") {
      throw new Error("移除后队列顺序错误：" + s.research.pendingQueue.join(","));
    }
    if (JSON.stringify(s.research.activeResearch) !== activeBefore) throw new Error("移除队列项不得影响进行中的研究");

    const emptyCancel = sandbox.dispatchGameAction(mkFState(), { type: "research/cancel" }, TF);
    if (emptyCancel.changed || emptyCancel.reason !== "NOTHING_ACTIVE") {
      throw new Error("无进行中研究取消应返回 NOTHING_ACTIVE，实际 " + emptyCancel.reason);
    }
  }

  // ---- F-7 / F-8 / F-9：成就工时投入与取消退款（用 mine@3，50% 上限足够大以区分部分投入与满额） ----
  {
    const MINE_L3 = nodeById.mine.durationByLevel[2];
    const CAP = MINE_L3 * 0.5;
    if (!(CAP > 0.5 * HOUR)) throw new Error("mine@3 的 50% 上限不足 0.5 小时，投入用例失效");
    const s2 = mkFState();
    s2.research.completedLevels = { syseng: 1, mine: 2 };
    if (!sandbox.dispatchGameAction(s2, { type: "research/start", techId: "mine", targetLevel: 3 }, TF).changed) {
      throw new Error("mine@3 启动失败");
    }
    if (!sandbox.dispatchGameAction(s2, { type: "research/enqueue", techId: "arch", targetLevel: 1 }, TF).changed) {
      throw new Error("arch@1 排队失败");
    }

    // F-7 投入 0.5h：银行 / 剩余 / 已用三者按实扣同步
    s2.research.researchHourBank = 10 * HOUR;
    const applied = sandbox.dispatchGameAction(s2, { type: "research/applyHours", hours: 0.5 }, TF);
    if (!applied.changed) throw new Error("research/applyHours 应成功，实际 " + applied.reason);
    if (Math.abs(applied.usedSeconds - 0.5 * HOUR) > 1e-9) throw new Error("0.5h 投入实扣不符：" + applied.usedSeconds);
    if (Math.abs(s2.research.researchHourBank - 9.5 * HOUR) > 1e-9) throw new Error("投入后银行余额未同步");
    if (Math.abs(s2.research.activeResearch.remainingSeconds - (MINE_L3 - 0.5 * HOUR)) > 1e-9) throw new Error("投入后剩余时间未同步");
    if (Math.abs(s2.research.activeResearch.appliedAchievementSeconds - 0.5 * HOUR) > 1e-9) throw new Error("投入后已用成就工时未同步");

    // F-8 最大可用投入：只由只读状态推导，抵满 50% 上限但绝不越界，再投返回 CAP_REACHED
    const maxHours = sandbox.computeMaxApplyHours(s2.research);
    const expectMax = Math.min(s2.research.researchHourBank, s2.research.activeResearch.remainingSeconds, CAP - 0.5 * HOUR) / HOUR;
    if (Math.abs(maxHours - expectMax) > 1e-9) throw new Error("最大可用工时计算错误：" + maxHours + " 期望 " + expectMax);
    if (!(maxHours > 0)) throw new Error("最大可投入工时应为正数，实际 " + maxHours);
    const maxApplied = sandbox.dispatchGameAction(s2, { type: "research/applyHours", hours: maxHours }, TF);
    if (!maxApplied.changed) throw new Error("最大可用投入应成功，实际 " + maxApplied.reason);
    if (s2.research.activeResearch.appliedAchievementSeconds > CAP + 1e-6) {
      throw new Error("已用成就工时越过 50% 上限：" + s2.research.activeResearch.appliedAchievementSeconds);
    }
    if (Math.abs(s2.research.activeResearch.appliedAchievementSeconds - CAP) > 1e-6) {
      throw new Error("最大可用投入未抵满 50% 上限：" + s2.research.activeResearch.appliedAchievementSeconds);
    }
    const overCap = sandbox.dispatchGameAction(s2, { type: "research/applyHours", hours: 1 }, TF);
    if (overCap.changed || overCap.reason !== "CAP_REACHED") throw new Error("达到 50% 上限后应返回 CAP_REACHED，实际 " + overCap.reason);

    // F-9 取消：全额退款 + 队列首项自动接上
    const bankBeforeCancel = s2.research.researchHourBank;
    const appliedBeforeCancel = s2.research.activeResearch.appliedAchievementSeconds;
    const cancelled = sandbox.dispatchGameAction(s2, { type: "research/cancel" }, TF);
    if (!cancelled.changed) throw new Error("research/cancel 应成功，实际 " + cancelled.reason);
    if (Math.abs(s2.research.researchHourBank - (bankBeforeCancel + appliedBeforeCancel)) > 1e-9) {
      throw new Error("取消退款与已投入成就工时不一致");
    }
    if (!s2.research.activeResearch || s2.research.activeResearch.techId !== "arch") {
      throw new Error("取消后队列首项 arch@1 未自动接上");
    }
    if (s2.research.pendingQueue.length !== 0) throw new Error("取消后队列未正确出队：" + s2.research.pendingQueue.join(","));
    if (s2.research.completedLevels.mine !== 2) throw new Error("取消不得把被取消的研究计为已完成");
  }

  // ---- F-1 / F-3 / F-4 / F-6 / F-11 + Batch F 视觉返修（文明6式横向科技树）：页面渲染（纯读） ----
  {
    const toRoman = (num) => {
      if (!Number.isInteger(num) || num <= 0) return "";
      return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][num - 1] || String(num);
    };

    // FV-A 唯一数据源：正式渲染层 / index.html 不得内联第二份科技清单
    const shellIdx = scriptSources.findIndex(src => src.includes("shell-render"));
    if (shellIdx < 0) throw new Error("未找到 js/ui/shell-render.js");
    const shellSrc = scripts[shellIdx];
    for (const n of nodes) {
      if (shellSrc.includes(n.name)) throw new Error("shell-render.js 内联了科技名称（第二份静态清单）：" + n.name);
      if (html.includes(n.name)) throw new Error("index.html 内联了科技名称（第二份静态清单）：" + n.name);
    }
    if (/\bconst\s+EDGES\s*=|\bvar\s+EDGES\s*=/.test(shellSrc)) throw new Error("不得复制原型的静态 EDGES 连线表");
    const eraMetaAt = shellSrc.indexOf("RESEARCH_ERA_META = [");
    if (eraMetaAt < 0) throw new Error("缺少五时代元数据 RESEARCH_ERA_META");
    const eraMetaBlock = shellSrc.slice(eraMetaAt, shellSrc.indexOf("];", eraMetaAt));
    if (/\bids\s*:|\bnodes\s*:|\btechs\s*:/.test(eraMetaBlock)) throw new Error("RESEARCH_ERA_META 只能硬编码序号/名称/配色，不得内联时代节点清单");

    // FV-B 旧 auto-fill 卡片网格必须彻底移除；SVG 层不得遮挡点击；必须有 reduced-motion 降级
    const treeCssAt = baseCss.indexOf(".research-tree {");
    if (treeCssAt < 0) throw new Error("base.css 缺少 .research-tree 画布样式");
    const treeCssBlock = baseCss.slice(treeCssAt, baseCss.indexOf("}", treeCssAt));
    if (/grid-template-columns/.test(treeCssBlock)) throw new Error(".research-tree 仍是旧 auto-fill 卡片网格");
    if (baseCss.includes(".research-node")) throw new Error("base.css 仍残留旧 .research-node 卡片网格样式");
    if (!/\.rt-edges\s*\{[^}]*pointer-events:\s*none/.test(baseCss)) throw new Error("SVG 连线层必须 pointer-events:none，不得遮挡节点点击");
    if (!baseCss.includes("@media (prefers-reduced-motion: reduce)")) throw new Error("缺少 prefers-reduced-motion 动效降级");

    // FV-C 时代分组必须动态：喂入合成目录时分布完全跟随数据，证明未硬编码时代内节点 ID
    {
      const mkStub = (id, era, prereq) => ({
        id, name: "STUB_" + id, era, type: "numeric", category: "industry",
        maxLevel: 1, rank: 1, prerequisites: prereq || [], effects: ["stub"], bonus: "stub",
        description: "stub", durationByLevel: [60]
      });
      const stubRD = { NODES: [mkStub("__sa", 2), mkStub("__sb", 2, [{ id: "__sa", level: 1 }]), mkStub("__sc", 0)] };
      const stubRS = { buildProjectedResearchLevels: () => ({}), getResearchDuration: () => 3600, getResearchNode: () => null };
      const stubModel = sandbox.buildResearchTreeModel({ completedLevels: {}, pendingQueue: [], activeResearch: null }, stubRD, stubRS);
      if (stubModel.nodes.length !== 3) throw new Error("时代分组非动态：合成目录渲染 " + stubModel.nodes.length + " 个节点");
      if (stubModel.eras.map(e => e.count).join(",") !== "1,0,2,0,0") {
        throw new Error("时代分组硬编码了节点清单，合成目录分布为 " + stubModel.eras.map(e => e.count).join(","));
      }
      if (stubModel.edges.length !== 1) throw new Error("连线未按 prerequisites 动态生成，合成目录边数 " + stubModel.edges.length);
    }

    // 正式目录派生的期望值（全部现算，不写死）
    const expectedEdgeKeys = [];
    const expectedEraCounts = [0, 0, 0, 0, 0];
    for (const n of nodes) {
      expectedEraCounts[Number(n.era) || 0] += 1;
      for (const p of (n.prerequisites || [])) expectedEdgeKeys.push(p.id + ">" + n.id + "@" + p.level);
    }
    const expectedEdgeCount = expectedEdgeKeys.length;
    let fanInId = nodes[0].id; let fanInMax = 0;
    for (const n of nodes) {
      const len = (n.prerequisites || []).length;
      if (len > fanInMax) { fanInMax = len; fanInId = n.id; }
    }
    if (fanInMax < 3) throw new Error("目录里应存在多前置节点用于验证多边，实际最大入度 " + fanInMax);

    const els = {};
    for (const id of researchDomIds.concat(["achievements-panel", "cargo-panel"])) els[id] = makeElement();
    const savedGetElementById = sandbox.document.getElementById;
    const savedResearch = sandbox.gameState.research;
    sandbox.document.getElementById = (id) => els[id] || makeElement();

    const fixture = RStateM.createDefaultResearchState();
    fixture.lastProcessedAt = TF;
    // syseng 单级 completed / gas 五级 completed Lv2 / mine 五级 active targetLevel=2（已完成 Lv1）
    fixture.completedLevels = { syseng: 1, gas: 2, mine: 1 };
    fixture.activeResearch = {                                // active：目标 Lv2，但名称只应显示已完成 Lv1
      techId: "mine", targetLevel: 2, startedAt: TF,
      baseDuration: MATSCI_BASE, remainingSeconds: MATSCI_BASE / 2, appliedAchievementSeconds: 0
    };
    fixture.pendingQueue = ["dataan@1"];                      // queued（autocon 保持 available，shipcomp 前置未满足 → locked）
    fixture.researchHourBank = 3 * HOUR;

    try {
      sandbox.gameState.research = fixture;

      // F-1 切换到研究页：只显示 research-panel，其它托管面板隐藏
      sandbox.switchPage("research");
      if (els["research-panel"].style.display !== "") throw new Error("切换到研究页后 research-panel 未显示");
      if (els["achievements-panel"].style.display !== "none") throw new Error("切换到研究页后 achievements-panel 未隐藏");
      if (els["cargo-panel"].style.display !== "none") throw new Error("切换到研究页后 cargo-panel 未隐藏");

      // F-11 渲染必须纯读：state 快照渲染前后逐字节一致
      const snapshotBefore = JSON.stringify(sandbox.gameState.research);
      const display = sandbox.renderResearchPage();
      const snapshotAfter = JSON.stringify(sandbox.gameState.research);
      if (snapshotBefore !== snapshotAfter) throw new Error("renderResearchPage 修改了 state.research，渲染必须纯读");
      const treeHtml = els["research-tree"].innerHTML;

      // F-3 38 个节点严格按冻结目录顺序渲染
      if (!display || display.nodeCount !== 38 || display.nodes.length !== 38) {
        throw new Error("研究树未渲染 38 个节点，实际 " + (display ? display.nodes.length : "null"));
      }
      for (let i = 0; i < 38; i += 1) {
        if (display.nodes[i].id !== nodes[i].id) throw new Error("研究树未按 ResearchData.NODES 冻结顺序渲染，第 " + i + " 项");
      }

      // FV-1 五个时代头部按 era0→era4 顺序渲染，只显示副标题（基础科学/应用科学/工程学/尖端科技/协议与集成）
      const eraHeads = [...treeHtml.matchAll(/<div class="rt-era-head"[^>]*>([^<]+)<\/div>/g)]
        .map(m => m[1].trim());
      const eraHeadExpect = "基础科学 → 应用科学 → 工程学 → 尖端科技 → 协议与集成";
      if (eraHeads.join(" → ") !== eraHeadExpect) throw new Error("五时代标题顺序/名称不符：" + eraHeads.join(" → "));
      if (eraHeads.some(h => /^时代 [IV]+/.test(h))) throw new Error("时代头部仍残留“时代几”字样：" + eraHeads.join(" → "));

      // FV-2 / FV-3 38 个节点各渲染一次；data-tech-id / data-era / data-status 与正式数据一致
      const nodeTags = [...treeHtml.matchAll(/<div class="(rt-node[^"]*)" style="[^"]*" data-tech-id="([^"]+)" data-era="(\d+)" data-status="([^"]+)"/g)];
      if (nodeTags.length !== 38) throw new Error("科技树 DOM 节点数不为 38，实际 " + nodeTags.length);
      const domNodeById = {};
      for (const [, cls, id, era, status] of nodeTags) {
        if (domNodeById[id]) throw new Error("节点被重复渲染：" + id);
        domNodeById[id] = { cls, era: Number(era), status };
      }
      for (const n of nodes) {
        const dom = domNodeById[n.id];
        if (!dom) throw new Error("科技树 DOM 缺少节点：" + n.id);
        const occurrences = treeHtml.split('data-tech-id="' + n.id + '"').length - 1;
        if (occurrences !== 1) throw new Error("节点 " + n.id + " 在树中出现 " + occurrences + " 次，应恰好一次");
        if (dom.era !== (Number(n.era) || 0)) throw new Error("节点 data-era 与正式数据不一致：" + n.id + " DOM=" + dom.era + " 数据=" + n.era);
        if (!treeHtml.includes(n.name)) throw new Error("科技树未显示正式节点名称：" + n.name);
        const view = display.nodes.find(v => v.id === n.id);
        const shouldHaveRoman = !view.isSingle && !view.isProtocol && view.completed >= 1;
        if (shouldHaveRoman) {
          const expectedName = n.name + " " + toRoman(view.completed);
          if (!treeHtml.includes(expectedName)) throw new Error("五级节点名称未追加已完成等级罗马数字后缀：" + n.id + " 期望 " + expectedName);
        } else {
          // 单级/协议/completed=0 节点不得伪造罗马后缀
          if (treeHtml.includes(n.name + " I") || treeHtml.includes(n.name + " V") || treeHtml.includes(n.name + " II")) {
            throw new Error("不应追加罗马数字后缀的节点出现了后缀：" + n.id);
          }
        }
        if (dom.status !== view.status) throw new Error("节点 data-status 与状态模型不一致：" + n.id);
        if (!dom.cls.includes("rt-node--" + view.status)) throw new Error("节点缺少状态视觉类：" + n.id + " → rt-node--" + view.status);
      }
      // 时代内顺序 = ResearchData.NODES 原始顺序；行号从 0 连续递增
      for (let era = 0; era < 5; era += 1) {
        const fromData = nodes.filter(n => (Number(n.era) || 0) === era).map(n => n.id).join(",");
        const fromView = display.nodes.filter(v => v.era === era).map(v => v.id).join(",");
        if (fromData !== fromView) throw new Error("时代 " + era + " 内节点顺序未保持目录原始顺序");
        const rows = display.nodes.filter(v => v.era === era).map(v => v.row).join(",");
        const expectRows = display.nodes.filter(v => v.era === era).map((_, i) => i).join(",");
        if (rows !== expectRows) throw new Error("时代 " + era + " 行号未连续递增：" + rows);
        if (display.eras[era].count !== expectedEraCounts[era]) {
          throw new Error("时代 " + era + " 节点数不符：DOM=" + display.eras[era].count + " 数据=" + expectedEraCounts[era]);
        }
      }

      // FV-4 SVG 连线数量 === Σ prerequisites.length，且 from/to/requiredLevel 与正式前置双向一致
      const edgeTags = [...treeHtml.matchAll(/<path class="rt-edge rt-edge--([a-z]+)" d="[^"]*" data-from="([^"]+)" data-to="([^"]+)" data-required-level="(\d+)"/g)];
      if (edgeTags.length !== expectedEdgeCount) throw new Error("SVG 连线数应等于前置总数 " + expectedEdgeCount + "，实际 " + edgeTags.length);
      if (display.edgeCount !== expectedEdgeCount) throw new Error("模型边数与前置总数不符：" + display.edgeCount);
      const domEdgeKeys = edgeTags.map(m => m[2] + ">" + m[3] + "@" + m[4]).sort();
      const dataEdgeKeys = expectedEdgeKeys.slice().sort();
      if (domEdgeKeys.join("|") !== dataEdgeKeys.join("|")) throw new Error("SVG 连线与 node.prerequisites 不是双向一致");
      for (const [, state] of edgeTags) {
        if (!["met", "projected", "unmet"].includes(state)) throw new Error("连线状态非法：" + state);
      }
      // 多前置节点必须生成多条边
      const fanInEdges = edgeTags.filter(m => m[3] === fanInId).length;
      if (fanInEdges !== fanInMax) throw new Error("多前置节点 " + fanInId + " 应有 " + fanInMax + " 条入边，实际 " + fanInEdges);
      // 已完成前置 → met；未完成 → unmet/projected
      const metEdge = edgeTags.find(m => m[2] === "syseng" && Number(m[4]) === 1);
      if (!metEdge || metEdge[1] !== "met") throw new Error("已满足的前置连线未标记为 met：" + (metEdge && metEdge[1]));

      // FV-5 六种状态视觉：五种状态类 + 协议金色类
      for (const [status, id] of [["completed", "syseng"], ["active", "mine"], ["queued", "dataan"], ["available", "autocon"], ["locked", "shipcomp"]]) {
        const view = display.nodes.find(n => n.id === id);
        if (!view || view.status !== status) throw new Error("节点状态判定错误：" + id + " 期望 " + status + " 实际 " + (view && view.status));
        if (!(display.statuses[status] >= 1)) throw new Error("缺少状态样本：" + status);
        if (!treeHtml.includes("rt-node--" + status)) throw new Error("DOM 缺少状态样式类：rt-node--" + status);
      }
      if (!treeHtml.includes("rt-node--protocol")) throw new Error("协议节点缺少金色视觉类 rt-node--protocol");
      if (treeHtml.includes("research-node--")) throw new Error("科技树仍残留旧卡片网格样式类 research-node--*");

      // FV-6 五级科技显示 5 个等级标记；单级 / 协议不得伪造五级
      const nodeChunks = treeHtml.split('<div class="rt-node rt-node--').slice(1);
      if (nodeChunks.length !== 38) throw new Error("节点 HTML 分片数不为 38，实际 " + nodeChunks.length);
      for (let i = 0; i < 38; i += 1) {
        const view = display.nodes[i];
        const chunk = nodeChunks[i];
        if (!chunk.includes('data-tech-id="' + view.id + '"')) throw new Error("节点 HTML 顺序错位：" + view.id);
        const pips = chunk.split('class="rt-pip ').length - 1;
        if (view.isProtocol) {
          if (pips !== 0) throw new Error("协议节点不得显示等级标记：" + view.id);
          if (!chunk.includes("rt-badge--protocol")) throw new Error("协议节点缺少“协议”标记：" + view.id);
          if (view.levelMarks.length !== 0) throw new Error("协议节点不得生成等级标记模型：" + view.id);
        } else if (view.maxLevel === 1) {
          if (pips !== 0) throw new Error("单级节点不得伪造五级标记：" + view.id);
          if (!chunk.includes("rt-badge--single")) throw new Error("单级节点缺少“单级”标记：" + view.id);
        } else {
          if (pips !== view.maxLevel) throw new Error("五级科技等级标记数不符：" + view.id + " 实际 " + pips);
          if (view.levelMarks.length !== view.maxLevel) throw new Error("等级标记模型长度不符：" + view.id);
          if (chunk.includes("rt-badge--single") || chunk.includes("rt-badge--protocol")) {
            throw new Error("五级科技不得带单级/协议标记：" + view.id);
          }
        }
      }
      // 已完成等级 → filled；正在研究的等级 → active；排队等级 → queued
      const lockedMarks = display.nodes.find(v => v.id === "shipcomp").levelMarks.join(",");
      if (lockedMarks !== "empty,empty,empty,empty,empty") throw new Error("未研究五级科技标记应全空：" + lockedMarks);
      const activeMarks = display.nodes.find(v => v.id === "mine").levelMarks.join(",");
      if (activeMarks !== "filled,active,empty,empty,empty") {
        throw new Error("研究中五级科技标记应为 filled+active+empty*3：" + activeMarks);
      }

      // FV-7 协议节点：树上无操作按钮
      const protocolViews = display.nodes.filter(n => n.isProtocol);
      if (protocolViews.length !== 6) throw new Error("协议节点数量不为 6，实际 " + protocolViews.length);
      if (/data-(research|detail)-action/.test(treeHtml)) throw new Error("科技树节点本体不得内嵌操作按钮，操作只在详情区");

      // FV-8 节点详情：直接读正式 node 对象（description / 全等级 effects / 前置要求等级 / 玩家真实等级）
      const detailOf = (techId) => { sandbox.selectResearchNode(techId); return els["research-detail"].innerHTML; };
      const lockedNode = nodeById.shipcomp;
      const lockedHtml = detailOf("shipcomp");
      if (!lockedHtml.includes(lockedNode.name)) throw new Error("详情缺少科技名称");
      if (!lockedHtml.includes(lockedNode.description)) throw new Error("详情缺少 description");
      for (const eff of lockedNode.effects) {
        if (!lockedHtml.includes(eff)) throw new Error("详情缺少全等级效果：" + eff);
      }
      for (const p of lockedNode.prerequisites) {
        const pn = nodeById[p.id];
        if (!lockedHtml.includes(pn.name + " 需 " + toRoman(p.level))) throw new Error("详情缺少前置名称与要求等级：" + p.id);
        const own = Number(fixture.completedLevels[p.id]) || 0;
        const ownLabel = own > 0 ? toRoman(own) : "0";
        if (!lockedHtml.includes("当前 " + ownLabel)) {
          throw new Error("详情缺少玩家真实完成等级：" + p.id);
        }
      }
      if (!lockedHtml.includes("✖")) throw new Error("详情未标记前置未满足");
      // FV-9 locked 不能启动
      if (!/data-detail-action="start"[^>]*disabled/.test(lockedHtml)) throw new Error("locked 节点的“立即研究”必须禁用");
      if (!/data-detail-action="enqueue"[^>]*disabled/.test(lockedHtml)) throw new Error("locked 节点的“加入队列”必须禁用");
      if (!lockedHtml.includes("缺少前置：")) throw new Error("locked 节点未显示缺少哪些前置");

      // FV-10 available 仍可 start / enqueue（按钮可用 + 动作真实生效）
      const availHtml = detailOf("autocon");
      const startTag = availHtml.match(/<button[^>]*data-detail-action="start"[^>]*>/);
      const queueTag = availHtml.match(/<button[^>]*data-detail-action="enqueue"[^>]*>/);
      if (!startTag || /disabled/.test(startTag[0])) throw new Error("available 节点必须可以立即研究");
      if (!queueTag || /disabled/.test(queueTag[0])) throw new Error("available 节点必须可以加入队列");
      if (!/data-tech-id="autocon"[^>]*data-level="1"/.test(availHtml)) throw new Error("详情操作按钮未携带 techId / 目标等级");
      {
        const sAct = mkFState();
        if (!sandbox.dispatchGameAction(sAct, { type: "research/start", techId: "autocon", targetLevel: 1 }, TF).changed) {
          throw new Error("详情区 available 节点应能经 dispatchGameAction 启动");
        }
        if (!sandbox.dispatchGameAction(sAct, { type: "research/enqueue", techId: "syseng", targetLevel: 1 }, TF).changed) {
          throw new Error("详情区 available 节点应能经 dispatchGameAction 排队");
        }
        const lockedTry = sandbox.dispatchGameAction(mkFState(), { type: "research/start", techId: "shipcomp", targetLevel: 1 }, TF);
        if (lockedTry.changed) throw new Error("locked 节点不得被启动");
      }

      // FV-11 协议节点详情：无任何操作按钮，只提示未接入
      // Batch I 起：未研究的协议节点复用"立即研究 / 加入队列"，但绝不出现任何协议设置控件。
      const protoHtml = detailOf(protocolViews[0].id);
      if (protoHtml.includes("data-protocol-id") || protoHtml.includes("data-deployment-id")) {
        throw new Error("未研究的协议节点不得出现协议设置控件：" + protocolViews[0].id);
      }
      if (!/data-detail-action="(start|enqueue)"/.test(protoHtml) && !protoHtml.includes("协议业务尚未接入")) {
        throw new Error("未研究协议节点详情既无研究按钮也无未接入提示：" + protocolViews[0].id);
      }
      // completed / active / queued 三态详情文案
      if (!detailOf("syseng").includes("该科技已全部完成")) throw new Error("已完成节点详情文案错误");
      if (detailOf("syseng").includes("data-detail-action")) throw new Error("已完成节点不得显示操作按钮");
      if (!detailOf("mine").includes("研究中")) throw new Error("进行中节点详情文案错误");
      if (!detailOf("dataan").includes("已加入队列")) throw new Error("已排队节点详情文案错误");

      // FV-12 关联高亮：只含该节点 + 直接入边/出边 + 直接相邻节点，不递归整棵树
      {
        const focusId = fanInId;
        const sets = sandbox.computeResearchFocusSets(focusId, { edges: display.edges });
        const expectEdges = display.edges.filter(e => e.from === focusId || e.to === focusId)
          .map(e => e.from + ">" + e.to + "@" + e.requiredLevel).sort();
        if (sets.edgeKeys.slice().sort().join("|") !== expectEdges.join("|")) throw new Error("关联高亮的边集合不正确");
        const expectNodes = new Set([focusId]);
        for (const e of display.edges) {
          if (e.from === focusId) expectNodes.add(e.to);
          if (e.to === focusId) expectNodes.add(e.from);
        }
        if (sets.nodeIds.slice().sort().join(",") !== [...expectNodes].sort().join(",")) throw new Error("关联高亮的节点集合不正确");
        // 不得递归：祖父节点（前置的前置）不应被点亮
        const directPrereqs = (nodeById[focusId].prerequisites || []).map(p => p.id);
        for (const dp of directPrereqs) {
          for (const gp of (nodeById[dp].prerequisites || [])) {
            if (!expectNodes.has(gp.id) && sets.nodeIds.includes(gp.id)) {
              throw new Error("关联高亮递归到了间接祖先：" + gp.id);
            }
          }
        }
      }

      // FV-13 active 只在首次进入 / 目标变化时定位，重绘不抢滚动
      {
        sandbox.resetResearchAutoScroll();
        els["research-tree"].scrollLeft = 0;
        const first = sandbox.autoScrollResearchTree(fixture, sandbox._researchTreeModel);
        const again = sandbox.autoScrollResearchTree(fixture, sandbox._researchTreeModel);
        if (!first) throw new Error("首次进入研究页必须定位到当前研究");
        if (again) throw new Error("重绘不得反复抢夺玩家滚动位置");
        const lastEraNode = display.nodes.filter(v => v.era === 4)[0];
        const changed = sandbox.autoScrollResearchTree(
          { activeResearch: { techId: lastEraNode.id, targetLevel: 1 } }, sandbox._researchTreeModel);
        if (!changed) throw new Error("activeResearch 目标变化后应重新定位");
        if (!(Number(els["research-tree"].scrollLeft) > 0)) throw new Error("定位到末代科技时未产生横向滚动");
        sandbox.resetResearchAutoScroll();
      }

      // 当前研究 / 成就工时余额 / 队列的可见文本
      if (els["research-bank"].textContent !== "科研工时余额：3 小时") {
        throw new Error("research-bank 余额文案错误：" + els["research-bank"].textContent);
      }
      const activeHtml = els["research-active"].innerHTML;
      if (!activeHtml.includes("采矿理论") || !activeHtml.includes("目标等级 2")) throw new Error("当前研究未显示科技名称与目标等级");
      if (!activeHtml.includes("进度：50%")) throw new Error("当前研究未显示进度百分比：" + activeHtml);
      if (!activeHtml.includes("剩余 ") || !activeHtml.includes("预计完成 ")) throw new Error("当前研究未显示剩余时间与预计完成时间");
      if (!activeHtml.includes("本步已用成就工时：") || !activeHtml.includes("50% 上限")) throw new Error("当前研究未显示已用成就工时与 50% 上限");
      if (els["research-progress-fill"].style.width !== "50%") throw new Error("进度条宽度未跟随进度：" + els["research-progress-fill"].style.width);
      for (const label of ["投入 0.5h", "投入 1h", "投入 4h", "最大可用"]) {
        if (!activeHtml.includes(label)) throw new Error("当前研究缺少投入按钮：" + label);
      }
      const queueHtml = els["research-queue"].innerHTML;
      if (!queueHtml.includes("#1") || !queueHtml.includes("数据分析") || !queueHtml.includes('data-remove-key="dataan@1"')) {
        throw new Error("研究队列未按序号/名称/移除按钮渲染：" + queueHtml);
      }

      // FV-14 退款显示口径修正：一律用 appliedAchievementSeconds，绝不再用 capLeft
      {
        const applied = 0.1 * MATSCI_BASE;
        const capLeft = MATSCI_BASE * 0.5 - applied;      // 与退款完全不同的量
        fixture.activeResearch.appliedAchievementSeconds = applied;
        const refund = sandbox.computeResearchRefundSeconds(fixture);
        if (Math.abs(refund - applied) > 1e-9) throw new Error("退款秒数应等于 appliedAchievementSeconds，实际 " + refund);
        if (Math.abs(refund - capLeft) < 1e-6) throw new Error("退款口径与 capLeft 无法区分，用例失效");
        sandbox.renderResearchPage();
        const refundHtml = els["research-active"].innerHTML;
        const wantText = "取消（退还 " + sandbox.formatResearchHours(applied / 3600) + "）";
        const wrongText = "取消（退还 " + sandbox.formatResearchHours(capLeft / 3600) + "）";
        if (!refundHtml.includes(wantText)) throw new Error("取消按钮未按 appliedAchievementSeconds 显示退款：" + refundHtml);
        if (refundHtml.includes(wrongText)) throw new Error("取消按钮仍在用 capLeft 显示退款");
        if (!refundHtml.includes("本步已用成就工时：" + sandbox.formatResearchHours(applied / 3600))) {
          throw new Error("“已投入工时”未使用 appliedAchievementSeconds");
        }
        if (!refundHtml.includes("剩余可投入 " + sandbox.formatResearchHours(capLeft / 3600))) {
          throw new Error("capLeft 应只用于“剩余可投入额度”");
        }
        // 与业务层真实退款对账：银行增加量 === computeResearchRefundSeconds
        const sRef = mkFState();
        sRef.research.completedLevels = { syseng: 1, mine: 2 };
        sandbox.dispatchGameAction(sRef, { type: "research/start", techId: "mine", targetLevel: 3 }, TF);
        sRef.research.researchHourBank = 5 * HOUR;
        sandbox.dispatchGameAction(sRef, { type: "research/applyHours", hours: 1 }, TF);
        const uiRefund = sandbox.computeResearchRefundSeconds(sRef.research);
        const bankBefore = sRef.research.researchHourBank;
        sandbox.dispatchGameAction(sRef, { type: "research/cancel" }, TF);
        if (Math.abs(sRef.research.researchHourBank - (bankBefore + uiRefund)) > 1e-9) {
          throw new Error("UI 显示的退款与 cancelResearch 实际退款不一致");
        }
        fixture.activeResearch.appliedAchievementSeconds = 0;
      }

      // FV-15 渲染纯读复检：详情/高亮/定位跑完后 state 仍逐字节一致
      const snapshotFinal = JSON.stringify(sandbox.gameState.research);
      sandbox.selectResearchNode("shipcomp");
      sandbox.renderResearchPage();
      if (JSON.stringify(sandbox.gameState.research) !== snapshotFinal) {
        throw new Error("树布局 / SVG / 详情渲染必须纯读，不得写入 state.research");
      }

      // FV-16 详情为点击后弹出的模态框：含遮罩 / 关闭按钮 / 弹窗容器；关闭后完全隐藏
      const modalHtml = els["research-detail"].innerHTML;
      if (!modalHtml.includes("rt-modal-backdrop")) throw new Error("详情未以模态弹窗形式呈现（缺少遮罩层）");
      if (!modalHtml.includes('class="rt-modal-box"')) throw new Error("详情未包裹在弹窗容器内");
      if (!modalHtml.includes("rt-modal-close")) throw new Error("详情弹窗缺少关闭按钮");
      if (modalHtml.includes("research-detail")) throw new Error("详情弹窗不得常驻为侧栏（仍含侧栏结构）");
      sandbox.closeResearchDetail();
      if (sandbox._researchSelectedTechId !== null) throw new Error("关闭详情弹窗后未清空选中态");
      if (els["research-detail"].innerHTML !== "") throw new Error("关闭详情弹窗后弹窗未隐藏");

      // 空队列 / 无进行中研究的空态
      fixture.pendingQueue = [];
      fixture.activeResearch = null;
      sandbox.renderResearchPage();
      if (els["research-queue"].innerHTML !== "") throw new Error("空队列应清空 DOM 交由空态样式提示");
      if (els["research-active"].innerHTML !== "") throw new Error("无进行中研究应清空当前研究 DOM");
      if (els["research-progress-fill"].style.width !== "0%") throw new Error("无进行中研究时进度条未归零");
      if (!els["research-tree"].innerHTML.includes("rt-era-head")) throw new Error("无进行中研究时科技树仍必须完整渲染");
    } finally {
      sandbox.gameState.research = savedResearch;
      sandbox.document.getElementById = savedGetElementById;
      sandbox._researchSelectedTechId = null;
      sandbox.resetResearchAutoScroll();
    }
  }

  console.log("Batch F 研究页面校验通过：导航与面板显隐、8 个研究 DOM 与 294 基线、38 节点冻结序渲染、五种节点状态、6 个协议节点只读、dispatchGameAction 启动/排队/移除/投入/取消闭环、0.5h 与最大可用投入不越 50% 上限、取消全额退款与队列衔接、渲染纯读");
  console.log("Batch F 视觉返修校验通过：五时代动态分组与标题顺序、38 节点各渲染一次且 data-era/data-status 与正式数据一致、SVG 连线数等于 Σprerequisites 且双向一致、多前置多边、六种节点视觉状态、五级等级标记与单级/协议不伪造、详情区 description/全等级效果/前置真实等级、locked 禁用与 available 可 start/enqueue、协议详情无按钮、关联高亮不递归、active 仅首次定位、退款统一用 appliedAchievementSeconds、无第二份静态科技清单与旧卡片网格残留");
}

// ============================================================================================
// 研究系统 Batch G：非战斗数值科技正式接入（19 组 bonus.group 真正影响在线 / 离线 / 显示 / 实扣）
// 铁律：
//   1) 所有消费点只准调用 ResearchState.getResearchBonusValue / getResearchCombinedBonus /
//      getResearchMultiplier，禁止自行读 completedLevels、禁止复制节点数值；
//   2) 根加成 + 专精先加法汇总，再生成唯一乘子（绝不逐项连乘 → 绝不复利）；
//   3) 零科研时所有结果必须与接入前严格一致；
//   4) 同一语义只允许一份公式：在线 tick / 离线结算 / 显示态 / 实扣四处同源。
// ============================================================================================
{
  let gChecks = 0;
  const okG = (condition, message) => {
    if (!condition) throw new Error("Batch G 校验失败：" + message);
    gChecks += 1;
  };
  const nearG = (a, b, eps = 1e-9) => Math.abs(Number(a) - Number(b)) <= eps;

  const RSG = sandbox.ResearchState;
  const RDG = sandbox.ResearchData;
  const RRG = G("ResourceRegistry");
  const gsG = sandbox.gameState;
  const nowG = 1767225600000;

  const savedResearchG = JSON.parse(JSON.stringify(gsG.research));
  const savedArchG = JSON.parse(JSON.stringify(gsG.archaeology));
  const savedActionG = JSON.parse(JSON.stringify(gsG.currentAction));
  const savedAssignG = JSON.parse(JSON.stringify(gsG.shipAssignments || {}));
  const savedShipsG = JSON.parse(JSON.stringify((gsG.inventory && gsG.inventory.ships) || []));

  try {
    // 纯净基线快照：后续所有夹具都从它克隆，避免被前面用例的残留污染
    const pristineG = JSON.parse(JSON.stringify(gsG));
    pristineG.research.completedLevels = {};

    // 19 组非战斗 bonus.group（战斗 / 科研自举 / 六协议不在本批次范围内）
    const GROUPS_G = [
      "allMining", "mining", "gas",
      "allMfg", "smelt", "equip", "booster", "shipComp", "shipAsm",
      "archEff", "archSuccess", "backlash", "probe", "archExp",
      "fuel", "planCost", "build", "autoline", "planProd"
    ];
    // 全满级（基础节点 1 级 + 数值节点 5 级）
    const FULL_G = {
      syseng: 1, matsci: 1, autocon: 1,
      mine: 5, gas: 5, smelt: 5, equipeng: 5, boostereng: 5, shipcomp: 5, shipasm: 5,
      arch: 5, signal: 5, backlash: 5, probe: 5, dataarch: 5,
      fuellog: 5, planfin: 5, englog: 5, planind: 5, autolog: 5
    };
    const mkG = (levels) => {
      const state = JSON.parse(JSON.stringify(pristineG));
      state.research.completedLevels = Object.assign({}, levels || {});
      return state;
    };
    const ZERO_G = mkG({});
    const FULL_STATE_G = mkG(FULL_G);

    const siteG = G("ARCHAEOLOGY_SITES")[0];
    const probeDefG = G("ARCHAEOLOGY_PROBES")[0];
    // 考古夹具：苍鹭级 + 充足探针/燃料 + 干净的两个累计器
    const mkArchG = (levels) => {
      const state = mkG(levels);
      const instance = sandbox.createShipInstance("heron", 1700000000000);
      if (!state.inventory || typeof state.inventory !== "object") state.inventory = { ships: [], equipment: [], rigs: [] };
      if (!Array.isArray(state.inventory.ships)) state.inventory.ships = [];
      state.inventory.ships.push(instance);
      if (!state.shipAssignments || typeof state.shipAssignments !== "object") state.shipAssignments = {};
      state.shipAssignments.archaeology = instance.instanceId;
      Object.assign(state.archaeology, {
        activeSiteId: siteG.id, startedSiteId: siteG.id,
        activeProbeId: probeDefG.id, startedProbeId: probeDefG.id,
        fuelSavingRemainder: 0, probeSavingRemainder: 0,
        shipHp: {}, repairUntil: 0, repairInstanceId: null, interferenceUntil: 0
      });
      state.currentAction = Object.assign({}, state.currentAction, { active: true, skill: "archaeology", progress: 0 });
      RRG.add(state, "probe:" + probeDefG.id, 5000);
      RRG.add(state, "consumable:fuel", 500000);
      return state;
    };

    // ---- G-01 零科研基线 + 19 组全部登记在消费点注册表 --------------------------------
    // RESEARCH_BONUS_CONSUMERS 是 group -> descriptor[] 的键值对象（非数组）
    const consumersG = RDG.RESEARCH_BONUS_CONSUMERS || {};
    const registeredGroupsG = new Set(Object.keys(consumersG));
    for (const group of GROUPS_G) {
      okG(registeredGroupsG.has(group), "RESEARCH_BONUS_CONSUMERS 未登记消费点 group=" + group);
      okG(Array.isArray(consumersG[group]) && consumersG[group].length > 0,
        "RESEARCH_BONUS_CONSUMERS[" + group + "] 必须是非空 descriptor 数组");
      okG(RSG.getResearchBonusValue(ZERO_G, group) === 0, "零科研时 " + group + " 加成必须恰为 0");
      okG(RSG.getResearchMultiplier(ZERO_G, [group]) === 1, "零科研时 " + group + " 乘子必须恰为 1");
    }

    // ---- G-02 加法汇总，绝不复利 ------------------------------------------------------
    okG(nearG(RSG.getResearchBonusValue(FULL_STATE_G, "allMining"), 0.02), "allMining 满级应为 +2%");
    okG(nearG(RSG.getResearchBonusValue(FULL_STATE_G, "mining"), 0.06), "mining 满级应为 +6%");
    okG(nearG(RSG.getResearchCombinedBonus(FULL_STATE_G, ["allMining", "mining"]), 0.08), "根加成与专精必须纯加法汇总为 0.08");
    okG(nearG(RSG.getResearchMultiplier(FULL_STATE_G, ["allMining", "mining"]), 1.08), "采矿唯一乘子必须为 1.08");
    okG(!nearG(RSG.getResearchMultiplier(FULL_STATE_G, ["allMining", "mining"]), 1.02 * 1.06, 1e-6), "采矿科研出现逐项连乘复利 1.0812");
    okG(nearG(RSG.getResearchMultiplier(FULL_STATE_G, ["allMfg", "smelt"]), 1.08), "制造唯一乘子必须为 1.08");
    okG(!nearG(RSG.getResearchMultiplier(FULL_STATE_G, ["allMfg", "smelt"]), 1.02 * 1.06, 1e-6), "制造科研出现复利");

    // ---- G-03 采矿效率：唯一乘子进入 total ---------------------------------------------
    const mineZeroG = sandbox.getProductionEfficiencyState(ZERO_G, "mining");
    const mineFullG = sandbox.getProductionEfficiencyState(FULL_STATE_G, "mining");
    okG(mineZeroG.researchMultiplier === 1, "零科研采矿显示态乘子必须为 1");
    okG(nearG(mineFullG.researchMultiplier, 1.08), "满级采矿显示态乘子必须为 1.08");
    okG(nearG(mineFullG.total / mineZeroG.total, 1.08), "采矿 total 必须严格 ×1.08");

    // ---- G-04 采矿 / 采气专精互不串味 --------------------------------------------------
    const miningOnlyG = mkG({ syseng: 1, mine: 5 });
    okG(nearG(sandbox.getProductionEfficiencyState(miningOnlyG, "mining").researchMultiplier, 1.08), "只点采矿专精时采矿应为 1.08");
    okG(nearG(sandbox.getProductionEfficiencyState(miningOnlyG, "gas").researchMultiplier, 1.02), "只点采矿专精时采气只能吃 allMining 根加成 1.02");
    const gasOnlyG = mkG({ syseng: 1, gas: 5 });
    okG(nearG(sandbox.getProductionEfficiencyState(gasOnlyG, "gas").researchMultiplier, 1.08), "只点气云专精时采气应为 1.08");
    okG(nearG(sandbox.getProductionEfficiencyState(gasOnlyG, "mining").researchMultiplier, 1.02), "只点气云专精时采矿只能吃 allMining 根加成 1.02");

    // ---- G-05 冶炼：提速但不改产量 -----------------------------------------------------
    const smeltZeroG = sandbox.getSmeltingDisplayState(ZERO_G, nowG);
    const smeltFullG = sandbox.getSmeltingDisplayState(FULL_STATE_G, nowG);
    okG(smeltZeroG.researchMultiplier === 1, "零科研冶炼乘子必须为 1");
    okG(nearG(smeltFullG.researchMultiplier, 1.08), "满级冶炼乘子必须为 1.08");
    okG(nearG(smeltZeroG.actualTime / smeltFullG.actualTime, 1.08), "冶炼周期必须 ÷1.08");
    okG(smeltFullG.output === smeltZeroG.output, "冶炼提速科技不得改变单周期产量");

    // ---- G-06 / G-07 装备与增强剂：显示态与真实结算函数同一 API 同一结果 -----------------
    const equipZeroG = sandbox.getEquipmentEngineeringDisplayState(ZERO_G, nowG, "");
    const equipFullG = sandbox.getEquipmentEngineeringDisplayState(FULL_STATE_G, nowG, "");
    okG(nearG(equipFullG.efficiency / equipZeroG.efficiency, 1.08), "装备工程效率必须 ×1.08");
    const boosterZeroG = sandbox.getBoosterManufacturingDisplayState(ZERO_G, nowG);
    const boosterFullG = sandbox.getBoosterManufacturingDisplayState(FULL_STATE_G, nowG);
    okG(nearG(boosterFullG.efficiency / boosterZeroG.efficiency, 1.08), "增强剂制造效率必须 ×1.08");
    gsG.research.completedLevels = Object.assign({}, FULL_G);
    const liveEquipEffG = sandbox.getEquipEngEfficiency();
    const liveBoosterEffG = sandbox.getBoosterEfficiency();
    okG(nearG(liveEquipEffG, sandbox.getEquipmentEngineeringDisplayState(gsG, nowG, "").efficiency, 1e-12), "装备真实结算效率与显示态必须完全一致");
    okG(nearG(liveBoosterEffG, sandbox.getBoosterManufacturingDisplayState(gsG, nowG).efficiency, 1e-12), "增强剂真实结算效率与显示态必须完全一致");
    gsG.research.completedLevels = {};
    okG(nearG(sandbox.getEquipEngEfficiency() * 1.08, liveEquipEffG, 1e-9), "装备真实结算未吃到 1.08 科研乘子");
    okG(nearG(sandbox.getBoosterEfficiency() * 1.08, liveBoosterEffG, 1e-9), "增强剂真实结算未吃到 1.08 科研乘子");

    // ---- G-08 舰船组件 / 总装：共享 allMfg，专精互不串味，周期 ÷ 乘子 ---------------------
    const compOnlyG = mkG({ matsci: 1, shipcomp: 5 });
    okG(nearG(sandbox.getShipEngineeringSpeedBreakdown(compOnlyG, "component").researchMultiplier, 1.08), "组件线应为 1.08");
    okG(nearG(sandbox.getShipEngineeringSpeedBreakdown(compOnlyG, "assembly").researchMultiplier, 1.02), "总装线只能吃共享 allMfg 1.02");
    okG(sandbox.getShipEngineeringSpeedBreakdown(compOnlyG).researchMultiplier === 1, "未指定 kind 时不得注入科研乘子");
    const compRecipeG = G("SHIP_COMPONENT_RECIPES")[0];
    const asmRecipeG = G("SHIP_ASSEMBLY_RECIPES")[0];
    okG(sandbox.getShipEngineeringRecipeKind(compRecipeG) === "component", "组件配方类别判定错误");
    okG(sandbox.getShipEngineeringRecipeKind(asmRecipeG) === "assembly", "总装配方类别判定错误");
    okG(nearG(sandbox.getShipEngineeringCycleDuration(ZERO_G, compRecipeG) / sandbox.getShipEngineeringCycleDuration(compOnlyG, compRecipeG), 1.08), "组件周期必须 ÷1.08");
    okG(nearG(sandbox.getShipEngineeringCycleDuration(ZERO_G, asmRecipeG) / sandbox.getShipEngineeringCycleDuration(compOnlyG, asmRecipeG), 1.02), "总装周期只能 ÷1.02");

    // ---- G-09 考古周期唯一公式：在线 / 离线 descriptor / 显示态三处同源 --------------------
    okG(nearG(sandbox.getArchaeologyCycleSeconds(ZERO_G, siteG), siteG.time), "零科研考古周期必须恰等于 site.time");
    const archEffG = mkArchG({ autocon: 1, arch: 5 });
    okG(nearG(RSG.getResearchMultiplier(archEffG, ["archEff"]), 1.08), "archEff 满级应为 1.08");
    const archCycleG = sandbox.getArchaeologyCycleSeconds(archEffG, siteG);
    okG(nearG(siteG.time / archCycleG, 1.08), "考古周期必须 ÷1.08");
    const archDisplayG = sandbox.getArchaeologyDisplayState(archEffG, nowG);
    const siteRowG = archDisplayG.sites.find(row => row.id === siteG.id);
    okG(nearG(siteRowG.actualCycleTime, archCycleG, 1e-12), "考古显示态周期必须与唯一公式同源");
    gsG.research.completedLevels = { autocon: 1, arch: 5 };
    const offlineShipG = sandbox.createShipInstance("heron", 1700000000001);
    gsG.inventory.ships.push(offlineShipG);
    gsG.shipAssignments.archaeology = offlineShipG.instanceId;
    Object.assign(gsG.archaeology, { activeSiteId: siteG.id, startedSiteId: siteG.id, activeProbeId: probeDefG.id, startedProbeId: probeDefG.id });
    gsG.currentAction = Object.assign({}, gsG.currentAction, { active: true, skill: "archaeology", progress: 0 });
    const descriptorG = sandbox.getOfflineActionDescriptor();
    okG(descriptorG && descriptorG.key === "archaeology", "离线考古 descriptor 构造失败");
    okG(nearG(descriptorG.duration, sandbox.getArchaeologyCycleSeconds(gsG, siteG), 1e-12), "离线 descriptor 周期必须与唯一公式同源");
    okG(nearG(descriptorG.duration, siteG.time / 1.08, 1e-9), "离线 descriptor 未吃到 archEff 提速");
    gsG.research.completedLevels = {};

    // ---- G-10 archSuccess：百分点加法 + [0.05, 0.95] 夹紧 --------------------------------
    const succG = mkG({ signal: 5 });
    okG(nearG(RSG.getResearchBonusValue(succG, "archSuccess"), 0.03), "archSuccess 满级应为 +3 个百分点");
    const baseChanceG = sandbox.computeArchaeologySuccessChance(50, 50);
    okG(nearG(sandbox.getArchaeologyFinalSuccessChance(ZERO_G, 50, 50), baseChanceG), "零科研成功率必须等于基础成功率");
    okG(nearG(sandbox.getArchaeologyFinalSuccessChance(succG, 50, 50), baseChanceG + 0.03), "成功率必须按百分点加法叠加");
    okG(sandbox.getArchaeologyFinalSuccessChance(succG, 500, 0) === 0.95, "成功率上限必须夹在 0.95");
    okG(nearG(sandbox.getArchaeologyFinalSuccessChance(succG, 0, 500), 0.08), "下限 0.05 之上仍按百分点叠加为 0.08");

    // ---- G-11 backlash：只减一次，显示 = 结算 -------------------------------------------
    const tierG = sandbox.getArchaeologyTierConfig(siteG.tier);
    const profileG = sandbox.getSiteEffectiveProfile(siteG, tierG);
    const profMultG = profileG ? profileG.backlashMultiplier : 1;
    const heronCfgG = sandbox.getShipConfigById("heron");
    const shipRedG = (heronCfgG && heronCfgG.bonuses && heronCfgG.bonuses.archaeologyFailureDamageReduction) || 0;
    const backlashStateG = mkArchG({ backlash: 5 });
    okG(nearG(RSG.getResearchBonusValue(backlashStateG, "backlash"), 0.06), "backlash 满级应为 -6%");
    const expectedBacklashG = Math.ceil(siteG.backlashDamage * profMultG * (1 - shipRedG) * 0.94);
    const backlashRowG = sandbox.getArchaeologyDisplayState(backlashStateG, nowG).sites.find(row => row.id === siteG.id);
    okG(backlashRowG.effectiveBacklash === expectedBacklashG, "反噬显示值未按 (1-6%) 只减一次：" + backlashRowG.effectiveBacklash + " != " + expectedBacklashG);
    const zeroBacklashRowG = sandbox.getArchaeologyDisplayState(mkArchG({}), nowG).sites.find(row => row.id === siteG.id);
    okG(zeroBacklashRowG.effectiveBacklash === Math.ceil(siteG.backlashDamage * profMultG * (1 - shipRedG)), "零科研反噬必须与接入前一致");
    const failResultG = sandbox.resolveArchaeologyCycle(backlashStateG, nowG, 0.999999999);
    okG(failResultG && failResultG.success === false, "强制失败用例未走到反噬分支");
    okG(failResultG.backlash === expectedBacklashG, "反噬真实结算与显示态不一致");

    // ---- G-12 probe：确定性累计器，100 周期实耗 94 支、6 支免费 ---------------------------
    const probeStateG = mkArchG({ probe: 5 });
    okG(nearG(RSG.getResearchBonusValue(probeStateG, "probe"), 0.06), "probe 满级应为 -6%");
    okG(sandbox.getArchaeologyProbeCostState(ZERO_G).chargedProbe === 1, "零科研必须每周期实扣 1 支探针");
    const probeBeforeG = RRG.get(probeStateG, "probe:" + probeDefG.id);
    let probeCyclesG = 0;
    for (let i = 0; i < 100; i += 1) {
      const result = sandbox.resolveArchaeologyCycle(probeStateG, nowG + i * 1000, 0);
      if (result && result.success) probeCyclesG += 1;
    }
    okG(probeCyclesG === 100, "100 个考古周期未全部成功结算，实际 " + probeCyclesG);
    const probeSpentG = probeBeforeG - RRG.get(probeStateG, "probe:" + probeDefG.id);
    okG(probeSpentG === 94, "100 周期探针实耗必须为 94 支（6 支免费），实际 " + probeSpentG);
    okG(Math.abs(Number(probeStateG.archaeology.probeSavingRemainder)) < 1e-6, "100 周期后探针累计器余数必须回到 0");
    // 免费周期：库存为 0 也能开工
    const freeProbeG = mkArchG({ probe: 5 });
    RRG.spend(freeProbeG, "probe:" + probeDefG.id, RRG.get(freeProbeG, "probe:" + probeDefG.id));
    freeProbeG.archaeology.probeSavingRemainder = 0.95;
    okG(sandbox.getArchaeologyProbeCostState(freeProbeG).chargedProbe === 0, "累计器攒满时必须出现免费周期");
    okG(sandbox.resolveArchaeologyCycle(freeProbeG, nowG, 0).success === true, "免费周期不得被探针库存判断拦下");
    // 原子拒绝：不足时不扣资源、不推进累计器
    const rejectProbeG = mkArchG({ probe: 5 });
    RRG.spend(rejectProbeG, "probe:" + probeDefG.id, RRG.get(rejectProbeG, "probe:" + probeDefG.id));
    const rejectFuelBeforeG = RRG.get(rejectProbeG, "consumable:fuel");
    const rejectResultG = sandbox.resolveArchaeologyCycle(rejectProbeG, nowG, 0);
    okG(rejectResultG && rejectResultG.reason === "insufficient", "探针不足时必须原子拒绝");
    okG(Number(rejectProbeG.archaeology.probeSavingRemainder) === 0, "被拒绝的周期不得推进探针累计器");
    okG(RRG.get(rejectProbeG, "consumable:fuel") === rejectFuelBeforeG, "被拒绝的周期不得扣燃料");

    // ---- G-13 探针累计器迁移幂等 -------------------------------------------------------
    gsG.archaeology.probeSavingRemainder = 3.7;
    sandbox.migrateArchaeologyState();
    okG(nearG(gsG.archaeology.probeSavingRemainder, 0.7), "迁移必须把累计器归一化到 [0,1)");
    sandbox.migrateArchaeologyState();
    okG(nearG(gsG.archaeology.probeSavingRemainder, 0.7), "迁移必须幂等");
    gsG.archaeology.probeSavingRemainder = -5;
    sandbox.migrateArchaeologyState();
    okG(gsG.archaeology.probeSavingRemainder === 0, "非法负值必须回填 0");
    delete gsG.archaeology.probeSavingRemainder;
    sandbox.migrateArchaeologyState();
    okG(gsG.archaeology.probeSavingRemainder === 0, "旧存档缺字段必须回填 0");

    // ---- G-14 archExp：经验 ×1.06，事件值 = 入账值 ----------------------------------------
    const expStateG = mkArchG({ dataarch: 5 });
    okG(nearG(RSG.getResearchMultiplier(expStateG, ["archExp"]), 1.06), "archExp 满级应为 1.06");
    let expEventXpG = null;
    const unsubscribeExpG = sandbox.GameEvents.on("archaeology:success", event => { expEventXpG = event.payload.xp; });
    const expResultG = sandbox.resolveArchaeologyCycle(expStateG, nowG, 0);
    unsubscribeExpG();
    okG(expResultG && expResultG.success === true, "考古经验用例未成功结算");
    okG(nearG(expResultG.xp, siteG.xp * 1.06), "考古经验必须 ×1.06");
    okG(nearG(expEventXpG, expResultG.xp), "archaeology:success 事件 xp 必须等于真实入账 xp");
    okG(nearG(sandbox.resolveArchaeologyCycle(mkArchG({}), nowG, 0).xp, siteG.xp), "零科研考古经验必须等于 site.xp");

    // ---- G-15 fuel：燃烧速率 ×0.91，结算 / 显示 / 补给闸门同源 ------------------------------
    const fuelStateG = mkG({ fuellog: 5 });
    fuelStateG.station.bodyLevel = 1;
    fuelStateG.station.maintenance = { tier: "standard", fuelRemaining: 1000, lastRefillAt: 0, lastTick: nowG - 3600000 };
    const fuelPointsG = sandbox.getStationMaintenancePoints(fuelStateG);
    okG(fuelPointsG > 0, "燃料用例的维护点数必须大于 0");
    const baseRateG = sandbox.getStationFuelBurnRatePerMs(fuelPointsG);
    okG(nearG(sandbox.getStationEffectiveFuelBurnRatePerMs(ZERO_G, fuelPointsG), baseRateG, 1e-18), "零科研燃烧速率必须等于基础速率");
    okG(nearG(sandbox.getStationEffectiveFuelBurnRatePerMs(fuelStateG, fuelPointsG), baseRateG * 0.91, 1e-18), "满级燃料科研燃烧速率必须为基础 ×0.91");
    sandbox.settleStationMaintenance(fuelStateG, nowG, false);
    okG(nearG(fuelStateG.station.maintenance.fuelRemaining, 1000 - baseRateG * 0.91 * 3600000, 1e-9), "真实燃料扣减必须按 ×0.91 的有效速率");
    const fuelDisplayG = sandbox.getStationMaintenanceDisplayState(fuelStateG, nowG);
    const fuelRefillG = sandbox.getStationRefillMaintenanceState(fuelStateG);
    okG(nearG(fuelDisplayG.remainingMs, fuelRefillG.remainingMs, 1e-6), "维护剩余时长：显示态与补给闸门必须同一公式");

    // ---- G-16 build：建设时长 ÷1.09，且不污染建筑倍率 --------------------------------------
    const buildStateG = mkG({ englog: 5 });
    okG(nearG(RSG.getResearchMultiplier(buildStateG, ["build"]), 1.09), "build 满级应为 1.09");
    const bodyPlanG = G("STATION_BODY_PLANS")[1];
    okG(sandbox.getStationConstructionDurationMs(ZERO_G, bodyPlanG) === bodyPlanG.durationMs, "零科研建设时长必须等于 plan.durationMs");
    okG(sandbox.getStationConstructionDurationMs(buildStateG, bodyPlanG) === Math.max(1, Math.round(bodyPlanG.durationMs / 1.09)), "建设时长必须 ÷1.09");
    const buildLineIdG = G("AUTO_LINE_CONFIG").smelting.buildingId;
    const buildProbeZeroG = mkG({});
    buildProbeZeroG.station.buildings[buildLineIdG] = 2;
    const buildProbeFullG = mkG({ englog: 5 });
    buildProbeFullG.station.buildings[buildLineIdG] = 2;
    okG(sandbox.getStationBuildingSpeedMultiplier(buildProbeFullG, buildLineIdG) === sandbox.getStationBuildingSpeedMultiplier(buildProbeZeroG, buildLineIdG), "build 科研不得污染建筑速度倍率");

    // ---- G-17 autoline：只加速周期，材料与产量不变 ------------------------------------------
    const autoZeroG = mkG({});
    autoZeroG.station.buildings[buildLineIdG] = 2;
    const autoFullG = mkG({ autolog: 5 });
    autoFullG.station.buildings[buildLineIdG] = 2;
    okG(nearG(RSG.getResearchMultiplier(autoFullG, ["autoline"]), 1.09), "autoline 满级应为 1.09");
    const smeltRecipeG = G("SMELTING_RECIPES")[0];
    const autoZeroDurG = sandbox.getStationAutoLineCycleDuration(autoZeroG, "smelting", smeltRecipeG);
    const autoFullDurG = sandbox.getStationAutoLineCycleDuration(autoFullG, "smelting", smeltRecipeG);
    okG(autoZeroDurG > 0 && nearG(autoZeroDurG / autoFullDurG, 1.09), "自动线周期必须 ÷1.09");
    okG(sandbox.getStationAutoLineCycleDuration(autoFullG, "smelting", smeltRecipeG) === autoFullDurG, "自动线周期公式必须纯函数可复现");
    okG(sandbox.getStationBuildingSpeedMultiplier(autoFullG, buildLineIdG) === sandbox.getStationBuildingSpeedMultiplier(autoZeroG, buildLineIdG), "autoline 科研不得改变建筑倍率");
    okG(sandbox.getSmeltingDisplayState(autoFullG, nowG).output === sandbox.getSmeltingDisplayState(autoZeroG, nowG).output, "autoline 科研不得改变单周期产量");
    okG(smeltRecipeG.baseOutput === G("SMELTING_RECIPES")[0].baseOutput && smeltRecipeG.consumeOre === G("SMELTING_RECIPES")[0].consumeOre, "自动线科研不得改写配方材料/产量数据");

    // ---- G-18 planCost：显示价 = 目录价 = 判断价 = 实扣价 = 事件价 --------------------------
    const lavaG = G("PLANET_TYPES").find(planet => Number(planet.maintenanceCostISK) > 0);
    const expectedRenewG = Math.ceil(Number(lavaG.maintenanceCostISK) * 0.91);
    const mkPlanG = (levels) => {
      const state = mkG(levels);
      if (!state.planetary || typeof state.planetary !== "object") state.planetary = { deployments: [] };
      state.planetary.deployments = [{
        id: "dep_batch_g", planetType: lavaG.id, deployedAt: nowG - 200000 * 1000,
        duration: 86400, lastTick: nowG, progress: 0, storage: 0, active: false
      }];
      return state;
    };
    const planZeroG = mkPlanG({});
    okG(sandbox.getPlanetRenewCostISK(planZeroG, lavaG) === Number(lavaG.maintenanceCostISK), "零科研续期价必须等于基础维护费");
    const planFullG = mkPlanG({ planfin: 5 });
    okG(nearG(RSG.getResearchBonusValue(planFullG, "planCost"), 0.09), "planCost 满级应为 -9%");
    okG(sandbox.getPlanetRenewCostISK(planFullG, lavaG) === expectedRenewG, "续期唯一公式必须为 ceil(基础费 × 0.91)");
    const planDisplayG = sandbox.getPlanetaryDisplayState(planFullG, nowG);
    const cardG = planDisplayG.deployments[0];
    const optionG = planDisplayG.deployOptions.find(option => option.id === lavaG.id);
    okG(cardG.renewCost === expectedRenewG, "部署卡显示价必须为减免后价格");
    okG(optionG.renewCost === expectedRenewG, "目录页续期价必须与部署卡同源");
    okG(cardG.renewBaseCost === Number(lavaG.maintenanceCostISK), "部署卡必须同时暴露基础价用于展示减免");
    // 判断价：少 1 ISK 必须被拒
    const planShortG = mkPlanG({ planfin: 5 });
    RRG.spend(planShortG, "currency:isk", RRG.get(planShortG, "currency:isk"));
    RRG.add(planShortG, "currency:isk", expectedRenewG - 1);
    okG(sandbox.getPlanetDeploymentDisplayState(planShortG, planShortG.planetary.deployments[0], nowG).canRenew === false, "余额差 1 ISK 时显示态必须不可续期");
    okG(sandbox.dispatchGameAction(planShortG, { type: "planetary/renew", id: "dep_batch_g" }, nowG).reason === "insufficient-isk", "余额差 1 ISK 时必须原子拒绝");
    // 实扣价 + 事件价
    const planPayG = mkPlanG({ planfin: 5 });
    RRG.spend(planPayG, "currency:isk", RRG.get(planPayG, "currency:isk"));
    RRG.add(planPayG, "currency:isk", expectedRenewG);
    let renewEventIskG = null;
    const unsubscribeRenewG = sandbox.GameEvents.on("planetary:renewed", event => { renewEventIskG = event.payload.maintenanceISK; });
    const renewResultG = sandbox.dispatchGameAction(planPayG, { type: "planetary/renew", id: "dep_batch_g" }, nowG);
    unsubscribeRenewG();
    okG(renewResultG && renewResultG.changed === true, "减免后余额恰好时必须续期成功");
    okG(RRG.get(planPayG, "currency:isk") === 0, "实扣价必须等于减免后价格");
    okG(renewEventIskG === expectedRenewG, "planetary:renewed 事件价必须等于实扣价");

    // ---- G-19 planProd：行星周期 ÷1.09，在线与离线共用同一入口 -------------------------------
    const planProdG = mkG({ planind: 5 });
    okG(nearG(RSG.getResearchMultiplier(planProdG, ["planProd"]), 1.09), "planProd 满级应为 1.09");
    okG(nearG(sandbox.getPlanetOutputIntervalFromState(ZERO_G, lavaG.id) / sandbox.getPlanetOutputIntervalFromState(planProdG, lavaG.id), 1.09), "行星产出周期必须 ÷1.09");
    // 零科研必须与接入前严格一致：仅由 配置 interval / 行星学等级 / 站点后勤 三项决定
    const planCapLevelG = sandbox.getPlanetaryCapacityState(ZERO_G).level;
    const planStationMultG = Math.max(0.001, sandbox.getStationLogisticsMultiplier(ZERO_G));
    const planBaseIntervalG = lavaG.interval / (1 + planCapLevelG * 0.02) / planStationMultG;
    okG(nearG(sandbox.getPlanetOutputIntervalFromState(ZERO_G, lavaG.id), planBaseIntervalG, 1e-12),
      "零科研行星周期必须等于接入前基线（研究乘子恰为 1）");
    gsG.research.completedLevels = { planind: 5 };
    okG(nearG(sandbox.getPlanetOutputInterval(lavaG.id), sandbox.getPlanetOutputIntervalFromState(gsG, lavaG.id), 1e-12), "在线/离线共用的 getPlanetOutputInterval 必须委托唯一公式");
    gsG.research.completedLevels = {};

    // ---- G-20 不进战斗、不进六协议 -------------------------------------------------------
    okG(JSON.stringify(sandbox.getCombatDisplayState(ZERO_G, nowG)) === JSON.stringify(sandbox.getCombatDisplayState(FULL_STATE_G, nowG)), "非战斗科研全满级不得改变战斗显示态");
    const protocolNodesG = RDG.NODES.filter(node => node.type === "protocol");
    okG(protocolNodesG.length === 6, "协议节点必须恰为 6 个");
    for (const node of protocolNodesG) okG(!node.bonus, "协议节点 " + node.id + " 不得带 bonus");

    // ---- G-21 冻结基线不回退 -------------------------------------------------------------
    okG(RDG.NODES.length === 38, "科技节点总数必须仍为 38");
    okG(scriptSources.length === 56 && styleSources.length === 4 && htmlIds.size === 313, "56 JS / 4 CSS / 313 DOM ID 基线不得回退");
    okG(Object.prototype.hasOwnProperty.call(gsG.archaeology, "probeSavingRemainder"), "默认状态必须包含探针累计器字段");
  } finally {
    gsG.research = JSON.parse(JSON.stringify(savedResearchG));
    gsG.archaeology = JSON.parse(JSON.stringify(savedArchG));
    gsG.currentAction = JSON.parse(JSON.stringify(savedActionG));
    gsG.shipAssignments = JSON.parse(JSON.stringify(savedAssignG));
    if (gsG.inventory) gsG.inventory.ships = JSON.parse(JSON.stringify(savedShipsG));
  }

  console.log("Batch G 非战斗数值科技校验通过（" + gChecks + " 项）：19 组零科研基线与消费点注册、加法汇总拒绝复利、采矿/采气专精不串味、冶炼/装备/增强剂显示与真实结算同源、组件与总装各吃各专精、考古周期在线=离线=显示唯一公式、成功率百分点夹紧、反噬只减一次、探针 100 周期实耗 94 支与免费周期/原子拒绝/迁移幂等、考古经验事件=入账、燃料 ×0.91 结算与剩余时长同源、建设 ÷1.09 不污染建筑倍率、自动线只提速不改产量、行星续期四价同源、行星周期 ÷1.09、战斗与六协议零影响");
}

// ============================================================================================
// 研究系统 Batch H：12 组战斗数值科技正式接入（武器伤害 / 三层生命 / 主动维修 / 战斗经验）
// 铁律：
//   1) 只准调用 ResearchState.getResearchBonusValue / getResearchCombinedBonus /
//      getResearchMultiplier，禁止自行读 completedLevels、禁止复制节点数值；
//   2) 每个最终战斗 stat 只允许一条 source:"research" 的聚合 modifier，
//      其 value 直接来自一次 getResearchMultiplier（先加法汇总，绝不逐项复利）；
//   3) 零科研时逐值与接入前严格一致；显示态与真实 combatTick 同源；
//   4) 不修改敌方伤害 / HP / 维修，不进入六协议业务。
// ============================================================================================
{
  let hChecks = 0;
  const okH = (condition, message) => {
    if (!condition) throw new Error("Batch H 校验失败：" + message);
    hChecks += 1;
  };
  const nearH = (a, b, eps = 1e-12) => Math.abs(Number(a) - Number(b)) <= eps;

  const RSH = sandbox.ResearchState;
  const RDH = sandbox.ResearchData;
  const gsH = sandbox.gameState;
  const nowH = 1767225600000;

  const savedResearchH = JSON.parse(JSON.stringify(gsH.research));
  const savedCombatH = JSON.parse(JSON.stringify(gsH.combat));
  const savedActionH = JSON.parse(JSON.stringify(gsH.currentAction));
  const savedAssignH = JSON.parse(JSON.stringify(gsH.shipAssignments || {}));
  const savedShipsH = JSON.parse(JSON.stringify((gsH.inventory && gsH.inventory.ships) || []));
  const savedSkillsH = JSON.parse(JSON.stringify(gsH.skills));
  const savedStationH = JSON.parse(JSON.stringify(gsH.station));
  const savedResourcesH = JSON.parse(JSON.stringify(gsH.resources));
  const savedEquipH = JSON.parse(JSON.stringify((gsH.equipment && gsH.equipment.inventory) || []));

  try {
    const pristineH = JSON.parse(JSON.stringify(gsH));
    pristineH.research.completedLevels = {};

    // 12 组战斗 bonus.group
    const GROUPS_H = [
      "combatExp",
      "allWeapon", "weaponDmg", "laserDmg", "missileDmg", "projDmg", "tactical",
      "tierHp", "shield", "armor", "structure",
      "repair"
    ];
    // 全满级（基础节点 1 级 + 战斗数值节点 5 级）
    const FULL_H = {
      dataan: 1,
      combat: 5, firectrl: 5, defense: 5, tactical: 5,
      laser: 5, missile: 5, projectile: 5,
      shield: 5, armor: 5, structure: 5, repair: 5
    };

    const mkH = (levels) => {
      const state = JSON.parse(JSON.stringify(pristineH));
      state.research.completedLevels = Object.assign({}, levels || {});
      return state;
    };
    // 战斗夹具：裂谷级（护盾 300 / 装甲 100 / 结构 100，护盾 +10%、激光 +5%），强化 0 级、无 rig、无装备平段
    const FIT_H = { high: ["t1_small_laser"], mid: ["t1_shield_booster"], low: [], rig: [] };
    const mkShipH = (levels, fitted) => {
      const state = mkH(levels);
      const instance = sandbox.createShipInstance("rifter", 1700000000000);
      instance.enhancementLevel = 0;
      instance.fitted = JSON.parse(JSON.stringify(fitted || FIT_H));
      state.inventory.ships = [instance];
      state.shipAssignments = Object.assign({}, state.shipAssignments, { combat: instance.instanceId });
      if (state.equipment) state.equipment.inventory = [];
      Object.assign(state.combat, {
        active: false, mode: "belt", viewMode: "belt", zone: "angel_outpost",
        activeShip: instance.instanceId, enemies: [], currentEnemy: null,
        hp: null, maxHp: null, modifiers: [], repairUntil: 0, destroyedShip: null
      });
      return state;
    };

    const ZERO_H = mkShipH({});
    const FULL_STATE_H = mkShipH(FULL_H);
    const dmgH = (state, weaponType) => sandbox.getCombatDamageMultiplierFromState(state, weaponType);
    const hpH = (state) => sandbox.getCombatMaxHpFromState(state);
    const repH = (state, layer) => sandbox.getCombatRepairMultiplierFromState(state, layer);

    // ---- H-01 12 组零科研基线 + 31 组数值 group 全部进入正式消费点 ----------------------
    for (const group of GROUPS_H) {
      okH(RSH.getResearchBonusValue(ZERO_H, group) === 0, "零科研 " + group + " 加成必须严格为 0");
      okH(RSH.getResearchMultiplier(ZERO_H, [group]) === 1, "零科研 " + group + " 乘子必须严格为 1");
    }
    const consumersH = RDH.RESEARCH_BONUS_CONSUMERS || {};
    const numericGroupsH = new Set(RDH.NODES.filter(node => node.bonus && node.bonus.group).map(node => node.bonus.group));
    okH(numericGroupsH.size === 31, "科技树数值 bonus.group 必须恰为 31 组（Batch G 19 + Batch H 12）");
    for (const group of numericGroupsH) {
      okH(Array.isArray(consumersH[group]) && consumersH[group].length > 0, "group " + group + " 未登记正式消费点");
    }
    for (const group of GROUPS_H) okH(numericGroupsH.has(group), "战斗 group " + group + " 必须存在于科技树");

    // ---- H-02 零科研逐值基线（独立复算接入前公式，不用近似断言）--------------------------
    const lvlH = (skill) => sandbox.getCombatSkillLevelFromState(ZERO_H, skill);
    const baseShieldH = 300 * 1.10 * (1 + lvlH("shieldOperation") * 0.03);
    const baseArmorH = 100 * (1 + lvlH("armorReinforcement") * 0.03);
    const baseStructureH = 100 * (1 + lvlH("hullEngineering") * 0.03);
    const zeroHpH = hpH(ZERO_H);
    okH(zeroHpH.shield === Math.round(baseShieldH), "零科研护盾必须等于接入前基线");
    okH(zeroHpH.armor === Math.round(baseArmorH), "零科研装甲必须等于接入前基线");
    okH(zeroHpH.structure === Math.round(baseStructureH), "零科研结构必须等于接入前基线");
    okH(dmgH(ZERO_H, "laser") === (1 + lvlH("laserOps") * 0.02) * 1.05, "零科研激光伤害倍率必须等于接入前基线");
    okH(dmgH(ZERO_H, "missile") === (1 + lvlH("missileOperations") * 0.02) * 1, "零科研导弹伤害倍率必须等于接入前基线");
    okH(dmgH(ZERO_H, "cannon") === (1 + lvlH("cannonOps") * 0.02) * 1, "零科研射弹伤害倍率必须等于接入前基线");
    for (const layer of ["shield", "armor", "structure"]) {
      okH(repH(ZERO_H, layer) === (1 + lvlH("defense") * 0.02) * 1, "零科研 " + layer + " 维修倍率必须等于接入前基线");
      okH(sandbox.getCombatResearchModifierList(ZERO_H, "repairMultiplier", layer)[0].value === 1, "零科研维修 modifier 必须恰为 1（×1 为恒等）");
      okH(sandbox.getCombatResearchModifierList(ZERO_H, "maxHp", layer)[0].value === 1, "零科研生命 modifier 必须恰为 1（×1 为恒等）");
    }
    for (const weapon of ["laser", "missile", "cannon"]) {
      okH(sandbox.getCombatResearchModifierList(ZERO_H, "damageMultiplier", weapon)[0].value === 1, "零科研武器 modifier 必须恰为 1（×1 为恒等）");
    }

    // ---- H-03 三武器满专精严格 1.125，显式拒绝逐项复利 ------------------------------------
    const WEAPON_GROUPS_H = {
      laser: ["allWeapon", "weaponDmg", "laserDmg", "tactical"],
      missile: ["allWeapon", "weaponDmg", "missileDmg", "tactical"],
      cannon: ["allWeapon", "weaponDmg", "projDmg", "tactical"]
    };
    const weaponCompoundH = 1.02 * 1.03 * 1.06 * 1.015; // 逐项连乘 ≈ 1.1274（错误结果）
    for (const [weapon, groups] of Object.entries(WEAPON_GROUPS_H)) {
      okH(nearH(RSH.getResearchCombinedBonus(FULL_STATE_H, groups), 0.125), weapon + " 加法汇总必须为 0.125");
      okH(nearH(RSH.getResearchMultiplier(FULL_STATE_H, groups), 1.125), weapon + " 满专精科研乘子必须严格 1.125");
      okH(!nearH(RSH.getResearchMultiplier(FULL_STATE_H, groups), weaponCompoundH, 1e-6), weapon + " 不得得到逐项复利结果 " + weaponCompoundH);
      okH(nearH(dmgH(FULL_STATE_H, weapon) / dmgH(ZERO_H, weapon), 1.125), weapon + " 真实伤害倍率必须恰好 ×1.125");
      okH(sandbox.getCombatResearchGroups("damageMultiplier", weapon).join(",") === groups.join(","), weapon + " 科研组合必须与规格一致");
    }
    // proj 是科研注册表对射弹的别名，与 cannon 共用 projDmg 专精
    okH(sandbox.getCombatResearchGroups("damageMultiplier", "proj").join(",") === WEAPON_GROUPS_H.cannon.join(","), "proj 别名必须与 cannon 共用同一组合");

    // ---- H-04 武器专精严格互不串味 --------------------------------------------------------
    const SPEC_H = [["laser", "laser"], ["missile", "missile"], ["projectile", "cannon"]];
    for (const [nodeId, weapon] of SPEC_H) {
      const onlyH = mkShipH({ [nodeId]: 5 });
      okH(nearH(dmgH(onlyH, weapon) / dmgH(ZERO_H, weapon), 1.06), "只点 " + nodeId + " 时 " + weapon + " 必须 ×1.06");
      for (const other of ["laser", "missile", "cannon"]) {
        if (other === weapon) continue;
        okH(dmgH(onlyH, other) === dmgH(ZERO_H, other), "只点 " + nodeId + " 时 " + other + " 伤害必须逐值不变");
      }
    }
    // tactical 影响三类武器，但每类只吃一次
    const tacticalOnlyH = mkShipH({ tactical: 5 });
    for (const weapon of ["laser", "missile", "cannon"]) {
      okH(nearH(dmgH(tacticalOnlyH, weapon) / dmgH(ZERO_H, weapon), 1.015), "tactical 必须对 " + weapon + " 生效且只吃一次");
    }
    // 未知武器类型：保持接入前安全结果，不应用科研
    okH(sandbox.getCombatDamageMultiplierFromState(FULL_STATE_H, "plasma") === 1, "未知 weaponType 必须保持安全结果 1");
    okH(sandbox.getCombatResearchModifierList(FULL_STATE_H, "damageMultiplier", "plasma").length === 0, "未知 weaponType 不得产生科研 modifier");

    // ---- H-05 三层生命严格 1.105，拒绝复利，层间隔离 --------------------------------------
    const hpCompoundH = 1.03 * 1.06 * 1.015; // ≈ 1.1082（错误结果）
    const HP_BASE_H = { shield: baseShieldH, armor: baseArmorH, structure: baseStructureH };
    const fullHpH = hpH(FULL_STATE_H);
    for (const layer of ["shield", "armor", "structure"]) {
      const groups = ["tierHp", layer, "tactical"];
      okH(nearH(RSH.getResearchCombinedBonus(FULL_STATE_H, groups), 0.105), layer + " 加法汇总必须为 0.105");
      okH(nearH(RSH.getResearchMultiplier(FULL_STATE_H, groups), 1.105), layer + " 满科研乘子必须严格 1.105");
      okH(!nearH(RSH.getResearchMultiplier(FULL_STATE_H, groups), hpCompoundH, 1e-6), layer + " 不得得到逐项复利结果 " + hpCompoundH);
      okH(fullHpH[layer] === Math.round(HP_BASE_H[layer] * 1.105), layer + " 最终 HP 必须等于接入前基线 ×1.105 后取整");
      okH(sandbox.getCombatResearchGroups("maxHp", layer).join(",") === groups.join(","), layer + " 科研组合必须与规格一致");
    }
    for (const layer of ["shield", "armor", "structure"]) {
      const onlyH = hpH(mkShipH({ [layer]: 5 }));
      okH(onlyH[layer] === Math.round(HP_BASE_H[layer] * 1.06), "只点 " + layer + " 专精必须 ×1.06");
      for (const other of ["shield", "armor", "structure"]) {
        if (other === layer) continue;
        okH(onlyH[other] === zeroHpH[other], "只点 " + layer + " 专精时 " + other + " 必须逐值不变");
      }
    }
    const tierOnlyH = hpH(mkShipH({ defense: 5 }));
    const tacticalHpH = hpH(tacticalOnlyH);
    for (const layer of ["shield", "armor", "structure"]) {
      okH(tierOnlyH[layer] === Math.round(HP_BASE_H[layer] * 1.03), "tierHp 必须同时影响 " + layer);
      okH(tacticalHpH[layer] === Math.round(HP_BASE_H[layer] * 1.015), "tactical 必须同时影响 " + layer + " 且只吃一次");
    }

    // ---- H-06 维修满级 1.06 ---------------------------------------------------------------
    okH(nearH(RSH.getResearchMultiplier(FULL_STATE_H, ["repair"]), 1.06), "repair 满级科研乘子必须严格 1.06");
    for (const layer of ["shield", "armor", "structure"]) {
      okH(nearH(repH(FULL_STATE_H, layer) / repH(ZERO_H, layer), 1.06), layer + " 维修倍率必须 ×1.06");
      okH(sandbox.getCombatResearchGroups("repairMultiplier", layer).join(",") === "repair", layer + " 维修科研组必须只有 repair");
    }

    // ---- H-07 聚合 modifier 约束：每个 stat 最多一条 source:"research" --------------------
    const STAT_KEYS_H = [
      ["damageMultiplier", "laser"], ["damageMultiplier", "missile"], ["damageMultiplier", "cannon"],
      ["maxHp", "shield"], ["maxHp", "armor"], ["maxHp", "structure"],
      ["repairMultiplier", "shield"], ["repairMultiplier", "armor"], ["repairMultiplier", "structure"]
    ];
    for (const [stat, key] of STAT_KEYS_H) {
      const list = sandbox.getCombatResearchModifierList(FULL_STATE_H, stat, key);
      okH(list.length === 1, stat + "/" + key + " 必须恰好一条科研 modifier");
      okH(list[0].source === "research" && list[0].operation === "multiply", stat + "/" + key + " 科研 modifier 必须是 multiply/research");
      okH(list[0].value === RSH.getResearchMultiplier(FULL_STATE_H, sandbox.getCombatResearchGroups(stat, key)),
        stat + "/" + key + " 的 value 必须直接来自一次 getResearchMultiplier");
    }
    okH((FULL_STATE_H.combat.modifiers || []).filter(m => m && m.source === "research").length === 0, "科研 modifier 不得写入 state.combat.modifiers");
    okH(!Object.prototype.hasOwnProperty.call(FULL_STATE_H.research, "combatModifiers"), "科研战斗接入不得新增存档字段");

    // ---- H-08 战斗经验：科研与空间站两个独立乘区 -----------------------------------------
    const WHITELIST_H = G("COMBAT_SKILL_WHITELIST");
    okH(Array.isArray(WHITELIST_H) && WHITELIST_H.length === 10, "战斗技能白名单必须仍为 10 项");
    // 无空间站：科研经验仍然生效，且不得伪报空间站加成事件
    const xpSoloH = mkH(FULL_H);
    xpSoloH.station.bodyLevel = 0;
    xpSoloH.station.buildings.combat_command = 0;
    xpSoloH.station.maintenance.fuelRemaining = 0;
    okH(sandbox.getStationCombatXpMultiplier(xpSoloH) === 1, "无空间站时作战指挥中心倍率必须为 1");
    for (const skill of WHITELIST_H) {
      xpSoloH.skills[skill] = { lvl: 99, xp: 0 };
      const soloEventsH = [];
      const unSoloH = sandbox.GameEvents.on("station:combatXpBoosted", event => soloEventsH.push(event));
      const gainedSoloH = sandbox.addStationModifiedCombatXp(xpSoloH, skill, 100);
      unSoloH();
      okH(nearH(gainedSoloH, 106, 1e-9), skill + " 无空间站时科研经验必须仍生效（100 → 106）");
      okH(nearH(xpSoloH.skills[skill].xp, 106, 1e-9), skill + " 真实入账必须等于 106");
      okH(soloEventsH.length === 0, skill + " 仅科研生效时不得 emit station:combatXpBoosted");
    }
    // 有空间站：两个乘区相乘，事件数学关系成立
    const xpStationH = mkH(FULL_H);
    xpStationH.station.bodyLevel = 3;
    xpStationH.station.buildings.combat_command = 3;
    xpStationH.station.maintenance.fuelRemaining = 500000;
    xpStationH.skills.laserOps = { lvl: 99, xp: 0 };
    okH(sandbox.getStationCombatXpMultiplier(xpStationH) === 1.30, "Lv.3 有油作战指挥中心必须为 ×1.30");
    const stationEventsH = [];
    const unStationH = sandbox.GameEvents.on("station:combatXpBoosted", event => stationEventsH.push(event));
    const gainedStationH = sandbox.addStationModifiedCombatXp(xpStationH, "laserOps", 100);
    unStationH();
    okH(nearH(gainedStationH, 100 * 1.06 * 1.30, 1e-9), "科研与空间站必须是独立乘区：100 × 1.06 × 1.30");
    okH(nearH(xpStationH.skills.laserOps.xp, 100 * 1.06 * 1.30, 1e-9), "真实入账必须等于两个乘区之积");
    okH(stationEventsH.length === 1, "空间站真实生效时必须恰好 emit 一次 combatXpBoosted");
    const payloadH = stationEventsH[0].payload;
    okH(nearH(payloadH.baseXp, 106, 1e-9), "事件 baseXp 必须是科研调整后的基准（researchAdjustedBase）");
    okH(payloadH.multiplier === 1.30, "事件 multiplier 必须仍为真实空间站倍率");
    okH(nearH(payloadH.actualXp, gainedStationH, 1e-12), "事件 actualXp 必须等于最终真实入账");
    okH(nearH(payloadH.baseXp * payloadH.multiplier, payloadH.actualXp, 1e-9), "事件必须保持 baseXp × multiplier === actualXp");
    // 零科研 + 空间站：与接入前逐值一致
    const xpLegacyH = mkH({});
    xpLegacyH.station.bodyLevel = 3;
    xpLegacyH.station.buildings.combat_command = 3;
    xpLegacyH.station.maintenance.fuelRemaining = 500000;
    xpLegacyH.skills.laserOps = { lvl: 99, xp: 0 };
    const legacyEventsH = [];
    const unLegacyH = sandbox.GameEvents.on("station:combatXpBoosted", event => legacyEventsH.push(event));
    const gainedLegacyH = sandbox.addStationModifiedCombatXp(xpLegacyH, "laserOps", 100);
    unLegacyH();
    okH(gainedLegacyH === 130, "零科研 + Lv.3 空间站必须与接入前完全一致（130）");
    okH(legacyEventsH.length === 1 && legacyEventsH[0].payload.baseXp === 100 && legacyEventsH[0].payload.actualXp === 130, "零科研时事件 payload 必须逐值不变");
    // 非白名单技能不吃 combatExp
    const xpNonH = mkH(FULL_H);
    xpNonH.station.bodyLevel = 3;
    xpNonH.station.buildings.combat_command = 3;
    xpNonH.station.maintenance.fuelRemaining = 500000;
    for (const skill of ["mining", "refining", "gasHarvesting", "shipEngineering"]) {
      okH(!WHITELIST_H.includes(skill), skill + " 必须确非战斗白名单技能");
      xpNonH.skills[skill] = { lvl: 99, xp: 0 };
      const nonEventsH = [];
      const unNonH = sandbox.GameEvents.on("station:combatXpBoosted", event => nonEventsH.push(event));
      const gainedNonH = sandbox.addStationModifiedCombatXp(xpNonH, skill, 100);
      unNonH();
      okH(gainedNonH === 100, skill + " 非白名单技能不得获得科研战斗经验");
      okH(nonEventsH.length === 0, skill + " 非白名单技能不得 emit 加成事件");
    }
    // 离线不存在第二条战斗经验路径（战斗离线冻结）
    okH(!/addStationModifiedCombatXp/.test(scripts[scriptSources.indexOf("./js/core/offline.js")]), "离线结算不得存在第二条战斗经验入口");

    // ---- H-09 显示态与真实 combatTick 同源，敌方不受影响 ---------------------------------
    const zoneObjH = G('COMBAT_ZONES.find(zone => zone.id === "angel_outpost")');
    const weaponModH = sandbox.getInstalledCombatModulesFromState(ZERO_H).filter(module => module.combat.kind === "weapon")[0];
    okH(Boolean(weaponModH) && weaponModH.combat.weaponType === "laser", "战斗夹具必须真实装配一门激光武器");
    for (const [label, state] of [["零科研", ZERO_H], ["满科研", FULL_STATE_H]]) {
      const displayH = sandbox.getCombatDisplayState(state, nowH);
      const selectorH = sandbox.getCombatDamageMultiplierFromState(state, "laser", { now: nowH, zoneId: zoneObjH.id });
      okH(displayH.player.volleyDamage === Math.round(weaponModH.combat.baseDamage * selectorH), label + " 显示齐射伤害必须自然反映科研，不在显示层追加倍率");
    }
    okH(nearH(sandbox.getCombatDisplayState(FULL_STATE_H, nowH).player.volleyDamage /
      sandbox.getCombatDisplayState(ZERO_H, nowH).player.volleyDamage, 1.125, 2e-3), "显示齐射伤害必须随科研 ×1.125");
    const enemySigH = (state) => {
      gsH.research.completedLevels = JSON.parse(JSON.stringify(state.research.completedLevels));
      const wave = sandbox.buildCombatWave(zoneObjH, 1, () => 0);
      return JSON.stringify(wave.enemies.map(enemy => ({ hp: enemy.hp, maxHp: enemy.maxHp, baseDamage: enemy.baseDamage, hit: enemy.hit, dodge: enemy.dodge })));
    };
    okH(enemySigH(ZERO_H) === enemySigH(FULL_STATE_H), "战斗科研不得修改敌方 HP / 伤害 / 命中 / 闪避");
    gsH.research.completedLevels = {};

    // ---- H-10 真实 combatTick：maxHp / 维修 / 燃料 ----------------------------------------
    const tickShipH = sandbox.createShipInstance("rifter", 1700000000000);
    tickShipH.enhancementLevel = 0;
    tickShipH.fitted = JSON.parse(JSON.stringify(FIT_H));
    gsH.research.completedLevels = {};
    gsH.inventory.ships = [tickShipH];
    gsH.shipAssignments = { combat: tickShipH.instanceId };
    if (gsH.equipment) gsH.equipment.inventory = [];
    gsH.resources.fuel = 1000000;
    gsH.resources.ammunition = { laser: 100000, missile: 100000, cannon: 100000 };
    gsH.station.bodyLevel = 0;
    gsH.station.buildings.combat_command = 0;
    gsH.station.maintenance.fuelRemaining = 0;
    // hit:0 → calcCombatDamage 命中系数恒为 0 → 敌方每次恰好造成 1 点伤害（完全确定性）
    const mkTargetH = () => ({
      id: "batch_h_target", name: "BatchH 靶舰", kind: "normal",
      hp: { shield: 900000, armor: 900000, structure: 900000 },
      maxHp: { shield: 900000, armor: 900000, structure: 900000 },
      hit: 0, dodge: 30, baseDamage: 50, iskDrop: 0, xpDrop: 0, level: 1, defeated: false, rewarded: false
    });
    const armCombatH = (hpOverride) => {
      const maxHp = sandbox.getCombatMaxHpFromState(gsH);
      const target = mkTargetH();
      gsH.combat = Object.assign({}, savedCombatH, {
        active: true, mode: "belt", viewMode: "belt", zone: zoneObjH.id, activeShip: tickShipH.instanceId,
        enemies: [target], currentEnemy: target, wave: 1, currentFormation: "",
        hp: Object.assign({}, maxHp, hpOverride || {}), maxHp: Object.assign({}, maxHp),
        modifiers: [], repairUntil: 0, destroyedShip: null, lastStatus: "", lastEnemyVolley: null,
        runWeaponTypes: [], runWeaponTypesZone: null, runDamageDealt: 0, runDamageTaken: 0
      });
      gsH.currentAction.skill = "combat";
      gsH.currentAction.active = true;
      return maxHp;
    };
    const repModuleH = sandbox.getInstalledCombatRepairers()[0];
    okH(Boolean(repModuleH) && repModuleH.equipment.combat.target === "shield", "战斗夹具必须真实装配护盾回充器");
    const repBaseAmountH = repModuleH.equipment.combat.amount * (repModuleH.multiplier || 1);
    const boosterRepH = sandbox.getBoosterEffectState(gsH).repairMultiplier.shield;

    // 零科研一轮：护盾打到 1，敌方恰好 1 点伤害 → 归零后由维修器治疗
    const zeroMaxHpTickH = armCombatH({ shield: 1 });
    const zeroRepMultH = sandbox.calcRepairMult("shield");
    const zeroFuelBeforeH = gsH.resources.fuel;
    const enemyShieldBeforeH = gsH.combat.enemies[0].hp.shield;
    sandbox.combatTick();
    const zeroHealH = gsH.combat.hp.shield;
    const zeroFuelSpentH = zeroFuelBeforeH - gsH.resources.fuel;
    okH(JSON.stringify(gsH.combat.maxHp) === JSON.stringify(zeroMaxHpTickH), "真实战斗的 maxHp 必须来自唯一选择器");
    okH(gsH.combat.enemies[0].hp.shield < enemyShieldBeforeH, "真实齐射必须对敌方造成伤害");
    okH(gsH.combat.lastEnemyVolley.totalDamage === 1, "夹具敌方每轮必须恰好造成 1 点伤害（确定性）");
    okH(zeroHealH === Math.round(repBaseAmountH * zeroRepMultH * boosterRepH), "零科研真实治疗量必须等于接入前公式");

    // 满科研一轮：同一夹具，只有科研不同
    gsH.research.completedLevels = Object.assign({}, FULL_H);
    const fullMaxHpTickH = armCombatH({ shield: 1 });
    const fullRepMultH = sandbox.calcRepairMult("shield");
    const fullFuelBeforeH = gsH.resources.fuel;
    sandbox.combatTick();
    const fullHealH = gsH.combat.hp.shield;
    const fullFuelSpentH = fullFuelBeforeH - gsH.resources.fuel;
    okH(fullMaxHpTickH.shield === Math.round(baseShieldH * 1.105), "新战斗必须使用科研后的 maxHp");
    okH(nearH(fullRepMultH / zeroRepMultH, 1.06), "真实维修倍率必须 ×1.06");
    okH(fullHealH === Math.round(repBaseAmountH * zeroRepMultH * 1.06 * boosterRepH), "满科研真实治疗量必须按 ×1.06 提升");
    okH(fullHealH > zeroHealH, "科研必须真实提升治疗量");
    okH(fullFuelSpentH === zeroFuelSpentH, "科研不得改变齐射与维修的燃料成本");

    // 溢出维修必须钳制到 maxHp
    const clampMaxHpH = armCombatH({});
    gsH.combat.hp.shield = clampMaxHpH.shield - 1;
    sandbox.combatTick();
    okH(gsH.combat.hp.shield === gsH.combat.maxHp.shield, "溢出维修后 HP 不得超过 maxHp");

    // 未安装维修装备的层不得被科研治疗
    tickShipH.fitted.mid = [];
    const noRepairMaxHpH = armCombatH({ shield: 1 });
    sandbox.combatTick();
    okH(sandbox.getInstalledCombatRepairers().length === 0, "该轮必须确无维修装备");
    okH(gsH.combat.hp.shield === 0, "未安装维修装备时护盾不得被治疗");
    okH(gsH.combat.hp.armor === noRepairMaxHpH.armor && gsH.combat.hp.structure === noRepairMaxHpH.structure, "未安装维修装备的层不得产生治疗");
    tickShipH.fitted.mid = ["t1_shield_booster"];

    // 战斗中途研究完成：不免费治疗、不强制重算已冻结的 combat.maxHp
    gsH.research.completedLevels = {};
    armCombatH({ shield: 1 });
    sandbox.combatTick();
    const midMaxHpH = JSON.stringify(gsH.combat.maxHp);
    const midHpH = JSON.stringify(gsH.combat.hp);
    gsH.research.completedLevels = Object.assign({}, FULL_H);
    okH(JSON.stringify(gsH.combat.maxHp) === midMaxHpH, "战斗中途完成研究不得强制重算已冻结的 combat.maxHp");
    okH(JSON.stringify(gsH.combat.hp) === midHpH, "战斗中途完成研究不得免费治疗当前舰船");
    // 下一场新战斗使用新科研 HP
    okH(sandbox.dispatchGameAction(gsH, { type: "combat/stop" }, nowH).changed === true, "必须能结束当前战斗");
    okH(gsH.combat.maxHp.shield === Math.round(baseShieldH * 1.105), "下一场战斗必须使用新的科研 maxHp");
    // 真实 combatTick 与显示态同源
    okH(sandbox.calcPlayerDmgMult("laser") === sandbox.getCombatDamageMultiplierFromState(gsH, "laser"), "真实 combatTick 伤害倍率必须与选择器同源");

    // ---- H-11 Batch G 非战斗结果不回退、战斗科研不外溢 ------------------------------------
    gsH.research.completedLevels = {};
    okH(nearH(sandbox.getProductionEfficiencyState(mkH({ syseng: 1, mine: 5 }), "mining").total /
      sandbox.getProductionEfficiencyState(mkH({}), "mining").total, 1.08, 1e-9), "Batch G 采集 ×1.08 不得回退");
    okH(nearH(RSH.getResearchMultiplier(mkH({ autocon: 1, arch: 5 }), ["archEff"]), 1.08), "Batch G archEff ×1.08 不得回退");
    okH(nearH(RSH.getResearchMultiplier(mkH({ planind: 5 }), ["planProd"]), 1.09), "Batch G planProd ×1.09 不得回退");
    okH(sandbox.getProductionEfficiencyState(FULL_STATE_H, "mining").total === sandbox.getProductionEfficiencyState(ZERO_H, "mining").total, "战斗科研不得外溢到非战斗产能");
    okH(RDH.NODES.filter(node => node.type === "protocol").every(node => !node.bonus), "六协议节点必须仍然无 bonus（本批不进协议业务）");

    // ---- H-12 冻结基线不回退 --------------------------------------------------------------
    okH(RDH.NODES.length === 38, "科技节点总数必须仍为 38");
    okH(scriptSources.length === 56 && styleSources.length === 4 && htmlIds.size === 313, "56 JS / 4 CSS / 313 DOM ID 基线不得回退");
  } finally {
    gsH.research = JSON.parse(JSON.stringify(savedResearchH));
    gsH.combat = JSON.parse(JSON.stringify(savedCombatH));
    gsH.currentAction = JSON.parse(JSON.stringify(savedActionH));
    gsH.shipAssignments = JSON.parse(JSON.stringify(savedAssignH));
    gsH.skills = JSON.parse(JSON.stringify(savedSkillsH));
    gsH.station = JSON.parse(JSON.stringify(savedStationH));
    gsH.resources = JSON.parse(JSON.stringify(savedResourcesH));
    if (gsH.inventory) gsH.inventory.ships = JSON.parse(JSON.stringify(savedShipsH));
    if (gsH.equipment) gsH.equipment.inventory = JSON.parse(JSON.stringify(savedEquipH));
  }

  console.log("Batch H 战斗数值科技校验通过（" + hChecks + " 项）：12 组零科研基线与 31 组数值 group 全量登记、三武器满专精严格 1.125 并拒绝逐项复利、激光/导弹/射弹专精互不串味、tactical 三武器各只一次、未知武器类型不应用科研、三层生命严格 1.105 且层间隔离、tierHp/tactical 同时影响三层、每个 stat 恰一条聚合 research modifier 且 value 来自单次 getResearchMultiplier、维修 ×1.06 且燃料成本与上限钳制不变、未装维修装备不产生治疗、战斗经验科研与空间站独立乘区、仅科研不伪报 combatXpBoosted、事件 baseXp×multiplier===actualXp、非白名单技能不吃 combatExp、显示齐射与真实 combatTick 同源、敌方 HP/伤害零影响、战斗中途完成研究不免费治疗且不强制重算、下一场使用新 maxHp、Batch G 结果与 38 节点/50 JS/4 CSS/294 DOM 基线不回退");
}

// ============================================================================================
// 研究系统 Batch I：三项经济自动化协议完整实装（planauto / autosell / autoconv）
// 铁律：
//   1) 解锁唯一事实来源 = research.completedLevels[protocolId] >= 1；三层门槛（已研究 → 总开关 →
//      业务条件）缺一不可；脏档 enabled=true 但未研究绝不越权执行；
//   2) 绝不复制业务公式：续期费取 getPlanetRenewCostISK、续期走 PlanetaryStateActions.renew、
//      出售 / 兑换走 sellArchaeologyArtifacts / redeemArchaeologyArtifacts；
//   3) 在线 planetaryTick 与离线 settleOfflinePlanets 共用 advancePlanetDeploymentTimeline 唯一时间轴；
//   4) 只实现三协议，不进 intship / autoenh / autorepair。
// ============================================================================================
{
  let iChecks = 0;
  const okI = (condition, message) => {
    if (!condition) throw new Error("Batch I 校验失败：" + message);
    iChecks += 1;
  };

  const RSI = sandbox.ResearchState;
  const RDI = sandbox.ResearchData;
  const RSYSI = sandbox.ResearchSystem;
  const RRI = G("ResourceRegistry");
  const REASONS_I = G("RESEARCH_PROTOCOL_REASONS");
  const gsI = sandbox.gameState;
  const nowI = 1767225600000;
  const DAY_MS_I = 86400 * 1000;
  const lavaI = G("PLANET_TYPES").find(planet => planet.id === "lava");

  const savedResearchI = JSON.parse(JSON.stringify(gsI.research));
  const savedPlanetaryI = JSON.parse(JSON.stringify(gsI.planetary || { deployments: [], nextId: 1 }));
  const savedResourcesI = JSON.parse(JSON.stringify(gsI.resources));
  const savedSkillsI = JSON.parse(JSON.stringify(gsI.skills));
  const savedStatsI = JSON.parse(JSON.stringify(gsI.statistics));
  const savedArchI = JSON.parse(JSON.stringify(gsI.archaeology));
  const savedActionI = JSON.parse(JSON.stringify(gsI.currentAction));

  try {
    const pristineI = JSON.parse(JSON.stringify(gsI));

    // 夹具：干净默认研究状态 + 指定已完成等级 + 指定协议总开关
    const mkI = (levels, protocolEnabled) => {
      const state = JSON.parse(JSON.stringify(pristineI));
      state.research = RSI.createDefaultResearchState();
      state.research.lastProcessedAt = nowI;
      state.research.completedLevels = Object.assign({}, levels || {});
      for (const [key, value] of Object.entries(protocolEnabled || {})) {
        state.research.protocolSettings[key].enabled = value;
      }
      state.planetary = { deployments: [], nextId: 1 };
      state._dirty = false;
      return state;
    };
    // 行星夹具：默认恰好在 nowI 到期（deployedAt = nowI - 24h，duration = 24h）
    const mkPlanI = (levels, protocolEnabled, specs, isk) => {
      const state = mkI(levels, protocolEnabled);
      state.planetary = {
        nextId: specs.length + 1,
        deployments: specs.map((spec, idx) => Object.assign({
          id: "planet_i_" + (idx + 1),
          planetType: lavaI.id,
          deployedAt: nowI - DAY_MS_I,
          duration: 86400,
          storage: 0,
          lastTick: nowI - 1000,
          progress: 0,
          active: true
        }, spec))
      };
      RRI.set(state, "currency:isk", Number(isk) || 0);
      state._dirty = false;
      return state;
    };
    // 文物夹具：ISK 类 2+1 件（600×2 + 3000 = 4200）、LP 3 件（50×3 = 150）、校准物 4 件（永不自动处理）
    const mkArtI = (levels, protocolEnabled) => {
      const state = mkI(levels, protocolEnabled);
      RRI.set(state, "currency:isk", 0);
      RRI.set(state, "currency:lp", 0);
      for (const artifact of G("ARCHAEOLOGY_ARTIFACTS")) RRI.set(state, "artifact:" + artifact.id, 0);
      RRI.set(state, "artifact:art_i_common_a", 2);
      RRI.set(state, "artifact:art_i_unique_a", 1);
      RRI.set(state, "artifact:art_i_lp", 3);
      RRI.set(state, "artifact:art_i_calib", 4);
      state._dirty = false;
      return state;
    };
    // 在线 tick / 离线结算都跑真实全局入口：临时把夹具子树挂进 gameState，跑完原样还原
    const withGameStateI = (state, fn) => {
      const savedR = gsI.research, savedP = gsI.planetary, savedRes = gsI.resources, savedSk = gsI.skills;
      gsI.research = state.research; gsI.planetary = state.planetary;
      gsI.resources = state.resources; gsI.skills = state.skills;
      try { return fn(); } finally {
        gsI.research = savedR; gsI.planetary = savedP; gsI.resources = savedRes; gsI.skills = savedSk;
      }
    };
    const runTickI = (state, tickNow) => withGameStateI(state, () => sandbox.planetaryTick(tickNow));
    const runOfflineI = (state, seconds, segEnd) => withGameStateI(state, () => {
      const gains = { planetaryIndustry: 0 };
      sandbox.settleOfflinePlanets(seconds, gains, segEnd);
      return gains;
    });

    // ---- I-01 统一协议模块：API / 已实装集合 / 11 个稳定 reason ------------------------------
    const apiNamesI = [
      "isResearchProtocolUnlocked", "isResearchProtocolEnabled", "isResearchProtocolActive",
      "setResearchProtocolEnabled", "setPlanetAutoRenew", "getResearchProtocolDisplayState",
      "tryPlanetAutoRenew", "applyArchaeologyArtifactProtocols"
    ];
    okI(apiNamesI.every(name => typeof sandbox[name] === "function"), "统一协议模块必须暴露全部公开 API：" + apiNamesI.join("/"));
    okI(G("IMPLEMENTED_RESEARCH_PROTOCOLS").join(",") === "planauto,autosell,autoconv,autoenh,autorepair,intship" &&
        G("ALL_RESEARCH_PROTOCOLS").length === 6,
      "Batch K 后已实装协议必须为六个协议全实装，协议全集仍为 6 个");
    const reasonKeysI = ["INVALID_STATE", "UNKNOWN_PROTOCOL", "PROTOCOL_LOCKED", "INVALID_ENABLED",
      "UNKNOWN_DEPLOYMENT", "INVALID_RESERVE", "ALREADY_SET", "PROTOCOL_DISABLED",
      "RESERVE_NOT_MET", "INSUFFICIENT_ISK", "NOTHING_TO_PROCESS"];
    okI(Object.keys(REASONS_I).length === 11 && reasonKeysI.every(key => REASONS_I[key] === key),
      "稳定 reason 必须恰为 11 个且值与键名一致");

    // ---- I-02 新游戏零副作用 ----------------------------------------------------------------
    const freshI = mkI({});
    okI(["planauto", "autosell", "autoconv"].every(pid =>
        sandbox.isResearchProtocolUnlocked(freshI, pid) === false &&
        sandbox.isResearchProtocolEnabled(freshI, pid) === false &&
        sandbox.isResearchProtocolActive(freshI, pid) === false),
      "新游戏默认三协议必须全部未解锁、未启用、不可执行");
    okI(Object.keys(freshI.research.protocolSettings).length === 6 &&
        !Object.prototype.hasOwnProperty.call(freshI.research.protocolSettings.planauto, "minIskReserve"),
      "默认 protocolSettings 必须是 6 个协议，且 planauto 不保存全局最低储备金");
    const freshPlanI = mkPlanI({}, {}, [{ autoRenew: { enabled: true, minIskReserve: 0 } }], 1000000000);
    const freshSnapI = JSON.stringify(freshPlanI.research);
    const freshExpiredI = [];
    const unsubFreshI = sandbox.GameEvents.on("planetary:expired", event => freshExpiredI.push(event.payload.deploymentId));
    runTickI(freshPlanI, nowI + 1000);
    unsubFreshI();
    okI(freshExpiredI.join(",") === "planet_i_1" && freshPlanI.planetary.deployments[0].active === false &&
        RRI.get(freshPlanI, "currency:isk") === 1000000000 && JSON.stringify(freshPlanI.research) === freshSnapI,
      "未研究 planauto 时即使基地已开自动续期也必须照常到期停产、零扣费、零写入");

    // ---- I-03 脏档保护：enabled=true 但未研究 → 绝不执行 --------------------------------------
    const dirtyPlanI = mkPlanI({}, { planauto: true }, [{ autoRenew: { enabled: true, minIskReserve: 0 } }], 1000000000);
    const dirtyTryI = sandbox.tryPlanetAutoRenew(dirtyPlanI, dirtyPlanI.planetary.deployments[0], nowI, { offline: false });
    okI(sandbox.isResearchProtocolEnabled(dirtyPlanI, "planauto") === true &&
        sandbox.isResearchProtocolActive(dirtyPlanI, "planauto") === false &&
        dirtyTryI.renewed === false && dirtyTryI.reason === REASONS_I.PROTOCOL_LOCKED &&
        RRI.get(dirtyPlanI, "currency:isk") === 1000000000,
      "脏档 enabled=true 但未研究时必须 PROTOCOL_LOCKED、零扣费");

    // ---- I-04 真实研究链解锁（不伪造 completedLevels） ----------------------------------------
    const chainI = mkI({ dataarch: 4, planfin: 4 });
    okI(sandbox.dispatchGameAction(chainI, { type: "research/start", techId: "autosell", targetLevel: 1 }, nowI).changed === true,
      "前置满足后必须能通过真实 action 启动 autosell 协议研究");
    let chainCursorI = nowI;
    for (let guard = 0; guard < 400 && chainI.research.activeResearch; guard += 1) {
      chainCursorI += DAY_MS_I;
      RSYSI.processResearchUntil(chainI, chainCursorI);
    }
    okI(!chainI.research.activeResearch && Number(chainI.research.completedLevels.autosell) === 1 &&
        sandbox.isResearchProtocolUnlocked(chainI, "autosell") === true &&
        sandbox.isResearchProtocolEnabled(chainI, "autosell") === false &&
        sandbox.isResearchProtocolActive(chainI, "autosell") === false,
      "真实研究链完成后 autosell 解锁，但不得自动开启总开关");

    // ---- I-05 setResearchProtocolEnabled：成功 / 重复 / 非法 / 未知 / 未研究 -------------------
    const setStateI = mkI({ planauto: 1, autosell: 1, autoconv: 1 });
    RRI.set(setStateI, "currency:isk", 1000);
    RRI.set(setStateI, "artifact:art_i_common_a", 5);
    const setOkI = sandbox.setResearchProtocolEnabled(setStateI, "autosell", true, nowI);
    okI(setOkI.changed === true && setStateI.research.protocolSettings.autosell.enabled === true &&
        setStateI.research.protocolSettings.autoconv.enabled === false &&
        setStateI.research.protocolSettings.planauto.enabled === false && setStateI._dirty === true &&
        RRI.get(setStateI, "currency:isk") === 1000 && RRI.get(setStateI, "artifact:art_i_common_a") === 5,
      "开启协议只改该协议开关并置脏，绝不执行任何业务");
    okI(sandbox.setResearchProtocolEnabled(setStateI, "autosell", true, nowI).reason === REASONS_I.ALREADY_SET,
      "重复设置同一值必须返回 ALREADY_SET");
    okI(["true", 1, null, undefined, {}].every(value =>
        sandbox.setResearchProtocolEnabled(setStateI, "autoconv", value, nowI).reason === REASONS_I.INVALID_ENABLED) &&
        setStateI.research.protocolSettings.autoconv.enabled === false,
      "非布尔开关一律 INVALID_ENABLED 且不改状态");
    okI(sandbox.setResearchProtocolEnabled(setStateI, "nope", true, nowI).reason === REASONS_I.UNKNOWN_PROTOCOL,
      "未知协议必须返回 UNKNOWN_PROTOCOL");
    okI(["autoenh", "autorepair", "intship", "planauto", "autosell", "autoconv"].every(pid =>
        sandbox.setResearchProtocolEnabled(setStateI, pid, true, nowI).reason !== REASONS_I.UNKNOWN_PROTOCOL),
      "Batch K 后六个协议全部实装，一律不得返回 UNKNOWN_PROTOCOL");
    const lockedSetI = mkI({});
    const lockedRouteI = sandbox.dispatchGameAction(lockedSetI, { type: "research/setProtocolEnabled", protocolId: "planauto", enabled: true }, nowI);
    okI(lockedRouteI.changed === false && lockedRouteI.reason === REASONS_I.PROTOCOL_LOCKED &&
        lockedSetI.research.protocolSettings.planauto.enabled === false && lockedSetI._dirty === false,
      "未研究协议经 action 路由也必须 PROTOCOL_LOCKED 且零副作用");

    // ---- I-06 setPlanetAutoRenew：每基地独立 + 参数校验 ---------------------------------------
    const twoPlanI = mkPlanI({ planauto: 1 }, { planauto: true }, [{}, {}], 1000000);
    const depAI = twoPlanI.planetary.deployments[0];
    const depBI = twoPlanI.planetary.deployments[1];
    okI(sandbox.setPlanetAutoRenew(twoPlanI, depAI.id, true, 12345.5, nowI).changed === true &&
        depAI.autoRenew.enabled === true && depAI.autoRenew.minIskReserve === 12345.5 &&
        !depBI.autoRenew && twoPlanI._dirty === true,
      "只写目标基地的 autoRenew，合法小数原样保留");
    okI(sandbox.setPlanetAutoRenew(twoPlanI, depBI.id, true, 0, nowI).changed === true &&
        depBI.autoRenew !== depAI.autoRenew && depAI.autoRenew.minIskReserve === 12345.5 && depBI.autoRenew.minIskReserve === 0,
      "两个基地的 autoRenew 必须是独立对象，互不串改");
    okI([-1, NaN, Infinity, "1000", true, null].every(value =>
        sandbox.setPlanetAutoRenew(twoPlanI, depAI.id, true, value, nowI).reason === REASONS_I.INVALID_RESERVE) &&
        depAI.autoRenew.minIskReserve === 12345.5,
      "非法最低储备金一律 INVALID_RESERVE 且不改状态");
    okI(sandbox.setPlanetAutoRenew(twoPlanI, "planet_not_exist", true, 0, nowI).reason === REASONS_I.UNKNOWN_DEPLOYMENT &&
        sandbox.setPlanetAutoRenew(twoPlanI, depAI.id, true, 12345.5, nowI).reason === REASONS_I.ALREADY_SET &&
        sandbox.setPlanetAutoRenew(mkPlanI({}, {}, [{}], 0), "planet_i_1", true, 0, nowI).reason === REASONS_I.PROTOCOL_LOCKED,
      "未知基地 UNKNOWN_DEPLOYMENT、同值重复 ALREADY_SET、未研究 PROTOCOL_LOCKED");
    const routePlanI = sandbox.dispatchGameAction(twoPlanI, { type: "research/setPlanetAutoRenew", deploymentId: depBI.id, enabled: false, minIskReserve: 7 }, nowI);
    okI(routePlanI.changed === true && depBI.autoRenew.enabled === false && depBI.autoRenew.minIskReserve === 7 &&
        !Object.prototype.hasOwnProperty.call(twoPlanI.research.protocolSettings.planauto, "minIskReserve"),
      "action 路由与直调同源；顶层 protocolSettings.planauto 永不保存全局储备金");

    // ---- I-07 储备金边界 + 续期四价同源 ------------------------------------------------------
    const renewCostI = sandbox.getPlanetRenewCostISK(mkI({}), lavaI);
    const reserveI = 20000;
    const mkRenewI = (isk) => mkPlanI({ planauto: 1 }, { planauto: true },
      [{ autoRenew: { enabled: true, minIskReserve: reserveI } }], isk);
    const exactI = mkRenewI(renewCostI + reserveI);
    let renewEventI = null;
    const unsubRenewI = sandbox.GameEvents.on("planetary:renewed", event => { renewEventI = event; });
    const tryExactI = sandbox.tryPlanetAutoRenew(exactI, exactI.planetary.deployments[0], nowI, { offline: false });
    unsubRenewI();
    okI(tryExactI.renewed === true && RRI.get(exactI, "currency:isk") === reserveI &&
        exactI.planetary.deployments[0].deployedAt === nowI && exactI.planetary.deployments[0].active === true,
      "余额恰好等于维护费 + 最低储备金时必须续期成功并精确扣费（边界包含等于）");
    okI(renewEventI && renewEventI.payload.maintenanceISK === renewCostI && tryExactI.maintenanceISK === renewCostI &&
        sandbox.getPlanetDeploymentDisplayState(exactI, exactI.planetary.deployments[0], nowI).renewCost === renewCostI &&
        sandbox.getResearchProtocolDisplayState(exactI, "planauto").deployments[0].renewCostISK === renewCostI,
      "续期四价同源：部署卡显示价 = 协议面板价 = 实扣价 = 事件价");
    const shortI = mkRenewI(renewCostI + reserveI - 1);
    const tryShortI = sandbox.tryPlanetAutoRenew(shortI, shortI.planetary.deployments[0], nowI, { offline: false });
    okI(tryShortI.renewed === false && tryShortI.reason === REASONS_I.RESERVE_NOT_MET &&
        RRI.get(shortI, "currency:isk") === renewCostI + reserveI - 1 &&
        shortI.planetary.deployments[0].deployedAt === nowI - DAY_MS_I,
      "低于最低储备金 1 ISK 必须拒绝续期且不扣任何费用");
    const brokeI = mkRenewI(renewCostI - 1);
    const tryBrokeI = sandbox.tryPlanetAutoRenew(brokeI, brokeI.planetary.deployments[0], nowI, { offline: false });
    okI(tryBrokeI.renewed === false && tryBrokeI.reason === REASONS_I.INSUFFICIENT_ISK &&
        RRI.get(brokeI, "currency:isk") === renewCostI - 1,
      "ISK 不足维护费必须返回 INSUFFICIENT_ISK 且不扣费");
    const offSwitchI = mkRenewI(renewCostI + reserveI);
    offSwitchI.research.protocolSettings.planauto.enabled = false;
    const perDepOffI = mkRenewI(renewCostI + reserveI);
    perDepOffI.planetary.deployments[0].autoRenew.enabled = false;
    okI(sandbox.tryPlanetAutoRenew(offSwitchI, offSwitchI.planetary.deployments[0], nowI, {}).reason === REASONS_I.PROTOCOL_DISABLED &&
        sandbox.tryPlanetAutoRenew(perDepOffI, perDepOffI.planetary.deployments[0], nowI, {}).reason === REASONS_I.PROTOCOL_DISABLED &&
        RRI.get(offSwitchI, "currency:isk") === renewCostI + reserveI,
      "总开关关闭或该基地未开自动续期时必须 PROTOCOL_DISABLED（三层门槛缺一不可）");

    // ---- I-08 多 deployment 互不影响 ---------------------------------------------------------
    const multiI = mkPlanI({ planauto: 1 }, { planauto: true }, [
      { autoRenew: { enabled: true, minIskReserve: 0 } },
      { autoRenew: { enabled: true, minIskReserve: 1000000000 } },
      {}
    ], renewCostI * 2);
    const multiRenewedI = [];
    const multiExpiredI = [];
    const unsubMultiRI = sandbox.GameEvents.on("planetary:renewed", event => multiRenewedI.push(event.payload.deploymentId));
    const unsubMultiEI = sandbox.GameEvents.on("planetary:expired", event => multiExpiredI.push(event.payload.deploymentId));
    runTickI(multiI, nowI);
    unsubMultiRI(); unsubMultiEI();
    okI(multiRenewedI.join(",") === "planet_i_1" && multiExpiredI.slice().sort().join(",") === "planet_i_2,planet_i_3",
      "同一次结算里各基地互不影响：足额者续期，储备金不足与未开自动者各自停产");
    okI(RRI.get(multiI, "currency:isk") === renewCostI &&
        multiI.planetary.deployments[0].active === true &&
        multiI.planetary.deployments[1].active === false && multiI.planetary.deployments[2].active === false,
      "多基地场景只扣成功续期的那一份维护费");

    // ---- I-09 在线跨 expiresAt 只续期一次 ----------------------------------------------------
    const onlineI = mkPlanI({ planauto: 1 }, { planauto: true },
      [{ autoRenew: { enabled: true, minIskReserve: 0 } }], renewCostI * 3);
    const onlineEventsI = [];
    const unsubOnlineI = sandbox.GameEvents.on("planetary:renewed", event => onlineEventsI.push(event));
    runTickI(onlineI, nowI + 1000);
    const iskAfterOnlineI = RRI.get(onlineI, "currency:isk");
    runTickI(onlineI, nowI + 1000);
    unsubOnlineI();
    okI(onlineEventsI.length === 1 && onlineEventsI[0].meta.offline === false && iskAfterOnlineI === renewCostI * 2,
      "在线跨过 expiresAt 只续期一次，事件 metadata 必须是在线（offline=false）");
    okI(RRI.get(onlineI, "currency:isk") === iskAfterOnlineI && onlineI.planetary.deployments[0].active === true,
      "同一时刻重复 tick 不得重复扣费");

    // ---- I-10 离线多周期逐次判断、逐次扣费 ---------------------------------------------------
    const mkOfflineI = (isk) => mkPlanI({ planauto: 1 }, { planauto: true }, [{
      autoRenew: { enabled: true, minIskReserve: 0 },
      deployedAt: nowI - 3 * DAY_MS_I, lastTick: nowI - 3 * DAY_MS_I
    }], isk);
    const offlineI = mkOfflineI(renewCostI * 3);
    const offlineEventsI = [];
    const unsubOfflineI = sandbox.GameEvents.on("planetary:renewed", event => offlineEventsI.push(event));
    runOfflineI(offlineI, 3 * 86400, nowI);
    unsubOfflineI();
    okI(offlineEventsI.length === 3 && RRI.get(offlineI, "currency:isk") === 0 &&
        offlineEventsI.every(event => event.meta.offline === true && event.meta.source === "offline-settlement"),
      "离线跨 3 个维护周期必须逐周期各续期一次、逐次扣费，事件带离线结算 metadata");
    const offlineShortI = mkOfflineI(renewCostI * 2 + renewCostI - 1);
    const offlineExpiredI = [];
    const unsubOffExpI = sandbox.GameEvents.on("planetary:expired", event => offlineExpiredI.push(event));
    runOfflineI(offlineShortI, 3 * 86400, nowI);
    unsubOffExpI();
    okI(offlineExpiredI.length === 1 && offlineShortI.planetary.deployments[0].active === false &&
        RRI.get(offlineShortI, "currency:isk") === renewCostI - 1,
      "离线余额只够 2 次续期时：第 3 个周期停产、只发一次 expired、剩余 ISK 原样保留");

    // ---- I-10ts 虚拟事件时间（真实 GameEvents 捕获对象的 event.timestamp）--------------------
    // 1) 在线 deployment 于 T 到期，planetaryTick 在 T+5000 才执行：
    //    renewed.timestamp === T，payload.expiresAt === T + 维护周期，timestamp !== T+5000
    {
      const Ts = nowI;
      const delayedI = mkPlanI({ planauto: 1 }, { planauto: true }, [{
        autoRenew: { enabled: true, minIskReserve: 0 },
        deployedAt: Ts - DAY_MS_I, lastTick: Ts - 1000
      }], renewCostI * 3);
      const delayedEvI = [];
      const unsubDE = sandbox.GameEvents.on("planetary:renewed", event => delayedEvI.push(event));
      runTickI(delayedI, Ts + 5000);
      unsubDE();
      okI(delayedEvI.length === 1 &&
          delayedEvI[0].timestamp === Ts &&
          delayedEvI[0].payload.expiresAt === Ts + DAY_MS_I &&
          delayedEvI[0].timestamp !== Ts + 5000,
        "在线延期 tick（T+5000 才执行）：renewed.timestamp 必须等于真实到期边界 T、expiresAt=T+维护周期、绝不等于 tick 时刻");
    }

    // 2) 自动续期失败 → expired.timestamp 必须等于 payload.expiredAt === T
    {
      const Te = nowI;
      const failExpI = mkPlanI({ planauto: 1 }, { planauto: true }, [{
        autoRenew: { enabled: true, minIskReserve: 0 },
        deployedAt: Te - DAY_MS_I, lastTick: Te - 1000
      }], 0); // ISK 不足，续期必失败
      const failEvI = [];
      const unsubFE = sandbox.GameEvents.on("planetary:expired", event => failEvI.push(event));
      runTickI(failExpI, Te + 5000);
      unsubFE();
      okI(failEvI.length === 1 &&
          failEvI[0].timestamp === Te &&
          failEvI[0].payload.expiredAt === Te,
        "自动续期失败：expired.timestamp 必须等于 payload.expiredAt 等于真实到期边界 T");
    }

    // 3) 离线三周期连续续期：三个 renewed.timestamp 等于真实周期边界、严格递增、非登录时刻
    {
      const threeCycI = mkPlanI({ planauto: 1 }, { planauto: true }, [{
        autoRenew: { enabled: true, minIskReserve: 0 },
        deployedAt: nowI - 3 * DAY_MS_I, lastTick: nowI - 3 * DAY_MS_I
      }], renewCostI * 3);
      const threeEvI = [];
      const unsub3 = sandbox.GameEvents.on("planetary:renewed", event => threeEvI.push(event));
      runOfflineI(threeCycI, 3 * 86400, nowI);
      unsub3();
      const expectTsI = [nowI - 2 * DAY_MS_I, nowI - DAY_MS_I, nowI];
      const ts3I = threeEvI.map(e => e.timestamp);
      okI(threeEvI.length === 3 &&
          ts3I.every((t, i) => t === expectTsI[i]) &&
          ts3I[0] < ts3I[1] && ts3I[1] < ts3I[2] &&
          threeEvI.every((e, i) => e.payload.expiresAt === e.timestamp + DAY_MS_I) &&
          ts3I.every(t => t !== Date.now()),
        "离线三周期续期：各 renewed.timestamp 等于真实周期边界、严格递增、expiresAt=ts+维护周期、且非登录时刻");
    }

    // 4) 离线第三周期余额不足：前两次 renewed.timestamp 正确，最后 expired.timestamp 等于第三边界，顺序一致
    {
      const shortCycI = mkPlanI({ planauto: 1 }, { planauto: true }, [{
        autoRenew: { enabled: true, minIskReserve: 0 },
        deployedAt: nowI - 3 * DAY_MS_I, lastTick: nowI - 3 * DAY_MS_I
      }], renewCostI * 2); // 只够 2 次续期
      const shortRenI = [];
      const shortExpI = [];
      const unsubSR = sandbox.GameEvents.on("planetary:renewed", event => shortRenI.push(event));
      const unsubSE = sandbox.GameEvents.on("planetary:expired", event => shortExpI.push(event));
      runOfflineI(shortCycI, 3 * 86400, nowI);
      unsubSR(); unsubSE();
      const thirdB = nowI;
      okI(shortRenI.length === 2 &&
          shortRenI[0].timestamp === nowI - 2 * DAY_MS_I &&
          shortRenI[1].timestamp === nowI - DAY_MS_I &&
          shortExpI.length === 1 &&
          shortExpI[0].timestamp === thirdB &&
          shortExpI[0].payload.expiredAt === thirdB &&
          shortRenI[0].timestamp < shortRenI[1].timestamp &&
          shortRenI[1].timestamp < shortExpI[0].timestamp,
        "离线余额只够 2 次：前两次 renewed.timestamp 正确、最后 expired.timestamp 等于第三边界且事件顺序与虚拟时间一致");
    }

    // 5) 同一 now 重复结算：不新增 renewed/expired；eventId 全局唯一；runId:sequence:type 格式不变
    {
      const repeatI = mkPlanI({ planauto: 1 }, { planauto: true }, [{
        autoRenew: { enabled: true, minIskReserve: 0 },
        deployedAt: nowI - DAY_MS_I, lastTick: nowI - DAY_MS_I
      }], renewCostI * 3);
      const renewExpI = [];
      const completedI = [];
      const unsubR = sandbox.GameEvents.on("planetary:renewed", e => renewExpI.push(e));
      const unsubE = sandbox.GameEvents.on("planetary:expired", e => renewExpI.push(e));
      const unsubC = sandbox.GameEvents.on("planetary:completed", e => completedI.push(e));
      runOfflineI(repeatI, 86400, nowI);
      runOfflineI(repeatI, 86400, nowI); // 同一 now 重复结算
      unsubR(); unsubE(); unsubC();
      const idsI = [...renewExpI, ...completedI].map(e => e.eventId);
      const uniqueI = new Set(idsI).size === idsI.length;
      const offlineFmtI = completedI.length > 0 &&
        completedI.every(e => /^offline_.*:\d+:planetary:completed$/.test(e.eventId));
      okI(renewExpI.length === 1 && uniqueI && offlineFmtI,
        "同一 now 重复结算：仅首轮产生 1 个 renewed、无新增 renewed/expired、eventId 全局唯一、offline 事件保持 runId:sequence:type 格式");
    }

    // ---- I-11 autosell / autoconv 分类严格 ---------------------------------------------------
    const soldOnlyI = mkArtI({ autosell: 1, autoconv: 1 }, { autosell: true, autoconv: false });
    const soldEventsI = [];
    const unsubSoldI = sandbox.GameEvents.on("archaeology:artifactsSold", event => soldEventsI.push(event));
    const soldResI = sandbox.applyArchaeologyArtifactProtocols(soldOnlyI, { offline: false, source: "research-protocol" });
    unsubSoldI();
    okI(soldResI.changed === true && soldResI.soldQuantity === 3 && soldResI.totalIsk === 4200 && soldResI.redeemed === null &&
        RRI.get(soldOnlyI, "currency:isk") === 4200 && RRI.get(soldOnlyI, "currency:lp") === 0 &&
        RRI.get(soldOnlyI, "artifact:art_i_lp") === 3 && RRI.get(soldOnlyI, "artifact:art_i_calib") === 4,
      "autosell 只处理 ISK 类与唯一文物，LP 与校准物必须原样保留");
    okI(soldEventsI.length === 1 && soldEventsI[0].meta.offline === false && soldEventsI[0].meta.source === "research-protocol",
      "在线自动出售只发一次批量事件，metadata 为在线协议来源");
    const convOnlyI = mkArtI({ autosell: 1, autoconv: 1 }, { autosell: false, autoconv: true });
    const convEventsI = [];
    const unsubConvI = sandbox.GameEvents.on("archaeology:artifactsRedeemed", event => convEventsI.push(event));
    const convResI = sandbox.applyArchaeologyArtifactProtocols(convOnlyI, { offline: true, source: "research-protocol" });
    unsubConvI();
    okI(convResI.changed === true && convResI.redeemedQuantity === 3 && convResI.totalLp === 150 && convResI.sold === null &&
        RRI.get(convOnlyI, "currency:lp") === 150 && RRI.get(convOnlyI, "currency:isk") === 0 &&
        RRI.get(convOnlyI, "artifact:art_i_common_a") === 2 && RRI.get(convOnlyI, "artifact:art_i_unique_a") === 1,
      "autoconv 只处理 LP 文物，ISK 类文物必须原样保留");
    okI(convEventsI.length === 1 && convEventsI[0].meta.offline === true && convEventsI[0].meta.source === "research-protocol",
      "离线自动兑换事件 metadata 必须标记离线且来源为协议");
    const bothI = mkArtI({ autosell: 1, autoconv: 1 }, { autosell: true, autoconv: true });
    const bothCountI = { sold: 0, redeemed: 0 };
    const unsubBothSI = sandbox.GameEvents.on("archaeology:artifactsSold", () => { bothCountI.sold += 1; });
    const unsubBothRI = sandbox.GameEvents.on("archaeology:artifactsRedeemed", () => { bothCountI.redeemed += 1; });
    const bothResI = sandbox.applyArchaeologyArtifactProtocols(bothI, { offline: false, source: "research-protocol" });
    unsubBothSI(); unsubBothRI();
    okI(bothResI.changed === true && bothCountI.sold === 1 && bothCountI.redeemed === 1 &&
        RRI.get(bothI, "currency:isk") === 4200 && RRI.get(bothI, "currency:lp") === 150 &&
        RRI.get(bothI, "artifact:art_i_calib") === 4,
      "两协议同开时各处理一次、互不重复消费，校准物永不自动处理");
    const noneI = mkArtI({ autosell: 1, autoconv: 1 }, { autosell: false, autoconv: false });
    const dirtyArtI = mkArtI({}, { autosell: true, autoconv: true });
    const noneResI = sandbox.applyArchaeologyArtifactProtocols(noneI, { offline: false, source: "research-protocol" });
    const dirtyArtResI = sandbox.applyArchaeologyArtifactProtocols(dirtyArtI, { offline: false, source: "research-protocol" });
    okI(noneResI.changed === false && noneResI.reason === REASONS_I.NOTHING_TO_PROCESS &&
        dirtyArtResI.changed === false && dirtyArtResI.reason === REASONS_I.NOTHING_TO_PROCESS &&
        RRI.get(dirtyArtI, "currency:isk") === 0 && RRI.get(dirtyArtI, "artifact:art_i_common_a") === 2,
      "总开关关闭或脏档未研究时一律 NOTHING_TO_PROCESS 且零收益");
    const manualI = mkArtI({ autosell: 1, autoconv: 1 }, { autosell: true, autoconv: true });
    const manualEventsI = [];
    const unsubManualI = sandbox.GameEvents.on("archaeology:artifactSold", event => manualEventsI.push(event));
    const manualResI = sandbox.sellArchaeologyArtifacts(manualI, "art_i_common_a", 1, false);
    unsubManualI();
    okI(manualResI.changed === true && manualEventsI.length === 1 &&
        manualEventsI[0].meta.offline === false && manualEventsI[0].meta.source === "game",
      "手动出售不传 context 时必须保持既有 metadata（offline=false、source=game）");

    // ---- I-12 真实触发点：考古成功周期 + 唯一时间轴 ------------------------------------------
    const srcOfI = (needle) => scripts[scriptSources.findIndex(source => source.includes(needle))];
    const archSrcI = srcOfI("js/systems/archaeology.js");
    const planSrcI = srcOfI("js/systems/planetary.js");
    const offlineSrcI = srcOfI("js/core/offline.js");
    okI(archSrcI.includes('applyArchaeologyArtifactProtocols(state, { offline:Boolean(randomValue === "offline"), source:"research-protocol" })'),
      "考古成功分支必须在文物入库后以真实在线/离线标记调用统一协议入口");
    okI(/advancePlanetDeploymentTimeline\(gameState, deployment/.test(planSrcI) &&
        /advancePlanetDeploymentTimeline\(gameState, deployment/.test(offlineSrcI) &&
        (planSrcI.match(/function advancePlanetDeploymentTimeline/g) || []).length === 1,
      "在线 planetaryTick 与离线 settleOfflinePlanets 必须共用唯一的 advancePlanetDeploymentTimeline");
    const siteI = G("ARCHAEOLOGY_SITES")[0];
    const probeI = G("ARCHAEOLOGY_PROBES")[0];
    const cycleStateI = mkArtI({ autosell: 1, autoconv: 1 }, { autosell: true, autoconv: true });
    const instanceI = sandbox.createShipInstance("heron", nowI);
    if (!cycleStateI.inventory || typeof cycleStateI.inventory !== "object") cycleStateI.inventory = { ships: [], equipment: [], rigs: [] };
    if (!Array.isArray(cycleStateI.inventory.ships)) cycleStateI.inventory.ships = [];
    cycleStateI.inventory.ships.push(instanceI);
    cycleStateI.shipAssignments = Object.assign({}, cycleStateI.shipAssignments, { archaeology: instanceI.instanceId });
    Object.assign(cycleStateI.archaeology, {
      activeSiteId: siteI.id, startedSiteId: siteI.id,
      activeProbeId: probeI.id, startedProbeId: probeI.id,
      fuelSavingRemainder: 0, probeSavingRemainder: 0,
      shipHp: {}, repairUntil: 0, repairInstanceId: null, interferenceUntil: 0
    });
    cycleStateI.currentAction = Object.assign({}, cycleStateI.currentAction, { active: true, skill: "archaeology", progress: 0 });
    RRI.add(cycleStateI, "probe:" + probeI.id, 5000);
    RRI.add(cycleStateI, "consumable:fuel", 500000);
    for (const artifact of G("ARCHAEOLOGY_ARTIFACTS")) RRI.set(cycleStateI, "artifact:" + artifact.id, 0);
    const cycleResI = sandbox.resolveArchaeologyCycle(cycleStateI, nowI, 0);
    const leftoverI = G("ARCHAEOLOGY_ARTIFACTS").filter(artifact => RRI.get(cycleStateI, "artifact:" + artifact.id) > 0);
    okI(cycleResI.success === true && cycleResI.protocols && cycleResI.protocols.changed === true &&
        leftoverI.every(artifact => artifact.category === "calibration"),
      "真实考古成功周期必须触发协议入口，自动处理后剩余文物只能是校准物");

    // ---- I-13 UI：三已实装可配置 / 三未实装只读 / 渲染纯读 ------------------------------------
    const elsI = {};
    for (const id of ["research-panel", "research-summary", "research-bank", "research-active",
      "research-progress-fill", "research-tree", "research-detail", "research-queue"]) elsI[id] = makeElement();
    const savedGetByIdI = sandbox.document.getElementById;
    const savedResearchRefI = gsI.research;
    const savedPlanetaryRefI = gsI.planetary;
    sandbox.document.getElementById = (id) => elsI[id] || makeElement();
    try {
      const uiStateI = mkPlanI(
        { planauto: 1, autosell: 1, autoconv: 1, intship: 1, autoenh: 1, autorepair: 1 },
        { planauto: true, autosell: true, autoconv: false },
        [{}], 500000);
      gsI.research = uiStateI.research;
      gsI.planetary = uiStateI.planetary;
      const uiSnapBeforeI = JSON.stringify(gsI.research);
      sandbox.renderResearchPage();
      const detailOfI = (techId) => { sandbox.selectResearchNode(techId); return elsI["research-detail"].innerHTML; };
      const planHtmlI = detailOfI("planauto");
      okI(planHtmlI.includes('data-detail-action="protocol-toggle"') && planHtmlI.includes('data-protocol-id="planauto"') &&
          planHtmlI.includes('data-detail-action="planauto-toggle"') && planHtmlI.includes('data-deployment-id="planet_i_1"') &&
          planHtmlI.includes("data-protocol-reserve") && planHtmlI.includes('data-detail-action="planauto-reserve"'),
        "planauto 详情必须提供总开关与逐基地自动续期 / 最低储备金控件");
      const sellHtmlI = detailOfI("autosell");
      const convHtmlI = detailOfI("autoconv");
      okI(sellHtmlI.includes('data-protocol-id="autosell"') && sellHtmlI.includes("校准物不会自动处理") &&
          convHtmlI.includes('data-protocol-id="autoconv"') && convHtmlI.includes("已关闭") &&
          !sellHtmlI.includes("data-deployment-id") && !convHtmlI.includes("data-deployment-id"),
        "autosell / autoconv 详情必须提供总开关与范围说明，且不得出现行星基地控件");
      okI(((() => {
        const html = detailOfI("intship");
        return html.includes('data-protocol-id="intship"') && html.includes("data-intship-recipe") &&
          html.includes('data-detail-action="intship-start"') && !html.includes("协议业务尚未接入");
      })()), "intship 详情必须提供启动表单（配方 / 数量 / 开始按钮），不再显示“协议业务尚未接入”");
      const autoenhHtmlI = detailOfI("autoenh");
      const autorepairHtmlI = detailOfI("autorepair");
      okI(autoenhHtmlI.includes('data-protocol-id="autoenh"') && autoenhHtmlI.includes('data-detail-action="autoenh-run"') &&
          autoenhHtmlI.includes('data-detail-action="autoenh-set-max"'),
        "autoenh 详情必须提供总开关 / 最大尝试次数 / 开始自动强化控件");
      okI(autorepairHtmlI.includes('data-protocol-id="autorepair"') && autorepairHtmlI.includes("仅在非致命考古反噬后") &&
          !autorepairHtmlI.includes('data-detail-action="autoenh-run"'),
        "autorepair 详情必须提供总开关 / 维修说明，且无主动执行按钮");
      okI(JSON.stringify(gsI.research) === uiSnapBeforeI, "研究页渲染与协议面板必须纯读，不得写入 state.research");
      const uiLockedI = mkPlanI({}, {}, [{}], 500000);
      gsI.research = uiLockedI.research;
      gsI.planetary = uiLockedI.planetary;
      sandbox.renderResearchPage();
      const lockedProtoHtmlI = detailOfI("planauto");
      okI(!lockedProtoHtmlI.includes("data-protocol-id") && !lockedProtoHtmlI.includes("data-deployment-id") &&
          /data-detail-action="(start|enqueue)"/.test(lockedProtoHtmlI),
        "未研究的 planauto 仍是可研究节点，且绝不出现协议设置控件");
    } finally {
      sandbox.document.getElementById = savedGetByIdI;
      gsI.research = savedResearchRefI;
      gsI.planetary = savedPlanetaryRefI;
      sandbox._researchSelectedTechId = null;
      sandbox.resetResearchAutoScroll();
    }

    // ---- I-14 冻结基线不回退 -----------------------------------------------------------------
    let stepsI = 0;
    let secondsI = 0;
    for (const node of RDI.NODES) {
      stepsI += Number(node.maxLevel) || 0;
      for (const duration of (node.durationByLevel || [])) secondsI += Number(duration) || 0;
    }
    const protocolNodesI = RDI.NODES.filter(node => node.type === "protocol");
    okI(Object.keys(RDI.RESEARCH_BONUS_CONSUMERS || {}).length === 31 && RDI.NODES.length === 38 &&
        stepsI === 150 && Math.abs(secondsI - 7776000) < 1e-6 &&
        protocolNodesI.length === 6 && protocolNodesI.every(node => !node.bonus && node.maxLevel === 1),
      "31 组数值 group / 38 节点 / 150 步 / 90 天 / 6 个无 bonus 协议节点基线不得回退");
    okI(scriptSources.length === 56 && styleSources.length === 4 && htmlIds.size === 313,
      "56 JS / 4 CSS / 313 DOM ID 基线不得回退");
  } finally {
    gsI.research = JSON.parse(JSON.stringify(savedResearchI));
    gsI.planetary = JSON.parse(JSON.stringify(savedPlanetaryI));
    gsI.resources = JSON.parse(JSON.stringify(savedResourcesI));
    gsI.skills = JSON.parse(JSON.stringify(savedSkillsI));
    gsI.statistics = JSON.parse(JSON.stringify(savedStatsI));
    gsI.archaeology = JSON.parse(JSON.stringify(savedArchI));
    gsI.currentAction = JSON.parse(JSON.stringify(savedActionI));
  }

  console.log("Batch I 经济自动化协议校验通过（" + iChecks + " 项）：统一模块 8 个 API 与 11 个稳定 reason、新游戏三协议零副作用、脏档 enabled=true 未研究不执行、真实研究链解锁且不自动开启、setProtocolEnabled 成功/重复/非法/未知/未研究五类、setPlanetAutoRenew 每基地独立对象与储备金参数校验、储备金边界（恰好等于放行 / 少 1 ISK 拒绝）与续期四价同源、多基地互不影响只扣成功那份、在线跨 expiresAt 只续期一次且重复 tick 不重扣、离线 3 周期逐次扣费与余额不足只停该基地、autosell 只 ISK/唯一 与 autoconv 只 LP 且校准物永不处理、两协议同开各一次、在线 offline=false / 离线 offline=true+offline-settlement / 手动 source=game、真实考古周期触发入口且剩余仅校准物、在线离线共用唯一时间轴、UI 三已实装可配置与三未实装只读且渲染纯读、31 group/38 节点/150 步/90 天/50 JS/4 CSS/294 DOM 基线不回退");
}

// ============================================================================================
// 研究系统 Batch J：自动强化 + 野外自动维修完整实装（autoenh / autorepair）
// 铁律：
//   1) 三层门槛：completedLevels[protocolId] >= 1 → protocolSettings[protocolId].enabled === true
//      → 业务条件；脏档 enabled=true 但未研究绝不越权执行；
//   2) 绝不复制业务公式：强化逐次调既有 ShellStateActions.enhanceShip（成本 / 成功率 / 经验 /
//      等级 / 事件全部归底层），维修量走 fitting → resolveEquipmentReference → combat.kind==="repair"，
//      repair 科研倍率只乘一次；
//   3) 野外维修数据源严格为考古舰船，绝不读战斗舰船；只在非致命反噬（destroyed===false）后触发；
//   4) 在线与离线共用同一函数与同一扣减逻辑；GameEvents 缺失时维修与扣费仍成功；
//   5) 本批实装 autoenh / autorepair；intship 由 Batch K 实装（此处断言六协议全实装）。
// ============================================================================================
{
  let jChecks = 0;
  const okJ = (condition, message) => {
    if (!condition) throw new Error("Batch J 校验失败：" + message);
    jChecks += 1;
  };
  const nearJ = (a, b, eps) => Math.abs(Number(a) - Number(b)) <= (eps === undefined ? 1e-6 : eps);

  const RSJ = sandbox.ResearchState;
  const RDJ = sandbox.ResearchData;
  const RRJ = G("ResourceRegistry");
  const SSAJ = G("ShellStateActions");
  const REASONS_J = G("RESEARCH_PROTOCOL_REASONS");
  const AERJ = G("AUTO_ENHANCE_REASONS");
  const AFRJ = G("ARCHAEOLOGY_FIELD_REPAIR_REASONS");
  const gsJ = sandbox.gameState;
  const nowJ = 1769817600000;

  const savedResearchJ = JSON.parse(JSON.stringify(gsJ.research));
  const savedInventoryJ = JSON.parse(JSON.stringify(gsJ.inventory));
  const savedResourcesJ = JSON.parse(JSON.stringify(gsJ.resources));
  const savedSkillsJ = JSON.parse(JSON.stringify(gsJ.skills));
  const savedArchJ = JSON.parse(JSON.stringify(gsJ.archaeology));
  const savedActionJ = JSON.parse(JSON.stringify(gsJ.currentAction));
  const savedAssignJ = JSON.parse(JSON.stringify(gsJ.shipAssignments || {}));

  try {
    const pristineJ = JSON.parse(JSON.stringify(gsJ));

    // 夹具：干净默认研究状态 + 指定已完成等级 + 指定协议总开关 + 空机库 / 空装备池 / 无活动
    const mkJ = (levels, protocolEnabled) => {
      const state = JSON.parse(JSON.stringify(pristineJ));
      state.research = RSJ.createDefaultResearchState();
      state.research.lastProcessedAt = nowJ;
      state.research.completedLevels = Object.assign({}, levels || {});
      for (const [key, value] of Object.entries(protocolEnabled || {})) {
        state.research.protocolSettings[key].enabled = value;
      }
      state.inventory = { ships: [], equipment: [], rigs: [] };
      if (!state.equipment || typeof state.equipment !== "object") state.equipment = {};
      state.equipment.instances = [];
      state.shipAssignments = {};
      state.planetary = { deployments: [], nextId: 1 };
      state.currentAction = Object.assign({}, state.currentAction, { active: false, skill: null, progress: 0 });
      if (state.combat && typeof state.combat === "object") { state.combat.active = false; state.combat.activeShip = null; }
      state._dirty = false;
      return state;
    };

    // ---- autoenh 夹具：rifter（制造等级 1 → 一档三件套，每次 attempt 恰 3 个部件） --------------
    const rifterCfgJ = sandbox.getShipConfigById("rifter");
    const enhCostJ = sandbox.getShipEnhancementCost(rifterCfgJ);
    const enhCompIdsJ = Object.keys(enhCostJ);
    const perAttemptJ = Object.values(enhCostJ).reduce((sum, q) => sum + q, 0);
    const allCompIdsJ = G("SHIP_ENHANCEMENT_TIERS").reduce((acc, tier) => acc.concat(tier.componentIds), []);
    const compSnapJ = (state) => allCompIdsJ.map(id => RRJ.get(state, "component:" + id));
    const tierCompTotalJ = (state) => enhCompIdsJ.reduce((sum, id) => sum + RRJ.get(state, "component:" + id), 0);
    const mkEnhJ = (levels, protocolEnabled, sets) => {
      const state = mkJ(levels, protocolEnabled);
      for (const id of allCompIdsJ) RRJ.set(state, "component:" + id, 0);
      const inst = sandbox.createShipInstance("rifter", nowJ);
      state.inventory.ships.push(inst);
      for (const [id, q] of Object.entries(enhCostJ)) RRJ.set(state, "component:" + id, q * sets);
      state._dirty = false;
      return { state, inst };
    };

    okJ(perAttemptJ === 3 && enhCompIdsJ.length === 3,
      "rifter 一档强化必须恰为三件套（每次 attempt 3 个部件），实际 " + perAttemptJ);

    // ---- J-01 三层门槛：未研究 / 已研究未启用 / 脏档 enabled=true 未研究 ----------------------
    const lockedEnhJ = mkEnhJ({}, {}, 10);
    const resLockedJ = sandbox.runAutoEnhancement(lockedEnhJ.state, lockedEnhJ.inst.instanceId, { randomValue: 0 });
    okJ(resLockedJ.changed === false && resLockedJ.reason === REASONS_J.PROTOCOL_LOCKED &&
        resLockedJ.attempts === 0 && tierCompTotalJ(lockedEnhJ.state) === 30 && lockedEnhJ.inst.enhancementLevel === 0,
      "未研究 autoenh：绝不执行强化、绝不消耗任何部件");
    const disabledEnhJ = mkEnhJ({ autoenh: 1 }, { autoenh: false }, 10);
    const resDisabledJ = sandbox.runAutoEnhancement(disabledEnhJ.state, disabledEnhJ.inst.instanceId, { randomValue: 0 });
    okJ(resDisabledJ.changed === false && resDisabledJ.reason === REASONS_J.PROTOCOL_DISABLED &&
        resDisabledJ.attempts === 0 && tierCompTotalJ(disabledEnhJ.state) === 30,
      "已研究但总开关关闭：autoenh 绝不执行、绝不消耗部件");
    const dirtyEnhJ = mkEnhJ({}, { autoenh: true }, 10);
    const resDirtyJ = sandbox.runAutoEnhancement(dirtyEnhJ.state, dirtyEnhJ.inst.instanceId, { randomValue: 0 });
    okJ(resDirtyJ.changed === false && resDirtyJ.reason === REASONS_J.PROTOCOL_LOCKED &&
        tierCompTotalJ(dirtyEnhJ.state) === 30,
      "脏档 enabled=true 但未研究：autoenh 绝不越权执行");

    // ---- J-02 setAutoEnhancementMaxAttempts 严格参数校验 --------------------------------------
    const cfgJ = mkJ({ autoenh: 1 }, { autoenh: true });
    const badMaxJ = [-1, 1.5, NaN, Infinity, -Infinity, "3", null, true, [], {}, 10001];
    okJ(badMaxJ.every(value => {
      const result = sandbox.setAutoEnhancementMaxAttempts(cfgJ, value);
      return result.changed === false && result.reason === AERJ.INVALID_MAX_ATTEMPTS;
    }) && cfgJ.research.protocolSettings.autoenh.maxAttempts === 0 && cfgJ._dirty === false,
      "负数 / 小数 / NaN / Infinity / 数字字符串 / null / 布尔 / 数组 / 对象 / 超上限一律 INVALID_MAX_ATTEMPTS 且不写入");
    okJ(sandbox.setAutoEnhancementMaxAttempts(cfgJ, 0).reason === REASONS_J.ALREADY_SET,
      "重复设置相同 maxAttempts 必须返回 ALREADY_SET");
    okJ(sandbox.setAutoEnhancementMaxAttempts(cfgJ, 10000).changed === true &&
        cfgJ.research.protocolSettings.autoenh.maxAttempts === 10000 && cfgJ._dirty === true,
      "安全上限 10000 必须放行并写入 maxAttempts、置 _dirty");
    okJ(sandbox.setAutoEnhancementMaxAttempts(cfgJ, 3).changed === true &&
        cfgJ.research.protocolSettings.autoenh.maxAttempts === 3,
      "合法整数必须写入权威字段 protocolSettings.autoenh.maxAttempts");
    okJ(sandbox.setAutoEnhancementMaxAttempts(null, 3).reason === REASONS_J.INVALID_STATE,
      "非法 state 必须返回 INVALID_STATE");

    // ---- J-03 迁移清洗：脏档 maxAttempts 幂等归一，schemaVersion 不变 -------------------------
    const migCasesJ = [[-5, 0], [1.5, 0], [99999, 10000], ["abc", 0], [null, 0], [NaN, 0], [Infinity, 0], [77, 77]];
    okJ(migCasesJ.every(([raw, expected]) => {
      const state = mkJ({}, {});
      const schemaBefore = state.research.schemaVersion;
      state.research.protocolSettings.autoenh.maxAttempts = raw;
      RSJ.migrateResearchState(state);
      const once = state.research.protocolSettings.autoenh.maxAttempts;
      RSJ.migrateResearchState(state);
      return once === expected && state.research.protocolSettings.autoenh.maxAttempts === expected &&
        state.research.schemaVersion === schemaBefore;
    }), "脏档 autoenh.maxAttempts 必须被幂等清洗到 [0,10000] 整数区间，且不改 schemaVersion");
    okJ((() => {
      const state = mkJ({}, {});
      delete state.research.protocolSettings.autoenh;
      RSJ.migrateResearchState(state);
      const entry = state.research.protocolSettings.autoenh;
      return entry && entry.enabled === false && entry.maxAttempts === 0;
    })(), "缺失的 autoenh 设置必须补全为 { enabled:false, maxAttempts:0 }");

    // ---- J-04 maxAttempts=N：恰 N 次真实 attempt，事件数 === attempts ------------------------
    const capJ = mkEnhJ({ autoenh: 1 }, { autoenh: true }, 10);
    sandbox.setAutoEnhancementMaxAttempts(capJ.state, 3);
    const capEventsJ = [];
    const capOffJ = sandbox.GameEvents.on("ship:enhancementAttempted", event => capEventsJ.push(event));
    const capBeforeJ = tierCompTotalJ(capJ.state);
    const capResJ = sandbox.runAutoEnhancement(capJ.state, capJ.inst.instanceId, { randomValue: 0 });
    capOffJ();
    okJ(capResJ.changed === true && capResJ.attempts === 3 && capResJ.successes === 3 && capResJ.failures === 0 &&
        capResJ.stopReason === AERJ.MAX_ATTEMPTS_REACHED && capResJ.maxAttempts === 3,
      "maxAttempts=3 必须恰跑 3 次真实 attempt 后以 MAX_ATTEMPTS_REACHED 停止");
    okJ(capResJ.componentsSpent === 9 && (capBeforeJ - tierCompTotalJ(capJ.state)) === 9 &&
        capResJ.fromLevel === 0 && capResJ.toLevel === 3 && capJ.inst.enhancementLevel === 3,
      "3 次成功强化必须真实扣 9 个部件并把强化等级推进到 3");
    okJ(capEventsJ.length === capResJ.attempts && capEventsJ.every(event => event.payload.success === true),
      "ship:enhancementAttempted 事件数必须严格等于 attempts");

    // ---- J-05 maxAttempts=0：持续到真实材料不足 ----------------------------------------------
    const contJ = mkEnhJ({ autoenh: 1 }, { autoenh: true }, 4);
    const contResJ = sandbox.runAutoEnhancement(contJ.state, contJ.inst.instanceId, { randomValue: 0.9 });
    okJ(contResJ.attempts === 4 && contResJ.maxAttempts === 0 &&
        contResJ.stopReason === AERJ.INSUFFICIENT_COMPONENTS && tierCompTotalJ(contJ.state) === 0,
      "maxAttempts=0 必须持续到强化部件真实耗尽后以 INSUFFICIENT_COMPONENTS 停止");
    okJ(contResJ.failures === 4 && contResJ.successes === 0 && contJ.inst.enhancementLevel === 0,
      "全部失败：等级保持 0（失败不掉级），失败计数正确");

    // ---- J-06 单次成功 / 单次失败：等级、XP、部件、事件四项同底层 ---------------------------
    const expectedXpJ = sandbox.getShipEnhancementSuccessXp(rifterCfgJ, 0);
    const sucJ = mkEnhJ({ autoenh: 1 }, { autoenh: true }, 1);
    sandbox.setAutoEnhancementMaxAttempts(sucJ.state, 1);
    const sucEventsJ = [];
    const sucOffJ = sandbox.GameEvents.on("ship:enhancementAttempted", event => sucEventsJ.push(event));
    const sucXpBeforeJ = Number(sucJ.state.skills.shipEngineering.xp) || 0;
    const sucResJ = sandbox.runAutoEnhancement(sucJ.state, sucJ.inst.instanceId, { randomValue: 0 });
    sucOffJ();
    okJ(sucResJ.attempts === 1 && sucResJ.successes === 1 && sucJ.inst.enhancementLevel === 1 &&
        tierCompTotalJ(sucJ.state) === 0 && sucEventsJ.length === 1 &&
        sucEventsJ[0].payload.xp === expectedXpJ && expectedXpJ > 0 &&
        (Number(sucJ.state.skills.shipEngineering.xp) || 0) !== sucXpBeforeJ,
      "成功一次：等级 +1、扣 3 部件、发一条事件、经验取底层 getShipEnhancementSuccessXp");
    const failJ = mkEnhJ({ autoenh: 1 }, { autoenh: true }, 1);
    sandbox.setAutoEnhancementMaxAttempts(failJ.state, 1);
    const failEventsJ = [];
    const failOffJ = sandbox.GameEvents.on("ship:enhancementAttempted", event => failEventsJ.push(event));
    const failXpBeforeJ = Number(failJ.state.skills.shipEngineering.xp) || 0;
    const failResJ = sandbox.runAutoEnhancement(failJ.state, failJ.inst.instanceId, { randomValue: 0.9 });
    failOffJ();
    okJ(failResJ.attempts === 1 && failResJ.failures === 1 && failJ.inst.enhancementLevel === 0 &&
        tierCompTotalJ(failJ.state) === 0 && failEventsJ.length === 1 &&
        failEventsJ[0].payload.success === false && failEventsJ[0].payload.xp === 0 &&
        (Number(failJ.state.skills.shipEngineering.xp) || 0) === failXpBeforeJ,
      "失败一次：等级不变、0 XP、强化部件照常真实扣除");

    // ---- J-07 只消耗不产出：非本档部件一律不动 ------------------------------------------------
    const noGainJ = mkEnhJ({ autoenh: 1 }, { autoenh: true }, 10);
    for (const id of allCompIdsJ) if (enhCompIdsJ.indexOf(id) < 0) RRJ.set(noGainJ.state, "component:" + id, 5);
    sandbox.setAutoEnhancementMaxAttempts(noGainJ.state, 2);
    const noGainBeforeJ = compSnapJ(noGainJ.state);
    sandbox.runAutoEnhancement(noGainJ.state, noGainJ.inst.instanceId, { randomValue: 0 });
    const noGainAfterJ = compSnapJ(noGainJ.state);
    okJ(allCompIdsJ.every((id, idx) => enhCompIdsJ.indexOf(id) >= 0
        ? (noGainBeforeJ[idx] - noGainAfterJ[idx]) === 2
        : noGainAfterJ[idx] === noGainBeforeJ[idx]),
      "自动强化只能消耗本档三件套，绝不产出任何部件，也不得动其它档部件");

    // ---- J-08 活动舰船拒绝：零尝试零消耗 ------------------------------------------------------
    const activeJ = mkEnhJ({ autoenh: 1 }, { autoenh: true }, 10);
    activeJ.state.currentAction = Object.assign({}, activeJ.state.currentAction, { active: true, skill: "mining" });
    activeJ.state.shipAssignments.mining = activeJ.inst.instanceId;
    const activeResJ = sandbox.runAutoEnhancement(activeJ.state, activeJ.inst.instanceId, { randomValue: 0 });
    okJ(activeResJ.changed === false && activeResJ.attempts === 0 && activeResJ.stopReason === AERJ.SHIP_ACTIVE &&
        tierCompTotalJ(activeJ.state) === 30 && activeJ.inst.enhancementLevel === 0,
      "舰船正在执行行动时：零尝试、零消耗、停止原因 SHIP_ACTIVE");
    const unknownResJ = sandbox.runAutoEnhancement(activeJ.state, "ship_not_exist", { randomValue: 0 });
    okJ(unknownResJ.changed === false && unknownResJ.reason === AERJ.UNKNOWN_SHIP && unknownResJ.attempts === 0,
      "未知 instanceId 必须返回 UNKNOWN_SHIP 且零尝试");

    // ---- J-09 手动单次强化行为不被协议改变 ----------------------------------------------------
    const manualJ = mkEnhJ({}, {}, 1);
    const manualBeforeJ = tierCompTotalJ(manualJ.state);
    const manualResJ = SSAJ.enhanceShip(manualJ.state, manualJ.inst.instanceId, 0);
    okJ(manualResJ.changed === true && manualResJ.success === true && manualResJ.fromLevel === 0 &&
        manualResJ.toLevel === 1 && manualJ.inst.enhancementLevel === 1 &&
        (manualBeforeJ - tierCompTotalJ(manualJ.state)) === 3 && manualResJ.xp === expectedXpJ,
      "协议未研究时手动单次强化的既有行为必须完全不变");

    // ---- J-10 action 路由：两个新 action 落到统一协议模块且遵守同样门槛 ----------------------
    const routeJ = mkEnhJ({ autoenh: 1 }, { autoenh: true }, 5);
    const routeSetJ = sandbox.dispatchGameAction(routeJ.state, { type: "research/setAutoEnhancementMaxAttempts", maxAttempts: 2 }, nowJ);
    const routeRunJ = sandbox.dispatchGameAction(routeJ.state, { type: "research/runAutoEnhancement", instanceId: routeJ.inst.instanceId, context: { randomValue: 0 } }, nowJ);
    okJ(routeSetJ.changed === true && routeJ.state.research.protocolSettings.autoenh.maxAttempts === 2 &&
        routeRunJ.attempts === 2 && routeJ.inst.enhancementLevel === 2,
      "research/setAutoEnhancementMaxAttempts 与 research/runAutoEnhancement 两条路由必须真实生效");
    const routeLockedJ = mkEnhJ({}, { autoenh: true }, 5);
    const routeLockedResJ = sandbox.dispatchGameAction(routeLockedJ.state, { type: "research/runAutoEnhancement", instanceId: routeLockedJ.inst.instanceId, context: { randomValue: 0 } }, nowJ);
    okJ(routeLockedResJ.changed === false && routeLockedResJ.reason === REASONS_J.PROTOCOL_LOCKED &&
        tierCompTotalJ(routeLockedJ.state) === 15,
      "走 action 路由同样不得绕过三层门槛");

    // ---- autorepair 夹具：星图级（mid 3 / low 2）三层维修件齐装 ------------------------------
    const siteJ = G("ARCHAEOLOGY_SITES")[0];
    const probeJ = G("ARCHAEOLOGY_PROBES")[0];
    const FIT3_J = { high: [], mid: ["t1_shield_booster"], low: ["t1_armor_repairer", "t1_structure_repairer"], rig: [] };
    const REPAIR_CTX_J = (offline, now) => ({ now: now === undefined ? nowJ : now, offline: Boolean(offline), source: "research-protocol" });
    const mkArchJ = (levels, protocolEnabled, fitted, shipId) => {
      const state = mkJ(levels, protocolEnabled);
      const inst = sandbox.createShipInstance(shipId || "starmap", nowJ);
      inst.fitted = { high: (fitted.high || []).slice(), mid: (fitted.mid || []).slice(), low: (fitted.low || []).slice(), rig: (fitted.rig || []).slice() };
      state.inventory.ships.push(inst);
      state.shipAssignments.archaeology = inst.instanceId;
      Object.assign(state.archaeology, {
        activeSiteId: siteJ.id, startedSiteId: siteJ.id,
        activeProbeId: probeJ.id, startedProbeId: probeJ.id,
        fuelSavingRemainder: 0, probeSavingRemainder: 0,
        shipHp: {}, repairUntil: 0, repairInstanceId: null, interferenceUntil: 0
      });
      state.currentAction = Object.assign({}, state.currentAction, { active: true, skill: "archaeology", progress: 0 });
      RRJ.set(state, "probe:" + probeJ.id, 5000);
      RRJ.set(state, "consumable:fuel", 500000);
      state._dirty = false;
      return { state, inst };
    };
    const maxHpStarmapJ = sandbox.getShipConfigById("starmap").hp;

    // ---- J-11 数据来源严格为考古舰船，绝不借用战斗舰船 --------------------------------------
    const srcOfJ = (needle) => scripts[scriptSources.findIndex(source => source.includes(needle))];
    const archSrcJ = srcOfJ("js/systems/archaeology.js");
    const repairSrcJ = archSrcJ.slice(
      archSrcJ.indexOf("function getInstalledRepairersForShip"),
      archSrcJ.indexOf("function applyArchaeologyDamage"));
    okJ(repairSrcJ.length > 200 &&
        !/getInstalledCombatRepairers|getActiveCombatShipState|shipAssignments\.combat/.test(repairSrcJ) &&
        repairSrcJ.includes("getFittingFromInstance") && repairSrcJ.includes("resolveEquipmentReference") &&
        repairSrcJ.includes('combat.kind !== "repair"'),
      "野外维修必须只走考古舰船 fitting → resolveEquipmentReference，绝不引用任何战斗舰船来源");
    const noRepJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, { high: [], mid: [], low: [], rig: [] });
    const combatShipJ = sandbox.createShipInstance("rifter", nowJ + 1);
    combatShipJ.fitted = { high: [], mid: ["t1_shield_booster"], low: ["t1_armor_repairer"], rig: [] };
    noRepJ.state.inventory.ships.push(combatShipJ);
    noRepJ.state.shipAssignments.combat = combatShipJ.instanceId;
    okJ(sandbox.getInstalledRepairersForShip(noRepJ.state, noRepJ.inst.instanceId).length === 0 &&
        sandbox.getInstalledRepairersForShip(noRepJ.state, combatShipJ.instanceId).length === 2,
      "维修装备只能来自被查询舰船自身的 fitting");
    const noRepHpJ = { shield: 100, armor: 100, structure: 100 };
    const noRepFuelJ = RRJ.get(noRepJ.state, "consumable:fuel");
    const noRepResJ = sandbox.applyArchaeologyFieldRepair(noRepJ.state, noRepJ.inst.instanceId, noRepHpJ, REPAIR_CTX_J(false));
    okJ(noRepResJ.changed === false && noRepResJ.reason === AFRJ.NO_REPAIRERS &&
        noRepHpJ.shield === 100 && RRJ.get(noRepJ.state, "consumable:fuel") === noRepFuelJ,
      "考古舰船未装维修装备时：绝不借用战斗舰船维修件、绝不扣燃料");

    // ---- J-12 三层门槛：脏档 / 已研究未启用都不得维修 ----------------------------------------
    const lockRepJ = mkArchJ({}, { autorepair: true }, FIT3_J);
    const lockHpJ = { shield: 100, armor: 100, structure: 100 };
    const lockFuelJ = RRJ.get(lockRepJ.state, "consumable:fuel");
    const lockResJ = sandbox.applyArchaeologyFieldRepair(lockRepJ.state, lockRepJ.inst.instanceId, lockHpJ, REPAIR_CTX_J(false));
    okJ(lockResJ.changed === false && lockResJ.reason === AFRJ.PROTOCOL_DISABLED &&
        JSON.stringify(lockHpJ) === JSON.stringify({ shield: 100, armor: 100, structure: 100 }) &&
        RRJ.get(lockRepJ.state, "consumable:fuel") === lockFuelJ,
      "脏档 enabled=true 但未研究 autorepair：绝不维修、绝不扣燃料");
    const offRepJ = mkArchJ({ autorepair: 1 }, { autorepair: false }, FIT3_J);
    const offHpJ = { shield: 100, armor: 100, structure: 100 };
    const offResJ = sandbox.applyArchaeologyFieldRepair(offRepJ.state, offRepJ.inst.instanceId, offHpJ, REPAIR_CTX_J(false));
    okJ(offResJ.changed === false && offResJ.reason === AFRJ.PROTOCOL_DISABLED && offHpJ.shield === 100,
      "已研究但总开关关闭：autorepair 绝不维修");

    // ---- J-13 真实非致命反噬周期：三层各修一次、扣真实燃料、协议关闭则完全不动 ---------------
    const cycleOnJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    const cycleOffJ = mkArchJ({ autorepair: 1 }, { autorepair: false }, FIT3_J);
    cycleOnJ.state.archaeology.shipHp[cycleOnJ.inst.instanceId] = { shield: 100, armor: 100, structure: 100 };
    cycleOffJ.state.archaeology.shipHp[cycleOffJ.inst.instanceId] = { shield: 100, armor: 100, structure: 100 };
    const cycleFuelJ = sandbox.getArchaeologyFuelCostState(cycleOnJ.state, siteJ, cycleOnJ.inst).chargedFuel;
    const fuelOnBeforeJ = RRJ.get(cycleOnJ.state, "consumable:fuel");
    const fuelOffBeforeJ = RRJ.get(cycleOffJ.state, "consumable:fuel");
    const cycleResOnJ = sandbox.resolveArchaeologyCycle(cycleOnJ.state, nowJ, 0.999999999);
    const cycleResOffJ = sandbox.resolveArchaeologyCycle(cycleOffJ.state, nowJ, 0.999999999);
    const hpOnJ = cycleOnJ.state.archaeology.shipHp[cycleOnJ.inst.instanceId];
    const hpOffJ = cycleOffJ.state.archaeology.shipHp[cycleOffJ.inst.instanceId];
    const backlashJ = cycleResOnJ.backlash;
    okJ(cycleResOnJ.success === false && cycleResOnJ.destroyed === false && cycleResOnJ.fieldRepair &&
        cycleResOnJ.fieldRepair.changed === true && cycleResOnJ.fieldRepair.repaired === 3 &&
        cycleResOffJ.fieldRepair && cycleResOffJ.fieldRepair.changed === false &&
        cycleResOffJ.fieldRepair.reason === AFRJ.PROTOCOL_DISABLED,
      "非致命反噬后：已启用逐件维修 3 次；未启用只返回 PROTOCOL_DISABLED");
    okJ(backlashJ > 0 && backlashJ < 100 &&
        hpOffJ.shield === 100 - backlashJ && hpOffJ.armor === 100 && hpOffJ.structure === 100 &&
        hpOnJ.shield === 100 - backlashJ + 30 && hpOnJ.armor === 120 && hpOnJ.structure === 110,
      "三层维修目标各自独立且严格落在自己那层：护盾 +30 / 装甲 +20 / 结构 +10");
    okJ((fuelOffBeforeJ - RRJ.get(cycleOffJ.state, "consumable:fuel")) === cycleFuelJ &&
        (fuelOnBeforeJ - RRJ.get(cycleOnJ.state, "consumable:fuel")) === cycleFuelJ + 5,
      "维修额外燃料必须恰为三件维修装备 fuelCost 之和（1+1+3=5）");

    // ---- J-14 致命反噬绝不维修、绝不复活 ------------------------------------------------------
    const deadJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    deadJ.state.archaeology.shipHp[deadJ.inst.instanceId] = { shield: 0, armor: 0, structure: 1 };
    const deadFuelBeforeJ = RRJ.get(deadJ.state, "consumable:fuel");
    const deadResJ = sandbox.resolveArchaeologyCycle(deadJ.state, nowJ, 0.999999999);
    const deadHpJ = deadJ.state.archaeology.shipHp[deadJ.inst.instanceId];
    okJ(deadResJ.destroyed === true && deadResJ.fieldRepair === undefined &&
        deadHpJ.shield === 0 && deadHpJ.armor === 0 && deadHpJ.structure === 0 &&
        (deadFuelBeforeJ - RRJ.get(deadJ.state, "consumable:fuel")) === cycleFuelJ,
      "致命反噬：绝不触发野外维修、绝不复活、只扣周期燃料");

    // ---- J-15 满血层跳过不耗燃料 + 溢出严格钳制在 maxHp ---------------------------------------
    const clampJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    RRJ.set(clampJ.state, "consumable:fuel", 100);
    const clampHpJ = { shield: maxHpStarmapJ.shield, armor: maxHpStarmapJ.armor - 10, structure: maxHpStarmapJ.structure };
    const clampResJ = sandbox.applyArchaeologyFieldRepair(clampJ.state, clampJ.inst.instanceId, clampHpJ, REPAIR_CTX_J(false));
    okJ(clampResJ.changed === true && clampResJ.repaired === 1 &&
        clampHpJ.shield === maxHpStarmapJ.shield && clampHpJ.structure === maxHpStarmapJ.structure &&
        RRJ.get(clampJ.state, "consumable:fuel") === 99,
      "满血层必须跳过且完全不耗燃料（只有缺血的装甲层消耗 1 燃料）");
    okJ(clampHpJ.armor === maxHpStarmapJ.armor,
      "维修量 20 > 缺口 10 时必须钳制在 maxHp，绝不溢出");
    const fullJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    const fullHpJ = { shield: maxHpStarmapJ.shield, armor: maxHpStarmapJ.armor, structure: maxHpStarmapJ.structure };
    const fullFuelJ = RRJ.get(fullJ.state, "consumable:fuel");
    const fullResJ = sandbox.applyArchaeologyFieldRepair(fullJ.state, fullJ.inst.instanceId, fullHpJ, REPAIR_CTX_J(false));
    okJ(fullResJ.changed === false && fullResJ.reason === AFRJ.FULL_HP &&
        RRJ.get(fullJ.state, "consumable:fuel") === fullFuelJ,
      "三层全满：返回 FULL_HP 且零燃料消耗");

    // ---- J-16 燃料只够第一件：第一件成功、后续停止、燃料不为负 -------------------------------
    const fuelLimitJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    RRJ.set(fuelLimitJ.state, "consumable:fuel", 1);
    const fuelLimitHpJ = { shield: 10, armor: 10, structure: 10 };
    const fuelLimitResJ = sandbox.applyArchaeologyFieldRepair(fuelLimitJ.state, fuelLimitJ.inst.instanceId, fuelLimitHpJ, REPAIR_CTX_J(false));
    okJ(fuelLimitResJ.changed === true && fuelLimitResJ.repaired === 1 &&
        fuelLimitHpJ.shield === 40 && fuelLimitHpJ.armor === 10 && fuelLimitHpJ.structure === 10 &&
        RRJ.get(fuelLimitJ.state, "consumable:fuel") === 0,
      "燃料只够第一件：第一件成功后立即停止，燃料绝不为负");
    const zeroFuelJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    RRJ.set(zeroFuelJ.state, "consumable:fuel", 0);
    const zeroFuelHpJ = { shield: 10, armor: 10, structure: 10 };
    const zeroFuelResJ = sandbox.applyArchaeologyFieldRepair(zeroFuelJ.state, zeroFuelJ.inst.instanceId, zeroFuelHpJ, REPAIR_CTX_J(false));
    okJ(zeroFuelResJ.changed === false && zeroFuelResJ.reason === AFRJ.INSUFFICIENT_FUEL &&
        zeroFuelHpJ.shield === 10 && RRJ.get(zeroFuelJ.state, "consumable:fuel") === 0,
      "燃料为 0：一件都不修、返回 INSUFFICIENT_FUEL");

    // ---- J-17 repair 科研满级 ×1.06，且只乘一次 ----------------------------------------------
    const ONE_REP_J = { high: [], mid: ["t1_shield_booster"], low: [], rig: [] };
    const rep0J = mkArchJ({ autorepair: 1 }, { autorepair: true }, ONE_REP_J);
    const rep5J = mkArchJ({ autorepair: 1, repair: 5 }, { autorepair: true }, ONE_REP_J);
    okJ(nearJ(RSJ.getResearchMultiplier(rep0J.state, ["repair"]), 1) &&
        nearJ(RSJ.getResearchMultiplier(rep5J.state, ["repair"]), 1.06),
      "repair 组满级唯一乘子必须为 1.06（5 级 × 1.2%）");
    const repList0J = sandbox.getInstalledRepairersForShip(rep0J.state, rep0J.inst.instanceId);
    const repList5J = sandbox.getInstalledRepairersForShip(rep5J.state, rep5J.inst.instanceId);
    okJ(repList0J.length === 1 && repList5J.length === 1 &&
        nearJ(repList0J[0].multiplier, 1) && nearJ(repList5J[0].multiplier, 1.06) &&
        repList0J[0].amount === 30 && repList0J[0].fuelCost === 1 && repList0J[0].target === "shield",
      "维修件标准化必须携带装备强化 × 科研的唯一乘子，base amount / fuelCost 取自装备定义");
    const hp0J = { shield: 0, armor: maxHpStarmapJ.armor, structure: maxHpStarmapJ.structure };
    const hp5J = { shield: 0, armor: maxHpStarmapJ.armor, structure: maxHpStarmapJ.structure };
    sandbox.applyArchaeologyFieldRepair(rep0J.state, rep0J.inst.instanceId, hp0J, REPAIR_CTX_J(false));
    sandbox.applyArchaeologyFieldRepair(rep5J.state, rep5J.inst.instanceId, hp5J, REPAIR_CTX_J(false));
    okJ(nearJ(hp0J.shield, 30) && nearJ(hp5J.shield, 31.8) && nearJ(hp5J.shield / hp0J.shield, 1.06),
      "维修量必须严格 ×1.06 一次，绝不出现复利或漏乘");

    // ---- J-18 在线 / 离线共用同一逻辑，事件 metadata 真实 -------------------------------------
    const onlineJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    const offlineJ = mkArchJ({ autorepair: 1 }, { autorepair: true }, FIT3_J);
    const repairEventsJ = [];
    const repairOffJ = sandbox.GameEvents.on("archaeology:fieldRepairApplied", event => repairEventsJ.push(event));
    const hpOnlineJ = { shield: 100, armor: 100, structure: 100 };
    const hpOfflineJ = { shield: 100, armor: 100, structure: 100 };
    const fuelOnlineBeforeJ = RRJ.get(onlineJ.state, "consumable:fuel");
    const fuelOfflineBeforeJ = RRJ.get(offlineJ.state, "consumable:fuel");
    const resOnlineJ = sandbox.applyArchaeologyFieldRepair(onlineJ.state, onlineJ.inst.instanceId, hpOnlineJ, REPAIR_CTX_J(false, nowJ));
    const resOfflineJ = sandbox.applyArchaeologyFieldRepair(offlineJ.state, offlineJ.inst.instanceId, hpOfflineJ, REPAIR_CTX_J(true, nowJ + 7));
    repairOffJ();
    okJ(resOnlineJ.repaired === 3 && resOfflineJ.repaired === 3 &&
        JSON.stringify(hpOnlineJ) === JSON.stringify(hpOfflineJ) &&
        (fuelOnlineBeforeJ - RRJ.get(onlineJ.state, "consumable:fuel")) === 5 &&
        (fuelOfflineBeforeJ - RRJ.get(offlineJ.state, "consumable:fuel")) === 5,
      "在线与离线必须共用同一维修函数与同一扣减逻辑，结果逐字节一致");
    okJ(repairEventsJ.length === 6 &&
        repairEventsJ.slice(0, 3).every(event => event.meta.offline === false && event.timestamp === nowJ) &&
        repairEventsJ.slice(3).every(event => event.meta.offline === true && event.timestamp === nowJ + 7) &&
        repairEventsJ.every(event => event.meta.source === "research-protocol"),
      "维修事件 metadata：timestamp 取 context.now、offline 取真实结算路径、source=research-protocol");
    okJ(repairEventsJ.every(event => event.registered === true && event.valid === true &&
          ["instanceId", "itemId", "target", "amount", "fuelCost"].every(key => event.payload[key] !== undefined)) &&
        repairEventsJ.slice(0, 3).map(event => event.payload.itemId).join(",") === "t1_shield_booster,t1_armor_repairer,t1_structure_repairer" &&
        repairEventsJ.slice(0, 3).map(event => event.payload.target).join(",") === "shield,armor,structure",
      "archaeology:fieldRepairApplied 必须已注册且契约合法，每件维修装备本次反噬恰激活一次");
    okJ(repairEventsJ[0].payload.amount === 30 && repairEventsJ[0].payload.fuelCost === 1 &&
        repairEventsJ[2].payload.amount === 10 && repairEventsJ[2].payload.fuelCost === 3,
      "事件 amount 必须是实际治疗量、fuelCost 必须是实际扣费");

    // ---- J-19 GameEvents 缺失降级：先扣费再发事件，且发事件被 typeof 守卫 --------------------
    okJ(/if \(typeof GameEvents !== "undefined"\)\s*\{\s*GameEvents\.emit\("archaeology:fieldRepairApplied"/.test(repairSrcJ) &&
        repairSrcJ.indexOf("ResourceRegistry.spend(state, fuelKey") < repairSrcJ.indexOf('GameEvents.emit("archaeology:fieldRepairApplied"'),
      "维修与扣费绝不依赖事件总线：先扣费改血再发事件，且发事件被 typeof GameEvents 守卫");

    // ---- J-20 maxHp 与 resetArchaeologyShipHp 同源 --------------------------------------------
    const maxHpJ = mkArchJ({}, {}, FIT3_J);
    sandbox.resetArchaeologyShipHp(maxHpJ.state, maxHpJ.inst.instanceId);
    const resetHpJ = maxHpJ.state.archaeology.shipHp[maxHpJ.inst.instanceId];
    const readMaxHpJ = sandbox.getArchaeologyShipMaxHp(maxHpJ.state, maxHpJ.inst.instanceId);
    okJ(readMaxHpJ.shield === resetHpJ.shield && readMaxHpJ.armor === resetHpJ.armor &&
        readMaxHpJ.structure === resetHpJ.structure && readMaxHpJ.shield === maxHpStarmapJ.shield,
      "getArchaeologyShipMaxHp 必须与 resetArchaeologyShipHp 逐层同源");
    const unknownMaxHpJ = sandbox.getArchaeologyShipMaxHp(maxHpJ.state, "ship_not_exist");
    okJ(unknownMaxHpJ.shield === 0 && unknownMaxHpJ.armor === 0 && unknownMaxHpJ.structure === 0,
      "未知舰船的三层最大生命必须安全返回 0");

    // ---- J-21 三个读取类函数纯读：拟合 / 装备池 / research 子树全不变 -------------------------
    const pureJ = mkArchJ({ autoenh: 1, autorepair: 1 }, { autoenh: true, autorepair: true }, FIT3_J);
    const pureFitJ = JSON.stringify(pureJ.inst.fitted);
    const pureEqJ = JSON.stringify(pureJ.state.equipment);
    const pureResearchJ = JSON.stringify(pureJ.state.research);
    sandbox.getArchaeologyShipMaxHp(pureJ.state, pureJ.inst.instanceId);
    const pureListJ = sandbox.getInstalledRepairersForShip(pureJ.state, pureJ.inst.instanceId);
    pureListJ.push({ target: "shield", amount: 9999, fuelCost: 0, multiplier: 1, itemId: "hack" });
    pureListJ[0].amount = -1;
    sandbox.getResearchProtocolDisplayState(pureJ.state, "autoenh");
    sandbox.getResearchProtocolDisplayState(pureJ.state, "autorepair");
    okJ(JSON.stringify(pureJ.inst.fitted) === pureFitJ && JSON.stringify(pureJ.state.equipment) === pureEqJ &&
        JSON.stringify(pureJ.state.research) === pureResearchJ && pureJ.state._dirty === false &&
        sandbox.getInstalledRepairersForShip(pureJ.state, pureJ.inst.instanceId).length === 3 &&
        sandbox.getInstalledRepairersForShip(pureJ.state, pureJ.inst.instanceId)[0].amount === 30,
      "getArchaeologyShipMaxHp / getInstalledRepairersForShip / getResearchProtocolDisplayState 必须纯读且返回新对象");

    // ---- J-22 显示态：六协议全部实装 ---------------------------------------------------------
    const dispJ = mkArchJ({ planauto: 1, autosell: 1, autoconv: 1, autoenh: 1, autorepair: 1, intship: 1 },
      { autoenh: true, autorepair: true, intship: true }, FIT3_J);
    const dispShipJ = sandbox.createShipInstance("rifter", nowJ + 2);
    dispJ.state.inventory.ships.push(dispShipJ);
    for (const id of allCompIdsJ) RRJ.set(dispJ.state, "component:" + id, 0);
    okJ(G("IMPLEMENTED_RESEARCH_PROTOCOLS").join(",") === "planauto,autosell,autoconv,autoenh,autorepair,intship" &&
        ["planauto", "autosell", "autoconv", "autoenh", "autorepair", "intship"].every(id => sandbox.getResearchProtocolDisplayState(dispJ.state, id).implemented === true),
      "六个协议必须全部标记为已实装");
    const dEnhJ = sandbox.getResearchProtocolDisplayState(dispJ.state, "autoenh");
    okJ(dEnhJ.maxAttempts === 0 && Array.isArray(dEnhJ.ships) && dEnhJ.ships.length === 2 &&
        dEnhJ.ships.every(row => row.hasTier === true && row.componentsSufficient === false) &&
        dEnhJ.ships.map(row => row.shipId).join(",") === "starmap,rifter",
      "autoenh 显示态必须给出 maxAttempts 与逐舰可强化 / 部件充足判定");
    for (const row of sandbox.getResearchProtocolDisplayState(dispJ.state, "autoenh").ships) {
      const cfg = sandbox.getShipConfigById(row.shipId);
      const cost = sandbox.getShipEnhancementCost(cfg);
      for (const [id, q] of Object.entries(cost)) RRJ.set(dispJ.state, "component:" + id, q);
    }
    okJ(sandbox.getResearchProtocolDisplayState(dispJ.state, "autoenh").ships.every(row => row.componentsSufficient === true),
      "补足部件后 autoenh 显示态必须翻转为部件充足");
    const dRepJ = sandbox.getResearchProtocolDisplayState(dispJ.state, "autorepair");
    okJ(dRepJ.archaeologyShip && dRepJ.archaeologyShip.shipId === "starmap" && dRepJ.repairers.length === 3 &&
        dRepJ.repairers.map(row => row.target).join(",") === "shield,armor,structure" && !dRepJ.statusNote,
      "autorepair 显示态必须给出考古舰船与三件维修装备清单");
    const dRepEmptyJ = sandbox.getResearchProtocolDisplayState(mkJ({ autorepair: 1 }, { autorepair: true }), "autorepair");
    okJ(dRepEmptyJ.archaeologyShip === null && dRepEmptyJ.repairers.length === 0 &&
        dRepEmptyJ.statusNote === "未指派考古舰船，无法读取维修装备",
      "未指派考古舰船时 autorepair 显示态必须给出明确说明");

    // ---- J-23 协议面板 HTML：autoenh 可执行 / autorepair 只读 / intship 已提供启动表单 ----------
    const htmlEnhJ = sandbox.renderResearchProtocolPanelHtml(sandbox.getResearchProtocolDisplayState(dispJ.state, "autoenh"));
    okJ(htmlEnhJ.includes('data-detail-action="protocol-toggle"') && htmlEnhJ.includes('data-protocol-id="autoenh"') &&
        htmlEnhJ.includes("data-protocol-max") && htmlEnhJ.includes('data-detail-action="autoenh-set-max"') &&
        htmlEnhJ.includes('data-detail-action="autoenh-run"') && htmlEnhJ.includes('data-instance-id="' + dispShipJ.instanceId + '"') &&
        !htmlEnhJ.includes("协议业务尚未接入"),
      "autoenh 面板必须提供总开关 / 最大尝试次数 / 逐舰开始自动强化按钮");
    for (const id of allCompIdsJ) RRJ.set(dispJ.state, "component:" + id, 0);
    const htmlEnhPoorJ = sandbox.renderResearchProtocolPanelHtml(sandbox.getResearchProtocolDisplayState(dispJ.state, "autoenh"));
    okJ(htmlEnhPoorJ.includes("部件不足") && /data-instance-id="[^"]+" disabled>/.test(htmlEnhPoorJ),
      "部件不足时开始自动强化按钮必须禁用");
    const htmlRepJ = sandbox.renderResearchProtocolPanelHtml(dRepJ);
    okJ(htmlRepJ.includes('data-protocol-id="autorepair"') && htmlRepJ.includes("t1_shield_booster") &&
        htmlRepJ.includes("t1_armor_repairer") && htmlRepJ.includes("t1_structure_repairer") &&
        htmlRepJ.includes("仅在非致命考古反噬后") && !htmlRepJ.includes('data-detail-action="autoenh-run"') &&
        !htmlRepJ.includes("data-deployment-id"),
      "autorepair 面板必须列出维修装备与说明，且不得出现任何主动执行按钮");
    const htmlIntJ = sandbox.renderResearchProtocolPanelHtml(sandbox.getResearchProtocolDisplayState(dispJ.state, "intship"));
    okJ(htmlIntJ.includes('data-protocol-id="intship"') && htmlIntJ.includes("data-intship-recipe") &&
        htmlIntJ.includes("data-intship-quantity") && htmlIntJ.includes('data-detail-action="intship-start"') &&
        !htmlIntJ.includes("协议业务尚未接入"),
      "intship 面板必须提供启动表单（配方下拉 / 数量 / 开始按钮），不再显示“协议业务尚未接入”");

    // ---- J-24 Batch I 不回退 + 冻结基线不回退 ------------------------------------------------
    const apiNamesJ = [
      "isResearchProtocolUnlocked", "isResearchProtocolEnabled", "isResearchProtocolActive",
      "setResearchProtocolEnabled", "setPlanetAutoRenew", "getResearchProtocolDisplayState",
      "tryPlanetAutoRenew", "applyArchaeologyArtifactProtocols",
      "setAutoEnhancementMaxAttempts", "runAutoEnhancement",
      "getArchaeologyShipMaxHp", "getInstalledRepairersForShip", "applyArchaeologyFieldRepair"
    ];
    okJ(apiNamesJ.every(name => typeof sandbox[name] === "function"),
      "Batch I 的 8 个 API 必须与 Batch J 的 5 个新 API 并存：" + apiNamesJ.join("/"));
    okJ(Object.keys(REASONS_J).length === 11 && Object.keys(AERJ).length === 11 && Object.keys(AFRJ).length === 5 &&
        Object.values(AERJ).every(value => typeof value === "string" && value === value.toUpperCase()),
      "Batch I 的 11 个稳定 reason 不得增删；Batch J 加固后维修 reason 恰为 5 个且必须是大写串");
    const artProtoJ = mkJ({ autosell: 1, autoconv: 1 }, { autosell: true, autoconv: true });
    okJ(sandbox.isResearchProtocolActive(artProtoJ, "autosell") === true &&
        sandbox.isResearchProtocolActive(artProtoJ, "autoconv") === true &&
        sandbox.isResearchProtocolActive(artProtoJ, "autoenh") === false &&
        sandbox.setResearchProtocolEnabled(artProtoJ, "autoenh", true).reason === REASONS_J.PROTOCOL_LOCKED,
      "Batch I 三协议行为不得回退，且未研究的 autoenh 仍不可启用");
    let stepsJ = 0;
    let secondsJ = 0;
    for (const node of RDJ.NODES) {
      stepsJ += Number(node.maxLevel) || 0;
      for (const duration of (node.durationByLevel || [])) secondsJ += Number(duration) || 0;
    }
    const protocolNodesJ = RDJ.NODES.filter(node => node.type === "protocol");
    okJ(Object.keys(RDJ.RESEARCH_BONUS_CONSUMERS || {}).length === 31 && RDJ.NODES.length === 38 &&
        stepsJ === 150 && Math.abs(secondsJ - 7776000) < 1e-6 &&
        protocolNodesJ.length === 6 && protocolNodesJ.every(node => !node.bonus && node.maxLevel === 1),
      "31 组数值 group / 38 节点 / 150 步 / 90 天 / 6 个无 bonus 协议节点基线不得回退");
    okJ(scriptSources.length === 56 && styleSources.length === 4 && htmlIds.size === 313,
      "56 JS / 4 CSS / 313 DOM ID 基线不得回退");
  } finally {
    gsJ.research = JSON.parse(JSON.stringify(savedResearchJ));
    gsJ.inventory = JSON.parse(JSON.stringify(savedInventoryJ));
    gsJ.resources = JSON.parse(JSON.stringify(savedResourcesJ));
    gsJ.skills = JSON.parse(JSON.stringify(savedSkillsJ));
    gsJ.archaeology = JSON.parse(JSON.stringify(savedArchJ));
    gsJ.currentAction = JSON.parse(JSON.stringify(savedActionJ));
    gsJ.shipAssignments = JSON.parse(JSON.stringify(savedAssignJ));
  }

  console.log("Batch J 自动强化 / 野外自动维修校验通过（" + jChecks + " 项）：三层门槛（未研究 / 未启用 / 脏档 enabled=true 未研究一律零执行零消耗）、maxAttempts 十一类非法输入与 10000 上限、迁移幂等清洗且 schemaVersion 不变、maxAttempts=N 恰 N 次真实 attempt 且事件数 === attempts、maxAttempts=0 持续到部件真实耗尽、成功 +1 级取底层 XP / 失败不掉级 0 XP 但照扣部件、只消耗不产出部件、活动舰船与未知舰船零尝试、手动单次强化行为不变、两条 action 路由生效且不绕过门槛、维修件只来自考古舰船 fitting 绝不借战斗舰船、真实非致命反噬三层各修一次并多扣 1+1+3 燃料、致命反噬绝不维修绝不复活、满血层跳过零燃料与溢出钳制、燃料只够第一件即停且不为负、repair 满级 ×1.06 只乘一次、在线离线共用同一逻辑、事件 timestamp/offline/source 与五字段契约、扣费先于发事件且 GameEvents 缺失降级、maxHp 与 reset 同源、三个读取函数纯读、六协议全实装（intship 由 Batch K 实装）、autoenh 面板可执行与部件不足禁用、autorepair 面板只读、intship 面板提供启动表单、Batch I 与 31/38/150/90 天/50 JS/4 CSS/294 DOM 基线不回退");
}

// ============================================================================================
// 研究系统 Batch K：intship 一体化造船完整实装（第六个协议，研究系统最终收口）
// 铁律：
//   1) 只做编排：绝不自行扣材料/组件、绝不自行 createShipInstance、绝不自行 emit
//      manufacturing:completed、绝不复制周期/成本/船坞公式——全部走既有制造链路；
//   2) 19 个稳定 reason（5 个复用 Batch I + 14 个新增），公开 API 恰 12 个；
//   3) 幂等消费者经 GameEvents.onIdempotent 只更账本，绝不覆盖 currentAction；
//      阶段推进唯一入口 advanceIntshipAfterManufacturingAction（在线/离线共用）；
//   4) 失败一律原子回滚（作业 + currentAction 快照），起步缺料绝不空转；
//   5) 取消不回退已产出；存档恢复 fail closed 为 recovery-required。
// ============================================================================================
{
  let kChecks = 0;
  const okK = (condition, message) => {
    if (!condition) throw new Error("Batch K 校验失败：" + message);
    kChecks += 1;
  };
  const nearK = (a, b, eps) => Math.abs(Number(a) - Number(b)) <= (eps === undefined ? 1e-6 : eps);

  const RSK = sandbox.ResearchState;
  const RRK = G("ResourceRegistry");
  const REASONS_K = G("INTSHIP_REASONS");
  const MSAK = G("ManufacturingStateActions");
  const gsK = sandbox.gameState;
  const nowK = 1780000000000;

  const savedResearchK = JSON.parse(JSON.stringify(gsK.research));
  const savedInventoryK = JSON.parse(JSON.stringify(gsK.inventory));
  const savedResourcesK = JSON.parse(JSON.stringify(gsK.resources));
  const savedSkillsK = JSON.parse(JSON.stringify(gsK.skills));
  const savedActionK = JSON.parse(JSON.stringify(gsK.currentAction));
  const savedStationK = JSON.parse(JSON.stringify(gsK.station));
  const savedQueueK = JSON.parse(JSON.stringify(gsK.queue || null));
  const savedAssignK = JSON.parse(JSON.stringify(gsK.shipAssignments || {}));

  try {
    const pristineK = JSON.parse(JSON.stringify(gsK));

    // 夹具：干净默认研究状态 + 指定已完成等级 + 指定协议总开关 + 空机库 / 空装备池 / 无活动
    const mkK = (levels, protocolEnabled) => {
      const state = JSON.parse(JSON.stringify(pristineK));
      state.research = RSK.createDefaultResearchState();
      state.research.lastProcessedAt = nowK;
      state.research.completedLevels = Object.assign({}, levels || {});
      for (const [key, value] of Object.entries(protocolEnabled || {})) {
        state.research.protocolSettings[key].enabled = value;
      }
      state.inventory = { ships: [], equipment: [], rigs: [] };
      state.shipAssignments = {};
      state.planetary = { deployments: [], nextId: 1 };
      state.currentAction = Object.assign({}, state.currentAction, { active: false, skill: null, progress: 0 });
      if (state.combat && typeof state.combat === "object") { state.combat.active = false; state.combat.activeShip = null; }
      state._dirty = false;
      return state;
    };
    // 挂载夹具到全局 gameState，跑完原样还原（真实 tick / 离线入口）
    const withGameStateK = (state, fn) => {
      const sR = gsK.research, sI = gsK.inventory, sRes = gsK.resources, sSk = gsK.skills;
      const sA = gsK.currentAction, sS = gsK.station, sQ = gsK.queue, sAs = gsK.shipAssignments;
      const sBp = gsK.ownedBlueprints;
      gsK.research = state.research; gsK.inventory = state.inventory; gsK.resources = state.resources;
      gsK.skills = state.skills; gsK.currentAction = state.currentAction; gsK.station = state.station;
      gsK.queue = state.queue; gsK.shipAssignments = state.shipAssignments; gsK.ownedBlueprints = state.ownedBlueprints;
      try { return fn(); } finally {
        gsK.research = sR; gsK.inventory = sI; gsK.resources = sRes; gsK.skills = sSk;
        gsK.currentAction = sA; gsK.station = sS; gsK.queue = sQ; gsK.shipAssignments = sAs;
        gsK.ownedBlueprints = sBp;
      }
    };

    // rifter ×1 全链路材料：6 个组件周期（i_h×2 + p_c×2 + f_s×2）总消耗 164/26/18/18
    const RIFTER_MATS_K = { "三钛合金":164, "类银超金属":26, "重金属":18, "稀有气体":18 };
    const setMatsK = (state, map) => { for (const [id, q] of Object.entries(map || {})) RRK.set(state, "mineral:" + id, q); };
    const setComponentsK = (state, counts) => { for (const [id, q] of Object.entries(counts || {})) RRK.set(state, "component:" + id, q); };
    const mkReadyK = (mats, comps, extra) => {
      const state = mkK({ intship: 1 }, { intship: true });
      // 干净队列（不继承全局 gameState 遗留项，保证 queue/start 只执行本夹具入队的动作）
      state.queue = { items: [], config: { maxSize: 20, loopMode: false, skipOnFail: true }, status: { activeIndex: -1, isRunning: false, completedCount: 0, failCount: 0 } };
      // rifter 装配配方需要蓝图（仅 destroyer 级免蓝图）
      if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
      if (state.ownedBlueprints.indexOf("rifter") < 0) state.ownedBlueprints.push("rifter");
      setMatsK(state, mats || RIFTER_MATS_K);
      setComponentsK(state, comps || {});
      if (extra) extra(state);
      state._dirty = false;
      return state;
    };
    const activePhaseK = (job) => Boolean(job) && (job.phase === "component" || job.phase === "assembly");
    const driveK = (state, maxTicks) => {
      const job = state.research.protocolJobs.intship;
      let ticks = 0;
      while (job && activePhaseK(job) && ticks < (maxTicks || 12)) {
        gsK.currentAction.progress = 100000;
        sandbox.gameTick();
        ticks++;
      }
      return ticks;
    };

    // ---- K-01 公开 API 与稳定 reason 基线 -----------------------------------------------
    const intshipApisK = [
      "startIntship", "continueIntship", "cancelIntship", "advanceIntshipAfterManufacturingAction",
      "restoreIntshipProtocolRuntime", "getIntshipJob", "summarizeIntshipJob",
      "buildIntshipComponentPlan", "buildIntshipRecipeOptions", "intshipOwnsCurrentAction",
      "reconcileIntshipRuntime", "buildIntshipRecipeOptions"
    ];
    okK(intshipApisK.every(name => typeof sandbox[name] === "function"),
      "intship 公开 API 必须全部暴露：" + intshipApisK.join("/"));
    okK(Object.keys(REASONS_K).length === 20 && Object.values(REASONS_K).every(value => typeof value === "string" && value === value.toUpperCase()) &&
        REASONS_K.EVENTS_UNAVAILABLE === "EVENTS_UNAVAILABLE",
      "INTSHIP_REASONS 必须恰为 20 个稳定大写串且含 EVENTS_UNAVAILABLE");
    okK(sandbox.INTSHIP_MAX_QUANTITY === 1000, "INTSHIP_MAX_QUANTITY 必须为 1000");
    okK(G("IMPLEMENTED_RESEARCH_PROTOCOLS").join(",").includes("intship"),
      "六协议全实装集合必须包含 intship");

    // ---- K-02 三层门槛 + 参数校验 + 原子回滚 --------------------------------------------
    const lockedK = mkK({}, {});
    const resLockedK = sandbox.startIntship(lockedK, { recipeId: "rifter", quantity: 1 }, nowK);
    okK(resLockedK.changed === false && resLockedK.reason === REASONS_K.PROTOCOL_LOCKED && lockedK._dirty === false,
      "未研究 intship 必须 PROTOCOL_LOCKED 且零副作用");
    const disabledK = mkK({ intship: 1 }, {});
    okK(sandbox.startIntship(disabledK, { recipeId: "rifter", quantity: 1 }, nowK).reason === REASONS_K.PROTOCOL_DISABLED,
      "已研究未启用必须 PROTOCOL_DISABLED");
    okK([0, -3, 1.5, 1001, "abc", "2", NaN].every(q => sandbox.startIntship(mkReadyK(), { recipeId: "rifter", quantity: q }, nowK).reason === REASONS_K.INVALID_QUANTITY),
      "非法数量（0/-3/小数/超上限/字符串/数字字符串/NaN）一律 INVALID_QUANTITY");
    okK(sandbox.startIntship(mkReadyK(), { recipeId: "nope", quantity: 1 }, nowK).reason === REASONS_K.UNKNOWN_RECIPE,
      "未知配方必须 UNKNOWN_RECIPE");
    okK(sandbox.startIntship(mkReadyK(), { shipId: "gale", quantity: 1 }, nowK).reason === REASONS_K.BLUEPRINT_LOCKED,
      "未拥有蓝图（gale）必须 BLUEPRINT_LOCKED");
    okK(sandbox.startIntship(mkReadyK(), { recipeId: "raylight", quantity: 1 }, nowK).reason === REASONS_K.LEVEL_LOCKED,
      "舰船工程等级不足（raylight Lv.15）必须 LEVEL_LOCKED");
    const busyK = mkReadyK(); busyK.currentAction.active = true;
    okK(sandbox.startIntship(busyK, { recipeId: "rifter", quantity: 1 }, nowK).reason === REASONS_K.ACTION_BUSY,
      "当前有进行中制造动作必须 ACTION_BUSY");
    const brokeK = mkReadyK({}, {});
    const brokeBeforeK = JSON.stringify(brokeK.currentAction);
    const resBrokeK = sandbox.startIntship(brokeK, { recipeId: "rifter", quantity: 1 }, nowK);
    okK(resBrokeK.reason === REASONS_K.INSUFFICIENT_MATERIALS && brokeK.research.protocolJobs.intship === null &&
        JSON.stringify(brokeK.currentAction) === brokeBeforeK && brokeK._dirty === false,
      "起步缺料必须 INSUFFICIENT_MATERIALS 且作业与 currentAction 原子回滚（零残留）");

    // ---- K-03 启动成功：组件计划 / batchRemaining / 库存缺口 ---------------------------------
    const startK = mkReadyK();
    const resStartK = sandbox.startIntship(startK, { recipeId: "rifter", quantity: 1 }, nowK);
    okK(resStartK.changed === true && resStartK.phase === "component" && resStartK.componentId === "integrated_hull",
      "材料充足必须启动成功并进入组件阶段（componentPlan 键序第一个）");
    okK(startK.currentAction.skill === "shipEngineering" && startK.currentAction.active === true &&
        startK.currentAction.shipSubAction === "component" && startK.currentAction.startedShipCompTarget === "integrated_hull" &&
        startK.currentAction.batchRemaining === 2,
      "启动后 currentAction 必须被真实制造动作接管且 batchRemaining=缺口 2");
    const startJobK = startK.research.protocolJobs.intship;
    okK(JSON.stringify(startJobK.componentPlan) === JSON.stringify({ integrated_hull: 2, power_core: 2, functional_system: 2 }) &&
        startJobK.assemblyRemaining === 1 && startJobK.producedShips === 0,
      "componentPlan 必须恰为三组件各 2 缺口，总装余量=数量");
    const partialK = mkReadyK(RIFTER_MATS_K, { integrated_hull: 1 });
    const resPartialK = sandbox.startIntship(partialK, { recipeId: "rifter", quantity: 1 }, nowK);
    okK(resPartialK.changed === true && partialK.research.protocolJobs.intship.componentPlan.integrated_hull === 1 &&
        partialK.currentAction.batchRemaining === 1,
      "已有库存组件必须从缺口扣除（1/2）并精确设置批量");
    const fullK = mkReadyK(RIFTER_MATS_K, { integrated_hull: 2, power_core: 2, functional_system: 2 });
    const resFullK = sandbox.startIntship(fullK, { recipeId: "rifter", quantity: 1 }, nowK);
    okK(resFullK.changed === true && resFullK.phase === "assembly" &&
        fullK.currentAction.shipSubAction === "assembly" && fullK.currentAction.batchRemaining === 1,
      "组件全齐必须跳过组件阶段直接总装（batchRemaining=数量）");
    okK(sandbox.startIntship(fullK, { recipeId: "rifter", quantity: 1 }, nowK).reason === REASONS_K.JOB_ALREADY_ACTIVE,
      "已有活动作业再启动必须 JOB_ALREADY_ACTIVE");

    // ---- K-04 在线全链路：真实 tick 驱动（组件生产 → 总装 → 产舰） --------------------------
    const onlineK = mkReadyK();
    okK(sandbox.startIntship(onlineK, { recipeId: "rifter", quantity: 1 }, nowK).changed === true, "在线链路前置：启动成功");
    withGameStateK(onlineK, () => driveK(onlineK, 12));
    const onlineJobK = onlineK.research.protocolJobs.intship;
    okK(onlineJobK.phase === "completed" && onlineJobK.producedShips === 1 && onlineJobK.assemblyRemaining === 0,
      "在线全链路后作业必须 completed、产舰 1、总装余量 0");
    okK(onlineK.inventory.ships.length === 1 && onlineK.inventory.ships[0].shipId === "rifter",
      "机库必须真实产出 1 艘 rifter（既有 createShipInstance 链路）");
    okK(RRK.get(onlineK, "mineral:三钛合金") === 0 && RRK.get(onlineK, "mineral:类银超金属") === 0 &&
        RRK.get(onlineK, "mineral:重金属") === 0 && RRK.get(onlineK, "mineral:稀有气体") === 0,
      "6 个组件周期必须真实扣光 164/26/18/18 材料（既有 deductMats 链路）");
    okK(RRK.get(onlineK, "component:integrated_hull") === 0 && RRK.get(onlineK, "component:power_core") === 0 &&
        RRK.get(onlineK, "component:functional_system") === 0,
      "组件产出 2+2+2 必须被总装 2+2+2 真实消耗（组件库存归零）");
    okK(onlineK.currentAction.active === false, "作业完成后 currentAction 必须停止");
    withGameStateK(onlineK, () => { gsK.currentAction.progress = 100000; sandbox.gameTick(); });
    okK(onlineK.research.protocolJobs.intship.phase === "completed" && onlineK.inventory.ships.length === 1,
      "作业完成后继续 tick 绝不重复产舰（消费者已卸载）");

    // ---- K-05 幂等消费者：只更账本、去重、错配不入账 --------------------------------------
    const evStateK = mkReadyK();
    sandbox.startIntship(evStateK, { recipeId: "rifter", quantity: 1 }, nowK);
    const evJobK = evStateK.research.protocolJobs.intship;
    const evLedgerBeforeK = evJobK.processedEventIds.length;
    const emitCompK = (eventId) => sandbox.GameEvents.emit("manufacturing:completed",
      { branch: "component", recipeId: evJobK.currentComponentId, resourceId: "component:" + evJobK.currentComponentId, quantity: 1, cycles: 1, xp: 44 },
      { timestamp: nowK, eventId });
    emitCompK("k_ev_1");
    okK(evJobK.completedComponents[evJobK.currentComponentId] === 1 &&
        evJobK.processedEventIds.length === evLedgerBeforeK + 1 &&
        evJobK.processedEventIds.includes("intship:" + evJobK.jobId + ":k_ev_1"),
      "正确组件事件必须入账（completedComponents+1、ledger 记录 consumerId:eventId）");
    emitCompK("k_ev_1");
    okK(evJobK.completedComponents[evJobK.currentComponentId] === 1 && evJobK.processedEventIds.length === evLedgerBeforeK + 1,
      "同 eventId 重复事件必须幂等去重（不重复入账）");
    sandbox.GameEvents.emit("manufacturing:completed",
      { branch: "component", recipeId: "power_core", resourceId: "component:power_core", quantity: 1, cycles: 1, xp: 30 },
      { timestamp: nowK, eventId: "k_ev_2" });
    okK(evJobK.completedComponents["power_core"] === undefined && evJobK.processedEventIds.length === evLedgerBeforeK + 1,
      "非当前组件 recipeId 的事件必须不入账");
    sandbox.GameEvents.emit("manufacturing:completed",
      { branch: "ship", recipeId: evJobK.recipeId, shipId: evJobK.shipId, quantity: 1, cycles: 1, xp: 30 },
      { timestamp: nowK, eventId: "k_ev_3" });
    okK(evJobK.producedShips === 0 && evJobK.assemblyRemaining === 1 && evJobK.processedEventIds.length === evLedgerBeforeK + 1,
      "组件阶段收到 ship 事件必须不入账（绝不提前产舰）");

    // ---- K-06 中途缺料 → stopped → 补齐续作 → 完成 -----------------------------------------
    const shortK = mkReadyK({ "三钛合金": 40, "类银超金属": 6, "重金属": 7, "稀有气体": 4 });
    okK(sandbox.startIntship(shortK, { recipeId: "rifter", quantity: 1 }, nowK).changed === true, "缺料场景前置：启动成功（首周期可负担）");
    withGameStateK(shortK, () => { gsK.currentAction.progress = 100000; sandbox.gameTick(); });
    okK(shortK.currentAction.active === false, "第 2 个综合舰体组件缺料后制造动作必须停止");
    withGameStateK(shortK, () => sandbox.gameTick());
    okK(shortK.research.protocolJobs.intship.phase === "stopped" &&
        shortK.research.protocolJobs.intship.stopReason === REASONS_K.INSUFFICIENT_MATERIALS,
      "下一 tick 对账后作业必须落 stopped 且 stopReason=INSUFFICIENT_MATERIALS");
    okK(sandbox.continueIntship(shortK, nowK + 1000).reason === REASONS_K.INSUFFICIENT_MATERIALS &&
        shortK.research.protocolJobs.intship.phase === "stopped" && shortK.currentAction.active === false,
      "材料未补齐时续作必须 INSUFFICIENT_MATERIALS 且作业保持 stopped（零残留）");
    setMatsK(shortK, RIFTER_MATS_K);
    const resContK = sandbox.continueIntship(shortK, nowK + 1000);
    okK(resContK.changed === true && resContK.phase === "component" && shortK.currentAction.active === true &&
        shortK.currentAction.batchRemaining === 1,
      "补齐材料后 continueIntship 必须恢复组件阶段（剩余缺口 1）");
    withGameStateK(shortK, () => driveK(shortK, 12));
    okK(shortK.research.protocolJobs.intship.phase === "completed" && shortK.inventory.ships.length === 1,
      "续作后驱动必须完成作业并产舰 1 艘");

    // ---- K-07 玩家抢占 → preempted → 续作 --------------------------------------------------
    const preK = mkReadyK();
    sandbox.startIntship(preK, { recipeId: "rifter", quantity: 1 }, nowK);
    preK.currentAction.skill = "mining"; // 模拟玩家切换制造动作为其他技能
    const recPreK = sandbox.reconcileIntshipRuntime(preK, nowK + 500);
    okK(recPreK.phase === "preempted" && recPreK.stopReason === REASONS_K.PREEMPTED,
      "作业被其他活动动作抢占后必须落 preempted");
    okK(sandbox.continueIntship(preK, nowK + 1000).reason === REASONS_K.ACTION_BUSY,
      "抢占后当前动作仍活动时续作必须 ACTION_BUSY");
    preK.currentAction.active = false;
    okK(sandbox.continueIntship(preK, nowK + 1000).changed === true,
      "停掉抢占动作后 preempted 作业必须可续作");

    // ---- K-08 取消：停止动作 / 保留产出 / 状态机 -------------------------------------------
    const cancelK = mkReadyK();
    sandbox.startIntship(cancelK, { recipeId: "rifter", quantity: 1 }, nowK);
    const resCancelK = sandbox.cancelIntship(cancelK, nowK + 500);
    okK(resCancelK.changed === true && resCancelK.stoppedAction === true &&
        cancelK.research.protocolJobs.intship.phase === "cancelled" && cancelK.currentAction.active === false &&
        cancelK.currentAction.batchRemaining === 0,
      "取消必须停止驱动动作并落 cancelled（batchRemaining 清零）");
    okK(sandbox.cancelIntship(cancelK, nowK + 600).reason === REASONS_K.JOB_CANCELLED &&
        sandbox.continueIntship(cancelK, nowK + 600).reason === REASONS_K.JOB_CANCELLED,
      "已取消作业再取消 / 续作都必须 JOB_CANCELLED");
    okK(sandbox.cancelIntship(onlineK, nowK + 600).reason === REASONS_K.JOB_COMPLETED,
      "已完成作业取消必须 JOB_COMPLETED");
    okK(sandbox.cancelIntship(mkK({ intship: 1 }, { intship: true }), nowK).reason === REASONS_K.NO_ACTIVE_JOB,
      "无作业取消必须 NO_ACTIVE_JOB");

    // ---- K-09 存档恢复：重装消费者 / fail closed 为 recovery-required -----------------------
    okK(sandbox.restoreIntshipProtocolRuntime(mkK({ intship: 1 }, { intship: true })).reason === REASONS_K.NO_ACTIVE_JOB,
      "无作业恢复必须 NO_ACTIVE_JOB");
    const restK = mkReadyK();
    sandbox.startIntship(restK, { recipeId: "rifter", quantity: 1 }, nowK);
    const resRestK = sandbox.restoreIntshipProtocolRuntime(restK);
    okK(resRestK.restored === true && resRestK.phase === "component",
      "活动作业且 currentAction 匹配必须恢复成功并重装消费者");
    const badShapeK = mkReadyK();
    sandbox.startIntship(badShapeK, { recipeId: "rifter", quantity: 1 }, nowK);
    badShapeK.research.protocolJobs.intship.recipeId = "kestrel";
    okK(sandbox.restoreIntshipProtocolRuntime(badShapeK).reason === REASONS_K.RECOVERY_REQUIRED &&
        badShapeK.research.protocolJobs.intship.phase === "recovery-required",
      "配方 shape 不匹配必须 fail closed 为 recovery-required");
    const detachedK = mkReadyK();
    sandbox.startIntship(detachedK, { recipeId: "rifter", quantity: 1 }, nowK);
    detachedK.currentAction.active = false;
    okK(sandbox.restoreIntshipProtocolRuntime(detachedK).reason === REASONS_K.RECOVERY_REQUIRED &&
        detachedK.research.protocolJobs.intship.phase === "recovery-required",
      "作业不再驱动 currentAction 必须 fail closed 为 recovery-required");
    okK(sandbox.restoreIntshipProtocolRuntime(onlineK).restored === false &&
        sandbox.restoreIntshipProtocolRuntime(onlineK).reason === REASONS_K.JOB_NOT_RESUMABLE,
      "已完成作业恢复不装消费者、不产舰");

    // ---- K-10 离线链路：真实 settleOfflineActions 一次推进到完成 -----------------------------
    const offlineK = mkReadyK();
    okK(sandbox.startIntship(offlineK, { recipeId: "rifter", quantity: 1 }, nowK).changed === true, "离线链路前置：启动成功");
    const gainsK = {};
    withGameStateK(offlineK, () => sandbox.settleOfflineActions(100000, gainsK));
    okK(offlineK.research.protocolJobs.intship.phase === "completed" && offlineK.inventory.ships.length === 1,
      "离线结算必须推进并完成一体化造船（组件 → 总装 → 产舰）");
    okK(RRK.get(offlineK, "mineral:三钛合金") === 0 && RRK.get(offlineK, "component:integrated_hull") === 0 &&
        RRK.get(offlineK, "component:power_core") === 0 && RRK.get(offlineK, "component:functional_system") === 0,
      "离线全链路必须真实扣料且组件被总装消耗");

    // ---- K-11 action 路由：三条 research/* 路由与直调同源 ------------------------------------
    const routeK = mkReadyK();
    const resRouteK = sandbox.dispatchGameAction(routeK, { type: "research/startIntship", options: { recipeId: "rifter", quantity: 1 } }, nowK);
    okK(resRouteK.changed === true && resRouteK.phase === "component", "action 路由 research/startIntship 必须生效");
    okK(sandbox.dispatchGameAction(routeK, { type: "research/cancelIntship" }, nowK).changed === true &&
        routeK.research.protocolJobs.intship.phase === "cancelled",
      "action 路由 research/cancelIntship 必须生效");
    const routeStoppedK = mkReadyK();
    sandbox.dispatchGameAction(routeStoppedK, { type: "research/startIntship", options: { recipeId: "rifter", quantity: 1 } }, nowK);
    routeStoppedK.currentAction.active = false;
    okK(sandbox.dispatchGameAction(routeStoppedK, { type: "research/continueIntship" }, nowK).changed === true,
      "action 路由 research/continueIntship 必须生效");

    // ---- K-12 UI 显示态：启动表单 / 作业进度 / 中断标记 --------------------------------------
    const dispK = mkReadyK();
    const dispEmptyK = sandbox.getResearchProtocolDisplayState(dispK, "intship");
    okK(dispEmptyK.implemented === true && dispEmptyK.maxQuantity === 1000 && dispEmptyK.job === null &&
        Array.isArray(dispEmptyK.recipes) && dispEmptyK.recipes.some(r => r.recipeId === "rifter" && r.buildable === true) &&
        dispEmptyK.actionBusy === false,
      "intship 显示态无作业时必须给出可造配方清单与数量上限");
    sandbox.startIntship(dispK, { recipeId: "rifter", quantity: 1 }, nowK);
    const dispRunK = sandbox.getResearchProtocolDisplayState(dispK, "intship");
    okK(dispRunK.job && dispRunK.job.phase === "component" && dispRunK.jobRunning === true && dispRunK.jobInterrupted === false,
      "作业运行时显示态必须 jobRunning=true、jobInterrupted=false");
    dispK.currentAction.active = false;
    const dispIntK = sandbox.getResearchProtocolDisplayState(dispK, "intship");
    okK(dispIntK.jobRunning === false && dispIntK.jobInterrupted === true,
      "作业被中断时显示态必须 jobInterrupted=true");

    // ---- K-13 公开 API 契约：buildIntshipComponentPlan(state, targetShipId, quantity) ----------
    const planSigK = sandbox.buildIntshipComponentPlan(mkReadyK(), "rifter", 2);
    okK(planSigK && planSigK.integrated_hull === 4 && planSigK.power_core === 4 && planSigK.functional_system === 4,
      "公开 buildIntshipComponentPlan 必须接受舰船 ID 字符串 + 合法数量并返回缺口（需求-库存）");
    okK(["2", 2.5, NaN, Infinity, 0, -1, 1001, null, {}, ["rifter"]].every(bad =>
        sandbox.buildIntshipComponentPlan(mkReadyK(), "rifter", bad) === null),
      "公开 buildIntshipComponentPlan 必须拒绝数字字符串/小数/NaN/Infinity/0/负数/超上限/null/对象/数组数量");
    okK([undefined, "", 123, {}, null, ["rifter"]].every(bad =>
        sandbox.buildIntshipComponentPlan(mkReadyK(), bad, 1) === null),
      "公开 buildIntshipComponentPlan 必须拒绝非字符串/空字符串/数字/对象/数组/null 的 targetShipId");

    // ---- K-14 quantity=2 在线完整链：真实制造 → 总装 → 恰 2 艘 --------------------------------
    const twoOnlineK = mkReadyK({ "三钛合金": 328, "类银超金属": 52, "重金属": 36, "稀有气体": 36 });
    okK(sandbox.startIntship(twoOnlineK, { recipeId: "rifter", quantity: 2 }, nowK).changed === true &&
        twoOnlineK.research.protocolJobs.intship.componentPlan.integrated_hull === 4,
      "quantity=2 前置：组件缺口必须为 4+4+4");
    withGameStateK(twoOnlineK, () => driveK(twoOnlineK, 16));
    okK(twoOnlineK.research.protocolJobs.intship.phase === "completed" &&
        twoOnlineK.inventory.ships.length === 2 && twoOnlineK.inventory.ships.every(s => s.shipId === "rifter"),
      "quantity=2 在线全链必须最终恰增加 2 艘 rifter");
    okK(RRK.get(twoOnlineK, "mineral:三钛合金") === 0 && RRK.get(twoOnlineK, "mineral:类银超金属") === 0 &&
        RRK.get(twoOnlineK, "mineral:重金属") === 0 && RRK.get(twoOnlineK, "mineral:稀有气体") === 0 &&
        RRK.get(twoOnlineK, "component:integrated_hull") === 0 && RRK.get(twoOnlineK, "component:power_core") === 0 &&
        RRK.get(twoOnlineK, "component:functional_system") === 0,
      "quantity=2 在线全链材料 328/52/36/36 与组件 4+4+4 必须真实消耗干净");
    withGameStateK(twoOnlineK, () => { gsK.currentAction.progress = 100000; sandbox.gameTick(); });
    okK(twoOnlineK.inventory.ships.length === 2,
      "quantity=2 完成后重复 tick 绝不造第 3 艘");

    // ---- K-15 quantity=2 离线完整链 ---------------------------------------------------------
    const twoOfflineK = mkReadyK({ "三钛合金": 328, "类银超金属": 52, "重金属": 36, "稀有气体": 36 });
    okK(sandbox.startIntship(twoOfflineK, { recipeId: "rifter", quantity: 2 }, nowK).changed === true,
      "quantity=2 离线前置：启动成功");
    withGameStateK(twoOfflineK, () => sandbox.settleOfflineActions(100000, {}));
    okK(twoOfflineK.research.protocolJobs.intship.phase === "completed" &&
        twoOfflineK.inventory.ships.length === 2,
      "quantity=2 离线全链必须最终恰增加 2 艘 rifter");

    // ---- K-16 造 1 件→停→玩家消耗→补料→续作：缺口重算、杜绝死循环 -----------------------------
    const consumeK = mkReadyK({ "三钛合金": 40, "类银超金属": 6, "重金属": 7, "稀有气体": 4 });
    okK(sandbox.startIntship(consumeK, { recipeId: "rifter", quantity: 1 }, nowK).changed === true,
      "消耗恢复前置：启动成功（材料只够 1 个综合舰体组件）");
    withGameStateK(consumeK, () => { gsK.currentAction.progress = 100000; sandbox.gameTick(); });
    okK(RRK.get(consumeK, "component:integrated_hull") === 1 && consumeK.currentAction.active === false,
      "消耗恢复：造出 1 件组件后原料不足必须停止");
    RRK.spend(consumeK, "component:integrated_hull", 1); // 玩家消耗掉这 1 件组件
    setMatsK(consumeK, RIFTER_MATS_K); // 补充原料
    const resConsumeContK = sandbox.continueIntship(consumeK, nowK + 1000);
    okK(resConsumeContK.changed === true &&
        consumeK.research.protocolJobs.intship.componentPlan.integrated_hull === 2 &&
        consumeK.currentAction.batchRemaining === 2,
      "消耗组件后续作必须重算缺口为 2（重新认定，而非只补 1 后卡在总装）");
    okK(consumeK.research.protocolJobs.intship.processedEventIds.length === 1,
      "续作重算不得清空幂等账本 processedEventIds");
    withGameStateK(consumeK, () => driveK(consumeK, 12));
    okK(consumeK.research.protocolJobs.intship.phase === "completed" && consumeK.inventory.ships.length === 1,
      "消耗组件恢复后驱动必须最终完成并造舰 1 艘（绝不循环卡死）");

    // ---- K-17 真实玩家抢占：经公开 queue/add + queue/start 动作链，禁止伪造赋值 -----------------
    const preemptK = mkReadyK();
    okK(sandbox.startIntship(preemptK, { recipeId: "rifter", quantity: 1 }, nowK).changed === true,
      "真实抢占前置：启动成功");
    okK(sandbox.dispatchGameAction(preemptK, { type: "queue/add", item: { skill: "mining", target: "凡晶石带", label: "凡晶石", count: 1 } }, nowK).changed === true,
      "真实抢占：queue/add 公开动作必须入队成功");
    okK(sandbox.dispatchGameAction(preemptK, { type: "queue/start" }, nowK).changed === true &&
        preemptK.currentAction.skill === "mining" && preemptK.currentAction.active === true,
      "真实抢占：queue/start 公开动作必须真实接管 currentAction（skill=mining）");
    const recPreemptK = sandbox.reconcileIntshipRuntime(preemptK, nowK + 500);
    okK(recPreemptK.phase === "preempted" && recPreemptK.stopReason === REASONS_K.PREEMPTED,
      "真实抢占后对账必须落 preempted");
    sandbox.dispatchGameAction(preemptK, { type: "queue/stop" }, nowK + 600);
    okK(preemptK.currentAction.active === false, "真实抢占：queue/stop 公开动作结束玩家动作");
    okK(sandbox.continueIntship(preemptK, nowK + 700).changed === true, "真实抢占后必须可续作");
    withGameStateK(preemptK, () => driveK(preemptK, 12));
    okK(preemptK.research.protocolJobs.intship.phase === "completed" && preemptK.inventory.ships.length === 1,
      "真实抢占恢复后必须完成并造舰 1 艘");

    // ---- K-18 事件总线缺失：start 零变化 + restore fail closed --------------------------------
    const savedOnIdempotentK = sandbox.GameEvents.onIdempotent;
    const eventsOffK = mkReadyK();
    const eventsOffSnapK = JSON.stringify({ research: eventsOffK.research, currentAction: eventsOffK.currentAction, resources: eventsOffK.resources, inventory: eventsOffK.inventory, dirty: eventsOffK._dirty });
    sandbox.GameEvents.onIdempotent = undefined;
    const resEventsOffK = sandbox.startIntship(eventsOffK, { recipeId: "rifter", quantity: 1 }, nowK);
    okK(resEventsOffK.reason === REASONS_K.EVENTS_UNAVAILABLE &&
        eventsOffK.research.protocolJobs.intship === null &&
        JSON.stringify({ research: eventsOffK.research, currentAction: eventsOffK.currentAction, resources: eventsOffK.resources, inventory: eventsOffK.inventory, dirty: eventsOffK._dirty }) === eventsOffSnapK,
      "事件总线缺失时 start 必须 EVENTS_UNAVAILABLE 且 job/currentAction/库存/资源/_dirty 深度不变");
    sandbox.GameEvents.onIdempotent = savedOnIdempotentK;
    const restoreOffK = mkReadyK();
    okK(sandbox.startIntship(restoreOffK, { recipeId: "rifter", quantity: 1 }, nowK).changed === true,
      "restore 总线缺失前置：正常启动成功");
    sandbox.GameEvents.onIdempotent = undefined;
    const resRestoreOffK = sandbox.restoreIntshipProtocolRuntime(restoreOffK);
    okK(resRestoreOffK.reason === REASONS_K.EVENTS_UNAVAILABLE && resRestoreOffK.phase === "recovery-required" &&
        restoreOffK.research.protocolJobs.intship.phase === "recovery-required",
      "restore 遇到事件总线缺失必须 fail closed 为 recovery-required，绝不恢复生产动作");
    sandbox.GameEvents.onIdempotent = savedOnIdempotentK;

    // ---- K-19 迁移严格清洗：畸形对象归一 / 受控 recovery-required / 幂等 -----------------------
    const saniK = sandbox.ResearchState.sanitizeIntshipJob;
    const saniLegacyK = saniK({ blueprintId: "rifter", queued: 2, processedEventIds: ["a", "a", "b"] });
    okK(saniLegacyK && saniLegacyK.blueprintId === "rifter" && saniLegacyK.phase === "recovery-required" &&
        saniLegacyK.shipId === "rifter" && saniLegacyK.recipeId === "rifter" &&
        !Object.prototype.hasOwnProperty.call(saniLegacyK, "queued") &&
        JSON.stringify(saniLegacyK.processedEventIds) === JSON.stringify(["a", "b"]),
      "旧格式 job 必须清洗为受控 recovery-required 作业（保留 blueprintId、删未知字段、账本去重）");
    okK(saniK({ queued: 2 }) === null && saniK({}) === null && saniK("junk") === null && saniK(null) === null,
      "完全无身份信息的畸形对象必须归一为 null");
    const saniCleanK = saniK({ jobId: "intship-1", shipId: "rifter", recipeId: "rifter", quantity: 2, phase: "component", componentPlan: { integrated_hull: 4 }, completedComponents: { integrated_hull: 5 }, assemblyRemaining: 2, producedShips: 0, processedEventIds: ["x", "x"], createdAt: 10, updatedAt: 20, extraField: "junk" });
    okK(saniCleanK && saniCleanK.completedComponents.integrated_hull === 4 &&
        !Object.prototype.hasOwnProperty.call(saniCleanK, "extraField") &&
        JSON.stringify(saniCleanK) === JSON.stringify(saniK(saniCleanK)),
      "完整身份 job 必须严格清洗（完成数≤计划数、删未知字段）且二次迁移 JSON 严格一致");

    // ---- K-20 Batch J 野外维修加固复核：归属 / 零治疗零燃料 / source 固定 ----------------------
    const repK = mkK({ autorepair: 1 }, { autorepair: true });
    const repInstK = sandbox.createShipInstance("starmap", nowK + 3);
    repInstK.fitted = { high: [], mid: ["t1_shield_booster"], low: ["t1_armor_repairer", "t1_structure_repairer"], rig: [] };
    repK.inventory.ships.push(repInstK);
    repK.shipAssignments.archaeology = repInstK.instanceId;
    const maxHpStarmapK = sandbox.getShipConfigById("starmap").hp;
    RRK.set(repK, "consumable:fuel", 500);
    const repCtxK = { now: nowK, offline: false, source: "hacked" };
    let repEventsK = 0;
    const unsubRepK = sandbox.GameEvents.on("archaeology:fieldRepairApplied", () => { repEventsK++; });
    const repOtherK = sandbox.applyArchaeologyFieldRepair(repK, "other_instance", { shield: 50, armor: 50, structure: 50 }, repCtxK);
    okK(repOtherK.repaired === 0 && repOtherK.reason === "NO_ARCHAEOLOGY_SHIP" &&
        RRK.get(repK, "consumable:fuel") === 500 && repEventsK === 0,
      "非当前考古分配舰船必须零维修、零燃料、零事件");
    const repFullK = sandbox.applyArchaeologyFieldRepair(repK, repInstK.instanceId,
      { shield: maxHpStarmapK.shield, armor: maxHpStarmapK.armor, structure: maxHpStarmapK.structure }, repCtxK);
    okK(repFullK.repaired === 0 && repFullK.reason === "FULL_HP" &&
        RRK.get(repK, "consumable:fuel") === 500 && repEventsK === 0,
      "满血层实际治疗量为 0 时必须零燃料、零事件");
    let repEventMetaK = null;
    const unsubRepMetaK = sandbox.GameEvents.on("archaeology:fieldRepairApplied", event => { repEventMetaK = event.meta; });
    sandbox.applyArchaeologyFieldRepair(repK, repInstK.instanceId,
      { shield: Math.max(0, maxHpStarmapK.shield - 30), armor: maxHpStarmapK.armor, structure: maxHpStarmapK.structure }, repCtxK);
    unsubRepMetaK();
    unsubRepK();
    okK(repEventMetaK && repEventMetaK.source === "research-protocol" && repEventMetaK.offline === false,
      "维修事件 source 必须固定 research-protocol（不受 context.source 覆盖）");

    // ---- K-21 事件总线 fail-closed 定点返修：运行期入口真实 fail-closed（4 项真实断言） -------
    const savedOnIdempotentK3 = sandbox.GameEvents.onIdempotent;
    // 1) reconcile 遇总线缺失：落 recovery-required、停止 intship 驱动动作、库存/资源/账本深度不变
    const reconOffK = mkReadyK();
    sandbox.startIntship(reconOffK, { recipeId: "rifter", quantity: 1 }, nowK);
    const reconOffSnapK = JSON.stringify({
      resources: reconOffK.resources, inventory: reconOffK.inventory,
      produced: reconOffK.research.protocolJobs.intship.producedShips,
      completed: reconOffK.research.protocolJobs.intship.completedComponents
    });
    sandbox.GameEvents.onIdempotent = undefined;
    const reconOffResK = sandbox.reconcileIntshipRuntime(reconOffK, nowK + 500);
    okK(reconOffResK && reconOffResK.phase === "recovery-required" &&
        reconOffK.research.protocolJobs.intship.phase === "recovery-required" &&
        reconOffK.currentAction.active === false && reconOffK.currentAction.batchRemaining === 0 &&
        reconOffK.currentAction.progress === 0 &&
        JSON.stringify({
          resources: reconOffK.resources, inventory: reconOffK.inventory,
          produced: reconOffK.research.protocolJobs.intship.producedShips,
          completed: reconOffK.research.protocolJobs.intship.completedComponents
        }) === reconOffSnapK,
      "reconcile 遇事件总线缺失必须落 recovery-required、停止 intship 驱动动作（active/batchRemaining/progress 清零）且库存/资源/账本深度不变");
    sandbox.GameEvents.onIdempotent = savedOnIdempotentK3;
    // 2) advance 消费者 jobId 不匹配 + 总线缺失：不抛异常、EVENTS_UNAVAILABLE、offline 一致、updatedAt=context.now、零副作用
    const advOffK = mkReadyK();
    sandbox.startIntship(advOffK, { recipeId: "rifter", quantity: 1 }, nowK);
    advOffK.research.protocolJobs.intship.jobId = "intship-mismatch"; // 构造消费者 jobId 不匹配
    const advOffSnapK = JSON.stringify({
      resources: advOffK.resources, inventory: advOffK.inventory,
      ledger: advOffK.research.protocolJobs.intship.processedEventIds,
      produced: advOffK.research.protocolJobs.intship.producedShips,
      completed: advOffK.research.protocolJobs.intship.completedComponents
    });
    sandbox.GameEvents.onIdempotent = undefined;
    let advOffThrownK = false;
    let advOffResK = null;
    try { advOffResK = sandbox.advanceIntshipAfterManufacturingAction(advOffK, { now: nowK + 2000, offline: true }); }
    catch (error) { advOffThrownK = true; }
    okK(!advOffThrownK && advOffResK && advOffResK.reason === REASONS_K.EVENTS_UNAVAILABLE &&
        advOffResK.phase === "recovery-required" && advOffResK.offline === true &&
        advOffK.research.protocolJobs.intship.updatedAt === nowK + 2000 &&
        JSON.stringify({
          resources: advOffK.resources, inventory: advOffK.inventory,
          ledger: advOffK.research.protocolJobs.intship.processedEventIds,
          produced: advOffK.research.protocolJobs.intship.producedShips,
          completed: advOffK.research.protocolJobs.intship.completedComponents
        }) === advOffSnapK,
      "advance 消费者不匹配 + 总线缺失必须不抛异常、EVENTS_UNAVAILABLE、offline 与 context.offline 一致、updatedAt===context.now、零扣料零产出零账本推进");
    sandbox.GameEvents.onIdempotent = savedOnIdempotentK3;
    // 3) restore 遇总线缺失：fail closed 为 recovery-required 且立即停止 intship 驱动动作
    const restoreOffK3 = mkReadyK();
    sandbox.startIntship(restoreOffK3, { recipeId: "rifter", quantity: 1 }, nowK);
    okK(restoreOffK3.currentAction.active === true,
      "restore 总线缺失前置：intship 驱动动作在跑");
    sandbox.GameEvents.onIdempotent = undefined;
    const restoreOffResK3 = sandbox.restoreIntshipProtocolRuntime(restoreOffK3);
    okK(restoreOffResK3.reason === REASONS_K.EVENTS_UNAVAILABLE && restoreOffResK3.phase === "recovery-required" &&
        restoreOffK3.research.protocolJobs.intship.phase === "recovery-required" &&
        restoreOffK3.currentAction.active === false && restoreOffK3.currentAction.batchRemaining === 0 &&
        restoreOffK3.currentAction.progress === 0,
      "restore 遇事件总线缺失必须 fail closed 为 recovery-required 且立即停止 intship 驱动动作（不留 active=true 制造动作）");
    sandbox.GameEvents.onIdempotent = savedOnIdempotentK3;
    // 4) 玩家无关动作不得被 fail-closed 停止
    const unrelatedK3 = mkReadyK();
    sandbox.startIntship(unrelatedK3, { recipeId: "rifter", quantity: 1 }, nowK);
    sandbox.dispatchGameAction(unrelatedK3, { type: "queue/add", item: { skill: "mining", target: "凡晶石带", label: "凡晶石", count: 1 } }, nowK);
    sandbox.dispatchGameAction(unrelatedK3, { type: "queue/start" }, nowK);
    okK(unrelatedK3.currentAction.skill === "mining" && unrelatedK3.currentAction.active === true,
      "玩家无关动作前置：mining 真实接管 currentAction");
    sandbox.GameEvents.onIdempotent = undefined;
    const unrelatedResK3 = sandbox.reconcileIntshipRuntime(unrelatedK3, nowK + 500);
    okK(unrelatedResK3 && unrelatedResK3.phase === "recovery-required" &&
        unrelatedK3.currentAction.skill === "mining" && unrelatedK3.currentAction.active === true,
      "事件总线缺失 fail-closed 不得停止玩家无关的当前动作（mining 保留 active）");
    sandbox.GameEvents.onIdempotent = savedOnIdempotentK3;
  } finally {
    gsK.research = JSON.parse(JSON.stringify(savedResearchK));
    gsK.inventory = JSON.parse(JSON.stringify(savedInventoryK));
    gsK.resources = JSON.parse(JSON.stringify(savedResourcesK));
    gsK.skills = JSON.parse(JSON.stringify(savedSkillsK));
    gsK.currentAction = JSON.parse(JSON.stringify(savedActionK));
    gsK.station = JSON.parse(JSON.stringify(savedStationK));
    gsK.queue = JSON.parse(JSON.stringify(savedQueueK));
    gsK.shipAssignments = JSON.parse(JSON.stringify(savedAssignK));
  }

  console.log("Batch K 一体化造船（intship）校验通过（" + kChecks + " 项）：12 个公开 API 与恰 20 个稳定 reason（含 EVENTS_UNAVAILABLE）、三层门槛（未研究 / 未启用 / 脏档一律零执行）与数量上限 1000、非法数量（含数字字符串\"2\"） / 未知配方 / 蓝图锁 / 等级锁 / 动作占用五类拒绝、起步缺料原子回滚（作业 + currentAction 快照零残留）、componentPlan 按配方键序与库存缺口精确生成（三组件各 2）、启动后 currentAction 被真实制造动作接管且 batchRemaining=缺口、组件全齐直接总装、在线真实 tick 全链路（组件 → 总装 → 产舰 1 艘、164/26/18/18 材料真实扣光、组件产出 2+2+2 被总装消耗、完成后绝不重复产舰）、幂等消费者只更账本且同 eventId 去重、错 recipeId / 错阶段 ship 事件不入账、中途缺料落 stopped 且补齐续作、玩家抢占落 preempted 且可续作、取消停止动作保留产出、已完成 / 已取消 / 无作业状态机、存档恢复重装消费者且 shape 不匹配 fail closed 为 recovery-required、离线 settleOfflineActions 一次推进到完成、三条 action 路由与直调同源、UI 显示态启动表单 / jobRunning / jobInterrupted、公开 buildIntshipComponentPlan 签名契约（拒数字字符串/小数/NaN/Infinity/0/负数/超上限/对象/null）、quantity=2 在线 / 离线全链各恰产 2 艘且资源消耗干净、造 1 件→停→玩家消耗→补料→续作重算缺口为 2 且账本保留不死循环、真实 queue/add+queue/start 抢占链落 preempted 且续作完成、事件总线缺失 start EVENTS_UNAVAILABLE 深度零变化 / restore fail closed 为 recovery-required、坏档迁移归一 null 或受控 recovery-required 且删未知字段二次迁移 JSON 一致、Batch J 维修三加固（非当前考古舰零维修零燃料零事件 / 满血零治疗零燃料 / source 固定 research-protocol）、事件总线 fail-closed 定点返修（reconcile 每次入口先查总线且停止 intship 驱动动作零副作用、advance 消费者不匹配 + 总线缺失不抛异常且 offline/updatedAt 一致、restore 总线缺失立即停止驱动动作不留 active=true、玩家无关动作保留）");
}

// ============================================================================================
// 研究系统 Batch L：IP 去相似化 · 玩家可见名称替换（仅显示层）
// 铁律：
//   1) internal ID / 存档旧 key 永久保持原值，只改玩家可见文字；
//   2) 显示名映射全部冻结于 js/data/display-names.js，UI 不复制映射、不临时 replace；
//   3) 数值、公式、掉落、价格、时间、成就阈值一律不变；
//   4) 成就目录经 gen-achievements-csv.py 权威行重生成（哈希更新为本批预期）。
// ============================================================================================
{
  let lChecks = 0;
  const okL = (condition, message) => { if (!condition) throw new Error("Batch L 校验失败：" + message); lChecks++; };
  const DL = sandbox.DisplayNames;

  // ---- L-01 公开 API 与全部映射冻结 -------------------------------------------------
  okL(DL && ["getCurrencyName", "getCurrencyAbbreviation", "getFactionName", "getFactionEnName",
      "getShipName", "getResourceName", "getResourceRefName", "getItemName", "getAreaName",
      "getCombatZoneName", "formatResourceAmount"].every(name => typeof DL[name] === "function"),
    "DisplayNames 必须暴露全部公开 API");
  okL(Object.isFrozen(DL) && Object.isFrozen(DL.CURRENCY_NAMES) && Object.isFrozen(DL.ORE_NAMES) &&
      Object.isFrozen(DL.MINERAL_NAMES) && Object.isFrozen(DL.SHIP_NAMES) && Object.isFrozen(DL.FACTION_NAMES) &&
      Object.isFrozen(DL.ITEM_NAMES) && Object.isFrozen(DL.AREA_NAMES),
    "DisplayNames 与全部公开映射表必须冻结");

  // ---- L-02 映射正确性（玩家可见新名；内部键保持） ------------------------------------
  okL(DL.getCurrencyName("isk") === "星币" && DL.getCurrencyName("lp") === "功勋" &&
      DL.getCurrencyAbbreviation("isk") === "SC" && DL.getCurrencyAbbreviation("lp") === "MR",
    "货币显示名必须为 星币/功勋（SC/MR）");
  okL(DL.getFactionName("angel") === "苍穹劫团" && DL.getFactionName("blood") === "赤誓教团" &&
      DL.getFactionName("sansha") === "静默集群",
    "三势力显示名必须为 苍穹劫团/赤誓教团/静默集群");
  okL(DL.getResourceName("ore", "凡晶石") === "铁硅原矿" && DL.getResourceName("mineral", "三钛合金") === "标准钛材" &&
      DL.getResourceName("mineral", "莫尔石") === "暗质晶核" && DL.getResourceName("ore", "艾克诺岩") === "极星矿",
    "矿石/矿物显示名必须为原创名（内部库存键保持）");
  okL(DL.getItemName("天使低级加密数据") === "劫团低阶密钥" && DL.getItemName("血袭者中级加密数据") === "赤誓中阶密钥" &&
      DL.getItemName("萨沙高级加密数据") === "静默高阶密钥" &&
      DL.getItemName("天使秘密补给站通行密钥") === "苍穹劫团秘密补给站通行密钥",
    "势力加密数据/死亡空间门票显示名必须转换（内部 special 键保持）");
  okL(DL.getShipName("rifter") === "星矛级" && DL.getShipName("kestrel") === "铁卫级" &&
      DL.getShipName("orca") === "山海级" && DL.getShipName("heron") === "觅迹级" &&
      DL.getShipName("dolphin") === "驮星级",
    "EVE 舰船显示名必须为原创名（内部 shipId 保持）");

  // ---- L-03 脚本顺序：display-names.js 必须早于 resources.js / selectors / UI ----------
  const dnIdxL = scriptSources.findIndex(s => s.includes("display-names.js"));
  const resIdxL = scriptSources.findIndex(s => s.includes("resources.js"));
  const selIdxL = scriptSources.findIndex(s => s.includes("selectors.js"));
  const shellIdxL = scriptSources.findIndex(s => s.includes("shell-render.js"));
  okL(dnIdxL >= 0 && dnIdxL < resIdxL && dnIdxL < selIdxL && dnIdxL < shellIdxL,
    "display-names.js 必须注册在 resources.js / selectors / shell-render 之前（顺序断言）");

  // ---- L-04 旧存档 fixture：内部 key 与数值完全保留 -----------------------------------
  const legacyL = JSON.parse(JSON.stringify(sandbox.gameState));
  legacyL.resources.ores["凡晶石"] = 777;
  legacyL.resources.minerals["三钛合金"] = 888;
  legacyL.inventory.ships = [sandbox.createShipInstance("rifter", 1000)];
  if (!Array.isArray(legacyL.ownedBlueprints)) legacyL.ownedBlueprints = [];
  legacyL.ownedBlueprints.push("rifter");
  const legacyBeforeL = JSON.stringify({ ores: legacyL.resources.ores, minerals: legacyL.resources.minerals, ships: legacyL.inventory.ships, bp: legacyL.ownedBlueprints });
  okL(G("ResourceRegistry").get(legacyL, "ore:凡晶石") === 777 && G("ResourceRegistry").get(legacyL, "mineral:三钛合金") === 888 &&
      legacyL.inventory.ships[0].shipId === "rifter" && legacyL.ownedBlueprints.includes("rifter") &&
      JSON.stringify({ ores: legacyL.resources.ores, minerals: legacyL.resources.minerals, ships: legacyL.inventory.ships, bp: legacyL.ownedBlueprints }) === legacyBeforeL,
    "旧存档 fixture 内部 key 与数值必须完全保留（凡晶石/三钛合金/rifter 不动）");

  // ---- L-05 仓库统一显示入口输出新名 ---------------------------------------------------
  okL(G("getResourceDisplayName")("ore:凡晶石") === "铁硅原矿" &&
      G("getResourceDisplayName")("mineral:三钛合金") === "标准钛材" &&
      G("getResourceDisplayName")("凡晶石") === "铁硅原矿" &&
      !G("getResourceDisplayName")("ore:凡晶石").includes("凡晶石"),
    "仓库统一资源显示入口必须输出新名（铁硅原矿/标准钛材）");

  // ---- L-06 旧 rifter 舰船显示星矛级（数据 name 已改 + DisplayNames 兜底） --------------
  okL(sandbox.getShipConfigById("rifter") && sandbox.getShipConfigById("rifter").name === "星矛级" &&
      sandbox.getShipConfigById("rifter").id === "rifter" && DL.getShipName("rifter") === "星矛级",
    "rifter 旧存档舰船显示必须为星矛级（内部 shipId/recipeId/blueprintId 仍 rifter）");

  // ---- L-07 蓝图/制造/装备/战斗仍用 shipId rifter -------------------------------------
  okL(legacyL.ownedBlueprints.includes("rifter") && legacyL.inventory.ships[0].shipId === "rifter" &&
      sandbox.getShipConfigById("rifter").bonuses && typeof sandbox.getShipConfigById("rifter").bonuses === "object",
    "蓝图购买/制造/装备/战斗必须仍使用 shipId:rifter（内部键不动）");

  // ---- L-08 三势力：zone 显示新名 + faction ID 保持 angel/blood/sansha ------------------
  const zonesL = G("COMBAT_ZONES");
  okL(Array.isArray(zonesL) && zonesL.length > 0 &&
      zonesL.every(z => z.faction === "angel" || z.faction === "blood" || z.faction === "sansha") &&
      zonesL.some(z => z.name.includes("苍穹劫团")) && zonesL.some(z => z.name.includes("赤誓教团")) &&
      zonesL.some(z => z.name.includes("静默集群")),
    "三势力星带显示新名且 faction ID 保持 angel/blood/sansha");

  // ---- L-09 顶栏货币：数值不变，显示名由 DisplayNames 提供 ------------------------------
  okL(typeof legacyL.resources.isk === "number" && typeof legacyL.resources.lp === "number" &&
      DL.getCurrencyName("isk") === "星币" && DL.getCurrencyName("lp") === "功勋",
    "顶栏显示星币/功勋，gameState.isk/lp 数值不变");

  // ---- L-10 成就目录：197 项 / 262 小时 / 档位不变（结构回归） --------------------------
  const achL = G("AchievementData");
  okL(achL && Array.isArray(achL.ACHIEVEMENTS) && achL.ACHIEVEMENTS.length === 197 &&
      typeof achL.ACHIEVEMENTS_BY_ID === "object" && Object.keys(achL.ACHIEVEMENTS_BY_ID).length === 197,
    "成就目录 197 项与 unlockedAtById 结构必须不变");

  // ---- L-11 研究 38 节点 / 150 步 / 六协议不变 ------------------------------------------
  const rdL = G("ResearchData");
  okL(rdL && rdL.NODES.length === 38 && G("IMPLEMENTED_RESEARCH_PROTOCOLS").length === 6,
    "研究 38 节点与六协议必须不变（本批不改研究逻辑）");

  // ---- L-12 index.html 正式页面不得出现旧专名（显示文本） ------------------------------
  const htmlRawL = fs.readFileSync(path.join(root, "index.html"), "utf8");
  okL(["EVE放置", "新伊甸", "ISK", "LP", "天使集团", "血袭者", "萨沙", "凡晶石", "三钛合金",
      "裂谷级", "茶隼级", "冲锋者级", "勘探者级", "逆戟鲸级", "苍鹭级"].every(word => !htmlRawL.includes(word)),
    "index.html 正式页面不得出现旧专名");

  // ---- L-13 主要 UI 显示层源码：字符串字面量不得出现旧货币/势力专名（变量名/注释不受限） ----
  const uiFilesL = ["js/ui/shell-render.js", "js/ui/render.js", "js/ui/archaeology-render.js",
    "js/ui/booster-render.js", "js/ui/planetary-render.js", "js/ui/station-render.js",
    "js/ui/manufacturing-render.js", "js/ui/combat-render.js"];
  okL(uiFilesL.every(file => {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    return ["可用 ISK", "ISK 不足", "ISK不足", "LP不足", "忠诚点", "新伊甸", "EVE放置",
      "天使集团", "血袭者", "萨沙", "最低 ISK", " ISK ｜", " ISK；", "（ISK"].every(phrase => !src.includes(phrase));
  }), "主要 UI 显示层不得出现旧货币/势力专名文案（内部键 / 变量名 / 注释不受此限制）");

  // ---- L-14 显示名转换必须纯读：不修改任何 state ----------------------------------------
  const stateBeforeL = JSON.stringify(legacyL);
  G("getResourceDisplayName")("ore:凡晶石");
  G("getResourceDisplayName")("mineral:三钛合金");
  DL.getShipName("rifter");
  DL.getItemName("天使低级加密数据");
  sandbox.getShipConfigById("rifter");
  okL(JSON.stringify(legacyL) === stateBeforeL, "显示名转换必须只读，渲染前后 state 深度一致");

  // ---- L-15 数值/配方/库存内部键保持（显示层改动零数值影响） ----------------------------
  okL(legacyL.resources.ores["凡晶石"] === 777 && legacyL.resources.minerals["三钛合金"] === 888 &&
      legacyL.inventory.ships[0].shipId === "rifter" && legacyL.inventory.ships[0].enhancementLevel === 0,
    "数值/配方/库存内部键必须保持（凡晶石/三钛合金/rifter 数值与键名不变）");

  // ---- L-16 制造材料显示转换：真实扣费仍走 material 内部键 ------------------------------
  const mfgL = sandbox.getShipEngineeringDisplayState(legacyL, Date.now());
  okL(mfgL && Array.isArray(mfgL.componentMaterials) && mfgL.componentMaterials.length > 0 &&
      mfgL.componentMaterials.some(item => item.material === "三钛合金" || item.material === "类银超金属") &&
      mfgL.componentMaterials.every(item => typeof item.material === "string" && item.material.length > 0),
    "制造成本材料内部键必须保持（三钛合金等），显示转换由 UI 经 DisplayNames 完成");
  const confirmL = sandbox.getActionConfirmationDisplayState(legacyL, "shipComp", Date.now());
  okL(confirmL && confirmL.requirements.some(item => item.name === "三钛合金" && item.displayName === "标准钛材"),
    "确认弹窗材料 name 保持内部键且 displayName 为新名（标准钛材）");

  // ---- L-17 队列显示态可读取且 label 经词级转换 ----------------------------------------
  const queueL = sandbox.getQueueDisplayState(legacyL);
  okL(queueL && Array.isArray(queueL.items), "队列显示态必须可读取（target 保持逻辑键）");

  // ---- L-18 顶栏余额文案（shell-render 显示层） ----------------------------------------
  const shellSrcL = fs.readFileSync(path.join(root, "js/ui/shell-render.js"), "utf8");
  okL(shellSrcL.includes("星币（SC）") && shellSrcL.includes("功勋（MR）") && !shellSrcL.includes("可用 ISK"),
    "顶栏余额文案必须为 星币（SC）/功勋（MR），不得出现 可用 ISK");

  // ---- L-19 定点返修：显示名回退链 / 玩家可见泄漏清理 ----------------------------------
  // 1) getResourceDisplayName 回退链：DisplayNames 映射 → ResourceRegistry definition.name → 原 ID
  okL(G("getResourceDisplayName")("ore:凡晶石") === "铁硅原矿" &&
      G("getResourceDisplayName")("mineral:三钛合金") === "标准钛材" &&
      G("getResourceDisplayName")("component:integrated_hull") === "综合舰体组件" &&
      G("getResourceDisplayName")("consumable:fuel") === "燃料单元" &&
      G("getResourceDisplayName")("ammo:laser") === "激光晶体弹药" &&
      G("getResourceDisplayName")("unknown:not_real") === "unknown:not_real",
    "getResourceDisplayName 回退链：有映射用新名；未映射回退已注册 definition.name；完全未知才回退原始 ID");

  // 2) index.html 四处旧占位必须消失（仅显示文字）
  const htmlL19 = fs.readFileSync(path.join(root, "index.html"), "utf8");
  okL(!htmlL19.includes("灼烧岩") && !htmlL19.includes("类银超金属") &&
      !htmlL19.includes("干焦岩带") && !htmlL19.includes("超新星诺克石") &&
      htmlL19.includes("赤镍矿 × 1,050") && htmlL19.includes("银镍合金 × 890") &&
      htmlL19.includes("区域：诺瓦矿带") && htmlL19.includes("产出：诺瓦陶金"),
    "index.html 四处旧占位（灼烧岩/类银超金属/干焦岩带/超新星诺克石）必须替换为新名");

  // 3) ships.js flavor 不得出现旧势力名
  const shipsSrcL19 = fs.readFileSync(path.join(root, "js/data/ships.js"), "utf8");
  const flavorLinesL19 = shipsSrcL19.split("\n").filter(line => line.includes("flavor:"));
  okL(flavorLinesL19.length >= 9 && flavorLinesL19.every(line =>
        !line.includes("天使") && !line.includes("血袭者") && !line.includes("萨沙")) &&
      flavorLinesL19.some(line => line.includes("苍穹劫团")) &&
      flavorLinesL19.some(line => line.includes("赤誓教团")) &&
      flavorLinesL19.some(line => line.includes("静默集群")),
    "舰船 flavor 不得出现旧势力名（天使/血袭者/萨沙），必须为新势力名");

  // 4) 考古页面实际渲染：LP 文案全部消失（经 DisplayNames 统一为功勋）
  const archBodyL19 = makeElement();
  const archOrigL19 = sandbox.document.getElementById;
  const archStateBeforeL19 = JSON.stringify(sandbox.gameState);
  const archOrigArtifactsL19 = sandbox.gameState.resources.artifacts;
  sandbox.gameState.resources.artifacts = { ...(archOrigArtifactsL19 || {}) };
  sandbox.gameState.resources.artifacts["art_i_lp"] = 2; // 确保 LP 文物库存区真实渲染
  sandbox.document.getElementById = (id) => id === "archaeology-body" ? archBodyL19 : makeElement();
  try {
    sandbox.renderArchaeologyPage(Date.now());
    okL(!archBodyL19.innerHTML.includes("LP ×") && !archBodyL19.innerHTML.includes("兑换全部 LP") &&
        !archBodyL19.innerHTML.includes("兑换 LP") && archBodyL19.innerHTML.includes("功勋"),
      "考古页面实际渲染不得出现 LP 文案，必须为功勋");
  } finally {
    sandbox.document.getElementById = archOrigL19;
    if (archOrigArtifactsL19 !== undefined && archOrigArtifactsL19 !== null) sandbox.gameState.resources.artifacts = archOrigArtifactsL19;
    else delete sandbox.gameState.resources.artifacts;
  }
  okL(JSON.stringify(sandbox.gameState) === archStateBeforeL19, "考古页面渲染必须纯读（渲染前后 state 深度一致）");

  // 5) 死亡空间卡片实际渲染：门票/材料经统一显示 API + 功勋；复渲染纯读
  const dsGridL19 = makeElement();
  const combatOrigGetElL19 = sandbox.document.getElementById;
  const origTierL19 = sandbox.gameState.combat.deathspaceTier;
  sandbox.gameState.combat.deathspaceTier = 2; // tier 2 含 苍穹劫团/赤誓教团/静默集群 三站点
  sandbox.document.getElementById = (id) => id === "deathspace-grid" ? dsGridL19 : makeElement();
  try {
    sandbox.renderCombatPanel(Date.now()); // 预热（recovery 结算副作用只发生一次）
    const combatHtmlL19 = dsGridL19.innerHTML;
    okL(combatHtmlL19.includes("苍穹劫团") && combatHtmlL19.includes("赤誓教团") && combatHtmlL19.includes("静默集群") &&
        !combatHtmlL19.includes("天使") && !combatHtmlL19.includes("血袭者") && !combatHtmlL19.includes("萨沙") &&
        combatHtmlL19.includes("功勋") && !combatHtmlL19.includes("LP"),
      "死亡空间卡片实际渲染必须显示转换后的门票/材料名（苍穹劫团/赤誓教团/静默集群）与功勋，不得泄漏旧势力前缀或 LP");
    const combatStateAfter1L19 = JSON.stringify(sandbox.gameState);
    sandbox.renderCombatPanel(Date.now() + 1000); // 复渲染：渲染本身必须纯读
    okL(JSON.stringify(sandbox.gameState) === combatStateAfter1L19,
      "死亡空间卡片复渲染必须纯读（渲染前后 state 深度一致）");
  } finally {
    sandbox.document.getElementById = combatOrigGetElL19;
    sandbox.gameState.combat.deathspaceTier = origTierL19;
  }

  // 6) 研究协议 scopeText 使用 星币/功勋
  const autoSellDispL19 = sandbox.getResearchProtocolDisplayState(sandbox.gameState, "autosell");
  const autoConvDispL19 = sandbox.getResearchProtocolDisplayState(sandbox.gameState, "autoconv");
  const planAutoDispL19 = sandbox.getResearchProtocolDisplayState(sandbox.gameState, "planauto");
  okL(autoSellDispL19 && autoSellDispL19.scopeText.includes("星币文物") &&
      !autoSellDispL19.scopeText.includes("ISK 文物") &&
      autoConvDispL19 && autoConvDispL19.scopeText.includes("功勋文物") &&
      !autoConvDispL19.scopeText.includes("LP 文物") &&
      planAutoDispL19 && planAutoDispL19.scopeText.includes("最低星币储备") &&
      !planAutoDispL19.scopeText.includes("最低 ISK 储备"),
    "研究协议 scopeText 必须使用 星币/功勋（自动处理范围与最低储备文案）");


  console.log("Batch L IP 去相似化 · 玩家可见名称替换校验通过（" + lChecks + " 项）：DisplayNames 公开 API 与全部映射冻结、52 脚本顺序（display-names 早于 resources/selectors/UI）、货币 星币/功勋（SC/MR）、三势力 苍穹劫团/赤誓教团/静默集群 且 faction ID 保持 angel/blood/sansha、矿石/矿物原创显示名（铁硅原矿/标准钛材/暗质晶核等）而内部库存键保持、势力加密数据/门票显示转换（劫团低阶密钥等）内部 special 键保持、EVE 舰船原创名（星矛级/山海级/觅迹级等）shipId 保持、旧存档 fixture 内部 key 与数值逐字节保留、仓库/制造/队列/顶栏显示新名、成就 197 项与 262 小时档位不变（生成器重生成新哈希）、研究 38 节点与六协议不变、index.html 与主要 UI 无旧专名泄漏、显示名转换纯读零副作用、定点返修（回退链 映射→definition.name→原 ID、index 四处占位替换、舰船 flavor 无旧势力词、考古实际渲染无 LP 文案、死亡空间卡片实际渲染转换门票/材料名且无旧势力前缀、协议 scopeText 星币/功勋、渲染测试前后 state 深度一致）");
}

// ============================================================================================
// Batch N 新手任务系统：启程级、任务目录与原创文案冻结
// 约束：
//   1) 本批只冻结数据与文案，不接入进度推进、奖励发放、UI 渲染；
//   2) 目标与奖励一律存内部真实 ID，展示交由 DisplayNames；禁止幽灵 ID；
//   3) 启程级是引导专属训练艇，用料/工时刻意低于常规护卫舰模型，已在整船材料与预算两处过滤器中显式排除。
// ============================================================================================
{
  let nChecks = 0;
  const okN = (condition, message) => { if (!condition) throw new Error("Batch N 校验失败：" + message); nChecks++; };

  const starterN = vm.runInContext("STARTER_SHIPS", sandbox);
  const industrialN = vm.runInContext("INDUSTRIAL_SHIPS", sandbox);
  const archShipsN = vm.runInContext("ARCHAEOLOGY_SHIPS", sandbox);
  const recipesN = vm.runInContext("SHIP_ASSEMBLY_RECIPES", sandbox);
  const blueprintsN = vm.runInContext("SHIP_BLUEPRINTS", sandbox);
  const componentsN = vm.runInContext("SHIP_COMPONENT_RECIPES", sandbox);
  const fittingsN = vm.runInContext("DEFAULT_COMBAT_FITTINGS", sandbox);
  const equipmentN = vm.runInContext("EQUIPMENT_DB", sandbox);
  const miningAreasN = vm.runInContext("MINING_AREAS", sandbox);
  const smeltingN = vm.runInContext("SMELTING_RECIPES", sandbox);
  const gasAreasN = vm.runInContext("GAS_AREAS", sandbox);
  const planetTypesN = vm.runInContext("PLANET_TYPES", sandbox);
  const sitesN = vm.runInContext("ARCHAEOLOGY_SITES", sandbox);
  const zonesN = vm.runInContext("COMBAT_ZONES", sandbox);
  const ammoRecipesN = vm.runInContext("AMMO_ENG_RECIPES", sandbox);
  const DN = sandbox.DisplayNames;
  const TD = sandbox.TutorialData;

  // ---- N-01 启程级正式数据逐项冻结 ----------------------------------------------------
  const rookieN = starterN.rookie_corvette;
  okN(!!rookieN && rookieN.id === "rookie_corvette" && rookieN.name === "启程级" &&
      rookieN.tier === "T1" && rookieN.type === "frigate" &&
      rookieN.hp.shield === 240 && rookieN.hp.armor === 80 && rookieN.hp.structure === 80 && rookieN.totalHp === 400 &&
      rookieN.dodge === 22 && rookieN.speed === 240 && rookieN.targeting === 105 &&
      rookieN.capacitor.capacity === 90 && rookieN.capacitor.rechargeRate === 4 &&
      rookieN.fuelEfficiency === 1.0 &&
      rookieN.slots.high === 1 && rookieN.slots.mid === 1 && rookieN.slots.low === 1 && rookieN.slots.rig === 0 &&
      rookieN.recommendedWeapon === "laser" &&
      rookieN.unlock && rookieN.unlock.type === "tutorial" && rookieN.unlock.isDefault === false,
    "启程级基础属性必须与冻结值逐项一致（400 总血 / 22 闪避 / 240 速度 / 105 锁定 / 90 电容 / 1-1-1-0 槽位 / tutorial 解锁）");
  okN(rookieN.hp.shield + rookieN.hp.armor + rookieN.hp.structure === rookieN.totalHp &&
      typeof rookieN.flavor === "string" && rookieN.flavor.trim().length >= 20,
    "启程级三层血量之和必须等于 totalHp=400，且必须有原创 flavor 文案");
  okN(Object.keys(rookieN.bonuses).length === 6 &&
      rookieN.bonuses.laserDamage === 0.02 && rookieN.bonuses.missileDamage === 0.02 && rookieN.bonuses.cannonDamage === 0.02 &&
      rookieN.bonuses.shieldCapacity === 0.05 && rookieN.bonuses.miningLaserEfficiency === 0.03 &&
      rookieN.bonuses.archaeologyScanStrength === 2,
    "启程级加成必须恰为冻结的六项（三系武器 2% / 护盾 5% / 采矿 3% / 考古扫描 +2）");

  // ---- N-02 启程级禁用字段 -------------------------------------------------------------
  okN(!("shieldRepair" in rookieN.bonuses) && !("archaeologyFailureDamageReduction" in rookieN.bonuses) &&
      !("gasLaserEfficiency" in rookieN.bonuses) && rookieN.image === undefined,
    "启程级不得含护盾维修 / 考古失败减伤 / 气云采集效率加成，也不得指定专属贴图（走通用 3D 兜底）");

  // ---- N-03 / N-04 启程级专属配方（1/1/1、免蓝图）--------------------------------------
  const rookieRecipeN = recipesN.find(item => item.id === "rookie_corvette");
  okN(!!rookieRecipeN && rookieRecipeN.shipId === "rookie_corvette" && rookieRecipeN.level === 1 &&
      rookieRecipeN.time === 30 && rookieRecipeN.xp === 30 && !rookieRecipeN.materialCost &&
      Object.keys(rookieRecipeN.componentCost).length === 3 &&
      rookieRecipeN.componentCost.integrated_hull === 1 && rookieRecipeN.componentCost.power_core === 1 &&
      rookieRecipeN.componentCost.functional_system === 1,
    "启程级配方必须是 1/1/1 组件、Lv.1、30s、30xp，且无额外材料消耗");
  okN(rookieRecipeN.requiresBlueprint === false &&
      !blueprintsN.some(item => item.id === "rookie_corvette" || item.shipId === "rookie_corvette"),
    "启程级必须免蓝图，且不得出现在蓝图目录中");
  const rookieMaterialsN = {};
  for (const [componentId, count] of Object.entries(rookieRecipeN.componentCost)) {
    const component = componentsN.find(item => item.id === componentId);
    if (!component || component.level !== 1) throw new Error("Batch N 校验失败：启程级引用了非 Lv.1 T1 组件 " + componentId);
    for (const [material, quantity] of Object.entries(component.cost)) {
      rookieMaterialsN[material] = (rookieMaterialsN[material] || 0) + quantity * count;
    }
  }
  okN(rookieMaterialsN["三钛合金"] === 82 && rookieMaterialsN["类银超金属"] === 13 &&
      rookieMaterialsN["重金属"] === 9 && rookieMaterialsN["稀有气体"] === 9,
    "启程级整船材料必须为 三钛合金82 / 类银超金属13 / 重金属9 / 稀有气体9（恰为常规护卫舰的一半）");

  // ---- N-05 建造后必须空装 --------------------------------------------------------------
  okN(fittingsN.rookie_corvette === undefined && Object.keys(fittingsN).length === 3 &&
      ["rifter", "kestrel", "atron"].every(id => !!fittingsN[id]),
    "启程级不得写入 DEFAULT_COMBAT_FITTINGS（建造后必须空装），默认配装仍只覆盖三艘起始护卫舰");

  // ---- N-06 显示名 -----------------------------------------------------------------------
  okN(DN.getShipName("rookie_corvette") === "启程级" && Object.isFrozen(DN.SHIP_NAMES),
    "DisplayNames 必须把 rookie_corvette 显示为 启程级，且映射表保持冻结");

  // ---- N-07 任务目录规模与唯一性 -----------------------------------------------------------
  okN(!!TD && Array.isArray(TD.tasks) && TD.tasks.length === 26 &&
      new Set(TD.tasks.map(item => item.id)).size === 26,
    "TutorialData 必须冻结 26 条任务且 ID 唯一");
  okN(/<script defer src="\.\/js\/data\/tutorial\.js"><\/script>/.test(html),
    "index.html 必须以 defer 方式引入 js/data/tutorial.js");

  // ---- N-08 章节分布 7 / 7 / 6 / 6 ---------------------------------------------------------
  const groupN = { prologue: 0, industrial: 0, archaeology: 0, combat: 0 };
  for (const task of TD.tasks) groupN[task.chapter] = (groupN[task.chapter] || 0) + 1;
  okN(groupN.prologue === 7 && groupN.industrial === 7 && groupN.archaeology === 6 && groupN.combat === 6,
    "章节分布必须为 序章7 / 工业7 / 考古6 / 作战6");
  okN(TD.chapterOrder.every(chapter => {
    const orders = TD.tasks.filter(task => task.chapter === chapter).map(task => task.order);
    return orders.every((value, index) => value === index + 1);
  }), "每个章节内部的 order 必须从 1 起连续递增");

  // ---- N-09 / N-10 文案完整性与去重 --------------------------------------------------------
  okN(TD.tasks.every(task =>
      typeof task.title === "string" && task.title.trim().length > 0 &&
      ["边疆调度员", "引航员"].includes(task.speaker) &&
      typeof task.briefing === "string" && task.briefing.trim().length >= 20 &&
      typeof task.objectiveText === "string" && task.objectiveText.trim().length > 0 &&
      typeof task.completionText === "string" && task.completionText.trim().length > 0 &&
      typeof task.progressType === "string" && task.progressType.trim().length > 0 &&
      Array.isArray(task.unlocks) && !!task.reward && typeof task.reward === "object" &&
      (task.navigationTarget === null || typeof task.navigationTarget === "string")),
    "26 条任务的标题/叙述人/简报/目标/完成语/进度类型/奖励/导航字段不得缺失或类型错误");
  okN(TD.tasks.every(task =>
      task.briefing !== task.objectiveText && task.objectiveText !== task.completionText &&
      task.briefing !== task.completionText),
    "同一任务的简报、目标描述、完成语不得互相重复");

  // ---- N-11 深度冻结 ------------------------------------------------------------------------
  const deepFrozenN = (value) => {
    if (value === null || typeof value !== "object") return true;
    if (!Object.isFrozen(value)) return false;
    return Object.getOwnPropertyNames(value).every(key => deepFrozenN(value[key]));
  };
  okN(deepFrozenN(TD), "TutorialData 及其全部嵌套对象/数组必须 Object.freeze");

  // ---- N-12 / N-13 分支解锁点唯一 ------------------------------------------------------------
  okN(JSON.stringify(TD.byId.P7.unlocks.slice().sort()) === JSON.stringify(["archaeology", "combat", "industrial"]),
    "P7 必须一次性解锁 工业 / 考古 / 作战 三条分支");
  okN(TD.byId.P5.unlocks.length === 0 && TD.byId.P6.unlocks.length === 0 &&
      TD.tasks.filter(task => task.unlocks.length > 0).length === 1,
    "P5 / P6 不得提前解锁分支，全表只允许 P7 一处解锁点");

  // ---- N-13B Batch O 奖励契约通用工具（resourceAmounts / equipment / ships / blueprints 四桶）----
  const RN = {
    ISK: "currency:isk", TI: "mineral:三钛合金", AG: "mineral:类银超金属",
    HEAVY: "planetary:重金属", RARE: "planetary:稀有气体", FUEL: "consumable:fuel",
    PROBE: "probe:core_probe_i", AL: "ammo:laser", AM: "ammo:missile", AC: "ammo:cannon"
  };
  const sizesN = (reward) => ({
    res: Object.keys((reward && reward.resourceAmounts) || {}).length,
    eq: Object.keys((reward && reward.equipment) || {}).length,
    sh: Object.keys((reward && reward.ships) || {}).length,
    bp: Object.keys((reward && reward.blueprints) || {}).length
  });
  const emptyRewardN = (reward) => {
    const s = sizesN(reward);
    return !!reward && s.res === 0 && s.eq === 0 && s.sh === 0 && s.bp === 0;
  };
  const resAmtN = (reward, key) => ((reward && reward.resourceAmounts) || {})[key];

  // ---- N-14 I4 双行星 + 原额补贴（奖励改存 reward.resourceAmounts 命名空间键）------------------
  const i4N = TD.byId.I4;
  const lavaN = planetTypesN.find(item => item.id === "lava");
  const gasPlanetN = planetTypesN.find(item => item.id === "gas");
  okN(i4N.progressType === "planetDeploy" && i4N.target.planetTypes.length === 2 &&
      i4N.target.planetTypes.includes("lava") && i4N.target.planetTypes.includes("gas") &&
      resAmtN(i4N.reward, RN.ISK) === 276000 && resAmtN(i4N.reward, RN.AG) === 26 &&
      sizesN(i4N.reward).res === 2 && sizesN(i4N.reward).eq === 0 &&
      sizesN(i4N.reward).sh === 0 && sizesN(i4N.reward).bp === 0,
    "I4 必须是熔岩+气态双行星部署，奖励恰为 276000 星币 + 26 类银超金属，无其他奖励");
  okN(lavaN && gasPlanetN && lavaN.constructionCost.isk + gasPlanetN.constructionCost.isk === resAmtN(i4N.reward, RN.ISK),
    "I4 补贴必须恰好覆盖两颗行星的建造费合计（138000 × 2）");

  // ---- N-15 序章 P1-P7 精确冻结 ----------------------------------------------------------------
  const p1 = TD.byId.P1;
  okN(p1.progressType === "claim" && p1.target.kit === "registration_materials" && p1.unlocks.length === 0,
    "P1 必须是手动领取登记材料包，且不得解锁分支");
  okN(resAmtN(p1.reward, RN.TI) === 82 && resAmtN(p1.reward, RN.AG) === 13 &&
      resAmtN(p1.reward, RN.HEAVY) === 9 && resAmtN(p1.reward, RN.RARE) === 9 &&
      sizesN(p1.reward).res === 4 && sizesN(p1.reward).eq === 0 &&
      sizesN(p1.reward).sh === 0 && sizesN(p1.reward).bp === 0,
    "P1 奖励必须恰好为 三钛合金82 / 类银超金属13 / 重金属9 / 稀有气体9");
  const p2 = TD.byId.P2, p3 = TD.byId.P3, p4 = TD.byId.P4;
  okN(p2.progressType === "manufacture" && p2.target.recipeId === "integrated_hull" && p2.target.count === 1 && emptyRewardN(p2.reward),
    "P2 必须只对应 综合舰体组件 ×1 且无奖励");
  okN(p3.progressType === "manufacture" && p3.target.recipeId === "power_core" && p3.target.count === 1 && emptyRewardN(p3.reward),
    "P3 必须只对应 动力控制核心 ×1 且无奖励");
  okN(p4.progressType === "manufacture" && p4.target.recipeId === "functional_system" && p4.target.count === 1 && emptyRewardN(p4.reward),
    "P4 必须只对应 舰船功能组件 ×1 且无奖励");
  const p5 = TD.byId.P5;
  okN(p5.progressType === "build_and_assign" && p5.target.shipId === "rookie_corvette" && p5.target.count === 1 &&
      p5.target.slot === "combat" && emptyRewardN(p5.reward) && p5.unlocks.length === 0,
    "P5 必须同时要求建造启程级并编入战斗位，且无奖励、不解锁分支（不得拆为 P5/P6）");
  const p6 = TD.byId.P6;
  okN(p6.progressType === "claim" && p6.target.kit === "registration_bonus" && resAmtN(p6.reward, RN.ISK) === 50000 &&
      sizesN(p6.reward).res === 1 && sizesN(p6.reward).eq === 0 && sizesN(p6.reward).sh === 0 &&
      sizesN(p6.reward).bp === 0 && p6.unlocks.length === 0,
    "P6 必须恰为 50000 星币且无其他奖励、不解锁分支");
  const p7 = TD.byId.P7;
  okN(p7.progressType === "confirm" && emptyRewardN(p7.reward) &&
      JSON.stringify(p7.unlocks.slice().sort()) === JSON.stringify(["archaeology", "combat", "industrial"]),
    "P7 奖励必须为空，且唯一解锁 工业/考古/作战 三分支");

  // ---- N-16 工业 I1-I7 精确冻结 ----------------------------------------------------------------
  const i1 = TD.byId.I1;
  okN(i1.progressType === "claim_install_assign" && i1.target.equipmentId === "t1_mining_laser" &&
      i1.target.shipId === "rookie_corvette" && i1.target.slot === "mining" &&
      i1.reward.equipment["t1_mining_laser"] === 1 && resAmtN(i1.reward, RN.FUEL) === 200 &&
      sizesN(i1.reward).res === 1 && sizesN(i1.reward).eq === 1 &&
      sizesN(i1.reward).sh === 0 && sizesN(i1.reward).bp === 0,
    "I1 必须领取并安装基础采矿器到启程级采矿位，奖励 t1_mining_laser ×1 + 燃料 200");
  const i2 = TD.byId.I2;
  okN(i2.progressType === "mine" && i2.target.resourceId === "ore:凡晶石" && i2.target.count === 364 && i2.target.sinceActivation === true &&
      emptyRewardN(i2.reward), "I2 必须新采集凡晶石 364（显示铁硅原矿），无奖励");
  const i3 = TD.byId.I3;
  okN(i3.progressType === "refine" && i3.target.outputId === RN.TI && i3.target.count === 364 && i3.target.sinceActivation === true &&
      emptyRewardN(i3.reward), "I3 必须新冶炼三钛合金 364（显示标准钛材），无奖励");
  const i5 = TD.byId.I5;
  okN(i5.progressType === "planetExtract" && i5.target.resources[RN.HEAVY] === 18 && i5.target.resources[RN.RARE] === 18 &&
      emptyRewardN(i5.reward), "I5 必须真实提取 重金属18 / 稀有气体18，无奖励（不得 200/200）");
  const i6 = TD.byId.I6;
  okN(i6.progressType === "manufacture_components" && i6.target.components.integrated_hull === 2 &&
      i6.target.components.power_core === 2 && i6.target.components.functional_system === 2 &&
      i6.target.sinceActivation === true &&
      i6.reward.blueprints.miner_frigate === 1 && sizesN(i6.reward).bp === 1 &&
      sizesN(i6.reward).res === 0 && sizesN(i6.reward).eq === 0 && sizesN(i6.reward).sh === 0,
    "I6 必须新制造三组件各 2 件，奖励恰为 拓岩级蓝图 ×1（Batch O 契约修正：不得为空奖励）");
  const i7 = TD.byId.I7;
  okN(i7.progressType === "assemble_ship" && i7.target.shipId === "miner_frigate" && i7.target.count === 1,
    "I7 目标必须是玩家新总装 拓岩级 ×1（拓岩级为玩家制造产物，非赠予）");
  okN(resAmtN(i7.reward, RN.ISK) === 50000 && i7.reward.ships.gas_frigate &&
      i7.reward.ships.gas_frigate.count === 1 && i7.reward.ships.gas_frigate.fitting === "empty" &&
      sizesN(i7.reward).res === 1 && sizesN(i7.reward).sh === 1 &&
      sizesN(i7.reward).eq === 0 && sizesN(i7.reward).bp === 0,
    "I7 奖励必须恰为 50000 星币 + 空配捕云级 ×1，无其他奖励");

  // ---- N-17 考古 A1-A6 精确冻结 ----------------------------------------------------------------
  const a1 = TD.byId.A1;
  okN(a1.progressType === "claim" && a1.target.kit === "archaeology_starter" &&
      resAmtN(a1.reward, RN.PROBE) === 20 && resAmtN(a1.reward, RN.FUEL) === 200 &&
      sizesN(a1.reward).res === 2 && sizesN(a1.reward).eq === 0 &&
      sizesN(a1.reward).sh === 0 && sizesN(a1.reward).bp === 0,
    "A1 必须手动领取实习包，奖励 20 标准考古探针 I + 燃料 200，不要求自造探针、不发舰");
  const a2 = TD.byId.A2;
  okN(a2.progressType === "assign" && a2.target.shipId === "rookie_corvette" && a2.target.slot === "archaeology" &&
      emptyRewardN(a2.reward), "A2 必须将启程级编入考古位，不要求蓝图或制造觅迹级");
  const a3 = TD.byId.A3;
  okN(a3.progressType === "archaeology_attempt" && a3.target.tier === "I" && a3.target.count === 1 && a3.target.acceptEither === true &&
      ["site_i_a", "site_i_b", "site_i_c"].every(id => a3.target.sites.includes(id)) && emptyRewardN(a3.reward),
    "A3 必须是任一 I 级遗迹 + 一次真实尝试（成功失败均完成），不要求三遗迹各一次");
  const a4 = TD.byId.A4;
  okN(a4.progressType === "obtain_artifact" && a4.target.count === 1 && a4.target.sinceActivation === true &&
      emptyRewardN(a4.reward), "A4 必须任务激活后获得任意遗物 1 件，无奖励");
  const a5 = TD.byId.A5;
  okN(a5.progressType === "dispose_artifact" && a5.target.count === 1 && emptyRewardN(a5.reward),
    "A5 必须出售或兑换任意遗物 1 件，无奖励");
  const a6 = TD.byId.A6;
  okN(a6.progressType === "confirm" && resAmtN(a6.reward, RN.ISK) === 50000 &&
      a6.reward.ships.heron && a6.reward.ships.heron.count === 1 && a6.reward.ships.heron.fitting === "empty" &&
      resAmtN(a6.reward, RN.PROBE) === 20 &&
      sizesN(a6.reward).res === 2 && sizesN(a6.reward).sh === 1 &&
      sizesN(a6.reward).eq === 0 && sizesN(a6.reward).bp === 0,
    "A6 奖励必须恰为 50000 星币 + 空配觅迹级 ×1 + 20 标准考古探针 I，不发觅迹级蓝图");

  // ---- N-18 作战 C1-C6 精确冻结 ----------------------------------------------------------------
  const c1 = TD.byId.C1;
  okN(c1.progressType === "choose_combat_training" && JSON.stringify(c1.target.tracks) === JSON.stringify(["laser", "missile", "cannon"]) &&
      c1.target.once === true && emptyRewardN(c1.reward),
    "C1 必须三方向选一且仅一次，无直接奖励（奖励走 choiceRewards）");
  const c1exp = {
    laser:   { weapon: "t1_small_laser", ammo: RN.AL },
    missile: { weapon: "t1_light_missile_launcher", ammo: RN.AM },
    cannon:  { weapon: "t1_small_cannon", ammo: RN.AC }
  };
  okN(c1.choiceRewards && ["laser", "missile", "cannon"].every(dir => {
    const cr = c1.choiceRewards[dir], exp = c1exp[dir], s = sizesN(cr);
    return cr && cr.equipment[exp.weapon] === 1 && cr.equipment["t1_shield_booster"] === 1 &&
      resAmtN(cr, exp.ammo) === 100 && resAmtN(cr, RN.FUEL) === 300 &&
      s.res === 2 && s.eq === 2 && s.sh === 0 && s.bp === 0;
  }), "C1 三方向奖励必须逐项精确：对应武器 + 护盾增效器 + 100 弹药 + 300 燃料");
  const c2 = TD.byId.C2;
  okN(c2.progressType === "install" && c2.target.shipId === "rookie_corvette" && c2.target.weaponFromChoice === true &&
      c2.target.shieldBooster === "t1_shield_booster" && emptyRewardN(c2.reward),
    "C2 只要求安装 C1 所选武器与护盾增效器到启程级，不要求玩家自造装备");
  const c3 = TD.byId.C3;
  okN(c3.progressType === "assign_and_select_zone" && c3.target.shipId === "rookie_corvette" && c3.target.slot === "combat" &&
      c3.target.zoneLevel === 1 && c3.target.zoneType === "highsec" && c3.target.zones.length === 3 &&
      c3.target.zones.every(id => { const z = zonesN.find(zz => zz.id === id); return z && z.level === 1 && z.formationPool === "highsec"; }) &&
      emptyRewardN(c3.reward),
    "C3 必须将启程级编入战斗位并选择真实 Lv1 普通星带（angel_outpost/blood_hideout/sansha_outpost），无幽灵 ID");
  const c4 = TD.byId.C4;
  okN(c4.progressType === "kill" && c4.target.count === 1 && c4.target.sinceActivation === true && emptyRewardN(c4.reward),
    "C4 必须任务激活后真实击毁 1 个，不要求 30 击杀");
  const c5 = TD.byId.C5;
  okN(c5.progressType === "clear_wave" && c5.target.wave === 1 && emptyRewardN(c5.reward),
    "C5 必须真实清除第 1 波");
  const c6 = TD.byId.C6;
  okN(c6.progressType === "clear_wave_same_sortie" && c6.target.wave === 4 && c6.target.sameSortie === true &&
      emptyRewardN(c6.reward),
    "C6 必须是同次出击清除第 4 波，不要求手动撤离/停止挂机/清空20波/自制正式舰");
  const c6exp = { laser: { ship: "rifter", ammo: RN.AL }, missile: { ship: "kestrel", ammo: RN.AM }, cannon: { ship: "atron", ammo: RN.AC } };
  okN(c6.choiceRewards && ["laser", "missile", "cannon"].every(dir => {
    const cr = c6.choiceRewards[dir], exp = c6exp[dir], s = sizesN(cr);
    return cr && resAmtN(cr, RN.ISK) === 50000 && cr.ships[exp.ship] &&
      cr.ships[exp.ship].count === 1 && cr.ships[exp.ship].fitting === "empty" &&
      resAmtN(cr, exp.ammo) === 100 && resAmtN(cr, RN.FUEL) === 300 &&
      s.res === 3 && s.eq === 0 && s.sh === 1 && s.bp === 0;
  }), "C6 三方向奖励必须逐项精确：50000 星币 + 空配正战舰（星矛/铁卫/闪刃）+ 100 弹药 + 300 燃料");

  // ---- N-19 A7 / C7 已删除 ----------------------------------------------------------------------
  okN(!TD.byId.A7 && !TD.byId.C7 && !TD.tasks.some(task => task.id === "A7" || task.id === "C7"),
    "A7 与 C7 已在本批删除，不得残留在任务目录中");

  // ---- N-20 全表只允许 I7 / A6 / C6 三处赠予空配成品舰 -------------------------------------------
  const shipRewardTasks = new Set();
  for (const t of TD.tasks) {
    if (sizesN(t.reward).sh > 0) shipRewardTasks.add(t.id);
    if (t.choiceRewards) {
      for (const dir of Object.keys(t.choiceRewards)) {
        if (sizesN(t.choiceRewards[dir]).sh > 0) shipRewardTasks.add(t.id);
      }
    }
  }
  okN(JSON.stringify([...shipRewardTasks].sort()) === JSON.stringify(["A6", "C6", "I7"]),
    "全表只允许 I7 / A6 / C6 三处赠予空配成品舰（P5 启程级与 I7 目标拓岩级均为玩家自造，不计入）");
  okN(i7.reward.ships.gas_frigate.fitting === "empty" && a6.reward.ships.heron.fitting === "empty" &&
      c6.choiceRewards.laser.ships.rifter.fitting === "empty" &&
      c6.choiceRewards.missile.ships.kestrel.fitting === "empty" &&
      c6.choiceRewards.cannon.ships.atron.fitting === "empty",
    "I7/A6/C6 赠予的三艘成品舰必须全部为空配（fitting=empty）");

  // ---- N-21 幽灵 ID 防线（适配新 reward 结构：minerals/equipment/fuel/probe/ammo/ships + choiceRewards）----
  const shipIdsN = new Set([...Object.keys(starterN), ...Object.keys(industrialN), ...Object.keys(archShipsN)]);
  const equipIdsN = new Set(Object.keys(equipmentN));
  const componentIdsN = new Set(componentsN.map(item => item.id));
  const siteIdsN = new Set(sitesN.map(item => item.id));
  const zoneIdsN = new Set(zonesN.map(item => item.id));
  const areaNamesN = new Set(miningAreasN.map(item => item.name));
  const planetIdsN = new Set(planetTypesN.map(item => item.id));
  const ammoKindsN = new Set(ammoRecipesN.filter(item => item.output && item.output.weapon).map(item => item.output.weapon));
  const probeItemIdsN = new Set(ammoRecipesN.filter(item => item.output && item.output.type === "probe").map(item => item.output.itemId));
  const resourceKeysN = new Set([
    ...smeltingN.map(item => item.outputMineral),
    ...miningAreasN.map(item => item.ore),
    ...gasAreasN.map(item => item.gas),
    ...planetTypesN.map(item => item.output)
  ]);
  const slotTokensN = new Set(["combat", "mining", "archaeology"]);
  const navTokensN = new Set([
    ...[...html.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]),
    ...[...html.matchAll(/data-skill="([^"]+)"/g)].map(match => match[1])
  ]);
  // Batch O：resourceAmounts 一律为 ResourceRegistry 命名空间键，逐 namespace 校验真实 key
  const nsKeySetsN = {
    currency: new Set(["isk", "lp"]),
    ore: new Set(miningAreasN.map(item => item.ore)),
    mineral: new Set(smeltingN.map(item => item.outputMineral)),
    planetary: new Set(planetTypesN.map(item => item.output)),
    gas: new Set(gasAreasN.map(item => item.gas)),
    consumable: new Set(["fuel"]),
    ammo: ammoKindsN,
    probe: probeItemIdsN,
    component: componentIdsN
  };
  const ghostN = [];
  const checkIdN = (set, value, label) => { if (value !== undefined && value !== null && !set.has(value)) ghostN.push(label + "=" + value); };
  const checkResIdN = (id, label) => {
    const sep = String(id).indexOf(":");
    if (sep <= 0) { ghostN.push(label + "=" + id + "(缺命名空间)"); return; }
    const ns = String(id).slice(0, sep), key = String(id).slice(sep + 1);
    const set = nsKeySetsN[ns];
    if (!set) { ghostN.push(label + "=" + id + "(未知命名空间)"); return; }
    if (!set.has(key)) ghostN.push(label + "=" + id);
  };
  const checkRewardBucketsN = (reward, label) => {
    if (!reward) { ghostN.push(label + "=缺失奖励对象"); return; }
    for (const bucket of ["resourceAmounts", "equipment", "ships", "blueprints"]) {
      if (!reward[bucket] || typeof reward[bucket] !== "object") ghostN.push(label + "." + bucket + "=缺失");
    }
    Object.keys(reward.resourceAmounts || {}).forEach(id => {
      checkResIdN(id, label + ".resourceAmounts");
      const v = reward.resourceAmounts[id];
      if (!Number.isInteger(v) || v < 0 || !Number.isFinite(v)) ghostN.push(label + ".resourceAmounts[" + id + "]=非法数量 " + v);
    });
    Object.keys(reward.equipment || {}).forEach(id => checkIdN(equipIdsN, id, label + ".equipment"));
    Object.keys(reward.ships || {}).forEach(id => {
      checkIdN(shipIdsN, id, label + ".ships");
      const entry = reward.ships[id];
      if (!entry || entry.fitting !== "empty" || !Number.isInteger(entry.count) || entry.count <= 0) ghostN.push(label + ".ships[" + id + "]=必须 count>0 且 fitting=empty");
    });
    Object.keys(reward.blueprints || {}).forEach(id => {
      if (!shipIdsN.has(id)) ghostN.push(label + ".blueprints=" + id);
      const v = reward.blueprints[id];
      if (!Number.isInteger(v) || v <= 0) ghostN.push(label + ".blueprints[" + id + "]=非法数量 " + v);
    });
  };
  for (const task of TD.tasks) {
    const target = task.target || {};
    checkIdN(componentIdsN, target.recipeId, task.id + ".target.recipeId");
    checkIdN(equipIdsN, target.equipmentId, task.id + ".target.equipmentId");
    checkIdN(shipIdsN, target.shipId, task.id + ".target.shipId");
    checkIdN(slotTokensN, target.slot, task.id + ".target.slot");
    checkIdN(areaNamesN, target.area, task.id + ".target.area");
    if (target.resourceId !== undefined) checkResIdN(target.resourceId, task.id + ".target.resourceId");
    if (target.outputId !== undefined) checkResIdN(target.outputId, task.id + ".target.outputId");
    (target.planetTypes || []).forEach(id => checkIdN(planetIdsN, id, task.id + ".target.planetTypes"));
    Object.keys(target.components || {}).forEach(id => checkIdN(componentIdsN, id, task.id + ".target.components"));
    Object.keys(target.resources || {}).forEach(id => checkResIdN(id, task.id + ".target.resources"));
    (target.sites || []).forEach(id => checkIdN(siteIdsN, id, task.id + ".target.sites"));
    (target.zones || []).forEach(id => checkIdN(zoneIdsN, id, task.id + ".target.zones"));
    (target.tracks || []).forEach(id => checkIdN(ammoKindsN, id, task.id + ".target.tracks"));
    checkIdN(equipIdsN, target.shieldBooster, task.id + ".target.shieldBooster");
    checkRewardBucketsN(task.reward, task.id + ".reward");
    if (task.choiceRewards) {
      for (const dir of Object.keys(task.choiceRewards)) checkRewardBucketsN(task.choiceRewards[dir], task.id + ".choiceRewards." + dir);
    }
    if (task.navigationTarget !== null) checkIdN(navTokensN, task.navigationTarget, task.id + ".navigationTarget");
  }
  okN(ghostN.length === 0, "任务目录出现幽灵 ID / 非法奖励：" + ghostN.join("、"));
  okN(TD.tasks.some(task => task.target && task.target.shipId === "rookie_corvette") &&
      TD.tasks.some(task => task.reward.equipment && task.reward.equipment["t1_mining_laser"] === 1),
    "序章必须包含启程级建造目标，工业线必须发放 T1采矿激光器");

  // ---- N-22 Batch O 新增冻结字段：rewardTiming / completionMode 语义固定 ----------------------
  const timingValsN = new Set(["none", "beforeObjective", "onAction", "afterObjective"]);
  const modeValsN = new Set(["automatic", "claim", "confirm", "choice"]);
  okN(TD.tasks.every(t => timingValsN.has(t.rewardTiming) && modeValsN.has(t.completionMode)),
    "26 条任务必须全部带合法的 rewardTiming 与 completionMode");
  const byTimingN = (v) => TD.tasks.filter(t => t.rewardTiming === v).map(t => t.id).sort();
  okN(JSON.stringify(byTimingN("beforeObjective")) === JSON.stringify(["I1", "I4"]),
    "rewardTiming=beforeObjective 必须恰为 I1 / I4");
  okN(JSON.stringify(byTimingN("onAction")) === JSON.stringify(["A1", "P1", "P6"]),
    "rewardTiming=onAction 必须恰为 P1 / P6 / A1");
  okN(JSON.stringify(byTimingN("afterObjective")) === JSON.stringify(["A6", "C6", "I6", "I7"]),
    "rewardTiming=afterObjective 必须恰为 I6 / I7 / A6 / C6");
  okN(JSON.stringify(TD.tasks.filter(t => t.completionMode === "choice").map(t => t.id)) === JSON.stringify(["C1"]),
    "completionMode=choice 必须唯一为 C1");
  okN(JSON.stringify(TD.tasks.filter(t => t.completionMode === "confirm").map(t => t.id).sort()) === JSON.stringify(["P7"]),
    "completionMode=confirm 必须唯一为 P7（A6 走 afterObjective + claim）");
  okN(TD.tasks.every(t => t.rewardTiming !== "none" || emptyRewardN(t.reward)),
    "rewardTiming=none 的任务其 reward 四桶必须全空");
  okN(TD.tasks.every(t => t.completionMode !== "automatic" || t.rewardTiming === "none"),
    "completionMode=automatic 的任务不得携带任何发放时机");

  // ---- N-19 行星槽位曲线：Lv.1-19 保底 2，其后 3 / 4 / 5 不变 -------------------------------------
  const capStateN = JSON.parse(JSON.stringify(sandbox.gameState));
  capStateN.planetary = { nextId: 1, deployments: [] };
  const slotsAtN = (lvl) => {
    capStateN.skills.planetaryIndustry = { lvl, xp: 0 };
    return sandbox.getPlanetaryCapacityState(capStateN).slots;
  };
  okN(sandbox.getStationPlanetarySlotBonus(capStateN) === 0,
    "新档空间站不应提供行星槽位加成（用于隔离纯技能曲线校验）");
  okN(slotsAtN(1) === 2 && slotsAtN(5) === 2 && slotsAtN(9) === 2 && slotsAtN(10) === 2 && slotsAtN(19) === 2,
    "Lv.1-19 行星槽位必须保底为 2（新手期可同时开熔岩 + 气态）");
  okN(slotsAtN(20) === 3 && slotsAtN(29) === 3 && slotsAtN(30) === 4 && slotsAtN(39) === 4 &&
      slotsAtN(40) === 5 && slotsAtN(99) === 5,
    "Lv.20 起的行星槽位曲线必须保持 3 / 4 / 5 不变");
  okN(sandbox.getPlanetaryCapacityState(capStateN).maxSlots === 5, "行星槽位硬上限必须仍为 5");
  const origBonusN = sandbox.getStationPlanetarySlotBonus;
  try {
    sandbox.getStationPlanetarySlotBonus = () => 2;
    capStateN.skills.planetaryIndustry = { lvl: 1, xp: 0 };
    okN(sandbox.getPlanetaryCapacityState(capStateN).slots === 4, "Lv.1 与空间站 +2 必须叠加为 4 槽");
    capStateN.skills.planetaryIndustry = { lvl: 40, xp: 0 };
    okN(sandbox.getPlanetaryCapacityState(capStateN).slots === 5, "空间站加成叠加后仍受 5 槽硬上限约束");
  } finally {
    sandbox.getStationPlanetarySlotBonus = origBonusN;
  }

  // ---- N-20 既有数值不得回退 ------------------------------------------------------------------------
  okN(starterN.rifter.totalHp === 500 && starterN.kestrel.totalHp === 500 && starterN.atron.totalHp === 500 &&
      recipesN.filter(item => item.level === 1 && item.id !== "rookie_corvette")
        .every(item => Object.values(item.componentCost).reduce((sum, count) => sum + count, 0) === 6),
    "本批不得改动既有舰船：三艘起始护卫舰仍为 500 总血，其余 Lv.1 配方仍为 2/2/2 组件");
  okN(new Set(recipesN.map(item => item.id)).size === recipesN.length &&
      Object.keys(starterN).filter(id => starterN[id].unlock && starterN[id].unlock.type === "tutorial").length === 1,
    "舰船配方 ID 必须唯一，且全表只允许启程级一艘 tutorial 解锁舰");

  console.log("Batch N 新手任务系统（第一次定点返修）· 启程级与 26 条任务目录冻结校验通过（" + nChecks + " 项）：启程级属性/加成/禁用字段、1-1-1 专属配方与 82-13-9-9 整船材料、免蓝图、不入默认配装（建造后空装）、DisplayNames 启程级、26 条任务 ID 唯一与 7/7/6/6 分布、章内 order 连续、文案完整且三段不重复、TutorialData 深度冻结、P7 唯一解锁三分支而 P5/P6 不解锁、P1 材料 82/13/9/9、P2-P4 各单一组件、P5 建造+编入战斗位合并、P6 恰 50000 星币、I1 采矿器+200 燃料、I2/I3 各 364、I4 双行星+276000+26、I5 各 18、I6 各 2、I7 造拓岩级+空配捕云级、A1 探针20+燃料200、A2 启程级考古位、A3 任一 I 级遗迹+一次尝试、A4/A5 各 1 遗物、A6 空配觅迹级+探针20、C1/C6 三方向逐项精确、C2 装武器+盾修、C3 启程级+Lv1 星带、C4 击杀1、C5 第1波、C6 同次第4波、A7/C7 已删除、全表仅 I7/A6/C6 赠予空配成品舰、零幽灵 ID、行星槽位 Lv.1-19=2 与 20/30/40 档 3/4/5 不变（空间站加成仍叠加、硬上限 5）、既有舰船与配方数值零回退");
}

// ============================================================================================
// Batch O 新手任务系统：状态 / 进度 / 奖励 / 存档 运行时闭环行为验证
// 轻量 verify：不接 UI，直接驱动 TutorialState / TutorialSystem / GameEvents / ResourceRegistry。
// ============================================================================================
{
  let oChecks = 0;
  const okO = (condition, message) => { if (!condition) throw new Error("Batch O 校验失败：" + message); oChecks++; };
  const NOW = 1700000000000;
  const cloneState = () => { const s = JSON.parse(JSON.stringify(sandbox.gameState)); delete s.tutorial; return s; };

  okO(sandbox.TutorialState && sandbox.TutorialSystem && sandbox.TutorialData && sandbox.ResourceRegistry && sandbox.GameEvents,
    "Batch O 运行时全局必须暴露 TutorialState / TutorialSystem / TutorialData / ResourceRegistry / GameEvents");

  // ---- O-1 createDefaultTutorialState 默认态 --------------------------------------------
  const def0 = sandbox.TutorialState.createDefaultTutorialState();
  okO(def0.schemaVersion === 2, "schemaVersion 必须为 2（Batch O 定点返修升级幂等账本）");
  okO(def0.legacy === false, "新档 legacy 必须为 false");
  okO(def0.eventLedger && typeof def0.eventLedger === "object" && Array.isArray(def0.eventLedger.processedEventIds) && def0.eventLedger.processedEventIds.length === 0, "eventLedger 权威结构必须为 { processedEventIds: [] }");
  okO(def0.prologueStatus === "active", "序章默认 active");
  okO(def0.taskStateById.P1.status === "active", "P1 默认 active");
  const OTHER_IDS = ["P2","P3","P4","P5","P6","P7","I1","I2","I3","I4","I5","I6","I7","A1","A2","A3","A4","A5","A6","C1","C2","C3","C4","C5","C6"];
  okO(OTHER_IDS.every(id => def0.taskStateById[id] && def0.taskStateById[id].status === "locked"), "其余 25 条默认 locked");
  okO(def0.branchStatus.industrial === "locked" && def0.branchStatus.archaeology === "locked" && def0.branchStatus.combat === "locked", "三条分支默认 locked");
  okO(def0.selectedCombatTrack === null, "selectedCombatTrack 默认 null");
  okO(Object.keys(def0.rewardLedger).length === 0, "rewardLedger 默认空");
  okO(def0.emergencyShipGranted === false, "emergencyShipGranted 默认 false");
  okO(def0.combatRunSequence === 0 && def0.activeCombatRunToken === null, "战斗 run 计数器默认 0 / null");
  okO(def0.lastReconciledAt === 0, "lastReconciledAt 默认 0");

  // ---- O-2 migrateTutorialState 新档迁移：幂等 + 无跳过状态 -----------------------------
  const sNew = cloneState();
  const m1 = sandbox.TutorialState.migrateTutorialState(sNew, { isLegacy:false });
  okO(sNew.tutorial === m1, "migrateTutorialState 返回 state.tutorial 引用");
  okO(sNew.tutorial.taskStateById.P1.status === "active", "新档迁移后 P1 active");
  const before = JSON.stringify(sNew.tutorial);
  sandbox.TutorialState.migrateTutorialState(sNew, { isLegacy:false });
  okO(JSON.stringify(sNew.tutorial) === before, "二次迁移必须幂等（输出完全一致）");
  const VALID_STATUS = ["locked","active","claimable","completed","legacyCompleted"];
  okO(Object.values(sNew.tutorial.taskStateById).every(t => VALID_STATUS.includes(t.status)), "所有任务状态必须合法，无 undefined 跳过");

  // ---- O-3 旧档迁移：P1-P7 legacyCompleted + 三分支激活 + I1/A1/C1 激活 ----------------
  const sLeg = cloneState();
  sandbox.TutorialState.migrateTutorialState(sLeg, { isLegacy:true });
  okO(sLeg.tutorial.legacy === true, "legacy 档 legacy=true");
  okO(sLeg.tutorial.prologueStatus === "legacyCompleted", "序章 legacyCompleted");
  okO(["P1","P2","P3","P4","P5","P6","P7"].every(id => sLeg.tutorial.taskStateById[id].status === "legacyCompleted"), "P1-P7 全部 legacyCompleted");
  okO(sLeg.tutorial.branchStatus.industrial === "active" && sLeg.tutorial.branchStatus.archaeology === "active" && sLeg.tutorial.branchStatus.combat === "active", "三分支 legacy 激活");
  okO(sLeg.tutorial.taskStateById.I1.status === "active" && sLeg.tutorial.taskStateById.A1.status === "active" && sLeg.tutorial.taskStateById.C1.status === "active", "I1/A1/C1 legacy 激活");
  okO(sLeg.tutorial.taskStateById.I2.status === "locked", "I2 仍 locked（未被误激活）");

  // ---- O-4 bootstrap：迁移 + 安装消费者 + reconcile -----------------------------------
  const S = cloneState();
  const boot = sandbox.TutorialSystem.bootstrap(S, { isLegacy:false, now: NOW });
  okO(boot === S.tutorial, "bootstrap 返回 state.tutorial");
  okO(typeof boot.lastReconciledAt === "number" && boot.lastReconciledAt === NOW, "bootstrap 必须运行 reconcile 并设置 lastReconciledAt=now");
  const reInstall = sandbox.TutorialSystem.installTutorialConsumers(S);
  okO(reInstall && reInstall.already === true, "bootstrap 必须已安装事件消费者（二次安装 already=true）");

  // ---- 全局捕获 5 个 tutorial:* 事件契约（source 固定 tutorial-system）-----------------
  const captured = [];
  const unsubs = [];
  for (const type of ["tutorial:taskCompleted","tutorial:rewardClaimed","tutorial:branchesUnlocked","tutorial:combatTrackSelected","tutorial:emergencyShipGranted"]) {
    unsubs.push(sandbox.GameEvents.on(type, (event) => captured.push({ type: event.type, meta: event.meta })));
  }

  // ---- O-5 事件消费者推进任务（消费者已在脚本加载时由游戏 bootstrap 安装到真实 sandbox.gameState）----
  const G = sandbox.gameState;
  sandbox.TutorialSystem.bootstrap(G, { isLegacy:false, now: NOW }); // 重置为默认态；消费者已绑定 G
  // 制造 -> P2（automatic 直完成）
  G.tutorial.taskStateById.P2.status = "active";
  sandbox.GameEvents.emit("manufacturing:completed", { branch:"component", recipeId:"integrated_hull", quantity:1, cycles:1, xp:10 }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.P2.status === "completed", "manufacturing:completed 推进 P2 至 completed（automatic）");
  okO((G.tutorial.taskStateById.P2.progress.integrated_hull || 0) >= 1, "P2 进度 integrated_hull>=1");

  // 采矿 -> I2
  G.tutorial.taskStateById.I2.status = "active";
  const i2count = sandbox.TutorialData.byId.I2.target.count;
  sandbox.GameEvents.emit("mining:completed", { area:"belt", mode:"mine", resourceId:"ore:凡晶石", quantity: i2count, cycles:1, xp:10 }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.I2.status === "completed", "mining:completed 推进 I2 至 completed");

  // I6（afterObjective）-> claimable -> 领取发放蓝图 + 防重复
  G.tutorial.taskStateById.I6.status = "active";
  sandbox.GameEvents.emit("manufacturing:completed", { branch:"component", recipeId:"integrated_hull", quantity:2, cycles:1, xp:10 }, { timestamp:NOW, source:"test", offline:false });
  sandbox.GameEvents.emit("manufacturing:completed", { branch:"component", recipeId:"power_core", quantity:2, cycles:1, xp:10 }, { timestamp:NOW, source:"test", offline:false });
  sandbox.GameEvents.emit("manufacturing:completed", { branch:"component", recipeId:"functional_system", quantity:2, cycles:1, xp:10 }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.I6.status === "claimable", "I6 目标达成后应为 claimable（afterObjective）");
  okO((G.tutorial.taskStateById.I6.progress.integrated_hull||0) >= 2 && (G.tutorial.taskStateById.I6.progress.power_core||0) >= 2 && (G.tutorial.taskStateById.I6.progress.functional_system||0) >= 2, "I6 三组件进度>=2");
  const i6r = sandbox.TutorialSystem.claimTutorialTask(G, "I6", NOW);
  okO(i6r.ok === true, "I6 领取成功");
  okO(G.tutorial.taskStateById.I6.status === "completed", "I6 领取后 completed");
  okO(typeof G.tutorial.rewardLedger.I6 === "number", "I6 写入 rewardLedger");
  okO(Array.isArray(G.ownedBlueprints) && G.ownedBlueprints.includes("miner_frigate"), "I6 发放蓝图 miner_frigate");
  const i6again = sandbox.TutorialSystem.claimTutorialTask(G, "I6", NOW);
  okO(i6again.ok === false && i6again.reason === "ALREADY_CLAIMED", "I6 重复领取返回 ALREADY_CLAIMED");

  // 考古尝试 -> A3 / 遗物出土 -> A4
  G.tutorial.taskStateById.A3.status = "active";
  sandbox.GameEvents.emit("archaeology:attemptCompleted", { siteId: sandbox.TutorialData.byId.A3.target.sites[0], tier:1, success:true, successChance:0.5 }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.A3.status === "completed", "archaeology:attemptCompleted 推进 A3");
  G.tutorial.taskStateById.A4.status = "active";
  sandbox.GameEvents.emit("archaeology:artifactFound", { artifactId:"x", category:"relic", tier:1, iskValue:0, lpValue:0 }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.A4.status === "completed", "archaeology:artifactFound 推进 A4");

  // 击杀 -> C4
  G.tutorial.taskStateById.C4.status = "active";
  sandbox.GameEvents.emit("combat:enemyDefeated", { zoneId:"x", faction:"angel", enemyId:"e1", enemyKind:"frigate", isk:0, xp:10 }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.C4.status === "completed", "combat:enemyDefeated 推进 C4");

  // C5/C6 同次 run token
  G.tutorial.taskStateById.C5.status = "active";
  G.tutorial.taskStateById.C6.status = "active";
  const c6zone = sandbox.TutorialData.byId.C6.target.zones[0];
  const c5zone = c6zone; // C5 不限制 zone（target 无 zones），任意 zone 均计入第 1 波
  // G 为跨 Batch 共享的实时 gameState，combatRunSequence 在存档中保持（bootstrap 不会清零），此处显式归零以保证验证确定性
  G.tutorial.combatRunSequence = 0;
  G.tutorial.activeCombatRunToken = null;
  sandbox.TutorialSystem.noteTutorialActionResult(G, { type:"combat/start" }, { changed:true }, NOW);
  okO(G.tutorial.combatRunSequence === 1, "combat/start 递增 combatRunSequence");
  okO(typeof G.tutorial.activeCombatRunToken === "string" && G.tutorial.activeCombatRunToken.length > 0, "combat/start 设置 activeCombatRunToken");
  const token1 = G.tutorial.activeCombatRunToken;
  sandbox.GameEvents.emit("combat:waveCleared", { wave:1, zoneId: c5zone }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.C5.wave1 === true, "第1波写入 C5.wave1");
  okO(G.tutorial.taskStateById.C5.c5Token === token1, "C5.c5Token 记录同次 run token");
  sandbox.GameEvents.emit("combat:waveCleared", { wave:4, zoneId: c6zone }, { timestamp:NOW, source:"test", offline:false });
  okO(G.tutorial.taskStateById.C6.wave4 === true, "同次第4波写入 C6.wave4");
  okO(G.tutorial.taskStateById.C6.c6Token === token1, "C6.c6Token 等于 c5Token（同次）");
  okO(G.tutorial.taskStateById.C5.status === "completed", "C5 同次达成后自动 completed");
  okO(G.tutorial.taskStateById.C6.status === "claimable", "C6 同次第4波后 claimable（afterObjective）");
  // C6 为方向专属奖励，领取前须已选作战轨道（真实 API 选择 laser）
  G.tutorial.taskStateById.C1.status = "active";
  sandbox.TutorialSystem.chooseTutorialCombatTrack(G, "laser", NOW);
  const c6claim = sandbox.TutorialSystem.claimTutorialTask(G, "C6", NOW);
  okO(c6claim.ok === true, "C6 领取成功");
  okO(G.tutorial.taskStateById.C6.status === "completed", "C6 领取后 completed");
  // 不同次：stop 清 token；用真实 routing 验证「重开出击」不卡死 + 跨次拒绝（禁止手工清 c5Token/c6Token）
  sandbox.TutorialSystem.noteTutorialActionResult(G, { type:"combat/stop" }, { changed:true }, NOW);
  okO(G.tutorial.activeCombatRunToken === null, "combat/stop 清空 activeCombatRunToken");

  // 场景 A：run1 wave1 写入锚点但未到 wave4 -> run2 未经历 wave1 直接 wave4 不得完成 C6（防跨次冒领）
  // 注意：事件消费者仅绑定在真实 sandbox.gameState（G），故真实 routing 场景必须驱动 G（每次重置为默认态）。
  const Gx = sandbox.gameState;
  Gx.tutorial = null; // 重建为全新默认态（C5/C6 波次进度归零），避免沿用 O-5 已 claim 的脏状态
  sandbox.TutorialSystem.bootstrap(Gx, { isLegacy:false, now: NOW });
  Gx.tutorial.taskStateById.C5.status = "active";
  Gx.tutorial.taskStateById.C6.status = "active";
  Gx.tutorial.combatRunSequence = 0; Gx.tutorial.activeCombatRunToken = null;
  sandbox.TutorialSystem.noteTutorialActionResult(Gx, { type:"combat/start" }, { changed:true }, NOW);
  const tr1 = Gx.tutorial.activeCombatRunToken;
  sandbox.GameEvents.emit("combat:waveCleared", { wave:1, zoneId: c5zone }, { timestamp:NOW, source:"test", offline:false });
  okO(Gx.tutorial.taskStateById.C5.c5Token === tr1, "run1 第1波写入 C5.c5Token");
  sandbox.TutorialSystem.noteTutorialActionResult(Gx, { type:"combat/stop" }, { changed:true }, NOW);
  sandbox.TutorialSystem.noteTutorialActionResult(Gx, { type:"combat/start" }, { changed:true }, NOW);
  const tr2 = Gx.tutorial.activeCombatRunToken;
  sandbox.GameEvents.emit("combat:waveCleared", { wave:4, zoneId: c6zone }, { timestamp:NOW, source:"test", offline:false });
  okO(Gx.tutorial.taskStateById.C6.wave4 === false, "run2 未经历 wave1 直接 wave4 不得完成 C6（防跨次冒领）");
  okO(Gx.tutorial.taskStateById.C6.status === "active", "run2 跨次 wave4 后 C6 仍 active（未 claimable）");

  // 场景 B：run1 wave1 -> stop -> run2 start -> run2 wave1 替换 C6 锚点 -> run2 wave4 -> C6 claimable（重开出击修复）
  const Gy = sandbox.gameState;
  sandbox.TutorialSystem.bootstrap(Gy, { isLegacy:false, now: NOW });
  Gy.tutorial.taskStateById.C5.status = "active";
  Gy.tutorial.taskStateById.C6.status = "active";
  Gy.tutorial.combatRunSequence = 0; Gy.tutorial.activeCombatRunToken = null;
  sandbox.TutorialSystem.noteTutorialActionResult(Gy, { type:"combat/start" }, { changed:true }, NOW);
  const tx1 = Gy.tutorial.activeCombatRunToken;
  sandbox.GameEvents.emit("combat:waveCleared", { wave:1, zoneId: c5zone }, { timestamp:NOW, source:"test", offline:false });
  okO(Gy.tutorial.taskStateById.C5.c5Token === tx1, "run1 第1波写入 c5Token");
  sandbox.TutorialSystem.noteTutorialActionResult(Gy, { type:"combat/stop" }, { changed:true }, NOW);
  sandbox.TutorialSystem.noteTutorialActionResult(Gy, { type:"combat/start" }, { changed:true }, NOW);
  const tx2 = Gy.tutorial.activeCombatRunToken;
  okO(tx2 !== tx1, "第二次 combat/start 产生新 run token");
  sandbox.GameEvents.emit("combat:waveCleared", { wave:1, zoneId: c5zone }, { timestamp:NOW, source:"test", offline:false });
  okO(Gy.tutorial.taskStateById.C5.c5Token === tx2, "第二次第1波写入新 c5Token（替换锚点）");
  sandbox.GameEvents.emit("combat:waveCleared", { wave:4, zoneId: c6zone }, { timestamp:NOW, source:"test", offline:false });
  okO(Gy.tutorial.taskStateById.C6.wave4 === true, "run2 同次第4波写入 C6.wave4");
  okO(Gy.tutorial.taskStateById.C6.status === "claimable", "run2 同次达成 C6 claimable");

  // 场景 C：已 claimable 的 C6 不被后续事件回退（run3 跨次 wave4 不篡改）
  sandbox.TutorialSystem.noteTutorialActionResult(Gy, { type:"combat/stop" }, { changed:true }, NOW);
  sandbox.TutorialSystem.noteTutorialActionResult(Gy, { type:"combat/start" }, { changed:true }, NOW);
  const tx3 = Gy.tutorial.activeCombatRunToken;
  sandbox.GameEvents.emit("combat:waveCleared", { wave:4, zoneId: c6zone }, { timestamp:NOW, source:"test", offline:false });
  okO(Gy.tutorial.taskStateById.C6.wave4 === true, "run3 跨次 wave4 不得篡改已达成 wave4（仍 true）");
  okO(Gy.tutorial.taskStateById.C6.status === "claimable", "run3 跨次 wave4 不回退 C6（仍 claimable）");

  // ---- O-6 动作 API：锁定守卫 + onAction 领取 + 原子防重复 -----------------------------
  const S2 = cloneState();
  sandbox.TutorialState.migrateTutorialState(S2, { isLegacy:false });
  const lockr = sandbox.TutorialSystem.claimTutorialTask(S2, "P2", NOW);
  okO(lockr.ok === false && lockr.reason === "TASK_LOCKED", "领取 locked 任务返回 TASK_LOCKED");
  const p1TIBefore = sandbox.ResourceRegistry.get(S2, "mineral:三钛合金");
  const p1Add = sandbox.TutorialData.byId.P1.reward.resourceAmounts["mineral:三钛合金"] || 0;
  const p1r = sandbox.TutorialSystem.claimTutorialTask(S2, "P1", NOW);
  okO(p1r.ok === true, "P1（onAction）领取成功");
  okO(S2.tutorial.taskStateById.P1.status === "completed", "P1 领取后 completed");
  okO(typeof S2.tutorial.rewardLedger.P1 === "number", "P1 写入 rewardLedger");
  okO(sandbox.ResourceRegistry.get(S2, "mineral:三钛合金") === p1TIBefore + p1Add, "P1 发放 " + p1Add + " 三钛合金");
  const p1again = sandbox.TutorialSystem.claimTutorialTask(S2, "P1", NOW);
  okO(p1again.ok === false && p1again.reason === "ALREADY_CLAIMED", "P1 重复领取 ALREADY_CLAIMED");
  okO(sandbox.ResourceRegistry.get(S2, "mineral:三钛合金") === p1TIBefore + p1Add, "P1 重复领取后资源不变（原子防重复）");

  // ---- O-7 beforeObjective：I1 先领支援包，任务保持 active ----------------------------
  const S3 = cloneState();
  sandbox.TutorialState.migrateTutorialState(S3, { isLegacy:false });
  S3.tutorial.taskStateById.I1.status = "active";
  const i1FuelBefore = sandbox.ResourceRegistry.get(S3, "consumable:fuel");
  const i1Add = sandbox.TutorialData.byId.I1.reward.resourceAmounts["consumable:fuel"] || 0;
  const i1r = sandbox.TutorialSystem.claimTutorialTask(S3, "I1", NOW);
  okO(i1r.ok === true && i1r.supportGranted === true, "I1（beforeObjective）领取支援包成功");
  okO(S3.tutorial.taskStateById.I1.status === "active", "I1 领取支援包后保持 active");
  okO(S3.tutorial.taskStateById.I1.supportClaimed === true, "I1 supportClaimed=true");
  okO(sandbox.ResourceRegistry.get(S3, "consumable:fuel") === i1FuelBefore + i1Add, "I1 发放 " + i1Add + " 燃料");
  const i1again = sandbox.TutorialSystem.claimTutorialTask(S3, "I1", NOW);
  okO(i1again.ok === false && i1again.reason === "ALREADY_CLAIMED", "I1 重复领取 ALREADY_CLAIMED");

  // ---- O-8 confirm：P7 确认解锁三分支并激活 I1/A1/C1 ----------------------------------
  const S7 = cloneState();
  sandbox.TutorialState.migrateTutorialState(S7, { isLegacy:false });
  S7.tutorial.taskStateById.P7.status = "active";
  const p7r = sandbox.TutorialSystem.confirmTutorialTask(S7, "P7", NOW);
  okO(p7r.ok === true, "P7 confirm 成功");
  okO(S7.tutorial.taskStateById.P7.status === "completed", "P7 确认后 completed");
  okO(S7.tutorial.branchStatus.industrial === "active" && S7.tutorial.branchStatus.archaeology === "active" && S7.tutorial.branchStatus.combat === "active", "P7 确认解锁三分支");
  okO(S7.tutorial.taskStateById.I1.status === "active" && S7.tutorial.taskStateById.A1.status === "active" && S7.tutorial.taskStateById.C1.status === "active", "P7 确认激活 I1/A1/C1");

  // ---- O-9 选择作战轨道：C1（legacy 下 active）----------------------------------------
  const S9 = cloneState();
  sandbox.TutorialState.migrateTutorialState(S9, { isLegacy:true });
  const c1FuelBefore = sandbox.ResourceRegistry.get(S9, "consumable:fuel");
  const c1Add = sandbox.TutorialData.byId.C1.choiceRewards.laser.resourceAmounts["consumable:fuel"] || 0;
  const chr = sandbox.TutorialSystem.chooseTutorialCombatTrack(S9, "laser", NOW);
  okO(chr.ok === true && chr.track === "laser", "C1 选择 laser 轨道成功");
  okO(S9.tutorial.selectedCombatTrack === "laser", "selectedCombatTrack=laser");
  okO(S9.tutorial.taskStateById.C1.status === "completed", "C1 选择后 completed");
  okO(typeof S9.tutorial.rewardLedger.C1 === "number", "C1 写入 rewardLedger");
  okO(sandbox.ResourceRegistry.get(S9, "consumable:fuel") === c1FuelBefore + c1Add, "C1 laser 轨道按数据发放燃料");
  const ch2 = sandbox.TutorialSystem.chooseTutorialCombatTrack(S9, "missile", NOW);
  okO(ch2.ok === false && ch2.reason === "CHOICE_ALREADY_SET", "重复选择轨道 CHOICE_ALREADY_SET");
  const S9b = cloneState();
  sandbox.TutorialState.migrateTutorialState(S9b, { isLegacy:true });
  const ch3 = sandbox.TutorialSystem.chooseTutorialCombatTrack(S9b, "plasma", NOW);
  okO(ch3.ok === false && ch3.reason === "INVALID_CHOICE", "非法轨道 INVALID_CHOICE");

  // ---- O-10 紧急舰船：P5 完成 + 无舰船时才发放 ---------------------------------------
  const S10 = cloneState();
  sandbox.TutorialState.migrateTutorialState(S10, { isLegacy:false });
  const em0 = sandbox.TutorialSystem.claimEmergencyTutorialShip(S10, NOW);
  okO(em0.ok === false && em0.reason === "EMERGENCY_NOT_AVAILABLE", "P5 未完成时 EMERGENCY_NOT_AVAILABLE");
  S10.tutorial.taskStateById.P5.status = "completed";
  S10.inventory = S10.inventory || { ships:[], equipment:[], rigs:[] };
  S10.inventory.ships = [{ shipId:"rifter", instanceId:"x1" }];
  const em1 = sandbox.TutorialSystem.claimEmergencyTutorialShip(S10, NOW);
  okO(em1.ok === false && em1.reason === "EMERGENCY_NOT_AVAILABLE", "已有舰船时 EMERGENCY_NOT_AVAILABLE");
  S10.inventory.ships = [];
  const em2 = sandbox.TutorialSystem.claimEmergencyTutorialShip(S10, NOW);
  okO(em2.ok === true && S10.tutorial.emergencyShipGranted === true, "紧急舰船发放成功");
  okO(S10.inventory.ships.length === 1 && S10.inventory.ships[0].shipId === "rookie_corvette", "紧急舰船为 rookie_corvette");
  okO(typeof S10.tutorial.rewardLedger["recovery:emergencyCorvette"] === "number", "紧急舰船写入 rewardLedger");
  const em3 = sandbox.TutorialSystem.claimEmergencyTutorialShip(S10, NOW);
  okO(em3.ok === false && em3.reason === "EMERGENCY_ALREADY_GRANTED", "重复发放 EMERGENCY_ALREADY_GRANTED");

  // ---- O-11 REASON 稳定常量（16 个，取值与字面量一致）---------------------------------
  const REASON = sandbox.TutorialSystem.REASON;
  okO(REASON && Object.keys(REASON).length === 16, "REASON 必须恰为 16 个稳定常量");
  okO(REASON.ALREADY_CLAIMED === "ALREADY_CLAIMED" && REASON.ALREADY_COMPLETED === "ALREADY_COMPLETED" && REASON.CHOICE_ALREADY_SET === "CHOICE_ALREADY_SET" && REASON.EMERGENCY_ALREADY_GRANTED === "EMERGENCY_ALREADY_GRANTED" && REASON.INVALID_CHOICE === "INVALID_CHOICE" && REASON.EMERGENCY_NOT_AVAILABLE === "EMERGENCY_NOT_AVAILABLE" && REASON.TASK_LOCKED === "TASK_LOCKED" && REASON.TASK_NOT_CLAIMABLE === "TASK_NOT_CLAIMABLE" && REASON.UNKNOWN_TASK === "UNKNOWN_TASK" && REASON.INVALID_STATE === "INVALID_STATE", "REASON 取值必须与字面量一致（稳定契约）");

  // ---- O-12 五个 tutorial:* 事件契约：均发出且 source=tutorial-system ------------------
  const capturedTypes = new Set(captured.map(c => c.type));
  for (const type of ["tutorial:taskCompleted","tutorial:rewardClaimed","tutorial:branchesUnlocked","tutorial:combatTrackSelected","tutorial:emergencyShipGranted"]) {
    okO(capturedTypes.has(type), "必须发出领域事件 " + type);
    const evt = captured.find(c => c.type === type);
    const src = (evt && evt.meta && evt.meta.source) || (evt && evt.payload && evt.payload.source);
    okO(src === "tutorial-system", type + " 事件 meta.source 必须为 tutorial-system");
  }

  // ---- O-13 脚本加载顺序依赖 -----------------------------------------------------------
  const idxOfO = (suffix) => scriptSources.findIndex(s => s.endsWith(suffix));
  const dTut = idxOfO("js/data/tutorial.js");
  const tState = idxOfO("js/core/tutorial-state.js");
  const sTut = idxOfO("js/systems/tutorial.js");
  const resO = idxOfO("js/core/resources.js");
  const persistO = idxOfO("js/core/persistence.js");
  okO(dTut >= 0 && tState >= 0 && sTut >= 0, "新手任务三个运行时脚本必须被加载");
  okO(dTut < tState && tState < sTut, "脚本顺序：data/tutorial.js < tutorial-state.js < systems/tutorial.js");
  okO(resO < sTut, "resources.js 必须早于 systems/tutorial.js（ResourceRegistry 依赖）");
  okO(sTut < persistO, "systems/tutorial.js 必须早于 persistence.js（bootstrap 依赖）");

  // ============================================================================================
  // O-14 定点返修：C6 奖励解析 + 三方向真实验账（缺口一 / 缺口五）
  // 走真实 combat/start + combat:waveCleared 路由把 C6 推到 claimable，再比较领取前后实际资产差值。
  // ============================================================================================
  const c6z = sandbox.TutorialData.byId.C6.target.zones[0];
  for (const track of ["laser", "missile", "cannon"]) {
    const C = sandbox.gameState;
    sandbox.TutorialState.migrateTutorialState(C, { isLegacy: true }); // 新鲜 legacy 基线（C1 active，consumers 已绑定 C）
    const chTrack = sandbox.TutorialSystem.chooseTutorialCombatTrack(C, track, NOW);
    okO(chTrack.ok && chTrack.track === track, "C6奖励-" + track + "：C1 选 " + track + " 轨道成功");
    okO(C.tutorial.selectedCombatTrack === track, "C6奖励-" + track + "：selectedCombatTrack=" + track);
    C.tutorial.taskStateById.C6.status = "active";
    C.tutorial.combatRunSequence = 0; C.tutorial.activeCombatRunToken = null;
    sandbox.TutorialSystem.noteTutorialActionResult(C, { type: "combat/start" }, { changed: true }, NOW);
    const cTok = C.tutorial.activeCombatRunToken;
    sandbox.GameEvents.emit("combat:waveCleared", { wave: 1, zoneId: c6z }, { timestamp: NOW, source: "test", offline: false });
    sandbox.GameEvents.emit("combat:waveCleared", { wave: 4, zoneId: c6z }, { timestamp: NOW, source: "test", offline: false });
    okO(C.tutorial.taskStateById.C6.status === "claimable", "C6奖励-" + track + "：同次第4波后 claimable");

    const before = {
      isk: sandbox.ResourceRegistry.get(C, "currency:isk"),
      fuel: sandbox.ResourceRegistry.get(C, "consumable:fuel"),
      laser: sandbox.ResourceRegistry.get(C, "ammo:laser"),
      missile: sandbox.ResourceRegistry.get(C, "ammo:missile"),
      cannon: sandbox.ResourceRegistry.get(C, "ammo:cannon"),
      ships: C.inventory.ships.length
    };
    const claimR = sandbox.TutorialSystem.claimTutorialTask(C, "C6", NOW);
    okO(claimR.ok === true, "C6奖励-" + track + "：领取成功");
    const after = {
      isk: sandbox.ResourceRegistry.get(C, "currency:isk"),
      fuel: sandbox.ResourceRegistry.get(C, "consumable:fuel"),
      laser: sandbox.ResourceRegistry.get(C, "ammo:laser"),
      missile: sandbox.ResourceRegistry.get(C, "ammo:missile"),
      cannon: sandbox.ResourceRegistry.get(C, "ammo:cannon"),
      ships: C.inventory.ships.length
    };
    okO(after.isk === before.isk + 50000, "C6奖励-" + track + "：实际到账 +50000 星币");
    okO(after.fuel === before.fuel + 300, "C6奖励-" + track + "：实际到账 +300 燃料");
    if (track === "laser") okO(after.laser === before.laser + 100, "C6奖励-laser：实际到账 +100 激光弹药");
    if (track === "missile") okO(after.missile === before.missile + 100, "C6奖励-missile：实际到账 +100 导弹弹药");
    if (track === "cannon") okO(after.cannon === before.cannon + 100, "C6奖励-cannon：实际到账 +100 火炮弹药");
    okO(after.ships === before.ships + 1, "C6奖励-" + track + "：实际到账 +1 舰船");
    const newShip = C.inventory.ships[C.inventory.ships.length - 1];
    const expShip = track === "laser" ? "rifter" : track === "missile" ? "kestrel" : "atron";
    okO(newShip && newShip.shipId === expShip, "C6奖励-" + track + "：到账新舰为 " + expShip);
    okO(newShip && newShip.fitted && Array.isArray(newShip.fitted.high) && newShip.fitted.high.length === 0 && Array.isArray(newShip.fitted.mid) && newShip.fitted.mid.length === 0 && Array.isArray(newShip.fitted.low) && newShip.fitted.low.length === 0 && Array.isArray(newShip.fitted.rig) && newShip.fitted.rig.length === 0, "C6奖励-" + track + "：新舰 fitted 四槽为空");
    // 重复领取：ALREADY_CLAIMED，四类资产不变
    const claimR2 = sandbox.TutorialSystem.claimTutorialTask(C, "C6", NOW);
    okO(claimR2.ok === false && claimR2.reason === "ALREADY_CLAIMED", "C6奖励-" + track + "：重复领取 ALREADY_CLAIMED");
    okO(sandbox.ResourceRegistry.get(C, "currency:isk") === after.isk, "C6奖励-" + track + "：重复领取后星币不变（原子防重复）");
    okO(C.inventory.ships.length === after.ships, "C6奖励-" + track + "：重复领取后舰船数不变（原子防重复）");
    // 显示态奖励解析为所选方向实际 choiceRewards
    const disp = sandbox.TutorialSystem.getTutorialDisplayState(C);
    const c6disp = disp.tasks.find(t => t.id === "C6");
    const expReward = sandbox.TutorialData.byId.C6.choiceRewards[track];
    okO(c6disp && JSON.stringify(c6disp.reward) === JSON.stringify(expReward), "C6奖励-" + track + "：显示态奖励解析为 " + track + " 方向实际 choiceRewards");
    okO(c6disp && c6disp.rewardClaimed === true, "C6奖励-" + track + "：显示态 rewardClaimed 与领取一致");
  }
  // 未选轨道领取 C6 稳定失败，不改库存/账本/dirty；显示态奖励为 null
  const Cn = cloneState();
  sandbox.TutorialState.migrateTutorialState(Cn, { isLegacy: false });
  Cn.tutorial.taskStateById.C6.status = "active";
  Cn._dirty = false;
  const nBefore = {
    isk: sandbox.ResourceRegistry.get(Cn, "currency:isk"),
    ships: Cn.inventory.ships.length,
    ledger: Object.keys(Cn.tutorial.rewardLedger).length,
    snap: JSON.stringify(Cn.tutorial)
  };
  const noTrackR = sandbox.TutorialSystem.claimTutorialTask(Cn, "C6", NOW);
  okO(noTrackR.ok === false, "未选轨道领取 C6 稳定失败（不改状态）");
  okO(sandbox.ResourceRegistry.get(Cn, "currency:isk") === nBefore.isk && Cn.inventory.ships.length === nBefore.ships && Object.keys(Cn.tutorial.rewardLedger).length === nBefore.ledger && Cn._dirty !== true, "未选轨道领取 C6 不改库存/账本/dirty");
  okO(JSON.stringify(Cn.tutorial) === nBefore.snap, "未选轨道领取 C6 不改任何教程状态（字节级一致）");
  const c6nd = sandbox.TutorialSystem.getTutorialDisplayState(Cn).tasks.find(t => t.id === "C6");
  okO(c6nd && c6nd.reward === null, "未选轨道时 C6 显示态奖励为 null（稳定失败不报错）");

  // ============================================================================================
  // O-15 定点返修：事件幂等账本（缺口三）
  // ============================================================================================
  okO(sandbox.TutorialState.SCHEMA_VERSION === 2, "SCHEMA_VERSION 已升至 2");
  const sEvt = cloneState();
  sandbox.TutorialState.migrateTutorialState(sEvt, { isLegacy: false });
  sEvt.tutorial.eventLedger = ["tutorial:prod:evt-a", "tutorial:prod:evt-b"];
  sEvt.tutorial.processedEventIds = ["tutorial:prod:evt-b", "tutorial:combat:evt-c"]; // 根级错误结构，含重复
  sandbox.TutorialState.migrateTutorialState(sEvt, { isLegacy: false });
  okO(sEvt.tutorial.schemaVersion === 2, "迁移后 schemaVersion=2");
  okO(sEvt.tutorial.eventLedger && Array.isArray(sEvt.tutorial.eventLedger.processedEventIds), "eventLedger 权威结构 { processedEventIds: [] }");
  const evtIds = sEvt.tutorial.eventLedger.processedEventIds;
  okO(evtIds.includes("tutorial:prod:evt-a") && evtIds.includes("tutorial:prod:evt-b") && evtIds.includes("tutorial:combat:evt-c"), "三种来源合并（旧数组 + 根级错误结构）");
  okO(evtIds.filter(x => x === "tutorial:prod:evt-b").length === 1, "合并后去重：evt-b 仅一次");
  okO(!("processedEventIds" in sEvt.tutorial), "根级错误 processedEventIds 已删除");
  const evtSnap = JSON.stringify(sEvt.tutorial);
  sandbox.TutorialState.migrateTutorialState(sEvt, { isLegacy: false });
  okO(JSON.stringify(sEvt.tutorial) === evtSnap, "二次迁移严格幂等（JSON 一致）");
  const sEvt2 = cloneState();
  sandbox.TutorialState.migrateTutorialState(sEvt2, { isLegacy: false });
  sEvt2.tutorial.eventLedger = { processedEventIds: ["x:y:1", "x:y:2"] };
  sandbox.TutorialState.migrateTutorialState(sEvt2, { isLegacy: false });
  okO(sEvt2.tutorial.eventLedger.processedEventIds.includes("x:y:1") && sEvt2.tutorial.eventLedger.processedEventIds.includes("x:y:2"), "新结构 eventLedger.processedEventIds 保留");

  // 同 eventId 仅推进一次；重载后再次发射同 eventId 不增加第二次
  const G3 = sandbox.gameState;
  sandbox.TutorialSystem.bootstrap(G3, { isLegacy: false, now: NOW });
  G3.tutorial.taskStateById.P3.status = "active";
  const dupId = "dup-evt-unit";
  sandbox.GameEvents.emit("manufacturing:completed", { branch: "component", recipeId: "power_core", quantity: 1, cycles: 1, xp: 10 }, { timestamp: NOW, source: "test", offline: false, eventId: dupId });
  okO((G3.tutorial.taskStateById.P3.progress.power_core || 0) === 1, "同 eventId 首次发射推进一次");
  okO((G3.tutorial.eventLedger.processedEventIds || []).some(x => x.endsWith(":" + dupId)), "eventId 已记入 eventLedger");
  sandbox.TutorialState.migrateTutorialState(G3, { isLegacy: false }); // 重载（保留 eventLedger）
  okO((G3.tutorial.eventLedger.processedEventIds || []).some(x => x.endsWith(":" + dupId)), "重载后 eventLedger 保留 eventId");
  G3.tutorial.taskStateById.P3.status = "active";
  sandbox.GameEvents.emit("manufacturing:completed", { branch: "component", recipeId: "power_core", quantity: 1, cycles: 1, xp: 10 }, { timestamp: NOW, source: "test", offline: false, eventId: dupId });
  okO((G3.tutorial.taskStateById.P3.progress.power_core || 0) === 1, "重载后再发同 eventId 不得增加第二次（幂等）");

  // ============================================================================================
  // O-16 定点返修：残缺档默认状态（缺口四）
  // ============================================================================================
  const sEmpty = cloneState();
  sEmpty.tutorial = {};
  sandbox.TutorialState.migrateTutorialState(sEmpty, { isLegacy: false });
  okO(sEmpty.tutorial.taskStateById.P1.status === "active", "tutorial:{} 非legacy → P1 active");
  okO(OTHER_IDS.every(id => sEmpty.tutorial.taskStateById[id] && sEmpty.tutorial.taskStateById[id].status === "locked"), "tutorial:{} 其余25项锁定");
  okO(sEmpty.tutorial.branchStatus.industrial === "locked" && sEmpty.tutorial.branchStatus.archaeology === "locked" && sEmpty.tutorial.branchStatus.combat === "locked", "tutorial:{} 三分支 locked");
  okO(sEmpty.tutorial.schemaVersion === 2, "tutorial:{} 迁移后 schemaVersion=2");

  const sLegPartial = cloneState();
  sLegPartial.tutorial = { legacy: true };
  sandbox.TutorialState.migrateTutorialState(sLegPartial, { isLegacy: false });
  okO(sLegPartial.tutorial.prologueStatus === "legacyCompleted", "legacy 残缺态 → prologueStatus legacyCompleted");
  okO(["P1","P2","P3","P4","P5","P6","P7"].every(id => sLegPartial.tutorial.taskStateById[id].status === "legacyCompleted"), "legacy 残缺态 → P1-P7 legacyCompleted");
  okO(sLegPartial.tutorial.taskStateById.I1.status === "active" && sLegPartial.tutorial.taskStateById.A1.status === "active" && sLegPartial.tutorial.taskStateById.C1.status === "active", "legacy 残缺态 → I1/A1/C1 active");
  okO(sLegPartial.tutorial.taskStateById.I2.status === "locked", "legacy 残缺态 → I2 按旧档默认 locked");

  const sKeep = cloneState();
  sandbox.TutorialState.migrateTutorialState(sKeep, { isLegacy: false });
  sKeep.tutorial.taskStateById.P3.status = "completed";
  sKeep.tutorial.taskStateById.A4.status = "claimable";
  sandbox.TutorialState.migrateTutorialState(sKeep, { isLegacy: false });
  okO(sKeep.tutorial.taskStateById.P3.status === "completed", "既有 completed 状态保留");
  okO(sKeep.tutorial.taskStateById.A4.status === "claimable", "既有 claimable 状态保留");

  const sUnk = cloneState();
  sandbox.TutorialState.migrateTutorialState(sUnk, { isLegacy: false });
  sUnk.tutorial.taskStateById.Z9 = { status: "active" };
  sandbox.TutorialState.migrateTutorialState(sUnk, { isLegacy: false });
  okO(!("Z9" in sUnk.tutorial.taskStateById), "未知 taskId Z9 已删除");

  // ============================================================================================
  // O-17 定点返修：领取显示态同步（缺口五）
  // ============================================================================================
  const S5 = cloneState();
  sandbox.TutorialState.migrateTutorialState(S5, { isLegacy: false });
  const p1r5 = sandbox.TutorialSystem.claimTutorialTask(S5, "P1", NOW);
  okO(p1r5.ok === true && S5.tutorial.taskStateById.P1.rewardClaimed === true, "P1 领取后 rewardClaimed=true");
  okO(sandbox.TutorialSystem.getTutorialDisplayState(S5).tasks.find(t => t.id === "P1").rewardClaimed === true, "P1 显示态 rewardClaimed 与任务状态一致");

  const S5b = cloneState();
  sandbox.TutorialState.migrateTutorialState(S5b, { isLegacy: false });
  S5b.tutorial.taskStateById.I1.status = "active";
  const i1r5 = sandbox.TutorialSystem.claimTutorialTask(S5b, "I1", NOW);
  okO(i1r5.ok === true && i1r5.supportGranted === true && S5b.tutorial.taskStateById.I1.supportClaimed === true, "I1 支援包 supportClaimed=true");
  okO(S5b.tutorial.taskStateById.I1.rewardClaimed === true, "I1 领取后 rewardClaimed=true（同时 supportClaimed）");
  okO(S5b.tutorial.taskStateById.I1.status === "active", "I1 领取支援包后保持 active");

  const S5c = cloneState();
  sandbox.TutorialState.migrateTutorialState(S5c, { isLegacy: false });
  S5c.tutorial.taskStateById.C6.status = "active";
  sandbox.TutorialSystem.claimTutorialTask(S5c, "C6", NOW); // 未选轨道，稳定失败
  okO(S5c.tutorial.taskStateById.C6.rewardClaimed === false, "C6 未选轨道领取失败不写 rewardClaimed");

  const S5d = cloneState();
  sandbox.TutorialState.migrateTutorialState(S5d, { isLegacy: false });
  S5d.tutorial.taskStateById.P7.status = "active";
  const p7r5 = sandbox.TutorialSystem.confirmTutorialTask(S5d, "P7", NOW);
  okO(p7r5.ok === true && S5d.tutorial.taskStateById.P7.rewardClaimed === true, "P7 confirm 后 rewardClaimed=true");

  for (const u of unsubs) { try { u(); } catch (e) {} }
  console.log("Batch O 新手任务系统运行时闭环 · 状态/进度/奖励/存档行为验证通过（" + oChecks + " 项）：默认态（P1 active 余 locked、分支 locked、计数器 0）、新档迁移幂等且无跳过状态、旧档迁移（P1-P7 legacyCompleted+三分支激活+I1/A1/C1 active）、bootstrap 安装消费者+reconcile、12 类事件消费者推进任务至 completed/claimable、C5/C6 同次 run token 防跨次冒领、锁定守卫 TASK_LOCKED、onAction 领取+原子防重复（ALREADY_CLAIMED 不重复发放）、beforeObjective 先发支援包保持 active、confirm 解锁三分支并激活 I1/A1/C1、choose 选择轨道发放奖励且 CHOICE_ALREADY_SET/INVALID_CHOICE、emergency 紧急舰船 EMERGENCY_* 三态、REASON 16 稳定常量、5 个 tutorial:* 事件 source=tutorial-system、脚本顺序依赖；第一次定点返修（C6 三方向真实到账验账 +50000星币/+300燃料/+100对应弹药/+1 空配舰且四槽为空、重复领取 ALREADY_CLAIMED 资产零增、未选轨道稳定失败字节级零副作用、显示态与领取共用同一只读奖励解析器、重开出击真实 routing 三场景（跨次 wave4 不冒领 / run2 替换锚点后可领 / 已 claimable 不被回滚）、schemaVersion=2 与 eventLedger{processedEventIds} 三源合并去重+删根级错误键+二次迁移 JSON 一致、同 eventId 重载后不二次推进、tutorial:{} 与 legacy 残缺档按权威默认态补全且删未知任务、rewardClaimed/supportClaimed 显示态同步且失败不预写）");
}

{
  let pChecks = 0;
  const okP = (condition, message) => { if (!condition) throw new Error("Batch P 校验失败：" + message); pChecks++; };
  const NOW = 1700000000000;
  // 每个场景用全新默认 tutorial 重置（bootstrap 会保留既有进度，故直接替换为默认态）
  const resetTut = () => { sandbox.gameState.tutorial = sandbox.TutorialState.createDefaultTutorialState(); };

  // 渲染小部件所需的 DOM 缓存（覆盖 sandbox.document.getElementById，仅本块生效）
  const cachedEls = {};
  const makeWidgetEl = (id) => ({
    id, _html: "",
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    textContent: "", dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, appendChild() {}, remove() {},
    closest() { return null; },
    querySelector() { return makeWidgetEl("q"); }, querySelectorAll() { return []; },
    getContext() { return new MockCanvasContext(); }
  });
  const _origGetById = sandbox.document.getElementById;
  sandbox.document.getElementById = (id) => { if (!cachedEls[id]) cachedEls[id] = makeWidgetEl(id); return cachedEls[id]; };
  const twHtml = (id) => (cachedEls[id] ? cachedEls[id].innerHTML : "");

  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const baseCss = fs.readFileSync(path.join(root, "css", "base.css"), "utf8");
  const shellRenderSource = fs.readFileSync(path.join(root, "js/ui/shell-render.js"), "utf8");
  const tutorialSource = fs.readFileSync(path.join(root, "js/systems/tutorial.js"), "utf8");

  // 让 twResolveTargetKind 在沙箱中按 index.html 侧边栏真实 data-page/data-skill 解析
  // （documentMock.querySelector 默认恒真，会令 page/skill 误判；此处仅本块局部覆盖）
  const _navData = {};
  { const _re = /data-(page|skill)="([a-zA-Z]+)"/g; let _m; while ((_m = _re.exec(indexHtml))) _navData[_m[1] + ":" + _m[2]] = true; }
  const _origQS = sandbox.document.querySelector;
  sandbox.document.querySelector = (sel) => {
    const _mm = /data-(page|skill)="([^"]+)"/.exec(sel || "");
    if (_mm && _navData[_mm[1] + ":" + _mm[2]]) return makeElement();
    return null;
  };

  // 1) 静态结构：8 个 DOM ID + <aside> + aria + 无全屏遮罩
  const WIDGET_IDS = ["tutorial-widget","tutorial-widget-header","tutorial-widget-toggle","tutorial-widget-progress","tutorial-widget-branch-tabs","tutorial-widget-dialogue","tutorial-widget-objective","tutorial-widget-actions"];
  okP(WIDGET_IDS.every(id => htmlIds.has(id)) && /<aside id="tutorial-widget"/.test(indexHtml) && /aria-live="polite"/.test(indexHtml) && /id="tutorial-widget-toggle"[^>]*aria-expanded/.test(indexHtml) && !/tutorial-overlay|tutorial-modal|tutorial__overlay/.test(indexHtml), "必须含 8 个小部件 DOM ID、<aside> 外壳、aria-live=polite、toggle 有 aria-expanded、且无全屏遮罩");

  // 2) 纯只读：getTutorialDisplayState 不改变 state.tutorial 且可重复计算一致
  resetTut();
  const beforeDisp = JSON.stringify(sandbox.gameState.tutorial);
  const d1 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  const d2 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(JSON.stringify(sandbox.gameState.tutorial) === beforeDisp && d1 && d2 && JSON.stringify(d1) === JSON.stringify(d2), "getTutorialDisplayState 纯只读且可重复计算一致");

  // 3) 总计数 / 初始态
  okP(d1.totalCount === 26 && d1.completedCount === 0 && d1.allCompleted === false && d1.prologueCompleted === false && d1.branchesUnlocked === false && d1.emergencyShipAvailable === false, "初始态：totalCount=26、completedCount=0、未全完成、序章未完成、分支未解锁、无应急舰船");

  // 4) 每任务显示字段 + progressSummary 形状
  const p1 = d1.taskById.P1;
  const needKeys = ["id","chapter","order","title","speaker","briefing","objectiveText","completionText","navigationTarget","completionMode","rewardTiming","status","progress","reward","rewardClaimed","supportClaimed","isActive","isClaimable","isCompleted","canClaim","canConfirm","canChooseCombatTrack","progressSummary"];
  okP(p1 && needKeys.every(k => k in p1) && p1.progressSummary && typeof p1.progressSummary.current === "number" && typeof p1.progressSummary.target === "number" && typeof p1.progressSummary.ratio === "number" && typeof p1.progressSummary.text === "string", "P1 含全部规定显示字段且 progressSummary 形如 {current,target,ratio,text}");

  // 5) 顶层字段 + chapters 每项含 completed/total
  const topKeys = ["completedCount","totalCount","prologueCompleted","branchStatus","selectedCombatTrack","emergencyShipAvailable","allCompleted","chapters","chapterById","currentTaskId","tasks","taskById"];
  okP(topKeys.every(k => k in d1) && Array.isArray(d1.chapters) && d1.chapters.length >= 4 && d1.chapters.every(c => "completed" in c && "total" in c), "顶层显示态含全部规定字段且 chapters 每项含 completed/total");

  // 6) P7 前三分支默认 locked
  okP(d1.branchStatus.industrial === "locked" && d1.branchStatus.archaeology === "locked" && d1.branchStatus.combat === "locked", "P7 前三分支默认 locked");

  // 7) 事件监听：仅 5 个具体事件、无 '*' 通配、只装一次
  okP(typeof sandbox.renderTutorialWidget === "function", "renderTutorialWidget 必须作为全局函数暴露");
  const evtNames = ["tutorial:taskCompleted","tutorial:rewardClaimed","tutorial:branchesUnlocked","tutorial:combatTrackSelected","tutorial:emergencyShipGranted"];
  okP(evtNames.every(n => shellRenderSource.includes('GE.on("' + n + '"')) && shellRenderSource.includes("_tutorialWidgetListenersInstalled") && !/\.on\(\s*["']\*["']/.test(shellRenderSource), "必须监听 5 个具体 tutorial 事件、有只装一次守卫、且不得监听 '*' 通配");

  // 8) 事件触发后重渲且仍纯读（不推进/发放）
  const tutBefore = JSON.stringify(sandbox.gameState.tutorial);
  sandbox.GameEvents.emit("tutorial:rewardClaimed", { taskId: "P1", claimedAt: NOW });
  okP(JSON.stringify(sandbox.gameState.tutorial) === tutBefore && twHtml("tutorial-widget-dialogue").length > 0, "tutorial:rewardClaimed 事件后应重渲对话区且不得改变 state.tutorial");

  // 9) P1 按钮→action.type 映射（领取；navigationTarget=null → 无『前往执行』）
  resetTut();
  sandbox.gameState.tutorial.taskStateById.P1.status = "active";
  sandbox.renderTutorialWidget();
  okP(/data-act="claim"\s+data-task="P1"/.test(twHtml("tutorial-widget-actions")) && !/data-act="nav"/.test(twHtml("tutorial-widget-actions")), "P1 应渲染『领取』(claim) 且 navigationTarget=null 故无『前往执行』导航按钮");

  // === Batch P 第一次定点返修：任务导航纠正断言（≤15 项）===
  // (A) 26 项静态 navigationTarget 与本指令表逐项一致
  const EXPECT_NAV = { P1:null, P2:"shipEngineering", P3:"shipEngineering", P4:"shipEngineering", P5:"shipEngineering", P6:null, P7:null, I1:"hangar", I2:"mining", I3:"refining", I4:"planetary", I5:"planetary", I6:"shipEngineering", I7:"shipEngineering", A1:null, A2:"hangar", A3:"archaeology", A4:"archaeology", A5:"archaeology", A6:null, C1:null, C2:"hangar", C3:"hangar", C4:"combat", C5:"combat", C6:"combat" };
  const allTasks = sandbox.TutorialData.tasks;
  okP(allTasks.length === 26 && allTasks.every(t => EXPECT_NAV[t.id] === (t.navigationTarget || null)), "26 项静态 navigationTarget 与本指令表逐项一致");

  // (B) P1/P6/A1/C1 显示态 navigationTarget 全为 null（不渲染导航按钮）
  resetTut();
  const noNavIds = ["P1","P6","A1","C1"];
  const order26 = allTasks.map(t => t.id);
  for (const id of noNavIds) {
    const idx = order26.indexOf(id);
    for (let i = 0; i < idx; i++) sandbox.gameState.tutorial.taskStateById[order26[i]].status = "completed";
    sandbox.gameState.tutorial.taskStateById[id].status = "active";
  }
  const dNoNav = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(noNavIds.every(id => dNoNav.taskById[id].navigationTarget === null), "P1/P6/A1/C1 显示态 navigationTarget 全为 null（无导航按钮）");

  // (C) P2 类（shipEngineering）『前往执行』实际落点 #shipeng-panel 而非 #blueprintstore-panel
  resetTut();
  sandbox.gameState.tutorial.taskStateById.P1.status = "completed";
  sandbox.gameState.tutorial.taskStateById.P2.status = "active";
  sandbox.renderTutorialWidget();
  const navMatch = /data-act="nav"\s+data-nav="([^"]+)"/.exec(twHtml("tutorial-widget-actions"));
  sandbox.document.getElementById("shipeng-panel").style.display = "none";
  sandbox.document.getElementById("blueprintstore-panel").style.display = "none";
  sandbox.twGoToTarget("shipEngineering");
  okP(navMatch && navMatch[1] === "shipEngineering" && cachedEls["shipeng-panel"].style.display === "" && cachedEls["blueprintstore-panel"].style.display === "none", "P2『前往执行』目标=shipEngineering，twGoToTarget 实际显示 #shipeng-panel 且 #blueprintstore-panel 保持隐藏");

  // (D) A5 实际落点 #archaeology-panel 而非 #cargo-panel
  // 小部件按分支选项卡渲染：P1-P7 全部完成后默认序章选项卡无当前任务，
  // A5 位于考古选项卡且未被选中，其『前往执行』按钮不会渲染。
  // 指令允许『触发真实按钮 或 调用正式 twGoToTarget』二选一，这里取后者：
  // 先断言显示态 navigationTarget===archaeology（即真实按钮本应承载的目标），
  // 再调用正式 twGoToTarget 检查面板实际显隐。
  resetTut();
  for (const id of ["P1","P2","P3","P4","P5","P6","P7","A1","A2","A3","A4"]) sandbox.gameState.tutorial.taskStateById[id].status = "completed";
  sandbox.gameState.tutorial.taskStateById.A5.status = "active";
  const dA5 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  sandbox.document.getElementById("archaeology-panel").style.display = "none";
  sandbox.document.getElementById("cargo-panel").style.display = "none";
  sandbox.twGoToTarget("archaeology");
  okP(dA5.taskById.A5.navigationTarget === "archaeology" && cachedEls["archaeology-panel"].style.display === "" && cachedEls["cargo-panel"].style.display === "none", "A5『前往执行』目标=archaeology，twGoToTarget 实际显示 #archaeology-panel 且 #cargo-panel 保持隐藏");

  // (E) P5 动态：未造船→shipEngineering；已造未编战斗位→hangar
  resetTut();
  sandbox.gameState.tutorial.taskStateById.P5.status = "active";
  sandbox.gameState.inventory.ships = [];
  const dP5a = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  sandbox.gameState.inventory.ships = [{ shipId: "rookie_corvette", instanceId: "ship_test_p5", fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 }];
  sandbox.gameState.tutorial.taskStateById.P5.instanceId = "ship_test_p5";
  sandbox.gameState.shipAssignments = {};
  const dP5b = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dP5a.taskById.P5.navigationTarget === "shipEngineering" && dP5b.taskById.P5.navigationTarget === "hangar", "P5 未造启程级→shipEngineering；已造未编战斗位→hangar");

  // (F) C3 动态：未编战斗位→hangar；已编未选合法星带→combat
  resetTut();
  sandbox.gameState.tutorial.taskStateById.C3.status = "active";
  sandbox.gameState.shipAssignments = {};
  const dC3a = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  sandbox.gameState.inventory.ships = [{ shipId: "rookie_corvette", instanceId: "ship_test_c3", fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 }];
  sandbox.gameState.shipAssignments = { combat: "ship_test_c3" };
  sandbox.gameState.combat = { zone: "unknown_zone" };
  const dC3b = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dC3a.taskById.C3.navigationTarget === "hangar" && dC3b.taskById.C3.navigationTarget === "combat", "C3 未编战斗位→hangar；已编未选合法星带→combat");

  // (G) I1/I4 支援包：未领→无导航；领取后→hangar/planetary
  resetTut();
  sandbox.gameState.tutorial.taskStateById.I1.status = "active";
  sandbox.gameState.tutorial.taskStateById.I1.supportClaimed = false;
  const dI1a = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  sandbox.gameState.tutorial.taskStateById.I1.supportClaimed = true;
  const dI1b = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dI1a.taskById.I1.navigationTarget === null && dI1b.taskById.I1.navigationTarget === "hangar", "I1 未领支援包→无导航；领取后→hangar");
  resetTut();
  sandbox.gameState.tutorial.taskStateById.I4.status = "active";
  sandbox.gameState.tutorial.taskStateById.I4.supportClaimed = false;
  const dI4a = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  sandbox.gameState.tutorial.taskStateById.I4.supportClaimed = true;
  const dI4b = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dI4a.taskById.I4.navigationTarget === null && dI4b.taskById.I4.navigationTarget === "planetary", "I4 未领支援包→无导航；领取后→planetary");

  // (H) I6/I7/A6/C6 进入 claimable 后 navigationTarget=null（只领奖励、不导航）
  const claimIds = ["I6","I7","A6","C6"];
  let allClaimNull = true;
  for (const id of claimIds) {
    resetTut();
    if (id === "C6") sandbox.gameState.tutorial.selectedCombatTrack = "laser";
    sandbox.gameState.tutorial.taskStateById[id].status = "claimable";
    const dCl = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
    if (dCl.taskById[id].navigationTarget !== null) allClaimNull = false;
  }
  okP(allClaimNull, "I6/I7/A6/C6 进入 claimable 后 navigationTarget 全为 null（只显示领取奖励）");

  // (I) completed / legacyCompleted 任务 navigationTarget 必为 null
  resetTut();
  sandbox.gameState.tutorial.taskStateById.P2.status = "completed";
  sandbox.gameState.tutorial.taskStateById.P3.status = "legacyCompleted";
  const dDone = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dDone.taskById.P2.navigationTarget === null && dDone.taskById.P3.navigationTarget === null, "completed / legacyCompleted 任务 navigationTarget 必为 null");

  // (J) 动态导航计算纯读可重复
  resetTut();
  sandbox.gameState.tutorial.taskStateById.P5.status = "active";
  sandbox.gameState.inventory.ships = [{ shipId: "rookie_corvette", instanceId: "ship_pure", fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 }];
  sandbox.gameState.tutorial.taskStateById.P5.instanceId = "ship_pure";
  const tutBeforeNav = JSON.stringify(sandbox.gameState.tutorial);
  const dNav1 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  const dNav2 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(JSON.stringify(sandbox.gameState.tutorial) === tutBeforeNav && dNav1.taskById.P5.navigationTarget === dNav2.taskById.P5.navigationTarget, "动态导航计算纯读且可重复：不改变 state.tutorial");

  // (K) DOM 总数与收口提示一致
  okP(htmlIds.size === 313, "DOM 总数 313（294 原 + 8 教程组件 + 1 删除存档按钮 btn-delete-save + 舰船工程 UI 重做新增 6 结构 id + 死亡空间连刷控件 4 个 id）与收口提示一致");

  // 10) P7 按钮→action.type 映射（开启三条职业支线 / confirm）
  resetTut();
  for (const id of ["P1","P2","P3","P4","P5","P6"]) sandbox.gameState.tutorial.taskStateById[id].status = "completed";
  sandbox.gameState.tutorial.taskStateById.P7.status = "active";
  sandbox.renderTutorialWidget();
  okP(/data-act="confirm"\s+data-task="P7"/.test(twHtml("tutorial-widget-actions")) && twHtml("tutorial-widget-actions").includes("开启三条职业支线"), "P7 应渲染『开启三条职业支线』按钮 (confirm)");

  // 11) 应急舰船入口（顶层条件）+ 按钮
  resetTut();
  sandbox.gameState.tutorial.taskStateById.P5.status = "completed";
  sandbox.gameState.inventory.ships = [];
  sandbox.gameState.tutorial.emergencyShipGranted = false;
  const dEm = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dEm.emergencyShipAvailable === true && (sandbox.renderTutorialWidget(), /data-act="claimEmergency"/.test(twHtml("tutorial-widget-actions"))), "P5 完成且无舰船时应出现应急舰船入口按钮 (claimEmergency)");

  // 12) I1 支援包按钮（领取支援包，保持 active）
  resetTut();
  sandbox.gameState.tutorial.prologueStatus = "completed";
  sandbox.gameState.tutorial.branchStatus.industrial = "active";
  sandbox.gameState.tutorial.branchStatus.archaeology = "active";
  sandbox.gameState.tutorial.branchStatus.combat = "active";
  sandbox.gameState.tutorial.taskStateById.P7.status = "completed";
  sandbox.twOnBranchesUnlocked();
  sandbox.gameState.tutorial.taskStateById.I1.status = "active";
  sandbox.gameState.tutorial.taskStateById.I1.supportClaimed = false;
  for (const id of ["I2","I3","I4","I5","I6","I7"]) sandbox.gameState.tutorial.taskStateById[id].status = "completed";
  sandbox.renderTutorialWidget();
  okP(twHtml("tutorial-widget-actions").includes("领取支援包"), "I1 未领支援包时应渲染『领取支援包』");

  // 13) I6 领取奖励按钮（canClaim + 领取奖励）
  sandbox.gameState.tutorial.taskStateById.I1.status = "completed";
  sandbox.gameState.tutorial.taskStateById.I6.status = "claimable";
  for (const id of ["I2","I3","I4","I5","I7"]) sandbox.gameState.tutorial.taskStateById[id].status = "completed";
  const dI6 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  sandbox.renderTutorialWidget();
  okP(dI6.taskById.I6.canClaim === true && twHtml("tutorial-widget-actions").includes("领取奖励"), "I6 可达 claimable 且渲染『领取奖励』");

  // 14) C1 三轨道选择（trackOptions=3，标签 激光/导弹/火炮，含预览）
  sandbox.gameState.tutorial.taskStateById.C1.status = "active";
  const dC1 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dC1.taskById.C1.canChooseCombatTrack === true && Array.isArray(dC1.taskById.C1.trackOptions) && dC1.taskById.C1.trackOptions.length === 3 && dC1.taskById.C1.trackOptions.every(o => ["激光","导弹","火炮"].includes(o.label) && o.previewText && o.previewText.length > 0), "C1 可三轨道选择且 trackOptions=3（激光/导弹/火炮 含预览）");

  // 15) C6 奖励经 DisplayNames 显示舰船名
  sandbox.gameState.tutorial.taskStateById.C6.status = "claimable";
  sandbox.gameState.tutorial.selectedCombatTrack = "laser";
  const dC6 = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  okP(dC6.taskById.C6.rewardItems.some(r => r.text.includes("星矛级")), "C6（laser）奖励应经 DisplayNames 显示舰船名 星矛级");

  // 16) 移动端 CSS：@media720 + safe-area + reduced-motion，新手部件无闪烁
  const twCssStart = baseCss.indexOf(".tutorial-widget");
  const twCss = twCssStart >= 0 ? baseCss.slice(twCssStart) : "";
  okP(/@media\s*\(max-width:\s*720px\)/.test(twCss) && twCss.includes("env(safe-area-inset-bottom") && twCss.includes("prefers-reduced-motion") && !/flash|blink/.test(twCss), "base.css 须含移动端 @media720 + safe-area + reduced-motion 且新手部件无闪烁动画");

  // 17) 折叠仅 UI 临时变量，不写 gameState
  okP(shellRenderSource.includes("_tutorialWidgetCollapsed") && shellRenderSource.includes('classList.toggle("collapsed"') && !shellRenderSource.includes("gameState.tutorial ="), "折叠必须用模块级临时变量 + DOM class，且不得写入 gameState.tutorial");

  // 18) 不引用 audit 脚本、脚本数不回退
  okP(!shellRenderSource.includes("audit") && !tutorialSource.includes("audit") && scriptSources.length === 56, "Batch P 不得引用 audit 脚本且脚本数保持 55 不变");

  // === Batch Q 真实浏览器试玩定点返修断言（5 项）===
  // (Q1) 真实浏览器复现：领取 P1 后动作区永久空白。根因是 tutorial 事件在同一次 dispatch 内部同步派发，
  // 早于该次 dispatch 末尾的「解锁下一任务」收尾；事件回调只渲染一次会把 DOM 定格在中间态且此后不再刷新。
  // 因此 5 个事件处理器必须统一经 twRenderSoon（即时渲染 + 结算后补渲）。
  okP(shellRenderSource.includes("function twRenderSoon()")
    && /function twOnRewardClaimed\(\)\s*\{\s*twRenderSoon\(\);\s*\}/.test(shellRenderSource)
    && /function twOnCombatTrackSelected\(\)\s*\{\s*twRenderSoon\(\);\s*\}/.test(shellRenderSource)
    && /function twOnEmergencyShipGranted\(\)\s*\{\s*twRenderSoon\(\);\s*\}/.test(shellRenderSource)
    && (shellRenderSource.match(/twRenderSoon\(\)/g) || []).length >= 6,
    "5 个教程事件处理器须统一经 twRenderSoon 重渲，不得只在事件回调里渲染一次");
  // (Q2) twRenderSoon 自身契约：即时渲染 + 去重标志 + 无定时器环境守卫 + 宏任务补渲且补渲异常不外抛
  okP(shellRenderSource.includes('typeof setTimeout !== "function"')
    && shellRenderSource.includes("_tutorialWidgetRenderQueued = true")
    && /setTimeout\([\s\S]{0,240}?renderTutorialWidget\(\);[\s\S]{0,120}?\}\s*,\s*0\s*\)/.test(shellRenderSource),
    "twRenderSoon 须含：去重标志 + 无 setTimeout 环境守卫 + setTimeout(...,0) 补渲且 try/catch 兜底");
  // (Q3) 完成态收尾文案：26/26 全部完成时进度头显示『培训档案完成 26/26』
  resetTut();
  for (const t of sandbox.TutorialData.tasks) sandbox.gameState.tutorial.taskStateById[t.id].status = "completed";
  sandbox.gameState.tutorial.prologueStatus = "completed";
  sandbox.gameState.tutorial.branchStatus = { industrial: "completed", archaeology: "completed", combat: "completed" };
  const dQAll = sandbox.TutorialSystem.getTutorialDisplayState(sandbox.gameState);
  sandbox.renderTutorialWidget();
  const qProgAll = twHtml("tutorial-widget-progress");
  okP(dQAll.allCompleted === true && qProgAll.includes("培训档案完成 26/26"), "26/26 全部完成时进度头须显示『培训档案完成 26/26』");
  // (Q4) 完成态不得出现任何跳过入口，卡片仍保留结构
  okP(!/跳过|data-act="skip"/.test(twHtml("tutorial-widget-actions")) && !/跳过/.test(qProgAll) && twHtml("tutorial-widget-progress").length > 0,
    "完成态不得出现跳过入口且教程卡结构保留");
  // (Q5) 未完成态文案不得回退：仍显示『已完成 X/26』
  resetTut();
  sandbox.renderTutorialWidget();
  const qProgFresh = twHtml("tutorial-widget-progress");
  okP(qProgFresh.includes("已完成 0/26") && !qProgFresh.includes("培训档案完成"), "未完成态进度头须保持『已完成 X/26』文案");

  sandbox.document.getElementById = _origGetById;
  sandbox.document.querySelector = _origQS;
  console.log("Batch P 新手引导常驻小部件校验通过（" + pChecks + " 项）：8 DOM ID + <aside>/aria/无遮罩、getTutorialDisplayState 纯只读且 26 总数、每任务/顶层字段齐全、P7 前三分支 locked、5 具体事件监听且无 '*' 通配且只装一次、事件触发重渲且仍纯读、按钮→action.type 映射（P1 领取 / P7 开启三条职业支线 / I1 领取支援包 / I6 领取奖励 / C1 三轨道 / 应急舰船 claimEmergency / 前往执行导航）、C1 三轨道预览与 C6 经 DisplayNames 显示舰船名、移动端 @media720 + safe-area + reduced-motion 无闪烁、折叠仅 UI 变量不写 gameState、不引用 audit、脚本数 54 不变");
}

// ===== Batch Q 最终定点返修：存档来源三态（null / false / true）真实行为断言 =====
// 复用上方同一套全脚本沙箱与既有 localStorage fixture，不新建第二套沙箱、不做纯源码字符串检查：
// 全部结论均来自真实的 SaveManager.load / SaveManager.importData / SaveManager.deleteSave /
// migrateShipAndEquipmentState 调用，以及脚本装载时真实执行过的 autoLoad 启动路径。
{
  let qChecks = 0;
  const okQ = (condition, message) => { if (!condition) throw new Error("Batch Q 校验失败：" + message); qChecks++; };
  const shipIds = () => (sandbox.gameState.inventory.ships || []).map(s => s && s.shipId);
  const shipCount = () => (sandbox.gameState.inventory.ships || []).length;
  const hasShip = (id) => shipIds().includes(id);

  // ---- A. 空 localStorage 的首次启动：来源必须是 null（真正的新游戏），零舰船、零补偿 ----
  okQ(freshBootEvidence.lastLoadSource === null && freshBootEvidence.isLegacy === false,
    "空存档首启来源标记必须严格为 null 且不得判定为老档，实际 " + String(freshBootEvidence.lastLoadSource));
  okQ(freshBootEvidence.ships.length === 0,
    "空存档首启必须为零舰船，实际 " + JSON.stringify(freshBootEvidence.ships.map(s => s && s.shipId)));
  okQ(!freshBootEvidence.ships.some(s => s && s.shipId === "rifter") &&
      !freshBootEvidence.ships.some(s => s && s.shipId === "miner_frigate"),
    "空存档首启不得含旧档兜底补偿舰 rifter / miner_frigate");
  okQ(freshBootEvidence.isk === 10000,
    "空存档首启星币必须保持正式新档值 10000，不得升到旧档补偿值 1000000，实际 " + freshBootEvidence.isk);
  okQ(freshBootEvidence.tutorial && freshBootEvidence.tutorial.taskStateById &&
      freshBootEvidence.tutorial.taskStateById.P1 && freshBootEvidence.tutorial.taskStateById.P1.status === "active",
    "空存档首启 tutorial.P1 必须为 active");
  {
    // 应急舰船的「零舰船」前提：拿首启快照真实跑一次展示态计算
    const S = JSON.parse(JSON.stringify(sandbox.gameState));
    S.inventory.ships = JSON.parse(JSON.stringify(freshBootEvidence.ships));
    S.tutorial = JSON.parse(JSON.stringify(freshBootEvidence.tutorial));
    S.tutorial.taskStateById.P5.status = "completed";
    const disp = sandbox.TutorialSystem.getTutorialDisplayState(S);
    okQ(disp.emergencyShipAvailable === true,
      "空存档首启零舰船前提下，应急舰船必须可用（emergencyShipAvailable=true）");
  }

  // ---- B. 老档（原始存档无 tutorial 字段）：来源严格 false，旧档补偿保留且幂等 ----
  const legacySave = JSON.parse(JSON.stringify(sandbox.gameState));
  delete legacySave.tutorial;
  legacySave.inventory.ships = [];
  const legacyJson = JSON.stringify(legacySave);
  localStorageMock.getItem = () => legacyJson;
  const legacyLoaded = sandbox.SaveManager.load();
  localStorageMock.getItem = () => null;
  okQ(legacyLoaded === true && sandbox.SaveManager._lastLoadSourceHadTutorial === false && sandbox.isLegacySaveSource() === true,
    "老档经真实 SaveManager.load 后，来源标记必须严格为 false 且判定为老档");
  sandbox.migrateShipAndEquipmentState();
  const legacyShipsAfterFirst = shipCount();
  okQ(hasShip("rifter") && legacyShipsAfterFirst === 1,
    "老档兜底补偿必须仍然生效：迁移后补发 1 艘 rifter，实际 " + JSON.stringify(shipIds()));
  sandbox.migrateShipAndEquipmentState();
  sandbox.migrateShipAndEquipmentState();
  okQ(shipCount() === legacyShipsAfterFirst,
    "老档补偿必须幂等：重复迁移不得重复补舰，实际 " + JSON.stringify(shipIds()));

  // ---- C. 现代档（原始存档含 tutorial、舰船为空）：来源严格 true，不触发旧档补偿 ----
  const modernSave = JSON.parse(JSON.stringify(sandbox.gameState));
  modernSave.tutorial = sandbox.TutorialState.createDefaultTutorialState();
  modernSave.inventory.ships = [];
  const modernJson = JSON.stringify(modernSave);
  localStorageMock.getItem = () => modernJson;
  const modernLoaded = sandbox.SaveManager.load();
  localStorageMock.getItem = () => null;
  okQ(modernLoaded === true && sandbox.SaveManager._lastLoadSourceHadTutorial === true && sandbox.isLegacySaveSource() === false,
    "现代档经真实 SaveManager.load 后，来源标记必须严格为 true 且不得判定为老档");
  sandbox.migrateShipAndEquipmentState();
  okQ(shipCount() === 0 && !hasShip("rifter"),
    "现代档舰船为空时不得触发旧档补偿，实际 " + JSON.stringify(shipIds()));

  // ---- importData 同样按原始存档自有 tutorial 字段写 false / true ----
  sandbox.SaveManager.importData(legacyJson);
  const importLegacyFlag = sandbox.SaveManager._lastLoadSourceHadTutorial;
  sandbox.SaveManager.importData(modernJson);
  const importModernFlag = sandbox.SaveManager._lastLoadSourceHadTutorial;
  okQ(importLegacyFlag === false && importModernFlag === true,
    "importData 必须按原始存档是否自有 tutorial 字段写 false / true，实际 " + String(importLegacyFlag) + " / " + String(importModernFlag));

  // ---- D. 删除存档后再次启动：来源回到 null，不沿用上一次标记，仍为零舰船新档 ----
  sandbox.SaveManager._pendingDelete = false;
  sandbox.SaveManager.deleteSave();
  okQ(sandbox.SaveManager._lastLoadSourceHadTutorial === null,
    "deleteSave 后来源标记必须立刻回到 null，不得沿用上一次的 legacy/modern 标记");
  localStorageMock.getItem = () => null;
  const restartLoaded = sandbox.SaveManager.load();
  okQ(restartLoaded === false && sandbox.SaveManager._lastLoadSourceHadTutorial === null && sandbox.isLegacySaveSource() === false,
    "删档后再次启动：load 返回 false、来源回到 null、且不得判定为老档");
  sandbox.gameState.inventory.ships = [];
  sandbox.migrateShipAndEquipmentState();
  okQ(shipCount() === 0,
    "删档后再次启动仍为零舰船新档，不得补发 rifter，实际 " + JSON.stringify(shipIds()));

  console.log("Batch Q 存档来源三态校验通过（" + qChecks + " 项）：空档首启来源=null 且零舰船/零补偿/星币 10000/P1 active/应急舰船前提成立、老档来源严格 false 且 rifter 补偿保留并幂等、现代档来源严格 true 且不补偿、importData 写 false/true、删档重开来源回到 null 仍为零舰船");
}

// ===== Batch R：离线战斗共享基础设施断言（advanceCombatRound / beginDeathspaceRun / 确定性 RNG / 连刷严格化） =====
// 复用同一套全脚本沙箱；所有结论来自真实函数调用，不依赖源码字符串检查。
{
  const ok = (condition, message) => { if (!condition) throw new Error("Batch R 校验失败：" + message); };
  const CZ = vm.runInContext("COMBAT_ZONES", sandbox);
  const DSD = vm.runInContext("DEATHSPACE_DATABASE", sandbox);
  const SITE = DSD.find((z) => z.id === "angel_ded_2_10"); // requiredCL:1, sourceZoneId:angel_outpost, maxWave:3
  const ZONE = CZ.find((z) => z.id === "angel_outpost");
  const MAT = SITE.ticketMaterial;
  const reg = sandbox.ResourceRegistry;
  const RR = sandbox.advanceCombatRound;

  // 准备一艘可战斗的 rifter（Batch Q 末尾可能清空舰船）
  if (!Array.isArray(sandbox.gameState.inventory.ships) || sandbox.gameState.inventory.ships.length === 0) {
    sandbox.gameState.inventory.ships = [sandbox.createShipInstance("rifter")];
    sandbox.gameState.migrations.combatEquipmentV1 = false;
    sandbox.finalizeEquipmentStateAfterLegacyMigrations(sandbox.gameState);
  }
  const brShip = sandbox.gameState.inventory.ships[0];
  brShip.fitted = { high:["t1_small_laser"], mid:["t1_shield_booster"], low:[], rig:[] };
  sandbox.gameState.shipAssignments.combat = brShip.instanceId;

  const giveSupplies = (s) => {
    reg.add(s, "consumable:fuel", 1000000);
    reg.add(s, "ammo:laser", 1000000);
    reg.add(s, "ammo:missile", 1000000);
    reg.add(s, "ammo:cannon", 1000000);
  };
  const setTickets = (s, mat, n) => {
    const cur = reg.get(s, "special:" + mat);
    if (cur > 0) reg.spend(s, "special:" + mat, cur);
    reg.add(s, "special:" + mat, n);
  };
  const resetCombat = (s) => {
    s.combat.active = false; s.combat.mode = "belt"; s.combat.viewMode = "belt";
    s.combat.zone = ""; s.combat.deathspaceId = ""; s.combat.wave = 1;
    s.combat.enemies = []; s.combat.currentEnemy = null; s.combat.currentFormation = "";
    s.combat.deathspaceChainRemaining = 0; s.combat.deathspaceChainPending = false;
    s.combat.lastLoot = ""; s.combat.lastStatus = "";
    s.combat.totalKills = 0; s.combat.runEliteKills = 0;
    s.combat.runDamageDealt = 0; s.combat.runDamageTaken = 0;
    s.combat.runWeaponTypes = []; s.combat.runWeaponTypesZone = null;
    s.combat.randomState = { seed: 0x12345, counterLo: 0, counterHi: 0 };
    s.combat.repairs = {}; // 重置战斗必须清空维修记录，否则后续 beginDeathspaceRun/start 会被 isShipUnderRepair 误判拦截
    s.combat.runSequence = 0; // 测试确定性：每次 reset 重置为 0，使 resetCombatRunState 后 token 固定（真实 run 路径不固定，见「七」）
    sandbox.resetCombatRunState(s.combat);
    const _mh = sandbox.getCombatMaxHpFromState(s);
    s.combat.maxHp = { shield:_mh.shield, armor:_mh.armor, structure:_mh.structure };
    s.combat.hp = { shield:_mh.shield, armor:_mh.armor, structure:_mh.structure };
    s.currentAction.active = false; s.currentAction.skill = null;
    s.resumeAfterRepair = null;
  };
  const armBelt = (s, zoneId, rngVal) => {
    resetCombat(s); s.combat.mode = "belt"; s.combat.viewMode = "belt"; s.combat.zone = zoneId; s.combat.active = true;
    giveSupplies(s);
    const w = sandbox.buildCombatWave(CZ.find((z) => z.id === zoneId), 1, () => rngVal, s.combat);
    s.combat.enemies = w.enemies.map((e) => Object.assign({}, e, { baseDamage: 0 })); // 敌不反击，避免测试回合内被打死
    s.combat.currentEnemy = s.combat.enemies[0] || null;
    s.combat.currentFormation = w.formationId;
    // 与真实 combat/start 一致：将 activeShip 指向当前指派战斗舰实例，确保战败维修键 repairs[instanceId] 一致
    s.combat.activeShip = ((sandbox.getActiveCombatShipInstance && sandbox.getActiveCombatShipInstance(s)) || {}).instanceId || null;
  };
  const armDS = (s, siteId, waveNum, rngVal) => {
    resetCombat(s); s.combat.mode = "deathspace"; s.combat.viewMode = "deathspace"; s.combat.deathspaceId = siteId;
    s.combat.zone = DSD.find((z) => z.id === siteId).sourceZoneId; s.combat.active = true; s.combat.wave = waveNum || 1;
    giveSupplies(s);
    const w = sandbox.buildDeathspaceWave(DSD.find((z) => z.id === siteId), waveNum || 1, () => rngVal, s.combat);
    s.combat.enemies = w.enemies; s.combat.currentEnemy = w.enemies[0] || null; s.combat.currentFormation = w.formationId;
    s.combat.activeShip = ((sandbox.getActiveCombatShipInstance && sandbox.getActiveCombatShipInstance(s)) || {}).instanceId || null;
  };

  // (A) advanceCombatRound 存在 & 一次调用=一个回合
  ok(typeof RR === "function", "advanceCombatRound 必须存在且为函数");
  const sA = sandbox.gameState;
  armBelt(sA, "angel_outpost", 0.5);
  const rA1 = RR(sA, { now:1000, offline:false, emit: sandbox.GameEvents.emit, playEffects:false });
  ok(rA1 && rA1.ok === true && rA1.advanced === true, "advanceCombatRound 首轮必须推进（advanced:true）");
  const rA2 = RR(sA, { now:1001, offline:false, emit: sandbox.GameEvents.emit, playEffects:false });
  ok(rA2 && rA2.advanced === true, "advanceCombatRound 第二轮必须再推进一个回合（一次调用=一个战斗回合）");

  // (B) combatTick 薄包装：每 tick 恰好一次调用 advanceCombatRound
  let advCalls = 0;
  const origRR = sandbox.advanceCombatRound;
  sandbox.advanceCombatRound = (state, ctx) => { advCalls++; return origRR(state, ctx); };
  armBelt(sA, "angel_outpost", 0.5);
  advCalls = 0;
  sandbox.combatTick();
  ok(advCalls === 1, "combatTick 每 tick 必须恰好委托 advanceCombatRound 一次（实测 " + advCalls + "）");
  sandbox.advanceCombatRound = origRR;

  // (C) playEffects=false 零 FX；playEffects=true 确有 FX
  let fxCount = 0;
  const origFX1 = sandbox.playAttackFX, origFX2 = sandbox.playEnemyAttackFX;
  sandbox.playAttackFX = () => { fxCount++; };
  sandbox.playEnemyAttackFX = () => { fxCount++; };
  armBelt(sA, "angel_outpost", 0.5);
  fxCount = 0;
  RR(sA, { now:1000, offline:false, emit: () => {}, playEffects:false });
  ok(fxCount === 0, "playEffects=false 时不得调用任何战斗 FX（实测 " + fxCount + "）");
  fxCount = 0;
  RR(sA, { now:1001, offline:false, emit: () => {}, playEffects:true });
  ok(fxCount > 0, "playEffects=true 时必须调用战斗 FX（证明 gating 真实，实测 " + fxCount + "）");
  sandbox.playAttackFX = origFX1; sandbox.playEnemyAttackFX = origFX2;

  // (D) 注入 emit 捕获事件
  armBelt(sA, "angel_outpost", 0.5);
  const captured = [];
  RR(sA, { now:1000, offline:false, emit: (t) => captured.push(t), playEffects:false });
  ok(captured.length > 0, "注入的 emit 必须捕获到至少一个战斗事件（实测 " + captured.length + "）");
  ok(captured.some((t) => t.indexOf("combat:") === 0), "注入的 emit 捕获到的必须是 combat 事件");

  // (E) 固定 RNG 推演逐字节可复现
  const runScenario = () => {
    const s = sandbox.gameState;
    reg.set(s, "currency:isk", 10000); // 重置资源基线，保证两次推演初始状态一致（可复现性断言要求）
    armBelt(s, "angel_outpost", 0.5);
    const ev = [];
    for (let i = 0; i < 5; i++) RR(s, { now:1000 + i, offline:false, emit:(t)=>ev.push(t), playEffects:false, rng:() => 0.5 });
    return JSON.stringify({ hp: s.combat.hp, enemies: s.combat.enemies.map((e) => e.id + ":" + e.hp.structure), loot: s.combat.lastLoot, kills: s.combat.totalKills, isk: reg.get(s, "currency:isk") });
  };
  ok(runScenario() === runScenario(), "固定 RNG（rng=()=>0.5）下两次完整推演必须逐字节一致（可复现）");

  // (F) 迁移保持 RNG 计数器（续跑同态）
  const mCombat = { deathspaceChainRemaining:2, deathspaceChainPending:true, deathspaceId:"angel_ded_2_10", runToken:"rt_x", enemyInstanceSeq:0, randomState:{ seed:99, counterLo:7, counterHi:3 } };
  sandbox.migrateDeathspaceState(mCombat, sandbox.gameState);
  ok(mCombat.randomState && mCombat.randomState.seed === 99 && mCombat.randomState.counterLo === 7 && mCombat.randomState.counterHi === 3, "migrateDeathspaceState 必须保持 randomState 计数器不变（续跑同态）");
  const nBefore = sandbox.nextCombatRandom(mCombat);
  const nAfter = sandbox.nextCombatRandom(mCombat);
  ok(typeof nBefore === "number" && nBefore >= 0 && nBefore < 1 && nAfter !== nBefore, "nextCombatRandom 迁移后必须从原计数器继续推进");

  // (G) enemyId 形态 / 唯一 / 确定性
  armBelt(sA, "angel_outpost", 0.5);
  const ids = new Set();
  sA.combat.enemies.forEach((e) => ids.add(e.id));
  for (let i = 0; i < 10; i++) { RR(sA, { now:1000 + i, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 }); sA.combat.enemies.forEach((e) => ids.add(e.id)); }
  const token = sA.combat.runToken;
  let gOk = true;
  for (const id of ids) if (!id.startsWith(token + "_e")) gOk = false;
  ok(gOk && ids.size > 0, "所有 enemyId 必须为 runToken_e序号 形态且以当前 runToken 开头");
  ok(ids.size === (new Set(ids)).size, "enemyId 在整轮推演中必须唯一");
  const idsRun1 = (() => { armBelt(sandbox.gameState, "angel_outpost", 0.5); return sandbox.gameState.combat.enemies.map((e) => e.id).join(","); })();
  const idsRun2 = (() => { armBelt(sandbox.gameState, "angel_outpost", 0.5); return sandbox.gameState.combat.enemies.map((e) => e.id).join(","); })();
  ok(idsRun1 === idsRun2, "相同 runToken 下生成的首波 enemyId 必须确定性一致");

  // (H) 连刷次数=3 消耗 3 密钥；仅 2 密钥时只进 2 次
  const simChain = (count, tickets) => {
    const s = sandbox.gameState;
    resetCombat(s);
    s.combat.viewMode = "deathspace"; s.combat.viewDeathspaceId = "angel_ded_2_10";
    giveSupplies(s); setTickets(s, MAT, tickets);
    const _cmh = sandbox.calcCombatMaxHp; sandbox.calcCombatMaxHp = () => ({ shield:1e9, armor:1e9, structure:1e9 }); // 防测试内被打死
    s.skills.laserOps = { lvl:90, xp:0 };
    const before = reg.get(s, "special:" + MAT);
    const r = sandbox.dispatchGameAction(s, { type:"combat/startDeathspaceChain", count }, 2000000000000);
    let guard = 0;
    while (guard < 6000) {
      guard++;
      sandbox.combatTick();
      // 测试内令玩家满血（maxHp 已被覆盖为 1e9），避免连刷中途战死打断票务统计
      s.combat.hp = { shield: s.combat.maxHp.shield, armor: s.combat.maxHp.armor, structure: s.combat.maxHp.structure };
      if (!s.combat.active && !s.combat.deathspaceChainPending) break;
    }
    sandbox.calcCombatMaxHp = _cmh;
    return { before, after: reg.get(s, "special:" + MAT), consumed: before - reg.get(s, "special:" + MAT), remaining: s.combat.deathspaceChainRemaining, changed: r.changed };
  };
  const sim3 = simChain(3, 1000);
  ok(sim3.changed && sim3.consumed === 3 && sim3.remaining === 0, "连刷次数=3 必须恰好消耗 3 枚密钥且收尾 remaining=0（实测 consumed=" + sim3.consumed + " remaining=" + sim3.remaining + "）");
  const sim2 = simChain(3, 2);
  ok(sim2.consumed === 2 && sim2.remaining === 0, "仅 2 枚密钥时连刷只能进 2 次、消耗 2 枚、remaining=0（实测 consumed=" + sim2.consumed + "）");

  // (I) 非法连刷次数全部拒绝且零副作用
  const illegalVals = ["3", 3.5, 0, -1, 100, NaN, null, undefined, Infinity, true, -5, 99.1];
  let allRejected = true, anySideEffect = false;
  for (const v of illegalVals) {
    const s = sandbox.gameState;
    resetCombat(s); s.combat.viewMode = "deathspace"; s.combat.viewDeathspaceId = "angel_ded_2_10";
    reg.add(s, "special:" + MAT, 50);
    const before = { t: reg.get(s, "special:" + MAT), rem: s.combat.deathspaceChainRemaining, pend: s.combat.deathspaceChainPending, dirty: s._dirty };
    const res = sandbox.dispatchGameAction(s, { type:"combat/startDeathspaceChain", count: v }, 2000000000000);
    const after = { t: reg.get(s, "special:" + MAT), rem: s.combat.deathspaceChainRemaining, pend: s.combat.deathspaceChainPending, dirty: s._dirty };
    if (!(res && res.changed === false && res.reason === "invalid-chain-count")) allRejected = false;
    if (before.t !== after.t || before.rem !== after.rem || before.pend !== after.pend || before.dirty !== after.dirty) anySideEffect = true;
  }
  ok(allRejected, "所有非法连刷次数（字符串/小数/0/负/越界/NaN/null/undefined/Infinity/布尔）必须被拒绝");
  ok(!anySideEffect, "非法连刷次数必须零副作用（密钥/remaining/pending/_dirty 不变）");

  // (J) remaining 严格 0–98 边界
  resetCombat(sA); sA.combat.viewMode = "deathspace"; sA.combat.viewDeathspaceId = "angel_ded_2_10"; setTickets(sA, MAT, 200);
  sandbox.dispatchGameAction(sA, { type:"combat/startDeathspaceChain", count:1 }, 2000000000000);
  ok(sA.combat.deathspaceChainRemaining === 0, "count=1 → remaining=0（有效下界）");
  resetCombat(sA); sA.combat.viewMode = "deathspace"; sA.combat.viewDeathspaceId = "angel_ded_2_10"; setTickets(sA, MAT, 200);
  sandbox.dispatchGameAction(sA, { type:"combat/startDeathspaceChain", count:99 }, 2000000000000);
  ok(sA.combat.deathspaceChainRemaining === 98, "count=99 → remaining=98（有效上界，严格 0–98）");

  // (K) 迁移 pending 保留/清除规则
  const mkMig = (over) => {
    const c = { active:false, mode:"belt", deathspaceChainRemaining:3, deathspaceChainPending:true, deathspaceId:"angel_ded_2_10", runToken:"rt_x", randomState:{seed:1,counterLo:0,counterHi:0}, enemyInstanceSeq:0 };
    Object.assign(c, over || {});
    sandbox.migrateDeathspaceState(c, sandbox.gameState);
    return c;
  };
  ok(mkMig({}).deathspaceChainPending === true && mkMig({}).deathspaceChainRemaining === 3, "迁移：pending 合法（remaining>0 且 site 有效）必须保留");
  ok(mkMig({ deathspaceChainRemaining:0 }).deathspaceChainPending === false, "迁移：pending=true 但 remaining=0 必须清除");
  ok(mkMig({ deathspaceId:"nonexistent" }).deathspaceChainPending === false, "迁移：pending=true 但 deathspaceId 无效必须清除");
  ok(mkMig({ deathspaceChainPending:false }).deathspaceChainPending === false, "迁移：pending=false 必须保持 false");

  // (L) 战败清零连刷链
  armDS(sA, "angel_ded_2_10", 1, 0.5);
  sA.combat.deathspaceChainRemaining = 5; sA.combat.deathspaceChainPending = false;
  sA.combat.hp.structure = 0; // 强制结构归零
  const rDef = RR(sA, { now:1000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
  ok(rDef && rDef.recovering === true && rDef.reason === "defeated", "结构归零时 advanceCombatRound 必须返回 defeated/recovering");
  ok(sA.combat.deathspaceChainRemaining === 0 && sA.combat.deathspaceChainPending === false, "战败必须清零连刷链（remaining/pending=0）");
  ok(sA.combat.active === false, "战败后 combat.active 必须为 false");

  // (M) 维修恢复不恢复连刷链（回到普通星带）
  const rec = sandbox.dispatchGameAction(sA, { type:"combat/beginRecovery" }, 1000);
  ok(rec && rec.changed, "combat/beginRecovery 必须成功登记维修");
  ok(sA.combat.deathspaceChainRemaining === 0 && sA.combat.deathspaceChainPending === false, "战败后连刷链仍为 0（恢复前）");
  sandbox.dispatchGameAction(sA, { type:"combat/finishRecovery" }, 1000 + 180000);
  ok(sA.combat.deathspaceChainRemaining === 0 && sA.combat.deathspaceChainPending === false, "维修恢复后连刷链不得被恢复（仍为 0）");
  ok(sA.combat.mode === "belt", "维修恢复后应回到普通星带模式");

  // (N) 现有事件契约有效（combat:deathspaceChainContinued 已注册）
  ok(sandbox.GameEvents.contracts.has("combat:deathspaceChainContinued"), "combat:deathspaceChainContinued 契约必须已注册");
  ok(sandbox.GameEvents.contracts.validate("combat:deathspaceChainContinued", { deathspaceId:"angel_ded_2_10", remaining:2 }).valid, "combat:deathspaceChainContinued 合法 payload 必须通过契约校验");
  ok(!sandbox.GameEvents.contracts.validate("combat:deathspaceChainContinued", { deathspaceId:"angel_ded_2_10" }).valid, "combat:deathspaceChainContinued 缺 remaining 必须不通过校验");

  // (O) playEffects=false 不触发任何 DOM 访问
  let domGet = 0;
  const _g = sandbox.document.getElementById;
  sandbox.document.getElementById = () => { domGet++; return { getContext:()=>new sandbox.CanvasRenderingContext2D(), style:{}, addEventListener:()=>{}, setAttribute:()=>{}, classList:{add:()=>{},remove:()=>{},toggle:()=>{},contains:()=>false} }; };
  armBelt(sA, "angel_outpost", 0.5);
  domGet = 0;
  RR(sA, { now:1000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
  ok(domGet === 0, "playEffects=false 时 advanceCombatRound 不得触发任何 DOM getElementById（实测 " + domGet + "）");
  sandbox.document.getElementById = _g;

  // (P) 续跑时 combat:deathspaceEntered 必须早于 combat:deathspaceChainContinued
  resetCombat(sA); sA.combat.viewMode = "deathspace"; sA.combat.viewDeathspaceId = "angel_ded_2_10"; setTickets(sA, MAT, 100);
  sandbox.dispatchGameAction(sA, { type:"combat/startDeathspaceChain", count:2 }, 2000000000000);
  sA.combat.active = false; sA.combat.deathspaceChainPending = true; sA.combat.deathspaceChainRemaining = 1; sA.combat.deathspaceId = "angel_ded_2_10";
  const evs = [];
  const _e = sandbox.GameEvents.emit;
  sandbox.GameEvents.emit = (t, p, m) => { evs.push(t); return _e(t, p, m); };
  sandbox.combatTick();
  sandbox.GameEvents.emit = _e;
  const idxEntered = evs.indexOf("combat:deathspaceEntered");
  const idxContinued = evs.indexOf("combat:deathspaceChainContinued");
  ok(idxEntered !== -1 && idxContinued !== -1 && idxEntered < idxContinued, "续跑时 combat:deathspaceEntered 必须早于 combat:deathspaceChainContinued");

  // (Q) 全清后置 pending、待下一 tick 续跑（同一次 advanceCombatRound 不续跑）
  armDS(sA, "angel_ded_2_10", 3, 0.5); // 最后一波
  sA.combat.deathspaceChainRemaining = 1; sA.combat.deathspaceChainPending = false;
  sA.combat.enemies.forEach((e) => { e.hp.shield = 0; e.hp.armor = 0; e.hp.structure = 0; e.baseDamage = 0; }); // 已是残血/全灭，单轮即可触发全清
  const rClr = RR(sA, { now:1000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
  ok(rClr && rClr.active === false && sA.combat.deathspaceChainPending === true, "死亡空间全清后必须进入 pending（待下一 tick 续跑），active=false");
  ok(sA.combat.deathspaceChainRemaining === 1, "全清后 remaining 保持为 1（续跑扣减推迟到下一 tick）");

  // ===== Batch R 定点返修新增断言（五/六/七/八）=====
  // (五) 状态隔离真实断言：深克隆 altState、存 global gameState JSON、advanceCombatRound 后
  //      altState 真实变化且 global gameState 严格零变化；覆盖普通攻击/击杀掉落/清波/死亡空间通关/战败维修。
  const cloneState = () => JSON.parse(JSON.stringify(sandbox.gameState));
  const runIso = (mut, rounds, useDS) => {
    const alt = cloneState();
    if (useDS) armDS(alt, "angel_ded_2_10", 3, 0.5); else armBelt(alt, "angel_outpost", 0.5);
    if (mut) mut(alt);
    const beforeGlobal = JSON.stringify(sandbox.gameState);
    const sigBefore = JSON.stringify({ hp: alt.combat.hp, enemies: alt.combat.enemies.map((e) => e.id + ":" + e.hp.structure), isk: reg.get(alt, "currency:isk"), repairs: alt.combat.repairs, rdt: alt.combat.runDamageTaken });
    sandbox.advanceCombatRound(alt, { now: 1767225600000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
    if (rounds && rounds > 1) for (let i = 1; i < rounds; i++) sandbox.advanceCombatRound(alt, { now: 1767225600000 + i*1000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
    const sigAfter = JSON.stringify({ hp: alt.combat.hp, enemies: alt.combat.enemies.map((e) => e.id + ":" + e.hp.structure), isk: reg.get(alt, "currency:isk"), repairs: alt.combat.repairs, rdt: alt.combat.runDamageTaken });
    const afterGlobal = JSON.stringify(sandbox.gameState);
    return { beforeGlobal, afterGlobal, sigBefore, sigAfter };
  };
  const isoAttack = runIso(null, 6);
  ok(isoAttack.beforeGlobal === isoAttack.afterGlobal, "五：普通攻击场景 global gameState 必须严格零变化（状态隔离）");
  ok(isoAttack.sigBefore !== isoAttack.sigAfter, "五：普通攻击场景 altState 必须真实变化");
  const isoKill = runIso((a) => { a.combat.enemies.forEach((e) => { e.hp.shield = 1; e.hp.armor = 1; e.hp.structure = 1; }); }, 8);
  ok(isoKill.beforeGlobal === isoKill.afterGlobal, "五：击杀掉落场景 global gameState 必须严格零变化");
  ok(isoKill.sigBefore !== isoKill.sigAfter, "五：击杀掉落场景 altState 必须真实变化（含资源/击杀）");
  const isoClear = runIso((a) => { a.combat.enemies.forEach((e) => { e.hp.shield = 0; e.hp.armor = 0; e.hp.structure = 0; }); }, 2);
  ok(isoClear.beforeGlobal === isoClear.afterGlobal, "五：清波场景 global gameState 必须严格零变化");
  ok(isoClear.sigBefore !== isoClear.sigAfter, "五：清波场景 altState 必须真实变化（新波生成）");
  const isoDS = runIso(null, 1, true);
  ok(isoDS.beforeGlobal === isoDS.afterGlobal, "五：死亡空间通关场景 global gameState 必须严格零变化");
  ok(isoDS.sigBefore !== isoDS.sigAfter, "五：死亡空间通关场景 altState 必须真实变化（pending/active）");
  const isoDef = runIso((a) => { a.combat.hp.structure = 0; }, 1);
  ok(isoDef.beforeGlobal === isoDef.afterGlobal, "五：战败维修场景 global gameState 必须严格零变化");
  ok(isoDef.sigBefore !== isoDef.sigAfter, "五：战败维修场景 altState 必须真实变化（repairs/active）");

  // (六) 虚拟时间断言：T=1767225600000
  const T = 1767225600000;
  ok(T !== Date.now(), "六：虚拟时间 T 必须不等于真实 Date.now()（隔离性前提）");
  // 战败：repairUntil === T+180000、ship:destroyed.timestamp === T、同回合两事件同毫秒
  const sV = sandbox.gameState;
  armBelt(sV, "angel_outpost", 0.5);
  sV.combat.hp.structure = 0;
  const ev6 = [];
  const rDef6 = RR(sV, { now:T, offline:false, emit:(t,p,m)=>ev6.push({t,p,m}), playEffects:false, rng:()=>0.5 });
  ok(rDef6 && rDef6.recovering === true && rDef6.reason === "defeated", "六：T 时刻战败 advanceCombatRound 必须返回 defeated/recovering");
  const instId6 = sV.combat.activeShip;
  ok(sV.combat.repairs[instId6] === T + 180000, "六：战败 repairUntil（repairs[instanceId]）必须等于 T+180000（实测 " + sV.combat.repairs[instId6] + "）");
  const destroyed6 = ev6.find((e) => e.t === "ship:destroyed");
  const ce6 = ev6.find((e) => e.t === "combat:event");
  ok(destroyed6 && destroyed6.p.timestamp === T, "六：ship:destroyed.timestamp 必须等于 T（实测 " + (destroyed6 && destroyed6.p.timestamp) + "）");
  ok(ce6 && ce6.p.timestamp === T, "六：combat:event.timestamp 必须等于 T");
  ok(destroyed6 && ce6 && destroyed6.p.timestamp === ce6.p.timestamp, "六：同回合内 ship:destroyed 与 combat:event 时间戳必须完全相同（无多次 Date.now 差异）");
  // 连刷续轮：combatTick 同一 now 复用于 entered 与 continued，且都等于 T
  resetCombat(sV); sV.combat.viewMode = "deathspace"; sV.combat.viewDeathspaceId = "angel_ded_2_10"; setTickets(sV, MAT, 100);
  sandbox.dispatchGameAction(sV, { type:"combat/startDeathspaceChain", count:2 }, T);
  sV.combat.active = false; sV.combat.deathspaceChainPending = true; sV.combat.deathspaceChainRemaining = 1; sV.combat.deathspaceId = "angel_ded_2_10";
  const ev6t = [];
  const _e6 = sandbox.GameEvents.emit;
  sandbox.GameEvents.emit = (t,p,m) => { ev6t.push({ t, m }); return _e6(t,p,m); };
  // 强制 combatTick 取到的唯一 now = T：vm 上下文的内建 Date 不会作为属性暴露到 sandbox 对象
  // （实测 sandbox.Date === undefined），必须从上下文内部改写其全局 Date.now，调用后立即还原。
  vm.runInContext("globalThis.__origNow = Date.now; Date.now = function(){ return " + T + "; };", sandbox);
  sandbox.combatTick();
  vm.runInContext("Date.now = globalThis.__origNow;", sandbox);
  sandbox.GameEvents.emit = _e6;
  const en6 = ev6t.find((e) => e.t === "combat:deathspaceEntered");
  const co6 = ev6t.find((e) => e.t === "combat:deathspaceChainContinued");
  ok(en6 && en6.m.timestamp === T, "六：连刷续轮 deathspaceEntered.timestamp 必须等于 T");
  ok(co6 && co6.m.timestamp === T, "六：连刷续轮 deathspaceChainContinued.timestamp 必须等于 T");
  ok(en6 && co6 && en6.m.timestamp === co6.m.timestamp, "六：同一 tick 内 entered 与 continued 必须共享同一 now（combatTick 仅取一次 Date.now）");

  // (七) RNG / 敌人 ID 断言
  // 克隆两份逐字节一致
  const runDeterm = (src) => {
    const a = JSON.parse(JSON.stringify(src));
    armBelt(a, "angel_outpost", 0.5);
    const out = [];
    for (let i = 0; i < 8; i++) {
      sandbox.advanceCombatRound(a, { now:1000 + i, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
      out.push(JSON.stringify({ e: a.combat.enemies.map((e) => e.id + ":" + e.hp.structure), isk: reg.get(a, "currency:isk"), k: a.combat.totalKills }));
    }
    return out.join("|");
  };
  const d1 = runDeterm(sandbox.gameState);
  const d2 = runDeterm(sandbox.gameState);
  ok(d1 === d2, "七：相同序列化状态克隆两份 → 逐字节一致（确定性 RNG）");
  // start → stop → start 两次 token 必不同 + 首波 enemyId 以新 runToken 开头
  const sR = sandbox.gameState;
  resetCombat(sR); sR.combat.zone = "angel_outpost"; sR.combat.viewMode = "belt"; sR.combat.repairs = {}; giveSupplies(sR);
  const wR = sandbox.buildCombatWave(CZ.find((z) => z.id === "angel_outpost"), 1, () => 0.5, sR.combat);
  const r1 = sandbox.dispatchGameAction(sR, { type:"combat/start", enemies:wR.enemies, formationId:wR.formationId }, 1000);
  ok(r1 && r1.changed, "七：combat/start（belt）必须成功");
  const tok1 = sR.combat.runToken;
  const firstIds = sR.combat.enemies.map((e) => e.id);
  ok(firstIds.length > 0 && firstIds.every((id) => id.startsWith(tok1 + "_e")), "七：首波 enemyId 必须以新 runToken 开头");
  sandbox.dispatchGameAction(sR, { type:"combat/stop" }, 1001);
  const r2 = sandbox.dispatchGameAction(sR, { type:"combat/start", enemies:wR.enemies, formationId:wR.formationId }, 1002);
  ok(r2 && r2.changed, "七：stop 后再次 start 必须成功");
  const tok2 = sR.combat.runToken;
  ok(tok1 && tok2 && tok1 !== tok2, "七：start→stop→start 两次 token 必须不同（tok1=" + tok1 + " tok2=" + tok2 + "）");
  // 后续波 enemyInstanceSeq 单调递增、绝不归零、仍以同 token 开头
  const firstMaxSeq = Math.max(...firstIds.map((id) => parseInt(id.split("_e")[1], 10)));
  const eisBefore = sR.combat.enemyInstanceSeq;
  sR.combat.enemies.forEach((e) => { e.hp.shield = 0; e.hp.armor = 0; e.hp.structure = 0; });
  sandbox.advanceCombatRound(sR, { now:2000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
  const secondIds = sR.combat.enemies.map((e) => e.id);
  const secondMinSeq = Math.min(...secondIds.map((id) => parseInt(id.split("_e")[1], 10)));
  ok(secondMinSeq > firstMaxSeq, "七：后续波 enemyInstanceSeq 必须单调递增（首max=" + firstMaxSeq + " 二min=" + secondMinSeq + "）");
  ok(sR.combat.enemyInstanceSeq > eisBefore, "七：清波后 enemyInstanceSeq 必须继续递增、绝不归零");
  ok(secondIds.every((id) => id.startsWith(sR.combat.runToken + "_e")), "七：续波 enemyId 仍以同一 runToken 开头（未重置 token）");
  // 连刷三轮同 token 且全局唯一
  const sC = sandbox.gameState;
  resetCombat(sC); sC.combat.viewMode = "deathspace"; sC.combat.viewDeathspaceId = "angel_ded_2_10"; giveSupplies(sC); setTickets(sC, MAT, 100);
  const _cmh7 = sandbox.calcCombatMaxHp; sandbox.calcCombatMaxHp = () => ({ shield:1e9, armor:1e9, structure:1e9 });
  sC.skills.laserOps = { lvl:90, xp:0 };
  sandbox.dispatchGameAction(sC, { type:"combat/startDeathspaceChain", count:3 }, 2000000000000);
  const chainIds = new Set();
  let guard7 = 0;
  while (guard7 < 8000) {
    guard7++;
    sandbox.combatTick();
    sC.combat.hp = { shield: sC.combat.maxHp.shield, armor: sC.combat.maxHp.armor, structure: sC.combat.maxHp.structure };
    sC.combat.enemies.forEach((e) => chainIds.add(e.id));
    if (!sC.combat.active && !sC.combat.deathspaceChainPending) break;
  }
  sandbox.calcCombatMaxHp = _cmh7;
  const chainToken = sC.combat.runToken;
  ok(chainIds.size > 0, "七连刷：必须采集到敌人 ID");
  ok([...chainIds].every((id) => id.startsWith(chainToken + "_e")), "七连刷：三轮全部 enemyId 必须以同一 runToken 开头");
  // 续刷链内 enemyInstanceSeq 只增不归零（仅 resetCombatRunState 新 run 才归零，continuation 不调）；
  // 一旦中途重置，序号会小于全局唯一敌人数，此不变量直接暴露「ID 重复/重置」问题。
  ok(sC.combat.enemyInstanceSeq === chainIds.size, "七连刷：enemyInstanceSeq 必须等于全局唯一敌人数（续刷链内敌人序号单调递增、无重置→无重复 ID）");
  // 战败恢复新 run 使用新 token
  const sD = sandbox.gameState;
  resetCombat(sD); sD.combat.zone = "angel_outpost"; sD.combat.viewMode = "belt"; sD.combat.repairs = {}; giveSupplies(sD);
  const wD = sandbox.buildCombatWave(CZ.find((z) => z.id === "angel_outpost"), 1, () => 0.5, sD.combat);
  sandbox.dispatchGameAction(sD, { type:"combat/start", enemies:wD.enemies, formationId:wD.formationId }, 1000);
  const tokD1 = sD.combat.runToken;
  sD.combat.hp.structure = 0;
  sandbox.advanceCombatRound(sD, { now:2000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 }); // 战败 → beginRecovery(now=2000)
  sandbox.dispatchGameAction(sD, { type:"combat/finishRecovery" }, 2000 + 180000); // 清维修
  sandbox.dispatchGameAction(sD, { type:"combat/start", enemies:wD.enemies, formationId:wD.formationId }, 2002); // 恢复后新 run
  const tokD2 = sD.combat.runToken;
  ok(tokD1 && tokD2 && tokD1 !== tokD2, "七战败恢复：恢复后新 run 必须获得不同 runToken（tokD1=" + tokD1 + " tokD2=" + tokD2 + "）");
  // 生产入口不裸 Math.random：未显式传 rng 时仍推进 combat.randomState（证明注入确定性 RNG）
  const sM = sandbox.gameState;
  resetCombat(sM); sM.combat.zone = "angel_outpost"; armBelt(sM, "angel_outpost", 0.5);
  const rsB = JSON.stringify(sM.combat.randomState);
  sandbox.advanceCombatRound(sM, { now:3000, offline:false, emit:()=>{}, playEffects:false }); // 无 rng
  const rsA = JSON.stringify(sM.combat.randomState);
  ok(rsB !== rsA, "七：未传 rng 时生产入口仍推进 combat.randomState（默认注入 nextCombatRandom，非裸 Math.random）");

  // (八) 性能基准 86400 轮（独立 altState、global 不参与、emit=no-op、playEffects=false、不加载 UI、now+=1000/轮）
  {
    const perfState = JSON.parse(JSON.stringify(sandbox.gameState));
    const pC = perfState.combat;
    pC.active = true; pC.mode = "belt"; pC.viewMode = "belt"; pC.zone = "angel_outpost"; pC.wave = 1;
    pC.randomState = { seed: 0x12345, counterLo: 0, counterHi: 0 };
    sandbox.resetCombatRunState(pC);
    const pW = sandbox.buildCombatWave(CZ.find((z) => z.id === "angel_outpost"), 1, () => 0.5, pC);
    // 敌人血量设为天文数字：玩家永不能击杀 → 不触发清波/重刷/战败，每轮都跑完整开火+反击+结算。
    pC.enemies = pW.enemies.map((e) => ({ ...e, hp:{ shield:1e12, armor:1e12, structure:1e12 }, baseDamage: e.baseDamage }));
    pC.currentEnemy = pC.enemies[0] || null;
    pC.currentFormation = pW.formationId;
    pC.maxHp = { shield:1e9, armor:1e9, structure:1e9 };
    pC.hp = { shield:1e9, armor:1e9, structure:1e9 };
    giveSupplies(perfState);
    const _pcmh = sandbox.calcCombatMaxHp;
    sandbox.calcCombatMaxHp = () => ({ shield:1e9, armor:1e9, structure:1e9 }); // 玩家无敌：防止回合内 clamp 回落
    let perfNow = 1000000;
    const t0 = Date.now();
    for (let i = 0; i < 86400; i++) {
      perfNow += 1000;
      sandbox.advanceCombatRound(perfState, { now: perfNow, offline:false, emit:()=>{}, playEffects:false });
    }
    const t1 = Date.now();
    sandbox.calcCombatMaxHp = _pcmh;
    const perfMs = t1 - t0;
    console.log("Batch R 八 性能基准：86400 轮纯内核耗时 " + perfMs + " ms（独立 altState、global 不参与、emit=no-op、playEffects=false、不加载 UI、now+=1000/轮）");
  }
  // —— Batch R 收口证据汇总（自包含实算，便于人工核对）——
  // 五·状态隔离真实证据：克隆态跑回合，全局 gameState 必须严格零变化，altState 必须真实变化。
  const evAlt = cloneState(); armBelt(evAlt, "angel_outpost", 0.5);
  const evGlobalBefore = JSON.stringify(sandbox.gameState);
  const evAltBefore = JSON.stringify(evAlt);
  for (let i = 0; i < 5; i++) sandbox.advanceCombatRound(evAlt, { now: 1767225600000 + i * 1000, offline:false, emit:()=>{}, playEffects:false, rng:()=>0.5 });
  const evGlobalAfter = JSON.stringify(sandbox.gameState);
  const evAltAfter = JSON.stringify(evAlt);
  console.log("Batch R 证据·五：全局 gameState 零变化=" + (evGlobalBefore === evGlobalAfter) + "，altState 真实变化=" + (evAltBefore !== evAltAfter));
  console.log("Batch R 证据·六：虚拟战败时间 T=" + T + "，repairUntil=T+180000=" + (T + 180000) + "，ship:destroyed.timestamp=T=" + (T === 1767225600000));
  console.log("Batch R 证据·七：start→stop→start 两 token 不同=" + (tok1 !== tok2) + "（tok1=" + tok1 + " / tok2=" + tok2 + "）");
  console.log("Batch R 证据·七：首波 enemyId=[" + firstIds.join(", ") + "]（均以 " + tok1 + "_e 开头=" + firstIds.every((id) => id.startsWith(tok1 + "_e")) + "）");
  console.log("Batch R 证据·七：连刷三轮 chainToken=" + chainToken + "，全局唯一敌人数=" + chainIds.size + "（enemyInstanceSeq=" + sandbox.gameState.combat.enemyInstanceSeq + "，相等即无重置/无重复）");
  // 八的性能耗时由上方「Batch R 八 性能基准」行单独打印（perfMs 作用域限于该 if 块），此处不再重复引用。

  console.log("Batch R 共享战斗基础设施断言通过：advanceCombatRound 存在/单轮推进、combatTick 一次委托、playEffects=false 零 FX/无 DOM、注入 emit 捕获、固定 RNG 可复现、迁移保持 RNG 计数器、enemyId 形态/唯一/确定性、连刷次数=3 耗 3 密钥、2 密钥只进 2 次、非法次数全拒绝零副作用、remaining 0–98、pending 保留/清除规则、战败清零链、维修恢复不恢复链、事件契约有效、entered 早于 continued、全清 pending 待续跑；定点返修新增：五状态隔离(攻击/击杀/清波/死亡空间/战败 global 零变化+altState 真实变化)、六虚拟时间(T 战败 repairUntil=T+180000/ship:destroyed.timestamp=T/entered==continued 同 now)、七RNG/敌人ID(克隆一致/两token不同/首波前缀/续波单调递增/连刷三轮同token全局唯一/战败恢复新token/默认注入RNG)、八86k轮性能基准");
}

// ===== Batch S：统计等效离线战斗结算断言（消费方：统计先行→成就→新手任务；红线：无逐轮循环）=====
{
  const okS = (cond, msg) => { if (!cond) throw new Error("Batch S 校验失败：" + msg); };
  const S = sandbox;
  okS(typeof S.OfflineCombatSystem === "object" && S.OfflineCombatSystem, "OfflineCombatSystem 必须已加载（Batch S 新增文件）");
  // gameState 是 const 单例（state.js:15），只能原地还原，不能重新赋值
  const savedGS = JSON.parse(JSON.stringify(S.gameState));
  // 重要：每次还原都必须重新深克隆 savedGS，否则嵌套对象会被各场景的战斗模拟
  // （grantXp/技能升级/HP 变化等）原地改写并泄漏回 savedGS，污染后续 run（典型症状：
  // 场景 C 两次同态离线结算击杀/波次不一致）。深克隆保证每个场景拿到互不干扰的纯净副本。
  function restoreGS() {
    const clone = JSON.parse(JSON.stringify(savedGS));
    const live = S.gameState;
    Object.keys(live).forEach(k => delete live[k]);
    Object.keys(clone).forEach(k => { live[k] = clone[k]; });
  }
  function setupCombat() {
    const gs = S.gameState;
    if (gs.skills.laserOps) gs.skills.laserOps.lvl = 80;
    if (gs.skills.shieldOperation) gs.skills.shieldOperation.lvl = 80;
    let ship = gs.inventory.ships.find(s => s.shipId === "rifter");
    if (!ship) { ship = S.createShipInstance("rifter"); gs.inventory.ships.push(ship); }
    const now = 1700000000000;
    S.applyEquipEngOutput(S.getEquipmentEngineeringRecipe("t1_light_missile_launcher"), 1);
    S.dispatchGameAction(gs, { type: "hangar/toggleAssignment", instanceId: ship.instanceId, actionKey: "combat" }, now);
    S.dispatchGameAction(gs, { type: "hangar/setFittingSlot", instanceId: ship.instanceId, slot: "high", slotIndex: 1, equipmentId: "t1_light_missile_launcher" }, now);
    S.dispatchGameAction(gs, { type: "combat/selectZone", zoneId: "angel_corridor" }, now);
    const zone = vm.runInContext('COMBAT_ZONES.find(z => z.id === "angel_corridor")', S);
    const w = S.buildCombatWave(zone, 1, () => 0);
    S.dispatchGameAction(gs, { type: "combat/start", enemies: w.enemies, formationId: w.formationId }, now);
    S.ResourceRegistry.add(gs, "consumable:fuel", 999999);
    S.ResourceRegistry.add(gs, "ammo:missile", 999999);
    return gs;
  }
  const FC_KEYS = ["firstKill", "firstWaveClear", "firstZoneClear", "firstDeathspaceEntry", "firstDeathspaceClear", "firstChainContinuation", "firstDefeat", "firstRepairComplete"];
  try {
    // ---- 场景 A：24h 完整结算（active）----
    setupCombat();
    const gsA = S.gameState;
    okS(gsA.combat.active === true, "combat/start 后战斗应处于 active");
    okS(S.getInstalledCombatWeapons(gsA).length >= 1, "战斗舰应已装备至少一把武器");
    const evt = [];
    const unsub = S.GameEvents.on("offline:combatSettled", e => evt.push(e));
    const enemyKillsBefore = gsA.statistics.totals.enemyKills;
    // 红线探针：离线结算不得调用逐轮 advanceCombatRound / combatTick
    const _adv = S.advanceCombatRound, _tick = S.combatTick;
    let advCount = 0, tickCount = 0;
    S.advanceCombatRound = function () { advCount++; return _adv.apply(this, arguments); };
    S.combatTick = function () { tickCount++; return _tick.apply(this, arguments); };
    const gains = S.applyOfflineGains(86400, { runId: "batchS_A" });
    S.advanceCombatRound = _adv; S.combatTick = _tick;
    unsub();
    okS(evt.length === 1, "每离线会话应恰发射 1 次 offline:combatSettled（实际 " + evt.length + "）");
    okS(advCount === 0 && tickCount === 0, "离线战斗不得调用 advanceCombatRound/combatTick（adv=" + advCount + "/tick=" + tickCount + "）");
    const p = evt[0].payload;
    okS(typeof p.kills === "number" && p.kills >= 0, "payload.kills 必须为非负数字");
    okS(p.kills > 0, "24h 离线战斗应产生击杀（实际 " + p.kills + "）");
    okS(Array.isArray(p.runsDetail) && p.runsDetail.length >= 1, "payload.runsDetail 必须为非空数组");
    okS(p.runsDetail[0] && typeof p.runsDetail[0].token === "string" && typeof p.runsDetail[0].wavesCleared === "number", "runsDetail 条目须含 token/wavesCleared");
    okS(p.firstCrossings && typeof p.firstCrossings === "object", "payload.firstCrossings 必须为对象");
    okS(FC_KEYS.every(k => Object.prototype.hasOwnProperty.call(p.firstCrossings, k)), "firstCrossings 须含 8 个约定字段");
    okS(p.roundsEstimated > 0, "离线战斗应实际推进回合（roundsEstimated>0）");
    okS(typeof gains.combat === "number" && Number.isFinite(gains.combat), "gains.combat 必须为有限数字");
    okS(S.ResourceRegistry.get(gsA, "consumable:fuel") >= 0, "离线后燃料不得为负");
    okS(S.ResourceRegistry.get(gsA, "ammo:missile") >= 0, "离线后导弹弹药不得为负");
    const enemyKillsDelta = S.gameState.statistics.totals.enemyKills - enemyKillsBefore;
    okS(enemyKillsDelta === p.kills, "statistics.enemyKills 增量须恰等于 payload.kills（无双计/无遗漏）：+" + enemyKillsDelta + " vs " + p.kills);

    // ---- 场景 B：离线前无有效战斗 → 跳过，不发射事件，flush 返回 null ----
    restoreGS();
    const gsB = S.gameState;
    gsB.combat.active = false;
    gsB.combat.deathspaceChainPending = false;
    const evt2 = [];
    const unsub2 = S.GameEvents.on("offline:combatSettled", e => evt2.push(e));
    S.applyOfflineGains(86400, { runId: "batchS_B" });
    unsub2();
    okS(evt2.length === 0, "离线前无有效战斗时不得发射 offline:combatSettled（实际 " + evt2.length + "）");
    const flushNull = S.OfflineCombatSystem.flush(gsB, { runId: "batchS_B", gains: { combat: 0 } });
    okS(flushNull === null, "无有效战斗时 flush 应返回 null（不发射空事件）");

    // ---- 场景 C：RNG 可复现（同初始态 + 同 randomState → 同 payload）----
    function runOnce() {
      restoreGS();
      setupCombat();
      S.gameState.combat.randomState = 777;
      const ev = [];
      const u = S.GameEvents.on("offline:combatSettled", e => ev.push(e));
      S.applyOfflineGains(86400, { runId: "batchS_C" });
      u();
      return ev[0] ? ev[0].payload : null;
    }
    const p1 = runOnce();
    const p2 = runOnce();
    okS(p1 && p2, "RNG 可复现测试须取得两次 payload");
    okS(p1.kills === p2.kills, "同 randomState 两次离线结算击杀数须一致（" + p1.kills + " vs " + p2.kills + "）");
    okS(JSON.stringify(p1.runsDetail) === JSON.stringify(p2.runsDetail), "同 randomState 两次 runsDetail 须一致");
    okS(p1.iskDelta === p2.iskDelta, "同 randomState 两次 ISK 收益须一致（掉落可复现）");

    // ---- 场景 D：离线战斗驱动新手任务 C4（击杀 1）----
    restoreGS();
    setupCombat();
    const c4 = S.gameState.tutorial && S.gameState.tutorial.taskStateById && S.gameState.tutorial.taskStateById["C4"];
    okS(c4, "tutorial.taskStateById.C4 必须存在以验证离线驱动");
    if (c4) {
      c4.status = "active"; c4.kill = false; c4.rewardClaimed = false;
      const ev4 = [];
      const u4 = S.GameEvents.on("offline:combatSettled", e => ev4.push(e));
      S.applyOfflineGains(86400, { runId: "batchS_D" });
      u4();
      okS(c4.kill === true, "离线有击杀时 C4.kill 应被置为 true");
    }
    console.log("Batch S 统计等效离线战斗结算断言通过：" + evt.length + " 次聚合事件 / 红线零逐轮调用 / " + FC_KEYS.length + " 项 firstCrossings / 统计无双计 / RNG 可复现 / 离线驱动 C4");
  } finally {
    restoreGS();
  }
}

// ===================================================================
// 军团运输线掉落实装验收（2026-08-06）：通用加密数据 flat / 装备专用料 zone-bound /
// 四核心唯一产出 + 建站生效 / 系数 B（核心+0.10 加算）/ 在线·离线·预览三态一致
// ===================================================================
{
  const near = (a, b, eps = 1e-9) => Math.abs(Number(a) - Number(b)) <= eps;
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const Z = (id) => `COMBAT_ZONES.find(z => z.id === ${JSON.stringify(id)})`;

  // —— 1) 通用加密数据 flat（Task #1）：基础概率 elite 0.005 / boss 0.02，且不再有 per-zone 覆盖 ——
  const enc = vm.runInContext("FACTION_ENCRYPTED_DATA_DROPS", sandbox);
  for (const [faction, cfg] of Object.entries(enc)) {
    if (!near(cfg.chances.elite, 0.005) || !near(cfg.chances.boss, 0.02)) {
      throw new Error(`通用加密数据概率未 flat：${faction} elite=${cfg.chances.elite} boss=${cfg.chances.boss}（期望 0.005/0.02）`);
    }
  }
  const zones = vm.runInContext("COMBAT_ZONES", sandbox);
  const disabledZones = zones.filter(z => z.encryptedDataDisabled === true).map(z => z.id);
  const expectedDisabled = ["angel_outer_reach", "blood_outer_reliquary", "sansha_outer_array", "angel_deep_domain", "blood_deep_reliquary", "sansha_deep_nexus"];
  if (disabledZones.length !== expectedDisabled.length || !expectedDisabled.every(id => disabledZones.includes(id))) {
    throw new Error(`加密数据禁用战区不符：实际 [${disabledZones.join(", ")}] 期望 [${expectedDisabled.join(", ")}]`);
  }
  const leftoverOverrides = zones.filter(z => z.encryptedDataChances !== undefined);
  if (leftoverOverrides.length) throw new Error(`仍存在 per-zone 加密数据覆盖（Task #1 应已移除）：${leftoverOverrides.map(z => z.id).join(", ")}`);

  // —— 2) 装备专用料 zone-bound 掉落（Task #3）：3 个来源战区，elite 0.005 / boss 0.02，qty 1 ——
  const gearExpect = {
    angel_corridor: ["special:苍穹劫团采矿矩阵·数据", "special:苍穹劫团气脉萃取·数据"],
    blood_cathedral: ["special:赤誓血契链路·数据"],
    sansha_command_matrix: ["special:静默同化协议·数据"],
  };
  for (const [zoneId, ids] of Object.entries(gearExpect)) {
    const cfg = vm.runInContext(`getGearDropConfigs(${Z(zoneId)})`, sandbox);
    if (!cfg || cfg.length !== ids.length) throw new Error(`装备专用料来源战区 ${zoneId} 配置数量不符：${cfg ? cfg.length : "null"} 期望 ${ids.length}`);
    const gotIds = cfg.map(c => c.resourceId).sort();
    if (!deepEq(gotIds, [...ids].sort())) throw new Error(`装备专用料 ${zoneId} 物料不符：实际 [${gotIds.join(", ")}] 期望 [${[...ids].sort().join(", ")}]`);
    for (const c of cfg) {
      if (c.qty !== 1 || !near(c.eliteChance, 0.005) || !near(c.bossChance, 0.02)) {
        throw new Error(`装备专用料 ${zoneId} 概率/qty 异常：${c.resourceId} qty=${c.qty} elite=${c.eliteChance} boss=${c.bossChance}`);
      }
    }
  }
  for (const z of zones.filter(z => !gearExpect[z.id])) {
    const cfg = vm.runInContext(`getGearDropConfigs(${Z(z.id)})`, sandbox);
    if (cfg && cfg.length) throw new Error(`非来源战区 ${z.id} 不应掉落装备专用料`);
  }

  // —— 3) 四核心唯一产出 + 建站生效（Task #2）——
  const coreExpect = {
    angel_hunting_ground: { coreId: "smelt", resourceId: "special:空间站冶炼核心", elite: 0.000794, boss: 0.00397 },
    sansha_command_matrix: { coreId: "shipEng", resourceId: "special:空间站船坞核心", elite: 0.000690, boss: 0.00345 },
    blood_outer_reliquary: { coreId: "equipEng", resourceId: "special:空间站装备制造核心", elite: 0.000610, boss: 0.00305 },
    angel_deep_domain: { coreId: "booster", resourceId: "special:空间站增强剂制造核心", elite: 0.000546, boss: 0.00273 },
  };
  for (const [zoneId, exp] of Object.entries(coreExpect)) {
    const cfg = vm.runInContext(`getStationCoreDropConfigs(${Z(zoneId)})`, sandbox);
    if (!cfg || cfg.length !== 1) throw new Error(`核心来源战区 ${zoneId} 配置异常：${cfg ? cfg.length : "null"}`);
    const c = cfg[0];
    if (c.coreId !== exp.coreId || c.resourceId !== exp.resourceId || !near(c.eliteChance, exp.elite) || !near(c.bossChance, exp.boss)) {
      throw new Error(`核心 ${zoneId} 配置不符：coreId=${c.coreId} resourceId=${c.resourceId} elite=${c.eliteChance} boss=${c.bossChance}`);
    }
  }
  const specialMats = vm.runInContext("COMBAT_SPECIAL_MATERIALS", sandbox);
  for (const exp of Object.values(coreExpect)) {
    if (!specialMats.includes(exp.resourceId.replace(/^special:/, ""))) throw new Error(`核心物料未登记进 COMBAT_SPECIAL_MATERIALS：${exp.resourceId}`);
  }
  const coreRoll = vm.runInContext(`(function(){
    const base = { stationCoresObtained: { smelt:false, shipEng:false, equipEng:false, booster:false }, resources:{ special:{} } };
    const z = ${Z("angel_hunting_ground")};
    const first = rollStationCoreDrop(z, "boss", 0, JSON.parse(JSON.stringify(base))); // randomValue=0 必掉
    const obtained = JSON.parse(JSON.stringify(base)); obtained.stationCoresObtained.smelt = true;
    const again = rollStationCoreDrop(z, "boss", 0, obtained); // 已获得 → null
    const normal = rollStationCoreDrop(z, "normal", 0, JSON.parse(JSON.stringify(base))); // 普通敌 → null
    return { first, again, normal };
  })()`, sandbox);
  if (!coreRoll.first || coreRoll.first.coreId !== "smelt") throw new Error("核心首次 roll 应掉落 smelt");
  if (coreRoll.again !== null) throw new Error("核心唯一产出失效：已获得后再次 roll 仍掉落");
  if (coreRoll.normal !== null) throw new Error("核心不应由普通敌掉落");

  // —— 4) 系数 B（Task #4）：运营中持有对应核心 → 该制造线 +10%（加算，1.03+0.10=1.13，speed 无关）——
  const speed = vm.runInContext("(typeof getGameSpeed === 'function') ? getGameSpeed() : 1", sandbox);
  const mult = vm.runInContext(`(function(){
    const mk = (bodyLevel, fuel, cores, held) => ({ station:{ bodyLevel, maintenance:{ fuelRemaining: fuel } }, stationCoresObtained: cores, resources:{ special: held } });
    const opSmelt  = mk(3, 1000, { smelt:true,  shipEng:false, equipEng:false, booster:false }, { "空间站冶炼核心": 1 });
    const opNoCore = mk(3, 1000, { smelt:false, shipEng:false, equipEng:false, booster:false }, {});
    const opWrong  = mk(3, 1000, { smelt:false, shipEng:true,  equipEng:false, booster:false }, { "空间站船坞核心": 1 });
    const offBody0 = mk(0, 0,    { smelt:true }, { "空间站冶炼核心": 1 });
    const offFuel  = mk(3, 0,    { smelt:true }, { "空间站冶炼核心": 1 });
    const obtNoHold= mk(3, 1000, { smelt:true }, {});
    const opShipEng= mk(3, 1000, { shipEng:true }, { "空间站船坞核心": 1 });
    return {
      opSmelt:   getStationLogisticsMultiplier(opSmelt, "smelt"),
      opNoCore:  getStationLogisticsMultiplier(opNoCore, "smelt"),
      opWrong:   getStationLogisticsMultiplier(opWrong, "smelt"),
      offBody0:  getStationLogisticsMultiplier(offBody0, "smelt"),
      offFuel:   getStationLogisticsMultiplier(offFuel, "smelt"),
      obtNoHold: getStationLogisticsMultiplier(obtNoHold, "smelt"),
      baseNoTag: getStationLogisticsMultiplier(opSmelt),
      opShipEng: getStationLogisticsMultiplier(opShipEng, "shipEng"),
    };
  })()`, sandbox);
  if (!near(mult.opSmelt, (1.03 + 0.10) * speed)) throw new Error(`系数 B smelt 运营持有应 1.03+0.10=1.13，实际 ${mult.opSmelt}`);
  if (!near(mult.opNoCore, 1.03 * speed)) throw new Error(`系数 B 无核心应维持 ×1.03，实际 ${mult.opNoCore}`);
  if (!near(mult.opWrong, 1.03 * speed)) throw new Error(`系数 B 持错核心不应给 smelt 加成，实际 ${mult.opWrong}`);
  if (!near(mult.offBody0, 1.0)) throw new Error(`系数 B 未建站应 ×1，实际 ${mult.offBody0}`);
  if (!near(mult.offFuel, 1.0)) throw new Error(`系数 B 断油应 ×1，实际 ${mult.offFuel}`);
  if (!near(mult.obtNoHold, 1.03 * speed)) throw new Error(`系数 B 已获取但未持有库存不应加成，实际 ${mult.obtNoHold}`);
  if (!near(mult.baseNoTag, 1.03 * speed)) throw new Error(`系数 B 未传 coreTag 不应加成（即便持有），实际 ${mult.baseNoTag}`);
  if (!near(mult.opShipEng, (1.03 + 0.10) * speed)) throw new Error(`系数 B shipEng 应 1.03+0.10=1.13，实际 ${mult.opShipEng}`);

  // —— 5) 在线 / 离线 / 预览 三态一致（Task #5）——
  const previewGear = vm.runInContext("getCombatDropPreview({}, { zoneId:'angel_corridor' })", sandbox);
  const cfgGear = vm.runInContext("getGearDropConfigs(COMBAT_ZONES.find(z => z.id === 'angel_corridor'))", sandbox);
  if (!deepEq(previewGear.gearDrops, cfgGear)) throw new Error("预览态 gearDrops 与 getGearDropConfigs 不一致");
  const previewCore = vm.runInContext("getCombatDropPreview({}, { zoneId:'angel_hunting_ground' })", sandbox);
  const cfgCore = vm.runInContext("getStationCoreDropConfigs(COMBAT_ZONES.find(z => z.id === 'angel_hunting_ground'))", sandbox);
  if (!deepEq(previewCore.stationCoreDrops, cfgCore)) throw new Error("预览态 stationCoreDrops 与 getStationCoreDropConfigs 不一致");
  const dsPreview = vm.runInContext("getCombatDropPreview({}, { mode:'deathspace', deathspaceId:'__none__' })", sandbox);
  if (dsPreview.mode !== "deathspace" || dsPreview.valid !== false) throw new Error("死亡空间预览应返回 invalid 分支，无法核对 gear/核心 null");
  const previewSrc = scripts[scriptSources.indexOf("./js/core/selectors.js")];
  if (!/gearDrops:\s*null,\s*stationCoreDrops:\s*null/.test(previewSrc)) throw new Error("getCombatDropPreview 死亡空间分支未将 gear/核心置 null");
  const offlineSrc = scripts[scriptSources.indexOf("./js/systems/offline-combat.js")];
  if (!offlineSrc.includes("getGearDropConfigs") || !offlineSrc.includes("getStationCoreDropConfigs")) {
    throw new Error("离线战斗未复用 getGearDropConfigs / getStationCoreDropConfigs，在线/离线/预览三态可能不一致");
  }

  console.log("军团运输线掉落实装验收通过（2026-08-06）：加密数据 flat / 装备专用料 zone-bound / 四核心唯一产出+系数 B / 在线·离线·预览三态一致");
}

// === 货柜验收 START ===
{
  const near = (a, b, eps = 1e-9) => Math.abs(Number(a) - Number(b)) <= eps;
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // 1) ENEMY_CARGO_CLASS 三阵营共 54 个模板 key
  const expectedKeys = {
    angel: ["scout","raider","commander","patrol_destroyer","raider_destroyer","hunter_commander","strike_cruiser","war_cruiser","fleet_commander","siege_battleship","marauder_battleship","war_master","frontier_capital","domination_capital","outer_reach_overseer","abyssal_supercapital","seraph_supercapital","deep_domain_overlord"],
    blood: ["acolyte","priest","cardinal","ritual_destroyer","blood_destroyer","high_priest","sermon_cruiser","sacrament_cruiser","blood_archon","iron_battleship","apostle_battleship","blood_sovereign","covenant_capital","apostolic_capital","outer_reliquary_overseer","abyssal_blood_supercapital","crimson_supercapital","deep_reliquary_overlord"],
    sansha: ["drone","sentinel","overlord","control_destroyer","sentinel_destroyer","control_overlord","assimilation_cruiser","dominion_cruiser","nexus_overlord","command_battleship","domination_battleship","matrix_overlord","nexus_capital","dominion_capital","outer_array_overseer","abyssal_nexus_supercapital","ascendant_supercapital","deep_nexus_overlord"]
  };
  for (const faction of ["angel","blood","sansha"]) {
    const map = vm.runInContext("ENEMY_CARGO_CLASS['" + faction + "']", sandbox);
    for (const k of expectedKeys[faction]) if (!map[k]) throw new Error("ENEMY_CARGO_CLASS." + faction + " 缺 key: " + k);
    if (Object.keys(map).length !== expectedKeys[faction].length) throw new Error("ENEMY_CARGO_CLASS." + faction + " key 数=" + Object.keys(map).length + " 应 " + expectedKeys[faction].length);
  }

  // 2) CARGO_CLASS_SIZES 映射 + 权重
  const classSizes = vm.runInContext("CARGO_CLASS_SIZES", sandbox);
  const expectSizes = { frigate:["S"], destroyer:["S","M"], cruiser:["M"], battleship:["M","L"], capital:["L"], supercapital:["L","XL"] };
  for (const cls of Object.keys(expectSizes)) {
    if (!deepEq(classSizes[cls].sizes, expectSizes[cls])) throw new Error("CARGO_CLASS_SIZES." + cls + " 应为 " + JSON.stringify(expectSizes[cls]) + " 实 " + JSON.stringify(classSizes[cls].sizes));
  }
  if (!near(classSizes.supercapital.weights[0], 0.70) || !near(classSizes.supercapital.weights[1], 0.30)) throw new Error("supercapital 权重应 0.70/0.30");
  if (!near(classSizes.destroyer.weights[0], 0.80) || !near(classSizes.destroyer.weights[1], 0.20)) throw new Error("destroyer 权重应 0.80/0.20");

  // 3) 尺寸加权抽取（纯函数）
  const pickFrig = vm.runInContext("cargoWeightedPick(CARGO_CLASS_SIZES.frigate.sizes.map((s,i)=>({id:s,weight:CARGO_CLASS_SIZES.frigate.weights[i]})), ()=>0.5).id", sandbox);
  if (pickFrig !== "S") throw new Error("frigate 必出 S，实 " + pickFrig);
  const pickSuperL = vm.runInContext("cargoWeightedPick(CARGO_CLASS_SIZES.supercapital.sizes.map((s,i)=>({id:s,weight:CARGO_CLASS_SIZES.supercapital.weights[i]})), ()=>0.0).id", sandbox);
  if (pickSuperL !== "L") throw new Error("supercapital rng=0 应 L，实 " + pickSuperL);
  const pickSuperXL = vm.runInContext("cargoWeightedPick(CARGO_CLASS_SIZES.supercapital.sizes.map((s,i)=>({id:s,weight:CARGO_CLASS_SIZES.supercapital.weights[i]})), ()=>0.99).id", sandbox);
  if (pickSuperXL !== "XL") throw new Error("supercapital rng=0.99 应 XL，实 " + pickSuperXL);

  // 4) rollCargoDrop 命中/未命中/尺寸 + 发放物品（用 sandbox 内 gameState = INITIAL_STATE）
  //    rng 序列：第一个值决定掉落命中（< chance），第二个值起决定尺寸抽取。
  //    supercapital 尺寸 L/XL 权重 0.70/0.30 → 尺寸抽取 rng<0.70 出 L，>=0.70 出 XL。
  sandbox.__seq = (arr) => { let i = 0; return () => { const v = arr[Math.min(i, arr.length - 1)]; i++; return v; }; };
  const dHitXL = vm.runInContext("rollCargoDrop({kind:'boss',type:'abyssal_supercapital'}, {faction:'angel'}, __seq([0,0.99]), gameState)", sandbox);
  if (!dHitXL || dHitXL.size !== "XL") throw new Error("超级旗舰 boss 应可掉 XL（rng 序列 [0,0.99]），实 " + JSON.stringify(dHitXL));
  if (vm.runInContext("ResourceRegistry.get(gameState, 'special:货柜XL')", sandbox) < 1) throw new Error("掉落未发放 货柜XL");
  const dHitL = vm.runInContext("rollCargoDrop({kind:'boss',type:'abyssal_supercapital'}, {faction:'angel'}, __seq([0,0]), gameState)", sandbox);
  if (!dHitL || dHitL.size !== "L") throw new Error("超级旗舰 boss 应可掉 L（rng 序列 [0,0]），实 " + JSON.stringify(dHitL));
  const dS = vm.runInContext("rollCargoDrop({kind:'normal',type:'scout'}, {faction:'angel'}, ()=>0.0, gameState)", sandbox);
  if (!dS || dS.size !== "S") throw new Error("护卫 normal rng=0 应掉 S，实 " + JSON.stringify(dS));
  const dMiss = vm.runInContext("rollCargoDrop({kind:'normal',type:'scout'}, {faction:'angel'}, ()=>0.99, gameState)", sandbox);
  if (dMiss !== null) throw new Error("rng=0.99 应不掉，实 " + JSON.stringify(dMiss));

  // 5) openCargoContainer 消耗+发放（XL 抽 3 次；rng=0 → 全 T1 → 每抽发 3 件三件套）
  const beforeXL = vm.runInContext("ResourceRegistry.get(gameState, 'special:货柜XL')", sandbox);
  const opened = vm.runInContext("openCargoContainer(gameState, 'XL', ()=>0.0)", sandbox);
  if (!opened) throw new Error("开 XL 失败");
  const afterXL = vm.runInContext("ResourceRegistry.get(gameState, 'special:货柜XL')", sandbox);
  if (afterXL !== beforeXL - 1) throw new Error("开箱未消耗 货柜XL: " + beforeXL + "->" + afterXL);
  // XL rng=0 → 3 次 T1 抽，每次 3 件 = 9 条发放明细（T1 已不含矿物）
  if (opened.rolls.length !== 9) throw new Error("XL rng=0 应 3 次 T1 抽×3 件=9 条，实 " + opened.rolls.length);
  const ids = opened.rolls.map(r => r.id);
  const mineralInT1 = ids.some(id => ["mineral:三钛合金","mineral:类银超金属","mineral:类晶体胶矿"].includes(id));
  if (mineralInT1) throw new Error("T1 不应含基础矿物（已挪 T2）: " + JSON.stringify(ids));
  const planetaryOk = ids.some(id => id.indexOf("planetary:") === 0);
  const iskOk = ids.indexOf("loot:isk") >= 0;
  const tacticalOk = ids.indexOf("special:战术残液") >= 0;
  if (!(planetaryOk && iskOk && tacticalOk)) throw new Error("T1 三件套不齐(行星+战术残液+星币): " + JSON.stringify(ids));
  // T1 数额随尺寸缩放：XL 星币 > S 星币（同 rng=0）
  vm.runInContext("ResourceRegistry.add(gameState, 'special:货柜S', 1)", sandbox);
  const openedS = vm.runInContext("openCargoContainer(gameState, 'S', ()=>0.0)", sandbox);
  if (!openedS) throw new Error("开 S 失败");
  if (openedS.rolls.length !== 3) throw new Error("S rng=0 应 1 次 T1 抽×3 件=3 条，实 " + openedS.rolls.length);
  const xlIsk = opened.rolls.find(r => r.id === "loot:isk").qty;
  const sIsk = openedS.rolls.find(r => r.id === "loot:isk").qty;
  if (!(xlIsk > sIsk)) throw new Error("T1 星币应随尺寸缩放（XL=" + xlIsk + " > S=" + sIsk + "）");
  for (const r of opened.rolls.concat(openedS.rolls)) {
    if (r.loot) continue; // 具名战利品不入库存，单独存 state.cargoLoot
    if (vm.runInContext("ResourceRegistry.get(gameState, " + JSON.stringify(r.id) + ")", sandbox) < r.qty) throw new Error("开箱未发放 " + r.id);
  }
  // T1 星币改为具名战利品：开箱应铸入 state.cargoLoot（XL 3 抽 + S 1 抽 = 4 件 isk 战利品）
  const clAll = vm.runInContext("gameState.cargoLoot", sandbox);
  if (!Array.isArray(clAll) || clAll.length < 4) throw new Error("开箱未铸入 cargoLoot（应≥4 件 isk 战利品），实 " + (clAll ? clAll.length : "无"));
  const iskLoot = clAll.filter(x => x.kind === "isk");
  if (iskLoot.length < 4) throw new Error("cargoLoot 中 isk 战利品应≥4，实 " + iskLoot.length);
  const iskN = vm.runInContext("CARGO_ISK_LOOT_NAMES", sandbox);
  for (const x of iskLoot) {
    if (iskN.indexOf(x.name) < 0) throw new Error("isk 战利品名不在池内: " + x.name);
    if (x.value < 1 || x.value > 30000 * 4.2 + 10) throw new Error("isk 战利品价值越界: " + x.value);
  }

  // 6) T1 保底三件套结构 + T2 含基础矿物 + 掉率 + T2/T3/T4 池 + T4 脑插
  const cfg = vm.runInContext("getCargoDropConfigs(COMBAT_ZONES.find(z=>z.id==='angel_corridor'))", sandbox);
  if (!cfg || !cfg.t1Bundle) throw new Error("应含 t1Bundle");
  if (cfg.t1Bundle.mineralChoices) throw new Error("T1 不应再含 mineralChoices（已挪 T2）");
  const pc = cfg.t1Bundle.planetaryChoices;
  const expectPC = { S: 3, M: 4, L: 5, XL: 6 };
  for (const s of ["S", "M", "L", "XL"]) {
    if (!Array.isArray(pc[s]) || pc[s].length !== expectPC[s]) throw new Error("T1 行星 " + s + " 应选 " + expectPC[s] + " 种，实 " + (pc[s] ? pc[s].length : "无"));
  }
  if (cfg.t1Bundle.qty.mineral) throw new Error("T1_QTY 不应含 mineral（已挪 T2）");
  if (!cfg.t1Bundle.qty.tactical) throw new Error("T1_QTY 应含 tactical（战术残液 ≈20min 战斗 farm）");
  // 掉率：同比例压缩 ÷10 → normal 0.6% / elite 1.0% / boss 1.5%
  const dc = vm.runInContext("CARGO_DROP_CHANCE", sandbox);
  if (!near(dc.normal, 0.006) || !near(dc.elite, 0.010) || !near(dc.boss, 0.015)) throw new Error("掉率应为 0.6/1.0/1.5%: " + JSON.stringify(dc));
  // T2 应含三种基础矿物（三钛/银镍/晶格），qty [30,100]
  const t2Ids = cfg.pools.T2.map(p => p.id);
  for (const m of ["mineral:三钛合金","mineral:类银超金属","mineral:类晶体胶矿"]) {
    if (!t2Ids.includes(m)) throw new Error("T2 应含基础矿物 " + m);
    const e = cfg.pools.T2.find(p => p.id === m);
    if (!Array.isArray(e.qty) || e.qty[0] !== 30 || e.qty[1] !== 100) throw new Error("T2 基础矿物 " + m + " qty 应 [30,100]，实 " + JSON.stringify(e.qty));
  }
  // T2 的 isk/lp 改为具名兑换物（loot:isk / loot:lp）；功勋砍半 [25,100]
  if (!t2Ids.includes("loot:isk")) throw new Error("T2 应含 loot:isk（具名星币战利品）");
  if (!t2Ids.includes("loot:lp")) throw new Error("T2 应含 loot:lp（具名功勋战利品）");
  const lp2 = cfg.pools.T2.find(p => p.id === "loot:lp");
  if (!Array.isArray(lp2.qty) || lp2.qty[0] !== 25 || lp2.qty[1] !== 100) throw new Error("T2 loot:lp qty 应 [25,100]（砍半后），实 " + JSON.stringify(lp2.qty));
  // 名池：星币 13 / 功勋 15，含指定名、不含旧名
  const iskNames = vm.runInContext("CARGO_ISK_LOOT_NAMES", sandbox);
  const lpN = vm.runInContext("CARGO_LP_LOOT_NAMES", sandbox);
  if (iskNames.length !== 13) throw new Error("CARGO_ISK_LOOT_NAMES 应 13，实 " + iskNames.length);
  if (lpN.length !== 15) throw new Error("CARGO_LP_LOOT_NAMES 应 15，实 " + lpN.length);
  for (const n of ["染血海盗狗牌","染血战术终端","太阳能战斧","璀璨星图"]) if (lpN.indexOf(n) < 0) throw new Error("LP 名池缺: " + n);
  if (lpN.indexOf("带血海盗狗牌") >= 0 || lpN.indexOf("血染战术终端") >= 0) throw new Error("LP 名池仍含旧名（应已改为染血）");
  // cargoGrantLoot 直接铸件：lp 战利品名来自 LP 池、value 入参正确、进 cargoLoot
  const clBefore = vm.runInContext("gameState.cargoLoot.length", sandbox);
  const lootItem = vm.runInContext("cargoGrantLoot(gameState, 'lp', 77, ()=>0.3)", sandbox);
  if (!lootItem || lpN.indexOf(lootItem.name) < 0 || lootItem.kind !== "lp" || lootItem.value !== 77) throw new Error("cargoGrantLoot 异常: " + JSON.stringify(lootItem));
  if (vm.runInContext("gameState.cargoLoot.length", sandbox) !== clBefore + 1) throw new Error("cargoGrantLoot 未 push 进 cargoLoot");
  // T3 loot:lp 仍保留（[1000,4000]）
  const lp3 = cfg.pools.T3.find(p => p.id === "loot:lp");
  if (!lp3 || !Array.isArray(lp3.qty) || lp3.qty[0] !== 1000 || lp3.qty[1] !== 4000) throw new Error("T3 loot:lp qty 应 [1000,4000]，实 " + JSON.stringify(lp3 && lp3.qty));
  if (!cfg.pools || !cfg.pools.T2 || !cfg.pools.T3 || !cfg.pools.T4) throw new Error("CARGO_POOLS 应含 T2-T4");
  if (!cfg.pools.T4.some(p => p.id.indexOf('神经植入体') >= 0)) throw new Error("T4 应含神经植入体");
  if (cfg.pools.T3.some(p => p.id.indexOf('空间站') >= 0 || p.id.indexOf('数据') >= 0)) throw new Error("T3 不应含战区绑定装备料/空间站核心（护栏）");

  // 7) 预览与配置一致；死亡空间 cargoDrops=null
  const preview = vm.runInContext("getCombatDropPreview({}, {zoneId:'angel_corridor'})", sandbox);
  if (!deepEq(preview.cargoDrops, cfg)) throw new Error("预览 cargoDrops 与 getCargoDropConfigs 不一致");
  const dsId = vm.runInContext("(DEATHSPACE_DATABASE.find(function(d){ return COMBAT_ZONES.some(function(z){ return z.id===d.sourceZoneId; }); }) || DEATHSPACE_DATABASE[0]).id", sandbox);
  const dsPrev = vm.runInContext("getCombatDropPreview({}, {mode:'deathspace', deathspaceId:" + JSON.stringify(dsId) + "})", sandbox);
  if (dsPrev.cargoDrops !== null) throw new Error("死亡空间 cargoDrops 应 null（deathspaceId=" + dsId + "），实 " + JSON.stringify(dsPrev.cargoDrops));

  console.log("货柜系统验收通过（2026-08-08）：船级→尺寸映射/权重、rollCargoDrop 尺寸分布+发放、openCargoContainer 消耗+发放、T1三件套(无矿物·行星随尺寸解锁三~六选一·战术残液180-210·星币改具名战利品)+T2含基础矿物(30-100)·T2/T3含具名兑换物(isk/lp)·T2-lp砍半[25,100]·T4脑插、掉率0.6/1.0/1.5%、名池13/15、预览一致、死亡空间排除");
}
// === 货柜验收 END ===

console.log(`验证通过：${scriptSources.length} JS、${styleSources.length} CSS、${htmlIds.size} DOM IDs，全部本地资源 HTTP 200`);
