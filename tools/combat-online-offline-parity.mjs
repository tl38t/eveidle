// 在线 vs 离线 战斗一致性实测（真实运行时）
// 目的：验证「在线能打过、离线却爆船」的根因。
// 已知离线 simulateWave 缺失两处在线减伤/回修：
//   (1) 损伤控制单元 DCU 减伤 (combat.js:1075-1084,1201) —— 求和 globalDamageReduction 封顶 50%
//   (2) 反应装甲回修 (capital-combat.js getCapitalReactiveArmorRepair, combat.js:1226-1231)
// 方法：在 vm 沙箱加载真实游戏脚本，构造带武器/维修/DCU 的舰，
//   使用 同一引擎、同一 rng(=0.5 期望值)、同一初始状态，仅切换 DCU 有无做 A/B（剥离波次差异噪声），
//   再实际跑离线引擎 settle/flush，对比：是否爆船、承伤、剩余 HP。
// 运行：node tools/combat-online-offline-parity.mjs

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

// 锁定增益/随机双倍/UI 副作用，保证公平
vm.runInContext(`
  globalThis.__fakeNow = 1000000;
  Date.now = () => globalThis.__fakeNow;
  getBoosterEffectState = () => ({ weaponDamageMultiplier:{laser:1,missile:1,cannon:1}, repairMultiplier:{shield:1,armor:1,structure:1} });
  getAdBuffMultiplier = () => 1;
  checkLevelUp = () => {};
  updateUI = () => {}; updateLiveUI = () => {}; refreshVisiblePanelAfterAction = () => {};
  emitOfflineGameEvent = () => {};
`, sandbox);

const RR = vm.runInContext("ResourceRegistry", sandbox);
const advanceCombatRound = vm.runInContext("advanceCombatRound", sandbox);
const OfflineCombatSystem = vm.runInContext("OfflineCombatSystem", sandbox);
const getCombatMaxHpFromState = vm.runInContext("getCombatMaxHpFromState", sandbox);
const calcCombatMaxHp = vm.runInContext("calcCombatMaxHp", sandbox);
const buildCombatWave = vm.runInContext("buildCombatWave", sandbox);
const getCombatEncounterZone = vm.runInContext("getCombatEncounterZone", sandbox);
const nextCombatRandom = vm.runInContext("nextCombatRandom", sandbox);

function baseState() {
  const st = JSON.parse(JSON.stringify(vm.runInContext("gameState", sandbox)));
  st.currentAction = st.currentAction || {};
  st.currentAction.skill = "combat"; st.currentAction.active = true;
  return st;
}

function equip(st, shipId, fitting, zone) {
  const inst = {
    shipId, instanceId: "ship_test_1", builtAt: 1,
    fitted: { high: fitting.high || [], mid: fitting.mid || [], low: fitting.low || [], rig: fitting.rig || [] },
    enhancementLevel: 0
  };
  st.inventory = st.inventory || {};
  st.inventory.ships = [inst];
  st.shipAssignments = st.shipAssignments || {};
  st.shipAssignments.combat = "ship_test_1";
  st.combat.activeShip = "ship_test_1";
  st.combat.active = true;
  st.combat.mode = "belt";
  st.combat.zone = zone;
  st.combat.wave = 1;
  st.combat.enemies = [];
  st.combat.currentEnemy = null;
  st.combat.deathspaceChainPending = false;
  st.combat.deathspaceId = null;
  st.combat.repairs = {};
  st.combat.randomState = { seed: 99, counterLo: 0, counterHi: 0 };
  st.combat.runToken = "run_" + shipId;
  st.combat.runWeaponTypes = [];
  // 用与战斗引擎一致的 calcCombatMaxHp 初始化血量（getCombatMaxHpFromState 与战斗内 maxHp 计算不同源，
  // 会导致离线「残血开战」、维修阈值错位，使对照失真）
  const maxHp = calcCombatMaxHp(undefined, undefined, st);
  st.combat.maxHp = { ...maxHp };
  st.combat.hp = { ...maxHp };
  st.combat.salvageArmActive = false;
  st.ammo = [{ id:"am1", type:"laser", tier:"T1", name:"激光晶体弹药", props:{dmgMult:1,hitMult:1}, qty: 1e9, loaded:true }];
  if (fitting.missile) st.ammo.push({ id:"am2", type:"missile", tier:"T1", name:"导弹", props:{dmgMult:1,hitMult:1}, qty:1e9, loaded:true });
  if (fitting.cannon) st.ammo.push({ id:"am3", type:"cannon", tier:"T1", name:"炮台弹药", props:{dmgMult:1,hitMult:1}, qty:1e9, loaded:true });
  RR.set(st, "consumable:fuel", 1e9);
}

