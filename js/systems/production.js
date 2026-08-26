const MINING_AREAS = [
  { name: "凡晶石带",   ore: "凡晶石", mode:"normal", level: 1,  baseTime: 15,   baseXP: 10,  color:"#b5a37d" },
  { name: "灼烧岩带",   ore: "灼烧岩", mode:"normal", level: 10, baseTime: 30,   baseXP: 30,  color:"#b66b47" },
  { name: "水硼砂带",   ore: "水硼砂", mode:"normal", level: 20, baseTime: 52.5, baseXP: 70,  color:"#79b4ca" },
  { name: "斜长岩带",   ore: "斜长岩", mode:"normal", level: 40, baseTime: 90,   baseXP: 140, color:"#8f95ad" },
  { name: "干焦岩带",   ore: "干焦岩", mode:"normal", level: 55, baseTime: 135,  baseXP: 230, color:"#b56b3f" },
  { name: "灰岩带",     ore: "灰岩",   mode:"normal", level: 70, baseTime: 195,  baseXP: 370, color:"#8d9aa2" },
  { name: "艾克诺岩带", ore: "艾克诺岩", mode:"normal", level: 85, baseTime: 285,  baseXP: 580, color:"#56bba8" }
];

const MOON_MINING_AREAS = [
  { name:"镓月岩带", ore:"镓", mode:"moon", level:20, baseTime:90,  baseXP:100, color:"#67c9dc" },
  { name:"铂月岩带", ore:"铂", mode:"moon", level:20, baseTime:90,  baseXP:100, color:"#d8e1e8" },
  { name:"铪月岩带", ore:"铪", mode:"moon", level:40, baseTime:180, baseXP:240, color:"#72a7ee" },
  { name:"锇月岩带", ore:"锇", mode:"moon", level:40, baseTime:180, baseXP:240, color:"#ad8ade" },
  { name:"钷月岩带", ore:"钷", mode:"moon", level:55, baseTime:315, baseXP:450, color:"#ef777c" },
  { name:"铷月岩带", ore:"铷", mode:"moon", level:70, baseTime:540, baseXP:870, color:"#dfad58" }
];
const ALL_MINING_AREAS = [...MINING_AREAS, ...MOON_MINING_AREAS];

const ITEM_CATEGORIES = {
  ore:       ["凡晶石","灼烧岩","水硼砂","斜长岩","干焦岩","灰岩","艾克诺岩"],
  mineral:   ["三钛合金","类银超金属","类晶体胶矿","同位聚合体","超新星诺克石","基腹断岩","超噬矿","莫尔石"],
  planetary: ["重金属","稀有气体","同位素","行星内核产物","等离子体","生物质","磁场聚合物"],
  gases:      ["粗制富勒烯","氦同位素","稳定富勒烯","氢同位素","高纯富勒烯","聚合气体","超纯聚合气体"],
  moon:       ["镓","铂","铪","锇","钷","铷"],
  consumable: ["燃料单元","激光晶体弹药","导弹","炮台弹药","纳米维修膏"],
  special: COMBAT_SPECIAL_MATERIALS.slice(),
  equipment: SHIP_COMPONENT_RECIPES.map(recipe => recipe.name)
};
ITEM_CATEGORIES.equipment.push(...Object.values(EQUIPMENT_DB).map(equipment => equipment.name));
const ITEM_ICONS = {
  "凡晶石":"🪨","灼烧岩":"🪨","水硼砂":"🪨","斜长岩":"🪨","干焦岩":"🪨","灰岩":"🪨","艾克诺岩":"💎","莫尔石":"💠",
  "三钛合金":"🧱","类银超金属":"🧱","类晶体胶矿":"🧱","同位聚合体":"🧱","超新星诺克石":"🧱","基腹断岩":"🧱","超噬矿":"🧱",
  "重金属":"🪨","稀有气体":"💨","同位素":"❄️","行星内核产物":"🌋","等离子体":"🌌","生物质":"🌿","磁场聚合物":"🧲",
  "粗制富勒烯":"☁️","氦同位素":"☁️","稳定富勒烯":"☁️","氢同位素":"☁️","高纯富勒烯":"☁️","聚合气体":"☁️","超纯聚合气体":"☁️",
  "镓":"🌙","铂":"🌙","铪":"🌙","锇":"🌙","钷":"🌙","铷":"🌙",
   "晶体弹药":"💥","纳米维修膏":"🧴","跃迁燃料":"⛽",
   "燃料单元":"⛽","激光晶体弹药":"🔫","聚焦相位激光弹":"🔫","导弹":"🚀","高爆制导导弹":"🚀","炮台弹药":"💣","重型轨道弹药":"💣",
  "船体骨架":"🏗️","推进系统":"⚙️","核心系统":"🔮","护盾发生器":"🛡️","装甲镀层":"🔩","武器挂架":"🔧","外置货舱":"📦","工业挂架":"🏗️","T1采矿激光器":"🔴","T1气云采集器":"🟢","T1无人机控制单元":"🤖","小型护盾扩展":"🛡️","T1采矿提升器":"⬆️","T1采气提升器":"⬆️",
  "小型激光炮 I":"⚡","轻型导弹发射器 I":"🚀","小型射弹炮 I":"💥","小型护盾回充器 I":"🛡️","小型装甲维修器 I":"🔧","小型结构修理器 I":"⚒️"
};
for (const material of STAR_BELT_DATA_MATERIALS) {
  ITEM_ICONS[material] = material.startsWith("天使") ? "🟠" : material.startsWith("血袭者") ? "🔴" : "🟢";
}
for (const material of DEATHSPACE_TICKET_MATERIALS) ITEM_ICONS[material] = "🎫";
for (const material of DEATHSPACE_LOOT_MATERIALS) ITEM_ICONS[material] = material.includes("协议") ? "📜" : "💠";
for (const material of SUPERCAPITAL_DATA_MATERIALS) ITEM_ICONS[material] = "🧬";
// 校准基体（考古产出的 calibration: 命名空间资源）给统一图标，避免仓库卡退化为 📦
for (const calibName of ["校准基体 I 型","校准基体 II 型","校准基体 III 型","校准基体 IV 型","校准基体 V 型"]) ITEM_ICONS[calibName] = "⚗️";
SHIP_COMPONENT_RECIPES.forEach(recipe => {
  if (recipe.id.includes("integrated_hull")) ITEM_ICONS[recipe.name] = "🏗️";
  else if (recipe.id.includes("power_core")) ITEM_ICONS[recipe.name] = "⚙️";
  else ITEM_ICONS[recipe.name] = "🔧";
});

