# 聊天系统技术方案（设计稿 v0.4）

> 状态：**后端已上线 + 前端已实现（未 commit / 未构建 / 未上传）。**
> 后端（2026-10-01 授权部署）：3 个迁移已入库（`20261001120000/1/2`）、云函数 `chat-service` 已部署、网关 `/chat-service` 路由已启用，端点探针全绿（见 §12.7）。
> 范围：**仅 Steam 端**（MVP）。核心逻辑写在共享 `js/`，但聊天入口用 Steam-only feature flag 显隐，TapTap / Web 构建暂不开入口（代码预留，将来开 flag 即可启用，无需重写）。
> 形态（v0.3）：**底部停靠条（非独立页）**，可展开/收起，开合状态记 localStorage。
> v0.4（2026-10-01 真机反馈修复）：**输入框未发送内容被轮询冲掉**的 bug 已修（§12.8）。
> 后端：CloudBase PostgreSQL（环境 `deepspace-d4govx4ikc2e937c5`），复用现有 alliance 通信模式与 `x-alliance-session` 管理员鉴权。

---

## 0. 结论摘要

1. **技术可行，工作量小。** 聊天 = 一个带历史记录的消息面板 + 几条云函数，复用现成 CloudBase 后端与 alliance 面板模式。比 alliance 系统本身更简单（alliance 有成员关系/权限/生命周期，聊天只是 append + read）。
2. **Steam 国际版不强制技术内容过滤**，但要求：商店页标 `Users Interact` 描述符 + 游戏内举报通道 + 可对违规者封禁。
3. **真·强制审核只来自中国大陆渠道**（TapTap 国区 / 微信 / 版号）。聊天后端审核逻辑与 TapTap 共享一套，边际成本极低。
4. **推荐 MVP**：公会聊天 + 轮询拉取（2~3s），先行上线；世界频道二期谨慎评估。

---

## 1. 频道与分级（决策点见 §9）

| 频道 | 标识格式 | 受众 | 审核强度 | 首发？ |
|---|---|---|---|---|
| 公会聊天 | `alliance:<allianceId>` | 公会成员 | 轻审（举报 + 本地屏蔽 + 自建词库预过滤） | ✅ MVP（本期唯一频道） |
| 世界频道 | `world` | 全服 | 强审（敏感词过滤 + 举报 + 禁言）+ 实时库 watch | ⏸ 二期 |
| 私聊 | `pm:<uidA>:<uidB>` | 两人 | 轻审（举报 + 屏蔽） | ❌ 本期不做（路线已定后端统一，预留） |

**分级原则**：开放度越高 → 审核越重。公会成员有限且有社交约束，风险最低；世界频道匿名开放，是 moderation 成本主来源。

---

## 2. 数据模型（PostgreSQL DDL）

```sql
-- 消息主体（聊天系统核心表，待建）
CREATE TABLE chat_messages (
  id          bigserial PRIMARY KEY,
  channel     text        NOT NULL,   -- 'alliance:<id>' | 'world' | 'pm:<uidA>:<uidB>'
  sender_uid  text        NOT NULL,
  sender_name text        NOT NULL,
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted     boolean     NOT NULL DEFAULT false  -- 软删：审核删消息时置 true，前端不渲染
);
CREATE INDEX idx_chat_messages_channel_created ON chat_messages(channel, created_at DESC);

-- 举报（必须，留案可查）
CREATE TABLE chat_reports (
  id           bigserial PRIMARY KEY,
  reporter_uid text        NOT NULL,
  target_type  text        NOT NULL,   -- 'message' | 'player'
  target_id    text        NOT NULL,   -- 消息 id 或被举报玩家 uid
  reason       text        NOT NULL,   -- 'spam' | 'harass' | 'hate' | 'other'
  detail       text,
  status       text        NOT NULL DEFAULT 'pending', -- pending|reviewed|actioned|dismissed
  handled_by   text,
  handled_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_reports_status ON chat_reports(status) WHERE status = 'pending';

-- 禁言（管理员罚则，必须；发消息时校验）
CREATE TABLE chat_mutes (
  target_uid  text        NOT NULL,
  scope       text        NOT NULL,   -- 'global' | 'alliance:<id>' | 'world'
  reason      text,
  expires_at  timestamptz,            -- NULL = 永久
  by_admin    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_mutes_target ON chat_mutes(target_uid, scope);

-- 玩家屏蔽关系（可选后端；MVP 可只存本地 localStorage）
CREATE TABLE chat_blocks (
  blocker_uid text NOT NULL,
  blocked_uid text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_uid, blocked_uid)
);
```

> 存储选型：与 alliance 同源 PostgreSQL，保持一致运维。若后续聊天走文档库也可，结构类似。

---

## 3. 云函数接口（复用现有 HTTP 网关 + `x-alliance-session`）

所有接口走现有 `alliance-api.js` 同款 fetch 网关模式（`https://<ENV_ID>.api.tcloudbasegateway.com`）。

