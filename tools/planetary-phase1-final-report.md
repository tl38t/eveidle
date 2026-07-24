# 行星开发 Phase 1（开发规则）实装 — 最终报告

> 2026-07-24 收口（同日完成**旧档迁移与到期结算缺陷修复返修**）。本次**仅实装行星开发规则**，不实装增强剂 / 行星基地升级 / 任何升级系统；不触碰 `js/render3d/**`；未 commit / 未 push / 未创建 nul 文件。
>
> **返修范围（三缺陷）**：① 旧 `planetaryDeployments` 容器内容曾被清空丢弃 → 现完整迁移；② `normalizePlanetaryState` 曾在离线结算前把超期基地提前置 `active=false` 导致离线收益丢失 → 现拆分两阶段（字段迁移 / 到期最终化）；③ 在线 `planetaryTick` 曾在到期时直接 continue 丢弃 lastTick→expiresAt 最后一段 → 现先结算再关停。附带修复共用纯函数 `computePlanetarySettlement` 的 durationMs 双重乘 1000 缺陷（到期夹紧曾完全失效）。

## 1. 实际改动 / 新增文件

| 文件 | 改动 |
|---|---|
| `js/data/planets.js` | `PLANET_TYPES` 六行星正式费用结构（`constructionCost.isk` + `constructionCost.resources["mineral:三钛合金"]` + `maintenanceCostISK` + `maintenanceDuration:86400`）；移除 `costISK`/`costTrit`；`type`→`id` 全量重命名 |
| `js/core/actions.js` | `PlanetaryStateActions` 重写 `deploy`/`collect`/`renew`/`demolish` 四 Action；dispatch 路由 `planetary/deploy`→deploy、`planetary/collect`→collect、`planetary/renew`→renew、`planetary/demolish`→demolish（旧 `redeploy`/`remove` 已移除） |
| `js/core/events.js` | 新增 5 契约：`planetary:deployed` / `planetary:renewed` / `planetary:expired` / `planetary:collected` / `planetary:demolished` |
| `js/systems/planetary.js` | `getPlanetTypeCfg`/`getPlanetOutputInterval` 寻址改 `planet.id`；**返修**：新增在线/离线共用纯函数 `computePlanetarySettlement`（夹紧到 `[deployedAt, expiresAt]`、满仓丢弃残留进度、lastTick 不回退）；`planetaryTick` 重写为「先结算 lastTick→min(now, expiresAt) 最后一段，再判到期关停 + 单次 expired」 |
| `js/core/offline.js` | `settleOfflinePlanets` **返修**：改用 `computePlanetarySettlement`（fromTime=离线起点，受 MAX_OFFLINE_SECONDS 约束），到期精确停产、单次 `planetary:expired`、active=false 后二次结算跳过 |
| `js/core/selectors.js` | `getPlanetOutputIntervalFromState` 寻址改 `planet.id`；`getPlanetDeploymentDisplayState` 三状态字段；`getPlanetaryDisplayState.deployOptions` 读新 economy |
| `js/core/persistence.js` | **返修**：`normalizePlanetaryState(state, opts)` 两阶段化（`finalizeExpiry:false` 仅字段迁移不提前关停 / `finalizeExpiry:true` 到期最终化安全网）；旧容器 `planetaryDeployments` 内容**完整迁移**（按 id 去重合并、同 id 优先新版、稳定分配缺失 id、storage/progress/active 保留、删除 `type`、不复制 `capacity`）；`autoLoad` 与 `importData` 均改为「迁移 → calculateOfflineGains → 最终化」顺序 |
| `js/ui/planetary-render.js` | 卡片三状态；`renewPlanet`/`demolishPlanet` 处理器；部署弹窗新文案；`data-expired` 比对强制状态切换重绘 |
| `index.html` | `#deploy-modal` 注释更新 |
| `tools/verify.mjs` | 修正旧 `type:"lava"`/`removePlanet` 引用；行星 action 测试块全量重写；新增数据驱动哨兵 |
| `tools/audit-planetary.mjs` | **新建**：vm 沙箱 + 手动 offline/actions + 精确切片真实 `normalizePlanetaryState` 执行；**返修**：删除「遗留容器只建不复制」错误断言，新增 ZA~ZH 八区真实迁移/结算集成测试（`autoLoadOrder`/`importDataOrder` 集成入口真实驱动 `calculateOfflineGains`，vm 上下文内 mock `Date.now`） |

