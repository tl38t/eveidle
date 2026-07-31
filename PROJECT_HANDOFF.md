# PROJECT HANDOFF — EVE IDLE

## 1. 游戏定位与核心设计原则

- **名称**：EVE放置：新伊甸纪元 / EVE Idle: New Eden
- **类型**：基于梅尔沃放置/Milkyway Idle 的 Vanilla JS 浏览器放置游戏，无构建步骤，
  分层架构：data / core / systems / ui
- **平台**：Web 单页面应用，localStorage 存档
- **核心玩法**：多技能熟能生巧（1-99级）、生产-战斗-行星-考古深度闭环、装备品级、
  伤害属性克制、离线持续结算
- **设计规则**（见 AI_DEVELOPMENT_RULES.md）：
  - 正确性 > 可维护性 > 模块化 > 可读性 > 性能 > 简单
  - 改架构先说利弊
  - 每功能一 commit（但常要求"暂不 commit"）
  - 禁止硬编码数值；尺寸由 ship size 推导可复现 seed
  - 回归命令 15 条全 EXIT=0 为收口标准

## 2. 已完成系统（截至 2026-07-27）

| 系统 | 状态 |
|------|------|
| 无限库存 | 仓库容量机制已删除，改为无限库存。`cargoManagement` 技能、`getCargoCapacity/getCargoUsed/isCargoFull` 已删除。所有生产不再受总量限制（采矿/月矿/采气/冶炼/装备/部件/组装/增强剂/自动线）。行星全量收取。存档迁移幂等。UI 只显示"物资总量"。 |
| 采矿 / 冶炼 / 气体采集 | 完整版，含离线结算、队列支持 |
| 舰船工程（部件制造 + 总装） | 完整版，含蓝图系统 |
| 装备工程（装备/燃料/弹药制造） | 完整版，含蓝图和强化系统 |
| 改装件（Rig）系统 | Phase 3B 全量实装：45 件、装配语义、效果接线、经济定案 |
| 战斗系统 | 含异常空间、编队、阵型克制、弹药/燃料、死亡空间、维修回收、维修后自动恢复（Phase 3D，在线：重创即失败清零；死亡空间不续原副本，维修完成后自动返回来源普通星带第 1 波）。掉落预览 fail-closed：非法 zoneId/deathspaceId/sourceZoneId 不回退首个星带。掉落概率配置提取为 5 只读纯函数（`getTacticalMaterialDropConfig` / `getEncryptedDataDropConfig` / `getCombatZoneSpecialDropConfigs` / `getDeathspaceTicketDropConfig` / `getDeathspaceLeaderLootConfigs`），`encryptedDataChances` `!= null` 保留 0 概率。 |
| 行星开发 | 后台被动产出，6 种行星类型 |
| 考古系统（含离线） | Phase 2 完整版：5 档 15 遗迹、掉落/成功率/反噬、文物出售/LP 兑换 |
| 增强剂系统 | Phase 2B 完整版：9 系列 × 5 品质 = 45 件、六槽装备、计时消耗、离线分段、效果聚合 |
| 空间站系统（Phase 3C 全阶段） | 已完成：三级本体/八建筑/维护/自动线/船坞/综合后勤/统一页面显示态。`audit-station.mjs` 1145/0。 |
| 动作队列 | 支持插入/删除/排序/循环/离线 |
| ShipFactory2 | P1-P8 完成：13 Generator、8 Civilization、Hull/Armor/Panel/Groove 等 |
| 存档系统 | SaveManager + ResourceRegistry + 迁移 |
| 运行时代理（RuntimeGuard/GameEvents） | 完成 |

## 3. 尚未完成系统及顺序

| 优先级 | 系统 | 说明 |
|--------|------|------|
| P0 | **队列测试缺口修复** | 第二项走真实完成链；删除 queue.js 旧回退入口；浏览器测试改为真实点击 |
| P1 | **无限库存** | 已完成（2026-07-27）：仓库容量机制删除、cargoManagement 技能删除、所有生产不再受总量限制、行星全量收取、存档迁移幂等。`audit-unlimited-inventory.mjs` 专项审计。 |
| P1 | **军团系统与空间站** | Phase 3C 全阶段完成。空间站三级本体/八建筑/维护/自动线/船坞/综合后勤/统一页面显示态均已实装验收。NPC 军团工作/战斗/任务/科技留作 DLC。`audit-station.mjs` 1145/0，`tools/station-browser-test.html` RESULT=PASS。 |
| P2 | **ShipFactory2 P9 渲染升级** | 已延后 |
| P3 | **成就系统** | 暂不设计 |
| P4 | **研究系统** | 留给未来 |
| P5 | **离线战斗自动恢复（Phase 4A）** | 未实装。在线战斗/考古的维修后自动恢复已于 Phase 3D 实装（战斗规则 2026-07-26 修正）。Phase 4A 须用同一语义：普通星带重创→180s 维修→同星带第 1 波重开；死亡空间重创→退出副本密钥不退→维修→返回来源星带第 1 波；**不允许离线续跑原死亡空间**。需扩展 `settleOfflineActions` combat 分支（离线维修墙钟）。|

