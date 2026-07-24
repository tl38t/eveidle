# ShipFactory2 Development Roadmap
# ShipFactory2 开发路线图

Version 1.0

---

# Project Goal
# 项目目标

ShipFactory2 is not a simple model generator.

ShipFactory2 is a procedural spaceship generation framework.

ShipFactory2 不是一个简单的模型生成器。

它是一个程序化舰船生成框架（Procedural Spaceship Generation Framework）。

The long-term objective is to generate a large variety of visually consistent spaceships inspired by EVE Online without relying on handcrafted models.

长期目标是在不依赖手工建模的前提下，生成大量具有统一设计语言、受《EVE Online》启发的原创舰船。

The framework should be modular, scalable, deterministic and easy to maintain.

整个框架应具有：

- Modular（模块化）
- Scalable（可扩展）
- Deterministic（可复现）
- Maintainable（易维护）

---

# Core Philosophy
# 核心理念

A ship should be assembled from many independent systems rather than built as one large object.

舰船应该由多个独立系统组合生成，而不是一个巨大函数一次性生成。

Each subsystem should only solve one problem.

每个 Generator 只负责一个功能。

Every new feature should improve the architecture instead of increasing complexity.

每增加一个功能，都应该提升架构质量，而不是增加复杂度。

---

# Final Architecture
# 最终目标架构

ShipFactory2

↓

ShipContext

↓

HullGenerator

↓

ArmorGenerator

↓

PanelGenerator

↓

RibbonGenerator

↓

EngineGenerator

↓

WeaponGenerator

↓

SensorGenerator

↓

DecorationGenerator

↓

Validator

ShipFactory2 should become a coordinator only.

ShipFactory2 最终只负责组织生成流程。

All geometry generation belongs inside individual generators.

所有几何生成逻辑应属于各自 Generator。

---

# Development Phases
# 开发阶段

---

## Phase 1
## 第一阶段

Foundation

基础架构

Objective

目标：

Build a stable modular architecture without changing visual appearance.

建立稳定的模块化架构，不追求视觉升级。

Tasks

任务：

✓ ShipFactory2

✓ Generator folders

✓ Materials

✓ Utils

✓ Legacy compatibility

Success Criteria

完成标准：

Old ships continue to work.

旧版舰船仍可正常运行。

New architecture is ready for expansion.

新架构具备扩展能力。

---

## Phase 2
## 第二阶段

> ✅ **状态：已完成（2026-07-19）** — 按 4 次提交节奏落地：Commit 1 基础框架 / Commit 2 曲率接口 / Commit 3 材质统一 / Commit 4 seed·random·scope。详见 `SHIPCONTEXT_DESIGN.md`。
> 与下方原始清单的差异：Width/Height 未单独存（由 hullProfile 派生即可）；Radius Function→`radiusAt`、Surface Normal→`normalAt`，另加 `sampleHullSurface`（原名 surfacePoint，按用户建议改名）；新增扩展 `bounds`（aabb/sphere/length/maxRadius/center）；`cache` 按用户建议删除、延至 Phase 9。

Shared Ship Context

共享舰船上下文

Objective

建立整个生成器共享的数据中心。

Create ShipContext.

ShipContext should contain:

ShipContext 应保存：

Seed

Scale

Ship Class

Race

Hull Profile

Radius Function

Surface Normal

Length

Width

Height

Every generator should read data from ShipContext instead of recalculating geometry.

所有 Generator 应统一从 ShipContext 获取数据，而不是重复计算。

Success Criteria

所有 Generator 可以共享 Hull 数据。

---

## Phase 3
## 第三阶段

Procedural Hull

程序化舰体

Objective

Replace fixed hull logic with reusable hull profiles.

建立可参数化 Hull。

Hull should be generated from profile parameters instead of hardcoded curves.

Hull 应由 Profile 参数控制，而不是写死。

Future ship classes should only change profile parameters.

未来不同舰船等级只需修改参数即可。

