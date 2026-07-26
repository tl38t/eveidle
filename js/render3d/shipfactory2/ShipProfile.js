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
  //         Phase 3 Commit 1~3 的 5 艘原型船走此锚点；Commit 4 起其余锚点用区间，演示 Seed 变异。
  Spear: {
    id: "Spear",
    family: "shield",
    perClass: {
      frigate:    { len: 7.0,  noseFat: 0.26, mid: 0.42, tail: 0.14, scale: 1.0,  engines: 2, mounts: 2, wingSpan: 2.2, ringRadius: 2.2, body: "dagger",   radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      destroyer:  { len: 9.0,  noseFat: 0.32, mid: 0.52, tail: 0.18, scale: 1.15, engines: 2, mounts: 3, wingSpan: 2.8, ringRadius: 2.8, body: "gunboat",  radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      cruiser:    { len: 11.0, noseFat: 0.42, mid: 0.76, tail: 0.26, scale: 1.4,  engines: 3, mounts: 4, wingSpan: 3.4, ringRadius: 3.6, body: "cruiser",  radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      battleship: { len: 14.0, noseFat: 0.50, mid: 1.00, tail: 0.34, scale: 1.75, engines: 3, mounts: 5, wingSpan: 4.2, ringRadius: 4.6, body: "fortress", radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      capital:    { len: 18.0, noseFat: 0.60, mid: 1.40, tail: 0.42, scale: 2.40, engines: 4, mounts: 6, wingSpan: 5.4, ringRadius: 6.0, body: "fortress", radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
      supercapital:{ len: 22.0, noseFat: 0.65, mid: 1.80, tail: 0.50, scale: 3.00, engines: 6, mounts: 7, wingSpan: 6.6, ringRadius: 7.4, body: "fortress", radialSegments: 8, widthRatio: 1.0, twist: 0, asymmetry: 0 },
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 以下锚点全部采用【区间】字段（[min,max]），由 rng 在区间 lerp 出终值。
  // 同锚点 + 不同 seed → 明显不同但风格一致（Phase 3 Commit 4 验证目标）。
  // 设计约束：
  //   - 字段集与 Spear 完全一致（HullGenerator/WeaponGenerator/EngineGenerator 不改）。
  //   - body 枚举仅用现有 4 值（dagger/gunboat/cruiser/fortress），因 Generator 内有分支。
  //   - 区间围绕该锚点的视觉特征设计（见 SHIP_STYLE_SYSTEM.md 表）。
  // ─────────────────────────────────────────────────────────────────────────

  // Needle 针 —— 极细长、尖鼻。侦察/高速感。noseFat 极小，mid 细，body=dagger。
  Needle: {
    id: "Needle",
    family: "shield",
    perClass: {
      frigate:    { len: [7.4, 8.2], noseFat: [0.14, 0.20], mid: [0.30, 0.38], tail: [0.08, 0.12], scale: [0.95, 1.05], engines: 2, mounts: 2, wingSpan: [1.8, 2.2], ringRadius: [1.8, 2.2], body: "dagger",   radialSegments: 8, widthRatio: [0.85, 0.95], twist: [0, 0.04], asymmetry: 0 },
      destroyer:  { len: [9.4, 10.2], noseFat: [0.18, 0.24], mid: [0.38, 0.46], tail: [0.10, 0.14], scale: [1.10, 1.20], engines: 2, mounts: 3, wingSpan: [2.4, 2.8], ringRadius: [2.4, 2.8], body: "gunboat",  radialSegments: 8, widthRatio: [0.85, 0.95], twist: [0, 0.04], asymmetry: 0 },
      cruiser:    { len: [11.4, 12.4], noseFat: [0.24, 0.30], mid: [0.52, 0.62], tail: [0.14, 0.18], scale: [1.35, 1.45], engines: 3, mounts: 4, wingSpan: [3.0, 3.4], ringRadius: [3.2, 3.6], body: "cruiser",  radialSegments: 8, widthRatio: [0.85, 0.95], twist: [0, 0.04], asymmetry: 0 },
      battleship: { len: [14.4, 15.6], noseFat: [0.30, 0.38], mid: [0.68, 0.82], tail: [0.18, 0.24], scale: [1.70, 1.80], engines: 3, mounts: 5, wingSpan: [3.8, 4.2], ringRadius: [4.2, 4.6], body: "fortress", radialSegments: 8, widthRatio: [0.85, 0.95], twist: [0, 0.04], asymmetry: 0 },
    }
  },

  // Blade 刃 —— 扁平、宽切面。装甲线（armor family）。widthRatio<1 扁椭圆。
  Blade: {
    id: "Blade",
    family: "armor",
    perClass: {
      frigate:    { len: [6.8, 7.4], noseFat: [0.26, 0.34], mid: [0.48, 0.58], tail: [0.16, 0.22], scale: [1.00, 1.08], engines: 2, mounts: 2, wingSpan: [2.4, 2.8], ringRadius: [2.4, 2.8], body: "dagger",   radialSegments: 6, widthRatio: [0.65, 0.78], twist: 0, asymmetry: 0 },
      destroyer:  { len: [8.8, 9.6], noseFat: [0.32, 0.40], mid: [0.58, 0.70], tail: [0.20, 0.26], scale: [1.15, 1.23], engines: 2, mounts: 3, wingSpan: [3.0, 3.4], ringRadius: [3.0, 3.4], body: "gunboat",  radialSegments: 6, widthRatio: [0.65, 0.78], twist: 0, asymmetry: 0 },
      cruiser:    { len: [10.8, 11.6], noseFat: [0.40, 0.48], mid: [0.82, 0.96], tail: [0.26, 0.32], scale: [1.40, 1.48], engines: 3, mounts: 4, wingSpan: [3.6, 4.0], ringRadius: [3.8, 4.2], body: "cruiser",  radialSegments: 6, widthRatio: [0.65, 0.78], twist: 0, asymmetry: 0 },
      battleship: { len: [13.8, 14.6], noseFat: [0.48, 0.56], mid: [1.04, 1.18], tail: [0.32, 0.40], scale: [1.73, 1.83], engines: 3, mounts: 5, wingSpan: [4.4, 4.8], ringRadius: [4.6, 5.0], body: "fortress", radialSegments: 6, widthRatio: [0.65, 0.78], twist: 0, asymmetry: 0 },
      capital:    { len: [18.0, 19.5], noseFat: [0.56, 0.64], mid: [1.35, 1.55], tail: [0.40, 0.48], scale: [2.30, 2.50], engines: 4, mounts: 6, wingSpan: [5.4, 6.0], ringRadius: [6.0, 6.6], body: "fortress", radialSegments: 6, widthRatio: [0.65, 0.78], twist: 0, asymmetry: 0 },
      supercapital:{ len: [22.0, 24.0], noseFat: [0.62, 0.72], mid: [1.70, 1.95], tail: [0.46, 0.56], scale: [2.90, 3.20], engines: 6, mounts: 7, wingSpan: [6.6, 7.4], ringRadius: [7.4, 8.2], body: "fortress", radialSegments: 6, widthRatio: [0.65, 0.78], twist: 0, asymmetry: 0 },
    }
  },

  // Hammer 锤 —— 厚重、方正。结构线（structure family）。mid 粗、body=fortress。
  Hammer: {
    id: "Hammer",
    family: "structure",
    perClass: {
      frigate:    { len: [6.6, 7.2], noseFat: [0.34, 0.42], mid: [0.54, 0.64], tail: [0.24, 0.30], scale: [1.05, 1.13], engines: 2, mounts: 2, wingSpan: [2.0, 2.4], ringRadius: [2.2, 2.6], body: "gunboat",  radialSegments: 4, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
      destroyer:  { len: [8.6, 9.4], noseFat: [0.40, 0.48], mid: [0.66, 0.78], tail: [0.28, 0.34], scale: [1.20, 1.28], engines: 2, mounts: 3, wingSpan: [2.6, 3.0], ringRadius: [2.8, 3.2], body: "gunboat",  radialSegments: 4, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
      cruiser:    { len: [10.6, 11.4], noseFat: [0.48, 0.56], mid: [0.92, 1.04], tail: [0.34, 0.42], scale: [1.45, 1.53], engines: 3, mounts: 4, wingSpan: [3.2, 3.6], ringRadius: [3.6, 4.0], body: "cruiser",  radialSegments: 4, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
      battleship: { len: [13.6, 14.4], noseFat: [0.54, 0.62], mid: [1.14, 1.28], tail: [0.40, 0.48], scale: [1.78, 1.88], engines: 3, mounts: 5, wingSpan: [4.0, 4.4], ringRadius: [4.6, 5.0], body: "fortress", radialSegments: 4, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
    }
  },

  // Organic 有机 —— 圆润、平滑。Gallente 感。radialSegments 大（圆）。
  Organic: {
    id: "Organic",
    family: "shield",
    perClass: {
      frigate:    { len: [7.0, 7.6], noseFat: [0.28, 0.36], mid: [0.44, 0.54], tail: [0.18, 0.24], scale: [1.00, 1.08], engines: 2, mounts: 2, wingSpan: [2.2, 2.6], ringRadius: [2.2, 2.6], body: "dagger",   radialSegments: 24, widthRatio: [0.95, 1.05], twist: [0, 0.06], asymmetry: 0 },
      destroyer:  { len: [9.0, 9.8], noseFat: [0.34, 0.42], mid: [0.54, 0.66], tail: [0.22, 0.28], scale: [1.15, 1.23], engines: 2, mounts: 3, wingSpan: [2.8, 3.2], ringRadius: [2.8, 3.2], body: "gunboat",  radialSegments: 24, widthRatio: [0.95, 1.05], twist: [0, 0.06], asymmetry: 0 },
      cruiser:    { len: [11.0, 11.8], noseFat: [0.42, 0.50], mid: [0.78, 0.92], tail: [0.28, 0.34], scale: [1.40, 1.48], engines: 3, mounts: 4, wingSpan: [3.4, 3.8], ringRadius: [3.6, 4.0], body: "cruiser",  radialSegments: 24, widthRatio: [0.95, 1.05], twist: [0, 0.06], asymmetry: 0 },
      battleship: { len: [14.0, 14.8], noseFat: [0.50, 0.58], mid: [1.02, 1.16], tail: [0.34, 0.42], scale: [1.75, 1.85], engines: 3, mounts: 5, wingSpan: [4.2, 4.6], ringRadius: [4.6, 5.0], body: "fortress", radialSegments: 24, widthRatio: [0.95, 1.05], twist: [0, 0.06], asymmetry: 0 },
      capital:    { len: [18.0, 19.5], noseFat: [0.58, 0.66], mid: [1.35, 1.55], tail: [0.42, 0.50], scale: [2.35, 2.55], engines: 4, mounts: 6, wingSpan: [5.2, 5.8], ringRadius: [5.8, 6.4], body: "fortress", radialSegments: 24, widthRatio: [0.95, 1.05], twist: [0, 0.06], asymmetry: 0 },
      supercapital:{ len: [22.0, 24.0], noseFat: [0.62, 0.72], mid: [1.70, 1.95], tail: [0.48, 0.58], scale: [2.90, 3.20], engines: 6, mounts: 7, wingSpan: [6.4, 7.0], ringRadius: [7.0, 7.8], body: "fortress", radialSegments: 24, widthRatio: [0.95, 1.05], twist: [0, 0.06], asymmetry: 0 },
    }
  },

  // Industrial 工业 —— 方正、Flat、功能化。Caldari 感。radialSegments 小（棱角）、widthRatio<1。
  Industrial: {
    id: "Industrial",
    family: "structure",
    perClass: {
      frigate:    { len: [7.0, 7.6], noseFat: [0.30, 0.38], mid: [0.48, 0.58], tail: [0.20, 0.26], scale: [1.02, 1.10], engines: 2, mounts: 2, wingSpan: [2.2, 2.6], ringRadius: [2.2, 2.6], body: "gunboat",  radialSegments: 6, widthRatio: [0.70, 0.82], twist: 0, asymmetry: 0 },
      destroyer:  { len: [9.0, 9.8], noseFat: [0.36, 0.44], mid: [0.58, 0.70], tail: [0.24, 0.30], scale: [1.17, 1.25], engines: 2, mounts: 3, wingSpan: [2.8, 3.2], ringRadius: [2.8, 3.2], body: "gunboat",  radialSegments: 6, widthRatio: [0.70, 0.82], twist: 0, asymmetry: 0 },
      cruiser:    { len: [11.0, 11.8], noseFat: [0.44, 0.52], mid: [0.82, 0.96], tail: [0.30, 0.36], scale: [1.42, 1.50], engines: 3, mounts: 4, wingSpan: [3.4, 3.8], ringRadius: [3.6, 4.0], body: "cruiser",  radialSegments: 6, widthRatio: [0.70, 0.82], twist: 0, asymmetry: 0 },
      battleship: { len: [14.0, 14.8], noseFat: [0.52, 0.60], mid: [1.06, 1.20], tail: [0.36, 0.44], scale: [1.77, 1.87], engines: 3, mounts: 5, wingSpan: [4.2, 4.6], ringRadius: [4.6, 5.0], body: "fortress", radialSegments: 6, widthRatio: [0.70, 0.82], twist: 0, asymmetry: 0 },
      capital:     { len: [18.0, 19.5], noseFat: [0.60, 0.70], mid: [1.40, 1.60], tail: [0.46, 0.54], scale: [2.30, 2.50], engines: 4, mounts: 6, wingSpan: [5.4, 6.0], ringRadius: [6.0, 6.6], body: "fortress", radialSegments: 6, widthRatio: [0.72, 0.84], twist: 0, asymmetry: 0 },
    }
  },

  // Archaeology 考古/探索 —— 流线、尖锐、低机械暴露。传感器桅 + 扫描翼为签名。
  Archaeology: {
    id: "Archaeology",
    family: "shield",
    perClass: {
      frigate:    { len: [7.2, 7.8], noseFat: [0.18, 0.24], mid: [0.36, 0.44], tail: [0.12, 0.16], scale: [0.95, 1.03], engines: 2, mounts: 2, wingSpan: [2.0, 2.4], ringRadius: [2.0, 2.4], body: "dagger",   radialSegments: 20, widthRatio: [0.78, 0.90], twist: [0, 0.05], asymmetry: 0 },
      destroyer:  { len: [9.2, 9.9], noseFat: [0.22, 0.28], mid: [0.44, 0.54], tail: [0.14, 0.18], scale: [1.12, 1.20], engines: 2, mounts: 3, wingSpan: [2.6, 3.0], ringRadius: [2.6, 3.0], body: "gunboat",  radialSegments: 20, widthRatio: [0.78, 0.90], twist: [0, 0.05], asymmetry: 0 },
      cruiser:    { len: [11.2, 11.9], noseFat: [0.28, 0.34], mid: [0.62, 0.74], tail: [0.18, 0.22], scale: [1.37, 1.45], engines: 3, mounts: 4, wingSpan: [3.2, 3.6], ringRadius: [3.4, 3.8], body: "cruiser",  radialSegments: 20, widthRatio: [0.78, 0.90], twist: [0, 0.05], asymmetry: 0 },
      battleship: { len: [14.2, 14.9], noseFat: [0.34, 0.40], mid: [0.82, 0.94], tail: [0.22, 0.28], scale: [1.72, 1.82], engines: 3, mounts: 5, wingSpan: [4.0, 4.4], ringRadius: [4.4, 4.8], body: "fortress", radialSegments: 20, widthRatio: [0.78, 0.90], twist: [0, 0.05], asymmetry: 0 },
      capital:    { len: [18.0, 19.5], noseFat: [0.42, 0.48], mid: [1.05, 1.20], tail: [0.28, 0.34], scale: [2.30, 2.50], engines: 4, mounts: 6, wingSpan: [5.0, 5.6], ringRadius: [5.6, 6.2], body: "fortress", radialSegments: 20, widthRatio: [0.80, 0.92], twist: [0, 0.05], asymmetry: 0 },
    }
  },

  // Broken 破碎 —— 不对称、开放框架。Minmatar 感。asymmetry>0、twist 略大。
  Broken: {
    id: "Broken",
    family: "structure",
    perClass: {
      frigate:    { len: [7.0, 7.6], noseFat: [0.24, 0.32], mid: [0.42, 0.52], tail: [0.16, 0.22], scale: [1.00, 1.08], engines: 2, mounts: 2, wingSpan: [2.0, 2.6], ringRadius: [2.2, 2.6], body: "dagger",   radialSegments: 6, widthRatio: [0.88, 1.00], twist: [0.04, 0.12], asymmetry: [0.12, 0.24] },
      destroyer:  { len: [9.0, 9.8], noseFat: [0.30, 0.38], mid: [0.52, 0.64], tail: [0.20, 0.26], scale: [1.15, 1.23], engines: 2, mounts: 3, wingSpan: [2.6, 3.2], ringRadius: [2.8, 3.2], body: "gunboat",  radialSegments: 6, widthRatio: [0.88, 1.00], twist: [0.04, 0.12], asymmetry: [0.12, 0.24] },
      cruiser:    { len: [11.0, 11.8], noseFat: [0.38, 0.46], mid: [0.74, 0.88], tail: [0.26, 0.32], scale: [1.40, 1.48], engines: 3, mounts: 4, wingSpan: [3.2, 3.8], ringRadius: [3.6, 4.0], body: "cruiser",  radialSegments: 6, widthRatio: [0.88, 1.00], twist: [0.04, 0.12], asymmetry: [0.12, 0.24] },
      battleship: { len: [14.0, 14.8], noseFat: [0.46, 0.54], mid: [0.98, 1.12], tail: [0.32, 0.40], scale: [1.75, 1.85], engines: 3, mounts: 5, wingSpan: [4.0, 4.6], ringRadius: [4.6, 5.0], body: "fortress", radialSegments: 6, widthRatio: [0.88, 1.00], twist: [0.04, 0.12], asymmetry: [0.12, 0.24] },
    }
  },

  // Lotus 莲 —— 对称绽放、多层环。姐妹会/结构环感。ringRadius 偏大、body=fortress。
  Lotus: {
    id: "Lotus",
    family: "structure",
    perClass: {
      frigate:    { len: [7.0, 7.6], noseFat: [0.28, 0.36], mid: [0.46, 0.56], tail: [0.18, 0.24], scale: [1.05, 1.13], engines: 2, mounts: 2, wingSpan: [2.4, 2.8], ringRadius: [2.8, 3.2], body: "fortress", radialSegments: 12, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
      destroyer:  { len: [9.0, 9.8], noseFat: [0.34, 0.42], mid: [0.56, 0.68], tail: [0.22, 0.28], scale: [1.20, 1.28], engines: 2, mounts: 3, wingSpan: [3.0, 3.4], ringRadius: [3.4, 3.8], body: "fortress", radialSegments: 12, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
      cruiser:    { len: [11.0, 11.8], noseFat: [0.42, 0.50], mid: [0.80, 0.94], tail: [0.28, 0.34], scale: [1.45, 1.53], engines: 3, mounts: 4, wingSpan: [3.6, 4.0], ringRadius: [4.2, 4.6], body: "fortress", radialSegments: 12, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
      battleship: { len: [14.0, 14.8], noseFat: [0.50, 0.58], mid: [1.04, 1.18], tail: [0.34, 0.42], scale: [1.80, 1.90], engines: 3, mounts: 5, wingSpan: [4.4, 4.8], ringRadius: [5.2, 5.6], body: "fortress", radialSegments: 12, widthRatio: [0.92, 1.00], twist: 0, asymmetry: 0 },
    }
  },
};

// 区间/标量解析：标量原样返回；[min,max] 用 rng 线性插值。
function resolveField(v, rng) {
  if (Array.isArray(v)) return v[0] + (v[1] - v[0]) * rng();
  return v;
}

const DEFAULT_CLASS = "frigate";

// 档位从高到低的降级顺序（与 SHIP_CLASSES 一致，反向）。
const CLASS_FALLBACK_ORDER = ["supercapital", "capital", "battleship", "cruiser", "destroyer", "frigate"];

// 在锚点 A 的 perClass 里为 shipClass 找到最合适的形状：
//   精确命中优先；否则从请求档位起沿"更低档位"方向找到第一个已定义的档位（优雅降级）。
function resolveShapeForClass(A, shipClass) {
  if (A.perClass[shipClass]) return A.perClass[shipClass];
  const startIdx = CLASS_FALLBACK_ORDER.indexOf(shipClass);
  // 若 shipClass 未知（不在顺序表里），从最低档 frigate 兜底。
  const from = startIdx >= 0 ? startIdx : CLASS_FALLBACK_ORDER.length - 1;
  for (let i = from; i < CLASS_FALLBACK_ORDER.length; i++) {
    const cls = CLASS_FALLBACK_ORDER[i];
    if (A.perClass[cls]) return A.perClass[cls];
  }
  return A.perClass[DEFAULT_CLASS] || A.perClass.frigate;
}

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
  // 优雅降级：并非所有锚点都定义了全部档位（如 Needle/Hammer/Broken/Lotus 仅到 battleship、
  //   Archaeology 仅到 capital）。若请求档位缺失，须回退到"最近的更低档位"而非直接跌到 frigate，
  //   否则 capital/supercapital 会拿到护卫舰船体却带 classTier=4/5 的细节（大小与细节不匹配）。
  //   （敌舰锚点是随机的，capital/supercapital 敌人可能落到没有该档位的锚点 → 此降级为必需的正确性保证。）
  const shape = resolveShapeForClass(A, shipClass);

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
export const SHIP_CLASSES = ["frigate", "destroyer", "cruiser", "battleship", "capital", "supercapital"];
