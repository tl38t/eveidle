# 微信小游戏 P4 探针报告 —— 打包与真实体积

- **日期**：2026-09-13
- **探针目标**：用官方工具链拿到**真实包体积**，验证「主包 4MB」是否成立，并打通 `build → preview` 闭环
- **结论**：**✅ 通过。主包 2.56 MB / 4MB，余量 36%。R1（体积风险）彻底关闭。**
- **前置**：P1（逻辑层 ✅）、P3（UI ✅）；用户已开开发者工具服务端口
- **边界**：零生产代码改动。新增仅 `tools/build-wechat-minigame.mjs`、`tools/wechat/shim.js`（仓库内，未 commit）；
  产物落 `D:\EVE-IDLE\WECHAT-MINIGAME`（仓库外）。`index.html` / `build-taptap-h5.mjs` / 逻辑层**一字未动**。

---

## 一、官方真实体积（唯一权威数字）

```
┌─────────────┬─────────────┬─────────────┐
│ (index)     │ size        │ size (Byte) │
├─────────────┼─────────────┼─────────────┤
│ TOTAL       │ '13.0 MB'   │ 13612834    │
│ main        │ '2.6 MB'    │ 2689445     │
│ /sub3d/     │ '1004.1 KB' │ 1028168     │
│ /subassets/ │ '9.4 MB'    │ 9895221     │
└─────────────┴─────────────┴─────────────┘
```

| 包 | 落盘原始字节 | 官方计费字节 | 比值 | 上限 | 余量 |
|---|---|---|---|---|---|
| **main** | 5,232,448 | **2,689,445** | 51.4% | 4 MB | **+1,505,379 B（36%）** |
| sub3d | 2,564,586 | 1,028,168 | 40.1% | 不限 | — |
| subassets | 10,390,449 | 9,895,221 | 95.2% | 不限 | — |
| 合计 | 18,187,483 | **13,612,834** | — | 30 MB | +17.9 MB |

> 主包内容 = `js/**`（135 个，排除 `js/vendor` `js/render3d`）+ `wx/shim.js` + `wx/boot.js` + `game.js` + `game.json`。

---

## 二、⭐ 体积口径（本轮最大收获：此前一直算错）

### 三条判据（全部由探针实测，非文档推断）

| # | 判据 | 探针 | 实测增量 | 结论 |
|---|---|---|---|---|
| A | **非 JS 资源逐字节原样计入** | `_probe_pad.txt` 300,000 B | **+300,000** | 精确 1:1 |
| B | **JS 会被工具剥离注释/空白后再计** | `_probe_pad.js` 370,020 B（全注释） | **+13** | 370,020 → 13 |
| C | **`.woff2` 不进包** | `_probe_d.woff2` 400,000 B | **±0** | 完全不计 |
| D | `.ttf` 计入 | `_probe_b.ttf` 400,000 B | +400,000 | 精确 1:1 |
| E | PNG 原样，不重编码 | `_probe_c.png` 321,841 B（含 300,000 B 尾部填充） | +321,841 | 不重编码 |
| F | 早期在 demo 包复验 A | 2,000,000 B 纯文本 | +2,000,000 | 口径一致 |

### ⇒ 正确口径

> **微信「代码包大小」= 未压缩原始字节和（不是 gzip、不是 zip）；
> 其中 JS 类文件会被工具做「注释/空白剥离 + 混淆」后再计，非 JS 资源原样计入。**

**这意味着：**
1. 之前报告里的 `gzip 1.22 MB / 余量 70%` **是错的乐观估算**，不能作为依据。
2. 之前的 `terser 2.91 MB`（我本地跑 terser）**偏保守**——官方工具压得比它更狠（2.69 MB，还多含 3 个文件 + shim + 入口）。
3. `project.config.json` 的 `setting.minified` / `setting.es6` **不影响 preview 报出的体积**——实测把两者置 `false` 后数字**逐字节不变**（2,689,445）。
   ⇒ 推测该设置只作用于 `upload`。**保守做法：构建脚本强制保持 `minified: true`。**

---

## 三、试出来的硬约束（踩坑记录，S1 必须遵守）

### 3.1 ⚠️ 微信小游戏**每个分包 root 下必须有 `game.js`**（小程序无此要求）

首次 preview 直接 compile 失败：
```
code: 10, Error: game.json: 未找到 ["subpackages"][0]["root"] 对应的 /sub3d/game.js 文件
```
反编译工具校验逻辑（`app.asar → corecompiler/original/json/game.js`）确认为字面检查：
```js
const t = path.posix.join(i.root, "./game.js");
const c = a.stat(e, t);
if (!(c && c.isFile)) r.push(CORRESPONDING_FILE_NOT_FOUND...)
```
→ 构建脚本已自动为每个分包写一个入口占位 `game.js`。

### 3.2 ⚠️ IDE 文件索引有滞后：**构建完必须等 3~5 秒再 preview**

文件明明已落盘、`ls` 可见，preview 仍报「文件未找到」；等几分钟后重跑即通过。
⇒ 构建脚本已在收尾打印该提示。

### 3.3 体积旗标名（纠正早前文档）

CLI 源码 `resources/app.asar.unpacked/js/common/cli/index.js` 实测：

| 子命令 | 正确旗标 |
|---|---|
| `preview` | **`--preview-info-output <path>`** |
| `upload` | `--upload-info-output <path>` |
| `auto-preview` / `upload` 兼容别名 | `--info-output <path>` |

三者 describe 一致：*"Output path of extra information generated during preview, such as package size including subpackages. Output format is JSON"*。

