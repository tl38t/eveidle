// AngelVeinGenerator.js — Angel Cartel 专属「冰蓝脉纹」（hero 元素）
// 设计：沿脊柱(背脊) + 侧鳍蔓延的发光冰蓝血管网，贴合弯曲生物曲面不浮空。
// 仅在 classTier>=2（巡洋/战列）且 hullType==='organic'（Angel）时生成。
// 与 BloodVeinGenerator 同源：Ribbon Mesh（禁用 TubeGeometry），贴曲率、宽度随尺寸、可复现。
// 视觉呼应 Blood（血祭纹路）但冷调冰蓝、更细更优雅 —— 强化两族的"脉络"主题关联。
import * as THREE from "three";
import { MaterialFactory } from "./MaterialFactory.js";

// 单条血管带：沿 frames=[{z,angle}] 路径、半角宽 halfW[]（渐细）生成带状三角网格
function addVein(group, frames, halfW, ctx, intensity) {
  const N = frames.length;
  const R = ctx.hullProfile.mid * ctx.s;
  const off = 0.012 * R;
  const pos = [], idx = [];
  for (let k = 0; k < N; k++) {
    const { z, angle } = frames[k];
    const w = halfW[k];
    const pL = ctx.sampleHullSurface(z, angle - w, off);
    const pR = ctx.sampleHullSurface(z, angle + w, off);
    pos.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
  }
  for (let k = 0; k < N - 1; k++) {
    const a = k * 2, b = k * 2 + 1, c = (k + 1) * 2, d = (k + 1) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = MaterialFactory.getGlow("ribbon", ctx, intensity);  // angel → pal.glow 冰蓝 0x6fd0ff
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -3;
  mat.polygonOffsetUnits = -3;
  mat.side = THREE.DoubleSide;
  group.add(new THREE.Mesh(geo, mat));
}

function densify(pts, seg = 9) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i], B = pts[i + 1];
    for (let s = 0; s < seg; s++) {
      const t = s / seg;
      out.push({ z: A.z + (B.z - A.z) * t, angle: A.angle + (B.angle - A.angle) * t });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function taper(n, wRoot, wTip) {
  const a = [];
  for (let k = 0; k < n; k++) a.push(wRoot + (wTip - wRoot) * (k / Math.max(1, n - 1)));
  return a;
}

export function generateAngelVeins(ctx) {
  const g = new THREE.Group();
  g.name = "angelVeins";
  // 仅巡洋/战列 Angel。其他族 / 低舰级返回空组，无副作用。
  if (!ctx.civ || ctx.civ.hullType !== "organic" || ctx.classTier < 2) return g;
  if (!ctx._angelDims) return g;

  const tier = ctx.classTier;
  const { zN, zT } = ctx._angelDims;
  const L = ctx.L;
  const aTop = 0;                 // 背脊（顶）
  const aRight = Math.PI / 2;     // 右舷
  const aLeft = -Math.PI / 2;     // 左舷
  const intensity = 2.2;
  const wScale = tier >= 3 ? 1.0 : 0.82;   // 巡洋略细

  // 1) 背脊主脉：贯穿头→尾，沿脊柱（所有 tier>=2 都有，视觉主线）
  addVein(g, densify([
    { z: zN * 0.70, angle: aTop },
    { z: -0.05 * L, angle: aTop },
    { z: zT * 0.85, angle: aTop },
  ]), taper(30, 0.050 * wScale, 0.020 * wScale), ctx, intensity);

  // 2) 背脊副脉（平行，略偏，形成脊线厚度）：仅战列（更大更复杂）
  if (tier >= 3) {
    for (const dA of [0.16, -0.16]) {
      addVein(g, densify([
        { z: zN * 0.66, angle: aTop + dA },
        { z: zT * 0.82, angle: aTop + dA },
      ]), taper(26, 0.030 * wScale, 0.014 * wScale), ctx, intensity);
    }
  }

  // 3) 左右侧脉：各 2 条，从背脊蔓延到两舷鳍根（tier>=2 都有）
  const sidePairs = [
    { zTop: -0.04 * L, zEdge: zT * 0.50 },   // 前侧脉
    { zTop: 0.06 * L, zEdge: zT * 0.40 },    // 后侧脉
  ];
  for (const side of [1, -1]) {
    const aEdge = side * aRight;
    for (const sp of sidePairs) {
      const aMid = side * 0.95;
      addVein(g, densify([
        { z: sp.zTop, angle: aTop },
        { z: (sp.zTop + sp.zEdge) * 0.5, angle: aMid },
        { z: sp.zEdge, angle: aEdge },
      ]), taper(24, 0.040 * wScale, 0.012 * wScale), ctx, intensity);
    }
  }

  // 4) 尾部收束脉：仅战列，向尾汇聚
  if (tier >= 3) {
    for (const side of [1, -1]) {
      addVein(g, densify([
        { z: 0.12 * L, angle: aTop },
        { z: zT * 0.80, angle: side * 0.9 },
        { z: zT * 0.94, angle: side * 1.4 },
      ]), taper(20, 0.032, 0.009), ctx, intensity);
    }
  }

  return g;
}
