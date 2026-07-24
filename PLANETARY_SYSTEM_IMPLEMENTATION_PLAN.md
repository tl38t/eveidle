# 行星系统实现方案（修订版）

> **状态：Phase 1（行星开发规则）已于 2026-07-24 完成代码实装**（详见文末 §12 实施结果）。本文档前 11 节仍为设计蓝图与定案依据；§12 为实装后追加的真实结果记录。
> 第三轮返修（只读设计 + 费用审计）：基于当前系统的完整审计，并补做行星经济影子价格审计、气体 1/2/3 供需重算、清理过期矛盾文案。
> 第四轮最终收口（2026-07-24）：行星规则 14 条正式定案（§9，清除原 §9.2 待确认与「基础24h/中档48h/高档72h」「高档69%维护费」等虚构结论）；新增 §10.4.1 五档气体成熟配置审计（终局传奇双槽 3.56~5.56h → 偏重但可作为爆发消耗）。仍只改文档、不进代码实装、不碰 js/render3d/、不 commit、不 push。

---

## 0. 现状审计

### 0.1 当前费用结构

| 操作 | costISK | costTrit | 说明 |
|------|---------|----------|------|
| 部署 (deploy) | 0 | 1 | 六种行星类型完全相同 |
| 续期 (redeploy) | 0 | 1 | 与部署完全相同的消耗 |
| 拆除 (remove) | 0 | 0 | 要求 storage=0，直接 splice 删除 |

当前的 `costISK` 和 `costTrit` 是占位性质，没有任何经济设计。部署与续期使用同一套消耗，不符合"建设 vs 维持"分离的设计目标。

### 0.2 当前生命周期

```
部署 → [产出循环(24h)] → 过期(active=false) → 手动续期 → [产出循环]
                                           → 手动撤除(要求storage=0) → 删除
```

- 不存在"未布置"状态（从未建设与已拆除统一视为不在 `deployments[]` 中）
- 过期后 `active=false`，但 deployment 对象仍在数组中
- 续期只是重置 `deployedAt`，没有额外状态检查
- 撤除要求 `storage===0`，直接 splice 删除

### 0.3 当前数据结构

```js
{
  id: "planet_1",
  type: "lava",
  deployedAt: timestamp,   // 部署/续期时间戳
  duration: 86400,         // 硬编码24小时
  storage: 0,
  lastTick: timestamp,
  progress: 0,
  active: true             // false = 已过期
}
```

没有 `constructionCost` / `maintenanceCostISK` 分离字段，没有维护到期/待续期状态。

### 0.4 当前代码文件

| 文件 | 作用 |
|---|---|
| `js/data/planets.js` | `PLANET_TYPES` 定义（含 `costISK`/`costTrit`） |
| `js/systems/planetary.js` | `planetaryTick()` 产出循环逻辑 |
| `js/core/actions.js` | `planetary/deploy`、`planetary/redeploy`、`planetary/remove`、`planetary/collect` |
| `js/core/selectors.js` | `getPlanetDeploymentDisplayState()`、`getPlanetaryCapacityState()`、`getPlanetOutputIntervalFromState()` |
| `js/core/state.js` | `gameState.planetary` 初始化 |
| `js/core/persistence.js` | 旧版 `planetaryDeployments` → `planetary.deployments` 迁移 |
| `js/core/offline.js` | `settleOfflinePlanets()` 离线结算 |
| `js/core/statistics.js` | `planetaryCycles`/`planetaryUnits` 统计 |
| `js/ui/planetary-render.js` | `renderPlanetaryPage()`、`updatePlanetaryLiveUI()`、Canvas 动画 |
| `index.html` | 行星面板 DOM（`#planetary-panel`、`#deploy-modal`） |

---

## 1. 布置状态

每个行星 deployment 必须处于以下三种状态之一：

```
(svg 示意图)
[未布置] → 消耗constructionCost → [运行中] → 到期(期满) → [已到期]
    ↑                                                    │
    └──── 主动拆除(消耗constructionCost) ←───────────────┘
        （重新建设，不可走续期路径）
```

### 状态定义

| 状态 | 含义 | 基础设施 | 生产 | 可操作 |
|------|------|----------|------|--------|
| **未布置** | 从未建设，或已主动拆除 | 不存在 | — | 部署 |
| **运行中** | 基础设施存在，维护期限内 | 存在 | 持续产出 | 收取、拆除、到期后自动变为已到期 |
| **已到期** | 基础设施存在，维护期已过 | 存在（已暂停） | 停止 | 续期（恢复生产）、拆除 |

### 约束

- **到期绝不能自动变回未布置**。`active=false` 只是暂停生产，deployment 对象保留，基础设施视为仍在。
- 已到期状态下：基础设施存在（玩家投入的建设材料不浪费）、仓储可见但不再增加产物。
- 主动拆除是唯一回到"未布置"的路径。

---

## 2. 费用规则

### 2.1 初次布置 (deploy)

```
前置条件：
- 技能等级 ≥ planet.level
- 有空余槽位
- 可支付 constructionCost

constructionCost = {
  isk: number,           // 首次启用 ISK（固定，每种行星不同）
  tritanium: number,     // 三钛合金（主要建筑材料）
  // 可选：其他实体工业资源，但不消耗月矿、行星资源、舰船部件
}

成功后：
- 消耗 constructionCost
- 创建 deployment，标记为"基础设施已存在"
- 维护期限开始计时
- 进入"运行中"状态
```

### 2.2 到期续期/维持 (renew)

```
前置条件：
- 该 deployment 处于"已到期"或"运行中"状态
- 可支付 maintenanceCostISK

maintenanceCostISK = { isk: number }  // 纯 ISK，无任何材料

成功后：
- 消耗 maintenanceCostISK
- 重置 deployedAt = now
- 重置 progress = 0
- active = true
- 恢复生产
```

