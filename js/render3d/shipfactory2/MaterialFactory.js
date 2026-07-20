// MaterialFactory.js — Phase 5 Commit 1：语义化材质工厂
// 职责：根据语义类型 + ctx 返回材质，替代 Generator 内直接调用 material()/glowMat()。
// 这是 Phase 5 C1 最小抽象层：只集中材质创建，不引入 Style DNA，不改变 Generator 参数。
//
// 数据流（Phase 5 C1）：
//   Generator → MaterialFactory.get("type", ctx) → material(...)
//   Generator → MaterialFactory.getGlow("type", ctx, intensity) → glowMat(...)
//   Generator → MaterialFactory.getAdditive("type", ctx, opacity, side) → additiveGlowMaterial(...)
//
// C2 起：MaterialFactory 内部将从 ctx.style 读取 faction 特定参数。
// C1 只做路由集中，几何指纹零变化。

import * as THREE from "three";
import { material, glowMat, additiveGlowMaterial, COLORS, RING_COLOR, SHIELD_COLOR } from "./Materials.js";

// ── 语义类型 → { paletteKey, metalness, roughness } ──
// 所有 metalness/roughness 均与当前 Generator 内联值逐项一致（Phase 4 基线）。
const STD = {
  // palette.hull 族 —— 装甲主色调
  armorPrimary:      { key: "hull",  m: 0.86, r: 0.30 },
  armorDeck:         { key: "hull",  m: 0.87, r: 0.32 },
  armorFortress:     { key: "hull",  m: 0.88, r: 0.32 },

  // palette.dark 族 —— 结构暗部
  groove:            { key: "dark",  m: 0.35, r: 0.80 },
  heatSinkBase:      { key: "dark",  m: 0.92, r: 0.35 },
  hatchDoor:         { key: "dark",  m: 0.94, r: 0.28 },
  ventFrame:         { key: "dark",  m: 0.93, r: 0.30 },
  weaponSpike:       { key: "dark",  m: 0.86, r: 0.30 },
  weaponRing:        { key: "dark",  m: 0.90, r: 0.32 },
  weaponBase:        { key: "dark",  m: 0.88, r: 0.30 },  // 激光发射舱底座

  // palette.steel 族 —— 金属构件
  panelPlate:        { key: "steel", m: 0.95, r: 0.24 },
  heatSinkFin:       { key: "steel", m: 0.88, r: 0.42 },
  hatchHandle:       { key: "steel", m: 0.90, r: 0.30 },
  ventSlit:          { key: "steel", m: 0.85, r: 0.72 },  // 原硬编码 0xcccccc
  cannonBarrel:      { key: "steel", m: 0.90, r: 0.30 },

  // 引擎族 —— hybrid 时切换到 COLORS.angel
  engineCasing:      { key: "dark",  m: 0.88, r: 0.32 },
  engineRing:        { key: "steel", m: 0.92, r: 0.26 },

  // 混血专属 —— 永远映射到 COLORS.angel
  hybridAccent:      { key: "hull",  m: 0.84, r: 0.34 },
  hybridRed:         { key: "hull",  m: 0.84, r: 0.34 },
};

// ── 引擎 / 武器发射舱等：hybrid 时整组切换 palette ──
// 这些组件在 hybrid 模式下使用 COLORS.angel，非 hybrid 使用 ctx.palette。
const HYBRID_SWITCH_TYPES = new Set([
  "engineCasing", "engineRing",
  "weaponSpike", "weaponRing", "weaponBase", "cannonBarrel",
]);

// 永远使用 COLORS.angel 的类型（混血专属 accent/red）
const ANGEL_ONLY_TYPES = new Set(["hybridAccent", "hybridRed"]);

function _paletteForType(type, ctx) {
  if (ANGEL_ONLY_TYPES.has(type)) return COLORS.angel;
  if (HYBRID_SWITCH_TYPES.has(type) && ctx.hybrid) return COLORS.angel;
  return ctx.palette;
}

// ═══════════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════════

export const MaterialFactory = {

  // ── 标准材质（MeshStandardMaterial）──
  // type: 语义类型名（如 "armorPrimary", "panelPlate", "groove"）
  // ctx:  ShipContext 实例
  // overrides: { emissiveIntensity } — 可选，用于混合 accent 等特殊情形
  get(type, ctx, overrides = {}) {
    const def = STD[type];
    if (!def) throw new Error(`MaterialFactory.get: unknown type "${type}"`);

    const pal = _paletteForType(type, ctx);
    const color = pal[def.key];

    if (overrides.emissiveIntensity != null && pal === COLORS.angel) {
      // 混血 accent/red：带 emissive
      return material(color, def.m, def.r, pal.glow, overrides.emissiveIntensity);
    }

    return material(color, def.m, def.r);
  },

  // ── 发光材质（emissive）──
  // type: "ribbon" | "ring" | "energy" | "nav" | "wingGlow" | "spike" | "laser" | "engine" | "hybridGlow"
  // intensity: 发光强度（不同 Generator 可覆写）
  getGlow(type, ctx, intensity = 2.0) {
    const pal = ctx.palette;

    switch (type) {
      case "ribbon":
        return glowMat({ glow: pal.glow }, intensity);

      case "ring": {
        const ringColor = ctx.hybrid ? COLORS.angel.glow : RING_COLOR;
        return glowMat({ glow: ringColor }, intensity);
      }

      case "energy":
        return glowMat(pal, intensity);

      case "nav":
        return glowMat({ glow: pal.glow }, 2.6);

      case "wingGlow":
        return glowMat(pal, 1.0);

      case "spike":
        return glowMat(pal, intensity);

      case "laser": {
        // 激光发射舱：hybrid 时用 angel 调色板
        const laserPal = ctx.hybrid ? COLORS.angel : pal;
        return glowMat(laserPal, intensity);
      }

      case "engine":
        // 引擎发光环：hybrid 时用 angel
        const enginePal = ctx.hybrid ? COLORS.angel : pal;
        return glowMat(enginePal, intensity);

      case "hybridGlow":
        return glowMat(COLORS.angel, intensity);

      default:
        return glowMat(pal, intensity);
    }
  },

  // ── 加色混合材质（Additive Blending）──
  // type: "exhaust" | "shield"
  getAdditive(type, ctx, opacity = 0.2, side = THREE.FrontSide) {
    switch (type) {
      case "exhaust": {
        const glowColor = ctx.hybrid ? COLORS.angel.glow : ctx.palette.glow;
        return additiveGlowMaterial(glowColor, opacity, side);
      }
      case "shield":
        return additiveGlowMaterial(SHIELD_COLOR, opacity, side);
      default:
        return additiveGlowMaterial(ctx.palette.glow, opacity, side);
    }
  }
};
