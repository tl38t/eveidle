// CivilizationProfile.js — Phase 5 Rework：六族文明视觉规范（数据层）
//
// 职责：定义六族的 hull 语言 + 结构生成参数。这是纯数据模块，不依赖 THREE。
//
// 与 ShipStyleProfile 的关系（Complement）：
//   - ShipStyleProfile 管密度参数（panelDensity/grooveDensity 等）→ Panel/Groove/HeatSink Generator
//   - CivilizationProfile 管 hull 语言 + 骨架/装甲/有机/过载/模块参数 → CivilizationModifier
//   两者互补，不冲突。
//
// Schema：
//   CivilizationProfile = {
//     id:           string,    // 唯一标识（faction key）
//     displayName:  string,
//     hullType:     string,    // "lathe"|"box"|"frame"|"organic"|"overloaded"|"modular"
//     hullParams: {            // hull 生成参数
//       widthMul,              // 宽窄倍率（1.0=基准）
//       noseShape,             // "sharp"|"bullet"|"flat"|"cone"
//       midStyle,              // "smooth"|"flat"|"stepped"
//       armorBlocks,           // bool — 外挂装甲块
//       armorBlockSize,        // 0~1 — 装甲块尺寸
//       frameExposed,          // 0~1 — 骨架暴露度
//       frameBeamCnt,          // 纵向梁数
//       reactorExternal,       // bool — 外露能源核心
//       reactorScale,          // 0~1 — 反应器尺寸
//       pipeDensity,           // 0~1 — 外挂管线密度
//       moduleRepeat,          // 0~1 — 模块重复度
//       moduleGap,             // 0~1 — 模块间隙
//       asymmetry,             // 0~1 — 不对称度
//       organicBulge,          // 0~1 — 有机膨胀度
//     }
//   }
//
// 依赖方向：CivilizationProfile 是纯数据模块，不依赖任何 Generator / THREE / ShipContext。

// ═══════════════════════════════════════════════════
//  六族 Civilization Profile
// ═══════════════════════════════════════════════════

