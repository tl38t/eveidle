/* ================================================================
   纯状态选择器 / View State

   规则：
   1. 只读取显式传入的 state 与静态配置。
   2. 不访问 DOM，不写入 state，不调用会修改 state 的兼容函数。
   3. 返回可序列化的普通对象，供原生 DOM、测试或未来框架共同消费。
   ================================================================ */

// Batch L（IP 去相似化）显示层辅助：区域 / 星带显示名转换（内部 area name 是逻辑键，仅显示层替换）
function getAreaDisplayName(name) {
  return (typeof DisplayNames !== "undefined" && DisplayNames && typeof DisplayNames.getAreaName === "function")
    ? DisplayNames.getAreaName(name)
    : name;
}

// Batch L：对拼接文案做词级显示名替换（矿石 / 矿物 / 势力材料 / 旧舰船名等），
// 只影响玩家可见文本，绝不改动内部键。未命中返回原文。
function transformDisplayText(text) {
  if (typeof text !== "string" || !text) return text;
  if (typeof DisplayNames === "undefined" || !DisplayNames) return text;
  let out = text;
  for (const key of Object.keys(DisplayNames.ORE_NAMES || {})) out = out.split(key).join(DisplayNames.ORE_NAMES[key]);
  for (const key of Object.keys(DisplayNames.MINERAL_NAMES || {})) out = out.split(key).join(DisplayNames.MINERAL_NAMES[key]);
  return out;
}

function getShipInstanceFromState(state, shipRef) {
  const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  return ships.find(ship => ship.instanceId === shipRef) || ships.find(ship => ship.shipId === shipRef) || null;
}

function getShipConfigById(shipId) {
  return STARTER_SHIPS[shipId]
    || INDUSTRIAL_SHIPS[shipId]
    || (typeof ARCHAEOLOGY_SHIPS !== "undefined" ? ARCHAEOLOGY_SHIPS[shipId] : undefined)
    || null;
}

// ---- 舰船工程 UI 重做（2026-08-04）：部件分类 / 总装技术线 常量与分类辅助 ----
const SHIP_COMPONENT_CLASSES = [
  { id:"integrated", name:"护卫部件" },
  { id:"destroyer", name:"驱逐部件" },
  { id:"cruiser", name:"巡洋部件" },
  { id:"battleship", name:"战列部件" },
  { id:"capital", name:"旗舰部件" },
  { id:"supercapital", name:"超级旗舰部件" }
];
const SHIP_ASSEMBLY_LINES = [
  { id:"shield_laser", name:"护盾激光系" },
  { id:"armor_missile", name:"装甲导弹系" },
  { id:"structure_cannon", name:"结构火炮系" },
  { id:"industrial", name:"工业系" },
  { id:"archaeology", name:"考古系" }
];
const SHIP_ASSEMBLY_PAGE_SIZE = 20;
const SHIP_INDUSTRIAL_IDS = new Set(["miner_frigate","gas_frigate","miner_destroyer","gas_destroyer","miner_cruiser","gas_cruiser","miner_battleship","gas_battleship","dolphin","orca"]);
const SHIP_ARCHAEOLOGY_IDS = new Set(["heron","tracer","starmap","farscope","illuminator"]);
const SHIP_HYBRID_IDS = new Set(["gale","bloodthorn","umbra","thunder","crimson","nether","dawnbreaker","crimson_bastion","spectre_frame"]);

function getShipComponentClass(recipeId) {
  if (recipeId.startsWith("destroyer_")) return "destroyer";
  if (recipeId.startsWith("cruiser_")) return "cruiser";
  if (recipeId.startsWith("battleship_")) return "battleship";
  if (recipeId.startsWith("capital_")) return "capital";
  if (recipeId.startsWith("supercapital_")) return "supercapital";
  return "integrated";
}

function getShipAssemblyLine(shipId) {
  if (SHIP_INDUSTRIAL_IDS.has(shipId)) return "industrial";
  if (SHIP_ARCHAEOLOGY_IDS.has(shipId)) return "archaeology";
  const cfg = getShipConfigById(shipId);
  const weapon = cfg && cfg.recommendedWeapon;
  if (weapon === "missile") return "armor_missile";
  if (weapon === "cannon") return "structure_cannon";
  if (weapon === "laser") return "shield_laser";
  const flavor = (cfg && cfg.flavor) || "";
  if (flavor.includes("导弹")) return "armor_missile";
  if (flavor.includes("炮台") || flavor.includes("火炮")) return "structure_cannon";
  return "shield_laser";
}

function getShipRoleName(shipId) {
  if (shipId.startsWith("miner_")) return "矿石采集工业舰";
  if (shipId.startsWith("gas_")) return "气体采集工业舰";
  if (shipId === "dolphin") return "工业支援巡洋舰";
  if (shipId === "orca") return "工业旗舰";
  const cfg = getShipConfigById(shipId);
  const type = cfg && cfg.type;
  const TYPE_MAP = { frigate:"护卫舰", destroyer:"驱逐舰", cruiser:"巡洋舰", battleship:"战列舰", capital:"旗舰", supercapital:"超级旗舰" };
  return (type && TYPE_MAP[type]) || "舰船";
}

function getShipAssignmentRestriction(config, actionKey, combatRecoveryActive, instance, state) {
  const bonuses = config && config.bonuses ? config.bonuses : {};
  if (!["combat", "mining", "gasHarvesting", "refining", "archaeology"].includes(actionKey)) return { reason:"unsupported-task", text:"该任务不需要分配舰船岗位" };
  if (actionKey === "combat" && combatRecoveryActive) return { reason:"repairing", text:"舰船自动维修中" };
  if (actionKey === "mining" && !(bonuses.miningLaserEfficiency > 0)) return { reason:"unsupported-mining", text:"该舰船没有采矿岗位" };
  if (actionKey === "gasHarvesting" && !(bonuses.gasLaserEfficiency > 0)) return { reason:"unsupported-gas", text:"该舰船没有采气岗位" };
  if (actionKey === "refining") {
    // 冶炼资格 = 船体自带 smeltingSpeed + 改装件（冶炼速度 rig）提供的 smeltingSpeed 之和。
    // 任一来源提供冶炼效率即可承担冶炼岗位（呼应"只要带冶炼效率提升就行"）。
    let smelt = Number(bonuses.smeltingSpeed) || 0;
    if (instance && state && typeof getRigModifiers === "function") {
      const rigMods = getRigModifiers(state, instance) || {};
      smelt += Number(rigMods.smeltingSpeed) || 0;
    }
    if (!(smelt > 0)) return { reason:"unsupported-refining", text:"该舰船没有冶炼能力（需船体或改装件提供冶炼速度）" };
  }
  if (actionKey === "archaeology" && !((bonuses.archaeologyScanStrength || 0) > 0)) return { reason:"unsupported-archaeology", text:"该舰船没有考古扫描能力" };
  return null;
}

// ---- 舰船维修（per-ship）唯一权威状态：combat.repairs[instanceId] = untilTs ----
// 任何判断都必须经由以下公共函数，禁止在 selectors/actions/UI 各自重复读取 repairs 字段。
// 旧字段 combat.repairUntil / combat.destroyedShip 仅作存档迁移占位，迁移后即清零，不参与任何判断。
function getShipRepairUntil(state, instanceId) {
  if (!state || !state.combat || !state.combat.repairs || !instanceId) return 0;
  const until = Number(state.combat.repairs[instanceId]);
  return Number.isFinite(until) ? until : 0;
}
function isShipUnderRepair(state, instanceId, now) {
  const t = Number(now);
  if (!Number.isFinite(t)) return false;
  return getShipRepairUntil(state, instanceId) > t;
}
function beginShipRepair(state, instanceId, until) {
  if (!state.combat) state.combat = {};
  if (!state.combat.repairs || typeof state.combat.repairs !== "object" || Array.isArray(state.combat.repairs)) state.combat.repairs = {};
  state.combat.repairs[instanceId] = Number(until) || 0;
  state._dirty = true;
}
function finishShipRepair(state, instanceId) {
  if (state.combat && state.combat.repairs && Object.prototype.hasOwnProperty.call(state.combat.repairs, instanceId)) {
    delete state.combat.repairs[instanceId];
    state._dirty = true;
  }
}
function clearExpiredShipRepairs(state, now) {
  if (!state.combat || !state.combat.repairs) return 0;
  const t = Number(now);
  let cleared = 0;
  // 到期边界统一：until <= now 视为维修完成（与 isShipUnderRepair 的 until > now 互补）。
  for (const id of Object.keys(state.combat.repairs)) {
    if (!isShipUnderRepair(state, id, t)) { delete state.combat.repairs[id]; cleared++; state._dirty = true; }
  }
  return cleared;
}

function getAssignedShipState(state, actionKey) {
  const assignment = state && state.shipAssignments ? state.shipAssignments[actionKey] : null;
  const instance = assignment ? getShipInstanceFromState(state, assignment) : null;
  return instance ? { instance, config:getShipConfigById(instance.shipId) } : { instance:null, config:null };
}

function getFittingFromInstance(instance) {
  const fitted = instance && instance.fitted ? instance.fitted : {};
  return {
    high:Array.isArray(fitted.high) ? fitted.high.slice() : [],
    mid:Array.isArray(fitted.mid) ? fitted.mid.slice() : [],
    low:Array.isArray(fitted.low) ? fitted.low.slice() : [],
    rig:Array.isArray(fitted.rig) ? fitted.rig.slice() : []
  };
}

function getFleetMiningSupportState(state, assignedInstance) {
  const assignedConfig = assignedInstance ? getShipConfigById(assignedInstance.shipId) : null;
  if (!assignedConfig || !INDUSTRIAL_SHIPS[assignedConfig.id]) return { bonus:0, ship:null };
  const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  let best = { bonus:0, ship:null };
  for (const instance of ships) {
    const config = getShipConfigById(instance.shipId);
    const bonus = config && config.bonuses ? Number(config.bonuses.fleetMiningSpeed) || 0 : 0;
    if (bonus <= best.bonus) continue;
    if (config.fleetMiningExcludesSelf && instance.instanceId === assignedInstance.instanceId) continue;
    best = { bonus, ship:{ id:config.id, name:config.name } };
  }
  return best;
}

function getInventoryTotalFromState(state) {
  return ResourceRegistry.getInventoryTotal(state);
}

function getGlobalDisplayState(state) {
  const resources = state && state.resources ? state.resources : {};
  const total = getInventoryTotalFromState(state);
  return {
    isk:ResourceRegistry.get(state, "currency:isk"),
    lp:ResourceRegistry.get(state, "currency:lp"),
    inventory:{
      total
    },
    quickOres:ResourceRegistry.listStateEntries(state, "ore")
      .filter(entry => entry.quantity > 0)
      .slice(0, 4)
      .map(entry => ({ name:getResourceDisplayName(entry.definition.id), value:entry.quantity }))
  };
}

function getSidebarDisplayState(state) {
  const combatLevel = getCombatLevelBreakdownFromState(state);
  return Object.entries((state && state.skills) || {}).map(([key, skill]) => {
    if (key === "combat") {
      return {
        key,
        level:combatLevel.level,
        xp:null,
        xpNeeded:null,
        levelClass:combatLevel.level >= 60 ? "lv-high" : combatLevel.level >= 20 ? "lv-mid" : "lv-low",
        tooltip:"战斗等级 = ⌊(最高攻击技能 + 最高防御技能) ÷ 2⌋\n" +
          "攻击技能：激光、炮台、导弹取最高 = Lv." + combatLevel.attack + "\n" +
          "防御技能：护盾、装甲、结构取最高 = Lv." + combatLevel.defense + "\n" +
          "当前：⌊(" + combatLevel.attack + " + " + combatLevel.defense + ") ÷ 2⌋ = Lv." + combatLevel.level
      };
    }
    const level = Number(skill.lvl) || 1;
    return {
      key,
      level,
      xp:Number(skill.xp) || 0,
      xpNeeded:xpForLevel(level + 1),
      levelClass:level >= 60 ? "lv-high" : level >= 20 ? "lv-mid" : "lv-low"
    };
  });
}

function getSkillShellDisplayState(state, viewKey) {
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipEngineering:"🚀", equipmentEngineering:"🔧", combat:"⚔", archaeology:"🛰️" };
  const skill = state.skills[viewKey] || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  const running = Boolean(state.currentAction.active && state.currentAction.skill === viewKey);
  return {
    key:viewKey,
    name:SKILL_LABEL[viewKey] || viewKey,
    icon:icons[viewKey] || "▶",
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    status:running ? "进行中" : "待命",
    running
  };
}

function getCurrentActivityDisplayState(state, now) {
  const action = state.currentAction;
  if (!action.active) return { active:false, text:"待命", progressPercent:0, progressActive:false };
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipEngineering:"🚀", equipmentEngineering:"🔧", combat:"⚔", archaeology:"🛰️" };
  const key = action.skill;
  const skill = state.skills[key] || { lvl:1 };
  let detail = "";
  if (key === "archaeology") {
    const site = getArchaeologySite(state.archaeology && state.archaeology.activeSiteId);
    detail = site ? "解析" + site.name : "考古待命";
  }
  if (key === "mining") detail = "采集" + getResourceDisplayName("ore:" + getAreaByName(ALL_MINING_AREAS, action.startedArea || action.area).ore);
  else if (key === "refining") {
    const recipe = SMELTING_RECIPES.find(item => item.name === (action.startedSmeltingArea || action.smeltingArea)) || SMELTING_RECIPES[0];
    detail = "冶炼" + getResourceDisplayName(recipe.consumeOre) + "→" + getResourceDisplayName(recipe.outputMineral);
  } else if (key === "gasHarvesting") detail = "采集" + getResourceDisplayName("gas:" + getAreaByName(GAS_AREAS, action.startedGasArea || action.gasArea).gas);
  else if (key === "shipEngineering") {
    if (action.shipSubAction === "component") {
      const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === (action.startedShipCompTarget || action.shipCompTarget)) || SHIP_COMPONENT_RECIPES[0];
      detail = "制造" + recipe.name;
    } else {
      const recipe = SHIP_ASSEMBLY_RECIPES.find(item => item.id === (action.startedShipAsmTarget || action.shipAsmTarget)) || SHIP_ASSEMBLY_RECIPES[0];
      detail = "合成" + recipe.name;
    }
  } else if (key === "equipmentEngineering") {
    const recipe = getEquipmentEngineeringRecipe(action.startedEquipEngTarget || action.equipEngTarget);
    detail = "制造" + recipe.name;
  } else if (key === "combat") detail = "交战中 波次" + (state.combat.wave || 1);
  // 顶部状态条小进度条：用 tick 实时更新的 refDuration 作为周期。
  const renderNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const duration = key === "combat" ? 0 : (Number(action.refDuration) || 0);
  const progress = getProgressDisplayState(action, key, duration, renderNow);
  return {
    active:true,
    key,
    level:Number(skill.lvl) || 1,
    detail,
    text:(icons[key] || "▶") + " " + (SKILL_LABEL[key] || key) + " Lv." + (Number(skill.lvl) || 1) + " · " + detail + " · 进行中",
    progressPercent:progress.percent,
    progressActive:progress.active
  };
}

function getAreaByName(areas, name) {
  return areas.find(area => area.name === name || area.ore === name || area.gas === name) || areas[0];
}

function getProductionEfficiencyState(state, actionKey) {
  const isMining = actionKey === "mining";
  const isGas = actionKey === "gasHarvesting";
  const skillKey = isMining ? "mining" : "gasHarvesting";
  const primaryKey = isMining ? "miningEfficiency" : "gasEfficiency";
  const secondaryKey = isMining ? "miningBonus" : "gasBonus";
  const amplifierKey = isMining ? "miningLaserEfficiency" : "gasLaserEfficiency";
  const skill = state.skills[skillKey] || { lvl:1 };
  const level = Number(skill.lvl) || 1;
  const skillMultiplier = 1 + level * 0.02;
  const assigned = getAssignedShipState(state, actionKey);
  const fitting = getFittingFromInstance(assigned.instance);
  const enhancement = assigned.instance && assigned.config
    ? getShipEnhancementBonuses(assigned.config, assigned.instance.enhancementLevel)
    : { industryMultiplier:1 };
  const shipAmplifier = assigned.config && assigned.config.bonuses ? (assigned.config.bonuses[amplifierKey] || 0) : 0;
  const fleetSupport = isMining ? getFleetMiningSupportState(state, assigned.instance) : { bonus:0, ship:null };
  const equipment = [];
  let equipmentAmplifier = 0;
  let primaryBonus = 0;
  let secondaryBonus = 0;

  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of fitting[slot]) {
      const resolved = resolveEquipmentReference(state, ref);
      const item = resolved && resolved.definition;
      if (item && item.bonuses) equipmentAmplifier += (item.bonuses[amplifierKey] || 0) * resolved.multiplier;
    }
  }
  const amplifier = shipAmplifier + equipmentAmplifier;
  // 研究批次 G：采集科研唯一乘子（allMining 根加成 + mining/gas 专精，先加法汇总再生成单一乘子）。
  // 采矿走 ["allMining","mining"]，采气走 ["allMining","gas"]；零科研时恒为 1，结果与接入前严格一致。
  const researchMultiplier = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(state, isMining ? ["allMining", "mining"] : ["allMining", "gas"])
    : 1;

  // 重平衡（2026-08-16）：船身采矿/采气放大器 = 原值 -100pp（150%→50%、280%→180% 等），护卫/驮星原值仅100%砍完为0；
  // 中槽无人机链 / 改装件的基础效率作为独立乘数乘在高槽放大后的值外面；
  // 中槽无人机链 / 改装件的基础效率不再平加 primaryBonus，而是作为独立乘数乘在高槽放大后的值外面；
  // 带放大器的势力中槽件（同时含 base+amp）的 base 保持平加，避免被高槽放大器二次放大（double-dip）。
  let highTotal = 0;        // 高槽采集装备效果（已乘放大器）合计
  let droneRigBase = 0;     // 中槽无人机链 / 改装件基础效率，作为独立乘数
  let flatPrimary = 0;      // 带放大器的中槽/低槽件基础效率，保持平加
  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of fitting[slot]) {
      const resolved = resolveEquipmentReference(state, ref);
      const item = resolved && resolved.definition;
      if (!item || !item.bonuses) continue;
      const multiplier = resolved.multiplier;
      const rawPrimary = (item.bonuses[primaryKey] || 0) * multiplier;
      const amplifierBonus = (item.bonuses[amplifierKey] || 0) * multiplier;
      const secondary = (item.bonuses[secondaryKey] || 0) * multiplier;
      if (!rawPrimary && !secondary && !amplifierBonus) continue;
      const isHigh = slot === "high";
      const adjustedPrimary = isHigh ? rawPrimary * (1 + amplifier) : rawPrimary;
      if (isHigh) {
        highTotal += adjustedPrimary;
      } else if (slot === "mid" || slot === "rig") {
        if (amplifierBonus > 0) flatPrimary += rawPrimary; // 势力无人机链路：base 平加防膨胀
        else droneRigBase += rawPrimary;                    // 标准无人机链/改装件：独立乘数
      } else { // low
        flatPrimary += rawPrimary; // 低槽基础效率（矿提通常无 base，保持旧行为平加）
      }
      equipment.push({ name:item.name, slot, rawPrimary, adjustedPrimary, secondary, amplifierBonus,
        droneRig: (slot === "mid" || slot === "rig") && amplifierBonus <= 0 });
      if (secondary) secondaryBonus += secondary;
    }
  }
  const droneRigMultiplier = 1 + droneRigBase;
  primaryBonus = highTotal * droneRigMultiplier + flatPrimary;

  return {
    actionKey,
    level,
    skillMultiplier,
    ship:assigned.config ? { id:assigned.config.id, name:assigned.config.name } : null,
    shipAmplifier,
    equipmentAmplifier,
    amplifier,
    equipment,
    primaryBonus,
    secondaryBonus,
    highTotal,
    droneRigBase,
    droneRigMultiplier,
    enhancementMultiplier:enhancement.industryMultiplier,
    enhancementLevel:assigned.instance ? normalizeShipEnhancementLevel(assigned.instance.enhancementLevel) : 0,
    fleetSupportBonus:fleetSupport.bonus,
    fleetSupportShip:fleetSupport.ship,
    stationLogisticsMultiplier: getStationLogisticsMultiplier(state),
    researchMultiplier,
    // 脑插·采集增效（考古来源）：采矿/采气各 +3%，独立乘区
    implantCollectMult: (typeof getImplantBonuses === "function") ? getImplantBonuses(state).collect[isMining ? "mining" : "gas"] : 1,
    // 增强剂·采气速度（考古重制 Phase B · 考古蓝图产出）：独立乘区，仅采气生效
    boosterGasSpeed: (isGas && typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).gasSpeedMultiplier : 1,
    // 增强剂·采矿速度：独立乘区，仅采矿生效（修复：详情面板此前在计算与连乘式中漏算该项）
    boosterMiningSpeed: (isMining && typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).miningSpeedMultiplier : 1,
    total:skillMultiplier * (1 + primaryBonus) * (1 + secondaryBonus) * enhancement.industryMultiplier * (1 + fleetSupport.bonus) * getStationLogisticsMultiplier(state) * researchMultiplier * ((typeof getImplantBonuses === "function") ? getImplantBonuses(state).collect[isMining ? "mining" : "gas"] : 1) * ((isMining && typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).miningSpeedMultiplier : 1) * ((isGas && typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).gasSpeedMultiplier : 1)
  };
}

function buildProductionEfficiencyTooltip(display, targetName, baseTime) {
  const isMining = display.actionKey === "mining";
  const activityName = isMining ? "采矿" : "气体采集";
  const lines = ["技能：1 × (1 + Lv." + display.level + " × 0.02) = " + display.skillMultiplier.toFixed(2) + "x"];
  if (display.ship) lines.push("工业舰：" + display.ship.name);
  if (display.shipAmplifier > 0) lines.push("舰船强化：高槽采集装备效果 +" + (display.shipAmplifier * 100).toFixed(0) + "%");
  lines.push("装备加成：");
  if (display.equipment.length === 0) lines.push("- 无相关装备加成");
  for (const item of display.equipment) {
    const bonuses = [];
    if (item.adjustedPrimary) {
      let text = activityName + "效率 +" + (item.adjustedPrimary * 100).toFixed(1) + "%";
      if (item.droneRig) text += "（独立乘数，作用于高槽值外）";
      else if (item.adjustedPrimary !== item.rawPrimary) text += "（舰船强化前 " + (item.rawPrimary * 100).toFixed(1) + "%）";
      bonuses.push(text);
    }
    if (item.secondary) bonuses.push(activityName + "总加成 +" + (item.secondary * 100).toFixed(1) + "%");
    if (item.amplifierBonus) bonuses.push((isMining ? "采矿激光器" : "气云采集器") + "效果 +" + (item.amplifierBonus * 100).toFixed(1) + "%");
    lines.push("- " + item.name + "：" + bonuses.join("，"));
  }
  lines.push("高槽采集合计：+" + (display.highTotal * 100).toFixed(1) + "%（已含舰船/装备强化）");
  if (display.droneRigBase > 0) lines.push("无人机/改装件乘数：×" + display.droneRigMultiplier.toFixed(2) + "（+" + (display.droneRigBase * 100).toFixed(1) + "%）");
  lines.push("采集效率合计：+" + (display.primaryBonus * 100).toFixed(1) + "% / 高槽强化 +" + (display.equipmentAmplifier * 100).toFixed(1) + "%");
  if (display.enhancementLevel > 0) lines.push("舰船强化：+" + display.enhancementLevel + "，最终采集效率 ×" + display.enhancementMultiplier.toFixed(3));
  if (display.fleetSupportBonus > 0) lines.push("舰队采矿协同：" + display.fleetSupportShip.name + " +" + (display.fleetSupportBonus * 100).toFixed(0) + "%（只取最高值）");
  const logMult = display.stationLogisticsMultiplier || 1;
  if (logMult > 1) lines.push("空间站综合后勤：×" + logMult.toFixed(2) + "（+" + Math.round((logMult - 1) * 100) + "%）");
  else if (logMult < 1) lines.push("空间站综合后勤：×" + logMult.toFixed(2));
  else lines.push("空间站综合后勤：×1.00（未生效）");
  const researchMult = Number(display.researchMultiplier) || 1;
  if (researchMult !== 1) lines.push("科研加成：×" + researchMult.toFixed(3) + "（+" + ((researchMult - 1) * 100).toFixed(1) + "%）");
  // 脑插·采集增效（独立乘区，已计入 total）
  const implantMult = Number(display.implantCollectMult) || 1;
  if (implantMult !== 1) lines.push("脑插·采集增效：" + (isMining ? "采矿" : "采气") + "效率 +" + Math.round((implantMult - 1) * 100) + "%（来源：考古掉落植入体）");
  // 增强剂速度（独立乘区，已计入 total）
  const boosterMult = isMining ? (Number(display.boosterMiningSpeed) || 1) : (Number(display.boosterGasSpeed) || 1);
  if (boosterMult !== 1) {
    const pct = Math.round((boosterMult - 1) * 100);
    lines.push("增强剂·" + (isMining ? "采矿速度" : "采气速度") + "：" + (pct > 0 ? "+" : "") + pct + "%（" + (isMining ? "纳米采掘润滑剂" : "气云流变剂") + "，仅生效档位，不叠加）");
  }
  // 最终效率连乘式（含脑插 / 增强剂，确保与 total 数值一致）
  let chain = display.skillMultiplier.toFixed(2) + " × " + (1 + display.primaryBonus).toFixed(3) + " × " + (1 + display.secondaryBonus).toFixed(3) + " × " + display.enhancementMultiplier.toFixed(3) + " × " + (1 + display.fleetSupportBonus).toFixed(3) + " × " + logMult.toFixed(3) + " × " + researchMult.toFixed(3);
  if (implantMult !== 1) chain += " × " + implantMult.toFixed(3);
  if (boosterMult !== 1) chain += " × " + boosterMult.toFixed(3);
  lines.push("最终效率：" + chain + " = " + display.total.toFixed(2) + "x");
  const targetLabel = (typeof getResourceDisplayName === "function") ? getResourceDisplayName(targetName) : targetName;
  lines.push("", "当前目标：" + targetLabel, "基础时间：" + baseTime + "s", "实际时间：" + (baseTime / display.total).toFixed(1) + "s");
  return lines.join("\n");
}

