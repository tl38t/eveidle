#!/usr/bin/env node
/* ================================================================
   考古经济审计工具 v3 — 真实连续模拟 + 边界测试
   - 加载全部游戏脚本，真实 createShipInstance + 安装装备
   - 连续 5000 次真实 resolveArchaeologyCycle（不重置 HP/干扰/维修）
   - 传递 rng 函数 + 覆盖 Math.random
   - 干扰/维修分别累计
   - 两次执行结果完全一致验证
   - 低概率掉落边界测试
   - 交叉验证偏差 <= 1%
   ================================================================ */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// ---- VM Setup ----
const noop = () => {};
class MC{}
for(const n of["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"])MC.prototype[n]=noop;
MC.prototype.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});
MC.prototype.createLinearGradient=()=>({addColorStop:noop});
MC.prototype.createRadialGradient=()=>({addColorStop:noop});
MC.prototype.getImageData=()=>({data:new Uint8ClampedArray(4)});
MC.prototype.roundRect=noop;
const cl={add:noop,remove:noop,toggle:noop,contains:()=>false};
const me=()=>({addEventListener:noop,appendChild:noop,classList:cl,click:noop,closest:()=>null,dataset:{},focus:noop,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),getContext:()=>new MC(),innerHTML:"",offsetHeight:24,offsetWidth:560,querySelector:()=>me(),querySelectorAll:()=>[],remove:noop,select:noop,style:{},textContent:"",value:"1"});

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
const sb=vm.createContext({alert:noop,Blob,confirm:()=>true,CanvasRenderingContext2D:MC,console,document:{addEventListener:noop,body:me(),createElement:()=>me(),createElementNS:()=>({...me(),setAttribute:noop}),getElementById:()=>me(),querySelector:()=>me(),querySelectorAll:()=>[]},FileReader:class{},localStorage:{getItem:()=>null,setItem:noop},requestAnimationFrame:noop,setInterval:noop,setTimeout:noop,clearTimeout:noop,URL:{createObjectURL:()=>"blob:mock",revokeObjectURL:noop},window:null});
sb.window=sb;sb.window.addEventListener=noop;
const srcs=[...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m=>m[1].replace(/\?.*$/,"").replace(/^\.\//,""));
for(const s of srcs)vm.runInContext(fs.readFileSync(path.resolve(root,s),"utf8"),sb,{filename:s});
const $=c=>vm.runInContext(c,sb);
const T=$("ARCHAEOLOGY_TIERS"),S=$("ARCHAEOLOGY_SITES"),H=$("ARCHAEOLOGY_SHIPS"),A=$("ARCHAEOLOGY_ARTIFACTS"),W=$("ARCHAEOLOGY_COMMON_WEIGHTS"),E=$("EQUIPMENT_DB");
const mkShip=$("createShipInstance"),RR=$("ResourceRegistry"),gs0=JSON.parse(JSON.stringify($("gameState")));
const fn=n=>(...a)=>$(n)(...a);
const fCycle=fn("resolveArchaeologyCycle"),fSell=fn("sellArchaeologyArtifacts"),fRedeem=fn("redeemArchaeologyArtifacts");
const fScan=fn("computeArchaeologyScanStrength"),fChance=fn("computeArchaeologySuccessChance");
const fInterf=fn("getArchaeologyInterferenceSeconds"),fFuel=fn("getArchaeologyFuelCostState"),fFitted=fn("getArchaeologyFittedBonuses");
const fResetHP=fn("resetArchaeologyShipHp"),fProfile=fn("getSiteEffectiveProfile"),fDisplay=fn("getArchaeologyDisplayState");
const EID={an:{I:"archaeo_analyzer_i",II:"archaeo_analyzer_ii",III:"archaeo_analyzer_iii",IV:"archaeo_analyzer_iv",V:"archaeo_analyzer_v"},st:{I:"archaeo_stabilizer_i",II:"archaeo_stabilizer_ii",III:"archaeo_stabilizer_iii",IV:"archaeo_stabilizer_iv",V:"archaeo_stabilizer_v"},de:{I:"archaeo_decoder_i",II:"archaeo_decoder_ii",III:"archaeo_decoder_iii",IV:"archaeo_decoder_iv",V:"archaeo_decoder_v"}};

let pass=0,fail=0;function ok(c,m){if(c)pass++;else{fail++;console.log("  FAIL:",m);}}

function makeRng(seed){let st=seed>>>0;return()=>{st=(Math.imul(st,1664525)+1013904223)>>>0;return st/4294967296;};}

function mkState(tid){
  const t=T[tid],c=H[t.ship];
  const g=JSON.parse(JSON.stringify(gs0));
  g.archaeology={activeSiteId:null,activeProbeId:"core_probe_i",progress:0,startedSiteId:null,startedProbeId:null,shipHp:{},repairUntil:0,repairInstanceId:null,interferenceUntil:0,fuelSavingRemainder:0,log:[]};
  g.skills.archaeology={lvl:t.level,xp:0};
  g.inventory.ships=[];g.shipAssignments={};g.equipment={inventory:[],instances:[],nextInstanceId:1};
  const ship=mkShip(t.ship,1000000);
  g.inventory.ships.push(ship);g.shipAssignments.archaeology=ship.instanceId;
  for(let i=0;i<c.slots.high;i++)ship.fitted.high.push(EID.an[tid]);
  for(let i=0;i<c.slots.mid;i++)ship.fitted.mid.push(EID.st[tid]);
  for(let i=0;i<c.slots.low;i++)ship.fitted.low.push(EID.de[tid]);
  RR.add(g,"consumable:fuel",1000000);RR.add(g,"probe:core_probe_i",1000000);RR.add(g,"currency:isk",0);
  return{g,t,c};
}

// site 直接传入（15 站点：5 档 × salvage/research/treasure），不再按 lpMultiplier 过滤只测一个 profile。
function runCycles(site, seed){
  const tid=site.tier;
  const{g,t,c}=mkState(tid);
  const origRandom=vm.runInContext("Math.random",sb);
  const rng=makeRng(seed);
  sb.__rng__=rng;vm.runInContext("Math.random=__rng__",sb);
  g.archaeology.activeSiteId=site.id;g.archaeology.startedSiteId=site.id;g.archaeology.startedProbeId="core_probe_i";
  g.archaeology.shipHp[g.inventory.ships[0].instanceId]={shield:c.hp.shield,armor:c.hp.armor,structure:c.hp.structure};
  const[pB,fB,iB,xB]=[RR.get(g,"probe:core_probe_i"),RR.get(g,"consumable:fuel"),RR.get(g,"currency:isk"),g.skills.archaeology.xp];
  let succ=0,fail=0,destr=0,insuf=0,actS=0,intS=0,repS=0,simNow=1000000;
  for(let i=0;i<5000;i++){
    if(g.archaeology.repairUntil>simNow){simNow=g.archaeology.repairUntil;if(g.archaeology.repairInstanceId)fResetHP(g,g.archaeology.repairInstanceId);g.archaeology.repairUntil=0;continue;}
    if(g.archaeology.interferenceUntil>simNow){simNow=g.archaeology.interferenceUntil;continue;}
    simNow+=site.time*1000;
    const res=fCycle(g,simNow,rng);
    if(res.reason==="insufficient"){insuf++;break;}
    actS+=site.time;
    if(res.success){succ++;}else{fail++;if(res.destroyed){destr++;repS+=180;}else{intS+=Number(fInterf(site,0));}}
  }
  sb.__rngr__=origRandom;vm.runInContext("Math.random=__rngr__",sb);
  // 独特遗物计数必须在出售前（sell 会把 unique 一并折算 ISK 清空库存）。
  const uniqueCount=A.filter(a=>a.tier===tid&&a.category==="unique").reduce((s,a)=>s+RR.get(g,"artifact:"+a.id),0);
  fSell(g,null,0,true);const isk=RR.get(g,"currency:isk")-iB;
  fRedeem(g,null,0,true);const lp=RR.get(g,"currency:lp");
  const ca=A.filter(a=>a.tier===tid&&a.category==="calibration").reduce((s,a)=>s+RR.get(g,"calibration:"+a.id),0);
  const xp=g.skills.archaeology.xp-xB;
  const probeSpent=pB-RR.get(g,"probe:core_probe_i");
  const fuelSpent=fB-RR.get(g,"consumable:fuel");
  const wallS=actS+intS+repS;
  return{succ,fail,destr,insuf,actS,intS,repS,wallS,isk,lp,ca,uniqueCount,xp,probeSpent,fuelSpent};
}

function audit(site){
  const tid=site.tier;
  // 固定种子连续模拟 + 确定性复现
  const r1=runCycles(site,12345678);
  const r2=runCycles(site,12345678);
  const keys=["succ","fail","destr","actS","intS","repS","wallS","isk","lp","ca","uniqueCount","xp","probeSpent","fuelSpent"];
  let match=true;
  for(const k of keys)if(r1[k]!==r2[k]){match=false;console.log(`  DET-MISMATCH ${site.id} ${k}: ${r1[k]} vs ${r2[k]}`);}
  ok(match,`${site.id} 两次执行完全一致`);

  const r=r1;
  const tier=T[tid];
  // 扫描/成功率验证：设计保证 扫描=难度
  const pState=mkState(tid);
  pState.g.skills.archaeology={lvl:T[tid].level,xp:0};
  const scanStart=fScan(pState.g,pState.g.inventory.ships[0],"core_probe_i");
  ok(scanStart===site.difficulty,`${site.id} 扫描(${scanStart})==难度(${site.difficulty})`);
  // 每次真实行动消耗1探针，跳过(维修/干扰)的周期不消耗 → probeSpent = succ+fail
  const totalCompleted=r.succ+r.fail;
  ok(totalCompleted<=5000,`${site.id} 完成${totalCompleted}<=5000`);
  ok(r.probeSpent===totalCompleted,`${site.id} 探针${r.probeSpent}==完成${totalCompleted}`);
  ok(r.insuf===0,`${site.id} 无insufficient`);
  ok(r.destr>0,`${site.id} 损毁${r.destr}>0`);
  ok(r.repS===r.destr*180,`${site.id} 维修${r.repS}===${r.destr}*180`);
  const wallS=r.actS+r.intS+r.repS;
  ok(r.wallS===wallS,`${site.id} 墙钟${r.wallS}===主动${r.actS}+干扰${r.intS}+维修${r.repS}`);

  // ==== 与纯预览交叉验证（真实生产选择器 getArchaeologyDisplayState）====
  // 预览给出「每次成功期望 ISK」(=普通×(1+译码器) + 有效独特率×独特均值)，与本 profile 权重/倍率同源；
  // 用真实 succ 折算，真实 ISK 应落在 3% 偏差内。此路径同时校验普通权重、译码器、profile 独特倍率。
  const dispState=mkState(tid).g;
  dispState.skills.archaeology={lvl:T[tid].level,xp:0};
  const disp=fDisplay(dispState,1000000);
  const pv=disp.sites.find(s=>s.id===site.id);
  ok(!!(pv&&pv.preview),`${site.id} 纯预览存在`);
  const previewIskPerSuccess=pv.preview.expectedCommonIskPerSuccess+pv.preview.expectedUniqueIskPerSuccess;
  const formulaIsk=r.succ*previewIskPerSuccess;
  const dev=r.isk>0?Math.abs(r.isk-formulaIsk)/r.isk*100:0;
  ok(dev<=3,`${site.id} 预览ISK/成功×成功数 vs 真实ISK 偏差${dev.toFixed(3)}%<=3%`);

  // ==== 独特遗物交叉验证：每次成功掷一次(uniform)，期望独特数 = succ × 有效独特率 ====
  const prof=fProfile(site,tier);
  const effUniqueRate=prof&&typeof prof.effectiveUniqueRate==="number"?prof.effectiveUniqueRate:tier.uniqueRate;
  const expUnique=r.succ*effUniqueRate;
  if(expUnique>=50){
    const uDev=Math.abs(r.uniqueCount-expUnique)/expUnique*100;
    ok(uDev<=15,`${site.id} 独特遗物 ${r.uniqueCount} vs 期望 ${expUnique.toFixed(1)}(率${(effUniqueRate*100).toFixed(1)}%) 偏差${uDev.toFixed(2)}%<=15%`);
  }else{
    ok(Math.abs(r.uniqueCount-expUnique)<=20,`${site.id} 独特遗物 ${r.uniqueCount} vs 期望 ${expUnique.toFixed(1)}(小样本) 绝对差<=20`);
  }
  // 预览独特率 = profile 有效独特率（生产选择器一致性）
  ok(Math.abs(pv.preview.effectiveUniqueRate-effUniqueRate*100)<=0.05,`${site.id} 预览独特率${pv.preview.effectiveUniqueRate}%≈有效率${(effUniqueRate*100).toFixed(1)}%`);

  const completed=r.succ+r.fail;
  const actRate=completed>0?r.succ/completed:0;
  const simH=r.wallS>0?r.isk/r.wallS*3600:0;
  const formulaH=r.wallS>0?formulaIsk/r.wallS*3600:0;
  const lpH=r.wallS>0?r.lp/r.wallS*3600:0;
  const calH=r.wallS>0?r.ca/r.wallS*3600:0;
  const uniqueH=r.wallS>0?r.uniqueCount/r.wallS*3600:0;
  return{id:site.id,tid,profile:site.profile,succ:r.succ,fail:r.fail,destr:r.destr,actS:r.actS,intS:r.intS,repS:r.repS,wallS:r.wallS,isk:r.isk,lp:r.lp,cal:r.ca,uniqueCount:r.uniqueCount,xp:r.xp,simH,formulaH,dev,lpH,calH,uniqueH,actRate};
}

// ======================== 边界测试 ========================
console.log("=".repeat(100));
console.log("  考古经济审计 v3 — 真实连续模拟 + 边界测试");
console.log("=".repeat(100));

// 低概率边界测试（在独立沙箱环境下）
(function testBoundary(){
  console.log("\n【低概率掉落边界测试】");
  sb.__rng__=()=>0.3;vm.runInContext("Math.random=__rng__",sb);

  // 成功掷点走 Math.random（=0.3，必成功）；掉落走注入 rng。
  // 用恒定 rng 精确控制 unique 掷点，避免依赖 common/decoder/extra 的抽取次数（旧序列法脆弱）。
  // 有效独特率取自真实 profile（生产同源），验证严格 < 比较：略低于有效率→必掉，恰等于→不掉。
  const site=S.find(s=>s.tier==="I"&&s.lpMultiplier===1.0);
  const profI=fProfile(site,T.I);
  const effRI=profI&&typeof profI.effectiveUniqueRate==="number"?profI.effectiveUniqueRate:T.I.uniqueRate;
  const below=effRI*0.99;   // 恒定 rng 略低于有效率 → uniqueRoll<effRate → 必掉
  const atRate=effRI;       // 恒定 rng 恰等于有效率 → uniqueRoll<effRate 为 false → 不掉

  const{g}=mkState("I");
  g.archaeology.activeSiteId=site.id;g.archaeology.startedSiteId=site.id;g.archaeology.startedProbeId="core_probe_i";
  g.archaeology.shipHp[g.inventory.ships[0].instanceId]={shield:100,armor:100,structure:100};
  RR.add(g,"consumable:fuel",10000);RR.add(g,"probe:core_probe_i",10000);
  fCycle(g,2000000,()=>below);
  const u=A.filter(a=>a.tier==="I"&&a.category==="unique").reduce((s,a)=>s+RR.get(g,"artifact:"+a.id),0);
  ok(u>0,`unique掷点${below.toFixed(5)}<有效率${effRI}→掉落(${u})>0`);
  fSell(g,null,0,true);
  ok(RR.get(g,"currency:isk")>0,"sell→ISK>0");

  const{g:g2}=mkState("I");
  g2.archaeology.activeSiteId=site.id;g2.archaeology.startedSiteId=site.id;g2.archaeology.startedProbeId="core_probe_i";
  g2.archaeology.shipHp[g2.inventory.ships[0].instanceId]={shield:100,armor:100,structure:100};
  RR.add(g2,"consumable:fuel",10000);RR.add(g2,"probe:core_probe_i",10000);
  fCycle(g2,3000000,()=>atRate);
  const u2=A.filter(a=>a.tier==="I"&&a.category==="unique").reduce((s,a)=>s+RR.get(g2,"artifact:"+a.id),0);
  ok(u2===0,`unique掷点${atRate}==有效率${effRI}→不掉(${u2})===0`);
})();

// ======================== 15 站点审计（5 档 × salvage/research/treasure）========================
const PROFILE_ORDER={salvage:0,research:1,treasure:2};
const PROFILE_LABEL={salvage:"打捞",research:"研究",treasure:"宝库"};
const TIER_ORDER={I:0,II:1,III:2,IV:3,V:4};
const auditSites=S.slice().sort((a,b)=>(TIER_ORDER[a.tier]-TIER_ORDER[b.tier])||((PROFILE_ORDER[a.profile]??9)-(PROFILE_ORDER[b.profile]??9)));
ok(auditSites.length===15,`站点总数=15（实际 ${auditSites.length}）`);
const results=auditSites.map(s=>audit(s));

console.log("\n【一、基础数据（15 站点）】");
console.log("-".repeat(120));
console.log("  档-profile        成功 失败 损毁 主动秒 干扰秒 维修秒 墙钟秒 总ISK      LP  校准 独特  XP");
for(const r of results){
  const tag=`${r.tid}-${PROFILE_LABEL[r.profile]||r.profile}`;
  console.log(`  ${tag.padEnd(16)} ${String(r.succ).padStart(4)} ${String(r.fail).padStart(4)} ${String(r.destr).padStart(4)} ${String(r.actS).padStart(7)} ${String(r.intS).padStart(6)} ${String(r.repS).padStart(6)} ${String(r.wallS).padStart(7)} ${String(Math.round(r.isk)).padStart(9)} ${String(r.lp).padStart(5)} ${String(r.cal).padStart(4)} ${String(r.uniqueCount).padStart(4)} ${String(Math.round(r.xp)).padStart(6)}`);
}

console.log("\n【二、纯预览交叉验证(<=3%)】");
for(const r of results){
  console.log(`  ${(r.tid+"-"+(PROFILE_LABEL[r.profile]||r.profile)).padEnd(16)} 模拟ISK/h=${Math.round(r.simH).toLocaleString().padStart(11)} 预览ISK/h=${Math.round(r.formulaH).toLocaleString().padStart(11)} 偏差=${r.dev.toFixed(3)}% ${r.dev<=3?'✅':'❌'}`);
}

console.log("\n【三、墙钟每小时收益】");
console.log("-".repeat(96));
console.log("  档-profile        墙钟ISK/h       LP/h    校准/h    独特/h   成功率% 损毁");
for(const r of results){
  const tag=`${r.tid}-${PROFILE_LABEL[r.profile]||r.profile}`;
  console.log(`  ${tag.padEnd(16)} ${Math.round(r.simH).toLocaleString().padStart(13)} ${r.lpH.toFixed(2).padStart(7)} ${r.calH.toFixed(4).padStart(10)} ${r.uniqueH.toFixed(4).padStart(9)} ${(r.actRate*100).toFixed(1).padStart(6)} ${String(r.destr).padStart(5)}`);
}

console.log(`\n断言: ${pass}/${pass+fail} 通过 ${fail>0?`❌ ${fail} 失败`:'✅ 全 PASS'}`);
process.exit(fail>0?1:0);
