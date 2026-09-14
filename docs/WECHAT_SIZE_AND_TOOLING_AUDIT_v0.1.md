# 微信小游戏体积测算与工具链调研 v0.1

> 日期：2026-09-13 · 仓库：`EVEIDLE-WORKBUDDY-FRESH` @ `main`（工作树有并行线改动，本次**未改动任何生产代码**）
> 目的：在动 UI 迁移代码之前，先用实测数字证伪/证实「主包 4MB」这条最高风险假设（计划 R1）

---

## 一、结论先行

| 问题 | 结论 |
|---|---|
| 主包 4MB 装得下吗？ | ✅ **装得下，而且余量很大**。即使把 CSS 也硬算进包（悲观口径，terser 后**未压缩**）也只 **3.31 MB**，余量 17%；实际小游戏无 DOM、CSS 不入包，则 **2.91 MB**，余量 27%；gzip 口径仅 **1.22 MB**，余量 70% |
| 3D（Three.js）要砍吗？ | ✅ **不用砍**。走分包即可，2.6 MB 且**单个普通分包不限大小** |
| 成就图 7.5MB 怎么办？ | ✅ 走分包，**单个普通分包不限大小**，一次放得下 |
| 总包超 30MB 吗？ | ✅ 不超。三包合计 ≈ **13 MB** |
| 体积这条风险还成立吗？ | ❌ **R1 从「高」降为「低」**。「先证伪最贵假设」已完成，**技术路线可以锁定** |

> 一句话：**体积不是障碍。真正的成本仍然只有 UI 重写（1.8 万行 DOM → Canvas）和 Three.js 的无 DOM 适配。**

---

## 二、体积测算（实测，非估算）

### 2.1 方法

1. 从 `index.html` 提取**真实引用的全部本地资源**（`<script src>` / `<link href>` / importmap 路径），共 **141 个**
2. 对其中 **132 个主包 JS** 逐个跑 **terser 5**（`compress.passes=2` + `mangle`）
3. 合并后分别计算 `gzip -9` 与 `brotli`（模拟代码包压缩）
4. 复现脚本：`D:\EVE-IDLE\wx-size-audit.mjs`（仓库外，不污染 git）

### 2.2 主包 JS 压缩结果

| 阶段 | 体积 | 说明 |
|---|---|---|
| 原始 | **4.92 MB** (5039 KB) | 132 个文件，未压缩源码 |
| terser 后 | **2.91 MB** (2983 KB) | **压缩率 40.8%**，0 个文件失败 |
| gzip -9 | **0.82 MB** (838 KB) | 代码包压缩估算 |
| brotli | **0.55 MB** (566 KB) | 仅供参考 |

### 2.3 主包预算（对照 4 MB 上限）

| 项 | terser 后（未压缩） | gzip 后 |
|---|---|---|
| JS 逻辑 + UI（132 文件） | 2.91 MB | 0.82 MB |
| CSS（5 文件） | 0.30 MB | 0.30 MB |
| assets 其它（2 文件） | 0.10 MB | 0.10 MB |
| **合计（硬算 CSS）** | **3.31 MB** | **1.22 MB** |
| 上限 | 4.00 MB | 4.00 MB |
| **余量** | **0.69 MB（17%）** | **2.78 MB（70%）** |

> 💡 **CSS 实际上不会入包**：小游戏没有 DOM，`css/*.css` 在迁移中会被改写成 Canvas 绘制代码。
> 剔除 CSS 后主包 JS 仅 **2.91 MB ⇒ 余量 27%**（未压缩口径）。
>
> ⚠️ 官方文档只写「主包不超过 4M」，未明示按压缩前还是压缩后计。
> **关键点：三种口径全部通过** —— 所以这条限制无论怎么算都不是问题。

### 2.4 主包 JS 体积 Top 15（原始 → terser）

| 原始 | terser | 文件 |
|---|---|---|
| 401 KB | 369 KB | `js/i18n/catalog-en.js` |
| 388 KB | 365 KB | `js/i18n/catalog-zh-TW.js` |
| 357 KB | 226 KB | `js/ui/shell-render.js` |
| 297 KB | 150 KB | `js/core/selectors.js` |
| 181 KB | 96 KB | `js/core/persistence.js` |
| 170 KB | 89 KB | `js/core/actions.js` |
| 119 KB | 51 KB | `js/systems/combat.js` |
| 116 KB | 45 KB | `js/systems/legion-combat-squad.js` |
| 114 KB | 55 KB | `js/systems/station.js` |
| 114 KB | 57 KB | `js/systems/legion-starmap-trial.js` |
| 108 KB | 63 KB | `js/ui/combat-render.js` |
| 103 KB | 32 KB | `js/systems/achievements.js` |
| 98 KB | 39 KB | `js/systems/offline-combat.js` |
| 89 KB | 40 KB | `js/systems/wormhole.js` |
| 89 KB | 37 KB | `js/core/offline.js` |

