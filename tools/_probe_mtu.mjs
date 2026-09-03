// 探针：激光定向打捞单元（MTU）端到端验证（诊断用，不入库）。
// 覆盖：数据层 / Σ聚合 / 独立组件产出 / ISK·LP×1.10 / 每击毁燃料扣费 / 断料降级 / 在线离线一致 / 容量共享。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// 收集 index.html 的 <script defer> 逻辑脚本（排除 UI 渲染层，避免 DOM 依赖）
const scriptSources = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
while ((m = re.exec(html))) scriptSources.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
const UI_EXCLUDE = new Set([
  "js/ui/error-boundary.js", "js/ui/action-modal.js", "js/ui/shell-render.js",
  "js/ui/manufacturing-render.js", "js/ui/combat-render.js", "js/ui/planetary-render.js",
  "js/ui/archaeology-render.js", "js/ui/booster-render.js", "js/ui/render.js", "js/core/runtime.js",
  "js/ui/taptap-portrait.js", "js/ui/ad-buff-widget.js"
]);
const logicSources = scriptSources.filter((s) => !UI_EXCLUDE.has(s));

// 拼接为单一脚本运行，复刻浏览器「经典脚本共享顶层作用域」：
// cargo.js 的 CARGO_DROP_CHANCE / SALVAGE_COMPONENT_IDS 等顶层 const 可被 combat.js 运行时按名访问。
let combined = "";
for (const src of logicSources) {
  const full = path.resolve(ROOT, src);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full)) throw new Error("本地脚本缺失：" + src);
  combined += "\n;\n// ===== " + src + " =====\n" + fs.readFileSync(full, "utf8");
}

const noop = () => {};
function MockCanvasContext() {}
for (const name of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[name] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, insertAdjacentHTML: noop,
  replaceChildren: noop, removeChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 }),
  getContext: () => new MockCanvasContext(), innerHTML: "", offsetHeight: 24, offsetWidth: 560,
  querySelector: () => makeElement(), querySelectorAll: () => [], remove: noop, setAttribute: noop, removeAttribute: noop,
  getAttribute: () => null, select: noop, style: {}, textContent: "", value: "1", children: [], parentNode: null
});
const documentMock = {
  addEventListener: noop, body: makeElement(), createElement: () => makeElement(), createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => []
};
const localStorageMock = { getItem: () => null, setItem: noop, removeItem: noop };
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true, document: documentMock,
  FileReader: class {}, localStorage: localStorageMock, requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => "blob:mock", revokeObjectURL: noop }, URLSearchParams: globalThis.URLSearchParams,
  matchMedia: () => ({ matches: false, media:"", onchange:null, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop, dispatchEvent: noop }),
  GameEvents: { emit: noop, on: () => () => {}, once: noop, contracts: { has: () => true, validate: () => ({ valid:true, registered:true }) }, listenerCount: () => 0 },
  RuntimeGuard: { report: noop, runCritical: () => ({ ok:true }), resume: () => true, isPaused: () => false, runRecoverable: () => ({ ok:true }) },
  window: null
};
sandbox.window = sandbox;
sandbox.window.addEventListener = noop;
sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
sandbox.location = { href:"", search:"", hash:"" };
sandbox.navigator = { userAgent: "node" };
sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
sandbox.updateUI = noop; sandbox.switchPage = noop; sandbox.currentPage = "";
sandbox.updateLiveUI = noop; sandbox.refreshVisiblePanelAfterAction = noop;
sandbox.playAttackFX = noop; sandbox.playEnemyAttackFX = noop;

vm.createContext(sandbox);
vm.runInContext(combined, sandbox, { filename: "combined.js" });

const ctx = (expr) => vm.runInContext(expr, sandbox);
const G = sandbox.gameState;
const RR = sandbox.ResourceRegistry;
const DGA = sandbox.dispatchGameAction;
const NOW = 1_000_000_000_000;

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (extra !== undefined ? "  [" + extra + "]" : "")); }
};

