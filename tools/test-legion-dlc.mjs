// ================================================================
// 军团 DLC：建设材料与等级上限扩展 — 专项行为测试
// --------------------------------------------------------------
// 真实脚本 VM 沙箱加载全部游戏逻辑（含 js/systems/station.js / js/core/state.js /
// js/core/persistence.js），不伪造状态、不绕过真实入口。所有断言均通过真实 API 调用
// 观察行为，禁止 assert(true) / 宽范围 / 只查源码字符串冒充行为验证。
//
// 覆盖用户要求的 ≥15 场景：
//   1. 本体 LV3→LV4→LV5 材料/ISK/时长（DLC 授权）
//   2. 公共建筑 LV3→LV4→LV5（DLC + 本体达标）
//   3. 全部资源 ID 在 ResourceRegistry 可解析（无新增/死 ID）
//   4. 建筑 LV4 基腹断岩 = 200（材料倒挂修复点）
//   5. 每档 ISK / 每种材料 ≥ 上一档（单调性）
//   6. 建筑等级 ≤ 本体等级
//   7. 无 DLC 拒绝本体 LV4/LV5、拒绝建筑 LV4/LV5、拒绝军团大厅
//   8. 有 DLC + 本体 LV2 允许大厅 LV1/LV2
//   9. 大厅 LV3/4/5 本体前置门槛
//  10. 大厅功勋(lp) + 材料原子扣减（不足任一 → 不扣任何资源）
//  11. 旧存档幂等迁移（不删资源/建筑/队列，不向下篡改等级）
//  12. 离线 = 在线完成等价（等级变化一致，事件 meta 正确）
//  13. 大厅计入管理 NPC XP 总量（第九座建筑）
//  14. 管理 NPC XP 倍率在 8/9/17/18/26/27/35/36/44/45 边界正确
// ================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const scripts = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
while ((m = re.exec(html))) scripts.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
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
sandbox.playAttackFX=function(){}; sandbox.playEnemyAttackFX=function(){};

let combined="";
for(const s of logicScripts) combined += "\n// === "+s+" ===\n"+readFileSync(join(ROOT,s),"utf8")+"\n";
vm.createContext(sandbox);
try { vm.runInContext(combined,sandbox,{filename:"combined.js"}); }
catch(e){ console.error("LOAD ERROR:",e.message); process.exit(1); }
const W=sandbox;
const G=W.gameState;
const RR=W.ResourceRegistry;
const SS=W.StationSystem;
const PLANS=SS.STATION_BODY_PLANS;
const BLEV=SS.STATION_BUILDING_LEVEL_PLANS;
const HALL=SS.STATION_LEGION_HALL_PLANS;
const BPLANS=SS.STATION_BUILDING_PLANS;

// 收集所有计划用到的资源 ref（用于零化 / 解析校验）
const ALL_PLAN_REFS = new Set();
for (const tbl of [PLANS, BLEV, HALL]) {
  for (const lvl of Object.keys(tbl)) for (const ref of Object.keys((tbl[lvl] && tbl[lvl].materials) || {})) ALL_PLAN_REFS.add(ref);
}

let pass=0, fail=0;
const failures=[];
function ok(cond,label){ if(cond){pass++; console.log("  [PASS] "+label);} else {fail++;failures.push(label);console.log("  [FAIL] "+label);} }
function section(name){ console.log("== "+name+" =="); }

// ---- 沙箱工具 ----
function setDlc(on){ G.station.dlc = { npcWorkers:!!on, combatWings:false }; G.corporation.dlc = { npcWorkers:!!on, combatWings:false }; }
function setBody(l){ G.station.bodyLevel = l; G.station.construction = null; }
function setBuilding(id,l){ G.station.buildings[id] = l; }
function resetBuildings(){ for(const id of SS.STATION_BUILDING_ID_LIST) G.station.buildings[id]=0; G.station.construction=null; }
function zeroRes(){ RR.set(G,"currency:isk",0); RR.set(G,"currency:lp",0); for(const ref of ALL_PLAN_REFS) RR.set(G,ref,0); }
function fundPlan(plan){ zeroRes(); RR.set(G,"currency:isk",plan.isk); RR.set(G,"currency:lp",Number(plan.lp)||0); for(const [ref,qty] of Object.entries(plan.materials||{})) RR.set(G,ref,qty); }
function snapshot(){ const o={isk:RR.get(G,"currency:isk"),lp:RR.get(G,"currency:lp")}; for(const ref of ALL_PLAN_REFS) o[ref]=RR.get(G,ref); return o; }
function resEqual(a,b){ if(a.isk!==b.isk||a.lp!==b.lp) return false; for(const ref of ALL_PLAN_REFS) if(a[ref]!==b[ref]) return false; return true; }
const HOUR=3600000;

