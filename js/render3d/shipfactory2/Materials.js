// Materials.js — 调色板与共享材质工厂
// 拆分自 ShipFactory.js（v2.9）：所有生成模块共用的颜色与材质工具集中于此。
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// ── 调色板 ──
export const COLORS = {
  // 护盾激光线（玩家）：饱和圣教金甲 + 近黑深结构件 + 青蓝发光
  player_shield:    { hull: 0x8f702c, dark: 0x161b22, glow: 0x2ab8f5, accent: 0xe0b24c, steel: 0x58636b },
  player_armor:     { hull: 0xcfc6bd, dark: 0x2a2620, glow: 0xff9a5a, accent: 0xb08968, steel: 0x8a8076 },
  player_structure: { hull: 0xd2d6cf, dark: 0x222820, glow: 0x9affc0, accent: 0x7fae8a, steel: 0x808a82 },
  angel:            { hull: 0x5a1f1f, dark: 0x16110f, glow: 0xff4030, accent: 0x7a2a22, steel: 0x5a3a3a },
  blood:            { hull: 0x4a1530, dark: 0x160c12, glow: 0xff3a6e, accent: 0x6a2440, steel: 0x5a3a4a },
  sansha:           { hull: 0x14403a, dark: 0x101a18, glow: 0x36e0a0, accent: 0x2a1840, steel: 0x2a4a44 }
};
// 旧别名兼容（早期原型页曾用 COLORS.gold / COLORS.red / COLORS.blue）
COLORS.gold = COLORS.player_shield;
COLORS.red = COLORS.angel;
COLORS.blue = { hull: 0x3a5a72, dark: 0x18222b, glow: 0x57d6f0, accent: 0x7fa9bd, steel: 0x5d6c73 };

// 结构环 / 护盾辉光颜色（金船体上的青蓝辉光，冷暖强对比）
export const RING_COLOR = 0x2ab8f5;
export const SHIELD_COLOR = 0x35bdff;

// ── 材质工厂 ──
export function material(color, metalness = 0.88, roughness = 0.30, emissive = 0x000000, intensity = 0, env = 1.1) {
  return new THREE.MeshStandardMaterial({
    color, metalness, roughness, emissive,
    emissiveIntensity: intensity, envMapIntensity: env
  });
}

// 发光材质：暗底 + 强自发光，用于发光缝 / 节点 / 引擎口等
export function glowMat(palette, intensity = 1.5) {
  return material(0x1a0c10, 0.25, 0.20, palette.glow, intensity, 1.6);
}

// 圆角盒（RoundedBoxGeometry 封装），直接定位旋转
export function rbox(w, h, d, r, mat, pos, rot = [0, 0, 0], s = [1, 1, 1]) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) / 2 - 1e-3));
  const m = new THREE.Mesh(g, mat);
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(...s);
  return m;
}

// 通用网格添加（几何 + 材质 + 位姿）
export function addPart(group, geometry, mat, position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position); mesh.rotation.set(...rotation); mesh.scale.set(...scale);
  group.add(mesh); return mesh;
}

// 附加混合辉光材质（透明 + 加色 + 不写深度）——引擎尾焰 / 护盾辉光层等。
// 集中此处满足 AI Rules §6（材质集中 Materials.js），避免 Generator 内 new THREE.MeshBasicMaterial。
export function additiveGlowMaterial(color, opacity, side = THREE.FrontSide) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, side, depthWrite: false
  });
}
