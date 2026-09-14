# 微信小游戏迁移 · P2 探针报告：3D 层与模块语义
## WeChat MiniGame Migration — Probe P2: 3D Layer & Module Semantics

- 日期：2026-09-13
- 工具链：微信开发者工具 **稳定版 2.02.2608070** + CLI（服务端口 `127.0.0.1:46070`，`islogin → {"login":true}`）
- 运行环境：IDE 模拟器（`WeappSimulator`）
- 探针工程：`D:\EVE-IDLE\wx-p2-3d-probe\`（**仓库外**，58 个文件 / 2,780,885 B）
- 准备脚本：`D:\EVE-IDLE\wx-p2-tools\prep.mjs`（把生产代码搬入并改写裸说明符）
- 报告数据源：`D:\EVE-IDLE\wx-p2-out\p2-report{3..9}.json` + `p2-*.webp`
- 仓库改动：**零**。`js/**` / `index.html` / `tools/build-taptap-h5.mjs` 未被触碰（见 §7 归属核对）

---

## 0. 结论摘要

| 问题 | 判定 | 证据 |
|---|---|---|
| 微信运行时有没有 WebGL？ | ✅ **有**，`webgl2` 可用，`glError=0` | report3 绕过 three 裸测 |
| three **r180** 能不能跑？ | ✅ **能**，零改动加载并出帧 | report4/6/7/8 |
| 生产舰船工厂（`ShipFactory2`）能不能出图？ | ✅ 能，9 艘生产 id 全出图 | report7 |
| 生产查看器（`createViewer` + `setShips` + rAF 循环）？ | ✅ 能，`readPixels` 覆盖 **99.3%**，逐帧变化 | report6 |
| 生产缩略图（`captureThumbnail`）？ | ✅ 能，真 webp | report4/7 |
| **泰坦**（`TitanFactory`，sub3d 分包主体）？ | ✅ 能，9 个组合全出图，最高 77,844 三角形 | report8 |
| DOM shim 面有多大？ | 实测 **434 行 / 21,444 B** | `wx-dom-shim.js` |
| 主包能不能逐文件 `require`？ | ⚠️ **部分不能** —— 24 个「封死」文件，其中 16 个共 **155 个名字**被外部裸引用 | report9 + `s1-sealed-scan.json` |

**一句话**：3D 层在微信里**零改动可行**（P2 通过，D3 可定「全量保留」）；但架构上必须补一处——**24 个既无 ES module 语法、又无全局挂载出口的文件**，它们被跨文件按裸标识符消费，在微信下会**静默走 fallback 分支**（不报错）。

---

## 1. 探针方法：观测通道

微信小游戏**没有 console 回传通道**，探针结果必须自己落盘。实测有效路径（本报告全部数据的来源）：

```
运行时 wx.env.USER_DATA_PATH  →  真实磁盘
C:\Users\Administrator\AppData\Local\微信开发者工具\
  User Data\2ca4252ffa87560ea1fd48b913e45179\
  WeappSimulator\WeappFileSystem\o6zAJs-Y3Uisual1921pQDixqgGI\
  wx0b109424d84cc731\usr\
```

关键设计（第 1 版探针踩过坑）：

- **每步增量落盘**：`step()` 内部立即 `writeFileSync` + `setStorageSync`。第 1 版把报告攒到最后一次性写，结果异步导出那步挂掉 ⇒ **整个报告连同已成功的步骤全部丢失**，只剩编译缓存里能搜到源码。
- **`require` 的路径是相对路径字符串**，不需要 `?v=`（微信没有 URL 语义，带 query 会当成不存在的文件名）。
- **IDE 文件索引滞后 3~5 秒**：文件已落盘、`ls` 可见，编译仍报「文件未找到」。

---

## 2. WebGL 与 three r180

### 2.1 先绕开 three 裸测 WebGL（解耦两个问题）

第 2 阶段先用 `wx.createCanvas()` 直接取 `webgl2` 上下文画三角形，确认宿主能力：

| 项 | 结果 |
|---|---|
| `getContext("webgl2")` | ✅ 可用 |
| 着色器编译 / 程序链接 | ✅ 通过 |
| `glError` | **0** |
| 读回像素 | 三角形实际写入，非背景像素可测 |

### 2.2 three r180 的环境依赖面

| 文件 | 字节 | REVISION |
|---|---|---|
| `js/vendor/three.core.js` | 1,462,228 | **180** |
| `js/vendor/three.module.js` | 621,364 | 180 |

实测依赖（与 shim 面直接对应）：

- **`WebGL2RenderingContext` 是硬判定**：three 自 r163 起**移除 WebGL 1 支持**（内部报错文案 `WebGL 1 is not supported since r163`）。⇒ 真机必须给 WebGL 2，无降级空间。
- `document.createElementNS`：three 用它创建 canvas（three 侧唯一必需 DOM 能力）。
- `AbortController` / `AbortSignal`：`typeof` 有守卫但**实际会用到**，必须 polyfill（25 行够）。
- `navigator` / `performance` / `requestAnimationFrame`：微信**自带**，无需 shim。
- `devicePixelRatio = 1`。

### 2.3 DOM shim 实测面

`wx-dom-shim.js` = **434 行 / 21,444 B**。逐项实测结论：

| API | 微信原生 | 处理方式 |
|---|---|---|
| `window` / `GameGlobal` | ✅ **`window === GameGlobal` 成立**，`ctor` 都为 `Window` | 无需创建 |
| `document` | ✅ 存在（`#<HTMLDocument>`），**`document` 是 own+non-writable** | 只能改属性，不能整体赋值 |
| `createElement` | ✅ 函数 | `assign` 覆盖 |
| `createElementNS` | ❌ `typeof === "undefined"`（own 属性但值为 undefined） | `defineProperty(own)` |
| `AbortController` / `AbortSignal` | ❌ 均 undefined | 自写 polyfill |
| `navigator` / `requestAnimationFrame` / `performance` | ✅ 已有 | 不动 |
| `matchMedia` / `getComputedStyle` | ❌ | 打桩 |
| `window.top` | ⚠️ **赋值失败**（不可写） | 放弃（three 不使用） |
| **`canvas.clientWidth` / `clientHeight`** | ❌ **own=false、hasSetter=false 的 accessor，恒 0，直接赋值抛异常** | **必须 `defineProperty` 遮蔽** ← 关键坑 |

> ⭐ `clientWidth` 这条是真机必踩的坑，详见 §5.1。

---

## 3. 生产 3D 路径出图

### 3.1 舰船工厂（`ShipFactory2`，第 3 阶段）

`Ship3D.buildSpecForShip(id)` → `buildShip(spec)` → `renderer.render()`：

| 舰船 | mesh 数 | 三角形 | 像素覆盖率 | glError |
|---|---|---|---|---|
| battleship | 268 | 43,000+ | ~50% | 0 |
| angel | 259 | — | ~34% | 0 |
| industrial | 124 | — | — | 0 |
| frigate | 114 | — | — | 0 |

覆盖率口径为 `getImageData` 的「非背景像素 / 总像素」，证明**真的画了**而不只是「跑通没报错」。

### 3.2 生产查看器（`createViewer` + `setShips`，第 6 阶段）

这条是**游戏主面板实际走的路径**（`ship3d.js` 的 `autoFit` + rAF 渲染循环）：

| 项 | 结果 |
|---|---|
| `createViewer(canvas, opts)` | ✅ handle 成功 |
| `setShips` | ✅ 模型构建成功 |
| rAF 循环 | ✅ **持续出帧**：9 轮 webp 长度 11871 → 12187（**逐帧不同** ⇒ 真的在旋转） |
| `readPixels` 非背景像素 | **260,277 / 262,144 = 99.3%** |
| renderer 创建次数 | 1（无重复创建泄漏） |
| `dispose()` | ok |

### 3.3 生产缩略图（`captureThumbnail`，第 4/7 阶段）

`captureThumbnail(spec)` 内部走 `preserveDrawingBuffer: true` + `canvas.toDataURL("image/webp", 0.85)`：

- ✅ **微信的 `toDataURL("image/webp")` 真的产出 webp**（magic `RIFF`）。
- ✅ 生产元数据齐全：金属 PBR 船体、发光航行灯、星野、面板线、金色饰边。
- ✅ **9 艘生产舰船 id 全出图**（`rookie_corvette` / `rifter` / `kestrel` / `riftbreaker` / `arbiter` / `miner_frigate` / `orca` / `heron` / `illuminator`）。

⚠️ **一个既有产品行为，不是迁移问题**：`captureThumbnail` 用**固定相机**，而 `buildModel` 不做尺寸归一化 ⇒ 超大舰体（如 `arbiter`，输出仅 1,094 B ≈ 全空白）相机会落进船体内部。这是纯 three.js 数学，与宿主无关。泰坦走的是 `buildTitanModel`，它有 `TITAN_MODEL_TARGET = 15` 的归一化，所以泰坦反而正常。

### 3.4 泰坦路径（`TitanFactory`，第 8 阶段）

`js/render3d/titan/TitanFactory.js`（41,856 B）**零 DOM 依赖**，纯 three 几何程序化建模。3 舰体 × 3 武器 × 3 核心 的代表性切片：

| # | 组合（hull/weapon/core） | mesh | 三角形 | 顶点 | 建模+出图 |
|---|---|---|---|---|---|
| 0 | aegis / laser / blue | 265 | 35,172 | 27,635 | 295 ms |
| 1 | aegis / missile / red | 399 | 74,828 | 54,242 | 221 ms |
| 2 | aegis / cannon / violet | 313 | 55,932 | 40,806 | 249 ms |
| 3 | bulwark / laser / red | 365 | 40,580 | 32,505 | 285 ms |
| 4 | bulwark / missile / violet | **524** | **77,844** | 58,322 | 235 ms |
| 5 | bulwark / cannon / blue | 376 | 51,852 | 38,699 | 130 ms |
| 6 | keelbreaker / laser / violet | 318 | 36,956 | 33,556 | 141 ms |
| 7 | keelbreaker / missile / blue | 415 | 67,124 | 53,186 | 333 ms |
| 8 | keelbreaker / cannon / red | 304 | 50,620 | 40,540 | 136 ms |

**9/9 成功，0 错误**。视觉分支（shield / armor / structure 三种舰体 × laser / missile / cannon 三种武器 × blue / red / violet 三种核心）在出图中均正确呈现。

> ⇒ **sub3d 分包在技术上可行**，体积也已实测只有 1.03 MB。**D3 建议定「全量保留 3D」**。

---

## 4. ⭐ 模块语义三定律（本次最有价值的发现）

第 8 阶段出现一个反直觉现象：`window.getTitanVisualSpec` 在我手动注入**之前**就已经是函数。为判定真伪，做了**不掺任何项目代码**的最小实验（`st1.js` / `st2.js`）后得到三条硬事实：

### 定律 1：`eval` 与 `new Function` **被完全禁用**

```
typeof eval          = "undefined"
typeof Function      = "function"      ← 存在，但是桩
eval("1+1")          → throw: eval is not a function
(new Function("return 1+1"))() → throw: (intermediate value) is not a function
```

**影响**：S1 的「单作用域合并」**不可能用运行时动态求值兑现**。若真要做合并，只能是**构建期文本级合并**（剥掉 `import`/`export` 关键字再拼接）。

### 定律 2：模块是**真函数作用域**，不泄漏

最小实验（`st1.js` 声明 `function` / `var` / `const`，`st2.js` 在 `require` 前后各取一次快照）：

| 快照 | `window.stFn` | `window.ST_VAR` | `window.ST_CONST` | 裸 `stFn` | 裸 `ST_VAR` | 裸 `ST_CONST` |
|---|---|---|---|---|---|---|
| require 之前 | undefined | undefined | undefined | undefined | undefined | undefined |
| require 之后 | **undefined** | **undefined** | **undefined** | **undefined** | **undefined** | **undefined** |
| `require()` 返回 | `{}`（**无键**） | | | | | |

⇒ 微信**不是**浏览器经典 `<script>` 的共享词法环境。**逐文件 `require` 隔离顶层声明**——这条确认了我此前的判断方向是对的。

### 定律 3：但项目真身靠**显式出口**活下来，且 `es6: true` 会处理 ES module

| 制式 | 文件数 | 微信下能否工作 | 机制 |
|---|---|---|---|
| **甲 · ES module**（`import` / `export`） | **48** | ✅ | IDE 编译器 `es6: true` 转译（P2 实测：49 处裸说明符改写后 3D 层**全通**） |
| **乙 · 经典脚本 + 显式出口** | **92** | ✅ | `window === GameGlobal` ⇒ `window.X = X` 有效；`module.exports` 亦有效 |
| **丙 · 真封死**（既无 ESM 也无出口） | **24** | ⚠️ **部分失效** | 顶层声明对外不可见 |

我自己那个「titans.js 靠全局泄漏」的假设是**错的**——实测它是一份**双模式文件**，尾部同时有：

```js
if (typeof window !== "undefined") { window.TITAN_HULLS = TITAN_HULLS; /* ...26 项... */ }
if (typeof module !== "undefined" && module.exports) { module.exports = { /* ...29 项... */ }; }
```

真正的问题在 **丙类**。

---

## 5. 丙类「封死文件」清单（S1 必须处理）

扫描脚本 `D:\EVE-IDLE\wx-p2-tools\sealed-scan.mjs`（含三重过滤：抹除注释与字符串字面量 / 排除对象键位 / 消费方本地声明过同名则跳过）。
完整数据 → `D:\EVE-IDLE\wx-p2-out\s1-sealed-scan.json`

**24 个封死文件 → 16 个存在外部裸引用 → 共 155 个名字。**

| 文件 | 顶层声明 | 被外部裸引用 |
|---|---|---|
| `js/systems/manufacturing.js` | 50 | **39** |
| `js/systems/combat.js` | 83 | **28** |
| `js/systems/production.js` | 36 | **23** |
| `js/data/combat.js` | 26 | **16** |
| `js/data/ammo.js` | 22 | **13** |
| `js/core/queue.js` | 15 | **12** |
| `js/data/ammunition.js` | 6 | 6 |
| `js/ui/action-modal.js` | 11 | 6 |
| `js/ui/station-render.js` | 21 | 6 |
| `js/systems/planetary.js` | 9 | 3 |
| `js/systems/enhancement-chance.js` | 2 | 2 |
| `js/core/combat-modifiers.js` | 4 | 1 |
| `js/core/tick.js` | 7 | 1 |
| `js/data/base.js` | 2 | 1 |
| `js/data/planets.js` | 1 | 1 |
| `js/ui/archaeology-render.js` | 9 | 1 |
| `js/core/bootstrap-launch.js` / `js/core/selectors.js` + 6 个 locale/config 文件 + `js/platform/*` | — | 0（自成一体的纯数据/纯函数文件） |

**最高频的名字**（跨文件引用次数）：

```
COMBAT_ZONES 34×  DEATHSPACE_DATABASE 33×  SMELTING_RECIPES 30×
addSkillXpToState 21×  PLANET_TYPES 17×  setText 17×  xpForLevel 14×
ITEM_ICONS 12×  checkLevelUp 12×  GAS_AREAS 12×  getSelectedCount 11×
STARMAP_TITAN_MATERIALS 10×  getAmmoTierProps 9×  calculateCombatStatFromState 8×
WEAPON_CONFIG 8×  等（完整 155 条见 JSON）
```

### 5.1 ⭐ 危险特征是「静默」而不是「崩溃」

大量消费点写成**防御式守卫**，例如：

```js
// js/core/actions.js:1414
const wave = (typeof buildCombatWave === "undefined") ? <fallback> : buildCombatWave(...);

// js/core/selectors.js:856
const discounted = (typeof getDiscountedAssemblyRecipe === "undefined") ? null : ...;
```

⇒ 在微信下这些名字**不是 `undefined` 而是 ReferenceError 之外的境况**——由于 `typeof` 对未声明标识符安全返回 `"undefined"`，代码会**静默走 fallback 分支**：战斗波次构建失败、冶炼配方算不出、装配折扣丢失……**一声不响地算错**。

这正是项目已知的故障族（「真机常落在 catch/fallback 分支」）。

### 5.2 修法（低风险，机械）

给这 16 个文件各追加一个**双模式出口尾**，与另外 92 个文件已有的写法完全一致：

```js
if (typeof window !== "undefined") {
  window.COMBAT_ZONES = COMBAT_ZONES;
  window.DEATHSPACE_DATABASE = DEATHSPACE_DATABASE;
  /* 该文件被外部消费的全部名字 */
}
```

**为什么这是安全的**：

- 浏览器/Steam/TapTap 侧 `window.X = X` **本来就是既成事实**（顶层 `function` 声明在经典脚本里已自动挂到 window；`const` 则靠共享词法环境），显式赋值不改变任何可观察行为。
- 微信侧从「拿不到」变成「拿得到」，只修 bug 不改语义。
- 不改分支、不改数值、不碰冻结文件逻辑。

**工作量重估**：原本「单作用域合并包」被列为 S1 的架构必改项，按此结论应**降级为 16 个文件的机械尾注**，且可用脚本生成 + 静态校验（`python -c` 式：生成后 grep 每个名字必须出现 `window.<name> =`）。

---

## 6. 决策影响

| ID | 决策 | P2 给出的答案 |
|---|---|---|
| **D3** | 3D 保留程度 | **全量保留**。技术上全部路径可跑，体积只有 1.03 MB，无砍的理由 |
| **D1** | UI 内核 | 不变（自研 Canvas 内核，P3 已定）——但**3D 画布可以继续用 three**，不必重写 |
| **D2** | 视觉一致性 | 3D 部分可以做到与 H5 一致；差异只在 2D UI 层 |
| — | S1 架构 | 「单作用域合并包」**降级**为「16 个文件补双模式出口尾」 |

---

## 7. 归属核对（防混淆）

`git status --short index.html tools/build-taptap-h5.mjs js/` 显示：

```
 M index.html                    ← i18n 会话遗留（catalog-en ?v=23→25、catalog-zh-TW ?v=6→8）
 M js/i18n/catalog-en.js         ← i18n 会话遗留（11,074 行变更）
 M js/i18n/catalog-zh-TW.js      ← i18n 会话遗留（11,453 行变更）
