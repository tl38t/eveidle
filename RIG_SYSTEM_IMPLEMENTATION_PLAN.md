# 改装件系统 Phase 3A 完整实装方案（修订版）

> **本轮只修改本方案文档，不实装代码、不修改游戏数据、不更新 eveidle.md/DEVLOG.md、不创建测试文件、不执行 git commit。**

---

## 一、当前 rig 架构审计

### 1.1 已有基础

| 层面 | 现状 | 来源 |
|:---|:---|:---|
| **舰船 rig 槽** | 所有舰船 `slots.rig` 字段完整 | `js/data/ships.js`：护卫/驱逐 1、巡洋/工业巡洋 2、战列/工业战列 3、旗舰/工业旗舰 4、超级旗舰 5。考古舰按舰级同上。 |
| **装配数据结构** | `createEmptyFitting()` → `{ high:[], mid:[], low:[], rig:[] }` | `js/core/state.js:144` |
| **装配 Action** | `setFittingSlot` 接受 `slot:"rig"`；校验 `config.slots[slot]` | `js/core/actions.js:648-651` |
| **重置 Action** | `resetFitting` 遍历 `["high","mid","low","rig"]`，全部清除并归还 inventory | `js/core/actions.js:684-700` |
| **装备实例系统** | `equipment.inventory` / `equipment.instances` / `nextInstanceId` | `js/core/state.js:77` |
| **战斗模块扫描** | `getInstalledCombatModulesFromState` 遍历 `["high","mid","low","rig"]`，取 `definition.combat` | `selectors.js:734-750` |
| **生产效率计算** | `getProductionEfficiencyState` 遍历 `["high","mid","low","rig"]`，读 `bonuses.miningEfficiency`/`gasEfficiency`/`miningLaserEfficiency`/`gasLaserEfficiency` | `selectors.js:197-203,206-221` |
| **槽位上限** | `setFittingSlot` 校验 `slotIndex < config.slots[slot]` | `actions.js:651` |
| **规范化** | `normalizeFitting` 已处理 `rig` 数组 | `state.js:147-151` |

### 1.2 当前缺失

| 缺失项 | 文件 | 行号/位置 |
|:---|:---|:---|
| **rig 槽 UI 硬禁用** | `selectors.js` | 1468 行 `type !== "rig"` 令 rig 槽 `enabled=false` |
| **考古 scan 不读 rig** | `archaeology.js` | 18 行 `["high","mid","low"]` 不含 `"rig"` |
| **考古 fuel/interference 无入口** | `archaeology.js` | — |
| **战斗 HP 无 rig 加成** | `combat.js` / `selectors.js` | — |
| **冶炼 rig 接入** | `selectors.js` 冶炼由 `getSmeltingDisplayState` 计算，独立于生产效率 | — |
| **装配 Action 无 rig 专用销毁** | `actions.js` | `setFittingSlot` 卸载→归还 inventory（与 rig 销毁冲突） |
| **无 stackGroup 校验** | `actions.js` | `canFitEquipmentOnShip` 无同名/同组判断 |
| **重置 Action 归还 rig** | `actions.js` | `resetFitting` 将 rig 实例退 inventory（需销毁） |

---

## 二、9 系列 × 5 档 = 45 个物品

### 2.1 stackGroup 定义

每个系列拥有唯一 `stackGroup`，用于安装时的同组禁止判断：

| 系列 | stackGroup | 类别 |
|:---|:---|:---|
| 护盾容量 | `rig_shield_capacity` | 战斗 |
| 装甲容量 | `rig_armor_capacity` | 战斗 |
| 结构容量 | `rig_structure_capacity` | 战斗 |
| 采矿速度 | `rig_mining_speed` | 工业 |
| 采气速度 | `rig_gas_speed` | 工业 |
| 冶炼速度 | `rig_smelting_speed` | 工业 |
| 扫描强度 | `rig_archaeology_scan` | 考古 |
| 考古燃料效率 | `rig_archaeology_fuel` | 考古 |
| 考古干扰缩短 | `rig_archaeology_interference` | 考古 |

### 2.2 itemId 命名规则

```
{stackGroup}_{level_suffix}
```

level_suffix：`i` / `ii` / `iii` / `iv` / `v`

示例：`rig_shield_capacity_i`、`rig_shield_capacity_ii`、…、`rig_shield_capacity_v`

### 2.3 中文名称规则

```
{效果名}改装件 {罗马数字}
```

示例：护盾容量改装件 I、装甲容量改装件 III、扫描强度改装件 V

### 2.4 完整装备定义框架

```js
"rig_shield_capacity_i": {
  id: "rig_shield_capacity_i", name: "护盾容量改装件 I",
  slot: "rig", level: 1, time: 20, xp: 14,
  stackGroup: "rig_shield_capacity",
  cost: { "三钛合金": 100, "类银超金属": 40 },
  bonuses: { shieldCapacity: 0.04 }
}
```

每个物品包含字段：`id`, `name`, `slot: "rig"`, `level`, `time`, `xp`, `stackGroup`, `cost`, `bonuses`。

---

## 三、五档效果曲线

### 3.1 效果设计原则

