# 深空放置：边疆纪元 — 第一阶段交付报告（云端存档 + 成就同步架构）

> 状态：**第一阶段实现完成；Phase-1 机器专项全部 EXIT=0；`verify.mjs` / `audit-achievements.mjs` 两项「既有基线」EXIT=1 显式保留（非 Phase-1 回归）。处于 HOLD（未提交 / 未构建 release / 未推送 / 未真机测试）。**
> 适用仓库：`EVEIDLE-WORKBUDDY-FRESH`
> 生成日期：2026-08-15

---

## 0. 一句话结论

平台无关（platform-agnostic）的云端存档 + 成就同步架构已落地：外层信封做版本分叉与校验和校验（fail-closed），本地 `eve_idle_save` 原始保留，Noop 提供器绝不接管 localStorage，TapTap 适配器按官方 API 严格实现、Steam 仅合同预留；启动引导状态机（`idle→loading→local-only→awaiting-choice→ready/error`）用「双通道广播 + 阻塞门」保证冲突期间游戏逻辑全部暂停。第一阶段 8 项证据全部就绪，**Phase-1 新增/修改的 8 个机器专项测试与审计 EXIT=0**；另有 2 个既有基线（`verify.mjs` 的 View-State、`audit-achievements.mjs` 的成就重构过渡态）按 HOLD 纪律显式保留 EXIT=1，不盲修、不算作 Phase-1 回归。

---

## 1. 12 项已批准决策 — 落实追踪

| # | 决策 | 落实状态 | 关键落点 |
|---|------|----------|----------|
| 一 | 信封版本分叉 + `ENVELOPE_VERSION_TOO_NEW` / `CHECKSUM_MISMATCH` fail-closed | ✅ | `js/core/save-envelope.js` L22/L101–118 |
| 二 | 本地 `eve_idle_save` 原始保留（不解密/不重排/不注入平台字段） | ✅ | `cloud-save-service.js` 仅镜像，不改源键 |
| 三 | Noop 提供器绝不接管 localStorage | ✅ | `noop-cloud-provider.js` / `noop-achievement-provider.js` `isAvailable=false` |
| 四 | 共享迁移管线（`normalizeAndMigratePayload` / `activateRestoredState` / `SaveManager.bootstrap()` / `importData`） | ✅ | `persistence.js` 统一入口 |
| 五 | 静态 Save UI（不阻塞、不自动弹窗） | ✅ | `index.html` 静态 Save 面板（save-status / btn-*）+ 新增 10 个云存档管理 ID（见 §8） |
| 六 | 冲突盒子必须二选一（本地/云端），绝无「取消并继续」；`bootState="awaiting-choice"` | ✅ | `bootstrap-launch.js` `showConflictChoice()` / `persistence.js` 冲突落点 |
| 七 | 成就总数基线 | ✅ | **权威目录 = 193**：`achievements.js` ACHIEVEMENTS / ACHIEVEMENTS_BY_ID / `platform-achievement-map.js` / CSV 数据行四者一致（placeholder=182、provisional=11、final=0、G01–G06 firstRound=true、enabled 全 false、taptapId 全空）。旧 `audit-achievements.mjs` 报告的 197 为过期审计口径（详见 §6） |
| 八 | TapTap 子集 G01–G06 `enabled=false`（未拿后台 ID 前绝不上报） | ✅ | `platform-achievement-map.js` G01–G06 `taptap:null` |
| 九 | `tap.createAchievementManager({toastEnable:true})` | ✅ | `taptap-achievement-provider.js` |
| 十 | `bootstrap-launch.js` 同步 `SaveManager.bootstrap()` + 阻塞错误页 + `boot:state` 契约 | ✅ | `events.js` 新增 `"boot:state"` 契约 |
| 十一 | 严格 TapTap 官方 API；Steam 适配严禁进入任何 TapTap 包 | ✅ | `build-taptap-h5.mjs` 显式排除 `js/platform/steam/` |
| 十二 | Phase-1 追加 8 项证据 | ✅ | 见 §3 与 §4 |