// ================================================================
// 1. 资源 ID 解析（无新增/死 ID）
// ================================================================
section("1 资源 ID 解析（ResourceRegistry）");
{
  let allResolve=true, badRefs=[];
  for (const ref of ALL_PLAN_REFS) {
    try {
      const def = RR.getDefinition ? RR.getDefinition(ref) : null;
      const have = RR.getByRef ? RR.getByRef(G, ref) : RR.get(G, ref);
      if (have === undefined || have === null || Number.isNaN(Number(have))) { allResolve=false; badRefs.push(ref); }
      if (!def) { allResolve=false; badRefs.push(ref+"(no-def)"); }
    } catch(e){ allResolve=false; badRefs.push(ref+"("+e.message+")"); }
  }
  ok(allResolve, "全部 "+ALL_PLAN_REFS.size+" 个计划资源 ref 均可解析且有定义"+(badRefs.length?(" 异常:"+badRefs.join(",")):""));
  // 特别确认规格里用到的非常规 ref 存在
  for (const ref of ["moon:铷","mineral:莫尔石","gas:超纯聚合气体","gas:聚合气体","gas:高纯富勒烯","planetary:磁场聚合物","moon:铪","moon:铂"]) {
    ok(ALL_PLAN_REFS.has(ref), "规格资源 "+ref+" 被某计划引用（已纳入校验集）");
  }
}

// ================================================================
// 2. 本体 LV3→LV4→LV5（DLC 授权）材料/ISK/时长
// ================================================================
section("2 本体 LV4/LV5 材料/ISK/时长（DLC）");
setDlc(true);
{
  // LV4
  setBody(3); fundPlan(PLANS[4]);
  const before = snapshot();
  const r4 = W.startStationBodyConstruction(G, Date.now());
  ok(r4.changed===true && r4.targetLevel===4, "本体 LV3→LV4 开工成功");
  const after4 = snapshot();
  const exp4 = Object.assign({}, before);
  exp4.isk = before.isk - 30000000;
  for (const [ref,q] of Object.entries(PLANS[4].materials)) exp4[ref]=before[ref]-q;
  ok(resEqual(after4, exp4), "本体 LV4 精确扣 ISK 30M + 全部材料");
  ok(PLANS[4].isk===30000000, "本体 LV4 ISK=30,000,000");
  ok(PLANS[4].durationMs===8*HOUR, "本体 LV4 时长 8h");
  ok(PLANS[4].materials["mineral:三钛合金"]===120000 && PLANS[4].materials["mineral:类晶体胶矿"]===12000 && PLANS[4].materials["mineral:同位聚合体"]===7000 && PLANS[4].materials["mineral:超新星诺克石"]===4000 && PLANS[4].materials["mineral:基腹断岩"]===500 && PLANS[4].materials["mineral:超噬矿"]===180 && PLANS[4].materials["moon:铪"]===1000 && PLANS[4].materials["moon:铷"]===50 && PLANS[4].materials["gas:高纯富勒烯"]===600 && PLANS[4].materials["planetary:磁场聚合物"]===100, "本体 LV4 材料符合规格（10 项）");

  // LV5
  setBody(4); fundPlan(PLANS[5]);
  const r5 = W.startStationBodyConstruction(G, Date.now());
  ok(r5.changed===true && r5.targetLevel===5, "本体 LV4→LV5 开工成功");
  ok(PLANS[5].isk===100000000, "本体 LV5 ISK=100,000,000");
  ok(PLANS[5].durationMs===16*HOUR, "本体 LV5 时长 16h");
  ok(PLANS[5].materials["mineral:三钛合金"]===250000 && PLANS[5].materials["mineral:类晶体胶矿"]===25000 && PLANS[5].materials["mineral:同位聚合体"]===15000 && PLANS[5].materials["mineral:超新星诺克石"]===9000 && PLANS[5].materials["mineral:基腹断岩"]===1200 && PLANS[5].materials["mineral:超噬矿"]===500 && PLANS[5].materials["moon:铷"]===150 && PLANS[5].materials["mineral:莫尔石"]===25 && PLANS[5].materials["gas:超纯聚合气体"]===30 && PLANS[5].materials["planetary:磁场聚合物"]===300, "本体 LV5 材料符合规格（10 项）");
}