1. **战斗三种容量**：同档同百分比，避免人为制造差异。
2. **采矿/采气/冶炼**：同档同速度增幅。
3. **扫描强度**：采用百分比乘区（`archaeologyScanPercent` 新字段），基础扫描强度 × (1 + rigBonus)。
4. **燃料效率**：百分比减少，**最低消耗 1 燃料/行动**。**取整策略已由策划裁决更新**（见 3.6「燃料裁决」）：不再使用 `Math.ceil` 强制取整，改为**确定性燃料节省累计器** `fuelSavingRemainder`，把每次行动被取整丢弃的小数节省累加起来，攒满 1 点就少扣 1 燃料。这样即使 I/II 档（8%/12%）也能长期产生真实节省，同时也修复了低档考古船自身 `fuelEfficiency` 被整数取整吃掉的问题。
5. **干扰缩短**：百分比减少，**最短 2 秒**。规则：`Max(2, max(3, site.time × 0.25) × (1 - reduction))`。
6. **不加成 fleetMiningSpeed / 冶炼支援**。
7. **不叠加舰船强化、装备强化**（见 3.5）。

### 3.2 推荐数值

| 系列 | I (Lv.1) | II (Lv.15) | III (Lv.35) | IV (Lv.55) | V (Lv.80) |
|:---|:---|:---|:---|:---|:---|
| 护盾/装甲/结构容量 | +4% | +6% | +8% | +11% | +15% |
| 采矿/采气/冶炼速度 | +4% | +6% | +8% | +11% | +15% |
| 扫描强度 | +5% | +8% | +12% | +17% | +25% |
| 燃料效率 | -8% | -12% | -16% | -20% | -25% |
| 干扰缩短 | -10% | -15% | -20% | -25% | -30% |

#### 数值推导过程

**容量类**（来源：`selectors.js:722-728` `getActiveCombatShipState`，HP 由 `config.hp` 读取）：

- 护卫舰（裂谷级）总 HP = 400。+4% = +16 HP。对战斗影响温和，不导致低级舰船突然变硬。
- 旗舰（星冕级）总 HP = 8200。+15% = +1230 HP。可控：旗舰 ship 强化 +10 已提供 +15% HP，两者相加为 +30%，仍是线性叠加。
- 低速增长曲线（4→6→8→11→15）在 V 档拉开差距，与 V 档 80 级装备工程门槛匹配。

**工业类**（来源：`selectors.js:239` `getProductionEfficiencyState` 公式）：

- rig 加成独立于乘法链之外：`total = skillEff × (1 + primary) × ... + rigBonus`（rigBonus 为纯加法项）
- 采矿 T1 护卫 Lv.1：基础效率 1.02。+4% rig → 1.02 + 0.04 = 1.06，提升 3.9%，温和。
- 采矿 T5 战列 Lv.80：基础效率 ≈ 1 + 80×0.02 = 2.60。+15% rig → 2.60 + 0.15 = 2.75，提升 5.8%，可控。

**扫描强度类**（来源：`archaeology.js:42-53` `computeArchaeologyScanStrength`）：

- 当前 scanStrength = `skill.lvl + shipScan × shipMul + fitted.scan + probeBonus`
- rig 新增项：`+ rigScanPercent × (skill.lvl + shipScan × shipMul)`
- 即 rig 按百分比放大"技能 + 舰船基础"之和，不放大 probeBonus（低档位探针不因此贬值）。

**Tier I 苍鹭 +0 + 基础探针**：scanStrength_base = 1 + 10×1.0 + 0 + 0 = 11。+5% rig → 11 + 0.05×11 ≈ 11.55 → ceil 12。实际成功率 = clamp(0.05, 0.95, 0.50 + (12-21)×0.01) = 0.41 → **41%**（原 40%）。

V 档 25%：启明 Lv.80 +0 + 基础探针：scanStrength_base = 80 + 120×1.0 + 0 + 0 = 200。+25% rig → 200 + 0.25×200 = 250。成功率 = 0.50 + (250-300)×0.01 = 0.00 → clamp(0.05) = 5%（同级 300 难度仍很低）。**启示：V 档单纯扫描 rig 不足以弥补探针差距，需要搭配 deep_probe_iii（+20）才能达到有意义的水平。** 这在设计上是对的——V 档本就需要 V 档探针。

**燃料效率类**（采用累计器后的长期平均，见 3.6）：

- I 档 -8%：site_i_a fuel=2，rawFuelCost=2×0.92=1.84，savingPerCycle=0.16/次。累计 ≈6.25 次攒满 1 点，届时那一次少扣 1 燃料。**长期平均 ≈1.84 燃料/次**（原 ceil 方案为 2，永远无节省）。
- III 档 -16%：site_iii_a fuel=10，rawFuelCost=8.4，savingPerCycle=1.6/次。约每 5 次多省 3 点小数。**长期平均 ≈8.4 燃料/次**（原 ceil 方案为 9）。
- V 档 -25%：site_v_a fuel=35，rawFuelCost=26.25，savingPerCycle=8.75/次。**长期平均 ≈26.25 燃料/次**（原 ceil 方案为 27）。
- 结合考古船自身 `fuelEfficiency`（如启明 0.80）：rawFuelCost = baseFuel × shipFuelMultiplier × rigFuelMultiplier，两级乘数都进入同一累计器，低档船的 fuelEfficiency 不再被整数取整吃掉。