💡 **两条 i18n catalog（789 KB）是主包头号大户**，且 terser 几乎压不动（369+365 = 734 KB）。
若 S1 阶段只挂中文，可再省约 370 KB。**属于可选项，不建议一期就砍**（会破坏三平台同源）。

### 2.5 资产分布（进分包）

| 目录 | 体积 | 归属 |
|---|---|---|
| `assets/achievements/` | **7.5 MB** | 成就图分包 |
| `assets/vendor/` | 1.3 MB | 字体/fontawesome，待确认是否微信端需要 |
| `js/vendor/` | 2.1 MB | **3D 分包**（`three.core.js` 1.4M + `three.module.js` 607K + addons） |
| `js/render3d/` | 508 KB | **3D 分包**（shipfactory2 436K + titan 44K + ShipFactory.js 27K） |
| `css/` | 356 KB | ⚠️ **不直接入包**（小游戏无 DOM，须改 Canvas 绘制） |

---

## 三、官方硬约束（已核实原文）

来源：[小游戏 · 分包加载](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/subPackage/useSubPackage.html)

| 限制 | 数值 |
|---|---|
| 整个小游戏 **所有主包 + 分包** 总和 | **≤ 30 MB** |
| **主包** | **≤ 4 MB** |
| **单个普通分包** | **不限制大小** ⭐ |
| 单个独立分包 | ≤ 4 MB |

- 分包通过 `game.json` 的 `subpackages` 字段配置（`root` 可为目录或单个 js 文件）
- 未配置进 `subpackages` 的目录/文件，一律打进主包
- 加载 API：`wx.loadSubpackage()`（下载并执行）、`wx.preDownloadSubpackage()`（仅预下载，基础库 ≥ 3.4.9）
- ⛔ 开放数据域目录（`openDataContext`）不能设为分包

> ⭐ **「单个普通分包不限大小」这条是本次调研最有价值的一条**：成就图 7.5 MB、3D 2.6 MB 都可以各自整包放下，不需要拆分。

---

## 四、三包规划（基于实测）

| 包 | 内容 | 实测体积 | 上限 | 结论 |
|---|---|---|---|---|
| **主包** | 逻辑层 + UI 层（132 JS，terser 后） | **2.91 MB** | 4 MB | ✅ 余 27%（gzip 口径余 80%） |
| **分包 `3d`** | `js/vendor/**` + `js/render3d/**` | **2.6 MB** | 不限 | ✅ |
| **分包 `achievements`** | `assets/achievements/**` | **7.5 MB** | 不限 | ✅ |
| **合计** | — | **≈ 13 MB** | 30 MB | ✅ 余 17 MB |

---

## 五、官方工具清单（来自你给的 devtools 页面）

### 5.1 微信开发者工具本体

来源：[下载页](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html) · 页面用途：**公众号网页调试 + 小程序/小游戏调试**（同一工具）

| 通道 | 版本 | 日期 | 说明 |
|---|---|---|---|
| **稳定版 Stable** ⭐ | **2.02.2608070** | 2026/09/07 | **推荐**，Windows 64 可直接下载 |
| 预发布版 RC | 2.02.2608031 | 2026/08/03 | 含大特性，稳定性尚可 |
| 开发版 Nightly (Electron) | 2.02.2609102 | 2026/09/10 | 稳定性欠佳 |
| 历史版 1.05 | 1.05.2204250 | — | 最后一个支持 Windows 7 的系列 |

