# EVE IDLE 前端架构约束

本项目继续使用无构建步骤的原生 JavaScript，但业务状态、计算和展示必须保持可替换边界。目标不是立即改用 React/Vue，而是让未来框架、移动端渲染器和自动测试可以复用同一套游戏核心。

## 分层与依赖方向

```text
data（静态配置）
  ↓
state（存档形状）
  ↓
selectors（纯读取 / View State） ← systems（规则与结算）
  ↓                              ↑
ui/render（DOM展示）      actions（显式状态修改）
```

允许的依赖方向：

- `data` 不依赖其他层。
- `state` 只定义状态结构与通用实例工具。
- `selectors` 接收 `state`，读取静态配置，返回可序列化的普通对象。
- `actions` 接收 `state + action + now`，只修改传入状态并返回结果。
- `systems` 负责游戏规则、tick、离线结算与存档迁移，可复用选择器中的纯计算。
- `ui` 消费 View State、绑定事件并更新DOM；UI通过动作入口请求状态变化。

禁止反向依赖：选择器和动作层不得访问DOM、调用渲染函数或读取全局 `gameState`。

## View State规则

选择器统一放在 `js/core/selectors.js`。

```js
const display = getMiningDisplayState(state, now);
```

每个选择器必须满足：

1. 显式传入状态和时间，不隐藏读取 `gameState` 或 `Date.now()`。
2. 不修改输入状态，包括不调用会补字段、归一化装备或迁移存档的函数。
3. 不访问DOM、Canvas、localStorage或浏览器API。
4. 返回普通对象、数组、数字、字符串和布尔值。
5. 同一输入必须产生同一输出。

目前已提供：

- `getGlobalDisplayState()`
- `getSidebarDisplayState()`
- `getSkillShellDisplayState()`
- `getCurrentActivityDisplayState()`
- `getProductionEfficiencyState()`
- `getMiningDisplayState()`
- `getSmeltingDisplayState()`
- `getGasDisplayState()`
- `getActiveActionProgressDisplayState()`
- `getShipEngineeringDisplayState()`
- `getEquipmentEngineeringDisplayState()`
- `getActionConfirmationDisplayState()`
- `getCombatDisplayState()`
- `getPlanetaryDisplayState()`
- `getCargoDisplayState()`
- `getLPStoreDisplayState()`
- `getHangarDisplayState()`
- `getShipFittingDisplayState()`
- `getQueueDisplayState()`
- `getNavigationDisplayState()`

## 状态动作规则

状态动作统一放在 `js/core/actions.js`，通过一个入口调用：

```js
dispatchGameAction(state, {
  type: "production/selectMiningArea",
  areaName: "镓月岩带"
}, now);
```

动作层可以修改显式传入的状态，但不能：

- 操作DOM；
- 显示Toast或弹窗；
- 调用 `updateUI()` / `render*()`；
- 保存localStorage；
- 静默使用全局 `gameState`。

动作返回 `{ changed, reason, ... }`，兼容层或未来框架根据结果决定刷新与反馈。

## 横向核心设施

### ResourceRegistry

`js/core/resources.js` 使用 `namespace:itemKey` 作为业务层唯一资源地址，例如 `ore:凡晶石`、`component:integrated_hull`、`ammo:laser`。业务规则、选择器和UI不得自行遍历 `resources.*` 资源池。

- Registry负责资源定义、读取、增加、设置、跨命名空间材料汇总和原子扣费。
- 现阶段Registry仍映射到旧存档的多个资源池，不创建 `resources.items`，因此旧存档无需整体迁移。
- `js/core/persistence.js` 是唯一允许直接整理旧资源字段的迁移边界；新增直接资源池读取必须被视为架构回归。
- 新资源应先注册命名空间、键、名称和分类，再由配方或系统引用其资源ID。

### GameEvents

`js/core/events.js` 是同步领域事件总线。生产、制造和战斗核心只负责发布已经发生的事实，任务、成就和统计等消费者只能订阅事件，不能被核心系统直接调用。

- 所有事件使用统一不可变信封：`{ schemaVersion, eventId, type, timestamp, payload, meta, valid, registered }`。
- `meta` 固定提供 `offline`、`aggregate`、`source` 和 `runId`；在线事件和离线聚合事件使用相同事件名。
- 采矿、冶炼、采气、行星、制造、击杀、波次、肃清、爆船、升级以及内部UI通知均已登记事件契约。
- 离线多周期结算发布一个包含总周期数和总产出的聚合事件，并以离线结算批次生成稳定 `runId/eventId`。
- 已登记事件缺少必需字段或字段类型错误时不向监听器分发，并由RuntimeGuard记录契约错误。
- 新的项目内事件发布点必须先登记契约；`tools/verify.mjs` 会扫描静态事件名并阻止无契约事件进入代码库。

`js/core/statistics.js` 是首个只读事件消费者：记录生产、制造、战斗、升级和在线/离线累计，不参与任何奖励或数值结算。

