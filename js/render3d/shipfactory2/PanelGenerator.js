// PanelGenerator.js — 贴合船体表面的装甲板（Surface Panels）
// 职责：返回包含「扁平圆角板，沿法线贴附，钢色」的 THREE.Group。
// 与 ArmorGenerator 的边界划分（Phase 4 Commit 1）：
//   Armor = 航行灯 + 舰级专属上层建筑（dagger/gunboat/cruiser/fortress）+ 混血红色武装
//   Panel = 贴合表面的装甲板（视觉层次感，PROCEDURAL_SHIP_GUIDE §5）
//
// Phase 4 Commit 3：暴露 panelInfos Anchor。
//   每个 panel 的 {x, y, z, w, d, phi} 写入 g.userData.panelInfos，
//   供 ShipFactory2（Anchor Bus）提取后转发给 HatchGenerator 消费。
//
// 不依赖任何配置文件（AI Rules §19），只读 ctx。
// 材质统一走 Materials.js（AI Rules §6）。
import * as THREE from "three";
import { rbox } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

export function generatePanels(ctx) {
  const { s, L } = ctx;

  const g = new THREE.Group();
  g.name = "panels";
  g.userData.panelInfos = [];

  // 贴合表面的装甲板（扁平圆角板，沿法线贴附，钢色；尺寸按局部半径封顶，不随 s 膨胀）
  const plateMat = MaterialFactory.get("panelPlate", ctx);

  // Phase 5 C3-A：panelDensity 控制面板行数
  const basePanelCount = 4; // 2 zones × 2 sides
  const targetCount = Math.max(2, Math.round(basePanelCount * ctx.style.panelDensity));
  const zoneCount = Math.ceil(targetCount / 2);
  const plateZones = [];
  const zStart = -0.05 * L, zEnd = 0.18 * L;
  for (let i = 0; i < zoneCount; i++) {
    plateZones.push(zStart + (zEnd - zStart) * i / Math.max(1, zoneCount - 1));
  }

  for (const z of plateZones) {
    const r = ctx.radiusAt(z) * 0.99;
    const localR = ctx.radiusAt(z);
    for (const side of [-1, 1]) {
      const phi = side * 0.62;
      const w = Math.min(0.32 * s, localR * 0.42);
      const h = Math.min(0.22 * s, localR * 0.30);
      const t = 0.042 * s;
      const px = r * Math.sin(phi);
      const py = r * Math.cos(phi);
      const plate = rbox(w, t, h, 0.015 * s, plateMat, [px, py, z]);
      plate.rotation.z = -phi; // 薄面贴合径向法线
      g.add(plate);

      // Phase 4 Commit 3：暴露 Anchor 数据供 HatchGenerator 消费
      g.userData.panelInfos.push({ x: px, y: py, z, w, d: h, phi });
    }
  }

  return g;
}
