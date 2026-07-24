# 增强剂系统实现方案（BOOSTER_SYSTEM_IMPLEMENTATION_PLAN.md）

> 状态：Phase 2A（数据/制造/在线离线/UI/审计）已于 2026-07-24 实装；本文档其余章节（含 §3.2 六槽、§10.3、§10.4 离线结算等）为 Phase 2B 设计蓝图，尚未实装。
> 2026-07-24 制定、第三轮返修：基于 `js/data/base.js`、`js/systems/production.js`、`js/systems/manufacturing.js`、`js/core/resources.js`、`js/core/offline.js`、`js/data/combat.js`、`js/systems/combat.js`、`js/data/archaeology.js`、`js/systems/archaeology.js`、`js/data/planets.js`、`js/systems/planetary.js`、`js/core/tick.js`、`js/data/ships.js` 的完整审计。
> 第三轮返修重点：30 张配方行星材料解锁错误修正与双列解锁校验（任务一）、文物示踪剂改相对倍率并补五档概率表（任务二）、Z 方案经验重校准（删 X/Y，任务三）、气体消耗改 1/2/3 并重算供需（任务四）、行星经济影子价格审计（任务五）、清理过期矛盾文案（任务七）。仍只改文档、不进代码实装。
> 第四轮最终收口（2026-07-24）：恢复传奇解锁等级为 60/64/68/72/76/80/84/88/92/96（逐系列原始映射，禁止为匹配材料移动等级）；按恢复后等级重排 30 配方材料（传奇 Lv60~76 禁用 Lv80 磁场聚合物 / T5 / Lv85 超纯）；重算经验（Z 方案 scale=0.9）使 Lv35/60/80/96 全落带；补充五档气体成熟配置审计；行星规则 14 条正式定案、清除冲突待确认。仍只改文档、不进代码实装、不碰 js/render3d/、不 commit、不 push。

---

## 实施状态（2026-07-24）

### Phase 2A — 已实装
- 数据层：`js/data/boosters.js` 30 配方 / 10 系列 / 3 品质 / 5 档战术材料 / 6 槽定义；`boosterEngineering` 技能 Lv.1 起。
- 制造：单瓶语义、在线（`tick.js`）与离线（`offline.js`）同源；效率 `1+lvl*0.02`；材料不足安全停止、连续自动下一瓶；XP 沿用 `xpForLevel` 曲线。
- 状态与迁移：`gameState.boosters={inventory,active(六槽恒 null),lastTick}`；`migrateBoosterState` 幂等（补字段、清 NaN/负/零库存、六槽恒 null），双路接入 autoLoad/importData。
- 资源寻址：`ResourceRegistry` 注册 `booster:` 命名空间（pool 特判 `state.boosters.inventory`，按裸 id 存储，经 `definition.key` 解析）。
- 事件：`booster:manufactured`（每瓶）、`boosters:manufactured`（离线批量）、`combat:tacticalMaterialDropped`。
- UI：「增强剂制造」独立页面（分类/品质筛选、配方网格、详情、库存卡片），纯显示态 `getBoosterManufacturingDisplayState`；`index.html` 共 39 个脚本。
- 审计：`tools/audit-boosters.mjs` 28 区 658 断言全 PASS；`tools/verify.mjs` 含脚本数/真实系统/无 Phase 2B 行为哨兵。

### Phase 2B — 设计完成，未实装（详见本文档相关章节）
- 六槽装备/卸载（§3.2 `BoosterStateActions.equip/unequip`，Phase 2A 已预留 `active` 六槽恒 null）。
- 180s 计时与切换不重置剩余时间（§3.2、§10.3）。
- 效果应用：`getBoosterDisplayState()` 汇总乘区（§10.3），采矿/考古/战斗倍率接入。
- 离线六槽分别结算 `settleOfflineBoosters()`（§10.3）。

> 边界（Phase 2A）：不计时、不应用效果、不装备六槽；不修改行星 Phase1 / 战斗 / 考古 / 维修数值；不触碰 `js/render3d/**`。

## 0. 边界与本轮范围

- 本轮**只做策划、架构审计与经济计算**，不实装任何代码、不修改任何游戏数据。
- 不触碰 `js/render3d/**`。
- 不执行 `git commit` / `git push`，不回退现有工作区改动，不创建 `nul` 文件。
- 已确认的架构与规则（单瓶语义、错峰解锁、材料闭环、行星费用分离、六槽结构）不得擅自推翻。
- 发现数值异常只在报告中指出，不擅自改已确认规则；经验曲线、行星成本、维护费用**待策划确认**后再固化。

---

## 1. 基本规则（审计结论 + 设计）

### 1.1 独立制造系统

- **新增独立技能** `boosterEngineering`（增强剂制造），默认等级 **Lv.1**（`{ lvl:1, xp:0 }`，与现有技能一致，见 `js/data/base.js:INITIAL_SKILLS`）。
- **新增独立页面**「增强剂制造」，不归入装备工程，不消费舰船工程经验。
- 每制造一瓶获得一次 `boosterEngineering` 经验（沿用现有 `recipe.xp` + `xpForLevel` 曲线，上限 99，与全技能一致）。

> **关键审计结论**：现有技能默认起始等级为 **Lv.1**（非 Lv.0）。因此第一张配方必须在 **Lv.1** 开放，否则会陷入「无可用配方、无法获得经验」的升级死锁。本方案的 **纳米采掘润滑剂·普通** 即定在 **Lv.1**，满足此约束。

### 1.2 单瓶制造（硬规则）

- 每次制造动作只产出 **1 瓶**（`output:{type:"booster", itemId, qty:1}`）。
- 不允许 10/100/批次产出；可连续排队自动制造，但队列中每次结算仍是一瓶。
- 制造进度、资源消耗、经验、事件均按单瓶结算。
- **在线与离线制造使用完全相同的单瓶语义**：离线结算复用 `recipe.time/效率`、`recipe.xp`、扣料/产出逻辑（`js/core/offline.js` 与在线 `tick.js` 同源），上限 86400 秒/天。

### 1.3 持续时间（硬规则）

- 每瓶持续 **180 秒**（常量 `BOOSTER_DURATION_MS = 180000`）。
- 只在对应行动实际运行时消耗剩余时间；停止行动暂停计时；切换页面不影响计时。
- 保存/读取/导入存档后必须保留剩余毫秒数（存于 `active[slot].remainingMs`）。
- 当前瓶耗尽后自动从库存补充同类下一瓶（每次精确扣 1）。
- 库存数千瓶时持续自动补充；库存为 0 时效果立即停止，不允许负库存。
- 不设计「一瓶持续两小时」。

### 1.4 品质（错峰解锁，禁止整批统一门槛）

每个系列 3 品质：普通 / 精工 / 传奇。解锁等级按系列与品质**逐项错峰**（见 §4），参考银河奶牛 Brewing/Teas/Coffee 的逐项解锁结构，但不照搬其数值。

---

## 2. 增强剂系列与命名（10 系列 / 3 品质 / 30 配方）

禁止笼统命名为「XX增强剂」，使用符合用途的具体名称：

| # | 系列 | 具体名称 | 接入系统 | 效果概述 |
|---|------|----------|----------|----------|
| 1 | 采矿速度 | **纳米采掘润滑剂** | 采矿 | 提高普通矿/月矿采集速度（缩短周期），不直接加单次产量 |
| 2 | 矿物双倍产出 | **富矿共振催化剂** | 采矿 | 每次采集结算有概率使本次基础矿物产量翻倍 |
| 3 | 考古行动效率 | **遗迹解析液** | 考古 | 缩短考古周期时间，不直接提高文物品质 |
| 4 | 考古稀有发现 | **文物示踪剂** | 考古 | 从普通掉落权重转移概率到稀有/极稀有 |
| 5 | 激光武器 | **激光炮冷却剂** | 战斗 | 仅提高激光武器伤害 |
| 6 | 导弹武器 | **导弹燃烧催化剂** | 战斗 | 仅提高导弹武器伤害 |
| 7 | 火炮武器 | **火炮增压药** | 战斗 | 仅提高火炮武器伤害 |
| 8 | 护盾回复 | **护盾回充液** | 战斗 | 提高护盾维修量（乘区接入主动维修） |
| 9 | 装甲回复 | **装甲纳米修复剂** | 战斗 | 提高装甲维修量 |
| 10 | 结构回复 | **结构再生胶** | 战斗 | 提高结构维修量 |