function getProgressDisplayState(action, skillKey, duration, now) {
  const active = Boolean(action.active && action.skill === skillKey);
  if (!active || !Number.isFinite(duration) || duration <= 0) {
    return { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"—", duration:duration || 0 };
  }
  const elapsedSinceUpdate = Math.max(0, (now - (Number(action.lastProgressUpdate) || now)) / 1000);
  const elapsed = Math.max(0, (Number(action.progress) || 0) + elapsedSinceUpdate);
  const etaSeconds = Math.max(0, duration - elapsed);
  return {
    active:true,
    elapsed,
    percent:Math.min(100, Math.floor(elapsed / duration * 100)),
    etaSeconds,
    etaText:etaSeconds.toFixed(1) + "s",
    duration
  };
}

function getMoonMiningAccessState(state) {
  const assigned = getAssignedShipState(state, "mining");
  const fitting = getFittingFromInstance(assigned.instance);
  // fitted 现在保存 instanceId，必须通过 resolveEquipmentReference 解析
  const hasEquipment = fitting.high.some(ref => {
    const resolved = resolveEquipmentReference(state, ref);
    return resolved && resolved.definition && (resolved.definition.bonuses || {}).miningEfficiency > 0;
  });
  return { hasShip:Boolean(assigned.instance), hasEquipment };
}

function getMiningRequirementState(state, area) {
  const level = Number(state.skills.mining && state.skills.mining.lvl) || 1;
  if (!area || level < area.level) return { available:false, text:"需要采矿 Lv." + (area ? area.level : 1) };
  if (area.mode === "moon") {
    const access = getMoonMiningAccessState(state);
    if (!access.hasShip) return { available:false, text:"月矿需要分配一艘采矿舰船" };
    if (!access.hasEquipment) return { available:false, text:"月矿需要舰船高槽装配采矿激光器" };
    return { available:true, text:"已满足月矿采集条件" };
  }
  return { available:true, text:"已解锁，可开始采集" };
}

function getMiningDisplayState(state, now) {
  const action = state.currentAction;
  const current = getAreaByName(ALL_MINING_AREAS, action.area);
  const running = getAreaByName(ALL_MINING_AREAS, action.startedArea || action.area);
  const mode = action.miningMode === "moon" ? "moon" : "normal";
  const efficiency = getProductionEfficiencyState(state, "mining");
  const runningDuration = running.baseTime / efficiency.total;
  const progress = getProgressDisplayState(action, "mining", runningDuration, now);
  const targetChanged = progress.active && current.name !== running.name;
  const requirement = getMiningRequirementState(state, current);
  const level = Number(state.skills.mining && state.skills.mining.lvl) || 1;
  // Batch L：显示层统一替换星带名（内部 area.name 仍是 action.area / queue target 逻辑键，保持原值）
  return {
    kind:"mining",
    current:{ ...current, displayName:getAreaDisplayName(current.name) },
    running:{ ...running, displayName:getAreaDisplayName(running.name) },
    mode,
    level,
    efficiency,
    efficiencyTooltip:buildProductionEfficiencyTooltip(efficiency, current.ore, current.baseTime),
    stationLogisticsMultiplier:efficiency.stationLogisticsMultiplier,
    stationLogisticsBonusRate:efficiency.stationLogisticsMultiplier > 1 ? (efficiency.stationLogisticsMultiplier - 1) : 0,
    actualTime:current.baseTime / efficiency.total,
    progress,
    targetChanged,
    showStart:!progress.active || targetChanged,
    showStop:progress.active && !targetChanged,
    canStart:requirement.available,
    requirement,
    targets:(mode === "moon" ? MOON_MINING_AREAS : MINING_AREAS).map(area => ({
      ...area,
      displayName:getAreaDisplayName(area.name),
      locked:level < area.level,
      selected:current.name === area.name,
      running:progress.active && running.name === area.name
    }))
  };
}

// 精炼产出份数：与精炼效率（冶炼速度）解耦，改为按等级阶梯跳变。
// LV<50 → 1 份；LV50~99 → 2 份；LV≥100 → 3 份（封顶）。
function getRefiningOutputMultiplier(level) {
  const lv = Number(level) || 0;
  if (lv >= 100) return 3;
  if (lv >= 50)  return 2;
  return 1;
}

function getSmeltingDisplayState(state, now) {
  const action = state.currentAction;
  const current = SMELTING_RECIPES.find(recipe => recipe.name === action.smeltingArea) || SMELTING_RECIPES[0];
  const running = SMELTING_RECIPES.find(recipe => recipe.name === (action.startedSmeltingArea || action.smeltingArea)) || current;
  const level = Number(state.skills.refining && state.skills.refining.lvl) || 1;
  const assigned = getAssignedShipState(state, "refining");
  const shipBonus = assigned.config && assigned.config.bonuses ? (assigned.config.bonuses.smeltingSpeed || 0) : 0;
  // 改装件冶炼速度加成（rig smeltingSpeed，加法并入船体加成）
  const rigMods = (assigned.instance && typeof getRigModifiers === "function")
    ? getRigModifiers(state, assigned.instance) : {};
  const rigBonus = rigMods.smeltingSpeed || 0;
  const skillEfficiency = 1 + level * 0.02;
  const stationLogisticsMultiplier = getStationLogisticsMultiplier(state, "smelt");
  // 研究批次 G：冶炼科研唯一乘子 = 1 + (allMfg + smelt)（加法汇总，绝不逐项连乘）
  const researchMultiplier = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(state, ["allMfg", "smelt"]) : 1;
  // 脑插·冶炼增效（货柜 T4 来源）：冶炼效率 +6%，独立乘区
  const implantRefineEff = (typeof getImplantBonuses === "function") ? getImplantBonuses(state).refiningEff : 1;
  // 增强剂·冶炼速度（考古重制 Phase B · 考古蓝图产出）：独立乘区
  const boosterSmeltSpeed = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).smeltSpeedMultiplier : 1;
  // 舰船强化（工业乘数 industryMultiplier）对冶炼仅享受 50% 幅度（与采矿/采气全幅区分）
  const shipEnhanceSmelt = (assigned.config && typeof getShipEnhancementSmeltMultiplier === "function")
    ? getShipEnhancementSmeltMultiplier(assigned.config, assigned.instance ? assigned.instance.enhancementLevel : 0) : 1;
  const efficiency = skillEfficiency * (1 + shipBonus + rigBonus) * stationLogisticsMultiplier * researchMultiplier * implantRefineEff * boosterSmeltSpeed * shipEnhanceSmelt;
  const progress = getProgressDisplayState(action, "refining", running.baseTime / efficiency, now);
  const targetChanged = progress.active && current.name !== running.name;
  const stock = ResourceRegistry.get(state, "ore:" + current.consumeOre);
  const runningStock = ResourceRegistry.get(state, "ore:" + running.consumeOre);
  return {
    kind:"refining",
    current:{ ...current, displayName:getAreaDisplayName(current.name) },
    running:{ ...running, displayName:getAreaDisplayName(running.name) },
    level,
    skillEfficiency,
    efficiency,
    stationLogisticsMultiplier,
    stationLogistics: (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(state) : null,
    researchMultiplier,
    stationLogisticsBonusRate: stationLogisticsMultiplier - 1,
    ship:assigned.config ? { id:assigned.config.id, name:assigned.config.name } : null,
    shipBonus,
    rigBonus,
    shipEnhanceSmelt,
    boosterSmeltSpeed,
    actualTime:current.baseTime / efficiency,
    output:Math.max(1, Math.floor(current.baseOutput * getRefiningOutputMultiplier(level))),
    stock,
    runningStock,
    progress,
    targetChanged,
    showStart:!progress.active || targetChanged,
    showStop:progress.active && !targetChanged,
    canStart:level >= current.level,
    options:SMELTING_RECIPES.map(recipe => ({ ...recipe, displayName:getAreaDisplayName(recipe.name), locked:level < recipe.level, selected:recipe.name === current.name }))
  };
}

function getGasDisplayState(state, now) {
  const action = state.currentAction;
  const current = getAreaByName(GAS_AREAS, action.gasArea);
  const running = getAreaByName(GAS_AREAS, action.startedGasArea || action.gasArea);
  const level = Number(state.skills.gasHarvesting && state.skills.gasHarvesting.lvl) || 1;
  const efficiency = getProductionEfficiencyState(state, "gasHarvesting");
  const progress = getProgressDisplayState(action, "gasHarvesting", running.baseTime / efficiency.total, now);
  const targetChanged = progress.active && current.name !== running.name;
  return {
    kind:"gasHarvesting",
    current:{ ...current },
    running:{ ...running },
    level,
    efficiency,
    efficiencyTooltip:buildProductionEfficiencyTooltip(efficiency, current.gas, current.baseTime),
    stationLogisticsMultiplier:efficiency.stationLogisticsMultiplier,
    stationLogisticsBonusRate:efficiency.stationLogisticsMultiplier > 1 ? (efficiency.stationLogisticsMultiplier - 1) : 0,
    actualTime:current.baseTime / efficiency.total,
    progress,
    targetChanged,
    showStart:!progress.active || targetChanged,
    showStop:progress.active && !targetChanged,
    canStart:level >= current.level,
    options:GAS_AREAS.map(area => ({ ...area, locked:level < area.level, selected:area.name === current.name }))
  };
}

function getMaterialStockFromState(state, material) {
  return ResourceRegistry.getMaterialStock(state, material);
}

