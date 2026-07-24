// ModularHull.js — Sansha's Nation：AI 完美复制工厂
// 船体 = 单个正十二面体笼子 + 内部悬浮正六面体核心，再无其他。
// 干净、极致简洁——武器/引擎由独立 Generator 负责。
import * as THREE from "three";
import { hullRadiusAt } from "../Utils.js";
import { MaterialFactory } from "../MaterialFactory.js";

// ── 正十二面体规范几何（与 three.js DodecahedronGeometry 同一规范朝向）──
const PHI = (1 + Math.sqrt(5)) / 2;
const IPHI = 1 / PHI;

// 20 个顶点：立方体 8 + 黄金矩形 12，归一化后乘以笼半径 R
function dodecVerts(R) {
  const raw = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) raw.push([x, y, z]);
  for (const a of [-IPHI, IPHI]) for (const b of [-PHI, PHI]) {
    raw.push([0, a, b]);
    raw.push([a, b, 0]);
    raw.push([b, 0, a]);
  }
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize().multiplyScalar(R));
}

// 12 个面法向（= 对偶二十面体顶点方向），单位向量
function dodecFaceDirs() {
  const raw = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) {
    raw.push([0, a, b]);
    raw.push([a, b, 0]);
    raw.push([b, 0, a]);
  }
  return raw.map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());
}

export function generateModularHull(ctx) {
  const { s, L } = ctx;
  const noseFat = ctx.hullProfile.noseFat, mid = ctx.hullProfile.mid, tail = ctx.hullProfile.tail;
  const g = new THREE.Group();
  g.name = "hull";

  // 笼子半径跟随船体长度 L（与其他族共用同一尺度基准 ctx.L = profile.hull.len * s），
  // 使 sansha 的笼子+护盾泡整体尺寸与其他族一致（此前 cageR 仅取中段半径 ~0.42*s，
  // 不随 L 增长，导致 sansha 比其他族小约 9 倍）。
  const cageR = L * 0.5;

  // 外笼：正十二面体 —— 加粗为实体骨架（30 条棱，圆柱 strut）
  const tier = ctx.classTier;
  const cageVerts = dodecVerts(cageR);
  const strutR = cageR * (0.020 + 0.004 * tier);   // 高阶船骨架更粗壮
  const cageMat = MaterialFactory.getGlow("ribbon", ctx, 1.6 + 0.2 * tier);
  cageMat.side = THREE.DoubleSide;
  // 唯一棱 = 顶点间距最小的那些对（正则十二面体恰 30 条）
  let minD = Infinity;
  for (let i = 0; i < cageVerts.length; i++)
    for (let j = i + 1; j < cageVerts.length; j++)
      minD = Math.min(minD, cageVerts[i].distanceTo(cageVerts[j]));
  const UP = new THREE.Vector3(0, 1, 0);
  const cage = new THREE.Group();
  cage.name = "cage";
  for (let i = 0; i < cageVerts.length; i++) {
    for (let j = i + 1; j < cageVerts.length; j++) {
      const a = cageVerts[i], b = cageVerts[j];
      const d = a.distanceTo(b);
      if (d <= minD * 1.05) {
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const dir = b.clone().sub(a);
        const strut = new THREE.Mesh(
          new THREE.CylinderGeometry(strutR, strutR, dir.length(), 6), cageMat);
        strut.position.copy(mid);
        strut.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
        cage.add(strut);
      }
    }
  }
  g.add(cage);

  // 内芯：正六面体（立方体），悬浮发光处理器 —— 颜色/自发光随舰级递增
  const coreR = cageR * 0.45;
  const TIER_CORE = [
    { color: 0x1f8f6f, glow: 1.6 },  // 护卫：暗沉青绿
    { color: 0x27b98c, glow: 2.0 },  // 驱逐：青绿
    { color: 0x36e0a0, glow: 2.5 },  // 巡洋：亮青绿（基准）
    { color: 0x9bffe8, glow: 3.4 },  // 战列：近白炽青
  ];
  const tc = TIER_CORE[Math.min(tier, 3)] || TIER_CORE[2];
  const coreGlow = MaterialFactory.getGlowColor(tc.color, tc.glow);
  coreGlow.side = THREE.DoubleSide;
  const core = new THREE.Mesh(new THREE.BoxGeometry(coreR, coreR, coreR), coreGlow);
  core.rotation.x = 0.3;
  core.rotation.y = 0.5;
  g.add(core);

  // 战列舰：内嵌白热子核，强化"高阶船核心更炽热"的视觉区分
  if (tier >= 3) {
    const innerMat = MaterialFactory.getGlowColor(0xffffff, 4.2);
    innerMat.side = THREE.DoubleSide;
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(coreR * 0.5, coreR * 0.5, coreR * 0.5), innerMat);
    inner.rotation.copy(core.rotation);
    g.add(inner);
  }

  // ── 表面采样函数（近似圆球，供下游贴附武器/引擎/面板等）──
  const bodyFn = (z) => hullRadiusAt(z, noseFat, mid, tail, L);
  ctx.radiusAt = (z) => bodyFn(z) * s;
  ctx.sampleHullSurface = (z, angle, offset = 0) => {
    const r = bodyFn(z) * s + offset;
    return new THREE.Vector3(r * Math.sin(angle), r * Math.cos(angle), z);
  };
  ctx.normalAt = (z, angle) => {
    const r = bodyFn(z) * s;
    const nx = Math.sin(angle) / r;
    const ny = Math.cos(angle) / r;
    const dz = 1e-3;
    const dr = (bodyFn(z + dz) * s - r) / dz;
    const nz = -dr * Math.cos(angle);
    return new THREE.Vector3(nx, ny, nz).normalize();
  };

  // ── Anchor Bus（最小点位，仅支持两个尾部引擎）──
  ctx._engineHeatPoints = [
    { x: -cageR * 0.35, y: 0, z: 0.50 * L, radius: cageR * 0.30 },
    { x: cageR * 0.35, y: 0, z: 0.50 * L, radius: cageR * 0.30 },
  ];
  ctx._ventPoints = [{ x: 0, y: cageR + 0.004 * s, z: 0, nx: 0, ny: 1, nz: 0, size: cageR * 0.4 }];

  // ── Anchor Bus：_sanshaDims（笼子/核心几何锚点，供武器/面板/散热/能量线消费）──
  //   verts:     笼子 20 个顶点（世界坐标，半径 cageR）→ 武器炮塔挂点 / 能量线终点
  //   faceDirs:  12 个面法向（单位向量）→ 五边形面板朝向 / 巡洋级能量线终点
  //   faceInset: 面中心到球心距离（十二面体内切半径 = 外接半径 × 0.7947）
  //   coreEuler: 核心立方体姿态 → 散热片与核心同姿态
  ctx._sanshaDims = {
    cageR,
    coreR,
    coreEuler: new THREE.Euler(0.3, 0.5, 0),
    verts: cageVerts,
    faceDirs: dodecFaceDirs(),
    faceInset: cageR * 0.7947,
  };

  g.userData.hullRead = {
    ...ctx.hullProfile, len: ctx.hullProfile.len, noseFat, mid, tail,
    wingSpan: cageR * 1.1,
  };

  return g;
}
