// CivilizationModifier.js — Phase 5 Rework：文明视觉调度层
//
// 职责：根据 ctx.civ.hullType 路由到正确的 hull generator。
//       替代旧的 HullStyleModifier.js（已删除）。
//
// 调度逻辑：
//   "lathe"     → pass-through（HullGenerator 原始输出，Player Shield 专用）
//   "box"       → FortressHull.generate(ctx)          — Player Armor
//   "frame"     → SkeletalHull.generate(ctx)          — Player Structure
//   "organic"   → OrganicHull.generate(ctx)           — Angel Cartel
//   "overloaded"→ OverloadedHull.generate(ctx)        — Blood Raider
//   "modular"   → ModularHull.generate(ctx)           — Sansha's Nation
//
// 返回值：THREE.Group（完整的 hull group，包含公共元素）。
// Player Shield 直接返回原始 hullGroup（零变化回归）。

import { generateFortressHull } from "./FortressHull.js";
import { generateSkeletalHull } from "./SkeletalHull.js";
import { generateOrganicHull } from "./OrganicHull.js";
import { generateOverloadedHull } from "./OverloadedHull.js";
import { generateModularHull } from "./ModularHull.js";

const GENERATORS = {
  box:        generateFortressHull,
  frame:      generateSkeletalHull,
  organic:    generateOrganicHull,
  overloaded: generateOverloadedHull,
  modular:    generateModularHull,
};

/**
 * applyCivilization(hullGroup, ctx)
 *
 * 在 HullGenerator 产出原始 hullGroup 后调用。
 * - Shield（hullType="lathe"）：原样返回。
 * - 其他五族：调用对应 Generator 生成全新的 hull Group，替换 hullGroup。
 *
 * @param {THREE.Group} hullGroup - HullGenerator 产出的原始 hull group
 * @param {ShipContext} ctx
 * @returns {THREE.Group}
 */
export function applyCivilization(hullGroup, ctx) {
  const hullType = ctx.civ.hullType;

  // Player Shield：完全不动（零变化回归）
  if (hullType === "lathe") return hullGroup;

  const gen = GENERATORS[hullType];
  if (!gen) {
    console.warn(`CivilizationModifier: unknown hullType "${hullType}", falling back to lathe`);
    return hullGroup;
  }

  // 用新 Generator 产出的 hull Group 替代
  return gen(ctx);
}
