// ============================================================================
//  js/data/research.js
//  研究系统数据层 —— 批次 A
//
//  从 tools/research-tree-data.mjs【无损移植】的冻结数据：
//    NODES（38 节点）、WEIGHTS、RANK_MULT、TARGET_SECONDS、UNIT、前置关系。
//  数据逐字段与冻结源一致，不重新计算、不改名、不调整数值。
//  本文件为纯数据，不直接接入任何游戏运行逻辑；批次 A 仅新增此文件，
//  不修改 index.html / state.js / persistence.js / 任何其他既有文件。
//
//  暴露方式：挂到 window / globalThis（与既有 js/data/*.js 约定一致），
//  便于浏览器 <script> 与 Node VM 沙箱（审计）两种加载路径复用。
// ============================================================================

'use strict';

// ---------------------------------------------------------------------------
//  1. 时间模型常量（与冻结源逐字段一致，不得改动数值）
// ---------------------------------------------------------------------------
const DAYS = 90;
const TARGET_SECONDS = DAYS * 24 * 3600; // 7,776,000 秒

// 等级时间权重（A 组）：I 很快 → V 占据大部分时间
//   索引 0 = I, 1 = II, 2 = III, 3 = IV, 4 = V
const WEIGHTS = [1, 3, 9, 27, 81];

// 领域 rank 乘子（反映复杂度 / 重要度）
//   绝对值会被 UNIT 归一化，相对值决定各领域时间占比
const RANK_MULT = {
  foundation: 0.6,   // 4 个单级基础科技
  industry: 1.0,     // 工业（7 项数值）
  exploration: 0.9,  // 探索（5 项数值）
  combat: 1.1,       // 战斗（11 项数值）
  logistics: 0.9,    // 后勤（5 项数值）
  protocol: 2.5,     // 6 个单级协议节点
};