// 构造最小 state 骨架（每子测试 rebuild，避免燃料/掉落串扰）
function makeState(opts = {}) {
  const st = {
    resources: {},
    combat: {
      squad: { enabled: false, members: [], deployables: [], deployableStorage: [] },
      salvageArmActive: false, active: false, mode: "belt", zone: opts.zoneId || null
    },
    inventory: { ships: [] },
    shipAssignments: {},
    skills: {},
    research: { completedLevels: {} },
    settings: {},
    currentAction: { skill: "combat", active: false, batchRemaining: 1, startedAt: 0 }
  };
  // 出战舰（破晓级，无打捞臂/改装 → 基础 salvage=0，便于隔离 MTU 的 2.10）
  st.inventory.ships = [{ instanceId: "cs", shipId: "dawnbreaker", fitted: { high: [], mid: [], low: [], rig: [] }, enhancementLevel: 0 }];
  st.shipAssignments = { combat: "cs" };
  st.skills = { combat: { lvl: 50, xp: 0 }, capacitorManagement: { lvl: opts.capLvl || 0, xp: 0 } };
  RR.set(st, "consumable:fuel", opts.fuel != null ? opts.fuel : 100000);
  if (opts.mtu) st.combat.squad.deployables.push({ deployableId: "laser_directional_salvage_unit", name: "激光定向打捞单元" });
  return st;
}

// 取一个 maxWave>=3 的星带作为测试战场
const TEST_ZONE = ctx("COMBAT_ZONES.find(z => (z.maxWave||0) >= 3 && (z.mode||'belt') === 'belt')");

console.log("\n=== 1. 数据层：部署物定义 / 配方 / 二级标签 ===");
ok(ctx('typeof DEPLOYABLES_DB !== "undefined" && !!DEPLOYABLES_DB["laser_directional_salvage_unit"]'), "DEPLOYABLES_DB 含 激光定向打捞单元");
const def = ctx('DEPLOYABLES_DB["laser_directional_salvage_unit"]');
ok(def && def.salvageEfficiency === 2.10, "salvageEfficiency = 2.10（=3× 大型打捞臂 0.70）", def && def.salvageEfficiency);
ok(def && def.iskBonus === 0.10, "+10% 星币", def && def.iskBonus);
ok(def && def.lpBonus === 0.10, "+10% 功勋", def && def.lpBonus);
ok(def && def.fuelPerKill === 120, "fuelPerKill = 120（5×8×3）", def && def.fuelPerKill);
ok(ctx('SHIP_ASSEMBLY_RECIPES.some(r => r.id === "laser_directional_salvage_unit" && r.productKind === "deployable")'), "舰船总装含 deployable 配方");
const recipe = ctx('SHIP_ASSEMBLY_RECIPES.find(r => r.id === "laser_directional_salvage_unit")');
ok(recipe && recipe.materialCost && recipe.materialCost["三钛合金"] === 5400, "制造成本 三钛合金=5400（大型打捞臂×6）", recipe && recipe.materialCost && recipe.materialCost["三钛合金"]);
ok(recipe && recipe.materialCost && recipe.materialCost["生物质"] === 270, "生物质=270", recipe && recipe.materialCost && recipe.materialCost["生物质"]);
ok(recipe && recipe.materialCost && recipe.materialCost["等离子体"] === 150, "等离子体=150", recipe && recipe.materialCost && recipe.materialCost["等离子体"]);
ok(recipe && recipe.materialCost && recipe.materialCost["钷"] === 30, "钷=30", recipe && recipe.materialCost && recipe.materialCost["钷"]);
ok(ctx('SHIP_ASSEMBLY_LINES.some(l => l.id === "special")'), "SHIP_ASSEMBLY_LINES 含「特殊」线");
ok(ctx('getShipAssemblyLine({productKind:"deployable"}) === "special"'), "getShipAssemblyLine(deployable) → special");
ok(ctx('getShipRoleName({productKind:"deployable"}) === "部署物"'), "getShipRoleName(deployable) → 部署物");
ok(ctx('getDeployableDefinition("laser_directional_salvage_unit") && getDeployableDefinition("nope") === null'), "getDeployableDefinition 命中/未命中");

console.log("\n=== 2. 聚合器 getMtuModifiers（唯一口径，在线/离线共用）===");
{
  const st = makeState({ mtu: true, fuel: 5000 });
  sandbox.__s = st;
  const m = ctx("getMtuModifiers(__s)");
  ok(m.count === 1, "count = 1", m.count);
  ok(m.active === true, "active = true（燃料充足）");
  ok(m.salvage === 2.10, "salvage = 2.10", m.salvage);
  ok(m.iskBonus === 0.10, "iskBonus = 0.10", m.iskBonus);
  ok(m.lpBonus === 0.10, "lpBonus = 0.10", m.lpBonus);
  // fuelPerKill 含战斗燃料倍率（此处 capLvl=0，船体燃料折扣 dawnbreaker=0.85）
  const fuelMult = ctx("getCombatFuelMultiplierFromState(__s)");
  const expFuel = Math.max(1, Math.round(120 * fuelMult));
  ok(Math.abs(m.fuelPerKill - 120 * fuelMult) < 1e-6, "fuelPerKill = 120 × 战斗燃料倍率(" + fuelMult.toFixed(4) + ") = " + (120*fuelMult).toFixed(4), m.fuelPerKill);
  // 断料：燃料清零（ResourceRegistry.spend 不足额时不扣，故直接 set 0）
  RR.set(st, "consumable:fuel", 0);
  const m2 = ctx("getMtuModifiers(__s)");
  ok(m2.active === false && m2.outOfFuel === true, "断料：active=false / outOfFuel=true");
  ok(m2.salvage === 0 && m2.iskBonus === 0 && m2.lpBonus === 0, "断料：所有增益回基准（salvage/isk/lp 全 0）");
  ok(m2.fuelPerKill === 0, "断料：fuelPerKill=0（不扣费）", m2.fuelPerKill);
  // 无部署
  const st0 = makeState({ mtu: false });
  sandbox.__s = st0;
  const m0 = ctx("getMtuModifiers(__s)");
  ok(m0.count === 0 && m0.active === false && m0.salvage === 0, "无部署：count=0 全 0");
}