---

## 2. 架构概览

```
index.html
  └─ <script defer> 顺序（决定·十）：
       persistence.js (v5)  →  bootstrap-launch.js (v1)  →  render.js (v6)
                                  │（DOMContentLoaded 触发 SaveManager.bootstrap()）
                                  ▼
                     SaveManager.bootstrap() 状态机
                       idle → loading → local-only → [awaiting-choice] → ready / error
                       ├─ _emitBootState(): GameEvents.emit("boot:state") + window CustomEvent("bootstatechange")
                       └─ isBootBlocked() = loading || awaiting-choice
                            → 暂停 tick / 离线结算 / 自动保存 / 成就上传（persistence.js 阻塞门）

核心服务（平台无关）：
  js/core/save-envelope.js        —— 信封版本 + 校验和（fail-closed）
  js/core/cloud-save-service.js   —— 云端存档编排（listCloudArchives / uploadNow / recordLocal / decideResolution）
  js/core/achievement-sync-service.js —— 成就对账（handleUnlock / reconcileAll，异步 ledger）
  js/core/events.js               —— GameEventContracts（含 boot:state）

平台层：
  js/platform/cloud-save-contract.js / achievement-provider-contract.js —— 提供器契约
  js/platform/platform-runtime.js  —— 运行时选择（签约才激活）
  js/platform/providers/noop-*.js —— 默认提供器（isAvailable=false）
  js/platform/taptap/*.js         —— TapTap 严格适配器（首生产）
  js/platform/steam/              —— 合同预留、未签约，构建期排除

数据：
  js/data/platform-achievement-map.js —— 193 成就 ↔ {taptap, steam} 映射（G01–G06 首轮候选，当前全 null）
```

---

## 3. 第一阶段 8 项证据

1. **信封 fail-closed（决定·一）** — `js/core/save-envelope.js`：`SAVE_ENVELOPE_VERSION=1`；`obj.envelopeVersion > 1` → 抛 `ENVELOPE_VERSION_TOO_NEW` 拒绝加载；校验和不符 → 抛 `CHECKSUM_MISMATCH`。版本号只表示外层信封格式，游戏内 `gameState` 版本独立于信封。
2. **本地存档原始保留（决定·二）** — `cloud-save-service.js` 仅把 `eve_idle_save` 作为「镜像源」上传/比对，绝不在读档路径上解密、重排或注入平台字段；本地键名与内容保持原生。
3. **Noop 不接管 localStorage（决定·三）** — `noop-cloud-provider.js` / `noop-achievement-provider.js` 的 `isAvailable()` 恒为 `false`；`audit-platform-boundaries.mjs` 断言 Noop 在 `isAvailable=false` 时绝不读写 `eve_idle_save`。
4. **共享迁移管线（决定·四）** — `normalizeAndMigratePayload`、`activateRestoredState`、`SaveManager.bootstrap()`、`importData` 四者共用同一套归一/迁移逻辑，避免「云端恢复」与「导入文件」走两套代码。
5. **静态 Save UI 不阻塞（决定·五）** — `index.html` 的 Save 面板（`save-status` / `btn-save-game` / `btn-export-save` / `btn-import-save` / `btn-delete-save` / `import-file-input` / `save-info`）为纯静态 DOM（均含于 319 基线）；本次 P1-3 又新增 10 个云存档管理静态 ID（见 §8），`verify.mjs` 基线已同步 319→329。
6. **冲突盒子无取消（决定·六 / ·十）** — `persistence.js` 在「本地有 + 云端有 + 校验和不一致」时置 `bootState="awaiting-choice"` 并挂起 Promise；`bootstrap-launch.js` 弹出 `#boot-conflict-choice` 浮层，仅「使用本地存档 / 使用云端存档」两个按钮，分别调 `resolveCloudConflict("local"|"cloud")`，**没有取消按钮**。`test-save-bootstrap-guard.mjs` 场景 4/5 实测两种选择均正确落地（云端选择会把云存档写回 localStorage）。
7. **TapTap 严格适配器 + Steam 隔离（决定·八 / ·九 / ·十一）** — `js/platform/taptap/*` 严格按官方 API 实现；`platform-achievement-map.js` G01–G06 当前 `taptap:null`/`steam:null`（`enabled=false`，未拿后台 ID 前绝不上报）；`build-taptap-h5.mjs` 显式 `return false` 排除 `js/platform/steam/`，selftest 与 release 包均不含 Steam 代码。`audit-platform-integration.mjs` Group [7] 进一步锁定构建白名单（排除 `js/qa-seed.js` 与 `js/platform/steam/**`，保留 `js/platform/taptap/` 与 `js/data/platform-achievement-map.js`）。
8. **机器验收 Phase-1 专项全绿（决定·七 / ·八 实测）** — 见 §4：`node --check` 全绿、`git diff --check` 零空白错误、**8 个 Phase-1 测试/审计 EXIT=0**（含新增 `audit-platform-integration.mjs` 13 组忠实断言）；`verify.mjs` 与 `audit-achievements.mjs` 两项既有基线 EXIT=1 显式保留（见 §5）。

