// ArchaeologyHull.js — Archaeology / Explorer 探索扫描舰
//
// EVE 参考（Heron / Anathema / Helios / Buzzard / Astero / Stratios / Pilgrim）：
//   - 流线低矮的飞镖体，曲面平滑，极少棱角。
//   - 脊背传感器桅 + 顶部扫描碟（扫描遗迹信号）。
//   - 侧向扫描翼（向后掠，发光扫描条）——签名识别度。
//   - 隐蔽优先：装甲薄、暴露机械少，靠"看得见"而非"扛得住"。
//
// 设计契约（同 IndustrialHull）：比 lathe 包络更大/更扁 → 通用 surface generator 浮空几何被吸收，
//   可见细节（扫描翼 / 传感器桅 / 扫描辉光条）由本生成器自绘。
// Anchor Bus：暴露 ctx._archaeologyDims 供 FunctionalMountGenerator（扫描阵列 / 探针发射舱）。
import * as THREE from "three";
import { rbox, addPart } from "../Materials.js";
import { MaterialFactory } from "../MaterialFactory.js";

export function generateArchaeologyHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const midR = ctx.hullProfile.mid * s;
  const wMul = p.widthMul || 0.95;
  const body = ctx.profile.hull.body;
  const widthRatio = (ctx.profile.hull.widthRatio || 0.85);

  // ▸ 流线飞镖主舱（胶囊拉伸 + 垂直压扁，低矮轮廓）
  const fusR = midR * 0.95 * wMul;
  const fusLen = L * 0.86;

  const g = new THREE.Group();
  g.name = "hull";

  const hullMat = ctx.hullMat;
  const glow = MaterialFactory.getGlow("ribbon", ctx, 1.6);

  // ══ 主舱：胶囊（沿 Z）拉伸 + 压扁 ══
  const cap = new THREE.CapsuleGeometry(fusR, fusLen * 0.7, 8, 20);
  const fus = new THREE.Mesh(cap, hullMat);
  fus.rotation.x = Math.PI / 2;             // 轴转至 Z
  fus.scale.set(1.0, widthRatio, 1.0);      // 垂直压扁 → 低矮飞镖
  g.add(fus);

  // ══ 尖锐鼻探针 ══
  const nose = addPart(g, new THREE.ConeGeometry(fusR * 0.55, fusLen * 0.22, 18), hullMat,
    [0, 0, -fusLen * 0.5 - fusLen * 0.1], [Math.PI / 2, 0, 0]);
  nose.scale.set(1.0, widthRatio, 1.0);

  // ══ 脊背传感器桅 + 顶部扫描碟 ══
  const mastH = fusR * (body === "dagger" ? 1.1 : 1.5);
  const mast = addPart(g, new THREE.CylinderGeometry(fusR * 0.08, fusR * 0.12, mastH, 8),
    MaterialFactory.get("sensorMast", ctx), [0, fusR * widthRatio + mastH * 0.5, fusLen * 0.12]);
  const dish = addPart(g, new THREE.CylinderGeometry(fusR * 0.05, fusR * 0.42, fusR * 0.12, 16),
    MaterialFactory.get("sensorDish", ctx), [0, fusR * widthRatio + mastH, fusLen * 0.12], [Math.PI, 0, 0]);
  // 碟缘辉光
  const dishRing = addPart(g, new THREE.TorusGeometry(fusR * 0.42, fusR * 0.04, 6, 18),
    glow, [0, fusR * widthRatio + mastH, fusLen * 0.12], [Math.PI / 2, 0, 0]);

  // ══ 侧向扫描翼（X 镜像，向后掠 + 发光扫描条）══
  const wingLen = fusLen * (body === "dagger" ? 0.34 : body === "gunboat" ? 0.42 : 0.5);
  const wingW = fusR * (body === "dagger" ? 0.5 : 0.7);
  const wingY = fusR * widthRatio * 0.2;
  for (const side of [-1, 1]) {
    const wing = rbox(wingW, fusR * 0.12, wingLen, fusR * 0.04, hullMat,
      [side * (fusR * 0.9), wingY, fusLen * 0.05]);
    wing.rotation.z = side * 0.5;          // 向后掠
    wing.scale.set(1.0, 1.0, 1.0);
    g.add(wing);
    // 翼缘扫描辉光条
    const strip = addPart(g, new THREE.BoxGeometry(wingW * 0.96, fusR * 0.05, wingLen * 0.9),
      glow, [side * (fusR * 0.9), wingY + fusR * 0.07, fusLen * 0.05], [0, 0, side * 0.5]);
  }

  // ══ 机身扫描辉光条（沿脊背两道，弱扫描线）══
  for (const off of [-fusR * 0.3, fusR * 0.3]) {
    const seam = addPart(g, new THREE.BoxGeometry(fusR * 0.04, fusR * 0.04, fusLen * 0.8),
      glow, [off, fusR * widthRatio * 0.9, 0]);
  }

  // ══ 尾部引擎罩 ══
  const tail = rbox(fusR * 1.1, fusR * widthRatio * 1.1, fusLen * 0.08, fusR * 0.03,
    MaterialFactory.get("armorDeck", ctx), [0, 0, fusLen * 0.5 + fusLen * 0.04]);
  g.add(tail);

  // ══ Anchor Bus ══
  ctx._archaeologyDims = { fusR, fusLen, midR, widthRatio, noseZ: -fusLen * 0.6 };

  return g;
}
