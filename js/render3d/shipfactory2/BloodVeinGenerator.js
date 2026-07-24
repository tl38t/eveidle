// BloodVeinGenerator.js — 战列舰 Blood Raider 专属「血祭纹路」（hero 元素）
// 设计：从腹部外露反应器（血核）向外蔓延的发光品红血管网，贴合鳐鱼曲面不浮空。
// 仅在 classTier>=3（战列舰）且 hullType==='overloaded'（player_blood）时生成。
// 与 RibbonGenerator 同源：用 Ribbon Mesh（禁用 TubeGeometry），贴曲率、宽度随尺寸、可复现。
import * as THREE from "three";
import { MaterialFactory } from "./MaterialFactory.js";

// 单条血管：沿 frames=[{z,angle}] 路径、半角宽 halfW[]（渐细）生成带状三角网格
// 顶点由 ctx.sampleHullSurface 生成在船体表面外一点（off 沿曲面法向），天然贴面不悬空。
function addVein(group, frames, halfW, ctx, intensity) {
  const N = frames.length;
  const R = ctx.hullProfile.mid * ctx.s;
  const off = 0.012 * R;                 // 略高于表面，避免 z-fighting
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
  const mat = MaterialFactory.getGlow("ribbon", ctx, intensity);  // blood → pal.glow 品红
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -3;        // 比发光缝更靠前，压在表面血管上
  mat.polygonOffsetUnits = -3;
  mat.side = THREE.DoubleSide;
  group.add(new THREE.Mesh(geo, mat));
}

// 关键帧线性插值加密
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

// 渐细宽度数组（根部粗、尖端细，像血管分叉）
function taper(n, wRoot, wTip) {
  const a = [];
  for (let k = 0; k < n; k++) a.push(wRoot + (wTip - wRoot) * (k / Math.max(1, n - 1)));
  return a;
}

export function generateBloodVeins(ctx) {
  const g = new THREE.Group();
  g.name = "bloodVeins";
  // 仅战列舰 / 巡洋舰血袭者。其他族 / 低舰级直接返回空组，无副作用。
  if (!ctx.civ || ctx.civ.hullType !== "overloaded" || ctx.classTier < 2) return g;

  const tier = ctx.classTier;                  // 2=巡洋 3=战列
  const zN = ctx._mantaZN, zT = ctx._mantaZT;  // 鳐鱼 z 范围（已由 OverloadedHull 覆写）
  const L = ctx.L;
  const intensity = 2.3;
  const aBelly = Math.PI;          // 腹部（血核所在）
  const aRight = Math.PI / 2;      // 右舷侧面
  const wScale = tier >= 3 ? 1.0 : 0.82;   // 巡洋血管略细，显小

  // 1) 腹部主脉：贯穿头→尾，经血核（所有 tier>=2 都有，视觉主线）
  addVein(g, densify([
    { z: zN * 0.80, angle: aBelly },
    { z: -0.10 * L, angle: aBelly },   // 血核正上方
    { z: zT * 0.92, angle: aBelly },
  ]), taper(28, 0.052 * wScale, 0.022 * wScale), ctx, intensity);

  // 2) 左右翼脉：各 2 条，从腹部中段蔓延到两翼侧面并沿 z 至翼尖（tier>=2 都有）
  const wingPairs = [
    { zRoot: -0.10 * L, zTip: zN * 0.72 },   // 前翼脉
    { zRoot:  0.02 * L, zTip: zN * 0.55 },   // 后翼脉
  ];
  for (const side of [1, -1]) {               // 1=右(经 +π/2)，-1=左(经 -π/2)
    for (const wp of wingPairs) {
      const aMid = side * 2.30;               // 中途绕到侧面
      const aEdge = side * aRight;
      addVein(g, densify([
        { z: wp.zRoot, angle: aBelly },
        { z: (wp.zRoot + wp.zTip) * 0.5, angle: aMid },
        { z: wp.zTip, angle: aEdge },
      ]), taper(26, 0.044 * wScale, 0.012 * wScale), ctx, intensity);
    }
  }

  // 3) 头鳍脉 + 4) 尾刺脉：仅战列舰（更大更复杂）。巡洋只保留主脉+翼脉。
  if (tier >= 3) {
    for (const side of [1, -1]) {
      addVein(g, densify([
        { z: -0.04 * L, angle: aBelly },
        { z: zN * 0.86, angle: aBelly + side * 0.7 },
        { z: zN * 0.96, angle: aBelly + side * 1.2 },
      ]), taper(22, 0.036, 0.010), ctx, intensity);
    }
    for (const side of [1, -1]) {
      addVein(g, densify([
        { z: 0.18 * L, angle: aBelly },
        { z: zT * 0.85, angle: aBelly + side * 0.9 },
        { z: zT * 0.96, angle: aBelly + side * 1.5 },
      ]), taper(22, 0.034, 0.009), ctx, intensity);
    }
  }

  return g;
}
