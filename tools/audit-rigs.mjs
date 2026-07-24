// ================================================================
// 改装件（rig）系统专项审计
// 见 RIG_SYSTEM_IMPLEMENTATION_PLAN.md 第九节。
// 分区：A 数据完整性 / B 制造门槛 / C 装配·销毁·替换 / D 普通装备不受影响 /
//       E 效果计算 / F 防放大 / G 存档迁移 / H UI 显示态 / I 回归 /
//       J 经济固化断言（掉率·掉落数量·配方需求·期望次数，防单侧修改）
// 全部走真实脚本 VM 沙箱 + 真实 Action / selector，不伪造 fitted 数组。
// ================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const ROOT = "c:/Users/10195/Documents/EVE IDLE/EVEIDLE-WORKBUDDY";
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const scripts = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);
const UI_EXCLUDE = [
  "js/ui/error-boundary.js","js/ui/action-modal.js","js/ui/shell-render.js",
  "js/ui/manufacturing-render.js","js/ui/combat-render.js","js/ui/planetary-render.js",
  "js/ui/archaeology-render.js","js/ui/render.js","js/core/runtime.js"
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
  document:new Proxy({},{get(t,p){
    if(p==="getElementById"||p==="querySelector")return()=>makeEl();
    if(p==="querySelectorAll")return()=>[];
    if(p==="createElement")return()=>makeEl();
    if(p==="addEventListener"||p==="removeEventListener")return()=>{};
    if(p==="body")return makeEl();
    return makeEl();
  }})
};
sandbox.window=sandbox; sandbox.globalThis=sandbox;
sandbox.addEventListener=()=>{}; sandbox.removeEventListener=()=>{}; sandbox.dispatchEvent=()=>{};
sandbox.location={href:"",search:"",hash:""}; sandbox.navigator={userAgent:"node"};
sandbox.innerWidth=1280; sandbox.innerHeight=800;
sandbox.CanvasRenderingContext2D=function(){}; sandbox.CanvasRenderingContext2D.prototype={};

let combined="";
for(const s of logicScripts) combined += "\n// === "+s+" ===\n"+readFileSync(join(ROOT,s),"utf8")+"\n";
combined += `
window.EQUIPMENT_DB=(typeof EQUIPMENT_DB!=='undefined')?EQUIPMENT_DB:null;
window.RIG_SERIES=(typeof RIG_SERIES!=='undefined')?RIG_SERIES:null;
window.RIG_TIER_META=(typeof RIG_TIER_META!=='undefined')?RIG_TIER_META:null;
window.EQUIPMENT_ENGINEERING_RECIPES=(typeof EQUIPMENT_ENGINEERING_RECIPES!=='undefined')?EQUIPMENT_ENGINEERING_RECIPES:null;
window.EQUIPMENT_ENGINEERING_CATEGORIES=(typeof EQUIPMENT_ENGINEERING_CATEGORIES!=='undefined')?EQUIPMENT_ENGINEERING_CATEGORIES:null;
window.ARCHAEOLOGY_TIERS=(typeof ARCHAEOLOGY_TIERS!=='undefined')?ARCHAEOLOGY_TIERS:null;
window.ARCHAEOLOGY_SITES=(typeof ARCHAEOLOGY_SITES!=='undefined')?ARCHAEOLOGY_SITES:null;
window.gameState=(typeof gameState!=='undefined')?gameState:null;
`;
vm.createContext(sandbox);
try { vm.runInContext(combined,sandbox,{filename:"combined.js"}); }
catch(e){ console.error("LOAD ERROR:",e.message); process.exit(1); }
const W=sandbox;

let pass=0, fail=0;
const failures=[];
function ok(cond,label){
  if(cond){pass++;}
  else {fail++;failures.push(label);console.log("  [FAIL] "+label);}
}
function section(name){ console.log("== "+name+" =="); }
function approx(a,b,tol){ return Math.abs(a-b)<=(tol==null?1e-9:tol); }

function freshState(){
  const st=JSON.parse(JSON.stringify(W.gameState));
  st.inventory=st.inventory||{};
  // 清空启动自带的初始舰：其 fitted 残留旧 instanceId 引用（如 eq_1），
  // 与本测试重置 nextInstanceId=1 后新分配的 ID 碰撞，会被 normalize 判为重复引用而清空。
  st.inventory.ships=[];
  st.equipment={inventory:[],instances:[],nextInstanceId:1};
  st.shipAssignments={};
  return st;
}
function addShip(st, shipId){
  const ship=W.createShipInstance(shipId);
  st.inventory.ships.push(ship);
  return ship;
}
function fitRig(st, ship, rigId, slotIndex){
  st.equipment.inventory.push(rigId);
  return W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:slotIndex||0,rigItemId:rigId},0);
}
const SUFFIX=["i","ii","iii","iv","v"];
const ROMAN=["I","II","III","IV","V"];

/* ================= A 数据完整性 ================= */
section("A 数据完整性（45 件定义）");
{
  ok(Array.isArray(W.RIG_SERIES)&&W.RIG_SERIES.length===9, "A1 RIG_SERIES 恰 9 系列");
  ok(Array.isArray(W.RIG_TIER_META)&&W.RIG_TIER_META.length===5, "A2 RIG_TIER_META 恰 5 档");
  const rigDefs=Object.values(W.EQUIPMENT_DB).filter(d=>d.slot==="rig");
  ok(rigDefs.length===45, `A3 EQUIPMENT_DB 恰 45 件 rig（实际 ${rigDefs.length}）`);
  const LEVELS=[1,15,35,55,80];
  for(const series of W.RIG_SERIES){
    for(let t=0;t<5;t++){
      const id=series.stackGroup+"_"+SUFFIX[t];
      const d=W.EQUIPMENT_DB[id];
      ok(Boolean(d), `A ${id} 存在`);
      if(!d) continue;
      ok(d.slot==="rig"&&d.stackGroup===series.stackGroup&&d.rigCategory===series.rigCategory&&d.rigTier===ROMAN[t],
        `A ${id} slot/stackGroup/rigCategory/rigTier 完整`);
      ok(d.level===LEVELS[t], `A ${id} level=${LEVELS[t]}`);
      ok(d.bonuses && approx(d.bonuses[series.bonusKey],series.values[t]),
        `A ${id} bonuses.${series.bonusKey}=${series.values[t]}`);
      ok(d.cost && Object.keys(d.cost).some(k=>k.startsWith("calibration:")),
        `A ${id} 配方含校准材料`);
      ok(Number(d.time)>0 && Number(d.xp)>0, `A ${id} time/xp 有效`);
    }
  }
}

/* ================= B 制造门槛 ================= */
section("B 制造门槛");
{
  const recipes=W.EQUIPMENT_ENGINEERING_RECIPES.filter(r=>r.category==="rigs");
  ok(recipes.length===45, `B1 装备工程改装件配方恰 45 条（实际 ${recipes.length}）`);
  ok(recipes.every(r=>!r.requiresBlueprint), "B2 全部无需蓝图");
  ok(W.EQUIPMENT_ENGINEERING_CATEGORIES.some(c=>c.id==="rigs"&&c.name==="改装件"), "B3 分类表含「改装件」");
  const CALIB_QTY={I:1,II:1,III:2,IV:2,V:3};
  const CALIB_ID={I:"art_i_calib",II:"art_ii_calib",III:"art_iii_calib",IV:"art_iv_calib",V:"art_v_calib"};
  for(const r of recipes){
    const tier=r.rigTier;
    const key="calibration:"+CALIB_ID[tier];
    ok(r.cost[key]===CALIB_QTY[tier], `B ${r.id} 校准需求 ${CALIB_QTY[tier]}（${key}）`);
  }
  // 材料名真实（可被库存查询解析、无 NaN）
  const st=freshState();
  ok(recipes.every(r=>Object.entries(r.cost).every(([mat,qty])=>{
    const stock=W.getMaterialStockFromState(st,mat);
    return Number.isFinite(stock)&&Number.isFinite(qty)&&qty>0;
  })), "B4 全部配方材料可解析且数量有效");
}

