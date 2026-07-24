// OrganicHull.js — Angel Cartel：生物机械文明
// 视觉语言：生长出来的有机体 —— 弯曲脊柱(arch + sway) + 肋骨状分节(几何凸起环) +
//   不对称整合隆起(单侧饱满) + 2~3 片后掠鳍。冷调钢蓝/冰蓝，与其他五族异质：
//   - 不像 shield 旋转纺锤（有脊柱弯曲、非对称）
//   - 不像 armor 方箱（全曲面）
//   - 不像 structure 裸露骨架（有完整"皮"）
//   - 不像 blood 扁平鳐鱼（有体积、弯曲、不对称）
//   - 不像 sansha 重复模块（连续生长）
//
// 关键：覆写 ctx.sampleHullSurface / radiusAt / normalAt，把表面细节系统
//   （Groove/Ribbon/Vent/Heat/Panel/Weapon/Vein/Hero）的投影目标改为弯曲生物曲面，
//   使所有细节贴附不浮空。同时重算 Anchor Bus（_engineHeatPoints / _ventPoints）。
import * as THREE from "three";
import { hullRadiusAt } from "../Utils.js";
import { buildBridge } from "./CivHelpers.js";
import { MaterialFactory } from "../MaterialFactory.js";

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// 生物主体几何：沿弯曲脊柱扫掠的椭圆截面（含肋骨凸起环），头尾封盖 + 内芯填实（防中空）。
function buildBioBody(ctx) {
  const { s, L } = ctx;
  const R = ctx.hullProfile.mid * s;          // 已缩放基准半径（量级随舰级）
  const noseFat = ctx.hullProfile.noseFat, mid = ctx.hullProfile.mid, tail = ctx.hullProfile.tail;
  const wMul = 0.95, hMul = 1.12;             // 略窄高 → 蛋形垂直体，区别于 blood 扁盘
  const zN = -0.5 * L, zT = 0.5 * L;

  // ── 弯曲脊柱 ──
  const archAmp = R * 0.18, swayAmp = R * 0.14, asymAmp = R * 0.16;
  const CL = (z) => {
    const t = Math.min(1, Math.max(0, (z - zN) / (zT - zN)));
    const cy = archAmp * Math.sin(Math.PI * t);                       // 背弓：中段最高，首尾归零
    const cx = swayAmp * Math.sin(2 * Math.PI * t)                    // S 形横向摇摆（首尾归零）
             + asymAmp * Math.sin(Math.PI * t);                       // 单侧整合隆起（中段最满）
    return { cx, cy };
  };

  // ── 平滑半径（无肋骨）── 供采样/Anchor 使用
  const bodyR = (z) => hullRadiusAt(z, noseFat, mid, tail, L) * s;

  // ── 肋骨状分节：在平滑半径上叠加若干高斯凸起环 ──
  const ribStations = [0.14, 0.24, 0.34, 0.44, 0.54, 0.64, 0.74, 0.82].map(t => zN + (zT - zN) * t);
  const ribAmp = 0.055, ribSig = 0.020 * L;
  const ribPulse = (z) => {
    let v = 0;
    for (const zr of ribStations) v += Math.exp(-Math.pow((z - zr) / ribSig, 2));
    return v;
  };

  const N = 44, M = 40;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const z = zN + (zT - zN) * (i / N);
    const cl = CL(z);
    const rEff = bodyR(z) * (1 + ribAmp * ribPulse(z));
    const rx = rEff * wMul, ry = rEff * hMul;
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2;
      pos.push(cl.cx + rx * Math.sin(th), cl.cy + ry * Math.cos(th), z);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M);
      const c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, b, d, a, d, c);
    }
  }
  // 封头尾盖（消除中空）
  const headC = pos.length / 3; pos.push(CL(zN).cx, CL(zN).cy, zN);
  const tailC = pos.length / 3; pos.push(CL(zT).cx, CL(zT).cy, zT);
  for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M;
    idx.push(headC, j, j1);
    idx.push(tailC, N * M + j1, N * M + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // 内芯（平滑、缩 0.7）填实，彻底防中空透光
  const innerPos = [], innerIdx = [];
  for (let i = 0; i <= N; i++) {
    const z = zN + (zT - zN) * (i / N);
    const cl = CL(z);
    const rEff = bodyR(z) * 0.7;
    const rx = rEff * wMul, ry = rEff * hMul;
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2;
      innerPos.push(cl.cx + rx * Math.sin(th), cl.cy + ry * Math.cos(th), z);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + ((j + 1) % M);
      const c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
      innerIdx.push(a, b, d, a, d, c);
    }
  }
  const ihC = innerPos.length / 3; innerPos.push(CL(zN).cx, CL(zN).cy, zN);
  const itC = innerPos.length / 3; innerPos.push(CL(zT).cx, CL(zT).cy, zT);
  for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M;
    innerIdx.push(ihC, j, j1);
    innerIdx.push(itC, N * M + j1, N * M + j);
  }
  const innerGeo = new THREE.BufferGeometry();
  innerGeo.setAttribute("position", new THREE.Float32BufferAttribute(innerPos, 3));
  innerGeo.setIndex(innerIdx);
  innerGeo.computeVertexNormals();

  return { geo, innerGeo, CL, bodyR, wMul, hMul, zN, zT, R, ribCount: ribStations.length };
}