（文档：`eveidle.md` / `DEVLOG.md` / `PLANETARY_SYSTEM_IMPLEMENTATION_PLAN.md` / `BOOSTER_SYSTEM_IMPLEMENTATION_PLAN.md` 同步更新，见 §12。）

## 2. 六行星费用表（已落库）

| 行星 | 解锁Lv | interval(s) | 建设 ISK | 建设三钛 | 维护 ISK/24h | 维护三钛 |
|------|--------|-------------|----------|----------|-------------|----------|
| 熔岩 | 1 | 10 | 138,000 | 100 | 46,000 | 0 |
| 气态 | 1 | 10 | 138,000 | 100 | 46,000 | 0 |
| 冰 | 20 | 15 | 249,000 | 150 | 83,000 | 0 |
| 等离子 | 40 | 18 | 714,000 | 300 | 238,000 | 0 |
| 温带 | 60 | 22 | 1,914,000 | 500 | 638,000 | 0 |
| 风暴 | 80 | 30 | 4,899,000 | 1,000 | 1,633,000 | 0 |

校验：建设 ISK = 3 × 维护 ISK（§9.12 定案）。维护周期统一 `maintenanceDuration:86400`（24h）。

## 3. 三 Action 语义

- **deploy（首次 / 拆除后重建）**：同时扣 `constructionCost.isk`+`constructionCost.resources["mineral:三钛合金"]`；建 `planetType:config.id` 部署，置 `active=true`、`duration=86400`；emit `planetary:deployed`。同槽重建走 deploy（非 renew）。
- **collect（收取）**：寻址 `planet.id === deployment.planetType`；库存累加主仓库；storage≠0 时不可 demolish。
- **renew（续期，仅到期可）**：前置 `active=false`/超期；运行中调用返回 `already-active` 且**不扣费**；仅扣 `maintenanceCostISK`，保留库存，emit `planetary:renewed`；**不读 constructionCost、不耗三钛**。
- **demolish（拆除，仅空仓可）**：前置 `storage===0`，否则 `storage-not-empty` 原子拒绝；删除部署、不返还任何 ISK/材料，emit `planetary:demolished`（`refundedISK:0`/`refundedResources:{}`）。

## 4. 旧档迁移（normalizePlanetaryState，返修后）

**两阶段签名**：`normalizePlanetaryState(state, { now, finalizeExpiry })`。`finalizeExpiry:false`（默认）仅做字段迁移，**绝不因时间超期提前关闭 active=true 的基地**；`finalizeExpiry:true` 在离线结算之后调用，仅对 `active && 超期` 置 false（安全网）。

**4.1 旧容器迁移前后精确示例（audit 区 ZA 实测）**

迁移前（仅旧容器）：
```json
"planetaryDeployments": [
  { "id":"old1", "type":"lava", "timeDeployed": now-50000, "duration":86400, "storage":3, "progress":2, "active":true },
  { "id":"old2", "type":"ice",  "timeDeployed": now-60000, "duration":86400, "storage":7, "progress":1, "active":false }
]
```
迁移后（`planetary.deployments`，实测断言值）：
- `old1` → `{ id:"old1", planetType:"lava", deployedAt:now-50000, duration:86400, storage:3, progress:2, active:true }`（storage/progress/active 原样保留，`type` 字段已删除）
- `old2` → `{ id:"old2", planetType:"ice", deployedAt:now-60000, duration:86400, storage:7, progress:1, active:false }`（显式 false 保留）
- ISK=10,000,000、三钛=5,000 **迁移前后完全不变**（不追收）；`capacity` 不进入新结构。

**4.2 新旧容器合并去重结果（audit 区 ZB 实测）**

