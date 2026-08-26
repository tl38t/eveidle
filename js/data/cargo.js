// ============================================================================
// 货柜系统（银河奶牛式宝箱）
// 敌方船被击坠低概率掉落货柜；尺寸按敌方船级+权重；开箱滚动四奖池 RDT。
// 设计要点：
//   - 尺寸（能出哪档）与内容（开出来什么）正交。
//   - 掉落时只发「货柜X」物品；内容在玩家点开时才揭晓（宝箱感）。
//   - 死亡空间不掉落货柜（与 gear/core 一致）。
//   - 数据驱动：CARGO_POOLS / CARGO_SIZE_TIER_WEIGHTS / CARGO_CLASS_SIZES 均可直接扩展。
// 资源 id 仅用已在 ResourceRegistry 真实存在的：mineral:/planetary:/currency:/special:。
//   T4 神经植入体为新增 special: 资源，首次发放自动注册。
// ============================================================================

const CARGO_SIZES = ["S", "M", "L", "XL"];

// 敌方船级 → 可掉货柜尺寸 + 权重（漏斗：船越大越不出小尺寸）
const CARGO_CLASS_SIZES = {
  frigate:     { sizes: ["S"],               weights: [1] },
  destroyer:   { sizes: ["S", "M"],          weights: [0.80, 0.20] },
  cruiser:     { sizes: ["M"],               weights: [1] },
  battleship:  { sizes: ["M", "L"],          weights: [0.75, 0.25] },
  capital:     { sizes: ["L", "XL"],         weights: [0.80, 0.20] },
  supercapital: { sizes: ["L", "XL"],        weights: [0.70, 0.30] },
};

// 每个被击坠敌人的基础掉落概率（按 kind）；同比例压缩 ÷10：normal 0.6% / elite 1.0% / boss 1.5%
const CARGO_DROP_CHANCE = { normal: 0.006, elite: 0.010, boss: 0.015 };

// ============================================================================
// 同位素标记打捞臂：主动打捞舰船组件（开启开关 + 已装备打捞臂 + 有同位素时触发）
//   - 档位按「敌舰等级」映射到舰船工程部件配方等级（1/15/35/55/80/90）。
//   - 每个档位 3 种基础组件（综合舰体/动力核心/功能组件），命中随机抽 1 种。
//   - 数量随敌舰 kind：normal×1 / elite×2 / boss×3（与同位素消耗保持一致）。
//   - 触发概率同货柜级别：baseChance[kind] × (1+ΣsalvageEfficiency)，上限 50%。
// ============================================================================
const SALVAGE_COMPONENT_TIERS = [
  { min: 90, tier: "supercapital" },
  { min: 80, tier: "capital" },
  { min: 55, tier: "battleship" },
  { min: 35, tier: "cruiser" },
  { min: 15, tier: "destroyer" },
  { min: 0,  tier: "" }
];
const SALVAGE_COMPONENT_IDS = {
  "": ["integrated_hull", "power_core", "functional_system"],
  "destroyer": ["destroyer_integrated_hull", "destroyer_power_core", "destroyer_functional_system"],
  "cruiser": ["cruiser_integrated_hull", "cruiser_power_core", "cruiser_functional_system"],
  "battleship": ["battleship_integrated_hull", "battleship_power_core", "battleship_functional_system"],
  "capital": ["capital_integrated_hull", "capital_power_core", "capital_functional_system"],
  "supercapital": ["supercapital_integrated_hull", "supercapital_power_core", "supercapital_functional_system"]
};
function getSalvageComponentTier(enemyLevel) {
  const lv = Number(enemyLevel) || 0;
  for (const t of SALVAGE_COMPONENT_TIERS) if (lv >= t.min) return t.tier;
  return "";
}
function getSalvageComponentQty(kind) {
  return kind === "boss" ? 3 : (kind === "elite" ? 2 : 1);
}

// 尺寸 → 开箱抽取次数（越大越多奖励）
const CARGO_SIZE_ROLLS = { S: 1, M: 1, L: 2, XL: 3 };

// 尺寸 → 四奖池 tier 权重（越大越往 T3/T4 偏）
// 相对权重（cargoWeightedPick 内部归一化）。BP = 尺寸化装备蓝图奖励档（D→S / C→M / B→L / A→XL）。
const CARGO_SIZE_TIER_WEIGHTS = {
  S:  { T1: 0.75, T2: 0.20, T3: 0.05, T4: 0.00, BP: 0.08 },
  M:  { T1: 0.60, T2: 0.28, T3: 0.11, T4: 0.01, BP: 0.09 },
  L:  { T1: 0.45, T2: 0.32, T3: 0.19, T4: 0.04, BP: 0.10 },
  XL: { T1: 0.30, T2: 0.35, T3: 0.25, T4: 0.10, BP: 0.12 },
};

