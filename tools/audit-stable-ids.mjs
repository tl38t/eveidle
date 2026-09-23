// 内部稳定键基线审计（2026-09-24 事故后新增闸门）
//
// 事故背景：rc95→rc96 为 10/10 引入「多底子」时，把死亡空间装备 ID 从
//   ded_<faction>_<tier>_<role>  改成  ded_<faction>_<tier>_<role>_<suffix>
// 老存档里所有落盘的旧 ID 立刻失配 ⇒ 已装装备「匹配不到数据」、已购蓝图显示未拥有。
// 根因不是代码 bug，而是**改了内部稳定键却没有兼容性兜底**。
//
// 本闸门把「当前全部内部稳定键」与基线快照比对：
//   ❌ 基线里存在、现在消失  ⇒ EXIT=1（改名/删除 = 破坏老存档，必须加兼容映射或明确豁免）
//   ⚠️ 新增键              ⇒ 只报告（正常迭代）
// 用法：
//   node tools/audit-stable-ids.mjs                  # 校验
//   node tools/audit-stable-ids.mjs --update-baseline # 更新基线（确属有意变更 + 已加兼容后执行）
'use strict';
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.resolve(SRC_ROOT, 'tools', 'stable-id-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

// ---------- 沙箱加载（与 _smoke_ded_legacy_id_migration.mjs 同构，只读生产代码） ----------
const html = fs.readFileSync(path.join(SRC_ROOT, 'index.html'), 'utf8');
const sources = [];
const reTag = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g;
let m; while ((m = reTag.exec(html))) {
  const tag = m[0]; const src = m[1].replace(/\?.*$/, '').replace(/^\.\//, '');
  if (/type\s*=\s*["']module["']/.test(tag)) continue;
  sources.push(src);
}
const UI_EXCLUDE = new Set(['js/ui/error-boundary.js','js/ui/action-modal.js','js/ui/shell-render.js','js/ui/manufacturing-render.js','js/ui/combat-render.js','js/ui/planetary-render.js','js/ui/archaeology-render.js','js/ui/booster-render.js','js/ui/render.js','js/core/runtime.js','js/ui/taptap-portrait.js','js/ui/ad-buff-widget.js','js/ui/ship3d-loader.js']);
const logic = sources.filter(s => !UI_EXCLUDE.has(s) && !s.startsWith('js/ui/') && !s.endsWith('.mjs'));
const noop = () => {};
function Ctx() {}
for (const n of ['arc','beginPath','clearRect','drawImage','fill','fillRect','fillText','lineTo','moveTo','rect','restore','save','scale','setTransform','stroke','strokeText','translate']) Ctx.prototype[n] = noop;
Ctx.prototype.createImageData = (w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
Ctx.prototype.getImageData = (x,y,w,h) => ({ data:new Uint8ClampedArray(w*h*4), width:w, height:h });
Ctx.prototype.createLinearGradient = () => ({ addColorStop: noop });
Ctx.prototype.createRadialGradient = () => ({ addColorStop: noop });
const cl = { add:noop, remove:noop, toggle:noop, contains:()=>false };
const el = () => ({ addEventListener:noop, removeEventListener:noop, appendChild:noop, insertBefore:noop, insertAdjacentHTML:noop, replaceChildren:noop, removeChild:noop, classList:cl, click:noop, closest:()=>null, dataset:{}, focus:noop, getBoundingClientRect:()=>({left:0,top:0,width:1,height:1}), getContext:()=>new Ctx(), innerHTML:'', offsetHeight:24, offsetWidth:560, querySelector:()=>el(), querySelectorAll:()=>[], remove:noop, setAttribute:noop, removeAttribute:noop, getAttribute:()=>null, select:noop, style:{}, textContent:'', value:'1', children:[], parentNode:null });
const doc = { addEventListener:noop, body:el(), head:el(), documentElement:el(), createElement:()=>el(), createElementNS:()=>({...el(), setAttribute:noop}), getElementById:()=>el(), querySelector:()=>el(), querySelectorAll:()=>[] };
const sb = { alert:noop, Blob, CanvasRenderingContext2D:Ctx, console, confirm:()=>true, document:doc, FileReader:class {}, localStorage:{getItem:()=>null,setItem:noop,removeItem:noop}, requestAnimationFrame:noop, setInterval:noop, setTimeout:noop, clearTimeout:noop, URL:{createObjectURL:()=>'blob:m',revokeObjectURL:noop}, matchMedia:()=>({matches:false,media:'',onchange:null,addEventListener:noop,removeEventListener:noop,addListener:noop,removeListener:noop,dispatchEvent:noop}), GameEvents:{emit:noop,on:()=>()=>{},once:noop,contracts:{has:()=>true,validate:()=>({valid:true,registered:true})},listenerCount:()=>0}, RuntimeGuard:{report:noop,runCritical:()=>({ok:true}),resume:()=>true,isPaused:()=>false,runRecoverable:()=>({ok:true})}, MutationObserver:class{observe(){}disconnect(){}takeRecords(){return[]}}, URLSearchParams, URL, performance:{now:()=>Date.now()}, TextEncoder, TextDecoder, queueMicrotask, __OFFLINE_COMBAT_FASTPATH:true, fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve({})}), window:null };
sb.window = sb; sb.addEventListener = noop; sb.removeEventListener = noop; sb.dispatchEvent = noop;
sb.location = { href:'', search:'', hash:'' }; sb.navigator = { userAgent:'node' };
sb.innerWidth = 1280; sb.innerHeight = 800;
vm.createContext(sb);
let src = '';
const loadFail = [];
for (const s of logic) {
  const full = path.join(SRC_ROOT, s);
  if (!fs.existsSync(full)) { loadFail.push(s); continue; }
  src += '\n;//=== ' + s + ' ===\n' + fs.readFileSync(full, 'utf8');
}
src += `\n;globalThis.__exp = {
  EQUIPMENT_DB: (typeof EQUIPMENT_DB !== "undefined") ? EQUIPMENT_DB : null,
  EQUIPMENT_RECIPES: (typeof EQUIPMENT_RECIPES !== "undefined") ? EQUIPMENT_RECIPES : null,
  DEATHSPACE_DATABASE: (typeof DEATHSPACE_DATABASE !== "undefined") ? DEATHSPACE_DATABASE : null,
  COMBAT_ZONES: (typeof COMBAT_ZONES !== "undefined") ? COMBAT_ZONES : null
};`;
vm.runInContext(src, sb, { filename: 'bundle.js' });
const X = sb.__exp;

// ---------- 采集当前稳定键（只收**可枚举**键：兼容别名是非枚举的，不进基线） ----------
const collect = () => {
  const out = {};
  const ids = key => {
    const o = X[key];
    if (!o) return [];
    return Array.isArray(o) ? o.map(x => x && x.id).filter(Boolean) : Object.keys(o);
  };
  out.equipment = ids('EQUIPMENT_DB');
  out.recipes = ids('EQUIPMENT_RECIPES');
  out.deathspaceSites = ids('DEATHSPACE_DATABASE');
  out.combatZones = ids('COMBAT_ZONES');
  return out;
};
const current = collect();

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify({ capturedAt: new Date().toISOString(), groups: current }, null, 2), 'utf8');
  const total = Object.values(current).reduce((a, b) => a + b.length, 0);
  console.log('基线已更新 → tools/stable-id-baseline.json（' + total + ' 个键）');
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.log('⚠️ 基线文件不存在，先执行一次：node tools/audit-stable-ids.mjs --update-baseline');
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).groups || {};
let broken = [];
let added = [];
for (const group of Object.keys(current)) {
  const before = new Set(baseline[group] || []);
  const after = new Set(current[group]);
  for (const id of before) if (!after.has(id)) broken.push(group + ':' + id);
  for (const id of after) if (!before.has(id)) added.push(group + ':' + id);
}

console.log('===== 内部稳定键基线审计 =====');
for (const group of Object.keys(current)) {
  console.log('  ' + group.padEnd(16) + ' 基线 ' + String((baseline[group] || []).length).padStart(4) + ' → 当前 ' + String(current[group].length).padStart(4));
}
if (added.length) console.log('\n⚠️ 新增键 ' + added.length + ' 个（正常迭代，不需处理）:\n  ' + added.slice(0, 8).join('\n  ') + (added.length > 8 ? '\n  …' : ''));
if (broken.length) {
  console.log('\n❌❌ 消失的键 ' + broken.length + ' 个 —— 老存档会失配（改名前必须加兼容映射或明确豁免）:\n  ' + broken.slice(0, 30).join('\n  ') + (broken.length > 30 ? '\n  …' : ''));
  console.log('\n处置：① 加旧→新兼容映射（见 DEATHSPACE_LEGACY_ID_MAP）；② 确认无人持有后 --update-baseline。');
  process.exit(1);
}
console.log('\n✅ 无消失的内部稳定键（老存档兼容未破）');
process.exit(0);
