# 全装备强化系统 — 实装方案（修订版 v2）

> 状态：只读设计 + 成本审计完成。本文档为**实装蓝图**，未执行任何游戏代码改动。
> v2 修订点：撤销 DED 封顶；失败规则改为“审计后确认”（已给出完整成本表）；数据结构改为**双池**（不再混合 string/instance）；用**真实字段**（`id`/`deathspaceVariant`/`sourceDeathspaceId`/`faction`）与**真实架构**（无 ES Module、全局函数、events.js `definitions`、`addSkillXpToState`、Action 传入 `randomValue`）。

---

## 0. 锁定的候选公式（保留，全部精算）

**成长乘区**
```
mult(L) = 1 + 0.005·L + 0.025·floor(L/5)
  +0=1.000  +5=1.050  +10=1.100  +15=1.150  +100=2.000
```

**成功率**（2026-07-23 更新：旧公式 `clamp(0.50 + 0.025·gap − 0.015·L , 0.10 , 0.95)` 已废止）
```
skillBonus    = 0.02·min(gap,10) + 0.005·min(max(gap−10,0),15) + 0.001·max(gap−25,0)
levelPenalty  = 0.015·min(L,5) + 0.03·min(max(L−5,0),5) + 0.05·min(max(L−10,0),5) + 0.08·max(L−15,0)
p(L)          = clamp( 0.50 + skillBonus − levelPenalty , 0.05 , 0.80 )
  gap = max(0, equipmentEngineering − equipment.level)
  L   = 当前强化等级
```
- 技能加成最高 +30%（gap ≥ 79 即封顶）
- 强化惩罚递增：+0~+5 每级 −1.5%, +5~+10 −3%, +10~+15 −5%, +15+ −8%
- 成功率上限 80%、下限 5%
- 无限强化仍保留；普通高级装备、势力装备和死亡空间装备的制造价值因此得到保护

**矿物消耗乘子（仅精炼矿物子集）**
```
costMultiplier(targetLevel) = 0.5 + 0.10·targetLevel + 0.5·floor(targetLevel/5)
  target=1→0.6  2→0.7  3→0.8  4→0.9  5→1.5  6→1.1 … 10→2.5 … 15→3.5
```
精炼矿物集合（来自 `SMELTING_RECIPES.outputMineral`，共 7 种，绝不含莫尔石/月矿/气体/行星产物/数据/核心/协议）：
`三钛合金 / 类银超金属 / 类晶体胶矿 / 同位聚合体 / 超新星诺克石 / 基腹断岩 / 超噬矿`

---

## 1. 修正后的数据结构和迁移伪代码

### 1.1 双池数据模型
```js
state.equipment = {
  inventory: [],          // string[]  仅保存 未实例化 + 未安装 + 强化等级0 的装备(itemId)
  instances: [],          // EquipmentInstance[]  已安装或已强化的实例
  nextInstanceId: 1
};
// EquipmentInstance
{ instanceId:string, itemId:string, enhancementLevel:number, installedOn:string|null }
```
**不再**把 string 与 instance 混放在同一个数组里（原混合数组方案废弃）。

### 1.2 关键不变量
- 普通/工业/旗舰普通制造完成：`state.equipment.inventory.push(itemId)`（保持 string，不实例化）。
- 安装：`inventory` 删一个 itemId → `instances` 生成实例 → `fitted[slot]` 存 `instanceId`。
- 卸下：`instance.installedOn=null`，实例保留在 `instances`。
- 强化库存中的 +0 装备：从 `inventory` 删一个 itemId → 生成仓库实例 → 再强化。
- 已安装装备不可强化，必须先把 `installedOn` 置 null（卸下）。
- `fitted` 迁移：每个旧 itemId → 独立实例；**不再向 inventory 回填该装备**。
- `ResourceRegistry` 现有 `equipment:itemId` 查询：读 `inventory` 数量 **并额外统计** `instances`。
- 需要未强化材料装备的制造配方（如 DED 制造吃基础 T1）：只消费 `inventory` 里的 string，**不得消费 instances**。
- `instanceId` 用 `state.equipment.nextInstanceId++` 生成并做碰撞检查，**不使用 Date.now / 随机数**。

