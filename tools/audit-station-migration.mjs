// ================================================================
// Phase 3C-1 迁移审计：station / corporation 最小结构幂等迁移
// 覆盖策划文档第八节 8.2 迁移契约（A 区：存档迁移幂等）。
// 真实脚本 VM 沙箱加载全部游戏逻辑，不伪造状态、不绕过真实迁移函数。
// ================================================================
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// 动态解析项目根目录（与其他审计脚本一致），不写死盘符或用户名
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const scripts = [];
const re = /<script\s+defer\s+src="([^"]+)"/g;
let m;
// 归一化脚本路径：去掉 ./ 前缀与 ?v= 查询串（否则与 UI_EXCLUDE 比对失败并 readFileSync ENOENT）
while ((m = re.exec(html))) scripts.push(m[1].replace(/\?.*$/, "").replace(/^\.\//, ""));
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
vm.createContext(sandbox);
try { vm.runInContext(combined,sandbox,{filename:"combined.js"}); }
catch(e){ console.error("LOAD ERROR:",e.message); process.exit(1); }
const W=sandbox;
const G=W.gameState;

// 八建筑稳定 ID（与 state.js STATION_BUILDING_IDS 一致；此处自包含以便断言）
const KNOWN = ["resource_dispatch","planetary_control","smelting_refinery","equipment_factory","booster_factory","archaeology_lab","combat_command","shipyard"];

let pass=0, fail=0;
const failures=[];
function ok(cond,label){ if(cond){pass++;} else {fail++;failures.push(label);console.log("  [FAIL] "+label);} }
function section(name){ console.log("== "+name+" =="); }

// A1：全新加载后 station 外壳存在且为默认空壳
section("A1 全新存档默认外壳");
ok(!!G && !!G.station, "gameState.station 存在");
ok(G.station.bodyLevel === 0, "bodyLevel 默认 0");
ok(G.station.buildings && Object.keys(G.station.buildings).length === KNOWN.length, "buildings 含全部 8 个已知 ID");
ok(KNOWN.every(id => G.station.buildings[id] === 0), "所有建筑默认等级 0");
ok(G.station.maintenance.tier === "standard", "maintenance.tier 默认 standard");
ok(G.station.autoLines.smelting && G.station.autoLines.smelting.enabled === false && G.station.autoLines.smelting.operatorId === null, "自动线 smelting 默认未启用且 operatorId null");
ok(!!G.corporation && typeof G.corporation.name === "string", "corporation 外壳存在");

// A2：缺失 station 的旧存档被安全初始化
section("A2 缺失 station 的旧存档");
delete G.station; delete G.corporation;
W.normalizeStationState(G); W.normalizeCorporationState(G);
ok(!!G.station && G.station.bodyLevel === 0, "缺失 station → 初始化 bodyLevel 0");
ok(KNOWN.every(id => G.station.buildings[id] === 0), "缺失 station → buildings 全 0");
ok(!!G.corporation && typeof G.corporation.name === "string", "缺失 corporation → 初始化");

// A3：bodyLevel 越界/NaN/负数归 0
section("A3 bodyLevel 边界");
const setBL = v => { G.station.bodyLevel = v; W.normalizeStationState(G); return G.station.bodyLevel; };
ok(setBL(NaN) === 0, "NaN → 0");
ok(setBL(-3) === 0, "-3 → 0");
ok(setBL(5) === 0, "5(越界) → 0");
ok(setBL(2) === 2, "2 → 2");
ok(setBL(3) === 3, "3 → 3");

// A4：buildings 未知 ID 丢弃、越界/NaN 归 0
section("A4 buildings 清理");
G.station.buildings = { smelting_refinery: 2, ghost_building: 9, archaeology_lab: NaN, combat_command: 5 };
W.normalizeStationState(G);
ok(G.station.buildings.ghost_building === undefined, "未知 ID ghost_building 被丢弃");
ok(G.station.buildings.smelting_refinery === 2, "合法 ID 保留 2");
ok(G.station.buildings.archaeology_lab === 0, "NaN → 0");
ok(G.station.buildings.combat_command === 0, "越界 5 → 0");
ok(KNOWN.every(id => id in G.station.buildings), "所有已知 ID 仍存在于 buildings");

// A5：construction 未支付清零、已支付合法保留、已支付非法清空
section("A5 construction 处理");
G.station.construction = { projectId:"x", type:"body", level:2, startedAt:0, endsAt:0, cost:{}, paid:false };
W.normalizeStationState(G);
ok(G.station.construction === null, "未支付 construction → null");
G.station.construction = { projectId:"x", type:"body", level:2, startedAt:0, endsAt:0, cost:{}, paid:true };
W.normalizeStationState(G);
ok(G.station.construction && G.station.construction.paid === true, "已支付合法 construction → 保留");
G.station.construction = { projectId:"x", type:"weird", level:2, startedAt:0, endsAt:0, cost:{}, paid:true };
W.normalizeStationState(G);
ok(G.station.construction === null, "已支付但 type 非法 → null");

// A6：绝不触碰玩家现有资产
section("A6 不触碰玩家资产");
G.resources.isk = 123456;
G.skills.mining = { lvl: 42, xp: 7 };
const shipCount = G.inventory.ships.length;
G.station.bodyLevel = 3; G.station.buildings.smelting_refinery = 2;
W.normalizeStationState(G);
ok(G.resources.isk === 123456, "resources.isk 未被改动");
ok(G.skills.mining.lvl === 42 && G.skills.mining.xp === 7, "skills.mining 未被改动");
ok(G.inventory.ships.length === shipCount, "inventory.ships 未被改动");
ok(G.station.bodyLevel === 3 && G.station.buildings.smelting_refinery === 2, "station 自身改动生效");

// A7：corporation 字段归一化
section("A7 corporation 归一化");
G.corporation = { version: "bad", name: 123, foundedAt: "x", dlc: { npcWorkers:1, combatWings:0 } };
W.normalizeCorporationState(G);
ok(G.corporation.version === 1, "version 非法 → 1");
ok(G.corporation.name === "", "name 非字符串 → 空串");
ok(G.corporation.foundedAt === 0, "foundedAt 非法 → 0");
ok(G.corporation.dlc.npcWorkers === true && G.corporation.dlc.combatWings === false, "dlc 布尔归一化");

// A8：幂等（连续两次调用结果一致）
section("A8 幂等性");
const before = JSON.stringify(G.station) + "|" + JSON.stringify(G.corporation);
W.normalizeStationState(G); W.normalizeCorporationState(G);
const after = JSON.stringify(G.station) + "|" + JSON.stringify(G.corporation);
ok(before === after, "连续两次 normalize 结果完全一致");

console.log("\n结果：PASS=" + pass + "  FAIL=" + fail);
if (fail > 0) { console.log("失败项：\n - " + failures.join("\n - ")); process.exit(1); }
process.exit(0);
