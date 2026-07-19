// ShipFactory.js — 参数化程序化舰船工厂（数据驱动，零外部模型依赖）
// 美术目标：护盾激光线「圣教金 + 青蓝辉光」硬表面质感（对齐 three-demo ship factory 的 gold 调色）：
//   ① 饱和金装甲底色 + 近黑深结构件 + 青蓝发光（金/青冷暖强对比）
//   ② 巨型结构环(halo ring)包住船体（Sisters of EVE 标志形态，用户认可保留）
//   ③ 极度修长不对称轮廓 + 鼻前双刺
//   ④ 凹槽面板线细节（非凸起方块greeble）
//   ⑤ 环境反射金属感 + ACES 色调映射
// 说明：环境反射由场景的 scene.environment（RoomEnvironment/PMREM）提供，工厂只负责模型与材质。
// 每个舰级（hull）有本质不同的船体架构（body plan）：
//   frigate=匕首 / destroyer=炮艇 / cruiser=指挥巡洋 / battleship=分段堡垒；共用 Shield 家族语法。
// 护盾系身份：巨型结构环(分段带节点) + 白甲红边 + 鼻前双刺。
// 用法：
//   import { buildShip, COLORS, HULL_PRESETS } from "./ShipFactory.js";
//   const ship = buildShip({ id:"sunlance", line:"player_shield", family:"shield", hull:"battleship", weapon:"laser" });
//   scene.add(ship);
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// ---- 调色板 ----
export const COLORS = {
  // ★★★ 护盾激光线（玩家）：饱和圣教金甲 + 近黑深结构件 + 青蓝发光（对齐 ship factory gold，对比加大）
  player_shield:    { hull: 0x8f702c, dark: 0x161b22, glow: 0x2ab8f5, accent: 0xe0b24c, steel: 0x58636b },
  player_armor:     { hull: 0xcfc6bd, dark: 0x2a2620, glow: 0xff9a5a, accent: 0xb08968, steel: 0x8a8076 },
  player_structure: { hull: 0xd2d6cf, dark: 0x222820, glow: 0x9affc0, accent: 0x7fae8a, steel: 0x808a82 },
  angel:            { hull: 0x5a1f1f, dark: 0x16110f, glow: 0xff4030, accent: 0x7a2a22, steel: 0x5a3a3a },
  blood:            { hull: 0x4a1530, dark: 0x160c12, glow: 0xff3a6e, accent: 0x6a2440, steel: 0x5a3a4a },
  sansha:           { hull: 0x14403a, dark: 0x101a18, glow: 0x36e0a0, accent: 0x2a1840, steel: 0x2a4a44 }
};
COLORS.gold = COLORS.player_shield; COLORS.red = COLORS.angel;
COLORS.blue = { hull: 0x3a5a72, dark: 0x18222b, glow: 0x57d6f0, accent: 0x7fa9bd, steel: 0x5d6c73 };

// 结构环/护盾辉光颜色（金船体上的青蓝辉光，冷暖强对比）
const RING_COLOR = 0x2ab8f5;
const SHIELD_COLOR = 0x35bdff;

// ---- 船体预设 ----
// 姐妹会系更修长（len 偏大），ringRadius 控制结构环大小
export const HULL_PRESETS = {
  frigate:    { len: 7.0,  noseFat: 0.26, mid: 0.42, tail: 0.14, engines: 2, mounts: 2, scale: 1.0,  body: "dagger",    wingSpan: 2.2, ringRadius: 2.2 },
  destroyer:  { len: 9.0,  noseFat: 0.32, mid: 0.52, tail: 0.18, engines: 2, mounts: 3, scale: 1.15, body: "gunboat",   wingSpan: 2.8, ringRadius: 2.8 },
  cruiser:    { len: 11.0, noseFat: 0.42, mid: 0.76, tail: 0.26, engines: 3, mounts: 4, scale: 1.4, body: "cruiser",    wingSpan: 3.4, ringRadius: 3.6 },
  battleship: { len: 14.0, noseFat: 0.50, mid: 1.00, tail: 0.34, engines: 3, mounts: 5, scale: 1.75, body: "fortress",   wingSpan: 4.2, ringRadius: 4.6 }
};

