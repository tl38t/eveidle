#!/usr/bin/env node
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const noop = () => {};
function makeRng(s){let st=s>>>0;return()=>{st=(Math.imul(st,1664525)+1013904223)>>>0;return st/4294967296;}};
class MC{} for(const n of["arc","beginPath","clearRect","clip","fill","fillRect","fillText","lineTo","moveTo","rect","restore","save","scale","setTransform","stroke","strokeText"])MC.prototype[n]=noop;
MC.prototype.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}); MC.prototype.createRadialGradient=()=>({addColorStop:noop}); MC.prototype.getImageData=()=>({data:new Uint8ClampedArray(4)}); MC.prototype.roundRect=noop;
const cl={add:noop,remove:noop,toggle:noop,contains:()=>false};
const me=()=>({addEventListener:noop,appendChild:noop,classList:cl,click:noop,closest:()=>null,dataset:{},focus:noop,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),getContext:()=>new MC(),innerHTML:"",offsetHeight:24,offsetWidth:560,querySelector:()=>me(),querySelectorAll:()=>[],remove:noop,select:noop,style:{},textContent:"",value:"1"});
const sb=vm.createContext({alert:noop,Blob,confirm:()=>true,CanvasRenderingContext2D:MC,console,document:{addEventListener:noop,body:me(),createElement:()=>me(),createElementNS:()=>({...me(),setAttribute:noop}),getElementById:()=>me(),querySelector:()=>me(),querySelectorAll:()=>[]},FileReader:class{},Image:class{},localStorage:{getItem:()=>null,setItem:noop},requestAnimationFrame:noop,setInterval:noop,setTimeout:noop,clearTimeout:noop,URL:{createObjectURL:()=>"blob:mock",revokeObjectURL:noop},window:null}); sb.window=sb; sb.window.addEventListener=noop;
const srcs=[...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m=>m[1].replace(/\?.*$/,"").replace(/^\.\//,""));
for(const s of srcs)vm.runInContext(fs.readFileSync(path.resolve(root,s),"utf8"),sb,{filename:s});
const $=c=>vm.runInContext(c,sb);
const T=$("ARCHAEOLOGY_TIERS"),S=$("ARCHAEOLOGY_SITES"),H=$("ARCHAEOLOGY_SHIPS"),A=$("ARCHAEOLOGY_ARTIFACTS"),W=$("ARCHAEOLOGY_COMMON_WEIGHTS"),E=$("EQUIPMENT_DB");
const mkShip=$("createShipInstance"),RR=$("ResourceRegistry"),gs0=JSON.parse(JSON.stringify($("gameState")));
const fn=n=>(...a)=>$(n)(...a);
const fCycle=fn("resolveArchaeologyCycle"),fSell=fn("sellArchaeologyArtifacts"),fRedeem=fn("redeemArchaeologyArtifacts");
const fScan=fn("computeArchaeologyScanStrength"),fChance=fn("computeArchaeologySuccessChance");
const fInterf=fn("getArchaeologyInterferenceSeconds"),fFuel=fn("getArchaeologyFuelCostState"),fFitted=fn("getArchaeologyFittedBonuses");
const fResetHP=fn("resetArchaeologyShipHp"),fDisplay=fn("getArchaeologyDisplayState");
const EID={an:{I:"archaeo_analyzer_i",II:"archaeo_analyzer_ii",III:"archaeo_analyzer_iii",IV:"archaeo_analyzer_iv",V:"archaeo_analyzer_v"},st:{I:"archaeo_stabilizer_i",II:"archaeo_stabilizer_ii",III:"archaeo_stabilizer_iii",IV:"archaeo_stabilizer_iv",V:"archaeo_stabilizer_v"},de:{I:"archaeo_decoder_i",II:"archaeo_decoder_ii",III:"archaeo_decoder_iii",IV:"archaeo_decoder_iv",V:"archaeo_decoder_v"}};
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  FAIL:",m);}}
function section(s){console.log(`\n${s}`);}
function mkState(tid){
  const t=T[tid],c=H[t.ship];
  const g=JSON.parse(JSON.stringify(gs0));
  g.archaeology={activeSiteId:null,activeProbeId:"core_probe_i",progress:0,startedSiteId:null,startedProbeId:null,shipHp:{},repairUntil:0,repairInstanceId:null,interferenceUntil:0,fuelSavingRemainder:0,log:[]};
  g.skills.archaeology={lvl:t.level,xp:0};g.inventory.ships=[];g.shipAssignments={};g.equipment={inventory:[],instances:[],nextInstanceId:1};
  const ship=mkShip(t.ship,1000000);
  g.inventory.ships.push(ship);g.shipAssignments.archaeology=ship.instanceId;
  for(let i=0;i<c.slots.high;i++)ship.fitted.high.push(EID.an[tid]);
  for(let i=0;i<c.slots.mid;i++)ship.fitted.mid.push(EID.st[tid]);
  for(let i=0;i<c.slots.low;i++)ship.fitted.low.push(EID.de[tid]);
  RR.add(g,"consumable:fuel",100000);RR.add(g,"probe:core_probe_i",100000);RR.add(g,"currency:isk",0);
  return{g,t,c,ship};
}

// ==== 一、遗迹差异验证 ====
section("【一、同档三遗迹真实差异】");
for(const tid of["I","II","III","IV","V"]){
  const sites=S.filter(s=>s.tier===tid);
  const a=sites[0],b=sites[1],c=sites[2];
  ok(a.level===b.level&&b.level===c.level,`${tid} 等级一致(${a.level})`);
  ok(a.difficulty===b.difficulty&&b.difficulty===c.difficulty,`${tid} 难度一致(${a.difficulty})`);
  ok(a.time===b.time&&b.time===c.time,`${tid} 时间一致(${a.time}s)`);
  ok(a.fuel===b.fuel&&b.fuel===c.fuel,`${tid} 燃料一致(${a.fuel})`);
  ok(a.xp===b.xp&&b.xp===c.xp,`${tid} XP一致(${a.xp})`);
  ok(a.backlashDamage===b.backlashDamage&&b.backlashDamage===c.backlashDamage,`${tid} 反噬一致(${a.backlashDamage})`);
  ok(a.lpMultiplier===1.0&&b.lpMultiplier===1.0&&c.lpMultiplier===1.0,`${tid} lpMultiplier全为1.0`);
  ok(a.profile==="salvage"&&b.profile==="research"&&c.profile==="treasure",`${tid} profiles: A=${a.profile} B=${b.profile} C=${c.profile}`);
  console.log(`    ${a.name} (${a.profile}) / ${b.name} (${b.profile}) / ${c.name} (${c.profile})`);
}

// ==== 二、profile 精确值验证 ====
section("【二、Profile 精确值验证】");
{
  const PROF=vm.runInContext("SITE_PROFILES",sb);
  const salvage=PROF.salvage, research=PROF.research, treasure=PROF.treasure;
  ok(salvage.backlashMultiplier===0.70&&research.backlashMultiplier===1.0&&treasure.backlashMultiplier===1.40,`反噬倍率 0.7/1.0/1.4`);
  const sw=salvage.commonWeights,rw=research.commonWeights,tw=treasure.commonWeights;
  ok(sw[0]===0.45&&sw[1]===0.35&&sw[2]===0.20,`salvage权重[0.45,0.35,0.20]`);
  ok(rw[0]===0.60&&rw[1]===0.30&&rw[2]===0.10,`research权重[0.60,0.30,0.10]`);
  ok(tw[0]===0.70&&tw[1]===0.20&&tw[2]===0.10,`treasure权重[0.70,0.20,0.10]`);
  [sw,rw,tw].forEach(w=>ok(Math.abs(w[0]+w[1]+w[2]-1)<0.001,`权重和≈1(${(w[0]+w[1]+w[2]).toFixed(6)})`));
  ok(salvage.calibrationMultiplier===0.5&&research.calibrationMultiplier===2.0&&treasure.calibrationMultiplier===0.5,`校准倍率 0.5/2.0/0.5`);
  ok(salvage.uniqueMultiplier===0.5&&research.uniqueMultiplier===1.0&&treasure.uniqueMultiplier===2.0,`unique倍率 0.5/1.0/2.0`);
  ok(salvage.lpMultiplier===0.5&&research.lpMultiplier===1.0&&treasure.lpMultiplier===2.0,`LP倍率 0.5/1.0/2.0`);
  // 验证 getSiteEffectiveProfile 返回正确值
  for(const tid of["I","II","III","IV","V"]){
    const t=T[tid];
    const a=S.find(s=>s.tier===tid&&s.profile==="salvage");
    const b=S.find(s=>s.tier===tid&&s.profile==="research");
    const c=S.find(s=>s.tier===tid&&s.profile==="treasure");
    const pa=fn("getSiteEffectiveProfile")(a,t);
    const pb=fn("getSiteEffectiveProfile")(b,t);
    const pc=fn("getSiteEffectiveProfile")(c,t);
    ok(pa&&pb&&pc,`${tid} getSiteEffectiveProfile 返回非空`);
    ok(pb.effectiveLpMultiplier===1.0,`${tid} B LP倍率=1.0`);
    ok(pa.effectiveLpMultiplier===0.5,`${tid} A LP倍率=0.5`);
    ok(pc.effectiveLpMultiplier===2.0,`${tid} C LP倍率=2.0`);
    ok(pb.effectiveUniqueRate===Math.min(0.99,t.uniqueRate*1.0),`${tid} B unique率正确`);
    ok(pc.effectiveUniqueRate===Math.min(0.99,t.uniqueRate*2.0),`${tid} C unique率=$`);
    ok(pb.effectiveCalibrationRate===Math.min(0.99,t.calibrationRate*2.0),`${tid} B校准率=$`);
  }
}

// ==== 三、考古预览字段检查 ====
section("【三、考古预览字段检查】");
{
  const{g}=mkState("I");
  const site=S.find(s=>s.tier==="I"&&s.profile==="research");
  g.archaeology.activeSiteId=site.id;g.archaeology.activeProbeId="core_probe_i";g.archaeology.startedSiteId=site.id;g.archaeology.startedProbeId="core_probe_i";
  g.archaeology.shipHp[g.inventory.ships[0].instanceId]={shield:100,armor:100,structure:100};
  RR.add(g,"consumable:fuel",1000);RR.add(g,"probe:core_probe_i",1000);
  const disp=fDisplay(g,Date.now());
  const s=disp.sites[1]; // B (research)
  ok(s.id!==undefined,"id存在"); ok(s.name!==undefined,"name存在"); ok(s.difficulty!==undefined,"difficulty存在");
  ok(s.successChance!==undefined,"successChance存在"); ok(s.drop!==undefined||s.drops!==undefined,"drops存在");
  ok(s.profile&&s.profile.label!==undefined,"profile.label存在");
  ok(s.actualCycleTime!==undefined,"actualCycleTime存在");
  ok(s.interferenceSec!==undefined,"interferenceSec存在");
  ok(s.effectiveBacklash!==undefined,"effectiveBacklash存在");
  ok(s.preview!==undefined,"preview存在");
  ok(s.preview.expectedIskPerCycle>0,`expectedIskPerCycle>0(${s.preview.expectedIskPerCycle})`);
  ok(s.preview.expectedLpPerCycle>=0,`expectedLpPerCycle>=0`);
  ok(s.preview.expectedCalibPerCycle>0,`expectedCalibPerCycle>0(${s.preview.expectedCalibPerCycle})`);
  // 验证预览成功率与真实一致
  const scan=fScan(g,g.inventory.ships[0],"core_probe_i");
  const realChance=fChance(scan,site.difficulty);
  ok(Math.abs(s.successChance-realChance)<0.001,`预览成功率(${s.successChance})===真实(${realChance})`);
  // 验证不同 profile 预览不同
  const sA=disp.sites[0]; const sB=disp.sites[1]; const sC=disp.sites[2];
  ok(sA.preview.effectiveLpMultiplier===0.5&&sB.preview.effectiveLpMultiplier===1.0&&sC.preview.effectiveLpMultiplier===2.0,`A/B/C LP倍率 0.5/1/2`);
}

// ==== 四、战斗预览字段检查 ====
section("【四、战斗预览字段检查】");
const zones=$("COMBAT_ZONES");
const formations=$("COMBAT_FORMATION_POOLS");
ok(Array.isArray(zones)&&zones.length>0,"COMBAT_ZONES存在");
ok(formations!==undefined,"FORMATION_POOLS存在");
for(const z of zones.slice(0,3)){
  ok(z.clearLp>0,`${z.name} clearLp=${z.clearLp}>0`);
  ok(z.iskMulti>0,`${z.name} iskMulti>0`);
  ok(z.formationPool!==undefined,`formationPool存在`);
  ok(z.enemyPool!==undefined,`enemyPool存在`);
}

// ==== 五、舰船重创语义验证 ====
section("【五、舰船重创语义验证】");
{
  const{g,t,c}=mkState("I");
  const site=S.find(s=>s.tier==="I"&&s.profile==="research");
  g.archaeology.activeSiteId=site.id;g.archaeology.startedSiteId=site.id;g.archaeology.startedProbeId="core_probe_i";
  const instanceId=g.shipAssignments.archaeology;
  const instance=g.inventory.ships.find(s=>s.instanceId===instanceId);
  const origInstanceId=instance.instanceId; const origFitted=JSON.stringify(instance.fitted);
  const sRed=c.bonuses.archaeologyFailureDamageReduction||0;
  const stabPU=E[EID.st["I"]].bonuses.archaeologyStabilizer; const totStab=Math.min(0.60,c.slots.mid*stabPU);
  const prof=vm.runInContext("SITE_PROFILES",sb)[site.profile]; const bMult=prof?prof.backlashMultiplier:1;
  const backlash=Math.ceil(site.backlashDamage*bMult*(1-sRed)*(1-totStab));
  g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:backlash};
  const probeBefore=RR.get(g,"probe:core_probe_i");
  const xpBefore=g.skills.archaeology.xp;
  const iskBefore=RR.get(g,"currency:isk");
  const result=fCycle(g,Date.now(),0.7); // 0.7>0.5=失败
  ok(result.success===false,`重创: success=false`);
  ok(result.destroyed===true,`重创: destroyed=true`);
  ok(RR.get(g,"probe:core_probe_i")<probeBefore,`重创: 探针消耗`);
  ok(g.skills.archaeology.xp===xpBefore,`重创: XP不变(${xpBefore})`);
  ok(RR.get(g,"currency:isk")===iskBefore,`重创: ISK不变`);
  ok(g.shipAssignments.archaeology===origInstanceId,`重创: instanceId不变`);
  ok(g.archaeology.repairUntil>0,`重创: repairUntil已设`);
  const inst2=g.inventory.ships.find(s=>s.instanceId===instanceId);
  ok(JSON.stringify(inst2.fitted)===origFitted,`重创: 装备不变`);
  const hpBefore=g.archaeology.shipHp[instanceId];
  // 维修完成后HP恢复
  g.archaeology.repairUntil=0;
  fResetHP(g,instanceId);
  const hpAfter=g.archaeology.shipHp[instanceId];
  const cfg=H["heron"];
  ok(hpAfter.shield===cfg.hp.shield&&hpAfter.armor===cfg.hp.armor&&hpAfter.structure===cfg.hp.structure,`维修后HP满(${hpAfter.shield}/${hpAfter.armor}/${hpAfter.structure})`);
  ok(RR.get(g,"currency:isk")===iskBefore,`重创后: ISK不变`);
}

// ==== 六、真实离线积分测试（通过生产版 applyOfflineGains 全链路驱动）====
// 铁律：本节严禁直接调用 resolveArchaeologyCycle，严禁手动清维修/手动恢复 HP。
// 全部场景经 applyOfflineGains(seconds) → settleOfflineTimeline → settleOfflineActions
//   → getOfflineActionDescriptor → settleByTime → resolveArchaeologyCycle 真实链路。
// 断言基于运行后的真实终态（HP / repairUntil / 探针 / 燃料 / gains / _auditTimeBySkill）。
section("【六、真实离线积分测试 applyOfflineGains】");
{
  const applyOffline = fn("applyOfflineGains");   // 生产版离线结算入口（真实调用）
  const cfgHeron = H["heron"];
  const CYCLE = 30;   // tier I site.time=30s（无增强剂时一周期墙钟）
  // 安装场景 state 到生产版 gameState。
  // 关键：state.js 用 `const gameState` 声明——这是 VM 共享词法作用域里的绑定，
  // offline.js 的裸 `gameState` 引用解析到该 const，而非 sandbox 属性 sb.gameState。
  // 因此 sb.gameState=g 对生产代码不可见，必须"就地改写" const 指向的对象内容。
  function installGS(g){
    const real = $("gameState");                     // 词法 const 指向的真实对象
    for (const k of Object.keys(real)) delete real[k];
    Object.assign(real, g);                           // 把场景 g 的顶层键接管进 real（转移嵌套引用）
    sb.gameState = real;                              // 同步 sandbox 属性，保持一致
    return real;                                      // 返回 real；后续读写/断言均基于它
  }
  // 构建离线考古场景 state（考古行动 active，队列停用）；构建后立即安装为生产 gameState 并返回 real。
  function mkOfflineArch(opts){
    opts = opts || {};
    const tid="I", t=T[tid], c=H[t.ship];
    const g=JSON.parse(JSON.stringify(gs0));
    g.archaeology={activeSiteId:null,activeProbeId:"core_probe_i",progress:0,startedSiteId:null,startedProbeId:null,shipHp:{},repairUntil:0,repairInstanceId:null,interferenceUntil:0,fuelSavingRemainder:0,log:[]};
    g.skills.archaeology={lvl:t.level,xp:0}; g.inventory.ships=[]; g.shipAssignments={}; g.equipment={inventory:[],instances:[],nextInstanceId:1};
    const ship=mkShip(t.ship,1000000); g.inventory.ships.push(ship); g.shipAssignments.archaeology=ship.instanceId;
    for(let i=0;i<c.slots.high;i++)ship.fitted.high.push(EID.an[tid]);
    for(let i=0;i<c.slots.mid;i++)ship.fitted.mid.push(EID.st[tid]);
    for(let i=0;i<c.slots.low;i++)ship.fitted.low.push(EID.de[tid]);
    const site=S.find(s=>s.tier===tid&&s.profile==="research");
    g.archaeology.activeSiteId=site.id; g.archaeology.startedSiteId=site.id; g.archaeology.startedProbeId="core_probe_i";
    RR.add(g,"consumable:fuel", opts.fuel!=null?opts.fuel:100000);
    RR.add(g,"probe:core_probe_i", opts.probe!=null?opts.probe:10000);
    RR.add(g,"currency:isk",0);
    g.currentAction={active:true,skill:"archaeology",progress:opts.progress||0,batchRemaining:opts.batch!=null?opts.batch:0,startedSiteId:site.id,startedProbeId:"core_probe_i",lastProgressUpdate:0,area:null,startedArea:null};
    if(g.queue&&g.queue.status){ g.queue.status.isRunning=false; g.queue.status.activeIndex=-1; g.queue.items=[]; }
    const real=installGS(g);   // 就地安装为生产 gameState；后续断言基于 real
    return {g:real,site,ship,instanceId:ship.instanceId,c};
  }
  // 运行一次真实离线结算；roll!=null 时固定成功率骰子（0=必成功，0.999999=必失败）
  // 注意：g 已是生产 gameState（mkOfflineArch 已安装），此处不得再次 installGS（会清空）。
  function runOffline(g, seconds, roll){
    const M=$("Math"); const origRnd=M.random;
    if(roll!=null) M.random=()=>roll;
    let gains;
    try{ gains = applyOffline(seconds); }
    finally{ M.random=origRnd; }
    const action=(g._auditTimeBySkill&&g._auditTimeBySkill.archaeology)||0;
    return { gains, action };
  }

  // --- A：初始维修未完成（维修剩余180s，离线170s < 180s）---
  {
    const {g,instanceId}=mkOfflineArch();
    const nowRef=Date.now();
    g.archaeology.repairUntil=nowRef-170*1000+180*1000;  // 维修剩余≈180s
    g.archaeology.repairInstanceId=instanceId;
    g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:1};
    const {gains,action}=runOffline(g,170,0.0);
    ok(gains.archaeology===0,`A 维修未完成: 0周期(实际${gains.archaeology})`);
    ok(g.archaeology.repairUntil>0 && g.archaeology.repairInstanceId===instanceId,`A: 离线结束仍在维修`);
    ok(g.archaeology.shipHp[instanceId].structure===1,`A: HP未恢复(结构=${g.archaeology.shipHp[instanceId].structure})`);
    ok(action===0,`A: 行动时间0(全程维修,实际${action})`);
  }

  // --- B：初始维修恰好完成（维修剩余180s，离线180s）---
  {
    const {g,instanceId}=mkOfflineArch();
    const nowRef=Date.now();
    g.archaeology.repairUntil=nowRef;  // virtualStart=now-180s ⇒ 维修剩余≈180s
    g.archaeology.repairInstanceId=instanceId;
    g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:1};
    const {gains}=runOffline(g,180,0.0);
    ok(gains.archaeology===0,`B 维修恰好完成: 0周期`);
    ok(g.archaeology.repairUntil===0 && g.archaeology.repairInstanceId===null,`B: 维修状态已清`);
    const hp=g.archaeology.shipHp[instanceId];
    ok(hp.structure===cfgHeron.hp.structure && hp.shield===cfgHeron.hp.shield,`B: HP恢复满(结构${hp.structure})`);
  }

  // --- C：维修完成后继续挖掘（维修180s + 45s ⇒ 1完整周期 + 15s部分）---
  {
    const {g,instanceId}=mkOfflineArch();
    const nowRef=Date.now();
    g.archaeology.repairUntil=nowRef-225*1000+180*1000;  // 维修剩余≈180s
    g.archaeology.repairInstanceId=instanceId;
    g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:1};
    const probeB4=RR.get(g,"probe:core_probe_i"), fuelB4=RR.get(g,"consumable:fuel");
    const {gains,action}=runOffline(g,225,0.0);
    ok(gains.archaeology===1,`C 维修后挖掘: 1周期(实际${gains.archaeology})`);
    ok(g.archaeology.repairUntil===0,`C: 维修完成`);
    const hp=g.archaeology.shipHp[instanceId];
    ok(hp.structure===cfgHeron.hp.structure,`C: HP恢复满`);
    ok(RR.get(g,"probe:core_probe_i")===probeB4-1,`C: 扣1探针`);
    ok(RR.get(g,"consumable:fuel")===fuelB4-2,`C: 扣2燃料(site.fuel=2)`);
    ok(Math.abs(action-45)<0.6,`C: 行动≈45s(1周期30+部分15,不含维修180)实际${action.toFixed(2)}`);
  }

  // --- D：首周期即重创（结构=1，强制失败）---
  {
    const {g,instanceId}=mkOfflineArch();
    g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:1};
    const probeB4=RR.get(g,"probe:core_probe_i");
    const {gains,action}=runOffline(g,90,0.999999);  // 90s=3周期时间，但首周期即重创
    ok(gains.archaeology===1,`D 首周期重创: 计1次尝试(实际${gains.archaeology})`);
    ok(g.archaeology.repairUntil>0 && g.archaeology.repairInstanceId===instanceId,`D: 重创后进入维修`);
    ok(RR.get(g,"probe:core_probe_i")===probeB4-1,`D: 仅扣1探针(重创后不再挖掘)`);
    ok(Math.abs(action-CYCLE)<0.6,`D: 仅1周期行动30s(实际${action.toFixed(2)})`);
  }

  // --- E：209s 边界（维修180s + 29s 部分周期，不足1周期）---
  {
    const {g,instanceId}=mkOfflineArch();
    const nowRef=Date.now();
    g.archaeology.repairUntil=nowRef-209*1000+180*1000;  // 维修剩余≈180s
    g.archaeology.repairInstanceId=instanceId;
    g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:1};
    const probeB4=RR.get(g,"probe:core_probe_i"), fuelB4=RR.get(g,"consumable:fuel");
    const {gains,action}=runOffline(g,209,0.0);
    ok(gains.archaeology===0,`E 209s边界: 维修后不足1周期→0周期`);
    ok(g.archaeology.repairUntil===0,`E: 维修完成`);
    ok(RR.get(g,"probe:core_probe_i")===probeB4,`E: 探针未扣(未完成周期)`);
    ok(RR.get(g,"consumable:fuel")===fuelB4,`E: 燃料未扣`);
    ok(g.currentAction.progress>28 && g.currentAction.progress<30,`E: 部分进度≈29s(实际${g.currentAction.progress.toFixed(2)})`);
    ok(Math.abs(action-29)<0.6,`E: 行动≈29s(实际${action.toFixed(2)})`);
  }

  // --- F：既有20s进度 + 离线10s 完成本周期（行动只计10s，非30s）---
  {
    const {g,instanceId}=mkOfflineArch({progress:20});
    g.archaeology.shipHp[instanceId]={shield:cfgHeron.hp.shield,armor:cfgHeron.hp.armor,structure:cfgHeron.hp.structure};
    const probeB4=RR.get(g,"probe:core_probe_i"), fuelB4=RR.get(g,"consumable:fuel");
    const {gains,action}=runOffline(g,10,0.0);
    ok(gains.archaeology===1,`F 20s进度+10s: 完成1周期`);
    ok(RR.get(g,"probe:core_probe_i")===probeB4-1,`F: 扣1探针`);
    ok(RR.get(g,"consumable:fuel")===fuelB4-2,`F: 扣2燃料`);
    ok(Math.abs(action-10)<0.3,`F: 行动仅计10s(remaining)非整段30s ⇒ 实际${action.toFixed(2)}`);
    ok(g.currentAction.progress===0,`F: 完成后进度清零`);
  }

  // --- G：维修中0探针（维修按墙钟完成，随后 insufficient-probe 安全停止）---
  {
    const {g,instanceId}=mkOfflineArch({probe:0});
    const nowRef=Date.now();
    g.archaeology.repairUntil=nowRef-210*1000+180*1000;  // 维修剩余≈180s
    g.archaeology.repairInstanceId=instanceId;
    g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:1};
    const {gains}=runOffline(g,210,0.0);
    ok(gains.archaeology===0,`G 维修中0探针: 0周期`);
    ok(g.archaeology.repairUntil===0,`G: 维修按墙钟完成(即使探针=0)`);
    const hp=g.archaeology.shipHp[instanceId];
    ok(hp.structure===cfgHeron.hp.structure,`G: HP恢复满`);
    ok(RR.get(g,"probe:core_probe_i")===0,`G: 探针仍为0(未负扣)`);
  }

  // --- H：维修跨越增强剂段（维修期间不扣增强剂，仅维修后行动扣）---
  {
    const {g,instanceId}=mkOfflineArch();
    const nowRef=Date.now();
    g.archaeology.repairUntil=nowRef-185*1000+180*1000;  // 维修剩余≈180s
    g.archaeology.repairInstanceId=instanceId;
    g.archaeology.shipHp[instanceId]={shield:0,armor:0,structure:1};
    g.boosters=g.boosters||{};
    g.boosters.active={ archaeologySpeed:{ itemId:"booster:relic_solver_n", remainingMs:30000 } };
    const {gains}=runOffline(g,185,0.0);
    ok(g.archaeology.repairUntil===0,`H: 维修完成`);
    const after=g.boosters.active.archaeologySpeed;
    // 维修180s绝不消耗增强剂；仅维修后≈5s部分挖掘扣≈5000ms ⇒ 剩余≈25000ms
    ok(after && after.remainingMs>20000,`H: 维修期间未扣增强剂(剩余${after?after.remainingMs:'depleted'}ms,应≈25000)`);
    ok(after && after.remainingMs<30000,`H: 维修后确有行动消耗增强剂(剩余${after?after.remainingMs:'null'}ms)`);
  }

  // --- I：batchRemaining 限制（离线300s足够10周期，但 batch=2 恰停2周期）---
  {
    const {g,instanceId}=mkOfflineArch({batch:2});
    g.archaeology.shipHp[instanceId]={shield:cfgHeron.hp.shield,armor:cfgHeron.hp.armor,structure:cfgHeron.hp.structure};
    const probeB4=RR.get(g,"probe:core_probe_i");
    const {gains}=runOffline(g,300,0.0);
    ok(gains.archaeology===2,`I batchRemaining=2: 恰好2周期(实际${gains.archaeology})`);
    ok(g.currentAction.active===false,`I: batch耗尽后行动停止`);
    ok(RR.get(g,"probe:core_probe_i")===probeB4-2,`I: 扣2探针`);
  }

  // --- 源码自检：确认本节确实使用生产版 applyOfflineGains（防止倒退为直接 resolveArchaeologyCycle）---
  {
    const selfSrc=fs.readFileSync(fileURLToPath(import.meta.url),"utf8");
    ok(/applyOffline\s*=\s*fn\("applyOfflineGains"\)/.test(selfSrc),`自检: 本节绑定生产版 applyOfflineGains`);
    ok(/applyOffline\(seconds\)/.test(selfSrc),`自检: runOffline 真实调用 applyOfflineGains(seconds)`);
    const secSrc=selfSrc.slice(selfSrc.indexOf("【六、真实离线积分测试"));
    ok(!/fCycle\(/.test(secSrc),`自检: 第六节未直接调用 resolveArchaeologyCycle(fCycle)`);
    // 检测对状态对象维修字段的"真实赋值清零"（单 = 号，非比较）：要求点号前缀锁定属性写入，
    // 排除断言里的比较文本；本行用变量拼接正则，避免自检源码自身命中字面量。
    const clearRe=new RegExp("\\.repairUntil\\s*(?<![=!<>])=(?!=)\\s*"+"0");
    ok(!clearRe.test(secSrc),`自检: 第六节未手动清维修状态`);
    // 禁止手动恢复 HP（旧审计伪造离线的手法）：不得调用 resetArchaeologyShipHp / fResetHP。
    ok(!/resetArchaeologyShipHp\s*\(|fResetHP\s*\(/.test(secSrc),`自检: 第六节未手动恢复HP(resetArchaeologyShipHp)`);
  }
}

// ==== 七、全量断言汇总 ====
section(`断言: ${pass}/${pass+fail} 通过${fail>0?` ❌ ${fail} 失败`:' ✅ 全 PASS'}`);
process.exit(fail>0?1:0);