| 接口 | 方法 | 入参 | 出参 | 鉴权 | 说明 |
|---|---|---|---|---|---|
| `chat-send` | POST | `{channel, content}` | `{ok, msgId}` / `{error:'muted', until}` | 玩家 session | **改**：发前校验 `chat_mutes`（命中则拒）；可选敏感词预过滤 |
| `chat-list` | GET | `{channel, before?, limit?}` | `{messages[]}` | 玩家 session | **改**：过滤 `deleted=true` + 当前玩家 `chat_blocks` 中的 `sender_uid` |
| `chat-report` | POST | `{target_type, target_id, reason, detail}` | `{ok}` | 玩家 session | **新增（极小）**：写 `chat_reports` 一行 |
| `chat-block` | POST | `{blocked_uid, unblock?}` | `{ok}` | 玩家 session | **新增（小）**：设置/取消屏蔽（仅后端同步模式需要） |
| `chat-admin-reports` | GET | `{status?}` | `{reports[]}` | **admin session** | **新增**：拉待审举报 |
| `chat-admin-action` | POST | `{report_id, action, mute?}` | `{ok}` | **admin session** | **新增**：`dismiss`(忽略) / `delete_msg`(软删) / `mute`(写 `chat_mutes`) |

**管理员鉴权**：直接复用 `alliance-admin` 的 `x-alliance-session`（平台认 steam/taptap 身份），不另建权限体系。

**敏感词预过滤**：`chat-send` 内置可选词库匹配，命中则拒绝或打星。词库与 TapTap 版共享（一份维护，三端生效）。

---

## 4. 前端 UI（v0.3：底部停靠条，非独立页）

### 4.0 形态（v0.3 修订，2026-10-01）
用户明确「不要单独标签，放在页面下方，可以开启关闭」⇒ 由 v0.2 的独立导航页改为**底部停靠条**：

- 结构：`#chat-dock`（`position:fixed; left:216px; right:0; bottom:0; z-index:1400`）
  = `#chat-dock-toggle`（32px 标题栏：标题 + 状态 + 箭头）+ `#chat-panel`（展开区，默认 `display:none`）。
- 开合：点标题栏切换；状态写 `localStorage["eve_idle_chat_dock_open"]`；窗口重开后按上次状态恢复。
- 层级：1400 —— 低于既有弹窗（1500/8000/9999+/20000），高于普通面板内容，不遮挡模态框。
- 左侧留白 216px = 侧栏 `200px` + 间距 `16px`（`css/base.css .sidebar`），与主内容区对齐。
- 门控（§11.2 不变）：非 Steam 平台整条 `display:none` 且**不绑定事件、不执行逻辑**；判定在
  `chat-render.js syncChatDock()` 内于调用时进行（`platform-runtime.js` 晚于本脚本加载）。
- 入口钩子：`shell-render.js renderCurrentNavigation()` 内一次性调用 `window.syncChatDock()`
  （成功门控后置 flag 短路，同既有 `_ship3dPending` 模式）。

### 4.1 面板结构
- 消息列表：正序滚动，重建 `innerHTML` 前后保持滚动位置（近底部则贴底）。
- 历史分页：`加载更早的消息` 按钮（`before` 游标，每次 30 条）。

### 4.2 每条消息操作
- `举报` → 弹原因选择（广告刷屏/骚扰辱骂/仇恨言论/其他）→ 调 `chat-report`
- `屏蔽`（对他人）→ 写 localStorage，仅本机生效，可在其消息原位解除
- 自己发的消息不显示举报/屏蔽按钮（不给自己发举报）

### 4.3 实时性（MVP 轮询）
- 停靠条**展开时**启动 `setInterval` 轮询 `chat-list`（3s）；收起即 `clearInterval`（tick 自检兜底）。
- 窗口失焦（`document.hidden`）跳过本次拉取但保留定时器。首次运行默认收起 ⇒ 启动期零请求。
- 进阶方案（二期）：CloudBase 实时数据库 `watch()` 真推送（<1s，需加订阅连接管理 + 重连）。

### 4.4 屏蔽生效
- `chat-list` 返回时过滤 `chat_blocks` 中被屏蔽 `sender_uid` 的历史消息；前端亦不渲染其实时消息。
- 被禁言：`chat-send` 返回 `muted` 时禁用输入框并提示「你已被禁言至 X」。

---

## 5. 管理员审核流（复用 alliance-admin 管理模式）

1. 审核面板（并入现有管理界面）：列出 `status='pending'` 举报。
2. 每条举报可操作：
   - `忽略` → `status='dismissed'`
   - `删消息` → 对应 `chat_messages.deleted=true`（前端不再渲染）
   - `禁言玩家` → 写 `chat_mutes`（`global` / 频道 / 时限可选）→ 该玩家 `chat-send` 被拒
