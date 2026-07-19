// Utils.js — 几何/数学工具
// 拆分自 ShipFactory.js（v2.9）：纯函数、无副作用，供各 Generator 复用。
// 注意（Phase 3 Commit 3）：船体形状配置已迁移至 ShipProfile.js（Anchor 系统），
//   本文件不再持有任何预设/配置数据，只保留纯几何工具，避免 Generator 误依赖配置（AI Rules §19）。
import * as THREE from "three";
import { COLORS } from "./Materials.js";

// 给定轴向位置 z ∈ [-L/2, L/2]，返回船体在该处的剖面半径（与 latheHull 同一组控制点）
export function hullRadiusAt(z, fatR, midR, tailR, L) {
  const pts = [
    [-L / 2, 0.012], [-L / 2 + 0.06 * L, fatR * 0.38], [-L / 2 + 0.14 * L, fatR * 0.78],
    [-L / 2 + 0.24 * L, fatR], [-0.14 * L, midR * 0.92], [0.02 * L, midR],
    [0.28 * L, midR * 0.62], [0.48 * L, midR * 0.38], [0.72 * L, tailR],
    [L / 2 - 0.04 * L, tailR * 0.45], [L / 2, 0.012]
  ];
  if (z <= pts[0][0]) return pts[0][1];
  if (z >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [z0, r0] = pts[i], [z1, r1] = pts[i + 1];
    if (z >= z0 && z <= z1) return r0 + (r1 - r0) * (z - z0) / (z1 - z0);
  }
  return midR;
}

// 调色板解析：优先 spec.line，其次按角色回退
export function resolvePalette(spec, role) {
  if (spec.line && COLORS[spec.line]) return COLORS[spec.line];
  if (role === "enemy") return COLORS.angel;
  return COLORS.player_shield;
}

// 船体剖面（沿 Z，头=-Z）：极长收尖的不对称硬表面
export function latheHull(L, fatR, midR, tailR) {
  const p = (r, y) => new THREE.Vector2(Math.max(0.01, r), y);
  const profile = [
    p(0.012, -L / 2),
    p(fatR * 0.38, -L / 2 + 0.06 * L),
    p(fatR * 0.78, -L / 2 + 0.14 * L),
    p(fatR,       -L / 2 + 0.24 * L),
    p(midR * 0.92,-0.14 * L),
    p(midR,       0.02 * L),
    p(midR * 0.62, 0.28 * L),
    p(midR * 0.38, 0.48 * L),
    p(tailR,      0.72 * L),
    p(tailR * 0.45,L / 2 - 0.04 * L),
    p(0.012, L / 2)
  ];
  const geo = new THREE.LatheGeometry(profile, 8);
  geo.rotateX(Math.PI / 2);
  return geo;
}

// 后掠翼几何
export function extrudeWing(span, rootChord, tipChord, sweep, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -rootChord / 2); shape.lineTo(0, rootChord / 2);
  shape.lineTo(span, rootChord / 2 + sweep); shape.lineTo(span, -tipChord / 2 + sweep);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true,
    bevelThickness: thickness * 0.5, bevelSize: thickness * 0.5,
    bevelSegments: 2, steps: 1
  });
  geo.translate(0, 0, -thickness / 2);
  geo.rotateX(Math.PI / 2);
  return geo;
}
