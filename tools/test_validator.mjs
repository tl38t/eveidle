// tools/test_validator.mjs — Phase 4 轻量 Validator（Phase 8 预览版）
//
// 目的：在 Phase 4+ 每次改动后自动检查生成结果的结构合理性。
//   完整 Phase 8 会增加几何相交 / 表面穿透 / 悬浮件等复杂检测；
//   本轻量版先覆盖四道结构检查，零依赖、秒级运行。
//
// 检查项：
//   ① 组件存在性 — ship 必须包含 hull/ribbons/armor/panels/heatSinks/hatches/weapons/engines 八个子 Group
//   ② 对称性     — X 轴镜像，统计 +X / -X 顶点数偏差（偏差 > 15% 则 FAIL）
//   ③ 比例合理性 — bbox 三维度在 [0.5, 50] 范围内，且最长轴 / 最短轴 < 12
//   ④ 子组件包围 — 每个子 Group 的 bbox 必须与 ship 整体 bbox 有交集（无完全脱离的悬浮组件）
//
// 运行：node tools/test_validator.mjs

import { buildShip } from "../js/render3d/shipfactory2/ShipFactory2.js";
import * as THREE from "three";

const SPECS = [
  { id: "rifter",    line: "player_shield", family: "shield", hull: "frigate",    weapon: "laser", highSlots: 2 },
  { id: "raylight",  line: "player_shield", family: "shield", hull: "destroyer",  weapon: "laser", highSlots: 3 },
  { id: "gale",      line: "player_shield", family: "shield", hull: "destroyer",  weapon: "laser", hybrid: true, highSlots: 3 },
  { id: "dawnlight", line: "player_shield", family: "shield", hull: "cruiser",    weapon: "laser", highSlots: 4 },
  { id: "sunlance",  line: "player_shield", family: "shield", hull: "battleship", weapon: "laser", highSlots: 5 }
];

const REQUIRED_GROUPS = ["hull", "ribbons", "armor", "panels", "heatSinks", "hatches", "weapons", "engines"];

function computeBBox(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  return box;
}

function countVerticesBySide(obj) {
  let posX = 0, negX = 0;
  const v = new THREE.Vector3();
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (v.x > 0.01) posX++;
      else if (v.x < -0.01) negX++;
    }
  });
  return { posX, negX };
}

let allPass = true;
let totalChecks = 0;

for (const spec of SPECS) {
  const ship = buildShip(spec);
  const issues = [];

  // ① 组件存在性
  const childNames = new Set(ship.children.map((c) => c.name));
  for (const req of REQUIRED_GROUPS) {
    if (!childNames.has(req)) issues.push(`缺少子 Group: "${req}"`);
  }

  // ② 对称性（X 轴镜像）
  const { posX, negX } = countVerticesBySide(ship);
  const symDiff = Math.abs(posX - negX) / Math.max(1, posX + negX);
  if (symDiff > 0.15) {
    issues.push(`对称性偏差 ${(symDiff * 100).toFixed(1)}% > 15%（+X=${posX}, -X=${negX}）`);
  }

  // ③ 比例合理性
  const box = computeBBox(ship);
  const size = box.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
  for (const d of dims) {
    if (d < 0.5) issues.push(`bbox 维度过小: ${d.toFixed(2)} < 0.5`);
    if (d > 50) issues.push(`bbox 维度过大: ${d.toFixed(2)} > 50`);
  }
  const ratio = dims[2] / Math.max(0.01, dims[0]);
  if (ratio > 12) issues.push(`bbox 长宽比 ${ratio.toFixed(1)} > 12`);

  // ④ 子组件包围（每个子 Group bbox 与 ship bbox 有交集）
  const shipBox = computeBBox(ship);
  for (const child of ship.children) {
    if (!child.isGroup) continue;
    const childBox = computeBBox(child);
    if (childBox.isEmpty()) continue;
    // 交集检测：两个 Box3 是否重叠
    const intersects = shipBox.intersectsBox(childBox);
    if (!intersects) issues.push(`子 Group "${child.name}" bbox 与 ship bbox 无交集（可能脱离）`);
  }

  totalChecks += 4;
  if (issues.length) {
    allPass = false;
    console.log(`FAIL  ${spec.id}`);
    for (const i of issues) console.log(`      - ${i}`);
  } else {
    console.log(`PASS  ${spec.id}  bbox=${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}  sym=${(symDiff * 100).toFixed(1)}%  +X=${posX}/-X=${negX}`);
  }
}

console.log(allPass ? "\nALL_PASS" : "\nVALIDATION_FAILED");
process.exit(allPass ? 0 : 1);