### 1.3 迁移（幂等守卫 + 每次读档规范化）
```js
// 每次读档都会执行：修复任何损坏实例，不依赖一次性守卫掩盖问题
function normalizeEquipmentState(state) {
  const eq = state.equipment || (state.equipment = {});
  if (!Array.isArray(eq.inventory)) eq.inventory = [];
  if (!Array.isArray(eq.instances)) eq.instances = [];
  if (typeof eq.nextInstanceId !== "number") eq.nextInstanceId = 1;
  // 清洗 instances：仅保留结构合法的对象，补齐字段，重排 instanceId 防碰撞
  const seen = new Set();
  eq.instances = eq.instances.filter(o => o && typeof o.itemId === "string" && EQUIPMENT_DB[o.itemId])
    .map(o => {
      let id = o.instanceId;
      while (!id || seen.has(id)) id = "eq_" + (eq.nextInstanceId++);
      seen.add(id);
      return { instanceId:id, itemId:o.itemId,
               enhancementLevel: Math.max(0, o.enhancementLevel|0),
               installedOn: (o.installedOn && shipExists(state,o.installedOn)) ? o.installedOn : null };
    });
  // inventory 只允许 string
  eq.inventory = eq.inventory.filter(x => typeof x === "string");
  // fitted 槽位：旧 string → 解析为 instanceId；非法引用 → 丢弃
  for (const ship of allShips(state)) for (const slot of ["high","mid","low","rig"]) {
    const arr = ship.fitted?.[slot]; if (!Array.isArray(arr)) continue;
    ship.fitted[slot] = arr.map(ref => {
      const inst = eq.instances.find(i => i.instanceId === ref);
      if (inst) return inst.instanceId;                 // 已是实例
      if (EQUIPMENT_DB[ref]) {                           // 旧 string itemId
        const ni = createInstance(eq, ref); ni.installedOn = ship.instanceId;
        return ni.instanceId;
      }
      return null;
    }).filter(Boolean);
  }
}

// 一次性迁移（兼容极旧存档：fitted 里可能有未实例化的 itemId）
function migrateEquipmentInstancesV1(state) {
  if (state.migrations?.equipmentInstancesV1) return;
  normalizeEquipmentState(state);   // 实际转换工作由规范化完成
  state.migrations.equipmentInstancesV1 = true;
}
```
**正确性保证**：
- 幂等：`migrations.equipmentInstancesV1` 置位后直接 return；但 `normalizeEquipmentState` 每次读档都跑，能修复损坏实例（缺失字段 / 悬空 installedOn / instanceId 碰撞），不靠守卫掩盖问题。
- 同 itemId 装多件 → 循环内每次 `createInstance` 生成独立实例（多实例正确）。
- 离线制造完成仍 `push` string（双池：保持堆叠），实例在安装/强化瞬间惰性生成 → 存档体积受控。

---

## 2. 全部真实字段与真实文件路径

### 2.1 装备分类（真实字段，先死空后势力）
```js
function getEquipmentEnhancementCategory(eq) {
  if (eq.sourceDeathspaceId && eq.deathspaceVariant === "supervisor") return "ded_supervisor";
  if (eq.sourceDeathspaceId && eq.deathspaceVariant === "standard")   return "ded_standard";
  if (eq.faction) return "faction";           // 势力 / 联盟（联盟 faction:"alliance"）
  return "normal";                             // T1 / 工业 / 旗舰普通
}
function getDeathspaceMaterials(eq) {
  const site = DEATHSPACE_DATABASE.find(s => s.id === eq.sourceDeathspaceId);
  return site ? { core:site.coreMaterial, protocol:site.protocolMaterial } : {};
}
```
> **不引用** `eq.site` / `eq.itemId` / `eq.alliance`（这些字段不存在）。装备 ID 字段是 `eq.id`，`EQUIPMENT_DB` 以 `id` 为键；分类用 `eq.faction` / `eq.sourceDeathspaceId` / `eq.deathspaceVariant`。
> DED 普通武器 ID 形如 `ded_<faction>_6_weapon`；监督者形如 `ded_<faction>_6_weapon_supervisor`（见 `js/data/equipment.js:89,103`）。其 `cost` 已内嵌核心/协议（普通 10 核心、监督者 5 核心+1 协议，见 `equipment.js:95,108,109`）。

### 2.2 真实文件路径与接口
| 文件 | 真实作用 | 本轮改法 |
|---|---|---|
| `js/data/equipment.js` | `EQUIPMENT_DB`（含 DED 动态生成）、`DEATHSPACE_EQUIPMENT_TIERS` | 只读引用，不改 |
| `js/data/combat.js` | `DEATHSPACE_DATABASE`（含 `coreMaterial`/`protocolMaterial`，行 157-296） | 只读引用，不改 |
| `js/systems/production.js` | `SMELTING_RECIPES`(行101)、`addSkillXpToState(state,skillKey,amount,eventMeta)`(行79) | 只读引用，不改 |
| `js/systems/manufacturing.js` | 装备完成 `inventory.push`(217)、`inputEquipment` 消耗(140-154)、`EQUIPMENT_DB[recipe.output.itemId]`(173,205) | 仅确保消耗走 `inventory` string，不改逻辑 |
| `js/core/events.js` | `definitions` 对象(行9) + `emit(type,payload,meta)`(行97) | **加一条** `equipment:enhancementAttempted` 定义 |
| `js/core/selectors.js` | `getInstalledCombatModulesFromState`(713)、`getEquipmentOwnedCountFromState`(406)、多个 `EQUIPMENT_DB[...]` 加成聚合(191/199/280/718/725/756/1075/1333/1334) | 接入 `resolveEquipmentReference` + 双池计数 |
| `js/core/actions.js` | `equipment/enhance`(新增)、安装/卸载、消耗同类装备(551/658) | 新增 Action + 按 instanceId 防复制 |
| `js/core/persistence.js` | `migrations` 守卫(88-95)、`migrateCombatEquipmentState`、fitted 迁移(192/195) | 加 `normalizeEquipmentState` + `migrateEquipmentInstancesV1` |
| `js/core/offline.js` | 制造完成 `emit("manufacturing:completed",{branch:"equipment",...})`(161) | 完成继续 `push` string（双池） |
| `js/core/state.js` | 初始化 `state.equipment` 形状 | 补 `instances:[]` / `nextInstanceId:1` |
| `js/systems/combat.js` | `getInstalledCombatModules`(14) → `EQUIPMENT_DB[module.id]`；武器/维修解析(447-564) | 经 `resolveEquipmentReference` 取 `multiplier` |
| `js/ui/manufacturing-render.js`(130)、`shell-render.js`、`combat-render.js` | 装备/装配 UI | 显示实例等级与强化预览 |
| `index.html` | 全局脚本按序加载（689-719），**无 ES Module** | 在 `js/systems/ship-enhancement.js`(703) 后插入新文件 |
| **新增** `js/systems/equipment-enhancement.js` | 全局纯函数层（无 `import/export`） | 新建，暴露全局函数 |

