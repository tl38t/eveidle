// StructureCapitalHull.js — 结构旗舰/超旗：在 SkeletalHull 骨架舰上叠加专属结构
//
// 多方案设计——由选中的 variant 决定：
//   A — 外扩桁架骨架（scaffold truss）
//   B — 外露聚变反应堆（reactor core）
//   C — 悬浮武器塔（weapon platform）
//   D — 反重力推进阵列（gravity drive）
//   E — 舰桥扩展 + 相控阵（command tower）
//   F — 组合方案（A + D + B）
//
// 位置全部基于 ctx._fortressDims（SkeletalHull 暴露的 Anchor Bus）。
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

// ── 获取基础尺寸（优先 _fortressDims；无则从 hullProfile 推算 SkeletalHull 尺寸）──
function getDims(ctx) {
  const dims = ctx._fortressDims;
  if (dims) {
    const { hullW, hullH, hullLen, hullR, midR } = dims;
    const isSuper = (ctx.spec && (ctx.spec.hull === "supercapital" || String(ctx.spec.hull).endsWith("_supercapital")));
    const mounts = (ctx.profile && ctx.profile.hull && ctx.profile.hull.mounts) || (isSuper ? 7 : 6);
    return { hullW, hullH, hullLen, hullR, midR, isSuper, mounts };
  }
  // fallback：根据 hullProfile 推算 SkeletalHull 的 Anchor Bus 等效尺寸
  const midR = (ctx.hullProfile && ctx.hullProfile.mid) ? ctx.hullProfile.mid * ctx.s : ctx.s * 0.5;
  const L = ctx.L || 20;
  const baseR = midR * 0.95;
  const hullW = baseR * 1.6;
  const hullH = baseR * 1.4;
  const hullLen = L * 0.9;
  const hullR = baseR;
  const isSuper = (ctx.spec && (ctx.spec.hull === "supercapital" || String(ctx.spec.hull).endsWith("_supercapital")));
  const mounts = (ctx.profile && ctx.profile.hull && ctx.profile.hull.mounts) || (isSuper ? 7 : 6);
  return { hullW, hullH, hullLen, hullR, midR, isSuper, mounts };
}

// ═══════════════════════════════════════════
//  方案 A — 外扩桁架骨架
// ═══════════════════════════════════════════
function applyVariantA(g, d, ctx) {
  const { hullW, hullH, hullLen, hullR, midR, isSuper } = d;
  const beamMat = MaterialFactory.get("panelPlate", ctx);
  const braceMat = MaterialFactory.get("engineCasing", ctx);

  // 两侧纵向桁架臂（从船头延到船尾，外伸到骨架之外）
  const armLen = hullLen * 0.80;
  const armX = hullW * 0.50 + hullR * 0.30;
  const armY = hullH * 0.10;
  for (const side of [-1, 1]) {
    // 主梁
    addPart(g, new THREE.BoxGeometry(hullR * 0.10, hullR * 0.10, armLen), beamMat,
      [side * armX, armY, 0]);
    // 交叉斜撑（三角形桁架结构）
    for (let i = 0; i < 3; i++) {
      const z0 = -armLen * 0.40 + i * armLen * 0.40;
      const z1 = z0 + armLen * 0.20;
      const diag = new THREE.Mesh(new THREE.BoxGeometry(hullR * 0.04, hullR * 0.04, armLen * 0.24), braceMat);
      diag.position.set(side * armX, armY + hullR * 0.12, (z0 + z1) / 2);
      diag.rotation.x = Math.PI / 4 * side;
      g.add(diag);
    }
    // 末端警示灯
    addPart(g, new THREE.SphereGeometry(hullR * 0.04, 8, 8),
      MaterialFactory.getGlowColor(0xff6600, 2.0), [side * armX, armY, -armLen * 0.40]);
    addPart(g, new THREE.SphereGeometry(hullR * 0.04, 8, 8),
      MaterialFactory.getGlowColor(0xff6600, 2.0), [side * armX, armY, armLen * 0.40]);
  }

  // 超旗：顶部悬臂吊架（T 形桁架横跨船顶）
  if (isSuper) {
    const craneY = hullH * 0.50 + hullR * 0.25;
    const craneW = hullW * 2.0;
    addPart(g, new THREE.BoxGeometry(craneW, hullR * 0.06, hullR * 0.08), beamMat,
      [0, craneY, -hullLen * 0.25]);
    addPart(g, new THREE.BoxGeometry(craneW, hullR * 0.06, hullR * 0.08), beamMat,
      [0, craneY, hullLen * 0.25]);
    // T 形提升柱
    addPart(g, new THREE.BoxGeometry(hullR * 0.08, hullR * 0.30, hullR * 0.08), braceMat,
      [0, craneY - hullR * 0.15, 0]);
    // 警示灯
    for (const side of [-1, 1]) {
      addPart(g, new THREE.SphereGeometry(hullR * 0.03, 6, 6),
        MaterialFactory.getGlowColor(0xff6600, 2.0), [side * craneW / 2, craneY, -hullLen * 0.25]);
      addPart(g, new THREE.SphereGeometry(hullR * 0.03, 6, 6),
        MaterialFactory.getGlowColor(0xff6600, 2.0), [side * craneW / 2, craneY, hullLen * 0.25]);
    }
  }
}

