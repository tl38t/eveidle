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
  const map = ENEMY_CARGO_CLASS[faction];
  return (map && map[enemyKey]) || "frigate";
}

// T1 保底三件套（全尺寸统一内容，数额随尺寸缩放）。
// 行星材料按尺寸递增解锁：S=三选一（重金属/稀有气体/同位素）；M 加等离子体；L 加生物质；XL 加磁场聚合体。
// 基础矿物已挪至 T2 池；T1 三件套在开箱选中 T1 时一次性发放（见 rollCargoT1）。
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
    // T3 现仅含 T2 弹药；装备蓝图已按档位(D/C/B/A)移至 CARGO_BLUEPRINT_BY_SIZE（S/M/L/XL），作为独立 BP 奖励档。
    { id: "ammo:T2",             qty: 225,              weight: 12 }  // T2 弹×1.10独立乘区：随机一种武器类型；数量按尺寸缩放（S225/M360/L585/XL945，翻五倍）
  ],
  T4: [
    // T4 仅保留脑插；装备蓝图已移至 CARGO_BLUEPRINT_BY_SIZE（按档位分到 S/M/L/XL 的 BP 奖励档）。
    { id: "special:神经植入体·攻击", qty: 1, weight: 4 },
    { id: "special:神经植入体·防御", qty: 1, weight: 4 },
    { id: "special:神经植入体·工程", qty: 1, weight: 4 },
    { id: "special:神经植入体·指挥", qty: 1, weight: 4 }
  ]
};

// 货柜装备蓝图：按「装备生产许可」档位(D/C/B/A) 分配到对应尺寸货柜，作为独立 BP 奖励档（与 T1–T4 并列）。
// D(lv10 前哨型)→S · C(lv25)→M · B(lv45)→L · A(lv65 破阵/铁血/枢纽型)→XL。各蓝图沿用 1.5 权重。
// 发放逻辑复用 grantEquipmentBlueprintFromCargo：未拥有写入 ownedBlueprints；已拥有折算 loot:lp（按尺寸缩放）。
const CARGO_BLUEPRINT_BY_SIZE = {
  S:  [
    { id: "blueprint:angel_mining_laser_outpost",          weight: 1.5 },
    { id: "blueprint:angel_mineral_assimilation_outpost",  weight: 1.5 },
    { id: "blueprint:sansha_drone_link_outpost",           weight: 1.5 }
  ],
  M:  [
    { id: "blueprint:blood_servant_drone_link_sacrifice",  weight: 1.5 },
    { id: "blueprint:sansha_mineral_assimilation_node",    weight: 1.5 }
  ],
  L:  [
    { id: "blueprint:blood_mining_laser_hunt",             weight: 1.5 },
    { id: "blueprint:blood_mineral_assimilation_nexus",    weight: 1.5 },
    { id: "blueprint:sansha_gas_harvester_nexus",          weight: 1.5 }
  ],
  XL: [
    { id: "blueprint:angel_drone_link_war",                weight: 1.5 },
    { id: "blueprint:blood_gas_harvester_iron",            weight: 1.5 },
    { id: "blueprint:sansha_mining_laser_war",             weight: 1.5 }
  ]
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

// T1 保底三件套：行星按尺寸三~六选一（按各自 20 分钟产能计） + 战术残液 + 星币，数额按尺寸缩放。
// 基础矿物已挪至 T2 池；功勋已移出 T1。返回发放明细数组（每项 { tier:"T1", id, qty }），供 openCargoContainer 汇总与 UI 展示。
function rollCargoT1(state, size, rng) {
  const mul = CARGO_T1_SIZE_MUL[size] || 1;
  const scaledQty = (base) => {
    const q = cargoRollQty({ qty: base }, rng) * mul;
    return Math.max(1, Math.floor(q));
  };
  const out = [];
  const grant = (id, base) => {
    const qty = scaledQty(base);
    if (typeof ResourceRegistry !== "undefined") ResourceRegistry.add(state, id, qty);
    out.push({ tier: "T1", id, qty });
  };
  // 1) 行星材料（按尺寸三~六选一，等权；按各自真实 20 分钟产能计）
  const pId = cargoWeightedPick(cargoT1PlanetaryChoices(size).map((id) => ({ id, weight: 1 })), rng).id;
  grant(pId, CARGO_T1_PLANETARY_20MIN[pId] || [40, 60]);
  // 2) 战术残液（≈20 分钟战斗 farm 量）
  grant("special:战术残液", CARGO_T1_QTY.tactical);
  // 3) 星币 → 具名战利品（出售换星币；不直接入账）
  {
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

// 掉落时调用：决定尺寸并发放货柜物品（在线 resolveCombatEnemyDefeat 用）。
// 返回 { size, itemId } 或 null（未掉落）。
function rollCargoDrop(enemy, zone, rng, state) {
  if (!enemy || !zone) return null;
  const chance = CARGO_DROP_CHANCE[enemy.kind] || 0;
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
        // 尺寸化装备蓝图奖励档：D→S / C→M / B→L / A→XL（按装备生产许可档位）；复用既有蓝图发放逻辑。
        const bpPool = CARGO_BLUEPRINT_BY_SIZE[size] || [];
        if (!bpPool.length) continue;
        const bpEntry = cargoWeightedPick(bpPool, rng);
        const equipmentId = bpEntry.id.slice("blueprint:".length);
        const bpRes = grantEquipmentBlueprintFromCargo(state, equipmentId, size, rng);
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
        if (entry.id.startsWith("blueprint:")) {
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

// 暴露给浏览器控制台测试：window.openCargo(size)
if (typeof window !== "undefined") {
  window.openCargo = function (size) { return openCargoContainer(gameState, size, Math.random); };
}