> **架构约束**：项目用 `index.html` 顺序加载全局脚本，禁止 `import/export`。新文件只暴露全局函数（如 `window.getEquipmentEnhancementSuccessChance = ...` 或直接函数声明）。新文件插入位置：在 `ship-enhancement.js`(703) 之后、`planetary.js`(704) 之前。`verify.mjs` 统计的 JS 脚本数将由 **31 → 32**。

---

## 3. 四种失败规则精确期望表（表3）【历史数据，基于已废止的旧成功率公式】

> ⚠ 下表使用已废止的旧公式 `clamp(0.50 + 0.025·gap − 0.015·L, 0.10, 0.95)` 计算，仅作为失败规则方案对比的历史记录。当前实装的成功率公式见 §0。

公式：`A清零` / `B降1级` / `C只损材料等级不变`；`D` = 普通用 B、势力·DED 用 C。
期望尝试次数 = 到达该等级所需总尝试（含失败重试）。

| 技能档 (eng−thr) | 等级 | A 清零 | B 降1 | C 只损材料 |
|---|---|---|---|---|
| 门槛 (0) | +5 | 83.63 | 38.94 | **10.66** |
| 门槛 (0) | +10 | 8938.08 | 423.87 | **23.35** |
| 门槛 (0) | +15 | 2693749.55 | 13461.94 | **39.05** |
| 门槛+10 | +5 | 15.42 | 10.06 | **6.95** |
| 门槛+10 | +10 | 161.79 | 25.98 | **14.71** |
| 门槛+10 | +15 | 2736.05 | 53.16 | **23.49** |
| 门槛+25 | +5 | 5.85 | 5.49 | **5.26** |
| 门槛+25 | +10 | 13.40 | 11.05 | **10.53** |
| 门槛+25 | +15 | 24.67 | 16.75 | **15.86** |
| 装备工程99 (≈+34) | +5 | 5.85 | 5.49 | **5.26** |
| 装备工程99 | +10 | 13.40 | 11.05 | **10.53** |
| 装备工程99 | +15 | 23.17 | 16.60 | **15.79** |

> 规则 A 在门槛档 +15 需 **269 万次**尝试，实质性不可达；规则 B +15 需 **1.3 万次**，极重；规则 C 全程可控（最高 39 次@门槛）。
>
> **注意**：以上数值基于已废止的旧成功率公式。当前实装边际递减公式后，门槛档 +15 的实际期望尝试次数约为 59.7 次（旧公式为 39 次），高技能档的差异更大。

---

## 4. 两种额外材料频率精确对比（表4）

**方案1**：每次尝试都消耗额外材料（同类装备 + 核心/协议）。
**方案2**：仅目标等级为 5 倍数（即当前等级 4/9/14）的尝试消耗额外材料。
- 普通装备：两方案都只耗矿物。
- 势力/联盟：里程碑额外耗 1 件同型号 +0 **inventory** 装备（不耗 instances/已安装/已强化；不实例化再删）。
- DED 普通：里程碑耗 1 件同型号 +0 装备 + 1 核心。
- DED 监督者：里程碑耗 1 件同型号 +0 装备 + 1 协议。
- **含制造被吃装备的成本**：DED 普通造 1 件耗 10 核心；DED 监督者造 1 件耗 5 核心 + 1 协议（来自 `equipment.js:95,108,109`）。

下表“总核心/总协议”已含：① 基础装备制造 ② 强化按钮收取 ③ 被吃同类装备的制造。
（DED 用规则 C 期望次数；普通用规则 B，但此处 DED 统一按 C 计。）

