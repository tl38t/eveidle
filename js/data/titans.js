// ---- 泰坦：舰体 × 武器 × 核心 三模块数据表（27 组合） ----
// 数值真值：TITAN_NUMERICAL_DESIGN_HANDOFF.md + 2026-09-09 封版表（会话确认）。
// 约定：
//   1. hp 为基础值，实战 HP 走与超级旗舰同一乘区管线（selectors.js getActiveShipCombatHp：
//      基础 × capacity 加成 × 技能 × 装备 × 强化 × rig × 脑插 × 军团 × 科研）。
//   2. 舰体 bonuses 只带 capacity / 维修 / 命中，不带武器伤害 %（武器基伤已含档位强度，避免二次相乘）。
//      盾线只加容量（对齐星冕级惯例，ship 级无 shieldRepair 字段）；甲线容量+维修；结线容量+维修+紧急维修。
//   3. 高槽 7 格出厂全部被末日武器占用（highUsable=0），后续由泰坦科技线释放（本文件不设计研究侧）。
//   4. 战斗规则纯函数在本文件底部，阶段 3 由 capital-combat / offline-combat 共同调用，禁止在调用方重写公式。
//   5. 2026-09-10 武器基伤回归超旗比率：三把主武器 = 20× 旗舰基伤，严格 6:5:4（12000 / 10000 / 8000）。
//      燃料维持 7 门旗舰负荷（105/70/35）不动 → 每燃料效率回到旗舰自身的 1:1.25:2（不再被放大）。
//      曙光长矛附加打击同步上调以补偿最高油耗：扫掠 30%→35%、贯穿 20%→25%（其 L2 占比最高）。
//   6. 2026-09-10 核心组件「真拆开」：部件车间由 7 条（核心 1 条通用件）变 9 条（核心 3 条单线件）。
//      三核心各绑一条深层数据线（统御矩阵→天穹 / 天罚裁决→重垒 / 裂界侵蚀→裂界），
//      总装必须用与所选核心同系的组件（getTitanComponentIdFor 同源派生）；三件同门禁 node104、同 Lv/工时/XP。
//      单艘泰坦深层数据总量不变（仍 180 = 舰体 60 + 武器 60 + 核心 60），只把核心的 20×3 换成单线 60。
"use strict";

const TITAN_HULLS = {
  titan_hull_aegis: {
    id: "titan_hull_aegis", name: "天穹壁垒", tier: "泰坦", type: "titan", defenseLine: "shield",
    flavor: "泰坦护盾堡垒，以巨幅护盾池与偏导回充维持阵线正面",
    hp: { shield: 18000, armor: 6000, structure: 4560 }, totalHp: 28560,
    dodge: 2, speed: 60, targeting: 280,
    capacitor: { capacity: 950 },
    fuelEfficiency: 0.85,
    slots: { high: 7, highUsable: 0, mid: 7, low: 3, rig: 5 },
    bonuses: { shieldCapacity: 0.35, hitBonus: 30 },
    capitalTrait: {
      id: "titan_deflection_shield", name: "偏导护盾",
      description: "每轮敌方攻击阶段，前三次命中护盾的攻击最终伤害降低25%；每次偏导触发立即回充4%最大护盾，护盾见底当轮起失效",
      shieldHits: 3, reduction: 0.25,
      hook: { id: "steady_recharge", name: "稳态回充", trigger: "onDeflection", shieldPctPerTrigger: 0.04 }
    }
  },
  titan_hull_bulwark: {
    id: "titan_hull_bulwark", name: "铁幕堡垒", tier: "泰坦", type: "titan", defenseLine: "armor",
    flavor: "泰坦装甲堡垒，以受击维修在持久火力下维持装甲层",
    hp: { shield: 4560, armor: 18000, structure: 6000 }, totalHp: 28560,
    dodge: 2, speed: 58, targeting: 310,
    capacitor: { capacity: 920 },
    fuelEfficiency: 0.85,
    slots: { high: 7, highUsable: 0, mid: 3, low: 7, rig: 5 },
    bonuses: { armorCapacity: 0.35, armorRepair: 1.00, hitBonus: 30 },
    capitalTrait: {
      id: "titan_reactive_armor", name: "强化应激装甲",
      description: "敌方攻击阶段结束后，恢复本轮装甲损失的15%，每轮最多恢复最大装甲的6%；回复量吃 armorRepair 与通用维修乘区",
      restoreRate: 0.15, maxArmorRate: 0.06, consumesRepairMultiplier: true
    }
  },
  titan_hull_keelbreaker: {
    id: "titan_hull_keelbreaker", name: "裂骨方舟", tier: "泰坦", type: "titan", defenseLine: "structure",
    flavor: "泰坦结构方舟，以结构过载换取逐层攀升的火力与濒损密封",
    hp: { shield: 4560, armor: 6000, structure: 18000 }, totalHp: 28560,
    dodge: 3, speed: 70, targeting: 250,
    capacitor: { capacity: 920 },
    fuelEfficiency: 0.85,
    slots: { high: 7, highUsable: 0, mid: 3, low: 7, rig: 5 },
    bonuses: { structureCapacity: 0.35, structureRepair: 2.00, structureEmergencyRepair: 1.00, hitBonus: 30 },
    capitalTrait: {
      id: "titan_structure_overdrive", name: "泰坦结构过载",
      description: "每损失10%结构，泰坦武器最终伤害提高6%，最多5层，战斗结束重置；过载密封：敌方阶段结束恢复本轮结构损失的12%，每层过载使该结构维修量提高15%",
      thresholdPct: 0.10, perLayer: 0.06, maxLayers: 5,
      hook: { id: "overdrive_seal", name: "过载密封", trigger: "onEnemyPhaseEnd", baseRestoreRate: 0.12, perLayerRepairBonus: 0.15 }
    }
  }
};