function xpForLevel(lv) { return Math.floor(100 * Math.pow(1.1, lv - 1)); }

function checkLevelUpFromState(state, skillKey, eventMeta) {
  const s = state.skills[skillKey];
  // 无等级上限：经验足够就一直升级，直到 XP 不足。
  // 守卫 Number.isFinite 防止异常 XP（Infinity/NaN）造成死循环。
  while (Number.isFinite(s.xp) && s.xp >= xpForLevel(s.lvl + 1)) {
    const need = xpForLevel(s.lvl + 1);
    if (s.xp < need) break;
    s.xp -= need;
    const previousLevel = s.lvl;
    s.lvl++;
    GameEvents.emit("skill:levelUp", { skill:skillKey, previousLevel, level:s.lvl }, eventMeta);
  }
}

function addSkillXpToState(state, skillKey, amount, eventMeta) {
  if (!state || !state.skills || !state.skills[skillKey]) return 0;
  const meta = eventMeta || {};
  let gained = Math.max(0, Number(amount) || 0);
  // 经验改装件（rig_skill_xp）：仅加成该船被指派的工作（job），不外溢到其他船/其他工作。
  // job 为 shipAssignments 的键（mining/gasHarvesting/refining/archaeology/combat）；无 job 则 rig 不生效。
  if (meta.job && typeof getAssignedShipState === "function" && typeof getRigModifiers === "function") {
    const assigned = getAssignedShipState(state, meta.job);
    if (assigned && assigned.instance) {
      const mods = getRigModifiers(state, assigned.instance) || {};
      const rigBonus = Number(mods.skillXpBonus) || 0;
      if (rigBonus) gained = gained * (1 + rigBonus);
    }
  }
  // 神经训练催化器（全局增强剂）：所有技能经验共用同一乘区（与 rig 独立相乘）。
  if (typeof getBoosterEffectState === "function") {
    const eff = getBoosterEffectState(state);
    const booster = (eff && eff.skillXpMultBySkill) ? (Number(eff.skillXpMultBySkill[skillKey]) || 1) : 1;
    if (booster && booster !== 1) gained = gained * booster;
  }
  gained = Math.max(0, gained);
  // 军团 NPC「薪资统筹」之外的「训练教范(xpGain)」：玩家经验加成（不影响 NPC 等级曲线）。
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    const lp = LEGION_NPC.getLegionContributionSnapshot(state).multipliers.playerXp;
    if (lp && lp !== 1) gained = gained * lp;
  }
  // 脑突触加速剂（广告激励增益）：独立乘区 ×1.3，仅增益激活时作用于技能经验（生产+战斗均经此入口）。
  const adbm = (typeof getAdBuffMultiplier === "function") ? getAdBuffMultiplier(state) : 1;
  if (adbm && adbm !== 1) gained = gained * adbm;
  state.skills[skillKey].xp = (Number(state.skills[skillKey].xp) || 0) + gained;
  checkLevelUpFromState(state, skillKey, eventMeta);
  state._dirty = true;
  return gained;
}

