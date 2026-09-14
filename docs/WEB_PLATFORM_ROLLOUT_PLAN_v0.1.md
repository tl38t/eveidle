# 多平台低成本发行方案 v0.1（itch.io + Google Play + PWA）

- 评估对象：EVE-IDLE《深空放置：边疆纪元》（`EVEIDLE-WORKBUDDY-FRESH`，`main`，HEAD `d34f38a`）
- 日期：2026-09-12
- 状态：**待确认**（本文档为方案设计，未改动任何生产代码）
- 关联：`docs/WECHAT_MIGRATION_PLAN_v0.1.md`（微信方案，本节目的替代/补充路线）

---

## 一、结论

| 项 | 结论 |
|---|---|
| 相对微信方案 | **UI 重写成本归零**（约 90 人日省掉），总投入从约 180 人日降到约 **30–40 人日** |
| 硬要求 1（不影响 Steam/TapTap） | ✅ 满足。三个新平台产物全部走独立构建器，现有两条管线零改动 |
| 硬要求 2（修 bug 一起修） | ✅ **100% 满足**。五个平台共用同一份 Web 代码，**UI 层也共用**（微信方案只能共用逻辑层） |
| 资质 | itch.io 零资质；PWA 国内仅需域名 ICP 备案（免费 7–20 天）；Google Play **不要软著 / 版号 / ICP / APP 备案**，仅 $25 一次性 |
| 建议节奏 | PWA 与 itch.io 并行（约 1 周）→ Google Play（约 3 周） |

**一句话**：这三个平台都是"把同一份网页换个壳发出去"，不需要改任何现有 UI 代码。

---

## 二、为什么这三个平台能省掉最大成本

```
                    同一份 Web 代码（index.html + js/ + css/ + assets/）
                                    │
        ┌───────────────┬───────────┼───────────┬───────────────┐
        │               │           │           │               │
     浏览器直开      PWA 壳      itch.io     Capacitor 壳     Electron 壳
        │           （加到桌面）   （iframe）   （Android）       （Steam）
     现有 Web      manifest+sw     ZIP 上传     Google Play      已上线
                                                                TapTap H5
```

关键点：**五个平台跑的都是同一个有 DOM 的浏览器环境**，所以逻辑层和 UI 层都是同一份代码。
这与微信小游戏（无 DOM，必须重写 UI 层）形成本质区别。

---

## 三、三个平台逐个方案

### 3.1 itch.io —— 最快，本周可上

| 项 | 内容 |
|---|---|
| 形态 | 上传 HTML5 ZIP，itch.io 用 iframe 嵌入，玩家浏览器直接玩 |
| 资质 | **零** |
| 上线 | 上传后几分钟，**无审核队列** |
| 收入 | 分成自设，默认 90% 归你。⚠️ HTML5 项目目前**只能收捐赠**，要定价售卖需把项目类型设为 Downloadable |
| 投入 | 约 2 人日 |

**适配性已实测通过（2026-09-12）**：

| 限制 | itch.io 要求 | 本项目 | 结论 |
|---|---|---|---|
| 文件数 | ≤ 1000 | **441** | ✅ |
| 总体积 | ≤ 500 MB | **约 17 MB** | ✅ |
| 单文件 | ≤ 200 MB | 最大 `three.core.js` 1.4 MB | ✅ |
| 路径 | 必须相对路径，禁 `/` 开头 | `index.html` 无绝对路径 | ✅ |
| 移动端 | 可选 Mobile Friendly | 已有 `viewport` + `taptap-portrait.css` | ✅ |
| 存档 | iframe 内 localStorage | 走 `itch.zone` 自身 origin，属第一方上下文 | ⚠️ 需真机实测 |

**待处理**：首屏 17 MB（其中 `assets/achievements` 7.5 MB）加载慢，建议成就图标改懒加载。
**注意**：itch.io 不自带流量，需要自己导量。

### 3.2 PWA —— 手机"添加到桌面"，近似 App 体验

| 项 | 内容 |
|---|---|
| 形态 | 现有站点加 `manifest.webmanifest` + Service Worker，手机浏览器"添加到主屏幕"后全屏运行 |
| 资质 | 国内需**域名 ICP 备案**（免费，7–20 工作日）；用海外域名/服务器可免 |
| 上线 | 部署即生效，无平台审核 |
| 投入 | 约 3 人日 |

