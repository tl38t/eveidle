// ---- 弹药实例系统 ----
// 弹药从 `ammo:<weapon>` 纯计数（state.resources.ammunition）改为 `state.ammo` 实例数组：
//   { id, type:"laser"|"missile"|"cannon", tier:"T1"|"T2", name, props:{dmgMult,hitMult}, qty, loaded }
// - 普通弹(props 全 1)与 T2 弹(props 带数值)都是实例，区别只在属性高低（用户定：全部实例化）。
// - loaded(默认 true)：战斗中是否参战；玩家在战斗面板勾选「参战」控制。
// - 消耗时「优先高级」：从已装载(loaded)栈里按 tier 降序扣。
// - 离线战斗用虚拟快照（ensureVirtualAmmoFuel）读取已装载总量、flush 时 applyAmmoDelta 回写净消耗。
// 全函数挂全局，供 combat.js / offline-combat.js / station.js / manufacturing.js / selectors.js 调用。

let _ammoSeq = 0;
function nextAmmoId() { _ammoSeq += 1; return "am" + _ammoSeq; }

const AMMO_TIER_PROPS = Object.freeze({
  T1: Object.freeze({ dmgMult: 1.0, hitMult: 1.0 }),
  T2: Object.freeze({ dmgMult: 1.1, hitMult: 1.1 }) // 用户定：独立乘区 ×1.10（伤害+命中）
});
const AMMO_TYPE_NAMES = Object.freeze({ laser: "激光晶体弹药", missile: "导弹", cannon: "炮台弹药" });

function ensureAmmoArray(state) {
  if (!Array.isArray(state.ammo)) state.ammo = [];
  return state.ammo;
}
function ammoTierRank(t) { return t === "T2" ? 2 : 1; }

function getAmmoStacks(state, type) {
  return ensureAmmoArray(state).filter(s => s.type === type);
}
function getAmmoCount(state, type) {
  return getAmmoStacks(state, type).reduce((a, s) => a + (s.qty || 0), 0);
}
// 已装载(loaded)且有量的某类型栈，按 tier 降序（优先高级）
function getSelectedStacks(state, type) {
  return ensureAmmoArray(state)
    .filter(s => s.type === type && s.loaded !== false && (s.qty || 0) > 0)
    .sort((a, b) => ammoTierRank(b.tier) - ammoTierRank(a.tier));
}
function getSelectedCount(state, type) {
  return getSelectedStacks(state, type).reduce((a, s) => a + s.qty, 0);
}
function hasSelectedAmmo(state, type) {
  return ensureAmmoArray(state).some(s => s.type === type && s.loaded !== false && (s.qty || 0) > 0);
}
function getSelectedTotal(state) {
  return ensureAmmoArray(state).filter(s => s.loaded !== false && (s.qty || 0) > 0).reduce((a, s) => a + s.qty, 0);
}
// 该类型是否已装载任意 T2 弹（用于 supplies 栏 ⚡T2 标记）
function getSelectedHasT2(state, type) {
  return ensureAmmoArray(state).some(s => s.type === type && s.tier === "T2" && s.loaded !== false && (s.qty || 0) > 0);
}
// 优先高级消耗某类型 amount 发；返回 {ok, tier}（tier 为本波实际所用最高档）
function consumeAmmoForType(state, type, amount) {
  const stacks = getSelectedStacks(state, type);
  if (stacks.length === 0) return { ok:false, tier:"T1" };
  let need = amount, usedTier = stacks[0].tier;
  for (const s of stacks) {
    if (need <= 0) break;
    const take = Math.min(need, s.qty);
    s.qty -= take; need -= take;
  }
  state.ammo = state.ammo.filter(s => (s.qty || 0) > 0);
  return { ok:true, tier: usedTier };
}
// 离线 flush 回写净消耗（从 loaded 栈优先高级扣）
function applyAmmoDelta(state, type, used) {
  if (used <= 0) return;
  const stacks = getSelectedStacks(state, type);
  let need = used;
  for (const s of stacks) {
    if (need <= 0) break;
    const take = Math.min(need, s.qty);
    s.qty -= take; need -= take;
  }
  state.ammo = state.ammo.filter(s => (s.qty || 0) > 0);
}
// 制造产出：同型同档(loaded)合并，否则新建实例。tier/props 缺省按 T1（全 1）。
function addAmmo(state, opts) {
  const arr = ensureAmmoArray(state);
  const t = opts.tier || "T1";
  const p = opts.props || AMMO_TIER_PROPS[t];
  const nm = opts.name || AMMO_TYPE_NAMES[opts.type] || "弹药";
  const existing = arr.find(s => s.type === opts.type && s.tier === t && s.loaded !== false);
  if (existing) existing.qty += opts.qty;
  else arr.push({ id: nextAmmoId(), type: opts.type, tier: t, name: nm, props: { dmgMult: p.dmgMult, hitMult: p.hitMult }, qty: opts.qty, loaded: true });
}
function getAmmoTierProps(tier) { return AMMO_TIER_PROPS[tier] || AMMO_TIER_PROPS.T1; }

// 旧存档兼容：resources.ammunition 计数 → state.ammo 实例（T1，props 全 1）
function migrateLegacyAmmunition(state) {
  if (!state) return;
  // 旧存档：resources.ammunition 计数 → 实例
  if (!state.ammo && state.resources && state.resources.ammunition) {
    const legacy = state.resources.ammunition;
    state.ammo = [];
    for (const type of ["laser", "missile", "cannon"]) {
      const qty = legacy[type] || 0;
      if (qty > 0) state.ammo.push({ id: nextAmmoId(), type, tier: "T1", name: AMMO_TYPE_NAMES[type] || "弹药", props: { dmgMult: 1, hitMult: 1 }, qty, loaded: true });
    }
    delete state.resources.ammunition;
  }
  if (!Array.isArray(state.ammo)) state.ammo = [];
  // 新档一次性发放起始 T1 弹药（保持原 500/型 起步可玩性；标志位持久化，避免后续刷怪耗尽后重复发放）
  if (!state.ammoBootstrapped) {
    if (state.ammo.length === 0) {
      for (const type of ["laser", "missile", "cannon"]) addAmmo(state, { type, tier: "T1", qty: 500 });
    }
    state.ammoBootstrapped = true;
  }
}