const TITAN_WEAPONS = {
  titan_weapon_dawn_spear: {
    id: "titan_weapon_dawn_spear", name: "曙光长矛", weaponType: "laser",
    flavor: "持续输出，每发扫掠切割邻敌，并贯穿目标下一层防御",
    // 基伤锚点：泰坦主武器 = 20× 旗舰级基伤，三把严格保持旗舰比率 6:5:4（2026-09-10 回归，见文件头约定 5）
    baseDamage: 12000, baseHit: 100,
    // 资源消耗锚点：单门泰坦主武器 ≈ 等效 7 门旗舰级武器的齐射负荷（7×15，沿用激光:导弹:火炮=3:2:1）；
    // ammoCost 7 = 等效 7 门各 1 发（现网全档 ammoCost:1/门/轮），弹药类型 laser 与现网同池
    fuelCost: 105, ammoCost: 7,
    // 扫掠光束：沿用超旗激光「每发扫掠」招牌（equipment.js aoe mode:"next"），2026-09-10 由 30% 上调至 35%
    // （高耗能武器补偿：曙光每燃料效率最低，用扫掠/贯穿放大其多目标与透层价值）
    perShotSweep: { id: "sweeping_beam", name: "扫掠光束", mode: "next", damagePct: 0.35, count: 1 },
    // 贯穿射击：主命中落在某防御层时，额外对下一层防御（盾→甲→甲→结）造成主命中 25% 的伤害（2026-09-10 由 20% 上调）；命中结构层（无下一层）不触发
    extraAttack: { id: "piercing_shot", name: "贯穿射击", trigger: "perShot", kind: "layerPierce", damagePct: 0.25 }
  },
  titan_weapon_skyfire_salvo: {
    id: "titan_weapon_skyfire_salvo", name: "天火齐射", weaponType: "missile",
    flavor: "覆盖型清场压制，齐射覆盖所有副目标，高爆装药周期性重创",
    baseDamage: 10000, baseHit: 130,
    fuelCost: 70, ammoCost: 7,   // 等效 7 门旗舰导弹（7×10），弹药类型 missile 同池
    // 齐射覆盖：沿用超旗导弹「每发对主目标以外所有存活敌 12%」招牌（equipment.js aoe mode:"all" 0.12）；单敌时无副目标、自然落空
    perShotSweep: { id: "salvo_coverage", name: "齐射覆盖", mode: "all", damagePct: 0.12 },
    // 高爆装药（暴击，本游戏首个暴击机制）：每发 25% 几率 ×2.0 暴伤；齐射覆盖的每一枚溅射同样独立掷暴击
    crit: { id: "high_explosive_payload", name: "高爆装药", chance: 0.25, multiplier: 2.0, appliesToSweep: true }
  },
  titan_weapon_throne_quake: {
    id: "titan_weapon_throne_quake", name: "震荡王座", weaponType: "cannon",
    flavor: "重炮压制，破片覆盖邻敌并在攻坚期强化，有机会打出第二轮破片",
    baseDamage: 8000, baseHit: 80,
    fuelCost: 35, ammoCost: 7,   // 等效 7 门旗舰火炮（7×5）
    // 破片齐射：沿用超旗火炮「每发对下两个其他目标」招牌（equipment.js aoe mode:"next" ×2），倍率加强 15%→20%；
    // 主目标血量 >70% 时破片强化到 30%（攻坚期清场，残血期回落）
    perShotSweep: { id: "frag_salvo", name: "破片齐射", mode: "next", damagePct: 0.20, count: 2, boostedPct: 0.30, boostTargetHpAbovePct: 0.70 },
    // 破片回响：每轮 25% 几率再触发一次完整破片齐射（同倍率/目标数）；在线掷随机，离线用期望 chance×damage
    extraAttack: { id: "frag_echo", name: "破片回响", trigger: "chancePerRound", chance: 0.25, retrigger: "perShotSweep" }
  }
};

const TITAN_CORES = {
  titan_core_command_matrix: {
    id: "titan_core_command_matrix", name: "统御矩阵", kind: "aura",
    flavor: "全小队火力协同与锁定协同光环",
    description: "全小队（含泰坦）伤害+10%、命中+15；同类光环取最高不叠加",
    squadDamageBonus: 0.10, squadHitBonus: 15, stacking: "max",
    // 光环维持供能：每轮消耗主武器单轮燃料的 30%（激光 32/导弹 21/火炮 11），不耗弹药；
    // 消耗与输出贡献成比例（光环 ≈ 主武器输出的 ~27%）
    consumption: { mode: "sustain", fuelPctOfVolley: 0.30 }
  },
  titan_core_doom_judgment: {
    id: "titan_core_doom_judgment", name: "天罚裁决", kind: "doomTarget",
    flavor: "周期性处决型点杀",
    description: "每2轮点名敌方基础伤害最高的存活目标，造成120%泰坦主武器基伤并眩晕1轮；同一目标首次必晕，之后每次眩晕有50%几率抵抗（眩晕失败伤害照常）",
    everyRounds: 2, damagePctOfWeaponBase: 1.20, stunRounds: 1,
    stunDiminishing: { resistAfterFirst: 0.50 }, targetSelection: "highestBaseDamageAlive",
    // 处决弹供能：每次触发 = 一次主武器齐射的燃料 + 7 发主武器同类型弹药；均摊每轮 = 主武器消耗的 50%（与 0.5× 输出贡献匹配）
    consumption: { mode: "perTrigger", fuelPctOfVolley: 1.00, ammoPerTrigger: 7 }
  },
  titan_core_rift_erosion: {
    id: "titan_core_rift_erosion", name: "裂界侵蚀", kind: "aoeErosion",
    flavor: "全敌侵蚀打击并撕裂防御",
    description: "每2轮侵蚀全部敌人：主目标受到30%、其余敌人各受到15%泰坦主武器基伤；受击敌人受到小队伤害+12%，持续2轮",
    everyRounds: 2, mode: "all", mainDamagePct: 0.30, othersDamagePct: 0.15,
    vulnerability: { type: "damageTakenUp", pct: 0.12, rounds: 2 },
    // 侵蚀弹幕供能：每次触发 = 主武器齐射燃料的 60% + 4 发同类型弹药；均摊每轮 ≈ 主武器消耗的 30%（输出贡献 0.1~0.4 区间中值）
    consumption: { mode: "perTrigger", fuelPctOfVolley: 0.60, ammoPerTrigger: 4 }
  }
};

// ---- 解锁与合成门槛 ----
// 星图三泰坦组件节点（legion-starmap-pure.html:22/23 稳定 ID 20/62/104，中环三领地各一，subtype「泰坦组件」）：
//   id 20 苍穹领地 → 防御模块；id 62 赤誓领地 → 攻击模块；id 104 静默领地 → 末日武器。
// 制压最终节点（先驱文明核心 precursor_core，type "final"）→ 解锁泰坦合成。
// 泰坦合成面板：空间站船坞 lv≥3 显示。
const TITAN_UNLOCK = Object.freeze({
  synthesisGate: Object.freeze({ finalNodeId: "precursor_core" }),
  panelGate: Object.freeze({ shipyardLevel: 3 }),
  moduleNodes: Object.freeze({
    defense: Object.freeze({ nodeId: 20, territory: "angel", label: "苍穹领地泰坦节点" }),
    weapon: Object.freeze({ nodeId: 62, territory: "blood", label: "赤誓领地泰坦节点" }),
    core: Object.freeze({ nodeId: 104, territory: "sansha", label: "静默领地泰坦节点" })
  })
});

// ---- 冶炼设计（精炼泰坦材料，阶段 4 接入 production.js SMELTING_RECIPES）----
// 同级矿+气合熔：外中环对 → 锻星合金（refining Lv.90），内环对 → 熔虚晶体（refining Lv.100）。
// 原材料日供（全制压，legion-starmap-pure.html:36-60 + wormhole 采集）：
//   星骸钛晶/赫利昂冷凝气 ≈ 3,786/日（星图 21 节点×0.96：11 外环×100 + 10 中环×275 = 3,696 + 虫洞 ~90）
//   相位铱核/虚境裂流 ≈ 123/日（星图内环 1 节点×96 + 虫洞 ~27）
// 原料丰度差 ~30×，用压缩比抹平：锻星 矿40+气40→×1（日供 ≈94.7），熔虚 矿2+气2→×1（日供 ≈61.5）→ 高档更稀缺。
// 注意：现网 SMELTING_RECIPES 仅支持单输入 consumeOre，双材料配方需扩展 inputs 结构 + 冶炼面板双材料显示（阶段 4）。
// 命名：锻星合金=星骸钛晶+赫利昂冷凝气熔锻（泰坦结构件）；熔虚晶体=相位铱核+虚境裂流熔铸（泰坦奇物件）。
// 暗流体泵维持吃原形态泰坦材料，不受影响。
const TITAN_SMELTING = Object.freeze({
  outputs: Object.freeze({
    titan_alloy_forgestar: Object.freeze({
      id: "titan_alloy_forgestar", name: "锻星合金", tier: "outer",
      skillLevel: 90, baseTime: 90, baseXP: 700, baseOutput: 1,
      inputs: Object.freeze({ "星骸钛晶": 40, "赫利昂冷凝气": 40 })
    }),
    titan_crystal_meltvoid: Object.freeze({
      id: "titan_crystal_meltvoid", name: "熔虚晶体", tier: "inner",
      skillLevel: 100, baseTime: 240, baseXP: 1100, baseOutput: 1,
      inputs: Object.freeze({ "相位铱核": 2, "虚境裂流": 2 })
    })
  })
});

