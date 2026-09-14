# 微信小游戏迁移执行计划 v0.1

> 日期：2026-09-13 · 基线仓库：`EVEIDLE-WORKBUDDY-FRESH` @ `main`（`f3ee918`，工作树有并行线改动）
> 前置文档：`WECHAT_MIGRATION_PLAN_v0.1.md`（策略）· `WECHAT_SIZE_AND_TOOLING_AUDIT_v0.1.md`（体积与工具实测）
> 本文件只管**怎么执行**：阶段、任务号、准入准出、边界、门禁。

---

## 零、起跑线（已确认的事实）

| 项 | 状态 |
|---|---|
| 微信资质提交 | ✅ **已完成** |
| 小游戏备案 | 🔄 主管部门审核中（约 10 工作日） |
| 小程序备案 | ⬜ 待启动（条件已满足，可随时点） |
| 版本提审 | ⬜ **待提交 —— 唯一卡点是「还没有可运行的微信小游戏包」** |
| 主包 4MB 可行性 | ✅ **官方工具实测通过**（**2.56 MB / 4MB，余量 36%**；口径 = 原始字节和，JS 由工具剥离注释后计） |
| 3D 去留 | ✅ **全量保留，走分包**（官方实测 sub3d = **1,028,168 B / 1.03 MB**，单个普通分包不限大小）——P2 已证 three r180 零改动可跑（含泰坦） |
| 模块作用域 | ⚠️ **24 个「封死文件」，其中 16 个共 155 个名字被外部裸引用**（P2 实测：微信模块是**真函数作用域**，不泄漏）⇒ 需补双模式出口尾，见 R21 |
| `eval`/`new Function` | 🔴 **被完全禁用** ⇒ 若需「单作用域合并」只能是**构建期文本级合并**（但 P2 结论：已不需要） |
| 官方工具链 | ✅ 已查明（开发者工具稳定版 2.02.2608070 + CLI + miniprogram-ci） |

**⇒ 现在整条链路上只剩一件事：把游戏跑进微信小游戏运行时。**

---

## 一、两个硬约束 → 三条工程纪律

| 你的硬约束 | 落地纪律 |
|---|---|
| ① 不能影响现有 Steam / TapTap 封包 | **新增独立构建目标**，`index.html`、现有构建脚本、逻辑层行为**一律不改**；用「SHA 未变」证明零影响 |
| ② 修 bug 要三个平台一起修 | **逻辑层 `js/core` `js/systems` `js/data` 保持单一真源**，只读不复制；平台差异全部收敛进 `js/platform/` |
| （新增铁律）微信端命名 | 微信端一律 **`深空放置边疆纪元`**（无 `·`）；`·` 只留给 TapTap / Steam |

---

## 二、实测基线（每阶段回归比对用）

| 指标 | 当前值 | 采集方式 |
|---|---|---|
| **主包（官方口径）** | **2,689,445 B = 2.56 MB** ✅ | `cli.bat preview --project D:/EVE-IDLE/WECHAT-MINIGAME` |
| **sub3d（官方口径）** | **1,028,168 B** | 同上 |
| **subassets（官方口径）** | **9,895,221 B** | 同上 |
| **三包合计（官方口径）** | **13,612,834 B = 13.0 MB** / 30MB | 同上 |
| 主包 JS（terser 本地估算，已作废） | ~~2.91 MB~~ | `node D:/EVE-IDLE/wx-size-audit.mjs --minify` |
| `index.html` 本地引用 | 141（132 JS + 5 CSS + 2 assets + 2 three） | 同上 |
| UI 层 DOM 依赖 | `document.` 1220 · `window.` 922 · `addEventListener` 401 次 | `grep -ro` |
| UI 层 `innerHTML` 分布 | shell-render 65 · combat-render 41 · manufacturing 29 · legion 20 · booster 18 · wormhole 13 · render 10 · 其余十几处 | `grep -c` |
| Three.js 版本 | **r180**（2025） | `three.core.js` → `REVISION = '180'` |
| Three 用到的 addons | **仅 3 个**：`OrbitControls` / `RoomEnvironment` / `RoundedBoxGeometry` | `ls js/vendor/addons/` |