```

**这三处与本次 P2 无关**（P2 全程未写任何仓库内 JS/HTML）。本次 P2 新增的仓库内文件只有：

- `tools/build-wechat-minigame.mjs`（P4 产出）
- `tools/wechat/shim.js`（P4 产出）
- `docs/WECHAT_PROBE_P4_PACKAGE_SIZE_v0.1.md`（P4 产出）
- `docs/WECHAT_PROBE_P2_3D_AND_MODULE_SEMANTICS_v0.1.md`（本文件）

全部为**未跟踪（`??`）+ 未提交**状态。

---

## 8. 未验证 / 遗留

1. **真机（非模拟器）未验**。本报告全部数据来自 IDE 模拟器 `WeappSimulator`。真机的 WebGL 实现、`readPixels` 行为、`toDataURL("image/webp")` 编码器可能不同 ⇒ 上线前必须真机跑一次。
2. **`clientWidth` 坑的真机表现未知**。模拟器里它是 own=false、hasSetter=false 的 accessor；真机是否同样需要 `defineProperty` 遮蔽，未验。
3. **155 个名字的修法未实施**（属 S1 范围，需用户授权后单独开工）。
4. **`localStorage` 迁移面未处理**：仓库有 **127 处** `localStorage` / `sessionStorage` 引用，微信无此 API（需换 `wx.setStorageSync`）。`crypto.getRandomValues` 只有 1 处（开发工具 `ship-lab.js`），低风险。`MutationObserver` 亦有使用面需覆盖。
5. **泰坦出图用的相机是 `captureThumbnail` 的固定相机**，泰坦靠 `TITAN_MODEL_TARGET=15` 归一化恰好适配；3D 弹窗路径的 `autoFit` 未单独验（但 `ensureViewer` 只是 4 行 canvas→handle 缓存包装，内部即 `createViewer`，已连带覆盖）。

---

## 9. 复现步骤

```bash
# 1) 把生产 3D 层搬入探针工程并改写裸说明符
cd D:/EVE-IDLE/wx-p2-tools
node prep.mjs
#   → 搬入 50 个文件 / 2,748,188 B；改写 49 处；反向校验无裸说明符残留