## 4. 当前分支与最近提交

- **分支**：`3D建模制作`
- **最近提交**：`e595f3c` — `feat: complete booster runtime and offline settlement`
  (2026-07-25 11:16 +0800, 21 files, +2690/−134)
- **注意事项**：此分支同时包含 ShipFactory2 船体建模的并行改动

## 5. 当前未提交文件分类

### 已修改（M）

**本阶段返修文件**（可暂存/提交）：
- `js/core/actions.js` — 共享校验、统一队列入口、queueStart 重写、queueItemForState + 行星全量收取（collect 删 cargoCapacity）
- `js/core/queue.js` — executeQueueItem 改为调用 executeQueueItemForState
- `js/core/selectors.js` — 考古弹窗使用 canStartArchaeology、修复 self-OR + 无限库存（删除容量字段）
- `js/systems/archaeology.js` — 稀有率预览、运行锁定、levelLocked/actionLocked
- `js/ui/archaeology-render.js` — 文言区分、disabled 条件、状态行中文名
- `js/ui/booster-render.js` — showActionConfirm 调用
- `js/ui/render.js` — 考古分支 null 守卫 + 无限库存 UI
- `js/ui/shell-render.js` — addCurrentToQueue 新增两项 + 无限库存显示态
- `css/panels.css` — 考古面板 overflow、asc-drops 样式
- `tools/verify.mjs` — bar-archaeology optional + 源码守卫 + 无限库存适配
- `tools/audit-archaeology-system.mjs` — 弱断言修复、G/H/I/J 新区
- `tools/audit-boosters.mjs` — ZZC2 重写
- `tools/simulate-archaeology-user-flow.mjs` — now 参数修复
- `tools/archaeology-browser-test.html` — iframe 验收

**新增无限库存文件**（本次修改/新增）：
- `js/data/base.js` — 删除 cargoManagement
- `js/systems/production.js` — 删除 getCargoCapacity/getCargoUsed/isCargoFull
- `js/core/resources.js` — getCargoTotal → getInventoryTotal
- `js/core/tick.js` — 删除所有满仓停止
- `js/core/offline.js` — 删除容量限制 maxCycles
- `js/core/persistence.js` — 新增 migrateUnlimitedInventoryState
- `js/systems/boosters.js` — 删除 isCargoFull 条件
- `index.html` — 物资总量显示
- `css/base.css` — 删除容量进度条样式
- `js/ui/planetary-render.js` — 删除容量引用
- `tools/audit-unlimited-inventory.mjs` — 新建审计
- `tools/unlimited-inventory-browser-test.html` — 新建浏览器验收

**并行 3D 建模文件**（不可触碰）：
- `js/render3d/shipfactory2/ShipFactory2.js`
- `js/render3d/shipfactory2/ShipProfile.js`
- `js/render3d/shipfactory2/civilization/ArchaeologyHull.js`
- `js/render3d/shipfactory2/civilization/CivilizationModifier.js`
- `js/render3d/shipfactory2/civilization/OverloadedHull.js`
- `js/ship-lab.js`
- `ship-lab.html`

### 未跟踪（??）

**新文件（不可删除/回退）**：
- `CORPORATION_AND_STATION_IMPLEMENTATION_PLAN.md` — 空间站策划文档
- `armor-capital-candidates.html`
- `blood-capital-demo.html`
- `shield-capital-candidates.html`
- `shipfactory2-archaeology-candidates.html`
- `structure-capital-demo.html`
- `js/render3d/shipfactory2/civilization/AngelCapitalHull.js`
- `js/render3d/shipfactory2/civilization/ArmorCapitalHull.js`
- `js/render3d/shipfactory2/civilization/BloodCapitalHull.js`
- `js/render3d/shipfactory2/civilization/ShieldCapitalHull.js`
- `js/render3d/shipfactory2/civilization/StructureCapitalHull.js`

