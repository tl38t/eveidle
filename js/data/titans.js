// ---- 泰坦：舰体 × 武器 × 核心 三模块数据表（27 组合） ----
// 数值真值：TITAN_NUMERICAL_DESIGN_HANDOFF.md + 2026-09-09 封版表（会话确认）。
// 约定：
//   1. hp 为基础值，实战 HP 走与超级旗舰同一乘区管线（selectors.js getActiveShipCombatHp：
//      基础 × capacity 加成 × 技能 × 装备 × 强化 × rig × 脑插 × 军团 × 科研）。
//   2. 舰体 bonuses 只带 capacity / 维修 / 命中，不带武器伤害 %（武器基伤已含档位强度，避免二次相乘）。
//      盾线只加容量（对齐星冕级惯例，ship 级无 shieldRepair 字段）；甲线容量+维修；结线容量+维修+紧急维修。
//   3. 高槽 7 格出厂全部被末日武器占用（highUsable=0），后续由泰坦科技线释放（本文件不设计研究侧）。
//   4. 战斗规则纯函数在本文件底部，阶段 3 由 capital-combat / offline-combat 共同调用，禁止在调用方重写公式。
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
      description: "每损失10%结构，泰坦武器最终伤害提高6%，最多5层，战斗结束重置；每层过载使结构维修量提高15%",
      thresholdPct: 0.10, perLayer: 0.06, maxLayers: 5,
      hook: { id: "overdrive_seal", name: "过载密封", trigger: "onEnemyPhaseEnd", baseRestoreRate: 0.12, perLayerRepairBonus: 0.15 }
    }
  }
};

const TITAN_WEAPONS = {
  titan_weapon_dawn_spear: {
    id: "titan_weapon_dawn_spear", name: "曙光长矛", weaponType: "laser",
    flavor: "持续输出，每发扫掠切割邻敌，并贯穿目标下一层防御",
    baseDamage: 10350, baseHit: 100,
    // 资源消耗锚点：单门泰坦主武器 ≈ 等效 7 门旗舰级武器的齐射负荷（7×15，沿用激光:导弹:火炮=3:2:1）；
    // ammoCost 7 = 等效 7 门各 1 发（现网全档 ammoCost:1/门/轮），弹药类型 laser 与现网同池
    fuelCost: 105, ammoCost: 7,
    // 扫掠光束：沿用超旗激光「每发扫掠」招牌（equipment.js aoe mode:"next"），数值取超旗同档 30%
    perShotSweep: { id: "sweeping_beam", name: "扫掠光束", mode: "next", damagePct: 0.30, count: 1 },
    // 贯穿射击：主命中落在某防御层时，额外对下一层防御（盾→甲→甲→结）造成主命中 20% 的伤害；命中结构层（无下一层）不触发
    extraAttack: { id: "piercing_shot", name: "贯穿射击", trigger: "perShot", kind: "layerPierce", damagePct: 0.20 }
  },
  titan_weapon_skyfire_salvo: {
    id: "titan_weapon_skyfire_salvo", name: "天火齐射", weaponType: "missile",
    flavor: "覆盖型清场压制，齐射覆盖所有副目标，高爆装药周期性重创",
    baseDamage: 9630, baseHit: 130,
    fuelCost: 70, ammoCost: 7,   // 等效 7 门旗舰导弹（7×10），弹药类型 missile 同池
    // 齐射覆盖：沿用超旗导弹「每发对主目标以外所有存活敌 12%」招牌（equipment.js aoe mode:"all" 0.12）；单敌时无副目标、自然落空
    perShotSweep: { id: "salvo_coverage", name: "齐射覆盖", mode: "all", damagePct: 0.12 },
    // 高爆装药（暴击，本游戏首个暴击机制）：每发 25% 几率 ×2.0 暴伤；齐射覆盖的每一枚溅射同样独立掷暴击
    crit: { id: "high_explosive_payload", name: "高爆装药", chance: 0.25, multiplier: 2.0, appliesToSweep: true }
  },
  titan_weapon_throne_quake: {
    id: "titan_weapon_throne_quake", name: "震荡王座", weaponType: "cannon",
    flavor: "重炮压制，破片覆盖邻敌并在攻坚期强化，有机会打出第二轮破片",
    baseDamage: 9000, baseHit: 80,
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
// ---- 深层舰船数据谱系映射（九组件 materialCost 依据，用户拍板）----
// 舰体=谱系载体（盾→天穹/甲→重垒/结→裂界）；武器沿用超旗推荐武器绑定（星冕↔激光/恒城↔导弹/裁决↔火炮）；
// 核心（末日武器）吃三线混合各 20（共 60），三条数据线在末日件处收敛。
// 每组件数据负载均为 60，与超旗舰总装 60/艘 同档；跨谱系组合（如天穹壁垒+震荡王座）自然消耗两条线的数据。
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
  coreMixed: Object.freeze(["天穹深层舰船数据", "重垒深层舰船数据", "裂界深层舰船数据"])
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
    dataKey: "all", dataAmount: 20,                // 三线混合：TITAN_DATA_LINEAGE.coreMixed 各 20（共 60）
    refined: Object.freeze({ titan_crystal_meltvoid: 400 })
  }),
  assembly: Object.freeze({
    id: "titan_assembly", name: "泰坦总装", baseTime: 3600, xp: 1500, shipyardLevel: 3,
    regular: Object.freeze({}),
    isk: 5000000,
    refined: Object.freeze({ titan_alloy_forgestar: 200 })
  })
});

