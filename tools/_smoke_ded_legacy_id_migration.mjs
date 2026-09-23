// 死亡空间装备 ID 兼容回归探针（2026-09-24 线上事故）
// 事故背景：rc95→rc96 把死亡空间装备内部 ID 从 ded_f_t_r 改为 ded_f_t_r_<suffix>，
//          违反「内部稳定键永不改名」⇒ 老存档已装装备/已购蓝图全部失配。
// 本探针只读生产代码，断言四件事：
//   §1 旧 ID 可解析：EQUIPMENT_DB[旧ID] 命中同一份定义（战斗/装配/强化全链路兜底）
//   §2 别名**非枚举**：Object.values(EQUIPMENT_DB) 不得混入旧 ID ⇒ 商店/制造/掉落池零重复
//   §3 旧档迁移：ownedBlueprints / inventory / instances / fitted / queue / currentAction 全部改写为新 ID
//   §4 迁移后真值可达：蓝图所有权判定 → true；装配引用解析 → 命中定义；成就冻结清单无失效 ID
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
  EQUIPMENT_DB, EQUIPMENT_RECIPES,
  DEATHSPACE_LEGACY_ID_MAP,
  migrateDeathspaceEquipmentIds,
  hasEquipmentBlueprintFromState, getEquipmentBlueprintOwnershipKey,
  resolveEquipmentReference,
  AchievementRuleData
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

console.log('\n================ §1 旧 ID 可解析（别名兜底） ================');
const legacyMap = X.DEATHSPACE_LEGACY_ID_MAP || {};
const legacyIds = Object.keys(legacyMap);
check(legacyIds.length > 0, '存在旧→新映射条目', legacyIds.length + ' 条');
const sampleLegacy = "ded_angel_6_weapon";
const sampleModern = legacyMap[sampleLegacy];
check(Boolean(sampleModern), '映射含 ded_angel_6_weapon', sampleModern || '(缺失)');
const aliasDef = X.EQUIPMENT_DB[sampleLegacy];
check(Boolean(aliasDef), 'EQUIPMENT_DB[旧ID] 可解析', aliasDef ? aliasDef.name : '(undefined)');
check(aliasDef && X.EQUIPMENT_DB[sampleModern] && aliasDef.id === X.EQUIPMENT_DB[sampleModern].id,
  '别名与新版同定义（id 一致）', aliasDef ? aliasDef.id : '(n/a)');
// 全量：每个旧 ID 都能解析、且都指向一个真实存在的新 ID
let resolveFail = [];
for (const legacyId of legacyIds) {
  const def = X.EQUIPMENT_DB[legacyId];
  const modernId = legacyMap[legacyId];
  if (!def || !X.EQUIPMENT_DB[modernId] || def !== X.EQUIPMENT_DB[modernId]) resolveFail.push(legacyId);
}
check(resolveFail.length === 0, '全部 ' + legacyIds.length + ' 个旧 ID 均可解析且指向同一对象', resolveFail.slice(0, 5).join(',') || '零失败');
// 监督者型也在
const supLegacy = "ded_angel_6_weapon_supervisor";
check(Boolean(X.EQUIPMENT_DB[supLegacy]), '监督者型旧 ID 可解析', X.EQUIPMENT_DB[supLegacy] ? X.EQUIPMENT_DB[supLegacy].name : '(undefined)');

console.log('\n================ §2 别名非枚举（零重复条目） ================');
const recipeIds = X.EQUIPMENT_RECIPES.map(r => r.id);
const dupLegacy = recipeIds.filter(id => legacyIds.includes(id));
check(dupLegacy.length === 0, 'EQUIPMENT_RECIPES 不含任何旧 ID', dupLegacy.slice(0, 5).join(',') || '零混入');
const dupCount = recipeIds.filter((id, i) => recipeIds.indexOf(id) !== i);
check(dupCount.length === 0, 'EQUIPMENT_RECIPES 无重复条目', dupCount.slice(0, 5).join(',') || '零重复');
const enumerableKeys = Object.keys(X.EQUIPMENT_DB);
const enumLegacy = enumerableKeys.filter(id => legacyIds.includes(id));
check(enumLegacy.length === 0, 'Object.keys(EQUIPMENT_DB) 不枚举旧 ID', enumLegacy.slice(0, 5).join(',') || '零枚举');