// ---- 组件制造成本（精炼形态）----
// 首艘泰坦瓶颈：熔虚晶体需求 800 ÷ ~61.5/日 ≈ 13 日；锻星合金需求 800 ÷ ~94.7/日 ≈ 8.4 日；
// 冶炼队列合计 ≈ 3 日串行（可离线）。常规材料 ≈ 超旗舰单艘 ÷3 ×2.2；深层数据按谱系对齐（天穹/重垒/裂界）。
// ---- 深层舰船数据谱系映射（组件 materialCost 依据，用户拍板）----
// 舰体=谱系载体（盾→天穹/甲→重垒/结→裂界）；武器沿用超旗推荐武器绑定（星冕↔激光/恒城↔导弹/裁决↔火炮）；
// 核心（末日武器）2026-09-10 改版：由「三线混合各 20 的一件通用件」拆成三件单线件，
// 与武器线同序（统御矩阵→天穹 / 天罚裁决→重垒 / 裂界侵蚀→裂界），使「同系泰坦」
// （如 天穹壁垒 + 曙光长矛 + 统御矩阵）成为可读的完整流派，且总装时必须用对应系的核心件。
// 每组件数据负载均为 60，与超旗舰总装 60/艘 同档；跨谱系组合自然消耗多条线的数据。
const TITAN_DATA_LINEAGE = Object.freeze({
  hull: Object.freeze({
    titan_hull_aegis: "天穹深层舰船数据",
    titan_hull_bulwark: "重垒深层舰船数据",
    titan_hull_keelbreaker: "裂界深层舰船数据"
  }),
  weapon: Object.freeze({
    titan_weapon_dawn_spear: "天穹深层舰船数据",
    titan_weapon_skyfire_salvo: "重垒深层舰船数据",
    titan_weapon_throne_quake: "裂界深层舰船数据"
  }),
  core: Object.freeze({
    titan_core_command_matrix: "天穹深层舰船数据",
    titan_core_doom_judgment: "重垒深层舰船数据",
    titan_core_rift_erosion: "裂界深层舰船数据"
  })
});

const TITAN_COMPONENT_COSTS = Object.freeze({
  hull: Object.freeze({
    id: "titan_component_hull", name: "泰坦舰体组件", baseTime: 3600, xp: 1000,
    regular: Object.freeze({ "三钛合金": 10000, "基腹断岩": 450, "超噬矿": 330, "铷": 90, "磁场聚合物": 280 }),
    dataKey: "hull", dataAmount: 60,               // 对应线深层舰船数据（天穹/重垒/裂界，随舰体选择）
    refined: Object.freeze({ titan_alloy_forgestar: 600 })
  }),
  weapon: Object.freeze({
    id: "titan_component_weapon", name: "泰坦武器组件", baseTime: 2700, xp: 900,
    regular: Object.freeze({ "三钛合金": 6500, "等离子体": 250, "聚合气体": 120, "铷": 60, "超噬矿": 220 }),
    dataKey: "weapon", dataAmount: 60,             // 按武器谱系查 TITAN_DATA_LINEAGE.weapon（曙光=天穹/天火=重垒/震荡=裂界）
    refined: Object.freeze({ titan_crystal_meltvoid: 400 })
  }),
  core: Object.freeze({
    id: "titan_component_core", name: "泰坦核心组件", baseTime: 2700, xp: 900,
    regular: Object.freeze({ "三钛合金": 6500, "超纯聚合气体": 60, "等离子体": 200, "铷": 60, "超噬矿": 220 }),
    dataKey: "core", dataAmount: 60,               // 单线 60：按核心谱系查 TITAN_DATA_LINEAGE.core（统御=天穹/天罚=重垒/裂界=裂界）
    refined: Object.freeze({ titan_crystal_meltvoid: 400 })
  }),
  assembly: Object.freeze({
    id: "titan_assembly", name: "泰坦总装", baseTime: 3600, xp: 1500, shipyardLevel: 3,
    regular: Object.freeze({}),
    isk: 5000000,
    refined: Object.freeze({ titan_alloy_forgestar: 200 })
  })
});

// ---- 部件车间接入（2026-09-09 用户拍板）：9 条静态配方变体 + 门禁 ----
// 生成规则：TITAN_COMPONENT_COSTS（常规材料/时间/XP）+ TITAN_DATA_LINEAGE（深层数据谱系）→ SHIP_COMPONENT_RECIPES 静态配方。
// 谱系决定变体：舰体×3（天穹/重垒/裂界）、武器×3（曙光/天火/震荡）、核心×3（统御/天罚/裂界，2026-09-10 拆单线）。
// 精炼料按中文名进 cost（special 池按名解析，见 combat.js TITAN_REFINED_MATERIALS 注册）。
// 时机：本文件晚于 ships.js（拆解表 SHIP_COMPONENT_DISMANTLE_RECIPES 已快照 → 泰坦配方天然不进自动拆解）、
//       晚于 resources.js（component 注册循环已跑完 → 此处自行注册）、早于 selectors/actions/persistence。
const TITAN_SMELTED_MATERIAL_NAMES = Object.freeze({
  titan_alloy_forgestar: TITAN_SMELTING.outputs.titan_alloy_forgestar.name,
  titan_crystal_meltvoid: TITAN_SMELTING.outputs.titan_crystal_meltvoid.name
});

const TITAN_COMPONENT_RECIPES = (function () {
  const costs = TITAN_COMPONENT_COSTS;
  const lineage = TITAN_DATA_LINEAGE;
  const recipes = [];
  // 舰体组件 ×3：数据随舰体谱系（天穹壁垒→天穹数据，余同）
  // （直接 Object.keys——TITAN_HULL_IDS 在下方纯函数区才声明，本块执行时尚处 TDZ）
  for (const hullId of Object.keys(TITAN_HULLS)) {
    const hull = TITAN_HULLS[hullId];
    recipes.push({
      id: "titan_component_hull_" + hullId.slice("titan_hull_".length),
      name: costs.hull.name + "·" + hull.name,
      level: 100, time: costs.hull.baseTime, xp: costs.hull.xp,
      titanLine: "hull",
      cost: Object.assign({}, costs.hull.regular, { [lineage.hull[hullId]]: costs.hull.dataAmount }, costs.hull.refined.titan_alloy_forgestar ? { [TITAN_SMELTED_MATERIAL_NAMES.titan_alloy_forgestar]: costs.hull.refined.titan_alloy_forgestar } : {})
    });
  }
  // 武器组件 ×3：数据随武器谱系（曙光长矛→天穹数据，余同）
  for (const weaponId of Object.keys(TITAN_WEAPONS)) {
    const weapon = TITAN_WEAPONS[weaponId];
    recipes.push({
      id: "titan_component_weapon_" + weaponId.slice("titan_weapon_".length),
      name: costs.weapon.name + "·" + weapon.name,
      level: 100, time: costs.weapon.baseTime, xp: costs.weapon.xp,
      titanLine: "weapon",
      cost: Object.assign({}, costs.weapon.regular, { [lineage.weapon[weaponId]]: costs.weapon.dataAmount }, costs.weapon.refined.titan_crystal_meltvoid ? { [TITAN_SMELTED_MATERIAL_NAMES.titan_crystal_meltvoid]: costs.weapon.refined.titan_crystal_meltvoid } : {})
    });
  }
  // 核心组件 ×3：数据随核心谱系（统御矩阵→天穹数据，余同）。2026-09-10 用户拍板「真拆开」——
  // 三个核心各有单线归属，总装时消耗的核心件必须与所选核心同系（getTitanComponentIdFor 同源派生）。
  for (const coreId of Object.keys(TITAN_CORES)) {
    const core = TITAN_CORES[coreId];
    recipes.push({
      id: "titan_component_core_" + coreId.slice("titan_core_".length),
      name: costs.core.name + "·" + core.name,
      level: 100, time: costs.core.baseTime, xp: costs.core.xp,
      titanLine: "core",
      cost: Object.assign({}, costs.core.regular, { [lineage.core[coreId]]: costs.core.dataAmount }, costs.core.refined.titan_crystal_meltvoid ? { [TITAN_SMELTED_MATERIAL_NAMES.titan_crystal_meltvoid]: costs.core.refined.titan_crystal_meltvoid } : {})
    });
  }
  return recipes;
})();

