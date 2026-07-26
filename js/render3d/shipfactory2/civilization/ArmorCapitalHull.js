// ArmorCapitalHull.js — 装甲旗舰/超旗：在 FortressHull 城堡箱体上叠加专属装甲结构
//
// 设计：标准 fortress 城堡箱体 + 顶部斜板装甲、导弹管、指挥穹顶 + 超旗专属浮动装甲 + VLS。
//       位置全部基于 ctx._fortressDims（FortressHull 暴露的 Anchor Bus），确保不浮空 / 不穿模。
//       与 ShieldCapitalHull 平级：不动现有 FortressHull / surface details，只在船体上追加装饰。
import * as THREE from "three";
import { MaterialFactory } from "../MaterialFactory.js";
import { stdMaterial } from "../Materials.js";

function addPart(g, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  g.add(m);
  return m;
}

export function generateArmorCapitalHull(hullGroup, ctx) {
  const dims = ctx._fortressDims;
  if (!dims) return hullGroup;
  const { hullW, hullH, hullLen, midR } = dims;
  const isSuper = (ctx.spec && (ctx.spec.hull === "supercapital" || String(ctx.spec.hull).endsWith("_supercapital")));

  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const hullMat = ctx.hullMat;
  const steelDarkMat = MaterialFactory.get("groove", ctx);
  const glowAmber = MaterialFactory.getGlow("ribbon", ctx, 1.8);

  // 顶部基准 Y、侧面基准 X（基于 fortress 实际尺寸，单位已乘 s）
  const topY = hullH * 0.50 + midR * 0.04;             // 顶面之上一点
  const sideX = hullW * 0.50 + midR * 0.04;             // 侧面之外一点

  // ── 斜板装甲（船顶 6 块，2 列 × 3 行）──
  const azList = [-hullLen * 0.30, 0, hullLen * 0.30];
  const pwBase = hullW * 0.30, ph = hullH * 0.06, pz = hullW * 0.15;
  for (const side of [-1, 1]) for (const az of azList) {
    addPart(hullGroup, new THREE.BoxGeometry(pwBase, ph, pz), steelDarkMat,
      [side * (hullW * 0.16), topY, az], [0, 0, side * 0.18]);
  }

  // ── 导弹管（顶部中央，数量 = 高槽数 mounts）──
  // mounts 来自 ShipProfile（Spear capital=6, supercapital=7），与 ships.js 高槽一致。
  const mounts = (ctx.profile && ctx.profile.hull && ctx.profile.hull.mounts) || (isSuper ? 7 : 6);
  const n = mounts;
  const mLen = hullLen * 0.16;
  for (let i = 0; i < n; i++) {
    const zPos = -hullLen * 0.20 + (i / (n - 1)) * hullLen * 0.40;
    addPart(hullGroup, new THREE.CylinderGeometry(midR * 0.04, midR * 0.06, mLen, 8), steelMat,
      [0, topY + midR * 0.04, zPos], [Math.PI / 2, 0, Math.PI / 2 + 0.02 * i]);
    // 头部辉光
    addPart(hullGroup, new THREE.SphereGeometry(midR * 0.025, 8, 8), glowAmber,
      [mLen * 0.45, topY + midR * 0.04, zPos]);
  }

  // ── 指挥穹顶（船顶中央）──
  addPart(hullGroup, new THREE.CylinderGeometry(midR * 0.18, midR * 0.26, midR * 0.12, 8), steelDarkMat,
    [0, topY + midR * 0.06, 0]);
  addPart(hullGroup, new THREE.SphereGeometry(midR * 0.08, 8, 8),
    stdMaterial({ color: 0xffcc88, emissive: 0xffaa44, emissiveIntensity: 1.8 }),
    [0, topY + midR * 0.16, 0]);

  // ── 鼻锥楔形加强环（船头 XY 平面）──
  const noseR = midR * 0.85;
  addPart(hullGroup, new THREE.TorusGeometry(noseR, midR * 0.04, 8, 28), steelDarkMat,
    [0, 0, -hullLen * 0.42], [Math.PI / 2, 0, 0]);
  addPart(hullGroup, new THREE.TorusGeometry(noseR * 1.05, midR * 0.02, 8, 28),
    glowAmber, [0, 0, -hullLen * 0.41], [Math.PI / 2, 0, 0]);

  // ── 超旗专属：两侧"飞翼"浮动装甲 + 红色发光头（位于船顶上方，绝对可见） ──
  if (isSuper) {
    const flyY = hullH * 0.55 + midR * 0.30;          // 船顶之上 ~0.7 单位
    const flyX = hullW * 0.5 + hullW * 0.30;          // 船缘之外 ~2.14 单位
    for (const side of [-1, 1]) {
      const fl = hullW * 0.60;                         // 6 块装甲板宽 ~4.28
      const fThick = hullH * 0.20;                     // 厚 ~1.22
      // 浮动装甲（飞翼形态，贴在船肩上方外伸）
      addPart(hullGroup, new THREE.BoxGeometry(fl, fThick, hullW * 0.55), steelMat,
        [side * (flyX + fl * 0.5), flyY, 0], [0, 0, side * 0.15]);
      // 翼尖红色发光头（2 颗，朝船头/船尾方向，半径 0.7 绝对显眼）
      const glowR = midR * 0.22;
      addPart(hullGroup, new THREE.SphereGeometry(glowR, 16, 16),
        stdMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 3.0 }),
        [side * (flyX + fl + glowR), flyY, -hullLen * 0.10]);
      addPart(hullGroup, new THREE.SphereGeometry(glowR, 16, 16),
        stdMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 3.0 }),
        [side * (flyX + fl + glowR), flyY, hullLen * 0.10]);
      // 翼根与船顶之间的支撑柱
      addPart(hullGroup, new THREE.CylinderGeometry(midR * 0.06, midR * 0.06, hullH * 0.20, 8), steelDarkMat,
        [side * (hullW * 0.5 + midR * 0.05), hullH * 0.55, 0]);
    }

    // ── 超旗 VLS ×3（船顶后段）──
    for (let i = 0; i < 3; i++) {
      addPart(hullGroup, new THREE.CylinderGeometry(midR * 0.07, midR * 0.09, midR * 0.16, 6), steelDarkMat,
        [0, topY + midR * 0.10, -hullLen * 0.05 + i * hullLen * 0.10]);
    }
  }

  return hullGroup;
}