# 2) 在开发者工具里打开探针工程（需已开服务端口）
"C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat" open --project "D:/EVE-IDLE/wx-p2-3d-probe"

# 3) 等到 3~5 秒后读结果（USER_DATA_PATH 映射到真实磁盘）
#    C:\Users\Administrator\AppData\Local\微信开发者工具\User Data\<uid>\
#      WeappSimulator\WeappFileSystem\<hash>\wx0b109424d84cc731\usr\
#      p2-report*.json  p2-*.webp

# 4) S1 封死文件扫描
cd D:/EVE-IDLE/wx-p2-tools
node sealed-scan.mjs   # → D:/EVE-IDLE/wx-p2-out/s1-sealed-scan.json
```

探针工程结构：

```
wx-p2-3d-probe/
  game.js                 入口（每阶段重写，逐阶段增量落盘）
  wx-dom-shim.js          434 行 DOM shim（含 AbortController polyfill、canvas clientWidth 遮蔽）
  enc/png.js              自写 PNG 编码器（不依赖 canvasToTempFilePath）
  st1.js / st2.js         模块作用域最小实验（定律 2 的证据）
  vendor/                 three.core.js + three.module.js + 3 个 addon
  src/render3d/           42 个生产 3D 模块（仅改写裸说明符）
  src/ui/ship3d.js        生产 3D UI 层（原样）
  src/data/ships.js       生产舰船数据（经典脚本，逐字节原样）
  src/data/titans.js + titans.bridge.js   泰坦数据 + 探针桥