// 敌方模板 key → 船级（三阵营，按名/级已核对；缺省 frigate）
const ENEMY_CARGO_CLASS = {
  angel: {
    scout: "frigate", raider: "frigate", commander: "frigate",
    patrol_destroyer: "destroyer", raider_destroyer: "destroyer", hunter_commander: "frigate",
    strike_cruiser: "cruiser", war_cruiser: "cruiser", fleet_commander: "cruiser",
    siege_battleship: "battleship", marauder_battleship: "battleship", war_master: "battleship",
    frontier_capital: "capital", domination_capital: "capital", outer_reach_overseer: "capital",
    abyssal_supercapital: "supercapital", seraph_supercapital: "supercapital", deep_domain_overlord: "supercapital"
  },
  blood: {
    acolyte: "frigate", priest: "frigate", cardinal: "frigate",
    ritual_destroyer: "destroyer", blood_destroyer: "destroyer", high_priest: "frigate",
    sermon_cruiser: "cruiser", sacrament_cruiser: "cruiser", blood_archon: "cruiser",
    iron_battleship: "battleship", apostle_battleship: "battleship", blood_sovereign: "battleship",
    covenant_capital: "capital", apostolic_capital: "capital", outer_reliquary_overseer: "capital",
    abyssal_blood_supercapital: "supercapital", crimson_supercapital: "supercapital", deep_reliquary_overlord: "supercapital"
  },
  sansha: {
    drone: "frigate", sentinel: "frigate", overlord: "frigate",
    control_destroyer: "destroyer", sentinel_destroyer: "destroyer", control_overlord: "frigate",
    assimilation_cruiser: "cruiser", dominion_cruiser: "cruiser", nexus_overlord: "cruiser",
    command_battleship: "battleship", domination_battleship: "battleship", matrix_overlord: "battleship",
    nexus_capital: "capital", dominion_capital: "capital", outer_array_overseer: "capital",
    abyssal_nexus_supercapital: "supercapital", ascendant_supercapital: "supercapital", deep_nexus_overlord: "supercapital"
  }
};

function getEnemyCargoClass(faction, enemyKey) {
  if (!enemyKey) {
    // 防御：船级 key 缺失时不再静默兜底成护卫级（曾因离线敌人快照漏拷 type 导致所有离线星带掉 S 货柜）。
    // 明确告警，便于定位缺失来源，而非悄悄降级。
    if (typeof console !== "undefined" && console.warn) console.warn("[cargo] getEnemyCargoClass: enemyKey 缺失 faction=" + faction + "，兜底 frigate");
    return "frigate";
  }
  const map = ENEMY_CARGO_CLASS[faction];
  return (map && map[enemyKey]) || "frigate";
}

// T1 保底三选一（全尺寸统一内容池，等权随机其一，数额随尺寸缩放）。
// 行星材料按尺寸递增解锁：S=三选一（重金属/稀有气体/同位素）；M 加等离子体；L 加生物质；XL 加磁场聚合体。
// 基础矿物已挪至 T2 池；T1 三选一在开箱选中 T1 时等权随机其一发放（见 rollCargoT1）。
const CARGO_T1_PLANETARY_BASE = ["planetary:重金属", "planetary:稀有气体", "planetary:同位素"];
// 尺寸递增累积解锁：M 加等离子体，L 再加生物质，XL 再加磁场聚合体（非覆盖）。
const CARGO_T1_PLANETARY_UNLOCK = {
  M: "planetary:等离子体",
  L: "planetary:生物质",
  XL: "planetary:磁场聚合物"
};
function cargoT1PlanetaryChoices(size) {
  const order = ["S", "M", "L", "XL"];
  const idx = order.indexOf(size);
  const choices = CARGO_T1_PLANETARY_BASE.slice();
  for (let i = 1; i <= idx; i++) {
    const extra = CARGO_T1_PLANETARY_UNLOCK[order[i]];
    if (extra) choices.push(extra);
  }
  return choices;
}
// 行星材料：每种按真实产能 interval 给出「20 分钟单颗产出」（±10% 浮动），开箱选中哪种就按哪种计。
// 数据来源 js/data/planets.js:PLANET_TYPES（interval 秒/单位；20min = 1200s）。
const CARGO_T1_PLANETARY_20MIN = {
  "planetary:重金属":      [108, 132], // 熔岩 interval10 → 120
  "planetary:稀有气体":    [108, 132], // 气态 interval10 → 120
  "planetary:同位素":      [72, 88],   // 冰   interval15 → 80
  "planetary:等离子体":    [60, 74],   // 等离子 interval18 → 67
  "planetary:生物质":      [50, 60],   // 温带 interval22 → 55
  "planetary:磁场聚合物":  [36, 44]    // 风暴 interval30 → 40
};
const CARGO_T1_QTY = {
  tactical: [180, 210],  // 战术残液：收紧至 180–210（≈13–15min 战斗 farm）
  isk:      [5000, 30000]
};
const CARGO_T1_SIZE_MUL = { S: 1, M: 1.6, L: 2.6, XL: 4.2 };