- 新版已有 `planet_1`(storage=2) + 旧容器含同 id `planet_1`(storage=9) 与新版缺失的 `oldX`(ice, storage=4)。
- 合并后共 **2 个部署**：`planet_1` 保留**新版** storage=2（不被旧值 9 覆盖）；`oldX` 追加迁移（storage=4 保留）；`nextId` 保持 5（单调不回退）。
- 幂等（区 ZC）：两次独立迁移 JSON 深比较一致；同一状态二次规范化深比较一致。区 Y：重复调用无副作用。
- 缺失 id 分配稳定 `planet_legacy_${idx}`；`nextId = max(原nextId, maxId+1, 1)`；只有迁移完成后调用方才删除旧容器。

## 5. 在线 / 离线到期结算（返修后，audit 实测数字）

统一口径：熔岩 interval（技能 Lv1）= 10/1.02 = **9.8039s**；仓上限（Lv1）= 105。

**5.1 离线跨到期点精确产出（区 ZD）**：旧档 `active=true`、deployedAt=离线起点、duration=600s、离线 3600s（跨过到期点 3000s）。结果：storage = **⌊600/9.8039⌋ = 61 周期**（恰为 [lastSave, expiresAt] 全段）；到期后 3000s **产出 0**；最终 `active=false`；再次离线结算 100s **收益 0**（active=false 跳过）；ISK/三钛不变。区 U：duration=60s 离线 100s → 恰 **6 周期**封顶。

**5.2 在线最后周期精确产出（区 ZG）**：duration=100s，tick 晚于到期点 5s 到来。结果：storage = **⌊100/9.8039⌋ = 10 周期**（含最后一段，旧实现会丢弃 lastTick→expiresAt 全部）；`lastTick` 夹紧到 expiresAt 不越界；最终 `active=false`。区 V：同一 50s 区间在线分 10 次 tick 与离线一次结算均 = **5 周期**，完全一致。

**5.3 expired 事件触发次数**：在线（区 S）到期后连续 3 次 tick 只触发 **1 次**；在线晚到 tick（区 ZG）**1 次**；离线（区 W/ZH）连续两次 `settleOfflinePlanets` 只触发 **1 次**、不重复产出；`importData` 与 `autoLoad` 两路径结算结果深比较一致（区 ZF）。

- 不自动续期：无论在线/离线，到期均不触发 renew/demolish（§9.3）。

## 6. UI 三状态

- 卡片三态：运行中（running）/ 已到期（expired），由 `getPlanetDeploymentDisplayState` 的 `state`/`expired`/`showRenew`/`canRenew`/`canDemolish` 驱动。
- 续期按钮仅 `showRenew && canRenew` 时显示（运行中禁用）；拆除按钮 `canDemolish` 控制（storage≠0 禁用）。
- `data-expired` 属性比对触发整卡重绘，解决运行中↔到期按钮集合变化（续期按钮显隐）问题。

## 7. audit 断言数与分区（返修后）

`tools/audit-planetary.mjs`：**34 区（A–ZH）/ 200 条断言 / EXIT 0**（返修新增 24 条）。
A=61 B=6 C=6 D=6 E=6 F=12 G=6 H=7 I=2 J=2 K=7 L=3 M=2 N=6 O=2 P=3 Q=12 R=1 S=3 T=3 U=2 V=3 W=4 X=6 Y=1 Z=3 · **ZA=5**（旧容器完整迁移）**ZB=4**（新旧去重合并）**ZC=2**（重复迁移深比较幂等）**ZD=4**（离线跨到期精确产出）**ZE=2**（autoLoad 顺序不提前关闭）**ZF=1**（importData 与 autoLoad 一致）**ZG=3**（在线晚到 tick 仍结算最后段）**ZH=4**（防重复结算与事件）。
原区 Z 中「遗留 planetaryDeployments 只建容器不复制内容」的**错误断言已删除**；X 区断言改为「迁移阶段（finalizeExpiry:false）不得提前关闭 active=true 的就绪基地」。ZA~ZH 通过 `autoLoadOrder`/`importDataOrder` 集成入口按**生产完全一致的调用顺序**（迁移 → 真实 `calculateOfflineGains` → 最终化 → 删旧容器）执行，未截取函数改语义。