function getShipAssemblyMaxCyclesFromState(state, recipe) {
  // 唯一有效报价顺序（与扣料/在线一致）：先过精密配给剂权威报价折扣 materialCost。
  // 船坞材料节省仅作用于部件制造，总装不再享受，故此处只按折扣后成本计算可负担周期。
  const discounted = (typeof getDiscountedAssemblyRecipe === "function")
    ? getDiscountedAssemblyRecipe(state, recipe)
    : Object.assign({}, recipe, { materialCost: (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, recipe, { kind:"assembly" }).cost : (recipe.materialCost || {}) });
  let max = Infinity;
  for (const [componentId, count] of Object.entries(getShipAssemblyComponentCost(recipe))) {
    max = Math.min(max, Math.floor(ResourceRegistry.get(state, "component:" + componentId) / count));
  }
  for (const [material, count] of Object.entries(discounted.materialCost || {})) {
    max = Math.min(max, Math.floor(getMaterialStockFromState(state, material) / count));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

function getEquipmentOwnedCountFromState(state, recipe) {
  if (recipe.output.type === "equipment") {
    const equipment = state.equipment || {};
    const inventory = Array.isArray(equipment.inventory) ? equipment.inventory : [];
    const instances = Array.isArray(equipment.instances) ? equipment.instances : [];
    return inventory.filter(itemId => itemId === recipe.output.itemId).length +
      instances.filter(instance => instance.itemId === recipe.output.itemId).length;
  }
  if (recipe.output.type === "fuel") return ResourceRegistry.get(state, "consumable:fuel");
  return getAmmoCount(state, recipe.output.weapon);
}

function getEquipmentMaxCyclesFromState(state, recipe) {
  let max = Infinity;
  for (const [material, quantity] of Object.entries(recipe.cost || {})) {
    max = Math.min(max, Math.floor(getMaterialStockFromState(state, material) / quantity));
  }
  if (recipe.inputEquipment) {
    const itemId = recipe.inputEquipment.itemId;
    const quantity = Math.max(1, Number(recipe.inputEquipment.quantity) || 1);
    const level = getEquipEngInputLevelFromState(state, recipe);
    const groups = getGroupedInputEquipmentCandidates(state, itemId);
    const available = groups[level] || 0;
    max = Math.min(max, Math.floor(available / quantity));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

function getActionConfirmationDisplayState(state, target, now) {
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipComp:"🔩", shipAsm:"⚓", equipmentEngineering:"🔧" };
  const result = {
    kind:"actionConfirmation",
    target,
    title:"",
    duration:1,
    outputText:"",
    requirements:[],
    maxCount:999999,
    unlimited:true,
    canOpen:true,
    blockedText:"",
    queue:null
  };

  if (target === "mining") {
    const display = getMiningDisplayState(state, now);
    result.title = icons.mining + " " + (SKILL_LABEL.mining || "采矿");
    result.duration = display.actualTime;
    result.outputText = getResourceDisplayName(display.current.ore) + "×1";
    result.canOpen = display.canStart;
    result.blockedText = display.requirement.text;
    result.queue = { skill:"mining", target:display.current.name, label:getResourceDisplayName(display.current.ore) };
  } else if (target === "refining") {
    const display = getSmeltingDisplayState(state, now);
    const recipe = display.current;
    result.title = icons.refining + " " + (SKILL_LABEL.refining || "冶炼");
    result.duration = display.actualTime;
    result.outputText = getResourceDisplayName(recipe.outputMineral) + "×" + display.output;
    result.requirements = [{ resourceId:"ore:" + recipe.consumeOre, name:getResourceDisplayName(recipe.consumeOre), quantity:1, stock:display.stock, enough:display.stock >= 1 }];
    // 超量预排：放开“按当前材料算上限”的硬限制，数量可超过当前持有；
    // 运行期由队列 skipOnFail 在材料不足时切下一项（当前项保留、剩余数量续跑）。
    result.maxCount = 99999999;
    result.unlimited = true;
    result.noCap = true;
    result.materialHint = Math.max(0, display.stock);
    result.canOpen = display.canStart;
    result.blockedText = display.canStart ? "" : "需要冶炼等级 Lv." + recipe.level;
    result.queue = { skill:"refining", target:recipe.name, label:getResourceDisplayName(recipe.consumeOre) + "→" + getResourceDisplayName(recipe.outputMineral) };
  } else if (target === "gasHarvesting") {
    const display = getGasDisplayState(state, now);
    result.title = icons.gasHarvesting + " " + (SKILL_LABEL.gasHarvesting || "气体采集");
    result.duration = display.actualTime;
    result.outputText = getResourceDisplayName(display.current.gas) + "×1";
    result.canOpen = display.canStart;
    result.blockedText = display.canStart ? "" : "需要气体采集等级 Lv." + display.current.level;
    result.queue = { skill:"gasHarvesting", target:display.current.name, label:getResourceDisplayName(display.current.gas) };
  } else if (target === "equipmentEngineering") {
    const display = getEquipmentEngineeringDisplayState(state, now, "");
    const recipe = display.selectedRecipe;
    result.title = icons.equipmentEngineering + " " + (SKILL_LABEL.equipmentEngineering || "装备工程");
    result.duration = recipe.time / display.efficiency;
    result.requirements = [
      ...(display.detail.equipmentInputs || []).map(item => ({ resourceId:"equipment:" + item.itemId, name:item.name, quantity:item.quantity, stock:item.stock, enough:item.enough })),
      ...(display.detail.materials || []).map(item => ({ resourceId:ResourceRegistry.resolveMaterialIds(item.material)[0] || item.material, name:item.material, displayName:getResourceDisplayName(item.material), quantity:item.quantity, stock:item.stock, enough:item.enough }))
    ];
    // 超量预排：放开“按当前材料算上限”的硬限制（见 refining 分支说明）。
    result.maxCount = 99999999;
    result.unlimited = true;
    result.noCap = true;
    result.materialHint = Math.max(0, getEquipmentMaxCyclesFromState(state, recipe));
    if (recipe.output.type === "equipment") result.outputText = recipe.name + "×" + recipe.output.qty;
    else if (recipe.output.type === "fuel") result.outputText = "燃料单元×" + recipe.output.qty;
    else result.outputText = ({ laser:"激光晶体弹药", missile:"导弹", cannon:"炮台弹药" }[recipe.output.weapon] || "弹药") + "×" + recipe.output.qty;
    result.canOpen = display.level >= recipe.level && display.detail.hasRequiredBlueprint;
    const blueprintLocked = display.detail.requiresBlueprint && !display.detail.hasRequiredBlueprint;
    result.blockedText = result.canOpen ? "" : blueprintLocked ? "需要先在蓝图商店购买" + recipe.name + "蓝图" : "需要装备工程等级 Lv." + recipe.level;
    result.queue = { skill:"equipmentEngineering", target:recipe.id, label:recipe.name };
  } else if (target === "shipComp") {
    const display = getShipEngineeringDisplayState(state, now);
    const recipe = display.currentComponent;
    result.title = icons.shipComp + " " + recipe.name;
    result.duration = display.componentActualTime; // 唯一周期公式（含船坞倍率）
    result.requirements = (display.componentMaterials || []).map(item => ({ resourceId:ResourceRegistry.resolveMaterialIds(item.material)[0] || item.material, name:item.material, displayName:getResourceDisplayName(item.material), quantity:item.quantity, stock:item.stock, enough:item.enough }));
    const _shipCompMatMax = result.requirements.reduce((max, item) => Math.min(max, Math.floor(item.stock / item.quantity)), 999999);
    // 超量预排：放开“按当前材料算上限”的硬限制（见 refining 分支说明）。
    result.maxCount = 99999999;
    result.unlimited = true;
    result.noCap = true;
    result.materialHint = Math.max(0, _shipCompMatMax);
    result.outputText = recipe.name + "×1";
    result.canOpen = display.canStartComponent;
    result.blockedText = result.canOpen ? "" : "需要舰船工程等级 Lv." + recipe.level;
    result.queue = { skill:"shipEngineering", target:recipe.name, label:recipe.name };
  } else if (target === "shipAsm") {
    const display = getShipEngineeringDisplayState(state, now);
    const recipe = display.currentAssembly;
    result.title = icons.shipAsm + " " + recipe.name;
    result.duration = display.assemblyActualTime; // 唯一周期公式（含船坞倍率）
    result.requirements = [
      ...(display.assemblyComponents || []).map(item => ({ resourceId:"component:" + item.id, name:item.name, quantity:item.quantity, stock:item.stock, enough:item.enough })),
      ...(display.assemblyMaterials || []).map(item => ({ resourceId:item.material, name:item.material, displayName:getResourceDisplayName(item.material), quantity:item.quantity, stock:item.stock, enough:item.enough }))
    ];
    // 缺料时 assemblyMaxCycles 为 0：超量预排放开硬限制（noCap），弹窗不再因缺料禁用“加入队列”，
    // 仅以 materialHint 提示当前可产批数；运行期 skipOnFail 在材料不足时切下一项。
    result.maxCount = 99999999;
    result.unlimited = true;
    result.noCap = true;
    result.materialHint = Math.max(0, display.assemblyMaxCycles);
    result.outputText = (display.selectedShip ? display.selectedShip.name : recipe.name) + "×1";
    // 仅「永久解锁」（蓝图+等级+船坞）才允许打开确认弹窗；缺料不阻止打开，由 maxCount=0 体现。
    result.canOpen = recipe.assemblyUnlocked;
    // 与 getShipAssemblyEligibility 同一判定，禁止自行猜测蓝图状态。
    result.blockedText = recipe.assemblyUnlocked ? "" : (
      recipe.assemblyBlockReason === "blueprint-locked" ? "需要先在蓝图商店购买" + recipe.name + "蓝图"
      : recipe.assemblyBlockReason === "level-locked" ? "需要舰船工程等级 Lv." + recipe.requiredLevel
      : recipe.assemblyBlockReason === "shipyard-level-locked" ? "需要船坞等级 Lv." + (recipe.shipyardRequiredLevel || "?")
      : "当前舰船未解锁"
    );
    result.queue = { skill:"shipEngineering", target:recipe.name, label:recipe.name };
  } else if (target === "archaeology") {
    const archDisplay = getArchaeologyDisplayState(state, now);
    const arch = archDisplay.archaeology;
    const site = archDisplay.sites.find(s => s.id === (arch.active ? (arch.startedSiteId || arch.activeSiteId) : arch.activeSiteId));
    // 共用 canStartArchaeology 校验确保与 Action 层一致
    let canOpen = false, blockedText = "";
    if (!archDisplay.assignedShip || !archDisplay.assignedShip.archaeology) {
      blockedText = "未分配考古舰船";
    } else if (arch.repairing) {
      blockedText = "舰船维修中";
    } else if (arch.interference) {
      blockedText = "信号干扰中";
    } else if (!site || site.locked) {
      blockedText = "请先选择遗迹";
    } else if (typeof canStartArchaeology === "function") {
      // 走真实校验（含燃料/探针）
      const check = canStartArchaeology(state, now);
      canOpen = check.ok;
      if (!canOpen) blockedText = (check.reason === "insufficient-probe" ? "探针不足"
        : check.reason === "insufficient-fuel" ? "燃料不足"
        : check.reason === "level-locked" ? "考古等级不足"
        : check.reason === "no-site" ? "请先选择遗迹"
        : check.reason === "no-archaeology-ship" ? "未分配考古舰船"
        : check.reason === "repairing" ? "舰船维修中"
        : check.reason === "interference" ? "信号干扰中"
        : "无法开始");
    } else {
      canOpen = Boolean(site && !arch.repairing && !arch.interference);
    }
    result.title = "🔍 " + (SKILL_LABEL.archaeology || "考古");
    // 实际周期时间含 archaeologySpeed 增强剂倍率 ÷ 空间站综合后勤倍率
    const archSpeedEff = (typeof getBoosterEffectState === "function")
      ? (getBoosterEffectState(state).archaeologySpeedMultiplier || 1) : 1;
    const archLogisticsMult = (typeof getStationLogisticsMultiplier === "function") ? Math.max(0.001, getStationLogisticsMultiplier(state)) : 1;
    result.duration = site ? site.time * archSpeedEff / archLogisticsMult : 1;
    result.canOpen = canOpen;
    result.blockedText = canOpen ? "" : blockedText;
    result.queue = site ? { skill:"archaeology", target:site.id, label:site.name } : null;
  } else if (target === "boosterEngineering") {
    const display = getBoosterManufacturingDisplayState(state, now);
    const recipe = display.selectedRecipe;
    result.title = "💉 " + (SKILL_LABEL.boosterEngineering || "增强剂制造");
    if (recipe) result.duration = recipe.time / display.efficiency;
    // getBoosterManufacturingDisplayState 不返回 selectedRecipeCosts/detail/maxCount/blockedReason
    // recipe 是 card 对象（displayName 而非 name, 无 .output），使用 materialRows 构建 requirements
    if (recipe && Array.isArray(recipe.materialRows) && recipe.materialRows.length) {
      result.requirements = (recipe.materialRows || []).map(row => ({
        resourceId:row.reference, name:row.displayName || row.reference,
        quantity:row.required, stock:row.stock, enough:row.enough
      }));
    } else {
      result.requirements = [];
    }
    result.maxCount = 999999;
    result.unlimited = true;
    result.canOpen = display.canStart;
    result.blockedText = display.canStart ? "" : (recipe ? ("材料不足或 Lv." + recipe.level + " 解锁") : "请先选择配方");
    result.outputText = recipe ? recipe.displayName + "×1" : "";
    result.queue = recipe ? { skill:"boosterEngineering", target:recipe.id, label:recipe.displayName } : null;
  } else if (target === "combatBelt" || target === "combatDeathspace") {
    const display = getCombatDisplayState(state, now);
    const isDS = target === "combatDeathspace";
    result.title = "⚔ " + (isDS ? "死亡空间" : "星带战斗");
    result.duration = 0;
    result.combat = true;
    result.combatMode = isDS ? "deathspace" : "belt";
    result.outputText = isDS ? (display.deathspace.name + " · 全通约 " + display.deathspace.maxWave + " 波") : ("肃清 " + display.zone.name);
    const reqs = [];
    if (isDS) {
      reqs.push({ name:"战斗等级", quantity:display.deathspace.requiredCL || 1, stock:display.level, enough:display.deathspace.unlocked });
      reqs.push({ name:"已装备武器", quantity:1, stock:display.weapons.length, enough:display.weapons.length > 0 });
      const ticketName = getResourceDisplayName("special:" + display.deathspace.ticketMaterial);
      reqs.push({ name:ticketName, quantity:1, stock:display.deathspace.ticketCount, enough:display.deathspace.ticketCount >= 1 });
    } else {
      reqs.push({ name:"战斗等级", quantity:display.zone.requiredCL || 1, stock:display.level, enough:display.zone.unlocked });
      reqs.push({ name:"已装备武器", quantity:1, stock:display.weapons.length, enough:display.weapons.length > 0 });
    }
    result.requirements = reqs;
    result.maxCount = 99999;
    result.unlimited = true;
    let blockedText = "";
    if (!display.player.hasShip) blockedText = "请先在机库指派战斗舰";
    else if (display.recovery.remaining > 0) blockedText = "维修中 " + display.recovery.remaining + "s";
    else if (display.weapons.length === 0) blockedText = "未安装武器";
    else if (isDS ? !display.deathspace.unlocked : !display.zone.unlocked) blockedText = "需要战斗等级 " + (isDS ? display.deathspace.requiredCL : display.zone.requiredCL);
    else if (isDS && display.deathspace.ticketCount < 1) blockedText = "缺少通行密钥";
    result.canOpen = !blockedText;
    result.blockedText = blockedText;
    result.queue = isDS
      ? { skill:"combat", target:display.deathspace.id, label:display.deathspace.name }
      : { skill:"combat", target:display.zone.id, label:display.zone.name };
  } else {
    result.canOpen = false;
    result.blockedText = "未知行动";
  }

  result.hasResources = result.requirements.every(item => item.enough);
  return result;
}

// ---- Phase 3C-6 第八轮：舰船工程唯一周期公式（在线 tick / 离线 offline / 显示态共用）----
// duration = recipe.time / skillMultiplier / shipyardMultiplier
// skillMultiplier = 1 + shipEngineering.lvl × 0.02；shipyardMultiplier = getShipyardSpeedMultiplier(state)（断油仍生效）
// fail closed：任一倍率非有限正数回退 ×1；base 非有限正数回退 1，绝不产生 NaN/Infinity
// 注意：只含速度倍率，材料节省率（getShipyardSavingRate）绝不混入此公式
// 研究批次 G：kind = "component" | "assembly" 时追加科研乘子（组件只吃 shipComp，总装只吃 shipAsm，
// 两者共享 allMfg 根加成但互不串味）；kind 省略时科研乘子为 1，保持既有调用点行为不变。
function getShipEngineeringSpeedBreakdown(state, kind) {
  const lvl = state && state.skills && state.skills.shipEngineering ? Number(state.skills.shipEngineering.lvl) : NaN;
  let skillMultiplier = 1 + lvl * 0.02;
  if (!Number.isFinite(skillMultiplier) || skillMultiplier <= 0) skillMultiplier = 1;
  let shipyardMultiplier = (typeof getShipyardSpeedMultiplier === "function") ? Number(getShipyardSpeedMultiplier(state)) : 1;
  if (!Number.isFinite(shipyardMultiplier) || shipyardMultiplier <= 0) shipyardMultiplier = 1;
  let stationLogisticsMultiplier = (typeof getStationLogisticsMultiplier === "function") ? Number(getStationLogisticsMultiplier(state, "shipEng")) : 1;
  if (!Number.isFinite(stationLogisticsMultiplier) || stationLogisticsMultiplier <= 0) stationLogisticsMultiplier = 1;
  let researchMultiplier = 1;
  if (typeof ResearchState !== "undefined" && (kind === "component" || kind === "assembly")) {
    researchMultiplier = Number(ResearchState.getResearchMultiplier(state, kind === "component" ? ["allMfg", "shipComp"] : ["allMfg", "shipAsm"]));
  }
  if (!Number.isFinite(researchMultiplier) || researchMultiplier <= 0) researchMultiplier = 1;
  return {
    skillMultiplier, shipyardMultiplier, stationLogisticsMultiplier, researchMultiplier,
    totalSpeedMultiplier: skillMultiplier * shipyardMultiplier * stationLogisticsMultiplier * researchMultiplier
  };
}

// 配方类别判定：总装配方带 shipId/componentCost，组件配方只有 cost。
function getShipEngineeringRecipeKind(recipe) {
  return (recipe && (recipe.shipId || recipe.componentCost)) ? "assembly" : "component";
}

function getShipEngineeringCycleDuration(state, recipe) {
  let base = recipe ? Number(recipe.time) : NaN;
  if (!Number.isFinite(base) || base <= 0) base = 1;
  const speed = getShipEngineeringSpeedBreakdown(state, getShipEngineeringRecipeKind(recipe));
  // 脑插·舰船制造增效（死亡空间 6/10 来源）：周期 ÷1.06（效率 +6%）
  const implantShipMfgEff = (typeof getImplantBonuses === "function") ? getImplantBonuses(state).shipMfgEff : 1;
  // 增强剂·舰船工程速度（考古重制 Phase B · 考古蓝图产出）：周期 ÷ 速度乘区
  const boosterShipSpeed = (typeof getBoosterEffectState === "function") ? getBoosterEffectState(state).shipSpeedMultiplier : 1;
  return base / speed.skillMultiplier / speed.shipyardMultiplier / speed.stationLogisticsMultiplier / speed.researchMultiplier / implantShipMfgEff / boosterShipSpeed;
}

// 唯一舰船总装资格判定：与 actions.js 的 startShipAssembly 阻塞优先级完全一致。
// 供 selectors / 渲染层 / 行动确认统一消费，禁止各自重复猜测。
//   1. blueprint-locked  2. level-locked  3. shipyard-level-locked  4. insufficient-components  5. null（可开工）
// assemblyUnlocked 仅表示永久解锁（蓝图 + 技能 + 船坞），不含材料；canStartAssembly 才含材料。
function getShipAssemblyEligibility(state, recipe) {
  const fallback = {
    requiresBlueprint:true, hasRequiredBlueprint:false, levelEnough:false, shipyardEnough:false, hasComponents:false,
    levelGate: recipe ? (Number(recipe.level) || 0) : 0, shipyardRequiredLevel:null,
    assemblyBlockReason:"blueprint-locked", assemblyBlockText:"未解锁：需蓝图解锁",
    assemblyUnlocked:false, canStartAssembly:false
  };
  if (!recipe) return fallback;
  const level = Number((state.skills && state.skills.shipEngineering && state.skills.shipEngineering.lvl) || 1);
  const owned = new Set(state.ownedBlueprints || []);
  // 等级必须使用 getShipBuildingQuote 返回的实际 levelGate（兼容增强剂带来的等级门槛变化）。
  const requiresBlueprint = shipAssemblyRequiresBlueprint(recipe);
  const hasRequiredBlueprint = !requiresBlueprint || owned.has(recipe.shipId);
  const quote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, recipe, { kind:"assembly" }) : { levelGate: Number(recipe.level) || 0 };
  const levelEnough = level >= quote.levelGate;
  // 船坞条件复用 canAssembleAtShipyard，不得复制第二套规则；门槛文本走权威 getShipyardAssemblyLevelRequirement。
  const shipyardEnough = (typeof canAssembleAtShipyard === "function") ? canAssembleAtShipyard(state, recipe.id) : true;
  const shipyardRequiredLevel = (typeof getShipyardAssemblyLevelRequirement === "function") ? getShipyardAssemblyLevelRequirement(state, recipe.id) : null;
  // 材料条件复用 getShipAssemblyMaxCyclesFromState。
  const hasComponents = getShipAssemblyMaxCyclesFromState(state, recipe) > 0;
  let reason = null;
  if (!hasRequiredBlueprint) reason = "blueprint-locked";
  else if (!levelEnough) reason = "level-locked";
  else if (!shipyardEnough) reason = "shipyard-level-locked";
  else if (!hasComponents) reason = "insufficient-components";
  const assemblyUnlocked = hasRequiredBlueprint && levelEnough && shipyardEnough;
  let blockText = "";
  if (reason === "blueprint-locked") blockText = "未解锁：需蓝图解锁";
  else if (reason === "level-locked") blockText = "未解锁：舰船工程 Lv." + quote.levelGate + " 解锁";
  else if (reason === "shipyard-level-locked") blockText = "未解锁：船坞 Lv." + (shipyardRequiredLevel || "?") + " 解锁";
  else if (reason === "insufficient-components") blockText = "组件/材料不足";
  return {
    requiresBlueprint, hasRequiredBlueprint, levelEnough, shipyardEnough, hasComponents,
    levelGate: quote.levelGate, shipyardRequiredLevel,
    assemblyBlockReason: reason, assemblyBlockText: blockText,
    assemblyUnlocked, canStartAssembly: assemblyUnlocked && hasComponents
  };
}

function getShipEngineeringDisplayState(state, now) {
  const action = state.currentAction;
  const skill = state.skills.shipEngineering || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  const speed = getShipEngineeringSpeedBreakdown(state);
  // 研究批次 G：组件线 / 总装线各自的完整速度分解（含独立科研乘子），供显示与校验消费
  const componentSpeed = getShipEngineeringSpeedBreakdown(state, "component");
  const assemblySpeed = getShipEngineeringSpeedBreakdown(state, "assembly");
  const currentComponent = SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === action.shipCompTarget) || SHIP_COMPONENT_RECIPES[0];
  const runningComponent = SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === (action.startedShipCompTarget || action.shipCompTarget)) || currentComponent;
  const currentAssembly = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === action.shipAsmTarget) || SHIP_ASSEMBLY_RECIPES[0];
  const runningAssembly = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.id === (action.startedShipAsmTarget || action.shipAsmTarget)) || currentAssembly;
  // 精密配给剂权威报价（不复制公式）：组件/总装成本与等级门槛统一由此读取，供 UI 显示 / 启动判断一致。
  const compQuote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, currentComponent, { kind:"component" }) : { cost: currentComponent.cost, levelGate: currentComponent.level };
  const asmQuote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, currentAssembly, { kind:"assembly" }) : { cost: currentAssembly.materialCost || {}, levelGate: currentAssembly.level };
  const runningCompQuote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, runningComponent, { kind:"component" }) : { cost: runningComponent.cost, levelGate: runningComponent.level };
  const runningAsmQuote = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, runningAssembly, { kind:"assembly" }) : { cost: runningAssembly.materialCost || {}, levelGate: runningAssembly.level };
  // 当前总装每周期有效成本（仅精密配给剂折扣；船坞材料节省仅作用于部件制造，总装不再享受）。
  const asmEffective = (function () {
    const discounted = (typeof getDiscountedAssemblyRecipe === "function") ? getDiscountedAssemblyRecipe(state, currentAssembly) : Object.assign({}, currentAssembly, { materialCost: asmQuote.cost });
    return { materials: discounted.materialCost || {}, components: getShipAssemblyComponentCost(currentAssembly) };
  })();
  const active = Boolean(action.active && action.skill === "shipEngineering");
  const componentActive = active && action.shipSubAction === "component";
  const assemblyActive = active && action.shipSubAction === "assembly";
  // 唯一周期公式：显示态（进度条/ETA/弹窗）与在线 tick、离线 descriptor 完全一致
  const componentActualTime = getShipEngineeringCycleDuration(state, currentComponent);
  const assemblyActualTime = getShipEngineeringCycleDuration(state, currentAssembly);
  const runningComponentDuration = getShipEngineeringCycleDuration(state, runningComponent);
  const runningAssemblyDuration = getShipEngineeringCycleDuration(state, runningAssembly);
  const componentProgress = componentActive
    ? getProgressDisplayState(action, "shipEngineering", runningComponentDuration, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:runningComponentDuration };
  const assemblyProgress = assemblyActive
    ? getProgressDisplayState(action, "shipEngineering", runningAssemblyDuration, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:runningAssemblyDuration };
  const ownedBlueprints = new Set(state.ownedBlueprints || []);
  const componentInventory = Object.fromEntries(ResourceRegistry.listStateEntries(state, "component").map(entry => [entry.definition.key, entry.quantity]));
  const selectedShip = getShipConfigById(currentAssembly.shipId);
  const shipCounts = {};
  for (const instance of (state.inventory && state.inventory.ships) || []) shipCounts[instance.shipId] = (shipCounts[instance.shipId] || 0) + 1;

  // ---- 舰船工程 UI 重做（2026-08-04）：一级视图 / 二级标签 / 栅格 / 分页 展示字段 ----
  const subView = action.shipEngSubView || "component";
  const compClass = action.shipCompClass || "integrated";
  const asmLine = action.shipAsmLine || "shield_laser";
  let asmPage = Number.isInteger(action.shipAsmPage) ? action.shipAsmPage : 0;

  const componentClassTabs = SHIP_COMPONENT_CLASSES.map(item => ({ ...item, selected:item.id === compClass }));
  const assemblyLineTabs = SHIP_ASSEMBLY_LINES.map(item => ({ ...item, selected:item.id === asmLine }));

  const componentGrid = SHIP_COMPONENT_RECIPES
    .filter(recipe => getShipComponentClass(recipe.id) === compClass)
    .map(recipe => {
      const cq = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, recipe, { kind:"component" }) : { cost: recipe.cost, levelGate: recipe.level };
      const savingRate = (typeof getShipyardSavingRate === "function") ? getShipyardSavingRate(state) : 0;
      const shipyardOn = savingRate > 0;
      const payable = shipyardOn ? getShipyardProductionQuote(state, { materialCost: cq.cost }, 1).payable : cq.cost;
      return {
        id:recipe.id, name:recipe.name, level:recipe.level, time:recipe.time, xp:recipe.xp,
        shipyardSavingRate: savingRate,
        cost:Object.entries(payable).map(([material, quantity]) => {
          const stock = getMaterialStockFromState(state, material);
          return { material, quantity, baseQuantity: cq.cost[material] != null ? cq.cost[material] : quantity, stock, enough:stock >= quantity };
        }),
        owned:Number(componentInventory[recipe.id]) || 0,
        unlocked:level >= cq.levelGate,
        requiredLevel:cq.levelGate,
        selected:recipe.id === currentComponent.id
      };
    });

  // 单一资格判定源：同一配方在本轮 display 构建中只计算一次（缓存），杜绝第二套 reason 优先级
  // 导致船坞节省余数/增强剂/状态变化引发的字段不一致。assemblyMatched / assemblyGrid /
  // assemblyOptions / currentAssembly / canStartAssembly 全部消费 getShipAssemblyEligibility。
  const _eligibilityCache = new Map();
  const getAssemblyEligibility = (recipe) => {
    if (!_eligibilityCache.has(recipe.id)) {
      _eligibilityCache.set(recipe.id, getShipAssemblyEligibility(state, recipe));
    }
    return _eligibilityCache.get(recipe.id);
  };
  const assemblyMatched = SHIP_ASSEMBLY_RECIPES
    .map(recipe => {
      const el = getAssemblyEligibility(recipe);
      return {
        recipe,
        requiresBlueprint:el.requiresBlueprint,
        hasRequiredBlueprint:el.hasRequiredBlueprint,
        levelGate:el.levelGate,
        levelEnough:el.levelEnough,
        shipyardEnough:el.shipyardEnough,
        shipyardRequiredLevel:el.shipyardRequiredLevel,
        hasComponents:el.hasComponents,
        assemblyUnlocked:el.assemblyUnlocked,
        assemblyBlockReason:el.assemblyBlockReason,
        unlocked:el.assemblyUnlocked,
        line:getShipAssemblyLine(recipe.shipId),
        role:getShipRoleName(recipe.shipId),
        tier:(getShipConfigById(recipe.shipId) || {}).tier,
        hybrid:SHIP_HYBRID_IDS.has(recipe.shipId)
      };
    })
    .filter(item => item.line === asmLine);
  const assemblyPageCount = Math.max(1, Math.ceil(assemblyMatched.length / SHIP_ASSEMBLY_PAGE_SIZE));
  const assemblyPageClamped = Math.min(Math.max(0, asmPage), assemblyPageCount - 1);
  const assemblyGrid = assemblyMatched
    .slice(assemblyPageClamped * SHIP_ASSEMBLY_PAGE_SIZE, assemblyPageClamped * SHIP_ASSEMBLY_PAGE_SIZE + SHIP_ASSEMBLY_PAGE_SIZE)
    .map(item => ({
      id:item.recipe.id, name:item.recipe.name, shipId:item.recipe.shipId, level:item.recipe.level, time:item.recipe.time, xp:item.recipe.xp,
      requiresBlueprint:item.requiresBlueprint, hasRequiredBlueprint:item.hasRequiredBlueprint, unlocked:item.assemblyUnlocked, requiredLevel:item.levelGate,
      shipyardRequiredLevel:item.shipyardRequiredLevel, hasComponents:item.hasComponents, assemblyBlockReason:item.assemblyBlockReason,
      selected:item.recipe.id === currentAssembly.id, role:item.role, tier:item.tier, hybrid:item.hybrid
    }));
  const shipRole = getShipRoleName(currentAssembly.shipId);
  const shipFlavor = selectedShip ? selectedShip.flavor : "";
  const hybridSelected = SHIP_HYBRID_IDS.has(currentAssembly.shipId);

  return {
    kind:"shipEngineering",
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    efficiency: (subView === "assembly" ? assemblySpeed : componentSpeed).totalSpeedMultiplier,
    skillMultiplier:speed.skillMultiplier,
    shipyardMultiplier:speed.shipyardMultiplier,
    stationLogisticsMultiplier:speed.stationLogisticsMultiplier,
    stationLogistics: (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(state) : null,
    totalSpeedMultiplier:speed.totalSpeedMultiplier,
    componentResearchMultiplier:componentSpeed.researchMultiplier,
    assemblyResearchMultiplier:assemblySpeed.researchMultiplier,
    componentTotalSpeedMultiplier:componentSpeed.totalSpeedMultiplier,
    assemblyTotalSpeedMultiplier:assemblySpeed.totalSpeedMultiplier,
    componentActualTime,
    assemblyActualTime,
    active,
    status:active ? "进行中" : "待命",
    componentActive,
    assemblyActive,
    componentProgress,
    assemblyProgress,
    blueprints:SHIP_BLUEPRINTS.map(blueprint => ({
      ...blueprint,
      owned:ownedBlueprints.has(blueprint.shipId),
      canBuy:!ownedBlueprints.has(blueprint.shipId) && ResourceRegistry.get(state, "currency:" + (blueprint.costLP ? "lp" : "isk")) >= (blueprint.costLP || blueprint.costISK || 0)
    })),
    currentComponent:{ ...currentComponent, cost: compQuote.cost, requiredLevel: compQuote.levelGate },
    runningComponent:{ ...runningComponent, requiredLevel: runningCompQuote.levelGate },
    componentOptions:SHIP_COMPONENT_RECIPES.map(recipe => {
      const q = (typeof getShipBuildingQuote === "function") ? getShipBuildingQuote(state, recipe, { kind:"component" }) : { levelGate:recipe.level };
      return { ...recipe, unlocked:level >= q.levelGate, selected:recipe.id === currentComponent.id };
    }),
    componentMaterials:Object.entries(compQuote.cost).map(([material, quantity]) => {
      const stock = getMaterialStockFromState(state, material);
      return { material, quantity, stock, enough:stock >= quantity };
    }),
    componentInventory:SHIP_COMPONENT_RECIPES.map(recipe => ({ id:recipe.id, name:recipe.name, quantity:Number(componentInventory[recipe.id]) || 0 })),
    componentDismantle:{
      reclaimRate:getReclaimRate(state),
      reclaimPercent:Math.round(getReclaimRate(state) * 100)
    },
    currentAssembly:(function () {
      const el = getAssemblyEligibility(currentAssembly);
      return {
        ...currentAssembly,
        componentCost:{ ...getShipAssemblyComponentCost(currentAssembly) },
        materialCost:{ ...asmQuote.cost },
        requiredLevel: asmQuote.levelGate,
        requiresBlueprint:el.requiresBlueprint,
        hasRequiredBlueprint:el.hasRequiredBlueprint,
        levelEnough:el.levelEnough,
        shipyardEnough:el.shipyardEnough,
        shipyardRequiredLevel:el.shipyardRequiredLevel,
        hasComponents:el.hasComponents,
        assemblyBlockReason:el.assemblyBlockReason,
        assemblyBlockText:el.assemblyBlockText,
        assemblyUnlocked:el.assemblyUnlocked
      };
    })(),
    runningAssembly:{ ...runningAssembly, componentCost:{ ...getShipAssemblyComponentCost(runningAssembly) }, materialCost:{ ...runningAsmQuote.cost }, requiredLevel: runningAsmQuote.levelGate },
    assemblyOptions:SHIP_ASSEMBLY_RECIPES.map(recipe => {
      const el = getAssemblyEligibility(recipe);
      return {
        ...recipe,
        requiresBlueprint:el.requiresBlueprint,
        hasRequiredBlueprint:el.hasRequiredBlueprint,
        levelEnough:el.levelEnough,
        shipyardEnough:el.shipyardEnough,
        shipyardRequiredLevel:el.shipyardRequiredLevel,
        hasComponents:el.hasComponents,
        unlocked:el.assemblyUnlocked,
        assemblyBlockReason:el.assemblyBlockReason,
        assemblyBlockText:el.assemblyBlockText,
        selected:recipe.id === currentAssembly.id
      };
    }),
    assemblyComponents:Object.entries(asmEffective.components).map(([componentId, quantity]) => {
      const info = SHIP_COMPONENT_RECIPES.find(recipe => recipe.id === componentId);
      const stock = Number(componentInventory[componentId]) || 0;
      return { id:componentId, name:info ? info.name : componentId, quantity, stock, enough:stock >= quantity };
    }),
    assemblyMaterials:Object.entries(asmEffective.materials).map(([material, quantity]) => {
      const stock = getMaterialStockFromState(state, material);
      return { material, quantity, stock, enough:stock >= quantity };
    }),
    assemblyMaxCycles:getShipAssemblyMaxCyclesFromState(state, currentAssembly),
    canStartComponent:level >= compQuote.levelGate,
    canStartAssembly:getAssemblyEligibility(currentAssembly).canStartAssembly,
    selectedShip:selectedShip ? { ...selectedShip, hp:{ ...selectedShip.hp }, slots:{ ...selectedShip.slots }, bonuses:{ ...selectedShip.bonuses }, capacitor:{ ...selectedShip.capacitor } } : null,
    ownedShips:Object.entries(shipCounts).map(([shipId, quantity]) => {
      const config = getShipConfigById(shipId);
      return { shipId, quantity, name:config ? config.name : shipId, hp:config ? { ...config.hp } : null };
    }),
    subView,
    componentClassTabs,
    assemblyLineTabs,
    componentGrid,
    assemblyGrid,
    assemblyPage:assemblyPageClamped,
    assemblyPageCount,
    assemblyTotal:assemblyMatched.length,
    shipRole,
    shipFlavor,
    hybridSelected
  };
}

function getShipEngineeringSpeedBreakdownText(display) {
  const sl = display.stationLogistics || {};
  const sm = Number(display.skillMultiplier || display.efficiency) || 1;
  const ym = Number(display.shipyardMultiplier) || 1;
  const lm = Number(sl.multiplier) || 1;
  const total = Number(display.efficiency) || (sm * ym * lm);
  const parts = ["技能 ×" + sm.toFixed(2), "船坞 ×" + ym.toFixed(2)];
  const logPart = (sl.bodyLevel > 0 && sl.operational)
    ? "后勤 ×" + lm.toFixed(2) + "（+" + Math.round((lm - 1) * 100) + "%）"
    : "后勤 ×" + lm.toFixed(2) + "（" + (sl.text || "未建立") + "）";
  parts.push(logPart);
  return parts.join(" · ") + " · 最终 ×" + total.toFixed(2);
}