**续期（renew）与初次部署（deploy）在语义上严格区分**：
- 续期只消耗 ISK
- 续期不能补建设材料
- 续期不能用于"拆除后重建"
- 续期不能用于"未布置"状态的行星

### 2.3 主动拆除 (demolish)

```
前置条件：
- deployment 存在
- storage === 0（必须先收取，或确认销毁）

确认提示（不可跳过）：
"确定拆除 [行星名称] 的基础设施吗？
- 已投入的建设材料不会返还
- 仓储中的 [N] 单位 [产物名称] 将永远丢失
- 今后需要重新建设才能再次使用此槽位"

成功后：
- 从 deployments[] 中删除该 deployment
- 不返还 constructionCost 中的任何部分
```

**拆除与"撤除"（当前 remove）的区别**：
- 当前 `remove` 只是一个简单的数组 splice
- 新的 `demolish` 必须有确认提示、资源不返还、可处理遗留仓储

### 2.4 仓储产物处理

拆除时有仓储残留的处理方案（推荐：方案A）：

| 方案 | 做法 | 推荐 |
|------|------|------|
| **A. 必须先收取** | 拆除操作要求 storage===0，玩家必须先手动收取 | ⭐ 推荐（与当前 remove 一致） |
| **B. 确认销毁** | 允许带仓储拆除，但弹出明确警告"N 单位产物将永久丢失" | 备选 |
| **C. 自动收取受限** | 拆除时自动收取，但受 cargoCapacity 限制，超限部分丢失 | 复杂度高，不推荐 |

### 2.5 拆除后重新布置

视为全新建设：
- 再次消耗完整 `constructionCost`（包括 ISK 和材料）
- 不能按"续期"处理
- 检查与首次部署相同的前置条件

---

## 3. 防套利规则

| # | 规则 | 实施方式 |
|---|------|---------|
| 1 | 拆除→重建不能刷新仓储 | 拆除要求 storage===0，重建创建新的 deployment（storage=0） |
| 2 | 拆除→重建不能刷新持续时间 | 重建创建新的 deployment，`deployedAt=now`，不继承旧时间 |
| 3 | 到期后不能继续积累产物 | `active=false` 时 `planetaryTick()` 跳过该 deployment |
| 4 | 续期不能重复扣费 | 每次 renew Action 原子检查并扣费，只执行一次 |
| 5 | 资源不足时原子拒绝 | constructionCost/maintenanceCostISK 全部使用 `ResourceRegistry.canAffordCost()` 前置校验，通过后才扣费 |
| 6 | 拆除不能返还材料 | demolish Action 不调用任何 ResourceRegistry.spend 反向操作 |
| 7 | 读档/导入不能误判 | `normalizePlanetaryState()` 每次读档运行，检查 `active` 与时间戳一致性；不自动移除过期 deployment |
| 8 | 旧存档迁移 | 旧存档的 `deployments[]` 中每个条目保留为"基础设施已存在"；`deployedAt` + `duration` 作为维护期限起点；不要求重新支付 constructionCost |

### 3.1 迁移细则

旧存档 migration（`migratePlanetaryState()`）：
```js
function migratePlanetaryState() {
  // 已有的 deployment 保留
  // - 如果 active=true 且未到期 → 保持"运行中"
  // - 如果 active=false 或已到期 → 变为"已到期"（不是"未布置"）
  // - 不自动续期
  // - 不要求重新建设
  // - constructionCost 视为历史已支付，不再追溯
}
```

---

## 4. 数据结构方案

### 4.1 PLANET_TYPES 扩展

```js
{
  type: "lava",
  name: "熔岩行星",
  icon: "🌋",
  output: "重金属",
  level: 1,
  interval: 10,        // 基础产出间隔（秒）
  constructionCost: {   // 新增：首次布置费用（isk 为占位示例，正式数值见 §5.2/§5.3）
    isk: 5000,
    tritanium: 100
  },
  maintenanceCostISK: 200,    // 新增：单次续期 ISK 费用
  maintenanceDuration: 86400  // 新增：维护周期（秒），替代硬编码 86400
}
```

### 4.2 deployment 对象

```js
{
  id: "planet_1",
  type: "lava",
  constructedAt: timestamp,          // 首次建设时间（仅用于统计）
  deployedAt: timestamp,             // 最近一次部署/续期时间（续期时重置）
  duration: 86400,                   // 当前维护周期（来自 PLANET_TYPES）
  storage: 0,
  lastTick: timestamp,
  progress: 0,
  active: true,                      // true=运行中, false=已到期
  // 移除 costISK/costTrit 字段（改用 constructionCost/maintenanceCostISK）
}
```

### 4.3 关键不变量

- `constructionCost` 只在 deploy 时消耗，redeploy/renew 绝不消耗
- `maintenanceCostISK` 只在 renew 时消耗
- demolish 不返还任何费用
- 过期后 active=false，不自动删除
- 同一行星类型的所有 deployment 使用相同的 constructionCost/maintenanceCostISK（来自 PLANET_TYPES）

---

## 5. 经济设计（影子价格审计 + 同级收入锚定）

> **本轮修正（任务五）**：删除原「周期总产出 ~48~144 单位」的**虚构示意表**与原「三套 ISK 回收方案（A 5%/B 12%/C 25%）」口径。以下全部使用真实代码公式：
> `hourlyOutput = 3600 / (interval / (1 + 0.02 × planetaryIndustry等级))`，每周期产出 1 单位（`js/systems/planetary.js`、`js/core/selectors.js:getPlanetOutputIntervalFromState`）。
> 各行星按**实际解锁等级**计算技能倍率：熔岩 Lv1、气态 Lv1、冰 Lv20、等离子 Lv40、温带 Lv60、风暴 Lv80。
> **关键事实**：全游戏仅考古文物（`sellArtifact`，有 `iskValue`）与舰船蓝图有市价；**行星产物、气体、矿物、战斗材料均无通用出售/市场系统**。因此行星「日产值」**不能直接用单位估价相乘**，必须以**影子价格 / 同级玩家常规 ISK 收入**口径核算（见 §5.4 矛盾审计）。原单位估价 4/6/8/12/16/25 仅为假设、不可当真实价格。