> **战斗回复机制审计（如实列出）**：现有战斗系统**存在主动维修**（`js/systems/combat.js` 遍历 `getInstalledCombatRepairers()`，对 `rep.target` 为 shield/armor/structure 的装备每 volley 回血）。**不存在被动/自动再生**（除全清重置满血）。因此护盾/装甲/结构三类增强剂**乘区接入主动维修量**，不虚构被动再生；若当前舰船未装对应维修装备，则显示态提示「当前配置无有效目标」，不错误放大其他属性。

---

## 3. 同时使用规则与六槽状态结构

### 3.1 行动与槽位

一种行动最多同时生效 **2 个槽**。原方案 `active:{mining,archaeology,weapon,repair}` 无法实现「采矿同时使用两种」「考古同时使用两种」，改为 **六个独立槽**：

| 行动 | 槽位 key | 可装备 |
|------|----------|--------|
| 普通采矿 / 月矿 | `miningSpeed` | 纳米采掘润滑剂（单系列） |
| 普通采矿 / 月矿 | `miningYield` | 富矿共振催化剂（单系列） |
| 考古 | `archaeologySpeed` | 遗迹解析液（单系列） |
| 考古 | `archaeologyRare` | 文物示踪剂（单系列） |
| 战斗（武器） | `combatWeapon` | 激光炮冷却剂 / 导弹燃烧催化剂 / 火炮增压药（三选一） |
| 战斗（回复） | `combatRepair` | 护盾回充液 / 装甲纳米修复剂 / 结构再生胶（三选一） |

规则：
- 采矿行动同时看 `miningSpeed` + `miningYield` 两槽；考古行动同时看 `archaeologySpeed` + `archaeologyRare` 两槽；战斗行动同时看 `combatWeapon` + `combatRepair` 两槽。每行动最多 2 槽生效。
- 武器槽三选一、回复槽三选一；不能 2 武器或 2 回复。
- 同系列不同品质不能同时占用（装备时校验 `series` 冲突；六个槽分别保存 itemId 与 remainingMs）。
- 切换增强剂**不能**重置当前瓶剩余时间来刷时长。
- 无对应武器/回复能力时允许装备但无效果，显示态明确提示。
- 离线结算分别处理六个槽，不能共用一个剩余时间。

### 3.2 状态结构（新增 `gameState.boosters`）

```js
boosters: {
  inventory: {},                 // itemId -> count（可堆叠库存）
  active: {
    miningSpeed:     { itemId, remainingMs } | null,
    miningYield:     { itemId, remainingMs } | null,
    archaeologySpeed:{ itemId, remainingMs } | null,
    archaeologyRare: { itemId, remainingMs } | null,
    combatWeapon:    { itemId, remainingMs } | null,
    combatRepair:    { itemId, remainingMs } | null
  },
  lastTick: timestamp
}
```

---

## 3.5 单瓶生命周期与扣除时点（硬规则）

统一采用「装入即扣 1 瓶、耗尽再扣 1 瓶、剩余时间绑定当前瓶」模型，杜绝免费切换品质刷时长：

1. **装入空槽并开始使用**：立即从 `inventory` 扣除 1 瓶 → 创建 `active[slot]={itemId, remainingMs:180000}`。
2. **当前瓶耗尽**：若 `inventory` 仍有同一 `itemId`，再扣 1 瓶 → `remainingMs += 180000` → 继续生效（不重置为满，是续加）。
3. **对应行动停止**：不扣时间、不清除 `active`、不退还已用瓶；`remainingMs` 冻结，恢复行动时继续消耗。
4. **手动卸下**：当前剩余时间作废、不返还药瓶、清空该槽（`active[slot]=null`）。
5. **替换为其他品质/产品**：原瓶剩余时间作废 → 从新产品库存扣 1 瓶 → 新产品从 `180000` 重新开始；不能继承原瓶剩余时间、不能免费获得新效果。
6. **库存不足**：Action **原子拒绝**（先 `canAfford` 校验），原槽状态保持不变；不允许「先销毁旧瓶再发现新瓶不足」。
7. **自动续瓶**：精确扣 1、不得重复扣、不得出现「库存 0 仍保留效果」。

---

## 3.6 事件顺序（与生命周期一致）

| 事件 | 触发时机 | 关键字段 |
|------|----------|----------|
| `booster:equipped` | 装入空槽、扣 1 瓶成功 | `{ slot, itemId }` |
| `booster:activated` | 该槽开始计时（remainingMs 初始化为 180000） | `{ slot, itemId, remainingMs:180000 }` |
| `booster:consumed` | 当前瓶 remainingMs 归零（未自动续瓶前） | `{ slot, itemId }` |
| `booster:autoRefilled` | 库存足、精确扣 1、remainingMs += 180000 | `{ slot, itemId, fromInventory }` |
| `booster:depleted` | 库存为 0、效果停止、清空槽 | `{ slot }` |
| `booster:unequipped` | 手动卸下（剩余时间作废、不返还） | `{ slot }` |
| `booster:manufactured` | 单瓶制造完成 | `{ itemId, quality, series, xpGained }` |
| `planetary:deployed` / `planetary:maintained` / `planetary:expired` / `planetary:removed` | 见行星方案 | — |

> 装备即扣瓶（`equipped`→`activated` 同步），耗尽才 `consumed`，续瓶才 `autoRefilled`；切换品质走「`unequipped`（旧瓶作废）→`equipped`（新瓶扣 1）→`activated`（新 180000）」顺序，确保不免费刷时长。

---

## 4. 30 张完整配方表（逐项解锁，无省略）

> 时间/经验列采用 **Z 方案** 数值（§8 定案：统一 `xpForLevel` 曲线 + 配方经验校准，无 X/Y 二选一）。`outputQty` 恒为 1，`durationMs` 恒为 180000。
> **解锁等级已恢复（任务一）**：普通 `1/4/7/10/13/16/20/24/28/32`、精工 `35/39/43/47/51/55/59/63/67/71`、传奇 `60/64/68/72/76/80/84/88/92/96`（逐系列原始映射，禁止为匹配材料而移动等级）。
> **全字段拆分（任务三）**：原单宽表拆为 **表 A 配方与产物 / 表 B 材料与解锁校验 / 表 C 效果与槽位**，三表以 `recipeId` 一一对应、完整覆盖 30 条，不得省略 `itemId / output / duration / effect / slot`。
> **双列解锁校验（任务一/二）**：每行的 `planetaryUnlockLevel ≤ level` 且 `secondMaterialUnlockLevel ≤ level`（表 B「校验」列全为「是」）。行星产物解锁：熔岩/气态 Lv1、冰 Lv20、等离子 Lv40、温带 Lv60、风暴 Lv80；战术材料档位 Lv1/20/40/60/80；气体云 Lv1/10/20/40/55/70/85。
> 气体消耗 **1/2/3**（普通/精工/传奇），战术材料维持 **2/4/7**；战斗 6 系列第二材料为气体、采集/考古 4 系列为战术材料。传奇 Lv60~76 **不使用** Lv80 磁场聚合物 / Lv80 T5 / Lv85 超纯聚合气体。

### 表 A：配方与产物（recipeId 主键，全字段）