**新增文件（全部新增，不改现有文件）**：
- `manifest.webmanifest` —— 名称、图标、主题色、`display: standalone`
- `sw.js` —— 预缓存核心 JS/CSS，运行时缓存资源
- `pwa/register.js` —— 注册 SW（需以 `<script>` 注入，会动 `index.html` 一行）

⚠️ **iOS 风险**：Safari 对 7 天未访问的 PWA 会清除本地存储。放置游戏重度依赖本地存档，需要用现有云存档能力（`js/platform/cloud-save-contract.js`）兜底，或提示用户定期打开。

### 3.3 Google Play —— 真实商店流量

| 项 | 内容 |
|---|---|
| 形态 | Capacitor 把现有 Web 产物包进 Android WebView，产出 AAB 上传 |
| 资质 | **不要软著、版号、ICP 备案、APP 备案、公安备案**。仅需 $25 一次性 + 政府 ID + 隐私政策 URL + IARC 内容分级 |
| 上线 | 2–4 周（含新个人账号强制的 **12 人 × 14 天封闭测试**） |
| 投入 | 约 10 人日 |
| 包体 | AAB 上限 200 MB，本项目约 17 MB，**完全不需要瘦身**（对比微信 4 MB 主包） |

**技术风险低的原因**：Steam 版已经是 Electron 壳（`electron/package-steam.cjs`），证明项目能在 WebView 环境正常运行。Capacitor 是同类方案，主要差异只在 Android 工具链。

**需处理**：
- 网络请求白名单：现网 5 处 `XMLHttpRequest`（云函数/联盟 API），Android 需配置网络安全策略与域名
- 广告合规：项目含广告系统，Google Play 需声明广告并遵守政策
- 存档：Capacitor 下 localStorage 可用；若要突破容量可用 `@capacitor/preferences`（Web 端自动降级到 localStorage）
- 需要 Android SDK / Gradle 环境

---

## 四、共用前置改造（一次改，三平台受益）

以下四项建议先做，做完三个平台同时受益：

| # | 改造 | 受益平台 | 说明 |
|---|---|---|---|
| 1 | **首屏加载优化**：成就图标 7.5 MB 改懒加载或 CDN | itch.io / PWA / Google Play | 17 MB → 目标 < 5 MB 首屏 |
| 2 | **离线缓存策略**（Service Worker） | PWA 必需，itch.io 与 Google Play 顺带提速 | — |
| 3 | **平台检测扩展** | 全部 | `js/platform/platform-runtime.js` 现有 `getPlatform()` 返回 `web`，三个新平台可统一复用 `"web"` 分支，**不需要新增分支** |
| 4 | **存档容量兜底** | PWA（iOS 7 天清理）、Google Play | 复用现有云存档契约 |

> 第 3 项是这套方案的隐性红利：因为都是 Web，平台抽象层**几乎不用动**。

---

## 五、如何满足两个硬要求

### 5.1 不影响 Steam / TapTap 封包

| 措施 | 说明 |
|---|---|
| 独立目录 | PWA 用 `pwa/`，Google Play 用 `capacitor/`，itch.io 用 `tools/build-itch-io.mjs` |
| 构建器隔离 | 新增 `tools/build-itch-io.mjs`，与现有 `build-taptap-h5.mjs`（TapTap）、`electron/package-steam.cjs`（Steam）完全并列，不改动后两者 |
| 排除规则 | 与微信方案同理：`build-taptap-h5.mjs` 需追加排除 `capacitor/`、`pwa/`（避免 `git archive` 把 Android 工程打进 TapTap 包） |
| 不碰 `index.html` 既有断言 | `tools/verify.mjs` 硬断言 script = 120 / CSS = 5。⚠️ PWA 的 `register.js` 若注入 `index.html` 会触发失败，需同步更新断言常量 |

**验收**：改动后重建 TapTap / Steam 包，比对 SHA-256 与字节数须与改动前一致。

### 5.2 修 bug 要一起修

