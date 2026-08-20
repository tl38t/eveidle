// 回归测试：离线战斗货柜尺寸判定（修复离线敌人快照漏拷 type 导致掉 S 货柜）
// 背景：offline-combat.js 的 simulateBelt 把 built.enemies 映射成模拟快照时漏拷 type，
//       导致 recordKill → getEnemyCargoClass(faction, enemy.type=undefined) 兜底 frigate → 必掉 S。
//       猎杀空域(angel_hunting_ground, level40/requiredCL35, 巡洋) 本应出 M，离线却出 S，反差最明显。
// 方法：加载真实游戏脚本到 vm 沙箱，用真实 buildCombatWave / getEnemyCargoClass 验证断链点：
//       ① built.enemies 真实带 type（且为巡洋 key）
//       ② 带 type → cruiser（出 M）；不带 type（旧快照）→ frigate（出 S，即 bug）
//       ③ 复刻新旧两套快照映射，确认修复后离线货柜尺寸正确解析为 cruiser
// 运行：node tools/test-offline-cargo-type-fix.mjs
// 退出码：0 = 通过；1 = 失败

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptSources = [...html.matchAll(/<script\s+defer\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1].replace(/\?.*$/, ""));

const noop = () => {};
function MockCanvasContext() {}
for (const n of ["arc","arcTo","beginPath","clearRect","clip","drawImage","ellipse","fill","fillRect","fillText","lineTo","moveTo","putImageData","rect","restore","rotate","save","scale","setTransform","stroke","strokeText","translate"]) MockCanvasContext.prototype[n] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop:noop });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
const classList = { add:noop, remove:noop, toggle:noop, contains:()=>false };
const makeElement = () => ({ addEventListener:noop, appendChild:noop, classList, click:noop, closest:()=>null, dataset:{}, focus:noop, getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}), getContext:()=>new MockCanvasContext(), innerHTML:"", offsetHeight:24, offsetWidth:560, querySelector:()=>makeElement(), querySelectorAll:()=>[], remove:noop, setAttribute:noop, removeAttribute:noop, getAttribute:()=>null, select:noop, style:{}, textContent:"", value:"1" });
const documentMock = { addEventListener:noop, readyState:"loading", body:makeElement(), createElement:()=>makeElement(), createElementNS:()=>({...makeElement(),setAttribute:noop}), getElementById:()=>makeElement(), querySelector:()=>makeElement(), querySelectorAll:()=>[] };
const localStorageMock = { getItem:()=>null, setItem:noop, removeItem:noop };
const sandbox = { alert:noop, Blob, CanvasRenderingContext2D:MockCanvasContext, console, confirm:()=>true, document:documentMock, FileReader:class{}, localStorage:localStorageMock, matchMedia:()=>({matches:false,media:"",addEventListener:noop,removeEventListener:noop,addListener:noop,removeListener:noop}), requestAnimationFrame:noop, setInterval:noop, setTimeout:noop, clearTimeout:noop, URL:{createObjectURL:()=>"blob:mock",revokeObjectURL:noop}, window:null };
sandbox.window = sandbox; sandbox.window.addEventListener = noop;
vm.createContext(sandbox);
for (const src of scriptSources) {
  vm.runInContext(fs.readFileSync(path.join(root, src.replace(/^\.\//,"")), "utf8"), sandbox, { filename: src });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  -> " + detail : "")); }
}

// 取出真实函数与数据
const buildCombatWave = vm.runInContext("buildCombatWave", sandbox);
const getEnemyCargoClass = vm.runInContext("getEnemyCargoClass", sandbox);
const COMBAT_ZONES = vm.runInContext("COMBAT_ZONES", sandbox);
const CARGO_CLASS_SIZES = vm.runInContext("CARGO_CLASS_SIZES", sandbox);

const ZONE_ID = "angel_hunting_ground";
const zone = COMBAT_ZONES.find(z => z.id === ZONE_ID);
check("找到猎杀空域 zone", !!zone, "COMBAT_ZONES 无 " + ZONE_ID);
if (!zone) { console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(1); }
check("猎杀空域阵营为 angel", zone.faction === "angel", "faction=" + zone.faction);

// 用真实 buildCombatWave 产出一波敌人（最小 combatState 即可，type 赋值不依赖它）
const built = buildCombatWave(zone, 1, Math.random, {});
check("buildCombatWave 产出敌人", built.enemies.length > 0, "enemies=" + built.enemies.length);
const sampleTypes = [...new Set(built.enemies.map(e => e.type))];
check("built.enemies 真实带 type（巡洋 key）", sampleTypes.every(t => t && /^.*_cruiser$/.test(t)), "types=" + JSON.stringify(sampleTypes));

// 真实船级解析
const clsByType = sampleTypes.map(t => getEnemyCargoClass(zone.faction, t));
check("带 type → 解析为 cruiser", clsByType.every(c => c === "cruiser"), "cls=" + JSON.stringify(clsByType));
check("cruiser 尺寸集只含 M（不出 S）", JSON.stringify(CARGO_CLASS_SIZES.cruiser.sizes) === JSON.stringify(["M"]), "sizes=" + JSON.stringify(CARGO_CLASS_SIZES.cruiser.sizes));

// 复刻「旧快照」（漏拷 type）→ 离线 recordKill 拿到 enemy.type=undefined → 兜底 frigate
const oldSnapshot = built.enemies.map(e => ({
  id: e.id, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
  dodge: e.dodge, baseDamage: e.baseDamage, kind: e.kind, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
  level: e.level, deathspaceLeader: false, deathspaceWave: 0, _rewarded: false
}));
const oldCls = getEnemyCargoClass(zone.faction, oldSnapshot[0].type); // type 缺失 → undefined
check("【旧快照/bug】type 缺失 → 兜底 frigate（即掉 S 的根因）", oldCls === "frigate", "cls=" + oldCls);

// 复刻「新快照」（已补 type）→ 正确解析 cruiser
const newSnapshot = built.enemies.map(e => ({
  id: e.id, type: e.type, hit: e.hit, hp: { shield: e.hp.shield, armor: e.hp.armor, structure: e.hp.structure },
  dodge: e.dodge, baseDamage: e.baseDamage, kind: e.kind, iskDrop: e.iskDrop, xpDrop: e.xpDrop,
  level: e.level, deathspaceLeader: false, deathspaceWave: 0, _rewarded: false
}));
const newCls = getEnemyCargoClass(zone.faction, newSnapshot[0].type);
check("【新快照/修复】type 已带 → 解析 cruiser（出 M，正确）", newCls === "cruiser", "cls=" + newCls);

console.log(`\n=== 离线货柜尺寸修复回归：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