---

## 4. 机器验收序列结果（本次实跑，2026-08-15）

| 检查项 | 命令 / 文件 | 结果 |
|--------|-------------|------|
| 空白符检查 | `git diff --check` | ✅ EXIT=0（仅 CRLF 归一提示，非错误） |
| 语法检查 | `node --check` 全部新增/修改生产 JS（11 个平台/云存档/成就同步文件 + `events.js`/`persistence.js`/`render.js`/`index.html` 逻辑）与全部 Phase-1 `tools/*` 脚本（10 个） | ✅ 全绿 |
| 引导守卫测试 | `tools/test-save-bootstrap-guard.mjs` | ✅ EXIT=0 |
| 云端存档服务测试 | `tools/test-cloud-save-service.mjs` | ✅ EXIT=0 |
| 成就平台同步测试 | `tools/test-achievement-platform-sync.mjs` | ✅ EXIT=0 |
| 平台边界审计 | `tools/audit-platform-boundaries.mjs` | ✅ EXIT=0 |
| 冲突弹窗测试 | `tools/test-conflict-popup.mjs` | ✅ EXIT=0（P1-4 富化弹窗行为） |
| 成就映射审计 | `tools/audit-achievement-platform-map.mjs` | ✅ EXIT=0（ACHIEVEMENTS=193 / PlatformAchievementMap=193 / 无孤儿·缺失 / nameStatus 仅 placeholder/provisional / G01–G06 firstRound=true+enabled=false） |
| 平台集成忠实审计（P1-6） | `tools/audit-platform-integration.mjs` | ✅ EXIT=0（13 组断言全 PASS，详见 §7 落点表） |
| 在线/离线对账 | `tools/test-online-offline-parity.mjs` | ✅ EXIT=0 |
| 全量基线校验 | `tools/verify.mjs` | ⚠️ EXIT=1 — **已知既有基线失败**（见 §5-1，仅 View-State） |
| 成就全量审计 | `tools/audit-achievements.mjs` | ⚠️ EXIT=1 — **既有基线失败，与 Phase-1 无关**（见 §5-2，168 FAIL 均为过期/遗留断言） |

> 结论：Phase-1 专项（上表 8 个 EXIT=0 项）全数通过；不称「全部测试全绿」，因为 `verify` 与 `audit-achievements` 两项 EXIT=1 在序列之中，已逐项说明且非 Phase-1 回归。

---

## 5. 已知既有基线失败（显式保留，不盲修）