3. 处置后 `status='actioned'` + 记录 `handled_by` / `handled_at`。

---

## 6. 合规清单

| 项 | 适用渠道 | 动作 | 强制？ |
|---|---|---|---|
| 商店页标 `Users Interact` | Steam 国际版 | 商店页元数据勾选 | ✅ Steam 要求 |
| 游戏内举报通道 | 全渠道 | `chat-report` + 前端按钮 | ✅ Steam 要求 |
| 可封禁/禁言违规者 | 全渠道 | `chat_mutes` + 审核面板 | ✅ Steam 要求 |
| 敏感词过滤 | 中国大陆渠道（TapTap/微信/版号） | `chat-send` 词库预过滤 | ✅ 法律要求 |
| 敏感词过滤 | **仅 Steam 端（本方案范围）** | `chat-send` 词库预过滤 | ⚠️ **非强制，建议做**（Steam 国际版不要求；成本低，建议顺手做挡掉大部分滥用） |
| 实时技术过滤 | Steam 国际版 | 建议（非强制） | ⚠️ 建议做（共享后端，成本低） |

---

## 7. 工作量与里程碑

| 阶段 | 内容 | 量级 |
|---|---|---|
| M1 后端 | `chat_messages`/`chat_reports`/`chat_mutes` DDL（**不含 `chat_blocks`**，本地屏蔽不需）+ `chat-send`/`chat-list` 改造 + `chat-report` + 自建词库预过滤 | 小 |
| M2 前端 | 公会聊天面板（复用 alliance-render）+ 消息操作（举报/本地屏蔽）+ **轮询 2~3s（面板可见才跑）** | 中 |
| M3 审核 | 审核面板（复用 admin session）+ 处置接口（忽略/删消息/禁言） | 小 |
| M4 合规 | 举报按钮 + Steam `Users Interact` 描述符 + 自建敏感词（`chat-send` 预过滤） | 小~中 |
| M5 进阶（二期） | 世界频道（强审）+ 实时库 watch + 私聊（后端统一） | 中 |

**MVP（M1+M2+M3+M4 的公会部分）即可上线。**

---

## 8. 风险

- **moderation 是持续运营负担**：开放聊天（尤其世界频道）需有人处理举报。首发仅公会聊天可压低风险。
- **轮询 API 成本**：每个在线用户 2~3s 轮询 = 云函数调用量随在线人数线性增长。可按频道/在线人数限频，或二期改实时库 watch。
- **Steam 原生好友私聊 vs 后端统一**：若私聊走 `ISteamFriends` 需 Electron 集成 steamworks SDK（额外复杂度，且只能 P2P 好友）；建议私聊也走后端统一，便于审核。

---

## 9. 决策记录（全部已拍板）

- [x] **频道范围**：**仅公会**（MVP 不含世界/私聊；私聊路线虽定后端统一，但本期不在范围内）
- [x] **私聊路线**：**后端统一**（预留；本期不实现私聊）
- [x] **屏蔽存储**：**MVP 本地（localStorage）**（零后端；`chat_blocks` 表留 DDL 作预留，后置可切后端同步）
- [x] **实时性**：**MVP 轮询 2~3s**（仅面板可见时跑；实时库 `watch()` 留世界频道二期）
- [x] **世界频道**：**二期做**（首发不做，强审 + 实时库 watch 留二期）
- [x] **敏感词词库**：**自建**（轻量词库，`chat-send` 预过滤，共享 TapTap 一份维护）

### 9.1 屏蔽存储（已定：本地）
| 方案 | 过滤位置 | 跨设备 | 后端改动 | 定稿 |
|---|---|---|---|---|
| 本地 localStorage | 客户端渲染时跳过被屏蔽 `sender_uid` | ❌ 不同步 | 零 | ✅ 采用 |
| 后端同步 `chat_blocks` | `chat-list` SQL 层 `WHERE sender_uid NOT IN (...)` | ✅ 同步 | 建表 + 接口 + 子查询 | 后置预留 |

### 9.2 实时性（已定：轮询）
| 方案 | 延迟 | 新增基础设施 | 成本特征 | 定稿 |
|---|---|---|---|---|
| MVP 轮询（2~3s，面板可见才跑） | 最坏 3s / 均 1.5s | 零 | 随在线聊天者线性增长，量有上限 | ✅ 采用 |
| 实时库 `watch()`（WS push） | <1s | 订阅/重连/连接管理 | 省空转，连接数 = 同时在线面板数 | 世界频道二期 |

---

## 10. 验收标准（草案）