function getEquipmentEngineeringDisplayState(state, now, searchTerm) {
  const action = state.currentAction;
  const skill = state.skills.equipmentEngineering || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  // 研究批次 G：装备工程科研唯一乘子 = 1 + (allMfg + equip)；与 tick/离线的 getEquipEngEfficiency 同一 API、同一结果
  const researchMultiplier = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(state, ["allMfg", "equip"]) : 1;
  const efficiency = (1 + level * 0.02) * getStationLogisticsMultiplier(state, "equipEng") * researchMultiplier;
  const requestedRecipe = getEquipmentEngineeringRecipe(action.equipEngTarget || "t1_mining_laser");
  const savedCategory = EQUIPMENT_ENGINEERING_CATEGORIES.find(category => category.id === action.equipEngCategory);
  const category = savedCategory || getEquipEngCategoryDefinition(requestedRecipe.category);
  const normalizedSearch = String(searchTerm || "").trim().toLocaleLowerCase();
  const categoryRecipes = EQUIPMENT_ENGINEERING_RECIPES.filter(recipe => recipe.category === category.id);
  // 改装件二级筛选：按 9 个系列（stackGroup）单选，默认第一个系列。
  // 筛选计算全部在显示态层完成，UI 只消费结果，不在 DOM 层临时隐藏。
  const isRigCategory = category.id === "rigs";
  const rigSeries = isRigCategory
    ? (RIG_ENGINEERING_SERIES.find(s => s.id === action.equipEngRigSeries) || RIG_ENGINEERING_SERIES[0])
    : null;
  const filteredRecipes = isRigCategory
    ? categoryRecipes.filter(recipe => recipe.stackGroup === rigSeries.id)
    : categoryRecipes;
  const visibleRecipes = filteredRecipes.filter(recipe => !normalizedSearch || recipe.name.toLocaleLowerCase().includes(normalizedSearch));
  // 改装件页：切换分类/档位/搜索时详情自动落到第一个可见配方（不影响其他类别既有行为）
  const selectionPool = isRigCategory ? (visibleRecipes.length ? visibleRecipes : filteredRecipes) : categoryRecipes;
  const selectedRecipe = selectionPool.find(recipe => recipe.id === requestedRecipe.id) ||
    selectionPool.find(recipe => level >= recipe.level) || selectionPool[0] || categoryRecipes[0] || requestedRecipe;
  const active = Boolean(action.active && action.skill === "equipmentEngineering");
  const runningRecipe = getEquipmentEngineeringRecipe(action.startedEquipEngTarget || action.equipEngTarget || "t1_mining_laser");
  const progress = active
    ? getProgressDisplayState(action, "equipmentEngineering", runningRecipe.time / efficiency, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:runningRecipe.time / efficiency };
  const selectedEquipment = selectedRecipe.output.type === "equipment" ? EQUIPMENT_DB[selectedRecipe.output.itemId] : null;
  const selectedHasRequiredBlueprint = equipmentRecipeHasRequiredBlueprint(state, selectedRecipe);
  const detailMaterials = Object.entries(selectedRecipe.cost || {}).map(([material, quantity]) => {
    const stock = getMaterialStockFromState(state, material);
    // material 保留内部键（namespace:itemId 或中文名），displayName 供 UI 展示（内部键解析为真实中文名）
    return { material, displayName:getResourceDisplayName(material), quantity, stock, enough:stock >= quantity };
  });
  const detailEquipmentInputs = selectedRecipe.inputEquipment ? (() => {
    const item = EQUIPMENT_DB[selectedRecipe.inputEquipment.itemId];
    const quantity = Math.max(1, Number(selectedRecipe.inputEquipment.quantity) || 1);
    const groups = getGroupedInputEquipmentCandidates(state, selectedRecipe.inputEquipment.itemId);
    const levels = Object.keys(groups).map(Number).sort((a, b) => a - b);
    const chosenLevel = getEquipEngInputLevelFromState(state, selectedRecipe);
    return {
      itemId:selectedRecipe.inputEquipment.itemId,
      name:item ? item.name : selectedRecipe.inputEquipment.itemId,
      quantity,
      total:levels.reduce((s, l) => s + groups[l], 0),
      chosenLevel,
      groups:levels.map(level => ({
        level,
        count:groups[level],
        outputLevel:getEquipEngInputInheritance(level),
        enough:groups[level] >= quantity
      }))
    };
  })() : null;

  return {
    kind:"equipmentEngineering",
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    efficiency,
    stationLogisticsMultiplier: getStationLogisticsMultiplier(state),
    stationLogistics: (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(state) : null,
    stationLogisticsBonusRate: getStationLogisticsMultiplier(state) - 1,
    researchMultiplier,
    active,
    status:active ? "进行中" : "待命",
    progress,
    searchTerm:String(searchTerm || ""),
    category:{ ...category },
    categories:EQUIPMENT_ENGINEERING_CATEGORIES.map(item => ({ ...item, selected:item.id === category.id })),
    rigFilters:isRigCategory ? {
      series:rigSeries.id,
      seriesList:RIG_ENGINEERING_SERIES.map(s => ({ id:s.id, name:s.name, rigCategory:s.rigCategory, selected:s.id === rigSeries.id }))
    } : null,
    visibleCount:visibleRecipes.length,
    selectedRecipe:{ ...selectedRecipe, cost:{ ...(selectedRecipe.cost || {}) }, inputEquipment:selectedRecipe.inputEquipment ? { ...selectedRecipe.inputEquipment } : null, output:{ ...selectedRecipe.output }, unlocked:level >= selectedRecipe.level && selectedHasRequiredBlueprint, hasRequiredBlueprint:selectedHasRequiredBlueprint },
    runningRecipe:{ ...runningRecipe, cost:{ ...(runningRecipe.cost || {}) }, inputEquipment:runningRecipe.inputEquipment ? { ...runningRecipe.inputEquipment } : null, output:{ ...runningRecipe.output } },
    recipes:visibleRecipes.map(recipe => {
      const equipment = recipe.output.type === "equipment" ? EQUIPMENT_DB[recipe.output.itemId] : null;
      const attributes = equipment
        ? (equipment.slot === "rig" && equipment.effectSummary
            ? equipment.effectSummary
            : getEquipmentAttributeLines(equipment).slice(1, 3).join(" · "))
        : getEquipEngOutputText(recipe).replace("产出：", "");
      const slot = equipment ? (EQUIPMENT_SLOT_NAMES[equipment.slot] || "装备") : recipe.output.type === "fuel" ? "消耗品" : "弹药";
      return {
        id:recipe.id,
        name:recipe.name,
        level:recipe.level,
        xp:recipe.xp,
      tier:getEquipEngTierLabel(recipe),
        icon:getEquipEngRecipeIcon(recipe),
        slot,
        attributes:attributes || "基础制造配方",
        requiresBlueprint:Boolean(recipe.requiresBlueprint),
        hasRequiredBlueprint:equipmentRecipeHasRequiredBlueprint(state, recipe),
        unlocked:level >= recipe.level && equipmentRecipeHasRequiredBlueprint(state, recipe),
        selected:recipe.id === selectedRecipe.id,
        actualTime:recipe.time / efficiency,
        ownedCount:getEquipmentOwnedCountFromState(state, recipe)
      };
    }),
    detail:{
      title:selectedRecipe.name,
      tier:getEquipEngTierLabel(selectedRecipe),
      equipment:selectedEquipment ? { id:selectedEquipment.id, name:selectedEquipment.name } : null,
      attributes:selectedEquipment
        ? (selectedEquipment.slot === "rig" && selectedEquipment.effectSummary
            ? [selectedEquipment.effectSummary]
            : getEquipmentAttributeLines(selectedEquipment))
        : [],
      materials:detailMaterials,
      equipmentInputs:detailEquipmentInputs,
      outputText:getEquipEngOutputText(selectedRecipe),
      actualTime:selectedRecipe.time / efficiency,
      baseTime:selectedRecipe.time,
      xp:selectedRecipe.xp,
      requiresBlueprint:Boolean(selectedRecipe.requiresBlueprint),
      hasRequiredBlueprint:selectedHasRequiredBlueprint,
      maxCycles:getEquipmentMaxCyclesFromState(state, selectedRecipe),
      runningNote:active ? { name:runningRecipe.name, targetDiffers:runningRecipe.id !== selectedRecipe.id } : null
    },
    canStart:level >= selectedRecipe.level && selectedHasRequiredBlueprint,
    queue:{
      count:state.queue && Array.isArray(state.queue.items) ? state.queue.items.length : 0,
      maxSize:state.queue && state.queue.config ? state.queue.config.maxSize : 20
    }
  };
}

/* ================================================================
   增强剂制造纯显示态 — Phase 2A（§九）
   制造页只消费此状态：技能信息 / 分类标签 / 品质筛选 / 配方卡片 /
   制造控制 / 库存区。不含六槽装备、计时消耗、效果应用（Phase 2B）。
   ================================================================ */
function getBoosterManufacturingDisplayState(state, now) {
  const action = state.currentAction;
  const skill = state.skills.boosterEngineering || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpRequired = xpForLevel(level + 1);
  // 研究批次 G：增强剂制造科研唯一乘子 = 1 + (allMfg + booster)；与 tick/离线的 getBoosterEfficiency 同一 API、同一结果
  const researchMultiplier = (typeof ResearchState !== "undefined")
    ? ResearchState.getResearchMultiplier(state, ["allMfg", "booster"]) : 1;
  const efficiency = (1 + level * 0.02) * getStationLogisticsMultiplier(state, "booster") * researchMultiplier;

  // 分类与品质筛选（用户选择；运行中切换不改变正在制造的产物）。
  const categoryId = (BOOSTER_CATEGORY_META.find(c => c.id === action.boosterCategory) || BOOSTER_CATEGORY_META[0]).id;
  const qualityFilter = ["all", "n", "r", "l"].includes(action.boosterQualityFilter) ? action.boosterQualityFilter : "all";

  const isRunning = Boolean(action.active && action.skill === "boosterEngineering");
  const selectedRecipe = getBoosterRecipe(action.boosterRecipeTarget) || BOOSTER_RECIPES[0];
  const runningRecipe = getBoosterRecipe(action.startedBoosterRecipeTarget || action.boosterRecipeTarget) || selectedRecipe;
  const progress = isRunning
    ? getProgressDisplayState(action, "boosterEngineering", runningRecipe.time / efficiency, now)
    : { active:false, elapsed:0, percent:0, etaSeconds:null, etaText:"0s", duration:selectedRecipe.time / efficiency };

  const inventory = (state.boosters && state.boosters.inventory) || {};

  const filteredRecipes = BOOSTER_RECIPES.filter(recipe => {
    const series = BOOSTER_SERIES[recipe.series];
    if (!series || series.category !== categoryId) return false;
    if (qualityFilter !== "all" && recipe.quality !== qualityFilter) return false;
    return true;
  });

  const recipes = filteredRecipes.map(recipe => {
    const item = BOOSTER_ITEMS[recipe.id] || {};
    // 考古重做：requiresBlueprint 配方（新增 24 张）需对应蓝图（state.ownedBlueprints 的 "booster:<id>"）解锁；
    // 既有 30 张无此标记，仅受等级限制。显示层必须与动作层 isBoosterRecipeUnlocked 保持一致，否则会出现"直解锁却造不出"。
    const requiresBlueprint = !!recipe.requiresBlueprint;
    const hasRequiredBlueprint = !requiresBlueprint ||
      (typeof hasBoosterBlueprintFromState === "function" ? hasBoosterBlueprintFromState(state, recipe.id) : true);
    const levelUnlocked = level >= recipe.level;
    const isUnlocked = levelUnlocked && hasRequiredBlueprint;
    const materialRows = Object.entries(recipe.cost || {}).map(([reference, quantity]) => {
      const required = Math.max(1, Number(quantity) || 1);
      const stock = ResourceRegistry.getMaterialStock(state, reference);
      return { reference, displayName:getResourceDisplayName(reference), required, stock, enough:stock >= required };
    });
    const hasMaterials = materialRows.every(row => row.enough);
    // 库存按裸 id 键存于 state.boosters.inventory（ResourceRegistry 命名空间去前缀），经 ResourceRegistry.get 统一寻址
    const owned = Number(ResourceRegistry.get(state, recipe.itemId) || 0) || 0;
    let lockedReason = "";
    if (!levelUnlocked) lockedReason = "需要增强剂制造 Lv." + recipe.level;
    else if (!hasRequiredBlueprint) lockedReason = "需要蓝图（考古掉落）";
    else if (!hasMaterials) lockedReason = "材料不足";
    return {
      id:recipe.id,
      itemId:recipe.itemId,
      displayName:item.name || recipe.id,
      seriesName:item.seriesName || "",
      qualityName:item.qualityName || "",
      category:item.category || categoryId,
      level:recipe.level,
      xp:recipe.xp,
      time:recipe.time,
      effectiveTime:recipe.time / efficiency,
      durationSeconds:Math.round((recipe.durationMs || BOOSTER_DURATION_MS) / 1000),
      effectText:(typeof describeBoosterEffect === "function") ? describeBoosterEffect(recipe.effect.type, recipe.effect.value) : "",
      materialRows,
      required:materialRows.reduce((sum, row) => sum + row.required, 0),
      owned,
      stock:owned,
      isUnlocked,
      hasMaterials,
      requiresBlueprint,
      hasRequiredBlueprint,
      canManufacture:isUnlocked && hasMaterials,
      lockedReason,
      selected:recipe.id === selectedRecipe.id,
      running:isRunning && recipe.id === runningRecipe.id
    };
  });

  // 库存卡片：所有已拥有增强剂（跨分类展示），按中文名排序。
  const inventoryCards = Object.keys(inventory)
    .map(key => {
      const item = getBoosterItem(key);
      const qty = Number(inventory[key] || 0) || 0;
      if (!item || qty <= 0) return null;
      return {
        itemId:item.itemId,
        id:item.id,
        displayName:item.name,
        seriesName:item.seriesName,
        qualityName:item.qualityName,
        category:item.category,
        quantity:qty,
        durationSeconds:Math.round((item.durationMs || BOOSTER_DURATION_MS) / 1000),
        effectText:(typeof describeBoosterEffect === "function") ? describeBoosterEffect(item.effectType, item.effectValue) : ""
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hans-CN"));

  const selectedCard = recipes.find(r => r.selected) || null;
  let statusText;
  if (isRunning) {
    const runItem = BOOSTER_ITEMS[runningRecipe.id];
    statusText = "正在制造：" + (runItem ? runItem.name : runningRecipe.id) + "（" + progress.percent + "%）";
  } else if (selectedCard && !selectedCard.canManufacture) {
    statusText = selectedCard.lockedReason || "待命";
  } else {
    statusText = "待命";
  }

  return {
    kind:"boosterEngineering",
    skill:"boosterEngineering",
    level,
    xp,
    xpRequired,
    xpPercent:Math.min(100, Math.floor(xp / xpRequired * 100)),
    efficiency,
    stationLogisticsMultiplier: getStationLogisticsMultiplier(state),
    stationLogistics: (typeof getStationLogisticsDisplayState === "function") ? getStationLogisticsDisplayState(state) : null,
    stationLogisticsBonusRate: getStationLogisticsMultiplier(state) - 1,
    researchMultiplier,
    isRunning,
    status:isRunning ? "进行中" : "待命",
    statusText,
    progress,
    progressPercent:progress.percent,
    remainingSeconds:progress.etaSeconds,
    category:categoryId,
    categories:BOOSTER_CATEGORY_META.map(c => ({ id:c.id, name:c.name, selected:c.id === categoryId })),
    qualityFilter,
    qualityFilters:[{ id:"all", name:"全部" }, { id:"n", name:"普通" }, { id:"r", name:"精工" }, { id:"l", name:"传奇" }]
      .map(q => ({ ...q, selected:q.id === qualityFilter })),
    selectedRecipeId:selectedRecipe.id,
    runningRecipeId:isRunning ? runningRecipe.id : null,
    selectedRecipe:selectedCard,
    canStart:Boolean(selectedCard && selectedCard.canManufacture),
    recipes,
    inventoryCards,
  };
}

function getCombatSkillLevelFromState(state, key) {
  return Number(state && state.skills && state.skills[key] && state.skills[key].lvl) || 1;
}

function getActiveCombatShipState(state) {
  const ships = state && state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  const assignedRef = state && state.shipAssignments ? state.shipAssignments.combat : null;
  const activeRef = state && state.combat ? state.combat.activeShip : null;
  const instance = getShipInstanceFromState(state, assignedRef) || getShipInstanceFromState(state, activeRef) || ships[0] || null;
  // 问题修复：玩家无拥有舰（instance 为 null）时 config 返回 null，不再 fallback 到 STARTER_SHIPS.rifter
  // （旧逻辑会在新存档/无舰时凭空造出"星矛级"幽灵舰，与机库不一致）。无舰时由各显示层按 hasShip 处理。
  const config = instance ? (getShipConfigById(instance.shipId) || STARTER_SHIPS.rifter) : null;
  return { instance, config, fitting:getFittingFromInstance(instance) };
}

function getInstalledCombatModulesFromState(state) {
  const activeShip = getActiveCombatShipState(state);
  const modules = [];
  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of activeShip.fitting[slot]) {
      const resolved = resolveEquipmentReference(state, ref);
      if (!resolved || !resolved.definition || !resolved.definition.combat) continue;
      modules.push({
        id:ref,
        itemId:resolved.itemId,
        instance:resolved.instance,
        name:resolved.definition.name,
        slot,
        enhancementLevel:resolved.enhancementLevel,
        multiplier:resolved.multiplier,
        combat:{ ...resolved.definition.combat },
        bonuses:{ ...(resolved.definition.bonuses || {}) }
      });
    }
  }
  return modules;
}

// 同位素标记打捞臂：汇总已装备打捞臂的 salvageEfficiency 总和（被动放大器，装备即生效，与开关无关）。
// 默认读取出战战斗舰；考古等其它岗位可传入对应舰船实例（该实例直接含 .fitting）。
// 主动打捞（消耗同位素 + 打捞舰船组件）由 combat.js 在 state.combat.salvageArmActive 开启时触发。
function getSalvageEfficiency(state, shipInstance) {
  if (!state) return 0;
  const ship = shipInstance || getActiveCombatShipState(state);
  if (!ship) return 0;
  let fitting = ship.fitting;
  if (!fitting && typeof getFittingFromInstance === "function") fitting = getFittingFromInstance(ship);
  if (!fitting) return 0;
  let total = 0;
  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of fitting[slot] || []) {
      const resolved = resolveEquipmentReference(state, ref);
      const item = resolved && resolved.definition;
      if (item && item.bonuses) total += (item.bonuses.salvageEfficiency || 0) * (resolved.multiplier || 1);
    }
  }
  return total;
}

// 当前出战舰是否装备了打捞臂（用于战斗界面开关显隐）。
// 打捞臂燃料消耗（每击毁一艘）：汇总已装备打捞臂的 salvageFuelPerKill 总和（装备即生效，与开关无关）。
// 主动打捞（state.combat.salvageArmActive）时该基准 ×3，由 combat.js / offline-combat.js 在击毁处应用。
function getSalvageFuelPerKill(state, shipInstance) {
  if (!state) return 0;
  const ship = shipInstance || getActiveCombatShipState(state);
  if (!ship) return 0;
  let fitting = ship.fitting;
  if (!fitting && typeof getFittingFromInstance === "function") fitting = getFittingFromInstance(ship);
  if (!fitting) return 0;
  let total = 0;
  for (const slot of ["high", "mid", "low", "rig"]) {
    for (const ref of fitting[slot] || []) {
      const resolved = resolveEquipmentReference(state, ref);
      const item = resolved && resolved.definition;
      if (item && item.salvageFuelPerKill) total += item.salvageFuelPerKill * (resolved.multiplier || 1);
    }
  }
  return total;
}

function hasSalvageArmEquipped(state) {
  return getSalvageEfficiency(state) > 0;
}

function getCombatLevelFromState(state) {
  return getCombatLevelBreakdownFromState(state).level;
}

function getCombatLevelBreakdownFromState(state) {
  const attack = Math.max(
    getCombatSkillLevelFromState(state, "laserOps"),
    getCombatSkillLevelFromState(state, "cannonOps"),
    getCombatSkillLevelFromState(state, "missileOperations")
  );
  const defense = Math.max(
    getCombatSkillLevelFromState(state, "shieldOperation"),
    getCombatSkillLevelFromState(state, "armorReinforcement"),
    getCombatSkillLevelFromState(state, "hullEngineering")
  );
  return { attack, defense, level:Math.floor((attack + defense) / 2) };
}

// ============================================================================
// 研究批次 H：战斗科研 modifier 的唯一构造器
//   - damageMultiplier / maxHp / repairMultiplier 每个 stat 每次计算最多产出一条
//     source:"research" 的聚合 modifier；绝不给每个 group 单独建一条。
//   - value 直接来自一次 ResearchState.getResearchMultiplier(state, groups)：
//     根加成 + 专精 + tactical 先加法汇总，再一次成乘子，杜绝逐项复利。
//   - 纯派生值：不写入 state.combat.modifiers，不新增任何存档字段。
//   - key 无法识别（未知武器类型 / 未知层）时返回空数组，保持接入前的安全结果。
// ============================================================================
const COMBAT_RESEARCH_PRIORITY = 60;

const COMBAT_RESEARCH_GROUPS = Object.freeze({
  // 武器：laser / missile / cannon 为 WEAPON_CONFIG 的真实键，
  // proj 是科研注册表对「射弹」的别名，与 cannon 共用 projDmg 专精。
  damageMultiplier:Object.freeze({
    laser:Object.freeze(["allWeapon", "weaponDmg", "laserDmg", "tactical"]),
    missile:Object.freeze(["allWeapon", "weaponDmg", "missileDmg", "tactical"]),
    cannon:Object.freeze(["allWeapon", "weaponDmg", "projDmg", "tactical"]),
    proj:Object.freeze(["allWeapon", "weaponDmg", "projDmg", "tactical"])
  }),
  // 三层生命：tierHp 与 tactical 同时影响三层，层专精严格隔离。
  maxHp:Object.freeze({
    shield:Object.freeze(["tierHp", "shield", "tactical"]),
    armor:Object.freeze(["tierHp", "armor", "tactical"]),
    structure:Object.freeze(["tierHp", "structure", "tactical"])
  }),
  // 主动维修：三层共用同一 repair 组，只放大治疗量，不改燃料成本与上限钳制。
  repairMultiplier:Object.freeze({
    shield:Object.freeze(["repair"]),
    armor:Object.freeze(["repair"]),
    structure:Object.freeze(["repair"])
  })
});

function getCombatResearchGroups(stat, key) {
  const table = COMBAT_RESEARCH_GROUPS[stat];
  return table && key && table[key] ? table[key] : null;
}

function getCombatResearchModifierList(state, stat, key) {
  const groups = getCombatResearchGroups(stat, key);
  if (!groups || typeof ResearchState === "undefined") return [];
  return [{
    operation:"multiply",
    value:ResearchState.getResearchMultiplier(state, groups),
    priority:COMBAT_RESEARCH_PRIORITY,
    source:"research"
  }];
}

function getCombatMaxHpFromState(state, context) {
  const activeShip = getActiveCombatShipState(state);
  const ship = activeShip.config;
  // 玩家无拥有战斗舰（新存档/未指派）时无可计算的船体 HP：返回战斗系统自身的默认上限，避免崩溃。
  if (!activeShip.instance) {
    const fallback = (state && state.combat && state.combat.maxHp) || { shield:0, armor:0, structure:0 };
    return { ...fallback };
  }
  const enhancement = getShipEnhancementBonuses(ship, activeShip.instance && activeShip.instance.enhancementLevel);
  const flat = { shield:0, armor:0, structure:0 };
  for (const ref of Object.values(activeShip.fitting).flat().filter(Boolean)) {
    const resolved = resolveEquipmentReference(state, ref);
    const bonuses = resolved && resolved.definition ? resolved.definition.bonuses : null;
    if (!bonuses) continue;
    flat.shield += (Number(bonuses.shieldCapacity) || 0) * resolved.multiplier;
    flat.armor += (Number(bonuses.armorCapacity) || 0) * resolved.multiplier;
    flat.structure += (Number(bonuses.structureCapacity) || 0) * resolved.multiplier;
  }
  const bonuses = ship.bonuses || {};
  // 改装件容量加成（护盾/装甲/结构 *Percent），乘算在最终 HP 上（含装备平段 + 强化）
  const rigMods = (activeShip.instance && typeof getRigModifiers === "function")
    ? getRigModifiers(state, activeShip.instance) : {};
  // 脑插（99 级生产技能成就）：独立乘区，与船体/技能/装备/强化/rig/科研相乘
  const implantHp = (typeof getImplantBonuses === "function")
    ? getImplantBonuses(state).hpCap : { shield:1, armor:1, structure:1 };
  return {
    shield:Math.round(calculateCombatStatFromState(state, "maxHp", ship.hp.shield, [
      { operation:"multiply", value:1 + (bonuses.shieldCapacity || 0), priority:10, source:"ship" },
      { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "shieldOperation") * 0.03, priority:20, source:"skill" },
      { operation:"add", value:flat.shield, priority:30, source:"equipment" },
      { operation:"multiply", value:enhancement.hpMultiplier, priority:40, source:"enhancement" },
      { operation:"multiply", value:1 + (rigMods.shieldCapacityPercent || 0), priority:50, source:"rig" },
      // 研究批次 H：科研聚合乘子作用在船体/技能/装备平段/强化/rig 之后的最终 HP 上
      ...getCombatResearchModifierList(state, "maxHp", "shield"),
      { operation:"multiply", value:implantHp.shield || 1, priority:60, source:"implant" }
    ], { ...(context || {}), actor:"player", layer:"shield" })),
    armor:Math.round(calculateCombatStatFromState(state, "maxHp", ship.hp.armor, [
      { operation:"multiply", value:1 + (bonuses.armorCapacity || 0), priority:10, source:"ship" },
      { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "armorReinforcement") * 0.03, priority:20, source:"skill" },
      { operation:"add", value:flat.armor, priority:30, source:"equipment" },
      { operation:"multiply", value:enhancement.hpMultiplier, priority:40, source:"enhancement" },
      { operation:"multiply", value:1 + (rigMods.armorCapacityPercent || 0), priority:50, source:"rig" },
      ...getCombatResearchModifierList(state, "maxHp", "armor"),
      { operation:"multiply", value:implantHp.armor || 1, priority:60, source:"implant" }
    ], { ...(context || {}), actor:"player", layer:"armor" })),
    structure:Math.round(calculateCombatStatFromState(state, "maxHp", ship.hp.structure, [
      { operation:"multiply", value:1 + (bonuses.structureCapacity || 0), priority:10, source:"ship" },
      { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "hullEngineering") * 0.03, priority:20, source:"skill" },
      { operation:"add", value:flat.structure, priority:30, source:"equipment" },
      { operation:"multiply", value:enhancement.hpMultiplier, priority:40, source:"enhancement" },
      { operation:"multiply", value:1 + (rigMods.structureCapacityPercent || 0), priority:50, source:"rig" },
      ...getCombatResearchModifierList(state, "maxHp", "structure"),
      { operation:"multiply", value:implantHp.structure || 1, priority:60, source:"implant" }
    ], { ...(context || {}), actor:"player", layer:"structure" }))
  };
}

function getCombatWeaponHitFromState(state, weaponType, equipmentCombat, context) {
  const config = WEAPON_CONFIG[weaponType];
  if (!config) return 100;
  const ship = getActiveCombatShipState(state).config;
  const baseHit = equipmentCombat && equipmentCombat.baseHit !== undefined ? equipmentCombat.baseHit : config.baseHit;
  return calculateCombatStatFromState(state, "hit", baseHit, [
    { operation:"add", value:getCombatSkillLevelFromState(state, config.skillKey) * 4, priority:10, source:"weapon-skill" },
    { operation:"add", value:getCombatSkillLevelFromState(state, "targeting") * 3, priority:20, source:"targeting" },
    { operation:"add", value:(ship.bonuses && ship.bonuses.hitBonus) || 0, priority:30, source:"ship" }
  ], { ...(context || {}), actor:"player", weaponType });
}

function getCombatDamageMultiplierFromState(state, weaponType, context) {
  const config = WEAPON_CONFIG[weaponType];
  if (!config) return 1;
  const activeShip = getActiveCombatShipState(state);
  const ship = activeShip.config;
  const shipBonus = ship.bonuses ? (ship.bonuses[weaponType + "Damage"] || 0) : 0;
  const enhancement = getShipEnhancementBonuses(ship, activeShip.instance && activeShip.instance.enhancementLevel);
  // 脑插（99 级生产技能成就）：独立乘区，与技能/船体/强化/科研相乘
  const implantMult = (typeof getImplantBonuses === "function")
    ? (getImplantBonuses(state).weaponDamage[weaponType] || 1) : 1;
  return calculateCombatStatFromState(state, "damageMultiplier", 1, [
    { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, config.skillKey) * 0.02, priority:10, source:"skill" },
    { operation:"multiply", value:1 + shipBonus, priority:20, source:"ship" },
    { operation:"multiply", value:enhancement.damageMultiplier, priority:30, source:"enhancement" },
    // 研究批次 H：武器科研聚合乘子（技能/船体/强化之后只乘一次；未知 weaponType 上方已提前返回 1）
    ...getCombatResearchModifierList(state, "damageMultiplier", weaponType),
    { operation:"multiply", value:implantMult, priority:60, source:"implant" }
  ], { ...(context || {}), actor:"player", weaponType });
}

function getCombatPlayerDodgeFromState(state, context) {
  const ship = getActiveCombatShipState(state).config;
  return calculateCombatStatFromState(state, "dodge", ship.dodge || 20, [
    { operation:"add", value:getCombatSkillLevelFromState(state, "piloting"), priority:10, source:"skill" }
  ], { ...(context || {}), actor:"player" });
}

