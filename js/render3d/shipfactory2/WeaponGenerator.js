// WeaponGenerator.js — 武器系统：鼻前双刺 + 巨型结构环 + 环内浮游炮 + 激光挂点 + 护盾辉光层
// 职责：返回包含上述全部武器/护盾构件的 THREE.Group。
// 约定：环内浮游炮列表挂到 g.userData.floaters；护盾层挂到 g.userData.shield，
//       供 ShipFactory2 汇总到 ship.userData 供动画使用。
import * as THREE from "three";
import { rbox, material, glowMat, addPart, COLORS, RING_COLOR, SHIELD_COLOR, additiveGlowMaterial } from "./Materials.js";

// 鼻前双刺（护盾系标志）
function addNoseSpikes(group, s, L, palette, length = 1.8) {
  const spikeMat = material(palette.dark, 0.86, 0.30);
  const spikeGlow = glowMat(palette, 1.2);
  const spread = 0.22 * s;
  for (const sx of [-spread, spread]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, length * s, 8), spikeMat);
    spike.position.set(sx, 0.02 * s, -L * 0.5 - length * s * 0.45);
    spike.rotation.x = Math.PI / 2 + 0.05;
    group.add(spike);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 8, 6), spikeGlow);
    tip.position.set(sx, 0.02 * s, -L * 0.5 - length * s * 0.95);
    group.add(tip);
  }
}

// 巨型结构环（分段环管 + 发光节点 + 环内浮游炮 + 能量丝）
function addHaloRing(group, L, s, palette, ringR, spec, count = 6) {
  const hybrid = !!spec.hybrid;
  const ringColor = hybrid ? COLORS.angel.glow : RING_COLOR;
  const segCount = 12;
  const tubeR = 0.07 * s;
  const nodeR = 0.13 * s;

  const ringMat = material(palette.dark, 0.90, 0.32);
  const mainRing = new THREE.TorusGeometry(ringR, tubeR, 10, segCount * 4);
  const ringMesh = new THREE.Mesh(mainRing, ringMat);
  ringMesh.rotation.x = 0.18;          // 向后倾斜
  ringMesh.position.z = 0.06 * L;      // 稍偏船中后
  group.add(ringMesh);

  const nodeGlow = glowMat({ glow: ringColor }, hybrid ? 2.0 : 1.8);
  for (let i = 0; i < segCount; i++) {
    const angle = (i / segCount) * Math.PI * 2;
    const nx = ringR * Math.cos(angle);
    const ny = ringR * Math.sin(angle);
    const tz = ny * Math.sin(0.18) + 0.06 * L;
    const ty_ = ny * Math.cos(0.18);
    const node = new THREE.Mesh(new THREE.SphereGeometry(nodeR, 12, 10), nodeGlow);
    node.position.set(nx, ty_, tz);
    group.add(node);
    if (i % 3 === 0) {
      const nodeBig = new THREE.Mesh(new THREE.SphereGeometry(nodeR * 1.4, 12, 10), glowMat({ glow: ringColor }, 2.5));
      nodeBig.position.set(nx, ty_, tz);
      group.add(nodeBig);
    }
  }

  // ══ 环内浮游炮（数量 = 舰船高槽数；悬浮于环内、朝前）══
  const floaters = [];
  const cannonBarrel = material(palette.steel, 0.90, 0.30);
  const cannonGlow = glowMat({ glow: ringColor }, 2.2);
  const tilt = 0.18;
  const rInner = ringR * 0.62;
  const cannonLen = 0.7 * s;
  for (let k = 0; k < count; k++) {
    const angle = (k / count) * Math.PI * 2 + Math.PI / count;
    const nx = rInner * Math.cos(angle);
    const ny = rInner * Math.sin(angle);
    const ty_ = ny * Math.cos(tilt);
    const tz = ny * Math.sin(tilt) + 0.06 * L;
    const base = new THREE.Vector3(nx, ty_, tz);

    const grp = new THREE.Group();
    grp.position.copy(base);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.05 * s, cannonLen, 12), cannonBarrel);
    pod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    pod.position.z = -cannonLen * 0.5;
    grp.add(pod);
    const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.075 * s, 12, 10), cannonGlow);
    emitter.position.z = -cannonLen - 0.02 * s;
    grp.add(emitter);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.055 * s, 12, 10), cannonGlow);
    core.position.z = 0.02 * s;
    grp.add(core);
    group.add(grp);
    floaters.push({ grp, base: base.clone(), phase: k * 1.7, ampY: 0.16 * s, ampZ: 0.09 * s });

    // 与环之间的能量丝（系留暗示）
    const mid = (rInner + ringR) / 2;
    const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.03 * s, ringR - rInner, 8), glowMat({ glow: ringColor }, 1.8));
    tether.material.transparent = true;
    tether.material.opacity = 0.7;
    const outward = new THREE.Vector3(nx, ny, 0).normalize();
    tether.position.set(outward.x * mid, outward.y * mid * Math.cos(tilt), outward.y * mid * Math.sin(tilt) + 0.06 * L);
    tether.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
    group.add(tether);
  }
  if (!group.userData.floaters) group.userData.floaters = [];
  group.userData.floaters.push(...floaters);

  return ringMesh;
}

// 激光发射舱
function addLaserPod(group, x, y, z, palette, s, big = false) {
  const base = material(palette.dark, 0.88, 0.30);
  const emitter = glowMat(palette, big ? 2.2 : 1.8);
  const r = (big ? 0.11 : 0.07) * s, len = (big ? 0.8 : 0.5) * s;
  addPart(group, new THREE.CylinderGeometry(r * 0.7, r, len, 10), base, [x, y, z], [Math.PI / 2, 0, 0]);
  addPart(group, new THREE.SphereGeometry(r, 10, 8), emitter, [x, y, z - len * 0.6]);
}

// 护盾辉光层
function addShieldBubble(group, radius, color = SHIELD_COLOR) {
  const fill = additiveGlowMaterial(color, 0.07, THREE.FrontSide);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), fill);
  bubble.name = "shield";
  const rim = additiveGlowMaterial(color, 0.18, THREE.BackSide);
  bubble.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 1.03, 28, 20), rim));
  group.add(bubble);
  return bubble;
}

export function generateWeapons(ctx) {
  const { preset, s, L, palette, spec, hybrid } = ctx;
  const g = new THREE.Group();
  g.name = "weapons";

  // ① 鼻前双刺
  addNoseSpikes(g, s, L, palette);

  // ② 巨型结构环 + 环内浮游炮（数量 = 高槽数）
  const ringR = (preset.ringRadius || 3.0) * s;
  const ringCannons = spec.highSlots != null ? spec.highSlots : (preset.mounts || 6);
  addHaloRing(g, L, s, palette, ringR, spec, ringCannons);

  // ③ 激光挂点（按舰级布局）
  const m = preset.mounts, big = (preset.body === "fortress");
  const slots = [];
  const getWingTip = () => {
    const wx = 0.5 * s + preset.wingSpan * s * Math.cos(0.42);
    const wz = -0.1 * L + preset.wingSpan * s * Math.sin(0.42);
    return [wx, wz];
  };
  const [wingTipX, wingTipZ] = getWingTip();
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
    addLaserPod(g, x, y, z, hybrid ? COLORS.angel : palette, s, big);

  // ④ 护盾辉光层（青蓝调）
  if (spec.shield !== false) {
    const radius = L * 0.58 + 0.5 * s;
    g.userData.shield = addShieldBubble(g, radius);
  }

  return g;
}