// ---- 部件车间接入（2026-09-09 用户拍板）：7 条静态配方变体 + 门禁 ----
// 生成规则：TITAN_COMPONENT_COSTS（常规材料/时间/XP）+ TITAN_DATA_LINEAGE（深层数据谱系）→ SHIP_COMPONENT_RECIPES 静态配方。
// 谱系决定变体：舰体×3（天穹/重垒/裂界）、武器×3（曙光/天火/震荡）、核心×1（三线各 20 混合）。
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
  // 核心组件 ×1：三线数据各 20 收敛（末日件）
  recipes.push({
    id: costs.core.id,
    name: costs.core.name,
    level: 100, time: costs.core.baseTime, xp: costs.core.xp,
    titanLine: "core",
    cost: Object.assign({}, costs.core.regular, lineage.coreMixed.reduce((acc, dataName) => { acc[dataName] = costs.core.dataAmount; return acc; }, {}), costs.core.refined.titan_crystal_meltvoid ? { [TITAN_SMELTED_MATERIAL_NAMES.titan_crystal_meltvoid]: costs.core.refined.titan_crystal_meltvoid } : {})
  });
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

// 泰坦组件制造门禁（用户拍板方案 b）：制压先驱文明核心（合成总门禁）+ 分线制压泰坦节点
// （舰体线 node20 / 武器线 node62 / 核心线 node104）。船坞 Lv3 与工程等级门在 station.js / recipe.level。
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
  else if (recipeId === "titan_component_core") gate = TITAN_UNLOCK.moduleNodes.core;
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

function buildTitanConfig(hullId, weaponId, coreId) {
  if (!isTitanComboValid(hullId, weaponId, coreId)) return null;
  const hull = TITAN_HULLS[hullId];
  const weapon = TITAN_WEAPONS[weaponId];
  const core = TITAN_CORES[coreId];
  return {
    id: hullId + "_" + weaponId + "_" + coreId,
    name: hull.name + "·" + weapon.name + "·" + core.name,
    type: "titan", tier: "泰坦",
    hull, weapon, core,
    hp: hull.hp, totalHp: hull.totalHp,
    dodge: hull.dodge, speed: hull.speed, targeting: hull.targeting,
    capacitor: hull.capacitor, fuelEfficiency: hull.fuelEfficiency,
    slots: hull.slots, bonuses: hull.bonuses, capitalTrait: hull.capitalTrait
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

// 暴露给浏览器（经典脚本语义，与 ships.js 相同）与 Node（测试探针）。
const TITAN_DATA = { TITAN_HULLS, TITAN_WEAPONS, TITAN_CORES };
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
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { TITAN_DATA, TITAN_HULLS, TITAN_WEAPONS, TITAN_CORES, TITAN_UNLOCK, TITAN_SMELTING, TITAN_COMPONENT_COSTS, TITAN_DATA_LINEAGE, TITAN_COMPONENT_RECIPES, TITAN_HULL_IDS, TITAN_WEAPON_IDS, TITAN_CORE_IDS, isTitanComboValid, isTitanComponentUnlocked, buildTitanConfig, listTitanCombinations, getTitanWeaponRoundDamage, getTitanExtraAttacks, getTitanCoreAura, getTitanCoreStrikes, getTitanCoreConsumption };
}
