# EVE IDLE 模块化版本开发日志

## 2026-08-01 — 修复空间站自动线启动后界面不刷新

- 根因：`refreshVisiblePanelAfterAction()` 遗漏 `station` 页面，自动线启动动作成功后状态已改变，但按钮、状态和进度仍显示旧值。
- 修复：空间站为当前页面时调用 `renderStationPage(Date.now())`，并在 `tools/verify.mjs` 增加刷新链路守卫。
- 验证：语法检查、综合验证、空间站专项审计和差异检查均 EXIT=0；空间站审计 PASS=1151 FAIL=0。

> 2026-07-12 及以前的历史记录保留在根目录 `DEVLOG.md`。本文件仅记录 `eveidle-modular` 拆分版后续开发，根目录原始文件继续作为回滚基线。

## 2026-07-27 — 无限库存：删除仓库/货舱容量机制

### 概述
统一删除整个仓库容量系统，改为无限库存。所有生产和离线结算不再受主仓库总量限制。

### 改动清单

**数据层** (`js/data/base.js`)：
- `INITIAL_SKILLS` 删除 `cargoManagement` 技能

**生产系统** (`js/systems/production.js`)：
- 删除 `getCargoCapacity()`、`getCargoUsed()`、`isCargoFull()` 三个函数（不保留 Infinity 兼容假函数）

**资源系统** (`js/core/resources.js`)：
- `getCargoTotal` → `getInventoryTotal`（仅统计总量，不参与限制）

**选择器** (`js/core/selectors.js`)：
- `getCargoUsedFromState` → `getInventoryTotalFromState`（调用 `getInventoryTotal`）
- `getGlobalDisplayState`：`cargo` 对象仅返回 `total`，删除 `capacity`/`full`/`percent`/`used`/`free`
- `getCargoDisplayState`：删除 `cargoCapacity` 参数，返回 `total` 代替 `used`+`capacity`
- `getPlanetaryDisplayState`：删除 `cargoCapacity` 参数和 `cargo` 字段
- 保留全部 Phase 3C-8 stationLogistics 修正

**在线 tick** (`js/core/tick.js`)：
- 删除全局满仓停止条件（`isCargoFull()` 分支）
- 删除双倍矿物 cargoSpace 限幅
- 删除装备工程、舰船部件、舰船组装的满仓判断

**离线结算** (`js/core/offline.js`)：
- 采矿/月矿离线 `maxCycles` 改为 `Infinity`，删除 apply 内的双倍矿物 cargoSpace 限幅
- 冶炼离线删除 `netCargo` 容量约束，`maxCycles` 仅受矿石库存限制
- 采气离线 `maxCycles` 改为 `Infinity`
- 舰船部件离线删除容量约束
- 舰船组装离线删除 `isCargoFull()` 检查
- 装备工程离线删除容量约束

**行动系统** (`js/core/actions.js`)：
- `PlanetaryStateActions.collect(state, id)` 改为全量收取（不再有 cargoCapacity 参数和 cargo-full reason）
- 行星 storage 全量移入主仓库后归零
- 删除 `cargo-full` 返回 reason

**增强剂** (`js/systems/boosters.js`)：
- `tickBoosterTimers`：采矿分支删除 `isCargoFull()` 暂停条件
- `getBoosterSlotStatus`：采矿分支删除 `isCargoFull()` 暂停条件

**UI 文件**：
- `index.html`：顶栏显示"物资总量"（删容量 x/y 和进度条）；导航删除 `cargoManagement` 等级显示；仓库页标题改为"物资总量"
- `css/base.css`：删除 `.cargo-bar`、`.cargo-fill`、`.cargo-fill.full`、`#cargo-text.warn`、`@keyframes blink` 样式
- `js/ui/render.js`：`renderGlobalDisplay`/`updateLiveUI` 只显示总量；删除 `getCargoCapacity()` 调用
- `js/ui/shell-render.js`：`renderCargoPage` 显示"物资总量"
- `js/ui/planetary-render.js`：删除 `getCargoCapacity()` 调用；`collectPlanet` 不传 `cargoCapacity`；`planetaryActionMessage` 删除 `cargo-full`

**存档迁移** (`js/core/persistence.js`)：
- 新增 `migrateUnlimitedInventoryState()`：删除 `skills.cargoManagement`、清理队列和当前行动的 cargoManagement 项，不补偿 XP/资源
- 接入 `autoLoad` 和 `importData` 路径，在 `calculateOfflineGains` 前运行

**审计**：
- 新建 `tools/audit-unlimited-inventory.mjs`：A~L 区真实行为验证
- 更新 `tools/verify.mjs`：适应新 cargo 显示态和行星全量收取
- 更新 `tools/audit-planetary.mjs`：adapt collect 语义
- 更新 `tools/audit-station.mjs`：删除对 `isCargoFull` 的引用

**浏览器验收**：
- 新建 `tools/unlimited-inventory-browser-test.html`：iframe 加载真实 index.html，覆盖仓库导航/总量/超千万生产/双倍/行星全量收取/增强剂 paused

### 边界
- 不碰 `js/render3d/**`、`ship-lab.*`、`*candidates.html`、`*capital-*.html`、`CORPORATION_AND_STATION_IMPLEMENTATION_PLAN.md`
- 不修改考古/增强剂/掉落/成功率/经验/经济数值
- 不修改增强剂离线算法
- 不触及其他未提交改动
- 不 git add/commit/push
- 行星 6 小时 storage 上限保留
- 舰船槽位、改装槽位、装配环容量保留

---

## 2026-07-26 — 页面滚动布局修复：修复面板内容被 flex 压缩裁切

### 根因
布局链 `body(overflow:hidden) → .main-container(overflow:hidden) → .content(overflow-y:auto) → .panel(flex-shrink:1 + overflow:hidden)` 中，`.panel` 默认 `flex-shrink:1` 使长面板被压缩到视口高度，再由 `overflow:hidden` 裁切溢出内容，`.content` 的 `scrollHeight` 始终等于 `clientHeight`。真实数据：
- booster-panel: clientHeight=621, scrollHeight=2201, overflow:hidden → 裁切
- shipeng-panel: clientHeight=621, scrollHeight=917 → 裁切
- statistics-panel: clientHeight=621, scrollHeight=661 → 裁切
考古（`#equipeng-panel`/`#archaeology-panel`）因已有 `overflow:visible` 豁免此问题。

### 修复（css/base.css）
- 新增规则：`.content > .panel:not(#hangar-panel):not(#cargo-panel) { flex: 0 0 auto; min-height: min-content; }`
- 被裁切的 3 页面修复后：面板自然展开至完整内容高度，`.content overflow-y:auto` 生效，页面可纵向滚动。
- 例外保留：`#hangar-panel`（`flex:1; min-height:0` + `.panel-body { overflow-y:auto }` 内部滚动）和 `#cargo-panel`（仓库列表内部滚动）不变。
- 弹窗（`max-height:70vh; overflow-y:auto`）、侧边栏（独立 `overflow-y:auto`）、body/main-container 的 `overflow:hidden` 均保持不变。

### verify.mjs 结构哨兵
新增 3 条 CSS 规则存在性检查：`.content` 须有 `min-height:0; overflow-y:auto`、普通面板须不可收缩（`flex:0 0 auto; min-height:min-content`）、hangar 内部滚动保留。

### 浏览器验收页（tools/page-scroll-browser-test.html）
新建 iframe 验收页，加载真实 index.html，覆盖：
- **9 类面板**：增强剂/舰船工程/统计档案/行星开发(多基地注入)/战斗(掉落预览展开)/考古/装备工程/船坞(内部滚动保持)/仓库(内部滚动保持)
- **弹窗**：打开关闭后滚动仍可用
- **动态内容增长**：注入增强剂库存/多行星基地/多艘舰船后验证滚动依旧出现
- **3 viewport**：1280×720（基准）、900×600（窄窗口）、390×700（手机）
- 验证：panel.scrollHeight > panel.clientHeight、content.scrollHeight > content.clientHeight、content.scrollTop 可增加、底部内容可达

### 回归（8 条全 EXIT=0）
- verify.mjs → EXIT=0（含新 CSS 哨兵）
- audit-boosters 1296/0、audit-planetary 304/0、audit-archaeology-system 178/0、audit-combat-drop-preview 785/0、audit-industrial-productivity、audit-station 1130/0
- git diff --check → EXIT=0

### 边界
只改 `css/base.css`（+ 布局注释 + 1 条 CSS 规则）、`tools/verify.mjs`（+3 结构哨兵）、`tools/page-scroll-browser-test.html`（新建）。未修改任何游戏数据、玩法逻辑或经济数值；未触碰 `js/render3d/**`、ship-lab、候选页面、空间站并行改动；未 commit/push。

---

## 2026-07-26 — Phase 3C-7 UI 收尾：8 类生产页面显示空间站综合后勤

### 显示态字段
所有相关 display state 统一提供 `stationLogisticsMultiplier` / `stationLogisticsBonusRate` / `stationLogisticsActive` / `stationLogisticsText`（依页面不同，顶层或通过 `efficiency` 子对象）。
- `buildProductionEfficiencyTooltip` 增加 "空间站综合后勤：×1.03（+3%）" 行。
- `getSmeltingDisplayState` 工具提示增加后勤行。
- 考古 `site` 对象增加 `archLogisticsMult`。

### 接入页面
1. **采矿/月矿**：`render.js`，效率旁显示 "后勤 ×1.03（+3%）"，tooltip 含后勤行。
2. **采气**：同采矿。
3. **冶炼**：tooltip 含 "空间站综合后勤：×1.03（+3%）"。
4. **装备/rig 制造**：`manufacturing-render.js`，效率旁显示后勤。
5. **增强剂制造**：`booster-render.js`，效率旁显示后勤。
6. **舰船部件/总装**：`manufacturing-render.js`，完整速度分解 "技能 ×2.98 · 船坞 ×1.30 · 后勤 ×1.03 · 最终 ×3.99"。
7. **行星开发**：`planetary-render.js`，头部显示 "空间站后勤 +3%"。
8. **考古**：`archaeology-render.js`，遗迹卡显示 "后勤 ×1.03"，头部显示后勤状态。

### 文案规则
- bodyLevel=0：空间站后勤：未建立
- bodyLevel=1/2/3 有燃料：空间站综合后勤：+1% / +2% / +3%
- 已建立但断油：后勤 ×1.00（燃料不足）

### 验证
audit-station 1131/0、verify 259 DOM IDs、industrial-productivity、planetary、boosters、archaeology-system 全部 EXIT=0；git diff --check 通过。未修改任何游戏数值/配方/掉落。**Phase 3C-7 完成。**

---

## 2026-07-26 — Phase 3C-8 最终收尾：统一空间站页面显示态

### 一、修复 `getStationPageDisplayState` 运行时错误

`alConfigs.map` 的 return 对象错误引用未定义的 `al` 变量（`al.selectedTargetId`、`al.running`、`al.canStart`、`al.canStop` 等），导致 `getStationPageDisplayState(gameState, Date.now())` 抛 ReferenceError。

**修复**：改用 `cfg`、`lineData`、`targets`、`selectedTarget`、`startedTarget`、`matchedRecipe`、`progressVal`、`cycleDurationSec`、`remainingSec`、`baseDisplay = getStationAutoLineDisplayState(state, cfg.lineId)` 等真实变量构建返回对象，移除全部 `al.*` 引用。返回字段包括：`lineId`、`name`、`buildingId`、`selectedTargetId`、`startedTargetId`、`running`、`targetOptions`、`buildingMultiplier`、`logisticsMultiplier`、`effectiveMultiplier`、`cycleDurationMs`、`progressRatio`、`remainingMs`、`canStart`、`canStop`、`blockedReason`、`stoppedReason`、`stoppedText`。

### 二、共用 `getStationAutoLineCycleDuration`

抽取 `processAutoLines` 中三条线的周期计算为共用函数 `getStationAutoLineCycleDuration(state, lineId, recipe)`：
- 冶炼：`recipe.baseTime / ((1 + shipBonus + rigBonus) × buildingMult × logisticsMult)`
- 装备/增强剂：`recipe.time / (buildingMult × logisticsMult)`
- UI 显示与 processAutoLines 同源，禁止公式漂移

### 三、八建筑 effectText/nextEffectText

`getStationBuildingDisplayState` 新增 `effectText`/`nextEffectText` 字段，八建筑各级效果：
- 资源调度中心：勘探指令阈值 20/14/10
- 行星管控中心：自动收取·槽位+0/+1/+2（Lv.1 +0）
- 冶炼/装备/增强剂制造厂：自动线 ×1.00/×1.15/×1.30
- 考古实验室：独特文物 ×1.00/×1.05/×1.10/×1.15
- 作战指挥中心：战斗XP ×1.00/×1.10/×1.20/×1.30
- 舰船船坞：速度×1.00/×1.05/×1.15/×1.30·节省0%/3%/6%/10%

`effectRows` 固定 9 行。综合后勤仅依赖本体等级和燃料，不依赖资源调度中心。已建船坞断油仍生效。

### 四、O 区显示态审计（14 条）

`tools/audit-station.mjs` 新增 O1~O11：
- O1 不抛异常、O2 8 建筑、O3 3 自动线、O4 targetOptions 非空、O5 effectRows 恰 9
- O6 建筑 effectText 非空、O7 无 undefined/NaN/Infinity
- O8 stateA/stateB 成本库存隔离、O9 corporation 正确
- O10 断油船坞例外、O11 冶炼周期含全部倍率

### 五、浏览器验收页

新建 `tools/station-browser-test.html`（17 条），覆盖：
- 本体建设与重复建设原子拒绝、建筑升级及本体等级限制
- 维护补给、8 建筑内容非空、3 自动线目标非空
- 自动线 A→启动→选择B，运行目标仍A；停止重启后目标变B
- 自动线周期和进度有效、断油七建筑停效/船坞例外
- 9 行效果、corporation 正确、页面可滚动、无 undefined/NaN
- console/page/resource/rejection 均为 0

### 验证

```
node --check js/systems/station.js          → EXIT=0
node --check js/ui/station-render.js         → EXIT=0
node tools/audit-station.mjs                 → PASS=1145 FAIL=0 (×2)
node tools/audit-station-migration.mjs       → PASS=32 FAIL=0
node tools/verify.mjs                        → 42 JS/4 CSS/278 DOM IDs, EXIT=0
node tools/audit-planetary.mjs               → PASS=304 FAIL=0
node tools/audit-industrial-productivity.mjs → EXIT=0
node tools/audit-boosters.mjs                → PASS=1296 FAIL=0
node tools/audit-archaeology-system.mjs      → PASS=178 FAIL=0
node tools/audit-rigs.mjs                    → PASS=599 FAIL=0
git diff --check                             → EXIT=0
```

**Phase 3C-8 完成。`audit-station.mjs` 1145/0。全量 12 条验证 EXIT=0。浏览器 RESULT=PASS。**

---

## 2026-07-26 — Phase 3C-7 空间站综合后勤倍率：独立速度乘区

### 背景
第八轮 1056/0 收口后发现第七轮离线船坞速度遗漏未算最终收口，但第八轮只统一了舰船工程的 skill×shipyard 公式。综合后勤倍率（本体 Lv.1=+1%/Lv.2=+2%/Lv.3=+3%）此前仅定义 bodyLevel 并预留注释，未接入任何生产路径。

### 实现
- **唯一函数** `getStationLogisticsMultiplier(state)`（station.js L1321）：Lv.0=×1 / Lv.1=×1.01 / Lv.2=×1.02 / Lv.3=×1.03，断油=×1，非法 bodyLevel / NaN / Infinity fail-closed×1。配套 `getStationLogisticsDisplayState` 暴露 bodyLevel/bodyName/operational/bonusRate/multiplier/disabledReason。
- **同步到 `getStationBuildingEffectsDisplayState`** 暴露 `stationLogisticsMultiplier`。

### 接入 9 条生产路径
1. **采矿 / 月矿**：`getProductionEfficiencyState("mining").total` 乘 logistics
2. **采气**：`getProductionEfficiencyState("gasHarvesting").total` 乘 logistics
3. **冶炼**：`getSmeltingDisplayState().efficiency` 乘 logistics
4. **行星**：`getPlanetOutputIntervalFromState` interval 除以 logistics
5. **装备与 rig**：`getEquipEngEfficiency()` 乘 logistics（manufacturing.js + selectors.js 显示态）
6. **增强剂**：`getBoosterEfficiency()` 乘 logistics（manufacturing.js + selectors.js 显示态）
7. **舰船部件与总装**：`getShipEngineeringCycleDuration` 除以 logistics（第八轮统一公式升级为 skill×shipyard×logistics）
8. **考古**：tick 在线 `/logistics`、offline 描述符 `/logistics`、显示态 `actualCycleTime/1.03`
9. **三条自动线**：`processAutoLines` 中 `buildingMultiplier * stationLogisticsMultiplier`

### 显示态
各页面暴露 `stationLogisticsMultiplier` / `stationLogisticsBonusRate`；tooltip 概念到位，断油显示 `disabledReason="no-fuel"`。

### 离线分段
`settleOfflineTimeline` 按燃料耗尽段自然适配 logistics：有油段用 1.01~1.03，无油段恢复 1.00。本阶段无修改离线分段逻辑。

### 审计 N 区（N1~N12）
- N1 getter：Lv.0/1/2/3 + 断油 + 非法 fail-closed + display state
- N2 采矿：在线周期、断油恢复
- N3 采气：同
- N4 冶炼：efficiency 含 logistics + 单周期产出不变
- N5 行星：interval 精确除以 1.03 + 断油恢复 + storageMax 同步
- N6 装备：getEquipEngEfficiency 含 logistics + 断油恢复
- N7 增强剂：getBoosterEfficiency 含 logistics + 断油恢复
- N8 舰船：Lv.3 有油 2.98×1.03×1.30 / Lv.3 断油 2.98×1×1.30 / 显示态一致
- N9 考古：周期公式 site.time×booster/1.03 + 成功率/掉率不变
- N10 自动线：有油运行、断油闸门暂停
- N11 无 25% 上限：总倍率 3.99 > 1.25，周期 = 配方/3.99（非截断值）
- N12 排除项：ISK、节省率、战斗 XP getter 不因 bodyLevel 改变

### 审计计数
audit-station.mjs **1056 → 1111**（N 区 55 新断言），连续两次 PASS=1111 FAIL=0。

### 回归 26 条命令全 EXIT=0
1-7: `--check` 7 文件全过；8-9: audit-station×2(1111/0)；10: migration(32/0)；11: verify.mjs(41JS/4CSS/252DOM)；12: industrial；13: planetary；14: boosters(1296/0)；15: archaeology-system；16: archaeology-ships；17: equipment-enhancement；18: ship-enhancement；19: rigs(599/0)；20: calc --verify；21: calc --mixed-battleship(8G)；22-23: simulate-destroyer-belts(8G 两条)；24: ship3d；25: smoke；26: git diff --check。

### 边界
- 未进入 3C-8；不碰 render3d/ship-lab/NUL；不修改策划数值/配方/经济；不改增强剂离线算法；不改船坞节省账本；不 git commit/push。

## 2026-07-26 — Phase 3D 战斗掉落与恢复收尾：掉落预览防漂移 + 战斗重创最终定案 + 考古经济审计 15 行 + 全回归

### 背景
本轮三组收尾工作（掉落配置/战斗恢复文辞/考古经济审计）和一个全回归验证，均在 Phase 3D 和 3C-6 收口后进行，不涉及新的 Phase 启动。

### Part 2 — 非法 ID fallback → fail-closed（js/systems/combat.js、js/ui/combat-render.js）
- 原 `COMBAT_ZONES.find(...) || COMBAT_ZONES[0]` 回退首个星带 → 改为 `{mode:"belt",valid:false,reason:"unknown-zone"}`（belt）；deathspace 非法 sourceZoneId → `{mode:"deathspace",valid:false,reason:"unknown-source-zone"}`。
- UI 侧：`valid:false` 时显示 "⚠ 掉落数据不可用"，绝不回退显示首个星带数据。
- 审计新增 10 断言（785/785）：非法 zoneId/空 zoneId/非法 sourceZoneId 各 fail-closed + reason 检查。

### Part 3 — 掉落概率配置提取为纯函数（js/systems/combat.js）
- 新增 5 个只读配置函数：`getTacticalMaterialDropConfig` / `getEncryptedDataDropConfig` / `getCombatZoneSpecialDropConfigs` / `getDeathspaceTicketDropConfig` / `getDeathspaceLeaderLootConfigs`。
- `roll*` 生产函数和 `getCombatDropPreview` 预览均调用同一配置函数。无数值改动。
- `encryptedDataChances` 覆盖用 `!= null` 而非 `||`，保留合法 0 概率。
- 审计新增 0-probability 边界测试（elite:0 boss:0 配置 → 返回 0 而非被 base 覆盖）。

### Part 4 — 战斗维修后返回文案精确化（js/core/actions.js）
- `beginRecovery` 的 `lastStatus` 按策划最终定案：belt "本轮肃清失败，维修完成后返回该星带。"；deathspace "攻略失败，密钥不返还；维修完成后返回来源星带。"
- `tryResumeCombatAfterRepair` 已在上轮修正符合定案（死亡空间绝不调用 `enterDeathspace`、不清密钥、返回 `returnZoneId` belt 第 1 波）。
- `tools/audit-resume-after-repair.mjs` 55/55 PASS EXIT=0 不变。

### Part 6 — 考古经济审计完整 15 行（tools/audit-archaeology-economy.mjs）
- 从 5 行（仅 salvage）升级为 15 行：5 档 (I-V) × 3 档案 (salvage/research/treasure)。
- `runCycles(site, seed)` 取 site 对象迭代 15 个遗迹；固定种子连续模拟。
- 新增 `getArchaeologyDisplayState` 纯预览交叉验证：ISK ≤3% 偏差、uniqueCount ≤15% 或 abs≤20 偏差。
- 结果 184/184 PASS EXIT=0。
- `AUDIT_ARCHAEOLOGY_ECONOMY_REPORT.md` 更新 v3：15 行经济表 + 档案乘数表 + 标记旧提案为历史。

### Part 7 — 全回归（15 条命令，14 条 EXIT=0）
- 1–11：全部 EXIT=0 ✅（--check ×3、audit-combat-drop-preview 785/785、audit-resume-after-repair 55/55、audit-archaeology-relics、audit-archaeology-economy 184/184、audit-archaeology-system、simulate-archaeology-user-flow、audit-boosters、verify）
- 12：`--audit-economy --runs 5000` → **EXIT=1**（原生段错误，T5 旗舰配置，不加载 combat.js，纯环境限制）
- 13：`--assert-mixed-battleship` 8GB → **EXIT=0** ✅
- 14：`--assert-nullsec` 8GB → **EXIT=0** ✅
- 15：`git diff --check` → **EXIT=0** ✅（仅 CRLF 警告）

### 边界
未修改任何游戏数值；未触碰 `js/render3d/**`、ship-lab、候选页面、NUL；未 commit/push。

---

## 2026-07-26 — Phase 3C-6 第八轮定点返修：统一舰船船坞在线/离线/显示态速度倍率

### 背景（真实缺陷）
第七轮 998/0 只收口了"节省"，**离线与显示态的船坞速度倍率被遗漏，998/0 不作为最终收口**。修复前三条路径公式分歧（以船舶工程 Lv.99 eff=2.98、船坞 Lv.3 为例，部件 integrated_hull time=63s、总装 rifter time=30s）：
- 在线（tick.js）：`recipe.time / eff / getShipyardSpeedMultiplier` → 部件 16.262s / 总装 7.744s（正确）
- 离线（offline.js getOfflineActionDescriptor）：`recipe.time / eff` → 部件 21.141s / 总装 10.067s（**缺船坞倍率**）
- 显示态（selectors.js getShipEngineeringDisplayState 进度/ETA/弹窗）：`recipe.time / efficiency` → 同离线 21.141s / 10.067s（**缺船坞倍率**）
先在 audit-station 写入 J9~J12 复现测试，修复前运行 **PASS=1025 FAIL=31**（离线 Lv.3 总装 900s 仅 89 周期而非 116、在线 50 vs 离线 38 等），证明缺陷真实存在。

### 唯一周期公式（js/core/selectors.js）
新增共用纯函数（displayState 之前，全入口共用）：
- `getShipEngineeringSpeedBreakdown(state)`：`skillMultiplier = 1 + lvl×0.02`、`shipyardMultiplier = getShipyardSpeedMultiplier(state)`，两者非有限正数一律 fail-closed 回退 ×1（无 NaN/Infinity）。
- `getShipEngineeringCycleDuration(state, recipe)`：`duration = recipe.time / skillMultiplier / shipyardMultiplier`（base 非法回退 1）。