### 5-1. `verify.mjs` 行 1017 — View-State 断言（仓库既有）
`仓库、LP商店、船坞、装配、队列或导航View State异常`。本次 `events.js`/`index.html`/`persistence.js` 修改**未触及** View-State 逻辑；`verify.mjs` 已越过契约检查（`boot:state` 缺契约不再报）与 DOM-ID 检查（基线已含 `cargo-content-modal`/`boot-fatal-error`/`boot-conflict-choice` 及 §8 的 10 个云存档 ID），仅余此既有失败。属仓库历史基线，按 HOLD 纪律不盲修。

### 5-2. `audit-achievements.mjs`（PASS=692 / FAIL=168）— 独立「成就重构」过渡态审计，与 Phase-1 无交集
该审计的失败项全部为**早于当前生产的遗留断言**，本轮修改的跟踪文件（平台/云存档/成就同步/引导）与成就数据文件（`achievements.js`、`achievement-rules.js`、`platform-achievement-map.js` 映射口径）无交集。**不是 Phase-1 引入的回归**。按区域统计：

| 区域 | PASS | FAIL |
|------|------|------|
| --data | 41 | 11 |
| --state | 24 | 10 |
| --unlock | 33 | 0 |
| --skills | 67 | 19 |
| --production | 59 | 11 |
| --combat | 106 | 20 |
| --manufacturing | 39 | 8 |
| --equipment | 49 | 14 |
| --boosters | 65 | 8 |
| --archaeology | 50 | 12 |
| --planetary | 32 | 9 |
| --station | 45 | 9 |
| --blueprint | 43 | 25 |
| --economy | 20 | 4 |
| --general | 17 | 8 |
| **合计** | **692** | **168** |

**逐项归类（FAIL 标签 → 归因）：**
- **冻结快照/字节级期望（过期）**：`[8]` CSV↔AchievementData、`[20][21][22][23]` 字段一致性、`[26][27][28e][28f]` 冻结哈希 `9511da2753…` / 14259 字节、字节精确比对。
- **197 旧计数口径（过期）**：`[b27]`「目录 197-176」、`[ec5]`/`[gc5]`「目录 197 / 197-194=3」、`[S1]`「197 steam.enabled」。当前权威目录为 **193**（见 §6），这些 197 期望属于旧审计。
- **“49 脚本”旧脚本计数（过期）**：`[sk64][sk65][sk66]`、`[pr42][pr43][pr57]`、`[cb28]`、`[eq52][eq52b]`、`[mc36][mc37]`——期望 49 个 `<script>` 引用，实际 index.html 当前为 **74**（63 + Codex 返修 P0-1 增补 11 个平台脚本）。
- **taptap-portrait.js 沙箱 LOAD FAIL（环境限制，非生产 bug）**：`[b8]`、`[b19]` 报 `js/ui/taptap-portrait.js: Cannot read properties of undefined (reading 'insertBefore')`——该审计的 vm 沙箱未完整模拟竖屏移植所依赖的 DOM 节点，导致加载期短路；与平台/云存档逻辑无关。
- **--combat `[FATAL]` 沙箱崩溃（环境限制）**：`Cannot read properties of undefined (reading 'fitted')`——战斗测试夹具未构造舰船 `fitted` 字段，沙箱内抛错；非生产回归。
- **成就生命周期链式断言（早于当前生产逻辑，遗留）**：剩余 `[h*]`（`h4/h17/h18/h19/h22/h31/h42/h43/h44`）、`[b9–b17/b26/b43/b51–b68]`、`[ec11/ec21/ec23]`、`[gc9/gc15/gc16/gc18/gcJ05/gc20]`、`[st*]`、`[sk*]`（除 64/65/66）、`[pr*]`（除 42/43/57）、`[mc*]`（除 36/37）、`[eq*]`（除 52/52b）、`[br*]`、`[cb*]/[cbH*]/[cbG*]/[cbE*]`、`[ar*]`、`[g*]` 等——均为成就追溯/解锁链（blueprint 溯源、economy、general、combat、station、skills、equipment、manufacturing、archaeology、planetary）的旧期许，针对的是已演进的成就子系统，需由独立的「成就重构」审计更新，不属 Phase-1 范围。

