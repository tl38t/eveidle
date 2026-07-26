// ArchaeologyHull.js — Archaeology / Explorer 探索扫描舰（E · 门架+花瓣方案）
//
// 设计：「门架 + 花瓣」——中央脊 + 圆润鼻锥 + 船头探针环（花瓣数=2×高槽数）
//   + 悬浮扫描碟（同心环+辐条+发光节点）+ 两侧浮筒舱 + 巡洋以上表面细节。
//   引擎由默认 Anchor Bus 自动挂载；舱门由通用管线按条件生成。
import * as THREE from "three";
import { addPart } from "../Materials.js";
import { MaterialFactory } from "../MaterialFactory.js";

function getTierKey(ctx) {
  const cls = (ctx.spec && ctx.spec.hull) || "";
  if (cls.includes("capital")) return "capital";
  if (cls.includes("battleship")) return "battleship";
  if (cls.includes("cruiser")) return "cruiser";
  if (cls.includes("destroyer")) return "destroyer";
  return "frigate";
}

function getHighSlots(ctx) {
  const tier = getTierKey(ctx);
  return { frigate:2, destroyer:3, cruiser:3, battleship:4, capital:4 }[tier] || 2;
}

// 船头探针环：花瓣漂浮在船头周围一圈，细支柱连到船体，叶尖朝外前方发光
function bowPetals(g, ctx, R, noseZ) {
  const { L } = ctx;
  const petals = getHighSlots(ctx) * 2;
  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const accentMat = MaterialFactory.get("sensorDish", ctx);
  const glowMat = MaterialFactory.getGlow("ribbon", ctx, 1.6);

  function petalShape(len, width) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -len*0.5);
    shape.bezierCurveTo(width*0.15, -len*0.35, width*0.45, -len*0.08, width*0.5, 0);
    shape.bezierCurveTo(width*0.35, len*0.12, width*0.08, len*0.30, 0, len*0.48);
    shape.bezierCurveTo(-width*0.08, len*0.30, -width*0.35, len*0.12, -width*0.5, 0);
    shape.bezierCurveTo(-width*0.45, -len*0.08, -width*0.15, -len*0.35, 0, -len*0.5);
    return new THREE.ShapeGeometry(shape, 8);
  }

  const pLen = L * 0.15;
  const pWid = R * 0.30;
  const petalGeo = petalShape(pLen, pWid);
  petalGeo.rotateX(-Math.PI/2);

  const ringR = R * 0.62;          // 收紧贴近船体
  const yComp = 0.50;
  const fwd  = L * 0.06;
  const zTilt = 0.4;
  const hubZ = noseZ + fwd;
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const rx = Math.cos(a) * ringR;
    const ry = Math.sin(a) * ringR * yComp;
    const base = new THREE.Vector3(rx, ry, hubZ);
    const hub  = new THREE.Vector3(0, 0, hubZ);

    // 连接支柱（防 NaN）
    const strutDir = base.clone().sub(hub).normalize();
    const strutQuat = new THREE.Quaternion();
    const dotUp = up.dot(strutDir);
    if (dotUp < -0.9999) {
      strutQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    } else {
      strutQuat.setFromUnitVectors(up, strutDir);
    }
    const mid = base.clone().add(hub).multiplyScalar(0.5);
    const slen = base.distanceTo(hub);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.045, R * 0.045, slen, 8), steelMat);
    strut.position.copy(mid);
    strut.quaternion.copy(strutQuat);
    g.add(strut);

    // 探针花瓣
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * yComp, -zTilt).normalize();
    const grp = new THREE.Group();
    grp.position.copy(base);
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    const blade = new THREE.Mesh(petalGeo, accentMat);
    blade.material.side = THREE.DoubleSide;
    grp.add(blade);
    const tipBall = new THREE.Mesh(new THREE.SphereGeometry(R * 0.06, 10, 10), glowMat);
    tipBall.position.set(0, 0, -pLen * 0.5);
    grp.add(tipBall);
    g.add(grp);
  }
}

