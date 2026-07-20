// RibbonGenerator.js — 贴合船体曲面的发光缝（Ribbon Mesh）
// 职责：返回包含「背脊中线 + 两舷发光缝」的 THREE.Group。
// 顶点由 ctx.sampleHullSurface 生成在船体表面，天然贴面、不悬空、不穿模。
// （Commit 2：删除本地 R(z)，统一走 ctx.radiusAt / ctx.sampleHullSurface）
import * as THREE from "three";
import { MaterialFactory } from "./MaterialFactory.js";

// 单条发光缝：沿 phi 角方向、宽度 ±dphi 的带状三角网格
function addSeamRibbon(group, phi, dphi, ctx, L, intensity = 2.2) {
  const N = 28;
  const z0 = -0.46 * L, z1 = 0.46 * L;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const z = z0 + (z1 - z0) * (i / N);
    const off = ctx.radiusAt(z) * 0.008;            // 略高于表面，避免 z-fighting（polygonOffset 双保险）
    const pL = ctx.sampleHullSurface(z, phi - dphi, off);
    const pR = ctx.sampleHullSurface(z, phi + dphi, off);
    pos.push(pL.x, pL.y, pL.z, pR.x, pR.y, pR.z);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = MaterialFactory.getGlow("ribbon", ctx, intensity);
  mat.polygonOffset = true;            // 防止与船体 z 冲突闪烁
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  mat.side = THREE.DoubleSide;
  group.add(new THREE.Mesh(geo, mat));
}

export function generateRibbons(ctx) {
  const { L } = ctx;
  const g = new THREE.Group();
  g.name = "ribbons";

  const seamAngles = [0, 0.95, -0.95]; // 0=背脊中线，±=两舷
  const seamHalfW = 0.038;             // 发光缝半角宽（弧度）→ 世界宽度 = 2·dphi·R(z)，随船体自动等比
  for (const phi of seamAngles) addSeamRibbon(g, phi, seamHalfW, ctx, L, 2.2);

  return g;
}
