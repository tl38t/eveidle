# Procedural Ship Guide
# 程序化舰船生成指南

Version 1.0

This document defines how ships should be procedurally generated.

本文档定义舰船的程序化生成方式。

The goal is to build ships that are visually inspired by EVE Online without copying existing assets.

目标是在不复制 EVE 原模型的前提下，生成具有相同设计语言的原创舰船。

---

# 1. Philosophy
# 1. 核心理念

Ships are assembled from reusable systems.

舰船由多个可复用模块组成。

Never model an entire ship as one object.

不要把整艘船当作一个整体建模。

Everything should be generated.

所有结构都应尽量程序生成。

---

# 2. Ship Structure
# 2. 舰船结构

Every ship consists of independent systems.

每艘船由多个独立系统组成。

Hull

Armor

Panels

Glow Grooves

Engines

Weapons

Sensors

Antennas

Decorations

Each system should be replaceable.

每个系统都应可以独立替换。

---

# 3. Hull
# 3. 舰体

Hull is the primary structure.

Hull 是舰船主体。

Hull defines:

Hull 决定：

Overall size

Overall proportions

Main silhouette

Hull should be smooth.

Hull 应保持连续曲面。

Hull should not contain tiny details.

Hull 不负责小型细节。

---

# 4. Armor
# 4. 装甲

Armor is generated separately.

装甲应单独生成。

Armor sits on top of Hull.

装甲覆盖 Hull。

Armor should:

have thickness

拥有厚度

follow hull curvature

贴合 Hull 曲率

remain symmetrical

保持左右对称

Armor should never intersect.

装甲之间不能互相穿插。

---

# 5. Panels
# 5. 装甲板

Panels create visual rhythm.

Panel 用来增加层次感。

Panels should vary:

size

spacing

depth

rotation

Panels should not form a perfect grid.

不要排列得过于整齐。

Controlled randomness is encouraged.

推荐有限随机。

---

# 6. Glow Grooves
# 6. 发光缝

Glow grooves are recessed.

发光缝应具有刻槽效果。

Avoid TubeGeometry.

不要使用 TubeGeometry。

Prefer ribbon meshes.

优先 Ribbon Mesh。

Glow follows hull curvature.

Glow 必须贴合 Hull 曲率。

Glow width changes with ship size.

宽度随舰船尺寸变化。

---

# 7. Engines
# 7. 引擎

Engines consist of:

Outer housing

Inner nozzle

Glow core

Cooling fins

Support frame

Each engine should contain multiple layers.

引擎至少由多个层次组成。

Avoid simple cylinders.

避免只有一个圆柱。

---

# 8. Weapons
# 8. 武器

Weapons consist of:

Base

Rotation joint

Barrel

Cooling parts

Support frame

Weapons should appear mechanically assembled.

武器应具有机械拼装感。

---

# 9. Sensors
# 9. 传感器

Sensors include:

Radar

Communication arrays

Camera pods

Small antennas

Sensors should be sparse.

数量不宜过多。

---

# 10. Surface Details
# 10. 表面细节

Use reusable detail generators.

使用可复用细节生成器。

Examples:

Heat sinks

Maintenance hatches

Bolts

Ventilation

Radiators

These should enhance realism without overwhelming the silhouette.

细节应丰富而不过度。

---

# 11. Symmetry
# 11. 对称性

Ships should generally remain symmetrical.

舰船整体保持左右对称。

Small asymmetrical details are allowed.

允许局部轻微不对称。

---

# 12. Scale
# 12. 尺寸

Every subsystem scales automatically.

所有子系统应自动缩放。

Never hardcode dimensions.

不要写死尺寸。

All measurements should derive from ship size.

所有尺寸应基于舰船尺寸计算。

---

# 13. Randomization
# 13. 随机生成

Randomness should be deterministic.

随机应可复现。

Every ship uses a seed.

每艘船拥有 Seed。

Same seed

↓

Same ship

Different seed

↓

Different ship

Never use uncontrolled random values.

禁止不可复现随机。

---

# 14. Future Expansion
# 14. 后续扩展

Future systems may include:

Cargo modules

Mining equipment

Drone bays

Shield emitters

Solar collectors

Additional systems should follow the same modular architecture.

未来新增系统必须遵循相同架构。

---

# 15. Long-term Goal
# 15. 长期目标

Ships are generated,

not modeled.

舰船是生成出来的，

而不是建模出来的。

Every new generator should increase visual diversity while maintaining a coherent design language.

每新增一个 Generator，都应提升舰船多样性，同时保持统一设计语言。

---

End of document.