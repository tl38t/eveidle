# ShipContext 详细设计（Phase 2）

> 状态：设计 v2（2026-07-19）· 已采纳用户 3 条建议，进入代码实现（4 次提交节奏）
> 依赖文档：`AI_DEVELOPMENT_RULES.md` / `SHIP_DESIGN_LANGUAGE.md` / `PROCEDURAL_SHIP_GUIDE.md` / `SHIPFACTORY2_ROADMAP.md`
> 目标：建立 ShipFactory2 的"共享数据中心"ShipContext，让所有 Generator 从同一处读取船体几何/外观/随机，而不各自重算。
> 约束：本阶段不改视觉效果；`buildShip(options)` 对外 API 保持不变（AI Rules §10）；不触碰 `ShipFactory.js`。

---

## 0. 背景与现状痛点

读现有 `js/render3d/shipfactory2/` 代码，确认 Phase 2 要解决的真实冗余：

| 现状 | 问题 |
|---|---|
| `ShipFactory2.js` 用临时对象 `ctx = { spec, preset, palette, s, L, hybrid, role, family, hullMat, … }` | 不是正式模块，无法被独立测试/复用，且无 `radiusAt/normalAt/bounds/seed` 等字段 |
| `RibbonGenerator` / `ArmorGenerator` 各自用 `hullRadiusAt(z, preset.noseFat*s, preset.mid*s, preset.tail*s, L)` 重建 `R(z)` | 同一数学被复制 2 次；任一处改公式都会漂移（这正是发光缝反复出 bug 的隐性根因之一） |
| `Utils.js:preset_mid(spec)` | 与 `preset.mid` 重复，多一层间接 |
| 各 Generator 自己 `new THREE.MeshBasicMaterial`（Engine/Weapon） | 违反 AI Rules §6"材质集中 Materials.js" |
| 动画句柄靠 `ShipFactory2` 事后扫描 `part.userData.floaters/shield` | 耦合 coordinator 与子 group 内部结构，新增 Generator 易漏 |
| 无任何 `seed` / 确定性随机 | Phase 7 要的可复现无法落地；现在 `Math.random` 隐含风险 |

**Phase 2 的核心交付：把这些"散落的事实"收进一个正式 `ShipContext` 模块。**

---

## 1. ShipContext 应该保存哪些数据

按职责分六组。下面以"接口草图"呈现（仅签名与字段，非实现）：

```
class ShipContext {
  // ── A. 身份与输入语义 ──
  spec         // 原始 buildShip(options)，透传，便于扩展读取
  seed         // number|string：确定性随机种子（Commit 4 落地；缺省由 shipName 派生）
  shipClass    // = spec.hull：档位键（'frigate'|'destroyer'|'cruiser'|'battleship'|…）
  race         // 'player_shield'|'angel'|'blood'|'sansha'（= spec.line 语义名）
  family       // 'shield'|'armor'|'structure'（剪影家族，见 SHIP_DESIGN_LANGUAGE §4）
  role         // 'player'|'enemy'
  hybrid       // boolean（混血技术船：gale/bloodthorn/umbra）

  // ── B. 几何描述（由 shipClass 一次性派生）──
  hullProfile  // 解析后的 HULL_PRESETS[shipClass]：noseFat/mid/tail/wingSpan/ringRadius/engines/mounts/body/scale/len
  scale        // s = hullProfile.scale
  length       // L = hullProfile.len * s（世界长度）
  bounds       // 扩展包围信息（见下），供相机/Validator/LOD 复用，不必各自重算：
               //   { aabb:{min,max}, sphere:{center,radius}, length, maxRadius, center }

  // ── C. 表面数学（单一事实源 single source of truth）──
  radiusAt(z)                  // 轴向位置 -> 船体剖面半径（替代分散的 hullRadiusAt 调用）
  normalAt(z, angle)           // -> Vector3 外法线（径向 + 轴向导数）
  sampleHullSurface(z, angle, offset=0)  // -> Vector3 从 Hull 表面采样点 + 法线偏移（贴附原语）
  profilePoints               // lathe 剖面点数组（HullGenerator 直接消费，保证两端一致）

  // ── D. 外观 ──
  palette      // 解析后调色板：{ hull, dark, glow, accent, steel }
  materials    // { hull, dark, accent, steel, glass } 共享材质实例（一次构建，各 Generator 共用）

  // ── E. 随机 ──
  rng          // 主种子 RNG 实例
  random()     // -> [0,1)（主种子流）
  scope(name)  // -> 派生 RNG（按 Generator 名隔离，仍确定性）

  // ── F. 输出注册表（Generator 写，coordinator 读）──
  floaters     // [] 需逐帧动画的 mesh（环内浮游炮、引擎辉光…）
  shield       // mesh|null 护盾辉光层
  attachments  // Map<id,{type,position,normal,…}> 命名挂载点
  addAttachment(id, type, transform)  // 写入注册表
}
```