---

## 6. 数据对账（193 为权威口径；197 为过期审计）

- **权威目录 = 193**：四套来源完全一致——`achievements.js` 的 `ACHIEVEMENTS` 与 `ACHIEVEMENTS_BY_ID`（各 193 键）、`platform-achievement-map.js` 的 `PlatformAchievementMap.count()===193`、`tools/gen-tap-achievement-setup-csv.mjs` 生成的 `TAPTAP_ACHIEVEMENT_SETUP.csv` 数据行 = 193。
- **构成**：placeholder=182、provisional=11、final=0；**enabled 全 false（193）**；**taptapId 全空（0 非空）**；**G01–G06 firstRound=true（6）**，其余 firstRound=false。
- **CSV 物理行**：194（1 表头 + 193 数据）。表头 8 列：`internalId,category,tier,hidden,nameStatus,firstRound,enabled,taptapId`（已补 `taptapId` 列）。无孤儿行、无缺失行（audit-achievement-platform-map.mjs 已断言 ACHIEVEMENTS 与 PlatformAchievementMap 键集合相等）。
- **关于 197**：`audit-achievements.mjs` 内部仍残留「目录 197 / 194 规则 + 3 未映射 J10/J11/J12」的旧期望（见 §5-2）。这是**过期审计口径**，不代表当前生产数据；当前生产目录为 **193**，**不把 197 写入本报告作为当前有效口径**。`platform-achievement-map.js` 当前覆盖的也是 193 项（非 197）。

---

## 7. P0-1 → P1-6 逐项落点

| 项 | 要求 | 落点（文件 / 函数 / 审计组） |
|----|------|------------------------------|
| P0-1 | 平台脚本加载顺序 + 全局契约 | `index.html` 11 个平台/云存档/成就同步脚本排在 `persistence.js` 之前；`verify.mjs` 断言 74 脚本 + 11 文件顺序 + 7 全局类；`audit-platform-integration.mjs` Group [1]/[2] |
| P0-2 | SaveEnvelope fail-closed | `js/core/save-envelope.js`（ENVELOPE_VERSION_TOO_NEW / CHECKSUM_MISMATCH） |
| P0-3 | 本地 `eve_idle_save` 原始保留 | `js/core/cloud-save-service.js`（仅镜像，不改源键） |
| P0-4 | 离线结算恰好一次 | `persistence.js` bootstrap + 隔离 `calculateOfflineGains`；`audit-platform-integration.mjs` Group [4] `__settleCalls===1` |
| P0-5 | 冲突盒子无取消（awaiting-choice） | `persistence.js` `resolveCloudConflict` 失败路径重置 + `bootstrap-launch.js` `showConflictChoice()` |
| P0-6 | Noop 绝不接管 localStorage | `noop-cloud-provider.js` / `noop-achievement-provider.js` `isAvailable=false`；`audit-platform-boundaries.mjs` |
| P1-1 | use-cloud 不向云端回传 | `cloud-save-service.js` 成功路径不 create/update；`audit-platform-integration.mjs` Group [4] `P1-1`（`createArchive===0 && updateArchive===0`） |
| P1-2 | 云查询失败 → fail-closed 错误页 | `cloud-save-service.js` bootstrap 错误路径；`audit-platform-integration.mjs` Group [5]（`save()===false`、`tick=0`、`结算=0`、`上传=0`、`本地写=0`、`bootState=error`、`不 reject`） |
| P1-3 | 有本地 + 无 Tap → local-only，无致命 | `audit-platform-integration.mjs` Group [6]（`bootState=local-only`、本地档恢复、无致命）；另含 §8 的 10 个云存档管理静态 ID |
| P1-4 | 冲突弹窗人工验收清单 | `bootstrap-launch.js` `showConflictChoice()` 富化；§9 人工验收清单 |
| P1-5 | 构建白名单（排除 qa-seed / steam，保留 taptap） | `tools/build-taptap-h5.mjs`（排除 `js/qa-seed.js` 与 `js/platform/steam/**`）；`audit-platform-integration.mjs` Group [7] |
| P1-6 | 忠实平台集成审计（13 组） | `tools/audit-platform-integration.mjs`（EXIT=0，13 组断言见下） |