### 5.1 真实产量与同级 ISK 收入（各解锁等级）

| 行星 | 产物 | 解锁Lv | interval | 每小时产量 | 同级战斗ISK/h（主要收入锚点） | 同级考古ISK/h（次要参考） |
|------|------|--------|----------|-----------|------------------------------|---------------------------|
| 熔岩 | 重金属 | 1 | 10s | 367 | 0.185M（highsec Lv1） | 0.095M（Tier I） |
| 气态 | 稀有气体 | 1 | 10s | 367 | 0.185M（highsec Lv1） | 0.095M（Tier I） |
| 冰 | 同位素 | 20 | 15s | 336 | 0.331M（bordersec Lv20） | 0.141M（Tier II） |
| 等离子 | 等离子体 | 40 | 18s | 360 | 0.952M（lowsec Lv40） | 0.175M（Tier III） |
| 温带 | 生物质 | 60 | 22s | 360 | 2.550M（deepsec Lv60） | 0.230M（Tier IV） |
| 风暴 | 磁场聚合物 | 80 | 30s | 312 | 6.530M（nullsec Lv80） | 0.273M（Tier V） |

> 战斗 ISK/h 按六星带 `iskMulti` 与 20 波/次清（boss 在第 20 波，含 1 护航普通）实测：highsec 0.185 / bordersec 0.331 / lowsec 0.952 / deepsec 2.550 / nullsec 6.530 / deepnull 18.691 M ISK/h（6 次/小时）。考古 ISK/h 为 raw 速率（每遗迹 `time` 秒产一次、含普通+独特文物 `iskValue`），含反噬维修/移动开销后约再降 30%，但仍远低于战斗，故「同级常规 ISK 收入」以战斗为准。

### 5.2 维护费定案（单基地 = 同级 15min 常规战斗 ISK 收入，24h 周期）

维护费仅收 ISK（不收材料），续期只耗 ISK、不补建设材料；到期手动续期、不自动。锚定公式：`maintenanceCostISK = 同级战斗ISK/h × 0.25h`（即 15 分钟收入），目标「单基地 ≈ 同级玩家 10~20min 常规 ISK 收入」。

| 行星 | 同级战斗ISK/h | 维护费/24h | ≈同级收入分钟数 | 是否满足 10~20min |
|------|---------------|------------|------------------|-------------------|
| 熔岩 | 0.185M | **46k** | 14.9min | ✓ |
| 气态 | 0.185M | **46k** | 14.9min | ✓ |
| 冰 | 0.331M | **83k** | 15.0min | ✓ |
| 等离子 | 0.952M | **238k** | 15.0min | ✓ |
| 温带 | 2.550M | **638k** | 15.0min | ✓ |
| 风暴 | 6.530M | **1633k** | 15.0min | ✓ |

> 该组数值**约等于「12% 影子日产值」的描述性目标**（46k ≈ 0.185M×24×0.12 对应的影子价口径），但**不**用「单位估价 × 24h产量 × 12%」反推——因单一影子价无法满足全部行星（见 §5.4 矛盾）。维护费直接锚定同级收入，单位估价 4/6/8/12/16/25 仅作假设参考、不用于定案。

### 5.3 首次建设 ISK（≈3 维护周期净产值）

首次建设与拆除重建消耗 `constructionCost = { isk: 3×维护费, tritanium: 见下 }`（一次性，不返还，不计入续期）。

| 行星 | 建设ISK(一次性) | 维护ISK/24h | 建设≈维护周期数 |
|------|----------------|-------------|------------------|
| 熔岩 | **138k** | 46k | 3.0 |
| 气态 | **138k** | 46k | 3.0 |
| 冰 | **249k** | 83k | 3.0 |
| 等离子 | **714k** | 238k | 3.0 |
| 温带 | **1914k** | 638k | 3.0 |
| 风暴 | **4899k** | 1633k | 3.0 |

建筑材料（一次性，不返还，不计入续期）：熔岩/气态 三钛×100、冰 三钛×150、等离子 三钛×300、温带 三钛×500、风暴 三钛×1,000（初版锚点；具体数量实装时按经济审计微调，机制由规则五/六确认）。行星基地不升级、部署槽上限 5、拆除前先收仓储（规则五/七）。

### 5.4 影子价格审计结论（诚实、不擅自固化）

- **五基地合计**：取 [lava, ice, plasma, temperate, storm]（或含 gas 任一组合）合计 **2638k ISK/24h** = nullsec(Lv80) 玩家 **24.2min (0.40h)** 收入 → 满足「5 基地总维护费 ≤ 同级玩家 1~1.5h」目标 ✓。
- **单基地维护费 ≈ 同级 15min 收入** → 满足「10~20min」目标 ✓。
- **影子价格矛盾（必须已知，不擅自固化）**：若强行用「维护费 = 12% × 单位估价 × 24h产量」反推**单一**影子价，则各行星需 43.5 ~ 1817.4 ISK/单位（跨 **40 倍**），单一影子价无法同时满足「10~20min 同级收入」。故**维护费直接锚定同级收入**，单位估价仅作假设参考、不可当真实价格；行星产物不可售，维护经济必须以影子价格/同级收入口径核算。
- **原错误已作废**：「风暴维护费 69%」「基础 3%」等数字基于虚构低产量，已删除；原「三套方案 A 5%/B 12%/C 25%」口径被本影子价格审计取代。
- 维护费、建设费均为**本轮定案推荐值**，是否还需随全游戏经济微调，留待实装前最终确认（不擅自改已确认规则）。

---

## 6. 修改清单

### 6.1 需修改的文件