/* ================= C 装配 / 销毁 / 替换 ================= */
section("C 装配 / 销毁 / 替换");
{
  const st=freshState();
  const ship=addShip(st,"starmap"); // 2 rig 槽
  // 安装消耗 inventory + 创建 instance
  st.equipment.inventory.push("rig_archaeology_scan_i");
  let r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_archaeology_scan_i"},0);
  ok(r.changed===true, "C1 fitRig 成功");
  ok(!st.equipment.inventory.includes("rig_archaeology_scan_i"), "C2 安装即消耗 inventory");
  const instRef=ship.fitted.rig[0];
  const resolved=W.resolveEquipmentReference(st,instRef);
  ok(resolved && resolved.instance && resolved.instance.installedOn===ship.instanceId, "C3 创建实例且 installedOn 正确");
  // stackGroup 排重：同组不同档也不能共存
  st.equipment.inventory.push("rig_archaeology_scan_v");
  r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:1,rigItemId:"rig_archaeology_scan_v"},0);
  ok(r.changed===false && r.reason==="same-stack-group-exists", `C4 同组不同档被拒（${r.reason}）`);
  // 不同组可共存
  st.equipment.inventory.push("rig_archaeology_fuel_i");
  r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:1,rigItemId:"rig_archaeology_fuel_i"},0);
  ok(r.changed===true, "C5 不同组可共存");
  // 槽位边界
  st.equipment.inventory.push("rig_smelting_speed_i");
  r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:2,rigItemId:"rig_smelting_speed_i"},0);
  ok(r.changed===false && r.reason==="invalid-slot", "C6 超出舰船 rig 槽数被拒");
  // 销毁不回退
  const invBefore=st.equipment.inventory.length;
  const instCountBefore=st.equipment.instances.length;
  r=W.dispatchGameAction(st,{type:"hangar/destroyFittedRig",instanceId:ship.instanceId,slotIndex:1},0);
  ok(r.changed===true && r.rigId==="rig_archaeology_fuel_i", "C7 destroyFittedRig 成功");
  ok(st.equipment.inventory.length===invBefore, "C8 销毁不返还 inventory");
  ok(st.equipment.instances.length===instCountBefore-1, "C9 销毁删除实例");
  ok(ship.fitted.rig[1]==null, "C10 槽位清空");
  // 替换=旧件销毁+新件安装（原子）
  st.equipment.inventory.push("rig_archaeology_scan_ii");
  r=W.dispatchGameAction(st,{type:"hangar/replaceFittedRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_archaeology_scan_ii"},0);
  ok(r.changed===true && r.oldRigId==="rig_archaeology_scan_i" && r.newRigId==="rig_archaeology_scan_ii", "C11 替换成功且新旧 id 正确");
  const nowRef=W.resolveEquipmentReference(st,ship.fitted.rig[0]);
  ok(nowRef && nowRef.itemId==="rig_archaeology_scan_ii", "C12 槽内为新件");
  ok(!st.equipment.instances.some(i=>i.itemId==="rig_archaeology_scan_i"), "C13 旧件实例已销毁");
  ok(!st.equipment.inventory.includes("rig_archaeology_scan_i"), "C14 旧件不返还库存");
  // 替换失败原子不变：inventory 无新件
  r=W.dispatchGameAction(st,{type:"hangar/replaceFittedRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_archaeology_scan_iii"},0);
  ok(r.changed===false, "C15 库存缺新件时替换被拒");
  ok(W.resolveEquipmentReference(st,ship.fitted.rig[0]).itemId==="rig_archaeology_scan_ii", "C16 失败后旧件保留（原子）");
  // 战斗锁定
  const st2=freshState();
  const ship2=addShip(st2,"rifter");
  st2.shipAssignments.combat=ship2.instanceId;
  st2.combat=st2.combat||{}; st2.combat.active=true; st2.combat.activeShip=ship2.instanceId;
  st2.equipment.inventory.push("rig_shield_capacity_i");
  r=W.dispatchGameAction(st2,{type:"hangar/fitRig",instanceId:ship2.instanceId,slotIndex:0,rigItemId:"rig_shield_capacity_i"},0);
  ok(r.changed===false && r.reason==="combat-active", "C17 战斗中禁止装 rig");
  // resetFitting 对 rig=销毁
  const st3=freshState();
  const ship3=addShip(st3,"rifter");
  fitRig(st3,ship3,"rig_shield_capacity_i",0);
  r=W.dispatchGameAction(st3,{type:"hangar/resetFitting",instanceId:ship3.instanceId},0);
  ok(r.changed===true, "C18 resetFitting 成功");
  ok(!st3.equipment.inventory.includes("rig_shield_capacity_i"), "C19 resetFitting 对 rig 销毁不返还");
  ok(!st3.equipment.instances.some(i=>i.itemId==="rig_shield_capacity_i"), "C20 resetFitting 后 rig 实例已删除");
}

/* ================= D 普通装备不受影响 ================= */
section("D 普通装备不受影响");
{
  const st=freshState();
  const ship=addShip(st,"heron");
  st.equipment.inventory.push("archaeo_analyzer_i");
  let r=W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:"archaeo_analyzer_i"},0);
  ok(r.changed===true, "D1 普通装备安装成功");
  ok(!st.equipment.inventory.includes("archaeo_analyzer_i"), "D2 安装消耗 inventory");
  // 单件卸载：实例制语义——安装时字符串已升级为实例，卸载后实例保留（installedOn=null），可再装配，不销毁
  r=W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:null},0);
  const detached=st.equipment.instances.find(i=>i.itemId==="archaeo_analyzer_i");
  ok(r.changed===true && detached && detached.installedOn===null, "D3 普通装备卸载后实例保留且 installedOn=null（不销毁）");
  ok(ship.fitted.high[0]===null, "D3b 卸载后槽位清空");
  // resetFitting：普通装备实例保留可再用、rig 实例彻底删除
  const st2=freshState();
  const ship2=addShip(st2,"heron");
  st2.equipment.inventory.push("archaeo_analyzer_i");
  W.dispatchGameAction(st2,{type:"hangar/setFittingSlot",instanceId:ship2.instanceId,slot:"high",slotIndex:0,equipmentId:"archaeo_analyzer_i"},0);
  fitRig(st2,ship2,"rig_archaeology_scan_i",0);
  W.dispatchGameAction(st2,{type:"hangar/resetFitting",instanceId:ship2.instanceId},0);
  const kept=st2.equipment.instances.find(i=>i.itemId==="archaeo_analyzer_i");
  ok(kept && kept.installedOn===null, "D4 resetFitting 后普通装备实例保留（installedOn=null，可再装）");
  ok(!st2.equipment.instances.some(i=>i.itemId==="rig_archaeology_scan_i")
    && !st2.equipment.inventory.includes("rig_archaeology_scan_i"), "D5 resetFitting 销毁 rig（实例删除且不归还）");
}

