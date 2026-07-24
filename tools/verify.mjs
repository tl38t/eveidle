import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((match) => match[1]);
const styleSources = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\.\/css\/[^"]+)"/g)].map((match) => match[1]);
const localSources = [...styleSources, ...scriptSources];

if (scriptSources.length !== 37) throw new Error(`预期 37 个脚本，实际 ${scriptSources.length}`); // 37 = 36 + enhancement-chance.js（共用成功率层 2026-07-24）
if (styleSources.length !== 4) throw new Error(`预期 4 个样式，实际 ${styleSources.length}`);

// 断言：production.js 必须早于 equipment-enhancement.js（REFINED_MINERALS 依赖 SMELTING_RECIPES）
{
  const prodIdx = scriptSources.findIndex(s => s.includes("production.js"));
  const enhIdx = scriptSources.findIndex(s => s.includes("equipment-enhancement.js"));
  if (prodIdx < 0) throw new Error("未找到 production.js 脚本引用");
  if (enhIdx < 0) throw new Error("未找到 equipment-enhancement.js 脚本引用");
  if (prodIdx >= enhIdx) throw new Error(`脚本顺序错误：production.js (idx=${prodIdx}) 必须早于 equipment-enhancement.js (idx=${enhIdx})`);
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

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const literalIdReferences = new Set(
  scripts.flatMap((script) => [...script.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]))
);
const optionalIds = new Set([
  "combat-player-section", "footer-save",
  "runtime-error-boundary", "runtime-error-dismiss", "runtime-error-resume", "runtime-error-reload",
  "runtime-error-message", "runtime-error-meta", "runtime-error-stack"
]);
const missingIds = [...literalIdReferences].filter((id) => !htmlIds.has(id) && !optionalIds.has(id));
if (missingIds.length) throw new Error(`HTML 缺少脚本引用的 ID：${missingIds.join(", ")}`);

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

