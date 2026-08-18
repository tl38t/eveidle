/* ================================================================
   改装件（rig）纯函数层
   见 RIG_SYSTEM_IMPLEMENTATION_PLAN.md 第七节。

   规则：
   - 纯函数：只读传入的 state / instance，不访问 DOM、不产生副作用。
   - rig 不参与装备强化（安装即消耗，无 enhancementLevel），故聚合时直接取
     def.bonuses，不乘强化倍率。
   - 同 stackGroup（同系列）可重复装配，但按 EVE 谐振（堆叠）惩罚聚合：
     getRigModifiers 返回按 bonusKey 聚合、组内按数值降序（最大吃满效）施加惩罚后的加权求和，
     供各系统（战斗容量 / 工业 / 考古扫描 / 燃料 / 干扰）读取。
   ================================================================ */

// EVE 谐振（堆叠）惩罚系数：同 stackGroup 内第 n 件（按数值降序排位，最大者 n=1 吃满效）的实际效果系数
// S(n) = 0.5 ^ ( ((n-1)/2.22292081)^2 )
const RIG_RESONANCE_DIVISOR = 2.22292081;
function getRigStackPenalty(position0) {
  const n = position0 + 1;
  return Math.pow(0.5, Math.pow((n - 1) / RIG_RESONANCE_DIVISOR, 2));
}

// 获取改装件定义
function getRigDefinition(rigItemId) {
  const def = EQUIPMENT_DB[rigItemId];
  return def && def.slot === "rig" ? def : null;
}

// 判断某装备定义是否为改装件
function isRigDefinition(def) {
  return Boolean(def && def.slot === "rig");
}

// 获取指定舰船实例上所有已安装改装件的定义
function getFittedRigDefinitions(state, instance) {
  const fitting = getFittingFromInstance(instance);
  return (fitting.rig || [])
    .map(ref => (ref ? resolveEquipmentReference(state, ref) : null))
    .filter(r => r && r.definition && r.definition.slot === "rig")
    .map(r => r.definition);
}

// 聚合改装件效果：按 stackGroup 分组，组内按数值降序（rigSeq 仅作同值并列时的稳定占位）施加 EVE 谐振惩罚后加权求和。
// 每个 stackGroup 对应唯一 bonusKey，故分组等价于按 bonusKey 聚合；不同系列互不惩罚。
function getRigModifiers(state, instance) {
  const fitting = getFittingFromInstance(instance);
  const rigSlots = (fitting && fitting.rig) || [];
  const groups = {}; // stackGroup -> [{ bonusKey, value, seq }]
  for (const ref of rigSlots) {
    if (!ref) continue;
    const r = resolveEquipmentReference(state, ref);
    if (!r || !r.definition || r.definition.slot !== "rig") continue;
    const def = r.definition;
    const sg = def.stackGroup || def.id;
    const seq = Number(r.instance && r.instance.rigSeq) || 0;
    for (const [key, value] of Object.entries(def.bonuses || {})) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      (groups[sg] = groups[sg] || []).push({ bonusKey: key, value: num, seq });
    }
  }
  const mods = {};
  for (const list of Object.values(groups)) {
    list.sort((a, b) => b.value - a.value || a.seq - b.seq); // 数值大者优先吃满效；同值按装配顺序，先装者占优
    list.forEach((entry, idx) => {
      const effective = entry.value * getRigStackPenalty(idx);
      mods[entry.bonusKey] = (mods[entry.bonusKey] || 0) + effective;
    });
  }
  return mods;
}

// 安装合法性检查（slot 类型 + 是否为 rig）。
// 同 stackGroup（同系列）允许重复装配（谐振惩罚在聚合层处理），故此处不再排重。
// level / slotIndex 边界 / combat-lock 等由 Action 层负责，此处只判定 rig 相关规则。
function canFitRig(state, instance, rigItemId, excludeSlotIndex) {
  const def = getRigDefinition(rigItemId);
  if (!def) return { ok:false, reason:"not-rig" };
  return { ok:true };
}

// 谐振预览：在 instance 上安装 rigItemId（同 stackGroup）后，该件的实际效果与累计。
// 返回 null 表示非 rig。按 EVE 规则：同组改装件按数值降序排位（最大者吃满效 S(1)），
// 新件依其数值在「现有+新件」降序队列中的位置确定实际生效系数（同值时现有件优先占位）。
function getRigResonancePreview(state, instance, rigItemId) {
  const def = getRigDefinition(rigItemId);
  if (!def || !def.bonuses) return null;
  const sg = def.stackGroup || def.id;
  const bonusKey = Object.keys(def.bonuses)[0];
  const baseValue = Number(def.bonuses[bonusKey]) || 0;
  const fitting = getFittingFromInstance(instance);
  const rigSlots = (fitting && fitting.rig) || [];
  const existing = [];
  for (const ref of rigSlots) {
    if (!ref) continue;
    const r = resolveEquipmentReference(state, ref);
    if (!r || !r.definition || r.definition.slot !== "rig") continue;
    const dsg = r.definition.stackGroup || r.definition.id;
    if (dsg !== sg) continue;
    const dVal = Number(Object.values(r.definition.bonuses || {})[0]) || 0;
    existing.push(dVal);
  }
  const sortedExisting = existing.slice().sort((a, b) => b - a);
  let totalBefore = 0;
  sortedExisting.forEach((v, idx) => { totalBefore += v * getRigStackPenalty(idx); });
  // 含待装件的完整降序队列；同值时现有件优先占位（新件排后，吃更高惩罚）
  const full = existing.map(v => ({ val: v, isNew: false }))
    .concat([{ val: baseValue, isNew: true }])
    .sort((a, b) => b.val - a.val || (a.isNew ? 1 : 0) - (b.isNew ? 1 : 0));
  const newIndex = full.findIndex(e => e.isNew);
  const newPosition = newIndex + 1;
  const penalty = getRigStackPenalty(newPosition - 1);
  const effectiveValue = baseValue * penalty;
  let totalAfter = 0;
  full.forEach((e, idx) => { totalAfter += e.val * getRigStackPenalty(idx); });
  return {
    stackGroup: sg,
    bonusKey,
    baseValue,
    existingCount: existing.length,
    newPosition,
    penalty,
    effectiveValue,
    reductionPct: 1 - penalty,
    totalBefore,
    totalAfter
  };
}

// 改装件显示态（供 UI 列出已装改装件）
function getRigDisplayState(state, instance) {
  return getFittedRigDefinitions(state, instance).map(d => ({
    id: d.id,
    name: d.name,
    stackGroup: d.stackGroup,
    rigCategory: d.rigCategory || "",
    level: d.level,
    tier: d.rigTier || "",
    bonuses: d.bonuses || {},
    levelLabel: (d.name.match(/[IVXL]+$/) || [""])[0]
  }));
}

window.getRigDefinition = getRigDefinition;
window.isRigDefinition = isRigDefinition;
window.getFittedRigDefinitions = getFittedRigDefinitions;
window.getRigModifiers = getRigModifiers;
window.canFitRig = canFitRig;
window.getRigDisplayState = getRigDisplayState;
window.getRigStackPenalty = getRigStackPenalty;
window.getRigResonancePreview = getRigResonancePreview;