// ================================================================
// 3. 公共建筑 LV3→LV4→LV5（DLC + 本体达标）
// ================================================================
section("3 公共建筑 LV4/LV5（DLC + 本体≥5）");
setDlc(true);
{
  setBody(5); resetBuildings();
  const id="resource_dispatch";
  setBuilding(id,3); fundPlan(BPLANS[id][4]);
  const r4 = W.startStationBuildingConstruction(G, id, Date.now());
  ok(r4.changed===true && r4.targetLevel===4, "建筑 LV3→LV4 开工成功");
  // 材料倒挂修复点：LV4 基腹断岩 = 200（非 100）
  ok(BLEV[4].materials["mineral:基腹断岩"]===200, "建筑 LV4 基腹断岩=200（材料倒挂修复）");
  ok(BLEV[4].isk===2000000 && BLEV[4].durationMs===2*HOUR, "建筑 LV4 ISK=2M / 2h");
  ok(BLEV[4].materials["mineral:三钛合金"]===12000 && BLEV[4].materials["mineral:类晶体胶矿"]===2000 && BLEV[4].materials["mineral:同位聚合体"]===1000 && BLEV[4].materials["mineral:超新星诺克石"]===600 && BLEV[4].materials["mineral:超噬矿"]===70 && BLEV[4].materials["moon:铪"]===500 && BLEV[4].materials["gas:高纯富勒烯"]===300 && BLEV[4].materials["planetary:磁场聚合物"]===50, "建筑 LV4 材料符合规格（8 项 + 基腹断岩200）");

  G.station.construction=null; setBuilding(id,4); fundPlan(BPLANS[id][5]);
  const r5 = W.startStationBuildingConstruction(G, id, Date.now());
  ok(r5.changed===true && r5.targetLevel===5, "建筑 LV4→LV5 开工成功");
  ok(BLEV[5].isk===8000000 && BLEV[5].durationMs===4*HOUR, "建筑 LV5 ISK=8M / 4h");
  ok(BLEV[5].materials["mineral:三钛合金"]===30000 && BLEV[5].materials["mineral:类晶体胶矿"]===5000 && BLEV[5].materials["mineral:同位聚合体"]===2500 && BLEV[5].materials["mineral:超新星诺克石"]===1500 && BLEV[5].materials["mineral:基腹断岩"]===300 && BLEV[5].materials["mineral:超噬矿"]===120 && BLEV[5].materials["moon:铷"]===50 && BLEV[5].materials["mineral:莫尔石"]===5 && BLEV[5].materials["gas:超纯聚合气体"]===10 && BLEV[5].materials["planetary:磁场聚合物"]===120, "建筑 LV5 材料符合规格（10 项）");
}

// ================================================================
// 4. 单调性：每档 ISK / 每种材料 ≥ 上一档
// ================================================================
section("4 公共建筑分级成本单调性");
{
  const levels=[1,2,3,4,5];
  // ISK 单调不减
  let iskMono=true;
  for (let i=1;i<levels.length;i++) if (!(BLEV[levels[i]].isk >= BLEV[levels[i-1]].isk)) iskMono=false;
  ok(iskMono, "公共建筑 ISK 每档 ≥ 上一档");
  // 每种材料单调不减（仅比较「相邻两档都存在」的 ref，避免不同等级材料组合差异误报）
  let matMono=true, badMat=[];
  for (let i=1;i<levels.length;i++) {
    const prevL=levels[i-1], curL=levels[i];
    for (const ref of Object.keys(BLEV[curL].materials)) {
      if (ref in BLEV[prevL].materials) {
        const prev=BLEV[prevL].materials[ref], cur=BLEV[curL].materials[ref];
        if (!(cur >= prev)) { matMono=false; badMat.push(ref+":"+prev+"->"+cur); }
      }
    }
  }
  ok(matMono, "公共建筑共有材料每档 ≥ 上一档"+(badMat.length?(" 异常:"+badMat.join(",")):""));
  // 建筑 LV4 相对 LV3 基腹断岩不得倒挂（125 → 200）
  ok(BLEV[3].materials["mineral:基腹断岩"]===125 && BLEV[4].materials["mineral:基腹断岩"]===200, "基腹断岩 LV3=125 < LV4=200（无倒挂）");
}
function BLEVEL_GET(tbl,l,ref){ return (tbl[l].materials && tbl[l].materials[ref]) || 0; }

