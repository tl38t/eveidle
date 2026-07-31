# RESEARCH_SYSTEM_IMPLEMENTATION_PLAN.md

> 研究系统第三阶段 —— 正式实装前的技术勘察与接口设计（Phase 3 Technical Recon & Interface Design）
>
> 阶段目标：把已验收的《RESEARCH_SYSTEM_DESIGN.md》（第二阶段）映射到现有游戏架构，产出**可直接执行的实装方案**。
> 本阶段**不制作研究页面、不接入正式数值、不实现六个自动化协议**，仅新增/修订本技术文档。
>
> 所有架构判断来自真实代码，标注 `文件:函数:行号`。首次勘察：2026-07-27；定点返修：2026-07-28（离线锚点/队列投影/数值加法语义/考古维修接口/文物上下文/造船任务持久化/行星续费权威/31 group 校验/协议触发规则）。
> 关联文件：`RESEARCH_SYSTEM_DESIGN.md`、`tools/research-tree-data.mjs`、`tools/calculate-research-tree.mjs`（均第二阶段已验收）。

---

## 1. 工作边界

- 本阶段**仅新增/修订本文件** `RESEARCH_SYSTEM_IMPLEMENTATION_PLAN.md`。
- 当前工作树已有大量用户改动，全部原样保留；未运行任何覆盖/回滚/格式化。
- 不修改：`index.html`、`css/**`、正式 `js/**`、`tools/research-tree-civ6.html`、`tools/research-tree-data.mjs`、`tools/calculate-research-tree.mjs`、`RESEARCH_SYSTEM_DESIGN.md`、`render3d/**`、`ship-lab.*`、`*candidates.html`、`*capital-*.html`、`*demo.html`。
- 不 `git add` / `commit` / `push`。
- 所有架构判断引用真实代码（见 §2），不凭空设计不存在的接口。

---

## 2. 勘察现有架构（真实入口）

### 2.1 主状态对象创建 / 初始化 / 重置

- 对象字面量：`js/core/state.js:15` `const gameState = { ... }`，至 `js/core/state.js:196` 结束。
- 挂全局：`js/core/state.js:199` `window.gameState = gameState;`
- 时间戳字段：`lastActiveTime`（L194，全局离线锚点，**研究系统不读它**，见 §4）、`lastSaveTime`（L195）、`_dirty`（L193）。
- 重置函数：**NOT FOUND**。代码中无 `resetGame`/`newGame`/`clearSave` 整体重置；只有局部重置（`resetActionProgress`、`resetArchaeologyShipHp` 等）。⇒ 研究状态初始化须在 `gameState` 字面量内就地加 `research:{}` 字段（参照 `upgrades:{}` 风格）。

### 2.2 存档 / 读档 / 版本迁移 / 导入导出

- 适配器：`js/core/persistence.js` `LocalStorageAdapter`，键名 `"eve_idle_save"`（L9）；`save()` L10、`load()` L11、`export()` L12、`import()` L13。
- `SaveManager`：`save()`（L941，写 `lastSaveTime`、`_dirty=false`）、`load()`（L942，`Object.assign(gameState, data)`）、`exportData()`（L943，Blob+下载）、`importData(jsonString)`（L944，解析→完整迁移链→`switchPage`）。
- 自动保存：`setInterval(() => { if (gameState._dirty) SaveManager.save(); }, 5000)`（L994）。
- 迁移机制：**无数字版本号**，由布尔标志 `gameState.migrations.X` 守卫。`autoLoad` IIFE（L997–L1086）按序调用 `migrateMoonMiningState`→`migrateDeathspaceState`→`migrateBoosterState`→`migrateUnlimitedInventoryState`（L1074）→…→`normalizePlanetaryState`→`calculateOfflineGains()`（L1077）。`importData`（L944）走类似顺序（L967/L972）。
- 导入导出 UI：`bindSaveEvents` IIFE（L1088）绑定 `#btn-save-game`、`#btn-export-save`、文件输入 `#import-file-input`（L1094）。
- ⇒ 研究迁移函数 `migrateResearchState()` 须加入 `autoLoad`（L1074 之后、L1077 之前）与 `importData`（L972 之前），沿用 `gameState.migrations.researchV1` 布尔标志。

### 2.3 离线时间计算与追赶

- 离线秒数：`js/core/offline.js:809` `calculateOfflineGains()`，核心 `const elapsed = Math.floor((now - lastActive) / 1000)`（L812）；≤5 秒直接返回；上限 `MAX_OFFLINE_SECONDS = 86400`（L5，24 小时）。
- 统一时间轴：`settleOfflineTimeline(totalSeconds, gains, context)`（L683）是唯一离线追赶协调器，按燃料耗尽/施工完成动态分段，段内调用 `settleOfflineActions`/`settleOfflinePlanets`/`processAutoLines`/`settleStationMaintenance`。
- 各行动：`settleOfflineActions`（L425，按技能 `getOfflineActionDescriptor` L63 循环）、考古 `settleByTime`（L250，墙钟精确推进，内部调 `resolveArchaeologyCycle`——即**离线考古已存在**）、行星 `settleOfflinePlanets`（L605，纯函数 `computePlanetarySettlement`）。
- ⇒ 研究离线结算**不依赖** `lastActiveTime`/`settleOfflineTimeline` 的分段（研究不耗燃料）：登录时直接调用唯一入口 `processResearchUntil(now)`（§4），24 小时上限在入口内部应用一次。

### 2.4 游戏 tick / 定时器 / 可见性 / 退出保存

- `gameTick()`：`js/core/tick.js:21`。顶部 `tickBoosterTimers`→`settleStationMaintenance`，按 `currentAction.skill` 分支推进（`delta = Math.min(5, (now - lastProgressUpdate)/1000)`），末尾 `gameState.lastActiveTime = Date.now()`（L281）。
- 驱动：`setInterval(() => RuntimeGuard.runCritical("gameTick", gameTick), 1000)`（`js/ui/render.js:328`）。**无**游戏逻辑用 `requestAnimationFrame`（rAF 仅 `renderLoop` 刷新进度条，L332/L372，与 tick 解耦）。
- 可见性：`document.addEventListener("visibilitychange", () => { if (!document.hidden) calculateOfflineGains(); })`（`persistence.js:1097`）。**未找到** `pagehide` 处理器。
- 退出保存：`window.addEventListener("beforeunload", () => SaveManager.save())`（`persistence.js:995`）。
- 在线/离线关系：**循环驱动分离，公式共享**。`getShipEngineeringCycleDuration`（在线 L148/L166、离线 L131/L145 共用）、`resolveArchaeologyCycle`（在线 L222、离线 L235/L323）、`ResourceRegistry`、`completeQueuedActionCycle`、`checkLevelUp` 均复用。
- ⇒ 研究**在线 tick** 在 `gameTick()` 末尾调用 `processResearchUntil(now)`；**离线**在 `calculateOfflineGains` 内调用**同一个** `processResearchUntil(now)`。同一入口、同一锚点（§4）。

### 2.5 成就系统

- **NOT FOUND（运行时代码）**。无 `js/data/achievements.js`、无成就数组、无完成函数、无奖励分发。`achievements-template.csv` 仅规划用，无 `reward` 字段；`tools/gen-achievements-csv.py` 为生成器。
- 现有最近似的奖励/增益机制：增强剂系统 `js/systems/boosters.js`、`ResourceRegistry`（`js/core/resources.js`：`get` L86/`set` L97/`add` L114/`spend` L121，键如 `currency:isk`/`currency:lp`）。
- ⇒ 成就系统为**全新模块**（不在本研究批次内），但第二阶段要求的"一次性科研工时池"需在此之上扩展。本阶段仅规定 `researchHourBank` 字段与 `applyResearchHours()` 接口，奖励来源留待成就模块接入。**成就工时单节点最多跳过 50% 基础时间的规则、第二阶段 90/80/75/70/65/60 天基准保持不变。**

### 2.6 各数值计算入口（详见 §5）

生产/制造：`getProductionEfficiencyState(state, actionKey)`（`js/core/selectors.js:172`，`total` 在 L236）、`getSmeltingDisplayState` L349、装备 `getEquipmentEngineeringDisplayState` L763、增强剂 `getBoosterManufacturingDisplayState` L884、舰船 `getShipEngineeringSpeedBreakdown` L640。
考古：`getArchaeologyDisplayState`（成功率 `computeArchaeologySuccessChance`，L411）、反噬伤害 `js/systems/archaeology.js:300`、周期速度 `booster.archaeologySpeedMultiplier × getStationLogisticsMultiplier`（L456-458）。
战斗：核心 `calculateCombatStatFromState`，经 `applyCombatModifiers`（`js/core/combat-modifiers.js:23`）按 `priority` 依次 `add→multiply→override→min→max`；伤害 `getCombatDamageMultiplierFromState` L1122、生命 `getCombatMaxHpFromState` L1068、维修 `getCombatRepairMultiplierFromState` L1155。
后勤：维护燃料 `getPlanetDeploymentDisplayState`/`renewCost`（`selectors.js:1392`）、建设 `getStationBuildingSpeedMultiplier`（`js/systems/station.js:1017`）、自动线 `processAutoLines`（station.js:998/1034）、行星生产 `getPlanetOutputIntervalFromState`（`selectors.js:1362`）。

### 2.7 行星 / 文物 / 燃料 / 维修 / 造船 / 强化（协议相关）

