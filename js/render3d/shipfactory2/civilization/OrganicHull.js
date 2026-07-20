// OrganicHull.js — Angel Cartel：生物机械文明
// 有机流线 + 单侧肿胀 + 非完全对称。视觉语言：像生长出来，不像制造出来。
import * as THREE from "three";
import { buildSpine, buildBridge } from "./CivHelpers.js";

export function generateOrganicHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const fatR = ctx.hullProfile.noseFat;
  const midR = ctx.hullProfile.mid;
  const tailR = ctx.hullProfile.tail;
  const wMul = p.widthMul || 1.15;
  const asymmetry = p.asymmetry || 0.7;
  const bulge = p.organicBulge || 0.8;
  const hullMat = ctx.hullMat;

  const g = new THREE.Group();
  g.name = "hull";

  // ▸ 有机曲线 profile：多采样点 + 子弹头鼻 + 连续中段
  const noseLen = 0.24 * L;
  const tailLen = 0.26 * L;
  const noseEnd = -L / 2 + noseLen;
  const tailStart = L / 2 - tailLen;
  const fR = fatR * wMul;
  const mR = midR * wMul;
  const tR = tailR * wMul;

  const pt = (r, y) => new THREE.Vector2(Math.max(0.005, r), y);
  const pts = [];
  const N = 18;

  // 鼻端：椭圆弧（圆润子弹头）
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -L / 2 + t * noseLen;
    const r = fR * Math.sqrt(1 - Math.pow(1 - t, 2));
    pts.push(pt(r, z));
  }

  // 中段：从 noseEnd 平滑曲到 tailStart
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const z = noseEnd + t * (tailStart - noseEnd);
    let r;
    if (t < 0.4) {
      r = fR + (mR - fR) * (1 - Math.pow(1 - t / 0.4, 3));
    } else if (t < 0.7) {
      r = mR;
    } else {
      const tt = (t - 0.7) / 0.3;
      r = mR - (mR - tR) * Math.pow(tt, 3);
    }
    pts.push(pt(r, z));
  }

  // 尾端：椭圆弧
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const z = tailStart + t * tailLen;
    const r = tR * Math.sqrt(1 - t * t);
    pts.push(pt(r, z));
  }

  const geo = new THREE.LatheGeometry(pts, 24);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();

  const mainHull = new THREE.Mesh(geo, hullMat);
  g.add(mainHull);

  // ▸ 不对称生长：单侧 bulge
  if (asymmetry > 0.3 && bulge > 0.3) {
    const bulgeSize = midR * s * bulge * 0.55;
    const bulgeZ = 0.05 * L; // 中段略偏前
    const bulgeY = midR * s * 0.6;
    const bulgeGeo = new THREE.SphereGeometry(bulgeSize, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const bulgeMesh = new THREE.Mesh(bulgeGeo, hullMat);
    bulgeMesh.scale.set(0.5, 0.7, 1.0);
    bulgeMesh.position.set(
      midR * s * wMul + bulgeSize * 0.3, // 右侧突出
      bulgeY + bulgeSize * 0.25,
      bulgeZ
    );
    bulgeMesh.rotation.z = -0.3;
    g.add(bulgeMesh);

    // 对侧小突起（不完全对称）
    const smallBulge = new THREE.Mesh(
      new THREE.SphereGeometry(bulgeSize * 0.4, 8, 6),
      hullMat
    );
    smallBulge.position.set(
      -(midR * s * wMul + bulgeSize * 0.15),
      bulgeY * 0.5,
      bulgeZ - 0.08 * L
    );
    g.add(smallBulge);
  }

  // 共享元素（适配宽轮廓）
  buildSpine(ctx, g, midR * wMul * 0.92 / midR, 0.7);
  buildBridge(ctx, g);

  g.userData.hullRead = { ...ctx.hullProfile, len: ctx.hullProfile.len, noseFat: ctx.hullProfile.noseFat, mid: ctx.hullProfile.mid, tail: ctx.hullProfile.tail, wingSpan: ctx.hullProfile.wingSpan };

  return g;
}