| 平台组合 | 逻辑层 | UI 层 |
|---|---|---|
| Steam / TapTap / itch.io / PWA / Google Play | ✅ 共用 | ✅ **共用** |
| 微信小游戏（若将来做） | ✅ 共用 | ❌ 需重写 |

**这套方案下，"修 bug 一起修"是完全满足的**——五个平台跑同一份代码，不存在分叉。这是相对微信方案的最大优势。

---

## 六、工期与顺序

| 阶段 | 内容 | 投入 | 可并行 |
|---|---|---:|---|
| P1 | 共用前置改造（加载优化、离线缓存、排除规则） | 5–8 人日 | — |
| P2 | PWA（manifest + SW + 部署） | 3 人日 | 与 P3 并行 |
| P3 | itch.io 打包上传 | 2 人日 | 与 P2 并行 |
| P4 | Google Play（Capacitor 工程 + 封闭测试 14 天 + 提审） | 10 人日 | 与 P2/P3 后期并行 |
| **合计** | | **约 30–40 人日，日历时间约 4–6 周** | |

对比：微信小游戏约 180 人日 / 3–6 个月。**本方案约为其 1/5**。

---

## 七、风险登记册

| ID | 风险 | 等级 | 应对 |
|---|---|---|---|
| S1 | iOS PWA 7 天未访问清除本地存储，玩家丢档 | 高 | 云存档兜底 + 定期打开提示 |
| S2 | 首屏 17 MB 加载慢，网页端流失 | 中 | 成就图懒加载/CDN（P1 已列） |
| S3 | itch.io iframe 内 localStorage 行为 | 中 | 上线前真机实测存档读写 |
| S4 | TapTap 包被 `git archive` 吸入 `capacitor/`、`pwa/` | 中 | §5.1 排除规则 + SHA 比对验收 |
| S5 | `verify.mjs` script 计数断言被 PWA 注册脚本触发 | 中 | 同步更新断言常量，或改用 SW 内联注入避免新增 script |
| S6 | Google Play 新个人账号 **12 人 × 14 天**封闭测试（2024-12-11 起由 20 人下调为 12 人） | 中 | 提前招募 15–25 人留缓冲，与 P1–P3 并行跑 |
| S7 | Google Play 广告政策与项目现有广告系统 | 低 | 提审前核对政策，准备隐私政策页 |
| S8 | Android 网络域名白名单（云函数 5 处请求） | 低 | 配置网络安全策略 |
| S9 | itch.io HTML5 只能捐赠不能定价售卖 | 低 | 若要售卖，项目类型设为 Downloadable |

---

## 八、待你确认

| # | 问题 | 选项 |
|---|---|---|
| 1 | PWA 域名与备案 | A. 用海外域名（免备案，快）/ B. 国内域名 + ICP 备案（7–20 天，国内访问快） |
| 2 | Google Play 主体 | A. 个人账号（$25，需 **12 人 × 14 天**封闭测试）/ B. 企业账号（免封闭测试，需营业执照 + D-U-N-S） |
| 3 | 首屏优化是否并入 P1 | A. 并入（推荐，三平台同时受益）/ B. 先上线后再优化 |
| 4 | 微信小游戏 | A. 暂缓，本方案跑通后再评估 / B. 并行推进 / C. 取消 |

---

## 九、建议下一步

确认 §8 四个问题后：

1. **P1 先行**（5–8 人日）—— 这是三平台的共同地基，且完全不碰 UI。
2. **P3 先于 P2 出结果** —— itch.io 2 人日就能上线，先用最小成本把移动端验证跑起来。
3. **P4 的封闭测试尽早招募** —— 需 **12 名测试者连续 opt-in 满 14 天**（2024-12-11 由 20 人下调为 12 人），14 天是硬等待，可与 P1–P3 完全并行；建议招 **15–25 人**留缓冲，且必须是真人真机（模拟器与机器人会被检测拒）。

> 若后续仍要做微信小游戏，本方案的 P1（加载优化、离线缓存、存档兜底）同样是其前置，不会白做。


---

## 十、广告变现方案（2026-09-13 补充）

### 10.1 核心结论：两条不同技术栈，不可混用