### 字段说明补充

- **`shipClass`**：文档 Phase 2 用词是 "Ship Class"，但项目里 `spec.hull` 才是档位键。内部统一叫 `shipClass`，由 `spec.hull` 解析而来，避免和"OOP class"混淆。
- **`race` vs `line`**：设计语言用"势力/线"（player_shield/angel/blood/sansha），Phase 2 文档叫 "Race"。内部用 `race` 承接 `spec.line`，语义一致。
- **`sampleHullSurface`（改名，采纳建议一）**：原构思名为 `surfacePoint`，但未来 Shield / Ring / Engine Bell / Armor Plate 各自都有"表面"，`surfacePoint` 易歧义。改名为 `sampleHullSurface`——语义明确为"从 Hull 表面采样一个点"，以后扩展不会混乱。
- **`bounds` 扩展（采纳建议二）**：不只 AABB。包含：
  - `aabb`：`{min:Vector3, max:Vector3}` 轴向包围盒（含 ringRadius 直径）
  - `sphere`：`{center:Vector3, radius:number}` 包围球（相机取景/LOD 最省事）
  - `length`：世界长度（沿 Z）
  - `maxRadius`：`max(hullMaxRadius, ringRadius)`
  - `center`：几何中心（用于居中/旋转基准）
  这样 LOD / Validator / Camera 全部能直接复用，不用每个人都重新算。
- **`cache` 删除（采纳建议三）**：本阶段**不做 Geometry Cache**。理由：Hull / Ribbon / Armor 几何都还未稳定，现在引入缓存无收益，只增加复杂度。已记入 TODO（Phase 9 §11 再做）。

---

## 2. 哪些数据属于 ShipContext，哪些留在 Generator

### 归属原则

> **数据 & 数学 → ShipContext；几何构造 → Generator。**
> 依据：`PROCEDURAL_SHIP_GUIDE §12`（所有尺寸由 ship size 推导）、Roadmap Phase 2（"所有 Generator 应统一从 ShipContext 获取数据，而不是重复计算"）、AI Rules §5（每个 Generator 单一职责）。

### 放进 ShipContext（共享、一次性派生、对 Generator 基本只读）

- 全部身份/输入语义（A 组）
- 几何描述 `hullProfile / scale / length / bounds`（B 组）—— 由 `shipClass` 解析一次
- **表面数学 `radiusAt/normalAt/sampleHullSurface/profilePoints`（C 组）—— 这是消除重复 `R(z)` 的关键**
- 外观 `palette / materials`（D 组）—— 一次构建，跨 Generator 复用（AI Rules §11 复用材质）
- 随机 `rng / random() / scope()`（E 组）
- 输出注册表 `floaters / shield / attachments`（F 组）—— Generator 可写，coordinator 读

### 留在 Generator（局部、每子系统私有）

