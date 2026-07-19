// EngineGenerator.js — 引擎舱与尾焰
// 职责：返回包含「引擎舱（按舰级布局）+ 尾焰辉光」的 THREE.Group。
import * as THREE from "three";
import { addPart, material, glowMat, COLORS, additiveGlowMaterial } from "./Materials.js";

function addEngine(group, x, y, z, radius, palette, length = 1.6) {
  const casing = material(palette.dark, 0.88, 0.32);
  const steel = material(palette.steel, 0.92, 0.26);
  const glow = glowMat(palette, 1.6);
  addPart(group, new THREE.CylinderGeometry(radius * 0.8, radius, length, 18), casing, [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, 0.16, 18), steel, [x, y, z + length * 0.5], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.05, 18), glow, [x, y, z + length * 0.5 + 0.1], [Math.PI / 2, 0, 0]);
  const exMat = additiveGlowMaterial(palette.glow, 0.2, THREE.FrontSide);
  const exhaust = addPart(group, new THREE.ConeGeometry(radius * 0.55, 1.6, 16, 1, true), exMat,
    [x, y, z + length * 0.5 + 0.85], [Math.PI / 2, 0, 0]);
  exhaust.name = "exhaust";
}

export function generateEngines(ctx) {
  const { preset, s, L, hybrid, palette } = ctx;
  const g = new THREE.Group();
  g.name = "engines";

  let ex;
  if (preset.body === "gunboat") ex = [-0.9 * s, 0.9 * s];
  else if (preset.engines === 3) ex = [-0.65 * s, 0, 0.65 * s];
  else ex = [-0.5 * s, 0.5 * s];

  for (const exx of ex)
    addEngine(g, exx, -0.08 * s, L * 0.5, 0.24 * s, hybrid ? COLORS.angel : palette);

  return g;
}