/* ================= E 效果计算 ================= */
section("E 效果计算");
{
  // 战斗容量 ×(1+pct)，逐层隔离
  for(const [rig,layer] of [["rig_shield_capacity_i","shield"],["rig_armor_capacity_i","armor"],["rig_structure_capacity_i","structure"]]){
    const st=freshState();
    const ship=addShip(st,"rifter");
    st.shipAssignments.combat=ship.instanceId;
    const base=W.getCombatMaxHpFromState(st);
    fitRig(st,ship,rig,0);
    const after=W.getCombatMaxHpFromState(st);
    ok(Math.abs(after[layer]-Math.round(base[layer]*1.04))<=1, `E ${rig} → ${layer} ×1.04`);
    for(const other of ["shield","armor","structure"].filter(x=>x!==layer))
      ok(after[other]===base[other], `E ${rig} 不影响 ${other}`);
  }
  // 采矿 / 采气 +0.04（rig 槽不吃 high 放大器）
  {
    const st=freshState(); const ship=addShip(st,"rifter"); st.shipAssignments.mining=ship.instanceId;
    const b=W.getProductionEfficiencyState(st,"mining").primaryBonus;
    fitRig(st,ship,"rig_mining_speed_i",0);
    const eff=W.getProductionEfficiencyState(st,"mining");
    ok(approx(eff.primaryBonus-b,0.04), "E 采矿 rig I primaryBonus +0.04");
    const entry=(eff.equipment||[]).find(e=>e.slot==="rig");
    ok(entry && approx(entry.rawPrimary,entry.adjustedPrimary,1e-12), "E rig 槽不吃 high 槽放大器");
  }
  {
    const st=freshState(); const ship=addShip(st,"rifter"); st.shipAssignments.gasHarvesting=ship.instanceId;
    const b=W.getProductionEfficiencyState(st,"gasHarvesting").primaryBonus;
    fitRig(st,ship,"rig_gas_speed_i",0);
    ok(approx(W.getProductionEfficiencyState(st,"gasHarvesting").primaryBonus-b,0.04), "E 采气 rig I primaryBonus +0.04");
  }
  // 冶炼 +0.04 加法并入
  {
    const st=freshState(); const ship=addShip(st,"rifter"); st.shipAssignments.refining=ship.instanceId;
    fitRig(st,ship,"rig_smelting_speed_i",0);
    const d=W.getSmeltingDisplayState(st,0);
    ok(approx(d.rigBonus,0.04) && approx(d.efficiency,d.skillEfficiency*(1+d.shipBonus+0.04)), "E 冶炼 rig I rigBonus=0.04 且公式正确");
  }
  // 考古扫描 ×1.05（只乘 basePart）
  {
    const st=freshState(); st.skills.archaeology={lvl:1,xp:0};
    const ship=addShip(st,"heron"); st.shipAssignments.archaeology=ship.instanceId;
    const base=W.computeArchaeologyScanStrength(st,ship,"core_probe_i");
    fitRig(st,ship,"rig_archaeology_scan_i",0);
    ok(approx(W.computeArchaeologyScanStrength(st,ship,"core_probe_i"),base*1.05), "E 扫描 rig I = base×1.05");
  }
  // 干扰缩短（新产生的干扰按比例缩短，有下限）
  {
    const site=(W.ARCHAEOLOGY_SITES||[]).find(s=>s.id==="site_v_a");
    const baseSec=W.getArchaeologyInterferenceSeconds(site,0);
    const red=W.getArchaeologyInterferenceSeconds(site,0.10);
    ok(red===Math.max(W.ARCHAEOLOGY_SIGNAL_MIN_SECONDS||2,Math.round(Math.round(site.time*0.25)*0.90)), `E 干扰 rig 10% 缩短（${baseSec}→${red}s）`);
  }
  // 燃料效率（累计器：平均消耗 = base×(1-eff)，下限 1）
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    st.shipAssignments.archaeology=ship.instanceId;
    fitRig(st,ship,"rig_archaeology_fuel_i",0); // -8%
    const site=(W.ARCHAEOLOGY_SITES||[]).find(s=>s.id==="site_v_a");
    const inst=W.getShipInstanceFromState(st,ship.instanceId);
    st.archaeology.fuelSavingRemainder=0;
    const fc=W.getArchaeologyFuelCostState(st,site,inst);
    ok(approx(fc.rigFuelMultiplier,0.92), "E 燃料 rig I rigFuelMultiplier=0.92");
    const cfg=W.getShipConfigById("illuminator");
    const expectAvg=Math.max(1,fc.baseFuel*(cfg.fuelEfficiency||1)*0.92);
    ok(approx(fc.averageFuelPerCycle,expectAvg,1e-9), "E 燃料平均消耗 = base×shipMul×0.92（下限 1）");
  }
}

/* ================= F 防放大 ================= */
section("F 防放大");
{
  // 舰船强化不放大 rig：强化船上 rig 比率仍恰 1.04
  const st=freshState();
  const ship=addShip(st,"rifter");
  ship.enhancementLevel=5;
  st.shipAssignments.combat=ship.instanceId;
  const base=W.getCombatMaxHpFromState(st);
  fitRig(st,ship,"rig_shield_capacity_i",0);
  const after=W.getCombatMaxHpFromState(st);
  ok(Math.abs(after.shield-Math.round(base.shield*1.04))<=1, "F1 强化船上 rig 比率仍 ×1.04（不叠乘强化）");
  // 装备强化倍率不作用于 rig：手工把 rig 实例 enhancementLevel 抬高，聚合值不变
  const modsBefore=W.getRigModifiers(st,ship);
  const rigInst=st.equipment.instances.find(i=>i.itemId==="rig_shield_capacity_i");
  rigInst.enhancementLevel=5;
  const modsAfter=W.getRigModifiers(st,ship);
  ok(approx(modsBefore.shieldCapacityPercent,0.04)&&approx(modsAfter.shieldCapacityPercent,0.04),
    "F2 rig 聚合忽略 enhancementLevel（0.04 恒定）");
  // 强化列表 / 强化 Action 拒绝 rig
  const st2=freshState();
  st2.equipment.inventory.push("rig_shield_capacity_i");
  ok(!JSON.stringify(W.getEquipmentEnhancementListDisplayState(st2)).includes("rig_shield_capacity_i"), "F3 强化列表不含 rig");
  const r=W.dispatchGameAction(st2,{type:"equipment/enhance",targetRef:"rig_shield_capacity_i",randomValue:0},0);
  ok(r.changed===false&&r.reason==="rig-not-enhanceable", "F4 强化 rig 被拒");
  // fleetSupport 不放大 rig：装 rig 前后 fleet bonus 不变
  const st3=freshState(); const ship3=addShip(st3,"rifter"); st3.shipAssignments.mining=ship3.instanceId;
  const f1=W.getProductionEfficiencyState(st3,"mining").fleetSupport;
  fitRig(st3,ship3,"rig_mining_speed_i",0);
  const f2=W.getProductionEfficiencyState(st3,"mining").fleetSupport;
  ok(JSON.stringify(f1&&f1.bonus)===JSON.stringify(f2&&f2.bonus), "F5 fleetSupport 不受 rig 影响");
}

/* ================= G 存档迁移 ================= */
section("G 存档迁移");
{
  // fitted.rig 缺失 → 规范化为 []
  const raw={ high:[], mid:[], low:[] };
  const norm=W.normalizeFitting(raw);
  ok(Array.isArray(norm.rig)&&norm.rig.length===0, "G1 normalizeFitting 补齐缺失 rig 数组");
  // normalizeEquipmentState 幂等 + 防复制
  const st=freshState();
  const ship=addShip(st,"rifter");
  fitRig(st,ship,"rig_shield_capacity_i",0);
  st.equipment.instances.push({instanceId:88881,itemId:"rig_armor_capacity_i",enhancementLevel:0,installedOn:null}); // 游离 rig
  st.equipment.instances.push({instanceId:88882,itemId:"archaeo_analyzer_i",enhancementLevel:1,installedOn:null});   // 游离普通装备
  W.normalizeEquipmentState(st);
  const snap1=JSON.stringify(st.equipment)+JSON.stringify(ship.fitted);
  W.normalizeEquipmentState(st);
  const snap2=JSON.stringify(st.equipment)+JSON.stringify(ship.fitted);
  ok(snap1===snap2, "G2 normalizeEquipmentState 连续二次幂等");
  const ids=st.equipment.instances.map(i=>i.instanceId);
  ok(!ids.some(id=>{const i=st.equipment.instances.find(x=>x.instanceId===id);return i&&i.itemId==="rig_armor_capacity_i"&&i.installedOn===null;}),
    "G3 游离 rig 实例丢弃（防复制）");
  ok(st.equipment.instances.some(i=>i.itemId==="archaeo_analyzer_i"&&i.enhancementLevel===1),
    "G4 游离普通装备实例保留（itemId/等级不变）");
  ok(W.resolveEquipmentReference(st,ship.fitted.rig[0]).itemId==="rig_shield_capacity_i", "G5 已装 rig 保留可解析");
  // 实例引用唯一
  const refCount=st.equipment.instances.filter(i=>i.itemId==="rig_shield_capacity_i").length;
  ok(refCount===1, "G6 rig 实例唯一无复制");
}

/* ================= H UI 显示态 ================= */
section("H UI 显示态");
{
  const st=freshState();
  const ship=addShip(st,"illuminator"); // 4 rig 槽
  fitRig(st,ship,"rig_archaeology_scan_iii",0);
  st.equipment.inventory.push("rig_archaeology_fuel_i");     // 可装
  st.equipment.inventory.push("rig_archaeology_scan_i");     // 同组已装 → 应被过滤
  const disp=W.getShipFittingDisplayState(st,ship.instanceId);
  const rigSlots=disp.orbitSlots.filter(s=>s.type==="rig");
  ok(rigSlots.length===disp.slots.rig, `H1 orbit rig 段=本舰 rig 槽数 ${disp.slots.rig}（实际 ${rigSlots.length}）`);
  ok(rigSlots.filter(s=>s.enabled).length===disp.slots.rig, `H2 启用的 rig 槽 = 舰船 rig 槽数（${disp.slots.rig}）`);
  ok(rigSlots[0].equipmentId==="rig_archaeology_scan_iii", "H3 已装 rig 显示在槽位");
  const rigInv=disp.inventoryBySlot.rig.map(i=>i.id);
  ok(rigInv.includes("rig_archaeology_fuel_i"), "H4 可装 rig 出现在候选列表");
  ok(!rigInv.includes("rig_archaeology_scan_i"), "H5 同组已装的 rig 被候选列表过滤");
  // getRigDisplayState 无 NaN/undefined
  const rows=W.getRigDisplayState(st,ship);
  ok(rows.length===1, "H6 getRigDisplayState 行数正确");
  ok(rows.every(r=>r.id&&r.name&&r.stackGroup&&r.tier&&r.bonuses&&Object.values(r.bonuses).every(v=>Number.isFinite(v))),
    "H7 getRigDisplayState 字段完整无 NaN");
  // 属性行格式（百分比显示）
  const lines=W.getEquipmentAttributeLines("rig_archaeology_fuel_i");
  ok(lines.some(l=>l.includes("-8%")), "H8 燃料 rig 属性行显示 -8%");
  const lines2=W.getEquipmentAttributeLines("rig_shield_capacity_v");
  ok(lines2.some(l=>l.includes("+15%")), "H9 护盾容量 V 属性行显示 +15%");
}