// ═══════════════════════════════════════════
//  方案 B — 外露聚变反应堆
// ═══════════════════════════════════════════
function applyVariantB(g, d, ctx) {
  const { hullW, hullH, hullLen, hullR, midR, isSuper } = d;
  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const grooveMat = MaterialFactory.get("groove", ctx);
  const reactorGlow = MaterialFactory.getGlowColor(0x00ccff, 2.5);

  function addReactor(x, y, z, scale) {
    const R = midR * 0.30 * scale;
    // 外环（磁约束环）
    addPart(g, new THREE.TorusGeometry(R, R * 0.12, 12, 20), steelMat, [x, y, z]);
    // 内环（内圈辉光）
    addPart(g, new THREE.TorusGeometry(R * 0.82, R * 0.06, 12, 20), reactorGlow, [x, y, z]);
    // 中央等离子球
    addPart(g, new THREE.SphereGeometry(R * 0.35, 12, 12), reactorGlow, [x, y, z]);
    // 散热翅片（环绕外环的径向肋）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addPart(g, new THREE.BoxGeometry(R * 0.02, R * 0.40, R * 0.12), grooveMat,
        [x + Math.sin(a) * R * 1.12, y + Math.cos(a) * R * 1.12, z]);
    }
  }

  // 旗舰：背部 1 个中型反应堆
  addReactor(0, hullH * 0.35, 0, 1.0);

  // 超旗：背部反应堆更大 + 底部 1 个小反应堆
  if (isSuper) {
    addReactor(0, hullH * 0.45, hullLen * 0.20, 1.5);
    addReactor(0, -hullH * 0.35, 0, 0.6);
  }
}