// 单片后掠鳍：沿 root(船体表面)→tip 的二次贝塞尔脊线，横展宽度向尖端渐细的飘带网格。
function buildFin(ctx, rootZ, rootAngle, tip, bow, chord, seg = 18) {
  const root = ctx.sampleHullSurface(rootZ, rootAngle, 0.002 * ctx.s);
  const mid = root.clone().lerp(tip, 0.5).add(bow);
  const spine = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, u = 1 - t;
    spine.push(new THREE.Vector3(
      u * u * root.x + 2 * u * t * mid.x + t * t * tip.x,
      u * u * root.y + 2 * u * t * mid.y + t * t * tip.y,
      u * u * root.z + 2 * u * t * mid.z + t * t * tip.z
    ));
  }
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = spine[i];
    const pp = spine[Math.max(0, i - 1)], pn = spine[Math.min(seg, i + 1)];
    const T = pn.clone().sub(pp); if (T.lengthSq() < 1e-9) T.set(0, 0, 1); T.normalize();
    let Nv = new THREE.Vector3().crossVectors(T, UP);
    if (Nv.lengthSq() < 1e-6) Nv = new THREE.Vector3().crossVectors(T, RIGHT);
    Nv.normalize();
    const half = chord * 0.5 * Math.sin(Math.PI * Math.min(1, 0.12 + 0.8 * t)) * (1 - 0.45 * t);
    const e1 = p.clone().addScaledVector(Nv, half);
    const e2 = p.clone().addScaledVector(Nv, -half);
    pos.push(e1.x, e1.y, e1.z, e2.x, e2.y, e2.z);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function generateOrganicHull(ctx) {
  const { s, L } = ctx;
  const tier = ctx.classTier;
  const p = ctx.civ.hullParams;
  const g = new THREE.Group();
  g.name = "hull";

  const b = buildBioBody(ctx);
  const { CL, bodyR, wMul, hMul, zN, zT, R } = b;
  const finScale = 1 + 0.10 * tier;

  // 双面材质副本：薄壳从任何角度都不透光
  const solidMat = ctx.hullMat.clone();
  solidMat.side = THREE.DoubleSide;
  g.add(new THREE.Mesh(b.geo, solidMat));
  g.add(new THREE.Mesh(b.innerGeo, solidMat));

  // ── 不对称整合隆起（单侧生长荚舱，非疣）──
  const podZ = -0.04 * L;
  const clP = CL(podZ), rbP = bodyR(podZ);
  const pod = new THREE.Mesh(new THREE.SphereGeometry(rbP * 0.5, 16, 12), solidMat);
  pod.scale.set(0.7, 0.95, 1.5);
  pod.position.set(clP.cx + rbP * wMul * 0.75, clP.cy + rbP * hMul * 0.05, podZ);
  g.add(pod);

  // ── 后掠鳍：右舷大、左舷略小（不对称）──
  const rightRoot = new THREE.Vector3(); // 占位，实际由 sampleHullSurface 算
  {
    const rz = -0.04 * L;
    const rootR = ctx.sampleHullSurface(rz, Math.PI / 2, 0);
    const tipR = new THREE.Vector3(rootR.x + R * 2.3 * finScale, rootR.y - R * 0.2 * finScale, zT * 0.5);
    const bowR = new THREE.Vector3(R * 0.3 * finScale, -R * 0.15 * finScale, 0);
    const finR = new THREE.Mesh(buildFin(ctx, rz, Math.PI / 2, tipR, bowR, R * 0.95 * finScale), solidMat);
    g.add(finR);
  }
  {
    const rz = -0.02 * L;
    const rootL = ctx.sampleHullSurface(rz, -Math.PI / 2, 0);
    const tipL = new THREE.Vector3(rootL.x - R * 2.0 * finScale, rootL.y - R * 0.15 * finScale, zT * 0.52);
    const bowL = new THREE.Vector3(-R * 0.25 * finScale, -R * 0.1 * finScale, 0);
    const finL = new THREE.Mesh(buildFin(ctx, rz, -Math.PI / 2, tipL, bowL, R * 0.82 * finScale), solidMat);
    g.add(finL);
  }
  // 背鳍（中线上方，后掠）
  {
    const rz = -0.10 * L;
    const rootD = ctx.sampleHullSurface(rz, 0, 0);
    const tipD = new THREE.Vector3(rootD.x, rootD.y + R * 1.5 * finScale, zT * 0.42);
    const bowD = new THREE.Vector3(0, R * 0.15 * finScale, -R * 0.2 * finScale);
    const finD = new THREE.Mesh(buildFin(ctx, rz, 0, tipD, bowD, R * 0.7 * finScale), solidMat);
    g.add(finD);
  }

  // ── 内部冰蓝「心脏」辉光（小而内嵌，区别于 blood 外露大血核）──
  const heartGlow = MaterialFactory.getGlow("ribbon", ctx, 1.2);   // pal.glow = 冰蓝 0x6fd0ff
  const clh = CL(0.02 * L);
  const heart = new THREE.Mesh(new THREE.SphereGeometry(R * 0.32, 18, 14), heartGlow);
  heart.position.set(clh.cx, clh.cy - R * 0.12, 0.02 * L);
  g.add(heart);

  // ── 高阶专属：背脊骨冠（仅巡洋/战列，沿脊柱隆起的有机骨帆）──
  if (tier >= 2) {
    const isFort = tier >= 3;
    const crestZ0 = -0.30 * L, crestZ1 = isFort ? 0.25 * L : 0.12 * L;
    const crestH = isFort ? R * 0.65 : R * 0.45;
    const crestCh = R * (isFort ? 0.32 : 0.22);  // 弦长
    // 用 buildFin 手法扫一片立式三角帆
    const rz = (crestZ0 + crestZ1) * 0.5;
    const rootC = ctx.sampleHullSurface(rz, 0, 0);
    const tipC = new THREE.Vector3(rootC.x, rootC.y + crestH, (crestZ0 + crestZ1) * 0.5);
    const bowC = new THREE.Vector3(0, crestH * 0.3, (crestZ1 - crestZ0) * 0.15);
    const crest = new THREE.Mesh(buildFin(ctx, rz, 0, tipC, bowC, crestCh), solidMat);
    // 战列额外加第二片小冠（偏后）
    if (isFort) {
      const rz2 = 0.15 * L;
      const rootC2 = ctx.sampleHullSurface(rz2, 0, 0);
      const tipC2 = new THREE.Vector3(rootC2.x, rootC2.y + R * 0.40, 0.18 * L);
      const bowC2 = new THREE.Vector3(0, R * 0.12, -R * 0.15);
      g.add(new THREE.Mesh(buildFin(ctx, rz2, 0, tipC2, bowC2, R * 0.18), solidMat));
    }
    g.add(crest);
  }

  // ── 高阶专属：尾部晶簇触须（仅巡洋/战列，发光有机天线）──
  if (tier >= 2) {
    const isFort = tier >= 3;
    const tentCount = isFort ? 4 : 2;
    const glowMat = MaterialFactory.getGlow("ribbon", ctx, 2.2);
    const tenMat = ctx.hullMat.clone();
    tenMat.side = THREE.DoubleSide;
    for (let i = 0; i < tentCount; i++) {
      const t = (i + 1) / (tentCount + 1);
      const tenZ = zT * (0.82 + t * 0.15);
      const rootTen = ctx.sampleHullSurface(tenZ, 0, 0.01 * s);
      const nrmTen = ctx.normalAt(tenZ, 0);
      const spread = (i - (tentCount - 1) * 0.5) * 0.08 * L;
      const tipTen = rootTen.clone()
        .addScaledVector(nrmTen, R * (isFort ? 0.6 : 0.4))
        .add(new THREE.Vector3(spread, -R * 0.1, (isFort ? 0.08 : 0.04) * L));
      const midTen = rootTen.clone().lerp(tipTen, 0.5)
        .add(new THREE.Vector3(spread * 0.5, R * 0.1, 0.02 * L));
      const curve = new THREE.QuadraticBezierCurve3(rootTen, midTen, tipTen);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.025 * s, 6, false), tenMat));
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.04 * s * (isFort ? 1.3 : 1.0), 8, 6), glowMat);
      node.position.copy(tipTen);
      g.add(node);
    }
  }

  // ── 覆写表面采样函数：细节系统投影到弯曲生物曲面 ──
  ctx.radiusAt = (z) => bodyR(z);
  ctx.sampleHullSurface = (z, angle, offset = 0) => {
    const cl = CL(z), rb = bodyR(z);
    const rx = rb * wMul, ry = rb * hMul;
    return new THREE.Vector3(cl.cx + (rx + offset) * Math.sin(angle), cl.cy + (ry + offset) * Math.cos(angle), z);
  };
  ctx.normalAt = (z, angle) => {
    const cl = CL(z), rb = bodyR(z);
    const rx = rb * wMul, ry = rb * hMul;
    const nx = Math.sin(angle) / (rx * rx);
    const ny = Math.cos(angle) / (ry * ry);
    const dz = 1e-3;
    const drb = (bodyR(z + dz) - rb) / dz;
    const nz = -drb * Math.cos(angle) / ry;
    return new THREE.Vector3(nx, ny, nz).normalize();
  };

  // 修正包围盒：包含鳍展
  if (ctx.bounds) {
    const finReach = R * 2.4 * finScale;
    ctx.bounds.maxRadius = Math.max(ctx.bounds.maxRadius, finReach);
    ctx.bounds.aabb.max.x = Math.max(ctx.bounds.aabb.max.x, finReach);
    ctx.bounds.aabb.min.x = Math.min(ctx.bounds.aabb.min.x, -finReach);
    ctx.bounds.aabb.max.y = Math.max(ctx.bounds.aabb.max.y, finReach);
    ctx.bounds.aabb.min.y = Math.min(ctx.bounds.aabb.min.y, -finReach * 0.6);
    ctx.bounds.sphere.radius = ctx.bounds.maxRadius;
  }

  // ── 重算 Anchor Bus（引擎/通风）贴合弯曲生物曲面 ──
  {
    const zEng = zT * 0.94;
    const clE = CL(zEng), rbE = bodyR(zEng);
    const er = Math.max(0.13 * s, rbE * 0.55);
    ctx._engineHeatPoints = [
      { x: clE.cx - rbE * wMul * 0.42, y: clE.cy, z: zT * 0.96, radius: er },
      { x: clE.cx + rbE * wMul * 0.42, y: clE.cy, z: zT * 0.96, radius: er },
    ];
    const ventPoints = [];
    for (const hp of ctx._engineHeatPoints) {
      const vz = hp.z - 0.12 * L;
      const clV = CL(vz), rbV = bodyR(vz);
      ventPoints.push({ x: hp.x, y: clV.cy + rbV * hMul + 0.004 * s, z: vz, nx: 0, ny: 1, nz: 0, size: hp.radius * 1.6 });
    }
    for (const bvz of [0.10 * L, -0.06 * L, -0.22 * L]) {
      const clV = CL(bvz), rbV = bodyR(bvz);
      if (rbV < 0.15 * s) continue;
      ventPoints.push({ x: 0, y: clV.cy + rbV * hMul + 0.004 * s, z: bvz, nx: 0, ny: 1, nz: 0, size: rbV * 1.0 });
    }
    ctx._ventPoints = ventPoints;
  }

  buildBridge(ctx, g);

  // 暴露 Anchor Bus：供 Weapon(能量透镜)/Vein(冰蓝脉纹)/Hero(生长结构) 复用
  ctx._angelDims = {
    zN, zT, R, wMul, hMul,
    CL, bodyR,
    finAngles: { right: Math.PI / 2, left: -Math.PI / 2, dorsal: 0 },
    finRootZ: { side: -0.04 * L, dorsal: -0.10 * L },
    heartPos: heart.position.clone(),
    ribCount: b.ribCount,
  };

  g.userData.hullRead = {
    ...ctx.hullProfile,
    len: ctx.hullProfile.len,
    noseFat: ctx.hullProfile.noseFat,
    mid: ctx.hullProfile.mid,
    tail: ctx.hullProfile.tail,
    wingSpan: R * 2.4 * finScale
  };

  // ── 悬浮光环（白金天使标志，飘在舰体中前部上方，不接触船体）──
  // 包装在 Group 中用于浮动动画，注册 userData.floaters 供 ship-lab 驱动上下起伏。
  {
    const haloR = R * (0.9 + 0.05 * tier);
    const haloTube = R * 0.06;
    const haloZ = -0.15 * L;          // 中偏前
    const haloY = R * 1.55;           // 悬浮，高于船体最高点 + 明显间隙
    const haloGlow = MaterialFactory.getGlow("ribbon", ctx, 3.0);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(haloR, haloTube, 12, 40), haloGlow);
    halo.position.set(0, 0, 0);       // 相对于 wrapper
    halo.rotation.x = Math.PI / 2;     // 水平朝上，不倾斜
    const wrap = new THREE.Group();
    wrap.position.set(0, haloY, haloZ);
    wrap.add(halo);
    g.add(wrap);
    // 注册为浮动元素：ship-lab animate() 会遍历 activeShip.userData.floaters 驱动 Y 轴起伏
    if (!g.userData.floaters) g.userData.floaters = [];
    g.userData.floaters.push({ grp: wrap, base: { x: 0, y: haloY, z: haloZ }, phase: R * 0.7, ampY: R * 0.08, ampZ: 0 });
  }

  return g;
}