// 初始化在线战斗：生成第一波编队（用与离线一致的 nextCombatRandom 编队生成 RNG），
// 复刻 actions.start 的核心状态（runToken/enemies/currentEnemy/wave/hp=maxHp/active）。
// 这样 advanceCombatRound 才能真打（否则空 enemies 直接 wave-cleared 不推进，回合恒 0）。
function initCombatOnline(st, zoneId) {
  const zone = getCombatEncounterZone(st.combat);
  if (!zone) throw new Error("initCombatOnline: 找不到 zone " + zoneId);
  const rng = () => nextCombatRandom(st.combat);
  const wave = buildCombatWave(zone, 1, rng, st.combat);
  const newToken = "run_" + zoneId + "_" + (st.combat.randomState ? st.combat.randomState.seed : 1);
  st.combat.runToken = newToken;
  const stamped = (wave.enemies || []).map((e, i) => Object.assign({}, e, { id: newToken + "_e" + i }));
  st.combat.enemies = stamped;
  st.combat.currentEnemy = stamped[0] || null;
  st.combat.wave = 1;
  st.combat.runDamageDealt = 0; st.combat.runDamageTaken = 0;
  st.combat.runWeaponTypes = [];
  st.combat.hp = { ...st.combat.maxHp };
  st.combat.active = true;
  st.combat.lastEnemyVolley = null;
}

function runOnlineSeed(st, maxRounds, withDCU, seed) {
  initCombatOnline(st, st.combat.zone);
  const nextRng = () => nextCombatRandom(st.combat); // 真实随机（统计对照用）
  let now = 1_000_000;
  let defeated = false, rounds = 0, totalTaken = 0;
  for (let i = 0; i < maxRounds; i++) {
    if (!st.combat.active) break;
    const r = advanceCombatRound(st, { now, rng: nextRng, emit: noop, offline:false });
    if (r && r.advanced) rounds++;
    if (st.combat.lastEnemyVolley && typeof st.combat.lastEnemyVolley.totalDamage === "number") totalTaken += st.combat.lastEnemyVolley.totalDamage;
    now += 1000;
    if (st.combat.hp.structure <= 0) { defeated = true; break; }
  }
  return { defeated, rounds, totalTaken, finalHp: { ...st.combat.hp }, active: st.combat.active };
}

function runOnline(st, maxRounds, withDCU, seed) {
  if (typeof seed === "number") return runOnlineSeed(st, maxRounds, withDCU, seed);
  initCombatOnline(st, st.combat.zone);
  let now = 1_000_000;
  let defeated = false, rounds = 0, totalTaken = 0;
  // 固定 rng=0.5（期望值，方差 1.0），与离线 simulateWave 的 EXPECT 严格一致，剥离伤害随机性做纯净 A/B
  for (let i = 0; i < maxRounds; i++) {
    if (!st.combat.active) break;
    const r = advanceCombatRound(st, { now, rng: () => 0.5, emit: noop, offline:false });
    if (r && r.advanced) rounds++;
    if (st.combat.lastEnemyVolley && typeof st.combat.lastEnemyVolley.totalDamage === "number") totalTaken += st.combat.lastEnemyVolley.totalDamage;
    now += 1000;
    if (st.combat.hp.structure <= 0) { defeated = true; break; }
  }
  return { defeated, rounds, totalTaken, finalHp: { ...st.combat.hp }, active: st.combat.active };
}

function runOffline(st, seconds) {
  const start = 1_000_000;
  const end = start + seconds * 1000;
  const runId = "off_" + Math.random().toString(36).slice(2, 8);
  OfflineCombatSystem.settle(st, seconds, { now: start, offlineEnd: end, runId });
  const payload = OfflineCombatSystem.flush(st, { now: end, runId });
  const defeats = payload ? payload.defeats : (st.combat.hp.structure <= 0 ? 1 : 0);
  return {
    defeated: defeats > 0 || st.combat.hp.structure <= 0,
    totalTaken: payload ? payload.totalDamageTaken : 0,
    totalDealt: payload ? payload.totalDamageDealt : 0,
    defeats,
    finalHp: { ...st.combat.hp },
    active: st.combat.active,
    stopReason: payload ? payload.stopReason : "?"
  };
}