console.log("\n=== 3. getSalvageEfficiency 含 MTU 平加（货柜 + 组件掉率同步放大）===");
{
  const st = makeState({ mtu: true, fuel: 5000 });
  sandbox.__s = st;
  const eff = ctx("getSalvageEfficiency(__s)");
  ok(Math.abs(eff - 2.10) < 1e-9, "无打捞臂时 getSalvageEfficiency = 2.10（MTU 平加）", eff);
  // 断料回落
  RR.set(st, "consumable:fuel", 0);
  const effOut = ctx("getSalvageEfficiency(__s)");
  ok(effOut === 0, "断料：getSalvageEfficiency 回落到 0", effOut);
}

console.log("\n=== 4. 小队部署：容量共享 / 最大 1 / 库存溢出 ===");
{
  ok(ctx("LEGION_COMBAT_SQUAD.MTU_MAX_DEPLOYED") === 1, "MTU_MAX_DEPLOYED = 1");
  const st = makeState({});
  sandbox.__s = st;
  const r1 = ctx("LEGION_COMBAT_SQUAD.addDeployableToSquad(__s, 'laser_directional_salvage_unit')");
  ok(r1.changed && r1.where === "deployed", "第 1 件：自动部署（where=deployed）", JSON.stringify(r1));
  ok(st.combat.squad.deployables.length === 1, "deployables.length = 1");
  const r2 = ctx("LEGION_COMBAT_SQUAD.addDeployableToSquad(__s, 'laser_directional_salvage_unit')");
  ok(r2.changed && r2.where === "storage", "第 2 件（已达上限）：转入库存（where=storage）", JSON.stringify(r2));
  ok(st.combat.squad.deployables.length === 1 && st.combat.squad.deployableStorage.length === 1, "仍仅 1 部署 + 1 库存");
  // 满额后再部署同一实例 → 拒
  const r3 = ctx("LEGION_COMBAT_SQUAD.deployDeployable(__s, 'laser_directional_salvage_unit')");
  ok(r3.changed === false && r3.reason === "deploy-full", "满额 deployDeployable → deploy-full", JSON.stringify(r3));
  // 取消部署 → 回库存
  const r4 = ctx("LEGION_COMBAT_SQUAD.undeployDeployable(__s, 'laser_directional_salvage_unit')");
  ok(r4.changed === true && st.combat.squad.deployables.length === 0 && st.combat.squad.deployableStorage.length === 1, "undeploy → 部署清空、库存保留（不重复入库存）");
}
console.log("\n=== 4b. 容量共享约束（members + deployables ≤ capacity，解锁双人协议=1）===");
{
  const st = makeState({});
  st.research.completedLevels = { legion_dual_squad: 1 }; // capacity = 1
  sandbox.__s = st;
  ok(ctx("LEGION_COMBAT_SQUAD.getLegionSquadCapacity(__s)") === 1, "解锁双人协议 → capacity = 1");
  // 占 1 个 NPC 成员：部署 MTU 应被容量拒绝
  st.combat.squad.members = [{ npcId: "fake_npc" }];
  st.combat.squad.deployableStorage = ["laser_directional_salvage_unit"];
  const rFull = ctx("LEGION_COMBAT_SQUAD.deployDeployable(__s, 'laser_directional_salvage_unit')");
  ok(rFull.changed === false && rFull.reason === "squad-full", "1 成员 + 0 部署（=capacity）→ squad-full", JSON.stringify(rFull));
  // 释放成员：可部署
  st.combat.squad.members = [];
  const rOk = ctx("LEGION_COMBAT_SQUAD.deployDeployable(__s, 'laser_directional_salvage_unit')");
  ok(rOk.changed === true && st.combat.squad.deployables.length === 1, "容量空出 → 部署成功");
}