- 公会成员可发/收消息，轮询 3s 内可见（**仅停靠条展开时**轮询，收起即停）。
- 停靠条开合状态跨会话保持（localStorage）；首次运行默认收起，启动期零请求。
- 非 Steam 平台：停靠条整条隐藏、无事件绑定、零网络请求（TapTap 兜底，见 §11.4）。
- 任一玩家可举报消息/玩家，举报进入 `chat_reports` `pending` 队列。
- 管理员可在审核面板处置（忽略/删消息/禁言），处置后前端立即生效。
- 玩家可本地屏蔽他人（localStorage），被屏蔽者消息在自己界面不显示；清缓存/换设备需重设（已接受）。
- Steam 商店页已标 `Users Interact`。
- Steam 端消息经自建敏感词词库预过滤（`chat-send` 拦截/打星），词库与 TapTap 共享一份维护。

---

## 11. 对 TapTap 的影响与隔离策略（仅 Steam 端范围）

本方案范围为**仅 Steam 端聊天**，TapTap / Web 暂不开启入口。以下评估该范围对**现有 TapTap 版本**的影响与必须具备的隔离手段。

### 11.1 分层影响

| 层面 | 对 TapTap 现有版本的影响 | 原因 |
|---|---|---|
| 玩家可见功能 | **零** | 聊天入口用 Steam-only flag 显隐，TapTap 构建不显示入口 |
| 现有数据 | **零** | 聊天是新增独立表（`chat_*`），与 alliance / 存档完全隔离；不改任何现有 alliance 接口 |
| 后端负载 | **零** | 聊天轮询只有 Steam 端触发（入口隐藏 → TapTap 玩家不产生聊天 API 调用） |
| 包体 | 略增 | 聊天 JS 会打进 TapTap bundle（入口隐藏但代码在包内），除非做条件打包 |
| **代码回归** | **有，可控** | 聊天模块加在共享 `js/`，TapTap 构建加载同一份 JS；若加载期有副作用会波及 |
| 合规 / 商店页 | **零** | Steam 标 `Users Interact` 不影响 TapTap；TapTap 当前无聊天，不触发国区敏感词要求 |

### 11.2 唯一真实风险：共享 `js/` 的代码回归

聊天逻辑放 `js/`（三端共享），即使 flag 隐藏入口，TapTap 构建仍**加载**这份 JS。风险仅在以下情况出现：
- 聊天模块在**加载期**就抓全局、起定时器、挂全局事件监听；
- 或意外修改共享状态 / 全局对象。

**防范规范（必须遵守，呼应既有铁律：内联 `<script>` 恒早于 `defer` 模块 ⇒ 面板脚本禁在加载期抓全局；唯一解 = `renderAll()` 首行惰性刷新）：**

1. **惰性初始化**：入口点击才初始化；轮询定时器只在进入频道后启动；**加载期零副作用**。
2. **不污染全局**：聊天状态挂独立命名空间，不挂 `window.gameState` 等共享对象。
3. **flag 短路**：非 Steam 平台下，聊天模块整体不执行任何逻辑（不只是隐藏 UI）——基于 `js/platform/steam/steam-session.js` 的平台标识判定。

做到这三点，TapTap 加载同一份 JS 也不会触发聊天逻辑 → 回归风险归零。

### 11.3 隔离粒度（按需选）

| 策略 | 做法 | 隔离度 | 代价 |
|---|---|---|---|
| **flag 隐藏**（推荐 MVP） | 入口显隐 + 惰性初始化 + 非 Steam 短路 | 功能不可见、逻辑不触发 | 聊天 JS 仍在 TapTap bundle，包体略增 |
| **条件打包** | Steam 构建含聊天模块，TapTap 构建排除 | 彻底隔离（代码不进包） | 改构建链（`build-taptap-h5.mjs` / Steam 打包），复杂度高 |

**建议**：MVP 用 flag 隐藏 + 惰性初始化，足够安全。仅在意 TapTap 包体那几 KB 或要求绝对零共享时，才上条件打包。

### 11.4 上线前 QA 兜底（必做）

给 TapTap 构建加一条聊天专项用例，验证：
- 聊天入口不可见；
- 聊天轮询定时器不启动（DevTools Network 无 `chat-list` 请求）；
- 现有面板（alliance / station / 战斗等）无异常、无新报错。

---

## 12. 实现任务清单（逐文件 work order，v0.2 定稿配套）

> **状态（2026-10-01）**：W1~W4 代码全部落地、四道闸门通过（§12.6）+ **后端已授权上线**（§12.7）。仅剩 `commit` 未做。

### 12.5v3 v0.3 形态修订记录（2026-10-01，独立页 → 底部停靠条）

用户要求「不要单独标签，放在页面下方，可开启关闭」⇒ 对 v0.2 已落地代码做的**增量修订**（未新增文件）：

