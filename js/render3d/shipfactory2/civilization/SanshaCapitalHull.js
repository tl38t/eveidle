// SanshaCapitalHull.js — Sansha's Nation 旗舰/超旗：在 ModularHull 十二面体笼+内核上叠加专属结构
//
// 多方案设计——由选中的 variant 决定：
//   A — 复制分身（周围悬浮多个小型十二面体笼，核心供能束连接）
//   B — 谐振护盾环（笼体外多重青绿共振环）
//   C — 面心触须（12 个面心伸出发光天线 + 尖端节点）
//   D — 增生装甲壳（外层更大笼骨架 + 面心五边形装甲板）
//   E — 超频核心（更大炽核 + 环绕轨道子核）
//   F — 组合方案（A 复制 + B 谐振环 + C 触须）
//
// 几何基于 ModularHull 注入的 ctx._sanshaDims：
//   cageR    笼子外接半径（= L*0.5）
//   coreR    内核立方体半边长（= cageR*0.45）
//   verts    20 个笼顶点（半径 cageR）
//   faceDirs 12 个面法向（单位向量）
//   faceInset 面心到球心距离（= cageR*0.7947）
//
// 配色：sansha palette 青绿 glow（getGlowColor 0x36e0a0）。
import * as THREE from "three";
import { MaterialFactory } from "../MaterialFactory.js";

// ── 正十二面体规范几何（与 ModularHull 同一规范朝向，供小型复制笼复用）──
const PHI = (1 + Math.sqrt(5)) / 2;
const IPHI = 1 / PHI;
const UP = new THREE.Vector3(0, 1, 0);

function dodecVerts(R) {
  const raw = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) raw.push([x, y, z]);
  for (const a of [-IPHI, IPHI]) for (const b of [-PHI, PHI]) {
    raw.push([0, a, b]); raw.push([a, b, 0]); raw.push([b, 0, a]);
  }
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize().multiplyScalar(R));
}
function dodecFaceDirs() {
  const raw = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) {
    raw.push([0, a, b]); raw.push([a, b, 0]); raw.push([b, 0, a]);
  }
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
}

function getDims(ctx) {
  const L = ctx.L;
  const cageR = L * 0.5;
  const isSuper = !!(ctx.spec && (ctx.spec.hull === "supercapital" || String(ctx.spec.hull).endsWith("_supercapital")));
  const d = ctx._sanshaDims;
  if (d && d.cageR) {
    return {
      R: d.cageR, coreR: d.coreR,
      verts: d.verts, faceDirs: d.faceDirs, faceInset: d.faceInset,
      isSuper,
    };
  }
  // fallback：demo 第二次 context 等场景下从常量推算
  return {
    R: cageR, coreR: cageR * 0.45,
    verts: dodecVerts(cageR), faceDirs: dodecFaceDirs(), faceInset: cageR * 0.7947,
    isSuper,
  };
}

// ── 材质 ──
function sGlow(intensity = 2.0) {
  return MaterialFactory.getGlowColor(0x36e0a0, intensity); // 青绿
}
function sMetal(ctx) {
  return MaterialFactory.get("engineCasing", ctx);
}

// 用 30 条棱搭一个十二面体笼（复用 verts）
function makeCage(verts, mat, strutR) {
  const g = new THREE.Group();
  let minD = Infinity;
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++)
      minD = Math.min(minD, verts[i].distanceTo(verts[j]));
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const a = verts[i], b = verts[j];
      if (a.distanceTo(b) <= minD * 1.05) {
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const dir = b.clone().sub(a);
        const strut = new THREE.Mesh(new THREE.CylinderGeometry(strutR, strutR, dir.length(), 6), mat);
        strut.position.copy(mid);
        strut.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
        g.add(strut);
      }
    }
  }
  return g;
}

// ═══════════════════════════════════════════
//  A — 复制分身阵列
// ═══════════════════════════════════════════
function applyVariantA(g, d, ctx) {
  const { R, verts, isSuper } = d;
  const glow = sGlow(2.2), metal = sMetal(ctx);
  const dirs = d.faceDirs;
  const nClone = isSuper ? 9 : 6;
  const cloneR = R * 0.34;
  const dist = R * 1.75;
  const cloneStrutR = cloneR * 0.07;
  for (let i = 0; i < nClone; i++) {
    const dir = dirs[i % dirs.length];
    const center = dir.clone().multiplyScalar(dist);
    const cv = dodecVerts(cloneR);
    const cage = makeCage(cv, metal, cloneStrutR);
    cage.position.copy(center);
    cage.rotation.set(i * 0.7, i * 1.1, i * 0.4);
    g.add(cage);
    // 内核小晶
    const core = new THREE.Mesh(new THREE.BoxGeometry(cloneR * 0.5, cloneR * 0.5, cloneR * 0.5), sGlow(3.0));
    core.position.copy(center);
    g.add(core);
    // 供能束：主核(0,0,0) → 分身核心
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      center.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, R * 0.2, 0)),
      center,
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, R * 0.018, 6, false), glow);
    g.add(tube);
  }
}

