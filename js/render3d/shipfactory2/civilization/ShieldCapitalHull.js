// ShieldCapitalHull.js — 护盾旗舰/超旗：在标准船体上叠加悬浮环
//
// 设计：标准 shield lathe hull（战列舰等比例放大）+
//       多层水平环（XY 平面）围绕船体 + 浮游炮（超旗）。
//       不动现有标准管线，只在船体表面追加装饰。
import * as THREE from "three";
import { MaterialFactory } from "../MaterialFactory.js";

function addPart(g, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  g.add(m);
  return m;
}

export function generateShieldCapitalHull(hullGroup, ctx) {
  const { s, L } = ctx;
  const isSuper = (ctx.spec && ctx.spec.hull === "supercapital");
  const midR = ctx.hullProfile.mid * s;

  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const glowMat = MaterialFactory.getGlow("ribbon", ctx, 1.6);
  const hullMat = ctx.hullMat;

  // 环基径：midR*1.55，两端的环保持此尺寸，中间的依次增大
  const ringR = midR * 1.55;

  // ── 循环：水平环（XY 平面，从小到大再回归）──
  // 位置向船体两端偏移，中间环放大 1.5 倍
  const ringData = isSuper
    ? [[-L * 0.26, 1.0], [-L * 0.13, 1.25], [0, 1.5], [L * 0.13, 1.25], [L * 0.26, 1.0]]
    : [[-L * 0.22, 1.0], [0, 1.5], [L * 0.22, 1.0]];

  for (const [rz, scale] of ringData) {
    const r = ringR * scale;
    // 外层钢色环
    addPart(hullGroup, new THREE.TorusGeometry(r, midR * 0.06 * scale, 12, Math.max(24, Math.round(32 * scale))),
      steelMat, [0, 0, rz]);
    // 内层辉光环（略大，重叠产生边缘发光效果）
    addPart(hullGroup, new THREE.TorusGeometry(r * 1.06, midR * 0.03 * scale, 12, Math.max(24, Math.round(32 * scale))),
      glowMat, [0, 0, rz]);
  }

  // ── 超旗专属：每环 8 颗浮游球 ──
  if (isSuper) {
    for (const [rz, scale] of ringData) {
      const r = ringR * scale;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        // 连接线（支柱从船体到浮游球）
        const strut = new THREE.Mesh(
          new THREE.CylinderGeometry(midR * 0.015, midR * 0.015, midR * 0.08, 4),
          steelMat
        );
        strut.position.set(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, rz);
        strut.lookAt(new THREE.Vector3(0, 0, rz));
        strut.rotateX(Math.PI / 2);
        hullGroup.add(strut);

        // 浮游球（发光）
        addPart(hullGroup, new THREE.SphereGeometry(midR * 0.035, 8, 8),
          glowMat, [Math.cos(a) * r * 0.80, Math.sin(a) * r * 0.80, rz]);
      }
    }
  }

  // ── 鼻锥环（旗舰/超旗都有）──
  addPart(hullGroup, new THREE.TorusGeometry(midR * 0.55, midR * 0.04, 8, 24),
    steelMat, [0, 0, -L * 0.24], [Math.PI / 2, 0, 0]);
  addPart(hullGroup, new THREE.TorusGeometry(midR * 0.50, midR * 0.02, 8, 24),
    glowMat, [0, 0, -L * 0.22], [Math.PI / 2, 0, 0]);

  // ── 超旗额外装饰：脊顶小指挥台 ──
  if (isSuper) {
    addPart(hullGroup, new THREE.BoxGeometry(midR * 0.25, midR * 0.18, midR * 0.15),
      hullMat, [0, midR * 1.10, 0]);
    addPart(hullGroup, new THREE.SphereGeometry(midR * 0.05, 8, 8), glowMat,
      [0, midR * 1.22, 0]);
  }

  // 不覆盖引擎，用默认 _engineHeatPoints（profile 已有 engines 定义）
  // 不覆盖面板/舱门

  return hullGroup;
}