- **该子系统的几何构造逻辑**：如 Ribbon 如何三角化发光缝、Armor 每块板放哪个 zone、Engine 分几层。这是 Generator 的"单一职责"，不应上提。
- **子系统专属参数选择**：Ribbon 的缝角度/宽度、Armor 的板数量/排布——这些是 Generator 的"设计决策"，不是共享数据。
- 局部临时变量、临时 `Vector3`、内部闭包 helper。
- 子 group 自身的层级组织（`THREE.Group` 嵌套）。

### 关键约束

- ShipContext 对 Generator **基本只读**（除 F 组输出注册表与 E 组 RNG 这两个"受控可写"资源）。Generator **不得**修改 `radiusAt`/`materials`/`hullProfile` 等共享状态——防止一个 Generator 污染另一个（AI Rules §5 避免全局状态）。
- `materials` 的实例由 ShipContext 持有并共享，Generator 只引用，不 `new`（满足 §6）。

### 迁移笔记（实现阶段用）

- 删除 `Utils.preset_mid` → Generator 改读 `ctx.hullProfile.mid`。
- `Ribbon`/`Armor` 中 2 处 `hullRadiusAt(z, …*s, …)` 全部改为 `ctx.radiusAt(z)`；贴附改用 `ctx.sampleHullSurface`。
- `ShipFactory2.js` 的临时 `ctx` 对象改为 `createShipContext(spec)`（Commit 1 已完成）。

---

## 3. 调用关系

依赖方向：**单向**。`ShipFactory2` 与所有 `Generator` 都依赖 `ShipContext`；`ShipContext` 只依赖 `Utils`/`Materials`，**不依赖任何 Generator**（无环）。Generator 之间互不直接依赖（未来通过 `ctx.attachments` 解耦协作）。

```
buildShip(options)
   │
   ├─ createShipContext(options)       // 解析身份/几何/外观/随机，一次性
   │
   ├─ ShipFactory2 编排（仅调用，不含逻辑）：
   │     generateHull(ctx)      ── 读 profilePoints, materials, palette
   │     generateRibbons(ctx)   ── 读 radiusAt, normalAt, sampleHullSurface, palette
   │     generateArmor(ctx)     ── 读 radiusAt, sampleHullSurface, materials
   │     generateWeapons(ctx)   ── 读 sampleHullSurface, hullProfile(ringRadius/mounts),
   │     │                         palette, materials；写 ctx.floaters / ctx.attachments
   │     generateEngines(ctx)   ── 读 length, palette, materials；写 ctx.floaters
   │
   └─ 汇总 ship.userData.floaters / .shield / .attachments（Commit 4 后可由 ctx 注册表直接读）
```

下图为依赖关系（箭头 = "依赖/读取"）：

（见随附架构图：ShipContext 居中，ShipFactory2 与 5 个 Generator 单向指向它。）

---

## 4. 未来新增 Generator 如何使用 ShipContext

新增 Generator = 两步，不动已有代码（符合 AI Rules §16"优先扩展而非重写"）：

1. **写 Generator**：`export function generateXxx(ctx) { … return group; }`，内部只读 `ctx`：
   - 贴曲面 → `ctx.sampleHullSurface(z, angle, offset)` / `ctx.normalAt(z, angle)`
   - 尺寸推导 → `ctx.scale` / `ctx.length` / `ctx.hullProfile.*`
   - 配色 → `ctx.palette`；材质 → `ctx.materials`
   - 变化 → `ctx.scope("xxx").random()`（隔离随机）
   - 暴露锚点 → `ctx.addAttachment("xxx.mount.0", "sensor", { position, normal })`
   - 动画 → `ctx.floaters.push(mesh)`
2. **注册**：在 `ShipFactory2` 的流水线里 `parts.push(generateXxx(ctx))`。

### 各未来 Generator 的典型用法