console.log("\n=== 5. 在线战斗 resolveCombatEnemyDefeat：ISK×1.10 / 独立组件 / 燃料扣费 / 断料 ===");
{
  const mkEnemy = () => ({ id: "e" + Math.random().toString(36).slice(2), kind: "normal", type: "frigate", iskDrop: 1000, level: 10, defeated: false, rewarded: false });
  const zone = TEST_ZONE;

  // 有料生效
  const st = makeState({ mtu: true, fuel: 100000 });
  sandbox.__s = st;
  const fuelMult = ctx("getCombatFuelMultiplierFromState(__s)");
  const expMtuFuel = Math.max(1, Math.round(120 * fuelMult));
  const iskBefore = RR.get(st, "currency:isk");
  const fuelBefore = RR.get(st, "consumable:fuel");
  sandbox.__enemy = mkEnemy(); sandbox.__zone = zone; sandbox.__rng = () => 0; // 强制命中
  const r = ctx("(function(){ return resolveCombatEnemyDefeat(__enemy, __zone, __rng, null, __s); })()");
  const iskAfter = RR.get(st, "currency:isk");
  const fuelAfter = RR.get(st, "consumable:fuel");
  ok(iskAfter - iskBefore === 1100, "ISK = round(1000 × iskMulti × 1.10) = 1100（基础 iskMulti=1）", iskAfter - iskBefore);
  ok((r && r.lootGained && r.lootGained["currency:isk"] === 1100), "lootGained 星币 = 1100");
  ok(fuelBefore - fuelAfter === expMtuFuel, "燃料扣费 = " + expMtuFuel + "（=round(120×fuelMult)）", fuelBefore - fuelAfter);
  ok((r && r.lootGained && Object.keys(r.lootGained).some(k => k.indexOf("component:") === 0)), "MTU 独立产出舰船组件（rng=0 命中）", r && r.lootGained && JSON.stringify(Object.keys(r.lootGained)));
  ok((st.combat.lastSalvage && st.combat.lastSalvage.components && st.combat.lastSalvage.components.length > 0), "lastSalvage.components 记录非空");

  // 断料：无增益、不扣费、不产出
  const st2 = makeState({ mtu: true, fuel: 0 });
  sandbox.__s = st2;
  const iskBefore2 = RR.get(st2, "currency:isk");
  const fuelBefore2 = RR.get(st2, "consumable:fuel");
  sandbox.__enemy = mkEnemy(); sandbox.__zone = zone; sandbox.__rng = () => 0;
  const r2 = ctx("(function(){ return resolveCombatEnemyDefeat(__enemy, __zone, __rng, null, __s); })()");
  const iskAfter2 = RR.get(st2, "currency:isk");
  const fuelAfter2 = RR.get(st2, "consumable:fuel");
  ok(iskAfter2 - iskBefore2 === 1000, "断料：ISK 无 +10%（=1000）", iskAfter2 - iskBefore2);
  ok(fuelAfter2 === fuelBefore2, "断料：不扣燃料", fuelAfter2 - fuelBefore2);
  ok(!(r2 && r2.lootGained && Object.keys(r2.lootGained || {}).some(k => k.indexOf("component:") === 0)), "断料：无组件产出");

  // 无 MTU 基线对照
  const st0 = makeState({ mtu: false, fuel: 100000 });
  sandbox.__s = st0;
  const iskBefore0 = RR.get(st0, "currency:isk");
  sandbox.__enemy = mkEnemy(); sandbox.__zone = zone; sandbox.__rng = () => 0;
  const r0 = ctx("(function(){ return resolveCombatEnemyDefeat(__enemy, __zone, __rng, null, __s); })()");
  const iskAfter0 = RR.get(st0, "currency:isk");
  ok(iskAfter0 - iskBefore0 === 1000, "无 MTU 基线：ISK=1000（对照）", iskAfter0 - iskBefore0);
}

