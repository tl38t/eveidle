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
const makeElement = () => ({ addEventListener:noop, append:noop, appendChild:noop, classList, click:noop, closest:() => null, dataset:{}, focus:noop, getAttribute:() => null, getBoundingClientRect:() => ({ left:0, top:0, width:100, height:100 }), getContext:() => new MockCanvasContext(), hidden:false, innerHTML:"", insertBefore:noop, offsetHeight:24, offsetWidth:560, prepend:noop, querySelector:() => makeElement(), querySelectorAll:() => [], remove:noop, removeAttribute:noop, removeChild:noop, select:noop, setAttribute:noop, setAttributeNS:noop, style:{}, textContent:"", value:"1" });
const documentMock = { addEventListener:noop, readyState:"loading", body:makeElement(), createElement:() => makeElement(), createElementNS:() => ({ ...makeElement(), setAttribute:noop }), getElementById:() => makeElement(), querySelector:() => makeElement(), querySelectorAll:() => [] };

const sandbox = {
  alert:noop, Blob, CanvasRenderingContext2D:MockCanvasContext, console, confirm:() => true,
  matchMedia:() => ({ matches:false, media:"", addEventListener:noop, removeEventListener:noop, addListener:noop, removeListener:noop }),
  document:documentMock, FileReader:class {}, localStorage:{ getItem:() => null, setItem:noop },
  requestAnimationFrame:noop, setInterval:noop, setTimeout:noop, clearTimeout:noop,
  URL:{ createObjectURL:() => "blob:mock", revokeObjectURL:noop }, window:null, Date, Math, JSON, Object, Array, Set, Map, Number, String, Boolean, parseInt, parseFloat, isNaN, isFinite
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
// 审计沙箱需显式激活 QA：qa-seed.js 仅在 ?qa= 时暴露 window.QA（隔离 QA，防止进入生产 DOM）。
// 设置 location.search 使其 qaActive() 返回 true，从而 window.QA.runScenario 对 H(e) 可用。
sandbox.location = { search: "?qa=cargo", href: "https://local.test/", hash: "", pathname: "/index.html", host: "local.test", hostname: "local.test", origin: "https://local.test", protocol: "https:", port: "" };
vm.createContext(sandbox);

// 加载全部脚本（与 index.html 相同顺序）
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m => m[1].replace(/\?.*$/, ""));
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
  // 舰船强化新增星币消耗：测试态需自备足够星币（rifter 档 iskCost=50000），否则动作会以 insufficient-isk 拒绝。
  st.resources.isk = 1000000;
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
// G 区：舰船强化「星币消耗」契约（后期可持续星币 sink）
// ════════════════════════════════════════════════════════════════
{
  // (a) 六档星币成本精确值：按制造等级分层，单次固定、不随强化等级递增。
  const iskTiers = [
    { type:"frigate", cost:50000 },
    { type:"destroyer", cost:80000 },
    { type:"cruiser", cost:200000 },
    { type:"battleship", cost:350000 },
    { type:"capital", cost:600000 },
    { type:"supercapital", cost:1000000 }
  ];
  for (const t of iskTiers) {
    assert(`G(a) ${t.type} iskCost=${t.cost}`, EE.getIskCost({ type:t.type }) === t.cost);
  }
  // 真实舰船路径：rifter 为护卫档，iskCost 应=50000
  const rifterCfg = sandbox.getShipConfigById("rifter");
  assert("G(a) rifter 真实配置 iskCost=50000", EE.getIskCost(rifterCfg) === 50000);

  // 工具：从全局存档克隆一份干净测试态，加入一艘 rifter + 指定星币 + 满组件。
  const mkIskState = (isk) => {
    const s = JSON.parse(JSON.stringify(sandbox.gameState));
    s.skills.shipEngineering = { lvl: 1, xp: 0 };
    s.currentAction.active = false;
    s.combat.active = false;
    s.resources.shipComponents = { integrated_hull: 10, power_core: 10, functional_system: 10 };
    s.resources.isk = isk;
    s.inventory.ships = [];
    s.inventory.ships.push({ shipId:"rifter", instanceId:"isk_test_1", builtAt:Date.now(), fitted:{ high:[], mid:[], low:[], rig:[] }, enhancementLevel:0 });
    return s;
  };
  const dga = sandbox.dispatchGameAction;
  const ISK_COST = EE.getIskCost(rifterCfg); // 50000

  // (f) selector 暴露 iskCost / iskStock / iskEnough / canEnhance（星币充足 → 全部就绪）
  {
    const s = mkIskState(1000000);
    const disp = sandbox.getHangarDisplayState(s, Date.now());
    const cell = disp.ships.find(x => x.instanceId === "isk_test_1");
    assert("G(f) 选择器返回该舰强化块", !!cell && !!cell.enhancement);
    assert("G(f) iskCost 精确", cell.enhancement.iskCost === ISK_COST);
    assert("G(f) iskStock=1000000", cell.enhancement.iskStock === 1000000);
    assert("G(f) iskEnough=true（充足）", cell.enhancement.iskEnough === true);
    assert("G(f) canEnhance=true（充足）", cell.enhancement.canEnhance === true);
  }

  // (f) 星币不足 → iskEnough=false 且 canEnhance=false（其余材料/里程碑条件满足时）
  {
    const s = mkIskState(ISK_COST - 1);
    const disp = sandbox.getHangarDisplayState(s, Date.now());
    const cell = disp.ships.find(x => x.instanceId === "isk_test_1");
    assert("G(f) 星币不足 iskEnough=false", cell.enhancement.iskEnough === false);
    assert("G(f) 星币不足 canEnhance=false", cell.enhancement.canEnhance === false);
  }

  // (b) 星币不足 → 舰船等级 / 部件 / XP / 全局统计 全部零变化（动作原子拒绝，不扣任何东西）
  {
    const s = mkIskState(ISK_COST - 1);
    const ship = s.inventory.ships[0];
    const before = {
      level: ship.enhancementLevel,
      comp: JSON.stringify(s.resources.shipComponents),
      isk: s.resources.isk,
      xp: s.skills.shipEngineering.xp,
      gIsk: sandbox.gameState.statistics.economy.iskSpent,
      gAtt: sandbox.gameState.statistics.totals.enhancementAttempts
    };
    const r = dga(s, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.5 }, Date.now());
    assert("G(b) insufficient-isk 原子拒绝", r.changed === false && r.reason === "insufficient-isk");
    assert("G(b) 强化等级零变化", ship.enhancementLevel === before.level);
    assert("G(b) 部件零变化", JSON.stringify(s.resources.shipComponents) === before.comp);
    assert("G(b) 星币零变化", s.resources.isk === before.isk);
    assert("G(b) 技能XP零变化", s.skills.shipEngineering.xp === before.xp);
    assert("G(b) 全局 iskSpent 零变化", sandbox.gameState.statistics.economy.iskSpent === before.gIsk);
    assert("G(b) 全局 enhancementAttempts 零变化", sandbox.gameState.statistics.totals.enhancementAttempts === before.gAtt);
  }

  // (c)+(d)+(e) 成功与失败均恰好扣一次星币；事件 iskSpent 精确；economy.iskSpent 只增一次/次。
  {
    const s = mkIskState(1000000);
    const ship = s.inventory.ships[0];
    const gBefore = sandbox.gameState.statistics.economy.iskSpent;

    // 成功：randomValue=0 → roll=0 < chance（chance>0）→ 成功
    const iskPre1 = s.resources.isk;
    const ev1 = [];
    const origEmit1 = sandbox.GameEvents.emit;
    sandbox.GameEvents.emit = (name, payload) => { if (name === "ship:enhancementAttempted") ev1.push(payload); return origEmit1(name, payload); };
    const r1 = dga(s, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0 }, Date.now());
    sandbox.GameEvents.emit = origEmit1;
    assert("G(c) 成功 changed=true & success", r1.changed === true && r1.success === true);
    assert("G(c) 成功恰好扣一次星币", s.resources.isk === iskPre1 - ISK_COST);
    assert("G(d) 成功事件 iskSpent 精确", ev1.length === 1 && ev1[0].iskSpent === ISK_COST);

    // 失败：重置等级与材料，randomValue=0.99 → roll 高 → 失败（仍扣一次星币）
    ship.enhancementLevel = 0;
    s.resources.shipComponents = { integrated_hull: 10, power_core: 10, functional_system: 10 };
    const iskPre2 = s.resources.isk;
    const ev2 = [];
    const origEmit2 = sandbox.GameEvents.emit;
    sandbox.GameEvents.emit = (name, payload) => { if (name === "ship:enhancementAttempted") ev2.push(payload); return origEmit2(name, payload); };
    const r2 = dga(s, { type:"hangar/enhanceShip", instanceId:ship.instanceId, randomValue:0.99 }, Date.now());
    sandbox.GameEvents.emit = origEmit2;
    assert("G(c) 失败 changed=true & !success", r2.changed === true && r2.success === false);
    assert("G(c) 失败恰好扣一次星币", s.resources.isk === iskPre2 - ISK_COST);
    assert("G(d) 失败事件 iskSpent 精确", ev2.length === 1 && ev2[0].iskSpent === ISK_COST);

    const gAfter = sandbox.gameState.statistics.economy.iskSpent;
    // 两次尝试各扣一次：增量恰为 2×iskCost，证明每次只扣一次（无双扣 / 无漏扣）。
    assert("G(e) economy.iskSpent 只增一次/次（增量=2×iskCost）", gAfter - gBefore === 2 * ISK_COST);
  }
}