// ═══════════════════════════════════════════
//  B — 谐振护盾环
// ═══════════════════════════════════════════
function applyVariantB(g, d) {
  const { R, isSuper } = d;
  const glow = sGlow(2.0);
  const nRings = isSuper ? 5 : 3;
  for (let i = 0; i < nRings; i++) {
    const rr = R * (1.12 + 0.14 * i);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, R * 0.022, 10, 72), glow);
    // torus 默认在 XY 平面、轴沿 Z（=船首尾轴）→ 即环绕笼体的共振环
    g.add(ring);
    // 偶尔倾斜一枚，增加层次
    if (isSuper && i === nRings - 1) ring.rotation.x = Math.PI / 2.4;
  }
}

// ═══════════════════════════════════════════
//  C — 面心触须天线
// ═══════════════════════════════════════════
function applyVariantC(g, d, ctx) {
  const { R, faceDirs, faceInset, isSuper } = d;
  const glow = sGlow(2.4), metal = sMetal(ctx);
  const len = isSuper ? R * 1.15 : R * 0.82;
  for (const dir of faceDirs) {
    const base = dir.clone().multiplyScalar(faceInset);
    const tip = dir.clone().multiplyScalar(faceInset + len);
    const mid = base.clone().add(tip).multiplyScalar(0.5);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.018, R * 0.03, len, 6), metal);
    rod.position.copy(mid);
    rod.quaternion.setFromUnitVectors(UP, dir);
    g.add(rod);
    // 尖端发光节点
    const node = new THREE.Mesh(new THREE.SphereGeometry(R * 0.06, 10, 10), glow);
    node.position.copy(tip);
    g.add(node);
  }
}

// ═══════════════════════════════════════════
//  D — 增生装甲壳
// ═══════════════════════════════════════════
function applyVariantD(g, d, ctx) {
  const { R, verts, faceDirs, faceInset, isSuper } = d;
  const metal = sMetal(ctx), glow = sGlow(1.8);
  const shellR = R * 1.34;
  const shell = makeCage(dodecVerts(shellR), metal, R * 0.016);
  g.add(shell);
  const plateR = R * (isSuper ? 0.22 : 0.18);
  for (const dir of faceDirs) {
    const pos = dir.clone().multiplyScalar(faceInset * 1.30);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(plateR, plateR, R * 0.05, 5), metal);
    plate.position.copy(pos);
    plate.quaternion.setFromUnitVectors(UP, dir); // 圆盘法向沿面法向
    g.add(plate);
    // 板缘辉光
    const edge = new THREE.Mesh(new THREE.TorusGeometry(plateR * 1.02, R * 0.012, 6, 20), glow);
    edge.position.copy(pos);
    edge.quaternion.copy(plate.quaternion);
    g.add(edge);
  }
}

// ═══════════════════════════════════════════
//  E — 超频核心
// ═══════════════════════════════════════════
function applyVariantE(g, d, ctx) {
  const { R, coreR, faceDirs, isSuper } = d;
  const glow = sGlow(3.2), metal = sMetal(ctx);
  // 更大炽核（二十面体）
  const big = new THREE.Mesh(new THREE.IcosahedronGeometry(coreR * 1.5, 0), glow);
  big.rotation.set(0.3, 0.5, 0);
  g.add(big);
  // 轨道子核：围绕若干面法向轴排布
  const axes = isSuper ? faceDirs.slice(0, 6) : faceDirs.slice(0, 3);
  const orbR = R * 0.85;
  for (let a = 0; a < axes.length; a++) {
    const ringG = new THREE.Group();
    ringG.quaternion.setFromUnitVectors(UP, axes[a]);
    const count = isSuper ? 4 : 3;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2 + a * 0.6;
      const cube = new THREE.Mesh(new THREE.BoxGeometry(R * 0.11, R * 0.11, R * 0.11), sGlow(2.6));
      cube.position.set(Math.cos(ang) * orbR, Math.sin(ang) * orbR, 0);
      ringG.add(cube);
    }
    g.add(ringG);
  }
  // 内核到外层装甲感的金属环（沿 X/Y/Z 三轴）
  for (let ax = 0; ax < 3; ax++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(coreR * 2.0, R * 0.012, 6, 28), metal);
    ring.rotation.x = ax === 0 ? 0 : Math.PI / 2;
    ring.rotation.y = ax === 1 ? Math.PI / 2 : 0;
    g.add(ring);
  }
}

// ═══════════════════════════════════════════
//  F — 组合（A 复制 + B 谐振环 + C 触须）
// ═══════════════════════════════════════════
function applyVariantF(g, d, ctx) {
  applyVariantA(g, d, ctx);
  applyVariantB(g, d);
  applyVariantC(g, d, ctx);
}

// ═══════════════════════════════════════════
//  调度
// ═══════════════════════════════════════════
const V = { A: applyVariantA, B: applyVariantB, C: applyVariantC, D: applyVariantD, E: applyVariantE, F: applyVariantF };

export function generateSanshaCapitalHull(hullGroup, ctx, variant = "F") {
  const d = getDims(ctx);
  if (!d) return hullGroup;
  const fn = V[variant] || applyVariantF;
  fn(hullGroup, d, ctx);
  return hullGroup;
}
