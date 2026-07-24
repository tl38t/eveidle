// 校准材料掉落数量（calibrationAmount）实装验证 + 经济重算。
// 全部走真实函数：resolveArchaeologyCycle（在线/离线共用）、SaveManager、ResourceRegistry。
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
window.gameState=(typeof gameState!=='undefined')?gameState:null;
`;
vm.createContext(sandbox);
try { vm.runInContext(combined,sandbox,{filename:"combined.js"}); }
catch(e){ console.error("LOAD ERROR:",e.message); process.exit(1); }
const W=sandbox;

// 关键：resolveArchaeologyCycle 的成功判定 roll 在 randomValue 为函数时回退 Math.random()。
// 接管沙箱上下文的 Math.random，固定返回 0.1（< 50% 成功率 → 必成功），保证测试确定性。
const ctxMath = vm.runInContext("Math", sandbox);
const origCtxRandom = ctxMath.random.bind(ctxMath);
ctxMath.random = () => 0.1;

let pass=0, fail=0;
function ok(cond,label){ if(cond){pass++;console.log("  [PASS] "+label);} else {fail++;console.log("  [FAIL] "+label);} }

const TIERS=[
  { roman:"I",   siteId:"site_i_a",   shipId:"heron",       skill:1,  analyzer:"archaeo_analyzer_i",   calib:"art_i_calib",   amount:1, slots:1 },
  { roman:"II",  siteId:"site_ii_a",  shipId:"tracer",      skill:15, analyzer:"archaeo_analyzer_ii",  calib:"art_ii_calib",  amount:1, slots:1 },
  { roman:"III", siteId:"site_iii_a", shipId:"starmap",     skill:35, analyzer:"archaeo_analyzer_iii", calib:"art_iii_calib", amount:2, slots:2 },
  { roman:"IV",  siteId:"site_iv_a",  shipId:"farscope",    skill:55, analyzer:"archaeo_analyzer_iv",  calib:"art_iv_calib",  amount:2, slots:3 },
  { roman:"V",   siteId:"site_v_a",   shipId:"illuminator", skill:80, analyzer:"archaeo_analyzer_v",   calib:"art_v_calib",   amount:3, slots:4 }
];
const RIG_BY_TIER={I:"rig_archaeology_fuel_i",II:"rig_archaeology_fuel_ii",III:"rig_archaeology_fuel_iii",IV:"rig_archaeology_fuel_iv",V:"rig_archaeology_fuel_v"};

// ---- 构造完整标准配置状态（同级船+0、技能门槛、满槽同级分析仪+0、普通探针）----
function buildStdState(t){
  const st=JSON.parse(JSON.stringify(W.gameState));
  st.skills.archaeology={lvl:t.skill,xp:0};
  st.inventory=st.inventory||{}; st.inventory.ships=st.inventory.ships||[];
  st.equipment={inventory:[],instances:[],nextInstanceId:1};
  W.ResourceRegistry.add(st,"consumable:fuel",1e9);
  W.ResourceRegistry.add(st,"probe:core_probe_i",1e9);
  const ship=W.createShipInstance(t.shipId);
  st.inventory.ships.push(ship);
  st.shipAssignments=st.shipAssignments||{};
  st.shipAssignments.archaeology=ship.instanceId;
  const cfg=W.getShipConfigById(t.shipId);
  for(let i=0;i<cfg.slots.high;i++){
    st.equipment.inventory.push(t.analyzer);
    W.dispatchGameAction(st,{type:"hangar/setFittingSlot",instanceId:ship.instanceId,slot:"high",slotIndex:i,equipmentId:t.analyzer},0);
  }
  st.archaeology.startedSiteId=t.siteId;
  st.archaeology.startedProbeId="core_probe_i";
  st.archaeology.activeProbeId="core_probe_i";
  st.archaeology.fuelSavingRemainder=0;
  st.archaeology.shipHp={};
  return { st, ship };
}

console.log("=== A. calibrationAmount 数据字段 ===");
for(const t of TIERS){
  const cfg=W.getArchaeologyTierConfig(t.roman);
  ok(cfg.calibrationAmount===t.amount, `A ${t.roman} 档 calibrationAmount=${t.amount}（实际 ${cfg.calibrationAmount}）`);
}
// 掉率未被修改
const RATES={I:0.020,II:0.015,III:0.010,IV:0.0075,V:0.005};
for(const t of TIERS){
  ok(W.getArchaeologyTierConfig(t.roman).calibrationRate===RATES[t.roman], `A ${t.roman} 档 calibrationRate 保持 ${RATES[t.roman]}`);
}

console.log("\n=== B. 固定随机值触发校准掉落 → 库存精确增加对应档位数量 ===");
// rng 序列：commonPick / (decoder 无) / uniqueRoll(不中) / calibRoll(命中) / lpRoll(不中)
// fitted.decoder=0（未装译码器）→ 不消耗 rng；uniqueRoll 用 0.999 不中；calibRoll 用 0 必中；lp 0.999 不中。
function makeRng(seq){ let i=0; return ()=>{ const v=seq[i%seq.length]; i++; return v; }; }
for(const t of TIERS){
  const {st}=buildStdState(t);
  const before=W.ResourceRegistry.get(st,"calibration:"+t.calib);
  // randomValue：成功判定 roll < successChance(0.50) → 0.1 成功；
  // 掉落 rng（传函数注入）：common=0.1 / unique=0.999(不中) / calib=0.0(必中) / lp=0.999(不中)
  const rng=makeRng([0.1,0.999,0.0,0.999]);
  const wrapped=(x)=>rng(x);
  // resolveArchaeologyCycle 的 randomValue 参数控制成功判定；传函数时同一函数也作为掉落 rng。
  // 先消耗一个值作为成功判定 roll（archaeologyRandom 对函数返回 Math.random——查实现），
  // 因此这里用受控方式：直接调 resolveArchaeologyDrops 不可（未暴露），改走 cycle + 函数注入。
  const r=W.resolveArchaeologyCycle(st,1000,wrapped);
  const after=W.ResourceRegistry.get(st,"calibration:"+t.calib);
  ok(r.success===true, `B ${t.roman} 周期成功（roll=0.1 < 50%）`);
  ok(after-before===t.amount, `B ${t.roman} 触发掉落库存 +${t.amount}（实际 +${after-before}）`);
}

console.log("\n=== C. 未触发时增加 0 ===");
for(const t of TIERS){
  const {st}=buildStdState(t);
  const before=W.ResourceRegistry.get(st,"calibration:"+t.calib);
  // calib roll = 0.999 > rate → 不掉
  const rng=makeRng([0.1,0.999,0.999,0.999]);
  const r=W.resolveArchaeologyCycle(st,1000,(x)=>rng(x));
  const after=W.ResourceRegistry.get(st,"calibration:"+t.calib);
  ok(r.success===true && after===before, `C ${t.roman} 未触发库存不变（+${after-before}）`);
}

console.log("\n=== D. 在线/离线同一掉落数量（同一 resolveArchaeologyDrops 路径） ===");
{
  // 在线（randomValue=函数）与离线（"offline"→Math.random 不可控）共用同一 resolveArchaeologyDrops。
  // 结构性验证：offline.js:189 与 tick.js:175 均调用 resolveArchaeologyCycle → 唯一掉落层。
  const offline=readFileSync(join(ROOT,"js/core/offline.js"),"utf8");
  const tick=readFileSync(join(ROOT,"js/core/tick.js"),"utf8");
  const sys=readFileSync(join(ROOT,"js/systems/archaeology.js"),"utf8");
  ok(offline.includes("resolveArchaeologyCycle(gameState"), "D 离线结算走 resolveArchaeologyCycle");
  ok(tick.includes("resolveArchaeologyCycle(gameState"), "D 在线 tick 走 resolveArchaeologyCycle");
  ok((sys.match(/ResourceRegistry\.add\(state, "calibration:/g)||[]).length===1, "D 校准掉落唯一写入点（掉落层仅 1 处）");
  ok(!sys.includes('ResourceRegistry.add(state, "calibration:" + calibArtifact.id, 1)'), "D 硬编码 1 已移除");
  ok(sys.includes("tier.calibrationAmount"), "D 掉落读取 tier.calibrationAmount");
}

console.log("\n=== E. sell-all / redeem-all 保留校准材料 ===");
{
  const t=TIERS[4];
  const {st}=buildStdState(t);
  W.ResourceRegistry.add(st,"calibration:art_v_calib",7);
  W.ResourceRegistry.add(st,"artifact:art_v_common_a",3);
  W.ResourceRegistry.add(st,"artifact:art_v_lp",2);
  const sell=W.sellArchaeologyArtifacts(st,null,0,true);
  const redeem=W.redeemArchaeologyArtifacts(st,null,0,true);
  ok(sell.changed===true && W.ResourceRegistry.get(st,"artifact:art_v_common_a")===0, "E sell-all 卖出 ISK 文物");
  ok(redeem.changed===true && W.ResourceRegistry.get(st,"artifact:art_v_lp")===0, "E redeem-all 兑换 LP 文物");
  ok(W.ResourceRegistry.get(st,"calibration:art_v_calib")===7, "E 校准材料保留 7 份不动");
  // 直接卖校准材料被拒
  const direct=W.sellArchaeologyArtifacts(st,"art_v_calib",1,false);
  ok(direct.changed===false && direct.reason==="not-sellable", "E 直接出售校准材料被拒 not-sellable");
}

console.log("\n=== F. ResourceRegistry 计数准确（多次触发累计） ===");
{
  const t=TIERS[2]; // III 档 amount=2
  const {st}=buildStdState(t);
  for(let i=0;i<5;i++){
    const rng=makeRng([0.1,0.999,0.0,0.999]);
    W.resolveArchaeologyCycle(st,2000+i,(x)=>rng(x));
  }
  ok(W.ResourceRegistry.get(st,"calibration:art_iii_calib")===10, `F III 档 5 次触发 = 10 份（实际 ${W.ResourceRegistry.get(st,"calibration:art_iii_calib")}）`);
}

console.log("\n=== G. 保存读取不复制 ===");
{
  const g=W.gameState;
  W.ResourceRegistry.add(g,"calibration:art_v_calib",5);
  const before=W.ResourceRegistry.get(g,"calibration:art_v_calib");
  W.SaveManager.save(); W.SaveManager.load();
  const after=W.ResourceRegistry.get(W.gameState,"calibration:art_v_calib");
  ok(before===after && after===5, `G save/load 往返校准材料 ${before}→${after} 不复制不丢失`);
}

console.log("\n=== H. 其他掉落数量未修改（普通 ISK / 独特 / LP 均 +1） ===");
{
  const t=TIERS[0];
  { // 普通 ISK：必得 1 份
    const {st}=buildStdState(t);
    const rng=makeRng([0.1,0.999,0.999,0.999]);
    W.resolveArchaeologyCycle(st,3000,(x)=>rng(x));
    const commons=["art_i_common_a","art_i_common_b","art_i_common_c"].reduce((s,id)=>s+W.ResourceRegistry.get(st,"artifact:"+id),0);
    ok(commons===1, "H 普通 ISK 文物每次 +1");
  }
  { // 独特：roll 命中时 +1
    const {st}=buildStdState(t);
    const rng=makeRng([0.1,0.0,0.0,0.999,0.999]); // common/uniqueRoll命中/uniquePick/calib不中/lp不中
    W.resolveArchaeologyCycle(st,3001,(x)=>rng(x));
    const uniques=["art_i_unique_a","art_i_unique_b","art_i_unique_c"].reduce((s,id)=>s+W.ResourceRegistry.get(st,"artifact:"+id),0);
    ok(uniques===1, "H 独特文物命中时 +1");
  }
  { // LP：roll 命中时 +1
    const {st}=buildStdState(t);
    const rng=makeRng([0.1,0.999,0.999,0.0]); // common/unique不中/calib不中/lp命中
    W.resolveArchaeologyCycle(st,3002,(x)=>rng(x));
    ok(W.ResourceRegistry.get(st,"artifact:art_i_lp")===1, "H LP 文物命中时 +1");
  }
}

console.log("\n=== 三、经济重算（真实 50% 成功率 + 真实掉落路径 + 真实 site duration） ===");
console.log("档 | 成功率 | 掉率 | 掉落数量 | 配方需求 | 期望次数/件 | 目标 | 全rig槽期望 | 目标 | 周期(s) | 全船耗时(h)");
const ECON_TARGET={I:100,II:400/3,III:200,IV:800/3,V:400};
const FLEET_TARGET={I:100,II:400/3,III:400,IV:800,V:1600};
let econOk=true;
for(const t of TIERS){
  const {st,ship}=buildStdState(t);
  const inst=W.getShipInstanceFromState(st,ship.instanceId);
  const scan=W.computeArchaeologyScanStrength(st,inst,"core_probe_i");
  const site=W.getArchaeologySite(t.siteId);
  const success=W.computeArchaeologySuccessChance(scan,site.difficulty);
  const tierCfg=W.getArchaeologyTierConfig(t.roman);
  const rigDef=W.EQUIPMENT_DB[RIG_BY_TIER[t.roman]];
  const requiredQty=rigDef.cost["calibration:"+t.calib];
  const expected=requiredQty/(success*tierCfg.calibrationRate*tierCfg.calibrationAmount);
  const fleet=expected*t.slots;
  const hours=fleet*site.time/3600; // 真实 site duration
  const okOne=Math.abs(expected-ECON_TARGET[t.roman])<0.01;
  const okFleet=Math.abs(fleet-FLEET_TARGET[t.roman])<0.01;
  if(!okOne||!okFleet) econOk=false;
  console.log(
    `${t.roman.padEnd(3)}| ${(success*100).toFixed(0)}%   | ${String(tierCfg.calibrationRate).padStart(6)} | ${tierCfg.calibrationAmount}        | ${requiredQty}        | ` +
    `${expected.toFixed(2).padStart(8)} | ${ECON_TARGET[t.roman].toFixed(2).padStart(6)} | ${fleet.toFixed(2).padStart(8)} | ${FLEET_TARGET[t.roman].toFixed(2).padStart(7)} | ${String(site.time).padStart(5)} | ${hours.toFixed(1).padStart(8)} ${okOne&&okFleet?"[PASS]":"[FAIL]"}`
  );
}
ok(econOk, "三 经济五档全部命中目标（V 档四槽回到约 133 小时）");

console.log(`\n结果：pass=${pass} fail=${fail}`);
process.exit(fail===0?0:1);