接线 8 个入口：tick.js 在线部件/在线总装 ×2、offline.js 离线部件/总装 descriptor.duration ×2、selectors.js componentProgress/assemblyProgress ×2、确认弹窗 shipComp/shipAsm duration ×2。显示态新增暴露 `skillMultiplier`/`shipyardMultiplier`/`totalSpeedMultiplier`/`componentActualTime`/`assemblyActualTime`（不混入材料节省率）。船坞 Lv.0/1/2/3 部件实际 21.141/20.134/18.383/16.262s，总装 10.067/9.588/8.754/7.744s；断油 shipyardMultiplier 仍 1.30。

### 审计（tools/audit-station.mjs，998 → **1056**，新增 58 断言）
- **J9** 部件四级速度：每级验证共用函数==参考公式、在线恰产 1、离线 600s==floor(600/dur)，Lv.3/Lv.0 比≈1.30（在线+离线）。
- **J10** 总装离线 Lv.0 vs Lv.3（900s）：`floor(elapsed/adjustedDuration)`＝89/116，比≈1.30。
- **J11** 在线 50 周期 vs 离线同实际秒数（387.7s）：周期差≤1（50/50）、XP/消耗/节省/ledger 全一致、totalSaved>0、ledger 非空。
- **J12** 显示态：5 字段有限正数、断油仍 1.30、Lv.0 纯技能时间、Lv.0/Lv.3 比=1.30、弹窗 duration==共用周期、损坏等级 fail-closed 回退 ×1。
- **J13** getByRef/spendByRef 直接行为：`component:xxx` 精确读写、纯名"镓"读扣 `moon:镓`、"天使低级加密数据"读扣 `special:`、未知 ns:key/未知纯名安全失败不误扣、数量不足不部分扣除。
- 同步修正旧测试 J5/J6/J6b/G5 的 `perCycle = time/eff` → `time/eff/getShipyardSpeedMultiplier`（离线秒数参考必须含船坞倍率，符合"禁未含 syMult 的 perCycle 反推"）。
- **连跑两次均 PASS=1056 FAIL=0**。

### 回归（15 条全 EXIT=0）
node --check station/tick/offline/selectors ×4、audit-station ×2、audit-station-migration(32/0)、tools/verify.mjs、audit-industrial-productivity、calculate-ship --verify、calculate-ship --audit-mixed-battleship(8G)、audit-boosters(1296/0)、audit-planetary、audit-rigs(599/0)、git diff --check。

