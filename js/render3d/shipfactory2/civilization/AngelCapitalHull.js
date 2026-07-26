// AngelCapitalHull.js — Angel Cartel 旗舰/超旗：在 OrganicHull 弯曲生物曲面上叠加专属结构
//
// 多方案设计——由选中的 variant 决定：
//   A — 冰晶能量翼（半透明冰蓝翼片）
//   B — 生物发光脊柱刺（发光晶体的序列）
//   C — 多重悬浮光环（冰蓝光环链）
//   D — 尾部能量羽流（发光能量丝）
//   E — 外骨骼漂浮甲片（菱形半透明甲片）
//   F — 组合方案（A + C + B）
//
// 位置全部基于 ctx._angelDims（OrganicHull 暴露的 Anchor Bus）。
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

function getDims(ctx) {
  const d = ctx._angelDims;
  if (d) {
    const { zN, zT, R, wMul, hMul, CL, bodyR } = d;
    const L = zT - zN;
    const isSuper = (ctx.spec && (ctx.spec.hull === "supercapital" || String(ctx.spec.hull).endsWith("_supercapital")));
    const mounts = (ctx.profile && ctx.profile.hull && ctx.profile.hull.mounts) || (isSuper ? 7 : 6);
    return { zN, zT, R, L, wMul, hMul, CL, bodyR, isSuper, mounts };
  }
  // fallback: 当 _angelDims 不存在时（如 demo 创建的第二个 context），从 hullProfile 推算
  const R = (ctx.hullProfile && ctx.hullProfile.mid) ? ctx.hullProfile.mid * ctx.s : 3;
  const L = ctx.L || 40;
  const zN = -L / 2, zT = L / 2;
  const isSuper = (ctx.spec && (ctx.spec.hull === "supercapital" || String(ctx.spec.hull).endsWith("_supercapital")));
  const mounts = (ctx.profile && ctx.profile.hull && ctx.profile.hull.mounts) || (isSuper ? 7 : 6);
  return { zN, zT, R, L, wMul: 0.95, hMul: 1.12, CL: null, bodyR: null, isSuper, mounts };
}

// ── 材质工厂 ──
function wingMat(ctx, intensity = 1.5) {
  const pal = ctx.palette;
  // Task 9：集中到 Materials.stdMaterial，参数逐项保留（零视觉变化）
  return stdMaterial({
    color: pal.glow, emissive: pal.glow, emissiveIntensity: intensity,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });
}
function spikeMat(ctx, intensity = 2.0) {
  const pal = ctx.palette;
  return stdMaterial({
    color: pal.glow, emissive: pal.glow, emissiveIntensity: intensity,
    metalness: 0.3, roughness: 0.4,
  });
}

// ═══════════════════════════════════════════
//  方案 A — 冰晶能量翼
// ═══════════════════════════════════════════
function applyVariantA(g, d, ctx) {
  const { R, L, isSuper } = d;
  const wing = wingMat(ctx, 2.0);
  const nWings = isSuper ? 3 : 2;

  for (const side of [-1, 1]) {
    for (let i = 0; i < nWings; i++) {
      const t = (i + 1) / (nWings + 1);
      const zPos = -L * 0.30 + t * L * 0.55;
      const wingR = R * (0.70 + 0.30 * t);
      const wingLen = R * (0.80 + 0.40 * t);
      const wingThick = R * 0.04;
      // 翼片（用扁平的 BoxGeometry 模拟翅膀）
      addPart(g, new THREE.BoxGeometry(wingLen, wingThick, wingR * 0.35), wing,
        [side * (R * 1.0 + wingLen * 0.4), R * 0.65, zPos],
        [0.2, side * 0.25, side * 0.3]);
      // 翼尖发光
      addPart(g, new THREE.SphereGeometry(R * 0.035, 8, 8),
        MaterialFactory.getGlowColor(0x9affc0, 2.0),
        [side * (R * 1.0 + wingLen * 0.85), R * 0.70, zPos]);
    }
  }

  // 超旗加竖直尾翼
  if (isSuper) {
    const tailZ = L * 0.42;
    addPart(g, new THREE.BoxGeometry(R * 0.04, R * 0.60, R * 0.35), wing,
      [0, R * 0.55, tailZ]);
    addPart(g, new THREE.SphereGeometry(R * 0.04, 8, 8),
      MaterialFactory.getGlowColor(0x9affc0, 2.0), [0, R * 0.85, tailZ]);
  }
}

