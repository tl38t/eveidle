// ShipStyleProfile.js — Phase 5 Commit 2：种族设计哲学参数表
//
// 这不是颜色表。颜色已交给 MaterialFactory。
// 这里描述的是「这个文明如何制造东西」——设计哲学，而非外观配色。
//
// 设计原则：
//   - 同一个 Generator + 不同 Style Profile → 完全不同的视觉（通过参数空间而非换 Generator）
//   - 参数是倍率/概率，不是绝对值（Generator 内部有自己的 base 值，style 参数乘上去）
//   - Profile 是只读静态数据，由 ShipContext 注入 ctx.style，Generator 只读不写（对齐 §18 §19）
//
// 数据流（Phase 5 C2）：
//   ShipFactory2 → ShipContext(style = resolveStyle(family, faction)) → ctx.style → Generator（C3 起消费）
//
// 依赖方向：ShipStyleProfile 是纯数据模块，不依赖任何 Generator / THREE / ShipContext。

// ── Faction Style Profile Schema ──
//
// StyleProfile = {
//   faction:          string,     // 唯一标识（如 "player_shield", "angel"）
//   displayName:      string,     // 人类可读名称
//   surfaceLanguage:  string,     // 表面设计语言标签（military / fortress_engineering / organic / ...）
//
//   // 密度参数（倍率，1.0 = Generator 默认 base 值）
//   panelDensity:     number,     // 装甲板密度
//   grooveDensity:    number,     // 机械刻槽密度
//   heatDensity:      number,     // 散热结构密度（HeatSink + Vent）
//   ventDensity:      number,     // 通风格栅密度
//   hatchDensity:     number,     // 维修舱门密度
//
//   // 尺寸参数（Phase 5 Rework 新增 — 目前仅 player_armor 设置，其他族用 || 1.0 fallback）
//   panelScale:       number,     // 装甲板尺寸倍率（Armor=1.8 巨大分区）
//   panelVariation:   number,     // 面板间变异度
//   grooveWidth:      number,     // 刻槽宽度倍率（Armor=1.8 宽拼接缝）
//   grooveDepth:      number,     // 刻槽深度倍率
//   hatchSize:        number,     // 舱门尺寸倍率（Armor=2.0 巨大入口）
//   heatExposure:     number,     // 散热暴露度（Armor=0.3 半隐藏）
//
//   // 武器参数（Phase 5 Rework 新增）
//   weaponMount:      string,     // 武器类型（"turret" = 炮塔，默认 = 无/其他）
//   weaponSizeMul:    number,     // 武器尺寸倍率
//   weaponCountMul:   number,     // 武器数量倍率
//
//   // 能源参数（Phase 5 Rework 新增）
//   ribbonIntensity:  number,     // 能量线强度倍率（Armor=0.5 暗淡）
//
//   // 结构参数
//   symmetry:         number,     // 对称性 (0=完全不对称, 1=完美对称)
//   exposedMechanics: number,     // 机械暴露程度 (0=完全隐藏, 1=完全暴露)
//   curveSmoothness:  number,     // 曲面平滑度 (0=棱角, 1=流线)
//   edgeRadius:       number,     // 边缘倒角程度 (0=锐利, 1=圆角)
//   variation:        number,     // 组件间变异度 (0=统一模板, 1=高度随机)
//   armorThickness:   number,     // 装甲厚度感 (0=轻薄, 1=厚重感)
// }

// ═══════════════════════════════════════════════════
//  六族 Style Profile
// ═══════════════════════════════════════════════════

