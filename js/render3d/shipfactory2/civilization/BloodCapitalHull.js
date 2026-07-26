// BloodCapitalHull.js — Blood Raider 旗舰/超旗：在 OverloadedHull 鳐鱼曲面上叠加专属结构
//
// 多方案设计——由选中的 variant 决定：
//   A — 血核矩阵（背部多重外露品红心脏 + 保护笼 + 导管）
//   B — 恶魔犄角（船头向前巨角 + 脊刺）
//   C — 镰翼扩张（翼展镰刀延伸 + 翼尖辉光）
//   D — 血管棘环（环绕船体的品红血管带 + 棘刺）
//   E — 悬浮血环（船体上方多层品红悬浮光环）
//   F — 组合方案（A 血核 + B 犄角 + C 镰翼）
//
// 位置全部基于鳐鱼 manta 几何（buildManta 常量）：
//   zN = -0.46L（头）  zT = +0.46L（尾）  Wmax = R*3.2（翼展半宽）  Hmax = R*0.66（身厚半高）
//   主血核 reactorPos = (0, -0.72R, -0.10L)，reactorR = 0.78R
//
// 血核/品红发光：必须用 blood palette 的品红 glow（getGlow("ribbon")→pal.glow），
//   绝不能用 getGlow("ring")——那会强制返回固定青蓝 RING_COLOR。
import * as THREE from "three";
import { MaterialFactory } from "../MaterialFactory.js";

function addPart(g, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  g.add(m);
  return m;
}

function getDims(ctx) {
  const R = ctx.hullProfile.mid * ctx.s;
  const L = ctx.L;
  const zN = -0.46 * L, zT = 0.46 * L;
  const Wmax = R * 3.2, Hmax = R * 0.66;
  const reactorPos = new THREE.Vector3(0, -R * 0.72, -0.10 * L);
  const reactorR = R * 0.78;
  const isSuper = (ctx.spec && (ctx.spec.hull === "supercapital" || String(ctx.spec.hull).endsWith("_supercapital")));
  const mounts = (ctx.profile && ctx.profile.hull && ctx.profile.hull.mounts) || (isSuper ? 7 : 6);

  const d = ctx._bloodDims;
  if (d && d.reactorPos) {
    return { R, L, zN, zT, Wmax, Hmax,
      reactorPos: d.reactorPos.clone(), reactorR: d.reactorR || reactorR,
      isSuper, mounts };
  }
  // fallback: 当 _bloodDims 不存在时（如 demo 创建的第二个 context），从 manta 常量推算
  return { R, L, zN, zT, Wmax, Hmax, reactorPos, reactorR, isSuper, mounts };
}

// ── 材质工厂 ──
function bloodGlow(ctx, intensity = 2.0) {
  return MaterialFactory.getGlow("ribbon", ctx, intensity); // pal.glow = 品红
}
function cageMat(ctx) {
  return MaterialFactory.get("engineCasing", ctx);
}

// ═══════════════════════════════════════════
//  方案 A — 血核矩阵（背部多重外露心脏）
// ═══════════════════════════════════════════
function applyVariantA(g, d, ctx) {
  const { R, L, isSuper } = d;
  const core = bloodGlow(ctx, 2.4);
  const cage = cageMat(ctx);
  const nCores = isSuper ? 5 : 3;
  const cores = [];

  for (let i = 0; i < nCores; i++) {
    const t = (i + 1) / (nCores + 1);
    const zPos = -0.32 * L + t * 0.58 * L;
    const coreR = R * (0.22 + 0.06 * (1 - Math.abs(t - 0.5) * 1.4));
    const y = R * 0.50;
    const c = new THREE.Mesh(new THREE.SphereGeometry(coreR, 20, 14), core);
    c.position.set(0, y, zPos);
    g.add(c);
    cores.push(c.position.clone());
    // 保护性笼（两道交错环）
    for (let k = 0; k < 2; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(coreR * 1.35, R * 0.035, 8, 20), cage);
      ring.position.copy(c.position);
      ring.rotation.x = Math.PI / 2 + k * 0.55;
      ring.rotation.y = k * 0.5;
      g.add(ring);
    }
    // 核心下方引出导管汇入主血核
    const conduit = bloodGlow(ctx, 1.6);
    const src = c.position.clone();
    const tgt = d.reactorPos.clone();
    const mid = src.clone().lerp(tgt, 0.5).add(new THREE.Vector3(0, -R * 0.2, 0));
    const curve = new THREE.CatmullRomCurve3([src, mid, tgt]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, R * 0.03, 6, false), conduit);
    g.add(tube);
  }
  // 脊线导管连接相邻核心
  for (let i = 0; i < cores.length - 1; i++) {
    const a = cores[i], b = cores[i + 1];
    const curve = new THREE.CatmullRomCurve3([
      a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, R * 0.12, 0)), b,
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, R * 0.028, 6, false), bloodGlow(ctx, 1.6));
    g.add(tube);
  }
}