// ════════════════════════════════════════════════════════════════
// ============================================================
// H 区：TapTap 竖屏 UI 回归（指令⑥阻塞项 1/2/3）
// 通过 window.TapTapPortrait 调试句柄直接调用竖屏私有函数（不依赖 DOM 渲染）。
// ============================================================
{
  const TP = sandbox.TapTapPortrait;
  assert("H TapTapPortrait 句柄已暴露(tpRoleOf/tpShipMeta/tpEnhanceHTML/tpDismantleHTML)",
    TP && typeof TP.tpRoleOf === "function" && typeof TP.tpShipMeta === "function"
      && typeof TP.tpEnhanceHTML === "function" && typeof TP.tpDismantleHTML === "function");

  // H(a) tpRoleOf 标签：战斗 / 工业 / 考古（修复前 r.label 为 undefined）
  const roleCases = [
    { ship:{}, key:"combat", label:"战斗", cls:"role-combat" },
    { ship:{ industrial:true }, key:"industrial", label:"工业", cls:"role-ind" },
    { ship:{ archaeology:true }, key:"archaeology", label:"考古", cls:"role-arch" }
  ];
  for (const c of roleCases) {
    const r = TP.tpRoleOf(c.ship);
    assert("H(a) tpRoleOf(" + c.key + ") label=" + c.label, r && r.key === c.key && r.label === c.label && r.cls === c.cls);
  }

  // H(b) tpShipMeta 必须渲染正确标签，且任何舰型/态都不得出现 "undefined"
  const mkShip = (over) => Object.assign({ enhancement:{ level:3 }, assignedActions:[], repairing:false, repairRemaining:0 }, over);
  const display = { actionNames:{ combat:"战斗", mining:"采矿" } };
  for (const c of roleCases) {
    const html = TP.tpShipMeta(display, mkShip(c.ship));
    assert("H(b) tpShipMeta(" + c.key + ") 含标签「" + c.label + "」", html.indexOf(c.label) !== -1);
    assert("H(b) tpShipMeta(" + c.key + ") 无 undefined", html.indexOf("undefined") === -1);
  }
  const htmlAssigned = TP.tpShipMeta(display, mkShip({ assignedActions:["combat"], repairing:true, repairRemaining:42 }));
  assert("H(b) tpShipMeta 维修+指派态 无 undefined", htmlAssigned.indexOf("undefined") === -1);

  // H(c) tpEnhanceHTML 必须显示星币库存/成本；iskEnough 不足时带 short 红字 + 不足提示
  const mkEnhShip = (iskCost, iskStock, iskEnough, enough) => ({
    instanceId:"test-ship",
    enhancement:{
      available:true, busy:false, level:5, milestone:false, chancePercent:60, successXp:100, failureXp:0,
      materials:[{ name:"钛合金", stock:10, quantity:3, enough:enough }],
      iskCost, iskStock, iskEnough, canEnhance: iskEnough && enough
    }
  });
  const enhEnough = TP.tpEnhanceHTML(display, mkEnhShip(50000, 1000000, true, true));
  assert("H(c) tpEnhanceHTML 充足态含「星币」标记", enhEnough.indexOf("星币") !== -1);
  assert("H(c) tpEnhanceHTML 充足态含成本 50,000", enhEnough.indexOf("50,000") !== -1);
  assert("H(c) tpEnhanceHTML 充足态无不足提示", enhEnough.indexOf("tp-enh-insufficient") === -1);

  const enhShort = TP.tpEnhanceHTML(display, mkEnhShip(50000, 1000, false, true));
  assert("H(c) tpEnhanceHTML 不足态含 short 红字", enhShort.indexOf("tp-mat short") !== -1);
  assert("H(c) tpEnhanceHTML 不足态含「星币不足」提示", enhShort.indexOf("tp-enh-insufficient") !== -1);

  const enhNoIsk = TP.tpEnhanceHTML(display, mkEnhShip(0, 0, true, true));
  assert("H(c) tpEnhanceHTML iskCost=0 不显示星币行", enhNoIsk.indexOf("星币") === -1);

  // H(d) tpDismantleHTML：危险按钮 + 返还预览 + blockedText + 无配方空态
  const dOk = TP.tpDismantleHTML(display, { instanceId:"x", dismantle:{ available:true, preview:[{ name:"钛合金", returned:5 }], canDismantle:true, blockedText:"" } });
  assert("H(d) tpDismantleHTML 含危险按钮 data-dismantle-ship", dOk.indexOf("data-dismantle-ship") !== -1);
  assert("H(d) tpDismantleHTML 含返还预览「钛合金 ×5」", dOk.indexOf("钛合金 ×5") !== -1);
  const dBlocked = TP.tpDismantleHTML(display, { instanceId:"x", dismantle:{ available:true, preview:[], canDismantle:false, blockedText:"舰船维修中" } });
  assert("H(d) tpDismantleHTML 阻塞态含 blockedText", dBlocked.indexOf("舰船维修中") !== -1);
  const dNoRecipe = TP.tpDismantleHTML(display, { instanceId:"x", dismantle:{ available:false, preview:[], canDismantle:false, blockedText:"" } });
  assert("H(d) tpDismantleHTML 无配方 空态提示", dNoRecipe.indexOf("没有可拆解配方") !== -1);
}