| Generator | 主要读取 | 主要写入 |
|---|---|---|
| `EngineGenerator`（已有） | `length`, `materials`, `palette` | `floaters`（尾焰） |
| `WeaponGenerator`（已有） | `sampleHullSurface`, `hullProfile.ringRadius/mounts` | `floaters`, `attachments`（hardpoint） |
| `PanelGenerator`（Phase 4） | `sampleHullSurface`, `scope("panel").random()` | 无（纯几何） |
| `SensorGenerator`（Phase 5） | `sampleHullSurface`, `attachments`（消费 Weapon 发布的 hardpoint 邻位） | `attachments`（sensor mount） |
| `DecorationGenerator`（Phase 5） | `sampleHullSurface`, `scope("decoration").random()` | 无 |
| `ShieldGenerator`（路线 §5 列表） | `bounds`, `palette.glow` | `shield` |

### 与 Phase 6 RaceStyle 的衔接

Phase 6 要求"Generator 不含种族判断，种族差异全来自 RaceStyle"。ShipContext 已是天然隔离层：`ctx.palette` 封装了种族配色，`ctx.family` 封装了剪影家族。RaceStyle 落地时只需让 ShipContext 在构造期用 `RaceStyle` 覆盖 `palette`/`hullProfile` 的若干字段，**Generator 代码零改动**。这是 ShipContext 存在的最重要长期收益之一。

---

## 5. 是否应提供统一随机接口 `ctx.random()`

**应提供，且必须提供。** 理由：

1. **可复现（硬需求）**：`PROCEDURAL_SHIP_GUIDE §13` 与 Roadmap Phase 7 明确要求"同 seed → 同 ship"。散落的 `Math.random()` 会彻底破坏这一点。RNG 收口到 ShipContext 才能强制确定性。
2. **单一事实源（可维护性）**：一个种子、一个 RNG 实例，Generator 内无隐藏随机（AI Rules §1 可维护性优先）。
3. **可验证**：Phase 8 Validator 能用同 seed 重跑比对；回归测试 `tools/test_shipfactory2.mjs` 可锁定输出。
4. **一致视觉**：共享流让整艘船的变化风格统一。

### 设计细节：`random()` + `scope(name)`

- 主种子流 `ctx.random()` 提供 `[0,1)`。
- 但所有 Generator 共用同一条流，会让"Generator 调用顺序"意外影响彼此输出。故增加 `ctx.scope(name)`：基于主种子 + Generator 名派生**隔离的确定性子流**。每个 Generator 用 `ctx.scope("weapon").random()`，顺序变化不再串扰，仍完全可复现。
- `seed` 缺省时 ShipContext 应给一个稳定默认（如由 `spec.id` 哈希），保证"不传 seed 也能跑"，同时"传同 seed 必同船"。

> 注意：RNG 是 ShipContext 中除 F 组输出注册表外**唯一允许被 Generator 改变的共享状态**，但这是受控的、有意的资源，不构成"全局可变几何"。

---

## 6. 未来共享数据：现在实现 vs 以后实现

用户列出的候选：Surface Sample / Attachment Point / Hardpoint / Bounding Volume / LOD / Cached Geometry。

| 数据 | 决策 | 理由 |
|---|---|---|
| **Surface Sample**（预采样表面点阵） | **以后（Phase 4）** | `sampleHullSurface(z,angle)` 已覆盖绝大多数贴附需求；预采样点阵是 Phase 4 表面生成的性能优化，Phase 2 不急需，先留接口 |
| **Attachment Point**（命名挂载点） | **现在建注册表结构，具体内容各 Phase 填** | `ctx.attachments` Map + `addAttachment()` 现在落地（空表）。Weapon/Engine 在各自 Phase 填充 hardpoint/engine-mount，Sensor 消费。结构先行，内容后填 |
| **Hardpoint**（武器挂点） | **归入 Attachment Point** | 不单列；作为 `attachments` 中 `type:"hardpoint"` 的条目。Phase 5 Weapon 填充 |
| **Bounding Volume** | **现在实现（扩展版，采纳建议二）** | `ctx.bounds` 由 `hullProfile` 廉价派生，包含 `aabb / sphere / length / maxRadius / center`，相机取景、Phase 8 Validator、LOD 都要用，零成本 |
| **LOD** | **以后（Phase 9）** | 属渲染/几何切换，不在 Phase 2 范畴。ShipContext 可预留 `ctx.lodLevel` 占位，但真实逻辑 Phase 9 做 |
| **Cached Geometry** | **删除，TODO Phase 9（采纳建议三）** | 目前 Hull/Ribbon/Armor 几何未稳定，引入缓存无收益且增复杂度。删去 `cache` 接口，待 Phase 9 §11 再评估 |

