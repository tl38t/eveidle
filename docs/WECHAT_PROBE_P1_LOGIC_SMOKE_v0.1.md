# P1 探针 · 逻辑层「无 DOM」冒烟报告 v0.1

> 日期：2026-09-13
> 阶段：S-1 探针阶段 · 任务 P1
> 回答的问题：**U1 — 逻辑层（5.2 万行）能否在无 DOM 环境下加载并运行？**
> 结论：**能。零改动 + 一个约 40 行的最小 DOM shim。**

---

## 一、结论摘要

| 问题 | 结论 |
|---|---|
| 逻辑层能否在**没有 `document`** 的环境加载？ | ✅ **106 / 106 全部成功**（提供最小 shim 后） |
| 逻辑层能否在**没有 `document`** 的环境运行？ | ✅ **200 tick 零错误**，且真实产出矿石、完成 71 个采集周期 |
| 离线结算管线能否跑通？ | ✅ 8 小时回拨结算无异常（`elapsed=28800s`） |
| 逻辑层需要改多少行？ | **0 行**。只需提供一个 shim 模块 |
| 原预估的「149 处 document 需逐个改造」 | ❌ **不成立** —— 149 处中 147 处只在函数体内，加载期只触发 2 处 |

**U1 风险等级：未知 → 已锁死（低）。**

---

## 二、方法

从 `index.html` 抽取**真实加载清单**（唯一权威来源，避免目录盲扫混入 demo/测试页），分类为 4 组：

| 组 | 数量 | 本阶段处理 |
|---|---|---|
| **逻辑层**（`js/core`、`js/data`、`js/systems`、`js/platform`、`js/i18n`） | **106** | ✅ 本次冒烟对象 |
| UI 层（`js/ui/*`，非 3D） | 20 | ⛔ P3 处理 |
| 3D（`js/ui/ship3d.js`、`titan-forge-3d.js`、`leaderboard-render.js`，均为 ESM） | 3 | ⛔ P2 处理 |
| 启动/诊断（`bootstrap-launch.js`、`diagnostics.js`、`qa-seed.js`） | 3 | ⏸ 属「启动编排 + UI」，微信端重写 |

在 Node `vm` 沙箱中按 `index.html` 顺序串行执行逻辑层，沙箱**刻意不提供** `document` / `location` / `navigator` 的 DOM 部分，只提供小游戏里确实存在的东西（`wx` mock、内存版 `localStorage`、no-op 计时器）。

UI 函数（`updateUI` / `updateLiveUI` / `refreshVisiblePanelAfterAction`）替换为计数器 stub —— 它们在微信端本来就要用 Canvas 重写，不属于本次验证范围。

**确定性**：假时钟（固定起点 + 每步 5s）+ 确定性 PRNG（splitmix32 finalizer，与项目战斗 RNG 同族）⇒ 结果可复现。

---

## 三、数据

### 3.1 加载

| 模式 | 结果 | 失败文件 |
|---|---|---|
| **真·无 DOM**（不给 `document`/`location`） | **104 / 106** | `js/i18n/translator.js`、`js/core/persistence.js` |
| **+ 最小 DOM shim** | ✅ **106 / 106** | — |

### 3.2 运行

| 场景 | 结果 |
|---|---|
| 空跑 200 tick（`currentAction.active=false`） | ✅ 0 错误；`updateLiveUI` 调用 200 次 |
| 注入挖矿行动，200 tick | ✅ 0 错误；矿石 0→1，`refreshVisiblePanelAfterAction` 调用 **71** 次 |
| 离线结算（`lastActiveTime` 回拨 8h） | ✅ 无异常，日志 `[离线] calculateOfflineGains 触发，elapsed=28800s` |

### 3.3 副产品

- `gameState` 空档 JSON 序列化 = **31,860 字节**（≈ 31 KB）
  → 微信单 key 上限 1 MB 的**下界**参考。真实进度存档远大于此，**R2 仍需用真实存档实测**。

---

## 四、精确改造清单（只有 2 处）

| # | 文件:位置 | 代码 | 根因 | 建议修法 |
|---|---|---|---|---|
| 1 | `js/i18n/translator.js:23` | `new URLSearchParams(window.location.search).get("lang")` | 小游戏**无 `location`** | 改读 `wx.getLaunchOptionsSync().query.lang`；或由 shim 提供 `location.search` |
| 2 | `js/core/persistence.js`（顶层 IIFE，含 `document.getElementById("btn-save-game")` 与 `document.addEventListener("visibilitychange")`） | 顶层 DOM 绑定 | 小游戏**无 `document`** | **最小 shim 即可**（`getElementById → null`，`addEventListener → no-op`） |

