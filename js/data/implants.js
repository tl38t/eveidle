/* ================================================================
   脑插系统（账号全局被动，梅尔沃宠物式）
   ----------------------------------------------------------------
   - 获得即永久生效、不占装备槽、可叠加（每个独立乘区）。
   - 批次一：6 枚「99 级生产技能成就」脑插，战斗轴加成。
   - 批次二：5 枚「采集/制造过程随机掉落」脑插。
       采矿        → 维修增强·阿尔法（主动维修量 +10%，护盾/装甲/结构）
       采气        → 维修增强·贝塔（同上）
       装备制造    → 工造·扫描植入体（考古扫描强度 +10%）
       舰船制造    → 舰构·解析植入体（考古解析速度 +10%）
       增强剂制造  → 萃炼·独特植入体（考古独特文物掉率 +10%）
   - 批次三：11 枚「考古/货柜/死亡空间掉落」跨领域增益脑插。
       考古成功    → 采矿增效 +3% / 采气增效 +3% / 采矿双生(4%×2) / 采气双生(4%×2)
       货柜 T3     → 行星加速 +5% / 行星槽位 +1
       货柜 T4     → 冶炼增效 +6% / 冶炼双生(3%×2) / 增强剂增效 +6% / 增强剂双生(3%×2)
       死亡空间(6/10 三处) → 舰船制造增效 +6%
   - state.implants 为 { [implantId]: true }，拥有即视为已激活。
   ================================================================ */

