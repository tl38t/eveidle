# EVE IDLE · 美术方向指南（Art Direction & Asset Plan）

> 状态：方向已定（2026-07-19）
> 适用范围：所有新增与存量美术资产、渲染层改造、资源目录规范。

## 1. 总方向：混合路线，战斗界面全 3D

- **战斗界面**（玩家舰船 + 敌方单位）一律 **3D**，由同一套程序化参数化 3D 引擎渲染。
- **装配预览 / 船坞旋转展示** 复用同一套 3D 引擎（单舰聚焦模式），由 `gameState` 的当前配装驱动。
- **其余所有 UI**（船坞/装配列表、编队、制造产出、资源、装备、行星、敌人列表图标）一律 **2D 插画/图标**。
- 2D 与 3D 共用同一套配色语言，保证视觉统一。

### 系统 → 渲染映射

| 系统 / 场景 | 渲染方式 | 说明 |
|---|---|---|
| 战斗界面 · 我方舰船 | **3D** | 程序化引擎按 fit 拼装 |
| 战斗界面 · 敌方单位 | **3D** | 同上，按敌人 spec 拼装 |
| 战斗特效（攻击/受击/爆炸） | **3D 场景内** | 粒子/光束，取代现有 CSS `playAttackFX` |
| 装配预览 / 船坞展示 | **3D** | 单舰聚焦，读配装数据 |
| 船坞 / 装配列表 / 编队图标 | 2D 插画 | 列表与库存展示 |
| 制造产出 / 装备 / 死亡空间掉落 | 2D 图标 | 物品量大，图标优先 |
| 资源 / 材料 | 2D 小图标 | 必须一眼可辨 |
| 行星 | 2D 插画（或极简程序化） | 静态展示 |

> 注：早期 `images/ships/裂谷级.png`、`images/enemies/天使侦查舰.png` 两张 **2D 素材已退役并删除**；正式显示统一使用程序化 3D，3D 不可用时回退通用占位符（🚀/👾），不再提供 2D PNG 列表/图鉴。

## 2. 2D 风格指南（给 AI 出图 / 外包的统一约束）

统一 prompt 模板 + 参考图锁定，杜绝风格漂移。

- **视角**：3/4 俯视（上方约 30°），舰船朝右上 45°。
- **画幅**：512×512（列表图标）/ 1024×1024（图鉴大图），**透明背景 PNG**。
- **配色**（与 `three-demo` CSS 变量对齐）：
  - 背景：深空 `#070a0f`
  - 玩家主色：`青蓝 #42bcff`、点缀 `金 #d6a84a`
  - 敌方主色：`红 #ff665e`、暗钢灰
  - 描边：细发光描边（非卡通粗描边）
- **质感**：硬表面科幻、金属反光 + 自发光细节（引擎辉光、瞄准线），低多边形偏写实，避免 Q 版。
- **一致性清单**：同阵营同色系、同视角同光照、同画幅同透明底。
- **AI 出图建议**：固定负向词（no text, no watermark, no extra ships, clean silhouette），每批同 seed/同风格参考图批量出，再人工筛。

## 3. 3D 方案：参数化程序化引擎（核心）

复用 `three-demo-standalone.html` 的部件拼装思路（Cylinder/Cone/Sphere + EdgesGeometry 描边），但**数据驱动**：

### 3.1 Ship Spec（数据契约）

每种舰船/敌人用一份 spec 描述，引擎据此拼装，保证玩家与敌人视觉一致、可批量扩展。

```js
// 概念结构（落地时由 data 层提供）
const shipSpec = {
  id: "rift_class",            // 对应 data 层舰船定义
  role: "player" | "enemy",    // 决定阵营配色/自发光
  hull: "frigate" | "cruiser" | "battleship" | "enemy_recon" | "enemy_gunship",
  palette: { primary, accent, glow },   // 缺省按 role 取阵营色
  parts: {
    hullLength, hullRadius,
    engines: 1|2|3,
    wings: false,
    weapons: [ { type: "beam"|"projectile"|"missile", mount: "top"|"side" } ],
    turrets: n
  }
}
```