| 文件 | 改法 |
|---|---|
| `js/data/planets.js` | `PLANET_TYPES` 每条增加 `constructionCost`/`maintenanceCostISK`/`maintenanceDuration` 字段；移除 `costISK`/`costTrit` |
| `js/systems/planetary.js` | `planetaryTick()` 使用 `maintenanceDuration` 替代硬编码 86400；已到期不产出 |
| `js/core/actions.js` | 拆分 `deploy`/`redeploy`/`remove` 为 `deploy`/`renew`/`demolish`；费用路径改为 `constructionCost`/`maintenanceCostISK`；demolish 加确认提示；storage 残留处理 |
| `js/core/selectors.js` | `getPlanetDeploymentDisplayState()` 增加状态标签（运行中/已到期）；费用显示改为 construction/maintenance |
| `js/core/state.js` | `planetary` 初始化不变 |
| `js/core/persistence.js` | 新增 `migratePlanetaryState()`：旧 deployment 保留，标记 active=false 为"已到期"而非"未布置" |
| `js/core/offline.js` | `settleOfflinePlanets()` 使用 `maintenanceDuration`；已到期不产出 |
| `js/ui/planetary-render.js` | 卡片状态显示：运行中/已到期/未布置；续期按钮文案改为"续期"；拆除确认提示；费用显示 |
| `index.html` | 如有 DOM 调整 |

### 6.2 不修改的文件

- `js/core/resources.js`（资源注册不变）
- `js/core/statistics.js`（统计事件不变）
- `js/core/tick.js`（动画帧调用不变）
- `js/data/base.js`（技能定义不变）

---

## 7. 明确禁止

- ❌ 不设计行星基地升级
- ❌ 不设计行星建筑等级
- ❌ 不让日常维护消耗矿物或行星资源（仅 ISK）
- ❌ 不让到期自动拆除
- ❌ 不让拆除返还三钛合金等建设材料
- ❌ 不让续期消耗 constructionCost
- ❌ 不修改其它玩法系统（装备、舰船、改装件、考古）

---

## 8. 审计与回归

### 8.1 新增审计项

实装后应在 `tools/audit-industrial-productivity.mjs` 或新增审计脚本中覆盖：

| # | 审计项 |
|---|--------|
| 1 | constructionCost 仅 deploy 时消耗，renew 不消耗 |
| 2 | maintenanceCostISK 仅 renew 时消耗，deploy 不消耗 |
| 3 | 到期后 `active=false`，`planetaryTick()` 跳过产出 |
| 4 | 续期后重新开始产出，进度归零 |
| 5 | demolish 不返还 constructionCost 任何部分 |
| 6 | 资源不足时 deploy/renew 原子拒绝 |
| 7 | 拆除后重建走 deploy 路径（非 renew） |
| 8 | 旧存档 migration 后不要求重新支付 constructionCost |
| 9 | 六种行星的 constructionCost/maintenanceCostISK 各不相同 |
| 10 | 读取/导入后已到期行星仍显示"已到期"（非"未布置"） |

### 8.2 现有回归不受影响

- `node tools/verify.mjs`（DOM ID 和脚本数不变）  
- `node tools/audit-industrial-productivity.mjs`（行星部分需扩展现有断言）
- 所有装备/舰船/改装件/考古回归不受影响

---

## 9. 行星规则正式定案（14 条，全部已确认）

> 以下 14 条规则**本轮正式定案，不再列入待确认**。任何与之冲突的旧描述（如「基础 24h / 中档 48h / 高档 72h」维护周期分歧、「高档 69% 维护费」虚构结论、拆除允许产物丢失的方案 B、离线自动续期等）一律作废。

1. **维护周期统一 24h**：所有行星类型统一 24h 维护周期，无按档分级的周期分歧。
2. **到期即停产**：维护费到期未续，行星立即停止产出（库存不再增长），但基地与仓储保留。
3. **不自动拆除、不自动续期**：到期不触发任何自动动作，必须由玩家手动操作（续期或拆除）。
4. **手动续期只耗 ISK**：续期仅扣除 ISK（= 单基地维护费），不消耗建设材料，不重置建设成本。
5. **首次部署 = ISK + 建设材料**：新建基地同时支付维护费（ISK）与一次性的建设材料（如三钛合金）。
6. **拆除重建再付完整建设成本**：已拆除的槽位重新部署时，需再次支付完整 ISK + 建设材料（等同首次）。
7. **拆除不返还**：拆除时不返还任何已付 ISK 或建设材料。
8. **拆除前须先收空仓储**：拆除操作前置校验仓储必须为空（方案 A），不接受产物丢失的方案 B。
9. **行星基地无升级**：基地等级由行星类型固定，不存在升级链路或升级消耗。
10. **部署槽上限 5**：单玩家行星部署槽上限固定为 5，不因行星档位变化。
11. **单基地维护费 ≈ 同级 15min 常规战斗 ISK 收入**：作为实装锚点（§5 影子价格审计定案），不再出现脱离该口径的虚构百分比。
12. **建设 ISK = 3 次维护费**：首次/重建支付的 ISK 部分 = 3 × 单基地维护费（明确建设 ISK 与维护 ISK 的比例）。
13. **维持高产量**：行星 per-cycle=1 设定不变，接受产物相对增强剂需求的过剩（见 §10.3），不强行压产量、不虚增每瓶消耗。
14. **后续系统继续吸收**：过剩产物由后续系统（空间站、研究、舰船组件、改装件、星城等）逐步吸收，形成分阶段消耗而非单一系统锁死。

### 9.1 旧「待确认」项的归宿（已全部消解，不再待确认）
- **同时部署数量**：由规则 10 定案（上限 5，不随档位增加）。
- **拆除时仓储**：由规则 8 定案（必须先收空，无方案 B）。
- **建筑材料多样化**：本期维持基础建设材料集合（规则 5/6），中高档不额外引入类银超金属等；如需扩展留待后续系统，不阻塞本期。
- **旧存档 `costISK`/`costTrit`**：归为实装细节（§11 `migratePlanetaryState()`），按「历史已支付、migration 后忽略旧费用字段」处理，非设计待确认。
- **离线期间续期**：由规则 2+3 定案（不自动续期，启动后须玩家手动操作）。