**干扰缩短**：

- I 档 -10%：site_i_a time=30 → Max(2, max(3, 7.5)×0.9) = Max(2, 6.75) = **6.75s**（原 7.5s）。
- V 档 -30%：site_v_a time=300 → Max(2, max(3, 75)×0.7) = Max(2, 52.5) = **52.5s**（原 75s）。

### 3.3 实际效果表：单件 + 多系列组合

**苍鹭级 +0：1 rig 槽**

| 配置 | 效果值 | 说明 |
|:---|:---|:---|
| 护盾容量 I | +4% | 460→478.4 总 HP |
| 采矿速度 I | +4% | 效率 1.02→1.06 |
| 扫描强度 I (+5%) | scanStr 11→12 | 成功率 40%→41% |
| 燃料效率 I (-8%) | fuel 2→长期均 1.84 | 累计器每 ~6.25 次省 1 点 |

**星图级 +0（考古，2 rig 槽）**

| 配置 | 效果值 |
|:---|:---|
| 扫描 III + 燃料 III | scanStr (35+50=85)→85×1.12=95；fuel 10→ceil(10×0.84)=9 |
| 成功率（T3 121 难度）：0.50 + (95-121)×0.01 = 24%→**24%（原 14%）** |

**启明级 +10（考古旗舰，4 rig 槽）**

| 配置 | 效果值 |
|:---|:---|
| 扫描 V + 燃料 V + 干扰 V + 结构 V | scanStr (80+120×1.15=218)→218×1.25=272；fuel 35→27；干扰 75s→52.5s；结构 +15% |
| 成功率（T5 300 难度，deep_probe_iii +20）：scanStr = 80+120×1.15+20=238 → 238×1.25=297 → clamp(0.05, 0.95, 0.50+(297-300)×0.01)=0.47 → **47%** |

### 3.4 舰船强化 × 改装件交互

rig 加成独立于舰船强化乘法链，不会因 +5/+10 被放大。

**+0、+5、+10 对比**（采矿 T1 护卫，采矿速度 I rig +4%）：

| 强化 | 基础效率 | 加 rig | 提升百分比 | rig 相对收益 |
|:---|:---|:---|:---|:---|
| +0 | skillEff(1.02) = 1.02 | 1.02+0.04 = 1.06 | +3.9% | 固定 +0.04 |
| +5 | 1.02 × 1.075 = 1.097 | 1.097+0.04 = 1.137 | +3.6% | 固定 +0.04 |
| +10 | 1.02 × 1.15 = 1.173 | 1.173+0.04 = 1.213 | +3.4% | 固定 +0.04 |

rig 的 0.04 绝对值不变，相对收益随基础提高而微小下降。这是期望行为——改装件在任何强化阶段都有意义。

### 3.5 旗舰四槽极端组合

启明级 4 槽，装：结构 V(+15%) + 燃料 V(-25%) + 干扰 V(-30%) + 扫描 V(+25%)：

| 效果 | 值 |
|:---|:---|
| 结构 +15% | 800→920（共 4,300→4,420 HP） |
| 燃料 -25% | 35→27 |
| 干扰 -30% | 75s→52.5s |
| 扫描 +25% | +0 deep_probe_iii: scan=80+120+20=220→275；成功率 V 档 300 难度 47% |

所有数值均在可控范围内，无溢出或归零风险。

### 3.6 燃料裁决（策划正式裁决 · 确定性燃料节省累计器）

**背景**：前置燃料闸门检查发现 I/II 档（8%/12%）在 `Math.ceil` 取整下永远无实际节省（I: 2→2，II: 5→5）。

**裁决**（不改数值、不改机制强度）：

1. 五档燃料减免维持 **8% / 12% / 16% / 20% / 25%** 不变。
2. **废弃 `Math.ceil(rawFuelCost)` 作为最终结算**，改用确定性 `fuelSavingRemainder` 累计器：
   - 每次行动实际燃料 = 基础燃料 − 累计器攒满后可整除的节省点数。
   - 被小数丢弃的节省不再蒸发，而是累加进 `fuelSavingRemainder`，攒满 1 点即在下一次少扣 1 燃料。
3. 该方案**同时修复**低档考古船自身 `fuelEfficiency`（如启明 0.80、远窥 0.85）被整数取整吃掉、长期无收益的问题——船体乘数与 rig 乘数进入同一累计器。
4. **无随机、无 save-scumming**：成功/失败扣同样的燃料；只有在行动成功提交时才把「燃料扣减 + nextRemainder」一起原子写回。

**唯一计算层**：`getArchaeologyFuelCostState(state, site, shipRef)`（见 `js/systems/archaeology.js`），返回：

