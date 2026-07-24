// VentGenerator.js — 通风/冷却格栅（Phase 4 Commit 4 修订版 v4）
// 职责：返回包含「贴合表面的通风格栅」的 THREE.Group。
//   代表气流/冷却/压力管理系统，与 HeatSink（散热）互补。
//
// 设计：顶面 vent 用圆柱壳扇区（curved plate）贴合船体曲面；
//   侧面 vent 因尺寸窄，用 flat box 即可。
//
// 遵循 AI Rules §5/§6/§19。
import * as THREE from "three";
import { rbox } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

// ── 工具：构建圆柱壳扇区（curved plate）──
// rIn / rOut：内外半径（弧段壳）
// arcAngle：覆盖弧度
// halfZ：Z 半深度（沿船体纵向）
// zc：Z 中心
// segments：弧段细分
function curvedPlate(rIn, rOut, arcAngle, halfZ, zc, segments, mat) {
  const n = Math.max(4, segments || Math.ceil(arcAngle / 0.15));
  const verts = [];
  const idx = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const theta = -arcAngle / 2 + t * arcAngle;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const v = i * 4;
    verts.push(st * rIn, ct * rIn, zc - halfZ);   // 0: inner bottom
    verts.push(st * rIn, ct * rIn, zc + halfZ);   // 1: inner top
    verts.push(st * rOut, ct * rOut, zc - halfZ); // 2: outer bottom
    verts.push(st * rOut, ct * rOut, zc + halfZ); // 3: outer top
    if (i < n) {
      const w = v + 4;
      idx.push(v, v + 2, w + 2, v, w + 2, w);       // bottom
      idx.push(v + 1, w + 1, w + 3, v + 1, w + 3, v + 3); // top
      idx.push(v, w, w + 1, v, w + 1, v + 1);       // inner
      idx.push(v + 2, v + 3, w + 3, v + 2, w + 3, w + 2); // outer
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

// ── 工具：构建弧形条（slit），同 curvedPlate 但加端盖（左/右侧面）──
// 用于 slits（fully closed 弧段棒）
function curvedBar(rIn, rOut, arcAngle, halfZ, zc, segments, mat) {
  const n = Math.max(4, segments || Math.ceil(arcAngle / 0.15));
  const verts = [];
  const idx = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const theta = -arcAngle / 2 + t * arcAngle;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const v = i * 4;
    verts.push(st * rIn, ct * rIn, zc - halfZ);
    verts.push(st * rIn, ct * rIn, zc + halfZ);
    verts.push(st * rOut, ct * rOut, zc - halfZ);
    verts.push(st * rOut, ct * rOut, zc + halfZ);
    if (i < n) {
      const w = v + 4;
      idx.push(v, v + 2, w + 2, v, w + 2, w);
      idx.push(v + 1, w + 1, w + 3, v + 1, w + 3, v + 3);
      idx.push(v, w, w + 1, v, w + 1, v + 1);
      idx.push(v + 2, v + 3, w + 3, v + 2, w + 3, w + 2);
    }
  }

  // 端盖（左/右）：各 4 个三角面
  const v0 = 0, v1 = 1, v2 = 2, v3 = 3;
  const vn0 = n * 4, vn1 = n * 4 + 1, vn2 = n * 4 + 2, vn3 = n * 4 + 3;
  idx.push(v0, v1, v3, v0, v3, v2);     // left cap
  idx.push(vn0, vn2, vn3, vn0, vn3, vn1); // right cap

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

export function generateVents(ctx) {
  const { s, _ventPoints } = ctx;
  const rng = ctx.scope("vent").random;

  const g = new THREE.Group();
  g.name = "vents";

  const ventPoints = _ventPoints || [];
  if (ventPoints.length === 0) return g;

  const frameMat = MaterialFactory.get("ventFrame", ctx);
  const slitMat = MaterialFactory.get("ventSlit", ctx);

  for (const vp of ventPoints) {
    const isTop = Math.abs(vp.ny || 0) > 0.5; // 顶面 vent 用曲面
    const size = vp.size || 0.16 * s;
    const vw = size * 0.40;                   // X 覆盖宽度
    const vd = size * 0.52;                   // Z 深度
    const ft = 0.022 * s;                     // 边框厚度

    if (isTop) {
      // ── 顶面 vent：圆柱壳扇区贴合船体曲面 ──
      const hullR = ctx.radiusAt(vp.z);
      if (hullR < 0.01) continue;

      // 边框
      const surfR = hullR + 0.004 * s;        // 贴合船体表面
      const arcAngle = Math.min(vw / hullR, Math.PI * 0.85); // 最大 ~150°
      const arcSeg = Math.max(6, Math.ceil(arcAngle / 0.12));

      const frame = curvedPlate(surfR, surfR + ft, arcAngle, vd * 0.5, vp.z, arcSeg, frameMat);
      g.add(frame);

      // ── Slits：弧形金属条，浮在 frame 上表面 ──
      // Phase 5 C3-A：ventDensity 控制格栅密度；Phase 5 大船区分：slit 基数随舰级递增
      const baseSlits = 4 + ctx.classTier * 2 + Math.floor(rng() * 3);
      const slitCount = Math.max(2, Math.round(baseSlits * ctx.style.ventDensity));
      const slitD = vd * 0.10;
      const slitT = ft * 0.55;
      const slitRBase = surfR + ft + 0.001 * s; // slit 浮在 frame 上方
      const slitSpan = vd * 0.85;
      const slitStep = slitSpan / (slitCount - 1);

      for (let i = 0; i < slitCount; i++) {
        const sz = vp.z - slitSpan * 0.5 + i * slitStep;
        const slit = curvedBar(
          slitRBase, slitRBase + slitT, arcAngle,
          slitD * 0.5, sz, arcSeg, slitMat
        );
        g.add(slit);
      }
    } else {
      // ── 侧面 vent：尺寸窄，flat box 即可 ──
      const rotZ = -Math.atan2(vp.nx, vp.ny);
      const bt = Math.min(ft * 0.45, vw * 0.12, vd * 0.12);
      const cornerR = 0.003 * s;
      const borders = [
        { w: vw, h: ft, d: bt, p: [vp.x, vp.y, vp.z + vd / 2 - bt / 2] },
        { w: vw, h: ft, d: bt, p: [vp.x, vp.y, vp.z - vd / 2 + bt / 2] },
        { w: bt, h: ft, d: vd, p: [vp.x - vw / 2 + bt / 2, vp.y, vp.z] },
        { w: bt, h: ft, d: vd, p: [vp.x + vw / 2 - bt / 2, vp.y, vp.z] },
      ];
      for (const b of borders) {
        const bar = rbox(b.w, b.h, b.d, cornerR, frameMat, b.p);
        bar.rotation.z = rotZ;
        g.add(bar);
      }
      // side slits — Phase 5 C3-A：ventDensity；Phase 5 大船区分：slit 基数随舰级递增
      const innerW = vw - bt * 2;
      const innerD = vd - bt * 2;
      const baseSc = 4 + ctx.classTier * 2 + Math.floor(rng() * 3);
      const sc = Math.max(2, Math.round(baseSc * ctx.style.ventDensity));
      const slitW = innerW * 0.90;
      const slitD = innerD * 0.10;
      const slitT = ft * 0.55;
      const span = innerD * 0.88;
      const step = span / (sc - 1);
      for (let i = 0; i < sc; i++) {
        const sz = vp.z - span * 0.5 + i * step;
        const slit = rbox(slitW, slitT, slitD, 0.002 * s, slitMat,
          [vp.x, vp.y + ft * 0.5 + 0.001 * s, sz]);
        slit.rotation.z = rotZ;
        g.add(slit);
      }
    }
  }

  return g;
}