| 平台 | 广告 SDK | 原因 |
|---|---|---|
| Google Play（Capacitor 原生壳） | **AdMob 原生 SDK**（经 Capacitor 插件桥接） | 原生 app 内禁止使用 AdSense for Content，Google 政策红线 |
| itch.io / PWA（纯 Web） | **H5 网页广告 SDK**（AdSense H5 Games Ads / Playgama / AppLixir） | 无原生环境，AdMob SDK 不可用 |
| TapTap（现状） | Dirichlet 推广位 1054324（竖屏） | 已配置，保持不动 |

**架构红利**：项目已有 `js/platform/ad-provider-contract.js` 契约 + `ad-platform-config.js` 映射，新增两个 provider 即可，**上层 `ad-buff.js` / `ad-service.js` 零改动**。

### 10.2 政策红线（已核实）

**itch.io 官方 Quality Guidelines**：
> "We prefer to see projects that have no advertisements... please don't make them obtrusive or misleading. Avoid... ads that prevent someone from playing the game without performing some action."

- 允许，但**不鼓励**；禁止侵扰、误导、**用广告阻挡游戏**
- 项目现有形态（**仅激励视频、玩家主动点击、可选观看**）**完全符合**
- ⚠️ 需在游戏页**明确声明含广告**
- ⚠️ 技术待验证：itch.io 的 H5 跑在 iframe 内，第三方 cookie 受限可能压低 eCPM，需真机实测

**Google Play**：
- 2025-01 起强制 **app-ads.txt**（缺则填充率显著下降）
- 2024-01 起强制 **Google 认证 CMP（UMP / TCF 2.2）**；缺 consent 在 EEA/UK 停投个性化广告，**eCPM 降 40–60%**，缺失 consent 整体砍 60–80%
- Data Safety 表单须与广告 SDK 实际采集一致（Google 会扫二进制比对，不符可致下架）
- 内容分级问卷须如实勾选「含广告」

### 10.3 收入模型（2026 eCPM 基准）

Rewarded video eCPM：Tier1（US/UK/CA/AU/JP）$14–22（取 18）；全球均 $3–8（取 5）；Tier3 $2–3（取 2.5）。

ARPDAU（美元）＝ 每日观看次数 × eCPM ÷ 1000

| 每日观看次数 | Tier1 | 全球均 | Tier3 |
|---:|---:|---:|---:|
| 3 | 0.054 | 0.015 | 0.0075 |
| 5 | 0.090 | 0.025 | 0.0125 |
| 10 | 0.180 | 0.050 | 0.025 |
| 20（项目上限） | 0.360 | 0.100 | 0.050 |

月收入（30 天，美元）

| DAU | 5 次/日·全球均 | 5 次/日·Tier1 | 10 次/日·Tier1 |
|---:|---:|---:|---:|
| 1,000 | 750 | 2,700 | 5,400 |
| 5,000 | 3,750 | 13,500 | 27,000 |
| 10,000 | 7,500 | 27,000 | 54,000 |

**判据：收入几乎完全由 DAU 决定，与平台选择关系不大。** itch.io 自身流量极小 ⇒ 单独挂 itch.io 广告收入接近零；要赚钱必须靠 **Google Play 商店流量** 或 **CrazyGames / Poki 门户流量**（后者广告分成 50–60%）。

### 10.4 项目现状缺口

| 项 | 现状 | 影响 |
|---|---|---|
| 广告形式 | **仅 rewarded 1 个广告位** | 上限受限；无 interstitial / app-open，损失主要增量 |
| 频次 | 共享池 20 次/日 + 60s 最小间隔 | 已合理，无需改 |
| 广告 buff | ×1.3 独立乘区 / 30 分钟 | 激励强度偏保守，可 A/B 测试 |
| 广告位 ID | 仅 TapTap（1054324 / 1054323） | 需新增 AdMob ad unit + H5 广告位 |

**增量建议（按性价比）**：① 加 interstitial（关卡/星系切换时，Tier1 eCPM $9–14）② 加 app-open（回到前台，$4–8）③ 接 mediation（+20–40% eCPM）④ 提高 rewarded 激励强度。

> ⚠️ 以上均为方案层结论，**尚未改动任何生产代码**。
