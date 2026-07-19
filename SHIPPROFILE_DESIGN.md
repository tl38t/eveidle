# ShipProfile Design
# ShipProfile（整舰 DNA）实现设计

Version 1.0 — Phase 3（2026-07-19）

本文档采纳用户 4 条建议，将原计划中的 `HullProfile` 升级为 **`ShipProfile`**（整舰 DNA）。

---

# 0. 为什么改名（建议 1）

`HullProfile` 不该只是 Hull 的参数，而应是**整艘程序化舰船的 DNA**。

Hull 只是其中一个字段。未来 `Engine` / `Weapon` / `Ribbon` / `Sensor` / `Decoration` 都从**同一个 ShipProfile** 读取各自段落。这样后续模块天然建立在同一套设计基础上，无需二次大重构。

> 命名说明：因本概念升级为 ShipProfile，设计文档命名为 `SHIPPROFILE_DESIGN.md`（而非 `HULLPROFILE_DESIGN.md`），避免名字与概念打架。

---

# 1. ShipProfile Schema（草案）

```js
ShipProfile = {
  hull:       { curve, widthRatio, radialSegments, twist, asymmetry },
  engine:     { style:'integrated'|'external', count, spacing },   // Phase 5 落地
  weapon:     { mountStyle:'inline'|'wing'|'ring'|'belly' },        // Phase 5
  sensor:     { style:'dish'|'array'|'blade' },                     // Phase 5
  decoration: { density, style },                                  // Phase 9
}
```

- **Phase 3 只落地 `hull` 段**；其余段先占位（schema 预留），待对应 Phase 填充。
- `HullGenerator` 只读 `ctx.profile.hull`。
- 未来 `EngineGenerator` 读 `ctx.profile.engine`，`WeaponGenerator` 读 `ctx.profile.weapon`……互不耦合。

---

# 2. 锚点存区间，不存终值（建议 3）

**Anchor 是 DNA，Seed 是变异。**

Anchor 用有界区间描述；`buildProfile` 用 `rng` 在区间内 `lerp` 出终值。

```js
// Anchor（风格 DNA，存区间）
const ANCHORS = {
  Spear: {
    hull: {
      widthRatio:    [0.75, 0.90],
      radialSegments: 8,
      twist:         [0.0, 0.08],
      asymmetry:     [0.0, 0.05],
      curve:         [ /* 点数组，见第 5 节；Phase 5 改 Curve Function */ ],
    }
  },
  // Needle / Blade / Hammer / Organic / Industrial / Broken / Lotus ...
};

// buildProfile：把区间解析成终值
function buildProfile({ anchor, raceStyle, faction, shipClass, seed, ctx }) {
  const rng = ctx.scope('ship');              // Phase 2 已落地的确定性子流
  const a = ANCHORS[anchor].hull;
  const cls = CLASS_SCALE[shipClass];         // class 只负责缩放比例
  return {
    hull: {
      widthRatio:    lerp(a.widthRatio[0],    a.widthRatio[1],    rng()),
      radialSegments: a.radialSegments,
      twist:         lerp(a.twist[0],         a.twist[1],         rng()),
      asymmetry:     lerp(a.asymmetry[0],     a.asymmetry[1],     rng()),
      curve:         a.curve,                  // class 负责整体缩放（ctx.scale/ctx.length）
      _classScale:   cls,
    }
  };
}
```

> 解析后的终值再交给 `ShipContext`，由 `ctx.radiusAt(z)` 等继续委托给 hull 段（与 Phase 2 一致）。

---

# 3. 锚点是「风格」不是「种族」（建议 2）

锚点表以**风格**命名，不以种族命名（见 `SHIP_STYLE_SYSTEM.md` 的 8 个候选）。

`RaceStyle` 通过 **Style Resolver**（`resolve()`）引用锚点，而非静态权重表——以后 Resolver 可随等级/科技/阵营/Boss 动态调整：

```
Amarr = { resolve: () => ({ Spear:0.8, Hammer:0.2 }) }
```

