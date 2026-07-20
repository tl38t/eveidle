// EngineGenerator.js — 引擎舱与尾焰
// 职责：返回包含「引擎舱（按舰级布局）+ 尾焰辉光」的 THREE.Group。
//
// Phase 4 Commit 3：引擎位置由 ShipFactory2（Anchor Bus）从 profile 预计算，
//   通过 ctx._engineHeatPoints 统一注入，EngineGenerator 不再内部推导。
//   同时将 heatPoints 写入 group.userData.heatPoints 作为声明。
import * as THREE from "three";
import { addPart } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

function addEngine(group, x, y, z, radius, ctx, length = 1.6) {
  const casing = MaterialFactory.get("engineCasing", ctx);
  const steel = MaterialFactory.get("engineRing", ctx);
  const glow = MaterialFactory.getGlow("engine", ctx, 1.6);
  addPart(group, new THREE.CylinderGeometry(radius * 0.8, radius, length, 18), casing, [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, 0.16, 18), steel, [x, y, z + length * 0.5], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.05, 18), glow, [x, y, z + length * 0.5 + 0.1], [Math.PI / 2, 0, 0]);
  const exMat = MaterialFactory.getAdditive("exhaust", ctx, 0.2, THREE.FrontSide);
  const exhaust = addPart(group, new THREE.ConeGeometry(radius * 0.55, 1.6, 16, 1, true), exMat,
    [x, y, z + length * 0.5 + 0.85], [Math.PI / 2, 0, 0]);
  exhaust.name = "exhaust";
}

export function generateEngines(ctx) {
  const { _engineHeatPoints } = ctx;

  const g = new THREE.Group();
  g.name = "engines";

  // Phase 4 Commit 3：引擎位置来自 ShipFactory2 Anchor Bus，不再内部推导。
  const heatPoints = _engineHeatPoints || [];
  g.userData.heatPoints = heatPoints;

  for (const hp of heatPoints)
    addEngine(g, hp.x, hp.y, hp.z, hp.radius, ctx);

  return g;
}