**`audit-platform-integration.mjs` 13 组断言（全部 PASS）：**
1. 真实相对依赖顺序（contract→envelope→taptap→runtime→css→map→sync）
2. 审计加载集 = 真实生产脚本全集（解析 index.html 真实 `<script defer src>`，74 脚本、11 平台文件先于 persistence.js）
3. PlatformRuntime 选 taptap（非 web/Noop）；`createCloudProvider()` 返回 `TapTapCloudProvider`（非 Noop）；`CloudSaveService.provider` / `AchievementSyncService.provider` 分别为 `TapTapCloudProvider` / `TapTapAchievementProvider`；7 个生产全局存在；`PlatformAchievementMap.count()===193`
4. 无本地 + 有云端：加载期本地写=0 → `ready`；`getArchiveList`/`getArchiveData`/`readFile` 真实调用；`getArchiveData` 用 `archiveUUID+archiveFileId`；恢复云端 payload；离线结算恰好一次（P0-4）；P1-1 不回传（create/update=0）；落定后本地存档写入
5. 无本地 + 云端失败：`bootState=error`、`save()===false`、`isBootBlocked=true`、结算=0、上传=0、本地写=0、`bootstrap` 以 error 落定而非 reject
6. 有本地 + 无 Tap：无致命、`bootState=local-only`、本地档恢复、离线结算恰好一次
7. 构建白名单：硬排除 `js/qa-seed.js` 与 `js/platform/steam/**`；未排除 `js/platform/taptap/` 与 `js/data/platform-achievement-map.js`

---

## 8. 10 个新增静态云存档 DOM ID（P1-3，位于 `#save-panel` 内 `#cloud-save-mgmt`）

`verify.mjs` 基线 319 → 329 的 +10 即以下静态 ID（均由 `index.html` 静态声明，非运行时创建）：

1. `cloud-save-mgmt`（容器）
2. `cloud-sync-status`
3. `cloud-sync-failed-flag`
4. `local-save-time`
5. `cloud-save-time`
6. `last-sync-time`
7. `btn-sync-now`
8. `btn-check-cloud`
9. `btn-delete-local`
10. `btn-permanent-delete`

> 注：另有 3 个运行时动态创建的 ID（`boot-fatal-error` / `boot-conflict-choice` / `boot-conflict-error`，由 `bootstrap-launch.js` 在冲突/致命路径创建）已列入 `verify.mjs` 的 `optionalIds`，不计入上述 10 个静态增量。

---

## 9. 冲突弹窗人工验收清单（P1-4，真机/模拟器执行）

`bootstrap-launch.js` 的 `showConflictChoice()` 在「本地有 + 云端有 + 校验和不一致」时弹出 `#boot-conflict-choice`。以下为人工验收步骤（不依赖自动化脚本，需真机或浏览器手动走查）：