| 文件 | 修订 |
|---|---|
| `index.html` | −`#nav-chat`（独立导航入口）、−旧 `chat-panel` 面板块；+`#chat-dock` 停靠条（标题栏 `#chat-dock-toggle` + 展开区 `#chat-panel`，内含 `#chat-status`/`#chat-content`）；`shell-render.js?v=` 165→**166** |
| `js/ui/shell-render.js` | 回退 4 处页面接线（ids/managedIds 去 `chat-panel`、去 standalone 映射、去 `=== "chat"` 分发）；`_chatNavGated` 块改为「一次性调用 `window.syncChatDock()`」 |
| `js/ui/chat-render.js` | `renderChatPage` → `syncChatDock()`（调用时才做平台判定，因 `platform-runtime.js:2819` 晚于本文件加载）；新增 `setDockOpen/readDockOpen/saveDockOpen` 与 `DOCK_KEY`；轮询自停判据不变（`#chat-panel` display） |
| `css/chat.css` | +停靠条容器样式（fixed/216px/1400 层级/32px 标题栏/箭头旋转）；消息列表高度 46vh→240px |
| `tools/verify.mjs` | DOM ID 基线 557→561（v0.2）→**562**（v0.3：−nav-chat +chat-dock +chat-dock-toggle） |

**v0.3 验收**：`node --check` ✅ ｜ `audit-v-bump` EXIT=0 ✅ ｜ `verify.mjs` 仅剩既存红灯 Batch G ×1.08 ✅ ｜ 沙箱探针 **18/18 PASS**（加载期零副作用 / web 零定时器零请求零绑定 / steam 幂等绑定 / 开合持久化 / 收起清定时器）｜ headless Chrome 真实页冒烟：停靠条在 DOM 且 web 下隐藏、`nav-chat` 已清除、启动完成、零 uncaught/SEVERE ｜ 停靠条视觉预览（真实 `chat.css` + 样例消息）布局对齐 ✅


### 12.0 现成骨架锚点（已核对）

| 锚点 | 位置 | 用途 |
|---|---|---|
| 平台判定 `getPlatform()` | `js/platform/platform-runtime.js:22-27`（`SteamBridge` 存在 → `"steam"`） | 聊天入口 flag 短路的唯一判据 |
| 面板 id 注册 | `js/ui/shell-render.js:790`（ids 数组）与 `:795`（managedIds） | 加 `chat-panel` |
| 页面分发 | `js/ui/shell-render.js:857`（`navigation.page === "alliance"` → `window.renderAlliancePage()`） | 照抄一条 `=== "chat"` 分支 |
| 导航按钮 | `index.html:387`（`<div class="nav-item" data-page="alliance" id="nav-alliance">`） | 旁边加 `nav-chat`，默认隐藏 |
| 面板容器 | `index.html:2378`（`<div class="panel alliance-panel" id="alliance-panel">`） | 旁边加 `chat-panel` 容器 |
| 脚本加载 | `index.html:2778`（alliance-api `?v=16`）/ `:2782`（alliance-render `?v=165`）/ `:2809`（platform-runtime `?v=4`） | 新增 2 个 defer script + 被改文件 bump `?v=` |
| 会话鉴权 | `cloudfunctions/alliance-identity/index.js` 的 `playerFromSession()`（HMAC-SHA256 验签 `x-alliance-session`） | chat 云函数**同源复制**该函数（含 `reply()`/`bodyOf()` 骨架与 `ALLOWED_ORIGIN` 等 env） |
| 环境变量 | `CLOUDBASE_API_BASE` / `CLOUDBASE_SERVER_API_KEY` / `ALLIANCE_SESSION_SECRET` / `ALLOWED_ORIGIN` | chat 云函数复用同一组，不新增 |
| 前端 API 模式 | `js/platform/alliance-api.js`（IIFE + identity gateway fetch + session token） | `chat-api.js` 照此模式，**只读复用其 token 存取，不改 alliance-api.js 本身** |

### 12.1 W1 — 后端（只写代码，不部署）

| # | 文件 | 动作 | 内容 |
|---|---|---|---|
| 1 | `chat-schema.sql`（仓根，对齐 `alliance-lifecycle-actions.sql` 命名） | 新建 | §2 DDL 三表（`chat_messages`/`chat_reports`/`chat_mutes`，**不含 `chat_blocks`**）+ 索引；幂等（`CREATE TABLE IF NOT EXISTS`） |
| 2 | `cloudfunctions/chat-service/index.js` | 新建 | HTTP 函数，4 个 action：`send`（禁言校验 → 自建词库过滤 → 入库）/ `list`（过滤 `deleted` + 分页游标）/ `report`（写举报）/ `admin_reports` + `admin_action`（dismiss/delete_msg/mute，仅 admin session）。复制 `playerFromSession()` 鉴权；频道校验仅放行 `alliance:<id>` 且发送者必须是该盟成员（复用 alliance 成员表查询） |
| 3 | `cloudfunctions/chat-service/banned-words.js` | 新建 | 自建词库（模块导出数组 + 匹配函数），仅服务端持有 |
| 4 | `cloudfunctions/chat-service/{package.json, scf_bootstrap, server.js, cloudbaserc.json}` | 新建 | 照 `alliance-identity/` 同构复制，改函数名与监听端口 |

### 12.2 W2 — 前端 API 层