- 行星基地：`gameState.planetary.deployments[]`（`state.js:72`，对象在 `actions.js:650` 创建）。每基地**无** `autoRenew` 字段（需新增，见 §6.3）。维护费仅手动续期扣：`PlanetaryStateActions.renew`（`actions.js:678-698`，扣 `config.maintenanceCostISK`，emit `planetary:renewed`）。`planetaryTick`（`js/systems/planetary.js:54`）只产出、不扣费。
- 文物：`ARCHAEOLOGY_ARTIFACTS`（`js/data/archaeology.js:71-117`），`category` 区分 `common_isk`/`unique`（可售 ISK）/ `lp`（可兑 LP）/ `calibration`（皆否）。`sellArchaeologyArtifacts(state, artifactId, quantity, all)`（`js/systems/archaeology.js:315`）、`redeemArchaeologyArtifacts(state, artifactId, quantity, all)`（L348）——二者事件 metadata **写死 `{ offline:false }`**（L332/L344/L365/L377），需扩展 context（§6.4/§6.5）。
- 考古舰船与反噬（在线/离线共用路径）：`resolveArchaeologyCycle(state, now, randomValue)`（`archaeology.js:245`）——舰船来自 `state.shipAssignments.archaeology`（L251）→ `getShipInstanceFromState`（L252）；失败分支 L293-311：反噬伤害 L300、`applyArchaeologyDamage` L302、致命 `destroyed` 分支 L305-310、**非致命返回 L311**。舰船 HP 对象：`getArchaeologyShipHp(state, instanceId)`（L301）。
- 战斗维修装备（**只读战斗舰船，不可用于考古**）：`getInstalledCombatRepairers()`（`combat.js:21`，无参）→ `getInstalledCombatModules()`（L13）→ `getInstalledCombatModulesFromState(state)`（`selectors.js:1027`）→ `getActiveCombatShipState(state)`（`selectors.js:1018`，读 `state.shipAssignments.combat` L1020）。真实维修循环 `combat.js:726-740`（每件 `repFuelCost = max(1, round(rep.fuelCost × calcFuelMult))` L730、`ResourceRegistry.spend("consumable:fuel")` L736、治愈 `c.hp[rep.target]` L735）。fitting 遍历模式：`getFittingFromInstance(instance)` + 四槽 `["high","mid","low","rig"]` + `resolveEquipmentReference(state, ref)` + `definition.combat.kind === "repair"` 过滤（selectors.js:1027-1048）。
- 造船/强化：`ManufacturingStateActions.startShipComponent`（`actions.js:123`）、缺件 `getShipAssemblyComponentCost`（manufacturing.js:28）/`getMaxShipAssemblyCycles`（L36）/`hasEnoughShipAssemblyComponents`（L41）/`deductShipAssemblyComponents`（L59）、`startShipAssembly`（actions.js:140）。强化 `ShellStateActions.enhanceShip`（actions.js:942）、`getShipEnhancementCost`（ship-enhancement.js:58，**只 spend `component:<id>`，不产出**）。

### 2.8 导航页签 / 页面渲染架构（仅定位接口）

- 页面映射：`js/core/selectors.js:2047` `standalonePages = {...,planetary,archaeology,station,...}`（page→panel id）。新增 `research:"research-panel"`。
- 显隐管理：`getManagedPanels()`（`js/ui/shell-render.js:19`，列所有 panel id，加 `"research-panel"`）；`getGenericSkillPanels()`（shell-render.js:24）。
- 渲染路由：`renderCurrentNavigation`（`shell-render.js:40-76`）按 `navigation.page` switch，新增 `else if (navigation.page==="research") renderResearchPage();`。
- 侧栏/面板：`index.html` `.nav-item[data-page="..."]` + `<div id="research-panel" class="panel hidden">`。
- ⇒ 研究页挂接沿用既有三处注册（无新架构）。

### 2.9 事件总线 / 日志 / 通知 / 弹窗 / 格式化

- 事件总线：`GameEvents` 单例（`js/core/events.js:123`，`window.GameEvents` L224）；`on` L134、`once` L142、`emit` L160、`onIdempotent` L196。`GameEventContracts.definitions`（L9-82）需为 `research:stepCompleted` 登记契约。现无研究相关事件。
- 通知：`showToast(msg)`（`shell-render.js:12`）、`showOfflineToast`（`offline.js:21`）、`showBoosterToast`（`booster-render.js:8`）。
- 弹窗：无通用 `showModal`；按功能定制（如 `renderActionConfirmation`/`showActionConfirm` `action-modal.js:54`，3D 弹窗 `openHangar3DPopup` shell-render.js:263）。研究奖励弹窗沿用此模式。
- 格式化：`formatDuration(seconds)`（`action-modal.js:66`，封顶到小时，**需扩展天单位**）；无集中 `formatNumber`/`formatISK`，多用 `.toLocaleString()`（shell-render.js:147）；`formatCompact`（`planetary-render.js:48`）。
- 错误/诊断：`RuntimeGuard.report(err, opts)`（`js/core/runtime.js:23`）。

### 2.10 测试 / 审计脚本结构

- VM 沙箱范式（canonical）：`tools/audit-archaeology-economy.mjs:13-43`——`fs.readFileSync(index.html)`（L31）→ 正则抽取 `<script defer src="...">`（L34）→ `vm.runInContext(readFileSync(...), sb)`（L35）→ `$ = c=>vm.runInContext(c,sb)`（L36-43）。模拟 DOM：`CanvasRenderingContext2D`、`document.getElementById→mock`、`localStorage`、`sb.window=sb`。
- 同类：`audit-archaeology-system.mjs`、`audit-combat-drop-preview.mjs` 同构；`audit-planetary.mjs` 最接近。
- 用法：`sandbox.dispatchGameAction(state, {type:"archaeology/sellArtifact",...}, 0)`（audit-archaeology-system.mjs:397）、`sandbox.GameEvents.on("archaeology:artifactSold", ...)`（L479）、状态克隆 `JSON.parse(JSON.stringify($("gameState")))`。
- ⇒ `tools/audit-research.mjs` 复用上述 VM 加载；**务必**在 `index.html` 的 `<script defer>` 列表注册研究模块，否则不进沙箱。

---

## 3. 研究状态模型（推荐 schema）

新增字段 `gameState.research`，在 `js/core/state.js` 字面量内初始化（L15–L196 之间，如 L147 附近参照 `upgrades:{}`）：

```js
research: {
  schemaVersion: 1,                  // 研究子结构版本（独立于存档版本）
  completedLevels: {},               // { syseng:1, mine:3, laser:5, ... } 科技当前等级（0=未开始）
  activeResearch: null,              // 唯一正在研究的步骤，见下
  pendingQueue: [],                  // 待研究步骤队列（科技ID@等级 的 key 列表），上限 20
  researchHourBank: 0,               // 成就科研工时余额（秒）
  protocolSettings: {                // 六个协议开关（仅"协议是否解锁/允许使用"级别的配置）
    intship:    { enabled: false },
    autoenh:    { enabled: false, maxAttempts: 0 }, // 0=直到材料不足
    planauto:   { enabled: false },  // 注意：无全局 minIskReserve —— 每基地权威配置见 §6.3
    autosell:   { enabled: false },
    autoconv:   { enabled: false },
    autorepair: { enabled: false },
  },
  protocolJobs: {                    // 需要跨 tick / 跨存档持久化的协议任务（§6.1）
    intship: null,                   // 一体化造船链式任务；null=无任务
  },
  lastProcessedAt: Date.now(),       // ★ 唯一科研时间锚点（ms）。见 §4 —— 研究系统全部
                                     //   elapsed 计算只以此为权威，不读 lastActiveTime
  history: [],                       // 完成记录 [{ techId, level, completedAt }]（completedAt=虚拟游标时刻，§4.2）
  notifications: [],                 // 待展示通知 [{ at, text }]
},
```

`activeResearch` 结构（非空时）：

```js
activeResearch: {
  techId: "laser",
  targetLevel: 5,
  startedAt: 1719000000000,         // 仅作展示与历史信息（"开始于…"），不参与任何 elapsed 权威计算
  baseDuration: 123456.7,           // 该步骤基础时长（秒，来自 getResearchDuration）
  remainingSeconds: 98765.4,        // 权威剩余秒数（在线/离线均由 processResearchUntil 推进）
  appliedAchievementSeconds: 0,     // 本步骤已用科研工时（秒）；上限 0.5*baseDuration
}
```

> **明确删除**：`activeResearch.lastResearchUpdate` 字段不存在。研究系统只有一个时间锚点 `research.lastProcessedAt`；不得同时使用 `lastActiveTime`、`lastResearchUpdate`、`lastProcessedAt` 中的多个作为研究时间权威（防多锚点重复推进，见 §9 风险 12）。

### 3.1 规则

1. **单一进行步骤**：`activeResearch` 至多一个；`currentAction`/`skills`/`queue` 等行动系统**不**承载研究（不引入研究行动槽）。
2. **队列支持**：支持多个待研究步骤（`pendingQueue`）。队列长度上限 **20**（足以覆盖跨分支铺开，防止坏档无限长；UI 可分页）。入队校验用**投影等级**（§4.5），开始研究用**真实等级**二次校验（§4.6）。
3. **退出继续**：在线/离线均由 `processResearchUntil(now)` 以 `lastProcessedAt` 为锚推进；下次进入自动接续。
4. **离线续接**：当前步骤离线完成后，剩余 elapsed 继续喂给队列下一项目，循环至 elapsed 耗尽或队列空（§4.2 虚拟时间游标）。
5. **离线上限**：研究遵循现有全局离线上限 `MAX_OFFLINE_SECONDS = 86400`（offline.js:5，24 小时）。**超过 24 小时的部分永久丢弃**，下次登录不得继续补算（§4.2 第 9 条保证）。
6. **前置双重校验**：入队时（`enqueueResearch`，投影校验）与正式开始时（`startResearch`，真实校验）两道关；任一处失败则拒绝/跳过。
7. **50% 工时限制**：`appliedAchievementSeconds` 上限 `0.5 * baseDuration`；`applyResearchHours` 与读档/切换/重复加载均不得绕过；跨步骤不累计（每步重置）。
8. **防御性处理**：
   - 系统时钟倒退（`now < lastProcessedAt`）：elapsed=0，锚点按 `max(lastProcessedAt, now)` 单调更新（§4.4 第 3 条），倒退区间以后**不会**被补算。
   - 重复结算：唯一锚点 + 入口内部封顶，重复调用幂等（第二次调用 rawElapsed≈0）。
   - 坏档/缺字段：`migrateResearchState` 用默认值补全所有子字段；`completedLevels` 非对象则重置；`activeResearch.techId` 不在 `NODES` 则清空；旧字段 `lastResearchUpdate` 若存在则删除。
   - 旧档：`migrateResearchState` 幂等；`schemaVersion` 缺失即初始化 v1。

