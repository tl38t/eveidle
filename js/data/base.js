/* ================================================================
   EVE放置：新伊甸纪元 — 数据定义
   ================================================================ */

// ---- 矿石 → 矿物冶炼映射表 ----
const ORE_TO_MINERAL = {
  "凡晶石":   { mineral: "三钛合金",     level: 1 },
  "灼烧岩":   { mineral: "类银超金属",   level: 10 },
  "水硼砂":   { mineral: "类晶体胶矿",   level: 20 },
  "斜长岩":   { mineral: "同位聚合体",   level: 40 },
  "干焦岩":   { mineral: "超新星诺克石", level: 55 },
  "灰岩":     { mineral: "基腹断岩",     level: 70 },
  "艾克诺岩": { mineral: "超噬矿",       level: 85 }
};

// ---- 技能初始状态 ----
const INITIAL_SKILLS = {
  mining:                  { lvl: 1, xp: 0 },
  planetaryIndustry:       { lvl: 1, xp: 0 },
  refining:                { lvl: 1, xp: 0 },
  gasHarvesting:           { lvl: 1, xp: 0 },
  shipEngineering:         { lvl: 1, xp: 0 },
  equipmentEngineering:    { lvl: 1, xp: 0 },
  rigEngineering:          { lvl: 1, xp: 0 },
  boosterEngineering:      { lvl: 1, xp: 0 }, // 增强剂系统 Phase 2A：增强剂制造独立技能，默认 Lv.1
  reverseEngineering:      { lvl: 1, xp: 0 },
  // 战斗攻击技能（三系独立）
  laserOps:                { lvl: 1, xp: 0 },
  cannonOps:               { lvl: 1, xp: 0 },
  missileOperations:       { lvl: 1, xp: 0 },
  // 战斗防御技能
  defense:                 { lvl: 1, xp: 0 },
  shieldOperation:         { lvl: 1, xp: 0 },
  armorReinforcement:      { lvl: 1, xp: 0 },
  hullEngineering:         { lvl: 1, xp: 0 },
  // 战斗辅助技能
  targeting:               { lvl: 1, xp: 0 },
  piloting:                { lvl: 1, xp: 0 },
  capacitorManagement:     { lvl: 1, xp: 0 },
  drones:                  { lvl: 1, xp: 0 },
  combat:                  { lvl: 1, xp: 0 }, // 旧存档兼容字段；界面战斗等级由六项战斗技能实时计算
  archaeology:             { lvl: 1, xp: 0 }  // 考古系统第二阶段：扫描遗迹、解析文物
};