- 消费者通过 `GameEvents.onIdempotent()` 订阅，每个消费者按 `consumerId:eventId` 去重。
- 当前存档保留最近512个已处理事件ID，限制存档体积；重复事件不会再次累计。
- 旧存档缺少统计字段时由 `ensureStatisticsState()` 补齐，不重放历史数据，也不反推此前累计值。
- 调试时可调用 `GameStatistics.snapshot()` 获取统计副本；不得直接把统计结果作为生产或战斗状态来源。
- 事件payload属于跨模块契约；修改字段前必须同步更新契约测试和所有消费者。

### CombatModifiers

`js/core/combat-modifiers.js` 是战斗数值修正管线。技能、舰船、装备、区域以及未来Buff/Debuff都以修正项参与最终计算，战斗系统不应为单个玩法复制一套公式。

- 支持 `add`、`multiply`、`override`、`min`、`max` 和显式优先级。
- 修正可以按武器、生命层、区域及过期时间过滤。
- 修正管线不代表动态难度；敌人固定基础强度仍由静态配置决定。

### RuntimeGuard与错误边界

`js/core/runtime.js` 隔离关键循环和可恢复渲染通道，`js/ui/error-boundary.js` 将启动与运行时错误转为玩家可见面板。

- 关键结算失败后暂停对应通道，防止存档继续发生半结算。
- 可恢复渲染错误会被记录，但不永久停止后续帧。
- 恢复关键通道必须由用户显式触发；后续恢复增强还需加入状态校验和错误报告导出。

## 原生DOM适配层

`js/ui/render.js` 是当前原生DOM适配器。它可以访问DOM，但应遵循：

- 不重新实现业务公式；
- 不直接修改游戏状态；
- 不根据原始状态拼装复杂页面逻辑，优先消费完整View State；
- 高频刷新与完整刷新必须使用同一选择器，避免两个公式版本；
- 事件处理器只调用动作入口或系统命令。

React/Vue版本未来只需用组件替换这一层，不应重写采集效率、目标锁定、进度或门槛计算。

## 当前迁移状态

| 模块 | View State | Actions | DOM适配分离 |
|---|---|---|---|
| 全局资源栏/侧栏 | 已完成 | 不适用 | 已完成 |
| 采矿/月矿 | 已完成 | 已完成 | 已完成 |
| 冶炼 | 已完成 | 已完成 | 已完成 |
| 气体采集 | 已完成 | 已完成 | 已完成 |
| 舰船/装备制造 | 已完成 | 已完成 | 已完成 |
| 执行确认弹窗 | 已完成 | 复用队列动作 | 已完成 |
| 战斗 | 已完成 | 已完成 | 已完成 |
| 行星 | 已完成 | 已完成 | 已完成 |
| 仓库/LP商店 | 已完成 | 已完成 | 已完成 |
| 船坞/舰船装配 | 已完成 | 已完成 | 已完成 |
| 动作队列/页面导航 | 已完成 | 已完成 | 已完成 |

## 后续迁移顺序

四批基础迁移已经完成。后续新增功能必须直接按本文件边界实现；对旧代码只做按需清理，不再建立新的跨层兼容逻辑。

每次迁移都必须保持存档结构不变，并通过 `node tools/verify.mjs` 与真实浏览器回归。

## 自动约束

`tools/verify.mjs` 会检查：

- `selectors.js` 不含DOM、全局 `gameState`、渲染调用；
- `actions.js` 不含DOM、全局 `gameState`、渲染调用；
- 选择器调用前后输入状态JSON完全一致；
- 运行目标与待选目标可以同时正确表达；
- 锁定动作失败时不能修改状态；
- 统一动作入口拒绝未知动作。
- 战斗核心不得重新引入HUD DOM、面板渲染或攻击特效。
- 行星核心和静态配置不得访问DOM、Canvas、弹窗或渲染函数。
- 生产、战斗、行星和队列核心不得访问DOM、Toast或页面渲染函数。
- 仓库、船坞、装配、LP商店、队列和导航View State必须保持输入状态不变。
- 执行确认弹窗不得直接读取资源池或在提交时重新计算当前下拉配方。
- 除存档迁移边界外，业务代码不得新增 `resources.*` 原始资源池读写。
- ResourceRegistry扣费必须保持原子性；GameEvents、CombatModifiers和RuntimeGuard必须保持DOM为0。
- 所有项目内静态事件发布点必须拥有已登记契约；无效事件不得送达消费者。
- 统计消费者必须幂等，同一个 `eventId` 重放时累计值只能变化一次。
- 在线、离线聚合、行星产出与旧存档统计结构必须纳入自动回归。

这些检查用于防止后续功能开发重新破坏分层边界。

## 分批迁移计划

- 第1批（已完成）：舰船工程与装备工程。
- 第2批（已完成）：战斗属性、编队/HUD View State与战斗指令。
- 第3批（已完成）：行星卡片、生产倒计时与Canvas适配。
- 第4批（已完成）：仓库、LP商店、船坞、舰船装配、队列、页面导航与遗留兼容层清理。