| 技能档 | 目标 | 标准·方案1 同类/总核心 | 标准·方案2 同类/总核心 | 监督者·方案1 同类/总核心/总协议 | 监督者·方案2 同类/总核心/总协议 |
|---|---|---|---|---|---|
| 门槛 | +5 | 10.66 / 127.3 | 2.27 / 35.0 | 10.66 / 58.3 / 22.3 | 2.27 / 16.4 / 5.5 |
| 门槛 | +10 | 23.35 / 266.9 | 5.01 / 65.1 | 23.35 / 121.8 / 47.7 | 5.01 / 30.1 / 11.0 |
| 门槛 | +15 | 39.05 / 439.5 | 8.46 / 103.1 | 39.05 / 200.2 / 79.1 | 8.46 / 47.3 / 17.9 |
| 门槛+10 | +5 | 6.95 / 86.5 | 1.45 / 25.9 | 6.95 / 39.8 / 14.9 | 1.45 / 12.2 / 3.9 |
| 门槛+10 | +10 | 14.71 / 171.8 | 3.08 / 43.8 | 14.71 / 78.6 / 30.4 | 3.08 / 20.4 / 7.2 |
| 门槛+10 | +15 | 23.49 / 268.4 | 4.93 / 64.2 | 23.49 / 122.5 / 48.0 | 4.93 / 29.6 / 10.9 |
| 门槛+25 | +5 | 5.26 / 67.9 | 1.05 / 21.6 | 5.26 / 31.3 / 11.5 | 1.05 / 10.3 / 3.1 |
| 门槛+25 | +10 | 10.53 / 125.8 | 2.11 / 33.2 | 10.53 / 57.6 / 22.1 | 2.11 / 15.5 / 5.2 |
| 门槛+25 | +15 | 15.86 / 184.4 | 3.20 / 45.2 | 15.86 / 84.3 / 32.7 | 3.20 / 21.0 / 7.4 |
| 工程99 | +5 | 5.26 / 67.9 | 1.05 / 21.6 | 5.26 / 31.3 / 11.5 | 1.05 / 10.3 / 3.1 |
| 工程99 | +10 | 10.53 / 125.8 | 2.11 / 33.2 | 10.53 / 57.6 / 22.1 | 2.11 / 15.5 / 5.2 |
| 工程99 | +15 | 15.79 / 183.7 | 3.16 / 44.7 | 15.79 / 83.9 / 32.6 | 3.16 / 20.8 / 7.3 |

> **结论**：方案2 在门槛档把 DED 同类装备消耗从 10.66→2.27（+5）、核心从 127→35，降幅约 3.6×。方案1 在门槛档 +15 需 39 件同类 + 440 核心，实质劝退。

---

## 5. 三失败 XP 方案对比（表6 前置）+ 八装备矿物成本（表5）

### 5.1 XP 漏洞审计（最便宜装备反复强化）
以 `t1_small_laser`（xp12，精炼基 57 单位）在门槛档规则 C 为例：
- 失败给 50% 基础 XP：到 +5 期望 XP≈118，矿物≈555 → **0.213 XP/单位**，与直接制造（12/57=**0.211**）基本持平 → 不构成刷分优势。
- 失败给 25%：到 +5≈101 XP/555=**0.182** → 低于制造。
- 失败给 0%：到 +5≈84 XP/555=**0.151** → 低于制造。
- 但**最便宜装备** `t1_mining_laser`（xp8，精炼基 30 单位，8/30=0.267 制造比）：失败 50% 时单首次尝试耗 0.6×30=18 单位拿 4~8 XP → 最高 **0.44 XP/单位 > 0.267**，存在轻度刷分。

**推荐（见第 10 节）**：失败 XP = **0%**（仅成功给 `baseXp·(1+0.2L)`），使强化 XP/矿物恒低于直接制造，杜绝最便宜装备刷装备工程经验。

### 5.2 八装备期望矿物（精炼子集，@门槛档；高技能按期望尝试同比例下降：+10档≈0.65×，+25/工程99≈0.40×）

格式：`+N[规则]: 矿物:数量 ...`

