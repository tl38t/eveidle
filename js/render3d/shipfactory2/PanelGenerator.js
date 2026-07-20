// PanelGenerator.js — 贴合船体表面的装甲板（Surface Panels）
// 职责：返回包含「扁平圆角板，沿法线贴附，钢色」的 THREE.Group。
// 与 ArmorGenerator 的边界划分（Phase 4 Commit 1）：
//   Armor = 航行灯 + 舰级专属上层建筑（dagger/gunboat/cruiser/fortress）+ 混血红色武装
//   Panel = 贴合表面的装甲板（视觉层次感，PROCEDURAL_SHIP_GUIDE §5）
// 不依赖任何配置文件（AI Rules §19），只读 ctx。
// 材质统一走 Materials.js（AI Rules §6）。
import * as THREE from "three";
import { rbox, material } from "./Materials.js";

export function generatePanels(ctx) {
  const { s, L, palette } = ctx;

  const g = new THREE.Group();
  g.name = "panels";

  // 贴合表面的装甲板（扁平圆角板，沿法线贴附，钢色；尺寸按局部半径封顶，不随 s 膨胀）
  const plateMat = material(palette.steel, 0.95, 0.24);
  const plateZones = [-0.05 * L, 0.18 * L];
  for (const z of plateZones) {
    const r = ctx.radiusAt(z) * 0.99;
    const localR = ctx.radiusAt(z);
    for (const side of [-1, 1]) {
      const phi = side * 0.62;
      const w = Math.min(0.32 * s, localR * 0.42);
      const h = Math.min(0.22 * s, localR * 0.30);
      const t = 0.042 * s;
      const plate = rbox(w, t, h, 0.015 * s, plateMat, [r * Math.sin(phi), r * Math.cos(phi), z]);
      plate.rotation.z = -phi; // 薄面贴合径向法线
      g.add(plate);
    }
  }

  return g;
}