// ---------------------------------------------------------------------------
//  2. 节点数据（38 个）—— 与冻结源逐字段一致
//     category: foundation / industry / exploration / combat / logistics / protocol
//     era:      0(基础) 1(应用) 2(工程) 3(尖端) 4(协议与集成)
//     type:     foundation / numeric / protocol
//     maxLevel: 基础=1, 数值=5, 协议=1
//     rank:     领域 rank 乘子（= RANK_MULT[category]）
//     prerequisites: [{ id, level }]  —— 前置等级（单级节点只能 level:1）
//     effects:  按等级的满级描述数组（长度 = maxLevel，末位为满级）
//     bonus:    用于最终叠加测算的结构化字段
//     description: 简短说明
// ---------------------------------------------------------------------------
const NODES = [
  // ===== 基础科技（4 个单级） =====
  {
    id: "syseng", name: "系统工程", category: "foundation", era: 0, type: "foundation",
    maxLevel: 1, rank: RANK_MULT.foundation, prerequisites: [],
    effects: ["所有采集效率 +2%"],
    bonus: { group: "allMining", flat: 2, unit: "%" },
    description: "基础工程方法论，为所有科技领域提供理论支撑。提升所有采集效率。",
  },
  {
    id: "matsci", name: "材料科学", category: "foundation", era: 0, type: "foundation",
    maxLevel: 1, rank: RANK_MULT.foundation, prerequisites: [],
    effects: ["所有制造效率 +2%"],
    bonus: { group: "allMfg", flat: 2, unit: "%" },
    description: "研究材料的微观结构与宏观性能。提升所有制造效率。",
  },
  {
    id: "dataan", name: "数据分析", category: "foundation", era: 0, type: "foundation",
    maxLevel: 1, rank: RANK_MULT.foundation, prerequisites: [],
    effects: ["全武器伤害 +2%"],
    bonus: { group: "allWeapon", flat: 2, unit: "%" },
    description: "大规模数据处理与模式识别技术。提升全武器伤害。",
  },
  {
    id: "autocon", name: "自动控制", category: "foundation", era: 0, type: "foundation",
    maxLevel: 1, rank: RANK_MULT.foundation, prerequisites: [],
    effects: ["考古效率 +2%"],
    bonus: { group: "archEff", flat: 2, unit: "%" },
    description: "自动化系统与反馈控制理论。提升考古效率。",
  },

  // ===== 工业数值科技（7 个五级） =====
  {
    id: "mine", name: "采矿理论", category: "industry", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.industry, prerequisites: [{ id: "syseng", level: 1 }],
    effects: ["采矿效率 +1.2%", "采矿效率 +2.4%", "采矿效率 +3.6%", "采矿效率 +4.8%", "采矿效率 +6%"],
    bonus: { group: "mining", perLevel: 1.2, unit: "%" },
    description: "提升采矿设备的作业效率。",
  },
  {
    id: "gas", name: "气云动力学", category: "industry", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.industry, prerequisites: [{ id: "matsci", level: 1 }],
    effects: ["采气效率 +1.2%", "采气效率 +2.4%", "采气效率 +3.6%", "采气效率 +4.8%", "采气效率 +6%"],
    bonus: { group: "gas", perLevel: 1.2, unit: "%" },
    description: "研究气云采集与分离技术。",
  },
  {
    id: "smelt", name: "冶炼理论", category: "industry", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.industry, prerequisites: [{ id: "matsci", level: 1 }],
    effects: ["冶炼效率 +1.2%", "冶炼效率 +2.4%", "冶炼效率 +3.6%", "冶炼效率 +4.8%", "冶炼效率 +6%"],
    bonus: { group: "smelt", perLevel: 1.2, unit: "%" },
    description: "改进矿石冶炼工艺。",
  },
  {
    id: "equipeng", name: "装备工程理论", category: "industry", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.industry, prerequisites: [{ id: "syseng", level: 1 }, { id: "dataan", level: 1 }],
    effects: ["装备制造效率 +1.2%", "装备制造效率 +2.4%", "装备制造效率 +3.6%", "装备制造效率 +4.8%", "装备制造效率 +6%"],
    bonus: { group: "equip", perLevel: 1.2, unit: "%" },
    description: "加速装备制造流程。",
  },
  {
    id: "boostereng", name: "增强剂工程理论", category: "industry", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.industry, prerequisites: [{ id: "dataan", level: 1 }],
    effects: ["增强剂制造效率 +1.2%", "增强剂制造效率 +2.4%", "增强剂制造效率 +3.6%", "增强剂制造效率 +4.8%", "增强剂制造效率 +6%"],
    bonus: { group: "booster", perLevel: 1.2, unit: "%" },
    description: "提高增强剂合成速率。",
  },
  {
    id: "shipcomp", name: "舰船组件工程", category: "industry", era: 2, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.industry, prerequisites: [{ id: "mine", level: 3 }, { id: "smelt", level: 3 }],
    effects: ["组件制造效率 +1.2%", "组件制造效率 +2.4%", "组件制造效率 +3.6%", "组件制造效率 +4.8%", "组件制造效率 +6%"],
    bonus: { group: "shipComp", perLevel: 1.2, unit: "%" },
    description: "提升舰船部件的制造速度。",
  },
  {
    id: "shipasm", name: "舰船装配工程", category: "industry", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.industry, prerequisites: [{ id: "shipcomp", level: 4 }],
    effects: ["舰船总装效率 +1.2%", "舰船总装效率 +2.4%", "舰船总装效率 +3.6%", "舰船总装效率 +4.8%", "舰船总装效率 +6%"],
    bonus: { group: "shipAsm", perLevel: 1.2, unit: "%" },
    description: "加速舰船总装生产线。",
  },

  // ===== 探索数值科技（5 个五级） =====
  {
    id: "arch", name: "遗迹分析效率", category: "exploration", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.exploration, prerequisites: [{ id: "syseng", level: 1 }],
    effects: ["考古效率 +1.2%", "考古效率 +2.4%", "考古效率 +3.6%", "考古效率 +4.8%", "考古效率 +6%"],
    bonus: { group: "archEff", perLevel: 1.2, unit: "%" },
    description: "提升考古扫描与分析速度。",
  },
  {
    id: "signal", name: "信号解析", category: "exploration", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.exploration, prerequisites: [{ id: "dataan", level: 1 }],
    effects: ["考古成功率 +0.6pp", "考古成功率 +1.2pp", "考古成功率 +1.8pp", "考古成功率 +2.4pp", "考古成功率 +3pp"],
    bonus: { group: "archSuccess", perLevel: 0.6, unit: "pp" },
    description: "提高信号解码准确率。",
  },
  {
    id: "backlash", name: "反冲隔离", category: "exploration", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.exploration, prerequisites: [{ id: "matsci", level: 1 }],
    effects: ["反噬伤害 -1.2%", "反噬伤害 -2.4%", "反噬伤害 -3.6%", "反噬伤害 -4.8%", "反噬伤害 -6%"],
    bonus: { group: "backlash", perLevel: 1.2, unit: "%", negative: true },
    description: "降低遗迹反噬的破坏性。",
  },
  {
    id: "probe", name: "探针经济学", category: "exploration", era: 2, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.exploration, prerequisites: [{ id: "signal", level: 2 }],
    effects: ["探针消耗 -1.2%", "探针消耗 -2.4%", "探针消耗 -3.6%", "探针消耗 -4.8%", "探针消耗 -6%"],
    bonus: { group: "probe", perLevel: 1.2, unit: "%", negative: true },
    description: "减少考古探针的消耗量。",
  },
  {
    id: "dataarch", name: "数据归档", category: "exploration", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.exploration, prerequisites: [{ id: "signal", level: 3 }, { id: "probe", level: 3 }],
    effects: ["考古经验 +1.2%", "考古经验 +2.4%", "考古经验 +3.6%", "考古经验 +4.8%", "考古经验 +6%"],
    bonus: { group: "archExp", perLevel: 1.2, unit: "%" },
    description: "优化考古数据的存储与分析效率。",
  },

  // ===== 战斗数值科技（11 个五级） =====
  {
    id: "combat", name: "作战理论", category: "combat", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "syseng", level: 1 }, { id: "matsci", level: 1 }],
    effects: ["战斗经验 +1.2%", "战斗经验 +2.4%", "战斗经验 +3.6%", "战斗经验 +4.8%", "战斗经验 +6%"],
    bonus: { group: "combatExp", perLevel: 1.2, unit: "%" },
    description: "提升战斗经验获取效率。",
  },
  {
    id: "firectrl", name: "火控预测", category: "combat", era: 2, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "combat", level: 2 }],
    effects: ["全武器伤害 +0.6%", "全武器伤害 +1.2%", "全武器伤害 +1.8%", "全武器伤害 +2.4%", "全武器伤害 +3%"],
    bonus: { group: "weaponDmg", perLevel: 0.6, unit: "%" },
    description: "提高武器命中预测精度。",
  },
  {
    id: "defense", name: "防御工程", category: "combat", era: 2, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "combat", level: 2 }],
    effects: ["三层生命 +0.6%", "三层生命 +1.2%", "三层生命 +1.8%", "三层生命 +2.4%", "三层生命 +3%"],
    bonus: { group: "tierHp", perLevel: 0.6, unit: "%" },
    description: "增强舰船综合防御能力。",
  },
  {
    id: "laser", name: "激光物理", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "firectrl", level: 3 }],
    effects: ["激光伤害 +1.2%", "激光伤害 +2.4%", "激光伤害 +3.6%", "激光伤害 +4.8%", "激光伤害 +6%"],
    bonus: { group: "laserDmg", perLevel: 1.2, unit: "%" },
    description: "研究激光武器能量输出。",
  },
  {
    id: "missile", name: "导弹动力学", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "firectrl", level: 3 }],
    effects: ["导弹伤害 +1.2%", "导弹伤害 +2.4%", "导弹伤害 +3.6%", "导弹伤害 +4.8%", "导弹伤害 +6%"],
    bonus: { group: "missileDmg", perLevel: 1.2, unit: "%" },
    description: "优化导弹飞行与制导。",
  },
  {
    id: "projectile", name: "射弹弹道学", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "firectrl", level: 3 }],
    effects: ["射弹伤害 +1.2%", "射弹伤害 +2.4%", "射弹伤害 +3.6%", "射弹伤害 +4.8%", "射弹伤害 +6%"],
    bonus: { group: "projDmg", perLevel: 1.2, unit: "%" },
    description: "改进射弹武器的弹道特性。",
  },
  {
    id: "shield", name: "护盾谐振", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "defense", level: 3 }],
    effects: ["护盾容量 +1.2%", "护盾容量 +2.4%", "护盾容量 +3.6%", "护盾容量 +4.8%", "护盾容量 +6%"],
    bonus: { group: "shield", perLevel: 1.2, unit: "%" },
    description: "优化护盾发生器频率。",
  },
  {
    id: "armor", name: "装甲复合材料", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "defense", level: 3 }],
    effects: ["装甲容量 +1.2%", "装甲容量 +2.4%", "装甲容量 +3.6%", "装甲容量 +4.8%", "装甲容量 +6%"],
    bonus: { group: "armor", perLevel: 1.2, unit: "%" },
    description: "研发新型装甲合金。",
  },
  {
    id: "structure", name: "结构应力控制", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "defense", level: 3 }],
    effects: ["结构容量 +1.2%", "结构容量 +2.4%", "结构容量 +3.6%", "结构容量 +4.8%", "结构容量 +6%"],
    bonus: { group: "structure", perLevel: 1.2, unit: "%" },
    description: "改进舰船骨架结构。",
  },
  {
    id: "repair", name: "战场维修理论", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "defense", level: 3 }],
    effects: ["主动维修量 +1.2%", "主动维修量 +2.4%", "主动维修量 +3.6%", "主动维修量 +4.8%", "主动维修量 +6%"],
    bonus: { group: "repair", perLevel: 1.2, unit: "%" },
    description: "提升主动维修效率。",
  },
  {
    id: "tactical", name: "综合战术模型", category: "combat", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.combat, prerequisites: [{ id: "firectrl", level: 3 }, { id: "defense", level: 3 }],
    effects: ["伤害+三层生命 +0.3%", "伤害+三层生命 +0.6%", "伤害+三层生命 +0.9%", "伤害+三层生命 +1.2%", "伤害+三层生命 +1.5%"],
    bonus: { group: "tactical", perLevel: 0.3, unit: "%" },
    description: "火控与防御的交叉研究成果。",
  },

  // ===== 后勤数值科技（5 个五级） =====
  {
    id: "fuellog", name: "维护燃料管理", category: "logistics", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.logistics, prerequisites: [{ id: "matsci", level: 1 }],
    effects: ["维护燃料消耗 -1.8%", "维护燃料消耗 -3.6%", "维护燃料消耗 -5.4%", "维护燃料消耗 -7.2%", "维护燃料消耗 -9%"],
    bonus: { group: "fuel", perLevel: 1.8, unit: "%", negative: true },
    description: "减少空间站维护燃料需求。",
  },
  {
    id: "planfin", name: "行星财政管理", category: "logistics", era: 1, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.logistics, prerequisites: [{ id: "dataan", level: 1 }],
    effects: ["行星维护费 -1.8%", "行星维护费 -3.6%", "行星维护费 -5.4%", "行星维护费 -7.2%", "行星维护费 -9%"],
    bonus: { group: "planCost", perLevel: 1.8, unit: "%", negative: true },
    description: "降低行星基地维护费用。",
  },
  {
    id: "englog", name: "工程统筹", category: "logistics", era: 2, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.logistics, prerequisites: [{ id: "syseng", level: 1 }, { id: "fuellog", level: 2 }],
    effects: ["建设效率 +1.8%", "建设效率 +3.6%", "建设效率 +5.4%", "建设效率 +7.2%", "建设效率 +9%"],
    bonus: { group: "build", perLevel: 1.8, unit: "%" },
    description: "提高空间站建设工程效率。",
  },
  {
    id: "planind", name: "行星工业管理", category: "logistics", era: 2, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.logistics, prerequisites: [{ id: "planfin", level: 2 }],
    effects: ["行星生产效率 +1.8%", "行星生产效率 +3.6%", "行星生产效率 +5.4%", "行星生产效率 +7.2%", "行星生产效率 +9%"],
    bonus: { group: "planProd", perLevel: 1.8, unit: "%" },
    description: "提高行星基地生产效率。",
  },
  {
    id: "autolog", name: "自动线调度", category: "logistics", era: 3, type: "numeric",
    maxLevel: 5, rank: RANK_MULT.logistics, prerequisites: [{ id: "englog", level: 3 }, { id: "dataan", level: 1 }],
    effects: ["自动线效率 +1.8%", "自动线效率 +3.6%", "自动线效率 +5.4%", "自动线效率 +7.2%", "自动线效率 +9%"],
    bonus: { group: "autoline", perLevel: 1.8, unit: "%" },
    description: "优化自动生产线调度算法。",
  },

  // ===== 协议节点（6 个单级） =====
  {
    id: "intship", name: "一体化造船协议", category: "protocol", era: 4, type: "protocol",
    maxLevel: 1, rank: RANK_MULT.protocol,
    prerequisites: [{ id: "shipcomp", level: 5 }, { id: "shipasm", level: 5 }, { id: "mine", level: 5 }, { id: "smelt", level: 5 }, { id: "equipeng", level: 5 }, { id: "boostereng", level: 5 }],
    effects: ["自动计算→制造→总装 全链路"],
    bonus: null,
    description: "自动计算缺少的组件，依次制造，齐全后自动总装。",
  },
  {
    id: "autoenh", name: "自动强化协议", category: "protocol", era: 4, type: "protocol",
    maxLevel: 1, rank: RANK_MULT.protocol,
    prerequisites: [{ id: "shipasm", level: 5 }, { id: "shipcomp", level: 5 }, { id: "mine", level: 5 }, { id: "smelt", level: 5 }, { id: "equipeng", level: 5 }, { id: "boostereng", level: 5 }, { id: "gas", level: 5 }],
    effects: ["自动强化 不生产组件"],
    bonus: null,
    description: "消费仓库已有组件，自动连续执行舰船强化。",
  },
  {
    id: "planauto", name: "行星维护自动化", category: "protocol", era: 4, type: "protocol",
    maxLevel: 1, rank: RANK_MULT.protocol,
    prerequisites: [{ id: "planfin", level: 5 }, { id: "planind", level: 5 }, { id: "fuellog", level: 4 }, { id: "autocon", level: 1 }],
    effects: ["自动续费，保留最低星币"],
    bonus: null,
    description: "每个基地独立开启自动续费。",
  },
  {
    id: "autosell", name: "文物自动出售协议", category: "protocol", era: 4, type: "protocol",
    maxLevel: 1, rank: RANK_MULT.protocol,
    prerequisites: [{ id: "dataarch", level: 4 }, { id: "planfin", level: 4 }],
    effects: ["自动出售文物，获得星币"],
    bonus: null,
    description: "自动出售可回收为星币的物品。",
  },
  {
    id: "autoconv", name: "文物自动兑换协议", category: "protocol", era: 4, type: "protocol",
    maxLevel: 1, rank: RANK_MULT.protocol,
    prerequisites: [{ id: "dataarch", level: 5 }, { id: "planfin", level: 4 }],
    effects: ["自动兑换文物，获得功勋"],
    bonus: null,
    description: "自动兑换可回收为功勋的物品。",
  },
  {
    id: "autorepair", name: "野外自动维修协议", category: "protocol", era: 4, type: "protocol",
    maxLevel: 1, rank: RANK_MULT.protocol,
    prerequisites: [{ id: "backlash", level: 5 }, { id: "repair", level: 5 }, { id: "combat", level: 4 }],
    effects: ["自动维修 护盾/装甲/结构"],
    bonus: null,
    description: "考古失败受伤时触发，消耗燃料自动维修。",
  },
];