function material(color, metalness = 0.88, roughness = 0.30, emissive = 0x000000, intensity = 0, env = 1.1) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: intensity, envMapIntensity: env });
}
function glowMat(palette, intensity = 1.5) {
  return material(0x1a0c10, 0.25, 0.20, palette.glow, intensity, 1.6);
}
function rbox(w, h, d, r, mat, pos, rot = [0, 0, 0], s = [1, 1, 1]) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) / 2 - 1e-3));
  const m = new THREE.Mesh(g, mat); m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...s); return m;
}
function addPart(group, geometry, mat, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.scale.set(...scale);
  group.add(mesh); return mesh;
}

// ── 船体剖面（沿 Z，头=-Z）：极长收尖的不对称硬表面 ──
function latheHull(L, fatR, midR, tailR) {
  const p = (r, y) => new THREE.Vector2(Math.max(0.01, r), y);
  const profile = [
    p(0.012, -L / 2),
    p(fatR * 0.38, -L / 2 + 0.06 * L),
    p(fatR * 0.78, -L / 2 + 0.14 * L),
    p(fatR,       -L / 2 + 0.24 * L),
    p(midR * 0.92,-0.14 * L),
    p(midR,       0.02 * L),
    p(midR * 0.62, 0.28 * L),
    p(midR * 0.38, 0.48 * L),
    p(tailR,      0.72 * L),
    p(tailR * 0.45,L / 2 - 0.04 * L),
    p(0.012, L / 2)
  ];
  const geo = new THREE.LatheGeometry(profile, 8); geo.rotateX(Math.PI / 2); return geo;
}

// 给定轴向位置 z ∈ [-L/2, L/2]，返回船体在该处的剖面半径（与 latheHull 同一组控制点）
function hullRadiusAt(z, fatR, midR, tailR, L) {
  const pts = [
    [-L / 2, 0.012], [-L / 2 + 0.06 * L, fatR * 0.38], [-L / 2 + 0.14 * L, fatR * 0.78],
    [-L / 2 + 0.24 * L, fatR], [-0.14 * L, midR * 0.92], [0.02 * L, midR],
    [0.28 * L, midR * 0.62], [0.48 * L, midR * 0.38], [0.72 * L, tailR],
    [L / 2 - 0.04 * L, tailR * 0.45], [L / 2, 0.012]
  ];
  if (z <= pts[0][0]) return pts[0][1];
  if (z >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [z0, r0] = pts[i], [z1, r1] = pts[i + 1];
    if (z >= z0 && z <= z1) return r0 + (r1 - r0) * (z - z0) / (z1 - z0);
  }
  return midR;
}

// ── 贴合曲面的发光缝（Ribbon Mesh）──
// 顶点直接按 R(z) 生成在船体表面上，左右缘用角度偏移 ±dphi 控制宽度。
// 天然贴面、不悬空、不穿模——比 TubeGeometry 更贴近 EVE 舰体发光缝。
// （TubeGeometry 是悬在半径方向的独立管子，没有 CSG 布尔运算就永远夹在
//   "浮空 / 被船体遮住" 之间，无法真正嵌入。）
function addSeamRibbon(ship, phi, dphi, R, L, palette, intensity = 2.2) {
  const N = 28;
  const z0 = -0.46 * L, z1 = 0.46 * L;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const z = z0 + (z1 - z0) * (i / N);
    const r = R(z) * 1.008; // 略高于表面，避免 z-fighting（polygonOffset 双保险）
    const sl = Math.sin(phi - dphi), cl = Math.cos(phi - dphi);
    const sr = Math.sin(phi + dphi), cr = Math.cos(phi + dphi);
    pos.push(r * sl, r * cl, z); // 左缘
    pos.push(r * sr, r * cr, z); // 右缘
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = glowMat({ glow: palette.glow }, intensity);
  mat.polygonOffset = true;       // 防止与船体 z 冲突闪烁
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  mat.side = THREE.DoubleSide;
  ship.add(new THREE.Mesh(geo, mat));
}

