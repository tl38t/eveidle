/* ================================================================
   CombatModifiers — 可组合战斗修正管线

   当前技能、舰船、装备与区域加成也走同一计算方式；未来Buff、Debuff
   只需写入 state.combat.modifiers，不需要改动基础公式。
   ================================================================ */

function combatModifierMatches(modifier, stat, context) {
  if (!modifier || modifier.active === false || modifier.stat !== stat) return false;
  const details = context || {};
  if (modifier.expiresAt && Number.isFinite(details.now) && details.now >= modifier.expiresAt) return false;
  for (const key of ["actor", "weaponType", "layer", "zoneId", "enemyKind"]) {
    if (modifier[key] !== undefined && modifier[key] !== details[key]) return false;
  }
  return true;
}

function getCombatModifiersFromState(state, stat, context) {
  const modifiers = state && state.combat && Array.isArray(state.combat.modifiers) ? state.combat.modifiers : [];
  return modifiers.filter(modifier => combatModifierMatches(modifier, stat, context)).map(modifier => ({ ...modifier }));
}

function applyCombatModifiers(baseValue, modifiers) {
  const ordered = (modifiers || []).map((modifier, index) => ({ ...modifier, _index:index }))
    .sort((left, right) => (Number(left.priority) || 100) - (Number(right.priority) || 100) || left._index - right._index);
  let value = Number(baseValue) || 0;
  for (const modifier of ordered) {
    const amount = Number(modifier.value);
    if (!Number.isFinite(amount)) continue;
    if (modifier.operation === "add") value += amount;
    else if (modifier.operation === "multiply") value *= amount;
    else if (modifier.operation === "override") value = amount;
    else if (modifier.operation === "min") value = Math.min(value, amount);
    else if (modifier.operation === "max") value = Math.max(value, amount);
  }
  return value;
}

function calculateCombatStatFromState(state, stat, baseValue, builtInModifiers, context) {
  return applyCombatModifiers(baseValue, [
    ...(builtInModifiers || []),
    ...getCombatModifiersFromState(state, stat, context)
  ]);
}

