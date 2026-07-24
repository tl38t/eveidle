// OverloadedHull.js — Blood Raider：外露心脏改造舰（鳐鱼形 / stingray）
// 视觉语言：菱形钻石盘 + 前伸头鳍(cephalic fins) + 细长尾 + 有厚度躯干 + 腹部外露品红反应器（血核）+ 血管管线。
// 与 player_shield 纺锤 / Fortress 盒 / Skeletal 棱柱 / angel 有机纺锤 / sansha 模块 均异质。
//
// 关键：本文件覆写 ctx.sampleHullSurface / ctx.radiusAt / ctx.normalAt，
// 把表面细节系统（Groove/Ribbon/Vent/Heat/Panel）的投影目标从「圆形截面」改为「鳐鱼椭圆截面」，
// 使刻槽/能量线/通气/散热/装甲板贴合鳐鱼曲面而不浮空。
//
// 血核发光：必须用 blood palette 的品红 glow（getGlow("ribbon")→pal.glow），
//   不能用 getGlow("ring")——那会强制返回固定青蓝 RING_COLOR(0x2ab8f5)，把血石染成蓝色。
import * as THREE from "three";
import { buildBridge } from "./CivHelpers.js";
import { MaterialFactory } from "../MaterialFactory.js";

// 鳐鱼实体几何：椭圆截面（X 半宽 W(z)，Y 半高 H(z)）沿 z 扫掠，头尾封盖（实心不中空）
function buildManta(ctx) {
  const { s, L } = ctx;
  const R = ctx.hullProfile.mid * s;
  const zN = -0.46 * L, zT = 0.46 * L;
  const Wmax = R * 3.2, Hmax = R * 0.66;   // 翼展 ~6.4R（菱形盘），身厚 ~1.32R

  // 菱形钻石盘 + 细尾（stingray）：峰偏前(tp)，盘后缘(td)后收成细尾干
  const tp = 0.30, td = 0.60;
  const Wof = (z) => {
    const t = (z - zN) / (zT - zN);
    let w;
    if (t <= tp) {
      w = 0.06 + 0.94 * Math.pow(t / tp, 0.78);          // 前缘斜边：头尖 → 翼尖
    } else if (t <= td) {
      const u = (t - tp) / (td - tp);
      w = 1.0 - 0.82 * Math.pow(u, 0.92);                // 后缘斜边：翼尖 → 盘尾 (→0.18)
    } else {
      const u = (t - td) / (1 - td);
      w = 0.18 * (1 - u) + 0.03;                         // 细尾干
    }
    return Wmax * Math.max(0.03, w);
  };
  // 盘中央厚、向尾渐薄
  const Hof = (z) => {
    const t = (z - zN) / (zT - zN);
    const body = Math.exp(-Math.pow((t - 0.28) / 0.42, 2));
    return Hmax * (0.12 + 0.88 * body);
  };

  const N = 34, M = 44;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const z = zN + (zT - zN) * (i / N);
    const W = Wof(z), H = Hof(z);
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2;
      pos.push(W * Math.sin(th), H * Math.cos(th), z);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j;
      const b = i * M + ((j + 1) % M);
      const c = (i + 1) * M + j;
      const d = (i + 1) * M + ((j + 1) % M);
      idx.push(a, b, d, a, d, c);
    }
  }
  // ▸ 封头尾盖（消除中空：扫掠管两端开口，需 fan 封住 z=zN 头 / z=zT 尾）
  const headC = pos.length / 3; pos.push(0, 0, zN);
  const tailC = pos.length / 3; pos.push(0, 0, zT);
  for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M;
    idx.push(headC, j, j1);                              // 头盖，法线朝 -z
    idx.push(tailC, N * M + j1, N * M + j);              // 尾盖，法线朝 +z
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // ▸ 内部填实（消除中空感）：生成一个缩小的内芯（~70%尺寸）填充壳体内部，
  //   从外部看不出接缝，但从任何角度都看不到穿壳的空洞。
  const innerPos = [], innerIdx = [];
  const innerScale = 0.68;
  for (let i = 0; i <= N; i++) {
    const z = zN + (zT - zN) * (i / N);
    const W = Wof(z) * innerScale, H = Hof(z) * innerScale;
    for (let j = 0; j < M; j++) {
      const th = (j / M) * Math.PI * 2;
      innerPos.push(W * Math.sin(th), H * Math.cos(th), z);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j;
      const b = i * M + ((j + 1) % M);
      const c = (i + 1) * M + j;
      const d = (i + 1) * M + ((j + 1) % M);
      innerIdx.push(a, b, d, a, d, c);
    }
  }
  // 内芯头尾也封盖
  const ihC = innerPos.length / 3; innerPos.push(0, 0, zN);
  const itC = innerPos.length / 3; innerPos.push(0, 0, zT);
  for (let j = 0; j < M; j++) {
    const j1 = (j + 1) % M;
    innerIdx.push(ihC, j, j1);
    innerIdx.push(itC, N * M + j1, N * M + j);
  }
  const innerGeo = new THREE.BufferGeometry();
  innerGeo.setAttribute("position", new THREE.Float32BufferAttribute(innerPos, 3));
  innerGeo.setIndex(innerIdx);
  innerGeo.computeVertexNormals();

  return { geo, innerGeo, Wof, Hof, zN, zT, Wmax };
}

