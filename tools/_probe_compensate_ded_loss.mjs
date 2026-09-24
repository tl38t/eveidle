// 补偿迁移验证探针（2026-09-24）
// 模拟：玩家在 rc96 已丢失 DED 装备（ownedBlueprints 键幸存），rc97（带 compensateDeathspaceLoss）加载后：
//  ① 非 10/10 DED 蓝图 → 补 10 件；② 10/10 蓝图 → 不补；③ 非 DED 蓝图 → 不补；④ 协议/核心材料各 +25；⑤ 一次性。
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
  createElement: () => makeElement(), createElementNS: () => ({ ...makeElement(), setAttribute: noop }),
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
  EQUIPMENT_DB, DEATHSPACE_LEGACY_ID_MAP, DEATHSPACE_LOOT_MATERIALS,
  migrateDeathspaceEquipmentIds, normalizeEquipmentState, migrateEquipmentInstancesV1, compensateDeathspaceLoss
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

function makeDamagedSave() {
  return {
    ownedBlueprints: [
      "equipment:ded_angel_6_weapon",          // 非10/10 DED → 应补 10
      "equipment:ded_precursor_10_weapon_laser", // 10/10 DED → 不补
      "equipment:t1_mining_laser"              // 非 DED → 不补
    ],
    equipment: {
      inventory: ["t1_mining_laser"],
      instances: [],
      nextInstanceId: 2
    },
    inventory: { ships: [{ instanceId: 1, shipId: "titan_alpha", fitted: { high:[null], mid:[], low:[], rig:[] } }], equipment: [], rigs: [] },
    resources: {},
    queue: { items: [] },
    currentAction: {},
    migrations: {}
  };
}

console.log('\n========== 模拟 rc96 损坏 → rc97(带补偿) 加载 ==========');
{
  const state = makeDamagedSave();
  // 阶段A：rc96（无别名）先跑一次，把旧 DED 实例/仓库删掉（ownedBlueprints 键幸存）
  for (const id of Object.keys(X.DEATHSPACE_LEGACY_ID_MAP)) delete X.EQUIPMENT_DB[id];
  X.migrateEquipmentInstancesV1(state);
  X.normalizeEquipmentState(state);
  // 阶段B：rc97（恢复别名）+ 迁移 + 补偿
  const map = X.DEATHSPACE_LEGACY_ID_MAP;
  for (const legacyId of Object.keys(map)) {
    const def = X.EQUIPMENT_DB[map[legacyId]];
    if (def && !(legacyId in X.EQUIPMENT_DB)) Object.defineProperty(X.EQUIPMENT_DB, legacyId, { value: def, enumerable: false, writable: true, configurable: true });
  }
  X.migrateDeathspaceEquipmentIds(state);
  X.compensateDeathspaceLoss(state);

  const modern = map["ded_angel_6_weapon"];
  const inv = state.equipment.inventory;
  const countDed = inv.filter(id => id === modern).length;
  const countT1 = inv.filter(id => id === "t1_mining_laser").length;
  const has10 = inv.includes("ded_precursor_10_weapon_laser");
  check(countDed === 10, '非10/10 DED 蓝图补 10 件', 'count=' + countDed + ' (' + modern + ')');
  check(!has10, '10/10 蓝图不补', has10 ? '误补' : '已排除');
  check(countT1 === 1, '非 DED 蓝图(t1)不补、原持有保留', 'count=' + countT1);
  check(state.migrations.deathspaceLossCompensated === true, '一次性门禁已置位', String(state.migrations.deathspaceLossCompensated));
  // 材料各 +25
  const mats = X.DEATHSPACE_LOOT_MATERIALS || [];
  let all25 = mats.length > 0;
  const bad = [];
  for (const name of mats) {
    const v = Number(state.resources["special:" + name]) || 0;
    if (v !== 25) { all25 = false; bad.push(name + '=' + v); }
  }
  check(all25, '全部 DED 协议/核心材料各 +25（共 ' + mats.length + ' 种）', bad.slice(0,4).join(',') || '全 25');
}

console.log('\n========== 幂等：二次加载不重复补 ==========');
{
  const state = makeDamagedSave();
  for (const id of Object.keys(X.DEATHSPACE_LEGACY_ID_MAP)) delete X.EQUIPMENT_DB[id];
  X.migrateEquipmentInstancesV1(state);
  X.normalizeEquipmentState(state);
  const map = X.DEATHSPACE_LEGACY_ID_MAP;
  for (const legacyId of Object.keys(map)) {
    const def = X.EQUIPMENT_DB[map[legacyId]];
    if (def && !(legacyId in X.EQUIPMENT_DB)) Object.defineProperty(X.EQUIPMENT_DB, legacyId, { value: def, enumerable: false, writable: true, configurable: true });
  }
  X.migrateDeathspaceEquipmentIds(state);
  X.compensateDeathspaceLoss(state);
  const snap = JSON.stringify(state);
  X.compensateDeathspaceLoss(state);   // 二次调用（门禁应拦截）
  const modern = map["ded_angel_6_weapon"];
  const countDed = state.equipment.inventory.filter(id => id === modern).length;
  check(countDed === 10, '二次调用后仍为 10 件（未翻倍）', 'count=' + countDed);
  check(JSON.stringify(state) === snap, '二次调用零变更（幂等）', JSON.stringify(state) === snap ? 'yes' : 'CHANGED');
}

console.log('\n================ 结果 ================');
console.log(ok ? 'ALL PASS' : 'FAILED: ' + fail.length + ' 项');
if (loadFail.length) console.log('脚本加载失败: ' + loadFail.length, loadFail.slice(0, 3));
process.exit(ok ? 0 : 2);
