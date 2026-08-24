// ================================================================
// 军团 D 扩展 —— 运行时接入与贡献效果集成测试（≥18 场景）
// --------------------------------------------------------------
// 真实脚本 VM 沙箱加载全部游戏逻辑（含军团 NPC 系统），不伪造状态、不绕过真实入口。
// 覆盖：脚本加载、在线 tick、离线=在线等价、欠薪不贡献、工资减免、同类递减、
// 各类型贡献接入（采集/制造/战斗/防御/电容/舰材/掉率/经验）、旧存档兼容、幂等。
// ================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const htmlText = readFileSync(join(ROOT, "index.html"), "utf8");
const scripts = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
while ((m = re.exec(htmlText))) scripts.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
const UI_EXCLUDE = [
  "js/ui/error-boundary.js","js/ui/action-modal.js","js/ui/shell-render.js",
  "js/ui/manufacturing-render.js","js/ui/combat-render.js","js/ui/planetary-render.js",
  "js/ui/archaeology-render.js","js/ui/booster-render.js","js/ui/render.js","js/core/runtime.js"
];
const logicScripts = scripts.filter(s => !UI_EXCLUDE.includes(s));

function makeCtx(){ return new Proxy({},{get:()=>()=>undefined,set:()=>true}); }
function makeEl(){
  const el = new Proxy(function(){},{
    get(t,p){
      if(p==="style")return new Proxy({},{get:()=>"",set:()=>true});
      if(p==="classList")return{add(){},remove(){},toggle(){},contains(){return false;}};
      if(p==="getContext")return()=>makeCtx();
      if(p==="querySelector")return()=>makeEl();
      if(p==="querySelectorAll")return()=>[];
      if(p==="parentNode")return makeEl();
      if(["appendChild","removeChild","setAttribute","remove","focus","click","append","prepend","insertBefore","addEventListener","removeEventListener","dispatchEvent"].includes(p))return()=>makeEl();
      if(["children","childNodes"].includes(p))return[];
      if(["value","innerHTML","textContent","className","id","width","height","top","left","src","href"].includes(p))return"";
      return()=>makeEl();
    },
    set:()=>true, apply:()=>makeEl()
  });
  return el;
}
const localStorageMock=(()=>{const s={};return{getItem:k=>(k in s?s[k]:null),setItem:(k,v)=>{s[k]=String(v);},removeItem:k=>{delete s[k];},clear:()=>{for(const k in s)delete s[k];}};})();
const sandbox={
  console, setTimeout:()=>0, clearTimeout:()=>{}, setInterval:()=>0, clearInterval:()=>{},
  requestAnimationFrame:()=>0, cancelAnimationFrame:()=>{}, confirm:()=>true, alert:()=>{},
  localStorage:localStorageMock,
  matchMedia:(q)=>({matches:false,media:q||"",addEventListener:()=>{},removeEventListener:()=>{},addListener:()=>{},removeListener:()=>{}}),
  MutationObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} takeRecords(){ return []; } },
  IntersectionObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} takeRecords(){ return []; } },
  ResizeObserver: class { constructor(cb){ this.cb = cb; } observe(){} disconnect(){} unobserve(){} },
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  RuntimeGuard:{ report:(err,ctx)=>{ sandbox.__guardReports.push({ message:err && err.message, ctx }); } },
  document:new Proxy({},{get(t,p){
    if(p==="getElementById"||p==="querySelector")return()=>makeEl();
    if(p==="querySelectorAll")return()=>[];
    if(p==="createElement")return()=>makeEl();
    if(p==="addEventListener"||p==="removeEventListener")return()=>{};
    if(p==="body")return makeEl();
    return makeEl();
  }})
};
sandbox.__guardReports = [];
sandbox.window=sandbox; sandbox.globalThis=sandbox;
sandbox.addEventListener=()=>{}; sandbox.removeEventListener=()=>{}; sandbox.dispatchEvent=()=>{};
sandbox.location={href:"",search:"",hash:""}; sandbox.navigator={userAgent:"node"};
sandbox.innerWidth=1280; sandbox.innerHeight=800;
sandbox.CanvasRenderingContext2D=function(){}; sandbox.CanvasRenderingContext2D.prototype={};
sandbox.updateUI=function(){}; sandbox.switchPage=function(){}; sandbox.currentPage="";
sandbox.updateLiveUI=function(){}; sandbox.refreshVisiblePanelAfterAction=function(){};
sandbox.playAttackFX=()=>{}; sandbox.playEnemyAttackFX=()=>{};

