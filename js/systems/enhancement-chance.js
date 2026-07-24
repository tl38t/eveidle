/* ================================================================
   共用强化成功率 — 边际递减纯函数层

   舰船强化与装备强化共享同一套成功率公式，防止两套复制公式漂移。
   2026-07-24 建立：从 equipment-enhancement.js 提取，改为通用参数名。

   skillBonus = 技能溢出收益，最高 0.30
   levelPenalty = 强化等级递增惩罚
   final = clamp(0.50 + skillBonus − levelPenalty, 0.05, 0.80)
   ================================================================ */

function getEnhancementChanceBreakdown(engineeringLevel, requirementLevel, currentLevel) {
  const eng = Math.max(1, Number(engineeringLevel) || 1);
  const req = Math.max(1, Number(requirementLevel) || 1);
  const gap = Math.max(0, eng - req);
  const L = Math.max(0, Math.floor(Number(currentLevel) || 0));

  // 技能溢出收益（递减，最高 30%）
  const skillBonusRaw =
    0.02 * Math.min(gap, 10) +
    0.005 * Math.min(Math.max(gap - 10, 0), 15) +
    0.001 * Math.max(gap - 25, 0);
  const skillBonus = Math.min(skillBonusRaw, 0.30);

  // 强化等级惩罚（递增）
  const levelPenalty =
    0.015 * Math.min(L, 5) +
    0.03 * Math.min(Math.max(L - 5, 0), 5) +
    0.05 * Math.min(Math.max(L - 10, 0), 5) +
    0.08 * Math.max(L - 15, 0);

  const raw = 0.50 + skillBonus - levelPenalty;
  const final = Math.max(0.05, Math.min(0.80, raw));
  return { base: 0.50, skillBonus, levelPenalty, final };
}

function getEnhancementChance(engineeringLevel, requirementLevel, currentLevel) {
  return getEnhancementChanceBreakdown(engineeringLevel, requirementLevel, currentLevel).final;
}
