import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 沙箱设置（与 verify.mjs 相同的 DOM mock 模式）
function MockCanvasContext() {}
const noop = () => {};
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add:noop, remove:noop, toggle:noop, contains:() => false };
const makeElement = () => ({ addEventListener:noop, appendChild:noop, classList, click:noop, closest:() => null, dataset:{}, focus:noop, getBoundingClientRect:() => ({ left:0, top:0, width:100, height:100 }), getContext:() => new MockCanvasContext(), innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector:() => makeElement(), querySelectorAll:() => [], remove:noop, select:noop, style:{}, textContent:"", value:"1" });
const documentMock = { addEventListener:noop, body:makeElement(), createElement:() => makeElement(), createElementNS:() => ({ ...makeElement(), setAttribute:noop }), getElementById:() => makeElement(), querySelector:() => makeElement(), querySelectorAll:() => [] };

const sandbox = {
  alert:noop, Blob, CanvasRenderingContext2D:MockCanvasContext, console, confirm:() => true,
  document:documentMock, FileReader:class {}, localStorage:{ getItem:() => null, setItem:noop },
  requestAnimationFrame:noop, setInterval:noop, setTimeout:noop, clearTimeout:noop,
  URL:{ createObjectURL:() => "blob:mock", revokeObjectURL:noop }, window:null, Date, Math, JSON, Object, Array, Set, Map, Number, String, Boolean, parseInt, parseFloat, isNaN, isFinite
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
vm.createContext(sandbox);

// 加载全部脚本（与 index.html 相同顺序）
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1]);
for (const src of scriptSources) {
  const code = fs.readFileSync(path.resolve(root, src.replace(/^\.\//, "")), "utf8");
  vm.runInContext(code, sandbox, { filename:src });
}
// 暴露顶层 const 声明
vm.runInContext("window.__EQUIPMENT_DB = EQUIPMENT_DB; window.__SMELTING_RECIPES = SMELTING_RECIPES;", sandbox);

const EE = sandbox.ShipEnhancement;
const failures = [];

function assert(label, condition) {
  if (condition) console.log("  ✓ " + label);
  else { console.log("  ✗ " + label); failures.push(label); }
}

function expectedAttemptsToLevel(skillLevel, threshold, targetLevel) {
  let sum = 0;
  for (let L = 0; L < targetLevel; L++) {
    const p = EE.getSuccessChance(skillLevel, threshold, L);
    if (p <= 0) continue;
    sum += 1 / p;
  }
  return sum;
}

function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ════════════════════════════════════════════════════════════════
// A 区：共用公式 — 舰船与装备共享同一套边际递减
// ════════════════════════════════════════════════════════════════
{
  const gaps = [0, 5, 10, 15, 25, 50, 79];
  const levels = [0, 4, 5, 9, 10, 14, 15, 20, 30, 100];
  for (const gap of gaps) {
    for (const L of levels) {
      const ship = EE.getSuccessChance(1 + gap, 1, L);
      const b = EE.getSuccessBreakdown(1 + gap, 1, L);
      assert(`A gap=${gap} L=${L} ship=${ship}`, near(ship, b.final));
    }
  }
}
assert("A base 0.50 gap=0 L=0", EE.getSuccessChance(1, 1, 0) === 0.50);
assert("A cap 0.80 gap=79", EE.getSuccessChance(80, 1, 0) === 0.80);
assert("A floor 0.05 gap=0 L=100", EE.getSuccessChance(1, 1, 100) === 0.05);
assert("A skillBonus cap 0.30", EE.getSuccessBreakdown(80, 1, 0).skillBonus === 0.30);
assert("A threshold 0→+1 = 0.50", EE.getSuccessChance(35, 35, 0) === 0.50);

// ════════════════════════════════════════════════════════════════
// B 区：期望尝试次数锚点（失败不掉级模型）
// ════════════════════════════════════════════════════════════════
{
  const T = 1.0;
  // gap=0
  assert("B gap=0 +5 ~ 10.66", near(expectedAttemptsToLevel(1, 1, 5), 10.66, T));
  assert("B gap=0 +10 ~ 24.55", near(expectedAttemptsToLevel(1, 1, 10), 24.55, T));
  assert("B gap=0 +15 ~ 59.68", near(expectedAttemptsToLevel(1, 1, 15), 59.68, T));
  assert("B gap=0 +20 ~ 159.68", near(expectedAttemptsToLevel(1, 1, 20), 159.68, T));
  assert("B gap=0 +30 ~ 359.68", near(expectedAttemptsToLevel(1, 1, 30), 359.68, T));
  // gap=9
  assert("B gap=9 +5 ~ 7.70", near(expectedAttemptsToLevel(10, 1, 5), 7.70, T));
  assert("B gap=9 +10 ~ 16.93", near(expectedAttemptsToLevel(10, 1, 10), 16.93, T));
  assert("B gap=9 +15 ~ 31.62", near(expectedAttemptsToLevel(10, 1, 15), 31.62, T));
  assert("B gap=9 +20 ~ 104.49", near(expectedAttemptsToLevel(10, 1, 20), 104.49, T));
  assert("B gap=9 +30 ~ 304.49", near(expectedAttemptsToLevel(10, 1, 30), 304.49, T));
  // gap=19
  assert("B gap=19 +5 ~ 7.00", near(expectedAttemptsToLevel(20, 1, 5), 7.00, T));
  assert("B gap=19 +10 ~ 15.24", near(expectedAttemptsToLevel(20, 1, 10), 15.24, T));
  assert("B gap=19 +15 ~ 27.50", near(expectedAttemptsToLevel(20, 1, 15), 27.50, T));
  assert("B gap=19 +20 ~ 85.55", near(expectedAttemptsToLevel(20, 1, 20), 85.55, T));
  assert("B gap=19 +30 ~ 285.55", near(expectedAttemptsToLevel(20, 1, 30), 285.55, T));
  // gap=79 (capped)
  assert("B gap=79 +5 ~ 6.50", near(expectedAttemptsToLevel(80, 1, 5), 6.50, T));
  assert("B gap=79 +10 ~ 14.05", near(expectedAttemptsToLevel(80, 1, 10), 14.05, T));
  assert("B gap=79 +15 ~ 24.82", near(expectedAttemptsToLevel(80, 1, 15), 24.82, T));
  assert("B gap=79 +20 ~ 69.80", near(expectedAttemptsToLevel(80, 1, 20), 69.80, T));
  assert("B gap=79 +30 ~ 269.80", near(expectedAttemptsToLevel(80, 1, 30), 269.80, T));
}

// ════════════════════════════════════════════════════════════════
// C 区：Action 真实语义
// ════════════════════════════════════════════════════════════════
{
  // 使用全局 gameState（已由脚本加载初始化），拷贝干净副本
  const st = JSON.parse(JSON.stringify(sandbox.gameState));
  st.skills.shipEngineering = { lvl: 1, xp: 0 };
  st.currentAction.active = false;
  st.combat.active = false;
  st.resources.shipComponents = { integrated_hull: 10, power_core: 10, functional_system: 10 };
  // 清空默认舰船，加入测试舰
  st.inventory.ships = [];
  const ship = { shipId:"rifter", instanceId:"ship_test_1", builtAt:Date.now(), fitted:{ high:[], mid:[], low:[], rig:[] }, enhancementLevel:0 };
  st.inventory.ships.push(ship);
  const dga = sandbox.dispatchGameAction;

  // C1: +0 失败
  {
    const beforeComps = { ...st.resources.shipComponents };
    const beforeXp = st.skills.shipEngineering.xp;
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.99 }, Date.now());
    assert("C1 +0 fail changed=true", r.changed === true);
    assert("C1 +0 fail success=false", r.success === false);
    assert("C1 +0 fail level=0", ship.enhancementLevel === 0);
    assert("C1 +0 fail xp=0", r.xp === 0);
    assert("C1 +0 fail components -1 each",
      st.resources.shipComponents.integrated_hull === beforeComps.integrated_hull - 1 &&
      st.resources.shipComponents.power_core === beforeComps.power_core - 1 &&
      st.resources.shipComponents.functional_system === beforeComps.functional_system - 1);
    assert("C1 +0 fail ship xp unchanged", st.skills.shipEngineering.xp === beforeXp);
  }

  // C2: +0 成功
  {
    ship.enhancementLevel = 0;
    st.resources.shipComponents.integrated_hull = 3;
    st.resources.shipComponents.power_core = 3;
    st.resources.shipComponents.functional_system = 3;
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.49 }, Date.now());
    assert("C2 +0 success changed=true", r.changed === true);
    assert("C2 +0 success success=true", r.success === true);
    assert("C2 +0 success level=1", ship.enhancementLevel === 1);
    assert("C2 +0 success xp>0", r.xp > 0);
  }

  // C3: +10 失败
  {
    ship.enhancementLevel = 10;
    st.resources.shipComponents.integrated_hull = 5;
    st.resources.shipComponents.power_core = 5;
    st.resources.shipComponents.functional_system = 5;
    const beforeXp = st.skills.shipEngineering.xp;
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.99 }, Date.now());
    // L=10: gap=0 → levelPenalty=0.075+0.15=0.225 → final=0.275, roll=0.99 > 0.275 → fail
    assert("C3 +10 fail level=10", ship.enhancementLevel === 10);
    assert("C3 +10 fail xp=0", r.xp === 0);
    assert("C3 +10 fail components", st.resources.shipComponents.integrated_hull === 4);
  }

  // C4: +10 成功
  {
    ship.enhancementLevel = 10;
    st.resources.shipComponents.integrated_hull = 3;
    st.resources.shipComponents.power_core = 3;
    st.resources.shipComponents.functional_system = 3;
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.27 }, Date.now());
    assert("C4 +10 success level=11", ship.enhancementLevel === 11);
    assert("C4 +10 success xp>0", r.xp > 0);
  }

  // C5: 材料不足原子拒绝
  {
    st.resources.shipComponents.integrated_hull = 0;
    st.resources.shipComponents.power_core = 0;
    st.resources.shipComponents.functional_system = 0;
    const before = JSON.stringify(st.resources.shipComponents);
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0 }, Date.now());
    assert("C5 insufficient components", r.changed === false && r.reason === "insufficient-components");
    assert("C5 no components spent", JSON.stringify(st.resources.shipComponents) === before);
  }

  // C6: 舰船忙碌拒绝
  {
    st.combat.active = true;
    const { getActiveCombatShipState } = sandbox;
    // Need to set up combat state
    st.combat = { active:true, activeShip:ship.instanceId, hp:{ shield:100, armor:100, structure:100 }, maxHp:{ shield:100, armor:100, structure:100 }, enemies:[], currentEnemy:null, wave:1, zoneClears:{}, runEliteKills:0, currentFormation:"", totalKills:0, mode:"belt", weapon:"laser", repair:{ shieldBooster:true, armorRepairer:true, structureRepairer:false }, targetingMode:"auto" };
    st.currentAction.active = false;
    st.resources.shipComponents.integrated_hull = 3;
    st.resources.shipComponents.power_core = 3;
    st.resources.shipComponents.functional_system = 3;
    const before = JSON.stringify(st.resources.shipComponents);
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0 }, Date.now());
    assert("C6 busy rejected", r.changed === false && r.reason === "ship-active");
    assert("C6 no components spent", JSON.stringify(st.resources.shipComponents) === before);
  }

  // C7: 高等级仍可强化（无硬上限）
  {
    st.combat.active = false;
    ship.enhancementLevel = 100;
    st.resources.shipComponents.integrated_hull = 3;
    st.resources.shipComponents.power_core = 3;
    st.resources.shipComponents.functional_system = 3;
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.04 }, Date.now());
    assert("C7 L100→101 success", r.changed && r.success && ship.enhancementLevel === 101);
  }

  // C8: 失败事件正确
  {
    ship.enhancementLevel = 4;
    st.resources.shipComponents.integrated_hull = 3;
    st.resources.shipComponents.power_core = 3;
    st.resources.shipComponents.functional_system = 3;
    const events = [];
    const origEmit = sandbox.GameEvents.emit;
    sandbox.GameEvents.emit = (name, payload) => { if (name === "ship:enhancementAttempted") events.push(payload); };
    const r = dga(st, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.99 }, Date.now());
    sandbox.GameEvents.emit = origEmit;
    assert("C8 fail event emitted", events.length === 1);
    assert("C8 fail event success=false", events[0].success === false);
    assert("C8 fail event fromLevel===toLevel", events[0].fromLevel === events[0].toLevel);
    assert("C8 fail event xp=0", events[0].xp === 0);
    assert("C8 fail event componentsSpent=3", events[0].componentsSpent === 3);
  }
}