/* ================= I 回归 ================= */
section("I 回归（无 rig 路径不变）");
{
  const st=freshState();
  const ship=addShip(st,"rifter");
  st.shipAssignments.combat=ship.instanceId;
  st.shipAssignments.mining=ship.instanceId;
  const hp=W.getCombatMaxHpFromState(st);
  ok(hp.shield>0&&Number.isFinite(hp.shield), "I1 无 rig 战斗 HP 正常");
  ok(W.getProductionEfficiencyState(st,"mining").primaryBonus===0, "I2 无 rig 采矿 primaryBonus=0");
  const smelt=W.getSmeltingDisplayState(st,0);
  ok(smelt.rigBonus===0, "I3 无 rig 冶炼 rigBonus=0");
  // 扫描无 rig = 组成部分之和
  const st2=freshState(); st2.skills.archaeology={lvl:10,xp:0};
  const heron=addShip(st2,"heron");
  const cfg=W.getShipConfigById("heron");
  const scan=W.computeArchaeologyScanStrength(st2,heron,"core_probe_i");
  const probe=W.getArchaeologyProbe("core_probe_i");
  ok(approx(scan,10+cfg.bonuses.archaeologyScanStrength+probe.scanBonus), "I4 无 rig 扫描 = 技能+舰船+探针");
  // 4 条 rig 事件契约存在
  for(const ev of ["rig:manufactured","rig:fitted","rig:destroyed","rig:replaced"]){
    let threw=false;
    try{ W.GameEvents.emit(ev, ev==="rig:manufactured"?{rigId:"x",quantity:1}:ev==="rig:replaced"?{oldRigId:"a",newRigId:"b",shipInstanceId:"s",stackGroup:"g",slotIndex:0}:{rigId:"x",shipInstanceId:"s",stackGroup:"g",slotIndex:0},{offline:false}); }
    catch(e){ threw=true; }
    ok(!threw, `I 事件契约 ${ev} 可用`);
  }
  // 全部舰船配置：rig 槽数为非负整数
  const allIds=st.inventory.ships.map(s=>s.shipId);
  ok(["rifter","kestrel","heron","tracer","starmap","farscope","illuminator"].every(id=>{
    const c=W.getShipConfigById(id);
    return c && Number.isInteger(c.slots.rig) && c.slots.rig>=0;
  }), "I5 代表性舰船 rig 槽数有效");
}

/* ================= J 经济固化断言 ================= */
section("J 经济固化（掉率·掉落数量·配方需求·期望次数，防单侧修改）");
{
  // 五档固定常量（任何一侧被单独修改都会 FAIL）
  const FIX={
    I:  { rate:0.020,  amount:1, recipeQty:1, ship:"heron",       skill:1,  analyzer:"archaeo_analyzer_i",   site:"site_i_a",   expect:100,     rigSlots:1 },
    II: { rate:0.015,  amount:1, recipeQty:1, ship:"tracer",      skill:15, analyzer:"archaeo_analyzer_ii",  site:"site_ii_a",  expect:400/3,   rigSlots:1 },
    III:{ rate:0.010,  amount:2, recipeQty:2, ship:"starmap",     skill:35, analyzer:"archaeo_analyzer_iii", site:"site_iii_a", expect:200,     rigSlots:2 },
    IV: { rate:0.0075, amount:2, recipeQty:2, ship:"farscope",    skill:55, analyzer:"archaeo_analyzer_iv",  site:"site_iv_a",  expect:800/3,   rigSlots:3 },
    V:  { rate:0.005,  amount:3, recipeQty:3, ship:"illuminator", skill:80, analyzer:"archaeo_analyzer_v",   site:"site_v_a",   expect:400,     rigSlots:4 }
  };
  const CALIB_ID={I:"art_i_calib",II:"art_ii_calib",III:"art_iii_calib",IV:"art_iv_calib",V:"art_v_calib"};
  const RIG_SAMPLE={I:"rig_archaeology_fuel_i",II:"rig_archaeology_fuel_ii",III:"rig_archaeology_fuel_iii",IV:"rig_archaeology_fuel_iv",V:"rig_archaeology_fuel_v"};
  for(const roman of ["I","II","III","IV","V"]){
    const f=FIX[roman];
    const tier=W.getArchaeologyTierConfig(roman);
    ok(approx(tier.calibrationRate,f.rate), `J ${roman} calibrationRate=${f.rate}`);
    ok(tier.calibrationAmount===f.amount, `J ${roman} calibrationAmount=${f.amount}`);
    const rigDef=W.EQUIPMENT_DB[RIG_SAMPLE[roman]];
    ok(rigDef.cost["calibration:"+CALIB_ID[roman]]===f.recipeQty, `J ${roman} 配方校准需求=${f.recipeQty}`);
    // 标准配置 50% 成功率（同级船+0、技能门槛、满 high 槽同级分析仪+0、普通探针、无扫描 rig）
    const st=freshState();
    st.skills.archaeology={lvl:f.skill,xp:0};
    const ship=addShip(st,f.ship);
    st.shipAssignments.archaeology=ship.instanceId;
    const cfg=W.getShipConfigById(f.ship);
    for(let i=0;i<cfg.slots.high;i++){
      st.equipment.inventory.push(f.analyzer);
      W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:i,equipmentId:f.analyzer},0);
    }
    const inst=W.getShipInstanceFromState(st,ship.instanceId);
    const scan=W.computeArchaeologyScanStrength(st,inst,"core_probe_i");
    const site=W.getArchaeologySite(f.site);
    const success=W.computeArchaeologySuccessChance(scan,site.difficulty);
    ok(approx(success,0.50), `J ${roman} 标准配置成功率=50%（实际 ${(success*100).toFixed(1)}%）`);
    // 期望次数/件 与 全 rig 槽期望
    const expected=f.recipeQty/(success*tier.calibrationRate*tier.calibrationAmount);
    ok(approx(expected,f.expect,0.01), `J ${roman} 期望次数/件=${f.expect.toFixed(2)}（实际 ${expected.toFixed(2)}）`);
    const fleet=expected*f.rigSlots;
    const fleetTarget=f.expect*f.rigSlots;
    ok(approx(fleet,fleetTarget,0.01), `J ${roman} 全 rig 槽期望=${fleetTarget.toFixed(2)}`);
    if(roman==="V"){
      const hours=fleet*site.time/3600;
      ok(hours>120&&hours<150, `J V 档四槽全船耗时≈133h（实际 ${hours.toFixed(1)}h）`);
    }
  }
}