## 8. verify 新增哨兵

`tools/verify.mjs` 新增数据驱动哨兵：六费用精确值、maintenanceDuration=86400、无 costISK/costTrit/升级字段、旧动作名 redeploy/remove 已移除、新路由存在、无升级系统/按钮、renew 路径不读 constructionCost 读 maintenanceCostISK、demolish 路径无 `ResourceRegistry.add` 且零返还、audit-planetary.mjs 存在且调用真实 Action/tick/offline/normalize。另修正 verify 内 duplicate `const actionsSource` 与旧 `removePlanet` 集成块引用、CRLF 容错正则。

## 9. 13 条正式回归 EXIT CODE（返修后真实运行，全部 0）

| # | 脚本 | EXIT |
|---|------|------|
| 1 | `tools/verify.mjs` | 0 |
| 2 | `tools/audit-planetary.mjs` | 0 |
| 3 | `tools/audit-industrial-productivity.mjs` | 0 |
| 4 | `tools/audit-equipment-enhancement.mjs` | 0 |
| 5 | `tools/audit-ship-enhancement.mjs` | 0 |
| 6 | `tools/audit-rigs.mjs` | 0 |
| 7 | `tools/audit-archaeology-system.mjs` | 0 |
| 8 | `tools/audit-archaeology-ships.mjs` | 0 |
| 9 | `tools/simulate-archaeology-user-flow.mjs` | 0 |
| 10 | `tools/calculate-ship-production-times.mjs --verify` | 0 |
| 11 | `tools/calculate-ship-production-times.mjs --audit-mixed-battleship` | 0 |
| 12 | `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-mixed-battleship` | 0（首跑偶发段错误 139，复跑 0，属已知环境问题） |
| 13 | `node --max-old-space-size=4096 tools/simulate-destroyer-belts.mjs --assert-nullsec` | 0 |

> 第 12/13 条已按指令改用 `--assert-mixed-battleship` / `--assert-nullsec` 正式断言参数，**未使用** `--enemy-hp 1 --enemy-damage 1`。

## 10. git diff --check

`git diff --check` → **EXIT 0**。仅出现 LF→CRLF 归一化警告（git autocrlf），**无任何空白/行尾错误**。

## 11. git status --short（真实完整输出）

```
 M DEVLOG.md
 M eveidle.md
 M index.html
 M js/core/actions.js
 M js/core/events.js
 M js/core/offline.js
 M js/core/persistence.js
 M js/core/selectors.js
 M js/data/planets.js
 M js/systems/planetary.js
 M js/ui/planetary-render.js
 M tools/verify.mjs
?? BOOSTER_SYSTEM_IMPLEMENTATION_PLAN.md
?? PLANETARY_SYSTEM_IMPLEMENTATION_PLAN.md
?? tools/audit-planetary.mjs
?? tools/planetary-phase1-final-report.md
```
12 个已修改（M）+ **4 个未跟踪（??）**：两方案文档 + 新建审计脚本 + 本最终报告。无 `js/render3d/**` 改动，无 nul 文件（返修中产生的临时调试脚本 `tools/_debug-u.mjs` 已删除，不在状态中）。
`js/` 内 Grep 残留确认：无 `planetary/redeploy`/`planetary/remove`/`deployment.type`/`planet.type`/`redeployPlanet`/`removePlanet`；`costISK` 命中均为 ship 蓝图字段或 planets.js 注释，与行星无关。

## 12. 边界确认（最终）

- ❌ 未实装增强剂系统（乙类 Buff 药水）—— 仅文档 §10 反推，不实装；未进入 Phase 2。
- ❌ 未修改行星费用 / 产量公式 / interval / 技能公式（返修仅修迁移与结算时序，费用与公式原样）。
- ❌ 未设计 / 未实装行星基地升级、建筑等级、升级消耗链路。
- ❌ 未修改 `js/render3d/**`（其未提交改动为前序 ShipFactory2 遗留）。
- ❌ 未 commit、未 push、未创建 nul 文件（按用户要求）。