// ════════════════════════════════════════════════════════════════
// D 区：收益不回归
// ════════════════════════════════════════════════════════════════
{
  const rifter = sandbox.getShipConfigById("rifter");
  const miner = sandbox.getShipConfigById("miner_frigate");
  const archaeo = sandbox.getShipConfigById("heron");

  // 战斗舰里程碑
  const c5 = EE.getBonuses(rifter, 5);
  assert("D combat +5 hp 5%", near(c5.hpMultiplier, 1.05));
  assert("D combat +5 dmg 2.5%", near(c5.damageMultiplier, 1.025));
  const c10 = EE.getBonuses(rifter, 10);
  assert("D combat +10 hp 10%", near(c10.hpMultiplier, 1.10));
  assert("D combat +10 dmg 5%", near(c10.damageMultiplier, 1.05));
  const c15 = EE.getBonuses(rifter, 15);
  assert("D combat +15 hp 15%", near(c15.hpMultiplier, 1.15));
  assert("D combat +15 dmg 7.5%", near(c15.damageMultiplier, 1.075));
  const c20 = EE.getBonuses(rifter, 20);
  assert("D combat +20 hp 20%", near(c20.hpMultiplier, 1.20));
  assert("D combat +20 dmg 10%", near(c20.damageMultiplier, 1.10));
  const c30 = EE.getBonuses(rifter, 30);
  assert("D combat +30 hp 30%", near(c30.hpMultiplier, 1.30));
  assert("D combat +30 dmg 15%", near(c30.damageMultiplier, 1.15));
  assert("D combat industryMultiplier=1", near(c5.industryMultiplier, 1));

  // 工业舰
  const i5 = EE.getBonuses(miner, 5);
  assert("D industry +5 hp=1", near(i5.hpMultiplier, 1));
  assert("D industry +5 ind 7.5%", near(i5.industryMultiplier, 1.075));
  assert("D industry dmg=1", near(i5.damageMultiplier, 1));
  assert("D industry +10 ind 15%", near(EE.getBonuses(miner, 10).industryMultiplier, 1.15));
  assert("D industry +15 ind 22.5%", near(EE.getBonuses(miner, 15).industryMultiplier, 1.225));

  // 考古舰
  const a5 = EE.getBonuses(archaeo, 5);
  assert("D archaeo +5 hp 5%", near(a5.hpMultiplier, 1.05));
  assert("D archaeo +5 dmg=1", near(a5.damageMultiplier, 1));
  assert("D archaeo +5 ind=1", near(a5.industryMultiplier, 1));
  assert("D archaeo +5 scan 5%", near(a5.archaeologyScanMultiplier, 1.05));
  assert("D archaeo +10 scan 10%", near(EE.getBonuses(archaeo, 10).archaeologyScanMultiplier, 1.10));
  assert("D archaeo +15 scan 15%", near(EE.getBonuses(archaeo, 15).archaeologyScanMultiplier, 1.15));

  // 成本
  for (const shipDef of [rifter, sandbox.getShipConfigById("sunlance"), sandbox.getShipConfigById("firmament")]) {
    const cost = EE.getCost(shipDef);
    assert(`D cost ${shipDef.id}: 3 items`, Object.keys(cost).length === 3);
    assert(`D cost ${shipDef.id}: all qty=1`, Object.values(cost).every(q => q === 1));
  }
}