**临时文件（环境不允许删除，保持 untracked 即可）**：
- `tools/debug-abc.mjs`
- `tools/debug-booster-ui.cjs`
- `tools/debug-zo.mjs`

## 6. 不得触碰的并行 render3d 改动

绝对禁止修改、暂存、删除或回退以下文件（属于 ShipFactory2 船体建模的独立工作流）：

```
js/render3d/shipfactory2/ShipFactory2.js
js/render3d/shipfactory2/ShipProfile.js
js/render3d/shipfactory2/civilization/ArchaeologyHull.js
js/render3d/shipfactory2/civilization/CivilizationModifier.js
js/render3d/shipfactory2/civilization/OverloadedHull.js
js/render3d/shipfactory2/civilization/AngelCapitalHull.js
js/render3d/shipfactory2/civilization/ArmorCapitalHull.js
js/render3d/shipfactory2/civilization/BloodCapitalHull.js
js/render3d/shipfactory2/civilization/ShieldCapitalHull.js
js/render3d/shipfactory2/civilization/StructureCapitalHull.js
js/ship-lab.js
ship-lab.html
shield-capital-candidates.html
armor-capital-candidates.html
blood-capital-demo.html
shipfactory2-archaeology-candidates.html
structure-capital-demo.html
```

## 7. 正式回归命令（共 17 条）

```bash
# 1. 综合验证
node tools/verify.mjs

# 2-5. 专项审计
node tools/audit-archaeology-system.mjs
node tools/simulate-archaeology-user-flow.mjs
node tools/audit-archaeology-ships.mjs
node tools/audit-boosters.mjs

# 6-10. 系统审计
node tools/audit-planetary.mjs
node tools/audit-equipment-enhancement.mjs
node tools/audit-ship-enhancement.mjs
node tools/audit-rigs.mjs
node tools/audit-industrial-productivity.mjs

# 11-12. 空间站专项审计（Phase 3C-2 / 3C-4）
node tools/audit-station-migration.mjs
node tools/audit-station.mjs

# 13-14. 制造计算校验
node tools/calculate-ship-production-times.mjs --verify
node tools/calculate-ship-production-times.mjs --audit-mixed-battleship

# 15-16. 战斗模拟（正式 --assert 参数，必须用 8GB 堆，4GB 必段错误）
node --max-old-space-size=8192 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship
node --max-old-space-size=8192 tools/simulate-destroyer-belts.mjs --assert-nullsec

# 17. 尾随空格检查
git diff --check
```

**验收标准**：全部 EXIT=0。`simulate-destroyer-belts` 两条（第 15/16 条）一律使用 `--max-old-space-size=8192`；4GB 会纯 v8 内存压力崩溃（EXIT 139/进程被杀），属已知模拟器内存问题，非游戏代码回归。

## 8. 当前考古/增强剂返修状态

### 已完成（Phase 2B 返修第 1-3 轮）

1. **离线增强剂真正分段算法**：在 settleOfflineActions 内实现行动运行时间按槽可用毫秒数切割，
   每段真实 desc.apply（替代被删除的"基线+extra周期补偿"方案）
2. **共享校验函��� canStartArchaeology**：三个入口共用（Action start / 确认弹窗 / 队列执行）
3. **统一队列执行入口 executeQueueItemForState**：按 skill 分派，校验失败时 failCount++、
   跳过该项并递归进入下一项（全部失败安全停止）
4. **运行目标锁定**：运行中 selectSite/selectProbe 返回 action-running；UI 卡 disabled
5. **增强剂队列显式 recipeId**：startManufacturing(state, now, recipeId) 支持队列传入目标
6. **稀有率预览真实倍率**：从 getBoosterEffectState(state).rareShiftMultiplier 读取
7. **verify.mjs 动态 canvas 支持**：bar-archaeology 加入 optionalIds + 源码守卫
8. **考古增强剂按钮点击链**：确认弹窗 → 队列 → 真实 Actio

### 已知测试缺口（待修正）

1. **第二队列项**：当前第二项未走真实 completeQueuedActionCycle 完成链
2. **queue.js 旧回退入口**：`applyQueueItemConfig` 仍存在，应清理
3. **浏览器测试**：目前考古用直接 dispatch，需改为真实点击

## 9. Codex 最近验收结论（2026-07-26 Phase 3C-6 最终验收）

### 维护燃料系统
- 已恢复（策划从未取消）
- 通用燃料 `consumable:fuel`，每点每周 1500 燃料
- 一键补给至七天容量，>24h 剩余拒绝
- 低油/耗尽事件精确一次，不重复
- 船坞断油唯一例外

