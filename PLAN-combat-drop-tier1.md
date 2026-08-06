# 战斗掉落反哺生产 · Tier1（运输舰）实现计划（草案）

> **状态：仅方案，未执行任何代码改动。** 等你明确说"开始改"再落地。
> 适用范围：活跃开发副本 `D:\EVE-IDLE\EVEIDLE-WORKBUDDY-FRESH`（分支 `agent/research-achievements`）。
> 相对上一版的关键变更：**T1a 通用残片已否决；T1b 重写为"星带随机刷运输舰"；现有战术残液掉落规则不改。**

---

## 0. 设计要点（本轮定稿）

- **T1a 通用残片：否决，移除。**
- **T1b 重写为运输舰**：星带波次按概率随机附刷一个 `kind:"transport"` 的**运输舰**敌人。
  - **无伤害**：`baseDamage = 0`（只挨打、不还手），玩家可零风险 Farm。
  - **血量**：取该星带 `normal` 小怪模板 HP × `TRANSPORT_HP_MULT`（≈1.2），"比同级别小怪略高"。
  - **掉落**：同级别（`zone.formationPool` 安全层）候选池里**随机抽 1 份**——矿石 **或** 气体（二选一，不再同时给两种），真实资源键 `ore:`/`gas:`，100% 掉落，外加正常 ISK（来自模板）。
  - **不掉落**：加密数据 / 星带特殊 / 通行密钥 / 死亡空间 / 战术材料。
  - **命名中性**："运输舰"（不出现敌方势力名，遵守世界设定文案约定）。
- **现有战术残液不改**：所有现有敌人（normal/elite/boss）的战术材料、加密数据、特殊、密钥掉落**一律原样保留**；只是运输舰自己不领取这些。

---

## 1. 硬约束（落地时必守）

1. **掉落"单一事实来源"四连一致**：`getTransportDropConfig`（预览）/ `rollTransportDrop`（生产计算）/ 在线 `resolveCombatEnemyDefeat` 发奖 / 离线 `recordKill`+`flush` 发奖，四者必须同源。
2. **审计强制**：`tools/audit-combat-drop-preview.mjs` 当前逐条比对 `getCombatDropPreview` 字段与 `roll*` 函数；新增运输舰章节核验 `preview.transport === rollTransportDrop`。
3. **战术残液不改**：运输舰豁免于一切现有掉落；现有敌人这些掉落数值/概率零变动（实施时做回归核对）。

---

## 2. 精确改动清单

### 2.1 数据 — `js/data/combat.js`
- 新增**共享** `TRANSPORT_TEMPLATE`（避免污染三个 faction 表、且中立命名）：
  ```js
  const TRANSPORT_TEMPLATE = Object.freeze({
    name:"运输舰", icon:"🚚", kind:"transport", baseDamage:0,
    iskDrop:300, xpDrop:10, image:null   // HP 占位，spawn 时按 normal ×1.2 覆盖
  });
  ```
- 新增 `TRANSPORT_DROP_BY_LAYER`：每层一个**候选池**，运输舰击毁后从池里**随机抽 1 项**（矿石 或 气体 二选一），每项含真实资源键与数量区间：
  ```js
  highsec: [
    { key:"ore:凡晶石",     qty:[4,8] },   // 数量区间见 §4.1 建议，实施时对照 resources.js 敲定键名
    { key:"gas:粗制富勒烯", qty:[3,5] },
  ],
  // 其余层（bordersec/lowsec/deepsec/nullsec/deepnull）同类，键名见 §3 占位表
  ```
  键用真实 `ore:`/`gas:` 资源键（具体名对照 `resources.js` 确认，见 §3 占位表）。`gas:` 具体键名实施时最终敲定。
- 新增 `TRANSPORT_SPAWN_CHANCE = 0.01`（每波附刷概率 1%，可调；Boss 波除外）。

### 2.2 敌人生成 — `js/systems/combat.js`
- 新增 `createTransportEnemy(zone, randomFn, combatState)`：
  - 取 `ENEMY_DATABASE[zone.faction].types[zone.enemyPool.normal[0]].hp` 作为基准；
  - 逐层 `shield/armor/structure` × `TRANSPORT_HP_MULT`（≈1.2）得 `hp`/`maxHp`；
  - `kind:"transport"`、`baseDamage:0`、`iskDrop`/`xpDrop` 取自 `TRANSPORT_TEMPLATE`；
  - `id` 走既有 `runToken + enemyInstanceSeq` 确定性方案（复用 `createCombatEnemy` 的 seq 逻辑）。