```

---

## 附：产物清单

| 路径 | 内容 |
|---|---|
| `D:\EVE-IDLE\wx-p2-out\p2-report{3..9}.json` | 各阶段完整探针报告（含 `errors[]`、`flushErrors[]`） |
| `D:\EVE-IDLE\wx-p2-out\p2-ship-id-*.webp` | 9 艘生产舰船缩略图 |
| `D:\EVE-IDLE\wx-p2-out\p2-titan-*.webp` | 9 个泰坦组合缩略图 |
| `D:\EVE-IDLE\wx-p2-out\p2-viewer-frame2.webp` | 查看器 rAF 循环出帧 |
| `D:\EVE-IDLE\wx-p2-out\p2-prod-*.webp` | 生产默认构图缩略图 |
| `D:\EVE-IDLE\wx-p2-out\s1-sealed-scan.json` | 155 个需处理名字的完整清单（含每个名字的引用位置与代码片段） |
| `D:\EVE-IDLE\wx-p2-tools\prep.mjs` | 资源准备 + 说明符改写 + 反向校验 |
| `D:\EVE-IDLE\wx-p2-tools\sealed-scan.mjs` | S1 封死文件扫描 |
| `D:\EVE-IDLE\wx-p2-tools\scope-scan.mjs` | 跨文件裸引用粗扫（已被 sealed-scan 取代，保留作对照） |