### 考古实验室（方案 A）
- `min(0.99, baseUniqueRate × tracerMultiplier × labMultiplier)`
- 单随机数同时决定 dropped 和 labCaused
- 断油 labMultiplier=1

### 作战指挥中心
- 10 技能白名单，倍率 Lv.0=1.0 / 1=1.10 / 2=1.20 / 3=1.30
- 非白名单无加成，断油恢复 ×1

### 舰船船坞
- 速度独立乘区 Lv.0=1.00 / 1=1.05 / 2=1.15 / 3=1.30
- 节省 Lv.1=3% / 2=6% / 3=10%（仅总装，quote+commit 两阶段原子）
- capital 需 Lv.2，supercapital 需 Lv.3
- 确定性余数账本，断油仍有效

### 离线时间轴分段
- `settleOfflineTimeline` 在 `applyOfflineGains` 内调用
- 按燃料耗尽/施工完成分段
- 每段真实调用 settleOfflineActions + settleOfflinePlanets + processAutoLines + 扣燃料

### 审计
- `audit-station.mjs`：**1145/0**（3C-6 第八轮 1056 收口 + 3C-7 综合后勤倍率 N 区 55 断言 + 3C-8 O 区 14 条显示态断言）
  - G 区：真实冶炼配方精确周期；G2 统一离线 10h 断油对比（fuel=0/1h/10h → 周期 0/180/1800，C=10×B，三组矿/产出/XP/lastTick/enabled/target 严格联动）
  - H 区：真实 `resolveArchaeologyDrops` + 固定 rng 序列（实验室归因恰一次事件）
  - I 区：十项白名单逐项真实 `addStationModifiedCombatXp`（×1.30 精确）+ 真实 combatTick 一回合
  - J 区：真实船坞节省 Lv.3（savingRate 0.10）——J4 在线 10 周期(实付 18/省 2)、J5 离线批量 50(实省===quote.saved)、J6 在线100vs离线100 完整快照一致(非零余数 0.37/0.61)、J6b materialCost 配方 gale 在线40vs离线40(镓/铂/加密数据实省 40/32/60)；第七轮发现修复真实缺陷：materialCost 纯材料名 ref 与 `namespace:key` 命名空间错配，新增 `resources.getByRef/spendByRef` 并在 station/manufacturing/selectors 四处切换
  - J 区（第八轮新增 J9~J13）：J9 部件四级速度 ×1/1.05/1.15/1.30 在线+离线各验证；J10 总装离线 Lv.0 vs Lv.3 按 floor(elapsed/adjustedDuration)（89/116，比≈1.30）；J11 在线 50 周期 vs 离线同实际秒数一致（差≤1、totalSaved>0、ledger 非空）；J12 显示态 5 字段（skillMultiplier/shipyardMultiplier/totalSpeedMultiplier/componentActualTime/assemblyActualTime）+ 断油仍 1.30 + fail-closed 回退 ×1 + 弹窗消费；J13 getByRef/spendByRef 直接行为断言（component: 精确、纯名跨命名空间、未知 ref 安全失败、不足不部分扣）。旧 J5/J6/J6b/G5 的 perCycle 已改为含 syMult 的正确参考
  - K 区：真实 `normalizeStationState`/`migrateStationCorporationState`/`SaveManager.importData` 迁移路径
  - N 区（3C-7 新增 N1~N12 共 55 断言）：综合后勤倍率——N1 getter（Lv.0/1/2/3/断油/fail-closed/display）；N2~N4 采矿/气/冶炼；N5 行星 interval；N6 装备；N7 增强剂；N8 舰船（skill×log×yard 三级组合）；N9 考古周期÷1.03（成功率/掉率不变）；N10 自动线有油运行断油闸门暂停；N11 总倍率 3.99>1.25 无截断；N12 排除项（ISK/节省/战斗不受影响）
  - O 区（Phase 3C-8 新增 O1~O11 共 14 断言）：调用不抛异常、8 建筑、3 自动线、三线 targetOptions 非空、effectRows 恰好 9、建筑效果文案非空、无 undefined/NaN/Infinity、stateA/stateB 成本库存隔离、corporation 读取正确、断油船坞例外、冶炼显示周期含全部倍率
- `audit-boosters.mjs`：1296/0
- 完整 UI 留到 Phase 3C-8
- 26 条回归命令均 EXIT=0

## 10. 下一步工作