// ── 舰体细节（贴合曲面、不浮空；发光缝 + 装甲板 + 航行灯）──
function addHullDetail(ship, s, L, palette, spec) {
  const preset = HULL_PRESETS[spec.hull] || HULL_PRESETS.frigate;
  const fatR = preset.noseFat, midR = preset.mid, tailR = preset.tail;
  const R = (z) => hullRadiusAt(z, fatR * s, midR * s, tailR * s, L);

  // ① 发光缝（Ribbon Mesh，贴合船体曲面，不悬空/不穿模）
  //   背脊中线 + 两舷，宽度用角度 seamHalfW 控制（随船体自动等比缩放）。
  const seamAngles = [0, 0.95, -0.95]; // 0=背脊中线，±=两舷
  const seamHalfW = 0.038;              // 发光缝半角宽（弧度）→ 世界宽度 = 2·dphi·R(z)
  for (const phi of seamAngles) {
    addSeamRibbon(ship, phi, seamHalfW, R, L, palette, 2.2);
  }

  // ② 贴合表面的装甲板（扁平圆角板，沿法线贴附，钢色，非黑）
  //   ★ 尺寸按局部船体半径 R(z) 相对缩放，不随 s 线性膨胀，避免大船上变成巨砖。
  const plateMat = material(palette.steel, 0.95, 0.24);
  const plateZones = [-0.05 * L, 0.18 * L]; // 沿轴向两排
  for (const z of plateZones) {
    const r = R(z) * 0.99;
    const localR = R(z); // 局部剖面半径
    for (const side of [-1, 1]) {
      const phi = side * 0.62; // 上舷偏侧
      const w = Math.min(0.32 * s, localR * 0.42), h = Math.min(0.22 * s, localR * 0.30), t = 0.042 * s;
      const plate = rbox(w, t, h, 0.015 * s, plateMat,
        [r * Math.sin(phi), r * Math.cos(phi), z]);
      // 让薄面(局部Y)贴合径向法线：绕Z旋转 -phi
      plate.rotation.z = -phi;
      ship.add(plate);
    }
  }

  // ③ 航行灯（翼尖/鼻/尾的微小辉光点）
  const nav = glowMat({ glow: palette.glow }, 2.6);
  const navPts = [
    [-0.5 * s + preset.wingSpan * s * 0.45 * Math.cos(0.42), 0, -0.1 * L + preset.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s],
    [0.5 * s + preset.wingSpan * s * 0.45 * Math.cos(0.42), 0, -0.1 * L + preset.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s],
    [0, 0.1 * s, -L * 0.46], [0, 0.08 * s, L * 0.46]
  ];
  for (const [x, y, z] of navPts)
    ship.add(new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 8, 6), nav)).position.set(x, y, z);
}

// ── 后掠翼 ──
function extrudeWing(span, rootChord, tipChord, sweep, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -rootChord / 2); shape.lineTo(0, rootChord / 2);
  shape.lineTo(span, rootChord / 2 + sweep); shape.lineTo(span, -tipChord / 2 + sweep); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.5, bevelSize: thickness * 0.5, bevelSegments: 2, steps: 1 });
  geo.translate(0, 0, -thickness / 2); geo.rotateX(Math.PI / 2); return geo;
}