let combined="";
for(const s of logicScripts) combined += "\n// === "+s+" ===\n"+readFileSync(join(ROOT,s),"utf8")+"\n";
vm.createContext(sandbox);
try { vm.runInContext(combined,sandbox,{filename:"combined.js"}); }
catch(e){ console.error("LOAD ERROR:",e.message); console.error(e.stack); process.exit(1); }
const W=sandbox;
const G=W.gameState;
const LP=W.LEGION_NPC;

let pass=0, fail=0;
const failures=[];
function ok(cond,label){ if(cond){pass++; console.log("  [PASS] "+label);} else {fail++;failures.push(label);console.log("  [FAIL] "+label);} }
function section(name){ console.log("== "+name+" =="); }

// ---- 测试辅助 ----
function enableDlc(){
  G.station.dlc = { npcWorkers:true, combatWings:false };
  G.corporation = G.corporation || {};
  G.corporation.dlc = { npcWorkers:true, combatWings:false };
}
function disableDlc(){
  G.station.dlc = { npcWorkers:false, combatWings:false };
  G.corporation = G.corporation || {};
  G.corporation.dlc = { npcWorkers:false, combatWings:false };
}
function ensureActive(){ G.station.bodyLevel=5; G.station.buildings=G.station.buildings||{}; G.station.buildings.legion_hall=1; enableDlc(); }
function resetLegion(){ delete G.legion; ensureActive(); }
// 直接构造一名「已付费」NPC（绕过招募费用，用于确定性贡献验证）
function addNpc(skillId, grade){
  LP.ensureLegionState(G);
  const n = LP.createNpc({
    npcId: "npc_test_"+(G.legion.npcs.length+1),
    name: "测试兵"+(G.legion.npcs.length+1),
    personalityId: (LP.PERSONALITIES && LP.PERSONALITIES[0]) ? LP.PERSONALITIES[0].personalityId : null,
    skillId: skillId, skillGrade: grade||"D", level:1, xp:0,
    salaryState:"paid", boundShipInstanceId:null, dialogueHistory:[]
  });
  G.legion.npcs.push(n);
  return n;
}
const HOUR=3600000;

// ================================================================
// 1. 脚本加载 / 全局导出
// ================================================================
section("1 脚本加载与全局导出");
ok(typeof LP === "object", "LEGION_NPC 全局已加载");
ok(LP && typeof LP.getLegionContributionSnapshot==="function", "LEGION_NPC.getLegionContributionSnapshot 存在");
ok(typeof LP.isLegionSystemActive==="function", "LEGION_NPC.isLegionSystemActive 存在");
ok(typeof W.LEGION_NPC_NAMES!=="undefined", "LEGION_NPC_NAMES（名字数据）已注入");
ok(typeof W.LEGION_NPC_SKILLS!=="undefined", "LEGION_NPC_SKILLS（技能数据）已注入");
ok(typeof W.LEGION_NPC_PERSONALITIES!=="undefined", "LEGION_NPC_PERSONALITIES 已注入");
ok(typeof W.LEGION_NPC_DIALOGUE!=="undefined", "LEGION_NPC_DIALOGUE 已注入");

// ================================================================
// 2. 系统激活门禁
// ================================================================
section("2 系统激活门禁");
resetLegion();
G.station.bodyLevel=1; G.station.buildings.legion_hall=0;
ok(LP.isLegionSystemActive(G)===false, "本体<2 或大厅未建 → 未激活");
ensureActive();
ok(LP.isLegionSystemActive(G)===true, "本体>=2 且 大厅>=1 → 激活");

// ================================================================
// 3. 在线 tick 首次刷新候选
// ================================================================
section("3 在线 tick 首次刷新候选");
resetLegion();
var t0 = 5_000_000;
var r3 = LP.tickLegionNpc(G, {now:t0});
ok(r3.active===true, "激活态 tick 返回 active:true");
ok((G.legion.candidates||[]).length===3, "首次 tick 生成 3 名候选人");
ok(G.legion.candidateRefreshAt > t0, "candidateRefreshAt 已排程到未来");