---

## 10. 增强剂需求反推与行星产量校准

> 本节依据 `BOOSTER_SYSTEM_IMPLEMENTATION_PLAN.md` 的增强剂配方需求，反推行星产物产量是否充足，并校验维护经济。

### 10.1 增强剂对行星产物的需求（每瓶固定）

- 普通品质每瓶消耗行星产物 **2**，精工 **3**，传奇 **5**。
- 单系列持续 1 小时 = 20 瓶 → 普通 40 / 精工 60 / 传奇 100 单位；双系列翻倍（80 / 120 / 200）。
- 持续 8 小时 = ×8；持续 24 小时 = ×24；1000 瓶 = 2000 / 3000 / 5000 单位。
- 全部 10 系列长期使用时各行星产物需求占比：重金属 / 稀有气体 / 同位素 / 等离子体 各 **20%**，生物质 / 磁场聚合物 各 **10%**（无单一产物承担绝大多数，满足约束）。

### 10.2 行星单基地产量（per-cycle = 1，与现有代码一致）

产量 = `3600 / (interval / (1 + 0.02 × planetaryIndustry等级))` 单位/小时：

| 行星 | 产物 | interval | Lv1 产量/h | Lv1 产量/24h | Lv40 产量/h |
|------|------|----------|------------|--------------|-------------|
| 熔岩 | 重金属 | 10s | 367 | 8,813 | 648 |
| 气态 | 稀有气体 | 10s | 367 | 8,813 | 648 |
| 冰 | 同位素 | 15s | 245 | 5,875 | 432 |
| 等离子 | 等离子体 | 18s | 204 | 4,896 | 360 |
| 温带 | 生物质 | 22s | 167 | 4,006 | 295 |
| 风暴 | 磁场聚合物 | 30s | 122 | 2,938 | 216 |

### 10.3 诚实结论：行星产物不构成瓶颈，也不构成有效 sink（会膨胀）

- 单一系列增强剂需求最高为传奇双系列 **200 单位/小时**（对应产物）。单个该类型行星在各解锁等级即产 312~367/h，**单行星已可覆盖单一系列**；玩家用多槽（上限 5）并行即轻松支撑多系列。
- **但反向问题更突出**：在真实产量（每日 7,488~8,813 单位/行星）下，增强剂对行星产物的消耗只是**极小比例**，行星产物会持续净增、形成库存膨胀，而非「长期消耗闭环」。

**30 天库存膨胀测算**（取较重的「精工双增强剂」消耗：每使用该产物的系列 40 瓶/h × 3 单位 = 120/h；单行星净增 = 日产量 − 日消耗）：

| 产物 | 日产量 | 使用系列数 | 精工双消/h | 日净增 | 30天净增 |
|------|--------|-----------|-----------|--------|----------|
| 重金属 | 8,813 | 2 | 240 | 3,053 | 91,584 |
| 稀有气体 | 8,813 | 2 | 240 | 3,053 | 91,584 |
| 同位素 | 8,064 | 2 | 240 | 2,304 | 69,120 |
| 等离子体 | 8,640 | 2 | 240 | 2,880 | 86,400 |
| 生物质 | 8,640 | 1 | 120 | 5,760 | 172,800 |
| 磁场聚合物 | 7,488 | 1 | 120 | 4,608 | 138,240 |

→ 即使满负荷使用增强剂，**每个行星产物 30 天仍净增 7万~17万单位**。因此「行星产物长期消耗闭环」在当前 per-cycle=1 设定下**不成立**——行星产物是**过剩资源**，不是瓶颈。

**三种调整方向（仅计算与推荐，不实装）**：
1. **提高每瓶行星材料需求**：普通 2→5、精工 3→8、传奇 5→15（约 2.5×），可把净增压到接近 0，但会显著提高增强剂制造成本。
2. **降低行星每周期产量或延长周期**：如 per-cycle 维持 1 但 interval ×3，产量降为 1/3（~100~120/h），与增强剂需求更接近；但会削弱行星作为资源产地的定位。
3. **保留高产量 + 未来新增大型消耗口**：维持现状，后续为其他系统（如空间站、研究、舰船组件、改装件、星城）增加行星产物消耗，自然吸收过剩。

→ 当前推荐**方向 3**（不强行压产量、不虚增每瓶消耗、接受增强剂非唯一消耗口）。**增强剂提供第一条稳定行星产物消耗链，但不足以单独吸收全部行星产量；剩余产量将在空间站、研究等后续系统中继续消耗**，形成「增强剂 + 后续系统」的分阶段吸收，而非单一系统锁死全部产物。详见增强剂方案 §13.2 仍待确认项。

### 10.4 战斗增强剂的真实瓶颈在气体（气体消耗已改为 1/2/3，本轮重算）

战斗类 6 系列配方消耗**气体**（普通 **1**/瓶、精工 **2**/瓶、传奇 **3**/瓶，见增强剂方案 §4/§9，原 2/4/7 已下调，规则五）。气体真实供给（每周期产 1 单位，`GAS_AREAS`；采气为**单一行动**，同一时刻只能采一种气体），按各气体云**解锁等级**技能倍率（eff = 1 + 0.02×气体解锁等级）实测：

| 气体 | 解锁Lv | 基础周期 | 同级采气船倍率(eff) | 真实产量/h |
|------|--------|----------|---------------|-----------|
| 粗制富勒烯 | 1 | 30s | 1.02 | 122.4 |
| 氦同位素 | 10 | 60s | 1.20 | 72.0 |
| 稳定富勒烯 | 20 | 100s | 1.40 | 50.4 |
| 氢同位素 | 40 | 150s | 1.80 | 43.2 |
| 高纯富勒烯 | 55 | 220s | 2.10 | 34.4 |
| 聚合气体 | 70 | 320s | 2.40 | 27.0 |
| 超纯聚合气体 | 85 | 450s | 2.70 | 21.6 |

