// 在线 vs 离线 真实行为对照测试（正式交付测试，非临时探针）
// 用途：验证 mining/refining/gas 的“在线逐周期产出”与“离线逐周期结算”结果一致，
//       以真实运行时（非源码正则/解析式）证明「离线 = 在线」。
// 方法：加载与 verify.mjs 相同的真实游戏脚本到 vm 沙箱，禁用随机双倍产出（脑插/增强剂/调度），
//       对每种技能构造相同状态与相同 elapsed，分别走真实 gameTick 与真实 getOfflineActionDescriptor().apply，
//       比对：完成周期数、产出资源、消耗资源。
// 运行：node tools/test-online-offline-parity.mjs
// 退出码：0 = 全部一致；1 = 存在不一致。

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));

const noop = () => {};
function MockCanvasContext() {}
for (const n of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[n] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add:noop, remove:noop, toggle:noop, contains:()=>false };
const makeElement = () => ({ addEventListener:noop, appendChild:noop, classList, click:noop, closest:()=>null, dataset:{}, focus:noop, getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}), getContext:()=>new MockCanvasContext(), innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector:()=>makeElement(), querySelectorAll:()=>[], remove:noop, setAttribute:noop, removeAttribute:noop, getAttribute:()=>null, select:noop, style:{}, textContent:"", value:"1" });
const documentMock = { addEventListener:noop, readyState:"loading", body:makeElement(), createElement:()=>makeElement(), createElementNS:()=>({...makeElement(),setAttribute:noop}), getElementById:()=>makeElement(), querySelector:()=>makeElement(), querySelectorAll:()=>[] };
const localStorageMock = { getItem:()=>null, setItem:noop, removeItem:noop };
const sandbox = { alert:noop, Blob, CanvasRenderingContext2D:MockCanvasContext, console, confirm:()=>true, document:documentMock, FileReader:class{}, localStorage:localStorageMock, matchMedia:()=>({matches:false,media:"",addEventListener:noop,removeEventListener:noop,addListener:noop,removeListener:noop}), requestAnimationFrame:noop, setInterval:noop, setTimeout:noop, clearTimeout:noop, URL:{createObjectURL:()=>"blob:mock",revokeObjectURL:noop}, window:null };
sandbox.window = sandbox; sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (const src of scriptSources) {
  vm.runInContext(fs.readFileSync(path.join(root, src.replace(/^\.\//,"")), "utf8"), sandbox, { filename: src });
}

// 在沙箱上下文内控制时间并锁定随机双倍产出（真实运行时这些效果默认关闭）
vm.runInContext(`
  globalThis.__fakeNow = 1000000;
  const __realDateNow = Date.now;
  Date.now = () => globalThis.__fakeNow;
  globalThis.__setNow = (t) => { globalThis.__fakeNow = t; };
  globalThis.__addNow = (ms) => { globalThis.__fakeNow += ms; };
  getImplantDoubleOutputChance = () => 0;
  rollDoubleMineral = () => false;
  // 返回“无增强剂生效”的完整对象（selectors 会解引用 .gasSpeedMultiplier 等，不能为 null）
  getBoosterEffectState = () => ({ miningSpeedMultiplier:1, doubleMineralChance:0, doubleSmeltChance:0, doubleGasChance:0, smeltSpeedMultiplier:1, gasSpeedMultiplier:1, doubleBoosterChance:0 });
  recordStationDispatchAction = () => 0;
  checkLevelUp = () => {};
  updateUI = () => {}; updateLiveUI = () => {}; refreshVisiblePanelAfterAction = () => {};
`, sandbox);

const RR = vm.runInContext("ResourceRegistry", sandbox);

const TARGET_LVL = 20;
function freshState() {
  const st = vm.runInContext("gameState", sandbox);
  st.skills = st.skills || {};
  st.skills.mining = { lvl: TARGET_LVL, xp: 0 };
  st.skills.refining = { lvl: TARGET_LVL, xp: 0 };
  st.skills.gasHarvesting = { lvl: TARGET_LVL, xp: 0 };
  st.skills.shipEngineering = { lvl: TARGET_LVL, xp: 0 };
  st.resources = { isk: 0, ores:{}, minerals:{}, gases:{}, moonOres:{}, planetary:{}, special:{}, shipComponents:{} };
  st.currentAction = { skill:"mining", area:"凡晶石带", startedArea:"凡晶石带", miningMode:"normal", smeltingArea:"凡晶石带", startedSmeltingArea:"凡晶石带", gasArea:"富勒烯云团", startedGasArea:"富勒烯云团", active:true, progress:0, lastProgressUpdate:0 };
  return st;
}

function driveOnline(elapsedSeconds) {
  const STEP = 5;
  let remaining = elapsedSeconds;
  while (remaining > 1e-9) {
    const step = Math.min(STEP, remaining);
    vm.runInContext("globalThis.__addNow(" + (step * 1000) + ")", sandbox);
    vm.runInContext("gameTick()", sandbox);
    remaining -= step;
  }
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
}

function runCase(label, setup, producedIds, consumedIds) {
  console.log(`\n[${label}]`);
  // 离线：真实 getOfflineActionDescriptor().apply
  freshState();
  setup(vm.runInContext("gameState", sandbox));
  const desc = vm.runInContext("getOfflineActionDescriptor()", sandbox);
  const duration = desc.duration;
  const cycles = 8;
  // 在线推进 (cycles+0.5) 个周期时长，确保 floor(elapsed/duration) === cycles（避免浮点边界少算 1 周期）
  const elapsed = (cycles + 0.5) * duration;
  const beforeOffline = {};
  for (const id of [...producedIds, ...consumedIds]) beforeOffline[id] = RR.get(vm.runInContext("gameState", sandbox), id);
  desc.apply(cycles, {});
  const afterOffline = {};
  for (const id of [...producedIds, ...consumedIds]) afterOffline[id] = RR.get(vm.runInContext("gameState", sandbox), id);
  const offProduced = producedIds.map(id => afterOffline[id] - beforeOffline[id]);
  const offConsumed = consumedIds.map(id => beforeOffline[id] - afterOffline[id]);

  // 在线：真实 gameTick
  freshState();
  setup(vm.runInContext("gameState", sandbox));
  vm.runInContext("gameState.currentAction.progress = 0; gameState.currentAction.lastProgressUpdate = 0; globalThis.__setNow(1000000);", sandbox);
  const beforeOnline = {};
  for (const id of [...producedIds, ...consumedIds]) beforeOnline[id] = RR.get(vm.runInContext("gameState", sandbox), id);
  driveOnline(elapsed);
  const afterOnline = {};
  for (const id of [...producedIds, ...consumedIds]) afterOnline[id] = RR.get(vm.runInContext("gameState", sandbox), id);
  const onProduced = producedIds.map(id => afterOnline[id] - beforeOnline[id]);
  const onConsumed = consumedIds.map(id => beforeOnline[id] - afterOnline[id]);

  console.log(`  周期 duration=${duration.toFixed(3)}s，目标 cycles=${cycles}`);
  console.log(`  离线 产出=${JSON.stringify(offProduced)} 消耗=${JSON.stringify(offConsumed)}`);
  console.log(`  在线 产出=${JSON.stringify(onProduced)} 消耗=${JSON.stringify(onConsumed)}`);
  const onSum = onProduced.reduce((a,b)=>a+b,0), offSum = offProduced.reduce((a,b)=>a+b,0);
  check(`${label}: 完成周期数一致（在线≈离线=${cycles}）`, onSum >= cycles - 1 && Math.abs(onSum - offSum) <= cycles, `在线产出合计 ${onSum}`);
  check(`${label}: 产出资源一致`, JSON.stringify(onProduced) === JSON.stringify(offProduced), `在线 ${JSON.stringify(onProduced)} vs 离线 ${JSON.stringify(offProduced)}`);
  check(`${label}: 消耗资源一致`, JSON.stringify(onConsumed) === JSON.stringify(offConsumed), `在线 ${JSON.stringify(onConsumed)} vs 离线 ${JSON.stringify(offConsumed)}`);
}

runCase("采矿 凡晶石带", (st) => {
  st.currentAction.skill = "mining"; st.currentAction.area = "凡晶石带"; st.currentAction.startedArea = "凡晶石带"; st.currentAction.active = true;
}, ["ore:凡晶石"], []);

runCase("采气 富勒烯云团", (st) => {
  st.currentAction.skill = "gasHarvesting"; st.currentAction.gasArea = "富勒烯云团"; st.currentAction.startedGasArea = "富勒烯云团"; st.currentAction.active = true;
}, ["gas:粗制富勒烯"], []);

runCase("冶炼 凡晶石带→三钛合金", (st) => {
  st.currentAction.skill = "refining"; st.currentAction.smeltingArea = "凡晶石带"; st.currentAction.startedSmeltingArea = "凡晶石带"; st.currentAction.active = true;
  RR.set(st, "ore:凡晶石", 50);
}, ["mineral:三钛合金"], ["ore:凡晶石"]);

console.log(`\n=== 在线/离线真实行为对照：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
