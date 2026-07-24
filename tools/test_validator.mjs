// tools/test_validator.mjs — Phase 8 完整 Validator（2026-07-23 扩展版）
//
// 覆盖：6 种族 × 4 舰级 = 24 组合（矩阵同 shipfactory2-smoke.mjs，零依赖、秒级运行）。
//
// 检查项：
//   ① 组件存在性（按族定制 REQUIRED_GROUPS）
//   ② 对称性（X 轴镜像，整体顶点偏差 > 15% → FAIL）
//   ③ 比例合理性（bbox 三维度 ∈ [0.5, 50]；capital 档放宽至 70；最长轴 / 最短轴 < 12）
//   ④ 子组件包围 + 严重脱离（子 Group bbox 须与 ship bbox 有交集；中心不超出 ship 范围 1.5×）
//   ⑤ 功能附着（heatSinks/vents/hatches 的 Z 区域约束；sansha 路线豁免）
//   ⑥ NaN / 有限数守卫（所有 transform 与包围盒必须有限，防黑屏类回归）
//   ⑦ 断裂对称（weapons 组炮塔 x 镜像）— 软检查 WARN（不阻断，见下方说明）
//
// 注：几何相交 / 表面穿透的「精确三角级」检测需要 BVH（如 three-mesh-bvh），
//   本次先以 ④⑥⑦ 覆盖主要回归风险，精确相交检测列为 P8 后续项。
//
// 运行：
//   node tools/test_validator.mjs
// 退出码：全部通过 0；任一失败 1。

import { buildShip } from "../js/render3d/shipfactory2/ShipFactory2.js";
import * as THREE from "three";

const FACTIONS = [
  "player_shield", "player_armor", "player_structure",
  "angel", "blood", "sansha",
];
const CLASSES = ["frigate", "destroyer", "cruiser", "battleship"];

// 各族必需子 Group（sansha 路线禁用 armor/groove/heatSink/hatch/vent/engine/hero；
//   P5 大型组件 sensors/droneBay 六族通用，均启用；radar/commArray 已移除）
const REQUIRED = {
  sansha:  ["hull", "panels", "ribbons", "weapons", "sensors", "droneBay"],
  industrial:    ["hull", "weapons", "engines", "functionalMounts"],
  archaeology:   ["hull", "weapons", "engines", "functionalMounts"],
  default: ["hull", "armor", "panels", "grooves", "heatSinks", "hatches", "vents", "ribbons", "weapons", "engines", "sensors", "droneBay"],
};
const requiredFor = (f) => REQUIRED[f] || REQUIRED.default;

// 功能附着 Z 区域（归一化：0=船尾, 1=船首）。sansha 无这些 Group，自动豁免。
const FUNCTIONAL_ZONES = {
  heatSinks: { label: "HeatSink", minRatio: 0.15, maxRatio: 0.95 },
  vents:     { label: "Vent",     minRatio: 0.05, maxRatio: 0.95 },
  hatches:   { label: "Hatch",    minRatio: 0.10, maxRatio: 0.75 },
};