// 具名战利品名池：开箱抽到 isk/lp 兑换物时随机抽一个风味名（数值仍按档位/尺寸走，名字只是皮肤）。
// 兑换（出售换星币 / 兑换换功勋）UI 暂缓，与考古翻新一并做；道具先铸入 state.cargoLoot 持久化。
const CARGO_ISK_LOOT_NAMES = [
  "贵金属锭", "沙丘星球香料罐", "签名球星卡", "走私能量电池", "黑市反应堆核心",
  "稀有同位素样本", "加密黑匣", "失窃艺术品", "违禁纳米机械", "古董星图",
  "液态铱原浆", "仿生珠宝", "海盗藏宝密钥"
];
const CARGO_LP_LOOT_NAMES = [
  "染血海盗狗牌", "敌舰舰长徽章", "击坠战旗", "通缉悬赏凭证", "残破敌阵布防图",
  "海盗颅骨标本", "缴获荣誉勋章", "敌方识别信标", "战损敌舰铭牌", "击杀记录芯片",
  "叛军宣战书", "染血战术终端", "敌方王牌飞行员执照", "太阳能战斧", "璀璨星图"
];

// 货柜弹药展示名（按武器类型 + 档位）。实际实例命名由 addAmmo 用 AMMO_TYPE_NAMES（仅 T1 名），
// 故 T2 弹此处显式给专属名。数量见 CARGO_POOLS 的 ammo:T1/ammo:T2（基数 × CARGO_T1_SIZE_MUL 按尺寸缩放）。
const CARGO_AMMO_WEAPON_NAMES = {
  laser:   { T1: "激光晶体弹药", T2: "聚焦相位激光弹" },
  missile: { T1: "导弹",         T2: "高爆制导导弹" },
  cannon:  { T1: "炮台弹药",     T2: "重型轨道弹药" }
};

// 四奖池（T2软通货 / T3稀有 / T4头奖-神经植入体）；T1 为上面的保底四件套，不走本池。
// 条目 id 形如 loot:isk / loot:lp 表示「具名可兑换物」（不直接入账，铸成背包战利品）；其它为直接入账资源。
// 条目：{ id, qty:[min,max] 或 qty, weight }
// 逐尺寸定制预留：CARGO_SIZE_POOLS[size][tier] 存在时优先于通用 CARGO_POOLS[tier]。
const CARGO_SIZE_POOLS = {};
const CARGO_POOLS = {
  T2: [
    { id: "loot:isk",             qty: [50000, 250000], weight: 30 },
    { id: "loot:lp",              qty: [25, 100],       weight: 24 },
    { id: "mineral:三钛合金",     qty: [30, 100],       weight: 8 },
    { id: "mineral:类银超金属",   qty: [30, 100],       weight: 8 },
    { id: "mineral:类晶体胶矿",   qty: [30, 100],       weight: 8 },
    { id: "mineral:超新星诺克石", qty: [40, 160],       weight: 12 },
    { id: "mineral:基腹断岩",     qty: [30, 120],       weight: 10 },
    { id: "planetary:等离子体",   qty: [40, 150],       weight: 8 },
    { id: "planetary:生物质",     qty: [30, 120],       weight: 8 },
    { id: "planetary:磁场聚合物", qty: [20, 80],        weight: 8 },
    { id: "ammo:T1",             qty: 75,               weight: 14 }  // 普通弹：随机一种武器类型；数量按尺寸缩放（S75/M120/L195/XL315，×1.5）
  ],
  T3: [
    // T3 含 T2 弹药 + 行星轴脑插；装备蓝图已按档位(D/C/B/A)移至 CARGO_BLUEPRINT_BY_SIZE（S/M/L/XL），作为独立 BP 奖励档。
    { id: "ammo:T2",              qty: 225,              weight: 12 }, // T2 弹×1.10独立乘区
    { id: "implant_planet_speed", qty: 1,                weight: 3 },  // 行星加速 +5%
    { id: "implant_planet_slot",  qty: 1,                weight: 3 }   // 行星槽位 +1
  ],
  T4: [
    // T4 仅保留冶炼/增强剂轴脑插（退役旧 special:神经植入体，由 implants 系统取代）。
    { id: "implant_refine_eff",     qty: 1, weight: 4 },  // 冶炼效率 +6%
    { id: "implant_double_refine",  qty: 1, weight: 4 },  // 冶炼 3% 概率产出×2
    { id: "implant_booster_eff",    qty: 1, weight: 4 },  // 增强剂制造效率 +6%
    { id: "implant_double_booster", qty: 1, weight: 4 }   // 增强剂 3% 概率产出×2
  ]
};