| recipeId | itemId | 中文名 | series | quality | level | timeSeconds | xp | planetaryMaterialId | planetaryMaterialName | planetaryQuantity | planetaryUnlockLevel | outputItemId | outputQty | durationMs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mining_lubricant_n | booster:mining_lubricant_n | 纳米采掘润滑剂·普通 | 采矿速度 | 普通 | 1 | 18 | 5 | planetary:重金属 | 重金属 | 2 | 1 | booster:mining_lubricant_n | 1 | 180000 |
| shield_recharge_n | booster:shield_recharge_n | 护盾回充液·普通 | 护盾回复 | 普通 | 4 | 18 | 6 | planetary:稀有气体 | 稀有气体 | 2 | 1 | booster:shield_recharge_n | 1 | 180000 |
| ore_resonance_n | booster:ore_resonance_n | 富矿共振催化剂·普通 | 矿物双倍 | 普通 | 7 | 19 | 7 | planetary:重金属 | 重金属 | 2 | 1 | booster:ore_resonance_n | 1 | 180000 |
| laser_coolant_n | booster:laser_coolant_n | 激光炮冷却剂·普通 | 激光武器 | 普通 | 10 | 19 | 8 | planetary:稀有气体 | 稀有气体 | 2 | 1 | booster:laser_coolant_n | 1 | 180000 |
| relic_solver_n | booster:relic_solver_n | 遗迹解析液·普通 | 考古效率 | 普通 | 13 | 20 | 9 | planetary:稀有气体 | 稀有气体 | 2 | 1 | booster:relic_solver_n | 1 | 180000 |
| armor_nano_n | booster:armor_nano_n | 装甲纳米修复剂·普通 | 装甲回复 | 普通 | 16 | 20 | 10 | planetary:稀有气体 | 稀有气体 | 2 | 1 | booster:armor_nano_n | 1 | 180000 |
| missile_catalyst_n | booster:missile_catalyst_n | 导弹燃烧催化剂·普通 | 导弹武器 | 普通 | 20 | 21 | 11 | planetary:同位素 | 同位素 | 2 | 20 | booster:missile_catalyst_n | 1 | 180000 |
| artifact_tracer_n | booster:artifact_tracer_n | 文物示踪剂·普通 | 考古稀有 | 普通 | 24 | 21 | 12 | planetary:同位素 | 同位素 | 2 | 20 | booster:artifact_tracer_n | 1 | 180000 |
| cannon_booster_n | booster:cannon_booster_n | 火炮增压药·普通 | 火炮武器 | 普通 | 28 | 22 | 13 | planetary:同位素 | 同位素 | 2 | 20 | booster:cannon_booster_n | 1 | 180000 |
| structure_gel_n | booster:structure_gel_n | 结构再生胶·普通 | 结构回复 | 普通 | 32 | 22 | 14 | planetary:同位素 | 同位素 | 2 | 20 | booster:structure_gel_n | 1 | 180000 |
| mining_lubricant_r | booster:mining_lubricant_r | 纳米采掘润滑剂·精工 | 采矿速度 | 精工 | 35 | 56 | 50 | planetary:同位素 | 同位素 | 3 | 20 | booster:mining_lubricant_r | 1 | 180000 |
| shield_recharge_r | booster:shield_recharge_r | 护盾回充液·精工 | 护盾回复 | 精工 | 39 | 58 | 53 | planetary:稀有气体 | 稀有气体 | 3 | 1 | booster:shield_recharge_r | 1 | 180000 |
| ore_resonance_r | booster:ore_resonance_r | 富矿共振催化剂·精工 | 矿物双倍 | 精工 | 43 | 60 | 56 | planetary:等离子体 | 等离子体 | 3 | 40 | booster:ore_resonance_r | 1 | 180000 |
| laser_coolant_r | booster:laser_coolant_r | 激光炮冷却剂·精工 | 激光武器 | 精工 | 47 | 62 | 59 | planetary:等离子体 | 等离子体 | 3 | 40 | booster:laser_coolant_r | 1 | 180000 |
| relic_solver_r | booster:relic_solver_r | 遗迹解析液·精工 | 考古效率 | 精工 | 51 | 64 | 62 | planetary:等离子体 | 等离子体 | 3 | 40 | booster:relic_solver_r | 1 | 180000 |
| armor_nano_r | booster:armor_nano_r | 装甲纳米修复剂·精工 | 装甲回复 | 精工 | 55 | 66 | 65 | planetary:等离子体 | 等离子体 | 3 | 40 | booster:armor_nano_r | 1 | 180000 |
| missile_catalyst_r | booster:missile_catalyst_r | 导弹燃烧催化剂·精工 | 导弹武器 | 精工 | 59 | 68 | 68 | planetary:等离子体 | 等离子体 | 3 | 40 | booster:missile_catalyst_r | 1 | 180000 |
| artifact_tracer_r | booster:artifact_tracer_r | 文物示踪剂·精工 | 考古稀有 | 精工 | 63 | 70 | 71 | planetary:生物质 | 生物质 | 3 | 60 | booster:artifact_tracer_r | 1 | 180000 |
| cannon_booster_r | booster:cannon_booster_r | 火炮增压药·精工 | 火炮武器 | 精工 | 67 | 72 | 74 | planetary:等离子体 | 等离子体 | 3 | 40 | booster:cannon_booster_r | 1 | 180000 |
| structure_gel_r | booster:structure_gel_r | 结构再生胶·精工 | 结构回复 | 精工 | 71 | 74 | 77 | planetary:生物质 | 生物质 | 3 | 60 | booster:structure_gel_r | 1 | 180000 |
| mining_lubricant_l | booster:mining_lubricant_l | 纳米采掘润滑剂·传奇 | 采矿速度 | 传奇 | 60 | 128 | 306 | planetary:生物质 | 生物质 | 5 | 60 | booster:mining_lubricant_l | 1 | 180000 |
| shield_recharge_l | booster:shield_recharge_l | 护盾回充液·传奇 | 护盾回复 | 传奇 | 64 | 131 | 315 | planetary:生物质 | 生物质 | 5 | 60 | booster:shield_recharge_l | 1 | 180000 |
| ore_resonance_l | booster:ore_resonance_l | 富矿共振催化剂·传奇 | 矿物双倍 | 传奇 | 68 | 135 | 326 | planetary:等离子体 | 等离子体 | 5 | 40 | booster:ore_resonance_l | 1 | 180000 |
| laser_coolant_l | booster:laser_coolant_l | 激光炮冷却剂·传奇 | 激光武器 | 传奇 | 72 | 138 | 335 | planetary:生物质 | 生物质 | 5 | 60 | booster:laser_coolant_l | 1 | 180000 |
| relic_solver_l | booster:relic_solver_l | 遗迹解析液·传奇 | 考古效率 | 传奇 | 76 | 142 | 346 | planetary:生物质 | 生物质 | 5 | 60 | booster:relic_solver_l | 1 | 180000 |
| armor_nano_l | booster:armor_nano_l | 装甲纳米修复剂·传奇 | 装甲回复 | 传奇 | 80 | 146 | 356 | planetary:磁场聚合物 | 磁场聚合物 | 5 | 80 | booster:armor_nano_l | 1 | 180000 |
| missile_catalyst_l | booster:missile_catalyst_l | 导弹燃烧催化剂·传奇 | 导弹武器 | 传奇 | 84 | 149 | 365 | planetary:磁场聚合物 | 磁场聚合物 | 5 | 80 | booster:missile_catalyst_l | 1 | 180000 |
| artifact_tracer_l | booster:artifact_tracer_l | 文物示踪剂·传奇 | 考古稀有 | 传奇 | 88 | 153 | 376 | planetary:磁场聚合物 | 磁场聚合物 | 5 | 80 | booster:artifact_tracer_l | 1 | 180000 |
| cannon_booster_l | booster:cannon_booster_l | 火炮增压药·传奇 | 火炮武器 | 传奇 | 92 | 156 | 385 | planetary:磁场聚合物 | 磁场聚合物 | 5 | 80 | booster:cannon_booster_l | 1 | 180000 |
| structure_gel_l | booster:structure_gel_l | 结构再生胶·传奇 | 结构回复 | 传奇 | 96 | 160 | 396 | planetary:磁场聚合物 | 磁场聚合物 | 5 | 80 | booster:structure_gel_l | 1 | 180000 |

### 表 B：材料与解锁校验（recipeId 一一对应）