// ═══════════════════════════════════════════
//  方案 C — 悬浮武器塔
// ═══════════════════════════════════════════
function applyVariantC(g, d, ctx) {
  const { hullW, hullH, hullLen, hullR, midR, isSuper } = d;
  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const grooveMat = MaterialFactory.get("groove", ctx);

  function addTurret(side, z, scale) {
    const R = midR * 0.18 * scale;
    const baseX = side * (hullW * 0.50 + hullR * 0.30);
    const baseY = hullR * 0.08;
    // 支撑柱（从船体伸出的桁架柱）
    addPart(g, new THREE.CylinderGeometry(R * 0.20, R * 0.30, hullR * 0.40, 6), steelMat,
      [baseX, baseY, z], [0, 0, 0.2 * side]);
    // 炮台基座
    addPart(g, new THREE.CylinderGeometry(R * 0.60, R * 0.45, R * 0.20, 8), grooveMat,
      [baseX, baseY + hullR * 0.30, z]);
    // 炮管—2 根
    for (const dir of [-1, 1]) {
      addPart(g, new THREE.CylinderGeometry(R * 0.08, R * 0.12, R * 0.70, 8), steelMat,
        [baseX + dir * R * 0.30, baseY + hullR * 0.50, z], [0, 0, 0.3 * dir]);
    }
  }

  // 旗舰：两侧各 1 座炮塔
  for (const side of [-1, 1]) addTurret(side, 0, 1.0);

  // 超旗：每侧 2 座 + 顶部中央指挥炮位
  if (isSuper) {
    for (const side of [-1, 1]) {
      addTurret(side, -hullLen * 0.20, 0.8);
      addTurret(side, hullLen * 0.20, 0.8);
    }
    // 顶部指挥炮位（圆形指挥塔 + 远程测距仪）
    const cmdY = hullH * 0.50 + hullR * 0.20;
    addPart(g, new THREE.CylinderGeometry(midR * 0.12, midR * 0.20, midR * 0.30, 8), steelMat,
      [0, cmdY, 0]);
    addPart(g, new THREE.SphereGeometry(midR * 0.08, 8, 8),
      MaterialFactory.getGlowColor(0xffcc00, 1.5), [0, cmdY + midR * 0.20, 0]);
  }
}

// ═══════════════════════════════════════════
//  方案 D — 反重力推进阵列
// ═══════════════════════════════════════════
function applyVariantD(g, d, ctx) {
  const { hullW, hullH, hullLen, hullR, midR, isSuper } = d;
  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const grooveMat = MaterialFactory.get("groove", ctx);
  const glowDrive = MaterialFactory.getGlowColor(0x44ddff, 2.5);

  function addDrive(x, y, z, scale) {
    const R = midR * 0.35 * scale;
    // 碟形推进器（扁圆盘）
    addPart(g, new THREE.SphereGeometry(R, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.35), steelMat,
      [x, y, z]);
    // 向内凹的辉光腔
    addPart(g, new THREE.SphereGeometry(R * 0.60, 12, 8, 0, Math.PI * 2, Math.PI * 0.30, Math.PI * 0.45), glowDrive,
      [x, y - R * 0.15, z]);
    // 外层定位环
    addPart(g, new THREE.TorusGeometry(R * 1.05, R * 0.06, 8, 20), grooveMat, [x, y, z]);
  }

  // 旗舰：船底中央 1 个
  addDrive(0, -hullH * 0.30, 0, 1.0);

  // 超旗：前中后 3 个 + 两侧翼形稳定器
  if (isSuper) {
    addDrive(-hullLen * 0.25, -hullH * 0.30, 0, 0.8);
    addDrive(0, -hullH * 0.30, 0, 1.2);
    addDrive(hullLen * 0.25, -hullH * 0.30, 0, 0.8);
    // 翼形稳定器
    for (const side of [-1, 1]) {
      const wingX = side * (hullW * 0.60 + hullR * 0.20);
      addPart(g, new THREE.BoxGeometry(hullR * 0.08, hullR * 0.03, hullLen * 0.35), steelMat,
        [wingX, -hullH * 0.25, 0]);
      addPart(g, new THREE.BoxGeometry(hullR * 0.04, hullR * 0.25, hullR * 0.04), steelMat,
        [wingX, -hullH * 0.10, 0]);
      // 翼尖灯
      addPart(g, new THREE.SphereGeometry(hullR * 0.03, 6, 6),
        MaterialFactory.getGlowColor(0x44ddff, 2.0), [wingX, -hullH * 0.10, -hullLen * 0.18]);
      addPart(g, new THREE.SphereGeometry(hullR * 0.03, 6, 6),
        MaterialFactory.getGlowColor(0x44ddff, 2.0), [wingX, -hullH * 0.10, hullLen * 0.18]);
    }
  }
}