// 追加进部件车间配方表（注册 component: 命名空间——resources.js 的注册循环先于本文件，须自行补注册）。
if (typeof SHIP_COMPONENT_RECIPES !== "undefined" && Array.isArray(SHIP_COMPONENT_RECIPES)) {
  for (const recipe of TITAN_COMPONENT_RECIPES) {
    if (!SHIP_COMPONENT_RECIPES.some(existing => existing.id === recipe.id)) SHIP_COMPONENT_RECIPES.push(recipe);
  }
  if (typeof ResourceRegistry !== "undefined" && typeof ResourceRegistry.register === "function") {
    for (const recipe of TITAN_COMPONENT_RECIPES) {
      ResourceRegistry.register({ namespace:"component", key:recipe.id, name:recipe.name, category:"equipment" });
    }
  }
}

// ---- 冶炼接入（P1 阶段4，2026-09-10 用户拍板）：双材料配方追加进 SMELTING_RECIPES ----
// production.js 先于本文件加载（index.html 数据/系统顺序）→ 此处可安全追加；按名去重防双推。
// 旧路径兼容：无 consumeOre + inputs 对象；执行侧（tick/offline/station/selectors）统一经
// production.js getSmeltingConsumeList / getSmeltingCyclesAvailable / getSmeltingOutputRefId 解析，
// 单输入旧配方逐位等价（consumeList=[{refId:"ore:X",qty:1}]）。
// 产出走 special: 池（combat.js TITAN_REFINED_MATERIALS 已注册 锻星合金/熔虚晶体）。
// 注意：equipment-enhancement.js 的 REFINED_MINERALS 在本文件之前收集 → 锻星/熔虚不会混进强化消耗料（刻意）。
(function appendTitanSmeltingRecipes() {
  if (typeof SMELTING_RECIPES === "undefined" || !Array.isArray(SMELTING_RECIPES)) return;
  const defs = [
    { id: "titan_alloy_forgestar", suffix: "熔锻" },
    { id: "titan_crystal_meltvoid", suffix: "熔铸" }
  ];
  for (const def of defs) {
    const out = TITAN_SMELTING.outputs[def.id];
    if (!out) continue;
    const name = out.name + def.suffix;
    if (SMELTING_RECIPES.some(r => r && r.name === name)) continue;
    SMELTING_RECIPES.push({
      name: name,
      outputMineral: out.name, outputPool: "special",
      level: out.skillLevel, baseTime: out.baseTime, baseOutput: out.baseOutput, baseXP: out.baseXP,
      inputs: Object.assign({}, out.inputs), inputPool: "special",
      titan: true
    });
  }
})();

// 泰坦组件制造门禁（用户拍板方案 b）：制压先驱文明核心（合成总门禁）+ 分线制压泰坦节点
// （舰体线 node20 / 武器线 node62 / 核心线 node104）。船坞 Lv3 与工程等级门在 station.js / recipe.level。
// 三件核心组件（统御/天罚/裂界）同属「末日武器」分线 → 共用 node104 一道门禁（星图只有 20/62/104 三个泰坦节点）。
// final 节点 id 与 wormhole.js 同口径：优先星图 iframe 广播的 LEGION_STARMAP_FINAL_ID，回退 "200"。
function isTitanComponentUnlocked(state, recipeId) {
  if (typeof recipeId !== "string" || recipeId.indexOf("titan_component_") !== 0) return { ok:true };
  const L = state && state.legion && state.legion.starmap;
  const completed = (L && Array.isArray(L.completedNodeIds)) ? L.completedNodeIds.map(String) : [];
  const finalId = String((typeof window !== "undefined" && window.LEGION_STARMAP_FINAL_ID) || "200");
  if (!completed.includes(finalId)) return { ok:false, reason:"titan-synthesis-locked", text:"需制压先驱文明核心" };
  let gate = null;
  if (recipeId.indexOf("titan_component_hull_") === 0) gate = TITAN_UNLOCK.moduleNodes.defense;
  else if (recipeId.indexOf("titan_component_weapon_") === 0) gate = TITAN_UNLOCK.moduleNodes.weapon;
  else if (recipeId.indexOf("titan_component_core") === 0) gate = TITAN_UNLOCK.moduleNodes.core;
  if (gate && !completed.includes(String(gate.nodeId))) return { ok:false, reason:"titan-node-locked", text:"需制压" + gate.label };
  return { ok:true };
}

// ---- 纯函数区（无状态依赖，在线/离线共用） ----

const TITAN_HULL_IDS = Object.keys(TITAN_HULLS);
const TITAN_WEAPON_IDS = Object.keys(TITAN_WEAPONS);
const TITAN_CORE_IDS = Object.keys(TITAN_CORES);

function isTitanComboValid(hullId, weaponId, coreId) {
  return Boolean(TITAN_HULLS[hullId] && TITAN_WEAPONS[weaponId] && TITAN_CORES[coreId]);
}

// 泰坦实例注册表（方案 C，2026-09-10）
// ------------------------------------------------------------------
// 设计：shipId 由组件 id 程序化派生（titan__<hull>__<weapon>__<core>），配置**按需**注册进
// SHIP_DATA.titan 分组（玩家造过几艘才注册几条，27 封顶）。相比 27 条静态表：
//   ① 单一真值仍是 buildTitanConfig（改数值立即生效，无第二份派生数据要同步）；
//   ② getShipConfigById / getShipSlotCounts / 幽灵船清理 全部走 SHIP_DATA 既有路径，零改动；
//   ③ 存档在实例上另存 titanCombo 真值，shipId 规则即使将来变更也可由 normalize 重算修复。
const TITAN_SHIP_ID_PREFIX = "titan__";
const TITAN_SHIP_ID_SEP = "__";

function makeTitanShipId(hullId, weaponId, coreId) {
  return TITAN_SHIP_ID_PREFIX + hullId + TITAN_SHIP_ID_SEP + weaponId + TITAN_SHIP_ID_SEP + coreId;
}

/** 反解 shipId → 组件三元组；非法/非泰坦返回 null（组件 id 本身不含双下划线，切分安全）。 */
function parseTitanShipId(shipId) {
  if (typeof shipId !== "string" || shipId.indexOf(TITAN_SHIP_ID_PREFIX) !== 0) return null;
  const parts = shipId.slice(TITAN_SHIP_ID_PREFIX.length).split(TITAN_SHIP_ID_SEP);
  if (parts.length !== 3) return null;
  const hullId = parts[0], weaponId = parts[1], coreId = parts[2];
  if (!isTitanComboValid(hullId, weaponId, coreId)) return null;
  return { hullId, weaponId, coreId };
}

