# EVE IDLE · 舰船设计语言（Ship Design Language）

> 状态：v1（2026-07-19）· 源于 `js/data/ships.js` 与 `js/data/combat.js` 真实舰船/势力数据
> 目标：用**一套统一视觉语法**覆盖全部舰船（玩家 15 + 工业 4 + 敌人 3 势力），保证可读、可扩展、贴近 EVE 硬表面质感。
> 对接：`js/render3d/ShipFactory.js`（参数化工厂）。本文档是"该造什么样的船"的宪法，ShipFactory 是执行器。

---

## 1. 总纲（三条原则）

1. **(尺寸, 专精) 决定一切外观**：武器、剪影、配色全部由这两个维度推导。加一艘新船 = 选档位 + 选专精，不重新发明外观。
2. **玩家线与敌人势力镜像**：护盾↔天使 / 装甲↔血袭者 / 结构↔萨沙。玩家和敌人用**同一种剪影家族**，所以"看形状就知道在打谁、用什么克"。
3. **英雄亮、敌人暗**：玩家舰队用浅色（银白+金），三个敌人势力用高饱和暗色，战场上一眼分辨敌我。

---

## 2. 色彩语言（阵营 / 专精调色板）

| 身份 | 势力/线 | 主体(hull) | 暗部(dark) | 辉光(glow) | 点缀(accent) | 语义 |
|---|---|---|---|---|---|---|
| 玩家 | 联盟舰队（护盾线） | `#c9ccd4` 银白 | `#2a2e36` | `#5fd0ff` 青 | `#e8c87a` 金 | 英雄·科技 |
| 玩家 | 联盟舰队（装甲线） | `#cfc6bd` 骨白 | `#2a2620` | `#ff9a5a` 橙 | `#b08968` | 英雄·厚重 |
| 玩家 | 联盟舰队（结构线） | `#d2d6cf` 苍白 | `#222820` | `#9affc0` 绿 | `#7fae8a` | 英雄·锋锐 |
| 敌人 | 天使集团（护盾） | `#5a1f1f` 暗红 | `#16110f` 黑 | `#ff4030` 红 | `#7a2a22` | 红黑·激进 |
| 敌人 | 血袭者（装甲） | `#4a1530` 暗紫红 | `#160c12` 黑 | `#ff3a6e` 品红 | `#6a2440` | 紫红·邪教 |
| 敌人 | 萨沙共和国（结构） | `#14403a` 暗青 | `#101a18` 黑 | `#36e0a0` 青绿 | `#2a1840` 紫 | 合成·异质 |

> 实现：`ShipFactory.COLORS` 改为按 **(role, line)** 取色而非单色。玩家三种线共用银白基底换辉光/点缀；敌人三势力用暗色基底。
> 早期 `images/ships/裂谷级.png`、`images/enemies/天使侦查舰.png` 仅作 2D 列表/图鉴，不进 3D 舞台。

---

## 3. 尺寸原型（HULL_PRESETS 目标参数）

游戏真实舰种（`SHIP_TYPE_NAMES`）：`frigate / destroyer / cruiser / battleship`，外加 `industrial_frigate / industrial_cruiser / industrial_capital`。

| 档位 | 代表舰（玩家） | len | 引擎 | 武器挂点 | scale | 视觉体量 |
|---|---|---|---|---|---|---|
| `frigate` | 裂谷/茶隼/阿特龙级 | 6.0 | 2 | 2 | 1.0 | 小巧锋利 |
| `destroyer` | 雷光/矛隼/疾锋/混血三型 | 7.6 | 2 | 3 | 1.2 | 中段·棱角 |
| `cruiser` | 曙光/战隼/烈锋级 | 9.2 | 3 | 4 | 1.45 | 大气·主战 |
| `battleship` | 曜光/堡隼/震锋级 | 11.5 | 3 | 5 | 1.8 | 巨硕·威慑 |
| `industrial_frigate` | 冲锋者/勘探者级 | 5.0 | 1 | 2(采矿臂) | 0.95 | 方钝·工具感 |
| `industrial_cruiser` | 霍克/奋进级(占位) | 7.0 | 2 | 2(采矿臂) | 1.3 | 加大方钝 |
| `boss` | 各势力领主/君王 | ≈battleship×1.3 | 3 | 5 | 2.1 | 超尺寸·尖刺威慑 |

> 敌人同档位复用同参数；`boss` 在对应尺寸上 ×1.3 并叠加尖刺/不对称元素。

---

## 4. 专精剪影家族（silhouette family）

同一专精的玩家线与敌人势力**共享剪影语法**，使战斗可读性最大化：

| 专精 | 武器 | 船体形态 | 关键视觉特征 | 代表舰 |
|---|---|---|---|---|
| **护盾 Shield** | 激光(laser) | 前收流线 | 前突尖、平滑舷、中央发光穹顶、细发光炮口 | 裂谷级 / 天使全系 |
| **装甲 Armor** | 导弹(missile) | 厚板方钝 | 侧装甲板、箱式发射器、低矮敦实 | 茶隼级 / 血袭者全系 |
| **结构 Structure** | 炮台(cannon) | 尖刺不对称 | 外露骨架、锐利翼刃、攻击性前伸 | 阿特龙级 / 萨沙全系 |

`ShipFactory.buildShip(spec)` 应增加 `family` 字段（`shield/armor/structure`），据此微调 `latheHull` 轮廓与翼型：
- `shield`：轮廓更尖、穹顶发光球、薄翼。
- `armor`：轮廓更方、加侧装甲板、厚翼。
- `structure`：轮廓带棱刺、翼刃化、略不对称。