// ── 巨型结构环（护盾系标志性特征：分段环+发光节点）──
function addHaloRing(ship, L, s, palette, ringR, spec, count = 6) {
  const hybrid = !!spec.hybrid;
  const ringColor = hybrid ? COLORS.angel.glow : RING_COLOR;
  const segCount = 12; // 环段数
  const tubeR = 0.07 * s; // 环管粗细
  const nodeR = 0.13 * s; // 发光节点大小

  // 主环管（暗红骨架）
  const ringMat = material(palette.dark, 0.90, 0.32);
  const mainRing = new THREE.TorusGeometry(ringR, tubeR, 10, segCount * 4);
  const ringMesh = new THREE.Mesh(mainRing, ringMat);

  // 环略微后倾（参考图中环不是正竖直的）
  ringMesh.rotation.x = 0.18; // 向后倾斜
  ringMesh.position.z = 0.06 * L; // 稍偏船中后
  ship.add(ringMesh);

  // 发光节点（均匀分布在环上）
  const nodeGlow = glowMat({ glow: ringColor }, hybrid ? 2.0 : 1.8);
  for (let i = 0; i < segCount; i++) {
    const angle = (i / segCount) * Math.PI * 2;
    const nx = ringR * Math.cos(angle);
    const ny = ringR * Math.sin(angle);
    // 应用倾斜旋转后的位置
    const tz = ny * Math.sin(0.18) + 0.06 * L;
    const ty_ = ny * Math.cos(0.18);

    // 节点球
    const node = new THREE.Mesh(new THREE.SphereGeometry(nodeR, 12, 10), nodeGlow);
    node.position.set(nx, ty_, tz);
    ship.add(node);

    // 每隔一段加一个更大的高亮节点（模拟参考图中的亮点簇）
    if (i % 3 === 0) {
      const brightNode = new THREE.Mesh(
        new THREE.SphereGeometry(nodeR * 1.4, 12, 10),
        glowMat({ glow: ringColor }, 2.5)
      );
      brightNode.position.set(nx, ty_, tz);
      ship.add(brightNode);
    }

    // 连接小梁（环到船体的支撑结构）已移除，改为环上激光炮，见下方
  }

  // ══ 环内浮游炮（数量 = 舰船高槽数 slots.high；悬浮于环内、朝前，仿 Gundam 浮游炮/bit）══
  const floaters = [];
  const cannonBarrel = material(palette.steel, 0.90, 0.30);
  const cannonGlow = glowMat({ glow: ringColor }, 2.2);
  const tilt = 0.18;
  const rInner = ringR * 0.62;        // 悬浮在环内侧
  const cannonLen = 0.7 * s;
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2 + Math.PI / count; // 均匀分布并错开节点
    const nx = rInner * Math.cos(angle);
    const ny = rInner * Math.sin(angle);
    const ty_ = ny * Math.cos(tilt);
    const tz = ny * Math.sin(tilt) + 0.06 * L;
    const base = new THREE.Vector3(nx, ty_, tz);

    // —— 浮游炮单元（随 grp 浮动）——
    const grp = new THREE.Group();
    grp.position.copy(base);
    // 炮体：朝前的锥形漏斗（前粗后细）
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11 * s, 0.05 * s, cannonLen, 12),
      cannonBarrel
    );
    pod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)); // 朝 -Z 前方
    pod.position.z = -cannonLen * 0.5;
    grp.add(pod);
    // 前端发射口辉光
    const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.075 * s, 12, 10), cannonGlow);
    emitter.position.z = -cannonLen - 0.02 * s;
    grp.add(emitter);
    // 尾部能量核
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.055 * s, 12, 10), cannonGlow);
    core.position.z = 0.02 * s;
    grp.add(core);
    ship.add(grp);
    floaters.push({ grp, base: base.clone(), phase: k * 1.7, ampY: 0.16 * s, ampZ: 0.09 * s });

    // —— 与环之间的能量丝（静态 tether，暗示系留）——
    const mid = (rInner + ringR) / 2;
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03 * s, 0.03 * s, ringR - rInner, 8),
      glowMat({ glow: ringColor }, 1.8)
    );
    tether.material.transparent = true;
    tether.material.opacity = 0.7;
    const outward = new THREE.Vector3(nx, ny, 0).normalize();
    tether.position.set(
      outward.x * mid,
      outward.y * mid * Math.cos(tilt),
      outward.y * mid * Math.sin(tilt) + 0.06 * L
    );
    tether.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
    ship.add(tether);
  }
  if (!ship.userData.floaters) ship.userData.floaters = [];
  ship.userData.floaters.push(...floaters);

  return ringMesh;
}

// ── 鼻前双刺（参考图前端的探针状突起）──
function addNoseSpikes(ship, s, L, palette, length = 1.8) {
  const spikeMat = material(palette.dark, 0.86, 0.30);
  const spikeGlow = glowMat(palette, 1.2);
  const spread = 0.22 * s;
  for (const sx of [-spread, spread]) {
    // 主刺杆
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.035 * s, length * s, 8),
      spikeMat
    );
    spike.position.set(sx, 0.02 * s, -L * 0.5 - length * s * 0.45);
    spike.rotation.x = Math.PI / 2 + 0.05;
    ship.add(spike);

    // 刺尖发光点
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.025 * s, 8, 6),
      spikeGlow
    );
    tip.position.set(sx, 0.02 * s, -L * 0.5 - length * s * 0.95);
    ship.add(tip);
  }
}