function getCombatFuelMultiplierFromState(state, zone, context) {
  const activeShip = getActiveCombatShipState(state);
  const ship = activeShip.config;
  const selectedZone = zone || COMBAT_ZONES.find(item => item.id === (state.combat && state.combat.zone));
  const shipMultiplier = Number.isFinite(ship.fuelEfficiency) ? ship.fuelEfficiency : 1;
  const zoneMultiplier = selectedZone && Number.isFinite(selectedZone.fuelMult) ? selectedZone.fuelMult : 1;
  // 电容回充改装件（原考古燃料效率）：与船体燃料折扣「加算」（折扣%相加 = 船体乘子直接减去改装件省油值），全船战斗/考古一致。
  let rigFuelSaving = 0;
  if (typeof getRigModifiers === "function" && activeShip.instance) {
    rigFuelSaving = Number((getRigModifiers(state, activeShip.instance) || {}).archaeologyFuelEfficiency) || 0;
  }
  const combinedShipMultiplier = Math.max(0, shipMultiplier - rigFuelSaving);
  // 电容管理技能(capacitorManagement)对所有燃料路径统一生效（考古见 getArchaeologyFuelCostState）。
  return calculateCombatStatFromState(state, "fuelMultiplier", 1, [
    { operation:"multiply", value:combinedShipMultiplier, priority:10, source:"ship" },
    { operation:"multiply", value:zoneMultiplier, priority:20, source:"zone" },
    { operation:"multiply", value:1 / (1 + getCombatSkillLevelFromState(state, "capacitorManagement") * 0.02), priority:30, source:"skill" }
  ], { ...(context || {}), actor:"player", zoneId:selectedZone && selectedZone.id });
}

function getCombatRepairMultiplierFromState(state, target, context, structureRatio) {
  const ship = getActiveCombatShipState(state).config;
  const roleBonus = ship.bonuses && target ? (ship.bonuses[target + "Repair"] || 0) : 0;
  let shipRepairMult = 1 + roleBonus;
  // 结构系船体紧急维修：结构层低于 70% 时，结构维修加成额外 +structureEmergencyRepair（现状 +100%，即 +200%→+300%）；仅作用于结构层
  if (target === "structure" && typeof structureRatio === "number" && structureRatio < 0.7 && ship.bonuses && typeof ship.bonuses.structureEmergencyRepair === "number") {
    shipRepairMult += ship.bonuses.structureEmergencyRepair;
  }
  return calculateCombatStatFromState(state, "repairMultiplier", 1, [
    { operation:"multiply", value:1 + getCombatSkillLevelFromState(state, "defense") * 0.02, priority:10, source:"skill" },
    { operation:"multiply", value:shipRepairMult, priority:20, source:"ship" },
    // 研究批次 H：维修科研聚合乘子（defense 技能与船体维修加成之后只乘一次；只放大治疗量）
    ...getCombatResearchModifierList(state, "repairMultiplier", target),
    // 脑插：维修增强植入体（阿尔法/贝塔）独立乘区
    { operation:"multiply", value:(typeof getImplantBonuses === "function") ? getImplantBonuses(state).repair : 1, priority:60, source:"implant" }
  ], { ...(context || {}), actor:"player", layer:target });
}

function getCombatLivingEnemiesFromState(combat) {
  const enemies = combat && Array.isArray(combat.enemies) ? combat.enemies : [];
  if (enemies.length > 0) return enemies.filter(enemy => enemy && !enemy.defeated && enemy.hp && enemy.hp.structure > 0);
  const fallback = combat && combat.currentEnemy;
  return fallback && !fallback.defeated && fallback.hp && fallback.hp.structure > 0 ? [fallback] : [];
}

function getCombatDisplayState(state, now) {
  const combat = state.combat || {};
  const storedMode = combat.mode === "deathspace" ? "deathspace" : "belt";
  const viewMode = combat.viewMode === "deathspace" ? "deathspace" : combat.viewMode === "belt" ? "belt" : storedMode;
  const encounterMode = combat.active ? storedMode : viewMode;
  const requestedTier = [2,3,4,6].includes(Number(combat.viewDeathspaceTier)) ? Number(combat.viewDeathspaceTier) :
    [2,3,4,6].includes(Number(combat.deathspaceTier)) ? Number(combat.deathspaceTier) : null;
  const storedDeathspace = getDeathspaceById(combat.viewDeathspaceId || combat.deathspaceId);
  const deathspaceTier = requestedTier || (storedDeathspace && storedDeathspace.dedTier) || 2;
  const deathspace = storedDeathspace && storedDeathspace.dedTier === deathspaceTier
    ? storedDeathspace
    : DEATHSPACE_DATABASE.find(site => site.dedTier === deathspaceTier) || DEATHSPACE_DATABASE[0];
  const encounterDeathspace = encounterMode === "deathspace"
    ? getDeathspaceById(combat.active ? combat.deathspaceId : (combat.viewDeathspaceId || combat.deathspaceId)) || deathspace
    : null;
  const activeShip = getActiveCombatShipState(state);
  const ship = activeShip.config;
  const hasShip = Boolean(activeShip.instance);
  const modules = getInstalledCombatModulesFromState(state);
  const weapons = modules.filter(module => module.combat.kind === "weapon");
  const repairers = modules.filter(module => module.combat.kind === "repair");
  const level = getCombatLevelFromState(state);
  const zone = encounterMode === "deathspace"
    ? COMBAT_ZONES.find(item => item.id === encounterDeathspace.sourceZoneId) || COMBAT_ZONES[0]
    : COMBAT_ZONES.find(item => item.id === combat.zone) || COMBAT_ZONES[0];
  // 问题2：per-ship 维修——recovery 反映「当前战斗舰」自身的维修状态，而非全局单槽。
  const activeInstanceId = activeShip.instance ? activeShip.instance.instanceId : null;
  const recoveryUntil = getShipRepairUntil(state, activeInstanceId);
  const recoveryRemaining = recoveryUntil > now ? Math.ceil((recoveryUntil - now) / 1000) : 0;
  const livingEnemies = getCombatLivingEnemiesFromState(combat);
  const target = selectCapitalCombatTarget(livingEnemies, combat.targetingMode, ship);
  const enemies = Array.isArray(combat.enemies) ? combat.enemies : [];
  const targetIndex = target ? Math.max(0, enemies.indexOf(target)) : -1;
  const derivedMaxHp = getCombatMaxHpFromState(state, { now, zoneId:zone.id });
  const maxHp = combat.maxHp && Number.isFinite(combat.maxHp.structure) ? { ...combat.maxHp } : { ...derivedMaxHp };
  // 非战斗态下 combat.hp 是上一场交战的残留（可能 structure=0），不应作为舰体当前血量展示。
  // 待命/战斗前页面应显示满血（准备出战）；战斗中才使用 combat.hp 实时受损值。
  const hp = combat.active && combat.hp && Number.isFinite(combat.hp.structure) ? { ...combat.hp } : { ...maxHp };
  const requiredLevel = encounterMode === "deathspace" ? encounterDeathspace.requiredCL : (zone.requiredCL || 1);
  const zoneUnlocked = level >= requiredLevel;
  const volleyDamage = weapons.reduce((total, module) => total + Math.round(module.combat.baseDamage * getCombatDamageMultiplierFromState(state, module.combat.weaponType, { now, zoneId:zone.id })), 0);
  const clears = encounterMode === "deathspace"
    ? combat.deathspaceClears && combat.deathspaceClears[encounterDeathspace.id] || 0
    : combat.zoneClears && combat.zoneClears[zone.id] || 0;
  const enemyVolley = combat.lastEnemyVolley;
  const enemyVolleyText = enemyVolley && enemyVolley.attackers > 0
    ? " · 敌方出手 " + enemyVolley.attackers + " 艘 / 实伤 " + enemyVolley.totalDamage +
      (enemyVolley.mitigatedDamage ? " / 偏导减伤 " + enemyVolley.mitigatedDamage : "") + (enemyVolley.armorRestored ? " / 应激恢复 " + enemyVolley.armorRestored : "")
    : "";
  const maxWave = encounterMode === "deathspace" ? encounterDeathspace.maxWave : (zone.maxWave || 20);
  const runStatus = (encounterMode === "deathspace" ? "房间 " : "第 ") + (combat.wave || 1) + "/" + maxWave + (encounterMode === "deathspace" ? "" : " 波") +
    (target ? " · 当前敌人 " + (targetIndex + 1) + "/" + enemies.length : "") +
    (encounterMode === "deathspace" ? " · 已全通 " : " · 本轮精英 " + (combat.runEliteKills || 0) + " · 已肃清 ") + clears + enemyVolleyText +
    (combat.lastLoot ? " · 最近掉落: " + combat.lastLoot : "") +
    (combat.lastSpecialLoot ? " · 本次稀有收获: " + combat.lastSpecialLoot : "") +
    (combat.lastStatus ? " · " + combat.lastStatus : "");
  const ticketCount = ResourceRegistry.get(state, "special:" + deathspace.ticketMaterial);
  // 无拥有战斗舰时（新存档/未指派），强制禁用开战并提示去机库指派，避免幽灵舰误导。
  const noShip = !hasShip;
  const startDisabled = noShip || recoveryRemaining > 0 || weapons.length === 0 || !zoneUnlocked || (viewMode === "deathspace" && ticketCount < 1);
  // 战斗并入队列：点击后弹出与采矿一致的确认弹窗，选择波数/入场次数、无限、加入队列或直接开始。
  const startText = noShip ? "请先在机库指派战斗舰" : (recoveryRemaining > 0 ? "维修中 " + recoveryRemaining + "s" : !zoneUnlocked ? "需要战斗等级 " + requiredLevel : weapons.length === 0 ? "未安装武器" : viewMode === "deathspace" && ticketCount < 1 ? "缺少通行密钥" : (viewMode === "deathspace" ? "▶ 开始攻略" : "▶ 开始战斗"));
  const slotNames = { high:"高槽", mid:"中槽", low:"低槽", rig:"改装槽" };
  const equipmentRack = [];
  for (const slot of ["high", "mid", "low", "rig"]) {
    const fitted = activeShip.fitting[slot];
    const count = Math.max((ship && ship.slots && ship.slots[slot]) || 0, fitted.length);
    for (let index = 0; index < count; index++) {
      const ref = fitted[index] || null;
      const resolved = ref ? resolveEquipmentReference(state, ref) : null;
      const equipment = resolved ? resolved.definition : null;
      equipmentRack.push({ slot, slotName:slotNames[slot], index, equipmentRef:ref, equipmentId:resolved ? resolved.itemId : null, enhancementLevel:resolved ? resolved.enhancementLevel : 0, name:equipment ? equipment.name : "空槽位", empty:!equipment, attributes:equipment ? getEquipmentAttributeText(equipment, "\n") : slotNames[slot] + "：空槽位" });
    }
  }

  return {
    kind:"combat",
    mode:viewMode,
    viewMode,
    encounterMode,
    deathspaceTier,
    active:Boolean(combat.active),
    browsingDuringCombat:Boolean(combat.active && viewMode !== encounterMode),
    headerText:recoveryRemaining > 0
      ? ((state.resumeAfterRepair && state.resumeAfterRepair.type === "combat" ? "自动维修中 · 完成后返回战斗 · " : "维修中 · ") + recoveryRemaining + "s")
      : combat.active && target ? (encounterMode === "deathspace" ? "▶ 死亡空间攻略中" : "▶ 交战中") : "待命",
    wave:Number(combat.wave) || 1,
    maxWave,
    clearCount:clears,
    level,
    skills:{
      laser:getCombatSkillLevelFromState(state, "laserOps"), cannon:getCombatSkillLevelFromState(state, "cannonOps"),
      missile:getCombatSkillLevelFromState(state, "missileOperations"), targeting:getCombatSkillLevelFromState(state, "targeting")
    },
    targeting:{
      supported:isCapitalCombatShip(ship),
      mode:isCapitalCombatShip(ship) ? normalizeCapitalTargetingMode(combat.targetingMode) : "formation",
      modeName:getCapitalTargetingModeName(combat.targetingMode),
      options:CAPITAL_TARGETING_MODES.map(option => ({ ...option })),
      trait:ship ? (ship.capitalTrait ? { ...ship.capitalTrait } : null) : null
    },
    zone:{ ...zone, unlocked:zoneUnlocked },
    zones:COMBAT_ZONES.map(item => ({ ...item, selected:item.id === zone.id, unlocked:level >= (item.requiredCL || 1), locked:Boolean(combat.active) || level < (item.requiredCL || 1), clears:combat.zoneClears && combat.zoneClears[item.id] || 0 })),
    deathspace:{ ...deathspace, ticketCount, unlocked:level >= deathspace.requiredCL, clearCount:combat.deathspaceClears && combat.deathspaceClears[deathspace.id] || 0 },
    deathspaceTiers:[2,3,4,6].map(tier => {
      const sites = DEATHSPACE_DATABASE.filter(site => site.dedTier === tier);
      return { tier, label:tier + "/10", selected:tier === deathspaceTier, unlocked:sites.some(site => level >= site.requiredCL), requiredCL:sites[0] ? sites[0].requiredCL : 1 };
    }),
    deathspaces:DEATHSPACE_DATABASE.filter(site => site.dedTier === deathspaceTier).map(site => ({
      ...site,
      selected:site.id === deathspace.id,
      unlocked:level >= site.requiredCL,
      locked:level < site.requiredCL,
      ticketCount:ResourceRegistry.get(state, "special:" + site.ticketMaterial),
      clears:combat.deathspaceClears && combat.deathspaceClears[site.id] || 0,
      sourceZoneName:(COMBAT_ZONES.find(item => item.id === site.sourceZoneId) || {}).name || site.sourceZoneId
    })),
    recovery:{ active:recoveryRemaining > 0, remaining:recoveryRemaining, until:recoveryUntil },
    player:{ instanceId:hasShip ? activeShip.instance.instanceId : null, name:hasShip ? ship.name : "未装备战斗舰", image:hasShip ? (ship && ship.image ? ship.image : "") : "", hasShip, speed:ship ? (ship.speed || 0) : 0, dodge:hasShip ? getCombatPlayerDodgeFromState(state, { now, zoneId:zone.id }) : 0, hp, maxHp, derivedMaxHp, volleyDamage, weaponCount:weapons.length },
    enemies:enemies.map((enemy, index) => {
      const currentHp = enemy.hp ? enemy.hp.shield + enemy.hp.armor + enemy.hp.structure : 0;
      const maximumHp = enemy.maxHp ? enemy.maxHp.shield + enemy.maxHp.armor + enemy.maxHp.structure : 1;
      return { ...enemy, hp:enemy.hp ? { ...enemy.hp } : null, maxHp:enemy.maxHp ? { ...enemy.maxHp } : null, index, current:enemy === target, defeated:Boolean(enemy.defeated || !enemy.hp || enemy.hp.structure <= 0), percent:Math.max(0, Math.min(100, Math.round(currentHp / maximumHp * 100))) };
    }),
    target:target ? { ...target, hp:{ ...target.hp }, maxHp:{ ...target.maxHp }, index:targetIndex, kindLabel:target.kind === "boss" ? "BOSS" : target.kind === "elite" ? "精英" : "普通", defenseLabel:zone.faction === "angel" ? "护盾特化" : zone.faction === "blood" ? "装甲特化" : "结构特化" } : null,
    lockText:target ? "目标锁定" : "等待目标",
    runStatus,
    showRewards:Boolean(combat.active && target || combat.lastLoot || combat.lastSpecialLoot || combat.lastStatus),
    supplies:{ fuel:ResourceRegistry.get(state, "consumable:fuel"), laser:getAmmoCount(state, "laser"), missile:getAmmoCount(state, "missile"), cannon:getAmmoCount(state, "cannon") },
    weapons:weapons.map(module => ({ ...module, icon:{ laser:"⚡", missile:"🚀", cannon:"💥" }[module.combat.weaponType] || "◆" })),
    repairers:repairers.map(module => ({ ...module })),
    equipmentRack,
    controls:{ showStart:!combat.active, showStop:Boolean(combat.active), startDisabled, startText }
  };
}

// 战斗/死亡空间掉落预览（Phase 3D 其他任务）：
// 纯函数——只读生产掉落配置（systems/combat.js 的 get*DropConfig 系列），不改动全局状态、不调用发奖/事件。
// 与生产掉落结算（roll* 系列）同源：roll* 与预览均消费同一组纯配置函数，概率/材料/数量单一事实来源。
// 字段：加密数据 / 星带特殊掉落 / 装备专用数据 / 通行密钥 / 货柜 / 死亡空间首领战利品 / 战术材料。
// 注意：生产结算中，死亡空间模式不掉落加密数据/特殊掉落/通行密钥，仅掉落首领战利品 + 战术材料。
// 返回值不含 ISK/LP 经济与成功率模拟（用户明确要求排除）。
// fail-closed：非法 zoneId / 死亡空间 / 来源星带一律返回 {valid:false, reason}，不回退首个星带。
function getCombatDropPreview(state, options) {
  const opts = options || {};
  const mode = opts.mode === "deathspace" ? "deathspace" : "belt";

  if (mode === "deathspace") {
    const site = getDeathspaceById(opts.deathspaceId);
    if (!site) return { mode: "deathspace", valid: false, reason: "unknown-deathspace" };
    const sourceZone = COMBAT_ZONES.find(item => item.id === site.sourceZoneId);
    if (!sourceZone) return { mode: "deathspace", valid: false, reason: "unknown-source-zone" };
    return {
      mode: "deathspace", valid: true,
      deathspaceId: site.id, name: site.name, faction: site.faction,
      sourceZoneId: sourceZone.id, sourceZoneName: sourceZone.name,
      encryptedData: null, zoneSpecialDrops: null, ticketDrop: null, gearDrops: null, stationCoreDrops: null, cargoDrops: null,
      leaderLoot: getDeathspaceLeaderLootConfigs(site),
      tacticalMaterial: getTacticalMaterialDropConfig(sourceZone)
    };
  }

  const zone = COMBAT_ZONES.find(item => item.id === opts.zoneId);
  if (!zone) return { mode: "belt", valid: false, reason: "unknown-zone" };
  return {
    mode: "belt", valid: true,
    zoneId: zone.id, name: zone.name, faction: zone.faction,
      encryptedData: getEncryptedDataDropConfig(zone),
    zoneSpecialDrops: getCombatZoneSpecialDropConfigs(zone),
    gearDrops: getGearDropConfigs(zone),
    stationCoreDrops: getStationCoreDropConfigs(zone),
    cargoDrops: getCargoDropConfigs(zone),
    ticketDrop: getDeathspaceTicketDropConfig(zone),
    tacticalMaterial: getTacticalMaterialDropConfig(zone)
  };
}

function getPlanetaryCapacityState(state) {
  const skill = state.skills.planetaryIndustry || { lvl:1, xp:0 };
  const level = Number(skill.lvl) || 1;
  const xp = Number(skill.xp) || 0;
  const xpNeeded = xpForLevel(level + 1);
  const deployments = state.planetary && Array.isArray(state.planetary.deployments) ? state.planetary.deployments : [];
  // 脑插·行星扩展（货柜 T3 来源）：+1 行星槽（硬上限同步 +1）
  const implantPlanetSlot = (typeof getImplantBonuses === "function") ? getImplantBonuses(state).planetSlot : 0;
  // 空间站·行星管控中心 Lv2/Lv3：+1/+2 行星槽（与脑插同乘区，硬上限同步叠加）
  const stationPlanetarySlotBonus = (typeof getStationPlanetarySlotBonus === "function") ? getStationPlanetarySlotBonus(state) : 0;
  const bonusSlots = implantPlanetSlot + stationPlanetarySlotBonus;
  const planetSlotCap = 5 + bonusSlots;
  return {
    level,
    xp,
    xpNeeded,
    xpPercent:Math.min(100, Math.floor(xp / xpNeeded * 100)),
    usedSlots:deployments.length,
    // 新手期保底 2 个行星槽位（Lv1-19 = 2），后续曲线：Lv20-29=3 / Lv30-39=4 / Lv40+=5；脑插与空间站加成同步叠加并突破硬上限
    slots:Math.min(planetSlotCap, Math.max(2, 1 + Math.floor(level / 10)) + bonusSlots),
    maxSlots:planetSlotCap
  };
}

// 按行星类型计算本地仓储上限 = 当前效率下连续生产 6 小时的产量
// storageMax = ceil(21600 / getPlanetOutputIntervalFromState(state, planetType))
// 填满时间在 21600s 至 21600 + interval 之间
function getPlanetStorageMaxFromState(state, planetType) {
  const interval = getPlanetOutputIntervalFromState(state, planetType);
  return Math.ceil(21600 / interval);
}

function getPlanetOutputIntervalFromState(state, type) {
  const config = PLANET_TYPES.find(planet => planet.id === type);
  const level = getPlanetaryCapacityState(state).level;
  const stationMult = (typeof getStationLogisticsMultiplier === "function") ? Math.max(0.001, getStationLogisticsMultiplier(state)) : 1;
  // 研究批次 G：行星生产提速 → 周期 ÷ 乘子（在线 planetaryTick 与离线 settleOfflinePlanets 共用此唯一入口）
  let researchMult = (typeof ResearchState !== "undefined") ? Number(ResearchState.getResearchMultiplier(state, ["planProd"])) : 1;
  if (!Number.isFinite(researchMult) || researchMult <= 0) researchMult = 1;
  // 脑插·行星加速（货柜 T3 来源）：周期 ÷1.05（加速 +5%）
  const implantPlanetSpeed = (typeof getImplantBonuses === "function") ? getImplantBonuses(state).planetSpeed : 1;
  return config ? config.interval / (1 + level * 0.02) / stationMult / researchMult / implantPlanetSpeed : 10;
}

// 研究批次 G · planCost（reduceFraction）：行星续期费唯一公式。
// 部署卡显示价 / 余额判断价 / actions.PlanetaryStateActions.renew 实扣价 / renewed 事件价
// 四处只准读这一个函数，禁止任何一处再算第二套。
function getPlanetRenewCostISK(state, config) {
  const base = Number(config && config.maintenanceCostISK) || 0;
  if (base <= 0) return 0;
  const raw = (typeof ResearchState !== "undefined") ? Number(ResearchState.getResearchBonusValue(state, "planCost")) : 0;
  const factor = Math.max(0, 1 - (Number.isFinite(raw) ? Math.max(0, raw) : 0));
  return Math.ceil(base * factor);
}

// 纯显示态：只消费不修改。三状态 running / expired（deployment 一定存在，未布置态由 deployOptions 表达）。
function getPlanetDeploymentDisplayState(state, deployment, now) {
  const config = PLANET_TYPES.find(planet => planet.id === deployment.planetType) || null;
  const capacity = getPlanetaryCapacityState(state);
  const duration = Number(deployment.duration) || 86400;
  const deployedAt = Number(deployment.deployedAt) || now;
  const elapsed = Math.max(0, (now - deployedAt) / 1000);
  const remaining = Math.max(0, duration - elapsed);
  const timeExpired = remaining <= 0;
  // 已到期 = 时间超期 或 active 标志已被置为 false
  const expired = timeExpired || !deployment.active;
  const storage = Number(deployment.storage) || 0;
  const storageMax = getPlanetStorageMaxFromState(state, deployment.planetType);
  const full = storage >= storageMax;
  const active = Boolean(deployment.active) && !timeExpired;
  const runState = active ? "running" : "expired";
  const interval = getPlanetOutputIntervalFromState(state, deployment.planetType);
  const sinceTick = active && !full ? Math.max(0, (now - (Number(deployment.lastTick) || now)) / 1000) : 0;
  const displayProgress = active && !full ? Math.min(interval, (Number(deployment.progress) || 0) + sinceTick) : Number(deployment.progress) || 0;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const statusClass = expired ? "expired" : full ? "full" : "running";
  const statusText = expired ? "已到期 · 停止生产" : full ? "满仓停产" : "运行中";
  // 研究批次 G：行星维护费减免（planCost，reduceFraction）。显示费用 = 实扣费用（唯一公式 getPlanetRenewCostISK）。
  const renewBaseCost = config ? Number(config.maintenanceCostISK) || 0 : 0;
  const renewCost = getPlanetRenewCostISK(state, config);
  const planCostFactor = renewBaseCost > 0 ? (renewCost / renewBaseCost) : 1;
  const isk = ResourceRegistry.get(state, "currency:isk");
  const enoughIskForRenew = isk >= renewCost;
  return {
    id:deployment.id,
    type:deployment.planetType,
    planetType:deployment.planetType,
    name:config ? config.name : deployment.planetType,
    icon:config ? config.icon : "🪐",
    output:config ? config.output : "未知产物",
    outputIcon:config ? ITEM_ICONS[config.output] || "📦" : "📦",
    state:runState,
    active,
    expired,
    full,
    statusClass,
    statusText,
    storage,
    storageMax,
    storagePercent:Math.min(100, Math.floor(storage / storageMax * 100)),
    interval,
    outputProgress:displayProgress,
    outputPercent:Math.min(100, Math.floor(displayProgress / interval * 100)),
    outputEta:Math.max(0, interval - displayProgress),
    showOutputProgress:active && !full,
    duration,
    elapsed,
    remaining,
    timePercent:Math.min(100, Math.floor(elapsed / duration * 100)),
    timeWarning:remaining < 3600,
    timeLeftText:expired ? "已到期" : hours > 0 ? `剩余 ${hours}h${minutes}m` : `剩余 ${minutes}m`,
    renewCost,
    renewBaseCost,
    planCostReduction:1 - planCostFactor,
    enoughIskForRenew,
    showRenew:expired,
    canRenew:expired && enoughIskForRenew,
    canCollect:storage > 0,
    canDemolish:storage === 0,
    canRemove:storage === 0
  };
}

function getPlanetaryDisplayState(state, now) {
  const capacity = getPlanetaryCapacityState(state);
  const deployments = state.planetary && Array.isArray(state.planetary.deployments) ? state.planetary.deployments : [];
  const isk = ResourceRegistry.get(state, "currency:isk");
  const tritanium = ResourceRegistry.get(state, "mineral:三钛合金");
  return {
    kind:"planetary",
    ...capacity,
    canDeploy:capacity.usedSlots < capacity.slots,
    deployments:deployments.map(deployment => getPlanetDeploymentDisplayState(state, deployment, now)),
    deployOptions:PLANET_TYPES.map(config => {
      const constructionISK = Number(config.constructionCost && config.constructionCost.isk) || 0;
      const constructionTrit = Number(config.constructionCost && config.constructionCost.resources && config.constructionCost.resources["mineral:三钛合金"]) || 0;
      const maintenanceCostISK = Number(config.maintenanceCostISK) || 0;
      return {
        id:config.id,
        type:config.id,
        name:config.name,
        icon:config.icon,
        output:config.output,
        level:config.level,
        interval:getPlanetOutputIntervalFromState(state, config.id),
        constructionISK,
        constructionTrit,
        maintenanceCostISK,
        // 研究批次 G · planCost：目录页续期价与部署卡/实扣共用唯一公式
        renewCost:getPlanetRenewCostISK(state, config),
        unlocked:capacity.level >= config.level,
        enoughIsk:isk >= constructionISK,
        enoughTrit:tritanium >= constructionTrit,
        canDeploy:capacity.usedSlots < capacity.slots && capacity.level >= config.level && isk >= constructionISK && tritanium >= constructionTrit
      };
    })
  };
}

