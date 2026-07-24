/* ================================================================
   audit-planetary.mjs — 行星开发 Phase 1 专项审计（A~Z 26 区）

   原则：加载真实项目脚本，调用真实 Action / 选择器 / 在线 tick / 离线结算 / 迁移，
   绝不复制公式自证。沙箱与 audit-industrial-productivity.mjs / verify.mjs 同构：
   - 默认加载 index.html 中除 /ui/、actions.js、tick.js、offline.js、persistence.js 外的脚本
     （systems/planetary.js 因此被加载，planetaryTick 可直接调用）
   - 额外手动加载 offline.js（settleOfflinePlanets）与 actions.js（dispatchGameAction）
   - 从 persistence.js 精确切片出真实 normalizePlanetaryState 源码并执行（非重写）
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
vm.createContext(sandbox);
for (const source of scriptSources) {
  vm.runInContext(fs.readFileSync(path.resolve(root, source.replace(/^\.\//, "")), "utf8"), sandbox, { filename:source });
}
// 手动加载动作层与离线结算层（二者只定义函数，无加载期副作用，可安全在沙箱运行）
vm.runInContext(fs.readFileSync(path.resolve(root, "js/core/offline.js"), "utf8"), sandbox, { filename:"js/core/offline.js" });
vm.runInContext(fs.readFileSync(path.resolve(root, "js/core/actions.js"), "utf8"), sandbox, { filename:"js/core/actions.js" });
// 精确切片真实 normalizePlanetaryState（含 window 绑定），执行真实迁移代码
const persistenceSource = fs.readFileSync(path.resolve(root, "js/core/persistence.js"), "utf8");
const normStart = persistenceSource.indexOf("function normalizePlanetaryState(state, opts) {");
const normEndMarker = "window.normalizePlanetaryState = normalizePlanetaryState;";
const normEnd = persistenceSource.indexOf(normEndMarker);
if (normStart < 0 || normEnd < 0) throw new Error("无法从 persistence.js 精确切片 normalizePlanetaryState");
vm.runInContext(persistenceSource.slice(normStart, normEnd + normEndMarker.length), sandbox, { filename:"persistence.normalizePlanetaryState.js" });
if (typeof sandbox.normalizePlanetaryState !== "function") throw new Error("normalizePlanetaryState 未注入沙箱全局");

const PLANET_TYPES = vm.runInContext("PLANET_TYPES", sandbox);
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

function freshState(opts = {}) {
  const state = JSON.parse(JSON.stringify(sandbox.gameState));
  state.skills.planetaryIndustry = { lvl:opts.lvl || 1, xp:0 };
  state.planetary = { deployments:[], nextId:1 };
  state.resources.isk = opts.isk !== undefined ? opts.isk : 10000000;
  state.resources.minerals["三钛合金"] = opts.trit !== undefined ? opts.trit : 5000;
  return state;
}
// 将部署写入共享全局 gameState（planetaryTick / settleOfflinePlanets 读取全局）
function setGlobalPlanet(deployment, lvl = 1) {
  sandbox.gameState.skills.planetaryIndustry = { lvl, xp:0 };
  sandbox.gameState.planetary = { deployments:[deployment], nextId:2 };
}
const expected = {
  lava:      { isk:138000,  trit:100,  maint:46000,   level:1  },
  gas:       { isk:138000,  trit:100,  maint:46000,   level:1  },
  ice:       { isk:249000,  trit:150,  maint:83000,   level:20 },
  plasma:    { isk:714000,  trit:300,  maint:238000,  level:40 },
  temperate: { isk:1914000, trit:500,  maint:638000,  level:60 },
  storm:     { isk:4899000, trit:1000, maint:1633000, level:80 }
};

console.log("行星开发 Phase 1 专项审计（A~Z）");

// ================= A：数据结构完整性 =================
region("A", "数据结构完整性", () => {
  assert(Array.isArray(PLANET_TYPES) && PLANET_TYPES.length === 6, "PLANET_TYPES 必须为 6 项");
  for (const config of PLANET_TYPES) {
    for (const field of ["id", "name", "output", "level", "interval", "constructionCost", "maintenanceCostISK", "maintenanceDuration"]) {
      assert(Object.hasOwn(config, field), `${config.id} 缺字段 ${field}`);
    }
    assert(config.constructionCost && typeof config.constructionCost === "object", `${config.id} constructionCost 结构异常`);
    assert(config.constructionCost.resources && typeof config.constructionCost.resources === "object", `${config.id} constructionCost.resources 结构异常`);
  }
});

// ================= B：六建设 ISK 精确值 =================
region("B", "六建设 ISK 精确值", () => {
  for (const config of PLANET_TYPES) assert(Number(config.constructionCost.isk) === expected[config.id].isk, `${config.id} 建设 ISK 应为 ${expected[config.id].isk}`);
});

// ================= C：六建设三钛精确值 =================
region("C", "六建设三钛精确值", () => {
  for (const config of PLANET_TYPES) assert(Number(config.constructionCost.resources["mineral:三钛合金"]) === expected[config.id].trit, `${config.id} 建设三钛应为 ${expected[config.id].trit}`);
});

// ================= D：六维护 ISK 精确值 =================
region("D", "六维护 ISK 精确值", () => {
  for (const config of PLANET_TYPES) assert(Number(config.maintenanceCostISK) === expected[config.id].maint, `${config.id} 维护 ISK 应为 ${expected[config.id].maint}`);
});

// ================= E：维护周期统一 86400 =================
region("E", "维护周期统一 24h", () => {
  for (const config of PLANET_TYPES) assert(Number(config.maintenanceDuration) === 86400, `${config.id} maintenanceDuration 必须为 86400`);
});

// ================= F：无占位/无升级字段 =================
region("F", "无占位与升级字段", () => {
  for (const config of PLANET_TYPES) {
    assert(!Object.hasOwn(config, "costISK") && !Object.hasOwn(config, "costTrit"), `${config.id} 仍保留占位 costISK/costTrit`);
    assert(!/upgrade|upgradeCost|升级/i.test(JSON.stringify(config)), `${config.id} 混入升级字段`);
  }
});

// ================= G：解锁等级 =================
region("G", "解锁等级门槛", () => {
  for (const config of PLANET_TYPES) assert(Number(config.level) === expected[config.id].level, `${config.id} 解锁等级应为 ${expected[config.id].level}`);
});

// ================= H：deploy 成功语义 =================
region("H", "deploy 成功扣费与创建", () => {
  const state = freshState({ isk:500000, trit:100 });
  let ev = null; const un = sandbox.GameEvents.on("planetary:deployed", e => { ev = e; });
  const res = dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW);
  un();
  const dep = state.planetary.deployments[0];
  assert(res.changed, "deploy 应成功");
  assert(dep.id === "planet_1" && dep.planetType === "lava" && !Object.hasOwn(dep, "type"), "部署应用 planetType 字段");
  assert(dep.active === true && dep.duration === 86400 && dep.storage === 0 && dep.progress === 0, "新部署应立即运行、24h、空仓");
  assert(dep.deployedAt === NOW && dep.lastTick === NOW, "deployedAt/lastTick 应为 now");
  assert(state.resources.isk === 362000 && state.resources.minerals["三钛合金"] === 0, "应原子扣 138000 ISK + 100 三钛");
  assert(state.planetary.nextId === 2, "nextId 应自增");
  assert(ev && ev.payload.constructionISK === 138000 && ev.payload.constructionResources["mineral:三钛合金"] === 100, "planetary:deployed 负载异常");
});

// ================= I：deploy 越级拒绝 =================
region("I", "deploy 越级原子拒绝", () => {
  const state = freshState({ lvl:1, isk:10000000, trit:5000 });
  const before = JSON.stringify(state);
  const res = dispatch(state, { type:"planetary/deploy", planetType:"ice" }, NOW); // ice 需 Lv20
  assert(!res.changed && res.reason === "level-locked" && res.level === 20, "越级应返回 level-locked");
  assert(JSON.stringify(state) === before, "越级失败不得修改状态");
});

// ================= J：deploy 资源不足原子拒绝 =================
region("J", "deploy 资源不足原子拒绝", () => {
  const poorIsk = freshState({ isk:100, trit:100 });
  const beforeI = JSON.stringify(poorIsk);
  const r1 = dispatch(poorIsk, { type:"planetary/deploy", planetType:"lava" }, NOW);
  assert(!r1.changed && r1.reason === "insufficient-isk" && JSON.stringify(poorIsk) === beforeI, "ISK 不足应原子拒绝");
  const poorTrit = freshState({ isk:500000, trit:50 });
  const beforeT = JSON.stringify(poorTrit);
  const r2 = dispatch(poorTrit, { type:"planetary/deploy", planetType:"lava" }, NOW);
  assert(!r2.changed && r2.reason === "insufficient-tritanium" && JSON.stringify(poorTrit) === beforeT, "三钛不足应原子拒绝");
});

// ================= K：deploy 满槽拒绝 =================
region("K", "deploy 满槽拒绝", () => {
  const state = freshState({ lvl:50, isk:100000000, trit:100000 }); // Lv50 → 5 槽
  for (let i = 0; i < 5; i++) assert(dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW).changed, `第 ${i + 1} 次部署应成功`);
  assert(state.planetary.deployments.length === 5, "应有 5 个部署");
  const res = dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW);
  assert(!res.changed && res.reason === "no-slots", "第 6 次应 no-slots");
});

// ================= L：collect 语义 =================
region("L", "collect 收取与仓位边界", () => {
  const state = freshState({ isk:500000, trit:100 });
  dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW);
  const dep = state.planetary.deployments[0];
  dep.storage = 5;
  const used = sandbox.getCargoUsedFromState(state);
  let ev = null; const un = sandbox.GameEvents.on("planetary:collected", e => { ev = e; });
  const res = dispatch(state, { type:"planetary/collect", id:dep.id, cargoCapacity:used + 3 }, NOW);
  un();
  assert(res.changed && res.quantity === 3 && dep.storage === 2, "collect 应按仓位收取 3，剩 2");
  assert(ev && ev.payload.quantity === 3 && ev.payload.resourceId === "planetary:重金属", "planetary:collected 负载异常");
  dep.storage = 0;
  const emptyRes = dispatch(state, { type:"planetary/collect", id:dep.id, cargoCapacity:used + 3 }, NOW);
  assert(!emptyRes.changed && emptyRes.reason === "empty", "空仓收取应返回 empty");
});

// ================= M：renew 运行中拒绝 =================
region("M", "renew 运行中 already-active", () => {
  const state = freshState({ isk:500000, trit:100 });
  dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW);
  const dep = state.planetary.deployments[0];
  const iskBefore = state.resources.isk;
  const res = dispatch(state, { type:"planetary/renew", id:dep.id }, NOW + 1000);
  assert(!res.changed && res.reason === "already-active", "运行中续期应返回 already-active");
  assert(state.resources.isk === iskBefore, "already-active 不得扣费");
});

// ================= N：renew 到期续期语义 =================
region("N", "renew 到期只扣 ISK 保留库存", () => {
  const state = freshState({ isk:500000, trit:100 });
  dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW);
  const dep = state.planetary.deployments[0];
  dep.storage = 4; dep.active = false; // 模拟到期
  const iskBefore = state.resources.isk;
  const tritBefore = state.resources.minerals["三钛合金"];
  let ev = null; const un = sandbox.GameEvents.on("planetary:renewed", e => { ev = e; });
  const res = dispatch(state, { type:"planetary/renew", id:dep.id }, NOW + 5000);
  un();
  assert(res.changed, "到期续期应成功");
  assert(state.resources.isk === iskBefore - 46000, "续期应只扣 46000 ISK");
  assert(state.resources.minerals["三钛合金"] === tritBefore, "续期不得扣三钛");
  assert(dep.active === true && dep.deployedAt === NOW + 5000 && dep.progress === 0 && dep.duration === 86400, "续期应重置周期");
  assert(dep.storage === 4, "续期应保留库存");
  assert(ev && ev.payload.maintenanceISK === 46000, "planetary:renewed 负载异常");
});

// ================= O：demolish 非空拒绝 =================
region("O", "demolish 非空原子拒绝", () => {
  const state = freshState({ isk:500000, trit:100 });
  dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW);
  const dep = state.planetary.deployments[0];
  dep.storage = 1;
  const res = dispatch(state, { type:"planetary/demolish", id:dep.id }, NOW);
  assert(!res.changed && res.reason === "storage-not-empty", "非空拆除应返回 storage-not-empty");
  assert(state.planetary.deployments.length === 1, "非空拆除不得删除部署");
});

// ================= P：demolish 空仓删除不返还 =================
region("P", "demolish 空仓删除不返还", () => {
  const state = freshState({ isk:500000, trit:100 });
  dispatch(state, { type:"planetary/deploy", planetType:"lava" }, NOW);
  const dep = state.planetary.deployments[0];
  const iskAfterDeploy = state.resources.isk;
  const tritAfterDeploy = state.resources.minerals["三钛合金"];
  let ev = null; const un = sandbox.GameEvents.on("planetary:demolished", e => { ev = e; });
  const res = dispatch(state, { type:"planetary/demolish", id:dep.id }, NOW);
  un();
  assert(res.changed && state.planetary.deployments.length === 0, "空仓拆除应删除部署");
  assert(state.resources.isk === iskAfterDeploy && state.resources.minerals["三钛合金"] === tritAfterDeploy, "拆除不得返还任何资源");
  assert(ev && ev.payload.refundedISK === 0 && Object.keys(ev.payload.refundedResources).length === 0, "planetary:demolished 应声明零返还");
});

// ================= Q：事件契约 =================
region("Q", "事件契约注册与校验", () => {
  const contracts = sandbox.GameEvents.contracts;
  for (const t of ["planetary:deployed", "planetary:renewed", "planetary:expired", "planetary:collected", "planetary:demolished"]) assert(contracts.has(t), `事件 ${t} 未注册契约`);
  assert(contracts.validate("planetary:deployed", { deploymentId:"d", planetType:"lava", constructionISK:138000, constructionResources:{ "mineral:三钛合金":100 } }).valid, "deployed 合法负载应通过");
  assert(!contracts.validate("planetary:deployed", { deploymentId:"d", planetType:"lava" }).valid, "deployed 缺字段应失败");
  assert(contracts.validate("planetary:renewed", { deploymentId:"d", planetType:"lava", maintenanceISK:46000, expiresAt:NOW }).valid, "renewed 合法负载应通过");
  assert(contracts.validate("planetary:expired", { deploymentId:"d", planetType:"lava", expiredAt:NOW }).valid, "expired 合法负载应通过");
  assert(contracts.validate("planetary:collected", { deploymentId:"d", planetType:"lava", resourceId:"planetary:重金属", quantity:3 }).valid, "collected 合法负载应通过");
  assert(!contracts.validate("planetary:collected", { deploymentId:"d", planetType:"lava" }).valid, "collected 缺字段应失败");
  assert(contracts.validate("planetary:demolished", { deploymentId:"d", planetType:"lava", refundedISK:0, refundedResources:{} }).valid, "demolished 合法负载应通过");
});

// ================= R：在线 tick active=false 不生产 =================
region("R", "在线 tick 停产", () => {
  setGlobalPlanet({ id:"planet_1", planetType:"lava", deployedAt:NOW - 10000, duration:86400, storage:0, lastTick:NOW - 10000, progress:9, active:false });
  sandbox.planetaryTick(NOW);
  assert(sandbox.gameState.planetary.deployments[0].storage === 0, "active=false 不得生产");
});

// ================= S：在线 tick 到期一次触发 expired =================
region("S", "在线 tick 到期单次触发", () => {
  setGlobalPlanet({ id:"planet_1", planetType:"lava", deployedAt:NOW - 86400 * 1000 - 2000, duration:86400, storage:0, lastTick:NOW - 5000, progress:0, active:true });
  const events = [];
  const un = sandbox.GameEvents.on("planetary:expired", e => events.push(e));
  sandbox.planetaryTick(NOW);
  sandbox.planetaryTick(NOW + 1000);
  sandbox.planetaryTick(NOW + 2000);
  un();
  assert(sandbox.gameState.planetary.deployments[0].active === false, "到期后 active 应为 false");
  assert(events.length === 1, "planetary:expired 只应触发一次");
  assert(events[0].payload.planetType === "lava", "expired 事件 planetType 错误");
});

// ================= T：在线 tick 正常产出 =================
region("T", "在线 tick 正常产出", () => {
  setGlobalPlanet({ id:"planet_1", planetType:"lava", deployedAt:NOW - 10000, duration:86400, storage:0, lastTick:NOW - 10000, progress:5, active:true });
  const completed = [];
  const un = sandbox.GameEvents.on("planetary:completed", e => completed.push(e));
  const xpBefore = sandbox.gameState.skills.planetaryIndustry.xp;
  sandbox.planetaryTick(NOW);
  un();
  assert(sandbox.gameState.planetary.deployments[0].storage === 1, "在线应产出 1 单位");
  assert(sandbox.gameState.skills.planetaryIndustry.xp === xpBefore + 1, "在线产出应 xp+1");
  assert(completed.length === 1 && completed[0].payload.cycles === 1 && completed[0].payload.resourceId === "planetary:重金属", "planetary:completed 负载异常");
});

// ================= U：离线结算封顶到到期 =================
region("U", "离线结算封顶到期", () => {
  const realNow = Date.now();
  setGlobalPlanet({ id:"planet_1", planetType:"lava", deployedAt:realNow - 100000, duration:60, storage:0, lastTick:realNow - 100000, progress:0, active:true });
  const gains = { planetaryIndustry:0 };
  vm.runInContext('_offlineEventBatch = { runId:"audit_offline_u", sequence:0 }', sandbox);
  sandbox.settleOfflinePlanets(100, gains); // 100s 离线，但 60s 后到期
  vm.runInContext('_offlineEventBatch = null', sandbox);
  const dep = sandbox.gameState.planetary.deployments[0];
  assert(dep.storage === 6, "离线只结算到到期（60s / 10s = 6 周期）");
  assert(dep.active === false, "离线到期后应停产");
});

// ================= V：在线离线同段产出一致 =================
region("V", "在线/离线同段产出一致", () => {
  // 离线 50s
  const realNow = Date.now();
  setGlobalPlanet({ id:"planet_off", planetType:"lava", deployedAt:realNow - 3600 * 1000, duration:86400, storage:0, lastTick:realNow - 3600 * 1000, progress:0, active:true });
  const gains = { planetaryIndustry:0 };
  vm.runInContext('_offlineEventBatch = { runId:"audit_offline_v", sequence:0 }', sandbox);
  sandbox.settleOfflinePlanets(50, gains);
  vm.runInContext('_offlineEventBatch = null', sandbox);
  const offlineStorage = sandbox.gameState.planetary.deployments[0].storage;
  // 在线 50s（10 次 5s tick）
  setGlobalPlanet({ id:"planet_on", planetType:"lava", deployedAt:NOW, duration:86400, storage:0, lastTick:NOW, progress:0, active:true });
  for (let i = 1; i <= 10; i++) sandbox.planetaryTick(NOW + i * 5000);
  const onlineStorage = sandbox.gameState.planetary.deployments[0].storage;
  assert(offlineStorage === 5, "离线 50s 应产出 5 周期");
  assert(onlineStorage === 5, "在线 50s（分段）应产出 5 周期");
  assert(offlineStorage === onlineStorage, "在线与离线同段产出必须一致");
});

// ================= W：离线不自动续期/不扣费/到期一次 =================
region("W", "离线不自动续期不扣费", () => {
  const realNow = Date.now();
  setGlobalPlanet({ id:"planet_1", planetType:"lava", deployedAt:realNow - 100000, duration:60, storage:0, lastTick:realNow - 100000, progress:0, active:true });
  sandbox.gameState.resources.isk = 999999;
  const iskBefore = sandbox.gameState.resources.isk;
  const gains = { planetaryIndustry:0 };
  const expiredEvents = [];
  const un = sandbox.GameEvents.on("planetary:expired", e => expiredEvents.push(e));
  vm.runInContext('_offlineEventBatch = { runId:"audit_offline_w", sequence:0 }', sandbox);
  sandbox.settleOfflinePlanets(100, gains);
  sandbox.settleOfflinePlanets(100, gains); // 二次结算不得再生产/再触发
  vm.runInContext('_offlineEventBatch = null', sandbox);
  const dep = sandbox.gameState.planetary.deployments[0];
  assert(dep.active === false, "离线到期后应保持停产（不自动续期）");
  assert(sandbox.gameState.resources.isk === iskBefore, "离线不得自动扣 ISK");
  assert(dep.storage === 6, "二次离线结算不得重复生产");
  assert(expiredEvents.length === 1, "离线到期只应触发一次 expired");
});

// ================= X：迁移字段与到期规范化 =================
region("X", "迁移字段与到期规范化", () => {
  const base = Date.now();
  const migState = { planetary:{ nextId:1, deployments:[
    { id:"planet_1", type:"lava", deployedAt:base, storage:7, active:true },                                   // 缺 duration/lastTick/progress，type→planetType
    { id:"planet_2", type:"ice", deployedAt:base - 90000000, duration:86400, storage:3, lastTick:base, progress:2, active:true }, // 超期 active true → false
    { id:"planet_3", type:"gas", deployedAt:base, duration:86400, storage:0, lastTick:base, progress:0, active:false }            // active false 保持已到期
  ] } };
  sandbox.normalizePlanetaryState(migState);
  const [d1, d2, d3] = migState.planetary.deployments;
  assert(d1.planetType === "lava" && !Object.hasOwn(d1, "type"), "type 应迁移为 planetType 并删除 type");
  assert(d1.duration === 86400 && d1.progress === 0 && Number(d1.lastTick) > 0, "缺失字段应安全回填");
  assert(d1.storage === 7 && d1.active === true, "未到期部署应保持 storage 与运行");
  assert(d2.active === true && d2.storage === 3, "迁移阶段（finalizeExpiry:false）不得提前关闭 active=true 的就绪基地（否则离线结算会跳过，丢失最后一段收益）");
  assert(d3.active === false && d3.storage === 0, "active=false 应保持已到期");
  assert(migState.planetary.nextId === 4, "nextId 应为 max(existing, maxId+1)");
});

// ================= Y：迁移幂等 =================
region("Y", "迁移幂等", () => {
  const base = Date.now();
  const migState = { planetary:{ nextId:1, deployments:[
    { id:"planet_1", type:"lava", deployedAt:base, storage:7, active:true },
    { id:"planet_2", type:"ice", deployedAt:base - 90000000, duration:86400, storage:3, lastTick:base, progress:2, active:true }
  ] } };
  sandbox.normalizePlanetaryState(migState);
  const snap1 = JSON.stringify(migState);
  sandbox.normalizePlanetaryState(migState);
  const snap2 = JSON.stringify(migState);
  assert(snap1 === snap2, "连续两次规范化结果必须一致");
});

// ================= 迁移与离线结算顺序：集成入口（与生产 autoLoad / importData 顺序一致） =================
// 生产顺序：normalize(finalizeExpiry:false) → 删除旧容器 → calculateOfflineGains → normalize(finalizeExpiry:true)
// 此处直接驱动真实 calculateOfflineGains（含离线窗口计算与 settleOfflinePlanets），不做公式改写自证。
function setupGlobalForLoad(opts = {}) {
  const g = sandbox.gameState;
  g.planetary = { deployments:[], nextId:1 };
  delete g.planetaryDeployments;
  g.skills = g.skills || {};
  g.skills.planetaryIndustry = { lvl:opts.lvl || 1, xp:0 };
  g.resources = g.resources || {};
  g.resources.isk = opts.isk !== undefined ? opts.isk : 10000000;
  g.resources.minerals = g.resources.minerals || {};
  g.resources.minerals["三钛合金"] = opts.trit !== undefined ? opts.trit : 5000;
  g.lastActiveTime = opts.lastActiveTime !== undefined ? opts.lastActiveTime : 0;
  g.currentAction = g.currentAction || {};
  g.currentAction.active = false;
  return g;
}
function runOfflineSettlement(state, now, offlineSeconds) {
  state.lastActiveTime = now - offlineSeconds * 1000;
  if (state.currentAction) state.currentAction.active = false;
  // vm 上下文的 Date 是内建全局（非 sandbox 自有属性），必须在上下文内替换/恢复
  vm.runInContext(`globalThis.__auditRealDateNow = Date.now; Date.now = () => ${now};`, sandbox);
  const prevSave = sandbox.SaveManager;
  sandbox.SaveManager = { save:() => true };
  try { sandbox.calculateOfflineGains(); }
  finally {
    vm.runInContext("Date.now = globalThis.__auditRealDateNow; delete globalThis.__auditRealDateNow;", sandbox);
    sandbox.SaveManager = prevSave;
  }
}
function autoLoadOrder(state, now, offlineSeconds) {
  sandbox.normalizePlanetaryState(state, { now, finalizeExpiry:false });
  runOfflineSettlement(state, now, offlineSeconds);
  sandbox.normalizePlanetaryState(state, { now, finalizeExpiry:true });
  delete state.planetaryDeployments;
}
function importDataOrder(state, now, offlineSeconds) {
  sandbox.normalizePlanetaryState(state, { now, finalizeExpiry:false });
  delete state.planetaryDeployments;
  runOfflineSettlement(state, now, offlineSeconds);
  sandbox.normalizePlanetaryState(state, { now, finalizeExpiry:true });
}

// ================= Z：不追收 / 无补偿 / 遗留空容器 =================
region("Z", "不追收与无补偿", () => {
  const base = Date.now();
  const migState = { planetary:{ nextId:10, deployments:[{ id:"planet_2", type:"lava", deployedAt:base - 3600000, duration:86400, storage:5, lastTick:base - 3600000, progress:0, active:true }] } };
  const storageBefore = migState.planetary.deployments[0].storage;
  sandbox.normalizePlanetaryState(migState);
  assert(migState.planetary.deployments[0].storage === storageBefore, "迁移不得追收（storage 不变）");
  assert(migState.planetary.nextId === 10, "nextId 单调，不得回退（max(10, 3)=10）");
  const emptyState = { planetary:{ deployments:[], nextId:1 } };
  sandbox.normalizePlanetaryState(emptyState);
  assert(emptyState.planetary.deployments.length === 0 && emptyState.planetary.nextId === 1, "空结构规范化后无补偿部署");
});

// ================= ZA（规范A）：仅旧容器含 2 个部署，内容完整迁入 =================
region("ZA", "旧容器内容完整迁移", () => {
  const now = NOW;
  const state = { planetary:{ deployments:[], nextId:1 }, planetaryDeployments:[
    { id:"old1", type:"lava", timeDeployed: now - 50000, duration:86400, storage:3, progress:2, active:true },
    { id:"old2", type:"ice",  timeDeployed: now - 60000, duration:86400, storage:7, progress:1, active:false }
  ], resources:{ isk:10000000, minerals:{ "三钛合金":5000 } } };
  sandbox.normalizePlanetaryState(state, { now });
  assert(state.planetary.deployments.length === 2, "旧容器 2 个部署应完整迁入新版");
  const a = state.planetary.deployments.find(d => d.id === "old1");
  const b = state.planetary.deployments.find(d => d.id === "old2");
  assert(a && a.planetType === "lava" && a.storage === 3 && a.progress === 2 && a.active === true, "old1 的 planetType/storage/progress/active 保留");
  assert(b && b.planetType === "ice" && b.storage === 7 && b.progress === 1 && b.active === false, "old2 的 planetType/storage/progress/active 保留");
  assert(!("type" in a) && !("type" in b), "迁移后应删除旧 type 字段");
  assert(state.resources.isk === 10000000 && state.resources.minerals["三钛合金"] === 5000, "迁移不得追收 ISK/三钛");
});

// ================= ZB（规范B）：新旧容器共存，按 id 去重合并 =================
region("ZB", "新旧容器去重合并", () => {
  const now = NOW;
  const state = { planetary:{ nextId:5, deployments:[
    { id:"planet_1", planetType:"lava", deployedAt: now - 1000, duration:86400, storage:2, progress:0, lastTick:now - 1000, active:true }
  ] }, planetaryDeployments:[
    { id:"planet_1", type:"lava", timeDeployed: now - 5000, duration:86400, storage:9, progress:0, active:true }, // 同 id → 优先保留新版
    { id:"oldX", type:"ice", timeDeployed: now - 6000, duration:86400, storage:4, progress:0, active:true }       // 新版缺失 → 追加
  ] };
  sandbox.normalizePlanetaryState(state, { now });
  assert(state.planetary.deployments.length === 2, "合并后应为 新版1个 + 追加旧版1个 = 2");
  const kept = state.planetary.deployments.find(d => d.id === "planet_1");
  const appended = state.planetary.deployments.find(d => d.id === "oldX");
  assert(kept && kept.storage === 2 && kept.planetType === "lava", "同 id 优先保留新版（不被旧值覆盖）");
  assert(appended && appended.storage === 4 && appended.planetType === "ice", "旧版缺失部署应追加迁移");
  assert(state.planetary.nextId === 5, "nextId 保持单调（max(5, 1+1)=5）");
});

// ================= ZC（规范C）：重复迁移深比较一致 =================
region("ZC", "重复迁移幂等", () => {
  const now = NOW;
  const build = () => ({ planetary:{ deployments:[], nextId:1 }, planetaryDeployments:[
    { id:"old1", type:"lava", timeDeployed: now - 50000, duration:86400, storage:3, progress:2, active:true },
    { id:"old2", type:"ice",  timeDeployed: now - 60000, duration:86400, storage:7, progress:1, active:false }
  ], resources:{ isk:10000000, minerals:{ "三钛合金":5000 } } });
  const s1 = build(); sandbox.normalizePlanetaryState(s1, { now });
  const snap1 = JSON.stringify(s1);
  const s2 = build(); sandbox.normalizePlanetaryState(s2, { now }); // 旧容器仍在（调用方尚未删除）
  const snap2 = JSON.stringify(s2);
  sandbox.normalizePlanetaryState(s2, { now });                    // 对同一状态二次规范化
  const snap3 = JSON.stringify(s2);
  assert(snap1 === snap2, "两次独立迁移结果应深比较一致");
  assert(snap2 === snap3, "对同一状态二次规范化应幂等一致");
});

// ================= ZD（规范D）：旧 active=true，离线区间跨过 expiresAt，精确收益 =================
region("ZD", "离线跨到期点精确产出", () => {
  const now = NOW;
  const offlineSeconds = 3600;
  const g = setupGlobalForLoad({ lvl:1, lastActiveTime: now - offlineSeconds * 1000, isk:10000000, trit:5000 });
  const deployedAt = now - offlineSeconds * 1000; // = 离线起点（lastSave）
  const durationSec = 600;                   // 10 min → 在离线窗口中途到期（61 周期 < 仓上限 105，不受封顶干扰）
  g.planetaryDeployments = [{
    id:"old1", type:"lava", timeDeployed: deployedAt, duration:durationSec, storage:0, progress:0, active:true
  }];
  importDataOrder(g, now, offlineSeconds);   // 真实迁移 + 离线结算 + 最终化
  const dep = g.planetary.deployments[0];
  const interval = sandbox.getPlanetOutputInterval("lava");
  // 注意：calculateOfflineGains 结算后会把 lastActiveTime 推进到 now，期望窗口必须用 deployedAt 计算
  const activeWindow = durationSec;          // [lastSave=deployedAt, expiresAt] = duration 整段
  const expectedCycles = Math.floor(activeWindow / interval);
  assert(dep.storage === expectedCycles, `离线应精确获得 [lastSave, expiresAt] 共 ${expectedCycles} 周期，实得 ${dep.storage}`);
  assert(dep.active === false, "跨过到期点后最终 active 应为 false");
  const before = dep.storage;
  sandbox.settleOfflinePlanets(100, { planetaryIndustry:0 }); // 已 active=false → 跳过
  assert(dep.storage === before, "expiresAt 以后不应再生产（收益为 0）");
  assert(g.resources.isk === 10000000 && g.resources.minerals["三钛合金"] === 5000, "迁移/结算不得追收 ISK/三钛");
});

// ================= ZE（规范E）：autoLoad 顺序，字段迁移在离线结算前，不提前关闭 =================
region("ZE", "autoLoad 顺序不提前关闭", () => {
  const now = NOW;
  const g = setupGlobalForLoad({ lvl:1, lastActiveTime: now - 3600 * 1000 });
  const deployedAt = now - 3600 * 1000;
  const durationSec = 600; // 61 周期 < 仓上限 105
  g.planetaryDeployments = [{ id:"old1", type:"lava", timeDeployed: deployedAt, duration:durationSec, storage:0, progress:0, active:true }];
  autoLoadOrder(g, now, 3600);
  const dep = g.planetary.deployments[0];
  assert(dep.active === false, "autoLoad 顺序最终应关闭到期基地");
  const interval = sandbox.getPlanetOutputInterval("lava");
  const expectedCycles = Math.floor((deployedAt + durationSec * 1000 - deployedAt) / 1000 / interval);
  assert(dep.storage === expectedCycles && dep.storage > 0, "迁移未提前关闭，离线结算应正常产出最后一段");
});

// ================= ZF（规范F）：importData 顺序与 autoLoad 结果一致 =================
region("ZF", "importData 与 autoLoad 一致", () => {
  const now = NOW;
  const build = () => {
    const g = setupGlobalForLoad({ lvl:1, lastActiveTime: now - 3600 * 1000 });
    g.planetaryDeployments = [{ id:"old1", type:"lava", timeDeployed: now - 3600 * 1000, duration:600, storage:0, progress:0, active:true }];
    return g;
  };
  const ga = build(); autoLoadOrder(ga, now, 3600);
  const gi = build(); importDataOrder(gi, now, 3600);
  const strip = s => JSON.stringify(s.planetary.deployments.map(d => ({ id:d.id, planetType:d.planetType, storage:d.storage, active:d.active })));
  assert(strip(ga) === strip(gi), "importData 与 autoLoad 顺序结算结果应完全一致");
});

// ================= ZG（规范G）：在线最后周期，tick 晚于到期仍结算到期前最后完整周期 =================
region("ZG", "在线 tick 晚于到期仍结算最后段", () => {
  const interval = sandbox.getPlanetOutputInterval("lava");
  // 持续运行 100s（duration=100s）后到期；tick 发生在到期后，应结算全部 100s 产出
  const start = NOW - 105000; // deployedAt
  const durationMs = 100000;  // expiresAt = NOW - 5000
  setGlobalPlanet({ id:"planet_1", planetType:"lava", deployedAt:start, duration:durationMs / 1000, storage:0, lastTick:start, progress:0, active:true });
  const expiredEvents = [];
  const un = sandbox.GameEvents.on("planetary:expired", e => expiredEvents.push(e));
  sandbox.planetaryTick(NOW); // NOW 晚于 expiresAt(NOW-5000)
  un();
  const dep = sandbox.gameState.planetary.deployments[0];
  const expectedCycles = Math.floor(durationMs / 1000 / interval);
  assert(dep.storage === expectedCycles, `在线应结算到期前全部 ${expectedCycles} 周期，实得 ${dep.storage}`);
  assert(dep.active === false, "到期后 active 应为 false");
  assert(expiredEvents.length === 1, "planetary:expired 在线仅触发一次");
});

// ================= ZH（规范H）：防重复——第二次离线结算不重复收益，expired 不重复 =================
region("ZH", "防重复结算与事件", () => {
  const realNow = Date.now();
  setGlobalPlanet({ id:"planet_1", planetType:"lava", deployedAt:realNow - 100000, duration:60, storage:0, lastTick:realNow - 100000, progress:0, active:true });
  const expiredEvents = [];
  const un = sandbox.GameEvents.on("planetary:expired", e => expiredEvents.push(e));
  const gains = { planetaryIndustry:0 };
  vm.runInContext('_offlineEventBatch = { runId:"audit_offline_zh", sequence:0 }', sandbox);
  sandbox.settleOfflinePlanets(100, gains);
  sandbox.settleOfflinePlanets(100, gains); // 二次结算不得再生产/再触发
  vm.runInContext('_offlineEventBatch = null', sandbox);
  un();
  const dep = sandbox.gameState.planetary.deployments[0];
  assert(dep.storage === 6, "首次离线结算产出 6 周期");
  assert(dep.active === false, "离线到期后应保持停产");
  assert(dep.storage === 6, "二次离线结算不得重复生产");
  assert(expiredEvents.length === 1, "离线到期只应触发一次 expired");
});

console.log(`\n专项审计通过：共 ${totalAssertions} 断言，覆盖 ${Object.keys(regionCounts).length} 区（A~Z）`);
console.log("分区断言数：" + Object.keys(regionCounts).sort().map(k => `${k}=${regionCounts[k]}`).join(" "));