// ═══════════════════════════════════════════
//  方案 E — 舰桥扩展 + 相控阵
// ═══════════════════════════════════════════
function applyVariantE(g, d, ctx) {
  const { hullW, hullH, hullLen, hullR, midR, isSuper } = d;
  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const grooveMat = MaterialFactory.get("groove", ctx);

  const towerYBase = hullH * 0.50;

  function addTower(yBase, z, nLevels, scale) {
    const w = midR * 0.20 * scale;
    const h = midR * 0.18 * scale;
    for (let i = 0; i < nLevels; i++) {
      const layerW = w * (1 - i * 0.12);
      const layerH = h;
      addPart(g, new THREE.BoxGeometry(layerW, layerH, layerW * 0.80), steelMat,
        [0, yBase + i * h, z]);
      // 每层的玻璃观察窗（辉光带）
      addPart(g, new THREE.BoxGeometry(layerW * 0.80, layerH * 0.15, layerW * 0.60),
        MaterialFactory.getGlowColor(0x88ddff, 0.5), [0, yBase + i * h, z]);
    }
    // 顶层灯
    addPart(g, new THREE.SphereGeometry(midR * 0.04, 8, 8),
      MaterialFactory.getGlowColor(0xffcc00, 2.0), [0, yBase + nLevels * h, z]);
  }

  // 相控阵雷达板
  function addPhasedArray(x, y, z, scale) {
    const pw = midR * 0.25 * scale;
    const ph = midR * 0.30 * scale;
    const pThick = midR * 0.03;
    addPart(g, new THREE.BoxGeometry(pw, ph, pThick), steelMat, [x, y, z]);
    // 阵列面板（辉光栅格）
    const gridMat = MaterialFactory.getGlowColor(0x44ff88, 1.0);
    addPart(g, new THREE.BoxGeometry(pw * 0.85, ph * 0.85, pThick), gridMat, [x, y, z]);
  }

  // 旗舰：3 层指挥塔 + 4 面相控阵
  addTower(towerYBase, 0, 3, 1.0);
  const arrZ = hullLen * 0.10;
  for (const sx of [-1, 1]) {
    addPhasedArray(sx * (midR * 0.60), towerYBase + midR * 0.25, -arrZ, 1.0);
    addPhasedArray(sx * (midR * 0.60), towerYBase + midR * 0.25, arrZ, 1.0);
  }

  // 超旗：5 层高塔 + 远程传感器碟 + 后部通讯桅杆
  if (isSuper) {
    addTower(towerYBase, 0, 5, 1.2);
    // 传感器碟（顶部）
    addPart(g, new THREE.SphereGeometry(midR * 0.15, 12, 8), steelMat,
      [0, towerYBase + midR * 0.80, -hullLen * 0.10]);
    addPart(g, new THREE.TorusGeometry(midR * 0.12, midR * 0.02, 8, 16),
      MaterialFactory.getGlowColor(0x44ff88, 1.5), [0, towerYBase + midR * 0.82, -hullLen * 0.10]);
    // 后部通讯桅杆
    addPart(g, new THREE.CylinderGeometry(midR * 0.02, midR * 0.04, midR * 0.60, 6), steelMat,
      [0, towerYBase + midR * 0.35, hullLen * 0.22]);
    addPart(g, new THREE.SphereGeometry(midR * 0.03, 6, 6),
      MaterialFactory.getGlowColor(0xff6600, 2.0), [0, towerYBase + midR * 0.65, hullLen * 0.22]);
    // 额外 4 面大型阵列
    for (const sx of [-1, 1]) {
      addPhasedArray(sx * (midR * 0.70), towerYBase + midR * 0.35, -hullLen * 0.15, 1.2);
      addPhasedArray(sx * (midR * 0.70), towerYBase + midR * 0.35, hullLen * 0.15, 1.2);
    }
  }
}

// ═══════════════════════════════════════════
//  方案 F — 组合（A 桁架 + D 推进 + B 反应堆）
// ═══════════════════════════════════════════
function applyVariantF(g, d, ctx) {
  applyVariantA(g, d, ctx);
  applyVariantD(g, d, ctx);
  applyVariantB(g, d, ctx);
}