```
baseFuel              // site.fuel（整数基础燃料）
shipFuelMultiplier    // 船体 fuelEfficiency（无则 1）
rigFuelMultiplier     // getRigModifiers → 1 - fuelReduction（无则 1）
rawFuelCost           // Max(1, baseFuel × shipFuelMultiplier × rigFuelMultiplier)
savingPerCycle        // Max(0, baseFuel − rawFuelCost)
previousRemainder     // 归一化到 [0,1) 的上一次余量
savedWholeFuel        // Floor(previousRemainder + savingPerCycle + 1e-9)，上限 baseFuel − 1
chargedFuel           // Max(1, baseFuel − savedWholeFuel)
nextRemainder         // (previousRemainder + savingPerCycle − savedWholeFuel) 归一化 [0,1)
averageFuelPerCycle   // baseFuel × shipFuelMultiplier × rigFuelMultiplier（长期均值，展示用）
```

**约束**：
- `chargedFuel` 恒 ≥ 1（最低消耗 1 燃料/行动）。
- `savedWholeFuel` 上限 `baseFuel − 1`（一次行动至少扣 1 燃料）。
- `nextRemainder` 恒在 `[0,1)`，且必须有限（NaN/Infinity 归一化为 0）。
- 准入检查（能否负担）只在行动开始时做，不提前扣减 remainder。
- 在线 tick 与离线结算共用同一函数，结果必须一致。

---

## 四、经济测算

### 4.1 掉落路径确认

读取 `js/systems/archaeology.js:158-216` 真实执行顺序：

```
1. 消耗探针 ×1、燃料 × site.fuel  ← 先消耗
2. 计算成功率，判定成功/失败     ← 消耗后才判定
3. 若成功 → 调用 resolveArchaeologyDrops
   a. 普通 ISK 文物（必得 1 件，60/30/10 权重）
   b. 额外 ISK（译码器，概率）
   c. 独特文物（tier.uniqueRate）
   d. 校准材料（tier.calibrationRate） ← 仅成功时掉落，1 件
   e. LP 文物（tier.lpBase × site.lpMultiplier）
4. 若失败 → 无反噬/无产物，但探针和燃料已消耗
```

**关键结论**：
- ✅ 校准材料**只在成功时**掉落（第 4 步 `if (rng() < tier.calibrationRate)` 在成功分支内）
- ✅ 每次成功掉落**恰好 1 件**校准材料（`ResourceRegistry.add(state, "calibration:" + calibArtifact.id, 1)`）
- ✅ 不同档位使用不同校准材料（`calibArtifact.id` 如 `art_i_calib`、`art_ii_calib`）
- ❌ 失败时**完全无**校准材料掉落
- ✅ `ARCHAEOLOGY_ARTIFACTS` 中每档存在 `calibration` 类物品：`art_i_calib`~`art_v_calib`

### 4.2 公式

```
实际行动期望 = 材料需求 ÷ (成功率 × 校准率 × 1)
```

其中**成功率 = 50%**（同级 +0 参考配置），校准率 = `tier.calibrationRate`。

**例：I 档**：1 ÷ (0.50 × 0.020 × 1) = 1 ÷ 0.01 = **100 次实际行动**

### 4.3 五档经济表

| 档位 | 校准率 | 成功率 | 期望**实际**次数/个 | 期望**成功**次数/个 | 探针/个 | 燃料/个 | 基础耗时/个 |
|:---|:---|:---|:---|:---|:---|:---|:---|
| I | 2.0% | 50% | **100** | 50 | 100 | 200 | 50min |
| II | 1.5% | 50% | **133** | 67 | 133 | 665 | 133min |
| III | 1.0% | 50% | **200** | 100 | 200 | 2,000 | 400min (6.7h) |
| IV | 0.75% | 50% | **267** | 134 | 267 | 5,340 | 801min (13.4h) |
| V | 0.50% | 50% | **400** | 200 | 400 | 14,000 | 2,000min (33.3h) |

**核算说明**：
- probe/cost/fuel 采用 `economyCostISK` 值：I=250 ISK, II=1500 ISK, III=4500 ISK, IV=12000 ISK, V=7800 ISK
- 探针成本：100×250 = 25,000 ISK（I），133×1500 = 199,500 ISK（II），200×4500 = 900,000 ISK（III）
- 燃料成本按 `economyCostISK` 的燃料比价（但在现有系统中燃料是独立资源 pool）

### 4.4 五艘考古船装满 rig 槽总成本

| 舰船 | 档位 | rig 槽 | 改装件数量 | 期望总行动次数 | 期望探针 | 期望燃料 | 期望总耗时 |
|:---|:---|:---|:---|:---|:---|:---|:---|
| 苍鹭级 | I | 1 | 1 件 | **100** | 100 | 200 | 50min |
| 追迹级 | II | 1 | 1 件 | **133** | 133 | 665 | 2.2h |
| 星图级 | III | 2 | 2 件 | **400** | 400 | 4,000 | 13.3h |
| 远镜级 | IV | 3 | 3 件 | **801** | 801 | 16,020 | 40h |
| 启明级 | V | 4 | 4 件 | **1,600** | 1,600 | 56,000 | 133h |