| recipeId | secondMaterialId | secondMaterialName | secondQuantity | secondMaterialUnlockLevel | planetaryUnlockLevel | 配方level | 两材料解锁校验 |
|---|---|---|---|---|---|---|---|
| mining_lubricant_n | material:战术残液 | 战术残液(T1) | 2 | 1 | 1 | 1 | 是 |
| shield_recharge_n | gas:粗制富勒烯 | 粗制富勒烯(Lv1) | 1 | 1 | 1 | 4 | 是 |
| ore_resonance_n | material:战术残液 | 战术残液(T1) | 2 | 1 | 1 | 7 | 是 |
| laser_coolant_n | gas:氦同位素 | 氦同位素(Lv10) | 1 | 10 | 1 | 10 | 是 |
| relic_solver_n | material:战术残液 | 战术残液(T1) | 2 | 1 | 1 | 13 | 是 |
| armor_nano_n | gas:氦同位素 | 氦同位素(Lv10) | 1 | 10 | 1 | 16 | 是 |
| missile_catalyst_n | gas:稳定富勒烯 | 稳定富勒烯(Lv20) | 1 | 20 | 20 | 20 | 是 |
| artifact_tracer_n | material:战术残液 | 战术残液(T1) | 2 | 1 | 20 | 24 | 是 |
| cannon_booster_n | gas:稳定富勒烯 | 稳定富勒烯(Lv20) | 1 | 20 | 20 | 28 | 是 |
| structure_gel_n | gas:稳定富勒烯 | 稳定富勒烯(Lv20) | 1 | 20 | 20 | 32 | 是 |
| mining_lubricant_r | material:活性战术凝胶 | 活性战术凝胶(T2) | 4 | 20 | 20 | 35 | 是 |
| shield_recharge_r | gas:稳定富勒烯 | 稳定富勒烯(Lv20) | 2 | 20 | 1 | 39 | 是 |
| ore_resonance_r | material:高能战术萃取物 | 高能战术萃取物(T3) | 4 | 40 | 40 | 43 | 是 |
| laser_coolant_r | gas:氢同位素 | 氢同位素(Lv40) | 2 | 40 | 40 | 47 | 是 |
| relic_solver_r | material:高能战术萃取物 | 高能战术萃取物(T3) | 4 | 40 | 40 | 51 | 是 |
| armor_nano_r | gas:高纯富勒烯 | 高纯富勒烯(Lv55) | 2 | 55 | 40 | 55 | 是 |
| missile_catalyst_r | gas:高纯富勒烯 | 高纯富勒烯(Lv55) | 2 | 55 | 40 | 59 | 是 |
| artifact_tracer_r | material:极化战术介质 | 极化战术介质(T4) | 4 | 60 | 60 | 63 | 是 |
| cannon_booster_r | gas:高纯富勒烯 | 高纯富勒烯(Lv55) | 2 | 55 | 40 | 67 | 是 |
| structure_gel_r | material:极化战术介质 | 极化战术介质(T4) | 4 | 60 | 60 | 71 | 是 |
| mining_lubricant_l | material:极化战术介质 | 极化战术介质(T4) | 7 | 60 | 60 | 60 | 是 |
| shield_recharge_l | gas:高纯富勒烯 | 高纯富勒烯(Lv55) | 3 | 55 | 60 | 64 | 是 |
| ore_resonance_l | material:极化战术介质 | 极化战术介质(T4) | 7 | 60 | 40 | 68 | 是 |
| laser_coolant_l | gas:聚合气体 | 聚合气体(Lv70) | 3 | 70 | 60 | 72 | 是 |
| relic_solver_l | material:极化战术介质 | 极化战术介质(T4) | 7 | 60 | 60 | 76 | 是 |
| armor_nano_l | gas:聚合气体 | 聚合气体(Lv70) | 3 | 70 | 80 | 80 | 是 |
| missile_catalyst_l | gas:聚合气体 | 聚合气体(Lv70) | 3 | 70 | 80 | 84 | 是 |
| artifact_tracer_l | material:深层适应性样本 | 深层适应性样本(T5) | 7 | 80 | 80 | 88 | 是 |
| cannon_booster_l | gas:超纯聚合气体 | 超纯聚合气体(Lv85) | 3 | 85 | 80 | 92 | 是 |
| structure_gel_l | gas:超纯聚合气体 | 超纯聚合气体(Lv85) | 3 | 85 | 80 | 96 | 是 |

### 表 C：效果与槽位（recipeId 一一对应）

| recipeId | effectType | effectValue（推荐） | slot |
|---|---|---|---|
| mining_lubricant_n | miningSpeed | +8% | miningSpeed |
| shield_recharge_n | repairAmount | +10% | combatRepair |
| ore_resonance_n | doubleMineral | 10% | miningYield |
| laser_coolant_n | damageMultiplier | +6% | combatWeapon |
| relic_solver_n | archaeologySpeed | -8% | archaeologySpeed |
| armor_nano_n | repairAmount | +10% | combatRepair |
| missile_catalyst_n | damageMultiplier | +6% | combatWeapon |
| artifact_tracer_n | rareShift | ×1.25 | archaeologyRare |
| cannon_booster_n | damageMultiplier | +6% | combatWeapon |
| structure_gel_n | repairAmount | +10% | combatRepair |
| mining_lubricant_r | miningSpeed | +18% | miningSpeed |
| shield_recharge_r | repairAmount | +25% | combatRepair |
| ore_resonance_r | doubleMineral | 20% | miningYield |
| laser_coolant_r | damageMultiplier | +14% | combatWeapon |
| relic_solver_r | archaeologySpeed | -16% | archaeologySpeed |
| armor_nano_r | repairAmount | +25% | combatRepair |
| missile_catalyst_r | damageMultiplier | +14% | combatWeapon |
| artifact_tracer_r | rareShift | ×1.60 | archaeologyRare |
| cannon_booster_r | damageMultiplier | +14% | combatWeapon |
| structure_gel_r | repairAmount | +25% | combatRepair |
| mining_lubricant_l | miningSpeed | +30% | miningSpeed |
| shield_recharge_l | repairAmount | +45% | combatRepair |
| ore_resonance_l | doubleMineral | 30% | miningYield |
| laser_coolant_l | damageMultiplier | +24% | combatWeapon |
| relic_solver_l | archaeologySpeed | -25% | archaeologySpeed |
| armor_nano_l | repairAmount | +45% | combatRepair |
| missile_catalyst_l | damageMultiplier | +24% | combatWeapon |
| artifact_tracer_l | rareShift | ×2.20 | archaeologyRare |
| cannon_booster_l | damageMultiplier | +24% | combatWeapon |
| structure_gel_l | repairAmount | +45% | combatRepair |

**逐项解锁校验**：30 个解锁等级全部落在 1~96，无重叠、无空缺死区；Lv1 即有可制造配方（纳米采掘润滑剂·普通）。同品质不同系列解锁等级错峰（普通档 1/4/7/10/13/16/20/24/28/32、精工档 35/39/43/47/51/55/59/63/67/71、传奇档 **60/64/68/72/76/80/84/88/92/96**），体现逐项解锁意义（传奇档恢复为更早的逐系列原始映射，不再为匹配材料而平移）。