**小型激光炮I**（三钛45/类晶12）
```
+5[C]: 三钛438 类晶117   | +10[C]: 三钛1532 类晶409   | +15[C]: 三钛3594 类晶958
+5[B]: 三钛1900 类晶507  | +10[B]: 三钛38533 类晶10275 | +15[B]: 三钛1929243 类晶514465
+5[A]: 三钛4573 类晶1219 | +10[A]: 三钛907362 类晶241963| +15[A]: 三钛401504934 类晶107067982
```
**大型激光炮I**（三钛300/同位50/超新星15）
```
+5[C]: 三钛2920 同位487 超新星146   | +10[C]: 三钛10215 同位1702 超新星511   | +15[C]: 三钛23960 同位3993 超新星1198
+5[B]: 三钛12669 同位2112 超新星633 | +10[B]: 三钛256886 同位42814 超新星12844| +15[B]: 三钛12861620 同位2143603 超新星643081
+5[A]: 三钛30487 同位5081 超新星1524| +10[A]: 三钛6049083 同位1008180 超新星302454 | +15[A]: 三钛2676699558 同位446116593 超新星133834978
```
**大型护盾回充器I**（三钛240/类银80/超新星10）
```
+5[C]: 三钛2336 类银779 超新星97   | +10[C]: 三钛8172 类银2724 超新星340   | +15[C]: 三钛19168 类银6389 超新星799
+5[B]: 三钛10135 类银3378 超新星422 | +10[B]: 三钛205509 类银68503 超新星8563| +15[B]: 三钛10289296 类银3429765 超新星428721
+5[A]: 三钛24390 类银8130 超新星1016| +10[A]: 三钛4839266 类银1613089 超新星201636 | +15[A]: 三钛2141359646 类银713786549 超新星89223319
```
**大型采矿激光器**（三钛500/超新星30）
```
+5[C]: 三钛4866 超新星292   | +10[C]: 三钛17025 超新星1021  | +15[C]: 三钛39933 超新星2396
+5[B]: 三钛21116 超新星1267 | +10[B]: 三钛428143 超新星25689| +15[B]: 三钛21436034 超新星1286162
+5[A]: 三钛50812 超新星3049 | +10[A]: 三钛10081804 超新星604908| +15[A]: 三钛4461165929 超新星267669956
```
**大型气云采集器**（三钛500；聚合气体/氢同位素非精炼，已剔除）
```
+5[C]: 三钛4866   | +10[C]: 三钛17025   | +15[C]: 三钛39933
+5[B]: 三钛21116  | +10[B]: 三钛428143  | +15[B]: 三钛21436034
+5[A]: 三钛50812  | +10[A]: 三钛10081804| +15[A]: 三钛4461165929
```
**DED 6/10 普通武器**（三钛750/同位125/超新星38；核心另计，不入矿物）
```
+5[C]: 三钛7299 同位1217 超新星370   | +10[C]: 三钛25537 同位4256 超新星1294   | +15[C]: 三钛59899 同位9983 超新星3035
+5[B]: 三钛31673 同位5279 超新星1605 | +10[B]: 三钛642215 同位107036 超新星32539| +15[B]: 三钛32154051 同位5359009 超新星1629139
+5[A]: 三钛76218 同位12703 超新星3862| +10[A]: 三钛15122706 同位2520451 超新星766217 | +15[A]: 三钛6691748894 同位1115291482 超新星339048611
```
**DED 6/10 监督者武器**（三钛563/同位94/超新星29；核心5+协议1另计）
```
+5[C]: 三钛5479 同位915 超新星282   | +10[C]: 三钛19170 同位3201 超新星987   | +15[C]: 三钛44964 同位7507 超新星2316
+5[B]: 三钛23776 同位3970 超新星1225| +10[B]: 三钛482089 同位80491 超新星24832| +15[B]: 三钛24136974 同位4029974 超新星1243290
+5[A]: 三钛57214 同位9553 超新星2947| +10[A]: 三钛11352112 同位1895379 超新星584745 | +15[A]: 三钛5023272836 同位838699195 超新星258747624
```
**旗舰级聚焦激光炮I**（三钛500/基腹断岩12/超噬矿8；铷/等离子体非精炼已剔除）
```
+5[C]: 三钛4866 基腹断岩117 超噬矿78   | +10[C]: 三钛17025 基腹断岩409 超噬矿272   | +15[C]: 三钛39933 基腹断岩958 超噬矿639
+5[B]: 三钛21116 基腹断岩507 超噬矿338 | +10[B]: 三钛428143 基腹断岩10275 超噬矿6850| +15[B]: 三钛21436034 基腹断岩514465 超噬矿342977
+5[A]: 三钛50812 基腹断岩1219 超噬矿813| +10[A]: 三钛10081804 基腹断岩241963 超噬矿161309 | +15[A]: 三钛4461165929 基腹断岩107067982 超噬矿71378655
```

> 注：矿物公式 `costMultiplier` 在 5/10/15 出现明显台阶（如 +5 单级乘子 1.5、+10 单级 2.5、+15 单级 3.5），符合“5倍数成本台阶”。规则 A/B 在门槛档成本爆炸（A+15 以亿计），常规玩家只会用规则 C。

---

## 6. 统一装备引用解析层 `resolveEquipmentReference`

`fitted` 此后存 `instanceId`，所有原 `EQUIPMENT_DB[equipmentId]` 的调用都受影响。统一接入点：

```js
function isEquipmentInstanceId(ref) {
  return typeof ref === "string" && state.equipment.instances.some(i => i.instanceId === ref);
}
function resolveEquipmentReference(state, ref) {
  const inst = isEquipmentInstanceId(ref)
    ? state.equipment.instances.find(i => i.instanceId === ref) : null;
  const itemId = inst ? inst.itemId : ref;          // 旧 string 直接当 itemId
  const def = EQUIPMENT_DB[itemId];
  if (!def) return null;
  const enhancementLevel = inst ? inst.enhancementLevel : 0;
  return {
    itemId, definition: def, instance: inst,
    enhancementLevel,
    multiplier: getEquipmentEnhancementEffectMultiplier(enhancementLevel)
  };
}
```