---

## 三、架构决策（我拍的板）

### 3.1 三层结构

```
js/
├─ core/ systems/ data/     ← 逻辑层（51,880 行，零 DOM）  【共享·只读】
├─ ui/                      ← UI 层（18,444 行，DOM 重度） 【共享·待改造】
└─ platform/                ← 平台适配层                 【分叉】
   ├─ taptap/ steam/        （已有）
   └─ wechat/               （新增：storage / 网络 / 广告 / 存档）
```

### 3.2 双构建目标（互不干扰）

| 构建 | 命令 | 产物 | 服务平台 |
|---|---|---|---|
| 现有 H5 | `tools/build-taptap-h5.mjs` **（不改）** | H5 包 | TapTap / Steam / Web |
| **新增** 微信 | `tools/build-wechat-minigame.mjs` **（新增）** | `D:\EVE-IDLE\WECHAT-MINIGAME\`（主包 + 2 分包） | 微信小游戏 |

微信产物目录 = **开发者工具项目根** = `D:\EVE-IDLE\WECHAT-MINIGAME\`
（全 ASCII · 工作区根 · 与 `TAPTAP-H5-OUTPUT` / `STEAM-OUTPUT` 同级 · **不在本仓库内 ⇒ 不污染 git、不影响现有封包**）

```
D:\EVE-IDLE\WECHAT-MINIGAME\
├─ game.js                  入口
├─ game.json                分包配置（subpackages: 3d / achievements）
├─ project.config.json      appid + 项目配置
├─ js/                      主包：逻辑层 + UI 层（terser 后）
├─ sub3d/                   分包：js/vendor + js/render3d
└─ subAchievements/         分包：assets/achievements
```

### 3.3 三个必须由探针回答的技术未知数

| 编号 | 未知数 | 为什么必须探 |
|---|---|---|
| **U1** | 逻辑层能否在**无 DOM** 环境跑通（Node 里 mock `wx`） | 决定「逻辑层真的一份都不用改」这个前提是否成立 |
| **U2** | Three.js **r180** 能否在小游戏里渲染（官方适配版锁 0.1080，**不可用**；候选：`@minisheep/three-platform-adapter` 支持 ≥0.151 / 自研 shim） | 决定 3D 保留方案是否成立 |
| **U3** | UI 层 1.8 万行 HTML+CSS 如何落到 Canvas | 决定总工作量是 20 人日还是 90 人日 |

---

## 四、阶段路线图

### 🔬 S-1「迁移可行性探针」← **建议立刻做**

> **目的不是做游戏，是花最小代价证伪 U1/U2/U3。**
> 每一项独立可回退，任何一项失败都能立刻改路线，沉没成本 < 2 人日。

| 任务号 | 内容 | 产出 | 估 | 状态 |
|---|---|---|---|---|
| **P1** | 逻辑层无 DOM 冒烟：Node 里 mock `wx` + 假 canvas，加载 `js/core` + `js/systems`，跑 `tick()` 1000 步不报错 | 探针脚本 + 报告 | 0.5 人日 | ✅ **完成（2026-09-13）** |
| **P2** | 3D 探针：three r180 + 适配层，在微信开发者工具里**渲染出一帧舰船**（先试 `@minisheep` 适配器，不行自研 shim） | 真机/模拟器截图 | 2 人日 | ✅ **完成（2026-09-13）** |
| **P3** | UI 探针：挑**最简单的 1 个页面**做 HTML→Canvas 端到端（建议从「设置页」或「仓库页」起，控件类型最少） | 可点按的 Canvas 页面 | 2–3 人日 | ✅ **完成（2026-09-13）** |
| **P4** | 打包探针：最小版 `build-wechat-minigame.mjs` + `game.json` 分包 + `cli preview --preview-info-output` | **官方真实包体积** | 1 人日 | ✅ **完成（2026-09-13）** |
| **P5** | 冻结基线圈：记录现有 TapTap/Steam 构建产物 SHA | SHA 清单 | 0.2 人日 | ✅ **完成（2026-09-13，`WECHAT_PROBE_P5_PLATFORM_BASELINE_v0.1.md`）** |

> ### ✅ P1 结果（2026-09-13，报告见 `WECHAT_PROBE_P1_LOGIC_SMOKE_v0.1.md`）
> **U1 已锁死**：逻辑层 **106/106 零改动加载**（提供一个约 40 行最小 DOM shim），
> 200 tick 零错误并真实产出矿石（71 个采集周期），离线结算 8h 无异常。
> 精确改造点只有 **2 处**（`translator.js:23` 的 `window.location`、`persistence.js` 顶层 IIFE 的 `document`），
> 且**都不需要改业务代码** —— shim 覆盖即可。原预估「149 处 document 逐个改造」不成立。
> 复现：`node D:/EVE-IDLE/wx-p1-tick-smoke.mjs --dom-shim --mining --offline`

> ### ✅ P3 结果（2026-09-13，报告见 `WECHAT_PROBE_P3_UI_CANVAS_v0.1.md`）
> **U3 已量化（中）**：设置页完成 HTML→Canvas 端到端移植，含开关 / 下拉浮层 / 滚动 / CJK 换行 / 富文本列表；
> 自研内核 **492 行（一次性）**，单页 **123 行**（DOM 版 188 行 ⇒ 0.65×）。
> ⭐ **最大利好 F1**：项目已有 **45 个 `get*DisplayState` 纯函数投影**（`selectors.js` 4,843 行）
> ⇒ 「数据→视图模型」不用重写，Canvas 端只替换「视图模型→像素」。
> ⚠️ **成本热点 F2**：`legion-render` / `alliance-render` / `wormhole-render` **0 处投影**，直读 `gameState`，迁前须补。
> 🔴 **F3/F4**：Font Awesome **87 图标 / 393 处全废**；CSS 6,501 行中 hover/media/transition **全部要手写**。
> ⚠️ **F5**：真实 i18n catalog 对设置页文案只覆盖 **13/40**（文案漂移 + 更新日志结构性不可译）—— **既有缺口，非迁移引入**。
> **全量 UI 估 42–65 人日**（允许视觉简化 30–45）；**S1 原型（3–4 页）8–12 人日**。
> **D1 建议 → 选项 B 自研内核**（官方 canvas-engine 需改写 264 处 innerHTML 模板，不划算）。
> 复现：`cd D:/EVE-IDLE/wx-p3-ui-probe && node render-node.mjs`（出 5 张 PNG）

> ### ✅ P4 结果（2026-09-13，报告见 `WECHAT_PROBE_P4_PACKAGE_SIZE_v0.1.md`）
> **R1（体积风险）已彻底关闭**：官方工具对真实内容出数为
> **main 2,689,445 B / 4MB（余量 36%）**· sub3d 1,028,168 B · subassets 9,895,221 B · TOTAL 13.0 MB / 30MB。
> ⭐ **体积口径钉死（此前一直算错）**：微信「代码包大小」= **未压缩原始字节和**，但 **JS 会被工具剥离注释/空白后再计**，
> 非 JS 资源（png/txt/ttf）**逐字节原样计入**。实测：370,020 B 纯注释 JS → 仅 +13 B；300,000 B txt → 精确 +300,000。
> ⭐ **`.woff2` 不进包**（400,000 B 探针 → 0 增长）⇒ **F3 图标字体必须用 `.ttf`**（已证 ttf 精确计入）。
> ⚠️ 新增硬约束：**微信小游戏每个分包 root 下必须有 `game.js`**（小程序无此要求），否则 compile 直接报错。
> ⚠️ 运维坑：IDE 文件索引有滞后，**构建完成后必须等 3~5 秒再 preview**，否则误报「文件未找到」。
> 复现：`node tools/build-wechat-minigame.mjs` → 等 5 秒 → `cli.bat preview --project "D:/EVE-IDLE/WECHAT-MINIGAME"`

> ### ✅ P2 结果（2026-09-13，报告见 `WECHAT_PROBE_P2_3D_AND_MODULE_SEMANTICS_v0.1.md`）
> **R17（three r180 无官方适配）已关闭 —— 不需要任何官方适配器**。全部生产路径零改动跑通：
> · `ShipFactory2` 生产舰船工厂 ✅（9 艘生产 id 全出图）· `createViewer`+`setShips`+rAF 循环 ✅（`readPixels` 覆盖 **99.3%**，逐帧变化）
> · `captureThumbnail` 生产缩略图 ✅（微信 `toDataURL("image/webp")` 真的产出 webp）
> · **泰坦 `TitanFactory` ✅（9 组合全出图，最高 77,844 三角形，单次 130–333 ms）** ⇒ **sub3d 分包技术可行**
> ⭐ **DOM shim 面实测只有 434 行 / 21,444 B**（含 `AbortController` polyfill）。
> 🔴 **硬约束**：three 自 r163 起**只支持 WebGL 2**（`webgl2` 上下文是硬判定，无降级空间）。
> ⚠️ **必踩坑**：`wx.createCanvas()` 的 `clientWidth/clientHeight` 是 own=false、hasSetter=false 的 accessor（恒 0），
> 直接赋值**抛异常**；`ship3d.js` 的渲染守卫 `if (canvas.clientWidth === 0) return` 会**静默不出帧** ⇒ 必须 `defineProperty` 遮蔽。
>
> ### ⭐⭐ P2 附带的最重要发现：**模块语义三定律**（推翻了原架构假设）
> 1. **`eval` 与 `new Function` 被完全禁用**（`typeof eval === "undefined"`；`Function` 存在但是桩）
>    ⇒ 若真要做「单作用域合并」，**只能是构建期文本级合并**，不可能运行时兑现。
> 2. **微信模块是「真函数作用域」**：最小实验（`st1/st2.js`）证明顶层 `function`/`var`/`const` **都不泄漏**，
>    `require()` 返回 `{}` 无键。⇒ **不是**浏览器经典 `<script>` 的共享词法环境。
> 3. 但项目靠**显式出口**活下来：**48 个 ES module**（IDE `es6:true` 转译，P2 实测 49 处说明符改写后全通）
>    + **92 个经典脚本但有 `window.X=X` / `module.exports` 出口**（因 **`window === GameGlobal`**，挂载在 require 下有效）。
>    我最初以为 `titans.js` 是「靠全局泄漏」，**实测是错的**——它尾部有完整的双模式出口（26 项 window + 29 项 module.exports）。
>
> ### ⚠️ **架构结论修正：不再需要「单作用域合并包」**
> 真正的风险面只有 **24 个「封死文件」**（既无 ES module 语法、又无全局出口），
> 其中 **16 个共 155 个名字**被外部按裸标识符消费。清单见 `D:/EVE-IDLE/wx-p2-out/s1-sealed-scan.json`。
> 最高频：`COMBAT_ZONES` 34× · `DEATHSPACE_DATABASE` 33× · `SMELTING_RECIPES` 30× · `addSkillXpToState` 21× · `PLANET_TYPES` 17×。
> 🔴 **危险特征是「静默」不是「崩溃」**：大量消费点写成 `typeof X === "undefined" ? fallback : X(...)`，
> 微信下会**一声不响地走 fallback**（战斗波次构建失败 / 冶炼配方算不出 / 装配折扣丢失）——
> 正是本项目已知的「真机常落在 fallback 分支」故障族。
> **修法（机械、低风险）**：给这 16 个文件各补一个双模式出口尾（与另外 92 个文件已有写法完全一致）。
> 浏览器侧 `window.X = X` 本来就是既成事实，显式赋值**不改变任何可观察行为**。
> **工作量重估**：原列为 S1 架构必改项的「单作用域合并包」**降级为 16 个文件的机械尾注 + 静态校验**。


- **准入**：你已安装微信开发者工具 + 提供小游戏 AppID ✅（AppID = `wx0b109424d84cc731`）
- **准出**：微信开发者工具里能打开项目 · 显示 1 个 Canvas 页面 ✅ · **3D 出一帧 ✅（含泰坦）** · **官方工具给出真实包体积 ✅**
- **工作量**：**5–7 人日**（P1 ✅ + P2 ✅ + P3 ✅ + P4 ✅ + **P5 ✅** ⇒ **S-1 探针阶段已全部完成**）
- **决策产出**：确定 U3 的 UI 策略（下面 §八 D1）+ 3D 保留程度（D3）

### 🎯 S1「最小可玩原型」（为过类目审核）

| 项 | 内容 |
|---|---|
| 目标 | 核心循环（采集 → 冶炼 → 制造 → 战斗）+ Canvas UI 骨架，**可提审** |
| 估 | 15–25 人日（沿用原计划） |
| 准出 | `cli upload` 出一个体验版；提审验证**类目是否放行** |
| 关键 | 这是**唯一能验证 R12 类目风险**的手段 |

### 🏗 S2「完整迁移」

| 项 | 内容 |
|---|---|
| 目标 | 全部系统 + 全部页面 + 广告接入 + 存档迁移 + 备案收尾 |
| 估 | 60–90 人日（分页分批，每批独立验收） |
| 前提 | S1 类目通过 |

---

## 五、Agent 职责边界（do-not-touch）

### ✅ 我可以做
- 写**新增文件**：`tools/build-wechat-minigame.mjs`、`js/platform/wechat/**`、`D:\EVE-IDLE\WECHAT-MINIGAME\**`（仓库外）、探针脚本、文档
- 在 Node/本地做验证与测量
- 跑微信 CLI 的**只读**命令（`preview` 等；体积旗标是 **`--preview-info-output`**，`--info-output` 是 `auto-preview`/`upload` 的别名）

### ⛔ 我不做（需你本人 / 需显式授权）
| 事项 | 原因 |
|---|---|
| 微信开发者工具登录、扫码、设备授权 | 你的账号凭证 |
| **任何 git commit / push** | 需你当次明确指令 |
| 微信后台提审、上传正式版 | 不可逆 + 影响外部用户 |
| 修改 `index.html`、`tools/build-taptap-h5.mjs`、逻辑层行为 | 违反硬约束 ① |
| 碰 TapTap portrait demo、冻结文件（`tick.js`/`offline.js`/`persistence.js`/`queue.js`/`events.js`/`render3d/**`） | 停止并报告 |

### 📌 每阶段收工门禁（三条，缺一不可）
1. **体积复测**：`node D:/EVE-IDLE/wx-size-audit.mjs --minify`，与基线比对
2. **零影响证明**：TapTap / Steam 构建产物 SHA 与 P5 基线**逐位相同**
3. **逻辑层回归**：现有 probe / 单测全绿

> 门禁全绿 **→ 停止并报告**，等你确认后再进下一阶段。

---

## 六、风险登记册

| 编号 | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | 主包 4MB | **低** ✅ | 已实测通过 |
| R2 | 存档单 key 1MB 上限，`eve_idle_save` 可能超限 | **高** | S-1 实测体积；超限则改 `wx.getFileSystemManager()` |
| R12 | 类目判定（个人主体不能选角色类） | **高** | S1 最小原型提审验证；或先在开放社区发帖问 |
| R15 | 名称/主体提交后锁死 | 中 | 已锁定 `深空放置边疆纪元`，不再变 |
| **R17** | ~~Three.js r180 无官方适配（官方版锁 0.108）~~ | ~~中~~ **✅ 关闭** | **P2 已实证不需要官方适配器**：three r180 零改动 + 自研 434 行 DOM shim，舰船工厂/查看器/缩略图/泰坦全部出图。备选 `@minisheep` 适配器未启用。**残留风险**→ 真机 WebGL 2 可用性需上线前单独验（three r163+ 无 WebGL 1 降级） |
| **R18** | UI 层 1.8 万行 HTML/CSS → Canvas 的转换策略未定 | **高** → **中** | ✅ P3 已量化：内核 492 行 + 单页 0.65× 系数；已有 45 个投影函数可复用 |
| R19 | 小游戏无 `localStorage` / `XMLHttpRequest` | 中 | `js/platform/wechat/` 提供 storage / 网络适配 |
| R20 | 广告 SDK（现有 `ad-provider-contract.js`）需接微信激励视频 | 中 | S2 阶段新增 `wechat-ad-provider` |
| **R21** | **模块作用域**：24 个「封死文件」（既无 ES module 语法、又无全局出口），其中 **16 个共 155 个名字**被外部裸标识符消费 | **高** → **中** | P2 已定位并给出机械修法：给这 16 个文件各补双模式出口尾。清单 `D:/EVE-IDLE/wx-p2-out/s1-sealed-scan.json`。<br>🔴 **危险特征是「静默」不是「崩溃」**——消费点多写成 `typeof X === "undefined" ? fallback : X(...)`，微信下会**一声不响走 fallback**（战斗波次 / 冶炼配方 / 装配折扣算错）。<br>⚠️ 验证纪律：不能只看「跑通没报错」，必须**逐名字断言 `window.<name> !== undefined`** |
| **R22** | three r163+ **无 WebGL 1 降级**，真机必须给 `webgl2` | 中 | P2 已在模拟器验 `webgl2` 可用；**上线前必须真机复验**（模拟器与真机 WebGL 实现可能不同） |

---

## 七、待你拍板的决策点

| 编号 | 问题 | 选项 | 我的建议 |
|---|---|---|---|
| **D1** | UI 层怎么迁？ | **A** 改用官方 `minigame-canvas-engine`（XML 模板 + style 对象，需逐处改写 UI 代码）<br>**B** 自研 Canvas 内核（UI 内核 492 行一次性；可复用现有 45 个投影函数与 i18n）<br>**C** 逐页用 Canvas 重写、不做内核（122 个 render 各自为政） | ✅ **已定：选 B 自研内核**（P3 已实证）。<br>A 被否：264 处 `innerHTML` 模板要改写成它的模板语法，省下的内核（492 行）远不及迁移成本；且只有 Flex 子集。<br>C 被否：每页重复实现布局/换行/命中。<br>配套：S1 只做 3–4 核心页；迁 legion/alliance/wormhole 前先补投影层（F2） |
| **D2** | 微信端 UI 允许和其它平台视觉不一致吗？ | 允许 / 不允许 | **建议允许**——追求 1:1 会把成本翻倍 |
| **D3** | 3D 在微信端是「全量保留」还是「降级保留」？ | 全量 / 降级（保留装配+战斗，泰坦锻造简化） | ✅ **建议定：全量保留**（P2 已实证）。<br>**不需要任何官方适配器**——`three r180` + 自研 434 行 shim 即可，生产三条路径（舰船工厂 / 查看器 / 缩略图）与**泰坦**全部零改动出图。<br>体积上 sub3d 只有 1.03 MB，**也没有砍的理由**。<br>🔴 唯一硬约束：three 自 r163 起**只支持 WebGL 2**，真机必须给 `webgl2`（无降级空间）。<br>⏳ 未验：本结论全部来自 IDE 模拟器，**真机 WebGL 实现需上线前单独验一次** |
| **D4** | 存档要不要上云（复用现有 CloudBase）？ | 要 / 先本地 | **先本地**，S2 再评估 |

---

## 八、立刻可执行的第一步

**S-1 探针阶段已全部走完**（P1 ✅ P2 ✅ P3 ✅ P4 ✅ **P5 ✅**；见 `WECHAT_PROBE_P{1,2,3,4,5}_*.v0.1.md`）。
前置条件你已全部提供：微信开发者工具 ✅ · AppID `wx0b109424d84cc731` ✅ · 服务端口已开 ✅。

**零影响门禁已就位**：`node tools/platform-baseline.mjs --check`（EXIT 0/1）机械复算 4 道门禁 / 19 项断言；
4 个反向臂已证明它**会失败**（`D:\EVE-IDLE\wx-p5-baseline\_neg\`）。
⚠️ 已知盲点：入包集是「跨平台并集」，看不见「Steam 有而 TapTap 没有」的文件（P5 报告 §九·遗留 2）。

### 下一步的两个岔口（等你拍板）

| 选项 | 内容 | 估 |
|---|---|---|
| **A · 补 R21** | 先给 16 个封死文件补双模式出口尾（机械改动 + 逐名字静态断言），把「静默走 fallback」这颗雷排掉，再动 S1 | 1–2 人日 |
| **B · 直接进 S1** | 开工最小可玩原型（3–4 页 Canvas UI + 3D 弹窗），R21 与 S1 并行 | S1 原型 8–12 人日 |

> **我的建议：先做 A**。理由——R21 的失败形态是**静默算错**（不报错），一旦埋进 S1 会被后续 UI 调试的噪声淹没，届时归因成本远高于现在 1–2 人日。
> 且 A 的改动**对 Steam/TapTap 零影响**（浏览器侧 `window.X = X` 本就是既成事实），可以独立验证、独立回退。

> ⚠️ 边界不变：P1–P5 与上表 A 全部**不产生任何对现有平台的改动**，随时可停可弃。

### 🔴 P5 顺带查出的线上真缺陷（独立于微信迁移，需单独决策）

`legion-nebula.png`（**2,848,164 B**）**从未被 git 跟踪**，却被 `legion-starmap-pure.html:11`
运行时加载，而该页由 `index.html:1191` 以 iframe 嵌入主游戏。
TapTap 发布走 `git archive <SHA>` ⇒ **未跟踪 = 不进包**：

- **TapTap**：rc44 → rc78 **共 72 个包无一带该文件** ⇒ 军团星图**一直缺少星云纹理层**
  （`drawBackground()` 用 `if(nebula.complete&&nebula.naturalWidth)` 守护 ⇒ **静默跳过，不报错**）；
- **Steam**：产物里**有**（17 个产物目录全含）⇒ Steam 侧正常。

细节见 `WECHAT_PROBE_P5_PLATFORM_BASELINE_v0.1.md` §八。

⭐⭐ **更要紧的是：`build-taptap-h5.mjs` 的四层漏打防护网（2026-09-12 成就图标事故后加的）对这一例三层同时失效**
—— ① 未 commit（`git archive` 拿不到）、② `isWhitelisted` 无规则匹配仓库根 `.png`、
④ **静态资源引用对账的正则盲区**：抽 token 的正则强制要求**至少含一段 `/`**，
而页面写的是**裸文件名** `'legion-nebula.png'` ⇒ 实测对真实行**零命中**
（写成 `'./legion-nebula.png'` 就会被捕获）。
⇒ 这不是某层疏忽，而是**「根目录 + 裸文件名引用」这一整类的共同盲区**，补完这一例同类还会再来。

**本轮未改**（修它必须改 ⛔ 冻结文件 `tools/build-taptap-h5.mjs`，且使 TapTap 包 +2.85 MB，属影响发布产物的决策）。