const IMPLANT_DB = {
  // —— 批次一：99 级生产技能成就（战斗轴）——
  implant_laser: {
    id: "implant_laser",
    name: "破岩·激光植入体",
    icon: "🔫",
    desc: "激光武器伤害 +5%",
    type: "weaponDamage",
    weapon: "laser",
    mult: 1.05,
    sourceSkill: "mining",
    sourceSkillName: "采矿"
  },
  implant_cannon: {
    id: "implant_cannon",
    name: "熔铸·炮弹植入体",
    icon: "💥",
    desc: "炮弹武器伤害 +5%",
    type: "weaponDamage",
    weapon: "cannon",
    mult: 1.05,
    sourceSkill: "refining",
    sourceSkillName: "冶炼"
  },
  implant_missile: {
    id: "implant_missile",
    name: "舰构·导弹植入体",
    icon: "🚀",
    desc: "导弹武器伤害 +5%",
    type: "weaponDamage",
    weapon: "missile",
    mult: 1.05,
    sourceSkill: "shipEngineering",
    sourceSkillName: "舰船工程"
  },
  implant_shield: {
    id: "implant_shield",
    name: "精密·护盾植入体",
    icon: "🛡️",
    desc: "护盾容量上限 +10%",
    type: "hpCap",
    layer: "shield",
    mult: 1.10,
    sourceSkill: "equipmentEngineering",
    sourceSkillName: "装备工程"
  },
  implant_armor: {
    id: "implant_armor",
    name: "催化·装甲植入体",
    icon: "🔩",
    desc: "装甲容量上限 +10%",
    type: "hpCap",
    layer: "armor",
    mult: 1.10,
    sourceSkill: "boosterEngineering",
    sourceSkillName: "增强剂制造"
  },
  implant_structure: {
    id: "implant_structure",
    name: "气云·结构植入体",
    icon: "🏗️",
    desc: "结构容量上限 +10%",
    type: "hpCap",
    layer: "structure",
    mult: 1.10,
    sourceSkill: "gasHarvesting",
    sourceSkillName: "气体采集"
  },

  // —— 批次二：采集/制造过程随机掉落 ——
  implant_repair_alpha: {
    id: "implant_repair_alpha",
    name: "维修增强植入体·阿尔法",
    icon: "🛠️",
    desc: "主动维修量 +10%（护盾/装甲/结构）",
    type: "repair",
    mult: 1.10,
    source: "mining",
    sourceName: "采矿"
  },
  implant_repair_beta: {
    id: "implant_repair_beta",
    name: "维修增强植入体·贝塔",
    icon: "🔧",
    desc: "主动维修量 +10%（护盾/装甲/结构）",
    type: "repair",
    mult: 1.10,
    source: "gas",
    sourceName: "采气"
  },
  implant_arch_scan: {
    id: "implant_arch_scan",
    name: "工造·扫描植入体",
    icon: "📡",
    desc: "考古扫描强度 +10%",
    type: "archaeologyScan",
    mult: 1.10,
    source: "equipment",
    sourceName: "装备制造"
  },
  implant_arch_speed: {
    id: "implant_arch_speed",
    name: "舰构·解析植入体",
    icon: "⚙️",
    desc: "考古解析速度 +10%",
    type: "archaeologySpeed",
    mult: 1.10,
    source: "ship",
    sourceName: "舰船制造"
  },
  implant_arch_unique: {
    id: "implant_arch_unique",
    name: "萃炼·独特植入体",
    icon: "💎",
    desc: "考古独特文物掉率 +10%",
    type: "archaeologyUnique",
    mult: 1.10,
    source: "booster",
    sourceName: "增强剂制造"
  },

  // —— 批次三：考古/货柜/死亡空间掉落（跨领域增益）——
  // 考古 → 采集轴（4 枚）
  implant_collect_mining: {
    id: "implant_collect_mining",
    name: "采集·采矿增效植入体",
    icon: "⛏️",
    desc: "采矿效率 +3%",
    type: "collect",
    activity: "mining",
    mult: 1.03,
    source: "archaeology",
    sourceName: "考古成功"
  },
  implant_collect_gas: {
    id: "implant_collect_gas",
    name: "采集·采气增效植入体",
    icon: "☁️",
    desc: "采气效率 +3%",
    type: "collect",
    activity: "gas",
    mult: 1.03,
    source: "archaeology",
    sourceName: "考古成功"
  },
  implant_double_mining: {
    id: "implant_double_mining",
    name: "采集·采矿双生植入体",
    icon: "✨",
    desc: "采矿 4% 概率产出×2",
    type: "doubleOutput",
    activity: "mining",
    doubleChance: 0.04,
    source: "archaeology",
    sourceName: "考古成功"
  },
  implant_double_gas: {
    id: "implant_double_gas",
    name: "采集·采气双生植入体",
    icon: "🌟",
    desc: "采气 4% 概率产出×2",
    type: "doubleOutput",
    activity: "gas",
    doubleChance: 0.04,
    source: "archaeology",
    sourceName: "考古成功"
  },
  // 货柜 T3 → 行星轴（2 枚）
  implant_planet_speed: {
    id: "implant_planet_speed",
    name: "行星·加速植入体",
    icon: "🪐",
    desc: "行星开发加速 +5%",
    type: "planetSpeed",
    mult: 1.05,
    source: "cargo",
    sourceName: "货柜 T3"
  },
  implant_planet_slot: {
    id: "implant_planet_slot",
    name: "行星·扩展植入体",
    icon: "🛰️",
    desc: "行星槽位 +1",
    type: "planetSlot",
    mult: 1,
    source: "cargo",
    sourceName: "货柜 T3"
  },
  // 货柜 T4 → 冶炼/增强剂轴（4 枚）
  implant_refine_eff: {
    id: "implant_refine_eff",
    name: "冶炼·增效植入体",
    icon: "🔥",
    desc: "冶炼效率 +6%",
    type: "refiningEff",
    mult: 1.06,
    source: "cargo",
    sourceName: "货柜 T4"
  },
  implant_double_refine: {
    id: "implant_double_refine",
    name: "冶炼·双生植入体",
    icon: "🌋",
    desc: "冶炼 3% 概率产出×2",
    type: "doubleOutput",
    activity: "refining",
    doubleChance: 0.03,
    source: "cargo",
    sourceName: "货柜 T4"
  },
  implant_booster_eff: {
    id: "implant_booster_eff",
    name: "增强剂·增效植入体",
    icon: "💉",
    desc: "增强剂制造效率 +6%",
    type: "boosterEff",
    mult: 1.06,
    source: "cargo",
    sourceName: "货柜 T4"
  },
  implant_double_booster: {
    id: "implant_double_booster",
    name: "增强剂·双生植入体",
    icon: "⚗️",
    desc: "增强剂 3% 概率产出×2",
    type: "doubleOutput",
    activity: "booster",
    doubleChance: 0.03,
    source: "cargo",
    sourceName: "货柜 T4"
  },
  // 死亡空间（仅 6/10 三处清场）→ 舰船制造轴（1 枚）
  implant_ship_mfg: {
    id: "implant_ship_mfg",
    name: "舰构·精通植入体",
    icon: "🚢",
    desc: "舰船制造效率 +6%",
    type: "shipMfgEff",
    mult: 1.06,
    source: "deathspace",
    sourceName: "死亡空间 6/10"
  }
};