function checkLevelUp(skillKey, eventMeta) {
  return checkLevelUpFromState(gameState, skillKey, eventMeta);
}

function getMiningAreaByName(name) { return ALL_MINING_AREAS.find(a => a.name === name || a.ore === name) || null; }
function getMiningArea() { return getMiningAreaByName(gameState.currentAction.area) || MINING_AREAS[0]; }
function getRunningMiningArea() { return getMiningAreaByName(gameState.currentAction.startedArea || gameState.currentAction.area) || MINING_AREAS[0]; }
function getMiningAreasForMode(mode) { return mode === "moon" ? MOON_MINING_AREAS : MINING_AREAS; }
function getBestMiningArea(mode) {
  const areas = getMiningAreasForMode(mode || "normal"); const lv = getEffectiveSkillLevel(gameState, "mining");
  let best = areas[0]; for (const area of areas) { if (lv >= area.level) best = area; else break; } return best;
}

const SMELTING_RECIPES = [
  { name: "凡晶石带",   consumeOre: "凡晶石", outputMineral: "三钛合金",     level: 1,  baseTime: 10,   baseOutput: 1, baseXP: 10  },
  { name: "灼烧岩带",   consumeOre: "灼烧岩", outputMineral: "类银超金属",   level: 10, baseTime: 20,   baseOutput: 1, baseXP: 30  },
  { name: "水硼砂带",   consumeOre: "水硼砂", outputMineral: "类晶体胶矿",   level: 20, baseTime: 35,   baseOutput: 1, baseXP: 70  },
  { name: "斜长岩带",   consumeOre: "斜长岩", outputMineral: "同位聚合体",   level: 40, baseTime: 60,   baseOutput: 1, baseXP: 140 },
  { name: "干焦岩带",   consumeOre: "干焦岩", outputMineral: "超新星诺克石", level: 55, baseTime: 90,   baseOutput: 1, baseXP: 230 },
  { name: "灰岩带",     consumeOre: "灰岩",   outputMineral: "基腹断岩",     level: 70, baseTime: 130,  baseOutput: 1, baseXP: 370 },
  { name: "艾克诺岩带", consumeOre: "艾克诺岩", outputMineral: "超噬矿",     level: 85, baseTime: 190,  baseOutput: 1, baseXP: 580 }
];

// ---- 气体采集区域配置表 ----
const GAS_AREAS = [
  { name: "富勒烯云团",     gas: "粗制富勒烯",   level: 1,  baseTime: 22.5, baseXP: 10  },
  { name: "氦同位素云团",   gas: "氦同位素",     level: 10, baseTime: 45,   baseXP: 40  },
  { name: "稳定富勒烯云团", gas: "稳定富勒烯",   level: 20, baseTime: 75,   baseXP: 80  },
  { name: "氢同位素云团",   gas: "氢同位素",     level: 40, baseTime: 112.5, baseXP: 140 },
  { name: "高纯富勒烯云团", gas: "高纯富勒烯",   level: 55, baseTime: 165,  baseXP: 220 },
  { name: "聚合气体云团",   gas: "聚合气体",     level: 70, baseTime: 240,  baseXP: 350 },
  { name: "超纯聚合气体云团", gas: "超纯聚合气体", level: 85, baseTime: 337.5, baseXP: 520 }
];

function getAssignedShip(actionKey) { const ship = getAssignedShipInstance(actionKey); return ship ? getShipConfig(ship.shipId) : null; }
function getAssignedShipFitting(actionKey) { const ship = getAssignedShipInstance(actionKey); return ship ? getShipFitting(ship.instanceId) : createEmptyFitting(); }
function getActiveIndustrialShip() {
  const id = gameState.activeIndustrialShip;
  if (!id || !INDUSTRIAL_SHIPS || !INDUSTRIAL_SHIPS[id]) return null;
  return INDUSTRIAL_SHIPS[id];
}