**目标区间评估**：
- I 档 50 分钟毕业：合理，新手引导期的小目标
- III 档 13.3 小时：约为 3 个工作日离线挂机量，中等深度
- V 档 133 小时满 4 槽：约 2 周全勤，针对长期养成阶段的硬核内容
- 探针制造成本约 7800 ISK×40 组 = 312,000 ISK（V 档），在 V 档经济的合理比例内
- 校准材料不会积压——45 个物品各有 5 档需求，最顶层的 V 档需要大量才装满

**注意**：同级 +0 考古船、全装同类同档装备、普通探针时的成功率恰好 50%。如果玩家使用高一级装备或强化舰船，所需次数将降低，但本方案以 50% 基准计算保证下限清晰。

---

## 五、制造配方矩阵

### 5.1 单件配方

| 档位 | 装备工程 | 校准材料 | 精炼矿物 | 时间 | 经验 |
|:---|:---|:---|:---|:---|:---|
| I | Lv.1 | 1 × 校准基体 I 型 | 三钛 ×100, 类银 ×40 | 20s | 14 |
| II | Lv.15 | 1 × 校准基体 II 型 | 三钛 ×400, 类晶胶 ×60 | 40s | 35 |
| III | Lv.35 | 2 × 校准基体 III 型 | 三钛 ×800, 同位聚合 ×150 | 70s | 60 |
| IV | Lv.55 | 2 × 校准基体 IV 型 | 三钛 ×1500, 超新星诺克 ×40, 铷 ×3 | 120s | 110 |
| V | Lv.80 | 3 × 校准基体 V 型 | 三钛 ×2500, 超噬 ×10, 铷 ×8 | 200s | 180 |

### 5.2 材料来源验证

| 材料 | 来源 | 是否可自洽 |
|:---|:---|:---|
| 校准基体 I 型~V 型 | `ARCHAEOLOGY_ARTIFACTS`: `art_i_calib` ~ `art_v_calib`，category `"calibration"` | ✅ `ResourceRegistry` 通过 `"calibration:"` namespace 注册 |
| 三钛合金、类银超金属、类晶体胶矿 | 基础精炼矿物，`SMELTING_RECIPES` | ✅ Lv.1 即可获得 |
| 同位聚合体 | 精炼矿物 | ✅ Lv.20+ 可获得 |
| 超新星诺克石 | 精炼矿物 | ✅ Lv.35+ 可获得 |
| 铷 | 月矿 | ✅ 需要 Lv.55+ 月矿能力（同档合理） |
| 超噬矿 | 精炼矿物 | ✅ Lv.70+ |

### 5.3 配方矩阵完整性

**不进入清单的材料**：莫尔石、深层加密数据、死亡空间核心/协议、普通 ISK 文物（`common_isk`）、LP 文物、舰队支援材料。

**ResourceRegistry 兼容性**：`"calibration:" + itemId` 命名空间已在 `js/core/resources.js` 中通过循环注册自动处理。

---

## 六、安装与拆卸正式规则

### 6.1 规则文本

1. **安装即消耗**：改装件从 `equipment.inventory` 消耗，创建 `EquipmentInstance`，`fitted.rig[slotIndex] = instanceId`。
2. **拆卸即销毁**：`detachEquipmentRefFromFitting` 不归还 inventory，instance 标记为 destroyed/删除。
3. **替换=旧件销毁+新件安装**：替换时先销毁旧件，再安装新件。两步之间不做库存补齐。
4. **普通装备不受影响**：`high/mid/low` 槽的卸载仍按原逻辑归还 inventory。
5. **resetFitting 对 rig 销毁**：需要独立逻辑——rig 槽不归还 inventory，其他槽按原逻辑归还。
6. **舰船删除/存档规范化**：已安装 rig 不复制、不返还、不赠送。
7. **安装前全验证**：level、probe/fuel（考古不适用）、stackGroup 排重、slotIndex 边界、combat-locked。失败时原子不变。
8. **制造后进入 inventory**：装备工程完成后加入 `equipment.inventory`，安装时惰性转换成 Instance。
9. **无蓝图**：改装件不需要蓝图。
10. **无舰体尺寸限制**：`shipTypes: null` 即可，所有舰船都能装任何等级改装件。

### 6.2 stackGroup 防重复

在 `canFitEquipmentOnShip` 中新增：

```js
if (equipment.slot === "rig" && equipment.stackGroup) {
  const fitting = getFittingFromInstance(instance);
  for (const ref of fitting.rig) {
    const resolved = resolveEquipmentReference(state, ref);
    if (resolved && resolved.definition && resolved.definition.stackGroup === equipment.stackGroup) {
      return false; // 同组已安装
    }
  }
}
```

### 6.3 现有 Action 兼容性审计

| Action | 行 | 能否处理 rig 销毁？ | 需改？ |
|:---|:---|:---|:---|
| `setFittingSlot` | 645-681 | → `equipmentRef` = null 时调用 `detachEquipmentRefFromFitting`，该函数不归还 inventory。✅ rig 卸载=销毁正确 | 不需要 |
| `setFittingSlot` | 674 | 替换旧件：`if (previous) detachEquipmentRefFromFitting(state, previous)`→销毁。✅ 替换正确 | 不需要 |
| `resetFitting` | 684-699 | 遍历 `["high","mid","low","rig"]`，全部 `detachEquipmentRefFromFitting`。**但是 line 696-698 无条件 detach，对 rig 是正确的（销毁），对 high/mid/low 也是正确的（detach 不归还）。但后续 line701 之后还有 back-to-inventory 逻辑。** 需检查完整。 | **需审查** |