> ⚠️ 两处都**不需要改业务代码**：第 1 处由 shim 提供 `location.search = ""` 即可；第 2 处 shim 返回 `null` 后，代码里既有的 `if (footer)` / `if (btnSave)` 判空逻辑自然生效。

---

## 五、对后续阶段的影响

| 项 | 变化 |
|---|---|
| **U1 风险** | 未知 → **锁死（低）** |
| 逻辑层改造工作量 | 预估「可能需重构」→ **0 行改动 + 1 个 shim 模块（~40 行）** |
| **R18（UI 层 1.8 万行 DOM）** | ⛔ **未受影响 —— 仍是最大未知数**，由 P3 回答 |
| P2（Three.js r180 适配） | 不受影响 —— 但 **shim 思路可复用**：DOM 垫片 + Canvas 垫片可同源设计 |
| 已有架构判断 | 「逻辑层单一真源」前提**成立**；三平台同修的硬约束**天然满足** |

**一个重要的架构推论**：本探针验证的 shim 模式（提供最小 DOM 外观、让既有判空逻辑自然降级）**同样适用于 Three.js 所需的环境垫片**。两者应设计为**同一个 `js/platform/wechat/` 适配层的两个模块**，而不是各写一套。

---

## 六、复现方式

```bash
# 静态加载冒烟（宽松：提供 window，不提供 document）
node D:/EVE-IDLE/wx-p1-logic-smoke.mjs

# 静态加载冒烟（严格：window/document 都不提供）
node D:/EVE-IDLE/wx-p1-logic-smoke.mjs --no-window

# 运行时冒烟：真·无 DOM 跑 200 tick
node D:/EVE-IDLE/wx-p1-tick-smoke.mjs

# 运行时冒烟：+ 最小 DOM shim + 挖矿行动 + 离线结算
node D:/EVE-IDLE/wx-p1-tick-smoke.mjs --dom-shim --mining --offline

# 自定义规模
WX_TICKS=1000 WX_STEP_MS=1000 node D:/EVE-IDLE/wx-p1-tick-smoke.mjs --dom-shim --mining
```

两个脚本均位于**仓库外**（`D:\EVE-IDLE\`），不污染 git。

---

## 七、未覆盖（留给后续探针）

| 项 | 由谁回答 |
|---|---|
| UI 层 1.8 万行 HTML/CSS → Canvas 的真实成本 | **P3** |
| Three.js **r180** 在小游戏能否渲染 | **P2** |
| 真实存档体积（R2，1 MB 单 key 上限） | 需真实存档数据 |
| 真机差异（Node vm ≠ 小游戏 V8 + 基础库） | 需微信开发者工具 / 真机 |
| `wx.request` 域名白名单（联盟功能） | S2 |

---

## 八、遗留观察（非阻塞）

- ✅ **`window.tap` 已核实（25 处，全部命中 `window.tap`，无 `window.taptap`）**：这是 **TapTap 广告 SDK 的「只读探测」**，集中在 `js/core/ad-service.js`、`js/platform/ad-platform-config.js`、`js/core/leaderboard-sync-service.js`、`js/core/diagnostics.js` 四处，**已收敛在 `js/platform/` 抽象层内**（`ad-platform-config.js` 明确注释「不调用真实 SDK，仅只读探测」）。⇒ 微信端走 `js/platform/wechat/` 分叉即可，**无需归拢散落业务代码**。无阻塞。
- `js/core/persistence.js` 有 **42 处 `document`**、`bootstrap-launch.js` 有 **73 处**、`diagnostics.js` 有 **30 处**。本阶段只验证了**加载期**，这些的**运行期**调用路径（保存成功回显、导入导出弹层、诊断面板）在微信端需走 Canvas 重写或 shim 降级 —— 属 P3 范围。
- ⚠️ **行号漂移提醒**：§四清单里 `js/i18n/translator.js:23` 是基于**当时工作树快照**（该文件并行有 Steam 语言收敛改动未提交，行号会漂）。**定位判据用代码内容 `new URLSearchParams(window.location.search)`，不要用行号。**