function getProductionEfficiencyBreakdown(actionKey) {
  const display = getProductionEfficiencyState(gameState, actionKey);
  return { ...display, lvl:display.level, ship:display.ship ? getShipConfigById(display.ship.id) : null };
}

function getProductionEfficiencyTooltip(actionKey, targetName, baseTime) {
  return buildProductionEfficiencyTooltip(getProductionEfficiencyState(gameState, actionKey), targetName, baseTime);
}

function getMiningEfficiency() {
  let base = getProductionEfficiencyBreakdown("mining").total; // 已含脑突触加速剂(adBuffMult，注入于 getProductionEfficiencyState.total)
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    base = base * LEGION_NPC.getLegionContributionSnapshot(gameState).multipliers.mining;
  }
  return base;
}
function getSmeltingEfficiency() { return getSmeltingDisplayState(gameState, Date.now()).efficiency; }
function getGasEfficiency() {
  let base = getProductionEfficiencyBreakdown("gasHarvesting").total; // 已含脑突触加速剂(adBuffMult，注入于 getProductionEfficiencyState.total)
  if (typeof LEGION_NPC !== "undefined" && typeof LEGION_NPC.getLegionContributionSnapshot === "function") {
    base = base * LEGION_NPC.getLegionContributionSnapshot(gameState).multipliers.gas;
  }
  return base;
}
function getShipEngineeringEfficiency() { const lvl = getEffectiveSkillLevel(gameState, "shipEngineering"); return 1 * (1 + lvl * 0.02); }

function getGasArea() { const name = gameState.currentAction.gasArea; return GAS_AREAS.find(a => a.name === name) || GAS_AREAS[0]; }
function getBestGasArea() { const lv = getEffectiveSkillLevel(gameState, "gasHarvesting"); let best = GAS_AREAS[0]; for (const a of GAS_AREAS) { if (lv >= a.level) best = a; else break; } return best; }

// 伴生富集改装件（rig_mining_rich / rig_gas_rich）：采集周期结算的概率性基准矿奖励。
// 在线（tick.js）与离线（offline.js）共用：读装配舰 rig 聚合几率（miningRichChance/gasRichChance）掷骰，
// 命中则额外发放基准矿（采矿=铁硅原矿 ore:凡晶石 / 采气=粗制富勒烯 gas:粗制富勒烯），
// 数量 = max(1, round(当前区域 baseTime ÷ 基准区域 baseTime))。
// 奖励独立：不参与双倍矿/脑插双生/调度加成，不给 XP。返回发放数量（未触发为 0）。
const RIG_RICH_BASE_AREA_TIME = { mining: 15, gasHarvesting: 22.5 }; // 凡晶石带 15s / 富勒烯云团 22.5s
function rollRigRichBonus(state, actionKey, area) {
  const baseTime = RIG_RICH_BASE_AREA_TIME[actionKey];
  if (!baseTime || !state || !area || !(Number(area.baseTime) > 0)) return 0;
  const chanceKey = actionKey === "mining" ? "miningRichChance" : "gasRichChance";
  const bonusResId = actionKey === "mining" ? "ore:凡晶石" : "gas:粗制富勒烯";
  let instance = null;
  if (typeof getAssignedShipInstance === "function") {
    try { instance = getAssignedShipInstance(actionKey); } catch (e) { instance = null; }
  }
  if (!instance || typeof getRigModifiers !== "function") return 0;
  if (typeof ResourceRegistry === "undefined" || typeof ResourceRegistry.add !== "function") return 0;
  const mods = getRigModifiers(state, instance) || {};
  const chance = Number(mods[chanceKey]) || 0;
  if (!(chance > 0) || Math.random() >= chance) return 0;
  const qty = Math.max(1, Math.round(Number(area.baseTime) / baseTime));
  ResourceRegistry.add(state, bonusResId, qty);
  return qty;
}

function getSmeltingRecipe() { const name = gameState.currentAction.smeltingArea; return SMELTING_RECIPES.find(r => r.name === name) || SMELTING_RECIPES[0]; }
function hasMoonMiningEquipment() {
  return getMoonMiningAccessState(gameState).hasEquipment;
}
function canMineArea(area) {
  return getMiningRequirementState(gameState, area).available;
}
function getMiningRequirementText(area) {
  return getMiningRequirementState(gameState, area).text;
}
