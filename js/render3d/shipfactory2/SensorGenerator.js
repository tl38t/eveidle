// SensorGenerator.js — Phase 5 大型组件：传感器阵列
//
// 职责：在船体上方 / 前部对称挂载传感器碟形天线，返回 Group "sensors"。
// 通用（Anchor Bus）：
//   - 非 sansha：用 hull 表面采样（ctx.sampleHullSurface / normalAt）贴附。
//   - sansha（modular）：贴在笼面（半径 cageR 的球壳），避免浮在笼内空腔。
//
// 设计原则：
//   - 单一职责，返回 Group，无全局状态（AI Rules §5）
//   - 材质走 MaterialFactory（§6），不 import 配置（§19）
//   - 严格 X 轴镜像对称（偶数成对外扩 + 奇数中心件），满足 Validator 对称性检查
import * as THREE from "three";
import { MaterialFactory } from "./MaterialFactory.js";

const UP = new THREE.Vector3(0, 1, 0);

// 给定 (z, angle) 槽位 → 世界坐标 pos + 外法向 normal
function mountPoint(ctx, z, angle, offset) {
  const isMod = ctx.civ && ctx.civ.hullType === "modular";
  if (isMod) {
    const R = ctx._sanshaDims.cageR * 0.95;
    const pos = new THREE.Vector3(R * Math.sin(angle), R * Math.cos(angle), z);
    return { pos, normal: pos.clone().normalize() };
  }
  const pos = ctx.sampleHullSurface(z, angle, offset);
  return { pos, normal: ctx.normalAt(z, angle) };
}

// 单个传感器荚：桅杆 + 碟形天线（半球） + 中心发光透镜
function addSensorPod(group, pos, normal, size, ctx) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, normal);
  const pod = new THREE.Group();
  pod.position.copy(pos);
  pod.quaternion.copy(q);

  const mastMat = MaterialFactory.get("sensorMast", ctx);
  const dishMat = MaterialFactory.get("sensorDish", ctx);
  const lensMat = MaterialFactory.getGlow("nav", ctx, 2.2);
  lensMat.side = THREE.DoubleSide;

  const mastH = size * 0.9;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.12, size * 0.16, mastH, 8), mastMat);
  mast.position.y = mastH * 0.5;
  pod.add(mast);

  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(size, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), dishMat);
  dish.position.y = mastH;
  pod.add(dish);

  const lens = new THREE.Mesh(new THREE.SphereGeometry(size * 0.18, 10, 8), lensMat);
  lens.position.y = mastH;
  pod.add(lens);

  group.add(pod);
}

export function generateSensors(ctx) {
  const { s, L } = ctx;
  const tier = ctx.classTier;
  const g = new THREE.Group();
  g.name = "sensors";

  const isMod = ctx.civ && ctx.civ.hullType === "modular";
  const count = 2 + tier;                                  // 2 / 3 / 4 / 5
  const size = 0.10 * s * (0.8 + 0.18 * tier);
  const offset = isMod ? 0 : 0.06 * s;

  // 对称槽位：顶部(angle≈0)为中心，向两侧(angle=±da)镜像展开；z 由前向后
  const slots = [];
  const pairs = Math.floor(count / 2);
  for (let k = 0; k < pairs; k++) {
    const da = 0.30 + 0.22 * k;
    const z = (0.34 - 0.16 * k) * L;
    slots.push({ z, angle: da }, { z, angle: -da });
  }
  if (count % 2 === 1) slots.push({ z: 0.46 * L, angle: 0 });

  for (const sl of slots) {
    const { pos, normal } = mountPoint(ctx, sl.z, sl.angle, offset);
    addSensorPod(g, pos, normal, size, ctx);
  }
  return g;
}
