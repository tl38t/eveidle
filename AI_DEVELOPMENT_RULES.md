# AI Development Rules
# AI 开发规范

Version: 1.0

This document defines the mandatory development rules for all AI assistants working on this repository.

本文档定义了所有 AI 助手在本仓库中开发时必须遵守的规则。

The objective is not only to generate working code, but to maintain a clean, modular and scalable long-term architecture.

本项目的目标不仅是生成可运行的代码，更是建立一个长期可维护、模块化、可扩展的软件架构。

---

# 1. Project Philosophy
# 1. 项目理念

This is a long-term project.

这是一个长期维护的项目。

Never optimize for short-term convenience at the cost of long-term maintainability.

不要为了短期方便而牺牲长期可维护性。

When in doubt, follow these priorities:

如果遇到选择困难，请遵循以下优先级：

Maintainability > Cleverness

Readability > Short Code

Consistency > Personal Preference

中文：

- 可维护性 > 炫技
- 可读性 > 少写几行代码
- 一致性 > 个人写法

---

# 2. Development Workflow
# 2. 开发流程

Large refactors must be divided into small independent commits.

大型重构必须拆分成多个独立提交。

Each task should be independently runnable.

每一个阶段都必须能够独立运行。

Example:

例如：

✓ Create RibbonGenerator

Commit

✓ Replace TubeGeometry

Commit

✓ Add ArmorGenerator

Commit

不要一次修改多个系统。

---

# 3. Existing Code
# 3. 对待已有代码

Respect stable code.

尊重已经稳定运行的代码。

Do not rewrite working systems without a clear reason.

不要随意重写已经工作的模块。

When introducing a new architecture:

引入新架构时，应遵循：

Create new module

↓

Test

↓

Replace old implementation

先新增模块，再测试，最后替换旧实现。

---

# 4. ShipFactory Architecture
# 4. ShipFactory 架构

ShipFactory is the coordinator only.

ShipFactory 只负责协调，不负责具体逻辑。

Its responsibilities are:

职责仅包括：

- receive build options
- 接收建造参数

- call generators
- 调用各个 Generator

- assemble the final ship
- 组合最终舰船

Business logic must stay inside generators.

所有生成逻辑必须放入 Generator。

---

# 5. Generator Rules
# 5. Generator 规范

Every subsystem must become an independent generator.

每一个子系统都应该成为独立 Generator。

Examples:

例如：

HullGenerator

RibbonGenerator

ArmorGenerator

PanelGenerator

EngineGenerator

WeaponGenerator

SensorGenerator

ShieldGenerator

Every generator should:

每个 Generator 必须：

- have only one responsibility
- 只负责一个功能

- return THREE.Object3D
- 返回 THREE.Object3D

- avoid global state
- 不依赖全局变量

---

# 6. Materials
# 6. 材质管理

Materials must be centralized.

所有材质必须统一管理。

Do NOT create materials inside generators.

不要在 Generator 内直接 new Material。

Use:

统一使用：

Materials.js

Example:

createMetalMaterial()

createGlowMaterial()

createArmorMaterial()

这样可以减少重复材质并方便后期优化。

---

# 7. Geometry
# 7. 几何生成

Avoid huge geometry functions.

不要编写超大的几何生成函数。

Prefer:

推荐结构：

Hull

↓

Armor

↓

Panels

↓

Grooves

↓

Glow

↓

Engine

Instead of one giant function.

不要所有内容都塞进一个函数。

---

# 8. Visual Details
# 8. 视觉细节

Choose geometry based on visual quality.

根据视觉效果选择几何方案。

Example:

例如：

Avoid TubeGeometry for glowing grooves.

不要使用 TubeGeometry 制作舰体发光缝。

Prefer ribbon geometry following the hull surface.

优先使用贴合舰体表面的 Ribbon Mesh。

Visual quality is more important than implementation simplicity.

视觉效果优先于实现简单。

---

# 9. Code Style
# 9. 代码规范

Recommended maximum function size:

建议函数长度：

≈150 lines

Recommended maximum file size:

建议文件长度：

≈500 lines

Avoid deeply nested logic.

避免过深嵌套。

Use descriptive names.