// ═══════════════════════════════════════════
//  方案 B — 恶魔犄角（船头巨角 + 脊刺）
// ═══════════════════════════════════════════
function applyVariantB(g, d, ctx) {
  const { R, L, isSuper, zN } = d;
  const horn = ctx.hullMat;
  const glow = bloodGlow(ctx, 1.9);
  const nPairs = isSuper ? 2 : 1; // 超旗：主巨角 + 副角；旗舰：单对

  for (let p = 0; p < nPairs; p++) {
    const scale = 1 - p * 0.34;
    for (const sx of [-1, 1]) {
      // 犄角放大：半径 0.16R→0.26R，长度 1.7R→2.8R，更前伸上翘
      const hornR = R * 0.26 * scale;
      const hornH = R * 2.8 * scale;
      const h = new THREE.Mesh(new THREE.ConeGeometry(hornR, hornH, 12), horn);
      h.position.set(sx * R * (0.40 + p * 0.32), R * (0.20 + p * 0.06), zN - R * (0.62 + p * 0.20) * scale);
      h.rotation.x = -1.10 - p * 0.08;     // 向前上方翘
      h.rotation.z = sx * (0.20 + p * 0.04);
      g.add(h);
      // 角根品红辉光环（同步放大）
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.30 * scale, R * 0.045, 8, 18), glow);
      ring.position.set(sx * R * (0.40 + p * 0.32), R * (0.20 + p * 0.06), zN - R * (0.22 + p * 0.20) * scale);
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
    }
  }
  // 脊刺（背中线一列发光尖刺）
  const nSpikes = isSuper ? 9 : 6;
  for (let i = 0; i < nSpikes; i++) {
    const t = (i + 0.5) / nSpikes;
    const zPos = -0.22 * L + t * 0.50 * L;
    const sR = R * (0.06 + 0.05 * (1 - Math.abs(t - 0.5)));
    const sH = R * (0.28 + 0.18 * (1 - Math.abs(t - 0.5)));
    const sp = new THREE.Mesh(new THREE.ConeGeometry(sR, sH, 6), horn);
    sp.position.set(0, R * 0.52 + sH * 0.4, zPos);
    sp.rotation.x = -0.18;
    g.add(sp);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(sR * 0.5, 6, 6), glow);
    tip.position.set(0, R * 0.52 + sH * 0.85, zPos);
    g.add(tip);
  }
}

// ═══════════════════════════════════════════
//  方案 C — 镰翼扩张（从翼尖边缘向外伸出的镰刀刃）
//  关键：镰刀必须从翼面边缘"长出来"，用曲线+管几何做弧形刀身，
//        起点紧贴翼面、向外向后弯曲扫出，像真正的镰刀。
// ═══════════════════════════════════════════
function applyVariantC(g, d, ctx) {
  const { R, L, isSuper, Wmax, zN, zT } = d;
  const blade = MaterialFactory.get("engineCasing", ctx); // 深色金属刀身
  const glow = bloodGlow(ctx, 2.4);                       // 粉色锋刃辉光
  const nBlades = isSuper ? 2 : 1;                        // 每侧刀数

  for (const sx of [-1, 1]) {
    for (let b = 0; b < nBlades; b++) {
      // ── 起点：翼面边缘（船体中后段，翼仍很宽处）──
      // 沿翼展方向取 75%~90% Wmax 作为"翼尖出发位置"
      const attachFrac = 0.74 + b * 0.14;               // 第1把=74%翼展，第2把=88%
      const ax = sx * Wmax * attachFrac;                 // 起点 X（在翼面上）
      const az = zN + (zT - zN) * (0.28 + b * 0.12);   // 起点 Z（中后段）
      const ay = R * 0.04;                               // 起点 Y（贴近翼面）

      // ── 镰刀曲线：从翼面出发 → 向外扫 → 向后弯 → 刀尖上挑 ──
      const sweep = R * (1.6 + b * 0.7);                // 向外扫出距离
      const rear  = L * (0.14 + b * 0.06);              // 向后延伸
      const upTip = R * (0.35 + b * 0.15);              // 刀尖上挑高度
      const p0 = new THREE.Vector3(ax, ay, az);          // ① 翼面出发点（根部）
      const p1 = new THREE.Vector3(ax + sx * sweep * 0.45, ay + R * 0.06, az + rear * 0.25);  // ② 外凸弧顶
      const p2 = new THREE.Vector3(ax + sx * sweep * 0.85, ay + R * 0.14, az + rear * 0.70);  // ③ 后弯段
      const p3 = new THREE.Vector3(ax + sx * sweep,       ay + upTip,         az + rear);       // ④ 刀尖（上挑）
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);

      // 刀身：粗管（金属），沿曲线
      const tubeR = R * (0.095 - b * 0.02);              // 越靠外的刀越细
      const bladeMesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, tubeR, 8, false), blade);
      g.add(bladeMesh);

      // 锋刃：细辉光管贴在刀身上缘（偏外侧+偏高）
      const edgeCurve = new THREE.CatmullRomCurve3([
        p0.clone().add(new THREE.Vector3(sx * R * 0.03, R * 0.035, 0)),
        p1.clone().add(new THREE.Vector3(sx * R * 0.04, R * 0.055, 0)),
        p2.clone().add(new THREE.Vector3(sx * R * 0.04, R * 0.10, 0)),
        p3.clone().add(new THREE.Vector3(0, R * 0.04, 0)),
      ]);
      const edgeMesh = new THREE.Mesh(
        new THREE.TubeGeometry(edgeCurve, 20, R * 0.025, 6, false), glow);
      g.add(edgeMesh);

      // 刀尖发光球
      const tipGlow = new THREE.Mesh(
        new THREE.SphereGeometry(tubeR * 1.4, 10, 10), glow);
      tipGlow.position.copy(p3);
      g.add(tipGlow);
    }

    // 翼尖末端装饰环（在最外侧那把刀的刀尖附近）
    const lastSweep = R * (1.6 + (nBlades - 1) * 0.7);
    const lastRear  = L * (0.14 + (nBlades - 1) * 0.06);
    const lastUp    = R * (0.35 + (nBlades - 1) * 0.15);
    const tipX = sx * (Wmax * (0.74 + (nBlades - 1) * 0.14) + lastSweep);
    const tipZ = zN + (zT - zN) * (0.28 + (nBlades - 1) * 0.12) + lastRear;
    const tipY = R * 0.04 + lastUp;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.22, R * 0.055, 10, 24), glow);
    ring.position.set(tipX, tipY, tipZ);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
  }
}