const localStorageMock = { getItem: () => null, setItem: noop };
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
  ...[...source.matchAll(/emitOfflineGameEvent\(["']([^"']+)["']/g)].map(match => match[1])
]));
for (const type of emittedEventTypes) {
  if (!sandbox.GameEvents.contracts.has(type)) throw new Error(`事件发布点缺少契约：${type}`);
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
  id:"planet_verify_event", type:"lava", deployedAt:planetaryEventNow - 10000, duration:86400,
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
if (globalDisplay.cargo.used !== sandbox.getCargoUsedFromState(selectorState) || globalDisplay.cargo.capacity !== 10000000 || globalDisplay.quickOres.length > 4) {
  throw new Error("全局资源View State没有正确汇总仓库或快捷矿石");
}

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
const equipmentEngineeringDisplay = sandbox.getEquipmentEngineeringDisplayState(manufacturingState, selectorNow, "血仆");
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
if (lockedFrigateAssembly.changed || lockedFrigateAssembly.reason !== "blueprint-locked") throw new Error("无蓝图状态仍能选择护卫舰组装");
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
if (lockedMixedAssembly.changed || lockedMixedAssembly.reason !== "blueprint-locked" || !mixedBlueprintPurchase.changed ||
    manufacturingActionState.resources.lp !== 0 || !manufacturingActionState.ownedBlueprints.includes("gale") || !unlockedMixedAssembly.changed) {
  throw new Error("混血舰船LP蓝图没有正确执行锁定、购买与永久解锁");
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
  id:"planet_1", type:"lava", deployedAt:selectorNow - 5000, duration:86400,
  storage:2, lastTick:selectorNow - 3000, progress:1, active:true
}] };
const planetaryViewBefore = JSON.stringify(planetaryViewState);
const planetaryDisplay = sandbox.getPlanetaryDisplayState(planetaryViewState, selectorNow, 10000000);
if (JSON.stringify(planetaryViewState) !== planetaryViewBefore) throw new Error("行星View State修改了输入状态");
const planetaryCard = planetaryDisplay.deployments[0];
if (planetaryDisplay.level !== 1 || planetaryDisplay.slots !== 1 || planetaryDisplay.storageMax !== 105 ||
    planetaryCard.output !== "重金属" || planetaryCard.outputProgress !== 4 || planetaryCard.outputPercent !== 40 ||
    planetaryCard.storage !== 2 || !planetaryCard.active || planetaryCard.statusText !== "运行中" || !planetaryDisplay.deployOptions[0].unlocked) {
  throw new Error("行星View State没有正确表达技能、槽位、库存、产出进度或部署选项");
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
planetaryActionState.resources.minerals["三钛合金"] = 10;
const lockedPlanetBefore = JSON.stringify(planetaryActionState);
const lockedPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/deploy", planetType:"ice" }, selectorNow);
if (lockedPlanetAction.changed || lockedPlanetAction.reason !== "level-locked" || JSON.stringify(planetaryActionState) !== lockedPlanetBefore) {
  throw new Error("行星部署动作允许越级部署或失败时修改了状态");
}
const deployPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/deploy", planetType:"lava" }, selectorNow);
const deployedPlanet = planetaryActionState.planetary.deployments[0];
if (!deployPlanetAction.changed || deployedPlanet.id !== "planet_1" || deployedPlanet.deployedAt !== selectorNow ||
    planetaryActionState.resources.minerals["三钛合金"] !== 9 || Object.hasOwn(deployedPlanet, "_scrollOffset")) {
  throw new Error("行星部署动作没有正确扣费、创建部署或仍将Canvas状态写入存档");
}
deployedPlanet.storage = 5;
const cargoUsedBeforePlanetCollect = sandbox.getCargoUsedFromState(planetaryActionState);
const collectPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/collect", id:deployedPlanet.id, cargoCapacity:cargoUsedBeforePlanetCollect + 3 }, selectorNow);
const removeStoredPlanet = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/remove", id:deployedPlanet.id }, selectorNow);
const redeployPlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/redeploy", id:deployedPlanet.id }, selectorNow + 5000);
if (!collectPlanetAction.changed || collectPlanetAction.quantity !== 3 || deployedPlanet.storage !== 2 ||
    removeStoredPlanet.changed || removeStoredPlanet.reason !== "storage-not-empty" || !redeployPlanetAction.changed ||
    deployedPlanet.deployedAt !== selectorNow + 5000 || deployedPlanet.progress !== 0 || !deployedPlanet.active) {
  throw new Error("行星收取、非空撤除锁或续期动作状态异常");
}
deployedPlanet.storage = 0;
const removePlanetAction = sandbox.dispatchGameAction(planetaryActionState, { type:"planetary/remove", id:deployedPlanet.id }, selectorNow);
if (!removePlanetAction.changed || planetaryActionState.planetary.deployments.length !== 0) throw new Error("空库存行星无法通过动作层撤除");

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
const cargoDisplay = sandbox.getCargoDisplayState(shellViewState, "mineral", 10000000);
const equipmentCargoDisplay = sandbox.getCargoDisplayState(shellViewState, "equipment", 10000000);
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
if (cargoDisplay.filter !== "mineral" || cargoDisplay.items.find(item => item.name === "三钛合金")?.quantity !== 5 ||
    equipmentCargoDisplay.items.find(item => item.name === "驱逐舰综合舰体组件")?.quantity !== 7 ||
    !lpDisplay.items.length || hangarDisplay.count !== shellViewState.inventory.ships.length || !fittingDisplay ||
    queueDisplay.count !== shellViewState.queue.items.length || navigationDisplay.specializedSkillPanel !== "combat-panel" || navigationDisplay.showGenericSkill ||
    !settingsDisplay.confirmShipEnhancement || settingsDisplay.combatSkillsExpanded || settingsNavigation.standalonePanel !== "settings-panel" ||
    statisticsNavigation.standalonePanel !== "statistics-panel" || statisticsDisplay.kind !== "statistics" || statisticsDisplay.summaryGroups.length !== 4 ||
    statisticsDisplay.summaryGroups.find(group => group.id === "enhancement")?.items.find(item => item.label === "成功率")?.value !== 75 ||
    statisticsDisplay.detailGroups.find(group => group.id === "manufactured")?.items[0]?.name !== "综合舰体组件" ||
    statisticsDisplay.detailGroups.find(group => group.id === "zones")?.items[0]?.name !== "天使前哨站" ||
    combatSidebarDisplay?.level !== 26 || combatSidebarDisplay.xp !== null ||
    !combatSidebarDisplay.tooltip.includes("⌊(31 + 21) ÷ 2⌋ = Lv.26")) {
  throw new Error("仓库、LP商店、船坞、装配、队列或导航View State异常");
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
  id: 99, type: "lava", deployedAt: Date.now() - 5000, duration: 3600,
  active: true, storage: 1, progress: 2, lastTick: Date.now()
}];
sandbox.renderPlanetaryPage();
sandbox.updatePlanetaryLiveUI();
sandbox.updateCombatLiveUI();
if (sandbox.removePlanet(99) || sandbox.gameState.planetary.deployments.length !== 1) {
  throw new Error("行星仍有库存时可以被撤除");
}
sandbox.gameState.planetary.deployments[0].storage = 0;
if (!sandbox.removePlanet(99) || sandbox.gameState.planetary.deployments.length !== 0) {
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
for (const recipe of shipAssemblyRecipes.filter(item => item.level <= 60)) {
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
for (const recipe of shipAssemblyRecipes.filter(item => item.level <= 55 && !item.materialCost)) {
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
  const lanes = Array.from({ length:Math.min(5, 1 + Math.floor(level / 10)) }, () => 0);
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

// 装备工程分类不再单列势力标签；高级采集装备完整进入工业采集，LP商品不混入制造配方。
const equipEngCategories = vm.runInContext("EQUIPMENT_ENGINEERING_CATEGORIES.map(category => category.id)", sandbox);
if (equipEngCategories.length !== 9 || equipEngCategories.includes("faction")) { // 9 = 8 + rigs（改装件系统 2026-07-22）
  throw new Error("装备工程仍然存在独立势力标签，或基础分类数量不正确");
}
for (const equipmentId of [
  "t2_mining_laser","t3_mining_laser","t4_mining_laser","t5_mining_laser",
  "t2_gas_harvester","t3_gas_harvester","t4_gas_harvester","t5_gas_harvester"
]) {
  const equipment = vm.runInContext(`EQUIPMENT_DB["${equipmentId}"]`, sandbox);
  const recipe = sandbox.getEquipmentEngineeringRecipe(equipmentId);
  if (!equipment || recipe.id !== equipmentId || recipe.category !== "industry") {
    throw new Error(`高级采集装备 ${equipmentId} 没有进入工业采集制造分类`);
  }
}
if (bloodLinkRecipe.category !== "drones" || sanshaBoosterRecipe.category !== "industry") {
  throw new Error("势力装备没有按实际用途归入无人机或工业采集分类");
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
    !mixedShipPreview.previewLines.some(line => line.label === "消耗" && line.value.includes("天使低级加密数据×15")) ||
    !improvedEquipmentPreview || !improvedEquipmentPreview.previewLines.some(line => line.label === "属性" && line.value.includes("基础伤害")) ||
    !improvedEquipmentPreview.previewLines.some(line => line.label === "消耗" && line.value.includes("吉斯特A型大型激光炮")) ||
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
    angelMiningRecipe.category !== "industry" || angelGasRecipe.category !== "industry") {
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
if (!shipInventoryList.innerHTML.includes("冲锋者级") || !shipInventoryList.innerHTML.includes("HP: 220/75/75") || shipInventoryList.innerHTML.includes("miner_frigate")) {
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
  ...originalCombat, active:true, enemies:[testEnemy], currentEnemy:testEnemy, hp:{...testMaxHp}, maxHp:{...testMaxHp},
  repairUntil:0, destroyedShip:null, lastStatus:"", zone:"angel_outpost"
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
sandbox.gameState.combat.repairUntil = Date.now() - 1;
sandbox.updateCombatRecovery();
if (sandbox.gameState.combat.repairUntil !== 0 || sandbox.gameState.combat.hp.structure !== sandbox.gameState.combat.maxHp.structure) {
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
  if (!sandbox.gameState.statistics || sandbox.gameState.statistics.version !== 1 ||
      !Array.isArray(sandbox.gameState.statistics.eventLedger?.processedEventIds)) {
    throw new Error("真实旧存档没有迁移到统计事件消费者所需的兼容结构");
  }
  if (!sandbox.gameState.settings || sandbox.gameState.settings.confirmShipEnhancement !== true || sandbox.gameState.settings.combatSkillsExpanded !== false) {
    throw new Error("真实旧存档没有补齐默认开启的强化确认或默认折叠的战斗技能设置");
  }
  console.log(`真实存档回归通过：${path.basename(resolvedSavePath)}，${sandbox.gameState.inventory.ships.length} 艘舰船，${importedResources.length} 类已注册资源`);
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

console.log(`验证通过：${scriptSources.length} JS、${styleSources.length} CSS、${htmlIds.size} DOM IDs，全部本地资源 HTTP 200`);