// ── 引擎舱 ──
function addEngine(group, x, y, z, radius, palette, length = 1.6) {
  const casing = material(palette.dark, 0.88, 0.32);
  const steel = material(palette.steel, 0.92, 0.26);
  const glow = glowMat(palette, 1.6);
  addPart(group, new THREE.CylinderGeometry(radius * 0.8, radius, length, 18), casing, [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, 0.16, 18), steel, [x, y, z + length * 0.5], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.05, 18), glow, [x, y, z + length * 0.5 + 0.1], [Math.PI / 2, 0, 0], [1, 1, 1], false);
  const exMat = new THREE.MeshBasicMaterial({ color: palette.glow, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  const exhaust = addPart(group, new THREE.ConeGeometry(radius * 0.55, 1.6, 16, 1, true), exMat, [x, y, z + length * 0.5 + 0.85], [Math.PI / 2, 0, 0], [1, 1, 1], false);
  exhaust.name = "exhaust";
}

// ── 激光发射舱 ──
function addLaserPod(group, x, y, z, palette, s, big = false) {
  const base = material(palette.dark, 0.88, 0.30);
  const emitter = glowMat(palette, big ? 2.2 : 1.8);
  const r = (big ? 0.11 : 0.07) * s, len = (big ? 0.8 : 0.5) * s;
  addPart(group, new THREE.CylinderGeometry(r * 0.7, r, len, 10), base, [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.SphereGeometry(r, 10, 8), emitter, [x, y, z - len * 0.6], [0, 0, 0], [1, 1, 1], false);
}

// ── 护盾辉光层 ──
function addShieldBubble(group, radius, color = SHIELD_COLOR) {
  const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, side: THREE.FrontSide, depthWrite: false });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), fill);
  bubble.name = "shield";
  const rim = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false });
  bubble.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.03, 28, 20), rim));
  group.add(bubble);
  return bubble;
}

function resolvePalette(spec, role) {
  if (spec.line && COLORS[spec.line]) return COLORS[spec.line];
  if (role === "enemy") return COLORS.angel;
  return COLORS.player_shield;
}

function preset_mid(spec) {
  const p = HULL_PRESETS[spec.hull] || HULL_PRESETS.frigate; return p.mid;
}

// ══════════════════════════════════════
//  各舰级专属架构构件
// ══════════════════════════════════════

// 护卫：紧凑 + 小环
function buildDaggerExtras(ship, s, L, palette, accentMat, spec) {
  // 不需要额外大型构件，靠环和双刺就够了
}

// 驱逐：前突喙锥 + 轻量中段模块（缩小堆叠高度，避免"积木感"）
function buildGunboatExtras(ship, s, L, palette, accentMat, spec) {
  const hybrid = !!spec.hybrid;
  // 尖喙（保留，这是驱逐舰的识别特征）
  addPart(ship, new THREE.ConeGeometry(preset_mid(spec) * 0.5, 1.1 * s, 16),
    material(palette.hull, 0.86, 0.32), [0, 0, -L * 0.5 - 0.5 * s], [Math.PI / 2, 0, 0]);
  // 中段低矮模块（扁平化——之前 0.42s/0.55s 高度像两层楼）
  const stackY = 0.16 * s;
  ship.add(rbox(L * 0.18, 0.22 * s, 0.50 * s, 0.03 * s,
    material(palette.hull, 0.87, 0.32), [0.12 * s, stackY, -0.08 * L]));
  ship.add(rbox(L * 0.10, 0.26 * s, 0.30 * s, 0.025 * s,
    hybrid ? material(COLORS.angel.hull, 0.84, 0.34, COLORS.angel.glow, 0.35) : accentMat,
    [0.18 * s, stackY + 0.20 * s, -0.10 * L]));
  return { engineX: 0.9 * s };
}

// 巡洋：薄脊甲板（不再用大塔楼——之前 L×0.38 × 0.55s 的 rbox 像乐高积木）
function buildCruiserExtras(ship, s, L, palette, accentMat, spec) {
  const hybrid = !!spec.hybrid;
  // 细长低矮的甲板脊线（沿背脊方向，高度仅 ~0.15s），像加厚的装甲带而非独立建筑
  const deckMat = material(palette.hull, 0.87, 0.32);
  ship.add(rbox(L * 0.30, 0.13 * s, 0.35 * s, 0.03 * s, deckMat,
    [0.06 * s, preset_mid(spec) * s * 0.58, -0.02 * L]));
  // 脊上微凸的指挥模块（小而扁，不像塔楼）
  ship.add(rbox(L * 0.10, 0.18 * s, 0.22 * s, 0.025 * s,
    hybrid ? material(COLORS.angel.hull, 0.84, 0.34, COLORS.angel.glow, 0.4) : accentMat,
    [0.10 * s, preset_mid(spec) * s * 0.72, -0.05 * L]));
  return { engineX: 1.0 * s };
}