### 边界
未改配方时间/材料/XP/成功率/船坞 1.05/1.15/1.30 与节省 3/6/10%；未碰 render3d/**、ship-lab、候选/demo 页面、NUL；未 commit/push；**Phase 3C-7 仍未开始**。

## 2026-07-26 — Phase 3D 战斗恢复规则修正：重创即失败，维修后统一返回普通星带

### 背景
上一版 Phase 3D 对死亡空间"记录但不续跑"，且保留了普通星带剩余敌人/波次的设想不符合最终策划。本次按策划纠正为：**重创即本次 run 立即失败并清零遭遇进度；无论普通星带还是死亡空间，维修完成后都只返回普通星带、从第 1 波开始全新一轮肃清；死亡空间永不续原副本、通行密钥不返还也不再扣。**

### 修改
- **恢复标记结构（actions.js `beginRecovery`）**：改为 `{type:"combat",returnZoneId,defeatedMode:"belt"|"deathspace",deathspaceId,shipInstanceId}`。死亡空间用 `sourceZoneId` 作 `returnZoneId`；`defeatedMode`/`deathspaceId` 仅供日志/UI/事件；不保存 enemies/wave 快照。既有清空 enemies/currentFormation/wave→1/totalKills/runEliteKills 行为**保留不变**。lastStatus 改为策划文案。
- **恢复语义（combat.js `tryResumeCombatAfterRepair`）**：删除死亡空间早退分支；无论 belt/deathspace 都清死亡空间残留（mode=belt、deathspaceId="")、回 `returnZoneId` 生成第 1 波、经既有 `combat/start` Action 续跑。**绝不调用 `enterDeathspace`、不检查或扣除密钥**；非法 `returnZoneId` 安全停止；事件 payload 增 `defeatedMode`/`deathspaceId`。
- **主动停止（actions.js `stop`）**：放宽守卫——维修中（combat 非活跃）若存在待恢复标记也允许 stop 以取消自动出击，返回 `cancelledResume`。
- **迁移收紧（persistence.js）**：combat 标记严格 fail-closed（`returnZoneId∈COMBAT_ZONES`、`defeatedMode∈{belt,deathspace}`、deathspace 须携合法 `deathspaceId`），旧结构缺 `returnZoneId` 归 null。
- **事件契约（events.js）**：`combat:resumedAfterRepair` required 增 `defeatedMode`（`deathspaceId` 可为 null 不列 required）。
- **UI（selectors.js）**：维修中且有待恢复标记时 headerText 显示"自动维修中 · 完成后返回战斗"。
- **文档**：eveidle.md / PROJECT_HANDOFF.md 将"死亡空间不续跑"改为"死亡空间不续原副本；维修完成后自动返回来源普通星带"；Phase 4A 离线战斗登记同语义。

### 审计
- `tools/audit-resume-after-repair.mjs` 重写：**55/55 全 PASS，EXIT=0**，全经生产入口（`dispatchGameAction`/`combatTick`/`migrateArchaeologyState`）。
  - A 迁移 fail-closed（13，含旧结构归零）；B 普通星带重创+维修恢复（14，清零/不回收 ISK/不发 LP/返回同 zone 第 1 波）；C 死亡空间重创+维修恢复（11，密钥不返还且不再扣/返回 sourceZone/mode=belt/不重进副本）；D 主动停止取消返回（6）；E 非法 returnZoneId 安全停止（5，不扣资源）；F 源码自检含"恢复函数不含 enterDeathspace"静态确认（5）。

### 修改文件
`js/core/actions.js`、`js/systems/combat.js`、`js/core/persistence.js`、`js/core/events.js`、`js/core/selectors.js`、`tools/audit-resume-after-repair.mjs`（重写）、`eveidle.md`、`DEVLOG.md`、`PROJECT_HANDOFF.md`。

### 边界
未修改任何数值；未触碰 `js/render3d/**`；未 commit/push。

## 2026-07-26 — Phase 3C-6 第六轮定点返修：审计升级为真实业务入口精确断言

### 目标
把 `tools/audit-station.mjs` 从"函数存在/宽区间"升级为"真实业务入口产生精确结果"，只修剩余缺陷，不重写已正确部分。

### 核心修复（js/core/offline.js）
- `settleOfflineTimeline`（约 688-784 行）改为**动态 while 分段**：每段循环内重新计算下一边界（燃料耗尽点/施工完成点），无油段同样调用 `processAutoLines`（自动线内部因断油自然暂停、进度保留）并推进 `maintenance.lastTick`，断油补油后不追扣。

### 审计升级（tools/audit-station.mjs，第七轮收口后 998 断言全 PASS）

> 第七轮最终收口（2026-07-26）：G2 改为**统一离线 10h 断油对比**（A fuel=0 → 周期 0；B 精确 1h → 180；C 完整 10h → 1800；精确断言 A===0 / |B-180|≤1 / |C-1800|≤1 / A<B<C / |C-10×B|≤2，三组矿耗/矿物产出/XP/autoLine.lastTick/enabled/startedTarget 严格联动）。J 区船坞节省升级为**真实 Lv.3（savingRate 0.10）验证**：J4 在线 10 周期(每部件实付 18/省 2，saved 事件 2 次)、J5 离线批量 50(实省===quote.saved，totalSaved=30)、J6 在线100vs离线100 完整快照一致(非零初始余数 0.37/0.61/0.37，每部件省 20，savedQty 60)、**新增 J6b materialCost 配方 gale**(在线40vs离线40，镓/铂/加密数据实省 40/32/60，savedQty 184)。发现并修复**真实缺陷**：materialCost 生成纯材料名 ref（如"镓"），而 `commit/hasEnough/maxCycles` 用 `ResourceRegistry.get/spend(ref)`（需 `namespace:key`），对纯名返回/扣 0 库存 → 节省路径判"无材料"，materialCost 配方完全无法组装/节省。修复：`js/core/resources.js` 新增 `getByRef/spendByRef`（parseId 命中走 get/spend，否则按名 getMaterialStock/spendMaterial），`js/systems/station.js`(canAfford/commit 3 处)、`js/systems/manufacturing.js`(hasEnough)、`js/core/selectors.js`(maxCycles 二分) 共四处切换。因游戏代码变动跑完整正式回归全 EXIT=0。

**（以下为第六轮 955 断言历史记录，J 区/G 区已被第七轮取代）**

- **G 区（离线燃料分段）**：G1 用真实冶炼配方"凡晶石带"精确断言（cycleTime=20s、10h 离线仅 1h 有油 → expectedCycles=floor(3600/20)=180，误差≤1；oreConsumed===cycles、mineralProduced===cycles×2、xp===cycles×10）；G2 A/B/C 快照（0h=0 / 1h≈180 / 10h≈1800 线性）；G2b 断油补油不追扣（progress 残值<20s）；G3 断油 dispatch 计数/奖励/事件全部严格不变；G4 真实 `applyOfflineGains` 行星断油不自动收取（有油对照收取，storage 用真实 `getPlanetStorageMaxFromState`）；G5 船坞断油仍产出（speedMult=1.30 生效）。
- **H 区（考古实验室）**：真实 `resolveArchaeologyDrops`（site_iii_b + ARCHAEOLOGY_TIERS.III）+ 固定 rng 序列，覆盖非实验室归因/实验室归因恰一次 `station:archaeologyBonusTriggered`/不掉落/校准/LP/断油 labMult=1；H7 `resolveArchaeologyCycle` 入口。
- **I 区（作战指挥中心）**：I2 十项白名单逐项真实 `addStationModifiedCombatXp`（技能设 lvl:99 防升级扣 XP，delta===100×1.30 且 boost 事件恰一次）；I3 四项非白名单无加成；I4 断油无加成；I5 **真实 combatTick 一回合**（`hangar/setFittingSlot` 真实装配武器、敌血下降、燃料/弹药消耗、laserOps +2×1.30 / targeting +1×1.30、boost 事件≥2）。
- **J 区（舰船船坞）**：J4 在线 gameTick 单次组装（rifter 真实 SHIP_ASSEMBLY_RECIPES，shipCount/xp/部件精确）；J5 离线 `applyOfflineGains` 批量 50 次；J6 **100 次在线逐次 vs 离线批量 100 次状态一致**（ships/xp/部件/余数账本/事件数）；J7 Lv.3 commit 失败原子拒绝（不创建舰船/不加 XP/不消费 progress）；J8 余数账本守恒。
- **K 区（迁移 fail-closed）**：删除手写归一化，全部走真实 `normalizeStationState`/`migrateStationCorporationState`；K10 幂等 + 玩家数据深比较不变；K11 **真实 `SaveManager.importData` 路径**（损坏存档 JSON：bodyLevel=42→0、fuel=-500→0、lastTick="corrupt"→0、buildings 越界→cap、savingsLedger≥1→0.999999、未知 key 删除、construction 未支付→null）。

### 审计 harness 关键技术
- 顶层 `const`（COMBAT_ZONES/SMELTING_RECIPES/PLANET_TYPES/ENEMY_DATABASE 等）不挂 sandbox 全局，新增 `evalIn(expr)=vm.runInContext(expr,sandbox)` 在 vm 上下文内取真实数据；SHIP_ASSEMBLY_RECIPES 经 `window.SHIP_DATA`。
- combatTick 依赖的 UI 函数（updateLiveUI/playAttackFX/playEnemyAttackFX 等）注入 no-op 桩（定义于被排除的 js/ui/*）。
- 被测技能设 lvl:99 防 `checkLevelUpFromState` 升级扣 XP 污染精确断言；离线时长偏置须 < 单周期（+2s）防多结算一周期；G4 行星 storage 用真实上限防撑爆货舱污染后续用例。

### 边界
未进入 3C-7；未触碰 `js/render3d/**`；未修改任何策划数值/配方/XP；未 commit/push。

## 2026-07-26 — Phase 3D：维修后自动恢复（含 Phase 4A 登记）

> ⚠ **本条战斗部分已被上方"Phase 3D 战斗恢复规则修正"取代**：死亡空间不再"不续跑"，而是维修后返回来源普通星带第 1 波；恢复标记结构改为 `{returnZoneId,defeatedMode,deathspaceId,...}`；审计升级为 55 断言。考古部分仍有效。

### 目标
舰船因考古反噬 / 战斗损毁进入 180s 维修后，维修完成自动续跑被打断的行动，玩家无需手动重开。

### 实装
- **状态字段（state.js）**：`gameState.resumeAfterRepair`（默认 `null`），置于 `archaeology` 之前。记录 `{type:"archaeology",siteId,probeId,shipInstanceId}` 或 `{type:"combat",zoneId,mode:"zone"|"deathspace",shipInstanceId}`。
- **幂等迁移（persistence.js `migrateArchaeologyState`）**：旧存档回填 `null`；结构非法（非 archaeology/combat 对象）一律归 `null`（fail-closed）；`null` 保持不变。
- **Action 记录/清除（actions.js）**：
  - `CombatStateActions.beginRecovery` 记录 combat 标记（`mode` 如实记 zone/deathspace）；
  - `combat/start`、`combat/stop`、`archaeology/start`、`archaeology/stop` 一律清 `null`（玩家主动操作取消自动恢复）。
- **在线考古（tick.js）**：维修完成后重调 `canStartArchaeology`——充足则清标记续跑 + 发 `archaeology:resumedAfterRepair`，不足则安全停止（`stopOrSkip`）；击毁时记录标记。
- **在线战斗（combat.js）**：`combatTick` 检测 `hadRepair` 转 0 后调 `tryResumeCombatAfterRepair`——普通星带经既有 `combat/start` Action 续跑 + 发 `combat:resumedAfterRepair`；**死亡空间不续跑**（通行密钥已消耗，仅一次性清标记）；无效前提安全停止不抛错。
- **离线考古**：由 `settleByTime` 时间预算自然续跑，无需独立标记。
- **事件契约（events.js）**：注册 `archaeology:resumedAfterRepair`（required siteId）、`combat:resumedAfterRepair`（required zoneId）。

### Phase 4A（未实装，登记）
**离线战斗自动恢复**未实现——离线期间战斗损毁后不自动续跑下一轮。登记为后续 Phase 4A：需扩展 `settleOfflineActions` 的 combat 分支，处理离线维修墙钟 + 通行密钥 / 波次状态恢复。

### 审计
- `tools/audit-resume-after-repair.mjs`：**42/42 全 PASS，EXIT=0**。全部经生产入口驱动（`dispatchGameAction` / `gameTick` / `combatTick` / `migrateArchaeologyState`），非源码字符串比对。
  - A 迁移 fail-closed（9）；B Action 记录/清除（10）；C 在线考古 gameTick 续跑/安全停止/击毁记录（10）；D 在线战斗 combatTick 星带续跑/死亡空间不续跑/无效前提安全停止（8）；E 源码自检确认真实生产入口（5）。

### 修改文件
`js/core/state.js`、`js/core/persistence.js`、`js/core/actions.js`、`js/systems/combat.js`、`js/core/tick.js`、`js/core/events.js`、`tools/audit-resume-after-repair.mjs`（新增）。

## 2026-07-26 — Phase 3C-5：三条自动线实装完成

### 冶炼/装备/增强剂三条后台自动线

- **核心逻辑（station.js）**：
  - `processSmeltingAutoLine`：使用真实 SMELTING_RECIPES，效率=(1+shipBonus+rigBonus)×buildingMultiplier（不乘 refining 等级速度），产出量仍用 skillEfficiency
  - `processEquipmentAutoLine`：使用真实 EQUIPMENT_ENGINEERING_RECIPES，cycleTime=recipe.time/buildingMultiplier（不乘 equipmentEngineering 等级速度），检查配方等级门槛，处理 inputEquipment 势力/DED 装备
  - `processBoosterAutoLine`：使用真实 BOOSTER_RECIPES，cycleTime=recipe.time/buildingMultiplier（不乘 boosterEngineering 等级速度），每周期 1 瓶
  - `processAutoLines`：统一入口，在线/离线共用，按各自 lastTick 计算 elapsedMs
- **速度倍率**：Lv.0→0（不可启动）、Lv.1→×1.00、Lv.2→×1.15、Lv.3→×1.30
- **Action 层**：`station/selectAutoLineTarget`、`station/startAutoLine`、`station/stopAutoLine` 三个 Action，均走 `dispatchGameAction`
- **事件**：`station:autoLineStarted`、`station:autoLineStopped`、`station:autoLineCompleted` 三个契约事件
- **tick/offline 接线**：gameTick 尾部 + applyOfflineGains 尾部各调用一次 `processAutoLines(state, Date.now(), offline)`
- **审计 658 断言全 PASS**：新增 E 区 18 类自动线测试（Lv.0 拒绝、倍率精确、不乘技能、三条并行、互不污染、真实扣料产出、势力装备扣除、单瓶增强剂、材料不足原子停止、目标锁定、在线离线一致性、保存不重复结算、operatorId 恒 null）

### 边界确认
- 未实装维护系统（Phase 3C-3 已取消）
- 未实装 Phase 3C-6/7/8
- 未接本体综合后勤加成
- 未修改配方/经验/材料/生产数值
- 未触碰 js/render3d/** 或候选页面
- 未实装维护系统（Phase 3C-3 已取消）→ 已在 Phase 3C-6 恢复

## 2026-07-26 — Phase 3C-6：维护燃料 + 考古实验室 + 作战指挥中心 + 舰船船坞

### 维护燃料系统
- 恢复维护燃料系统（策划从未取消）
- 使用通用燃料 `consumable:fuel`，每点每周 1500 燃料
- 维护点数 = bodyLevel + 七座非船坞建筑等级之和
- 满配 24 点 = 每周 36000 燃料
- 一键补给至七天容量，>24h 剩余拒绝
- 低油/耗尽事件精确一次，fuelRemaining 浮点精确
- 船坞为断油唯一例外

### 离线时间轴分段
- `settleOfflineTimeline` 在 `applyOfflineGains` 内统一调用，按燃料耗尽/施工完成分时间轴
- 每段分别：settleOfflineActions → settleOfflinePlanets → processAutoLines → 扣燃料 → 施工完成
- 有油段非船坞效果生效，无油段自动线暂停/进度保留/不追扣
- 离线行星自动收取由 settleOfflinePlanets 内 `applyStationAutoCollect` 处理

### 在线顺序
- gameTick: tickBoosterTimers → settleStationMaintenance → updateCombatRecovery → 行动处理 → planetaryTick → construction → autoLines

### 考古实验室
- `resolveArchaeologyDrops` 独特率公式: `min(0.99, baseRate × tracerMultiplier × labMultiplier)`
- 单随机数同时决定 dropped 和 labCaused
- 触发事件 `station:archaeologyBonusTriggered`
- 断油时 labMultiplier=1

### 作战指挥中心
- 10 技能白名单（capacitorManagement/laserOps/cannonOps/missileOperations/targeting/shieldOperation/armorReinforcement/hullEngineering/piloting/defense）
- 非白名单技能无加成
- 倍率 Lv.0=1.0 / Lv.1=1.10 / Lv.2=1.20 / Lv.3=1.30
- 断油恢复 ×1

### 舰船船坞
- 速度 Lv.0=1.00 / Lv.1=1.05 / Lv.2=1.15 / Lv.3=1.30（独立乘区，不影响 shipEngineering 技能）
- 材料节省 Lv.1=3% / Lv.2=6% / Lv.3=10%（仅总装 componentCost+materialCost）
- 确定性余数账本 `station.shipyard.materialRemainders`，quote+commit 两阶段原子
- capital 部件/总装需 Lv.2，supercapital 需 Lv.3，常规舰始终可造
- `station:shipyardMaterialsSaved` 事件在真实在线/离线总装完成派发
- 断油仍有效

### 文档同步与审计
- 维护文案纠正：未被取消，使用通用燃料
- 审计 PASS=784 FAIL=0（A-E:726 + F-K:58）
- 完整 UI 留到 Phase 3C-8
- 保留全部并行未提交改动

## 2026-07-24

### 行星开发 Phase 1：旧档迁移与到期结算缺陷返修

- **缺陷一（旧档吞档）**：`normalizePlanetaryState` 原实现遇到旧 `planetaryDeployments` 只建空容器不复制内容即删除旧数组，会永久丢失玩家旧基地。返修为完整迁移：`type`→`planetType`、`timeDeployed`→`deployedAt`、storage/progress/显式 active 原样保留、缺失 id 稳定分配 `planet_legacy_${idx}`、`capacity` 不进入新结构、新旧容器共存时按 id 去重合并（同 id 优先新版、缺失追加）、`nextId` 单调、迁移成功后才由调用方删除旧容器；不追收 ISK/三钛、深比较幂等。
- **缺陷二（离线收益丢失）**：原顺序 normalize（超期即置 active=false）→ calculateOfflineGains（跳过 inactive）会丢掉 [lastSave, expiresAt] 收益。`normalizePlanetaryState(state, opts)` 两阶段化：`finalizeExpiry:false` 仅字段迁移绝不提前关停，`finalizeExpiry:true` 在离线结算后做到期最终化；`autoLoad` 与 `importData` 统一为「迁移 → calculateOfflineGains → 最终化」。
- **缺陷三（在线最后段丢失）**：`planetaryTick` 原先 `now>=expiresAt` 直接 continue，丢弃 lastTick→expiresAt 最后一段。新增在线/离线共用纯函数 `computePlanetarySettlement`（夹紧 [deployedAt, expiresAt]、满仓丢弃残留进度、lastTick 不回退），tick 改为先结算 activeEnd=min(now, expiresAt) 再关停 + 单次 expired；`settleOfflinePlanets` 同步改用该纯函数。附带修复纯函数初版 durationMs 双重乘 1000 导致到期夹紧失效的缺陷（audit 区 U 抓获）。
- 验收：`tools/audit-planetary.mjs` 删除「遗留容器只建不复制」错误断言，新增 ZA~ZH 八区（旧容器完整迁移/新旧去重合并/重复迁移幂等/离线跨到期精确产出 61 周期/autoLoad 顺序/importData 一致/在线晚到 tick 最后段 10 周期/防重复），经 `autoLoadOrder`/`importDataOrder` 集成入口按生产一致顺序真实驱动 `calculateOfflineGains`。**34 区 200 断言全 PASS**。13 条正式回归全 EXIT 0（第 12/13 条为 `simulate-destroyer-belts.mjs --assert-mixed-battleship` / `--assert-nullsec`，第 12 条首跑偶发段错误 139 复跑 0，属已知环境问题）。
- 边界：未实装增强剂、未改行星费用/产量/interval/技能公式、未增基地升级、未碰 `js/render3d/**`、未 commit/push。

### 增强剂系统 Phase 2A：数据/制造/在线离线/UI/审计实装

- 实装增强剂系统 Phase 2A（仅制造侧，不含六槽装备/计时/效果——留待 Phase 2B）：`js/data/boosters.js` 30 配方/10 系列/3 品质/5 档战术材料/6 槽定义；`js/data/base.js` 新增 `boosterEngineering` 技能（Lv.1 起）；`js/core/state.js` 初始化 `gameState.boosters={inventory,active(六槽恒 null),lastTick}`；`js/core/persistence.js` 新增 `migrateBoosterState` 幂等迁移（补字段/清 NaN·负·零库存/六槽恒 null，双路接入 autoLoad/importData）；`js/core/resources.js` 注册 `booster:` 命名空间（pool 特判 `state.boosters.inventory`）；`js/systems/manufacturing.js` 增制造分支（效率 1+lvl*0.02、单瓶产出、XP、连续制造、材料不足安全停止）；`js/core/tick.js` 在线、`js/core/offline.js` 离线共用单瓶语义；`js/core/events.js` 新增 `booster:manufactured` / `boosters:manufactured`（批量） / `combat:tacticalMaterialDropped` 三契约；`combat.js` 战斗掉落 5 档战术材料。
- UI：`js/ui/booster-render.js` 分类/品质筛选、配方网格、详情、库存卡片（中文名排序）、事件绑定；`js/ui/shell-render.js` 注册 `booster-panel`、`js/ui/render.js` 接入 updateUI/renderLoop、`index.html` 侧边栏「增强剂制造」+ 脚本（共 39 个）；纯显示态 `getBoosterManufacturingDisplayState` 全部字段建模。
- 经济规则锁定：每瓶持续 180s（`BOOSTER_DURATION_MS=180000`）仅作数据常量，Phase 2A 不计时/不应用效果；解锁等级 普通 Lv.1/4/7/10/13/16/20/24/28/32 → 精工 Lv.35/39/43/47/51/55/59/63/67/71 → 传奇 Lv.60/64/68/72/76/80/84/88/92/96；配方成本=行星产物+战术材料/气体，各 2 项。
- 验收：`tools/audit-boosters.mjs` 新建 A~ZB 共 28 区 658 断言全 PASS（数据30条/材料5档/技能/制造/在线离线一致/事件契约/迁移幂等/显示态/无Phase2B行为）；`tools/verify.mjs` 脚本数断言更新为 39、新增 audit-boosters 存在且调用真实系统哨兵、源级无 Phase 2B 行为检查，与行星哨兵同跑全 EXIT 0。
- 边界：不实装六槽装备/计时扣除/效果应用；不修改行星 Phase1 费用/Action/迁移/到期结算；不修改采矿/考古/武器伤害/维修数值；不修改星带敌人强度/掉落池/LP/势力数据；不触碰 `js/render3d/**`；未 commit/push。

### 行星开发 Phase 1：开发规则实装

- 实装行星开发 Phase 1（仅开发规则，不含增强剂/行星基地升级）：`js/data/planets.js` 六行星正式费用结构与 `id` 重命名（原 `type`）；`js/core/actions.js` 四 Action（`deploy`/`collect`/`renew`/`demolish`）重写 + dispatch 路由；`js/core/events.js` 新增 5 个行星事件契约；`js/systems/planetary.js` 与 `js/core/offline.js` 字段重命名 + 到期单次 `planetary:expired`；`js/core/selectors.js` 三状态显示态；`js/core/persistence.js` 新增 `normalizePlanetaryState` 旧档迁移（双路接入 autoLoad/importData）；`js/ui/planetary-render.js` 三态卡片 + renew/demolish 处理器；`index.html` 部署弹窗注释更新。
- 经济规则锁定：首次建设与重建均消耗 ISK + 三钛合金；续期只消耗 ISK（不再消耗三钛）；维护周期统一 24h（86400s）；到期后停产且不自动续期，需手动支付 ISK 续期并保留库存；主动拆除需先清空库存且**不返还任何资源**。
- 槽位固定最多 5 颗；六类行星随行星开发等级 Lv.1/1/20/40/60/80 解锁。旧动作名 `redeploy`/`remove` 彻底移除，新增 `renew`/`demolish` 路由；全工程无升级系统、无升级按钮、无占位 `costISK`/`costTrit` 字段。
- 旧档迁移：`normalizePlanetaryState` 幂等规范化（容器迁移、`type`→`planetType`、补 duration/lastTick/progress/storage、active 规范化、nextId 校正），安全回填 lastTick 不产生离线收益；autoLoad 内联迁移块替换为该调用，importData 迁移后接离线结算。
- 验收：`tools/verify.mjs` 新增数据驱动哨兵（六费用精确值、24h、无升级字段、旧动作已移除、新路由存在、续期不读 constructionCost、拆除零返还）+ 修复旧 `type` 字段与集成块旧 API；`tools/audit-planetary.mjs` 新建 A~Z 共 26 区 176 断言全 PASS。全 12 条回归（verify / audit-planetary / audit-industrial-productivity / audit-equipment-enhancement / audit-ship-enhancement / audit-rigs / audit-archaeology-system / audit-archaeology-ships / simulate-archaeology-user-flow / calculate-ship-production-times --verify 与 --audit-mixed-battleship / simulate-destroyer-belts）全部 EXIT 0。
- 增强剂（乙类 Buff）与行星基地升级按计划留待后续阶段，本阶段未实装；未修改任何已批准改装件数值、成功率公式、或 `js/render3d/**`。

## 2026-07-19

### 独立蓝图商店与首批混血驱逐舰

- 侧边栏新增独立“蓝图商店”，舰船工程原有护卫舰蓝图全部迁入；页面按舰船、联盟、势力及DED 2/10、3/10、4/10、6/10七类展示，并同时显示ISK与LP余额。
- 现有4件势力装备和48件死亡空间装备全部增加永久蓝图门槛，覆盖配方选择、制造启动、队列、在线Tick和离线结算。势力装备蓝图价格为来源星带2次肃清LP；死亡空间普通型与监督者型各自独立，价格为对应副本2次全通LP。
- 联盟装备保留此前按“获取对应势力数据过程中期望LP×2”确定的624/624/764/836 LP价格，只迁移购买入口，不更改其120%基础材料配方。
- 实装首批混血驱逐舰疾风级、血刺级、暗影级：舰船工程Lv.20，三类驱逐部件分别4/4/5件，镓10、铂8、对应低级加密数据15，组装60秒、90经验。15份数据按3高槽＋1主维修位完整势力装的75%折算；每张蓝图为同级星带10次肃清，即60 LP。
- 三艘混血驱逐舰总生命990、3高槽，主生命容量20%、对应武器伤害15%；其余槽位和既有路线属性沿用常规驱逐舰，不新增抗性、光环或新伤害类型。
- 考古、考古材料、蓝图碎片、残骸部件和数据核心从现行舰船制造需求中删除。考古系统尚未设计，后续不得用历史草案内容反向约束当前配方。
- 蓝图价格由来源星带/死亡空间LP配置自动推导；自动验证覆盖64张蓝图的分类数量、价格、所有权、双币种购买、制造锁，以及混血舰数据/月矿成本。
- 蓝图商店不展示“价格等于几次肃清/全通”等策划换算语言；每张卡直接预览可制造产物、舰体或装备属性、制造工程等级、耗时、经验及完整材料/前置装备消耗，蓝图购买价格单独显示。
- 首批混血驱逐舰完成10,000次固定种子校准：只调整既有闪避为疾风26、血刺12、暗影24，不改变总生命990、主防御20%、对应武器15%和三类部件配方。Lv.25成型配置同级肃清率为81.57%/82.76%/82.81%，Lv.30成熟配置为99.95%/99.32%/100%，三条路线越级0.4～0.3均为0%。
- 新增混血驱逐舰自动验收门槛：刚解锁不能稳定肃清、成型配置78%～86%且三路线差距不超过3个百分点、成熟配置同级不低于98%、下一档平均不得推进超过2波。
- 蓝图商店完成1440×900与760×900浏览器验收；修复窄窗口下蓝图面板被Flex压缩并截断的问题。DED 6/10的12张长材料卡片均无横向溢出或文字裁切，主内容区可以滚动到最后一张卡片。
- 从`eveidle.md`删除旧常规/混血/旗舰/工业舰六部件配方及映射，现行舰船统一使用三类集成部件；考古与旧蓝图研究章节仍作为未启用历史资料保留。

### 全星带死亡空间梯度定案

- 12条现有星带全部获得一一对应的死亡空间，按安全等级划分为2/10、3/10、4/10、6/10四档，每档包含天使、血袭者、萨沙三处；原有三处6/10保持不变，九处2/10、3/10、4/10现已全部实装。
- 战斗等级门槛依次为1、15、35、55；房间数依次为3、4、5、5。每层LP与全通追加分别为`1+9`、`1+18`、`2+30`、`3+45`，对应单次全通总LP 12、22、40、60。
- 所有密钥只由对应星带的精英和第20波BOSS以5%概率掉落；每条星带只掉自己的密钥。进入立即消耗，战败或撤离不返还，死亡空间内部不掉星带数据或新的门票。
- 各层监督者继续按85%～125%的基础曲线从来源星带BOSS缩放，最终层带2艘普通护卫、非最终层各带1艘普通护卫；12处副本再各自使用固定编队生命/伤害校准系数消除势力路线差异。系数不读取玩家技能、舰船或装备，不属于动态难度；全程不增加命中、抗性、控制等额外属性。
- 四档核心分别采用试制、强化、精锐、A型独立材料，不能合成、降级或跨档使用；各档单次全通期望核心依次为0.45、0.65、0.85、1.02，制造普通死亡空间装备分别需要2、4、6、10个核心。
- 最终监督者统一独立以2%概率掉落本势力、本档改良协议。协议也严格分档，避免通过刷低级死亡空间提前储备高级改良型装备材料。
- 装备路线固定为吉斯特激光/护盾、科尔普斯导弹/装甲、森屠斯射弹/结构；制造要求为同档T1底材、对应核心和常规生产材料。装备工程门槛依次为10、25、45、65，效果只提高伤害或维修量，不额外创造新属性。
- 普通死亡空间装备相对同档T1效果提高12%、20%、28%、35%；监督者改良型以对应死亡空间装备为底材，再消耗协议、额外核心与高级材料，伤害或维修量在前者基础上再提高10%。全程沿用同档基础装备的命中、燃料、弹药与槽位，不增加额外属性。
- 普通型装备工程等级/基础工时/经验依次为`10/30s/18XP`、`25/50s/32XP`、`45/80s/55XP`、`65/120s/90XP`；改良型在对应档位上提高5级，工时为1.4倍、经验为1.5倍。普通型额外材料按同档T1配方的1.0/1.5/2.0/2.5倍向上取整，改良型按基础材料倍率的75%且不低于1倍计算。
- 制造系统新增真实装备底材约束：普通型必须消耗1件未装配的同档T1装备，改良型必须消耗1件对应普通死亡空间装备；在线制造、离线结算、批量上限、队列和确认弹窗均共同校验并原子扣除底材。
- 依据当前星带编队和5%密钥概率，在副本全部成功的理想情况下，制造一件普通死亡空间装备约需肃清来源星带31、18、16、19次；`+10舰船＋T1装备`实测成本约为31～32、19～20、17、19～20次，失败耗票继续保留生产与战斗消耗。
- 死亡空间选择页已改为2/10、3/10、4/10、6/10四个档位标签，每个标签只显示三张势力卡，并动态展示门槛、密钥、来源、层数、LP、核心、协议和全通次数。
- 自动验证扩展到12处副本、48件死亡空间装备和全部特殊资源，覆盖四档数据、密钥不跨档、核心/协议概率、档位切换、底材扣除、装备效果、存档迁移和本地资源加载；浏览器验收未发现控制台错误。

### 死亡空间实装审计与资源闭环复核

- 新增`tools/audit-deathspaces.mjs`固定种子模拟器，按门槛`+0/T1`、成熟`+5/T1`、成熟`+10/T1`和成熟`+10/普通死亡空间装备`四套口径，逐房间统计12处死亡空间的通过率、监督者击毁率、核心/协议/LP期望、密钥与来源星带肃清成本，以及燃料、弹药和回合数。
- 最终强度标准定为：刚达到战斗等级门槛不能稳定全通；成熟同级技能下，`+5舰船＋基础T1装备`全通率45%～55%，`+10舰船＋基础T1装备`全通率85%～95%，`+10舰船＋普通死亡空间装备`不低于98%。装备本身没有`+5/+10`，强化等级始终只属于舰船。
- 12处副本已使用每处固定、与玩家状态无关的编队生命/伤害系数完成校准。10,000次固定种子复核中，`+5/T1`实际为48.3%～54.0%，`+10/T1`为85.5%～94.5%，普通死亡空间装备为99.79%～100%；成熟装配的前置房间通过率不低于99%，最终层保持为主要通关门槛。
- 原“31/18/16/19次星带肃清制造一件普通死亡空间装备”继续标记为“密钥与副本均成功”的理论下限；按校准后的`+5/T1`计算约为39～41、23～24、20、22～23次，按`+10/T1`约为31～32、19～20、17、19～20次。
- 自动验证现已逐件覆盖24件普通死亡空间装备和24件监督者装备：完整验证T1底材→普通型→监督者型两段制造、在线原子扣料、离线结算、仓库展示和真实战斗属性，确认48条装备资源链均可闭环。
- 使用真实存档`EVE_Save.json`完成回归：3艘舰船、77项注册资源、30个JavaScript、4个CSS、201个DOM ID及全部本地资源加载通过；驱逐/巡洋/战列舰星带模拟和舰船生产工时未发生回归。
- 战斗面板在窄窗口下恢复页面纵向滚动；普通星带交战期间可以切换查看死亡空间档位、密钥与奖励信息，但开始按钮保持禁用，查看行为不会替换当前敌人或改变实际战斗状态。
- 按本日决定，暂不为其余星带新增占位装备；继续保留已定案的4组势力/联盟装备，待死亡空间强度和现有资源闭环稳定后再讨论新装备。

### 后续：死亡空间装备强化

- 普通死亡空间装备和监督者装备一旦制造完成，后续仍需要持续刷取价值；计划为这两类装备增加独立强化模块，使重复获得的校准核心、改良协议和同类装备能够继续形成长期消耗。
- 该系统以后单独设计，本轮不实装，也不直接套用舰船强化的成功率、失败清零或五级里程碑规则。正式开发前需要先确定强化属性、材料结构、成功率、失败代价和普通型/监督者型之间的继承关系。
- 装备强化不得反向成为首次通关死亡空间的必要条件；当前平衡继续以`+5/T1`约50%、`+10/T1`约90%为基准，死亡空间装备负责将副本提升到接近稳定通关。

## 2026-07-18

### 星带装备统一为数据制造与联盟永久蓝图

- 固化所有星带装备的双路线：星带只掉落按“势力×安全等级”分层的制造数据，势力装备由基础材料和专属数据制造；LP商店不再直接发放联盟装备成品，只出售永久制造蓝图。联盟版与对应势力版同属性、同等级、同耗时、同经验，删除数据后将每项基础材料提高20%，非整数向上取整。
- 12条现有星带全部绑定唯一数据：三势力分别拥有初级、低级、中级、高级四档材料。旧版来源不明的“天使联合加密数据”只保守迁移为天使初级数据，不升级成可制造现有低级装备的数据；旧存档已持有的联盟装备成品继续保留，但不自动授予蓝图。
- 当前四件已定案势力装备全部完成联盟对应物：天使联合采矿激光器/联盟采矿激光器、天使联合气云采集器/联盟气云采集器、血仆无人机指挥链路/联盟无人机指挥链路、矿物同化注入器/联盟矿物同化注入器。没有为其余星带临时创造未商定属性的占位装备。
- 蓝图价格由完整掉落分布计算首次集齐数据的期望肃清次数，再按`四舍五入(期望肃清次数×肃清LP)×2`定价：两件天使低级装备均为624 LP，血袭者中级装备为764 LP，萨沙高级装备为836 LP。联盟配方依次为`120/48`、`120/15`、`420/144/24`、`1320/60/6/30`，均不消耗势力数据。
- 蓝图锁覆盖配方选择、制造确认、队列添加、在线制造与离线结算；重复购买被拒绝。自动验证会从星带编队、精英/BOSS掉率、数据需求与肃清LP重新计算期望价格，并校验四组同属性、120%材料、数据隔离、旧资源迁移和战斗核心不直接写入装备仓库。

### 成就系统后续安排

- 成就系统暂缓，不进入当前0.0资源闭环与战斗内容的首批开发范围；先保证新资源从产出、加工、制造到持续消耗能够独立闭环。
- 后续成就只作为`GameEvents`的只读消费者实现，不让采矿、制造、战斗或舰船强化核心反向依赖成就系统；现有“统计档案”继续承担数据观察与规则校验用途。
- 正式开工前需要先确定旧存档是否追溯、分级/隐藏成就规则、奖励发放方式和幂等结算策略，避免读档、离线补算或重复事件造成重复奖励。

### 0.0资源闭环定案与6/10死亡空间实装

- 0.0推进顺序修正为：低安阶段提供可选的混血驱逐舰、巡洋舰和战列舰路线；完成0.1低安后直接以Lv.80旗舰进入0.0，Lv.90+超级旗舰承担0.0终局。考古尚未设计，不作为旗舰或超级旗舰制造条件。
- 0.2～0.1精英/BOSS继续产出既有势力加密数据；基础矿物、行星产物、高级月矿、加密数据和后续舰体核心共同构成T2/混血战列舰的制造闭环。死亡空间密钥只负责独立副本准入，不作为T2/混血战列舰的强制制造材料，避免随机门票卡死主线。
- 势力加密数据改为“势力×安全等级”双重分层：每档星带只掉落本势力、本档数据，高级星带不回落掉低级数据，低级数据也不能合成或兑换为高级数据；每件势力装备只接受与自身制造等级对应的数据，禁止通过长期刷低级星带提前储备未来高级装备材料。
- 数据层级现按1.0～0.8初级数据、0.7～0.5低级数据、0.4～0.3中级数据、0.2～0.1高级数据划分，并分别带天使、血袭者或萨沙势力前缀；0.0深空核心数据仍待后续实装。旧版天使联合数据已按保守原则迁移为天使初级数据，不会升级成低级或更高档材料。
- 0.0外环BOSS开始产出莫尔石和旗舰核心；二者与基础矿物、月矿、行星产物共同用于三部件制旗舰。莫尔石与高级月矿只作为关键催化材料，实际数量必须按完整采集/加工/制造工时校准，不能沿用旧草案的大宗消耗量。
- 强度基准后续按“旗舰是进入0.0门槛、超级旗舰是征服0.0目标”重新设计；旧版“+10 T1战列舰试探0.0、T2/混血战列舰稳定入场”的口径废止。
- 战斗等级80/90保留为外环/内环候选门槛，但需要在T2/混血战列舰、异常空间和0.2～0.1经验供给完成后统一验证，避免Lv.55到Lv.80之间形成无内容成长区间。
- 已实装天使6/10军事复合体、血袭者6/10海军造船厂、萨沙6/10战争设施。三处均要求战斗等级55，并分别由对应0.2～0.1星带的精英或BOSS以5%概率掉落专属通行密钥；每张密钥只提供一次进入机会，进入时立即消耗，战败或主动撤离均不返还。
- 每处死亡空间固定5层。第1～5层监督者相对来源星带BOSS的生命与伤害倍率依次为85%、95%、105%、115%、125%，前四层各带1艘普通护卫，最终层带2艘普通护卫；最终监督者自身生命与伤害同时提高25%，综合威胁约为来源星带BOSS的156%，仍需用真实装配继续做通过率校准。
- 每层肃清立即结算3 LP，五层共15 LP；完整通过后额外结算45 LP，即单次全通共60 LP。该奖励不改变普通星带精英不掉LP、普通星带只在第20波完整肃清时结算LP的规则。
- 撤销“死亡空间直接掉落完整A型/监督者装备”的早期方案。参考《银河奶牛放置》中观察者之眼、恶魔核心和巨像核心的闭环，战斗只提供无法由生产替代的稀有核心，最终装备必须继续消耗上一代装备、常规生产材料并满足装备工程等级后制造，避免数次战斗直接跳过生产成长。
- 三势力监督者分别掉落吉斯特、科尔普斯、森屠斯A型校准核心，各层概率依次为12%、15%、18%、22%、35%；最终监督者还独立以2%概率掉落对应改良协议。核心与协议只进入特殊材料库存，不直接发放装备。
- 6/10成品方向保留为吉斯特A型大型激光炮/护盾回充器、科尔普斯A型巡航导弹发射器/装甲维修器、森屠斯A型大型射弹炮/结构修理器。该项在本日记录时仍待校准，现已按2026-07-19定案的底材、核心、属性、工时和经验规则实装。
- 战斗页新增“普通星带/死亡空间”双模式、密钥库存与来源展示、全通次数、动态层数和稀有收获提示；全通后自动结束攻略并恢复舰船状态。存档迁移会补齐模式、选中副本、全通记录和全部密钥/核心/协议资源。
- 新增死亡空间单层/全通事件契约及统计消费者，自动验证覆盖密钥5%边界、核心/协议概率边界、入场扣票、撤离不退款、最终层编队、五层推进和15+45 LP结算。

### 统计档案与战斗技能折叠

- 新增只读“统计档案”页面，直接消费`GameEvents`统计快照，展示航行生涯、生产、战斗、舰船强化四组总览，以及采集、冶炼、制造、星带肃清、星带击毁和势力击毁排行。
- 页面明确说明统计只从统计消费者启用后累计，不根据旧存档当前库存反推历史产量；统计UI不参与奖励与核心结算。
- 侧边栏十项具体战斗技能默认折叠；点击“战斗”同时进入战斗页并展开/收起技能组，展开状态作为界面偏好随存档保存。
- 清理本文件与策划案仍在使用的旧六部件数量和旧全链路时间口径；当前统一以三类部件、护卫6件/驱逐10件/巡洋13件/战列16件为准。

### 舰船强化确认设置

- 原侧边栏“设置”入口补齐独立设置页面，首项加入“舰船强化确认提示”开关。
- 开关默认开启；开启时强化已有等级的舰船仍会确认失败清零风险，关闭后直接执行强化。`+0→+1`继续沿用原本无需确认的行为。
- 设置通过状态动作修改并随存档保存；旧存档和不含设置字段的导入档自动补为开启，不改变强化材料、成功率与结果结算。

### 三部件舰船工程与无限强化系统

- 舰船部件由原来的六类（T1工业线八类）合并为三类：综合舰体组件、动力控制核心、舰船功能组件；每个已实装舰级只保留三种配方，战斗舰与工业舰共用。
- 新部件的材料、工时和经验由旧部件组合校准；单套部件生产经验仍为护卫86、驱逐148、巡洋275、战列425。整船改为护卫6件、驱逐10件、巡洋13件、战列16件，完整工时分别约2小时02分、3小时29分、5小时06分和9小时16分，继续满足既定预算。
- 新增按舰船实例保存的无限强化等级。每次消耗同级三种部件各1件；成功升1级，失败直接清零，不损毁舰船。
  > **已由 2026-07-24 规则废止**：失败改为等级保持（不清零）、0 XP（无失败经验）。成功率改为与装备强化共用边际递减公式、范围5%～80%。详见下文"2026-07-24 舰船强化与装备强化共用边际成功率"。
- 强化成功率固定为`50% + 舰船工程超门槛等级×2% - 当前强化等级×1%`，并限制在5%～95%；刚达到制造门槛时`+0→+1`为50%。
  > **已由 2026-07-24 规则废止**：改用边际递减公式，详见下。
- 战斗舰强化接入最终生命与对应武器伤害乘区；普通级为生命+0.5%/伤害+0.25%，5倍数级为生命+3%/伤害+1.5%。工业舰不获得生命值，只接入最终采矿或采气效率；普通级+0.75%，5倍数级+4.5%。
- 取消强化上限与认证经验。成功经验随成功后的高强化等级线性提高；失败经验固定为`0→1`成功经验的一半。基础经验取同级三件部件生产经验的50%，确保部件生产仍贡献约六成以上的升级经验。
  > **已由 2026-07-24 规则废止**：失败 XP 改为 0（与装备强化一致）。
- 船坞卡片新增强化等级、累计收益、下一等级/里程碑、三种材料库存、成功率、成功/失败经验、失败清零提示和强化按钮；正在战斗或采集的舰船不能强化。
- 新增`ship:enhancementAttempted`事件契约及强化次数、成功、失败、部件消耗和历史最高等级统计。
- 新增`shipComponentsV2`存档迁移：旧部件库存、当前/运行制造目标和队列任务自动折算到三类新部件；旧舰船实例自动补齐`enhancementLevel:0`。
- 自动验证覆盖三部件数量与生产经验、线性概率边界、5倍数收益、三件扣料、失败清零、经验结算、工业最终效率乘区、战斗生命/伤害乘区和旧存档迁移。用户真实存档回归通过：3艘舰船、32类注册资源正常。
- 浏览器验收通过：战斗舰与工业舰的强化说明正确分流，材料不足按钮禁用，成功率、经验和里程碑预览均正常显示。
- 新增`tools/audit-ship-enhancement.mjs`长期成本审计，直接复用实际强化规则计算各舰级在不同舰船工程等级下达到`+5/+10/+15`所需的期望尝试、部件和经验；该工具只暴露经济曲线，不自动修改已定数值。
- 审计确认概率曲线按“舰船工程超出制造门槛的等级”形成清晰阶段：门槛等级达到`+5`约75次、`+10`约5266次；高出10级分别约19/215次；高出25级分别约6/15次，`+15`约36次。暂不修改定案公式，中高强化明确留给制造技能成熟阶段。

### T1战列舰与大型战斗装备

- 舰船工程Lv.55新增曜光级、堡隼级、震锋级三艘T1战列舰；当前统一使用三种专用集成部件、每舰16件，100秒组装、160经验，本阶段继续免蓝图。
- 三舰总基础生命均为3600、高槽均为5，延续激光/护盾、导弹/装甲、射弹/结构三条等价路线；主防御容量、武器伤害、命中、燃料效率及维修专精均接入实际战斗公式。
- 装备工程Lv.55新增大型激光炮、巡航导弹发射器、大型射弹炮，以及大型护盾、装甲、结构维修器；完整维修装配计入舰体专精后三条路线均为每轮600点基础维修。
- 按“矿物采集与冶炼L+10、行星与制造L”的完整链路核算，曜光级、堡隼级、震锋级分别约9小时08分01秒、9小时08分06秒、9小时06分58秒，全部进入8～10小时预算。
- 全链路计算器与自动验证扩展到Lv.55，锁定33部件、逐舰材料总计、制造时间预算、大型装备材料跨度和战列舰属性。

### 0.2～0.1战列舰星带

- 新增天使破阵战场、血袭者铁血圣殿、萨沙统御矩阵三条0.2～0.1星带，要求战斗等级55；编队概率为20%/30%/30%/20%，第20波固定BOSS＋普通护卫。
- 区域奖励为15 LP、ISK 2.5×、燃料1.6×；普通怪不掉加密数据，精英/BOSS概率为3%/8%。
- 新增三势力普通、精英、BOSS共9种战列级敌舰。敌人继续使用固定属性，不增加随波次变化的隐藏倍率；BOSS威胁按不低于三只普通敌舰的原则单独校准。
- 固定种子模拟新增战列舰快速模式。入门配置平均推进6.75/8.49/10.06波且无法肃清；成熟配置三条星带20波肃清率为38.13%/38.34%/32.09%，符合30%～40%的同级成熟标尺。
- 自动验证覆盖战斗等级55门槛、深低安编队概率、第20波BOSS、奖励倍率、加密数据概率和固定敌舰属性。

### 玩家存档战列准备度与补给审计

- 新增 `tools/audit-battleship-readiness.mjs`，可直接读取玩家存档，输出采矿、冶炼、行星、舰船工程、装备工程和战斗等级缺口，并分别计算三条战列路线的船体与满装材料缺口。
- 审计会把已有矿石按目标Lv.55冶炼产出折算，避免把尚未冶炼的库存误判为材料不足；本次存档的真实瓶颈为超新星诺克石、等离子体和少量同位聚合体，基础矿物及三类旧行星材料均已充足。
- 固定种子模拟开始统计成功局回合数、真实逐模块燃料取整、维修触发燃料和弹药消耗；支持 `--save <存档>`，直接显示当前补给库存约能支持多少次完整肃清。
- 成熟战列成功局平均补给为：曜光级5616燃料/634激光弹，堡隼级2617燃料/689导弹，震锋级7529燃料/764炮台弹。玩家存档燃料充足，当前弹药分别只支持约0.40/1.42/0.65次完整肃清；弹药制造耗时很短，因此不调整武器消耗公式。
- 玩家存档再次通过旧存档迁移和全部View State纯度回归：3艘舰船、35类已注册资源均正常，未发现需要修改存档结构或制造页面布局的问题。

### 战斗等级命名与侧边栏收口

- “CL”统一更名为“战斗等级”；星带门槛、战斗面板、按钮状态和错误提示不再显示英文缩写。
- 侧边栏“战斗”不再读取旧的独立 `skills.combat` 击杀经验等级，改为实时显示“最高攻击技能与最高防御技能平均后向下取整”的战斗等级。
- 悬停侧边栏战斗等级会列出公式、当前最高攻击、当前最高防御和最终代入结果；废弃字段继续保留用于旧存档兼容，但击杀不再增加该字段经验。
- 自动验证锁定派生等级显示、公式提示和旧战斗经验停止增长，避免两套战斗等级再次并存。

### 采矿目标卡片可读性

- 普通矿带与月球矿带共用的目标卡片增大名称、等级/耗时/经验和状态字号，并提高辅助文字亮度与行高。
- “已选择”“可采集”“需要等级”以及页面下方采集条件使用更明亮的状态色；卡片略微增高，避免放大文字后产生拥挤。
- 增加统一科技字体栈：英文与数字优先Orbitron/Bahnschrift，中文优先等线体；矿带标签、矿物名称、参数和状态加入克制字距与微弱辉光，正文继续保持易读。
- 根据实际桌面预览再次放大矿带标签、矿物名称、参数、状态和采集条件，并同步增加卡片高度，确保高分辨率界面仍能一眼读清。

### 常规舰制造材料跨度与全链路工时重算

- 全链路时间计算器扩展到全部已实装常规舰，并采用新口径：舰船工程等级为L时，允许使用采矿/冶炼门槛不高于L+10的矿物，采矿与冶炼按L+10效率计算；行星开发和舰船制造仍按L计算。
- 水硼砂/类晶体胶矿恢复Lv.20，斜长岩/同位聚合体恢复Lv.40，不再为了同级制造压低矿物的自然解锁门槛；护卫舰部件重新加入Lv.10类银超金属，使材料层次与矿区成长一致。
- 三种巡洋舰集成部件按完整采矿、冶炼和制造时间重新缩放；无额外舰船/装备加成时，三艘巡洋舰当前均约5小时06分50秒。
- 新口径下五艘护卫舰完整工时约2小时02分～2小时06分；驱逐舰矿物成本进一步上调并平衡部件工时权重，雷光级、矛隼级、疾锋级分别约3小时29分44秒、3小时29分47秒、3小时29分51秒；巡洋舰仍维持4～6小时预算。
- 重型气云采集器与高级无人机指挥链路移除错误的Lv.55高纯富勒烯需求，改用Lv.20稳定富勒烯；自动验证新增Lv.35装备材料审计，并锁定“矿物/气体最多高10级、行星产物不高于制造等级”的规则。

## 2026-07-17

### 护卫舰与驱逐舰全链路工时校准

- 统一采用“从零库存开始，采矿、冶炼、行星和舰船工程与目标舰同级”的核算口径；主动采矿、冶炼、部件制造、整船组装顺序累计，行星产物按槽位并行计算关键路径，不计额外舰船或装备加成。
- 护卫舰Lv.1部件取消无法同级采集的类银超金属，按等价采集时间折算为三钛合金；五艘护卫舰完整工时为2小时07分～2小时11分。
- 驱逐舰部件材料量按完整生产链重新压缩，保留三钛、类银、类晶体和基础行星产物；三艘驱逐舰完整工时为2小时42分～2小时51分。
- 水硼砂及类晶体胶矿的采矿/冶炼门槛由Lv.20调整为Lv.15，使驱逐舰在同级技能条件下能够完全自给。
- 新增 `tools/calculate-ship-production-times.mjs`，逐舰输出采矿、冶炼、制造、行星关键路径和总工时；自动测试锁定同级自给与2～3小时预算。

### ResourceRegistry第二阶段与确认弹窗收口

- 新增 `getActionConfirmationDisplayState()`，统一生成采矿、冶炼、采气、装备工程、舰船部件和整船合成的标题、耗时、产物、材料库存、最大次数、门槛及队列任务快照。
- `js/ui/action-modal.js` 不再自行读取资源池、查找配方或计算制造公式，只渲染确认View State并派发已经冻结的队列数据。
- 确认弹窗在打开时保存稳定快照；提交时不再重新读取当前下拉选择，因此制造中切换查看其他配方不会替换本次产物。
- 顶部快捷矿石和舰船工程部件库存摘要改为通过 `ResourceRegistry.listStateEntries()` 读取；除 `persistence.js` 存档迁移边界外，业务代码中已无旧资源池直接读写。
- `persistence.js` 增加迁移边界说明，明确旧 `resources.*` 字段只允许在存档整理时直接处理，业务层继续保留兼容型Registry映射，不强制改写玩家存档结构。
- `ARCHITECTURE.md` 补充ResourceRegistry、GameEvents、CombatModifiers、RuntimeGuard和错误边界的职责、依赖规则及自动守卫要求。

### 自动测试与真实存档回归

- 自动测试新增确认View State纯度、跨命名空间库存汇总、确认快照稳定性和UI禁止配方重算检查。
- `tools/verify.mjs` 支持可选真实存档参数：`node tools/verify.mjs <EVE_Save.json>`，导入后逐一生成全局、制造、战斗、仓库、船坞、队列和确认弹窗View State，并验证选择器不修改存档。
- 用户存档 `EVE_Save.json` 回归通过：3艘舰船、35类已注册资源均可正常迁移与读取；全量验证通过28个JS、4个CSS、187个DOM ID，全部本地资源HTTP 200。
- 真实浏览器验证装备制造目标锁定：运行“轻型导弹发射器 I”时切换查看“小型激光炮 I”，完成产物仍为导弹发射器，队列和进度正确清空；舰船部件与整船合成确认弹窗库存正常，控制台无警告或错误。
- 驱逐舰固定种子模拟结果保持不变：当前高安肃清率100%；三条0.7～0.5星带成熟配置肃清率为31.55% / 38.76% / 38.10%。

### GameEvents事件契约与首个消费者

- `GameEvents` 统一为不可变事件信封，固定 `schemaVersion`、`eventId`、`type`、`timestamp`、`payload`、`meta`、契约状态等字段；`meta` 统一区分在线、离线聚合、来源和运行批次。
- 为采矿、冶炼、采气、行星产出、三类制造、敌人击杀、波次完成、星带肃清、爆船、技能升级及现有内部通知登记事件契约；无效事件会被RuntimeGuard记录且不会分发。
- 在线单周期事件自动补齐 `cycles:1`；离线结算以批次 `runId` 生成稳定事件ID，并继续只发布一次聚合事件。
- 行星在线和离线产出补充 `planetary:completed` 事件，统计来源覆盖全部现有生产系统。
- 新增 `GameEvents.onIdempotent()`；消费者使用 `consumerId:eventId` 去重，并只保留最近512条处理记录，避免存档无限膨胀。
- 新增 `js/core/statistics.js` 作为首个只读消费者，累计采矿、冶炼、采气、行星、制造、造船、击杀、精英/BOSS、波次、肃清、爆船、升级及在线/离线次数；统计不参与奖励和数值计算。
- 旧存档导入时自动补齐统计结构但不伪造历史累计；调试入口 `GameStatistics.snapshot()` 返回独立副本。
- 自动测试覆盖统一信封、不可变事件、无效契约拦截、所有静态发布点契约登记、重复eventId幂等、离线runId、在线行星产出、消费者UI隔离和旧存档迁移。
- 全量验证通过29个JS、4个CSS、187个DOM ID；用户旧存档3艘舰船、35类资源及统计兼容结构回归通过。驱逐舰固定种子模拟结果不变。

### 巡洋舰与0.4～0.3星带首批内容

- 舰船工程Lv.35新增曙光级、战隼级、烈锋级三艘T1巡洋舰，以及三种巡洋舰集成部件；三舰均使用13个部件、70秒组装、100经验，本阶段继续免蓝图。
- 三舰总基础生命均为1800、高槽均为4，延续激光/护盾、导弹/装甲、射弹/结构三条路线；容量、伤害、命中、燃料效率和维修专精均接入既有真实战斗公式。
- 装备工程Lv.35新增中型激光炮、重型导弹发射器、中型射弹炮，以及中型护盾、装甲、结构维修器；三条完整维修装配继续按效能归一。
- 新增天使猎杀空域、血袭者深红圣堂、萨沙同化枢纽三条0.4～0.3星带，要求CL35；编队概率为25%/35%/25%/15%，第20波固定BOSS＋普通护卫。
- 区域奖励为10 LP、ISK 2×、燃料1.4×；普通怪不掉加密数据，精英/BOSS概率为2%/6%。
- 固定种子模拟保持旧两档结果不变；零技能全装巡洋舰100%肃清0.7～0.5，入门巡洋舰在新星带约第8波止步，成熟巡洋舰肃清率约33%～40%。
- 自动验证覆盖巡洋舰材料总计、免蓝图组装、中型装备制造入口、舰体属性、CL35门槛、低安编队概率、BOSS编队、掉落概率和固定敌舰属性。

### 下一步（更新）

1. 下一包优先补齐战列舰的实际资源消耗体验：使用玩家存档检查Lv.55材料可达性、燃料与弹药续航、制造页面信息密度，并只在确有偏差时调整内容数据。
2. 战斗主线下一阶段进入0.0前置设计：先确定T2/混血舰船、月矿与战斗掉落的资源闭环，再决定战斗等级80/90门槛和旗舰级装备，不直接堆叠更高面板。
3. 只读统计页面已于2026-07-18完成；成就/任务暂缓到0.0资源闭环形成并完成首轮数值验证之后，届时消费者仍只订阅现有GameEvents契约，不侵入核心结算。

## 2026-07-15

### 月球矿带第一阶段

- 采矿目标拆为“普通矿带”和“月球矿带”两个子页面，使用横向单排卡片选择目标；窄窗口保持单排并提供横向滚动。
- 月矿与普通矿共享采矿技能、经验、效率、舰船、装备和行动槽，解锁镓、铂、铪、锇、钷、铷六种月矿。
- 月矿经验效率按设计低于相同门槛的普通矿；采集月矿还要求为采矿任务分配舰船并在高槽装配采矿激光器。
- 月矿进入独立仓库分类，在线采集、离线结算、队列、制造材料读取和仓库容量统计均已接通。
- 旧存档中的铷自动迁移到月矿仓库；普通矿与月矿分别记忆上次选择。
- 采集中切换矿带页面或选择其他矿物不会改变运行中的目标、产物与进度耗时，只影响下一次行动。
- 自动验证覆盖月矿参数、较低经验效率、独立入库和运行目标锁定；真实浏览器验证桌面与 800px 窄窗口均保持单排，控制台无错误。

### 装备工程分类与高级采集装备

- 装备工程改为工业采集、无人机、武器系统、防御维修、燃料、弹药六个用途分类，不再单列势力装备。
- 势力装备按实际用途归类：血仆无人机指挥链路进入无人机，矿物同化注入器进入工业采集。
- 补齐 T2～T5 采矿激光器和气云采集器的等级、效率、材料、耗时与经验配置。
- 增加最小可用 LP 商店；掠夺者采矿激光器与掠夺者气云采集器暂以 1 LP 直接兑换并进入装备仓库。
- 自动验证覆盖高级采集装备分类、势力装备用途归类、LP 扣除与商品入库。

## 2026-07-13

### 模块化拆分

- 将单文件版本拆分为 `index.html`、4 个 CSS 文件和 17 个 JavaScript 模块。
- 建立 `data`、`core`、`systems`、`ui`、`tools` 目录结构。
- 保留根目录 `index.html`、`DEVLOG.md`、`eveidle.md` 不变。
- 增加 `tools/verify.mjs`，检查脚本语法、DOM ID、本地资源和 HTTP 加载。

### 舰船与装备

- 舰船增加唯一实例 ID，同型号多艘舰船可以独立分配任务。
- 装备由全局 `equipment.fitted` 改为按舰船实例保存，切换舰船不再覆盖其他舰船的装配。
- 采矿、采气和战斗读取各自任务所分配舰船的装备。
- 增加旧存档迁移，将全局装配安全迁移到舰船；无法直接迁移的装备退回库存。
- 新制造的舰船自动生成独立实例 ID 和空装备槽。

### 装备工程与弹药工程合并

- 修正装备工程确认弹窗，正确显示配方、材料、耗时、产物和最大制造数量。
- 装备工程队列改为保存稳定的配方 ID，可在存档和离线结算中恢复正确目标。
- 将燃料与弹药配方合并到装备工程，移除弹药工程侧栏入口和独立面板。
- 装备工程统一制造可装配装备、燃料和三类武器弹药，并统一获得装备工程经验。
- 增加旧弹药工程存档迁移：技能进度、当前行动、队列任务和舰船任务分配自动并入装备工程。

### 队列与离线结算

- 有限队列显示真实剩余次数；每完成一次在线或离线行动立即减 1。
- 有限队列归零后自动删除当前项，并启动下一项。
- 同类任务追加次数时同步更新当前行动剩余数量。
- 离线期间可按顺序推进采矿、冶炼、采气、舰船工程和装备工程队列。
- 离线装备制造会正确产出装备、燃料或弹药。
- 行星离线结算改为独立执行；没有主动技能时仍会补算行星产出。

### 性能优化

- 主动技能进度条由约 60 FPS 限制为约 10 FPS。
- 行星 Canvas 动画由约 60 FPS 限制为约 15 FPS，并按实际经过时间保持旋转速度。
- 页面隐藏时暂停进度条和行星 Canvas 绘制。
- `gameTick` 不再每秒调用完整 `updateUI()`，改用轻量实时刷新资源、仓库、侧栏、行星和战斗动态字段。
- 行星页面不再每秒销毁并重建全部卡片；倒计时、库存、状态和按钮改为局部更新。
- 战斗 tick 使用轻量刷新，不再每秒重建星带菜单、维修开关和玩家舰船节点。
- 完整面板只在制造完成、页面切换及其他结构变化时重建。

### 验证结果

- 静态验证通过：17 个 JS、4 个 CSS、168 个 DOM ID，全部本地资源 HTTP 200。
- 自动测试覆盖有限队列递减、完成删除、离线队列、三类装备工程产物、旧弹药工程迁移、空闲 tick 轻量刷新、行星局部刷新和战斗轻量刷新。
- 真实浏览器验证通过：装备/燃料/弹药配方合并正常，有限采集队列正常出队，顶部仓库与资源显示正常更新，控制台无页面错误。

### 待处理

- 仓库页面尚未展示制造出的可装配装备，目前主要展示舰船部件。
- 需要在带有多颗已部署行星和长时间战斗的真实存档上继续观察性能与刷新完整性。
- Netlify 若仍发布项目根目录，会运行旧版单文件；部署目录应切换为 `eveidle-modular`。

## 2026-07-14

### 仓库与装备属性

- 仓库开始展示实际制造出的可装配装备，不再只显示舰船部件。
- 装备条目增加属性说明，可查看槽位、需求等级和具体加成。
- 装备工程的“产出：装备名”增加属性 hover，制造前即可确认成品效果。
- 制造效率 hover 改为读取当前舰船的逐舰装配，展示舰体与已安装装备共同形成的实际效率。
- 补充采矿侧栏图标。

### 工业装备与效率公式

- 采矿提升器不再直接增加采矿总效率，改为放大已安装采矿激光器的效能。
- 采气提升器同理，只放大已安装气云采集器的效能。
- 完成 T1～T5 采矿激光器、气云采集器的等级、加成与制造材料配置。
- 增加 T2.5 掠夺者装备，使用战斗掉落的势力加密数据制造；海军装备暂以 1 LP 占位，等待 LP 商店实现。
- 完成无人机指挥链路与采矿提升器的高级成长线，包括血袭者“血仆无人机指挥链路”和萨沙“矿物同化注入器”。
- 势力装备不由敌人直接掉落；战斗只掉落势力加密数据，装备仍需通过装备工程制造。

### 战斗 HUD 第一阶段

- 战斗区改为战术 HUD：左侧玩家舰船、中央锁定器、右侧敌舰；待命时敌方区域保持扫描占位，不再整块消失。
- 新增 EVE 风格舰船控制台：中央使用三层环带显示护盾、装甲和结构，右侧显示当前战斗舰的逐舰装备槽。
- 武器与维修控制集中到控制台区域，装备栏为后续战斗舰“舰体＋装备”拆分预留结构。
- “开始战斗”从面板底部移动到标题区域，改为醒目的金色按钮；交战后原位置切换为“停止战斗”。
- CL 与战斗技能等级明确归入左侧“舰长数据”，与“舰船补给”排列在一起，不再产生属于敌方数据的视觉误解。
- 移除战斗 HUD 中“可能未命中”的表达；当前战斗为确定性伤害，没有 MISS 判定。
- 技能说明同步改为伤害、伤害应用和受到伤害降低等确定性描述。
- 桌面和 390×844 手机布局均完成实际浏览器验证。

### 战斗舰拆分策划（第二阶段，尚未实现）

- 战斗舰将与工业舰统一，使用舰船实例自己的 `fitted` 保存装备；不建立第二套装配数据。
- 舰体只提供基础护盾/装甲/结构、槽位、伤害应用/规避和舰体专精；武器伤害与主动维修能力来自真实装备。
- 沿用当前确定性伤害公式：`命中^1.4 / (命中^1.4 + 闪避^1.4)`，该系数只影响伤害数值，不进行未命中判定；克制正确承伤层时为 1.25 倍。
- 战斗全面采用固定交替回合：玩家所有已安装武器攻击一次，随后敌人攻击一次，再处理维修装备。
- 不设计武器攻击周期、攻击速度、冷却、抢先手或锁定等待时间，对标银河奶牛放置的回合式放置战斗。
- 所有已安装武器默认参与玩家攻击，不设置武器启用开关；本回合总燃料不足时，玩家整次攻击无法发动。
- 战斗系统没有电容资源、容量或恢复；燃料是武器与维修装备的唯一能源消耗。
- 护盾型、装甲型、结构型舰船分别获得对应护盾回充器、装甲维修器、结构修理器 20% 效用加成。
- 主动维修装备保留护盾回充器、装甲维修器和结构修理器；没有安装对应装备时不能主动修复该生命层。
- 后续需要将当前全局武器选择和固定维修按钮替换为已安装装备，并为旧存档中的新手舰补发或迁移基础配装。

### 验证结果

- 静态验证通过：17 个 JS、4 个 CSS、176 个 DOM ID，全部本地资源 HTTP 200。
- 战斗待命、开始战斗、停止战斗、敌舰生成、环形生命值和逐舰装备栏均通过真实浏览器检查。
- 桌面与手机断点均能正确显示战场、舰长数据和战斗控制；页面日志未发现游戏脚本错误。

### 下一步建议

1. 为战斗武器、三类主动维修装备建立统一装备数据与制造配方。
2. 建立“舰体＋装备＋技能”的战斗属性汇总函数。
3. 将玩家回合改为遍历当前战斗舰的全部已安装武器，并实现整次攻击燃料检查。
4. 将固定维修逻辑改为读取舰船已安装的护盾、装甲和结构维修装备。
5. 设计旧存档默认配装迁移，确保已有裂谷级、茶隼级和阿特龙级仍可直接战斗。

## 2026-07-15

### 战斗装备导入（第二阶段第一期）

- 装备工程新增六件 T1 战斗装备：小型激光炮、轻型导弹发射器、小型射弹炮，以及护盾、装甲、结构三类主动维修装备。
- 战斗改为读取当前舰船实例的真实 `fitted`：所有已安装武器组成一次齐射，整轮检查并扣除燃料和对应弹药。
- 玩家先手击毁敌舰后，敌舰不再进行本轮反击；未安装武器、燃料不足或弹药不足时会显示明确状态。
- 三类维修不再使用固定开关，只由舰船实际安装的维修装备自动触发。
- 战斗 HUD 移除全局武器选择，显示真实武器、维修模块、齐射伤害和逐舰装备详情。

### 爆船与维修规则

- 爆船不损失舰船和装备。
- 爆船后进入 180 秒强制自动维修，期间不能出击、切换战斗舰或手动修复。
- 维修使用绝对时间戳保存，关闭页面后倒计时仍会继续；到期自动恢复全部护盾、装甲和结构。
- 主动停止战斗仍沿用当前规则，立即结束并恢复舰船状态。

### 存档迁移与验证

- 旧存档中的裂谷级、茶隼级和阿特龙级若没有战斗装备，会一次性补发对应武器和专精维修装备。
- 新游戏裂谷级默认装配小型激光炮和小型护盾回充器。
- 自动测试覆盖六件装备制造、逐舰多武器齐射、自动维修、爆船保留舰装、180 秒锁定、禁止手动修复、自动满血和旧存档补发。
- 真实浏览器验证通过：默认配装、装备驱动战斗、资源扣除、爆船倒计时和到期自动恢复均正常。

### 当前决定

- 蓝图系统暂不调整。
- 下一步优先继续完善战斗装备数值、缺资源反馈和战斗 HUD，再进入安全等级与掉落扩展。

### 后续舰船与星带的统一设计原则（已确认，持续执行）

- 舰船按“护卫舰 → 驱逐舰 → 巡洋舰 → 战列舰”逐级承接安全等级，不直接从护卫舰跳到巡洋舰。
- 每一级继续保留三条等价专精线：激光/护盾、导弹/装甲、射弹/结构；总属性预算相等，只改变生命层、槽位和战斗特性分布。
- 同安全等级星带的普通、精英和 BOSS 使用固定基础属性，不采用第 11/16 波之类的隐藏强度倍率；难度来自编队数量、精英随机出现和第 20 波 BOSS。
- 单只 BOSS 的每轮持续压力必须稳定穿透对应阶段的常规维修装配；BOSS 单轮威胁约等于三只普通怪合计，加入护航后成为该星带最危险的编队。
- 对应等级的完整基础装配应能稳定肃清上一安全等级星带，并在新星带初次进入时连续战斗约 8～12 波。
- 上一级舰船通过技能与完整装配可以越级挑战下一档星带，但 20 波肃清率控制在约 30%～40%，避免新舰船只提供数值溢出而没有明确用途。
- 新舰船的速度、锁定、燃料效率、舰体命中和维修专精必须接入实际战斗公式，不能只作为面板展示属性。
- 常规舰船不强制消耗战斗掉落；月矿、势力材料和考古材料主要作为 T2、混血舰船及更高级舰船的制造门票。

### 下一档常规战斗舰：T1 驱逐舰试装（已实现）

- 舰船工程 Lv.15 解锁；作为 CL≥15、0.7～0.5 星带的推荐舰级。
- 蓝图系统暂不接入，制造以基础矿物、重金属和稀有气体为主，不消耗月矿或战斗掉落。
- 三艘试装舰为雷光级、矛隼级、疾锋级。

| 舰船 | 专精 | 护盾/装甲/结构 | 闪避 | 速度 | 锁定 | 高/中/低/改装槽 |
|---|---|---:|---:|---:|---:|---:|
| 雷光级 | 激光/护盾 | 600/150/150 | 18 | 230 | 135 | 3/3/1/1 |
| 矛隼级 | 导弹/装甲 | 150/600/150 | 16 | 210 | 155 | 3/1/3/1 |
| 疾锋级 | 射弹/结构 | 150/150/600 | 22 | 260 | 125 | 3/1/3/1 |

- 三舰基础总血量均为 900，相比 T1 护卫舰的 500 提升 80%；高槽统一由 2 增至 3，主防御槽增加 1，速度与闪避相应下降。
- 雷光级：护盾容量 +15%、激光伤害 +10%、舰体命中 +10；燃料效率 0.95×。
- 矛隼级：装甲容量 +15%、导弹伤害 +10%、装甲维修 +50%、舰体命中 +10；燃料效率 0.85×。
- 疾锋级：结构容量 +15%、射弹伤害 +10%、速度 +15%、结构维修 +200%、舰体命中 +10；燃料效率 0.90×。
- 三条维修路线按“小型护盾回充 30 / 装甲维修 20 / 结构维修 10”的基础量归一化，满维修槽时每轮基础维修量均为 90，避免护盾路线天然获得三倍优势。
- 驱逐舰继续使用现有小型战斗武器；中型战斗武器留给巡洋舰阶段，避免同时扩大舰船与装备两个系统的数值跨度。
- 实测标尺：接近零技能的完整 T1 驱逐舰装配可 100% 肃清当前高安；入门驱逐舰首次进入对应 0.7～0.5 星带时平均到达第 8～10 波。

### 高安星带编队与威胁修正

- 第 1～19 波从四种固定编队中随机抽取：2 普通 45%、3 普通 45%、2 普通＋1 精英 8%、3 普通＋1 精英 2%。
- 第 20 波固定生成 1 名 BOSS 与 1 名普通护卫；普通敌人不掉 LP，肃清统一结算 3 LP。
- 敌方回合改为我方齐射后所有存活敌人依次攻击，并记录每名攻击者与伤害；战斗 HUD 同步播放多敌攻击反馈。
- 高安普通/精英/BOSS 使用固定基础属性，不再随波次增加隐藏倍率；BOSS 主生命层重新集中，单轮攻击力调整为 96，避免其威胁低于三只普通敌人。
- 旧存档通过战斗星带 V4 迁移按剩余生命比例同步当前敌舰属性，不会因更新直接回满或被清空。

### 0.7～0.5 驱逐舰星带试装

- 新增天使劫掠走廊、血袭者献祭场、萨沙控制节点三条星带，统一要求 CL 15。
- 编队池为 2 普通 30%、3 普通 40%、2 普通＋1 精英 20%、3 普通＋1 精英 10%；第 20 波同样固定 BOSS＋1 普通护卫。
- 三条星带分别使用护盾、装甲、结构特化的驱逐舰敌人；固定数值不附加波次成长。
- 区域奖励为 ISK 1.5×、燃料消耗 1.2×、肃清 6 LP；普通敌人不掉加密数据，精英 1%、BOSS 4%。
- 最终攻击力校准：天使普通/精英/BOSS 为 94/141/308；血袭者为 82/123/260；萨沙为 74/111/226。三只 BOSS 每轮基础威胁约为对应普通敌人的三倍。

### 驱逐舰制造与公式接入

- 舰船工程Lv.15使用三种驱逐舰集成部件；三艘驱逐舰各使用10个部件，组装耗时45秒、经验60。
- 本阶段按决定暂不设置驱逐舰蓝图门槛；旧护卫舰与工业护卫舰仍沿用原蓝图规则。
- 驱逐舰伤害加成、舰体命中、舰体燃料效率、区域燃料倍率和装甲/结构维修专精已接入真实战斗公式。
- 新舰船没有图片资源时显示通用舰船占位图标，不会残留上一艘舰船的图片。

### 验证结果

- 全量验证通过：17 个 JS、4 个 CSS、187 个 DOM ID，全部本地资源 HTTP 200。
- 自动测试新增驱逐舰材料总计、免蓝图组装、舰体属性、CL 门槛、星带编队概率、BOSS 编队、加密数据边界及战斗公式检查。
- 固定种子蒙特卡洛模拟：当前高安以接近零技能完整驱逐舰装配测试，三条星带 20 波肃清率均为 100%。
- 0.7～0.5 入门配置平均到达第 8.28 / 10.11 / 9.22 波；成熟配置 20 波肃清率为 31.55% / 38.76% / 38.10%，符合约 30%～40% 的越级肃清目标。

## 2026-07-16

### 前端架构加固第一阶段

- 新增纯状态选择器层 `js/core/selectors.js`：显式接收状态和时间，返回可序列化View State，不访问DOM、不修改状态、不读取全局 `gameState`。
- 新增状态动作层 `js/core/actions.js`：通过 `dispatchGameAction(state, action, now)` 统一处理状态变化，动作本身不渲染、不弹Toast、不保存存档。
- 全局资源栏、仓库占用、快捷矿石、侧边栏等级和当前行动文案已迁移到View State。
- 采矿/月矿、冶炼和气体采集完成首批迁移：效率、目标、运行目标、进度、按钮状态、门槛和下拉选项均由View State生成。
- 生产目标选择改由动作层处理；原兼容函数只负责派发动作并在成功后刷新页面。
- 采矿、冶炼和采气的下拉/目标DOM渲染从 `systems/production.js` 移入 `ui/render.js`；生产系统不再维护另一套页面计算。
- 高频进度刷新与完整页面刷新开始共享同一进度选择器，避免时间和百分比公式分叉。

### 自动约束与验证

- 验证脚本增加架构守卫：禁止选择器/动作层访问DOM、全局 `gameState` 或渲染函数。
- 自动测试确认选择器调用前后输入状态完全不变，并覆盖月矿运行目标与待选目标、月矿装备门槛、全局仓库汇总、锁定动作失败和未知动作拒绝。
- 存档结构和玩法规则没有变化；旧的效率函数保留为兼容入口并委托给新选择器。
- 新增 `ARCHITECTURE.md`，固定依赖方向、分层规则、当前迁移状态以及制造→战斗→行星→仓库/队列的后续顺序。
- 重构后 `systems/production.js` 的DOM直接访问由29处降至15处、全局状态访问由86处降至42处；`ui/render.js` 的全局状态访问由56处降至12处，剩余DOM访问集中在适配层。
- 全量验证通过：19个JS、4个CSS、187个DOM ID，全部本地资源HTTP 200；驱逐舰战斗模拟结果保持不变。
- 真实浏览器回归通过：普通矿/月矿切换、月矿锁定提示、采矿确认弹窗、冶炼和采气下拉均正常；舰船工程与战斗页面未受影响，控制台无错误。

### 分批迁移计划与第1批：制造系统

- 后续迁移固定为4批：制造系统、战斗、行星、仓库/船坞/队列与导航收口。本次完成第1批。
- 新增 `getShipEngineeringDisplayState()`，统一生成蓝图、部件配方、材料库存、组装门槛、运行目标、进度、舰体属性和已有舰船列表。
- 新增 `getEquipmentEngineeringDisplayState()`，统一生成分类、搜索结果、配方卡片、材料明细、库存、运行配方、当前查看配方、队列摘要和进度。
- 制造状态动作接入统一 `dispatchGameAction()`：蓝图购买、部件/舰船选择、制造启动、装备分类/配方选择和停止制造均不再操作DOM。
- `js/systems/manufacturing.js` 重写为制造核心和旧调用兼容层，DOM直接访问由70处降为0；新建 `js/ui/manufacturing-render.js` 作为原生DOM适配器。
- 运行中切换部件、舰船或装备配方时，View State明确保留当前运行配方和当前查看配方，不会改变本次产物或进度耗时。
- 自动测试覆盖制造选择器纯度、运行/查看目标分离、免蓝图驱逐舰、护卫舰蓝图锁、蓝图扣款、分类搜索和停止制造状态清理。
- 全量验证通过：20个JS、4个CSS、187个DOM ID，全部本地资源HTTP 200；驱逐舰星带模拟结果与迁移前一致。
- 真实浏览器回归通过：舰船工程、装备分类切换、配方搜索和详情切换均正常，控制台无错误。

### 第2批：战斗系统迁移

- 新增 `getCombatDisplayState()`，统一生成战斗舰、装备模块、齐射伤害、动态生命值、星带门槛、敌方编队、当前目标、补给、战斗状态、维修倒计时和按钮条件。
- 战斗技能、CL、命中、伤害倍率、闪避、最大生命值、燃料倍率和维修倍率均改为显式读取传入状态；旧战斗公式入口委托给同一套纯计算函数。
- 星带选择、开始战斗、停止战斗、进入180秒自动维修和维修完成接入 `dispatchGameAction()`；失败动作不会修改状态。
- 新建 `js/ui/combat-render.js`，完整HUD刷新和每秒轻量刷新共享同一个View State；敌方编队、环形生命值、装备架、战斗特效和事件绑定从战斗核心移入UI适配层。
- `js/systems/combat.js` 不再包含战斗HUD DOM、面板渲染或攻击特效；其中剩余27处DOM均属于船坞和环形装配兼容段，留待第4批统一迁移。
- 存档结构、伤害公式、玩家先手、敌方全编队依次攻击、维修顺序、掉落和星带数值均未改变。
- 自动测试覆盖战斗View State纯度、舰船装备汇总、敌方编队、补给、区域CL锁、交战中区域锁、开始/停止指令和180秒自动维修边界。
- 全量验证通过：21个JS、4个CSS、187个DOM ID，全部本地资源HTTP 200；驱逐舰蒙特卡洛结果与迁移前完全一致。
- 真实浏览器回归通过：HUD、星带下拉、开始战斗、三敌编队、三次敌方攻击反馈、停止战斗和生命值复位均正常，控制台无错误。

### 第3批：行星系统迁移

- 新增 `getPlanetaryDisplayState()` 与行星部署子选择器，统一生成技能经验、槽位、库存上限、部署选项、产出间隔、产出进度、周期倒计时、满仓和过期状态。
- 行星View State会按当前时间推导显示进度和过期状态，但不会在渲染期间修改 `deployment.active`、进度或其他存档字段。
- 部署、收取、续期和撤除接入 `dispatchGameAction()`；等级、槽位、ISK、三钛合金、仓库容量与非空撤除限制均由动作层处理。
- `js/systems/planetary.js` 重写为DOM为0的行星结算核心；`js/data/planets.js` 只保留静态行星配置，Canvas实现不再混入数据层。
- 新建 `js/ui/planetary-render.js`，集中处理行星卡片、部署弹窗、实时进度、Canvas纹理和自转动画；`ui/render.js` 不再直接读取行星部署状态。
- Canvas自转偏移改为UI内存中的 `planetVisualOffsets`，不再向部署对象写入 `_scrollOffset`，避免纯视觉数据污染存档。
- 在线tick、离线结算、24小时周期、产出间隔、库存容量、经验和部署成本均保持不变。
- 自动测试覆盖行星View State纯度、过期推导、槽位与等级锁、部署扣费、仓库部分收取、续期、非空撤除锁、空库存撤除和Canvas状态不入档。
- 全量验证通过：22个JS、4个CSS、187个DOM ID，全部本地资源HTTP 200；驱逐舰战斗模拟结果保持不变。
- 真实浏览器回归通过：行星页面、空状态、槽位摘要、部署弹窗、等级门槛和动态产出间隔正常，控制台无错误。

### 第4批：应用外壳与遗留系统收口

- 新增仓库、LP商店、船坞、舰船装配、动作队列和页面导航六组View State；筛选、列表、状态、按钮门槛和页面显隐不再由核心系统拼接DOM。
- 仓库分类改为合并静态配置与实际库存键。新增舰船部件、势力材料或未来资源即使尚未加入旧白名单，也会自动出现在对应分类；使用真实存档复核后，页面物资数量与顶部仓库占用一致。
- 船坞任务分配、战斗舰切换、装备交换/卸下/清空以及LP兑换全部接入 `dispatchGameAction()`；失败动作返回原因，不在状态层弹窗或刷新页面。
- 动作队列重写为DOM为0的执行核心，增加队列添加合并、排序、启动、停止、清空和循环模式动作；原有兼容函数只负责派发动作。
- 新建 `js/ui/shell-render.js`，集中接管页面导航、仓库筛选、LP商店、船坞、环形装配和动作队列的DOM渲染与事件绑定；生产、战斗、行星和队列四个核心文件均保持DOM访问为0。
- 制造完成后的进度清零改为核心事件通知UI立即清空Canvas、进度条与ETA，保留此前修复的完成态行为，同时避免队列核心反向依赖制造页面。
- 自动测试新增外壳View State纯度、动态驱逐舰部件显示、船坞分配、装备交换与回收、LP扣款入库、队列合并/排序/启停/清空、导航映射和核心DOM守卫。
- 四批迁移至此全部完成；现有原生DOM只是可替换适配层，后续React/Vue或移动端可以直接复用相同选择器、动作和系统结算核心。
- 全量验证通过：23个JS、4个CSS、187个DOM ID，全部本地资源HTTP 200；生产、战斗、行星、队列、选择器和动作层的违规UI访问均为0。
- 驱逐舰蒙特卡洛结果与迁移前一致：当前高安肃清率100%，三条0.7～0.5星带成熟配置肃清率仍为31.55% / 38.76% / 38.10%。
- 真实浏览器使用现有存档回归通过：仓库动态物资和分类筛选、船坞舰船卡片、任务分配入口与环形装配弹窗均正常。

### 基础设施加固：错误边界、资源注册表、领域事件与战斗修正

- 新增无DOM的 `RuntimeGuard`：统一记录运行异常、限制重复错误、隔离关键循环并支持显式恢复；`gameTick` 抛错后会暂停主循环，避免存档继续发生半结算。
- 新增原生错误面板：脚本缺失、启动模块不完整、运行时异常和未处理的异步异常会向玩家显示来源、摘要和调用栈，不再只在控制台静默失败。
- 渲染循环改为可恢复通道；单帧渲染错误会被记录，但下一帧仍会继续调度，不会因为一次UI异常永久停止刷新。
- 新增兼容型 `ResourceRegistry`，以 `namespace:itemKey` 统一访问资源；在线/离线采矿、冶炼、采气、制造、战斗消耗与掉落、LP兑换和行星收取已接入。
- ResourceRegistry目前仍读写旧有 `resources.ores/minerals/planetary/gases/moonOres/special/shipComponents` 等字段，不新增 `resources.items`，因此本轮不需要转换玩家存档。
- 材料扣除改为先检查总库存再统一扣除；资源不足时不会发生部分材料已经扣除的半事务状态。同名历史资源仍可按固定命名空间顺序兼容合并。
- 新增同步 `GameEvents` 领域事件总线，统一替代战斗与制造原有的局部监听数组；已发布采矿、冶炼、采气、制造、击杀、波次、肃清、爆船和技能升级事件。
- 离线结算只发送聚合事件，例如离线采矿120次只发布一次包含 `cycles:120` 的事件，避免未来成就/任务系统收到大量重复回调。
- 新增 `CombatModifiers` 纯计算管线；最大生命、命中、伤害、闪避、燃料和维修公式均可叠加 `add/multiply/override/min/max` 修正，并支持武器、生命层、区域和过期时间条件。
- 本轮没有加入动态难度、Buff或Debuff，既有技能、舰船、装备和区域加成只是改由修正管线计算；固定种子战斗模拟结果与修改前完全一致。
- UI适配层残余的停止行动、默认矿区修正和工业舰卸下已改为派发Action；自动守卫会阻止 `render.js` 和 `shell-render.js` 重新直接写入 `gameState`。
- 自动测试新增运行时暂停/恢复、事件订阅/取消/单次监听、资源统一寻址、原子扣除、旧存档结构保持、配方材料注册、战斗修正顺序/条件/过期和UI直接写状态检查。
- 全量验证通过：28个JS、4个CSS、187个DOM ID，全部本地资源HTTP 200；真实页面初始加载、资源栏、侧栏与采矿页面正常。

### 后续修改清单

1. **ResourceRegistry第二阶段：补齐剩余读取入口（已于2026-07-17完成）**
   - 执行确认弹窗、仓库快捷显示和制造库存摘要已经改为Registry或专用View State。
   - 存档迁移代码可以继续直接处理旧字段，但必须集中标注为“迁移边界”，业务系统不得再新增 `resources.*` 直接读写。
   - 月矿后续新增材料时先登记命名空间、显示名、分类和图标，再由配方引用资源ID；暂不把旧存档强制转换为单一 `resources.items`。

2. **领域事件规范与首批消费者**
   - 固定事件名称、payload字段和在线/离线语义，增加事件契约测试，防止任务或成就上线后随意改变格式。
   - 制作任务、成就或统计系统时只订阅事件，不让采矿、战斗和制造核心反向依赖这些新系统。
   - 对可能重复结算的关键事件增加运行ID或幂等键，避免读档、离线补算和恢复循环造成重复奖励。

3. **错误恢复与存档保护增强**
   - 在关键循环暂停时记录最近一次安全tick时间，并提供一键导出当前存档/错误报告。
   - 增加启动健康状态和版本信息，区分脚本缺失、存档迁移失败、结算异常与纯UI异常。
   - 恢复主循环前重新校验关键状态；不能恢复时保持暂停，不自动吞掉异常继续运行。

4. **CombatModifiers实际玩法接入前的准备**
   - 当第一种Buff、Debuff、电子战或环境效果进入策划时，增加修正定义表、持续时间生命周期、叠加/覆盖规则和HUD状态图标。
   - 动态修正统一写入 `combat.modifiers` 并通过Action增删；战斗核心只读取最终修正结果。
   - 继续遵守已确定的星带原则：敌人基础强度固定，不使用隐藏波次倍率；修正管线不等于动态难度缩放。

5. **UI适配层按需收尾**
   - `action-modal.js` 的专用确认弹窗View State已于2026-07-17完成，库存、产出和队列快照不再由弹窗自行计算。
   - `persistence.js` 保留存档与DOM交互职责，但导入后的页面跳转、提示和刷新逐步拆为状态结果与UI反馈。
   - 暂不引入React/Vue；等移动端或组件化需求明确时，直接复用现有Selectors、Actions、ResourceRegistry、GameEvents和CombatModifiers。

## 2026-07-21

### Lv.80 旗舰基础战斗装备与 0.0 强度校准（实装 + 双校验通过）

- **玩法前置补齐**：从相邻工程 `eveidle-modular` 整体迁入与 `render3d` 无耦合的玩法实现（`js/core/*`、`js/data/*`、`js/systems/*`、`js/ui/*`、`css/*`），补齐本工程缺失的旗舰 / 超级旗舰、0.0 外环与深层、莫尔石、战术索敌等前置；`render3d` 全部未提交改动保持原样未触碰。
- **六件 Lv.80 旗舰基础装备**：聚焦激光炮 I（伤害600/命中100/燃料15/弹药1，AOE 下一目标 30%）、巡航导弹阵列 I（伤害500/命中130/燃料5/弹药1，AOE 其他全部 12%）、攻城射弹炮 I（伤害400/命中80/燃料10/弹药1，AOE 最多两个其他 15%）、护盾回充阵列 I（修150/燃料5）、装甲维修阵列 I（修100/燃料5）、结构修复阵列 I（修50/燃料15）。全部免蓝图、仅 capital/supercapital 可装、配方无莫尔石无新资源。武器耗时180/xp130，维修耗时160/xp110。
- **AOE 纯函数层**：新增 `js/systems/capital-combat.js`，`getCapitalAreaDamageTargets(enemies, primaryEnemy, aoeConfig)` 实现 `next` / `all` 三模式，自动排除已死亡目标；`combat.js` 仅应用结果，AOE 击毁经 `resolveCombatEnemyDefeat` 统一结算，死敌经 `getLivingCombatEnemies` 过滤不再反击。
- **装备门槛**：`canFitEquipmentOnShip` 拦截战列舰与工业旗舰安装；动作层对不兼容安装返回 `{changed:false, reason:"incompatible-equipment"}`；制造界面六件可见、武器归入 `weapons` 分类。
- **0.0 校准门槛（固定种子、每带 1000 次）全部达成**：旗舰+10 外环 93.9/94.1/91.2%（差 2.9pp≤3）、深层肃清率 0% 但数据期望 >0；旗舰+0 外环 <10%、旗舰+10 仅 T1 过渡装 <30%、旗舰+5 <80%；超级旗舰+0 深层 <10%、超级旗舰+10 深层 91.6/92.6/89.7%（差 2.9pp≤3）。
- **回归校验**：`tools/verify.mjs` 通过（31 JS、4 CSS、209 DOM IDs，全部本地资源 HTTP 200；含旗舰装备专项校验：六件数据/配方/无莫尔石/舰体限制、三族 AOE、动作拒装、制造可见、AOE 击杀结算）；`tools/simulate-destroyer-belts.mjs --assert-nullsec` 通过。
- 未执行 `git commit`（按任务要求保留全部未提交改动）。

### Lv.60 三族混血战列舰（实装 + 校准 + 工具闭环通过）

- 实装破晓级（天使/护盾+激光）、赤垒级（血袭者/装甲+导弹）、幽构级（萨沙/结构+射弹炮）三艘混血战列舰：舰船工程 Lv.60、tier 混血、type battleship，仅用现有大型 T1 武器与维修件，不引入旗舰装备。
- 总生命 4320（混血战列舰相对常规 +20%），部件沿用三类战列集成部件 6/5/5（共 16 件）；制造 120 秒、200 经验；蓝图 150 LP、永久解锁、绑定对应 L60 星带（天使破阵战场 / 血袭者铁血圣殿 / 萨沙统御矩阵）。
- 材料成本：钷×20、铷×16、对应高级加密数据×45；战列部件派生材料与常规战列舰一致（三钛430/同位223/超新星215/同位素30/重金属66/等离子95/稀有气体60）。经济闭环：常规战列 8h53m → 混血 11h11m（1.26x），月矿 2h18m、无材料阻塞。
- 加成：破晓护盾+30%/激光+25%/命中+20；赤垒装甲+30%/导弹+25%/装甲维修+50%/命中+20；幽构结构+30%/射弹+25%/速度+15%/结构维修+200%/命中+20（命中统一 +20 非 +25）。槽位/速度/索敌/电容/燃料沿用 L55 战列舰；三族主防御层分别为护盾/装甲/结构。
- 战斗校准（固定种子、每带 10,000 次）全部达成：入门（Lv.60 技能）<20%（16.59/18.24/19.57%）；成型（Lv.65）78%～86% 且三路线差距 ≤3pp（81.85/79.91/80.60%，差 1.94pp）；成熟（Lv.70）≥98%（98.78/99.80/100%）；成熟越级 0.0 外环肃清率 0% 且平均推进 ≤2 波。
- 幽构级闪避悖论破解：结构坦克在"高结构+低闪避"区才能解耦入门/成型——结构 3400、闪避 5 时入门 19.57%、成型 80.60% 同时达标；此前堆结构 3900/闪避 9 反而入门 53%、成型 99% 双爆，堆结构 3250/闪避 10 则成型仅 68% 不达标。三舰精确 HP 分配与闪避：破晓 3300/510/510（闪避13）、赤垒 660/3000/660（闪避8）、幽构 460/460/3400（闪避5），总生命均 4320。
- 工具闭环：`simulate-destroyer-belts.mjs` 新增 `--assert-mixed-battleship`（四档验收）、`--calibrate-mixed-battleship-hp` / `--calibrate-mixed-battleship-dodge` 扫描；`calculate-ship-production-times.mjs` 新增 `getMixedBattleshipEconomyAudit` 与 `--audit-mixed-battleship`，`--verify` 扩展 L60 时间预算 [36000,43200]（10–12h）与混血战列舰经济校验（数据×45、无阻塞、生产比 1.10–1.30、期望全通 120–130 次、LP≥150、45/60=75% 校验）；`verify.mjs` 扩展 L60：组件循环 ≤60、部件数 16、战列部件档 L55、材料表 +3、蓝图目录 73/舰船 17。
- 回归校验（七项全绿）：`node tools/verify.mjs`、`node tools/calculate-ship-production-times.mjs --verify`、`node tools/calculate-ship-production-times.mjs --audit-mixed-battleship`、`node tools/simulate-destroyer-belts.mjs --assert-mixed-battleship`、`node tools/simulate-destroyer-belts.mjs --assert-nullsec`、`node tools/audit-ship-enhancement.mjs`、`node tools/audit-industrial-productivity.mjs` 全部 EXIT=0。
- 未执行 git commit（按任务要求保留全部未提交改动）。

## 2026-07-22

### 全装备强化系统 验收返修（只修已确认缺陷，不动策划数值，不扩功能）

- **背景**：原实装经重构审计发现 6 项已确认缺陷；本轮仅修复缺陷、补集成测试、跑回归，不调整任何策划数值、不扩展新功能、不触碰 `js/render3d/**`、不执行 `git commit`。
- **缺陷 1 —— +0 堆叠装备强化崩溃**：`js/core/actions.js` `enhanceEquipment()` 内 `const instance` 被二次赋值触发 "Assignment to constant variable"。改为 `let targetInstance`，并将"创建实例"提前到"从 inventory splice"之前，原子逻辑统一为"全部校验通过后才改状态"。
- **缺陷 2 —— 旧存档迁移吞掉备用装备**：`js/core/persistence.js` `migrateEquipmentInstancesV1` 原用 `inventory.indexOf(equipmentId)+splice` 把 fitted 所代表的备用件误删。改为：fitted 的 itemId 即已安装装备本身，直接为其分配实例并写回 fitted，不再查询/删除 inventory。
- **缺陷 3 —— importData 路径缺装备迁移**：`importData` 仅一行 `updateUI()`，未跑 `migrateEquipmentInstancesV1`/`normalizeEquipmentState`。改为调用共享函数 `finalizeEquipmentStateAfterLegacyMigrations(gameState)` + `calculateOfflineGains()`。（注：初版曾"无条件删除迁移标志强制重跑"，该写法在二次返修中被修正为条件执行，见下。）
- **缺陷 4 —— 月矿装备检测失效**：`js/core/selectors.js` `getMoonMiningAccessState` 仍用 `EQUIPMENT_DB[id]`，但 fitted 现存储 instanceId。改为经 `resolveEquipmentReference(state, ref)` 解析出 definition 后再判 `bonuses.miningEfficiency > 0`。
- **缺陷 5 —— normalizeEquipmentState 删除合法实例**：原实现丢弃 instanceId 缺失/重复的实例。改为：缺失→分配新 id；重复→首个保留、其余重分配（fitted 重复引用只保留第一个，不复制装备）。
- **缺陷 6 —— 手写精炼矿物兜底表**：`js/systems/equipment-enhancement.js` 原 `REFINED_MINERALS` 硬编码 7 矿物兜底。改为从 `SMELTING_RECIPES` 动态推导，缺失时返回空集（fail closed，审计失败而非静默通过）。
- **测试与回归**：`tools/audit-equipment-enhancement.mjs` 重写为真实集成测试（通过 vm 沙箱加载完整脚本链，直接调用 `enhanceEquipment`/`dispatchGameAction`/`normalizeEquipmentState`/`migrateEquipmentInstancesV1`，A–D 四节共 674 条断言全绿）；`js/core/resources.js` 暴露 `window.ResourceRegistry` 供审计使用；`tools/verify.mjs` 增加 `production.js` 须在 `equipment-enhancement.js` 之前的脚本顺序断言。
- **八条回归命令全部 EXIT=0**：`verify.mjs`、`audit-equipment-enhancement.mjs`、`audit-ship-enhancement.mjs`、`audit-industrial-productivity.mjs`、`calculate-ship-production-times.mjs --verify`、`calculate-ship-production-times.mjs --audit-mixed-battleship`、`simulate-destroyer-belts.mjs --assert-mixed-battleship`、`simulate-destroyer-belts.mjs --assert-nullsec`。浏览器手测因环境受限未执行，由无头集成审计（覆盖真实 Action 集成）+ `verify.mjs` 资源加载校验替代。
- 未执行 git commit（按任务要求保留全部未提交改动）。

### 全装备强化系统 二次返修（donor 双重扣除 / 现代存档重复赠装）

- **背景**：一轮回归验收中新发现两项回归，本轮仅修复、补硬断言、跑回归，不调整任何数值、不触碰 `js/render3d/**`、不执行 `git commit`。
- **修复 1 —— donor 双重扣除**：`js/core/actions.js` `enhanceEquipment()` 原子扣减段存在两段连续的 `if (needDonor)` donor 扣除块，第一次 splice 后第二次又找到下一 donor 再 splice，导致每次里程碑强化尝试消耗两件而非一件。删除重复块，确保每次里程碑强化只消耗恰好一件 donor（inventory 初始 1/2/3 件 → 结束 0/1/2 件，对势力/联盟/DED 标准/DED 监督者均成立；donor 不足时完整状态不变）。
- **修复 2 —— 现代存档导入重复赠装**：`js/core/persistence.js` `importData()` 原无条件 `delete combatEquipmentV1` / `delete equipmentInstancesV1`，导致已完成实例化的现代存档导入时被强制重跑 `migrateCombatEquipmentState`，而该函数用 `EQUIPMENT_DB[id]` 直接查 fitted（对 `eq_*` 实例引用返回 undefined → 误判"未装武器/维修" → 重复赠送默认装备）。改为：①不再无条件删除现代存档已有的迁移标志，一次性迁移各自带幂等守卫，仅当存档确实缺标志才运行；②`migrateCombatEquipmentState` 的已安装装备判定改用 `resolveEquipmentReference(gameState, ref)`，同时兼容旧 itemId 字符串与新 `eq_*` 实例引用；③`normalizeEquipmentState` 每次导入仍必须执行。现代存档（两标志均置位）导入后实例数/inventory 数/fitted 引用/强化等级完全不变，不新增默认武器或维修器；旧式 fitted 存档（缺标志）导入仍正常迁移并保留备用装备。
- **测试扩展**：`js/core/persistence.js` 暴露 `window.SaveManager` 供审计直接调用真实 `importData`；`tools/audit-equipment-enhancement.mjs` 新增 B16b（donor 初始 1/2/3 件精确剩 0/1/2 件、DED 核心/协议精确减 1，覆盖联盟/势力/DED标准/DED监督者）与 E 节（现代存档带两标志导入前后总数一致、eq_* 引用不获额外默认装备、旧存档缺标志仍迁移、连续导入同一现代存档两次结果一致），断言全绿。
- **八条回归命令全部 EXIT=0**（同上）。浏览器手测因环境受限未执行，由无头集成审计（真实 `importData`/`enhanceEquipment` 调用）+ `verify.mjs` 资源加载校验替代。
- 未执行 git commit（按任务要求保留全部未提交改动）。

### 工业舰与逆戟鲸级专项收尾验收（只修元数据/补审计/清文档，不动数值、不触碰 render3d、不 commit）

- **背景**：工业舰与逆戟鲸级此前已实装，但存在三项收尾缺口——①逆戟鲸解锁类型误用 `composite`（游戏逻辑无人消费，真实 Lv.80 门槛由组装配方承载）；②工业产能专项审计缺少对 10 舰层级、逆戟鲸自身/支援/冶炼/强化边界的硬断言；③`eveidle.md` §7.4 仍描述旧"四部件/外置货舱/工业挂架"方案，与现行三件集成部件冲突。本轮仅修复元数据、补齐自动化审计、清理冲突文档，不调整任何产能/舰船/装备/资源数值，不触碰 `js/render3d/**`，不执行 `git commit`。
- **修复 1 —— 逆戟鲸解锁元数据**：`js/data/ships.js` 中 `orca.unlock` 由 `{ type:"composite", level:80 }` 改为 `{ type:"shipEngineering", level:80 }`。`composite` 类型在游戏逻辑中无任何消费者；真实 Lv.80 制造门槛由组装配方 `recipe.level` 决定，选择器 `getProductionEfficiencyState`、制造动作 `startShipAssembly`、队列 `getQueueItemConfigForState`、在线/离线结算均早已正确使用 Lv.80，无需其他改动。全部制造规则保留：免蓝图、capital 部件 10/8/10=28、组装 320s/500xp、无莫尔石、无新蓝图、舰体/槽位/工业加成不变。
- **修复 2 —— 工业产能专项审计扩展**：`tools/audit-industrial-productivity.mjs` 新增六节硬断言（全部走真实选择器/函数、1e-9 容差、无手写公式、无假数据）：
  - 工业舰层级完整性：10 艘（Lv.1/15/35/55/80）舰体/配方/门槛/三部件档位/可实例化均符合预期；
  - 逆戟鲸自身工业能力：miningLaserEfficiency/gasLaserEfficiency=2.8、4 高槽、可采矿/采气/冶炼、普通矿与月矿产能为正；
  - 工业舰强化接入：+5=1.075x、+10=1.15x、不增舰体生命、不放大 fleetMiningSpeed/smeltingSpeed；
  - 舰队采矿支援：无支援 1.00x、海豚 1.10x、逆戟鲸 1.20x、同存取最高不叠加、分配冶炼仍提供船坞采矿协同、强化不改变 20%、不误提采气；
  - 冶炼支援：无支援 1.00x、海豚 1.25x、逆戟鲸 1.30x（均经真实冶炼视图状态）、未分配不提供、强化不放大；
  - 制造经济：全链路 18~24h（逆戟鲸 23h59m57s）、部件均真实来源、无莫尔石/深层/考古、不需蓝图、材料不足原子拒绝（`startShipAssembly` 返回 `insufficient-components` 且库存不变）。
- **修复 3 —— verify.mjs 防回归加强**：新增"工业舰与逆戟鲸专项校验"数据驱动断言：10 舰精确、orca type=industrial_capital、unlock=shipEngineering/Lv.80、双 2.8、fleetMiningSpeed 0.20、smeltingSpeed 0.30、配方免蓝图 10-8-10=28、time320/xp500、禁莫尔石/深层/考古、旗舰装备禁装 orca、orca 不进 0.0 战斗平衡配置（`starterShips.orca===undefined` 且 type 非 capital/supercapital）。
- **修复 4 —— eveidle.md 冲突清理**：§7.4 原"工业舰与战斗舰共用四种基础部件，外置货舱和工业挂架为专属部件"改为现行规则——三件集成部件共用、工业舰 Lv.1/15/35/55/80、Lv.80=逆戟鲸终点且无工业超级旗舰、逆戟鲸不参与旗舰战斗且不装旗舰装备、4 高槽兼顾采矿与采气、船坞采矿协同 +20%、分配冶炼 +30%、舰队/冶炼加成不随强化放大、完整制造配方已实装（无需等待 0.0 资源循环）。仅修冲突段落，历史草案内容未删。
- **修复 5 —— 审计返修（补 4 个验收缺口，仅加断言、不改数值/公式/玩法代码）**：在 `tools/audit-industrial-productivity.mjs` 中补齐此前缺失的硬断言，全部经真实函数/选择器、1e-9 容差、无手写公式、无假数据：
  - 真实实例创建：对 10 艘工业舰逐一调用沙箱内 `createShipInstance`，验证 `shipId`/`instanceId`/`enhancementLevel===0`/`fitted` 四槽结构；连续两艘同型号 `instanceId` 必须不同；删除原"手工构造对象再调 `getShipInstanceFromState`"的自证断言，`getShipInstanceFromState` 仅作创建后按 `instanceId` 读取验证；
  - 逆戟鲸采气强化：经真实 `getProductionEfficiencyState(...,"gasHarvesting")` 验证 +5/+0=1.075x、+10/+0=1.15x（不复制强化公式）；
  - 月矿实际准入：构造 Lv.80 逆戟鲸分配采矿、高槽装真实 `t5_mining_laser`（实例引用经 `resolveEquipmentReference` 解析），经 `getMoonMiningAccessState`/`getMiningRequirementState` 验证 `available=true`；移除高槽激光器后 `available=false`（不以"通用效率 total>0"代替月矿准入）；
  - Lv.79/80 制造边界：经真实 `dispatchGameAction` 验证——Lv.79 选逆戟鲸配方 `level-locked` 且 `currentAction` 不变、Lv.80 选配方成功、Lv.79 即使预置 `shipAsmTarget` 启动组装仍 `level-locked`、Lv.80 材料不足 `insufficient-components` 且 `inventory` 不变、不需蓝图。
  - 审计输出据实改写：仅在实际覆盖后才打印"采矿/采气强化、月矿准入、真实实例创建、Lv.79/80 边界全部通过"。
- **八条回归命令全部 EXIT=0**：`verify.mjs`、`audit-industrial-productivity.mjs`、`audit-equipment-enhancement.mjs`、`audit-ship-enhancement.mjs`、`calculate-ship-production-times.mjs --verify`、`calculate-ship-production-times.mjs --audit-mixed-battleship`、`simulate-destroyer-belts.mjs --assert-mixed-battleship`、`simulate-destroyer-belts.mjs --assert-nullsec`。
- **回归环境偶发说明（nullsec 模拟）**：在连续回归环境中 `simulate-destroyer-belts.mjs --assert-nullsec` 曾出现一次 EXIT 139；随后使用相同命令、Node v24.14.1 独立复跑完整通过并返回 EXIT 0，全部 0.0 校准结果正常。当前无法稳定复现，暂判定为环境/Node 进程偶发异常；按边界约定不修改模拟器、战斗代码或数值。若以后在独立冷启动环境连续复现，再单独立项排查。
- 未执行 git commit（按任务要求保留全部未提交改动）；`js/render3d/**` 在本轮零改动（沿用既有未提交状态）。

### 考古船第一阶段（仅舰体/制造/强化/蓝图/展示/专项审计，不实装考古玩法）

- **边界**：本轮只实装五艘考古船的"数据、制造、强化、蓝图、展示、专项审计"；**不实装**考古行动、遗迹、探针、考古装备、文物、ISK/LP 兑换或改装件。不改动任何现有舰船/装备/敌人/死亡空间/工业数值，不触碰 `js/render3d/**`，不引入新依赖，不执行 `git commit`。
- **一、独立数据表**：新增 `js/data/ships.js` 的 `ARCHAEOLOGY_SHIPS`（全局 `const`，随 index.html `<script defer>` 加载，无 `export`/无 `window.` 赋值），含苍鹭级/追迹级/星图级/远镜级/启明级五舰；`unlock.level` 分别为 1/15/35/55/80，`type` 依次为 `archaeology_frigate`/`destroyer`/`cruiser`/`battleship`/`archaeology_capital`。五舰均带 `bonuses.archaeologyScanStrength`（10/25/50/80/120）与 `archaeologyFailureDamageReduction`（0/0.05/0.10/0.15/0.20）。
- **二、统一解析**【已由下方'考古船战斗规则返修'废止】：`js/core/selectors.js` 的 `getShipConfigById` 扩展为 `STARTER_SHIPS || INDUSTRIAL_SHIPS || ARCHAEOLOGY_SHIPS` 三级回退；`createShipInstance(shipId)` 通用，存档只存 `shipId`。考古船不入 `STARTER_SHIPS`/`INDUSTRIAL_SHIPS`，战斗解析 `getShipConfig` 仍在 `isIndustrialShip ? INDUSTRIAL : STARTER` 范围内、显式排除考古。
- **三、蓝图与制造**：苍鹭级蓝图写入 `SHIP_BLUEPRINTS`（`{id:"heron",costISK:50000,level:1}`），在独立蓝图商店"舰船"类目以 50,000 ISK 永久解锁；其余四舰免蓝图。五条 `SHIP_ASSEMBLY_RECIPES`：苍鹭 Lv1/30s/30xp/部件 2+2+2=6（需蓝图）；追迹 Lv15/45s/60xp/3+3+4=10；星图 Lv35/70s/100xp/4+5+4=13；远镜 Lv55/100s/160xp/6+5+5=16；启明 Lv80/320s/500xp/10+8+10=28。**全部复用现有各档集成部件、无考古专属材料、无新生产公式、无莫尔石/月矿/深层/ faction/核心/协议依赖**，`requiresBlueprint:false` 的四舰材料不足时原子拒绝（`insufficient-components` 且库存不变）。
- **四、考古强化**：`js/systems/ship-enhancement.js` 新增显式 `archaeology` 角色（`getShipEnhancementRole` 在 combat 默认之前命中）；`getShipEnhancementBonuses` 的考古分支只返回 `{ role, hpMultiplier:growth, archaeologyScanMultiplier:growth }`，其中 `growth = 1 + 5级块数×0.05 + 余数×0.005`（即 +5/+10/+15 → 1.05/1.10/1.15，同时作用于舰体生命与扫描强度）。**严格不含** `weaponMultiplier`/`industryMultiplier`/`damageMultiplier`，不放大采矿/采气效率，不降武器伤害或工业加成。UI 展示 HP/扫描强度强化前后与固定失败反噬减免，不展示武器伤害或工业采矿加成。
- **五、行为边界**【已由下方'考古船战斗规则返修'废止】：考古船不可分配采矿/采气/冶炼/战斗；`getShipAssignmentRestriction` 与 `equipCombatShip` 对 `type.startsWith("archaeology")` 返回 `unsupported-combat`；旗舰战斗装备（`shipTypes:["capital","supercapital"]`）经 `canFitEquipmentOnShip` 对启明级（`archaeology_capital`）拒装。五舰不进入 0.0 战斗平衡配置。
- **六、UI 与展示**：舰船工程列表显示五舰；舰船卡片展示类别/考古角色、护盾/装甲/结构、扫描强度、失败反噬减免、燃料效率、槽位、制造等级/耗时/经验/部件；蓝图商店"舰船"类目新增苍鹭级并预览舰体与消耗。
- **七、专项审计**【已由下方'考古船战斗规则返修'废止】：新增 `tools/audit-archaeology-ships.mjs`（vm 沙箱加载完整脚本链，20 个审计点、255 条断言全绿，EXIT=0），覆盖五舰存在/精确属性/`unlock.level`/实例唯一性/统一解析/不入 STARTER·INDUSTRIAL·战斗/5 配方精确/仅苍鹭需 50000 ISK 蓝图/等级门槛/`insufficient-components` 原子拒装/派生部件均有配方/无考古·月矿·莫尔石·faction·深层·核心·协议/强化 +5/+10/+15→1.05/1.10/1.15 且不加武器/工业倍率/固定反噬减免/三个选择器 View State/启明级禁装旗舰装备/不在战斗解析/生产耗时在预算内/无意外状态变异。
- **八、verify.mjs 扩展**【已由下方'考古船战斗规则返修'废止】：新增"考古船第一阶段校验"数据驱动断言（5 舰/解锁等级 1·15·35·55·80/统一解析/不进三表与战斗/5 配方 level-time-xp-免蓝图(仅苍鹭)-部件总数 6·10·13·16·28-禁 materialCost/苍鹭 50000 ISK 蓝图·余者无蓝图/INDUSTRIAL 仍 10 舰/启明级禁装旗舰装备）；同步修正 `expectedShipMaterials` 四类考古材料总计、Lv.15/35/55 免蓝图配方计数（5→6/6→7/5→6）与蓝图商店类目计数（总 73→74、ships 17→18）。`verify.mjs` 整体 EXIT=0。
- **九、回归命令（9 条，真实 EXIT CODE 见最终报告）**：`verify.mjs`、`audit-archaeology-ships.mjs`、`audit-ship-enhancement.mjs`、`audit-industrial-productivity.mjs`、`audit-equipment-enhancement.mjs`、`calculate-ship-production-times.mjs --verify`、`calculate-ship-production-times.mjs --audit-mixed-battleship`、`simulate-destroyer-belts.mjs --assert-mixed-battleship`、`simulate-destroyer-belts.mjs --assert-nullsec`。
- **当前阶段 = 仅舰体**：考古船目前只有船体与制造/强化/蓝图/展示；扫描强度/失败反噬减免已作为静态属性与强化倍率写入，但**真正的考古扫描、遗迹解析、探针、考古装备、文物产出、ISK/LP 兑换、改装件**均未实装，后续单独设计，不得用本轮舰体数据反向约束未来考古玩法数值。
- **后续开发顺序（建议，未实装）**：①考古行动与遗迹系统（信号/扫描/解析流程）→ ②探针与考古装备（槽位消费 `archaeologyScanStrength`/反噬减免）→ ③文物产出与 ISK/LP 兑换 → ④改装件工程接入考古舰 → ⑤0.0 前置与考古旗舰在资源闭环中的定位。每一步独立设计、独立审计，沿用本阶段已建立的三表解析、配方复用与生产经济约束。

#### 考古船战斗规则返修（2026-07-22，策划重新明确）

- **返修背景**：策划明确"所有舰船（含工业舰、考古舰）均可参与战斗，能否打赢由舰体/装备/技能决定；'不纳入战斗平衡模拟'≠'禁止进入战斗'"。撤销先前错误的考古舰战斗禁令。
- **一、`js/core/selectors.js`**：`getShipAssignmentRestriction` 删除针对 `archaeology_*` 的 `unsupported-combat`；考古舰 `combat` 岗位检查现返回 `null`（允许分配）；采矿/采气/冶炼限制保持不变。
- **二、`js/core/actions.js`**：`equipCombatShip` 删除 `type.startsWith("archaeology")` → `unsupported-combat` 判断；`toggleShipAssignment` 现允许考古舰分配到 `combat`；`combat/start` 与 `enterDeathspace` 未新增考古禁令；无武器时仍按原规则返回 `no-weapons`。
- **三、`js/systems/combat.js`**：`getShipConfig` / `getActiveShip` 现通过统一 `getShipConfigById` 正确解析 `ARCHAEOLOGY_SHIPS`，不再错误回退成裂谷级；舰船实例、舰体配置、已安装装备保持同一艘船。
- **四、强化契约修复**：`getShipEnhancementBonuses` 考古分支改为返回完整安全中性字段 `{ role, hpMultiplier:growth, damageMultiplier:1, industryMultiplier:1, archaeologyScanMultiplier:growth }`；+5/+10/+15 的 HP 与扫描仍为 1.05/1.10/1.15；`damageMultiplier` 恒为 1、`industryMultiplier` 恒为 1；失败反噬减免保持舰体固定值；所有战斗选择器/结算均为有限数，无 `undefined`/`NaN`。
- **五、装备规则**：考古船可安装无 `shipTypes` 限制的普通战斗装备；启明级继续禁装 `shipTypes:["capital","supercapital"]` 的旗舰专用装备；未放宽现有旗舰装备适配范围；后续考古装备未实装。
- **六、专项审计返修**：`tools/audit-archaeology-ships.mjs` 删除"考古舰禁止战斗"/`getShipConfig(id)===null` 错误断言；新增五舰 `combat` 分配/`equipCombatShip`/装普通武器/`combat/start` 成功、实例-配置-实例一致、无武器 `no-weapons`+状态不变、苍鹭级&启明级真实战斗结算（最大生命有限、命中/闪避/伤害/燃料倍率均有限、无 undefined·NaN）、强化后参战（HP 获倍率、damageMultiplier 恒 1、扫描增长）、保留启明级禁装六件旗舰装备；明确区分"可参战"与"不作 destroyer-belts 基准"。**现 28 个审计块、339 条断言全绿，EXIT=0。**
- **七、`verify.mjs` 同步**：原"考古舰不得进入战斗解析器（避免被选入 0.0 战斗平衡）"断言改为"战斗解析器必须能解析 ARCHAEOLOGY_SHIPS（考古舰可参战）"，整体 EXIT=0。
- **八、文档**：`eveidle.md` §7.1.6 与本文档"考古船不进入战斗"统一改写为"所有考古舰均可参与战斗并安装适配的普通装备，但不享受舰船强化伤害加成，也不作为星带强度的基准舰船；其主要定位仍为考古扫描与遗迹解析"。

### 考古系统第二阶段 — 完整玩法实现（2026-07-22）

> **当前状态**：数据表、技能、15 遗迹、3 探针、15 装备、成功率/反噬、40 文物、ISK 出售/LP 兑换、在线/离线/队列/存档均已实装。**改装件与校准材料用途尚未实装**，待后续。

#### 一、数据层

- `js/data/archaeology.js` 新建：`ARCHAEOLOGY_TIERS`（五档配置）、`ARCHAEOLOGY_SITES`（15 遗迹）、`ARCHAEOLOGY_ARTIFACTS`（40 文物）、`ARCHAEOLOGY_PROBES`（3 探针）、`ARCHAEOLOGY_COMMON_WEIGHTS`（普通 ISK 文物 60/30/10 权重）、`ARCHAEOLOGY_STABILIZER_CAP`（0.60）、`ARCHAEOLOGY_DECODER_CAP`（0.75）、`ARCHAEOLOGY_SIGNAL_MIN_SECONDS`（3）、`ARCHAEOLOGY_REPAIR_SECONDS`（180）。辅助函数 `getArchaeologySite`/`getArchaeologyTierConfig`/`getArchaeologyArtifact`/`getArchaeologyArtifactsByTier`/`getArchaeologyProbe` 均导出到 `window`。
- `ARCHAEOLOGY_SHIP_TYPES` 从 `archaeology.js` 移至 `js/data/ships.js`（解决 `equipment.js` 先于 `archaeology.js` 加载的 `ReferenceError` 时序问题）。
- `js/data/equipment.js` 新增 15 件考古装备（5 档 × 3 槽位：遗迹分析仪/信号稳定器/文物译码器），`bonuses` 分别携带 `archaeologyScan`/`archaeologyStabilizer`/`archaeologyDecoder`，`shipTypes` 限定 `ARCHAEOLOGY_SHIP_TYPES`，`archaeology:true` 供下游识别。
- `js/data/ammunition.js` 新增 3 条探针制造配方，输出 `{type:"probe",itemId,qty:20}`；`EQUIPMENT_ENGINEERING_CATEGORIES` 新增 `archaeology` 和 `probes` 两个类别（总 6→8）。
- `js/data/base.js`：`INITIAL_SKILLS` 新增 `archaeology: { lvl: 1, xp: 0 }`。

#### 二、核心层

- `js/systems/archaeology.js` 新建：`getArchaeologyFittedBonuses`（装备增益解析，含强化倍率 `1+0.1×enhLvl`，受上限约束）、`computeArchaeologyScanStrength`（成功率分子）、`computeArchaeologySuccessChance`（`clamp(0.05,0.95,0.50+(scan-diff)×0.01)`）、`getArchaeologyShipHp`/`resetArchaeologyShipHp`/`applyArchaeologyDamage`（护盾→装甲→结构反噬）、`getArchaeologyInterferenceSeconds`（`max(3, site.time×0.25)`）、`resolveArchaeologyDrops`（含普通/额外/独特/校准/LP 五层掉落，`randomValue` 可注入确保审计可重复）、`resolveArchaeologyCycle`（在线/离线共用的单次结算）、`sellArchaeologyArtifacts`（含 `all:true` 全部遍历模式）、`redeemArchaeologyArtifacts`（含全部兑换模式）、`getArchaeologyDisplayState`（纯展示状态，返回舰船/遗迹/探针/文物/日志）。全部函数通过 `window` 导出。
- `js/core/state.js`：`gameState.archaeology` 初始化含 `activeSiteId`/`activeProbeId`/`progress`/`startedSiteId`/`startedProbeId`/`shipHp`/`repairUntil`/`repairInstanceId`/`interferenceUntil: 0`/`log`。`SKILL_LABEL.archaeology = "考古"`。
- `js/core/resources.js`：`RESOURCE_NAMESPACE_CONFIG` 新增 `probe`/`artifact`/`calibration` 三个命名空间；加载后自动注册所有探针和文物资源。
- `js/core/events.js`：新增 8 个考古事件契约：`archaeology:attemptCompleted`/`success`/`failure`/`artifactFound`/`shipDisabled`/`repairCompleted`/`artifactSold`/`artifactRedeemed`。`artifactSold`/`artifactRedeemed` 的 `artifactId` 字段为可选（sell-all/redeem-all 路径不携带）。
- `js/core/selectors.js`：`getShipAssignmentRestriction` 白名单新增 `archaeology`（仅 `bonuses.archaeologyScanStrength>0` 的舰船可分配）；`getNavigationDisplayState` standalonePages 新增 `archaeology:"archaeology-panel"`；`getHangarDisplayState`/`getSkillShellDisplayState`/`getCurrentActivityDisplayState` 新增考古图标。
- `js/core/actions.js`：`dispatchGameAction` 新增 6 条考古动作分支（`selectSite`/`selectProbe`/`start`/`stop`/`sellArtifact`/`redeemArtifact`）。`ArchaeologyStateActions` 对象实现准入校验（遗迹等级/技能/探针/燃料/舰船分配/维修状态）。
- `js/core/tick.js`：`gameTick` 新增 `archaeology` 分支：处理维修完成/暂停、干扰暂停，`while(progress≥actualTime)` 循环调用 `resolveArchaeologyCycle`，push 日志到 `arch.log`，失败设置 `interferenceUntil`，调用 `completeQueuedActionCycle`。
- `js/core/offline.js`：`getOfflineActionDescriptor("archaeology")` 返回离线结算描述符，循环调用 `resolveArchaeologyCycle(gameState, Date.now(), "offline")`。
- `js/systems/manufacturing.js`：`applyEquipEngOutput` 新增 `probe` 输出类型（ResourceRegistry.add "probe:" + itemId）；`getEquipEngOutputText` 对应显示。
- `js/core/persistence.js`：`migrateArchaeologyState()` 幂等性迁移（补齐 archaeology 子对象、resource pools、`interferenceUntil` 字段；非活跃考古时清除 locked startedSiteId/startedProbeId；校验 shipAssignments 引用有效性）。在 `finalizeEquipmentStateAfterLegacyMigrations` 中调用。

#### 三、UI 层

- `js/ui/archaeology-render.js` 新建：`renderArchaeologyPage()` 完整考古页面（分配舰船信息/HP条、遗迹选择 5 档 × 3 格卡片、探针选择 3 张卡、进度条、开始/停止控制、文物库存含单件/全部出售与兑换、校准材料"未来用途"标签、行动日志最近 12 条）。所有交互通过 `dispatchGameAction` 触发。
- `index.html`：新增侧边栏"🛰️ 考古"导航项（`data-page="archaeology"` + `data-lv="archaeology"`）、`archaeology-panel` 面板容器（`display:none`）。新增 3 个脚本标签：`data/archaeology.js`（弹药后、state 前）、`systems/archaeology.js`（装备强化后、行星前）、`ui/archaeology-render.js`（行星渲染后、tick 前）。
- `js/ui/shell-render.js`：`getManagedPanels`/`getGenericSkillPanels` 增加 `archaeology-panel`；`renderCurrentNavigation` 增加 `archaeology` 页面分支。
- `css/panels.css`：新增 ~100 行 `.archaeology-*` 样式（舰船信息卡、遗迹网格、探针行、进度条、文物列表、日志）。

#### 四、本轮修复（Task #85 专项审计过程中发现并修复的真实缺陷）

1. **`sell-all` 类型匹配 bug**：`sellArchaeologyArtifacts` 的 sell-all 路径检查 `artifact.category === "common"`，但数据表实际使用 `"common_isk"`。修改为 `"common_isk"`。
2. **sell-all/redeem-all 事件契约**：`events.js` 中 `artifactSold` 和 `artifactRedeemed` 契约原要求必填 `artifactId`，但全部出售/兑换路径不携带单一 artifactId。将 `artifactId` 从 required 字段移除。
3. **`migrateArchaeologyState` 幂等性确认**：验证旧存档缺 archaeology/resource pools/interferenceUntil 时均可安全补齐，连续调用两次状态不变。
4. **`ARCHAEOLOGY_SHIP_TYPES` 定义与加载顺序**：确认 `ships.js` 中的唯一定义在 `equipment.js` 和 `archaeology.js` 之前加载，消除 `ReferenceError`。
5. **`tick.js` 括号嵌套**：修复考古分支提前关闭外层 `if (gameState.currentAction.active)` 导致 `key` 变量脱离作用域的问题。
6. **`state.js` `interferenceUntil` 字段**：确认初始状态包含 `interferenceUntil: 0`（与 persistence migration 保持一致）。

#### 五、专项审计（`tools/audit-archaeology-system.mjs`）

新建审计文件，**138 条断言全部通过**（EXIT=0），覆盖：

| 分区 | 断言数 | 覆盖内容 |
|:---|:---|:---|
| A 加载与初始状态 | 19 | 脚本无 `ReferenceError`、`ARCHAEOLOGY_SHIP_TYPES` 唯一定义、`interferenceUntil` 类型正确、旧存档补齐、幂等性 |
| B 舰船与遗迹准入 | 17 | 舰船创建/分配、遗迹等级门槛、三级 50% 成功率基准（I=21/III=121/V=300）、探针/燃料拒绝、考古舰可战斗 |
| C 开始/停止/tick | 23 | start 锁定 `startedSiteId`/`startedProbeId`、成功消耗探针+燃料+XP、失败反噬 HP 减少+无 XP、资源不足原子拒绝、停止清空锁、tick 不重复结算 |
| D 文物掉落/出售/兑换 | 27 | ID 唯一、单件出售 3→2、sell-all（含 `common_isk` 匹配修复）、LP 保留、校准保留、第二次全部出售无收益、redeem-all LP 计算、不可兑换保留、事件契约 payload |
| E UI 显示态 | 9 | `successPercent` 非 NaN、level 数字、probe stock 非 NaN、assignedShip 合法 |
| F 离线与兼容性 | 3 | 离线 descriptor 存在、旧存档补齐 |

#### 六、回归命令（全部 10 条，EXIT=0）

| 命令 | 退出码 |
|:---|:---|
| `node tools/verify.mjs` | 0 |
| `node tools/audit-archaeology-ships.mjs` | 0 |
| `node tools/audit-archaeology-system.mjs` | 0 |
| `node tools/audit-equipment-enhancement.mjs` | 0 |
| `node tools/audit-ship-enhancement.mjs` | 0 |
| `node tools/audit-industrial-productivity.mjs` | 0 |
| `node tools/calculate-ship-production-times.mjs --verify` | 0 |
| `node tools/calculate-ship-production-times.mjs --audit-mixed-battleship` | 0 |
| `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` | 0 |
| `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` | 0 |

#### 七、浏览器手测

- 页面从侧边栏进入考古页面（🛰️ 考古导航项），面板正确显示遗迹、探针、文物库存（空）。
- 在船坞将考古舰分配至考古岗位后，考古页面展示舰船 HP（护盾/装甲/结构）。
- 选择遗迹和探针，开始/停止解析，状态切换正常。控制台无 `ReferenceError`/`TypeError`/`NaN`。
- 文物库存由 tick 结算产生后，可逐件出售/兑换，sell-all/redeem-all 正确遍历全部 ISK/LP 文物。
- 窄窗口下考古面板可纵向滚动，按钮不被遮挡。
- **未触碰 `js/render3d/**`、未修改策划数值、未执行 `git commit`。**

#### 八、已知待后续阶段完成

- 改装件系统接入考古舰（rig 槽位消费）。
- 0.0 前置条件与考古旗舰在资源闭环中的定位。
- 校准材料实际用途（当前仅作为掉落物产出，标注"未来用途"）。
- 研究/拷贝/发明复合体系与远古蓝图碎片的衔接（历史讨论在 `eveidle.md` 附录中保留）。
- 考古装备强化后的成功率/反噬/掉落率精确验证（当前只验证 +0 基准）。
- **边界守约**：五舰基础数值/制造配方/耗时/敌人·星带数值/启明级旗舰装备限制均未改动；未实装考古行动/探针/遗迹/文物/改装件；未触碰 `js/render3d/**`；未 `git commit`。

### 改装件（rig）系统全量实装（Phase 3B：数据/制造/装配/效果/UI/审计/经济闭环）

- **边界守约**：不修改成功率公式、不修改 calibrationRate、不修改其他已批准数值、不触碰 `js/render3d/**`、不执行 `git commit`、不创建 nul 文件。
- **一、数据层**（`js/data/equipment.js`）：`RIG_SERIES`（9 系列）× `RIG_TIER_META`（5 档）程序化生成 45 件 rig 定义。战斗 3 系列（护盾/装甲/结构容量 +4/6/8/11/15%）、工业 3 系列（采矿/采气/冶炼 +4/6/8/11/15%）、考古 3 系列（扫描 +5/7/9/12/15%、干扰 -10/14/18/24/30%、燃料 -8/11/14/18/22%）。技能门槛 1/15/35/55/80，配方消耗对应档位校准材料 1/1/2/2/3 份 + 精炼矿物。装备工程新增 `rigs` 分类（第 9 类）。
- **二、校准经济重校**：先复核五档 50% 成功率基准（同级船+0、门槛技能、满 high 槽同级 analyzer+0、普通探针、无 rig，五档全 50%）；再新增 `tier.calibrationAmount` 字段（I=1/II=1/III=2/IV=2/V=3），掉落层改读档位数量（唯一写入点，在线/离线同路径）。经济结果：V 档装满四槽期望 ≈ 133.3 小时（I/II/III/IV 全船 0.8/2.2/13.3/40.0h），已固化进 `audit-rigs.mjs` J 区防单侧修改。
- **三、装配语义**（`js/systems/rigs.js` + `js/core/actions.js`）：**安装即消耗、拆卸即销毁、替换=旧毁新装（原子）、不可强化、不可出售**。专属 Action `hangar/fitRig`/`destroyFittedRig`/`replaceFittedRig`；事件契约 `rig:manufactured/fitted/destroyed/replaced`（仅 Action 成功后发送）。同 `stackGroup` 每舰唯一（`canFitRig` 前置校验）；战斗中禁调；`setFittingSlot`/`resetFitting` 对 rig 槽走销毁语义。防强化双守卫（强化列表过滤 + Action 拒绝 `rig-not-enhanceable`）；防复制（`normalizeEquipmentState` 丢弃游离 rig 实例）。
- **四、效果接线**（`getRigModifiers` 加法聚合、无强化倍率）：战斗容量三层乘算（priority 50，只生效一次）；采矿/采气经既有装备循环（rig 槽不吃 high 槽放大器）；冶炼 `rigMods.smeltingSpeed` 加法并入；考古扫描只乘 basePart；干扰只作用新产生；燃料确定性累计器（`rigFuelMultiplier = max(0,1-reduction)`，余数归一化）。舰船强化/fleetSupport 均不放大 rig。效果验收 `tools/_verify-rig-effects.mjs` 58/58 PASS。
- **五、UI**（`js/core/selectors.js` + `js/ui/shell-render.js`）：装配轨道 27 段布局第 25-27 段 rig 槽解禁（超出舰船 rig 槽数仍禁用）；候选列表按 `canFitRig` 过滤同组已装；安装/替换/销毁三路径均有不可跳过的 confirm（明示"销毁不返还"）；清空装备文案区分普通装备返还与 rig 销毁；错误 toast 覆盖 combat-active/same-stack-group-exists/slot-occupied/equipment-unavailable。
- **六、专项审计** `tools/audit-rigs.mjs`：A 数据完整性 45 件 / B 制造门槛 / C 装配·销毁·替换 / D 普通装备不受影响 / E 效果计算 / F 防放大 / G 存档迁移 / H UI 显示态 / I 回归 / J 经济固化，**425 断言全 PASS，EXIT=0**。排查记录：首跑 D3/D4 失败与 G 区崩溃均为测试脚手架缺陷——①普通装备卸载后为"实例保留 installedOn=null"语义而非归还 inventory 字符串（断言按真实语义改写）；②`freshState()` 未清初始舰，其 fitted 残留 `eq_1` 与重置 `nextInstanceId=1` 后新分配 ID 碰撞，被 normalize 防复制逻辑正确清空（改为清空初始舰）。实现零缺陷。
- **七、旧断言随系统更新**（仅计数/排除，非数值）：`verify.mjs` 脚本计数 35→36（+`js/systems/rigs.js`）、装备工程分类 8→9（+`rigs`）；`audit-archaeology-ships.mjs` 脚本计数 35→36；`audit-equipment-enhancement.mjs` A5 启发式（id 含 "fuel"）排除 rig 槽装备（`rig_archaeology_fuel_*` 并非燃料资源，其不可强化性由 audit-rigs F3/F4 断言）。
- **八、文档**：`eveidle.md` 新增 §4.2.7 改装件系统、更新 §4.2.6 校准掉落数量与出售说明、更新技能表 rigEngineering 行；`RIG_SYSTEM_IMPLEMENTATION_PLAN.md` 为本轮蓝本。
- 未执行 git commit（按任务要求保留全部未提交改动）。
- **九、回归命令（12 条全部 EXIT=0）**：`verify.mjs`、`audit-rigs.mjs`、`audit-archaeology-system.mjs`、`audit-archaeology-ships.mjs`、`audit-equipment-enhancement.mjs`、`audit-industrial-productivity.mjs`、`audit-ship-enhancement.mjs`、`simulate-archaeology-user-flow.mjs`、`_verify-rig-effects.mjs`、`_verify-calib-amount.mjs`、`_verify-rigs-hardcheck.mjs`、`calculate-ship-production-times.mjs --verify`。另 `simulate-destroyer-belts.mjs --assert-mixed-battleship` 首跑出现一次 EXIT=139（Segmentation fault），独立复跑 EXIT=0 且 0.0 校准结果正常，与 2026-07-22 工业舰条目记录的 nullsec 偶发同类（环境/Node 进程偶发，非代码回归）。浏览器手测因环境无自动化能力未执行，由无头集成审计（真实 Action/selector 全链路，audit-rigs 425 断言）替代，UI 交互留待用户在 http://localhost:8015 人工点验。

### Phase 3B 最终 UI 返修（六项验收缺口，只修 UI/显示态，不动数值/经济/Action 语义）

- **边界守约**：未修改改装件数值/成功率/calibrationRate/配方需求、未触碰燃料累计器与 `js/render3d/**`、未执行 `git commit`、未创建 nul 文件。
- **一、改装件二级分类与档位筛选**（`selectors.js` / `actions.js` / `state.js` / `manufacturing-render.js` / `index.html`）：
  改装件页新增类别（战斗/工业/考古，默认战斗，无"全部分类"）+ 档位（全部/I~V，默认全部）双筛选。筛选计算全部在 `getEquipmentEngineeringDisplayState` 内完成（新增 `rigFilters`/`visibleCount` 显示态字段），UI 只消费结果。新增 Action `manufacturing/selectEquipEngRigFilter`（只改 `equipEngRigSub`/`equipEngRigTier` 与 `equipEngTarget` 详情落点，**绝不触碰 `startedEquipEngTarget`**——制造中切换筛选产物不变）；`selectEquipmentCategory` 切到 rigs 时自动对齐筛选。state 默认新增 `equipEngRigSub:"combat"`/`equipEngRigTier:"all"`（旧档缺字段由 selector 兜底，不改存档键语义）。按钮带 `selected`/`aria-selected`，容器 `flex-wrap` 窄窗口自动换行。标题计数改为筛选后数量（战斗+全部=15、任一类别任一档=3）。搜索时将显示态选中项同步回 `equipEngTarget`，详情自动落第一个可见配方。
- **二、校准材料中文名**（`resources.js` / `selectors.js` / `manufacturing-render.js`）：ResourceRegistry 新增 `getResourceDisplayName(id)`（namespace:key → 注册名；懒注册 name===key 或解析失败回退原始键；非 namespace 形式如中文材料名原样返回）。`detail.materials` 每行同时保留 `material`（内部键）与 `displayName`；渲染层只展示 `displayName`。`calibration:art_i_calib`~`art_v_calib` 全部显示「校准基体 I~V 型」真实中文名。存档键/内部寻址不变。
- **三、装配环第 4+ 改装槽**（`selectors.js` / `shell-render.js`）：装配环容量**随舰船 rig 槽数动态** = `24 + slots.rig`（启明级 4→28 格、超级旗舰 5→29 格），rig 索引自 24 连续；`getOrbitRigCapacity()` 保留为全 DB 最大 rig 槽数（当前 5）用于"能否支持最大槽"断言；`buildOrbit` 分段角度按 `display.orbitSlots.length` 真实长度计算，不再硬编码 27。裂谷 1/星图 2/远镜 3/启明 4 启用数正确，启明级第 4 槽可装/替/毁；高中低 8/8/8 不受影响。
- **四、同系列升级替换候选**（`selectors.js` / `shell-render.js`）：显示态新增 `rigCandidates[slotIndex]`（每槽调用 `canFitRig(state,instance,id,slotIndex)`，排除当前槽自身的同组判定）；`openOrbitSelect` rig 槽改用按槽候选。结果：已装护盾容量 I 的槽点开可见 II~V 升级件；空槽仍过滤其他槽已装同组；Action 原子闸门原样保留（UI 过滤不替代）。
- **五、清空销毁确认**（`shell-render.js`）：`resetFitting` 前从真实显示态枚举已装 rig，确认框逐件列出将销毁的改装件中文名（同名合并 ×N），明示普通装备保留为未安装实例 vs rig 永久销毁；无 rig 不显示虚假清单；原生 `confirm`（不受设置开关控制）；取消不调用 Action。
- **六、审计扩展** `tools/audit-rigs.mjs`：H1/H2 随动态容量更新；新增 K 区 99 条断言——三类别各 15/每类每档 3/过滤纯净/搜索组合/制造中产物不变/五档校准 displayName/45 件配方不暴露 `calibration:` 键/rigCandidates 占用槽升级+空槽过滤/Action 闸门兜底/装配环 24+cap 与索引连续/四舰启用数/启明级第 4 槽装替毁/清空清单数据源。**总计 524 断言全 PASS，EXIT=0**。
- **回归**：12 条回归命令全 EXIT=0（verify / audit-rigs / audit-archaeology-system / audit-archaeology-ships / audit-equipment-enhancement / audit-industrial-productivity / audit-ship-enhancement / simulate-archaeology-user-flow / _verify-rig-effects / _verify-calib-amount / _verify-rigs-hardcheck / calculate-ship-production-times --verify），另 _verify-rigs-50pct 亦 EXIT=0。批量串跑时 industrial-productivity 出现一次 EXIT=139（Segmentation fault），独立复跑 EXIT=0，与既往记录的 Node 进程偶发同类，非代码回归。全部改动文件 `node --check` 通过。

#### UI最终返修（2026-07-23 复核修正与补齐）
- **装配环容量修正（关键）**：原实现用全局 `getOrbitRigCapacity()`（=5）把**每艘船**都渲染成 29 格，导致启明级（4 rig）也显示 29 格、与"orbitSlots总数28 / rig 索引24~27"硬要求冲突。改为 `24 + slots.rig` 的**按舰动态**容量：启明级=28（rig 24~27）、超级旗舰=29（5 rig 全可达），同时满足 三#1（支持数据库最大 rig 槽数）与 六#7（启明级总数28）。`buildOrbit` 早已用真实 `orbitSlots.length` 算角度，无需改。
- **审计升级**：`tools/audit-rigs.mjs` 524 → **534 断言**（H1 改为"rig 段=本舰 rig 槽数"；K7 改为"总格数=24+本舰 rig 槽数"并显式断言启明级=28、rig 索引 24~27；新增 K9 清空语义——取消=状态不变、确认=普通装备保留(installedOn=null)+rig实例删除；新增 K10 全部相关 display state 无 undefined/NaN）。EXIT=0。
- **七、可复现夹具**：新增 `tools/fixtures/rig-ui-test-save.json`（真实 `SaveManager` 格式，由游戏自带 loader 生成并验证导入）。含启明级+裂谷级、护盾容量I/II、装甲容量I、考古燃料I、普通装备实例(t1_small_laser)、足够一次 T1 改装件制造的真实材料（矿物+校准基体）。无进行中战斗/行动。导入步骤：游戏内「存档」页 → 选择文件导入该 JSON（与真实导出格式一致）。
- **八、浏览器验收（如实说明）**：本环境无法操作真实浏览器，未执行真实点击。验证以审计(534)+夹具导入模拟（启明级 orbit=28/4启用/索引24~27/候选4/T1可制造/校准材料=50）替代；夹具可供 Codex 在生产 index.html 中经真实"导入存档"流程复验 八#1~#19。逻辑层无 ReferenceError/TypeError/NaN（审计 K10 守卫 + 运行无报错）。
- **九、十二条回归真实 EXIT CODE（全 0）**：
  1. `node tools/verify.mjs` → 0
  2. `node tools/audit-rigs.mjs` → 0（534/534）
  3. `node tools/audit-archaeology-ships.mjs` → 0（339）
  4. `node tools/audit-archaeology-system.mjs` → 0（148）
  5. `node tools/simulate-archaeology-user-flow.mjs` → 0（54）
  6. `node tools/audit-equipment-enhancement.mjs` → 0
  7. `node tools/audit-ship-enhancement.mjs` → 0
  8. `node tools/audit-industrial-productivity.mjs` → 0
  9. `node tools/calculate-ship-production-times.mjs --verify` → 0
  10. `node tools/calculate-ship-production-times.mjs --audit-mixed-battleship` → 0
  11. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` → 0
  12. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` → **0（须用系统 Node 24；托管 Node 22 在重型 0.0 模拟下偶发 V8 Segmentation fault / EXIT=139，属环境而非代码回归）**
- **边界守约（本轮）**：未修改 45 件改装件数值/成功率/calibrationRate/配方需求/舰船槽位数据/燃料累计器；未触碰 `js/render3d/**`；未回退其他未提交改动；未 `git commit`；未创建 nul 文件。

### Phase 3B 浏览器验收返修（2026-07-23 第二巡：真实浏览器修复 + 审计补强）

**一、装配面板容量改装件显示错误（真实缺陷）**
- **根因**：`getShipFittingDisplayState()` 的 `stats` 仅用 `enhancement.hpMultiplier`，未接入 rig 容量倍率。
- **修正**：加入 `getRigModifiers(state, instance)` 读取 `shieldCapacityPercent / armorCapacityPercent / structureCapacityPercent`，HP 公式统一为 `baseHP × enhancement.hpMultiplier × (1 + rigMods.XCapacityPercent)`。与 `getCombatMaxHpFromState` 同源调用 `getRigModifiers`，无两套公式漂移。
- **验证**：启明级 +0 + 护盾容量 I：2900 → 3016 ✓、装甲容量 I：1100 → 1144 ✓、结构容量 I：800 → 832 ✓。清空后恢复 2900/1100/800。三容量不同类型 HP 各×1.04（不交叉叠加 → 3016/1144/832）。

**二、普通装备实例卸下后候选消失（真实缺陷）**
- **根因**：`getShipFittingDisplayState()` 的 `inventoryBySlot` 仅遍历 `state.equipment.inventory` 字符串池，未加入 `state.equipment.instances` 中 `installedOn === null` 的游离非 rig 实例。
- **修正**：`inventoryBySlot` 合并两源，实例候选使用 `instanceId`（`isInstance:true`），`setFittingSlot` 通过 `resolveEquipmentReference` 复用同一 instanceId 重新安装，不退化到 itemId、不创建新实例。rig 实例不入候选（拆卸即销毁，fail closed）。
- **端到端链路验证**：安装 t1_small_laser → resetFitting → 候选含 instanceId → setFittingSlot(instanceId) → fitted.high[0] 同一 ID → 装备总数不变 → JSON 序列化读取往返后相同 → 候选仍可见 → 复装成功。rig 实例删除不入候选。

**三、夹具稳定性**
- **问题**：`rig-ui-test-save.json` 导入后 2 艘船，但持久化迁移检查 `inventory.ships` 无 `miner_frigate` 后追加为 3 艘，刷新前后不一致。
- **修正**：夹具预置 `miner_frigate`（冲锋者级）实例，导入即 3 艘=刷新后终态。不改迁移玩法逻辑。

**四、审计升级：audit-rigs.mjs 534 → 575 断言**
- **L 区（14 断言）**：resetFitting → 游离实例保留 → getShipFittingDisplayState → inventoryBySlot 含 instanceId → 复用 inst 复装 → 总数不变 → 保存/读取往返 → 游离 rig 不入候选 → Action 边界（null 卸下保留实例）。
- **M 区（37 断言）**：装配面板 HP 含 rig 倍率（护盾/装甲/结构容量 I 各 4%→3016/1144/832）、清空恢复基础、同 stackGroup 排重（第4槽被拒）、系列叠加不同 HP 类型、+5 强化 × rig 倍率。
- K9 改述为 Action 边界测试（仅描述，不冒充浏览器取消点击）。

**五、回归 12 条全 EXIT=0**
 1. `node tools/verify.mjs` → 0（36 JS / 4 CSS / 214 DOM，HTTP 200）
 2. `node tools/audit-rigs.mjs` → **0（575/575）**
 3. `node tools/audit-equipment-enhancement.mjs` → 0
 4. `node tools/audit-ship-enhancement.mjs` → 0
 5. `node tools/audit-industrial-productivity.mjs` → 0
 6. `node tools/audit-archaeology-system.mjs` → 0（148）
 7. `node tools/audit-archaeology-ships.mjs` → 0（339）
 8. `node tools/simulate-archaeology-user-flow.mjs` → 0（54）
 9. `node tools/calculate-ship-production-times.mjs --verify` → 0
10. `node tools/calculate-ship-production-times.mjs --audit-mixed-battleship` → 0
11. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` → 0
12. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` → **0（系统 Node 24）**

**边界守约**：不改数值/配方/成功率/掉率/燃料累计器/舰船/战斗数值；未碰 `js/render3d/**`；未回退其他未提交改动；未 commit；无 nul 新增。
**未宣称浏览器最终验收通过**，夹具 `tools/fixtures/rig-ui-test-save.json` 可供 Codex 在生产 `index.html` 导入复验八#1~#19。

---

## 2026-07-23 — 装备强化成功率边际递减方案实装

### 改动文件

| 文件 | 改动 |
|---|---|
| `js/systems/equipment-enhancement.js` | `getEquipmentEnhancementSuccessChance` 重写为新公式；新增 `getEquipmentEnhancementSuccessBreakdown`；`getEquipmentEnhancementDisplayState` 加 `successBreakdown` 字段 |
| `js/core/selectors.js` | instanceCards 与 stack 均传递 `successBreakdown` |
| `js/ui/shell-render.js` | 成功率 `<span>` 增加 `title` 属性显示分解明细 |
| `EQUIPMENT_ENHANCEMENT_IMPLEMENTATION_PLAN.md` | §0 旧公式替换为新公式 |
| `tools/audit-equipment-enhancement.mjs` | 新增 H 区 60+ 断言：分段边界/期望次数/经济回归/Action 确定概率/失败语义/canEnhance 不回归/舰船保障 |

### 新成功率公式

```
skillBonus    = 0.02×min(gap,10) + 0.005×min(max(gap−10,0),15) + 0.001×max(gap−25,0)  [cap 0.30]
levelPenalty  = 0.015×min(L,5) + 0.03×min(max(L−5,0),5) + 0.05×min(max(L−10,0),5) + 0.08×max(L−15,0)
p(L)          = clamp(0.50 + skillBonus − levelPenalty, 0.05, 0.80)
```

### 新旧对照（Lv.80 eng, Lv.1 eq）

旧公式直到当前强化 +101 仍为 95%（+102 时才降至 94.5%），新公式显著增加了中高强化等级的难度。

| 当前等级 | 旧公式 | 新公式 |
|---|---|---|
| +0 | 95% | 80% |
| +5 | 95% | 72.5% |
| +10 | 95% | 57.5% |
| +15 | 95% | 32.5% |
| +20 | 95% | 5% |
| +30 | 95% | 5% |
| +35 | 95% | 5% |
| +100 | 95% | 5% |

### 期望尝试次数（Lv.80 eng, Lv.1 eq）

| 目标等级 | 期望次数 |
|---|---|
| +5 | 6.5 |
| +10 | 14.0 |
| +15 | 24.8 |
| +20 | 69.8 |
| +30 | 269.8 |
| +35 | 369.8 |
| +100 | 1669.8 |

### UI 透明度

鼠标悬停成功率数字时，`title` 展示：`基础50% · 技能加成+X% · 强化惩罚−Y% · 最终Z%`。

### 边界守约

- ✅ 未改舰船强化成功率（独立公式）
- ✅ 未改改装件系统
- ✅ 未改效果倍率/矿物成本/失败规则/强化经验/donor 消耗
- ✅ 未改制造配方/装备基础数值/存档结构
- ✅ 未碰 `js/render3d/**`
- ✅ 未 git commit
- ✅ 无 nul 文件

### 回归（12 条全 EXIT=0）

1. `node tools/verify.mjs` → 0
2. `node tools/audit-equipment-enhancement.mjs` → 0（含新 H 区 60+ 断言）
3. `node tools/audit-ship-enhancement.mjs` → 0
4. `node tools/audit-rigs.mjs` → 0（599 PASS）
5. `node tools/audit-industrial-productivity.mjs` → 0
6. `node tools/audit-archaeology-system.mjs` → 0（148 PASS）
7. `node tools/audit-archaeology-ships.mjs` → 0（339 PASS）
8. `node tools/simulate-archaeology-user-flow.mjs` → 0（54）
9. `node tools/calculate-ship-production-times.mjs --verify` → 0
10. `node tools/calculate-ship-production-times.mjs --audit-mixed-battleship` → 0
11. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` → **0**
12. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` → **0**

---

## 2026-07-24 — 舰船强化与装备强化共用边际成功率

### 新增文件
- `js/systems/enhancement-chance.js` — 共用边际递减成功率纯函数层，`getEnhancementChance` / `getEnhancementChanceBreakdown`

### 改动
- 装备强化与舰船强化均委托该共用层，消除两套复制公式漂移风险。
- 成功率范围 **5%～80%**（旧装备公式 10%～95%、旧舰船公式 5%～95%）。
- 技能加成边际递减：前10级每级+2%，第11-25级每级+0.5%，第26级以后每级+0.1%；**最高+30%**。
- 强化惩罚递增：+0~+5每级−1.5%、+5~+10每级−3%、+10~+15每级−5%、+15以后每级−8%。

### 舰船失败规则变更
- 旧：失败**清零**，获得一半成功基础经验
- 新：失败**等级保持**（不清零、不降级、不损毁），**0 XP**
- 每次尝试仍消耗对应舰级三种集成部件各1件
- 成功经验和战斗/工业/考古收益完全不变
- 无限强化保留

### UI 更新
- 成功率数字 hover 显示分解明细：`基础50% · 技能加成+X% · 强化惩罚−Y% · 最终Z%`
- 船坞卡片文案改为"失败 0 XP，等级保持"
- 强化确认弹窗显示部件明细
- 失败 toast 改为"等级保持 +N，本次部件已消耗"

### 审计
- `tools/audit-ship-enhancement.mjs` 完全重写：A 共用公式矩阵(70×7×10)、B 期望次数(20个锚点)、C Action 真实语义(8子项)、D 收益回归(25断言)、E 舰级直觉(5断言)、F 六舰级报告
- 六舰级制造时间由真实 SHIP_COMPONENT_RECIPES 数据驱动，硬锁锚点：护卫123s / 驱逐183s / 巡洋272s / 战列388s / 旗舰900s / 超级旗舰1350s
- `tools/verify.mjs` 脚本计数 36→37，舰船公式边界与失败断言更新
- `tools/audit-archaeology-ships.mjs` 脚本计数 36→37

### 回归（12 条全 EXIT=0）
1. `node tools/verify.mjs` → 0（37 JS）
2. `node tools/audit-equipment-enhancement.mjs` → 0
3. `node tools/audit-ship-enhancement.mjs` → 0
4. `node tools/audit-rigs.mjs` → 0（599 PASS）
5. `node tools/audit-industrial-productivity.mjs` → 0
6. `node tools/audit-archaeology-system.mjs` → 0（148 PASS）
7. `node tools/audit-archaeology-ships.mjs` → 0（339 PASS）
8. `node tools/simulate-archaeology-user-flow.mjs` → 0
9. `node tools/calculate-ship-production-times.mjs --verify` → 0
10. `node tools/calculate-ship-production-times.mjs --audit-mixed-battleship` → 0
11. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` → 0
12. `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` → 0

### 边界守约
未改舰船/战斗/装备/改装件/考古数值；未碰 `js/render3d/**`；未 git commit；无 `nul` 文件。

## 2026-07-25

### 增强剂 Phase 2B 二次集成返修——简化离线增强剂结算

**策划记录写入 eveidle.md**：
- 正式记录"仓库/货舱容量限制未来统一删除"的策划决定（含货柜管理技能、货柜扩容改装件、相关UI和在线容量判断）。
- 正式记录"离线战斗快速模拟将在成就系统之前单独实装"及战斗增强剂规则方向。
- 更新增强剂离线规则文档，匹配简化三段结算方案。

**简化离线增强剂结算**（`js/core/offline.js`）：
- 重构 `settleOfflineWithBoosters`：删除逐段循环（segmentSeconds）、删除 `timeBySkill` 事后扣除方案。
- 新算法：先以全增强剂倍率运行一次 `settleOfflineActions`（接受 ±1 周期近似误差），收集 `timeBySkill`；然后按各行动累计运行秒数，逐槽调用 `applyBoosterTimeConsumption` 精确扣除。
- 采矿（miningSpeed/miningYield）和考古（archaeologySpeed/archaeologyRare）的扣除取 `min(slotAvailableSeconds, actionRuntimeSeconds)`，最多覆盖至耗尽。
- 战斗增强剂（combatWeapon/combatRepair）离线期间完全冻结，不参与扣除。
- 冶炼、制造、采气等其他行动不消耗增强剂。
- 保留离线结束后同步 `boosters.lastTick = Date.now()`。

**审计重写**（`tools/audit-boosters.mjs` ZO～ZY 区）：
- 删除 6 处虚假断言（`assert(true)`、`A||!A`、`xp>=0`、走源码字符串、JSON 深拷贝冒充 SaveManager、只调 `applyBoosterTimeConsumption` 冒充真实离线）。
- 新增 15 项真实集成测试：
  1. 采矿 1 瓶离线 10 分钟（180s+420s 两段）
  2. 采矿 2 瓶离线 10 分钟（360s+240s 两段）
  3. 两槽 180s/360s 三段验证
  4. mining→refining 切换，冶炼不扣采矿增强剂
  5. refining→mining 切换，进入 mining 后开始扣
  6. mining→archaeology 两类槽分别扣除
  7. archaeology→mining 反向验证
  8. 65s 运行/10s 周期：6 次产出、progress~5s、增强剂扣 65s
  9. 探针不足停止离线考古和增强剂消耗
  10. 燃料不足停止离线考古和增强剂消耗
  11. 失败触发干扰停止离线考古收益
  12. 战斗增强剂离线前后完全不变
  13. 真实 SaveManager.save/load/importData 保持全状态
  14. 固定时钟 0ms/1000ms 边界验证 lastTick
  15. 在线增强剂行为无回归

**新增断言**：原 1229 → 现 XX（需最终确认）。

**14 条回归全 EXIT 0**：verify / audit-boosters / audit-planetary / audit-equipment-enhancement / audit-ship-enhancement / audit-rigs / audit-industrial-productivity / audit-archaeology-system / audit-archaeology-ships / simulate-archaeology-user-flow / calculate-ship-production-times --verify / --audit-mixed-battleship / simulate-destroyer-belts --assert-mixed-battleship / --assert-nullsec。

**边界守约**：
- 不改配方、效果、掉率、经验、战斗数值。
- 不碰 `js/render3d/**`。
- 不处理 `shipfactory2-archaeology-candidates.html`。
- 不修改容量相关代码（`getCargoCapacity`、`getCargoUsed`、`isCargoFull`、离线容量部分）。
- 未 git commit/push。
- 无 `nul` 文件。

## 2026-07-25（续）

### 行星基地仓储改为6小时产量

**修改文件**：`js/core/selectors.js`、`js/systems/planetary.js`、`js/core/offline.js`、`tools/verify.mjs`、`tools/audit-planetary.mjs`

**旧公式**（已废止）：`storageMax = 100 + level * 5`

**新公式**：`storageMax = Math.ceil(21600 / getPlanetOutputIntervalFromState(state, planetType))`

每个行星基地的本地仓储上限 = 当前效率下连续生产6小时的产量。填满时间在 21600 秒至 21600+一个周期之间。

新增 `getPlanetStorageMaxFromState(state, planetType)` 纯函数，改为按行星类型和技能等级动态计算。

六行星刚解锁时预期：
- Lv.1 lava/gas: 2204
- Lv.20 ice: 2016
- Lv.40 plasma: 2160
- Lv.60 temperate: 2160
- Lv.80 storm: 1872

**调用位置同步修改**：
- `js/core/selectors.js`：`getPlanetDeploymentDisplayState` 每 deployment 单独计算 storageMax
- `js/systems/planetary.js`：`planetaryTick` 每 deployment 单独计算 storageMax
- `js/core/offline.js`：`settleOfflinePlanets` 每 deployment 单独计算 storageMax

**删除的全局统一值调用**：循环外只计算一次 `getPlanetStorageMax()` 的模式已全部替换。

**审计扩展**（`tools/audit-planetary.mjs` 新增 ZI~ZM 区）：
- ZI: 六行星解锁等级精确 storageMax（6 行星 × 3 断言 = 18）
- ZJ: 多等级（1/20/40/60/80/99）动态增长（78 断言）
- ZK: 在线 6 小时满仓停产验证
- ZL: 离线 6 小时与在线结果一致
- ZM: 不同类型行星不同容量 + 旧档 storage 不被清零

**验证结果**：新增 104 断言，原 200 → 304 断言，39 区全 PASS。

### 船坞舰船列表改为内部纵向滚动

**修改文件**：`css/components.css`、`js/ui/shell-render.js`

**CSS**：`#hangar-panel` 使用 flex 布局，panel-body 内部滚动（overflow-y:auto），panel-header 固定在顶部不滚动，scrollbar-gutter:stable 防止滚动条出现时布局抖动。

**JS**：`renderHangarPanel` 调用时设置 `panel.style.display = "flex"`。

**验收条件**：
- 不固定只能显示 3 艘；
- 标题和总数保持在滚动区外；
- 最后一艘可完整滚动到可见；
- 仅滚动舰船卡片区域，不影响侧边栏；
- 窄窗口/缩放窗口仍可用。

### 装备制造页交互修复（2026-08-04）
**问题**：① 可制造配方多时，开始/停止制造按钮被挤到视口下方需滚动；② 正在制造 A 时切到 B 的配方卡片，按钮仍是「停止制造」、无法直接开始 B。

**修复**：
- 问题①（A1 修正为 flex 钉底，sticky 方案已弃）：`.equipeng-detail` 本就是 flex 纵向布局（原 `display:flex; flex-direction:column`），补充 `align-self:start; max-height:calc(100vh - 96px)` 限高；`.equipeng-detail-body` 加 `flex:1 1 auto; min-height:0; overflow-y:auto` 让内容区在右栏内部滚动；`.equipeng-detail-header/progress/actions` 加 `flex-shrink:0` 使按钮钉在右栏底部始终可见。sticky 方案被 `.panel{overflow:hidden}` 截断内部 sticky 而失效，已改用 flex 钉底（不依赖外部滚动容器）。窄屏单列保留钉底。
- 问题②（仿采矿范式）：`js/ui/manufacturing-render.js` 的 `renderEquipEngPage` 按采矿模板用 `targetChanged = active && runningRecipe.id !== selectedRecipe.id` 控制按钮显隐——`showStart = !active || targetChanged`、`showStop = active && !targetChanged`；targetChanged 时开始按钮文案=「▶ 切换制造」。同步修正 `runningNote` 提示（targetDiffers 时改为「点击切换制造将改为制造当前配方」，不再误导说「不会改变产物」）。点「开始/切换制造」走确认弹窗 → front 接管 → `startedEquipEngTarget` 变为当前选中配方（替换在制品），与采矿「切到别的带就变开始」行为一致。

**验证**：新增 `tools/smoke-equipeng-switch.mjs`（16 断言 EXIT=0：三种状态按钮显隐/文案 + 点开始替换在制品 + canStart 不变）；speed=1 全量回归不变（verify 55JS/4CSS/303DOM、regress-combat-repair 86/0、audit-station 1172/0 全 EXIT=0）。未新增页面 defer 脚本，verify 脚本计数仍 55。

### 十倍速运行期开关（单仓库 + 运行期开关，2026-08-04）

**背景**：原 `EVEIDLE-10X-SYNC` 分支仅靠 `index.html` 的 `window.TEST_ACTIVE_SPEED=10` 局部加速空间站自动线，且相对 main 含大量非加速差异（裸 ID 显示、初始塞船、删迁移/教程/verify 行），两分支长期漂移。改为「单仓库 + 运行期开关」：十倍速只是一个值，彻底消灭分支漂移。

**架构**：全仓库唯一速度源 `js/core/speed-config.js`（IIFE 写入 `globalThis.GAME_SPEED / getGameSpeed / gameDeltaSec / gameNow`）。解析优先级：URL `?speed=` > `localStorage('eve_speed')` > 兼容 `window.TEST_ACTIVE_SPEED`；非有限或 ≤0 降级为 1。

**加速范围（v1）**：仅缩放「产出/进度积累」——
- 采矿/气采/精炼/冶炼的 tick `delta` 经 `gameDeltaSec()` 包裹（`tick.js` 8 处）；
- 科研在线结算 `ResearchSystem.processResearchUntil(state, now, { scale: getGameSpeed() })`；
- 空间站自动线 `getStationLogisticsMultiplier` 返回 `base * getGameSpeed()`。
所有基于 `Date.now()` 的**冷却/到期保持实时**：维修、考古干扰、战斗恢复、增强剂过期、离线结算时间轴等一概不缩放。代码纯度已验证：速度源标识符 `gameDeltaSec / getGameSpeed / GAME_SPEED` 仅出现在 `speed-config.js / tick.js / station.js` 三个文件，冷却类函数（增强剂/战斗恢复/考古干扰/维修）绝不引用速度源。

**修改文件**：
- 新增 `js/core/speed-config.js`
- `index.html`：在 `tick.js` 之前注入 `<script defer src="./js/core/speed-config.js"></script>`（defer 脚本计数 54→55）
- `js/core/tick.js`：8 处 `const delta = Math.min(5, …)` 改为 `gameDeltaSec(Math.min(5, …))`；顶部守卫（未加载 speed-config 时注入等价 speed=1 实现，保证 Node 测试安全）；科研结算传 `{ scale: getGameSpeed() }`
- `js/systems/research.js`：`processResearchUntil(state, now, opts)` 新增 `_scale` 参数（离线调用不传 opts → scale=1 不变）
- `js/systems/station.js`：`getStationLogisticsMultiplier` 返回 `base * getGameSpeed()`
- `tools/verify.mjs` / `tools/audit-archaeology-ships.mjs`：脚本计数断言 54→55
- 新增 `tools/smoke-speed.mjs`：`?speed=10` 端到端冒烟（速度解析/产出/科研/自动线≈10×、增强剂冷却实时、速度源文件纯度）

**验证结果**：
- `GAME_SPEED=1` 全量回归逐字节不变：`verify.mjs` 55 JS / 4 CSS / 303 DOM（EXIT=0）、`regress-combat-repair.mjs` 86/0、`audit-station.mjs` 1172/0。
- `GAME_SPEED=10` 冒烟：`tools/smoke-speed.mjs` 全 26 断言 EXIT=0（采矿进度×10、后勤倍率×10、科研×10、增强剂剩余时长在 speed=1 与 speed=10 下完全一致、速度源仅 3 文件）。
- 3D / UI 文案不受 speed 影响（speed 只改变数值，显示层逻辑与 speed=1 一致；专名不泄漏已由 `verify.mjs` 覆盖）。

**使用**：调试用 `index.html?speed=10` 或 `localStorage.setItem('eve_speed', 10)`；生产默认 1。

**注意**：原 10x 分支「只差一个文件」的幻觉已破，现由本开关替代；旧 `EVEIDLE-10X-SYNC` 分支保留作历史、已另立统一开关（`b854ace` 强推至 `test/10x-active-speed`）。

### 装备制造页 X 方案（操作条抽离钉底 + 目录内部滚动，2026-08-04）

**问题复述**：单栏（≤1120px）时可制造配方目录在上方、`.equipeng-detail` 详情（含「开始/停止」按钮）在整页最下方，目录一长就下拉很久才够得着按钮。

**实装（commit `421c92d`，基线 `682a903`，detached HEAD，未推送）**：
- `index.html`：把 `.equipeng-detail-actions` 从 `<aside class="equipeng-detail">` 内移到 `.equipeng-workspace` 直接子元素（equipeng + booster 两处均改），按钮 id 不变、JS 按 id 取仍正常。
- `css/panels.css`：操作条 `grid-column:1/-1` + `position:sticky;bottom:0;z-index:5` 跨整宽钉视口底部；`.equipeng-recipe-grid` 设 `max-height:calc(100vh-340px);overflow-y:auto` 让长目录**自身内部滚动**、不撑高页面——这一步是关键，纯 sticky 做不到在目录顶部滚动时按钮仍可见。
- 两栏/单栏布局通吃。

**验证**：`verify.mjs` 仍 55 JS / 4 CSS / 303 DOM IDs（按钮 id 均在），EXIT=0。

**回滚**：`git revert 421c92d`（仅撤 X，保留基线 `682a903` 的按钮范式 + A1 修复）或 `git reset --hard 682a903`（丢掉 X）。
