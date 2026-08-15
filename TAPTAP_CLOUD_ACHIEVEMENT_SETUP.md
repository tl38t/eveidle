# TapTap 云成就后台配置清单（第一阶段）

本文件与 `TAPTAP_ACHIEVEMENT_SETUP.csv`、`js/data/platform-achievement-map.js` 三者配套，
用于把《深空放置：边疆纪元》的内部成就 ID 安全地对接到 TapTap 小游戏成就后台。

---

## 1. 三件套职责划分

| 文件 | 角色 | 是否被游戏运行期读取 |
|------|------|----------------------|
| `js/data/achievements.js` | 内部成就权威事实（id / 条件 / 奖励 / 命名状态） | 是（游戏内成就系统） |
| `js/data/platform-achievement-map.js` | 内部 ID → 平台 ID 的只读映射（含 `OVERRIDES` 填入位） | 是（成就同步服务读取） |
| `TAPTAP_ACHIEVEMENT_SETUP.csv` | 后台“建哪些成就”的配置清单草稿 | **否**（仅供开发者/后台导入参考） |

> 运行期是否向 TapTap 上报某个成就，**唯一**由 `platform-achievement-map.js` 中该 ID 是否填入
> 真实平台 ID（`isConfigured` 为 true）决定。`CSV` 的 `enabled` 列只是后台侧的“是否创建”提示，
> 与运行期解耦——两者需人工保持同步（见第 4 节）。

---

## 2. 第一阶段范围（交付决定·八）

- **首轮候选仅 G01–G06**：均为 `provisional` / 非隐藏 / 铜杯 / “首次殖民某类行星”。
- **默认 `enabled=false`**：所有 193 行在 CSV 中 `enabled=false`，`OVERRIDES` 全空。
  → 运行期 `isConfigured` 全部为 false，**第一阶段不会向 TapTap 同步任何成就**。
- **A02 / A23 排除出首轮**：二者为“技能达 50 级”的 provisional 成就，与 G 系列首殖民主题无关，
  且 50 级门槛对首轮不友好，留待后续轮次。
- **不使用真实 API**：TapTap 云存档 / 成就的真实接口仅在真机测试中调用（交付决定·十一）。

---

## 3. 计数对账：193 而非 197（交付决定·七）

- 经审计，`ACHIEVEMENTS.length === 193`（与 `ACHIEVEMENTS_BY_ID` 键数一致，无重复/丢失）。
- 旧 UI 静态占位曾写 `0 / 197`，属误写；**已改为动态取 `ACHIEVEMENTS.length`（=193）**，
  不再硬编码 197，也不会因数据微调而错位。
- 命名状态分布：`placeholder` 182 + `provisional` 11 = 193；**无正式命名成就**，
  因此运行期不得把 `provisional` 当作“已正式命名”对外展示。
- 机器保证见 `tools/audit-achievement-platform-map.mjs`（四套内部 ID 集合互相等价 + 计数 = 193）。

---

## 4. 如何正式开启某个成就（未来轮次）

1. 在 **TapTap 开发者后台** 的“成就”面板创建对应成就，取得其成就 ID（字符串）。
   - 后台名称（`achievementName`）可自由命名（支持中文），但注意后台自身的字节/长度限制。
   - 成就 ID 必须是后台已配置的有效 ID，否则 `unlockAchievement` 会走 `onAchievementFailure`。
2. 在 `js/data/platform-achievement-map.js` 的 `OVERRIDES` 中填入：
   ```js
   "G01": { taptap: "ach_colonize_lava", steam: null },
   ```
3. 将 `TAPTAP_ACHIEVEMENT_SETUP.csv` 对应行的 `enabled` 改为 `true`，
   重新生成（`node tools/gen-tap-achievement-setup-csv.mjs`）或直接手改并保持两处一致。
4. 重新构建并跑 `audit-achievement-platform-map.mjs`，确认 `isConfigured` 计数上升、仍无孤儿键。
5. 真机验证 `createAchievementManager` 解锁回调与 Toast 提示（交付决定·九保留 Toast 供观测）。

> Steam 列 `steam` 当前恒为 `null`：Steam 仅为合同预留，未签 SDK，不填。

---

## 5. 平台接口纪律（交付决定·十一）

- 成就管理器：`tap.createAchievementManager({ toastEnable: true })`（全局单例，非 Promise）。
- 解锁：`manager.unlockAchievement({ achievementId })`，结果经
  `registerListener({ onAchievementSuccess(code, achievement), onAchievementFailure(id, code, msg) })` 异步回调。
- 不能把平台回包当作“是否解锁”的事实来源；事实仍来自 `gameState.achievements.unlockedAtById`。
- 平台失败 **不回滚** 本地成就/奖励，仅入重试队列（见 `achievement-sync-service.js`）。