// 战列：低矮城郭甲板（不再用巨型堡垒盒子——之前 citadelR×1.4/1.8 的 rbox 堆积如山）
function buildFortressExtras(ship, s, L, palette, accentMat, spec) {
  const deckMat = material(palette.hull, 0.88, 0.32);
  // 中央低矮甲板隆起（像加厚装甲带，不是独立建筑）
  ship.add(rbox(L * 0.28, 0.20 * s, preset_mid(spec) * s * 0.65, 0.04 * s,
    deckMat, [0.08 * s, preset_mid(spec) * s * 0.35, 0.02 * L]));
  // 侧舷微凸（薄而宽，不像炮廓）
  for (const side of [-1, 1]) {
    ship.add(rbox(L * 0.18, 0.10 * s, preset_mid(spec) * s * 0.40, 0.03 * s,
      deckMat, [side * (preset_mid(spec) * s * 0.70), 0.06 * s, 0.06 * L]));
  }
  return { engineX: 1.0 * s };
}

// 混血专属红色武装
function buildHybridExtras(ship, s, L, spec) {
  const ap = COLORS.angel;
  const redMat = material(ap.hull, 0.84, 0.34, ap.glow, 0.45);
  const redGlow = glowMat(ap, 1.8);
  // 大撞角
  addPart(ship, new THREE.ConeGeometry(preset_mid(spec) * 0.8, 2.2 * s, 16), redMat,
    [0, 0, -L * 0.5 - 1.0 * s], [Math.PI / 2, 0, 0]);
  // 红色脊鳍
  ship.add(rbox(0.07 * s, 1.1 * s, 2.2 * s, 0.02 * s, redMat, [0, 0.7 * s, 0.1 * L], [0, 0, 0.3]));
  // 红色脊线导管
  addPart(ship, new THREE.BoxGeometry(0.1 * s, 0.1 * s, L * 0.68), redGlow,
    [0, 0.34 * s, 0.02 * L]);
  // 红引擎罩
  for (const exx of [-0.9 * s, 0.9 * s]) {
    addPart(ship, new THREE.CylinderGeometry(0.3 * s, 0.34 * s, 0.55 * s, 16), redMat,
      [exx, -0.06 * s, L * 0.5], [Math.PI / 2, 0, 0]);
  }
}