// ---------------------------------------------------------------------------
//  3. 统一公式推导（与冻结源一致，UNIT 由总目标时间反推）
//      duration(step) = UNIT × WEIGHTS[level-1] × RANK_MULT[category]
// ---------------------------------------------------------------------------
function totalWeight() {
  let w = 0;
  for (const n of NODES) {
    const rank = RANK_MULT[n.category];
    if (!rank) throw new Error("未知 category: " + n.category + " @ " + n.id);
    for (let lvl = 1; lvl <= n.maxLevel; lvl++) {
      w += WEIGHTS[lvl - 1] * rank;
    }
  }
  return w;
}

const TOTAL_WEIGHT = totalWeight();
const UNIT = TARGET_SECONDS / TOTAL_WEIGHT;

// 填充每个节点的 durationByLevel（秒，由公式生成，与冻结源逐字段一致）
for (const n of NODES) {
  const rank = RANK_MULT[n.category];
  const arr = [];
  for (let lvl = 1; lvl <= n.maxLevel; lvl++) {
    arr.push(UNIT * WEIGHTS[lvl - 1] * rank);
  }
  n.durationByLevel = arr;
}

// ---------------------------------------------------------------------------
//  4. 步骤图（科技ID@等级）
// ---------------------------------------------------------------------------
function buildSteps() {
  const steps = [];
  for (const n of NODES) {
    for (let lvl = 1; lvl <= n.maxLevel; lvl++) {
      steps.push({
        key: n.id + "@" + lvl,
        id: n.id,
        level: lvl,
        category: n.category,
        type: n.type,
        duration: n.durationByLevel[lvl - 1],
      });
    }
  }
  return steps;
}