**`resetFitting` 完整审查**（`actions.js:684-700`）：

```js
resetFitting(state, instanceId) {
  // ...
  const fitting = instance.fitted || { high:[], mid:[], low:[], rig:[] };
  for (const slot of ["high", "mid", "low", "rig"]) {
    if (!Array.isArray(fitting[slot])) continue;
    for (let i = 0; i < fitting[slot].length; i++) {
      const ref = fitting[slot][i];
      if (ref) detachEquipmentRefFromFitting(state, ref);
      fitting[slot][i] = null;
    }
  }
  instance.fitted = { high:[], mid:[], low:[], rig:[] };
  state._dirty = true;
  return { changed:true };
}
```

`detachEquipmentRefFromFitting` 的行为：清除 `installedOn` 字段但不添加回 inventory。所以 resetFitting 实际上**对所有槽位都执行了"销毁"**（不归还）。但现有的普通装备装卸路径（setFittingSlot 中单独卸一件）是通过另一个路径归还的。

**结论**：`resetFitting` 对所有槽位（含 rig）的行为一致，调用 `detachEquipmentRefFromFitting` 不归还。这**对 rig 是正确的**。但注意——现有的 `setFittingSlot` 单件卸载 `equipmentRef = null` 也是通过 `detachEquipmentRefFromFitting` 销毁。**所以 rig 卸载=销毁的路径已经存在**，不需要独立 Action。

需要增加的独立 Action 是 **destroyFittedRig**（一键销毁某槽 rig），用于 UI 的直接"卸载→销毁"按钮。不需要新建 full Action——`setFittingSlot(state, instanceId, "rig", slotIndex, null)` 已经实现了销毁。

### 6.4 存档迁移

`normalizeFitting` 已在 `state.js:147-151` 处理 rig：

```js
function normalizeFitting(fitted) {
  const normalized = { high:[], mid:[], low:[], rig:[] };
  for (const slot of ["high", "mid", "low", "rig"]) {
    normalized[slot] = Array.isArray(fitted && fitted[slot]) ? fitted[slot].slice() : [];
  }
  return normalized;
}
```

旧存档 `fitted.rig` 缺失 → 自动规范化为 `[]`。**幂等安全**。

`normalizeEquipmentState`（`persistence.js`）处理实例引用修复时，涉及 `fitted.rig` 中的 instanceId 引用。需确认 normalizeRigReferences 不会复制或返还 rig 实例。

---

## 七、纯函数层设计

### 新建 `js/systems/rigs.js`

```js
// 获取装备定义
function getRigDefinition(rigItemId) {
  return EQUIPMENT_DB[rigItemId] || null;
}

// 获取指定舰桥上所有已安装改装件的定义
function getFittedRigDefinitions(state, instance) {
  const fitting = getFittingFromInstance(instance);
  return (fitting.rig || [])
    .map(ref => resolveEquipmentReference(state, ref))
    .filter(r => r && r.definition)
    .map(r => r.definition);
}

// 获取改装件效果聚合
function getRigModifiers(state, instance) {
  const mods = {};
  for (const def of getFittedRigDefinitions(state, instance)) {
    if (!def.bonuses) continue;
    for (const [key, value] of Object.entries(def.bonuses)) {
      mods[key] = (mods[key] || 0) + value;
    }
  }
  return mods;
}

// 安装合法性检查（含 stackGroup 排重）
function canFitRig(state, instance, rigItemId) {
  const def = getRigDefinition(rigItemId);
  if (!def || def.slot !== "rig") return { ok:false, reason:"not-rig" };
  const stackGroup = def.stackGroup;
  if (stackGroup) {
    for (const ref of (getFittingFromInstance(instance).rig || [])) {
      const r = resolveEquipmentReference(state, ref);
      if (r && r.definition && r.definition.stackGroup === stackGroup) return { ok:false, reason:"same-stack-group-exists" };
    }
  }
  return { ok:true };
}

// 改装件显示态
function getRigDisplayState(state, instance) {
  const defs = getFittedRigDefinitions(state, instance);
  return defs.map(d => ({
    id: d.id,
    name: d.name,
    stackGroup: d.stackGroup,
    level: d.level,
    bonuses: d.bonuses || {},
    levelLabel: d.name.match(/[IVXL]+$/)?.[0] || ""
  }));
}
```

### 7.2 各系统接入点

