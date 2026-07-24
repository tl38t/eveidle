// DroneBayGenerator.js — Phase 5 大型组件：无人机机库
//
// 职责：在船体下部 / 后部布置机库门 + 停靠无人机（巡洋以上 2 架，成对镜像），
//       返回 Group "droneBay"。所有元素成对镜像，满足 Validator 对称性检查。
//
// 通用（Anchor Bus）：非 sansha 用 hull 表面采样；sansha 贴在笼面（底部）。
import * as THREE from "three";
import { rbox } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

const UP = new THREE.Vector3(0, 1, 0);

function mountPoint(ctx, z, angle, offset) {
  const isMod = ctx.civ && ctx.civ.hullType === "modular";
  if (isMod) {
    const R = ctx._sanshaDims.cageR * 0.94;
    const pos = new THREE.Vector3(R * Math.sin(angle), R * Math.cos(angle), z);
    return { pos, normal: pos.clone().normalize() };
  }
  const pos = ctx.sampleHullSurface(z, angle, offset);
  return { pos, normal: ctx.normalAt(z, angle) };
}

function addDrone(group, pos, size, ctx) {
  const m = MaterialFactory.get("droneBody", ctx);
  const d = new THREE.Group();
  d.position.copy(pos);
  d.add(rbox(size, size * 0.4, size * 1.4, size * 0.1, m, [0, 0, 0]));        // 机体
  d.add(rbox(size * 2.0, size * 0.12, size * 0.5, size * 0.05, m, [0, 0, 0])); // 机翼
  group.add(d);
}

export function generateDroneBay(ctx) {
  const { s, L } = ctx;
  const tier = ctx.classTier;
  const g = new THREE.Group();
  g.name = "droneBay";

  const doorMat = MaterialFactory.get("droneBay", ctx);
  const drones = tier >= 2 ? 2 : 1;                       // 巡洋以上 2 架机库
  const size = 0.14 * s;
  const bayZ = (-0.30 - 0.05 * tier) * L;

  // 机库门角度：单门在底部(angle=PI)；双门在底部两侧镜像(PI±0.5)
  const angles = drones === 2 ? [Math.PI - 0.5, Math.PI + 0.5] : [Math.PI];
  for (const a of angles) {
    const { pos, normal } = mountPoint(ctx, bayZ, a, 0.02 * s);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, normal);
    const door = new THREE.Group();
    door.position.copy(pos);
    door.quaternion.copy(q);
    door.add(rbox(size * 1.6, size * 0.25, size * 2.2, size * 0.05, doorMat, [0, 0, 0]));
    g.add(door);

    // 停靠无人机（贴门外侧）
    const dp = pos.clone().add(normal.clone().multiplyScalar(size * 1.5));
    addDrone(g, dp, size * 0.8, ctx);
  }
  return g;
}