// ================================================================
// 4. 手动刷新费用翻倍（按本周期计数）
// ================================================================
section("4 手动刷新费用翻倍");
resetLegion();
var baseCost = LP.manualRefreshCost(0).isk;
ok(LP.manualRefreshCost(0).isk === baseCost, "计数 0 → 基础费用");
ok(LP.manualRefreshCost(1).isk === baseCost*2, "计数 1 → 翻倍");
ok(LP.manualRefreshCost(2).isk === baseCost*4, "计数 2 → 4 倍");
ok(LP.manualRefreshCost(10).isk === baseCost*16, "计数封顶 16 倍");
resetLegion();
G.resources.isk=99_999_999; G.resources.lp=99999;
var rr4 = LP.manuallyRefreshLegionNpcCandidates(G,{now:100});
ok(rr4.changed===true, "充足资源手动刷新成功");
ok(LP.manualRefreshCost(G.legion.manualRefreshCount).isk === baseCost*2, "刷新一次后计数=1 → 下次费用翻倍");

// ================================================================
// 5. 在线 tick 不重复扣薪（同一结算周期内多次 tick）
// ================================================================
section("5 在线 tick 不重复扣薪");
resetLegion(); ensureActive();
addNpc("mining","D");
G.resources.isk = 10_000_000;
var before5 = G.resources.isk;
LP.tickLegionNpc(G, {now:t0});
LP.tickLegionNpc(G, {now:t0+1*HOUR});
LP.tickLegionNpc(G, {now:t0+2*HOUR});
ok(G.resources.isk === before5, "同周期多次 tick 不扣薪（"+before5+"=="+G.resources.isk+"）");
LP.tickLegionNpc(G, {now:t0+4*HOUR});
ok(G.resources.isk === before5 - LP.WAGE.D, "跨过 4h 后仅扣一次工资（扣 "+LP.WAGE.D+"）");

// ================================================================
// 6. 离线 = 在线等价（一次性跳 8h vs 分次 tick）
// ================================================================
section("6 离线=在线等价");
resetLegion(); ensureActive(); addNpc("mining","D");
G.resources.isk=10_000_000;
LP.tickLegionNpc(G,{now:t0});
LP.tickLegionNpc(G,{now:t0+8*HOUR});
var paidJump = 10_000_000 - G.resources.isk;
resetLegion(); ensureActive(); addNpc("mining","D");
G.resources.isk=10_000_000;
LP.tickLegionNpc(G,{now:t0});
LP.tickLegionNpc(G,{now:t0+4*HOUR});
LP.tickLegionNpc(G,{now:t0+8*HOUR});
var paidInc = 10_000_000 - G.resources.isk;
ok(paidJump===paidInc && paidJump===2*LP.WAGE.D, "离线跳 8h 与分三次 tick 扣薪一致（"+paidJump+"=="+paidInc+"=="+2*LP.WAGE.D+"）");

// ================================================================
// 7. 欠薪时该 NPC 不计入贡献
// ================================================================
section("7 欠薪不计入贡献");
resetLegion(); ensureActive(); addNpc("mining","D");
G.legion.lastSalarySettlementAt = 1; G.legion.lastXpSettlementAt = 1; // 让本次 tick 触发结算
G.resources.isk = 0; // 不足以支付
LP.tickLegionNpc(G,{now: 100_000_000 + 4*HOUR});
var s7 = LP.getLegionContributionSnapshot(G);
ok(s7.effects.miningEfficiency === 0, "欠薪(isk 不足)时 mining NPC 不参与贡献（miningEfficiency=0）");
ok(s7.salary.overdueNpcCount === 1, "欠薪计数=1");
ok(s7.activeNpcCount === 0, "活跃(已付薪)NPC 数=0");