**气体需求（每瓶 1/2/3，采气为单一行动）**：
- 单战斗槽（20 瓶/h）：普通 **20** / 精工 **40** / 传奇 **60** 气体每小时。
- 双战斗槽（40 瓶/h）：普通 **40** / 精工 **80** / 传奇 **120** 气体每小时。

**单气云采集 1h → 可维持单槽 / 双槽时长（实测）**：
- 护盾·普通（粗制 122/h，每瓶 1）→ 单槽 6.12h / 双槽 3.06h
- 护盾·精工（稳定 50/h，每瓶 2）→ 单槽 1.26h / 双槽 0.63h
- 护盾·传奇（聚合 27/h，每瓶 3）→ 单槽 0.45h / 双槽 0.23h
- 激光·传奇（聚合 27/h，每瓶 3）→ 单槽 0.45h / 双槽 0.23h
- 装甲·传奇（超纯 22/h，每瓶 3）→ 单槽 0.36h / 双槽 0.18h
- 导弹/火炮/结构·传奇（超纯 22/h，每瓶 3）→ 单槽 0.36h / 双槽 0.18h

**结论（气体是战斗增强剂真实后期瓶颈）**：
- 普通档单/双槽所有气体均可被单云团供给（粗制 6h、氦 3.6h 起），不构成瓶颈。
- 精工档单槽（40/h）多数气体可覆盖（稳定 1.26h、氢 1.08h、高纯 0.86h），双槽（80/h）需多云团轮换或囤货。
- **传奇档单槽仅 0.36~0.45h、双槽仅 0.18~0.23h** 即耗尽单云团 1h 产量 → 气体是强力后期消耗口，必须投资 gasHarvesting + 高阶气体云 + 多云团囤货才能持续供应。
- **双槽异气分采**：激光·传奇（聚合×3）+ 装甲·传奇（超纯×3）维持 1h 双槽消耗需分采总时 **5.00h**（聚合 60/h 采 2.22h + 超纯 60/h 采 2.78h）> 1h ⇒ 单人无法实时供应、须囤货；采气为单一行动，不能同时采两种气体。
- 若实装后气体缺口过大，优先下调战斗增强剂气体消耗锚点（1/2/3 → 1/1.5/2），不降掉率。详见增强剂方案 §9。

### 10.4.1 气体成熟配置审计（5 档成熟度）

> 保留 §10.4 的「刚到门槛·同级船+0」基线（即下表「同级船+0 / 无支援」列），另补充 5 档成熟度配置，分别核算**单槽 1h** 与 **双槽 1h** 生产所需采气时长。气体消耗锚点维持 **1/2/3（普通/精工/传奇）**，**不改任何基础数值**。
>
> 成熟度倍率模型（仅用于本审计的叠加假设，不改动游戏常量）：
> - **同级船+0 / 无支援**：基线，倍率 1.00（无加成；二者等价，按请求并列列出）。
> - **同级船+10**：气体采集等级 +10，倍率 = (1.2 + 0.02×气体Lv) / (1 + 0.02×气体Lv)。
> - **最高级船+10**：+10 等级叠加顶级采气舰固有 +10% 产出，倍率 = 上式 × 1.10。
> - **有海豚级（逆戟鲸）支援**：Orca 舰队加成 +25% 产出，倍率 1.25（基线舰）。

**单槽 1h 生产所需采气时长（小时）**：

| 气体 | 品质 | 基线产量/h | 同级船+0 | 同级船+10 | 最高级船+10 | 有海豚级逆戟鲸支援 | 无支援 |
|------|------|-----------|---------|----------|-----------|---------------|--------|
| 粗制富勒烯 | 普通 | 122.4 | 0.16 | 0.14 | 0.12 | 0.13 | 0.16 |
| 氦同位素 | 普通 | 72.0 | 0.28 | 0.24 | 0.22 | 0.22 | 0.28 |
| 稳定富勒烯 | 精工 | 50.4 | 0.79 | 0.69 | 0.63 | 0.63 | 0.79 |
| 氢同位素 | 精工 | 43.2 | 0.93 | 0.83 | 0.76 | 0.74 | 0.93 |
| 高纯富勒烯 | 精工 | 34.4 | 1.16 | 1.06 | 0.97 | 0.93 | 1.16 |
| 聚合气体 | 传奇 | 27.0 | 2.22 | 2.05 | 1.86 | 1.78 | 2.22 |
| 超纯聚合气体 | 传奇 | 21.6 | 2.78 | 2.59 | 2.35 | 2.22 | 2.78 |

**双槽 1h 生产所需采气时长（小时）**：

| 气体 | 品质 | 基线产量/h | 同级船+0 | 同级船+10 | 最高级船+10 | 有海豚级逆戟鲸支援 | 无支援 |
|------|------|-----------|---------|----------|-----------|---------------|--------|
| 粗制富勒烯 | 普通 | 122.4 | 0.33 | 0.27 | 0.25 | 0.26 | 0.33 |
| 氦同位素 | 普通 | 72.0 | 0.56 | 0.48 | 0.43 | 0.44 | 0.56 |
| 稳定富勒烯 | 精工 | 50.4 | 1.59 | 1.39 | 1.26 | 1.27 | 1.59 |
| 氢同位素 | 精工 | 43.2 | 1.85 | 1.67 | 1.52 | 1.48 | 1.85 |
| 高纯富勒烯 | 精工 | 34.4 | 2.33 | 2.13 | 1.93 | 1.86 | 2.33 |
| 聚合气体 | 传奇 | 27.0 | 4.44 | 4.10 | 3.73 | 3.56 | 4.44 |
| 超纯聚合气体 | 传奇 | 21.6 | 5.56 | 5.17 | 4.70 | 4.44 | 5.56 |