/* 仓库物品「出产位置」映射：分类 → 侧边栏页面（data-skill/data-page 与 twGoToTarget 一致）。
   对照游戏真实生产线：矿石→采矿、矿物→冶炼、行星产物→行星开发、气体→气体采集、
   月矿→采矿（月矿激光器剥离）、特殊→战斗；消耗品(弹药/燃料/维修膏)→装备工程；
   舰船组件→舰船工程（舰船船坞）。装备(可装配装备)统一在装备工程制造，蓝图为前置非产地。 */
const CARGO_SOURCE = {
  ore:       { pageId:"mining",        pageLabel:"采矿",     icon:"fa-solid fa-gem" },
  mineral:   { pageId:"refining",      pageLabel:"冶炼",     icon:"fa-solid fa-fire" },
  planetary: { pageId:"planetary",     pageLabel:"行星开发", icon:"fa-solid fa-globe" },
  gases:     { pageId:"gasHarvesting", pageLabel:"气体采集", icon:"fa-solid fa-wind" },
  moon:      { pageId:"mining",        pageLabel:"采矿",     icon:"fa-solid fa-moon" },
  special:   { pageId:"combat",        pageLabel:"战斗",     icon:"fa-solid fa-crosshairs" },
  consumable:{ pageId:"equipmentEngineering", pageLabel:"装备工程", icon:"fa-solid fa-gears" },
  component: { pageId:"shipEngineering",       pageLabel:"舰船工程", icon:"fa-solid fa-rocket" }
};

/* 仓库物品「文字介绍」：无独立描述字段，按分类给一句准确说明（装备用真实属性文本） */
const CARGO_DESC = {
  ore:       "基础矿石。通过采矿激光器从小行星带剥离获取，是精炼矿物与合金的原料。",
  mineral:   "精炼矿物。由矿石冶炼或在空间站精炼线提纯得到，用于装备制造与舰船构件。",
  planetary: "行星产物。在行星开发链上采集与加工，供给工业与制造体系。",
  gases:     "气态原料。由气体采集从太空气云中收集，用于无人机链路与增强剂合成。",
  moon:      "月矿。由采矿舰船装配月矿激光器从小卫星剥离获取，是旗舰级装备与反应堆构件的原料。",
  special:   "特殊材料。主要来自战斗掉落、考古与势力活动，是研发与高级配方的稀缺耗材。",
  consumable:"消耗品。燃料、弹药与维修膏由装备工程制造，战斗与作业消耗，也可在空间站补给。",
  component: "舰船构件。由精炼矿物在舰船工程（舰船船坞）总装，供舰船制造直接调用。"
};

/* 仓库物品分类中文显示名（用于方块卡角标与配色选择，ITEM_CATEGORIES 的键是英文码） */
const CARGO_CATEGORY_LABEL = {
  ore:"矿石", mineral:"矿物", planetary:"行星产物", gases:"气体",
  moon:"月球", special:"特殊", consumable:"消耗品", component:"组件", equipment:"装备"
};

/* 仓库自动排序：顶层分类固定顺序（矿石→矿物→行星产物→气体→月矿→特殊物资→消耗品→舰船装备） */
const CARGO_TOP_RANK = { ore:0, mineral:1, planetary:2, gases:3, moon:4, special:5, consumable:6, equipment:7 };
/* 各类材料的「采集/开采等级」，用于组内升序排列（资源按产出区域等级，矿物/月矿/气体/行星同此映射） */
const CARGO_COLLECT_LEVEL = {
  // 矿石（原始小行星带）
  "凡晶石":1,"灼烧岩":10,"水硼砂":20,"斜长岩":40,"干焦岩":55,"灰岩":70,"艾克诺岩":85,
  // 矿物（精炼）
  "三钛合金":1,"类银超金属":10,"类晶体胶矿":20,"同位聚合体":40,"超新星诺克石":55,"基腹断岩":70,"超噬矿":85,
  // 行星产物
  "重金属":1,"稀有气体":1,"同位素":20,"等离子体":40,"生物质":60,"磁场聚合物":80,
  // 气体
  "粗制富勒烯":1,"氦同位素":10,"稳定富勒烯":20,"氢同位素":40,"高纯富勒烯":55,"聚合气体":70,"超纯聚合气体":85,
  // 月矿
  "镓":20,"铂":20,"铪":40,"锇":40,"钷":55,"铷":70
};
const ROMAN_TO_NUM = { i:1, ii:2, iii:3, iv:4, v:5 };
function romanToNum(s){ return ROMAN_TO_NUM[String(s == null ? "" : s).toLowerCase()] || 0; }
/* 装备按功能分组：武器/维修/采矿/采气/打捞/考古/改装件（依据 slot、combat.kind、bonuses 推导） */
function getEquipmentFunctionGroup(eq){
  if(!eq) return "其他";
  if(eq.slot === "rig") return "改装件";
  const combat = eq.combat || {};
  if(combat.kind === "weapon") return "武器";
  if(combat.kind === "repair") return "维修";
  const b = eq.bonuses || {};
  if("salvageEfficiency" in b) return "打捞";
  if(eq.archaeology === true || "archaeologyScan" in b || "archaeologyStabilizer" in b || "archaeologyDecoder" in b || "archaeologyCycleReduction" in b) return "考古";
  const hasMining = "miningEfficiency" in b || "miningLaserEfficiency" in b;
  const hasGas = "gasEfficiency" in b || "gasLaserEfficiency" in b;
  if(hasMining) return "采矿";
  if(hasGas) return "采气";
  if("shieldCapacity" in b || "armorCapacity" in b || "structureCapacity" in b || "hullCapacity" in b) return "维修";
  return "其他";
}
const EQUIP_FUNCTION_ORDER = { "武器":0,"维修":1,"采矿":2,"采气":3,"打捞":4,"考古":5,"改装件":6,"其他":7,"舰船组件":8 };
/* 增强剂制造五档战术材料名→T1..T5 档位序（仓库「战术材料」小分类内按档排序；boosters.js 的 TACTICAL_MATERIALS 在 selectors.js 前加载） */
const TACTICAL_MATERIAL_ORDER = (typeof TACTICAL_MATERIALS !== "undefined")
  ? Object.fromEntries(TACTICAL_MATERIALS.map((m, i) => [m.name, i])) : {};
/* 计算单个仓库物品的分层排序元数据；componentLevelByName 为 舰船组件名→等级 映射 */
function computeCargoSortMeta(item, componentLevelByName){
  const topRank = CARGO_TOP_RANK[item.category] != null ? CARGO_TOP_RANK[item.category] : 99;
  const topLabel = CARGO_CATEGORY_LABEL[item.category] || item.categoryLabel || "";
  let subRank = 0, subLabel = null, primary = 0, secondary = "";
  const cat = item.category, nm = item.name || "", id = item.id || "";
  if(["ore","mineral","planetary","gases","moon"].includes(cat)){
    subLabel = null; // 资源类不拆分小分类，按采集等级升序一条直线排
    primary = CARGO_COLLECT_LEVEL[nm] != null ? CARGO_COLLECT_LEVEL[nm] : 999;
  } else if(cat === "special"){
    if(id.indexOf("calibration:") === 0){
      subRank = 0; subLabel = "校准基体";
      const m = id.match(/_([iv]+)_calib$/); primary = romanToNum(m ? m[1] : "");
    } else if(/通行密钥/.test(nm)){ subRank = 1; subLabel = "通行密钥"; primary = 0; secondary = nm; }     // 死亡空间入场凭证（各势力/站点通行密钥）
    else if(/阶密钥/.test(nm)){                                                                       // 势力加密数据（天使低阶密钥/血袭中阶密钥/萨沙高阶密钥…）
      subRank = 2; subLabel = "势力密钥";
      const tm = nm.match(/(低|中|高)阶/); const torder = { 低:0, 中:1, 高:2 };
      primary = tm ? torder[tm[1]] : 0; secondary = nm;
    } else if(/协议/.test(nm)){ subRank = 3; subLabel = "协议材料"; primary = 0; secondary = nm; }          // 死亡空间首领协议
    else if(TACTICAL_MATERIAL_ORDER.hasOwnProperty(nm)){                                                 // 增强剂制造五档战术材料（战术残液→活性战术凝胶→高能战术萃取物→极化战术介质→深层适应性样本）
      subRank = 4; subLabel = "战术材料";
      primary = TACTICAL_MATERIAL_ORDER[nm]; secondary = nm;
    } else if(/核心/.test(nm)){ subRank = 5; subLabel = "核心素材"; primary = 0; secondary = nm; }          // 校准核心 + 空间站核心
    else if(/生产许可/.test(nm)){ subRank = 6; subLabel = "装备生产许可"; primary = 0; secondary = nm; }  // 苍穹劫团装备生产许可 D/C/B/A 等
    else if(/神经植入体/.test(nm)){ subRank = 7; subLabel = "神经植入体"; primary = 0; secondary = nm; }
    else if(/数据/.test(nm)){ subRank = 8; subLabel = "舰船数据"; primary = 0; secondary = nm; }          // 天穹/重垒/裂界 深层舰船数据
    else { subRank = 9; subLabel = "其他掉落"; primary = 0; secondary = nm; }
  } else if(cat === "consumable"){
    if(nm === "燃料单元"){ subRank = 0; subLabel = "燃料"; }
    else if(item.ammoTier != null || /弹/.test(nm)){
      const tierRaw = item.ammoTier || (nm.match(/T(\d+)/) || [,"1"])[1];
      const tier = String(tierRaw).replace(/^T/i, "") || "1";
      subRank = 10 + Number(tier); subLabel = "弹药 T" + tier; secondary = nm.replace(/\s*T\d+.*$/,"");
    }
    else if(nm === "纳米维修膏"){ subRank = 2; subLabel = "维修耗材"; }
    else if(/货柜/.test(nm)){
      const size = (nm.match(/货柜\s*(S|M|L|XL)/) || [,"M"])[1];
      const sizeOrder = { S:0, M:1, L:2, XL:3 };
      subRank = 3; subLabel = "容器"; primary = sizeOrder[size] != null ? sizeOrder[size] : 1;
    }
    else if(id && id.indexOf("booster:") === 0){ subRank = 4; subLabel = "增强剂"; primary = 0; secondary = nm; }
    else { subRank = 99; subLabel = "其它"; secondary = nm; }
  } else if(cat === "equipment"){
    if(item.isEquipment){
      const eq = EQUIPMENT_DB[item.itemId];
      const grp = getEquipmentFunctionGroup(eq);
      subRank = EQUIP_FUNCTION_ORDER[grp] != null ? EQUIP_FUNCTION_ORDER[grp] : 7;
      subLabel = grp;
      primary = -(eq ? (eq.level || 0) : 0); // 组内按等级降序（高强化在前、低强化在后）
    } else {
      subRank = 8; subLabel = "舰船组件";
      const lvl = componentLevelByName ? componentLevelByName[nm] : undefined;
      primary = lvl != null ? lvl : 0;
    }
  }
  return { topRank, topLabel, subRank, subLabel, primary, secondary };
}

function getCargoDisplayState(state, filter) {
  // 脑插子标签：展示全部 6 枚（拥有/未获得），不依赖 ITEM_CATEGORIES 资源池
  if (filter === "implant") {
    const owned = (state && state.implants) || {};
    const items = Object.values(IMPLANT_DB).map(imp => ({
      id: imp.id,
      name: imp.name,
      icon: imp.icon,
      desc: imp.desc,
      owned: !!owned[imp.id],
      category: "implant",
      categoryLabel: "脑插",
      quantity: owned[imp.id] ? 1 : 0,
      source: { pageId: "skill", pageLabel: imp.sourceSkillName + " Lv.99" }
    }));
    return {
      kind: "cargo",
      filter: "implant",
      total: Object.keys(owned).length,
      items,
      emptyText: "暂无脑插。将 采矿 / 冶炼 / 舰船工程 / 装备工程 / 增强剂制造 / 气体采集 练至 99 级即可激活对应脑插。",
      filters: Object.keys(ITEM_CATEGORIES).map(id => ({ id, selected: false }))
    };
  }
  // 交易品子标签：聚合「货柜具名战利品 + 考古星币/功勋文物」，统一一键回收
  if (filter === "trade") return getTradeGoodsDisplayState(state);
  // 支持虚拟筛选项：equipment(真装备) 与 component(舰船组件) 在数据中均挂在 ITEM_CATEGORIES.equipment 键下，需拆开
  let selectedFilter;
  if (filter === "all" || filter === "equipment" || filter === "component") selectedFilter = filter;
  else if (ITEM_CATEGORIES[filter]) selectedFilter = filter;
  else selectedFilter = "all";
  const componentNames = Object.fromEntries(SHIP_COMPONENT_RECIPES.map(recipe => [recipe.id, recipe.name]));
  const componentIdByName = Object.fromEntries(SHIP_COMPONENT_RECIPES.map(recipe => [recipe.name, recipe.id]));
  const resources = state.resources || {};
  const equipmentSource = {};
  for (const { definition, quantity } of ResourceRegistry.listStateEntries(state, "component")) equipmentSource[componentNames[definition.key] || definition.name] = quantity;
  for (const equipmentId of state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : []) {
    const equipment = EQUIPMENT_DB[equipmentId];
    if (equipment) equipmentSource[equipment.name] = (equipmentSource[equipment.name] || 0) + 1;
  }
  // 双池：未安装的装备实例同样占用 cargo
  for (const instance of (state.equipment && Array.isArray(state.equipment.instances) ? state.equipment.instances : [])) {
    if (instance.installedOn) continue;
    const equipment = EQUIPMENT_DB[instance.itemId];
    if (equipment) equipmentSource[equipment.name] = (equipmentSource[equipment.name] || 0) + 1;
  }
  // 货柜容器（资源 id 为 special:货柜S/M/L/XL）原本随 special 命名空间归入「特殊物资」标签。
  // 按需求改挂到「消耗品」标签展示：仅调整仓库视图归类，物品 id 保持不变，
  // 故开箱弹窗（openItemDetailModal 按 id 前缀判定）、考古/战斗掉落与存档逻辑均不受影响。
  const specialEntries = ResourceRegistry.listStateEntries(state, "special");
  // Keep combat gear licenses visible in the warehouse even when an older
  // save/resource registry did not enumerate the newer gear material keys.
  // The canonical keys are still special:<material>; this is only a read-side
  // catalog fallback and does not create inventory or alter quantities.
  const gearMaterialNames = (typeof GEAR_DATA_MATERIALS !== "undefined" && Array.isArray(GEAR_DATA_MATERIALS))
    ? GEAR_DATA_MATERIALS : [];
  const knownSpecialIds = new Set(specialEntries.map(entry => entry.definition.id));
  for (const materialName of gearMaterialNames) {
    const id = "special:" + materialName;
    if (knownSpecialIds.has(id)) continue;
    const quantity = ResourceRegistry.get(state, id);
    if (quantity > 0) {
      const definition = ResourceRegistry.getDefinition(id);
      if (definition) specialEntries.push({ definition, quantity });
    }
  }
  // 校准基体（calibration: 命名空间，存于 state.calibrations 池）此前无仓库桶，导致完全不可见；
  // 并入「特殊物资」标签展示（来历实为考古，下方逐件纠正来源/说明）。
  const calibrationEntries = ResourceRegistry.listStateEntries(state, "calibration");
  const cargoEntries = specialEntries.filter(entry => (entry.definition.id || "").indexOf("special:货柜") === 0);
  const sources = {
    ore:Object.fromEntries(ResourceRegistry.listStateEntries(state, "ore").map(entry => [getResourceDisplayName(entry.definition.id), entry.quantity])),
    mineral:Object.fromEntries(ResourceRegistry.listStateEntries(state, "mineral").map(entry => [getResourceDisplayName(entry.definition.id), entry.quantity])),
    planetary:Object.fromEntries(ResourceRegistry.listStateEntries(state, "planetary").map(entry => [getResourceDisplayName(entry.definition.id), entry.quantity])),
    gases:Object.fromEntries(ResourceRegistry.listStateEntries(state, "gas").map(entry => [getResourceDisplayName(entry.definition.id), entry.quantity])),
    moon:Object.fromEntries(ResourceRegistry.listStateEntries(state, "moon").map(entry => [getResourceDisplayName(entry.definition.id), entry.quantity])),
    special:Object.fromEntries(
      [
        ...specialEntries.filter(entry => (entry.definition.id || "").indexOf("special:货柜") !== 0),  // 货柜改由 consumable 收纳
        ...calibrationEntries
      ].map(entry => {
        const id = entry.definition.id;
        const key = entry.definition.key;
        const voucher = (typeof ARCHAEOLOGY_VOUCHERS !== "undefined" && ARCHAEOLOGY_VOUCHERS[key]) ? ARCHAEOLOGY_VOUCHERS[key] : null;
        return [voucher && voucher.name ? voucher.name : (entry.definition.name || getResourceDisplayName(id)), { qty: entry.quantity, id }];
      })
    ),
    consumable:Object.assign(
      Object.assign(
        { "燃料单元":ResourceRegistry.get(state, "consumable:fuel") },
        // 弹药按「实例名(含档位)」分卡：T1 激光晶体弹药 / T2 聚焦相位激光弹 各自独立成卡，
        // 不再按类型混并为一张（旧逻辑 getAmmoCount(state,'laser') 把 T1+T2 求和导致同名合并）。
        (function () {
          const byName = {};
          for (const s of (state.ammo || [])) {
            const qty = Number(s && s.qty) || 0;
            if (qty <= 0) continue;
            const nm = (s && s.name) || (typeof ammoDisplayName === "function" ? ammoDisplayName(s && s.type, s && s.tier) : (AMMO_TYPE_NAMES[s && s.type] || "弹药"));
            const tier = (s && s.tier) || "T1";
            const prev = byName[nm];
            if (prev == null) byName[nm] = { qty, ammoTier: tier };
            else byName[nm].qty += qty;
          }
          return byName;
        })(),
        { "纳米维修膏":ResourceRegistry.get(state, "consumable:repairPaste") }
      ),
      // 货柜复用与 special 一致的形状 {qty,id}，id 保留 special:货柜* 以保证开箱功能
      Object.fromEntries(cargoEntries.map(entry => [getResourceDisplayName(entry.definition.id), { qty: entry.quantity, id: entry.definition.id }])),
      // 增强剂：库存存于 state.boosters.inventory（裸 id 键），此前不在任何 ITEM_CATEGORIES、仓库完全不显示；
      // 此处并入「消耗品」标签展示（id 保留 booster:xxx 以便详情弹窗与来源判定）。
      (function () {
        const inv = (state.boosters && state.boosters.inventory) || {};
        const out = {};
        for (const r of (typeof BOOSTER_RECIPES !== "undefined" ? BOOSTER_RECIPES : [])) {
          const q = Number(inv[r.id]) || 0;
          if (q > 0) out[r.name] = { qty: q, id: r.itemId };
        }
        return out;
      })()
    ),
    equipment:equipmentSource
  };
  const equipmentByName = Object.fromEntries(Object.values(EQUIPMENT_DB).map(equipment => [equipment.name, equipment]));
  const items = [];
  for (const [category, configuredNames] of Object.entries(ITEM_CATEGORIES)) {
    const includeCat = selectedFilter === "all" || selectedFilter === category || (selectedFilter === "component" && category === "equipment");
    if (!includeCat) continue;
    const names = [...new Set([...configuredNames, ...Object.keys(sources[category] || {})])];
    for (const name of names) {
      const rawEntry = sources[category] && sources[category][name];
      const quantity = Number(rawEntry && typeof rawEntry === "object" ? rawEntry.qty : rawEntry) || 0;
      if (quantity <= 0) continue;
      const equipment = category === "equipment" ? equipmentByName[name] : null;
      const isEquip = category === "equipment" && !!equipment;
      const isComponent = category === "equipment" && !equipment;
      // 虚拟筛选：装备页只显真装备，组件页只显舰船组件
      if (selectedFilter === "equipment" && isComponent) continue;
      if (selectedFilter === "component" && !isComponent) continue;
      const categoryLabel = isComponent ? (CARGO_CATEGORY_LABEL.component || "组件") : (CARGO_CATEGORY_LABEL[category] || category);
      // 物品真实 id（货柜为 special:货柜*、增强剂为 booster:*，用于下方来源覆写与开箱弹窗判定）
      const itemId = (rawEntry && typeof rawEntry === "object" && rawEntry.id) || null;
      // 弹药档位（由弹药实例 s.tier 带出，名字无可识别档位时不靠名字猜）
      const ammoTier = (rawEntry && typeof rawEntry === "object" && rawEntry.ammoTier) || null;
      const fallbackIcon = equipment ? (equipment.slot === "mid" ? "🤖" : equipment.slot === "low" ? "⬆️" : "📦") : (itemId && itemId.indexOf("booster:") === 0 ? "💉" : "📦");
      let source = isEquip
        ? { pageId:"equipmentEngineering", pageLabel:"装备工程", icon:"fa-solid fa-gears" }
        : isComponent
          ? { pageId:"shipEngineering", pageLabel:"舰船工程", icon:"fa-solid fa-rocket" }
          : (CARGO_SOURCE[category] || { pageId:"station", pageLabel:"空间站", icon:"fa-regular fa-building" });
      let description = isEquip
        ? getEquipmentAttributeText(equipment)
        : isComponent
          ? (CARGO_DESC.component || "")
          : (CARGO_DESC[category] || "");
      // 货柜容器虽归入「消耗品」标签展示，但其真实来源是战斗击坠与考古探索，并非装备工程；
      // 故覆盖掉 consumable 默认的来源与描述，避免卡片误导玩家。
      if (itemId && itemId.indexOf("special:货柜") === 0) {
        source = { pageId:"combat", pageLabel:"战斗", icon:"fa-solid fa-crosshairs" };
        description = "货柜容器。由战斗击坠敌舰与考古探索低概率获取，开启后可获得矿物、行星材料、具名战利品、装备蓝图或神经植入体。";
      }
      // 校准基体（calibration: 命名空间）虽归入「特殊物资」标签，但来历实为考古，纠正来源与说明避免误归战斗
      if (itemId && itemId.indexOf("calibration:") === 0) {
        source = { pageId:"archaeology", pageLabel:"考古", icon:"fa-solid fa-digging" };
        description = "校准材料。由考古探索获取，是改装件制造的核心耗材，在装备工程的各档 rig 配方中消耗。";
      }
      // 增强剂（booster: 命名空间）归入「消耗品」标签，来源是增强剂制造而非装备工程，纠正来源与说明
      if (itemId && itemId.indexOf("booster:") === 0) {
        source = { pageId:"boosterEngineering", pageLabel:"增强剂制造", icon:"fa-solid fa-flask" };
        description = "增强剂。由增强剂制造产出，可临时提升采矿、采气、冶炼、考古或增强剂产出效率，是作业与探险的核心消耗品。";
      }
      items.push({
        category,
        categoryLabel,
        name,
        quantity,
        ammoTier,
        id: itemId,
        icon:ITEM_ICONS[name] || fallbackIcon,
        details:equipment ? getEquipmentAttributeText(equipment) : "",
        isEquipment:isEquip,
        itemId:isEquip ? equipment.id : null,
        componentId: isComponent ? (componentIdByName[name] || null) : null,
        description,
        source
      });
      const warehouseItem = items[items.length - 1];
      if (itemId && itemId.indexOf("special:voucher_") === 0) {
        warehouseItem.categoryLabel = "考古凭证";
        warehouseItem.source = { pageId:"archaeology", pageLabel:"考古", icon:"fa-solid fa-digging" };
        warehouseItem.description = "考古探索获得的永久回收凭证，持有后会提升对应回收收益。";
      }
      if (itemId && itemId.indexOf("special:") === 0 && itemId.indexOf("special:voucher_") !== 0 && typeof getMaterialCraftables === "function") {
        warehouseItem.craftables = getMaterialCraftables(itemId, state);
      }
    }
  }
  // 仓库自动排序：顶层分类固定顺序 → 小分类 → 组内排序键（资源按采集等级升序；装备组内按等级降序；数量仅作同级 tiebreaker）
  const componentLevelByName = Object.fromEntries(SHIP_COMPONENT_RECIPES.map(r => [r.name, r.level]));
  for (const it of items) {
    const meta = computeCargoSortMeta(it, componentLevelByName);
    it.topRank = meta.topRank; it.topLabel = meta.topLabel;
    it.subRank = meta.subRank; it.subLabel = meta.subLabel;
    it._primary = meta.primary; it._secondary = meta.secondary;
  }
  items.sort((a, b) => {
    if (a.topRank !== b.topRank) return a.topRank - b.topRank;
    if (a.subRank !== b.subRank) return a.subRank - b.subRank;
    if (a._primary !== b._primary) return a._primary - b._primary;
    if (a._secondary !== b._secondary) return a._secondary < b._secondary ? -1 : 1;
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return (a.name || "") < (b.name || "") ? -1 : 1;
  });
  return {
    kind:"cargo",
    filter:selectedFilter,
    total:getInventoryTotalFromState(state),
    items,
    emptyText:selectedFilter === "all"
      ? "仓库空空如也"
      : selectedFilter === "equipment"
        ? "暂无舰船装备数据"
        : selectedFilter === "component"
          ? "暂无舰船组件数据"
          : "该分类暂无物品",
    filters:Object.keys(ITEM_CATEGORIES).map(id => ({ id, selected:id === selectedFilter }))
  };
}