### Phase 2 落地的共享数据清单（最终）

**现在实现**：身份语义（A）、几何描述 `hullProfile/scale/length/bounds`（B，bounds 已扩展）、表面数学 `radiusAt/normalAt/sampleHullSurface/profilePoints`（C）、外观 `palette/materials`（D）、随机 `rng/random()/scope()`（E）、输出注册表 `floaters/shield/attachments` + `addAttachment`（F）。

**以后实现**：Surface Sample 点阵（Phase 4）、LOD（Phase 9）、Cached Geometry 策略（Phase 9，已删除现接口）。

---

## 7. Phase 2 落地步骤（4 次提交节奏，已确认）

> 原则：每提交一个目标、独立可运行、视觉零变化（以 `tools/test_shipfactory2.mjs` 几何指纹校验）。
> 一次改 ShipContext+Generator+Materials+Random 全部，出了 Bug 难定位；故拆 4 次。

**Commit 1 — 建立 ShipContext 基础框架（视觉零变化）**
- 新增 `ShipContext.js`（`createShipContext(spec)` 工厂 + `ShipContext` class）。
- `ShipFactory2.js` 改为 `const ctx = createShipContext(spec)`；去掉临时 ctx 内联构造。
- 五个 Generator **接口不变**（ctx 字段名保持一致：spec/preset/palette/s/L/hybrid/role/family + 材质）。
- 目标：程序还能跑，视觉 100% 不变。

**Commit 2 — 统一 Hull 曲率接口**
- `ShipContext` 增加 `radiusAt(z)` / `normalAt(z, angle)` / `sampleHullSurface(z, angle, offset)`（C 组表面数学）。
- `Ribbon` / `Armor` 删除本地 `R(z)`，改用 `ctx.radiusAt` / `ctx.sampleHullSurface`。
- 删除 `Utils.preset_mid`，Generator 改读 `ctx.hullProfile.mid`。
- 目标：消除重复 `R(z)`，几何指纹不变。

**Commit 3 — 统一材质管理（修复 MeshBasicMaterial 违规）**
- `Materials.js` 增加工厂：`exhaustMaterial(color)` / `shieldBubbleMaterial(color, opacity, side)` 等。
- `EngineGenerator` / `WeaponGenerator` 删除 `new THREE.MeshBasicMaterial`，改用工厂。
- 目标：满足 AI Rules §6，几何指纹不变。

**Commit 4 — 引入 seed / random / scope（为 Phase 7 准备）**
- `ShipContext` 增加 `seed` / `rng` / `random()` / `scope(name)`（E 组）。
- 主种子由 `spec.seed` 或 `shipName` 派生；`scope` 用字符串哈希派生隔离子流（mulberry32）。
- 当前 Generator 尚未消费随机，但接口先行，几何指纹不变。
- 目标：Phase 7 可复现提前就绪。

---

## 8. 风险与开放问题

- **`normalAt` 精度**：当前 lathe 为 8 段棱面，近似径向法线对贴附足够；若 Phase 4 要更精确，可改为读 lathe 实际面法线。
- **`scope()` 子流算法**：用字符串哈希混入主种子（如 `mulberry32(hash(seed + name))`）。
- **是否现在引入 `RaceStyle` 字段**：建议 Phase 2 先在 `ctx` 预留 `raceStyle` 占位（默认由 `race` 推导），Phase 6 再充实，避免届时改构造签名。
- **`bounds.sphere` 中心**：默认取 `aabb` 中心；若结构环使质心偏移，可在 Phase 8 Validator 阶段再校准。

---

_设计已确认，按 §7 的 4 次提交节奏进入代码实现阶段。_