// ═══════════════════════════════════════════
//  方案 G — 反应堆 + 舰桥/相控阵（用户选定：环套船身 + 指挥塔）
// ═══════════════════════════════════════════
//
// SkeletalHull 的装甲段中心在 segZ=[-0.30*L, 0, 0.30*L]，每段长 0.27hullLen。
// 3 段在 hullLen 单位的 z 范围：
//   段 1: -0.467 ~ -0.200
//   段 2: -0.133 ~ +0.133
//   段 3: +0.200 ~ +0.467
// 两个间隙中点：-0.167 和 +0.167（hullLen 单位）。
// 两个磁约束环坐在这两个间隙（±0.17hullLen），等离子辉光球居中在 z=0。
function applyVariantG(g, d, ctx) {
  const { hullW, hullH, hullLen, hullR, midR, isSuper } = d;
  // SkeletalHull 装甲段用 L 单位（不是 hullLen）。L=ctx.L=hullLen/0.9。
  const L = ctx.L || hullLen;
  const steelMat = MaterialFactory.get("sensorMast", ctx);
  const grooveMat = MaterialFactory.get("groove", ctx);
  const reactorGlow = MaterialFactory.getGlowColor(0x00ccff, 2.5);

  // 环半径 ≈ 船体最宽处外 15~20%（套住船身）
  const ringR = hullR * 1.15 + midR * 0.10;
  const tubeR = hullR * 0.10;

  // 两个环的位置：±L * 0.15（3 段之间间隙的中点：段半长 0.12L，段中心 ±0.30L）
  const ringZ = L * 0.15;

  // ── 磁约束环 A（前段与中段之间，z = -0.17hullLen）──
  addPart(g, new THREE.TorusGeometry(ringR, tubeR, 16, 36), steelMat, [0, 0, -ringZ]);
  addPart(g, new THREE.TorusGeometry(ringR * 0.90, tubeR * 0.50, 16, 36), reactorGlow, [0, 0, -ringZ]);

  // ── 磁约束环 B（中段与后段之间，z = +0.17hullLen）──
  addPart(g, new THREE.TorusGeometry(ringR, tubeR, 16, 36), steelMat, [0, 0, ringZ]);
  addPart(g, new THREE.TorusGeometry(ringR * 0.90, tubeR * 0.50, 16, 36), reactorGlow, [0, 0, ringZ]);

  // ── 中央等离子辉光球（船体中心，超旗更大）──
  const ballR = isSuper ? hullR * 0.40 : hullR * 0.30;
  addPart(g, new THREE.SphereGeometry(ballR, 18, 18), reactorGlow, [0, 0, 0]);

  // ── 环与球体之间的径向能量导管（6 根，仅前环到球）──
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r2 = ringR * 0.65;
    addPart(g, new THREE.CylinderGeometry(hullR * 0.02, hullR * 0.02, ringR * 0.50, 6), grooveMat,
      [Math.sin(a) * r2, Math.cos(a) * r2, -ringZ * 0.5]);
  }

  // ── 超旗：环间纵向连接柱（8 根，从 -ringZ 跨到 +ringZ）──
  if (isSuper) {
    const span = ringZ * 2;  // 总跨度
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addPart(g, new THREE.CylinderGeometry(tubeR * 0.45, tubeR * 0.45, span, 6), grooveMat,
        [Math.sin(a) * ringR, Math.cos(a) * ringR, 0]);
    }

    // ── 超旗舰首炮口（空心炮管 + 喇叭口，辉光环外露）──
    const noseZ = -L * 0.50;                    // 船头最前端
    const barrelR = hullR * 0.36;               // 炮管基半径
    const barrelLen = L * 0.06;                 // 炮管长度
    const barrelZ = noseZ - barrelLen * 0.40;   // 炮管中心
    const barrelFront = barrelZ - barrelLen / 2; // 炮管前端（最外面）

    // CylinderGeometry 默认沿 Y 轴，rotation.x=PI/2 转为沿 Z 轴。
    // 炮管壁（空心圆筒，openEnded=true 无端盖，从前面看透到内部）
    addPart(g, new THREE.CylinderGeometry(barrelR * 0.80, barrelR * 1.10, barrelLen, 16, 1, true), steelMat,
      [0, 0, barrelZ], [Math.PI / 2, 0, 0]);
    // 炮口前端壁厚环（RingGeometry = 平面圆环，显示管壁厚度）
    addPart(g, new THREE.RingGeometry(barrelR * 0.70, barrelR * 0.80, 24), steelMat,
      [0, 0, barrelFront], [Math.PI / 2, 0, 0]);
    // 炮管内部暗壁（内表面暗色环）
    addPart(g, new THREE.RingGeometry(barrelR * 0.65, barrelR * 0.75, 24), grooveMat,
      [0, 0, barrelZ], [Math.PI / 2, 0, 0]);

    // ── 喇叭口（大钢环套在前端）──
    addPart(g, new THREE.TorusGeometry(barrelR * 1.45, hullR * 0.05, 12, 24), steelMat,
      [0, 0, noseZ]);
    // 喇叭口端面圈（openEnded 空心环）
    addPart(g, new THREE.CylinderGeometry(barrelR * 1.45, barrelR * 1.45, hullR * 0.10, 24, 1, true), steelMat,
      [0, 0, noseZ - hullR * 0.05], [Math.PI / 2, 0, 0]);
    // 喇叭口端面壁环
    addPart(g, new THREE.RingGeometry(barrelR * 1.35, barrelR * 1.45, 24), steelMat,
      [0, 0, noseZ - hullR * 0.05], [Math.PI / 2, 0, 0]);

    // ── 辉光环（外露：放在鼻锥外侧）──
    addPart(g, new THREE.TorusGeometry(barrelR * 1.30, hullR * 0.04, 12, 24),
      MaterialFactory.getGlowColor(0xff9944, 2.5), [0, 0, noseZ + hullR * 0.02]);
    // ── 炮口内能量盘（在空心炮管内部，从前面清晰可见）──
    addPart(g, new THREE.CircleGeometry(barrelR * 0.65, 32),
      stdMaterial({ color: 0xffaa44, emissive: 0xff6600, emissiveIntensity: 3.5, side: 2,
        transparent: true, opacity: 0.90 }),
      [0, 0, barrelFront + barrelLen * 0.30]);

    // ── 额外侧舷主炮（左右各一门）──
    const gunR = hullR * 0.15;
    const gunLen = hullLen * 0.07;
    for (const side of [-1, 1]) {
      const gx = side * (hullW * 0.52 + gunR * 1.5);
      const gz = hullLen * 0.05;
      // 底座
      addPart(g, new THREE.CylinderGeometry(gunR * 0.60, gunR * 0.80, gunR * 1.20, 8), grooveMat,
        [gx, -gunR * 0.60, gz], [0, side * 0.15, 0]);
      // 炮管（CylinderGeometry 沿 Y，rotation.z=PI/2 转至 X 轴）
      addPart(g, new THREE.CylinderGeometry(gunR * 0.70, gunR * 0.90, gunLen, 8), steelMat,
        [gx - gunLen * 0.25 * side, gunR * 0.15, gz], [0, 0, side * (Math.PI / 2 + 0.15)]);
      // 炮口辉光球
      addPart(g, new THREE.SphereGeometry(gunR * 0.25, 8, 8),
        MaterialFactory.getGlowColor(0xff9944, 2.5), [gx - gunLen * 0.48 * side, gunR * 0.15, gz]);
    }
  }

  // ── 舰桥 + 相控阵（保持 E 方案）──
  applyVariantE(g, d, ctx);
}

// ═══════════════════════════════════════════
//  调度
// ═══════════════════════════════════════════
const VARIANT_MAP = { A: applyVariantA, B: applyVariantB, C: applyVariantC, D: applyVariantD, E: applyVariantE, F: applyVariantF, G: applyVariantG };

export function generateStructureCapitalHull(hullGroup, ctx, variant = "G") {
  const d = getDims(ctx);
  if (!d) return hullGroup;

  const fn = VARIANT_MAP[variant] || applyVariantG;
  fn(hullGroup, d, ctx);
  return hullGroup;
}
