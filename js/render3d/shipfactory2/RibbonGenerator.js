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

// ── Sansha 路线（modular）：核心→笼子的发光供能束 ──
// 表现「立方体核心为笼子供能」：锥形渐细发光柱，从核心表面射向笼子锚点。
// 数量随舰级：护卫 4（四面体对称）→ 驱逐 8（立方对称）→ 巡洋 12（面心）→ 战列 20（全顶点）。
function generateSanshaBeams(ctx, g) {
  const dims = ctx._sanshaDims;
  const { cageR, coreR, verts, faceDirs, faceInset } = dims;
  const tier = ctx.classTier;
  const UP = new THREE.Vector3(0, 1, 0);

  const intensity = 2.0 * (ctx.style.ribbonIntensity || 1.0);
  const mat = MaterialFactory.getGlow("ribbon", ctx, intensity);

  // 目标方向 → 最接近的笼顶点
  const nearest = (x, y, z) => {
    const d = new THREE.Vector3(x, y, z).normalize();
    let best = verts[0], bd = -2;
    for (const v of verts) {
      const t = v.clone().normalize().dot(d);
      if (t > bd) { bd = t; best = v; }
    }
    return best;
  };

  let targets;
  if (tier === 0) {
    // 四面体对称：立方顶点的交替 4 个
    targets = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(d => nearest(d[0], d[1], d[2]));
  } else if (tier === 1) {
    // 立方对称：8 个立方顶点
    targets = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) targets.push(nearest(x, y, z));
  } else if (tier === 2) {
    // 12 个面中心
    targets = faceDirs.map(d => d.clone().multiplyScalar(faceInset));
  } else {
    // 全部 20 个顶点
    targets = verts;
  }

  const rBot = cageR * 0.016, rTop = cageR * 0.007;   // 核心端粗、笼端细
  for (const t of targets) {
    const dir = t.clone().normalize();
    const start = dir.clone().multiplyScalar(coreR * 0.45);   // 从核心表面附近射出
    const end = t.clone().multiplyScalar(0.96);               // 略缩进笼内侧
    const len = end.distanceTo(start);
    const mid = start.clone().add(end).multiplyScalar(0.5);

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 6, 1), mat);
    beam.position.copy(mid);
    beam.quaternion.setFromUnitVectors(UP, dir);
    g.add(beam);
  }
  return g;
}

export function generateRibbons(ctx) {
  const { L } = ctx;
  const g = new THREE.Group();
  g.name = "ribbons";

  // Sansha：能量线 = 核心→笼子的供能束，不走曲面 Ribbon 路径
  if (ctx.civ && ctx.civ.hullType === "modular" && ctx._sanshaDims) {
    return generateSanshaBeams(ctx, g);
  }

  // Phase 5 Rework：ribbonIntensity 控制能量线强度（Armor=0.5 暗淡——重甲少发光）
  const intensity = 2.2 * (ctx.style.ribbonIntensity || 1.0);
  // Phase 5 大船区分：发光缝数量随舰级递增（frigate 3 → battleship 9 条），大船更"通电"
  const seamAngles = [0, 0.95, -0.95];
  if (ctx.classTier >= 1) seamAngles.push(0.55, -0.55);
  if (ctx.classTier >= 2) seamAngles.push(1.45, -1.45);
  if (ctx.classTier >= 3) seamAngles.push(1.85, -1.85);
  const seamHalfW = 0.038;             // 发光缝半角宽（弧度）→ 世界宽度 = 2·dphi·R(z)，随船体自动等比
  for (const phi of seamAngles) addSeamRibbon(g, phi, seamHalfW, ctx, L, intensity);

  return g;
}