const STEP_COUNT = NODES.reduce((s, n) => s + n.maxLevel, 0);

// ---------------------------------------------------------------------------
//  5. group → 真实消费点映射注册表（§6A，31 个唯一 bonus.group）
//
//  仅描述“每个 group 的加成作用于哪些真实消费点”，本批次【不接入】这些消费点。
//  机器可读：每个 group 作为键列出其消费点；合并展示行（分武器伤害 /
//  各层生命）在此仍逐项列出（laserDmg / missileDmg / projDmg；shield / armor /
//  structure），杜绝幽灵键与聚合丢失。
  //  审计以“键集合”与数据侧 group 集合做双向相等校验（漏项/多项/拼写漂移均失败）。
//
//  target 标识约定（诚信消费点，非虚构符号）：
//    - "文件#函数"：如 selectors.getProductionEfficiencyState = js/core/selectors.js 的
//      顶层函数 getProductionEfficiencyState（vanilla <script> 全局函数）。
//    - "文件#函数#段"：inline 业务段，如 systems.resolveArchaeologyCycle#backlash =
//      js/systems/archaeology.js 中 resolveArchaeologyCycle 内的反噬伤害计算段。
//    - 所有 target 已在 audit-research.mjs 的 REAL_TARGET_BASES 白名单逐一核实；
//      已知幽灵入口（systems.archaeologyBacklashDamage / archaeologyProbeCost /
//      combatXp / selectors.renewCost.fuel / selectors.renewCost.isk）被审计显式禁止。
//
//  kind:
//    multiplier     —— 消费点乘单一科研乘子 getResearchMultiplier(state, groups)
//    additivePp     —— 概率 + 百分点（getResearchBonusValue 返回分数，消费方钳制 ≤1）
//    reduceFraction —— 消费方 ×(1 - getResearchBonusValue)（负号幅度，消费方处理符号）
// ---------------------------------------------------------------------------
const RESEARCH_BONUS_CONSUMERS = {
  // —— 采集 / 工业（% 乘子：allXxx 根加成 + 专精项）——
  allMining: [
    { target: "selectors.getProductionEfficiencyState", kind: "multiplier", groups: ["allMining", "mining"] },
    { target: "production.getGasEfficiency", kind: "multiplier", groups: ["allMining", "gas"] },
  ],
  mining: [
    { target: "selectors.getProductionEfficiencyState", kind: "multiplier", groups: ["allMining", "mining"] },
  ],
  gas: [
    { target: "production.getGasEfficiency", kind: "multiplier", groups: ["allMining", "gas"] },
  ],
  allMfg: [
    { target: "selectors.getSmeltingDisplayState", kind: "multiplier", groups: ["allMfg", "smelt"] },
    { target: "selectors.getEquipmentEngineeringDisplayState", kind: "multiplier", groups: ["allMfg", "equip"] },
    { target: "selectors.getBoosterManufacturingDisplayState", kind: "multiplier", groups: ["allMfg", "booster"] },
    { target: "selectors.getShipEngineeringSpeedBreakdown", kind: "multiplier", groups: ["allMfg", "shipComp"] },
    { target: "selectors.getShipEngineeringSpeedBreakdown", kind: "multiplier", groups: ["allMfg", "shipAsm"] },
  ],
  smelt: [
    { target: "selectors.getSmeltingDisplayState", kind: "multiplier", groups: ["allMfg", "smelt"] },
  ],
  equip: [
    { target: "selectors.getEquipmentEngineeringDisplayState", kind: "multiplier", groups: ["allMfg", "equip"] },
  ],
  booster: [
    { target: "selectors.getBoosterManufacturingDisplayState", kind: "multiplier", groups: ["allMfg", "booster"] },
  ],
  shipComp: [
    { target: "selectors.getShipEngineeringSpeedBreakdown", kind: "multiplier", groups: ["allMfg", "shipComp"] },
  ],
  shipAsm: [
    { target: "selectors.getShipEngineeringSpeedBreakdown", kind: "multiplier", groups: ["allMfg", "shipAsm"] },
  ],

  // —— 探索 ——
  archEff: [
    { target: "systems.resolveArchaeologyCycle", kind: "multiplier", groups: ["archEff"], mode: "online" },
    { target: "systems.resolveArchaeologyCycle#offline", kind: "multiplier", groups: ["archEff"], mode: "offline" },
    { target: "systems.getArchaeologyDisplayState", kind: "multiplier", groups: ["archEff"], mode: "display" },
  ],
  archSuccess: [
    { target: "systems.computeArchaeologySuccessChance", kind: "additivePp", groups: ["archSuccess"] },
  ],
  backlash: [
    { target: "systems.resolveArchaeologyCycle#backlash", kind: "reduceFraction", groups: ["backlash"] },
  ],
  probe: [
    { target: "systems.resolveArchaeologyCycle#probeSpend", kind: "reduceFraction", groups: ["probe"] },
  ],
  archExp: [
    { target: "production.addSkillXpToState", kind: "multiplier", groups: ["archExp"], mode: "online" },
    { target: "offline.addOfflineSkillXp", kind: "multiplier", groups: ["archExp"], mode: "offline" },
  ],

  // —— 后勤 ——
  fuel: [
    { target: "station.settleStationMaintenance", kind: "reduceFraction", groups: ["fuel"] },
  ],
  planCost: [
    { target: "selectors.getPlanetDeploymentDisplayState", kind: "reduceFraction", groups: ["planCost"] },
  ],
  build: [
    { target: "station.getStationBuildingSpeedMultiplier", kind: "multiplier", groups: ["build"] },
  ],
  autoline: [
    { target: "station.processAutoLines", kind: "multiplier", groups: ["autoline"] },
  ],
  planProd: [
    { target: "selectors.getPlanetOutputIntervalFromState", kind: "multiplier", groups: ["planProd"] },
  ],

  // —— 战斗 ——
  combatExp: [
    { target: "station.addStationModifiedCombatXp", kind: "multiplier", groups: ["combatExp"] },
  ],
  allWeapon: [
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "laserDmg", "tactical"], weaponType: "laser" },
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "missileDmg", "tactical"], weaponType: "missile" },
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "projDmg", "tactical"], weaponType: "proj" },
  ],
  weaponDmg: [
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "laserDmg", "tactical"], weaponType: "laser" },
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "missileDmg", "tactical"], weaponType: "missile" },
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "projDmg", "tactical"], weaponType: "proj" },
  ],
  laserDmg: [
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "laserDmg", "tactical"], weaponType: "laser" },
  ],
  missileDmg: [
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "missileDmg", "tactical"], weaponType: "missile" },
  ],
  projDmg: [
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "projDmg", "tactical"], weaponType: "proj" },
  ],
  tactical: [
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "laserDmg", "tactical"], weaponType: "laser" },
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "missileDmg", "tactical"], weaponType: "missile" },
    { target: "selectors.getCombatDamageMultiplierFromState", kind: "multiplier", groups: ["allWeapon", "weaponDmg", "projDmg", "tactical"], weaponType: "proj" },
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "shield", "tactical"], layer: "shield" },
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "armor", "tactical"], layer: "armor" },
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "structure", "tactical"], layer: "structure" },
  ],
  tierHp: [
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "shield", "tactical"], layer: "shield" },
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "armor", "tactical"], layer: "armor" },
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "structure", "tactical"], layer: "structure" },
  ],
  shield: [
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "shield", "tactical"], layer: "shield" },
  ],
  armor: [
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "armor", "tactical"], layer: "armor" },
  ],
  structure: [
    { target: "selectors.getCombatMaxHpFromState", kind: "multiplier", groups: ["tierHp", "structure", "tactical"], layer: "structure" },
  ],
  repair: [
    { target: "selectors.getCombatRepairMultiplierFromState", kind: "multiplier", groups: ["repair"] },
  ],
};

// ---------------------------------------------------------------------------
//  6. 暴露
// ---------------------------------------------------------------------------
const ResearchData = {
  DAYS,
  TARGET_SECONDS,
  WEIGHTS,
  RANK_MULT,
  NODES,
  TOTAL_WEIGHT,
  UNIT,
  buildSteps,
  STEP_COUNT,
  RESEARCH_BONUS_CONSUMERS,
};

if (typeof window !== "undefined") window.ResearchData = ResearchData;
if (typeof globalThis !== "undefined") globalThis.ResearchData = ResearchData;