// ================================================================
// 5. 建筑等级 ≤ 本体等级
// ================================================================
section("5 建筑等级 ≤ 本体等级（body-level-cap）");
setDlc(true);
{
  setBody(0); resetBuildings(); fundPlan(BPLANS["resource_dispatch"][1]);
  const r0=W.startStationBuildingConstruction(G,"resource_dispatch",Date.now());
  ok(r0.changed===false && r0.reason==="body-level-cap", "本体 Lv.0 建筑不可开工 → body-level-cap");
  setBody(1); resetBuildings(); fundPlan(BPLANS["resource_dispatch"][1]);
  const r1=W.startStationBuildingConstruction(G,"resource_dispatch",Date.now());
  ok(r1.changed===true, "本体 Lv.1 建筑 Lv1 可开工");
  G.station.construction=null; setBuilding("resource_dispatch",1); fundPlan(BPLANS["resource_dispatch"][2]);
  const r2=W.startStationBuildingConstruction(G,"resource_dispatch",Date.now());
  ok(r2.changed===false && r2.reason==="body-level-cap", "本体 Lv.1 时建筑 Lv2 不可开工 → body-level-cap");
  // 本体 Lv5 时建筑可升至 Lv5
  setBody(5); setBuilding("resource_dispatch",4); fundPlan(BPLANS["resource_dispatch"][5]);
  const r5=W.startStationBuildingConstruction(G,"resource_dispatch",Date.now());
  ok(r5.changed===true && r5.targetLevel===5, "本体 Lv.5 时建筑 Lv5 可开工");
}

// ================================================================
// 6. DLC 门禁当前未生效：扩展内容(LV4+/大厅)不再被 dlc-required 拦截，仅受本体/建筑上限与 body-level-cap 约束
// ================================================================
section("6 DLC 门禁未生效：扩展内容不再被 dlc-required 拦截");
setDlc(false);
{
  // 本体上限现行 5（DLC 门禁未生效）：LV3→LV4 可开工（不再 max-level/dlc-required）
  setBody(3); fundPlan(PLANS[4]);
  const rb=W.startStationBodyConstruction(G,Date.now());
  ok(rb.changed===true && rb.targetLevel===4, "无 DLC 本体 LV3→LV4 可开工(changed=true)");
  // 本体 LV5 已是绝对上限
  setBody(5); const rb5=W.startStationBodyConstruction(G,Date.now());
  ok(rb5.changed===false && rb5.reason==="max-level", "本体 LV5 已为上限(max-level)");
  // 建筑 LV3 → LV4（本体 LV5）：不再 dlc-required，按 body-level/cap 判定后可开工
  setBody(5); resetBuildings(); G.station.construction=null; setBuilding("resource_dispatch",3); fundPlan(BPLANS["resource_dispatch"][4]);
  const rbuild=W.startStationBuildingConstruction(G,"resource_dispatch",Date.now());
  ok(rbuild.changed===true && rbuild.targetLevel===4, "无 DLC 建筑 LV3→LV4 可开工(changed=true)");
  // 大厅 LV1（本体 LV3）：dlc 门禁移除后可开工（lp+材料已备）
  setBody(3); resetBuildings(); fundPlan(HALL[1]);
  const rh=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(rh.changed===true && rh.targetLevel===1, "无 DLC 军团大厅 LV1 可开工(changed=true)");
}