> ✅ **状态：已完成（2026-07-20）** — 按 4 次提交节奏落地（详见 `SHIPPROFILE_DESIGN.md` / `SHIP_STYLE_SYSTEM.md`）：
> - ✅ Commit 1：新增 `ShipProfile.js`（整舰 DNA，Anchor 系统 + buildProfile，零视觉变化）
> - ✅ Commit 2：ShipContext 持有 `ctx.profile` + HullGenerator 改读 `ctx.profile.hull`（含 Profile Consistency Test）
> - ✅ Commit 3：完成 Profile 化（ShipContext 不再有 preset 概念；Weapon/Engine Generator 改读 `ctx.profile.hull`；删除 `HULL_PRESETS`；新增 Dependency Check 护栏）。几何指纹与基线逐项一致（视觉零变化）
> - ✅ Commit 4：扩展 Anchor Registry 至 7 个（Spear 标量 + Needle/Blade/Hammer/Organic/Industrial/Broken/Lotus 区间式），新增 `tools/test_anchor_variation.mjs` 验证确定性 + 变异性 + 区间约束（1600 PASS）。Spear 路径指纹不变；原型页加 Needle×3 seed 演示行。Phase 3 完成架构转型：Game Spec → Style Resolver → ShipProfile → ShipContext → Generators → Mesh 全链闭环。

---

## Phase 4
## 第四阶段

Surface Generation

舰体表面生成

Objective

Generate surface details procedurally.

程序生成舰体表面细节。

Includes:

包括：

Ribbon

Armor

Panels

Grooves

Heat Sink

Maintenance Hatch

Ventilation

Surface details should follow hull curvature.

所有表面细节必须贴合 Hull 曲率。

> ✅ **状态：已完成（2026-07-20）** — Ribbon/Armor/Panels/Grooves/HeatSink/Hatch/Vent 全部落地 + 轻量 Validator（结构检查）。详见 MEMORY.md。

---

## Phase 5
## 第五阶段

Major Components

大型结构

Objective

Generate large ship components.

程序生成大型结构。

Includes:

Engine

Weapon

Sensor

Communication Array

Radar

Drone Bay

Every component should be reusable.

所有组件应可复用。

> ✅ **状态：已完成（2026-07-23）** — Engine ✅ / Weapon ✅ / SensorGenerator ✅ / Drone Bay ✅（六族通用，Anchor Bus 挂载）。**Radar / Communication Array 已于 2026-07-23 移除**（视觉不佳，用户决定删除，两文件已删、编排层与 Validator 同步解除引用）。`MaterialFactory` 保留 sensorDish/sensorMast/droneBay/droneBody（radarDome/antenna 材质已无用，可后续清理）。Validator ① 现把 sensors/droneBay 列入各族 REQUIRED_GROUPS。

### Phase 5 扩展：功能舰设计语言（工业 / 考古）

> ✅ **状态：已完成（2026-07-23）** — 原路线图 Phase 5 只覆盖战斗大型组件；实际工作延展出 **非战斗功能舰设计语言**：新增 `industrial`（ORE 风：宽厚货舱 + 采矿臂/采气采集器/支援指挥）与 `archaeology`（探索风：流线飞镖 + 扫描阵列/探针舱）两个 civ，**civ 总数升至 8**。
> - 新增文件：`civilization/IndustrialHull.js`、`civilization/ArchaeologyHull.js`、`FunctionalMountGenerator.js`；锚点 `ShipProfile.Industrial`/`Archaeology`（均含 capital 档）；`ShipContext.normalizedShipClass()` + `capital=4` 档。
> - 门控 `isUtilityShip`：禁用通用 surface generator（Armor/Panel/Groove/HeatSink/Hatch/Vent/Ribbon/Sensor/DroneBay 等依赖 lathe 表面采样会浮空），改由 FunctionalMountGenerator 提供识别度；保留 Weapon（仅护盾泡）+ Engine。
> - 回归：smoke 37 组合 / Validator 37 组合（capital 档 bbox 上限放宽至 70）全绿。测试页 `shipfactory2-utility-test.html`（port 8020）。
> - 游戏层 shipId→{faction,family} 接线尚未做（buildShip 目前仅测试页/ship-lab 调用）。