---

## 4. 时间结算算法（可直接转代码）

### 4.1 权威来源（单锚点）

- **唯一时间锚点**：`research.lastProcessedAt`（ms）。在线 tick 与离线登录**都**调用同一入口 `processResearchUntil(now)`，不存在第二套时间权威。
- `lastActiveTime` 仍是其他离线系统（行动/行星/站点）的锚点，研究系统**不读取**它。
- `activeResearch.startedAt` 仅展示；`remainingSeconds` 是步骤内进度的持久化载体，但推进它的 elapsed 只能来自 `lastProcessedAt`。
- 统一内部精度：**毫秒**累加、显示转秒；`remainingSeconds` 持久化保留 3 位小数（`Math.round(x*1000)/1000`）。

### 4.2 唯一入口 `processResearchUntil(now)`（在线/离线共用）

```
processResearchUntil(now):
    rawElapsed = max(0, (now - research.lastProcessedAt) / 1000)   // 时钟倒退 ⇒ 0
    elapsed = min(rawElapsed, MAX_OFFLINE_SECONDS)                 // 24h 封顶，只在此处应用一次
    cursorAt = research.lastProcessedAt                            // ★ 虚拟时间游标（ms）
    guard = 0
    while elapsed > 0 and activeResearch != null:
        guard++; if guard > 10000: break                           // 防死循环
        stepLeft = activeResearch.remainingSeconds
        if elapsed >= stepLeft:
            elapsed -= stepLeft
            cursorAt += stepLeft * 1000                            // 游标推进该步实际消耗
            completeResearchStep(cursorAt)                         // history.completedAt = cursorAt
            startNextFromQueue(cursorAt)                           // 下一步 startedAt = cursorAt
        else:
            activeResearch.remainingSeconds -= elapsed
            elapsed = 0
    research.lastProcessedAt = max(research.lastProcessedAt, now)  // ★ 无条件安全更新（见 4.4）
```

要点（逐条对应设计约束）：

1. **24h 上限只应用一次**：`min(rawElapsed, MAX_OFFLINE_SECONDS)` 是全链路唯一封顶点。调用方（tick / calculateOfflineGains / visibilitychange）**不预先封顶、不传入 elapsed**，只传 `now`。即使一次登录中入口被调两次（如 offline 结算后 tick 立即触发），第二次 `rawElapsed≈0`，天然幂等。
2. **超 24h 永久丢弃**：循环结束后锚点直接推到 `now`（而非 `lastProcessedAt + elapsed×1000`），被封顶丢弃的区间随锚点前移而**永久消失**，下次登录不会补算，也不会重复结算已算区间。**无论队列是否为空、activeResearch 是否为 null，锚点都必须更新**——否则空闲期结束后一开研究会瞬间白得 24h。
3. **在线小步/离线大步**：在线每秒 tick 调用产生 `elapsed≈1s`；离线登录一次最多结算 86400s。同一份代码，无分支。
4. **虚拟时间游标**：离线连续完成多步时，`cursorAt` 从 `lastProcessedAt` 起步，每完成一步增加该步实际消耗时间；`history.completedAt` 与下一步 `startedAt` 都取 `cursorAt`。**禁止**把所有离线完成记录都写成登录时刻 `Date.now()`。
5. **完成→启下**：`completeResearchStep` 后立即 `startNextFromQueue(cursorAt)`（含真实校验，§4.6），剩余 elapsed 继续喂给新步骤。

### 4.3 调用位置

| 场景 | 调用点 | 说明 |
|---|---|---|
| 在线 | `gameTick()` 末尾（tick.js:281 `lastActiveTime=Date.now()` 之前或之后均可，互不依赖） | `processResearchUntil(Date.now())` |
| 离线登录 | `calculateOfflineGains()`（offline.js:809）内、`settleOfflineTimeline` 之后追加一行 | 同一入口；研究不耗燃料，不参与分段 |
| 页面重新可见 | 经 `visibilitychange → calculateOfflineGains`（persistence.js:1097），无需另挂 | 幂等（§4.2 第 1 条） |

### 4.4 防御条款

1. **时钟倒退**：`now < lastProcessedAt` ⇒ `rawElapsed=0`，不推进、不倒扣 `remainingSeconds`。
2. **锚点安全更新**：倒退场景下锚点取 `max(lastProcessedAt, now)`（即保持不动）。这样时钟恢复后 elapsed 只从原锚点起算，**倒退区间不会被补算**；正常场景 `now ≥ lastProcessedAt`，锚点=now。
3. **锚点单调**：`lastProcessedAt` 只增不减；若用户曾把时钟拨到未来又拨回，锚点会暂时领先真实时间，此期间 elapsed=0，待真实时间追上后自愈（与不补算原则一致，接受此代价）。
4. **guard**：while 循环上限 10000 步（150 步全树 ×2 裕量以上），防坏档死循环。

### 4.5 队列投影校验 `buildProjectedResearchLevels(state)`

`enqueueResearch` **不能只查 `completedLevels`**——否则玩家研究 I 时无法排入 II，也无法排入由前序队列满足的后续科技。引入投影：

```
buildProjectedResearchLevels(state):
    projected = { ...research.completedLevels }                    // 1. 复制真实等级
    if activeResearch != null:                                     // 2. 计入进行中步骤完成后的等级
        projected[activeResearch.techId] =
            max(projected[activeResearch.techId]||0, activeResearch.targetLevel)
    illegal = []
    for key in research.pendingQueue:                              // 3. 按队列顺序逐项模拟完成
        (techId, level) = parseKey(key)
        if !isStepValidAgainst(projected, techId, level):          // 4. 非法旧档项不进入投影
            illegal.push(key); continue
        projected[techId] = level
    return { projected, illegal }

isStepValidAgainst(levels, techId, level):
    node = NODES_BY_ID[techId]; if !node: return false
    if level < 1 or level > node.maxLevel: return false
    if (levels[techId]||0) != level - 1: return false              // 同一科技必须连续升级
                                                                   //（== 同时排除重复步骤与倒序，如先III后II）
    for p in node.prerequisites:
        if (levels[p.id]||0) < p.level: return false               // 跨科技前置在该项之前已满足
    return true

enqueueResearch(techId, targetLevel):
    { projected } = buildProjectedResearchLevels(state)
    if !isStepValidAgainst(projected, techId, targetLevel): return {ok:false, reason:"prereq"}
    key = techId + "@" + targetLevel
    if pendingQueue.includes(key): return {ok:false, reason:"dup"}
    if pendingQueue.length >= 20: return {ok:false, reason:"full"}
    pendingQueue.push(key); return {ok:true}
```

### 4.6 队首真实校验 `startNextFromQueue`

正式开始队首项目时**必须用真实 `completedLevels` 二次校验**（投影可能因旧档非法项、取消研究等与真实状态脱节）：

```
startNextFromQueue(atMs):
    guard = pendingQueue.length + 1
    while pendingQueue.length > 0 and guard-- > 0:                 // 循环 guard，防非法项堵死队列
        key = pendingQueue.shift()
        (techId, level) = parseKey(key)
        if isStepValidAgainst(completedLevels, techId, level):     // ★ 真实等级
            d = getResearchDuration(techId, level)
            activeResearch = { techId, targetLevel:level, startedAt:atMs,
                               baseDuration:d, remainingSeconds:d, appliedAchievementSeconds:0 }
            return
        else:
            notifications.push({ at:atMs, text:"队列项 "+key+" 前置不满足，已移除" })  // 写通知/日志
            continue                                               // 移除该项，继续检查下一项
    activeResearch = null
```

### 4.7 其余函数伪代码