- 在 **`buildCombatWave`（combat.js:376）** 末尾追加：
  ```js
  if (wave < (zone.maxWave||20) && roll() < (zone.transportChance||TRANSPORT_SPAWN_CHANCE)) {
    const t = createTransportEnemy(zone, randomFn, combatState);
    if (t) enemies.push(t);
  }
  ```
  → 因为在线 `spawnCombatWave`（386）与离线 `simulateBelt`（offline-combat.js:355）**都调 `buildCombatWave`**，这里注入即同时覆盖在线 + 挂机战斗（已确认 offline 走同一函数）。死亡空间走 `buildDeathspaceWave`，不受影响（运输舰只星带刷）。

### 2.3 掉落配置 + 滚动 — `js/systems/combat.js`（镜像战术材料 413 / 554）
```js
function getTransportDropConfig(zone) {           // 纯配置，供预览+审计（返回候选池）
  if (!zone) return null;
  const layer = zone.formationPool;
  const pool = TRANSPORT_DROP_BY_LAYER[layer];
  if (!pool || !pool.length) return null;
  return { layer, pool: pool.map(e => ({ key:e.key, qtyMin:e.qty[0], qtyMax:e.qty[1] })) };
}
function rollTransportDrop(zone, randomFn) {       // 纯计算，100% 掉落且**随机抽 1 项**
  const cfg = getTransportDropConfig(zone);
  if (!cfg) return null;
  const rng = typeof randomFn === "function" ? randomFn : Math.random;
  const pick = cfg.pool[Math.floor(rng() * cfg.pool.length)];
  const qty = pick.qtyMin + Math.floor(rng() * (pick.qtyMax - pick.qtyMin + 1));
  return { key:pick.key, qty };   // 单条：矿石 或 气体
}
```

### 2.4 预览 — `js/core/selectors.js:1592` `getCombatDropPreview`
- **belt 分支**返回对象新增 `transport: getTransportDropConfig(zone)`。
- **deathspace 分支**不加（运输舰只星带刷，避免预览/审计出现死亡空间运输舰）。

### 2.5 在线发奖 — `js/systems/combat.js` `resolveCombatEnemyDefeat`（590）
- 把现有 **加密数据 / 星带特殊 / 通行密钥 / 死亡空间首领 / 战术材料** 五段（602–633）整体包进 `if (enemy.kind !== "transport") { ... }` —— 运输舰不领这些（战术残液规则对现有敌人零变动，仅对运输舰豁免）。
- 新增运输舰专属分支（在 ISK 发奖之后）：
  ```js
  if (enemy.kind === "transport") {
    const td = rollTransportDrop(zone, roll);
    if (td) {
      ResourceRegistry.add(state, td.key, td.qty);          // 单条：矿石 或 气体
      c.lastLoot += " · " + td.key + " ×" + td.qty;
      doEmit("combat:transportDropped", { enemyId:enemy.id, key:td.key, qty:td.qty, layer:zone.formationPool });
    }
  }
  ```

### 2.6 离线发奖 — `js/systems/offline-combat.js` `recordKill`（~290–340）+ flush
- 在 `recordKill` 内：**星带特殊掉落**循环（331–334）与**战术材料累计**（337–339）改为排除运输舰：
  - 星带特殊：`if (enemy.kind !== "transport") { ...push zoneSpecial... }`
  - 战术：`if (enemy.kind !== "transport") { if(elite)... else if(boss)... else da.tactical.normal++ }`
  - （加密数据/密钥原本就按 elite/boss 触发，运输舰非 elite/boss 不会命中，无需额外处理；首领段仅死亡空间，运输舰不进死亡空间。）
- 新增运输舰累计：
  ```js
  if (enemy.kind === "transport") {
    const td = G("rollTransportDrop")(zone, detRng(c));   // 离线同态 RNG，与在线一致
    if (td) {
      const acc = s.dropAccum.transport = s.dropAccum.transport || [];
      acc.push(td);   // { key, qty }
    }
  }
  ```
- flush（离线结算末尾把 `dropAccum` 落到 `ResourceRegistry` 处）新增：遍历 `s.dropAccum.transport`，对每个 `td` 做 `ResourceRegistry.add(state, td.key, td.qty)`（单条）。

### 2.7 审计 — `tools/audit-combat-drop-preview.mjs`
- 在加载段加 `fTransport = fn("rollTransportDrop")`。
- 新增章节（对每星带，沿用本工具现有 Monte Carlo 区间验证风格，与 §一/三/五 一致）：
  - `prev = fPreview(null,{mode:"belt",zoneId:zone.id})` 断言 `prev.transport` 存在且 `oreKey`/`gasKey`/`oreQtyBase`/`oreQtyMin`/`oreQtyMax`/`gasQtyBase`/`gasQtyMin`/`gasQtyMax` 与 `TRANSPORT_DROP_BY_LAYER[zone.formationPool]` 一致；
  - **Monte Carlo（TRIALS=4000）**：用 `makeRng` 跑 `fTransport(zone, rng)` 共 TRIALS 次，每次返回的 `ore.qty`/`gas.qty` 必须 ∈ [`oreQtyMin`,`oreQtyMax`]（及气体同款）闭区间（验证 ±20% 波动不越界），且均值与 `oreQtyBase`/`gasQtyBase` 偏差 ≤ 2%（验证中心不被随机拉偏）；
  - 键为真实 `ore:`/`gas:`（与 `TRANSPORT_DROP_BY_LAYER` 的键一致）；
  - `prev.transport === null` 对 `formationPool` 无配置的边界（若有）也正确。