// 货柜装备蓝图：按「装备生产许可」档位(D/C/B/A) 分配到对应尺寸货柜，作为独立 BP 奖励档（与 T1–T4 并列）。
// D(lv10 前哨型)→S · C(lv25)→M · B(lv45)→L · A(lv65 破阵/铁血/枢纽型)→XL。各蓝图沿用 1.5 权重。
// 发放逻辑复用 grantEquipmentBlueprintFromCargo：未拥有写入 ownedBlueprints；已拥有折算 loot:lp（按尺寸缩放）。
const CARGO_BLUEPRINT_BY_SIZE = {
  S:  [
    { id: "blueprint:angel_mining_laser_outpost",          weight: 1.5 },
    { id: "blueprint:angel_mineral_assimilation_outpost",  weight: 1.5 },
    { id: "blueprint:sansha_drone_link_outpost",           weight: 1.5 },
    { id: "blueprint:angel_gas_assimilation_outpost",      weight: 1.5 },
    { id: "blueprint:angel_salvage_injector_outpost",     weight: 1.5 }
  ],
  M:  [
    { id: "blueprint:blood_servant_drone_link_sacrifice",  weight: 1.5 },
    { id: "blueprint:sansha_mineral_assimilation_node",    weight: 1.5 },
    { id: "blueprint:sansha_gas_assimilation_node",        weight: 1.5 },
    { id: "blueprint:sansha_salvage_injector_node",        weight: 1.5 }
  ],
  L:  [
    { id: "blueprint:blood_mining_laser_hunt",             weight: 1.5 },
    { id: "blueprint:blood_mineral_assimilation_nexus",    weight: 1.5 },
    { id: "blueprint:sansha_gas_harvester_nexus",          weight: 1.5 },
    { id: "blueprint:blood_gas_assimilation_nexus",        weight: 1.5 },
    { id: "blueprint:blood_salvage_injector_nexus",        weight: 1.5 }
  ],
  XL: [
    { id: "blueprint:angel_drone_link_war",                weight: 1.5 },
    { id: "blueprint:blood_gas_harvester_iron",            weight: 1.5 },
    { id: "blueprint:sansha_mining_laser_war",             weight: 1.5 }
  ]
};

// 货柜增强剂蓝图：精工(neural_booster_r)→M/L/XL，传奇(neural_booster_l)→L/XL（与「M+ / L+ 货柜」一致）。
// 与装备蓝图并列同走 BP 奖励档；发放逻辑 grantBoosterBlueprintFromCargo 镜像装备（已拥有折算功勋，S200/M320/L520/XL840）。
const CARGO_BOOSTER_BLUEPRINT_BY_SIZE = {
  M:  [ { id: "neural_booster_r", weight: 1.2, booster: true } ],
  L:  [ { id: "neural_booster_r", weight: 1.2, booster: true }, { id: "neural_booster_l", weight: 0.8, booster: true } ],
  XL: [ { id: "neural_booster_r", weight: 1.2, booster: true }, { id: "neural_booster_l", weight: 0.8, booster: true } ]
};

function cargoItemId(size) { return "special:货柜" + size; }

// 加权抽取：items = [{id, weight}]，返回选中项
function cargoWeightedPick(items, rng) {
  const r = (typeof rng === "function" ? rng() : Math.random());
  let total = 0;
  for (const it of items) total += (it.weight || 0);
  if (total <= 0) return items[items.length - 1];
  let acc = r * total;
  for (const it of items) {
    acc -= (it.weight || 0);
    if (acc <= 0) return it;
  }
  return items[items.length - 1];
}

function cargoRollQty(entry, rng) {
  if (Array.isArray(entry.qty)) {
    const lo = entry.qty[0], hi = entry.qty[1];
    return lo + Math.floor((typeof rng === "function" ? rng() : Math.random()) * (hi - lo + 1));
  }
  return entry.qty;
}

// 铸一件具名战利品进 state.cargoLoot（不直接入账；日后在统一兑换界面「出售」变星币 /「兑换」变功勋）。
// kind: "isk" → 来自 CARGO_ISK_LOOT_NAMES；"lp" → 来自 CARGO_LP_LOOT_NAMES。value 即兑换价值。
// state.cargoLoot 缺省时兜底建空数组（兼容旧存档未含该字段）。
let _cargoLootSeq = 0;
function cargoGrantLoot(state, kind, value, rng) {
  if (!state.cargoLoot) state.cargoLoot = [];
  const pool = kind === "isk" ? CARGO_ISK_LOOT_NAMES : CARGO_LP_LOOT_NAMES;
  const r = (typeof rng === "function" ? rng() : Math.random());
  const name = pool[Math.floor(r * pool.length)] || pool[0];
  const item = { id: "cl" + (++_cargoLootSeq), name, kind, value };
  state.cargoLoot.push(item);
  return item;
}

// 货柜开出装备蓝图：复用 buyLPItem 的 ownedBlueprints 写入契约 + blueprint:acquired 事件。
// 已拥有 -> 折算 loot:lp 安慰奖（按货柜尺寸缩放），杜绝废掉落。返回发放明细对象或 null。
function grantEquipmentBlueprintFromCargo(state, equipmentId, size, rng) {
  const eq = (typeof EQUIPMENT_DB !== "undefined") ? EQUIPMENT_DB[equipmentId] : null;
  if (!eq) return null;
  const key = (typeof getEquipmentBlueprintOwnershipKey === "function")
    ? getEquipmentBlueprintOwnershipKey(equipmentId)
    : ("equipment:" + equipmentId);
  const owned = (typeof hasEquipmentBlueprintFromState === "function")
    ? hasEquipmentBlueprintFromState(state, equipmentId)
    : (Array.isArray(state.ownedBlueprints) && state.ownedBlueprints.includes(key));
  if (owned) {
    const mul = CARGO_T1_SIZE_MUL[size] || 1;
    const base = Math.max(1, Math.round(200 * mul)); // S200/M320/L520/XL840
    const item = cargoGrantLoot(state, "lp", base, rng);
    return { id: "loot:lp", qty: base, loot: true, name: item.name, kind: "lp", dupBlueprint: true };
  }
  if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
  state.ownedBlueprints.push(key);
  state._dirty = true;
  if (typeof GameEvents !== "undefined") {
    GameEvents.emit("blueprint:acquired", { ownershipKey: key, blueprintKind: "equipment", productId: equipmentId }, { timestamp: Date.now(), source: "cargo", offline: false });
  }
  return { id: "blueprint:" + equipmentId, blueprint: true, equipmentId, name: eq.name + "蓝图" };
}

