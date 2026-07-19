// ShipContext.js — Phase 2 共享数据中心（基础框架）
//
// Commit 1（本提交）：仅把原 ShipFactory2.js 中的"临时 ctx 对象"正式化为一个模块。
//   字段名与构造行为与原 ctx 完全一致 —— 五个 Generator 接口不变，视觉 100% 不变。
//   本文件采用 class，便于后续提交逐步挂载方法（radiusAt / normalAt / sampleHullSurface /
//   bounds / seed / random / scope），无需改动 Generator 的调用方式。
//
// 依赖方向（单向，无环）：ShipContext → Utils / Materials；ShipContext 不依赖任何 Generator。
import { COLORS, material, glowMat } from "./Materials.js";
import { resolvePalette, HULL_PRESETS } from "./Utils.js";

export class ShipContext {
  constructor(spec = {}) {
    this.spec = spec;
    this.role = spec.role || (String(spec.hull || "").startsWith("enemy") ? "enemy" : "player");
    this.family = spec.family || "shield";

    // B 组：几何描述（由 hull 档位一次性派生）
    this.preset = HULL_PRESETS[spec.hull] || HULL_PRESETS.frigate;
    this.hullProfile = this.preset;                 // 别名，后续 Generator 可改用此名
    this.palette = resolvePalette(spec, this.role);
    this.s = this.preset.scale;
    this.scale = this.s;                            // 别名
    this.L = this.preset.len * this.s;
    this.length = this.L;                           // 别名
    this.hybrid = !!spec.hybrid;
    this.shipName = spec.id || spec.hull || "ship";

    // D 组：共享材质（一次构建，跨 Generator 复用，满足 AI Rules §11 复用材质）
    const accentPalette = spec.accentFaction && COLORS[spec.accentFaction] ? COLORS[spec.accentFaction] : null;
    const accentColor = accentPalette ? accentPalette.glow : this.palette.accent;
    this.hullMat = material(this.palette.hull, 0.86, 0.30);
    this.darkMat = material(this.palette.dark, 0.90, 0.32);
    this.accentMat = material(accentColor, 0.82, 0.28, this.hybrid ? COLORS.angel.glow : this.palette.glow, this.hybrid ? 0.5 : 0.3);
    this.steelMat = material(this.palette.steel, 0.93, 0.26);
    this.glassMat = material(this.palette.dark, 0.35, 0.15, this.hybrid ? COLORS.angel.glow : this.palette.glow, 0.9);
  }
}

// 工厂函数：ShipFactory2 调用入口（与 class 二选一，工厂更轻）
export function createShipContext(spec) {
  return new ShipContext(spec);
}