**双列解锁校验（任务一，逐行结论）**：30/30 全部满足「行星解锁Lv ≤ 解锁等级」且「第二解锁Lv ≤ 解锁等级」，列末「校验」全为「是」。相对初版的关键修正：
- 富矿共振/激光/遗迹/装甲·普通 原本误用 Lv20/Lv40/Lv60/Lv80 产物而解锁等级仅 7/10/13/16 → 已下移为 Lv1 重金属/稀有气体（同位素自 Lv20 起才开放）。
- 同位素类配方（导弹/文物/火炮/结构·普通，Lv20+）正确使用冰行星产物（Lv20 开放）；生物质（温带 Lv60）仅出现在精工 Lv60+ 与传奇配方。
- 磁场聚合物（风暴 Lv80）仅出现在传奇档 Lv80+ 配方（装甲/导弹/文物/火炮/结构·传奇 共 5 张），不再提前到 Lv16 装甲·普通；激光·传奇 Lv72、遗迹·传奇 Lv76 已改用生物质+聚合气体，符合「传奇 Lv60~76 禁用 Lv80 磁场聚合物」。
- 气体消耗改 **1/2/3**：战斗类 6 系列第二材料为气体，「第二解锁Lv」为气体云等级，全部 ≤ 配方解锁等级（如激光·传奇 Lv72 用聚合气体 Lv70 ✓、结构·传奇 Lv96 用超纯聚合气体 Lv85 ✓）；传奇 Lv60~76 仅用生物质 / T4 或 ≤Lv55 气体，Lv80+ 才用磁场聚合物 / T5 / Lv85 超纯。
- 战术材料（采集/考古 4 系列）维持 **2/4/7**，档位解锁 Lv1/20/40/60/80 全部 ≤ 配方解锁等级。

**行星产物覆盖（六种产物在中后期均有稳定消耗）**：重金属(2)/稀有气体(5)/同位素(5)/等离子体(7)/生物质(6)/磁场聚合物(5)，共 30 处配方引用，无单一产物承担绝大多数；磁场聚合物集中于 5 个传奇配方形成强力后期消耗，生物质/等离子体在精工+传奇均有消耗。详见 §6.3。

---

## 5. 效果数值设计（保守 / 推荐 / 激进）

设计原则：普通明显但不决定性；精工显著优于普通；传奇是长期消耗目标但不让基础系统失效；武器三系强度一致；回复三系按真实维修机制校准；稀有考古通过权重转移；双倍矿物概率受控。

> 本方案首版**直接采用「推荐」数值**并附保守/激进对照。如需调整，只在该表内改数值，不重做架构。

| 系列 | 品质 | 保守 | **推荐** | 激进 | 乘区/接入点 |
|------|------|------|----------|------|-------------|
| 纳米采掘润滑剂（采矿速度） | 普通 | +5% | **+8%** | +12% | ×采矿效率 total |
| | 精工 | +12% | **+18%** | +25% | |
| | 传奇 | +20% | **+30%** | +40% | |
| 富矿共振催化剂（双倍矿物概率） | 普通 | 8% | **10%** | 15% | 每次采集 roll |
| | 精工 | 15% | **20%** | 28% | |
| | 传奇 | 22% | **30%** | 40% | |
| 遗迹解析液（考古效率） | 普通 | -6% | **-8%** | -12% | ×site.time |
| | 精工 | -12% | **-16%** | -22% | |
| | 传奇 | -18% | **-25%** | -35% | |
| 文物示踪剂（稀有率转移，相对倍率） | 普通 | ×1.15 | **×1.25** | ×1.40 | 乘入 uniqueRate（从 common 权重转移等量概率） |
| | 精工 | ×1.40 | **×1.60** | ×1.90 | 总和恒为 100% |
| | 传奇 | ×1.80 | **×2.20** | ×2.80 | 不影响校准/LP掉率与成功率 |
| 激光/导弹/火炮（普通） | 普通 | +4% | **+6%** | +9% | damageMultiplier·weaponType |
| 激光/导弹/火炮（精工） | 精工 | +10% | **+14%** | +20% | 同上（三系一致） |
| 激光/导弹/火炮（传奇） | 传奇 | +18% | **+24%** | +34% | 同上（三系一致） |
| 护盾/装甲/结构（普通） | 普通 | +8% | **+10%** | +15% | ×repair amount |
| 护盾/装甲/结构（精工） | 精工 | +20% | **+25%** | +35% | |
| 护盾/装甲/结构（传奇） | 传奇 | +35% | **+45%** | +60% | |

**五档真实概率对照表（任务二：文物示踪剂相对倍率）**

设计模型下 `common + unique = 100%`；示踪剂以**相对倍率**放大 unique 掉率，并从 common 权重转移等量概率，总概率恒为 100%。基础 `uniqueRate` 取自 `js/data/archaeology.js`（`ARCHAEOLOGY_TIERS`：I=0.010 / II=0.008 / III=0.006 / IV=0.004 / V=0.002）。

| 考古档 | 基础 uniqueRate | 无示踪剂 | 普通 ×1.25（+25%） | 精工 ×1.60（+60%） | 传奇 ×2.20（+120%） |
|--------|------|------|------|------|------|
| Tier I | 1.0% | 1.00% | 1.25% | 1.60% | 2.20% |
| Tier II | 0.8% | 0.80% | 1.00% | 1.28% | 1.76% |
| Tier III | 0.6% | 0.60% | 0.75% | 0.96% | 1.32% |
| Tier IV | 0.4% | 0.40% | 0.50% | 0.64% | 0.88% |
| Tier V | 0.2% | 0.20% | 0.25% | 0.32% | 0.44% |

> 表中数值为 unique（稀有/极稀有）掉率；common 权重 = `100% − uniqueRate`（如 Tier I 无示踪剂时 common 99.00%、传奇 ×2.20 时 97.80%）。**不影响**校准材料掉率（`calibrationRate`）、LP 文物掉率（`lpBase`）、考古成功率、每次掉落数量。

**关键关系说明：**
- **采矿速度 × 双倍矿物**：二者独立。平均矿物产量 = `基础产量 × 速度乘区 × (1 + 双倍概率)`。例：速度 +30%、双倍 30% → 平均 `1.30 × 1.30 = 1.69×`。速度不加倍率外额外经验或稀有掉落；双倍只翻本次基础产出。
- **文物示踪剂**：以**相对倍率**作用于稀有/极稀有掉率（推荐 普通 ×1.25 / 精工 ×1.60 / 传奇 ×2.20，即相对提高 25%/60%/120%），通过等额降低 common 权重、提高 `uniqueRate` 实现；所有掉落概率总和恒为 100%，不额外生成第二份稀有奖励；**不影响**校准材料掉率、LP 文物掉率、考古成功率、每次掉落数量。详见上方「五档真实概率对照表」。
- **武器三系**：通过现有 `state.combat.modifiers` 管线注入 `stat:"damageMultiplier"` + `weaponType` 过滤（三系强度数值完全一致）。
- **回复三系**：乘入战斗主动维修 `amount`。无被动再生，不虚构。

---

## 6. 材料闭环

### 6.1 两条路线

**A. 采集与考古类（4 系列）** — 行星产物 + 对应层级**战斗掉落材料**
- 纳米采掘润滑剂、富矿共振催化剂、遗迹解析液、文物示踪剂
- **完全取消气体消耗**（普通/精工/传奇均不用气体）
- 传奇考古增强剂可少量使用考古产物，但**非必需**；禁止每瓶消耗稀有/极稀有文物

**B. 战斗类（6 系列）** — 行星产物 + 对应等级**气体**
- 激光炮冷却剂、导弹燃烧催化剂、火炮增压药、护盾回充液、装甲纳米修复剂、结构再生胶
- 气体成为战斗增强剂的长期消耗出口

### 6.2 设计目的

行星产物成为**全部 10 系列**的基础材料；战斗掉落支撑采集/考古；气体支撑战斗增强剂；三系统形成闭环，但无单一系统完全锁死其他。

### 6.3 行星产物分配（每种至少进入多个系列，无单一产物承担绝大多数）

> 下表依据 §4 重排后的 30 张配方统计；「引用数」指将该产物作为行星材料的配方张数，合计 30。