// 生产技能 → 对应成就脑插（技能满 99 级时发放）
const IMPLANT_BY_SKILL = {
  mining: "implant_laser",
  refining: "implant_cannon",
  shipEngineering: "implant_missile",
  equipmentEngineering: "implant_shield",
  boosterEngineering: "implant_armor",
  gasHarvesting: "implant_structure"
};

// 掉落概率常量（详见设计记忆）
// 采矿/采气：p = (area.baseTime / REF_MINING) / DROP_INV_MINING，满装战列单枚 ~24~31h
const IMPLANT_DROP_INV_MINING = 691200;
const IMPLANT_DROP_REF_MINING = 20;   // 最低级采矿区 凡晶石带 baseTime
// 制造/增强剂：p = (recipe.time / REF_MFG) / DROP_INV_MFG，满级单枚 ~28h（每小时期望 ∝ eff 恒定）
const IMPLANT_DROP_INV_MFG = 10000;
const IMPLANT_DROP_REF_MFG = 30;      // 装备制造 T1 基准时长

// 考古：每次成功周期（archaeology:success 由 resolveArchaeologyCycle 逐周期发射，离线亦逐周期，故每周期掷一次、cycles 恒为 1）按该次实际解析周期掷骰 p = (cycleSeconds / REF_ARCH) / INV_ARCH。
// 每小时期望命中 = 3600 / (REF_ARCH × INV_ARCH)，与遗址档位/玩家效率无关；p 随 cycle 线性增长 → 五档遗址（30/60/120/180/300s）单跑概率随周期放大、每小时期望恒定（时间公平，无高阶双奖励）。
// 2026-08-28 重构：旧 INV_ARCH=810000 使每小时期望≈9.3e-6（≈10⁵h/枚，实际近乎不掉）。
//   定标：制造 REF×INV = 30×10000 = 300000 ≈ 83h/枚，但制造流程无痛，考古单次周期远长且几乎无周期减免装备，
//   故考古按 40h/枚定标 → REF×INV = 3600×40 = 144000 → INV_ARCH = 144000/480 = 300。
//   结果：每枚每小时期望 0.025（≈40h/枚），4 枚合计≈10h 出任意一枚；各档位每小时期望一致。
const IMPLANT_DROP_INV_ARCH = 300;
const IMPLANT_DROP_REF_ARCH = 480;    // 解析周期归一化基准（常量，仅为 REF×INV=144000 服务；真实 site.time 为 30–300s）
// 死亡空间：仅 6/10 三处清场按固定概率掉落舰船制造脑插（离线不重发该事件，故仅在线清场掉落）。
const IMPLANT_SHIP_MFG_DEATHSPACES = ["angel_ded_6_10", "blood_ded_6_10", "sansha_ded_6_10"];
const IMPLANT_SHIP_MFG_DROP_CHANCE = 0.05;

