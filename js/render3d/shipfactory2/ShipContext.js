// ShipContext.js — Phase 2 共享数据中心（Phase 3 起亦为 Profile 的唯一注入点）
//
// Commit 1：把原 ShipFactory2 中的临时 ctx 正式化为模块（字段/材质与原 ctx 一致，Generator 接口不变）。
// Commit 2：新增 C 组表面数学 radiusAt / normalAt / sampleHullSurface，并扩展 B 组 bounds。
// Commit 3：删除一切 preset 概念——s/L/length/scale/hullProfile 全部由 this.profile.hull 派生；
//           ShipContext 不再知道 "Preset" 这个词（对齐 AI Rules §18 不可变 / §19 Generator 禁读配置）。
//
// 依赖方向（单向，无环）：ShipContext → Utils / Materials / ShipProfile；ShipContext 不依赖任何 Generator。
//   注意：ShipContext 是 Generator 与配置之间的【唯一】桥梁——Generator 只读 ctx.profile，绝不直接读配置。
import * as THREE from "three";
import { COLORS, material, glowMat } from "./Materials.js";
import { resolvePalette, hullRadiusAt } from "./Utils.js";
import { buildProfile } from "./ShipProfile.js";

// ── E 组：确定性随机（Commit 4，为 Phase 7 可复现做准备）──
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ShipContext {
  constructor(spec = {}) {
    this.spec = spec;
    this.role = spec.role || (String(spec.hull || "").startsWith("enemy") ? "enemy" : "player");
    this.family = spec.family || "shield";
    this.hybrid = !!spec.hybrid;
    this.shipName = spec.id || spec.hull || "ship";

    // E 组：确定性随机（提前：seed 由 shipName 派生，保证"不传 seed 也能跑，传同 seed 必同船"）。
    //       必须在 A 组 profile 之前，因为 buildProfile 需要 ctx.scope('ship').random。
    this.seed = spec.seed != null ? spec.seed : hashStr(this.shipName);
    const seedNum = typeof this.seed === "string" ? hashStr(this.seed) : this.seed;
    this._rng = mulberry32(seedNum >>> 0);

    // A 组：整舰 DNA（Phase 3）。由 Anchor(风格) + shipClass(档位) + rng(Seed 变异) 解析为只读 ShipProfile。
    //       anchor 缺省 "Spear"（shield 家族）；Phase 6 起由 RaceStyle.resolve() 决定，不再硬编码于此。
    //       注意：Spear 全部为标量 → buildProfile 不消费 rng → 与旧 HULL_PRESETS 逐位一致（几何零变化）。
    const anchor = spec.anchor || "Spear";
    this.profile = buildProfile({ anchor, shipClass: spec.hull, rng: this.scope("ship").random });

    // B 组：几何描述（Phase 3 Commit 3：全部由 profile.hull 派生，ShipContext 不再持有任何 preset 概念）。
    this.palette = resolvePalette(spec, this.role);
    this.hullProfile = this.profile.hull;          // 别名：供 radiusAt / _buildBounds 及部分 Generator 读取
    this.s = this.profile.hull.scale;
    this.scale = this.s;                            // 别名
    this.L = this.profile.hull.len * this.s;
    this.length = this.L;                           // 别名

    // D 组：共享材质（一次构建，跨 Generator 复用，满足 AI Rules §11 复用材质）
    const accentPalette = spec.accentFaction && COLORS[spec.accentFaction] ? COLORS[spec.accentFaction] : null;
    const accentColor = accentPalette ? accentPalette.glow : this.palette.accent;
    this.hullMat = material(this.palette.hull, 0.86, 0.30);
    this.darkMat = material(this.palette.dark, 0.90, 0.32);
    this.accentMat = material(accentColor, 0.82, 0.28, this.hybrid ? COLORS.angel.glow : this.palette.glow, this.hybrid ? 0.5 : 0.3);
    this.steelMat = material(this.palette.steel, 0.93, 0.26);
    this.glassMat = material(this.palette.dark, 0.35, 0.15, this.hybrid ? COLORS.angel.glow : this.palette.glow, 0.9);

    // B 组：扩展包围信息（采纳建议二：aabb / sphere / length / maxRadius / center，供相机/Validator/LOD 复用）
    this._buildBounds();
  }

  // ── C 组：表面数学（单一事实源，消除 Ribbon/Armor 重复的本地 R(z)）──
  // 轴向位置 z -> 船体剖面半径。与原 hullRadiusAt(z, noseFat*s, mid*s, tail*s, L) 完全等价。
  radiusAt(z) {
    return hullRadiusAt(z, this.hullProfile.noseFat * this.s, this.hullProfile.mid * this.s, this.hullProfile.tail * this.s, this.L);
  }

  // 外法线（径向单位向量混入轴向导数 -dR/dz）。数值微分，足够贴附精度。
  normalAt(z, angle) {
    const r = this.radiusAt(z);
    const dz = 1e-3;
    const dr = (this.radiusAt(z + dz) - r) / dz;
    return new THREE.Vector3(Math.sin(angle), Math.cos(angle), -dr).normalize();
  }

  // 从 Hull 表面采样一个点（采纳建议一：改名 sampleHullSurface，避免与 Shield/Ring/Engine/Armor 各自 surface 混淆）
  sampleHullSurface(z, angle, offset = 0) {
    const r = this.radiusAt(z) + offset;
    return new THREE.Vector3(r * Math.sin(angle), r * Math.cos(angle), z);
  }

  _buildBounds() {
    const hullR = Math.max(this.hullProfile.noseFat, this.hullProfile.mid, this.hullProfile.tail) * this.s;
    const ringR = (this.hullProfile.ringRadius || 3) * this.s;
    const maxRadius = Math.max(hullR, ringR);
    this.bounds = {
      aabb: { min: new THREE.Vector3(-maxRadius, -maxRadius, -this.L * 0.5), max: new THREE.Vector3(maxRadius, maxRadius, this.L * 0.5) },
      sphere: { center: new THREE.Vector3(0, 0, 0), radius: maxRadius },
      length: this.L,
      maxRadius,
      center: new THREE.Vector3(0, 0, 0)
    };
  }

  // 主种子流：[0,1)
  random() {
    return this._rng();
  }

  // 按 Generator 名派生隔离的确定性子流（避免调用顺序串扰，仍完全可复现）
  scope(name) {
    const base = typeof this.seed === "string" ? hashStr(this.seed) : this.seed;
    const s = (base ^ hashStr(name)) >>> 0;
    const r = mulberry32(s);
    return { random: () => r() };
  }
}

// 工厂函数：ShipFactory2 调用入口
export function createShipContext(spec) {
  return new ShipContext(spec);
}