// 货柜开出增强剂蓝图：复用 ownedBlueprints 唯一事实源（前缀 "booster:"，与装备 "equipment:" 区分）。
// 未拥有写入 ownedBlueprints + blueprint:acquired 事件；已拥有折算 loot:lp 安慰奖（按货柜尺寸缩放），杜绝废掉落。
function grantBoosterBlueprintFromCargo(state, recipeId, size, rng) {
  const recipe = (typeof getBoosterRecipe === "function") ? getBoosterRecipe(recipeId) : null;
  if (!recipe) return null;
  const key = getBoosterBlueprintOwnershipKey(recipeId);
  const owned = hasBoosterBlueprintFromState(state, recipeId);
  if (owned) {
    const mul = CARGO_T1_SIZE_MUL[size] || 1;
    const base = Math.max(1, Math.round(200 * mul)); // S200/M320/L520/XL840
    const item = cargoGrantLoot(state, "lp", base, rng);
    return { id: "loot:lp", qty: base, loot: true, name: item.name, kind: "lp", dupBlueprint: true };
  }
  if (!Array.isArray(state.ownedBlueprints)) state.ownedBlueprints = [];
  state.ownedBlueprints.push(key);
  state._dirty = true;
  if (typeof GameEvents !== "undefined") {
    GameEvents.emit("blueprint:acquired", { ownershipKey: key, blueprintKind: "booster", productId: recipeId }, { timestamp: Date.now(), source: "cargo", offline: false });
  }
  return { id: "booster:" + recipeId, blueprint: true, boosterId: recipeId, name: (recipe.name || recipeId) + "蓝图" };
}

// T1 保底三选一：行星材料（按尺寸三~六选一）/ 战术残液 / 星币战利品，等权随机其一，数额按尺寸缩放。
// 基础矿物已挪至 T2 池；功勋已移出 T1。返回发放明细数组（每项 { tier:"T1", id, qty }），供 openCargoContainer 汇总与 UI 展示。
function rollCargoT1(state, size, rng) {
  const mul = CARGO_T1_SIZE_MUL[size] || 1;
  const scaledQty = (base) => {
    const q = cargoRollQty({ qty: base }, rng) * mul;
    return Math.max(1, Math.floor(q));
  };
  const out = [];
  // 三选一：行星材料 / 战术残液 / 星币战利品，等权随机其一
  const pick = cargoWeightedPick([
    { id: "planetary", weight: 1 },
    { id: "tactical", weight: 1 },
    { id: "isk", weight: 1 },
  ], rng).id;
  if (pick === "planetary") {
    // 行星材料（按尺寸三~六选一，等权；按各自真实 20 分钟产能计）
    const pId = cargoWeightedPick(cargoT1PlanetaryChoices(size).map((id) => ({ id, weight: 1 })), rng).id;
    const qty = scaledQty(CARGO_T1_PLANETARY_20MIN[pId] || [40, 60]);
    if (typeof ResourceRegistry !== "undefined") ResourceRegistry.add(state, pId, qty);
    out.push({ tier: "T1", id: pId, qty });
  } else if (pick === "tactical") {
    // 战术残液（≈20 分钟战斗 farm 量）
    const qty = scaledQty(CARGO_T1_QTY.tactical);
    if (typeof ResourceRegistry !== "undefined") ResourceRegistry.add(state, "special:战术残液", qty);
    out.push({ tier: "T1", id: "special:战术残液", qty });
  } else {
    // 星币 → 具名战利品（出售换星币；不直接入账）
    const qty = scaledQty(CARGO_T1_QTY.isk);
    const item = cargoGrantLoot(state, "isk", qty, rng);
    out.push({ tier: "T1", id: "loot:isk", qty, loot: true, name: item.name, kind: "isk" });
  }
  return out;
}

// 掉落配置（预览用，纯函数）
function getCargoDropConfigs(zone) {
  if (!zone) return null;
  const classesInZone = new Set();
  if (zone.enemyPool) {
    for (const kind of ["normal", "elite", "boss"]) {
      const arr = zone.enemyPool[kind] || [];
      for (const key of arr) classesInZone.add(getEnemyCargoClass(zone.faction, key));
    }
  }
  const sizesByClass = {};
  for (const cls of classesInZone) sizesByClass[cls] = CARGO_CLASS_SIZES[cls] ? CARGO_CLASS_SIZES[cls].sizes : ["S"];
  return {
    dropChance: CARGO_DROP_CHANCE,
    classSizes: CARGO_CLASS_SIZES,
    sizesByClass,
    t1Bundle: {
      planetaryChoices: Object.fromEntries(CARGO_SIZES.map((s) => [s, cargoT1PlanetaryChoices(s)])),
      qty: CARGO_T1_QTY,
      sizeMul: CARGO_T1_SIZE_MUL
    },
    sizePools: CARGO_SIZE_POOLS,
    pools: CARGO_POOLS,
    tierWeights: CARGO_SIZE_TIER_WEIGHTS,
    rollsBySize: CARGO_SIZE_ROLLS
  };
}