- 玩家舰船：spec 由 `gameState.fit`（船体 + 武器/模块）生成 → 装配预览与战斗共用同一 spec。
- 敌人：spec 由 `data/enemies` 定义生成。
- T2 / 混血战列 / 行星敌人：只是在 `hull` 与 `parts` 上加参数，引擎无需改。

### 3.2 引擎职责

- 一个 `ShipFactory.build(spec)` 产出 `THREE.Group`。
- 一个 `CombatScene` 管理双方单位、相机、灯光、入场/受击/爆炸特效。
- 装配预览 = `CombatScene` 的单舰模式（关掉敌方、开轨道旋转）。

### 3.3 与架构审查的衔接（重要）

战斗改 3D 是**顺手修 A2/A3 的好时机**：
- `combat.js`（systems 层）不得再调用 `playAttackFX`/`playEnemyAttackFX`（A2）→ 改为 **emit 战斗事件**。
- `combat-render.js` 改造为 **3D 场景订阅者**：监听战斗事件 → 在 `CombatScene` 播放特效，**不再直接改 `gameState.combat.wave`**（A3）；wave 推进收归 action 管道。
- 这同时满足「core/systems 不碰 DOM、UI 不改状态」的分层约束，并能补上 `verify.mjs` 的守卫盲点（见 `CODE_REVIEW_2026-07-19.md`）。

## 4. 资产清单（首批打样）

按优先级，验证一致性后再放量：

| 批次 | 内容 | 用途 | 数量 |
|---|---|---|---|
| P1-2D | 舰船列表图标（裂谷级/T2/混血战列占位） | 船坞/编队 | 5–8 |
| P1-2D | 敌人列表图标（天使侦查舰等） | 图鉴/列表 | 5–6 |
| P1-2D | 装备 + 死亡空间掉落图标（核心/协议/同类） | 库存 | 8–12 |
| P1-2D | 资源/材料小图标 | 全局 | 10–15 |
| P1-3D | 舰船 hull 部件库（frigate/cruiser/battleship） | ShipFactory | 3 类 |
| P1-3D | 敌人 hull 部件（enemy_recon/enemy_gunship） | ShipFactory | 2 类 |
| P2 | 行星插画、武器/引擎部件 3D 模块 | 扩展 | 按需 |

## 5. 目录结构 & 命名规范

```
images/
  ships/        2D 舰船列表图标        <ship_id>.png
  enemies/      2D 敌人列表图标        <enemy_id>.png
  equipment/    2D 装备/掉落图标       <item_id>.png
  resources/    2D 资源小图标          <resource_id>.png
  planets/      2D 行星插画            <planet_id>.png
js/
  render3d/                     新增：3D 引擎
    ShipFactory.js             build(spec) -> THREE.Group
    CombatScene.js             战斗 3D 场景控制器（事件订阅者）
    FittingViewer.js           装配预览（复用 CombatScene 单舰模式）
  systems/  combat.js          只 emit 事件，不碰渲染
  ui/       combat-render.js   改为 CombatScene 的桥接/订阅者
```

- 命名：`<id>.png` 与 `data` 层定义 ID 严格一致，渲染层按 ID 拼接路径。
- 3D 资产不落地为 `.glb`，全部由 `ShipFactory` 程序化生成（保持零外部模型依赖、易于版本管理）。

## 6. 落地步骤

1. **锁 2D 风格**：定稿第 2 节 prompt + 参考图，出 P1-2D 打样，人工筛一致性。
2. **建 3D 引擎骨架**：`ShipFactory` + `CombatScene` + `FittingViewer`，先跑通现有舰船/敌人在场景内显示。
3. **接战斗**：`combat.js` 改 emit 事件；`combat-render.js` 桥接 `CombatScene`；wave 推进收归 action；顺带修 A2/A3。
4. **补 verify.mjs 守卫**：覆盖 `combat.js`/`combat-render.js`，防止回归。
5. **放量资产**：P1 通过后按清单批量出 2D/3D。

---
*相关文档：`CODE_REVIEW_2026-07-19.md`（架构回归与守卫盲点）、`ARCHITECTURE.md`（分层约束）、`DEVLOG.md`（功能路线）。*
