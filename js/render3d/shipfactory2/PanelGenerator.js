// PanelGenerator.js — 贴合船体表面的装甲板（Surface Panels）
// 职责：返回包含「扁平圆角板，沿法线贴附，钢色」的 THREE.Group。
// 与 ArmorGenerator 的边界划分（Phase 4 Commit 1）：
//   Armor = 航行灯 + 舰级专属上层建筑（dagger/gunboat/cruiser/fortress）+ 混血红色武装
//   Panel = 贴合表面的装甲板（视觉层次感，PROCEDURAL_SHIP_GUIDE §5）
//
// Phase 4 Commit 3：暴露 panelInfos Anchor。
//   每个 panel 的 {x, y, z, w, d, phi} 写入 g.userData.panelInfos，
//   供 ShipFactory2（Anchor Bus）提取后转发给 HatchGenerator 消费。
//
// 不依赖任何配置文件（AI Rules §19），只读 ctx。
// 材质统一走 Materials.js（AI Rules §6）。
import * as THREE from "three";
import { rbox } from "./Materials.js";
import { MaterialFactory } from "./MaterialFactory.js";

// ── Armor 路线：box hull 全表面覆盖装甲板 ──
// Player Armor 的核心视觉：不是几块小板，是整面装甲分区。
// 顶面/侧面/底面均覆盖，每块板暴露 panelInfos 供 Hatch 消费。
function generateArmorPanels(ctx, g, plateMat) {
  const { s } = ctx;
  const dims = ctx._fortressDims;
  if (!dims) return g;
  const { hullW, hullH, hullLen } = dims;

  const scaleMul = ctx.style.panelScale || 1.0;

  // ── 工业铆钉：每块装甲板四角加暗钢小球，强化机械装配感（C 方向细节密度）──
  const rivetMat = MaterialFactory.get("hatchHandle", ctx);
  const addRivets = (plate, w, h, d) => {
    const rr = Math.max(0.013 * s, Math.min(w, h, d) * 0.28);
    const cx = w * 0.36, cy = h * 0.36, cz = d * 0.36;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(rr, 6, 5), rivetMat);
      rivet.position.set(sx * cx, sy * cy, sz * cz);
      plate.add(rivet);
    }
  };
  const thickMul = 1 + Math.max(0, (ctx.style.armorThickness || 0.5) - 0.5) * 0.6;
  const density = ctx.style.panelDensity || 1.0;

  const body = ctx.profile.hull.body;
  // z 方向 zone 数量（按舰级）
  let zZones;
  if (body === "dagger")       zZones = 2;
  else if (body === "gunboat") zZones = 3;
  else if (body === "cruiser") zZones = 4;
  else                         zZones = 5;
  zZones = Math.max(2, Math.round(zZones * density));

  const plateT = 0.05 * s * thickMul;      // 板厚
  const zStart = -hullLen * 0.42;
  const zEnd = hullLen * 0.36;
  const zStep = zZones > 1 ? (zEnd - zStart) / (zZones - 1) : 0;
  const plateD = zStep > 0 ? zStep * 0.72 : hullLen * 0.25;  // 单块板 z 深度

  // ── 顶面装甲板（2 排：左 + 右）──
  const topY = hullH * 0.5 + plateT * 0.5;
  const topPlateW = hullW * 0.36 * Math.min(scaleMul, 1.4);
  for (let i = 0; i < zZones; i++) {
    const z = zStart + zStep * i;
    for (const side of [-1, 1]) {
      const px = side * hullW * 0.22;
      const plate = rbox(topPlateW, plateT, plateD, 0.02 * s, plateMat, [px, topY, z]);
      g.add(plate);
      addRivets(plate, topPlateW, plateT, plateD);
      g.userData.panelInfos.push({ x: px, y: topY, z, w: topPlateW, d: plateD, phi: 0 });
    }
  }

  // ── 侧面装甲板（每侧 2 排：上 + 下）──
  const sidePlateH = hullH * 0.32 * Math.min(scaleMul, 1.4);
  for (let i = 0; i < zZones; i++) {
    const z = zStart + zStep * i;
    for (const side of [-1, 1]) {
      const px = side * (hullW * 0.5 + plateT * 0.5);
      for (const yOff of [hullH * 0.18, -hullH * 0.18]) {
        const plate = rbox(plateT, sidePlateH, plateD, 0.02 * s, plateMat, [px, yOff, z]);
        g.add(plate);
        addRivets(plate, plateT, sidePlateH, plateD);
        g.userData.panelInfos.push({ x: px, y: yOff, z, w: sidePlateH, d: plateD, phi: side * Math.PI / 2 });
      }
    }
  }

  // ── 底面装甲板（较少，1 排）──
  const botY = -hullH * 0.5 - plateT * 0.5;
  const botZones = Math.max(1, Math.floor(zZones * 0.6));
  const botPlateW = hullW * 0.30 * Math.min(scaleMul, 1.4);
  const botStep = botZones > 1 ? (zEnd - zStart) / (botZones - 1) : 0;
  for (let i = 0; i < botZones; i++) {
    const z = zStart + botStep * i;
    const plate = rbox(botPlateW, plateT, plateD * 0.85, 0.02 * s, plateMat, [0, botY, z]);
    g.add(plate);
    addRivets(plate, botPlateW, plateT, plateD * 0.85);
    g.userData.panelInfos.push({ x: 0, y: botY, z, w: botPlateW, d: plateD * 0.85, phi: Math.PI });
  }

  return g;
}