// 货柜出率详情（仓库卡片 + 战斗点击查看用）。返回一个结构化对象，供渲染层直接消费，不硬编码。
// 返回：{ size, sizeLabel, tierWeights, blueprints:[{id,name}], content:{T1:[{id,name,kind,qtyText}], T2, T3, T4} }
// 注意：T4 在 S 尺寸权重为 0（超小货柜不出脑插），渲染层据此灰显即可，不附加任何口语标注。
function getCargoDropInfo(size) {
  const sz = CARGO_SIZES.includes(size) ? size : "S";
  const sizeLabel = { S: "小型", M: "中型", L: "大型", XL: "超大型" }[sz];
  const tierWeights = CARGO_SIZE_TIER_WEIGHTS[sz];
  const bpRaw = (CARGO_BLUEPRINT_BY_SIZE[sz] || []).concat(CARGO_BOOSTER_BLUEPRINT_BY_SIZE[sz] || []);
  const blueprints = bpRaw.map(b => {
    if (b.booster) {
      const rec = (typeof getBoosterRecipe === "function") ? getBoosterRecipe(b.id) : null;
      return { id: b.id, name: (rec ? rec.name : b.id) + "蓝图" };
    }
    const eqId = b.id.slice("blueprint:".length);
    let name = eqId + "蓝图";
    if (typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB && EQUIPMENT_DB[eqId]) {
      name = (EQUIPMENT_DB[eqId].name || eqId) + "蓝图";
    }
    return { id: b.id, name };
  });

  // 条目 → 显示名（弹药/战利品/脑插/资源 分别给出可读名，不泄漏内部 id）
  function entryName(id) {
    if (id === "ammo:T1") return "普通弹药（随机武器）";
    if (id === "ammo:T2") return "T2 弹药（随机武器）";
    if (id === "loot:isk") return "星币战利品（具名）";
    if (id === "loot:lp") return "功勋战利品（具名）";
    if (id.indexOf("implant_") === 0 && typeof IMPLANT_DB !== "undefined" && IMPLANT_DB && IMPLANT_DB[id]) {
      return IMPLANT_DB[id].name || id;
    }
    if (id.indexOf("blueprint:") === 0) {
      const eqId = id.slice("blueprint:".length);
      if (typeof EQUIPMENT_DB !== "undefined" && EQUIPMENT_DB && EQUIPMENT_DB[eqId]) return (EQUIPMENT_DB[eqId].name || eqId) + "蓝图";
      return eqId + "蓝图";
    }
    if (typeof getResourceDisplayName === "function") {
      try { const n = getResourceDisplayName(id); if (n && n !== id) return n; } catch (_) {}
    }
    return id;
  }
  function entryKind(id) {
    if (id.indexOf("implant_") === 0) return "implant";
    if (id.indexOf("blueprint:") === 0) return "blueprint";
    if (id.indexOf("ammo:") === 0) return "ammo";
    if (id.indexOf("loot:") === 0) return "loot";
    return "resource";
  }
  // 数量参考文本：与真实开箱一致——矿物/行星材料/弹药随尺寸缩放（round(qty*mul)），loot/implant/blueprint 不缩放
  function qtyText(e) {
    const mul = CARGO_T1_SIZE_MUL[sz] || 1;
    const q = e.qty;
    if (e.id === "ammo:T1" || e.id === "ammo:T2") {
      const base = (typeof q === "number") ? q : (Array.isArray(q) ? q[0] : 1);
      const hi = (Array.isArray(q) ? q[1] : base);
      const lo = Math.round(base * mul);
      const hiS = Math.round(hi * mul);
      return lo === hiS ? ("×" + lo) : ("×" + lo + "~" + hiS);
    }
    // 矿物 / 行星材料：随尺寸缩放，与真实开箱 Math.max(1, Math.round(qty*mul)) 一致
    if (e.id.indexOf("mineral:") === 0 || e.id.indexOf("planetary:") === 0) {
      if (Array.isArray(q)) {
        const lo = Math.round(q[0] * mul);
        const hi = Math.round(q[1] * mul);
        return lo === hi ? ("×" + lo) : ("×" + lo + "~" + hi);
      }
      const n = Math.round(q * mul);
      return "×" + n;
    }
    // loot / implant / blueprint：不随尺寸缩放（真实开箱亦不缩放）
    if (Array.isArray(q)) return q[0].toLocaleString() + "~" + q[1].toLocaleString();
    if (typeof q === "number") return "×" + q;
    return "";
  }
  function poolItems(tier) {
    return (CARGO_POOLS[tier] || []).map(e => ({ id: e.id, name: entryName(e.id), kind: entryKind(e.id), qtyText: qtyText(e) }));
  }

  // T1：尺寸化行星材料三~六选一 + 战术残液 + 星币战利品（数额随尺寸缩放）
  const t1 = [];
  for (const pId of cargoT1PlanetaryChoices(sz)) {
    const range = CARGO_T1_PLANETARY_20MIN[pId] || [40, 60];
    const mul = CARGO_T1_SIZE_MUL[sz] || 1;
    const lo = Math.floor(range[0] * mul), hi = Math.floor(range[1] * mul);
    t1.push({ id: pId, name: entryName(pId), kind: "resource", qtyText: lo + "~" + hi });
  }
  const tm = CARGO_T1_SIZE_MUL[sz] || 1;
  t1.push({ id: "special:战术残液", name: "战术残液", kind: "resource", qtyText: Math.floor(CARGO_T1_QTY.tactical[0] * tm) + "~" + Math.floor(CARGO_T1_QTY.tactical[1] * tm) });
  t1.push({ id: "loot:isk", name: "星币战利品（具名）", kind: "loot", qtyText: Math.floor(CARGO_T1_QTY.isk[0] * tm).toLocaleString() + "~" + Math.floor(CARGO_T1_QTY.isk[1] * tm).toLocaleString() });

  return {
    size: sz,
    sizeLabel,
    tierWeights,
    blueprints,
    content: { T1: t1, T2: poolItems("T2"), T3: poolItems("T3"), T4: poolItems("T4") }
  };
}