| 行星产物（来源行星/解锁Lv） | 服务的增强剂配方（系列·品质） | 引用数 |
|----------------------|------------------|------|
| 重金属（熔岩/Lv1） | 纳米采掘润滑剂·普通、富矿共振催化剂·普通 | 2 |
| 稀有气体（气态/Lv1） | 护盾回充液·普通、激光炮冷却剂·普通、装甲纳米修复剂·普通、遗迹解析液·普通、护盾回充液·精工 | 5 |
| 同位素（冰/Lv20） | 导弹燃烧催化剂·普通、文物示踪剂·普通、火炮增压药·普通、结构再生胶·普通、纳米采掘润滑剂·精工 | 5 |
| 等离子体（等离子/Lv40） | 富矿共振催化剂·精工、激光炮冷却剂·精工、遗迹解析液·精工、装甲纳米修复剂·精工、导弹燃烧催化剂·精工、火炮增压药·精工、富矿共振催化剂·传奇 | 7 |
| 生物质（温带/Lv60） | 文物示踪剂·精工、结构再生胶·精工、纳米采掘润滑剂·传奇、护盾回充液·传奇、激光炮冷却剂·传奇、遗迹解析液·传奇 | 6 |
| 磁场聚合物（风暴/Lv80） | 装甲纳米修复剂·传奇、导弹燃烧催化剂·传奇、文物示踪剂·传奇、火炮增压药·传奇、结构再生胶·传奇 | 5 |

30 处引用中占比 ≈ 6.7%/16.7%/16.7%/23.3%/20%/16.7%，无单一产物承担绝大多数；磁场聚合物集中于 5 个传奇配方形成强力后期消耗，生物质（精工 2 + 传奇 4）/等离子体（精工 6 + 传奇 1）在精工+传奇均有稳定消耗，满足「六种产物在中后期都有稳定消耗」约束。

### 6.4 战斗材料 / 气体 tier 映射（与 §4 配方一一对应）

战斗材料 5 档（星带安全层 → 材料档，玩家在配方解锁时该层已开放）：
highsec→T1(Lv1)、bordersec→T2(Lv20)、lowsec→T3(Lv40)、deepsec→T4(Lv60)、nullsec/deepnull→T5(Lv80/90)。

气体 7 种（气体云等级）：粗制富勒烯(Lv1)、氦同位素(Lv10)、稳定富勒烯(Lv20)、氢同位素(Lv40)、高纯富勒烯(Lv55)、聚合气体(Lv70)、超纯聚合气体(Lv85)。配方→气体映射保证「气体解锁等级 ≤ 配方解锁等级」（见 §4 第二材料列）。**气体每瓶消耗已改为 1/2/3（普通/精工/传奇，原 2/4/7）**，仅战斗 6 系列使用气体，采集/考古 4 系列使用战术材料（维持 2/4/7）。

---

## 7. 高频战斗掉落材料

### 7.1 五档材料

| 档 | 名称 | 来源星带安全层 | 可 farm 门槛 |
|----|------|----------------|-------------|
| T1 | 战术残液 | highsec | Lv1 |
| T2 | 活性战术凝胶 | bordersec | Lv20 |
| T3 | 高能战术萃取物 | lowsec | Lv40 |
| T4 | 极化战术介质 | deepsec | Lv60 |
| T5 | 深层适应性样本 | nullsec/deepnull | Lv80 |

### 7.2 掉落锚点（计算用首版，高掉率保留）

- 普通怪：**70% 概率掉落 1 份**对应材料
- 精英怪：100% 掉落 2~3 份（均值 2.5）
- 星带 Boss：100% 掉落 6~10 份（均值 8）
- 死亡空间普通敌人：70% 掉落 1 份；精英/Boss/监督者 100% 更高数量

> **实现缺口（必须已知）**：现有代码普通敌人**只掉 ISK**（`resolveCombatEnemyDefeat` 对非 elite/boss 返回 null）。要让普通怪高频掉材料，需**修改 `resolveCombatEnemyDefeat`** 新增对所有 `kind` 开放的战术材料 roll（见 §12）。本方案掉落锚点基于该改动后的预期，非现行行为。**不降低掉率**。

### 7.3 四种刷怪组合的材料期望（基于真实 `COMBAT_FORMATION_POOLS`）

单组合期望 = 普通数×0.7 + 精英数×2.5：

| 组合 | 普通 | 精英 | 材料期望 |
|------|------|------|----------|
| 2 普通 | 2 | 0 | 1.4 |
| 3 普通 | 3 | 0 | 2.1 |
| 2 普通 + 1 精英 | 2 | 1 | 3.9 |
| 3 普通 + 1 精英 | 3 | 1 | 4.6 |

### 7.4 每 20 波肃清材料总期望（19 普通波 + 第 20 波 Boss）

| 安全层 | 19 波 | Boss | 合计/次 |
|--------|-------|------|---------|
| highsec | 37.6 | 8.7 | **46.3** |
| bordersec | 47.5 | 8.7 | **56.2** |
| lowsec | 52.3 | 8.7 | **61.0** |
| deepsec | 57.0 | 8.7 | **65.7** |
| nullsec | 61.7 | 8.7 | **70.4** |
| deepnull | 67.2 | 9.4 | **75.9** |

### 7.5 每小时材料产量（假设：同级成型配置 ~10 分钟/次 20 波 → 6 次/小时）

| 安全层 | 材料/小时 |
|--------|-----------|
| highsec | 278 |
| bordersec | 337 |
| lowsec | 366 |
| deepsec | 394 |
| nullsec | 423 |
| deepnull | 455 |

### 7.6 各档材料供需（双增强剂 = 40 瓶/小时；最低保障而非上限）

需求：普通 2/瓶 → 80/h；精工 4/瓶 → 160/h；传奇 7/瓶 → 280/h。可持续小时 = 该层产量 ÷ 需求：

| 品质 | 需求/h | T1 | T2 | T3 | T4 | T5 |
|------|--------|----|----|----|----|----|
| 普通 | 80 | 3.48 | 4.21 | 4.58 | 4.93 | 5.29 |
| 精工 | 160 | 1.74 | 2.11 | 2.29 | 2.46 | 2.64 |
| 传奇 | 280 | 0.99 | 1.20 | 1.31 | 1.41 | 1.51 |

**诚实结论（修正原错误「落在 1.5~2h 目标内」）**：
- 普通：所有档可持续 **3.5~5.3h** ≥ 最低保障 1.5h ✓
- 精工：所有档可持续 **1.7~2.6h** ≥ 最低保障 1h ✓
- 传奇：T1 理论 0.99h，但**传奇配方实际只映射 T4/T5（或 ≥Lv55 气体）**，故传奇实际可持续 **≥1.41h（T4）/1.51h（T5）** ≥ 最低保障 1h ✓
- 高掉率下各档均**超过**最低保障；若后续觉得过剩，用「每瓶材料数量」旋钮调节（普通 2→3、精工 4→6、传奇 7→10），**绝不降低普通怪掉率**。
- 六安全层**全部单独计算**，未用 highsec/deepnull 两个端点代替。

---

## 8. 增强剂制造经验与时间（Z 方案定案）

### 8.1 设计方法（统一曲线 + 配方经验校准）

沿用全游戏统一 `xpForLevel(L)=floor(100·1.1^(L-1))` 曲线（升 L→L+1 所需，注意是 `(L-1)` 而非 `(L)`），**不为 `boosterEngineering` 设特殊曲线**（规则二/三）。升级时间通过提高精工、传奇配方的单瓶经验，把升级时间拉回目标带，而非改曲线（规则三）。

每瓶经验按解锁等级手工标定，满足两个硬约束：
1. **防永远刷低级（强保证，脚本校验通过 ✓）**：玩家始终应制造「已解锁最优」配方。保证方式：① 每张传奇配方的 `xp/time` 严格大于全部精工/普通（min 传奇 2.391 > max 其他 1.041）；② 传奇序列 `xp/time` 严格递增（2.391→2.475）。因传奇下放到 Lv60 与精工 Lv63/67/71 交错，字面「逐行等级序 xp/time 严格递增」必然出现倒挂（传奇 Lv60 的 2.391 高于精工 Lv63 的 1.014），故不采用该弱校验，改用上述强保证——一旦解锁传奇即始终造最新传奇，xp/time 单调严格上升，不会回头刷低级。
2. **产量恒为 1**：不靠批量产出刷经验。

实测制造时间 `actualTime = baseTime / (1 + 0.02 × boosterEngineering等级)`；下表时间/经验为名义值，随技能等级实际更快。

### 8.2 升级里程碑（始终制造当前已解锁最高 XP/秒 配方，纯制造时间）