- [ ] **触发条件**：同一账号在设备 A 存过档、设备 B 也存过档（或本地改过、云端不同），启动后进入 `awaiting-choice` 而非 `ready`/`local-only`。
- [ ] **双按钮且无取消**：浮层仅「使用本地存档」「使用云端存档」两个按钮；确认**没有**「取消 / 稍后 / X 关闭」等可绕过选项。
- [ ] **选本地**：点「使用本地存档」→ `resolveCloudConflict("local")`；游戏进入 `ready`；本地 `eve_idle_save` 保持原值；云端不被覆盖。
- [ ] **选云端**：点「使用云端存档」→ `resolveCloudConflict("cloud")`；云端 payload 写回 `localStorage` 的 `eve_idle_save`；游戏进入 `ready`；离线结算仅执行一次（无重复结算）。
- [ ] **阻塞门生效**：在 `awaiting-choice` 期间，`tick` / 自动保存 / 成就上传 / 离线结算均被 `isBootBlocked()` 暂停（侧边栏计时与产出不动）。
- [ ] **错误页降级**：若云端查询本身失败（非冲突），应进入 `error` 阻塞错误页（`boot-fatal-error`），`SaveManager.save()` 返回 `false`，不崩溃、不凭空覆盖。
- [ ] **无 Tap 降级**：本地已有档但 Tap SDK 缺失时，最终 `local-only`，本地档正常恢复，无致命错误。

---

## 10. HOLD 状态与后续

- **当前 HOLD**：**未执行 `git commit` / 未 `git add .` / 未构建 release 包（`build-taptap-h5.mjs` 未在本次运行）/ 未 `git push` / 未真机测试**。`git status --short` 显示 6 个跟踪文件修改 + 一批未跟踪文件（含 Phase-1 脚本、CSV、本报告及若干 `PLAN-*.md` / `demos/` / `RC6_*.diff` 等无关文件），刻意不 `git add .` 以避免夹带。
- **解锁 HOLD 的前提**：机器验收（本报告 §4 的 8 个 Phase-1 专项）通过 **+** 真机验收（TapTap 后台联调、真机存档上传/下载/冲突恢复、§9 清单走查）两者通过后方可进入 commit / build / push。
- **后续阶段待办**：Steam 合同签署后实现 `js/platform/steam/` 适配器；TapTap 后台申请 G01–G06 真实 ID 后回填 `platform-achievement-map.js`；更新独立的 `audit-achievements.mjs` 以消除 §5-2 的 168 项遗留 FAIL（属成就重构专项，不阻塞 Phase-1）。

---

## 11. 本次新增/修改文件清单（供验收与后续提交参考）

**新增（未跟踪）：**
- `js/core/save-envelope.js`、`js/core/cloud-save-service.js`、`js/core/achievement-sync-service.js`、`js/core/bootstrap-launch.js`
- `js/data/platform-achievement-map.js`
- `js/platform/cloud-save-contract.js`、`js/platform/achievement-provider-contract.js`、`js/platform/platform-runtime.js`
- `js/platform/providers/noop-cloud-provider.js`、`js/platform/providers/noop-achievement-provider.js`
- `js/platform/taptap/taptap-cloud-provider.js`、`js/platform/taptap/taptap-achievement-provider.js`
- `tools/test-save-bootstrap-guard.mjs`、`tools/test-cloud-save-service.mjs`、`tools/test-achievement-platform-sync.mjs`
- `tools/audit-achievement-platform-map.mjs`、`tools/audit-platform-boundaries.mjs`、`tools/test-conflict-popup.mjs`、`tools/audit-platform-integration.mjs`
- `tools/gen-tap-achievement-setup-csv.mjs`（生成 `TAPTAP_ACHIEVEMENT_SETUP.csv`）
- `TAPTAP_ACHIEVEMENT_SETUP.csv`（193 数据行，8 列）

**修改（工作区）：**
- `js/core/events.js`（新增 `"boot:state"` 契约）
- `js/core/persistence.js`（bootstrap 状态机 + 双通道广播 + 阻塞门 + 冲突落点）
- `js/ui/render.js`（启动阻塞门接线）
- `index.html`（脚本顺序：persistence → bootstrap-launch → render；`?v=` 缓存破坏；§8 的 10 个云存档管理静态 ID）
- `tools/build-taptap-h5.mjs`（排除 `js/platform/steam/` 与 `js/qa-seed.js`）
- `tools/verify.mjs`（脚本计数 63→74、DOM-ID 基线 319→329、optionalIds 增补 `boot-conflict-error` 等 3 项、P0-1 平台脚本顺序 + 7 全局类断言；仅余 §5-1 既有 View-State 失败）