```
startResearch(techId, targetLevel, now):                           // 直接开始（不经队列）
    processResearchUntil(now)                                       // 同一不变式：先结算再变更
    if activeResearch != null: return {ok:false, reason:"busy"}
    if !isStepValidAgainst(completedLevels, techId, targetLevel): return {ok:false, reason:"prereq"}
    d = getResearchDuration(techId, targetLevel)
    activeResearch = { techId, targetLevel, startedAt:now,
                       baseDuration:d, remainingSeconds:d, appliedAchievementSeconds:0 }
    return {ok:true}

cancelResearch(now):
    if activeResearch == null: return {ok:false, reason:"nothing"}
    expectedKey = activeResearch.techId + "@" + activeResearch.targetLevel  // ⓪ 结算前锁定目标步骤身份
    processResearchUntil(now)                                       // ① 先把自然时间结算到 now
    if activeResearch == null:
        return {ok:false, reason:"already-completed"}               // ② 原节点已自然完成且队列为空
    currentKey = activeResearch.techId + "@" + activeResearch.targetLevel
    if currentKey != expectedKey:
        return {ok:false, reason:"research-changed"}                // ③ 原节点已完成，队列已自动启动下一节点
                                                                    //    —— 绝不能把刚启动的下一节点取消掉
    refundAchievementHours(activeResearch.appliedAchievementSeconds)  // 退回工时池
    canceled = activeResearch; activeResearch = null
    startNextFromQueue(now)                                         // ④ 明确：取消后立即启动队列下一项
    return {ok:true, canceled}
// 权威决定：取消后**立即启动下一项**，不是"暂停队列"。
// 理由：processResearchUntil 仅在推进循环内部完成步骤时衔接队列，
// activeResearch=null 时的普通 tick 不会自动启动队列，若不在此处启动，
// 队列会静默停摆。禁止写成"由 UI 或 tick 决定"。

applyResearchHours(hours, now):
    if activeResearch == null: return {ok:false, reason:"nothing"}
    expectedKey = activeResearch.techId + "@" + activeResearch.targetLevel  // ⓪ 结算前锁定目标步骤身份
    processResearchUntil(now)                                       // ① 先结算自然时间到 now，
                                                                    //    否则旧时间差会在下一次 tick 被算给新节点（双重进度）
    if activeResearch == null:
        return {ok:false, reason:"already-completed"}               // ② 原节点已自然完成且队列为空
    currentKey = activeResearch.techId + "@" + activeResearch.targetLevel
    if currentKey != expectedKey:
        return {ok:false, reason:"research-changed"}                // ③ 结算已完成原节点并自动启动了队列下一节点，
                                                                    //    工时绝不能误用到下一节点；由调用方提示玩家重试
    h = min(hours*3600, researchHourBank)
    cap = 0.5 * activeResearch.baseDuration
    usable = min(h, cap - activeResearch.appliedAchievementSeconds)
    if usable <= 0: return {ok:false, reason:"cap"}
    activeResearch.remainingSeconds -= usable                       // ③ 此时 remainingSeconds 已是结算到 now 的值
    activeResearch.appliedAchievementSeconds += usable
    researchHourBank -= usable
    if activeResearch.remainingSeconds <= 0:
        completeResearchStep(now); startNextFromQueue(now)          // 在线交互，用真实 now
    return {ok:true, used:usable}
// 不变式：任何改变 activeResearch 的交互入口（applyResearchHours / cancelResearch /
// startResearch / enqueue 后立即启动）都必须先 processResearchUntil(now)，
// 保证 lastProcessedAt==now 后再变更，自然时间绝不会被重复计给下一节点。
// 步骤身份校验不变式：applyResearchHours / cancelResearch 必须在结算前锁定
// expectedKey = techId+"@"+targetLevel，结算后重新比对 currentKey；
// 因为 processResearchUntil 完成原节点后会自动启动队列下一节点（activeResearch 非空
// 但已不是原目标），key 不同必须以 "research-changed" 拒绝，不得作用于新节点。

completeResearchStep(atMs):
    id = activeResearch.techId; lvl = activeResearch.targetLevel
    completedLevels[id] = max(completedLevels[id]||0, lvl)          // 只增不降
    history.push({techId:id, level:lvl, completedAt:atMs})          // atMs = 虚拟游标或真实 now
    GameEvents.emit("research:stepCompleted", {techId:id, level:lvl})  // 仅此一次
    // 协议 unlock 检查：仅置 protocolSettings 可用性，不执行任何协议行为（§6.0）
    activeResearch = null

getResearchDuration(techId, level):
    node = NODES_BY_ID[techId]
    return UNIT * WEIGHTS[level-1] * RANK_MULT[node.category]       // 与 data.mjs 完全一致

getResearchProgress():
    if activeResearch == null: return {active:false, ratio:1}
    ratio = 1 - activeResearch.remainingSeconds / activeResearch.baseDuration
    return {active:true, ratio:clamp(ratio,0,1),
            remainingSeconds:activeResearch.remainingSeconds,
            appliedAchievementSeconds:activeResearch.appliedAchievementSeconds}
```

### 4.8 队列测试设计（audit-research.mjs --queue）

1. 正在研究 `laser I` 时，可依次排入 `laser II`、`laser III`（投影连续升级）。
2. 前置科技已在前序队列中（如队列含 `dataan V`）时，可排入依赖它的后续分支首级。
3. 后续分支排在前置之前时拒绝（`reason:"prereq"`）。
4. 重复步骤拒绝（`reason:"dup"`；且投影 `== level-1` 双保险）。
5. 倒序拒绝：队列含 `mine III` 后再排 `mine II` 失败。
6. 旧档非法队列项（伪造 `pendingQueue:["laser@5"]` 而 laser=0）：投影跳过该项；轮到队首时被真实校验移除、写通知、下一项正常启动，队列不被堵死。
7. 队列上限仍为 20：第 21 项 `reason:"full"`。
8. 90 天基准：满队列串行 150 步总时长仍精确 90 天（虚拟游标不改变总量）。

---

## 5. 数值接入映射（加法汇总语义）

### 5.0 冻结语义：科研内部同类效果**先加后乘，只乘一次**

第二阶段冻结的目标值是**加法汇总结果**：

- 满采矿 / 满采气 / 满单项制造 / 满考古：**+8%**
- 单武器完整专精：**+12.5%**
- 专精防御层：**+10.5%**

**禁止**把同一科研效果链拆成多个独立乘性因子（内部复利）：

```
// ❌ 错误：allMining 与 mining 各自成因子
efficiency × 1.02 × 1.06 = ×1.0812   // 8.12%，超出冻结值

// ✅ 正确：科研内部同 group 链先求和，再形成单一乘子
researchMiningBonus = bonus(allMining) + bonus(mining)   // 0.02 + 0.06 = 0.08
existingMultiplier *= 1 + researchMiningBonus            // ×1.08，恰好 8%
```

不同系统来源（舰船加成、rig、增强剂、站点后勤等）仍可与**科研总因子**乘算；**科研内部**同类效果之间不得相乘。

### 5.1 统一帮助函数（js/core/research-state.js）

```
getResearchBonusValue(state, group):
    // 单一 group 当前累计百分比 = Σ(该 group 所有来源节点的 每级加成 × completedLevel)
    // 数据来源：NODES 冻结值（bonus.group + bonus.perLevel / flat）

getResearchCombinedBonus(state, groups):
    return Σ groups.map(g => getResearchBonusValue(state, g))      // 纯加法

getResearchMultiplier(state, groups):
    return 1 + getResearchCombinedBonus(state, groups)             // 唯一成乘子的位置
```

### 5.2 接入规则（每个消费点只乘一次科研乘子）

| 消费点 | 现有入口 | 科研乘子（单次） | 满级值 |
|---|---|---|---|
| 采矿效率 | `getProductionEfficiencyState` selectors.js:172（`total` L236） | `getResearchMultiplier(state, ["allMining","mining"])` | 1.08 |
| 采气效率 | `getGasEfficiency` production.js:131 | `getResearchMultiplier(state, ["allMining","gas"])` | 1.08 |
| 冶炼效率 | `getSmeltingDisplayState` selectors.js:349 | `getResearchMultiplier(state, ["allMfg","smelt"])` | 1.08 |
| 装备制造 | `getEquipmentEngineeringDisplayState` L763 | `getResearchMultiplier(state, ["allMfg","equip"])` | 1.08 |
| 增强剂制造 | `getBoosterManufacturingDisplayState` L884 | `getResearchMultiplier(state, ["allMfg","booster"])` | 1.08 |
| 组件制造 | `getShipEngineeringSpeedBreakdown` L640 | `getResearchMultiplier(state, ["allMfg","shipComp"])` | 1.08 |
| 舰船总装 | 同上 | `getResearchMultiplier(state, ["allMfg","shipAsm"])` | 1.08 |
| 考古效率 | 周期速度 selectors.js:456-458 | `getResearchMultiplier(state, ["archEff"])`——autocon 根加成与考古专精**已共用同一 group**（archEff），按最终等级数据汇总即总计 8% | 1.08 |
| 考古成功率 | `computeArchaeologySuccessChance`（L411） | 概率 + `getResearchBonusValue(state,"archSuccess")`（百分点，≤100% 钳制） | +3pp |
| 反噬伤害 | archaeology.js:300 | `× (1 - getResearchBonusValue(state,"backlash"))` | ×0.94 |
| 探针消耗 | 探针整数消耗 | `× (1 - getResearchBonusValue(state,"probe"))`，floor 且 ≥0 | −6% |
| 考古经验 | `addOfflineSkillXp` 等 | `getResearchMultiplier(state, ["archExp"])` | 1.06 |
| 维护燃料 | `renewCost`（selectors.js:1392）燃料项 | `× (1 - getResearchBonusValue(state,"fuel"))` | −9% |
| 建设效率 | `getStationBuildingSpeedMultiplier` station.js:1017 | `getResearchMultiplier(state, ["build"])` | 1.09 |
| 自动线效率 | `processAutoLines` station.js:998/1034 | `getResearchMultiplier(state, ["autoline"])` | 1.09 |
| 行星维护费 | `renewCost` ISK 项 | `× (1 - getResearchBonusValue(state,"planCost"))` | −9% |
| 行星生产 | `getPlanetOutputIntervalFromState` selectors.js:1362 | `getResearchMultiplier(state, ["planProd"])` | 1.09 |
| 战斗经验 | combat.js:666-711 | `getResearchMultiplier(state, ["combatExp"])` | 1.06 |

> 离线路径复用同一选择器/帮助函数（offline.js 各 settle 已经调用 selectors 的效率函数），在线/离线自动一致。

### 5.3 战斗类：聚合为**单一** research modifier

`combat.modifiers`（applyCombatModifiers 管线，combat-modifiers.js:23）**不能为四项科研分别添加 multiply**（allWeapon、weaponDmg、laserDmg、tactical 各一条会复利成 1.02×1.03×1.06×1.015≈1.1303，即 13.03%，超出冻结的 12.5%）。必须先加法汇总，生成聚合 modifier。

**真实 stat 键名与上下文匹配键**（以现有代码为准，不得发明幽灵键）：

