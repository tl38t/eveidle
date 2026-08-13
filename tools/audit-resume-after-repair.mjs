#!/usr/bin/env node
// ============================================================================
// audit-resume-after-repair.mjs — Phase 3D(修正) 维修后自动恢复(resumeAfterRepair)行为审计
// ----------------------------------------------------------------------------
// 最终战斗重创规则(策划纠正)：战斗舰重创 → 本次 run 立即失败并清零遭遇进度。
//   无论普通星带还是死亡空间，维修完成后都只返回普通星带、从第 1 波开始全新一轮肃清。
//   死亡空间永不续原副本、绝不重进(enterDeathspace)、通行密钥不返还也不再扣。
//
//   A 区 迁移 fail-closed(persistence.migrateArchaeologyState)：
//        combat 标记严格校验 returnZoneId∈COMBAT_ZONES、defeatedMode∈{belt,deathspace}、
//        deathspace 必须携合法 deathspaceId；任一不满足 fail-closed 归 null；旧结构缺 returnZoneId 归 null。
//   B 区 普通星带重创→维修恢复(真实 dispatchGameAction + combatTick)：
//        beginRecovery 清空 enemies/currentFormation、wave=1、totalKills/runEliteKills=0、
//        记录 {defeatedMode:belt,returnZoneId,deathspaceId:null}；已获 ISK/掉落不回收；不发肃清 LP；
//        维修完成后自动回到同一 zoneId 生成全新第 1 波。
//   C 区 死亡空间重创→维修恢复(真实路径)：
//        密钥库存不返还且不再扣；不发通关 LP；维修完成后进入 sourceZoneId 普通星带；combat.mode=belt；
//        不调用 enterDeathspace；不恢复原 deathspaceId/wave/enemies。
//   D 区 主动停止取消返回(真实 combat/stop)：普通星带/死亡空间两种来源均清标记，维修完成后 combat.active=false。
//   E 区 非法 returnZoneId 安全停止：清标记、不生成敌人、不扣任何资源、不抛错。
//   F 区 源码自检：确认经生产 dispatchGameAction/combatTick/migrateArchaeologyState 驱动；
//        恢复函数静态确认不含 enterDeathspace。
//
// 关键机制(与 audit-archaeology-relics 相同)：state.js 用 `const gameState` 声明，是 VM 共享词法
//   作用域绑定；生产代码裸引用 gameState 解析到该 const，而非 sandbox 属性。故必须"就地改写"
//   const 指向对象的内容(installGS)，sb.gameState=g 对生产代码不可见。
// ============================================================================
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const noop = () => {};
class MC{} for(const n of["arc","beginPath","clearRect","clip","fill","fillRect","fillText","lineTo","moveTo","rect","restore","save","scale","setTransform","stroke","strokeText"])MC.prototype[n]=noop;
MC.prototype.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}); MC.prototype.createRadialGradient=()=>({addColorStop:noop}); MC.prototype.getImageData=()=>({data:new Uint8ClampedArray(4)}); MC.prototype.roundRect=noop;
const cl={add:noop,remove:noop,toggle:noop,contains:()=>false};
const me=()=>({addEventListener:noop,append:noop,appendChild:noop,classList:cl,click:noop,closest:()=>null,dataset:{},focus:noop,getAttribute:()=>null,getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),getContext:()=>new MC(),hidden:false,innerHTML:"",insertBefore:noop,offsetHeight:24,offsetWidth:560,prepend:noop,querySelector:()=>me(),querySelectorAll:()=>[],remove:noop,removeAttribute:noop,removeChild:noop,select:noop,setAttribute:noop,setAttributeNS:noop,style:{},textContent:"",value:"1"});
const sb=vm.createContext({alert:noop,Blob,confirm:()=>true,matchMedia:()=> ({matches:false,media:"",addEventListener:noop,removeEventListener:noop,addListener:noop,removeListener:noop}),CanvasRenderingContext2D:MC,console,document:{addEventListener:noop,readyState:"loading",body:me(),createElement:()=>me(),createElementNS:()=>({...me(),setAttribute:noop}),getElementById:()=>me(),querySelector:()=>me(),querySelectorAll:()=>[]},FileReader:class{},Image:class{},localStorage:{getItem:()=>null,setItem:noop},requestAnimationFrame:noop,setInterval:noop,setTimeout:noop,clearTimeout:noop,URL:{createObjectURL:()=>"blob:mock",revokeObjectURL:noop},window:null}); sb.window=sb; sb.window.addEventListener=noop;
const srcs=[...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map(m=>m[1].replace(/\?.*$/,"").replace(/^\.\//,""));
for(const s of srcs)vm.runInContext(fs.readFileSync(path.resolve(root,s),"utf8"),sb,{filename:s});
const $=c=>vm.runInContext(c,sb);
const fn=n=>(...a)=>$(n)(...a);

const T=$("ARCHAEOLOGY_TIERS"),S=$("ARCHAEOLOGY_SITES"),H=$("ARCHAEOLOGY_SHIPS");
const mkShip=$("createShipInstance"),RR=$("ResourceRegistry"),gs0=JSON.parse(JSON.stringify($("gameState")));
const COMBAT_ZONES=$("COMBAT_ZONES"),DEATHSPACE_DATABASE=$("DEATHSPACE_DATABASE");
const EID={an:{I:"archaeo_analyzer_i"},st:{I:"archaeo_stabilizer_i"},de:{I:"archaeo_decoder_i"}};
// 一个 requiredCL 低、sourceZoneId 为合法普通星带的死亡空间夹具
const DS=DEATHSPACE_DATABASE.find(d=>COMBAT_ZONES.some(z=>z.id===d.sourceZoneId)&&(d.requiredCL||1)<=1)||DEATHSPACE_DATABASE[0];
const DS_ZONE=DS.sourceZoneId, DS_TICKET="special:"+DS.ticketMaterial;

let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  FAIL:",m);}}
function section(s){console.log(`\n${s}`);}

// 就地安装场景 g 为生产 gameState(词法 const 指向对象)
function installGS(g){
  const real=$("gameState");
  for(const k of Object.keys(real))delete real[k];
  Object.assign(real,g);
  sb.gameState=real;
  return real;
}

// 构建 tier I 在线考古场景(仅供 A 区提供合法 gameState / 考古标记保留测试)
function mkArchState(){
  const tid="I",t=T[tid],c=H[t.ship];
  const g=JSON.parse(JSON.stringify(gs0));
  g.archaeology={activeSiteId:null,activeProbeId:"core_probe_i",progress:0,startedSiteId:null,startedProbeId:null,shipHp:{},repairUntil:0,repairInstanceId:null,interferenceUntil:0,fuelSavingRemainder:0,log:[]};
  g.skills.archaeology={lvl:t.level,xp:0}; g.inventory.ships=[]; g.shipAssignments={}; g.equipment={inventory:[],instances:[],nextInstanceId:1};
  const ship=mkShip(t.ship,1000000); g.inventory.ships.push(ship); g.shipAssignments.archaeology=ship.instanceId;
  for(let i=0;i<c.slots.high;i++)ship.fitted.high.push(EID.an[tid]);
  for(let i=0;i<c.slots.mid;i++)ship.fitted.mid.push(EID.st[tid]);
  for(let i=0;i<c.slots.low;i++)ship.fitted.low.push(EID.de[tid]);
  const site=S.find(s=>s.tier===tid&&s.profile==="research");
  g.archaeology.activeSiteId=site.id; g.archaeology.startedSiteId=site.id; g.archaeology.startedProbeId="core_probe_i";
  RR.add(g,"consumable:fuel",100000); RR.add(g,"probe:core_probe_i",10000); RR.add(g,"currency:isk",0);
  g.currentAction={active:true,skill:"archaeology",progress:0,batchRemaining:0,startedSiteId:site.id,startedProbeId:"core_probe_i",lastProgressUpdate:Date.now(),area:null,startedArea:null};
  if(g.queue&&g.queue.status){ g.queue.status.isRunning=false; g.queue.status.activeIndex=-1; g.queue.items=[]; }
  return {g,site,ship,instanceId:ship.instanceId,c};
}

// 构建一艘可用作战舰(装 1 门 T1 小型激光，作战技能拉满)，assign 到 combat
// mode/zone 由调用方按场景覆盖；默认普通星带 COMBAT_ZONES[0]
function mkCombatState(){
  const g=JSON.parse(JSON.stringify(gs0));
  g.inventory.ships=[]; g.shipAssignments={}; g.equipment={inventory:[],instances:[],nextInstanceId:1};
  const ship=mkShip("rifter",1000000); g.inventory.ships.push(ship); g.shipAssignments.combat=ship.instanceId;
  ship.fitted.high.push("t1_small_laser");
  for(const k of ["laserOps","cannonOps","missileOperations","shieldOperation","armorReinforcement","hullEngineering"]) g.skills[k]={lvl:50,xp:0};
  const zone=COMBAT_ZONES[0];
  g.combat.zone=zone.id; g.combat.viewZone=zone.id; g.combat.mode="belt"; g.combat.viewMode="belt";
  g.combat.active=true; g.combat.repairUntil=0; g.combat.deathspaceId="";
  g.combat.enemies=[]; g.combat.currentEnemy=null; g.combat.wave=1;
  g.currentAction={active:true,skill:"combat",progress:0,batchRemaining:0,lastProgressUpdate:Date.now(),area:null,startedArea:null};
  if(g.queue&&g.queue.status){ g.queue.status.isRunning=false; g.queue.status.activeIndex=-1; g.queue.items=[]; }
  RR.add(g,"currency:isk",0); RR.add(g,"currency:lp",0);
  return {g,ship,instanceId:ship.instanceId,zone};
}

console.log("===== Phase 3D(修正) 维修后自动恢复(resumeAfterRepair)行为审计 =====");
console.log(`死亡空间夹具: ${DS.id} → sourceZone ${DS_ZONE}`);

// ============================================================================
// A 区 迁移 fail-closed(persistence.migrateArchaeologyState)
// ============================================================================
section("【A、迁移 fail-closed(真实 migrateArchaeologyState)】");
{
  const migrate=fn("migrateArchaeologyState");
  const validZone=COMBAT_ZONES[0].id;
  function afterMigrate(setVal){
    const {g}=mkArchState();
    const real=installGS(g);
    if(setVal==="__delete__") delete real.resumeAfterRepair; else real.resumeAfterRepair=setVal;
    migrate();
    return real.resumeAfterRepair;
  }
  ok(afterMigrate("__delete__")===null, `A1 旧存档(缺字段)回填 null`);
  ok(afterMigrate(undefined)===null, `A2 undefined 回填 null`);
  ok(afterMigrate("garbage")===null, `A3 字符串非法归 null(fail-closed)`);
  ok(afterMigrate(123)===null, `A4 数字非法归 null`);
  ok(afterMigrate({type:"foo"})===null, `A5 未知 type 归 null`);
  ok(afterMigrate(null)===null, `A6 null 保持 null(幂等)`);
  const arch=afterMigrate({type:"archaeology",siteId:"x",probeId:"core_probe_i",shipInstanceId:1});
  ok(arch&&arch.type==="archaeology"&&arch.siteId==="x", `A7 合法 archaeology 标记保留`);
  const cb=afterMigrate({type:"combat",returnZoneId:validZone,defeatedMode:"belt",deathspaceId:null,shipInstanceId:2});
  ok(cb&&cb.type==="combat"&&cb.returnZoneId===validZone&&cb.defeatedMode==="belt", `A8 合法 combat/belt 标记保留`);
  const cds=afterMigrate({type:"combat",returnZoneId:DS_ZONE,defeatedMode:"deathspace",deathspaceId:DS.id,shipInstanceId:3});
  ok(cds&&cds.type==="combat"&&cds.deathspaceId===DS.id, `A9 合法 combat/deathspace 标记保留`);
  ok(afterMigrate({type:"combat",returnZoneId:"__bad__",defeatedMode:"belt",deathspaceId:null})===null, `A10 非法 returnZoneId 归 null`);
  ok(afterMigrate({type:"combat",returnZoneId:validZone,defeatedMode:"zone",deathspaceId:null})===null, `A11 非法 defeatedMode 归 null`);
  ok(afterMigrate({type:"combat",returnZoneId:DS_ZONE,defeatedMode:"deathspace",deathspaceId:"__bad__"})===null, `A12 deathspace 缺合法 deathspaceId 归 null`);
  ok(afterMigrate({type:"combat",zoneId:validZone,mode:"zone",shipInstanceId:2})===null, `A13 旧结构(缺 returnZoneId) fail-closed 归 null`);
}

// ============================================================================
// B 区 普通星带重创 → 维修恢复(真实 dispatchGameAction + combatTick)
// ============================================================================
section("【B、普通星带重创→维修恢复(真实 dispatchGameAction + combatTick)】");
{
  const dispatch=$("dispatchGameAction"),combatTick=$("combatTick"),GE=$("GameEvents");
  const {g,instanceId,zone}=mkCombatState();
  const real=installGS(g);
  const now=Date.now();
  real.combat.mode="belt"; real.combat.zone=zone.id;
  // 模拟本轮已推进：有敌人、有编队、非零击杀、已获 ISK
  real.combat.enemies=[{hp:{shield:1,armor:0,structure:0},maxHp:{shield:1,armor:0,structure:0}}];
  real.combat.currentEnemy=real.combat.enemies[0];
  real.combat.currentFormation="belt_5"; real.combat.wave=7; real.combat.totalKills=12; real.combat.runEliteKills=3;
  RR.add(real,"currency:isk",50000); RR.add(real,"currency:lp",8);
  const iskBefore=RR.get(real,"currency:isk"), lpBefore=RR.get(real,"currency:lp");
  const res=dispatch(real,{type:"combat/beginRecovery"},now);
  ok(res&&res.changed, `B1 beginRecovery changed`);
  ok(Array.isArray(real.combat.enemies)&&real.combat.enemies.length===0, `B2 enemies 清空`);
  ok(real.combat.wave===1, `B3 wave 重置为 1`);
  ok(real.combat.currentFormation==="", `B4 currentFormation 清空`);
  ok(real.combat.totalKills===0, `B5 totalKills 清零`);
  ok(real.combat.runEliteKills===0, `B6 runEliteKills 清零`);
  const r=real.resumeAfterRepair;
  ok(r&&r.type==="combat"&&r.defeatedMode==="belt"&&r.returnZoneId===zone.id&&r.deathspaceId===null&&r.shipInstanceId===instanceId,
     `B7 记录 {belt,returnZoneId=${r&&r.returnZoneId},deathspaceId=null,ship=${r&&r.shipInstanceId}}`);
  ok(RR.get(real,"currency:isk")===iskBefore, `B8 已获 ISK 不回收(${iskBefore})`);
  ok(RR.get(real,"currency:lp")===lpBefore, `B9 未发肃清 LP(LP 不变=${lpBefore})`);
  // 维修完成 → combatTick 自动返回同一星带第 1 波
  real.combat.repairUntil=now-1000;
  let ev=null; const off=GE.on("combat:resumedAfterRepair",e=>{ev=e.payload;});
  combatTick();
  if(typeof off==="function")off();
  ok(real.resumeAfterRepair===null, `B10 维修完成后清标记`);
  ok(real.combat.zone===zone.id&&real.combat.mode==="belt", `B11 返回同一 zoneId(${real.combat.zone}) 且 mode=belt`);
  ok(real.combat.active===true, `B12 全新一轮 active`);
  ok(real.combat.wave===1&&Array.isArray(real.combat.enemies)&&real.combat.enemies.length>0, `B13 生成全新第 1 波(enemies=${real.combat.enemies.length})`);
  ok(ev&&ev.zoneId===zone.id&&ev.defeatedMode==="belt", `B14 事件 payload {zoneId,defeatedMode=belt}`);
}

// ============================================================================
// C 区 死亡空间重创 → 维修恢复(真实路径；密钥不返还、返回来源星带、不重进副本)
// ============================================================================
section("【C、死亡空间重创→维修恢复(真实路径)】");
{
  const dispatch=$("dispatchGameAction"),combatTick=$("combatTick");
  const {g,instanceId}=mkCombatState();
  const real=installGS(g);
  const now=Date.now();
  // 进入死亡空间语义：mode=deathspace，deathspaceId 设置，zone=sourceZoneId(enterDeathspace 约定)
  real.combat.mode="deathspace"; real.combat.viewMode="deathspace";
  real.combat.deathspaceId=DS.id; real.combat.zone=DS_ZONE;
  real.combat.enemies=[{hp:{shield:1,armor:0,structure:0},maxHp:{shield:1,armor:0,structure:0}}];
  real.combat.currentEnemy=real.combat.enemies[0];
  real.combat.currentFormation="deathspace_2"; real.combat.wave=2; real.combat.totalKills=5; real.combat.runEliteKills=1;
  RR.add(real,DS_TICKET,3); RR.add(real,"currency:lp",10);
  const ticketBefore=RR.get(real,DS_TICKET), lpBefore=RR.get(real,"currency:lp");
  const res=dispatch(real,{type:"combat/beginRecovery"},now);
  ok(res&&res.changed&&res.failedDeathspace===true, `C1 beginRecovery(死亡空间) changed & failedDeathspace`);
  const r=real.resumeAfterRepair;
  ok(r&&r.defeatedMode==="deathspace"&&r.deathspaceId===DS.id&&r.returnZoneId===DS_ZONE,
     `C2 记录 {deathspace,deathspaceId=${r&&r.deathspaceId},returnZoneId=${r&&r.returnZoneId}=sourceZone}`);
  ok(real.combat.enemies.length===0&&real.combat.wave===1&&real.combat.currentFormation==="", `C3 死亡空间 run 清空`);
  ok(RR.get(real,DS_TICKET)===ticketBefore, `C4 密钥不返还(仍=${ticketBefore})`);
  ok(RR.get(real,"currency:lp")===lpBefore, `C5 不发通关 LP(LP 不变=${lpBefore})`);
  // 维修完成 → combatTick 返回 sourceZoneId 普通星带
  real.combat.repairUntil=now-1000;
  combatTick();
  ok(real.resumeAfterRepair===null, `C6 维修完成后清标记`);
  ok(real.combat.zone===DS_ZONE, `C7 进入 sourceZoneId 普通星带(${real.combat.zone})`);
  ok(real.combat.mode==="belt", `C8 combat.mode=belt`);
  ok(real.combat.deathspaceId==="", `C9 不恢复原 deathspaceId(已清空)`);
  ok(RR.get(real,DS_TICKET)===ticketBefore, `C10 维修后不再扣密钥(仍=${ticketBefore})`);
  ok(real.combat.active===true&&real.combat.wave===1&&real.combat.enemies.length>0, `C11 从第 1 波开始新一轮(enemies=${real.combat.enemies.length})`);
  void instanceId;
}

// ============================================================================
// D 区 主动停止取消返回(真实 combat/stop)
// ============================================================================
section("【D、主动停止取消返回(真实 combat/stop)】");
{
  const dispatch=$("dispatchGameAction"),combatTick=$("combatTick");
  // D1 普通星带来源：维修中主动停止 → 清标记，维修完成不自动出击
  {
    const {g,zone}=mkCombatState();
    const real=installGS(g);
    const now=Date.now();
    real.combat.mode="belt"; real.combat.zone=zone.id;
    dispatch(real,{type:"combat/beginRecovery"},now); // 进入维修并记录标记
    ok(real.resumeAfterRepair&&real.resumeAfterRepair.type==="combat", `D1 前置：已记录待恢复标记`);
    const stopRes=dispatch(real,{type:"combat/stop"},now); // 维修中(combat 非活跃)主动停止
    ok(stopRes&&stopRes.changed&&stopRes.cancelledResume===true, `D1 维修中 stop 成功取消(cancelledResume)`);
    ok(real.resumeAfterRepair===null, `D1 stop 清标记`);
    real.combat.repairUntil=now-1000;
    combatTick();
    ok(real.combat.active===false, `D1 维修完成后不自动出击(combat.active=false)`);
  }
  // D2 死亡空间来源：同样可主动取消
  {
    const {g}=mkCombatState();
    const real=installGS(g);
    const now=Date.now();
    real.combat.mode="deathspace"; real.combat.deathspaceId=DS.id; real.combat.zone=DS_ZONE;
    dispatch(real,{type:"combat/beginRecovery"},now);
    ok(real.resumeAfterRepair&&real.resumeAfterRepair.defeatedMode==="deathspace", `D2 前置：死亡空间标记已记录`);
    dispatch(real,{type:"combat/stop"},now);
    ok(real.resumeAfterRepair===null, `D2 stop 清标记`);
    real.combat.repairUntil=now-1000;
    combatTick();
    ok(real.combat.active===false, `D2 维修完成后不自动出击`);
  }
}

// ============================================================================
// E 区 非法 returnZoneId 安全停止
// ============================================================================
section("【E、非法 returnZoneId 安全停止】");
{
  const combatTick=$("combatTick");
  const {g}=mkCombatState();
  const real=installGS(g);
  const now=Date.now();
  real.combat.mode="belt"; real.combat.active=false; real.currentAction.active=false;
  real.combat.enemies=[]; real.combat.repairUntil=now-1000;
  RR.add(real,DS_TICKET,2); const ticketBefore=RR.get(real,DS_TICKET);
  RR.add(real,"currency:isk",7777); const iskBefore=RR.get(real,"currency:isk");
  real.resumeAfterRepair={type:"combat",returnZoneId:"__nonexistent__",defeatedMode:"belt",deathspaceId:null,shipInstanceId:1};
  let threw=false;
  try{ combatTick(); }catch(e){ threw=true; }
  ok(!threw, `E1 非法 returnZoneId 不抛错`);
  ok(real.resumeAfterRepair===null, `E2 清标记`);
  ok(real.combat.active===false, `E3 不续跑(combat.active=false)`);
  ok(Array.isArray(real.combat.enemies)&&real.combat.enemies.length===0, `E4 不生成敌人`);
  ok(RR.get(real,DS_TICKET)===ticketBefore&&RR.get(real,"currency:isk")===iskBefore, `E5 不扣任何资源(密钥=${ticketBefore},ISK=${iskBefore})`);
}

// ============================================================================
// F 区 源码自检(确认经真实生产入口驱动，非字符串比对)
// ============================================================================
section("【F、源码自检(真实生产入口)】");
{
  const selfSrc=fs.readFileSync(fileURLToPath(import.meta.url),"utf8");
  const body=selfSrc.slice(selfSrc.indexOf("A 区 迁移"));
  ok(/dispatch=\$\("dispatchGameAction"\)/.test(body), `F1 B/C/D 区经生产 dispatchGameAction 分发`);
  ok(/combatTick=\$\("combatTick"\)/.test(body), `F2 B/C/D/E 区经生产 combatTick 驱动`);
  ok(/migrate=fn\("migrateArchaeologyState"\)/.test(body), `F3 A 区经生产 migrateArchaeologyState`);
  // 正则用字符串拼接构造，避免本自检源码自身命中字面量(否则假阳性)
  const internalCall=new RegExp("tryResumeCombat"+"AfterRepair\\s*\\(");
  ok(!internalCall.test(body), `F4 未绕过 combatTick 直接调用内部续跑函数`);
  // 静态确认：恢复函数体内绝不调用 enterDeathspace(死亡空间不重进副本)
  const combatSrc=fs.readFileSync(path.join(root,"js/systems/combat.js"),"utf8");
  const fs0=combatSrc.indexOf("function tryResumeCombatAfterRepair");
  const fnBody=combatSrc.slice(fs0, combatSrc.indexOf("\nfunction ", fs0+20));
  ok(fs0>=0&&!/enterDeathspace/.test(fnBody), `F5 恢复函数不调用 enterDeathspace`);
}

console.log(`\n===== 结果: ${pass}/${pass+fail} 通过 =====`);
if(fail>0){ console.log(`FAILED: ${fail} 断言失败`); process.exit(1); }
console.log("ALL PASS ✅");
