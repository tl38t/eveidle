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
  angel:            { hull: 0xf8f4ea, dark: 0x3a3028, glow: 0xffd54f, accent: 0xc9a84c, steel: 0x9a9078 },
  blood:            { hull: 0x4a1530, dark: 0x160c12, glow: 0xc01530, accent: 0x6a2440, steel: 0x5a3a4a },
  sansha:           { hull: 0x14403a, dark: 0x101a18, glow: 0x36e0a0, accent: 0x2a1840, steel: 0x2a4a44 },
  // 工业舰（采矿/采气/工业支援/工业旗舰）：ORE 风格——枪铁灰舰体 + 琥珀矿晶辉光 + 警示黄。
  industrial:       { hull: 0x9aa0a6, dark: 0x23262b, glow: 0xffae3b, accent: 0xd9c44a, steel: 0x6b7178 },
  // 工业·采气：青灰冷调舰体 + 青绿辉光 + 警示黄（与采矿同 hull，不同色板）。
  industrial_gas:   { hull: 0x5a7a82, dark: 0x1a2e33, glow: 0x57e0c8, accent: 0xd9c44a, steel: 0x5a7278 },
  // 工业·支援（海豚级）：ORE 工业经典橄榄绿 + 深暗钢灰 + 警示黄（多模块拼装感）
  industrial_support: { hull: 0x4a5a2a, dark: 0x1e1f1c, glow: 0xffae3b, accent: 0xd9c44a, steel: 0x3a4028 },
  // 考古/探索舰：扫描风格——深青灰舰体 + 青绿扫描辉光 + 钛青强调。
  archaeology:      { hull: 0x3a4a52, dark: 0x18222b, glow: 0x57e0c8, accent: 0x7fd9c0, steel: 0x5d6c73 }
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

// 集中式 MeshStandardMaterial 构造器（Task 9：旗舰船体材质集中）。
// 用于需要 transparent/opacity/side 等扩展参数、简写 material() 无法表达的一次性材质，
// 让 Generator 不再直接 new THREE.MeshStandardMaterial（满足 AI Rules §6 材质集中）。
// 每次返回全新实例（无缓存）——不引入跨舰全局材质缓存，符合本轮边界。
export function stdMaterial(opts) {
  return new THREE.MeshStandardMaterial(opts);
}

// 发光材质：暗底 + 强自发光，用于发光缝 / 节点 / 引擎口等
export function glowMat(palette, intensity = 1.5) {
  return material(0x1a0c10, 0.25, 0.20, palette.glow, intensity, 1.6);
}

// 圆角盒（RoundedBoxGeometry 封装），直接定位旋转
export function rbox(w, h, d, r, mat, pos = [0, 0, 0], rot = [0, 0, 0], s = [1, 1, 1]) {
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

// ── 边缘描边（背面描边法 / inverted hull）──
// 给箱体类构件（装甲块等）添加深色棱线轮廓，强化"厚重工业"轮廓感。
// 用 BackSide 翻面箱体套在原 mesh 外（略大），边缘露出暗色形成勾边。
// 比 LineSegments 可靠：WebGL 中 LineBasicMaterial.linewidth 被限制为 1px，远处不可见。
const _outlineMatCache = new Map();
function _getOutlineMaterial(color) {
  if (!_outlineMatCache.has(color)) {
    const mat = new THREE.MeshBasicMaterial({
      color, side: THREE.BackSide, depthWrite: false, fog: false
    });
    // Task 8：跨舰复用的共享描边材质——标记为共享，disposeObject 单舰销毁时不得释放。
    mat.userData.ship3dShared = true;
    _outlineMatCache.set(color, mat);
  }
  return _outlineMatCache.get(color);
}

// scale: 描边箱体相对原 mesh 的放大倍率（1.05 = 边缘露出 2.5%）
export function addEdgeOutline(mesh, color = 0x2a2620, opacity = 0.75, thresholdAngle = 50) {
  const expand = 1.04 + (opacity - 0.75) * 0.12; // opacity 0.75→1.04, 1.0→1.07
  const outline = new THREE.Mesh(mesh.geometry, _getOutlineMaterial(color));
  outline.scale.multiplyScalar(expand);
  mesh.add(outline);
  return mesh;
}