| 目标 | 瓶数 | 纯制造h | 目标带 | 落带 |
|------|------|---------|--------|------|
| Lv35 | 2,155 | 8.6h | 8~12h | ✓ |
| Lv60 | 6,280 | 44.5h | 35~60h | ✓ |
| Lv80 | 11,051 | 118.9h | 100~180h | ✓ |
| Lv96 | 28,917 | 390.5h | 300~450h | ✓ |

> 累计 XP（统一曲线）：Lv1→Lv35 = 24,532；Lv60 = 275,773；Lv80 = 1,861,145；Lv96 = 8,555,633。四里程碑全部落入目标带（传奇等级恢复至 Lv60 起、xp 基准 340~440 × 0.90）；Lv96 库存单槽可持续 **1446h** / 双槽 **723h** 消耗（双槽下约 30 天无需再制造）。

### 8.3 30 张配方时间/经验（Z 方案，按解锁等级）

| recipeId | 解锁 | 品质 | 时间(s) | 经验 | XP/秒 |
|---|---|---|---|---|---|
| mining_lubricant_n | Lv1 | 普通 | 18 | 5 | 0.278 |
| mining_lubricant_r | Lv35 | 精工 | 56 | 50 | 0.893 |
| mining_lubricant_l | Lv60 | 传奇 | 128 | 306 | 2.391 |
| shield_recharge_n | Lv4 | 普通 | 18 | 6 | 0.333 |
| shield_recharge_r | Lv39 | 精工 | 58 | 53 | 0.914 |
| shield_recharge_l | Lv64 | 传奇 | 131 | 315 | 2.405 |
| ore_resonance_n | Lv7 | 普通 | 19 | 7 | 0.368 |
| ore_resonance_r | Lv43 | 精工 | 60 | 56 | 0.933 |
| ore_resonance_l | Lv68 | 传奇 | 135 | 326 | 2.415 |
| laser_coolant_n | Lv10 | 普通 | 19 | 8 | 0.421 |
| laser_coolant_r | Lv47 | 精工 | 62 | 59 | 0.952 |
| laser_coolant_l | Lv72 | 传奇 | 138 | 335 | 2.428 |
| relic_solver_n | Lv13 | 普通 | 20 | 9 | 0.450 |
| relic_solver_r | Lv51 | 精工 | 64 | 62 | 0.969 |
| relic_solver_l | Lv76 | 传奇 | 142 | 346 | 2.437 |
| armor_nano_n | Lv16 | 普通 | 20 | 10 | 0.500 |
| armor_nano_r | Lv55 | 精工 | 66 | 65 | 0.985 |
| armor_nano_l | Lv80 | 传奇 | 146 | 356 | 2.438 |
| missile_catalyst_n | Lv20 | 普通 | 21 | 11 | 0.524 |
| missile_catalyst_r | Lv59 | 精工 | 68 | 68 | 1.000 |
| missile_catalyst_l | Lv84 | 传奇 | 149 | 365 | 2.450 |
| artifact_tracer_n | Lv24 | 普通 | 21 | 12 | 0.571 |
| artifact_tracer_r | Lv63 | 精工 | 70 | 71 | 1.014 |
| artifact_tracer_l | Lv88 | 传奇 | 153 | 376 | 2.458 |
| cannon_booster_n | Lv28 | 普通 | 22 | 13 | 0.591 |
| cannon_booster_r | Lv67 | 精工 | 72 | 74 | 1.028 |
| cannon_booster_l | Lv92 | 传奇 | 156 | 385 | 2.468 |
| structure_gel_n | Lv32 | 普通 | 22 | 14 | 0.636 |
| structure_gel_r | Lv71 | 精工 | 74 | 77 | 1.041 |
| structure_gel_l | Lv96 | 传奇 | 160 | 396 | 2.475 |

> **防「永远刷低级」保证（脚本校验通过 ✓）**：传奇下放到 Lv60 后，字面「逐行等级序 xp/time 严格递增」**必然出现倒挂**（传奇 Lv60 的 2.391 高于精工 Lv63 的 1.014 / Lv67 的 1.028 / Lv71 的 1.041），这是下放的必然结果，不视为缺陷。真正的强保证：① 传奇序列 xp/time 严格递增（2.391→2.475）；② 每张传奇 xp/time 严格大于全部精工/普通（min 传奇 2.391 > max 其他 1.041）。因此玩家一旦解锁传奇，始终制造已解锁最优（=最新传奇）时 xp/time 单调严格上升，不会回头刷低级。品质倍率带（相对当前推荐档，规则三）：普通 5~14（基本保持）、精工 50~77（×1.24~1.25，落 1.20~1.35 带）、传奇 **306~396**（基准 340~440 × 0.90，落 1.8~2.1 带）。

### 8.4 批量成本示例（Z 方案）

- 100 瓶精工（均值 ~60s/瓶 @ Lv39 效率 1.78）：约 59 min，材料 = 行星产物 300 + 第二材料 400。
- 1000 瓶精工：约 590 min；1000 瓶传奇（@ Lv80 效率 2.6，均值 ~150s）：约 961 min。
- 在线与离线制造经验/单瓶语义一致（`js/core/offline.js` 同源）。

### 8.5 库存维持与曲线说明（已消除原 X/Y 分歧）

- 原 §8.5 的「方案 X（标准曲线）/ 方案 Y（特例曲线）」二选一**已撤销**：本方案（Z）确认**沿用标准 `1.1^(L-1)` 曲线**，仅通过配方经验校准把升级时间拉回目标带（§8.2 四里程碑全落带），不破坏全技能统一曲线（规则一/二）。
- Lv96 累计 28,917 瓶 → 单槽 1446h / 双槽 723h 可持续消耗。
- 经验曲线、配方经验、升级时间**均已定案**，不再列为待确认项（见 §13 清理）。

---

## 9. 增强剂材料需求反推（结论摘要，详见 PLANETARY_SYSTEM_IMPLEMENTATION_PLAN.md §10）

### 9.1 三类材料每瓶消耗
- **行星产物**（全部 10 系列）：普通 2 / 精工 3 / 传奇 5。
- **战术材料**（仅采集/考古 4 系列的第二材料）：维持 **2/4/7**（规则四，不改动）。
- **气体**（仅战斗 6 系列的第二材料）：改为 **1/2/3**（普通/精工/传奇，规则五；原 2/4/7）。

### 9.2 行星产物需求
- 单系列持续 1 小时（20 瓶）：普通 40 / 精工 60 / 传奇 100 单位；双系列翻倍（80/120/200）。
- 1000 瓶：普通 2000 / 精工 3000 / 传奇 5000 单位。
- 全部 10 系列长期使用时各行星产物需求占比：重金属/稀有气体/同位素/等离子体 各 20%，生物质/磁场聚合物 各 10%（见 §6.3）。
- 行星单基地产量（per-cycle=1，真实公式）：Lv1 时 122~367 单位/小时，各行星解锁等级下 312~367/小时。**单个行星已远超单一系列增强剂需求**——行星产物不构成瓶颈，但也不构成有效 sink（见 PLANETARY_SYSTEM_IMPLEMENTATION_PLAN.md §10.3 膨胀分析）。

### 9.3 气体需求（战斗 6 系列，1/2/3 每瓶）
- 单战斗槽（20 瓶/h）：普通 **20** / 精工 **40** / 传奇 **60** 气体每小时。
- 双战斗槽（40 瓶/h）：普通 **40** / 精工 **80** / 传奇 **120** 气体每小时。
- 气体真实供给、各云团维持时长、双槽异气分采瓶颈见 PLANETARY §10.4（结论：传奇单槽仅 0.36~0.45h、双槽异气分采需囤货；气体是战斗增强剂的真实后期瓶颈）。

---

## 10. 预留实现架构（兼容现有代码，不实装）

### 10.1 资源注册

- 新增命名空间 `booster:`（`pool`），在 `RESOURCE_NAMESPACE_CONFIG`（`js/core/resources.js`）注册；每件增强剂 `booster:<seriesKey>_<q>` 作为可堆叠库存。
- 战斗材料 5 档、考古产物可选门槛走现有 `ResourceRegistry` 寻址（`material:<name>` / `artifact:<name>`）。