| 真实 stat | 消费入口 | 上下文匹配键（combat-modifiers.js:12 白名单） |
|---|---|---|
| `damageMultiplier` | getCombatDamageMultiplierFromState（selectors.js:1129） | `weaponType`（laser/missile/proj） |
| `maxHp` | getCombatMaxHpFromState（selectors.js:1068，逐层调用） | `layer`（shield/armor/structure，L1106 传入） |
| `repairMultiplier` | getCombatRepairMultiplierFromState（selectors.js:1158，L1161 `layer:target`） | `layer` |

`tactical` 是**唯一真实的双效 group**（数据侧 bonus.group 就叫 `tactical`，31 组清单之一）：不存在 `tactical伤害分量`/`tactical生命分量` 这类幽灵 group。它的数值在**伤害聚合**与**生命聚合**两个消费上下文中**各读取一次**（同一 `getResearchBonusValue(state,"tactical")`，每级伤害与生命分量数值相同），每个聚合内部仍是纯加法。

```
// 伤害：每个 weaponType 一条聚合 modifier（靠 weaponType 匹配键隔离，互不叠加）
for wt in ["laser","missile","proj"]:
  dmgBonus = getResearchCombinedBonus(state, ["allWeapon", "weaponDmg", wt+"Dmg", "tactical"])
  modifiers += { stat:"damageMultiplier", operation:"multiply", weaponType:wt,
                 value: 1 + dmgBonus, source:"research" }           // 满级专精武器 1+0.02+0.03+0.06+0.015 = 1.125

// 三层生命：每层一条聚合 modifier（靠 layer 匹配键隔离）
for layer in ["shield","armor","structure"]:
  hpBonus = getResearchCombinedBonus(state, ["tierHp", layer, "tactical"])
                 // layer 专精 group（shield/armor/structure）未研究时值为 0
  modifiers += { stat:"maxHp", operation:"multiply", layer:layer,
                 value: 1 + hpBonus, source:"research" }            // 专精层满级 1+0.03+0.06+0.015 = 1.105
                                                                    // 非专精层满级 1+0.03+0+0.015 = 1.045

// 主动维修量：一条聚合 modifier（repair group 不分层，不带 layer 键即匹配所有层）
modifiers += { stat:"repairMultiplier", operation:"multiply",
               value: getResearchMultiplier(state, ["repair"]), source:"research" }
```

约束：

- 每个 `(stat, 上下文)` 组合**最多匹配到一条** `source:"research"` 的 modifier（combatModifierMatches 按 weaponType/layer 过滤后恰好 1 条），聚合值内部纯加法，绝无科研内部复利。
- 刷新时机：`research:stepCompleted` 监听器**先移除全部 `source:"research"` 条目再整批重建**，防残留旧值叠加。
- 禁止使用 `maxHp(该层)`、`repair`、`tactical伤害分量`、`tactical生命分量` 等非真实键名——正式代码里只有 `damageMultiplier`/`maxHp`/`repairMultiplier` 三个 stat 与 `tactical` 一个 group。

### 5.4 精确数值测试设计（audit-research.mjs --numeric，严禁复利结果通过）

全部断言用**精确相等**（浮点容差 ≤1e-9），不允许区间蒙混：

| 断言 | 期望 | 排除的复利错误值 |
|---|---|---|
| 满级采矿科研乘子 | =1.08 | 1.0812（1.02×1.06） |
| 满级采气科研乘子 | =1.08 | 1.0812 |
| 满级单项制造（冶炼/装备/增强剂/组件/总装各测） | =1.08 | 1.0812 |
| 满级考古效率科研乘子 | =1.08 | 1.0812 |
| 满级激光伤害 research modifier value（stat=`damageMultiplier`, weaponType=laser） | =1.125 | 1.1303（1.02×1.03×1.06×1.015） |
| 满级护盾专精层 research modifier value（stat=`maxHp`, layer=shield） | =1.105 | 1.1076（1.03×1.06×1.015） |
| 非专精层 research modifier value（stat=`maxHp`, layer=armor/structure） | =1.045 | 1.0455 |
| `getCombatModifiersFromState(state,"damageMultiplier",{weaponType:"laser",actor:"player"})` 中 `source:"research"` 条目数 | =1 | ≥2 即判失败（逐 weaponType、逐 layer 同测） |
| `research:stepCompleted` 重建后 `source:"research"` 总条目数 | =7（3伤害+3层生命+1维修） | 残留旧条目即失败 |
| 部分等级抽查（如 mining L3：1+0.02+0.036=1.056） | 精确 | — |

---

## 6. 六个协议的技术接口（仅设计，不实现）

### 6.0 协议通用触发规则

- `processResearchUntil` **只负责**：完成科技步骤、把协议置为"已解锁可用"、发出 `research:stepCompleted`。**研究 tick 不得主动执行制造、出售、续费、强化或维修。**
- 协议实际行为由**对应领域事件**触发：
  - 一体化造船（intship）：玩家点击创建任务后，由**制造完成事件**逐段推进（§6.1）。
  - 自动强化（autoenh）：玩家点击自动强化后循环尝试，材料不足即停。
  - 行星续费（planauto）：**基地到期事件/到期检查**触发（在线 planetaryTick、离线按到期时刻逐周期判断）。
  - 自动出售/兑换（autosell/autoconv）：**考古产物入库后**触发（在线/离线的 artifact 入库路径）。
  - 野外维修（autorepair）：**非致命考古反噬后**触发（§6.6）。
- `protocolSettings[x].enabled` 由玩家开关；unlock 条件为 `completedLevels` 满足 `research-tree-data.mjs` 前置。

### 6.1 一体化造船（intship）—— 持久化链式任务

仅使用 `manufacturing.currentAction` **不足以**保存完整一键造船链路（读档后无法知道处于组件阶段第几项、总装是否已扣料）。新增持久化任务 `research.protocolJobs.intship`：

```js
{
  jobId: "intship-1719000000000",   // 唯一 ID（幂等锚）
  targetShipId: "rifter",
  quantity: 1,
  phase: "components",              // planning | components | assembly | stopped | completed
  componentPlan: [                  // 原子计算的组件计划
    { componentId:"c-frame", need:4, have:1, toBuild:3 },
    ...
  ],
  currentComponentId: "c-frame",    // 当前正在制造的组件（components 阶段）
  completedComponents: { "c-frame": 2 },  // 已完成计数（幂等去重依据）
  assemblyRemaining: 1,             // 待总装数量
  createdAt: 1719000000000,
  updatedAt: 1719000300000,
  stopReason: null,                 // "insufficient-materials" 等
  processedEventIds: [],            // 事件级幂等账本（onIdempotent ledger，见下）
}
```

**事件级幂等（必须，jobId+phase+completedComponents 不够）**：`jobId`+`phase`+`completedComponents` 只能恢复任务快照，**无法识别同一个制造完成事件被重复投递**——重复事件到达时仍会再次 `completedComponents[id]++`。项目已有现成机制：`GameEvents.onIdempotent(type, options, listener)`（events.js:196）+ 每个事件的唯一 `event.eventId`（events.js:165/174）。协议订阅必须写成：

```js
GameEvents.onIdempotent("manufacturing:completed", {          // 事件源：tick.js:158（component 分支）
  consumerId: "research:intship:" + job.jobId,                // ledgerKey = consumerId + ":" + eventId（events.js:205）
  getLedger: () => gameState.research.protocolJobs.intship,   // ledger 即任务本身，processedEventIds 随存档持久化
  maxEntries: 512
}, event => {
  const job = gameState.research.protocolJobs.intship;
  if (!job || job.jobId !== myJobId || job.phase !== "components") return false;   // 未消费，不进 ledger
  if (event.payload.branch !== "component") return false;
  if (event.payload.recipeId !== job.currentComponentId) return false;             // 必须核对 recipeId 与当前组件一致
  advanceIntshipJob(job, event);                              // 成功消费：计数、决定下一组件或进入 assembly
  return true;                                                // 只有成功消费的事件才进入 processedEventIds
});
```

关键语义（与 events.js:201-211 一致）：listener 返回 `false` = 未消费，事件**不写入** ledger（他人的制造完成、recipeId 不匹配、任务已 stopped 等场景不污染账本）；返回非 false 才追加 `ledgerKey`，超 `maxEntries` 自动裁剪最旧。读档后 `processedEventIds` 随任务恢复，重复投递/重放的同 `eventId` 事件直接跳过——不重复计数、不重复扣料。总装完成（`branch:"ship"`，tick.js:177）同法核对 `shipId === job.targetShipId`。

要求：

1. 玩家点击一体化造船时**原子计算**缺失组件（`getShipAssemblyComponentCost` manufacturing.js:28 + 现有库存），写入 `componentPlan`，phase=components。
2. 逐项启动**现有**组件制造动作（`startShipComponent` actions.js:123），不绕过材料/时间/经验。
3. 每次制造完成事件到达后：核对 `jobId` 与 `phase`，更新 `completedComponents`/`updatedAt`，再决定下一组件或进入 assembly（`startShipAssembly` actions.js:140）。
4. 材料不足：phase=stopped、写 `stopReason`；**补足后不自动恢复**，必须玩家重新点击继续（重新原子计算计划）。
5. 正常消耗材料、时间并获得经验（全部走现有动作函数）。
6. 存档/读档后能恢复任务状态：**不重复扣料、不重复完成**——快照恢复靠 `jobId`+`phase`+`completedComponents`，**事件重复投递靠 `processedEventIds`（onIdempotent ledger）判定**，且每个事件必须核对 `payload.recipeId`（或 `shipId`）与 `currentComponentId`（或 `targetShipId`）相符；**不能只靠 `currentAction` 推断**（currentAction 可能已被完成事件清空或被玩家手动操作覆盖）。
7. 在线与现有离线制造结算共用相同完成事件（`completeQueuedActionCycle` 路径），协议只订阅事件、不另写结算。
8. **不自动生产强化组件**（强化组件属 autoenh 范畴且默认不产）。
9. 玩家手动启动其他制造动作时，任务 phase=stopped（`stopReason:"preempted"`），不抢占。
10. 旧档迁移：`protocolJobs` 缺失补 `{ intship:null }`。

