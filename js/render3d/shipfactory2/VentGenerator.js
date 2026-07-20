// VentGenerator.js — 通风/冷却格栅（Phase 4 Commit 4）
// 职责：返回包含「贴合表面的通风格栅」的 THREE.Group。
//   代表气流/冷却/压力管理系统，与 HeatSink（散热）互补。
//
// HeatSink ≠ Vent 的边界：
//   HeatSink = 热量散出（鳍片，solid fins）—— 热管理排放端
//   Vent     = 气流进出（槽口，slit grille）—— 冷却/压力管理进出端
//
// 设计原则：
//   - 不是随机黑洞，是功能型表面组件（空气/冷却管理）
//   - 位置来自 ctx._ventPoints（ShipFactory2 Anchor Bus 预计算）
//   - Vent 自己不找位置——消费上游 Anchor
//   - ctx.scope("vent") 隔离随机（不串扰其他 Generator）
//
// 第一版实现：Frame + 5~8 条 vent slits，BoxGeometry 组合。
//   不做 boolean cut / 真实洞 / alpha mask。
//   遵循 AI Rules §5（单一职责，返回 Group，无全局状态）
//   §6（材质走 Materials.js）§19（不 import 配置）。
import * as THREE from "three";
import { rbox, material } from "./Materials.js";

export function generateVents(ctx) {
  const { s, palette, _ventPoints } = ctx;
  const rng = ctx.scope("vent").random;

  const g = new THREE.Group();
  g.name = "vents";

  const ventPoints = _ventPoints || [];
  if (ventPoints.length === 0) return g;

  const frameMat = material(palette.dark, 0.93, 0.32);
  const slitMat  = material(palette.steel, 0.78, 0.55);

  for (const vp of ventPoints) {
    // ── 格栅尺寸，按舰级缩放 ──
    const vw = vp.size * 0.85 || 0.16 * s;   // X 宽度（沿船体横向）
    const vd = vp.size * 0.55 || 0.10 * s;   // Z 深度（沿船体纵向）
    const ft = 0.012 * s;                     // 边框厚度

    // ── Frame：贴合表面的薄矩形框 ──
    const frame = rbox(vw, ft, vd, 0.006 * s, frameMat,
      [vp.x, vp.y, vp.z]);

    // 对齐表面法线
    if (vp.nx !== undefined) {
      const angle = Math.atan2(vp.nx, vp.ny);
      frame.rotation.z = -angle;
    }

    g.add(frame);

    // ── Vent slits：Frame 内部的平行槽口 ──
    const slitCount = 5 + Math.floor(rng() * 4); // 5~8 条
    const slitW = vw * 0.72;                     // 单条 slit X 宽度
    const slitD = vd * 0.06;                     // 单条 slit Z 深度（细缝）
    const slitT = ft * 0.35;                     // slit Y 厚度
    const span = vd * 0.78;                      // slits 分布范围
    const step = span / (slitCount - 1);

    for (let i = 0; i < slitCount; i++) {
      const sz = vp.z - span * 0.5 + i * step;
      // slit 微凹：放在 frame 表面下方
      const sy = vp.y - ft * 0.3;

      const slit = rbox(slitW, slitT, slitD, 0.002 * s, slitMat,
        [vp.x, sy, sz]);

      if (vp.nx !== undefined) {
        slit.rotation.z = frame.rotation.z;
      }

      g.add(slit);
    }
  }

  return g;
}