/* ---- 仓库「交易品」子标签：货柜具名战利品 + 考古星币/功勋文物，统一一键回收 ---- */
function getTradeGoodsDisplayState(state) {
  const items = [];
  // 1) 货柜具名战利品（state.cargoLoot）：仅 isk / lp 两类，直接铸入背包、无其他用途
  if (Array.isArray(state.cargoLoot)) {
    for (const loot of state.cargoLoot) {
      if (!loot || (loot.kind !== "isk" && loot.kind !== "lp")) continue;
      items.push({
        id: loot.id,
        name: loot.name,
        icon: loot.kind === "lp" ? "🎖" : "💰",
        quantity: 1,
        kind: loot.kind,
        value: loot.value,
        category: "trade",
        categoryLabel: "交易品",
        description: loot.kind === "lp"
          ? "货柜出产的具名战利品，可兑换为功勋。"
          : "货柜出产的具名战利品，可出售为星币。",
        source: { pageId: "cargo", pageLabel: "货柜", icon: "fa-solid fa-box-open" }
      });
    }
  }
  // 2) 考古文物：common_isk / unique → 星币；lp → 功勋。校准物（用于考古升级）排除
  if (typeof ARCHAEOLOGY_ARTIFACTS !== "undefined") {
    for (const a of ARCHAEOLOGY_ARTIFACTS) {
      if (a.category === "calibration") continue;
      if (a.category !== "common_isk" && a.category !== "unique" && a.category !== "lp") continue;
      const stock = ResourceRegistry.get(state, "artifact:" + a.id);
      if (stock <= 0) continue;
      const isLP = a.category === "lp";
      items.push({
        id: "artifact:" + a.id,
        name: a.name,
        icon: isLP ? "🎖" : "📜",
        quantity: stock,
        kind: isLP ? "lp" : "isk",
        value: isLP ? (Number(a.lpValue) || 0) : (Number(a.iskValue) || 0),
        category: "trade",
        categoryLabel: "交易品",
        description: isLP
          ? (a.desc || "考古出产的勋章类文物，可兑换为功勋。")
          : (a.desc || "考古出产的商业文物，可出售为星币。"),
        source: { pageId: "archaeology", pageLabel: "考古", icon: "fa-solid fa-digging" }
      });
    }
  }
  // 回收报价（含银河凭证 ×1.10 预估）
  const quoteItems = items.map(it => ({ currency: it.kind, amount: Math.max(0, Math.round(it.value * it.quantity)) }));
  const quote = (typeof getRecycleQuote === "function") ? getRecycleQuote(state, quoteItems) : { byCurrency: {} };
  return {
    kind: "cargo",
    filter: "trade",
    total: items.length,
    items,
    quote,
    emptyText: "暂无交易品。货柜开出的具名战利品、考古出产的星币/功勋文物会汇集于此，可一键回收为星币与功勋。",
    filters: []
  };
}

/* ---- 仓库装备强化列表展示态（双池：inventory 字符串 + instances） ---- */
function getEquipmentEnhancementListDisplayState(state) {
  if (typeof getEquipmentEnhancementCategory !== "function") return { entries:[] };
  const engLevel = Number(state.skills && state.skills.equipmentEngineering && state.skills.equipmentEngineering.lvl) || 1;
  const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  const instances = state.equipment && Array.isArray(state.equipment.instances) ? state.equipment.instances : [];

  const buildCostRows = display => Object.entries(display.cost).map(([mineral, qty]) => {
    const stock = ResourceRegistry.getMaterialStock(state, mineral);
    return { name:mineral, need:qty, stock, enough:stock >= qty };
  });
  const buildExtraRows = (display, itemId) => {
    const rows = [];
    if (display.extra.sameTypeItemId) {
      const have = getEquipmentInventoryCount(state, itemId);
      rows.push({ label:"同型号 +0 装备", need:1, have, enough:have >= 1 });
    }
    if (display.extra.core) {
      const stock = ResourceRegistry.getMaterialStock(state, display.extra.core);
      rows.push({ label:display.extra.core, need:1, have:stock, enough:stock >= 1 });
    }
    if (display.extra.protocol) {
      const stock = ResourceRegistry.getMaterialStock(state, display.extra.protocol);
      rows.push({ label:display.extra.protocol, need:1, have:stock, enough:stock >= 1 });
    }
    return rows;
  };
  // 与 enhanceEquipment 前置校验一致：instance 目标不消耗库存（里程碑 donor 除外），
  // inventory 目标自身消耗 1 件。requiredInventory = (实例?0:1) + (里程碑?1:0)。
  const canEnhanceFor = (eq, level, targetRef) => {
    const isInstance = isEquipmentInstanceId(state, targetRef);
    const display = getEquipmentEnhancementDisplayState(eq, level, engLevel);
    if (!ResourceRegistry.canAffordCost(state, display.cost)) return false;
    const needDonor = Boolean(display.extra.sameTypeItemId);
    const requiredInventory = (isInstance ? 0 : 1) + (needDonor ? 1 : 0);
    if (getEquipmentInventoryCount(state, eq.id) < requiredInventory) return false;
    if (display.extra.core && ResourceRegistry.getMaterialStock(state, display.extra.core) < 1) return false;
    if (display.extra.protocol && ResourceRegistry.getMaterialStock(state, display.extra.protocol) < 1) return false;
    return true;
  };

  const CATEGORY_LABEL = { normal:"通用", faction:"势力", alliance:"银河联盟", "deathspace-standard":"死亡空间", "deathspace-supervisor":"死亡空间(监督者)", "deathspace":"死亡空间", unknown:"其它" };
  const entries = [];
  const groups = new Map();
  const ensure = itemId => { if (!groups.has(itemId)) groups.set(itemId, { itemId, inventoryRefs:[], instances:[] }); return groups.get(itemId); };
  for (const ref of inventory) ensure(ref).inventoryRefs.push(ref);
  for (const inst of instances) ensure(inst.itemId).instances.push(inst);

  for (const [itemId, group] of groups) {
    const eq = EQUIPMENT_DB[itemId];
    if (!eq) continue;
    // 改装件(rig)纳入强化列表展示，但标记 isRig 且 canEnhance=false（安装即生效、无 enhancementLevel），归入「未强化」筛选；其强化相关字段置默认。
    // 分组维度对齐仓库「全部」小分类：装备功能组（武器/维修/采矿/采气/打捞/考古/改装件/其他）
    const groupLabel = getEquipmentFunctionGroup(eq);
    const groupRank = EQUIP_FUNCTION_ORDER[groupLabel] != null ? EQUIP_FUNCTION_ORDER[groupLabel] : 99;

    // 按等级分桶（未安装 / 已安装）
    const byLevel = new Map();
    const bucket = (level, inst) => {
      if (!byLevel.has(level)) byLevel.set(level, { uninstalled:[], installed:[] });
      (inst.installedOn ? byLevel.get(level).installed : byLevel.get(level).uninstalled).push(inst);
    };
    for (const inst of group.instances) bucket(Math.max(0, Number(inst.enhancementLevel) || 0), inst);

    // 涉及的等级：库存 +0 始终出格；加上所有实例等级
    const levels = new Set([0]);
    for (const lv of byLevel.keys()) levels.add(lv);

    for (const level of levels) {
      const at = byLevel.get(level) || { uninstalled:[], installed:[] };
      const stockCount = (level === 0 ? group.inventoryRefs.length : 0) + at.uninstalled.length;
      const installedCount = at.installed.length;
      if (stockCount === 0 && installedCount === 0) continue;

      // 代表强化目标：优先未安装件；+0 优先用库存（创建实例路径），否则用 +0 实例
      let targetRef = null;
      if (level === 0 && group.inventoryRefs.length) targetRef = group.inventoryRefs[0];
      else if (at.uninstalled.length) targetRef = at.uninstalled[0].instanceId;

      const isRig = eq.slot === "rig";
      let display, costRows, extraRows, canEnhance;
      let multiplier = 1, bonusPercent = 0, previewMultiplier = 1, previewBonusPercent = 0, successPercent = 0, successBreakdown = null, isMilestone = false;
      if (isRig) {
        costRows = []; extraRows = []; canEnhance = false;
      } else {
        display = getEquipmentEnhancementDisplayState(eq, level, engLevel);
        costRows = buildCostRows(display);
        extraRows = buildExtraRows(display, itemId);
        canEnhance = targetRef ? canEnhanceFor(eq, level, targetRef) : false;
        multiplier = display.multiplier;
        bonusPercent = Math.round((display.multiplier - 1) * 1000) / 10;
        previewMultiplier = display.previewMultiplier;
        previewBonusPercent = Math.round((display.previewMultiplier - 1) * 1000) / 10;
        successPercent = Math.round(display.success * 1000) / 10;
        successBreakdown = display.successBreakdown;
        isMilestone = display.isMilestone;
      }

      entries.push({
        itemId,
        name: eq.name,
        icon: ITEM_ICONS[eq.name] || "📦",
        slot: eq.slot,
        isRig,
        category: isRig ? "rig" : getEquipmentEnhancementCategory(eq),
        categoryLabel: isRig ? "改装件" : (CATEGORY_LABEL[getEquipmentEnhancementCategory(eq)] || "其它"),
        groupLabel,
        groupRank,
        level,
        isUnenhanced: level === 0,
        stockCount,
        installedCount,
        totalCount: stockCount + installedCount,
        multiplier,
        bonusPercent,
        previewMultiplier,
        previewBonusPercent,
        successPercent,
        successBreakdown,
        isMilestone,
        costRows,
        extraRows,
        canEnhance,
        targetRef,
        installedShips: at.installed.map(inst => {
          const ship = getShipInstanceFromState(state, inst.installedOn);
          return ship ? (getShipConfigById(ship.shipId) ? getShipConfigById(ship.shipId).name : inst.installedOn) : inst.installedOn;
        })
      });
    }
  }
  entries.sort((a, b) =>
    (a.groupRank != null ? a.groupRank : 99) - (b.groupRank != null ? b.groupRank : 99) ||
    a.name.localeCompare(b.name, "zh") ||
    a.level - b.level);
  return { entries };
}

// 定点返修：统一经显示层取货币名，DisplayNames 不可用时按 fallback 收口（不得直接 isk/LP.toUpperCase）。
function displayCurrencyName(currencyId, fallback) {
  if (typeof DisplayNames !== "undefined" && DisplayNames && typeof DisplayNames.getCurrencyName === "function") {
    const got = DisplayNames.getCurrencyName(currencyId);
    if (got && got !== currencyId) return got;
  }
  return fallback;
}

function getLPStoreDisplayState(state) {
  const lp = ResourceRegistry.get(state, "currency:lp");
  const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  return {
    kind:"lpstore",
    balance:lp,
    items:getLPStoreCatalogItems().map(item => {
      const isBlueprint = item.kind === "equipmentBlueprint";
      const owned = isBlueprint
        ? (hasEquipmentBlueprintFromState(state, item.equipmentId) ? 1 : 0)
        : inventory.filter(id => id === item.equipmentId).length;
      return {
        id:item.id,
        name:item.name,
        kind:item.kind,
        price:item.lpPrice,
        attributes:isBlueprint ? item.description : getEquipmentAttributeText(item.equipmentId, " · "),
        owned,
        ownedText:isBlueprint ? (owned ? "永久蓝图已拥有" : "永久蓝图未拥有") : "已拥有 " + owned,
        canBuy:lp >= item.lpPrice && (!isBlueprint || owned === 0),
        purchaseText:isBlueprint && owned ? "已拥有" : item.lpPrice + " " + displayCurrencyName("lp", "功勋") + "兑换",
        icon:isBlueprint ? "fa-solid fa-scroll" : item.equipmentId.includes("gas") ? "fa-solid fa-wind" : "fa-solid fa-gem"
      };
    })
  };
}

function getBlueprintShipPreview(item) {
  const recipe = SHIP_ASSEMBLY_RECIPES.find(entry => entry.shipId === item.shipId);
  const ship = getShipConfigById(item.shipId);
  if (!recipe || !ship) return { productName:item.name.replace(/蓝图$/, ""), previewLines:[] };
  const componentText = Object.entries(getShipAssemblyComponentCost(recipe)).map(([componentId, quantity]) => {
    const component = SHIP_COMPONENT_RECIPES.find(entry => entry.id === componentId);
    return (component ? component.name : componentId) + "×" + quantity;
  });
  const materialText = Object.entries(recipe.materialCost || {}).map(([material, quantity]) => getResourceDisplayName(material) + "×" + quantity);
  const bonusNames = {
    shieldCapacity:"护盾容量", armorCapacity:"装甲容量", structureCapacity:"结构容量",
    laserDamage:"激光伤害", missileDamage:"导弹伤害", cannonDamage:"射弹伤害",
    targetingSpeed:"锁定速度", speed:"速度",
    armorRepair:"装甲维修", structureRepair:"结构维修", hitBonus:"命中",
    miningLaserEfficiency:"采矿装备效果", gasLaserEfficiency:"采气装备效果", salvageEfficiency:"打捞效率",
    fleetMiningSpeed:"舰队采矿速度", smeltingSpeed:"冶炼速度",
    archaeologyScanStrength:"扫描强度", archaeologyFailureDamageReduction:"失败反噬减免"
  };
  const percentKeys = new Set(["shieldCapacity", "armorCapacity", "structureCapacity", "laserDamage", "missileDamage", "cannonDamage", "targetingSpeed", "speed", "armorRepair", "structureRepair", "miningLaserEfficiency", "gasLaserEfficiency", "salvageEfficiency", "fleetMiningSpeed", "smeltingSpeed", "archaeologyFailureDamageReduction"]);
  const bonuses = Object.entries(ship.bonuses || {}).map(([key, value]) =>
    (bonusNames[key] || key) + " +" + (percentKeys.has(key) ? Math.round(value * 100) + "%" : value)
  );
  return {
    productName:ship.name,
    previewLines:[
      { label:"制造", value:`舰船工程 Lv.${recipe.level} · ${recipe.time}s · ${recipe.xp} XP` },
      { label:"舰体", value:`护盾 ${ship.hp.shield} · 装甲 ${ship.hp.armor} · 结构 ${ship.hp.structure} · 总生命 ${ship.totalHp}` },
      { label:"槽位", value:`高 ${ship.slots.high} · 中 ${ship.slots.mid} · 低 ${ship.slots.low} · 改装 ${ship.slots.rig}` },
      ...(bonuses.length ? [{ label:"加成", value:bonuses.join(" · ") }] : []),
      { label:"消耗", value:[...componentText, ...materialText].join(" + ") }
    ]
  };
}

function getBlueprintEquipmentPreview(item) {
  const equipment = EQUIPMENT_DB[item.equipmentId];
  const recipe = getEquipmentEngineeringRecipe(item.equipmentId);
  if (!equipment || !recipe) return { productName:item.name.replace(/蓝图$/, ""), previewLines:[] };
  const inputs = [];
  if (recipe.inputEquipment) {
    const input = EQUIPMENT_DB[recipe.inputEquipment.itemId];
    inputs.push((input ? input.name : recipe.inputEquipment.itemId) + "×" + recipe.inputEquipment.quantity);
  }
  for (const [material, quantity] of Object.entries(recipe.cost || {})) inputs.push(getResourceDisplayName(material) + "×" + quantity);
  return {
    productName:equipment.name,
    previewLines:[
      { label:"制造", value:`装备工程 Lv.${recipe.level} · ${recipe.time}s · ${recipe.xp} XP` },
      { label:"属性", value:getEquipmentAttributeLines(equipment).join(" · ") },
      { label:"消耗", value:inputs.join(" + ") }
    ]
  };
}

function getBlueprintStoreDisplayState(state, selectedCategory) {
  const categoryId = BLUEPRINT_STORE_CATEGORIES.some(item => item.id === selectedCategory) ? selectedCategory : "ships";
  const isk = ResourceRegistry.get(state, "currency:isk");
  const lp = ResourceRegistry.get(state, "currency:lp");
  const ownedBlueprints = new Set(state.ownedBlueprints || []);
  const catalog = getBlueprintStoreCatalogItems();
  return {
    kind:"blueprintStore",
    balance:{ isk, lp },
    category:categoryId,
    categories:BLUEPRINT_STORE_CATEGORIES.map(category => ({
      ...category,
      selected:category.id === categoryId,
      count:catalog.filter(item => item.category === category.id).length
    })),
    items:catalog.filter(item => item.category === categoryId).map(item => {
      const owned = item.kind === "shipBlueprint"
        ? ownedBlueprints.has(item.shipId)
        : hasEquipmentBlueprintFromState(state, item.equipmentId);
      const balance = item.currency === "lp" ? lp : isk;
      const preview = item.kind === "shipBlueprint" ? getBlueprintShipPreview(item) : getBlueprintEquipmentPreview(item);
      return {
        ...item,
        owned,
        canBuy:!owned && balance >= item.price,
        productName:preview.productName,
        previewLines:preview.previewLines,
        priceText:item.price.toLocaleString() + " " + displayCurrencyName(item.currency === "lp" ? "lp" : "isk", item.currency === "lp" ? "功勋" : "星币"),
        purchaseText:owned ? "已拥有" : item.price.toLocaleString() + " " + displayCurrencyName(item.currency === "lp" ? "lp" : "isk", item.currency === "lp" ? "功勋" : "星币") + " 购买",
        icon:item.kind === "shipBlueprint" ? "fa-solid fa-ship" : item.deathspaceTier ? "fa-solid fa-dungeon" : "fa-solid fa-scroll"
      };
    })
  };
}

/* ================================================================
   拆解统一回收率：随冶炼技能等级（skills.refining.lvl）变化。
   rate = min(1.0, 0.35 + 0.002 × (lvl − 1))。
   冶炼1级=35%，每级+0.2%，326级封顶100%（低冶炼玩家回收更少，倒逼练冶炼）。
   ================================================================ */
function getDismantleReclaimRate(refiningLvl) {
  const lvl = Math.max(1, Math.floor(Number(refiningLvl) || 1));
  return Math.min(1.0, 0.35 + 0.002 * (lvl - 1));
}

// 最终拆解回收率 = 冶炼技能基线 + 科研「拆解回收工程」加成（reclaim 组，additivePp），封顶 100%。
// 科研加成与技能基线叠加后统一钳制，避免任一项单独封顶造成加成被吞。
function getReclaimRate(state) {
  const base = getDismantleReclaimRate(getRefiningLevel(state));
  const researchBonus = (typeof ResearchState !== "undefined" && typeof ResearchState.getResearchBonusValue === "function")
    ? Number(ResearchState.getResearchBonusValue(state, "reclaim")) || 0
    : 0;
  return Math.min(1.0, base + researchBonus);
}

function getRefiningLevel(state) {
  return Math.max(0, Math.floor(Number(state && state.skills && state.skills.refining && state.skills.refining.lvl) || 0));
}

/* ================================================================
   舰船拆解只读报价（Batch R · E 项）
   SHIP_ASSEMBLY_RECIPES.componentCost → SHIP_COMPONENT_RECIPES.cost 折算为基础材料，
   再合并 assembly 的 materialCost（纯名键），同材料合计后每项 floor(总量 × rate) 归还。
   只读纯计算，不触碰 state；refId 取材料名跨命名空间聚合的第一个命名空间 id（归还锚点）。
   reclaimRate 默认 0.5（向后兼容），实际调用方应传入 getDismantleReclaimRate(冶炼等级)。
   ================================================================ */
function getShipDismantleQuote(recipe, config, enhancementLevel, reclaimRate) {
  if (!recipe || typeof recipe !== "object") return [];
  // key -> { total, kind, id? }：material = 基础材料名；component = 舰船强化组件（refId 取 component:<id>）
  const costMap = {};
  const add = (key, total, kind, id) => {
    if (!costMap[key]) costMap[key] = { total:0, kind, id };
    costMap[key].total += Number(total);
  };
  for (const [compId, qty] of Object.entries(recipe.componentCost || {})) {
    const comp = SHIP_COMPONENT_RECIPES.find(item => item.id === compId);
    if (!comp) continue;
    for (const [mat, cqty] of Object.entries(comp.cost || {})) {
      add(mat, Number(cqty) * Number(qty), "material");
    }
  }
  for (const [mat, qty] of Object.entries(recipe.materialCost || {})) {
    add(mat, Number(qty), "material");
  }
  // 舰船强化消耗（仅组件，星币不返还）：每级固定组件各 1，共 enhancementLevel 级（只算成功，失败不计入）
  const L = Math.max(0, Math.floor(Number(enhancementLevel) || 0));
  if (config && L > 0 && typeof getShipEnhancementCost === "function") {
    const perLevel = getShipEnhancementCost(config);
    for (const [compId, qty] of Object.entries(perLevel)) {
      add("__component__" + compId, Number(qty) * L, "component", compId);
    }
  }
  return Object.entries(costMap)
    .map(([key, info]) => {
      let refId, name;
      if (info.kind === "component") {
        refId = "component:" + info.id;
        name = (typeof SHIP_COMPONENT_RECIPES !== "undefined")
          ? ((SHIP_COMPONENT_RECIPES.find(c => c.id === info.id) || {}).name || info.id) : info.id;
      } else {
        name = key;
        refId = (typeof ResourceRegistry !== "undefined" && typeof ResourceRegistry.resolveMaterialIds === "function")
          ? (ResourceRegistry.resolveMaterialIds(name)[0] || null) : null;
        name = (typeof getResourceDisplayName === "function") ? getResourceDisplayName(name) : name;
      }
      return { name, refId, total:info.total, returned:Math.floor(info.total * (reclaimRate != null ? reclaimRate : 0.5)) };
    })
    .filter(entry => entry.returned > 0)
    .sort((a, b) => b.returned - a.returned || a.name.localeCompare(b.name, "zh-CN"));
}

// 拆解阻塞判定（selector 与 Action 共用唯一口径，禁止 UI/Action 各自重复判断）：
// null = 可拆解；否则返回 reason key。
function getShipDismantleBlockReason(state, instance, now) {
  if (!instance) return "unknown-ship";
  if (!getShipConfigById(instance.shipId)) return "unknown-ship";
  const assignments = state.shipAssignments || {};
  if (Object.keys(assignments).some(key => assignments[key] === instance.instanceId)) return "ship-assigned";
  const activeCombat = state.combat && state.combat.active ? getActiveCombatShipState(state).instance : null;
  if (activeCombat && activeCombat.instanceId === instance.instanceId) return "ship-active";
  const activeSkill = state.currentAction && state.currentAction.active ? state.currentAction.skill : null;
  if (activeSkill && assignments[activeSkill] === instance.instanceId) return "ship-active";
  if (isShipUnderRepair(state, instance.instanceId, now)) return "repairing";
  const fitting = getFittingFromInstance(instance);
  if ([fitting.high, fitting.mid, fitting.low, fitting.rig]
    .some(slot => slot.some(ref => ref !== null && ref !== undefined && ref !== ""))) return "has-fitting";
  return null;
}

const SHIP_DISMANTLE_BLOCK_TEXT = {
  "unknown-ship":"未知舰船",
  "ship-assigned":"舰船正在执行岗位任务",
  "ship-active":"舰船正在执行中，停止当前任务后才能拆解",
  "repairing":"舰船正在维修中，维修完成后才能拆解",
  "has-fitting":"舰船仍装配有装备或改装件，先全部卸下"
};

/* ================================================================
   装备拆解只读报价（Batch S·装备管理）
   矿物：基础制造材料（eq.cost 全部，含非精炼）+ 逐级成功强化精炼矿物消耗，合计后每项 floor(×rate)。
   整件耗材（同型装备 / DED 核心 / 协议）：来自逐级里程碑额外消耗，逐件列出，拆解时独立 rate 掷骰（不在此处结算）。
   只读纯计算，不触碰 state。
   reclaimRate 默认 0.5（向后兼容），实际调用方应传入 getDismantleReclaimRate(冶炼等级)。
   ================================================================ */
function getEquipmentDismantleQuote(equipment, level, reclaimRate) {
  if (!equipment) return { materials:[], wholeItems:[] };
  const L = Math.max(0, Math.floor(Number(level) || 0));
  const minerals = {};
  for (const [mat, qty] of Object.entries(equipment.cost || {})) {
    minerals[mat] = (minerals[mat] || 0) + Number(qty);
  }
  let wholeItems = [];
  if (L > 0 && typeof EquipmentEnhancement !== "undefined" && EquipmentEnhancement.getEquipmentEnhancementSuccessCostSummary) {
    const summary = EquipmentEnhancement.getEquipmentEnhancementSuccessCostSummary(equipment, L);
    for (const [mat, qty] of Object.entries(summary.minerals || {})) {
      minerals[mat] = (minerals[mat] || 0) + Number(qty);
    }
    wholeItems = (summary.wholeItems || []).map(w => ({ type:w.type, id:w.id }));
  }
  const materials = Object.entries(minerals)
    .map(([name, total]) => {
      const refId = (typeof ResourceRegistry !== "undefined" && typeof ResourceRegistry.resolveMaterialIds === "function")
        ? (ResourceRegistry.resolveMaterialIds(name)[0] || null) : null;
      const label = (typeof getResourceDisplayName === "function") ? getResourceDisplayName(name) : name;
      return { name:label, refId, total, returned: Math.floor(total * (reclaimRate != null ? reclaimRate : 0.5)) };
    })
    .filter(entry => entry.returned > 0)
    .sort((a, b) => b.returned - a.returned || a.name.localeCompare(b.name, "zh-CN"));
  return { materials, wholeItems };
}

/* ================================================================
   组件拆解只读报价（Batch S·舰船工程·部件车间）
   组件无强化、无整件耗材：直接反查 SHIP_COMPONENT_RECIPES 取 cost，每项 floor(总量 × rate) 归还材料。
   只读纯计算，不触碰 state。
   ================================================================ */