### 10.2 数据库（普通 script 全局，非 ES Module）

> 项目使用普通 `<script>` 全局加载，**不是 ES Module**。删除 `export`/`import`。

```js
// js/data/boosters.js  （在 index.html 中于使用者之前加载）
const BOOSTER_SERIES = {
  mining_lubricant:{ name:"纳米采掘润滑剂", slot:"miningSpeed", effectType:"miningSpeed" },
  ore_resonance:    { name:"富矿共振催化剂", slot:"miningYield", effectType:"doubleMineral" },
  // ... 共 10 系列
};
const BOOSTER_RECIPES = [ /* 30 条，见 §4 */ ];
// 每条: { id, itemId, series, quality, level, time, xp,
//          cost:{ planet:{type, qty}, second:{type, qty} },
//          output:{type:"booster", itemId, qty:1}, durationMs:180000, effect:{...} }
```

### 10.3 状态结构（见 §3.2 六槽）

`gameState.boosters = { inventory:{}, active:{...6 槽...}, lastTick }`，六槽各自保存 `itemId` 与 `remainingMs`，离线分别结算。

### 10.4 结算管线（单瓶语义）

- **在线 tick**：`js/core/tick.js` 新增 booster 计时分支——仅当对应行动运行时扣该槽 `remainingMs`；耗尽则从 `inventory` 扣 1 自动补充（§3.5 规则）；0 则清空该槽。
- **离线结算**：`js/core/offline.js` 新增 `settleOfflineBoosters()`，按离线秒数 × 行动运行占比分别扣减六槽（与在线同语义，保留 `remainingMs`）。
- **纯函数显示态**：`js/core/selectors.js:getBoosterDisplayState()` 汇总当前效果乘区，UI 只消费，不直接计算。
- **Action 原子性**：`js/core/actions.js` 的 `booster/manufacture`、`booster/equip`、`booster/unequip` 用 `ResourceRegistry.spendCost` 原子扣料，不足则整体拒绝（§3.5 规则 6）。
- **index.html 加载顺序**：`base.js`(INITIAL_SKILLS) → `boosters.js`(定义 `BOOSTER_SERIES`/`BOOSTER_RECIPES` 全局) → `manufacturing.js`/`production.js` → `ui/booster-render.js` → 其他使用者。`verify.mjs` 未来需检查新增脚本数量与顺序。

### 10.5 GameEvents 事件契约（按单瓶语义设计，见 §3.6）

### 10.6 同类效果避免重复乘算

- 同系列不同品质互斥（装备时校验 `series`）。
- 武器/回复修饰通过 `state.combat.modifiers` 单一管线注入，避免多处乘算。
- 采矿速度/双倍矿物分别注入不同乘区，乘法组合且独立。

---

## 11. 审计计划（tools/audit-boosters.mjs，仅规划不实装）

覆盖 A~Z 二十六项：

A. 30 张配方完整性（系列×品质齐全）　B. 每次产量固定为 1　C. 30 个解锁等级准确　D. 初始等级(Lv1)有可制造配方　E. 升级过程无死锁　F. 每瓶持续 180 秒　G. 停止行动暂停计时　H. 自动补充精确扣 1　I. 库存为 0 时停止效果　J. 六槽双增强剂互斥（miningSpeed+miningYield / archaeologySpeed+archaeologyRare / combatWeapon+combatRepair）　K. 武器类型效果隔离（激光不影响导弹/火炮）　L. 回复类型效果隔离　M. 采矿速度接入（乘区）　N. 双倍矿物概率接入且不翻经验/稀有　O. 考古效率接入（周期时间）　P. 稀有率权重转移且总和 100%　Q. 在线与离线一致　R. 保存读取保留剩余时间（六槽各自）　S. 制造扣料原子性（装入即扣、不足整体拒绝）　T. 制造中切换 UI 不改变实际产物　U. 进度条完成后清零　V. 战斗材料高频掉落（普通 70%）　W. 20 波材料期望达标　X. 行星产出与增强剂消耗闭环　Y. 行星首次建设与维护费用分离　Z. 旧存档迁移幂等。

---

## 12. 未来预计修改的代码文件清单（不实装）

| 文件 | 改动 |
|------|------|
| `js/data/base.js` | `INITIAL_SKILLS` 增 `boosterEngineering:{lvl:1,xp:0}` |
| `js/data/boosters.js`（新） | `BOOSTER_SERIES` + `BOOSTER_RECIPES`（30 条，全局 `const`） |
| `js/data/combat.js` | `resolveCombatEnemyDefeat` 增普通怪战术材料 roll；`COMBAT_SPECIAL_MATERIALS` 登记 5 档材料 |
| `js/data/archaeology.js` | `ARCHAEOLOGY_TIERS` 增 `rareShift` 字段（文物示踪剂乘区） |
| `js/systems/manufacturing.js` | 增增强剂制造分支（效率/输出/XP） |
| `js/systems/production.js` | `getProductionEfficiencyState` 注入采矿速度；采矿双倍 roll 钩子 |
| `js/systems/combat.js` | 武器伤害 modifier 注入；维修量乘区（护盾/装甲/结构） |
| `js/systems/archaeology.js` | 稀有率权重转移实现 |
| `js/core/actions.js` | `booster/manufacture`、`booster/equip`、`booster/unequip` Action |
| `js/core/state.js` | `gameState.boosters` 初始化 |
| `js/core/resources.js` | 注册 `booster:` 命名空间 |
| `js/core/selectors.js` | `getBoosterDisplayState()` 纯函数显示态 |
| `js/core/tick.js` | 在线 booster 六槽计时/自动补充分支 |
| `js/core/offline.js` | `settleOfflineBoosters()` |
| `js/core/persistence.js` | 增强剂存档迁移（幂等） |
| `js/ui/booster-render.js`（新） | 增强剂制造/装备 UI |
| `index.html` | 侧边栏「增强剂制造」页 + DOM；按 §10.4 顺序加载 `boosters.js` |
| `tools/audit-boosters.mjs`（新） | §11 审计 |

> 行星相关文件见 PLANETARY_SYSTEM_IMPLEMENTATION_PLAN.md §6。

---

## 13. 待策划确认（清理后）

### 13.1 本轮已定案（不再待确认）
- **经验曲线**：确认 Z 方案——沿用全游戏统一 `1.1^(L-1)` 曲线，仅配方经验校准（§8）。不再有 X/Y 二选一。
- **维护周期**：行星统一 **24h**（规则六），不再有「基础 24h / 中档 48h / 高档 72h」分歧。
- **气体消耗**：战斗增强剂气体改为 **1/2/3**（原 2/4/7，规则五）；战术材料维持 **2/4/7**（规则四）。
- **文物示踪剂**：相对倍率 **×1.25 / ×1.60 / ×2.20** 定案（§5 五档概率表）。
- **行星产物单位估价**：改为影子价格口径（不可售 → 用增强剂成品价值/同级 ISK 收入/资源机会成本反推），见 PLANETARY §5。原 4/6/8/12/16/25 仅是假设、不可当真实价格。
- **战斗材料掉率**：普通怪 **70% 概率掉落 1 份**对应战术材料定案（§7.2 / §12），规则九明确**不降低掉率**，不随安全层微调。
- **考古产物门槛**：第一版增强剂配方**不消耗考古文物**（传奇文物示踪剂仅以相对倍率作用于稀有/极稀有掉率，不进入任何配方材料清单，为非必需）。

### 13.2 仍待策划确认
1. **双倍矿物上限**：30% 传奇概率是否使采矿平均产量失控（当前测算 1.69×，可控）？
2. **维修增强剂**：是否接受「无对应维修装备则无效果」的诚实设计（不虚构被动再生）？
3. **行星产物 per-cycle 产出**：是否维持 1/周期（当前结论：维持即可，不瓶颈），还是为高档行星提高单次产出？