// 聚合脑插加成：每个类型内多个脑插相乘（独立乘区）。
// 返回 { weaponDamage, hpCap, archaeology:{scan,speed,unique}, repair }，缺省均为 1。
function getImplantBonuses(state) {
  const owned = (state && state.implants) || {};
  const weaponDamage = { laser: 1, cannon: 1, missile: 1 };
  const hpCap = { shield: 1, armor: 1, structure: 1 };
  const archaeology = { scan: 1, speed: 1, unique: 1 };
  let repair = 1;
  const collect = { mining: 1, gas: 1 };
  let refiningEff = 1;
  let planetSpeed = 1;
  let planetSlot = 0;
  let shipMfgEff = 1;
  let boosterEff = 1;
  for (const id of Object.keys(IMPLANT_DB)) {
    if (!owned[id]) continue;
    const imp = IMPLANT_DB[id];
    if (!imp) continue;
    if (imp.type === "weaponDamage") weaponDamage[imp.weapon] *= imp.mult;
    else if (imp.type === "hpCap") hpCap[imp.layer] *= imp.mult;
    else if (imp.type === "repair") repair *= imp.mult;
    else if (imp.type === "archaeologyScan") archaeology.scan *= imp.mult;
    else if (imp.type === "archaeologySpeed") archaeology.speed *= imp.mult;
    else if (imp.type === "archaeologyUnique") archaeology.unique *= imp.mult;
    else if (imp.type === "collect") collect[imp.activity] *= imp.mult;
    else if (imp.type === "refiningEff") refiningEff *= imp.mult;
    else if (imp.type === "planetSpeed") planetSpeed *= imp.mult;
    else if (imp.type === "planetSlot") planetSlot += 1;
    else if (imp.type === "shipMfgEff") shipMfgEff *= imp.mult;
    else if (imp.type === "boosterEff") boosterEff *= imp.mult;
  }
  return { weaponDamage, hpCap, archaeology, repair, collect, refiningEff, planetSpeed, planetSlot, shipMfgEff, boosterEff };
}

// 通用授予：已拥有返回 null，否则写入并返回 id。
function grantImplant(state, id) {
  if (!id || !IMPLANT_DB[id]) return null;
  if (!state.implants || typeof state.implants !== "object") state.implants = {};
  if (state.implants[id]) {
    // 重复脑插：转化为 1 个小型脑突触加速提取剂（5 分钟），不再折算功勋。
    if (typeof addExtractor === "function") addExtractor(state, "small", 1);
    return null;
  }
  state.implants[id] = true;
  return id;
}

// 授予某技能对应的成就脑插（技能满 99 级时调用）。返回新授予的脑插 id，已拥有则返回 null。
function grantImplantForSkill(state, skillKey) {
  const id = IMPLANT_BY_SKILL[skillKey];
  if (!id) return null;
  return grantImplant(state, id);
}

// 兼容旧档：技能早已满 99 级但当时没有脑插系统，加载时补发。幂等。返回本次新授予的 id 列表。
function reconcileImplantsFromSkills(state) {
  if (!state || !state.skills) return [];
  const granted = [];
  for (const skillKey of Object.keys(IMPLANT_BY_SKILL)) {
    const s = state.skills[skillKey];
    if (s && s.lvl >= 99) {
      const id = grantImplantForSkill(state, skillKey);
      if (id) granted.push(id);
    }
  }
  return granted;
}

// 按名称在采集区表查 baseTime（采矿/采气掉落用）。
function getAreaBaseTime(areaName, table) {
  if (!areaName || typeof table === "undefined") return null;
  const area = table.find(a => a.name === areaName);
  return area ? Number(area.baseTime) : null;
}