| # | 文件 | 动作 | 内容 |
|---|---|---|---|
| 5 | `js/platform/chat-api.js` | 新建 | IIFE，零加载期副作用。暴露 `window.ChatAPI = { isAvailable(), send(), list(), report(), getMuteState() }`。`isAvailable()` = `getPlatform()==="steam"` 且已有 alliance session token；非 steam 平台全部方法短路返回 `{ok:false, reason:"platform"}`（flag 短路规范 §11.2） |

### 12.3 W3 — 前端 UI + 接线

| # | 文件 | 动作 | 内容 |
|---|---|---|---|
| 6 | `js/ui/chat-render.js` | 新建 | `window.renderChatPage()`：惰性刷新首行（铁律：面板脚本禁加载期抓全局）；消息列表渲染 + 举报/屏蔽（本地 localStorage `eve_idle_chat_blocks`）/输入框；轮询 2~3s **仅在面板可见时启动**，离开面板 `clearInterval`；禁言提示；软删消息不渲染 |
| 7 | `css/chat.css` | 新建 | **独立新文件**，避免触碰 `css/components.css`（SHA256 baseline 强制执行中） |
| 8 | `index.html` | 修改 | ① `:387` 旁加 `nav-chat`（默认 `display:none`）；② `:2378` 旁加 `chat-panel` 容器；③ 加 `<link chat.css>` + 2 个 defer script（chat-api、chat-render） |
| 9 | `js/ui/shell-render.js` | 修改 | ① `:790`/`:795` 两数组加 `chat-panel`；② `:857` 旁加 `=== "chat"` 分支调 `window.renderChatPage()`；③ 导航显隐：steam 平台显示 `nav-chat`，其余平台保持隐藏（改后 **bump `?v=`** + `tools/audit-v-bump.mjs` 必跑） |

### 12.4 W4 — 验收（代码层，无外部动作）

| # | 检查 | 判据 |
|---|---|---|
| 10 | `node --check` | 全部新/改 JS 零语法错 |
| 11 | `tools/audit-v-bump.mjs` | EXIT=0 |
| 12 | `tools/verify.mjs` | 除既存红灯（Batch G ×1.08）外无新红灯；⚠️ 新增 DOM id（`nav-chat`+`chat-panel`）会使 DOM ID 基线 557 → 559，**基线更新先报备再动手**（铁律 11） |
| 13 | headless Chrome `file://` 冒烟（web 平台） | 聊天入口不可见 + Network 无 `chat-` 请求 + 无新 console error（= §11.4 TapTap 兜底的等价验证） |
| 14 | 沙箱探针（Node vm） | chat-api/chat-render 加载期零副作用（不起定时器、不抓全局、非 steam 短路） |

### 12.5 边界（do-not-touch）

- **冻结文件**：`tick.js` / `offline.js` / `persistence.js` / `queue.js` / `events.js` / `js/render3d/**` —— 一律不碰。
- **只读复用**：`js/platform/alliance-api.js`、`cloudfunctions/alliance-*`（复制模式，不改原文件）。
- **规避 baseline**：不碰 `css/components.css`、`js/data/equipment.js`（SHA256 强制）。
- **外部动作单列**：DDL 执行、云函数部署、`index.html` 并发会话写回复核（Edit 后 grep 复核）、commit —— 全部需当次授权。

### 12.6 验收记录（2026-10-01 实测）

| # | 检查 | 结果 |
|---|---|---|
| 10 | `node --check`（chat-api / chat-render / shell-render / chat-service 三 JS） | ✅ 全过 |
| 11 | `tools/audit-v-bump.mjs` | ✅ EXIT=0（shell-render 164→165；新增 chat.css/chat-api/chat-render 均 ?v=1） |
| 12 | `tools/verify.mjs` | ✅ 仅剩**既存红灯** Batch G ×1.08（memory 在案，与本次无关）；基线同步：脚本 135→137（两处）、CSS 5→6（两处）、DOM ID 557→561（+4：nav-chat/chat-panel/chat-status/chat-content）、动态 ID 白名单 +2（chat-msg-list/chat-input） |
| 13 | headless Chrome `file://`（web） | ✅ 门控代码实际执行（`data-current-page="skill"` 在案）、nav-chat 保持隐藏、零 uncaught/SEVERE |
| 13b | Steam 正向路径 | ⚠️ 桩环境无法模拟（空 SteamBridge 使 boot 异步链挂起，属桩缺陷非产品缺陷）；逻辑侧由探针 ③ 覆盖，真机路径留 Electron 壳验收 |
| 14 | Node vm 沙箱探针 | ✅ 11/11 PASS（加载期零定时器/零 fetch/零全局污染；web 平台全方法短路且零网络请求；steam+会话 isAvailable=true） |

### 12.7 后端上线记录与安全收口（2026-10-01，用户授权后执行）