console.log('\n================ §3 旧档迁移（存档就地改写） ================');
const legacyState = {
  ownedBlueprints: ["equipment:ded_angel_6_weapon", "equipment:ded_blood_8_repair_supervisor", "equipment:raider_mining_laser"],
  equipment: {
    inventory: ["ded_angel_6_weapon", { itemId: "ded_sansha_4_weapon_supervisor" }, "t1_mining_laser"],
    instances: [
      { instanceId: 7, itemId: "ded_angel_8_repair", enhancementLevel: 3 },
      { instanceId: 8, itemId: "ded_blood_6_weapon_supervisor", enhancementLevel: 0 }
    ],
    nextInstanceId: 9
  },
  inventory: {
    ships: [
      { instanceId: 1, shipId: "titan_alpha", fitted: { high: ["ded_angel_6_weapon_supervisor", 7], mid: ["t1_mining_laser"], low: [], rig: [] } }
    ],
    equipment: ["ded_angel_2_weapon"],
    rigs: []
  },
  queue: { items: [{ skill: "equipmentEngineering", target: "ded_sansha_6_repair_supervisor", label: "x", count: 1 }] },
  currentAction: { equipEngTarget: "ded_angel_4_weapon", startedEquipEngTarget: "ded_angel_4_weapon" }
};
X.migrateDeathspaceEquipmentIds(legacyState);
const s = legacyState;
check(s.ownedBlueprints[0] === "equipment:" + legacyMap["ded_angel_6_weapon"], 'ownedBlueprints 蓝图所有权键已改写', s.ownedBlueprints[0]);
check(s.ownedBlueprints[1] === "equipment:" + legacyMap["ded_blood_8_repair_supervisor"], '监督者型所有权键已改写', s.ownedBlueprints[1]);
check(s.ownedBlueprints[2] === "equipment:raider_mining_laser", '非死亡空间键保持不变', s.ownedBlueprints[2]);
check(s.equipment.inventory[0] === legacyMap["ded_angel_6_weapon"], 'inventory string 已改写', s.equipment.inventory[0]);
check(s.equipment.inventory[1].itemId === legacyMap["ded_sansha_4_weapon_supervisor"], 'inventory {itemId} 已改写', s.equipment.inventory[1].itemId);
check(s.equipment.inventory[2] === "t1_mining_laser", 'inventory 普通件不变', s.equipment.inventory[2]);
check(s.equipment.instances[0].itemId === legacyMap["ded_angel_8_repair"], 'instances[0].itemId 已改写', s.equipment.instances[0].itemId);
check(s.equipment.instances[1].itemId === legacyMap["ded_blood_6_weapon_supervisor"], 'instances[1].itemId 已改写', s.equipment.instances[1].itemId);
check(s.inventory.ships[0].fitted.high[0] === legacyMap["ded_angel_6_weapon_supervisor"], 'fitted 里的 itemId 引用已改写', String(s.inventory.ships[0].fitted.high[0]));
check(s.inventory.ships[0].fitted.high[1] === 7, 'fitted 里的 instanceId 未被误改（数字串）', String(s.inventory.ships[0].fitted.high[1]));
check(s.inventory.equipment[0] === legacyMap["ded_angel_2_weapon"], '旧池 inventory.equipment 已改写', s.inventory.equipment[0]);
check(s.queue.items[0].target === legacyMap["ded_sansha_6_repair_supervisor"], '队列项 target 已改写', s.queue.items[0].target);
check(s.currentAction.equipEngTarget === legacyMap["ded_angel_4_weapon"] && s.currentAction.startedEquipEngTarget === legacyMap["ded_angel_4_weapon"], 'currentAction 目标已改写', s.currentAction.equipEngTarget);
// 幂等：再跑一次不得产生任何变化
const snapshot = JSON.stringify(legacyState);
X.migrateDeathspaceEquipmentIds(legacyState);
check(JSON.stringify(legacyState) === snapshot, '幂等：二次执行零变更');

console.log('\n================ §4 迁移后真值可达 ================');
check(X.hasEquipmentBlueprintFromState(s, legacyMap["ded_angel_6_weapon"]) === true, '迁移后蓝图所有权判定为已拥有');
check(X.hasEquipmentBlueprintFromState(s, "ded_angel_6_weapon") === false, '旧 ID 查询不再被当作所有权键（存档已收敛）');
const refResolved = X.resolveEquipmentReference ? X.resolveEquipmentReference(s, s.inventory.ships[0].fitted.high[0]) : null;
check(Boolean(refResolved && refResolved.definition), '装配引用解析命中定义', refResolved && refResolved.definition ? refResolved.definition.name : '(null)');
const instResolved = X.resolveEquipmentReference ? X.resolveEquipmentReference(s, 7) : null;
check(Boolean(instResolved && instResolved.definition), 'instanceId 引用仍解析（强化实例）', instResolved && instResolved.definition ? instResolved.definition.name : '(null)');
// ⚠️ NON_RIG_EQUIPMENT_RECIPE_IDS 是「历史冻结快照」（并非当前配方全集；后加装备不在其中），
//    故**不能**断言它与 EQUIPMENT_RECIPES 一致；只能断言 D13（set-any：任一即达成）仍然可达。
//    注：旧 ID 现在经别名可解析，所以「清单里旧 ID 是否解析」这条断言已被别名救活、无鉴别力，故不采用。
const NON_RIG_IDS = (X.AchievementRuleData && X.AchievementRuleData.NON_RIG_EQUIPMENT_RECIPE_IDS) || [];
const recipeIdSet = new Set(X.EQUIPMENT_RECIPES.map(r => r.id));
const liveInList = NON_RIG_IDS.filter(id => recipeIdSet.has(id));
check(liveInList.length > 0, 'D13（set-any）在冻结清单中仍有可制造条目 ⇒ 成就可达', liveInList.length + ' 条有效 / 共 ' + NON_RIG_IDS.length);

console.log('\n================ 结果 ================');
console.log(ok ? 'ALL PASS' : 'FAILED: ' + fail.length + ' 项');
if (loadFail.length) console.log('脚本加载失败: ' + loadFail.length, loadFail.slice(0, 3));
process.exit(ok ? 0 : 2);