// 掉落掷骰：已拥有则直接跳过（拥有后不再掉落）；否则按 cycles 次独立掷骰，命中且未拥有即发放并停止。
function tryDropFromAction(state, targetId, p, cycles) {
  if (!state.implants) state.implants = {};
  if (state.implants[targetId]) return null;
  if (!(p > 0)) return null;
  const n = Number(cycles) > 0 ? Math.floor(cycles) : 1;
  for (let i = 0; i < n; i++) {
    if (Math.random() < p) {
      const id = grantImplant(state, targetId);
      if (id) return id;
    }
  }
  return null;
}

// 概率产出×2（双生脑插）：拥有对应双生脑插时返回该活动的独立掷骰命中概率；否则 0。
function getImplantDoubleOutputChance(state, activity) {
  if (!state || !state.implants) return 0;
  const id = { mining: "implant_double_mining", gas: "implant_double_gas", refining: "implant_double_refine", booster: "implant_double_booster" }[activity];
  if (!id || !state.implants[id]) return 0;
  const imp = IMPLANT_DB[id];
  return (imp && imp.doubleChance) ? imp.doubleChance : 0;
}

function announceImplant(id) {
  const name = (IMPLANT_DB[id] && IMPLANT_DB[id].name) || id;
  if (typeof showToast === "function") showToast("🧠 获得脑插：" + name);
  const GE = (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
    (typeof window !== "undefined" && window.GameEvents) || null;
  if (GE && typeof GE.emit === "function") GE.emit("implant:granted", { id });
}

// 模块顶层注册：任意生产技能升到 99 级即激活对应成就脑插（梅尔沃宠物式）。
(function installImplantGrantListener() {
  const GE = (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
    (typeof window !== "undefined" && window.GameEvents) || null;
  if (!GE || typeof GE.on !== "function") return;
  GE.on("skill:levelUp", function (event) {
    if (!event || (event.level || 0) < 99) return;
    const st = (typeof gameState !== "undefined") ? gameState : null;
    if (!st) return;
    const id = grantImplantForSkill(st, event.skill);
    if (id) announceImplant(id);
  });
})();

// 模块顶层注册：采集/制造过程随机掉落（在线 + 离线共用同一事件链）。
(function installImplantDropListener() {
  const GE = (typeof globalThis !== "undefined" && globalThis.GameEvents) ||
    (typeof window !== "undefined" && window.GameEvents) || null;
  if (!GE || typeof GE.on !== "function") return;

  // 采矿 → 阿尔法（维修增强）
  GE.on("mining:completed", function (event) {
    const st = (typeof gameState !== "undefined") ? gameState : null;
    if (!st) return;
    const bt = getAreaBaseTime(event && event.area, (typeof ALL_MINING_AREAS !== "undefined") ? ALL_MINING_AREAS : undefined);
    if (!bt) return;
    const p = (bt / IMPLANT_DROP_REF_MINING) / IMPLANT_DROP_INV_MINING;
    const id = tryDropFromAction(st, "implant_repair_alpha", p, event && event.cycles);
    if (id) announceImplant(id);
  });

  // 采气 → 贝塔（维修增强）
  GE.on("gas:completed", function (event) {
    const st = (typeof gameState !== "undefined") ? gameState : null;
    if (!st) return;
    const bt = getAreaBaseTime(event && event.area, (typeof GAS_AREAS !== "undefined") ? GAS_AREAS : undefined);
    if (!bt) return;
    const p = (bt / IMPLANT_DROP_REF_MINING) / IMPLANT_DROP_INV_MINING;
    const id = tryDropFromAction(st, "implant_repair_beta", p, event && event.cycles);
    if (id) announceImplant(id);
  });

  // 装备制造 → 扫描植入体；舰船制造（总装+组件）→ 解析植入体
  GE.on("manufacturing:completed", function (event) {
    const st = (typeof gameState !== "undefined") ? gameState : null;
    if (!st || !event) return;
    let targetId = null;
    if (event.branch === "equipment") targetId = "implant_arch_scan";
    else if (event.branch === "ship" || event.branch === "component") targetId = "implant_arch_speed";
    else return;
    const t = Number(event.time) > 0 ? Number(event.time) : IMPLANT_DROP_REF_MFG;
    const p = (t / IMPLANT_DROP_REF_MFG) / IMPLANT_DROP_INV_MFG;
    const id = tryDropFromAction(st, targetId, p, event.cycles);
    if (id) announceImplant(id);
  });

  // 增强剂制造 → 独特植入体（在线单数 + 离线/聚合复数，均按 cycles 掷骰）
  function onBoosterManufactured(event) {
    const st = (typeof gameState !== "undefined") ? gameState : null;
    if (!st || !event) return;
    const t = Number(event.time) > 0 ? Number(event.time) : IMPLANT_DROP_REF_MFG;
    const p = (t / IMPLANT_DROP_REF_MFG) / IMPLANT_DROP_INV_MFG;
    const id = tryDropFromAction(st, "implant_arch_unique", p, event.cycles);
    if (id) announceImplant(id);
  }
  GE.on("booster:manufactured", onBoosterManufactured);
  GE.on("boosters:manufactured", onBoosterManufactured);

  // 考古成功 → 采集四枚（每成功周期独立掷骰一次；archaeology:success 由 resolveArchaeologyCycle 逐周期发射，离线亦逐周期，故 cycles 恒为 1，无需按批量缩放）。
  // p 用该次实际解析周期（含效率/科研/增强剂提速），使每小时期望命中与玩家效率无关。
  // 已拥有不再跳过：命中时经 grantImplant 重复分支转换为 1 个小型脑突触加速提取剂（与货柜重复脑插同款转化）。
  GE.on("archaeology:success", function (event) {
    const st = (typeof gameState !== "undefined") ? gameState : null;
    if (!st || !event) return;
    const siteId = event.siteId;
    const site = (typeof getArchaeologySiteById === "function") ? getArchaeologySiteById(siteId)
      : (typeof ARCHAEOLOGY_SITES !== "undefined" ? ARCHAEOLOGY_SITES.find(s => s.id === siteId) : null);
    const cyc = (typeof getArchaeologyCycleSeconds === "function" && site)
      ? getArchaeologyCycleSeconds(st, site)
      : (site && Number(site.time) > 0 ? Number(site.time) : IMPLANT_DROP_REF_ARCH);
    const p = (cyc / IMPLANT_DROP_REF_ARCH) / IMPLANT_DROP_INV_ARCH;
    const targets = ["implant_collect_mining", "implant_collect_gas", "implant_double_mining", "implant_double_gas"];
    if (!st.implants || typeof st.implants !== "object") st.implants = {};
    for (const tid of targets) {
      if (st.implants[tid]) {
        // 已拥有：仍按同概率掷骰，命中即转换（grantImplant 对已拥有 id 内部加 1 个小型提取剂）。
        if (p > 0 && Math.random() < p) {
          grantImplant(st, tid);
          if (typeof showToast === "function") showToast("🧠 重复脑插已转换为小型脑突触加速提取剂");
        }
        continue;
      }
      const id = tryDropFromAction(st, tid, p, 1);
      if (id) announceImplant(id);
    }
  });

  // 死亡空间（仅 6/10 三处清场）→ 舰船制造脑插，固定 5%。
  // 离线不重发 combat:deathspaceCleared，故仅在线清场掉落。
  GE.on("combat:deathspaceCleared", function (event) {
    const st = (typeof gameState !== "undefined") ? gameState : null;
    if (!st || !event) return;
    if (IMPLANT_SHIP_MFG_DEATHSPACES.indexOf(event.deathspaceId) === -1) return;
    const id = tryDropFromAction(st, "implant_ship_mfg", IMPLANT_SHIP_MFG_DROP_CHANCE, 1);
    if (id) announceImplant(id);
  });
})();