/* ---- 泰坦 3D 视觉参数（船坞缩略图 / 3D 弹窗与泰坦组装页共用一份真值）----
 * 映射到 render3d/titan/TitanFactory.js 的 buildTitan(defense, weaponKind, coreKind) 参数域。
 * 此前只有泰坦组装页（titan-forge-integration.js 的 OPTIONS/TITAN_DATA_ID_MAP）在 UI 侧
 * 各自维护这份对应关系，船坞侧无从得知泰坦该用哪个模型（buildSpecForShip 查不到 SHIP_DATA.titan
 * 分组 → 回退成护卫舰）。此处集中成数据层真值，UI 只消费，禁止再各写一份。 */
const TITAN_VISUAL_PARTS = {
  titan_hull_aegis: "shield", titan_hull_bulwark: "armor", titan_hull_keelbreaker: "structure",
  titan_weapon_dawn_spear: "laser", titan_weapon_skyfire_salvo: "missile", titan_weapon_throne_quake: "cannon",
  titan_core_command_matrix: "blue", titan_core_doom_judgment: "red", titan_core_rift_erosion: "violet"
};

/**
 * shipId → { defense, weapon, core }（TitanFactory 参数域）。
 * 非泰坦 / 组合非法返回 null。UI 侧（船坞 3D）据此选择泰坦模型。
 */
function getTitanVisualSpec(shipId) {
  const parts = parseTitanShipId(shipId);
  if (!parts) return null;
  return {
    defense: TITAN_VISUAL_PARTS[parts.hullId] || "shield",
    weapon: TITAN_VISUAL_PARTS[parts.weaponId] || "laser",
    core: TITAN_VISUAL_PARTS[parts.coreId] || "blue"
  };
}

/** SHIP_DATA.titan 分组（懒建）。挂载进 SHIP_DATA 使槽位解析/幽灵船清理等既有路径天然认识泰坦。 */
function getTitanConfigRegistry() {
  const data = (typeof window !== "undefined" && window.SHIP_DATA)
    || (typeof SHIP_DATA !== "undefined" ? SHIP_DATA : null);
  if (!data || typeof data !== "object") return null;
  if (!data.titan || typeof data.titan !== "object") data.titan = {};
  return data.titan;
}

/** 注册（幂等）一个组合并返回其 config；组合非法或 SHIP_DATA 不可用返回 null。 */
function registerTitanConfig(hullId, weaponId, coreId) {
  const reg = getTitanConfigRegistry();
  if (!reg) return null;
  const shipId = makeTitanShipId(hullId, weaponId, coreId);
  if (reg[shipId]) return reg[shipId];
  const cfg = buildTitanConfig(hullId, weaponId, coreId);
  if (!cfg) return null;
  reg[shipId] = cfg;
  // 按当前泰坦研究等级重算槽位（幂等；新建/懒解析出的配置立即带上已研究的槽位释放）。
  refreshTitanSlotResearch(null);
  return cfg;
}

/** 懒解析自愈：任何时刻按 shipId 取泰坦配置；注册表缺失时由 shipId 反解重建，非泰坦返回 null。 */
function resolveTitanConfigByShipId(shipId) {
  if (typeof shipId !== "string" || shipId.indexOf(TITAN_SHIP_ID_PREFIX) !== 0) return null;
  const reg = getTitanConfigRegistry();
  if (!reg) return null;
  if (reg[shipId]) return reg[shipId];
  const combo = parseTitanShipId(shipId);
  if (!combo) return null;
  return registerTitanConfig(combo.hullId, combo.weaponId, combo.coreId);
}

/**
 * 存档归一化钩子（幂等）：遍历机库，按 titanCombo 真值注册配置并修复 shipId。
 * 必须在 migrateGhostDeployableShips 之前调用——否则未注册的泰坦会被当成幽灵船删除。
 * @returns {number} 处理的泰坦实例数
 */
function registerTitanShipsFromState(state) {
  const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  let count = 0;
  for (const inst of ships) {
    if (!inst || typeof inst !== "object") continue;
    const combo = inst.titanCombo;
    if (!combo || typeof combo !== "object") continue;
    const cfg = registerTitanConfig(combo.hull, combo.weapon, combo.core);
    if (!cfg) continue;
    if (inst.shipId !== cfg.id) inst.shipId = cfg.id; // shipId 规则修复（真值是 titanCombo）
    count++;
  }
  return count;
}

// 组件配方 id 与舰体/武器/核心成员 id 的映射（与 TITAN_COMPONENT_RECIPES 生成规则同源）。
// 三系同名同构：titan_component_<kind>_<成员名去前缀>；核心已按系拆分，必须传 coreId 才拿得到对应件。
function getTitanComponentIdFor(kind, memberId) {
  const prefix = kind === "hull" ? "titan_hull_" : kind === "weapon" ? "titan_weapon_" : "titan_core_";
  const id = String(memberId || "");
  return "titan_component_" + kind + "_" + id.slice(prefix.length);
}

/**
 * 泰坦总装虚拟配方（供 actions/tick/offline 复用既有总装管线）。
 * 与 SHIP_ASSEMBLY_RECIPES 成员同构：time/xp/componentCost/materialCost，
 * 额外带 shipId（= 注册表键，随 combo 变化）、titanCombo、shipyardLevel、isk。
 * ISK 刻意不进 materialCost——精密配给剂只省材料不省钱，避免报价折扣误伤货币。
 */
function getTitanAssemblyRecipe(combo) {
  if (!combo || typeof combo !== "object") return null;
  const cfg = registerTitanConfig(combo.hull, combo.weapon, combo.core);
  if (!cfg) return null;
  const a = TITAN_COMPONENT_COSTS.assembly;
  const materialCost = {};
  const forgestarName = (typeof TITAN_SMELTED_MATERIAL_NAMES !== "undefined") ? TITAN_SMELTED_MATERIAL_NAMES.titan_alloy_forgestar : null;
  if (forgestarName) materialCost[forgestarName] = a.refined.titan_alloy_forgestar;
  return {
    id: a.id,
    name: a.name + "·" + cfg.name,
    shipId: cfg.id,
    titanCombo: { hull: combo.hull, weapon: combo.weapon, core: combo.core },
    level: 100,                    // 与泰坦组件同门槛（封版：船坞 Lv3 + 舰船工程 Lv100）
    time: a.baseTime,              // 3600s
    xp: a.xp,                      // 1500
    shipyardLevel: a.shipyardLevel, // 3
    isTitan: true,
    componentCost: {
      [getTitanComponentIdFor("hull", combo.hull)]: 1,
      [getTitanComponentIdFor("weapon", combo.weapon)]: 1,
      [getTitanComponentIdFor("core", combo.core)]: 1
    },
    materialCost,
    isk: a.isk                     // 5,000,000（独立校验/扣除）
  };
}

/** 泰坦总装可完成次数（受 ISK + 三组件 + 锻星共同约束）。 */
function getTitanAssemblyMaxCycles(state, recipe) {
  if (!recipe) return 0;
  const r = recipe;
  // ISK 权威存储只有 state.resources.isk（顶层 state.isk 不存在，读之恒 0 → 离线可完成次数恒 0）——2026-09-10 修复
  let cycles = r.isk > 0 ? Math.floor(ResourceRegistry.get(state, "currency:isk") / r.isk) : Infinity;
  if (!Number.isFinite(cycles)) cycles = 0;
  for (const [id, count] of Object.entries(r.componentCost)) {
    cycles = Math.min(cycles, Math.floor(ResourceRegistry.get(state, "component:" + id) / count));
  }
  for (const [name, qty] of Object.entries(r.materialCost)) {
    // 必须与真实扣料同源：走「泰坦材料精算」协议缩放，否则离线可完成次数会按旧成本高估。
    const need = applyTitanMaterialCostResearch(state, name, qty);
    cycles = Math.min(cycles, Math.floor(ResourceRegistry.getMaterialStock(state, name) / need));
  }
  return Math.max(0, Number.isFinite(cycles) ? cycles : 0);
}