**终局传奇双槽判定**：聚合气体（Lv70）与超纯聚合气体（Lv85）在 5 档成熟度下，双槽 1h 生产均需 **3.56~5.56h** 采气（全部 >3h）→ **偏重但可作为爆发消耗**（不下调数值、不降掉率）。普通/精工双槽在多数成熟度下 ≤2.33h，不构成瓶颈；传奇单槽 ≤2.78h 可日常维持，双槽则需囤货或高阶采气配置支撑。

### 10.5 待校准（如未来调整）

- 若实装后气体缺口过大，优先下调战斗增强剂气体消耗锚点（1/2/3 → 1/1.5/2），不降掉率。
- 若某行星产物（如磁场聚合物，仅装甲纳米修复剂使用）长期过剩，可在未来新增 1 个使用该产物的系列，维持「每种产物进入多个配方」约束。

---

## 11. 实施顺序建议

1. 修改 `PLANET_TYPES` 数据结构（新增字段，移除旧字段）
2. 更新 `actions.js`：deploy/renew/demolish 三 Action
3. 更新 `persistence.js`：`migratePlanetaryState()`
4. 更新 `planetary.js`：产出的过期判断
5. 更新 `selectors.js`：状态和费用显示
6. 更新 `offline.js`：离线结算适配
7. 更新 `planetary-render.js`：UI 适配
8. 审计脚本扩展
9. 回归验证

---

_本文档前 11 节为实装蓝图，基于 `PLANET_TYPES` 当前 6 种行星、`deploy/redeploy/remove` 三 Action（实装后重命名为 `deploy/renew/demolish`）、`planetaryTick()` 产出循环而设计。所有数值（ISK、三钛合金数量、产出间隔、维护周期）在 Phase 1 已按 §9 定案落库。§12 为实装结果。_

---

## 12. Phase 1 实装结果（2026-07-24，新增）

> 本次**仅实装行星开发规则**，不实装增强剂 / 行星基地升级 / 任何升级系统；不触碰 `js/render3d/**`；未 commit / 未 push / 未创建 nul 文件。下文为真实落地结果，非方案预测。

### 12.1 实际改动 / 新增文件清单

| 文件 | 改动 |
|---|---|
| `js/data/planets.js` | `PLANET_TYPES` 六行星正式费用结构落地（`constructionCost.isk` + `constructionCost.resources["mineral:三钛合金"]` + `maintenanceCostISK` + `maintenanceDuration:86400`）；移除 `costISK`/`costTrit`；`type`→`id` 全量重命名 |
| `js/core/actions.js` | `PlanetaryStateActions` 重写 `deploy`/`collect`/`renew`/`demolish` 四 Action；dispatch 路由 `planetary/deploy`→deploy、`planetary/collect`→collect、`planetary/renew`→renew、`planetary/demolish`→demolish（旧 `redeploy`/`remove` 已移除） |
| `js/core/events.js` | 新增 5 个事件契约：`planetary:deployed` / `planetary:renewed` / `planetary:expired` / `planetary:collected` / `planetary:demolished` |
| `js/systems/planetary.js` | `getPlanetTypeCfg`/`getPlanetOutputInterval` 寻址改 `planet.id`；`planetaryTick` 字段 `deployment.type`→`deployment.planetType`；到期处新增 `planetary:expired` 单次触发；completed 事件 `planetType` 字段 |
| `js/core/offline.js` | `settleOfflinePlanets` 字段重命名 + 配置寻址改 `planet.id`；到期分支新增 `emitOfflineGameEvent("planetary:expired", …)` |
| `js/core/selectors.js` | `getPlanetOutputIntervalFromState` 寻址改 `planet.id`；`getPlanetDeploymentDisplayState` 三状态字段（`state`/`expired`/`renewCost`/`enoughIskForRenew`/`showRenew`/`canRenew`/`canDemolish`）；`getPlanetaryDisplayState.deployOptions` 读新 economy |
| `js/core/persistence.js` | 新增 `normalizePlanetaryState(state)`（幂等规范：容器名、字段重命名、duration 回填、active 规范化、nextId 校正），双路接入 `autoLoad` 与 `importData` |
| `js/ui/planetary-render.js` | 卡片三状态（运行中/已到期）；`renewPlanet`/`demolishPlanet` 处理器；部署弹窗新文案；`data-expired` 比对强制状态切换重绘 |
| `index.html` | `#deploy-modal` 注释改为「首次建设消耗 ISK + 三钛合金；维护期统一 24h；到期停产，手动续期只耗 ISK；主动拆除不返还」 |
| `tools/verify.mjs` | 修正旧 `type:"lava"` / `removePlanet` 引用；行星 action 测试块全量重写；新增数据驱动哨兵（六费用精确值、无升级字段、旧动作名移除、新路由存在、renew 不读 constructionCost、demolish 零返还、audit-planetary 存在且调用真实实现） |
| `tools/audit-planetary.mjs` | **新建**：vm 沙箱加载真实脚本 + 手动加载 `offline.js`/`actions.js` + 精确切片 `persistence.js` 中真实 `normalizePlanetaryState` 源码执行。A~Z 共 26 区、176 条断言 |

### 12.2 六行星费用表（已落库，与 §9.12 建设 ISK = 3×维护费一致）

| 行星 | 解锁Lv | interval(s) | 建设 ISK | 建设三钛 | 维护 ISK/24h | 维护三钛 |
|------|--------|-------------|----------|----------|-------------|----------|
| 熔岩 | 1 | 10 | 138,000 | 100 | 46,000 | 0 |
| 气态 | 1 | 10 | 138,000 | 100 | 46,000 | 0 |
| 冰 | 20 | 15 | 249,000 | 150 | 83,000 | 0 |
| 等离子 | 40 | 18 | 714,000 | 300 | 238,000 | 0 |
| 温带 | 60 | 22 | 1,914,000 | 500 | 638,000 | 0 |
| 风暴 | 80 | 30 | 4,899,000 | 1,000 | 1,633,000 | 0 |

