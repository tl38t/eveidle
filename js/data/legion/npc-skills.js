// ================================================================
// 军团 DLC —— NPC 技能定义（21 种）
// ----------------------------------------------------------------
// 技能名称、A/B/C/D 品质与数值规则严格沿用《军团DLC头脑风暴.md》
// 已确定的「NPC 词条命名与数值」表，不重新设计数值。
//
// 字段说明：
//   id        : 内部稳定 id（NPC 数据 skillId 用）
//   type      : 技能类型中文名（与需求清单一致）
//   name      : NPC 词条名（既有设计）
//   category  : 文案/匹配大类 production / combat / archaeology / management
//   shipClass : 经验/匹配用舰船大类 industrial / combat / archaeology；
//               management 为 null（不与舰船类型挂钩，按空间站建筑等级计算）
//   grades    : A/B/C/D 基础效果(base) 与每次强化(per)，单位 %
//   effect    : 仅用于展示的简短说明，不含计算公式
//
// 等级权重（沿用已确定方案）：A 5% / B 15% / C 30% / D 50%
// 兼容双环境：浏览器挂 window.LEGION_NPC_SKILLS，Node 下 module.exports。
// ================================================================
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  if (typeof window !== "undefined") window.LEGION_NPC_SKILLS = mod;
  else if (root) root.LEGION_NPC_SKILLS = mod;
})(typeof self !== "undefined" ? self : this, function () {
  // 高数值组：D1.0/C1.3/B1.6/A2.0，每次强化 +0.15/+0.20/+0.25/+0.30
  const HIGH = {
    A: { base: 2.0, per: 0.30 },
    B: { base: 1.6, per: 0.25 },
    C: { base: 1.3, per: 0.20 },
    D: { base: 1.0, per: 0.15 }
  };
  // 低数值组：D0.5/C0.7/B0.9/A1.2，每次强化 +0.10/+0.12/+0.15/+0.20
  const LOW = {
    A: { base: 1.2, per: 0.20 },
    B: { base: 0.9, per: 0.15 },
    C: { base: 0.7, per: 0.12 },
    D: { base: 0.5, per: 0.10 }
  };

  const SKILLS = [
    // ===== 采集与生产 =====
    { id: "mining",                type: "采矿",                   name: "矿脉勘探", category: "production", shipClass: "industrial", grades: HIGH, effect: "提升采矿效率" },
    { id: "planetaryIndustry",     type: "行星开发",               name: "行星统筹", category: "production", shipClass: "industrial", grades: HIGH, effect: "自动产出行星材料" },
    { id: "refining",              type: "冶炼",                   name: "熔炉调谐", category: "production", shipClass: "industrial", grades: HIGH, effect: "提升矿石精炼产出" },
    { id: "gasHarvesting",         type: "气体采集",               name: "气云析取", category: "production", shipClass: "industrial", grades: HIGH, effect: "提升气体采集效率" },
    { id: "shipEngineering",       type: "舰船工程",               name: "舰构工程", category: "production", shipClass: "industrial", grades: HIGH, effect: "提升舰船部件与整船建造" },
    { id: "equipmentEngineering",  type: "装备工程",               name: "装备装配", category: "production", shipClass: "industrial", grades: HIGH, effect: "提升装备与弹药制造" },
    { id: "boosterEngineering",    type: "增强剂制造",             name: "配方调制", category: "production", shipClass: "industrial", grades: HIGH, effect: "提升增强剂制造" },

    // ===== 战斗 =====
    { id: "laserOps",              type: "激光操作",               name: "激光火控", category: "combat", shipClass: "combat", grades: HIGH, effect: "提升激光炮伤害与应用" },
    { id: "cannonOps",             type: "炮台操作",               name: "炮台校准", category: "combat", shipClass: "combat", grades: HIGH, effect: "提升炮台伤害与应用" },
    { id: "missileOperations",     type: "导弹操作",               name: "制导算法", category: "combat", shipClass: "combat", grades: HIGH, effect: "提升导弹伤害与应用" },
    { id: "shieldOperation",       type: "护盾操作",               name: "护盾整流", category: "combat", shipClass: "combat", grades: HIGH, effect: "提升护盾容量" },
    { id: "armorReinforcement",    type: "装甲强化",               name: "装甲整备", category: "combat", shipClass: "combat", grades: HIGH, effect: "提升装甲容量" },
    { id: "hullEngineering",       type: "船体工程",               name: "船体加固", category: "combat", shipClass: "combat", grades: HIGH, effect: "提升结构容量" },
    { id: "capacitorManagement",   type: "电容管理",               name: "电容节流", category: "combat", shipClass: "combat", grades: LOW,  effect: "降低燃料消耗（战斗/考古通用）" },
    { id: "lootSearch",            type: "战斗稀有掉率",           name: "战利品搜寻", category: "combat", shipClass: "combat", grades: LOW,  effect: "提升战斗稀有掉落" },

    // ===== 考古 =====
    { id: "archaeologySpeed",      type: "考古速度",               name: "遗迹解析", category: "archaeology", shipClass: "archaeology", grades: HIGH, effect: "提升遗迹解析速度" },
    { id: "archaeologyLoot",       type: "考古稀有掉率",           name: "遗物鉴定", category: "archaeology", shipClass: "archaeology", grades: LOW,  effect: "提升考古稀有掉落" },

    // ===== 管理 =====
    { id: "autolineSpeed",         type: "自动线速度",             name: "产线调度", category: "management", shipClass: null, grades: LOW,  effect: "提升自动线速度" },
    { id: "shipComponentCostReduce", type: "舰船组件制造消耗降低", name: "舰材回收", category: "management", shipClass: null, grades: LOW,  effect: "降低舰船组件制造消耗" },
    { id: "xpGain",                type: "玩家与 NPC 经验获取",    name: "训练教范", category: "management", shipClass: null, grades: LOW,  effect: "提升玩家与 NPC 经验获取" },
    { id: "wageReduce",            type: "NPC 工资降低",           name: "薪资统筹", category: "management", shipClass: null, grades: HIGH, effect: "降低 NPC 工资" }
  ];

  // 等级权重（已确定）：A 5 / B 15 / C 30 / D 50
  const GRADE_WEIGHTS = { A: 5, B: 15, C: 30, D: 50 };

  return { SKILLS, GRADE_WEIGHTS };
});