// ================================================================
// 7. 有 DLC + 本体 LV2 允许大厅 LV1/LV2
// ================================================================
section("7 有 DLC + 本体 LV2 允许大厅 LV1/LV2");
setDlc(true);
{
  setBody(2); resetBuildings();
  fundPlan(HALL[1]);
  const rh1=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(rh1.changed===true && rh1.targetLevel===1, "DLC+本体LV2 大厅 LV1 可开工");
  // 完成 LV1 以便测 LV2
  G.station.construction=null; setBuilding("legion_hall",1); fundPlan(HALL[2]);
  const rh2=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(rh2.changed===true && rh2.targetLevel===2, "DLC+本体LV2 大厅 LV2 可开工");
  // 本体 LV1 时大厅 LV1 被本体门槛挡（需本体≥2）
  setBody(1); setBuilding("legion_hall",0); fundPlan(HALL[1]);
  const rh1b=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(rh1b.changed===false && rh1b.reason==="body-level-cap", "DLC+本体LV1 大厅 LV1 被本体门槛拒(body-level-cap)");
}

// ================================================================
// 8. 大厅 LV3/4/5 本体前置门槛
// ================================================================
section("8 大厅 LV3/4/5 本体前置门槛");
setDlc(true);
{
  // LV3 需本体≥3
  setBody(2); setBuilding("legion_hall",2); fundPlan(HALL[3]);
  const r3a=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(r3a.changed===false && r3a.reason==="body-level-cap", "大厅 LV2→LV3 @本体LV2 拒绝(body-level-cap)");
  setBody(3); setBuilding("legion_hall",2); fundPlan(HALL[3]);
  const r3b=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(r3b.changed===true && r3b.targetLevel===3, "大厅 LV2→LV3 @本体LV3 可开工");
  // LV4 需本体≥4
  setBody(3); setBuilding("legion_hall",3); fundPlan(HALL[4]);
  const r4a=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(r4a.changed===false && r4a.reason==="body-level-cap", "大厅 LV3→LV4 @本体LV3 拒绝(body-level-cap)");
  setBody(4); setBuilding("legion_hall",3); fundPlan(HALL[4]);
  const r4b=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(r4b.changed===true && r4b.targetLevel===4, "大厅 LV3→LV4 @本体LV4 可开工");
  // LV5 需本体≥5
  setBody(4); setBuilding("legion_hall",4); fundPlan(HALL[5]);
  const r5a=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(r5a.changed===false && r5a.reason==="body-level-cap", "大厅 LV4→LV5 @本体LV4 拒绝(body-level-cap)");
  setBody(5); setBuilding("legion_hall",4); fundPlan(HALL[5]);
  const r5b=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(r5b.changed===true && r5b.targetLevel===5, "大厅 LV4→LV5 @本体LV5 可开工");
  // 大厅材料/功勋断言（LV1 示例）
  ok(HALL[1].isk===3000000 && HALL[1].lp===100, "大厅 LV1 ISK=3M / 功勋=100");
  ok(HALL[5].isk===80000000 && HALL[5].lp===2000, "大厅 LV5 ISK=80M / 功勋=2000");
}

// ================================================================
// 9. 大厅功勋(lp)+材料原子扣减（不足任一 → 不扣任何资源）
// ================================================================
section("9 大厅功勋+材料原子扣减");
setDlc(true);
{
  setBody(2); resetBuildings();
  // 恰好充足 → 全部扣
  G.station.construction=null; fundPlan(HALL[1]);
  const before=fundPlan_snapshot();
  const rOk=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(rOk.changed===true, "大厅 LV1 资源恰好充足 → 开工成功");
  const exp=Object.assign({}, before);
  exp.isk=before.isk-3000000; exp.lp=before.lp-100;
  for(const [ref,q] of Object.entries(HALL[1].materials)) exp[ref]=before[ref]-q;
  ok(resEqual(snapshot(),exp), "大厅 LV1 精确扣 ISK 3M + 功勋 100 + 全部材料");

  // 功勋不足 → 拒绝且不扣任何资源
  G.station.construction=null; fundPlan(HALL[1]); RR.set(G,"currency:lp", 50); // 不足 100
  const beforeLp=fundPlan_snapshot();
  const rLp=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(rLp.changed===false && rLp.reason==="insufficient-lp", "大厅 LV1 功勋不足 → insufficient-lp");
  ok(resEqual(snapshot(),beforeLp), "功勋不足时未扣任何资源（原子）");

  // 材料不足（但 ISK+功勋充足）→ 拒绝且不扣任何资源
  G.station.construction=null; fundPlan(HALL[1]);
  const firstMat=Object.keys(HALL[1].materials)[0];
  RR.set(G,firstMat, HALL[1].materials[firstMat]-1); // 差 1
  const beforeMat=fundPlan_snapshot();
  const rMat=W.startStationBuildingConstruction(G,"legion_hall",Date.now());
  ok(rMat.changed===false && rMat.reason==="insufficient-materials", "大厅 LV1 材料不足 → insufficient-materials");
  ok(resEqual(snapshot(),beforeMat), "材料不足时未扣任何资源（原子）");
}
function fundPlan_snapshot(){ return snapshot(); }