export const CIVILIZATIONS = {

  // ── 1. Player Shield：标准军舰（当前 HullGenerator pass-through）──
  //    保留环 + 浮游炮，唯一不走 CivilizationModifier 的族。
  player_shield: {
    id:          "player_shield",
    displayName: "Player Shield",
    hullType:    "lathe",           // 保持 HullGenerator 原始输出
    hullParams: {
      widthMul:        1.0,
      noseShape:      "sharp",
      midStyle:        "smooth",
      armorBlocks:     false,
      frameExposed:    0,
      reactorExternal: false,
      pipeDensity:     0,
      moduleRepeat:    0,
      asymmetry:       0,
      organicBulge:    0,
    }
  },

  // ── 2. Player Armor：移动堡垒（Fortress Engineering）──
  //    不是穿着装甲的船，是被推进器推动的太空堡垒。
  //    宽厚短稳的箱体 + 外挂巨型装甲块。
  player_armor: {
    id:          "player_armor",
    displayName: "Player Armor",
    hullType:    "box",
    hullParams: {
      widthMul:         1.25,      // 宽体 —— 坦克感（widthBias）
      lengthMul:        0.9,       // 短稳 —— 不细长（lengthBias）
      mass:             1.5,       // 质量感（视觉厚重）
      volume:           1.3,       // 体积感
      noseShape:        "flat",    // 平头
      midStyle:         "stepped", // 台阶式中段
      armorBlocks:      true,      // 外挂装甲块 ⬛（ArmorBlockGenerator 消费）
      armorBlockSize:   0.75,
      frameExposed:     0.15,      // 几乎不暴露骨架
      reactorExternal:  false,
      pipeDensity:       0.2,
      moduleRepeat:      0,
      asymmetry:         0,
      organicBulge:      0,
    }
  },

  // ── 3. Player Structure：工程骨架 ──
  //    裸露框架 + 梁桁，不是完整外壳
  player_structure: {
    id:          "player_structure",
    displayName: "Player Structure",
    hullType:    "frame",
    hullParams: {
      widthMul:         0.85,      // 略窄——骨架感
      noseShape:        "sharp",
      midStyle:         "smooth",
      armorBlocks:      false,
      frameExposed:     0.85,      // 高度暴露骨架
      frameBeamCnt:     6,         // 6 根纵向梁
      reactorExternal:  false,
      pipeDensity:       0.7,      // 管道暴露
      moduleRepeat:      0,
      asymmetry:         0,
      organicBulge:      0,
    }
  },

  // ── 4. Angel：生物机械 ──
  //    有机流线 + 单侧膨胀 + 非完全对称
  angel: {
    id:          "angel",
    displayName: "Angel Cartel",
    hullType:    "organic",
    hullParams: {
      widthMul:         1.15,
      noseShape:        "bullet",  // 子弹头——圆润鼻端
      midStyle:         "smooth",
      armorBlocks:      false,
      frameExposed:     0,
      reactorExternal:  false,
      pipeDensity:       0,
      moduleRepeat:      0,
      asymmetry:         0.7,       // 不对称生长
      organicBulge:      0.8,       // 单侧膨胀
    }
  },

  // ── 5. Blood Raider：疯狂改造 ──
  //    外露反应器 + 管道环绕
  blood: {
    id:          "blood",
    displayName: "Blood Raider",
    hullType:    "overloaded",
    hullParams: {
      widthMul:         0.95,
      noseShape:        "sharp",
      midStyle:         "flat",
      armorBlocks:      false,
      frameExposed:     0,
      reactorExternal:  true,       // 外露核心 ◎
      reactorScale:     0.55,       // 大号反应器
      pipeDensity:       1.0,       // 满管线
      moduleRepeat:      0,
      asymmetry:         0.2,       // 轻微不对称——暴力改造
      organicBulge:      0,
    }
  },

  // ── 6. Sansha's Nation：AI 复制 ──
  //    完美重复模块 + 绝对对称
  sansha: {
    id:          "sansha",
    displayName: "Sansha's Nation",
    hullType:    "modular",
    hullParams: {
      widthMul:         1.0,
      noseShape:        "sharp",
      midStyle:         "stepped",  // 台阶式——模块感
      armorBlocks:      false,
      frameExposed:     0,
      reactorExternal:  false,
      pipeDensity:       0,
      moduleRepeat:      1.0,       // 完全重复
      moduleGap:         0.06,      // 固定间隙
      asymmetry:         0,
      organicBulge:      0,
    }
  },

  // ── 7. Industrial / ORE：功能工业舰 ──
  //    宽厚货舱体 + 棱角装甲 + 外露机械；采矿激光臂 / 采气采集器为签名挂载。
  industrial: {
    id:          "industrial",
    displayName: "Industrial / ORE",
    hullType:    "industrial",
    hullParams: {
      widthMul:         1.35,      // 宽体——货舱感
      lengthMul:        0.95,
      mass:             1.4,
      noseShape:        "flat",    // 平头货舱
      midStyle:         "box",     // 方正中段
      armorBlocks:      false,
      frameExposed:     0.1,
      reactorExternal:  false,
      pipeDensity:       0.4,
      moduleRepeat:      0,
      asymmetry:         0,
      organicBulge:      0,
    }
  },

  // ── 8. Archaeology / Explorer：探索扫描舰 ──
  //    流线体 + 脊背传感器桅 + 侧向扫描翼；扫描阵列 / 探针发射舱为签名挂载。
  archaeology: {
    id:          "archaeology",
    displayName: "Archaeology / Explorer",
    hullType:    "archaeology",
    hullParams: {
      widthMul:         0.95,
      noseShape:        "sharp",
      midStyle:         "smooth",  // 流线中段
      armorBlocks:      false,
      frameExposed:     0,
      reactorExternal:  false,
      pipeDensity:       0,
      moduleRepeat:      0,
      asymmetry:         0,
      organicBulge:      0,
      scanWings:         true,     // 侧向扫描翼
      probeNacelles:     true,     // 探针发射舱
    }
  },
};

// ── 冻结 ──
for (const key of Object.keys(CIVILIZATIONS)) {
  Object.freeze(CIVILIZATIONS[key]);
  Object.freeze(CIVILIZATIONS[key].hullParams);
}
Object.freeze(CIVILIZATIONS);

// ═══════════════════════════════════════════════════
//  resolveCivilization —— faction + family → CivilizationProfile
// ═══════════════════════════════════════════════════
export function resolveCivilization(faction, family) {
  // 海盗势力优先
  if (faction && CIVILIZATIONS[faction]) return CIVILIZATIONS[faction];

  // 玩家：family → player_xxx
  const key = `player_${family || "shield"}`;
  if (CIVILIZATIONS[key]) return CIVILIZATIONS[key];

  return CIVILIZATIONS.player_shield;
}

// 枚举所有 civ ID，供 Ship Lab 下拉等使用
export const CIV_IDS = Object.keys(CIVILIZATIONS);
