// ShipProfile.js — Phase 3：整艘船的 DNA（静态描述）
//
// 设计依据：SHIPPROFILE_DESIGN.md + SHIP_STYLE_SYSTEM.md（用户拍板 9.8/10）。
//
// 职责边界：
//   ShipProfile 回答「这艘船应该长什么样」——它是一份只读的静态描述（DNA）。
//   ShipContext 回答「如何把这份 DNA 变成当前这艘船」——运行时上下文。
//   Generator   回答「如何生成几何」——只负责建模。
//
// 关键原则（对齐 AI_DEVELOPMENT_RULES §18 ShipProfile Immutability）：
//   - buildProfile() 产出的 ShipProfile 是【只读】数据，Generator 禁止修改。
//   - Anchor 存的是【区间/风格 DNA】，Seed 负责【变异】：终值 = lerp(min, max, rng())。
//   - Anchor 以「风格」命名（Spear/Needle/...），与种族无关（种族在 Phase 6 用 RaceStyle.resolve 引用）。
//
// 依赖方向（单向，无环）：ShipProfile 不依赖 ShipContext / 任何 Generator / THREE。
//   （纯数据 + 纯函数；ShipContext 在构造时调用 buildProfile 并持有结果。）

// ── ShipProfile Schema（Phase 3 只落地 hull 段，其余段占位，待对应 Phase 填充）──
//
// ShipProfile = {
//   hull: {
//     // 形状（驱动 latheHull + hullRadiusAt）
//     len, noseFat, mid, tail,
//     // 结构计数（驱动 Armor/Engine/Weapon 等）
//     scale, engines, mounts, wingSpan, ringRadius, body,
//     // 归一化描述符（新增，为未来 Curve Function / RaceStyle 预留，Phase 3 暂不被消费）
//     radialSegments, widthRatio, twist, asymmetry,
//   },
//   engine:     { ... },   // Phase 5
//   weapon:     { ... },   // Phase 5
//   sensor:     { ... },   // Phase 5
//   decoration: { ... },   // Phase 9
// }

// ── Anchor Schema ──
// 每个 Anchor = { id, family, perClass:{ <class>: <hullShape> } }。
// <hullShape> 的每个数值字段可为：
//   - 标量  v            → 固定值（用于精确复刻现有舰体，不触发变异）
//   - 区间  [min, max]   → 由 rng() 在区间内 lerp 出终值（真正的 Seed 变异）
//
// 迁移用锚点 Spear 采用【标量】perClass 表，其值 === 旧 HULL_PRESETS，保证 Commit 2/3 几何逐位一致。
// Commit 4 新增的锚点（Needle/Blade/Hammer/...）采用【区间】，演示「同锚点 + 不同 Seed → 不同但风格一致」。

export const ANCHORS = {
  // Spear —— 护盾激光线家族（shield），流线收尖。perClass 值 = 旧 HULL_PRESETS（标量=精确复刻）。
  Spear: {
    id: "Spear",
    family: "shield",
    perClass: {
      frigate:    { len: 7.0,  noseFat: 0.26, mid: 0.42, tail: 0.14, scale: 1.0,  engines: 2, mounts: 2, wingSpan: 2.2, ringRadius: 2.2, body: "dagger",   radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      destroyer:  { len: 9.0,  noseFat: 0.32, mid: 0.52, tail: 0.18, scale: 1.15, engines: 2, mounts: 3, wingSpan: 2.8, ringRadius: 2.8, body: "gunboat",  radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      cruiser:    { len: 11.0, noseFat: 0.42, mid: 0.76, tail: 0.26, scale: 1.4,  engines: 3, mounts: 4, wingSpan: 3.4, ringRadius: 3.6, body: "cruiser",  radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      battleship: { len: 14.0, noseFat: 0.50, mid: 1.00, tail: 0.34, scale: 1.75, engines: 3, mounts: 5, wingSpan: 4.2, ringRadius: 4.6, body: "fortress", radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
    }
  }
};

// 区间/标量解析：标量原样返回；[min,max] 用 rng 线性插值。
function resolveField(v, rng) {
  if (Array.isArray(v)) return v[0] + (v[1] - v[0]) * rng();
  return v;
}

const DEFAULT_CLASS = "frigate";

// 冻结递归：产出的 ShipProfile 为只读（对齐 §18 Immutable，硬性防止 Generator 误改）。
function deepFreeze(obj) {
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
  });
  return Object.freeze(obj);
}

// buildProfile —— 把 Anchor（DNA）+ shipClass（档位）+ rng（Seed 变异）解析成只读 ShipProfile。
//
// 参数：
//   anchor    锚点 id（默认 "Spear"）。Phase 6 起由 RaceStyle.resolve() 决定。
//   shipClass 档位（frigate/destroyer/cruiser/battleship）。
//   rng       [0,1) 随机函数（来自 ctx.scope('ship').random）。默认 Math.random。
//             注意：Spear 全为标量 → 不消费 rng → 结果与 rng 无关（保证迁移零变化）。
export function buildProfile({ anchor = "Spear", shipClass = DEFAULT_CLASS, rng = Math.random } = {}) {
  const A = ANCHORS[anchor] || ANCHORS.Spear;
  const shape = A.perClass[shipClass] || A.perClass[DEFAULT_CLASS];

  const hull = {};
  for (const key of Object.keys(shape)) {
    const v = shape[key];
    // body 是字符串枚举，直接透传；其余数值字段走 resolveField（支持区间变异）。
    hull[key] = typeof v === "string" ? v : resolveField(v, rng);
  }

  return deepFreeze({
    anchor: A.id,
    family: A.family,
    shipClass,
    hull,
    // 其余段占位（待 Phase 5 / 9 填充），保持 schema 形状稳定
    engine: null,
    weapon: null,
    sensor: null,
    decoration: null,
  });
}

// hull 档位名 → 供外部（ShipContext）校验/枚举
export const SHIP_CLASSES = ["frigate", "destroyer", "cruiser", "battleship"];