// ══════════════════════════════════════
//  主入口
// ══════════════════════════════════════
export function buildShip(spec = {}) {
  const role = spec.role || (String(spec.hull || "").startsWith("enemy") ? "enemy" : "player");
  const family = spec.family || "shield";
  const preset = HULL_PRESETS[spec.hull] || HULL_PRESETS.frigate;
  let palette = resolvePalette(spec, role);
  const accentPalette = spec.accentFaction && COLORS[spec.accentFaction] ? COLORS[spec.accentFaction] : null;
  const accentColor = accentPalette ? accentPalette.glow : palette.accent;
  const s = preset.scale, L = preset.len * s;
  const hybrid = !!spec.hybrid;

  const ship = new THREE.Group();
  ship.name = spec.id || spec.hull || "ship";
  ship.userData = { spec, role, family, palette };

  // 材质（护盾系：高反光银白甲）
  const hullMat = material(palette.hull, 0.86, 0.30);
  const darkMat = material(palette.dark, 0.90, 0.32);
  const accentMat = material(accentColor, 0.82, 0.28, hybrid ? COLORS.angel.glow : palette.glow, hybrid ? 0.5 : 0.3);
  const steelMat = material(palette.steel, 0.93, 0.26);
  const glassMat = material(palette.dark, 0.35, 0.15, hybrid ? COLORS.angel.glow : palette.glow, 0.9);

  // ══ 基础船体（修长棱角剖面）═
  addPart(ship, latheHull(L, preset.noseFat, preset.mid, preset.tail), hullMat, [0, 0, 0]);

  // 中央脊线饰条（深蓝灰，沿背脊）——细长低调
  ship.add(rbox(L * 0.72, 0.036 * s, 0.07 * s, 0.018 * s, darkMat, [0, preset.mid * s * 0.92, -0.02 * L]));

  // 舰桥窗（小型发光区——大船上也要保持小巧）
  const bridgeR = Math.min(0.10 * s, 0.12); // 上限封顶
  ship.add(new THREE.Mesh(
    new THREE.SphereGeometry(bridgeR, 12, 10), glassMat
  )).position.set(-0.08 * s, Math.max(0.18 * s, bridgeR + 0.04 * s), -L * 0.28);

  // ══ 舰体细节（贴合曲面的发光缝 + 装甲板 + 航行灯）═
  addHullDetail(ship, s, L, palette, spec);

  // ══ 鼻前双刺（护盾系标志）═
  addNoseSpikes(ship, s, L, palette);

  // ══ 按舰级加载专属架构 ══
  let layout = {};
  if (preset.body === "dagger") buildDaggerExtras(ship, s, L, palette, accentMat, spec);
  else if (preset.body === "gunboat") layout = buildGunboatExtras(ship, s, L, palette, accentMat, spec);
  else if (preset.body === "cruiser") layout = buildCruiserExtras(ship, s, L, palette, accentMat, spec);
  else if (preset.body === "fortress") layout = buildFortressExtras(ship, s, L, palette, accentMat, spec);
  if (hybrid) buildHybridExtras(ship, s, L, spec);

  // ══ ★ 巨型结构环（护盾系标志性特征）═
  const ringR = (preset.ringRadius || 3.0) * s;
  // 环上激光炮数量 = 舰船高槽数 slots.high（缺省回退到 mounts）
  const ringCannons = spec.highSlots != null ? spec.highSlots : (preset.mounts || 6);
  addHaloRing(ship, L, s, palette, ringR, spec, ringCannons);

  // ══ 后掠翼 ══
  const wingGeo = extrudeWing(preset.wingSpan * s, 1.3 * s, 0.8 * s, 1.2 * s, 0.10 * s);
  const wingTipX = 0.5 * s + preset.wingSpan * s * Math.cos(0.42);
  const wingTipZ = -0.1 * L + preset.wingSpan * s * Math.sin(0.42);
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(wingGeo, steelMat);
    w.position.set(side * 0.5 * s, -0.04 * s, -0.1 * L);
    w.rotation.set(0, side * 0.42, side * 0.06);
    ship.add(w);
    // 翼缘发光条
    const edgeGlow = glowMat(palette, 1.0);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(preset.wingSpan * s * 0.9, 0.03 * s, 0.08 * s), edgeGlow);
    edge.position.set(side * (0.5 * s + preset.wingSpan * s * 0.45 * Math.cos(0.42)), -0.04 * s,
      -0.1 * L + preset.wingSpan * s * 0.45 * Math.sin(0.42) + 0.4 * s);
    edge.rotation.set(0, side * 0.42, 0);
    ship.add(edge);
  }

  // ══ 引擎舱 ══
  let ex;
  if (preset.body === "gunboat") ex = [-0.9 * s, 0.9 * s];
  else if (preset.engines === 3) ex = [-0.65 * s, 0, 0.65 * s];
  else ex = [-0.5 * s, 0.5 * s];
  for (const exx of ex) addEngine(ship, exx, -0.08 * s, L * 0.5, 0.24 * s, hybrid ? COLORS.angel : palette);

  // ══ 激光挂点 ══
  const m = preset.mounts, big = (preset.body === "fortress");
  const slots = [];
  if (preset.body === "dagger") {
    slots.push([-wingTipX, 0.0, wingTipZ], [wingTipX, 0.0, wingTipZ]);
  } else if (preset.body === "gunboat") {
    slots.push([0, 0.1 * s, -L * 0.44], [-0.45 * s, 0.04 * s, -L * 0.38], [0.45 * s, 0.04 * s, -L * 0.38]);
  } else if (preset.body === "cruiser") {
    const wm = 0.5 * s + preset.wingSpan * s * 0.5 * Math.cos(0.42);
    const wz = -0.1 * L + preset.wingSpan * s * 0.5 * Math.sin(0.42);
    slots.push([-wm, 0.0, wz], [-wingTipX, 0.0, wingTipZ], [wm, 0.0, wz], [wingTipX, 0.0, wingTipZ]);
  } else if (preset.body === "fortress") {
    const sx = preset.mid * s * 1.3 + 0.8 * s;
    slots.push([-sx, 0.08 * s, 0.04 * L], [sx, 0.08 * s, 0.04 * L],
      [-wingTipX, 0.0, wingTipZ], [wingTipX, 0.0, wingTipZ], [0, 0.12 * s, -L * 0.48]);
  }
  for (const [x, y, z] of slots.slice(0, m))
    addLaserPod(ship, x, y, z, hybrid ? COLORS.angel : palette, s, big);

  // ══ 护盾辉光层（青蓝调）═
  if (spec.shield !== false) {
    const radius = L * 0.58 + 0.5 * s;
    ship.userData.shield = addShieldBubble(ship, radius);
  }

  return ship;
}
