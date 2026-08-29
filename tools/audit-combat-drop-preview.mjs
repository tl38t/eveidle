#!/usr/bin/env node
// 审计：战斗 / 死亡空间掉落预览（Phase 3D 其他任务）
// 验证 getCombatDropPreview 纯函数输出与生产 roll* 系列掉落结算完全一致（同源字段 + 频率交叉验证）。
// 不修改任何游戏数值，仅做只读校验。
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const noop = () => {};
function makeRng(s){let st=s>>>0;return()=>{st=(Math.imul(st,1664525)+1013904223)>>>0;return st/4294967296;}};
class MC{} for(const n of["arc","beginPath","clearRect","clip","fill","fillRect","fillText","lineTo","moveTo","rect","restore","save","scale","setTransform","stroke","strokeText"])MC.prototype[n]=noop;
MC.prototype.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}); MC.prototype.createRadialGradient=()=>({addColorStop:noop}); MC.prototype.getImageData=()=>({data:new Uint8ClampedArray(4)}); MC.prototype.roundRect=noop;
const cl={add:noop,remove:noop,toggle:noop,contains:()=>false};
// 桩补全（2026-08-29）：Batch P 教程小部件 renderTutorialWidget 会对元素调 setAttribute /
// removeAttribute / contains / setProperty，此前桩缺这些方法导致审计在 shell-render 阶段即崩。
const me=()=>({addEventListener:noop,appendChild:noop,append:noop,classList:cl,click:noop,closest:()=>null,contains:()=>false,dataset:{},focus:noop,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),getContext:()=>new MC(),innerHTML:"",insertBefore:noop,offsetHeight:24,offsetWidth:560,parentNode:{insertBefore:noop,appendChild:noop,removeChild:noop,classList:cl},querySelector:()=>me(),querySelectorAll:()=>[],remove:noop,removeAttribute:noop,removeChild:noop,select:noop,setAttribute:noop,style:{setProperty:noop},textContent:"",value:"1"});
// 持久元素捕获（供 UI 渲染测试读取 innerHTML）
// combat-drop-preview-wrap 是 details 元素：renderCombatDropPreview 的「折叠即跳过渲染」
// 优化会读 wrap.open，桩默认 undefined → 提前 return 0 字符（2026-08-29 桩补全：默认展开）。
const els={}; const getEl=id=>{ if(!els[id]){ els[id]=me(); if(id==="combat-drop-preview-wrap") els[id].open=true; } return els[id]; };
const sb=vm.createContext({alert:noop,Blob,confirm:()=>true,CanvasRenderingContext2D:MC,console,document:{addEventListener:noop,body:me(),createElement:()=>me(),createElementNS:()=>({...me(),setAttribute:noop}),getElementById:getEl,querySelector:()=>me(),querySelectorAll:()=>[]},FileReader:class{},Image:class{},localStorage:{getItem:()=>null,setItem:noop},matchMedia:()=>({matches:false,addEventListener:noop,addListener:noop,removeListener:noop}),MutationObserver:class{observe(){}disconnect(){}takeRecords(){return[]}},requestAnimationFrame:noop,setInterval:noop,setTimeout:noop,clearTimeout:noop,URL:{createObjectURL:()=>"blob:mock",revokeObjectURL:noop},window:null}); sb.window=sb; sb.window.addEventListener=noop;
const srcs=[...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m=>m[1].replace(/\?.*$/,"").replace(/^\.\//,""));
for(const s of srcs) vm.runInContext(fs.readFileSync(path.resolve(root,s),"utf8"),sb,{filename:s});
const $=c=>vm.runInContext(c,sb);
const COMBAT_ZONES=$("COMBAT_ZONES"), DEATHSPACE_DATABASE=$("DEATHSPACE_DATABASE"), FACTION_ENCRYPTED_DATA_DROPS=$("FACTION_ENCRYPTED_DATA_DROPS");
const TACTICAL_BY_LAYER=$("TACTICAL_MATERIAL_BY_LAYER"), TACTICAL_MATERIALS=$("TACTICAL_MATERIALS");
const fPreview=$("getCombatDropPreview"), fDisplay=$("getCombatDisplayState");
const fEncrypted=fn("rollFactionEncryptedDataDrop"), fSpecial=fn("rollCombatZoneSpecialDrops"), fTicket=fn("rollDeathspaceTicketDrop"), fLeader=fn("rollDeathspaceLeaderLoot"), fTactical=fn("rollTacticalMaterialDrop");
function fn(n){return(...a)=>$(n)(...a);}
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  FAIL:",m);}}
function section(s){console.log(`\n${s}`);}
const TRIALS=4000;
// 频率容差：Monte Carlo 噪声 ±2%
function rateOk(observed,expected,tol){ const dev=Math.abs(observed-expected); return dev<=tol; }

// ==== 一、星带加密数据预览 ↔ 生产 ====
section("【一、星带加密数据：预览概率 = 生产掉落频率】");
for(const zone of COMBAT_ZONES){
  const prev=fPreview(null,{mode:"belt",zoneId:zone.id});
  if(zone.encryptedDataDisabled){
    ok(prev.encryptedData===null,`${zone.id} 禁用加密数据 → preview.encryptedData===null`);
    const drop=fEncrypted(zone.faction,"elite",0.0,zone); // 强制命中也不应掉落
    ok(drop===null,`${zone.id} 生产 rollFactionEncryptedDataDrop 禁用返回 null`);
    continue;
  }
  ok(prev.encryptedData && typeof prev.encryptedData.eliteChance==="number" && typeof prev.encryptedData.bossChance==="number",`${zone.id} 有加密数据概率字段`);
  const mat=zone.encryptedDataMaterial||FACTION_ENCRYPTED_DATA_DROPS[zone.faction].material;
  ok(prev.encryptedData.material===mat,`${zone.id} 加密数据材料=${mat}`);
  // elite 频率
  const rngE=makeRng(11);
  let eHit=0; for(let i=0;i<TRIALS;i++){ const r=fEncrypted(zone.faction,"elite",rngE(),zone); if(r) eHit++; }
  ok(rateOk(eHit/TRIALS,prev.encryptedData.eliteChance,0.02),`${zone.id} elite 频率 ${(eHit/TRIALS*100).toFixed(2)}% ≈ 预览 ${prev.encryptedData.eliteChance*100}%`);
  // boss 频率
  const rngB=makeRng(22);
  let bHit=0; for(let i=0;i<TRIALS;i++){ const r=fEncrypted(zone.faction,"boss",rngB(),zone); if(r) bHit++; }
  ok(rateOk(bHit/TRIALS,prev.encryptedData.bossChance,0.02),`${zone.id} boss 频率 ${(bHit/TRIALS*100).toFixed(2)}% ≈ 预览 ${prev.encryptedData.bossChance*100}%`);
  // 普通怪不掉落
  const nDrop=fEncrypted(zone.faction,"normal",0.0,zone);
  ok(nDrop===null,`${zone.id} 普通怪不掉落加密数据`);
}

// ==== 二、星带特殊掉落预览 ↔ 生产 ====
section("【二、星带特殊掉落：预览 = 生产】");
for(const zone of COMBAT_ZONES){
  const prev=fPreview(null,{mode:"belt",zoneId:zone.id});
  if(!zone.specialDrops || zone.specialDrops.length===0){
    ok(prev.zoneSpecialDrops && prev.zoneSpecialDrops.length===0,`${zone.id} 无特殊掉落 → preview 空数组`);
    continue;
  }
  ok(prev.zoneSpecialDrops.length===zone.specialDrops.length,`${zone.id} 特殊掉落条数一致(${prev.zoneSpecialDrops.length})`);
  for(let i=0;i<zone.specialDrops.length;i++){
    const cfg=zone.specialDrops[i], p=prev.zoneSpecialDrops[i];
    const expMat=cfg.material||(cfg.resourceId||"").split(":").slice(1).join(":")||cfg.resourceId;
    ok(p.material===expMat,`${zone.id}[${i}] 材料=${expMat}`);
    ok(p.qty===Math.max(1,Number(cfg.qty)||1),`${zone.id}[${i}] 数量=${p.qty}`);
    ok(p.eliteChance===(Number(cfg.chances&&cfg.chances.elite)||0),`${zone.id}[${i}] elite概率=${(Number(cfg.chances&&cfg.chances.elite)||0)}`);
    ok(p.bossChance===(Number(cfg.chances&&cfg.chances.boss)||0),`${zone.id}[${i}] boss概率=${(Number(cfg.chances&&cfg.chances.boss)||0)}`);
    // 生产：boss 强制命中
    const prod=fSpecial(zone,"boss",[0.0]);
    const hit=prod.find(d=>d.material===expMat);
    ok(hit && hit.qty===p.qty,`${zone.id}[${i}] 生产 boss 命中材料/数量一致`);
    // 生产：普通怪不掉落
    const nProd=fSpecial(zone,"normal",[0.0]);
    ok(nProd.length===0,`${zone.id}[${i}] 普通怪不掉落特殊物`);
  }
}

// ==== 三、星带通行密钥预览 ↔ 生产 ====
section("【三、星带通行密钥：预览 = 生产】");
for(const zone of COMBAT_ZONES){
  const prev=fPreview(null,{mode:"belt",zoneId:zone.id});
  const site=DEATHSPACE_DATABASE.find(s=>s.sourceZoneId===zone.id);
  if(!site){
    ok(prev.ticketDrop===null,`${zone.id} 无来源死亡空间 → preview.ticketDrop===null`);
    const t=fTicket(zone,"boss",0.0);
    ok(t===null,`${zone.id} 生产 rollDeathspaceTicketDrop 返回 null`);
    continue;
  }
  ok(prev.ticketDrop && prev.ticketDrop.deathspaceId===site.id,`${zone.id} 密钥来源=${site.id}`);
  ok(prev.ticketDrop.material===site.ticketMaterial,`${zone.id} 密钥材料=${site.ticketMaterial}`);
  ok(prev.ticketDrop.eliteChance===site.ticketChances.elite && prev.ticketDrop.bossChance===site.ticketChances.boss,`${zone.id} 密钥概率 ${site.ticketChances.elite}/${site.ticketChances.boss}`);
  // 生产频率（boss）
  const rng=makeRng(33); let hit=0;
  for(let i=0;i<TRIALS;i++){ if(fTicket(zone,"boss",rng())) hit++; }
  ok(rateOk(hit/TRIALS,site.ticketChances.boss,0.02),`${zone.id} 密钥 boss 频率 ${(hit/TRIALS*100).toFixed(2)}% ≈ ${site.ticketChances.boss*100}%`);
  // 普通怪不掉落
  ok(fTicket(zone,"normal",0.0)===null,`${zone.id} 普通怪不掉落密钥`);
}

// ==== 四、死亡空间首领战利品预览 ↔ 生产 ====
section("【四、死亡空间首领战利品：预览 = 生产】");
for(const site of DEATHSPACE_DATABASE){
  const prev=fPreview(null,{mode:"deathspace",deathspaceId:site.id});
  ok(prev.valid && prev.mode==="deathspace",`${site.id} preview 有效且 mode=deathspace`);
  ok(prev.encryptedData===null && prev.zoneSpecialDrops===null && prev.ticketDrop===null,`${site.id} 死亡空间无加密数据/特殊掉落/密钥`);
  ok(prev.leaderLoot.length===site.waves.length,`${site.id} 首领层数与 waves 一致(${site.waves.length})`);
  for(let i=0;i<site.waves.length;i++){
    const w=site.waves[i], p=prev.leaderLoot[i];
    ok(p.wave===i+1,`${site.id} 第 ${i+1} 层 wave 序号正确`);
    ok(p.coreMaterial===site.coreMaterial,`${site.id}[${i}] core材料=${site.coreMaterial}`);
    ok(p.coreChance===(w.coreChance||0),`${site.id}[${i}] core概率=${w.coreChance||0}`);
    // 生产：core 命中（coreRoll 略低于阈值）
    const coreHit=fLeader(site,i+1,(w.coreChance||0)-0.001,0.0);
    ok(coreHit.some(d=>d.material===site.coreMaterial),`${site.id}[${i}] 生产 core 命中`);
    const coreMiss=fLeader(site,i+1,(w.coreChance||0)+0.001,0.0);
    ok(!coreMiss.some(d=>d.material===site.coreMaterial),`${site.id}[${i}] 生产 core 未命中（高于阈值）`);
    if(w.final){
      ok(p.isFinal===true && p.protocolMaterial===site.protocolMaterial && p.protocolChance===(site.protocolChance||0),`${site.id}[${i}] 最终层 protocol=${site.protocolMaterial}/${site.protocolChance}`);
      const protHit=fLeader(site,i+1,0.0,(site.protocolChance||0)-0.001);
      ok(protHit.some(d=>d.material===site.protocolMaterial),`${site.id}[${i}] 生产 protocol 命中`);
      const protMiss=fLeader(site,i+1,0.0,(site.protocolChance||0)+0.001);
      ok(!protMiss.some(d=>d.material===site.protocolMaterial),`${site.id}[${i}] 生产 protocol 未命中`);
    } else {
      ok(p.isFinal===false && p.protocolMaterial===null && p.protocolChance===0,`${site.id}[${i}] 非最终层无 protocol`);
      const noProt=fLeader(site,i+1,0.0,0.0);
      ok(!noProt.some(d=>d.material===site.protocolMaterial),`${site.id}[${i}] 非最终层永不掉 protocol`);
    }
  }
}

// ==== 五、战术材料预览 ↔ 生产（星带 + 死亡空间）====
section("【五、战术材料：预览 = 生产（含安全层映射）】");
for(const zone of COMBAT_ZONES){
  const prev=fPreview(null,{mode:"belt",zoneId:zone.id});
  const layer=zone.formationPool;
  const matId=TACTICAL_BY_LAYER[layer];
  ok(prev.tacticalMaterial && prev.tacticalMaterial.materialId===matId,`${zone.id} 战术材料安全层=${layer} → ${matId}`);
  ok(prev.tacticalMaterial.securityLayer===layer,`${zone.id} 战术材料.securityLayer=formationPool`);
  const meta=TACTICAL_MATERIALS.find(m=>m.id===matId);
  ok(prev.tacticalMaterial.materialName===meta.name && prev.tacticalMaterial.tier===meta.tier,`${zone.id} 战术材料名/档=${meta.name}/${meta.tier}`);
  // 普通怪 ~70%
  const rngN=makeRng(44); let nHit=0;
  for(let i=0;i<TRIALS;i++){ if(fTactical(zone,"normal",rngN())) nHit++; }
  ok(rateOk(nHit/TRIALS,0.70,0.03),`${zone.id} 普通怪战术材料频率 ${(nHit/TRIALS*100).toFixed(2)}% ≈ 70%`);
  // elite 100% 数量 2~3
  const e=fTactical(zone,"elite",()=>0.0);
  ok(e && e.quantity>=2 && e.quantity<=3 && e.materialId===matId,`${zone.id} elite 战术数量 ${e.quantity} ∈[2,3]`);
  // boss 100% 数量 6~10
  const b=fTactical(zone,"boss",()=>0.0);
  ok(b && b.quantity>=6 && b.quantity<=10 && b.materialId===matId,`${zone.id} boss 战术数量 ${b.quantity} ∈[6,10]`);
}
for(const site of DEATHSPACE_DATABASE){
  const prev=fPreview(null,{mode:"deathspace",deathspaceId:site.id});
  const srcZone=COMBAT_ZONES.find(z=>z.id===site.sourceZoneId);
  ok(prev.tacticalMaterial && prev.tacticalMaterial.securityLayer===srcZone.formationPool,`${site.id} 死亡空间战术材料层=来源星带层(${srcZone.formationPool})`);
  ok(prev.tacticalMaterial.materialId===TACTICAL_BY_LAYER[srcZone.formationPool],`${site.id} 死亡空间战术材料=${TACTICAL_BY_LAYER[srcZone.formationPool]}`);
}

// ==== 六、结构完整性（每个星带/死亡空间 preview 合法）====
section("【六、getCombatDropPreview 结构完整性】");
ok(COMBAT_ZONES.length>0 && DEATHSPACE_DATABASE.length>0,"数据非空");
for(const zone of COMBAT_ZONES){
  const p=fPreview(null,{mode:"belt",zoneId:zone.id});
  ok(p.valid && p.mode==="belt" && p.zoneId===zone.id && p.name===zone.name && p.faction===zone.faction,`${zone.id} belt 结构完整`);
}
for(const site of DEATHSPACE_DATABASE){
  const p=fPreview(null,{mode:"deathspace",deathspaceId:site.id});
  ok(p.valid && p.mode==="deathspace" && p.deathspaceId===site.id && p.name===site.name,`${site.id} deathspace 结构完整`);
}
// 非法 deathspaceId
const bad=fPreview(null,{mode:"deathspace",deathspaceId:"__nope__"});
ok(bad.valid===false,`非法 deathspaceId → valid=false`);
ok(bad.mode==="deathspace" && bad.reason==="unknown-deathspace",`非法 deathspaceId → reason=unknown-deathspace`);

// ==== 七、UI 渲染（renderCombatDropPreview）不抛错且含关键字段 ====
section("【七、UI 渲染 renderCombatDropPreview】");
// 桩补全（2026-08-29）：renderCombatDropPreview 的「折叠即跳过渲染」优化会先读
// wrap.open（details 元素属性），桩对象默认 undefined → 提前 return 导致 0 字符。展开状态为 true。
if (els["combat-drop-preview-wrap"]) els["combat-drop-preview-wrap"].open = true;
const fRenderUI=$("renderCombatDropPreview");
// 重置 gameState 到 clean（函数内部使用 sandbox gameState）
const dispBelt=fDisplay($("gameState"),Date.now());
try{
  fRenderUI(dispBelt);
  const htmlBelt=els["combat-drop-preview"] && els["combat-drop-preview"].innerHTML || "";
  ok(htmlBelt.length>0,`belt 渲染产出非空 HTML(${htmlBelt.length}字符)`);
  ok(/海盗星带/.test(htmlBelt),`belt 渲染含模式标签`);
  const zb=fPreview(null,{mode:"belt",zoneId:dispBelt.zone.id});
  if(zb.encryptedData) ok(htmlBelt.includes(zb.encryptedData.material),`belt 渲染含加密数据材料 ${zb.encryptedData.material}`);
  if(zb.tacticalMaterial) ok(htmlBelt.includes(zb.tacticalMaterial.materialName),`belt 渲染含战术材料 ${zb.tacticalMaterial.materialName}`);
  console.log(`    belt 预览(${zb.name}) 渲染 OK`);
}catch(err){ ok(false,"belt 渲染抛错: "+err.message); }
// 死亡空间模式显示
const gs=$("gameState"); gs.combat.viewMode="deathspace"; gs.combat.viewDeathspaceId=DEATHSPACE_DATABASE[0].id; gs.combat.deathspaceId=DEATHSPACE_DATABASE[0].id;
const dispDS=fDisplay(gs,Date.now());
try{
  fRenderUI(dispDS);
  const htmlDS=els["combat-drop-preview"] && els["combat-drop-preview"].innerHTML || "";
  ok(htmlDS.length>0,`deathspace 渲染产出非空 HTML`);
  ok(/死亡空间/.test(htmlDS),`deathspace 渲染含模式标签`);
  const zd=fPreview(null,{mode:"deathspace",deathspaceId:dispDS.deathspace.id});
  ok(htmlDS.includes(zd.leaderLoot[0].coreMaterial),`deathspace 渲染含首领核心材料 ${zd.leaderLoot[0].coreMaterial}`);
  if(zd.tacticalMaterial) ok(htmlDS.includes(zd.tacticalMaterial.materialName),`deathspace 渲染含战术材料`);
  console.log(`    deathspace 预览(${zd.name}) 渲染 OK`);
}catch(err){ ok(false,"deathspace 渲染抛错: "+err.message); }

// ==== 八、fail-closed 非法 ID + 0 概率覆盖边界（Part 2 / Part 3）====
section("【八、fail-closed 非法 ID + 0 概率覆盖边界】");
// 8.1 非法 zoneId（belt）→ 不回退首个星带，返回 valid:false / reason:unknown-zone
const badZone=fPreview(null,{mode:"belt",zoneId:"__no_such_zone__"});
ok(badZone.valid===false && badZone.mode==="belt" && badZone.reason==="unknown-zone",`非法 zoneId → {mode:belt,valid:false,reason:unknown-zone}`);
ok(badZone.zoneId===undefined || badZone.zoneId==="__no_such_zone__" ? true : false,`非法 zoneId → 不携带任何真实星带字段`);
ok(!badZone.encryptedData && !badZone.tacticalMaterial && !badZone.zoneSpecialDrops && !badZone.ticketDrop,`非法 zoneId → 不返回任何掉落配置（无首带数据泄漏）`);
// 空 zoneId 亦 fail-closed
const emptyZone=fPreview(null,{mode:"belt",zoneId:""});
ok(emptyZone.valid===false && emptyZone.reason==="unknown-zone",`空 zoneId → reason=unknown-zone`);

// 8.2 死亡空间存在但 sourceZoneId 非法 → reason:unknown-source-zone（注入合成站点，跑完前面循环后再注入，避免污染）
const synthDS={
  id:"__ds_bad_source__", name:"合成坏来源死亡空间", sourceZoneId:"__no_such_source__",
  ticketMaterial:"测试密钥", ticketChances:{elite:0.01,boss:0.05},
  coreMaterial:"测试核心", protocolMaterial:"测试协议", protocolChance:0.01,
  maxWave:1, waves:[{name:"合成波",final:true,coreChance:0.1}]
};
DEATHSPACE_DATABASE.push(synthDS);
const badSrc=fPreview(null,{mode:"deathspace",deathspaceId:synthDS.id});
ok(badSrc.valid===false && badSrc.mode==="deathspace" && badSrc.reason==="unknown-source-zone",`死亡空间来源星带非法 → {mode:deathspace,valid:false,reason:unknown-source-zone}`);
ok(!badSrc.leaderLoot && !badSrc.tacticalMaterial,`来源星带非法 → 不构造 leaderLoot/tacticalMaterial`);
DEATHSPACE_DATABASE.pop(); // 复原，避免影响后续/其它运行

// 8.3 0 概率覆盖边界：encryptedDataChances {elite:0, boss:0} 合法 0 不被 base 覆盖
const fEncCfg=$("getEncryptedDataDropConfig");
const baseZone=COMBAT_ZONES.find(z=>!z.encryptedDataDisabled && FACTION_ENCRYPTED_DATA_DROPS[z.faction]) || COMBAT_ZONES[0];
const zeroZone={...baseZone, id:"__zone_zero_prob__", encryptedDataDisabled:false, encryptedDataChances:{elite:0,boss:0}};
const zeroCfg=fEncCfg(zeroZone);
ok(zeroCfg && zeroCfg.eliteChance===0 && zeroCfg.bossChance===0,`0 概率覆盖 → 配置 eliteChance=0 & bossChance=0（未被 base 覆盖）`);
// 预览与生产均为 0：强制命中 roll=0 也不掉落
const zeroElite=fEncrypted(zeroZone.faction,"elite",0.0,zeroZone);
const zeroBoss=fEncrypted(zeroZone.faction,"boss",0.0,zeroZone);
ok(zeroElite===null && zeroBoss===null,`0 概率覆盖 → 生产 rollFactionEncryptedDataDrop 精英/BOSS 强制命中仍返回 null`);
// 只覆盖 elite=0，boss 仍取 base（验证部分覆盖不误伤另一档）
const baseCfg=fEncCfg({...baseZone, id:"__base__", encryptedDataDisabled:false, encryptedDataChances:undefined});
const partialZone={...baseZone, id:"__zone_partial__", encryptedDataDisabled:false, encryptedDataChances:{elite:0}};
const partialCfg=fEncCfg(partialZone);
ok(partialCfg && partialCfg.eliteChance===0 && partialCfg.bossChance===baseCfg.bossChance,`部分覆盖(elite:0) → elite=0 而 boss 保持 base(${baseCfg.bossChance})`);

console.log(`\n==== 战斗掉落预览审计：${pass} 通过 / ${fail} 失败 ====`);
console.log(fail===0 ? "✅ ALL PASS" : "❌ 存在失败");
process.exit(fail===0?0:1);