- 平台：Windows 7+（1.06 起不支持 Win7）· macOS x64 / ARM64
- 小游戏**不单独提供工具**，用同一个开发者工具（[小游戏下载页](https://developers.weixin.qq.com/minigame/dev/devtools/download.html) 直接指向小程序下载页）

### 5.2 ⭐ 命令行 CLI —— 本次最有用的工具

来源：[命令行调用](https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html)

- 位置：Windows `<安装路径>/cli.bat`
- 前置：**开发者工具 → 设置 → 安全设置 → 开启服务端口**
- 返回码：`0` 正常 / `-1` 错误

| 命令 | 作用 | 对本项目的价值 |
|---|---|---|
| `cli login` / `cli islogin` | 登录（二维码可输出 terminal / image / base64 / 文件） | 首次授权 |
| **`cli preview --project X --info-output info.json`** | 预览 | ⭐⭐ **`info.json` 直接给出真实「代码包大小 + 分包大小」** |
| **`cli auto-preview --project X --info-output info.json`** | 自动预览 | ⭐⭐ 同上，无需扫码占位 |
| **`cli upload --project X -v 1.0.0 -d "note" -i info.json`** | 上传代码 | ⭐⭐ 上传 + 输出真实包体积；也是将来提审的入口 |
| `cli auto --project X --auto-port 9420` | 开启自动化 | 可做端到端自动化测试 |
| `cli auto-replay** `|` `--replay-all` | 自动化测试窗口 / 回放用例 | 录制回放回归 |
| `cli open --project X [--pure-simulator]` | 打开项目 | `--pure-simulator` 支持小游戏纯模拟器模式 |
| `cli build-npm` / `cli cache --clean all` | 构建 npm / 清理缓存 | 排障 |
| `cli cloud env list` / `cloud functions deploy` 等 | 云开发管理 | 与现有 CloudBase 后端相关 |

### 5.3 miniprogram-ci（CI 流水线专用）

- 官方推荐：**不依赖开发者工具**、在自有业务工程流水线上做上传/预览
- 位置：[devtools/ci](https://developers.weixin.qq.com/miniprogram/dev/devtools/ci)
- 价值：将来把「微信包构建 + 体积门禁 + 上传」接进现有构建链（`tools/`）时用这个，而不是 CLI

---

## 六、⭐ 权威体积验证手段（本次最重要发现）

静态测算只能给量级，**真实包体积必须用官方工具测**：

```
cli preview --project <路径> --info-output <输出.json>
cli upload  --project <路径> -v <版本> -d "<备注>" -i <输出.json>
```

`info.json` 会包含**代码包大小、分包大小信息** ⇒ 直接作为发布门禁的「包体积断言」数据源。

**建议**：S1 阶段的第一件事就是拿一个空壳小游戏项目跑通 `cli preview --info-output`，
把这条通道打通，之后每次构建都能自动比对包体积（与现有「封包前 SHA 比对」同一思路）。

---

## 七、风险登记册更新

| 编号 | 原风险 | 原等级 | 更新后 | 依据 |
|---|---|---|---|---|
| **R1** | 主包 4MB 装不下 7.8M JS | **高** | **低** ✅ | 实测 terser 2.91 MB（含 CSS 3.31 MB）/ gzip 1.22 MB，**三种口径全部通过** |
| R2 | 存档单 key 1MB 上限，`eve_idle_save` 可能超限 | 高 | **高（未变）** | 本次未测；须实测存档体积 → `wx.getFileSystemManager()` |
| **R17（新）** | **小游戏无 DOM**，Three.js 需 `weapp-adapter` 垫片（canvas / Image / pointer 事件） | — | **中** | 3D 保留方案的必要前提，估 3–5 人日；需先做技术验证 |
| **R18（新）** | 分包「不限大小」的表述可能随版本变化 | — | **低** | 以官方文档当日口径为准，`cli` 实测复核 |

---

## 八、下一步

1. ~~主包体积可行性试算~~ ✅ **已完成，结论通过**
2. **安装微信开发者工具稳定版**（2.02.2608070）+ 后台建「小游戏」拿 AppID → 只有你能做
3. **3D 分包可行性验证**：搭最小 Three.js + `weapp-adapter` 跑通一帧舰船渲染（解 R17）
4. 打通 `cli preview --info-output` 体积门禁通道
5. 实测存档 `eve_idle_save` 体积（解 R2）

---

## 附：复现方式

```bash
# 仅清单抽取（枚举 index.html 真实引用并分类汇总）
node D:/EVE-IDLE/wx-size-audit.mjs

# 追加 terser 真实压缩 + gzip/brotli + 4MB 预算对照
node D:/EVE-IDLE/wx-size-audit.mjs --minify
```

- 脚本位置 `D:\EVE-IDLE\wx-size-audit.mjs`（**仓库外**，不进 git、不污染打包）
- 依赖 terser，已装于受管 node 工作区 `.../node/workspace/node_modules/terser`
- 环境变量 `WX_AUDIT_ROOT` 可覆盖被测仓库路径
- 每个阶段（S1 / S2）构建后应重跑，作为体积门禁