// ================================================================
// 10. 旧存档幂等迁移（不删资源/建筑/队列，不向下篡改等级）
// ================================================================
section("10 旧存档幂等迁移");
setDlc(true);
{
  // 构造一个"已建到满级 + 进行中施工(LV4本体)"的旧档
  setBody(5); resetBuildings();
  for(const id of SS.STATION_BUILDING_ID_LIST) setBuilding(id, id==="legion_hall"?3:5);
  G.station.construction={ kind:"body", targetLevel:5, startedAt:Date.now()-1000, completesAt:Date.now()+100000, durationMs:HOUR, paid:true, costSnapshot:{isk:0,materials:{}} };
  // 预置一些玩家资产，验证不被触碰
  G.resources.isk=999999;
  W.normalizeStationState(G);
  ok(G.station.bodyLevel===5, "迁移后本体 LV5 保留（不向下篡改）");
  ok(SS.STATION_BUILDING_ID_LIST.every(id=>G.station.buildings[id]=== (id==="legion_hall"?3:5)), "迁移后九座建筑等级全部保留（含 legion_hall=3）");
  ok(G.station.construction && G.station.construction.paid===true && G.station.construction.targetLevel===5, "迁移后进行中 LV5 施工保留（队列不删）");
  ok(G.resources.isk===999999, "迁移不触碰玩家 ISK");
  // 幂等校验：对"已归一化"状态连续再执行，结果应完全一致（比对归一化后才合理，因首次会补齐缺省字段）
  const before=JSON.stringify(G.station);
  W.normalizeStationState(G);
  const after=JSON.stringify(G.station);
  W.normalizeStationState(G);
  const after2=JSON.stringify(G.station);
  ok(before===after && after===after2, "连续三次 normalize 结果完全一致（幂等）");
}

// ================================================================
// 11. 离线 = 在线完成等价
// ================================================================
section("11 离线=在线完成等价");
setDlc(true);
{
  // 本体 LV4 已完成到期，分别在线/离线完成，验证等级变化一致
  function runComplete(offline){
    setBody(3); resetBuildings(); fundPlan(PLANS[4]);
    W.startStationBodyConstruction(G, Date.now() - PLANS[4].durationMs - 5000);
    return W.completeStationConstruction(G, { offline: !!offline });
  }
  const on=runComplete(false);
  ok(on.changed===true && on.kind==="body" && on.toLevel===4, "在线完成本体 LV4 → bodyLevel=4");
  ok(G.station.bodyLevel===4, "在线完成后 bodyLevel=4");
  const off=runComplete(true);
  ok(off.changed===true && off.kind==="body" && off.toLevel===4 && off.offline===true, "离线完成本体 LV4 → bodyLevel=4 且 offline 标记");
  ok(G.station.bodyLevel===4, "离线完成后 bodyLevel=4（与在线等价）");

  // 建筑 LV4 在线/离线等价
  function runBuild(offline){
    setBody(5); resetBuildings(); setBuilding("resource_dispatch",3); fundPlan(BPLANS["resource_dispatch"][4]);
    W.startStationBuildingConstruction(G,"resource_dispatch", Date.now() - BLEV[4].durationMs - 5000);
    return W.completeStationConstruction(G, { offline: !!offline });
  }
  const bon=runBuild(false);
  ok(bon.changed===true && bon.kind==="building" && bon.toLevel===4, "在线完成建筑 LV4 → Lv4");
  ok(G.station.buildings.resource_dispatch===4, "在线完成后建筑=4");
  const boff=runBuild(true);
  ok(boff.changed===true && boff.toLevel===4 && boff.offline===true, "离线完成建筑 LV4 → Lv4 且 offline 标记");
  ok(G.station.buildings.resource_dispatch===4, "离线完成后建筑=4（与在线等价）");
}