function getComponentDismantleQuote(componentId, reclaimRate) {
  const recipe = (typeof SHIP_COMPONENT_RECIPES !== "undefined")
    ? SHIP_COMPONENT_RECIPES.find(item => item.id === componentId) : null;
  if (!recipe) return [];
  const rate = (reclaimRate != null) ? reclaimRate : 0.5;
  return Object.entries(recipe.cost || {})
    .map(([name, total]) => {
      const refId = (typeof ResourceRegistry !== "undefined" && typeof ResourceRegistry.resolveMaterialIds === "function")
        ? (ResourceRegistry.resolveMaterialIds(name)[0] || null) : null;
      const label = (typeof getResourceDisplayName === "function") ? getResourceDisplayName(name) : name;
      return { name:label, refId, total:Number(total), returned: Math.floor(Number(total) * rate) };
    })
    .filter(entry => entry.returned > 0)
    .sort((a, b) => b.returned - a.returned || a.name.localeCompare(b.name, "zh-CN"));
}

// 装备拆解/丢弃阻塞判定（与 Action 共用唯一口径）：null = 可操作；否则 reason key。
function getEquipmentDismantleBlockReason(state, targetRef) {
  const resolved = (typeof EquipmentEnhancement !== "undefined" && EquipmentEnhancement.resolveEquipmentReference)
    ? EquipmentEnhancement.resolveEquipmentReference(state, targetRef) : null;
  if (!resolved) return "unknown-equipment";
  if (resolved.instance && resolved.instance.installedOn) return "equipment-installed";
  return null;
}

function getHangarDisplayState(state, now) {
  const assignments = state.shipAssignments || {};
  const actionNames = { combat:"⚔ 战斗", mining:"⛏ 采矿", gasHarvesting:"☁ 采气", refining:"🔥 冶炼", archaeology:"🛰 考古" };
  const ships = state.inventory && Array.isArray(state.inventory.ships) ? state.inventory.ships : [];
  return {
    kind:"hangar",
    count:ships.length,
    actionNames,
    combatRecoveryActive:false,
    ships:ships.map(instance => {
      const config = getShipConfigById(instance.shipId);
      if (!config) return { instanceId:instance.instanceId, shipId:instance.shipId, unknown:true };
      // 问题2：per-ship 维修——每艘舰按自身 instanceId 显示维修状态，而非全局单槽。
      const thisRepairing = isShipUnderRepair(state, instance.instanceId, now);
      const thisRepairUntil = getShipRepairUntil(state, instance.instanceId);
      const thisRepairRemaining = thisRepairUntil > now ? Math.ceil((thisRepairUntil - now) / 1000) : 0;
      const assignedActions = Object.entries(assignments)
        .filter(([key, id]) => id === instance.instanceId && Object.prototype.hasOwnProperty.call(actionNames, key))
        .map(([key]) => key);
      const tier = getShipEnhancementTier(config);
      const enhancementLevel = normalizeShipEnhancementLevel(instance.enhancementLevel);
      const enhancementBonuses = getShipEnhancementBonuses(config, enhancementLevel);
      const nextEnhancementBonuses = getShipEnhancementBonuses(config, enhancementLevel + 1);
      const activeCombatShip = state.combat && state.combat.active ? getActiveCombatShipState(state).instance : null;
      const activeSkill = state.currentAction && state.currentAction.active ? state.currentAction.skill : null;
      const busy = Boolean((activeCombatShip && activeCombatShip.instanceId === instance.instanceId) ||
        (activeSkill && assignments[activeSkill] === instance.instanceId));
      const enhancementCost = getShipEnhancementCost(config);
      const materials = Object.entries(enhancementCost).map(([id, quantity]) => {
        const recipe = SHIP_COMPONENT_RECIPES.find(item => item.id === id);
        const stock = ResourceRegistry.get(state, "component:" + id);
        return { id, name:recipe ? recipe.name : id, quantity, stock, enough:stock >= quantity };
      });
      const iskCost = getShipEnhancementIskCost(config);
      const iskStock = ResourceRegistry.get(state, "currency:isk");
      const iskEnough = iskStock >= iskCost;
      const skillLevel = Number(state.skills.shipEngineering && state.skills.shipEngineering.lvl) || 1;
      const chance = tier ? getShipEnhancementSuccessChance(skillLevel, tier.level, enhancementLevel) : 0;
      const breakdown = tier ? getShipEnhancementSuccessBreakdown(skillLevel, tier.level, enhancementLevel) : null;
      // Batch R（E 项·舰船拆解）：只读报价 + 阻塞判定（与 Action 共用 getShipDismantleBlockReason）
      const dismantleRecipe = SHIP_ASSEMBLY_RECIPES.find(recipe => recipe.shipId === instance.shipId) || null;
      const dismantleBlocked = getShipDismantleBlockReason(state, instance, now);
      const dismantlePreview = dismantleRecipe ? getShipDismantleQuote(dismantleRecipe, config, enhancementLevel, getReclaimRate(state)) : [];
      const role = getShipEnhancementRole(config);
      const hpBefore = { ...config.hp };
      const hp = Object.fromEntries(Object.entries(config.hp).map(([layer, value]) => [layer, Math.round(value * enhancementBonuses.hpMultiplier)]));
      const archaeology = role === "archaeology";
      const scanMul = Number(enhancementBonuses.archaeologyScanMultiplier) || 1;
      const nextScanMul = Number(nextEnhancementBonuses.archaeologyScanMultiplier) || 1;
      const scanBase = archaeology ? (Number(config.bonuses && config.bonuses.archaeologyScanStrength) || 0) : 0;
      const failureReduction = archaeology ? (Number(config.bonuses && config.bonuses.archaeologyFailureDamageReduction) || 0) : 0;
      const smeltMultiplier = (typeof getShipEnhancementSmeltMultiplier === "function")
        ? getShipEnhancementSmeltMultiplier(config, enhancementLevel) : 1;
      const nextSmeltMultiplier = (typeof getShipEnhancementSmeltMultiplier === "function")
        ? getShipEnhancementSmeltMultiplier(config, enhancementLevel + 1) : 1;
      return {
        instanceId:instance.instanceId,
        shipId:instance.shipId,
        name:config.name,
        tier:config.tier,
        type:config.type,
        typeName:typeof SHIP_TYPE_NAMES !== "undefined" ? SHIP_TYPE_NAMES[config.type] || config.type : config.type,
        industrial:Boolean(INDUSTRIAL_SHIPS[instance.shipId]),
        archaeology,
        hpBefore,
        hp,
        dodge:config.dodge,
        speed:config.speed,
        bonuses:{ ...(config.bonuses || {}) },
        enhancement:{
          available:Boolean(tier),
          level:enhancementLevel,
          role,
          chance,
          chancePercent:(chance * 100).toFixed(1),
          successBreakdown:breakdown,
          baseXp:getShipEnhancementBaseXp(config),
          successXp:getShipEnhancementSuccessXp(config, enhancementLevel),
          failureXp:getShipEnhancementFailureXp(config),
          milestone:isShipEnhancementMilestone(enhancementLevel + 1),
          materials,
          iskCost,
          iskStock,
          iskEnough,
          busy,
          canEnhance:Boolean(tier) && !busy && materials.length === 3 && materials.every(item => item.enough) && iskEnough,
          hpBonus:enhancementBonuses.hpMultiplier - 1,
          damageBonus:(enhancementBonuses.damageMultiplier || 1) - 1,
          industryBonus:(enhancementBonuses.industryMultiplier || 1) - 1,
          nextHpGain:nextEnhancementBonuses.hpMultiplier - enhancementBonuses.hpMultiplier,
          nextDamageGain:(nextEnhancementBonuses.damageMultiplier || 1) - (enhancementBonuses.damageMultiplier || 1),
          nextIndustryGain:(nextEnhancementBonuses.industryMultiplier || 1) - (enhancementBonuses.industryMultiplier || 1),
          smeltBonus:smeltMultiplier - 1,
          nextSmeltGain:nextSmeltMultiplier - smeltMultiplier,
          scanBonus:scanMul - 1,
          nextScanGain:nextScanMul - scanMul,
          scanStrengthBase:scanBase,
          scanStrength:Math.round(scanBase * scanMul),
          failureReduction
        },
        fuelEfficiency:Number(config.fuelEfficiency) || 1,
        assignedActions,
        repairing:thisRepairing,
        repairRemaining:thisRepairRemaining,
        combatRecoveryActive:thisRepairing,
        dismantle:{
          available:Boolean(dismantleRecipe),
          preview:dismantlePreview,
          canDismantle:Boolean(dismantleRecipe) && !dismantleBlocked,
          blockedReason:dismantleBlocked || "",
          blockedText:dismantleBlocked ? (SHIP_DISMANTLE_BLOCK_TEXT[dismantleBlocked] || "当前无法拆解") : "",
          reclaimRate:getReclaimRate(state),
          reclaimPercent:Math.round(getReclaimRate(state) * 100)
        },
        assignments:Object.keys(actionNames).map(actionKey => {
          const restriction = getShipAssignmentRestriction(config, actionKey, actionKey === "combat" && thisRepairing, instance, state);
          return { actionKey, name:actionNames[actionKey], active:assignedActions.includes(actionKey), locked:Boolean(restriction), lockedReason:restriction ? restriction.text : "" };
        })
      };
    })
  };
}

// 装配环 rig 容量 = 当前舰船数据库中最大 rig 槽数（不硬编码，随数据库自动扩展）
let ORBIT_RIG_CAPACITY_CACHE = 0;
function getOrbitRigCapacity() {
  if (ORBIT_RIG_CAPACITY_CACHE > 0) return ORBIT_RIG_CAPACITY_CACHE;
  const pools = [STARTER_SHIPS, INDUSTRIAL_SHIPS, typeof ARCHAEOLOGY_SHIPS !== "undefined" ? ARCHAEOLOGY_SHIPS : {}];
  let capacity = 3;
  for (const pool of pools) {
    for (const config of Object.values(pool || {})) {
      capacity = Math.max(capacity, Number(config && config.slots && config.slots.rig) || 0);
    }
  }
  ORBIT_RIG_CAPACITY_CACHE = capacity;
  return capacity;
}

function stackEquipmentCandidates(candidates) {
  const groups = new Map();
  for (const item of candidates) {
    const itemId = item.itemId || item.id;
    const level = Number(item.enhancementLevel) || 0;
    const key = itemId + "|" + level;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
      group.ids.push(item.id);
    } else {
      groups.set(key, {
        itemId, name:item.name, icon:item.icon, enhancementLevel:level,
        count:1, ids:[item.id], isInstance:Boolean(item.isInstance)
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.name !== b.name) return String(a.name).localeCompare(String(b.name));
    return a.enhancementLevel - b.enhancementLevel;
  });
}

function getShipFittingDisplayState(state, shipRef) {
  const instance = getShipInstanceFromState(state, shipRef);
  if (!instance) return null;
  const config = getShipConfigById(instance.shipId);
  if (!config) return null;
  const fitting = getFittingFromInstance(instance);
  const inventory = state.equipment && Array.isArray(state.equipment.inventory) ? state.equipment.inventory : [];
  const slots = { high:config.slots.high || 0, mid:config.slots.mid || 0, low:config.slots.low || 0, rig:config.slots.rig || 0 };
  const orbitSlots = [];
  const totalOrbitSlots = 24 + slots.rig; // 8高 + 8中 + 8低 + 本舰 rig 槽数（rig 索引从 24 起，随舰船动态；illuminator=28，starcrown=29）
  for (let index = 0; index < totalOrbitSlots; index++) {
    const type = index < 8 ? "high" : index < 16 ? "mid" : index < 24 ? "low" : "rig";
    const start = type === "high" ? 0 : type === "mid" ? 8 : type === "low" ? 16 : 24;
    const slotIndex = index - start;
    const enabled = slotIndex < slots[type]; // rig 槽已随改装件系统解禁（超出舰船槽数的仍禁用）
    const equipmentRef = enabled ? fitting[type][slotIndex] || null : null;
    const resolved = equipmentRef ? resolveEquipmentReference(state, equipmentRef) : null;
    const equipment = resolved ? resolved.definition : null;
    orbitSlots.push({
      index, type, slotIndex, enabled, equipmentRef, equipmentId: resolved ? resolved.itemId : null,
      enhancementLevel: resolved ? resolved.enhancementLevel : 0,
      name: equipment ? equipment.name : "", icon: equipment ? ITEM_ICONS[equipment.name] || "📦" : null,
      installedInstanceId: resolved && resolved.instance ? resolved.instance.instanceId : null
    });
  }
  const equippedIds = Object.values(fitting).flat().filter(Boolean);
  const enhancement = getShipEnhancementBonuses(config, instance.enhancementLevel);
  const rigMods = (typeof getRigModifiers === "function") ? getRigModifiers(state, instance) : {};
  const inventoryBySlot = Object.fromEntries(["high", "mid", "low", "rig"].map(slot => {
    // 1. 来自 inventory 字符串池的候选
    const fromInventory = inventory.filter(id => {
      const eq = EQUIPMENT_DB[id];
      if (!eq || eq.slot !== slot || !canFitEquipmentOnShip(eq, config)) return false;
      if (slot === "rig" && typeof canFitRig === "function" && !canFitRig(state, instance, id).ok) return false;
      return true;
    }).map(id => ({ id, itemId:id, name:EQUIPMENT_DB[id].name, icon:ITEM_ICONS[EQUIPMENT_DB[id].name] || "📦", enhancementLevel:0, isInstance:false }));
    // 2. 来自实例池中游离（installedOn===null）的非 rig 装备
    let fromInstances = [];
    if (state.equipment && Array.isArray(state.equipment.instances)) {
      const freeInsts = state.equipment.instances.filter(inst => inst.installedOn === null && !(inst.itemId || "").startsWith("rig_"));
      fromInstances = freeInsts.map(inst => {
        const itemId = inst.itemId;
        const eq = EQUIPMENT_DB[itemId];
        if (!eq || eq.slot !== slot || !canFitEquipmentOnShip(eq, config)) return null;
        return { id:inst.instanceId, itemId, name:eq.name, icon:ITEM_ICONS[eq.name] || "📦", enhancementLevel:Math.max(0, Number(inst.enhancementLevel) || 0), isInstance:true };
      }).filter(Boolean);
    }
    return [slot, fromInventory.concat(fromInstances)];
  }));
  const inventoryStacksBySlot = Object.fromEntries(["high", "mid", "low"].map(slot => [slot, stackEquipmentCandidates(inventoryBySlot[slot] || [])]));
  // rig 候选按槽位计算：excludeSlotIndex 排除当前槽（替换场景旧件将被销毁），
  // 其他槽存在同 stackGroup 时仍拒绝。UI 打开某 rig 槽时消费 rigCandidates[slotIndex]。
  const rigCandidates = Array.from({ length:slots.rig }, (unusedValue, slotIndex) => inventory.filter(id => {
    const eq = EQUIPMENT_DB[id];
    if (!eq || eq.slot !== "rig" || !canFitEquipmentOnShip(eq, config)) return false;
    return typeof canFitRig !== "function" || canFitRig(state, instance, id, slotIndex).ok;
  }).map(id => ({ id, itemId:id, name:EQUIPMENT_DB[id].name, icon:ITEM_ICONS[EQUIPMENT_DB[id].name] || "📦" })));
  const rigStackCandidates = rigCandidates.map(list => stackEquipmentCandidates(list));
  return {
    instanceId:instance.instanceId,
    shipId:instance.shipId,
    name:config.name,
    tier:config.tier,
    type:config.type,
    typeName:typeof SHIP_TYPE_NAMES !== "undefined" ? SHIP_TYPE_NAMES[config.type] || config.type : config.type,
    slots,
    orbitSlots,
    equipped:equippedIds.map(id => {
      const resolved = resolveEquipmentReference(state, id);
      const equipment = resolved ? resolved.definition : null;
      return {
        ref:id, id: resolved ? resolved.itemId : id,
        enhancementLevel: resolved ? resolved.enhancementLevel : 0,
        name: equipment ? equipment.name : id,
        icon: equipment ? ITEM_ICONS[equipment.name] || "📦" : "📦"
      };
    }),
    inventoryBySlot,
    inventoryStacksBySlot,
    rigCandidates,
    rigStackCandidates,
    enhancementLevel:normalizeShipEnhancementLevel(instance.enhancementLevel),
    stats:{ shield:Math.round(config.hp.shield * enhancement.hpMultiplier * (1 + (rigMods.shieldCapacityPercent || 0))), armor:Math.round(config.hp.armor * enhancement.hpMultiplier * (1 + (rigMods.armorCapacityPercent || 0))), structure:Math.round(config.hp.structure * enhancement.hpMultiplier * (1 + (rigMods.structureCapacityPercent || 0))), speed:config.speed || 0 },
    combatLocked:Boolean(state.combat && state.combat.active && getActiveCombatShipState(state).instance && getActiveCombatShipState(state).instance.instanceId === instance.instanceId)
  };
}

function getQueueDisplayState(state) {
  const queue = state.queue || { items:[], config:{}, status:{} };
  const icons = { mining:"⛏", refining:"🔥", gasHarvesting:"☁️", shipEngineering:"🚀", equipmentEngineering:"🔧", combat:"⚔" };
  const labels = { mining:"⛏采矿", refining:"🔥冶炼", gasHarvesting:"☁️气体", shipEngineering:"🚀舰船", equipmentEngineering:"🔧装备工程", combat:"⚔战斗" };
  const combat = state.combat || {};
  const queueRunning = Boolean(queue.status.isRunning) && queue.status.activeIndex >= 0;
  return {
    kind:"queue",
    running:Boolean(queue.status.isRunning),
    statusText:queue.status.isRunning ? "▶ 运行中" : "空闲",
    loopMode:Boolean(queue.config.loopMode),
    maxSize:Number(queue.config.maxSize) || 20,
    count:Array.isArray(queue.items) ? queue.items.length : 0,
    completedCount:Number(queue.status.completedCount) || 0,
    failCount:Number(queue.status.failCount) || 0,
    items:(queue.items || []).map((item, index) => {
      const active = Boolean(queue.status.isRunning && queue.status.activeIndex === index);
      let countText = item.count === -1 ? "无限" : "剩余 ×" + (item.count || 1) + " 次";
      if (item.skill === "combat" && active && combat.queueItemId === item.id) {
        if (combat.queueWavesTarget > 0) countText = "剩余 ×" + Math.max(0, combat.queueWavesTarget - (combat.queueWavesDone || 0)) + " 波";
        else if (combat.queueEntriesTarget > 0) countText = "剩余 ×" + Math.max(0, combat.queueEntriesTarget - (combat.queueEntriesDone || 0)) + " 入场";
      }
      return {
        ...item,
        index,
        active,
        icon:icons[item.skill] || "▶",
        skillLabel:labels[item.skill] || item.skill,
        label:transformDisplayText(item.label),
        countText,
        canMoveUp:index > 0,
        canMoveDown:index < queue.items.length - 1,
        canMoveTop:index > 0 && !(queueRunning && index === queue.status.activeIndex)
      };
    })
  };
}

function getSettingsDisplayState(state) {
  return {
    kind:"settings",
    confirmShipEnhancement:!state.settings || state.settings.confirmShipEnhancement !== false,
    confirmDiscard:!state.settings || state.settings.confirmDiscard !== false,
    confirmDismantle:!state.settings || state.settings.confirmDismantle !== false,
    combatSkillsExpanded:Boolean(state.settings && state.settings.combatSkillsExpanded)
  };
}

function getStatisticsDisplayState(state) {
  const statistics = state && state.statistics ? state.statistics : createDefaultStatisticsState();
  const totals = statistics.totals || {};
  const activity = statistics.activity || {};
  const production = statistics.production || {};
  const combat = statistics.combat || {};
  const economy = statistics.economy || {};
  const number = value => Math.max(0, Number(value) || 0);
  const resourceNames = new Map(ResourceRegistry.listDefinitions().map(definition => [definition.id, getResourceDisplayName(definition.id)]));
  const recipeNames = new Map([
    ...SHIP_COMPONENT_RECIPES.map(recipe => [recipe.id, recipe.name]),
    ...SHIP_ASSEMBLY_RECIPES.map(recipe => [recipe.id, recipe.name]),
    ...Object.values(EQUIPMENT_DB).map(recipe => [recipe.id, recipe.name]),
    ...AMMO_ENG_RECIPES.map(recipe => [recipe.id, recipe.name])
  ]);
  const zoneNames = new Map([
    ...COMBAT_ZONES.map(zone => [zone.id, zone.name]),
    ...DEATHSPACE_DATABASE.map(site => [site.id, site.name])
  ]);
  const deathspaceNames = new Map(DEATHSPACE_DATABASE.map(site => [site.id, site.name]));
  const factionNames = new Map([["angel", "天使联合"], ["blood", "血袭者"], ["sansha", "萨沙共和国"]]);
  const fallbackName = id => {
    const text = String(id || "未知");
    const separator = text.indexOf(":");
    return separator >= 0 ? text.slice(separator + 1) : text;
  };
  const ranked = (map, names) => Object.entries(map || {})
    .map(([id, value]) => ({ id, name:names.get(id) || fallbackName(id), value:number(value) }))
    .filter(item => item.value > 0)
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "zh-CN"));
  const attempts = number(totals.enhancementAttempts);
  const successes = number(totals.enhancementSuccesses);

  return {
    kind:"statistics",
    note:"数据从统计系统启用后开始累计；旧存档此前发生的行为不会倒推补记。",
    summaryGroups:[
      { id:"career", icon:"fa-solid fa-user-astronaut", title:"航行生涯", items:[
        { label:"记录事件", value:number(totals.events) },
        { label:"在线周期", value:number(activity.onlineCycles) },
        { label:"离线周期", value:number(activity.offlineCycles) },
        { label:"技能升级", value:number(totals.skillLevelsGained) }
      ] },
      { id:"production", icon:"fa-solid fa-industry", title:"生产活动", items:[
        { label:"采矿循环", value:number(totals.miningCycles) },
        { label:"采集产物", value:number(totals.minedUnits) + number(totals.gasUnits) + number(totals.planetaryUnits) },
        { label:"冶炼产物", value:number(totals.refinedUnits) },
        { label:"制造次数", value:number(totals.manufacturingCycles) },
        { label:"建造舰船", value:number(totals.shipsBuilt) }
      ] },
      { id:"combat", icon:"fa-solid fa-crosshairs", title:"战斗记录", items:[
        { label:"击毁敌舰", value:number(totals.enemyKills) },
        { label:"精英击毁", value:number(totals.eliteKills) },
        { label:"BOSS击毁", value:number(totals.bossKills) },
        { label:"完成波次", value:number(totals.wavesCleared) },
        { label:"肃清星带", value:number(totals.zonesCleared) },
        { label:"死亡空间层数", value:number(totals.deathspaceWavesCleared) },
        { label:"死亡空间全通", value:number(totals.deathspacesCleared) },
        { label:"舰船战败", value:number(totals.shipsDestroyed) }
      ] },
      { id:"enhancement", icon:"fa-solid fa-angles-up", title:"舰船强化", items:[
        { label:"强化尝试", value:attempts },
        { label:"成功", value:successes },
        { label:"失败", value:number(totals.enhancementFailures) },
        { label:"成功率", value:attempts > 0 ? successes / attempts * 100 : 0, suffix:"%", decimals:1 },
        { label:"消耗部件", value:number(totals.enhancementComponentsSpent) },
        { label:"历史最高", value:number(totals.highestEnhancementLevel), prefix:"+" }
      ] },
      // Batch R（v10·货币消耗统计）：真实消费累计（resource:changed spend 差值），
      // 前缀 "-" 表达支出语义；旧档迁移后为 0，不从余额臆测。
      { id:"economy", icon:"fa-solid fa-coins", title:"经济活动", items:[
        { label:"累计消耗星币", value:number(economy.iskSpent), prefix:"-" },
        { label:"累计消耗功勋", value:number(economy.lpSpent), prefix:"-" }
      ] }
    ],
    detailGroups:[
      { id:"gathered", title:"采集产出", icon:"fa-solid fa-gem", items:ranked(production.gathered, resourceNames), emptyText:"尚无采集记录" },
      { id:"refined", title:"冶炼产出", icon:"fa-solid fa-fire", items:ranked(production.refined, resourceNames), emptyText:"尚无冶炼记录" },
      { id:"manufactured", title:"制造产出", icon:"fa-solid fa-screwdriver-wrench", items:ranked(production.manufactured, recipeNames), emptyText:"尚无制造记录" },
      { id:"zones", title:"星带肃清", icon:"fa-solid fa-burst", items:ranked(combat.zoneClears, zoneNames), emptyText:"尚无肃清记录" },
      { id:"deathspaces", title:"死亡空间全通", icon:"fa-solid fa-dungeon", items:ranked(combat.deathspaceClears, deathspaceNames), emptyText:"尚无全通记录" },
      { id:"zoneKills", title:"战斗区域击毁", icon:"fa-solid fa-skull-crossbones", items:ranked(combat.zoneKills, zoneNames), emptyText:"尚无击毁记录" },
      { id:"factions", title:"势力击毁", icon:"fa-solid fa-flag", items:ranked(combat.factionKills, factionNames), emptyText:"尚无势力击毁记录" }
    ]
  };
}

function getNavigationDisplayState(page, view) {
  const standalonePages = { cargo:"cargo-panel", save:"save-panel", settings:"settings-panel", statistics:"statistics-panel", planetary:"planetary-panel", queue:"queue-panel", combat:"combat-panel", hangar:"hangar-panel", archaeology:"archaeology-panel", station:"station-panel", blueprints:"blueprintstore-panel", lpstore:"blueprintstore-panel" };
  const skillPanels = { shipEngineering:"shipeng-panel", equipmentEngineering:"equipeng-panel", boosterEngineering:"booster-panel", combat:"combat-panel" };
  const selectedPage = page || "skill";
  const selectedView = view || "mining";
  return {
    page:selectedPage,
    view:selectedView,
    standalonePanel:standalonePages[selectedPage] || null,
    specializedSkillPanel:selectedPage === "skill" ? skillPanels[selectedView] || null : null,
    showGenericSkill:selectedPage === "skill" && !skillPanels[selectedView],
    activeNav:selectedPage === "skill" ? { type:"skill", value:selectedView } : { type:"page", value:selectedPage }
  };
}

function getActiveActionProgressDisplayState(state, now) {
  const action = state.currentAction;
  return getProgressDisplayState(action, action.skill, Number(action.refDuration) || 1, now);
}