// ================================================================
// 8. 工资减免在支付前生效
// ================================================================
section("8 工资减免在支付前生效");
resetLegion(); ensureActive();
addNpc("mining","D"); addNpc("wageReduce","D");
G.legion.lastSalarySettlementAt = 1; G.legion.lastXpSettlementAt = 1; // 让本次 tick 触发结算
var rawSum = LP.WAGE.D + LP.WAGE.D; // 两名 D：原始总薪
var pct8 = LP.getLegionWageReductionPct(G);
ok(pct8>0, "薪资统筹 NPC → wageReductionPct>0（"+pct8.toFixed(1)+"）");
G.resources.isk = 1_000_000; // 充足（减免后仍付得起）
LP.tickLegionNpc(G,{now: 200 + 4*HOUR});
var expected8 = rawSum * (1 - pct8/100);
ok(Math.abs(G.resources.isk - (1_000_000 - expected8)) < 1e-6, "实际支付 "+expected8.toFixed(0)+" < 原始 "+rawSum+"（reduced-before-pay）");

// ================================================================
// 9. 同类递减（第 6 个同类别 NPC 系数 0.8）
// ================================================================
section("9 同类递减");
resetLegion(); ensureActive();
for (var i9=0;i9<6;i9++) addNpc("mining","D");
var raw9 = LP.getLegionNpcSkillRawValue(G.legion.npcs[ 0]);
var s9 = LP.getLegionContributionSnapshot(G);
var expect9 = raw9*5 + raw9*0.8; // 前 5 满 + 第 6 个 1/(1+0.25)=0.8
ok(Math.abs(s9.effects.miningEfficiency - expect9) < 1e-9, "6 个 mining NPC 合计="+expect9.toFixed(2)+"（末位系数 0.8，非 6×）");

// ================================================================
// 10. 管理自动线速度接入
// ================================================================
section("10 自动线调度接入");
resetLegion(); ensureActive();
addNpc("autolineSpeed","D");
var s10 = LP.getLegionContributionSnapshot(G);
ok(s10.multipliers.autoline > 1, "自动线调度 NPC → multipliers.autoline>1（"+s10.multipliers.autoline.toFixed(3)+"）");

// ================================================================
// 11. 行星统筹真实接入（getPlanetOutputIntervalFromState 周期变短）
// ================================================================
section("11 行星统筹真实接入（真实计算路径）");
resetLegion(); ensureActive();
var base11 = W.getPlanetOutputIntervalFromState(G,"lava");
addNpc("planetaryIndustry","D");
var withNpc11 = W.getPlanetOutputIntervalFromState(G,"lava");
ok(withNpc11 < base11, "带 planetaryIndustry NPC 后行星产出周期缩短（"+base11.toFixed(3)+"→"+withNpc11.toFixed(3)+"）");

