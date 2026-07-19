// HullGenerator.js — 基础船体（Hull）
// 职责：返回包含「车削船体 + 中央脊线饰条 + 舰桥窗 + 后掠翼 + 翼缘辉光」的 THREE.Group。
// 不处理发光缝（RibbonGenerator）/ 装甲板（ArmorGenerator）/ 武器环（WeaponGenerator）。
import * as THREE from "three";
import { rbox, material, glowMat } from "./Materials.js";
import { latheHull, extrudeWing } from "./Utils.js";

export function generateHull(ctx) {
  const { preset, s, L, hullMat, darkMat, glassMat, steelMat, palette } = ctx;
  const g = new THREE.Group();
  g.name = "hull";

  // ══ 基础船体（修长棱角剖面）═
  g.add(new THREE.Mesh(latheHull(L, preset.noseFat, preset.mid, preset.tail), hullMat));

  // ══ 中央脊线饰条（深蓝灰，沿背脊，细长低调）═
  g.add(rbox(L * 0.72, 0.036 * s, 0.07 * s, 0.018 * s, darkMat,
    [0, preset.mid * s * 0.92, -0.02 * L]));

  // ══ 舰桥窗（小型发光区——大船上也要保持小巧，上限封顶）═
  const bridgeR = Math.min(0.10 * s, 0.12);
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(bridgeR, 12, 10), glassMat);
  bridge.position.set(-0.08 * s, Math.max(0.18 * s, bridgeR + 0.04 * s), -L * 0.28);
  g.add(bridge);

  // ══ 后掠翼（金属翼面 + 翼缘发光条）═
  const wingGeo = extrudeWing(preset.wingSpan * s, 1.3 * s, 0.8 * s, 1.2 * s, 0.10 * s);
  const wingTipX = 0.5 * s + preset.wingSpan * s * Math.cos(0.42);
  const wingTipZ = -0.1 * L + preset.wingSpan * s * Math.sin(0.42);
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, steelMat);
    w.position.set(side * 0.5 * s, -0.04 * s, -0.1 * L);
    w.rotation.set(0, side * 0.42, side * 0.06);
    g.add(w);
    // 翼缘发光条
    const edgeGlow = glowMat(palette, 1.0);
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(preset.wingSpan * s * 0.9, 0.03 * s, 0.08 * s),
      edgeGlow
    );
    edge.position.set(
      side * (0.5 * s + preset.wingSpan * s * 0.45 * Math.cos(0.42)),
      -0.04 * s,
      -0.1 * L + preset.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s
    );
    edge.rotation.set(0, side * 0.42, 0);
    g.add(edge);
  }

  return g;
}