- 注意：运输舰有 ±20% 随机波动，**不再使用"随机=0 取下限"的严格相等比对**，改为"区间覆盖 + 均值居中"（与现有概率型掉落的 `rateOk(…,0.02)` 容差同款思路）。

### 2.8 显示（可选）
- `renderCombatDropPreview`（UI）可加一行"运输舰掉落：矿/气"（可选，非功能必需）；在线击杀 `lastLoot` 已含矿/气，离线走 `dropAccum` 汇总。

---

## 3. 各层矿/气映射草案（占位，实施时对照 `resources.js` 确认真实键名）

| 安全层 (`formationPool`) | 矿石 `ore:` | 气体 `gas:` |
|---|---|---|
| highsec | 凡晶石 / 灼烧岩 | 粗制富勒烯 (?) |
| bordersec | 斜长岩 | (?) |
| lowsec | 干焦岩 | (?) |
| deepsec | 灰岩 | (?) |
| nullsec | 艾克诺岩 | (?) |
| deepnull | 艾克诺岩 | (?) |

> `gas:` 具体键名、`planetary:` 是否也进运输舰掉落（用户只点名"矿产、气体"，故本版只放 `ore:`+`gas:`，不含 `planetary:`），实施时对照 `resources.js` 最终敲定。

---

## 4. 平衡护栏

- 运输舰 **100% 掉 1 份**（矿石 **或** 气体，二选一），量小（具体数量区间见 §4.1），远低于主动采矿/气采产出。
- HP 仅比同层小怪高 ~20%，且 0 伤害 → 低风险 Farm，定位"救急/补缺"，**不替代生产**。
- 附刷概率 1%、不进 Boss 波（避免与 Boss 战混叠）、不进死亡空间。
- ISK 照常给（金额小，来自模板），保证"击杀有意义"。

### 4.1 掉落数量（已拍板：出率 1% · 效率 1/10 · 向上取整）

**公式**（用户最终拍板）：
- 目标：运输舰**总添头**（长期平均每秒产出）= 同级满装 0 强化工业舰采集速率的 **1/10**。
- 关系：`出率(1%) × (1/波次时长R) × 单艘量Q = (1/10) × 工业速率`，工业速率 = `M/T`（`M`=满装0强化同级工业舰每周期产量，`T`=该资源单次采集周期）。
- 推导：`Q = (1/10) × (M/T) × R / 0.01 = 10 × M × R/T`，再 **ceil（向上取整）**。
- `R` = 波次战斗时长（战斗减速 0.5× 后作基准取 **20s**；若实际≈60s，结果×3）。
- `M` = 满装 0 强化同级工业舰每周期产量（含装备加成，见下表；随玩家实际装配浮动，量级确定）。
- `T` = 该层矿石/气体 `baseTime`（实测 production.js，见下表）。

**M 估算（满装 0 强化、同级工业舰 + 同级顶配装备，逐项核算 equipment.js / ships.js）**：

| 安全层 | 同级工业舰 | M≈total |
|---|---|---|
| highsec | 拓岩级 | 1.27 |
| bordersec | 岩脊级 | 4.90 |
| lowsec | 巨像级 | 20.7 |
| deepsec | 巨像级 | 23.7 |
| nullsec/deepnull | 山海级 | 46.9 |

**层级对应规则（用户拍板：从下到上，矿物层>安全层则最高不出产）**：
- 战斗安全层只有 **6 个**（highsec->deepnull）；矿物/气体各有 **7 个层级**（production.js 实测）。
- **从下到上逐一对应**：最低安全层(highsec)对应最低矿(凡晶石)，……最高安全层(deepnull)对应第 6 低矿(灰岩)；**第 7 层（最高级）矿物/气体不出产**。
- 矿：艾克诺岩(T380) 不进运输舰；气：超纯聚合气体(T450) 不进运输舰。