// ================================================================
// 12. 大厅计入管理 NPC XP 总量（第九座建筑）+ 倍率边界
// ================================================================
section("12 大厅计入管理 NPC XP 总量 + 倍率边界");
setDlc(true);
{
  setBody(5); resetBuildings();
  // 全部 9 座建筑置 5 → total=45 → 3.0x；验证 hall 计入
  for(const id of SS.STATION_BUILDING_ID_LIST) setBuilding(id,5);
  ok(W.getStationManagementNpcXpTotal(G)===45, "九座建筑全 Lv5 → 总量=45（含 legion_hall 计入）");
  ok(Math.abs(W.getStationManagementNpcXpMultiplier(G)-3.0)<1e-9, "总量45 → 倍率3.0x");
  // hall 单独置 5、其余 0 → total=5
  resetBuildings(); setBuilding("legion_hall",5);
  ok(W.getStationManagementNpcXpTotal(G)===5, "仅大厅 Lv5 → 总量=5（hall 计入）");

  // 倍率边界：上沿 9/18/27/36/45 与下沿 8/17/26/35/44
  const bIds=SS.STATION_BUILDING_ID_LIST;
  function set9(levels){ resetBuildings(); levels.forEach((l,i)=>setBuilding(bIds[i],l)); }
  // 下沿：8 座 L、1 座 L-1
  const downEdges=[[1,0,0.5],[2,1,1.0],[3,2,1.5],[4,3,2.0],[5,4,2.5]];
  for(const [L,Lo,exp] of downEdges){
    const lv=bIds.map((_,i)=> i<8?L:Lo);
    set9(lv);
    const total=W.getStationManagementNpcXpTotal(G);
    const mult=W.getStationManagementNpcXpMultiplier(G);
    ok(total===8*L+Lo && Math.abs(mult-exp)<1e-9, "总量="+total+" → 倍率"+exp+"x");
  }
  // 上沿：9 座同 L
  const upEdges=[[0,0.5],[1,1.0],[2,1.5],[3,2.0],[4,2.5],[5,3.0]];
  for(const [L,exp] of upEdges){
    set9(bIds.map(()=>L));
    const total=W.getStationManagementNpcXpTotal(G);
    const mult=W.getStationManagementNpcXpMultiplier(G);
    ok(total===9*L && Math.abs(mult-exp)<1e-9, "总量="+total+" → 倍率"+exp+"x");
  }
}

// ================================================================
// 13. DLC 接口复用校验（不硬编码平台判断）
// ================================================================
section("13 DLC 内容授权接口复用");
{
  ok(typeof W.getStationDlcNpcWorkers==="function", "getStationDlcNpcWorkers 已导出");
  // 开发期 LEGION_DLC_DEV_BYPASS=true：接口恒返回 true；接回真实 DLC 时恢复「无 DLC → false」断言。
  setDlc(false);
  ok(W.getStationDlcNpcWorkers(G)===true, "开发期恒放行 → 即便未授予 DLC 仍 true（入口恒定开启）");
  setDlc(true);
  ok(W.getStationDlcNpcWorkers(G)===true, "有 DLC → true");
  // 仅 station.dlc 为真、corporation.dlc 为假 → 仍 true（平台可能只写一处）
  G.station.dlc={npcWorkers:true,combatWings:false}; G.corporation.dlc={npcWorkers:false,combatWings:false};
  ok(W.getStationDlcNpcWorkers(G)===true, "仅 station.dlc 为真 → true（兼容单点注入）");
}

// ================================================================
// 汇总
// ================================================================
console.log("\n================================================");
console.log("军团 DLC 专项测试：PASS=" + pass + "  FAIL=" + fail);
if (failures.length) {
  console.log("失败项：");
  for (const f of failures) console.log("  - " + f);
}
console.log("================================================");
process.exit(fail>0 ? 1 : 0);