export const STYLE_PROFILES = {

  // ── 玩家三族 ──

  // player_shield：高科技护盾线。模块化、干净、蓝白能源。
  //   视觉特征：Panel 多、Groove 少、大面积连续装甲、HeatSink 隐藏、Ribbon 明显。
  player_shield: {
    faction:          "player_shield",
    displayName:      "Player Shield",
    surfaceLanguage:  "military",

    panelDensity:     1.0,
    grooveDensity:    1.0,
    heatDensity:      1.0,
    ventDensity:      1.0,
    hatchDensity:     1.0,

    symmetry:         1.0,
    exposedMechanics: 0.4,
    curveSmoothness:  0.5,
    edgeRadius:       0.3,
    variation:        0.5,
    armorThickness:   0.5,
  },

  // player_armor：装甲线。Fortress Engineering — 不是穿着装甲的船，是被推进器推动的太空堡垒。
  //   视觉特征：Armor 厚、Hatch 少但巨大、Groove 少但深宽、HeatSink 半隐藏、Panel 巨大分区。
  //   设计哲学："你尽管打，我还能继续战斗。"
  player_armor: {
    faction:          "player_armor",
    displayName:      "Player Armor",
    surfaceLanguage:  "fortress_engineering",

    // 密度参数（倍率，1.0 = Generator 默认 base 值）
    panelDensity:     0.7,    // 少但巨大
    grooveDensity:    0.7,    // 少但深宽
    heatDensity:      0.8,    // 装甲内部散热
    ventDensity:      0.7,
    hatchDensity:     0.4,    // 少量但巨大

    // 尺寸参数（Phase 5 Rework 新增 — Armor 专属）
    panelScale:       1.8,    // 巨大装甲分区
    panelVariation:   0.2,    // 低变异——统一模板
    grooveWidth:      2.1,    // 宽拼接缝（B：更宽更可见）
    grooveDepth:      1.8,    // 深凹陷（B：更深）
    hatchSize:        2.0,    // 巨大维护入口
    heatExposure:     0.85,   // 散热鳍片明显可见（B：0.55→0.85）

    // 武器参数
    weaponMount:      "turret",
    weaponSizeMul:    1.3,
    weaponCountMul:   0.8,

    // 能源参数
    ribbonIntensity:  0.95,   // 能量线较亮但仍弱于盾系（B：0.5→0.95）

    // 结构参数
    symmetry:         0.9,
    exposedMechanics: 0.5,
    curveSmoothness:  0.35,
    edgeRadius:       0.15,
    variation:        0.4,
    armorThickness:   0.8,
  },

  // player_structure：骨架舰。低成本、模块拼装、轻量。
  //   视觉特征：Panel 少、框架多、Vent 多、裸露机械。
  player_structure: {
    faction:          "player_structure",
    displayName:      "Player Structure",
    surfaceLanguage:  "skeletal",

    panelDensity:     0.5,    // 稀疏面板——骨架舰
    grooveDensity:    0.6,
    heatDensity:      1.1,
    ventDensity:      1.4,    // 大量通风——暴露内部
    hatchDensity:     0.8,

    symmetry:         0.7,
    exposedMechanics: 0.7,    // 高度暴露
    curveSmoothness:  0.25,
    edgeRadius:       0.1,
    variation:        0.6,
    armorThickness:   0.3,
  },

  // ── 海盗三族 ──

  // angel：有机流线。高曲率、低机械暴露、生物感光滑曲面。
  //   关键：不是"金色玩家"——是流线 + 对称 + 低机械暴露。
  angel: {
    faction:          "angel",
    displayName:      "Angel Cartel",
    surfaceLanguage:  "organic",

    panelDensity:     0.45,
    grooveDensity:    0.3,
    heatDensity:      0.5,
    ventDensity:      0.4,
    hatchDensity:     0.3,

    symmetry:         0.8,
    exposedMechanics: 0.1,    // 几乎不暴露机械
    curveSmoothness:  0.95,   // 极高曲率——流线体
    edgeRadius:       0.9,     // 大面积倒角
    variation:        0.2,    // 低变异——稳定有机形态
    armorThickness:   0.4,
  },

  // blood：血腥工业。高热、暴力改造、半生物机械。
  //   关键：不是"红色玩家"——是高热 + 暴露机械 + 粗犷。
  blood: {
    faction:          "blood",
    displayName:      "Blood Raider",
    surfaceLanguage:  "industrial_aggressive",

    panelDensity:     1.4,
    grooveDensity:    1.5,
    heatDensity:      1.6,    // 极高散热需求
    ventDensity:      1.3,
    hatchDensity:     1.2,

    symmetry:         0.6,    // 不对称——暴力改造
    exposedMechanics: 0.8,    // 大量暴露机械
    curveSmoothness:  0.3,
    edgeRadius:       0.1,
    variation:        0.7,     // 高变异——手工改造感
    armorThickness:   0.7,
  },

  // sansha：统一工业模板。不是自然文明，是被控制的。
  //   关键：对称到极致、零变异、统一模板——没有个性就是它的个性。
  sansha: {
    faction:          "sansha",
    displayName:      "Sansha's Nation",
    surfaceLanguage:  "unified_template",

    panelDensity:     0.8,
    grooveDensity:    0.5,
    heatDensity:      0.9,
    ventDensity:      0.9,
    hatchDensity:     1.0,

    symmetry:         1.0,    // 绝对对称——统一控制
    exposedMechanics: 0.2,
    curveSmoothness:  0.4,
    edgeRadius:       0.2,
    variation:        0.0,    // 零变异——没有个性
    armorThickness:   0.6,
  },

  // ── 功能舰（非战斗）──

  // industrial：ORE 风格工业舰。厚重、模块化、暴露机械、警示条。
  //   视觉特征：Panel 大分区、Groove 少、HeatSink 多（采矿激光发热）、Hazard 条。
  //   设计哲学："能装、能挖、扛得住。"——实用主义。
  industrial: {
    faction:          "industrial",
    displayName:      "Industrial / ORE",
    surfaceLanguage:  "utility_heavy",

    panelDensity:     0.9,
    grooveDensity:    0.4,
    heatDensity:      1.3,    // 采矿激光高发热
    ventDensity:      1.1,
    hatchDensity:     0.8,

    symmetry:         0.85,
    exposedMechanics: 0.6,
    curveSmoothness:  0.2,    // 棱角——货舱船体
    edgeRadius:       0.1,
    variation:        0.5,
    armorThickness:   0.7,
  },

  // archaeology：探索/扫描舰。流线、低机械暴露、传感器外露、扫描辉光。
  //   视觉特征：Panel 少、Ribbon 弱扫描线、Sensor 强（扫描阵列/探针）、曲线高。
  //   设计哲学："看得远比打得狠重要。"——隐秘探索。
  archaeology: {
    faction:          "archaeology",
    displayName:      "Archaeology / Explorer",
    surfaceLanguage:  "explorer_sleek",

    panelDensity:     0.5,
    grooveDensity:    0.3,
    heatDensity:      0.6,
    ventDensity:      0.7,
    hatchDensity:     0.5,

    symmetry:         0.8,
    exposedMechanics: 0.25,
    curveSmoothness:  0.9,    // 流线——探索艇
    edgeRadius:       0.8,
    variation:        0.3,
    armorThickness:   0.4,
  },
};

// ── 冻结：所有 Profile 为只读 ──
for (const key of Object.keys(STYLE_PROFILES)) {
  Object.freeze(STYLE_PROFILES[key]);
}
Object.freeze(STYLE_PROFILES);

// ═══════════════════════════════════════════════════
//  resolveStyle —— 根据 family + faction 解析 Style Profile
// ═══════════════════════════════════════════════════
//
// 参数：
//   family  锚点的 family 字段（"shield" / "armor" / "structure"），来自 Anchor
//   faction 显式 faction 标识（"angel" / "blood" / "sansha"），来自 spec.faction
//
// 解析规则：
//   1. 如果 faction 明确指向一个海盗势力 → 用海盗 Profile
//   2. 否则根据 family → 用对应的玩家 Profile
//   3. 兜底 → player_shield
//
// 返回值：只读 StyleProfile 对象。
export function resolveStyle(family, faction) {
  // 海盗势力优先
  if (faction && STYLE_PROFILES[faction]) return STYLE_PROFILES[faction];

  // 玩家势力：family → style key
  const playerKey = `player_${family}`;
  if (STYLE_PROFILES[playerKey]) return STYLE_PROFILES[playerKey];

  // 兜底
  return STYLE_PROFILES.player_shield;
}