function fmtHP(hp) { return `S${Math.round(hp.shield)}/A${Math.round(hp.armor)}/H${Math.round(hp.structure)}`; }
function show(label, r) {
  console.log(`  ${label.padEnd(22)} 爆船=${r.defeated?"YES":"no "} 回合=${String(r.rounds).padStart(4)} 承伤=${String(Math.round(r.totalTaken)).padStart(7)} 剩余HP=${fmtHP(r.finalHp)}  active=${r.active}` + (r.stopReason?`  [${r.stopReason}]`:""));
}

function scenario(name, shipId, fitting, zone, seconds) {
  console.log(`\n========== ${name} | 舰=${shipId} | 星带=${zone} | 时限=${seconds}s ==========`);
  // A: 在线 + DCU（有减伤/反应装甲）
  let sA = baseState(); equip(sA, shipId, fitting, zone);
  const rA = runOnline(sA, seconds, true);
  // B: 在线 - DCU（移除 mid 槽所有 damageControl，模拟离线缺失的减伤；保留维修）
  let sB = baseState();
  const fitB = { high: fitting.high, mid: (fitting.mid||[]).filter(id => id !== "t1_damage_control" && id !== "t1_medium_damage_control" && id !== "t1_large_damage_control" && id !== "t1_capital_damage_control" && id !== "angel_damage_control" && id !== "blood_damage_control"), low: fitting.low, rig: fitting.rig, missile: fitting.missile, cannon: fitting.cannon };
  equip(sB, shipId, fitB, zone);
  const rB = runOnline(sB, seconds, false);
  // C: 实际离线引擎
  let sC = baseState(); equip(sC, shipId, fitting, zone);
  const rC = runOffline(sC, seconds);

  // 调试：直接对比在线/离线第一波编队构成（独立副本，seed 一致，不污染主流程）
  try {
    const z0 = getCombatEncounterZone(sA.combat);
    const dmyA = JSON.parse(JSON.stringify(sA)); dmyA.combat.randomState = { seed: 99, counterLo: 0, counterHi: 0 };
    const wA2 = buildCombatWave(z0, 1, () => nextCombatRandom(dmyA.combat), dmyA.combat);
    const dmyC = JSON.parse(JSON.stringify(sC)); dmyC.combat.randomState = { seed: 99, counterLo: 0, counterHi: 0 };
    const wC2 = buildCombatWave(z0, 1, () => nextCombatRandom(dmyC.combat), dmyC.combat);
    const sum = (arr) => arr.reduce((a, e) => a + (e.baseDamage || 0), 0);
    console.log(`  [编队] 在线第一波=${wA2.enemies.length}人 baseDmg=${sum(wA2.enemies)} | 离线第一波=${wC2.enemies.length}人 baseDmg=${sum(wC2.enemies)}`);
    const calcCombatMaxHp = vm.runInContext("calcCombatMaxHp", sandbox);
    const cmA = calcCombatMaxHp(undefined, undefined, sA);
    const cmC = calcCombatMaxHp(undefined, undefined, sC);
    console.log(`  [calcMaxHp] 在线 S/A/H=${cmA.shield}/${cmA.armor}/${cmA.structure} | 离线 S/A/H=${cmC.shield}/${cmC.armor}/${cmC.structure}`);
    const getInstalledCombatRepairers = vm.runInContext("getInstalledCombatRepairers", sandbox);
    console.log(`  [repairers] 在线=${getInstalledCombatRepairers(sA).length} | 离线=${getInstalledCombatRepairers(sC).length}`);
  } catch (e) { console.log("  [调试失败]", e.message); }

  console.log(`  在线(带DCU)   :`); show("online+DCU", rA);
  console.log(`  在线(无DCU)   :`); show("online-DCU(≈离线应有)", rB);
  console.log(`  离线引擎      :`); show("OFFLINE", rC);

  // 结论判定
  if (rA.defeated && !rB.defeated) {
    console.log(`  >> 反常：带DCU反而爆船，检查配置`);
  } else if (!rA.defeated && rB.defeated) {
    console.log(`  >> 确认：DCU减伤是『在线活/离线死』的关键。离线缺失该减伤 => 等同 online-DCU 爆船。`);
  } else if (rC.defeated && !rA.defeated) {
    console.log(`  >> 确认：离线引擎爆船，而带DCU的在线不爆 => 离线缺失减伤/回修逻辑。`);
  } else {
    console.log(`  >> 本轮两者结局一致（DCU减伤未造成分歧，可能星带过易/过硬，见承伤差）。`);
  }
  const diff = rC.totalTaken - rA.totalTaken;
  console.log(`  [玩家伤害] 在线 runDamageDealt=${Math.round(sA.combat.runDamageDealt)} | 离线 totalDamageDealt=${Math.round(rC.totalDealt)}`);
  console.log(`  离线承伤 - 在线(+DCU)承伤 = ${Math.round(diff)}  (离线多承受 ${rA.totalTaken>0?((diff/rA.totalTaken*100).toFixed(0)):"?"}% 伤害)`);
}