> 授权范围：① `chat-schema.sql` 入库 ② 部署 `chat-service` 云函数 ③ 建网关路由。全部为**新增**，不动任何既有对象。

#### 12.7.1 已执行动作与判据

| 步骤 | 动作 | 判据（服务端证据） |
|---|---|---|
| ① DDL | `managePgDatabase(planMigration → applyMigration)`，`chat_schema` @ `20261001120000` | `Status=Succeed` + `Phase=RunMigrations` + `verified=true` + `localFileAction=matched`（传入 SQL 与本地文件字节一致） |
| ② 云函数 | `tcb fn copy alliance-identity chat-service` → MCP `updateFunctionCode(functionRootPath=…/cloudfunctions)` | 函数建成 `lam-0e5y1gx5`（HTTP / Nodejs18.15）；**CodeSize 4998 → 6207**（真部署判据，`fn deploy` 会静默空转不可信）；4 个 env 键与 alliance-identity **完全一致**（ValueLength 61/919/1/40，全程零明文） |
| ③ 网关 | `manageGateway(createRoute, path=/chat-service, WEB_SCF, targetName=chat-service, auth=false, enablePathTransmission=false)` | `listRoutes` 出现该条且 `Enable=true`；域名与 `js/platform/chat-api.js` 的 `CHAT_GATEWAY` 同域 |
| ④ 端点探针 | `POST /chat-service` | `{"action":"health"}` → **200**，`content-length: 36` = `{"ok":true,"service":"chat-service"}`（**函数独有标识**，排除"部署的是复制来的旧代码"）；无会话 `send` → **401**，`content-length: 71` = `{"ok":false,"error":"需要登录（平台会话缺失或已过期）"}`；伪造 token → 401；无会话未知 action → 401（证明验签早于动作分发） |

#### 12.7.2 ⚠️ 上线后发现并修复的两处真实越权（CloudBase 默认权限陷阱）

**根因**：CloudBase 对 `public` schema 配了 `ALTER DEFAULT PRIVILEGES`，新建 **表 / 函数**会自动带上
`anon`（SELECT / EXECUTE）与 `authenticated`（全 DML / EXECUTE）授权。
`chat-schema.sql` 起草时以为「不写 grant 就等于不授权」，**实际不成立**。

| # | 问题 | 取证 | 修复 |
|---|---|---|---|
| 1 | 三张 `chat_*` 表 + 三个序列对 `anon` 可读 ⇒ 持发布密钥者直连 PostgREST 读走全部聊天记录 | `relacl` 含 `anon=r`；`role=anon` 执行 `select count(*) from public.chat_messages` **成功返回** | 迁移 `20261001120001_chat_schema_acl`：`revoke all … from public, anon, authenticated` |
| 2 | 7 个 `chat_*` 函数对 `anon` 可执行 ⇒ **冒名**调用 `chat_send_message('alliance:N','<受害者 uid>',…)`，绕过云函数 HMAC 会话校验发言 / 读频道 | `proacl` 含 `anon=X`；`role=anon` 调用收到业务错误「频道无效」(P0001) 而非权限拒绝 | 迁移 `20261001120002_chat_rpc_acl`：收回 anon/authenticated，仅保留 `service_role` |

**修复后验收（同一判据复测）**：

| 检查 | 修复前 | 修复后 |
|---|---|---|
| `relacl`（表 / 序列） | `anon=r` / `anon=rwU` | **anon 与 authenticated 完全消失**，仅 `service_role` + owner |
| `proacl`（函数） | `anon=X` / `authenticated=X` | **仅 `service_role=X` + owner** |
| `role=anon` 查表 | ✅ 返回成功 | ❌ `permission denied for table chat_messages (42501)` |
| `role=anon` 调 RPC | ✅ 收到业务错误（= 有权限） | ❌ `permission denied for function chat_send_message (42501)` |
| `role=service_role` 查表 / 调 RPC | — | ✅ 正常（云函数链路完好；RPC 收到「频道无效」= 有权限且守卫先触发） |

> **为什么现在才暴露**：`role=anon` 角色级只读探针此前从未在本项目用过。本次改用
> `managePgDatabase(action="execute", role="anon"|"service_role")` 做**角色级实证**，
> 才把「ACL 看起来对 / 实际放行」区分开。此法已回写技能 `eve-idle-cloudbase-db-verify`。

#### 12.7.3 零残留复查

| 对象 | 部署前 | 部署后 |
|---|---|---|
| `chat_messages` / `chat_reports` / `chat_mutes` | 不存在 | **0 / 0 / 0 行**（全新建表，无测试数据） |
| `alliances` / `alliance_members` / `players` | 110 / 337 / 576 | **110 / 337 / 576**（未触碰） |

探针全部选「写库前即 raise」或纯 SELECT 的入参，未产生任何写入。

#### 12.7.4 迁移文件落点（需保持同步）