function buildTitanConfig(hullId, weaponId, coreId) {
  if (!isTitanComboValid(hullId, weaponId, coreId)) return null;
  const hull = TITAN_HULLS[hullId];
  const weapon = TITAN_WEAPONS[weaponId];
  const core = TITAN_CORES[coreId];
  return {
    // id 即实例 shipId（注册表键）——与 makeTitanShipId 严格同源，禁止另写拼接规则。
    id: makeTitanShipId(hullId, weaponId, coreId),
    name: hull.name + "·" + weapon.name + "·" + core.name,
    type: "titan", tier: "泰坦",
    hull, weapon, core,
    // 组件溯源（机库/装配页显示「这艘泰坦用什么件造的」，同时是存档归一化的真值镜像）
    hullId: hullId, weaponId: weaponId, coreId: coreId,
    titanCombo: { hull: hullId, weapon: weaponId, core: coreId },
    // 普通舰船通用字段（下游机库/装配/战斗通用路径会读，缺失会显示空白或走兜底分支）
    flavor: hull.flavor || "",
    recommendedWeapon: weapon.weaponType || "",
    weaponType: weapon.weaponType || "",
    unlock: { type: "titan" },
    hp: hull.hp, totalHp: hull.totalHp,
    dodge: hull.dodge, speed: hull.speed, targeting: hull.targeting,
    capacitor: hull.capacitor, fuelEfficiency: hull.fuelEfficiency,
    // slots 必须是**副本**：TITAN_HULLS[*].slots 是只读设计真值，
    // 泰坦研究线（tt_high 等）会按研究等级原地重写注册表内的 cfg.slots（refreshTitanSlotResearch），
    // 若共享引用将污染 TITAN_HULLS 单例、并把加成重复累加到后续新建配置上。
    slots: Object.assign({}, hull.slots),
    bonuses: hull.bonuses, capitalTrait: hull.capitalTrait
  };
}

function listTitanCombinations() {
  const out = [];
  for (const h of TITAN_HULL_IDS) for (const w of TITAN_WEAPON_IDS) for (const c of TITAN_CORE_IDS) out.push({ hullId: h, weaponId: w, coreId: c });
  return out;
}

/**
 * 泰坦主武器单轮伤害（含增伤被动，不含扫掠/额外攻击/暴击结算）。
 * @param {object} weapon TITAN_WEAPONS 成员
 * @param {object} s 战斗快照 { round, targetHpRatio }
 * @returns {{ mainDamage:number, mult:number, crit?:{chance:number, multiplier:number} }}
 *   crit 仅返回配置：在线由调用方逐发掷随机，离线统计模拟用期望乘数 1 + chance×(multiplier−1)。
 */
function getTitanWeaponRoundDamage(weapon, s) {
  const st = s || {};
  const round = st.round || 1;
  let mult = 1;
  const p = weapon.rampPassive; // 曙光长矛/天火齐射无 rampPassive，mult 恒为 1
  if (p && p.trigger === "cycle") {
    // 弹幕循环：每 cycleRounds 轮一轮爆发
    if (round % p.cycleRounds === 0) mult *= p.burstMultiplier;
  } else if (p && p.trigger === "targetHpAbove") {
    if (typeof st.targetHpRatio === "number" && st.targetHpRatio > p.targetHpAbovePct) mult += p.bonus;
  }
  const out = { mainDamage: Math.round(weapon.baseDamage * mult), mult };
  if (weapon.crit) out.crit = { chance: weapon.crit.chance, multiplier: weapon.crit.multiplier };
  return out;
}

/**
 * 武器附带打击结算（返回待执行打击列表，不直接扣血）。
 * 覆盖四类：
 *   sweep          每发扫掠（perShotSweep）：next/all 模式；支持 boostedPct 条件强化（按主目标血量阈值）
 *   layerPierce    透层贯穿（对当前目标下一层防御追加固定比例）
 *   extra          周期/每轮额外攻击（everyRounds / trigger:"perRound"）
 *   retriggerSweep 概率再触发一次完整扫掠（chancePerRound）：在线由调用方掷随机，离线用期望 chance×damage×count
 * @param {object} weapon TITAN_WEAPONS 成员
 * @param {object} s 战斗快照 { round, targetHpRatio }
 * @returns {Array<{kind:string, damage?:number, target:string, count?:number, chance?:number, boosted?:boolean, debuff?:object}>}
 */
function getTitanExtraAttacks(weapon, s) {
  const st = s || {};
  const round = st.round || 1;
  const out = [];
  const sw = weapon.perShotSweep;
  let sweepPct = null;
  if (sw) {
    const boosted = Boolean(sw.boostedPct && typeof st.targetHpRatio === "number" && st.targetHpRatio > sw.boostTargetHpAbovePct);
    sweepPct = boosted ? sw.boostedPct : sw.damagePct;
    const n = sw.count || 1;
    for (let i = 0; i < n; i++) out.push({ kind: "sweep", damage: Math.round(weapon.baseDamage * sweepPct), target: sw.mode, boosted });
  }
  const e = weapon.extraAttack;
  if (!e) return out;
  if (e.kind === "layerPierce") {
    // 贯穿射击：比例基于主命中（曙光长矛 mult 恒 1，基伤即主命中）；下一层防御由调用方按目标当前层解析
    out.push({ kind: "layerPierce", damage: Math.round(weapon.baseDamage * e.damagePct), target: "current" });
  } else if (e.trigger === "chancePerRound" && e.retrigger === "perShotSweep" && sw) {
    // 破片回响：每轮 e.chance 几率再触发一次完整破片齐射（同倍率/目标数/强化状态）
    out.push({ kind: "retriggerSweep", chance: e.chance, damage: Math.round(weapon.baseDamage * sweepPct), count: sw.count || 1, target: sw.mode, boosted: sweepPct === sw.boostedPct });
  } else if (e.trigger === "perRound") {
    for (let i = 0; i < e.missiles; i++) out.push({ kind: "extra", damage: Math.round(weapon.baseDamage * e.damagePct), target: e.target });
  } else if (e.everyRounds && round % e.everyRounds === 0) {
    out.push({ kind: "extra", damage: Math.round(weapon.baseDamage * e.damagePct), target: e.target, debuff: e.debuff || null });
  }
  return out;
}

/**
 * 核心光环配置（供小队伤害/命中乘区读取；同类光环取最高由调用方聚合）。
 * @returns {{squadDamageBonus:number, squadHitBonus:number}|null} 非光环核心返回 null
 */
function getTitanCoreAura(core) {
  if (!core || core.kind !== "aura") return null;
  return { squadDamageBonus: core.squadDamageBonus, squadHitBonus: core.squadHitBonus };
}

/**
 * 核心主动打击结算（返回待执行打击列表，不直接扣血；核心打击不吃武器暴击）。
 * @param {object} core TITAN_CORES 成员
 * @param {object} weapon 当前泰坦主武器 TITAN_WEAPONS 成员（doom/erosion 伤害随武器基伤浮动）
 * @param {object} s 战斗快照 { round }
 * @returns {Array<{kind:string, damage:number, target:string, stun?:object, vulnerability?:object}>}
 *   doomStrike：点名处决；stun 仅供调用方掷抵抗（resistAfterFirst，同目标战斗内首晕必中）。
 *   coreAoe：主目标 + 其余全体两段伤害；vulnerability 附加到全部受击敌。
 */