// ── 鳐鱼路线（blood overloaded）：椭圆截面曲面贴板 ──
// 用 ctx.sampleHullSurface 把装甲板贴到鳐鱼曲面（背板 + 两舷板），避免硬套圆形浮空。
function generateMantaPanels(ctx, g, plateMat) {
  const { s } = ctx;
  const Wof = ctx._mantaW, Hof = ctx._mantaH, zN = ctx._mantaZN, zT = ctx._mantaZT;
  if (!Wof) return g;

  const scaleMul = ctx.style.panelScale || 1.0;
  const thickMul = 1 + Math.max(0, (ctx.style.armorThickness || 0.5) - 0.5) * 0.6;
  const density = ctx.style.panelDensity || 1.0;
  const zones = Math.max(3, Math.round((4 + ctx.classTier * 2) * density));
  const zSpan = zT - zN;

  for (let i = 0; i < zones; i++) {
    const z = zN + zSpan * (0.18 + 0.64 * i / (zones - 1)); // 避开头尾尖点
    const Wz = Wof(z), Hz = Hof(z);
    const off = Math.max(Hz, 0.02 * s) * 0.04 + 0.004 * s;

    // 背板（顶部 φ=0，平贴）
    const top = ctx.sampleHullSurface(z, 0, off);
    const pw = Math.min(0.34 * s * scaleMul, Wz * 0.55);
    const pd = Math.min(0.16 * s * scaleMul, zSpan * 0.1);
    const pt = 0.045 * s * thickMul;
    const topPlate = rbox(pw, pt, pd, 0.02 * s, plateMat, [top.x, top.y, top.z]);
    g.add(topPlate);
    g.userData.panelInfos.push({ x: top.x, y: top.y, z: top.z, w: pw, d: pd, phi: 0 });

    // 两舷板（φ = ±1.0，法线径向）
    for (const phi of [-1.0, 1.0]) {
      const p = ctx.sampleHullSurface(z, phi, off);
      const fw = Math.min(0.24 * s * scaleMul, Hz * 1.6 + 0.05 * s);
      const fd = pd;
      const ft = 0.04 * s * thickMul;
      const plate = rbox(fw, ft, fd, 0.018 * s, plateMat, [p.x, p.y, p.z]);
      plate.rotation.z = -phi;
      g.add(plate);
      g.userData.panelInfos.push({ x: p.x, y: p.y, z: p.z, w: fw, d: fd, phi });
    }
  }
  return g;
}