### 受影响位置审计（须改为经 `resolveEquipmentReference` 并套 `multiplier`）
| 类别 | 位置（文件:行） | 改法 |
|---|---|---|
| 战斗武器 | `combat.js:14`→`selectors:713` 取 `module.id`；伤害 `combat.js:~492` | `resolveEquipmentReference` 取 `itemId`+`multiplier`；`baseDamage×multiplier` |
| 战斗维修 | `combat.js:447,564` 取 `amount` | `amount×multiplier` |
| 最大生命/容量加成 | `selectors:191,199,718,725,756,1075` 读 `EQUIPMENT_DB[id].bonuses` | 解析实例，`shieldCapacity` 等 bonus×multiplier |
| 采矿效率 | `selectors:280`（fitted 检查）、`182-204` 聚合 `miningEfficiency` | 解析+乘区 |
| 采气效率 | 同上 `gasEfficiency` 聚合 | 解析+乘区 |
| 工业提升器 | `selectors` 聚合 `miningLaserEfficiency`/`gasLaserEfficiency` | 解析+乘区 |
| 船坞装配 UI | `manufacturing-render.js:130` 及 `shell-render.js` 装配展示 | 显示实例等级+预览 |
| 战斗装备栏 | `combat-render.js` 显示 fitted 模块 | 显示等级+乘区 |
| 仓库统计 | `selectors:1333,1334` `inventoryBySlot` | 解析 instances 显示等级 |
| 制造输入装备 | `manufacturing.js:140-154,173,205` `inputEquipment` | **不改**（recipe 驱动，只消费 `inventory` string） |
| 装卸 Actions | `actions.js` 安装/卸载(551)、消耗同类(658) | 按 instanceId 操作，双池 |
| 装备拥有数量 | `selectors:406 getEquipmentOwnedCountFromState`、`:191,199,673` | 双池计数（inventory+instances） |
| 蓝图/装备工程库存数量 | `selectors:626,633,656,1174,1179` | recipe 驱动，不需解析；计数同 406 |
| 存档迁移 | `persistence.js:192,195` + 新增 `normalizeEquipmentState` | 见 §1.3 |
| 离线制造 | `offline.js:161` | 完成继续 `inventory.push(string)`（双池） |

> 不修改 `EQUIPMENT_DB` 基础值；所有强化效果由 `multiplier` 纯计算层叠加到实例上。

---

## 7. 按真实架构的接口设计（无 ES Module）

`js/systems/equipment-enhancement.js`（全局函数，插入 `index.html:703` 之后）：
```js
// 纯函数（无副作用，可单测）
function getEquipmentEnhancementEffectMultiplier(level) { return 1 + 0.005*level + 0.025*Math.floor(level/5); }

// 成功率边际递减（2026-07-23 实装；旧 clamp(0.025*gap − 0.015*L) 已废止）
function getEquipmentEnhancementSuccessBreakdown(equipmentEngineeringLevel, equipmentLevel, currentLevel) {
  const gap = Math.max(0, equipmentEngineeringLevel - equipmentLevel);
  const L = Math.max(0, Math.floor(Number(currentLevel) || 0));
  const skillBonus = Math.min(
    0.02*Math.min(gap,10) + 0.005*Math.min(Math.max(gap-10,0),15) + 0.001*Math.max(gap-25,0),
    0.30);
  const levelPenalty =
    0.015*Math.min(L,5) + 0.03*Math.min(Math.max(L-5,0),5) +
    0.05*Math.min(Math.max(L-10,0),5) + 0.08*Math.max(L-15,0);
  const raw = 0.50 + skillBonus - levelPenalty;
  return { base:0.50, skillBonus, levelPenalty, final:Math.max(0.05, Math.min(0.80, raw)) };
}
function getEquipmentEnhancementSuccessChance(eng, thr, L) {
  return getEquipmentEnhancementSuccessBreakdown(eng, thr, L).final;
}
function getEquipmentEnhancementCost(eq, targetLevel) {
  const mult = 0.5 + 0.10*targetLevel + 0.5*Math.floor(targetLevel/5);
  const out = {};
  for (const [mat,qty] of Object.entries(eq.cost||{}))
    if (REFINED_MINERALS.has(mat)) out[mat] = Math.max(1, Math.ceil(qty*mult));
  return out;
}
function getEquipmentEnhancementExtraCost(eq, targetLevel, isMilestone) {
  const cat = getEquipmentEnhancementCategory(eq);
  if (!isMilestone) return {};                       // 方案2：非里程碑不收额外材料
  const out = { consumeInstanceItemId: eq.id };      // 消耗 inventory 中同型号 +0 装备
  if (cat === "ded_standard")  out.core = getDeathspaceMaterials(eq).core;
  if (cat === "ded_supervisor") out.protocol = getDeathspaceMaterials(eq).protocol;
  return out;
}
function getEquipmentEnhancementDisplayState(eq, level, eng) {
  const thr = eq.level;
  return {
    currentLevel:level, previewLevel:level+1,
    multiplier:getEquipmentEnhancementEffectMultiplier(level),
    previewMultiplier:getEquipmentEnhancementEffectMultiplier(level+1),
    success:getEquipmentEnhancementSuccessChance(eng, thr, level),
    cost:getEquipmentEnhancementCost(eq, level+1),
    extra:getEquipmentEnhancementExtraCost(eq, level+1, (level+1)%5===0),
    isMilestone:(level+1)%5===0
  };
}
```

