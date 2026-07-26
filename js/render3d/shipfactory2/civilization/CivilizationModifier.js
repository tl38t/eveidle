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
import { generateIndustrialHull } from "./IndustrialHull.js";
import { generateArchaeologyHull } from "./ArchaeologyHull.js";
import { generateShieldCapitalHull } from "./ShieldCapitalHull.js"; // 护盾旗舰/超旗环装饰
import { generateArmorCapitalHull } from "./ArmorCapitalHull.js";   // 装甲旗舰/超旗浮动装甲等专属结构
import { generateStructureCapitalHull } from "./StructureCapitalHull.js"; // 结构旗舰/超旗反应堆+相控阵
import { generateAngelCapitalHull } from "./AngelCapitalHull.js";    // 天使旗舰/超旗能量翼+尾部羽流
import { generateBloodCapitalHull } from "./BloodCapitalHull.js";    // 血袭者旗舰/超旗血核/犄角/镰翼
import { generateSanshaCapitalHull } from "./SanshaCapitalHull.js";  // 萨沙旗舰/超旗复制/谐振/触须

const GENERATORS = {
  box:        generateFortressHull,
  frame:      generateSkeletalHull,
  organic:    generateOrganicHull,
  overloaded: generateOverloadedHull,
  modular:    generateModularHull,
  industrial: generateIndustrialHull,
  archaeology: generateArchaeologyHull,
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

  // ── 护盾旗舰/超旗（Spear 锚点 + 护盾 faction 专享）叠加水平环 ──
  // 不作用于 Armor/Structure 种族（即使选了 Spear 锚点）
  const shipClass = ctx.spec && ctx.spec.hull;
  const anchor = ctx.profile && ctx.profile.anchor;
  const faction = ctx.spec && ctx.spec.faction;
  const isShieldFaction = faction && (faction === "shield" || faction === "player_shield");
  if ((shipClass === "capital" || shipClass === "supercapital") &&
      anchor === "Spear" && isShieldFaction) {
    return generateShieldCapitalHull(hullGroup, ctx);
  }

  // Player Shield：完全不动（零变化回归）
  if (hullType === "lathe") return hullGroup;

  const gen = GENERATORS[hullType];
  if (!gen) {
    console.warn(`CivilizationModifier: unknown hullType "${hullType}", falling back to lathe`);
    return hullGroup;
  }

  // 用新 Generator 产出的 hull Group 替代
  const result = gen(ctx);

  // ── 装甲旗舰/超旗：在 fortress 城堡箱体上叠加浮动装甲等专属结构 ──
  // 不作用于低舰级；shipClass 形如 "capital" / "supercapital" / 也兼容 "player_capital"。
  if (hullType === "box") {
    const sc = ctx.spec && ctx.spec.hull;
    const scBase = sc ? String(sc).replace(/^player_/, "") : "";
    if (scBase === "capital" || scBase === "supercapital") {
      return generateArmorCapitalHull(result, ctx);
    }
  }

  // ── 结构旗舰/超旗：在 skeletal 骨架舰上叠加反应堆 + 指挥塔/相控阵 ──
  if (hullType === "frame") {
    const sc = ctx.spec && ctx.spec.hull;
    const scBase = sc ? String(sc).replace(/^player_/, "") : "";
    if (scBase === "capital" || scBase === "supercapital") {
      return generateStructureCapitalHull(result, ctx, "G");
    }
  }

  // ── 天使旗舰/超旗：在 organic 弯曲生物曲面上叠加能量翼 + 尾部羽流 ──
  if (hullType === "organic") {
    const sc = ctx.spec && ctx.spec.hull;
    const scBase = sc ? String(sc).replace(/^player_/, "") : "";
    if (scBase === "capital" || scBase === "supercapital") {
      return generateAngelCapitalHull(result, ctx, "H");
    }
  }

  // ── 血袭者旗舰/超旗：在 overlord 鳐鱼曲面上叠加血核/犄角/镰翼 ──
  if (hullType === "overloaded") {
    const sc = ctx.spec && ctx.spec.hull;
    const scBase = sc ? String(sc).replace(/^player_/, "") : "";
    if (scBase === "capital" || scBase === "supercapital") {
      // capitalVariant 由 spec 指定（demo 用），生产环境缺省为 "G"（B 放大犄角 + C 镰翼）
      const variant = (ctx.spec && ctx.spec.capitalVariant) || "G";
      return generateBloodCapitalHull(result, ctx, variant);
    }
  }

  // ── 萨沙旗舰/超旗：在 modular 十二面体笼+内核上叠加复制/谐振/触须 ──
  if (hullType === "modular") {
    const sc = ctx.spec && ctx.spec.hull;
    const scBase = sc ? String(sc).replace(/^player_/, "") : "";
    if (scBase === "capital" || scBase === "supercapital") {
      // capitalVariant 由 spec 指定（demo 用）；生产环境按舰级分别默认：
      //   旗舰(capital) → "C" 面心触须；超旗(supercapital) → "F" 组合（A 复制 + B 谐振环 + C 触须）
      const variant = (ctx.spec && ctx.spec.capitalVariant) ||
        (scBase === "supercapital" ? "F" : "C");
      return generateSanshaCapitalHull(result, ctx, variant);
    }
  }

  return result;
}