测试点：断电/读档后从 components 中段恢复不重复扣料；组件阶段中断（材料被玩家花掉）→ stopped；总装前中断（组件被玩家卖掉/用掉）→ 重新点击后重算计划；**同一 `eventId` 的制造完成事件重复 emit 两次，`completedComponents` 只 +1 且 `processedEventIds` 只含一条**；`recipeId` 与 `currentComponentId` 不符的完成事件返回 false、不进 ledger、不计数；quantity>1 连续链路。

### 6.2 自动强化（autoenh）

- 推荐模块：`js/systems/ship-enhancement.js` + `actions.js`
- 调用入口：`ShellStateActions.enhanceShip`（actions.js:942），成本 `getShipEnhancementCost`（ship-enhancement.js:58，**只 spend `component:<id>`**）
- 所需状态：`protocolSettings.autoenh.enabled`、`maxAttempts`（0=直到不足）、`gameState.shipEnhancements`
- 触发：玩家点击自动强化后循环尝试（非研究 tick）
- 幂等保障：每次 attempt 真实调 `getShipEnhancementCost` 校验；失败等级保持（event `ship:enhancementAttempted` actions.js:972）
- 失败条件：组件不足 → 停止；首版仅 V1 舰船（`getShipEnhancementCost` 的 tier 限制）
- 测试点：只消耗不产出；N 次后停；V1 限制；成功率真实计算

### 6.3 行星维护自动化（planauto）—— 权威配置在每个 deployment

用户规则：**每个基地独立开启和配置**。权威字段放在每个 deployment（`state.js:72` deployments 数组、`actions.js:650` 创建处）：

```js
deployment.autoRenew = {
  enabled: false,        // 该基地独立开关
  minIskReserve: 0,      // 该基地独立最低 ISK 保留
}
```

顶层 `protocolSettings.planauto` **只表示协议是否解锁/允许使用**（`{enabled}`），**不保存全局最低 ISK**。全局与基地**不允许同时保存两套 `minIskReserve`**——机器可读权威只有 deployment 一份，UI 若提供"批量应用"也只是把值写进各 deployment。

续费条件（逐基地判断）：

```
currentISK - maintenanceCostISK >= deployment.autoRenew.minIskReserve
```

要求：

- 调用入口：`PlanetaryStateActions.renew`（actions.js:678-698，扣 `config.maintenanceCostISK`，emit `planetary:renewed`）；使用**准确到期时间**调用。
- 离线可能连续跨越多个维护周期：按到期时刻**逐次**判断和扣费（每个周期独立过条件），不得一次性打包扣。
- 余额不足：停止**该基地**（正常到期停产），不影响其他基地后续判断。
- 不自动收取产出、不自动重建。
- 旧档迁移：deployment 缺 `autoRenew` 字段时补默认 `{enabled:false, minIskReserve:0}`（挂 `normalizePlanetaryState` 或 `migrateResearchState`）。
- 测试点：双基地一开一关互不影响；离线跨 3 周期逐次扣费；第 2 周期余额不足即停该基地、另一基地正常；reserve 边界值（恰好相等 → 续费）。

### 6.4 文物自动出售（autosell）—— 离线上下文

现有 `sellArchaeologyArtifacts(state, artifactId, quantity, all)`（archaeology.js:315）把事件 metadata **写死 `{ offline:false }`**（L332/L344）。扩展为可选上下文（末位参数，默认不破坏现有调用）：

```
sellArchaeologyArtifacts(state, artifactId, quantity, all, context)
// context = { offline:false } 默认；自动协议离线调用传 { offline:true, source:"research-protocol" }
```

要求：

- 资源扣减和奖励仍复用现有函数体（不另写第二套出售逻辑）。
- 事件 metadata 正确反映 online/offline（`GameEvents.emit(..., { offline:context.offline, source:context.source })`）。
- 离线期间避免逐件 toast；使用**批量汇总通知**（并入 `showOfflineToast` 摘要，offline.js:21）。
- **自动出售只处理 ISK 文物**（`category: common_isk / unique`）；`lp` 与 `calibration` 类别不得误处理。
- 触发：考古产物入库后（在线 `resolveArchaeologyCycle` 成功分支之后 / 离线 `settleByTime` 汇总入库之后），非研究 tick。

### 6.5 文物自动兑换（autoconv）—— 离线上下文

同 §6.4，对 `redeemArchaeologyArtifacts(state, artifactId, quantity, all, context)`（archaeology.js:348，metadata 写死处 L365/L377）：

- context 语义与默认值同上；自动协议离线传 `{ offline:true, source:"research-protocol" }`。
- **自动兑换只处理 LP 文物**（`category: lp`）；ISK 类与 `calibration` 不得误处理。
- 复用现有函数、事件 metadata 正确、离线批量汇总通知。
- 测试点（4/5 共用）：离线自动出售后事件 `offline:true`；手动出售仍 `offline:false`；calibration 永不被自动处理；autosell 与 autoconv 各自类别互斥。

### 6.6 野外自动维修（autorepair）—— 必须定位考古舰船，在线/离线首版一致

**接口修正**：现有 `getInstalledCombatRepairers()`（combat.js:21）**无参数**，经 `getActiveCombatShipState`（selectors.js:1018）读取 `state.shipAssignments.combat`（L1020）——它拿到的是**战斗舰船**，**不能用于考古反噬**。

正确数据来源链：

```
state.shipAssignments.archaeology            // 考古指派（archaeology.js:251 同款读法）
  → getShipInstanceFromState(state, instanceId)   // selectors.js:10
  → getFittingFromInstance(instance)              // 舰船 fitting
  → 遍历 ["high","mid","low","rig"] 槽、resolveEquipmentReference(state, ref)
  → 筛选 equipment.combat.kind === "repair"       // 同 selectors.js:1027-1048 模式
```

新增**纯函数**（不读全局、不依赖战斗态）：

```
getArchaeologyShipMaxHp(state, instanceId)
// 三层最大生命来源：与 resetArchaeologyShipHp（archaeology.js:82-88）完全相同的取值链——
// getShipInstanceFromState → getShipConfigById(instance.shipId) →
// { shield: config.hp.shield, armor: config.hp.armor, structure: config.hp.structure }
// config 不存在时返回 {shield:0, armor:0, structure:0}（fail-closed，全部视为"满血"不激活）

getInstalledRepairersForShip(state, instanceId)
// 按上述 fitting 链筛选 kind==="repair"，每件标准化为：
// { target, amount, fuelCost, multiplier, itemId }
//   target     ∈ shield/armor/structure（equipment.combat.target）
//   amount     基础修理量（equipment.combat.amount）
//   fuelCost   单次激活燃料（equipment.combat.fuelCost）
//   multiplier 该 target 的维修倍率（考古场景固定的装备/科研倍率，不读战斗态）
//   itemId     装备 id（日志/事件用）

applyArchaeologyFieldRepair(state, instanceId, hp, context)
// hp = getArchaeologyShipHp(state, instanceId) 返回的三层 HP 对象（archaeology.js:301）
// 内部自行调用 getArchaeologyShipMaxHp(state, instanceId) 取三层上限——
// 满血判断与治疗钳制都必须用它，接口不依赖调用方另传 maxHp
// context 至少包含 { now, offline, source:"archaeology-backlash" }
// 每件激活的最终治疗必须钳制：
//   hp[target] = min(maxHp[target], hp[target] + rep.amount * rep.multiplier)
```

触发位置：

- `resolveArchaeologyCycle`（archaeology.js:245，**在线/离线共用的反噬结算路径**）失败分支中，反噬伤害已计算并写入（L300-302）**之后**、且仅 `destroyed === false` 时（即 L311 非致命返回路径上）触发。
- **不得**挂在战斗 tick；**不得**读取当前战斗舰船（`getInstalledCombatRepairers`/`getActiveCombatShipState` 禁用于此协议）。
- 由于 `resolveArchaeologyCycle` 同时服务在线（tick.js 考古分支）与离线（`settleByTime` offline.js:250），在此处挂接**天然覆盖在线与离线**，共用同一函数和同一资源扣减逻辑。

行为（逐条）：

1. 协议已解锁且开关启用（`protocolSettings.autorepair.enabled`；如有基地/功能级开关一并判断）。
2. 考古舰船确实装备维修装备（`getInstalledRepairersForShip` 非空）。
3. 根据每件维修装备的 `target` 对应层处理护盾/装甲/结构（治疗量语义同 combat.js:734：`rep.amount × rep.multiplier`），最终写入必须钳制 `hp[target] = min(maxHp[target], hp[target] + rep.amount * rep.multiplier)`，`maxHp` 取自 `getArchaeologyShipMaxHp`（与 resetArchaeologyShipHp 同源，archaeology.js:82-88）。
4. **每件**符合条件的维修装备在**这次反噬后最多激活一次**（遍历一轮，不循环回血）。
5. 每次激活消耗**真实 fuel**：`ResourceRegistry.spend(state, "consumable:fuel", rep.fuelCost)`（语义同 combat.js:730/736；考古场景无 zone 倍率，取装备原值）。
6. 满血层不激活、不耗燃料（先比较 `hp[target] < maxHp[target]`，maxHp 同上取自舰船 config 三层值）。
7. 燃料不足时停止后续激活（余额 < 该件 fuelCost 即 break/continue 后续不再扣）。
8. **不复活、不处理致命反噬**（`destroyed===true` 分支 L305-310 不触发本协议）。
9. 在线/离线使用同一 `applyArchaeologyFieldRepair` 与同一 `ResourceRegistry` 扣减逻辑；事件 metadata 带 `context.offline`。