**Action（改 `state`，必须接受 `randomValue` 以便固定测试）**
```js
case "equipment/enhance": {
  const { instanceId, randomValue = Math.random() } = action;
  const inst = state.equipment.instances.find(i => i.instanceId === instanceId);
  if (!inst) throw new Error("实例不存在");
  if (inst.installedOn) throw new Error("已安装装备不可强化");
  const eq = EQUIPMENT_DB[inst.itemId];
  const ds = getEquipmentEnhancementDisplayState(eq, inst.enhancementLevel, state.skills.equipmentEngineering);
  if (!ResourceRegistry.canAfford(state, ds.cost)) throw new Error("矿物不足");
  let consumedInstanceId = null;
  if (ds.extra.consumeInstanceItemId) {
    const donorIdx = state.equipment.inventory.indexOf(ds.extra.consumeInstanceItemId); // 只消费 inventory string
    if (donorIdx < 0) throw new Error("缺少同类未强化未安装装备");
    state.equipment.inventory.splice(donorIdx, 1);
    consumedInstanceId = ds.extra.consumeInstanceItemId;
  }
  if (ds.extra.core && !ResourceRegistry.canAfford(state, { [ds.extra.core]:1 })) throw new Error("核心不足");
  if (ds.extra.protocol && !ResourceRegistry.canAfford(state, { [ds.extra.protocol]:1 })) throw new Error("协议不足");
  ResourceRegistry.spend(state, ds.cost);
  if (ds.extra.core) ResourceRegistry.spend(state, { [ds.extra.core]:1 });
  if (ds.extra.protocol) ResourceRegistry.spend(state, { [ds.extra.protocol]:1 });
  const fromLevel = inst.enhancementLevel;
  const success = randomValue < ds.success;          // 失败规则 C：等级不变（推荐）
  if (success) inst.enhancementLevel += 1;
  const xp = success ? Math.round((eq.xp||0)*(1+0.2*fromLevel)) : 0;   // 失败 XP=0（推荐，见 §10）
  if (xp > 0) addSkillXpToState(state, "equipmentEngineering", xp, { source:"equipment-enhancement" });
  GameEvents.emit("equipment:enhancementAttempted", {
    instanceId, itemId:inst.itemId, fromLevel, toLevel:inst.enhancementLevel,
    success, chance:ds.success, consumedResources:ds.cost,
    consumedEquipmentInstanceId:consumedInstanceId, xp, offline:false,
    eventId: createEventId()
  });
  break;
}
```

**GameEvents 契约（`js/core/events.js` 的 `definitions` 内新增）**
```js
"equipment:enhancementAttempted": {
  required:["instanceId","itemId","fromLevel","toLevel","success","chance","consumedResources","consumedEquipmentInstanceId","xp","offline","eventId"],
  numbers:["fromLevel","toLevel","chance","xp"]
}
```
**幂等与存读档**：状态变更在 Action 内同步、确定性完成；事件仅为通知（Toast/统计），**不存在由事件重建状态** → 重复读档不重复触发。离线制造路径 `offline:true`。

---

## 8. 推荐的失败规则

基于 §3 成本审计：
- **规则 A（清零）**：门槛 +15 需 269 万次，实质不可达 → 否决。
- **规则 B（降1级）**：门槛 +15 需 1.3 万次、矿物以百万计 → 过重，仅适合作为“普通装备”的张力选项，但会显著抬高成本。
- **规则 C（只损材料、等级不变）**：全程可控（最高 39 次@门槛），强化成为纯材料 sink，且**不会反向成为死亡空间首次通关门槛**。

**推荐：规则 C 适用于全部类别**（普通/势力/联盟/DED/旗舰）。理由：经济 sink 已由“每次尝试的矿物 +（势力/DED）同类实例/核心/协议”提供，无需靠惩罚制造张力；且 DED 无等级硬上限（见 §0 撤销），规则 C 下高等级仍是长期目标而非门槛。若坚持要失败张力，可只对普通装备用规则 B、势力/DED 仍用 C，但会增加实现与测试复杂度。

---

## 9. 推荐的额外材料频率

**推荐：方案2（仅 5 倍数里程碑收取额外材料）**。
理由（§4）：门槛档 DED +5 同类装备 10.66→2.27、核心 127→35（≈3.6× 降幅）；+15 核心 440→103。方案1 在门槛档 +15 需 39 件同类 + 440 核心，实质劝退，违背“强化是长期目标而非首通门槛”。普通装备两方案都只耗矿物，无差异。

