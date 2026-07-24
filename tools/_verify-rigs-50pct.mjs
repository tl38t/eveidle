// 复核五档 50% 成功率基准（完整标准配置）：
// 同级考古船 +0、技能=档位门槛、普通探针、全部 high 槽装满同级分析仪 +0、无扫描改装件。
// 全部通过真实舰船实例(createShipInstance)、真实装备库存、真实装配 Action(hangar/setFittingSlot)
// 与真实考古 selector(getArchaeologyDisplayState) 建立与读取配置。
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
window.ARCHAEOLOGY_SHIPS=(typeof ARCHAEOLOGY_SHIPS!=='undefined')?ARCHAEOLOGY_SHIPS:null;
window.ARCHAEOLOGY_TIERS=(typeof ARCHAEOLOGY_TIERS!=='undefined')?ARCHAEOLOGY_TIERS:null;
window.gameState=(typeof gameState!=='undefined')?gameState:null;
`;
vm.createContext(sandbox);
try { vm.runInContext(combined,sandbox,{filename:"combined.js"}); }
catch(e){ console.error("LOAD ERROR:",e.message); process.exit(1); }
const W=sandbox;

// ---- 五档完整标准配置 ----
const TIERS=[
  { roman:"I",   siteId:"site_i_a",   shipId:"heron",       skill:1,  analyzer:"archaeo_analyzer_i"   },
  { roman:"II",  siteId:"site_ii_a",  shipId:"tracer",      skill:15, analyzer:"archaeo_analyzer_ii"  },
  { roman:"III", siteId:"site_iii_a", shipId:"starmap",     skill:35, analyzer:"archaeo_analyzer_iii" },
  { roman:"IV",  siteId:"site_iv_a",  shipId:"farscope",    skill:55, analyzer:"archaeo_analyzer_iv"  },
  { roman:"V",   siteId:"site_v_a",   shipId:"illuminator", skill:80, analyzer:"archaeo_analyzer_v"   }
];
const PROBE_ID="core_probe_i";

console.log("=== 五档 50% 成功率复核（完整标准配置，真实实例/Action/selector）===");
let allFifty=true;
const rows=[];
for(const t of TIERS){
  const st=JSON.parse(JSON.stringify(W.gameState));
  st.skills.archaeology={lvl:t.skill,xp:0};
  st.inventory=st.inventory||{}; st.inventory.ships=st.inventory.ships||[];
  st.equipment=st.equipment||{inventory:[],instances:[],nextInstanceId:1};
  st.equipment.inventory=st.equipment.inventory||[];
  st.equipment.instances=st.equipment.instances||[];
  W.ResourceRegistry.add(st,"consumable:fuel",1000);
  W.ResourceRegistry.add(st,"probe:"+PROBE_ID,50);

  // 真实舰船实例 +0
  const ship=W.createShipInstance(t.shipId);
  st.inventory.ships.push(ship);
  st.shipAssignments=st.shipAssignments||{};
  st.shipAssignments.archaeology=ship.instanceId;

  const cfg=W.getShipConfigById(t.shipId);
  const highSlots=cfg.slots.high;

  // 真实装备实例：分析仪先入库存，再通过真实装配 Action 逐槽安装
  let fittedCount=0;
  for(let i=0;i<highSlots;i++){
    st.equipment.inventory.push(t.analyzer);
    const r=W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:i,equipmentId:t.analyzer},0);
    if(r.changed) fittedCount++;
    else { console.log(`  [ERROR] ${t.roman} 槽${i} 装配失败: ${r.reason}`); }
  }
  // 分析仪实例应全部 +0
  const enhLevels=st.equipment.instances.map(x=>x.enhancementLevel);
  const allZero=enhLevels.every(l=>l===0);

  // 真实考古 selector 读取
  st.archaeology.activeProbeId=PROBE_ID;
  const disp=W.getArchaeologyDisplayState(st,0);
  const siteRow=disp.sites.find(x=>x.id===t.siteId);

  // 扫描各组成部分（用真实函数逐项拆解）
  const inst=W.getShipInstanceFromState(st,ship.instanceId);
  const fitted=W.getArchaeologyFittedBonuses(st,inst);
  const probe=W.getArchaeologyProbe(PROBE_ID);
  const shipScan=cfg.bonuses.archaeologyScanStrength;
  const scanStrength=W.computeArchaeologyScanStrength(st,inst,PROBE_ID);
  const site=W.getArchaeologySite(t.siteId);
  const chance=W.computeArchaeologySuccessChance(scanStrength,site.difficulty);

  const is50 = chance===0.50 && siteRow.successChance===0.50;
  if(!is50) allFifty=false;
  rows.push({t,cfg,fittedCount,highSlots,allZero,shipScan,fitted,probe,scanStrength,site,chance,selChance:siteRow.successChance});

  console.log(`\n[${t.roman}] 舰船=${t.shipId}(${cfg.name}) 技能=${t.skill} 探针=${PROBE_ID}`);
  console.log(`  分析仪=${t.analyzer} × ${fittedCount}/${highSlots}（真实Action安装，全部+0：${allZero}）`);
  console.log(`  舰船扫描贡献=${shipScan}  技能贡献=${t.skill}  分析仪贡献=${fitted.scan}  探针贡献=${probe.scanBonus}`);
  console.log(`  最终scanStrength=${scanStrength}  site difficulty=${site.difficulty}`);
  console.log(`  最终成功率(公式)=${(chance*100).toFixed(1)}%  selector成功率=${(siteRow.successChance*100).toFixed(1)}%  ${is50?"[PASS 50%]":"[FAIL ≠50%]"}`);
}

console.log("\n=== 交叉核对 audit-archaeology-system.mjs B3 断言 ===");
console.log("B3c Tier I=50% / B3e Tier III=50% / B3g Tier V=50% —— 与本脚本 I/III/V 结果一致：" +
  (rows.filter(r=>["I","III","V"].includes(r.t.roman)).every(r=>r.chance===0.50)));

console.log("\n=== 结论 ===");
if(allFifty){ console.log("五档完整标准配置成功率全部=50%。基准修正确认：先前硬校验用裸船（未装分析仪）导致偏差。"); process.exit(0); }
else { console.log(">>> 存在≠50% 档位，立即停止。上方已输出扫描公式每个组成部分。"); process.exit(1); }