### 3.4 `--preview-info-output` 未落盘（遗留）

传了该旗标，preview 成功、QR 出图，但**目标 JSON 文件未被写入**（全盘搜索无果）。
体积表由 CLI 直接打到 **stdout**（`console.table`），本轮即以 stdout 为数据源。属遗留项，不影响结论。

---

## 四、分包切法（构建脚本唯一真值）

```
WECHAT-MINIGAME/            ← 仓库外，与 TAPTAP-H5-OUTPUT / STEAM-OUTPUT 同级
├── game.js                 ← 入口：require shim → require boot
├── game.json               ← subpackages: sub3d / subassets
├── wx/shim.js              ← DOM shim（依据 P1 结论，约 250 行，含 F6 要求的 getAttribute/setAttribute）
├── wx/boot.js              ← 自动生成：按 index.html 顺序 require 全部主包脚本
├── js/**                   ← 主包（自动排除 vendor / render3d）
├── sub3d/    js/vendor/**  + js/render3d/**  + game.js
└── subassets/ assets/**    + demo-assets/**  + game.js
```

清单抽取策略：**`index.html` 有序脚本为准 + 目录扫描兜底**（不可只用静态清单，见 §五）。

---

## 五、🔴 发现的资源漏算（此前审计过不了关）

| 文件 | 大小 | 加载方式 | 影响 |
|---|---|---|---|
| `demo-assets/wormhole-map-bg.png` | **1,927,769 B** | `js/ui/wormhole-map.js:34` 运行时按名加载 | 早期基于 `index.html` 的审计**完全漏算 1.84 MB** |
| `js/ui/ship3d.js` | — | `import("./ship3d.js")` 动态导入 | 静态清单会漏 |
| `js/vendor/three.core.js` | 1,462,228 B | 被 `three.module.js` 内部引用 | 静态清单会漏（`index.html` 只写了 `three.module.js`） |

⇒ **教训：微信打包必须按目录扫，不能只按 `index.html` 引用清单。** 构建脚本已改为「静态清单 + 目录兜底」。

⚠️ 同时注意：`wormhole-map-bg.png` 若误放主包，主包将变成 `2,689,445 + 1,927,769 = 4,617,214 B > 4MB` **直接超限**。当前已归入 `subassets`。

---

## 六、对后续决策的直接影响

| 决策/风险 | 本轮结论 |
|---|---|
| **R1 主包 4MB** | **关闭**。2.56 MB / 4MB，余量 36%，且这已是**含全部 3D 除外层 + 全部 i18n 目录**的完整内容 |
| **D3（3D 保留程度）** | 3D 分包仅 **1.03 MB**，体积**不再构成砍 3D 的理由** ⇒ 建议按**全量保留**推进，唯一变量只剩 P2 的技术可行性 |
| **F3（Font Awesome 87 图标）** | 🔴 **`.woff2` 不进包** ⇒ 图标字体方案**只能走 `.ttf`**（已证计入）或纯矢量绘制。另注：现有 `assets/vendor/taptap-h5` 共 1,216,476 B（FA 字体 + TapTap 专用），WeChat 端大半是死重，S1 可裁 |
| **S1 架构** | 主包 **必须改成「单作用域合并包」**：浏览器 `<script>` 共享全局词法环境，P4 探针的逐文件 `require`（各自独立作用域）会隔离顶层 `const/let`，跨文件引用会断 |

---

## 七、遗留项（不影响结论，交 S1 / P5）

1. `subassets` 差额 495,228 B —— **P5 已收口**：
   `.woff2` 合计 **391,216**（探针确证不进包）+ 两个 CSS 合计 **103,882**（不计入）
   = **495,098**，**残差 130 B**。
   量级 **≤ 单个自动生成占位文件 `subassets/game.js`（161 B）**，落在「占位文件是否计入 / 单文件粒度」之内，
   **对任何决策无影响**（最近门槛 4 MB，差 3 个数量级）。核算表见 P5 报告 §九·遗留 1。
2. `--preview-info-output` 不落盘（§3.4）。
3. ⚠️ `build-wechat-minigame.mjs` **自身 stdout 的体积表不是微信口径**（它按磁盘原始字节算，JS 未剥离注释）
   ⇒ 会把主包虚报成 5.0 MB（官方 2.69 MB）。**P5 已加显式警示行**，权威数字只能来自 `cli preview`。
3 `js/qa-seed.js` / `js/ship-lab.js` / `js/three-demo.js` 共 ~44 KB 是否为开发专用、能否从主包剔除，待 S1 定。

---

## 八、复现步骤

```bash
# 1. 构建（输出到仓库外，含分包与 shim）
node tools/build-wechat-minigame.mjs

# 2. 必须等 3~5 秒（IDE 文件索引滞后），否则误报「文件未找到」
sleep 5

# 3. 出官方体积（旗标名不是 --info-output）
"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" preview \
  --project "D:/EVE-IDLE/WECHAT-MINIGAME" \
  --preview-info-output "D:/EVE-IDLE/wx-p4-out/info.json"
```

**前置**：开发者工具稳定版 2.02.2608070 已打开该项目，且 **设置 → 安全设置 → 服务端口 已开**（本轮实测端口 `127.0.0.1:46070`）。
`cli.bat islogin` 返回 `{"login":true}` 即为通路。

---

## 九、下一步

- **P2**（3D 探针，2 人日）：three r180 + WebGL 在无 DOM 环境出帧。**唯一剩下的高技术未知数**。
- **P5**（冻结基线 0.2 人日）：记录 TapTap / Steam 现有构建产物 SHA，作为「零影响证明」的比对基线。
