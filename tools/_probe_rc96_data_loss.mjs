// rc96 数据丢失实证探针（2026-09-24）
// 目的：用真实生产代码跑 normalize 流程，证明 rc96 在「无别名」状态下会把旧 DED 装备
//       从 inventory / instances / fitted 物理删除；并证明 rc97 的迁移对已损坏存档无能为力。
'use strict';
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC_ROOT = process.env.FRESH_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(SRC_ROOT, 'index.html'), 'utf8');
const scriptSources = [];
const reTag = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g;
let mmt; while ((mmt = reTag.exec(html))) {
  const tag = mmt[0]; const src = mmt[1].replace(/\?.*$/, '').replace(/^\.\//, '');
  if (/type\s*=\s*["']module["']/.test(tag)) continue;
  scriptSources.push(src);
}
const UI_EXCLUDE = new Set([
  'js/ui/error-boundary.js', 'js/ui/action-modal.js', 'js/ui/shell-render.js',
  'js/ui/manufacturing-render.js', 'js/ui/combat-render.js', 'js/ui/planetary-render.js',
  'js/ui/archaeology-render.js', 'js/ui/booster-render.js', 'js/ui/render.js', 'js/core/runtime.js',
  'js/ui/taptap-portrait.js', 'js/ui/ad-buff-widget.js', 'js/ui/ship3d-loader.js'
]);
const logicSources = scriptSources.filter((s) => !UI_EXCLUDE.has(s) && !s.startsWith('js/ui/') && !s.endsWith('.mjs'));

const noop = () => {};
function MockCanvasContext() {}
for (const n of ['arc','arcTo','beginPath','clearRect','clip','drawImage','ellipse','fill','fillRect','fillText','lineTo','moveTo','putImageData','rect','restore','rotate','save','scale','setTransform','stroke','strokeText','translate']) MockCanvasContext.prototype[n] = noop;
MockCanvasContext.prototype.createImageData = (w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.getImageData = (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4), width:w, height:h });
MockCanvasContext.prototype.createLinearGradient = () => ({ addColorStop: noop });
MockCanvasContext.prototype.createRadialGradient = () => ({ addColorStop: noop });
const classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
const makeElement = () => ({
  addEventListener: noop, removeEventListener: noop, appendChild: noop, insertBefore: noop, insertAdjacentHTML: noop,
  replaceChildren: noop, removeChild: noop, classList, click: noop, closest: () => null, dataset: {}, focus: noop,
  getBoundingClientRect: () => ({ left:0, top:0, width:100, height:100 }), getContext: () => new MockCanvasContext(),
  innerHTML: '', offsetHeight: 24, offsetWidth: 560, querySelector: () => makeElement(), querySelectorAll: () => [],
  remove: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, select: noop, style: {},
  textContent: '', value: '1', children: [], parentNode: null
});
const documentMock = {
  addEventListener: noop, body: makeElement(), head: makeElement(), documentElement: makeElement(),
  createElement: () => makeElement(),
  createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
  getElementById: () => makeElement(), querySelector: () => makeElement(), querySelectorAll: () => []
};
const sandbox = {
  alert: noop, Blob, CanvasRenderingContext2D: MockCanvasContext, console, confirm: () => true,
  document: documentMock, FileReader: class {}, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  requestAnimationFrame: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop,
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: noop },
  matchMedia: () => ({ matches:false, media:'', onchange:null, addEventListener:noop, removeEventListener:noop, addListener:noop, removeListener:noop, dispatchEvent:noop }),
  GameEvents: { emit: noop, on: () => () => {}, once: noop, contracts: { has: () => true, validate: () => ({ valid:true, registered:true }) }, listenerCount: () => 0 },
  RuntimeGuard: { report: noop, runCritical: () => ({ ok:true }), resume: () => true, isPaused: () => false, runRecoverable: () => ({ ok:true }) },
  MutationObserver: class { observe(){} disconnect(){} takeRecords(){ return []; } },
  URLSearchParams, URL, performance: (typeof performance !== 'undefined') ? performance : { now: () => Date.now() },
  TextEncoder, TextDecoder, queueMicrotask,
  crypto: (typeof crypto !== 'undefined') ? crypto : undefined,
  __OFFLINE_COMBAT_FASTPATH: true,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  window: null
};
sandbox.window = sandbox;
sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
sandbox.location = { href:'', search:'', hash:'' };
sandbox.navigator = { userAgent: 'node' };
sandbox.innerWidth = 1280; sandbox.innerHeight = 800;
sandbox.updateUI = noop; sandbox.switchPage = noop; sandbox.currentPage = '';
sandbox.updateLiveUI = noop; sandbox.refreshVisiblePanelAfterAction = noop;
sandbox.playAttackFX = noop; sandbox.playEnemyAttackFX = noop;
vm.createContext(sandbox);

let src = '';
const loadFail = [];
for (const s of logicSources) {
  const full = path.resolve(SRC_ROOT, s);
  if (!fs.existsSync(full)) { loadFail.push(s + ' (缺失)'); continue; }
  try { src += '\n;//=== ' + s + ' ===\n' + fs.readFileSync(full, 'utf8'); }
  catch (e) { loadFail.push(s + ': ' + e.message); }
}
src += `
;globalThis.__exp = {
  EQUIPMENT_DB, DEATHSPACE_LEGACY_ID_MAP,
  migrateDeathspaceEquipmentIds, normalizeEquipmentState, migrateEquipmentInstancesV1,
  resolveEquipmentReference
};
`;
vm.runInContext(src, sandbox, { filename: 'bundle.js' });
const X = sandbox.__exp;

let ok = true;
const fail = [];
const check = (cond, label, detail) => {
  if (!cond) { ok = false; fail.push(label); }
  console.log('  ' + (cond ? '✅' : '❌') + ' ' + label + (detail ? ' → ' + detail : ''));
};

// 构造一份「rc95 时代」老存档：旧 DED id 落在 inventory / instances / fitted / ownedBlueprints
function makeLegacySave() {
  const dedOld = "ded_angel_6_weapon";          // 旧 id
  return {
    ownedBlueprints: ["equipment:" + dedOld, "equipment:raider_mining_laser"],
    equipment: {
      inventory: [dedOld, "t1_mining_laser"],     // 仓库里一件旧 DED + 一件普通
      instances: [
        { instanceId: "eq_1", itemId: dedOld, enhancementLevel: 3, installedOn: 1 },  // 已强化旧 DED 实例
        { instanceId: "eq_2", itemId: "t1_mining_laser", enhancementLevel: 0, installedOn: null }
      ],
      nextInstanceId: 3
    },
    inventory: {
      ships: [
        { instanceId: 1, shipId: "titan_alpha", fitted: { high: [dedOld], mid: ["t1_mining_laser"], low: [], rig: [] } }
      ],
      equipment: [],
      rigs: []
    },
    queue: { items: [] },
    currentAction: {}
  };
}

console.log('\n========== 阶段 1：模拟 rc96 首次加载（无别名）==========');
{
  const state = makeLegacySave();
  // 抹掉别名，模拟 rc96（EQUIPMENT_DB 只有新 id）
  for (const id of Object.keys(X.DEATHSPACE_LEGACY_ID_MAP)) delete X.EQUIPMENT_DB[id];
  const beforeInv = state.equipment.inventory.slice();
  const beforeInst = state.equipment.instances.length;
  const beforeFitted = state.inventory.ships[0].fitted.high.slice();
  const beforeOwned = state.ownedBlueprints.slice();
  X.migrateEquipmentInstancesV1(state);
  X.normalizeEquipmentState(state);
  const afterInv = state.equipment.inventory.slice();
  const afterInst = state.equipment.instances.map(i => i.itemId);
  const afterFitted = state.inventory.ships[0].fitted.high.slice();
  const afterOwned = state.ownedBlueprints.slice();
  console.log('  旧 DED id = ded_angel_6_weapon');
  console.log('  inventory  before=' + JSON.stringify(beforeInv) + '  after=' + JSON.stringify(afterInv));
  console.log('  instances  before=' + beforeInst + '  after=' + JSON.stringify(afterInst));
  console.log('  fitted.high before=' + JSON.stringify(beforeFitted) + '  after=' + JSON.stringify(afterFitted));
  console.log('  ownedBlue  before=' + JSON.stringify(beforeOwned) + '  after=' + JSON.stringify(afterOwned));
  check(!afterInv.includes("ded_angel_6_weapon"), 'rc96：仓库旧 DED 被删除', JSON.stringify(afterInv));
  check(!afterInst.includes("ded_angel_6_weapon"), 'rc96：实例旧 DED 被删除', JSON.stringify(afterInst));
  check(!afterFitted.some(r => r === "ded_angel_6_weapon"), 'rc96：舰上装配旧 DED 被清空', JSON.stringify(afterFitted));
  check(afterOwned.includes("equipment:ded_angel_6_weapon"), 'rc96：蓝图所有权键【未】被删（仅此一项幸存）', JSON.stringify(afterOwned));
}

console.log('\n========== 阶段 2：在「已损坏存档」上模拟 rc97 迁移 ==========');
{
  const state = makeLegacySave();
  for (const id of Object.keys(X.DEATHSPACE_LEGACY_ID_MAP)) delete X.EQUIPMENT_DB[id];
  X.migrateEquipmentInstancesV1(state);
  X.normalizeEquipmentState(state);   // 此刻数据已被 rc96 删掉
  // 恢复别名（rc97 上线）
  const map = X.DEATHSPACE_LEGACY_ID_MAP;
  for (const legacyId of Object.keys(map)) {
    const def = X.EQUIPMENT_DB[map[legacyId]];
    if (def && !(legacyId in X.EQUIPMENT_DB)) Object.defineProperty(X.EQUIPMENT_DB, legacyId, { value: def, enumerable: false, writable: true, configurable: true });
  }
  X.migrateDeathspaceEquipmentIds(state);  // rc97 迁移
  const inv = state.equipment.inventory.slice();
  const inst = state.equipment.instances.map(i => i.itemId);
  const fit = state.inventory.ships[0].fitted.high.slice();
  console.log('  rc97 迁移后 inventory=' + JSON.stringify(inv) + ' instances=' + JSON.stringify(inst) + ' fitted=' + JSON.stringify(fit));
  check(!inv.includes("ded_angel_6_weapon") && !inv.some(id => map[id]), 'rc97 对已损坏存档：仓库仍无 DED 装备（无物可迁）', JSON.stringify(inv));
  check(!inst.includes("ded_angel_6_weapon"), 'rc97 对已损坏存档：实例仍无 DED 装备', JSON.stringify(inst));
}

console.log('\n========== 阶段 3：模拟「从未加载 rc96、直接上 rc97」==========');
{
  const state = makeLegacySave();
  // 别名已存在（rc97 代码），直接跑完整流程
  X.migrateEquipmentInstancesV1(state);
  X.normalizeEquipmentState(state);
  X.migrateDeathspaceEquipmentIds(state);
  const map = X.DEATHSPACE_LEGACY_ID_MAP;
  const modern = map["ded_angel_6_weapon"];
  const inv = state.equipment.inventory.slice();
  const inst = state.equipment.instances.map(i => i.itemId);
  const fit = state.inventory.ships[0].fitted.high.slice();
  console.log('  新 id = ' + modern);
  console.log('  rc97 直装 inventory=' + JSON.stringify(inv) + ' instances=' + JSON.stringify(inst) + ' fitted=' + JSON.stringify(fit));
  check(inv.includes(modern) || inst.includes(modern), 'rc97 直装：DED 装备被保留（别名兜底）', JSON.stringify(inv));
  const fitRef = fit[0];
  const fitResolved = X.resolveEquipmentReference ? X.resolveEquipmentReference(state, fitRef) : null;
  check(Boolean(fitResolved && fitResolved.definition && fitResolved.definition.id === modern), 'rc97 直装：舰上装配引用解析为新 id 装备', fitResolved && fitResolved.definition ? fitResolved.definition.id : String(fitRef));
}

console.log('\n================ 结果 ================');
console.log(ok ? 'ALL PASS（机制已实证）' : 'FAILED: ' + fail.length + ' 项');
if (loadFail.length) console.log('脚本加载失败: ' + loadFail.length, loadFail.slice(0, 3));
process.exit(ok ? 0 : 2);