export function generateOverloadedHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const R = ctx.hullProfile.mid * s;
  const rng = (typeof ctx._rng === "function") ? ctx._rng : Math.random;

  const g = new THREE.Group();
  g.name = "hull";

  // ▸ 鳐鱼实体（外壳双面渲染 + 内芯填实，彻底消除中空透光）
  const m = buildManta(ctx);
  // 血袭者船体用双面材质副本：薄壳从任何角度都不透光
  const solidMat = ctx.hullMat.clone();
  solidMat.side = THREE.DoubleSide;
  const body = new THREE.Mesh(m.geo, solidMat);
  g.add(body);
  const innerBody = new THREE.Mesh(m.innerGeo, solidMat);
  g.add(innerBody);

  // ▸ 中央躯干隆起（manta 厚身）：沿脊线凸起厚块，给侧视明显体积
  const hump = new THREE.Mesh(new THREE.SphereGeometry(R * 0.85, 24, 16), ctx.hullMat);
  hump.scale.set(1.3, 0.78, 2.1);
  hump.position.set(0, R * 0.06, -0.06 * L);
  g.add(hump);
  const keel = new THREE.Mesh(new THREE.SphereGeometry(R * 0.5, 16, 12), ctx.hullMat);
  keel.scale.set(0.95, 0.45, 1.6);
  keel.position.set(0, -m.Hof(-0.1 * L) * 0.5, -0.08 * L);
  g.add(keel);

  // ▸ 头前头鳍（cephalic fins）：一对向前伸的角，鳐鱼最标志性特征
  const finZ = m.zN + 0.02 * (m.zT - m.zN);
  for (const sx of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.05, R * 0.11, R * 1.0, 10), ctx.hullMat);
    fin.position.set(sx * R * 0.34, -R * 0.02, finZ - R * 0.35);
    fin.rotation.x = -1.15;             // 向前上方翘
    fin.rotation.z = sx * 0.18;         // 左右外张
    g.add(fin);
  }

  // ▸ 尾刺（whip tail）：细长尾，强化 stingray 读感
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.02, R * 0.09, L * 0.26, 8), ctx.hullMat);
  tail.position.set(0, 0, m.zT + L * 0.10);
  tail.rotation.x = Math.PI / 2;
  g.add(tail);

  // ▸ 覆写表面采样函数：让细节系统投影到鳐鱼椭圆曲面
  ctx._mantaW = m.Wof; ctx._mantaH = m.Hof; ctx._mantaZN = m.zN; ctx._mantaZT = m.zT;
  ctx.radiusAt = (z) => Math.max(0.02 * R, m.Hof(z));
  ctx.sampleHullSurface = (z, angle, offset = 0) => {
    const W = m.Wof(z), H = m.Hof(z);
    return new THREE.Vector3((W + offset) * Math.sin(angle), (H + offset) * Math.cos(angle), z);
  };
  ctx.normalAt = (z, angle) => {
    const W = m.Wof(z), H = m.Hof(z);
    const nx = Math.sin(angle) / (W * W);
    const ny = Math.cos(angle) / (H * H);
    return new THREE.Vector3(nx, ny, 0).normalize();
  };
  // 修正包围盒，确保 ship-lab 取景包含翼展
  if (ctx.bounds) {
    ctx.bounds.maxRadius = Math.max(ctx.bounds.maxRadius, m.Wmax);
    ctx.bounds.aabb.max.x = Math.max(ctx.bounds.aabb.max.x, m.Wmax);
    ctx.bounds.aabb.min.x = Math.min(ctx.bounds.aabb.min.x, -m.Wmax);
    ctx.bounds.sphere.radius = ctx.bounds.maxRadius;
  }

  // ▸ 重算引擎热点 + 通风点：ShipFactory2 在 hull 生成前用「圆形半径」假设预计算，
  //    对鳐鱼（尾段翼宽→0）会得到浮空引擎/格栅。此处用鳐鱼 W/H 重算，确保 Engine/Vent 贴曲面。
  {
    const zEng = 0.58 * (m.zT - m.zN) + m.zN;   // 盘后缘（细尾干起点附近）
    const Weng = m.Wof(zEng);
    const Heng = m.Hof(zEng);
    const ex = Math.max(0.14 * s, Weng * 0.45);
    const er = Math.max(0.12 * s, Heng * 1.6);
    ctx._engineHeatPoints = [
      { x: -ex, y: 0, z: zEng, radius: er },
      { x:  ex, y: 0, z: zEng, radius: er },
    ];

    const ventPoints = [];
    for (const hp of ctx._engineHeatPoints) {
      const ventZ = hp.z - 0.13 * L;
      const Hz = m.Hof(ventZ);
      ventPoints.push({ x: hp.x, y: Hz + 0.004 * s, z: ventZ, nx: 0, ny: 1, nz: 0, size: hp.radius * 1.6 });
    }
    for (const bvz of [0.10 * L, -0.06 * L, -0.20 * L]) {
      const Hz = m.Hof(bvz);
      if (Hz < 0.15 * s) continue;
      ventPoints.push({ x: 0, y: Hz + 0.004 * s, z: bvz, nx: 0, ny: 1, nz: 0, size: Hz * 1.0 });
    }
    ctx._ventPoints = ventPoints;
  }

  // ▸ 腹部外露反应器（血核）：大号品红辉光球（血石），品红发光 —— 用 pal.glow，绝不用 RING_COLOR
  const reactorR = R * 0.78;
  const reactorZ = -0.10 * L;                   // 盘中央下方
  const reactorY = -R * 0.72;
  const bloodGlow = MaterialFactory.getGlow("ribbon", ctx, 1.9);   // pal.glow = 品红 0xff3a6e
  const reactor = new THREE.Mesh(new THREE.SphereGeometry(reactorR, 26, 18), bloodGlow);
  reactor.position.set(0, reactorY, reactorZ);
  g.add(reactor);
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(reactorR * 0.55, R * 0.5, R * 0.7, 18),
    ctx.hullMat
  );
  neck.position.set(0, reactorY * 0.5, reactorZ);
  neck.rotation.x = Math.PI / 2;
  g.add(neck);
  const cageMat = MaterialFactory.get("engineCasing", ctx);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(reactorR * 1.16, 0.05 * s, 9, 22),
      cageMat
    );
    ring.position.copy(reactor.position);
    ring.rotation.x = Math.PI / 2 + i * 0.45;
    ring.rotation.y = i * 0.6;
    g.add(ring);
  }

  // ▸ 非对称焊接副舱（单侧，保留 overloaded 改造读感；小，不破坏鳐鱼轮廓）
  const nacelle = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.14, R * 0.14, L * 0.18, 14),
    ctx.hullMat
  );
  nacelle.position.set(m.Wmax * 0.42, -m.Hof(-0.1 * L) * 0.4, -0.1 * L);
  nacelle.rotation.z = 0.2;
  nacelle.rotation.x = Math.PI / 2;
  g.add(nacelle);

  // ▸ 血管管线：从腹部表面汇入反应器，部分品红辉光（满密度）
  const conduitMat = MaterialFactory.get("heatSinkBase", ctx);
  const conduitGlow = MaterialFactory.getGlow("ribbon", ctx, 1.3);  // 品红，非蓝
  const pipeCnt = Math.max(3, Math.ceil(5 * (p.pipeDensity || 1.0)));
  for (let i = 0; i < pipeCnt; i++) {
    const zc = -0.1 * L + (rng() - 0.5) * L * 0.4;
    const src = ctx.sampleHullSurface(zc, Math.PI + (rng() - 0.5) * 0.7, 0); // 腹部
    const tgt = reactor.position;
    const mid = src.clone().lerp(tgt, 0.5);
    mid.x *= 1.1;
    const curve = new THREE.QuadraticBezierCurve3(src, mid, tgt);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 16, 0.024 * s, 6, false),
      i % 2 ? conduitGlow : conduitMat
    );
    g.add(tube);
  }

  // ▸ 尾部辅助反应器（小，品红）
  const aux = new THREE.Mesh(new THREE.SphereGeometry(reactorR * 0.42, 14, 10), bloodGlow);
  aux.position.set(0, -m.Hof(m.zT) - R * 0.08, m.zT + L * 0.02);
  g.add(aux);

  buildBridge(ctx, g);

  // 暴露 Anchor Bus：供后续 Weapon(missile) 规避反应器
  ctx._bloodDims = { reactorPos: reactor.position.clone(), reactorR, tanks: [] };

  g.userData.hullRead = {
    ...ctx.hullProfile,
    len: ctx.hullProfile.len,
    noseFat: ctx.hullProfile.noseFat,
    mid: ctx.hullProfile.mid,
    tail: ctx.hullProfile.tail,
    wingSpan: m.Wmax
  };

  return g;
}