1. 完成上述三个测试/契约缺口
2. 继续空间站策划实装（基于 CORPORATION_AND_STATION_IMPLEMENTATION_PLAN.md）
3. 按计划分阶段完成军团系统与空间站模块

---

*最后更新：2026-07-27（无限库存：删除仓库容量机制、cargoManagement 技能、getCargoCapacity/getCargoUsed/isCargoFull。所有生产不再受总量限制。行星全量收取。UI 只显示"物资总量"。存档迁移幂等。新增审计 audit-unlimited-inventory.mjs 和浏览器验收。保留 3C-8 stationLogistics 修正。）*

*上次更新：2026-07-26（Phase 3C-6 第七轮最终审计收口：G2 改统一离线 10h 断油对比（fuel=0/1h/10h → 周期 0/180/1800，C=10×B）；J 区船坞节省升级为真实 Lv.3 验证（J4 在线/J5 离线/J6 在线100vs离线100/新增 J6b materialCost 配方 gale）。发现并修复真实缺陷：materialCost 纯材料名 ref（如"镓"）与 `namespace:key`（`moon:镓`）命名空间错配，导致船坞节省路径无法组装/扣料——新增 `resources.getByRef/spendByRef`，station.js/manufacturing.js/selectors.js 四处由 `get/spend` 切换为 `getByRef/spendByRef`。`audit-station.mjs` **PASS=998 FAIL=0（连跑两次一致）**；因游戏代码变动跑完整正式回归全 EXIT=0。未 commit。）*

*上次更新：2026-07-26（Phase 3D 战斗恢复规则修正：**重创即本轮失败并清零遭遇**，无论普通星带/死亡空间维修完成后都返回普通星带第 1 波；死亡空间不续原副本、密钥不返还也不再扣、恢复路径绝不调用 `enterDeathspace`。恢复标记改为 `{returnZoneId,defeatedMode:belt/deathspace,deathspaceId,shipInstanceId}`；迁移严格 fail-closed（returnZoneId∈COMBAT_ZONES、defeatedMode 合法、deathspace 须携合法 deathspaceId）；`combat/stop` 放宽守卫支持维修中取消自动出击；`combat:resumedAfterRepair` required 增 defeatedMode。审计 `tools/audit-resume-after-repair.mjs` 重写 **55/55 全 PASS EXIT=0**（含"恢复函数不含 enterDeathspace"静态确认）。修改：actions.js/combat.js/persistence.js/events.js/selectors.js + 审计重写 + eveidle/DEVLOG/HANDOFF 文档。未 commit。）*

*上次更新：2026-07-26（Phase 3C-6 第六轮定点返修：`settleOfflineTimeline` 动态 while 分段（无油段调 processAutoLines + 推进 maintenance.lastTick，不追扣）；`tools/audit-station.mjs` G/H/I/J/K 五区升级为真实业务入口精确断言（真实冶炼配方/resolveArchaeologyDrops/addStationModifiedCombatXp+combatTick/SHIP_ASSEMBLY_RECIPES 在线离线一致/normalizeStationState+importData 真实迁移），PASS=955 FAIL=0（第七轮已升级至 998）。harness 新增 evalIn 取顶层 const、UI no-op 桩、lvl:99 防升级扣 XP。未 commit。）*

*上次更新：2026-07-26（Phase 3D 维修后自动恢复：新增 `gameState.resumeAfterRepair` + 幂等 fail-closed 迁移；在线考古经 `tick.js` 重调 `canStartArchaeology` 续跑/安全停止，在线战斗经 `combatTick`→`combat/start` 续跑，死亡空间不续跑；离线考古由 `settleByTime` 自然续跑；离线战斗登记 Phase 4A 未实装。注册 `archaeology:resumedAfterRepair`/`combat:resumedAfterRepair` 事件契约。审计 `tools/audit-resume-after-repair.mjs` 42/42 全 PASS EXIT=0，全经生产入口驱动。修改：state.js/persistence.js/actions.js/combat.js/tick.js/events.js + 新增审计工具。）*

*上次更新：2026-07-26（ShipFactory2 浏览器验收页全绿：修复根因——测试代码在生产 canvas 上调用 `getContext("webgl")` vs Three.js 的 WebGL2 context 冲突，改用 getContext 包装器 + `__SHIP3D_GET_GL_CONTEXT` 记录器解决；iframe 尺寸 1600×1000；API/UI 独立计数；11 条件判定。headless Chrome 实测：API 15/0 UI 10/0 consoleErrors=0 pageErrors=0 rejections=0 ctxLost=0 RESULT=PASS。7 条回归全 EXIT=0。）*