// ═══════════════════════════════════════════
//  方案 D — 血管棘环（环绕船体的品红血管带）
// ═══════════════════════════════════════════
function applyVariantD(g, d, ctx) {
  const { R, L, isSuper, Wmax, Hmax } = d;
  const glow = bloodGlow(ctx, 1.8);
  const nRings = isSuper ? 3 : 2;
  const yScale = Hmax / Wmax; // 压扁椭圆贴合鳐鱼截面（≈0.206）

  for (let i = 0; i < nRings; i++) {
    const t = (i + 1) / (nRings + 1);
    const zPos = -0.30 * L + t * 0.55 * L;
    const ringR = Wmax * 0.98;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, R * 0.045, 10, 36), glow);
    ring.scale.set(1.0, yScale, 1.0);   // 椭圆环套住船体
    ring.position.set(0, 0, zPos);
    g.add(ring);
    // 环上棘刺（指向外）
    const nSpikes = 10;
    for (let k = 0; k < nSpikes; k++) {
      const a = (k / nSpikes) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(R * 0.03, R * 0.16, 6), glow);
      sp.position.set(Math.sin(a) * ringR, Math.cos(a) * ringR * yScale, zPos);
      sp.rotation.z = -a;               // 指向径向外侧
      g.add(sp);
    }
  }
}

// ═══════════════════════════════════════════
//  方案 E — 悬浮血环（船体上方多层品红悬浮光环）
// ═══════════════════════════════════════════
function applyVariantE(g, d, ctx) {
  const { R, L, isSuper } = d;
  const glow = bloodGlow(ctx, 2.5);
  const nRings = isSuper ? 4 : 2;

  for (let i = 0; i < nRings; i++) {
    const t = (i + 1) / (nRings + 1);
    const zPos = -0.30 * L + t * 0.55 * L;
    const ringR = R * (1.35 + 0.12 * i);
    const yOff = R * (1.45 + 0.12 * i);
    addPart(g, new THREE.TorusGeometry(ringR, R * 0.06, 12, 32), glow, [0, yOff, zPos]);
    addPart(g, new THREE.TorusGeometry(ringR * 0.8, R * 0.03, 12, 32),
      MaterialFactory.getGlowColor(0xff3a6e, 3), [0, yOff, zPos]);
  }
}

// ═══════════════════════════════════════════
//  方案 F — 组合（A 血核 + B 犄角 + C 镰翼）
// ═══════════════════════════════════════════
function applyVariantF(g, d, ctx) {
  applyVariantA(g, d, ctx);
  applyVariantB(g, d, ctx);
  applyVariantC(g, d, ctx);
}

// ═══════════════════════════════════════════
//  方案 G — 组合（B 放大犄角 + C 镰翼）【生产默认】
// ═══════════════════════════════════════════
function applyVariantG(g, d, ctx) {
  applyVariantB(g, d, ctx);   // 恶魔犄角（已放大）
  applyVariantC(g, d, ctx);   // 镰翼扩张（从翼面伸出的弧形刀身）
}

// ═══════════════════════════════════════════
//  调度
// ═══════════════════════════════════════════
const V = { A: applyVariantA, B: applyVariantB, C: applyVariantC, D: applyVariantD, E: applyVariantE, F: applyVariantF, G: applyVariantG };

export function generateBloodCapitalHull(hullGroup, ctx, variant = "G") {
  const d = getDims(ctx);
  if (!d) return hullGroup;
  const fn = V[variant] || applyVariantG;
  fn(hullGroup, d, ctx);
  return hullGroup;
}