function computeBBox(obj) {
  return new THREE.Box3().setFromObject(obj);
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
const perFaction = {};

function checkShip(f, spec) {
  const c = spec.hull;
  const ship = buildShip(spec);
  const issues = [];

  // ① 组件存在性
  const childNames = new Set(ship.children.map((ch) => ch.name));
  for (const req of requiredFor(f)) {
    if (!childNames.has(req)) issues.push(`缺少子 Group: "${req}"`);
  }

  // ② 对称性（X 轴镜像）
  const { posX, negX } = countVerticesBySide(ship);
  const symDiff = Math.abs(posX - negX) / Math.max(1, posX + negX);
  if (symDiff > 0.15) {
    issues.push(`对称性偏差 ${(symDiff * 100).toFixed(1)}% > 15%（+X=${posX}, -X=${negX}）`);
  }

  // ③ 比例合理性
  const shipBox = computeBBox(ship);
  const size = shipBox.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
  // capital 档（orca/illuminator 旗舰）船体 + 护盾泡本就更大，放宽上限至 70；
  // 其余 4 档维持 50，仍能有效拦截失控几何。
  const maxDim = (spec.hull === "capital") ? 70 : 50;
  for (const d of dims) {
    if (d < 0.5) issues.push(`bbox 维度过小: ${d.toFixed(2)} < 0.5`);
    if (d > maxDim) issues.push(`bbox 维度过大: ${d.toFixed(2)} > ${maxDim}`);
  }
  const ratio = dims[2] / Math.max(0.01, dims[0]);
  if (ratio > 12) issues.push(`bbox 长宽比 ${ratio.toFixed(1)} > 12`);

  // ④ 子组件包围 + 严重脱离
  const shipCenter = shipBox.getCenter(new THREE.Vector3());
  const shipHalf = size.clone().multiplyScalar(0.5);
  for (const child of ship.children) {
    if (!child.isGroup) continue;
    const childBox = computeBBox(child);
    if (childBox.isEmpty()) continue;
    if (!shipBox.intersectsBox(childBox)) {
      issues.push(`子 Group "${child.name}" bbox 与 ship bbox 无交集（完全脱离）`);
      continue;
    }
    const cCenter = childBox.getCenter(new THREE.Vector3());
    const over = new THREE.Vector3(
      Math.abs(cCenter.x - shipCenter.x) - shipHalf.x * 1.5,
      Math.abs(cCenter.y - shipCenter.y) - shipHalf.y * 1.5,
      Math.abs(cCenter.z - shipCenter.z) - shipHalf.z * 1.5,
    );
    if (over.x > 0 || over.y > 0 || over.z > 0) {
      issues.push(`子 Group "${child.name}" 中心严重脱离 ship（超出 1.5× 范围）`);
    }
  }

  // ⑤ 功能附着（非 sansha）
  if (f !== "sansha") {
    const shipZMin = shipCenter.z - shipHalf.z;
    const shipZRange = size.z || 1;
    for (const child of ship.children) {
      const zone = FUNCTIONAL_ZONES[child.name];
      if (!zone) continue;
      const childBox = computeBBox(child);
      if (childBox.isEmpty()) continue;
      const childZ = childBox.getCenter(new THREE.Vector3()).z;
      const zNorm = (childZ - shipZMin) / shipZRange;
      if (zNorm < zone.minRatio || zNorm > zone.maxRatio) {
        issues.push(
          `${zone.label} "${child.name}" Z 位置异常 ` +
          `（归一化 Z=${zNorm.toFixed(2)}，预期 [${zone.minRatio}, ${zone.maxRatio}]）`
        );
      }
    }
  }

  // ⑥ NaN / 有限数守卫
  ship.updateMatrixWorld(true);
  let nanObjs = 0;
  ship.traverse((o) => {
    for (const v of [o.position.x, o.position.y, o.position.z,
                     o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]) {
      if (!Number.isFinite(v)) { nanObjs++; break; }
    }
  });
  if (nanObjs > 0) issues.push(`Transform 含 NaN/Infinity（${nanObjs} 个对象）— 浏览器会整船空白`);
  if (![shipBox.min.x, shipBox.min.y, shipBox.min.z, shipBox.max.x, shipBox.max.y, shipBox.max.z]
        .every(Number.isFinite)) {
    issues.push("包围盒含 NaN（fitCamera 看不到船）");
  }

  totalChecks += 6;
  perFaction[f] = (perFaction[f] || 0) + (issues.length ? 0 : 1);

  // ⑦ 断裂对称（weapons 组炮塔 x 镜像）— 软检查 WARN（不阻断）
  const w = ship.children.find((ch) => ch.name === "weapons");
  if (w) {
    let wp = 0, wn = 0, wz = 0;
    for (const t of w.children) {
      if (!t.isGroup && !t.isMesh) continue;
      const x = t.position.x;
      if (x > 0.02) wp++;
      else if (x < -0.02) wn++;
      else wz++;
    }
    const wt = wp + wn + wz;
    if (wt >= 2) {
      const wDiff = Math.abs(wp - wn) / wt;
      if (wDiff > 0.10) {
        console.log(`WARN  ${f.padEnd(15)} / ${c.padEnd(11)} 武器 x 投影不对称 +X=${wp}/-X=${wn}/x0=${wz}（偏差 ${(wDiff * 100).toFixed(1)}%）`);
      }
    }
  }

  if (issues.length) {
    allPass = false;
    console.log(`FAIL  ${f.padEnd(15)} / ${c.padEnd(11)}`);
    for (const i of issues) console.log(`      - ${i}`);
  } else {
    console.log(`PASS  ${f.padEnd(15)} / ${c.padEnd(11)}  bbox=${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}  sym=${(symDiff*100).toFixed(1)}%`);
  }
}

for (const f of FACTIONS) {
  for (const c of CLASSES) {
    checkShip(f, {
      id: `val-${f}-${c}`, anchor: "Spear", race: f, line: f, hull: c,
      seed: 20260719, faction: f, family: f.replace("player_", ""), weapon: "laser",
    });
  }
}

// ── 功能舰（工业 / 考古）设计语言校验 ──
// 不传 anchor（ShipContext 按 faction 选 Industrial / Archaeology 锚点）；function 区分采矿/采气/支援。
const UTILITY = [
  { faction: "industrial", fn: "mining",   hull: "frigate" },
  { faction: "industrial", fn: "mining",   hull: "destroyer" },
  { faction: "industrial", fn: "mining",   hull: "cruiser" },
  { faction: "industrial", fn: "mining",   hull: "battleship" },
  { faction: "industrial", fn: "gas",      hull: "frigate" },
  { faction: "industrial", fn: "gas",      hull: "cruiser" },
  { faction: "industrial", fn: "support",  hull: "cruiser" },
  { faction: "industrial", fn: "mining",   hull: "capital" },
  { faction: "archaeology", hull: "frigate" },
  { faction: "archaeology", hull: "destroyer" },
  { faction: "archaeology", hull: "cruiser" },
  { faction: "archaeology", hull: "battleship" },
  { faction: "archaeology", hull: "capital" },
];
for (const u of UTILITY) {
  checkShip(u.faction, {
    id: `val-${u.faction}-${u.fn || "scan"}-${u.hull}`,
    hull: u.hull, faction: u.faction, function: u.fn, seed: 20260719,
  });
}

console.log(`\n=== 各族通过: ${Object.entries(perFaction).map(([k,v])=>`${k}=${v}/4`).join("  ")} ===`);
console.log(`硬检查项总数=${totalChecks}（另含 ⑦ 软对称检查，仅 WARN）`);
console.log(allPass ? "\nALL_PASS" : "\nVALIDATION_FAILED");
process.exit(allPass ? 0 : 1);