function getTitanCoreStrikes(core, weapon, s) {
  const st = s || {};
  const round = st.round || 1;
  const out = [];
  if (!core || (round % core.everyRounds !== 0)) return out;
  if (core.kind === "doomTarget") {
    out.push({
      kind: "doomStrike",
      damage: Math.round(weapon.baseDamage * core.damagePctOfWeaponBase),
      target: core.targetSelection,
      stun: { rounds: core.stunRounds, resistAfterFirst: core.stunDiminishing.resistAfterFirst }
    });
  } else if (core.kind === "aoeErosion") {
    out.push({
      kind: "coreAoe",
      damage: Math.round(weapon.baseDamage * core.mainDamagePct),
      othersDamage: Math.round(weapon.baseDamage * core.othersDamagePct),
      target: core.mode,
      vulnerability: core.vulnerability
    });
  }
  return out;
}

/**
 * 末日武器（核心）战斗资源消耗期望（在线逐触发实扣、离线按触发次数期望扣减、预览 UI 展示共用）。
 * 弹药类型跟随泰坦主武器 weaponType（与主武器同池，不新增弹药类型）；
 * 断供语义（阶段 3 接线）：燃料/弹药不足时核心跳过该次触发，不阻塞主武器、不阻塞 run。
 * @param {object} core TITAN_CORES 成员
 * @param {object} weapon TITAN_WEAPONS 成员（同组合主武器，fuelCost/ammoCost 为消耗基准）
 * @param {number} rounds 结算窗口轮数
 * @returns {{ fuel:number, ammo:number }}
 */
function getTitanCoreConsumption(core, weapon, rounds) {
  const c = core && core.consumption;
  if (!c || !(rounds > 0)) return { fuel: 0, ammo: 0 };
  const mainFuel = weapon.fuelCost || 0;
  if (c.mode === "sustain") {
    return { fuel: Math.round(mainFuel * (c.fuelPctOfVolley || 0)) * rounds, ammo: 0 };
  }
  const triggers = Math.floor(rounds / (core.everyRounds || 2));
  return {
    fuel: Math.round(mainFuel * (c.fuelPctOfVolley || 0)) * triggers,
    ammo: (c.ammoPerTrigger || 0) * triggers
  };
}

// ---------------------------------------------------------------------------
//  泰坦研究线（category "titan"）—— 乘区读取 / 槽位释放 / 协议业务取值
//
//  与星图线（legion-starmap-trial.js）/ 虫洞线（wormhole.js）同范式：
//    - 未研究 = 中性值（乘子 1 / 折扣 0 / 计数 0），绝不抛错、绝不返回 NaN。
//    - 只读 ResearchState（research-state.js 先于本文件加载，仍做守卫兼容探针）。
//  节点 ↔ 消费点（见 js/data/research.js RESEARCH_BONUS_CONSUMERS）：
//    tt_high/mid/low/rig → refreshTitanSlotResearch（槽位真值重算）
//    tt_eff             → selectors.getCombatFuelMultiplierFromState（泰坦燃料 + 核心消耗，在线/离线同源）
//    tt_repair          → selectors.getCombatRepairMultiplierFromState（泰坦三层维修量）
//    tt_forge           → selectors.getShipEngineeringSpeedBreakdown（泰坦组件/总装制造速度）
//    tt_matcost（协议） → getShipBuildingQuote（材料 −10%，唯一报价漏斗）+ getTitanAssemblyMaxCycles
//    tt_cap（协议）     → getCombatFuelMultiplierFromState / getArchaeologyFuelCostState（全船燃料 −10%）
// ---------------------------------------------------------------------------
function titanResearchApi() {
  return (typeof globalThis !== "undefined" && globalThis.ResearchState) ||
         (typeof window !== "undefined" && window.ResearchState) || null;
}
// 乘子（≥1）：未研究 → 1
function titanResearchMultiplier(state, groups) {
  const RS = titanResearchApi();
  if (!RS || typeof RS.getResearchMultiplier !== "function") return 1;
  const v = Number(RS.getResearchMultiplier(state, groups));
  return (Number.isFinite(v) && v > 0) ? v : 1;
}
// 折扣分数（0..1）：未研究 → 0
function titanResearchBonusValue(state, group) {
  const RS = titanResearchApi();
  if (!RS || typeof RS.getResearchBonusValue !== "function") return 0;
  const v = Number(RS.getResearchBonusValue(state, group));
  return (Number.isFinite(v) && v > 0) ? v : 0;
}
// 原始整数（unit:"count" 的槽位组）：未研究 → 0
function titanResearchRaw(state, group) {
  const RS = titanResearchApi();
  if (!RS || typeof RS.getResearchBonusRaw !== "function") return 0;
  const v = Number(RS.getResearchBonusRaw(state, group));
  return Number.isFinite(v) ? v : 0;
}
// 协议节点（bonus:null）完成等级（0/1）
function titanProtocolLevel(state, nodeId) {
  const completed = state && state.research && state.research.completedLevels;
  if (!completed || typeof completed !== "object") return 0;
  return Math.max(0, Number(completed[nodeId]) || 0);
}
// 兜底取当前存档（注册/刷新发生在 sanitize 之外时）
function titanCurrentState(state) {
  if (state && typeof state === "object") return state;
  if (typeof gameState !== "undefined" && gameState) return gameState;
  return (typeof window !== "undefined" && window.gameState) || null;
}

// 电容回充协议（tt_cap）研究值：与装备「电容回充」改装件满级档同值（equipment.js:211 values[4]=0.10）。
// 语义为「加算折扣」——与改装件 archaeologyFuelEfficiency 共用同一消费口径，不新增系数。
const TITAN_CAP_RECHARGE_BONUS = 0.10;
// 泰坦材料精算协议（tt_matcost）：材料需求 ×0.90。
const TITAN_MATERIAL_COST_MULT = 0.90;
// 受「泰坦材料精算」影响的两种泰坦精炼材料（中文名，与组件/总装配方 cost 键一致）。
const TITAN_MATERIAL_COST_NAMES = Object.freeze([
  TITAN_SMELTING.outputs.titan_alloy_forgestar.name,   // 锻星合金
  TITAN_SMELTING.outputs.titan_crystal_meltvoid.name   // 熔虚晶体
]);