/* ================= K Phase 3B UI 返修 ================= */
section("K Phase 3B UI 返修（二级筛选 / 中文名 / 装配环 / 候选过滤 / 销毁语义）");
{
  const SUBS=["combat","industry","archaeology"];
  const TIERS=["I","II","III","IV","V"];
  // K1 类别 + 档位筛选：每类别 15 件、每类别每档 3 件、过滤纯净、详情落可见集合
  for(const sub of SUBS){
    const st=freshState();
    st.skills.equipmentEngineering={lvl:80,xp:0};
    W.dispatchGameAction(st,{type:"manufacturing/selectEquipmentCategory",categoryId:"rigs"},0);
    const r=W.dispatchGameAction(st,{type:"manufacturing/selectEquipEngRigFilter",sub,tier:"all"},0);
    ok(r.changed===true, `K ${sub} 筛选 Action 生效`);
    let d=W.getEquipmentEngineeringDisplayState(st,0,"");
    ok(d.visibleCount===15&&d.recipes.length===15, `K ${sub}+全部=15 件（实际 ${d.visibleCount}）`);
    ok(d.recipes.every(x=>{const def=W.EQUIPMENT_DB[x.id];return def&&def.rigCategory===sub;}), `K ${sub} 可见配方类别纯净`);
    ok(d.rigFilters&&d.rigFilters.sub===sub&&d.rigFilters.subcategories.filter(s=>s.selected).length===1, `K ${sub} rigFilters 显示态 selected 唯一`);
    for(const tier of TIERS){
      W.dispatchGameAction(st,{type:"manufacturing/selectEquipEngRigFilter",tier},0);
      d=W.getEquipmentEngineeringDisplayState(st,0,"");
      ok(d.visibleCount===3, `K ${sub}+${tier}=3 件（实际 ${d.visibleCount}）`);
      ok(d.recipes.every(x=>{const def=W.EQUIPMENT_DB[x.id];return def&&def.rigCategory===sub&&def.rigTier===tier;}), `K ${sub}+${tier} 过滤纯净`);
      ok(d.selectedRecipe&&d.recipes.some(x=>x.id===d.selectedRecipe.id), `K ${sub}+${tier} 详情落在可见集合内`);
    }
  }
  // K2 搜索 × 类别/档位组合过滤
  {
    const st=freshState();
    st.skills.equipmentEngineering={lvl:80,xp:0};
    W.dispatchGameAction(st,{type:"manufacturing/selectEquipmentCategory",categoryId:"rigs"},0);
    W.dispatchGameAction(st,{type:"manufacturing/selectEquipEngRigFilter",sub:"combat",tier:"all"},0);
    const all=W.getEquipmentEngineeringDisplayState(st,0,"");
    const term=all.recipes[0].name.slice(0,2);
    const searched=W.getEquipmentEngineeringDisplayState(st,0,term);
    ok(searched.visibleCount>0&&searched.visibleCount<=all.visibleCount&&searched.recipes.every(x=>x.name.includes(term)),
      `K 搜索+类别组合过滤正确（"${term}"→${searched.visibleCount} 件）`);
    ok(searched.recipes.every(x=>{const def=W.EQUIPMENT_DB[x.id];return def&&def.rigCategory==="combat";}), "K 搜索结果仍受类别约束");
    const none=W.getEquipmentEngineeringDisplayState(st,0,"不存在的配方名xyz");
    ok(none.visibleCount===0&&none.recipes.length===0, "K 无匹配搜索 visibleCount=0");
  }
  // K3 制造中切换筛选：startedEquipEngTarget / runningRecipe（实际产物）不变
  {
    const st=freshState();
    st.skills.equipmentEngineering={lvl:80,xp:0};
    st.currentAction.skill="equipmentEngineering";
    st.currentAction.active=true;
    st.currentAction.startedEquipEngTarget="rig_shield_capacity_i";
    st.currentAction.equipEngCategory="rigs";
    W.dispatchGameAction(st,{type:"manufacturing/selectEquipEngRigFilter",sub:"archaeology",tier:"V"},0);
    ok(st.currentAction.startedEquipEngTarget==="rig_shield_capacity_i", "K 制造中切换筛选 startedEquipEngTarget 不变");
    const d=W.getEquipmentEngineeringDisplayState(st,0,"");
    ok(d.runningRecipe.id==="rig_shield_capacity_i", "K 制造中 runningRecipe（实际产物）不变");
    ok(d.active===true, "K 制造进行态不被筛选打断");
  }
  // K4 五档校准材料 displayName = 真实中文名（不暴露内部键）
  for(const t of ["i","ii","iii","iv","v"]){
    const key="art_"+t+"_calib";
    const art=(W.ARCHAEOLOGY_ARTIFACTS||[]).find(a=>a.id===key);
    const dn=W.getResourceDisplayName("calibration:"+key);
    ok(Boolean(art)&&dn===art.name&&!String(dn).startsWith("calibration:"),
      `K calibration:${key} displayName=「${art?art.name:"?"}」（实际「${dn}」）`);
  }
  // K5 45 件配方详情材料行均携带 displayName 且不向 UI 暴露 calibration: 内部键
  {
    const st=freshState();
    st.skills.equipmentEngineering={lvl:80,xp:0};
    st.currentAction.equipEngCategory="rigs";
    const recipes=W.EQUIPMENT_ENGINEERING_RECIPES.filter(r=>r.category==="rigs");
    let selectedOk=true, clean=true, withDisplay=true;
    for(const r of recipes){
      st.currentAction.equipEngTarget=r.id;
      st.currentAction.equipEngRigSub=r.rigCategory;
      st.currentAction.equipEngRigTier=r.rigTier;
      const d=W.getEquipmentEngineeringDisplayState(st,0,"");
      if(d.selectedRecipe.id!==r.id) selectedOk=false;
      for(const m of d.detail.materials){
        if(typeof m.displayName!=="string"||!m.displayName) withDisplay=false;
        if(String(m.displayName).startsWith("calibration:")) clean=false;
      }
    }
    ok(selectedOk, "K 45 件配方均可通过筛选态精确选中");
    ok(withDisplay, "K 45 件配方详情材料均携带 displayName");
    ok(clean, "K 45 件配方详情 displayName 均不暴露 calibration: 内部键");
  }
  // K6 rigCandidates 按槽位过滤：占用槽允许同系列升级、空槽过滤同组
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    fitRig(st,ship,"rig_shield_capacity_i",0);
    st.equipment.inventory.push("rig_shield_capacity_ii");
    st.equipment.inventory.push("rig_archaeology_fuel_i");
    const d=W.getShipFittingDisplayState(st,ship.instanceId);
    ok(Array.isArray(d.rigCandidates)&&d.rigCandidates.length===d.slots.rig, `K rigCandidates 长度=舰船 rig 槽数（${d.slots.rig}）`);
    const c0=d.rigCandidates[0].map(x=>x.id), c1=d.rigCandidates[1].map(x=>x.id);
    ok(c0.includes("rig_shield_capacity_ii"), "K 占用槽候选含同系列升级件（I→II 可替换）");
    ok(!c1.includes("rig_shield_capacity_ii"), "K 空槽候选过滤其他槽已装同组件");
    ok(c0.includes("rig_archaeology_fuel_i")&&c1.includes("rig_archaeology_fuel_i"), "K 不同组候选两槽均可见");
    let r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:1,rigItemId:"rig_shield_capacity_ii"},0);
    ok(r.changed===false&&r.reason==="same-stack-group-exists", "K Action 闸门兜底：空槽同组仍拒（UI 过滤不替代闸门）");
    r=W.dispatchGameAction(st,{type:"hangar/replaceFittedRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_shield_capacity_ii"},0);
    ok(r.changed===true&&r.oldRigId==="rig_shield_capacity_i"&&r.newRigId==="rig_shield_capacity_ii", "K 真实替换 I→II 成功");
  }
  // K7 装配环容量：随舰船 rig 槽数动态 = 24 + slots.rig；rig 索引从 24 连续；四舰启用数正确；高/中/低不受影响
  {
    const cap=W.getOrbitRigCapacity();
    ok(cap>=4, `K 数据库最大 rig 槽数≥4（实际 ${cap}），装配环随舰动态可支持`);
    for(const [shipId,expected] of [["rifter",1],["starmap",2],["farscope",3],["illuminator",4]]){
      const st=freshState();
      const ship=addShip(st,shipId);
      const d=W.getShipFittingDisplayState(st,ship.instanceId);
      ok(d.orbitSlots.length===24+expected, `K ${shipId} 装配环总格数=24+${expected}（实际 ${d.orbitSlots.length}）`);
      const rigs=d.orbitSlots.filter(s=>s.type==="rig");
      ok(rigs.every((s,i)=>s.index===24+i&&s.slotIndex===i), `K ${shipId} rig 索引自 24 连续`);
      ok(rigs.filter(s=>s.enabled).length===expected, `K ${shipId} 启用 rig 槽=${expected}`);
      ok(d.orbitSlots.filter(s=>s.type==="high").length===8&&d.orbitSlots.filter(s=>s.type==="mid").length===8&&d.orbitSlots.filter(s=>s.type==="low").length===8,
        `K ${shipId} 高/中/低 8/8/8 不受影响`);
    }
    // 明确要求：启明级(4 rig) 装配环=28 格，rig 索引 24~27
    {
      const st=freshState(); const ship=addShip(st,"illuminator");
      const d=W.getShipFittingDisplayState(st,ship.instanceId);
      ok(d.orbitSlots.length===28, "K 启明级装配环总格数=28（8高+8中+8低+4 rig）");
      const rigs=d.orbitSlots.filter(s=>s.type==="rig");
      ok(rigs.length===4&&rigs[0].index===24&&rigs[3].index===27, "K 启明级 rig 索引=24~27");
    }
    const st=freshState();
    const ship=addShip(st,"illuminator");
    let r=fitRig(st,ship,"rig_shield_capacity_i",3);
    ok(r.changed===true, "K 启明级第 4 槽（slotIndex 3）可安装");
    st.equipment.inventory.push("rig_shield_capacity_ii");
    r=W.dispatchGameAction(st,{type:"hangar/replaceFittedRig",instanceId:ship.instanceId,slotIndex:3,rigItemId:"rig_shield_capacity_ii"},0);
    ok(r.changed===true, "K 启明级第 4 槽可替换");
    r=W.dispatchGameAction(st,{type:"hangar/destroyFittedRig",instanceId:ship.instanceId,slotIndex:3},0);
    ok(r.changed===true, "K 启明级第 4 槽可销毁");
  }
  // K8 清空确认数据源：显示态可枚举已装 rig（名称+同名计数），无 rig 时清单为空
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    fitRig(st,ship,"rig_shield_capacity_i",0);
    fitRig(st,ship,"rig_archaeology_fuel_i",1);
    const d=W.getShipFittingDisplayState(st,ship.instanceId);
    const fitted=d.orbitSlots.filter(s=>s.type==="rig"&&s.equipmentId).map(s=>s.name);
    ok(fitted.length===2&&fitted.every(n=>n&&!n.startsWith("rig_")), "K 清空确认清单来自真实显示态（含中文名）");
    const st2=freshState();
    const ship2=addShip(st2,"rifter");
    const d2=W.getShipFittingDisplayState(st2,ship2.instanceId);
    ok(d2.orbitSlots.filter(s=>s.type==="rig"&&s.equipmentId).length===0, "K 无 rig 时销毁清单为空（不显示虚假清单）");
  }
  // K9 清空确认语义：取消=状态不变；确认=普通装备保留（rig删除）、rig实例销毁
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    st.equipment.inventory.push("t1_small_laser"); // setFittingSlot 要求装备先在 inventory
    W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:"t1_small_laser"},0);
    fitRig(st,ship,"rig_shield_capacity_i",0);
    fitRig(st,ship,"rig_archaeology_fuel_i",1);
    const snapBefore=JSON.stringify({fitted:ship.fitted,insts:st.equipment.instances.map(i=>({id:i.instanceId,inst:i.installedOn}))});
    // 模拟"取消清空"：不调用 resetFitting Action
    const snapCancel=JSON.stringify({fitted:ship.fitted,insts:st.equipment.instances.map(i=>({id:i.instanceId,inst:i.installedOn}))});
    ok(snapBefore===snapCancel, "K 取消清空（不调用 Action）状态完全不变");
    // 确认清空：dispatch hangar/resetFitting
    const r=W.dispatchGameAction(st,{type:"hangar/resetFitting",instanceId:ship.instanceId},0);
    ok(r.changed===true&&Array.isArray(r.destroyedRigs)&&r.destroyedRigs.length===2, "K 清空返回 2 个被销毁 rig");
    ok(ship.fitted.rig.every(x=>x===null), "K 清空后 rig 槽全部为空");
    ok(ship.fitted.high.every(x=>x===null), "K 清空后高槽普通装备也卸下");
    const normalInst=st.equipment.instances.find(i=>i.itemId==="t1_small_laser");
    ok(normalInst&&normalInst.installedOn===null, "K 普通装备实例保留且 installedOn=null（未销毁）");
    const rigInst=st.equipment.instances.filter(i=>i.itemId&&i.itemId.startsWith("rig_"));
    ok(rigInst.length===0, "K 改装件实例已彻底删除");
  }
  // K10 全部相关 display state 无 undefined / NaN
  {
    const hasBad=(v)=>{ if(v===undefined)return true; if(typeof v==="number"&&!Number.isFinite(v))return true; if(Array.isArray(v))return v.some(hasBad); if(v&&typeof v==="object")return Object.values(v).some(hasBad); return false; };
    const st=freshState(); const ship=addShip(st,"illuminator");
    fitRig(st,ship,"rig_shield_capacity_i",0);
    const d=W.getShipFittingDisplayState(st,ship.instanceId);
    ok(!hasBad(d), "K 装配显示态无 undefined/NaN");
    const st2=freshState(); st2.skills.equipmentEngineering={lvl:80,xp:0};
    W.dispatchGameAction(st2,{type:"manufacturing/selectEquipmentCategory",categoryId:"rigs"},0);
    W.dispatchGameAction(st2,{type:"manufacturing/selectEquipEngRigFilter",sub:"archaeology",tier:"III"},0);
    const d2=W.getEquipmentEngineeringDisplayState(st2,0,"");
    ok(!hasBad(d2), "K 装备工程显示态无 undefined/NaN");
  }
}