---

## 10. 推荐的失败 XP

**推荐：失败 XP = 0%**（仅成功给 `baseXp·(1+0.2L)`）。
理由（§5.1）：失败 50% 时最便宜装备 `t1_mining_laser` 的 XP/矿物≈0.44 > 制造 0.267，存在轻度刷分；失败 0% 时强化 XP/矿物恒低于直接制造，杜绝“用最便宜装备快速刷装备工程经验”替代正常制造升级。失败 25% 同样偏低但不如 0% 稳妥。

---

## 11. 最终预计修改文件与测试

**修改/新增文件**
1. `js/systems/equipment-enhancement.js`（新增，全局纯函数）
2. `js/core/state.js`（`equipment.instances`/`nextInstanceId` 初始化）
3. `js/core/persistence.js`（`normalizeEquipmentState` + `migrateEquipmentInstancesV1`）
4. `js/core/actions.js`（`equipment/enhance` + 安装/卸载按 instanceId）
5. `js/core/selectors.js`（`resolveEquipmentReference` 接入加成聚合 + 双池 `getEquipmentOwnedCountFromState`）
6. `js/systems/combat.js`（武器/维修套 `multiplier`）
7. `js/systems/manufacturing.js`（确认 `inputEquipment` 只消费 `inventory` string）
8. `js/core/events.js`（`definitions` 加 `equipment:enhancementAttempted`）
9. `js/ui/manufacturing-render.js` / `shell-render.js` / `combat-render.js`（实例等级/预览 UI）
10. `index.html`（插入新脚本于 `ship-enhancement.js` 之后）
11. `tools/audit-equipment-enhancement.mjs`（新增）
12. `tools/verify.mjs`（JS 计数 31→32 + 强化纯函数单测）

**审计/测试清单（覆盖 §L 全部）**
旧存档双池迁移幂等 · 每次读档规范化修复损坏 · 多舰装同型号多实例 · instanceId 全局唯一 · 制造完成推 string · 装卸不复制 · 材料不足拒绝 · 不能消耗已安装 · 不能消耗目标自身 · 成功升级 · 失败规则 C 等级不变 · 5 倍数加成台阶 · 无等级上限 · 战斗伤害接入 · 维修接入 · 采矿/采气效率接入 · 在线+离线制造 · 存档往返一致 · 双池 `getEquipmentOwnedCount` 兼容 · 普通不耗特殊材料 · DED 正确核心/协议 · 旗舰不耗莫尔石 · 弹药/燃料/部件不进强化列表 · 方案2 里程碑才收额外材料。

---

## 12. 仍需策划确认的数字（M 节）

1. **失败规则**：审计完成，推荐 **规则 C（全类别）**；若要有张力，普通可改 B、势力/DED 仍 C。
2. **额外材料频率**：推荐 **方案2（里程碑收取）**。
3. **失败 XP**：推荐 **0%**（仅成功给 XP）。
4. **矿物公式系数** `0.5+0.10L+0.5⌊L/5⌋`：是否采纳（当前给出门槛档期望，高技能 ×0.4~0.65）？
5. **势力数据间接消耗**：势力装备里程碑消耗 1 件同类 +0 装备（其制造耗势力数据），+15 约需 ~8 件（门槛档方案2），是否可接受？
6. **DED 无等级上限**：已撤销封顶，长期成本仅靠成功率+材料控制，确认无硬上限。
7. **设置开关**：建议强化结果提示**复用**舰船强化开关（降实现成本）。

---

_本文档为实装蓝图 v2（修订版）。已按第 11 节顺序落地实装，并通过 `tools/audit-equipment-enhancement.mjs` 重构集成审计；2026-07-22 验收返修修复 6 项已确认缺陷，二次返修修复 donor 双重扣除与现代存档导入重复赠装两项回归，并新增现代存档重复导入回归测试（见 `DEVLOG`）。_

## 13. 已知回归与修复记录（2026-07-22 二次返修）

- **donor 双重扣除**：`enhanceEquipment()` 原子扣减段曾有连续两段 `if (needDonor)` donor 扣除，每次里程碑强化消耗两件而非一件。已删除重复块，确保单次尝试只扣一件（inventory 初始 1/2/3 → 结束 0/1/2，势力/联盟/DED 标准/DED 监督者均成立）。
- **现代存档导入重复赠装**：`importData()` 原无条件 `delete combatEquipmentV1/equipmentInstancesV1`，导致现代存档被强制重跑 `migrateCombatEquipmentState` 并因 `EQUIPMENT_DB[id]` 对 `eq_*` 引用误判而重复赠送默认装备。已改为条件执行（幂等守卫），并对已安装装备判定改用 `resolveEquipmentReference` 兼容新旧引用；现代存档导入后装备总数/等级/fitted 完全不变，不新增默认装备。