| 效果 key | 计算层 | 文件 | 插入方式 |
|:---|:---|:---|:---|
| `shieldCapacityPercent` | HP 初始化 | `selectors.js` / `combat.js` | 在 ship state 初始化时：`maxHp.shield = config.hp.shield × (1 + rigMods.shieldCapacityPercent)`。**用 *Percent 键，避免与 shield_ext_small 的平值 `shieldCapacity` 冲突** |
| `armorCapacityPercent` | 同上 | 同上 | 同上 |
| `structureCapacityPercent` | 同上 | 同上 | 同上 |
| `miningEfficiency` / `gasEfficiency` | 生产总效率 | `selectors.js:239` | `total += rigBonus`（rig bonus 为纯加法） |
| `smeltingSpeed` | 冶炼效率 | `selectors.js:260-310` `getSmeltingDisplayState` | 新增 `getRigModifiers` 读取并加到基础效率 |
| `archaeologyScanPercent` | 扫描强度 | `archaeology.js:42-53` | scanStrength += `rigMods * basePart`（basePart = skill.lvl + shipScan×shipMul） |
| `archaeologyFuelEfficiency` | 燃料消耗 | `archaeology.js:172-173` | 消耗前调用 `getArchaeologyFuelCostState(state, site, shipRef)` 得 `chargedFuel`；成功提交时把 `chargedFuel` 与 `nextRemainder` 一起原子写回（累计器，见 3.6） |
| `archaeologyInterferenceReduction` | 干扰时长 | `archaeology.js:102-104` | 干扰秒数：`Max(2, baseInterference × (1 - rigMods))` |

---

## 八、事件契约

| 事件 | required | numbers | 说明 |
|:---|:---|:---|:---|
| `rig:manufactured` | `rigId, quantity` | `quantity` | 装备工程制造完成 |
| `rig:fitted` | `rigId, shipInstanceId, stackGroup, slotIndex` | `slotIndex` | 安装到 rig 槽 |
| `rig:destroyed` | `rigId, shipInstanceId, stackGroup, slotIndex` | `slotIndex` | 拆卸销毁 |
| `rig:replaced` | `oldRigId, newRigId, shipInstanceId, stackGroup, slotIndex` | `slotIndex` | 替换旧改装件 |

**无反贼哨兵值**：每个事件都携带真实 `rigId`（批量时的流程在代码层拆分为逐件事件）。

---

## 九、专项审计计划（✅ 已落地：`tools/audit-rigs.mjs` 实际 **534 断言**全 PASS，EXIT=0）

> 补充（2026-07-23 UI 最终返修）：A~J 十区 + K 区（P3B UI 返修，含二级筛选/中文名/装配环/候选过滤/销毁语义/清空确认/NaN 守卫）。装配环容量改为**按舰动态** `24 + slots.rig`（启明级 28 / 超级旗舰 29），同时满足"支持数据库最大 rig 槽数"与"启明级 orbitSlots 总数 28、rig 索引 24~27"。新增 `tools/fixtures/rig-ui-test-save.json` 可复现夹具（真实 SaveManager 格式）。

新建 `tools/audit-rigs.mjs`，覆盖（实装时新增 J 区经济固化断言）：

| 分区 | 断言数预期 | 覆盖 |
|:---|:---|:---|
| A 数据完整性 | ~30 | 45 件定义完备、slot/level/xp/cost/bonuses/stackGroup 字段完整 |
| B 制造门槛 | ~25 | 五档 level 精确、材料真实、无蓝图、无禁用材料、材料不足原子拒 |
| C 装配/销毁/替换 | ~40 | 安装消耗 inventory、销毁不回退、stackGroup 排重、替换=销毁+新装 |
| D 普通装备不受影响 | ~15 | resetFitting 对 high/mid/low 行为不变、setFittingSlot 非 rig 保留实例（installedOn=null，可再装） |
| E 效果计算 | ~30 | 战斗 HP ×(1+rig)、采矿/采气 +rigFlat 加法、冶炼 +rigFlat、扫描 % 乘 base |
| F 防放大 | ~20 | 舰船强化不放大 rig、装备强化不放大 rig、fleetSupport 不放大 rig |
| G 存档迁移 | ~15 | fitted.rig 缺失→[]、连续二次幂等、实例引用唯一无复制 |
| H UI 显示态 | ~10 | getRigDisplayState 无 NaN/undefined、UI 可见 rig 槽 |
| I 回归 | ~15 | 现有 combat/mining/gas/archaeology 验证不变 |
| J 经济固化（实装新增） | — | calibrationRate/calibrationAmount/配方需求/期望次数/V 档四槽 120-150h 联动断言，防单侧修改 |

> 实装备注（2026-07-22）：D 区断言按真实实例语义书写——普通装备安装即升级为实例，卸载/resetFitting 后实例保留（`installedOn=null`）可再装配，不推回 inventory 字符串数组；rig 则实例彻底删除。审计脚手架 `freshState()` 必须清空初始舰（其 fitted 残留 `eq_1` 会与重置 `nextInstanceId=1` 后的新 ID 碰撞，触发 normalize 防复制清空）。

---

## 十、完整文件修改清单

### 新建文件（2 个）

| 文件 | 内容 |
|:---|:---|
| `js/systems/rigs.js` | 纯函数层：getRigDefinition、getFittedRigDefinitions、getRigModifiers、canFitRig、getRigDisplayState |
| `tools/audit-rigs.mjs` | 专项审计工具（含 9 分区） |

### 编辑文件（16 个）

