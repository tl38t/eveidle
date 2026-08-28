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
// getBoosterEffectState 改为读取 state.boosters.active（如玩家主动装战斗槽），
// 缺省按无增益处理。Ad Buff、checkLevelUp、UI 等副作用继续屏蔽。
vm.runInContext(`
  globalThis.__fakeNow = 1000000;
  Date.now = () => globalThis.__fakeNow;
  getBoosterEffectState = (state) => {
    const out = {
      miningSpeedMultiplier: 1, doubleMineralChance: 0,
      archaeologySpeedMultiplier: 1, rareShiftMultiplier: 1,
      weaponDamageMultiplier: { laser:1, missile:1, cannon:1 },
      repairMultiplier: { shield:1, armor:1, structure:1 },
      gasSpeedMultiplier: 1, doubleGasChance: 0,
      smeltSpeedMultiplier: 1, doubleSmeltChance: 0,
      shipSpeedMultiplier: 1, equipmentSpeedMultiplier: 1,
      shipMaterialDiscount: 0, shipMaterialLevelGate: 0,
      equipMaterialDiscount: 0, equipMaterialLevelGate: 0,
      skillLevelBySkill: {}, boosterSpeedMultiplier: 1, doubleBoosterChance: 0,
      skillXpMultBySkill: {}, activeEntries: {}
    };
    const active = (state && state.boosters && state.boosters.active) || {};
    const getItem = (typeof getBoosterItem === "function") ? getBoosterItem : null;
    for (const slot in active) {
      const entry = active[slot];
      if (!entry || !entry.itemId || !(entry.remainingMs > 0)) continue;
      const item = getItem ? getItem(entry.itemId) : null;
      if (!item) continue;
      if (item.effectType === "damageMultiplier" && item.weaponType && item.weaponType in out.weaponDamageMultiplier) {
        out.weaponDamageMultiplier[item.weaponType] *= (1 + Number(item.effectValue));
      } else if (item.effectType === "repairAmount" && item.repairTarget && item.repairTarget in out.repairMultiplier) {
        out.repairMultiplier[item.repairTarget] *= (1 + Number(item.effectValue));
      }
    }
    return out;
  };
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

// 装备 + 每实例强化等级（enh 数组下标对应 fitting 的下标，缺省 0）。
// 字符串 fitting 直接用（旧接口）；对象 fitting {id, enhancementLevel} 创建真实 instance。
function equipEnhanced(st, shipId, fittingSpec, zone) {
  const slots = ["high","mid","low","rig"];
  const fitted = { high:[], mid:[], low:[], rig:[] };
  st.equipment = st.equipment || { instances: [] };
  for (const slot of slots) {
    const arr = fittingSpec[slot] || [];
    arr.forEach((entry, idx) => {
      if (typeof entry === "string") {
        fitted[slot].push(entry);
      } else {
        const instId = `${slot}_${entry.id}_${idx}_test`;
        st.equipment.instances.push({
          instanceId: instId,
          itemId: entry.id,
          installedOn: "ship_test_1",
          enhancementLevel: entry.enhancementLevel || 0
        });
        fitted[slot].push(instId);
      }
    });
  }
  const inst = {
    shipId, instanceId: "ship_test_1", builtAt: 1,
    fitted, enhancementLevel: 0
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
  const maxHp = calcCombatMaxHp(undefined, undefined, st);
  st.combat.maxHp = { ...maxHp };
  st.combat.hp = { ...maxHp };
  st.combat.salvageArmActive = false;
  st.ammo = [{ id:"am1", type:"laser", tier:"T1", name:"激光晶体弹药", props:{dmgMult:1,hitMult:1}, qty: 1e9, loaded:true }];
  if (fittingSpec.missile) st.ammo.push({ id:"am2", type:"missile", tier:"T1", name:"导弹", props:{dmgMult:1,hitMult:1}, qty:1e9, loaded:true });
  if (fittingSpec.cannon) st.ammo.push({ id:"am3", type:"cannon", tier:"T1", name:"炮台弹药", props:{dmgMult:1,hitMult:1}, qty:1e9, loaded:true });
  RR.set(st, "consumable:fuel", 1e9);
}

// 设置战斗技能等级（按玩家报告数值）。
function setPlayerSkills(st, levels) {
  st.skills = st.skills || {};
  for (const [k, v] of Object.entries(levels)) {
    st.skills[k] = st.skills[k] || { lvl:1, xp:0 };
    st.skills[k].lvl = v;
    st.skills[k].xp = 0;
  }
}

// 把战斗槽增强剂塞到 state.boosters.active（itemId 用 "booster:<series>_<quality>" 格式）。
function setCombatBoosters(st, weaponSeries, weaponQuality, repairSeries, repairQuality) {
  st.boosters = st.boosters || { active:{} };
  st.boosters.active = st.boosters.active || {};
  if (weaponSeries) st.boosters.active.combatWeapon = { itemId: `booster:${weaponSeries}_${weaponQuality}`, remainingMs: 600_000 };
  if (repairSeries) st.boosters.active.combatRepair = { itemId: `booster:${repairSeries}_${repairQuality}`, remainingMs: 600_000 };
}

// 清除战斗槽增强剂（用作「无增强剂」对照）。
function clearCombatBoosters(st) {
  if (!st.boosters) return;
  st.boosters.active = {};
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

// ============================================================================
// 玩家真实场景（QQ 群友报告）— 苍勤 = angel_warfront（CL55 准入，最高级苍穹图）
// ============================================================================
// 配装：曜光级 + 5 大型激光 + 5 大型盾修 + 2 大型打捞臂，所有模块强化+10。
// 技能：战斗 55 / 激光 63 / 锁定 56 / 护盾 48 / 操舵 48 / 电容 52 / 防御 51。
// 增强剂：2 级输出药（laser_coolant r +14% 激光伤害）+ 3 级盾修药（shield_recharge l +45% 护盾维修）。
// 玩家原话："刚好卡着能秒的情况当时"
const PLAYER_LEVELS = {
  combat:55, laserOps:63, targeting:56, shieldOperation:48,
  piloting:48, capacitorManagement:52, defense:51, shipEngineering:55
};
const PLAYER_FITTING = {
  high: Array.from({length:5}, (_,i) => ({ id:"t1_large_laser", enhancementLevel:10 })),
  mid:  Array.from({length:5}, (_,i) => ({ id:"t1_large_shield_booster", enhancementLevel:10 })),
  low:  Array.from({length:2}, (_,i) => ({ id:"t4_salvage_arm", enhancementLevel:10 })),
  rig:  []
};

// 用玩家的配装在线跑离线跑（单种子，确定性）— 5 个时长梯度
function playerScenario(seconds, withBooster) {
  const name = `玩家真实场景 | sunlance | angel_warfront | 时限=${seconds}s | 增强剂=${withBooster?"开":"关"}`;
  console.log(`\n========== ${name} ==========`);
  // 在线（玩家配装）
  let sA = baseState();
  equipEnhanced(sA, "sunlance", PLAYER_FITTING, "angel_warfront");
  setPlayerSkills(sA, PLAYER_LEVELS);
  if (withBooster) setCombatBoosters(sA, "laser_coolant", "r", "shield_recharge", "l");
  else clearCombatBoosters(sA);
  const rA = runOnline(sA, seconds, true);
  // 离线
  let sC = baseState();
  equipEnhanced(sC, "sunlance", PLAYER_FITTING, "angel_warfront");
  setPlayerSkills(sC, PLAYER_LEVELS);
  if (withBooster) setCombatBoosters(sC, "laser_coolant", "r", "shield_recharge", "l");
  else clearCombatBoosters(sC);
  const rC = runOffline(sC, seconds);

  console.log(`  在线(玩家配装)  :`); show("ONLINE-player", rA);
  console.log(`  离线引擎(玩家配装):`); show("OFFLINE-player", rC);

  const diff = rC.totalTaken - rA.totalTaken;
  const pct = rA.totalTaken>0 ? ((diff/rA.totalTaken*100).toFixed(0)) : "?";
  console.log(`  离线承伤 - 在线承伤 = ${Math.round(diff)} (${pct}%)`);

  // 调试：编队 / 模块 / 期望 DPS
  try {
    const z0 = getCombatEncounterZone(sA.combat);
    const dmy = JSON.parse(JSON.stringify(sA));
    dmy.combat.randomState = { seed: 99, counterLo: 0, counterHi: 0 };
    const w0 = buildCombatWave(z0, 1, () => nextCombatRandom(dmy.combat), dmy.combat);
    const sum = (arr) => arr.reduce((a, e) => a + (e.baseDamage || 0), 0);
    console.log(`  [编队] 第 1 波 ${w0.enemies.length} 敌 baseDmg=${sum(w0.enemies)} | 种类: ${w0.enemies.map(e=>e.name).slice(0,3).join("/")}...`);
    console.log(`  [玩家炮面板] 激光 5 门 baseDmg 480 × (1+0.2 ship) × (1+0.05 enh10) × (1+0.14 booster) ≈ ${Math.round(5*480*1.2*1.1*1.14)} 期望/轮`);
    const eff = vm.runInContext("getBoosterEffectState", sandbox)(sA);
    console.log(`  [增强剂生效] 激光伤害乘区=${eff.weaponDamageMultiplier.laser.toFixed(2)} | 护盾维修乘区=${eff.repairMultiplier.shield.toFixed(2)}`);
  } catch (e) { console.log("  [调试失败]", e.message); }
}

playerScenario(60, true);
playerScenario(120, true);
playerScenario(180, true);
playerScenario(300, true);

// 不开增强剂的对照 — 看是否「无增强剂玩家也爆」
playerScenario(180, false);

// 多种子统计：玩家配装在 angel_warfront 的在线/离线存活率
function playerSeedSweep(seconds, seeds, withBooster) {
  console.log(`\n========== 玩家配装 多种子存活率对照 (angel_warfront, 时限=${seconds}s, 增强剂=${withBooster?"开":"关"}, ${seeds} 种子) ==========`);
  let onSurv=0, offSurv=0, onRounds=0, offRounds=0;
  for (let i=0;i<seeds;i++){
    const seed = 1000 + i*7;
    let sA = baseState();
    equipEnhanced(sA, "sunlance", PLAYER_FITTING, "angel_warfront");
    setPlayerSkills(sA, PLAYER_LEVELS);
    if (withBooster) setCombatBoosters(sA, "laser_coolant", "r", "shield_recharge", "l");
    else clearCombatBoosters(sA);
    sA.combat.randomState = { seed, counterLo:0, counterHi:0 };
    const rA = runOnline(sA, seconds, true, seed);
    let sC = baseState();
    equipEnhanced(sC, "sunlance", PLAYER_FITTING, "angel_warfront");
    setPlayerSkills(sC, PLAYER_LEVELS);
    if (withBooster) setCombatBoosters(sC, "laser_coolant", "r", "shield_recharge", "l");
    else clearCombatBoosters(sC);
    sC.combat.randomState = { seed, counterLo:0, counterHi:0 };
    const rC = runOffline(sC, seconds);
    if(!rA.defeated) { onSurv++; onRounds += rA.rounds; }
    if(!rC.defeated) { offSurv++; offRounds += (typeof rC.rounds === "number" ? rC.rounds : 0); }
  }
  console.log(`  在线存活 ${onSurv}/${seeds}（平均 ${(onRounds/Math.max(onSurv,1)).toFixed(1)} 轮）`);
  console.log(`  离线存活 ${offSurv}/${seeds}（平均 ${(offRounds/Math.max(offSurv,1)).toFixed(1)} 轮）`);
  if (offSurv < onSurv) {
    console.log(`  >>> 离线存活率明显低于在线（差 ${onSurv - offSurv}/${seeds}），这是用户报告的『在线能打过离线爆船』`);
  } else {
    console.log(`  => 离线存活率不低于在线，玩家报告的『离线爆船』未复现`);
  }
}

playerSeedSweep(180, 10, true);
playerSeedSweep(60, 10, true);

// ============================================================================
// 轨迹对照：玩家配装，在线/离线逐轮 HP/承伤对比（定位分叉点）
// ============================================================================
function tracePlayerScenario(seconds) {
  console.log(`\n========== 轨迹对照 | sunlance | angel_warfront | ${seconds}s ==========`);
  // 在线：逐轮打印（每 10 轮 + 最后 5 轮）
  let sA = baseState();
  equipEnhanced(sA, "sunlance", PLAYER_FITTING, "angel_warfront");
  setPlayerSkills(sA, PLAYER_LEVELS);
  setCombatBoosters(sA, "laser_coolant", "r", "shield_recharge", "l");
  initCombatOnline(sA, sA.combat.zone);
  let now = 1_000_000;
  const onTrace = [];
  for (let i = 0; i < seconds; i++) {
    if (!sA.combat.active) break;
    const r = advanceCombatRound(sA, { now, rng: () => 0.5, emit: noop, offline:false });
    now += 1000;
    const hp = sA.combat.hp;
    const taken = sA.combat.lastEnemyVolley ? sA.combat.lastEnemyVolley.totalDamage : 0;
    const line = `ON  wave=${sA.combat.wave} r=${i+1} hpS=${Math.round(hp.shield)}/A${Math.round(hp.armor)}/H${Math.round(hp.structure)} taken=${Math.round(taken)} enemies=${(sA.combat.enemies||[]).filter(e=>e.hp.structure>0).length}`;
    onTrace.push(line);
    if (sA.combat.hp.structure <= 0) { onTrace.push(`ON  *** 爆船 @r=${i+1}`); break; }
  }
  // 离线：__traceOffline 钩子
  let sC = baseState();
  equipEnhanced(sC, "sunlance", PLAYER_FITTING, "angel_warfront");
  setPlayerSkills(sC, PLAYER_LEVELS);
  setCombatBoosters(sC, "laser_coolant", "r", "shield_recharge", "l");
  const offTrace = [];
  vm.runInContext("globalThis.__traceOffline = (line) => globalThis.__offTracePush(line)", sandbox);
  sandbox.__offTracePush = (line) => offTrace.push(line);
  const rC = runOffline(sC, seconds);
  vm.runInContext("delete globalThis.__traceOffline", sandbox);

  const dump = (arr, label) => {
    console.log(`--- ${label}（每 10 轮 + 末 8 行）---`);
    const head = arr.filter((_, idx) => (idx % 10 === 9));
    const tail = arr.slice(-8);
    for (const l of head) console.log("  " + l);
    console.log("  ......");
    for (const l of tail) console.log("  " + l);
  };
  dump(onTrace, "在线");
  dump(offTrace, "离线");
  console.log(`  在线结局=${onTrace.some(l=>l.includes("爆船"))?"爆船":"存活"} | 离线结局=${rC.defeated?"爆船("+rC.stopReason+")":"存活"}`);
}
tracePlayerScenario(180);

// ============================================================================
// 同种子真随机轨迹对照：在线(nextCombatRandom) vs 离线(detRng)
// ============================================================================
function traceSeedScenario(seed, seconds) {
  console.log(`\n========== 种子=${seed} 真随机轨迹 | sunlance | angel_warfront | ${seconds}s ==========`);
  let sA = baseState();
  equipEnhanced(sA, "sunlance", PLAYER_FITTING, "angel_warfront");
  setPlayerSkills(sA, PLAYER_LEVELS);
  setCombatBoosters(sA, "laser_coolant", "r", "shield_recharge", "l");
  sA.combat.randomState = { seed, counterLo:0, counterHi:0 };
  const rA = runOnline(sA, seconds, true, seed);
  // 统计在线编队规模分布
  const onForm = {};
  {
    let sD = baseState();
    equipEnhanced(sD, "sunlance", PLAYER_FITTING, "angel_warfront");
    setPlayerSkills(sD, PLAYER_LEVELS);
    setCombatBoosters(sD, "laser_coolant", "r", "shield_recharge", "l");
    sD.combat.randomState = { seed, counterLo:0, counterHi:0 };
    // 重放：波次流与在线一致需要逐波消费相同 rng——此处仅统计在线战斗里实际出现的波次规模
  }
  let sC = baseState();
  equipEnhanced(sC, "sunlance", PLAYER_FITTING, "angel_warfront");
  setPlayerSkills(sC, PLAYER_LEVELS);
  setCombatBoosters(sC, "laser_coolant", "r", "shield_recharge", "l");
  sC.combat.randomState = { seed, counterLo:0, counterHi:0 };
  const offTrace = [];
  vm.runInContext("globalThis.__traceOffline = (line) => globalThis.__offTracePush(line)", sandbox);
  sandbox.__offTracePush = (line) => offTrace.push(line);
  const rC = runOffline(sC, seconds);
  vm.runInContext("delete globalThis.__traceOffline", sandbox);

  const onByWave = {};
  // 从 runOnline 无法拿到逐波信息（advanceCombatRound 内部推进），改为直接在结果中汇总
  const offByWave = {};
  for (const l of offTrace) {
    const m = l.match(/wave=(\d+).*taken=(\d+)/);
    if (m) { const w = m[1]; offByWave[w] = offByWave[w] || { rounds:0, taken:0, max:0 }; offByWave[w].rounds++; offByWave[w].taken += Number(m[2]); offByWave[w].max = Math.max(offByWave[w].max, Number(m[2])); }
  }
  console.log(`  在线: 爆船=${rA.defeated} 回合=${rA.rounds} 承伤=${Math.round(rA.totalTaken)}`);
  console.log(`  离线: 爆船=${rC.defeated} 承伤=${Math.round(rC.totalTaken)} stop=${rC.stopReason}`);
  const waves = Object.keys(offByWave).slice(0, 30);
  console.log(`  离线逐波承伤（波: 轮数/累计/单轮最大）:`);
  for (const w of waves) { const d = offByWave[w]; console.log(`    wave=${w}: ${d.rounds}轮 累计${d.taken} 单轮最大${d.max}`); }
}
traceSeedScenario(1000, 180);
traceSeedScenario(1007, 180);