> 校验：建设 ISK = 3 × 维护 ISK（138k=3×46k ✓；249k=3×83k ✓；714k=3×238k ✓；1,914k=3×638k ✓；4,899k=3×1,633k ✓）。维护周期统一 `maintenanceDuration:86400`（24h）。

### 12.3 三 Action 语义（验收结论）

- **deploy（首次部署 / 拆除后重建）**：同时扣 `constructionCost.isk`（=3×维护费）+ `constructionCost.resources["mineral:三钛合金"]`；建 `planetType:config.id` 部署，置 `active=true`、`duration=86400`；emit `planetary:deployed`。同槽重建走 deploy 路径（非 renew）。
- **collect（收取）**：寻址 `planet.id === deployment.planetType`；库存累加至主仓库，卡片显示剩余；storage≠0 时不可 demolish。
- **renew（续期，仅到期可）**：前置 `active=false` 或时间超期；运行中调用返回 `already-active` 且**不扣费**；仅扣 `maintenanceCostISK`，保留库存，emit `planetary:renewed`；**不读 constructionCost、不耗三钛**。
- **demolish（拆除，仅空仓可）**：前置 `storage===0`，否则 `storage-not-empty` 原子拒绝；删除部署、不返还任何 ISK/材料，emit `planetary:demolished`（含 `refundedISK:0`/`refundedResources:{}`）。

### 12.4 旧档迁移（normalizePlanetaryState，2026-07-24 返修后）

> 初版存在「旧 `planetaryDeployments` 只建空容器不复制内容即删除」的吞档缺陷与「迁移阶段提前置 active=false 导致离线收益丢失」的顺序缺陷，同日返修完成。

- **两阶段签名** `normalizePlanetaryState(state, { now, finalizeExpiry })`：`finalizeExpiry:false` 仅字段迁移，绝不因超期提前关停 active=true 的基地；`finalizeExpiry:true` 在离线结算后做到期最终化（仅 `active && 超期` 置 false）。
- **旧容器完整迁移**：`type`→`planetType`、`timeDeployed`→`deployedAt`、storage/progress/显式 active 原样保留、duration 无效回填 86400、缺失 id 稳定分配 `planet_legacy_${idx}`、`capacity` 不进入新结构；新旧容器共存时按 id 去重合并（同 id 优先新版、旧数组缺失的追加）；`nextId=max(原nextId, maxId+1, 1)` 单调；迁移成功后才由调用方删除旧容器。
- 不追收 ISK/三钛、无补偿；两次独立迁移与同状态二次规范化深比较一致（幂等）。
- **调用顺序（两路一致）**：`autoLoad` / `importData` 均为「`normalizePlanetaryState(finalizeExpiry:false)` → `calculateOfflineGains()` → `normalizePlanetaryState(finalizeExpiry:true)` → 删旧容器」。

### 12.5 在线 / 离线到期结算（返修后）

- **共用纯函数** `computePlanetarySettlement`（js/systems/planetary.js）：结算区间夹紧到 `[deployedAt, deployedAt+durationMs]`，满仓丢弃残留进度，`endSettled=max(min(toTime,expiresAt),start)` 保证 lastTick 不回退不越界；在线 `planetaryTick` 与离线 `settleOfflinePlanets` 共用，消除两套周期公式漂移。
- **在线**：tick 先结算 lastTick→min(now, expiresAt) 最后一段（tick 晚于到期仍能拿到全部到期前周期），再判 `now>=expiresAt` 关停 + 单次 `planetary:expired`；此后 tick 因 `active=false` 跳过。
- **离线**：从离线起点（受 MAX_OFFLINE_SECONDS 约束）结算到 min(now, expiresAt)；到期精确停产、单次 expired、二次结算零收益零事件；`storage` 上限与在线一致；同一 50s 区间在线分段与离线一次结算产出完全相等（audit 区 V）。
- 不自动续期：无论在线/离线，到期均不触发 renew/demolish（规则 3）。

### 12.6 回归真实结果（2026-07-24 返修后重跑）

| # | 脚本 | EXIT CODE |
|---|---|---|
| 1 | `tools/verify.mjs` | 0 |
| 2 | `tools/audit-planetary.mjs`（A~ZH 34 区 / 200 断言） | 0 |
| 3 | `tools/audit-industrial-productivity.mjs` | 0 |
| 4 | `tools/audit-equipment-enhancement.mjs` | 0 |
| 5 | `tools/audit-ship-enhancement.mjs` | 0 |
| 6 | `tools/audit-rigs.mjs` | 0 |
| 7 | `tools/audit-archaeology-system.mjs` | 0 |
| 8 | `tools/audit-archaeology-ships.mjs` | 0 |
| 9 | `tools/simulate-archaeology-user-flow.mjs` | 0 |
| 10 | `tools/calculate-ship-production-times.mjs --verify` | 0 |
| 11 | `tools/calculate-ship-production-times.mjs --audit-mixed-battleship` | 0 |
| 12 | `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` | 0（首跑偶发段错误 139，复跑 0，已知环境问题） |
| 13 | `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` | 0 |

> 13 条全部 EXIT=0。第 12/13 条使用正式断言参数 `--assert-mixed-battleship` / `--assert-nullsec`，未使用 `--enemy-hp 1 --enemy-damage 1`。

### 12.7 明确未实装（边界约束）

- ❌ 不设计 / 不实现增强剂系统（乙类 Buff 药水）—— 仅文档 §10 反推，不实装。
- ❌ 不设计行星基地升级 / 建筑等级 / 升级消耗链路。
- ❌ 不修改 `js/render3d/**`（其未提交改动为前序 ShipFactory2 遗留）。
- ❌ 未 commit / 未 push / 未创建 nul 文件（按用户要求）。