使用清晰的函数命名。

Avoid magic numbers.

避免出现魔法数字。

Use constants whenever possible.

尽量使用常量。

---

# 10. API Stability
# 10. API 稳定性

External APIs should remain stable.

外部接口必须保持稳定。

Example:

buildShip(options)

Internal implementation may change completely.

内部实现可以完全重写。

But external API should remain compatible.

但外部调用方式应尽量保持一致。

---

# 11. Performance
# 11. 性能原则

Reuse materials.

复用材质。

Reuse geometry.

复用 Geometry。

Avoid unnecessary draw calls.

减少 Draw Call。

Optimization should never sacrifice readability.

优化不能降低代码可读性。

---

# 12. Git
# 12. Git 提交规范

Every completed feature should become one commit.

每完成一个功能，就提交一次 Git。

Good examples:

好的 Commit：

Create HullGenerator

Implement RibbonGenerator

Add Armor Panels

Improve Engine Geometry

Bad examples:

不好的 Commit：

Update

Fix

Changes

Stuff

Commit 信息应描述"完成了什么功能"，而不是"改了什么东西"。

---

# 13. Documentation
# 13. 文档维护

Whenever architecture changes:

只要架构发生变化：

Update the documentation.

同步更新文档。

Documentation is part of the project.

文档属于项目的一部分。

Never leave documentation outdated.

不要让文档落后于代码。

---

# 14. Before Writing Code
# 14. 编码前

Before implementing anything, AI should read:

开始开发前，AI 必须阅读：

SHIP_DESIGN_LANGUAGE.md

AI_DEVELOPMENT_RULES.md

Other future architecture documents

其它未来新增的架构文档

Implementation must follow these documents.

所有开发必须遵循这些文档。

---

# 15. Decision Priority
# 15. 决策优先级

When multiple solutions exist:

如果存在多个方案：

1. Correctness
   正确性

2. Maintainability
   可维护性

3. Modularity
   模块化

4. Readability
   可读性

5. Performance
   性能

6. Simplicity
   实现简单

Never sacrifice architecture for short-term convenience.

不要为了短期方便而破坏整体架构。

---

# 16. AI Behavior
# 16. AI 行为规范

Do not silently redesign the project.

不要擅自重构整个项目。

If a request affects the overall architecture, explain the trade-offs before implementing it.

如果修改会影响整体架构，请先说明利弊，再开始修改。

When requirements are unclear, ask questions instead of making assumptions.

需求不明确时，请先询问，而不是自行猜测。

Prefer extending the existing architecture over replacing it.

优先扩展现有架构，而不是直接推倒重写。

---

# 17. Project Vision
# 17. 项目愿景

The long-term goal is to build a procedural spaceship generation framework inspired by EVE Online.

本项目的长期目标是打造一个受《EVE Online》启发的程序化舰船生成框架。

Ships should be generated from reusable systems instead of handcrafted models.

舰船应由可复用的程序化系统生成，而不是依赖手工建模。

Every new feature should move the project closer to this vision.

每新增一个系统，都应推动项目向这一目标前进。

---

# 18. ShipProfile Immutability
# 18. ShipProfile 不可变

ShipProfile is read-only data. It describes what a ship should look like (its DNA).

ShipProfile 是只读数据，描述"这艘船应该长什么样"（它的 DNA）。

Generators MUST NOT modify `ctx.profile` (or any of its nested fields such as `ctx.profile.hull`).

Generator 禁止修改 `ctx.profile`（以及其任何嵌套字段，例如 `ctx.profile.hull`）。

Forbidden example:

禁止示例：

```js
ctx.profile.hull.widthRatio *= 1.2;   // ✗ 一旦出现，Generator 执行顺序就会影响结果
```

If a generator needs different values, it must derive a new local copy instead of mutating the shared profile.

如果 Generator 需要不同的数值，应复制出一份新的局部数据，而不是修改共享的 Profile。

Why: a mutable profile makes generation order-dependent and non-reproducible. Immutability guarantees that the same `(profile, seed)` always yields the same ship regardless of which generator runs first.

原因：可变的 Profile 会让生成结果依赖 Generator 的执行顺序、破坏可复现性。只读保证同一 `(profile, seed)` 无论哪个 Generator 先跑都产出同一艘船。