// ================================================================
// 12-19. 各类型贡献映射（快照字段正确对应真实系统）
// ================================================================
section("12 采集·采矿 贡献");
resetLegion(); ensureActive(); addNpc("mining","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.mining > 1, "mining → multipliers.mining>1");

section("13 制造·冶炼 贡献");
resetLegion(); ensureActive(); addNpc("refining","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.refining > 1, "refining → multipliers.refining>1");

section("14 战斗·激光 贡献");
resetLegion(); ensureActive(); addNpc("laserOps","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.laserDamage > 1, "laserOps → multipliers.laserDamage>1");

section("15 防御·护盾 贡献");
resetLegion(); ensureActive(); addNpc("shieldOperation","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.shieldHp > 1, "shieldOperation → multipliers.shieldHp>1");

section("16 电容通用（战斗/考古共享 fuelSave）");
resetLegion(); ensureActive(); addNpc("capacitorManagement","D");
var s16 = LP.getLegionContributionSnapshot(G);
ok(s16.multipliers.fuelSave < 1, "capacitorManagement → multipliers.fuelSave<1（同时影响战斗与考古燃料路径）");

section("17 舰船组件减免 贡献");
resetLegion(); ensureActive(); addNpc("shipComponentCostReduce","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.shipComponentCost < 1, "shipComponentCostReduce → multipliers.shipComponentCost<1");

section("18 战斗掉落 贡献");
resetLegion(); ensureActive(); addNpc("lootSearch","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.combatDrop > 1, "lootSearch → multipliers.combatDrop>1");

section("19 考古掉落 贡献");
resetLegion(); ensureActive(); addNpc("archaeologyLoot","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.archaeologyDrop > 1, "archaeologyLoot → multipliers.archaeologyDrop>1");

// ================================================================
// 20. 玩家/NPC 经验加成不影响单个 NPC 自身升级曲线
// ================================================================
section("20 玩家经验加成不影响 NPC 自身曲线");
resetLegion(); ensureActive();
var miner20 = addNpc("mining","D");
var xpBefore = LP.calculateLegionNpcXp(G, miner20, 4, {});
addNpc("xpGain","D"); // 增加玩家/NPC 经验加成
var xpAfter = LP.calculateLegionNpcXp(G, miner20, 4, {});
ok(xpBefore === xpAfter, "xpGain NPC 不改变单个生产类 NPC 的经验曲线（"+xpBefore+"=="+xpAfter+"）");

// ================================================================
// 21. 旧存档 / 未激活兼容
// ================================================================
section("21 旧存档未激活兼容");
delete G.legion; G.station.bodyLevel=1; if(G.station.buildings) G.station.buildings.legion_hall=0;
var r21 = LP.tickLegionNpc(G,{now:123});
ok(r21.active===false, "未激活系统 tickLegionNpc 返回 active:false");
ok(G.legion === undefined || (G.legion.npcs&&G.legion.npcs.length===0), "未激活时不强制创建/破坏既有状态");

// ================================================================
// 22. tick 幂等（多次 tick 不重复招募 / 不超额扣薪）
// ================================================================
section("22 tick 幂等");
resetLegion(); ensureActive(); addNpc("mining","D");
G.resources.isk = 50_000_000;
var before22 = G.resources.isk;
// 10 次 tick 全部落在同一结算周期内（每步 6 分钟，总计 54 分钟 < 4h），验证不重复扣薪
for (var i22=0;i22<10;i22++) LP.tickLegionNpc(G,{now: t0 + i22*(HOUR/10)});
ok(G.resources.isk === before22, "10 次周期内核 tick 不重复扣薪");
LP.tickLegionNpc(G,{now: t0 + 12*HOUR});
ok(G.resources.isk === before22 - 3*LP.WAGE.D, "3 个完整周期仅扣 3 次工资（"+(before22-G.resources.isk)+"）");

// ================================================================
// 23. 舰构工程 shipEngineering 接入舰船制造速度（部件 + 总装共享速度乘区）
// ================================================================
section("23 舰构工程 接入舰船制造速度");
resetLegion(); ensureActive();
const RECIPE23 = { time: 1000 };
var base23 = W.getShipEngineeringCycleDuration(G, RECIPE23);
ok(typeof base23 === "number" && isFinite(base23), "无 NPC 时舰船制造周期有限（"+base23+"）");
addNpc("shipEngineering","D"); // salaryState=paid
var snap23 = LP.getLegionContributionSnapshot(G);
ok(snap23.multipliers.shipManufacturing > 1, "舰构工程 NPC 使 shipManufacturing 乘子 >1（"+snap23.multipliers.shipManufacturing+"）");
var dur23 = W.getShipEngineeringCycleDuration(G, RECIPE23);
ok(dur23 < base23, "有舰构工程(工资正常) 舰船制造周期缩短（"+base23+"→"+dur23+"）");
// 周期缩短比例与快照乘子一致：贡献经统一接口接入，在线=离线同源
ok(Math.abs(base23 / dur23 - snap23.multipliers.shipManufacturing) < 1e-9, "周期缩短倍数 == 快照乘子（同源接入，在线=离线）");
// 欠薪 → 恢复原值（工资正常才生效，欠薪完全不生效）
G.legion.npcs[0].salaryState = "overdue";
var snap23b = LP.getLegionContributionSnapshot(G);
ok(snap23b.multipliers.shipManufacturing === 1, "欠薪时 shipManufacturing 乘子恢复 1");
var dur23b = W.getShipEngineeringCycleDuration(G, RECIPE23);
ok(Math.abs(dur23b - base23) < 1e-9, "欠薪时舰船制造周期恢复原值");

// 同类递减：6 个舰构工程（同 production 类）→ 第 6 个系数 0.8
section("23b 舰构工程 同类递减");
resetLegion(); ensureActive();
for (var i23=0;i23<6;i23++) addNpc("shipEngineering","D");
var snap23c = LP.getLegionContributionSnapshot(G);
// 6×D(lv1,raw=1.0)，前5满额、第6×0.8 → 合计 5.8 → 乘子 1.058
ok(Math.abs(snap23c.multipliers.shipManufacturing - 1.058) < 1e-9, "6 个舰构工程 shipManufacturing=1.058（第6递减，非 1.06）");

// ================================================================
// 24-28. 双状态验收（DLC 门禁 / 模块缺失 / legion 缺失）
// ================================================================
section("24 双状态：DLC 放行 + 已加载");
resetLegion(); ensureActive();
ok(LP.isLegionSystemActive(G) === true, "DLC 放行 → isLegionSystemActive=true");
addNpc("shipEngineering","D");
ok(LP.getLegionContributionSnapshot(G).multipliers.shipManufacturing > 1, "DLC 放行且有 NPC → 贡献生效");

section("25 双状态：DLC 接口（开发期恒放行）");
resetLegion(); ensureActive(); disableDlc();
// 开发期 LEGION_DLC_DEV_BYPASS=true ⇒ 即使未授予 DLC，入口仍恒定开启；接回真实 DLC 时本组恢复「禁用 → isLegionSystemActive=false」。
ok(LP.isLegionSystemActive(G) === true, "开发期 DLC 恒放行 → isLegionSystemActive=true（入口恒定开启）");
var snap25 = LP.getLegionContributionSnapshot(G);
var allOne25 = Object.keys(snap25.multipliers).every(k => snap25.multipliers[k] === 1);
ok(allOne25, "无 NPC 时所有军团贡献乘子=1");
var allEffZero25 = Object.keys(snap25.effects).every(k => snap25.effects[k] === 0);
ok(allEffZero25, "无 NPC 时所有效果字段=0");
ok(LP.tickLegionNpc(G,{now:t0}).active === true, "开发期恒放行 → tickLegionNpc 系统启用（仅因无 NPC 而未产生实际结算）");

section("26 双状态：legion-npc.js 未加载");
var savedLegion = W.LEGION_NPC; delete W.LEGION_NPC;
var dur26 = W.getShipEngineeringCycleDuration(G, {time:1000});
ok(typeof dur26 === "number" && isFinite(dur26), "模块缺失 → 舰船制造周期仍可计算（不崩溃）");
var planet26 = W.getPlanetOutputIntervalFromState(G,"lava");
ok(typeof planet26 === "number" && isFinite(planet26), "模块缺失 → 行星产出仍可计算（不崩溃）");
var arch26 = W.getArchaeologyFuelCostState(G, {id:"x"}, null);
ok(arch26 && typeof arch26.rawFuelCost === "number" && isFinite(arch26.rawFuelCost), "模块缺失 → 考古燃料仍可计算（不崩溃）");
ok(W.getLegionAutoLineMultiplier(G) === 1, "模块缺失 → 自动线乘子=1（不崩溃，贡献默认）");
W.LEGION_NPC = savedLegion; // 还原，避免影响后续

section("27 双状态：state.legion 缺失");
delete G.legion;
var snap27 = LP.getLegionContributionSnapshot(G);
ok(typeof snap27 === "object" && snap27.multipliers && snap27.multipliers.mining === 1, "legion 缺失 → 快照返回且乘子=1（不崩溃）");
var dur27 = W.getShipEngineeringCycleDuration(G, {time:1000});
ok(typeof dur27 === "number" && isFinite(dur27), "legion 缺失 → 舰船制造周期可计算（不崩溃）");
ok(W.getLegionAutoLineMultiplier(G) === 1, "legion 缺失 → 自动线乘子=1（不崩溃）");

section("28 主内容 tick / 离线结算 兼容");
resetLegion(); ensureActive(); addNpc("mining","D");
var r28 = LP.tickLegionNpc(G,{now:t0});
ok(r28.active === true && typeof r28.salaries === "object", "正常主内容在线 tick：军团结算正常运行");
var r28b = LP.tickLegionNpc(G,{now:t0 + 12*HOUR});
ok(typeof r28b === "object", "正常主内容离线结算路径（长跳变）不崩溃");

// ================================================================
// 汇总
// ================================================================
console.log("\n================================================");
console.log("军团集成测试：PASS=" + pass + "  FAIL=" + fail);
if (failures.length) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
}
console.log("================================================");
process.exit(fail>0 ? 1 : 0);