---

## Phase 6
## 第六阶段

Race Style System

种族风格系统

Objective

Separate visual style from geometry generation.

将视觉风格与几何生成彻底解耦。

RaceStyle defines:

RaceStyle 定义：

Panel density

Armor style

Glow color

Engine style

Weapon style

Decoration style

Ship generators should not contain race-specific code.

Generator 不应包含种族判断。

All race differences come from RaceStyle.

所有种族差异均来自 RaceStyle。

> ⚠️ **状态：已放弃（2026-07-23）** — 路线图要求 Generator 不含种族判断、差异全来自 RaceStyle；本项目实际用 CivilizationModifier 调度 6 个 race-specific hull generator（Civilization Identity Layer），已达成"六族视觉区分"目标。用户确认放弃原路线图写法，接受当前实现，不再重构为 Style Resolver。

---

## Phase 7
## 第七阶段

Deterministic Procedural Generation

可复现程序生成

Objective

Introduce Seed system.

引入 Seed。

Same Seed

↓

Same Ship

Different Seed

↓

Different Ship

Random generation must always be reproducible.

所有随机必须可复现。

> ✅ **状态：已完成（Phase 2 Commit 4）** — seed·random·scope 引入，同 seed → 同舰。

---

## Phase 8
## 第八阶段

Validation

自动验证

Objective

Automatically validate generated ships.

自动检查生成结果。

Validator should detect:

Validator 应检查：

Geometry intersections

Floating parts

Broken symmetry

Invalid scale

Component overlap

Surface penetration

Every generated ship should pass validation.

所有舰船生成后都应通过验证。

> ✅ **状态：已完成（2026-07-23）** — `tools/test_validator.mjs` 覆盖六族 24 组合：组件存在(按族定制)/对称/比例/子组件包围+严重脱离/功能附着/NaN有限数守卫/武器断裂对称(WARN软检查)。几何相交与表面穿透的精确三角级检测需 BVH，列为后续项。

---

## Phase 9
## 第九阶段

Rendering Upgrade

渲染升级

Objective

Improve visual quality without changing architecture.

提升视觉效果，不改变架构。

Includes:

Bloom

AO

Reflection

Damage

Shield

Animation

LOD

Rendering should remain independent from geometry generation.

渲染与生成逻辑保持独立。

> ⏸ **状态：已延后** — Bloom/AO/Reflection/Damage/Shield/Animation/LOD，用户建议延后。

---

# Long-Term Vision
# 长期目标

The final framework should be capable of generating hundreds or thousands of unique ships while maintaining a coherent visual language.

最终框架应能够生成数百甚至数千艘具有统一设计语言的原创舰船。

Adding a new race should require creating only a new RaceStyle instead of rewriting generators.

新增种族时，应只新增 RaceStyle，而无需修改 Generator。

Adding a new ship class should require changing only profile parameters.

新增舰船等级时，应只修改 Hull 参数。

The framework should grow by adding new generators rather than increasing the complexity of existing ones.

整个框架应通过增加 Generator 来扩展，而不是不断堆积单个文件。

---

# AI Working Principles
# AI 工作原则

Before implementing any feature:

在开始任何开发前：

Read:

请先阅读：

AI_DEVELOPMENT_RULES.md

PROCEDURAL_SHIP_GUIDE.md

This Roadmap

Implementation should always move the project toward the architecture described above.

所有开发都应推动项目逐步接近本路线图描述的最终架构。

Never optimize only for the current task.

不要只完成当前任务，而忽略整体架构。

Architecture comes first.

架构永远优先。

---

End of document.

文档结束。