| 安全层 | 矿石（baseTime / 层级序） | 基准Q | ±20% 波动区间[min,max] | 气体（baseTime / 层级序） | 基准Q | ±20% 波动区间[min,max] |
|---|---|---|---|---|---|---|
| highsec | 凡晶石 (20s / 1) | **13** | [11,16] | 粗制富勒烯 (30s / 1) | **9** | [8,11] |
| bordersec | 灼烧岩 (40s / 2) | **25** | [20,30] | 氦同位素 (60s / 2) | **17** | [14,21] |
| lowsec | 水硼砂 (70s / 3) | **60** | [48,72] | 稳定富勒烯 (100s / 3) | **42** | [34,51] |
| deepsec | 斜长岩 (120s / 4) | **40** | [32,48] | 氢同位素 (150s / 4) | **32** | [26,39] |
| nullsec | 干焦岩 (180s / 5) | **53** | [43,64] | 高纯富勒烯 (220s / 5) | **43** | [35,52] |
| deepnull | 灰岩 (260s / 6) | **37** | [30,45] | 聚合气体 (320s / 6) | **30** | [24,36] |
| 不出产 | 艾克诺岩 (380s / 7) | -- | -- | 超纯聚合气体 (450s / 7) | -- | -- |

> **±20% 随机波动（用户新增要求）**：实际单艘量 = `clamp(ceil(基准Q × rand(0.8, 1.2)), 1, ∞)`，rand 取 [0.8,1.2] 均匀分布（基准值上下浮动 20%）。预览 `getTransportDropConfig` 同时输出 `base`（基准Q，UI 显示用）、`min=ceil(base×0.8)`、`max=ceil(base×1.2)`；生产 `rollTransportDrop` 用同一 [0.8,1.2] 系数（在线 `Math.random` / 离线同态 `detRng`，保证四连一致）。

> 计算示例（deepsec 矿）：`Q = ceil(10 * 23.7 * 20 / 120) = ceil(39.5) = 40`。每行均由 `Q = ceil(10 * M * R / T)` 算出，R=20s。

**说明 / 边界**：
- 矿物名、气体名、baseTime 均直接取自 production.js `MINING_AREAS`/`GAS_AREAS` 真实定义（即"改过的矿物名"），无占位。
- 实际单艘量随玩家工业舰装配（M）**线性缩放**；波次时长若偏离 20s，按 `10 * M * R / T` 重算（R=60s 时上表全部 ×3）。
- 战斗减速、出率 1% 只影响"多久出一次"，不影响单艘绝对值（已乘进公式）。
- 现有战术残液等掉落**完全不变**（运输舰单独发矿/气，不领现有掉落）。

### 4.2 代码安全性：注入运输舰不会扰乱抽池 / 波次逻辑（已核实）

用户担忧"星带波次从池子抽取，追加运输舰会不会影响/打乱代码"——结论：**不会**。
- `buildCombatWave`（combat.js:376）先调 `getCombatFormation`（378）完成"从池抽 normal/elite/boss 数量"，**该抽池逻辑完全不被触碰**；我们在其返回（383 行打乱后）**追加**一艘运输舰，现有敌人数量/属性零变化。
- 波次清场判定是 `getLivingCombatEnemies(c).length === 0`（`resolveCombatWaveVictory` 726 行），即"全部死亡"而非"数量等于 formation 之和"；运输舰有 HP 可被击杀，不会卡波、也不会提前清波。
- 全代码无"敌人数量 === formation 计数"的断言（仅 1015 行对空数组提前返回，不受影响）。
- 在线 `spawnCombatWave`(386) 与离线 `simulateBelt`(offline-combat.js:355) **都调 `buildCombatWave`**，故注入一次即同时覆盖在线+挂机；死亡空间走独立 `buildDeathspaceWave`，运输舰不进死亡空间。
- 唯一行为变化：每波多一个"0 伤害、HP 略高"的可击杀目标，正是设计意图。

---

## 5. 与 T2 / T3 / 转换水槽 的衔接（路线图，本次不做）

- **T2（Boss→生产装备）**、**T3（死亡空间↔制造互锁）**、**转换水槽** 仍按原路线图推进；运输舰是 Tier1 的"主动采集反哺"地基，与 T2 的制造消耗互不冲突。

---

## 6. 实施前待你拍板的小项

1. 各层真实 `ore:`/`gas:` 键名（对照 `resources.js`）。
2. 附刷概率 1% 是否合适；是否允许进 Boss 波（默认不进）。
3. `TRANSPORT_HP_MULT` 取 1.2（"略高"）还是别的系数。
4. 运输舰是否给正常 ISK（建议给，金额小）。
5. 是否新增 `combat:transportDropped` 事件 + 战利品浮字（建议加，非必需）。

---

## 7. 验收（实施后由你触发，本次不做）

- `node tools/audit-combat-drop-preview.mjs` 全 PASS（含运输舰新章节）。
- 在线 + 离线（挂机）各打若干波：确认运输舰按概率出现、击毁后矿/气进入 `ore:`/`gas:` 库存并流入冶炼/气采管线；确认现有敌人战术残液掉落数量/概率**完全不变**（回归）。
- `node tools/verify.mjs` 全绿。