| 路径 | md5 |
|---|---|
| `cloudbase/migrations/20261001120000_chat_schema.sql` | `12d31ec5c5dd3d7e86faeba64475b431` |
| `cloudbase/migrations/20261001120001_chat_schema_acl.sql` | `73e62ce8f36d83d62ba4e13cd496b676` |
| `cloudbase/migrations/20261001120002_chat_rpc_acl.sql` | `e6eae8a9b2474b241d1aa738f42f7508` |
| `chat-schema.sql`（仓根，人读源） | = 200000 原文 + 顶部防分叉说明；**正文勿改** |

> MCP 进程 cwd 为 `D:\EVE-IDLE`，故同时写入 `D:\EVE-IDLE\cloudbase\migrations\`；两份 md5 已对齐。

#### 12.7.5 尚未做（等当次授权）

- `commit`（`cloudfunctions/**` 目前 untracked，需一并 `git add`）
- 真机 Electron 端到端：壳里点开底部停靠条、发一条消息、验证 2~3s 内可见
- Steam 商店页标 `Users Interact` 描述符

### 12.8 v0.4 —— 真机反馈修复：未发送内容被轮询冲掉（2026-10-01）

**现象**（用户真机反馈）：在聊天输入框里打字、**尚未发送**，过一会儿内容自己消失。

**根因**：`render()` 每次整块重写 `content.innerHTML` ⇒ `#chat-input` 被销毁重建；而 3s 轮询每轮都走
`pollTick() → loadLatest() → render()`。故未发送内容最迟 3s 后被一个全新空节点顶掉（焦点与光标位置一并丢失）。
这是「整块重绘 + 高频刷新」的必然结果，不是偶发。

**取证**（改前先复现，红 → 绿，非"应该修好了"）：
`tools/_tmp_chat_composer_probe.mjs`（已归档）用「能模拟销毁语义」的假 DOM——
动态节点注册表在 `content.innerHTML` 赋值时被清空，等价于浏览器里旧节点被替换；
`#chat-dock` 用 steam 平台桩打开、手动触发捕获到的 3s 轮询回调。同一探针：

| 断言 | 改前 | 改后 |
|---|---|---|
| P5 ★ 轮询后未发送内容仍在 | ❌ `value=""` | ✅ |
| P6 ★ 焦点仍在输入框 | ❌ | ✅ |
| P7 ★ 光标位置保持（5~5） | ❌ `0~0` | ✅ |
| P8 ★ 发送成功后输入框被清空 | ✅ | ✅ |
| 合计 | **5 PASS / 3 FAIL** | **8 PASS / 0 FAIL** |

**修法**（`js/ui/chat-render.js`，不改 HTML 结构、不加接口）：

1. 新增 `captureComposer() / restoreComposer()`：重写 `innerHTML` **前**快照「值 + 焦点 + 光标」，
   重写**后**回写；焦点原本不在输入框时不抢焦点（避免打断玩家点「屏蔽」等操作）。
2. 🔴 由此确立一条**本模块约定**：**`render()` 一律以「渲染那一刻的 live DOM 值」为真值来源**；
   任何"想清空输入框"的代码必须**发生在调用 `render()` 之前**（`sendMessage` 成功分支按此实现）。
   否则 `restoreComposer` 会把刚发出去的内容原样恢复回输入框。
3. 顺带修掉一处既有瑕疵：点击/Enter 分支原先把 `input.value=""` 写在 `sendMessage()` **之后**，
   而 `input` 变量指向的是已被 `render()` 销毁的**游离节点**（清了个寂寞）。现统一由 `sendMessage` 负责清空。
4. 发送**失败**时不清空（内容原样留在输入框，可直接重试）。

**配套：闸门加固（`tools/verify.mjs`）**
本次发现 `index.html` 被外部「页面/设计工具」注入 `data-page-node-id` 标注（实测 1026 处），
该属性会从两个方向打坏闸门：① DOM ID 采集正则 `/\bid="([^"]+)"/g` 中 `\b` 在 `data-page-node-id="` 的
`-`|`i` 之间成立 ⇒ node-id 被当成 DOM ID（562 → 1881）；② 属性追加在标签末尾 ⇒ 打破"标签形状"正则。
处置（**只改闸门，未触碰 index.html**——那是并发的他人改动，不得回滚）：
增加 `stripPageNodeIds()` 集中归一化（4 处 index.html 读取点全部走它），并把采集正则收紧为
`/(?<![-\w])id="([^"]+)"/g`。归一化后 DOM ID 计数精确回到 **562**（证明注入只加属性、未增删任何真实 ID）。

**验证**：`node --check` ✅ ／ `audit-v-bump` EXIT=0（`chat-render.js?v=1→2`）／
`verify.mjs` 仅剩既存红灯 Batch G ×1.08（memory 在案，与本次无关）／探针 8/8 ✅ ／
headless 冒烟 ✅（`data-current-page="skill"` 启动完成、web 下停靠条隐藏、零 uncaught）。