// ═══════════════════════════════════════════
//  方案 B — 生物发光脊柱刺
// ═══════════════════════════════════════════
function applyVariantB(g, d, ctx) {
  const { R, L, isSuper } = d;
  const spike = spikeMat(ctx, 2.5);
  const nSpikes = isSuper ? 12 : 7;

  for (let i = 0; i < nSpikes; i++) {
    const t = (i + 0.5) / nSpikes;
    const zPos = -L * 0.40 + t * L * 0.75;
    const sR = R * (0.06 + 0.08 * (1 - Math.abs(t - 0.5) * 1.6));
    const sH = R * (0.15 + 0.20 * (1 - Math.abs(t - 0.5) * 1.2));
    // 刺体（锥体，尖端朝上偏后）
    addPart(g, new THREE.ConeGeometry(sR, sH, 6), spike,
      [0, R * 0.50 + sH * 0.40, zPos], [-0.15, 0, 0]);
    // 刺尖发光球
    addPart(g, new THREE.SphereGeometry(sR * 0.50, 6, 6),
      MaterialFactory.getGlowColor(0x9affc0, 2.5),
      [0, R * 0.50 + sH * 0.85, zPos]);
  }
}

// ═══════════════════════════════════════════
//  方案 C — 多重悬浮光环
// ═══════════════════════════════════════════
function applyVariantC(g, d, ctx) {
  const { R, L, isSuper } = d;
  const glowMat = MaterialFactory.getGlow("ribbon", ctx, 2.5);
  const nRings = isSuper ? 4 : 2;

  for (let i = 0; i < nRings; i++) {
    const t = (i + 1) / (nRings + 1);
    const zPos = -L * 0.30 + t * L * 0.55;
    const ringR = R * (1.10 + 0.15 * (1 - Math.abs(t - 0.5) * 1.5));
    const tubeR = R * 0.06;
    addPart(g, new THREE.TorusGeometry(ringR, tubeR, 12, 28), glowMat,
      [0, R * 1.25 + i * R * 0.08, zPos]);
    // 内圈辉光强化
    addPart(g, new THREE.TorusGeometry(ringR * 0.85, tubeR * 0.50, 12, 28),
      MaterialFactory.getGlowColor(0x9affc0, 3.0),
      [0, R * 1.25 + i * R * 0.08, zPos]);
  }
}