> **风险表述修正**：删除旧版"离线考古以后再扩展"的说法——本项目**已有离线考古**（`settleByTime` offline.js:250 → `resolveArchaeologyCycle`），本协议**首版就必须在线/离线一致**。

测试点：非致命反噬后按层修复且扣真实燃料；满血层零消耗；**治疗溢出钳制**（修理量 > 缺口时 `hp[target]` 恰等于 `maxHp[target]`，不超上限）；燃料只够一件时第二件不激活；致命反噬不触发；离线 `settleByTime` 路径与在线路径修复量/扣费一致；战斗舰船与考古舰船不同配置时读取的是考古舰船的维修装备；`getArchaeologyShipMaxHp` 与 `resetArchaeologyShipHp` 重置值逐层相等。

---

## 6A. bonus.group 映射集合校验（31 个 group）

`tools/research-tree-data.mjs` 当前共有 **31 个唯一 `bonus.group`**（脚本实测，非 28）：

```
allMfg, allMining, allWeapon, archEff, archExp, archSuccess, armor, autoline,
backlash, booster, build, combatExp, equip, fuel, gas, laserDmg, mining,
missileDmg, planCost, planProd, probe, projDmg, repair, shield, shipAsm,
shipComp, smelt, structure, tactical, tierHp, weaponDmg
```

实装时在 `audit-research.mjs --data` 中加入**集合一致性校验**：

```
dataGroups   = 从 NODES 提取所有非空 bonus.group（Set）
mappedGroups = 正式接入映射表（js/data/research.js 的 group→消费点注册表）全部 group（Set）
assert setEqual(dataGroups, mappedGroups)     // 双向：无漏映射、无多余映射
```

要求：

- **不允许漏映射**（dataGroups − mappedGroups 必须为空集）。
- **不允许拼写漂移**（mappedGroups − dataGroups 必须为空集，杜绝 `laserDamage` 之类幽灵键）。
- 文档/UI 中的合并展示行（如"分武器伤害"一行、"各层容量"一行）在**机器可读映射中仍须逐项列出**：`laserDmg` / `missileDmg` / `projDmg` 三项分列；`shield` / `armor` / `structure` 三项分列。
- 数据侧新增 group 时，本审计**必须失败**，直到正式映射表补充该项——防数值静默失效。

---

## 7. 模块拆分建议（本阶段不创建）

| 文件 | 职责 | 依赖 | 修改风险 |
|---|---|---|---|
| `js/data/research.js`（新） | 内嵌 `NODES`（从 `research-tree-data.mjs` 移植）、`WEIGHTS`/`RANK_MULT`/`UNIT`、前置表、**group→消费点映射注册表（§6A）** | 无（纯数据） | 低；须与 data.mjs 冻结值一致 |
| `js/core/research-state.js`（新，或并入 `state.js`/现有迁移） | `gameState.research` 初始化、`migrateResearchState()`、**`getResearchBonusValue` / `getResearchCombinedBonus` / `getResearchMultiplier`（§5.1）** | state.js、persistence.js | 中；挂 `autoLoad`/`importData` 顺序（L1074/L972） |
| `js/systems/research.js`（新） | §4 全部函数：`processResearchUntil`/`startResearch`/`enqueueResearch`/`buildProjectedResearchLevels`/`startNextFromQueue`/`cancelResearch`/`applyResearchHours`/`completeResearchStep`/`isStepValidAgainst`/`getResearchDuration`/`getResearchProgress`；协议任务 `protocolJobs` 推进 | state.js、events.js、data | 中；核心逻辑，须单测覆盖 |
| `js/ui/research-render.js`（新） | 研究页渲染、队列 UI、进度条、协议开关 | shell-render.js、selectors.js | 中；仅 UI |
| `css/research.css`（新） | 研究页样式 | index.html | 低 |
| `index.html` | 加 `<script defer src="js/data/research.js">` 等、侧栏 `.nav-item[data-page="research"]`、`<div id="research-panel">` | — | 低；须与 `standalonePages` 三处注册一致 |
| `js/core/selectors.js` | `standalonePages` 加 `research:"research-panel"`（L2047）；各消费点乘**单一**科研乘子（§5.2） | research-state.js | **高**（触碰既有效率公式，回归面大） |
| `js/core/combat-modifiers.js` 调用侧 | 战斗类**聚合** research modifier 注入（§5.3，每 stat 一条） | research-state.js | 中；零改基础公式，仅加 modifier |
| `js/core/persistence.js` | `autoLoad`/`importData` 加 `migrateResearchState`（含 deployment.autoRenew、protocolJobs 补默认） | research-state.js | 中；迁移顺序敏感 |
| `js/core/tick.js` + `js/core/offline.js` | 各调用一次 `processResearchUntil(now)` | research.js | 中；在线/离线共用同一入口 |
| `js/systems/archaeology.js` | `resolveArchaeologyCycle` 非致命反噬后挂 `applyArchaeologyFieldRepair`；sell/redeem 加 context 参数 | research.js | 中；改动点小但在共用路径上 |
| `tools/audit-research.mjs`（新） | VM 沙箱审计（--data/--state/--queue/--settle/--hours/--numeric/--protocol） | index.html、research 模块 | 低（测试） |

---

## 8. 实装批次（可独立验收）

| 批次 | 修改文件 | 完成标准 | 验证命令 | 回滚边界 | 影响旧档 |
|---|---|---|---|---|---|
| **A 数据与校验** | `js/data/research.js`（新）、`js/core/research-state.js`（新：迁移 + §5.1 三个帮助函数） | `NODES` 与 data.mjs 一致；**31 group 集合一致性校验（§6A）通过**；前置校验/无环/可达单测过 | `node tools/audit-research.mjs --data` | 仅新增文件，删即回滚 | 否（仅初始化空 `research`） |
| **B 状态/存档/单槽队列** | `state.js`（加 `research` 字段）、`persistence.js`（加 `migrateResearchState` 至 L1074/L972） | 旧档读入补全字段（含删除遗留 `lastResearchUpdate`、补 `protocolJobs`/`deployment.autoRenew`）；**§4.8 队列投影测试全过**（连续排队/前序队列满足前置/倒序拒绝/重复拒绝/非法旧档项跳过/上限20） | `node tools/audit-research.mjs --state --queue` | 移除迁移调用+字段 | 是（旧档需迁移，幂等） |
| **C 在线/离线结算** | `tick.js`（调 `processResearchUntil`）、`offline.js`（`calculateOfflineGains` 内同一入口） | 在线/离线同一入口同一锚点；**科研离线最多结算 24 小时（MAX_OFFLINE_SECONDS），超出部分永久丢弃**；一次离线多步用虚拟游标；时钟倒退 elapsed=0 且锚点单调；重复调用幂等 | `node tools/audit-research.mjs --settle` | 移除两处调用 | 否（仅推进时间） |
| **D 成就科研工时** | `research.js`（`applyResearchHours`）、成就模块（新，不在本研究批次） | 50% 上限、`appliedAchievementSeconds` 跨读档不破限；四档加速值达（**90/80/75/70/65/60 天基准不变**） | `node tools/calculate-research-tree.mjs`（对照）、`audit-research.mjs --hours` | 移除工时接口 | 否 |
| **E 数值科技接入** | `selectors.js`（§5.2 各消费点）、`combat-modifiers.js` 调用侧（§5.3 聚合 modifier） | **科研内部同类加成先求和、每消费点只乘一次**；精确断言 1.08/1.125/1.105/1.045 全过；**8.12%、13.03% 等复利结果必须使断言失败** | `node tools/audit-research.mjs --numeric` | 回退因子乘法 | 否（仅改计算） |
| **F 研究页面** | `index.html`、`shell-render.js`（L19/L24/L40）、`research-render.js`（新）、`css/research.css`（新） | 三处注册一致；页面可研究/排队/看进度 | 浏览器手测 + `audit-research.mjs --ui` | 移除注册与文件 | 否 |
| **G 六协议逐项** | `manufacturing.js`/`actions.js`/`ship-enhancement.js`/`planetary.js`/`archaeology.js` + `protocolSettings`/`protocolJobs` | 每协议幂等/失败条件/在线离线一致（§6）。**新增**：①考古舰船维修（`getInstalledRepairersForShip`+`applyArchaeologyFieldRepair`，在线/离线共用反噬路径）；②在线/离线文物事件上下文（sell/redeem context 参数、metadata 正确、离线批量通知）；③一体化造船 `protocolJobs` 迁移与读档幂等（断电/重复事件不双扣）；④单基地自动续费配置（deployment.autoRenew 权威、逐周期扣费、互不影响） | `node tools/audit-research.mjs --protocol intship ...` | 关 `enabled` 即禁用 | 是（deployment/protocolJobs 补字段，幂等） |
| **H 综合回归** | 全部 + `DEVLOG.md`/`PROJECT_HANDOFF.md` | 90 天精确复测、旧档迁移、全断言绿 | `node tools/calculate-research-tree.mjs`、`node tools/audit-research.mjs`、`git status` | 全回滚至 B 前 | 视前序 |

**推荐首先实装批次：A → B → C**（数据与状态地基 → 存档迁移 → 时间结算核心），三者即可独立验收且风险可控；E（数值接入）紧随，因其回归面最大需尽早锁定。

---

## 9. 风险清单