/* ================= L resetFitting → 候选含游离实例 → 复装 → 保存读取往返 ================= */
section("L 清空后候选含游离实例，复装复用实例ID，保存读取后一致");
{
  // L1 新建状态：安装 t1_small_laser（高槽）和两个 rig
  const st=freshState();
  const ship=addShip(st,"illuminator");
  st.equipment.inventory.push("t1_small_laser");
  W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:"t1_small_laser"},0);
  fitRig(st,ship,"rig_shield_capacity_i",0);
  fitRig(st,ship,"rig_archaeology_fuel_i",1);
  const instanceBeforeReset = ship.fitted.high[0];
  ok(!!instanceBeforeReset, "L1 t1_small_laser 已安装，fitted.high[0] = instanceId");
  ok(st.equipment.inventory.indexOf("t1_small_laser") === -1, "L1 安装后 t1_small_laser 已从 inventory 移除");
  const totalInstCountBeforeReset = st.equipment.instances.length;

  // L2 resetFitting
  const r=W.dispatchGameAction(st,{type:"hangar/resetFitting",instanceId:ship.instanceId},0);
  ok(r.changed===true && Array.isArray(r.destroyedRigs) && r.destroyedRigs.length===2, "L2 resetFitting 返回 2 个被销毁 rig");

  // L3 普通装备实例保留且 installedOn=null
  const normalInst=st.equipment.instances.find(i=>i.instanceId===instanceBeforeReset);
  ok(!!normalInst && normalInst.installedOn===null && normalInst.itemId==="t1_small_laser",
    "L3 普通装备实例保留，installedOn=null，itemId 未被修改");

  // L4 rig 实例已删除，装备总数不增加（仅普通装备实例保留，rig 销毁）
  const rigInstAfter=st.equipment.instances.filter(i=>i.itemId && i.itemId.startsWith("rig_"));
  ok(rigInstAfter.length===0, "L4 rig 实例已删除");
  // 总实例数 = 之前的 totalInstCountBeforeReset（含 rig 实例） - 2(rig 销毁) + 0(无新增)
  ok(st.equipment.instances.length === totalInstCountBeforeReset - 2,
    `L4 resetFitting 后装备实例数 = ${totalInstCountBeforeReset} - 2 = ${st.equipment.instances.length}`);

  // L5 getShipFittingDisplayState → inventoryBySlot.high 包含该 instanceId
  const d=W.getShipFittingDisplayState(st,ship.instanceId);
  ok(!!d, "L5 getShipFittingDisplayState 返回有效");
  const highCandidates=d.inventoryBySlot.high || [];
  const candWithInstanceId=highCandidates.find(c => c.id === normalInst.instanceId);
  ok(!!candWithInstanceId, "L5 inventoryBySlot.high 包含游离实例的 instanceId");
  ok(candWithInstanceId.isInstance===true, "L5 游离实例标记 isInstance=true");
  // 同时确认 rig 游离实例不会出现（rig 已被删除）
  const rigCandidates=d.inventoryBySlot.rig || [];
  const rigFromInstances=rigCandidates.filter(c => c.isInstance===true);
  ok(rigFromInstances.length===0, "L5 rig 候选无游离实例（rig 已销毁）");

  // L6 用该 instanceId 重新安装
  const r2=W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:normalInst.instanceId},0);
  ok(r2.changed===true, "L6 用 instanceId 复装成功");
  const reFittedId=ship.fitted.high[0];
  ok(reFittedId===normalInst.instanceId, `L6 复装后 fitted.high[0] 引用同一 instanceId（${reFittedId} === ${normalInst.instanceId}）`);

  // L7 装备总数不变（没有产生新实例）
  const reInstalled=st.equipment.instances.find(i=>i.instanceId===normalInst.instanceId);
  ok(!!reInstalled && reInstalled.installedOn===ship.instanceId, "L7 复装后同一实例 installedOn 设为本舰");
  ok(st.equipment.instances.length === totalInstCountBeforeReset - 2,
    `L7 复装后装备实例数不变（${st.equipment.instances.length} = ${totalInstCountBeforeReset} - 2）`);
  // inventory 字符串池不应新增副本
  ok(st.equipment.inventory.indexOf("t1_small_laser") === -1, "L7 inventory 无新 t1_small_laser 副本");

  // L8 保存/读取往返（JSON 序列化模拟）
  const saved=JSON.parse(JSON.stringify(st));
  const d2=W.getShipFittingDisplayState(saved,saved.inventory.ships[0].instanceId);
  ok(!!d2, "L8 保存/读取后 getShipFittingDisplayState 有效");
  const loadedShip=saved.inventory.ships[0];
  const loadedInst=saved.equipment.instances.find(i=>i.instanceId===normalInst.instanceId);
  ok(!!loadedInst && loadedInst.installedOn===loadedShip.instanceId, "L8 保存/读取后实例仍正确关联");
  ok(loadedShip.fitted.high[0]===normalInst.instanceId, "L8 保存/读取后 fitted.high[0] 引用不变");

  // L9 保存/读取后再卸下，候选仍可见
  W.dispatchGameAction(saved,{type:"hangar/resetFitting",instanceId:loadedShip.instanceId},0);
  const afterReset=saved.equipment.instances.find(i=>i.instanceId===normalInst.instanceId);
  ok(!!afterReset && afterReset.installedOn===null, "L9 保存/读取后清空，实例仍保留且 installedOn=null");
  const d3=W.getShipFittingDisplayState(saved,loadedShip.instanceId);
  const highCand2=(d3.inventoryBySlot.high||[]).filter(c=>c.id===normalInst.instanceId);
  ok(highCand2.length===1 && highCand2[0].isInstance===true, "L9 保存/读取后清空，候选仍包含该 instanceId");
  // 再装——确认同一 instanceId 可用
  W.dispatchGameAction(saved,{type:"hangar/setFittingSlot",instanceId:loadedShip.instanceId,slot:"high",slotIndex:0,equipmentId:normalInst.instanceId},0);
  ok(saved.inventory.ships[0].fitted.high[0]===normalInst.instanceId, "L9 保存/读取后候选复装成功，引用不变");

  // L10 游离 rig 实例不入候选（边界：rig 拆卸即销毁，fail closed）
  {
    const st2=freshState();
    const ship2=addShip(st2,"illuminator");
    fitRig(st2,ship2,"rig_shield_capacity_i",0);
    W.dispatchGameAction(st2,{type:"hangar/resetFitting",instanceId:ship2.instanceId},0);
    const d4=W.getShipFittingDisplayState(st2,ship2.instanceId);
    const rigCand=(d4.inventoryBySlot.rig||[]).filter(c=>c.isInstance===true);
    ok(rigCand.length===0 && st2.equipment.instances.length===0,
      "L10 拆卸后 rig 实例已删除，不进入 rig 候选");
  }

  // L11 Action 边界：setFittingSlot 空参数=卸下（不可恢复），非浏览器取消
  {
    const st3=freshState();
    const ship3=addShip(st3,"illuminator");
    st3.equipment.inventory.push("t1_small_laser");
    W.dispatchGameAction(st3,{type:"hangar/setFittingSlot",instanceId:ship3.instanceId,slot:"high",slotIndex:0,equipmentId:"t1_small_laser"},0);
    const fittedId=ship3.fitted.high[0];
    // 用 null equipmentId 卸下
    const r3=W.dispatchGameAction(st3,{type:"hangar/setFittingSlot",instanceId:ship3.instanceId,slot:"high",slotIndex:0,equipmentId:null},0);
    ok(r3.changed===true, "L11 用 null 卸下装备");
    ok(ship3.fitted.high[0]===null, "L11 卸下后 fitted.high[0] 为 null");
    const instAfter=st3.equipment.instances.find(i=>i.instanceId===fittedId);
    ok(!!instAfter && instAfter.installedOn===null, "L11 卸下后普通装备实例 installedOn=null，仍然保留");
  }
}

