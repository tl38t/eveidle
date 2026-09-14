# 泰坦线（Titan Line）研究设计交接 v0.1

> 用途：交给**另一会话**继续做泰坦线的「研究 + 设计」，**不是实现任务书**。
> 本文件只做三件事：① 现状真值盘点 ② 待研究议题与决策点 ③ 分阶段工作包与边界。
> 编写时间：2026-09-10（RC65 已上 TapTap 审核中；本地工作树含 RC66 候选改动，**尚未提交**）。

---

## 0. 交接须知（先读，违规即停）

| 项目 | 内容 |
|---|---|
| 源码真值目录 | `D:\EVE-IDLE\EVEIDLE-WORKBUDDY-FRESH\`（根目录 `D:\EVE-IDLE` 只有构建产物/草稿） |
| 当前工作树 | **未提交**，约 469 项变更，含泰坦 P0 全链路 + A/B 组收尾。**接手前先 `git status` 看清楚，不要 `git add -A`** |
| 最近提交 | `9524492`（RC65 泰坦系统实装收口，38 文件） |
| 铁律 | ① 先查不改，未经用户当次明确指令不动生产代码；② 每改一个被引用的 JS/HTML/CSS 必须 `?v=` +1；③ commit / build / 上传 TapTap 每步都要用户当次明确指令；④ 数值与性能结论必须 **probe-based 实测**，禁止估算 |
| 冻结文件（碰到即停并报告） | `js/core/tick.js`、`offline.js`、`persistence.js`、`queue.js`、`events.js`、`js/render3d/**` |
| 回归三件套 | `audit-unlimited-inventory.mjs`（EXIT=0，52 PASS）、`test-online-offline-parity.mjs`（EXIT=0）、`combat-online-offline-parity.mjs`（EXIT=0）、`git diff --check`（EXIT=0） |
| 已知固有失败基线 | `verify.mjs` EXIT=1 —— 既有 5 文件资源池违规（statistics / achievements / legion-npc / wormhole / diagnostics），**非新引入**；`verify.mjs` line 937/974/561 与 DOM 基线 382 亦为固有失败 |

浏览器验证环境（已实测可用）：
- **puppeteer-core 依赖残缺，不要用**；用 `playwright-core`（`createRequire("C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/")`）+ `executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"`。
- 本地预览：`python -m http.server 8765`（源码根），结束用 PowerShell `Stop-Process -Id <PID> -Force`。
- **坑**：合成 shipConfig 做纯函数探针时必须带 `id` 字段。`getShipManufacturingLevel` 首行 `SHIP_ASSEMBLY_RECIPES.find(r => r.shipId === shipConfig.id)`，表里存在 `laser_directional_salvage_unit` 这类**无 shipId** 的条目，`id` 为 `undefined` 时会被命中，档位被误判成 55（战列档）。

---

## 1. 现状真值盘点（截至本文件编写）

### 1.1 已实装（有代码、有验证）

| 模块 | 落点 | 关键真值 |
|---|---|---|
| 数据表 | `js/data/titans.js` | 3 舰体 / 3 武器 / 3 核心 = **27 组合**；每组件数据负载 60（与超旗总装 60/艘 同档） |
| 解锁门禁 | `TITAN_UNLOCK` (titans.js:133-141) | 三个领地星图节点 **20（苍穹）/ 62（赤誓）/ 104（静默）** + 先驱文明核心 `precursor_core` + 船坞 Lv3 |
| 冶炼 | `TITAN_SMELTING` (titans.js:150-165) | 锻星合金 Lv90 / 90s / 700XP / 星骸钛晶40+赫利昂冷凝气40→×1（日供≈94.7）；熔虚晶体 Lv100 / 240s / 1100XP / 相位铱核2+虚境裂流2→×1（日供≈61.5） |
| 总装 | `getTitanAssemblyRecipe` | time 3600s / xp 1500 / level 100 / 船坞 Lv3 / 三组件各 1 / 锻星 200 / **ISK 5,000,000（独立字段，不进 materialCost）** |
| 实例 | `createShipInstance` + `titanCombo` | shipId 编解码 `titan__hull__weapon__core`；`TITAN_CONFIG_REGISTRY` 挂在 `SHIP_DATA.titan` |
| 注册表解析 | `selectors.js getShipConfigById` 末尾 1 行 | 56 处调用点零改动；`persistence.js` 归一化钩子**必须插在 `migrateGhostDeployableShips` 之前**（否则泰坦被判幽灵船删除） |
| 在线/离线 | `tick.js` / `offline.js` | `titanAssembly` 完成分支：扣 ISK/组件/锻星 → 建实例 → XP1500 → emit |
| 战斗 | `combat.js` / `offline-combat.js` / `legion-combat-squad.js` | 三口径已对齐：武器强化剂进齐射 / NPC 吃 titanVuln 易伤（全小队）/ 核心打击吃 adBuff |
| 槽位 | `buildTitanConfig` (titans.js:20/36/51) | `high:7, highUsable:0, mid:7|3, low:3|7, rig:5` —— **7 高槽全部被末日武器占用，当前可用高槽 = 0** |
| 装配 | `selectors.js getShipFittingDisplayState` | `[usableHigh, high)` 段标 `doomsday`（enabled=false、图标 ☄、不可更换）；中低槽/rig 已对旗舰/超旗装备开放 |
| 强化 | `ship-enhancement.js` | 见 1.2 |
| 拆解 | `getShipDismantleRecipeFor`（selectors.js / actions.js） | 虚拟配方；三组件材料 + 锻星按回收率返还，**ISK 不返还** |
| 3D 预览 | `js/render3d/titan/TitanFactory.js`、`js/ui/titan-forge-3d.js` | 已有 |

### 1.2 泰坦强化当前数值（本轮刚定，2026-09-10）

每次尝试消耗 = 超旗综合舰体组件 ×1 + 超旗动力控制核心 ×1 + 超旗舰船功能组件 ×1 + **锻星合金 ×8** + **熔虚晶体 ×4** + **星币 2,000,000**。

- **成功率门槛沿用 tier 90**（刻意不建 tier 100：否则需求等级 90→100，工程 Lv120 时 +0 从 75.5% 掉到 50%）。
- 基础经验 **2095**（= (1390 超旗三组件 + 2800 泰坦三组件) × 0.5，沿用既有「组件配方 XP 和 ×0.5」规则，运行时从 `TITAN_COMPONENT_COSTS` 惰性读取）；成功 XP = 2095 × (1 + 0.2L) → +0: 2095 / +10: 6285 / +19: 10056；失败 0。
- 单点可调常量：`SHIP_ENHANCEMENT_EXTRA_MATERIALS.titan`、`SHIP_ENHANCEMENT_ISK_OVERRIDE.titan`。
- 泰坦制造等级 100（`getShipManufacturingLevel`），但**档位**取 tier 90。
- 拆解返还已把这两种精炼料计入。

### 1.3 NPC 绑定

`legion-npc.js SHIP_TIER_MULT.titan = 5.0`（超旗 3.0 / 旗舰 2.5）。战斗类 NPC 绑泰坦 = **500 XP/h**；工业/考古 NPC 角色不匹配 ×0.5 = 250 XP/h；管理类 NPC 不看舰船。
> ⚠️ 已向用户提示的疑点：泰坦 7 高槽全被末日武器占用、**装不了普通武器**，而 NPC 战斗属性读已装设备 → 泰坦绑 NPC 的**实战贡献可能远低于 5.0 倍率的暗示**。这是"研究线"优先要验的事（见 W2）。

### 1.4 明确缺口（代码层面确认为 0 覆盖或已注明待补）

| 缺口 | 证据 |
|---|---|
| **研究科技树泰坦线（`tt_*`）未建** | `js/data/research.js:416` 注释「三条子线共用一个入口 sm_root；泰坦线（tt_*）待泰坦战斗系统实装后另行追加」、`:591`「仅含已实装的星图 + 虫洞两线；泰坦线随泰坦战斗系统同期追加」 |
| 成就 0 覆盖 | `js/systems/achievements.js` 命中数 0；`js/data/achievement-rules.js` 亦无泰坦条目 |
| 虫洞侧只有材料产出 +1 条科技 | `research.js:528` 「虫洞泰坦材料 +3%~+15%」 |
| i18n 部分 | 本轮新增文案已补 18 条，组装/门禁/末日武器 toast 等已入 `catalog-en.js`，**但尚未逐条对齐中文 UI 全量** |
| changelog | 0.7.9 条目只写「船坞新增泰坦组装页面 + 组件预览」，**未覆盖 P0 真总装 / 机库装配出战 / 高槽占用**（用户已定延后 → 建议单列 0.7.10） |
| 高槽可用性 | `highUsable: 0` —— 用户已定「以后开放更多高槽也要对普通武器开放」，但**开放时机与数量未定** |

---

## 2. 研究议题（按优先级）

### W1 — 数值与经济的可达性验证（最高优先，产出=表格+结论，不改代码）

核心问题：**首艘泰坦与满强化泰坦，真实需要多少天？是不是"看得见摸不着"？**

- 已知锚点：熔虚 800 ÷ 61.5/日 ≈ 13 日；锻星 800 ÷ 94.7/日 ≈ 8.4 日（首艘瓶颈，titans.js:168 注释）。
- 需实测补齐：① 三组件常规材料（三钛合金/基腹断岩/超噬矿/莫尔石/铷/磁场聚合物等）折算天数；② 装配 3 座领地节点（20/62/104）+ 先驱核心的实际前置时长；③ 船坞 Lv3 + 技能 Lv100 的门槛；④ 满强化（+20）在 ~40 次尝试下的**总账单**（40×超旗组件 + 320 锻星 + 160 熔虚 + 8,000 万星币）。
- 输出物：`docs/TITAN_ECONOMY_BASELINE.md`，含「首艘 T+0 到 T+N 天」甘特式表格 + 星币/材料双瓶颈判定 + 建议调整量（单点常量）。
- 方法：写 `tools/_probe_titan_economy.mjs` 直读数据表累加，禁止手算；与生产侧（mining/gas/smelt 日产）对齐口径。

### W2 — 泰坦战斗定位与 NPC 绑定合理性

核心问题：**泰坦到底强在哪，5.0 倍率与实战是否匹配？**

- 需查清：① 末日武器（核心打击）伤害占比 vs 齐射；② `getTitanCoreConsumption` 的燃料/弹药持续成本（`sustain` vs `everyRounds` 触发）；③ 光环核心（`kind === "aura"`）对小队的 `squadDamageBonus` 实际增益；④ **NPC 绑定场景**：`legion-combat-squad.js:1090-1115` 读已装设备算属性 → 泰坦高槽全锁，实测「泰坦 vs 超旗」绑同一 NPC 的 DPS 差。
- 输出物：结论 + 二选一建议（保持 5.0 / 下调 / 或改为「禁止泰坦绑 NPC」）。
- 三口径在线离线一致性**已经修过一次**，改战斗必须先跑 `combat-online-offline-parity.mjs`。

### W3 —— 已并入 W4（用户 2026-09-10 拍板）

**W3 不再作为独立工作包**：高槽开放通过研究科技树泰坦线中的「**末日武器小型化**」子线实现，**每级 +1 可用高槽**。
- 技术面已就绪：`getShipFittingDisplayState` 用 `usableHigh = config.slots.highUsable ?? slots.high`，科技效果只需在运行时抬高 `highUsable`（或注入 +N 修正），锁死渲染与点击拦截自动跟随，无需改 UI 层。
- 设计面待定：满级开放几个高槽（上限 7）、每级成本、是否要求前置组件/舰体谱系。
- 关联：若 W2 选方案 C（让泰坦在 NPC 侧生效），高槽开放才对 NPC 绑定有意义；选 A/B 则只影响玩家亲自驾驶。

### W4 — 研究科技树泰坦线（`tt_*`）设计（含末日武器小型化）

- 位置：`js/data/research.js` 已留 `sm_root` 入口与两处 TODO 注释。
- 需设计：① 子线数量与命名（建议对齐组件三线：defense/weapon/core，或按玩法：末日/光环/后勤）；② 与既有星图线、虫洞线的**前置关系**（避免泰坦线变成纯后置堆料）；③ 是否复用「虫洞泰坦材料 +%」那条已有科技的乘区（注意乘区命名与冶炼口径一致）；④ 每级效果数值 + 满级总增益上限。
- 约束：研究系统改动**易踩「生产速度/时间/配方」红线**（既有纪律：station/research 相关修复禁改生产速度、时间、配方），先出设计再落地。

### W5 — 成就 / 长期目标 / 内容厚度

- 缺口：`achievements.js` 0 覆盖。
- 建议清单（对齐既有 E01-E19 / Batch C-13 的 9-section 模式）：首艘泰坦下水、三舰体各一、三核心各一、27 组合收集度、泰坦 +10/+20 强化、泰坦单场击杀、泰坦绑 NPC 达到 LvN、泰坦拆解回收。
- 另可研究：**泰坦是否进星图/虫洞战斗**（当前只在常规战斗 + 军团小队），若能进，战力曲线会否击穿星图难度设计。

### W6 — 装备生态与周边

- 现状：中低槽/rig 只对 **capital/supercapital** 装备开放（本轮单点放行），**没有泰坦专属装备**。
- 待研究：① 是否需要泰坦专属改装件/rig；② 强化乘区是否要与超旗拉开（当前复用 tier 90 组件 + 额外料）；③ 泰坦维修/战损/回收链路（当前无独立维修系统文件，维修逻辑散在 actions/selectors）；④ 单艘出战（`getActiveCombatShipState` 单舰）下，多泰坦的收藏价值如何实现（机库陈列 / 3D 预览 / 组合图鉴）。

---

---

## 2.5 W1 / W2 已完成（2026-09-10）

| 包 | 产出 | 关键结论 |
|---|---|---|
| W1 经济可达性 | `docs/TITAN_ECONOMY_BASELINE.md` | 单艘固定成本：锻星 800 / 熔虚 800 / 星币 500 万 / 深层数据 180 / 常规材料 25,340 件 / 制造 3.5h + 冶炼 73.33h；**满强化 +20 期望 75.7~96.9 次 → 星币 1.52~1.94 亿 + 76~97 套超旗组件**；虫洞侧日供仅 锻星 2.31 / 熔虚 13.33，与 `titans.js:168` 注释（94.7 / 61.5）差 **41× / 4.6×** ⇒ 首艘泰坦是「346 日」还是「13 日」完全取决于星图侧采集供给，**必须先补这个输入** |
| W2 战斗定位 | `docs/TITAN_COMBAT_POSITION.md` | 泰坦每轮 10,786~22,500（含附加与核心打击），约为 T1 旗舰武器满装超旗（4,200/轮）的 **2.6×~5.4×**；**NPC 绑定泰坦实战输出为 0**（`legion-combat-squad.js:604-607` 只读 `fitted.high`，而泰坦 `highUsable=0`），5.0 倍率纯属练级加速器 ⇒ 建议「禁绑」或「明示不参战」 |

---

## 3. 建议推进顺序与边界

1. ~~先 W1（经济可达性）~~ —— **已完成**。
2. ~~再 W2（战斗实测）~~ —— **已完成**。
3. **下一步：W4（含末日武器小型化）** —— 依赖 W2 的 NPC 绑定结论（若禁绑，则 W4 的高槽收益只作用于玩家驾驶）。
4. **W5 / W6 最后** —— 内容层，可随版本逐步加。

每一包结束后「停止并报告」，等用户确认再进下一包。

**每包通用验收**：
- 结论文档落 `docs/`（命名 `TITAN_*.md`）；
- 所有数值来自 `tools/_probe_*.mjs` 实测输出（脚本用完即删，或经用户同意保留）；
- 若包内动了代码：改前报文件清单，改后跑回归三件套 + 浏览器冒烟（PASS/FAIL 计数 + consoleErrors/pageErrors 计数），并列出所有 `?v=` bump。

---

## 4. 需要用户拍板的开放决策（接手会话先问，不要替用户决定）

| # | 决策点 | 选项 |
|---|---|---|
| 1 | 泰坦绑 NPC 的 5.0 倍率 | 保持 5.0 / 下调 / 禁止泰坦绑 NPC |
| 2 | 高槽开放 | **已定**（2026-09-10）：并入研究科技树「末日武器小型化」，每级 +1 可用高槽；待定只剩满级开放数与每级成本 |
| 3 | 研究科技树泰坦线 | 三线（defense/weapon/core）/ 按玩法分（末日/光环/后勤）/ 暂不建 |
| 4 | 强化成本是否再调 | 当前 8 锻星 + 4 熔虚 + 200 万星币 + 基础经验 2095；材料/星币/经验三个单点常量均可独立调 |
| 5 | RC66 版本号 | 维持 0.7.9 / bump 0.7.10 |
| 6 | 泰坦能否进星图/虫洞战斗 | 能 / 不能 / 仅特定节点 |

---

## 5. 一句话现状总结

泰坦已从"数据表 + 视觉壳"打通为**真舰船**（冶炼供料 → 注册表解析 → 总装产出 → 机库装配出战 → 强化 → 拆解），但**经济可达性、战斗定位、科技树、成就、装备生态**五块仍在设计空白期 —— 这正是下一段研究要填的。
