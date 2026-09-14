# 微信小游戏 P5 探针报告 —— 平台产物冻结基线圈

- **日期**：2026-09-13
- **探针目标**：把「微信小游戏迁移对 TapTap / Steam 零影响」这条收工门禁，做成**可机械执行、且有牙**的判据
- **结论**：**✅ 通过。19 项断言 PASS；4 道门禁全部经反向臂证明会 FAIL。**
- **前置**：P1 ✅ / P2 ✅ / P3 ✅ / P4 ✅
- **边界**：**零生产代码改动**。新增仅 `tools/platform-baseline.mjs`（仓库内，未 commit）；
  基线数据落 `D:\EVE-IDLE\wx-p5-baseline\`（仓库外）。**未改动任何 zip / Steam 产物 / 仓库受跟踪文件。**

---

## 一、要解决的问题

执行计划 §七 收工门禁第 2 条要求「TapTap / Steam 构建产物 SHA 与基线逐位相同」。
但上一轮（会话初期）暴露出一堆**靠人肉记忆比对必然失守**的东西：

- 不记得 rc78 的 zip SHA、入包条目数、Steam 产物的 `game/**` 指纹；
- 不记得构建工具（`build-taptap-h5.mjs` 等）当时是什么版本；
- **最要命**：`git archive` 出的包做了构建期转换（换行规范化、`index.html` 注入），
  所以「包内字节 ≠ 工作树字节」，直接比会得出一片假差异。

## 二、设计原则（三条，写在脚本头部）

1. **不复制构建器逻辑**。TapTap 包的入包文件集与字节已由 `deep-space-idle-taptap-rc<N>.zip`
   **自身完整表达**（它 = 白名单 ∩ 转换后的结果）。脚本只「读产物」，
   不重写 `build-taptap-h5.mjs` 的白名单/排除表 ——
   **同语义第二份实现必然漂移**（这是本项目已多次踩到的类型）。
2. **路径与 RC 号也不另立真值**：OUTDIR 从 `build-taptap-h5.mjs` 源码里读，RC 号从 `tools/rc-counter.txt` 读。
3. **区分噪声与信号**。包由 `git archive`（LF 规范化）产出，而工作树多为 CRLF
   ⇒ 直接比字节会把 ~86 个文件误判成「被转换」。故工作树侧比较前先做 LF 规范化。

## 三、产物

| 路径 | 说明 |
|---|---|
| `tools/platform-baseline.mjs` | 捕获（`--capture`）/ 校验（`--check`）；`--quiet` `--json <path>` `--no-origin` |
| `D:\EVE-IDLE\wx-p5-baseline\platform-baseline.json` | 基线数据（仓库外） |
| `D:\EVE-IDLE\wx-p5-baseline\_neg\*.json` | 4 个反向臂基线（**故意做坏**，用于证明门禁有牙） |

用法：

```bash
node tools/platform-baseline.mjs --capture            # 写基线（含来源提交溯源）
node tools/platform-baseline.mjs --check              # 复算比对，漂移则 EXIT 1
node tools/platform-baseline.mjs --check --quiet      # CI 用；⚠️ 失败裁决不受 --quiet 抑制
```

## 四、基线内容（captured 2026-09-13T13:52:12Z）

### TapTap

| 项 | 值 |
|---|---|
| release | `deep-space-idle-taptap-rc78.zip`  11,999,258 B |
| | `sha256=d70327a7a9859623ab1fd2cae1b7d48f74fb2fc0d65059071b15be00a618fda2` |
| selftest | 12,005,942 B  `sha256=7a49e6e0e52fd7163e5faf9433e2c4fbe8f8415884daf09da431bf9fc592118e` |
| 入包条目 | 440 个，解压字节和 18,499,847 |
| ⭐ 入包指纹 | `b576851979b6f6ca1f078e1b015c9c0d9e23784e13a250a24e490ae421367e1e` |

### Steam

| 项 | 值 |
|---|---|
| 最新产物 | `0.1.0-electron-raw`  236 文件 / 23,351,362 B |
| ⭐ `game/**` 指纹 | `4a7ddf1763fd7f1716cfd0c9dc0fc2c41b261fc7252a6d2abfb4d517ae30c581` |
| `resources/app` 全量指纹 | `e2530cf45694cf5c7ad060f94535db4a10b940441ab7ce8703c51a01e06aae97` |

### 构建工具 SHA（5 个 + Steam 壳 4 个）

`build-taptap-h5.mjs:fa87603ade9d` · `taptap-compat-probe.mjs:667f2b0b144a` ·
`build-wechat-minigame.mjs:3c8ad84f29a9` · `wechat/shim.js:b4b1e91f4050` · `platform-baseline.mjs:b89de0745550`

## 五、⭐ 来源溯源（本轮方法论收获）

**问**：怎么确认「线上 rc78 是哪次提交产出的」，从而知道迁移期间的改动有没有混进已发布的包？

**方法**：拿 rc78 包内**每一份文件字节**，去和候选提交的 `git -c core.autocrlf=false archive --format=zip <sha>`
逐条比对，命中数最高的即为来源。

**结果**：

| 项 | 值 |
|---|---|
| 来源提交 | **`508dda2`** —— `docs(changelog): 0.9.2 更新日志补入本轮修复…`  (2026-09-13 16:58:35 +08:00) |
| 逐条命中 | **438 / 440**（唯一解） |
| 次名 | `d8bbdb0`（437，差 3） |
| 包内有而源内无 | **无** |
| 构建期转换 | 仅 2 个：`index.html`、`js/ui/ad-buff-widget.js` |

> 438/440 不是「差 2 个没对上」，而是**恰好 2 个文件被构建期改写过**（`index.html` 注入 + `ad-buff-widget.js` 转换）。
> 这两个转换**逐字节可复现**，故仍在基线内被锁死。

## 六、⭐ 门禁定义（4 道，19 项断言）

| 门禁 | 回答的问题 | 断言 |
|---|---|---|
| 1 · TapTap 已产出包未被改动 | 迁移有没有动到已发布的包？ | release zip SHA-256 / selftest zip SHA-256 / 入包条目数 / **入包内容指纹** |
| 2 · Steam 已产出产物未被改动 | 同上（Steam 侧） | 最新产物目录 / app 文件数 / **`game/**` 指纹** / `resources/app` 全量指纹 |
| 3 · 构建链未被改动 | 迁移有没有偷偷改打包脚本？ | RC 计数器值 / `rc-counter.txt` SHA / 5 个构建工具 SHA / 4 个 Steam 壳 SHA |
| 4 · 平台入包文件未被新增改动 | 迁移有没有改到「会被平台打包的文件」？ | 工作树变更 ∩ 平台入包集 **相对基线只允许减少，不允许新增** |

### 门禁 4 为什么要专门做一条

门禁 1–3 只能发现「事后重打包」。真正危险的是**改了一个会进包的文件却没重打包**
—— 那会在下次发版时静默带上未经审阅的改动。门禁 4 就是拦这个。

两侧语义不对称，是刻意的：

- **已知既成改动**（基线捕获时工作树里已存在的 5 个：`index.html`、`js/i18n/catalog-en.js`、
  `js/i18n/catalog-zh-TW.js`、`legion-nebula.png`、`legion-starmap-pure.html`）登记为**基线**，
  不告警 —— 否则会把历史遗留持续误报成「迁移引入」。
- **只对超出该名单的新增改动告警**。

## 七、⭐ 有牙证明（4 个反向臂，全部 EXIT=1）

> 铁律：新写门禁必须证明**它能失败**。全部用 `--check --quiet` 跑，顺便验证失败裁决不被静默吞掉。

| 臂 | 对基线做了什么 | 触发的门禁 | EXIT |
|---|---|---|---|
| `A-empty-known` | 清空 `knownTouchedShipped` | **门禁 4** —— 报「平台入包文件新增改动（5 个）」 | 1 |
| `B-bad-sha` | 篡改 `taptap.release.sha256` | **门禁 1** —— `rc release zip SHA-256` | 1 |
| `C-bad-tool` | 篡改某构建工具 SHA 为全 `f` | **门禁 3** —— `构建工具 …` | 1 |
| `mutated` | 篡改 `packedFingerprint` + `gameFingerprint` | **门禁 1 + 2** —— 入包内容指纹 / `game/**` 指纹 | 1 |

4 个臂合起来覆盖全部 4 道门禁，无一漏网。

### 本轮修掉的自身缺陷（`--quiet` 吞错）

**症状**：`--check --quiet` 失败时只打印零散的 `✗ label` 行，**裁决句 `❌ FAIL` 与漂移清单被吞**
（因为裁决块当时用的是受 `--quiet` 抑制的 `log()`）。CI 里表现为「既没报 PASS 也没报 FAIL」，无法定位。

**修法**：失败裁决与漂移清单一律走 `console.log`，**不受 `--quiet` 抑制**。
修后复测：`mutated` 臂在 `--quiet` 下 9 行输出中包含 `❌ FAIL —— 2 项漂移：` 与两条清单项。

## 八、⚠️ 顺带查出的真问题：`legion-nebula.png`（**需要决策，本轮未动**）

排查门禁 4 时发现 `legion-nebula.png` 出现在基线里，顺手追了一下，结论是一个**线上真缺陷**：

| 事实 | 证据 |
|---|---|
| 文件在仓库工作树存在 | `2,848,164 B`，mtime 2026-08-30 |
| **从未被 git 跟踪** | `git log --all -- legion-nebula.png` 为空；`git ls-files --error-unmatch` 报 not known to git |
| 被运行时加载 | `legion-starmap-pure.html:11` `nebula.src='legion-nebula.png'` |
| 该页在主游戏内 | `index.html:1191` `<iframe src="./legion-starmap-pure.html?v=47">` |
| **TapTap 侧缺失** | 从 rc44 到 rc78 **共 72 个包，无一带该文件**；rc78 有 `legion-starmap-pure.html` 但无 png |
| Steam 侧正常 | `STEAM-OUTPUT/*/resources/app/game/legion-nebula.png` 存在（17 个产物目录都有） |

**表现**：`drawBackground()` 里是 `if(nebula.complete&&nebula.naturalWidth) x.drawImage(...)`
⇒ 图不加载就**静默跳过**，不报错、不崩，只少一层星云纹理（底色径向渐变仍在，其上还压了 34% 暗罩）。
**所以 4 月份以来线上 TapTap 的军团星图一直是没有星云层的，但没人会以为它是 bug。**

**根因**：TapTap 发布走 `git archive <SHA>` ⇒ **未跟踪 = 不进包**。「工作树能跑」≠「包里能跑」，
这条铁律在这里以「少一张装饰图」的形式成立。

### ⭐⭐ 但真正值得记的是：**四层漏打防护网，三层同时失效**

`build-taptap-h5.mjs` 在 2026-09-12 成就图标事故（232 张图标 rc1→rc70 全 0 张）之后，
专门加了「四层闸」。`legion-nebula.png` 逐层过了一遍，结果是**全漏**：

| 层 | 机制 | 为什么没拦住 |
|---|---|---|
| ① | **git 跟踪**（release 读 `git archive <SHA>` 的 commit 树） | 该文件**从未 commit** ⇒ 拿不到 |
| ② | **`isWhitelisted(rel)`** | 规则里只有 `legion-starmap(-pure)?.html` / `-content|-events.js` / `^css/` / `^js/` / `^images/` / `^assets/achievements/` / `^demo-assets/` —— **仓库根的 `.png` 无任何规则匹配** |
| ③ | **worktree 目录清单**（selftest 模式的第二把锁） | 同上，清单里不含仓库根 |
| ④ | **静态资源引用对账**（`collectSourceUniverse` → `auditAssetRefCoverage`，设计为「整类漏打的结构化拦截」） | 🔴 **正则盲区**，见下 |

**第 ④ 层的正则盲区（已实测坐实）**。对账抽路径 token 的正则是：

```js
/(["'`])([A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+\/?)/g
//            ↑ 这一组是 `+`（一次或多次）⇒ 捕获的 token **必须至少含一段 `/`**
```

而 `legion-starmap-pure.html:11` 写的是**裸文件名**：

```js
nebula.src='legion-nebula.png';      // 不含 `/` ⇒ 正则零命中
```

实测（对真实文件第 11 行跑该正则）：

| 输入 | 捕获到的 token |
|---|---|
| 真实行 `nebula.src='legion-nebula.png';` | **`[]`（零命中）** |
| 若写成 `nebula.src='./legion-nebula.png';` | `["./legion-nebula.png"]`（会被捕获） |

⇒ **第 ④ 层只保护「带目录的引用」。仓库根级别的裸文件名引用，对它是不可见的。**
`REF_SCANABLE_RE` 确实包含 `html`（该页会被扫），但 token 本身匹配不上，扫了也白扫。

**同一盲区也命中微信包**（本轮实测）：`tools/build-wechat-minigame.mjs` 的目录兜底扫只有三个根 ——
`walk(ROOT/js)` / `walk(ROOT/assets)` / `walk(ROOT/demo-assets)`（第 71/89/90 行），**同样不含仓库根**
⇒ `legion-nebula.png` 既不在微信静态清单里、也不在兜底扫描范围内 ⇒ **微信包一样会缺这张图**。
⇒ 修法不能只顾 TapTap：**要么把资源移进任一「已被覆盖的目录」，要么把「仓库根」同时加进两侧的扫描/白名单。**

### ⭐ 一条省掉「改冻结文件」的修法：把图移进 `demo-assets/`

`demo-assets/` 在**两处都已被覆盖**（实测）：

| 检查项 | 结果 |
|---|---|
| TapTap `isWhitelisted` | 规则 `^demo-assets/.+\.(png\|…)$` 命中 ⇒ 放行 |
| TapTap worktree 目录清单（③ 第二把锁） | `demo-assets/wormhole-map-bg.png`（1,927,769 B）**在 rc78 release 与 rc78 selftest 两个包里都在** ⇒ 已被证明会入包 |
| 微信打包目录扫 | `walk(ROOT/demo-assets)` ⇒ 会被扫到 |
| 第 ④ 层对账 | 引用变成 `'./demo-assets/legion-nebula.png'`，**含 `/` ⇒ 能被正则捕获** |

⇒ 把文件移到 `demo-assets/legion-nebula.png` + 改 `legion-starmap-pure.html:11` 的引用路径 + `git add` 提交，
**三平台一次性修好，且完全不需要动 ⛔ 冻结文件 `tools/build-taptap-h5.mjs`**（代价：改一处被 `index.html` iframe 引用的页面 ⇒ 按 `?v=` 铁律 bump `index.html:1191` 的 `?v=`）。

**结论**：`legion-nebula.png` 不是「某层疏忽」，而是**四层防护网对「根目录裸文件名引用」这一整类的共同盲区**；
修完这一例（补 git + 补白名单）后，**同类还会再来**（任何放在仓库根、被裸文件名引用的资源）。
彻底修法 = 让第 ④ 层同时接受裸文件名 token（在**源码树中确实存在同名文件**时才算引用，避免误报）。

### ⚠️ 为什么本轮不动

1. **修这一例**（`git add` + 补 `isWhitelisted` + 补 worktree 清单 + 补 `verifyPackage` 断言，
   即成就图标事故确立的四件事）**必须改 `tools/build-taptap-h5.mjs`** —— 该文件是微信迁移的 ⛔ 冻结文件；
2. 同时会把 **2.85 MB** 资源加进 git ⇒ 下一版 TapTap 包 +2.85 MB（现包 12.0 MB）；
3. ⇒ 属于**影响发布产物 + 触碰冻结文件**的决策，需明确授权，本轮**只报告不动手**。

## 九、遗留

| # | 项 | 状态 |
|---|---|---|
| 1 | `subassets` 体积差 495,228 B 的构成 | **已收口**，见下 |
| 2 | 门禁 4 的入包集用「跨平台并集」语义 | 见下，**已在 §八 暴露为盲点** |
| 3 | `tools/verify.mjs` 基线腐烂（硬编码脚本数 120 vs 实际 125） | 未动，需单独立项 |

### 遗留 1：`subassets` 差值构成（已收口）

```
assets/** + demo-assets/** 原始和              10,390,288 B
  + subassets/game.js（构建时自动生成的占位）        161 B
  = 落盘原始                                    10,390,449 B   ← 与 P4 报告数字逐字节一致 ✅
官方计费                                        9,895,221 B
差值                                            495,228 B
  ├─ .woff2 全部不进包（实测口径 C）               391,216 B
  ├─ 目录下 .css 不计入                           103,882 B
  └─ 残差                                            130 B
```

**残差 130 B**：量级 **≤ 单个自动生成占位文件（161 B）**，落在「占位文件是否计入 / 单文件粒度」之内，
**对任何决策无影响**（最近的门槛是 4 MB，差 3 个数量级）。若将来确需钉死，唯一权威来源是开发者工具本身的条目级清单。

### 遗留 2：门禁 4 入包集是「跨平台并集」——这正是它漏掉 §八 的原因

`buildShippedSet()` = `taptap.entries` ∪ （Steam `game/**` 去掉前缀）。语义是
「**这个文件是否被某个平台发布**」，**而不是**「**每个平台是否都发布了它**」。

⇒ 一个「Steam 有、TapTap 没有」的文件（正是 `legion-nebula.png`）会安静地落进并集里，
看起来一切正常。**这是设计缺陷，不是实现 bug**；修它要让入包集按平台分桶（`shippedByTaptap` / `shippedBySteam`），
并新增一条「跨平台差集」断言。**本轮未改**，因为改动会重刷基线，且与 §八 的决策耦合。

## 十、结论

- **P1 / P2 / P3 / P4 / P5 全部 ✅** ⇒ S-1 探针阶段收官，可以进 S1 实施。
- 「微信迁移对现有平台零影响」现在是一条**一条命令可复算**的门禁（`--check`，EXIT 0/1），
  而不是一句承诺；且已用 4 个反向臂证明它**会失败**。
- 本轮**零生产代码改动**：`index.html` / `tools/build-taptap-h5.mjs` / 逻辑层一字未动；
  仓库内新增仅 `tools/platform-baseline.mjs`（未跟踪）。