ShipProfile = Immutable.

ShipProfile = 不可变。

---

# 19. Generator Configuration Access
# 19. Generator 配置访问

Generators MUST NOT import or read configuration / preset files directly (HULL_PRESETS, ANCHORS, CONFIG, etc.).

Generator 禁止直接 import 或读取配置文件 / 预设（HULL_PRESETS、ANCHORS、CONFIG 等）。

All design parameters must flow through ShipContext, especially `ctx.profile`.

所有设计参数必须通过 ShipContext 传递，尤其是 `ctx.profile`。

Allowed data sources for a Generator:

Generator 唯一允许读取的数据源：

- `ctx.profile` — the ship DNA (read-only, see §18)
- `ctx.profile` — 整舰 DNA（只读，见 §18）
- `ctx.materials` — shared materials (see §6)
- `ctx.materials` — 共享材质（见 §6）
- `ctx.bounds` — shared bounding info
- `ctx.bounds` — 共享包围信息
- `ctx.random()` / `ctx.scope(name)` — deterministic RNG (Phase 2)
- `ctx.random()` / `ctx.scope(name)` — 确定性随机（Phase 2）
- `ctx.<runtime fields>` — geometry / identity already resolved by ShipContext
- `ctx.<运行时字段>` — 已由 ShipContext 解析好的几何 / 身份数据

Forbidden:

禁止：

```js
import { HULL_PRESETS } from "./Utils.js";   // ✗ Generator 不应直接依赖配置
const preset = HULL_PRESETS[class];           // ✗ 应通过 ctx.profile 获取
```

Why: this keeps Generators as pure geometry executors. The moment a Generator reads a config file, the data flow `Game Spec → Style Resolver → ShipProfile → ShipContext → Generators → Mesh` develops a bypass, and style / race changes can no longer be made in a single place.

原因：这保证 Generator 是真正的「纯几何执行器」。一旦 Generator 直接读配置，数据链路 `Game Spec → Style Resolver → ShipProfile → ShipContext → Generators → Mesh` 就会出现旁路，风格 / 种族的修改也就无法再在单一位置完成。

---

# 20. Localization (single source of truth)
# 20. 本地化（唯一真值源）

All player-visible strings live in ONE wide table — `D:/EVE-IDLE/localization/localization-master.csv`
(its own git repository, NOT inside this one). One row per source string, one column pair per language.

所有玩家可见文案只存在于一张宽表 —— `D:/EVE-IDLE/localization/localization-master.csv`
（独立的 git 仓库，**不在**本仓库内）。一行 = 一条原文，每种语言一对列。

```bash
node localization/localization-sync.mjs              # 查看源码新增文案 + 待办量（只读）
node localization/localization-sync.mjs --write      # 收新文案进表（status=todo ⇒ 运行时零变化）
node localization/build-runtime-catalog.mjs          # 表 → js/i18n/catalog-*.js  ★ 改完表必跑
node localization/build-runtime-catalog.mjs --check  # 校验生成物与表一致（不一致 exit 1）
```

Rules / 规则：

- MUST NOT create a second per-language catalog table, and MUST NOT hand-edit `js/i18n/catalog-*.js`.
  禁止再产生任何「按语言拆分」的目录表，禁止手改 `js/i18n/catalog-*.js`。
- MUST bump `?v=` on every page that loads the catalogs (`index.html`, `legion-starmap-pure.html`)
  after regenerating them. Per-page script lists are independent — a missed bump silently serves a stale catalog.
  重新生成后必须 bump 每个加载目录的页面的 `?v=`（`index.html`、`legion-starmap-pure.html`）。
  各页加载清单互相独立 —— 漏 bump 会静默沿用旧目录。
- Achievements / starmap do NOT go through the catalog (they use embedded locale tables); their entries are `deferred`.
  成就 / 星图 不走 catalog（用内嵌多语表），其词条一律标 `deferred`。

Full pipeline, status vocabulary, migration audit and known debt → `localization/README.md`.
完整管线、状态词表、迁移审计与历史债务 → `localization/README.md`。

---

End of document.

文档结束。