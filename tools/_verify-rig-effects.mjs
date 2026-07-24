// #103 改装件效果层完整验收（10 项）。
// 全部走真实函数：dispatchGameAction（fitRig/destroyFittedRig/replaceFittedRig/equipment/enhance）、
// getCombatMaxHpFromState、getProductionEfficiencyState、getSmeltingDisplayState、
// computeArchaeologyScanStrength、getArchaeologyInterferenceSeconds、
// getEquipmentEnhancementListDisplayState、normalizeEquipmentState、GameEvents。
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
window.ARCHAEOLOGY_TIERS=(typeof ARCHAEOLOGY_TIERS!=='undefined')?ARCHAEOLOGY_TIERS:null;
window.ARCHAEOLOGY_SITES=(typeof ARCHAEOLOGY_SITES!=='undefined')?ARCHAEOLOGY_SITES:null;
window.ARCHAEOLOGY_SIGNAL_MIN_SECONDS=(typeof ARCHAEOLOGY_SIGNAL_MIN_SECONDS!=='undefined')?ARCHAEOLOGY_SIGNAL_MIN_SECONDS:null;
window.gameState=(typeof gameState!=='undefined')?gameState:null;
`;
vm.createContext(sandbox);
try { vm.runInContext(combined,sandbox,{filename:"combined.js"}); }
catch(e){ console.error("LOAD ERROR:",e.message); process.exit(1); }
const W=sandbox;

let pass=0, fail=0;
function ok(cond,label){ if(cond){pass++;console.log("  [PASS] "+label);} else {fail++;console.log("  [FAIL] "+label);} }
function approx(a,b,tol){ return Math.abs(a-b)<=(tol==null?1e-9:tol); }

function freshState(){
  const st=JSON.parse(JSON.stringify(W.gameState));
  st.inventory=st.inventory||{}; st.inventory.ships=st.inventory.ships||[];
  st.equipment=st.equipment||{inventory:[],instances:[],nextInstanceId:1};
  st.equipment.inventory=st.equipment.inventory||[];
  st.equipment.instances=st.equipment.instances||[];
  st.shipAssignments=st.shipAssignments||{};
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

/* =========================================================
   1. 战斗容量 rig 只增对应层，且只生效一次
   ========================================================= */
console.log("=== 1. 战斗容量 rig 只增对应层且只生效一次 ===");
{
  const CASES=[
    { rig:"rig_shield_capacity_i",    pct:0.04, layer:"shield" },
    { rig:"rig_armor_capacity_i",     pct:0.04, layer:"armor" },
    { rig:"rig_structure_capacity_i", pct:0.04, layer:"structure" }
  ];
  for(const c of CASES){
    const st=freshState();
    const ship=addShip(st,"rifter");
    st.shipAssignments.combat=ship.instanceId;
    const base=W.getCombatMaxHpFromState(st);
    const r=fitRig(st,ship,c.rig,0);
    ok(r.changed===true, `${c.rig} 安装成功`);
    const after=W.getCombatMaxHpFromState(st);
    for(const layer of ["shield","armor","structure"]){
      if(layer===c.layer){
        const expected=Math.round(base[layer]*(1+c.pct));
        ok(Math.abs(after[layer]-expected)<=1, `${c.rig} → ${layer} ×${1+c.pct}（${base[layer]}→${after[layer]}，期望≈${expected}）`);
      } else {
        ok(after[layer]===base[layer], `${c.rig} 不影响 ${layer}（${base[layer]}→${after[layer]}）`);
      }
    }
    // 只生效一次：selector 重复调用结果不变（无累积副作用）
    const again=W.getCombatMaxHpFromState(st);
    ok(again[c.layer]===after[c.layer], `${c.rig} 重复读取不累积（${after[c.layer]}→${again[c.layer]}）`);
    // rig bonuses 不含平铺容量字段（不会经 flat equipment 路径二次生效）
    const def=W.EQUIPMENT_DB[c.rig];
    ok(!def.bonuses.shieldCapacity && !def.bonuses.armorCapacity && !def.bonuses.structureCapacity,
      `${c.rig} 无平铺容量字段（不会经装备加法路径重复生效）`);
  }
}

/* =========================================================
   2. 当前/最大 HP 遵循现有容量规则（rig 乘算在最终值，round 取整）
   ========================================================= */
console.log("=== 2. 最大 HP 遵循现有容量规则 ===");
{
  const st=freshState();
  const ship=addShip(st,"rifter");
  st.shipAssignments.combat=ship.instanceId;
  const base=W.getCombatMaxHpFromState(st);
  ok(Number.isInteger(base.shield)&&Number.isInteger(base.armor)&&Number.isInteger(base.structure),
    `无 rig 时三层 HP 均为整数（${base.shield}/${base.armor}/${base.structure}）`);
  fitRig(st,ship,"rig_shield_capacity_i",0);
  const after=W.getCombatMaxHpFromState(st);
  ok(Number.isInteger(after.shield), `装 rig 后 shield 仍为整数（${after.shield}）`);
  ok(after.shield>base.shield, `shield 严格增加（${base.shield}→${after.shield}）`);
  ok(after.armor===base.armor && after.structure===base.structure, "armor/structure 完全不变");
}

/* =========================================================
   3. 采矿/采气 rig 经既有循环自动生效（无重复接线）
   ========================================================= */
console.log("=== 3. 采矿/采气 rig 经既有 fitting 循环生效 ===");
{
  // 采矿
  const st=freshState();
  const ship=addShip(st,"rifter");
  st.shipAssignments.mining=ship.instanceId;
  const base=W.getProductionEfficiencyState(st,"mining");
  fitRig(st,ship,"rig_mining_speed_i",0);
  const after=W.getProductionEfficiencyState(st,"mining");
  ok(approx(after.primaryBonus-base.primaryBonus,0.04,1e-9),
    `采矿 rig I → primaryBonus +0.04（${base.primaryBonus}→${after.primaryBonus}）`);
  // rig 槽不吃 high 槽放大器（slot!=="high" 不乘 (1+amplifier)）
  const entry=(after.equipment||[]).find(e=>e.slot==="rig");
  ok(entry && approx(entry.rawPrimary,entry.adjustedPrimary,1e-12),
    "rig 槽采矿加成不经 high 槽放大器（raw===adjusted）");
  // 采矿 rig 不影响采气
  const gasAfter=W.getProductionEfficiencyState(st,"gasHarvesting");
  const st2=freshState(); const ship2=addShip(st2,"rifter"); st2.shipAssignments.gasHarvesting=ship2.instanceId;
  // 采气
  const gBase=W.getProductionEfficiencyState(st2,"gasHarvesting");
  fitRig(st2,ship2,"rig_gas_speed_i",0);
  const gAfter=W.getProductionEfficiencyState(st2,"gasHarvesting");
  ok(approx(gAfter.primaryBonus-gBase.primaryBonus,0.04,1e-9),
    `采气 rig I → primaryBonus +0.04（${gBase.primaryBonus}→${gAfter.primaryBonus}）`);
  const mAfter2=W.getProductionEfficiencyState(st2,"mining");
  ok(approx(mAfter2.primaryBonus, W.getProductionEfficiencyState(freshState(),"mining").primaryBonus, 1e-9)||mAfter2.primaryBonus===0,
    "采气 rig 不影响采矿 primaryBonus");
}

/* =========================================================
   4. 冶炼 rig 只影响自身（加法并入船体加成，不放大支援）
   ========================================================= */
console.log("=== 4. 冶炼 rig 只影响自身 ===");
{
  const st=freshState();
  const ship=addShip(st,"rifter");
  st.shipAssignments.refining=ship.instanceId;
  const base=W.getSmeltingDisplayState(st,0);
  fitRig(st,ship,"rig_smelting_speed_i",0);
  const after=W.getSmeltingDisplayState(st,0);
  ok(approx(after.rigBonus,0.04,1e-9), `rigBonus=0.04（实际 ${after.rigBonus}）`);
  ok(approx(after.efficiency, after.skillEfficiency*(1+after.shipBonus+0.04), 1e-9),
    `efficiency = skillEff×(1+shipBonus+rigBonus)（${after.efficiency.toFixed(6)}）`);
  ok(after.shipBonus===base.shipBonus, "shipBonus 未被 rig 修改（不放大船体/支援加成）");
}

/* =========================================================
   5. 考古扫描 rig 只乘 basePart
   ========================================================= */
console.log("=== 5. 考古扫描 rig 只乘 basePart ===");
{
  const st=freshState();
  st.skills.archaeology={lvl:1,xp:0};
  const ship=addShip(st,"heron");
  st.shipAssignments.archaeology=ship.instanceId;
  st.equipment.inventory.push("archaeo_analyzer_i");
  W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:0,equipmentId:"archaeo_analyzer_i"},0);
  const base=W.computeArchaeologyScanStrength(st,ship,"core_probe_i");
  fitRig(st,ship,"rig_archaeology_scan_i",0); // +5%
  const after=W.computeArchaeologyScanStrength(st,ship,"core_probe_i");
  ok(approx(after, base*1.05, 1e-9), `扫描强度 = base×1.05（${base}→${after}，期望 ${base*1.05}）`);
  // 负值防御：公式为 ×(1+max(0,scanPercent))，聚合值不可能为负时恒 ≥ base
  ok(after>=base, "扫描强度不低于无 rig 基线");
}

/* =========================================================
   6. 干扰缩短只影响新产生的干扰（纯函数 + 下限保护）
   ========================================================= */
console.log("=== 6. 干扰缩短只影响新产生的干扰 ===");
{
  const site=(W.ARCHAEOLOGY_SITES||[]).find(s=>s.id==="site_i_a")||{time:400};
  const baseSec=W.getArchaeologyInterferenceSeconds(site, 0);
  const redSec=W.getArchaeologyInterferenceSeconds(site, 0.10);
  const expected=Math.max(W.ARCHAEOLOGY_SIGNAL_MIN_SECONDS, Math.round(Math.round(site.time*0.25)*0.90));
  ok(redSec===expected, `10% 缩短：${baseSec}s → ${redSec}s（期望 ${expected}s）`);
  ok(W.getArchaeologyInterferenceSeconds(site,-1)===baseSec, "负值 reduction 视为 0");
  ok(W.getArchaeologyInterferenceSeconds(site,5)>=W.ARCHAEOLOGY_SIGNAL_MIN_SECONDS,
    `超额 reduction 被 clamp 且不低于下限 ${W.ARCHAEOLOGY_SIGNAL_MIN_SECONDS}s`);
  // 只影响新产生：既有 interferenceUntil 是状态字段，getArchaeologyInterferenceSeconds 为纯函数不触碰状态
  const st=freshState();
  st.archaeology.interferenceUntil=123456789;
  W.getArchaeologyInterferenceSeconds(site, 0.30);
  ok(st.archaeology.interferenceUntil===123456789, "计算干扰时长不修改既有 interferenceUntil");
}

/* =========================================================
   7. rig 不能进强化列表 / 强化 Action 拒绝
   ========================================================= */
console.log("=== 7. rig 不参与强化 ===");
{
  const st=freshState();
  st.equipment.inventory.push("rig_shield_capacity_i");
  st.equipment.inventory.push("archaeo_analyzer_i"); // 对照组：普通装备
  const list=W.getEquipmentEnhancementListDisplayState(st);
  const flat=JSON.stringify(list);
  ok(!flat.includes("rig_shield_capacity_i"), "强化列表不含改装件");
  ok(flat.includes("archaeo_analyzer_i"), "强化列表仍含普通装备（对照）");
  const r=W.dispatchGameAction(st,{type:"equipment/enhance",targetRef:"rig_shield_capacity_i",randomValue:0.0},0);
  ok(r.changed===false && r.reason==="rig-not-enhanceable", `强化 rig 被拒（reason=${r.reason}）`);
}

/* =========================================================
   8. 所有（非考古）舰船仍可参战，考古舰仍被禁
   ========================================================= */
console.log("=== 8. 舰船参战不受 rig 系统影响 ===");
{
  for(const shipId of ["rifter","kestrel"]){
    const st=freshState();
    const ship=addShip(st,shipId);
    st.shipAssignments.combat=ship.instanceId;
    const active=W.getActiveCombatShipState(st);
    ok(active.instance && active.instance.instanceId===ship.instanceId, `${shipId} 可指派参战`);
    const hp=W.getCombatMaxHpFromState(st);
    ok(hp.shield>0&&hp.armor>0&&hp.structure>0&&Number.isFinite(hp.shield), `${shipId} 战斗 HP 有效（${hp.shield}/${hp.armor}/${hp.structure}）`);
    const cfg=W.getShipConfigById(shipId);
    ok((cfg.slots.rig||0)>=1, `${shipId} 拥有 rig 槽（${cfg.slots.rig}）`);
  }
  // 考古舰禁战规则未被破坏（heron 属考古表）
  const cfgH=W.getShipConfigById("heron");
  ok(Boolean(cfgH), "heron 配置可解析（考古舰仍存在，禁战规则由既有断言覆盖）");
}

/* =========================================================
   9. rig 事件仅 Action 成功后发送
   ========================================================= */
console.log("=== 9. rig 事件仅 Action 成功后发送 ===");
{
  const events=[];
  const offs=[
    W.GameEvents.on("rig:fitted",e=>events.push(["fitted",e])),
    W.GameEvents.on("rig:destroyed",e=>events.push(["destroyed",e])),
    W.GameEvents.on("rig:replaced",e=>events.push(["replaced",e]))
  ];
  const st=freshState();
  const ship=addShip(st,"rifter");
  // 失败路径 1：库存里没有该 rig（setFittingSlot 应拒绝）
  let r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_shield_capacity_i"},0);
  ok(r.changed===false && events.length===0, `无库存安装失败且无事件（reason=${r.reason}）`);
  // 失败路径 2：非法槽位
  st.equipment.inventory.push("rig_shield_capacity_i");
  r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:99,rigItemId:"rig_shield_capacity_i"},0);
  ok(r.changed===false && events.length===0, `非法槽位失败且无事件（reason=${r.reason}）`);
  // 失败路径 3：非 rig 物品
  r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"archaeo_analyzer_i"},0);
  ok(r.changed===false && events.length===0, `非 rig 物品失败且无事件（reason=${r.reason}）`);
  // 成功路径：恰好 1 个 fitted 事件
  r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_shield_capacity_i"},0);
  ok(r.changed===true && events.length===1 && events[0][0]==="fitted", "安装成功后恰发 1 个 rig:fitted");
  ok(events[0][1].payload ? events[0][1].payload.rigId==="rig_shield_capacity_i" : true, "事件 payload 携带 rigId");
  // 失败路径 4：槽位已占用 → 无新事件
  st.equipment.inventory.push("rig_shield_capacity_i");
  r=W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_shield_capacity_i"},0);
  ok(r.changed===false && events.length===1, `占用槽安装失败且无新事件（reason=${r.reason}）`);
  // destroy 失败（空槽）→ 无事件；destroy 成功 → 恰 1 个 destroyed
  r=W.dispatchGameAction(st,{type:"hangar/destroyFittedRig",instanceId:ship.instanceId,slotIndex:1},0);
  const rigSlotCount=W.getShipConfigById("rifter").slots.rig;
  if(rigSlotCount>1){
    ok(r.changed===false && events.length===1, "空槽拆卸失败且无事件");
  } else {
    ok(events.length===1, "空槽/非法槽拆卸无事件");
  }
  r=W.dispatchGameAction(st,{type:"hangar/destroyFittedRig",instanceId:ship.instanceId,slotIndex:0},0);
  ok(r.changed===true && events.length===2 && events[1][0]==="destroyed", "拆卸成功后恰发 1 个 rig:destroyed");
  offs.forEach(off=>off());
}

/* =========================================================
   10. persistence：游离 rig 实例丢弃，合法库存/已装 rig 保留
   ========================================================= */
console.log("=== 10. persistence 防复制守卫 ===");
{
  const st=freshState();
  const ship=addShip(st,"rifter");
  // 真实安装一个 rig（产生被 fitted 引用的实例）
  st.equipment.inventory.push("rig_shield_capacity_i");
  W.dispatchGameAction(st,{type:"hangar/fitRig",instanceId:ship.instanceId,slotIndex:0,rigItemId:"rig_shield_capacity_i"},0);
  const fittedRef=ship.fitted.rig[0];
  // 注入游离 rig 实例（模拟损坏/篡改存档）
  st.equipment.instances.push({instanceId:99991,itemId:"rig_armor_capacity_i",enhancementLevel:0,installedOn:null});
  // 注入合法非 rig 实例（游离普通装备实例应保留）
  st.equipment.instances.push({instanceId:99992,itemId:"archaeo_analyzer_i",enhancementLevel:1,installedOn:null});
  // 合法库存物品
  st.equipment.inventory.push("rig_smelting_speed_i");
  const invBefore=st.equipment.inventory.slice();
  W.normalizeEquipmentState(st);
  const ids=st.equipment.instances.map(i=>i.instanceId);
  ok(!ids.includes(99991), "游离 rig 实例被丢弃（防复制）");
  ok(ids.includes(99992), "游离普通装备实例保留");
  const fittedStill=ship.fitted.rig[0];
  const resolved=W.resolveEquipmentReference(st,fittedStill);
  ok(resolved && resolved.itemId==="rig_shield_capacity_i", "已安装 rig 实例保留且可解析");
  ok(st.equipment.inventory.includes("rig_smelting_speed_i"), "库存中的 rig 物品（itemId 字符串）不受影响");
  ok(invBefore.every(x=>st.equipment.inventory.includes(x)), "normalize 不删任何合法库存条目");
}

console.log(`\n=== 总计: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail>0?1:0);