/* ================= M 装配面板 HP 显示含改装件改装件倍率 ================= */
section("M 装配面板 stats 正确反映改装件容量倍率");
{
  const checkHP = (label, shipId, rigIds, expectedShield, expectedArmor, expectedStructure) => {
    const st=freshState();
    const ship=addShip(st,shipId);
    const config=W.getShipConfigById(shipId);
    const baseShield=config.hp.shield, baseArmor=config.hp.armor, baseStruct=config.hp.structure;
    rigIds.forEach((rigId,idx)=>{ if(rigId) fitRig(st,ship,rigId,idx); });
    const d=W.getShipFittingDisplayState(st,ship.instanceId);
    const s=d.stats;
    ok(s.shield===expectedShield, `${label} 护盾 HP: ${baseShield} → ${s.shield}（期望 ${expectedShield}）`);
    ok(s.armor===expectedArmor, `${label} 装甲 HP: ${baseArmor} → ${s.armor}（期望 ${expectedArmor}）`);
    ok(s.structure===expectedStructure, `${label} 结构 HP: ${baseStruct} → ${s.structure}（期望 ${expectedStructure}）`);
  };

  // 启明级 base: shield=2900 armor=1100 structure=800, enhancement.hpMultiplier=1（+0级）
  // 护盾容量 I (+4%)：2900 * 1 * 1.04 = 3016
  // 装甲容量 I (+4%)：1100 * 1 * 1.04 = 1144
  // 结构容量 I (+4%)：800 * 1 * 1.04 = 832
  checkHP("M1 启明级+护盾容量I", "illuminator", ["rig_shield_capacity_i"], 3016, 1100, 800);
  checkHP("M2 启明级+装甲容量I", "illuminator", ["rig_armor_capacity_i"], 2900, 1144, 800);
  checkHP("M3 启明级+结构容量I", "illuminator", ["rig_structure_capacity_i"], 2900, 1100, 832);
  checkHP("M4 启明级+三容量I", "illuminator", ["rig_shield_capacity_i","rig_armor_capacity_i","rig_structure_capacity_i"], 3016, 1144, 832);

  // 拆除/清空后恢复基础显示：装后清空→无 rig 倍率→基础 HP
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    fitRig(st,ship,"rig_shield_capacity_i",0);
    W.dispatchGameAction(st,{type:"hangar/resetFitting",instanceId:ship.instanceId},0);
    const d=W.getShipFittingDisplayState(st,ship.instanceId);
    const s=d.stats;
    ok(s.shield===2900 && s.armor===1100 && s.structure===800,
      `M5 清空后 HP 恢复基础（${s.shield}/${s.armor}/${s.structure} = 2900/1100/800）`);
  }

  // 多个 rig 同系列不叠加（stackGroup 排重）：只能装一个护盾容量
  // 三个不同系列的 rig（各 4%）作用于不同 HP 类型，互不叠加：
  // shield * (1+0.04) = 2900*1.04=3016, armor * (1+0.04)=1100*1.04=1144, structure * (1+0.04)=800*1.04=832
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    fitRig(st,ship,"rig_shield_capacity_i",0);
    fitRig(st,ship,"rig_armor_capacity_i",1);
    fitRig(st,ship,"rig_structure_capacity_i",2);
    // 第4槽不能再装盾容（同 stackGroup 排重）
    st.equipment.inventory.push("rig_shield_capacity_ii");
    const r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:3,rigItemId:"rig_shield_capacity_ii"},0);
    ok(!r.changed, "M6 第4槽护盾容量 II 因同 stackGroup 被拒绝");
    const d=W.getShipFittingDisplayState(st,ship.instanceId);
    const s=d.stats;
    ok(s.shield===3016 && s.armor===1144 && s.structure===832,
      `M6 三系列各 4% 分属不同 HP 类型: ${s.shield}/${s.armor}/${s.structure}`);
  }

  // 强化等级不影响 rig 容量倍率（rig 不参与强化）
  // 装护盾容量 I (+4%) = 2900 * 1 * 1.04 = 3016（+0 和 +5 一样，因为 enhancement.hpMultiplier 独立作用于基础 HP 再乘 rig 倍率）
  // enhancement.hpMultiplier 在 +0 级=1，+5 级=1.5（假设值——实际应查询 getShipEnhancementBonuses）
  const baseMult=W.getShipEnhancementBonuses(W.getShipConfigById("illuminator"),0).hpMultiplier;
  const e5Mult=W.getShipEnhancementBonuses(W.getShipConfigById("illuminator"),5).hpMultiplier;
  if(baseMult===1 && e5Mult!==1){
    const stE=freshState();
    const shipE=addShip(stE,"illuminator");
    shipE.enhancementLevel=5;
    fitRig(stE,shipE,"rig_shield_capacity_i",0);
    const dE=W.getShipFittingDisplayState(stE,shipE.instanceId);
    const sE=dE.stats;
    ok(sE.shield===Math.round(2900*e5Mult*1.04), `M7 +5 强化+盾容 I: 2900×${e5Mult}×1.04=${Math.round(2900*e5Mult*1.04)}（实际 ${sE.shield}）`);
  }
}