// ═══════════════════════════════════════════
//  方案 D — 尾部能量羽流（围绕船尾径向散开 + 弯曲度）
// ═══════════════════════════════════════════
function applyVariantD(g, d, ctx) {
  const { R, L, isSuper } = d;
  const nStreams = isSuper ? 7 : 5;
  const streamMat = stdMaterial({
    color: 0x88ffcc, emissive: 0x44ffaa, emissiveIntensity: 2.5,
    transparent: true, opacity: 0.60,
  });

  const zTail = L * 0.42;                          // 船尾汇聚点（+Z 为船尾）
  const streamLen = R * (4.80 + 1.20 * (isSuper ? 1 : 0));
  const r0 = R * 0.55;                             // 起始：贴近船尾表面
  const rEnd = R * (1.30 + 0.35 * (isSuper ? 1 : 0)); // 末端：向外大幅散开
  const swirl = isSuper ? 0.32 : 0.22;            // 切向旋扭 → 弯曲度
  const tubeR = R * 0.13;                          // 能量丝粗细

  for (let i = 0; i < nStreams; i++) {
    const ang = (i / nStreams) * Math.PI * 2;      // 沿船尾圆周均匀分布
    // 控制点：半径内收 + 角度旋扭 → 形成外凸弧线与轻微螺旋弯曲
    const rMid = (r0 + rEnd) * 0.5 * 0.82;
    const aMid = ang + swirl;
    const aEnd = ang + swirl * 1.5;
    const p0 = new THREE.Vector3(Math.cos(ang) * r0,  Math.sin(ang) * r0,  zTail);
    const p1 = new THREE.Vector3(Math.cos(aMid) * rMid, Math.sin(aMid) * rMid, zTail + streamLen * 0.5);
    const p2 = new THREE.Vector3(Math.cos(aEnd) * rEnd,  Math.sin(aEnd) * rEnd,  zTail + streamLen);

    const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const geo = new THREE.TubeGeometry(curve, 24, tubeR, 8, false);
    addPart(g, geo, streamMat, [0, 0, 0], [0, 0, 0]);

    // 末端发光球（散开端）
    addPart(g, new THREE.SphereGeometry(tubeR * 0.95, 8, 8),
      MaterialFactory.getGlowColor(0x88ffcc, 3.0),
      [p2.x, p2.y, p2.z]);
  }

  // 船尾能量核心球（所有能量丝的汇聚点）
  addPart(g, new THREE.SphereGeometry(R * 0.18, 12, 12),
    MaterialFactory.getGlowColor(0x88ffcc, 2.5),
    [0, 0, zTail + R * 0.10]);
}

// ═══════════════════════════════════════════
//  方案 E — 外骨骼漂浮甲片
// ═══════════════════════════════════════════
function applyVariantE(g, d, ctx) {
  const { R, L, isSuper } = d;
  const nPlates = isSuper ? 10 : 6;
  const plateMat = stdMaterial({
    color: 0x6aa0b8, emissive: 0x3a88a8, emissiveIntensity: 0.8,
    transparent: true, opacity: 0.50, side: THREE.DoubleSide,
    metalness: 0.4, roughness: 0.3,
  });

  for (let i = 0; i < nPlates; i++) {
    const t = (i + 0.5) / nPlates;
    const zPos = -L * 0.35 + t * L * 0.65;
    const side = (i % 2 === 0) ? 1 : -1;
    const pw = R * (0.25 + 0.10 * Math.sin(t * Math.PI));
    const ph = R * (0.15 + 0.08 * Math.sin(t * Math.PI));
    const dist = R * (1.15 + 0.10 * Math.sin(i * 1.5));
    addPart(g, new THREE.BoxGeometry(pw, ph, R * 0.04), plateMat,
      [side * dist, R * 0.60, zPos], [0, 0, side * 0.3 * Math.sin(t * 2)]);
  }

  // 超旗加背部甲片
  if (isSuper) {
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      const zPos = -L * 0.20 + t * L * 0.40;
      addPart(g, new THREE.BoxGeometry(R * 0.35, R * 0.04, R * 0.25), plateMat,
        [0, R * 0.85, zPos]);
    }
  }
}

// ═══════════════════════════════════════════
//  方案 F — 组合（A 翼 + C 光环 + B 刺脊）
// ═══════════════════════════════════════════
function applyVariantF(g, d, ctx) {
  applyVariantA(g, d, ctx);
  applyVariantC(g, d, ctx);
  applyVariantB(g, d, ctx);
}

// ═══════════════════════════════════════════
//  方案 H — 用户选定（A 翼 + D 能量羽流）
// ═══════════════════════════════════════════
function applyVariantH(g, d, ctx) {
  applyVariantA(g, d, ctx);
  applyVariantD(g, d, ctx);
}

// ═══════════════════════════════════════════
//  调度
// ═══════════════════════════════════════════
const V = { A: applyVariantA, B: applyVariantB, C: applyVariantC, D: applyVariantD, E: applyVariantE, F: applyVariantF, H: applyVariantH };

export function generateAngelCapitalHull(hullGroup, ctx, variant = "H") {
  const d = getDims(ctx);
  if (!d) return hullGroup;
  const fn = V[variant] || applyVariantH;
  fn(hullGroup, d, ctx);
  return hullGroup;
}