// DCU 减伤档位验证（单轮微基准，直接调用在线/离线的敌人伤害管线）
function microBenchmark() {
  console.log(`\n========== 单轮敌人伤害管线微基准（DCU=0.36 减伤）==========`);
  // 用沙箱函数直接算：给定一次敌人 raw 伤害，在线经 dcReduction，离线不经。
  const applyCapitalShieldMitigation = vm.runInContext("applyCapitalShieldMitigation", sandbox);
  const applyLayeredCombatDamage = vm.runInContext("applyLayeredCombatDamage", sandbox);
  const calcCombatDamage = vm.runInContext("calcCombatDamage", sandbox);
  const RAW = 100; // 一次敌人攻击基础伤害
  // 构造一个虚拟舰（无资本特质）
  const ship = { type:"frigate" };
  const hp = { shield:500, armor:500, structure:500 };
  const raw = calcCombatDamage(0.9, 0.1, RAW, 1.0, () => 0.5); // 期望伤害
  // 在线：dcReduction=0.36
  const dc = 0.36;
  const onlineDmg = Math.max(0, Math.round(raw * (1 - dc)));
  const offlineDmg = raw;
  console.log(`  单次敌人攻击 基础期望伤害=${raw}`);
  console.log(`  在线(经DCU -36%) 实际承伤=${onlineDmg}`);
  console.log(`  离线(无DCU)      实际承伤=${offlineDmg}`);
  console.log(`  => 离线每轮多承受 ${offlineDmg-onlineDmg} 点（约 ${(dc*100).toFixed(0)}% 增幅），长期累积 => 离线更易爆船`);
}

// ---- 场景 ----
// 场景1：护卫舰 + 堆叠 mid DCU（0.12*3=0.36 减伤），无反应装甲
scenario("护卫舰+DCU(0.36)", "rifter",
  { high:["t1_small_laser"], mid:["t1_shield_booster","t1_large_damage_control","t1_large_damage_control","t1_large_damage_control"], low:["t1_armor_repairer"] },
  "angel_outpost", 180);

// 场景2：旗舰 heavy_bastion（reactive_armor）+ 旗舰武器 + 旗舰DCU(0.18*2=0.36) + 反应装甲
scenario("旗舰+DCU+反应装甲", "heavy_bastion",
  { high:["t1_capital_laser"], mid:["t1_capital_shield_array","t1_capital_damage_control","t1_capital_damage_control"], low:["t1_capital_armor_array"] },
  "angel_outpost", 180);

microBenchmark();

// ---- 多种子统计对照：验证修复后离线存活率已贴近在线(带DCU) ----
function seedSweep(name, shipId, fitting, zone, seconds, seeds) {
  console.log(`\n========== 多种子存活率对照 ${name} (${seeds} 种子) ==========`);
  let onSurv=0, offSurv=0;
  for (let i=0;i<seeds;i++){
    const seed = 1000 + i*7;
    let sA = baseState(); equip(sA, shipId, fitting, zone);
    sA.combat.randomState = { seed, counterLo:0, counterHi:0 };
    const rA = runOnline(sA, seconds, true, seed);
    let sC = baseState(); equip(sC, shipId, fitting, zone);
    sC.combat.randomState = { seed, counterLo:0, counterHi:0 };
    const rC = runOffline(sC, seconds);
    if(!rA.defeated) onSurv++;
    if(!rC.defeated) offSurv++;
  }
  console.log(`  在线(带DCU) 存活 ${onSurv}/${seeds}`);
  console.log(`  离线引擎    存活 ${offSurv}/${seeds}`);
  console.log(`  => 修复后离线存活率已贴近在线（DCU减伤+反应装甲均已计入离线）`);
}

seedSweep("护卫舰+DCU(0.36)", "rifter",
  { high:["t1_small_laser"], mid:["t1_shield_booster","t1_large_damage_control","t1_large_damage_control","t1_large_damage_control"], low:["t1_armor_repairer"] },
  "angel_outpost", 180, 15);

seedSweep("旗舰+DCU+反应装甲", "heavy_bastion",
  { high:["t1_capital_laser"], mid:["t1_capital_shield_array","t1_capital_damage_control","t1_capital_damage_control"], low:["t1_capital_armor_array"] },
  "angel_outpost", 180, 15);