// 掉落时调用：决定尺寸并发放货柜物品（在线 resolveCombatEnemyDefeat 用）。
// 返回 { size, itemId } 或 null（未掉落）。
function rollCargoDrop(enemy, zone, rng, state) {
  if (!enemy || !zone) return null;
  // 同位素标记打捞臂：被动提升货柜掉率（装备即生效，与开关无关）；上限 50% 防爆
  const baseChance = CARGO_DROP_CHANCE[enemy.kind] || 0;
  const salvageBonus = (typeof getSalvageEfficiency === "function") ? getSalvageEfficiency(state) : 0;
  const chance = Math.min(baseChance * (1 + salvageBonus), 0.5);
  const roll = (typeof rng === "function" ? rng() : Math.random());
  if (roll >= chance) return null;
  const cls = getEnemyCargoClass(zone.faction, enemy.type);
  const spec = CARGO_CLASS_SIZES[cls] || CARGO_CLASS_SIZES.frigate;
  const size = cargoWeightedPick(spec.sizes.map((s, i) => ({ id: s, weight: spec.weights[i] })), rng).id;
  const itemId = cargoItemId(size);
  if (typeof ResourceRegistry !== "undefined" && state) ResourceRegistry.add(state, itemId, 1);
  return { size, itemId };
}