> 本报告本身为未提交交付物，待 HOLD 解除后随 Phase-1 一并纳入提交（或单独提交，取决于提交策略）。

---

## 12. Codex 接管复核：设备双代镜像与云同步加固（2026-08-15，权威增补）

本节覆盖并更新前文的脚本数与 DOM 基线：生产脚本现为 **78**（原 74 + 设备镜像 4 文件），静态 DOM ID 为 **332**（原 329 + 设备备份状态/时间/按钮 3 项）。平台集成文件共 **15** 个，全部早于 `persistence.js`。

### 新增生产文件

- `js/platform/local-mirror-contract.js`
- `js/platform/providers/noop-local-mirror-provider.js`
- `js/platform/taptap/taptap-local-mirror-provider.js`
- `js/core/local-mirror-service.js`

### 文件与恢复语义

- 云上传暂存文件：`deep_space_idle_archive.json`（仅供 TapTap 云 API 上传）。
- 当前设备镜像：`deep_space_idle_device_backup.json`。
- 上一代设备镜像：`deep_space_idle_device_backup.previous.json`。
- 原子写入临时文件：`deep_space_idle_device_backup.tmp.json`。
- 写镜像严格执行：写 tmp → 回读逐字校验 → current 轮转为 previous → tmp rename 为 current。
- 启动读取统一采用 `none / ok / error` 三态；`localStorage` 解析异常、文件 I/O/权限错误和云查询错误都不得被当作“无存档”。
- 仅当 localStorage、设备镜像、云端三处均明确返回 `none` 时，才允许创建全新存档。
- 候选最终选定后才迁移与激活，离线结算整个启动会话恰好一次。
- 删除此设备存档：先删 current/previous/tmp，再删 localStorage；镜像删除失败则保留 localStorage。
- 永久删除：先删云端，再删设备镜像，最后删 localStorage；任一步失败即停止后续删除。

### 云同步补强

- 自动定时器仅在 `dirty=true` 时上传，不再无改动每分钟重复上传。
- 上传失败恢复 `dirty=true`，保留后续重试机会。
- 上传进行中发生的新本地保存通过 `dirtyVersion` 保留，不会被旧上传成功错误清除。
- 云端成功查询会清除旧错误状态；云端基线 checksum 立即持久化到 sync meta。

### 新增/更新机器验收（本轮均 EXIT=0）

- `tools/test-local-mirror-recovery.mjs`：首写、两代轮转、主镜像损坏回退、tmp 回读失败、rename 中断恢复、权限错误三态、删除、失败重试。
- `tools/test-save-recovery-layers.mjs`：localStorage 缺失/损坏、镜像恢复、云端救援、模糊状态 fail-closed、候选新旧选择、三处明确 none 才开新档、删除顺序。
- `tools/test-save-bootstrap-guard.mjs`：候选未决不迁移、最终候选仅迁移一次、冲突阻塞与单次离线结算。
- `tools/test-cloud-save-service.mjs`：clean 不上传、频控、失败保留 dirty、上传中新增变更不丢。
- `tools/audit-platform-integration.mjs`：78 脚本、15 平台文件、真实 TapTap cloud/mirror provider 选择与启动链。
- `tools/audit-platform-boundaries.mjs`：共享 core 无 `tap/SteamBridge`，云暂存与设备镜像文件名隔离。

`tools/verify.mjs` 已通过 78 脚本、332 DOM ID、依赖顺序和语法加载，仍仅停在仓库既有 View-State 断言（当前行 1022）。HOLD 不变：未 commit、未构建 release、未 push、未真机测试。