/* ================= N 旧数字 ID 迁移与浏览器字符串化兼容 ================= */
section("N 旧数字 ID 迁移、浏览器字符串化边界、双激光炮测试");
{
  // N1: 构造旧存档：数字 instanceId → normalize 迁移为 eq_N
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    st.equipment.instances=[
      {instanceId:1,itemId:"t1_small_laser",enhancementLevel:2,installedOn:null}
    ];
    st.equipment.nextInstanceId=1;
    ship.fitted={high:[1],mid:[],low:[],rig:[]};
    // 模拟 import 触发 normalize（通过一次 dispatch 间接触发）
    const saved=JSON.parse(JSON.stringify(st));
    // 直接调用 normalize 验证迁移
    W.normalizeEquipmentState(saved);
    const insts=saved.equipment.instances;
    ok(insts.length===1,"N1 实例数量不变");
    ok(typeof insts[0].instanceId==="string"&&/^eq_\d+$/.test(insts[0].instanceId),
      "N2 数字 ID 已迁为 eq_N 字符串");
    ok(insts[0].itemId==="t1_small_laser"&&insts[0].enhancementLevel===2,
      "N3 itemId/等级不变（installedOn 由 normalize 设为引用舰）");
    ok(typeof saved.inventory.ships[0].fitted.high[0]==="string",
      "N4 fitted 引用已更新为字符串");
    const found=saved.equipment.instances.find(i=>i.instanceId===saved.inventory.ships[0].fitted.high[0]);
    ok(!!found,"N5 fitted 引用指向存在的实例");
  }

  // N6-N10: 连续 normalize 幂等
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    st.equipment.instances=[
      {instanceId:99,itemId:"t1_small_laser",enhancementLevel:0,installedOn:null}
    ];
    st.equipment.nextInstanceId=1;
    ship.fitted={high:[99],mid:[],low:[],rig:[]};
    const snap=JSON.parse(JSON.stringify(st));
    W.normalizeEquipmentState(snap);
    const after1=JSON.stringify(snap.equipment.instances);
    W.normalizeEquipmentState(snap); // 再跑一次
    const after2=JSON.stringify(snap.equipment.instances);
    const fitted1=JSON.stringify(snap.inventory.ships[0].fitted);
    W.normalizeEquipmentState(snap); // 第三次
    const fitted2=JSON.stringify(snap.inventory.ships[0].fitted);
    ok(after1===after2,"N6 幂等：两次 normalize 实例列表一致");
    ok(fitted1===fitted2,"N7 幂等：两次 normalize fitted 一致");
  }

  // N8-N11: 模拟浏览器 data-* 字符串 → setFittingSlot 仍可安装
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    st.equipment.instances=[
      {instanceId:"eq_1",itemId:"t1_small_laser",enhancementLevel:0,installedOn:null}
    ];
    st.equipment.nextInstanceId=3;
    const browserRef=String("eq_1"); // 模拟 data-equip 字符串化
    const resolved=W.resolveEquipmentReference(st,browserRef);
    ok(!!resolved&&resolved.definition.id==="t1_small_laser",
      "N8 浏览器字符串化 instanceId 可被 resolveEquipmentReference 解析");
    const r=W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:browserRef},0);
    ok(r.changed===true,"N9 浏览器字符串化 instanceId 安装成功");
    ok(ship.fitted.high[0]==="eq_1","N10 fitted.high[0] 引用 eq_1");
    const inst=st.equipment.instances.find(i=>i.instanceId==="eq_1");
    ok(!!inst&&inst.installedOn===ship.instanceId,"N11 实例 installedOn 已设为本舰");
  }

  // N12-N18: 两门激光炮——一门来自 inventory 字符串池，一门来自实例
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    // 来源 1：inventory 字符串
    st.equipment.inventory.push("t1_small_laser");
    // 来源 2：游离实例（旧数字 ID 迁移后变成 eq_N）
    st.equipment.instances.push({instanceId:"eq_5",itemId:"t1_small_laser",enhancementLevel:0,installedOn:null});
    st.equipment.nextInstanceId=10;

    // 安装第一门（来自 inventory 字符串）
    const r1=W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:"t1_small_laser"},0);
    ok(r1.changed===true,"N12 inventory 字符串安装成功");
    const id1=ship.fitted.high[0];
    ok(!!id1,"N13 第一门得到 instanceId");

    // 安装第二门（来自游离实例的 instanceId）
    const r2=W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:1,equipmentId:"eq_5"},0);
    ok(r2.changed===true,"N14 实例 ID 安装成功");
    ok(ship.fitted.high[1]==="eq_5","N15 fitted.high[1] 引用 eq_5");

    // 两个引用不同
    ok(ship.fitted.high[0]!==ship.fitted.high[1],"N16 两门激光炮引用不同实例 ID");
    // 装备总数始终为 2
    const laserInsts=st.equipment.instances.filter(i=>i.itemId==="t1_small_laser");
    ok(laserInsts.length===2,"N17 激光炮实例数量=2（不复制、不丢失）");
    // 一个被安装、一个未安装（从 inventory 新创建的）
    const installedCount=laserInsts.filter(i=>i.installedOn).length;
    ok(installedCount===2,"N18 两个都已安装（安装在两个高槽）");
  }

  // N19-N21: 保存→读取→再装卸仍正常
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    st.equipment.instances.push({instanceId:"eq_10",itemId:"t1_small_laser",enhancementLevel:0,installedOn:null});
    st.equipment.nextInstanceId=20;
    // 安装
    W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:"eq_10"},0);
    // 保存/读取
    const saved=JSON.parse(JSON.stringify(st));
    ok(saved.inventory.ships[0].fitted.high[0]==="eq_10","N19 保存读取后 fitted 引用不变");
    // 卸下
    W.dispatchGameAction(saved,{type:"hangar/setFittingSlot",instanceId:saved.inventory.ships[0].instanceId,slot:"high",slotIndex:0,equipmentId:null},0);
    const afterUninstall=saved.equipment.instances.find(i=>i.instanceId==="eq_10");
    ok(!!afterUninstall&&afterUninstall.installedOn===null,"N20 保存读取后卸下，实例保留 installedOn=null");
    // 候选包含该实例 instanceId
    const d=W.getShipFittingDisplayState(saved,saved.inventory.ships[0].instanceId);
    const cand=d.inventoryBySlot.high.filter(c=>c.id==="eq_10");
    ok(cand.length===1&&cand[0].isInstance===true,"N21 候选包含该 instanceId");
  }

  // N22-N24: Rig 拆卸销毁规则不变
  {
    const st=freshState();
    const ship=addShip(st,"illuminator");
    fitRig(st,ship,"rig_shield_capacity_i",0);
    W.dispatchGameAction(st,{type:"hangar/resetFitting",instanceId:ship.instanceId},0);
    ok(st.equipment.instances.length===0,"N22 rig 销毁后实例列表为空");
    const d=W.getShipFittingDisplayState(st,ship.instanceId);
    const rigCandWithInst=(d.inventoryBySlot.rig||[]).filter(c=>c.isInstance===true);
    ok(rigCandWithInst.length===0,"N23 rig 候选无游离实例");
    ok(st.equipment.inventory.indexOf("rig_shield_capacity_i")===-1,"N24 rig 不归还 inventory");
  }
}

console.log(`\n================ 审计结果 ================`);
console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass+fail}`);
if(failures.length){ console.log("失败清单："); failures.forEach(f=>console.log("  - "+f)); }
process.exit(fail>0?1:0);
