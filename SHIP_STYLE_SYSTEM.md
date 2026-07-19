# Ship Style System
# 舰船视觉风格系统

Version 1.0 — Phase 3 设计文档（2026-07-19）

---

# 目标

规定**整个游戏**的视觉语言，让以下所有 Generator 都遵循同一套体系，而不是各自演化出不同的风格：

- HullGenerator
- EngineGenerator
- PanelGenerator
- RibbonGenerator
- WeaponGenerator
- SensorGenerator
- DecorationGenerator

最终能力：

- **新增一个阵营/势力** → 只新增 `RaceStyle` / `Faction Modifier`，**不修改任何 Generator**。
- **新增一艘船** → 只填 `(Style Anchor, RaceStyle, Faction, Seed)` 四元组。

---

# 四级层级（Level 1 → 4 → 生成舰船）

```
Level 1  Style Anchor       风格锚点（形状 DNA，与阵营无关）
   ↓
Level 2  RaceStyle          种族风格（外观 + 锚点权重表）
   ↓
Level 3  Faction Modifier   势力修饰（纯换皮）
   ↓
Level 4  Seed Mutation      种子变异（区间内有界扰动）
   ↓
        Generated Ship      生成的舰船
```

---

# Level 1 — Style Anchor（形状 DNA，与阵营无关）

纯几何 / 剪影原型。决定一艘船「长什么样」，**不含任何颜色 / 阵营 / 材质信息**。

锚点以「风格」命名，不以「种族」命名。后续 Boss / NPC / 玩家可以共享同一个锚点。

候选锚点（可扩展）：

| 锚点 | 视觉特征 | 备注 |
|------|----------|------|
| `Needle` 针 | 极细长、尖鼻 | 侦察 / 高速 |
| `Spear` 矛 | 流线、中等收尖 | 护盾激光线（shield family） |
| `Blade` 刃 | 扁平、宽切面 | 装甲线（armor family） |
| `Hammer` 锤 | 厚重、方正 | 结构线（structure family） |
| `Organic` 有机 | 圆润、平滑 | Gallente 感 |
| `Industrial` 工业 | 方正、Flat、功能化 | Caldari 感 |
| `Broken` 破碎 | 不对称、断裂、开放框架 | Minmatar 感 |
| `Lotus` 莲 | 对称绽放、多层环 | 姐妹会 / 结构环感 |

每个锚点用**有界参数区间**描述（见 `SHIPPROFILE_DESIGN.md`）。锚点是「DNA」，不是「终值」。

---

# Level 2 — RaceStyle（种族风格，Style Resolver）

把「外观」与「几何」彻底解耦。

`RaceStyle` 的核心是一个 **Style Resolver**（而非静态权重表）：

```
RaceStyle
   ↓ resolve(shipClass, tech, faction, seed, ...)
ShipProfile
```

它包含两部分：

1. **外观**：调色板、辉光色、面板密度、装甲风格、装饰风格（这部分在 Phase 6 完整落地，但在此定义契约）。
2. **Style Resolver**：`resolve()` 决定该种族由哪些锚点构成、并可随上下文动态调整。

为什么叫 Resolver 而不是「权重表」：以后它不只是 `50% / 30% / 20%` 这种静态混合，还可能：

- 根据舰船等级调整风格
- 根据科技等级调整参数
- 根据阵营添加特殊结构
- 根据 Boss 身份加入额外模块

所以它本质是一个**解析器（Resolver）**，不是一张表。提前如此命名，以后不用改。

示例（Resolver 的一种最简实现——静态锚点混合）：

```
Amarr     = { palette: 金/青,  resolve: () => ({ Spear:0.8, Hammer:0.2 }) }
Gallente  = { palette: 绿/白,  resolve: () => ({ Organic:0.7, Lotus:0.3 }) }
Caldari   = { palette: 蓝/灰,  resolve: () => ({ Industrial:0.8, Blade:0.2 }) }
Minmatar  = { palette: 红/锈,  resolve: () => ({ Broken:0.7, Spear:0.3 }) }
```

**关键规则**：Generator 内部禁止出现 `race` / `family` / `hybrid` 条件分支。所有差异来自 `RaceStyle` 的 `resolve()`。

这样以后 Boss 可以混合多个锚点（`resolve() => { Spear:0.4, Organic:0.4, Broken:0.2 }`），而**完全不需要新增 Race**。

---

# Level 3 — Faction Modifier（势力修饰，纯换皮）

Empire / Navy / Pirate / Sansha / Blood Raider / Guristas。

只做：

- 调色板偏移（换皮）
- 细节修饰（trim / 标记 / 舰徽）

**不改几何、不改锚点**。

示例：

- `Sansha` = `Amarr` 的 RaceStyle + 暗红换皮
- `Blood Raider` = `Amarr` + 血红换皮

→ 完全无需新增 Race，也无需修改任何 Generator。

---

# Level 4 — Seed Mutation（种子变异）

在同一个 `(Anchor, RaceStyle, Faction)` 下，`seed` 在锚点参数**区间**内做有界扰动：

- `widthRatio`
- `twist`
- `curve`
- `panel density`
- `engine spacing`

契约：

- 同 `(Anchor, RaceStyle, Faction, Seed)` → **同船**（可复现，依赖 Phase 2 的 `ctx.seed/random/scope`）。
- 不同 `Seed` → **明显不同但风格一致**的船。

---

# 关键原则（落到代码上的硬约束）

1. **几何（Anchor）与阵营完全无关**；阵营只影响外观 + 锚点权重混合。
2. **锚点是「风格」不是「种族」**——Boss / NPC / 玩家可共享同一锚点。
3. **Profile 存区间，Seed 负责变异**（锚点 + Mutation）。
4. **新增阵营 = 新增 RaceStyle / FactionModifier**；**新增舰船 = 四元组**。Generator 零改动。

---

# 与其他文档的关系

- `SHIPFACTORY2_ROADMAP.md`：9 阶段路线图。本系统是 Phase 3（Procedural Hull / Ship Profile）的视觉语言底座，并提前定义 Phase 6（RaceStyle）的契约。
- `SHIPPROFILE_DESIGN.md`：ShipProfile 的实现设计（schema / Anchor 区间 / buildProfile / 4-commit 节奏）。
- `SHIPCONTEXT_DESIGN.md`：ShipContext 作为共享数据中心，持有解析后的 `ctx.profile`。

---

End of document.
