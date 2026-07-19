# EVE IDLE 代码审查报告（2026-07-19）

## 检查方式与结论

- 内置 `tools/verify.mjs` **通过**：30 个 JS、4 个 CSS、201 个 DOM ID 全部存在，本地资源 HTTP 200；脚本在 mock DOM 下完整加载无顶层报错 → **游戏可正常启动**。
- 架构约束（分层/View State 纯度）原 `verify.mjs` 仅做静态与资源检查，**未覆盖** core↔UI 反向依赖，因此下列回归未被自动拦截。
- 全部「确证」项均已用 Grep/Read 二次核实（文件路径 + 行号）。

## 🔴 确证 · 架构回归（违反 ARCHITECTURE.md 分层）

### A1. `js/core/tick.js` — core 层直接调用 UI 层 `updateUI()`
- 证据：`tick.js` 中 `updateUI()` 被调用约 **25 处**（行 28/31/42/50/57/63/80/85/…/141）。`updateUI` 定义于 UI 层 `js/ui/render.js`。
- 违反：ARCHITECTURE.md「生产、战斗、行星和队列核心不得访问…页面渲染函数」。
- 影响：core 引擎与 DOM 强耦合，无法在 headless/测试环境独立运行；UI 重构签名会直接断裂引擎。
- 建议：tick 不调用 `updateUI()`，改为每个状态变更后 `GameEvents.emit("tick:completed",{changed:true})`，由 `render.js` 订阅统一刷新；或 `gameTick` 返回 `changed` 标记，由调用方决定刷新。

### A2. `js/systems/combat.js` — systems 层直接调用 UI 特效函数
- 证据：`combat.js:467` `playAttackFX(true, combat.weaponType, damage);`；`combat.js:498` `playEnemyAttackFX(...)`。二者定义于 `js/ui/combat-render.js:168/:256`。
- 违反：ARCHITECTURE.md「战斗核心不得重新引入 HUD DOM、面板渲染或攻击特效」。
- 影响：战斗核心依赖 UI 文件加载；若 UI 未加载会抛 `ReferenceError`，战斗逻辑不可测试。
- 建议：通过已有 `GameEvents.emit("combat:event",{type:"attack-fx",...})` 派发，由 `combat-render.js` 订阅播放；systems 层保持纯净。

### A3. `js/ui/combat-render.js:127` — UI 层直接 mutate 全局 `gameState`
- 证据：`combat-render.js:123` `const combat = gameState.combat;`（取的是全局引用），第 127 行 `if (combat.wave < 1 || combat.wave > maxWave) combat.wave = 1;`。
- 违反：UI 不得直接修改状态，状态变更须走 `dispatchGameAction`。
- 影响：绕过 action/校验/事件管道，修改不一定被记入 `_dirty`，存档可能不持久化，也无法被审计/回放。
- 建议：把 wave 钳制收进 `actions.js` 的 `CombatStateActions.start`（做 `wave = Math.min(Math.max(1,wave),maxWave)`），UI 只读 View State。

## 🟠 确证 · 事件契约一致性

### B1. `js/core/tick.js` — 6 处生产完成事件未显式传 `cycles`
- 证据：`tick.js:41/62/79/99/120/140` 的 `mining:completed`/`refining:completed`/`gas:completed`/`equipment:completed`/`shipcomponent:completed`/`ship:completed` payload **均不含 `cycles`**；仅靠 `events.js:35` 的 `normalize` 隐式补 `cycles:1` 才通过校验。
- 对比：`offline.js` 的离线路径 **全部显式传 `cycles`**（行 77/99/114/128/144/160/318）。
- 风险：实时与离线两条路径对契约用法不一致，属隐藏耦合；一旦 `normalize` 行为变更，实时统计会**静默少计**。
- 建议（低风险）：让 `tick.js` 6 处 emit 显式补 `cycles:1`，与 `offline.js` 对齐，移除对 `normalize` 隐式行为的依赖。

## 🟡 可疑需确认 · 代码健壮性

### C1. `js/core/queue.js` — `resetActionProgress()` 多处无参调用
- 位置：行 65、82、85、95 均为 `resetActionProgress();`，其内部用 `gameState.currentAction.skill` 取值。
- 风险：正常流程 `currentAction` 必存在，当前不崩；但迁移异常/提前 return 等态触发时会 `TypeError`。
- 建议：函数顶部加 `if (!gameState.currentAction) return;`，或所有调用处显式传参（与 `stopQueue()` 已显式取值的做法一致）。

## ⚪ 轻微 · 性能

### C2. `js/ui/combat-render.js` — 战斗特效高频 `setTimeout`
- `playAttackFX`/`playEnemyAttackFX` 用 `setTimeout` 追加并移除 DOM 特效节点；回调会移除节点，属自动清理、非真泄漏。
- 可选优化：改用 CSS animation + `animationend` 或对象池复用节点，避免每帧创建/销毁 DOM。

## ✅ 已核查干净（未发现问题）

1. `selectors.js` / `actions.js` 无直接 DOM 访问、无全局 `gameState` 读写、无就地改 state（actions 仅经 `ResourceRegistry` 合法改状态）。
2. 事件契约生产者字段均通过校验；`combat:enemyDefeated` 额外字段不违反契约（validate 仅校验 required）。
3. 资源闭环完整：所有配方材料与战斗掉落均在 `ResourceRegistry`/`ITEM_CATEGORIES`/`COMBAT_SPECIAL_MATERIALS` 注册，未找到断裂的资源链或未注册 ID。

## 修复优先级

| 优先级 | 项 | 类型 | 工作量 |
|---|---|---|---|
| P0 | A1 / A2 / A3 | 架构解耦（core/systems ↔ UI） | 中（需事件化改造） |
| P1 | B1 | 契约一致性（补 cycles:1） | 小（低风险） |
| P2 | C1 | 空值守卫 | 极小 |
| P3 | C2 | 特效节点池化 | 可选 |

> 全部为只读审查结论，未修改任何文件。