| 文件 | 改动 |
|:---|:---|
| `js/data/equipment.js` | 新增 45 条 rig 装备定义到 `EQUIPMENT_DB` |
| `js/data/ammunition.js` | `EQUIPMENT_ENGINEERING_CATEGORIES` 新增 `{id:"rigs",name:"改装件"}`；45 条配方 |
| `js/core/actions.js` | `canFitEquipmentOnShip` 新增 stackGroup 排重 |
| `js/core/selectors.js` | 解除 `type !== "rig"` 硬禁用（1468 行）；`getProductionEfficiencyState` 新增 rigFlat；`getSmeltingDisplayState` 新增 rig 冶炼加成；`getShipFittingDisplayState` rig 槽 enabled |
| `js/systems/combat.js` | ship state init 时读 `getRigModifiers` 加成 maxHp |
| `js/systems/archaeology.js` | `getArchaeologyFittedBonuses` 新增 `"rig"` 槽遍历 scanPercent；燃料消耗公式；干扰公式 |
| `js/systems/rigs.js` | **新建** |
| `js/core/resources.js` | 确认 `calibration:` namespace 注册完整性（无需改，已全量） |
| `js/core/events.js` | 新增 `rig:manufactured`/`fitted`/`destroyed`/`replaced` 契约 |
| `js/core/persistence.js` | `normalizeEquipmentState` 确认 rig 实例安全性（无需改，如有需加防御） |
| `js/ui/manufacturing-render.js` | 用 `getEquipmentRecipeCategory` 自动归类 rig（无需改，slot:"rig"→category "rigs" 已兼容） |
| `js/ui/shell-render.js` | 装配页 rig 槽显示、销毁按钮绑定 |
| `css/panels.css` | rig 槽专用样式（可选） |
| `index.html` | 新增 `js/systems/rigs.js` 脚本引用 |
| `tools/verify.mjs` | Rig 专项断言块；`EQUIPMENT_ENGINEERING_CATEGORIES` 计数 8→9 |
| `tools/audit-rigs.mjs` | **新建** |

### 不修改文件

- `eveidle.md`（方案确认后再改）
- `DEVLOG.md`（同上）
- `js/render3d/**`（不受影响）
- `js/core/state.js`（`createEmptyFitting` 已有 rig；`normalizeFitting` 已幂等）
- `js/data/base.js`（无需新技能）
- `js/data/ships.js`（rig 槽已存在）

---

## 十一、回归命令（2026-07-23 真实 EXIT CODE，全 0）

| # | 命令 | 退出码 |
|:---:|:---|:---|
| 1 | `node tools/verify.mjs` | 0 |
| 2 | `node tools/audit-rigs.mjs` | 0（534/534） |
| 3 | `node tools/audit-archaeology-ships.mjs` | 0（339） |
| 4 | `node tools/audit-archaeology-system.mjs` | 0（148） |
| 5 | `node tools/simulate-archaeology-user-flow.mjs` | 0（54） |
| 6 | `node tools/audit-equipment-enhancement.mjs` | 0 |
| 7 | `node tools/audit-ship-enhancement.mjs` | 0 |
| 8 | `node tools/audit-industrial-productivity.mjs` | 0 |
| 9 | `node tools/calculate-ship-production-times.mjs --verify` | 0 |
| 10 | `node tools/calculate-ship-production-times.mjs --audit-mixed-battleship` | 0 |
| 11 | `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` | 0 |
| 12 | `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` | 0（须用系统 Node 24；托管 Node 22 在重型 0.0 模拟下偶发 V8 Segfault/EXIT=139，属环境而非代码回归） |

---

## 十二、待策划确认决策点

| # | 决策 | 推荐 |
|:---|:---|:---|
| 1 | 拆卸规则 | 销毁（不返还） |
| 2 | 重复安装 | stackGroup 排重，同组不同档也不能共存 |
| 3 | 适配限制 | 仅按制造等级 |
| 4 | 是否需蓝图 | 不需要 |
| 5 | 容量 I 档 | 4% |
| 6 | 扫描工作方式 | 百分比乘 basePart（技能+舰船） |
| 7 | 燃料最低 | 1 燃料/行动 |
| 8 | 干扰最短 | 2 秒 |
| 9 | rig 加成公式 | 独立于 multiplicative 链之外（纯加法或纯乘法入 base） |
| 10 | 冶炼 rig 是否一起 | 加入第一批（已完成 9 系列规划） |
| 11 | 货舱 rig 是否暂缓 | 暂缓，第二批 |
| 12 | 武器伤害 rig 是否暂缓 | 暂缓，第二批 |
| 13 | III 档材料 | 2×校准基体 |
| 14 | V 档材料 | 3×校准基体 |

---

## 十三、最终确认

- ✅ **未实装任何代码**——本版本仅为方案文档
- ✅ **未修改游戏数据文件**（js/data/*）
- ✅ **未修改 eveidle.md / DEVLOG.md**
- ✅ **未创建测试文件**
- ✅ **未触碰 js/render3d/**
- ✅ **未执行 git commit**
- ✅ 方案中的经济核算是基于 `js/data/archaeology.js` 真实掉落率 + `js/systems/archaeology.js` 真实执行顺序的专用推导
- ✅ 所有配方材料均来自已验证的真实资源渠道
- ✅ 极端叠加测算覆盖了启明级 4 槽极端组合