// ════════════════════════════════════════════════════════════════
// E 区：舰级直觉哨兵
// ════════════════════════════════════════════════════════════════
{
  const shipIds = ["rifter","raylight","dawnlight","sunlance","firmament","starcrown"];
  const names = ["护卫舰","驱逐舰","巡洋舰","战列舰","旗舰","超级旗舰"];
  const baseHp = shipIds.map(id => {
    const cfg = sandbox.getShipConfigById(id);
    return cfg ? cfg.hp.shield + cfg.hp.armor + cfg.hp.structure : 0;
  });
  for (let i = 0; i < shipIds.length - 1; i++) {
    const low30 = baseHp[i] * EE.getBonuses(sandbox.getShipConfigById(shipIds[i]), 30).hpMultiplier;
    const high0 = baseHp[i + 1];
    assert(`E +30 ${names[i]} ≤ +0 ${names[i+1]}`, low30 <= high0);
  }
}

// ════════════════════════════════════════════════════════════════
// F 区：六舰级报告（仅制造时间，不含采集/冶炼/原料生产）
// ════════════════════════════════════════════════════════════════
{
  // 从 VM 上下文读取真实 SHIP_COMPONENT_RECIPES（const 声明不挂 sandbox 属性）
  const recipes = vm.runInContext("SHIP_COMPONENT_RECIPES", sandbox);
  if (!Array.isArray(recipes)) throw new Error("SHIP_COMPONENT_RECIPES 读取失败");

  const tierDefs = [
    { name:"护卫舰", th:1, ids:["integrated_hull","power_core","functional_system"] },
    { name:"驱逐舰", th:15, ids:["destroyer_integrated_hull","destroyer_power_core","destroyer_functional_system"] },
    { name:"巡洋舰", th:35, ids:["cruiser_integrated_hull","cruiser_power_core","cruiser_functional_system"] },
    { name:"战列舰", th:55, ids:["battleship_integrated_hull","battleship_power_core","battleship_functional_system"] },
    { name:"旗舰", th:80, ids:["capital_integrated_hull","capital_power_core","capital_functional_system"] },
    { name:"超级旗舰", th:90, ids:["supercapital_integrated_hull","supercapital_power_core","supercapital_functional_system"] }
  ];

  // 硬锁 setSeconds 锚点（防回归）
  const SET_SECONDS_ANCHOR = { 护卫舰:123, 驱逐舰:183, 巡洋舰:272, 战列舰:388, 旗舰:900, 超级旗舰:1350 };

  for (const def of tierDefs) {
    // 数据驱动读取三件部件 time
    const times = def.ids.map(id => {
      const r = recipes.find(rec => rec.id === id);
      if (!r) throw new Error(`${def.name} 部件 ${id} 未找到`);
      if (!Number.isFinite(r.time)) throw new Error(`${def.name} 部件 ${id} 的 time 缺失`);
      return r.time;
    });
    const setSeconds = times.reduce((s, t) => s + t, 0);
    if (setSeconds !== SET_SECONDS_ANCHOR[def.name]) {
      throw new Error(`${def.name} setSeconds=${setSeconds} !== 锚点${SET_SECONDS_ANCHOR[def.name]}`);
    }

    console.log(`\n${def.name}（制造门槛Lv.${def.th}，单次消耗3件部件，一套制造${setSeconds}秒）`);
    for (const label of ["刚到门槛(Lv."+def.th+")", "舰船工程Lv.99"]) {
      const eng = label.includes("99") ? 99 : def.th;
      const targets = [5, 15, 30];
      const rows = targets.map(t => {
        const a = expectedAttemptsToLevel(eng, def.th, t);
        const partCount = Math.round(a * 3);
        const manuHours = Math.round(a * setSeconds / 3600 * 100) / 100;
        return `+${t}：${Math.round(a*100)/100}次 / ${partCount}件部件 / ${manuHours}h制造（仅部件时间，不含采集/冶炼/原料）`;
      });
      console.log(`  ${label}｜${rows.join("；")}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════
console.log("\n结果汇总");
const failCount = failures.length;
console.log(failCount === 0 ? "全部断言通过 ✅" : `${failCount} 项断言失败 ❌：\n  ${failures.join("\n  ")}`);
process.exit(failCount === 0 ? 0 : 1);