console.log("\n=== 6. 离线战斗 settle+flush：ISK×1.10 / 燃料 120×kills / 独立组件 ===");
{
  function runOffline(withMtu) {
    const st = makeState({ mtu: withMtu, fuel: 100000 });
    st.research = st.research || {};
    sandbox.__s = st;
    // 给破晓级装 5 门大型激光炮 + 装载激光弹药（combat/start 要求有武器且已选弹）
    const ship = st.inventory.ships[0];
    ship.fitted.high = ["w0", "w1", "w2", "w3", "w4"];
    st.equipment = { instances: [], inventory: [] };
    for (let k = 0; k < 5; k++) st.equipment.instances.push({ instanceId: "w" + k, itemId: "t1_large_laser", enhancementLevel: 0, installedOn: null });
    st.ammo = [
      { id: "am_laser", type: "laser", tier: "T1", name: "激光弹药", props: { dmgMult: 1, hitMult: 1 }, qty: 100000, loaded: true },
      { id: "am_missile", type: "missile", tier: "T1", name: "导弹弹药", props: { dmgMult: 1, hitMult: 1 }, qty: 100000, loaded: true }
    ];
    // 用真实战斗启动构建有效 active 星带战斗（破晓级+5大型激光，确保能击杀）
    const zid = TEST_ZONE.id;
    const start = DGA(st, {
      type: "combat/start",
      zone: zid,
      enemies: ctx("buildCombatWave(COMBAT_ZONES.find(z=>z.id==='" + zid + "'),1).enemies"),
      formationId: "manual"
    }, NOW);
    if (!start || !start.changed) return { error: "start-failed:" + JSON.stringify(start) };
    // combat/start 在本探针环境未落 zone（取参方式差异），离线模拟需显式补齐
    st.combat.zone = zid;
    st.combat.mode = "belt";
    // 注意：makeState({mtu:true}) 已部署 1 个单元，勿重复 push（否则变 2 个、增益翻倍）
    const fuelMult = ctx("getCombatFuelMultiplierFromState(__s)");
    const expMtuFuel = Math.max(1, Math.round(120 * fuelMult));
    const runId = withMtu ? "mtu_on" : "mtu_off";
    const fuelBefore = RR.get(st, "consumable:fuel");
    const iskBefore = RR.get(st, "currency:isk");
    const lpBefore = RR.get(st, "currency:lp");
    const left = ctx("OfflineCombatSystem.settle(__s, 120, { runId:'" + runId + "', now:" + NOW + " })");
    const payload = ctx("OfflineCombatSystem.flush(__s, { runId:'" + runId + "', gains:{}, offlineEnd:" + (NOW + 120000) + " })");
    const fuelAfter = RR.get(st, "consumable:fuel");
    const iskAfter = RR.get(st, "currency:isk");
    const lpAfter = RR.get(st, "currency:lp");
    return {
      error: null, kills: payload ? payload.kills : 0,
      iskDelta: iskAfter - iskBefore, lpDelta: lpAfter - lpBefore,
      fuelDelta: fuelBefore - fuelAfter, expMtuFuel,
      stopReason: payload && payload.stopReason, defeats: payload && payload.defeats, maxWave: payload && payload.maxWaveReached,
      left,
      mtuFP: ctx("getMtuModifiers(__s).fuelPerKill"),
      fmNow: ctx("getCombatFuelMultiplierFromState(__s)"),
      components: Object.keys((payload && payload.lootGained) || {}).filter(k => k.indexOf("component:") === 0).length
    };
  }
  const base = runOffline(false);
  const on = runOffline(true);
  console.log("  [diag] base=" + JSON.stringify(base));
  console.log("  [diag] on  =" + JSON.stringify(on));
  console.log("  [diag] start-state base.combat.active=" + sandbox.__s.combat.active + " zone=" + sandbox.__s.combat.zone + " enemies=" + ((sandbox.__s.combat.enemies || []).length));
  if (base.error) { ok(false, "离线基线运行失败：" + base.error); }
  else if (on.error) { ok(false, "离线 MTU 运行失败：" + on.error); }
  else {
    ok(base.kills > 0 && on.kills === base.kills, "击杀数一致（在线/离线同 rng 口径）：" + on.kills + " vs " + base.kills);
    ok(base.iskDelta > 0, "基线 ISK 入账 > 0：" + base.iskDelta);
    const ratio = on.iskDelta / base.iskDelta;
    ok(ratio >= 1.08 && ratio <= 1.12, "ISK×1.10：MTU/基线 = " + ratio.toFixed(4) + "（∈[1.08,1.12]）", ratio.toFixed(4));
    ok(on.fuelDelta - base.fuelDelta === Math.max(1, Math.round(on.mtuFP)) * on.kills, "离线 MTU 燃料 = round(" + on.mtuFP + ") × kills(" + on.kills + ") = " + (Math.max(1, Math.round(on.mtuFP)) * on.kills) + "；差额=" + (on.fuelDelta - base.fuelDelta));
    ok(on.components > 0, "离线 MTU 独立产出组件份数 > 0：" + on.components);
  }
}

console.log("\n结果: " + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);
