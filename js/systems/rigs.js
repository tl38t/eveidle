/* ================================================================
   改装件（rig）纯函数层
   见 RIG_SYSTEM_IMPLEMENTATION_PLAN.md 第七节。

   规则：
   - 纯函数：只读传入的 state / instance，不访问 DOM、不产生副作用。
   - rig 不参与装备强化（安装即消耗，无 enhancementLevel），故聚合时直接取
     def.bonuses，不乘强化倍率。
   - getRigModifiers 返回按 bonusKey 聚合的加法项，供各系统（战斗容量 / 工业 /
     考古扫描 / 燃料 / 干扰）读取。
   ================================================================ */

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

// 聚合改装件效果（按 bonusKey 相加）
function getRigModifiers(state, instance) {
  const mods = {};
  for (const def of getFittedRigDefinitions(state, instance)) {
    if (!def.bonuses) continue;
    for (const [key, value] of Object.entries(def.bonuses)) {
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      mods[key] = (mods[key] || 0) + num;
    }
  }
  return mods;
}

// 安装合法性检查（slot 类型 + stackGroup 同组排重）。
// level / slotIndex 边界 / combat-lock 等由 Action 层负责，此处只判定 rig 相关规则。
// excludeSlotIndex：替换场景下需排除当前目标槽（其旧件将被销毁），避免同组自我误判。
function canFitRig(state, instance, rigItemId, excludeSlotIndex) {
  const def = getRigDefinition(rigItemId);
  if (!def) return { ok:false, reason:"not-rig" };
  const stackGroup = def.stackGroup;
  if (stackGroup) {
    const fitting = getFittingFromInstance(instance);
    const rigSlots = fitting.rig || [];
    for (let i = 0; i < rigSlots.length; i++) {
      if (i === excludeSlotIndex) continue;
      const ref = rigSlots[i];
      if (!ref) continue;
      const r = resolveEquipmentReference(state, ref);
      if (r && r.definition && r.definition.stackGroup === stackGroup) {
        return { ok:false, reason:"same-stack-group-exists" };
      }
    }
  }
  return { ok:true };
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