// 开箱：消耗 1 个货柜，按 rollsBySize 次数滚动 tier→条目，发放真实奖励。
// 返回 { size, rolls:[{tier, id, qty}] } 或 null（无货柜）。
function openCargoContainer(state, size, rng) {
  if (!state || !size) return null;
  const itemId = cargoItemId(size);
  if (typeof ResourceRegistry === "undefined" || ResourceRegistry.get(state, itemId) < 1) return null;
  ResourceRegistry.spend(state, itemId, 1);
  const rolls = CARGO_SIZE_ROLLS[size] || 1;
  const tw = CARGO_SIZE_TIER_WEIGHTS[size] || CARGO_SIZE_TIER_WEIGHTS.S;
  const tierItems = Object.keys(tw).map(t => ({ id: t, weight: tw[t] }));
  const out = [];
  for (let i = 0; i < rolls; i++) {
      const tier = cargoWeightedPick(tierItems, rng).id;
      if (tier === "BP") {
        // 尺寸化蓝图奖励档：装备蓝图（D→S / C→M / B→L / A→XL）+ 增强剂蓝图（精工 M+ / 传奇 L+）；
        // 二者并列合并为同一 BP 池，每次抽取其一；发放逻辑分别走 grantEquipmentBlueprintFromCargo / grantBoosterBlueprintFromCargo。
        const bpPool = (CARGO_BLUEPRINT_BY_SIZE[size] || []).concat(CARGO_BOOSTER_BLUEPRINT_BY_SIZE[size] || []);
        if (!bpPool.length) continue;
        const bpEntry = cargoWeightedPick(bpPool, rng);
        let bpRes;
        if (bpEntry.booster) {
          bpRes = grantBoosterBlueprintFromCargo(state, bpEntry.id, size, rng);
        } else {
          const equipmentId = bpEntry.id.slice("blueprint:".length);
          bpRes = grantEquipmentBlueprintFromCargo(state, equipmentId, size, rng);
        }
        if (bpRes) { bpRes.tier = "BP"; out.push(bpRes); }
        continue;
      }
      const mul = CARGO_T1_SIZE_MUL[size] || 1;
      let grants;
    if (tier === "T1") {
      grants = rollCargoT1(state, size, rng);
    } else {
      const pool = (CARGO_SIZE_POOLS[size] && CARGO_SIZE_POOLS[size][tier]) || CARGO_POOLS[tier];
      if (!pool || !pool.length) continue;
      const entry = cargoWeightedPick(pool, rng);
      const qty = cargoRollQty(entry, rng);
      if (entry.id === "loot:isk" || entry.id === "loot:lp") {
        // 具名兑换物：铸入背包，不直接入账（出售/兑换 UI 暂缓，与考古翻新一并做）
        const kind = entry.id === "loot:isk" ? "isk" : "lp";
        const item = cargoGrantLoot(state, kind, qty, rng);
        grants = [{ tier, id: entry.id, qty, loot: true, name: item.name, kind }];
      } else if (entry.id === "ammo:T1" || entry.id === "ammo:T2") {
        // 弹药实例：随机一种武器类型；数量按尺寸缩放（普通弹 S75/M120/L195/XL315，T2 弹 S225/M360/L585/XL945，T2翻五倍）
        const aTier = entry.id === "ammo:T2" ? "T2" : "T1";
        const ammoTypes = ["laser", "missile", "cannon"];
          const atype = ammoTypes[Math.floor((typeof rng === "function" ? rng() : Math.random()) * 3)];
          const aqty = Math.max(1, Math.round(cargoRollQty(entry, rng) * mul));
        const aprops = (typeof getAmmoTierProps === "function") ? getAmmoTierProps(aTier) : (aTier === "T2" ? { dmgMult: 1.1, hitMult: 1.1 } : { dmgMult: 1, hitMult: 1 });
        const aName = (CARGO_AMMO_WEAPON_NAMES[atype] && CARGO_AMMO_WEAPON_NAMES[atype][aTier]) || (atype + "弹药");
        if (typeof addAmmo === "function") addAmmo(state, { type: atype, tier: aTier, props: aprops, qty: aqty, name: aName });
        grants = [{ tier, id: entry.id, qty: aqty, ammo: true, weaponType: atype, name: aName }];
      } else {
        if (entry.id.startsWith("implant_")) {
          // 脑插：授予 state.implants（账号全局被动，拥有即永久生效）；不入库存、不随尺寸缩放。
          // 重复脑插：grantImplant 内部已转化为 1 个小型脑突触加速提取剂（5 分钟），不再折算功勋。
          const iname = (typeof IMPLANT_DB !== "undefined" && IMPLANT_DB && IMPLANT_DB[entry.id]) ? IMPLANT_DB[entry.id].name : entry.id;
          const newlyGranted = (typeof grantImplant === "function") ? grantImplant(state, entry.id) : entry.id;
          if (newlyGranted === null) {
            grants = [{ tier, id: "implantdup:" + entry.id, qty: 1, extractor: "small", name: iname + "（重复·脑突触加速提取剂）", icon: "💉", categoryLabel: "重复转化" }];
          } else {
            grants = [{ tier, id: entry.id, qty: 1, implant: true, implantId: entry.id }];
          }
        } else if (entry.id.startsWith("blueprint:")) {
          // 货柜装备蓝图：复用 buyLPItem 的 ownedBlueprints 写入 + blueprint:acquired 事件；已拥有折算 loot:lp
          const equipmentId = entry.id.slice("blueprint:".length);
          const res = grantEquipmentBlueprintFromCargo(state, equipmentId, size, rng);
          if (res) res.tier = tier;
          grants = res ? [res] : [];
        } else {
          // 矿物 / 行星材料：数量随尺寸缩放（与 T1 保底包、弹药一致）
          const sqty = Math.max(1, Math.round(qty * mul));
          if (typeof ResourceRegistry !== "undefined") ResourceRegistry.add(state, entry.id, sqty);
          grants = [{ tier, id: entry.id, qty: sqty }];
        }
      }
    }
    for (const g of grants) out.push(g);
  }
  return { size, rolls: out };
}

// 批量开箱：消耗至多 count 个货柜（不足则按实际持有量），聚合所有奖励返回。
// 返回 { size, opened, rolls:[...] } 或 null（无货柜）。
function openCargoContainers(state, size, count, rng) {
  if (!state || !size) return null;
  const itemId = cargoItemId(size);
  if (typeof ResourceRegistry === "undefined") return null;
  const have = ResourceRegistry.get(state, itemId);
  if (have < 1) return null;
  const n = Math.max(1, Math.min(Math.floor(Number(count)) || 1, have));
  const allRolls = [];
  let opened = 0;
  for (let k = 0; k < n; k++) {
    const one = openCargoContainer(state, size, rng);
    if (!one) break;
    opened++;
    if (Array.isArray(one.rolls)) for (const r of one.rolls) allRolls.push(r);
  }
  return { size, opened, rolls: allRolls };
}

// 暴露给浏览器控制台测试：window.openCargo(size) 开单箱；window.openCargoBoxes(size, count) 批量开箱。
// 注意：调试别名绝不能覆盖全局 openCargoContainers（否则 doOpen 调用会被 2 参包装器递归吃掉 → 栈溢出）。
if (typeof window !== "undefined") {
  window.openCargo = function (size) { return openCargoContainer(gameState, size, Math.random); };
  window.openCargoBoxes = function (size, count) { return openCargoContainers(gameState, size, count, Math.random); };
}