// ── Sansha 路线（modular）：五边形装甲板贴在十二面体笼子面上 ──
// 从 _sanshaDims 取真实面顶点（每面 5 个），向面心收缩 72% 生成五边形板，
// 完美对齐笼框边缘。面数随舰级 2/4/6/8（x 镜像成对选面，保持对称）。
function generateSanshaPanels(ctx, g, plateMat) {
  const dims = ctx._sanshaDims;
  const { s } = ctx;
  const { verts, faceDirs } = dims;
  const tier = ctx.classTier;
  const PHI = (1 + Math.sqrt(5)) / 2;

  // 面对（x 镜像）优先级顺序：前侧对 → 后侧对 → 上方对 → 下方对
  const facePairOrder = [
    [[PHI, 0, -1], [-PHI, 0, -1]],
    [[PHI, 0, 1], [-PHI, 0, 1]],
    [[1, PHI, 0], [-1, PHI, 0]],
    [[1, -PHI, 0], [-1, -PHI, 0]],
  ];
  const pairCount = [1, 2, 3, 4][tier];

  // 目标方向 → 最接近的真实面法向
  const nearestFace = (x, y, z) => {
    const d = new THREE.Vector3(x, y, z).normalize();
    let best = faceDirs[0], bd = -2;
    for (const f of faceDirs) {
      const t = f.dot(d);
      if (t > bd) { bd = t; best = f; }
    }
    return best;
  };

  const lift = 0.012 * s;   // 沿法线微抬升，避免与笼框线 z-fighting
  for (let pi = 0; pi < pairCount; pi++) {
    for (const fd of facePairOrder[pi]) {
      const dir = nearestFace(fd[0], fd[1], fd[2]);

      // 该面的 5 个顶点 = 与面法向点积最大的 5 个笼顶点
      const ring = verts
        .map(v => ({ v, dot: v.clone().normalize().dot(dir) }))
        .sort((a, b) => b.dot - a.dot)
        .slice(0, 5)
        .map(o => o.v);

      // 面心 + 绕法向排序（保证五边形顶点次序连续）
      const center = ring.reduce((acc, v) => acc.add(v), new THREE.Vector3()).multiplyScalar(1 / 5);
      const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
      const w = new THREE.Vector3().crossVectors(dir, u);
      ring.sort((a, b) => {
        const pa = a.clone().sub(center), pb = b.clone().sub(center);
        return Math.atan2(pa.dot(w), pa.dot(u)) - Math.atan2(pb.dot(w), pb.dot(u));
      });

      // 收缩 72% + 抬升 → 五边形扇面
      const pos = [];
      for (const v of ring) {
        const p = center.clone().add(v.clone().sub(center).multiplyScalar(0.72)).addScaledVector(dir, lift);
        pos.push(p.x, p.y, p.z);
      }
      let idx = [0, 1, 2, 0, 2, 3, 0, 3, 4];
      // 保证法线朝外（第一个三角的法线与面法向同向，否则翻转绕序）
      const p0 = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const p1 = new THREE.Vector3(pos[3], pos[4], pos[5]);
      const p2 = new THREE.Vector3(pos[6], pos[7], pos[8]);
      const n = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0));
      if (n.dot(dir) < 0) idx = [0, 2, 1, 0, 3, 2, 0, 4, 3];

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      g.add(new THREE.Mesh(geo, plateMat));
    }
  }
  return g;
}

export function generatePanels(ctx) {
  const { s, L } = ctx;

  const g = new THREE.Group();
  g.name = "panels";
  g.userData.panelInfos = [];

  const plateMat = MaterialFactory.get("panelPlate", ctx);

  // ── Sansha 路线（modular）：五边形板贴笼子面 ──
  if (ctx.civ && ctx.civ.hullType === "modular" && ctx._sanshaDims) {
    return generateSanshaPanels(ctx, g, plateMat);
  }

  // ── 鳐鱼路线（blood overloaded）：椭圆曲面贴板 ──
  if (ctx.civ && ctx.civ.hullType === "overloaded" && ctx._mantaW) {
    return generateMantaPanels(ctx, g, plateMat);
  }

  // ── Armor 路线：box hull 全表面覆盖 ──
  if (ctx.civ && ctx.civ.hullType === "box" && ctx._fortressDims) {
    return generateArmorPanels(ctx, g, plateMat);
  }

  // ── Shield / 其他路线：原有 lathe 表面逻辑 ──
  // Phase 5 C3-A：panelDensity 控制面板行数；Phase 5 大船区分：zone 数随舰级递增（2/3/4/5）
  const baseZone = 2 + ctx.classTier;
  const zoneCount = Math.max(2, Math.round(baseZone * ctx.style.panelDensity));

  // Phase 5 Rework：panelScale 控制面板尺寸倍率（Armor=1.8 巨大分区）
  // armorThickness 控制板厚（Armor=0.8 → thickMul=1.18）
  const scaleMul = ctx.style.panelScale || 1.0;
  const thickMul = 1 + Math.max(0, (ctx.style.armorThickness || 0.5) - 0.5) * 0.6;

  const plateZones = [];
  const zStart = -0.05 * L, zEnd = 0.18 * L;
  for (let i = 0; i < zoneCount; i++) {
    plateZones.push(zStart + (zEnd - zStart) * i / Math.max(1, zoneCount - 1));
  }

  for (const z of plateZones) {
    const r = ctx.radiusAt(z) * 0.99;
    const localR = ctx.radiusAt(z);
    for (const side of [-1, 1]) {
      const phi = side * 0.62;
      const w = Math.min(0.32 * s * scaleMul, localR * 0.55);
      const h = Math.min(0.22 * s * scaleMul, localR * 0.42);
      const t = 0.042 * s * thickMul;
      const px = r * Math.sin(phi);
      const py = r * Math.cos(phi);
      const plate = rbox(w, t, h, 0.015 * s, plateMat, [px, py, z]);
      plate.rotation.z = -phi; // 薄面贴合径向法线
      g.add(plate);

      // Phase 4 Commit 3：暴露 Anchor 数据供 HatchGenerator 消费
      g.userData.panelInfos.push({ x: px, y: py, z, w, d: h, phi });
    }
  }

  return g;
}