// ---- 槽位研究释放（幂等，原地重算）----
// TITAN_HULLS[*].slots 是只读设计真值，严禁写入；注册表（SHIP_DATA.titan）内的 cfg.slots 为
// 可重算副本：每次按「舰体基础槽位 + 研究增量」重写。读点（getShipConfigById / state.getShipSlotCounts /
// actions.setFittingSlot / selectors.getShipFittingDisplayState / 战斗模块装配）全部读注册表，
// 故只需刷新注册表即可全链路生效，无需改任何读点。
//   高槽语义：high = 物理高槽总数（不变），highUsable = 可装普通武器的高槽数；
//   末日武器占用 [highUsable, high) 段 → tt_high 每级 +1 highUsable，占用 7→5。
function getTitanSlotBonus(state) {
  const s = titanCurrentState(state);
  return {
    high: titanResearchRaw(s, "titanHighSlot"),
    mid: titanResearchRaw(s, "titanMidSlot"),
    low: titanResearchRaw(s, "titanLowSlot"),
    rig: titanResearchRaw(s, "titanRigSlot")
  };
}
function computeTitanSlotsWithResearch(hullSlots, bonus) {
  const b = hullSlots || {};
  const g = bonus || { high: 0, mid: 0, low: 0, rig: 0 };
  return {
    high: Number(b.high) || 0,
    highUsable: (Number(b.highUsable) || 0) + (Number(g.high) || 0),
    mid: (Number(b.mid) || 0) + (Number(g.mid) || 0),
    low: (Number(b.low) || 0) + (Number(g.low) || 0),
    rig: (Number(b.rig) || 0) + (Number(g.rig) || 0)
  };
}
// 刷新注册表内全部泰坦配置的 slots；返回处理条数。任何时刻调用都安全（幂等）。
function refreshTitanSlotResearch(state) {
  const reg = getTitanConfigRegistry();
  if (!reg) return 0;
  const bonus = getTitanSlotBonus(state);
  let count = 0;
  for (const shipId of Object.keys(reg)) {
    const cfg = reg[shipId];
    if (!cfg || cfg.type !== "titan") continue;
    const hull = TITAN_HULLS[cfg.hullId];
    if (!hull || !hull.slots) continue;
    const next = computeTitanSlotsWithResearch(hull.slots, bonus);
    const prev = cfg.slots || {};
    // 首次注册时 cfg.slots 与 hull.slots 同值但也必须换成独立副本（防污染单例），故不做「相等则跳过」优化。
    if (prev.high !== next.high || prev.highUsable !== next.highUsable ||
        prev.mid !== next.mid || prev.low !== next.low || prev.rig !== next.rig) {
      cfg.slots = next;
    } else if (cfg.slots === hull.slots) {
      cfg.slots = next;
    }
    count++;
  }
  return count;
}

// ---- 数值节点 getter ----
// 泰坦燃料 + 核心消耗折扣（tt_eff）：返回加算折扣分数（0..0.15），并入燃料乘区的省油折扣。
function getTitanFuelConsumptionBonus(state) { return titanResearchBonusValue(state, "titanConsumption"); }
// 泰坦维修量乘区（tt_repair）：≥1。
function getTitanRepairMultiplier(state) { return titanResearchMultiplier(state, ["titanRepair"]); }
// 泰坦组件/总装制造速度乘区（tt_forge）：≥1（与主树 shipComp/shipAsm 同口径，速度乘区）。
function getTitanForgeSpeedMultiplier(state) { return titanResearchMultiplier(state, ["titanForge"]); }
// 全船电容回充（tt_cap）：返回加算折扣分数（0 或 0.10）。
function getCapacitorRechargeBonus(state) { return titanProtocolLevel(state, "tt_cap") >= 1 ? TITAN_CAP_RECHARGE_BONUS : 0; }
// 泰坦材料精算协议（tt_matcost）是否已完成。
function isTitanMaterialCostReductionActive(state) { return titanProtocolLevel(state, "tt_matcost") >= 1; }
/**
 * 按「泰坦材料精算」协议缩放单个材料需求量（唯一入口，严禁在别处重写 ×0.9）。
 * 仅作用于两种泰坦精炼材料；其余材料原值返回；取整向上、下限 1。
 */
function applyTitanMaterialCostResearch(state, matName, qty) {
  const q = Number(qty);
  if (!(q > 0)) return qty;
  if (TITAN_MATERIAL_COST_NAMES.indexOf(String(matName)) < 0) return qty;
  if (!isTitanMaterialCostReductionActive(state)) return qty;
  return Math.max(1, Math.ceil(q * TITAN_MATERIAL_COST_MULT));
}
/**
 * 按「泰坦材料精算」协议缩放整张材料成本表；返回新对象（不改原表，静态配方保持不可变）。
 */
function applyTitanMaterialCostResearchToCost(state, cost) {
  if (!cost || typeof cost !== "object") return cost;
  if (!isTitanMaterialCostReductionActive(state)) return cost;
  let touched = false;
  const out = {};
  for (const mat of Object.keys(cost)) {
    if (!Object.prototype.hasOwnProperty.call(cost, mat)) continue;
    const v = applyTitanMaterialCostResearch(state, mat, cost[mat]);
    if (v !== cost[mat]) touched = true;
    out[mat] = v;
  }
  return touched ? out : cost;
}

// 暴露给浏览器（经典脚本语义，与 ships.js 相同）与 Node（测试探针）。
const TITAN_DATA = { TITAN_HULLS, TITAN_WEAPONS, TITAN_CORES };
const TITAN_RESEARCH = {
  getTitanSlotBonus,
  refreshTitanSlotResearch,
  getTitanFuelConsumptionBonus,
  getTitanRepairMultiplier,
  getTitanForgeSpeedMultiplier,
  getCapacitorRechargeBonus,
  isTitanMaterialCostReductionActive,
  applyTitanMaterialCostResearch,
  applyTitanMaterialCostResearchToCost,
  TITAN_CAP_RECHARGE_BONUS,
  TITAN_MATERIAL_COST_MULT,
  TITAN_MATERIAL_COST_NAMES
};
if (typeof window !== "undefined") {
  window.TITAN_DATA = TITAN_DATA;
  window.TITAN_HULLS = TITAN_HULLS;
  window.TITAN_WEAPONS = TITAN_WEAPONS;
  window.TITAN_CORES = TITAN_CORES;
  window.TITAN_UNLOCK = TITAN_UNLOCK;
  window.TITAN_SMELTING = TITAN_SMELTING;
  window.TITAN_COMPONENT_COSTS = TITAN_COMPONENT_COSTS;
  window.TITAN_DATA_LINEAGE = TITAN_DATA_LINEAGE;
  window.TITAN_COMPONENT_RECIPES = TITAN_COMPONENT_RECIPES;
  window.isTitanComponentUnlocked = isTitanComponentUnlocked;
  // 方案 C 注册表接口（selectors / persistence / 组装 action 消费）
  window.TITAN_SHIP_ID_PREFIX = TITAN_SHIP_ID_PREFIX;
  window.makeTitanShipId = makeTitanShipId;
  window.parseTitanShipId = parseTitanShipId;
  // 船坞 3D：shipId → TitanFactory 视觉参数（船坞缩略图/3D 弹窗的唯一取值入口）
  window.TITAN_VISUAL_PARTS = TITAN_VISUAL_PARTS;
  window.getTitanVisualSpec = getTitanVisualSpec;
  window.registerTitanConfig = registerTitanConfig;
  window.resolveTitanConfigByShipId = resolveTitanConfigByShipId;
  window.registerTitanShipsFromState = registerTitanShipsFromState;
  window.getTitanComponentIdFor = getTitanComponentIdFor;
  window.getTitanAssemblyRecipe = getTitanAssemblyRecipe;
  window.getTitanAssemblyMaxCycles = getTitanAssemblyMaxCycles;
  // 泰坦研究线（category "titan"）唯一入口：乘区读取 / 槽位释放 / 协议业务取值
  window.TITAN_RESEARCH = TITAN_RESEARCH;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { TITAN_DATA, TITAN_HULLS, TITAN_WEAPONS, TITAN_CORES, TITAN_UNLOCK, TITAN_SMELTING, TITAN_COMPONENT_COSTS, TITAN_DATA_LINEAGE, TITAN_COMPONENT_RECIPES, TITAN_HULL_IDS, TITAN_WEAPON_IDS, TITAN_CORE_IDS, isTitanComboValid, isTitanComponentUnlocked, buildTitanConfig, listTitanCombinations, getTitanWeaponRoundDamage, getTitanExtraAttacks, getTitanCoreAura, getTitanCoreStrikes, getTitanCoreConsumption, makeTitanShipId, parseTitanShipId, TITAN_VISUAL_PARTS, getTitanVisualSpec, registerTitanConfig, resolveTitanConfigByShipId, registerTitanShipsFromState, TITAN_RESEARCH };
}