// 为 H(e) QA 场景准备真实舰船数据：默认全局 gameState 无舰船，而 enhance/dismantle/fitting
// 场景依赖真实舰船。按审计约定注入一艘战斗舰（rifter）与一艘混血驱逐舰（gale）——二者均有
// SHIP_ASSEMBLY_RECIPES（拆解可用）、装备无 shipTypes 限制（适配任意舰）、且非工业/考古舰。
if (sandbox.gameState && sandbox.gameState.inventory && Array.isArray(sandbox.gameState.inventory.ships) && sandbox.gameState.inventory.ships.length === 0) {
  const mkShip = (shipId) => ({ shipId, instanceId: "qa_" + shipId + "_" + Math.random().toString(36).slice(2, 7), builtAt: Date.now(), fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 });
  sandbox.gameState.inventory.ships.push(mkShip("rifter"));
  sandbox.gameState.inventory.ships.push(mkShip("gale"));
}

// H(e) QA 场景真实状态断言：调用 window.QA.runScenario 驱动真实数据准备，
// 断言真实游戏状态（ResourceRegistry / 选择器 / 弹窗 spy），并报告每个场景的真实结果。
// 不再仅测私有 HTML 字符串——而是验证「场景真的跑通并产生预期状态」。
{
  const QA = sandbox.QA;
  if (!QA || typeof QA.runScenario !== "function") {
    assert("H(e) window.QA.runScenario 可用", false);
  } else {
    const report = (res, label) => {
      if (!res || !res.checks) { assert("H(e) " + label + " 返回有效结果", false); return; }
      console.log("  [QA场景] " + label + " -> " + (res.ok ? "OK ✅" : "FAIL ❌"));
      res.checks.forEach(c => assert("H(e) " + label + ": " + c.name + (c.detail ? " (" + c.detail + ")" : ""), c.pass));
    };
    ["enhance", "cargo", "dismantle", "fitting"].forEach(n => {
      try { report(QA.runScenario(n), n); }
      catch (e) { assert("H(e) " + n + " 执行无异常", false, String((e && e.message) || e)); }
    });
    try { report(QA.runScenario("offline"), "offline"); }
    catch (e) { assert("H(e) offline 执行无异常", false, String((e && e.message) || e)); }
  }
}

console.log("\n结果汇总");
const failCount = failures.length;
console.log(failCount === 0 ? "全部断言通过 ✅" : `${failCount} 项断言失败 ❌：\n  ${failures.join("\n  ")}`);
process.exit(failCount === 0 ? 0 : 1);