1. **旧档缺研究字段**：`gameState.research` 缺失 → `migrateResearchState` 用默认对象补全；`completedLevels` 非对象重置；遗留 `activeResearch.lastResearchUpdate` 一律删除（§3.8）。
2. **离线重复结算**：唯一锚点 `lastProcessedAt` + 入口内封顶，重复调用幂等（§4.2 第 1 条）；不依赖 `calculateOfflineGains` 的单次守卫。
3. **修改系统时间**：`now < lastProcessedAt` → elapsed=0；锚点 `max()` 单调，倒退区间永不补算（§4.4）。
4. **科研队列非法前置**：入队投影校验 + 队首真实校验双关；非法项移除+通知+guard，不堵死队列（§4.5/§4.6）。
5. **成就工时重复领/破 50%**：`appliedAchievementSeconds` 上限 `0.5*baseDuration`；跨读档/切换/重复加载均校验；工时池余额不足拒扣。
6. **百分比叠加顺序**：科研内部同类效果**只加不乘**，每消费点单一乘子；战斗类每 stat 仅一条聚合 research modifier（§5）。
7. **自动协议重复消费**：各协议复用既有动作函数（出售/兑换/续期/强化），其内已有库存扣减原子性；协议层不另写扣减。
8. **自动造船部分完成状态**：`protocolJobs.intship` 持久化 phase/completedComponents；缺件 stopped 不自动恢复（§6.1）。
9. **自动维修读错舰船**：`getInstalledCombatRepairers` 读战斗舰船（selectors.js:1020），禁用于考古协议；必须走 `shipAssignments.archaeology` → `getInstalledRepairersForShip`（§6.6）。**离线考古已存在**（offline.js:250），首版在线/离线必须一致，无"以后再扩展"豁免。
10. **正式数据与 research-tree-data.mjs 漂移**：`js/data/research.js` 由 data.mjs 移植，实装前跑 `calculate-research-tree.mjs` 对照 `UNIT`/`WEIGHTS`；§6A 的 31 group 集合校验加入 CI/审计。
11. **脏工作树覆盖风险**：当前分支 24+ M 文件未提交；本阶段仅修订文档，未动任何正式文件；实装批次（尤其 E 改 selectors.js）须在干净 stash/分支进行，避免与并行改动冲突（见 AGENTS.md 文件保护）。
12. **多时间锚点重复推进**：若同时保留 `lastResearchUpdate`/`lastActiveTime`/`lastProcessedAt` 多套权威，在线 tick 与离线结算会各自推进同一段时间造成双计。对策：研究系统只承认 `lastProcessedAt`（§3/§4），迁移时删除遗留字段，审计断言 `activeResearch` 无 `lastResearchUpdate` 键。
13. **队列投影与真实状态不一致**：取消研究/非法旧档项会使投影乐观于现实。对策：投影只用于**入队**校验；**开始**研究一律真实 `completedLevels` 二次校验（§4.6），审计覆盖"投影通过但真实失败"用例。
14. **科研百分比内部复利**：多个 group 各自成乘性因子会把 8% 变 8.12%、12.5% 变 13.03%。对策：§5.1 帮助函数强制先加后乘；§5.4 精确断言拒绝复利值。
15. **协议读取错误舰船**：泛化风险（不止维修）——任何协议凡涉及舰船，必须显式传 `instanceId`（来自对应 `shipAssignments` 键），禁止调用隐式读"当前活跃舰船"的无参函数。
16. **链式任务读档重复消费**：一体化造船若靠 `currentAction` 推断进度，读档/重复完成事件会双扣材料。对策：快照恢复靠 `jobId`+`phase`+`completedComponents`，事件重放靠 `processedEventIds`（`GameEvents.onIdempotent`，events.js:196）+ `recipeId` 核对（§6.1 第 6 条），审计模拟同 `eventId` 重复投递。
17. **工时/取消交互双计自然时间或误伤下一节点**：`applyResearchHours`/`cancelResearch` 若不先 `processResearchUntil(now)`，上次 tick 至今的自然时间会在下一 tick 被算给新节点；而先结算又可能自然完成原节点并自动启动队列下一节点，导致工时误用到/取消掉刚启动的下一节点。对策：§4.7 双重不变式——结算前锁定 `expectedKey=techId+"@"+targetLevel`，结算后 activeResearch 为空返 `already-completed`、key 变化返 `research-changed`，仅 key 相同才扣工时/取消；取消成功后**立即** `startNextFromQueue(now)`，防队列静默停摆。
18. **战斗 modifier 幽灵键名**：文档/实装若使用非真实 stat（如 `repair`、`maxHp(该层)`）或幽灵 group（`tactical伤害分量`），modifier 永不匹配、数值静默失效。对策：§5.3 键名表锁定 `damageMultiplier`/`maxHp`/`repairMultiplier` + `weaponType`/`layer` 匹配键；§6A 集合校验杜绝 group 漂移。
19. **考古维修无上限治疗**：`applyArchaeologyFieldRepair` 若无 maxHp 来源，可能治疗超上限或永远视为不满血。对策：`getArchaeologyShipMaxHp` 与 `resetArchaeologyShipHp` 同源取 config 三层值，最终写入 `min(maxHp[target], hp[target]+amount*multiplier)` 钳制（§6.6）。

---

## 10. 文档小修正（记录于本文件，不改已验收设计文件）

1. **§13 协议前置描述更正**：`RESEARCH_SYSTEM_DESIGN.md` §13 写为"其余四协议集中于 III–IV"**不准确**——实际 `intship`/`autoenh` 含 V 级前置（`shipcomp`/`shipasm`/`mine`/`smelt`/`equipeng`/`boostereng` 均 L5）、`autosell`/`autoconv` 含 L4、`autorepair` 含 L5/`L4`、`planauto` 含 L5/`L4`。正式描述应为：**"非终极协议所需分支较少，前置集中于 IV–V"**。
2. **均衡发展 / 最短全满重复**：设计文档 §8 同时列"均衡发展"和"最短全满"两计划。在单槽固定 90 天条件下二者**总时长相同**（均 150 步串行），属重复概念。正式 UI 无需同时展示；保留其一（建议"均衡发展"按 era 序铺开）即可。
3. **group 数量更正**：本文档旧版按"28 个 group"表述，实测 `research-tree-data.mjs` 共 **31 个唯一 bonus.group**（§6A 全列）；映射校验以 31 为准。

---

## 11. 交付与验证

### 11.1 交付物
- 本文件 `RESEARCH_SYSTEM_IMPLEMENTATION_PLAN.md`（修订，唯一产出）。

### 11.2 验证命令与真实 EXIT CODE（本阶段仅文档，命令用于确认未触碰正式代码）

```
git diff --check            # 检查跟踪文件 whitespace（本阶段无对正式代码的改动）
git status --short          # 列出改动；本阶段应仅涉及本文档（?? 或 M）
```

| 命令 | 预期 EXIT |
|---|---|
| `git diff --check` | 0 |
| `git status --short` | 0（除既有未提交改动外，仅本文档一项） |

> 注：`git status --short` 输出的 `LF will be replaced by CRLF` 是其他**已跟踪文件**的预存警告（非本次产生、非错误）。

### 11.3 最终报告要点（逐条）

1. **24h 科研离线上限如何实现且只应用一次**：`processResearchUntil` 内部 `elapsed = min(rawElapsed, MAX_OFFLINE_SECONDS)` 是全链路唯一封顶点（§4.2 第 1 条）；调用方只传 `now` 不传 elapsed；结算后锚点直推 `now`，超出部分永久丢弃且重复调用幂等（§4.2 第 2 条）。
2. **单一时间锚点如何避免重复推进**：研究系统唯一权威 `research.lastProcessedAt`；`activeResearch.lastResearchUpdate` 字段删除、`startedAt` 仅展示、`lastActiveTime` 不参与研究计算（§3/§4.1）；迁移删遗留字段+审计断言（§9 风险 12）。
3. **projectedLevels 如何支持连续排队**：`buildProjectedResearchLevels` 按 completedLevels → activeResearch → pendingQueue 顺序模拟完成后的等级快照，入队新项对快照校验（可排 II/III、可依赖前序队列项）；开始时用真实等级二次校验+非法项移除+guard（§4.5/§4.6/§4.8）。
4. **数值如何保证 8%/12.5%/10.5% 不复利**：科研内部同类 group 经 `getResearchCombinedBonus` 纯加法求和，`getResearchMultiplier` 是唯一成乘子位置，每消费点只乘一次；combat.modifiers 每 stat 仅一条聚合 research modifier；精确断言拒绝 1.0812/1.1303 等复利值（§5）。
5. **自动维修如何定位考古舰船并覆盖离线**：数据源 `state.shipAssignments.archaeology` → `getShipInstanceFromState` → fitting → `kind==="repair"`（新纯函数 `getInstalledRepairersForShip`）；挂接在在线/离线共用的 `resolveArchaeologyCycle` 非致命反噬路径（archaeology.js:311 前），离线 `settleByTime` 自动覆盖；禁用读战斗舰船的 `getInstalledCombatRepairers`（§6.6）。
6. **一体化造船任务如何持久化和幂等**：`research.protocolJobs.intship` 保存 jobId/phase/componentPlan/completedComponents/assemblyRemaining；靠 jobId+phase+completedComponents 幂等判定，不靠 currentAction 推断；读档/重复事件不双扣（§6.1）。
7. **行星配置为何只有 deployment 一份权威**：`deployment.autoRenew = {enabled, minIskReserve}` 是唯一机器可读权威；顶层 `protocolSettings.planauto` 仅解锁/允许开关，不存全局 minIskReserve，杜绝两套配置漂移（§6.3）。
8. **31 个 group 如何做集合一致性校验**：`setEqual(dataGroups, mappedGroups)` 双向断言（无漏映射、无拼写漂移）；合并展示行在映射中逐项分列；数据新增 group 时审计失败直至补映射（§6A）。
9. **边界确认**：本阶段未修改任何正式代码（`js/**`、`css/**`、`index.html`、`research-tree-civ6.html`、data.mjs、calc.mjs、DESIGN.md 均未动）；未 `git add` / `commit` / `push`；既有未提交改动原样保留。

---

*等待 Codex 复验，不进入正式实装。*