---

## 5. 完整舰船映射表

### 5.1 玩家舰船（15 艘，含 3 混血）

| 舰名 | id | 档位 | 专精(线) | 武器 | 调色板 |
|---|---|---|---|---|---|
| 裂谷级 | `rifter` | frigate | 护盾 | laser | 玩家·护盾 |
| 茶隼级 | `kestrel` | frigate | 装甲 | missile | 玩家·装甲 |
| 阿特龙级 | `atron` | frigate | 结构 | cannon | 玩家·结构 |
| 雷光级 | `raylight` | destroyer | 护盾 | laser | 玩家·护盾 |
| 矛隼级 | `spearfalcon` | destroyer | 装甲 | missile | 玩家·装甲 |
| 疾锋级 | `swiftblade` | destroyer | 结构 | cannon | 玩家·结构 |
| 疾风级 | `gale` | destroyer(混血) | 护盾 | laser | 玩家·护盾(天使技术底色) |
| 血刺级 | `bloodthorn` | destroyer(混血) | 装甲 | missile | 玩家·装甲(血袭技术底色) |
| 暗影级 | `umbra` | destroyer(混血) | 结构 | cannon | 玩家·结构(萨沙技术底色) |
| 曙光级 | `dawnlight` | cruiser | 护盾 | laser | 玩家·护盾 |
| 战隼级 | `warfalcon` | cruiser | 装甲 | missile | 玩家·装甲 |
| 烈锋级 | `stormblade` | cruiser | 结构 | cannon | 玩家·结构 |
| 曜光级 | `sunlance` | battleship | 护盾 | laser | 玩家·护盾 |
| 堡隼级 | `fortfalcon` | battleship | 装甲 | missile | 玩家·装甲 |
| 震锋级 | `thunderblade` | battleship | 结构 | cannon | 玩家·结构 |

### 5.2 工业舰船（4 艘）

| 舰名 | id | 档位 | 备注 |
|---|---|---|---|
| 冲锋者级 | `miner_frigate` | industrial_frigate | 采矿臂 |
| 勘探者级 | `gas_frigate` | industrial_frigate | 采气臂 |
| 霍克级 | `miner_cruiser` | industrial_cruiser | 占位(Lv.50) |
| 奋进级 | `gas_cruiser` | industrial_cruiser | 占位(Lv.50) |

### 5.3 敌人势力（3 势力 × 同档位原型）

每个敌人类型 = **势力调色板 + 档位原型 + 势力专精武器**。normal/elite/boss 只改缩放与细节，不改原型。

| 势力 | 专精 | 档位原型（含 normal/elite/boss 类型） |
|---|---|---|
| **天使集团** (shield/laser) | 护盾 | `scout`·`raider`(frigate) / `patrol_destroyer`·`raider_destroyer`(destroyer) / `strike_cruiser`·`war_cruiser`(cruiser) / `siege_battleship`·`marauder_battleship`(battleship) / `commander`·`hunter_commander`·`fleet_commander`·`war_master`(boss 序列) |
| **血袭者** (armor/missile) | 装甲 | `acolyte`·`priest`(frigate) / `ritual_destroyer`·`blood_destroyer`(destroyer) / `sermon_cruiser`·`sacrament_cruiser`(cruiser) / `iron_battleship`·`apostle_battleship`(battleship) / `cardinal`·`high_priest`·`blood_archon`·`blood_sovereign`(boss) |
| **萨沙共和国** (structure/cannon) | 结构 | `drone`·`sentinel`(frigate) / `control_destroyer`·`sentinel_destroyer`(destroyer) / `assimilation_cruiser`·`dominion_cruiser`(cruiser) / `command_battleship`·`domination_battleship`(battleship) / `overlord`·`control_overlord`·`nexus_overlord`·`matrix_overlord`(boss) |

> 敌人 `image` 字段（如 `images/enemies/天使侦查舰.png`）仅 2D 图鉴用；3D 由 `buildShip({faction, hull:档位, weapon})` 生成。

---

## 6. 扩展规范（加一艘船 = 填一行）

新增舰船只需在数据层加定义，3D 无需改代码：
1. 在 `ships.js` / `combat.js` 加该舰的 `type`（决定档位/HULL_PRESET）、`recommendedWeapon` / 势力（决定专精与调色板）。
2. 在渲染层用 `buildShip({ id, role, line, hull:type, weapon })` 即可——只要 `type` 与 `line` 命中第 3/4/5 节的原型。
3. **禁止**为单艘船特制几何体；特殊外观需求一律沉淀为"新档位"或"新专精家族"，惠及全体。

---

## 7. 对接 ShipFactory（待实现清单）

`js/render3d/ShipFactory.js` 当前接口 `buildShip({id,role,hull,weapon})` 需演进为：

- `COLORS`：由单色 → 按 `(role, line)` 取 6 套调色板（第 2 节）。
- `HULL_PRESETS`：重命名为游戏真实档位（`frigate/destroyer/cruiser/battleship/industrial_frigate/industrial_cruiser/boss`），参数见第 3 节。
- 新增 `family`（shield/armor/structure）→ 微调 `latheHull` 轮廓 + 翼型（第 4 节）。
- `spec.line`：`player`/`angel`/`blood`/`sansha`，决定调色板与 boss 细节。
- 武器挂点数量随档位（第 3 节 mounts 列）。

> 详见 `ART_DIRECTION.md`（美术总方向）与 `CODE_REVIEW_2026-07-19.md`（架构回归，战斗 3D 接入时一并修 A2/A3）。