export function generateArchaeologyHull(ctx) {
  const { s, L } = ctx;
  const p = ctx.civ.hullParams;
  const midR = ctx.hullProfile.mid * s;
  const wMul = p.widthMul || 0.95;

  // 脊半径（直接用 midR，与候选页的 R = TIER*sc 一致）
  const R = midR;

  const g = new THREE.Group();
  g.name = "hull";

  const hullMat = ctx.hullMat;
  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const accentMat = MaterialFactory.get("sensorDish", ctx);
  const glowMat = MaterialFactory.getGlow("ribbon", ctx, 1.6);
  const darkMat = MaterialFactory.get("armorDeck", ctx);

  const noseZ = -L * 0.22;   // 鼻锥前端（进一步缩短）
  const tailZ = L * 0.28;    // 尾罩后端（进一步缩短）

  // ══ 中央脊（进一步缩短）══
  addPart(g, new THREE.CylinderGeometry(R * 0.55, R * 0.60, L * 0.55, 14),
    hullMat, [0, 0, 0], [Math.PI / 2, 0, 0]);

  // ══ 子弹头鼻锥（锥尖朝 -Z 船头方向）══
  addPart(g, new THREE.ConeGeometry(R * 0.55, L * 0.14, 18), hullMat,
    [0, 0, noseZ - L * 0.07], [-Math.PI / 2, 0, 0]).scale.set(1, 0.9, 1);

  // ══ 船头探针环 ══
  bowPetals(g, ctx, R, noseZ);

  // ══ 悬浮扫描碟（B 加沟边：厚碟 + 凸唇 + 顶刻槽）══
  const dishZ = L * 0.06;
  const dishY = R * 0.60 + L * 0.08;
  const dishRAd = R * 1.20;
  const dishPos = [0, dishY, dishZ];

  // 碟盘主体（加厚：R*0.16 → R*0.30）
  addPart(g, new THREE.CylinderGeometry(R * 0.07, dishRAd, R * 0.30, 28), accentMat, dishPos);
  // 外缘凸唇（粗大 Torus = 沟边，dark 色突出）
  addPart(g, new THREE.TorusGeometry(dishRAd, R * 0.08, 8, 32), darkMat, dishPos, [Math.PI / 2, 0, 0]);
  // 外缘发光环（薄，嵌在唇内侧）
  addPart(g, new THREE.TorusGeometry(dishRAd * 0.94, R * 0.04, 8, 32), glowMat, dishPos, [Math.PI / 2, 0, 0]);
  // 同心内环（两道）
  addPart(g, new THREE.TorusGeometry(dishRAd * 0.88, R * 0.03, 8, 30), steelMat, dishPos, [Math.PI / 2, 0, 0]);
  addPart(g, new THREE.TorusGeometry(dishRAd * 0.70, R * 0.024, 8, 28), steelMat, dishPos, [Math.PI / 2, 0, 0]);
  // 8 条径向刻槽（深色凸纹，与辐条错位 22.5° 互插）
  const slotLen = dishRAd * 0.80;
  const slotGeo = new THREE.BoxGeometry(slotLen, R * 0.008, R * 0.025);
  slotGeo.translate(dishRAd * 0.40, 0, 0);
  for (let s = 0; s < 8; s++) {
    const sa = (s / 8) * Math.PI * 2 + Math.PI / 8;
    const slot = new THREE.Mesh(slotGeo, darkMat);
    slot.position.set(dishPos[0], dishPos[1] + R * 0.16, dishPos[2]);
    slot.rotation.y = sa;
    g.add(slot);
  }
  // 径向辐条（8 根，抬高贴碟面）
  const spokeLen = dishRAd * 0.66;
  const spokeGeo = new THREE.BoxGeometry(spokeLen, R * 0.025, R * 0.03);
  spokeGeo.translate(dishRAd * 0.55, R * 0.08, 0);
  for (let s = 0; s < 8; s++) {
    const sa = (s / 8) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, steelMat);
    spoke.position.set(dishPos[0], dishPos[1], dishPos[2]);
    spoke.rotation.y = sa;
    g.add(spoke);
  }
  // 中心枢纽加高 + 顶部发光节点
  addPart(g, new THREE.CylinderGeometry(R * 0.13, R * 0.10, R * 0.35, 16), darkMat, dishPos);
  addPart(g, new THREE.SphereGeometry(R * 0.09, 12, 12), glowMat,
    [dishPos[0], dishPos[1] + R * 0.20, dishPos[2]]);

  // ══ 两侧浮筒传感器舱 ══
  for (const side of [-1, 1]) {
    addPart(g, new THREE.BoxGeometry(R * 0.5, R * 0.12, R * 0.12), steelMat,
      [side * R * 0.7, 0, 0]);
    addPart(g, new THREE.CapsuleGeometry(R * 0.3, L * 0.3, 8, 16), hullMat,
      [side * R * 1.0, 0, 0], [Math.PI / 2, 0, 0]);
    addPart(g, new THREE.BoxGeometry(R * 0.1, R * 0.05, L * 0.3), glowMat,
      [side * R * 1.0, R * 0.3, 0]);
  }

  // ══ 按舰级的设备差异 ══
  // 特色阶梯：护卫/驱逐 = 侦察（现状）→ 巡洋 = 科考 → 战列 = 平台 → 旗舰 = 档案馆
  const tierKey = getTierKey(ctx);
  const isCruiser  = tierKey === "cruiser";
  const isBattleship = tierKey === "battleship";
  const isCapital    = tierKey === "capital";

  // 巡洋及以上：基础细节（纵梁 + 辉光条 + 栅格 + 前缘环）
  if (isCruiser || isBattleship || isCapital) {
    const big = isCapital ? 1.25 : (isBattleship ? 1.1 : 1.0);
    // 脊顶纵梁
    for (const zx of [-L * 0.14, -L * 0.04, L * 0.06, L * 0.14]) {
      addPart(g, new THREE.BoxGeometry(R * 0.10 * big, R * 0.18 * big, L * 0.07),
        steelMat, [0, R * 0.60, zx]);
    }
    // 鼻锥两侧辉光条
    for (const side of [-1, 1]) {
      addPart(g, new THREE.BoxGeometry(R * 0.05, R * 0.05, L * 0.14), glowMat,
        [side * R * 0.34, 0, -L * 0.20]);
    }
    // 侧面散热栅格
    for (const zx of [-L * 0.04, L * 0.04, L * 0.14]) {
      for (const side of [-1, 1]) {
        addPart(g, new THREE.BoxGeometry(R * 0.04, R * 0.26, R * 0.05), steelMat,
          [side * R * 0.55, 0, zx]);
      }
    }
    // 船头罩前缘 accent 环
    addPart(g, new THREE.TorusGeometry(R * 0.55 * big, R * 0.02, 8, 20), accentMat,
      [0, 0, noseZ], [Math.PI / 2, 0, 0]);
  }

  // 巡洋：「科考」—— 脊前 2 发光眼 + 后部细桅
  if (isCruiser) {
    for (const side of [-1, 1]) {
      addPart(g, new THREE.SphereGeometry(R * 0.08, 10, 10), glowMat,
        [side * R * 0.25, R * 0.60, -L * 0.14]);
    }
    // 后部细桅（小副传感器）
    const mastZ = L * 0.16;
    const mastH = R * 0.50;
    addPart(g, new THREE.CylinderGeometry(R * 0.03, R * 0.04, mastH, 8), steelMat,
      [0, R * 0.60 + mastH * 0.5, mastZ]);
    addPart(g, new THREE.SphereGeometry(R * 0.05, 10, 10), glowMat,
      [0, R * 0.60 + mastH, mastZ]);
  }

  // 战列：「重型平台」—— 双桅并行 + 浮筒侧挂探针舱
  if (isBattleship) {
    // 后部双桅并行
    const mastZ = L * 0.16;
    const mastH = R * 0.55;
    for (const side of [-1, 1]) {
      addPart(g, new THREE.CylinderGeometry(R * 0.03, R * 0.05, mastH, 8), steelMat,
        [side * R * 0.15, R * 0.60 + mastH * 0.5, mastZ]);
      addPart(g, new THREE.SphereGeometry(R * 0.06, 10, 10), glowMat,
        [side * R * 0.15, R * 0.60 + mastH, mastZ]);
    }
    // 浮筒外侧挂探针舱
    for (const side of [-1, 1]) {
      const px = side * (R * 1.30);
      addPart(g, new THREE.CylinderGeometry(R * 0.04, R * 0.06, R * 0.20, 8), steelMat,
        [px, 0, L * 0.04]);
      addPart(g, new THREE.SphereGeometry(R * 0.07, 10, 10), glowMat,
        [px, 0, L * 0.04 + R * 0.12]);
    }
  }

  // 旗舰：「档案馆」—— 三碟三角阵 + 指挥台 + 双层壳
  if (isCapital) {
    // 前二碟（小碟，在前方两侧偏上）
    for (const side of [-1, 1]) {
      const fwdDishZ = -L * 0.10;
      const fwdDishY = R * 0.70;
      const fwdR = R * 0.35;
      addPart(g, new THREE.TorusGeometry(fwdR, R * 0.04, 8, 20), glowMat,
        [side * R * 0.45, fwdDishY, fwdDishZ], [Math.PI / 2, 0, 0]);
    }
    // 后一碟（在原主碟后方再叠一层）
    const rearDishZ = L * 0.18;
    const rearDishY = R * 0.50;
    const rearR = R * 0.50;
    addPart(g, new THREE.TorusGeometry(rearR, R * 0.04, 8, 20), glowMat,
      [0, rearDishY, rearDishZ], [Math.PI / 2, 0, 0]);
    // 指挥台（中央脊顶方块 + 信号灯）
    addPart(g, new THREE.BoxGeometry(R * 0.20, R * 0.18, R * 0.15), steelMat,
      [0, R * 0.78, 0]);
    addPart(g, new THREE.SphereGeometry(R * 0.06, 10, 10), glowMat,
      [0, R * 0.96, 0]);
    // 双层壳：脊两侧装甲条
    for (const side of [-1, 1]) {
      addPart(g, new THREE.BoxGeometry(R * 0.04, R * 0.65, L * 0.40), darkMat,
        [side * R * 0.65, 0, 0]);
    }
    // 侧向探针阵列（每侧 3 个）
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const pz = -L * 0.08 + i * L * 0.12;
        addPart(g, new THREE.SphereGeometry(R * 0.04, 8, 8), glowMat,
          [side * R * 1.15, R * 0.30, pz]);
      }
    }
  }

  // ══ 尾罩 ══
  addPart(g, new THREE.BoxGeometry(R * 0.7, R * 0.60, L * 0.06), darkMat,
    [0, 0, tailZ]);

  // ══ Anchor Bus：引擎热点（覆盖默认，紧贴尾罩）══
  ctx._engineHeatPoints = [
    { x: -0.28 * s, y: -0.05 * s, z: L * 0.30, radius: 0.14 * s },
    { x:  0.28 * s, y: -0.05 * s, z: L * 0.30, radius: 0.14 * s }
  ];

  // ══ Anchor Bus ══
  ctx._archaeologyDims = { fusR: R, fusLen: L, widthRatio: ctx.profile.hull.widthRatio || 0.85, noseZ, tailZ };

  return g;
}