`ShipContext` 解析时：先调 `raceStyle.resolve(...)` 得到锚点分布，按分布挑一个锚点（用 `ctx.scope('anchor').random()` 抽样），再 `buildProfile` 出几何。

→ Boss 可混合多个锚点（`resolve() => { Spear:0.4, Organic:0.4, Broken:0.2 }`），**无需新增 Race**。

> 注：Phase 3 的 `buildProfile` 先接受显式 `anchor`；`RaceStyle.resolve()` 的完整落地在 Phase 6，但命名与契约在此提前锁定。

---

# 4. ShipContext 归属

- `ShipContext` 持有**已解析**的 `ctx.profile`（由 `ShipProfile.buildProfile` 从 spec 解析）。
- `ShipContext` 不改 Hull 数学：`radiusAt` / `normalAt` / `sampleHullSurface` 继续委托给 `ctx.profile.hull`。
- 解析入口：`spec` 提供 `{ raceStyle, faction, shipClass, seed }`（或兼容旧 `{ hull, family, role }`）。

---

# 5. curve 用 Curve Function（建议 4，延至 Phase 5）

Phase 3 先用**点数组** `curve: [{z,r}, ...]`（最小改动、指纹易对齐）。

Phase 5 起把 `curve` 升级为 **Curve Function**：

```js
profile.curve = { type:'CatmullRom'|'Bezier'|'Hermite', points:[...] };
// HullGenerator 只调：
const r = profile.curve.sample(z);
```

→ `HullGenerator` 以后**不知道有几个点**，改轮廓只改 Anchor 的 curve 定义。本阶段（Phase 3）不实现。

---

# 6. Phase 3 实施节奏（4 次提交）

沿用「先设计，再小步实现」原则，每步用 `tools/test_shipfactory2.mjs` 几何指纹回归。

### Commit 1 — 建立 ShipProfile 系统（零视觉变化）
- 新增 `js/render3d/shipfactory2/ShipProfile.js`：
  - `ANCHORS` 锚点表（先放 `Spear` 1 个，对齐现有护盾线）
  - `ShipProfile` Schema 定义
  - `buildProfile({anchor, raceStyle, faction, shipClass, seed, ctx})` builder
- **不改任何 Generator**。视觉不变（尚未接入）。

### Commit 2 — ctx.profile + HullGenerator 改读（视觉 100% 不变）
- `ShipContext` 改为持有 `ctx.profile`（由 `buildProfile` 解析，对现有 5 艘原型船解析到与旧 `HULL_PRESETS` **完全相同**的几何）。
- `HullGenerator` 改读 `ctx.profile.hull`。
- **指纹必须逐项一致**（视觉零变化被数字证明）。

### Commit 3 — 删除 HULL_PRESETS，全迁移
- 删除 `Utils.HULL_PRESETS`。
- 原型 spec 改为 `(raceStyle, faction, shipClass)` 形式（护盾线 → `Amarr`/`Spear`/对应档位）。
- **指纹逐项一致**。

### Commit 4 — 增加 5~10 个 Anchor + 验证 seed 变异
- 新增锚点：`Needle` / `Blade` / `Hammer` / `Organic` / `Industrial` / `Broken` / `Lotus` 等。
- 验证：**同一 Anchor + 不同 Seed → 明显不同但风格一致的舰体**（几何指纹不同，但锚点约束范围内）。

---

# 7. 回归保证

- `Commit 2 / Commit 3`：5 舰几何指纹（meshes / verts / posSum / bbox）必须与 Phase 2 基线**逐项一致** → 视觉零变化。
- `Commit 4`：验证 seed 变异有效（同锚点不同 seed → 指纹不同，但仍在锚点区间内、风格一致）。

---

# 8. 与路线图的关系

- 原 Roadmap `Phase 3 Procedural Hull` → 本设计扩展为 **Ship Profile / Style System**。
- `Phase 6 Race Style System` 的契约在本系统的 Level 2/3 提前定义（RaceStyle / Faction Modifier），但外观落地仍在 Phase 6。
- `Phase 5` 落地 `engine` / `weapon` / `sensor` 段，并接入建议 4 的 Curve Function。

---

End of document.
